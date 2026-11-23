/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  FileText,
  Mail,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CompanySettings, GenerationRecord, InvoiceTemplate } from '../types';
import { formatCurrency } from '../utils/calculator';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { googleTokenManager } from '../utils/googleAuth';
import { EmailSendStatus } from '../utils/emailService';
import { storage } from '../utils/storage';
import { workspaceApi } from '../utils/workspaceApi';

interface HistoryViewProps {
  generationHistory: GenerationRecord[];
  setGenerationHistory: React.Dispatch<React.SetStateAction<GenerationRecord[]>>;
  company: CompanySettings;
  template: InvoiceTemplate;
  emailStatuses?: Record<string, EmailSendStatus>;
  setEmailStatuses?: React.Dispatch<React.SetStateAction<Record<string, EmailSendStatus>>>;
  initialPaymentFilter?: string;
  onSendByEmail?: (recordId: string) => void;
}

type PaymentStatusOption = 'Unpaid' | 'Partially Paid' | 'Paid';

function resolveRecordPaymentStatus(record: GenerationRecord): PaymentStatusOption {
  const paid = Number(record.paymentAmount ?? record.dataSnapshot?.paymentMade ?? 0);
  const total = Number(record.totalAmount || 0);
  if (record.paymentStatus === 'Paid' || (total > 0 && paid >= total - 0.01)) {
    return 'Paid';
  }
  if (record.paymentStatus === 'Partially Paid' || (paid > 0 && paid < total - 0.01)) {
    return 'Partially Paid';
  }
  return 'Unpaid';
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  generationHistory,
  setGenerationHistory,
  company,
  template,
  emailStatuses: externalEmailStatuses,
  setEmailStatuses: externalSetEmailStatuses,
  initialPaymentFilter,
  onSendByEmail,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>(initialPaymentFilter || 'ALL');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [paymentModalRecord, setPaymentModalRecord] = useState<GenerationRecord | null>(null);
  const [paymentStatusInput, setPaymentStatusInput] = useState<PaymentStatusOption>('Unpaid');
  const [amountPaidInput, setAmountPaidInput] = useState<string>('0');
  const [paymentMethodInput, setPaymentMethodInput] = useState<string>('Bank Transfer / NEFT');
  const [paymentDateInput, setPaymentDateInput] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [paymentRefInput, setPaymentRefInput] = useState<string>('');
  const [banner, setBanner] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (initialPaymentFilter) {
      setPaymentFilter(initialPaymentFilter);
    }
  }, [initialPaymentFilter]);

  const effectiveEmailStatuses = externalEmailStatuses || {};

  const stats = useMemo(() => {
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;
    let totalBilled = 0;
    let totalCollected = 0;

    for (const rec of generationHistory) {
      const total = Number(rec.totalAmount || 0);
      const paid = Math.min(total, Math.max(0, Number(rec.paymentAmount ?? rec.dataSnapshot?.paymentMade ?? 0)));
      const st = resolveRecordPaymentStatus(rec);
      totalBilled += total;
      totalCollected += st === 'Paid' ? total : paid;
      if (st === 'Paid') paidCount += 1;
      else if (st === 'Partially Paid') partialCount += 1;
      else unpaidCount += 1;
    }

    return {
      total: generationHistory.length,
      paidCount,
      partialCount,
      unpaidCount,
      totalBilled,
      totalCollected,
      balanceDue: Math.max(0, totalBilled - totalCollected),
    };
  }, [generationHistory]);

  const filteredHistory = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return generationHistory.filter((record) => {
      const st = resolveRecordPaymentStatus(record);
      if (paymentFilter !== 'ALL' && st !== paymentFilter) return false;
      if (!q) return true;
      return (
        record.invoiceNumber.toLowerCase().includes(q) ||
        record.customerName.toLowerCase().includes(q) ||
        record.worksheetName.toLowerCase().includes(q) ||
        (record.sourceQuotationNumber || '').toLowerCase().includes(q)
      );
    });
  }, [generationHistory, paymentFilter, searchTerm]);

  const handleConfirmClearHistory = () => {
    setGenerationHistory([]);
    if (externalSetEmailStatuses) {
      externalSetEmailStatuses({});
    }
    storage.saveEmailStatuses({});
    setConfirmClearOpen(false);
    setBanner({ type: 'info', text: 'Invoice history cleared for this workspace.' });
  };

  const handleDeleteRecord = (record: GenerationRecord) => {
    setGenerationHistory((prev) => prev.filter((r) => r.id !== record.id));
    setBanner({ type: 'info', text: `Removed invoice ${record.invoiceNumber} from history.` });
  };

  const handleDownloadPDF = (record: GenerationRecord) => {
    const {
      rowFields,
      items,
      discount = 0,
      additionalCharges = 0,
      paymentMade = record.paymentAmount ?? 0,
    } = record.dataSnapshot;
    const pdf = generateInvoicePDF({
      company,
      items,
      fields: rowFields,
      template,
      discount,
      additionalCharges,
      paymentMade,
    });
    const safeFileName = `${record.invoiceNumber.replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
    pdf.save(safeFileName);

    // Best-effort upload to user's connected Google Drive Invoices/ folder
    if (storage.getActiveWorkspaceId() && googleTokenManager.isTokenValid()) {
      try {
        const dataUri = pdf.output('datauristring');
        const pdfBase64 = dataUri.split('base64,')[1] || '';
        if (pdfBase64) {
          void workspaceApi
            .uploadPdfToDrive({
              documentType: 'invoice',
              fileName: safeFileName,
              pdfBase64,
            })
            .catch(() => {});
        }
      } catch {
        // Non-blocking
      }
    }
  };

  const handleDuplicateRecord = (record: GenerationRecord) => {
    const baseNum = `${record.invoiceNumber}-COPY`;
    const exists = new Set(generationHistory.map((r) => r.invoiceNumber.toLowerCase()));
    let nextNum = baseNum;
    let counter = 2;
    while (exists.has(nextNum.toLowerCase())) {
      nextNum = `${baseNum}-${counter++}`;
    }

    const duplicated: GenerationRecord = {
      ...record,
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      invoiceNumber: nextNum,
      generatedDate: new Date().toISOString().split('T')[0],
      revisionNumber: 1,
      paymentStatus: 'Unpaid',
      paymentAmount: 0,
      sourceQuotationId: undefined,
      sourceQuotationNumber: undefined,
      dataSnapshot: {
        ...record.dataSnapshot,
        paymentMade: 0,
        rowFields: {
          ...record.dataSnapshot.rowFields,
          invoice_number: nextNum,
          payment_status: 'Unpaid',
        },
      },
      updatedAt: new Date().toISOString(),
    };
    setGenerationHistory((prev) => [duplicated, ...prev]);
    setBanner({
      type: 'success',
      text: `Duplicated ${record.invoiceNumber} as new Unpaid invoice ${nextNum}.`,
    });
  };

  const openPaymentModal = (record: GenerationRecord) => {
    const currentStatus = resolveRecordPaymentStatus(record);
    const currentPaid = Number(record.paymentAmount ?? record.dataSnapshot?.paymentMade ?? 0);
    const rowFields = record.dataSnapshot?.rowFields || {};
    setPaymentModalRecord(record);
    setPaymentStatusInput(currentStatus);
    setAmountPaidInput(String(currentPaid));
    setPaymentMethodInput(rowFields['payment_method'] || 'Bank Transfer / NEFT');
    setPaymentDateInput(rowFields['payment_date'] || new Date().toISOString().split('T')[0]);
    setPaymentRefInput(rowFields['transaction_reference'] || '');
  };

  const handleSavePaymentUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalRecord) return;

    const total = Number(paymentModalRecord.totalAmount || 0);
    let paidAmt = parseFloat(amountPaidInput);
    if (!Number.isFinite(paidAmt) || paidAmt < 0) paidAmt = 0;

    if (paymentStatusInput === 'Paid') {
      paidAmt = total;
    } else if (paymentStatusInput === 'Unpaid') {
      paidAmt = 0;
    } else {
      if (paidAmt <= 0 || paidAmt >= total) {
        setBanner({
          type: 'error',
          text: 'For Partially Paid invoices, enter an amount greater than 0 and less than the invoice total.',
        });
        return;
      }
    }

    const roundedPaid = Math.round(paidAmt * 100) / 100;
    const balanceDue = Math.max(0, Math.round((total - roundedPaid) * 100) / 100);

    setGenerationHistory((prev) =>
      prev.map((rec) => {
        if (rec.id !== paymentModalRecord.id) return rec;
        return {
          ...rec,
          paymentStatus: paymentStatusInput,
          paymentAmount: roundedPaid,
          updatedAt: new Date().toISOString(),
          dataSnapshot: {
            ...rec.dataSnapshot,
            paymentMade: roundedPaid,
            rowFields: {
              ...rec.dataSnapshot.rowFields,
              payment_status: paymentStatusInput,
              payment_method: paymentMethodInput,
              payment_date: paymentDateInput,
              transaction_reference: paymentRefInput,
            },
          },
        };
      })
    );

    setBanner({
      type: 'success',
      text: `Updated ${paymentModalRecord.invoiceNumber} to ${paymentStatusInput} (Balance Due: ${formatCurrency(
        balanceDue,
        company.currency
      )}).`,
    });
    setPaymentModalRecord(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Invoice History & Payment Tracking</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track Unpaid, Partially Paid, and Paid invoices, download PDFs, duplicate records, or dispatch via Email Center.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              aria-label="Search invoices"
              placeholder="Search invoice #, customer, quotation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-slate-900 focus:ring-2 focus:ring-indigo-600 outline-none"
            />
          </div>

          <select
            aria-label="Filter by payment status"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="ALL">All Payment Statuses</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Paid">Paid</option>
          </select>

          {generationHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3.5 py-2 rounded-xl text-xs font-bold border border-rose-200 transition-all cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Banner */}
      {banner && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-2 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : banner.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          <span className="font-medium">{banner.text}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setBanner(null)}
            className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Payment Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Total Invoices
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{stats.total}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            Paid: {stats.paidCount} · Partial: {stats.partialCount} · Unpaid: {stats.unpaidCount}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Total Billed
          </p>
          <p className="text-lg font-bold text-slate-900 mt-1 font-mono tabular-nums truncate">
            {formatCurrency(stats.totalBilled, company.currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Gross invoiced amount</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            Payments Collected
          </p>
          <p className="text-lg font-bold text-emerald-700 mt-1 font-mono tabular-nums truncate">
            {formatCurrency(stats.totalCollected, company.currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Recorded receipts</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            Balance Due
          </p>
          <p className="text-lg font-bold text-amber-700 mt-1 font-mono tabular-nums truncate">
            {formatCurrency(stats.balanceDue, company.currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Outstanding receivables</p>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Source / Date</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-right">Balance Due</th>
                <th className="py-3 px-4 text-center">Payment Status</th>
                <th className="py-3 px-4 text-center">Email</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 px-4 text-center text-slate-500">
                    <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold text-slate-700">No invoices found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Create an invoice via Manual Entry, Batch Generation, or by converting an Approved Quotation.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredHistory.map((record) => {
                  const emailStatus = effectiveEmailStatuses[record.id];
                  const paymentStatus = resolveRecordPaymentStatus(record);
                  const paidAmt =
                    paymentStatus === 'Paid'
                      ? record.totalAmount
                      : Math.max(0, Number(record.paymentAmount ?? record.dataSnapshot?.paymentMade ?? 0));
                  const balanceDue = Math.max(0, record.totalAmount - paidAmt);

                  return (
                    <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top">
                        <p className="font-semibold text-slate-900 font-mono">
                          {record.invoiceNumber}
                        </p>
                        {record.sourceQuotationNumber && (
                          <p className="text-[11px] font-mono text-indigo-600 mt-0.5">
                            From {record.sourceQuotationNumber}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top text-slate-800 font-medium">
                        {record.customerName}
                      </td>
                      <td className="py-3 px-4 align-top">
                        <span className="inline-block bg-slate-100 px-2 py-0.5 rounded text-[11px] font-medium text-slate-700">
                          {record.worksheetName}
                        </span>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                          {record.generatedDate}
                        </p>
                      </td>
                      <td className="py-3 px-4 align-top text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatCurrency(record.totalAmount, company.currency)}
                      </td>
                      <td className="py-3 px-4 align-top text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                        <span className={balanceDue > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                          {formatCurrency(balanceDue, company.currency)}
                        </span>
                      </td>
                      <td className="py-3 px-4 align-top text-center">
                        <button
                          type="button"
                          onClick={() => openPaymentModal(record)}
                          title="Click to update payment status"
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-md border text-[11px] font-semibold cursor-pointer whitespace-nowrap ${
                            paymentStatus === 'Paid'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                              : paymentStatus === 'Partially Paid'
                                ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                          }`}
                        >
                          {paymentStatus === 'Paid' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <Clock className="w-3 h-3" />
                          )}
                          <span>{paymentStatus}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 align-top text-center">
                        {emailStatus === 'sent' && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                            <CheckCircle2 className="w-3 h-3 text-cyan-600" />
                            <span>Sent</span>
                          </span>
                        )}
                        {emailStatus === 'pending' && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Sending</span>
                          </span>
                        )}
                        {emailStatus === 'failed' && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertCircle className="w-3 h-3" />
                            <span>Failed</span>
                          </span>
                        )}
                        {!emailStatus && <span className="text-slate-400 text-[11px]">Not Sent</span>}
                      </td>
                      <td className="py-3 px-4 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            aria-label={`Update payment for ${record.invoiceNumber}`}
                            onClick={() => openPaymentModal(record)}
                            className="p-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                            title="Record / Update Payment"
                          >
                            <CreditCard className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Email ${record.invoiceNumber}`}
                            onClick={() => onSendByEmail?.(record.id)}
                            className="p-1.5 rounded-lg bg-cyan-50 text-cyan-700 hover:bg-cyan-100 transition-colors cursor-pointer"
                            title="Send Invoice via Email Center"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Download PDF ${record.invoiceNumber}`}
                            onClick={() => handleDownloadPDF(record)}
                            className="p-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer"
                            title="Download PDF"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Duplicate ${record.invoiceNumber}`}
                            onClick={() => handleDuplicateRecord(record)}
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                            title="Duplicate Invoice"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${record.invoiceNumber}`}
                            onClick={() => handleDeleteRecord(record)}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                            title="Delete Invoice"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Update Payment Modal */}
      {paymentModalRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Update Payment for ${paymentModalRecord.invoiceNumber}`}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Update Payment — {paymentModalRecord.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {paymentModalRecord.customerName} · Total:{' '}
                  <span className="font-mono font-bold">
                    {formatCurrency(paymentModalRecord.totalAmount, company.currency)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                aria-label="Close payment modal"
                onClick={() => setPaymentModalRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePaymentUpdate} className="space-y-3 text-xs">
              <div>
                <label htmlFor="payment-status-select" className="block font-semibold text-slate-700 mb-1">
                  Payment Status
                </label>
                <select
                  id="payment-status-select"
                  value={paymentStatusInput}
                  onChange={(e) => {
                    const next = e.target.value as PaymentStatusOption;
                    setPaymentStatusInput(next);
                    if (next === 'Paid') {
                      setAmountPaidInput(String(paymentModalRecord.totalAmount));
                    } else if (next === 'Unpaid') {
                      setAmountPaidInput('0');
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-semibold"
                >
                  <option value="Unpaid">Unpaid</option>
                  <option value="Partially Paid">Partially Paid</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>

              <div>
                <label htmlFor="payment-amount-input" className="block font-semibold text-slate-700 mb-1">
                  Amount Received
                </label>
                <input
                  id="payment-amount-input"
                  type="number"
                  min={0}
                  max={paymentModalRecord.totalAmount}
                  step="0.01"
                  disabled={paymentStatusInput !== 'Partially Paid'}
                  value={amountPaidInput}
                  onChange={(e) => setAmountPaidInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="payment-date-input" className="block font-semibold text-slate-700 mb-1">
                    Payment Date
                  </label>
                  <input
                    id="payment-date-input"
                    type="date"
                    value={paymentDateInput}
                    onChange={(e) => setPaymentDateInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="payment-method-input" className="block font-semibold text-slate-700 mb-1">
                    Payment Method
                  </label>
                  <input
                    id="payment-method-input"
                    type="text"
                    value={paymentMethodInput}
                    onChange={(e) => setPaymentMethodInput(e.target.value)}
                    placeholder="UPI / NEFT / Card"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="payment-ref-input" className="block font-semibold text-slate-700 mb-1">
                  Transaction / UTR Reference
                </label>
                <input
                  id="payment-ref-input"
                  type="text"
                  value={paymentRefInput}
                  onChange={(e) => setPaymentRefInput(e.target.value)}
                  placeholder="Optional payment reference"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPaymentModalRecord(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                >
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {confirmClearOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Clear invoice history"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">Clear All Invoice History?</h3>
            <p className="text-xs text-slate-600">
              This removes all {generationHistory.length} invoice record(s) from the active workspace.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearHistory}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
