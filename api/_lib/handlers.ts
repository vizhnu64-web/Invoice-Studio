/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIntegrationDiagnostics, getServerConfig } from './config.js';
import {
  deleteSmtpConfig,
  dispatchSmtpEmails,
  getPublicSmtpConfig,
  saveSmtpConfig,
  sendTestEmail,
  testSmtpConnection,
} from './emailBackendService.js';
import { HttpApiError } from './errors.js';
import {
  extractBearerToken,
  getPublicGoogleConfig,
  requireGooglePermission,
  revokeGoogleAccessToken,
  VerifiedGoogleIdentity,
  verifyGoogleAccessToken,
} from './googleAuth.js';
import {
  AssetCategory,
  createRequestDriveClient,
  createWorkspaceBackup,
  downloadDriveFileBase64,
  DriveFileSlot,
  ensureWorkspaceStructure,
  extractDriveFolderIdFromInput,
  findOrCreateRootFolder,
  listFolderFiles,
  loadOrInitializeWorkspace,
  restoreWorkspaceBackup,
  saveWorkspace,
  trashWorkspaceFile,
  uploadAssetToDrive,
  uploadPdfToDrive,
  verifyFolderAccess,
} from './googleDrive.js';
import {
  createRequestGmailClient,
  dispatchGmailEmails,
  sendGmailTestEmail,
} from './googleGmail.js';
import {
  createRequestSheetsClient,
  getSpreadsheetMetadata,
  getWorksheetValues,
  syncSpreadsheet,
} from './googleSheets.js';
import {
  checkRateLimit,
  getHeaderValue,
  getQueryParam,
  getRequestOrigin,
  NormalizedRequest,
  NormalizedResponse,
  readJsonBody,
  sendJson,
} from './http.js';
import { OAuthDriveEmailStore, validateDriveFolderId } from './oauthDriveClient.js';

