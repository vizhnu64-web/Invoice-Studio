/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppServerConfig,
  getIntegrationDiagnostics,
  getScopesForFeature,
  getServerConfig,
  GoogleOAuthFeature,
  hasDriveScope,
  hasGmailSendScope,
  hasSheetsScope,
} from './config.js';
import { generateRandomId, verifySignedPayload } from './crypto.js';
import {
  defaultDriveTransport,
  DRIVE_ROOT_FOLDER_NAME,
  DRIVE_SUBFOLDER_KEYS,
  DriveTransportAdapter,
} from './driveService.js';
import { GoogleDriveStore } from './driveStore.js';
import {
  defaultEmailTransport,
  dispatchUserEmails,
  EmailTransportAdapter,
  parseAndValidateEmailList,
  saveUserSmtpConfig,
  testUserSmtpConnection,
  toPublicSmtpConfig,
} from './emailBackendService.js';
import {
  assertGoogleOAuthConfig,
  buildGoogleAuthorizeUrl,
  completeOAuthCodeExchange,
  defaultGoogleTransport,
  ensureFreshAccessToken,
  GoogleTransportAdapter,
  HttpApiError,
  normalizeOAuthFeature,
  performSpreadsheetSync,
  runWithSessionTokenRetry,
  stripFeatureScopeFromSession,
  validateAndFetchSpreadsheetMetadata,
} from './googleService.js';
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  EncryptedSessionData,
  getQueryParam,
  getRequestCookies,
  getRequestOrigin,
  NormalizedRequest,
  NormalizedResponse,
  OAUTH_STATE_COOKIE_NAME,
  readEncryptedSessionFromRequest,
  readJsonBody,
  sendJson,
  sendRedirect,
  setEncryptedSessionCookie,
  setOAuthStateCookie,
} from './http.js';
import {
  buildSheetRange,
  extractSpreadsheetId,
  normalizeSheetValues,
} from './sheetsNormalization.js';

export interface HandlerRuntimeDeps {
  getConfig?: (req: NormalizedRequest) => AppServerConfig;
  transport?: GoogleTransportAdapter;
  driveTransport?: DriveTransportAdapter;
  emailTransport?: EmailTransportAdapter;
}

function resolveDeps(req: NormalizedRequest, deps?: HandlerRuntimeDeps) {
  const origin = getRequestOrigin(req);
  const config = deps?.getConfig ? deps.getConfig(req) : getServerConfig(origin);
  const transport = deps?.transport || defaultGoogleTransport;
  const driveTransport = deps?.driveTransport || defaultDriveTransport;
  const emailTransport = deps?.emailTransport || defaultEmailTransport;
  return { config, transport, driveTransport, emailTransport, origin };
}

function handleApiError(res: NormalizedResponse, err: any, fallbackMessage: string) {
  if (err instanceof HttpApiError) {
    return sendJson(res, err.statusCode, {
      error: err.message,
      code: err.code,
      requiresReauth: err.requiresReauth,
    });
  }
  const msg = err?.message || fallbackMessage;
  if (/Forbidden:/i.test(msg)) {
    return sendJson(res, 403, { error: msg, code: 'FORBIDDEN' });
  }
  if (/Invalid Google Sheets URL|Invalid A1 range|cannot be blank/i.test(msg)) {
    return sendJson(res, 400, { error: msg, code: 'VALIDATION_ERROR' });
  }
  console.error('[API Error]', msg);
  return sendJson(res, 500, {
    error: msg || fallbackMessage,
    code: 'INTERNAL_SERVER_ERROR',
  });
}

/**
 * Resolves the verified authenticated user from the encrypted HttpOnly session cookie.
 * Never trusts userId from query params or request body.
 */
export function requireAuthenticatedSession(
  req: NormalizedRequest,
  config: AppServerConfig
): EncryptedSessionData {
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    throw new HttpApiError(
      503,
      'SESSION_SECRET_UNCONFIGURED',
      'Server SESSION_SECRET is not configured.'
    );
  }
  if (!config.tokenEncryptionKey || config.tokenEncryptionKey.length < 16) {
    throw new HttpApiError(
      503,
      'ENCRYPTION_KEY_UNCONFIGURED',
      'Server TOKEN_ENCRYPTION_KEY is not configured.'
    );
  }
  const session = readEncryptedSessionFromRequest(req, config);
  if (!session) {
    throw new HttpApiError(
      401,
      'NOT_AUTHENTICATED',
      'Please sign in with your Google Account to continue.',
      true
    );
  }
  return session;
}

/**
 * Resolves an authenticated user's GoogleDriveStore using a guaranteed-fresh Google OAuth access token.
 * Automatically persists refreshed tokens & cached Drive folder ID into the encrypted HttpOnly cookie.
 */
async function createUserDriveContext(params: {
  req: NormalizedRequest;
  res: NormalizedResponse;
  config: AppServerConfig;
  transport: GoogleTransportAdapter;
  driveTransport: DriveTransportAdapter;
  requireDrive?: boolean;
}): Promise<{
  session: EncryptedSessionData;
  driveStore: GoogleDriveStore;
  persistSessionIfChanged: (updated?: EncryptedSessionData) => void;
}> {
  const initialSession = requireAuthenticatedSession(params.req, params.config);
  const { accessToken, session, refreshed } = await ensureFreshAccessToken({
    session: initialSession,
    requiredFeature: params.requireDrive !== false ? 'drive' : undefined,
    config: params.config,
    transport: params.transport,
  });

  let latestSession = session;
  let dirty = refreshed;

  const driveStore = new GoogleDriveStore({
    userId: session.uid,
    accessToken,
    config: params.config,
    driveRootFolderIdHint: session.df || null,
    driveTransport: params.driveTransport,
  });

  const persistSessionIfChanged = (updated?: EncryptedSessionData) => {
    if (updated) {
      latestSession = updated;
      dirty = true;
    }
    const discoveredRoot = driveStore.getRootFolderId();
    if (discoveredRoot && discoveredRoot !== latestSession.df) {
      latestSession = { ...latestSession, df: discoveredRoot };
      dirty = true;
    }
    if (dirty) {
      setEncryptedSessionCookie(params.req, params.res, latestSession, params.config);
      dirty = false;
    }
  };

  return { session: latestSession, driveStore, persistSessionIfChanged };
}

