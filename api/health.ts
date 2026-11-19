import type { NormalizedRequest, NormalizedResponse } from './_lib/http.js';
import { handleHealth } from './_lib/handlers.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  return handleHealth(req, res);
}
