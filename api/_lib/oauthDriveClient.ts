/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppServerConfig } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { HttpApiError } from './errors.js';

export type SmtpProviderType = 'gmail_smtp' | 'custom_smtp';

export interface StoredSmtpConfig {
  version?: number;
  provider: SmtpProviderType;
  host: string;
  port: number;
  encryption: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  encryptedPassword: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  updatedAt: string;
  lastVerifiedAt?: string;
}

export type EmailLogDeliveryMethod = 'gmail_api' | SmtpProviderType;

export interface StoredEmailLogEntry {
  id: string;
  documentType: 'invoice' | 'quotation' | 'test';
  documentNumber: string;
  customerName: string;
  recipientEmail: string;
  cc?: string;
  bcc?: string;
  subject: string;
  deliveryMethod: EmailLogDeliveryMethod;
  status: 'Sent' | 'Failed';
  messageId?: string;
  errorMessage?: string;
  sentAt: string;
}

export interface VerifiedDriveFolder {
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  canEdit: boolean;
  canAddChildren: boolean;
  canListChildren: boolean;
}

export interface OAuthDriveEmailTransport {
  verifyRootFolder: () => Promise<VerifiedDriveFolder>;
  readEmailSettings: () => Promise<StoredSmtpConfig | null>;
  writeEmailSettings: (payload: StoredSmtpConfig | null) => Promise<void>;
  readEmailLogs: () => Promise<StoredEmailLogEntry[]>;
  writeEmailLogs: (logs: StoredEmailLogEntry[]) => Promise<void>;
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const WORKSPACE_SUBFOLDER_NAME = 'workspace';
const FILE_EMAIL_SETTINGS = 'email-settings.json';
const FILE_EMAIL_HISTORY = 'email-history.json';

export function validateDriveFolderId(raw: string): string {
  const clean = String(raw || '').trim();
  if (!clean || !/^[a-zA-Z0-9_-]{8,128}$/.test(clean)) {
    throw new HttpApiError(
      400,
      'INVALID_DRIVE_FOLDER_ID',
      'A valid Google Drive folder ID is required for this workspace.'
    );
  }
  return clean;
}

export function extractBearerToken(authorizationHeader?: string): string {
  const header = String(authorizationHeader || '').trim();
  if (!header) {
    throw new HttpApiError(
      401,
      'GOOGLE_AUTH_REQUIRED',
      'Connect your Google Drive account to configure or send emails.'
    );
  }
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  if (!match?.[1] || match[1].length < 20) {
    throw new HttpApiError(
      401,
      'INVALID_AUTH_HEADER',
      'Invalid or missing Google OAuth access token. Please reconnect Google Drive.'
    );
  }
  return match[1];
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function mapGoogleFetchError(status: number, bodyText: string, context: string): HttpApiError {
  let reason = '';
  let apiMessage = '';
  try {
    const parsed = JSON.parse(bodyText);
    reason = String(parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || '');
    apiMessage = String(parsed?.error?.message || parsed?.error_description || '');
  } catch {
    apiMessage = bodyText.slice(0, 200);
  }

  if (status === 401 || reason === 'authError' || reason === 'invalidCredentials') {
    return new HttpApiError(
      401,
      'GOOGLE_TOKEN_EXPIRED',
      'Your Google Drive authorization expired or was revoked. Please reconnect Google Drive to continue.'
    );
  }

  if (status === 403) {
    if (reason === 'insufficientPermissions' || reason === 'insufficientFilePermissions') {
      return new HttpApiError(
        403,
        'DRIVE_PERMISSION_DENIED',
        `Your connected Google account does not have permission to ${context} in the selected Drive folder. Reconnect or choose a folder you own.`
      );
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return new HttpApiError(
        429,
        'DRIVE_RATE_LIMITED',
        'Google Drive API rate limit reached. Please wait a few seconds and retry.'
      );
    }
    return new HttpApiError(
      403,
      'DRIVE_ACCESS_DENIED',
      apiMessage || `Google Drive denied access while attempting to ${context}.`
    );
  }

  if (status === 404) {
    return new HttpApiError(
      404,
      'DRIVE_FOLDER_NOT_FOUND',
      'The selected Google Drive folder was not found or is not accessible with your current Google authorization. Re-select your folder via Google Picker.'
    );
  }

  return new HttpApiError(
    status >= 400 && status < 600 ? status : 502,
    'GOOGLE_DRIVE_ERROR',
    apiMessage || `Google Drive request failed (${status}) while attempting to ${context}.`
  );
}

/**
 * Creates a request-scoped Google Drive v3 transport authenticated strictly with the
 * caller's short-lived Google OAuth access token. Never caches tokens across requests.
 */
export function createOAuthDriveEmailTransport(
  accessToken: string,
  folderId: string,
  fetchImpl: typeof fetch = fetch
): OAuthDriveEmailTransport {
  const safeFolderId = validateDriveFolderId(folderId);
  let verifiedFolderPromise: Promise<VerifiedDriveFolder> | null = null;
  let workspaceSubfolderIdPromise: Promise<string> | null = null;

  async function driveFetch(url: string, init: RequestInit, context: string): Promise<Response> {
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw mapGoogleFetchError(res.status, text, context);
    }
    return res;
  }

  async function verifyRootFolder(): Promise<VerifiedDriveFolder> {
    if (!verifiedFolderPromise) {
      verifiedFolderPromise = (async () => {
        const fields = encodeURIComponent(
          'id,name,mimeType,trashed,capabilities(canEdit,canAddChildren,canListChildren)'
        );
        const res = await driveFetch(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(safeFolderId)}?fields=${fields}`,
          { method: 'GET' },
          'verify workspace folder access'
        );
        const data = (await res.json()) as any;
        if (data.mimeType !== FOLDER_MIME) {
          throw new HttpApiError(
            400,
            'DRIVE_ITEM_NOT_FOLDER',
            'The selected Google Drive item is not a folder.'
          );
        }
        if (data.trashed) {
          throw new HttpApiError(
            400,
            'DRIVE_FOLDER_TRASHED',
            'The selected Google Drive folder is in the trash. Restore it or select another folder.'
          );
        }
        const canEdit = Boolean(data.capabilities?.canEdit);
        const canAddChildren = Boolean(data.capabilities?.canAddChildren);
        const canListChildren = Boolean(data.capabilities?.canListChildren);
        if (!canAddChildren && !canEdit) {
          throw new HttpApiError(
            403,
            'DRIVE_WRITE_PERMISSION_REQUIRED',
            'Your Google account has read-only access to this Drive folder. Select a folder where you have edit access.'
          );
        }
        return {
          id: String(data.id || safeFolderId),
          name: String(data.name || 'Invoice Studio'),
          mimeType: String(data.mimeType),
          trashed: false,
          canEdit,
          canAddChildren,
          canListChildren,
        };
      })().catch((err) => {
        verifiedFolderPromise = null;
        throw err;
      });
    }
    return verifiedFolderPromise;
  }

  async function findChildByName(
    parentId: string,
    name: string,
    mimeType?: string
  ): Promise<{ id: string; name: string } | null> {
    const parts = [
      `'${escapeDriveQueryValue(parentId)}' in parents`,
      `name = '${escapeDriveQueryValue(name)}'`,
      'trashed = false',
    ];
    if (mimeType) {
      parts.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
    }
    const q = encodeURIComponent(parts.join(' and '));
    const res = await driveFetch(
      `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name)&pageSize=5`,
      { method: 'GET' },
      `locate "${name}"`
    );
    const data = (await res.json()) as any;
    const files = Array.isArray(data.files) ? data.files : [];
    return files[0] ? { id: String(files[0].id), name: String(files[0].name) } : null;
  }

  async function ensureWorkspaceSubfolder(): Promise<string> {
    if (!workspaceSubfolderIdPromise) {
      workspaceSubfolderIdPromise = (async () => {
        const verified = await verifyRootFolder();
        const existing = await findChildByName(verified.id, WORKSPACE_SUBFOLDER_NAME, FOLDER_MIME);
        if (existing) return existing.id;

        const res = await driveFetch(
          `${DRIVE_API_BASE}/files?fields=id,name`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: WORKSPACE_SUBFOLDER_NAME,
              mimeType: FOLDER_MIME,
              parents: [verified.id],
            }),
          },
          'create workspace subfolder'
        );
        const created = (await res.json()) as any;
        return String(created.id);
      })().catch((err) => {
        workspaceSubfolderIdPromise = null;
        throw err;
      });
    }
    return workspaceSubfolderIdPromise;
  }

  async function readJsonFromWorkspace<T>(fileName: string): Promise<T | null> {
    const wsFolderId = await ensureWorkspaceSubfolder();
    const existing = await findChildByName(wsFolderId, fileName);
    if (!existing) return null;

    const res = await driveFetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(existing.id)}?alt=media`,
      { method: 'GET' },
      `read "${fileName}"`
    );
    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async function writeJsonToWorkspace<T>(fileName: string, payload: T): Promise<void> {
    const wsFolderId = await ensureWorkspaceSubfolder();
    const existing = await findChildByName(wsFolderId, fileName);
    const jsonBody = JSON.stringify(payload, null, 2);

    if (existing) {
      await driveFetch(
        `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,modifiedTime`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: jsonBody,
        },
        `update "${fileName}"`
      );
      return;
    }

    const boundary = `invoice_studio_boundary_${Date.now().toString(36)}`;
    const metadata = JSON.stringify({
      name: fileName,
      mimeType: 'application/json',
      parents: [wsFolderId],
    });
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      jsonBody,
      `--${boundary}--`,
    ].join('\r\n');

    await driveFetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,modifiedTime`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      },
      `create "${fileName}"`
    );
  }

  return {
    verifyRootFolder,
    readEmailSettings: () => readJsonFromWorkspace<StoredSmtpConfig>(FILE_EMAIL_SETTINGS),
    writeEmailSettings: (payload) => writeJsonToWorkspace(FILE_EMAIL_SETTINGS, payload),
    readEmailLogs: async () => {
      const logs = await readJsonFromWorkspace<StoredEmailLogEntry[]>(FILE_EMAIL_HISTORY);
      return Array.isArray(logs) ? logs : [];
    },
    writeEmailLogs: (logs) => writeJsonToWorkspace(FILE_EMAIL_HISTORY, logs.slice(0, 500)),
  };
}

/**
 * Per-request encrypted SMTP & Email History store backed by the caller's own verified Google Drive folder.
 */
export class OAuthDriveEmailStore {
  readonly folderId: string;
  private readonly config: AppServerConfig;
  private readonly transport: OAuthDriveEmailTransport;

  constructor(options: {
    folderId: string;
    config: AppServerConfig;
    accessToken?: string;
    transport?: OAuthDriveEmailTransport;
    fetchImpl?: typeof fetch;
  }) {
    this.folderId = validateDriveFolderId(options.folderId);
    this.config = options.config;
    if (options.transport) {
      this.transport = options.transport;
    } else {
      if (!options.accessToken) {
        throw new HttpApiError(
          401,
          'GOOGLE_AUTH_REQUIRED',
          'A Google OAuth access token is required to access your Drive email settings.'
        );
      }
      this.transport = createOAuthDriveEmailTransport(
        options.accessToken,
        this.folderId,
        options.fetchImpl
      );
    }
  }

  async verifyAccess(): Promise<VerifiedDriveFolder> {
    const folder = await this.transport.verifyRootFolder();
    if (folder.trashed) {
      throw new HttpApiError(
        404,
        'DRIVE_FOLDER_TRASHED',
        'The connected Google Drive folder is in Trash. Restore it or select another folder.'
      );
    }
    if (folder.mimeType !== FOLDER_MIME) {
      throw new HttpApiError(
        400,
        'NOT_A_DRIVE_FOLDER',
        'The selected Google Drive item is not a folder.'
      );
    }
    if (!folder.canEdit && !folder.canAddChildren) {
      throw new HttpApiError(
        403,
        'DRIVE_PERMISSION_DENIED',
        'Your connected Google account does not have edit permission on this Drive folder.'
      );
    }
    return folder;
  }

  async readSmtpConfig(): Promise<StoredSmtpConfig | null> {
    const raw = await this.transport.readEmailSettings();
    if (!raw || typeof raw !== 'object' || !raw.host) return null;
    return raw;
  }

  async writeSmtpConfig(input: {
    provider: SmtpProviderType;
    host: string;
    port: number;
    encryption: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password?: string;
    senderName: string;
    senderEmail: string;
    replyTo?: string;
    lastVerifiedAt?: string;
  }): Promise<StoredSmtpConfig> {
    const existing = await this.readSmtpConfig();
    let encryptedPassword = existing?.encryptedPassword || '';

    if (input.password && input.password.trim()) {
      if (!this.config.smtpEncryptionKey || this.config.smtpEncryptionKey.length < 16) {
        throw new HttpApiError(
          503,
          'SMTP_ENCRYPTION_KEY_MISSING',
          'Server SMTP_ENCRYPTION_KEY is not configured (minimum 16 characters required) to securely encrypt SMTP passwords.'
        );
      }
      encryptedPassword = encryptSecret(input.password.trim(), this.config.smtpEncryptionKey);
    }

    if (!encryptedPassword) {
      throw new HttpApiError(
        400,
        'SMTP_PASSWORD_REQUIRED',
        input.provider === 'gmail_smtp'
          ? 'A 16-character Gmail App Password is required when configuring Gmail SMTP for the first time.'
          : 'An SMTP password is required when configuring SMTP for the first time.'
      );
    }

    const record: StoredSmtpConfig = {
      version: 1,
      provider: input.provider,
      host: input.host.trim(),
      port: Number(input.port),
      encryption: input.encryption,
      username: input.username.trim(),
      encryptedPassword,
      senderName: input.senderName.trim(),
      senderEmail: input.senderEmail.trim(),
      replyTo: input.replyTo?.trim() || undefined,
      updatedAt: new Date().toISOString(),
      lastVerifiedAt: input.lastVerifiedAt || existing?.lastVerifiedAt,
    };

    await this.transport.writeEmailSettings(record);
    return record;
  }

  async deleteSmtpConfig(): Promise<void> {
    await this.transport.writeEmailSettings(null);
  }

  decryptSmtpPassword(stored: StoredSmtpConfig): string {
    if (!this.config.smtpEncryptionKey || this.config.smtpEncryptionKey.length < 16) {
      throw new HttpApiError(
        503,
        'SMTP_ENCRYPTION_KEY_MISSING',
        'Server SMTP_ENCRYPTION_KEY is missing; stored SMTP password cannot be decrypted.'
      );
    }
    return decryptSecret(stored.encryptedPassword, this.config.smtpEncryptionKey);
  }

  async readEmailLogs(): Promise<StoredEmailLogEntry[]> {
    return this.transport.readEmailLogs();
  }

  async appendEmailLogs(entries: StoredEmailLogEntry[]): Promise<void> {
    const existing = await this.readEmailLogs();
    const merged = [...entries, ...existing].slice(0, 500);
    await this.transport.writeEmailLogs(merged);
  }
}
