/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GenerationRecord, CompanySettings, InvoiceTemplate } from '../types';
import { 
  History, 
  Search, 
  Download, 
  Printer, 
  Copy, 
  RefreshCw, 
  CheckCircle2, 
  FileText,
  Trash2
} from 'lucide-react';
import { formatCurrency } from '../utils/calculator';
import { generateInvoicePDF } from '../utils/pdfGenerator';

interface HistoryViewProps {
  generationHistory: GenerationRecord[];
  setGenerationHistory: React.Dispatch<React.SetStateAction<GenerationRecord[]>>;
  company: CompanySettings;
  template: InvoiceTemplate;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  generationHistory,
  setGenerationHistory,
  company,
  template,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredHistory = generationHistory.filter(record => 
    record.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.worksheetName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleClearHistory = () => {
    if (!window.confirm('Are you sure you want to clear all generation history? This action cannot be undone.')) return;
    setGenerationHistory([]);
  };

  const handleDownloadPDF = (record: GenerationRecord) => {
    const { rowFields, items } = record.dataSnapshot;
    const pdf = generateInvoicePDF({ company, items, fields: rowFields, template });
    pdf.save(`${record.invoiceNumber.replace(/[/\\?%*:|"<>]/g, '_')}.pdf`);
  };

  const handleRegenerateRecord = (record: GenerationRecord) => {
    const { rowFields, items } = record.dataSnapshot;
    const pdf = generateInvoicePDF({ company, items, fields: rowFields, template });
    pdf.save(`${record.invoiceNumber.replace(/[/\\?%*:|"<>]/g, '_')}_regenerated.pdf`);
  };

  const handleDuplicateRecord = (record: GenerationRecord) => {
    const duplicated: GenerationRecord = {
      ...record,
      id: Math.random().toString(36).substr(2, 9),
      invoiceNumber: record.invoiceNumber + '-DUP',
      generatedDate: new Date().toISOString().split('T')[0],
      revisionNumber: 1,
    };
    setGenerationHistory(prev => [duplicated, ...prev]);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Generation History & Versioning</h1>
          <p className="text-sm text-slate-500">View permanently stored invoices, download PDFs, regenerate with latest brand settings, and duplicate records.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search invoice no or customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-600 outline-none"
            />
          </div>

          {generationHistory.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3.5 py-2 rounded-xl text-xs font-bold border border-rose-200 transition-all cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Invoice No</th>
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Worksheet</th>
                <th className="py-3 px-4">Generated Date</th>
                <th className="py-3 px-4">Total Amount</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No generated invoices found in history. Generate some invoices from the Generation Center!
                  </td>
                </tr>
              ) : (
                filteredHistory.map(record => (
                  <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900 font-mono">
                      {record.invoiceNumber}
                    </td>
                    <td className="py-3 px-4 text-slate-800 font-medium">
                      {record.customerName}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <span className="bg-slate-100 px-2 py-1 rounded text-xs font-medium">
                        {record.worksheetName}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-xs">
                      {record.generatedDate}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {formatCurrency(record.totalAmount, company.currency)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Success</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleDownloadPDF(record)}
                        className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRegenerateRecord(record)}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="Regenerate with Latest Settings"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDuplicateRecord(record)}
                        className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                        title="Duplicate Invoice"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
