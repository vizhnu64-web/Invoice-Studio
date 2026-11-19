/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SpreadsheetData } from '../types';
import { deduplicateHeaders } from './calculator';

export type SyncStatusState =
  | 'Not Connected'
  | 'Connecting Google Account'
  | 'Authorizing'
  | 'Fetching Spreadsheet'
  | 'Reading Sheet Data'
  | 'Processing Records'
  | 'Saving Records'
  | 'Updating Data Table'
  | 'Sync Successful'
  | 'Sync Successful — No Changes'
  | 'Sync Failed';

export type GoogleOAuthFeature = 'signin' | 'drive' | 'sheets' | 'gmail';

export interface GoogleAccountUser {
  userId?: string;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt?: string;
  lastLoginAt?: string;
  onboardingCompleted?: boolean;
  driveConnected?: boolean;
  sheetsConnected?: boolean;
  gmailConnected?: boolean;
  smtpConfigured?: boolean;
  driveRootFolderId?: string | null;
  driveLastSyncAt?: string | null;
  driveSyncStatus?: string | null;
}

export interface IntegrationDiagnostics {
  googleOAuthConfigured: boolean;
  databaseConfigured: boolean;
  encryptionConfigured: boolean;
  sessionConfigured: boolean;
  redirectUri: string;
  missingEnvVars: string[];
  readyForGoogleSync: boolean;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: GoogleAccountUser | null;
  scopes: string[];
  hasRefreshToken?: boolean;
  connectedAt?: string;
  diagnostics: IntegrationDiagnostics;
}

export interface SheetMetadataItem {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface SheetMetadata {
  spreadsheetId: string;
  title: string;
  sheets: SheetMetadataItem[];
}

export interface SyncStats {
  rowsRetrieved: number;
  validRowsCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  deletedCount: number;
}

export interface SyncHistoryItem {
  id: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  status: 'synced' | 'no_changes' | 'failed';
  rowsRetrieved: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface SyncResultPayload {
  status?: 'synced' | 'no_changes';
  lastSyncStatus?: 'synced' | 'no_changes';
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  selectedSheetName: string;
  selectedRange: string;
  headerRowIndex: number;
  sheetsMeta: SheetMetadataItem[];
  worksheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, any>[];
    headerRowIndex?: number;
    rangeUsed?: string;
  }>;
  totalRows: number;
  lastSyncAt: string;
  stats?: SyncStats;
  lastSyncStats?: SyncStats;
}

export interface PersistedSheetsResponse {
  spreadsheet: SyncResultPayload | null;
  history: SyncHistoryItem[];
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode?: 'popup' | 'redirect';
            state?: string;
            select_account?: boolean;
            redirect_uri?: string;
            callback: (response: {
              code?: string;
              scope?: string;
              state?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => {
            requestCode: () => void;
          };
        };
      };
    };
  }
}

export function extractSpreadsheetId(urlOrId: string): string {
  const clean = (urlOrId || '').trim();
  if (!clean) throw new Error('Spreadsheet URL or ID cannot be blank.');

  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }

  if (/^[a-zA-Z0-9-_]{20,100}$/.test(clean)) {
    return clean;
  }

  throw new Error(
    'Invalid Google Sheets URL or ID. Please paste a valid spreadsheet link (e.g. https://docs.google.com/spreadsheets/d/...)'
  );
}

/**
 * Pure value parser kept exported for deterministic parsing & unit tests.
 */
export function parseValuesToSpreadsheetData(
  title: string,
  sheetsMeta: { title: string }[],
  sheetValuesMap: Record<string, any[][]>
): SpreadsheetData {
  const worksheets = sheetsMeta.map((sheet) => {
    const rawValues = sheetValuesMap[sheet.title] || [];
    if (rawValues.length === 0) {
      return { name: sheet.title, headers: [], rows: [] };
    }

    const rawHeaders = (rawValues[0] || []).map((h: any) => String(h || '').trim());
    const validHeaders = rawHeaders.filter(Boolean);
    const headers = deduplicateHeaders(validHeaders);

    if (headers.length === 0 || rawValues.length <= 1) {
      return { name: sheet.title, headers: [], rows: [] };
    }

    const rows: Record<string, any>[] = [];
    for (let r = 1; r < rawValues.length; r++) {
      const rowVals = rawValues[r] || [];
      const rowObj: Record<string, any> = {};
      let hasData = false;

      headers.forEach((header, hIdx) => {
        const originalIdx = rawHeaders.indexOf(header);
        const val = originalIdx >= 0 ? rowVals[originalIdx] : rowVals[hIdx];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          hasData = true;
          rowObj[header] = val;
        } else {
          rowObj[header] = '';
        }
      });

      if (hasData) {
        rows.push(rowObj);
      }
    }

    return {
      name: sheet.title,
      headers,
      rows,
    };
  });

  const activeSheet =
    worksheets.find((w) => w.rows.length > 0)?.name || worksheets[0]?.name || 'Sheet1';

  return {
    fileName: `${title}.gsheet`,
    worksheets,
    activeSheetName: activeSheet,
  };
}

export function syncedPayloadToSpreadsheetData(payload: SyncResultPayload): SpreadsheetData {
  const worksheets = (payload.worksheets || []).map((ws) => ({
    name: ws.name,
    headers: Array.isArray(ws.headers) ? ws.headers : [],
    rows: Array.isArray(ws.rows) ? ws.rows : [],
  }));

  const activeSheetName =
    worksheets.find((w) => w.name === payload.selectedSheetName && w.rows.length > 0)?.name ||
    worksheets.find((w) => w.rows.length > 0)?.name ||
    worksheets[0]?.name ||
    '';

  return {
    fileName: `${payload.title || 'Google Sheet'}.gsheet`,
    worksheets,
    activeSheetName,
  };
}

