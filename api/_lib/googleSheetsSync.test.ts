/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  AppServerConfig,
  BASE_GOOGLE_SCOPES,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_SHEETS_SCOPE,
} from './config.js';
import {
  decryptSecret,
  encryptSecret,
  signPayload,
  verifySignedPayload,
} from './crypto.js';
import {
  createPersistenceStore,
  DatabaseConfigurationError,
  PersistedSpreadsheetRecord,
  PersistenceStore,
  StoredAppUser,
  StoredCustomerRecord,
  StoredDriveFileRef,
  StoredEmailLog,
  StoredInvoiceRecord,
  StoredOAuthConnection,
  StoredQuotationRecord,
  StoredSession,
  StoredSmtpConfig,
  StoredWorkspaceState,
  SyncHistoryEntry,
} from './db.js';
import {
  DRIVE_SUBFOLDER_KEYS,
  DriveFileSummary,
  DriveTransportAdapter,
  mergeTimestampedRecords,
} from './driveService.js';
import {
  buildGmailRawMimeMessage,
  EmailTransportAdapter,
} from './emailBackendService.js';
import { GoogleTransportAdapter, HttpApiError } from './googleService.js';
import {
  handleAuthDisconnect,
  handleAuthStatus,
  handleDriveBackup,
  handleDriveRestore,
  handleDriveStatus,
  handleDriveSync,
  handleDriveUploadPdf,
  handleEmailHistory,
  handleEmailSend,
  handleGoogleAuthCallback,
  handleGoogleAuthStart,
  handleInvoices,
  handleQuotations,
  handleSheetsData,
  handleSheetsMetadata,
  handleSheetsSync,
  handleSheetsValues,
  handleSmtpConfig,
  handleSmtpTest,
  handleWorkspace,
  HandlerRuntimeDeps,
} from './handlers.js';
import { NormalizedRequest, NormalizedResponse } from './http.js';
import {
  buildSheetRange,
  extractSpreadsheetId,
  normalizeSheetValues,
} from './sheetsNormalization.js';

const TEST_CONFIG: AppServerConfig = {
  googleClientId: 'test-client-id.apps.googleusercontent.com',
  googleClientSecret: 'test-client-secret-value',
  googleRedirectUri: 'http://localhost:3000/api/auth/google/callback',
  sessionSecret: 'test_session_secret_at_least_32_characters_long',
  tokenEncryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  databaseUrl: 'postgres://test:test@localhost:5432/test',
  appUrl: 'http://localhost:3000',
  isProduction: false,
};

/**
 * Explicit test-only PersistenceStore implementing strict userId isolation
 * for unit/integration verification of multi-user auth, Drive, Sheets,
 * Quotations, Invoices, and Dual Gmail/SMTP email flows.
 */
class TestPersistenceStore implements PersistenceStore {
  public users = new Map<string, StoredAppUser>();
  public sessions = new Map<string, StoredSession>();
  public connections = new Map<string, StoredOAuthConnection>();
  public workspaces = new Map<string, StoredWorkspaceState>();
  public customers = new Map<string, StoredCustomerRecord>();
  public quotations = new Map<string, StoredQuotationRecord>();
  public invoices = new Map<string, StoredInvoiceRecord>();
  public driveFiles = new Map<string, StoredDriveFileRef>();
  public smtpConfigs = new Map<string, StoredSmtpConfig>();
  public emailLogs: StoredEmailLog[] = [];
  public spreadsheets = new Map<string, PersistedSpreadsheetRecord>();
  public rowHashes = new Map<string, Map<string, string>>();
  public history: SyncHistoryEntry[] = [];

  async upsertAppUser(params: {
    userId: string;
    email: string;
    name: string | null;
    picture: string | null;
  }): Promise<StoredAppUser> {
    const existing = this.users.get(params.userId);
    const now = new Date().toISOString();
    const user: StoredAppUser = {
      userId: params.userId,
      email: params.email,
      name: params.name,
      picture: params.picture,
      onboardingCompleted: existing?.onboardingCompleted ?? false,
      driveRootFolderId: existing?.driveRootFolderId ?? null,
      driveSubfolders: existing?.driveSubfolders ?? {},
      driveLastSyncAt: existing?.driveLastSyncAt ?? null,
      driveSyncStatus: existing?.driveSyncStatus ?? null,
      driveLastError: existing?.driveLastError ?? null,
      createdAt: existing?.createdAt ?? now,
      lastLoginAt: now,
    };
    this.users.set(params.userId, user);
    return user;
  }

  async getAppUser(userId: string): Promise<StoredAppUser | null> {
    return this.users.get(userId) || null;
  }

