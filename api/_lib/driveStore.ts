/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppServerConfig } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import {
  defaultDriveTransport,
  DRIVE_ROOT_FOLDER_NAME,
  DRIVE_SUBFOLDER_KEYS,
  DriveFolderKey,
  DriveTransportAdapter,
  mergeTimestampedRecords,
} from './driveService.js';
import { HttpApiError } from './googleService.js';
import {
  NormalizedRowRecord,
  NormalizedWorksheet,
  SheetMetadataItem,
  SyncDiffStats,
} from './sheetsNormalization.js';

export interface StoredWorkspaceState {
  userId: string;
  onboardingCompleted: boolean;
  companySettings: any | null;
  template: any | null;
  fields: any[] | null;
  calculationSettings: any | null;
  preferences: Record<string, any>;
  driveLastSyncAt: string | null;
  driveSyncStatus: string | null;
  driveLastError: string | null;
  updatedAt: string;
  version: number;
}

export interface StoredCustomerRecord {
  id: string;
  userId: string;
  data: any;
  updatedAt: string;
}

export interface StoredQuotationRecord {
  id: string;
  userId: string;
  quotationNumber: string;
  status: string;
  customerName: string;
  totalAmount: number;
  validUntil: string;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber: string | null;
  convertedAt: string | null;
  driveFileId: string | null;
  pdfDriveFileId: string | null;
  data: any;
  createdAt: string;
  updatedAt: string;
}

