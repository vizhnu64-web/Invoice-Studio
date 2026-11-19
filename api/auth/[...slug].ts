/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleAuthDisconnect,
  handleAuthStatus,
  handleGoogleAuthCallback,
  handleGoogleAuthStart,
} from '../_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse, sendJson } from '../_lib/http.js';

function extractAuthPath(req: NormalizedRequest): string {
  const slug = req.query?.slug;
  if (Array.isArray(slug) && slug.length > 0) return slug.join('/');
  if (typeof slug === 'string' && slug) return slug;
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/auth\/?/, '');
}

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractAuthPath(req);
  if (route === 'google/start') return handleGoogleAuthStart(req, res);
  if (route === 'google/callback') return handleGoogleAuthCallback(req, res);
  if (route === 'status') return handleAuthStatus(req, res);
  if (route === 'disconnect') return handleAuthDisconnect(req, res);
  return sendJson(res, 404, { error: `Unknown auth endpoint: /api/auth/${route}` });
}