  async updateAppUserOnboarding(userId: string, completed: boolean): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.onboardingCompleted = completed;
  }

  async updateAppUserDriveState(
    userId: string,
    patch: {
      driveRootFolderId?: string | null;
      driveSubfolders?: Record<string, string>;
      driveLastSyncAt?: string | null;
      driveSyncStatus?: string | null;
      driveLastError?: string | null;
    }
  ): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    if (patch.driveRootFolderId !== undefined) u.driveRootFolderId = patch.driveRootFolderId;
    if (patch.driveSubfolders !== undefined) u.driveSubfolders = patch.driveSubfolders;
    if (patch.driveLastSyncAt !== undefined) u.driveLastSyncAt = patch.driveLastSyncAt;
    if (patch.driveSyncStatus !== undefined) u.driveSyncStatus = patch.driveSyncStatus;
    if (patch.driveLastError !== undefined) u.driveLastError = patch.driveLastError;
  }

  async createSession(
    sessionId: string,
    userId: string,
    expiresAtIso: string
  ): Promise<StoredSession> {
    const sess: StoredSession = {
      sessionId,
      userId,
      expiresAt: expiresAtIso,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, sess);
    return sess;
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    const sess = this.sessions.get(sessionId);
    if (!sess) return null;
    if (Date.parse(sess.expiresAt) <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return sess;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    for (const [sid, sess] of this.sessions.entries()) {
      if (sess.userId === userId) this.sessions.delete(sid);
    }
  }

  async getOAuthConnection(userId: string): Promise<StoredOAuthConnection | null> {
    return this.connections.get(userId) || null;
  }

  async upsertOAuthConnection(conn: {
    userId: string;
    googleSub: string;
    email: string;
    name: string | null;
    picture: string | null;
    scopes: string;
    encryptedRefreshToken: string | null;
    encryptedAccessToken: string | null;
    accessTokenExpiresAt: string | null;
  }): Promise<StoredOAuthConnection> {
    const existing = this.connections.get(conn.userId);
    const now = new Date().toISOString();
    const record: StoredOAuthConnection = {
      userId: conn.userId,
      googleSub: conn.googleSub,
      email: conn.email,
      name: conn.name,
      picture: conn.picture,
      scopes: conn.scopes,
      encryptedRefreshToken: conn.encryptedRefreshToken ?? existing?.encryptedRefreshToken ?? null,
      encryptedAccessToken: conn.encryptedAccessToken,
      accessTokenExpiresAt: conn.accessTokenExpiresAt,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.connections.set(conn.userId, record);
    return record;
  }

  async updateOAuthScopes(userId: string, scopes: string): Promise<void> {
    const existing = this.connections.get(userId);
    if (existing) {
      existing.scopes = scopes;
      existing.updatedAt = new Date().toISOString();
    }
  }

  async deleteOAuthConnection(userId: string): Promise<void> {
    this.connections.delete(userId);
  }

  async getWorkspaceState(userId: string): Promise<StoredWorkspaceState | null> {
    return this.workspaces.get(userId) || null;
  }

  async upsertWorkspaceState(
    userId: string,
    patch: {
      companySettings?: any;
      template?: any;
      fields?: any[];
      calculationSettings?: any;
      preferences?: Record<string, any>;
    }
  ): Promise<StoredWorkspaceState> {
    const existing = this.workspaces.get(userId);
    const state: StoredWorkspaceState = {
      userId,
      companySettings:
        patch.companySettings !== undefined
          ? patch.companySettings
          : (existing?.companySettings ?? null),
      template: patch.template !== undefined ? patch.template : (existing?.template ?? null),
      fields: patch.fields !== undefined ? patch.fields : (existing?.fields ?? null),
      calculationSettings:
        patch.calculationSettings !== undefined
          ? patch.calculationSettings
          : (existing?.calculationSettings ?? null),
      preferences:
        patch.preferences !== undefined
          ? { ...(existing?.preferences || {}), ...patch.preferences }
          : (existing?.preferences || {}),
      updatedAt: new Date().toISOString(),
      version: (existing?.version || 0) + 1,
    };
    this.workspaces.set(userId, state);
    return state;
  }

  async listCustomers(userId: string): Promise<StoredCustomerRecord[]> {
    return Array.from(this.customers.values()).filter((c) => c.userId === userId);
  }

  async upsertCustomer(userId: string, id: string, data: any): Promise<StoredCustomerRecord> {
    const existing = this.customers.get(id);
    if (existing && existing.userId !== userId) {
      throw new Error('Forbidden: customer belongs to another user.');
    }
    const rec: StoredCustomerRecord = {
      id,
      userId,
      data,
      updatedAt: new Date().toISOString(),
    };
    this.customers.set(id, rec);
    return rec;
  }

  async deleteCustomer(userId: string, id: string): Promise<boolean> {
    const existing = this.customers.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.customers.delete(id);
    return true;
  }

  async listQuotations(userId: string): Promise<StoredQuotationRecord[]> {
    return Array.from(this.quotations.values()).filter((q) => q.userId === userId);
  }

  async getQuotation(userId: string, id: string): Promise<StoredQuotationRecord | null> {
    const q = this.quotations.get(id);
    return q && q.userId === userId ? q : null;
  }

  async upsertQuotation(userId: string, rec: any): Promise<StoredQuotationRecord> {
    const existing = this.quotations.get(rec.id);
    if (existing && existing.userId !== userId) {
      throw new Error('Forbidden: quotation belongs to another user.');
    }
    const now = new Date().toISOString();
    const saved: StoredQuotationRecord = {
      id: rec.id,
      userId,
      quotationNumber: rec.quotationNumber,
      status: rec.status,
      customerName: rec.customerName,
      totalAmount: rec.totalAmount,
      validUntil: rec.validUntil,
      convertedInvoiceId: rec.convertedInvoiceId ?? existing?.convertedInvoiceId ?? null,
      convertedInvoiceNumber:
        rec.convertedInvoiceNumber ?? existing?.convertedInvoiceNumber ?? null,
      convertedAt: rec.convertedAt ?? existing?.convertedAt ?? null,
      driveFileId: rec.driveFileId ?? existing?.driveFileId ?? null,
      pdfDriveFileId: rec.pdfDriveFileId ?? existing?.pdfDriveFileId ?? null,
      data: rec.data,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.quotations.set(rec.id, saved);
    return saved;
  }

  async deleteQuotation(userId: string, id: string): Promise<boolean> {
    const existing = this.quotations.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.quotations.delete(id);
    return true;
  }

  async listInvoices(userId: string): Promise<StoredInvoiceRecord[]> {
    return Array.from(this.invoices.values()).filter((inv) => inv.userId === userId);
  }

  async getInvoice(userId: string, id: string): Promise<StoredInvoiceRecord | null> {
    const inv = this.invoices.get(id);
    return inv && inv.userId === userId ? inv : null;
  }

  async upsertInvoice(userId: string, rec: any): Promise<StoredInvoiceRecord> {
    const existing = this.invoices.get(rec.id);
    if (existing && existing.userId !== userId) {
      throw new Error('Forbidden: invoice belongs to another user.');
    }
    const now = new Date().toISOString();
    const saved: StoredInvoiceRecord = {
      id: rec.id,
      userId,
      invoiceNumber: rec.invoiceNumber,
      sourceType: rec.sourceType,
      sourceQuotationId: rec.sourceQuotationId ?? existing?.sourceQuotationId ?? null,
      sourceQuotationNumber: rec.sourceQuotationNumber ?? existing?.sourceQuotationNumber ?? null,
      customerName: rec.customerName,
      totalAmount: rec.totalAmount,
      paymentStatus: rec.paymentStatus,
      driveFileId: rec.driveFileId ?? existing?.driveFileId ?? null,
      pdfDriveFileId: rec.pdfDriveFileId ?? existing?.pdfDriveFileId ?? null,
      data: rec.data,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.invoices.set(rec.id, saved);
    return saved;
  }

  async deleteInvoice(userId: string, id: string): Promise<boolean> {
    const existing = this.invoices.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.invoices.delete(id);
    return true;
  }

  async listDriveFiles(userId: string): Promise<StoredDriveFileRef[]> {
    return Array.from(this.driveFiles.values()).filter((f) => f.userId === userId);
  }

  async getDriveFileRef(
    userId: string,
    entityType: string,
    entityId: string
  ): Promise<StoredDriveFileRef | null> {
    return this.driveFiles.get(`${userId}::${entityType}::${entityId}`) || null;
  }

  async upsertDriveFileRef(ref: {
    id: string;
    userId: string;
    entityType: string;
    entityId: string;
    folderKey: string;
    fileName: string;
    driveFileId: string;
    mimeType: string;
  }): Promise<StoredDriveFileRef> {
    const saved: StoredDriveFileRef = {
      ...ref,
      updatedAt: new Date().toISOString(),
    };
    this.driveFiles.set(`${ref.userId}::${ref.entityType}::${ref.entityId}`, saved);
    return saved;
  }

  async getSmtpConfig(userId: string): Promise<StoredSmtpConfig | null> {
    return this.smtpConfigs.get(userId) || null;
  }

  async upsertSmtpConfig(cfg: any): Promise<StoredSmtpConfig> {
    const existing = this.smtpConfigs.get(cfg.userId);
    const saved: StoredSmtpConfig = {
      userId: cfg.userId,
      host: cfg.host,
      port: cfg.port,
      securityMode: cfg.securityMode,
      username: cfg.username,
      encryptedPassword:
        cfg.encryptedPassword !== undefined
          ? cfg.encryptedPassword
          : (existing?.encryptedPassword ?? null),
      senderName: cfg.senderName,
      senderEmail: cfg.senderEmail,
      verifiedAt: cfg.verifiedAt !== undefined ? cfg.verifiedAt : (existing?.verifiedAt ?? null),
      updatedAt: new Date().toISOString(),
    };
    this.smtpConfigs.set(cfg.userId, saved);
    return saved;
  }

  async insertEmailLog(entry: Omit<StoredEmailLog, 'createdAt'>): Promise<StoredEmailLog> {
    const saved: StoredEmailLog = {
      ...entry,
      createdAt: new Date().toISOString(),
    };
    this.emailLogs.unshift(saved);
    return saved;
  }

  async listEmailLogs(userId: string, limit = 100): Promise<StoredEmailLog[]> {
    return this.emailLogs.filter((l) => l.userId === userId).slice(0, limit);
  }

  async getRowHashesForSpreadsheet(
    userId: string,
    spreadsheetId: string
  ): Promise<Map<string, string>> {
    return new Map(this.rowHashes.get(`${userId}::${spreadsheetId}`) || []);
  }

  async saveSyncedSpreadsheetTransaction(params: any): Promise<PersistedSpreadsheetRecord> {
    const key = `${params.userId}::${params.spreadsheetId}`;
    const totalRows = params.worksheets.reduce((acc: number, ws: any) => acc + ws.rows.length, 0);
    const saved: PersistedSpreadsheetRecord = {
      id: key,
      userId: params.userId,
      spreadsheetId: params.spreadsheetId,
      spreadsheetUrl: params.spreadsheetUrl,
      title: params.title,
      selectedSheetName: params.selectedSheetName,
      selectedRange: params.selectedRange,
      headerRowIndex: params.headerRowIndex,
      sheetsMeta: params.sheetsMeta,
      worksheets: params.worksheets,
      totalRows,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: params.syncStatus,
      lastSyncStats: params.stats,
    };
    this.spreadsheets.set(key, saved);

    const hashes = new Map<string, string>();
    for (const grp of params.syncedRowRecords) {
      for (const rec of grp.records) {
        hashes.set(`${key}::${grp.sheetName}::${rec.rowKey}`, rec.rowHash);
      }
    }
    this.rowHashes.set(key, hashes);

    this.history.unshift({
      id: params.logId,
      userId: params.userId,
      spreadsheetId: params.spreadsheetId,
      spreadsheetTitle: params.title,
      sheetName: params.selectedSheetName,
      status: params.syncStatus,
      rowsRetrieved: params.stats.rowsRetrieved,
      createdCount: params.stats.createdCount,
      updatedCount: params.stats.updatedCount,
      unchangedCount: params.stats.unchangedCount,
      skippedCount: params.stats.skippedCount,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    });
    return saved;
  }

  async recordSyncFailureLog(params: any): Promise<void> {
    this.history.unshift({
      id: params.logId,
      userId: params.userId,
      spreadsheetId: params.spreadsheetId,
      spreadsheetTitle: params.spreadsheetTitle,
      sheetName: params.sheetName,
      status: 'failed',
      rowsRetrieved: 0,
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      errorMessage: params.errorMessage,
      createdAt: new Date().toISOString(),
    });
  }

  async getLatestSyncedData(userId: string, spreadsheetId?: string) {
    let spreadsheet: PersistedSpreadsheetRecord | null = null;
    if (spreadsheetId) {
      spreadsheet = this.spreadsheets.get(`${userId}::${spreadsheetId}`) || null;
    } else {
      for (const rec of this.spreadsheets.values()) {
        if (rec.userId === userId) {
          spreadsheet = rec;
          break;
        }
      }
    }
    return {
      spreadsheet,
      history: this.history.filter((h) => h.userId === userId),
    };
  }
}

/**
 * In-memory DriveTransportAdapter simulating per-token Google Drive v3
 * folder/file creation, appProperties lookup, and updates without duplicates.
 */
class MockDriveTransport implements DriveTransportAdapter {
  private seq = 1;
  public files = new Map<
    string,
    DriveFileSummary & { ownerToken: string; content: string }
  >();

  async findFile({
    accessToken,
    name,
    parentId,
    mimeType,
    appPropertyKey,
    appPropertyValue,
  }: any): Promise<DriveFileSummary | null> {
    for (const f of this.files.values()) {
      if (f.ownerToken !== accessToken) continue;
      if (name && f.name !== name) continue;
      if (parentId && !(f.parents || []).includes(parentId)) continue;
      if (mimeType && f.mimeType !== mimeType) continue;
      if (appPropertyKey && appPropertyValue) {
        if (f.appProperties?.[appPropertyKey] !== appPropertyValue) continue;
      }
      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        parents: f.parents,
        appProperties: f.appProperties,
      };
    }
    return null;
  }

  async getFileMetadata({ accessToken, fileId }: any): Promise<DriveFileSummary | null> {
    const f = this.files.get(fileId);
    if (!f || f.ownerToken !== accessToken) return null;
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      parents: f.parents,
      appProperties: f.appProperties,
    };
  }

  async createFolder({
    accessToken,
    name,
    parentId,
    appProperties,
  }: any): Promise<DriveFileSummary> {
    const id = `drv_folder_${this.seq++}`;
    const entry = {
      id,
      name,
      mimeType: 'application/vnd.google-apps.folder',
      modifiedTime: new Date().toISOString(),
      parents: parentId ? [parentId] : undefined,
      appProperties: appProperties || {},
      ownerToken: accessToken,
      content: '',
    };
    this.files.set(id, entry);
    return entry;
  }

  async createOrUpdateFile({
    accessToken,
    existingFileId,
    name,
    parentId,
    mimeType,
    content,
    appProperties,
  }: any): Promise<DriveFileSummary> {
    const text = Buffer.isBuffer(content) ? content.toString('base64') : String(content);
    if (existingFileId && this.files.has(existingFileId)) {
      const existing = this.files.get(existingFileId)!;
      existing.name = name;
      existing.mimeType = mimeType;
      existing.content = text;
      existing.modifiedTime = new Date().toISOString();
      if (appProperties) {
        existing.appProperties = { ...(existing.appProperties || {}), ...appProperties };
      }
      return existing;
    }
    const id = `drv_file_${this.seq++}`;
    const entry = {
      id,
      name,
      mimeType,
      modifiedTime: new Date().toISOString(),
      parents: [parentId],
      appProperties: appProperties || {},
      ownerToken: accessToken,
      content: text,
    };
    this.files.set(id, entry);
    return entry;
  }

  async downloadFileText({ accessToken, fileId }: any): Promise<string> {
    const f = this.files.get(fileId);
    if (!f || f.ownerToken !== accessToken) {
      throw new HttpApiError(404, 'DRIVE_NOT_FOUND', 'Drive file not found');
    }
    return f.content;
  }
}

function createMockHttpPair(options: {
  method: string;
  url?: string;
  body?: any;
  cookieHeader?: string;
}) {
  const stream = new PassThrough() as any;
  stream.method = options.method;
  stream.url = options.url || '/';
  stream.headers = {
    host: 'localhost:3000',
    ...(options.cookieHeader ? { cookie: options.cookieHeader } : {}),
  };
  stream.body = options.body;

  const headersMap = new Map<string, string | string[]>();
  let responseBody: any = null;
  let statusCode = 200;

  const res: any = {
    statusCode: 200,
    setHeader(name: string, val: string | string[]) {
      headersMap.set(name.toLowerCase(), val);
    },
    getHeader(name: string) {
      return headersMap.get(name.toLowerCase());
    },
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      responseBody = payload;
    },
    end(raw?: string) {
      if (raw && !responseBody) {
        try {
          responseBody = JSON.parse(raw);
        } catch {
          responseBody = raw;
        }
      }
    },
  };

  return {
    req: stream as NormalizedRequest,
    res: res as NormalizedResponse,
    getResult: () => ({
      statusCode,
      body: responseBody,
      setCookies: (headersMap.get('set-cookie') as string[] | undefined) || [],
      location: headersMap.get('location') as string | undefined,
    }),
  };
}