function handleRouteError(res: NormalizedResponse, err: any, fallbackMessage: string) {
  if (err instanceof HttpApiError) {
    return sendJson(res, err.status, {
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  const message = err?.message || fallbackMessage;
  return sendJson(res, 500, {
    error: message,
    code: 'INTERNAL_ERROR',
  });
}

async function authenticateGoogleRequest(
  req: NormalizedRequest,
  requiredPermission?: 'drive' | 'sheets' | 'gmail'
): Promise<{
  accessToken: string;
  identity: VerifiedGoogleIdentity;
  config: ReturnType<typeof getServerConfig>;
}> {
  const config = getServerConfig(getRequestOrigin(req));
  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  const identity = await verifyGoogleAccessToken(accessToken, { config });
  if (requiredPermission) {
    requireGooglePermission(identity, requiredPermission);
  }
  return { accessToken, identity, config };
}

/**
 * Extracts and validates the caller's Google OAuth Bearer token, verified `sub` identity,
 * and Drive folder access before allowing any per-business email settings read/write or dispatch.
 */
async function createVerifiedOAuthEmailStore(
  req: NormalizedRequest,
  config: ReturnType<typeof getServerConfig>,
  body?: any,
  preverified?: { accessToken: string; identity: VerifiedGoogleIdentity }
): Promise<OAuthDriveEmailStore> {
  const accessToken =
    preverified?.accessToken || extractBearerToken(getHeaderValue(req, 'authorization'));
  const identity =
    preverified?.identity || (await verifyGoogleAccessToken(accessToken, { config }));
  requireGooglePermission(identity, 'drive');

  const rawFolderId =
    getHeaderValue(req, 'x-workspace-folder-id') ||
    body?.folderId ||
    getQueryParam(req, 'folderId') ||
    '';
  const folderId = validateDriveFolderId(rawFolderId);

  const store = new OAuthDriveEmailStore({
    folderId,
    accessToken,
    config,
  });

  await store.verifyAccess();
  return store;
}

// ============================================================
// HEALTH & PUBLIC SERVER CONFIG (NO SECRETS)
// ============================================================

export async function handleHealth(req: NormalizedRequest, res: NormalizedResponse) {
  const diagnostics = getIntegrationDiagnostics(getRequestOrigin(req));
  return sendJson(res, 200, {
    status: 'ok',
    service: 'invoice-studio',
    timestamp: new Date().toISOString(),
    diagnostics,
  });
}

// ============================================================
// GOOGLE AUTH & SESSION VERIFICATION (/api/google/*)
// ============================================================

export async function handleGoogleConfig(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  const publicConfig = getPublicGoogleConfig(getRequestOrigin(req));
  return sendJson(res, 200, publicConfig);
}

export async function handleGoogleVerifySession(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const { identity } = await authenticateGoogleRequest(req);
    return sendJson(res, 200, {
      ok: true,
      session: {
        sub: identity.sub,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        emailVerified: identity.emailVerified,
        grantedScopes: identity.grantedScopes,
        expiresIn: identity.expiresIn,
        expiresAt: identity.expiresAt,
        permissions: identity.permissions,
      },
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Unable to verify Google OAuth session.');
  }
}

export async function handleGoogleTest(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const body = await readJsonBody(req);
    const { accessToken, identity } = await authenticateGoogleRequest(req);
    let folderCheck: { ok: boolean; folderId?: string; folderName?: string; error?: string } = {
      ok: false,
    };

    const rawFolder =
      getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || body?.folderUrl || '';
    if (rawFolder && identity.permissions.driveGranted) {
      try {
        const folderId = extractDriveFolderIdFromInput(rawFolder);
        const drive = createRequestDriveClient(accessToken);
        const verified = await verifyFolderAccess(drive, folderId);
        folderCheck = { ok: true, folderId: verified.id, folderName: verified.name };
      } catch (err: any) {
        folderCheck = { ok: false, error: err?.message || 'Folder verification failed.' };
      }
    }

    return sendJson(res, 200, {
      ok: true,
      sub: identity.sub,
      email: identity.email,
      permissions: identity.permissions,
      folderCheck,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Google connection test failed.');
  }
}

export async function handleGoogleRevoke(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const header = getHeaderValue(req, 'authorization');
    const match = header.match(/^Bearer\s+([^\s]+)$/i);
    if (!match?.[1]) {
      return sendJson(res, 200, { ok: true, revoked: false });
    }
    const result = await revokeGoogleAccessToken(match[1]);
    return sendJson(res, 200, { ok: true, revoked: result.revoked });
  } catch {
    return sendJson(res, 200, { ok: true, revoked: false });
  }
}

// ============================================================
// GOOGLE DRIVE WORKSPACE (/api/drive/*)
// ============================================================

export async function handleDriveConnect(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'drive-connect', 30, 60_000)) {
    return sendJson(res, 429, { error: 'Too many Drive connection attempts. Wait a minute.' });
  }

  try {
    const body = await readJsonBody(req);
    const { accessToken, identity } = await authenticateGoogleRequest(req, 'drive');
    const drive = createRequestDriveClient(accessToken);

    let rootFolderId = '';
    let createdNewFolder = false;

    if (body?.folderUrl || body?.folderId) {
      const candidateId = extractDriveFolderIdFromInput(body.folderUrl || body.folderId);
      const verified = await verifyFolderAccess(drive, candidateId);
      rootFolderId = verified.id;
    } else {
      const foundOrCreated = await findOrCreateRootFolder(drive);
      rootFolderId = foundOrCreated.id;
      createdNewFolder = foundOrCreated.createdNew;
    }

    const loaded = await loadOrInitializeWorkspace(drive, rootFolderId, body?.emptyDefaults);

    return sendJson(res, 200, {
      ok: true,
      account: {
        sub: identity.sub,
        email: identity.email,
        name: identity.name,
      },
      createdNewFolder,
      folderUrl: `https://drive.google.com/drive/folders/${loaded.subfolders.rootFolderId}`,
      ...loaded,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to connect Google Drive workspace folder.');
  }
}

export async function handleDriveWorkspace(req: NormalizedRequest, res: NormalizedResponse) {
  try {
    const { accessToken } = await authenticateGoogleRequest(req, 'drive');
    const drive = createRequestDriveClient(accessToken);

    if (req.method === 'GET') {
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      const loaded = await loadOrInitializeWorkspace(drive, folderId);
      return sendJson(res, 200, { ok: true, ...loaded });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readJsonBody(req);
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      if (!body?.bundle || typeof body.bundle !== 'object') {
        throw new HttpApiError(400, 'MISSING_WORKSPACE_BUNDLE', 'Workspace bundle payload is required.');
      }
      const saved = await saveWorkspace(drive, folderId, body.bundle, {
        expectedRevisions: body.expectedRevisions,
        forceOverwrite: Boolean(body.forceOverwrite),
        allowEmptyOverwrite: Boolean(body.allowEmptyOverwrite),
      });
      return sendJson(res, 200, { ok: true, ...saved });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to sync Google Drive workspace.');
  }
}

export async function handleDriveFiles(req: NormalizedRequest, res: NormalizedResponse) {
  try {
    const { accessToken } = await authenticateGoogleRequest(req, 'drive');
    const drive = createRequestDriveClient(accessToken);

    if (req.method === 'GET') {
      const downloadFileId = getQueryParam(req, 'downloadFileId');
      if (downloadFileId) {
        const downloaded = await downloadDriveFileBase64(drive, downloadFileId);
        return sendJson(res, 200, { ok: true, file: downloaded });
      }

      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      const subfolders = await ensureWorkspaceStructure(drive, folderId);

      const slot = getQueryParam(req, 'slot') as DriveFileSlot | '';
      if (slot) {
        const validSlots: DriveFileSlot[] = [
          'invoices',
          'quotations',
          'backups',
          'assets',
          'logos',
          'signatures',
          'stamps',
          'workspace',
        ];
        if (!validSlots.includes(slot)) {
          throw new HttpApiError(400, 'INVALID_FOLDER_SLOT', `Invalid folder slot "${slot}".`);
        }
        const files = await listFolderFiles(drive, subfolders, slot);
        return sendJson(res, 200, { ok: true, slot, files });
      }

      const [backups, invoices, quotations, logos, signatures, stamps, assets] = await Promise.all([
        listFolderFiles(drive, subfolders, 'backups'),
        listFolderFiles(drive, subfolders, 'invoices'),
        listFolderFiles(drive, subfolders, 'quotations'),
        listFolderFiles(drive, subfolders, 'logos'),
        listFolderFiles(drive, subfolders, 'signatures'),
        listFolderFiles(drive, subfolders, 'stamps'),
        listFolderFiles(drive, subfolders, 'assets'),
      ]);

      return sendJson(res, 200, {
        ok: true,
        subfolders,
        backupCount: backups.length,
        invoicePdfCount: invoices.length,
        quotationPdfCount: quotations.length,
        assetCount:
          logos.length +
          signatures.length +
          stamps.length +
          assets.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').length,
        backups,
        invoices,
        quotations,
        assets: { logos, signatures, stamps },
      });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);

      if (body?.kind === 'asset') {
        const file = await uploadAssetToDrive(drive, folderId, {
          category: body.category as AssetCategory | undefined,
          assetName: String(body.assetName || 'asset'),
          dataUrl: String(body.dataUrl || ''),
        });
        return sendJson(res, 200, { ok: true, file, uploadedAt: new Date().toISOString() });
      }

      const file = await uploadPdfToDrive(drive, folderId, {
        documentType: body?.documentType === 'quotation' ? 'quotation' : 'invoice',
        fileName: String(body?.fileName || 'document.pdf'),
        pdfBase64: String(body?.pdfBase64 || ''),
      });
      return sendJson(res, 200, { ok: true, file, uploadedAt: new Date().toISOString() });
    }

    if (req.method === 'DELETE') {
      const body = await readJsonBody(req).catch(() => ({}));
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      const fileId = String(body?.fileId || getQueryParam(req, 'fileId') || '').trim();
      const confirmed = body?.confirmed === true || getQueryParam(req, 'confirmed') === 'true';
      if (!confirmed) {
        throw new HttpApiError(
          400,
          'DELETE_CONFIRMATION_REQUIRED',
          'Explicit user confirmation is required before deleting a file from Google Drive.'
        );
      }
      const result = await trashWorkspaceFile(drive, folderId, fileId);
      return sendJson(res, 200, { ok: true, ...result });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Google Drive file operation failed.');
  }
}

export async function handleDriveBackups(req: NormalizedRequest, res: NormalizedResponse) {
  try {
    const { accessToken } = await authenticateGoogleRequest(req, 'drive');
    const drive = createRequestDriveClient(accessToken);

    if (req.method === 'GET') {
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      const subfolders = await ensureWorkspaceStructure(drive, folderId);
      const backups = await listFolderFiles(drive, subfolders, 'backups');
      return sendJson(res, 200, { ok: true, backups });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      if (!body?.bundle || typeof body.bundle !== 'object') {
        throw new HttpApiError(400, 'MISSING_BACKUP_BUNDLE', 'Workspace snapshot bundle is required.');
      }
      const result = await createWorkspaceBackup(drive, folderId, body.bundle);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const rawFolderId =
        getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
      const folderId = extractDriveFolderIdFromInput(rawFolderId);
      const backupFileId = String(body?.backupFileId || '').trim();
      const result = await restoreWorkspaceBackup(drive, folderId, backupFileId);
      return sendJson(res, 200, { ok: true, ...result });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Google Drive backup operation failed.');
  }
}

// ============================================================
// GOOGLE SHEETS (/api/sheets/*)
// ============================================================

export async function handleSheetsMetadata(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const { accessToken } = await authenticateGoogleRequest(req, 'sheets');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const urlOrId = String(
      body?.urlOrId || body?.spreadsheetUrl || body?.spreadsheetId || getQueryParam(req, 'urlOrId') || ''
    );
    const sheets = createRequestSheetsClient(accessToken);
    const metadata = await getSpreadsheetMetadata(sheets, urlOrId);
    return sendJson(res, 200, metadata);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to read Google Spreadsheet metadata.');
  }
}

export async function handleSheetsValues(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const { accessToken } = await authenticateGoogleRequest(req, 'sheets');
    const body = await readJsonBody(req);
    const sheets = createRequestSheetsClient(accessToken);
    const values = await getWorksheetValues(sheets, {
      urlOrId: String(body?.urlOrId || body?.spreadsheetId || ''),
      sheetTitle: String(body?.sheetTitle || ''),
      range: body?.range ? String(body.range) : undefined,
      headerRowIndex: body?.headerRowIndex ?? 'auto',
      spreadsheetTitle: body?.spreadsheetTitle ? String(body.spreadsheetTitle) : undefined,
    });
    return sendJson(res, 200, values);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to retrieve worksheet values from Google Sheets.');
  }
}

export async function handleSheetsSync(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const { accessToken } = await authenticateGoogleRequest(req, 'sheets');
    const body = await readJsonBody(req);
    const sheets = createRequestSheetsClient(accessToken);
    const result = await syncSpreadsheet(sheets, {
      urlOrId: String(body?.urlOrId || body?.spreadsheetUrl || body?.spreadsheetId || ''),
      selectedSheets: Array.isArray(body?.selectedSheets) ? body.selectedSheets : undefined,
      syncAllSheets: Boolean(body?.syncAllSheets),
      range: body?.range ? String(body.range) : undefined,
      headerRowIndex: body?.headerRowIndex ?? 'auto',
    });
    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to sync Google Spreadsheet.');
  }
}

// ============================================================
// GMAIL API (/api/gmail/*) — DEFAULT EMAIL PROVIDER
// ============================================================

export async function handleGmailSend(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'gmail-send', 20, 60_000)) {
    return sendJson(res, 429, { error: 'Gmail sending rate limit reached. Wait a minute.' });
  }
  try {
    const body = await readJsonBody(req);
    const { accessToken, identity, config } = await authenticateGoogleRequest(req, 'gmail');
    const gmail = createRequestGmailClient(accessToken);

    let driveStore: OAuthDriveEmailStore | null = null;
    const rawFolderId =
      getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
    if (rawFolderId && identity.permissions.driveGranted) {
      try {
        driveStore = await createVerifiedOAuthEmailStore(req, config, body, {
          accessToken,
          identity,
        });
      } catch {
        driveStore = null;
      }
    }

    const result = await dispatchGmailEmails({
      gmail,
      identity,
      driveStore,
      senderName: body?.senderName ? String(body.senderName) : undefined,
      replyTo: body?.replyTo ? String(body.replyTo) : undefined,
      items: Array.isArray(body?.items) ? body.items : [],
    });

    const sentCount = result.results.filter((r) => r.status === 'Sent').length;
    const failedCount = result.results.length - sentCount;

    return sendJson(res, 200, {
      ok: failedCount === 0,
      sentCount,
      failedCount,
      senderEmail: result.senderEmail,
      persistedInDrive: result.persistedInDrive,
      results: result.results,
      logs: result.logs,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to send email via Gmail API.');
  }
}

export async function handleGmailTestSend(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'gmail-test-send', 10, 60_000)) {
    return sendJson(res, 429, { error: 'Too many Gmail test attempts. Wait a minute.' });
  }
  try {
    const body = await readJsonBody(req);
    const { accessToken, identity, config } = await authenticateGoogleRequest(req, 'gmail');
    const gmail = createRequestGmailClient(accessToken);

    let driveStore: OAuthDriveEmailStore | null = null;
    const rawFolderId =
      getHeaderValue(req, 'x-workspace-folder-id') || body?.folderId || getQueryParam(req, 'folderId');
    if (rawFolderId && identity.permissions.driveGranted) {
      try {
        driveStore = await createVerifiedOAuthEmailStore(req, config, body, {
          accessToken,
          identity,
        });
      } catch {
        driveStore = null;
      }
    }

    const result = await sendGmailTestEmail({
      gmail,
      identity,
      driveStore,
      recipientEmail: String(body?.recipientEmail || identity.email),
      senderName: body?.senderName ? String(body.senderName) : undefined,
      replyTo: body?.replyTo ? String(body.replyTo) : undefined,
    });

    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to send Gmail API test email.');
  }
}

export async function handleGmailHistory(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const driveStore = await createVerifiedOAuthEmailStore(req, config);
    const logs = await driveStore.readEmailLogs();
    return sendJson(res, 200, { logs });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to load Gmail delivery history from Google Drive.');
  }
}

