/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { drive_v3 } from 'googleapis';
import { AppServerConfig } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import {
  createDriveServiceAccountClient,
  downloadFileText,
  DriveFileMeta,
  DriveWorkspaceFolders,
  ensureWorkspaceFolderTree,
  listFilesInFolder,
  mapDriveApiError,
  readJsonFile,
  uploadBinaryFile,
  writeJsonFile,
} from './driveService.js';
import { HttpApiError } from './errors.js';

export type WorkspaceFolderSlot =
  | 'companySettings'
  | 'customers'
  | 'importedData'
  | 'invoicesRecords'
  | 'invoicesPdfs'
  | 'quotationsRecords'
  | 'quotationsPdfs'
  | 'emailHistory'
  | 'backups';

export interface WorkspaceStatePayload {
  company: Record<string, any> | null;
  fieldCatalog: any[];
  mappingProfiles: any[];
  layoutConfig: Record<string, any> | null;
  updatedAt: string;
}

export interface StoredSheetsDataset {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  lastSyncedAt: string;
  worksheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, any>[];
    headerRowIndex: number;
    rangeUsed: string;
    rowHashes: Record<string, string>;
  }>;
}

export interface StoredSheetsState {
  activeSpreadsheetId?: string;
  datasets: Record<string, StoredSheetsDataset>;
  syncHistory: Array<{
    id: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    worksheetName: string;
    status: 'success' | 'failed';
    rowsRetrieved: number;
    validRowsCount: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    skippedCount: number;
    errorMessage?: string;
    syncedAt: string;
  }>;
  updatedAt: string;
}

export type SmtpProviderType = 'gmail_smtp' | 'custom_smtp';

export interface StoredSmtpConfig {
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

export interface StoredEmailLogEntry {
  id: string;
  documentType: 'invoice' | 'quotation' | 'test';
  documentNumber: string;
  customerName: string;
  recipientEmail: string;
  cc?: string;
  bcc?: string;
  subject: string;
  deliveryMethod: SmtpProviderType;
  status: 'Sent' | 'Failed';
  messageId?: string;
  errorMessage?: string;
  sentAt: string;
}

export interface DriveBackupSnapshot {
  version: number;
  exportedAt: string;
  connectedFolderId: string;
  connectedFolderName: string;
  workspace: WorkspaceStatePayload | null;
  customers: any[];
  invoices: any[];
  quotations: any[];
  sheetsState: StoredSheetsState | null;
  emailLogs: StoredEmailLogEntry[];
}

export interface DriveTransport {
  ensureFolders: () => Promise<DriveWorkspaceFolders>;
  readJson: <T>(slot: WorkspaceFolderSlot, fileName: string) => Promise<T | null>;
  writeJson: <T>(slot: WorkspaceFolderSlot, fileName: string, data: T) => Promise<DriveFileMeta>;
  uploadBinary: (
    slot: WorkspaceFolderSlot,
    fileName: string,
    mimeType: string,
    buffer: Buffer
  ) => Promise<DriveFileMeta>;
  listFiles: (slot: WorkspaceFolderSlot, pageSize?: number) => Promise<DriveFileMeta[]>;
  downloadText: (fileId: string) => Promise<string>;
}

const FILE_COMPANY_WORKSPACE = 'workspace-state.json';
const FILE_SMTP_CONFIG = 'smtp-config.enc.json';
const FILE_CUSTOMERS = 'customers.json';
const FILE_IMPORTED_SHEETS = 'sheets-state.json';
const FILE_INVOICES = 'invoices.json';
const FILE_QUOTATIONS = 'quotations.json';
const FILE_EMAIL_LOGS = 'email-logs.json';

function resolveSlotFolderId(folders: DriveWorkspaceFolders, slot: WorkspaceFolderSlot): string {
  switch (slot) {
    case 'companySettings':
      return folders.companySettingsFolderId;
    case 'customers':
      return folders.customersFolderId;
    case 'importedData':
      return folders.importedDataFolderId;
    case 'invoicesRecords':
      return folders.invoicesRecordsFolderId;
    case 'invoicesPdfs':
      return folders.invoicesPdfsFolderId;
    case 'quotationsRecords':
      return folders.quotationsRecordsFolderId;
    case 'quotationsPdfs':
      return folders.quotationsPdfsFolderId;
    case 'emailHistory':
      return folders.emailHistoryFolderId;
    case 'backups':
      return folders.backupsFolderId;
  }
}

export function createLiveDriveTransport(folderId: string, config: AppServerConfig): DriveTransport {
  let cachedDrive: drive_v3.Drive | null = null;
  let cachedFolders: DriveWorkspaceFolders | null = null;

  const getDrive = (): drive_v3.Drive => {
    if (!cachedDrive) {
      cachedDrive = createDriveServiceAccountClient(config);
    }
    return cachedDrive;
  };

  const getFolders = async (): Promise<DriveWorkspaceFolders> => {
    if (!cachedFolders) {
      cachedFolders = await ensureWorkspaceFolderTree(getDrive(), folderId, config);
    }
    return cachedFolders;
  };

  return {
    ensureFolders: getFolders,
    async readJson<T>(slot: WorkspaceFolderSlot, fileName: string): Promise<T | null> {
      try {
        const folders = await getFolders();
        const res = await readJsonFile<T>(getDrive(), resolveSlotFolderId(folders, slot), fileName);
        return res ? res.data : null;
      } catch (err: any) {
        throw mapDriveApiError(err, config, folderId);
      }
    },
    async writeJson<T>(
      slot: WorkspaceFolderSlot,
      fileName: string,
      data: T
    ): Promise<DriveFileMeta> {
      try {
        const folders = await getFolders();
        return await writeJsonFile(getDrive(), resolveSlotFolderId(folders, slot), fileName, data);
      } catch (err: any) {
        throw mapDriveApiError(err, config, folderId);
      }
    },
    async uploadBinary(
      slot: WorkspaceFolderSlot,
      fileName: string,
      mimeType: string,
      buffer: Buffer
    ): Promise<DriveFileMeta> {
      try {
        const folders = await getFolders();
        return await uploadBinaryFile(
          getDrive(),
          resolveSlotFolderId(folders, slot),
          fileName,
          mimeType,
          buffer
        );
      } catch (err: any) {
        throw mapDriveApiError(err, config, folderId);
      }
    },
    async listFiles(slot: WorkspaceFolderSlot, pageSize: number = 50): Promise<DriveFileMeta[]> {
      try {
        const folders = await getFolders();
        return await listFilesInFolder(getDrive(), resolveSlotFolderId(folders, slot), pageSize);
      } catch (err: any) {
        throw mapDriveApiError(err, config, folderId);
      }
    },
    async downloadText(fileId: string): Promise<string> {
      try {
        return await downloadFileText(getDrive(), fileId);
      } catch (err: any) {
        throw mapDriveApiError(err, config, folderId);
      }
    },
  };
}

/**
 * Business-scoped persistent JSON + PDF store backed directly by a connected Google Drive folder.
 * Every connected Drive folder is isolated — no shared global database exists.
 */
export class GoogleDriveStore {
  readonly folderId: string;
  private readonly config: AppServerConfig;
  private readonly transport: DriveTransport;

