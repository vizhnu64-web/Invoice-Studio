/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { AppServerConfig } from './config.js';
import { generateRandomId } from './crypto.js';
import { PersistenceStore } from './db.js';
import {
  GoogleTransportAdapter,
  HttpApiError,
  mapGoogleApiError,
  runWithUserTokenRetry,
} from './googleService.js';

export const DRIVE_ROOT_FOLDER_NAME = 'Invoice Studio';

export const DRIVE_SUBFOLDER_KEYS = {
  appData: 'App Data',
  companySettings: 'Company Settings',
  customers: 'Customers',
  quotations: 'Quotations',
  invoices: 'Invoices',
  generatedPdfs: 'Generated PDFs',
  emailRecords: 'Email Records',
  backups: 'Backups',
} as const;

export type DriveFolderKey = keyof typeof DRIVE_SUBFOLDER_KEYS;

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface DriveTransportAdapter {
  findFile(params: {
    accessToken: string;
    config: AppServerConfig;
    name?: string;
    parentId?: string;
    mimeType?: string;
    appPropertyKey?: string;
    appPropertyValue?: string;
  }): Promise<DriveFileSummary | null>;

  getFileMetadata(params: {
    accessToken: string;
    config: AppServerConfig;
    fileId: string;
  }): Promise<DriveFileSummary | null>;

  createFolder(params: {
    accessToken: string;
    config: AppServerConfig;
    name: string;
    parentId?: string;
    appProperties?: Record<string, string>;
  }): Promise<DriveFileSummary>;

  createOrUpdateFile(params: {
    accessToken: string;
    config: AppServerConfig;
    existingFileId?: string | null;
    name: string;
    parentId: string;
    mimeType: string;
    content: Buffer | string;
    appProperties?: Record<string, string>;
  }): Promise<DriveFileSummary>;

  downloadFileText(params: {
    accessToken: string;
    config: AppServerConfig;
    fileId: string;
  }): Promise<string>;
}

