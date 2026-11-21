/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  DriveWorkspaceConnection,
  IntegrationDiagnostics,
  SpreadsheetData,
} from '../types';
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Table,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { deduplicateHeaders } from '../utils/calculator';
import { GoogleSheetsConnectorCard } from './GoogleSheetsConnectorCard';

interface DataSourceViewProps {
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  diagnostics?: IntegrationDiagnostics | null;
  driveConnection?: DriveWorkspaceConnection | null;
}

const PREVIEW_PAGE_SIZE = 50;

export const DataSourceView: React.FC<DataSourceViewProps> = ({
  spreadsheetData,
  setSpreadsheetData,
  diagnostics,
  driveConnection,
}) => {
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewPage, setPreviewPage] = useState(1);

  const handleClearData = () => {
    setSpreadsheetData({
      fileName: '',
      worksheets: [],
      activeSheetName: '',
    });
    setPreviewPage(1);
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
        const workbook = XLSX.read(bstr, { type: 'binary', raw: false });

        const newWorksheets = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: false });
          if (json.length === 0) return { name: sheetName, headers: [], rows: [] };

          const rawHeaders = (json[0] as any[]).map((h) => String(h ?? '').trim()).filter(Boolean);
          const headers = deduplicateHeaders(rawHeaders);
          const rawRows = XLSX.utils
            .sheet_to_json<Record<string, any>>(worksheet, { raw: false, defval: '' })
            .filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''));
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
        setPreviewPage(1);
        setErrorMessage('');
        setSuccessMessage(`Successfully uploaded and parsed ${file.name}`);
        setTimeout(() => setSuccessMessage(''), 4000);
      } catch (err) {
        console.error('Error parsing file:', err);
        setErrorMessage('Failed to parse file. Please ensure it is a valid XLSX, XLS or CSV file.');
        setTimeout(() => setErrorMessage(''), 5000);
      }
    };
    reader.readAsBinaryString(file);
  };

  const activeWorksheet =
    spreadsheetData.worksheets.find((ws) => ws.name === spreadsheetData.activeSheetName) ||
    spreadsheetData.worksheets[0];

  const filteredRows = useMemo(() => {
    const rows = activeWorksheet?.rows || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q))
    );
  }, [activeWorksheet, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PREVIEW_PAGE_SIZE));
  const safePage = Math.min(previewPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * PREVIEW_PAGE_SIZE;
    return filteredRows.slice(start, start + PREVIEW_PAGE_SIZE);
  }, [filteredRows, safePage]);

  const isGoogleSource = spreadsheetData.fileName.toLowerCase().includes('google sheets');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Data Source Connector (Excel / CSV & Google Sheets)
          </h1>
          <p className="text-sm text-slate-500">
            Upload Excel or CSV files, or paste a Google Sheets URL directly — no sign-in required.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {spreadsheetData.worksheets.length > 0 && (
            <button
              type="button"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Excel / CSV Upload Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Excel / CSV Data Source</h2>
              <p className="text-xs text-slate-500">Supports XLSX, XLS and CSV formats (preserves leading zeros)</p>
            </div>
          </div>

          <label className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all bg-slate-50 hover:bg-emerald-50/20 group">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <span className="text-sm font-semibold text-slate-800">Click to upload Excel or CSV file</span>
            <span className="text-xs text-slate-400 mt-1">or drag and drop your workbook here</span>
            <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
          </label>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">Current Source:</span>
              <span className="text-xs font-mono font-medium text-slate-900 bg-white px-2 py-1 rounded border border-slate-200 truncate max-w-[260px]">
                {spreadsheetData.fileName || 'No file loaded'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">Active Worksheet:</span>
              <select
                aria-label="Active Worksheet"
                value={spreadsheetData.activeSheetName}
                onChange={(e) => {
                  setPreviewPage(1);
                  setSpreadsheetData((prev) => ({ ...prev, activeSheetName: e.target.value }));
                }}
                className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2.5 py-1 outline-none font-medium"
              >
                {spreadsheetData.worksheets.length === 0 ? (
                  <option value="">No worksheets loaded</option>
                ) : (
                  spreadsheetData.worksheets.map((ws) => (
                    <option key={ws.name} value={ws.name}>
                      {ws.name} ({ws.rows.length} rows)
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Google Sheets Connector */}
        <GoogleSheetsConnectorCard
          spreadsheetData={spreadsheetData}
          setSpreadsheetData={(updater) => {
            setPreviewPage(1);
            setSpreadsheetData(updater);
          }}
          diagnostics={diagnostics}
          driveConnection={driveConnection}
        />
      </div>

      {/* Spreadsheet Preview Table */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <Table className="w-5 h-5 text-indigo-600" />
              <span>
                Worksheet Preview:{' '}
                <span className="text-indigo-600">{activeWorksheet?.name || 'No Sheet Loaded'}</span>
              </span>
              {spreadsheetData.worksheets.length > 0 && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    isGoogleSource
                      ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  {isGoogleSource ? 'Google Sheets' : 'Spreadsheet'}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500">
              Showing {filteredRows.length} matching records ({activeWorksheet?.rows.length || 0} total in active tab)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPreviewPage(1);
                }}
                placeholder="Filter loaded rows..."
                className="bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {spreadsheetData.worksheets.length > 1 && (
              <select
                aria-label="Select worksheet tab"
                value={spreadsheetData.activeSheetName}
                onChange={(e) => {
                  setPreviewPage(1);
                  setSpreadsheetData((prev) => ({ ...prev, activeSheetName: e.target.value }));
                }}
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
              {activeWorksheet?.headers.length || 0} Columns
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
              {paginatedRows.length > 0 ? (
                paginatedRows.map((row, idx) => (
                  <tr key={(safePage - 1) * PREVIEW_PAGE_SIZE + idx} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-400 text-center">
                      {(safePage - 1) * PREVIEW_PAGE_SIZE + idx + 1}
                    </td>
                    {activeWorksheet!.headers.map((header, cIdx) => (
                      <td key={`${header}_${cIdx}`} className="py-2.5 px-4 text-slate-800 whitespace-nowrap">
                        {String(row[header] !== undefined ? row[header] : '')}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={Math.max(2, (activeWorksheet?.headers?.length || 0) + 1)}
                    className="py-12 text-center text-slate-400 text-xs"
                  >
                    No data rows loaded. Upload an Excel file or connect & sync a Google Sheet above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
            <span>
              Page {safePage} of {totalPages} ({filteredRows.length} rows)
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPreviewPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
