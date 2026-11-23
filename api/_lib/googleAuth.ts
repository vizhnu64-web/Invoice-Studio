/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { google } from 'googleapis';
import { AppServerConfig, getServerConfig } from './config.js';
import { HttpApiError } from './errors.js';

export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_DRIVE_FULL_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const GOOGLE_SHEETS_FULL_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const GOOGLE_GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export const DEFAULT_GOOGLE_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
] as const;

export interface GooglePermissionFlags {
  identityConnected: boolean;
  driveGranted: boolean;
  sheetsGranted: boolean;
  gmailGranted: boolean;
}

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  emailVerified: boolean;
  audience: string;
  grantedScopes: string[];
  expiresIn: number;
  expiresAt: number;
  permissions: GooglePermissionFlags;
}

export interface PublicGoogleClientConfig {
  configured: boolean;
  clientId: string;
  apiKey: string;
  appId: string;
  pickerConfigured: boolean;
  defaultScopes: string[];
  optionalScopes: {
    gmailSend: string;
    sheetsWrite: string;
  };
  missingEnvVars: string[];
  appUrl: string;
}

/**
 * Returns ONLY public OAuth client metadata needed by the browser GIS client and Google Picker.
 * Never returns private credentials, client secrets, or encryption keys.
 */
export function getPublicGoogleConfig(requestOrigin?: string): PublicGoogleClientConfig {
  const cfg = getServerConfig(requestOrigin);
  const missingEnvVars: string[] = [];
  if (!cfg.googleClientId) missingEnvVars.push('VITE_GOOGLE_CLIENT_ID');

  return {
    configured: Boolean(cfg.googleClientId),
    clientId: cfg.googleClientId,
    apiKey: cfg.googleApiKey,
    appId: cfg.googleAppId,
    pickerConfigured: Boolean(cfg.googleClientId && cfg.googleApiKey && cfg.googleAppId),
    defaultScopes: [...DEFAULT_GOOGLE_SCOPES],
    optionalScopes: {
      gmailSend: GOOGLE_GMAIL_SEND_SCOPE,
      sheetsWrite: GOOGLE_SHEETS_FULL_SCOPE,
    },
    missingEnvVars,
    appUrl: cfg.appUrl,
  };
}

/**
 * Extracts a Google OAuth Bearer access token from the Authorization header.
 * Never logs the token value.
 */
export function extractBearerToken(authorizationHeader?: string): string {
  const header = String(authorizationHeader || '').trim();
  if (!header) {
    throw new HttpApiError(
      401,
      'GOOGLE_AUTH_REQUIRED',
      'Connect your Google account to access your Drive workspace, Sheets, or Gmail.'
    );
  }
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  if (!match?.[1] || match[1].length < 20) {
    throw new HttpApiError(
      401,
      'INVALID_AUTH_HEADER',
      'Missing or malformed Google OAuth Bearer token. Please reconnect your Google account.'
    );
  }
  return match[1];
}

/**
 * Creates a fresh, strictly request-scoped OAuth2 client authenticated with the caller's access token.
 * Never cached or shared across users or requests.
 */
export function createRequestOAuthClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export function computePermissionFlags(
  grantedScopes: string[],
  sub?: string,
  email?: string
): GooglePermissionFlags {
  const set = new Set(grantedScopes.map((s) => s.trim()).filter(Boolean));
  return {
    identityConnected: Boolean(sub && email),
    driveGranted: set.has(GOOGLE_DRIVE_FILE_SCOPE) || set.has(GOOGLE_DRIVE_FULL_SCOPE),
    sheetsGranted:
      set.has(GOOGLE_SHEETS_READONLY_SCOPE) ||
      set.has(GOOGLE_SHEETS_FULL_SCOPE) ||
      set.has(GOOGLE_DRIVE_FULL_SCOPE),
    gmailGranted: set.has(GOOGLE_GMAIL_SEND_SCOPE),
  };
}

/**
 * Validates a short-lived Google OAuth access token directly with Google's tokeninfo and userinfo APIs.
 *
 * Security invariants:
 * - Always verifies token audience (`aud` / `azp`) against configured Google Client ID when set.
 * - Derives immutable account `sub` and `email` strictly from Google's verified response.
 * - Never trusts client-supplied email headers or body fields.
 * - Never places the access token in URL query strings (uses POST form body for tokeninfo and Bearer header for userinfo).
 */
