/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { google, gmail_v1 } from 'googleapis';
import { generateRandomId } from './crypto.js';
import { HttpApiError } from './errors.js';
import {
  createRequestOAuthClient,
  requireGooglePermission,
  VerifiedGoogleIdentity,
} from './googleAuth.js';
import { OAuthDriveEmailStore, StoredEmailLogEntry } from './oauthDriveClient.js';

export interface GmailApiLike {
  users: {
    messages: {
      send: (params: {
        userId: string;
        requestBody: { raw: string };
      }) => Promise<{ data?: { id?: string | null; threadId?: string | null } }>;
    };
  };
}

export type GmailClientInput = gmail_v1.Gmail | GmailApiLike;

export interface GmailAttachmentInput {
  filename: string;
  contentType: string;
  base64Content: string;
}

export interface GmailSendItemInput {
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

export interface GmailSendItemResult {
  documentNumber: string;
  recipientEmail: string;
  status: 'Sent' | 'Failed';
  messageId?: string;
  error?: string;
  retryable?: boolean;
  deliveryMethod: 'gmail_api';
  sentAt: string;
}

export function createRequestGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = createRequestOAuthClient(accessToken);
  return google.gmail({ version: 'v1', auth });
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function sanitizeHeaderValue(value: string): string {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeaderSubject(subject: string): string {
  const clean = sanitizeHeaderValue(subject);
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
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

function wrapBase64Lines(base64: string): string {
  return base64.replace(/\s+/g, '').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

export function toBase64Url(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Builds an RFC-2822 MIME message (with optional PDF attachments) and encodes it as base64url
 * for `gmail.users.messages.send({ userId: 'me', requestBody: { raw } })`.
 */
export function buildMimeEmailRaw(params: {
  fromName?: string;
  fromEmail: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments?: GmailAttachmentInput[];
}): { raw: string; mimeText: string } {
  const cleanFromEmail = sanitizeHeaderValue(params.fromEmail);
  const cleanFromName = sanitizeHeaderValue(params.fromName || '').replace(/"/g, '');
  const fromHeader = cleanFromName ? `"${cleanFromName}" <${cleanFromEmail}>` : cleanFromEmail;
  const toHeader = sanitizeHeaderValue(params.to);
  const ccHeader = params.cc ? sanitizeHeaderValue(params.cc) : '';
  const bccHeader = params.bcc ? sanitizeHeaderValue(params.bcc) : '';
  const replyToHeader = params.replyTo ? sanitizeHeaderValue(params.replyTo) : '';

  const altBoundary = `inv_alt_${generateRandomId(8)}`;
  const htmlContent = params.htmlBody || formatPlainTextAsHtml(params.textBody);
  const attachments = (params.attachments || []).filter((a) => a.base64Content);

  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    ...(ccHeader ? [`Cc: ${ccHeader}`] : []),
    ...(bccHeader ? [`Bcc: ${bccHeader}`] : []),
    ...(replyToHeader ? [`Reply-To: ${replyToHeader}`] : []),
    `Subject: ${encodeHeaderSubject(params.subject)}`,
    'MIME-Version: 1.0',
  ];

  const alternativeSection = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64Lines(Buffer.from(params.textBody, 'utf8').toString('base64')),
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64Lines(Buffer.from(htmlContent, 'utf8').toString('base64')),
    `--${altBoundary}--`,
  ].join('\r\n');

  let mimeText: string;
  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    mimeText = `${headers.join('\r\n')}\r\n\r\n${alternativeSection}`;
  } else {
    const mixedBoundary = `inv_mix_${generateRandomId(8)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

    const attachmentParts = attachments.map((att) => {
      const safeFile = sanitizeHeaderValue(att.filename).replace(/"/g, '');
      const cleanB64 = att.base64Content.includes('base64,')
        ? att.base64Content.split('base64,')[1]
        : att.base64Content;
      return [
        `--${mixedBoundary}`,
        `Content-Type: ${sanitizeHeaderValue(att.contentType || 'application/pdf')}; name="${safeFile}"`,
        `Content-Disposition: attachment; filename="${safeFile}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64Lines(cleanB64),
      ].join('\r\n');
    });

    const body = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      alternativeSection,
      ...attachmentParts,
      `--${mixedBoundary}--`,
    ].join('\r\n');