export interface StoredInvoiceRecord {
  id: string;
  userId: string;
  invoiceNumber: string;
  sourceType: string;
  sourceQuotationId: string | null;
  sourceQuotationNumber: string | null;
  customerName: string;
  totalAmount: number;
  paymentStatus: string;
  driveFileId: string | null;
  pdfDriveFileId: string | null;
  data: any;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSmtpConfig {
  userId: string;
  host: string;
  port: number;
  securityMode: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  encryptedPassword: string | null;
  senderName: string;
  senderEmail: string;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface StoredEmailLog {
  id: string;
  userId: string;
  documentType: 'invoice' | 'quotation' | 'test';
  documentId: string;
  documentNumber: string;
  recipientEmail: string;
  cc: string;
  bcc: string;
  deliveryMethod: 'gmail' | 'smtp';
  senderEmail: string;
  subject: string;
  status: 'sent' | 'failed';
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface PersistedSpreadsheetRecord {
  id: string;
  userId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  selectedSheetName: string;
  selectedRange: string;
  headerRowIndex: number;
  sheetsMeta: SheetMetadataItem[];
  worksheets: NormalizedWorksheet[];
  totalRows: number;
  lastSyncAt: string;
  lastSyncStatus: 'synced' | 'no_changes' | 'failed';
  lastSyncStats: SyncDiffStats | null;
}

export interface SyncHistoryEntry {
  id: string;
  userId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  status: 'synced' | 'no_changes' | 'failed';
  rowsRetrieved: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  createdAt: string;
}

interface DriveSheetsStateFile {
  schemaVersion: 1;
  updatedAt: string;
  spreadsheets: Record<string, PersistedSpreadsheetRecord>;
  rowHashes: Record<string, Record<string, string>>;
  history: SyncHistoryEntry[];
}

export interface DriveFoldersResult {
  rootFolderId: string;
  subfolders: Record<DriveFolderKey, string>;
}

const DRIVE_FILES = {
  workspaceState: {
    folderKey: 'applicationData' as DriveFolderKey,
    fileName: 'workspace-state.json',
    entityType: 'workspace_state',
  },
  customers: {
    folderKey: 'applicationData' as DriveFolderKey,
    fileName: 'customers.json',
    entityType: 'customers_data',
  },
  quotations: {
    folderKey: 'applicationData' as DriveFolderKey,
    fileName: 'quotations.json',
    entityType: 'quotations_data',
  },
  invoices: {
    folderKey: 'applicationData' as DriveFolderKey,
    fileName: 'invoices.json',
    entityType: 'invoices_data',
  },
  sheetsState: {
    folderKey: 'applicationData' as DriveFolderKey,
    fileName: 'sheets-state.json',
    entityType: 'sheets_state',
  },
  smtpConfig: {
    folderKey: 'applicationData' as DriveFolderKey,
    fileName: 'smtp-config.enc.json',
    entityType: 'smtp_config',
  },
  emailLogs: {
    folderKey: 'emailRecords' as DriveFolderKey,
    fileName: 'email-logs.json',
    entityType: 'email_logs',
  },
} as const;

type DriveDataFileKey = keyof typeof DRIVE_FILES;

/**
 * Pure Google Drive Persistence Store.
 * Every user's data is isolated inside their own Google Drive under `Invoice Studio/`.
 * Zero Firebase. Zero PostgreSQL. Zero shared database.
 */
export class GoogleDriveStore {
  private readonly userId: string;
  private readonly accessToken: string;
  private readonly config: AppServerConfig;
  private readonly drive: DriveTransportAdapter;
  private cachedFolders: DriveFoldersResult | null = null;
  private cachedRootHint: string | null;
  private cachedFileIds = new Map<string, string>();

  constructor(params: {
    userId: string;
    accessToken: string;
    config: AppServerConfig;
    driveRootFolderIdHint?: string | null;
    driveTransport?: DriveTransportAdapter;
  }) {
    this.userId = params.userId;
    this.accessToken = params.accessToken;
    this.config = params.config;
    this.cachedRootHint = params.driveRootFolderIdHint || null;
    this.drive = params.driveTransport || defaultDriveTransport;
  }

  public getRootFolderId(): string | null {
    return this.cachedFolders?.rootFolderId || this.cachedRootHint;
  }

  /**
   * Ensures `Invoice Studio/` and the 5 standard subfolders exist in the user's Google Drive:
   * - Application Data/
   * - Company Assets/
   * - Generated PDFs/
   * - Email Records/
   * - Backups/
   */
  public async ensureFolders(): Promise<DriveFoldersResult> {
    if (this.cachedFolders) return this.cachedFolders;

    let rootFolderId: string | null = this.cachedRootHint;
    if (rootFolderId) {
      const meta = await this.drive.getFileMetadata({
        accessToken: this.accessToken,
        config: this.config,
        fileId: rootFolderId,
      });
      if (!meta) rootFolderId = null;
    }

    if (!rootFolderId) {
      const byProp = await this.drive.findFile({
        accessToken: this.accessToken,
        config: this.config,
        mimeType: 'application/vnd.google-apps.folder',
        appPropertyKey: 'invoiceStudioFolder',
        appPropertyValue: 'root',
      });
      if (byProp) {
        rootFolderId = byProp.id;
      } else {
        const byName = await this.drive.findFile({
          accessToken: this.accessToken,
          config: this.config,
          name: DRIVE_ROOT_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
        });
        if (byName) {
          rootFolderId = byName.id;
        } else {
          const created = await this.drive.createFolder({
            accessToken: this.accessToken,
            config: this.config,
            name: DRIVE_ROOT_FOLDER_NAME,
            appProperties: {
              app: 'invoice-studio',
              invoiceStudioFolder: 'root',
              ownerSub: this.userId,
            },
          });
          rootFolderId = created.id;
        }
      }
    }

    const subfolders = {} as Record<DriveFolderKey, string>;
    const entries = Object.entries(DRIVE_SUBFOLDER_KEYS) as Array<[DriveFolderKey, string]>;
    for (const [key, folderName] of entries) {
      let found = await this.drive.findFile({
        accessToken: this.accessToken,
        config: this.config,
        parentId: rootFolderId,
        mimeType: 'application/vnd.google-apps.folder',
        appPropertyKey: 'invoiceStudioFolder',
        appPropertyValue: key,
      });
      if (!found) {
        found = await this.drive.findFile({
          accessToken: this.accessToken,
          config: this.config,
          name: folderName,
          parentId: rootFolderId,
          mimeType: 'application/vnd.google-apps.folder',
        });
      }
      if (found) {
        subfolders[key] = found.id;
      } else {
        const created = await this.drive.createFolder({
          accessToken: this.accessToken,
          config: this.config,
          name: folderName,
          parentId: rootFolderId,
          appProperties: {
            app: 'invoice-studio',
            invoiceStudioFolder: key,
            ownerSub: this.userId,
          },
        });
        subfolders[key] = created.id;
      }
    }

    this.cachedRootHint = rootFolderId;
    this.cachedFolders = { rootFolderId, subfolders };
    return this.cachedFolders;
  }

  private async readJsonFile<T>(fileKey: DriveDataFileKey): Promise<{
    fileId: string | null;
    data: T | null;
    modifiedTime: string | null;
  }> {
    const spec = DRIVE_FILES[fileKey];
    const folders = await this.ensureFolders();
    const parentId = folders.subfolders[spec.folderKey];

    let fileId = this.cachedFileIds.get(fileKey) || null;
    let modifiedTime: string | null = null;

    if (!fileId) {
      let found = await this.drive.findFile({
        accessToken: this.accessToken,
        config: this.config,
        parentId,
        appPropertyKey: 'entityType',
        appPropertyValue: spec.entityType,
      });
      if (!found) {
        found = await this.drive.findFile({
          accessToken: this.accessToken,
          config: this.config,
          name: spec.fileName,
          parentId,
        });
      }
      if (!found) {
        return { fileId: null, data: null, modifiedTime: null };
      }
      fileId = found.id;
      modifiedTime = found.modifiedTime || null;
      this.cachedFileIds.set(fileKey, fileId);
    }

    const rawText = await this.drive.downloadFileText({
      accessToken: this.accessToken,
      config: this.config,
      fileId,
    });

    if (!rawText || !rawText.trim()) {
      return { fileId, data: null, modifiedTime };
    }

    try {
      const parsed = JSON.parse(rawText) as T;
      return { fileId, data: parsed, modifiedTime };
    } catch {
      throw new HttpApiError(
        500,
        'DRIVE_CORRUPTED_FILE',
        `Google Drive file "${spec.fileName}" contains invalid JSON. Your existing file was not overwritten; restore from a backup in Invoice Studio/Backups/.`
      );
    }
  }

  private async writeJsonFile(fileKey: DriveDataFileKey, payload: unknown): Promise<{
    fileId: string;
    modifiedTime: string;
  }> {
    const spec = DRIVE_FILES[fileKey];
    const folders = await this.ensureFolders();
    const parentId = folders.subfolders[spec.folderKey];

    let existingFileId = this.cachedFileIds.get(fileKey) || null;
    if (!existingFileId) {
      let found = await this.drive.findFile({
        accessToken: this.accessToken,
        config: this.config,
        parentId,
        appPropertyKey: 'entityType',
        appPropertyValue: spec.entityType,
      });
      if (!found) {
        found = await this.drive.findFile({
          accessToken: this.accessToken,
          config: this.config,
          name: spec.fileName,
          parentId,
        });
      }
      existingFileId = found?.id || null;
    }

    const saved = await this.drive.createOrUpdateFile({
      accessToken: this.accessToken,
      config: this.config,
      existingFileId,
      name: spec.fileName,
      parentId,
      mimeType: 'application/json',
      content: JSON.stringify(payload, null, 2),
      appProperties: {
        app: 'invoice-studio',
        entityType: spec.entityType,
        ownerSub: this.userId,
      },
    });

    this.cachedFileIds.set(fileKey, saved.id);
    return {
      fileId: saved.id,
      modifiedTime: saved.modifiedTime || new Date().toISOString(),
    };
  }

  // ---------------- WORKSPACE STATE ----------------

  public async getWorkspaceState(): Promise<StoredWorkspaceState | null> {
    const { data } = await this.readJsonFile<StoredWorkspaceState>('workspaceState');
    if (!data) return null;
    return {
      userId: this.userId,
      onboardingCompleted: Boolean(data.onboardingCompleted),
      companySettings: data.companySettings ?? null,
      template: data.template ?? null,
      fields: data.fields ?? null,
      calculationSettings: data.calculationSettings ?? null,
      preferences: data.preferences || {},
      driveLastSyncAt: data.driveLastSyncAt ?? null,
      driveSyncStatus: data.driveSyncStatus ?? 'synced',
      driveLastError: data.driveLastError ?? null,
      updatedAt: data.updatedAt || new Date().toISOString(),
      version: typeof data.version === 'number' ? data.version : 1,
    };
  }

  public async upsertWorkspaceState(patch: {
    onboardingCompleted?: boolean;
    companySettings?: any;
    template?: any;
    fields?: any[];
    calculationSettings?: any;
    preferences?: Record<string, any>;
    driveLastSyncAt?: string | null;
    driveSyncStatus?: string | null;
    driveLastError?: string | null;
    expectedVersion?: number;
  }): Promise<StoredWorkspaceState> {
    const existing = await this.getWorkspaceState();
    if (
      typeof patch.expectedVersion === 'number' &&
      existing &&
      existing.version > patch.expectedVersion
    ) {
      throw new HttpApiError(
        409,
        'VERSION_CONFLICT',
        'Workspace settings were updated in another session. Reload to get the latest version before saving.'
      );
    }

    const now = new Date().toISOString();
    const next: StoredWorkspaceState = {
      userId: this.userId,
      onboardingCompleted:
        patch.onboardingCompleted !== undefined
          ? Boolean(patch.onboardingCompleted)
          : (existing?.onboardingCompleted ?? false),
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
      driveLastSyncAt:
        patch.driveLastSyncAt !== undefined ? patch.driveLastSyncAt : now,
      driveSyncStatus:
        patch.driveSyncStatus !== undefined ? patch.driveSyncStatus : 'synced',
      driveLastError:
        patch.driveLastError !== undefined ? patch.driveLastError : null,
      updatedAt: now,
      version: (existing?.version || 0) + 1,
    };

    await this.writeJsonFile('workspaceState', next);
    return next;
  }

  // ---------------- CUSTOMERS ----------------

  public async listCustomers(): Promise<StoredCustomerRecord[]> {
    const { data } = await this.readJsonFile<{ records?: StoredCustomerRecord[] }>('customers');
    if (!data || !Array.isArray(data.records)) return [];
    return data.records
      .filter((r) => r && r.id)
      .map((r) => ({ ...r, userId: this.userId }));
  }

  public async upsertCustomer(id: string, customerData: any): Promise<StoredCustomerRecord> {
    const existingList = await this.listCustomers();
    const now = new Date().toISOString();
    const record: StoredCustomerRecord = {
      id,
      userId: this.userId,
      data: { ...customerData, id, updatedAt: now },
      updatedAt: now,
    };
    const nextList = [record, ...existingList.filter((c) => c.id !== id)];
    await this.writeJsonFile('customers', {
      schemaVersion: 1,
      updatedAt: now,
      records: nextList,
    });
    return record;
  }

  public async deleteCustomer(id: string): Promise<boolean> {
    const existingList = await this.listCustomers();
    const nextList = existingList.filter((c) => c.id !== id);
    if (nextList.length === existingList.length) return false;
    await this.writeJsonFile('customers', {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: nextList,
    });
    return true;
  }

  // ---------------- QUOTATIONS ----------------

  public async listQuotations(): Promise<StoredQuotationRecord[]> {
    const { data } = await this.readJsonFile<{ records?: StoredQuotationRecord[] }>('quotations');
    if (!data || !Array.isArray(data.records)) return [];
    return data.records
      .filter((q) => q && q.id)
      .map((q) => ({ ...q, userId: this.userId }));
  }

  public async getQuotation(id: string): Promise<StoredQuotationRecord | null> {
    const list = await this.listQuotations();
    return list.find((q) => q.id === id) || null;
  }

  public async upsertQuotation(
    rec: Omit<StoredQuotationRecord, 'userId' | 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
    }
  ): Promise<StoredQuotationRecord> {
    const list = await this.listQuotations();
    const existing = list.find((q) => q.id === rec.id);
    const now = new Date().toISOString();
    const saved: StoredQuotationRecord = {
      id: rec.id,
      userId: this.userId,
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
      data: { ...rec.data, id: rec.id, updatedAt: now },
      createdAt: existing?.createdAt || rec.createdAt || now,
      updatedAt: now,
    };

    const nextList = [saved, ...list.filter((q) => q.id !== rec.id)];
    await this.writeJsonFile('quotations', {
      schemaVersion: 1,
      updatedAt: now,
      records: nextList,
    });
    return saved;
  }

  public async deleteQuotation(id: string): Promise<boolean> {
    const list = await this.listQuotations();
    const nextList = list.filter((q) => q.id !== id);
    if (nextList.length === list.length) return false;
    await this.writeJsonFile('quotations', {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: nextList,
    });
    return true;
  }

  // ---------------- INVOICES ----------------

  public async listInvoices(): Promise<StoredInvoiceRecord[]> {
    const { data } = await this.readJsonFile<{ records?: StoredInvoiceRecord[] }>('invoices');
    if (!data || !Array.isArray(data.records)) return [];
    return data.records
      .filter((inv) => inv && inv.id)
      .map((inv) => ({ ...inv, userId: this.userId }));
  }

  public async getInvoice(id: string): Promise<StoredInvoiceRecord | null> {
    const list = await this.listInvoices();
    return list.find((inv) => inv.id === id) || null;
  }

  public async upsertInvoice(
    rec: Omit<StoredInvoiceRecord, 'userId' | 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
    }
  ): Promise<StoredInvoiceRecord> {
    const list = await this.listInvoices();
    const existing = list.find((inv) => inv.id === rec.id);
    const now = new Date().toISOString();
    const saved: StoredInvoiceRecord = {
      id: rec.id,
      userId: this.userId,
      invoiceNumber: rec.invoiceNumber,
      sourceType: rec.sourceType,
      sourceQuotationId: rec.sourceQuotationId ?? existing?.sourceQuotationId ?? null,
      sourceQuotationNumber: rec.sourceQuotationNumber ?? existing?.sourceQuotationNumber ?? null,
      customerName: rec.customerName,
      totalAmount: rec.totalAmount,
      paymentStatus: rec.paymentStatus,
      driveFileId: rec.driveFileId ?? existing?.driveFileId ?? null,
      pdfDriveFileId: rec.pdfDriveFileId ?? existing?.pdfDriveFileId ?? null,
      data: { ...rec.data, id: rec.id, updatedAt: now },
      createdAt: existing?.createdAt || rec.createdAt || now,
      updatedAt: now,
    };

    const nextList = [saved, ...list.filter((inv) => inv.id !== rec.id)];
    await this.writeJsonFile('invoices', {
      schemaVersion: 1,
      updatedAt: now,
      records: nextList,
    });
    return saved;
  }

  public async deleteInvoice(id: string): Promise<boolean> {
    const list = await this.listInvoices();
    const nextList = list.filter((inv) => inv.id !== id);
    if (nextList.length === list.length) return false;
    await this.writeJsonFile('invoices', {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: nextList,
    });
    return true;
  }

  // ---------------- ENCRYPTED SMTP CONFIG ----------------

  public async getSmtpConfig(): Promise<StoredSmtpConfig | null> {
    const { data } = await this.readJsonFile<{ encryptedEnvelope?: string }>('smtpConfig');
    if (!data?.encryptedEnvelope) return null;
    try {
      const plaintext = decryptSecret(data.encryptedEnvelope, this.config.tokenEncryptionKey);
      const parsed = JSON.parse(plaintext) as StoredSmtpConfig;
      if (!parsed || !parsed.host) return null;
      return { ...parsed, userId: this.userId };
    } catch {
      return null;
    }
  }

  public async upsertSmtpConfig(cfg: {
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    encryptedPassword?: string | null;
    senderName: string;
    senderEmail: string;
    verifiedAt?: string | null;
  }): Promise<StoredSmtpConfig> {
    const existing = await this.getSmtpConfig();
    const now = new Date().toISOString();
    const saved: StoredSmtpConfig = {
      userId: this.userId,
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
      updatedAt: now,
    };

    const encryptedEnvelope = encryptSecret(
      JSON.stringify(saved),
      this.config.tokenEncryptionKey
    );

    await this.writeJsonFile('smtpConfig', {
      schemaVersion: 1,
      updatedAt: now,
      encryptedEnvelope,
    });
    return saved;
  }

  public async deleteSmtpConfig(): Promise<void> {
    await this.writeJsonFile('smtpConfig', {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      encryptedEnvelope: null,
    });
  }

  // ---------------- EMAIL LOGS ----------------

  public async listEmailLogs(limit = 100): Promise<StoredEmailLog[]> {
    const { data } = await this.readJsonFile<{ records?: StoredEmailLog[] }>('emailLogs');
    if (!data || !Array.isArray(data.records)) return [];
    return data.records.slice(0, limit).map((l) => ({ ...l, userId: this.userId }));
  }

  public async insertEmailLog(entry: Omit<StoredEmailLog, 'createdAt'>): Promise<StoredEmailLog> {
    const existing = await this.listEmailLogs(500);
    const saved: StoredEmailLog = {
      ...entry,
      userId: this.userId,
      createdAt: new Date().toISOString(),
    };
    const next = [saved, ...existing].slice(0, 500);
    await this.writeJsonFile('emailLogs', {
      schemaVersion: 1,
      updatedAt: saved.createdAt,
      records: next,
    });
    return saved;
  }

  // ---------------- GOOGLE SHEETS PERSISTED STATE ----------------

  private async readSheetsState(): Promise<DriveSheetsStateFile> {
    const { data } = await this.readJsonFile<DriveSheetsStateFile>('sheetsState');
    if (!data) {
      return {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        spreadsheets: {},
        rowHashes: {},
        history: [],
      };
    }
    return {
      schemaVersion: 1,
      updatedAt: data.updatedAt || new Date().toISOString(),
      spreadsheets: data.spreadsheets || {},
      rowHashes: data.rowHashes || {},
      history: Array.isArray(data.history) ? data.history : [],
    };
  }

  public async getRowHashesForSpreadsheet(spreadsheetId: string): Promise<Map<string, string>> {
    const state = await this.readSheetsState();
    const mapObj = state.rowHashes[spreadsheetId] || {};
    return new Map<string, string>(Object.entries(mapObj));
  }

  public async saveSyncedSpreadsheetTransaction(params: {
    spreadsheetId: string;
    spreadsheetUrl: string;
    title: string;
    selectedSheetName: string;
    selectedRange: string;
    headerRowIndex: number;
    sheetsMeta: SheetMetadataItem[];
    worksheets: NormalizedWorksheet[];
    syncedRowRecords: Array<{ sheetName: string; records: NormalizedRowRecord[] }>;
    stats: SyncDiffStats;
    syncStatus: 'synced' | 'no_changes';
    logId: string;
  }): Promise<PersistedSpreadsheetRecord> {
    const state = await this.readSheetsState();
    const now = new Date().toISOString();
    const totalRows = params.worksheets.reduce((acc, ws) => acc + ws.rows.length, 0);

    const record: PersistedSpreadsheetRecord = {
      id: `${this.userId}::${params.spreadsheetId}`,
      userId: this.userId,
      spreadsheetId: params.spreadsheetId,
      spreadsheetUrl: params.spreadsheetUrl,
      title: params.title,
      selectedSheetName: params.selectedSheetName,
      selectedRange: params.selectedRange,
      headerRowIndex: params.headerRowIndex,
      sheetsMeta: params.sheetsMeta,
      worksheets: params.worksheets,
      totalRows,
      lastSyncAt: now,
      lastSyncStatus: params.syncStatus,
      lastSyncStats: params.stats,
    };

    state.spreadsheets[params.spreadsheetId] = record;

    const hashMap: Record<string, string> = {};
    for (const grp of params.syncedRowRecords) {
      for (const rec of grp.records) {
        hashMap[`${this.userId}::${params.spreadsheetId}::${grp.sheetName}::${rec.rowKey}`] =
          rec.rowHash;
      }
    }
    state.rowHashes[params.spreadsheetId] = hashMap;

    state.history = [
      {
        id: params.logId,
        userId: this.userId,
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
        createdAt: now,
      },
      ...state.history,
    ].slice(0, 50);

    state.updatedAt = now;
    await this.writeJsonFile('sheetsState', state);
    return record;
  }

  public async recordSyncFailureLog(params: {
    logId: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetName: string;
    errorMessage: string;
  }): Promise<void> {
    try {
      const state = await this.readSheetsState();
      const now = new Date().toISOString();
      state.history = [
        {
          id: params.logId,
          userId: this.userId,
          spreadsheetId: params.spreadsheetId,
          spreadsheetTitle: params.spreadsheetTitle,
          sheetName: params.sheetName,
          status: 'failed' as const,
          rowsRetrieved: 0,
          createdCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          skippedCount: 0,
          errorMessage: params.errorMessage,
          createdAt: now,
        },
        ...state.history,
      ].slice(0, 50);
      state.updatedAt = now;
      await this.writeJsonFile('sheetsState', state);
    } catch {
      // Never mask original sync error if logging fails
    }
  }

  public async getLatestSyncedData(spreadsheetId?: string): Promise<{
    spreadsheet: PersistedSpreadsheetRecord | null;
    history: SyncHistoryEntry[];
  }> {
    const state = await this.readSheetsState();
    let spreadsheet: PersistedSpreadsheetRecord | null = null;
    if (spreadsheetId) {
      spreadsheet = state.spreadsheets[spreadsheetId] || null;
    } else {
      const all = Object.values(state.spreadsheets).sort((a, b) =>
        (b.lastSyncAt || '').localeCompare(a.lastSyncAt || '')
      );
      spreadsheet = all[0] || null;
    }
    return {
      spreadsheet,
      history: state.history,
    };
  }

  // ---------------- PDF UPLOAD, BACKUP & RESTORE ----------------

  public async uploadPdf(params: {
    documentType: 'quotation' | 'invoice';
    documentId: string;
    fileName: string;
    pdfBase64: string;
  }): Promise<{ driveFileId: string; fileName: string; updatedAt: string }> {
    const cleanBase64 = params.pdfBase64.replace(/^data:application\/pdf[^,]*,/, '').trim();
    if (!cleanBase64) {
      throw new HttpApiError(400, 'EMPTY_PDF_CONTENT', 'PDF content is required for Google Drive upload.');
    }
    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    const safeBase = params.fileName.replace(/[^\w.\-() ]+/g, '_');
    const safeName = safeBase.endsWith('.pdf') ? safeBase : `${safeBase}.pdf`;

    const folders = await this.ensureFolders();
    const entityType = `${params.documentType}_pdf`;

    let existingFileId: string | null = null;
    const foundByProp = await this.drive.findFile({
      accessToken: this.accessToken,
      config: this.config,
      parentId: folders.subfolders.generatedPdfs,
      appPropertyKey: 'entityId',
      appPropertyValue: `${entityType}:${params.documentId}`,
    });
    if (foundByProp) {
      existingFileId = foundByProp.id;
    } else {
      const foundByName = await this.drive.findFile({
        accessToken: this.accessToken,
        config: this.config,
        name: safeName,
        parentId: folders.subfolders.generatedPdfs,
      });
      if (foundByName) existingFileId = foundByName.id;
    }

    const uploaded = await this.drive.createOrUpdateFile({
      accessToken: this.accessToken,
      config: this.config,
      existingFileId,
      name: safeName,
      parentId: folders.subfolders.generatedPdfs,
      mimeType: 'application/pdf',
      content: pdfBuffer,
      appProperties: {
        app: 'invoice-studio',
        entityType,
        entityId: `${entityType}:${params.documentId}`,
        ownerSub: this.userId,
      },
    });

    return {
      driveFileId: uploaded.id,
      fileName: uploaded.name,
      updatedAt: uploaded.modifiedTime || new Date().toISOString(),
    };
  }

  public async syncFullWorkspaceSnapshot(snapshot?: {
    companySettings?: any;
    template?: any;
    fields?: any[];
    calculationSettings?: any;
    preferences?: Record<string, any>;
    customers?: any[];
    quotations?: any[];
    invoices?: any[];
  }): Promise<{
    rootFolderId: string;
    subfolders: Record<DriveFolderKey, string>;
    filesSynced: number;
    customersSynced: number;
    quotationsSynced: number;
    invoicesSynced: number;
    emailLogsSynced: number;
    syncedAt: string;
  }> {
    const folders = await this.ensureFolders();
    const now = new Date().toISOString();
    let filesSynced = 0;

    if (snapshot) {
      if (
        snapshot.companySettings !== undefined ||
        snapshot.template !== undefined ||
        snapshot.fields !== undefined ||
        snapshot.calculationSettings !== undefined ||
        snapshot.preferences !== undefined
      ) {
        await this.upsertWorkspaceState({
          companySettings: snapshot.companySettings,
          template: snapshot.template,
          fields: snapshot.fields,
          calculationSettings: snapshot.calculationSettings,
          preferences: snapshot.preferences,
          driveLastSyncAt: now,
          driveSyncStatus: 'synced',
          driveLastError: null,
        });
        filesSynced++;
      }

      if (Array.isArray(snapshot.customers)) {
        const existing = await this.listCustomers();
        const merged = mergeTimestampedRecords(
          existing.map((c) => ({ ...c.data, id: c.id, updatedAt: c.updatedAt })),
          snapshot.customers.map((c) => ({ ...c, updatedAt: c.updatedAt || now }))
        );
        const records: StoredCustomerRecord[] = merged.merged.map((c) => ({
          id: String(c.id),
          userId: this.userId,
          data: c,
          updatedAt: c.updatedAt || now,
        }));
        await this.writeJsonFile('customers', {
          schemaVersion: 1,
          updatedAt: now,
          records,
        });
        filesSynced++;
      }

      if (Array.isArray(snapshot.quotations)) {
        const existing = await this.listQuotations();
        const merged = mergeTimestampedRecords(
          existing.map((q) => ({ ...q.data, id: q.id, updatedAt: q.updatedAt })),
          snapshot.quotations.map((q) => ({ ...q, updatedAt: q.updatedAt || now }))
        );
        const records: StoredQuotationRecord[] = merged.merged.map((q) => ({
          id: String(q.id),
          userId: this.userId,
          quotationNumber: String(q.quotationNumber || ''),
          status: String(q.status || 'Draft'),
          customerName: String(q.customerName || ''),
          totalAmount: Number(q.totalAmount || 0),
          validUntil: String(q.validUntilDate || q.validUntil || ''),
          convertedInvoiceId: q.convertedInvoiceId || null,
          convertedInvoiceNumber: q.convertedInvoiceNumber || null,
          convertedAt: q.convertedAt || null,
          driveFileId: q.driveFileId || null,
          pdfDriveFileId: q.pdfDriveFileId || null,
          data: q,
          createdAt: q.createdAt || now,
          updatedAt: q.updatedAt || now,
        }));
        await this.writeJsonFile('quotations', {
          schemaVersion: 1,
          updatedAt: now,
          records,
        });
        filesSynced++;
      }

      if (Array.isArray(snapshot.invoices)) {
        const existing = await this.listInvoices();
        const merged = mergeTimestampedRecords(
          existing.map((i) => ({ ...i.data, id: i.id, updatedAt: i.updatedAt })),
          snapshot.invoices.map((i) => ({ ...i, updatedAt: i.updatedAt || now }))
        );
        const records: StoredInvoiceRecord[] = merged.merged.map((inv) => ({
          id: String(inv.id),
          userId: this.userId,
          invoiceNumber: String(inv.invoiceNumber || ''),
          sourceType: String(inv.sourceType || 'manual'),
          sourceQuotationId: inv.sourceQuotationId || null,
          sourceQuotationNumber: inv.sourceQuotationNumber || null,
          customerName: String(inv.customerName || ''),
          totalAmount: Number(inv.totalAmount || 0),
          paymentStatus: String(inv.paymentStatus || 'Unpaid'),
          driveFileId: inv.driveFileId || null,
          pdfDriveFileId: inv.pdfDriveFileId || null,
          data: inv,
          createdAt: inv.createdAt || now,
          updatedAt: inv.updatedAt || now,
        }));
        await this.writeJsonFile('invoices', {
          schemaVersion: 1,
          updatedAt: now,
          records,
        });
        filesSynced++;
      }
    } else {
      // Touch workspace state timestamp & confirm folders/files exist
      await this.upsertWorkspaceState({
        driveLastSyncAt: now,
        driveSyncStatus: 'synced',
        driveLastError: null,
      });
      filesSynced++;
    }

    const [customers, quotations, invoices, emailLogs] = await Promise.all([
      this.listCustomers(),
      this.listQuotations(),
      this.listInvoices(),
      this.listEmailLogs(200),
    ]);

    return {
      rootFolderId: folders.rootFolderId,
      subfolders: folders.subfolders,
      filesSynced: Math.max(filesSynced, 1),
      customersSynced: customers.length,
      quotationsSynced: quotations.length,
      invoicesSynced: invoices.length,
      emailLogsSynced: emailLogs.length,
      syncedAt: now,
    };
  }

  public async createBackup(): Promise<{ driveFileId: string; fileName: string; createdAt: string }> {
    const folders = await this.ensureFolders();
    const [workspace, customers, quotations, invoices, emailLogs] = await Promise.all([
      this.getWorkspaceState(),
      this.listCustomers(),
      this.listQuotations(),
      this.listInvoices(),
      this.listEmailLogs(500),
    ]);

    const nowIso = new Date().toISOString();
    const stamp = nowIso.replace(/[:.]/g, '-');
    const fileName = `invoice-studio-backup-${stamp}.json`;

    const created = await this.drive.createOrUpdateFile({
      accessToken: this.accessToken,
      config: this.config,
      name: fileName,
      parentId: folders.subfolders.backups,
      mimeType: 'application/json',
      content: JSON.stringify(
        {
          schemaVersion: 3,
          backupCreatedAt: nowIso,
          workspace,
          customers: customers.map((c) => c.data),
          quotations: quotations.map((q) => q.data),
          invoices: invoices.map((i) => i.data),
          emailLogs,
        },
        null,
        2
      ),
      appProperties: {
        app: 'invoice-studio',
        entityType: 'backup',
        ownerSub: this.userId,
      },
    });

    return {
      driveFileId: created.id,
      fileName: created.name,
      createdAt: nowIso,
    };
  }

  public async restoreFromDrive(): Promise<{
    restoredSettings: boolean;
    customersRestored: number;
    quotationsRestored: number;
    invoicesRestored: number;
    conflictsResolved: number;
    restoredAt: string;
    workspace: StoredWorkspaceState | null;
    customers: any[];
    quotations: any[];
    invoices: any[];
    emailLogs: StoredEmailLog[];
  }> {
    await this.ensureFolders();
    const [workspace, customers, quotations, invoices, emailLogs] = await Promise.all([
      this.getWorkspaceState(),
      this.listCustomers(),
      this.listQuotations(),
      this.listInvoices(),
      this.listEmailLogs(100),
    ]);

    return {
      restoredSettings: Boolean(workspace),
      customersRestored: customers.length,
      quotationsRestored: quotations.length,
      invoicesRestored: invoices.length,
      conflictsResolved: 0,
      restoredAt: new Date().toISOString(),
      workspace,
      customers: customers.map((c) => c.data),
      quotations: quotations.map((q) => q.data),
      invoices: invoices.map((i) => i.data),
      emailLogs,
    };
  }
}
