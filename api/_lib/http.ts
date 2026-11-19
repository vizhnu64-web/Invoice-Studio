/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { signPayload, verifySignedPayload } from './crypto.js';

export const SESSION_COOKIE_NAME = 'invstudio_session';
export const OAUTH_STATE_COOKIE_NAME = 'invstudio_oauth_state';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes

export interface NormalizedRequest extends IncomingMessage {
  query?: Record<string, any>;
  body?: any;
  cookies?: Record<string, string>;
}

export interface NormalizedResponse extends ServerResponse {
  status?: (code: number) => NormalizedResponse;
  json?: (data: any) => void;
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

export function setSessionCookie(
  req: NormalizedRequest,
  res: NormalizedResponse,
  sessionId: string,
  sessionSecret: string
): void {
  const signed = signPayload({ sid: sessionId }, sessionSecret, SESSION_TTL_SECONDS);
  const secure = isHttpsRequest(req);
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, signed, {
      maxAgeSeconds: SESSION_TTL_SECONDS,
      secure,
      sameSite: secure ? 'None' : 'Lax',
      partitioned: secure,
    })
  );
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
  statePayload: { nonce: string; sid: string; feature?: string; returnTo?: string },
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

export function readSessionIdFromRequest(
  req: NormalizedRequest,
  sessionSecret: string
): string | null {
  if (!sessionSecret || sessionSecret.length < 16) return null;
  const cookies = getRequestCookies(req);
  const raw = cookies[SESSION_COOKIE_NAME];
  const verified = verifySignedPayload<{ sid: string }>(raw, sessionSecret);
  return verified?.sid || null;
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
      } catch (err) {
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
