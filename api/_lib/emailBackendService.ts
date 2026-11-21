/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import nodemailer from 'nodemailer';
import { AppServerConfig } from './config.js';
import { decryptSecret, encryptSecret, generateRandomId } from './crypto.js';
import {
  GoogleDriveStore,
  SmtpProviderType,
  StoredEmailLogEntry,
  StoredSmtpConfig,
} from './driveStore.js';
import { HttpApiError } from './errors.js';

export interface PublicSmtpConfig {
  configured: boolean;
  persistedInDrive: boolean;
  provider: SmtpProviderType;
  host: string;
  port: number;
  encryption: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  hasPassword: boolean;
  updatedAt?: string;
  lastVerifiedAt?: string;
}

export interface EmailSendItemInput {
  documentType: 'invoice' | 'quotation';
  documentNumber: string;
  customerName: string;
  recipientEmail: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  pdfBase64?: string;
  pdfFilename?: string;
}

export interface EmailSendItemResult {
  documentNumber: string;
  recipientEmail: string;
  status: 'Sent' | 'Failed';
  messageId?: string;
  error?: string;
  deliveryMethod: SmtpProviderType;
  sentAt: string;
}

/**
 * Ephemeral server-side memory store for workspaces without a connected Google Drive folder.
 * Passwords remain AES-256-GCM encrypted in memory and are scoped strictly by workspaceSessionId.
 */
const ephemeralSmtpStore = new Map<string, StoredSmtpConfig>();

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
}

function normalizeEmailList(raw?: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parts = raw
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (!isValidEmailAddress(part)) {
      throw new HttpApiError(400, 'INVALID_EMAIL_ADDRESS', `Invalid email address: "${part}".`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPlainTextAsHtml(body: string): string {
  const safe = escapeHtml(body).replace(/\r\n/g, '\n').replace(/\n/g, '<br />');
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b; max-width: 640px;">${safe}</div>`;
}

function getEffectiveEncryptionKey(config: AppServerConfig, sessionId?: string): string {
  if (config.smtpEncryptionKey && config.smtpEncryptionKey.length >= 16) {
    return config.smtpEncryptionKey;
  }
  // Ephemeral sessions without Drive still encrypt in memory using a process-scoped fallback;
  // Drive persistence strictly requires SMTP_ENCRYPTION_KEY on the server.
  if (sessionId) {
    return `ephemeral-only-${process.pid}-${sessionId}-invoice-studio`;
  }
  throw new HttpApiError(
    503,
    'SMTP_ENCRYPTION_KEY_MISSING',
    'Server SMTP_ENCRYPTION_KEY is not configured (minimum 16 characters required) to securely store SMTP credentials.'
  );
}

async function readStoredSmtp(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
}): Promise<{ stored: StoredSmtpConfig | null; persistedInDrive: boolean }> {
  if (options.driveStore) {
    const stored = await options.driveStore.readSmtpConfig();
    return { stored, persistedInDrive: true };
  }
  if (options.sessionId) {
    return { stored: ephemeralSmtpStore.get(options.sessionId) || null, persistedInDrive: false };
  }
  return { stored: null, persistedInDrive: false };
}

export async function getPublicSmtpConfig(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
}): Promise<PublicSmtpConfig> {
  const { stored, persistedInDrive } = await readStoredSmtp(options);
  if (!stored) {
    return {
      configured: false,
      persistedInDrive,
      provider: 'gmail_smtp',
      host: 'smtp.gmail.com',
      port: 465,
      encryption: 'SSL',
      username: '',
      senderName: '',
      senderEmail: '',
      replyTo: '',
      hasPassword: false,
    };
  }

  return {
    configured: Boolean(stored.host && stored.username && stored.encryptedPassword),
    persistedInDrive,
    provider: stored.provider || (stored.host === 'smtp.gmail.com' ? 'gmail_smtp' : 'custom_smtp'),
    host: stored.host,
    port: stored.port,
    encryption: stored.encryption,
    username: stored.username,
    senderName: stored.senderName,
    senderEmail: stored.senderEmail,
    replyTo: stored.replyTo || '',
    hasPassword: Boolean(stored.encryptedPassword),
    updatedAt: stored.updatedAt,
    lastVerifiedAt: stored.lastVerifiedAt,
  };
}

export async function saveSmtpConfig(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
  config: AppServerConfig;
  input: {
    provider?: SmtpProviderType;
    host: string;
    port: number;
    encryption: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password?: string;
    senderName: string;
    senderEmail: string;
    replyTo?: string;
  };
}): Promise<PublicSmtpConfig> {
  const provider: SmtpProviderType =
    options.input.provider === 'custom_smtp' ? 'custom_smtp' : 'gmail_smtp';
  const host = provider === 'gmail_smtp' ? 'smtp.gmail.com' : (options.input.host || '').trim();
  const port = Number(options.input.port || (provider === 'gmail_smtp' ? 465 : 587));
  const encryption =
    options.input.encryption || (port === 465 ? 'SSL' : 'STARTTLS');
  const username = (options.input.username || '').trim();
  const senderName = (options.input.senderName || '').trim();
  const senderEmail = (options.input.senderEmail || username).trim();
  const replyTo = (options.input.replyTo || '').trim();

  if (!host) {
    throw new HttpApiError(400, 'INVALID_SMTP_HOST', 'SMTP host is required (e.g. smtp.gmail.com).');
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new HttpApiError(400, 'INVALID_SMTP_PORT', 'SMTP port must be between 1 and 65535.');
  }
  if (!username) {
    throw new HttpApiError(
      400,
      'INVALID_SMTP_USER',
      provider === 'gmail_smtp'
        ? 'Your Gmail address is required as the SMTP username.'
        : 'SMTP username is required.'
    );
  }
  if (!isValidEmailAddress(senderEmail)) {
    throw new HttpApiError(400, 'INVALID_SENDER_EMAIL', 'Please enter a valid Sender Email address.');
  }
  if (replyTo && !isValidEmailAddress(replyTo)) {
    throw new HttpApiError(400, 'INVALID_REPLY_TO', 'Reply-To must be a valid email address.');
  }

  if (options.driveStore) {
    await options.driveStore.writeSmtpConfig({
      provider,
      host,
      port,
      encryption,
      username,
      password: options.input.password,
      senderName: senderName || 'Invoice Studio',
      senderEmail,
      replyTo: replyTo || undefined,
    });
    return getPublicSmtpConfig({ driveStore: options.driveStore });
  }

  if (!options.sessionId) {
    throw new HttpApiError(
      400,
      'WORKSPACE_SESSION_REQUIRED',
      'Missing workspace session identifier. Refresh the page and try again.'
    );
  }

  const existing = ephemeralSmtpStore.get(options.sessionId);
  const encKey = getEffectiveEncryptionKey(options.config, options.sessionId);
  let encryptedPassword = existing?.encryptedPassword || '';

  if (options.input.password && options.input.password.trim()) {
    encryptedPassword = encryptSecret(options.input.password.trim(), encKey);
  }
  if (!encryptedPassword) {
    throw new HttpApiError(
      400,
      'SMTP_PASSWORD_REQUIRED',
      provider === 'gmail_smtp'
        ? 'A 16-character Gmail App Password is required.'
        : 'An SMTP password is required.'
    );
  }

  const record: StoredSmtpConfig = {
    provider,
    host,
    port,
    encryption,
    username,
    encryptedPassword,
    senderName: senderName || 'Invoice Studio',
    senderEmail,
    replyTo: replyTo || undefined,
    updatedAt: new Date().toISOString(),
    lastVerifiedAt: existing?.lastVerifiedAt,
  };

  ephemeralSmtpStore.set(options.sessionId, record);
  return getPublicSmtpConfig({ sessionId: options.sessionId });
}

