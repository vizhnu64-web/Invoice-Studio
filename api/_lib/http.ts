/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppServerConfig } from './config.js';
import { decryptSecret, encryptSecret, signPayload, verifySignedPayload } from './crypto.js';

export const SESSION_COOKIE_NAME = 'invstudio_session';
export const OAUTH_STATE_COOKIE_NAME = 'invstudio_oauth_state';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes
const MAX_COOKIE_VALUE_BYTES = 3750; // Safe margin under browser 4096-byte cookie limit

export interface NormalizedRequest extends IncomingMessage {
  query?: Record<string, any>;
  body?: any;
  cookies?: Record<string, string>;
}

export interface NormalizedResponse extends ServerResponse {
  status?: (code: number) => NormalizedResponse;
  json?: (data: any) => void;
}

/**
 * Compact encrypted session payload stored inside an HttpOnly cookie.
 * Enables fully stateless Vercel serverless execution with zero external database.
 */
export interface EncryptedSessionData {
  uid: string;
  em: string;
  nm: string | null;
  pic: string | null;
  sc: string;
  rt: string | null;
  at: string | null;
  exp: number;
  df?: string | null;
  cat?: string;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function getRequestCookies(req: NormalizedRequest): Record<string, string> {
  if (req.cookies && typeof req.cookies === 'object') {
    return req.cookies;
  }
  return parseCookies(req.headers?.cookie);
}

export function isHttpsRequest(req: NormalizedRequest): boolean {
  const protoHeader = req.headers?.['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (proto && proto.toLowerCase().includes('https')) return true;
  if ((req.socket as any)?.encrypted) return true;
  const appUrl = (process.env.APP_URL || '').trim().toLowerCase();
  if (appUrl.startsWith('https://')) return true;
  return Boolean(process.env.VERCEL);
}

export function getRequestOrigin(req: NormalizedRequest): string | undefined {
  const hostHeader = req.headers?.['x-forwarded-host'] || req.headers?.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) return undefined;
  const proto = isHttpsRequest(req) ? 'https' : 'http';
  return `${proto}://${host}`;
}

export function appendSetCookie(res: ServerResponse, cookieString: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieString]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieString]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookieString]);
  }
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds: number;
    secure: boolean;
    httpOnly?: boolean;
    sameSite?: 'Lax' | 'None';
    partitioned?: boolean;
  }
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${options.maxAgeSeconds}`];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) {
    parts.push('Secure');
    parts.push(`SameSite=${options.sameSite || 'None'}`);
    if (options.partitioned !== false && (options.sameSite || 'None') === 'None') {
      parts.push('Partitioned');
    }
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

export function encodeEncryptedSessionCookie(
  session: EncryptedSessionData,
  config: Pick<AppServerConfig, 'sessionSecret' | 'tokenEncryptionKey'>
): string {
  const compact: EncryptedSessionData = {
    uid: session.uid,
    em: session.em,
    nm: session.nm ? session.nm.slice(0, 120) : null,
    pic: session.pic ? session.pic.slice(0, 300) : null,
    sc: session.sc,
    rt: session.rt,
    at: session.at,
    exp: session.exp,
    df: session.df || null,
    cat: session.cat || new Date().toISOString(),
  };

  let ciphertext = encryptSecret(JSON.stringify(compact), config.tokenEncryptionKey);
  let signed = signPayload({ d: ciphertext }, config.sessionSecret, SESSION_TTL_SECONDS);

  // If access token pushes cookie close to the 4KB limit and a refresh token exists, drop access token
  if (signed.length > MAX_COOKIE_VALUE_BYTES && compact.rt) {
    compact.at = null;
    compact.exp = 0;
    ciphertext = encryptSecret(JSON.stringify(compact), config.tokenEncryptionKey);
    signed = signPayload({ d: ciphertext }, config.sessionSecret, SESSION_TTL_SECONDS);
  }
  return signed;
}

export function decodeEncryptedSessionCookie(
  rawCookieValue: string | undefined | null,
  config: Pick<AppServerConfig, 'sessionSecret' | 'tokenEncryptionKey'>
): EncryptedSessionData | null {
  if (!rawCookieValue) return null;
  if (!config.sessionSecret || config.sessionSecret.length < 16) return null;
  if (!config.tokenEncryptionKey || config.tokenEncryptionKey.length < 16) return null;

  const verified = verifySignedPayload<{ d?: string }>(rawCookieValue, config.sessionSecret);
  if (!verified?.d) return null;

  try {
    const plaintext = decryptSecret(verified.d, config.tokenEncryptionKey);
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed.uid !== 'string' || typeof parsed.em !== 'string') {
      return null;
    }
    return {
      uid: parsed.uid,
      em: parsed.em,
      nm: parsed.nm ?? null,
      pic: parsed.pic ?? null,
      sc: String(parsed.sc || ''),
      rt: parsed.rt ?? null,
      at: parsed.at ?? null,
      exp: typeof parsed.exp === 'number' ? parsed.exp : 0,
      df: parsed.df ?? null,
      cat: parsed.cat || undefined,
    };
  } catch {
    return null;
  }
}

export function setEncryptedSessionCookie(
  req: NormalizedRequest,
  res: NormalizedResponse,
  session: EncryptedSessionData,
  config: Pick<AppServerConfig, 'sessionSecret' | 'tokenEncryptionKey'>
): void {
  const value = encodeEncryptedSessionCookie(session, config);
  const secure = isHttpsRequest(req);
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, value, {
      maxAgeSeconds: SESSION_TTL_SECONDS,
      secure,
      sameSite: secure ? 'None' : 'Lax',
      partitioned: secure,
    })
  );
}

export function readEncryptedSessionFromRequest(
  req: NormalizedRequest,
  config: Pick<AppServerConfig, 'sessionSecret' | 'tokenEncryptionKey'>
): EncryptedSessionData | null {
  const cookies = getRequestCookies(req);
  const raw = cookies[SESSION_COOKIE_NAME];
  return decodeEncryptedSessionCookie(raw, config);
}

export function clearSessionCookie(req: NormalizedRequest, res: NormalizedResponse): void {
  const secure = isHttpsRequest(req);
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, '', {
      maxAgeSeconds: 0,
      secure,
      sameSite: secure ? 'None' : 'Lax',
      partitioned: secure,
    })
  );
}

export function setOAuthStateCookie(
  req: NormalizedRequest,
  res: NormalizedResponse,
  statePayload: { nonce: string; feature?: string; returnTo?: string },
  sessionSecret: string
): string {
  const signed = signPayload(statePayload, sessionSecret, OAUTH_STATE_TTL_SECONDS);
  const secure = isHttpsRequest(req);
  appendSetCookie(
    res,
    serializeCookie(OAUTH_STATE_COOKIE_NAME, signed, {
      maxAgeSeconds: OAUTH_STATE_TTL_SECONDS,
      secure,
      sameSite: secure ? 'None' : 'Lax',
      partitioned: secure,
    })
  );
  return signed;
}

export function clearOAuthStateCookie(req: NormalizedRequest, res: NormalizedResponse): void {
  const secure = isHttpsRequest(req);
  appendSetCookie(
    res,
    serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
      maxAgeSeconds: 0,
      secure,
      sameSite: secure ? 'None' : 'Lax',
      partitioned: secure,
    })
  );
}

export async function readJsonBody(req: NormalizedRequest): Promise<any> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });
    req.on('error', reject);
  });
}

export function getQueryParam(req: NormalizedRequest, key: string): string {
  if (req.query && req.query[key] !== undefined) {
    const v = req.query[key];
    return Array.isArray(v) ? String(v[0] || '') : String(v || '');
  }
  const url = req.url || '';
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return '';
  const params = new URLSearchParams(url.slice(qIdx + 1));
  return params.get(key) || '';
}

export function sendJson(res: NormalizedResponse, statusCode: number, body: any): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const expressRes = res as { status?: (c: number) => { json?: (d: any) => void } };
  if (typeof expressRes.status === 'function') {
    const chained = expressRes.status(statusCode);
    if (chained && typeof chained.json === 'function') {
      chained.json(body);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendRedirect(res: NormalizedResponse, location: string): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}
