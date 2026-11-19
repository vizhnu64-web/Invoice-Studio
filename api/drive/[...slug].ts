/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleDriveBackup,
  handleDriveRestore,
  handleDriveStatus,
  handleDriveSync,
  handleDriveUploadPdf,
} from '../_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse, sendJson } from '../_lib/http.js';

function extractDrivePath(req: NormalizedRequest): string {
  const slug = req.query?.slug;
  if (Array.isArray(slug) && slug.length > 0) return slug.join('/');
  if (typeof slug === 'string' && slug) return slug;
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/drive\/?/, '');
}

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractDrivePath(req);
  if (route === 'status') return handleDriveStatus(req, res);
  if (route === 'sync') return handleDriveSync(req, res);
  if (route === 'upload-pdf') return handleDriveUploadPdf(req, res);
  if (route === 'restore') return handleDriveRestore(req, res);
  if (route === 'backup') return handleDriveBackup(req, res);
  return sendJson(res, 404, { error: `Unknown drive endpoint: /api/drive/${route}` });
}
