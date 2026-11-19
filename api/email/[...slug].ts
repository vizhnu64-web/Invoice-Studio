/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleEmailHistory,
  handleEmailSend,
  handleSmtpConfig,
  handleSmtpTest,
} from '../_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse, sendJson } from '../_lib/http.js';

function extractEmailPath(req: NormalizedRequest): string {
  const slug = req.query?.slug;
  if (Array.isArray(slug) && slug.length > 0) return slug.join('/');
  if (typeof slug === 'string' && slug) return slug;
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/email\/?/, '');
}

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractEmailPath(req);
  if (route === 'smtp-config') return handleSmtpConfig(req, res);
  if (route === 'smtp-test') return handleSmtpTest(req, res);
  if (route === 'send') return handleEmailSend(req, res);
  if (route === 'history') return handleEmailHistory(req, res);
  return sendJson(res, 404, { error: `Unknown email endpoint: /api/email/${route}` });
}
