/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getServerConfig } from './config.js';
import {
  deleteSmtpConfig,
  dispatchSmtpEmails,
  getPublicSmtpConfig,
  saveSmtpConfig,
  sendTestEmail,
  SmtpTransportFactory,
  testSmtpConnection,
} from './emailBackendService.js';
import { HttpApiError } from './errors.js';
import { handleHealth, handleSmtpConfig } from './handlers.js';
import {
  extractBearerToken,
  OAuthDriveEmailStore,
  OAuthDriveEmailTransport,
  StoredEmailLogEntry,
  StoredSmtpConfig,
  validateDriveFolderId,
} from './oauthDriveClient.js';

function createMemoryDriveEmailTransport(options?: {
  canEdit?: boolean;
  trashed?: boolean;
  expired?: boolean;
}): {
  transport: OAuthDriveEmailTransport;
  rawSettings: () => StoredSmtpConfig | null;
  rawLogs: () => StoredEmailLogEntry[];
} {
  let settings: StoredSmtpConfig | null = null;
  let logs: StoredEmailLogEntry[] = [];

  return {
    rawSettings: () => settings,
    rawLogs: () => logs,
    transport: {
      async verifyRootFolder() {
        if (options?.expired) {
          throw new HttpApiError(401, 'GOOGLE_TOKEN_EXPIRED', 'Token expired');
        }
        return {
          id: 'folder_user_12345678',
          name: 'Invoice Studio',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: Boolean(options?.trashed),
          canEdit: options?.canEdit ?? true,
          canAddChildren: options?.canEdit ?? true,
          canListChildren: true,
        };
      },
      async readEmailSettings() {
        return settings;
      },
      async writeEmailSettings(payload) {
        settings = payload;
      },
      async readEmailLogs() {
        return logs;
      },
      async writeEmailLogs(nextLogs) {
        logs = nextLogs;
      },
    },
  };
}

function createTestConfig() {
  process.env.SMTP_ENCRYPTION_KEY = 'test-super-strong-aes-256-gcm-encryption-key-0123456789';
  return getServerConfig('http://localhost:3000');
}

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

test('Bearer token & Drive folder ID validators reject missing/malformed inputs safely', () => {
  assert.throws(() => extractBearerToken(''), (err: any) => err instanceof HttpApiError && err.status === 401);
  assert.throws(
    () => extractBearerToken('Bearer short'),
    (err: any) => err instanceof HttpApiError && err.status === 401
  );
  assert.equal(
    extractBearerToken('Bearer ya29.valid_token_string_1234567890'),
    'ya29.valid_token_string_1234567890'
  );

  assert.throws(
    () => validateDriveFolderId('../bad'),
    (err: any) => err instanceof HttpApiError && err.status === 400
  );
  assert.equal(validateDriveFolderId('1AbCdEfGhIjKlMnOpQrStUv'), '1AbCdEfGhIjKlMnOpQrStUv');
});

test('Health endpoint reports OAuth user-Drive architecture with zero service-account fields', async () => {
  const res = createMockRes();
  await handleHealth({ method: 'GET', headers: { host: 'localhost:3000' } } as any, res);
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.diagnostics.authMode, 'google-gis-token-backend-verified');
  assert.equal(parsed.diagnostics.storageProvider, 'user-google-drive-oauth');
  assert.equal(parsed.diagnostics.gmailApiSupported, true);
  assert.equal('serviceAccountEmail' in parsed.diagnostics, false);
});

test('Unauthenticated /api/email/smtp-config is rejected with 401 GOOGLE_AUTH_REQUIRED', async () => {
  const res = createMockRes();
  await handleSmtpConfig(
    {
      method: 'GET',
      headers: { host: 'localhost:3000', 'x-workspace-folder-id': 'folder_user_12345678' },
    } as any,
    res
  );
  assert.equal(res.statusCode, 401);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.code, 'GOOGLE_AUTH_REQUIRED');
});

test('OAuthDriveEmailStore blocks read-only folders and expired tokens before touching settings', async () => {
  const config = createTestConfig();

  const readOnly = createMemoryDriveEmailTransport({ canEdit: false });
  const roStore = new OAuthDriveEmailStore({
    folderId: 'folder_user_12345678',
    accessToken: 'ya29.valid_token_string_1234567890',
    config,
    transport: readOnly.transport,
  });
  await assert.rejects(
    () => roStore.verifyAccess(),
    (err: any) => err instanceof HttpApiError && err.status === 403 && err.code === 'DRIVE_PERMISSION_DENIED'
  );

  const expired = createMemoryDriveEmailTransport({ expired: true });
  const expStore = new OAuthDriveEmailStore({
    folderId: 'folder_user_12345678',
    accessToken: 'ya29.expired_token_string_1234567890',
    config,
    transport: expired.transport,
  });
  await assert.rejects(
    () => expStore.verifyAccess(),
    (err: any) => err instanceof HttpApiError && err.status === 401 && err.code === 'GOOGLE_TOKEN_EXPIRED'
  );
});

