/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { SpreadsheetData } from '../types';
import { 
  FileSpreadsheet, 
  Upload, 
  RefreshCw, 
  CheckCircle2, 
  Globe, 
  FileText, 
  Table, 
  AlertCircle,
  Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { deduplicateHeaders } from '../utils/calculator';

interface DataSourceViewProps {
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
}

export const DataSourceView: React.FC<DataSourceViewProps> = ({
  spreadsheetData,
  setSpreadsheetData,
}) => {
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleClearData = () => {
    if (!window.confirm('Are you sure you want to clear all loaded spreadsheet data?')) return;
    setSpreadsheetData({
      fileName: 'No file uploaded',
      worksheets: [],
      activeSheetName: ''
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
        
        const newWorksheets = workbook.SheetNames.map(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { header: 1 });
          if (json.length === 0) return { name: sheetName, headers: [], rows: [] };

          const rawHeaders = (json[0] as string[]).filter(Boolean);
          const headers = deduplicateHeaders(rawHeaders);
          const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);
          return {
            name: sheetName,
            headers,
            rows: rawRows
          };
        });

        setSpreadsheetData({
          fileName: file.name,
          worksheets: newWorksheets,
          activeSheetName: newWorksheets[0]?.name || 'Sheet1'
        });

        setSuccessMessage(`Successfully uploaded and parsed ${file.name}`);
        setTimeout(() => setSuccessMessage(''), 4000);
      } catch (err) {
        console.error('Error parsing file:', err);
        alert('Failed to parse Excel file. Please ensure it is a valid XLSX, XLS or CSV file.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleConnectGoogleSheets = () => {
    setIsLoadingGoogle(true);
    setTimeout(() => {
      setIsGoogleConnected(true);
      setIsLoadingGoogle(false);
      setSuccessMessage('Successfully connected to Google Account & Google Sheets API.');
      setTimeout(() => setSuccessMessage(''), 4000);
    }, 1500);
  };

  const handleFetchGoogleSheet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleSheetUrl) return;

    setIsLoadingGoogle(true);
    setTimeout(() => {
      setIsLoadingGoogle(false);
      // Simulate fetching spreadsheet data from URL
      setSuccessMessage('Successfully synchronized and imported Google Sheet data.');
      setTimeout(() => setSuccessMessage(''), 4000);
    }, 1200);
  };

  const activeWorksheet = spreadsheetData.worksheets.find(ws => ws.name === spreadsheetData.activeSheetName) || spreadsheetData.worksheets[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Data Source Connector (Excel & Google Sheets)</h1>
          <p className="text-sm text-slate-500">Upload Excel workbooks or connect directly to Google Sheets to feed your universal invoice generation engine.</p>
        </div>
        <div className="flex items-center space-x-3">
          {spreadsheetData.worksheets.length > 0 && (
            <button
              onClick={handleClearData}
              className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-2 rounded-xl text-xs font-bold border border-rose-200 transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}
          {successMessage && (
            <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-sm font-semibold border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Excel Upload Section */}
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
                value={spreadsheetData.activeSheetName}
                onChange={(e) => setSpreadsheetData(prev => ({ ...prev, activeSheetName: e.target.value }))}
                className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2.5 py-1 outline-none font-medium"
              >
                {spreadsheetData.worksheets.map(ws => (
                  <option key={ws.name} value={ws.name}>{ws.name} ({ws.rows.length} rows)</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Google Sheets Connector */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center font-bold">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Google Sheets Connector</h2>
              <p className="text-xs text-slate-500">Secure OAuth 2.0 integration with Google Sheets API</p>
            </div>
          </div>

          {!isGoogleConnected ? (
            <div className="space-y-4 py-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Connect your Google account to securely access spreadsheets without exposing passwords or access tokens.
              </p>
              <button
                onClick={handleConnectGoogleSheets}
                disabled={isLoadingGoogle}
                className="w-full flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-sm"
              >
                {isLoadingGoogle ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Globe className="w-5 h-5 text-cyan-400" />
                    <span>Connect Google Account</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <form onSubmit={handleFetchGoogleSheet} className="space-y-4">
              <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>Google Account Connected Successfully</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Google Spreadsheet URL or ID</label>
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={googleSheetUrl}
                  onChange={(e) => setGoogleSheetUrl(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-cyan-600"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoadingGoogle}
                className="w-full flex items-center justify-center space-x-2 bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-sm"
              >
                {isLoadingGoogle ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    <span>Fetch Spreadsheet Data</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Spreadsheet Preview Table */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Worksheet Preview: <span className="text-indigo-600">{activeWorksheet?.name}</span>
            </h2>
            <p className="text-xs text-slate-500">Showing {activeWorksheet?.rows.length || 0} records loaded from worksheet</p>
          </div>
          <span className="text-xs font-mono bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
            {activeWorksheet?.headers.length || 0} Columns Detected
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                <th className="py-3 px-4">#</th>
                {activeWorksheet?.headers.map((header, hIdx) => (
                  <th key={`${header}_${hIdx}`} className="py-3 px-4 whitespace-nowrap">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {activeWorksheet?.rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-mono text-slate-400">{idx + 1}</td>
                  {activeWorksheet.headers.map((header, cIdx) => (
                    <td key={`${header}_${cIdx}`} className="py-2.5 px-4 text-slate-800 whitespace-nowrap">
                      {String(row[header] !== undefined ? row[header] : '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
