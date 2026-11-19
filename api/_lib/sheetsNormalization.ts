/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

export interface SheetMetadataItem {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface NormalizedWorksheet {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
  headerRowIndex: number;
  rangeUsed: string;
  rawRowCount: number;
  skippedEmptyRows: number;
}

export interface NormalizedRowRecord {
  rowKey: string;
  rowNumber: number;
  rowHash: string;
  data: Record<string, any>;
}

export interface SyncDiffStats {
  rowsRetrieved: number;
  validRowsCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  deletedCount: number;
}

export function deduplicateHeaders(rawHeaders: any[]): string[] {
  const seen: Record<string, number> = {};
  return (rawHeaders || []).map((h, i) => {
    let name = String(h !== null && h !== undefined ? h : '').trim();
    if (!name) name = `Col_${i + 1}`;
    if (seen[name] !== undefined) {
      seen[name] += 1;
      return `${name} (${seen[name]})`;
    }
    seen[name] = 1;
    return name;
  });
}

export function extractSpreadsheetId(urlOrId: string): string {
  const clean = (urlOrId || '').trim();
  if (!clean) {
    throw new Error('Spreadsheet URL or ID cannot be blank.');
  }

  const urlMatch = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9-_]{20,100}$/.test(clean)) {
    return clean;
  }

  throw new Error(
    'Invalid Google Sheets URL or ID. Paste a valid spreadsheet URL (e.g. https://docs.google.com/spreadsheets/d/<id>/edit) or a valid spreadsheet ID.'
  );
}

/**
 * Validates and builds a safe A1 range string for Google Sheets API v4.
 */
export function buildSheetRange(sheetTitle: string, customRange?: string, fallbackRowEnd: number = 5000): string {
  const escapedTitle = sheetTitle.replace(/'/g, "''");
  const trimmedRange = (customRange || '').trim();

  if (!trimmedRange) {
    return `'${escapedTitle}'!A1:ZZ${Math.max(100, fallbackRowEnd)}`;
  }

  // Strip optional leading SheetName! if user pasted full range and re-apply verified sheet title
  const bangIdx = trimmedRange.indexOf('!');
  const a1Part = bangIdx >= 0 ? trimmedRange.slice(bangIdx + 1).trim() : trimmedRange;

  if (!/^[A-Za-z]{1,3}[0-9]{0,7}(:[A-Za-z]{1,3}[0-9]{0,7})?$/.test(a1Part)) {
    throw new Error(
      `Invalid A1 range "${trimmedRange}". Expected notation like "A1:Z500" or "A:K".`
    );
  }

  return `'${escapedTitle}'!${a1Part}`;
}

export function columnIndexToLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

export function detectHeaderRowIndex(rawValues: any[][]): number {
  if (!Array.isArray(rawValues) || rawValues.length === 0) return 0;

  // Prefer first row within first 10 rows that has at least 2 non-empty cells
  const limit = Math.min(rawValues.length, 10);
  for (let i = 0; i < limit; i++) {
    const row = Array.isArray(rawValues[i]) ? rawValues[i] : [];
    const nonEmptyCount = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').length;
    if (nonEmptyCount >= 2) {
      return i;
    }
  }

  // Fallback to first non-empty row
  for (let i = 0; i < limit; i++) {
    const row = Array.isArray(rawValues[i]) ? rawValues[i] : [];
    const hasAny = row.some((c) => c !== null && c !== undefined && String(c).trim() !== '');
    if (hasAny) return i;
  }

  return 0;
}

/**
 * Normalizes a 2D array of Google Sheet values into clean headers and objects.
 * Preserves formatted strings (e.g. leading zeros "00123", currency/date formatting).
 */
export function normalizeSheetValues(
  sheetTitle: string,
  rawValues: any[][],
  options?: {
    headerRowIndex?: number | 'auto';
    rangeUsed?: string;
  }
): {
  worksheet: NormalizedWorksheet;
  rowRecords: NormalizedRowRecord[];
} {
  const safeValues = Array.isArray(rawValues) ? rawValues : [];
  const rangeUsed = options?.rangeUsed || `'${sheetTitle}'!A1:ZZ5000`;

  if (safeValues.length === 0) {
    return {
      worksheet: {
        name: sheetTitle,
        headers: [],
        rows: [],
        headerRowIndex: 0,
        rangeUsed,
        rawRowCount: 0,
        skippedEmptyRows: 0,
      },
      rowRecords: [],
    };
  }

  const resolvedHeaderIdx =
    options?.headerRowIndex === 'auto' || options?.headerRowIndex === undefined || options.headerRowIndex < 0
      ? detectHeaderRowIndex(safeValues)
      : Math.min(Math.max(0, Math.floor(options.headerRowIndex)), safeValues.length - 1);

  const headerSourceRow = Array.isArray(safeValues[resolvedHeaderIdx]) ? safeValues[resolvedHeaderIdx] : [];
  const maxWidth = Math.max(
    headerSourceRow.length,
    ...safeValues.slice(resolvedHeaderIdx + 1, resolvedHeaderIdx + 200).map((r) => (Array.isArray(r) ? r.length : 0))
  );

  // Build aligned column slots so trailing empty columns stay ignored unless populated
  const rawHeaderCells: string[] = [];
  const activeColumnIndices: number[] = [];

  for (let c = 0; c < maxWidth; c++) {
    const rawCell = headerSourceRow[c];
    const headerLabel = rawCell !== undefined && rawCell !== null ? String(rawCell).trim() : '';
    const columnHasData = safeValues
      .slice(resolvedHeaderIdx + 1)
      .some((r) => Array.isArray(r) && r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== '');

    if (headerLabel || columnHasData) {
      rawHeaderCells.push(headerLabel || `Column_${columnIndexToLetter(c)}`);
      activeColumnIndices.push(c);
    }
  }

  const headers = deduplicateHeaders(rawHeaderCells);

  if (headers.length === 0) {
    return {
      worksheet: {
        name: sheetTitle,
        headers: [],
        rows: [],
        headerRowIndex: resolvedHeaderIdx,
        rangeUsed,
        rawRowCount: safeValues.length,
        skippedEmptyRows: safeValues.length,
      },
      rowRecords: [],
    };
  }

  const rows: Record<string, any>[] = [];
  const rowRecords: NormalizedRowRecord[] = [];
  let skippedEmptyRows = 0;
  const seenRowIdentities: Record<string, number> = {};

  for (let r = resolvedHeaderIdx + 1; r < safeValues.length; r++) {
    const rowVals = Array.isArray(safeValues[r]) ? safeValues[r] : [];
    const rowObj: Record<string, any> = {};
    let hasData = false;

    for (let idx = 0; idx < headers.length; idx++) {
      const colIdx = activeColumnIndices[idx];
      const header = headers[idx];
      const cell = rowVals[colIdx];
      if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
        hasData = true;
        // Preserve string format (leading zeros, invoice IDs) cleanly while trimming outer newlines
        rowObj[header] = typeof cell === 'string' ? cell.trim() : cell;
      } else {
        rowObj[header] = '';
      }
    }

    if (!hasData) {
      skippedEmptyRows += 1;
      continue;
    }

    const rowNumber = r + 1; // 1-indexed spreadsheet row number
    const baseIdentity = deriveRowIdentity(rowObj, rowNumber);
    seenRowIdentities[baseIdentity] = (seenRowIdentities[baseIdentity] || 0) + 1;
    const uniqueRowKey =
      seenRowIdentities[baseIdentity] > 1
        ? `${baseIdentity}#${seenRowIdentities[baseIdentity]}`
        : baseIdentity;

    const rowHash = computeCanonicalHash(rowObj);
    rows.push(rowObj);
    rowRecords.push({
      rowKey: uniqueRowKey,
      rowNumber,
      rowHash,
      data: rowObj,
    });
  }

  return {
    worksheet: {
      name: sheetTitle,
      headers,
      rows,
      headerRowIndex: resolvedHeaderIdx,
      rangeUsed,
      rawRowCount: safeValues.length,
      skippedEmptyRows,
    },
    rowRecords,
  };
}

