/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleQuotations } from '../_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse } from '../_lib/http.js';

function extractSegments(req: NormalizedRequest): string[] {
  const slug = req.query?.slug;
  if (Array.isArray(slug)) return slug.filter(Boolean);
  if (typeof slug === 'string' && slug) return slug.split('/').filter(Boolean);
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/quotations\/?/, '').split('/').filter(Boolean);
}

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  return handleQuotations(req, res, extractSegments(req));
}
