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
  const method = (req.method || 'GET').toUpperCase();

  try {
    if (path === '/api/health') return await handleHealth(req, res);
    if (path === '/api/auth/google/start') return await handleGoogleAuthStart(req, res);
    if (path === '/api/auth/google/callback') return await handleGoogleAuthCallback(req, res);
    if (path === '/api/auth/status') return await handleAuthStatus(req, res);
    if (path === '/api/auth/disconnect') return await handleAuthDisconnect(req, res);
    if (path === '/api/workspace') return await handleWorkspace(req, res);

    const quotationMatch = path.match(/^\\/api\\/quotations(?:\\/([^/]+))?(?:\\/([^/]+))?$/);
    if (quotationMatch) return await handleQuotations(req, res, quotationMatch.slice(1).filter(Boolean));
    const invoiceMatch = path.match(/^\\/api\\/invoices(?:\\/([^/]+))?$/);
    if (invoiceMatch) return await handleInvoices(req, res, invoiceMatch.slice(1).filter(Boolean));

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
