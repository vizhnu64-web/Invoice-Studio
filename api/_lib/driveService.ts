/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { AppServerConfig } from './config.js';
import { HttpApiError, mapGoogleApiError } from './googleService.js';

export const DRIVE_ROOT_FOLDER_NAME = 'Invoice Studio';

/**
 * Exact 5-folder structure inside each user's private Google Drive:
 * Invoice Studio/
 *   - Application Data/
 *   - Company Assets/
 *   - Generated PDFs/
 *   - Email Records/
 *   - Backups/
 */
export const DRIVE_SUBFOLDER_KEYS = {
  applicationData: 'Application Data',
  companyAssets: 'Company Assets',
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
      // Recreate file gracefully if it was removed in Google Drive
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
