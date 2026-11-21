/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface NormalizedRequest extends IncomingMessage {
  query?: Record<string, any>;
  body?: any;
}

export interface NormalizedResponse extends ServerResponse {
  status?: (code: number) => NormalizedResponse;
  json?: (data: any) => void;
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

export function getHeaderValue(req: NormalizedRequest, headerName: string): string {
  const raw = req.headers?.[headerName.toLowerCase()];
  if (Array.isArray(raw)) return String(raw[0] || '').trim();
  return typeof raw === 'string' ? raw.trim() : '';
}

export function getClientIp(req: NormalizedRequest): string {
  const forwarded = getHeaderValue(req, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'local';
}

const rateBucketMap = new Map<string, { count: number; resetAt: number }>();

/**
 * Lightweight per-IP sliding window rate limiter for sensitive endpoints (email send, Drive connect).
 */
export function checkRateLimit(
  req: NormalizedRequest,
  bucket: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const key = `${bucket}:${getClientIp(req)}`;
  const now = Date.now();
  const entry = rateBucketMap.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBucketMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
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
    let totalBytes = 0;
    const MAX_BODY_BYTES = 26 * 1024 * 1024; // 26 MB cap for PDF base64 uploads

    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Request payload exceeds maximum allowed size (25MB).'));
        return;
      }
      chunks.push(buf);
    });
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