  constructor(options: {
    folderId: string;
    config: AppServerConfig;
    driveTransport?: DriveTransport;
  }) {
    this.folderId = options.folderId;
    this.config = options.config;
    this.transport =
      options.driveTransport || createLiveDriveTransport(options.folderId, options.config);
  }

  async ensureFolders(): Promise<DriveWorkspaceFolders> {
    return this.transport.ensureFolders();
  }

  async readWorkspaceState(): Promise<WorkspaceStatePayload | null> {
    return this.transport.readJson<WorkspaceStatePayload>('companySettings', FILE_COMPANY_WORKSPACE);
  }

  async writeWorkspaceState(payload: WorkspaceStatePayload): Promise<DriveFileMeta> {
    return this.transport.writeJson('companySettings', FILE_COMPANY_WORKSPACE, {
      ...payload,
      updatedAt: new Date().toISOString(),
    });
  }

  async readCustomers(): Promise<any[]> {
    const data = await this.transport.readJson<any[]>('customers', FILE_CUSTOMERS);
    return Array.isArray(data) ? data : [];
  }

  async writeCustomers(customers: any[]): Promise<DriveFileMeta> {
    return this.transport.writeJson('customers', FILE_CUSTOMERS, customers);
  }

  async readInvoices(): Promise<any[]> {
    const data = await this.transport.readJson<any[]>('invoicesRecords', FILE_INVOICES);
    return Array.isArray(data) ? data : [];
  }

  async writeInvoices(invoices: any[]): Promise<DriveFileMeta> {
    return this.transport.writeJson('invoicesRecords', FILE_INVOICES, invoices);
  }

  async readQuotations(): Promise<any[]> {
    const data = await this.transport.readJson<any[]>('quotationsRecords', FILE_QUOTATIONS);
    return Array.isArray(data) ? data : [];
  }

  async writeQuotations(quotations: any[]): Promise<DriveFileMeta> {
    return this.transport.writeJson('quotationsRecords', FILE_QUOTATIONS, quotations);
  }

