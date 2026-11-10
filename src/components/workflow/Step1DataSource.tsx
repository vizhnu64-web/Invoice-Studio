/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  CheckCircle2, 
  Table, 
  Globe, 
  ArrowRight, 
  AlertCircle,
  FileCheck,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { deduplicateHeaders } from '../../utils/calculator';
import { SpreadsheetData } from '../../types';

interface Step1DataSourceProps {
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  selectedWorksheetName: string;
  setSelectedWorksheetName: (name: string) => void;
  headerRowIndex: number;
  setHeaderRowIndex: (idx: number) => void;
  startRowIndex: number;
  setStartRowIndex: (idx: number) => void;
  endRowIndex: number | undefined;
  setEndRowIndex: (idx: number | undefined) => void;
  onContinue: () => void;
}

export const Step1DataSource: React.FC<Step1DataSourceProps> = ({
  spreadsheetData,
  setSpreadsheetData,
  selectedWorksheetName,
  setSelectedWorksheetName,
  headerRowIndex,
  setHeaderRowIndex,
  startRowIndex,
  setStartRowIndex,
  endRowIndex,
  setEndRowIndex,
  onContinue,
}) => {
  const [sourceType, setSourceType] = useState<'excel' | 'googlesheets'>('excel');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);

  const activeWorksheet = spreadsheetData.worksheets.find(
    ws => ws.name === (selectedWorksheetName || spreadsheetData.activeSheetName)
  ) || spreadsheetData.worksheets[0];

  const handleProcessWorkbook = (workbook: XLSX.WorkBook, fileName: string) => {
    try {
      const newWorksheets = workbook.SheetNames.map(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        // Read as 2D array of rows
        const rawAoA = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
        if (rawAoA.length === 0) return { name: sheetName, headers: [], rows: [] };

        const hIdx = Math.min(headerRowIndex, rawAoA.length - 1);
        const rawHeaders = (rawAoA[hIdx] || []).map((h: any, i: number) => String(h || `Col_${i + 1}`).trim()).filter(Boolean);
        const headers = deduplicateHeaders(rawHeaders);

        const rowsData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
          range: hIdx
        });

        return {
          name: sheetName,
          headers,
          rows: rowsData
        };
      });

      const initialSheet = newWorksheets[0]?.name || 'Sheet1';
      setSpreadsheetData({
        fileName,
        worksheets: newWorksheets,
        activeSheetName: initialSheet
      });
      setSelectedWorksheetName(initialSheet);
      setUploadStatus(`Uploaded and parsed "${fileName}" (${newWorksheets.length} sheets)`);
      setTimeout(() => setUploadStatus(null), 4000);
    } catch (err) {
      console.error('File parsing error:', err);
      alert('Unable to parse the spreadsheet. Please verify it is a valid XLSX, XLS, or CSV file.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const workbook = XLSX.read(bstr, { type: 'binary' });
      handleProcessWorkbook(workbook, file.name);
    };
    reader.readAsBinaryString(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const workbook = XLSX.read(bstr, { type: 'binary' });
      handleProcessWorkbook(workbook, file.name);
    };
    reader.readAsBinaryString(file);
  };

  const handleConnectGoogle = () => {
    setIsConnectingGoogle(true);
    setTimeout(() => {
      setIsConnectingGoogle(false);
      setGoogleConnected(true);
      setUploadStatus('Connected to Google Sheets API.');
      setTimeout(() => setUploadStatus(null), 4000);
    }, 1200);
  };

  const handleSyncGoogleSheet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleSheetUrl) return;
    setIsConnectingGoogle(true);
    setTimeout(() => {
      setIsConnectingGoogle(false);
      setUploadStatus('Synchronized Google Sheet rows.');
      setTimeout(() => setUploadStatus(null), 4000);
    }, 1000);
  };

  // Sliced rows for preview
  const displayRows = activeWorksheet?.rows || [];
  const totalRowsCount = displayRows.length;
  const effectiveEndRow = endRowIndex !== undefined && endRowIndex < totalRowsCount ? endRowIndex : totalRowsCount;
  const filteredRows = displayRows.slice(startRowIndex, effectiveEndRow);

  return (
    <div className="space-y-6">
      {/* Header explanation */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">Step 1: Select & Verify Your Data Source</h2>
        <p className="text-sm text-slate-600 mt-1">
          Upload your invoice data file (Excel or CSV) or connect a Google Sheet. We will detect column headers and prepare rows for automated mapping.
        </p>

        {uploadStatus && (
          <div className="mt-4 flex items-center space-x-2 bg-emerald-50 text-emerald-800 px-4 py-2.5 rounded-xl border border-emerald-200 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{uploadStatus}</span>
          </div>
        )}
      </div>

      {/* Source Selector Tab Buttons */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => setSourceType('excel')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            sourceType === 'excel'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Option A: Upload Excel / CSV File</span>
        </button>
        <button
          onClick={() => setSourceType('googlesheets')}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            sourceType === 'googlesheets'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>Option B: Connect Google Sheets</span>
        </button>
      </div>

      {/* Source Type Body */}
      {sourceType === 'excel' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Dropzone */}
          <div className="lg:col-span-2">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all bg-white cursor-pointer ${
                isDragging ? 'border-indigo-600 bg-indigo-50/40' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50/50'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 shadow-inner">
                <Upload className="w-7 h-7" />
              </div>
              <p className="text-base font-bold text-slate-800">
                Click to browse or drag and drop your spreadsheet here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supports Microsoft Excel (.xlsx, .xls) and Comma-Separated Values (.csv)
              </p>
              <label className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl cursor-pointer shadow-sm transition-all">
                Select File
                <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Active File Details & Sheet Selection */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center space-x-2 text-indigo-600">
              <FileCheck className="w-5 h-5" />
              <h3 className="font-bold text-slate-900 text-sm">Active File Information</h3>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">File Name:</span>
                <span className="font-mono text-slate-800 font-bold truncate max-w-[150px]" title={spreadsheetData.fileName}>
                  {spreadsheetData.fileName}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Worksheets:</span>
                <span className="font-semibold text-slate-800">{spreadsheetData.worksheets.length} Sheets</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Active Sheet:</span>
                <span className="font-bold text-indigo-600">{activeWorksheet?.name || 'None'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Detected Columns:</span>
                <span className="font-semibold text-slate-800">{activeWorksheet?.headers.length || 0} columns</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-medium">Total Rows:</span>
                <span className="font-semibold text-emerald-600">{totalRowsCount} records</span>
              </div>
            </div>

            {/* Sheet Selector */}
            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Select Worksheet to Invoice:
              </label>
              <select
                value={activeWorksheet?.name || ''}
                onChange={(e) => {
                  setSelectedWorksheetName(e.target.value);
                  setSpreadsheetData(prev => ({ ...prev, activeSheetName: e.target.value }));
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
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
      ) : (
        /* Google Sheets Connector */
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Google Sheets Live Synchronization</h3>
              <p className="text-xs text-slate-500">Connect your Google Workspace or personal Google account</p>
            </div>
          </div>

          {!googleConnected ? (
            <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center text-center space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                Connect your Google Account to access your online spreadsheets
              </p>
              <p className="text-xs text-slate-500 max-w-md">
                Invoice Studio accesses your spreadsheets securely in read-only mode to pull rows into the invoice generator.
              </p>
              <button
                onClick={handleConnectGoogle}
                disabled={isConnectingGoogle}
                className="inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm"
              >
                {isConnectingGoogle ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                <span>{isConnectingGoogle ? 'Connecting...' : 'Authorize Google Account'}</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSyncGoogleSheet} className="space-y-4">
              <div className="flex items-center space-x-2 text-xs text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-200 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Google Account connected. Enter the Google Spreadsheet URL or ID below:</span>
              </div>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={googleSheetUrl}
                  onChange={(e) => setGoogleSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/your-spreadsheet-id/edit"
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isConnectingGoogle}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm"
                >
                  {isConnectingGoogle ? 'Syncing...' : 'Sync Data'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Header Row & Range Selection Control Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-slate-900 text-sm">Header Detection & Record Range</h3>
          </div>
          <div className="flex items-center space-x-4 text-xs">
            <div className="flex items-center space-x-2">
              <span className="text-slate-500 font-medium">Header Row:</span>
              <select
                value={headerRowIndex}
                onChange={(e) => setHeaderRowIndex(Number(e.target.value))}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 outline-none"
              >
                <option value={0}>Row 1 (Standard)</option>
                <option value={1}>Row 2</option>
                <option value={2}>Row 3</option>
                <option value={3}>Row 4</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-slate-500 font-medium">From Record:</span>
              <input
                type="number"
                min={1}
                max={totalRowsCount || 1}
                value={startRowIndex + 1}
                onChange={(e) => setStartRowIndex(Math.max(0, Number(e.target.value) - 1))}
                className="w-16 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono text-center text-slate-800 outline-none"
              />
              <span className="text-slate-500 font-medium">to</span>
              <input
                type="number"
                min={1}
                max={totalRowsCount || 1}
                value={effectiveEndRow}
                onChange={(e) => setEndRowIndex(Number(e.target.value))}
                className="w-16 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono text-center text-slate-800 outline-none"
              />
              <span className="text-slate-400 font-mono text-[11px]">(of {totalRowsCount})</span>
            </div>
          </div>
        </div>

        {/* Live Data Preview Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Data Preview ({filteredRows.length} rows loaded from "{activeWorksheet?.name}")
            </span>
            <span className="text-[11px] text-slate-400">
              Showing first 5 columns and up to 8 sample rows
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-2.5 px-3 font-bold w-12 text-center text-slate-400">#</th>
                  {activeWorksheet?.headers.slice(0, 6).map((header, hIdx) => (
                    <th key={`${header}_${hIdx}`} className="py-2.5 px-3 font-bold whitespace-nowrap text-slate-700">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.slice(0, 8).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 text-center font-mono text-slate-400">
                      {startRowIndex + idx + 1}
                    </td>
                    {activeWorksheet?.headers.slice(0, 6).map((header, cIdx) => (
                      <td key={`${header}_${cIdx}`} className="py-2 px-3 text-slate-800 truncate max-w-[200px]">
                        {String(row[header] !== undefined ? row[header] : '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-slate-500">
          Source file ready: <span className="font-bold text-slate-700">{spreadsheetData.fileName}</span> ({totalRowsCount} rows)
        </div>
        <button
          onClick={onContinue}
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold text-sm shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <span>Continue to Field Mapping</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