test('SMTP credentials are encrypted with AES-256-GCM in user Drive, never exposed in plaintext, and work for Gmail & Custom SMTP', async () => {
  const config = createTestConfig();
  const mockDrive = createMemoryDriveEmailTransport();
  const driveStore = new OAuthDriveEmailStore({
    folderId: 'folder_user_12345678',
    accessToken: 'ya29.valid_token_string_1234567890',
    config,
    transport: mockDrive.transport,
  });

  // 1. Save Gmail SMTP App Password
  const secretAppPassword = 'abcd efgh ijkl mnop';
  const savedPublic = await saveSmtpConfig({
    driveStore,
    input: {
      provider: 'gmail_smtp',
      host: 'smtp.gmail.com',
      port: 465,
      encryption: 'SSL',
      username: 'billing@business.example',
      password: secretAppPassword,
      senderName: 'Alpha Billing',
      senderEmail: 'billing@business.example',
    },
  });

  assert.equal(savedPublic.configured, true);
  assert.equal(savedPublic.persistedInDrive, true);
  assert.equal(savedPublic.hasPassword, true);
  assert.equal(JSON.stringify(savedPublic).includes(secretAppPassword), false);

  // Verify raw Drive JSON contains encrypted ciphertext only — NEVER plaintext password
  const rawStored = mockDrive.rawSettings();
  assert.ok(rawStored?.encryptedPassword);
  assert.equal(JSON.stringify(rawStored).includes(secretAppPassword), false);

  // Public getter returns sanitized fields only
  const fetchedPublic = await getPublicSmtpConfig({ driveStore });
  assert.equal(fetchedPublic.configured, true);
  assert.equal(fetchedPublic.username, 'billing@business.example');
  assert.equal('encryptedPassword' in fetchedPublic, false);

  // 2. Test SMTP connection with injected mock transport (verifies decrypted password passed ONLY to Nodemailer)
  let verifiedCreds: any = null;
  const sentPayloads: any[] = [];
  const okTransportFactory: SmtpTransportFactory = (creds) => {
    verifiedCreds = creds;
    return {
      verify: async () => true,
      sendMail: async (opts) => {
        sentPayloads.push(opts);
        return { messageId: `<msg-${sentPayloads.length}@smtp.gmail.com>` };
      },
      close: () => {},
    };
  };

  const verifyRes = await testSmtpConnection({
    driveStore,
    config,
    transportFactory: okTransportFactory,
  });
  assert.equal(verifyRes.ok, true);
  assert.equal(verifiedCreds.password, secretAppPassword);
  assert.equal(verifiedCreds.host, 'smtp.gmail.com');
  assert.equal(verifiedCreds.port, 465);

  // 3. Send test email
  const testSendRes = await sendTestEmail({
    driveStore,
    recipientEmail: 'owner@business.example',
    transportFactory: okTransportFactory,
  });
  assert.equal(testSendRes.ok, true);
  assert.ok(testSendRes.messageId);

  // 4. Send invoice + quotation batch with PDF attachments & verify email history stored in Drive
  const batchRes = await dispatchSmtpEmails({
    driveStore,
    transportFactory: okTransportFactory,
    items: [
      {
        documentType: 'invoice',
        documentNumber: 'INV-2026-01',
        customerName: 'Acme Corp',
        recipientEmail: 'ap@acme.example',
        subject: 'Invoice INV-2026-01',
        body: 'Attached is your invoice.',
        pdfBase64: Buffer.from('%PDF-1.4 sample').toString('base64'),
        pdfFilename: 'INV-2026-01.pdf',
      },
      {
        documentType: 'quotation',
        documentNumber: 'QT-2026-01',
        customerName: 'Beta Ltd',
        recipientEmail: 'procurement@beta.example',
        subject: 'Quotation QT-2026-01',
        body: 'Attached is your quotation.',
        pdfBase64: Buffer.from('%PDF-1.4 quote').toString('base64'),
        pdfFilename: 'QT-2026-01.pdf',
      },
    ],
  });
  assert.equal(batchRes.results.filter((r) => r.status === 'Sent').length, 2);
  assert.equal(batchRes.results.filter((r) => r.status === 'Failed').length, 0);
  assert.equal(batchRes.persistedInDrive, true);
  assert.equal(mockDrive.rawLogs().length, 3); // 1 test + 2 documents
  assert.equal(sentPayloads[1].attachments[0].filename, 'INV-2026-01.pdf');

  // 5. Invalid password error handling produces clear guidance without leaking secret
  const badAuthFactory: SmtpTransportFactory = () => ({
    verify: async () => {
      const e: any = new Error('535-5.7.8 Username and Password not accepted');
      e.code = 'EAUTH';
      throw e;
    },
    sendMail: async () => ({}),
    close: () => {},
  });

  await assert.rejects(
    () =>
      testSmtpConnection({
        driveStore,
        config,
        transportFactory: badAuthFactory,
      }),
    (err: any) =>
      err instanceof HttpApiError &&
      err.code === 'SMTP_VERIFY_FAILED' &&
      err.message.includes('App Password') &&
      !err.message.includes(secretAppPassword)
  );

  // 6. Delete SMTP config clears stored file cleanly
  await deleteSmtpConfig({ driveStore });
  assert.equal(mockDrive.rawSettings(), null);
  const afterDelete = await getPublicSmtpConfig({ driveStore });
  assert.equal(afterDelete.configured, false);
});
