/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import { google, drive_v3 } from 'googleapis';
import { HttpApiError } from './errors.js';
import { createRequestOAuthClient } from './googleAuth.js';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const INVOICE_STUDIO_FOLDER_NAME = 'Invoice Studio';
export const WORKSPACE_SCHEMA_VERSION = 3;

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
  parents?: string[];
}

export interface DriveWorkspaceSubfolders {
  rootFolderId: string;
  rootFolderName: string;
  workspaceFolderId: string;
  invoicesFolderId: string;
  quotationsFolderId: string;
  backupsFolderId: string;
  assetsFolderId: string;
  logosFolderId: string;
  signaturesFolderId: string;
  stampsFolderId: string;
}

export interface TrackedFileRevision {
  fileId: string;
  modifiedTime: string;
  headRevisionId?: string;
}

export type WorkspaceFileRevisions = Record<string, TrackedFileRevision>;

export interface DriveSyncConflictPayload {
  fileName: string;
  fileId: string;
  loadedModifiedTime: string;
  remoteModifiedTime: string;
  message: string;
}

export interface DriveWorkspaceBundle {
  version: number;
  updatedAt: string;
  company: any;
  fieldCatalog: any[];
  mappingProfiles: any[];
  layoutConfig: { templates: any[] } | null;
  customers: any[];
  invoices: any[];
  quotations: any[];
  payments: any[];
  emailLogs: any[];
  spreadsheetData: any | null;
}

export type DriveFileSlot =
  | 'invoices'
  | 'quotations'
  | 'backups'
  | 'assets'
  | 'logos'
  | 'signatures'
  | 'stamps'
  | 'workspace';

export type AssetCategory = 'logos' | 'signatures' | 'stamps' | 'other';

export interface DriveApiLike {
  files: {
    get: (params: any, options?: any) => Promise<{ data: any }>;
    list: (params: any) => Promise<{ data: { files?: any[] } }>;
    create: (params: any) => Promise<{ data: any }>;
    update: (params: any) => Promise<{ data: any }>;
  };
}

export function createRequestDriveClient(accessToken: string): drive_v3.Drive {
  const auth = createRequestOAuthClient(accessToken);
  return google.drive({ version: 'v3', auth });
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Extracts a Google Drive folder ID from a pasted URL or direct folder ID.
 */
export function extractDriveFolderIdFromInput(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    throw new HttpApiError(
      400,
      'INVALID_DRIVE_FOLDER_URL',
      'Please paste a valid Google Drive folder URL or folder ID.'
    );
  }

  const patterns = [
    /\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{8,128})/,
    /[?&]id=([a-zA-Z0-9_-]{8,128})/,
  ];
  for (const regex of patterns) {
    const match = trimmed.match(regex);
    if (match?.[1]) return match[1];
  }

  if (/^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)) {
    return trimmed;
  }

  throw new HttpApiError(
    400,
    'INVALID_DRIVE_FOLDER_URL',
    'Invalid Google Drive folder URL or ID. Paste a link like https://drive.google.com/drive/folders/<folder-id>.'
  );
}

function mapDriveApiError(err: any, context: string): HttpApiError {
  if (err instanceof HttpApiError) return err;
  const status = Number(err?.code || err?.response?.status || err?.status || 502);
  const reason = String(
    err?.errors?.[0]?.reason ||
      err?.response?.data?.error?.errors?.[0]?.reason ||
      err?.response?.data?.error?.status ||
      ''
  );
  const apiMessage = String(
    err?.response?.data?.error?.message || err?.message || `Google Drive request failed while attempting to ${context}.`
  );

  if (status === 401 || reason === 'authError' || reason === 'invalidCredentials') {
    return new HttpApiError(
      401,
      'GOOGLE_TOKEN_EXPIRED',
      'Your Google authorization expired or was revoked. Reconnect your Google account to continue.'
    );
  }

  if (status === 403) {
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return new HttpApiError(
        429,
        'DRIVE_RATE_LIMITED',
        'Google Drive API rate limit reached. Wait a few seconds and retry.'
      );
    }
    return new HttpApiError(
      403,
      'DRIVE_PERMISSION_DENIED',
      apiMessage ||
        `Your connected Google account does not have permission to ${context}. Select a folder you own or created via Invoice Studio.`
    );
  }

  if (status === 404) {
    return new HttpApiError(
      404,
      'DRIVE_NOT_FOUND',
      `The requested Google Drive folder or file was not found or is outside drive.file access while attempting to ${context}. Select the folder via Google Picker or let Invoice Studio create one.`
    );
  }

  return new HttpApiError(
    status >= 400 && status < 600 ? status : 502,
    'DRIVE_API_ERROR',
    apiMessage
  );
}

