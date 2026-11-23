/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompanySettings,
  CustomerRecord,
  DriveSyncConflict,
  DriveWorkspaceSubfolders,
  EmailDeliveryLogEntry,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceTemplate,
  MappingProfile,
  QuotationRecord,
  SpreadsheetData,
} from '../types';
import { GoogleAuthError, googleTokenManager } from './googleAuth';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const INVOICE_STUDIO_FOLDER_NAME = 'Invoice Studio';

export const WORKSPACE_FILE_NAMES = {
  MAIN_DATA: 'invoice-studio-data.json',
  COMPANY_SETTINGS: 'company-settings.json',
  CUSTOMER_DATA: 'customer-data.json',
  PAYMENT_DATA: 'payment-data.json',
  EMAIL_SETTINGS: 'email-settings.json',
  EMAIL_HISTORY: 'email-history.json',
} as const;

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  headRevisionId?: string;
  size?: string;
  webViewLink?: string;
}

export interface DrivePaymentLedgerRecord {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
  paymentMethod?: string;
  paymentDate?: string;
  paymentReference?: string;
  paymentNotes?: string;
  updatedAt: string;
}

export interface DriveWorkspaceBundle {
  version: number;
  updatedAt: string;
  company: CompanySettings | null;
  fieldCatalog: InvoiceFieldConfig[];
  mappingProfiles: MappingProfile[];
  layoutConfig: { templates: InvoiceTemplate[] } | null;
  customers: CustomerRecord[];
  invoices: GenerationRecord[];
  quotations: QuotationRecord[];
  payments: DrivePaymentLedgerRecord[];
  emailLogs: EmailDeliveryLogEntry[];
  spreadsheetData: SpreadsheetData | null;
}

export interface LoadedDriveWorkspaceResult {
  subfolders: DriveWorkspaceSubfolders;
  bundle: DriveWorkspaceBundle;
  backups: DriveFileSummary[];
  restoredExistingWorkspace: boolean;
  initializedNewWorkspace: boolean;
  lastSyncedAt: string;
}

export interface DriveBackupPayload {
  version: number;
  exportedAt: string;
  folderId: string;
  folderName: string;
  bundle: DriveWorkspaceBundle;
}

export class DriveSyncConflictError extends Error {
  code = 'DRIVE_SYNC_CONFLICT' as const;
  conflict: DriveSyncConflict;

  constructor(conflict: DriveSyncConflict) {
    super(conflict.message);
    this.name = 'DriveSyncConflictError';
    this.conflict = conflict;
  }
}

export class DriveEmptyOverwriteError extends Error {
  code = 'EMPTY_OVERWRITE_BLOCKED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DriveEmptyOverwriteError';
  }
}

export class DriveClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DriveClientError';
    this.status = status;
    this.code = code;
  }
}

interface TrackedFileVersion {
  fileId: string;
  modifiedTime: string;
  headRevisionId?: string;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function extractPaymentLedger(invoices: GenerationRecord[]): DrivePaymentLedgerRecord[] {
  return (invoices || []).map((inv) => {
    const total = Number(inv.totalAmount || 0);
    const status = String(inv.paymentStatus || 'Unpaid');
    const paid =
      inv.paymentAmount !== undefined
        ? Math.min(total, Math.max(0, Number(inv.paymentAmount)))
        : status === 'Paid'
          ? total
          : 0;
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customerName,
      totalAmount: total,
      amountPaid: paid,
      balanceDue: Math.max(0, total - paid),
      paymentStatus: status,
      paymentMethod: inv.paymentMethod,
      paymentDate: inv.paymentDate,
      paymentReference: inv.paymentReference,
      paymentNotes: inv.paymentNotes,
      updatedAt: inv.updatedAt || inv.generatedDate || new Date().toISOString(),
    };
  });
}

function bundleHasMeaningfulData(bundle: Partial<DriveWorkspaceBundle> | null | undefined): boolean {
  if (!bundle) return false;
  return Boolean(
    bundle.company?.legalName?.trim() ||
      bundle.company?.displayName?.trim() ||
      (bundle.customers && bundle.customers.length > 0) ||
      (bundle.invoices && bundle.invoices.length > 0) ||
      (bundle.quotations && bundle.quotations.length > 0) ||
      (bundle.emailLogs && bundle.emailLogs.length > 0) ||
      (bundle.spreadsheetData && bundle.spreadsheetData.worksheets.length > 0)
  );
}

