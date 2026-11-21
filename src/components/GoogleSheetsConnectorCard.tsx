/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  FileSpreadsheet,
  Info,
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
  buildSpreadsheetDataFromSync,
  extractGoogleSheetId,
  fetchGoogleSheetWorksheetValues,
  fetchPersistedGoogleSheets,
  GoogleSheetMetadataTab,
  GoogleSheetSyncHistoryItem,
  GoogleSheetSyncResponse,
  syncGoogleSpreadsheet,
  validateGoogleSpreadsheet,
} from '../utils/googleSheets';

interface GoogleSheetsConnectorCardProps {
  spreadsheetData?: SpreadsheetData;
  setSpreadsheetData?: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  diagnostics?: IntegrationDiagnostics | null;
  driveConnection?: DriveWorkspaceConnection | null;
  /**
   * Optional callback used by QuotationGeneratorView (or custom importers) when rows are imported.
   */
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
  diagnostics,
  driveConnection,
  onImportedRows,
  title = 'Google Sheets URL Connector',
  subtitle = 'Paste any Google Sheets URL — no sign-in required. Supports private sheets shared with the service account and publicly viewable sheets.',
  compact = false,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [spreadsheetTitle, setSpreadsheetTitle] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<'service-account' | 'public-readonly' | null>(null);
  const [availableSheets, setAvailableSheets] = useState<GoogleSheetMetadataTab[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [syncAllSheets, setSyncAllSheets] = useState<boolean>(false);
  const [customRange, setCustomRange] = useState<string>('');
  const [headerRowMode, setHeaderRowMode] = useState<'auto' | number>('auto');

  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, any>[]>([]);
  const [lastSyncResult, setLastSyncResult] = useState<GoogleSheetSyncResponse | null>(null);
  const [syncHistory, setSyncHistory] = useState<GoogleSheetSyncHistoryItem[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [permissionEmailHint, setPermissionEmailHint] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const serviceAccountEmail =
    permissionEmailHint ||
    driveConnection?.serviceAccountEmail ||
    diagnostics?.serviceAccountEmail ||
    null;

  useEffect(() => {
    if (!driveConnection?.isConnected) {
      setSyncHistory([]);
      return;
    }
    let active = true;
    fetchPersistedGoogleSheets()
      .then((res) => {
        if (!active) return;
        setSyncHistory(res.syncHistory || []);
        if (res.activeSpreadsheet && !urlInput) {
          setUrlInput(res.activeSpreadsheet.spreadsheetUrl);
          setSpreadsheetId(res.activeSpreadsheet.spreadsheetId);
          setSpreadsheetTitle(res.activeSpreadsheet.spreadsheetTitle);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [driveConnection?.isConnected, driveConnection?.folderId]);

  const handleCopyServiceEmail = async () => {
    if (!serviceAccountEmail) return;
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const handleValidateUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setPermissionEmailHint(null);
    setPreviewHeaders([]);
    setPreviewRows([]);

    const trimmed = urlInput.trim();
    const extracted = extractGoogleSheetId(trimmed);
    if (!extracted) {
      setErrorMsg(
        'Invalid Google Sheets URL or ID. Paste a link like https://docs.google.com/spreadsheets/d/<spreadsheet-id>/edit.'
      );
      return;
    }

    setValidating(true);
    try {
      const meta = await validateGoogleSpreadsheet(trimmed);
      setSpreadsheetId(meta.spreadsheetId);
      setSpreadsheetTitle(meta.spreadsheetTitle);
      setAccessMode(meta.accessMode);
      setAvailableSheets(meta.sheets || []);
      const defaultTab = meta.sheets[0]?.title || '';
      setSelectedSheet(defaultTab);
      setSuccessMsg(
        `Connected to "${meta.spreadsheetTitle}" (${meta.sheets.length} worksheet${
          meta.sheets.length === 1 ? '' : 's'
        } detected).`
      );

      // Immediately preview the first worksheet so user sees real rows
      if (defaultTab) {
        await loadWorksheetPreview(meta.spreadsheetId, defaultTab);
      }
    } catch (err: any) {
      setSpreadsheetId(null);
      setSpreadsheetTitle(null);
      setAvailableSheets([]);
      setErrorMsg(err?.message || 'Unable to connect to this Google Sheet.');
      if (err?.details?.serviceAccountEmail) {
        setPermissionEmailHint(err.details.serviceAccountEmail);
      }
    } finally {
      setValidating(false);
    }
  };

  const loadWorksheetPreview = async (
    targetSpreadsheetId: string,
    sheetTitle: string,
    rangeOverride?: string,
    headerOverride?: 'auto' | number
  ) => {
    setPreviewLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchGoogleSheetWorksheetValues({
        urlOrId: targetSpreadsheetId,
        sheetTitle,
        range: rangeOverride !== undefined ? rangeOverride : customRange || undefined,
        headerRowIndex: headerOverride !== undefined ? headerOverride : headerRowMode,
      });
      setPreviewHeaders(res.headers || []);
      setPreviewRows(res.rows || []);
      if (res.rows.length === 0) {
        setErrorMsg(
          `Worksheet "${sheetTitle}" returned 0 data rows. Check that the tab has data or adjust the header row.`
        );
      }
    } catch (err: any) {
      setPreviewHeaders([]);
      setPreviewRows([]);
      setErrorMsg(err?.message || 'Failed to load worksheet preview.');
      if (err?.details?.serviceAccountEmail) {
        setPermissionEmailHint(err.details.serviceAccountEmail);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImportOrSync = async () => {
    const targetUrl = spreadsheetId || urlInput.trim();
    if (!targetUrl) {
      setErrorMsg('Paste and connect a Google Sheets URL first.');
      return;
    }

    setSyncing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const result = await syncGoogleSpreadsheet({
        urlOrId: targetUrl,
        selectedSheets: syncAllSheets ? undefined : selectedSheet ? [selectedSheet] : undefined,
        syncAllSheets,
        range: syncAllSheets ? undefined : customRange || undefined,
        headerRowIndex: headerRowMode,
      });

      setLastSyncResult(result);
      setSpreadsheetId(result.spreadsheetId);
      setSpreadsheetTitle(result.spreadsheetTitle);
      setAccessMode(result.accessMode);
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
        } from "${result.spreadsheetTitle}"${
          result.persistedInDrive ? ' and saved snapshot to Google Drive.' : '.'
        }`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Google Sheets import failed.');
      if (err?.details?.serviceAccountEmail) {
        setPermissionEmailHint(err.details.serviceAccountEmail);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-slate-200 ${
        compact ? 'p-4 space-y-4' : 'p-6 space-y-5'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {accessMode && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
            {accessMode === 'service-account' ? 'Service Account' : 'Public Read-Only'}
          </span>
        )}
      </div>

      {/* Private Sheet Sharing Instructions */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>Connecting Private vs. Public Google Sheets</span>
        </div>
        {serviceAccountEmail ? (
          <div className="space-y-1.5">
            <p className="text-slate-600">
              For private spreadsheets, click <strong>Share</strong> in Google Sheets and add this
              service account as <strong>Viewer</strong>:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 font-mono text-[11px] text-slate-900 break-all">
                {serviceAccountEmail}
              </code>
              <button
                type="button"
                onClick={handleCopyServiceEmail}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedEmail ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedEmail ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        ) : (
          <p className="text-slate-600 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Publicly viewable sheets (&ldquo;Anyone with the link can view&rdquo;) can be imported
              immediately. Configure{' '}
              <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> on the server to
              connect private spreadsheets.
            </span>
          </p>
        )}
      </div>

      {/* URL Input & Connect */}
      <form onSubmit={handleValidateUrl} className="space-y-2">
        <label className="block text-xs font-semibold text-slate-700">
          Google Sheets URL or Spreadsheet ID
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
            disabled={validating}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            {validating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            <span>Connect Sheet</span>
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
              <span>{lastSyncResult ? 'Refresh & Re-Sync Data' : 'Import Selected Worksheet'}</span>
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
            <span className="text-[11px] text-slate-500">Showing first {Math.min(5, previewRows.length)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {previewHeaders.slice(0, 8).map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
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

      {/* Sync History (when Drive connected) */}
      {!compact && syncHistory.length > 0 && (
        <div className="pt-2 border-t border-slate-100 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Recent Sync History
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {syncHistory.slice(0, 4).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg"
              >
                <span className="truncate font-medium">
                  {item.spreadsheetTitle} ({item.worksheetName})
                </span>
                <span className="font-mono text-slate-500 shrink-0 ml-2">
                  {item.validRowsCount} rows · {new Date(item.syncedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
