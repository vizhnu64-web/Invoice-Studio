/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AppServerConfig, SIGNIN_GOOGLE_SCOPES, GOOGLE_SHEETS_SCOPE, GOOGLE_GMAIL_SEND_SCOPE } from './config.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import {
  DRIVE_ROOT_FOLDER_NAME,
  DRIVE_SUBFOLDER_KEYS,
  DriveFileSummary,
  DriveTransportAdapter,
} from './driveService.js';
import { EmailTransportAdapter } from './emailBackendService.js';
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
  handleEmailTestSend,
  handleGoogleAuthCallback,
  handleGoogleAuthStart,
  handleHealth,
  handleInvoices,
  handleQuotations,
  handleSheetsData,
  handleSheetsMetadata,
  handleSheetsSync,
  handleSmtpConfig,
  handleSmtpTest,
  handleWorkspace,
  HandlerRuntimeDeps,
} from './handlers.js';
import {
  decodeEncryptedSessionCookie,
  encodeEncryptedSessionCookie,
  EncryptedSessionData,
  NormalizedRequest,
  NormalizedResponse,
  SESSION_COOKIE_NAME,
} from './http.js';
import {
  buildSheetRange,
  computeSyncDiff,
  extractSpreadsheetId,
  normalizeSheetValues,
} from './sheetsNormalization.js';

const TEST_CONFIG: AppServerConfig = {
  appUrl: 'http://localhost:3000',
  googleClientId: 'test-client-id.apps.googleusercontent.com',
  googleClientSecret: 'test-client-secret-value',
  googleRedirectUri: 'http://localhost:3000/api/auth/google/callback',
  sessionSecret: 'super-secret-session-signing-key-32-chars!!',
  tokenEncryptionKey: 'super-secret-aes256-encryption-key-32-chars!!',
  isProduction: false,
};

interface MockRes {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  json(): any;
  getCookies(): Record<string, string>;
  getRawSetCookies(): string[];
  res: NormalizedResponse;
}

function createMockRes(): MockRes {
  const state: MockRes = {
    statusCode: 200,
    headers: {},
    body: '',
    json() {
      return state.body ? JSON.parse(state.body) : {};
    },
    getRawSetCookies() {
      const raw = state.headers['Set-Cookie'] || state.headers['set-cookie'];
      if (!raw) return [];
      return Array.isArray(raw) ? raw : [raw];
    },
    getCookies() {
      const out: Record<string, string> = {};
      for (const line of state.getRawSetCookies()) {
        const pair = line.split(';')[0];
        const eq = pair.indexOf('=');
        if (eq > 0) {
          out[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim());
        }
      }
      return out;
    },
    res: {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string | number | readonly string[]) {
        state.headers[name] = Array.isArray(value) ? [...value] : String(value);
        return this;
      },
      getHeader(name: string) {
        return state.headers[name];
      },
      json(payload: any) {
        state.headers['Content-Type'] = 'application/json; charset=utf-8';
        state.body = JSON.stringify(payload);
        return this;
      },
      end(chunk?: any) {
        if (typeof chunk === 'string') state.body += chunk;
        return this;
      },
    } as unknown as NormalizedResponse,
  };
  return state;
}