/**
 * Direct browser Google Drive API v3 workspace engine using the connected user's OAuth 2.0 access token.
 *
 * Guarantees:
 * - Never creates duplicate folders or duplicate JSON files.
 * - Tracks file modifiedTime/headRevisionId and detects multi-tab/session conflicts before writing.
 * - Never overwrites existing non-empty Drive records with an empty payload accidentally.
 * - Never deletes existing Drive files automatically.
 * - Detects 401 token expiry/revocation cleanly so UI prompts reconnection without losing unsaved changes.
 */
export class UserGoogleDriveClient {
  private readonly getToken: () => string;
  private readonly onExpired: () => void;
  private readonly fetchImpl: typeof fetch;

  private folderTreeCache = new Map<string, Promise<DriveWorkspaceSubfolders>>();
  private trackedVersions = new Map<string, TrackedFileVersion>();
  private loadedWorkspaceHadRecords = new Map<string, boolean>();

  constructor(options?: {
    getAccessToken?: () => string;
    onTokenExpired?: () => void;
    fetchImpl?: typeof fetch;
  }) {
    this.getToken = options?.getAccessToken || (() => googleTokenManager.requireAccessToken());
    this.onExpired = options?.onTokenExpired || (() => googleTokenManager.markExpired());
    this.fetchImpl = options?.fetchImpl || ((input, init) => fetch(input, init));
  }

  /**
   * Clears all in-memory folder & file revision tracking when disconnecting or switching accounts/folders.
   */
  resetCache(): void {
    this.folderTreeCache.clear();
    this.trackedVersions.clear();
    this.loadedWorkspaceHadRecords.clear();
  }

  private versionKey(folderId: string, fileName: string): string {
    return `${folderId}::${fileName}`;
  }