function deriveRowIdentity(rowObj: Record<string, any>, rowNumber: number): string {
  const keys = Object.keys(rowObj);
  const idKey = keys.find((k) => /^(invoice[_\s-]*(no|num|number|id)|inv[_\s-]*no|record[_\s-]*id|id)$/i.test(k.trim()));
  if (idKey && String(rowObj[idKey] || '').trim()) {
    return `id:${String(rowObj[idKey]).trim()}`;
  }
  return `row:${rowNumber}`;
}

export function computeCanonicalHash(obj: Record<string, any>): string {
  const sortedKeys = Object.keys(obj).sort();
  const canonical: Record<string, any> = {};
  for (const key of sortedKeys) {
    canonical[key] = obj[key];
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function computeSyncDiff(
  existingHashes: Map<string, string>,
  incomingRecords: Array<{ compositeKey: string; rowHash: string }>,
  rowsRetrieved: number,
  skippedCount: number
): SyncDiffStats {
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const incomingKeys = new Set<string>();

  for (const rec of incomingRecords) {
    incomingKeys.add(rec.compositeKey);
    const prevHash = existingHashes.get(rec.compositeKey);
    if (!prevHash) {
      createdCount += 1;
    } else if (prevHash !== rec.rowHash) {
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }

  let deletedCount = 0;
  for (const prevKey of existingHashes.keys()) {
    if (!incomingKeys.has(prevKey)) {
      deletedCount += 1;
    }
  }

  return {
    rowsRetrieved,
    validRowsCount: incomingRecords.length,
    createdCount,
    updatedCount,
    unchangedCount,
    skippedCount,
    deletedCount,
  };
}