function createDriveClient(accessToken: string, config: AppServerConfig) {
  const auth = new OAuth2Client(config.googleClientId, config.googleClientSecret);
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth });
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export const defaultDriveTransport: DriveTransportAdapter = {
  async findFile({ accessToken, config, name, parentId, mimeType, appPropertyKey, appPropertyValue }) {
    const drive = createDriveClient(accessToken, config);
    const clauses: string[] = ['trashed = false'];
    if (name) clauses.push(`name = '${escapeDriveQueryValue(name)}'`);
    if (parentId) clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
    if (mimeType) clauses.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
    if (appPropertyKey && appPropertyValue) {
      clauses.push(
        `appProperties has { key='${escapeDriveQueryValue(appPropertyKey)}' and value='${escapeDriveQueryValue(appPropertyValue)}' }`
      );
    }

    try {
      const res = await drive.files.list({
        q: clauses.join(' and '),
        fields: 'files(id, name, mimeType, modifiedTime, parents, appProperties)',
        orderBy: 'modifiedTime desc',
        pageSize: 5,
        spaces: 'drive',
      });
      const first = res.data.files?.[0];
      if (!first?.id) return null;
      return {
        id: first.id,
        name: first.name || name || '',
        mimeType: first.mimeType || '',
        modifiedTime: first.modifiedTime || undefined,
        parents: first.parents || undefined,
        appProperties: (first.appProperties as Record<string, string>) || undefined,
      };
    } catch (err: any) {
      throw mapGoogleApiError(err, 'Failed to query Google Drive files.');
    }
  },

  async getFileMetadata({ accessToken, config, fileId }) {
    const drive = createDriveClient(accessToken, config);
    try {
      const res = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, modifiedTime, parents, trashed, appProperties',
      });
      if (!res.data.id || res.data.trashed) return null;
      return {
        id: res.data.id,
        name: res.data.name || '',
        mimeType: res.data.mimeType || '',
        modifiedTime: res.data.modifiedTime || undefined,
        parents: res.data.parents || undefined,
        appProperties: (res.data.appProperties as Record<string, string>) || undefined,
      };
    } catch (err: any) {
      const status = err?.code || err?.status || err?.response?.status;
      if (status === 404) return null;
      throw mapGoogleApiError(err, 'Failed to verify Google Drive file metadata.');
    }
  },

  async createFolder({ accessToken, config, name, parentId, appProperties }) {
    const drive = createDriveClient(accessToken, config);
    try {
      const res = await drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : undefined,
          appProperties,
        },
        fields: 'id, name, mimeType, modifiedTime, parents, appProperties',
      });
      if (!res.data.id) {
        throw new HttpApiError(502, 'DRIVE_FOLDER_CREATE_FAILED', 'Google Drive did not return a folder ID.');
      }
      return {
        id: res.data.id,
        name: res.data.name || name,
        mimeType: res.data.mimeType || 'application/vnd.google-apps.folder',
        modifiedTime: res.data.modifiedTime || undefined,
        parents: res.data.parents || undefined,
        appProperties: (res.data.appProperties as Record<string, string>) || undefined,
      };
    } catch (err: any) {
      throw mapGoogleApiError(err, `Failed to create Google Drive folder "${name}".`);
    }
  },

  async createOrUpdateFile({
    accessToken,
    config,
    existingFileId,
    name,
    parentId,
    mimeType,
    content,
    appProperties,
  }) {
    const drive = createDriveClient(accessToken, config);
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

    try {
      if (existingFileId) {
        const res = await drive.files.update({
          fileId: existingFileId,
          requestBody: {
            name,
            appProperties,
          },
          media: {
            mimeType,
            body: Readable.from(buffer),
          },
          fields: 'id, name, mimeType, modifiedTime, parents, appProperties',
        });
        if (res.data.id) {
          return {
            id: res.data.id,
            name: res.data.name || name,
            mimeType: res.data.mimeType || mimeType,
            modifiedTime: res.data.modifiedTime || undefined,
            parents: res.data.parents || undefined,
            appProperties: (res.data.appProperties as Record<string, string>) || undefined,
          };
        }
      }
    } catch (err: any) {
      const status = err?.code || err?.status || err?.response?.status;
      if (status !== 404) {
        throw mapGoogleApiError(err, `Failed to update Google Drive file "${name}".`);
      }
      // If stored file was deleted by user in Drive, gracefully recreate it below
    }

    try {
      const res = await drive.files.create({
        requestBody: {
          name,
          mimeType,
          parents: [parentId],
          appProperties,
        },
        media: {
          mimeType,
          body: Readable.from(buffer),
        },
        fields: 'id, name, mimeType, modifiedTime, parents, appProperties',
      });
      if (!res.data.id) {
        throw new HttpApiError(502, 'DRIVE_UPLOAD_FAILED', 'Google Drive did not return a file ID.');
      }
      return {
        id: res.data.id,
        name: res.data.name || name,
        mimeType: res.data.mimeType || mimeType,
        modifiedTime: res.data.modifiedTime || undefined,
        parents: res.data.parents || undefined,
        appProperties: (res.data.appProperties as Record<string, string>) || undefined,
      };
    } catch (err: any) {
      throw mapGoogleApiError(err, `Failed to upload Google Drive file "${name}".`);
    }
  },

  async downloadFileText({ accessToken, config, fileId }) {
    const drive = createDriveClient(accessToken, config);
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
      );
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    } catch (err: any) {
      throw mapGoogleApiError(err, 'Failed to download file contents from Google Drive.');
    }
  },
};

export interface DriveFolderMap {
  rootFolderId: string;
  subfolders: Record<DriveFolderKey, string>;
}

/**
 * Ensures `Invoice Studio/` and all 8 standard subfolders exist in the user's Google Drive
 * without creating duplicate folders across re-logins or repeated sync runs.
 */