    mimeText = `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  return {
    raw: toBase64Url(mimeText),
    mimeText,
  };
}

function classifyGmailError(err: any): { status: number; code: string; message: string; retryable: boolean } {
  if (err instanceof HttpApiError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      retryable: err.status === 429 || err.status >= 500,
    };
  }
  const status = Number(err?.code || err?.response?.status || err?.status || 502);
  const reason = String(
    err?.errors?.[0]?.reason ||
      err?.response?.data?.error?.errors?.[0]?.reason ||
      err?.response?.data?.error?.status ||
      ''
  );
  const apiMessage = String(err?.response?.data?.error?.message || err?.message || 'Gmail API send failed.');

  if (status === 401 || reason === 'authError' || reason === 'invalidCredentials') {
    return {
      status: 401,
      code: 'GOOGLE_TOKEN_EXPIRED',
      message: 'Your Google authorization expired or was revoked. Reconnect your Google account and retry.',
      retryable: false,
    };
  }
  if (status === 403) {
    if (reason === 'insufficientPermissions' || apiMessage.toLowerCase().includes('insufficient')) {
      return {
        status: 403,
        code: 'GMAIL_PERMISSION_MISSING',
        message: 'Gmail send permission is missing. Click "Enable Gmail Permission" and retry.',
        retryable: false,
      };
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return {
        status: 429,
        code: 'GMAIL_RATE_LIMITED',
        message: 'Gmail sending rate limit reached. Wait a moment and retry.',
        retryable: true,
      };
    }
    return {
      status: 403,
      code: 'GMAIL_PERMISSION_DENIED',
      message: apiMessage,
      retryable: false,
    };
  }
  if (status === 429 || status >= 500) {
    return {
      status,
      code: 'GMAIL_TRANSIENT_ERROR',
      message: apiMessage,
      retryable: true,
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 400,
    code: 'GMAIL_SEND_FAILED',
    message: apiMessage,
    retryable: false,
  };
}

export async function sendGmailTestEmail(options: {
  gmail: GmailClientInput;
  identity: VerifiedGoogleIdentity;
  recipientEmail: string;
  senderName?: string;
  replyTo?: string;
  driveStore?: OAuthDriveEmailStore | null;
}): Promise<{
  ok: boolean;
  messageId?: string;
  senderEmail: string;
  deliveryMethod: 'gmail_api';
  sentAt: string;
}> {
  requireGooglePermission(options.identity, 'gmail');

  const recipient = String(options.recipientEmail || '').trim();
  if (!isValidEmailAddress(recipient)) {
    throw new HttpApiError(400, 'INVALID_RECIPIENT', 'Please enter a valid recipient email address.');
  }
  const replyTo = options.replyTo ? normalizeEmailList(options.replyTo) : undefined;
  const senderName = (options.senderName || options.identity.name || 'Invoice Studio').trim();
  const subject = 'Invoice Studio — Gmail API Test Email';
  const textBody = `This test email was sent directly from your connected Google account (${options.identity.email}) using the Gmail API (gmail.send scope).`;

  const { raw } = buildMimeEmailRaw({
    fromName: senderName,
    fromEmail: options.identity.email,
    to: recipient,
    replyTo,
    subject,
    textBody,
  });

  try {
    const res = await options.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    const sentAt = new Date().toISOString();
    const messageId = res.data?.id || undefined;

    if (options.driveStore) {
      await options.driveStore
        .appendEmailLogs([
          {
            id: `mail_${generateRandomId(8)}`,
            documentType: 'test',
            documentNumber: 'GMAIL-TEST',
            customerName: 'Test Recipient',
            recipientEmail: recipient,
            subject,
            deliveryMethod: 'gmail_api',
            status: 'Sent',
            messageId,
            sentAt,
          },
        ])
        .catch(() => {});
    }

    return {
      ok: true,
      messageId,
      senderEmail: options.identity.email,
      deliveryMethod: 'gmail_api',
      sentAt,
    };
  } catch (err) {
    const mapped = classifyGmailError(err);
    throw new HttpApiError(mapped.status, mapped.code, mapped.message);
  }
}

export async function dispatchGmailEmails(options: {
  gmail: GmailClientInput;
  identity: VerifiedGoogleIdentity;
  items: GmailSendItemInput[];
  senderName?: string;
  replyTo?: string;
  driveStore?: OAuthDriveEmailStore | null;
}): Promise<{
  results: GmailSendItemResult[];
  logs: StoredEmailLogEntry[];
  persistedInDrive: boolean;
  senderEmail: string;
}> {
  requireGooglePermission(options.identity, 'gmail');

  if (!Array.isArray(options.items) || options.items.length === 0) {
    throw new HttpApiError(400, 'NO_EMAIL_ITEMS', 'At least one email item is required.');
  }
  if (options.items.length > 50) {
    throw new HttpApiError(400, 'TOO_MANY_EMAILS', 'Maximum 50 emails per batch request.');
  }

  const senderName = (options.senderName || options.identity.name || 'Invoice Studio').trim();
  const replyTo = options.replyTo ? normalizeEmailList(options.replyTo) : undefined;
  const results: GmailSendItemResult[] = [];
  const logs: StoredEmailLogEntry[] = [];

  for (const item of options.items) {
    const sentAt = new Date().toISOString();
    const recipient = String(item.recipientEmail || '').trim();

    if (!isValidEmailAddress(recipient)) {
      const errorMessage = `Invalid recipient email address: "${recipient || '(empty)'}"`;
      results.push({
        documentNumber: item.documentNumber,
        recipientEmail: recipient,
        status: 'Failed',
        error: errorMessage,
        retryable: false,
        deliveryMethod: 'gmail_api',
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
        deliveryMethod: 'gmail_api',
        status: 'Failed',
        errorMessage,
        sentAt,
      });
      continue;
    }

    try {
      const cc = normalizeEmailList(item.cc);
      const bcc = normalizeEmailList(item.bcc);
      const attachments: GmailAttachmentInput[] = [];
      if (item.pdfBase64) {
        attachments.push({
          filename: item.pdfFilename || `${item.documentType}_${item.documentNumber}.pdf`,
          contentType: 'application/pdf',
          base64Content: item.pdfBase64,
        });
      }

      const { raw } = buildMimeEmailRaw({
        fromName: senderName,
        fromEmail: options.identity.email,
        to: recipient,
        cc,
        bcc,
        replyTo,
        subject: item.subject,
        textBody: item.body,
        attachments,
      });

      const res = await options.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      const messageId = res.data?.id || undefined;

      results.push({
        documentNumber: item.documentNumber,
        recipientEmail: recipient,
        status: 'Sent',
        messageId,
        deliveryMethod: 'gmail_api',
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
        deliveryMethod: 'gmail_api',
        status: 'Sent',
        messageId,
        sentAt,
      });
    } catch (err) {
      const mapped = classifyGmailError(err);
      // If token expired or gmail scope missing mid-batch, propagate 401/403 if first item, otherwise record failure
      if ((mapped.status === 401 || mapped.code === 'GMAIL_PERMISSION_MISSING') && results.length === 0) {
        throw new HttpApiError(mapped.status, mapped.code, mapped.message);
      }
      results.push({
        documentNumber: item.documentNumber,
        recipientEmail: recipient,
        status: 'Failed',
        error: mapped.message,
        retryable: mapped.retryable,
        deliveryMethod: 'gmail_api',
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
        deliveryMethod: 'gmail_api',
        status: 'Failed',
        errorMessage: mapped.message,
        sentAt,
      });
    }
  }

  let persistedInDrive = false;
  if (logs.length > 0 && options.driveStore) {
    try {
      await options.driveStore.appendEmailLogs(logs);
      persistedInDrive = true;
    } catch {
      persistedInDrive = false;
    }
  }

  return {
    results,
    logs,
    persistedInDrive,
    senderEmail: options.identity.email,
  };
}
