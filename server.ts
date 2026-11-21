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
  handleDriveBackup,
  handleDriveConnect,
  handleDriveDiagnose,
  handleDriveRestore,
  handleDriveStatus,
  handleDriveSync,
  handleDriveTest,
  handleDriveUploadPdf,
  handleEmailHistory,
  handleEmailSend,
  handleEmailTestSend,
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
import type { NormalizedRequest, NormalizedResponse } from './api/_lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractSubSegments(url: string, prefix: string): string[] {
  const pathname = (url || '').split('?')[0];
  return pathname
    .replace(new RegExp(`^${prefix}/?`), '')
    .split('/')
    .filter(Boolean);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  const PORT = Number(process.env.PORT || 3000);

  // Health & Diagnostics
  app.all('/api/health', (req, res) =>
    handleHealth(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );

  // Google Drive Folder Workspace Storage (Service Account)
  app.all('/api/drive/connect', (req, res) =>
    handleDriveConnect(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/test', (req, res) =>
    handleDriveTest(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/diagnose', (req, res) =>
    handleDriveDiagnose(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/status', (req, res) =>
    handleDriveStatus(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/sync', (req, res) =>
    handleDriveSync(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/upload-pdf', (req, res) =>
    handleDriveUploadPdf(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/backup', (req, res) =>
    handleDriveBackup(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/drive/restore', (req, res) =>
    handleDriveRestore(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );

  // Workspace state
  app.all('/api/workspace', (req, res) =>
    handleWorkspace(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );

  // Google Sheets URL Connector (Service Account + Public Fallback)
  app.all('/api/sheets/metadata', (req, res) =>
    handleSheetsMetadata(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/sheets/values', (req, res) =>
    handleSheetsValues(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/sheets/sync', (req, res) =>
    handleSheetsSync(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/sheets/data', (req, res) =>
    handleSheetsData(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );

  // Email Integration (Gmail SMTP & Custom SMTP via Nodemailer)
  app.all('/api/email/smtp-config', (req, res) =>
    handleSmtpConfig(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/email/smtp-test', (req, res) =>
    handleSmtpTest(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/email/test-send', (req, res) =>
    handleEmailTestSend(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/email/send', (req, res) =>
    handleEmailSend(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );
  app.all('/api/email/history', (req, res) =>
    handleEmailHistory(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse)
  );

  // Quotations & Invoices CRUD
  app.all('/api/quotations', (req, res) =>
    handleQuotations(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse, [])
  );
  app.all('/api/quotations/*', (req, res) =>
    handleQuotations(
      req as unknown as NormalizedRequest,
      res as unknown as NormalizedResponse,
      extractSubSegments(req.originalUrl, '/api/quotations')
    )
  );
  app.all('/api/invoices', (req, res) =>
    handleInvoices(req as unknown as NormalizedRequest, res as unknown as NormalizedResponse, [])
  );
  app.all('/api/invoices/*', (req, res) =>
    handleInvoices(
      req as unknown as NormalizedRequest,
      res as unknown as NormalizedResponse,
      extractSubSegments(req.originalUrl, '/api/invoices')
    )
  );

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
