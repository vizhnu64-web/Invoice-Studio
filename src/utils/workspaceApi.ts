/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BackendSmtpConfig,
  CompanySettings,
  CustomerRecord,
  EmailDeliveryLogEntry,
  EmailDeliveryMethod,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceTemplate,
  MappingProfile,
  QuotationRecord,
} from '../types';
import { getActiveWorkspaceId, getTempSessionId } from './storage';

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

function buildHeaders(overrideFolderId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-workspace-session-id': getTempSessionId(),
  };
  const folderId = overrideFolderId !== undefined ? overrideFolderId : getActiveWorkspaceId();
  if (folderId) {
    headers['x-workspace-folder-id'] = folderId;
  }
  return headers;
}

async function apiRequest<T>(
  url: string,
  init?: RequestInit,
  overrideFolderId?: string | null
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildHeaders(overrideFolderId),
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

export interface DriveBackupFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

export interface DriveConnectResponse {
  ok: boolean;
  connected: boolean;
  folderId: string;
  folderName: string;
  rootFolderId: string;
  folderUrl: string;
  serviceAccountEmail: string | null;
  restoredExistingWorkspace: boolean;
  workspace: {
    company: CompanySettings | null;
    fieldCatalog: InvoiceFieldConfig[];
    mappingProfiles: MappingProfile[];
    layoutConfig: { templates: InvoiceTemplate[] } | null;
    updatedAt: string;
  } | null;
  customers: CustomerRecord[];
  invoices: GenerationRecord[];
  quotations: QuotationRecord[];
  sheetsState: any;
  emailLogs: EmailDeliveryLogEntry[];
  backups: DriveBackupFile[];
  smtpConfig: BackendSmtpConfig;
  lastSyncedAt: string;
}

export interface DriveStatusResponse {
  connected: boolean;
  storageMode: 'google-drive' | 'temporary';
  folderId?: string;
  folderName?: string;
  rootFolderId?: string;
  serviceAccountEmail?: string | null;
  backupCount?: number;
  invoicePdfCount?: number;
  quotationPdfCount?: number;
  backups?: DriveBackupFile[];
  checkedAt?: string;
}

export interface DriveDiagnosticReport {
  ok: boolean;
  checkedAt: string;
  serviceAccountEmail: string | null;
  projectId: string | null;
  inputProvided: string;
  extractedFolderId: string | null;
  steps: {
    credentials: {
      ok: boolean;
      serviceAccountEmail: string | null;
      privateKeyFormatValid: boolean;
      clientInitialized: boolean;
      message: string;
    };
    folderIdExtraction: {
      ok: boolean;
      folderId: string | null;
      sourceType: 'folder_url' | 'query_id_url' | 'raw_id' | 'invalid';
      message: string;
    };
    folderMetadata: {
      attempted: boolean;
      ok: boolean;
      apiStatus: number | null;
      apiReason: string | null;
      apiMessage: string | null;
      folder?: {
        id: string;
        name: string;
        mimeType: string;
        isFolder: boolean;
        trashed: boolean;
        capabilities: {
          canEdit: boolean | null;
          canAddChildren: boolean | null;
          canListChildren: boolean | null;
        };
      };
    };
    permissionsList: {
      attempted: boolean;
      accessible: boolean;
      apiStatus: number | null;
      apiReason: string | null;
      apiMessage: string | null;
      totalPermissionsReturned: number | null;
      serviceAccountPermissionFound: boolean;
      serviceAccountRole: string | null;
      hasWriterPermission: boolean | null;
      note: string;
    };
    listChildren: {
      attempted: boolean;
      ok: boolean;
      apiStatus: number | null;
      apiReason: string | null;
      apiMessage: string | null;
      childrenCount: number | null;
      hasInvoiceStudioFolder: boolean;
    };
  };
  diagnosis: {
    probableCause: string;
    apiStatus: number | null;
    apiReason: string | null;
    summary: string;
    recommendedAction: string;
  };
}

export const workspaceApi = {
  // ============================================================
  // GOOGLE DRIVE WORKSPACE STORAGE (SERVICE ACCOUNT)
  // ============================================================

  async connectDriveFolder(folderUrl: string): Promise<DriveConnectResponse> {
    return apiRequest<DriveConnectResponse>('/api/drive/connect', {
      method: 'POST',
      body: JSON.stringify({ folderUrl }),
    });
  },

  async testDriveConnection(folderUrlOrId?: string): Promise<{
    ok: boolean;
    folderId: string;
    folderName: string;
    canEdit: boolean;
    canAddChildren?: boolean;
    canListChildren?: boolean;
    webViewLink?: string;
    serviceAccountEmail: string | null;
    testedAt: string;
  }> {
    return apiRequest('/api/drive/test', {
      method: 'POST',
      body: JSON.stringify(folderUrlOrId ? { folderUrl: folderUrlOrId } : {}),
    });
  },

  async diagnoseDriveFolder(folderUrlOrId?: string): Promise<DriveDiagnosticReport> {
    return apiRequest<DriveDiagnosticReport>('/api/drive/diagnose', {
      method: 'POST',
      body: JSON.stringify(folderUrlOrId ? { folderUrl: folderUrlOrId } : {}),
    });
  },

  async fetchDriveStatus(): Promise<DriveStatusResponse> {
    return apiRequest<DriveStatusResponse>('/api/drive/status');
  },

  async fetchRemoteWorkspace(): Promise<{
    workspace: {
      company: CompanySettings | null;
      fieldCatalog: InvoiceFieldConfig[];
      mappingProfiles: MappingProfile[];
      layoutConfig: { templates: InvoiceTemplate[] } | null;
      updatedAt: string;
    } | null;
    customers: CustomerRecord[];
    invoices: GenerationRecord[];
    quotations: QuotationRecord[];
    emailLogs: EmailDeliveryLogEntry[];
    backups: DriveBackupFile[];
    smtpConfig: BackendSmtpConfig;
    lastSyncedAt: string;
  }> {
    return apiRequest('/api/workspace');
  },

  async syncWorkspaceToDrive(payload: {
    workspace?: {
      company: CompanySettings;
      fieldCatalog: InvoiceFieldConfig[];
      mappingProfiles: MappingProfile[];
      layoutConfig: { templates: InvoiceTemplate[] };
      updatedAt: string;
    };
    customers?: CustomerRecord[];
    invoices?: GenerationRecord[];
    quotations?: QuotationRecord[];
    emailLogs?: EmailDeliveryLogEntry[];
  }): Promise<{ ok: boolean; folderId: string; syncedAt: string }> {
    return apiRequest('/api/drive/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async uploadPdfToDrive(params: {
    documentType: 'invoice' | 'quotation';
    fileName: string;
    pdfBase64: string;
  }): Promise<{ ok: boolean; file: DriveBackupFile; uploadedAt: string }> {
    return apiRequest('/api/drive/upload-pdf', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async createDriveBackup(): Promise<{
    ok: boolean;
    backup: DriveBackupFile;
    backups: DriveBackupFile[];
  }> {
    return apiRequest('/api/drive/backup', { method: 'POST', body: JSON.stringify({}) });
  },

  async restoreDriveBackup(backupFileId: string): Promise<{
    ok: boolean;
    restoredAt: string;
    snapshot: any;
  }> {
    return apiRequest('/api/drive/restore', {
      method: 'POST',
      body: JSON.stringify({ backupFileId }),
    });
  },

  // ============================================================
  // QUOTATIONS CRUD (CONNECTED DRIVE FOLDER)
  // ============================================================

  async saveRemoteQuotation(quotation: QuotationRecord): Promise<{ ok: boolean; quotations: QuotationRecord[] }> {
    return apiRequest('/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ quotation }),
    });
  },

  async deleteRemoteQuotation(id: string): Promise<{ ok: boolean; quotations: QuotationRecord[] }> {
    return apiRequest(`/api/quotations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async convertRemoteQuotation(
    quotationId: string,
    invoice: GenerationRecord
  ): Promise<{
    ok: boolean;
    invoice: GenerationRecord;
    quotation: QuotationRecord;
  }> {
    return apiRequest(`/api/quotations/${encodeURIComponent(quotationId)}/convert-to-invoice`, {
      method: 'POST',
      body: JSON.stringify({ invoice }),
    });
  },

  // ============================================================
  // EMAIL INTEGRATION — GMAIL SMTP & CUSTOM SMTP (NO SIGN-IN)
  // ============================================================

  async fetchSmtpConfig(): Promise<BackendSmtpConfig> {
    const res = await apiRequest<{ smtp: BackendSmtpConfig }>('/api/email/smtp-config');
    return res.smtp;
  },

  async saveSmtpConfig(input: {
    provider: EmailDeliveryMethod;
    host: string;
    port: number;
    encryption: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password?: string;
    senderName: string;
    senderEmail: string;
    replyTo?: string;
  }): Promise<BackendSmtpConfig> {
    const res = await apiRequest<{ ok: boolean; smtp: BackendSmtpConfig }>('/api/email/smtp-config', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.smtp;
  },

  async deleteSmtpConfig(): Promise<void> {
    await apiRequest('/api/email/smtp-config', { method: 'DELETE' });
  },

  async testSmtpConfig(override?: {
    provider?: EmailDeliveryMethod;
    host?: string;
    port?: number;
    encryption?: 'SSL' | 'STARTTLS' | 'NONE';
    username?: string;
    password?: string;
    senderName?: string;
    senderEmail?: string;
    replyTo?: string;
  }): Promise<{ ok: boolean; host: string; port: number; provider: EmailDeliveryMethod; verifiedAt: string }> {
    return apiRequest('/api/email/smtp-test', {
      method: 'POST',
      body: JSON.stringify(override || {}),
    });
  },

  async sendTestEmail(recipientEmail: string): Promise<{
    ok: boolean;
    messageId?: string;
    provider: EmailDeliveryMethod;
    sentAt: string;
  }> {
    return apiRequest('/api/email/test-send', {
      method: 'POST',
      body: JSON.stringify({ recipientEmail }),
    });
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
    return apiRequest('/api/email/send', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async fetchEmailHistory(): Promise<EmailDeliveryLogEntry[]> {
    const res = await apiRequest<{ logs: EmailDeliveryLogEntry[] }>('/api/email/history');
    return res.logs || [];
  },
};