function buildPublicUserProfile(
  session: EncryptedSessionData,
  options?: {
    onboardingCompleted?: boolean;
    smtpConfigured?: boolean;
    driveLastSyncAt?: string | null;
    driveSyncStatus?: string | null;
  }
) {
  const scopes = session.sc.split(/\s+/).filter(Boolean);
  return {
    userId: session.uid,
    email: session.em,
    name: session.nm,
    picture: session.pic,
    createdAt: session.cat || new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    onboardingCompleted: options?.onboardingCompleted ?? false,
    driveConnected: hasDriveScope(scopes),
    sheetsConnected: hasSheetsScope(scopes),
    gmailConnected: hasGmailSendScope(scopes),
    smtpConfigured: options?.smtpConfigured ?? false,
    driveRootFolderId: session.df || null,
    driveLastSyncAt: options?.driveLastSyncAt ?? null,
    driveSyncStatus: options?.driveSyncStatus ?? (hasDriveScope(scopes) ? 'synced' : null),
  };
}

export async function handleHealth(
  req: NormalizedRequest,
  res: NormalizedResponse,
  _deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const origin = getRequestOrigin(req);
  const diagnostics = getIntegrationDiagnostics(origin);
  return sendJson(res, 200, {
    ok: true,
    ...diagnostics,
  });
}

// ============================================================================
// AUTH HANDLERS (Single Server-Side Google OAuth 2.0 + Encrypted HttpOnly Session)
// ============================================================================

export async function handleGoogleAuthStart(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { config, origin } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);

    let featureRaw = getQueryParam(req, 'feature');
    let returnTo = getQueryParam(req, 'returnTo') || '';
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!featureRaw && body?.feature) featureRaw = String(body.feature);
      if (!returnTo && body?.returnTo) returnTo = String(body.returnTo);
    }
    const feature: GoogleOAuthFeature = normalizeOAuthFeature(featureRaw);

    const existingSession = readEncryptedSessionFromRequest(req, config);
    const existingScopes = existingSession ? existingSession.sc.split(/\s+/).filter(Boolean) : [];

    const nonce = generateRandomId(16);
    const state = setOAuthStateCookie(
      req,
      res,
      { nonce, feature, returnTo },
      config.sessionSecret
    );

    const authUrl = buildGoogleAuthorizeUrl(config, state, feature, existingScopes);
    const shouldRedirect = getQueryParam(req, 'redirect') === '1';

    if (shouldRedirect) {
      return sendRedirect(res, authUrl);
    }

    return sendJson(res, 200, {
      authUrl,
      state,
      feature,
      clientId: config.googleClientId,
      scopes: getScopesForFeature(feature, existingScopes),
      redirectUri: config.googleRedirectUri || `${origin || ''}/api/auth/google/callback`,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to initialize Google authentication.');
  }
}

