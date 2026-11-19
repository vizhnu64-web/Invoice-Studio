/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { AppServerConfig } from './config.js';
import { decryptSecret, encryptSecret, generateRandomId } from './crypto.js';
import { PersistenceStore, StoredEmailLog, StoredSmtpConfig } from './db.js';
import {
  GoogleTransportAdapter,
  HttpApiError,
  mapGoogleApiError,
  runWithUserTokenRetry,
} from './googleService.js';

export interface EmailAttachmentPayload {
  filename: string;
  contentBase64: string;
  contentType?: string;
}

export interface EmailSendItem {
  documentType: 'invoice' | 'quotation';
  documentId: string;
  documentNumber: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachment?: EmailAttachmentPayload;
}

export interface EmailDeliveryResultItem {
  documentId: string;
  documentNumber: string;
  recipientEmail: string;
  deliveryMethod: 'gmail' | 'smtp';
  senderEmail: string;
  status: 'sent' | 'failed';
  providerMessageId: string | null;
  errorMessage: string | null;
  logId: string;
}

export interface EmailTransportAdapter {
  sendViaGmail(params: {
    accessToken: string;
    config: AppServerConfig;
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    textBody: string;
    htmlBody?: string;
    attachment?: EmailAttachmentPayload;
  }): Promise<{ messageId: string }>;

  verifySmtp(params: {
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password: string;
  }): Promise<void>;

  sendViaSmtp(params: {
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    textBody: string;
    htmlBody?: string;
    attachment?: EmailAttachmentPayload;
  }): Promise<{ messageId: string }>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseAndValidateEmailList(raw?: string): { emails: string[]; invalid: string[] } {
  if (!raw || !raw.trim()) return { emails: [], invalid: [] };
  const parts = raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    if (EMAIL_PATTERN.test(part)) {
      emails.push(part);
    } else {
      invalid.push(part);
    }
  }
  return { emails, invalid };
}

function sanitizeHeaderValue(val: string): string {
  return val.replace(/[\r\n]+/g, ' ').trim();
}