export async function verifyGoogleAccessToken(
  accessToken: string,
  options?: {
    config?: AppServerConfig;
    fetchImpl?: typeof fetch;
    nowMs?: number;
  }
): Promise<VerifiedGoogleIdentity> {
  const cfg = options?.config || getServerConfig();
  const fetchImpl = options?.fetchImpl || fetch;
  const nowMs = options?.nowMs ?? Date.now();

  if (!accessToken || accessToken.trim().length < 20) {
    throw new HttpApiError(
      401,
      'GOOGLE_AUTH_REQUIRED',
      'A valid Google OAuth access token is required.'
    );
  }

  // 1. Validate token + audience + granted scopes + actual expiry via POST to tokeninfo
  const tokenInfoRes = await fetchImpl('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ access_token: accessToken }).toString(),
  });

  const tokenInfoText = await tokenInfoRes.text().catch(() => '');
  let tokenInfo: Record<string, any> = {};
  try {
    tokenInfo = tokenInfoText ? JSON.parse(tokenInfoText) : {};
  } catch {
    tokenInfo = {};
  }

  if (!tokenInfoRes.ok || tokenInfo.error) {
    throw new HttpApiError(
      401,
      'GOOGLE_TOKEN_EXPIRED',
      'Your Google access token is invalid, expired, or was revoked. Please reconnect your Google account.'
    );
  }

  const tokenAudience = String(tokenInfo.aud || tokenInfo.azp || '').trim();
  if (cfg.googleClientId && tokenAudience !== cfg.googleClientId) {
    throw new HttpApiError(
      401,
      'GOOGLE_TOKEN_AUDIENCE_MISMATCH',
      'This Google access token was not issued for this Invoice Studio application.'
    );
  }

  let expiresIn = 0;
  if (tokenInfo.expires_in !== undefined && tokenInfo.expires_in !== null && tokenInfo.expires_in !== '') {
    const parsedExpiresIn = Number(tokenInfo.expires_in);
    if (!Number.isFinite(parsedExpiresIn) || parsedExpiresIn <= 0) {
      throw new HttpApiError(
        401,
        'GOOGLE_TOKEN_EXPIRED',
        'Your Google access token has expired. Please reconnect your Google account.'
      );
    }
    expiresIn = Math.floor(parsedExpiresIn);
  }
  if (tokenInfo.exp !== undefined && tokenInfo.exp !== null && tokenInfo.exp !== '') {
    const expMs = Number(tokenInfo.exp) * 1000;
    if (!Number.isFinite(expMs) || expMs <= nowMs) {
      throw new HttpApiError(
        401,
        'GOOGLE_TOKEN_EXPIRED',
        'Your Google access token has expired. Please reconnect your Google account.'
      );
    }
  }

  const grantedScopes = String(tokenInfo.scope || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2. Fetch authoritative user profile (`sub`, `email`, `name`, `picture`) via Bearer header
  const userInfoRes = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  let userInfo: Record<string, any> = {};
  if (userInfoRes.ok) {
    const userText = await userInfoRes.text().catch(() => '');
    try {
      userInfo = userText ? JSON.parse(userText) : {};
    } catch {
      userInfo = {};
    }
  } else if (userInfoRes.status === 401) {
    throw new HttpApiError(
      401,
      'GOOGLE_TOKEN_EXPIRED',
      'Google rejected the access token while verifying your account identity. Please reconnect.'
    );
  }

  const sub = String(userInfo.sub || tokenInfo.sub || '').trim();
  const email = String(userInfo.email || tokenInfo.email || '').trim();

  if (!sub || !email) {
    throw new HttpApiError(
      401,
      'GOOGLE_IDENTITY_UNAVAILABLE',
      'Unable to verify your Google account identity (sub/email). Reconnect and approve OpenID & Email permissions.'
    );
  }

  const emailVerified =
    userInfo.email_verified === true ||
    userInfo.email_verified === 'true' ||
    tokenInfo.email_verified === true ||
    tokenInfo.email_verified === 'true';

  const effectiveExpiresIn =
    expiresIn > 0
      ? expiresIn
      : tokenInfo.exp
        ? Math.max(60, Math.floor((Number(tokenInfo.exp) * 1000 - nowMs) / 1000))
        : 3600;

  return {
    sub,
    email,
    name: userInfo.name ? String(userInfo.name).trim() : undefined,
    picture: userInfo.picture ? String(userInfo.picture).trim() : undefined,
    emailVerified,
    audience: tokenAudience,
    grantedScopes,
    expiresIn: effectiveExpiresIn,
    expiresAt: nowMs + effectiveExpiresIn * 1000,
    permissions: computePermissionFlags(grantedScopes, sub, email),
  };
}

export function requireGooglePermission(
  identity: VerifiedGoogleIdentity,
  required: 'drive' | 'sheets' | 'gmail'
): void {
  if (required === 'drive' && !identity.permissions.driveGranted) {
    throw new HttpApiError(
      403,
      'DRIVE_PERMISSION_MISSING',
      'Google Drive permission (drive.file) was not granted. Grant Drive permission to access your workspace folder.'
    );
  }
  if (required === 'sheets' && !identity.permissions.sheetsGranted) {
    throw new HttpApiError(
      403,
      'SHEETS_PERMISSION_MISSING',
      'Google Sheets permission was not granted. Authorize Google Sheets access to import spreadsheets.'
    );
  }
  if (required === 'gmail' && !identity.permissions.gmailGranted) {
    throw new HttpApiError(
      403,
      'GMAIL_PERMISSION_MISSING',
      'Gmail send permission (gmail.send) has not been enabled yet. Click "Enable Gmail Permission" to send invoices and quotations through Gmail.'
    );
  }
}

/**
 * Revokes an active Google OAuth access token directly with Google's revocation endpoint.
 */
export async function revokeGoogleAccessToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ revoked: boolean }> {
  if (!accessToken || accessToken.trim().length < 20) {
    return { revoked: false };
  }
  try {
    const res = await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
    return { revoked: res.ok };
  } catch {
    return { revoked: false };
  }
}