export async function handleGoogleAuthCallback(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  const { config, transport, driveTransport } = resolveDeps(req, deps);

  // 1. GIS Popup / Direct POST authorization-code flow
  if (req.method === 'POST') {
    try {
      assertGoogleOAuthConfig(config);
      const body = await readJsonBody(req);
      const code = String(body?.code || '').trim();
      const providedState = String(body?.state || '').trim();
      const redirectUri = String(body?.redirectUri || 'postmessage').trim() || 'postmessage';

      if (!code) {
        throw new HttpApiError(400, 'MISSING_AUTH_CODE', 'Google authorization code is required.');
      }

      const cookies = getRequestCookies(req);
      const stateCookie = cookies[OAUTH_STATE_COOKIE_NAME];
      const verifiedCookieState = verifySignedPayload<{
        nonce: string;
        feature?: GoogleOAuthFeature;
      }>(stateCookie, config.sessionSecret);
      const verifiedParamState = verifySignedPayload<{
        nonce: string;
        feature?: GoogleOAuthFeature;
      }>(providedState, config.sessionSecret);

      if (
        !verifiedCookieState ||
        !verifiedParamState ||
        verifiedCookieState.nonce !== verifiedParamState.nonce ||
        providedState !== stateCookie
      ) {
        throw new HttpApiError(
          403,
          'INVALID_OAUTH_STATE',
          'OAuth security state verification failed or expired. Please click Continue with Google again.'
        );
      }

      const existingSession = readEncryptedSessionFromRequest(req, config);
      const feature = normalizeOAuthFeature(body?.feature || verifiedCookieState.feature);
      const result = await completeOAuthCodeExchange({
        code,
        redirectUri,
        feature,
        existingSession,
        config,
        transport,
      });

      let finalSession = result.session;
      let smtpConfigured = false;
      let onboardingCompleted = false;
      let driveLastSyncAt: string | null = null;
      let driveSyncStatus: string | null = null;

      // Initialize the user's private Google Drive folder structure immediately if Drive scope is granted
      if (hasDriveScope(result.scopes) && finalSession.at) {
        try {
          const driveStore = new GoogleDriveStore({
            userId: finalSession.uid,
            accessToken: finalSession.at,
            config,
            driveRootFolderIdHint: finalSession.df || null,
            driveTransport,
          });
          const folders = await driveStore.ensureFolders();
          finalSession = { ...finalSession, df: folders.rootFolderId };
          const [ws, smtp] = await Promise.all([
            driveStore.getWorkspaceState().catch(() => null),
            driveStore.getSmtpConfig().catch(() => null),
          ]);
          onboardingCompleted = Boolean(ws?.onboardingCompleted);
          driveLastSyncAt = ws?.driveLastSyncAt || null;
          driveSyncStatus = ws?.driveSyncStatus || 'synced';
          smtpConfigured = Boolean(smtp?.host && smtp?.senderEmail);
        } catch {
          // Non-fatal during sign-in; user can retry Drive sync in Account Settings
        }
      }

      clearOAuthStateCookie(req, res);
      setEncryptedSessionCookie(req, res, finalSession, config);

      return sendJson(res, 200, {
        authenticated: true,
        feature,
        user: buildPublicUserProfile(finalSession, {
          onboardingCompleted,
          smtpConfigured,
          driveLastSyncAt,
          driveSyncStatus,
        }),
        scopes: result.scopes,
      });
    } catch (err: any) {
      return handleApiError(res, err, 'Failed to complete Google sign-in.');
    }
  }

  // 2. Standard Server Redirect OAuth 2.0 Callback
  if (req.method === 'GET') {
    const appBase = config.appUrl.replace(/\/+$/, '');
    try {
      assertGoogleOAuthConfig(config);
      const oauthError = getQueryParam(req, 'error');
      const cookies = getRequestCookies(req);
      const stateCookie = cookies[OAUTH_STATE_COOKIE_NAME];
      const verifiedCookieState = verifySignedPayload<{
        nonce: string;
        feature?: GoogleOAuthFeature;
        returnTo?: string;
      }>(stateCookie, config.sessionSecret);

      const fallbackHash =
        verifiedCookieState?.returnTo ||
        (verifiedCookieState?.feature === 'sheets'
          ? 'datasource'
          : verifiedCookieState?.feature === 'gmail'
          ? 'email'
          : verifiedCookieState?.feature === 'drive'
          ? 'integrations'
          : 'dashboard');

      if (oauthError) {
        clearOAuthStateCookie(req, res);
        return sendRedirect(
          res,
          `${appBase}/#/${fallbackHash}?google_auth=error&message=${encodeURIComponent(
            oauthError === 'access_denied'
              ? 'Google authorization was cancelled or denied.'
              : `Google OAuth error: ${oauthError}`
          )}`
        );
      }

      const code = getQueryParam(req, 'code');
      const stateParam = getQueryParam(req, 'state');
      const verifiedParamState = verifySignedPayload<{
        nonce: string;
        feature?: GoogleOAuthFeature;
      }>(stateParam, config.sessionSecret);

      if (
        !code ||
        !verifiedCookieState ||
        !verifiedParamState ||
        verifiedCookieState.nonce !== verifiedParamState.nonce ||
        stateParam !== stateCookie
      ) {
        clearOAuthStateCookie(req, res);
        return sendRedirect(
          res,
          `${appBase}/#/${fallbackHash}?google_auth=error&message=${encodeURIComponent(
            'Invalid or expired OAuth state. Please try connecting again.'
          )}`
        );
      }

      const existingSession = readEncryptedSessionFromRequest(req, config);
      const feature = normalizeOAuthFeature(verifiedCookieState.feature);
      const result = await completeOAuthCodeExchange({
        code,
        redirectUri: config.googleRedirectUri,
        feature,
        existingSession,
        config,
        transport,
      });

      let finalSession = result.session;
      if (hasDriveScope(result.scopes) && finalSession.at) {
        try {
          const driveStore = new GoogleDriveStore({
            userId: finalSession.uid,
            accessToken: finalSession.at,
            config,
            driveRootFolderIdHint: finalSession.df || null,
            driveTransport,
          });
          const folders = await driveStore.ensureFolders();
          finalSession = { ...finalSession, df: folders.rootFolderId };
        } catch {
          // Non-fatal during redirect callback
        }
      }

      clearOAuthStateCookie(req, res);
      setEncryptedSessionCookie(req, res, finalSession, config);
      return sendRedirect(
        res,
        `${appBase}/#/${fallbackHash}?google_auth=success&feature=${encodeURIComponent(feature)}`
      );
    } catch (err: any) {
      clearOAuthStateCookie(req, res);
      return sendRedirect(
        res,
        `${appBase}/#/integrations?google_auth=error&message=${encodeURIComponent(
          err?.message || 'Google OAuth callback failed.'
        )}`
      );
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}

export async function handleAuthStatus(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const { config, origin, transport, driveTransport } = resolveDeps(req, deps);
  const diagnostics = getIntegrationDiagnostics(origin);

  try {
    const session = readEncryptedSessionFromRequest(req, config);
    if (!session) {
      return sendJson(res, 200, {
        authenticated: false,
        user: null,
        scopes: [],
        diagnostics,
      });
    }

    const scopes = session.sc.split(/\s+/).filter(Boolean);
    let smtpConfigured = false;
    let onboardingCompleted = false;
    let driveLastSyncAt: string | null = null;
    let driveSyncStatus: string | null = null;

    if (hasDriveScope(scopes)) {
      try {
        const refreshed = await ensureFreshAccessToken({
          session,
          requiredFeature: 'drive',
          config,
          transport,
        });
        if (refreshed.refreshed) {
          setEncryptedSessionCookie(req, res, refreshed.session, config);
        }
        const driveStore = new GoogleDriveStore({
          userId: refreshed.session.uid,
          accessToken: refreshed.accessToken,
          config,
          driveRootFolderIdHint: refreshed.session.df || null,
          driveTransport,
        });
        const [ws, smtp] = await Promise.all([
          driveStore.getWorkspaceState().catch(() => null),
          driveStore.getSmtpConfig().catch(() => null),
        ]);
        onboardingCompleted = Boolean(ws?.onboardingCompleted);
        driveLastSyncAt = ws?.driveLastSyncAt || null;
        driveSyncStatus = ws?.driveSyncStatus || 'synced';
        smtpConfigured = Boolean(smtp?.host && smtp?.senderEmail);
      } catch {
        // Keep auth status responsive even if Drive call temporarily fails
      }
    }

    return sendJson(res, 200, {
      authenticated: true,
      user: buildPublicUserProfile(session, {
        onboardingCompleted,
        smtpConfigured,
        driveLastSyncAt,
        driveSyncStatus,
      }),
      scopes,
      hasRefreshToken: Boolean(session.rt),
      connectedAt: session.cat || null,
      diagnostics,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to check Google authentication status.');
  }
}

export async function handleAuthDisconnect(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { config, transport } = resolveDeps(req, deps);
    const body = await readJsonBody(req);
    const featureRaw = String(body?.feature || 'all').toLowerCase();
    const feature: 'all' | 'drive' | 'sheets' | 'gmail' =
      featureRaw === 'drive' || featureRaw === 'sheets' || featureRaw === 'gmail'
        ? featureRaw
        : 'all';

    const session = readEncryptedSessionFromRequest(req, config);

    if (feature !== 'all' && session) {
      const updated = stripFeatureScopeFromSession(session, feature);
      setEncryptedSessionCookie(req, res, updated, config);
      return sendJson(res, 200, {
        disconnected: true,
        feature,
        signedOut: false,
      });
    }

    // Full sign-out: revoke Google token best-effort and clear all session cookies
    if (session) {
      const tokenToRevoke = session.rt || session.at;
      if (tokenToRevoke) {
        await transport.revokeToken(tokenToRevoke).catch(() => {});
      }
    }

    clearOAuthStateCookie(req, res);
    clearSessionCookie(req, res);

    return sendJson(res, 200, {
      disconnected: true,
      feature: 'all',
      signedOut: true,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to disconnect Google integration.');
  }
}

// ============================================================================
// WORKSPACE, ONBOARDING & CUSTOMERS HANDLER (Google Drive Persistence)
// ============================================================================

export async function handleWorkspace(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { session, driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });

    if (req.method === 'GET') {
      const [workspace, customers, quotations, invoices, smtp, emailLogs] = await Promise.all([
        driveStore.getWorkspaceState(),
        driveStore.listCustomers(),
        driveStore.listQuotations(),
        driveStore.listInvoices(),
        driveStore.getSmtpConfig(),
        driveStore.listEmailLogs(100),
      ]);
      persistSessionIfChanged();

      return sendJson(res, 200, {
        userId: session.uid,
        onboardingCompleted: Boolean(workspace?.onboardingCompleted),
        workspace,
        customers: customers.map((c) => c.data),
        quotations: quotations.map((q) => q.data),
        invoices: invoices.map((i) => i.data),
        smtpConfig: toPublicSmtpConfig(smtp),
        emailLogs,
      });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJsonBody(req);

      if (body?.customer && body.customer.id) {
        const savedCust = await driveStore.upsertCustomer(String(body.customer.id), body.customer);
        persistSessionIfChanged();
        return sendJson(res, 200, { customer: savedCust.data });
      }

      if (body?.deleteCustomerId) {
        const deleted = await driveStore.deleteCustomer(String(body.deleteCustomerId));
        persistSessionIfChanged();
        return sendJson(res, 200, { deleted });
      }

      if (
        body?.onboardingCompleted !== undefined ||
        body?.companySettings !== undefined ||
        body?.template !== undefined ||
        body?.fields !== undefined ||
        body?.calculationSettings !== undefined ||
        body?.preferences !== undefined
      ) {
        const saved = await driveStore.upsertWorkspaceState({
          onboardingCompleted: body.onboardingCompleted,
          companySettings: body.companySettings,
          template: body.template,
          fields: body.fields,
          calculationSettings: body.calculationSettings,
          preferences: body.preferences,
          expectedVersion:
            typeof body?.expectedVersion === 'number' ? body.expectedVersion : undefined,
        });
        persistSessionIfChanged();
        return sendJson(res, 200, { workspace: saved, onboardingCompleted: saved.onboardingCompleted });
      }

      persistSessionIfChanged();
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process workspace request.');
  }
}

// ============================================================================
// QUOTATIONS HANDLER (Strict Per-User Google Drive Ownership + Approval Gate)
// ============================================================================

export async function handleQuotations(
  req: NormalizedRequest,
  res: NormalizedResponse,
  segments: string[],
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { session, driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });

    const [idParam, actionParam] = segments;

    if (!idParam) {
      if (req.method === 'GET') {
        const list = await driveStore.listQuotations();
        persistSessionIfChanged();
        return sendJson(res, 200, { quotations: list.map((q) => q.data) });
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const q = body?.quotation || body;
        if (!q || !q.id || !q.quotationNumber) {
          throw new HttpApiError(400, 'INVALID_QUOTATION', 'Quotation id and quotationNumber are required.');
        }
        const saved = await driveStore.upsertQuotation({
          id: String(q.id),
          quotationNumber: String(q.quotationNumber),
          status: String(q.status || 'Draft'),
          customerName: String(q.customerName || q.data?.customerName || ''),
          totalAmount: Number(q.totalAmount || 0),
          validUntil: String(q.validUntilDate || q.data?.validUntilDate || ''),
          convertedInvoiceId: q.convertedInvoiceId || null,
          convertedInvoiceNumber: q.convertedInvoiceNumber || null,
          convertedAt: q.convertedAt || null,
          driveFileId: q.driveFileId || null,
          pdfDriveFileId: q.pdfDriveFileId || null,
          data: { ...q, ownerUserId: session.uid },
        });
        persistSessionIfChanged();
        return sendJson(res, 200, { quotation: saved.data });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (actionParam === 'status') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const existing = await driveStore.getQuotation(idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in your Google Drive workspace.');
      }
      if (existing.status === 'Converted to Invoice') {
        throw new HttpApiError(
          409,
          'QUOTATION_ALREADY_CONVERTED',
          'Converted quotations are immutable and cannot change approval status.'
        );
      }

      const body = await readJsonBody(req);
      const nextStatus = String(body?.status || '').trim();
      const allowedStatuses = ['Draft', 'Pending Approval', 'Approved', 'Not Approved', 'Expired'];
      if (!allowedStatuses.includes(nextStatus)) {
        throw new HttpApiError(400, 'INVALID_STATUS', `Unsupported quotation status "${nextStatus}".`);
      }

      const nowIso = new Date().toISOString();
      const actorName = session.nm || session.em;
      const historyEntry = {
        id: `qhist_${Date.now()}_${generateRandomId(5)}`,
        status: nextStatus,
        previousStatus: existing.status,
        timestamp: nowIso,
        actorName,
        actorEmail: session.em,
        notes: body?.notes ? String(body.notes) : undefined,
        rejectionReason: body?.rejectionReason ? String(body.rejectionReason) : undefined,
      };

      const prevData = existing.data || {};
      const updatedData = {
        ...prevData,
        status: nextStatus,
        approvedAt: nextStatus === 'Approved' ? nowIso : prevData.approvedAt,
        approvedBy: nextStatus === 'Approved' ? actorName : prevData.approvedBy,
        approvalNotes: nextStatus === 'Approved' ? (body?.notes || prevData.approvalNotes) : prevData.approvalNotes,
        rejectionReason: nextStatus === 'Not Approved' ? (body?.rejectionReason || '') : prevData.rejectionReason,
        approvalHistory: [historyEntry, ...(Array.isArray(prevData.approvalHistory) ? prevData.approvalHistory : [])],
        updatedAt: nowIso,
      };

      const saved = await driveStore.upsertQuotation({
        id: existing.id,
        quotationNumber: existing.quotationNumber,
        status: nextStatus,
        customerName: existing.customerName,
        totalAmount: existing.totalAmount,
        validUntil: existing.validUntil,
        convertedInvoiceId: existing.convertedInvoiceId,
        convertedInvoiceNumber: existing.convertedInvoiceNumber,
        convertedAt: existing.convertedAt,
        driveFileId: existing.driveFileId,
        pdfDriveFileId: existing.pdfDriveFileId,
        data: updatedData,
      });
      persistSessionIfChanged();
      return sendJson(res, 200, { quotation: saved.data });
    }

    if (actionParam === 'convert') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const existing = await driveStore.getQuotation(idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in your Google Drive workspace.');
      }

      if (existing.convertedInvoiceId || existing.status === 'Converted to Invoice') {
        throw new HttpApiError(
          409,
          'ALREADY_CONVERTED',
          `Quotation ${existing.quotationNumber} has already been converted to invoice ${existing.convertedInvoiceNumber || existing.convertedInvoiceId}. Duplicate conversion is not allowed.`
        );
      }

      if (existing.status !== 'Approved') {
        throw new HttpApiError(
          403,
          'APPROVAL_REQUIRED_FOR_CONVERSION',
          `Only Approved quotations can be converted to invoices. Current status is "${existing.status}".`
        );
      }

      const body = await readJsonBody(req);
      const invoiceRecord = body?.invoice;
      if (!invoiceRecord || !invoiceRecord.id || !invoiceRecord.invoiceNumber) {
        throw new HttpApiError(
          400,
          'INVALID_INVOICE_PAYLOAD',
          'Converted invoice payload with id and invoiceNumber is required.'
        );
      }

      const nowIso = new Date().toISOString();
      const normalizedInvoice = {
        ...invoiceRecord,
        paymentStatus: 'Unpaid',
        paymentAmount: 0,
        sourceQuotationId: existing.id,
        sourceQuotationNumber: existing.quotationNumber,
        updatedAt: nowIso,
      };

      const savedInvoice = await driveStore.upsertInvoice({
        id: String(normalizedInvoice.id),
        invoiceNumber: String(normalizedInvoice.invoiceNumber),
        sourceType: String(normalizedInvoice.sourceType || 'manual'),
        sourceQuotationId: existing.id,
        sourceQuotationNumber: existing.quotationNumber,
        customerName: String(normalizedInvoice.customerName || existing.customerName),
        totalAmount: Number(normalizedInvoice.totalAmount || existing.totalAmount),
        paymentStatus: 'Unpaid',
        driveFileId: null,
        pdfDriveFileId: null,
        data: normalizedInvoice,
      });

      const prevData = existing.data || {};
      const actorName = session.nm || session.em;
      const conversionHistoryEntry = {
        id: `qhist_${Date.now()}_${generateRandomId(5)}`,
        status: 'Converted to Invoice',
        previousStatus: 'Approved',
        timestamp: nowIso,
        actorName,
        actorEmail: session.em,
        notes: `Converted to Invoice ${savedInvoice.invoiceNumber}`,
      };

      const updatedQuotationData = {
        ...prevData,
        status: 'Converted to Invoice',
        convertedInvoiceId: savedInvoice.id,
        convertedInvoiceNumber: savedInvoice.invoiceNumber,
        convertedAt: nowIso,
        approvalHistory: [
          conversionHistoryEntry,
          ...(Array.isArray(prevData.approvalHistory) ? prevData.approvalHistory : []),
        ],
        updatedAt: nowIso,
      };

      const savedQuotation = await driveStore.upsertQuotation({
        id: existing.id,
        quotationNumber: existing.quotationNumber,
        status: 'Converted to Invoice',
        customerName: existing.customerName,
        totalAmount: existing.totalAmount,
        validUntil: existing.validUntil,
        convertedInvoiceId: savedInvoice.id,
        convertedInvoiceNumber: savedInvoice.invoiceNumber,
        convertedAt: nowIso,
        driveFileId: existing.driveFileId,
        pdfDriveFileId: existing.pdfDriveFileId,
        data: updatedQuotationData,
      });
      persistSessionIfChanged();

      return sendJson(res, 200, {
        quotation: savedQuotation.data,
        invoice: savedInvoice.data,
      });
    }

    if (req.method === 'GET') {
      const existing = await driveStore.getQuotation(idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in your Google Drive workspace.');
      }
      persistSessionIfChanged();
      return sendJson(res, 200, { quotation: existing.data });
    }

    if (req.method === 'PUT') {
      const existing = await driveStore.getQuotation(idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in your Google Drive workspace.');
      }
      if (existing.status === 'Converted to Invoice') {
        throw new HttpApiError(
          409,
          'QUOTATION_IMMUTABLE',
          'Converted quotations are preserved as immutable records and cannot be edited.'
        );
      }
      const body = await readJsonBody(req);
      const q = body?.quotation || body;
      const saved = await driveStore.upsertQuotation({
        id: idParam,
        quotationNumber: String(q.quotationNumber || existing.quotationNumber),
        status: String(q.status || existing.status),
        customerName: String(q.customerName || existing.customerName),
        totalAmount: Number(q.totalAmount ?? existing.totalAmount),
        validUntil: String(q.validUntilDate || existing.validUntil),
        convertedInvoiceId: existing.convertedInvoiceId,
        convertedInvoiceNumber: existing.convertedInvoiceNumber,
        convertedAt: existing.convertedAt,
        driveFileId: q.driveFileId ?? existing.driveFileId,
        pdfDriveFileId: q.pdfDriveFileId ?? existing.pdfDriveFileId,
        data: { ...q, id: idParam, ownerUserId: session.uid },
      });
      persistSessionIfChanged();
      return sendJson(res, 200, { quotation: saved.data });
    }

    if (req.method === 'DELETE') {
      const deleted = await driveStore.deleteQuotation(idParam);
      if (!deleted) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found in your Google Drive workspace.');
      }
      persistSessionIfChanged();
      return sendJson(res, 200, { deleted: true, id: idParam });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process quotation request.');
  }
}

// ============================================================================
// INVOICES HANDLER (Strict Per-User Google Drive Ownership)
// ============================================================================

export async function handleInvoices(
  req: NormalizedRequest,
  res: NormalizedResponse,
  segments: string[],
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const [idParam] = segments;

    if (!idParam) {
      if (req.method === 'GET') {
        const list = await driveStore.listInvoices();
        persistSessionIfChanged();
        return sendJson(res, 200, { invoices: list.map((i) => i.data) });
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const inv = body?.invoice || body;
        if (!inv || !inv.id || !inv.invoiceNumber) {
          throw new HttpApiError(400, 'INVALID_INVOICE', 'Invoice id and invoiceNumber are required.');
        }
        const saved = await driveStore.upsertInvoice({
          id: String(inv.id),
          invoiceNumber: String(inv.invoiceNumber),
          sourceType: String(inv.sourceType || 'manual'),
          sourceQuotationId: inv.sourceQuotationId || null,
          sourceQuotationNumber: inv.sourceQuotationNumber || null,
          customerName: String(inv.customerName || ''),
          totalAmount: Number(inv.totalAmount || 0),
          paymentStatus: String(inv.paymentStatus || 'Unpaid'),
          driveFileId: inv.driveFileId || null,
          pdfDriveFileId: inv.pdfDriveFileId || null,
          data: inv,
        });
        persistSessionIfChanged();
        return sendJson(res, 200, { invoice: saved.data });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (req.method === 'GET') {
      const existing = await driveStore.getInvoice(idParam);
      if (!existing) {
        throw new HttpApiError(404, 'INVOICE_NOT_FOUND', 'Invoice not found in your Google Drive workspace.');
      }
      persistSessionIfChanged();
      return sendJson(res, 200, { invoice: existing.data });
    }

    if (req.method === 'PUT') {
      const existing = await driveStore.getInvoice(idParam);
      if (!existing) {
        throw new HttpApiError(404, 'INVOICE_NOT_FOUND', 'Invoice not found in your Google Drive workspace.');
      }
      const body = await readJsonBody(req);
      const inv = body?.invoice || body;
      const saved = await driveStore.upsertInvoice({
        id: idParam,
        invoiceNumber: String(inv.invoiceNumber || existing.invoiceNumber),
        sourceType: String(inv.sourceType || existing.sourceType),
        sourceQuotationId: existing.sourceQuotationId,
        sourceQuotationNumber: existing.sourceQuotationNumber,
        customerName: String(inv.customerName || existing.customerName),
        totalAmount: Number(inv.totalAmount ?? existing.totalAmount),
        paymentStatus: String(inv.paymentStatus || existing.paymentStatus),
        driveFileId: inv.driveFileId ?? existing.driveFileId,
        pdfDriveFileId: inv.pdfDriveFileId ?? existing.pdfDriveFileId,
        data: { ...inv, id: idParam },
      });
      persistSessionIfChanged();
      return sendJson(res, 200, { invoice: saved.data });
    }

    if (req.method === 'DELETE') {
      const deleted = await driveStore.deleteInvoice(idParam);
      if (!deleted) {
        throw new HttpApiError(404, 'INVOICE_NOT_FOUND', 'Invoice not found in your Google Drive workspace.');
      }
      persistSessionIfChanged();
      return sendJson(res, 200, { deleted: true, id: idParam });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process invoice request.');
  }
}

// ============================================================================
// GOOGLE DRIVE STORAGE HANDLERS (Sole Persistent Storage)
// ============================================================================

export async function handleDriveStatus(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const session = requireAuthenticatedSession(req, config);
    const scopes = session.sc.split(/\s+/).filter(Boolean);
    const connected = hasDriveScope(scopes);

    if (!connected) {
      return sendJson(res, 200, {
        connected: false,
        rootFolderName: DRIVE_ROOT_FOLDER_NAME,
        rootFolderId: null,
        subfolders: {},
        subfolderNames: DRIVE_SUBFOLDER_KEYS,
        lastSyncAt: null,
        syncStatus: 'disconnected',
        lastError: null,
        trackedFilesCount: 0,
      });
    }

    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const folders = await driveStore.ensureFolders();
    const [ws, customers, quotations, invoices, emailLogs] = await Promise.all([
      driveStore.getWorkspaceState().catch(() => null),
      driveStore.listCustomers().catch(() => []),
      driveStore.listQuotations().catch(() => []),
      driveStore.listInvoices().catch(() => []),
      driveStore.listEmailLogs(50).catch(() => []),
    ]);
    persistSessionIfChanged();

    return sendJson(res, 200, {
      connected: true,
      rootFolderName: DRIVE_ROOT_FOLDER_NAME,
      rootFolderId: folders.rootFolderId,
      subfolders: folders.subfolders,
      subfolderNames: DRIVE_SUBFOLDER_KEYS,
      lastSyncAt: ws?.driveLastSyncAt || ws?.updatedAt || null,
      syncStatus: ws?.driveSyncStatus || 'synced',
      lastError: ws?.driveLastError || null,
      trackedFilesCount:
        (ws ? 1 : 0) +
        (customers.length > 0 ? 1 : 0) +
        (quotations.length > 0 ? 1 : 0) +
        (invoices.length > 0 ? 1 : 0) +
        (emailLogs.length > 0 ? 1 : 0),
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to check Google Drive status.');
  }
}

export async function handleDriveSync(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const body = await readJsonBody(req);
    const snapshot =
      body && Object.keys(body).length > 0
        ? {
            companySettings: body.companySettings,
            template: body.template,
            fields: body.fields,
            calculationSettings: body.calculationSettings,
            preferences: body.preferences,
            customers: Array.isArray(body.customers) ? body.customers : undefined,
            quotations: Array.isArray(body.quotations) ? body.quotations : undefined,
            invoices: Array.isArray(body.invoices) ? body.invoices : undefined,
          }
        : undefined;

    const summary = await driveStore.syncFullWorkspaceSnapshot(snapshot);
    persistSessionIfChanged();

    return sendJson(res, 200, { ok: true, ...summary });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to synchronize workspace with Google Drive.');
  }
}

export async function handleDriveUploadPdf(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const body = await readJsonBody(req);

    const documentType = body?.documentType === 'quotation' ? 'quotation' : 'invoice';
    const documentId = String(body?.documentId || '').trim();
    const fileName = String(body?.fileName || `${documentType}-${documentId}.pdf`).trim();
    const pdfBase64 = String(body?.pdfBase64 || '').trim();

    if (!documentId || !pdfBase64) {
      throw new HttpApiError(400, 'INVALID_UPLOAD_PAYLOAD', 'documentId and pdfBase64 are required.');
    }

    const result = await driveStore.uploadPdf({
      documentType,
      documentId,
      fileName,
      pdfBase64,
    });
    persistSessionIfChanged();

    return sendJson(res, 200, { ok: true, ...result });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to upload PDF to Google Drive.');
  }
}

export async function handleDriveRestore(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });

    const summary = await driveStore.restoreFromDrive();
    persistSessionIfChanged();

    return sendJson(res, 200, { ok: true, ...summary });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to restore workspace from Google Drive.');
  }
}