export async function ensureUserDriveFolders(params: {
  userId: string;
  accessToken: string;
  config: AppServerConfig;
  store: PersistenceStore;
  driveTransport?: DriveTransportAdapter;
}): Promise<DriveFolderMap> {
  const drive = params.driveTransport || defaultDriveTransport;
  const user = await params.store.getAppUser(params.userId);
  let rootFolderId = user?.driveRootFolderId || null;
  const existingSubfolders: Record<string, string> = { ...(user?.driveSubfolders || {}) };

  // 1. Verify or locate root folder ("Invoice Studio")
  if (rootFolderId) {
    const meta = await drive.getFileMetadata({
      accessToken: params.accessToken,
      config: params.config,
      fileId: rootFolderId,
    });
    if (!meta) rootFolderId = null;
  }

  if (!rootFolderId) {
    const byProp = await drive.findFile({
      accessToken: params.accessToken,
      config: params.config,
      mimeType: 'application/vnd.google-apps.folder',
      appPropertyKey: 'invoiceStudioFolder',
      appPropertyValue: 'root',
    });
    if (byProp) {
      rootFolderId = byProp.id;
    } else {
      const byName = await drive.findFile({
        accessToken: params.accessToken,
        config: params.config,
        name: DRIVE_ROOT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      });
      if (byName) {
        rootFolderId = byName.id;
      } else {
        const created = await drive.createFolder({
          accessToken: params.accessToken,
          config: params.config,
          name: DRIVE_ROOT_FOLDER_NAME,
          appProperties: { invoiceStudioFolder: 'root', app: 'invoice-studio' },
        });
        rootFolderId = created.id;
      }
    }
  }

  // 2. Verify or locate each subfolder inside root
  const subfolders = {} as Record<DriveFolderKey, string>;
  const entries = Object.entries(DRIVE_SUBFOLDER_KEYS) as Array<[DriveFolderKey, string]>;
  for (const [key, folderName] of entries) {
    let folderId: string | null = existingSubfolders[key] || null;
    if (folderId) {
      const meta = await drive.getFileMetadata({
        accessToken: params.accessToken,
        config: params.config,
        fileId: folderId,
      });
      if (!meta) folderId = null;
    }
    if (!folderId) {
      const found = await drive.findFile({
        accessToken: params.accessToken,
        config: params.config,
        name: folderName,
        parentId: rootFolderId,
        mimeType: 'application/vnd.google-apps.folder',
      });
      if (found) {
        folderId = found.id;
      } else {
        const created = await drive.createFolder({
          accessToken: params.accessToken,
          config: params.config,
          name: folderName,
          parentId: rootFolderId,
          appProperties: { invoiceStudioFolder: key, app: 'invoice-studio' },
        });
        folderId = created.id;
      }
    }
    subfolders[key] = folderId;
  }

  await params.store.updateAppUserDriveState(params.userId, {
    driveRootFolderId: rootFolderId,
    driveSubfolders: subfolders,
  });

  return { rootFolderId, subfolders };
}

async function upsertDriveJsonFile(params: {
  userId: string;
  entityType: string;
  entityId: string;
  folderKey: DriveFolderKey;
  parentId: string;
  fileName: string;
  payload: unknown;
  accessToken: string;
  config: AppServerConfig;
  store: PersistenceStore;
  drive: DriveTransportAdapter;
}): Promise<DriveFileSummary> {
  const existingRef = await params.store.getDriveFileRef(
    params.userId,
    params.entityType,
    params.entityId
  );

  let targetFileId = existingRef?.driveFileId || null;
  if (!targetFileId) {
    const found = await params.drive.findFile({
      accessToken: params.accessToken,
      config: params.config,
      name: params.fileName,
      parentId: params.parentId,
    });
    if (found) targetFileId = found.id;
  }

  const saved = await params.drive.createOrUpdateFile({
    accessToken: params.accessToken,
    config: params.config,
    existingFileId: targetFileId,
    name: params.fileName,
    parentId: params.parentId,
    mimeType: 'application/json',
    content: JSON.stringify(params.payload, null, 2),
    appProperties: {
      app: 'invoice-studio',
      entityType: params.entityType,
      entityId: params.entityId,
    },
  });

  await params.store.upsertDriveFileRef({
    id: existingRef?.id || `drv_${generateRandomId(10)}`,
    userId: params.userId,
    entityType: params.entityType,
    entityId: params.entityId,
    folderKey: params.folderKey,
    fileName: params.fileName,
    driveFileId: saved.id,
    mimeType: 'application/json',
  });

  return saved;
}