export async function deleteSmtpConfig(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
}): Promise<void> {
  if (options.driveStore) {
    await options.driveStore.deleteSmtpConfig();
  }
  if (options.sessionId) {
    ephemeralSmtpStore.delete(options.sessionId);
  }
}

async function resolveActiveSmtpCredentials(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
  config: AppServerConfig;
  override?: {
    provider?: SmtpProviderType;
    host?: string;
    port?: number;
    encryption?: 'SSL' | 'STARTTLS' | 'NONE';
    username?: string;
    password?: string;
    senderName?: string;
    senderEmail?: string;
    replyTo?: string;
  };
}): Promise<{
  provider: SmtpProviderType;
  host: string;
  port: number;
  encryption: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  password: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  persistedInDrive: boolean;
}> {
  const { stored, persistedInDrive } = await readStoredSmtp(options);
  const override = options.override;

  const provider: SmtpProviderType =
    override?.provider || stored?.provider || 'gmail_smtp';
  const host =
    provider === 'gmail_smtp'
      ? 'smtp.gmail.com'
      : (override?.host || stored?.host || '').trim();
  const port = Number(override?.port || stored?.port || 465);
  const encryption = override?.encryption || stored?.encryption || (port === 465 ? 'SSL' : 'STARTTLS');
  const username = (override?.username || stored?.username || '').trim();
  const senderName = (override?.senderName || stored?.senderName || 'Invoice Studio').trim();
  const senderEmail = (override?.senderEmail || stored?.senderEmail || username).trim();
  const replyTo = (override?.replyTo ?? stored?.replyTo ?? '').trim() || undefined;

  let password = (override?.password || '').trim();
  if (!password && stored?.encryptedPassword) {
    if (options.driveStore) {
      password = options.driveStore.decryptSmtpPassword(stored);
    } else if (options.sessionId) {
      password = decryptSecret(
        stored.encryptedPassword,
        getEffectiveEncryptionKey(options.config, options.sessionId)
      );
    }
  }

  if (!host || !username || !password) {
    throw new HttpApiError(
      400,
      'SMTP_NOT_CONFIGURED',
      'Email settings are not configured yet. Open Google Drive & Email Settings to configure Gmail SMTP or Custom SMTP.'
    );
  }

  return {
    provider,
    host,
    port,
    encryption,
    username,
    password,
    senderName,
    senderEmail,
    replyTo,
    persistedInDrive,
  };
}