export async function handleDriveBackup(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });

    const result = await driveStore.createBackup();
    persistSessionIfChanged();

    return sendJson(res, 200, { ok: true, ...result });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to create Google Drive backup.');
  }
}

// ============================================================================
// GOOGLE SHEETS HANDLERS (URL-Based Import + Per-User Google Drive Metadata)
// ============================================================================

export async function handleSheetsMetadata(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { config, transport } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);
    const session = requireAuthenticatedSession(req, config);

    let spreadsheetUrl = getQueryParam(req, 'spreadsheetUrl') || getQueryParam(req, 'url');
    if (!spreadsheetUrl && req.method === 'POST') {
      const body = await readJsonBody(req);
      spreadsheetUrl = String(body?.spreadsheetUrl || body?.url || '');
    }

    const metadata = await validateAndFetchSpreadsheetMetadata({
      session,
      spreadsheetUrl,
      config,
      transport,
      onSessionUpdated: (next) => setEncryptedSessionCookie(req, res, next, config),
    });

    return sendJson(res, 200, metadata);
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to validate spreadsheet metadata.');
  }
}

export async function handleSheetsValues(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { config, transport } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);
    const session = requireAuthenticatedSession(req, config);

    const spreadsheetUrl =
      getQueryParam(req, 'spreadsheetUrl') || getQueryParam(req, 'spreadsheetId');
    const sheetName = getQueryParam(req, 'sheetName');
    const customRange = getQueryParam(req, 'range');
    const headerRowParam = getQueryParam(req, 'headerRowIndex');
    const headerRowIndex: number | 'auto' =
      headerRowParam && headerRowParam !== 'auto' && !Number.isNaN(Number(headerRowParam))
        ? Number(headerRowParam)
        : 'auto';

    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    const targetSheet = sheetName || 'Sheet1';
    const rangeUsed = buildSheetRange(targetSheet, customRange || undefined, 1000);

    const rawValues = await runWithSessionTokenRetry(
      {
        session,
        requiredFeature: 'sheets',
        config,
        transport,
        onSessionUpdated: (next) => setEncryptedSessionCookie(req, res, next, config),
      },
      (accessToken) =>
        transport.fetchSheetValues({
          spreadsheetId,
          range: rangeUsed,
          accessToken,
          config,
        })
    );

    const normalized = normalizeSheetValues(targetSheet, rawValues, {
      headerRowIndex,
      rangeUsed,
    });

    return sendJson(res, 200, {
      spreadsheetId,
      sheetName: targetSheet,
      rangeUsed,
      headers: normalized.worksheet.headers,
      rowsCount: normalized.worksheet.rows.length,
      skippedEmptyRows: normalized.worksheet.skippedEmptyRows,
      headerRowIndex: normalized.worksheet.headerRowIndex,
      rows: normalized.worksheet.rows,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to fetch worksheet values.');
  }
}

