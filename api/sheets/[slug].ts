/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleSheetsMetadata,
  handleSheetsSync,
  handleSheetsValues,
} from '../_lib/handlers.js';
import {
  extractCatchAllRoute,
  NormalizedRequest,
  NormalizedResponse,
  sendJson,
} from '../_lib/http.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractCatchAllRoute(req, '/api/sheets');
  if (route === 'metadata') return handleSheetsMetadata(req, res);
  if (route === 'values') return handleSheetsValues(req, res);
  if (route === 'sync') return handleSheetsSync(req, res);
  return sendJson(res, 404, { error: `Unknown Sheets endpoint: /api/sheets/${route}` });
}