export function extractPaymentLedger(invoices: any[]): any[] {
  return (Array.isArray(invoices) ? invoices : []).map((inv) => {
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

export function bundleHasMeaningfulData(bundle: Partial<DriveWorkspaceBundle> | null | undefined): boolean {
  if (!bundle || typeof bundle !== 'object') return false;
  return Boolean(
    bundle.company?.legalName?.trim() ||
      bundle.company?.displayName?.trim() ||
      (Array.isArray(bundle.customers) && bundle.customers.length > 0) ||
      (Array.isArray(bundle.invoices) && bundle.invoices.length > 0) ||
      (Array.isArray(bundle.quotations) && bundle.quotations.length > 0) ||
      (Array.isArray(bundle.emailLogs) && bundle.emailLogs.length > 0) ||
      (bundle.spreadsheetData &&
        Array.isArray(bundle.spreadsheetData.worksheets) &&
        bundle.spreadsheetData.worksheets.length > 0)
  );
}

/**
 * Safely migrates v1, v2, or partial workspace JSON payloads into the current versioned v3 schema
 * without discarding any existing records.
 */
export function migrateWorkspaceBundle(raw: any): DriveWorkspaceBundle {
  const source = raw && typeof raw === 'object' ? raw : {};
  const invoices = Array.isArray(source.invoices) ? source.invoices : [];
  const quotations = Array.isArray(source.quotations) ? source.quotations : [];
  const customers = Array.isArray(source.customers) ? source.customers : [];
  const payments = Array.isArray(source.payments)
    ? source.payments
    : extractPaymentLedger(invoices);
  const emailLogs = Array.isArray(source.emailLogs) ? source.emailLogs : [];
  const fieldCatalog = Array.isArray(source.fieldCatalog) ? source.fieldCatalog : [];
  const mappingProfiles = Array.isArray(source.mappingProfiles) ? source.mappingProfiles : [];
  const layoutConfig =
    source.layoutConfig && Array.isArray(source.layoutConfig.templates)
      ? source.layoutConfig
      : Array.isArray(source.templates)
        ? { templates: source.templates }
        : null;

  return {
    version: WORKSPACE_SCHEMA_VERSION,
    updatedAt: String(source.updatedAt || new Date().toISOString()),
    company: source.company || null,
    fieldCatalog,
    mappingProfiles,
    layoutConfig,
    customers,
    invoices,
    quotations,
    payments,
    emailLogs,
    spreadsheetData: source.spreadsheetData || null,
  };
}

export async function verifyFolderAccess(
  drive: DriveApiLike,
  folderId: string
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  canEdit: boolean;
  canAddChildren: boolean;
  canListChildren: boolean;
  webViewLink: string;
}> {
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,trashed,webViewLink,capabilities(canEdit,canAddChildren,canListChildren)',
      supportsAllDrives: true,
    });
    const data = res.data || {};
    if (data.mimeType !== FOLDER_MIME) {
      throw new HttpApiError(
        400,
        'NOT_A_FOLDER',
        'The selected Google Drive item is not a folder. Please choose a Drive folder.'
      );
    }
    if (data.trashed) {
      throw new HttpApiError(
        400,
        'FOLDER_TRASHED',
        'The selected Google Drive folder is in Trash. Restore it or select another folder.'
      );
    }
    const canEdit = Boolean(data.capabilities?.canEdit);
    const canAddChildren = Boolean(data.capabilities?.canAddChildren);
    const canListChildren = Boolean(data.capabilities?.canListChildren);
    if (!canEdit && !canAddChildren) {
      throw new HttpApiError(
        403,
        'FOLDER_READ_ONLY',
        `Folder "${data.name || folderId}" is read-only for your Google account. Select a folder where you have edit access.`
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
  } catch (err) {
    throw mapDriveApiError(err, 'verify folder permissions');
  }
}

export async function findOrCreateRootFolder(
  drive: DriveApiLike
): Promise<{ id: string; name: string; webViewLink: string; createdNew: boolean }> {
  try {
    const q = `name = '${escapeDriveQuery(INVOICE_STUDIO_FOLDER_NAME)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const listRes = await drive.files.list({
      q,
      fields: 'files(id,name,webViewLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 5,
    });
    const existing = listRes.data?.files?.[0];
    if (existing?.id) {
      return {
        id: String(existing.id),
        name: String(existing.name || INVOICE_STUDIO_FOLDER_NAME),
        webViewLink: String(
          existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`
        ),
        createdNew: false,
      };
    }

    const created = await drive.files.create({
      requestBody: {
        name: INVOICE_STUDIO_FOLDER_NAME,
        mimeType: FOLDER_MIME,
      },
      fields: 'id,name,webViewLink',
    });
    const id = String(created.data.id);
    return {
      id,
      name: String(created.data.name || INVOICE_STUDIO_FOLDER_NAME),
      webViewLink: String(created.data.webViewLink || `https://drive.google.com/drive/folders/${id}`),
      createdNew: true,
    };
  } catch (err) {
    throw mapDriveApiError(err, 'locate or create the Invoice Studio folder');
  }
}

