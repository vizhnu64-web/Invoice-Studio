/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Globe,
  Link2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Table,
  User,
} from 'lucide-react';
import { SpreadsheetData } from '../types';
import {
  AuthStatusResponse,
  connectGoogleAccount,
  disconnectGoogleAccount,
  extractSpreadsheetId,
  fetchAuthStatus,
  fetchPersistedGoogleSheets,
  IntegrationDiagnostics,
  SheetMetadata,
  syncGoogleSpreadsheet,
  syncedPayloadToSpreadsheetData,
  SyncHistoryItem,
  SyncStats,
  SyncStatusState,
  validateGoogleSpreadsheet,
} from '../utils/googleSheets';

interface GoogleSheetsConnectorCardProps {
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  onSheetImported?: (selectedSheetName: string) => void;
  compact?: boolean;
}

export const GoogleSheetsConnectorCard: React.FC<GoogleSheetsConnectorCardProps> = ({
  spreadsheetData,
  setSpreadsheetData,
  onSheetImported,
  compact = false,
}) => {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<IntegrationDiagnostics | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [metadata, setMetadata] = useState<SheetMetadata | null>(null);
  const [selectedSheetName, setSelectedSheetName] = useState('');
  const [syncAllSheets, setSyncAllSheets] = useState(false);
  const [rangeMode, setRangeMode] = useState<'auto' | 'custom'>('auto');
  const [customRange, setCustomRange] = useState('A1:Z1000');
  const [headerRowOption, setHeaderRowOption] = useState<'auto' | number>('auto');

  const [syncStatus, setSyncStatus] = useState<SyncStatusState>('Not Connected');
  const [statusDetail, setStatusDetail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [requiresReauth, setRequiresReauth] = useState(false);

  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<SyncStats | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[]>([]);

  const loadSessionAndPersistedData = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const status = await fetchAuthStatus();
      setAuthStatus(status);
      setDiagnostics(status.diagnostics);

      if (status.authenticated) {
        setSyncStatus((prev) => (prev === 'Not Connected' ? 'Sync Successful' : prev));
        const persisted = await fetchPersistedGoogleSheets().catch(() => null);
        if (persisted?.spreadsheet) {
          const sp = persisted.spreadsheet;
          setSpreadsheetUrl(sp.spreadsheetUrl || sp.spreadsheetId);
          setMetadata({
            spreadsheetId: sp.spreadsheetId,
            title: sp.title,
            sheets: sp.sheetsMeta || [],
          });
          setSelectedSheetName(sp.selectedSheetName || sp.sheetsMeta?.[0]?.title || '');
          setLastSyncAt(sp.lastSyncAt);
          setLastStats(sp.lastSyncStats || sp.stats || null);
          const resolvedStatus = sp.lastSyncStatus || sp.status;
          setSyncStatus(
            resolvedStatus === 'no_changes'
              ? 'Sync Successful — No Changes'
              : 'Sync Successful'
          );
          if (sp.selectedRange) {
            setRangeMode('custom');
            setCustomRange(sp.selectedRange);
          }
          if (typeof sp.headerRowIndex === 'number') {
            setHeaderRowOption(sp.headerRowIndex);
          }
        }
        if (persisted?.history) {
          setSyncHistory(persisted.history);
        }
      } else {
        setSyncStatus('Not Connected');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unable to verify Google connection status.');
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    void loadSessionAndPersistedData();
  }, [loadSessionAndPersistedData]);

  // Handle redirect callback feedback from URL if redirect fallback was used
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get('google_auth');
    if (!authResult) return;

    const msg = params.get('message');
    if (authResult === 'success') {
      setSuccessMessage('Google Account connected securely.');
      void loadSessionAndPersistedData();
    } else if (authResult === 'error') {
      setErrorMessage(msg || 'Google authentication failed.');
      setSyncStatus('Sync Failed');
    }

    params.delete('google_auth');
    params.delete('message');
    const newSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', cleanUrl);
  }, [loadSessionAndPersistedData]);

  const handleConnect = async (preferRedirect: boolean = false) => {
    setErrorMessage('');
    setSuccessMessage('');
    setRequiresReauth(false);
    setIsConnecting(true);

    try {
      const result = await connectGoogleAccount({
        preferRedirect,
        onPhaseChange: (phase) => {
          setSyncStatus(phase);
          setStatusDetail(
            phase === 'Connecting Google Account'
              ? 'Preparing secure OAuth 2.0 session...'
              : 'Waiting for Google authorization...'
          );
        },
      });

      await loadSessionAndPersistedData();
      setSyncStatus('Authorizing');
      setStatusDetail(`Connected as ${result.user.email}`);
      setSuccessMessage(`Connected Google Account: ${result.user.email}`);
      setSyncStatus('Sync Successful — No Changes');
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      setSyncStatus('Sync Failed');
      setErrorMessage(err?.message || 'Google sign-in failed.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await disconnectGoogleAccount();
      setAuthStatus((prev) =>
        prev ? { ...prev, authenticated: false, user: null, scopes: [] } : null
      );
      setMetadata(null);
      setSyncStatus('Not Connected');
      setStatusDetail('');
      setRequiresReauth(false);
      setSuccessMessage(
        'Google Account disconnected and OAuth credentials revoked. Imported invoice records remain preserved.'
      );
      setTimeout(() => setSuccessMessage(''), 4500);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to disconnect Google account.');
    }
  };

  const handleValidateSpreadsheet = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setRequiresReauth(false);

    try {
      extractSpreadsheetId(spreadsheetUrl);
    } catch (err: any) {
      setErrorMessage(err.message);
      setSyncStatus('Sync Failed');
      return;
    }

    setIsValidating(true);
    setSyncStatus('Fetching Spreadsheet');
    setStatusDetail('Validating spreadsheet access and loading worksheet tabs...');

    try {
      const meta = await validateGoogleSpreadsheet(spreadsheetUrl);
      setMetadata(meta);
      const firstSheet = meta.sheets[0]?.title || '';
      setSelectedSheetName((prev) =>
        meta.sheets.some((s) => s.title === prev) ? prev : firstSheet
      );
      setSyncStatus('Sync Successful — No Changes');
      setStatusDetail(`Verified "${meta.title}" (${meta.sheets.length} tab(s)). Ready to import.`);
      setSuccessMessage(`Spreadsheet validated: "${meta.title}"`);
      setTimeout(() => setSuccessMessage(''), 3500);
    } catch (err: any) {
      setSyncStatus('Sync Failed');
      setRequiresReauth(Boolean(err?.requiresReauth));
      setErrorMessage(err?.message || 'Unable to access Google Spreadsheet.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSync = async (isInitialImport: boolean) => {
    setErrorMessage('');
    setSuccessMessage('');
    setRequiresReauth(false);

    try {
      extractSpreadsheetId(spreadsheetUrl);
    } catch (err: any) {
      setErrorMessage(err.message);
      setSyncStatus('Sync Failed');
      return;
    }

    try {
      setSyncStatus('Fetching Spreadsheet');
      setStatusDetail('Connecting to Google Sheets API v4...');

      const rangeToSend = rangeMode === 'custom' && customRange.trim() ? customRange.trim() : undefined;

      setSyncStatus('Reading Sheet Data');
      setStatusDetail(
        syncAllSheets
          ? 'Reading worksheet tabs from Google Sheets...'
          : `Reading "${selectedSheetName || 'first sheet'}"...`
      );

      const syncPayload = await syncGoogleSpreadsheet({
        spreadsheetUrl: spreadsheetUrl.trim(),
        sheetName: selectedSheetName || undefined,
        range: rangeToSend,
        headerRowIndex: headerRowOption,
        syncAllSheets,
      });

      setSyncStatus('Processing Records');
      setStatusDetail(`Normalizing ${syncPayload.totalRows} row(s)...`);

      if (!syncPayload.worksheets || syncPayload.totalRows === 0) {
        setSyncStatus('Sync Failed');
        setErrorMessage('Google Sheet returned 0 usable records. Data table was not modified.');
        return;
      }

      setSyncStatus('Saving Records');
      setStatusDetail('Persisting synced records and updating invoice workspace...');

      const nextSpreadsheetData = syncedPayloadToSpreadsheetData(syncPayload);

      setSyncStatus('Updating Data Table');
      setSpreadsheetData(nextSpreadsheetData);
      if (onSheetImported) {
        onSheetImported(nextSpreadsheetData.activeSheetName);
      }

      setMetadata({
        spreadsheetId: syncPayload.spreadsheetId,
        title: syncPayload.title,
        sheets: syncPayload.sheetsMeta || [],
      });
      setSelectedSheetName(syncPayload.selectedSheetName || nextSpreadsheetData.activeSheetName);
      setLastSyncAt(syncPayload.lastSyncAt);
      setLastStats(syncPayload.stats || syncPayload.lastSyncStats || null);

      const persisted = await fetchPersistedGoogleSheets().catch(() => null);
      if (persisted?.history) {
        setSyncHistory(persisted.history);
      }

      if (syncPayload.status === 'no_changes') {
        setSyncStatus('Sync Successful — No Changes');
        setStatusDetail(
          `Verified ${syncPayload.totalRows} rows from "${syncPayload.title}" — no new changes detected.`
        );
        setSuccessMessage(
          `Sync verified (${syncPayload.totalRows} rows unchanged in "${syncPayload.title}").`
        );
      } else {
        setSyncStatus('Sync Successful');
        setStatusDetail(
          `${isInitialImport ? 'Imported' : 'Synced'} ${syncPayload.totalRows} rows from "${syncPayload.title}".`
        );
        setSuccessMessage(
          `${isInitialImport ? 'Imported' : 'Synced'} ${syncPayload.totalRows} records from "${syncPayload.title}"!`
        );
      }
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err: any) {
      setSyncStatus('Sync Failed');
      setRequiresReauth(Boolean(err?.requiresReauth));
      setErrorMessage(
        err?.message || 'Google Sheets sync failed. Existing data table records were preserved.'
      );
    }
  };

  const getBadgeStyle = (state: SyncStatusState) => {
    switch (state) {
      case 'Sync Successful':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Sync Successful — No Changes':
        return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      case 'Sync Failed':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Not Connected':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      default:
        return 'bg-amber-50 text-amber-700 border-amber-200';
    }
  };

  const isBusy =
    isConnecting ||
    isValidating ||
    syncStatus === 'Connecting Google Account' ||
    syncStatus === 'Authorizing' ||
    syncStatus === 'Fetching Spreadsheet' ||
    syncStatus === 'Reading Sheet Data' ||
    syncStatus === 'Processing Records' ||
    syncStatus === 'Saving Records' ||
    syncStatus === 'Updating Data Table';

  const isGoogleConnected = Boolean(authStatus?.authenticated && authStatus?.user);
  const currentRowCount = spreadsheetData.worksheets.reduce((acc, ws) => acc + ws.rows.length, 0);

  return (
    <div className={`bg-white ${compact ? 'p-5' : 'p-6'} rounded-2xl shadow-sm border border-slate-200 space-y-5`}>
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center font-bold">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Google Sheets Sync</h2>
            <p className="text-xs text-slate-500">
              OAuth 2.0 Authorization-Code Flow & Persistent Backend Synchronization
            </p>
          </div>
        </div>

        <div
          data-testid="google-sync-status-badge"
          className={`px-3 py-1 rounded-full text-xs font-bold border inline-flex items-center space-x-1.5 ${getBadgeStyle(
            syncStatus
          )}`}
        >
          <span className={`w-2 h-2 rounded-full bg-current ${isBusy ? 'animate-ping' : ''}`} />
          <span>{syncStatus}</span>
        </div>
      </div>

      {/* Server Environment Diagnostics Warning (only when server env vars are missing) */}
      {diagnostics && !diagnostics.readyForGoogleSync && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-1">
          <p className="font-bold flex items-center space-x-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>Backend Google Sheets environment setup incomplete</span>
          </p>
          <p className="text-amber-800 leading-relaxed">
            Missing server environment variable(s):{' '}
            <span className="font-mono font-semibold">{diagnostics.missingEnvVars.join(', ')}</span>.
            Configure these in Vercel Project Settings (or local <span className="font-mono">.env</span>) to enable live Google OAuth and Google Drive storage.
          </p>
        </div>
      )}

      {/* Alerts */}
      {successMessage && (
        <div className="flex items-start space-x-2 bg-emerald-50 text-emerald-800 px-3.5 py-2.5 rounded-xl border border-emerald-200 text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-50 text-rose-800 px-3.5 py-2.5 rounded-xl border border-rose-200 text-xs space-y-2">
          <div className="flex items-start space-x-2 font-semibold">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
          {requiresReauth && (
            <button
              type="button"
              onClick={() => handleConnect(false)}
              className="inline-flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconnect Google Account</span>
            </button>
          )}
        </div>
      )}

      {/* Connection Area */}
      {isLoadingAuth ? (
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center space-x-2 text-xs text-slate-600">
          <RefreshCw className="w-4 h-4 animate-spin text-cyan-600" />
          <span>Checking Google session status...</span>
        </div>
      ) : !isGoogleConnected ? (
        <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-800">
              Connect your Google Account
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Authorize read-only access to your Google Spreadsheets (<span className="font-mono">spreadsheets.readonly</span>). Credentials are exchanged securely on the server and encrypted at rest.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleConnect(false)}
              disabled={isConnecting}
              className="flex-1 min-w-[200px] inline-flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              {isConnecting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Globe className="w-4 h-4 text-cyan-400" />
              )}
              <span>{isConnecting ? 'Authorizing...' : 'Connect Google Account'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleConnect(true)}
              disabled={isConnecting}
              title="Use full-page Google OAuth redirect if popups are blocked"
              className="inline-flex items-center space-x-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Redirect Sign-In</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Connected Account Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 text-emerald-950 p-3.5 rounded-xl border border-emerald-200">
            <div className="flex items-center space-x-3">
              {authStatus?.user?.picture ? (
                <img
                  src={authStatus.user.picture}
                  alt={authStatus.user.name || authStatus.user.email}
                  className="w-8 h-8 rounded-full border border-emerald-300 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                  {authStatus?.user?.email ? authStatus.user.email[0].toUpperCase() : <User className="w-4 h-4" />}
                </div>
              )}
              <div>
                <p className="text-xs font-bold flex items-center space-x-1.5">
                  <span>{authStatus?.user?.name || 'Connected Google Account'}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                </p>
                <p className="text-[11px] text-emerald-800 font-mono">{authStatus?.user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isBusy}
              className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-xs font-bold hover:bg-emerald-100 transition-colors cursor-pointer inline-flex items-center space-x-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Disconnect Google Account</span>
            </button>
          </div>

          {/* Step 1: Spreadsheet URL & Validation */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              Google Spreadsheet URL or Spreadsheet ID
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={spreadsheetUrl}
                  onChange={(e) => setSpreadsheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                  className="w-full border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-cyan-600"
                />
              </div>
              <button
                type="button"
                onClick={handleValidateSpreadsheet}
                disabled={isBusy || !spreadsheetUrl.trim()}
                className="inline-flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                {isValidating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Table className="w-3.5 h-3.5" />
                )}
                <span>Validate Spreadsheet</span>
              </button>
            </div>
          </div>

          {/* Step 2: Sheet / Tab, Range & Header Controls */}
          {metadata && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500">
                    Validated Spreadsheet
                  </p>
                  <p className="text-sm font-bold text-slate-900">{metadata.title}</p>
                </div>
                <span className="text-[11px] font-mono bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-slate-600">
                  {metadata.sheets.length} tab(s)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Worksheet Tab
                  </label>
                  <select
                    aria-label="Google Sheet tab selector"
                    value={selectedSheetName}
                    onChange={(e) => setSelectedSheetName(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-600"
                  >
                    {metadata.sheets.map((s) => (
                      <option key={s.sheetId} value={s.title}>
                        {s.title} (grid: {s.rowCount}×{s.columnCount})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Header Row Detection
                  </label>
                  <select
                    aria-label="Header row detection"
                    value={String(headerRowOption)}
                    onChange={(e) =>
                      setHeaderRowOption(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
                    }
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-600"
                  >
                    <option value="auto">Auto-detect header row</option>
                    <option value="0">Row 1</option>
                    <option value="1">Row 2</option>
                    <option value="2">Row 3</option>
                    <option value="3">Row 4</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cell Range Mode
                  </label>
                  <select
                    aria-label="Cell range mode"
                    value={rangeMode}
                    onChange={(e) => setRangeMode(e.target.value as 'auto' | 'custom')}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-600"
                  >
                    <option value="auto">Full Worksheet (Paginated)</option>
                    <option value="custom">Custom A1 Range</option>
                  </select>
                </div>

                {rangeMode === 'custom' ? (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Custom A1 Range
                    </label>
                    <input
                      type="text"
                      value={customRange}
                      onChange={(e) => setCustomRange(e.target.value)}
                      placeholder="A1:Z1000"
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-cyan-600"
                    />
                  </div>
                ) : (
                  <div className="flex items-end pb-1.5">
                    <label className="inline-flex items-center space-x-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncAllSheets}
                        onChange={(e) => setSyncAllSheets(e.target.checked)}
                        className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                      />
                      <span>Import all {metadata.sheets.length} tabs together</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => handleSync(true)}
              disabled={isBusy || !spreadsheetUrl.trim()}
              className="flex-1 min-w-[160px] inline-flex items-center justify-center space-x-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-300 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              {isBusy && !isValidating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              <span>{isBusy && !isValidating ? statusDetail || syncStatus : 'Import Data'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSync(false)}
              disabled={isBusy || !spreadsheetUrl.trim()}
              className="inline-flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isBusy && !isValidating ? 'animate-spin' : ''}`} />
              <span>Sync Now</span>
            </button>
          </div>

          {/* Sync Telemetry / Stats Summary */}
          {(lastSyncAt || lastStats || syncHistory.length > 0) && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-700">
                <span className="inline-flex items-center space-x-1.5 font-bold">
                  <Clock className="w-3.5 h-3.5 text-cyan-600" />
                  <span>
                    Last Sync:{' '}
                    {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Not synced yet'}
                  </span>
                </span>
                <span className="font-mono font-bold text-slate-800">
                  Table rows loaded: {currentRowCount}
                </span>
              </div>

              {lastStats && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-slate-500">Retrieved</span>
                    <span className="font-mono font-bold text-slate-900">
                      {lastStats.rowsRetrieved}
                    </span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-emerald-600">Created</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {lastStats.createdCount}
                    </span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-indigo-600">Updated</span>
                    <span className="font-mono font-bold text-indigo-700">
                      {lastStats.updatedCount}
                    </span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-slate-500">Unchanged</span>
                    <span className="font-mono font-bold text-slate-700">
                      {lastStats.unchangedCount}
                    </span>
                  </div>
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-amber-600">Skipped Blank</span>
                    <span className="font-mono font-bold text-amber-700">
                      {lastStats.skippedCount}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
