/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
  GoogleAuthError,
  InMemoryGoogleTokenManager,
} from './googleAuth';
import {
  DriveEmptyOverwriteError,
  DriveSyncConflictError,
  INVOICE_STUDIO_FOLDER_NAME,
  UserGoogleDriveClient,
  WORKSPACE_FILE_NAMES,
} from './googleDriveClient';
import {
  buildSpreadsheetDataFromSync,
  extractGoogleSheetId,
  fetchGoogleSheetWorksheetValues,
  syncGoogleSpreadsheet,
  validateGoogleSpreadsheet,
} from './googleSheets';
import { defaultCompanySettings, defaultFieldCatalog, defaultTemplates } from '../mockData';
import { storage } from './storage';

/**
 * Deterministic in-memory Google Drive v3 mock server supporting multi-account isolation,
 * folder creation, multipart/media uploads, headRevisionId/modifiedTime conflict tracking,
 * and 401 token expiry simulation.
 */
class MockGoogleDriveServer {
  private seq = 1;
  private files = new Map<
    string,
    {
      id: string;
      owner: string;
      name: string;
      mimeType: string;
      parents: string[];
      trashed: boolean;
      content: Buffer;
      modifiedTime: string;
      headRevisionId: string;
      canEdit: boolean;
    }
  >();

  private tokens = new Map<string, { owner: string; expired?: boolean }>();

  registerToken(token: string, owner: string) {
    this.tokens.set(token, { owner, expired: false });
  }

  expireToken(token: string) {
    const entry = this.tokens.get(token);
    if (entry) entry.expired = true;
  }

  createRootFolder(owner: string, name = INVOICE_STUDIO_FOLDER_NAME, id?: string): string {
    const folderId = id || `folder_${owner}_${this.seq++}`;
    this.files.set(folderId, {
      id: folderId,
      owner,
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
      trashed: false,
      content: Buffer.alloc(0),
      modifiedTime: new Date(Date.now() + this.seq * 1000).toISOString(),
      headRevisionId: `rev_${this.seq}`,
      canEdit: true,
    });
    return folderId;
  }

  bumpRemoteFileRevision(owner: string, fileName: string, newJsonPayload?: any) {
    for (const file of this.files.values()) {
      if (file.owner === owner && file.name === fileName && !file.trashed) {
        this.seq += 1;
        file.modifiedTime = new Date(Date.now() + this.seq * 5000).toISOString();
        file.headRevisionId = `rev_remote_${this.seq}`;
        if (newJsonPayload !== undefined) {
          file.content = Buffer.from(JSON.stringify(newJsonPayload), 'utf8');
        }
        return file;
      }
    }
    throw new Error(`Mock file not found: ${fileName}`);
  }

  getOwnedFiles(owner: string) {
    return Array.from(this.files.values()).filter((f) => f.owner === owner && !f.trashed);
  }

  fetchImpl: typeof fetch = async (input: any, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    const url = new URL(urlStr);
    const method = (init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers || {});
    const auth = headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const tokenMeta = this.tokens.get(token);

    if (!tokenMeta || tokenMeta.expired) {
      return new Response(
        JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const owner = tokenMeta.owner;
    const isUpload = url.pathname.startsWith('/upload/drive/v3/files');

    // GET /drive/v3/files (list/search)
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const parentMatch = q.match(/'([^']+)' in parents/);
      const nameMatch = q.match(/name = '([^']+)'/);
      const mimeMatch = q.match(/mimeType = '([^']+)'/);

      const results = Array.from(this.files.values()).filter((f) => {
        if (f.owner !== owner || f.trashed) return false;
        if (parentMatch && !f.parents.includes(parentMatch[1])) return false;
        if (nameMatch && f.name !== nameMatch[1]) return false;
        if (mimeMatch && f.mimeType !== mimeMatch[1]) return false;
        return true;
      });

