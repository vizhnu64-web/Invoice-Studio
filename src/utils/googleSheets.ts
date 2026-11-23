/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IntegrationDiagnostics, SpreadsheetData } from '../types';
import {
  getAccessToken,
  getGoogleSession,
  markGoogleSessionExpired,
} from './googleAuthClient';

export interface GoogleSheetMetadataTab {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface GoogleSpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  accessMode: 'google-oauth';
  sheets: GoogleSheetMetadataTab[];
}

export interface GoogleSheetValuesResponse {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetTitle: string;
  rangeUsed: string;
  accessMode: 'google-oauth';
  headers: string[];
  rows: Record<string, any>[];
  headerRowIndex: number;
  rawRowCount: number;
  skippedEmptyRows: number;
}

export interface GoogleSheetSyncStats {
  rowsRetrieved: number;
  validRowsCount: number;
  skippedCount: number;
}

export interface GoogleSheetSyncResponse {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  accessMode: 'google-oauth';
  lastSyncedAt: string;
  availableSheets: GoogleSheetMetadataTab[];
  worksheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, any>[];
    headerRowIndex: number;
    rangeUsed: string;
  }>;
  stats: GoogleSheetSyncStats;
}

export class SheetsApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, any>;

  constructor(status: number, code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function extractGoogleSheetId(urlOrId: string): string | null {
  const clean = (urlOrId || '').trim();
  if (!clean) return null;
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,100}$/.test(clean)) return clean;
  return null;
}

export function extractSpreadsheetId(urlOrId: string): string {
  const id = extractGoogleSheetId(urlOrId);
  if (!id) {
    throw new Error('Invalid Google Sheets URL or ID. Please paste a valid Google Sheets link.');
  }
  return id;
}