function mergeCookies(existingCookieHeader: string, setCookieHeaders: string[]): string {
  const jar = new Map<string, string>();
  for (const part of existingCookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  for (const sc of setCookieHeaders) {
    const first = sc.split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0) {
      const k = first.slice(0, idx).trim();
      const v = first.slice(idx + 1).trim();
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function signInMockUser(
  deps: HandlerRuntimeDeps,
  code: string,
  feature: 'signin' | 'drive' | 'sheets' | 'gmail' = 'signin',
  existingCookies = ''
): Promise<string> {
  const startPair = createMockHttpPair({
    method: 'GET',
    url: `/api/auth/google/start?feature=${feature}`,
    cookieHeader: existingCookies,
  });
  await handleGoogleAuthStart(startPair.req, startPair.res, deps);
  const startOut = startPair.getResult();
  assert.strictEqual(startOut.statusCode, 200);
  let cookies = mergeCookies(existingCookies, startOut.setCookies);

  const cbPair = createMockHttpPair({
    method: 'POST',
    cookieHeader: cookies,
    body: { code, state: startOut.body.state, redirectUri: 'postmessage' },
  });
  await handleGoogleAuthCallback(cbPair.req, cbPair.res, deps);
  const cbOut = cbPair.getResult();
  assert.strictEqual(cbOut.statusCode, 200);
  cookies = mergeCookies(cookies, cbOut.setCookies);
  return cookies;
}

describe('Google OAuth, Multi-User Isolation, Drive, Sheets & Dual Email Backend Suite', () => {
  test('1. AES-256-GCM encryption roundtrip & tamper detection', () => {
    const secret = 'refresh_token_1//0gABCDEF_secret_value';
    const encrypted = encryptSecret(secret, TEST_CONFIG.tokenEncryptionKey);
    assert.ok(encrypted.startsWith('v1:'));
    assert.ok(!encrypted.includes(secret));
    assert.strictEqual(decryptSecret(encrypted, TEST_CONFIG.tokenEncryptionKey), secret);

    const tampered = encrypted.slice(0, -2) + 'xx';
    assert.throws(() => decryptSecret(tampered, TEST_CONFIG.tokenEncryptionKey));
    assert.throws(() => decryptSecret(encrypted, 'completely_different_encryption_key_32'));
  });

  test('2. HMAC signed cookie payload verification & expiration', () => {
    const signed = signPayload({ sid: 'sess_abc' }, TEST_CONFIG.sessionSecret, 60);
    const verified = verifySignedPayload<{ sid: string }>(signed, TEST_CONFIG.sessionSecret);
    assert.strictEqual(verified?.sid, 'sess_abc');

    const tamperedChar = signed[2] === 'A' ? 'B' : 'A';
    const tampered = signed.slice(0, 2) + tamperedChar + signed.slice(3);
    assert.strictEqual(verifySignedPayload(tampered, TEST_CONFIG.sessionSecret), null);

    const expired = signPayload({ sid: 'sess_old' }, TEST_CONFIG.sessionSecret, -10);
    assert.strictEqual(verifySignedPayload(expired, TEST_CONFIG.sessionSecret), null);
  });

  test('3. Database configuration fails explicitly without silent memory fallback', () => {
    assert.throws(() => createPersistenceStore(''), DatabaseConfigurationError);
  });

  test('4. Spreadsheet URL parsing, range sanitization, & leading-zero normalization', () => {
    assert.strictEqual(
      extractSpreadsheetId(
        'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'
      ),
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
    );
    assert.throws(() => extractSpreadsheetId('https://example.com/not-a-sheet'));

    assert.strictEqual(buildSheetRange("Q1 '26 Invoices", 'A2:H100'), "'Q1 ''26 Invoices'!A2:H100");
    assert.throws(() => buildSheetRange('Sheet1', 'INVALID!!RANGE'));

    const normalized = normalizeSheetValues('Invoices', [
      ['Monthly Report Export'],
      ['Invoice Number', 'Customer', 'Amount', 'Amount'],
      ['00042', 'Apex Ltd', '12500.00', '12500.00'],
      ['', '', '', ''],
      ['00043', 'Zenith Corp', '8400.50', '8400.50'],
    ]);

    assert.strictEqual(normalized.worksheet.headerRowIndex, 1);
    assert.deepStrictEqual(normalized.worksheet.headers, [
      'Invoice Number',
      'Customer',
      'Amount',
      'Amount (2)',
    ]);
    assert.strictEqual(normalized.worksheet.rows.length, 2);
    assert.strictEqual(normalized.worksheet.skippedEmptyRows, 1);
    assert.strictEqual(normalized.worksheet.rows[0]['Invoice Number'], '00042');
  });

  test('5. Incremental OAuth scopes, token refresh, Sheets sync diff, reload recovery, & disconnect', async () => {
    const store = new TestPersistenceStore();
    const revokedTokens: string[] = [];
    let refreshCallCount = 0;
    let sheetRows: any[][] = [
      ['Invoice Number', 'Customer Name', 'Amount'],
      ['00101', 'Alpha Corp', '10000'],
      ['00102', 'Beta LLC', '20000'],
      ['00103', 'Gamma Inc', '30000'],
    ];

    const transport: GoogleTransportAdapter = {
      async exchangeAuthCode({ code }) {
        const scopes =
          code === 'code_sheets'
            ? [...BASE_GOOGLE_SCOPES, GOOGLE_SHEETS_SCOPE].join(' ')
            : BASE_GOOGLE_SCOPES.join(' ');
        return {
          tokens: {
            access_token: `access_tok_${code}`,
            refresh_token: 'refresh_tok_secret_xyz',
            expiry_date: Date.now() + 3600 * 1000,
            scope: scopes,
          },
          identity: {
            sub: 'google_sub_001',
            email: 'finance@company.test',
            name: 'Finance Admin',
            picture: 'https://example.com/avatar.png',
          },
        };
      },
      async refreshAccessToken({ refreshToken }) {
        refreshCallCount += 1;
        assert.strictEqual(refreshToken, 'refresh_tok_secret_xyz');
        return {
          access_token: 'access_tok_refreshed',
          expiry_date: Date.now() + 3600 * 1000,
        };
      },
      async revokeToken(token) {
        revokedTokens.push(token);
      },
      async fetchSpreadsheetMetadata({ spreadsheetId }) {
        return {
          spreadsheetId,
          title: 'Q4 Invoice Master',
          sheets: [{ sheetId: 0, title: 'Invoices', index: 0, rowCount: 1000, columnCount: 20 }],
        };
      },
      async fetchSheetValues() {
        return sheetRows;
      },
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      getStore: () => store,
      transport,
    };

    // Step A: Basic sign-in grants only openid/email/profile
    let cookieJar = await signInMockUser(deps, 'code_signin', 'signin');

    // Forged state rejected (403)
    const badStatePair = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookieJar,
      body: { code: 'code_signin', state: 'forged_state', redirectUri: 'postmessage' },
    });
    await handleGoogleAuthCallback(badStatePair.req, badStatePair.res, deps);
    assert.strictEqual(badStatePair.getResult().statusCode, 403);

    // Step B: Calling Sheets without sheets scope returns 403 SHEETS_SCOPE_REQUIRED
    const noScopePair = createMockHttpPair({
      method: 'GET',
      url: '/api/sheets/metadata?spreadsheetUrl=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      cookieHeader: cookieJar,
    });
    await handleSheetsMetadata(noScopePair.req, noScopePair.res, deps);
    assert.strictEqual(noScopePair.getResult().statusCode, 403);
    assert.strictEqual(noScopePair.getResult().body.code, 'SHEETS_SCOPE_REQUIRED');

    // Step C: Incrementally authorize Sheets scope
    cookieJar = await signInMockUser(deps, 'code_sheets', 'sheets', cookieJar);

    // Confirm encrypted storage in DB
    const storedConn = store.connections.get('google_sub_001');
    assert.ok(storedConn);
    assert.ok(storedConn.encryptedRefreshToken?.startsWith('v1:'));
    assert.ok(!storedConn.encryptedRefreshToken?.includes('refresh_tok_secret_xyz'));

    // Step D: Force access token expiry -> metadata auto-refreshes
    storedConn.accessTokenExpiresAt = new Date(Date.now() - 60000).toISOString();
    const metaPair = createMockHttpPair({
      method: 'GET',
      url: '/api/sheets/metadata?spreadsheetUrl=https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      cookieHeader: cookieJar,
    });
    await handleSheetsMetadata(metaPair.req, metaPair.res, deps);
    assert.strictEqual(metaPair.getResult().statusCode, 200);
    assert.strictEqual(refreshCallCount, 1);

    // Step E: Values preview & initial sync
    const valuesPair = createMockHttpPair({
      method: 'GET',
      url: '/api/sheets/values?spreadsheetUrl=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms&sheetName=Invoices',
      cookieHeader: cookieJar,
    });
    await handleSheetsValues(valuesPair.req, valuesPair.res, deps);
    assert.strictEqual(valuesPair.getResult().statusCode, 200);
    assert.strictEqual(valuesPair.getResult().body.rowsCount, 3);

    const syncPair1 = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookieJar,
      body: {
        spreadsheetUrl: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        sheetName: 'Invoices',
      },
    });
    await handleSheetsSync(syncPair1.req, syncPair1.res, deps);
    assert.strictEqual(syncPair1.getResult().statusCode, 200);
    assert.strictEqual(syncPair1.getResult().body.stats.createdCount, 3);

    // Step F: Re-sync unchanged -> 'no_changes'
    const syncPair2 = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookieJar,
      body: {
        spreadsheetUrl: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        sheetName: 'Invoices',
      },
    });
    await handleSheetsSync(syncPair2.req, syncPair2.res, deps);
    assert.strictEqual(syncPair2.getResult().body.status, 'no_changes');

    // Step G: Modify 1 row + add 1 row
    sheetRows = [
      ['Invoice Number', 'Customer Name', 'Amount'],
      ['00101', 'Alpha Corp', '10000'],
      ['00102', 'Beta LLC', '25000'],
      ['00103', 'Gamma Inc', '30000'],
      ['00104', 'Delta Studio', '12000'],
    ];
    const syncPair3 = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookieJar,
      body: {
        spreadsheetUrl: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        sheetName: 'Invoices',
      },
    });
    await handleSheetsSync(syncPair3.req, syncPair3.res, deps);
    assert.strictEqual(syncPair3.getResult().body.stats.createdCount, 1);
    assert.strictEqual(syncPair3.getResult().body.stats.updatedCount, 1);

    // Step H: Failed sync preserves previously persisted valid rows
    const failSyncPair = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookieJar,
      body: {
        spreadsheetUrl: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        sheetName: 'Invoices',
      },
    });
    await handleSheetsSync(failSyncPair.req, failSyncPair.res, {
      ...deps,
      transport: {
        ...transport,
        async fetchSheetValues() {
          throw new HttpApiError(403, 'GOOGLE_PERMISSION_DENIED', 'Permission denied');
        },
      },
    });
    assert.strictEqual(failSyncPair.getResult().statusCode, 403);

    const postFailReload = createMockHttpPair({ method: 'GET', cookieHeader: cookieJar });
    await handleSheetsData(postFailReload.req, postFailReload.res, deps);
    assert.strictEqual(postFailReload.getResult().body.spreadsheet.totalRows, 4);

    // Step I: Full Disconnect revokes token & clears session
    const discPair = createMockHttpPair({ method: 'POST', cookieHeader: cookieJar, body: {} });
    await handleAuthDisconnect(discPair.req, discPair.res, deps);
    assert.strictEqual(discPair.getResult().statusCode, 200);
    assert.ok(revokedTokens.includes('refresh_tok_secret_xyz'));
    assert.strictEqual(store.connections.size, 0);

    cookieJar = mergeCookies(cookieJar, discPair.getResult().setCookies);
    const statusAfter = createMockHttpPair({ method: 'GET', cookieHeader: cookieJar });
    await handleAuthStatus(statusAfter.req, statusAfter.res, deps);
    assert.strictEqual(statusAfter.getResult().body.authenticated, false);
  });

  test('6. Strict Multi-User Data Isolation & Server-Gated Quotation-to-Invoice Conversion', async () => {
    const store = new TestPersistenceStore();
    const transport: GoogleTransportAdapter = {
      async exchangeAuthCode({ code }) {
        const isA = code === 'user_a_code';
        return {
          tokens: {
            access_token: isA ? 'tok_user_a' : 'tok_user_b',
            refresh_token: isA ? 'ref_user_a' : 'ref_user_b',
            expiry_date: Date.now() + 3600 * 1000,
            scope: BASE_GOOGLE_SCOPES.join(' '),
          },
          identity: isA
            ? { sub: 'sub_user_a', email: 'alice@alpha.test', name: 'Alice', picture: null }
            : { sub: 'sub_user_b', email: 'bob@beta.test', name: 'Bob', picture: null },
        };
      },
      async refreshAccessToken() {
        return { access_token: 'refreshed', expiry_date: Date.now() + 3600 * 1000 };
      },
      async revokeToken() {},
      async fetchSpreadsheetMetadata() {
        return { spreadsheetId: 's', title: 't', sheets: [] };
      },
      async fetchSheetValues() {
        return [];
      },
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      getStore: () => store,
      transport,
    };

    // Sign in User A & create private quotation, customer, and invoice
    const cookiesA = await signInMockUser(deps, 'user_a_code', 'signin');

    const saveCustA = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesA,
      body: { customer: { id: 'cust_a1', customerName: 'Alice Secret Client' } },
    });
    await handleWorkspace(saveCustA.req, saveCustA.res, deps);
    assert.strictEqual(saveCustA.getResult().statusCode, 200);

    const saveQtA = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesA,
      body: {
        quotation: {
          id: 'qt_a1',
          quotationNumber: 'QT-2026-001',
          status: 'Draft',
          customerName: 'Alice Secret Client',
          totalAmount: 11800,
          validUntilDate: '2099-12-31',
          approvalHistory: [],
        },
      },
    });
    await handleQuotations(saveQtA.req, saveQtA.res, [], deps);
    assert.strictEqual(saveQtA.getResult().statusCode, 200);

    // Server MUST block converting a Draft quotation
    const blockConvertDraft = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesA,
      body: {
        invoice: {
          id: 'inv_a1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Alice Secret Client',
          totalAmount: 11800,
          paymentStatus: 'Unpaid',
        },
      },
    });
    await handleQuotations(blockConvertDraft.req, blockConvertDraft.res, ['qt_a1', 'convert'], deps);
    assert.strictEqual(blockConvertDraft.getResult().statusCode, 403);

    // Approve quotation then convert -> succeeds!
    const approveQtA = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesA,
      body: { status: 'Approved', notes: 'Approved by CFO' },
    });
    await handleQuotations(approveQtA.req, approveQtA.res, ['qt_a1', 'status'], deps);
    assert.strictEqual(approveQtA.getResult().statusCode, 200);
    assert.strictEqual(approveQtA.getResult().body.quotation.status, 'Approved');

    const convertQtA = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesA,
      body: {
        invoice: {
          id: 'inv_a1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Alice Secret Client',
          totalAmount: 11800,
          paymentStatus: 'Unpaid',
        },
      },
    });
    await handleQuotations(convertQtA.req, convertQtA.res, ['qt_a1', 'convert'], deps);
    assert.strictEqual(convertQtA.getResult().statusCode, 200);
    assert.strictEqual(convertQtA.getResult().body.quotation.status, 'Converted to Invoice');
    assert.strictEqual(convertQtA.getResult().body.invoice.sourceQuotationId, 'qt_a1');

    // Duplicate conversion MUST be blocked (409)
    const dupConvert = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesA,
      body: { invoice: { id: 'inv_a2', invoiceNumber: 'INV-2026-002' } },
    });
    await handleQuotations(dupConvert.req, dupConvert.res, ['qt_a1', 'convert'], deps);
    assert.strictEqual(dupConvert.getResult().statusCode, 409);

    // Sign in User B (completely separate Google sub)
    const cookiesB = await signInMockUser(deps, 'user_b_code', 'signin');

    // User B workspace MUST be completely empty (0 customers, 0 quotations, 0 invoices)
    const wsB = createMockHttpPair({ method: 'GET', cookieHeader: cookiesB });
    await handleWorkspace(wsB.req, wsB.res, deps);
    assert.strictEqual(wsB.getResult().statusCode, 200);
    assert.strictEqual(wsB.getResult().body.customers.length, 0);
    assert.strictEqual(wsB.getResult().body.quotations.length, 0);
    assert.strictEqual(wsB.getResult().body.invoices.length, 0);

    // User B attempting direct access / delete / overwrite of User A's IDs MUST fail
    const getQtAAsB = createMockHttpPair({ method: 'GET', cookieHeader: cookiesB });
    await handleQuotations(getQtAAsB.req, getQtAAsB.res, ['qt_a1'], deps);
    assert.strictEqual(getQtAAsB.getResult().statusCode, 404);

    const delQtAAsB = createMockHttpPair({ method: 'DELETE', cookieHeader: cookiesB });
    await handleQuotations(delQtAAsB.req, delQtAAsB.res, ['qt_a1'], deps);
    assert.strictEqual(delQtAAsB.getResult().statusCode, 404);

    const overwriteQtAAsB = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookiesB,
      body: { quotation: { id: 'qt_a1', quotationNumber: 'HIJACK', status: 'Draft' } },
    });
    await handleQuotations(overwriteQtAAsB.req, overwriteQtAAsB.res, [], deps);
    assert.strictEqual(overwriteQtAAsB.getResult().statusCode, 403);

    const getInvAAsB = createMockHttpPair({ method: 'GET', cookieHeader: cookiesB });
    await handleInvoices(getInvAAsB.req, getInvAAsB.res, ['inv_a1'], deps);
    assert.strictEqual(getInvAAsB.getResult().statusCode, 404);

    // User A's data remains completely untouched
    const wsAAfter = createMockHttpPair({ method: 'GET', cookieHeader: cookiesA });
    await handleWorkspace(wsAAfter.req, wsAAfter.res, deps);
    assert.strictEqual(wsAAfter.getResult().body.customers.length, 1);
    assert.strictEqual(wsAAfter.getResult().body.quotations.length, 1);
    assert.strictEqual(wsAAfter.getResult().body.invoices.length, 1);
  });

  test('7. Per-User Google Drive Storage: 8 folders, idempotent sync (0 duplicates), PDF upload, backup & conflict-safe restore', async () => {
    const store = new TestPersistenceStore();
    const driveTransport = new MockDriveTransport();

    const transport: GoogleTransportAdapter = {
      async exchangeAuthCode({ code }) {
        const scopes =
          code === 'drive_code'
            ? [...BASE_GOOGLE_SCOPES, GOOGLE_DRIVE_SCOPE].join(' ')
            : BASE_GOOGLE_SCOPES.join(' ');
        return {
          tokens: {
            access_token: 'tok_drive_user',
            refresh_token: 'ref_drive_user',
            expiry_date: Date.now() + 3600 * 1000,
            scope: scopes,
          },
          identity: {
            sub: 'sub_drive_1',
            email: 'owner@drive.test',
            name: 'Drive Owner',
            picture: null,
          },
        };
      },
      async refreshAccessToken() {
        return { access_token: 'tok_drive_user', expiry_date: Date.now() + 3600 * 1000 };
      },
      async revokeToken() {},
      async fetchSpreadsheetMetadata() {
        return { spreadsheetId: 's', title: 't', sheets: [] };
      },
      async fetchSheetValues() {
        return [];
      },
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      getStore: () => store,
      transport,
      driveTransport,
    };

    // Sign in without drive scope -> sync blocked with 403 DRIVE_SCOPE_REQUIRED
    let cookies = await signInMockUser(deps, 'signin_only', 'signin');
    const blockedSync = createMockHttpPair({ method: 'POST', cookieHeader: cookies, body: {} });
    await handleDriveSync(blockedSync.req, blockedSync.res, deps);
    assert.strictEqual(blockedSync.getResult().statusCode, 403);
    assert.strictEqual(blockedSync.getResult().body.code, 'DRIVE_SCOPE_REQUIRED');

    // Grant Drive scope incrementally
    cookies = await signInMockUser(deps, 'drive_code', 'drive', cookies);

    // Seed workspace data
    await store.upsertWorkspaceState('sub_drive_1', {
      companySettings: { legalName: 'Drive Studio LLP', email: 'owner@drive.test' },
    });
    await store.upsertQuotation('sub_drive_1', {
      id: 'qt_drv_1',
      quotationNumber: 'QT-2026-010',
      status: 'Approved',
      customerName: 'Skyline Corp',
      totalAmount: 5000,
      validUntil: '2099-01-01',
      data: {
        id: 'qt_drv_1',
        quotationNumber: 'QT-2026-010',
        status: 'Approved',
        customerName: 'Skyline Corp',
        totalAmount: 5000,
        validUntilDate: '2099-01-01',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
    });

    // First sync creates root + all 8 subfolders + JSON files
    const sync1 = createMockHttpPair({ method: 'POST', cookieHeader: cookies, body: {} });
    await handleDriveSync(sync1.req, sync1.res, deps);
    assert.strictEqual(sync1.getResult().statusCode, 200);
    const totalAfterFirst = driveTransport.files.size;

    const statusPair = createMockHttpPair({ method: 'GET', cookieHeader: cookies });
    await handleDriveStatus(statusPair.req, statusPair.res, deps);
    assert.strictEqual(statusPair.getResult().body.connected, true);
    assert.strictEqual(
      Object.keys(statusPair.getResult().body.subfolders).length,
      Object.keys(DRIVE_SUBFOLDER_KEYS).length
    );

    // Second sync MUST update in place with ZERO duplicate folders or files
    const sync2 = createMockHttpPair({ method: 'POST', cookieHeader: cookies, body: {} });
    await handleDriveSync(sync2.req, sync2.res, deps);
    assert.strictEqual(sync2.getResult().statusCode, 200);
    assert.strictEqual(driveTransport.files.size, totalAfterFirst);

    // Upload PDF twice -> stable driveFileId, no duplicate PDFs
    const pdf1 = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookies,
      body: {
        documentType: 'quotation',
        documentId: 'qt_drv_1',
        fileName: 'QT-2026-010.pdf',
        pdfBase64: Buffer.from('%PDF-1.4 mock').toString('base64'),
      },
    });
    await handleDriveUploadPdf(pdf1.req, pdf1.res, deps);
    assert.strictEqual(pdf1.getResult().statusCode, 200);
    const pdfFileId = pdf1.getResult().body.driveFileId;

    const pdf2 = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookies,
      body: {
        documentType: 'quotation',
        documentId: 'qt_drv_1',
        fileName: 'QT-2026-010.pdf',
        pdfBase64: Buffer.from('%PDF-1.4 updated').toString('base64'),
      },
    });
    await handleDriveUploadPdf(pdf2.req, pdf2.res, deps);
    assert.strictEqual(pdf2.getResult().body.driveFileId, pdfFileId);

    // Create timestamped backup snapshot
    const backupPair = createMockHttpPair({ method: 'POST', cookieHeader: cookies, body: {} });
    await handleDriveBackup(backupPair.req, backupPair.res, deps);
    assert.strictEqual(backupPair.getResult().statusCode, 200);
    assert.ok(backupPair.getResult().body.fileName.startsWith('invoice-studio-backup-'));

    // Simulate brand-new device (clear DB quotations & workspace, then Restore from Drive)
    store.quotations.clear();
    store.workspaces.clear();

    const restorePair = createMockHttpPair({ method: 'POST', cookieHeader: cookies, body: {} });
    await handleDriveRestore(restorePair.req, restorePair.res, deps);
    assert.strictEqual(restorePair.getResult().statusCode, 200);
    assert.strictEqual(restorePair.getResult().body.quotationsRestored, 1);
    assert.strictEqual(store.quotations.get('qt_drv_1')?.quotationNumber, 'QT-2026-010');

    // Timestamp conflict-resolution check: newer local record must NOT be overwritten by older remote
    const merged = mergeTimestampedRecords(
      [{ id: '1', updatedAt: '2026-06-01T12:00:00Z', name: 'Newer Local' }],
      [{ id: '1', updatedAt: '2026-05-01T12:00:00Z', name: 'Older Remote' }]
    );
    assert.strictEqual(merged.merged[0].name, 'Newer Local');
    assert.strictEqual(merged.merged.length, 1);
  });

  test('8. Dual Email Delivery: Gmail API MIME+PDF, Encrypted SMTP, Explicit Method Enforcement & Bulk Isolation', async () => {
    const store = new TestPersistenceStore();
    const sentGmailCalls: any[] = [];
    const sentSmtpCalls: any[] = [];
    let smtpVerifyCalls = 0;

    const emailTransport: EmailTransportAdapter = {
      async sendViaGmail(params) {
        sentGmailCalls.push(params);
        return { messageId: `gmail_msg_${sentGmailCalls.length}` };
      },
      async verifySmtp() {
        smtpVerifyCalls += 1;
      },
      async sendViaSmtp(params) {
        if (params.to === 'bounce@fail.test') {
          throw new Error('550 Mailbox unavailable');
        }
        sentSmtpCalls.push(params);
        return { messageId: `smtp_msg_${sentSmtpCalls.length}` };
      },
    };

    const transport: GoogleTransportAdapter = {
      async exchangeAuthCode({ code }) {
        const scopes =
          code === 'gmail_code'
            ? [...BASE_GOOGLE_SCOPES, GOOGLE_GMAIL_SEND_SCOPE].join(' ')
            : BASE_GOOGLE_SCOPES.join(' ');
        return {
          tokens: {
            access_token: 'tok_email_user',
            refresh_token: 'ref_email_user',
            expiry_date: Date.now() + 3600 * 1000,
            scope: scopes,
          },
          identity: {
            sub: 'sub_email_1',
            email: 'sender@gmail.test',
            name: 'Sender User',
            picture: null,
          },
        };
      },
      async refreshAccessToken() {
        return { access_token: 'tok_email_user', expiry_date: Date.now() + 3600 * 1000 };
      },
      async revokeToken() {},
      async fetchSpreadsheetMetadata() {
        return { spreadsheetId: 's', title: 't', sheets: [] };
      },
      async fetchSheetValues() {
        return [];
      },
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      getStore: () => store,
      transport,
      emailTransport,
    };

    // RFC 2822 MIME builder sanity check (base64 PDF attachment + CC/BCC)
    const rawMime = buildGmailRawMimeMessage({
      from: 'sender@gmail.test',
      to: 'client@acme.test',
      cc: 'cc@acme.test',
      bcc: 'bcc@acme.test',
      subject: 'Quotation QT-001',
      textBody: 'Please see attached PDF.',
      attachment: {
        filename: 'QT-001.pdf',
        contentBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
      },
    });
    const decodedMime = Buffer.from(rawMime, 'base64url').toString('utf8');
    assert.ok(decodedMime.includes('To: client@acme.test'));
    assert.ok(decodedMime.includes('Cc: cc@acme.test'));
    assert.ok(decodedMime.includes('Bcc: bcc@acme.test'));
    assert.ok(decodedMime.includes('filename="QT-001.pdf"'));

    let cookies = await signInMockUser(deps, 'signin_only', 'signin');

    // Step A: Configure SMTP -> password encrypted at rest, NEVER returned in GET
    const saveSmtp = createMockHttpPair({
      method: 'PUT',
      cookieHeader: cookies,
      body: {
        host: 'smtp.company.test',
        port: 587,
        securityMode: 'STARTTLS',
        username: 'billing@company.test',
        password: 'super_secret_smtp_password',
        senderName: 'Billing Team',
        senderEmail: 'billing@company.test',
      },
    });
    await handleSmtpConfig(saveSmtp.req, saveSmtp.res, deps);
    assert.strictEqual(saveSmtp.getResult().statusCode, 200);
    assert.strictEqual(saveSmtp.getResult().body.smtpConfig.hasPassword, true);
    assert.strictEqual(saveSmtp.getResult().body.smtpConfig.password, undefined);

    const dbSmtp = store.smtpConfigs.get('sub_email_1');
    assert.ok(dbSmtp?.encryptedPassword?.startsWith('v1:'));
    assert.ok(!dbSmtp?.encryptedPassword?.includes('super_secret_smtp_password'));

    const testSmtp = createMockHttpPair({ method: 'POST', cookieHeader: cookies, body: {} });
    await handleSmtpTest(testSmtp.req, testSmtp.res, deps);
    assert.strictEqual(testSmtp.getResult().statusCode, 200);
    assert.strictEqual(smtpVerifyCalls, 1);

    // Step B: Explicit method enforcement — requesting 'gmail' WITHOUT gmail.send scope
    // MUST return 403 GMAIL_SCOPE_REQUIRED and MUST NOT silently fall back to configured SMTP!
    const gmailBlocked = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookies,
      body: {
        method: 'gmail',
        items: [
          {
            documentType: 'quotation',
            documentId: 'qt_1',
            documentNumber: 'QT-001',
            to: 'client@acme.test',
            subject: 'Quote',
            textBody: 'Attached',
          },
        ],
      },
    });
    await handleEmailSend(gmailBlocked.req, gmailBlocked.res, deps);
    assert.strictEqual(gmailBlocked.getResult().statusCode, 403);
    assert.strictEqual(gmailBlocked.getResult().body.code, 'GMAIL_SCOPE_REQUIRED');
    assert.strictEqual(sentSmtpCalls.length, 0);

    // Step C: Bulk SMTP send with 1 valid, 1 invalid email, and 1 failing SMTP recipient
    // Verify recipient isolation & error isolation
    const bulkSmtp = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookies,
      body: {
        method: 'smtp',
        items: [
          {
            documentType: 'invoice',
            documentId: 'inv_1',
            documentNumber: 'INV-001',
            to: 'client1@acme.test',
            subject: 'Invoice INV-001',
            textBody: 'Body 1',
            attachment: { filename: 'INV-001.pdf', contentBase64: 'JVBERi0xLjQ=' },
          },
          {
            documentType: 'invoice',
            documentId: 'inv_2',
            documentNumber: 'INV-002',
            to: 'not-an-email',
            subject: 'Invoice INV-002',
            textBody: 'Body 2',
          },
          {
            documentType: 'invoice',
            documentId: 'inv_3',
            documentNumber: 'INV-003',
            to: 'bounce@fail.test',
            subject: 'Invoice INV-003',
            textBody: 'Body 3',
          },
        ],
      },
    });
    await handleEmailSend(bulkSmtp.req, bulkSmtp.res, deps);
    assert.strictEqual(bulkSmtp.getResult().statusCode, 200);
    assert.strictEqual(bulkSmtp.getResult().body.sentCount, 1);
    assert.strictEqual(bulkSmtp.getResult().body.failedCount, 2);
    assert.strictEqual(sentSmtpCalls.length, 1);
    assert.strictEqual(sentSmtpCalls[0].to, 'client1@acme.test');

    // Step D: Grant Gmail send scope -> send Quotation via Gmail API
    cookies = await signInMockUser(deps, 'gmail_code', 'gmail', cookies);
    const gmailSend = createMockHttpPair({
      method: 'POST',
      cookieHeader: cookies,
      body: {
        method: 'gmail',
        items: [
          {
            documentType: 'quotation',
            documentId: 'qt_1',
            documentNumber: 'QT-001',
            to: 'buyer@client.test',
            cc: 'manager@client.test',
            subject: 'Quotation QT-001',
            textBody: 'Please approve.',
            attachment: { filename: 'QT-001.pdf', contentBase64: 'JVBERi0xLjQ=' },
          },
        ],
      },
    });
    await handleEmailSend(gmailSend.req, gmailSend.res, deps);
    assert.strictEqual(gmailSend.getResult().statusCode, 200);
    assert.strictEqual(gmailSend.getResult().body.sentCount, 1);
    assert.strictEqual(sentGmailCalls.length, 1);
    assert.ok(sentGmailCalls[0].from.includes('sender@gmail.test'));

    // Step E: Email History returns all 4 per-user logs (1 Gmail + 3 SMTP)
    const histPair = createMockHttpPair({ method: 'GET', cookieHeader: cookies });
    await handleEmailHistory(histPair.req, histPair.res, deps);
    assert.strictEqual(histPair.getResult().statusCode, 200);
    assert.strictEqual(histPair.getResult().body.logs.length, 4);
  });
});
