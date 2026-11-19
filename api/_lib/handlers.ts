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
  createPersistenceStore,
  DatabaseConfigurationError,
  PersistenceStore,
  StoredAppUser,
} from './db.js';
import {
  createDriveBackup,
  defaultDriveTransport,
  DRIVE_ROOT_FOLDER_NAME,
  DRIVE_SUBFOLDER_KEYS,
  DriveTransportAdapter,
  restoreWorkspaceFromDrive,
  syncWorkspaceToDrive,
  uploadPdfToDrive,
} from './driveService.js';
import {
  defaultEmailTransport,
  dispatchUserEmails,
  EmailTransportAdapter,
  saveUserSmtpConfig,
  testUserSmtpConnection,
  toPublicSmtpConfig,
} from './emailBackendService.js';
import {
  assertGoogleOAuthConfig,
  buildGoogleAuthorizeUrl,
  completeOAuthCodeExchange,
  defaultGoogleTransport,
  disconnectGoogleIntegration,
  getValidAccessTokenForUser,
  GoogleTransportAdapter,
  HttpApiError,
  normalizeOAuthFeature,
  performSpreadsheetSync,
  validateAndFetchSpreadsheetMetadata,
} from './googleService.js';
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  getQueryParam,
  getRequestCookies,
  getRequestOrigin,
  NormalizedRequest,
  NormalizedResponse,
  OAUTH_STATE_COOKIE_NAME,
  readJsonBody,
  readSessionIdFromRequest,
  sendJson,
  sendRedirect,
  setOAuthStateCookie,
  setSessionCookie,
} from './http.js';
import {
  buildSheetRange,
  extractSpreadsheetId,
  normalizeSheetValues,
} from './sheetsNormalization.js';

export interface HandlerRuntimeDeps {
  getConfig?: (req: NormalizedRequest) => AppServerConfig;
  getStore?: (config: AppServerConfig) => PersistenceStore;
  transport?: GoogleTransportAdapter;
  driveTransport?: DriveTransportAdapter;
  emailTransport?: EmailTransportAdapter;
}

function resolveDeps(req: NormalizedRequest, deps?: HandlerRuntimeDeps) {
  const origin = getRequestOrigin(req);
  const config = deps?.getConfig ? deps.getConfig(req) : getServerConfig(origin);
  const getStore = () =>
    deps?.getStore ? deps.getStore(config) : createPersistenceStore(config.databaseUrl);
  const transport = deps?.transport || defaultGoogleTransport;
  const driveTransport = deps?.driveTransport || defaultDriveTransport;
  const emailTransport = deps?.emailTransport || defaultEmailTransport;
  return { config, getStore, transport, driveTransport, emailTransport, origin };
}