/**
 * Timestamp-aware merge helper: never overwrites a newer record with an older record.
 */
export function mergeTimestampedRecords<T extends { id: string; updatedAt?: string }>(
  localRecords: T[],
  remoteRecords: T[]
): { merged: T[]; conflictsResolved: number } {
  const map = new Map<string, T>();
  let conflictsResolved = 0;

  for (const item of localRecords) {
    if (item?.id) map.set(item.id, item);
  }
  for (const remote of remoteRecords) {
    if (!remote?.id) continue;
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, remote);
      continue;
    }
    const localMs = local.updatedAt ? Date.parse(local.updatedAt) : 0;
    const remoteMs = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
    if (remoteMs > localMs) {
      map.set(remote.id, remote);
      conflictsResolved++;
    }
  }

  return { merged: Array.from(map.values()), conflictsResolved };
}

export interface DriveSyncSummary {
  rootFolderId: string;
  subfolders: Record<DriveFolderKey, string>;
  filesSynced: number;
  quotationsSynced: number;
  invoicesSynced: number;
  customersSynced: number;
  emailLogsSynced: number;
  syncedAt: string;
}

/**
 * Synchronizes the user's complete Invoice Studio workspace to their own Google Drive
 * under `Invoice Studio/` with stable file IDs and zero duplicates.
 */
