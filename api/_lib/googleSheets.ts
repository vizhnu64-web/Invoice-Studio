/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { google, sheets_v4 } from 'googleapis';
import { HttpApiError } from './errors.js';
import { createRequestOAuthClient } from './googleAuth.js';

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
  stats: {
    rowsRetrieved: number;
    validRowsCount: number;
    skippedCount: number;
  };
}

export interface SheetsApiLike {
  spreadsheets: {
    get: (params: any) => Promise<{ data: any }>;
    values: {
      get: (params: any) => Promise<{ data: any }>;
    };
  };
}

export function createRequestSheetsClient(accessToken: string): sheets_v4.Sheets {
  const auth = createRequestOAuthClient(accessToken);
  return google.sheets({ version: 'v4', auth });
}

export function extractGoogleSheetId(urlOrId: string): string | null {
  const clean = String(urlOrId || '').trim();
  if (!clean) return null;
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,100}$/.test(clean)) return clean;
  return null;
}

function escapeSheetTitleForRange(sheetTitle: string): string {
  const safe = sheetTitle.replace(/'/g, "''");
  return `'${safe}'`;
}

export function buildSheetA1Range(sheetTitle: string, customRange?: string, maxRows = 5000): string {
  const cleanCustom = String(customRange || '').trim();
  if (cleanCustom) {
    if (!/^[A-Za-z0-9_!:'\s$-]+$/.test(cleanCustom)) {
      throw new HttpApiError(400, 'INVALID_RANGE', 'Custom A1 range contains invalid characters.');
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

function mapSheetsApiError(err: any, context: string): HttpApiError {
  if (err instanceof HttpApiError) return err;
  const status = Number(err?.code || err?.response?.status || err?.status || 502);
  const reason = String(
    err?.errors?.[0]?.reason ||
      err?.response?.data?.error?.errors?.[0]?.reason ||
      err?.response?.data?.error?.status ||
      ''
  );
  const apiMessage = String(err?.response?.data?.error?.message || err?.message || '');

  if (status === 401 || reason === 'authError' || reason === 'invalidCredentials') {
    return new HttpApiError(
      401,
      'GOOGLE_TOKEN_EXPIRED',
      'Your Google authorization expired or was revoked. Reconnect your Google account and try again.'
    );
  }
  if (status === 403) {
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return new HttpApiError(
        429,
        'SHEETS_RATE_LIMITED',
        'Google Sheets API quota limit reached. Wait a few seconds and retry.'
      );
    }
    return new HttpApiError(
      403,
      'SHEETS_PERMISSION_DENIED',
      apiMessage ||
        `Permission denied while attempting to ${context}. Ensure your connected Google account has viewer or editor access to this spreadsheet.`,
      reason ? { reason } : undefined
    );
  }
  if (status === 404) {
    return new HttpApiError(
      404,
      'SPREADSHEET_NOT_FOUND',
      'Spreadsheet not found. Verify the URL or select the spreadsheet using Google Picker.'
    );
  }
  return new HttpApiError(
    status >= 400 && status < 600 ? status : 502,
    'SHEETS_API_ERROR',
    apiMessage || `Google Sheets API request failed while attempting to ${context}.`
  );
}

export async function getSpreadsheetMetadata(
  sheets: SheetsApiLike,
  urlOrId: string
): Promise<GoogleSpreadsheetMetadata> {
  const spreadsheetId = extractGoogleSheetId(urlOrId);
  if (!spreadsheetId) {
    throw new HttpApiError(
      400,
      'INVALID_SPREADSHEET_URL',
      'Invalid Google Sheets URL or ID. Paste a link like https://docs.google.com/spreadsheets/d/<id>/edit.'
    );
  }

  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        'spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
    });
    const data = res.data || {};
    const tabs: GoogleSheetMetadataTab[] = (Array.isArray(data.sheets) ? data.sheets : [])
      .map((s: any, idx: number) => ({
        sheetId: s.properties?.sheetId ?? idx,
        title: String(s.properties?.title || `Sheet${idx + 1}`),
        index: s.properties?.index ?? idx,
        rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
        columnCount: s.properties?.gridProperties?.columnCount ?? 26,
      }))
      .sort((a: GoogleSheetMetadataTab, b: GoogleSheetMetadataTab) => a.index - b.index);

    if (tabs.length === 0) {
      throw new HttpApiError(
        400,
        'EMPTY_SPREADSHEET',
        'This Google Spreadsheet does not contain any worksheets.'
      );
    }

    return {
      spreadsheetId: String(data.spreadsheetId || spreadsheetId),
      spreadsheetTitle: String(data.properties?.title || 'Untitled Spreadsheet'),
      spreadsheetUrl: String(
        data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
      ),
      accessMode: 'google-oauth',
      sheets: tabs,
    };
  } catch (err) {
    throw mapSheetsApiError(err, 'read spreadsheet metadata');
  }
}

export async function getWorksheetValues(
  sheets: SheetsApiLike,
  params: {
    urlOrId: string;
    sheetTitle: string;
    range?: string;
    headerRowIndex?: number | 'auto';
    spreadsheetTitle?: string;
  }
): Promise<GoogleSheetValuesResponse> {
  const spreadsheetId = extractGoogleSheetId(params.urlOrId);
  if (!spreadsheetId) {
    throw new HttpApiError(400, 'INVALID_SPREADSHEET_URL', 'Invalid Google Sheets URL or ID.');
  }
  const sheetTitle = String(params.sheetTitle || '').trim();
  if (!sheetTitle) {
    throw new HttpApiError(400, 'MISSING_SHEET_TITLE', 'A worksheet tab name is required.');
  }

  const rangeUsed = buildSheetA1Range(sheetTitle, params.range);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeUsed,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rawValues = Array.isArray(res.data?.values) ? res.data.values : [];
    const normalized = normalizeSheetValuesArray(rawValues, params.headerRowIndex ?? 'auto');

    return {
      spreadsheetId,
      spreadsheetTitle: params.spreadsheetTitle || 'Google Spreadsheet',
      sheetTitle,
      rangeUsed,
      accessMode: 'google-oauth',
      headers: normalized.headers,
      rows: normalized.rows,
      headerRowIndex: normalized.headerRowIndex,
      rawRowCount: normalized.rawRowCount,
      skippedEmptyRows: normalized.skippedEmptyRows,
    };
  } catch (err) {
    throw mapSheetsApiError(err, `fetch values from "${sheetTitle}"`);
  }
}

