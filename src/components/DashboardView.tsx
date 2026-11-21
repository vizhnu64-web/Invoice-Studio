/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  Mail,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import {
  CompanySettings,
  CustomerRecord,
  DriveWorkspaceConnection,
  GenerationRecord,
  GuidedWorkflowStep,
  QuotationRecord,
  QuotationStatus,
  SpreadsheetData,
} from '../types';
import type { DriveSyncState } from '../App';
import { formatCurrency } from '../utils/calculator';
import { computeQuotationStats } from '../utils/quotation';
import { storage } from '../utils/storage';

interface DashboardViewProps {
  setActiveTab: (tab: string) => void;
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  generationHistory: GenerationRecord[];
  quotations: QuotationRecord[];
  customers: CustomerRecord[];
  company: CompanySettings;
  driveConnection: DriveWorkspaceConnection | null;
  driveSyncState: DriveSyncState;
  onStartGuidedWorkflow: (step?: GuidedWorkflowStep) => void;
  onNavigateQuotationsFiltered?: (status: QuotationStatus | 'ALL') => void;
  onNavigateInvoicesFiltered?: (paymentFilter: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  setActiveTab,
  spreadsheetData,
  generationHistory,
  quotations,
  customers,
  company,
  driveConnection,
  driveSyncState,
  onStartGuidedWorkflow,
  onNavigateQuotationsFiltered,
  onNavigateInvoicesFiltered,
}) => {
  const activeSession = storage.loadWorkflowSession();
  const importedRowsCount = useMemo(
    () => spreadsheetData.worksheets.reduce((acc, ws) => acc + ws.rows.length, 0),
    [spreadsheetData]
  );

  const invoiceStats = useMemo(() => {
    let totalInvoiced = 0;
    let totalPaid = 0;
    let unpaidCount = 0;
    let paidCount = 0;
    let partialCount = 0;

    for (const rec of generationHistory) {
      const amount = Number(rec.totalAmount || 0);
      totalInvoiced += amount;
      const status = String(rec.paymentStatus || 'Unpaid');
      const paidAmt =
        rec.paymentAmount !== undefined
          ? Math.min(amount, Math.max(0, Number(rec.paymentAmount)))
          : status === 'Paid'
            ? amount
            : 0;
      totalPaid += paidAmt;

      if (status === 'Paid' || (amount > 0 && paidAmt >= amount - 0.01)) {
        paidCount += 1;
      } else if (status === 'Partially Paid' || paidAmt > 0) {
        partialCount += 1;
      } else {
        unpaidCount += 1;
      }
    }

    const outstandingBalance = Math.max(0, totalInvoiced - totalPaid);
    return {
      totalInvoices: generationHistory.length,
      totalInvoiced,
      totalPaid,
      outstandingBalance,
      paidCount,
      partialCount,
      unpaidCount,
    };
  }, [generationHistory]);

  const quotationStats = useMemo(() => computeQuotationStats(quotations), [quotations]);

  const recentActivity = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'invoice' | 'quotation';
      number: string;
      customerName: string;
      amount: number;
      status: string;
      date: string;
    }> = [
      ...generationHistory.map((inv) => ({
        id: inv.id,
        type: 'invoice' as const,
        number: inv.invoiceNumber,
        customerName: inv.customerName || 'Unnamed Customer',
        amount: Number(inv.totalAmount || 0),
        status: inv.paymentStatus || 'Unpaid',
        date: inv.updatedAt || inv.generatedDate || '',
      })),
      ...quotations.map((qt) => ({
        id: qt.id,
        type: 'quotation' as const,
        number: qt.quotationNumber,
        customerName: qt.customerName || 'Unnamed Customer',
        amount: Number(qt.totalAmount || 0),
        status: qt.status,
        date: qt.updatedAt || qt.createdAt || qt.quotationDate || '',
      })),
    ];

    return items
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 6);
  }, [generationHistory, quotations]);

  const isCompanyConfigured = Boolean(company.legalName?.trim() || company.displayName?.trim());

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Workspace Storage Status Banner */}
      {driveConnection?.isConnected ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-emerald-950">
                  Google Drive Connected: {driveConnection.folderName}
                </p>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {driveSyncState === 'syncing'
                    ? 'Syncing...'
                    : driveSyncState === 'error'
                      ? 'Sync Attention Needed'
                      : 'Persistent Storage Active'}
                </span>
              </div>
              <p className="text-xs text-emerald-800 mt-0.5">
                All company settings, customers, invoices, quotations, PDFs, and email history are
                isolated to this Drive folder.
                {driveConnection.lastSyncedAt && (
                  <span className="ml-1.5 font-medium">
                    Last sync: {new Date(driveConnection.lastSyncedAt).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('integrations')}
            className="px-3.5 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-900 text-xs font-semibold hover:bg-emerald-100 transition-colors shrink-0 cursor-pointer"
          >
            Manage Drive & Email
          </button>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
              <CloudOff className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-950">
                Temporary Workspace — Not Backed Up to Google Drive
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                You can create invoices, quotations, and download PDFs immediately without signing
                in. Connect your business Google Drive folder URL to save records permanently.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('integrations')}
            className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors shrink-0 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Connect Google Drive Folder</span>
          </button>
        </div>
      )}

      {/* Hero Header */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
            {isCompanyConfigured
              ? company.displayName || company.legalName
              : 'Fresh Business Workspace'}
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Invoice & Quotation Management Dashboard
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Create GST-compliant invoices and quotations from Excel, CSV, Google Sheets URLs, or
            manual entry. Download branded PDFs and deliver directly via Gmail SMTP or Custom SMTP.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>New Invoice</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quotations')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
            <span>New Quotation</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('datasource')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-cyan-400" />
            <span>Import Spreadsheet</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid (All Real Numbers — Zero on Fresh Visit, Clickable to Filtered Views) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() =>
            onNavigateInvoicesFiltered
              ? onNavigateInvoicesFiltered('ALL')
              : setActiveTab('history')
          }
          className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Total Invoices
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">
            {invoiceStats.totalInvoices}
          </p>
          <p className="text-xs text-slate-500 mt-2 flex items-center justify-between">
            <span>
              {invoiceStats.paidCount} Paid · {invoiceStats.partialCount} Partial ·{' '}
              {invoiceStats.unpaidCount} Unpaid
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigateQuotationsFiltered
              ? onNavigateQuotationsFiltered('ALL')
              : setActiveTab('quotations')
          }
          className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Total Quotations
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <FileCheck2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">
            {quotationStats.total}
          </p>
          <p className="text-xs text-slate-500 mt-2 flex items-center justify-between">
            <span>
              {quotationStats.approved} Approved · {quotationStats.pendingApproval} Pending ·{' '}
              {quotationStats.converted} Converted
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-cyan-300 hover:shadow-md transition-all text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Total Customers
            </span>
            <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">{customers.length}</p>
          <p className="text-xs text-slate-500 mt-2 flex items-center justify-between">
            <span>{importedRowsCount} imported spreadsheet rows</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-600 transition-colors" />
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigateInvoicesFiltered
              ? onNavigateInvoicesFiltered('ALL')
              : setActiveTab('history')
          }
          className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Total Invoiced
            </span>
            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900 mt-3 tabular-nums">
            {formatCurrency(invoiceStats.totalInvoiced, company.currency)}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Quoted pipeline: {formatCurrency(quotationStats.totalQuotedValue, company.currency)}
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigateInvoicesFiltered
              ? onNavigateInvoicesFiltered('Paid')
              : setActiveTab('history')
          }
          className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Amount Paid
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-emerald-700 mt-3 tabular-nums">
            {formatCurrency(invoiceStats.totalPaid, company.currency)}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Collected across {invoiceStats.paidCount + invoiceStats.partialCount} settled invoices
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigateInvoicesFiltered
              ? onNavigateInvoicesFiltered('Unpaid')
              : setActiveTab('history')
          }
          className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Outstanding Balance
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-amber-700 mt-3 tabular-nums">
            {formatCurrency(invoiceStats.outstandingBalance, company.currency)}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Click to view unpaid & partially paid invoices
          </p>
        </button>
      </div>

      {/* Two-column Workspace Readiness & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Recent Activity</h2>
              <p className="text-xs text-slate-500">Latest invoices and quotations in this workspace</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('quotations')}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                Quotations
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                All Invoices
              </button>
            </div>
          </div>

          {recentActivity.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">No documents created yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Start with a clean slate — create a manual invoice, prepare a quotation for
                  approval, or import rows from Excel / Google Sheets.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('manual')}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 cursor-pointer"
                >
                  Create First Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('quotations')}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200 cursor-pointer"
                >
                  Create First Quotation
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.map((item) => (
                <div
                  key={`${item.type}_${item.id}`}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        item.type === 'invoice'
                          ? 'bg-indigo-50 text-indigo-600'
                          : 'bg-emerald-50 text-emerald-600'
                      }`}
                    >
                      {item.type === 'invoice' ? (
                        <FileText className="w-4 h-4" />
                      ) : (
                        <FileCheck2 className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {item.number}{' '}
                        <span className="font-normal text-slate-500">— {item.customerName}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.type === 'invoice' ? 'Invoice' : 'Quotation'} ·{' '}
                        {item.date ? new Date(item.date).toLocaleDateString() : 'Today'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-900 tabular-nums">
                      {formatCurrency(item.amount, company.currency)}
                    </p>
                    <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 mt-0.5">
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workspace Setup Checklist */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Workspace Setup</h2>
            <p className="text-xs text-slate-500">Configure your business tools in any order</p>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setActiveTab('company')}
              className="w-full p-3 rounded-xl border border-slate-200 hover:border-indigo-300 flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">Company Profile & GSTIN</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {isCompanyConfigured ? company.legalName || company.displayName : 'Not configured yet'}
                  </p>
                </div>
              </div>
              {isCompanyConfigured ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('integrations')}
              className="w-full p-3 rounded-xl border border-slate-200 hover:border-indigo-300 flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Cloud className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">Google Drive Folder</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {driveConnection?.isConnected
                      ? driveConnection.folderName
                      : 'Optional — connect for cloud backup'}
                  </p>
                </div>
              </div>
              {driveConnection?.isConnected ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('integrations')}
              className="w-full p-3 rounded-xl border border-slate-200 hover:border-indigo-300 flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">Email Delivery (SMTP)</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    Gmail SMTP or Custom SMTP server
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onStartGuidedWorkflow(activeSession?.currentStep || 'source')}
              className="w-full p-3 rounded-xl border border-slate-200 hover:border-indigo-300 flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Settings className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">
                    {activeSession ? 'Resume Spreadsheet Wizard' : 'Guided Batch Import Wizard'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {importedRowsCount > 0
                      ? `${importedRowsCount} rows loaded from ${spreadsheetData.fileName}`
                      : 'Upload Excel/CSV or paste a Google Sheets URL'}
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