function encodeMimeHeader(val: string): string {
  const clean = sanitizeHeaderValue(val);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/**
 * Builds an RFC 2822 multipart/mixed MIME message encoded as base64url for Gmail API v1.
 */
export function buildGmailRawMimeMessage(params: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachment?: EmailAttachmentPayload;
}): string {
  const mixedBoundary = `invstudio_mixed_${generateRandomId(8)}`;
  const altBoundary = `invstudio_alt_${generateRandomId(8)}`;

  const headers: string[] = [
    `From: ${sanitizeHeaderValue(params.from)}`,
    `To: ${sanitizeHeaderValue(params.to)}`,
    ...(params.cc ? [`Cc: ${sanitizeHeaderValue(params.cc)}`] : []),
    ...(params.bcc ? [`Bcc: ${sanitizeHeaderValue(params.bcc)}`] : []),
    `Subject: ${encodeMimeHeader(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ];

  const lines: string[] = [...headers, ''];

  // Alternative text + HTML body part
  lines.push(`--${mixedBoundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`, '');

  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64', '');
  lines.push(Buffer.from(params.textBody || '', 'utf8').toString('base64'), '');

  const html =
    params.htmlBody ||
    `<div style="font-family:Arial,sans-serif;line-height:1.5;white-space:pre-wrap;">${(
      params.textBody || ''
    )
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</div>`;
  lines.push(`--${altBoundary}`);
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64', '');
  lines.push(Buffer.from(html, 'utf8').toString('base64'), '');
  lines.push(`--${altBoundary}--`, '');

  if (params.attachment?.contentBase64) {
    const cleanB64 = params.attachment.contentBase64
      .replace(/^data:[^;]+;base64,/, '')
      .replace(/\s+/g, '');
    const safeFile = sanitizeHeaderValue(params.attachment.filename || 'document.pdf').replace(
      /"/g,
      ''
    );
    const mimeType = params.attachment.contentType || 'application/pdf';
    lines.push(`--${mixedBoundary}`);
    lines.push(`Content-Type: ${mimeType}; name="${safeFile}"`);
    lines.push(`Content-Disposition: attachment; filename="${safeFile}"`);
    lines.push('Content-Transfer-Encoding: base64', '');
    lines.push(cleanB64, '');
  }

  lines.push(`--${mixedBoundary}--`);

  const rawMime = lines.join('\r\n');
  return Buffer.from(rawMime, 'utf8').toString('base64url');
}

function createNodemailerTransport(params: {
  host: string;
  port: number;
  securityMode: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  password: string;
}) {
  return nodemailer.createTransport({
    host: params.host,
    port: params.port,
    secure: params.securityMode === 'SSL' || params.port === 465,
    requireTLS: params.securityMode === 'STARTTLS',
    ignoreTLS: params.securityMode === 'NONE',
    auth: params.username
      ? {
          user: params.username,
          pass: params.password,
        }
      : undefined,
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

export const defaultEmailTransport: EmailTransportAdapter = {
  async sendViaGmail({
    accessToken,
    config,
    from,
    to,
    cc,
    bcc,
    subject,
    textBody,
    htmlBody,
    attachment,
  }) {
    const auth = new OAuth2Client(config.googleClientId, config.googleClientSecret);
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth });
    const raw = buildGmailRawMimeMessage({
      from,
      to,
      cc,
      bcc,
      subject,
      textBody,
      htmlBody,
      attachment,
    });
    try {
      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      return { messageId: res.data.id || `gmail_${Date.now()}` };
    } catch (err: any) {
      throw mapGoogleApiError(err, 'Gmail API failed to send email.');
    }
  },

  async verifySmtp(params) {
    const transporter = createNodemailerTransport(params);
    try {
      await transporter.verify();
    } catch (err: any) {
      throw new HttpApiError(
        400,
        'SMTP_CONNECTION_FAILED',
        `SMTP verification failed: ${err?.message || 'Unable to connect to SMTP server.'}`
      );
    } finally {
      transporter.close();
    }
  },

  async sendViaSmtp(params) {
    const transporter = createNodemailerTransport(params);
    try {
      const attachments = params.attachment?.contentBase64
        ? [
            {
              filename: params.attachment.filename || 'document.pdf',
              content: Buffer.from(
                params.attachment.contentBase64.replace(/^data:[^;]+;base64,/, ''),
                'base64'
              ),
              contentType: params.attachment.contentType || 'application/pdf',
            },
          ]
        : undefined;

      const info = await transporter.sendMail({
        from: params.fromName
          ? `"${sanitizeHeaderValue(params.fromName)}" <${params.fromEmail}>`
          : params.fromEmail,
        to: params.to,
        cc: params.cc || undefined,
        bcc: params.bcc || undefined,
        subject: params.subject,
        text: params.textBody,
        html: params.htmlBody || undefined,
        attachments,
      });

      return { messageId: info.messageId || `smtp_${Date.now()}` };
    } catch (err: any) {
      throw new HttpApiError(
        502,
        'SMTP_SEND_FAILED',
        `SMTP delivery failed: ${err?.message || 'SMTP server rejected the message.'}`
      );
    } finally {
      transporter.close();
    }
  },
};

export function toPublicSmtpConfig(cfg: StoredSmtpConfig | null) {
  if (!cfg) {
    return {
      configured: false,
      host: '',
      port: 587,
      securityMode: 'STARTTLS' as const,
      username: '',
      hasPassword: false,
      senderName: '',
      senderEmail: '',
      verifiedAt: null,
    };
  }
  return {
    configured: Boolean(cfg.host && cfg.senderEmail),
    host: cfg.host,
    port: cfg.port,
    securityMode: cfg.securityMode,
    username: cfg.username,
    hasPassword: Boolean(cfg.encryptedPassword),
    senderName: cfg.senderName,
    senderEmail: cfg.senderEmail,
    verifiedAt: cfg.verifiedAt,
  };
}

export async function saveUserSmtpConfig(params: {
  userId: string;
  host: string;
  port: number;
  securityMode: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  password?: string;
  senderName: string;
  senderEmail: string;
  config: AppServerConfig;
  store: PersistenceStore;
}): Promise<ReturnType<typeof toPublicSmtpConfig>> {
  const host = params.host.trim();
  const senderEmail = params.senderEmail.trim();
  const port = Number(params.port) || 587;

  if (!host) {
    throw new HttpApiError(400, 'INVALID_SMTP_HOST', 'SMTP host is required.');
  }
  if (!senderEmail || !EMAIL_PATTERN.test(senderEmail)) {
    throw new HttpApiError(400, 'INVALID_SENDER_EMAIL', 'A valid SMTP sender email address is required.');
  }
  if (port < 1 || port > 65535) {
    throw new HttpApiError(400, 'INVALID_SMTP_PORT', 'SMTP port must be between 1 and 65535.');
  }

  let encryptedPassword: string | null | undefined = undefined;
  if (params.password && params.password.trim()) {
    if (!params.config.tokenEncryptionKey || params.config.tokenEncryptionKey.length < 16) {
      throw new HttpApiError(
        503,
        'ENCRYPTION_KEY_UNCONFIGURED',
        'Server TOKEN_ENCRYPTION_KEY must be configured (min 16 chars) before storing encrypted SMTP credentials.'
      );
    }
    encryptedPassword = encryptSecret(params.password, params.config.tokenEncryptionKey);
  }

  const saved = await params.store.upsertSmtpConfig({
    userId: params.userId,
    host,
    port,
    securityMode: params.securityMode || 'STARTTLS',
    username: params.username.trim(),
    encryptedPassword,
    senderName: params.senderName.trim(),
    senderEmail,
  });

  return toPublicSmtpConfig(saved);
}

export async function testUserSmtpConnection(params: {
  userId: string;
  override?: {
    host?: string;
    port?: number;
    securityMode?: 'SSL' | 'STARTTLS' | 'NONE';
    username?: string;
    password?: string;
  };
  config: AppServerConfig;
  store: PersistenceStore;
  emailTransport?: EmailTransportAdapter;
}): Promise<{ ok: true; verifiedAt: string }> {
  const transport = params.emailTransport || defaultEmailTransport;
  const saved = await params.store.getSmtpConfig(params.userId);

  const host = (params.override?.host || saved?.host || '').trim();
  const port = Number(params.override?.port || saved?.port || 587);
  const securityMode = params.override?.securityMode || saved?.securityMode || 'STARTTLS';
  const username = (params.override?.username ?? saved?.username ?? '').trim();

  let password = params.override?.password || '';
  if (!password && saved?.encryptedPassword) {
    password = decryptSecret(saved.encryptedPassword, params.config.tokenEncryptionKey);
  }

  if (!host) {
    throw new HttpApiError(400, 'SMTP_NOT_CONFIGURED', 'Configure SMTP host before testing connection.');
  }

  await transport.verifySmtp({ host, port, securityMode, username, password });

  const verifiedAt = new Date().toISOString();
  if (saved) {
    await params.store.upsertSmtpConfig({
      userId: params.userId,
      host: saved.host,
      port: saved.port,
      securityMode: saved.securityMode,
      username: saved.username,
      senderName: saved.senderName,
      senderEmail: saved.senderEmail,
      verifiedAt,
    });
  }

  return { ok: true, verifiedAt };
}

/**
 * Dispatches one or more invoice/quotation emails using the EXPLICIT user-selected delivery method
 * ('gmail' or 'smtp'). Never silently switches delivery methods. Isolates per-recipient errors.
 */
export async function dispatchUserEmails(params: {
  userId: string;
  method: 'gmail' | 'smtp';
  items: EmailSendItem[];
  config: AppServerConfig;
  store: PersistenceStore;
  googleTransport?: GoogleTransportAdapter;
  emailTransport?: EmailTransportAdapter;
}): Promise<{
  method: 'gmail' | 'smtp';
  sentCount: number;
  failedCount: number;
  results: EmailDeliveryResultItem[];
}> {
  if (params.method !== 'gmail' && params.method !== 'smtp') {
    throw new HttpApiError(
      400,
      'INVALID_DELIVERY_METHOD',
      'Explicit delivery method ("gmail" or "smtp") is required.'
    );
  }

  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new HttpApiError(400, 'NO_EMAIL_ITEMS', 'At least one email recipient item is required.');
  }

  const emailTransport = params.emailTransport || defaultEmailTransport;
  const results: EmailDeliveryResultItem[] = [];

  // Pre-verify method readiness (NEVER silently fallback to the other method!)
  let smtpCreds: {
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    password: string;
    senderName: string;
    senderEmail: string;
  } | null = null;

  if (params.method === 'smtp') {
    const savedSmtp = await params.store.getSmtpConfig(params.userId);
    if (!savedSmtp || !savedSmtp.host || !savedSmtp.senderEmail) {
      throw new HttpApiError(
        400,
        'SMTP_NOT_CONFIGURED',
        'SMTP account is not configured for your profile. Configure SMTP settings before sending via SMTP.'
      );
    }
    let password = '';
    if (savedSmtp.encryptedPassword) {
      try {
        password = decryptSecret(savedSmtp.encryptedPassword, params.config.tokenEncryptionKey);
      } catch {
        throw new HttpApiError(
          500,
          'SMTP_DECRYPT_FAILED',
          'Stored SMTP password could not be decrypted. Please re-enter and save your SMTP password.'
        );
      }
    }
    smtpCreds = {
      host: savedSmtp.host,
      port: savedSmtp.port,
      securityMode: savedSmtp.securityMode,
      username: savedSmtp.username,
      password,
      senderName: savedSmtp.senderName,
      senderEmail: savedSmtp.senderEmail,
    };
  }

  // Deduplicate identical documentId + recipient in the same batch to prevent accidental double-sends
  const seenKeys = new Set<string>();

  for (const item of params.items) {
    const docId = String(item.documentId || '').trim();
    const docNumber = String(item.documentNumber || '').trim();
    const docType = item.documentType === 'quotation' ? 'quotation' : 'invoice';
    const logId = `emlog_${Date.now()}_${generateRandomId(6)}`;

    const toParsed = parseAndValidateEmailList(item.to);
    const ccParsed = parseAndValidateEmailList(item.cc);
    const bccParsed = parseAndValidateEmailList(item.bcc);

    if (toParsed.emails.length === 0 || toParsed.invalid.length > 0) {
      const errMsg =
        toParsed.invalid.length > 0
          ? `Invalid recipient email(s): ${toParsed.invalid.join(', ')}`
          : 'Recipient email address is missing or invalid.';
      const log = await params.store.insertEmailLog({
        id: logId,
        userId: params.userId,
        documentType: docType,
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: item.to || '',
        cc: item.cc || '',
        bcc: item.bcc || '',
        deliveryMethod: params.method,
        senderEmail: smtpCreds?.senderEmail || '',
        subject: item.subject || '',
        status: 'failed',
        providerMessageId: null,
        errorMessage: errMsg,
      });
      results.push({
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: item.to || '',
        deliveryMethod: params.method,
        senderEmail: log.senderEmail,
        status: 'failed',
        providerMessageId: null,
        errorMessage: errMsg,
        logId: log.id,
      });
      continue;
    }

    if (ccParsed.invalid.length > 0 || bccParsed.invalid.length > 0) {
      const errMsg = `Invalid CC/BCC email(s): ${[...ccParsed.invalid, ...bccParsed.invalid].join(', ')}`;
      const log = await params.store.insertEmailLog({
        id: logId,
        userId: params.userId,
        documentType: docType,
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: toParsed.emails.join(', '),
        cc: item.cc || '',
        bcc: item.bcc || '',
        deliveryMethod: params.method,
        senderEmail: smtpCreds?.senderEmail || '',
        subject: item.subject || '',
        status: 'failed',
        providerMessageId: null,
        errorMessage: errMsg,
      });
      results.push({
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: toParsed.emails.join(', '),
        deliveryMethod: params.method,
        senderEmail: log.senderEmail,
        status: 'failed',
        providerMessageId: null,
        errorMessage: errMsg,
        logId: log.id,
      });
      continue;
    }

    const dedupeKey = `${docType}:${docId}:${toParsed.emails.join(',').toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    seenKeys.add(dedupeKey);

    let senderEmail = smtpCreds?.senderEmail || '';
    try {
      let providerMessageId = '';

      if (params.method === 'gmail') {
        const sendRes = await runWithUserTokenRetry(
          {
            userId: params.userId,
            requiredFeature: 'gmail',
            config: params.config,
            store: params.store,
            transport: params.googleTransport,
          },
          async (accessToken, connection) => {
            senderEmail = connection.email;
            const fromHeader = connection.name
              ? `"${sanitizeHeaderValue(connection.name)}" <${connection.email}>`
              : connection.email;
            return await emailTransport.sendViaGmail({
              accessToken,
              config: params.config,
              from: fromHeader,
              to: toParsed.emails.join(', '),
              cc: ccParsed.emails.join(', ') || undefined,
              bcc: bccParsed.emails.join(', ') || undefined,
              subject: item.subject,
              textBody: item.textBody,
              htmlBody: item.htmlBody,
              attachment: item.attachment,
            });
          }
        );
        providerMessageId = sendRes.messageId;
      } else if (smtpCreds) {
        const sendRes = await emailTransport.sendViaSmtp({
          host: smtpCreds.host,
          port: smtpCreds.port,
          securityMode: smtpCreds.securityMode,
          username: smtpCreds.username,
          password: smtpCreds.password,
          fromName: smtpCreds.senderName,
          fromEmail: smtpCreds.senderEmail,
          to: toParsed.emails.join(', '),
          cc: ccParsed.emails.join(', ') || undefined,
          bcc: bccParsed.emails.join(', ') || undefined,
          subject: item.subject,
          textBody: item.textBody,
          htmlBody: item.htmlBody,
          attachment: item.attachment,
        });
        providerMessageId = sendRes.messageId;
      }

      const log: StoredEmailLog = await params.store.insertEmailLog({
        id: logId,
        userId: params.userId,
        documentType: docType,
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: toParsed.emails.join(', '),
        cc: ccParsed.emails.join(', '),
        bcc: bccParsed.emails.join(', '),
        deliveryMethod: params.method,
        senderEmail,
        subject: item.subject,
        status: 'sent',
        providerMessageId,
        errorMessage: null,
      });

      results.push({
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: toParsed.emails.join(', '),
        deliveryMethod: params.method,
        senderEmail,
        status: 'sent',
        providerMessageId,
        errorMessage: null,
        logId: log.id,
      });
    } catch (err: any) {
      // Propagate top-level auth/scope errors when single item fails due to missing Gmail permission
      if (
        err instanceof HttpApiError &&
        (err.code === 'GMAIL_SCOPE_REQUIRED' ||
          err.code === 'GOOGLE_NOT_CONNECTED' ||
          err.code === 'GOOGLE_REAUTH_REQUIRED')
      ) {
        throw err;
      }

      const errMsg = err?.message || 'Failed to send email.';
      const log = await params.store.insertEmailLog({
        id: logId,
        userId: params.userId,
        documentType: docType,
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: toParsed.emails.join(', '),
        cc: ccParsed.emails.join(', '),
        bcc: bccParsed.emails.join(', '),
        deliveryMethod: params.method,
        senderEmail,
        subject: item.subject,
        status: 'failed',
        providerMessageId: null,
        errorMessage: errMsg,
      });

      results.push({
        documentId: docId,
        documentNumber: docNumber,
        recipientEmail: toParsed.emails.join(', '),
        deliveryMethod: params.method,
        senderEmail,
        status: 'failed',
        providerMessageId: null,
        errorMessage: errMsg,
        logId: log.id,
      });
    }
  }

  const sentCount = results.filter((r) => r.status === 'sent').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;

  return {
    method: params.method,
    sentCount,
    failedCount,
    results,
  };
}
