/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Eye,
  FileSpreadsheet,
  FolderSearch,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import {
  DriveWorkspaceConnection,
  IntegrationDiagnostics,
  SpreadsheetData,
} from '../types';
import {
  fetchGoogleClientConfig,
  getAccessToken,
  getCachedGoogleClientConfig,
  getGoogleSession,
  requestSheetsConsent,
  subscribeGoogleSession,
} from '../utils/googleAuthClient';
import { openGoogleSpreadsheetPicker } from '../utils/googlePicker';
import {
  buildSpreadsheetDataFromSync,
  extractGoogleSheetId,
  fetchGoogleSheetWorksheetValues,
  GoogleSheetMetadataTab,
  GoogleSheetSyncResponse,
  syncGoogleSpreadsheet,
  validateGoogleSpreadsheet,
} from '../utils/googleSheets';
import { storage } from '../utils/storage';

interface GoogleSheetsConnectorCardProps {
  spreadsheetData?: SpreadsheetData;
  setSpreadsheetData?: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  diagnostics?: IntegrationDiagnostics | null;
  driveConnection?: DriveWorkspaceConnection | null;
  onImportedRows?: (payload: {
    spreadsheetTitle: string;
    worksheetName: string;
    headers: string[];
    rows: Record<string, any>[];
  }) => void;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

export const GoogleSheetsConnectorCard: React.FC<GoogleSheetsConnectorCardProps> = ({
  setSpreadsheetData,
  driveConnection,
  onImportedRows,
  title = 'Import from Google Sheets',
  subtitle = 'Uses your connected Google account via our stateless backend Sheets API. Pick a spreadsheet with Google Picker or paste its URL, preview rows, and import.',
  compact = false,
}) => {
  const [oauthConfigured, setOauthConfigured] = useState<boolean>(
    () => getCachedGoogleClientConfig().configured
  );
  const [urlInput, setUrlInput] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [pickingFile, setPickingFile] = useState(false);
  const [validating, setValidating] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [hasSheetsPermission, setHasSheetsPermission] = useState<boolean>(() => {
    const session = getGoogleSession();
    return Boolean(getAccessToken() && session?.permissions.sheetsGranted);
  });

  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [spreadsheetTitle, setSpreadsheetTitle] = useState<string | null>(null);
  const [availableSheets, setAvailableSheets] = useState<GoogleSheetMetadataTab[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [syncAllSheets, setSyncAllSheets] = useState<boolean>(false);
  const [customRange, setCustomRange] = useState<string>('');
  const [headerRowMode, setHeaderRowMode] = useState<'auto' | number>('auto');

  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, any>[]>([]);
  const [lastSyncResult, setLastSyncResult] = useState<GoogleSheetSyncResponse | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchGoogleClientConfig()
      .then((cfg) => setOauthConfigured(cfg.configured))
      .catch(() => {});

    const unsub = subscribeGoogleSession((snap) => {
      setHasSheetsPermission(Boolean(snap.hasActiveToken && snap.session?.permissions.sheetsGranted));
    });
    return unsub;
  }, []);

  const ensureSheetsAuthorization = async (): Promise<string> => {
    const existingToken = getAccessToken();
    const existingSession = getGoogleSession();
    if (existingToken && existingSession?.permissions.sheetsGranted) {
      setHasSheetsPermission(true);
      return existingToken;
    }

    setAuthorizing(true);
    setErrorMsg(null);
    try {
      const { accessToken, session } = await requestSheetsConsent(
        existingSession?.email || driveConnection?.accountEmail
      );
      setHasSheetsPermission(session.permissions.sheetsGranted);
      if (!session.permissions.sheetsGranted) {
        throw new Error(
          'Google Sheets permission was not approved. Allow Sheets access to import spreadsheets.'
        );
      }
      return accessToken;
    } finally {
      setAuthorizing(false);
    }
  };

