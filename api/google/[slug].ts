/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleGoogleConfig,
  handleGoogleRevoke,
  handleGoogleTest,
  handleGoogleVerifySession,
} from '../_lib/handlers.js';
import {
  extractCatchAllRoute,
  NormalizedRequest,
  NormalizedResponse,
  sendJson,
} from '../_lib/http.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractCatchAllRoute(req, '/api/google');
  if (route === 'config') return handleGoogleConfig(req, res);
  if (route === 'verify-session') return handleGoogleVerifySession(req, res);
  if (route === 'test') return handleGoogleTest(req, res);
  if (route === 'revoke') return handleGoogleRevoke(req, res);
  return sendJson(res, 404, { error: `Unknown Google endpoint: /api/google/${route}` });
}
