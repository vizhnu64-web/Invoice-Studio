/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import { google, drive_v3 } from 'googleapis';
import { AppServerConfig, GOOGLE_DRIVE_SERVICE_SCOPE } from './config.js';
import { HttpApiError } from './errors.js';

export const DRIVE_ROOT_FOLDER_NAME = 'Invoice Studio';

export interface DriveWorkspaceFolders {
  connectedFolderId: string;
  connectedFolderName: string;
  rootFolderId: string;
  companySettingsFolderId: string;
  customersFolderId: string;
  importedDataFolderId: string;
  invoicesFolderId: string;
  invoicesPdfsFolderId: string;
  invoicesRecordsFolderId: string;
  quotationsFolderId: string;
  quotationsPdfsFolderId: string;
  quotationsRecordsFolderId: string;
  emailHistoryFolderId: string;
  backupsFolderId: string;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

export interface VerifiedDriveFolder {
  id: string;
  name: string;
  mimeType: string;
  canEdit: boolean;
  webViewLink?: string;
}

/**
 * Extracts and validates a Google Drive folder ID from a Drive URL or raw ID.
 */
export function extractDriveFolderId(urlOrId: string): string {
  const clean = (urlOrId || '').trim();
  if (!clean) {
    throw new HttpApiError(400, 'INVALID_DRIVE_FOLDER_URL', 'Please paste a Google Drive folder URL.');
  }

  // Standard Drive folder URLs:
  // https://drive.google.com/drive/folders/<ID>
  // https://drive.google.com/drive/u/0/folders/<ID>?usp=sharing
  // https://drive.google.com/open?id=<ID>
  const folderPathMatch = clean.match(/\/folders\/([a-zA-Z0-9_-]{10,120})/);
  if (folderPathMatch?.[1]) {
    return folderPathMatch[1];
  }

  const queryIdMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]{10,120})/);
  if (queryIdMatch?.[1]) {
    return queryIdMatch[1];
  }

  if (/^[a-zA-Z0-9_-]{15,120}$/.test(clean)) {
    return clean;
  }

  throw new HttpApiError(
    400,
    'INVALID_DRIVE_FOLDER_URL',
    'Invalid Google Drive folder URL. Paste a URL like https://drive.google.com/drive/folders/<folder-id>.'
  );
}

export function createDriveServiceAccountClient(config: AppServerConfig): drive_v3.Drive {
  if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
    throw new HttpApiError(
      503,
      'SERVICE_ACCOUNT_NOT_CONFIGURED',
      'Google Drive service account is not configured on this server. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in your server environment variables.'
    );
  }

  if (!config.googleServiceAccountPrivateKey.includes('BEGIN')) {
    throw new HttpApiError(
      503,
      'SERVICE_ACCOUNT_INVALID_KEY',
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is malformed. Ensure the full PEM private key is provided with escaped newlines (\\n).'
    );
  }

  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: [GOOGLE_DRIVE_SERVICE_SCOPE],
  });

  return google.drive({ version: 'v3', auth });
}

function escapeDriveQueryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function mapDriveApiError(err: any, config: AppServerConfig, folderId?: string): HttpApiError {
  if (err instanceof HttpApiError) return err;

  const status = err?.code || err?.status || err?.response?.status || 500;
  const rawMessage =
    err?.response?.data?.error?.message ||
    err?.errors?.[0]?.message ||
    err?.message ||
    'Google Drive request failed.';
  const serviceAccountEmail = config.googleServiceAccountEmail || null;

  if (status === 404 || status === 403) {
    return new HttpApiError(
      403,
      'DRIVE_PERMISSION_REQUIRED',
      serviceAccountEmail
        ? `Access denied to this Google Drive folder. Share the folder with ${serviceAccountEmail} as Editor, then click Connect Folder again.`
        : 'Access denied to this Google Drive folder. Ensure the service account is configured and granted Editor access to the folder.',
      {
        folderId,
        serviceAccountEmail,
        requiredRole: 'Editor',
      }
    );
  }

  if (status === 401) {
    return new HttpApiError(
      503,
      'SERVICE_ACCOUNT_AUTH_FAILED',
      'Google service account authentication failed. Verify GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY on the server.',
      { serviceAccountEmail }
    );
  }

  if (status === 429) {
    return new HttpApiError(
      429,
      'DRIVE_RATE_LIMITED',
      'Google Drive API rate limit reached. Please wait a few seconds and try again.'
    );
  }

  return new HttpApiError(
    status >= 400 && status < 600 ? status : 500,
    'DRIVE_API_ERROR',
    rawMessage,
    { serviceAccountEmail }
  );
}

