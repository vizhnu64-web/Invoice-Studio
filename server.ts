/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {
  handleAuthDisconnect,
  handleAuthStatus,
  handleDriveBackup,
  handleDriveRestore,
  handleDriveStatus,
  handleDriveSync,
  handleDriveUploadPdf,
  handleEmailHistory,
  handleEmailSend,
  handleEmailTestSend,
  handleGoogleAuthCallback,
  handleGoogleAuthStart,
  handleHealth,
  handleInvoices,
  handleQuotations,
  handleSheetsData,
  handleSheetsMetadata,
  handleSheetsSync,
  handleSheetsValues,
  handleSmtpConfig,
  handleSmtpTest,
  handleWorkspace,
} from './api/_lib/handlers.js';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Parse JSON and URL-encoded bodies cleanly for API routes (allow base64 PDF payloads)
  app.use('/api', express.json({ limit: '25mb' }));
  app.use('/api', express.urlencoded({ extended: true, limit: '25mb' }));

  // Health & Auth
  app.all('/api/health', (req, res) => void handleHealth(req, res));
  app.all('/api/auth/google/start', (req, res) => void handleGoogleAuthStart(req, res));
  app.all('/api/auth/google/callback', (req, res) => void handleGoogleAuthCallback(req, res));
  app.all('/api/auth/status', (req, res) => void handleAuthStatus(req, res));
  app.all('/api/auth/disconnect', (req, res) => void handleAuthDisconnect(req, res));

  // Workspace, Onboarding & Customers (Google Drive backed)
  app.all('/api/workspace', (req, res) => void handleWorkspace(req, res));

  // Quotations (with status transitions & strict approval-gated conversion)
  app.all('/api/quotations', (req, res) => void handleQuotations(req, res, []));
  app.all('/api/quotations/:id', (req, res) => void handleQuotations(req, res, [req.params.id]));
  app.all('/api/quotations/:id/:action', (req, res) =>
    void handleQuotations(req, res, [req.params.id, req.params.action])
  );

  // Invoices
  app.all('/api/invoices', (req, res) => void handleInvoices(req, res, []));
  app.all('/api/invoices/:id', (req, res) => void handleInvoices(req, res, [req.params.id]));

  // Google Drive Storage
  app.all('/api/drive/status', (req, res) => void handleDriveStatus(req, res));
  app.all('/api/drive/sync', (req, res) => void handleDriveSync(req, res));
  app.all('/api/drive/upload-pdf', (req, res) => void handleDriveUploadPdf(req, res));
  app.all('/api/drive/restore', (req, res) => void handleDriveRestore(req, res));
  app.all('/api/drive/backup', (req, res) => void handleDriveBackup(req, res));

  // Google Sheets Import & Sync
  app.all('/api/sheets/metadata', (req, res) => void handleSheetsMetadata(req, res));
  app.all('/api/sheets/values', (req, res) => void handleSheetsValues(req, res));
  app.all('/api/sheets/sync', (req, res) => void handleSheetsSync(req, res));
  app.all('/api/sheets/data', (req, res) => void handleSheetsData(req, res));

  // Dual Email Delivery (Gmail API + Per-User Encrypted SMTP)
  app.all('/api/email/smtp-config', (req, res) => void handleSmtpConfig(req, res));
  app.all('/api/email/smtp-test', (req, res) => void handleSmtpTest(req, res));
  app.all('/api/email/test-send', (req, res) => void handleEmailTestSend(req, res));
  app.all('/api/email/send', (req, res) => void handleEmailSend(req, res));
  app.all('/api/email/history', (req, res) => void handleEmailHistory(req, res));

  // Ensure unmatched /api/* endpoints return JSON 404 (never SPA HTML)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Invoice Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Invoice Studio server:', err);
  process.exit(1);
});
