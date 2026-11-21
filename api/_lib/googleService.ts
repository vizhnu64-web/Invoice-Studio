/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { google, sheets_v4 } from 'googleapis';
import { AppServerConfig, GOOGLE_SHEETS_SERVICE_SCOPE } from './config.js';
import { GoogleDriveStore, StoredSheetsDataset } from './driveStore.js';
import { HttpApiError } from './errors.js';
import { generateRandomId } from './crypto.js';
import {
  buildSheetRange,
  computeSyncDiff,
  extractSpreadsheetId,
  normalizeSheetValues,
  SheetMetadataItem,
} from './sheetsNormalization.js';

export { HttpApiError };

export interface SpreadsheetMetadataResult {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  accessMode: 'service-account' | 'public-readonly';
  sheets: SheetMetadataItem[];
}

export interface SheetValuesResult {
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

function createSheetsServiceAccountClient(config: AppServerConfig): sheets_v4.Sheets | null {
  if (
    !config.googleServiceAccountEmail ||
    !config.googleServiceAccountPrivateKey ||
    !config.googleServiceAccountPrivateKey.includes('BEGIN')
  ) {
    return null;
  }

  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: [GOOGLE_SHEETS_SERVICE_SCOPE],
  });

  return google.sheets({ version: 'v4', auth });
}

function mapSheetsApiError(err: any, config: AppServerConfig, spreadsheetId?: string): HttpApiError {
  if (err instanceof HttpApiError) return err;
  const status = err?.code || err?.status || err?.response?.status || 500;
  const rawMessage =
    err?.response?.data?.error?.message ||
    err?.errors?.[0]?.message ||
    err?.message ||
    'Google Sheets API request failed.';
  const serviceAccountEmail = config.googleServiceAccountEmail || null;

  if (status === 403 || status === 404) {
    return new HttpApiError(
      403,
      'SHEETS_PERMISSION_REQUIRED',
      serviceAccountEmail
        ? `Access denied to this Google Sheet. Share the spreadsheet with ${serviceAccountEmail} as Viewer (or make it publicly viewable), then click Connect again.`
        : 'Cannot access this Google Sheet. Either configure the server Google Service Account and share the sheet with it, or set the spreadsheet sharing to "Anyone with the link can view".',
      {
        spreadsheetId,
        serviceAccountEmail,
        requiredRole: 'Viewer',
      }
    );
  }

  if (status === 429) {
    return new HttpApiError(
      429,
      'SHEETS_RATE_LIMITED',
      'Google Sheets API quota limit reached. Please wait a moment and retry.'
    );
  }

  return new HttpApiError(
    status >= 400 && status < 600 ? status : 500,
    'SHEETS_API_ERROR',
    rawMessage,
    { serviceAccountEmail }
  );
}

/**
 * Parses Google Visualization API response (publicly shared sheets read-only fallback).
 * Strictly constructs the URL against docs.google.com using a validated spreadsheetId to prevent SSRF.
 */