export async function verifyFolderAccess(
  drive: drive_v3.Drive,
  folderId: string,
  config: AppServerConfig
): Promise<VerifiedDriveFolder> {
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,trashed,webViewLink,capabilities(canAddChildren,canEdit)',
      supportsAllDrives: true,
    });

    const data = res.data;
    if (!data?.id) {
      throw new HttpApiError(404, 'DRIVE_FOLDER_NOT_FOUND', 'Google Drive folder was not found.');
    }

    if (data.trashed) {
      throw new HttpApiError(
        400,
        'DRIVE_FOLDER_TRASHED',
        'This Google Drive folder is in Trash. Restore it in Google Drive or connect another folder.'
      );
    }

    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new HttpApiError(
        400,
        'NOT_A_DRIVE_FOLDER',
        'The pasted URL points to a file rather than a Google Drive folder. Please paste a Drive folder URL.'
      );
    }

    const canEdit = Boolean(data.capabilities?.canAddChildren ?? data.capabilities?.canEdit ?? true);
    if (!canEdit) {
      throw new HttpApiError(
        403,
        'DRIVE_WRITE_PERMISSION_REQUIRED',
        config.googleServiceAccountEmail
          ? `The service account has read-only access to "${data.name || folderId}". Update sharing permissions for ${config.googleServiceAccountEmail} to Editor so Invoice Studio can save records and PDFs.`
          : 'The service account does not have Editor permissions on this Google Drive folder.',
        {
          folderId,
          folderName: data.name || undefined,
          serviceAccountEmail: config.googleServiceAccountEmail || null,
          requiredRole: 'Editor',
        }
      );
    }

    return {
      id: data.id,
      name: data.name || 'Connected Drive Folder',
      mimeType: data.mimeType,
      canEdit,
      webViewLink: data.webViewLink || undefined,
    };
  } catch (err: any) {
    throw mapDriveApiError(err, config, folderId);
  }
}

export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string
): Promise<string> {
  const escaped = escapeDriveQueryString(name);
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and '${escapeDriveQueryString(parentId)}' in parents and trashed = false`;

  const list = await drive.files.list({
    q: query,
    fields: 'files(id,name,createdTime)',
    spaces: 'drive',
    orderBy: 'createdTime asc',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const existing = list.data.files?.[0];
  if (existing?.id) {
    return existing.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name',
    supportsAllDrives: true,
  });

  if (!created.data.id) {
    throw new Error(`Google Drive did not return an ID when creating folder "${name}".`);
  }
  return created.data.id;
}

/**
 * Ensures the full Invoice Studio folder hierarchy exists inside the user's connected Drive folder:
 *   Invoice Studio/
 *     Company Settings/
 *     Customers/
 *     Imported Data/
 *     Invoices/
 *       PDFs/
 *       Records/
 *     Quotations/
 *       PDFs/
 *       Records/
 *     Email History/
 *     Backups/
 */
export async function ensureWorkspaceFolderTree(
  drive: drive_v3.Drive,
  folderId: string,
  config: AppServerConfig
): Promise<DriveWorkspaceFolders> {
  const verified = await verifyFolderAccess(drive, folderId, config);

  try {
    const rootFolderId =
      verified.name.trim().toLowerCase() === DRIVE_ROOT_FOLDER_NAME.toLowerCase()
        ? verified.id
        : await findOrCreateFolder(drive, DRIVE_ROOT_FOLDER_NAME, verified.id);

    const [
      companySettingsFolderId,
      customersFolderId,
      importedDataFolderId,
      invoicesFolderId,
      quotationsFolderId,
      emailHistoryFolderId,
      backupsFolderId,
    ] = await Promise.all([
      findOrCreateFolder(drive, 'Company Settings', rootFolderId),
      findOrCreateFolder(drive, 'Customers', rootFolderId),
      findOrCreateFolder(drive, 'Imported Data', rootFolderId),
      findOrCreateFolder(drive, 'Invoices', rootFolderId),
      findOrCreateFolder(drive, 'Quotations', rootFolderId),
      findOrCreateFolder(drive, 'Email History', rootFolderId),
      findOrCreateFolder(drive, 'Backups', rootFolderId),
    ]);

    const [
      invoicesPdfsFolderId,
      invoicesRecordsFolderId,
      quotationsPdfsFolderId,
      quotationsRecordsFolderId,
    ] = await Promise.all([
      findOrCreateFolder(drive, 'PDFs', invoicesFolderId),
      findOrCreateFolder(drive, 'Records', invoicesFolderId),
      findOrCreateFolder(drive, 'PDFs', quotationsFolderId),
      findOrCreateFolder(drive, 'Records', quotationsFolderId),
    ]);

    return {
      connectedFolderId: verified.id,
      connectedFolderName: verified.name,
      rootFolderId,
      companySettingsFolderId,
      customersFolderId,
      importedDataFolderId,
      invoicesFolderId,
      invoicesPdfsFolderId,
      invoicesRecordsFolderId,
      quotationsFolderId,
      quotationsPdfsFolderId,
      quotationsRecordsFolderId,
      emailHistoryFolderId,
      backupsFolderId,
    };
  } catch (err: any) {
    throw mapDriveApiError(err, config, folderId);
  }
}

export async function findFileInFolder(
  drive: drive_v3.Drive,
  parentId: string,
  fileName: string
): Promise<DriveFileMeta | null> {
  const escaped = escapeDriveQueryString(fileName);
  const res = await drive.files.list({
    q: `'${escapeDriveQueryString(parentId)}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const file = res.data.files?.[0];
  if (!file?.id) return null;
  return {
    id: file.id,
    name: file.name || fileName,
    mimeType: file.mimeType || 'application/octet-stream',
    modifiedTime: file.modifiedTime || undefined,
    size: file.size || undefined,
    webViewLink: file.webViewLink || undefined,
  };
}