async function findChildFile(
  drive: DriveApiLike,
  parentId: string,
  name: string,
  mimeType?: string
): Promise<DriveFileSummary | null> {
  try {
    const parts = [
      `'${escapeDriveQuery(parentId)}' in parents`,
      `name = '${escapeDriveQuery(name)}'`,
      'trashed = false',
    ];
    if (mimeType) {
      parts.push(`mimeType = '${escapeDriveQuery(mimeType)}'`);
    }
    const res = await drive.files.list({
      q: parts.join(' and '),
      fields: 'files(id,name,mimeType,modifiedTime,headRevisionId,size,webViewLink,parents)',
      orderBy: 'modifiedTime desc',
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const first = res.data?.files?.[0];
    return first ? (first as DriveFileSummary) : null;
  } catch (err) {
    throw mapDriveApiError(err, `locate "${name}"`);
  }
}

async function findOrCreateSubfolder(
  drive: DriveApiLike,
  parentId: string,
  name: string
): Promise<string> {
  const existing = await findChildFile(drive, parentId, name, FOLDER_MIME);
  if (existing?.id) return existing.id;

  try {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      },
      fields: 'id,name',
      supportsAllDrives: true,
    });
    return String(created.data.id);
  } catch (err) {
    throw mapDriveApiError(err, `create "${name}" subfolder`);
  }
}

/**
 * Ensures the complete Invoice Studio folder hierarchy:
 *   Invoice Studio/
 *     workspace/
 *     Invoices/
 *     Quotations/
 *     Assets/
 *       logos/
 *       signatures/
 *       stamps/
 *     Backups/
 */
export async function ensureWorkspaceStructure(
  drive: DriveApiLike,
  rootFolderId: string
): Promise<DriveWorkspaceSubfolders> {
  const meta = await verifyFolderAccess(drive, rootFolderId);
  const workspaceFolderId = await findOrCreateSubfolder(drive, meta.id, 'workspace');
  const invoicesFolderId = await findOrCreateSubfolder(drive, meta.id, 'Invoices');
  const quotationsFolderId = await findOrCreateSubfolder(drive, meta.id, 'Quotations');
  const backupsFolderId = await findOrCreateSubfolder(drive, meta.id, 'Backups');
  const assetsFolderId = await findOrCreateSubfolder(drive, meta.id, 'Assets');
  const logosFolderId = await findOrCreateSubfolder(drive, assetsFolderId, 'logos');
  const signaturesFolderId = await findOrCreateSubfolder(drive, assetsFolderId, 'signatures');
  const stampsFolderId = await findOrCreateSubfolder(drive, assetsFolderId, 'stamps');

  return {
    rootFolderId: meta.id,
    rootFolderName: meta.name,
    workspaceFolderId,
    invoicesFolderId,
    quotationsFolderId,
    backupsFolderId,
    assetsFolderId,
    logosFolderId,
    signaturesFolderId,
    stampsFolderId,
  };
}

async function readJsonFileFromFolder<T>(
  drive: DriveApiLike,
  parentFolderId: string,
  fileName: string
): Promise<{ meta: DriveFileSummary; data: T } | null> {
  const found = await findChildFile(drive, parentFolderId, fileName);
  if (!found?.id) return null;

  try {
    const res = await drive.files.get(
      { fileId: found.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );
    const raw = res.data;
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
      if (!raw.trim()) return null;
      return { meta: found, data: JSON.parse(raw) as T };
    }
    return { meta: found, data: raw as T };
  } catch (err) {
    throw mapDriveApiError(err, `read "${fileName}"`);
  }
}

