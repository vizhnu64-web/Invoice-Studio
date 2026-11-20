/**
 * Vercel catch-all serverless entry point.
 * The previous Express server is retained for local development, while every
 * /api/* request in production is dispatched directly to the shared handlers.
 */
import type { NormalizedRequest, NormalizedResponse } from './_lib/http.js';
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
} from './_lib/handlers.js';

export default async function handler(req: NormalizedRequest, res: NormalizedResponse) {
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (path === '/api/health') return await handleHealth(req, res);
    if (path === '/api/auth/google/start') return await handleGoogleAuthStart(req, res);
    if (path === '/api/auth/google/callback') return await handleGoogleAuthCallback(req, res);
    if (path === '/api/auth/status') return await handleAuthStatus(req, res);
    if (path === '/api/auth/disconnect') return await handleAuthDisconnect(req, res);
    if (path === '/api/workspace') return await handleWorkspace(req, res);

    if (path === '/api/quotations') return await handleQuotations(req, res, []);
    if (path.startsWith('/api/quotations/')) {
      const segments = path.slice('/api/quotations/'.length).split('/').filter(Boolean).map(decodeURIComponent);
      return await handleQuotations(req, res, segments);
    }
    if (path === '/api/invoices') return await handleInvoices(req, res, []);
    if (path.startsWith('/api/invoices/')) {
      const segments = path.slice('/api/invoices/'.length).split('/').filter(Boolean).map(decodeURIComponent);
      return await handleInvoices(req, res, segments);
    }

    if (path === '/api/drive/status') return await handleDriveStatus(req, res);
    if (path === '/api/drive/sync') return await handleDriveSync(req, res);
    if (path === '/api/drive/upload-pdf') return await handleDriveUploadPdf(req, res);
    if (path === '/api/drive/restore') return await handleDriveRestore(req, res);
    if (path === '/api/drive/backup') return await handleDriveBackup(req, res);

    if (path === '/api/sheets/metadata') return await handleSheetsMetadata(req, res);
    if (path === '/api/sheets/values') return await handleSheetsValues(req, res);
    if (path === '/api/sheets/sync') return await handleSheetsSync(req, res);
    if (path === '/api/sheets/data') return await handleSheetsData(req, res);

    if (path === '/api/email/smtp-config') return await handleSmtpConfig(req, res);
    if (path === '/api/email/smtp-test') return await handleSmtpTest(req, res);
    if (path === '/api/email/test-send') return await handleEmailTestSend(req, res);
    if (path === '/api/email/send') return await handleEmailSend(req, res);
    if (path === '/api/email/history') return await handleEmailHistory(req, res);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.statusCode = 404;\n    res.setHeader('Content-Type', 'application/json; charset=utf-8');\n    return res.end(JSON.stringify({ error: 'API endpoint not found', path }));
  } catch (error) {
    console.error('Invoice Studio API handler error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;\n      res.setHeader('Content-Type', 'application/json; charset=utf-8');\n      return res.end(JSON.stringify({ error: 'Unexpected API server error.' }));
    }
  }
}
