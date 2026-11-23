/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AppServerConfig {
  googleClientId: string;
  googleApiKey: string;
  googleAppId: string;
  smtpEncryptionKey: string;
  appUrl: string;
  isProduction: boolean;
}

export interface IntegrationDiagnostics {
  authMode: 'google-gis-token-backend-verified';
  storageProvider: 'user-google-drive-oauth';
  gmailApiSupported: boolean;
  googleOAuthConfigured: boolean;
  googlePickerConfigured: boolean;
  smtpEncryptionConfigured: boolean;
  missingServerEnvVars: string[];
  appUrl: string;
}

export function cleanEnvString(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.replace(/\\r|\\n/g, '').trim();
}

export function resolveBaseAppUrl(requestOrigin?: string): string {
  const configuredAppUrl = cleanEnvString(process.env.APP_URL).replace(/\/+$/, '');
  if (configuredAppUrl && !configuredAppUrl.includes('MY_APP_URL')) {
    return configuredAppUrl;
  }
  if (requestOrigin) {
    return requestOrigin.replace(/\/+$/, '');
  }
  const vercelUrl = cleanEnvString(process.env.VERCEL_URL);
  if (vercelUrl) {
    return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
  }
  return 'http://localhost:3000';
}

export function getServerConfig(requestOrigin?: string): AppServerConfig {
  return {
    googleClientId: cleanEnvString(
      process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || ''
    ),
    googleApiKey: cleanEnvString(
      process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY || ''
    ),
    googleAppId: cleanEnvString(
      process.env.GOOGLE_APP_ID || process.env.VITE_GOOGLE_APP_ID || ''
    ),
    smtpEncryptionKey: cleanEnvString(
      process.env.SMTP_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY || ''
    ),
    appUrl: resolveBaseAppUrl(requestOrigin),
    isProduction: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
  };
}

export function getIntegrationDiagnostics(requestOrigin?: string): IntegrationDiagnostics {
  const cfg = getServerConfig(requestOrigin);
  const missingServerEnvVars: string[] = [];

  if (!cfg.googleClientId) {
    missingServerEnvVars.push('VITE_GOOGLE_CLIENT_ID');
  }
  if (!cfg.smtpEncryptionKey || cfg.smtpEncryptionKey.length < 16) {
    missingServerEnvVars.push('SMTP_ENCRYPTION_KEY');
  }

  return {
    authMode: 'google-gis-token-backend-verified',
    storageProvider: 'user-google-drive-oauth',
    gmailApiSupported: true,
    googleOAuthConfigured: Boolean(cfg.googleClientId),
    googlePickerConfigured: Boolean(cfg.googleClientId && cfg.googleApiKey && cfg.googleAppId),
    smtpEncryptionConfigured: cfg.smtpEncryptionKey.length >= 16,
    missingServerEnvVars,
    appUrl: cfg.appUrl,
  };
}