function escapeSheetTitleForRange(sheetTitle: string): string {
  const safe = sheetTitle.replace(/'/g, "''");
  return `'${safe}'`;
}

export function buildSheetA1Range(sheetTitle: string, customRange?: string, maxRows = 5000): string {
  const cleanCustom = (customRange || '').trim();
  if (cleanCustom) {
    if (!/^[A-Za-z0-9_!:'\s$-]+$/.test(cleanCustom)) {
      throw new SheetsApiError(400, 'INVALID_RANGE', 'Custom A1 range contains invalid characters.');
    }
    return cleanCustom.includes('!')
      ? cleanCustom
      : `${escapeSheetTitleForRange(sheetTitle)}!${cleanCustom}`;
  }
  const boundedRows = Math.min(Math.max(maxRows, 100), 20000);
  return `${escapeSheetTitleForRange(sheetTitle)}!A1:ZZ${boundedRows}`;
}

export function normalizeSheetValuesArray(
  rawValues: any[][],
  headerRowIndexMode: number | 'auto' = 'auto'
): {
  headers: string[];
  rows: Record<string, any>[];
  headerRowIndex: number;
  rawRowCount: number;
  skippedEmptyRows: number;
} {
  if (!Array.isArray(rawValues) || rawValues.length === 0) {
    return { headers: [], rows: [], headerRowIndex: 0, rawRowCount: 0, skippedEmptyRows: 0 };
  }

  let headerRowIndex = 0;
  if (headerRowIndexMode === 'auto') {
    const firstNonEmpty = rawValues.findIndex(
      (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== '')
    );
    headerRowIndex = firstNonEmpty >= 0 ? firstNonEmpty : 0;
  } else {
    headerRowIndex = Math.max(0, Math.min(Number(headerRowIndexMode) || 0, rawValues.length - 1));
  }

  const rawHeaders = Array.isArray(rawValues[headerRowIndex]) ? rawValues[headerRowIndex] : [];
  const maxWidth = rawValues.reduce(
    (max, row) => (Array.isArray(row) ? Math.max(max, row.length) : max),
    rawHeaders.length
  );

  const seen = new Map<string, number>();
  const headers: string[] = [];
  for (let i = 0; i < maxWidth; i++) {
    const base = String(rawHeaders[i] ?? '').trim() || `Column_${i + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    headers.push(count === 0 ? base : `${base} (${count + 1})`);
  }

  const rows: Record<string, any>[] = [];
  let skippedEmptyRows = 0;
  let rawRowCount = 0;

  for (let i = headerRowIndex + 1; i < rawValues.length; i++) {
    rawRowCount += 1;
    const cells = rawValues[i];
    if (!Array.isArray(cells) || !cells.some((c) => String(c ?? '').trim() !== '')) {
      skippedEmptyRows += 1;
      continue;
    }

    const rowObj: Record<string, any> = {};
    for (let col = 0; col < headers.length; col++) {
      const val = cells[col];
      rowObj[headers[col]] = val === undefined || val === null ? '' : String(val);
    }
    rows.push(rowObj);
  }

  return {
    headers,
    rows,
    headerRowIndex,
    rawRowCount,
    skippedEmptyRows,
  };
}

function getSheetsAccessToken(overrideToken?: string): string {
  const token = overrideToken || getAccessToken();
  if (!token) {
    throw new SheetsApiError(
      401,
      'SHEETS_AUTH_REQUIRED',
      'Connect your Google account and grant Google Sheets permission before importing a spreadsheet.'
    );
  }
  const session = getGoogleSession();
  if (!overrideToken && session && !session.permissions.sheetsGranted) {
    throw new SheetsApiError(
      403,
      'SHEETS_PERMISSION_MISSING',
      'Google Sheets permission has not been granted yet. Click "Grant Sheets Permission" to continue.'
    );
  }
  return token;
}

async function backendSheetsRequest<T>(
  endpoint: string,
  body: Record<string, any>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (res.status === 401) {
    markGoogleSessionExpired();
    throw new SheetsApiError(
      401,
      parsed.code || 'GOOGLE_TOKEN_EXPIRED',
      parsed.error ||
        'Your Google authorization expired or was revoked. Reconnect your Google account and try again.'
    );
  }

  if (!res.ok) {
    throw new SheetsApiError(
      res.status,
      parsed.code || 'SHEETS_API_ERROR',
      parsed.error || `Google Sheets request failed (HTTP ${res.status}).`,
      parsed.details
    );
  }

  return parsed as T;
}

export async function fetchServerDiagnostics(): Promise<IntegrationDiagnostics> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health check failed (${res.status})`);
  }
  const data = (await res.json()) as { diagnostics: IntegrationDiagnostics };
  return data.diagnostics;
}

export async function validateGoogleSpreadsheet(
  urlOrId: string,
  options?: { accessToken?: string; fetchImpl?: typeof fetch }
): Promise<GoogleSpreadsheetMetadata> {
  const spreadsheetId = extractGoogleSheetId(urlOrId);
  if (!spreadsheetId) {
    throw new SheetsApiError(
      400,
      'INVALID_SPREADSHEET_URL',
      'Invalid Google Sheets URL or ID. Paste a link like https://docs.google.com/spreadsheets/d/<id>/edit or select a file with Google Picker.'
    );
  }

  const token = getSheetsAccessToken(options?.accessToken);
  return backendSheetsRequest<GoogleSpreadsheetMetadata>(
    '/api/sheets/metadata',
    { urlOrId: spreadsheetId },
    token,
    options?.fetchImpl
  );
}

export async function fetchGoogleSheetWorksheetValues(params: {
  urlOrId: string;
  sheetTitle: string;
  range?: string;
  headerRowIndex?: number | 'auto';
  spreadsheetTitle?: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleSheetValuesResponse> {
  const spreadsheetId = extractGoogleSheetId(params.urlOrId);
  if (!spreadsheetId) {
    throw new SheetsApiError(400, 'INVALID_SPREADSHEET_URL', 'Invalid Google Sheets URL or ID.');
  }

  const token = getSheetsAccessToken(params.accessToken);
  return backendSheetsRequest<GoogleSheetValuesResponse>(
    '/api/sheets/values',
    {
      urlOrId: spreadsheetId,
      sheetTitle: params.sheetTitle,
      range: params.range,
      headerRowIndex: params.headerRowIndex ?? 'auto',
      spreadsheetTitle: params.spreadsheetTitle,
    },
    token,
    params.fetchImpl
  );
}

export async function syncGoogleSpreadsheet(params: {
  urlOrId: string;
  selectedSheets?: string[];
  syncAllSheets?: boolean;
  range?: string;
  headerRowIndex?: number | 'auto';
  accessToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleSheetSyncResponse> {
  const spreadsheetId = extractGoogleSheetId(params.urlOrId);
  if (!spreadsheetId) {
    throw new SheetsApiError(400, 'INVALID_SPREADSHEET_URL', 'Invalid Google Sheets URL or ID.');
  }

  const token = getSheetsAccessToken(params.accessToken);
  return backendSheetsRequest<GoogleSheetSyncResponse>(
    '/api/sheets/sync',
    {
      urlOrId: spreadsheetId,
      selectedSheets: params.selectedSheets,
      syncAllSheets: Boolean(params.syncAllSheets),
      range: params.range,
      headerRowIndex: params.headerRowIndex ?? 'auto',
    },
    token,
    params.fetchImpl
  );
}

export function parseValuesToSpreadsheetData(
  title: string,
  sheets: Array<{ title: string }>,
  sheetValuesMap: Record<string, any[][]>
): SpreadsheetData {
  const worksheets = sheets.map((sheet) => {
    const rawRows = sheetValuesMap[sheet.title] || [];
    const normalized = normalizeSheetValuesArray(rawRows, 'auto');
    return {
      name: sheet.title,
      headers: normalized.headers,
      rows: normalized.rows,
    };
  });

  const cleanTitle = (title || 'Google Sheet').trim();
  const fileName = cleanTitle.endsWith('.gsheet') ? cleanTitle : `${cleanTitle}.gsheet`;
  return {
    fileName,
    activeSheetName: worksheets[0]?.name || '',
    worksheets,
  };
}

export function buildSpreadsheetDataFromSync(syncResult: GoogleSheetSyncResponse): SpreadsheetData {
  const firstSheet = syncResult.worksheets[0]?.name || '';
  return {
    fileName: `${syncResult.spreadsheetTitle} (Google Sheets)`,
    activeSheetName: firstSheet,
    worksheets: syncResult.worksheets.map((ws) => ({
      name: ws.name,
      headers: ws.headers,
      rows: ws.rows,
    })),
  };
}
