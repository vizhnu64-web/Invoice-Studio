/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleGmailHistory,
  handleGmailSend,
  handleGmailTestSend,
} from '../_lib/handlers.js';
import {
  extractCatchAllRoute,
  NormalizedRequest,
  NormalizedResponse,
  sendJson,
} from '../_lib/http.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractCatchAllRoute(req, '/api/gmail');
  if (route === 'send') return handleGmailSend(req, res);
  if (route === 'test-send') return handleGmailTestSend(req, res);
  if (route === 'history') return handleGmailHistory(req, res);
  return sendJson(res, 404, { error: `Unknown Gmail endpoint: /api/gmail/${route}` });
}
