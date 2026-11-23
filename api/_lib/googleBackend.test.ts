/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePermissionFlags,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
  requireGooglePermission,
  VerifiedGoogleIdentity,
  verifyGoogleAccessToken,
} from './googleAuth.js';
import {
  extractDriveFolderIdFromInput,
  migrateWorkspaceBundle,
  saveWorkspace,
  WORKSPACE_FILE_NAMES,
  WORKSPACE_SCHEMA_VERSION,
} from './googleDrive.js';
import { extractCatchAllRoute } from './http.js';
import {
  buildSheetA1Range,
  extractGoogleSheetId,
  normalizeSheetValuesArray,
} from './googleSheets.js';
import { buildMimeEmailRaw, dispatchGmailEmails } from './googleGmail.js';
import {
  handleDriveConnect,
  handleDriveWorkspace,
  handleGmailSend,
  handleGoogleConfig,
  handleGoogleVerifySession,
  handleSheetsMetadata,
} from './handlers.js';
import { HttpApiError } from './errors.js';
import { getServerConfig } from './config.js';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    json(obj: any) {
      this.body = JSON.stringify(obj);
      return this;
    },
    end(str?: string) {
      if (str) this.body = str;
    },
  };
  return res;
}

test('Google Auth: verifyGoogleAccessToken validates tokeninfo audience, fetches immutable sub, and computes separate permission flags', async () => {
  process.env.VITE_GOOGLE_CLIENT_ID = '1234567890-testclient.apps.googleusercontent.com';
  const cfg = getServerConfig('http://localhost:3000');

  const mockFetch: typeof fetch = async (input: any) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (urlStr.includes('tokeninfo')) {
      return new Response(
        JSON.stringify({
          aud: '1234567890-testclient.apps.googleusercontent.com',
          sub: '110998877665544332211',
          email: 'finance@company-a.example',
          email_verified: 'true',
          expires_in: '3590',
          scope: `openid email profile ${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_SHEETS_READONLY_SCOPE}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('userinfo')) {
      return new Response(
        JSON.stringify({
          sub: '110998877665544332211',
          email: 'finance@company-a.example',
          name: 'Finance Desk',
          picture: 'https://lh3.googleusercontent.com/avatar',
          email_verified: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 404 });
  };

  const session = await verifyGoogleAccessToken('ya29.valid_token_abc1234567890', {
    config: cfg,
    fetchImpl: mockFetch,
  });

  assert.equal(session.sub, '110998877665544332211');
  assert.equal(session.email, 'finance@company-a.example');
  assert.equal(session.name, 'Finance Desk');
  assert.equal(session.permissions.identityConnected, true);
  assert.equal(session.permissions.driveGranted, true);
  assert.equal(session.permissions.sheetsGranted, true);
  assert.equal(session.permissions.gmailGranted, false);

  // Audience mismatch must be rejected with 401
  const wrongAudFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        aud: '999999-attacker.apps.googleusercontent.com',
        sub: '110998877665544332211',
        email: 'attacker@evil.example',
        expires_in: '3600',
        scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  await assert.rejects(
    () =>
      verifyGoogleAccessToken('ya29.wrong_audience_token_12345', {
        config: cfg,
        fetchImpl: wrongAudFetch,
      }),
    (err: any) =>
      err instanceof HttpApiError &&
      err.status === 401 &&
      err.code === 'GOOGLE_TOKEN_AUDIENCE_MISMATCH'
  );

  // Missing audience when GOOGLE_CLIENT_ID is configured must also be rejected with 401
  const missingAudFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        sub: '110998877665544332211',
        email: 'finance@company-a.example',
        expires_in: '3600',
        scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  await assert.rejects(
    () =>
      verifyGoogleAccessToken('ya29.missing_audience_token_1234', {
        config: cfg,
        fetchImpl: missingAudFetch,
      }),
    (err: any) =>
      err instanceof HttpApiError &&
      err.status === 401 &&
      err.code === 'GOOGLE_TOKEN_AUDIENCE_MISMATCH'
  );

  // Zero expires_in without exp must be rejected with 401 (never defaulted to 3600s)
  const zeroExpiresFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        aud: '1234567890-testclient.apps.googleusercontent.com',
        sub: '110998877665544332211',
        email: 'finance@company-a.example',
        expires_in: '0',
        scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  await assert.rejects(
    () =>
      verifyGoogleAccessToken('ya29.zero_expires_token_123456', {
        config: cfg,
        fetchImpl: zeroExpiresFetch,
      }),
    (err: any) =>
      err instanceof HttpApiError && err.status === 401 && err.code === 'GOOGLE_TOKEN_EXPIRED'
  );

  // Expired/revoked token rejected with 401
  const expiredFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error_description: 'Invalid Value' }), { status: 400 });

  await assert.rejects(
    () =>
      verifyGoogleAccessToken('ya29.expired_token_123456789', {
        config: cfg,
        fetchImpl: expiredFetch,
      }),
    (err: any) =>
      err instanceof HttpApiError && err.status === 401 && err.code === 'GOOGLE_TOKEN_EXPIRED'
  );
});

test('Google Auth: requireGooglePermission enforces separate Drive, Sheets, and Gmail scopes', () => {
  const baseIdentity: VerifiedGoogleIdentity = {
    sub: 'sub_123',
    email: 'owner@acme.example',
    emailVerified: true,
    audience: '1234567890-testclient.apps.googleusercontent.com',
    grantedScopes: ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE],
    expiresIn: 3600,
    expiresAt: Date.now() + 3600_000,
    permissions: computePermissionFlags(
      ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE],
      'sub_123',
      'owner@acme.example'
    ),
  };

  assert.doesNotThrow(() => requireGooglePermission(baseIdentity, 'drive'));
  assert.throws(
    () => requireGooglePermission(baseIdentity, 'sheets'),
    (err: any) =>
      err instanceof HttpApiError && err.status === 403 && err.code === 'SHEETS_PERMISSION_MISSING'
  );
  assert.throws(
    () => requireGooglePermission(baseIdentity, 'gmail'),
    (err: any) =>
      err instanceof HttpApiError && err.status === 403 && err.code === 'GMAIL_PERMISSION_MISSING'
  );
});

test('Google Drive helpers: extractDriveFolderIdFromInput validates URLs/IDs and migrateWorkspaceBundle upgrades v1/v2 to v3 safely', () => {
  assert.equal(
    extractDriveFolderIdFromInput(
      'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing'
    ),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(
    extractDriveFolderIdFromInput(
      'https://drive.google.com/drive/u/1/folders/1XyZ9876543210_abc-DEF'
    ),
    '1XyZ9876543210_abc-DEF'
  );
  assert.equal(extractDriveFolderIdFromInput('1AbCdEfGhIjKlMnOpQrStUv'), '1AbCdEfGhIjKlMnOpQrStUv');
  assert.throws(
    () => extractDriveFolderIdFromInput('https://evil.example/not-a-drive-folder'),
    (err: any) => err instanceof HttpApiError && err.status === 400
  );

  // Schema migration v1 -> v3 preserves all existing data without loss
  const legacyV1 = {
    version: 1,
    updatedAt: '2025-11-01T00:00:00.000Z',
    company: { legalName: 'Legacy Traders LLP' },
    customers: [{ id: 'c1', customerName: 'Beta Corp' }],
    invoices: [
      { id: 'i1', invoiceNumber: 'INV-001', customerName: 'Beta Corp', totalAmount: 5000 },
    ],
    quotations: [{ id: 'q1', quotationNumber: 'QT-001' }],
  };
  const migrated = migrateWorkspaceBundle(legacyV1);
  assert.equal(migrated.version, WORKSPACE_SCHEMA_VERSION);
  assert.equal(migrated.company?.legalName, 'Legacy Traders LLP');
  assert.equal(migrated.customers.length, 1);
  assert.equal(migrated.invoices.length, 1);
  assert.equal(migrated.quotations.length, 1);
  assert.ok(Array.isArray(migrated.payments));
  assert.ok(Array.isArray(migrated.emailLogs));
});

test('Google Sheets helpers: extract ID, escape A1 range, preserve leading zeros/currency, deduplicate headers, skip blank rows', () => {
  assert.equal(
    extractGoogleSheetId(
      'https://docs.google.com/spreadsheets/d/1SheetId_AlphaBetaGamma12345/edit#gid=0'
    ),
    '1SheetId_AlphaBetaGamma12345'
  );
  assert.equal(buildSheetA1Range("Q1'26 Sales"), "'Q1''26 Sales'!A1:ZZ5000");

  const normalized = normalizeSheetValuesArray([
    ['Invoice No', 'GSTIN', 'Amount', 'Amount', ''],
    ['00042', '07AAECA1234F1Z5', '₹12,500.00', '₹2,250.00', ''],
    ['', '', '', '', ''],
    ['00043', '27BBBBB0000A1Z2', '$450.50', '$0.00', 'Note'],
  ]);

  assert.deepEqual(normalized.headers, ['Invoice No', 'GSTIN', 'Amount', 'Amount (2)', 'Column_5']);
  assert.equal(normalized.rows.length, 2); // Blank row skipped
  assert.equal(normalized.rows[0]['Invoice No'], '00042'); // Leading zero preserved
  assert.equal(normalized.rows[0]['GSTIN'], '07AAECA1234F1Z5');
  assert.equal(normalized.rows[0]['Amount'], '₹12,500.00'); // Currency preserved
  assert.equal(normalized.rows[1]['Amount (2)'], '$0.00');
});

test('Gmail API helper: buildMimeEmailRaw builds valid base64url RFC-2822 MIME with PDF attachment and sanitizes header injection', () => {
  const { raw } = buildMimeEmailRaw({
    fromEmail: 'billing@acme.example',
    fromName: 'Acme\r\nBcc: attacker@evil.example',
    to: 'client@customer.example',
    cc: 'accounts@customer.example',
    replyTo: 'support@acme.example',
    subject: 'Invoice INV-2026-01\r\nX-Injected: bad',
    textBody: 'Please find your invoice attached.',
    attachments: [
      {
        filename: 'INV-2026-01.pdf',
        contentType: 'application/pdf',
        base64Content: Buffer.from('%PDF-1.4 mock pdf bytes').toString('base64'),
      },
    ],
  });

  // Base64url must not contain +, /, or =
  assert.equal(/[+/=]/.test(raw), false);

  // Decode back to inspect headers and attachment
  const padded =
    raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64').toString('utf8');

  // CRLF header injection must be stripped
  assert.equal(decoded.includes('\r\nBcc: attacker@evil.example'), false);
  assert.equal(decoded.includes('\r\nX-Injected: bad'), false);
  assert.ok(decoded.includes('From: "Acme Bcc: attacker@evil.example" <billing@acme.example>'));
  assert.ok(decoded.includes('To: client@customer.example'));
  assert.ok(decoded.includes('Cc: accounts@customer.example'));
  assert.ok(decoded.includes('Reply-To: support@acme.example'));
  assert.ok(decoded.includes('Content-Type: application/pdf; name="INV-2026-01.pdf"'));
  assert.ok(decoded.includes('Content-Disposition: attachment; filename="INV-2026-01.pdf"'));
});

test('Gmail API dispatch: enforces gmail.send scope, sends one email per recipient, and reports per-recipient failures cleanly', async () => {
  const noGmailIdentity: VerifiedGoogleIdentity = {
    sub: 'sub_a',
    email: 'owner@acme.example',
    emailVerified: true,
    audience: '1234567890-testclient.apps.googleusercontent.com',
    grantedScopes: ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE],
    expiresIn: 3600,
    expiresAt: Date.now() + 3600_000,
    permissions: computePermissionFlags(
      ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE],
      'sub_a',
      'owner@acme.example'
    ),
  };

  const sentRawMessages: string[] = [];
  const fakeGmailApi = {
    users: {
      messages: {
        send: async ({ userId, requestBody }: { userId: string; requestBody: { raw: string } }) => {
          assert.equal(userId, 'me');
          sentRawMessages.push(requestBody.raw);
          return { data: { id: `gmail_msg_${sentRawMessages.length}` } };
        },
      },
    },
  };

  await assert.rejects(
    () =>
      dispatchGmailEmails({
        gmail: fakeGmailApi,
        identity: noGmailIdentity,
        items: [
          {
            documentType: 'invoice',
            documentNumber: 'INV-01',
            customerName: 'Alpha',
            recipientEmail: 'alpha@client.example',
            subject: 'Invoice',
            body: 'Body',
          },
        ],
      }),
    (err: any) =>
      err instanceof HttpApiError && err.status === 403 && err.code === 'GMAIL_PERMISSION_MISSING'
  );

  // With gmail.send granted: send 2 valid items + 1 invalid email address
  const gmailIdentity: VerifiedGoogleIdentity = {
    ...noGmailIdentity,
    grantedScopes: ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_GMAIL_SEND_SCOPE],
    permissions: computePermissionFlags(
      ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_GMAIL_SEND_SCOPE],
      'sub_a',
      'owner@acme.example'
    ),
  };

  const dispatchRes = await dispatchGmailEmails({
    gmail: fakeGmailApi,
    identity: gmailIdentity,
    senderName: 'Acme Billing',
    items: [
      {
        documentType: 'invoice',
        documentNumber: 'INV-1001',
        customerName: 'Client One',
        recipientEmail: 'one@client.example',
        subject: 'Invoice INV-1001',
        body: 'Attached invoice 1001.',
        pdfBase64: Buffer.from('%PDF-1.4 one').toString('base64'),
        pdfFilename: 'INV-1001.pdf',
      },
      {
        documentType: 'quotation',
        documentNumber: 'QT-2002',
        customerName: 'Client Two',
        recipientEmail: 'not-an-email',
        subject: 'Quotation QT-2002',
        body: 'Attached quote 2002.',
      },
      {
        documentType: 'quotation',
        documentNumber: 'QT-2003',
        customerName: 'Client Three',
        recipientEmail: 'three@client.example',
        subject: 'Quotation QT-2003',
        body: 'Attached quote 2003.',
        pdfBase64: Buffer.from('%PDF-1.4 three').toString('base64'),
        pdfFilename: 'QT-2003.pdf',
      },
    ],
  });

  // One email sent per valid recipient — never shared across recipients
  assert.equal(sentRawMessages.length, 2);
  assert.equal(dispatchRes.results.length, 3);
  assert.equal(dispatchRes.results[0].status, 'Sent');
  assert.equal(dispatchRes.results[0].deliveryMethod, 'gmail_api');
  assert.equal(dispatchRes.results[1].status, 'Failed');
  assert.equal(dispatchRes.results[2].status, 'Sent');
  assert.equal(dispatchRes.logs.length, 3);
});

test('Stateless API handlers: /api/google/config returns public config only; all protected routes reject unauthenticated calls with 401', async () => {
  const cfgRes = createMockRes();
  await handleGoogleConfig({ method: 'GET', headers: { host: 'localhost:3000' } } as any, cfgRes);
  assert.equal(cfgRes.statusCode, 200);
  const cfgBody = JSON.parse(cfgRes.body);
  assert.equal('configured' in cfgBody, true);
  assert.equal('clientId' in cfgBody, true);
  assert.equal('defaultScopes' in cfgBody, true);
  assert.equal('optionalScopes' in cfgBody, true);
  assert.equal('smtpEncryptionKey' in cfgBody, false);

  const protectedHandlers = [
    { fn: handleGoogleVerifySession, method: 'POST' },
    { fn: handleDriveConnect, method: 'POST' },
    { fn: handleDriveWorkspace, method: 'GET' },
    { fn: handleSheetsMetadata, method: 'POST' },
    { fn: handleGmailSend, method: 'POST' },
  ];

  for (const { fn, method } of protectedHandlers) {
    const res = createMockRes();
    await fn({ method, headers: { host: 'localhost:3000' }, body: {} } as any, res);
    assert.equal(res.statusCode, 401, `Expected 401 for unauthenticated ${fn.name}`);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.code, 'GOOGLE_AUTH_REQUIRED');
  }
});

test('Google Drive saveWorkspace blocks accidental empty overwrite when only company-settings.json has saved business data', async () => {
  const fakeDrive: any = {
    files: {
      list: async ({ q }: { q: string }) => {
        if (q.includes(WORKSPACE_FILE_NAMES.COMPANY_SETTINGS)) {
          return {
            data: {
              files: [
                {
                  id: 'file_company_1',
                  name: WORKSPACE_FILE_NAMES.COMPANY_SETTINGS,
                  mimeType: 'application/json',
                  modifiedTime: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          };
        }
        return { data: { files: [] } };
      },
      get: async ({ fileId }: { fileId: string }) => {
        if (fileId === 'file_company_1') {
          return { data: { legalName: 'Acme Pvt Ltd', gstin: '27AAECA1234F1Z5' } };
        }
        return { data: null };
      },
    },
  };

  await assert.rejects(
    () =>
      saveWorkspace(
        fakeDrive,
        'root_folder_12345678',
        {
          version: WORKSPACE_SCHEMA_VERSION,
          updatedAt: new Date().toISOString(),
          company: { legalName: '', displayName: '' },
          fieldCatalog: [],
          mappingProfiles: [],
          layoutConfig: null,
          customers: [],
          invoices: [],
          quotations: [],
          payments: [],
          emailLogs: [],
          spreadsheetData: null,
        },
        {
          subfolders: {
            rootFolderId: 'root_folder_12345678',
            rootFolderName: 'Invoice Studio',
            workspaceFolderId: 'ws_folder_12345678',
            invoicesFolderId: 'inv_folder_12345678',
            quotationsFolderId: 'qt_folder_12345678',
            backupsFolderId: 'bk_folder_12345678',
            assetsFolderId: 'as_folder_12345678',
            logosFolderId: 'lg_folder_12345678',
            signaturesFolderId: 'sg_folder_12345678',
            stampsFolderId: 'st_folder_12345678',
          },
        }
      ),
    (err: any) =>
      err instanceof HttpApiError && err.status === 409 && err.code === 'EMPTY_OVERWRITE_BLOCKED'
  );
});

test('Vercel catch-all route extractor handles slug, ...slug, trailing slashes, and req.url fallback', () => {
  assert.equal(extractCatchAllRoute({ query: { slug: ['verify-session'] } } as any, '/api/google'), 'verify-session');
  assert.equal(extractCatchAllRoute({ query: { '...slug': 'test-send/' } } as any, '/api/gmail'), 'test-send');
  assert.equal(extractCatchAllRoute({ url: '/api/drive/workspace/?folderId=abc' } as any, '/api/drive'), 'workspace');
  assert.equal(extractCatchAllRoute({ url: '/api/sheets/metadata' } as any, '/api/sheets'), 'metadata');
});