function createReq(opts: {
  method?: string;
  url?: string;
  query?: Record<string, string>;
  body?: any;
  cookies?: Record<string, string>;
}): NormalizedRequest {
  const cookieHeader = opts.cookies
    ? Object.entries(opts.cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; ')
    : undefined;

  return {
    method: opts.method || 'GET',
    url: opts.url || '/api/test',
    query: opts.query || {},
    body: opts.body,
    headers: {
      host: 'localhost:3000',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  } as unknown as NormalizedRequest;
}

/**
 * In-memory per-user Google Drive simulator keyed by accessToken -> user Drive bucket.
 * Accurately enforces strict per-user Drive isolation (User A's token can never see User B's files).
 */
class MultiUserMockDrive {
  private buckets = new Map<
    string,
    Map<
      string,
      {
        summary: DriveFileSummary;
        content: Buffer;
      }
    >
  >();
  private idCounter = 1;
  public failNextWriteError: Error | null = null;

  private getBucket(accessToken: string) {
    // Map token prefix (e.g. "token-user-a-...") to owner bucket so refreshed tokens hit the same Drive
    const ownerKey = accessToken.split(':')[0] || accessToken;
    let bucket = this.buckets.get(ownerKey);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(ownerKey, bucket);
    }
    return bucket;
  }

  public getFilesForOwner(ownerKey: string) {
    return Array.from(this.buckets.get(ownerKey)?.values() || []);
  }

  public corruptFileForOwner(ownerKey: string, fileName: string, rawText: string) {
    const bucket = this.buckets.get(ownerKey);
    if (!bucket) throw new Error('No bucket');
    for (const entry of bucket.values()) {
      if (entry.summary.name === fileName) {
        entry.content = Buffer.from(rawText, 'utf8');
        return;
      }
    }
    throw new Error(`File ${fileName} not found`);
  }

  public asAdapter(): DriveTransportAdapter {
    return {
      findFile: async ({
        accessToken,
        name,
        parentId,
        mimeType,
        appPropertyKey,
        appPropertyValue,
      }) => {
        const bucket = this.getBucket(accessToken);
        const matches = Array.from(bucket.values()).filter(({ summary }) => {
          if (name && summary.name !== name) return false;
          if (parentId && !(summary.parents || []).includes(parentId)) return false;
          if (mimeType && summary.mimeType !== mimeType) return false;
          if (appPropertyKey && appPropertyValue) {
            if (summary.appProperties?.[appPropertyKey] !== appPropertyValue) return false;
          }
          return true;
        });
        return matches.length > 0 ? { ...matches[matches.length - 1].summary } : null;
      },

      getFileMetadata: async ({ accessToken, fileId }) => {
        const bucket = this.getBucket(accessToken);
        const entry = bucket.get(fileId);
        return entry ? { ...entry.summary } : null;
      },

      createFolder: async ({ accessToken, name, parentId, appProperties }) => {
        const bucket = this.getBucket(accessToken);
        const id = `drv_folder_${this.idCounter++}`;
        const summary: DriveFileSummary = {
          id,
          name,
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: new Date().toISOString(),
          parents: parentId ? [parentId] : undefined,
          appProperties,
        };
        bucket.set(id, { summary, content: Buffer.alloc(0) });
        return { ...summary };
      },

      createOrUpdateFile: async ({
        accessToken,
        existingFileId,
        name,
        parentId,
        mimeType,
        content,
        appProperties,
      }) => {
        if (this.failNextWriteError) {
          const err = this.failNextWriteError;
          this.failNextWriteError = null;
          throw err;
        }
        const bucket = this.getBucket(accessToken);
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        if (existingFileId && bucket.has(existingFileId)) {
          const existing = bucket.get(existingFileId)!;
          const updated: DriveFileSummary = {
            ...existing.summary,
            name,
            mimeType,
            modifiedTime: new Date().toISOString(),
            appProperties: { ...(existing.summary.appProperties || {}), ...(appProperties || {}) },
          };
          bucket.set(existingFileId, { summary: updated, content: buf });
          return { ...updated };
        }
        const id = `drv_file_${this.idCounter++}`;
        const summary: DriveFileSummary = {
          id,
          name,
          mimeType,
          modifiedTime: new Date().toISOString(),
          parents: [parentId],
          appProperties,
        };
        bucket.set(id, { summary, content: buf });
        return { ...summary };
      },

      downloadFileText: async ({ accessToken, fileId }) => {
        const bucket = this.getBucket(accessToken);
        const entry = bucket.get(fileId);
        if (!entry) {
          throw new HttpApiError(404, 'DRIVE_FILE_NOT_FOUND', `Drive file ${fileId} not found.`);
        }
        return entry.content.toString('utf8');
      },
    };
  }
}

function makeSignedSessionCookie(session: EncryptedSessionData): Record<string, string> {
  return {
    [SESSION_COOKIE_NAME]: encodeEncryptedSessionCookie(session, TEST_CONFIG),
  };
}

describe('Invoice Studio — Simplified Architecture & Full Integration Test Suite', () => {
  test('1. Architecture Integrity: Zero Firebase, Zero PostgreSQL, SMTP Retained, Clean Env', () => {
    const rootDir = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    assert.equal('firebase' in allDeps, false, 'firebase package must be removed');
    assert.equal('pg' in allDeps, false, 'pg package must be removed');
    assert.equal('@types/pg' in allDeps, false, '@types/pg must be removed');
    assert.equal('nodemailer' in allDeps, true, 'nodemailer must be preserved for SMTP');
    assert.equal('googleapis' in allDeps, true, 'googleapis must be preserved');

    const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
    assert.equal(envExample.includes('DATABASE_URL'), false, '.env.example must not reference DATABASE_URL');
    assert.equal(/firebase/i.test(envExample), false, '.env.example must not reference Firebase');
    for (const requiredVar of [
      'APP_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'SESSION_SECRET',
      'TOKEN_ENCRYPTION_KEY',
    ]) {
      assert.equal(envExample.includes(requiredVar), true, `.env.example must list ${requiredVar}`);
    }

    assert.equal(fs.existsSync(path.join(rootDir, 'api/_lib/db.ts')), false, 'api/_lib/db.ts must not exist');
    assert.equal(fs.existsSync(path.join(rootDir, 'src/firebase.ts')), false, 'src/firebase.ts must not exist');
    assert.equal(fs.existsSync(path.join(rootDir, 'firestore.rules')), false, 'firestore.rules must not exist');
  });

  test('2. New User Runtime Storage Starts Completely Clean (No Preloaded Demo Customers or Sheet Rows)', async () => {
    const { storage } = await import('../../src/utils/storage');
    storage.clearAllUserWorkspaceCaches();
    storage.setActiveStorageUser('fresh-user-123');
    assert.deepEqual(storage.loadCustomers(), []);
    const sheet = storage.loadSpreadsheetData();
    assert.equal(sheet.worksheets.length, 0);
    assert.equal(storage.loadQuotations().length, 0);
    assert.equal(storage.loadHistory().length, 0);
    storage.clearAllUserWorkspaceCaches();
    storage.setActiveStorageUser(null);
  });

  test('3. Encrypted HttpOnly Session Cookie Security: Roundtrip, Tamper, Expiry & Wrong Key Rejection', () => {
    const session: EncryptedSessionData = {
      uid: 'google-sub-alice',
      em: 'alice@example.com',
      nm: 'Alice',
      pic: null,
      at: 'user-a:access-1',
      rt: 'user-a:refresh-1',
      exp: Date.now() + 3600_000,
      sc: SIGNIN_GOOGLE_SCOPES.join(' '),
      cat: new Date().toISOString(),
    };

    const cookieVal = encodeEncryptedSessionCookie(session, TEST_CONFIG);
    assert.equal(cookieVal.includes('user-a:access-1'), false, 'access token must never be plaintext in cookie');
    assert.equal(cookieVal.includes('user-a:refresh-1'), false, 'refresh token must never be plaintext in cookie');

    const decoded = decodeEncryptedSessionCookie(cookieVal, TEST_CONFIG);
    assert.equal(decoded?.uid, 'google-sub-alice');
    assert.equal(decoded?.rt, 'user-a:refresh-1');

    // Tampered cookie rejected
    const tampered = cookieVal.slice(0, -4) + 'AAAA';
    assert.equal(decodeEncryptedSessionCookie(tampered, TEST_CONFIG), null);

    // Wrong encryption key rejected
    assert.equal(
      decodeEncryptedSessionCookie(cookieVal, {
        ...TEST_CONFIG,
        tokenEncryptionKey: 'different-key-that-must-fail-decryption-32ch',
      }),
      null
    );

    // Wrong HMAC session secret rejected
    assert.equal(
      decodeEncryptedSessionCookie(cookieVal, {
        ...TEST_CONFIG,
        sessionSecret: 'different-session-signing-secret-must-fail-32ch',
      }),
      null
    );
  });

  test('4. Health & Unauthorized Route Rejection (401 without valid session)', async () => {
    const deps: HandlerRuntimeDeps = { getConfig: () => TEST_CONFIG };

    const healthRes = createMockRes();
    await handleHealth(createReq({ url: '/api/health' }), healthRes.res, deps);
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.json().storageProvider, 'google-drive');
    assert.equal('databaseConfigured' in healthRes.json(), false);

    const wsRes = createMockRes();
    await handleWorkspace(createReq({ method: 'GET', url: '/api/workspace' }), wsRes.res, deps);
    assert.equal(wsRes.statusCode, 401);
    assert.equal(wsRes.json().code, 'NOT_AUTHENTICATED');
  });

  test('5. OAuth Sign-In Flow, Google Drive 5-Folder Sole Storage & Strict Multi-User Isolation', async () => {
    const drive = new MultiUserMockDrive();
    const oauthTransport: GoogleTransportAdapter = {
      exchangeAuthCode: async ({ code }) => {
        if (code === 'code-alice') {
          return {
            tokens: {
              access_token: 'alice:tok-1',
              refresh_token: 'alice:ref-1',
              expiry_date: Date.now() + 3600_000,
              scope: SIGNIN_GOOGLE_SCOPES.join(' '),
            },
            identity: { sub: 'sub-alice', email: 'alice@biz.test', name: 'Alice Owner', picture: null },
          };
        }
        return {
          tokens: {
            access_token: 'bob:tok-1',
            refresh_token: 'bob:ref-1',
            expiry_date: Date.now() + 3600_000,
            scope: SIGNIN_GOOGLE_SCOPES.join(' '),
          },
          identity: { sub: 'sub-bob', email: 'bob@other.test', name: 'Bob Owner', picture: null },
        };
      },
      refreshAccessToken: async () => {
        throw new Error('not expected');
      },
      revokeToken: async () => {},
      fetchSpreadsheetMetadata: async () => {
        throw new Error('not expected');
      },
      fetchSheetValues: async () => [],
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      transport: oauthTransport,
      driveTransport: drive.asAdapter(),
    };

    // --- Alice signs in via OAuth ---
    const startA = createMockRes();
    await handleGoogleAuthStart(
      createReq({ method: 'GET', url: '/api/auth/google/start', query: { feature: 'signin' } }),
      startA.res,
      deps
    );
    assert.equal(startA.statusCode, 200);
    const { state: stateA } = startA.json();
    const stateCookiesA = startA.getCookies();

    const cbA = createMockRes();
    await handleGoogleAuthCallback(
      createReq({
        method: 'POST',
        url: '/api/auth/google/callback',
        body: { code: 'code-alice', state: stateA, redirectUri: 'postmessage', feature: 'signin' },
        cookies: stateCookiesA,
      }),
      cbA.res,
      deps
    );
    assert.equal(cbA.statusCode, 200);
    const aliceCookies = cbA.getCookies();
    assert.ok(aliceCookies[SESSION_COOKIE_NAME], 'Alice must receive encrypted HttpOnly session cookie');

    // Verify 5-folder Drive structure created cleanly for Alice
    const statusDriveA = createMockRes();
    await handleDriveStatus(createReq({ cookies: aliceCookies }), statusDriveA.res, deps);
    assert.equal(statusDriveA.statusCode, 200);
    const drivePayload = statusDriveA.json();
    assert.equal(drivePayload.rootFolderName, DRIVE_ROOT_FOLDER_NAME);
    assert.deepEqual(Object.values(drivePayload.subfolderNames).sort(), [
      'Application Data',
      'Backups',
      'Company Assets',
      'Email Records',
      'Generated PDFs',
    ]);

    // Alice saves company settings, a customer, a quotation -> approves -> converts to invoice -> uploads PDF
    const wsPutA = createMockRes();
    await handleWorkspace(
      createReq({
        method: 'PUT',
        cookies: aliceCookies,
        body: {
          onboardingCompleted: true,
          companySettings: { legalName: 'Alice Consulting LLP', email: 'alice@biz.test' },
        },
      }),
      wsPutA.res,
      deps
    );
    assert.equal(wsPutA.statusCode, 200);

    const custPostA = createMockRes();
    await handleWorkspace(
      createReq({
        method: 'POST',
        cookies: aliceCookies,
        body: {
          customer: {
            id: 'cust_alice_1',
            customerName: 'Northstar Logistics',
            email: 'ap@northstar.test',
            billingAddress: '101 Harbor Rd',
            updatedAt: '2026-11-12T10:00:00.000Z',
          },
        },
      }),
      custPostA.res,
      deps
    );
    assert.equal(custPostA.statusCode, 200);

    // Save quotation twice (idempotency check — no duplicate Drive files)
    const quotationA = {
      id: 'quot_a_1',
      quotationNumber: 'QT-2026-0001',
      status: 'Draft',
      customer: { customerName: 'Northstar Logistics' },
      summary: { totalInvoiceAmount: 59000 },
      validUntil: '2026-12-31',
      createdAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:00:00.000Z',
    };
    const qSave1 = createMockRes();
    await handleQuotations(
      createReq({ method: 'POST', url: '/api/quotations', cookies: aliceCookies, body: { quotation: quotationA } }),
      qSave1.res,
      [],
      deps
    );
    assert.equal(qSave1.statusCode, 200);

    // Approve quotation
    const qApprove = createMockRes();
    await handleQuotations(
      createReq({
        method: 'POST',
        url: '/api/quotations/quot_a_1/status',
        cookies: aliceCookies,
        body: { status: 'Approved', notes: 'Approved by procurement' },
      }),
      qApprove.res,
      ['quot_a_1', 'status'],
      deps
    );
    assert.equal(qApprove.statusCode, 200);
    assert.equal(qApprove.json().quotation.status, 'Approved');

    // Convert approved quotation to invoice
    const qConvert = createMockRes();
    await handleQuotations(
      createReq({
        method: 'POST',
        url: '/api/quotations/quot_a_1/convert',
        cookies: aliceCookies,
        body: {
          invoice: {
            id: 'inv_a_1',
            invoiceNumber: 'INV-2026-0001',
            customerName: 'Northstar Logistics',
            totalAmount: 59000,
            paymentStatus: 'Unpaid',
          },
        },
      }),
      qConvert.res,
      ['quot_a_1', 'convert'],
      deps
    );
    assert.equal(qConvert.statusCode, 200);
    assert.equal(qConvert.json().quotation.status, 'Converted to Invoice');

    // Duplicate conversion must be blocked (409)
    const qDupConvert = createMockRes();
    await handleQuotations(
      createReq({
        method: 'POST',
        url: '/api/quotations/quot_a_1/convert',
        cookies: aliceCookies,
        body: { invoice: { id: 'inv_a_2', invoiceNumber: 'INV-2026-0002', totalAmount: 59000 } },
      }),
      qDupConvert.res,
      ['quot_a_1', 'convert'],
      deps
    );
    assert.equal(qDupConvert.statusCode, 409);

    // Upload PDF & create backup for Alice
    const pdfRes = createMockRes();
    await handleDriveUploadPdf(
      createReq({
        method: 'POST',
        cookies: aliceCookies,
        body: {
          documentType: 'invoice',
          documentId: 'inv_a_1',
          fileName: 'INV-2026-0001.pdf',
          pdfBase64: Buffer.from('%PDF-1.4 fake-pdf').toString('base64'),
        },
      }),
      pdfRes.res,
      deps
    );
    assert.equal(pdfRes.statusCode, 200);

    const backupRes = createMockRes();
    await handleDriveBackup(createReq({ method: 'POST', cookies: aliceCookies, body: {} }), backupRes.res, deps);
    assert.equal(backupRes.statusCode, 200);

    // Verify zero duplicate JSON files in Alice's Drive
    const aliceFiles = drive.getFilesForOwner('alice');
    const jsonNames = aliceFiles.filter((f) => f.summary.name === 'quotations.json');
    assert.equal(jsonNames.length, 1, 'quotations.json must be updated in-place without duplicates');

    // --- Bob signs in via OAuth -> MUST see completely empty isolated workspace ---
    const startB = createMockRes();
    await handleGoogleAuthStart(
      createReq({ method: 'GET', url: '/api/auth/google/start', query: { feature: 'signin' } }),
      startB.res,
      deps
    );
    const cbB = createMockRes();
    await handleGoogleAuthCallback(
      createReq({
        method: 'POST',
        url: '/api/auth/google/callback',
        body: { code: 'code-bob', state: startB.json().state, redirectUri: 'postmessage', feature: 'signin' },
        cookies: startB.getCookies(),
      }),
      cbB.res,
      deps
    );
    assert.equal(cbB.statusCode, 200);
    const bobCookies = cbB.getCookies();

    const wsBob = createMockRes();
    await handleWorkspace(createReq({ method: 'GET', cookies: bobCookies }), wsBob.res, deps);
    assert.equal(wsBob.statusCode, 200);
    const bobData = wsBob.json();
    assert.equal(bobData.customers.length, 0, 'Bob must see 0 customers');
    assert.equal(bobData.quotations.length, 0, 'Bob must see 0 quotations');
    assert.equal(bobData.invoices.length, 0, 'Bob must see 0 invoices');
    assert.equal(bobData.smtpConfig.configured, false, 'Bob must not see Alice SMTP config');

    // Alice signs back in -> restores all Alice records cleanly from Drive
    const wsAliceAgain = createMockRes();
    await handleWorkspace(createReq({ method: 'GET', cookies: aliceCookies }), wsAliceAgain.res, deps);
    assert.equal(wsAliceAgain.statusCode, 200);
    const aliceData = wsAliceAgain.json();
    assert.equal(aliceData.workspace.companySettings.legalName, 'Alice Consulting LLP');
    assert.equal(aliceData.customers.length, 1);
    assert.equal(aliceData.quotations.length, 1);
    assert.equal(aliceData.invoices.length, 1);

    // Sign out clears session cookie
    const signOutRes = createMockRes();
    await handleAuthDisconnect(
      createReq({ method: 'POST', cookies: aliceCookies, body: { feature: 'all' } }),
      signOutRes.res,
      deps
    );
    assert.equal(signOutRes.statusCode, 200);
    assert.equal(signOutRes.json().signedOut, true);
    assert.ok(
      signOutRes.getRawSetCookies().some((c) => c.includes(`${SESSION_COOKIE_NAME}=`) && c.includes('Max-Age=0'))
    );
  });

  test('6. Google Drive Resilience: Version Conflict (409), Corrupted JSON Protection & Restore', async () => {
    const drive = new MultiUserMockDrive();
    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      driveTransport: drive.asAdapter(),
    };

    const cookies = makeSignedSessionCookie({
      uid: 'sub-resilience',
      em: 'res@biz.test',
      nm: 'Res User',
      pic: null,
      at: 'res:tok-1',
      rt: 'res:ref-1',
      exp: Date.now() + 3600_000,
      sc: SIGNIN_GOOGLE_SCOPES.join(' '),
      cat: new Date().toISOString(),
    });

    // Save version 1 -> 2
    const save1 = createMockRes();
    await handleWorkspace(
      createReq({ method: 'PUT', cookies, body: { companySettings: { legalName: 'V1 Co' } } }),
      save1.res,
      deps
    );
    assert.equal(save1.statusCode, 200);
    const currentVersion = save1.json().workspace.version;

    // Attempt stale expectedVersion -> 409 VERSION_CONFLICT
    const stale = createMockRes();
    await handleWorkspace(
      createReq({
        method: 'PUT',
        cookies,
        body: { expectedVersion: currentVersion - 1, companySettings: { legalName: 'Stale Co' } },
      }),
      stale.res,
      deps
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, 'VERSION_CONFLICT');

    // Sync & Restore
    const syncRes = createMockRes();
    await handleDriveSync(createReq({ method: 'POST', cookies, body: {} }), syncRes.res, deps);
    assert.equal(syncRes.statusCode, 200);

    const restoreRes = createMockRes();
    await handleDriveRestore(createReq({ method: 'POST', cookies, body: {} }), restoreRes.res, deps);
    assert.equal(restoreRes.statusCode, 200);

    // Corrupt workspace-state.json in Drive -> must fail explicitly with DRIVE_CORRUPTED_FILE (never overwrite silently)
    drive.corruptFileForOwner('res', 'workspace-state.json', '{not-valid-json');
    const corruptRead = createMockRes();
    await handleWorkspace(createReq({ method: 'GET', cookies }), corruptRead.res, deps);
    assert.equal(corruptRead.statusCode, 500);
    assert.equal(corruptRead.json().code, 'DRIVE_CORRUPTED_FILE');
  });

  test('7. Google Sheets URL Import, Normalization, Auto-Refresh Token & Error Preservation', async () => {
    // Pure normalization checks
    assert.equal(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0'),
      '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
    );
    assert.throws(() => extractSpreadsheetId('https://example.com/not-a-sheet'));
    assert.equal(buildSheetRange("Sales '2026'", 'A1:F50'), "'Sales ''2026'''!A1:F50");

    const { worksheet, rowRecords } = normalizeSheetValues(
      'Invoices',
      [
        ['Monthly Billing Export'],
        ['Invoice No', 'Customer', 'Phone', 'Amount', 'Amount'],
        ['INV-001', 'Riya', '009811000', '50000', '59000'],
        ['', '', '', '', ''],
      ],
      { headerRowIndex: 'auto' }
    );
    assert.equal(worksheet.headerRowIndex, 1);
    assert.equal(worksheet.rows.length, 1);
    assert.equal(worksheet.rows[0]['Phone'], '009811000', 'Leading zeros must be preserved');
    assert.deepEqual(worksheet.headers, ['Invoice No', 'Customer', 'Phone', 'Amount', 'Amount (2)']);

    const diff = computeSyncDiff(
      new Map(),
      rowRecords.map((r) => ({ compositeKey: `${worksheet.name}:${r.rowKey}`, rowHash: r.rowHash })),
      worksheet.rawRowCount,
      worksheet.skippedEmptyRows
    );
    assert.equal(diff.createdCount, 1);

    const drive = new MultiUserMockDrive();
    let refreshedCount = 0;
    let sheetRows: any[][] = [
      ['Invoice No', 'Customer', 'Amount'],
      ['INV-101', 'Delta Corp', '15000'],
      ['INV-102', 'Echo Ltd', '25000'],
    ];
    let failSheetFetch = false;

    const sheetsTransport: GoogleTransportAdapter = {
      exchangeAuthCode: async () => {
        throw new Error('unused');
      },
      refreshAccessToken: async () => {
        refreshedCount++;
        return {
          access_token: 'sheetsu:tok-refreshed',
          expiry_date: Date.now() + 3600_000,
        };
      },
      revokeToken: async () => {},
      fetchSpreadsheetMetadata: async () => {
        if (failSheetFetch) {
          throw new HttpApiError(403, 'SHEETS_PERMISSION_DENIED', 'No access to sheet.');
        }
        return {
          spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
          title: 'Q4 Invoices',
          sheets: [{ sheetId: 0, title: 'Invoices', index: 0, rowCount: 100, columnCount: 10 }],
        };
      },
      fetchSheetValues: async () => sheetRows,
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      transport: sheetsTransport,
      driveTransport: drive.asAdapter(),
    };

    // Missing sheets scope -> 403 SHEETS_SCOPE_REQUIRED
    const noSheetsCookies = makeSignedSessionCookie({
      uid: 'sub-sheets',
      em: 'sheets@biz.test',
      nm: 'Sheets User',
      pic: null,
      at: 'sheetsu:tok-1',
      rt: 'sheetsu:ref-1',
      exp: Date.now() + 3600_000,
      sc: SIGNIN_GOOGLE_SCOPES.join(' '),
      cat: new Date().toISOString(),
    });
    const scopeFailRes = createMockRes();
    await handleSheetsMetadata(
      createReq({
        method: 'GET',
        query: { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit' },
        cookies: noSheetsCookies,
      }),
      scopeFailRes.res,
      deps
    );
    assert.equal(scopeFailRes.statusCode, 403);
    assert.equal(scopeFailRes.json().code, 'SHEETS_SCOPE_REQUIRED');

    // Expired access token with sheets scope -> auto-refreshes and persists Set-Cookie
    const expiredSheetsCookies = makeSignedSessionCookie({
      uid: 'sub-sheets',
      em: 'sheets@biz.test',
      nm: 'Sheets User',
      pic: null,
      at: 'sheetsu:tok-expired',
      rt: 'sheetsu:ref-1',
      exp: Date.now() - 10_000,
      sc: [...SIGNIN_GOOGLE_SCOPES, GOOGLE_SHEETS_SCOPE].join(' '),
      cat: new Date().toISOString(),
    });

    const sync1 = createMockRes();
    await handleSheetsSync(
      createReq({
        method: 'POST',
        cookies: expiredSheetsCookies,
        body: {
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
          sheetName: 'Invoices',
        },
      }),
      sync1.res,
      deps
    );
    assert.equal(sync1.statusCode, 200);
    assert.equal(refreshedCount, 1, 'Expired access token must refresh automatically');
    assert.equal(sync1.json().totalRows, 2);
    assert.equal(sync1.json().stats.createdCount, 2);
    const freshCookies = { ...expiredSheetsCookies, ...sync1.getCookies() };

    // Second identical sync -> no_changes
    const sync2 = createMockRes();
    await handleSheetsSync(
      createReq({
        method: 'POST',
        cookies: freshCookies,
        body: {
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
          sheetName: 'Invoices',
        },
      }),
      sync2.res,
      deps
    );
    assert.equal(sync2.statusCode, 200);
    assert.equal(sync2.json().status, 'no_changes');

    // Permission error on subsequent sync -> 403 while preserving prior synced rows in Drive
    failSheetFetch = true;
    const syncErr = createMockRes();
    await handleSheetsSync(
      createReq({
        method: 'POST',
        cookies: freshCookies,
        body: {
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
          sheetName: 'Invoices',
        },
      }),
      syncErr.res,
      deps
    );
    assert.equal(syncErr.statusCode, 403);

    const persistedAfterErr = createMockRes();
    await handleSheetsData(createReq({ method: 'GET', cookies: freshCookies }), persistedAfterErr.res, deps);
    assert.equal(persistedAfterErr.statusCode, 200);
    assert.equal(persistedAfterErr.json().spreadsheet.totalRows, 2, 'Prior rows must stay intact on sync failure');
  });

  test('8. Dual Email Delivery: Gmail API + Encrypted SMTP in Drive, Test Send, Delete & Zero Silent Fallback', async () => {
    const drive = new MultiUserMockDrive();
    const sentViaGmail: any[] = [];
    const sentViaSmtp: any[] = [];
    let smtpVerifyCalls = 0;

    const emailTransport: EmailTransportAdapter = {
      sendViaGmail: async (params) => {
        sentViaGmail.push(params);
        return { messageId: `gmail-msg-${sentViaGmail.length}` };
      },
      verifySmtp: async (params) => {
        smtpVerifyCalls++;
        if (params.host === 'bad.smtp.test') {
          throw new Error('Connection refused');
        }
      },
      sendViaSmtp: async (params) => {
        sentViaSmtp.push(params);
        return { messageId: `smtp-msg-${sentViaSmtp.length}` };
      },
    };

    const deps: HandlerRuntimeDeps = {
      getConfig: () => TEST_CONFIG,
      driveTransport: drive.asAdapter(),
      emailTransport,
    };

    const baseCookiesNoGmail = makeSignedSessionCookie({
      uid: 'sub-mailer',
      em: 'mailer@biz.test',
      nm: 'Mailer',
      pic: null,
      at: 'mailer:tok-1',
      rt: 'mailer:ref-1',
      exp: Date.now() + 3600_000,
      sc: SIGNIN_GOOGLE_SCOPES.join(' '),
      cat: new Date().toISOString(),
    });

    const fullCookiesWithGmail = makeSignedSessionCookie({
      uid: 'sub-mailer',
      em: 'mailer@biz.test',
      nm: 'Mailer',
      pic: null,
      at: 'mailer:tok-1',
      rt: 'mailer:ref-1',
      exp: Date.now() + 3600_000,
      sc: [...SIGNIN_GOOGLE_SCOPES, GOOGLE_GMAIL_SEND_SCOPE].join(' '),
      cat: new Date().toISOString(),
    });

    // Save SMTP config -> encrypted at rest in Drive; password NEVER returned by GET
    const secretPass = 'SmtpSuperSecret#2026';
    const saveSmtp = createMockRes();
    await handleSmtpConfig(
      createReq({
        method: 'PUT',
        cookies: baseCookiesNoGmail,
        body: {
          host: 'smtp.company.test',
          port: 587,
          securityMode: 'STARTTLS',
          username: 'billing@company.test',
          password: secretPass,
          senderName: 'Billing Desk',
          senderEmail: 'billing@company.test',
        },
      }),
      saveSmtp.res,
      deps
    );
    assert.equal(saveSmtp.statusCode, 200);
    assert.equal(saveSmtp.json().smtpConfig.hasPassword, true);
    assert.equal(saveSmtp.body.includes(secretPass), false, 'API response must never leak SMTP password');

    // Verify raw Drive file smtp-config.enc.json does NOT contain plaintext password
    const rawSmtpFile = drive
      .getFilesForOwner('mailer')
      .find((f) => f.summary.name === 'smtp-config.enc.json');
    assert.ok(rawSmtpFile, 'smtp-config.enc.json must be stored in Drive');
    const rawSmtpText = rawSmtpFile!.content.toString('utf8');
    assert.equal(rawSmtpText.includes(secretPass), false, 'Drive file must encrypt SMTP password');

    // Verify GET returns public metadata only
    const getSmtp = createMockRes();
    await handleSmtpConfig(createReq({ method: 'GET', cookies: baseCookiesNoGmail }), getSmtp.res, deps);
    assert.equal(getSmtp.statusCode, 200);
    assert.equal(getSmtp.json().smtpConfig.configured, true);
    assert.equal('password' in getSmtp.json().smtpConfig, false);

    // Test SMTP connection
    const testConn = createMockRes();
    await handleSmtpTest(createReq({ method: 'POST', cookies: baseCookiesNoGmail, body: {} }), testConn.res, deps);
    assert.equal(testConn.statusCode, 200);
    assert.equal(smtpVerifyCalls, 1);

    // Send test email via SMTP
    const testSendSmtp = createMockRes();
    await handleEmailTestSend(
      createReq({
        method: 'POST',
        cookies: baseCookiesNoGmail,
        body: { method: 'smtp', to: 'client@example.com' },
      }),
      testSendSmtp.res,
      deps
    );
    assert.equal(testSendSmtp.statusCode, 200);
    assert.equal(sentViaSmtp.length, 1);
    assert.equal(sentViaSmtp[0].password, secretPass, 'Backend decrypts SMTP password for dispatch');

    // Strict zero silent fallback: requesting Gmail without gmail.send scope MUST return 403 (never fall back to SMTP!)
    const gmailNoScope = createMockRes();
    await handleEmailSend(
      createReq({
        method: 'POST',
        cookies: baseCookiesNoGmail,
        body: {
          method: 'gmail',
          items: [
            {
              documentType: 'invoice',
              documentId: 'inv-1',
              documentNumber: 'INV-1',
              to: 'client@example.com',
              subject: 'Invoice INV-1',
              textBody: 'Attached.',
            },
          ],
        },
      }),
      gmailNoScope.res,
      deps
    );
    assert.equal(gmailNoScope.statusCode, 403);
    assert.equal(gmailNoScope.json().code, 'GMAIL_SCOPE_REQUIRED');
    assert.equal(sentViaSmtp.length, 1, 'Gmail failure must NEVER silently fall back to SMTP');

    // Send invoice PDF via Gmail with gmail.send scope
    const gmailSend = createMockRes();
    await handleEmailSend(
      createReq({
        method: 'POST',
        cookies: fullCookiesWithGmail,
        body: {
          method: 'gmail',
          items: [
            {
              documentType: 'invoice',
              documentId: 'inv-1',
              documentNumber: 'INV-1',
              to: 'client@example.com',
              subject: 'Invoice INV-1',
              textBody: 'Please find attached.',
              attachment: {
                filename: 'INV-1.pdf',
                contentBase64: Buffer.from('%PDF-1.4 sample').toString('base64'),
              },
            },
          ],
        },
      }),
      gmailSend.res,
      deps
    );
    assert.equal(gmailSend.statusCode, 200);
    assert.equal(sentViaGmail.length, 1);

    // Send test email via Gmail
    const testSendGmail = createMockRes();
    await handleEmailTestSend(
      createReq({
        method: 'POST',
        cookies: fullCookiesWithGmail,
        body: { method: 'gmail', to: 'mailer@biz.test' },
      }),
      testSendGmail.res,
      deps
    );
    assert.equal(testSendGmail.statusCode, 200);
    assert.equal(sentViaGmail.length, 2);

    // Verify email history persisted in Drive Email Records/
    const historyRes = createMockRes();
    await handleEmailHistory(createReq({ method: 'GET', cookies: fullCookiesWithGmail }), historyRes.res, deps);
    assert.equal(historyRes.statusCode, 200);
    assert.equal(historyRes.json().logs.length, 3);

    // Delete SMTP config -> subsequent SMTP send must return 400 (never silently fall back to Gmail!)
    const delSmtp = createMockRes();
    await handleSmtpConfig(createReq({ method: 'DELETE', cookies: fullCookiesWithGmail }), delSmtp.res, deps);
    assert.equal(delSmtp.statusCode, 200);
    assert.equal(delSmtp.json().deleted, true);

    const smtpAfterDelete = createMockRes();
    await handleEmailSend(
      createReq({
        method: 'POST',
        cookies: fullCookiesWithGmail,
        body: {
          method: 'smtp',
          items: [
            {
              documentType: 'quotation',
              documentId: 'q-1',
              documentNumber: 'QT-1',
              to: 'client@example.com',
              subject: 'Quote QT-1',
              textBody: 'Attached.',
            },
          ],
        },
      }),
      smtpAfterDelete.res,
      deps
    );
    assert.equal(smtpAfterDelete.statusCode, 400);
    assert.equal(smtpAfterDelete.json().code, 'SMTP_NOT_CONFIGURED');
    assert.equal(sentViaGmail.length, 2, 'SMTP failure must NEVER silently fall back to Gmail');

    // Crypto helper sanity
    const cipher = encryptSecret('hello-secret', TEST_CONFIG.tokenEncryptionKey);
    assert.equal(decryptSecret(cipher, TEST_CONFIG.tokenEncryptionKey), 'hello-secret');

    // Auth status endpoint reflects connected flags accurately
    const authStatusRes = createMockRes();
    await handleAuthStatus(createReq({ method: 'GET', cookies: fullCookiesWithGmail }), authStatusRes.res, deps);
    assert.equal(authStatusRes.statusCode, 200);
    assert.equal(authStatusRes.json().authenticated, true);
    assert.equal(authStatusRes.json().user.driveConnected, true);
    assert.equal(authStatusRes.json().user.gmailConnected, true);
    assert.equal(authStatusRes.json().user.smtpConfigured, false);
  });
});