  const inspectSpreadsheetByUrlOrId = async (targetUrlOrId: string, tokenOverride?: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setPreviewHeaders([]);
    setPreviewRows([]);

    const extracted = extractGoogleSheetId(targetUrlOrId);
    if (!extracted) {
      setErrorMsg(
        'Invalid Google Sheets URL or ID. Select a spreadsheet with Google Picker or paste a valid link like https://docs.google.com/spreadsheets/d/<id>/edit.'
      );
      return;
    }

    setValidating(true);
    try {
      const token = tokenOverride || (await ensureSheetsAuthorization());
      const meta = await validateGoogleSpreadsheet(extracted, { accessToken: token });
      setSpreadsheetId(meta.spreadsheetId);
      setSpreadsheetTitle(meta.spreadsheetTitle);
      setAvailableSheets(meta.sheets);
      const defaultTab = meta.sheets[0]?.title || '';
      setSelectedSheet(defaultTab);

      const session = getGoogleSession();
      if (session?.sub) {
        storage.saveUserWorkspaceMetadata(session.sub, {
          lastSpreadsheetId: meta.spreadsheetId,
          lastSpreadsheetTitle: meta.spreadsheetTitle,
        });
      }

      if (defaultTab) {
        await loadWorksheetPreview(
          meta.spreadsheetId,
          defaultTab,
          undefined,
          undefined,
          token,
          meta.spreadsheetTitle
        );
      }
    } catch (err: any) {
      setSpreadsheetId(null);
      setSpreadsheetTitle(null);
      setAvailableSheets([]);
      if (err?.code === 'GOOGLE_TOKEN_EXPIRED' || err?.code === 'SHEETS_PERMISSION_MISSING') {
        setHasSheetsPermission(false);
      }
      setErrorMsg(err?.message || 'Unable to access this Google Spreadsheet.');
    } finally {
      setValidating(false);
    }
  };