// ============================================================
// CUSTOM SMTP (OPTIONAL ALTERNATIVE — ENCRYPTED IN USER'S DRIVE)
// ============================================================

export async function handleSmtpConfig(req: NormalizedRequest, res: NormalizedResponse) {
  try {
    const config = getServerConfig(getRequestOrigin(req));

    if (req.method === 'GET') {
      const driveStore = await createVerifiedOAuthEmailStore(req, config);
      const smtp = await getPublicSmtpConfig({ driveStore });
      return sendJson(res, 200, { smtp });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readJsonBody(req);
      const driveStore = await createVerifiedOAuthEmailStore(req, config, body);
      const smtp = await saveSmtpConfig({
        driveStore,
        input: {
          provider: body?.provider === 'custom_smtp' ? 'custom_smtp' : 'gmail_smtp',
          host: String(body?.host || ''),
          port: Number(body?.port || 465),
          encryption:
            body?.encryption === 'STARTTLS' || body?.encryption === 'NONE'
              ? body.encryption
              : 'SSL',
          username: String(body?.username || ''),
          password: body?.password !== undefined ? String(body.password) : undefined,
          senderName: String(body?.senderName || ''),
          senderEmail: String(body?.senderEmail || ''),
          replyTo: body?.replyTo !== undefined ? String(body.replyTo) : undefined,
        },
      });
      return sendJson(res, 200, { ok: true, smtp });
    }

    if (req.method === 'DELETE') {
      const driveStore = await createVerifiedOAuthEmailStore(req, config);
      await deleteSmtpConfig({ driveStore });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to manage SMTP configuration.');
  }
}

export async function handleSmtpTest(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'smtp-test', 20, 60_000)) {
    return sendJson(res, 429, { error: 'Too many SMTP test attempts. Please wait a minute.' });
  }

  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const driveStore = await createVerifiedOAuthEmailStore(req, config, body);

    const hasInlineOverride = Boolean(body?.host || body?.username || body?.password);
    const result = await testSmtpConnection({
      driveStore,
      config,
      override: hasInlineOverride
        ? {
            provider: body?.provider === 'custom_smtp' ? 'custom_smtp' : 'gmail_smtp',
            host: body?.host,
            port: body?.port ? Number(body.port) : undefined,
            encryption: body?.encryption,
            username: body?.username,
            password: body?.password,
            senderName: body?.senderName,
            senderEmail: body?.senderEmail,
            replyTo: body?.replyTo,
          }
        : undefined,
    });
    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleRouteError(res, err, 'SMTP connection verification failed.');
  }
}

