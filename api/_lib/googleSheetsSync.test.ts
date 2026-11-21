/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AppServerConfig,
  getIntegrationDiagnostics,
  normalizeServiceAccountPrivateKey,
  validateServiceAccountPrivateKey,
} from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import {
  DRIVE_ROOT_FOLDER_NAME,
  diagnoseDriveFolderAccess,
  DriveFileMeta,
  DriveWorkspaceFolders,
  extractDriveFolderId,
  mapDriveApiError,
} from './driveService.js';
import {
  DriveTransport,
  GoogleDriveStore,
  WorkspaceFolderSlot,
} from './driveStore.js';
import {
  deleteSmtpConfig,
  getPublicSmtpConfig,
  saveSmtpConfig,
} from './emailBackendService.js';
import { handleDriveDiagnose, handleHealth, handleWorkspace } from './handlers.js';
import { NormalizedRequest, NormalizedResponse } from './http.js';
import {
  buildSheetRange,
  computeSyncDiff,
  extractSpreadsheetId,
  normalizeSheetValues,
} from './sheetsNormalization.js';

const TEST_CONFIG: AppServerConfig = {
  appUrl: 'http://localhost:3000',
  googleServiceAccountEmail: 'invoice-studio-sa@demo-project.iam.gserviceaccount.com',
  googleServiceAccountPrivateKey:
    '-----BEGIN PRIVATE KEY-----\nTEST_KEY_DATA\n-----END PRIVATE KEY-----\n',
  googleProjectId: 'demo-project',
  smtpEncryptionKey: 'super-secret-aes256-smtp-encryption-key-32-chars!!',
  isProduction: false,
};

interface MockRes {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  json(): any;
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
  headers?: Record<string, string>;
}): NormalizedRequest {
  return {
    method: opts.method || 'GET',
    url: opts.url || '/api/test',
    query: opts.query || {},
    body: opts.body,
    headers: {
      host: 'localhost:3000',
      ...(opts.headers || {}),
    },
  } as unknown as NormalizedRequest;
}

/**
 * In-memory DriveTransport isolated per business folderId.
 */
function createMemoryDriveTransport(folderId: string, folderName: string): {
  transport: DriveTransport;
  files: Map<string, { meta: DriveFileMeta; content: Buffer }>;
} {
  const files = new Map<string, { meta: DriveFileMeta; content: Buffer }>();
  const slotMap = new Map<string, string>(); // `${slot}/${fileName}` -> fileId
  let seq = 1;

  const folders: DriveWorkspaceFolders = {
    connectedFolderId: folderId,
    connectedFolderName: folderName,
    rootFolderId: `${folderId}_root`,
    companySettingsFolderId: `${folderId}_company`,
    customersFolderId: `${folderId}_customers`,
    importedDataFolderId: `${folderId}_imported`,
    invoicesFolderId: `${folderId}_invoices`,
    invoicesPdfsFolderId: `${folderId}_invoices_pdfs`,
    invoicesRecordsFolderId: `${folderId}_invoices_records`,
    quotationsFolderId: `${folderId}_quotations`,
    quotationsPdfsFolderId: `${folderId}_quotations_pdfs`,
    quotationsRecordsFolderId: `${folderId}_quotations_records`,
    emailHistoryFolderId: `${folderId}_email_history`,
    backupsFolderId: `${folderId}_backups`,
  };

  const transport: DriveTransport = {
    ensureFolders: async () => folders,
    readJson: async <T>(slot: WorkspaceFolderSlot, fileName: string): Promise<T | null> => {
      const id = slotMap.get(`${slot}/${fileName}`);
      if (!id) return null;
      const entry = files.get(id);
      if (!entry) return null;
      return JSON.parse(entry.content.toString('utf8')) as T;
    },
    writeJson: async <T>(slot: WorkspaceFolderSlot, fileName: string, data: T) => {
      const key = `${slot}/${fileName}`;
      const existingId = slotMap.get(key);
      const id = existingId || `${folderId}_file_${seq++}`;
      const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
      const meta: DriveFileMeta = {
        id,
        name: fileName,
        mimeType: 'application/json',
        modifiedTime: new Date().toISOString(),
        size: String(buf.length),
      };
      slotMap.set(key, id);
      files.set(id, { meta, content: buf });
      return meta;
    },
    uploadBinary: async (slot, fileName, mimeType, buffer) => {
      const key = `${slot}/${fileName}`;
      const id = slotMap.get(key) || `${folderId}_bin_${seq++}`;
      const meta: DriveFileMeta = {
        id,
        name: fileName,
        mimeType,
        modifiedTime: new Date().toISOString(),
        size: String(buffer.length),
      };
      slotMap.set(key, id);
      files.set(id, { meta, content: buffer });
      return meta;
    },
    listFiles: async (slot) => {
      const prefix = `${slot}/`;
      const out: DriveFileMeta[] = [];
      for (const [k, id] of slotMap.entries()) {
        if (k.startsWith(prefix)) {
          const entry = files.get(id);
          if (entry) out.push(entry.meta);
        }
      }
      return out;
    },
    downloadText: async (fileId) => {
      const entry = files.get(fileId);
      if (!entry) throw new Error(`File ${fileId} not found`);
      return entry.content.toString('utf8');
    },
  };

  return { transport, files };
}

