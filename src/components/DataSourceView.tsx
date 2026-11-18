/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { SpreadsheetData } from '../types';
import {
  FileSpreadsheet,
  Upload,
  RefreshCw,
  CheckCircle2,
  Globe,
  AlertCircle,
  Trash2,
  LogOut,
  User,
  Table,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { deduplicateHeaders } from '../utils/calculator';
import {
  SyncStatusState,
  extractSpreadsheetId,
  fetchSheetValues,
  fetchSpreadsheetMetadata,
  getAccessToken,
  googleSignIn,
  googleSignOut,
  initGoogleAuth,
  parseValuesToSpreadsheetData,
} from '../utils/googleSheets';

interface DataSourceViewProps {
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
}

export const DataSourceView: React.FC<DataSourceViewProps> = ({
  spreadsheetData,
  setSpreadsheetData,
}) => {
  const [googleUser, setGoogleUser] = useState<any | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatusState>('Not Connected');
  const [statusMessage, setStatusMessage] = useState('');
  const [lastFetchedSignature, setLastFetchedSignature] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user, token) => {
        setGoogleUser(user);
        setAccessToken(token);
        setSyncStatus('Connecting');
      },
      () => {
        setGoogleUser(null);
        setAccessToken(null);
        setSyncStatus('Not Connected');
      }
    );
    return () => unsubscribe();
  }, []);

  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    setErrorMessage('');
    try {
      const result = await googleSignIn();
      setGoogleUser(result.user);
      setAccessToken(result.accessToken);
      setSyncStatus('Connecting');
      setSuccessMessage(`Signed in as ${result.user.email || 'Google User'}`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setErrorMessage(err.message || 'Failed to authenticate with Google. Please try again.');
      setSyncStatus('Sync Failed');
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleSignOutGoogle = async () => {
    await googleSignOut();
    setGoogleUser(null);
    setAccessToken(null);
    setSyncStatus('Not Connected');
    setSuccessMessage('Disconnected Google account.');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const handleClearData = () => {
    setSpreadsheetData({
      fileName: 'No file uploaded',
      worksheets: [],
      activeSheetName: '',
    });
    setSuccessMessage('Cleared all spreadsheet data.');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });

        const newWorksheets = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { header: 1 });
          if (json.length === 0) return { name: sheetName, headers: [], rows: [] };

          const rawHeaders = (json[0] as string[]).filter(Boolean);
          const headers = deduplicateHeaders(rawHeaders);
          const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);
          return {
            name: sheetName,
            headers,
            rows: rawRows,
          };
        });

        setSpreadsheetData({
          fileName: file.name,
          worksheets: newWorksheets,
          activeSheetName: newWorksheets[0]?.name || 'Sheet1',
        });

        setSuccessMessage(`Successfully uploaded and parsed ${file.name}`);
        setTimeout(() => setSuccessMessage(''), 4000);
      } catch (err) {
        console.error('Error parsing file:', err);
        setErrorMessage('Failed to parse Excel file. Please ensure it is a valid XLSX, XLS or CSV file.');
        setTimeout(() => setErrorMessage(''), 5000);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleFetchGoogleSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleSheetUrl.trim()) return;

    let token = accessToken;
    if (!token) {
      token = await getAccessToken();
    }
    if (!token) {
      setErrorMessage('Google authentication required. Please sign in with Google first.');
      setSyncStatus('Sync Failed');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');

    try {
      // 1. Extract Spreadsheet ID
      setSyncStatus('Fetching Spreadsheet');
      setStatusMessage('Extracting Spreadsheet ID and fetching metadata...');
      const spreadsheetId = extractSpreadsheetId(googleSheetUrl);

      // 2. Fetch Spreadsheet Metadata
      const metadata = await fetchSpreadsheetMetadata(spreadsheetId, token);
      if (!metadata.sheets || metadata.sheets.length === 0) {
        throw new Error('Connected Google Spreadsheet contains no worksheets/tabs.');
      }

      // 3. Read Sheet Data across all worksheets
      setSyncStatus('Reading Sheet Data');
      setStatusMessage(`Retrieving data from ${metadata.sheets.length} worksheet(s)...`);
      const sheetValuesMap: Record<string, any[][]> = {};
      for (const sheet of metadata.sheets) {
        const values = await fetchSheetValues(spreadsheetId, sheet.title, token);
        sheetValuesMap[sheet.title] = values;
      }

      // 4. Processing Records
      setSyncStatus('Processing Records');
      setStatusMessage('Parsing cell values and detecting header rows...');
      const newSpreadsheetData = parseValuesToSpreadsheetData(
        metadata.title,
        metadata.sheets,
        sheetValuesMap
      );

      const totalRowsCount = newSpreadsheetData.worksheets.reduce(
        (acc, ws) => acc + ws.rows.length,
        0
      );

      if (totalRowsCount === 0) {
        setSyncStatus('Sync Failed');
        setErrorMessage(
          'Google Sheet retrieved successfully, but no valid data rows or headers were found. Please check that row 1 contains column headers and subsequent rows contain data.'
        );
        return;
      }

      // 5. Saving Records
      setSyncStatus('Saving Records');
      setStatusMessage('Saving imported records to application state...');

      // Check signature to detect if data changed
      const currentSignature = JSON.stringify(newSpreadsheetData);
      if (currentSignature === lastFetchedSignature) {
        setSyncStatus('Sync Successful — No New Changes');
        setStatusMessage('Spreadsheet synchronized — no new changes detected.');
        setSuccessMessage('Google Sheet sync successful (No new changes).');
        setTimeout(() => setSuccessMessage(''), 4000);
        return;
      }

      setSpreadsheetData(newSpreadsheetData);
      setLastFetchedSignature(currentSignature);
      setSyncStatus('Sync Successful');
      setStatusMessage(`Successfully imported "${metadata.title}" (${totalRowsCount} rows).`);
      setSuccessMessage(`Successfully synchronized Google Sheet "${metadata.title}"!`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      console.error('Google Sheets sync error:', err);
      setSyncStatus('Sync Failed');
      setErrorMessage(err.message || 'Failed to fetch or process Google Sheet data.');
    }
  };

  const activeWorksheet =
    spreadsheetData.worksheets.find((ws) => ws.name === spreadsheetData.activeSheetName) ||
    spreadsheetData.worksheets[0];

  const getSyncBadgeColor = (status: SyncStatusState) => {
    switch (status) {
      case 'Sync Successful':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Sync Successful — No New Changes':
        return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      case 'Sync Failed':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Not Connected':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      default:
        return 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Data Source Connector (Excel & Google Sheets)
          </h1>
          <p className="text-sm text-slate-500">
            Upload Excel workbooks or connect directly to Google Sheets with robust OAuth 2.0 authorization and live data synchronization.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {spreadsheetData.worksheets.length > 0 && (
            <button
              onClick={handleClearData}
              className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-2 rounded-xl text-xs font-bold border border-rose-200 transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Data</span>
            </button>
          )}
          {successMessage && (
            <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-sm font-semibold border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="flex items-center space-x-2 bg-rose-50 text-rose-700 px-4 py-2 rounded-xl text-sm font-semibold border border-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Excel / CSV Upload Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Excel / CSV Data Source</h2>
              <p className="text-xs text-slate-500">Supports XLSX, XLS and CSV formats</p>
            </div>
          </div>

          <label className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all bg-slate-50 hover:bg-emerald-50/20 group">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <span className="text-sm font-semibold text-slate-800">Click to upload Excel file</span>
            <span className="text-xs text-slate-400 mt-1">or drag and drop your workbook here</span>
            <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
          </label>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Current File:</span>
              <span className="text-xs font-mono font-medium text-slate-900 bg-white px-2 py-1 rounded border border-slate-200">
                {spreadsheetData.fileName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Active Worksheet:</span>
              <select
                aria-label="Active Worksheet"
                value={spreadsheetData.activeSheetName}
                onChange={(e) =>
                  setSpreadsheetData((prev) => ({ ...prev, activeSheetName: e.target.value }))
                }
                className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2.5 py-1 outline-none font-medium"
              >
                {spreadsheetData.worksheets.map((ws) => (
                  <option key={ws.name} value={ws.name}>
                    {ws.name} ({ws.rows.length} rows)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Google Sheets Connector */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center font-bold">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Google Sheets Connector</h2>
                <p className="text-xs text-slate-500">Secure OAuth 2.0 & Google Sheets API v4</p>
              </div>
            </div>

            {/* Sync Status Badge */}
            <div
              className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center space-x-1.5 ${getSyncBadgeColor(
                syncStatus
              )}`}
            >
              <span className="w-2 h-2 rounded-full bg-current" />
              <span>{syncStatus}</span>
            </div>
          </div>

          {!googleUser ? (
            <div className="space-y-4 py-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Sign in with your Google account to authorize secure, read-only access to your Google Spreadsheets via official Google APIs.
              </p>
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={isConnectingGoogle}
                className="w-full flex items-center justify-center space-x-2.5 bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-sm cursor-pointer"
              >
                {isConnectingGoogle ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Globe className="w-5 h-5 text-cyan-400" />
                    <span>Sign in with Google</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-emerald-50 text-emerald-900 p-3.5 rounded-xl border border-emerald-200">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                    {googleUser.email ? googleUser.email[0].toUpperCase() : <User className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-xs font-bold">{googleUser.displayName || 'Google User'}</p>
                    <p className="text-[11px] text-emerald-700 font-mono">{googleUser.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSignOutGoogle}
                  className="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-xs font-bold hover:bg-emerald-100 transition-colors cursor-pointer inline-flex items-center space-x-1"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Sign Out</span>
                </button>
              </div>

              <form onSubmit={handleFetchGoogleSheet} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Google Spreadsheet URL or ID
                  </label>
                  <input
                    type="text"
                    placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                    value={googleSheetUrl}
                    onChange={(e) => setGoogleSheetUrl(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-600 font-mono text-xs"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    syncStatus === 'Fetching Spreadsheet' ||
                    syncStatus === 'Reading Sheet Data' ||
                    syncStatus === 'Processing Records' ||
                    syncStatus === 'Saving Records'
                  }
                  className="w-full flex items-center justify-center space-x-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-300 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-sm cursor-pointer"
                >
                  {syncStatus === 'Fetching Spreadsheet' ||
                  syncStatus === 'Reading Sheet Data' ||
                  syncStatus === 'Processing Records' ||
                  syncStatus === 'Saving Records' ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>{statusMessage || 'Synchronizing...'}</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5" />
                      <span>Fetch & Sync Google Sheet</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Spreadsheet Preview Table */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <Table className="w-5 h-5 text-indigo-600" />
              <span>
                Worksheet Preview:{' '}
                <span className="text-indigo-600">{activeWorksheet?.name || 'No Sheet Loaded'}</span>
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              Showing {activeWorksheet?.rows.length || 0} records loaded across worksheets
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {spreadsheetData.worksheets.length > 1 && (
              <select
                aria-label="Select worksheet tab"
                value={spreadsheetData.activeSheetName}
                onChange={(e) =>
                  setSpreadsheetData((prev) => ({ ...prev, activeSheetName: e.target.value }))
                }
                className="bg-slate-50 border border-slate-300 text-slate-900 text-xs rounded-xl px-3 py-1.5 outline-none font-semibold"
              >
                {spreadsheetData.worksheets.map((ws) => (
                  <option key={ws.name} value={ws.name}>
                    {ws.name} ({ws.rows.length} rows)
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs font-mono bg-slate-100 text-slate-700 px-3 py-1.5 rounded-xl font-semibold">
              {activeWorksheet?.headers.length || 0} Columns Detected
            </span>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                <th className="py-3 px-4 w-12 text-center">#</th>
                {activeWorksheet?.headers && activeWorksheet.headers.length > 0 ? (
                  activeWorksheet.headers.map((header, hIdx) => (
                    <th key={`${header}_${hIdx}`} className="py-3 px-4 whitespace-nowrap">
                      {header}
                    </th>
                  ))
                ) : (
                  <th className="py-3 px-4 text-slate-400">No columns found</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {activeWorksheet?.rows && activeWorksheet.rows.length > 0 ? (
                activeWorksheet.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-400 text-center">{idx + 1}</td>
                    {activeWorksheet.headers.map((header, cIdx) => (
                      <td key={`${header}_${cIdx}`} className="py-2.5 px-4 text-slate-800 whitespace-nowrap">
                        {String(row[header] !== undefined ? row[header] : '')}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={(activeWorksheet?.headers?.length || 0) + 1}
                    className="py-12 text-center text-slate-400 text-xs"
                  >
                    No data rows loaded. Upload an Excel file or connect & sync a Google Sheet above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