  private async request(url: string, init: RequestInit, context: string): Promise<Response> {
    const token = this.getToken();
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });

    if (res.status === 401) {
      this.onExpired();
      throw new GoogleAuthError(
        'GOOGLE_TOKEN_EXPIRED',
        'Your Google Drive authorization expired or was revoked. Click Reconnect Google Drive to save your changes.'
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let reason = '';
      let apiMessage = '';
      try {
        const parsed = JSON.parse(text);
        reason = String(parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || '');
        apiMessage = String(parsed?.error?.message || '');
      } catch {
        apiMessage = text.slice(0, 200);
      }

      if (res.status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')) {
        throw new DriveClientError(
          429,
          'DRIVE_RATE_LIMITED',
          'Google Drive API rate limit reached. Wait a few seconds and click Sync Now.'
        );
      }
      if (res.status === 403) {
        throw new DriveClientError(
          403,
          'DRIVE_PERMISSION_DENIED',
          apiMessage || `Google Drive denied permission while attempting to ${context}.`
        );
      }
      if (res.status === 404) {
        throw new DriveClientError(
          404,
          'DRIVE_NOT_FOUND',
          `Google Drive could not find the requested item while attempting to ${context}. Re-select your folder via Google Picker.`
        );
      }

      throw new DriveClientError(
        res.status,
        'DRIVE_API_ERROR',
        apiMessage || `Google Drive request failed (HTTP ${res.status}) while attempting to ${context}.`
      );
    }

    return res;
  }

  /**
   * Locates an existing accessible "Invoice Studio" folder in My Drive, or creates one if absent.
   * Never creates duplicate "Invoice Studio" folders when an existing one is already accessible.
   */
  async findOrCreateInvoiceStudioFolder(): Promise<{
    id: string;
    name: string;
    url: string;
    createdNew: boolean;
  }> {
    const q = encodeURIComponent(
      `name = '${escapeDriveQuery(INVOICE_STUDIO_FOLDER_NAME)}' and mimeType = '${FOLDER_MIME}' and trashed = false`
    );
    const listRes = await this.request(
      `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`,
      { method: 'GET' },
      'check for existing Invoice Studio folder'
    );
    const listData = (await listRes.json()) as { files?: DriveFileSummary[] };
    const existing = listData.files?.[0];
    if (existing?.id) {
      return {
        id: existing.id,
        name: existing.name || INVOICE_STUDIO_FOLDER_NAME,
        url: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
        createdNew: false,
      };
    }

    const createRes = await this.request(
      `${DRIVE_API_BASE}/files?fields=id,name,webViewLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: INVOICE_STUDIO_FOLDER_NAME,
          mimeType: FOLDER_MIME,
        }),
      },
      'create Invoice Studio folder'
    );
    const created = (await createRes.json()) as DriveFileSummary;
    return {
      id: created.id,
      name: created.name || INVOICE_STUDIO_FOLDER_NAME,
      url: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
      createdNew: true,
    };
  }

  async getFolderMetadata(folderId: string): Promise<{
    id: string;
    name: string;
    mimeType: string;
    trashed: boolean;
    canEdit: boolean;
    canAddChildren: boolean;
    canListChildren: boolean;
    webViewLink: string;
  }> {
    const fields = encodeURIComponent(
      'id,name,mimeType,trashed,webViewLink,capabilities(canEdit,canAddChildren,canListChildren)'
    );
    const res = await this.request(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?fields=${fields}`,
      { method: 'GET' },
      'verify selected folder metadata'
    );
    const data = (await res.json()) as any;
    if (data.mimeType !== FOLDER_MIME) {
      throw new DriveClientError(
        400,
        'NOT_A_FOLDER',
        'The selected Google Drive item is not a folder. Please choose a folder.'
      );
    }
    if (data.trashed) {
      throw new DriveClientError(
        400,
        'FOLDER_TRASHED',
        'The selected Google Drive folder is in the Trash. Restore it or select another folder.'
      );
    }
    const canEdit = Boolean(data.capabilities?.canEdit);
    const canAddChildren = Boolean(data.capabilities?.canAddChildren);
    const canListChildren = Boolean(data.capabilities?.canListChildren);
    if (!canAddChildren && !canEdit) {
      throw new DriveClientError(
        403,
        'FOLDER_READ_ONLY',
        `Folder "${data.name || folderId}" is read-only. Select a folder where your Google account has edit access.`
      );
    }
    return {
      id: String(data.id || folderId),
      name: String(data.name || INVOICE_STUDIO_FOLDER_NAME),
      mimeType: String(data.mimeType),
      trashed: false,
      canEdit,
      canAddChildren,
      canListChildren,
      webViewLink: String(data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`),
    };
  }

  private async findChildFile(
    parentId: string,
    name: string,
    mimeType?: string
  ): Promise<DriveFileSummary | null> {
    const parts = [
      `'${escapeDriveQuery(parentId)}' in parents`,
      `name = '${escapeDriveQuery(name)}'`,
      'trashed = false',
    ];
    if (mimeType) {
      parts.push(`mimeType = '${escapeDriveQuery(mimeType)}'`);
    }
    const q = encodeURIComponent(parts.join(' and '));
    const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,headRevisionId,size,webViewLink)');
    const res = await this.request(
      `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=5`,
      { method: 'GET' },
      `find "${name}"`
    );
    const data = (await res.json()) as { files?: DriveFileSummary[] };
    return data.files?.[0] || null;
  }

  private async findOrCreateSubfolder(parentId: string, name: string): Promise<string> {
    const existing = await this.findChildFile(parentId, name, FOLDER_MIME);
    if (existing?.id) return existing.id;

    const res = await this.request(
      `${DRIVE_API_BASE}/files?fields=id,name`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          parents: [parentId],
        }),
      },
      `create "${name}" subfolder`
    );
    const created = (await res.json()) as DriveFileSummary;
    return created.id;
  }

  /**
   * Ensures the standard Invoice Studio folder layout inside the user's connected folder:
   *   Invoice Studio/
   *     workspace/
   *     Invoices/
   *     Quotations/
   *     Backups/
   *     Assets/
   * Sequential creation + in-flight promise deduplication prevents duplicates and rate-limit bursts.
   */
  async ensureWorkspaceStructure(rootFolderId: string): Promise<DriveWorkspaceSubfolders> {
    const existingPromise = this.folderTreeCache.get(rootFolderId);
    if (existingPromise) return existingPromise;

    const promise = (async (): Promise<DriveWorkspaceSubfolders> => {
      const meta = await this.getFolderMetadata(rootFolderId);
      const workspaceFolderId = await this.findOrCreateSubfolder(meta.id, 'workspace');
      const invoicesFolderId = await this.findOrCreateSubfolder(meta.id, 'Invoices');
      const quotationsFolderId = await this.findOrCreateSubfolder(meta.id, 'Quotations');
      const backupsFolderId = await this.findOrCreateSubfolder(meta.id, 'Backups');
      const assetsFolderId = await this.findOrCreateSubfolder(meta.id, 'Assets');

      return {
        rootFolderId: meta.id,
        rootFolderName: meta.name,
        workspaceFolderId,
        invoicesFolderId,
        quotationsFolderId,
        backupsFolderId,
        assetsFolderId,
      };
    })().catch((err) => {
      this.folderTreeCache.delete(rootFolderId);
      throw err;
    });

    this.folderTreeCache.set(rootFolderId, promise);
    return promise;
  }

  private async readJsonFile<T>(
    rootFolderId: string,
    parentFolderId: string,
    fileName: string
  ): Promise<{ meta: DriveFileSummary; data: T } | null> {
    const found = await this.findChildFile(parentFolderId, fileName);
    if (!found) return null;

    const res = await this.request(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(found.id)}?alt=media`,
      { method: 'GET' },
      `read "${fileName}"`
    );
    const text = await res.text();
    if (!text.trim()) return null;

    const parsed = JSON.parse(text) as T;
    if (found.modifiedTime) {
      this.trackedVersions.set(this.versionKey(rootFolderId, fileName), {
        fileId: found.id,
        modifiedTime: found.modifiedTime,
        headRevisionId: found.headRevisionId,
      });
    }
    return { meta: found, data: parsed };
  }

  private async checkConflictBeforeWrite(
    rootFolderId: string,
    fileName: string,
    existingFile: DriveFileSummary | null
  ): Promise<void> {
    const tracked = this.trackedVersions.get(this.versionKey(rootFolderId, fileName));
    if (!existingFile) return;

    // Case 1: We loaded this file earlier, and another browser session modified it since then
    if (tracked && tracked.fileId === existingFile.id) {
      const remoteChanged =
        (existingFile.modifiedTime &&
          tracked.modifiedTime &&
          existingFile.modifiedTime !== tracked.modifiedTime) ||
        (existingFile.headRevisionId &&
          tracked.headRevisionId &&
          existingFile.headRevisionId !== tracked.headRevisionId);

      if (remoteChanged) {
        throw new DriveSyncConflictError({
          fileName,
          fileId: existingFile.id,
          loadedModifiedTime: tracked.modifiedTime,
          remoteModifiedTime: existingFile.modifiedTime || new Date().toISOString(),
          message: `"${fileName}" was updated in another session (${existingFile.modifiedTime || 'newer version'}). Reload the latest data from Google Drive or back up and overwrite.`,
        });
      }
      return;
    }

    // Case 2: File already exists in Drive, but our session never loaded it — prevent blind overwrite!
    if (!tracked) {
      throw new DriveSyncConflictError({
        fileName,
        fileId: existingFile.id,
        loadedModifiedTime: 'not loaded in this session',
        remoteModifiedTime: existingFile.modifiedTime || 'existing Drive file',
        message: `An existing "${fileName}" file was found in Google Drive that was not loaded in this session. Reload from Drive first to avoid overwriting existing records.`,
      });
    }
  }

  private async writeJsonFile<T>(
    rootFolderId: string,
    parentFolderId: string,
    fileName: string,
    payload: T,
    options?: { forceOverwrite?: boolean }
  ): Promise<DriveFileSummary> {
    const existing = await this.findChildFile(parentFolderId, fileName);
    if (!options?.forceOverwrite) {
      await this.checkConflictBeforeWrite(rootFolderId, fileName, existing);
    }

    const jsonBody = JSON.stringify(payload, null, 2);
    const fields = encodeURIComponent('id,name,mimeType,modifiedTime,headRevisionId,size,webViewLink');

    let updated: DriveFileSummary;
    if (existing?.id) {
      const res = await this.request(
        `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=${fields}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: jsonBody,
        },
        `update "${fileName}"`
      );
      updated = (await res.json()) as DriveFileSummary;
    } else {
      const boundary = `inv_studio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const metadata = JSON.stringify({
        name: fileName,
        mimeType: 'application/json',
        parents: [parentFolderId],
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

      const res = await this.request(
        `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${fields}`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: multipartBody,
        },
        `create "${fileName}"`
      );
      updated = (await res.json()) as DriveFileSummary;
    }

    if (updated?.id) {
      this.trackedVersions.set(this.versionKey(rootFolderId, fileName), {
        fileId: updated.id,
        modifiedTime: updated.modifiedTime || new Date().toISOString(),
        headRevisionId: updated.headRevisionId,
      });
    }
    return updated;
  }

  /**
   * Loads existing workspace files from the connected Drive folder, or initializes an empty workspace
   * ONLY when no existing workspace JSON exists.
   */
  async loadOrInitializeWorkspace(
    rootFolderId: string,
    emptyDefaults: {
      company: CompanySettings;
      fieldCatalog: InvoiceFieldConfig[];
      mappingProfiles: MappingProfile[];
      layoutConfig: { templates: InvoiceTemplate[] };
    }
  ): Promise<LoadedDriveWorkspaceResult> {
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);

    const [mainFile, companyFile, customerFile, paymentFile, emailHistoryFile, backups] =
      await Promise.all([
        this.readJsonFile<any>(
          rootFolderId,
          subfolders.workspaceFolderId,
          WORKSPACE_FILE_NAMES.MAIN_DATA
        ),
        this.readJsonFile<CompanySettings>(
          rootFolderId,
          subfolders.workspaceFolderId,
          WORKSPACE_FILE_NAMES.COMPANY_SETTINGS
        ),
        this.readJsonFile<CustomerRecord[]>(
          rootFolderId,
          subfolders.workspaceFolderId,
          WORKSPACE_FILE_NAMES.CUSTOMER_DATA
        ),
        this.readJsonFile<DrivePaymentLedgerRecord[]>(
          rootFolderId,
          subfolders.workspaceFolderId,
          WORKSPACE_FILE_NAMES.PAYMENT_DATA
        ),
        this.readJsonFile<EmailDeliveryLogEntry[]>(
          rootFolderId,
          subfolders.workspaceFolderId,
          WORKSPACE_FILE_NAMES.EMAIL_HISTORY
        ),
        this.listBackups(rootFolderId),
      ]);

    const hasExistingWorkspace = Boolean(mainFile || companyFile || customerFile);

    if (hasExistingWorkspace) {
      const mainData = mainFile?.data || {};
      const invoices: GenerationRecord[] = Array.isArray(mainData.invoices) ? mainData.invoices : [];
      const quotations: QuotationRecord[] = Array.isArray(mainData.quotations)
        ? mainData.quotations
        : [];
      const customers: CustomerRecord[] = Array.isArray(customerFile?.data)
        ? customerFile.data
        : Array.isArray(mainData.customers)
          ? mainData.customers
          : [];
      const payments: DrivePaymentLedgerRecord[] = Array.isArray(paymentFile?.data)
        ? paymentFile.data
        : extractPaymentLedger(invoices);
      const emailLogs: EmailDeliveryLogEntry[] = Array.isArray(emailHistoryFile?.data)
        ? emailHistoryFile.data
        : Array.isArray(mainData.emailLogs)
          ? mainData.emailLogs
          : [];

      const bundle: DriveWorkspaceBundle = {
        version: 2,
        updatedAt: mainData.updatedAt || mainFile?.meta.modifiedTime || new Date().toISOString(),
        company: companyFile?.data || mainData.company || null,
        fieldCatalog: Array.isArray(mainData.fieldCatalog) ? mainData.fieldCatalog : [],
        mappingProfiles: Array.isArray(mainData.mappingProfiles) ? mainData.mappingProfiles : [],
        layoutConfig: mainData.layoutConfig || null,
        customers,
        invoices,
        quotations,
        payments,
        emailLogs,
        spreadsheetData: mainData.spreadsheetData || null,
      };

      this.loadedWorkspaceHadRecords.set(rootFolderId, bundleHasMeaningfulData(bundle));

      return {
        subfolders,
        bundle,
        backups,
        restoredExistingWorkspace: true,
        initializedNewWorkspace: false,
        lastSyncedAt: bundle.updatedAt,
      };
    }

    // No workspace files exist in this folder yet — initialize a genuinely empty workspace
    const now = new Date().toISOString();
    const emptyBundle: DriveWorkspaceBundle = {
      version: 2,
      updatedAt: now,
      company: emptyDefaults.company,
      fieldCatalog: emptyDefaults.fieldCatalog,
      mappingProfiles: emptyDefaults.mappingProfiles,
      layoutConfig: emptyDefaults.layoutConfig,
      customers: [],
      invoices: [],
      quotations: [],
      payments: [],
      emailLogs: [],
      spreadsheetData: null,
    };

    await this.writeWorkspaceFiles(rootFolderId, subfolders, emptyBundle, {
      forceOverwrite: false,
      allowEmptyOverwrite: true,
    });
    this.loadedWorkspaceHadRecords.set(rootFolderId, false);

    return {
      subfolders,
      bundle: emptyBundle,
      backups,
      restoredExistingWorkspace: false,
      initializedNewWorkspace: true,
      lastSyncedAt: now,
    };
  }

  private async writeWorkspaceFiles(
    rootFolderId: string,
    subfolders: DriveWorkspaceSubfolders,
    bundle: DriveWorkspaceBundle,
    options?: { forceOverwrite?: boolean; allowEmptyOverwrite?: boolean }
  ): Promise<string> {
    const previouslyHadData = this.loadedWorkspaceHadRecords.get(rootFolderId) === true;
    const incomingHasData = bundleHasMeaningfulData(bundle);

    if (previouslyHadData && !incomingHasData && !options?.allowEmptyOverwrite) {
      throw new DriveEmptyOverwriteError(
        'Sync blocked to protect your existing Google Drive records from being overwritten with an empty workspace. Reload from Google Drive first.'
      );
    }

    const syncedAt = new Date().toISOString();
    const payments = extractPaymentLedger(bundle.invoices);

    const mainPayload = {
      version: 2,
      updatedAt: syncedAt,
      fieldCatalog: bundle.fieldCatalog,
      mappingProfiles: bundle.mappingProfiles,
      layoutConfig: bundle.layoutConfig,
      invoices: bundle.invoices,
      quotations: bundle.quotations,
      emailLogs: bundle.emailLogs,
      spreadsheetData: bundle.spreadsheetData,
    };

    // Write sequentially to avoid Drive rate-limit bursts and fail fast on conflict
    await this.writeJsonFile(
      rootFolderId,
      subfolders.workspaceFolderId,
      WORKSPACE_FILE_NAMES.MAIN_DATA,
      mainPayload,
      options
    );
    await this.writeJsonFile(
      rootFolderId,
      subfolders.workspaceFolderId,
      WORKSPACE_FILE_NAMES.COMPANY_SETTINGS,
      bundle.company,
      options
    );
    await this.writeJsonFile(
      rootFolderId,
      subfolders.workspaceFolderId,
      WORKSPACE_FILE_NAMES.CUSTOMER_DATA,
      bundle.customers,
      options
    );
    await this.writeJsonFile(
      rootFolderId,
      subfolders.workspaceFolderId,
      WORKSPACE_FILE_NAMES.PAYMENT_DATA,
      payments,
      options
    );

    if (incomingHasData) {
      this.loadedWorkspaceHadRecords.set(rootFolderId, true);
    }
    return syncedAt;
  }

  async saveWorkspace(
    rootFolderId: string,
    bundle: DriveWorkspaceBundle,
    options?: { forceOverwrite?: boolean; allowEmptyOverwrite?: boolean }
  ): Promise<{ syncedAt: string }> {
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);
    const syncedAt = await this.writeWorkspaceFiles(rootFolderId, subfolders, bundle, options);
    return { syncedAt };
  }

  async uploadBinaryToFolder(
    parentFolderId: string,
    fileName: string,
    mimeType: string,
    bytes: Uint8Array
  ): Promise<DriveFileSummary> {
    const existing = await this.findChildFile(parentFolderId, fileName);
    const fields = encodeURIComponent('id,name,mimeType,modifiedTime,size,webViewLink');

    if (existing?.id) {
      const res = await this.request(
        `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=${fields}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': mimeType },
          body: bytes as unknown as BodyInit,
        },
        `update "${fileName}"`
      );
      return (await res.json()) as DriveFileSummary;
    }

    const boundary = `inv_bin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const encoder = new TextEncoder();
    const metaPart = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
        name: fileName,
        mimeType,
        parents: [parentFolderId],
      })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const endPart = encoder.encode(`\r\n--${boundary}--`);

    const combined = new Uint8Array(metaPart.length + bytes.length + endPart.length);
    combined.set(metaPart, 0);
    combined.set(bytes, metaPart.length);
    combined.set(endPart, metaPart.length + bytes.length);

    const res = await this.request(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${fields}`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: combined as unknown as BodyInit,
      },
      `upload "${fileName}"`
    );
    return (await res.json()) as DriveFileSummary;
  }

  async uploadPdf(
    rootFolderId: string,
    documentType: 'invoice' | 'quotation',
    fileName: string,
    pdfBase64: string
  ): Promise<DriveFileSummary> {
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);
    const cleanBase64 = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1] : pdfBase64;
    const binaryStr = atob(cleanBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const targetFolder =
      documentType === 'quotation' ? subfolders.quotationsFolderId : subfolders.invoicesFolderId;
    const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    return this.uploadBinaryToFolder(targetFolder, safeName, 'application/pdf', bytes);
  }

  async uploadAssetDataUrl(
    rootFolderId: string,
    assetName: string,
    dataUrl: string
  ): Promise<DriveFileSummary | null> {
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1];
    const base64 = match[2];
    const ext = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);
    const safeName = `${assetName.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
    return this.uploadBinaryToFolder(subfolders.assetsFolderId, safeName, mimeType, bytes);
  }

  async createBackup(
    rootFolderId: string,
    bundle: DriveWorkspaceBundle
  ): Promise<{ backup: DriveFileSummary; backups: DriveFileSummary[] }> {
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);
    const exportedAt = new Date().toISOString();
    const stamp = exportedAt.replace(/[:.]/g, '-');
    const fileName = `invoice-studio-backup-${stamp}.json`;

    const payload: DriveBackupPayload = {
      version: 2,
      exportedAt,
      folderId: subfolders.rootFolderId,
      folderName: subfolders.rootFolderName,
      bundle,
    };

    const backup = await this.writeJsonFile(
      rootFolderId,
      subfolders.backupsFolderId,
      fileName,
      payload,
      { forceOverwrite: true }
    );
    const backups = await this.listBackups(rootFolderId);
    return { backup, backups };
  }

  async listBackups(rootFolderId: string): Promise<DriveFileSummary[]> {
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);
    const q = encodeURIComponent(
      `'${escapeDriveQuery(subfolders.backupsFolderId)}' in parents and trashed = false`
    );
    const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size,webViewLink)');
    const res = await this.request(
      `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=25`,
      { method: 'GET' },
      'list Drive backups'
    );
    const data = (await res.json()) as { files?: DriveFileSummary[] };
    return Array.isArray(data.files) ? data.files : [];
  }

  async listFolderFiles(
    rootFolderId: string,
    slot: 'invoices' | 'quotations' | 'assets' | 'backups'
  ): Promise<DriveFileSummary[]> {
    const subfolders = await this.ensureWorkspaceStructure(rootFolderId);
    const folderId =
      slot === 'invoices'
        ? subfolders.invoicesFolderId
        : slot === 'quotations'
          ? subfolders.quotationsFolderId
          : slot === 'assets'
            ? subfolders.assetsFolderId
            : subfolders.backupsFolderId;

    const q = encodeURIComponent(`'${escapeDriveQuery(folderId)}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size,webViewLink)');
    const res = await this.request(
      `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=100`,
      { method: 'GET' },
      `list ${slot} files`
    );
    const data = (await res.json()) as { files?: DriveFileSummary[] };
    return Array.isArray(data.files) ? data.files : [];
  }

  async restoreBackup(
    rootFolderId: string,
    backupFileId: string
  ): Promise<{ bundle: DriveWorkspaceBundle; restoredAt: string }> {
    const res = await this.request(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(backupFileId)}?alt=media`,
      { method: 'GET' },
      'download backup file'
    );
    const text = await res.text();
    const parsed = JSON.parse(text) as DriveBackupPayload | any;
    const bundle: DriveWorkspaceBundle | null = parsed?.bundle || null;
    if (!bundle || typeof bundle !== 'object') {
      throw new DriveClientError(
        400,
        'INVALID_BACKUP_FORMAT',
        'Selected Google Drive backup file does not contain a valid Invoice Studio snapshot.'
      );
    }

    const { syncedAt } = await this.saveWorkspace(rootFolderId, bundle, {
      forceOverwrite: true,
      allowEmptyOverwrite: true,
    });
    return { bundle, restoredAt: syncedAt };
  }
}

export const driveClient = new UserGoogleDriveClient();