export async function syncWorkspaceToDrive(params: {
  userId: string;
  config: AppServerConfig;
  store: PersistenceStore;
  googleTransport?: GoogleTransportAdapter;
  driveTransport?: DriveTransportAdapter;
}): Promise<DriveSyncSummary> {
  const drive = params.driveTransport || defaultDriveTransport;

  try {
    return await runWithUserTokenRetry(
      {
        userId: params.userId,
        requiredFeature: 'drive',
        config: params.config,
        store: params.store,
        transport: params.googleTransport,
      },
      async (accessToken) => {
        const folders = await ensureUserDriveFolders({
          userId: params.userId,
          accessToken,
          config: params.config,
          store: params.store,
          driveTransport: drive,
        });

        const [workspace, customers, quotations, invoices, emailLogs] = await Promise.all([
          params.store.getWorkspaceState(params.userId),
          params.store.listCustomers(params.userId),
          params.store.listQuotations(params.userId),
          params.store.listInvoices(params.userId),
          params.store.listEmailLogs(params.userId, 200),
        ]);

        const nowIso = new Date().toISOString();
        let filesSynced = 0;

        // 1. App Data manifest
        await upsertDriveJsonFile({
          userId: params.userId,
          entityType: 'app_manifest',
          entityId: 'workspace_manifest',
          folderKey: 'appData',
          parentId: folders.subfolders.appData,
          fileName: 'workspace-manifest.json',
          payload: {
            schemaVersion: 2,
            updatedAt: nowIso,
            counts: {
              customers: customers.length,
              quotations: quotations.length,
              invoices: invoices.length,
              emailLogs: emailLogs.length,
            },
            workspaceVersion: workspace?.version || 1,
          },
          accessToken,
          config: params.config,
          store: params.store,
          drive,
        });
        filesSynced++;

        // 2. Company Settings & PDF Layout
        await upsertDriveJsonFile({
          userId: params.userId,
          entityType: 'company_settings',
          entityId: 'primary',
          folderKey: 'companySettings',
          parentId: folders.subfolders.companySettings,
          fileName: 'company-settings.json',
          payload: {
            updatedAt: workspace?.updatedAt || nowIso,
            companySettings: workspace?.companySettings || null,
            template: workspace?.template || null,
            fields: workspace?.fields || null,
            calculationSettings: workspace?.calculationSettings || null,
            preferences: workspace?.preferences || {},
          },
          accessToken,
          config: params.config,
          store: params.store,
          drive,
        });
        filesSynced++;

        // 3. Customers index
        await upsertDriveJsonFile({
          userId: params.userId,
          entityType: 'customers_index',
          entityId: 'all',
          folderKey: 'customers',
          parentId: folders.subfolders.customers,
          fileName: 'customers.json',
          payload: {
            updatedAt: nowIso,
            records: customers.map((c) => ({ ...c.data, id: c.id, updatedAt: c.updatedAt })),
          },
          accessToken,
          config: params.config,
          store: params.store,
          drive,
        });
        filesSynced++;

        // 4. Quotations index
        await upsertDriveJsonFile({
          userId: params.userId,
          entityType: 'quotations_index',
          entityId: 'all',
          folderKey: 'quotations',
          parentId: folders.subfolders.quotations,
          fileName: 'quotations.json',
          payload: {
            updatedAt: nowIso,
            records: quotations.map((q) => ({
              ...q.data,
              id: q.id,
              quotationNumber: q.quotationNumber,
              status: q.status,
              convertedInvoiceId: q.convertedInvoiceId,
              convertedInvoiceNumber: q.convertedInvoiceNumber,
              convertedAt: q.convertedAt,
              updatedAt: q.updatedAt,
            })),
          },
          accessToken,
          config: params.config,
          store: params.store,
          drive,
        });
        filesSynced++;

        // 5. Invoices index
        await upsertDriveJsonFile({
          userId: params.userId,
          entityType: 'invoices_index',
          entityId: 'all',
          folderKey: 'invoices',
          parentId: folders.subfolders.invoices,
          fileName: 'invoices.json',
          payload: {
            updatedAt: nowIso,
            records: invoices.map((inv) => ({
              ...inv.data,
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              sourceQuotationId: inv.sourceQuotationId,
              sourceQuotationNumber: inv.sourceQuotationNumber,
              paymentStatus: inv.paymentStatus,
              updatedAt: inv.updatedAt,
            })),
          },
          accessToken,
          config: params.config,
          store: params.store,
          drive,
        });
        filesSynced++;

        // 6. Email delivery logs
        await upsertDriveJsonFile({
          userId: params.userId,
          entityType: 'email_records_index',
          entityId: 'all',
          folderKey: 'emailRecords',
          parentId: folders.subfolders.emailRecords,
          fileName: 'email-logs.json',
          payload: {
            updatedAt: nowIso,
            records: emailLogs,
          },
          accessToken,
          config: params.config,
          store: params.store,
          drive,
        });
        filesSynced++;

        await params.store.updateAppUserDriveState(params.userId, {
          driveRootFolderId: folders.rootFolderId,
          driveSubfolders: folders.subfolders,
          driveLastSyncAt: nowIso,
          driveSyncStatus: 'synced',
          driveLastError: null,
        });

        return {
          rootFolderId: folders.rootFolderId,
          subfolders: folders.subfolders,
          filesSynced,
          quotationsSynced: quotations.length,
          invoicesSynced: invoices.length,
          customersSynced: customers.length,
          emailLogsSynced: emailLogs.length,
          syncedAt: nowIso,
        };
      }
    );
  } catch (err: any) {
    await params.store
      .updateAppUserDriveState(params.userId, {
        driveSyncStatus: 'failed',
        driveLastError: err?.message || 'Google Drive sync failed.',
      })
      .catch(() => {});
    throw err;
  }
}

