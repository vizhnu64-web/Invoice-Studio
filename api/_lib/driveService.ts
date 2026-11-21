/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import { google, drive_v3 } from 'googleapis';
import {
  AppServerConfig,
  GOOGLE_DRIVE_SERVICE_SCOPE,
  validateServiceAccountPrivateKey,
} from './config.js';
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

export interface DriveFolderCapabilities {
  canEdit: boolean | null;
  canAddChildren: boolean | null;
  canListChildren: boolean | null;
}

export interface VerifiedDriveFolder {
  id: string;
  name: string;
  mimeType: string;
  canEdit: boolean;
  canAddChildren: boolean;
  canListChildren: boolean;
  capabilities: DriveFolderCapabilities;
  webViewLink?: string;
}

export interface GoogleApiErrorDetails {
  httpStatus: number | null;
  reason: string | null;
  message: string;
  domain: string | null;
}

export interface DriveFolderDiagnosticReport {
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
        capabilities: DriveFolderCapabilities;
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
    probableCause:
      | 'HEALTHY'
      | 'SERVICE_ACCOUNT_NOT_CONFIGURED'
      | 'SERVICE_ACCOUNT_INVALID_KEY'
      | 'SERVICE_ACCOUNT_AUTH_FAILED'
      | 'INVALID_FOLDER_URL'
      | 'DRIVE_API_DISABLED'
      | 'FOLDER_NOT_FOUND_OR_NOT_SHARED'
      | 'WRONG_ITEM_TYPE'
      | 'FOLDER_TRASHED'
      | 'LIMITED_ACCESS_OR_READ_ONLY'
      | 'PERMISSION_RESTRICTED'
      | 'STORAGE_QUOTA_EXCEEDED'
      | 'RATE_LIMITED'
      | 'DRIVE_API_ERROR';
    apiStatus: number | null;
    apiReason: string | null;
    summary: string;
    recommendedAction: string;
  };
}

/**
 * Safely extracts HTTP status, Google API error reason, and safe message without leaking credentials.
 */
export function extractGoogleApiErrorDetails(err: any): GoogleApiErrorDetails {
  const numericStatus =
    typeof err?.response?.status === 'number'
      ? err.response.status
      : typeof err?.status === 'number'
        ? err.status
        : typeof err?.code === 'number'
          ? err.code
          : null;

  const responseError = err?.response?.data?.error;
  const firstErrorItem = Array.isArray(responseError?.errors)
    ? responseError.errors[0]
    : Array.isArray(err?.errors)
      ? err.errors[0]
      : null;

  const reason: string | null =
    firstErrorItem?.reason ||
    (typeof responseError === 'string' ? responseError : null) ||
    responseError?.status ||
    (typeof err?.code === 'string' ? err.code : null) ||
    null;

  const domain: string | null = firstErrorItem?.domain || null;

  let rawMessage: string =
    (typeof responseError === 'object' && responseError?.message) ||
    err?.response?.data?.error_description ||
    firstErrorItem?.message ||
    err?.message ||
    'Google Drive API request failed.';

  // Redact any accidental private key header/body if a low-level error ever echoes input
  if (/BEGIN [A-Z ]*PRIVATE KEY/i.test(rawMessage)) {
    rawMessage = 'Invalid service account private key format.';
  }

  return {
    httpStatus: numericStatus,
    reason,
    message: rawMessage,
    domain,
  };
}

/**
 * Extracts and validates a Google Drive folder ID from a Drive URL or raw ID.
 */