async function parseJsonApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected server response (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const err: any = new Error(parsed.error || `Request failed with HTTP ${res.status}.`);
    err.code = parsed.code;
    err.requiresReauth = Boolean(parsed.requiresReauth);
    err.status = res.status;
    throw err;
  }
  return parsed as T;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch('/api/auth/status', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  return parseJsonApiResponse<AuthStatusResponse>(res);
}

async function ensureGisScriptLoaded(timeoutMs: number = 6000): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.google?.accounts?.oauth2?.initCodeClient) return true;

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src*="accounts.google.com/gsi/client"]'
  );
  if (!existing) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.google?.accounts?.oauth2?.initCodeClient) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return Boolean(window.google?.accounts?.oauth2?.initCodeClient);
}

export async function connectGoogleFeature(
  feature: GoogleOAuthFeature = 'signin',
  options?: {
    onPhaseChange?: (phase: SyncStatusState) => void;
    preferRedirect?: boolean;
    returnTo?: string;
  }
): Promise<{
  authenticated: boolean;
  user: GoogleAccountUser;
  scopes: string[];
}> {
  options?.onPhaseChange?.('Connecting Google Account');

  const query = new URLSearchParams({ feature });
  if (options?.returnTo) query.set('returnTo', options.returnTo);

  const startRes = await fetch(`/api/auth/google/start?${query.toString()}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  const startData = await parseJsonApiResponse<{
    authUrl: string;
    state: string;
    clientId: string;
    scopes: string[];
  }>(startRes);

  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || startData.clientId || '').trim();
  if (!clientId) {
    throw new Error(
      'Google OAuth Client ID is not configured (VITE_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID).'
    );
  }

  if (options?.preferRedirect) {
    options?.onPhaseChange?.('Authorizing');
    window.location.assign(startData.authUrl);
    return new Promise(() => {});
  }

  const gisLoaded = await ensureGisScriptLoaded();
  if (!gisLoaded || !window.google?.accounts?.oauth2?.initCodeClient) {
    options?.onPhaseChange?.('Authorizing');
    window.location.assign(startData.authUrl);
    return new Promise(() => {});
  }

  options?.onPhaseChange?.('Authorizing');

  return new Promise((resolve, reject) => {
    try {
      const codeClient = window.google!.accounts!.oauth2!.initCodeClient({
        client_id: clientId,
        scope: startData.scopes.join(' '),
        ux_mode: 'popup',
        state: startData.state,
        select_account: feature === 'signin',
        callback: async (response) => {
          if (response.error || !response.code) {
            reject(
              new Error(
                response.error_description ||
                  (response.error === 'access_denied'
                    ? 'Google authorization was cancelled or denied.'
                    : `Google authorization failed (${response.error || 'no_code'}).`)
              )
            );
            return;
          }

          try {
            const exchangeRes = await fetch('/api/auth/google/callback', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: response.code,
                state: response.state || startData.state,
                redirectUri: 'postmessage',
                feature,
              }),
            });

            const exchanged = await parseJsonApiResponse<{
              authenticated: boolean;
              user: GoogleAccountUser;
              scopes: string[];
            }>(exchangeRes);

            resolve(exchanged);
          } catch (err) {
            reject(err);
          }
        },
        error_callback: (err) => {
          const type = err?.type || 'popup_error';
          if (type === 'popup_closed') {
            reject(new Error('Google sign-in popup was closed before completing authorization.'));
          } else if (type === 'popup_failed_to_open') {
            reject(
              new Error(
                'Popup blocked by browser. Allow popups or use Standard Redirect Sign-In.'
              )
            );
          } else {
            reject(new Error(err?.message || 'Google Identity Services authorization failed.'));
          }
        },
      });

      codeClient.requestCode();
    } catch (err) {
      reject(err);
    }
  });
}

export async function connectGoogleAccount(options?: {
  onPhaseChange?: (phase: SyncStatusState) => void;
  preferRedirect?: boolean;
}): Promise<{
  authenticated: boolean;
  user: GoogleAccountUser;
  scopes: string[];
}> {
  return connectGoogleFeature('sheets', options);
}

export async function disconnectGoogleFeature(
  feature: 'all' | 'drive' | 'sheets' | 'gmail' = 'all'
): Promise<{ disconnected: boolean; feature: string; signedOut: boolean }> {
  const res = await fetch('/api/auth/disconnect', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature }),
  });
  return parseJsonApiResponse<{ disconnected: boolean; feature: string; signedOut: boolean }>(res);
}

export async function disconnectGoogleAccount(): Promise<void> {
  await disconnectGoogleFeature('all');
}

export async function validateGoogleSpreadsheet(spreadsheetUrl: string): Promise<SheetMetadata> {
  extractSpreadsheetId(spreadsheetUrl);
  const res = await fetch(
    `/api/sheets/metadata?spreadsheetUrl=${encodeURIComponent(spreadsheetUrl.trim())}`,
    {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    }
  );
  return parseJsonApiResponse<SheetMetadata>(res);
}

export async function syncGoogleSpreadsheet(params: {
  spreadsheetUrl: string;
  sheetName?: string;
  range?: string;
  headerRowIndex?: number | 'auto';
  syncAllSheets?: boolean;
}): Promise<SyncResultPayload> {
  extractSpreadsheetId(params.spreadsheetUrl);
  const res = await fetch('/api/sheets/sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return parseJsonApiResponse<SyncResultPayload>(res);
}

export async function fetchPersistedGoogleSheets(): Promise<PersistedSheetsResponse> {
  const res = await fetch('/api/sheets/data', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  return parseJsonApiResponse<PersistedSheetsResponse>(res);
}