export async function handleSheetsSync(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);
    const session = requireAuthenticatedSession(req, config);
    const body = await readJsonBody(req);

    const spreadsheetUrl = String(
      body?.spreadsheetUrl || body?.spreadsheetId || body?.url || ''
    ).trim();
    if (!spreadsheetUrl) {
      throw new HttpApiError(
        400,
        'MISSING_SPREADSHEET_URL',
        'Please paste a valid Google Spreadsheet URL or ID.'
      );
    }

    let activeSession = session;
    let driveStore: GoogleDriveStore | null = null;
    let persistSessionIfChanged: ((updated?: EncryptedSessionData) => void) | null = null;
    const scopes = session.sc.split(/\s+/).filter(Boolean);
    if (hasDriveScope(scopes)) {
      const ctx = await createUserDriveContext({
        req,
        res,
        config,
        transport,
        driveTransport,
      });
      activeSession = ctx.session;
      driveStore = ctx.driveStore;
      persistSessionIfChanged = ctx.persistSessionIfChanged;
    }

    const synced = await performSpreadsheetSync({
      session: activeSession,
      spreadsheetUrl,
      sheetName: body?.sheetName ? String(body.sheetName) : undefined,
      range: body?.range ? String(body.range) : undefined,
      headerRowIndex:
        body?.headerRowIndex === 'auto' || body?.headerRowIndex === undefined
          ? 'auto'
          : Number(body.headerRowIndex),
      syncAllSheets: Boolean(body?.syncAllSheets),
      config,
      driveStore,
      transport,
      onSessionUpdated: (next) => {
        activeSession = next;
        if (persistSessionIfChanged) persistSessionIfChanged(next);
        else setEncryptedSessionCookie(req, res, next, config);
      },
    });
    persistSessionIfChanged?.();

    return sendJson(res, 200, {
      status: synced.lastSyncStatus,
      spreadsheetId: synced.spreadsheetId,
      spreadsheetUrl: synced.spreadsheetUrl,
      title: synced.title,
      selectedSheetName: synced.selectedSheetName,
      selectedRange: synced.selectedRange,
      headerRowIndex: synced.headerRowIndex,
      sheetsMeta: synced.sheetsMeta,
      worksheets: synced.worksheets,
      totalRows: synced.totalRows,
      lastSyncAt: synced.lastSyncAt,
      stats: synced.lastSyncStats,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Google Sheets synchronization failed.');
  }
}