/**
 * Uploads or updates a generated Quotation or Invoice PDF in `Invoice Studio/Generated PDFs/`.
 */
export async function uploadPdfToDrive(params: {
  userId: string;
  documentType: 'quotation' | 'invoice';
  documentId: string;
  fileName: string;
  pdfBase64: string;
  config: AppServerConfig;
  store: PersistenceStore;
  googleTransport?: GoogleTransportAdapter;
  driveTransport?: DriveTransportAdapter;
}): Promise<{ driveFileId: string; fileName: string; updatedAt: string }> {
  const drive = params.driveTransport || defaultDriveTransport;
  const cleanBase64 = params.pdfBase64.replace(/^data:application\/pdf[^,]*,/, '').trim();
  if (!cleanBase64) {
    throw new HttpApiError(400, 'EMPTY_PDF_CONTENT', 'PDF content is required for Google Drive upload.');
  }
  const pdfBuffer = Buffer.from(cleanBase64, 'base64');
  const safeName = params.fileName.replace(/[^\w.\-() ]+/g, '_').endsWith('.pdf')
    ? params.fileName.replace(/[^\w.\-() ]+/g, '_')
    : `${params.fileName.replace(/[^\w.\-() ]+/g, '_')}.pdf`;

  return await runWithUserTokenRetry(
    {
      userId: params.userId,
      requiredFeature: 'drive',
      config: params.config,
      store: params.store,
      transport: params.googleTransport,
    },
    async (accessToken) => {
      const folders = await ensureUserDriveFolders({
        userId: params.userId,
        accessToken,
        config: params.config,
        store: params.store,
        driveTransport: drive,
      });

      const entityType = `${params.documentType}_pdf`;
      const existingRef = await params.store.getDriveFileRef(
        params.userId,
        entityType,
        params.documentId
      );

      let targetFileId = existingRef?.driveFileId || null;
      if (!targetFileId) {
        const existingFile = await drive.findFile({
          accessToken,
          config: params.config,
          name: safeName,
          parentId: folders.subfolders.generatedPdfs,
        });
        if (existingFile) targetFileId = existingFile.id;
      }

      const uploaded = await drive.createOrUpdateFile({
        accessToken,
        config: params.config,
        existingFileId: targetFileId,
        name: safeName,
        parentId: folders.subfolders.generatedPdfs,
        mimeType: 'application/pdf',
        content: pdfBuffer,
        appProperties: {
          app: 'invoice-studio',
          entityType,
          entityId: params.documentId,
        },
      });

      await params.store.upsertDriveFileRef({
        id: existingRef?.id || `drv_${generateRandomId(10)}`,
        userId: params.userId,
        entityType,
        entityId: params.documentId,
        folderKey: 'generatedPdfs',
        fileName: safeName,
        driveFileId: uploaded.id,
        mimeType: 'application/pdf',
      });

      return {
        driveFileId: uploaded.id,
        fileName: uploaded.name,
        updatedAt: uploaded.modifiedTime || new Date().toISOString(),
      };
    }
  );
}

/**
 * Restores workspace data from the user's own Google Drive into their PostgreSQL workspace
 * using timestamp-based conflict resolution (never overwrites newer local DB records with older Drive copies).
 */