export async function readJsonFile<T>(
  drive: drive_v3.Drive,
  parentId: string,
  fileName: string
): Promise<{ fileId: string; modifiedTime?: string; data: T } | null> {
  const meta = await findFileInFolder(drive, parentId, fileName);
  if (!meta) return null;

  const contentRes = await drive.files.get(
    {
      fileId: meta.id,
      alt: 'media',
      supportsAllDrives: true,
    },
    { responseType: 'text' }
  );

  const raw =
    typeof contentRes.data === 'string'
      ? contentRes.data
      : JSON.stringify(contentRes.data ?? {});

  const parsed = JSON.parse(raw) as T;
  return {
    fileId: meta.id,
    modifiedTime: meta.modifiedTime,
    data: parsed,
  };
}

export async function writeJsonFile<T>(
  drive: drive_v3.Drive,
  parentId: string,
  fileName: string,
  data: T
): Promise<DriveFileMeta> {
  const existing = await findFileInFolder(drive, parentId, fileName);
  const bodyString = JSON.stringify(data, null, 2);

  if (existing) {
    const updated = await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType: 'application/json',
        body: Readable.from([bodyString]),
      },
      fields: 'id,name,mimeType,modifiedTime,size,webViewLink',
      supportsAllDrives: true,
    });

    return {
      id: updated.data.id || existing.id,
      name: updated.data.name || fileName,
      mimeType: updated.data.mimeType || 'application/json',
      modifiedTime: updated.data.modifiedTime || new Date().toISOString(),
      size: updated.data.size || undefined,
      webViewLink: updated.data.webViewLink || undefined,
    };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/json',
      parents: [parentId],
    },
    media: {
      mimeType: 'application/json',
      body: Readable.from([bodyString]),
    },
    fields: 'id,name,mimeType,modifiedTime,size,webViewLink',
    supportsAllDrives: true,
  });

  if (!created.data.id) {
    throw new Error(`Google Drive did not return a file ID for "${fileName}".`);
  }

  return {
    id: created.data.id,
    name: created.data.name || fileName,
    mimeType: created.data.mimeType || 'application/json',
    modifiedTime: created.data.modifiedTime || new Date().toISOString(),
    size: created.data.size || undefined,
    webViewLink: created.data.webViewLink || undefined,
  };
}

export async function uploadBinaryFile(
  drive: drive_v3.Drive,
  parentId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<DriveFileMeta> {
  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180) || 'document.pdf';
  const existing = await findFileInFolder(drive, parentId, safeName);

  if (existing) {
    const updated = await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType,
        body: Readable.from([buffer]),
      },
      fields: 'id,name,mimeType,modifiedTime,size,webViewLink',
      supportsAllDrives: true,
    });
    return {
      id: updated.data.id || existing.id,
      name: updated.data.name || safeName,
      mimeType: updated.data.mimeType || mimeType,
      modifiedTime: updated.data.modifiedTime || new Date().toISOString(),
      size: updated.data.size || String(buffer.length),
      webViewLink: updated.data.webViewLink || undefined,
    };
  }

  const created = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: Readable.from([buffer]),
    },
    fields: 'id,name,mimeType,modifiedTime,size,webViewLink',
    supportsAllDrives: true,
  });

  if (!created.data.id) {
    throw new Error(`Google Drive did not return a file ID when uploading "${safeName}".`);
  }

  return {
    id: created.data.id,
    name: created.data.name || safeName,
    mimeType: created.data.mimeType || mimeType,
    modifiedTime: created.data.modifiedTime || new Date().toISOString(),
    size: created.data.size || String(buffer.length),
    webViewLink: created.data.webViewLink || undefined,
  };
}

export async function listFilesInFolder(
  drive: drive_v3.Drive,
  parentId: string,
  pageSize: number = 50
): Promise<DriveFileMeta[]> {
  const res = await drive.files.list({
    q: `'${escapeDriveQueryString(parentId)}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (res.data.files || [])
    .filter((f) => Boolean(f.id))
    .map((f) => ({
      id: f.id!,
      name: f.name || 'Unnamed',
      mimeType: f.mimeType || 'application/octet-stream',
      modifiedTime: f.modifiedTime || undefined,
      size: f.size || undefined,
      webViewLink: f.webViewLink || undefined,
    }));
}

export async function downloadFileText(drive: drive_v3.Drive, fileId: string): Promise<string> {
  const res = await drive.files.get(
    {
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    },
    { responseType: 'text' }
  );
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
}