function handleApiError(res: NormalizedResponse, err: any, fallbackMessage: string) {
  if (err instanceof HttpApiError) {
    return sendJson(res, err.statusCode, {
      error: err.message,
      code: err.code,
      requiresReauth: err.requiresReauth,
    });
  }
  if (err instanceof DatabaseConfigurationError) {
    return sendJson(res, err.statusCode, {
      error: err.message,
      code: 'DATABASE_UNCONFIGURED',
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
 * Resolves the verified authenticated user from the signed HttpOnly session cookie.
 * Never trusts userId from query params or request body.
 */
export async function requireAuthenticatedUser(
  req: NormalizedRequest,
  config: AppServerConfig,
  store: PersistenceStore
): Promise<{ sessionId: string; userId: string; user: StoredAppUser }> {
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    throw new HttpApiError(
      503,
      'SESSION_SECRET_UNCONFIGURED',
      'Server SESSION_SECRET is not configured.'
    );
  }
  const sessionId = readSessionIdFromRequest(req, config.sessionSecret);
  if (!sessionId) {
    throw new HttpApiError(
      401,
      'NOT_AUTHENTICATED',
      'Please sign in with your Google Account to continue.',
      true
    );
  }
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new HttpApiError(
      401,
      'SESSION_EXPIRED',
      'Your session has expired. Please sign in with Google again.',
      true
    );
  }
  const user = await store.getAppUser(session.userId);
  if (!user) {
    throw new HttpApiError(
      401,
      'USER_NOT_FOUND',
      'Account record not found. Please sign in with Google again.',
      true
    );
  }
  return { sessionId, userId: user.userId, user };
}

async function resolveOptionalAuthenticatedUser(
  req: NormalizedRequest,
  config: AppServerConfig,
  store: PersistenceStore
): Promise<{ sessionId: string; userId: string; user: StoredAppUser } | null> {
  if (!config.sessionSecret || config.sessionSecret.length < 16) return null;
  const sessionId = readSessionIdFromRequest(req, config.sessionSecret);
  if (!sessionId) return null;
  const session = await store.getSession(sessionId);
  if (!session) return null;
  const user = await store.getAppUser(session.userId);
  if (!user) return null;
  return { sessionId, userId: user.userId, user };
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
// AUTH HANDLERS (Multi-user Google OAuth 2.0 with Incremental Consent)
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
    const { config, getStore, origin } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);

    let featureRaw = getQueryParam(req, 'feature');
    let returnTo = getQueryParam(req, 'returnTo') || '';
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!featureRaw && body?.feature) featureRaw = String(body.feature);
      if (!returnTo && body?.returnTo) returnTo = String(body.returnTo);
    }
    const feature: GoogleOAuthFeature = normalizeOAuthFeature(featureRaw);

    let sessionId = readSessionIdFromRequest(req, config.sessionSecret);
    if (!sessionId) {
      sessionId = `sess_${generateRandomId(24)}`;
      setSessionCookie(req, res, sessionId, config.sessionSecret);
    }

    // Include previously granted scopes if the user is already signed in and adding a feature incrementally
    let existingScopes: string[] = [];
    if (config.databaseUrl) {
      try {
        const store = getStore();
        const existingAuth = await resolveOptionalAuthenticatedUser(req, config, store);
        if (existingAuth) {
          const conn = await store.getOAuthConnection(existingAuth.userId);
          if (conn) existingScopes = conn.scopes.split(/\s+/).filter(Boolean);
        }
      } catch {
        // Non-fatal: proceed with base + feature scopes
      }
    }

    const nonce = generateRandomId(16);
    const state = setOAuthStateCookie(
      req,
      res,
      { nonce, sid: sessionId, feature, returnTo },
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
  const { config, getStore, transport } = resolveDeps(req, deps);

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
        sid: string;
        feature?: GoogleOAuthFeature;
      }>(stateCookie, config.sessionSecret);
      const verifiedParamState = verifySignedPayload<{
        nonce: string;
        sid: string;
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

      const sessionId =
        readSessionIdFromRequest(req, config.sessionSecret) || verifiedCookieState.sid;
      const feature = normalizeOAuthFeature(body?.feature || verifiedCookieState.feature);
      const store = getStore();
      const result = await completeOAuthCodeExchange({
        code,
        redirectUri,
        sessionId,
        feature,
        config,
        store,
        transport,
      });

      clearOAuthStateCookie(req, res);
      setSessionCookie(req, res, sessionId, config.sessionSecret);

      const smtp = await store.getSmtpConfig(result.userId);
      return sendJson(res, 200, {
        authenticated: true,
        feature,
        user: {
          userId: result.appUser.userId,
          email: result.appUser.email,
          name: result.appUser.name,
          picture: result.appUser.picture,
          createdAt: result.appUser.createdAt,
          lastLoginAt: result.appUser.lastLoginAt,
          onboardingCompleted: result.appUser.onboardingCompleted,
          driveConnected: hasDriveScope(result.scopes),
          sheetsConnected: hasSheetsScope(result.scopes),
          gmailConnected: hasGmailSendScope(result.scopes),
          smtpConfigured: Boolean(smtp?.host && smtp?.senderEmail),
          driveRootFolderId: result.appUser.driveRootFolderId,
          driveLastSyncAt: result.appUser.driveLastSyncAt,
          driveSyncStatus: result.appUser.driveSyncStatus,
        },
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
        sid: string;
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
        sid: string;
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

      const sessionId =
        readSessionIdFromRequest(req, config.sessionSecret) || verifiedCookieState.sid;
      const feature = normalizeOAuthFeature(verifiedCookieState.feature);
      const store = getStore();
      await completeOAuthCodeExchange({
        code,
        redirectUri: config.googleRedirectUri,
        sessionId,
        feature,
        config,
        store,
        transport,
      });

      clearOAuthStateCookie(req, res);
      setSessionCookie(req, res, sessionId, config.sessionSecret);
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

  const { config, getStore, origin } = resolveDeps(req, deps);
  const diagnostics = getIntegrationDiagnostics(origin);

  try {
    if (!config.sessionSecret || config.sessionSecret.length < 16 || !config.databaseUrl) {
      return sendJson(res, 200, {
        authenticated: false,
        user: null,
        scopes: [],
        diagnostics,
      });
    }

    const store = getStore();
    const auth = await resolveOptionalAuthenticatedUser(req, config, store);
    if (!auth) {
      return sendJson(res, 200, {
        authenticated: false,
        user: null,
        scopes: [],
        diagnostics,
      });
    }

    const [conn, smtp] = await Promise.all([
      store.getOAuthConnection(auth.userId),
      store.getSmtpConfig(auth.userId),
    ]);
    const scopes = conn ? conn.scopes.split(/\s+/).filter(Boolean) : [];

    return sendJson(res, 200, {
      authenticated: true,
      user: {
        userId: auth.user.userId,
        email: auth.user.email,
        name: auth.user.name,
        picture: auth.user.picture,
        createdAt: auth.user.createdAt,
        lastLoginAt: auth.user.lastLoginAt,
        onboardingCompleted: auth.user.onboardingCompleted,
        driveConnected: hasDriveScope(scopes),
        sheetsConnected: hasSheetsScope(scopes),
        gmailConnected: hasGmailSendScope(scopes),
        smtpConfigured: Boolean(smtp?.host && smtp?.senderEmail),
        driveRootFolderId: auth.user.driveRootFolderId,
        driveLastSyncAt: auth.user.driveLastSyncAt,
        driveSyncStatus: auth.user.driveSyncStatus,
      },
      scopes,
      hasRefreshToken: Boolean(conn?.encryptedRefreshToken),
      connectedAt: conn?.createdAt || auth.user.createdAt,
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
    const { config, getStore, transport } = resolveDeps(req, deps);
    const body = await readJsonBody(req);
    const featureRaw = String(body?.feature || 'all').toLowerCase();
    const feature: 'all' | 'drive' | 'sheets' | 'gmail' =
      featureRaw === 'drive' || featureRaw === 'sheets' || featureRaw === 'gmail'
        ? featureRaw
        : 'all';

    let signedOut = false;
    if (config.databaseUrl && config.sessionSecret.length >= 16) {
      const store = getStore();
      const auth = await resolveOptionalAuthenticatedUser(req, config, store);
      if (auth) {
        const result = await disconnectGoogleIntegration({
          userId: auth.userId,
          sessionId: auth.sessionId,
          feature,
          config,
          store,
          transport,
        });
        signedOut = result.signedOut;
      } else if (feature === 'all') {
        signedOut = true;
      }
    } else if (feature === 'all') {
      signedOut = true;
    }

    if (signedOut) {
      clearOAuthStateCookie(req, res);
      clearSessionCookie(req, res);
    }

    return sendJson(res, 200, {
      disconnected: true,
      feature,
      signedOut,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to disconnect Google integration.');
  }
}

// ============================================================================
// WORKSPACE, ONBOARDING & CUSTOMERS HANDLER
// ============================================================================

export async function handleWorkspace(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, getStore } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    if (req.method === 'GET') {
      const [workspace, customers, quotations, invoices, smtp, emailLogs] = await Promise.all([
        store.getWorkspaceState(auth.userId),
        store.listCustomers(auth.userId),
        store.listQuotations(auth.userId),
        store.listInvoices(auth.userId),
        store.getSmtpConfig(auth.userId),
        store.listEmailLogs(auth.userId, 100),
      ]);

      return sendJson(res, 200, {
        userId: auth.userId,
        onboardingCompleted: auth.user.onboardingCompleted,
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

      if (body?.onboardingCompleted !== undefined) {
        await store.updateAppUserOnboarding(auth.userId, Boolean(body.onboardingCompleted));
      }

      if (body?.customer && body.customer.id) {
        const savedCust = await store.upsertCustomer(auth.userId, String(body.customer.id), body.customer);
        return sendJson(res, 200, { customer: savedCust.data });
      }

      if (body?.deleteCustomerId) {
        const deleted = await store.deleteCustomer(auth.userId, String(body.deleteCustomerId));
        return sendJson(res, 200, { deleted });
      }

      if (
        body?.companySettings !== undefined ||
        body?.template !== undefined ||
        body?.fields !== undefined ||
        body?.calculationSettings !== undefined ||
        body?.preferences !== undefined
      ) {
        const saved = await store.upsertWorkspaceState(auth.userId, {
          companySettings: body.companySettings,
          template: body.template,
          fields: body.fields,
          calculationSettings: body.calculationSettings,
          preferences: body.preferences,
        });
        return sendJson(res, 200, { workspace: saved });
      }

      return sendJson(res, 200, { ok: true, onboardingCompleted: Boolean(body?.onboardingCompleted) });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process workspace request.');
  }
}

// ============================================================================
// QUOTATIONS HANDLER (Strict userId ownership + Server-enforced approval gate)
// ============================================================================

export async function handleQuotations(
  req: NormalizedRequest,
  res: NormalizedResponse,
  segments: string[],
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, getStore } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    const [idParam, actionParam] = segments;

    // Collection routes: GET /api/quotations | POST /api/quotations
    if (!idParam) {
      if (req.method === 'GET') {
        const list = await store.listQuotations(auth.userId);
        return sendJson(res, 200, { quotations: list.map((q) => q.data) });
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const q = body?.quotation || body;
        if (!q || !q.id || !q.quotationNumber) {
          throw new HttpApiError(400, 'INVALID_QUOTATION', 'Quotation id and quotationNumber are required.');
        }
        const saved = await store.upsertQuotation(auth.userId, {
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
          data: { ...q, ownerUserId: auth.userId },
        });
        return sendJson(res, 200, { quotation: saved.data });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Action: POST /api/quotations/:id/status
    if (actionParam === 'status') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const existing = await store.getQuotation(auth.userId, idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found for your account.');
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
      const actorName = auth.user.name || auth.user.email;
      const historyEntry = {
        id: `qhist_${Date.now()}_${generateRandomId(5)}`,
        status: nextStatus,
        previousStatus: existing.status,
        timestamp: nowIso,
        actorName,
        actorEmail: auth.user.email,
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

      const saved = await store.upsertQuotation(auth.userId, {
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

      return sendJson(res, 200, { quotation: saved.data });
    }

    // Action: POST /api/quotations/:id/convert (Strict server-side enforcement!)
    if (actionParam === 'convert') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const existing = await store.getQuotation(auth.userId, idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found for your account.');
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
      // Never auto-mark paid on conversion
      const normalizedInvoice = {
        ...invoiceRecord,
        paymentStatus: 'Unpaid',
        paymentAmount: 0,
        sourceQuotationId: existing.id,
        sourceQuotationNumber: existing.quotationNumber,
        updatedAt: nowIso,
      };

      const savedInvoice = await store.upsertInvoice(auth.userId, {
        id: String(normalizedInvoice.id),
        invoiceNumber: String(normalizedInvoice.invoiceNumber),
        sourceType: String(normalizedInvoice.sourceType || 'manual'),
        sourceQuotationId: existing.id,
        sourceQuotationNumber: existing.quotationNumber,
        customerName: String(normalizedInvoice.customerName || existing.customerName),
        totalAmount: Number(normalizedInvoice.totalAmount || existing.totalAmount),
        paymentStatus: 'Unpaid',
        data: normalizedInvoice,
      });

      const prevData = existing.data || {};
      const actorName = auth.user.name || auth.user.email;
      const conversionHistoryEntry = {
        id: `qhist_${Date.now()}_${generateRandomId(5)}`,
        status: 'Converted to Invoice',
        previousStatus: 'Approved',
        timestamp: nowIso,
        actorName,
        actorEmail: auth.user.email,
        notes: `Converted to Invoice ${savedInvoice.invoiceNumber}`,
      };

      // Keep original quotation record intact & linked
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

      const savedQuotation = await store.upsertQuotation(auth.userId, {
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

      return sendJson(res, 200, {
        quotation: savedQuotation.data,
        invoice: savedInvoice.data,
      });
    }

    // Item routes: GET / PUT / DELETE /api/quotations/:id
    if (req.method === 'GET') {
      const existing = await store.getQuotation(auth.userId, idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found for your account.');
      }
      return sendJson(res, 200, { quotation: existing.data });
    }

    if (req.method === 'PUT') {
      const existing = await store.getQuotation(auth.userId, idParam);
      if (!existing) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found for your account.');
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
      const saved = await store.upsertQuotation(auth.userId, {
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
        data: { ...q, id: idParam, ownerUserId: auth.userId },
      });
      return sendJson(res, 200, { quotation: saved.data });
    }

    if (req.method === 'DELETE') {
      const deleted = await store.deleteQuotation(auth.userId, idParam);
      if (!deleted) {
        throw new HttpApiError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found for your account.');
      }
      return sendJson(res, 200, { deleted: true, id: idParam });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process quotation request.');
  }
}

// ============================================================================
// INVOICES HANDLER (Strict userId ownership)
// ============================================================================

export async function handleInvoices(
  req: NormalizedRequest,
  res: NormalizedResponse,
  segments: string[],
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, getStore } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);
    const [idParam] = segments;

    if (!idParam) {
      if (req.method === 'GET') {
        const list = await store.listInvoices(auth.userId);
        return sendJson(res, 200, { invoices: list.map((i) => i.data) });
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const inv = body?.invoice || body;
        if (!inv || !inv.id || !inv.invoiceNumber) {
          throw new HttpApiError(400, 'INVALID_INVOICE', 'Invoice id and invoiceNumber are required.');
        }
        const saved = await store.upsertInvoice(auth.userId, {
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
        return sendJson(res, 200, { invoice: saved.data });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (req.method === 'GET') {
      const existing = await store.getInvoice(auth.userId, idParam);
      if (!existing) {
        throw new HttpApiError(404, 'INVOICE_NOT_FOUND', 'Invoice not found for your account.');
      }
      return sendJson(res, 200, { invoice: existing.data });
    }

    if (req.method === 'PUT') {
      const existing = await store.getInvoice(auth.userId, idParam);
      if (!existing) {
        throw new HttpApiError(404, 'INVOICE_NOT_FOUND', 'Invoice not found for your account.');
      }
      const body = await readJsonBody(req);
      const inv = body?.invoice || body;
      const saved = await store.upsertInvoice(auth.userId, {
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
      return sendJson(res, 200, { invoice: saved.data });
    }

    if (req.method === 'DELETE') {
      const deleted = await store.deleteInvoice(auth.userId, idParam);
      if (!deleted) {
        throw new HttpApiError(404, 'INVOICE_NOT_FOUND', 'Invoice not found for your account.');
      }
      return sendJson(res, 200, { deleted: true, id: idParam });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to process invoice request.');
  }
}

// ============================================================================
// GOOGLE DRIVE STORAGE HANDLERS
// ============================================================================

export async function handleDriveStatus(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, getStore } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);
    const [conn, files] = await Promise.all([
      store.getOAuthConnection(auth.userId),
      store.listDriveFiles(auth.userId),
    ]);
    const scopes = conn ? conn.scopes.split(/\s+/).filter(Boolean) : [];
    return sendJson(res, 200, {
      connected: hasDriveScope(scopes),
      rootFolderName: DRIVE_ROOT_FOLDER_NAME,
      rootFolderId: auth.user.driveRootFolderId,
      subfolders: auth.user.driveSubfolders,
      subfolderNames: DRIVE_SUBFOLDER_KEYS,
      lastSyncAt: auth.user.driveLastSyncAt,
      syncStatus: auth.user.driveSyncStatus,
      lastError: auth.user.driveLastError,
      trackedFilesCount: files.length,
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
    const { config, getStore, transport, driveTransport } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    const summary = await syncWorkspaceToDrive({
      userId: auth.userId,
      config,
      store,
      googleTransport: transport,
      driveTransport,
    });

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
    const { config, getStore, transport, driveTransport } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);
    const body = await readJsonBody(req);

    const documentType = body?.documentType === 'quotation' ? 'quotation' : 'invoice';
    const documentId = String(body?.documentId || '').trim();
    const fileName = String(body?.fileName || `${documentType}-${documentId}.pdf`).trim();
    const pdfBase64 = String(body?.pdfBase64 || '').trim();

    if (!documentId || !pdfBase64) {
      throw new HttpApiError(400, 'INVALID_UPLOAD_PAYLOAD', 'documentId and pdfBase64 are required.');
    }

    const result = await uploadPdfToDrive({
      userId: auth.userId,
      documentType,
      documentId,
      fileName,
      pdfBase64,
      config,
      store,
      googleTransport: transport,
      driveTransport,
    });

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
    const { config, getStore, transport, driveTransport } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    const summary = await restoreWorkspaceFromDrive({
      userId: auth.userId,
      config,
      store,
      googleTransport: transport,
      driveTransport,
    });

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
    const { config, getStore, transport, driveTransport } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    const result = await createDriveBackup({
      userId: auth.userId,
      config,
      store,
      googleTransport: transport,
      driveTransport,
    });

    return sendJson(res, 200, { ok: true, ...result });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to create Google Drive backup.');
  }
}

// ============================================================================
// GOOGLE SHEETS HANDLERS (Strictly per-user verified userId)
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
    const { config, getStore, transport } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    let spreadsheetUrl = getQueryParam(req, 'spreadsheetUrl') || getQueryParam(req, 'url');
    if (!spreadsheetUrl && req.method === 'POST') {
      const body = await readJsonBody(req);
      spreadsheetUrl = String(body?.spreadsheetUrl || body?.url || '');
    }

    const metadata = await validateAndFetchSpreadsheetMetadata({
      userId: auth.userId,
      spreadsheetUrl,
      config,
      store,
      transport,
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
    const { config, getStore, transport } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    const spreadsheetUrl =
      getQueryParam(req, 'spreadsheetUrl') || getQueryParam(req, 'spreadsheetId');
    const sheetName = getQueryParam(req, 'sheetName');
    const customRange = getQueryParam(req, 'range');
    const headerRowParam = getQueryParam(req, 'headerRowIndex');
    const headerRowIndex =
      headerRowParam === '' || headerRowParam === 'auto' ? 'auto' : Number(headerRowParam);

    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    const { accessToken } = await getValidAccessTokenForUser({
      userId: auth.userId,
      requiredFeature: 'sheets',
      config,
      store,
      transport,
    });

    const meta = await transport.fetchSpreadsheetMetadata({
      spreadsheetId,
      accessToken,
      config,
    });
    const targetSheet = meta.sheets.find((s) => s.title === sheetName) || meta.sheets[0];
    if (!targetSheet) {
      throw new HttpApiError(404, 'SHEET_TAB_NOT_FOUND', 'Requested worksheet tab was not found.');
    }

    const rangeUsed = buildSheetRange(targetSheet.title, customRange);
    const values = await transport.fetchSheetValues({
      spreadsheetId,
      range: rangeUsed,
      accessToken,
      config,
    });

    const normalized = normalizeSheetValues(targetSheet.title, values, {
      headerRowIndex,
      rangeUsed,
    });

    return sendJson(res, 200, {
      spreadsheetId,
      title: meta.title,
      worksheet: normalized.worksheet,
      rowsCount: normalized.worksheet.rows.length,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to read spreadsheet values.');
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
    const { config, getStore, transport } = resolveDeps(req, deps);
    assertGoogleOAuthConfig(config);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    const body = await readJsonBody(req);
    const spreadsheetUrl = String(body?.spreadsheetUrl || body?.spreadsheetId || '').trim();
    const sheetName = body?.sheetName ? String(body.sheetName) : undefined;
    const range = body?.range ? String(body.range) : undefined;
    const syncAllSheets = Boolean(body?.syncAllSheets);
    const headerRowIndex =
      body?.headerRowIndex === 'auto' || body?.headerRowIndex === undefined
        ? 'auto'
        : Number(body.headerRowIndex);

    const result = await performSpreadsheetSync({
      userId: auth.userId,
      spreadsheetUrl,
      sheetName,
      range,
      headerRowIndex,
      syncAllSheets,
      config,
      store,
      transport,
    });

    return sendJson(res, 200, {
      status: result.lastSyncStatus,
      spreadsheetId: result.spreadsheetId,
      spreadsheetUrl: result.spreadsheetUrl,
      title: result.title,
      selectedSheetName: result.selectedSheetName,
      selectedRange: result.selectedRange,
      headerRowIndex: result.headerRowIndex,
      sheetsMeta: result.sheetsMeta,
      worksheets: result.worksheets,
      totalRows: result.totalRows,
      lastSyncAt: result.lastSyncAt,
      stats: result.lastSyncStats,
    });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to synchronize Google Sheet.');
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
    const { config, getStore } = resolveDeps(req, deps);
    if (!config.sessionSecret || !config.databaseUrl) {
      return sendJson(res, 200, { spreadsheet: null, history: [] });
    }

    const store = getStore();
    const auth = await resolveOptionalAuthenticatedUser(req, config, store);
    if (!auth) {
      return sendJson(res, 200, { spreadsheet: null, history: [] });
    }

    const spreadsheetId = getQueryParam(req, 'spreadsheetId') || undefined;
    const data = await store.getLatestSyncedData(auth.userId, spreadsheetId);
    return sendJson(res, 200, data);
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to load persisted spreadsheet data.');
  }
}

// ============================================================================
// DUAL EMAIL DELIVERY HANDLERS (Gmail API + Encrypted Backend SMTP)
// ============================================================================

export async function handleSmtpConfig(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  try {
    const { config, getStore } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);

    if (req.method === 'GET') {
      const existing = await store.getSmtpConfig(auth.userId);
      return sendJson(res, 200, { smtpConfig: toPublicSmtpConfig(existing) });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJsonBody(req);
      const saved = await saveUserSmtpConfig({
        userId: auth.userId,
        host: String(body?.host || ''),
        port: Number(body?.port || 587),
        securityMode:
          body?.securityMode === 'SSL' || body?.securityMode === 'NONE'
            ? body.securityMode
            : 'STARTTLS',
        username: String(body?.username || ''),
        password: body?.password ? String(body.password) : undefined,
        senderName: String(body?.senderName || ''),
        senderEmail: String(body?.senderEmail || ''),
        config,
        store,
      });
      return sendJson(res, 200, { smtpConfig: saved });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to manage SMTP configuration.');
  }
}

export async function handleSmtpTest(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, getStore, emailTransport } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);
    const body = await readJsonBody(req);

    const result = await testUserSmtpConnection({
      userId: auth.userId,
      override: body?.host
        ? {
            host: String(body.host),
            port: Number(body.port || 587),
            securityMode:
              body.securityMode === 'SSL' || body.securityMode === 'NONE'
                ? body.securityMode
                : 'STARTTLS',
            username: body.username !== undefined ? String(body.username) : undefined,
            password: body.password ? String(body.password) : undefined,
          }
        : undefined,
      config,
      store,
      emailTransport,
    });

    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleApiError(res, err, 'SMTP connection test failed.');
  }
}

export async function handleEmailSend(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, getStore, transport, emailTransport } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);
    const body = await readJsonBody(req);

    const method = body?.method === 'gmail' ? 'gmail' : body?.method === 'smtp' ? 'smtp' : ('' as any);
    const items = Array.isArray(body?.items)
      ? body.items
      : body?.to
      ? [body]
      : [];

    const result = await dispatchUserEmails({
      userId: auth.userId,
      method,
      items,
      config,
      store,
      googleTransport: transport,
      emailTransport,
    });

    return sendJson(res, 200, result);
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to dispatch email(s).');
  }
}

export async function handleEmailHistory(
  req: NormalizedRequest,
  res: NormalizedResponse,
  deps?: HandlerRuntimeDeps
) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { config, getStore } = resolveDeps(req, deps);
    const store = getStore();
    const auth = await requireAuthenticatedUser(req, config, store);
    const limitParam = Number(getQueryParam(req, 'limit') || 100);
    const logs = await store.listEmailLogs(auth.userId, Math.min(Math.max(limitParam, 1), 500));
    return sendJson(res, 200, { logs });
  } catch (err: any) {
    return handleApiError(res, err, 'Failed to fetch email delivery history.');
  }
}
