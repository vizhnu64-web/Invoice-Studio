/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AppServerConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  sessionSecret: string;
  tokenEncryptionKey: string;
  appUrl: string;
  isProduction: boolean;
}

export interface IntegrationDiagnostics {
  googleOAuthConfigured: boolean;
  encryptionConfigured: boolean;
  sessionConfigured: boolean;
  redirectUri: string;
  missingEnvVars: string[];
  readyForGoogleSync: boolean;
  storageProvider: 'google-drive';
}

export type GoogleOAuthFeature = 'signin' | 'drive' | 'sheets' | 'gmail';

export const BASE_GOOGLE_SCOPES = ['openid', 'email', 'profile'] as const;
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const GOOGLE_GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Default sign-in includes Drive app-folder storage so user data persists immediately in Google Drive
export const SIGNIN_GOOGLE_SCOPES = [...BASE_GOOGLE_SCOPES, GOOGLE_DRIVE_SCOPE] as const;

export const REQUIRED_GOOGLE_SCOPES = [
  ...BASE_GOOGLE_SCOPES,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_SHEETS_SCOPE,
] as const;

export function getScopesForFeature(
  feature: GoogleOAuthFeature,
  existingScopes: string[] = []
): string[] {
  const scopeSet = new Set<string>([
    ...BASE_GOOGLE_SCOPES,
    GOOGLE_DRIVE_SCOPE,
    ...existingScopes.filter(Boolean),
  ]);
  if (feature === 'drive') {
    scopeSet.add(GOOGLE_DRIVE_SCOPE);
  } else if (feature === 'sheets') {
    scopeSet.add(GOOGLE_SHEETS_SCOPE);
  } else if (feature === 'gmail') {
    scopeSet.add(GOOGLE_GMAIL_SEND_SCOPE);
  }
  return Array.from(scopeSet);
}

export function hasDriveScope(scopes: string[]): boolean {
  return scopes.some(
    (s) => s === GOOGLE_DRIVE_SCOPE || s === 'https://www.googleapis.com/auth/drive'
  );
}

export function hasSheetsScope(scopes: string[]): boolean {
  return scopes.some(
    (s) =>
      s === GOOGLE_SHEETS_SCOPE ||
      s === 'https://www.googleapis.com/auth/spreadsheets'
  );
}

export function hasGmailSendScope(scopes: string[]): boolean {
  return scopes.some(
    (s) =>
      s === GOOGLE_GMAIL_SEND_SCOPE ||
      s === 'https://mail.google.com/' ||
      s === 'https://www.googleapis.com/auth/gmail.compose'
  );
}

export function resolveBaseAppUrl(requestOrigin?: string): string {
  const configuredAppUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configuredAppUrl && !configuredAppUrl.includes('MY_APP_URL')) {
    return configuredAppUrl;
  }
  if (requestOrigin) {
    return requestOrigin.replace(/\/+$/, '');
  }
  const vercelUrl = (process.env.VERCEL_URL || '').trim();
  if (vercelUrl) {
    return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
  }
  return 'http://localhost:3000';
}

export function getServerConfig(requestOrigin?: string): AppServerConfig {
  const appUrl = resolveBaseAppUrl(requestOrigin);
  const configuredRedirect = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  const googleRedirectUri =
    configuredRedirect && !configuredRedirect.includes('MY_')
      ? configuredRedirect
      : `${appUrl}/api/auth/google/callback`;

  return {
    googleClientId: (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    googleRedirectUri,
    sessionSecret: (process.env.SESSION_SECRET || '').trim(),
    tokenEncryptionKey: (process.env.TOKEN_ENCRYPTION_KEY || '').trim(),
    appUrl,
    isProduction: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
  };
}

export function getIntegrationDiagnostics(requestOrigin?: string): IntegrationDiagnostics {
  const cfg = getServerConfig(requestOrigin);
  const missingEnvVars: string[] = [];

  if (!cfg.googleClientId) missingEnvVars.push('GOOGLE_CLIENT_ID');
  if (!cfg.googleClientSecret) missingEnvVars.push('GOOGLE_CLIENT_SECRET');
  if (!cfg.sessionSecret) missingEnvVars.push('SESSION_SECRET');
  if (!cfg.tokenEncryptionKey) missingEnvVars.push('TOKEN_ENCRYPTION_KEY');

  const googleOAuthConfigured = Boolean(cfg.googleClientId && cfg.googleClientSecret);
  const encryptionConfigured = cfg.tokenEncryptionKey.length >= 16;
  const sessionConfigured = cfg.sessionSecret.length >= 16;

  return {
    googleOAuthConfigured,
    encryptionConfigured,
    sessionConfigured,
    redirectUri: cfg.googleRedirectUri,
    missingEnvVars,
    readyForGoogleSync: googleOAuthConfigured && encryptionConfigured && sessionConfigured,
    storageProvider: 'google-drive',
  };
}
