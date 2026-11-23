/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GooglePermissionFlags, GoogleVerifiedSession } from '../types';

/**
 * Google Identity Services (GIS) OAuth 2.0 Client — Employee Database Studio Architecture.
 *
 * Security & Isolation Guarantees:
 * - Access tokens are stored strictly in JavaScript module memory ONLY.
 * - NEVER stored in localStorage, sessionStorage, IndexedDB, cookies, URLs, Drive, or logs.
 * - Every received OAuth access token is verified by the backend (`POST /api/google/verify-session`)
 *   against Google's tokeninfo/userinfo endpoints to obtain the authoritative immutable `sub`,
 *   verified email, audience, expiry, and actual granted scopes.
 * - Default connection requests Identity + Drive (`drive.file`) + Sheets (`spreadsheets.readonly`).
 * - Gmail sending (`gmail.send`) is requested incrementally ONLY when the user enables Gmail sending.
 */

export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const GOOGLE_SHEETS_FULL_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const GOOGLE_GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export const DEFAULT_GOOGLE_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
] as const;

export interface GoogleClientConfig {
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
}

export interface GoogleSessionSnapshot {
  session: GoogleVerifiedSession | null;
  hasActiveToken: boolean;
  expired: boolean;
}

export type GoogleSessionListener = (snapshot: GoogleSessionSnapshot) => void;

export class GoogleAuthError extends Error {
  code:
    | 'OAUTH_NOT_CONFIGURED'
    | 'GIS_SCRIPT_FAILED'
    | 'OAUTH_CANCELLED'
    | 'OAUTH_ACCESS_DENIED'
    | 'OAUTH_TOKEN_ERROR'
    | 'GOOGLE_TOKEN_EXPIRED'
    | 'TOKEN_VERIFICATION_FAILED';

  constructor(code: GoogleAuthError['code'], message: string) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    scope?: string;
    include_granted_scopes?: boolean;
    hint?: string;
  }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    prompt?: string;
    hint?: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => GisTokenClient;
  revoke?: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
      picker?: any;
    };
    gapi?: {
      load: (apiName: string, options: { callback: () => void; onerror?: () => void }) => void;
    };
  }
}

let cachedClientConfig: GoogleClientConfig | null = null;
let gisLoadPromise: Promise<void> | null = null;

function readBuildTimeGoogleConfig(): GoogleClientConfig {
  const env = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
  const clientId = String(env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const apiKey = String(env.VITE_GOOGLE_API_KEY || '').trim();
  const appId = String(env.VITE_GOOGLE_APP_ID || '').trim();
  const missingEnvVars: string[] = [];
  if (!clientId) missingEnvVars.push('VITE_GOOGLE_CLIENT_ID');

  return {
    configured: Boolean(clientId),
    clientId,
    apiKey,
    appId,
    pickerConfigured: Boolean(clientId && apiKey && appId),
    defaultScopes: [...DEFAULT_GOOGLE_SCOPES],
    optionalScopes: {
      gmailSend: GOOGLE_GMAIL_SEND_SCOPE,
      sheetsWrite: GOOGLE_SHEETS_FULL_SCOPE,
    },
    missingEnvVars,
  };
}

/**
 * Fetches public Google OAuth client configuration from `/api/google/config`
 * (falling back cleanly to Vite build-time public env vars if needed).
 */
export async function fetchGoogleClientConfig(
  options?: { forceRefresh?: boolean; fetchImpl?: typeof fetch }
): Promise<GoogleClientConfig> {
  if (cachedClientConfig && !options?.forceRefresh) {
    return cachedClientConfig;
  }

  const localFallback = readBuildTimeGoogleConfig();
  const fetchImpl = options?.fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);

  if (fetchImpl) {
    try {
      const res = await fetchImpl('/api/google/config', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as Partial<GoogleClientConfig>;
        const clientId = String(data.clientId || localFallback.clientId || '').trim();
        const apiKey = String(data.apiKey || localFallback.apiKey || '').trim();
        const appId = String(data.appId || localFallback.appId || '').trim();
        const missingEnvVars: string[] = [];
        if (!clientId) missingEnvVars.push('VITE_GOOGLE_CLIENT_ID');

        cachedClientConfig = {
          configured: Boolean(clientId),
          clientId,
          apiKey,
          appId,
          pickerConfigured: Boolean(clientId && apiKey && appId),
          defaultScopes:
            Array.isArray(data.defaultScopes) && data.defaultScopes.length > 0
              ? data.defaultScopes
              : [...DEFAULT_GOOGLE_SCOPES],
          optionalScopes: {
            gmailSend: data.optionalScopes?.gmailSend || GOOGLE_GMAIL_SEND_SCOPE,
            sheetsWrite: data.optionalScopes?.sheetsWrite || GOOGLE_SHEETS_FULL_SCOPE,
          },
          missingEnvVars,
        };
        return cachedClientConfig;
      }
    } catch {
      // Fallback to Vite env config
    }
  }

  cachedClientConfig = localFallback;
  return localFallback;
}

