/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleInvoices } from '../_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse } from '../_lib/http.js';

function extractSegments(req: NormalizedRequest): string[] {
  const slug = req.query?.slug;
  if (Array.isArray(slug)) return slug.filter(Boolean);
  if (typeof slug === 'string' && slug) return slug.split('/').filter(Boolean);
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/invoices\/?/, '').split('/').filter(Boolean);
}

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  return handleInvoices(req, res, extractSegments(req));
}
