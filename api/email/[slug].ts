/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleEmailHistory,
  handleEmailSend,
  handleEmailTestSend,
  handleSmtpConfig,
  handleSmtpTest,
} from '../_lib/handlers.js';
import {
  extractCatchAllRoute,
  NormalizedRequest,
  NormalizedResponse,
  sendJson,
} from '../_lib/http.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractCatchAllRoute(req, '/api/email');
  if (route === 'smtp-config') return handleSmtpConfig(req, res);
  if (route === 'smtp-test') return handleSmtpTest(req, res);
  if (route === 'test-send') return handleEmailTestSend(req, res);
  if (route === 'send') return handleEmailSend(req, res);
  if (route === 'history') return handleEmailHistory(req, res);
  return sendJson(res, 404, { error: `Unknown email endpoint: /api/email/${route}` });
}