async function fetchPublicGoogleSheetGviz(
  spreadsheetId: string,
  sheetTitle?: string
): Promise<{
  title: string;
  sheetName: string;
  values: any[][];
}> {
  if (!/^[a-zA-Z0-9_-]{15,120}$/.test(spreadsheetId)) {
    throw new HttpApiError(400, 'INVALID_SPREADSHEET_ID', 'Invalid Google Sheets ID.');
  }

  const params = new URLSearchParams({ tqx: 'out:json' });
  if (sheetTitle && sheetTitle.trim()) {
    params.set('sheet', sheetTitle.trim());
  }

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: 'text/plain, application/json' },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Public sheet endpoint returned HTTP ${response.status}`);
  }

  const text = await response.text();
  // Private sheets redirect to accounts.google.com HTML login page
  if (text.trim().startsWith('<!DOCTYPE') || text.includes('ServiceLogin')) {
    throw new Error('Spreadsheet is private and requires service-account sharing.');
  }

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('Unexpected response format from public Google Sheets endpoint.');
  }

  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  if (parsed.status === 'error') {
    const msg = parsed.errors?.[0]?.detailed_message || parsed.errors?.[0]?.message || 'Unable to read public sheet.';
    throw new Error(msg);
  }

  const table = parsed.table || {};
  const cols: Array<{ label?: string }> = Array.isArray(table.cols) ? table.cols : [];
  const rows: Array<{ c?: Array<{ v?: any; f?: string } | null> }> = Array.isArray(table.rows)
    ? table.rows
    : [];

  const values: any[][] = [];
  const headerLabels = cols.map((c) => (c.label || '').trim());
  const hasExplicitColLabels = headerLabels.some((label) => label.length > 0);
  if (hasExplicitColLabels) {
    values.push(headerLabels);
  }

  for (const row of rows) {
    const cells = Array.isArray(row.c) ? row.c : [];
    values.push(
      cells.map((cell) => {
        if (!cell) return '';
        if (cell.f !== undefined && cell.f !== null && String(cell.f).trim() !== '') {
          return String(cell.f);
        }
        if (cell.v === undefined || cell.v === null) return '';
        return String(cell.v);
      })
    );
  }

  return {
    title: 'Public Google Sheet',
    sheetName: sheetTitle?.trim() || 'Sheet1',
    values,
  };
}

export async function fetchSpreadsheetMetadata(options: {
  urlOrId: string;
  config: AppServerConfig;
}): Promise<SpreadsheetMetadataResult> {
  let spreadsheetId: string;
  try {
    spreadsheetId = extractSpreadsheetId(options.urlOrId);
  } catch (err: any) {
    throw new HttpApiError(400, 'INVALID_SPREADSHEET_URL', err?.message || 'Invalid Google Sheets URL.');
  }

  const sheetsClient = createSheetsServiceAccountClient(options.config);
  if (sheetsClient) {
    try {
      const response = await sheetsClient.spreadsheets.get({
        spreadsheetId,
        fields:
          'spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
      });

      const data = response.data;
      const sheets: SheetMetadataItem[] = (data.sheets || [])
        .map((s, idx) => ({
          sheetId: s.properties?.sheetId ?? idx,
          title: s.properties?.title || `Sheet${idx + 1}`,
          index: s.properties?.index ?? idx,
          rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
          columnCount: s.properties?.gridProperties?.columnCount ?? 26,
        }))
        .sort((a, b) => a.index - b.index);

      return {
        spreadsheetId: data.spreadsheetId || spreadsheetId,
        spreadsheetTitle: data.properties?.title || 'Untitled Spreadsheet',
        spreadsheetUrl:
          data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        accessMode: 'service-account',
        sheets,
      };
    } catch (saErr: any) {
      // If service account lacks permission, try public read-only fallback before reporting permission instructions
      try {
        const publicData = await fetchPublicGoogleSheetGviz(spreadsheetId);
        return {
          spreadsheetId,
          spreadsheetTitle: publicData.title,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          accessMode: 'public-readonly',
          sheets: [
            {
              sheetId: 0,
              title: publicData.sheetName,
              index: 0,
              rowCount: Math.max(publicData.values.length, 100),
              columnCount: Math.max(publicData.values[0]?.length || 10, 10),
            },
          ],
        };
      } catch {
        throw mapSheetsApiError(saErr, options.config, spreadsheetId);
      }
    }
  }

  // Service account not configured: attempt public read-only sheet fetch
  try {
    const publicData = await fetchPublicGoogleSheetGviz(spreadsheetId);
    return {
      spreadsheetId,
      spreadsheetTitle: publicData.title,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      accessMode: 'public-readonly',
      sheets: [
        {
          sheetId: 0,
          title: publicData.sheetName,
          index: 0,
          rowCount: Math.max(publicData.values.length, 100),
          columnCount: Math.max(publicData.values[0]?.length || 10, 10),
        },
      ],
    };
  } catch {
    throw new HttpApiError(
      403,
      'SHEETS_PERMISSION_REQUIRED',
      'Unable to read this spreadsheet. Either configure GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY on the server and share the sheet with the service account, or share the spreadsheet publicly ("Anyone with the link can view").',
      {
        spreadsheetId,
        serviceAccountEmail: options.config.googleServiceAccountEmail || null,
        requiredRole: 'Viewer',
      }
    );
  }
}

export async function fetchSheetValues(options: {
  urlOrId: string;
  sheetTitle?: string;
  customRange?: string;
  headerRowIndex?: number | 'auto';
  config: AppServerConfig;
}): Promise<SheetValuesResult> {
  const metadata = await fetchSpreadsheetMetadata({
    urlOrId: options.urlOrId,
    config: options.config,
  });

  if (metadata.sheets.length === 0) {
    throw new HttpApiError(400, 'EMPTY_SPREADSHEET', 'This Google Spreadsheet does not contain any worksheets.');
  }

  const targetSheet =
    options.sheetTitle && options.sheetTitle.trim()
      ? metadata.sheets.find((s) => s.title === options.sheetTitle?.trim()) ||
        (metadata.accessMode === 'public-readonly'
          ? {
              sheetId: 0,
              title: options.sheetTitle.trim(),
              index: 0,
              rowCount: 1000,
              columnCount: 26,
            }
          : undefined)
      : metadata.sheets[0];

  if (!targetSheet) {
    throw new HttpApiError(
      404,
      'WORKSHEET_NOT_FOUND',
      `Worksheet "${options.sheetTitle}" was not found in "${metadata.spreadsheetTitle}".`
    );
  }

  if (metadata.accessMode === 'service-account') {
    const sheetsClient = createSheetsServiceAccountClient(options.config);
    if (!sheetsClient) {
      throw new HttpApiError(503, 'SERVICE_ACCOUNT_NOT_CONFIGURED', 'Google service account is not configured.');
    }

    let rangeUsed: string;
    try {
      rangeUsed = buildSheetRange(
        targetSheet.title,
        options.customRange,
        Math.min(Math.max(targetSheet.rowCount || 2000, 100), 20000)
      );
    } catch (err: any) {
      throw new HttpApiError(400, 'INVALID_RANGE', err?.message || 'Invalid A1 range.');
    }

    try {
      const valRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: metadata.spreadsheetId,
        range: rangeUsed,
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });

      const rawValues = Array.isArray(valRes.data.values) ? valRes.data.values : [];
      const { worksheet } = normalizeSheetValues(targetSheet.title, rawValues, {
        headerRowIndex: options.headerRowIndex,
        rangeUsed,
      });

      return {
        spreadsheetId: metadata.spreadsheetId,
        spreadsheetTitle: metadata.spreadsheetTitle,
        sheetTitle: worksheet.name,
        rangeUsed: worksheet.rangeUsed,
        accessMode: 'service-account',
        headers: worksheet.headers,
        rows: worksheet.rows,
        headerRowIndex: worksheet.headerRowIndex,
        rawRowCount: worksheet.rawRowCount,
        skippedEmptyRows: worksheet.skippedEmptyRows,
      };
    } catch (err: any) {
      throw mapSheetsApiError(err, options.config, metadata.spreadsheetId);
    }
  }

  // Public read-only fallback
  try {
    const publicData = await fetchPublicGoogleSheetGviz(metadata.spreadsheetId, targetSheet.title);
    const { worksheet } = normalizeSheetValues(targetSheet.title, publicData.values, {
      headerRowIndex: options.headerRowIndex,
      rangeUsed: `${targetSheet.title}!A1:ZZ`,
    });

    return {
      spreadsheetId: metadata.spreadsheetId,
      spreadsheetTitle: metadata.spreadsheetTitle,
      sheetTitle: worksheet.name,
      rangeUsed: worksheet.rangeUsed,
      accessMode: 'public-readonly',
      headers: worksheet.headers,
      rows: worksheet.rows,
      headerRowIndex: worksheet.headerRowIndex,
      rawRowCount: worksheet.rawRowCount,
      skippedEmptyRows: worksheet.skippedEmptyRows,
    };
  } catch (err: any) {
    throw mapSheetsApiError(err, options.config, metadata.spreadsheetId);
  }
}

export async function performSpreadsheetSync(options: {
  urlOrId: string;
  selectedSheets?: string[];
  syncAllSheets?: boolean;
  customRange?: string;
  headerRowIndex?: number | 'auto';
  config: AppServerConfig;
  driveStore?: GoogleDriveStore | null;
}) {
  const metadata = await fetchSpreadsheetMetadata({
    urlOrId: options.urlOrId,
    config: options.config,
  });

  if (metadata.sheets.length === 0) {
    throw new HttpApiError(400, 'EMPTY_SPREADSHEET', 'This spreadsheet contains no worksheets to sync.');
  }

  let sheetsToSync: SheetMetadataItem[];
  if (options.syncAllSheets) {
    sheetsToSync = metadata.sheets;
  } else if (options.selectedSheets && options.selectedSheets.length > 0) {
    const requested = new Set(options.selectedSheets.map((s) => s.trim()));
    sheetsToSync = metadata.sheets.filter((s) => requested.has(s.title));
    if (sheetsToSync.length === 0 && metadata.accessMode === 'public-readonly') {
      sheetsToSync = options.selectedSheets.map((title, idx) => ({
        sheetId: idx,
        title: title.trim(),
        index: idx,
        rowCount: 1000,
        columnCount: 26,
      }));
    }
    if (sheetsToSync.length === 0) {
      throw new HttpApiError(
        400,
        'WORKSHEET_NOT_FOUND',
        `None of the requested worksheets (${options.selectedSheets.join(', ')}) exist in "${metadata.spreadsheetTitle}".`
      );
    }
  } else {
    sheetsToSync = [metadata.sheets[0]];
  }

  const existingState = options.driveStore
    ? await options.driveStore.readSheetsState()
    : { datasets: {}, syncHistory: [], updatedAt: new Date().toISOString() };

  const existingDataset = existingState.datasets[metadata.spreadsheetId];
  const existingHashes = new Map<string, string>();
  if (existingDataset) {
    for (const ws of existingDataset.worksheets) {
      for (const [k, hash] of Object.entries(ws.rowHashes || {})) {
        existingHashes.set(`${ws.name}::${k}`, hash);
      }
    }
  }

  const syncedWorksheets: StoredSheetsDataset['worksheets'] = [];
  const incomingForDiff: Array<{ compositeKey: string; rowHash: string }> = [];
  let totalRowsRetrieved = 0;
  let totalSkippedRows = 0;

  for (const sheet of sheetsToSync) {
    const valuesResult = await fetchSheetValues({
      urlOrId: metadata.spreadsheetId,
      sheetTitle: sheet.title,
      customRange: sheetsToSync.length === 1 ? options.customRange : undefined,
      headerRowIndex: options.headerRowIndex,
      config: options.config,
    });

    totalRowsRetrieved += valuesResult.rawRowCount;
    totalSkippedRows += valuesResult.skippedEmptyRows;

    const { rowRecords } = normalizeSheetValues(
      valuesResult.sheetTitle,
      [valuesResult.headers, ...valuesResult.rows.map((r) => valuesResult.headers.map((h) => r[h] ?? ''))],
      { headerRowIndex: 0, rangeUsed: valuesResult.rangeUsed }
    );

    const rowHashes: Record<string, string> = {};
    for (const rec of rowRecords) {
      rowHashes[rec.rowKey] = rec.rowHash;
      incomingForDiff.push({
        compositeKey: `${valuesResult.sheetTitle}::${rec.rowKey}`,
        rowHash: rec.rowHash,
      });
    }

    syncedWorksheets.push({
      name: valuesResult.sheetTitle,
      headers: valuesResult.headers,
      rows: valuesResult.rows,
      headerRowIndex: valuesResult.headerRowIndex,
      rangeUsed: valuesResult.rangeUsed,
      rowHashes,
    });
  }

  const totalValidRows = syncedWorksheets.reduce((acc, ws) => acc + ws.rows.length, 0);
  if (totalValidRows === 0) {
    throw new HttpApiError(
      422,
      'NO_DATA_ROWS_FOUND',
      `Connected to "${metadata.spreadsheetTitle}", but 0 data rows were found in the selected worksheet(s). Check the worksheet tab and header row setting.`
    );
  }

  const diff = computeSyncDiff(existingHashes, incomingForDiff, totalRowsRetrieved, totalSkippedRows);
  const syncedAt = new Date().toISOString();

  const updatedDataset: StoredSheetsDataset = {
    spreadsheetId: metadata.spreadsheetId,
    spreadsheetUrl: metadata.spreadsheetUrl,
    spreadsheetTitle: metadata.spreadsheetTitle,
    lastSyncedAt: syncedAt,
    worksheets: syncedWorksheets,
  };

  let persistedInDrive = false;
  if (options.driveStore) {
    existingState.activeSpreadsheetId = metadata.spreadsheetId;
    existingState.datasets[metadata.spreadsheetId] = updatedDataset;
    existingState.syncHistory.unshift({
      id: `sync_${generateRandomId(8)}`,
      spreadsheetId: metadata.spreadsheetId,
      spreadsheetTitle: metadata.spreadsheetTitle,
      worksheetName: syncedWorksheets.map((w) => w.name).join(', '),
      status: 'success',
      rowsRetrieved: diff.rowsRetrieved,
      validRowsCount: diff.validRowsCount,
      createdCount: diff.createdCount,
      updatedCount: diff.updatedCount,
      unchangedCount: diff.unchangedCount,
      skippedCount: diff.skippedCount,
      syncedAt,
    });
    existingState.syncHistory = existingState.syncHistory.slice(0, 30);
    await options.driveStore.writeSheetsState(existingState);
    persistedInDrive = true;
  }

  return {
    spreadsheetId: metadata.spreadsheetId,
    spreadsheetTitle: metadata.spreadsheetTitle,
    spreadsheetUrl: metadata.spreadsheetUrl,
    accessMode: metadata.accessMode,
    persistedInDrive,
    lastSyncedAt: syncedAt,
    availableSheets: metadata.sheets,
    worksheets: syncedWorksheets.map((w) => ({
      name: w.name,
      headers: w.headers,
      rows: w.rows,
      headerRowIndex: w.headerRowIndex,
      rangeUsed: w.rangeUsed,
    })),
    stats: diff,
  };
}

export async function getPersistedSheetsOverview(driveStore: GoogleDriveStore) {
  const state = await driveStore.readSheetsState();
  const activeDataset = state.activeSpreadsheetId
    ? state.datasets[state.activeSpreadsheetId] || null
    : Object.values(state.datasets)[0] || null;

  return {
    activeSpreadsheet: activeDataset
      ? {
          spreadsheetId: activeDataset.spreadsheetId,
          spreadsheetTitle: activeDataset.spreadsheetTitle,
          spreadsheetUrl: activeDataset.spreadsheetUrl,
          lastSyncedAt: activeDataset.lastSyncedAt,
          worksheets: activeDataset.worksheets.map((w) => ({
            name: w.name,
            headers: w.headers,
            rows: w.rows,
            headerRowIndex: w.headerRowIndex,
            rangeUsed: w.rangeUsed,
          })),
        }
      : null,
    syncHistory: state.syncHistory,
  };
}