function verifyRevisionMatch(
  fileName: string,
  existing: DriveFileSummary | null,
  expectedRevisions?: WorkspaceFileRevisions
): void {
  if (!existing) return;
  const expected = expectedRevisions?.[fileName];

  if (expected && expected.fileId === existing.id) {
    const remoteChanged =
      (existing.modifiedTime &&
        expected.modifiedTime &&
        existing.modifiedTime !== expected.modifiedTime) ||
      (existing.headRevisionId &&
        expected.headRevisionId &&
        existing.headRevisionId !== expected.headRevisionId);

    if (remoteChanged) {
      const conflict: DriveSyncConflictPayload = {
        fileName,
        fileId: existing.id,
        loadedModifiedTime: expected.modifiedTime,
        remoteModifiedTime: existing.modifiedTime || new Date().toISOString(),
        message: `"${fileName}" was updated in another session (${existing.modifiedTime || 'newer version'}). Reload the latest data from Google Drive or back up and overwrite.`,
      };
      throw new HttpApiError(409, 'DRIVE_SYNC_CONFLICT', conflict.message, { conflict });
    }
    return;
  }

  if (expectedRevisions && !expected) {
    const conflict: DriveSyncConflictPayload = {
      fileName,
      fileId: existing.id,
      loadedModifiedTime: 'not loaded in this session',
      remoteModifiedTime: existing.modifiedTime || 'existing Drive file',
      message: `An existing "${fileName}" file was found in Google Drive that was not loaded in this session. Reload from Drive first to avoid overwriting existing records.`,
    };
    throw new HttpApiError(409, 'DRIVE_SYNC_CONFLICT', conflict.message, { conflict });
  }
}

async function writeJsonFileToFolder<T>(
  drive: DriveApiLike,
  parentFolderId: string,
  fileName: string,
  payload: T,
  options?: {
    expectedRevisions?: WorkspaceFileRevisions;
    forceOverwrite?: boolean;
  }
): Promise<DriveFileSummary> {
  const existing = await findChildFile(drive, parentFolderId, fileName);
  if (!options?.forceOverwrite && options?.expectedRevisions) {
    verifyRevisionMatch(fileName, existing, options.expectedRevisions);
  }

  const jsonBody = JSON.stringify(payload, null, 2);
  const fields = 'id,name,mimeType,modifiedTime,headRevisionId,size,webViewLink';

  try {
    if (existing?.id) {
      const res = await drive.files.update({
        fileId: existing.id,
        media: {
          mimeType: 'application/json',
          body: Readable.from([Buffer.from(jsonBody, 'utf8')]),
        },
        fields,
        supportsAllDrives: true,
      });
      return res.data as DriveFileSummary;
    }

    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/json',
        parents: [parentFolderId],
      },
      media: {
        mimeType: 'application/json',
        body: Readable.from([Buffer.from(jsonBody, 'utf8')]),
      },
      fields,
      supportsAllDrives: true,
    });
    return res.data as DriveFileSummary;
  } catch (err) {
    throw mapDriveApiError(err, `save "${fileName}"`);
  }
}

