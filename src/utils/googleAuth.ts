/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backward-compatible facade over `googleAuthClient.ts`.
 * All new code should prefer importing directly from `./googleAuthClient`.
 */

import {
  DEFAULT_GOOGLE_SCOPES,
  fetchGoogleClientConfig,
  getCachedGoogleClientConfig,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_SHEETS_READONLY_SCOPE,
  GoogleAuthError,
  googleSessionStore,
  GoogleSessionStore,
  loadGisScript,
  requestGmailConsent,
  requestSheetsConsent,
  signInWithGoogle,
  signOutGoogle,
} from './googleAuthClient';
import { GoogleVerifiedSession } from '../types';

export {
  DEFAULT_GOOGLE_SCOPES,
  fetchGoogleClientConfig,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_SHEETS_READONLY_SCOPE,
  GoogleAuthError,
  googleSessionStore,
  GoogleSessionStore,
  loadGisScript,
  requestGmailConsent,
  requestSheetsConsent,
  signInWithGoogle,
  signOutGoogle,
};

export const INITIAL_DRIVE_SCOPES = DEFAULT_GOOGLE_SCOPES;

export interface GooglePublicConfig {
  clientId: string;
  apiKey: string;
  appId: string;
  isOAuthConfigured: boolean;
  isPickerConfigured: boolean;
  missingClientEnvVars: string[];
}

export interface GoogleAuthSession {
  sub: string;
  accountEmail: string;
  accountName?: string;
  grantedScopes: string[];
  expiresAt: number;
  hasDriveScope: boolean;
  hasSheetsScope: boolean;
  hasGmailScope: boolean;
}

export function getGooglePublicConfig(): GooglePublicConfig {
  const cfg = getCachedGoogleClientConfig();
  return {
    clientId: cfg.clientId,
    apiKey: cfg.apiKey,
    appId: cfg.appId,
    isOAuthConfigured: cfg.configured,
    isPickerConfigured: cfg.pickerConfigured,
    missingClientEnvVars: cfg.missingEnvVars,
  };
}

export function loadGoogleIdentityScript(): Promise<void> {
  return loadGisScript();
}

export function toLegacyAuthSession(s: GoogleVerifiedSession | null): GoogleAuthSession | null {
  if (!s) return null;
  return {
    sub: s.sub,
    accountEmail: s.email,
    accountName: s.name,
    grantedScopes: s.grantedScopes,
    expiresAt: s.expiresAt,
    hasDriveScope: s.permissions.driveGranted,
    hasSheetsScope: s.permissions.sheetsGranted,
    hasGmailScope: s.permissions.gmailGranted,
  };
}

/**
 * Pure in-memory token store (class kept for backward-compatible unit tests).
 */
export class InMemoryGoogleTokenManager {
  private readonly store: GoogleSessionStore;

  constructor(store?: GoogleSessionStore) {
    this.store = store || new GoogleSessionStore();
  }

  setSession(params: {
    accessToken: string;
    expiresInSeconds: number;
    scopeString?: string;
    accountEmail?: string;
    accountName?: string;
    sub?: string;
  }): GoogleAuthSession {
    const existingScopes = this.store.getSession()?.grantedScopes || [];
    const newScopes = params.scopeString
      ? params.scopeString
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const mergedScopes = Array.from(new Set([...existingScopes, ...newScopes]));
    const email = (params.accountEmail ?? this.store.getSession()?.email ?? '').trim();
    const sub = (params.sub ?? this.store.getSession()?.sub ?? (email ? `sub_${email}` : '')).trim();
    const ttlMs = Math.max(60, Number(params.expiresInSeconds) || 3600) * 1000;
    const verified = this.store.activate(params.accessToken, {
      sub,
      email,
      name: params.accountName ?? this.store.getSession()?.name,
      grantedScopes: mergedScopes,
      expiresIn: Math.floor(ttlMs / 1000),
      expiresAt: Date.now() + ttlMs,
      permissions: {
        identityConnected: Boolean(sub && email),
        driveGranted:
          mergedScopes.includes(GOOGLE_DRIVE_FILE_SCOPE) ||
          mergedScopes.includes('https://www.googleapis.com/auth/drive'),
        sheetsGranted:
          mergedScopes.includes(GOOGLE_SHEETS_READONLY_SCOPE) ||
          mergedScopes.includes('https://www.googleapis.com/auth/spreadsheets'),
        gmailGranted: mergedScopes.includes(GOOGLE_GMAIL_SEND_SCOPE),
      },
    });
    return toLegacyAuthSession(verified)!;
  }

  isTokenValid(now: number = Date.now()): boolean {
    return this.store.isTokenValid(now);
  }

  getAccessToken(now: number = Date.now()): string | null {
    return this.store.getAccessToken(now);
  }

  requireAccessToken(now: number = Date.now()): string {
    return this.store.requireAccessToken(now);
  }

  hasScope(scope: string): boolean {
    return this.store.hasScope(scope);
  }

  getSessionInfo(): GoogleAuthSession | null {
    return toLegacyAuthSession(this.store.getSession());
  }

  markExpired(): void {
    this.store.markExpired();
  }

  clearAll(): void {
    this.store.clear();
  }

  onTokenExpired(listener: () => void): () => void {
    return this.store.onExpired(listener);
  }
}

export const googleTokenManager = new InMemoryGoogleTokenManager(googleSessionStore);

export async function requestGoogleOAuthToken(options?: {
  scopes?: string[];
  includeGrantedScopes?: boolean;
  prompt?: '' | 'consent' | 'select_account';
  loginHint?: string;
}): Promise<{ accessToken: string; session: GoogleAuthSession }> {
  const { accessToken, session } = await signInWithGoogle(options);
  return { accessToken, session: toLegacyAuthSession(session)! };
}

export async function authorizeGoogleSheetsAccess(): Promise<{
  accessToken: string;
  session: GoogleAuthSession;
}> {
  const existingToken = googleSessionStore.getAccessToken();
  const existingSession = googleSessionStore.getSession();
  if (existingToken && existingSession?.permissions.sheetsGranted && googleSessionStore.isTokenValid()) {
    return { accessToken: existingToken, session: toLegacyAuthSession(existingSession)! };
  }
  const { accessToken, session } = await requestSheetsConsent(existingSession?.email);
  return { accessToken, session: toLegacyAuthSession(session)! };
}

export function disconnectGoogleOAuth(): void {
  void signOutGoogle();
}
