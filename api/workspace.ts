/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { handleWorkspace } from './_lib/handlers.js';
import { NormalizedRequest, NormalizedResponse } from './_lib/http.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  return handleWorkspace(req, res);
}