export async function listFolderFiles(
  drive: DriveApiLike,
  subfolders: DriveWorkspaceSubfolders,
  slot: DriveFileSlot
): Promise<DriveFileSummary[]> {
  const folderIdMap: Record<DriveFileSlot, string> = {
    invoices: subfolders.invoicesFolderId,
    quotations: subfolders.quotationsFolderId,
    backups: subfolders.backupsFolderId,
    assets: subfolders.assetsFolderId,
    logos: subfolders.logosFolderId,
    signatures: subfolders.signaturesFolderId,
    stamps: subfolders.stampsFolderId,
    workspace: subfolders.workspaceFolderId,
  };
  const targetFolderId = folderIdMap[slot];
  try {
    const res = await drive.files.list({
      q: `'${escapeDriveQuery(targetFolderId)}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime,headRevisionId,size,webViewLink,parents)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return Array.isArray(res.data?.files) ? (res.data.files as DriveFileSummary[]) : [];
  } catch (err) {
    throw mapDriveApiError(err, `list ${slot} files`);
  }
}

export async function loadOrInitializeWorkspace(
  drive: DriveApiLike,
  rootFolderId: string,
  emptyDefaults?: {
    company?: any;
    fieldCatalog?: any[];
    mappingProfiles?: any[];
    layoutConfig?: { templates: any[] } | null;
  }
): Promise<{
  subfolders: DriveWorkspaceSubfolders;
  bundle: DriveWorkspaceBundle;
  backups: DriveFileSummary[];
  fileRevisions: WorkspaceFileRevisions;
  restoredExistingWorkspace: boolean;
  initializedNewWorkspace: boolean;
  lastSyncedAt: string;
}> {
  const subfolders = await ensureWorkspaceStructure(drive, rootFolderId);

  const [mainFile, companyFile, customerFile, paymentFile, emailHistoryFile, backups] =
    await Promise.all([
      readJsonFileFromFolder<any>(drive, subfolders.workspaceFolderId, WORKSPACE_FILE_NAMES.MAIN_DATA),
      readJsonFileFromFolder<any>(
        drive,
        subfolders.workspaceFolderId,
        WORKSPACE_FILE_NAMES.COMPANY_SETTINGS
      ),
      readJsonFileFromFolder<any[]>(
        drive,
        subfolders.workspaceFolderId,
        WORKSPACE_FILE_NAMES.CUSTOMER_DATA
      ),
      readJsonFileFromFolder<any[]>(
        drive,
        subfolders.workspaceFolderId,
        WORKSPACE_FILE_NAMES.PAYMENT_DATA
      ),
      readJsonFileFromFolder<any[]>(
        drive,
        subfolders.workspaceFolderId,
        WORKSPACE_FILE_NAMES.EMAIL_HISTORY
      ),
      listFolderFiles(drive, subfolders, 'backups'),
    ]);

  const fileRevisions: WorkspaceFileRevisions = {};
  const recordMeta = (fileName: string, meta?: DriveFileSummary) => {
    if (meta?.id && meta.modifiedTime) {
      fileRevisions[fileName] = {
        fileId: meta.id,
        modifiedTime: meta.modifiedTime,
        headRevisionId: meta.headRevisionId,
      };
    }
  };
  recordMeta(WORKSPACE_FILE_NAMES.MAIN_DATA, mainFile?.meta);
  recordMeta(WORKSPACE_FILE_NAMES.COMPANY_SETTINGS, companyFile?.meta);
  recordMeta(WORKSPACE_FILE_NAMES.CUSTOMER_DATA, customerFile?.meta);
  recordMeta(WORKSPACE_FILE_NAMES.PAYMENT_DATA, paymentFile?.meta);
  recordMeta(WORKSPACE_FILE_NAMES.EMAIL_HISTORY, emailHistoryFile?.meta);

  const hasExistingWorkspace = Boolean(mainFile || companyFile || customerFile);

  if (hasExistingWorkspace) {
    const mainData = mainFile?.data || {};
    const bundle = migrateWorkspaceBundle({
      ...mainData,
      updatedAt: mainData.updatedAt || mainFile?.meta.modifiedTime || new Date().toISOString(),
      company: companyFile?.data || mainData.company || null,
      customers: Array.isArray(customerFile?.data)
        ? customerFile.data
        : Array.isArray(mainData.customers)
          ? mainData.customers
          : [],
      payments: Array.isArray(paymentFile?.data) ? paymentFile.data : mainData.payments,
      emailLogs: Array.isArray(emailHistoryFile?.data)
        ? emailHistoryFile.data
        : Array.isArray(mainData.emailLogs)
          ? mainData.emailLogs
          : [],
    });

    return {
      subfolders,
      bundle,
      backups,
      fileRevisions,
      restoredExistingWorkspace: true,
      initializedNewWorkspace: false,
      lastSyncedAt: bundle.updatedAt,
    };
  }

  // Initialize genuinely empty workspace ONLY when no existing files exist
  const now = new Date().toISOString();
  const emptyBundle: DriveWorkspaceBundle = {
    version: WORKSPACE_SCHEMA_VERSION,
    updatedAt: now,
    company: emptyDefaults?.company || null,
    fieldCatalog: Array.isArray(emptyDefaults?.fieldCatalog) ? emptyDefaults.fieldCatalog : [],
    mappingProfiles: Array.isArray(emptyDefaults?.mappingProfiles)
      ? emptyDefaults.mappingProfiles
      : [],
    layoutConfig: emptyDefaults?.layoutConfig || null,
    customers: [],
    invoices: [],
    quotations: [],
    payments: [],
    emailLogs: [],
    spreadsheetData: null,
  };

  const saved = await saveWorkspace(drive, rootFolderId, emptyBundle, {
    forceOverwrite: false,
    allowEmptyOverwrite: true,
    subfolders,
  });

  return {
    subfolders,
    bundle: emptyBundle,
    backups,
    fileRevisions: saved.fileRevisions,
    restoredExistingWorkspace: false,
    initializedNewWorkspace: true,
    lastSyncedAt: saved.syncedAt,
  };
}

export async function saveWorkspace(
  drive: DriveApiLike,
  rootFolderId: string,
  rawBundle: DriveWorkspaceBundle,
  options?: {
    expectedRevisions?: WorkspaceFileRevisions;
    forceOverwrite?: boolean;
    allowEmptyOverwrite?: boolean;
    subfolders?: DriveWorkspaceSubfolders;
  }
): Promise<{
  syncedAt: string;
  fileRevisions: WorkspaceFileRevisions;
  subfolders: DriveWorkspaceSubfolders;
}> {
  const subfolders = options?.subfolders || (await ensureWorkspaceStructure(drive, rootFolderId));
  const bundle = migrateWorkspaceBundle(rawBundle);
  const incomingHasData = bundleHasMeaningfulData(bundle);

  // Empty overwrite protection: check remote if caller is trying to save an empty bundle
  if (!incomingHasData && !options?.allowEmptyOverwrite) {
    const [existingMain, existingCompany, existingCustomers] = await Promise.all([
      readJsonFileFromFolder<any>(drive, subfolders.workspaceFolderId, WORKSPACE_FILE_NAMES.MAIN_DATA),
      readJsonFileFromFolder<any>(
        drive,
        subfolders.workspaceFolderId,
        WORKSPACE_FILE_NAMES.COMPANY_SETTINGS
      ),
      readJsonFileFromFolder<any[]>(
        drive,
        subfolders.workspaceFolderId,
        WORKSPACE_FILE_NAMES.CUSTOMER_DATA
      ),
    ]);
    const remoteHasData = bundleHasMeaningfulData({
      ...(existingMain?.data || {}),
      company: existingCompany?.data || existingMain?.data?.company || null,
      customers: existingCustomers?.data || existingMain?.data?.customers || [],
    });
    if (remoteHasData) {
      throw new HttpApiError(
        409,
        'EMPTY_OVERWRITE_BLOCKED',
        'Sync blocked to protect your existing Google Drive records from being overwritten with an empty workspace. Reload from Google Drive first.'
      );
    }
  }

  const syncedAt = new Date().toISOString();
  const payments = extractPaymentLedger(bundle.invoices);
  const mainPayload = {
    version: WORKSPACE_SCHEMA_VERSION,
    updatedAt: syncedAt,
    fieldCatalog: bundle.fieldCatalog,
    mappingProfiles: bundle.mappingProfiles,
    layoutConfig: bundle.layoutConfig,
    invoices: bundle.invoices,
    quotations: bundle.quotations,
    emailLogs: bundle.emailLogs,
    spreadsheetData: bundle.spreadsheetData,
  };

  const writeOpts = {
    expectedRevisions: options?.expectedRevisions,
    forceOverwrite: options?.forceOverwrite,
  };

  const mainMeta = await writeJsonFileToFolder(
    drive,
    subfolders.workspaceFolderId,
    WORKSPACE_FILE_NAMES.MAIN_DATA,
    mainPayload,
    writeOpts
  );
  const companyMeta = await writeJsonFileToFolder(
    drive,
    subfolders.workspaceFolderId,
    WORKSPACE_FILE_NAMES.COMPANY_SETTINGS,
    bundle.company,
    writeOpts
  );
  const customerMeta = await writeJsonFileToFolder(
    drive,
    subfolders.workspaceFolderId,
    WORKSPACE_FILE_NAMES.CUSTOMER_DATA,
    bundle.customers,
    writeOpts
  );
  const paymentMeta = await writeJsonFileToFolder(
    drive,
    subfolders.workspaceFolderId,
    WORKSPACE_FILE_NAMES.PAYMENT_DATA,
    payments,
    writeOpts
  );

  const fileRevisions: WorkspaceFileRevisions = {};
  const setRev = (name: string, meta: DriveFileSummary) => {
    if (meta?.id) {
      fileRevisions[name] = {
        fileId: meta.id,
        modifiedTime: meta.modifiedTime || syncedAt,
        headRevisionId: meta.headRevisionId,
      };
    }
  };
  setRev(WORKSPACE_FILE_NAMES.MAIN_DATA, mainMeta);
  setRev(WORKSPACE_FILE_NAMES.COMPANY_SETTINGS, companyMeta);
  setRev(WORKSPACE_FILE_NAMES.CUSTOMER_DATA, customerMeta);
  setRev(WORKSPACE_FILE_NAMES.PAYMENT_DATA, paymentMeta);

  return { syncedAt, fileRevisions, subfolders };
}

async function uploadBinaryToFolder(
  drive: DriveApiLike,
  parentFolderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<DriveFileSummary> {
  const existing = await findChildFile(drive, parentFolderId, fileName);
  const fields = 'id,name,mimeType,modifiedTime,size,webViewLink';

  try {
    if (existing?.id) {
      const res = await drive.files.update({
        fileId: existing.id,
        media: {
          mimeType,
          body: Readable.from([buffer]),
        },
        fields,
        supportsAllDrives: true,
      });
      return res.data as DriveFileSummary;
    }

    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        parents: [parentFolderId],
      },
      media: {
        mimeType,
        body: Readable.from([buffer]),
      },
      fields,
      supportsAllDrives: true,
    });
    return res.data as DriveFileSummary;
  } catch (err) {
    throw mapDriveApiError(err, `upload "${fileName}"`);
  }
}

export async function uploadPdfToDrive(
  drive: DriveApiLike,
  rootFolderId: string,
  params: {
    documentType: 'invoice' | 'quotation';
    fileName: string;
    pdfBase64: string;
  }
): Promise<DriveFileSummary> {
  const subfolders = await ensureWorkspaceStructure(drive, rootFolderId);
  const cleanBase64 = params.pdfBase64.includes('base64,')
    ? params.pdfBase64.split('base64,')[1]
    : params.pdfBase64;
  if (!cleanBase64 || cleanBase64.trim().length < 16) {
    throw new HttpApiError(400, 'INVALID_PDF_DATA', 'Valid base64 PDF content is required.');
  }
  const buffer = Buffer.from(cleanBase64, 'base64');
  const targetFolder =
    params.documentType === 'quotation' ? subfolders.quotationsFolderId : subfolders.invoicesFolderId;
  const sanitized = params.fileName.replace(/[^\w.\-\s()]/g, '_').trim() || `${params.documentType}.pdf`;
  const safeName = sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;

  return uploadBinaryToFolder(drive, targetFolder, safeName, 'application/pdf', buffer);
}

export function resolveAssetSubfolder(
  subfolders: DriveWorkspaceSubfolders,
  category?: AssetCategory,
  assetName?: string
): string {
  const lower = `${category || ''} ${assetName || ''}`.toLowerCase();
  if (category === 'logos' || lower.includes('logo')) return subfolders.logosFolderId;
  if (category === 'signatures' || lower.includes('signature')) return subfolders.signaturesFolderId;
  if (category === 'stamps' || lower.includes('stamp')) return subfolders.stampsFolderId;
  return subfolders.assetsFolderId;
}

export async function uploadAssetToDrive(
  drive: DriveApiLike,
  rootFolderId: string,
  params: {
    category?: AssetCategory;
    assetName: string;
    dataUrl: string;
  }
): Promise<DriveFileSummary> {
  if (!params.dataUrl || !params.dataUrl.startsWith('data:')) {
    throw new HttpApiError(400, 'INVALID_ASSET_DATA', 'A valid base64 data URL is required for asset uploads.');
  }
  const match = params.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new HttpApiError(400, 'INVALID_ASSET_DATA', 'Malformed asset data URL.');
  }
  const mimeType = match[1];
  const base64 = match[2];
  const ext = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
  const buffer = Buffer.from(base64, 'base64');

  const subfolders = await ensureWorkspaceStructure(drive, rootFolderId);
  const targetFolder = resolveAssetSubfolder(subfolders, params.category, params.assetName);
  const safeName = `${params.assetName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'asset'}.${ext}`;

  return uploadBinaryToFolder(drive, targetFolder, safeName, mimeType, buffer);
}

export async function createWorkspaceBackup(
  drive: DriveApiLike,
  rootFolderId: string,
  bundle: DriveWorkspaceBundle
): Promise<{ backup: DriveFileSummary; backups: DriveFileSummary[] }> {
  const subfolders = await ensureWorkspaceStructure(drive, rootFolderId);
  const exportedAt = new Date().toISOString();
  const stamp = exportedAt.replace(/[:.]/g, '-');
  const fileName = `invoice-studio-backup-${stamp}.json`;

  const payload = {
    version: WORKSPACE_SCHEMA_VERSION,
    exportedAt,
    folderId: subfolders.rootFolderId,
    folderName: subfolders.rootFolderName,
    bundle: migrateWorkspaceBundle(bundle),
  };

  const backup = await writeJsonFileToFolder(
    drive,
    subfolders.backupsFolderId,
    fileName,
    payload,
    { forceOverwrite: true }
  );
  const backups = await listFolderFiles(drive, subfolders, 'backups');
  return { backup, backups };
}

export async function restoreWorkspaceBackup(
  drive: DriveApiLike,
  rootFolderId: string,
  backupFileId: string
): Promise<{
  bundle: DriveWorkspaceBundle;
  restoredAt: string;
  fileRevisions: WorkspaceFileRevisions;
}> {
  if (!backupFileId || !/^[a-zA-Z0-9_-]{8,128}$/.test(backupFileId)) {
    throw new HttpApiError(400, 'INVALID_BACKUP_ID', 'A valid backup file ID is required.');
  }

  let parsed: any;
  try {
    const res = await drive.files.get(
      { fileId: backupFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );
    parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch (err) {
    throw mapDriveApiError(err, 'download backup snapshot');
  }

  const rawBundle = parsed?.bundle;
  if (!rawBundle || typeof rawBundle !== 'object') {
    throw new HttpApiError(
      400,
      'INVALID_BACKUP_FORMAT',
      'Selected backup file does not contain a valid Invoice Studio snapshot.'
    );
  }

  const bundle = migrateWorkspaceBundle(rawBundle);
  const saved = await saveWorkspace(drive, rootFolderId, bundle, {
    forceOverwrite: true,
    allowEmptyOverwrite: true,
  });

  return {
    bundle,
    restoredAt: saved.syncedAt,
    fileRevisions: saved.fileRevisions,
  };
}

export async function downloadDriveFileBase64(
  drive: DriveApiLike,
  fileId: string
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  base64: string;
}> {
  if (!fileId || !/^[a-zA-Z0-9_-]{8,128}$/.test(fileId)) {
    throw new HttpApiError(400, 'INVALID_FILE_ID', 'A valid Google Drive file ID is required.');
  }
  try {
    const metaRes = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,trashed',
      supportsAllDrives: true,
    });
    if (metaRes.data?.trashed) {
      throw new HttpApiError(404, 'DRIVE_FILE_TRASHED', 'Requested Drive file is in Trash.');
    }
    const contentRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    const buf = Buffer.isBuffer(contentRes.data)
      ? contentRes.data
      : Buffer.from(contentRes.data as ArrayBuffer);
    return {
      id: String(metaRes.data.id || fileId),
      name: String(metaRes.data.name || 'download'),
      mimeType: String(metaRes.data.mimeType || 'application/octet-stream'),
      base64: buf.toString('base64'),
    };
  } catch (err) {
    throw mapDriveApiError(err, 'download file');
  }
}

/**
 * Moves a Drive file to Trash ONLY on explicit confirmed user action, and ONLY after verifying
 * that the file lives inside one of the connected Invoice Studio workspace subfolders.
 */
export async function trashWorkspaceFile(
  drive: DriveApiLike,
  rootFolderId: string,
  fileId: string
): Promise<{ deleted: boolean; fileId: string; name: string }> {
  if (!fileId || !/^[a-zA-Z0-9_-]{8,128}$/.test(fileId)) {
    throw new HttpApiError(400, 'INVALID_FILE_ID', 'A valid Google Drive file ID is required.');
  }
  const subfolders = await ensureWorkspaceStructure(drive, rootFolderId);
  const allowedParents = new Set([
    subfolders.invoicesFolderId,
    subfolders.quotationsFolderId,
    subfolders.backupsFolderId,
    subfolders.assetsFolderId,
    subfolders.logosFolderId,
    subfolders.signaturesFolderId,
    subfolders.stampsFolderId,
  ]);

  try {
    const metaRes = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,parents,trashed',
      supportsAllDrives: true,
    });
    const parents: string[] = Array.isArray(metaRes.data?.parents) ? metaRes.data.parents : [];
    const belongsToWorkspace = parents.some((p) => allowedParents.has(p));
    if (!belongsToWorkspace) {
      throw new HttpApiError(
        403,
        'FILE_OUTSIDE_WORKSPACE',
        'For safety, only archived PDFs, backups, and assets inside your Invoice Studio folder may be deleted from here.'
      );
    }

    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: 'id,trashed',
      supportsAllDrives: true,
    });

    return {
      deleted: true,
      fileId: String(metaRes.data.id || fileId),
      name: String(metaRes.data.name || fileId),
    };
  } catch (err) {
    throw mapDriveApiError(err, 'move file to trash');
  }
}
