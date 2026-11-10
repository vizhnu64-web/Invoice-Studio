/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  FileText, 
  Database, 
  Cpu, 
  History, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  Layers, 
  FileSpreadsheet,
  Building,
  Layout,
  Upload,
  Globe,
  Play,
  RotateCcw,
  Clock,
  Bookmark,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { SpreadsheetData, GenerationRecord, CompanySettings, GuidedWorkflowStep } from '../types';
import { storage } from '../utils/storage';
import { formatCurrency, deduplicateHeaders } from '../utils/calculator';
import * as XLSX from 'xlsx';

interface DashboardViewProps {
  setActiveTab: (tab: string) => void;
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData?: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  generationHistory: GenerationRecord[];
  company: CompanySettings;
  onStartGuidedWorkflow: (step?: GuidedWorkflowStep) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  setActiveTab,
  spreadsheetData,
  setSpreadsheetData,
  generationHistory,
  company,
  onStartGuidedWorkflow,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const totalRows = spreadsheetData.worksheets.reduce((acc, ws) => acc + ws.rows.length, 0);

  // Check if a saved in-progress session exists
  const activeSession = storage.loadWorkflowSession();
  const savedTemplates = storage.loadSavedTemplates();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !setSpreadsheetData) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const newWorksheets = workbook.SheetNames.map(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);
          const rawAoA = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
          const rawHeaderRow = (rawAoA[0] || []).map((h: any, i: number) => String(h || `Col_${i + 1}`).trim()).filter(Boolean);
          const headers = deduplicateHeaders(rawHeaderRow);
          return { name: sheetName, headers, rows: rawRows };
        });

        setSpreadsheetData({
          fileName: file.name,
          worksheets: newWorksheets,
          activeSheetName: newWorksheets[0]?.name || 'Sheet1'
        });

        // Launch guided workflow step 1
        onStartGuidedWorkflow('source');
      } catch (err) {
        console.error('Error reading excel file:', err);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !setSpreadsheetData) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const newWorksheets = workbook.SheetNames.map(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);
          const rawAoA = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
          const rawHeaderRow = (rawAoA[0] || []).map((h: any, i: number) => String(h || `Col_${i + 1}`).trim()).filter(Boolean);
          const headers = deduplicateHeaders(rawHeaderRow);
          return { name: sheetName, headers, rows: rawRows };
        });

        setSpreadsheetData({
          fileName: file.name,
          worksheets: newWorksheets,
          activeSheetName: newWorksheets[0]?.name || 'Sheet1'
        });

        // Launch guided workflow step 1
        onStartGuidedWorkflow('source');
      } catch (err) {
        console.error('Error reading dropped excel file:', err);
      }
    };
    reader.readAsBinaryString(file);
  };

  const stepNames: Record<GuidedWorkflowStep, string> = {
    source: '1. Select Data Source',
    mapping: '2. Map Invoice Data',
    amount_calc: '3. Amount Calculations',
    gst_calc: '4. GST & Tax Calculations',
    review: '5. Review Data',
    finalize: '6. Finalize & Generator'
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Continue Previous Session Banner if available */}
      {activeSession && (
        <div className="bg-gradient-to-r from-indigo-50 via-white to-indigo-50/60 p-5 rounded-2xl border-2 border-indigo-500/30 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-600/20">
              <RotateCcw className="w-5 h-5 animate-spin-reverse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                  In-Progress Session Found
                </span>
                <span className="text-xs text-slate-400">
                  Updated {new Date(activeSession.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <h3 className="font-bold text-slate-900 text-sm mt-0.5">
                Resume at {stepNames[activeSession.currentStep]} ({activeSession.selectedWorksheetName || spreadsheetData.fileName})
              </h3>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => storage.clearWorkflowSession()}
              className="text-xs text-slate-500 hover:text-slate-800 font-semibold px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
              Discard Session
            </button>
            <button
              onClick={() => onStartGuidedWorkflow(activeSession.currentStep)}
              className="inline-flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
            >
              <span>Continue Previous Session</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* PROMINENT SECTION: CREATE A NEW INVOICE */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
        <div>
          <div className="inline-flex items-center space-x-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Guided Creation Flow</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Create a New Invoice
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Choose your starting point below. Our step-by-step assistant guides you through data mapping, amount calculations, and tax rules without technical hassle.
          </p>
        </div>

        {/* TWO LARGE CLEAR STARTING OPTIONS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* OPTION A: Import Excel / CSV */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            className={`rounded-2xl p-6 border-2 transition-all flex flex-col justify-between ${
              isDragging
                ? 'border-indigo-600 bg-indigo-50/50'
                : 'border-slate-200 hover:border-indigo-500 bg-gradient-to-b from-slate-50/60 to-white hover:shadow-md'
            }`}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Option A • Recommended
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900">Import Excel / CSV</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Upload an existing spreadsheet (.xlsx, .xls, or .csv). We will automatically detect columns, parse monetary values, and configure line items.
                </p>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-500 bg-white p-3 rounded-xl border border-slate-200">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Supports XLSX, XLS & standard CSV files</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Indian lakhs (1,50,000) & international decimal parsing</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Active file: <strong className="text-slate-800">{spreadsheetData.fileName}</strong> ({totalRows} rows)</span>
                </div>
              </div>
            </div>

            <div className="pt-6 flex flex-wrap items-center gap-3">
              <label className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-3 px-4 rounded-xl text-center cursor-pointer shadow-sm shadow-indigo-600/20 transition-all flex items-center justify-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Upload Excel / CSV</span>
                <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
              </label>

              <button
                onClick={() => onStartGuidedWorkflow('source')}
                className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold py-3 px-4 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <span>Use Current Data</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* OPTION B: Connect Google Sheets */}
          <div className="rounded-2xl p-6 border-2 border-slate-200 hover:border-emerald-500 bg-gradient-to-b from-slate-50/60 to-white hover:shadow-md transition-all flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <Globe className="w-6 h-6" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                  Option B • Cloud Sync
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900">Connect Google Sheets</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Link your Google account to read spreadsheets live from Google Drive. Keep invoice records synchronized directly with your cloud sheets.
                </p>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-500 bg-white p-3 rounded-xl border border-slate-200">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Secure read-only authorization</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Pick any available sheet & worksheet tab</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Automatic column header detection</span>
                </div>
              </div>
            </div>

            <div className="pt-6">
              <button
                onClick={() => onStartGuidedWorkflow('source')}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-3 px-4 rounded-xl text-center shadow-sm shadow-emerald-600/20 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Globe className="w-4 h-4" />
                <span>Connect & Import Google Sheet</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase">Active Source Data</p>
            <p className="text-2xl font-bold text-slate-900">{totalRows} Rows</p>
            <p className="text-xs text-emerald-600 font-medium">Ready across {spreadsheetData.worksheets.length} sheets</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center font-bold">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase">Worksheets Loaded</p>
            <p className="text-2xl font-bold text-slate-900">{spreadsheetData.worksheets.length} Sheets</p>
            <p className="text-xs text-slate-500">Active: {spreadsheetData.activeSheetName}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <History className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase">Invoices Generated</p>
            <p className="text-2xl font-bold text-slate-900">{generationHistory.length}</p>
            <p className="text-xs text-emerald-600 font-medium">Stored in history</p>
          </div>
        </div>

        <div 
          onClick={() => setActiveTab('company')}
          className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 hover:border-indigo-500 flex items-center space-x-4 cursor-pointer transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase">Company Profile</p>
            <p className="text-base font-bold text-slate-900 truncate max-w-[150px]" title={company.displayName}>
              {company.displayName}
            </p>
            <p className="text-xs text-indigo-600 font-medium group-hover:underline">Edit Company Settings →</p>
          </div>
        </div>
      </div>

      {/* Grid: Recent Invoices & Saved Templates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices Card */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <History className="w-4 h-4 text-indigo-600" />
              <h3 className="font-bold text-slate-900 text-sm">Recent Generated Invoices</h3>
            </div>
            <button
              onClick={() => setActiveTab('history')}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              View All ({generationHistory.length}) →
            </button>
          </div>

          {generationHistory.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {generationHistory.slice(0, 4).map((rec) => (
                <div key={rec.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-slate-900">{rec.invoiceNumber}</span>
                    <p className="text-slate-500 text-[11px]">{rec.customerName}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-emerald-600">
                      {formatCurrency(rec.totalAmount, company.currency)}
                    </span>
                    <p className="text-[10px] text-slate-400">{rec.generatedDate}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              No invoices generated yet. Start with Option A or B above!
            </div>
          )}
        </div>

        {/* Saved Mapping Templates Card */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <Bookmark className="w-4 h-4 text-indigo-600" />
              <h3 className="font-bold text-slate-900 text-sm">Saved Mapping Templates</h3>
            </div>
            <button
              onClick={() => setActiveTab('fields')}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              Manage Fields →
            </button>
          </div>

          {savedTemplates.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {savedTemplates.slice(0, 4).map((tmpl) => (
                <div key={tmpl.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800">{tmpl.name}</span>
                    <p className="text-[11px] text-slate-400 truncate max-w-xs">{tmpl.description}</p>
                  </div>
                  <button
                    onClick={() => onStartGuidedWorkflow('mapping')}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold bg-indigo-50 px-2.5 py-1 rounded-lg"
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-400 space-y-1">
              <p>Default templates available: ZRM, CoachX, Capcut, TRYM 10K, TBT 90 Days.</p>
              <p className="text-[11px] text-slate-400">Save your custom templates in Step 2 of the guided workflow.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