  const handleAuthorizeOnly = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await ensureSheetsAuthorization();
      setSuccessMsg(
        'Google Sheets permission verified. Pick a spreadsheet via Google Picker or paste a spreadsheet URL.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Google Sheets authorization was cancelled or denied.');
    }
  };

  const handlePickSpreadsheet = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setPickingFile(true);
    try {
      const token = await ensureSheetsAuthorization();
      const picked = await openGoogleSpreadsheetPicker(token);
      if (!picked) return;
      setUrlInput(picked.url);
      await inspectSpreadsheetByUrlOrId(picked.id, token);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to open Google Spreadsheet Picker.');
    } finally {
      setPickingFile(false);
    }
  };

  const handleConnectUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await inspectSpreadsheetByUrlOrId(urlInput.trim());
  };

  const loadWorksheetPreview = async (
    targetSpreadsheetId: string,
    sheetTitle: string,
    rangeOverride?: string,
    headerOverride?: 'auto' | number,
    tokenOverride?: string,
    titleOverride?: string
  ) => {
    setPreviewLoading(true);
    setErrorMsg(null);
    try {
      const token = tokenOverride || (await ensureSheetsAuthorization());
      const res = await fetchGoogleSheetWorksheetValues({
        urlOrId: targetSpreadsheetId,
        sheetTitle,
        range: rangeOverride !== undefined ? rangeOverride : customRange || undefined,
        headerRowIndex: headerOverride !== undefined ? headerOverride : headerRowMode,
        spreadsheetTitle: titleOverride || spreadsheetTitle || undefined,
        accessToken: token,
      });
      setPreviewHeaders(res.headers || []);
      setPreviewRows(res.rows || []);
      if (res.rows.length === 0) {
        setSuccessMsg(null);
        setErrorMsg(
          `Worksheet "${sheetTitle}" returned 0 data rows. Check the selected tab or adjust the header row setting.`
        );
      } else {
        setSuccessMsg(
          `Loaded ${res.rows.length} row${res.rows.length === 1 ? '' : 's'} from "${sheetTitle}". Review the preview below and click Import Selected Worksheet.`
        );
      }
    } catch (err: any) {
      setPreviewHeaders([]);
      setPreviewRows([]);
      setSuccessMsg(null);
      if (err?.code === 'GOOGLE_TOKEN_EXPIRED' || err?.code === 'SHEETS_PERMISSION_MISSING') {
        setHasSheetsPermission(false);
      }
      setErrorMsg(err?.message || 'Failed to load worksheet rows from Google Sheets.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImportOrSync = async () => {
    const targetUrl = spreadsheetId || urlInput.trim();
    if (!targetUrl) {
      setErrorMsg('Select a Google Spreadsheet or paste a spreadsheet URL first.');
      return;
    }

    setSyncing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const token = await ensureSheetsAuthorization();
      const result = await syncGoogleSpreadsheet({
        urlOrId: targetUrl,
        selectedSheets: syncAllSheets ? undefined : selectedSheet ? [selectedSheet] : undefined,
        syncAllSheets,
        range: syncAllSheets ? undefined : customRange || undefined,
        headerRowIndex: headerRowMode,
        accessToken: token,
      });

      setLastSyncResult(result);
      setSpreadsheetId(result.spreadsheetId);
      setSpreadsheetTitle(result.spreadsheetTitle);
      setAvailableSheets(result.availableSheets || []);

      if (setSpreadsheetData) {
        const nextData = buildSpreadsheetDataFromSync(result);
        setSpreadsheetData(nextData);
      }

      const activeWs =
        result.worksheets.find((w) => w.name === selectedSheet) || result.worksheets[0];
      if (activeWs) {
        setPreviewHeaders(activeWs.headers);
        setPreviewRows(activeWs.rows);
        if (onImportedRows) {
          onImportedRows({
            spreadsheetTitle: result.spreadsheetTitle,
            worksheetName: activeWs.name,
            headers: activeWs.headers,
            rows: activeWs.rows,
          });
        }
      }

      setSuccessMsg(
        `Imported ${result.stats.validRowsCount} real row${
          result.stats.validRowsCount === 1 ? '' : 's'
        } from "${result.spreadsheetTitle}".`
      );
    } catch (err: any) {
      if (err?.code === 'GOOGLE_TOKEN_EXPIRED' || err?.code === 'SHEETS_PERMISSION_MISSING') {
        setHasSheetsPermission(false);
      }
      setErrorMsg(err?.message || 'Google Sheets import failed.');
    } finally {
      setSyncing(false);
    }
  };

  const connectedEmail = getGoogleSession()?.email || driveConnection?.accountEmail || '';

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-slate-200 ${
        compact ? 'p-4 space-y-4' : 'p-6 space-y-5'
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <span
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border shrink-0 ${
            hasSheetsPermission
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-amber-50 text-amber-800 border-amber-200'
          }`}
        >
          {hasSheetsPermission ? 'Sheets Permission Granted' : 'Sheets Permission Missing'}
        </span>
      </div>

      {/* OAuth & Google Picker Controls */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>Google Account Sheets Permission</span>
        </div>
        <p className="text-slate-600 leading-relaxed">
          {connectedEmail ? (
            <>
              Using your verified Google account{' '}
              <strong className="text-slate-900">{connectedEmail}</strong>. Private and shared
              spreadsheets accessible to your account are read securely through{' '}
              <code className="font-mono text-[11px]">/api/sheets/*</code>.
            </>
          ) : (
            <>
              Connect your Google account and grant Google Sheets permission to pick and import
              spreadsheets directly without sharing files with any third-party service account.
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={authorizing || pickingFile || !oauthConfigured}
            onClick={handlePickSpreadsheet}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            {pickingFile ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderSearch className="w-3.5 h-3.5" />
            )}
            <span>Select Spreadsheet (Google Picker)</span>
          </button>

          {!hasSheetsPermission && (
            <button
              type="button"
              disabled={authorizing || !oauthConfigured}
              onClick={handleAuthorizeOnly}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-60 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {authorizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              )}
              <span>Grant Sheets Permission</span>
            </button>
          )}
        </div>

        {!oauthConfigured && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            Configure <code className="font-mono break-all">VITE_GOOGLE_CLIENT_ID</code>,{' '}
            <code className="font-mono break-all">VITE_GOOGLE_API_KEY</code>, and{' '}
            <code className="font-mono break-all">VITE_GOOGLE_APP_ID</code> to enable Google Sheets
            OAuth and Google Picker. Excel and CSV uploads continue to work locally.
          </p>
        )}
      </div>

      {/* Direct Spreadsheet URL Input */}
      <form onSubmit={handleConnectUrlSubmit} className="space-y-2">
        <label className="block text-xs font-semibold text-slate-700">
          Or Paste a Google Sheets URL / ID (Requires Your Account Access)
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5.../edit"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={validating || authorizing}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            {validating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            <span>Load Worksheets</span>
          </button>
        </div>
      </form>

      {/* Worksheet Selector & Range Controls */}
      {availableSheets.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-slate-900">{spreadsheetTitle}</p>
              <p className="text-[11px] text-slate-500 font-mono">ID: {spreadsheetId}</p>
            </div>
            {availableSheets.length > 1 && (
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncAllSheets}
                  onChange={(e) => setSyncAllSheets(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <span>Import all {availableSheets.length} tabs</span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Worksheet Tab
              </label>
              <select
                value={selectedSheet}
                disabled={syncAllSheets}
                onChange={(e) => {
                  const tab = e.target.value;
                  setSelectedSheet(tab);
                  if (spreadsheetId && tab) {
                    void loadWorksheetPreview(spreadsheetId, tab);
                  }
                }}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium disabled:opacity-50"
              >
                {availableSheets.map((s) => (
                  <option key={`${s.sheetId}_${s.title}`} value={s.title}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Header Row
              </label>
              <select
                value={headerRowMode === 'auto' ? 'auto' : String(headerRowMode)}
                onChange={(e) => {
                  const val = e.target.value === 'auto' ? 'auto' : Number(e.target.value);
                  setHeaderRowMode(val);
                  if (spreadsheetId && selectedSheet) {
                    void loadWorksheetPreview(spreadsheetId, selectedSheet, customRange, val);
                  }
                }}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium"
              >
                <option value="auto">Auto-Detect Header</option>
                <option value="0">Row 1</option>
                <option value="1">Row 2</option>
                <option value="2">Row 3</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Custom Range (Optional)
              </label>
              <input
                type="text"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                placeholder="e.g. A1:M500"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={syncing}
              onClick={handleImportOrSync}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>{lastSyncResult ? 'Refresh & Re-Import Rows' : 'Import Selected Worksheet'}</span>
            </button>

            <button
              type="button"
              disabled={previewLoading || !spreadsheetId || !selectedSheet}
              onClick={() =>
                spreadsheetId &&
                selectedSheet &&
                loadWorksheetPreview(spreadsheetId, selectedSheet)
              }
              className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {previewLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span>Preview Rows</span>
            </button>
          </div>
        </div>
      )}

      {/* Real Data Preview */}
      {previewHeaders.length > 0 && previewRows.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <Table2 className="w-3.5 h-3.5 text-indigo-600" />
              Preview ({previewRows.length} rows, {previewHeaders.length} columns)
            </span>
            <span className="text-[11px] text-slate-500">
              Showing first {Math.min(5, previewRows.length)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {previewHeaders.slice(0, 8).map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.slice(0, 5).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    {previewHeaders.slice(0, 8).map((h) => (
                      <td
                        key={h}
                        className="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[160px] truncate font-mono"
                      >
                        {String(row[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status Messages */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}
    </div>
  );
};