export async function restoreWorkspaceFromDrive(params: {
  userId: string;
  config: AppServerConfig;
  store: PersistenceStore;
  googleTransport?: GoogleTransportAdapter;
  driveTransport?: DriveTransportAdapter;
}): Promise<{
  restoredSettings: boolean;
  customersRestored: number;
  quotationsRestored: number;
  invoicesRestored: number;
  conflictsResolved: number;
  restoredAt: string;
}> {
  const drive = params.driveTransport || defaultDriveTransport;

  return await runWithUserTokenRetry(
    {
      userId: params.userId,
      requiredFeature: 'drive',
      config: params.config,
      store: params.store,
      transport: params.googleTransport,
    },
    async (accessToken) => {
      const folders = await ensureUserDriveFolders({
        userId: params.userId,
        accessToken,
        config: params.config,
        store: params.store,
        driveTransport: drive,
      });

      let restoredSettings = false;
      let customersRestored = 0;
      let quotationsRestored = 0;
      let invoicesRestored = 0;
      let conflictsResolved = 0;

      // 1. Restore Company Settings & Workspace Preferences if remote is newer or local is empty
      const settingsFile = await drive.findFile({
        accessToken,
        config: params.config,
        name: 'company-settings.json',
        parentId: folders.subfolders.companySettings,
      });
      if (settingsFile) {
        const text = await drive.downloadFileText({
          accessToken,
          config: params.config,
          fileId: settingsFile.id,
        });
        const parsed = JSON.parse(text);
        const localWorkspace = await params.store.getWorkspaceState(params.userId);
        const localMs = localWorkspace?.updatedAt ? Date.parse(localWorkspace.updatedAt) : 0;
        const remoteMs = parsed?.updatedAt ? Date.parse(parsed.updatedAt) : 0;
        if (!localWorkspace || remoteMs >= localMs) {
          await params.store.upsertWorkspaceState(params.userId, {
            companySettings: parsed.companySettings ?? undefined,
            template: parsed.template ?? undefined,
            fields: parsed.fields ?? undefined,
            calculationSettings: parsed.calculationSettings ?? undefined,
            preferences: parsed.preferences ?? undefined,
          });
          restoredSettings = true;
        }
      }

      // 2. Restore Customers
      const customersFile = await drive.findFile({
        accessToken,
        config: params.config,
        name: 'customers.json',
        parentId: folders.subfolders.customers,
      });
      if (customersFile) {
        const text = await drive.downloadFileText({
          accessToken,
          config: params.config,
          fileId: customersFile.id,
        });
        const parsed = JSON.parse(text);
        const remoteList: any[] = Array.isArray(parsed?.records) ? parsed.records : [];
        const localList = (await params.store.listCustomers(params.userId)).map((c) => ({
          ...c.data,
          id: c.id,
          updatedAt: c.updatedAt,
        }));
        const merged = mergeTimestampedRecords(localList, remoteList);
        conflictsResolved += merged.conflictsResolved;
        for (const cust of merged.merged) {
          await params.store.upsertCustomer(params.userId, cust.id, cust);
          customersRestored++;
        }
      }

      // 3. Restore Quotations
      const quotationsFile = await drive.findFile({
        accessToken,
        config: params.config,
        name: 'quotations.json',
        parentId: folders.subfolders.quotations,
      });
      if (quotationsFile) {
        const text = await drive.downloadFileText({
          accessToken,
          config: params.config,
          fileId: quotationsFile.id,
        });
        const parsed = JSON.parse(text);
        const remoteList: any[] = Array.isArray(parsed?.records) ? parsed.records : [];
        const localList = (await params.store.listQuotations(params.userId)).map((q) => ({
          ...q.data,
          id: q.id,
          updatedAt: q.updatedAt,
        }));
        const merged = mergeTimestampedRecords(localList, remoteList);
        conflictsResolved += merged.conflictsResolved;
        for (const q of merged.merged) {
          await params.store.upsertQuotation(params.userId, {
            id: q.id,
            quotationNumber: q.quotationNumber || q.data?.quotationNumber || 'QT-RESTORED',
            status: q.status || 'Draft',
            customerName: q.customerName || q.data?.customerName || '',
            totalAmount: Number(q.totalAmount || 0),
            validUntil: q.validUntilDate || q.validUntil || '',
            convertedInvoiceId: q.convertedInvoiceId || null,
            convertedInvoiceNumber: q.convertedInvoiceNumber || null,
            convertedAt: q.convertedAt || null,
            data: q,
          });
          quotationsRestored++;
        }
      }

      // 4. Restore Invoices
      const invoicesFile = await drive.findFile({
        accessToken,
        config: params.config,
        name: 'invoices.json',
        parentId: folders.subfolders.invoices,
      });
      if (invoicesFile) {
        const text = await drive.downloadFileText({
          accessToken,
          config: params.config,
          fileId: invoicesFile.id,
        });
        const parsed = JSON.parse(text);
        const remoteList: any[] = Array.isArray(parsed?.records) ? parsed.records : [];
        const localList = (await params.store.listInvoices(params.userId)).map((i) => ({
          ...i.data,
          id: i.id,
          updatedAt: i.updatedAt,
        }));
        const merged = mergeTimestampedRecords(localList, remoteList);
        conflictsResolved += merged.conflictsResolved;
        for (const inv of merged.merged) {
          await params.store.upsertInvoice(params.userId, {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber || 'INV-RESTORED',
            sourceType: inv.sourceType || 'manual',
            sourceQuotationId: inv.sourceQuotationId || null,
            sourceQuotationNumber: inv.sourceQuotationNumber || null,
            customerName: inv.customerName || '',
            totalAmount: Number(inv.totalAmount || 0),
            paymentStatus: inv.paymentStatus || 'Unpaid',
            data: inv,
          });
          invoicesRestored++;
        }
      }

      const restoredAt = new Date().toISOString();
      await params.store.updateAppUserDriveState(params.userId, {
        driveLastSyncAt: restoredAt,
        driveSyncStatus: 'restored',
        driveLastError: null,
      });

      return {
        restoredSettings,
        customersRestored,
        quotationsRestored,
        invoicesRestored,
        conflictsResolved,
        restoredAt,
      };
    }
  );
}