function buildNodemailerTransport(creds: {
  host: string;
  port: number;
  encryption: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  password: string;
}) {
  return nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.encryption === 'SSL' || creds.port === 465,
    requireTLS: creds.encryption === 'STARTTLS',
    auth: {
      user: creds.username,
      pass: creds.password,
    },
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 18000,
  });
}

function formatSmtpErrorMessage(err: any, provider: SmtpProviderType): string {
  const msg = String(err?.response || err?.message || 'SMTP connection failed.');
  if (
    provider === 'gmail_smtp' &&
    (msg.includes('535') || msg.toLowerCase().includes('username and password not accepted'))
  ) {
    return 'Gmail rejected the credentials. Make sure 2-Step Verification is enabled on your Google account and use a 16-character Gmail App Password instead of your normal Gmail password.';
  }
  return msg;
}

export async function testSmtpConnection(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
  config: AppServerConfig;
  override?: Parameters<typeof resolveActiveSmtpCredentials>[0]['override'];
}): Promise<{ ok: boolean; host: string; port: number; provider: SmtpProviderType; verifiedAt: string }> {
  const creds = await resolveActiveSmtpCredentials(options);
  const transport = buildNodemailerTransport(creds);

  try {
    await transport.verify();
  } catch (err: any) {
    throw new HttpApiError(
      400,
      'SMTP_VERIFY_FAILED',
      formatSmtpErrorMessage(err, creds.provider)
    );
  } finally {
    transport.close();
  }

  const verifiedAt = new Date().toISOString();
  if (options.driveStore) {
    const existing = await options.driveStore.readSmtpConfig();
    if (existing) {
      await options.driveStore.writeSmtpConfig({
        provider: existing.provider,
        host: existing.host,
        port: existing.port,
        encryption: existing.encryption,
        username: existing.username,
        senderName: existing.senderName,
        senderEmail: existing.senderEmail,
        replyTo: existing.replyTo,
        lastVerifiedAt: verifiedAt,
      });
    }
  } else if (options.sessionId) {
    const existing = ephemeralSmtpStore.get(options.sessionId);
    if (existing) {
      ephemeralSmtpStore.set(options.sessionId, { ...existing, lastVerifiedAt: verifiedAt });
    }
  }

  return {
    ok: true,
    host: creds.host,
    port: creds.port,
    provider: creds.provider,
    verifiedAt,
  };
}

export async function sendTestEmail(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
  config: AppServerConfig;
  recipientEmail: string;
}): Promise<{ ok: boolean; messageId?: string; provider: SmtpProviderType; sentAt: string }> {
  const recipient = (options.recipientEmail || '').trim();
  if (!isValidEmailAddress(recipient)) {
    throw new HttpApiError(400, 'INVALID_RECIPIENT', 'Please enter a valid recipient email address.');
  }

  const creds = await resolveActiveSmtpCredentials(options);
  const transport = buildNodemailerTransport(creds);

  try {
    const info = await transport.sendMail({
      from: `"${creds.senderName.replace(/"/g, '')}" <${creds.senderEmail}>`,
      to: recipient,
      replyTo: creds.replyTo || undefined,
      subject: 'Invoice Studio — SMTP Test Email',
      text: `This is a test email from Invoice Studio confirming your ${creds.provider === 'gmail_smtp' ? 'Gmail SMTP' : 'Custom SMTP'} configuration (${creds.host}:${creds.port}) is working properly.`,
      html: formatPlainTextAsHtml(
        `This is a test email from Invoice Studio confirming your ${creds.provider === 'gmail_smtp' ? 'Gmail SMTP' : 'Custom SMTP'} configuration (${creds.host}:${creds.port}) is working properly.`
      ),
    });

    const sentAt = new Date().toISOString();
    if (options.driveStore) {
      await options.driveStore.appendEmailLogs([
        {
          id: `mail_${generateRandomId(8)}`,
          documentType: 'test',
          documentNumber: 'SMTP-TEST',
          customerName: 'Test Recipient',
          recipientEmail: recipient,
          subject: 'Invoice Studio — SMTP Test Email',
          deliveryMethod: creds.provider,
          status: 'Sent',
          messageId: info.messageId,
          sentAt,
        },
      ]);
    }

    return {
      ok: true,
      messageId: info.messageId,
      provider: creds.provider,
      sentAt,
    };
  } catch (err: any) {
    throw new HttpApiError(
      400,
      'SMTP_TEST_SEND_FAILED',
      formatSmtpErrorMessage(err, creds.provider)
    );
  } finally {
    transport.close();
  }
}