export function extractDriveFolderIdWithMeta(urlOrId: string): {
  folderId: string;
  sourceType: 'folder_url' | 'query_id_url' | 'raw_id';
} {
  const clean = (urlOrId || '').trim();
  if (!clean) {
    throw new HttpApiError(400, 'INVALID_DRIVE_FOLDER_URL', 'Please paste a Google Drive folder URL.');
  }

  // Explicitly detect My Drive root link (no specific folder ID)
  if (/drive\.google\.com\/drive\/(u\/\d+\/)?my-drive\/?([?#].*)?$/i.test(clean)) {
    throw new HttpApiError(
      400,
      'INVALID_DRIVE_FOLDER_URL',
      'You pasted the root "My Drive" URL. Open the specific shared folder in Google Drive and copy its URL (https://drive.google.com/drive/folders/<folder-id>).'
    );
  }

  // Explicitly detect file links (/file/d/<id>)
  if (/drive\.google\.com\/file\/d\//i.test(clean)) {
    throw new HttpApiError(
      400,
      'NOT_A_DRIVE_FOLDER',
      'You pasted a Google Drive file URL (/file/d/...) instead of a folder URL (/folders/...).'
    );
  }

  // Standard Drive folder URLs:
  // https://drive.google.com/drive/folders/<ID>
  // https://drive.google.com/drive/u/0/folders/<ID>?usp=sharing
  // https://drive.google.com/drive/mobile/folders/<ID>?usp=drive_link
  const folderPathMatch = clean.match(/\/folders\/([a-zA-Z0-9_-]{10,120})(?:[/?#]|$)/);
  if (folderPathMatch?.[1]) {
    return { folderId: folderPathMatch[1], sourceType: 'folder_url' };
  }

  // Legacy/open/folderview URLs:
  // https://drive.google.com/open?id=<ID>
  // https://drive.google.com/folderview?id=<ID>
  const queryIdMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]{10,120})(?:[&#]|$)/);
  if (queryIdMatch?.[1]) {
    return { folderId: queryIdMatch[1], sourceType: 'query_id_url' };
  }

  // Reject any URL that didn't match a Drive folder pattern
  if (/^https?:\/\//i.test(clean) || clean.includes('/') || clean.includes('.')) {
    throw new HttpApiError(
      400,
      'INVALID_DRIVE_FOLDER_URL',
      'Invalid Google Drive folder URL. Paste a link like https://drive.google.com/drive/folders/<folder-id>.'
    );
  }

  // Raw Drive folder IDs are 15-120 URL-safe characters and contain uppercase letters or digits
  // (prevents plain lowercase English phrases like "not-a-valid-drive-url" from passing as folder IDs)
  if (/^[a-zA-Z0-9_-]{15,120}$/.test(clean) && /[A-Z0-9_]/.test(clean)) {
    return { folderId: clean, sourceType: 'raw_id' };
  }

  throw new HttpApiError(
    400,
    'INVALID_DRIVE_FOLDER_URL',
    'Invalid Google Drive folder URL or ID. Paste a link like https://drive.google.com/drive/folders/<folder-id>.'
  );
}

export function extractDriveFolderId(urlOrId: string): string {
  return extractDriveFolderIdWithMeta(urlOrId).folderId;
}

export function createDriveServiceAccountClient(config: AppServerConfig): drive_v3.Drive {
  if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
    throw new HttpApiError(
      503,
      'SERVICE_ACCOUNT_NOT_CONFIGURED',
      'Google Drive service account is not configured on this server. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in your server environment variables.',
      {
        serviceAccountEmail: config.googleServiceAccountEmail || null,
      }
    );
  }

  const keyCheck = validateServiceAccountPrivateKey(config.googleServiceAccountPrivateKey);
  if (!keyCheck.valid) {
    throw new HttpApiError(
      503,
      'SERVICE_ACCOUNT_INVALID_KEY',
      keyCheck.reason ||
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is malformed. Ensure the full PEM private key from the service account JSON file is provided.',
      {
        serviceAccountEmail: config.googleServiceAccountEmail,
      }
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

  const { httpStatus, reason, message, domain } = extractGoogleApiErrorDetails(err);
  const serviceAccountEmail = config.googleServiceAccountEmail || null;
  const baseDetails = {
    folderId,
    serviceAccountEmail,
    apiStatus: httpStatus,
    apiReason: reason,
    apiMessage: message,
    apiDomain: domain,
  };

  // 1. OpenSSL / private key decoding errors
  if (
    (reason && /ERR_OSSL|DECODER|KEY/i.test(reason)) ||
    /DECODER routines|PEM routines|invalid.*private key/i.test(message)
  ) {
    return new HttpApiError(
      503,
      'SERVICE_ACCOUNT_INVALID_KEY',
      `Service account private key could not be loaded by Node crypto (${reason || 'invalid PEM'}). Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY formatting in your server environment.`,
      baseDetails
    );
  }

  // 2. OAuth / JWT token signing errors (wrong email/key pair, revoked key, disabled account)
  if (
    httpStatus === 401 ||
    reason === 'invalid_grant' ||
    reason === 'invalid_client' ||
    reason === 'unauthorized_client' ||
    /Invalid JWT|invalid_grant|account not found/i.test(message)
  ) {
    return new HttpApiError(
      503,
      'SERVICE_ACCOUNT_AUTH_FAILED',
      `Google service account authentication failed (${reason || httpStatus || 'auth_error'}): ${message}. Verify that GOOGLE_SERVICE_ACCOUNT_EMAIL (${serviceAccountEmail || 'unset'}) matches the private key in GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and that the key has not been revoked.`,
      baseDetails
    );
  }

  // 3. Google Drive API disabled in Google Cloud project (often HTTP 403 accessNotConfigured)
  if (
    reason === 'accessNotConfigured' ||
    reason === 'SERVICE_DISABLED' ||
    /Google Drive API has not been used|it is disabled|Enable it by visiting/i.test(message)
  ) {
    return new HttpApiError(
      503,
      'DRIVE_API_DISABLED',
      `Google Drive API is not enabled for the service account's Google Cloud project${config.googleProjectId ? ` (${config.googleProjectId})` : ''}. Enable "Google Drive API" in Google Cloud Console and retry. Google API message: ${message}`,
      baseDetails
    );
  }

  // 4. Service account storage quota exceeded (common when creating files in personal My Drive)
  if (
    reason === 'storageQuotaExceeded' ||
    /Service Accounts do not have storage quota|storage quota/i.test(message)
  ) {
    return new HttpApiError(
      403,
      'DRIVE_STORAGE_QUOTA_EXCEEDED',
      `Google Drive rejected file creation due to service account storage quota (${reason || 'storageQuotaExceeded'}): ${message}. Service accounts have 0 GB personal My Drive quota; use a Google Workspace Shared Drive or a quota-enabled Drive destination.`,
      baseDetails
    );
  }

  // 5. Rate limiting (Google often returns HTTP 403 userRateLimitExceeded or 429)
  if (
    httpStatus === 429 ||
    reason === 'rateLimitExceeded' ||
    reason === 'userRateLimitExceeded' ||
    reason === 'quotaExceeded'
  ) {
    return new HttpApiError(
      429,
      'DRIVE_RATE_LIMITED',
      `Google Drive API rate limit reached (${reason || httpStatus}): ${message}. Wait a few seconds and try again.`,
      baseDetails
    );
  }

  // 6. Folder not found (HTTP 404 notFound) — distinct from 403!
  if (httpStatus === 404 || reason === 'notFound') {
    return new HttpApiError(
      404,
      'DRIVE_FOLDER_NOT_FOUND',
      serviceAccountEmail
        ? `Google Drive returned 404 (${reason || 'notFound'}) for folder ID "${folderId || ''}" when authenticating as ${serviceAccountEmail}. Verify that (1) the deployed backend is using the exact service-account email you shared the folder with, (2) the folder ID matches the exact shared folder, and (3) the folder is not trashed.`
        : `Google Drive returned 404 (${reason || 'notFound'}) for folder ID "${folderId || ''}".`,
      baseDetails
    );
  }

  // 7. Specific HTTP 403 permission / limited-access / domain policy errors
  if (httpStatus === 403) {
    return new HttpApiError(
      403,
      'DRIVE_INSUFFICIENT_PERMISSIONS',
      `Google Drive denied the operation with HTTP 403 (${reason || 'forbidden'}) for service account ${serviceAccountEmail || 'unknown'}: ${message}`,
      {
        ...baseDetails,
        requiredRole: 'Editor',
      }
    );
  }

  const safeStatus = httpStatus && httpStatus >= 400 && httpStatus < 600 ? httpStatus : 500;
  return new HttpApiError(safeStatus, 'DRIVE_API_ERROR', message, baseDetails);
}

export async function verifyFolderAccess(
  drive: drive_v3.Drive,
  folderId: string,
  config: AppServerConfig
): Promise<VerifiedDriveFolder> {
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,trashed,webViewLink,capabilities(canEdit,canAddChildren,canListChildren)',
      supportsAllDrives: true,
    });

    const data = res.data;
    if (!data?.id) {
      throw new HttpApiError(
        404,
        'DRIVE_FOLDER_NOT_FOUND',
        `Google Drive returned no metadata for folder ID "${folderId}".`,
        { folderId, serviceAccountEmail: config.googleServiceAccountEmail || null }
      );
    }

    if (data.trashed) {
      throw new HttpApiError(
        400,
        'DRIVE_FOLDER_TRASHED',
        `Folder "${data.name || folderId}" is in Google Drive Trash. Restore it in Google Drive or connect another folder.`,
        { folderId, folderName: data.name || undefined }
      );
    }

    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new HttpApiError(
        400,
        'NOT_A_DRIVE_FOLDER',
        `Item "${data.name || folderId}" has mimeType "${data.mimeType || 'unknown'}", not a Google Drive folder.`,
        { folderId, mimeType: data.mimeType || null }
      );
    }

    const capabilities: DriveFolderCapabilities = {
      canEdit: typeof data.capabilities?.canEdit === 'boolean' ? data.capabilities.canEdit : null,
      canAddChildren:
        typeof data.capabilities?.canAddChildren === 'boolean'
          ? data.capabilities.canAddChildren
          : null,
      canListChildren:
        typeof data.capabilities?.canListChildren === 'boolean'
          ? data.capabilities.canListChildren
          : null,
    };

    const canEdit = capabilities.canEdit !== false;
    const canAddChildren = capabilities.canAddChildren !== false;
    const canListChildren = capabilities.canListChildren !== false;

    if (!canAddChildren || !canEdit) {
      throw new HttpApiError(
        403,
        'DRIVE_WRITE_PERMISSION_REQUIRED',
        `Folder "${data.name || folderId}" is reachable by ${config.googleServiceAccountEmail || 'the service account'}, but write capabilities are restricted (canEdit=${String(capabilities.canEdit)}, canAddChildren=${String(capabilities.canAddChildren)}, canListChildren=${String(capabilities.canListChildren)}). This indicates either a Viewer/Commenter role or a limited-access / domain-restricted folder.`,
        {
          folderId,
          folderName: data.name || undefined,
          serviceAccountEmail: config.googleServiceAccountEmail || null,
          capabilities,
          requiredRole: 'Editor',
        }
      );
    }

    if (!canListChildren) {
      throw new HttpApiError(
        403,
        'DRIVE_LIST_PERMISSION_REQUIRED',
        `Folder "${data.name || folderId}" does not allow listing child files (canListChildren=false) for ${config.googleServiceAccountEmail || 'the service account'}. Check limited-access folder restrictions in Google Drive.`,
        {
          folderId,
          folderName: data.name || undefined,
          serviceAccountEmail: config.googleServiceAccountEmail || null,
          capabilities,
        }
      );
    }

    return {
      id: data.id,
      name: data.name || 'Connected Drive Folder',
      mimeType: data.mimeType,
      canEdit,
      canAddChildren,
      canListChildren,
      capabilities,
      webViewLink: data.webViewLink || undefined,
    };
  } catch (err: any) {
    throw mapDriveApiError(err, config, folderId);
  }
}

/**
 * Strictly non-destructive diagnostic check for a Google Drive folder.
 * Performs NO file/folder creation, modification, or deletion.
 */
export async function diagnoseDriveFolderAccess(params: {
  folderUrlOrId: string;
  config: AppServerConfig;
  driveClientOverride?: drive_v3.Drive;
}): Promise<DriveFolderDiagnosticReport> {
  const { folderUrlOrId, config, driveClientOverride } = params;
  const checkedAt = new Date().toISOString();
  const serviceAccountEmail = config.googleServiceAccountEmail || null;
  const projectId = config.googleProjectId || null;

  const keyCheck = driveClientOverride
    ? { valid: true, reason: null }
    : validateServiceAccountPrivateKey(config.googleServiceAccountPrivateKey);

  const report: DriveFolderDiagnosticReport = {
    ok: false,
    checkedAt,
    serviceAccountEmail,
    projectId,
    inputProvided: (folderUrlOrId || '').trim(),
    extractedFolderId: null,
    steps: {
      credentials: {
        ok: false,
        serviceAccountEmail,
        privateKeyFormatValid: keyCheck.valid,
        clientInitialized: false,
        message: '',
      },
      folderIdExtraction: {
        ok: false,
        folderId: null,
        sourceType: 'invalid',
        message: '',
      },
      folderMetadata: {
        attempted: false,
        ok: false,
        apiStatus: null,
        apiReason: null,
        apiMessage: null,
      },
      permissionsList: {
        attempted: false,
        accessible: false,
        apiStatus: null,
        apiReason: null,
        apiMessage: null,
        totalPermissionsReturned: null,
        serviceAccountPermissionFound: false,
        serviceAccountRole: null,
        hasWriterPermission: null,
        note: 'Not attempted yet.',
      },
      listChildren: {
        attempted: false,
        ok: false,
        apiStatus: null,
        apiReason: null,
        apiMessage: null,
        childrenCount: null,
        hasInvoiceStudioFolder: false,
      },
    },
    diagnosis: {
      probableCause: 'DRIVE_API_ERROR',
      apiStatus: null,
      apiReason: null,
      summary: '',
      recommendedAction: '',
    },
  };

  // Step 1: Extract and validate folder ID first so URL typos are immediately reported
  let folderId = '';
  try {
    const extracted = extractDriveFolderIdWithMeta(folderUrlOrId);
    folderId = extracted.folderId;
    report.extractedFolderId = folderId;
    report.steps.folderIdExtraction = {
      ok: true,
      folderId,
      sourceType: extracted.sourceType,
      message: `Extracted folder ID "${folderId}" via ${extracted.sourceType}.`,
    };
  } catch (err: any) {
    report.steps.folderIdExtraction = {
      ok: false,
      folderId: null,
      sourceType: 'invalid',
      message: err?.message || 'Could not extract a valid Google Drive folder ID from the URL.',
    };
  }

  // Step 2: Initialize Google service account client
  let drive: drive_v3.Drive | null = driveClientOverride || null;
  if (!drive) {
    if (!serviceAccountEmail || !config.googleServiceAccountPrivateKey) {
      report.steps.credentials = {
        ok: false,
        serviceAccountEmail,
        privateKeyFormatValid: false,
        clientInitialized: false,
        message:
          'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY on this server.',
      };
      report.diagnosis = {
        probableCause: 'SERVICE_ACCOUNT_NOT_CONFIGURED',
        apiStatus: 503,
        apiReason: 'missing_credentials',
        summary:
          'Backend service account environment variables are not configured on this deployment.',
        recommendedAction:
          'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in your server/Vercel environment variables and redeploy.',
      };
      return report;
    }

    if (!keyCheck.valid) {
      report.steps.credentials = {
        ok: false,
        serviceAccountEmail,
        privateKeyFormatValid: false,
        clientInitialized: false,
        message: keyCheck.reason || 'Invalid PEM private key format.',
      };
      report.diagnosis = {
        probableCause: 'SERVICE_ACCOUNT_INVALID_KEY',
        apiStatus: 503,
        apiReason: 'invalid_private_key',
        summary: `Configured service account email is ${serviceAccountEmail}, but GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY failed PEM validation.`,
        recommendedAction:
          'Re-copy the exact private_key value from the Google Cloud service account JSON key file into GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (preserving \\n line breaks) and redeploy.',
      };
      return report;
    }

    try {
      drive = createDriveServiceAccountClient(config);
      report.steps.credentials = {
        ok: true,
        serviceAccountEmail,
        privateKeyFormatValid: true,
        clientInitialized: true,
        message: `Initialized Google Drive v3 client for ${serviceAccountEmail}.`,
      };
    } catch (err: any) {
      report.steps.credentials = {
        ok: false,
        serviceAccountEmail,
        privateKeyFormatValid: false,
        clientInitialized: false,
        message: err?.message || 'Failed to initialize Google Drive JWT client.',
      };
      report.diagnosis = {
        probableCause: 'SERVICE_ACCOUNT_INVALID_KEY',
        apiStatus: 503,
        apiReason: 'client_init_failed',
        summary: report.steps.credentials.message,
        recommendedAction:
          'Verify GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in your deployment environment.',
      };
      return report;
    }
  } else {
    report.steps.credentials = {
      ok: true,
      serviceAccountEmail,
      privateKeyFormatValid: true,
      clientInitialized: true,
      message: `Initialized Google Drive v3 client for ${serviceAccountEmail || 'test-client'}.`,
    };
  }

  if (!report.steps.folderIdExtraction.ok || !folderId) {
    report.diagnosis = {
      probableCause: 'INVALID_FOLDER_URL',
      apiStatus: 400,
      apiReason: 'invalid_folder_url',
      summary: report.steps.folderIdExtraction.message,
      recommendedAction:
        'Open the exact folder in Google Drive, copy the browser URL (https://drive.google.com/drive/folders/<folder-id>), and run diagnostics again.',
    };
    return report;
  }

  // Step 3: files.get with exact requested fields
  report.steps.folderMetadata.attempted = true;
  try {
    const metaRes = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,trashed,capabilities(canEdit,canAddChildren,canListChildren)',
      supportsAllDrives: true,
    });
    const data = metaRes.data;
    const isFolder = data.mimeType === 'application/vnd.google-apps.folder';
    const trashed = Boolean(data.trashed);
    const capabilities: DriveFolderCapabilities = {
      canEdit: typeof data.capabilities?.canEdit === 'boolean' ? data.capabilities.canEdit : null,
      canAddChildren:
        typeof data.capabilities?.canAddChildren === 'boolean'
          ? data.capabilities.canAddChildren
          : null,
      canListChildren:
        typeof data.capabilities?.canListChildren === 'boolean'
          ? data.capabilities.canListChildren
          : null,
    };

    report.steps.folderMetadata = {
      attempted: true,
      ok: Boolean(data.id) && isFolder && !trashed,
      apiStatus: metaRes.status || 200,
      apiReason: null,
      apiMessage: 'files.get succeeded.',
      folder: {
        id: data.id || folderId,
        name: data.name || '',
        mimeType: data.mimeType || '',
        isFolder,
        trashed,
        capabilities,
      },
    };
  } catch (err: any) {
    const details = extractGoogleApiErrorDetails(err);
    report.steps.folderMetadata = {
      attempted: true,
      ok: false,
      apiStatus: details.httpStatus,
      apiReason: details.reason,
      apiMessage: details.message,
    };

    // Classify exact failure from files.get without returning a generic access-denied message
    if (
      details.reason === 'accessNotConfigured' ||
      details.reason === 'SERVICE_DISABLED' ||
      /Google Drive API has not been used|it is disabled/i.test(details.message)
    ) {
      report.diagnosis = {
        probableCause: 'DRIVE_API_DISABLED',
        apiStatus: details.httpStatus,
        apiReason: details.reason,
        summary: `Google Drive API is disabled in the Google Cloud project for ${serviceAccountEmail}.`,
        recommendedAction:
          'Enable the Google Drive API (drive.googleapis.com) in Google Cloud Console for this service account project and wait 1–2 minutes before retrying.',
      };
      return report;
    }

    if (
      details.httpStatus === 401 ||
      details.reason === 'invalid_grant' ||
      details.reason === 'invalid_client' ||
      /Invalid JWT|invalid_grant|DECODER|account not found/i.test(details.message)
    ) {
      report.diagnosis = {
        probableCause: 'SERVICE_ACCOUNT_AUTH_FAILED',
        apiStatus: details.httpStatus,
        apiReason: details.reason,
        summary: `Service account JWT authentication failed for ${serviceAccountEmail}: ${details.message}`,
        recommendedAction:
          'Check that GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY belong to the same active key in Google Cloud IAM and that the key has not been deleted or disabled.',
      };
      return report;
    }

    if (details.httpStatus === 404 || details.reason === 'notFound') {
      report.diagnosis = {
        probableCause: 'FOLDER_NOT_FOUND_OR_NOT_SHARED',
        apiStatus: details.httpStatus || 404,
        apiReason: details.reason || 'notFound',
        summary: `Google Drive returned 404 notFound for folder ID "${folderId}" using backend service account "${serviceAccountEmail}".`,
        recommendedAction:
          `Compare "${serviceAccountEmail}" against the exact email on the folder's Share list. If Vercel is configured with a different service account email, update GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in Vercel and redeploy. Also verify the folder ID "${folderId}" matches the exact folder that has the permission (not a parent/sibling/limited-access subfolder).`,
      };
      return report;
    }

    if (
      details.httpStatus === 429 ||
      details.reason === 'rateLimitExceeded' ||
      details.reason === 'userRateLimitExceeded'
    ) {
      report.diagnosis = {
        probableCause: 'RATE_LIMITED',
        apiStatus: details.httpStatus,
        apiReason: details.reason,
        summary: `Google Drive rate-limited files.get (${details.reason || details.httpStatus}): ${details.message}`,
        recommendedAction: 'Wait a few seconds and re-run diagnostics.',
      };
      return report;
    }

    report.diagnosis = {
      probableCause: details.httpStatus === 403 ? 'PERMISSION_RESTRICTED' : 'DRIVE_API_ERROR',
      apiStatus: details.httpStatus,
      apiReason: details.reason,
      summary: `files.get failed with HTTP ${details.httpStatus ?? 'unknown'} (${details.reason || 'error'}): ${details.message}`,
      recommendedAction:
        'Review the Google API status code, error reason, and backend service account email shown above.',
    };
    return report;
  }

  // Step 4: permissions.list (best-effort — Editor on My Drive may receive 403 if owner restricted permission viewing)
  report.steps.permissionsList.attempted = true;
  try {
    const permRes = await drive.permissions.list({
      fileId: folderId,
      fields: 'permissions(id,type,role,emailAddress,deleted)',
      supportsAllDrives: true,
    });
    const permissions = permRes.data.permissions || [];
    const matching = serviceAccountEmail
      ? permissions.find(
          (p) =>
            !p.deleted &&
            typeof p.emailAddress === 'string' &&
            p.emailAddress.toLowerCase() === serviceAccountEmail.toLowerCase()
        )
      : undefined;

    const writerRoles = new Set(['writer', 'organizer', 'fileOrganizer', 'owner']);
    const role = matching?.role || null;
    const hasWriter = role ? writerRoles.has(role) : null;

    report.steps.permissionsList = {
      attempted: true,
      accessible: true,
      apiStatus: permRes.status || 200,
      apiReason: null,
      apiMessage: 'permissions.list succeeded.',
      totalPermissionsReturned: permissions.length,
      serviceAccountPermissionFound: Boolean(matching),
      serviceAccountRole: role,
      hasWriterPermission: hasWriter,
      note: matching
        ? `Matched ${serviceAccountEmail} with Drive role "${role}" (${hasWriter ? 'writer/editor confirmed' : 'non-writer role'}).`
        : `Returned ${permissions.length} permission entries; ${serviceAccountEmail || 'service account'} was not listed directly (may inherit access via group/link or Google redacted emailAddress).`,
    };
  } catch (err: any) {
    const details = extractGoogleApiErrorDetails(err);
    report.steps.permissionsList = {
      attempted: true,
      accessible: false,
      apiStatus: details.httpStatus,
      apiReason: details.reason,
      apiMessage: details.message,
      totalPermissionsReturned: null,
      serviceAccountPermissionFound: false,
      serviceAccountRole: null,
      hasWriterPermission: null,
      note:
        details.httpStatus === 403
          ? 'permissions.list returned 403 (normal on My Drive folders when the owner restricted "Editors can change permissions and share"). Rely on files.get capabilities and listChildren result.'
          : `permissions.list failed (${details.httpStatus ?? 'unknown'} ${details.reason || ''}): ${details.message}`,
    };
  }

  // Step 5: Separately test listing the folder's children (non-destructive)
  report.steps.listChildren.attempted = true;
  try {
    const listRes = await drive.files.list({
      q: `'${escapeDriveQueryString(folderId)}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType)',
      pageSize: 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = listRes.data.files || [];
    const hasInvoiceStudio = files.some(
      (f) =>
        f.mimeType === 'application/vnd.google-apps.folder' &&
        (f.name || '').trim().toLowerCase() === DRIVE_ROOT_FOLDER_NAME.toLowerCase()
    );

    report.steps.listChildren = {
      attempted: true,
      ok: true,
      apiStatus: listRes.status || 200,
      apiReason: null,
      apiMessage: `files.list succeeded (${files.length} visible child items).`,
      childrenCount: files.length,
      hasInvoiceStudioFolder: hasInvoiceStudio,
    };
  } catch (err: any) {
    const details = extractGoogleApiErrorDetails(err);
    report.steps.listChildren = {
      attempted: true,
      ok: false,
      apiStatus: details.httpStatus,
      apiReason: details.reason,
      apiMessage: details.message,
      childrenCount: null,
      hasInvoiceStudioFolder: false,
    };
  }

  // Step 6: Synthesize exact non-generic diagnosis
  const folder = report.steps.folderMetadata.folder;
  if (!folder?.isFolder) {
    report.diagnosis = {
      probableCause: 'WRONG_ITEM_TYPE',
      apiStatus: 400,
      apiReason: 'not_a_folder',
      summary: `Drive item "${folder?.name || folderId}" has mimeType "${folder?.mimeType || 'unknown'}", not a folder.`,
      recommendedAction: 'Paste a Google Drive folder URL instead of a file URL.',
    };
    return report;
  }

  if (folder.trashed) {
    report.diagnosis = {
      probableCause: 'FOLDER_TRASHED',
      apiStatus: 400,
      apiReason: 'trashed',
      summary: `Folder "${folder.name}" (${folderId}) is currently in Google Drive Trash.`,
      recommendedAction: 'Restore this folder from Trash in Google Drive, then reconnect.',
    };
    return report;
  }

  const caps = folder.capabilities;
  if (caps.canEdit === false || caps.canAddChildren === false || caps.canListChildren === false) {
    report.diagnosis = {
      probableCause: 'LIMITED_ACCESS_OR_READ_ONLY',
      apiStatus: 403,
      apiReason: 'insufficient_capabilities',
      summary: `Folder "${folder.name}" is visible to ${serviceAccountEmail}, but capabilities are restricted: canEdit=${String(caps.canEdit)}, canAddChildren=${String(caps.canAddChildren)}, canListChildren=${String(caps.canListChildren)}.`,
      recommendedAction:
        'Verify the folder does not have "Limited access" restrictions blocking inheritance and that the service account holds Editor (writer) permission directly on this exact folder.',
    };
    return report;
  }

  if (!report.steps.listChildren.ok) {
    report.diagnosis = {
      probableCause:
        report.steps.listChildren.apiStatus === 429 ||
        report.steps.listChildren.apiReason === 'userRateLimitExceeded'
          ? 'RATE_LIMITED'
          : 'PERMISSION_RESTRICTED',
      apiStatus: report.steps.listChildren.apiStatus,
      apiReason: report.steps.listChildren.apiReason,
      summary: `files.get succeeded for "${folder.name}", but listing folder children failed (${report.steps.listChildren.apiStatus ?? 'unknown'} ${report.steps.listChildren.apiReason || ''}): ${report.steps.listChildren.apiMessage || 'unknown error'}.`,
      recommendedAction:
        'Check whether limited-access folder restrictions or Google Workspace domain policies block files.list on this folder.',
    };
    return report;
  }

  report.ok = true;
  report.diagnosis = {
    probableCause: 'HEALTHY',
    apiStatus: 200,
    apiReason: null,
    summary: `All read-only diagnostics passed for folder "${folder.name}" (${folderId}) using service account ${serviceAccountEmail || 'configured'}. Folder is valid, not trashed, capabilities confirm write/list access (canEdit=${String(caps.canEdit)}, canAddChildren=${String(caps.canAddChildren)}, canListChildren=${String(caps.canListChildren)}), and listing children returned ${report.steps.listChildren.childrenCount ?? 0} item(s).`,
    recommendedAction:
      'Folder metadata, capabilities, and child listing are healthy. If saving JSON/PDF files inside a personal My Drive folder still returns HTTP 403 storageQuotaExceeded, note that Google Drive service accounts have 0 GB personal My Drive storage quota and require a Shared Drive for media uploads.',
  };
  return report;
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
 *
 * Uses controlled sequential batches to prevent Google Drive API 403 userRateLimitExceeded bursts
 * and duplicate subfolder creation on first connect.
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

    const companySettingsFolderId = await findOrCreateFolder(drive, 'Company Settings', rootFolderId);
    const customersFolderId = await findOrCreateFolder(drive, 'Customers', rootFolderId);
    const importedDataFolderId = await findOrCreateFolder(drive, 'Imported Data', rootFolderId);
    const invoicesFolderId = await findOrCreateFolder(drive, 'Invoices', rootFolderId);
    const quotationsFolderId = await findOrCreateFolder(drive, 'Quotations', rootFolderId);
    const emailHistoryFolderId = await findOrCreateFolder(drive, 'Email History', rootFolderId);
    const backupsFolderId = await findOrCreateFolder(drive, 'Backups', rootFolderId);

    const invoicesPdfsFolderId = await findOrCreateFolder(drive, 'PDFs', invoicesFolderId);
    const invoicesRecordsFolderId = await findOrCreateFolder(drive, 'Records', invoicesFolderId);
    const quotationsPdfsFolderId = await findOrCreateFolder(drive, 'PDFs', quotationsFolderId);
    const quotationsRecordsFolderId = await findOrCreateFolder(drive, 'Records', quotationsFolderId);

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
