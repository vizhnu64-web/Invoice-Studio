/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIntegrationDiagnostics, getServerConfig } from './config.js';
import {
  createDriveServiceAccountClient,
  extractDriveFolderId,
  verifyFolderAccess,
} from './driveService.js';
import { GoogleDriveStore } from './driveStore.js';
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
  fetchSheetValues,
  fetchSpreadsheetMetadata,
  getPersistedSheetsOverview,
  performSpreadsheetSync,
} from './googleService.js';
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

function getOptionalFolderId(req: NormalizedRequest, body?: any): string | null {
  const raw =
    body?.folderUrl ||
    body?.folderId ||
    getHeaderValue(req, 'x-workspace-folder-id') ||
    getQueryParam(req, 'folderId') ||
    getQueryParam(req, 'folderUrl') ||
    '';
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  return extractDriveFolderId(trimmed);
}

function requireFolderId(req: NormalizedRequest, body?: any): string {
  const folderId = getOptionalFolderId(req, body);
  if (!folderId) {
    throw new HttpApiError(
      400,
      'DRIVE_NOT_CONNECTED',
      'No Google Drive folder is connected for this workspace. Connect a Google Drive folder URL first.'
    );
  }
  return folderId;
}

function getSessionId(req: NormalizedRequest): string | undefined {
  const sid = getHeaderValue(req, 'x-workspace-session-id');
  return sid && /^[a-zA-Z0-9_-]{8,128}$/.test(sid) ? sid : undefined;
}

function createOptionalDriveStore(
  req: NormalizedRequest,
  config: ReturnType<typeof getServerConfig>,
  body?: any
): GoogleDriveStore | null {
  const folderId = getOptionalFolderId(req, body);
  if (!folderId) return null;
  return new GoogleDriveStore({ folderId, config });
}

function createRequiredDriveStore(
  req: NormalizedRequest,
  config: ReturnType<typeof getServerConfig>,
  body?: any
): GoogleDriveStore {
  const folderId = requireFolderId(req, body);
  return new GoogleDriveStore({ folderId, config });
}

// ============================================================
// HEALTH & DIAGNOSTICS (PUBLIC — NEVER EXPOSES PRIVATE KEYS)
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
// GOOGLE DRIVE FOLDER CONNECTION & WORKSPACE STORAGE
// ============================================================

export async function handleDriveConnect(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!checkRateLimit(req, 'drive-connect', 30, 60_000)) {
    return sendJson(res, 429, { error: 'Too many connection attempts. Please wait a moment.' });
  }

  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const rawUrl = String(body?.folderUrl || body?.folderId || '').trim();
    const folderId = extractDriveFolderId(rawUrl);

    const store = new GoogleDriveStore({ folderId, config });
    const exported = await store.exportAllWorkspaceData();
    const smtpConfig = await getPublicSmtpConfig({ driveStore: store });

    const hasExistingData = Boolean(
      exported.workspace?.company?.name ||
        exported.customers.length > 0 ||
        exported.invoices.length > 0 ||
        exported.quotations.length > 0 ||
        Object.keys(exported.sheetsState?.datasets || {}).length > 0 ||
        exported.emailLogs.length > 0
    );

    return sendJson(res, 200, {
      ok: true,
      connected: true,
      folderId: exported.folders.connectedFolderId,
      folderName: exported.folders.connectedFolderName,
      rootFolderId: exported.folders.rootFolderId,
      folderUrl: `https://drive.google.com/drive/folders/${exported.folders.connectedFolderId}`,
      serviceAccountEmail: config.googleServiceAccountEmail || null,
      folders: exported.folders,
      restoredExistingWorkspace: hasExistingData,
      workspace: exported.workspace,
      customers: exported.customers,
      invoices: exported.invoices,
      quotations: exported.quotations,
      sheetsState: exported.sheetsState,
      emailLogs: exported.emailLogs,
      backups: exported.backups,
      smtpConfig,
      lastSyncedAt: exported.lastSyncedAt,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to connect Google Drive folder.');
  }
}

