/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BackendSmtpConfig,
  DriveSyncConflict,
  DriveWorkspaceSubfolders,
  EmailDeliveryLogEntry,
  EmailDeliveryMethod,
  GenerationRecord,
  QuotationRecord,
  SmtpProviderMethod,
  WorkspaceFileRevisions,
} from '../types';
import {
  getAccessToken,
  markGoogleSessionExpired,
} from './googleAuthClient';
import {
  DriveFileSummary,
  DriveSyncConflictError,
  DriveWorkspaceBundle,
} from './googleDriveClient';
import { getActiveWorkspaceId } from './storage';

export class WorkspaceApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, any>;

  constructor(status: number, code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type DriveBackupFile = DriveFileSummary;

let activeFileRevisions: WorkspaceFileRevisions = {};

export function resetTrackedDriveRevisions(): void {
  activeFileRevisions = {};
}

export function getTrackedDriveRevisions(): WorkspaceFileRevisions {
  return { ...activeFileRevisions };
}

function buildBearerHeaders(options?: {
  requireFolderId?: boolean;
  overrideFolderId?: string | null;
}): Record<string, string> {
  const token = getAccessToken();
  if (!token) {
    throw new WorkspaceApiError(
      401,
      'GOOGLE_TOKEN_EXPIRED',
      'Your Google authorization is not active or has expired. Connect or reconnect your Google account to continue.'
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const folderId =
    options?.overrideFolderId !== undefined ? options.overrideFolderId : getActiveWorkspaceId();

  if (options?.requireFolderId && !folderId) {
    throw new WorkspaceApiError(
      400,
      'DRIVE_NOT_CONNECTED',
      'Connect a Google Drive workspace folder first.'
    );
  }
  if (folderId) {
    headers['x-workspace-folder-id'] = folderId;
  }

  return headers;
}

async function apiRequest<T>(
  url: string,
  init?: RequestInit,
  options?: { requireFolderId?: boolean; overrideFolderId?: string | null }
): Promise<T> {
  const headers = buildBearerHeaders(options);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new WorkspaceApiError(
      response.status,
      'INVALID_RESPONSE',
      `Unexpected non-JSON response (${response.status})`
    );
  }

  if (response.status === 401) {
    markGoogleSessionExpired();
    throw new WorkspaceApiError(
      401,
      parsed.code || 'GOOGLE_TOKEN_EXPIRED',
      parsed.error ||
        'Your Google authorization expired or was revoked. Reconnect your Google account to continue.'
    );
  }

  if (response.status === 409 && parsed.code === 'DRIVE_SYNC_CONFLICT' && parsed.details?.conflict) {
    throw new DriveSyncConflictError(parsed.details.conflict as DriveSyncConflict);
  }

  if (!response.ok) {
    throw new WorkspaceApiError(
      response.status,
      parsed.code || 'API_ERROR',
      parsed.error || `Request failed (${response.status})`,
      parsed.details
    );
  }

  return parsed as T;
}

export interface ConnectDriveWorkspaceResponse {
  ok: boolean;
  account: { sub: string; email: string; name?: string };
  createdNewFolder: boolean;
  folderUrl: string;
  subfolders: DriveWorkspaceSubfolders;
  bundle: DriveWorkspaceBundle;
  backups: DriveBackupFile[];
  fileRevisions: WorkspaceFileRevisions;
  restoredExistingWorkspace: boolean;
  initializedNewWorkspace: boolean;
  lastSyncedAt: string;
}

export const workspaceApi = {
  // ============================================================
  // GOOGLE AUTH DIAGNOSTIC TEST
  // ============================================================

  async testGoogleConnection(folderId?: string): Promise<{
    ok: boolean;
    sub: string;
    email: string;
    permissions: {
      identityConnected: boolean;
      driveGranted: boolean;
      sheetsGranted: boolean;
      gmailGranted: boolean;
    };
    folderCheck: { ok: boolean; folderId?: string; folderName?: string; error?: string };
    checkedAt: string;
  }> {
    return apiRequest(
      '/api/google/test',
      {
        method: 'POST',
        body: JSON.stringify(folderId ? { folderId } : {}),
      },
      { requireFolderId: false, overrideFolderId: folderId || null }
    );
  },

  // ============================================================
  // STATELESS BACKEND GOOGLE DRIVE WORKSPACE (/api/drive/*)
  // ============================================================

  async connectDriveWorkspace(params: {
    folderId?: string;
    folderUrl?: string;
    emptyDefaults?: {
      company: any;
      fieldCatalog: any[];
      mappingProfiles: any[];
      layoutConfig: { templates: any[] };
    };
  }): Promise<ConnectDriveWorkspaceResponse> {
    const res = await apiRequest<ConnectDriveWorkspaceResponse>(
      '/api/drive/connect',
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
      { requireFolderId: false, overrideFolderId: params.folderId || null }
    );
    activeFileRevisions = { ...(res.fileRevisions || {}) };
    return res;
  },

  async loadDriveWorkspace(folderId?: string): Promise<{
    ok: boolean;
    subfolders: DriveWorkspaceSubfolders;
    bundle: DriveWorkspaceBundle;
    backups: DriveBackupFile[];
    fileRevisions: WorkspaceFileRevisions;
    restoredExistingWorkspace: boolean;
    initializedNewWorkspace: boolean;
    lastSyncedAt: string;
  }> {
    const targetFolderId = folderId || getActiveWorkspaceId() || '';
    const res = await apiRequest<any>(
      `/api/drive/workspace?folderId=${encodeURIComponent(targetFolderId)}`,
      { method: 'GET' },
      { requireFolderId: true, overrideFolderId: targetFolderId }
    );
    activeFileRevisions = { ...(res.fileRevisions || {}) };
    return res;
  },

  async saveDriveWorkspace(
    folderId: string,
    bundle: DriveWorkspaceBundle,
    options?: { forceOverwrite?: boolean; allowEmptyOverwrite?: boolean }
  ): Promise<{
    syncedAt: string;
    fileRevisions: WorkspaceFileRevisions;
    subfolders: DriveWorkspaceSubfolders;
  }> {
    const res = await apiRequest<{
      ok: boolean;
      syncedAt: string;
      fileRevisions: WorkspaceFileRevisions;
      subfolders: DriveWorkspaceSubfolders;
    }>(
      '/api/drive/workspace',
      {
        method: 'POST',
        body: JSON.stringify({
          folderId,
          bundle,
          expectedRevisions: options?.forceOverwrite ? undefined : activeFileRevisions,
          forceOverwrite: Boolean(options?.forceOverwrite),
          allowEmptyOverwrite: Boolean(options?.allowEmptyOverwrite),
        }),
      },
      { requireFolderId: true, overrideFolderId: folderId }
    );
    activeFileRevisions = { ...(res.fileRevisions || {}) };
    return {
      syncedAt: res.syncedAt,
      fileRevisions: res.fileRevisions,
      subfolders: res.subfolders,
    };
  },

  async uploadPdfToDrive(params: {
    documentType: 'invoice' | 'quotation';
    fileName: string;
    pdfBase64: string;
  }): Promise<{ ok: boolean; file: DriveBackupFile; uploadedAt: string }> {
    return apiRequest(
      '/api/drive/files',
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'pdf',
          documentType: params.documentType,
          fileName: params.fileName,
          pdfBase64: params.pdfBase64,
        }),
      },
      { requireFolderId: true }
    );
  },

  async uploadAssetToDrive(params: {
    category?: 'logos' | 'signatures' | 'stamps' | 'other';
    assetName: string;
    dataUrl: string;
  }): Promise<DriveBackupFile | null> {
    if (!getActiveWorkspaceId() || !getAccessToken()) return null;
    const res = await apiRequest<{ ok: boolean; file: DriveBackupFile }>(
      '/api/drive/files',
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'asset',
          category: params.category,
          assetName: params.assetName,
          dataUrl: params.dataUrl,
        }),
      },
      { requireFolderId: true }
    );
    return res.file || null;
  },

  async createDriveBackup(bundle: DriveWorkspaceBundle): Promise<{
    ok: boolean;
    backup: DriveBackupFile;
    backups: DriveBackupFile[];
  }> {
    return apiRequest(
      '/api/drive/backups',
      {
        method: 'POST',
        body: JSON.stringify({ bundle }),
      },
      { requireFolderId: true }
    );
  },

  async listDriveBackups(): Promise<DriveBackupFile[]> {
    if (!getActiveWorkspaceId() || !getAccessToken()) return [];
    const res = await apiRequest<{ ok: boolean; backups: DriveBackupFile[] }>(
      '/api/drive/backups',
      { method: 'GET' },
      { requireFolderId: true }
    );
    return res.backups || [];
  },

  async restoreDriveBackup(backupFileId: string): Promise<{
    ok: boolean;
    restoredAt: string;
    bundle: DriveWorkspaceBundle;
  }> {
    const res = await apiRequest<{
      ok: boolean;
      restoredAt: string;
      bundle: DriveWorkspaceBundle;
      fileRevisions: WorkspaceFileRevisions;
    }>(
      '/api/drive/backups',
      {
        method: 'PUT',
        body: JSON.stringify({ backupFileId }),
      },
      { requireFolderId: true }
    );
    activeFileRevisions = { ...(res.fileRevisions || {}) };
    return {
      ok: true,
      restoredAt: res.restoredAt,
      bundle: res.bundle,
    };
  },

  async deleteDriveFile(fileId: string): Promise<{ ok: boolean; deleted: boolean; name: string }> {
    return apiRequest(
      '/api/drive/files',
      {
        method: 'DELETE',
        body: JSON.stringify({ fileId, confirmed: true }),
      },
      { requireFolderId: true }
    );
  },

  async fetchDriveFolderCounts(): Promise<{
    backupCount: number;
    invoicePdfCount: number;
    quotationPdfCount: number;
    assetCount: number;
    backups: DriveBackupFile[];
    invoices?: DriveBackupFile[];
    quotations?: DriveBackupFile[];
  }> {
    const folderId = getActiveWorkspaceId();
    if (!folderId || !getAccessToken()) {
      return {
        backupCount: 0,
        invoicePdfCount: 0,
        quotationPdfCount: 0,
        assetCount: 0,
        backups: [],
      };
    }
    return apiRequest(
      `/api/drive/files?folderId=${encodeURIComponent(folderId)}`,
      { method: 'GET' },
      { requireFolderId: true, overrideFolderId: folderId }
    );
  },

  // Compatibility helpers (quotations & invoices sync through App.tsx -> saveDriveWorkspace)
  async saveRemoteQuotation(_quotation: QuotationRecord): Promise<{ ok: boolean }> {
    return { ok: true };
  },

  async deleteRemoteQuotation(_id: string): Promise<{ ok: boolean }> {
    return { ok: true };
  },

  async convertRemoteQuotation(
    _quotationId: string,
    _invoice: GenerationRecord
  ): Promise<{ ok: boolean }> {
    return { ok: true };
  },

  // ============================================================
  // GMAIL API (/api/gmail/*) — DEFAULT EMAIL PROVIDER
  // ============================================================

  async sendGmailTestEmail(params: {
    recipientEmail: string;
    senderName?: string;
    replyTo?: string;
  }): Promise<{
    ok: boolean;
    messageId?: string;
    senderEmail: string;
    deliveryMethod: 'gmail_api';
    sentAt: string;
  }> {
    return apiRequest(
      '/api/gmail/test-send',
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
      { requireFolderId: false }
    );
  },

  async sendGmailEmails(params: {
    senderName?: string;
    replyTo?: string;
    items: Array<{
      documentType: 'invoice' | 'quotation';
      documentNumber: string;
      customerName: string;
      recipientEmail: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      pdfBase64?: string;
      pdfFilename?: string;
    }>;
  }): Promise<{
    ok: boolean;
    sentCount: number;
    failedCount: number;
    senderEmail: string;
    persistedInDrive: boolean;
    results: Array<{
      documentNumber: string;
      recipientEmail: string;
      status: 'Sent' | 'Failed';
      messageId?: string;
      error?: string;
      retryable?: boolean;
      deliveryMethod: EmailDeliveryMethod;
      sentAt: string;
    }>;
    logs: EmailDeliveryLogEntry[];
  }> {
    return apiRequest(
      '/api/gmail/send',
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
      { requireFolderId: false }
    );
  },

  // ============================================================
  // CUSTOM SMTP (OPTIONAL ALTERNATIVE — ENCRYPTED IN USER'S DRIVE)
  // ============================================================

  async fetchSmtpConfig(overrideFolderId?: string): Promise<BackendSmtpConfig> {
    const res = await apiRequest<{ smtp: BackendSmtpConfig }>(
      '/api/email/smtp-config',
      { method: 'GET' },
      { requireFolderId: true, overrideFolderId }
    );
    return res.smtp;
  },

  async saveSmtpConfig(input: {
    provider: SmtpProviderMethod;
    host: string;
    port: number;
    encryption: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password?: string;
    senderName: string;
    senderEmail: string;
    replyTo?: string;
  }): Promise<BackendSmtpConfig> {
    const res = await apiRequest<{ ok: boolean; smtp: BackendSmtpConfig }>(
      '/api/email/smtp-config',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      { requireFolderId: true }
    );
    return res.smtp;
  },

  async deleteSmtpConfig(): Promise<void> {
    await apiRequest('/api/email/smtp-config', { method: 'DELETE' }, { requireFolderId: true });
  },

  async testSmtpConfig(override?: {
    provider?: SmtpProviderMethod;
    host?: string;
    port?: number;
    encryption?: 'SSL' | 'STARTTLS' | 'NONE';
    username?: string;
    password?: string;
    senderName?: string;
    senderEmail?: string;
    replyTo?: string;
  }): Promise<{
    ok: boolean;
    host: string;
    port: number;
    provider: SmtpProviderMethod;
    verifiedAt: string;
  }> {
    return apiRequest(
      '/api/email/smtp-test',
      {
        method: 'POST',
        body: JSON.stringify(override || {}),
      },
      { requireFolderId: true }
    );
  },

  async sendTestEmail(recipientEmail: string): Promise<{
    ok: boolean;
    messageId?: string;
    provider: SmtpProviderMethod;
    sentAt: string;
  }> {
    return apiRequest(
      '/api/email/test-send',
      {
        method: 'POST',
        body: JSON.stringify({ recipientEmail }),
      },
      { requireFolderId: true }
    );
  },

  async sendRealEmails(params: {
    items: Array<{
      documentType: 'invoice' | 'quotation';
      documentNumber: string;
      customerName: string;
      recipientEmail: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      pdfBase64?: string;
      pdfFilename?: string;
    }>;
  }): Promise<{
    ok: boolean;
    sentCount: number;
    failedCount: number;
    persistedInDrive: boolean;
    results: Array<{
      documentNumber: string;
      recipientEmail: string;
      status: 'Sent' | 'Failed';
      messageId?: string;
      error?: string;
      deliveryMethod: EmailDeliveryMethod;
      sentAt: string;
    }>;
    logs: EmailDeliveryLogEntry[];
  }> {
    return apiRequest(
      '/api/email/send',
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
      { requireFolderId: true }
    );
  },

  async fetchEmailHistory(): Promise<EmailDeliveryLogEntry[]> {
    const res = await apiRequest<{ logs: EmailDeliveryLogEntry[] }>(
      '/api/email/history',
      { method: 'GET' },
      { requireFolderId: true }
    );
    return res.logs || [];
  },
};
