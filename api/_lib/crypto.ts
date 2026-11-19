/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

const CIPHER_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Derives a deterministic 256-bit key from TOKEN_ENCRYPTION_KEY.
 * Supports 64-char hex, 44-char base64, or passphrase strings (>=16 chars).
 */
export function deriveAes256Key(rawKey: string): Buffer {
  const trimmed = (rawKey || '').trim();
  if (!trimmed || trimmed.length < 16) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is missing or too short (minimum 16 characters required).'
    );
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Try base64 32-byte key
  if (/^[A-Za-z0-9+/=]{43,44}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === KEY_BYTES) {
      return decoded;
    }
  }

  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

export function encryptSecret(plaintext: string, rawKey: string): string {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty secret value.');
  }
  const key = deriveAes256Key(rawKey);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string, rawKey: string): string {
  const parts = (ciphertext || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted credential format.');
  }
  const key = deriveAes256Key(rawKey);
  const iv = Buffer.from(parts[1], 'base64url');
  const authTag = Buffer.from(parts[2], 'base64url');
  const encrypted = Buffer.from(parts[3], 'base64url');

  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function signPayload<T extends Record<string, any>>(
  payload: T,
  secret: string,
  ttlSeconds: number
): string {
  const cleanSecret = (secret || '').trim();
  if (!cleanSecret || cleanSecret.length < 16) {
    throw new Error('SESSION_SECRET is missing or too short (minimum 16 characters required).');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const envelope = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const encodedBody = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', cleanSecret)
    .update(encodedBody)
    .digest('base64url');
  return `${encodedBody}.${sig}`;
}

export function verifySignedPayload<T extends Record<string, any>>(
  token: string | undefined | null,
  secret: string
): (T & { iat: number; exp: number }) | null {
  const cleanSecret = (secret || '').trim();
  if (!token || !cleanSecret || cleanSecret.length < 16) return null;

  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const encodedBody = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encodedBody || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', cleanSecret)
    .update(encodedBody)
    .digest('base64url');

  const bufA = Buffer.from(providedSig, 'utf8');
  const bufB = Buffer.from(expectedSig, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < nowSec) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateRandomId(bytes: number = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