export async function handleDriveTest(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const folderId = requireFolderId(req, body);
    const drive = createDriveServiceAccountClient(config);
    const verified = await verifyFolderAccess(drive, folderId, config);

    return sendJson(res, 200, {
      ok: true,
      folderId: verified.id,
      folderName: verified.name,
      canEdit: verified.canEdit,
      webViewLink: verified.webViewLink,
      serviceAccountEmail: config.googleServiceAccountEmail || null,
      testedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Google Drive folder test failed.');
  }
}

export async function handleDriveStatus(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const folderId = getOptionalFolderId(req);
    if (!folderId) {
      return sendJson(res, 200, {
        connected: false,
        storageMode: 'temporary',
        serviceAccountEmail: config.googleServiceAccountEmail || null,
      });
    }

    const store = new GoogleDriveStore({ folderId, config });
    const [folders, backups, invoicePdfs, quotationPdfs] = await Promise.all([
      store.ensureFolders(),
      store.listBackups(),
      store.listInvoicePdfs(),
      store.listQuotationPdfs(),
    ]);

    return sendJson(res, 200, {
      connected: true,
      storageMode: 'google-drive',
      folderId: folders.connectedFolderId,
      folderName: folders.connectedFolderName,
      rootFolderId: folders.rootFolderId,
      folders,
      serviceAccountEmail: config.googleServiceAccountEmail || null,
      backupCount: backups.length,
      invoicePdfCount: invoicePdfs.length,
      quotationPdfCount: quotationPdfs.length,
      backups,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to read Google Drive workspace status.');
  }
}

export async function handleDriveSync(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const store = createRequiredDriveStore(req, config, body);

    const writes: Promise<any>[] = [];
    if (body.workspace) {
      writes.push(store.writeWorkspaceState(body.workspace));
    }
    if (Array.isArray(body.customers)) {
      writes.push(store.writeCustomers(body.customers));
    }
    if (Array.isArray(body.invoices)) {
      writes.push(store.writeInvoices(body.invoices));
    }
    if (Array.isArray(body.quotations)) {
      writes.push(store.writeQuotations(body.quotations));
    }
    if (Array.isArray(body.emailLogs)) {
      writes.push(store.writeEmailLogs(body.emailLogs));
    }
    if (body.sheetsState && typeof body.sheetsState === 'object') {
      writes.push(store.writeSheetsState(body.sheetsState));
    }

    await Promise.all(writes);
    const syncedAt = new Date().toISOString();

    return sendJson(res, 200, {
      ok: true,
      folderId: store.folderId,
      syncedAt,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to sync workspace records to Google Drive.');
  }
}

export async function handleDriveUploadPdf(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const store = createRequiredDriveStore(req, config, body);

    const docType = body?.documentType === 'quotation' ? 'quotation' : 'invoice';
    const fileName = String(body?.fileName || `${docType}_${Date.now()}.pdf`).trim();
    const rawBase64 = String(body?.pdfBase64 || '').trim();
    if (!rawBase64) {
      return sendJson(res, 400, { error: 'pdfBase64 is required.' });
    }

    const cleanBase64 = rawBase64.includes('base64,') ? rawBase64.split('base64,')[1] : rawBase64;
    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    if (pdfBuffer.length === 0) {
      return sendJson(res, 400, { error: 'Decoded PDF payload is empty.' });
    }

    const uploaded =
      docType === 'quotation'
        ? await store.uploadQuotationPdf(fileName, pdfBuffer)
        : await store.uploadInvoicePdf(fileName, pdfBuffer);

    return sendJson(res, 200, {
      ok: true,
      file: uploaded,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to upload PDF to Google Drive.');
  }
}

export async function handleDriveBackup(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const store = createRequiredDriveStore(req, config, body);
    const { file } = await store.createBackupSnapshot();
    const backups = await store.listBackups();

    return sendJson(res, 200, {
      ok: true,
      backup: file,
      backups,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to create Google Drive backup.');
  }
}

export async function handleDriveRestore(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const store = createRequiredDriveStore(req, config, body);
    const backupFileId = String(body?.backupFileId || '').trim();
    if (!backupFileId) {
      return sendJson(res, 400, { error: 'backupFileId is required.' });
    }

    const snapshot = await store.restoreBackupSnapshot(backupFileId);
    return sendJson(res, 200, {
      ok: true,
      restoredAt: new Date().toISOString(),
      snapshot,
    });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to restore workspace backup from Google Drive.');
  }
}

// ============================================================
// WORKSPACE STATE (CONNECTED DRIVE FOLDER)
// ============================================================

export async function handleWorkspace(req: NormalizedRequest, res: NormalizedResponse) {
  try {
    const config = getServerConfig(getRequestOrigin(req));

    if (req.method === 'GET') {
      const store = createRequiredDriveStore(req, config);
      const data = await store.exportAllWorkspaceData();
      const smtpConfig = await getPublicSmtpConfig({ driveStore: store });
      return sendJson(res, 200, {
        ...data,
        smtpConfig,
      });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJsonBody(req);
      const store = createRequiredDriveStore(req, config, body);

      if (body.workspace) {
        await store.writeWorkspaceState(body.workspace);
      }
      if (Array.isArray(body.customers)) {
        await store.writeCustomers(body.customers);
      }
      if (Array.isArray(body.invoices)) {
        await store.writeInvoices(body.invoices);
      }
      if (Array.isArray(body.quotations)) {
        await store.writeQuotations(body.quotations);
      }
      if (Array.isArray(body.emailLogs)) {
        await store.writeEmailLogs(body.emailLogs);
      }

      return sendJson(res, 200, {
        ok: true,
        folderId: store.folderId,
        updatedAt: new Date().toISOString(),
      });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to sync workspace state with Google Drive.');
  }
}

// ============================================================
// GOOGLE SHEETS URL CONNECTOR (NO SIGN-IN)
// ============================================================

export async function handleSheetsMetadata(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const urlOrId = String(body?.url || body?.spreadsheetId || '').trim();
    const metadata = await fetchSpreadsheetMetadata({ urlOrId, config });
    return sendJson(res, 200, metadata);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to inspect Google Spreadsheet metadata.');
  }
}

export async function handleSheetsValues(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const result = await fetchSheetValues({
      urlOrId: String(body?.url || body?.spreadsheetId || '').trim(),
      sheetTitle: body?.sheetTitle ? String(body.sheetTitle) : undefined,
      customRange: body?.range ? String(body.range) : undefined,
      headerRowIndex: body?.headerRowIndex,
      config,
    });
    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to fetch worksheet data from Google Sheets.');
  }
}

export async function handleSheetsSync(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = await readJsonBody(req);
    const driveStore = createOptionalDriveStore(req, config, body);

    const result = await performSpreadsheetSync({
      urlOrId: String(body?.url || body?.spreadsheetId || '').trim(),
      selectedSheets: Array.isArray(body?.selectedSheets) ? body.selectedSheets.map(String) : undefined,
      syncAllSheets: Boolean(body?.syncAllSheets),
      customRange: body?.range ? String(body.range) : undefined,
      headerRowIndex: body?.headerRowIndex,
      config,
      driveStore,
    });
    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleRouteError(res, err, 'Google Sheets synchronization failed.');
  }
}

export async function handleSheetsData(req: NormalizedRequest, res: NormalizedResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const driveStore = createOptionalDriveStore(req, config);
    if (!driveStore) {
      return sendJson(res, 200, { activeSpreadsheet: null, syncHistory: [] });
    }
    const overview = await getPersistedSheetsOverview(driveStore);
    return sendJson(res, 200, overview);
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to fetch saved Google Sheets data from Drive.');
  }
}

// ============================================================
// EMAIL INTEGRATION — GMAIL SMTP & CUSTOM SMTP (NO SIGN-IN)
// ============================================================

export async function handleSmtpConfig(req: NormalizedRequest, res: NormalizedResponse) {
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const sessionId = getSessionId(req);

    if (req.method === 'GET') {
      const driveStore = createOptionalDriveStore(req, config);
      const smtp = await getPublicSmtpConfig({ driveStore, sessionId });
      return sendJson(res, 200, { smtp });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readJsonBody(req);
      const driveStore = createOptionalDriveStore(req, config, body);
      const smtp = await saveSmtpConfig({
        driveStore,
        sessionId,
        config,
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
      const driveStore = createOptionalDriveStore(req, config);
      await deleteSmtpConfig({ driveStore, sessionId });
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
    const sessionId = getSessionId(req);
    const body = await readJsonBody(req);
    const driveStore = createOptionalDriveStore(req, config, body);

    const hasInlineOverride = Boolean(body?.host || body?.username || body?.password);
    const result = await testSmtpConnection({
      driveStore,
      sessionId,
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
    return sendJson(res, 429, { error: 'Rate limit reached for test emails. Please wait a minute.' });
  }

  try {
    const config = getServerConfig(getRequestOrigin(req));
    const sessionId = getSessionId(req);
    const body = await readJsonBody(req);
    const driveStore = createOptionalDriveStore(req, config, body);

    const result = await sendTestEmail({
      driveStore,
      sessionId,
      config,
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
    const sessionId = getSessionId(req);
    const body = await readJsonBody(req);
    const driveStore = createOptionalDriveStore(req, config, body);

    const result = await dispatchSmtpEmails({
      driveStore,
      sessionId,
      config,
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
    const driveStore = createOptionalDriveStore(req, config);
    if (!driveStore) {
      return sendJson(res, 200, { logs: [] });
    }
    const logs = await driveStore.readEmailLogs();
    return sendJson(res, 200, { logs });
  } catch (err: any) {
    return handleRouteError(res, err, 'Failed to load email history from Google Drive.');
  }
}

// ============================================================
// QUOTATIONS & INVOICES CRUD (CONNECTED DRIVE FOLDER)
// ============================================================

export async function handleQuotations(
  req: NormalizedRequest,
  res: NormalizedResponse,
  segments: string[] = []
) {
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readJsonBody(req) : undefined;
    const store = createRequiredDriveStore(req, config, body);
    const [id, action] = segments;

    if (req.method === 'GET' && !id) {
      const quotations = await store.readQuotations();
      return sendJson(res, 200, { quotations });
    }

    if (req.method === 'GET' && id) {
      const quotations = await store.readQuotations();
      const found = quotations.find((q: any) => q.id === id);
      if (!found) return sendJson(res, 404, { error: 'Quotation not found.' });
      return sendJson(res, 200, { quotation: found });
    }

    if (req.method === 'POST' && !id) {
      const quotation = body?.quotation || body;
      if (!quotation?.id) {
        return sendJson(res, 400, { error: 'Quotation object with id is required.' });
      }
      const existing = await store.readQuotations();
      const next = [quotation, ...existing.filter((q: any) => q.id !== quotation.id)];
      await store.writeQuotations(next);
      return sendJson(res, 201, { ok: true, quotation, quotations: next });
    }

    if ((req.method === 'PUT' || req.method === 'PATCH') && id && !action) {
      const updated = body?.quotation || body;
      const existing = await store.readQuotations();
      const next = existing.map((q: any) => (q.id === id ? { ...q, ...updated, id } : q));
      await store.writeQuotations(next);
      return sendJson(res, 200, { ok: true, quotations: next });
    }

    if (req.method === 'POST' && id && (action === 'approve' || action === 'reject')) {
      const existing = await store.readQuotations();
      const target = existing.find((q: any) => q.id === id);
      if (!target) return sendJson(res, 404, { error: 'Quotation not found.' });
      if (target.status === 'Converted to Invoice') {
        return sendJson(res, 400, { error: 'Converted quotations cannot change approval status.' });
      }

      const now = new Date().toISOString();
      const newStatus = action === 'approve' ? 'Approved' : 'Not Approved';
      const entry = {
        status: newStatus,
        timestamp: now,
        actor: String(body?.actor || 'Workspace User').trim(),
        notes: String(body?.notes || body?.reason || '').trim(),
      };

      const next = existing.map((q: any) =>
        q.id === id
          ? {
              ...q,
              status: newStatus,
              approvedAt: action === 'approve' ? now : q.approvedAt,
              approvedBy: action === 'approve' ? entry.actor : q.approvedBy,
              approvalNotes: action === 'approve' ? entry.notes : q.approvalNotes,
              rejectionReason: action === 'reject' ? entry.notes : undefined,
              updatedAt: now,
              approvalHistory: [...(q.approvalHistory || []), entry],
            }
          : q
      );

      await store.writeQuotations(next);
      return sendJson(res, 200, { ok: true, quotation: next.find((q: any) => q.id === id), quotations: next });
    }

    if (req.method === 'POST' && id && action === 'convert-to-invoice') {
      const existingQuotations = await store.readQuotations();
      const quotation = existingQuotations.find((q: any) => q.id === id);
      if (!quotation) return sendJson(res, 404, { error: 'Quotation not found.' });
      if (quotation.status === 'Converted to Invoice' || quotation.convertedInvoiceId) {
        return sendJson(res, 409, {
          error: `Quotation ${quotation.quotationNumber} was already converted to invoice ${quotation.convertedInvoiceNumber || quotation.convertedInvoiceId}.`,
        });
      }
      if (quotation.status !== 'Approved') {
        return sendJson(res, 400, {
          error: 'Only Approved quotations can be converted into an invoice.',
        });
      }

      const invoiceRecord = body?.invoice;
      if (!invoiceRecord?.id || !invoiceRecord?.invoiceNumber) {
        return sendJson(res, 400, { error: 'Converted invoice payload is required.' });
      }

      const existingInvoices = await store.readInvoices();
      const duplicateInvoice = existingInvoices.find(
        (inv: any) =>
          inv.invoiceNumber?.toLowerCase() === invoiceRecord.invoiceNumber.toLowerCase()
      );
      if (duplicateInvoice) {
        return sendJson(res, 409, {
          error: `Invoice number "${invoiceRecord.invoiceNumber}" already exists.`,
        });
      }

      const now = new Date().toISOString();
      const nextInvoices = [invoiceRecord, ...existingInvoices];
      const nextQuotations = existingQuotations.map((q: any) =>
        q.id === id
          ? {
              ...q,
              status: 'Converted to Invoice',
              convertedInvoiceId: invoiceRecord.id,
              convertedInvoiceNumber: invoiceRecord.invoiceNumber,
              convertedAt: now,
              updatedAt: now,
              approvalHistory: [
                ...(q.approvalHistory || []),
                {
                  status: 'Converted to Invoice',
                  timestamp: now,
                  actor: 'Workspace User',
                  notes: `Converted to Invoice ${invoiceRecord.invoiceNumber}`,
                },
              ],
            }
          : q
      );

      await Promise.all([store.writeInvoices(nextInvoices), store.writeQuotations(nextQuotations)]);
      return sendJson(res, 200, {
        ok: true,
        invoice: invoiceRecord,
        quotation: nextQuotations.find((q: any) => q.id === id),
        invoices: nextInvoices,
        quotations: nextQuotations,
      });
    }

    if (req.method === 'DELETE' && id) {
      const existing = await store.readQuotations();
      const next = existing.filter((q: any) => q.id !== id);
      await store.writeQuotations(next);
      return sendJson(res, 200, { ok: true, quotations: next });
    }

    return sendJson(res, 405, { error: 'Unsupported quotation route or method.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Quotation operation failed.');
  }
}

export async function handleInvoices(
  req: NormalizedRequest,
  res: NormalizedResponse,
  segments: string[] = []
) {
  try {
    const config = getServerConfig(getRequestOrigin(req));
    const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readJsonBody(req) : undefined;
    const store = createRequiredDriveStore(req, config, body);
    const [id] = segments;

    if (req.method === 'GET' && !id) {
      const invoices = await store.readInvoices();
      return sendJson(res, 200, { invoices });
    }

    if (req.method === 'POST' && !id) {
      const incoming = Array.isArray(body?.invoices)
        ? body.invoices
        : body?.invoice
          ? [body.invoice]
          : [];
      if (incoming.length === 0) {
        return sendJson(res, 400, { error: 'invoice or invoices array is required.' });
      }
      const existing = await store.readInvoices();
      const incomingIds = new Set(incoming.map((inv: any) => inv.id));
      const next = [...incoming, ...existing.filter((inv: any) => !incomingIds.has(inv.id))];
      await store.writeInvoices(next);
      return sendJson(res, 201, { ok: true, invoices: next });
    }

    if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
      const existing = await store.readInvoices();
      const next = existing.map((inv: any) => (inv.id === id ? { ...inv, ...body, id } : inv));
      await store.writeInvoices(next);
      return sendJson(res, 200, { ok: true, invoices: next });
    }

    if (req.method === 'DELETE' && id) {
      const existing = await store.readInvoices();
      const next = existing.filter((inv: any) => inv.id !== id);
      await store.writeInvoices(next);
      return sendJson(res, 200, { ok: true, invoices: next });
    }

    return sendJson(res, 405, { error: 'Unsupported invoice route or method.' });
  } catch (err: any) {
    return handleRouteError(res, err, 'Invoice operation failed.');
  }
}