  async readSheetsState(): Promise<StoredSheetsState> {
    const data = await this.transport.readJson<StoredSheetsState>('importedData', FILE_IMPORTED_SHEETS);
    if (data && typeof data === 'object') {
      return {
        activeSpreadsheetId: data.activeSpreadsheetId,
        datasets: data.datasets || {},
        syncHistory: Array.isArray(data.syncHistory) ? data.syncHistory : [],
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
    return {
      datasets: {},
      syncHistory: [],
      updatedAt: new Date().toISOString(),
    };
  }

  async writeSheetsState(state: StoredSheetsState): Promise<DriveFileMeta> {
    return this.transport.writeJson('importedData', FILE_IMPORTED_SHEETS, {
      ...state,
      updatedAt: new Date().toISOString(),
    });
  }

  async readEmailLogs(): Promise<StoredEmailLogEntry[]> {
    const data = await this.transport.readJson<StoredEmailLogEntry[]>('emailHistory', FILE_EMAIL_LOGS);
    return Array.isArray(data) ? data : [];
  }

  async writeEmailLogs(logs: StoredEmailLogEntry[]): Promise<DriveFileMeta> {
    return this.transport.writeJson('emailHistory', FILE_EMAIL_LOGS, logs.slice(0, 500));
  }

  async appendEmailLogs(entries: StoredEmailLogEntry[]): Promise<DriveFileMeta> {
    const existing = await this.readEmailLogs();
    const merged = [...entries, ...existing].slice(0, 500);
    return this.writeEmailLogs(merged);
  }

  async readSmtpConfig(): Promise<StoredSmtpConfig | null> {
    return this.transport.readJson<StoredSmtpConfig>('companySettings', FILE_SMTP_CONFIG);
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
        'An SMTP password or Gmail App Password is required when configuring SMTP for the first time.'
      );
    }

    const record: StoredSmtpConfig = {
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

    await this.transport.writeJson('companySettings', FILE_SMTP_CONFIG, record);
    return record;
  }

  async deleteSmtpConfig(): Promise<void> {
    await this.transport.writeJson('companySettings', FILE_SMTP_CONFIG, null);
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

  async uploadInvoicePdf(fileName: string, pdfBuffer: Buffer): Promise<DriveFileMeta> {
    return this.transport.uploadBinary('invoicesPdfs', fileName, 'application/pdf', pdfBuffer);
  }

  async uploadQuotationPdf(fileName: string, pdfBuffer: Buffer): Promise<DriveFileMeta> {
    return this.transport.uploadBinary('quotationsPdfs', fileName, 'application/pdf', pdfBuffer);
  }

  async listInvoicePdfs(): Promise<DriveFileMeta[]> {
    return this.transport.listFiles('invoicesPdfs', 100);
  }

  async listQuotationPdfs(): Promise<DriveFileMeta[]> {
    return this.transport.listFiles('quotationsPdfs', 100);
  }

  async createBackupSnapshot(): Promise<{ file: DriveFileMeta; snapshot: DriveBackupSnapshot }> {
    const folders = await this.ensureFolders();
    const [workspace, customers, invoices, quotations, sheetsState, emailLogs] = await Promise.all([
      this.readWorkspaceState(),
      this.readCustomers(),
      this.readInvoices(),
      this.readQuotations(),
      this.readSheetsState(),
      this.readEmailLogs(),
    ]);

    const snapshot: DriveBackupSnapshot = {
      version: 2,
      exportedAt: new Date().toISOString(),
      connectedFolderId: folders.connectedFolderId,
      connectedFolderName: folders.connectedFolderName,
      workspace,
      customers,
      invoices,
      quotations,
      sheetsState,
      emailLogs,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = await this.transport.writeJson(
      'backups',
      `invoice-studio-backup-${stamp}.json`,
      snapshot
    );
    return { file, snapshot };
  }

  async listBackups(): Promise<DriveFileMeta[]> {
    return this.transport.listFiles('backups', 25);
  }

  async restoreBackupSnapshot(backupFileId: string): Promise<DriveBackupSnapshot> {
    const raw = await this.transport.downloadText(backupFileId);
    const snapshot = JSON.parse(raw) as DriveBackupSnapshot;

    if (!snapshot || typeof snapshot !== 'object') {
      throw new HttpApiError(400, 'INVALID_BACKUP', 'Selected Drive backup file is invalid JSON.');
    }

    if (snapshot.workspace) {
      await this.writeWorkspaceState(snapshot.workspace);
    }
    if (Array.isArray(snapshot.customers)) {
      await this.writeCustomers(snapshot.customers);
    }
    if (Array.isArray(snapshot.invoices)) {
      await this.writeInvoices(snapshot.invoices);
    }
    if (Array.isArray(snapshot.quotations)) {
      await this.writeQuotations(snapshot.quotations);
    }
    if (snapshot.sheetsState) {
      await this.writeSheetsState(snapshot.sheetsState);
    }
    if (Array.isArray(snapshot.emailLogs)) {
      await this.writeEmailLogs(snapshot.emailLogs);
    }

    return snapshot;
  }

  async exportAllWorkspaceData() {
    const [folders, workspace, customers, invoices, quotations, sheetsState, emailLogs, backups] =
      await Promise.all([
        this.ensureFolders(),
        this.readWorkspaceState(),
        this.readCustomers(),
        this.readInvoices(),
        this.readQuotations(),
        this.readSheetsState(),
        this.readEmailLogs(),
        this.listBackups(),
      ]);

    return {
      folders,
      workspace,
      customers,
      invoices,
      quotations,
      sheetsState,
      emailLogs,
      backups,
      lastSyncedAt: workspace?.updatedAt || sheetsState?.updatedAt || new Date().toISOString(),
    };
  }
}