/**
 * Creates a timestamped full-workspace backup JSON inside `Invoice Studio/Backups/`.
 */
export async function createDriveBackup(params: {
  userId: string;
  config: AppServerConfig;
  store: PersistenceStore;
  googleTransport?: GoogleTransportAdapter;
  driveTransport?: DriveTransportAdapter;
}): Promise<{ driveFileId: string; fileName: string; createdAt: string }> {
  const drive = params.driveTransport || defaultDriveTransport;

  return await runWithUserTokenRetry(
    {
      userId: params.userId,
      requiredFeature: 'drive',
      config: params.config,
      store: params.store,
      transport: params.googleTransport,
    },
    async (accessToken) => {
      const folders = await ensureUserDriveFolders({
        userId: params.userId,
        accessToken,
        config: params.config,
        store: params.store,
        driveTransport: drive,
      });

      const [workspace, customers, quotations, invoices, emailLogs] = await Promise.all([
        params.store.getWorkspaceState(params.userId),
        params.store.listCustomers(params.userId),
        params.store.listQuotations(params.userId),
        params.store.listInvoices(params.userId),
        params.store.listEmailLogs(params.userId, 500),
      ]);

      const nowIso = new Date().toISOString();
      const stamp = nowIso.replace(/[:.]/g, '-');
      const fileName = `invoice-studio-backup-${stamp}.json`;

      const created = await drive.createOrUpdateFile({
        accessToken,
        config: params.config,
        name: fileName,
        parentId: folders.subfolders.backups,
        mimeType: 'application/json',
        content: JSON.stringify(
          {
            schemaVersion: 2,
            backupCreatedAt: nowIso,
            workspace,
            customers: customers.map((c) => c.data),
            quotations: quotations.map((q) => q.data),
            invoices: invoices.map((i) => i.data),
            emailLogs,
          },
          null,
          2
        ),
        appProperties: { app: 'invoice-studio', entityType: 'backup' },
      });

      return {
        driveFileId: created.id,
        fileName: created.name,
        createdAt: nowIso,
      };
    }
  );
}