describe('Invoice Studio — No-Sign-In Service Account & Workspace Isolation Suite', () => {
  test('1. Architecture Integrity: Zero Auth, Zero Firebase, Zero PostgreSQL, Clean Server Env', () => {
    const rootDir = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    assert.equal('firebase' in allDeps, false, 'firebase must not be installed');
    assert.equal('pg' in allDeps, false, 'pg must not be installed');
    assert.equal('@types/pg' in allDeps, false, '@types/pg must not be installed');
    assert.equal('nodemailer' in allDeps, true, 'nodemailer must be installed for Gmail/Custom SMTP');
    assert.equal('googleapis' in allDeps, true, 'googleapis must be installed for Service Account Drive/Sheets');

    const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
    assert.equal(/firebase/i.test(envExample), false);
    assert.equal(/DATABASE_URL|POSTGRES/i.test(envExample), false);
    assert.equal(/GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|SESSION_SECRET/i.test(envExample), false);
    for (const requiredVar of [
      'APP_URL',
      'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
      'GOOGLE_PROJECT_ID',
      'SMTP_ENCRYPTION_KEY',
    ]) {
      assert.equal(envExample.includes(requiredVar), true, `.env.example must define ${requiredVar}`);
    }

    assert.equal(fs.existsSync(path.join(rootDir, 'api/auth')), false, 'api/auth directory must be deleted');
    assert.equal(fs.existsSync(path.join(rootDir, 'api/_lib/db.ts')), false, 'api/_lib/db.ts must not exist');
    assert.equal(fs.existsSync(path.join(rootDir, 'src/firebase.ts')), false, 'src/firebase.ts must not exist');
  });

  test('2. Fresh Visitor Experience: Zero Preloaded Demo Data & Isolated Temporary Storage', async () => {
    const { storage } = await import('../../src/utils/storage');
    const { defaultCompanySettings, defaultMappingProfiles, sampleSpreadsheetData } = await import(
      '../../src/mockData'
    );

    assert.equal(defaultCompanySettings.legalName, '');
    assert.equal(defaultCompanySettings.gstin, '');
    assert.equal(defaultCompanySettings.bankAccounts.length, 0);
    assert.equal(defaultMappingProfiles.length, 0);
    assert.equal(sampleSpreadsheetData.worksheets.length, 0);

    storage.clearDriveConnection();
    assert.deepEqual(storage.loadCustomers(), []);
    assert.deepEqual(storage.loadHistory(), []);
    assert.deepEqual(storage.loadQuotations(), []);
    assert.equal(storage.loadSpreadsheetData().worksheets.length, 0);
  });

  test('3. Google Drive Folder URL & Google Sheets URL Extraction / Validation', () => {
    assert.equal(
      extractDriveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWx?usp=sharing'),
      '1AbCdEfGhIjKlMnOpQrStUvWx'
    );
    assert.equal(
      extractDriveFolderId('https://drive.google.com/drive/u/0/folders/1XyZ9876543210abcdef_gh'),
      '1XyZ9876543210abcdef_gh'
    );
    assert.throws(() => extractDriveFolderId('https://example.com/not-a-drive-folder'));
    assert.throws(() => extractDriveFolderId(''));

    assert.equal(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0'),
      '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
    );
    assert.throws(() => extractSpreadsheetId('https://example.com/not-a-sheet'));
    assert.equal(buildSheetRange("Sales '2026'", 'A1:F50'), "'Sales ''2026'''!A1:F50");
  });

  test('4. Public Health & Diagnostics Never Leak Private Keys or Encryption Keys', async () => {
    const diag = getIntegrationDiagnostics('http://localhost:3000');
    assert.equal('googleServiceAccountPrivateKey' in diag, false);
    assert.equal('smtpEncryptionKey' in diag, false);

    const healthRes = createMockRes();
    await handleHealth(createReq({ url: '/api/health' }), healthRes.res);
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.json().status, 'ok');
    assert.equal(healthRes.body.includes('PRIVATE KEY'), false);

    // Calling /api/workspace without a Drive folder returns 400 DRIVE_NOT_CONNECTED (not 401 auth gate)
    const wsRes = createMockRes();
    await handleWorkspace(createReq({ method: 'GET', url: '/api/workspace' }), wsRes.res);
    assert.equal(wsRes.statusCode, 400);
    assert.equal(wsRes.json().code, 'DRIVE_NOT_CONNECTED');
  });

  test('5. Business Workspace Isolation: Folder A vs Folder B Have Zero Cross-Contamination', async () => {
    const mockA = createMemoryDriveTransport('folder_business_alpha_001', 'Alpha Corp Finance');
    const mockB = createMemoryDriveTransport('folder_business_beta_002', 'Beta Studio Billing');

    const storeA = new GoogleDriveStore({
      folderId: 'folder_business_alpha_001',
      config: TEST_CONFIG,
      driveTransport: mockA.transport,
    });
    const storeB = new GoogleDriveStore({
      folderId: 'folder_business_beta_002',
      config: TEST_CONFIG,
      driveTransport: mockB.transport,
    });

    assert.equal(DRIVE_ROOT_FOLDER_NAME, 'Invoice Studio');

    await storeA.writeWorkspaceState({
      company: { legalName: 'Alpha Solutions LLP', email: 'billing@alpha.test' },
      fieldCatalog: [],
      mappingProfiles: [],
      layoutConfig: null,
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
    await storeA.writeCustomers([
      { id: 'cust_a1', customerName: 'Northstar Logistics', email: 'ap@northstar.test' },
    ]);
    await storeA.writeInvoices([
      { id: 'inv_a1', invoiceNumber: 'INV-2026-001', customerName: 'Northstar Logistics', totalAmount: 59000 },
    ]);
    await storeA.uploadInvoicePdf('INV-2026-001.pdf', Buffer.from('%PDF-1.4 alpha-invoice'));

    const backupA = await storeA.createBackupSnapshot();
    assert.equal(backupA.snapshot.customers.length, 1);
    assert.equal(backupA.snapshot.invoices.length, 1);

    // Business B connects its own folder -> MUST see zero Alpha records or PDFs
    const exportedB = await storeB.exportAllWorkspaceData();
    assert.equal(exportedB.workspace, null);
    assert.equal(exportedB.customers.length, 0);
    assert.equal(exportedB.invoices.length, 0);
    assert.equal(exportedB.quotations.length, 0);
    assert.equal((await storeB.listInvoicePdfs()).length, 0);

    // Business A reconnects -> restores all Alpha records and PDFs accurately
    const exportedA = await storeA.exportAllWorkspaceData();
    assert.equal(exportedA.workspace?.company?.legalName, 'Alpha Solutions LLP');
    assert.equal(exportedA.customers.length, 1);
    assert.equal(exportedA.invoices.length, 1);
    assert.equal((await storeA.listInvoicePdfs()).length, 1);
  });

  test('6. Gmail SMTP & Custom SMTP AES-256-GCM Encryption At Rest (Never Exposed in Plaintext)', async () => {
    const mockDrive = createMemoryDriveTransport('folder_smtp_test_001', 'SMTP Test Folder');
    const store = new GoogleDriveStore({
      folderId: 'folder_smtp_test_001',
      config: TEST_CONFIG,
      driveTransport: mockDrive.transport,
    });

    const appPassword = 'abcd efgh ijkl mnop';
    const saved = await saveSmtpConfig({
      config: TEST_CONFIG,
      driveStore: store,
      input: {
        provider: 'gmail_smtp',
        host: 'smtp.gmail.com',
        port: 465,
        encryption: 'SSL',
        username: 'accounts@example.com',
        password: appPassword,
        senderName: 'Example Billing',
        senderEmail: 'accounts@example.com',
      },
    });

    assert.equal(saved.configured, true);
    assert.equal(saved.persistedInDrive, true);
    assert.equal(saved.hasPassword, true);
    assert.equal('password' in saved, false, 'Public SMTP config must never include password');

    // Verify stored Drive file does not contain plaintext password
    const storedFiles = Array.from(mockDrive.files.values());
    const encFile = storedFiles.find((f) => f.meta.name === 'smtp-config.enc.json');
    assert.ok(encFile, 'Encrypted SMTP file must exist in Company Settings');
    assert.equal(encFile!.content.toString('utf8').includes(appPassword), false);

    // Verify encryption helper roundtrip & tamper protection
    const encrypted = encryptSecret('secret-smtp-value', TEST_CONFIG.smtpEncryptionKey);
    assert.equal(decryptSecret(encrypted, TEST_CONFIG.smtpEncryptionKey), 'secret-smtp-value');
    assert.throws(() => decryptSecret(encrypted, 'wrong-key-must-fail-decryption-32ch'));

    // Delete SMTP config
    await deleteSmtpConfig({ driveStore: store });
    const afterDelete = await getPublicSmtpConfig({ driveStore: store });
    assert.equal(afterDelete.configured, false);
    assert.equal(afterDelete.hasPassword, false);
  });

  test('7. Google Sheets Normalization: Preserves Leading Zeros, Handles Blank Rows & Duplicate Headers', () => {
    const { worksheet, rowRecords } = normalizeSheetValues(
      'Invoices',
      [
        ['Monthly Billing Export'],
        ['Invoice No', 'Customer', 'Phone', 'Amount', 'Amount'],
        ['INV-001', 'Riya', '009811000', '50,000', '₹ 59,000.00'],
        ['', '', '', '', ''],
      ],
      { headerRowIndex: 'auto' }
    );

    assert.equal(worksheet.headerRowIndex, 1);
    assert.equal(worksheet.rows.length, 1);
    assert.equal(worksheet.skippedEmptyRows, 1);
    assert.equal(worksheet.rows[0]['Phone'], '009811000', 'Leading zeros must be preserved');
    assert.deepEqual(worksheet.headers, ['Invoice No', 'Customer', 'Phone', 'Amount', 'Amount (2)']);

    const diff = computeSyncDiff(
      new Map(),
      rowRecords.map((r) => ({ compositeKey: `${worksheet.name}:${r.rowKey}`, rowHash: r.rowHash })),
      worksheet.rawRowCount,
      worksheet.skippedEmptyRows
    );
    assert.equal(diff.createdCount, 1);
  });

  test('8. Drive Diagnostics: Exact files.get Fields, permissions.list Writer Check, listChildren & Zero Mutations', async () => {
    const saEmail = 'instservice@invoice-studio-515206.iam.gserviceaccount.com';
    const saConfig: AppServerConfig = {
      ...TEST_CONFIG,
      googleServiceAccountEmail: saEmail,
      googleProjectId: 'invoice-studio-515206',
    };

    let capturedGetArgs: any = null;
    let mutatingCalls = 0;

    const mockDrive: any = {
      files: {
        async get(args: any) {
          capturedGetArgs = args;
          return {
            status: 200,
            data: {
              id: args.fileId,
              name: 'Client Billing Folder',
              mimeType: 'application/vnd.google-apps.folder',
              trashed: false,
              capabilities: {
                canEdit: true,
                canAddChildren: true,
                canListChildren: true,
              },
            },
          };
        },
        async list() {
          return {
            status: 200,
            data: {
              files: [{ id: 'child_1', name: 'Invoice Studio', mimeType: 'application/vnd.google-apps.folder' }],
            },
          };
        },
        async create() {
          mutatingCalls++;
          throw new Error('Diagnostics must NEVER call files.create');
        },
        async update() {
          mutatingCalls++;
          throw new Error('Diagnostics must NEVER call files.update');
        },
        async delete() {
          mutatingCalls++;
          throw new Error('Diagnostics must NEVER call files.delete');
        },
      },
      permissions: {
        async list() {
          return {
            status: 200,
            data: {
              permissions: [
                { id: 'p1', type: 'user', role: 'owner', emailAddress: 'owner@example.com' },
                { id: 'p2', type: 'user', role: 'writer', emailAddress: saEmail },
              ],
            },
          };
        },
      },
    };

    const report = await diagnoseDriveFolderAccess({
      folderUrlOrId: 'https://drive.google.com/drive/u/0/folders/1MyDriveFolderId987654321?usp=sharing',
      config: saConfig,
      driveClientOverride: mockDrive,
    });

    assert.equal(mutatingCalls, 0, 'Diagnostics must be strictly read-only');
    assert.equal(report.ok, true);
    assert.equal(report.serviceAccountEmail, saEmail);
    assert.equal(report.extractedFolderId, '1MyDriveFolderId987654321');
    assert.equal(
      capturedGetArgs?.fields,
      'id,name,mimeType,trashed,capabilities(canEdit,canAddChildren,canListChildren)'
    );
    assert.equal(report.steps.folderMetadata.ok, true);
    assert.equal(report.steps.folderMetadata.folder?.isFolder, true);
    assert.equal(report.steps.folderMetadata.folder?.trashed, false);
    assert.equal(report.steps.permissionsList.accessible, true);
    assert.equal(report.steps.permissionsList.serviceAccountPermissionFound, true);
    assert.equal(report.steps.permissionsList.serviceAccountRole, 'writer');
    assert.equal(report.steps.permissionsList.hasWriterPermission, true);
    assert.equal(report.steps.listChildren.ok, true);
    assert.equal(report.steps.listChildren.childrenCount, 1);
    assert.equal(report.steps.listChildren.hasInvoiceStudioFolder, true);
    assert.equal(report.diagnosis.probableCause, 'HEALTHY');
    assert.equal(JSON.stringify(report).includes('TEST_KEY_DATA'), false, 'Private key must never leak');

    // My Drive Editor restriction: permissions.list returns 403 -> still healthy if files.get & files.list succeed
    const mockDriveRestrictedPermList = {
      ...mockDrive,
      permissions: {
        async list() {
          const err: any = new Error('The user does not have sufficient permissions for this file.');
          err.response = {
            status: 403,
            data: { error: { errors: [{ reason: 'insufficientFilePermissions', message: err.message }] } },
          };
          throw err;
        },
      },
    };

    const reportRestrictedPerm = await diagnoseDriveFolderAccess({
      folderUrlOrId: 'https://drive.google.com/drive/folders/1MyDriveFolderId987654321',
      config: saConfig,
      driveClientOverride: mockDriveRestrictedPermList,
    });
    assert.equal(reportRestrictedPerm.ok, true);
    assert.equal(reportRestrictedPerm.steps.permissionsList.accessible, false);
    assert.equal(reportRestrictedPerm.steps.permissionsList.apiStatus, 403);
    assert.equal(reportRestrictedPerm.diagnosis.probableCause, 'HEALTHY');
  });

  test('9. Drive Diagnostics & Error Mapper Distinguish Specific Causes (No Generic Access Denied)', async () => {
    const saConfig: AppServerConfig = {
      ...TEST_CONFIG,
      googleServiceAccountEmail: 'instservice@invoice-studio-515206.iam.gserviceaccount.com',
      googleProjectId: 'invoice-studio-515206',
    };

    const makeErrorDrive = (status: number, reason: string, message: string): any => ({
      files: {
        async get() {
          const err: any = new Error(message);
          err.response = {
            status,
            data: { error: { code: status, message, errors: [{ reason, message }] } },
          };
          throw err;
        },
        async list() {
          return { status: 200, data: { files: [] } };
        },
      },
      permissions: {
        async list() {
          return { status: 200, data: { permissions: [] } };
        },
      },
    });

    // 1. Google Drive API disabled (403 accessNotConfigured)
    const disabledReport = await diagnoseDriveFolderAccess({
      folderUrlOrId: 'https://drive.google.com/drive/folders/1FolderDisabledApiTest1234',
      config: saConfig,
      driveClientOverride: makeErrorDrive(
        403,
        'accessNotConfigured',
        'Google Drive API has not been used in project invoice-studio-515206 before or it is disabled.'
      ),
    });
    assert.equal(disabledReport.ok, false);
    assert.equal(disabledReport.diagnosis.probableCause, 'DRIVE_API_DISABLED');
    assert.equal(disabledReport.diagnosis.apiStatus, 403);
    assert.equal(disabledReport.diagnosis.apiReason, 'accessNotConfigured');

    // 2. Folder 404 notFound (wrong SA email or folder not shared)
    const notFoundReport = await diagnoseDriveFolderAccess({
      folderUrlOrId: 'https://drive.google.com/drive/folders/1FolderNotFoundTest123456',
      config: saConfig,
      driveClientOverride: makeErrorDrive(404, 'notFound', 'File not found: 1FolderNotFoundTest123456.'),
    });
    assert.equal(notFoundReport.ok, false);
    assert.equal(notFoundReport.diagnosis.probableCause, 'FOLDER_NOT_FOUND_OR_NOT_SHARED');
    assert.equal(notFoundReport.diagnosis.apiStatus, 404);
    assert.equal(notFoundReport.diagnosis.apiReason, 'notFound');
    assert.ok(notFoundReport.diagnosis.summary.includes('instservice@invoice-studio-515206.iam.gserviceaccount.com'));

    // 3. Invalid JWT / invalid_grant (400)
    const authErrReport = await diagnoseDriveFolderAccess({
      folderUrlOrId: 'https://drive.google.com/drive/folders/1FolderAuthErrorTest12345',
      config: saConfig,
      driveClientOverride: makeErrorDrive(400, 'invalid_grant', 'Invalid JWT Signature.'),
    });
    assert.equal(authErrReport.diagnosis.probableCause, 'SERVICE_ACCOUNT_AUTH_FAILED');
    assert.equal(authErrReport.diagnosis.apiReason, 'invalid_grant');

    // 4. Limited-access / read-only capabilities
    const limitedDrive: any = {
      files: {
        async get() {
          return {
            status: 200,
            data: {
              id: '1LimitedAccessFolder12345',
              name: 'Restricted Folder',
              mimeType: 'application/vnd.google-apps.folder',
              trashed: false,
              capabilities: { canEdit: false, canAddChildren: false, canListChildren: true },
            },
          };
        },
        async list() {
          return { status: 200, data: { files: [] } };
        },
      },
      permissions: {
        async list() {
          return { status: 200, data: { permissions: [] } };
        },
      },
    };
    const limitedReport = await diagnoseDriveFolderAccess({
      folderUrlOrId: 'https://drive.google.com/drive/folders/1LimitedAccessFolder12345',
      config: saConfig,
      driveClientOverride: limitedDrive,
    });
    assert.equal(limitedReport.ok, false);
    assert.equal(limitedReport.diagnosis.probableCause, 'LIMITED_ACCESS_OR_READ_ONLY');

    // 5. mapDriveApiError distinguishes storageQuotaExceeded, accessNotConfigured, userRateLimitExceeded
    const quotaErr = mapDriveApiError(
      {
        response: {
          status: 403,
          data: {
            error: {
              message: 'Service Accounts do not have storage quota.',
              errors: [{ reason: 'storageQuotaExceeded', message: 'Service Accounts do not have storage quota.' }],
            },
          },
        },
      },
      saConfig,
      '1Folder12345678901234'
    );
    assert.equal(quotaErr.code, 'DRIVE_STORAGE_QUOTA_EXCEEDED');

    const rateErr = mapDriveApiError(
      {
        response: {
          status: 403,
          data: { error: { errors: [{ reason: 'userRateLimitExceeded', message: 'User rate limit exceeded.' }] } },
        },
      },
      saConfig,
      '1Folder12345678901234'
    );
    assert.equal(rateErr.code, 'DRIVE_RATE_LIMITED');
    assert.equal(rateErr.status, 429);
  });

  test('10. Service Account Private Key Normalization & Cryptographic PEM Validation', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    // Escaped single-line \n wrapped in quotes (typical Vercel UI paste)
    const vercelEscaped = `"${privateKey.replace(/\n/g, '\\n')}"`;
    const normalized1 = normalizeServiceAccountPrivateKey(vercelEscaped);
    assert.equal(validateServiceAccountPrivateKey(normalized1).valid, true);

    // Double-escaped \\n
    const doubleEscaped = privateKey.replace(/\n/g, '\\\\n');
    const normalized2 = normalizeServiceAccountPrivateKey(doubleEscaped);
    assert.equal(validateServiceAccountPrivateKey(normalized2).valid, true);

    // Full JSON service-account paste into private key env var
    const jsonPaste = JSON.stringify({ client_email: 'sa@proj.iam.gserviceaccount.com', private_key: privateKey });
    const normalized3 = normalizeServiceAccountPrivateKey(jsonPaste);
    assert.equal(validateServiceAccountPrivateKey(normalized3).valid, true);

    // Corrupted key fails validation with clear safe reason
    const badCheck = validateServiceAccountPrivateKey('-----BEGIN PRIVATE KEY-----\nCORRUPT\n-----END PRIVATE KEY-----');
    assert.equal(badCheck.valid, false);
    assert.ok(badCheck.reason && badCheck.reason.includes('PEM'));
  });

  test('11. Drive Folder URL Extraction Edge Cases (My Drive Root, Mobile, File Links, Bad Strings)', () => {
    assert.equal(
      extractDriveFolderId('https://drive.google.com/drive/mobile/folders/1MobFolderId987654321?usp=drive_link'),
      '1MobFolderId987654321'
    );
    assert.equal(
      extractDriveFolderId('https://drive.google.com/open?id=1OpenLinkFolder987654321'),
      '1OpenLinkFolder987654321'
    );
    assert.equal(
      extractDriveFolderId('https://drive.google.com/folderview?id=1LegacyFolder987654321&usp=sharing'),
      '1LegacyFolder987654321'
    );
    assert.throws(() => extractDriveFolderId('https://drive.google.com/drive/my-drive'));
    assert.throws(() => extractDriveFolderId('https://drive.google.com/drive/u/0/my-drive'));
    assert.throws(() => extractDriveFolderId('https://drive.google.com/file/d/1FileIdNotAFolder12345/view'));
    assert.throws(() => extractDriveFolderId('not-a-valid-drive-url'));
  });

  test('12. /api/drive/diagnose Endpoint Returns Safe Non-Destructive JSON Report', async () => {
    const req = createReq({
      method: 'POST',
      url: '/api/drive/diagnose',
      body: { folderUrl: 'https://drive.google.com/drive/folders/1DiagEndpointFolder123456' },
    });
    const res = createMockRes();
    await handleDriveDiagnose(req, res.res);
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.extractedFolderId, '1DiagEndpointFolder123456');
    assert.equal('privateKey' in json, false);
    assert.ok(json.diagnosis?.probableCause);
  });
});