      results.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));

      return new Response(
        JSON.stringify({
          files: results.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            headRevisionId: f.headRevisionId,
            size: String(f.content.length),
            webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // GET /drive/v3/files/:id
    const fileIdMatch = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (method === 'GET' && fileIdMatch) {
      const id = decodeURIComponent(fileIdMatch[1]);
      const file = this.files.get(id);
      if (!file || file.owner !== owner || file.trashed) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.searchParams.get('alt') === 'media') {
        return new Response(file.content.toString('utf8'), {
          status: 200,
          headers: { 'Content-Type': file.mimeType },
        });
      }
      return new Response(
        JSON.stringify({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          trashed: file.trashed,
          modifiedTime: file.modifiedTime,
          headRevisionId: file.headRevisionId,
          capabilities: {
            canEdit: file.canEdit,
            canAddChildren: file.canEdit,
            canListChildren: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // POST /drive/v3/files (create folder)
    if (method === 'POST' && url.pathname === '/drive/v3/files') {
      const body = JSON.parse(String(init?.body || '{}'));
      const id = `item_${owner}_${this.seq++}`;
      const record = {
        id,
        owner,
        name: body.name,
        mimeType: body.mimeType || 'application/octet-stream',
        parents: Array.isArray(body.parents) ? body.parents : ['root'],
        trashed: false,
        content: Buffer.alloc(0),
        modifiedTime: new Date(Date.now() + this.seq * 1000).toISOString(),
        headRevisionId: `rev_${this.seq}`,
        canEdit: true,
      };
      this.files.set(id, record);
      return new Response(
        JSON.stringify({
          id: record.id,
          name: record.name,
          mimeType: record.mimeType,
          modifiedTime: record.modifiedTime,
          headRevisionId: record.headRevisionId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // POST /upload/drive/v3/files?uploadType=multipart
    if (method === 'POST' && isUpload) {
      const contentType = headers.get('Content-Type') || '';
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      assert.ok(boundaryMatch, 'Multipart boundary required');
      const boundary = boundaryMatch[1];

      const rawBuf =
        init?.body instanceof Uint8Array
          ? Buffer.from(init.body)
          : Buffer.from(String(init?.body || ''), 'utf8');
      const rawStr = rawBuf.toString('binary');
      const parts = rawStr.split(`--${boundary}`);
      const metaPart = parts[1] || '';
      const dataPart = parts[2] || '';
      const metaJson = JSON.parse(metaPart.split('\r\n\r\n')[1].trim());
      const dataBody = dataPart.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');

      const id = `file_${owner}_${this.seq++}`;
      const record = {
        id,
        owner,
        name: metaJson.name,
        mimeType: metaJson.mimeType || 'application/octet-stream',
        parents: Array.isArray(metaJson.parents) ? metaJson.parents : ['root'],
        trashed: false,
        content: Buffer.from(dataBody, 'binary'),
        modifiedTime: new Date(Date.now() + this.seq * 1000).toISOString(),
        headRevisionId: `rev_${this.seq}`,
        canEdit: true,
      };
      this.files.set(id, record);
      return new Response(
        JSON.stringify({
          id: record.id,
          name: record.name,
          mimeType: record.mimeType,
          modifiedTime: record.modifiedTime,
          headRevisionId: record.headRevisionId,
          size: String(record.content.length),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // PATCH /upload/drive/v3/files/:id?uploadType=media
    const patchMatch = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (method === 'PATCH' && patchMatch) {
      const id = decodeURIComponent(patchMatch[1]);
      const file = this.files.get(id);
      if (!file || file.owner !== owner) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      this.seq += 1;
      file.content =
        init?.body instanceof Uint8Array
          ? Buffer.from(init.body)
          : Buffer.from(String(init?.body || ''), 'utf8');
      file.modifiedTime = new Date(Date.now() + this.seq * 1000).toISOString();
      file.headRevisionId = `rev_${this.seq}`;
      return new Response(
        JSON.stringify({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          headRevisionId: file.headRevisionId,
          size: String(file.content.length),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: { message: `Unhandled ${method} ${url.pathname}` } }), {
      status: 500,
    });
  };
}

function createEmptyDefaults() {
  return {
    company: { ...defaultCompanySettings, bankAccounts: [] },
    fieldCatalog: defaultFieldCatalog.map((f) => ({ ...f })),
    mappingProfiles: [],
    layoutConfig: { templates: [{ ...defaultTemplates[0] }] },
  };
}

test('InMemoryGoogleTokenManager stores tokens strictly in memory, detects expiry, and tracks incremental scopes', () => {
  const manager = new InMemoryGoogleTokenManager();
  let expiredTriggered = false;
  manager.onTokenExpired(() => {
    expiredTriggered = true;
  });

  const session = manager.setSession({
    accessToken: 'ya29.test_access_token_alpha_1234567890',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email`,
    accountEmail: 'owner@business-a.example',
    accountName: 'Business A',
  });

  assert.equal(session.accountEmail, 'owner@business-a.example');
  assert.equal(session.hasDriveScope, true);
  assert.equal(session.hasSheetsScope, false);
  assert.equal(manager.isTokenValid(), true);
  assert.equal(manager.getAccessToken(), 'ya29.test_access_token_alpha_1234567890');

  // Incremental Sheets scope granted
  const upgraded = manager.setSession({
    accessToken: 'ya29.test_access_token_alpha_upgraded_123',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email ${GOOGLE_SHEETS_READONLY_SCOPE}`,
    accountEmail: 'owner@business-a.example',
  });
  assert.equal(upgraded.hasDriveScope, true);
  assert.equal(upgraded.hasSheetsScope, true);

  // Expiry detection
  manager.markExpired();
  assert.equal(expiredTriggered, true);
  assert.equal(manager.getAccessToken(), null);
  assert.equal(manager.isTokenValid(), false);
  assert.equal(manager.getSessionInfo()?.accountEmail, 'owner@business-a.example');

  // Disconnect clears everything
  manager.clearAll();
  assert.equal(manager.getSessionInfo(), null);
  assert.equal(manager.getAccessToken(), null);
});

test('UserGoogleDriveClient creates Drive folder tree without duplicates, persists records, PDFs, assets & backups', async () => {
  const server = new MockGoogleDriveServer();
  const tokenMgr = new InMemoryGoogleTokenManager();
  server.registerToken('ya29.token_business_a_000001', 'businessA');
  tokenMgr.setSession({
    accessToken: 'ya29.token_business_a_000001',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email`,
    accountEmail: 'billing@business-a.example',
  });

  const client = new UserGoogleDriveClient({
    fetchImpl: server.fetchImpl,
    getAccessToken: () => tokenMgr.requireAccessToken(),
    onTokenExpired: () => tokenMgr.markExpired(),
  });

  // 1. Create or locate Invoice Studio folder twice — must NOT create duplicate
  const first = await client.findOrCreateInvoiceStudioFolder();
  const second = await client.findOrCreateInvoiceStudioFolder();
  assert.equal(first.createdNew, true);
  assert.equal(second.createdNew, false);
  assert.equal(first.id, second.id);

  // 2. Concurrent ensureWorkspaceStructure calls — must NOT duplicate subfolders
  const [tree1, tree2] = await Promise.all([
    client.ensureWorkspaceStructure(first.id),
    client.ensureWorkspaceStructure(first.id),
  ]);
  assert.deepEqual(tree1, tree2);
  const ownedFolders = server
    .getOwnedFiles('businessA')
    .filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  assert.equal(ownedFolders.length, 6); // Invoice Studio + workspace, Invoices, Quotations, Backups, Assets

  // 3. Initial load initializes genuinely empty workspace
  const initial = await client.loadOrInitializeWorkspace(first.id, createEmptyDefaults());
  assert.equal(initial.initializedNewWorkspace, true);
  assert.equal(initial.restoredExistingWorkspace, false);
  assert.equal(initial.bundle.customers.length, 0);
  assert.equal(initial.bundle.invoices.length, 0);
  assert.equal(initial.bundle.quotations.length, 0);

  // 4. Save real business data
  const populatedBundle = {
    ...initial.bundle,
    company: {
      ...defaultCompanySettings,
      legalName: 'Alpha Engineering LLP',
      displayName: 'Alpha Engineering',
      gstin: '27AAECA1234F1Z5',
      bankAccounts: [],
    },
    customers: [
      {
        id: 'cust_1',
        customerName: 'Acme Industrial Ltd',
        billingAddress: '100 Industrial Estate, Mumbai',
        email: 'ap@acme.example',
        updatedAt: new Date().toISOString(),
      },
    ],
    invoices: [
      {
        id: 'inv_1',
        invoiceNumber: 'INV-2026-001',
        customerName: 'Acme Industrial Ltd',
        sourceType: 'manual' as const,
        sourceName: 'Manual Entry',
        worksheetName: 'Manual',
        totalAmount: 11800,
        gstAmount: 1800,
        templateId: 'tpl_1',
        profileId: 'prof_1',
        revisionNumber: 1,
        generatedDate: '2026-05-01',
        status: 'success' as const,
        paymentStatus: 'Unpaid',
        paymentAmount: 0,
        dataSnapshot: {},
      },
    ],
  };

  await client.saveWorkspace(first.id, populatedBundle);

  // 5. Empty overwrite guard must block accidental empty write
  await assert.rejects(
    () =>
      client.saveWorkspace(first.id, {
        ...initial.bundle,
        company: { ...defaultCompanySettings, bankAccounts: [] },
        customers: [],
        invoices: [],
        quotations: [],
      }),
    DriveEmptyOverwriteError
  );

  // 6. Upload Invoice PDF, Quotation PDF, and Logo Asset
  const invPdf = await client.uploadPdf(
    first.id,
    'invoice',
    'INV-2026-001.pdf',
    Buffer.from('%PDF-1.4 invoice').toString('base64')
  );
  const qtPdf = await client.uploadPdf(
    first.id,
    'quotation',
    'QT-2026-001.pdf',
    Buffer.from('%PDF-1.4 quote').toString('base64')
  );
  const logoFile = await client.uploadAssetDataUrl(
    first.id,
    'company-logo',
    `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`
  );
  assert.equal(invPdf.name, 'INV-2026-001.pdf');
  assert.equal(qtPdf.name, 'QT-2026-001.pdf');
  assert.equal(logoFile?.name, 'company-logo.png');

  // 7. Create dated backup & restore backup
  const { backup, backups } = await client.createBackup(first.id, populatedBundle);
  assert.ok(backup.name.startsWith('invoice-studio-backup-'));
  assert.equal(backups.length, 1);

  const restored = await client.restoreBackup(first.id, backup.id);
  assert.equal(restored.bundle.company?.legalName, 'Alpha Engineering LLP');
  assert.equal(restored.bundle.customers.length, 1);
  assert.equal(restored.bundle.invoices.length, 1);
});

test('UserGoogleDriveClient detects remote multi-session revision conflicts and token expiration safely', async () => {
  const server = new MockGoogleDriveServer();
  const tokenMgr = new InMemoryGoogleTokenManager();
  server.registerToken('ya29.token_conflict_0001', 'conflictUser');
  tokenMgr.setSession({
    accessToken: 'ya29.token_conflict_0001',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email`,
    accountEmail: 'ops@conflict.example',
  });

  const client = new UserGoogleDriveClient({
    fetchImpl: server.fetchImpl,
    getAccessToken: () => tokenMgr.requireAccessToken(),
    onTokenExpired: () => tokenMgr.markExpired(),
  });

  const { id: folderId } = await client.findOrCreateInvoiceStudioFolder();
  const loaded = await client.loadOrInitializeWorkspace(folderId, createEmptyDefaults());

  // Simulate another browser session updating invoice-studio-data.json on Drive
  server.bumpRemoteFileRevision('conflictUser', WORKSPACE_FILE_NAMES.MAIN_DATA, {
    version: 2,
    updatedAt: new Date(Date.now() + 60_000).toISOString(),
    invoices: [{ id: 'remote_inv', invoiceNumber: 'INV-REMOTE-99', customerName: 'Remote', totalAmount: 999 }],
  });

  // Attempting to save without forceOverwrite must raise DriveSyncConflictError
  await assert.rejects(
    () =>
      client.saveWorkspace(folderId, {
        ...loaded.bundle,
        customers: [
          {
            id: 'local_cust',
            customerName: 'Local Draft Customer',
            billingAddress: 'Mumbai',
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    DriveSyncConflictError
  );

  // Forced overwrite after user chooses "Backup Remote & Overwrite" succeeds
  await client.saveWorkspace(
    folderId,
    {
      ...loaded.bundle,
      customers: [
        {
          id: 'local_cust',
          customerName: 'Local Draft Customer',
          billingAddress: 'Mumbai',
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    { forceOverwrite: true }
  );

  // Simulate Google revoking / expiring the token server-side
  server.expireToken('ya29.token_conflict_0001');
  await assert.rejects(
    () => client.listBackups(folderId),
    (err: any) => err instanceof GoogleAuthError && err.code === 'GOOGLE_TOKEN_EXPIRED'
  );
  assert.equal(tokenMgr.isTokenValid(), false);
});

test('Multi-account isolation: Account A -> Disconnect -> Account B -> Disconnect -> Account A', async () => {
  const server = new MockGoogleDriveServer();
  const tokenMgr = new InMemoryGoogleTokenManager();
  const client = new UserGoogleDriveClient({
    fetchImpl: server.fetchImpl,
    getAccessToken: () => tokenMgr.requireAccessToken(),
    onTokenExpired: () => tokenMgr.markExpired(),
  });

  // Business A connects and saves records
  server.registerToken('ya29.token_acct_A_00001', 'acctA');
  tokenMgr.setSession({
    accessToken: 'ya29.token_acct_A_00001',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email`,
    accountEmail: 'finance@company-a.example',
  });
  const folderA = await client.findOrCreateInvoiceStudioFolder();
  const loadedA = await client.loadOrInitializeWorkspace(folderA.id, createEmptyDefaults());
  await client.saveWorkspace(folderA.id, {
    ...loadedA.bundle,
    company: { ...defaultCompanySettings, legalName: 'Company A Pvt Ltd', bankAccounts: [] },
    customers: [
      {
        id: 'cA',
        customerName: 'Client A',
        billingAddress: 'Delhi',
        updatedAt: '2026-01-01',
      },
    ],
  });

  // Business A disconnects completely
  tokenMgr.clearAll();
  client.resetCache();
  storage.clearDriveConnection();

  // Business B connects — must see genuinely empty workspace with zero data from A
  server.registerToken('ya29.token_acct_B_00002', 'acctB');
  tokenMgr.setSession({
    accessToken: 'ya29.token_acct_B_00002',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email`,
    accountEmail: 'accounts@company-b.example',
  });
  const folderB = await client.findOrCreateInvoiceStudioFolder();
  assert.notEqual(folderB.id, folderA.id);
  const loadedB = await client.loadOrInitializeWorkspace(folderB.id, createEmptyDefaults());
  assert.equal(loadedB.initializedNewWorkspace, true);
  assert.equal(loadedB.bundle.company?.legalName, '');
  assert.equal(loadedB.bundle.customers.length, 0);

  await client.saveWorkspace(folderB.id, {
    ...loadedB.bundle,
    company: { ...defaultCompanySettings, legalName: 'Company B Logistics', bankAccounts: [] },
  });

  // Business B disconnects -> Business A reconnects
  tokenMgr.clearAll();
  client.resetCache();
  storage.clearDriveConnection();

  tokenMgr.setSession({
    accessToken: 'ya29.token_acct_A_00001',
    expiresInSeconds: 3600,
    scopeString: `${GOOGLE_DRIVE_FILE_SCOPE} openid email`,
    accountEmail: 'finance@company-a.example',
  });
  const reFoundA = await client.findOrCreateInvoiceStudioFolder();
  assert.equal(reFoundA.id, folderA.id);
  const reloadedA = await client.loadOrInitializeWorkspace(reFoundA.id, createEmptyDefaults());
  assert.equal(reloadedA.restoredExistingWorkspace, true);
  assert.equal(reloadedA.bundle.company?.legalName, 'Company A Pvt Ltd');
  assert.equal(reloadedA.bundle.customers.length, 1);
  assert.equal(reloadedA.bundle.customers[0].customerName, 'Client A');
});

test('Google Sheets frontend helpers route through /api/sheets/* with Bearer token and parse sync data', async () => {
  assert.equal(
    extractGoogleSheetId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/edit#gid=0'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz123456'
  );
  assert.equal(extractGoogleSheetId('https://example.com/not-a-sheet'), null);

  const calledEndpoints: string[] = [];
  const mockBackendSheetsFetch: typeof fetch = async (input: any, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    calledEndpoints.push(urlStr);
    const auth = new Headers(init?.headers || {}).get('Authorization');
    if (auth !== 'Bearer ya29.valid_sheets_token_0001') {
      return new Response(JSON.stringify({ code: 'GOOGLE_TOKEN_EXPIRED', error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (urlStr === '/api/sheets/metadata') {
      return new Response(
        JSON.stringify({
          ok: true,
          spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz123456',
          spreadsheetTitle: 'FY26 Sales Ledger',
          sheets: [
            { sheetId: 0, title: 'Invoices', rowCount: 100, columnCount: 10 },
          ],
          accessMode: 'google_oauth',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr === '/api/sheets/values') {
      return new Response(
        JSON.stringify({
          ok: true,
          spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz123456',
          sheetTitle: 'Invoices',
          headers: ['Invoice No', 'Customer Name', 'Amount', 'Amount (2)'],
          rows: [
            { 'Invoice No': 'INV-101', 'Customer Name': 'Orbit Corp', Amount: '5000', 'Amount (2)': '900' },
            { 'Invoice No': 'INV-102', 'Customer Name': 'Vertex Labs', Amount: '8200', 'Amount (2)': '1476' },
          ],
          rowCount: 2,
          columnCount: 4,
          fetchedAt: '2026-06-01T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr === '/api/sheets/sync') {
      return new Response(
        JSON.stringify({
          ok: true,
          spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz123456',
          spreadsheetTitle: 'FY26 Sales Ledger',
          accessMode: 'google_oauth',
          fetchedAt: '2026-06-01T10:00:00.000Z',
          worksheets: [
            {
              name: 'Invoices',
              headers: ['Invoice No', 'Customer Name', 'Amount', 'Amount (2)'],
              rows: [
                { 'Invoice No': 'INV-101', 'Customer Name': 'Orbit Corp', Amount: '5000', 'Amount (2)': '900' },
                { 'Invoice No': 'INV-102', 'Customer Name': 'Vertex Labs', Amount: '8200', 'Amount (2)': '1476' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };

  const meta = await validateGoogleSpreadsheet(
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/edit',
    { accessToken: 'ya29.valid_sheets_token_0001', fetchImpl: mockBackendSheetsFetch }
  );
  assert.equal(meta.spreadsheetTitle, 'FY26 Sales Ledger');
  assert.equal(meta.sheets.length, 1);

  const sheetValues = await fetchGoogleSheetWorksheetValues({
    urlOrId: meta.spreadsheetId,
    sheetTitle: 'Invoices',
    accessToken: 'ya29.valid_sheets_token_0001',
    fetchImpl: mockBackendSheetsFetch,
  });
  assert.deepEqual(sheetValues.headers, ['Invoice No', 'Customer Name', 'Amount', 'Amount (2)']);
  assert.equal(sheetValues.rows.length, 2);
  assert.equal(sheetValues.rows[0]['Customer Name'], 'Orbit Corp');

  const syncRes = await syncGoogleSpreadsheet({
    urlOrId: meta.spreadsheetId,
    selectedSheets: ['Invoices'],
    accessToken: 'ya29.valid_sheets_token_0001',
    fetchImpl: mockBackendSheetsFetch,
  });
  const spreadData = buildSpreadsheetDataFromSync(syncRes);
  assert.equal(spreadData.fileName, 'FY26 Sales Ledger (Google Sheets)');
  assert.equal(spreadData.worksheets[0].rows.length, 2);
  assert.deepEqual(calledEndpoints, ['/api/sheets/metadata', '/api/sheets/values', '/api/sheets/sync']);
});

test('Browser metadata isolation namespaces strictly by Google sub and never persists access tokens', () => {
  const backing = new Map<string, string>();
  const mockLocalStorage = {
    get length() {
      return backing.size;
    },
    key(i: number) {
      return Array.from(backing.keys())[i] ?? null;
    },
    getItem(k: string) {
      return backing.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      backing.set(k, v);
    },
    removeItem(k: string) {
      backing.delete(k);
    },
    clear() {
      backing.clear();
    },
  };
  (globalThis as any).window = { localStorage: mockLocalStorage };

  try {
    storage.saveUserWorkspaceMetadata('sub_user_alpha_101', {
      folderId: 'folder_alpha_999',
      folderName: 'Alpha Invoice Studio',
      lastSpreadsheetId: 'sheet_alpha_111',
    });
    storage.saveUserWorkspaceMetadata('sub_user_beta_202', {
      folderId: 'folder_beta_888',
      folderName: 'Beta Invoice Studio',
      lastSpreadsheetId: 'sheet_beta_222',
    });

    // Keys must be strictly namespaced by Google sub
    assert.ok(backing.has('invoice_studio_workspace_sub_user_alpha_101'));
    assert.ok(backing.has('invoice_studio_workspace_sub_user_beta_202'));

    const alphaMeta = storage.loadUserWorkspaceMetadata('sub_user_alpha_101');
    const betaMeta = storage.loadUserWorkspaceMetadata('sub_user_beta_202');
    assert.equal(alphaMeta?.folderId, 'folder_alpha_999');
    assert.equal(betaMeta?.folderId, 'folder_beta_888');

    // Legacy/global or token-polluted keys must be purged while preserving valid sub-namespaced metadata
    backing.set('invoice_studio_company', '{"legalName":"Leaked Global"}');
    backing.set('invoice_studio_workspace_corrupt', '{"accessToken":"ya29.should_never_exist"}');
    storage.purgeLegacyBrowserStorage();

    assert.equal(backing.has('invoice_studio_company'), false);
    assert.equal(backing.has('invoice_studio_workspace_corrupt'), false);
    assert.equal(storage.loadUserWorkspaceMetadata('sub_user_alpha_101')?.folderId, 'folder_alpha_999');
    assert.equal(storage.loadUserWorkspaceMetadata('sub_user_beta_202')?.folderId, 'folder_beta_888');
  } finally {
    delete (globalThis as any).window;
  }
});