export async function handleSheetsData(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const session = requireAuthenticatedSession(req, config);
    const scopes = session.sc.split(/\s+/).filter(Boolean);
    if (!hasDriveScope(scopes)) {
      return sendJson(res, 200, { spreadsheet: null, history: [] });
    }

    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const spreadsheetId = getQueryParam(req, 'spreadsheetId') || undefined;
    const latest = await driveStore.getLatestSyncedData(spreadsheetId);
    persistSessionIfChanged();
    return sendJson(res, 200, latest);
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to load persisted Google Sheets data.');
  }
}

// ============================================================================
// DUAL EMAIL DELIVERY HANDLERS (Gmail API + Per-User Encrypted SMTP)
// ============================================================================

export async function handleSmtpConfig(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });

    if (req.method === 'GET') {
      const smtp = await driveStore.getSmtpConfig();
      persistSessionIfChanged();
      return sendJson(res, 200, { smtpConfig: toPublicSmtpConfig(smtp) });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = await saveUserSmtpConfig({
        host: String(body?.host || ''),
        port: Number(body?.port || 587),
        securityMode:
          body?.securityMode === 'SSL' || body?.securityMode === 'NONE'
            ? body.securityMode
            : 'STARTTLS',
        username: String(body?.username || ''),
        password: body?.password !== undefined ? String(body.password) : undefined,
        senderName: String(body?.senderName || ''),
        senderEmail: String(body?.senderEmail || ''),
        config,
        driveStore,
      });
      persistSessionIfChanged();
      return sendJson(res, 200, { smtpConfig: saved });
    }

    if (req.method === 'DELETE') {
      await driveStore.deleteSmtpConfig();
      persistSessionIfChanged();
      return sendJson(res, 200, {
        deleted: true,
        smtpConfig: toPublicSmtpConfig(null),
      });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process SMTP configuration.');
  }
}