export async function syncSpreadsheet(
  sheets: SheetsApiLike,
  params: {
    urlOrId: string;
    selectedSheets?: string[];
    syncAllSheets?: boolean;
    range?: string;
    headerRowIndex?: number | 'auto';
  }
): Promise<GoogleSheetSyncResponse> {
  const metadata = await getSpreadsheetMetadata(sheets, params.urlOrId);

  let targets: GoogleSheetMetadataTab[];
  if (params.syncAllSheets) {
    targets = metadata.sheets;
  } else if (Array.isArray(params.selectedSheets) && params.selectedSheets.length > 0) {
    const requested = new Set(params.selectedSheets.map((s) => String(s).trim()));
    targets = metadata.sheets.filter((s) => requested.has(s.title));
    if (targets.length === 0) {
      throw new HttpApiError(
        404,
        'WORKSHEET_NOT_FOUND',
        `Selected worksheet(s) not found in "${metadata.spreadsheetTitle}".`
      );
    }
  } else {
    targets = [metadata.sheets[0]];
  }

  const worksheets: GoogleSheetSyncResponse['worksheets'] = [];
  let rowsRetrieved = 0;
  let skippedCount = 0;

  for (const sheet of targets) {
    const values = await getWorksheetValues(sheets, {
      urlOrId: metadata.spreadsheetId,
      sheetTitle: sheet.title,
      range: targets.length === 1 ? params.range : undefined,
      headerRowIndex: params.headerRowIndex,
      spreadsheetTitle: metadata.spreadsheetTitle,
    });
    rowsRetrieved += values.rawRowCount;
    skippedCount += values.skippedEmptyRows;
    worksheets.push({
      name: values.sheetTitle,
      headers: values.headers,
      rows: values.rows,
      headerRowIndex: values.headerRowIndex,
      rangeUsed: values.rangeUsed,
    });
  }

  const validRowsCount = worksheets.reduce((acc, ws) => acc + ws.rows.length, 0);
  if (validRowsCount === 0) {
    throw new HttpApiError(
      422,
      'NO_DATA_ROWS_FOUND',
      `No data rows were retrieved from "${metadata.spreadsheetTitle}". Check the selected worksheet and header row.`
    );
  }

  return {
    spreadsheetId: metadata.spreadsheetId,
    spreadsheetTitle: metadata.spreadsheetTitle,
    spreadsheetUrl: metadata.spreadsheetUrl,
    accessMode: 'google-oauth',
    lastSyncedAt: new Date().toISOString(),
    availableSheets: metadata.sheets,
    worksheets,
    stats: {
      rowsRetrieved,
      validRowsCount,
      skippedCount,
    },
  };
}