export function getCachedGoogleClientConfig(): GoogleClientConfig {
  return cachedClientConfig || readBuildTimeGoogleConfig();
}

/**
 * Builds a clean, deduplicated Google Identity Services scope list.
 */
export function buildGisScopeList(options?: {
  includeDrive?: boolean;
  includeSheets?: boolean;
  includeGmail?: boolean;
  extraScopes?: string[];
}): string[] {
  const scopes = new Set<string>([...GOOGLE_IDENTITY_SCOPES]);
  if (options?.includeDrive !== false) {
    scopes.add(GOOGLE_DRIVE_FILE_SCOPE);
  }
  if (options?.includeSheets !== false) {
    scopes.add(GOOGLE_SHEETS_READONLY_SCOPE);
  }
  if (options?.includeGmail) {
    scopes.add(GOOGLE_GMAIL_SEND_SCOPE);
  }
  if (Array.isArray(options?.extraScopes)) {
    for (const s of options.extraScopes) {
      if (s && s.trim()) scopes.add(s.trim());
    }
  }
  return Array.from(scopes);
}

/**
 * Loads the official Google Identity Services browser script (`accounts.google.com/gsi/client`).
 */
export function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new GoogleAuthError('GIS_SCRIPT_FAILED', 'Google Identity Services requires a browser environment.')
    );
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          gisLoadPromise = null;
          reject(
            new GoogleAuthError(
              'GIS_SCRIPT_FAILED',
              'Failed to load Google Identity Services. Check your internet connection or browser content blockers.'
            )
          );
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        gisLoadPromise = null;
        reject(
          new GoogleAuthError(
            'GIS_SCRIPT_FAILED',
            'Google Identity Services loaded but OAuth2 client is unavailable.'
          )
        );
      }
    };
    script.onerror = () => {
      gisLoadPromise = null;
      reject(
        new GoogleAuthError(
          'GIS_SCRIPT_FAILED',
          'Could not load Google Identity Services script (accounts.google.com/gsi/client).'
        )
      );
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

/**
 * Strictly in-memory Google OAuth session store (exported for isolated unit testing).
 * Access tokens NEVER touch localStorage, sessionStorage, IndexedDB, or cookies.
 */
export class GoogleSessionStore {
  private accessToken: string | null = null;
  private session: GoogleVerifiedSession | null = null;
  private expired = false;
  private listeners = new Set<GoogleSessionListener>();
  private expiryListeners = new Set<() => void>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly EXPIRY_BUFFER_MS = 30_000;

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  private clearTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  activate(accessToken: string, session: GoogleVerifiedSession): GoogleVerifiedSession {
    this.clearTimer();
    this.accessToken = accessToken;
    this.session = {
      ...session,
      grantedScopes: [...session.grantedScopes],
      permissions: { ...session.permissions },
    };
    this.expired = false;

    const ttlMs = Math.max(60_000, session.expiresAt - Date.now());
    const notifyDelay = Math.max(1000, ttlMs - this.EXPIRY_BUFFER_MS);
    if (typeof setTimeout !== 'undefined') {
      this.expiryTimer = setTimeout(() => {
        if (this.accessToken && this.session && Date.now() >= this.session.expiresAt - this.EXPIRY_BUFFER_MS) {
          this.markExpired();
        }
      }, notifyDelay);
      if (typeof (this.expiryTimer as any)?.unref === 'function') {
        (this.expiryTimer as any).unref();
      }
    }

    this.emit();
    return this.session;
  }

  getSession(): GoogleVerifiedSession | null {
    return this.session;
  }

  getSnapshot(): GoogleSessionSnapshot {
    return {
      session: this.session,
      hasActiveToken: this.isTokenValid(),
      expired: this.expired,
    };
  }

  isTokenValid(now: number = Date.now()): boolean {
    if (!this.accessToken || !this.session) return false;
    return now < this.session.expiresAt - this.EXPIRY_BUFFER_MS;
  }

  getAccessToken(now: number = Date.now()): string | null {
    if (!this.accessToken || !this.session) return null;
    if (now >= this.session.expiresAt - this.EXPIRY_BUFFER_MS) {
      this.markExpired();
      return null;
    }
    return this.accessToken;
  }

  requireAccessToken(now: number = Date.now()): string {
    const token = this.getAccessToken(now);
    if (!token) {
      throw new GoogleAuthError(
        'GOOGLE_TOKEN_EXPIRED',
        'Your Google authorization has expired or is not active. Click Connect / Reconnect Google Account to continue.'
      );
    }
    return token;
  }

  hasScope(scope: string): boolean {
    if (!this.session) return false;
    return this.session.grantedScopes.includes(scope);
  }

  getPermissions(): GooglePermissionFlags {
    if (!this.session) {
      return {
        identityConnected: false,
        driveGranted: false,
        sheetsGranted: false,
        gmailGranted: false,
      };
    }
    return { ...this.session.permissions };
  }

  markExpired(): void {
    this.clearTimer();
    const hadToken = Boolean(this.accessToken);
    this.accessToken = null;
    this.expired = Boolean(this.session);
    if (hadToken) {
      for (const listener of this.expiryListeners) {
        try {
          listener();
        } catch {
          // Ignore subscriber errors
        }
      }
    }
    this.emit();
  }

  clear(): string | null {
    this.clearTimer();
    const prevToken = this.accessToken;
    this.accessToken = null;
    this.session = null;
    this.expired = false;
    this.emit();
    return prevToken;
  }

  subscribe(listener: GoogleSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onExpired(listener: () => void): () => void {
    this.expiryListeners.add(listener);
    return () => {
      this.expiryListeners.delete(listener);
    };
  }
}

export const googleSessionStore = new GoogleSessionStore();

/**
 * Verifies a received temporary access token with the backend (`POST /api/google/verify-session`)
 * and activates the verified session strictly in module memory.
 */
export async function verifyAndActivateToken(
  accessToken: string,
  options?: { fetchImpl?: typeof fetch; store?: GoogleSessionStore }
): Promise<GoogleVerifiedSession> {
  const fetchImpl = options?.fetchImpl || fetch;
  const store = options?.store || googleSessionStore;

  const res = await fetchImpl('/api/google/verify-session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });

  const text = await res.text().catch(() => '');
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (res.status === 401) {
    store.markExpired();
    throw new GoogleAuthError(
      'GOOGLE_TOKEN_EXPIRED',
      parsed.error || 'Google rejected or expired the access token. Please reconnect your Google account.'
    );
  }

  if (!res.ok || !parsed?.session?.sub || !parsed?.session?.email) {
    throw new GoogleAuthError(
      'TOKEN_VERIFICATION_FAILED',
      parsed.error || `Backend token verification failed (HTTP ${res.status}).`
    );
  }

  const verified: GoogleVerifiedSession = {
    sub: String(parsed.session.sub),
    email: String(parsed.session.email),
    name: parsed.session.name ? String(parsed.session.name) : undefined,
    picture: parsed.session.picture ? String(parsed.session.picture) : undefined,
    emailVerified: Boolean(parsed.session.emailVerified),
    grantedScopes: Array.isArray(parsed.session.grantedScopes)
      ? parsed.session.grantedScopes
      : [],
    expiresIn: Number(parsed.session.expiresIn || 3600),
    expiresAt: Number(parsed.session.expiresAt || Date.now() + 3600 * 1000),
    permissions: {
      identityConnected: Boolean(parsed.session.permissions?.identityConnected),
      driveGranted: Boolean(parsed.session.permissions?.driveGranted),
      sheetsGranted: Boolean(parsed.session.permissions?.sheetsGranted),
      gmailGranted: Boolean(parsed.session.permissions?.gmailGranted),
    },
  };

  return store.activate(accessToken, verified);
}

async function requestGisAccessTokenRaw(options: {
  clientId: string;
  scopes: string[];
  includeGrantedScopes?: boolean;
  prompt?: '' | 'consent' | 'select_account';
  loginHint?: string;
}): Promise<GisTokenResponse> {
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new GoogleAuthError(
      'GIS_SCRIPT_FAILED',
      'Google Identity Services OAuth client is unavailable.'
    );
  }

  const scopeStr = options.scopes.join(' ');
  return new Promise<GisTokenResponse>((resolve, reject) => {
    let settled = false;
    const tokenClient = oauth2.initTokenClient({
      client_id: options.clientId,
      scope: scopeStr,
      include_granted_scopes: options.includeGrantedScopes ?? true,
      prompt: options.prompt,
      hint: options.loginHint,
      callback: (resp) => {
        if (settled) return;
        settled = true;
        if (resp?.error) {
          if (resp.error === 'access_denied') {
            reject(
              new GoogleAuthError(
                'OAUTH_ACCESS_DENIED',
                'Google authorization was declined. Approve the requested permissions to connect your Google account.'
              )
            );
            return;
          }
          reject(
            new GoogleAuthError(
              'OAUTH_TOKEN_ERROR',
              resp.error_description || `Google authorization failed (${resp.error}).`
            )
          );
          return;
        }
        if (!resp?.access_token) {
          reject(
            new GoogleAuthError(
              'OAUTH_TOKEN_ERROR',
              'Google authorization completed without returning an access token.'
            )
          );
          return;
        }
        resolve(resp);
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        if (err?.type === 'popup_closed') {
          reject(
            new GoogleAuthError(
              'OAUTH_CANCELLED',
              'Google authorization popup was closed before completing.'
            )
          );
          return;
        }
        if (err?.type === 'popup_failed_to_open') {
          reject(
            new GoogleAuthError(
              'OAUTH_TOKEN_ERROR',
              'Popup was blocked by your browser. Allow popups for this site and click Connect Google Account again.'
            )
          );
          return;
        }
        reject(
          new GoogleAuthError(
            'OAUTH_TOKEN_ERROR',
            err?.message || 'Google authorization could not be completed.'
          )
        );
      },
    });

    tokenClient.requestAccessToken({
      prompt: options.prompt ?? 'select_account',
      scope: scopeStr,
      include_granted_scopes: options.includeGrantedScopes ?? true,
      hint: options.loginHint,
    });
  });
}

/**
 * Interactive Google Identity Services connection flow:
 * 1. Fetches public OAuth client ID from `/api/google/config`.
 * 2. Requests short-lived access token via `google.accounts.oauth2.initTokenClient()`.
 * 3. Verifies token and account `sub`/profile/permissions with `/api/google/verify-session`.
 * 4. Activates session strictly in module memory.
 */
export async function signInWithGoogle(options?: {
  scopes?: string[];
  includeGmail?: boolean;
  includeGrantedScopes?: boolean;
  prompt?: '' | 'consent' | 'select_account';
  loginHint?: string;
}): Promise<{ accessToken: string; session: GoogleVerifiedSession }> {
  const cfg = await fetchGoogleClientConfig();
  if (!cfg.configured || !cfg.clientId) {
    throw new GoogleAuthError(
      'OAUTH_NOT_CONFIGURED',
      'Google OAuth is not configured on this deployment yet. Set VITE_GOOGLE_CLIENT_ID in your environment variables.'
    );
  }

  const scopes =
    options?.scopes && options.scopes.length > 0
      ? options.scopes
      : buildGisScopeList({
          includeDrive: true,
          includeSheets: true,
          includeGmail: Boolean(options?.includeGmail),
        });

  const tokenResp = await requestGisAccessTokenRaw({
    clientId: cfg.clientId,
    scopes,
    includeGrantedScopes: options?.includeGrantedScopes ?? true,
    prompt: options?.prompt ?? 'select_account',
    loginHint: options?.loginHint,
  });

  const accessToken = tokenResp.access_token!;
  const session = await verifyAndActivateToken(accessToken);
  return { accessToken, session };
}

/**
 * Incrementally requests `https://www.googleapis.com/auth/gmail.send` while preserving
 * previously granted Drive and Sheets scopes (`include_granted_scopes: true`).
 */
export async function requestGmailConsent(
  loginHint?: string
): Promise<{ accessToken: string; session: GoogleVerifiedSession }> {
  const current = googleSessionStore.getSession();
  const hint = loginHint || current?.email || undefined;
  return signInWithGoogle({
    scopes: [GOOGLE_GMAIL_SEND_SCOPE],
    includeGrantedScopes: true,
    prompt: 'consent',
    loginHint: hint,
  });
}

/**
 * Incrementally requests Google Sheets read permission if missing.
 */
export async function requestSheetsConsent(
  loginHint?: string
): Promise<{ accessToken: string; session: GoogleVerifiedSession }> {
  const current = googleSessionStore.getSession();
  const hint = loginHint || current?.email || undefined;
  return signInWithGoogle({
    scopes: buildGisScopeList({ includeDrive: true, includeSheets: true }),
    includeGrantedScopes: true,
    prompt: 'consent',
    loginHint: hint,
  });
}

/**
 * Incrementally requests Google Drive `drive.file` permission if missing.
 */
export async function requestDriveConsent(
  loginHint?: string
): Promise<{ accessToken: string; session: GoogleVerifiedSession }> {
  const current = googleSessionStore.getSession();
  const hint = loginHint || current?.email || undefined;
  return signInWithGoogle({
    scopes: buildGisScopeList({ includeDrive: true, includeSheets: true }),
    includeGrantedScopes: true,
    prompt: 'consent',
    loginHint: hint,
  });
}

export function getGoogleSession(): GoogleVerifiedSession | null {
  return googleSessionStore.getSession();
}

export function getAccessToken(): string | null {
  return googleSessionStore.getAccessToken();
}

export function markGoogleSessionExpired(): void {
  googleSessionStore.markExpired();
}

export function subscribeGoogleSession(listener: GoogleSessionListener): () => void {
  return googleSessionStore.subscribe(listener);
}

/**
 * Signs out / disconnects Google cleanly:
 * - Clears in-memory token & session immediately.
 * - Best-effort revokes token via backend `/api/google/revoke` AND GIS `google.accounts.oauth2.revoke`.
 */
export async function signOutGoogle(): Promise<void> {
  const token = googleSessionStore.clear();
  if (!token) return;

  try {
    await fetch('/api/google/revoke', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Best-effort revocation
  }

  try {
    if (typeof window !== 'undefined' && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(token, () => {});
    }
  } catch {
    // Ignore GIS revoke errors
  }
}
