/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleSheetsData,
  handleSheetsMetadata,
  handleSheetsSync,
  handleSheetsValues,
} from '../_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse, sendJson } from '../_lib/http.js';

function extractSheetsPath(req: NormalizedRequest): string {
  const slug = req.query?.slug;
  if (Array.isArray(slug) && slug.length > 0) return slug.join('/');
  if (typeof slug === 'string' && slug) return slug;
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/sheets\/?/, '');
}

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractSheetsPath(req);
  if (route === 'metadata') return handleSheetsMetadata(req, res);
  if (route === 'values') return handleSheetsValues(req, res);
  if (route === 'sync') return handleSheetsSync(req, res);
  if (route === 'data') return handleSheetsData(req, res);
  return sendJson(res, 404, { error: `Unknown sheets endpoint: /api/sheets/${route}` });
}
