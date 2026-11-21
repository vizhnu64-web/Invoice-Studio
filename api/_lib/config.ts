/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPrivateKey } from 'node:crypto';

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
  privateKeyFormatValid: boolean;
  privateKeyError: string | null;
  smtpEncryptionConfigured: boolean;
  missingEnvVars: string[];
  readyForGoogleDrive: boolean;
  readyForGoogleSheets: boolean;
  storageProvider: 'google-drive-service-account';
}

export const GOOGLE_DRIVE_SERVICE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_SHEETS_SERVICE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

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

export function normalizeServiceAccountPrivateKey(raw?: string): string {
  let value = (raw || '').trim();
  if (!value) return '';

  // Support accidental paste of full service-account JSON into the private key variable
  if (value.startsWith('{') && value.includes('"private_key"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed?.private_key === 'string') {
        value = parsed.private_key.trim();
      }
    } catch {
      // Fall through to standard PEM normalization
    }
  }

  // Unwrap accidental surrounding quotes (including JSON-stringified PEM values)
  while (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  // Normalize double-escaped \\n, single-escaped \n, and CRLF line endings
  value = value
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // If PEM header/footer exist on a single line with spaces instead of newlines, restore PEM formatting
  const pemMatch = value.match(
    /(-----BEGIN [A-Z ]+-----)([\s\S]+?)(-----END [A-Z ]+-----)/
  );
  if (pemMatch) {
    const [, header, body, footer] = pemMatch;
    const compactBody = body.replace(/\s+/g, '');
    const wrappedLines = compactBody.match(/.{1,64}/g) || [];
    return `${header}\n${wrappedLines.join('\n')}\n${footer}`;
  }

  return value;
}

export function validateServiceAccountPrivateKey(pem: string): {
  valid: boolean;
  reason: string | null;
} {
  if (!pem) {
    return {
      valid: false,
      reason: 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is empty or missing.',
    };
  }
  if (!pem.includes('-----BEGIN') || !pem.includes('-----END')) {
    return {
      valid: false,
      reason:
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY does not contain valid PEM BEGIN/END markers.',
    };
  }
  try {
    createPrivateKey({ key: pem, format: 'pem' });
    return { valid: true, reason: null };
  } catch (err: any) {
    return {
      valid: false,
      reason: `Private key failed PEM cryptographic parsing (${err?.code || err?.message || 'invalid key format'}). Re-copy the exact private_key value from the Google service account JSON file.`,
    };
  }
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
  const appUrl = resolveBaseAppUrl(requestOrigin);

  let fallbackEmail = '';
  let fallbackKey = '';
  let fallbackProject = '';
  const rawJson = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawJson);
      fallbackEmail = typeof parsed?.client_email === 'string' ? parsed.client_email : '';
      fallbackKey = typeof parsed?.private_key === 'string' ? parsed.private_key : '';
      fallbackProject = typeof parsed?.project_id === 'string' ? parsed.project_id : '';
    } catch {
      // Ignore malformed optional JSON fallback
    }
  }

  return {
    googleServiceAccountEmail: cleanEnvString(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || fallbackEmail
    ),
    googleServiceAccountPrivateKey: normalizeServiceAccountPrivateKey(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || fallbackKey
    ),
    googleProjectId: cleanEnvString(process.env.GOOGLE_PROJECT_ID || fallbackProject),
    smtpEncryptionKey: cleanEnvString(
      process.env.SMTP_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY || ''
    ),
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

  const keyValidation = cfg.googleServiceAccountPrivateKey
    ? validateServiceAccountPrivateKey(cfg.googleServiceAccountPrivateKey)
    : { valid: false, reason: 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set.' };

  const serviceAccountConfigured = Boolean(
    cfg.googleServiceAccountEmail && keyValidation.valid
  );
  const smtpEncryptionConfigured = cfg.smtpEncryptionKey.length >= 16;

  return {
    serviceAccountConfigured,
    serviceAccountEmail: cfg.googleServiceAccountEmail || null,
    projectId: cfg.googleProjectId || null,
    privateKeyFormatValid: keyValidation.valid,
    privateKeyError: cfg.googleServiceAccountPrivateKey ? keyValidation.reason : null,
    smtpEncryptionConfigured,
    missingEnvVars,
    readyForGoogleDrive: serviceAccountConfigured,
    readyForGoogleSheets: serviceAccountConfigured,
    storageProvider: 'google-drive-service-account',
  };
}

