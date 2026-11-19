/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthenticatedUserProfile,
  BackendSmtpConfig,
  CustomerRecord,
  EmailDeliveryLogEntry,
  EmailDeliveryMethod,
  GenerationRecord,
  QuotationRecord,
  QuotationStatus,
} from '../types';
import { connectGoogleFeature, disconnectGoogleFeature, GoogleOAuthFeature } from './googleSheets';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected server response (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const err: any = new Error(parsed.error || `Request failed with HTTP ${res.status}.`);
    err.code = parsed.code;
    err.status = res.status;
    err.requiresReauth = Boolean(parsed.requiresReauth);
    throw err;
  }
  return parsed as T;
}

export interface WorkspaceBootstrapPayload {
  userId: string;
  onboardingCompleted: boolean;
  workspace: {
    companySettings: any | null;
    template: any | null;
    fields: any[] | null;
    calculationSettings: any | null;
    preferences: Record<string, any>;
    updatedAt: string;
    version: number;
  } | null;
  customers: CustomerRecord[];
  quotations: QuotationRecord[];
  invoices: GenerationRecord[];
  smtpConfig: BackendSmtpConfig;
  emailLogs: EmailDeliveryLogEntry[];
}

export interface DriveStatusPayload {
  connected: boolean;
  rootFolderName: string;
  rootFolderId: string | null;
  subfolders: Record<string, string>;
  subfolderNames: Record<string, string>;
  lastSyncAt: string | null;
  syncStatus: string | null;
  lastError: string | null;
  trackedFilesCount: number;
}

export const workspaceApi = {
  connectGoogle(feature: GoogleOAuthFeature, preferRedirect?: boolean) {
    return connectGoogleFeature(feature, { preferRedirect });
  },

  disconnectGoogle(feature: 'all' | 'drive' | 'sheets' | 'gmail' = 'all') {
    return disconnectGoogleFeature(feature);
  },

  fetchWorkspace(): Promise<WorkspaceBootstrapPayload> {
    return apiJson<WorkspaceBootstrapPayload>('/api/workspace', { method: 'GET' });
  },

  saveWorkspace(patch: {
    onboardingCompleted?: boolean;
    companySettings?: any;
    template?: any;
    fields?: any[];
    calculationSettings?: any;
    preferences?: Record<string, any>;
  }): Promise<any> {
    return apiJson('/api/workspace', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  saveCustomer(customer: CustomerRecord): Promise<{ customer: CustomerRecord }> {
    return apiJson('/api/workspace', {
      method: 'POST',
      body: JSON.stringify({ customer }),
    });
  },

  deleteCustomer(deleteCustomerId: string): Promise<{ deleted: boolean }> {
    return apiJson('/api/workspace', {
      method: 'POST',
      body: JSON.stringify({ deleteCustomerId }),
    });
  },

  // Quotations
  saveQuotation(quotation: QuotationRecord): Promise<{ quotation: QuotationRecord }> {
    return apiJson('/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ quotation }),
    });
  },

  updateQuotationStatus(
    id: string,
    payload: { status: QuotationStatus; notes?: string; rejectionReason?: string }
  ): Promise<{ quotation: QuotationRecord }> {
    return apiJson(`/api/quotations/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  convertQuotation(
    id: string,
    invoice: GenerationRecord
  ): Promise<{ quotation: QuotationRecord; invoice: GenerationRecord }> {
    return apiJson(`/api/quotations/${encodeURIComponent(id)}/convert`, {
      method: 'POST',
      body: JSON.stringify({ invoice }),
    });
  },

  deleteQuotation(id: string): Promise<{ deleted: boolean }> {
    return apiJson(`/api/quotations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // Invoices
  saveInvoice(invoice: GenerationRecord): Promise<{ invoice: GenerationRecord }> {
    return apiJson('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ invoice }),
    });
  },

  deleteInvoice(id: string): Promise<{ deleted: boolean }> {
    return apiJson(`/api/invoices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // Google Drive
  getDriveStatus(): Promise<DriveStatusPayload> {
    return apiJson<DriveStatusPayload>('/api/drive/status', { method: 'GET' });
  },

  syncDrive(): Promise<{
    ok: boolean;
    rootFolderId: string;
    filesSynced: number;
    quotationsSynced: number;
    invoicesSynced: number;
    customersSynced: number;
    emailLogsSynced: number;
    syncedAt: string;
  }> {
    return apiJson('/api/drive/sync', { method: 'POST', body: JSON.stringify({}) });
  },

  uploadPdfToDrive(params: {
    documentType: 'quotation' | 'invoice';
    documentId: string;
    fileName: string;
    pdfBase64: string;
  }): Promise<{ ok: boolean; driveFileId: string; fileName: string; updatedAt: string }> {
    return apiJson('/api/drive/upload-pdf', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  restoreFromDrive(): Promise<{
    ok: boolean;
    restoredSettings: boolean;
    customersRestored: number;
    quotationsRestored: number;
    invoicesRestored: number;
    conflictsResolved: number;
    restoredAt: string;
  }> {
    return apiJson('/api/drive/restore', { method: 'POST', body: JSON.stringify({}) });
  },

  createDriveBackup(): Promise<{ ok: boolean; driveFileId: string; fileName: string; createdAt: string }> {
    return apiJson('/api/drive/backup', { method: 'POST', body: JSON.stringify({}) });
  },

  // Dual Email Delivery (Gmail API + Backend SMTP)
  getSmtpConfig(): Promise<{ smtpConfig: BackendSmtpConfig }> {
    return apiJson('/api/email/smtp-config', { method: 'GET' });
  },

  saveSmtpConfig(payload: {
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password?: string;
    senderName: string;
    senderEmail: string;
  }): Promise<{ smtpConfig: BackendSmtpConfig }> {
    return apiJson('/api/email/smtp-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  testSmtpConnection(override?: {
    host?: string;
    port?: number;
    securityMode?: 'SSL' | 'STARTTLS' | 'NONE';
    username?: string;
    password?: string;
  }): Promise<{ ok: boolean; verifiedAt: string }> {
    return apiJson('/api/email/smtp-test', {
      method: 'POST',
      body: JSON.stringify(override || {}),
    });
  },

  sendEmails(payload: {
    method: EmailDeliveryMethod;
    items: Array<{
      documentType: 'invoice' | 'quotation';
      documentId: string;
      documentNumber: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      textBody: string;
      htmlBody?: string;
      attachment?: {
        filename: string;
        contentBase64: string;
        contentType?: string;
      };
    }>;
  }): Promise<{
    method: EmailDeliveryMethod;
    sentCount: number;
    failedCount: number;
    results: Array<{
      documentId: string;
      documentNumber: string;
      recipientEmail: string;
      deliveryMethod: EmailDeliveryMethod;
      senderEmail: string;
      status: 'sent' | 'failed';
      providerMessageId: string | null;
      errorMessage: string | null;
      logId: string;
    }>;
  }> {
    return apiJson('/api/email/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getEmailHistory(limit: number = 100): Promise<{ logs: EmailDeliveryLogEntry[] }> {
    return apiJson(`/api/email/history?limit=${limit}`, { method: 'GET' });
  },
};

export type { AuthenticatedUserProfile };
