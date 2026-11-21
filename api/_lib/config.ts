/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AppServerConfig {
  googleServiceAccountEmail: string;
  googleServiceAccountPrivateKey: string;
  googleProjectId: string;
  smtpEncryptionKey: string;
  appUrl: string;
  isProduction: boolean;
}

export interface IntegrationDiagnostics {
  serviceAccountConfigured: boolean;
  serviceAccountEmail: string | null;
  projectId: string | null;
  smtpEncryptionConfigured: boolean;
  missingEnvVars: string[];
  readyForGoogleDrive: boolean;
  readyForGoogleSheets: boolean;
  storageProvider: 'google-drive-service-account';
}

export const GOOGLE_DRIVE_SERVICE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_SHEETS_SERVICE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export function normalizeServiceAccountPrivateKey(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  // Strip accidental surrounding quotes from .env / Vercel UI pastes and convert escaped \n
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.replace(/\\n/g, '\n').trim();
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

  return {
    googleServiceAccountEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    googleServiceAccountPrivateKey: normalizeServiceAccountPrivateKey(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ),
    googleProjectId: (process.env.GOOGLE_PROJECT_ID || '').trim(),
    smtpEncryptionKey: (
      process.env.SMTP_ENCRYPTION_KEY ||
      process.env.TOKEN_ENCRYPTION_KEY ||
      ''
    ).trim(),
    appUrl,
    isProduction: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
  };
}

export function getIntegrationDiagnostics(requestOrigin?: string): IntegrationDiagnostics {
  const cfg = getServerConfig(requestOrigin);
  const missingEnvVars: string[] = [];

  if (!cfg.googleServiceAccountEmail) missingEnvVars.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!cfg.googleServiceAccountPrivateKey) missingEnvVars.push('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (!cfg.smtpEncryptionKey || cfg.smtpEncryptionKey.length < 16) {
    missingEnvVars.push('SMTP_ENCRYPTION_KEY');
  }

  const serviceAccountConfigured = Boolean(
    cfg.googleServiceAccountEmail &&
      cfg.googleServiceAccountPrivateKey &&
      cfg.googleServiceAccountPrivateKey.includes('BEGIN')
  );
  const smtpEncryptionConfigured = cfg.smtpEncryptionKey.length >= 16;

  return {
    serviceAccountConfigured,
    serviceAccountEmail: cfg.googleServiceAccountEmail || null,
    projectId: cfg.googleProjectId || null,
    smtpEncryptionConfigured,
    missingEnvVars,
    readyForGoogleDrive: serviceAccountConfigured,
    readyForGoogleSheets: serviceAccountConfigured,
    storageProvider: 'google-drive-service-account',
  };
}
