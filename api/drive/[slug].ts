/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  handleDriveBackups,
  handleDriveConnect,
  handleDriveFiles,
  handleDriveWorkspace,
} from '../_lib/handlers.js';
import {
  extractCatchAllRoute,
  NormalizedRequest,
  NormalizedResponse,
  sendJson,
} from '../_lib/http.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const route = extractCatchAllRoute(req, '/api/drive');
  if (route === 'connect') return handleDriveConnect(req, res);
  if (route === 'workspace') return handleDriveWorkspace(req, res);
  if (route === 'files') return handleDriveFiles(req, res);
  if (route === 'backups') return handleDriveBackups(req, res);
  return sendJson(res, 404, { error: `Unknown Drive endpoint: /api/drive/${route}` });
}