export async function handleSmtpTest(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport, emailTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const body = await readJsonBody(req);

    const result = await testUserSmtpConnection({
      override: body?.host
        ? {
            host: String(body.host),
            port: body.port ? Number(body.port) : undefined,
            securityMode: body.securityMode,
            username: body.username !== undefined ? String(body.username) : undefined,
            password: body.password !== undefined ? String(body.password) : undefined,
          }
        : undefined,
      config,
      driveStore,
      emailTransport,
    });
    persistSessionIfChanged();
    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleApiError(res, err, 'SMTP connection test failed.');
  }
}

export async function handleEmailTestSend(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport, emailTransport } = resolveDeps(req, deps);
    const { session, driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const body = await readJsonBody(req);
    const method = body?.method === 'smtp' ? 'smtp' : 'gmail';
    const recipientRaw = String(body?.to || session.em || '').trim();
    const parsed = parseAndValidateEmailList(recipientRaw);
    if (parsed.emails.length === 0 || parsed.invalid.length > 0) {
      throw new HttpApiError(400, 'INVALID_RECIPIENT', 'Please provide a valid test recipient email address.');
    }

    const dispatch = await dispatchUserEmails({
      session,
      method,
      items: [
        {
          documentType: 'test',
          documentId: `test_${Date.now()}`,
          documentNumber: 'TEST-EMAIL',
          to: parsed.emails[0],
          subject: `Invoice Studio Test Email (${method === 'gmail' ? 'Gmail API' : 'SMTP'})`,
          textBody: `This is a test email sent from Invoice Studio using ${
            method === 'gmail' ? `your connected Gmail account (${session.em})` : 'your configured SMTP server'
          }.\n\nTimestamp: ${new Date().toISOString()}`,
        },
      ],
      config,
      driveStore,
      googleTransport: transport,
      emailTransport,
      onSessionUpdated: (next) => persistSessionIfChanged(next),
    });
    persistSessionIfChanged();

    const first = dispatch.results[0];
    if (!first || first.status !== 'sent') {
      throw new HttpApiError(
        502,
        'TEST_EMAIL_FAILED',
        first?.errorMessage || 'Failed to send test email.'
      );
    }

    return sendJson(res, 200, {
      ok: true,
      method,
      recipientEmail: first.recipientEmail,
      senderEmail: first.senderEmail,
      providerMessageId: first.providerMessageId,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to send test email.');
  }
}

export async function handleEmailSend(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport, emailTransport } = resolveDeps(req, deps);
    const { session, driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const body = await readJsonBody(req);

    const method = body?.method === 'gmail' || body?.method === 'smtp' ? body.method : null;
    if (!method) {
      throw new HttpApiError(
        400,
        'MISSING_DELIVERY_METHOD',
        'Please explicitly select an email delivery method: "gmail" or "smtp".'
      );
    }

    const items = Array.isArray(body?.items) ? body.items : body?.to ? [body] : [];
    const summary = await dispatchUserEmails({
      session,
      method,
      items,
      config,
      driveStore,
      googleTransport: transport,
      emailTransport,
      onSessionUpdated: (next) => persistSessionIfChanged(next),
    });
    persistSessionIfChanged();

    return sendJson(res, 200, summary);
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to send email.');
  }
}

export async function handleEmailHistory(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, transport, driveTransport } = resolveDeps(req, deps);
    const { driveStore, persistSessionIfChanged } = await createUserDriveContext({
      req,
      res,
      config,
      transport,
      driveTransport,
    });
    const limitParam = Number(getQueryParam(req, 'limit') || 100);
    const logs = await driveStore.listEmailLogs(Math.min(Math.max(limitParam, 1), 250));
    persistSessionIfChanged();
    return sendJson(res, 200, { logs });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to load email delivery history.');
  }
}
