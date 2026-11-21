/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IntegrationDiagnostics, SpreadsheetData } from '../types';
import { getActiveWorkspaceId, getTempSessionId } from './storage';

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
  accessMode: 'service-account' | 'public-readonly';
  sheets: GoogleSheetMetadataTab[];
}

export interface GoogleSheetValuesResponse {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetTitle: string;
  rangeUsed: string;
  accessMode: 'service-account' | 'public-readonly';
  headers: string[];
  rows: Record<string, any>[];
  headerRowIndex: number;
  rawRowCount: number;
  skippedEmptyRows: number;
}

export interface GoogleSheetSyncStats {
  rowsRetrieved: number;
  validRowsCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  deletedCount: number;
}

export interface GoogleSheetSyncResponse {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  accessMode: 'service-account' | 'public-readonly';
  persistedInDrive: boolean;
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

export interface GoogleSheetSyncHistoryItem {
  id: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  worksheetName: string;
  status: 'success' | 'failed';
  rowsRetrieved: number;
  validRowsCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorMessage?: string;
  syncedAt: string;
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

export function extractDriveFolderId(urlOrId: string): string | null {
  const clean = (urlOrId || '').trim();
  if (!clean) return null;
  const matchFolder = clean.match(/\/folders\/([a-zA-Z0-9_-]{10,120})/);
  if (matchFolder?.[1]) return matchFolder[1];
  const matchParam = clean.match(/[?&]id=([a-zA-Z0-9_-]{10,120})/);
  if (matchParam?.[1]) return matchParam[1];
  if (/^[a-zA-Z0-9_-]{15,120}$/.test(clean)) return clean;
  return null;
}

function buildWorkspaceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-workspace-session-id': getTempSessionId(),
  };
  const folderId = getActiveWorkspaceId();
  if (folderId) {
    headers['x-workspace-folder-id'] = folderId;
  }
  return headers;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildWorkspaceHeaders(),
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new SheetsApiError(
      response.status,
      'INVALID_SERVER_RESPONSE',
      `Unexpected response from server (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new SheetsApiError(
      response.status,
      parsed.code || 'API_ERROR',
      parsed.error || `Request failed with status ${response.status}`,
      parsed.details
    );
  }

  return parsed as T;
}

export async function fetchServerDiagnostics(): Promise<IntegrationDiagnostics> {
  const res = await apiJson<{ status: string; diagnostics: IntegrationDiagnostics }>('/api/health');
  return res.diagnostics;
}

export async function validateGoogleSpreadsheet(
  urlOrId: string
): Promise<GoogleSpreadsheetMetadata> {
  return apiJson<GoogleSpreadsheetMetadata>('/api/sheets/metadata', {
    method: 'POST',
    body: JSON.stringify({ url: urlOrId }),
  });
}

export async function fetchGoogleSheetWorksheetValues(params: {
  urlOrId: string;
  sheetTitle: string;
  range?: string;
  headerRowIndex?: number | 'auto';
}): Promise<GoogleSheetValuesResponse> {
  return apiJson<GoogleSheetValuesResponse>('/api/sheets/values', {
    method: 'POST',
    body: JSON.stringify({
      url: params.urlOrId,
      sheetTitle: params.sheetTitle,
      range: params.range || undefined,
      headerRowIndex: params.headerRowIndex ?? 'auto',
    }),
  });
}

export async function syncGoogleSpreadsheet(params: {
  urlOrId: string;
  selectedSheets?: string[];
  syncAllSheets?: boolean;
  range?: string;
  headerRowIndex?: number | 'auto';
}): Promise<GoogleSheetSyncResponse> {
  return apiJson<GoogleSheetSyncResponse>('/api/sheets/sync', {
    method: 'POST',
    body: JSON.stringify({
      url: params.urlOrId,
      selectedSheets: params.selectedSheets,
      syncAllSheets: Boolean(params.syncAllSheets),
      range: params.range || undefined,
      headerRowIndex: params.headerRowIndex ?? 'auto',
    }),
  });
}

export async function fetchPersistedGoogleSheets(): Promise<{
  activeSpreadsheet: {
    spreadsheetId: string;
    spreadsheetTitle: string;
    spreadsheetUrl: string;
    lastSyncedAt: string;
    worksheets: Array<{
      name: string;
      headers: string[];
      rows: Record<string, any>[];
      headerRowIndex: number;
      rangeUsed: string;
    }>;
  } | null;
  syncHistory: GoogleSheetSyncHistoryItem[];
}> {
  return apiJson('/api/sheets/data');
}

export function extractSpreadsheetId(urlOrId: string): string {
  const id = extractGoogleSheetId(urlOrId);
  if (!id) {
    throw new Error('Invalid Google Sheets URL or ID. Please paste a valid Google Sheets link.');
  }
  return id;
}

export function parseValuesToSpreadsheetData(
  title: string,
  sheets: Array<{ title: string }>,
  sheetValuesMap: Record<string, any[][]>
): SpreadsheetData {
  const worksheets = sheets.map((sheet) => {
    const rawRows = sheetValuesMap[sheet.title] || [];
    if (rawRows.length === 0) {
      return { name: sheet.title, headers: [], rows: [] };
    }

    const headerRowIndex = rawRows.findIndex((row) =>
      Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== '')
    );

    if (headerRowIndex === -1) {
      return { name: sheet.title, headers: [], rows: [] };
    }

    const rawHeaders = rawRows[headerRowIndex] || [];
    const seen = new Map<string, number>();
    const headers = rawHeaders.map((h, idx) => {
      const base = String(h ?? '').trim() || `Col_${idx + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base} (${count + 1})`;
    });

    const rows: Record<string, any>[] = [];
    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const cells = rawRows[i];
      if (!Array.isArray(cells)) continue;
      const hasValue = cells.some((c) => String(c ?? '').trim() !== '');
      if (!hasValue) continue;

      const rowObj: Record<string, any> = {};
      headers.forEach((header, idx) => {
        const val = cells[idx];
        rowObj[header] = val === undefined || val === null ? '' : String(val);
      });
      rows.push(rowObj);
    }

    return {
      name: sheet.title,
      headers,
      rows,
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