export async function handleEmailTestSend(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'email-test-send', 10, 60_000)) {
    return sendJson(res, 429, {
      error: 'Rate limit reached for test emails. Please wait a minute.',
    });
  }

  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const driveStore = await createVerifiedOAuthEmailStore(req, config, body);

    const result = await sendTestEmail({
      driveStore,
      recipientEmail: String(body?.recipientEmail || ''),
    });
    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to send test email.');
  }
}

export async function handleEmailSend(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'email-send', 20, 60_000)) {
    return sendJson(res, 429, { error: 'Email sending rate limit reached. Please wait a minute.' });
  }

  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const driveStore = await createVerifiedOAuthEmailStore(req, config, body);

    const result = await dispatchSmtpEmails({
      driveStore,
      items: Array.isArray(body?.items) ? body.items : [],
    });

    const sentCount = result.results.filter((r) => r.status === 'Sent').length;
    const failedCount = result.results.length - sentCount;

    return sendJson(res, 200, {
      ok: failedCount === 0,
      sentCount,
      failedCount,
      persistedInDrive: result.persistedInDrive,
      results: result.results,
      logs: result.logs,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to dispatch emails.');
  }
}

export async function handleEmailHistory(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const driveStore = await createVerifiedOAuthEmailStore(req, config);
    const logs = await driveStore.readEmailLogs();
    return sendJson(res, 200, { logs });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to load email history from Google Drive.');
  }
}
