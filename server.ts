/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  handleDriveBackups,
  handleDriveConnect,
  handleDriveFiles,
  handleDriveWorkspace,
  handleEmailHistory,
  handleEmailSend,
  handleEmailTestSend,
  handleGmailHistory,
  handleGmailSend,
  handleGmailTestSend,
  handleGoogleConfig,
  handleGoogleRevoke,
  handleGoogleTest,
  handleGoogleVerifySession,
  handleHealth,
  handleSheetsMetadata,
  handleSheetsSync,
  handleSheetsValues,
  handleSmtpConfig,
  handleSmtpTest,
} from './api/_lib/handlers.js';
import type { NormalizedRequest, NormalizedResponse } from './api/_lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  const PORT = Number(process.env.PORT || 3000);

  const adapt =
    (fn: (req: NormalizedRequest, res: NormalizedResponse) => Promise<any>) =>
    (req: express.Request, res: express.Response) =>
      fn(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse);

  // Health & Server Capability Diagnostics (No Secrets)
  app.all('/api/health', adapt(handleHealth));

  // Google Auth & Session Verification (Stateless Bearer Token)
  app.all('/api/google/config', adapt(handleGoogleConfig));
  app.all('/api/google/verify-session', adapt(handleGoogleVerifySession));
  app.all('/api/google/test', adapt(handleGoogleTest));
  app.all('/api/google/revoke', adapt(handleGoogleRevoke));

  // Google Drive Workspace (Request-Scoped Drive API v3)
  app.all('/api/drive/connect', adapt(handleDriveConnect));
  app.all('/api/drive/workspace', adapt(handleDriveWorkspace));
  app.all('/api/drive/files', adapt(handleDriveFiles));
  app.all('/api/drive/backups', adapt(handleDriveBackups));

  // Google Sheets Import & Sync (Request-Scoped Sheets API v4)
  app.all('/api/sheets/metadata', adapt(handleSheetsMetadata));
  app.all('/api/sheets/values', adapt(handleSheetsValues));
  app.all('/api/sheets/sync', adapt(handleSheetsSync));

  // Gmail API Sending (Default Email Provider — Request-Scoped Gmail API v1)
  app.all('/api/gmail/send', adapt(handleGmailSend));
  app.all('/api/gmail/test-send', adapt(handleGmailTestSend));
  app.all('/api/gmail/history', adapt(handleGmailHistory));

  // Custom SMTP (Optional Alternative — Encrypted in User's Drive)
  app.all('/api/email/smtp-config', adapt(handleSmtpConfig));
  app.all('/api/email/smtp-test', adapt(handleSmtpTest));
  app.all('/api/email/test-send', adapt(handleEmailTestSend));
  app.all('/api/email/send', adapt(handleEmailSend));
  app.all('/api/email/history', adapt(handleEmailHistory));

  // Reject unknown API endpoints cleanly as JSON
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown API endpoint: ${req.originalUrl}` });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Invoice Studio server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Invoice Studio server:', err);
  process.exit(1);
});