export async function dispatchSmtpEmails(options: {
  driveStore?: GoogleDriveStore | null;
  sessionId?: string;
  config: AppServerConfig;
  items: EmailSendItemInput[];
}): Promise<{
  results: EmailSendItemResult[];
  logs: StoredEmailLogEntry[];
  persistedInDrive: boolean;
}> {
  if (!Array.isArray(options.items) || options.items.length === 0) {
    throw new HttpApiError(400, 'NO_EMAIL_ITEMS', 'At least one email item is required.');
  }
  if (options.items.length > 50) {
    throw new HttpApiError(400, 'TOO_MANY_EMAILS', 'Maximum 50 emails per batch request.');
  }

  const creds = await resolveActiveSmtpCredentials(options);
  const transport = buildNodemailerTransport(creds);
  const results: EmailSendItemResult[] = [];
  const logs: StoredEmailLogEntry[] = [];

  try {
    for (const item of options.items) {
      const sentAt = new Date().toISOString();
      const recipient = (item.recipientEmail || '').trim();

      if (!isValidEmailAddress(recipient)) {
        const errorMessage = `Invalid recipient email address: "${recipient || '(empty)'}"`;
        results.push({
          documentNumber: item.documentNumber,
          recipientEmail: recipient,
          status: 'Failed',
          error: errorMessage,
          deliveryMethod: creds.provider,
          sentAt,
        });
        logs.push({
          id: `mail_${generateRandomId(8)}`,
          documentType: item.documentType,
          documentNumber: item.documentNumber,
          customerName: item.customerName,
          recipientEmail: recipient,
          cc: item.cc,
          bcc: item.bcc,
          subject: item.subject,
          deliveryMethod: creds.provider,
          status: 'Failed',
          errorMessage,
          sentAt,
        });
        continue;
      }

      try {
        const cc = normalizeEmailList(item.cc);
        const bcc = normalizeEmailList(item.bcc);
        const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];

        if (item.pdfBase64) {
          const cleanBase64 = item.pdfBase64.includes('base64,')
            ? item.pdfBase64.split('base64,')[1]
            : item.pdfBase64;
          attachments.push({
            filename: item.pdfFilename || `${item.documentType}_${item.documentNumber}.pdf`,
            content: Buffer.from(cleanBase64, 'base64'),
            contentType: 'application/pdf',
          });
        }

        const info = await transport.sendMail({
          from: `"${creds.senderName.replace(/"/g, '')}" <${creds.senderEmail}>`,
          to: recipient,
          cc,
          bcc,
          replyTo: creds.replyTo || undefined,
          subject: item.subject,
          text: item.body,
          html: formatPlainTextAsHtml(item.body),
          attachments,
        });

        results.push({
          documentNumber: item.documentNumber,
          recipientEmail: recipient,
          status: 'Sent',
          messageId: info.messageId,
          deliveryMethod: creds.provider,
          sentAt,
        });
        logs.push({
          id: `mail_${generateRandomId(8)}`,
          documentType: item.documentType,
          documentNumber: item.documentNumber,
          customerName: item.customerName,
          recipientEmail: recipient,
          cc,
          bcc,
          subject: item.subject,
          deliveryMethod: creds.provider,
          status: 'Sent',
          messageId: info.messageId,
          sentAt,
        });
      } catch (err: any) {
        const errorMessage = formatSmtpErrorMessage(err, creds.provider);
        results.push({
          documentNumber: item.documentNumber,
          recipientEmail: recipient,
          status: 'Failed',
          error: errorMessage,
          deliveryMethod: creds.provider,
          sentAt,
        });
        logs.push({
          id: `mail_${generateRandomId(8)}`,
          documentType: item.documentType,
          documentNumber: item.documentNumber,
          customerName: item.customerName,
          recipientEmail: recipient,
          cc: item.cc,
          bcc: item.bcc,
          subject: item.subject,
          deliveryMethod: creds.provider,
          status: 'Failed',
          errorMessage,
          sentAt,
        });
      }
    }
  } finally {
    transport.close();
  }

  let persistedInDrive = false;
  if (options.driveStore && logs.length > 0) {
    try {
      await options.driveStore.appendEmailLogs(logs);
      persistedInDrive = true;
    } catch {
      persistedInDrive = false;
    }
  }

  return { results, logs, persistedInDrive };
}
