/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CheckCircle2,
  Clock,
  CloudUpload,
  Copy,
  Download,
  Edit3,
  Eye,
  FileCheck2,
  FilePlus2,
  FileText,
  History,
  Mail,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  CompanySettings,
  CustomerRecord,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceTemplate,
  ManualInvoiceData,
  ManualInvoiceLineItem,
  QuotationData,
  QuotationRecord,
  QuotationStatus,
  SpreadsheetData,
} from '../types';
import { CURRENCY_CATALOG } from '../mockData';
import { formatCurrency } from '../utils/calculator';
import {
  COMMON_GST_RATES,
  createEmptyManualLineItem,
  generateNextInvoiceNumber,
  ITEM_UNITS,
} from '../utils/manualInvoice';
import {
  applyQuotationStatusTransition,
  buildQuotationSnapshot,
  computeQuotation,
  computeQuotationStats,
  convertApprovedQuotationToInvoice,
  createDefaultQuotationData,
  createQuotationRecord,
  generateNextQuotationNumber,
  getEffectiveQuotationStatus,
  resolveQuotationCurrency,
  validateQuotationData,
} from '../utils/quotation';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { InvoicePreviewSheet } from './InvoicePreviewSheet';
import { workspaceApi } from '../utils/workspaceApi';
import { GoogleAccountUser } from '../utils/googleSheets';

interface QuotationGeneratorViewProps {
  company: CompanySettings;
  template: InvoiceTemplate;
  fields: InvoiceFieldConfig[];
  customers: CustomerRecord[];
  quotations: QuotationRecord[];
  setQuotations: React.Dispatch<React.SetStateAction<QuotationRecord[]>>;
  generationHistory: GenerationRecord[];
  authUser: GoogleAccountUser | null;
  onConvertedToInvoice: (
    updatedQuotation: QuotationRecord,
    createdInvoice: GenerationRecord,
    manualInvoiceData: ManualInvoiceData
  ) => void;
  onEmailQuotation: (quotationId: string) => void;
  onNavigateTab: (tab: string) => void;
  spreadsheetData: SpreadsheetData;
}

const STATUS_BADGE_STYLES: Record<
  QuotationStatus,
  { bg: string; text: string; border: string }
> = {
  Draft: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
  },
  'Pending Approval': {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
  },
  Approved: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
  },
  'Not Approved': {
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
  },
  Expired: {
    bg: 'bg-orange-50',
    text: 'text-orange-800',
    border: 'border-orange-200',
  },
  'Converted to Invoice': {
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
  },
};

export const QuotationGeneratorView: React.FC<QuotationGeneratorViewProps> = ({
  company,
  template,
  fields,
  customers,
  quotations,
  setQuotations,
  generationHistory,
  authUser,
  onConvertedToInvoice,
  onEmailQuotation,
  onNavigateTab,
  spreadsheetData,
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [formData, setFormData] = useState<QuotationData>(() =>
    createDefaultQuotationData(company, quotations)
  );
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Filters & sorting for History table
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'amount_desc' | 'valid_until'>('newest');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Modals
  const [previewQuotation, setPreviewQuotation] = useState<QuotationRecord | null>(null);
  const [approvalModalTarget, setApprovalModalTarget] = useState<QuotationRecord | null>(null);
  const [approvalAction, setApprovalAction] = useState<QuotationStatus>('Approved');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [historyModalTarget, setHistoryModalTarget] = useState<QuotationRecord | null>(null);
  const [convertModalTarget, setConvertModalTarget] = useState<QuotationRecord | null>(null);
  const [deleteModalTarget, setDeleteModalTarget] = useState<QuotationRecord | null>(null);
  const [isUploadingDrive, setIsUploadingDrive] = useState(false);
  const [selectedImportRow, setSelectedImportRow] = useState(0);

  const actorName = authUser?.name || authUser?.email || company.authorizedPerson || 'Workspace User';
  const actorEmail = authUser?.email || company.email;

  const sourceWorksheet = spreadsheetData.worksheets.find((sheet) => sheet.name === spreadsheetData.activeSheetName) || spreadsheetData.worksheets[0];
  const sourceRows = sourceWorksheet?.rows || [];

  const handleImportSelectedSpreadsheetRow = () => {
    if (!sourceRows.length) {
      onNavigateTab('datasource');
      return;
    }
    const row = sourceRows[Math.min(selectedImportRow, sourceRows.length - 1)] || {};
    const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]));
    const read = (...aliases: string[]) => {
      for (const alias of aliases) {
        const value = normalized.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
      }
      return '';
    };
    const amount = (...aliases: string[]) => {
      const raw = read(...aliases).replace(/[₹$,\s]/g, '');
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const next = createDefaultQuotationData(company, quotations);
    const item = next.items[0] || {
      id: `item_${Date.now()}`, itemName: '', itemDescription: '', hsnSac: '',
      quantity: 1, unit: 'Nos', rate: 0, discount: 0, discountType: 'fixed' as const, gstPercentage: 0,
    };
    const description = read('Item Description', 'Description', 'Product', 'Service', 'Program Name', 'Particulars', 'Subject');
    item.itemName = description;
    item.itemDescription = description;
    item.hsnSac = read('HSN/SAC', 'HSN', 'SAC', 'HSN Code');
    item.quantity = amount('Quantity', 'Qty') || 1;
    item.unit = read('Unit', 'UOM') || item.unit || 'Nos';
    item.rate = amount('Rate', 'Unit Price', 'Price', 'Unit Rate', 'Amount');
    item.gstPercentage = amount('GST %', 'GST Rate', 'Tax %', 'Tax Rate') || next.defaultGstRate;
    setEditingQuotationId(null);
    setFormData({
      ...next,
      quotationDate: read('Quotation Date', 'Date', 'Invoice Date') || next.quotationDate,
      validUntilDate: read('Valid Until', 'Validity Date', 'Expiry Date') || next.validUntilDate,
      referenceNumber: read('Reference', 'Reference Number', 'PO Number'),
      subject: read('Subject', 'Description', 'Service', 'Program Name'),
      projectName: read('Project', 'Project Name', 'Program Name'),
      customerName: read('Customer Name', 'Client Name', 'Buyer Name', 'Customer', 'Participant Name', 'Name'),
      contactPerson: read('Contact Person', 'Contact'),
      customerEmail: read('Email', 'Customer Email', 'Client Email'),
      customerPhone: read('Phone', 'Mobile', 'Contact Number'),
      billingAddress: read('Billing Address', 'Address', 'Customer Address', 'Location'),
      customerCity: read('City'),
      customerState: read('State'),
      customerPostalCode: read('Postal Code', 'PIN', 'Pincode', 'ZIP'),
      customerCountry: read('Country') || next.customerCountry,
      customerGstin: read('GSTIN', 'GSTIN/UIN', 'Tax ID'),
      items: [item],
    });
    setValidationErrors({});
    setBanner({ type: 'info', text: `Loaded spreadsheet row ${Math.min(selectedImportRow, sourceRows.length - 1) + 1}. Review the mapped fields before saving.` });
    setViewMode('editor');
  };

  const stats = useMemo(() => computeQuotationStats(quotations), [quotations]);

  const liveCalc = useMemo(() => computeQuotation(formData, company), [formData, company]);

  const filteredQuotations = useMemo(() => {
    const qLower = searchTerm.trim().toLowerCase();
    const list = quotations.filter((q) => {
      const effectiveStatus = getEffectiveQuotationStatus(q);
      if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
      if (dateFrom && q.quotationDate < dateFrom) return false;
      if (dateTo && q.quotationDate > dateTo) return false;
      if (qLower) {
        const hay = `${q.quotationNumber} ${q.customerName} ${q.projectName || ''} ${q.salesperson || ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'amount_desc') return b.totalAmount - a.totalAmount;
      if (sortBy === 'valid_until') return a.validUntilDate.localeCompare(b.validUntilDate);
      return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
    });
  }, [quotations, searchTerm, statusFilter, dateFrom, dateTo, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredQuotations.length / pageSize));
  const paginatedQuotations = filteredQuotations.slice((page - 1) * pageSize, page * pageSize);

  const syncQuotationToCloud = async (record: QuotationRecord) => {
    if (!authUser?.userId) return;
    try {
      await workspaceApi.saveQuotation(record);
    } catch {
      // Local state remains saved; cloud sync retries on next Drive/Workspace sync
    }
  };

  const handleOpenCreateNew = () => {
    setEditingQuotationId(null);
    setFormData(createDefaultQuotationData(company, quotations));
    setValidationErrors({});
    setBanner(null);
    setViewMode('editor');
  };

  const handleOpenEdit = (q: QuotationRecord) => {
    if (q.status === 'Converted to Invoice') {
      setBanner({
        type: 'info',
        text: `Quotation ${q.quotationNumber} has already been converted to Invoice ${q.convertedInvoiceNumber} and is preserved as an immutable record.`,
      });
      return;
    }
    setEditingQuotationId(q.id);
    setFormData({ ...q.data, items: q.data.items.map((it) => ({ ...it })) });
    setValidationErrors({});
    setBanner(null);
    setViewMode('editor');
  };

  const handleDuplicate = (q: QuotationRecord) => {
    const nextNum = generateNextQuotationNumber(quotations);
    const today = new Date();
    const valid = new Date(today);
    valid.setDate(valid.getDate() + 15);

    const duplicatedData: QuotationData = {
      ...q.data,
      id: undefined,
      quotationNumber: nextNum,
      quotationDate: today.toISOString().split('T')[0],
      validUntilDate: valid.toISOString().split('T')[0],
      items: q.data.items.map((it, idx) => ({
        ...it,
        id: `item_${Date.now()}_${idx}`,
      })),
    };

    const duplicated = createQuotationRecord({
      data: duplicatedData,
      company,
      status: 'Draft',
      actorName,
      actorEmail,
      ownerUserId: authUser?.userId,
    });

    setQuotations((prev) => [duplicated, ...prev]);
    void syncQuotationToCloud(duplicated);
    setBanner({
      type: 'success',
      text: `Duplicated ${q.quotationNumber} into new Draft quotation ${duplicated.quotationNumber}.`,
    });
  };

  const handleSelectCustomer = (customerId: string) => {
    const found = customers.find((c) => c.id === customerId);
    if (!found) {
      setFormData((prev) => ({ ...prev, selectedCustomerId: undefined }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      selectedCustomerId: found.id,
      customerName: found.customerName,
      contactPerson: found.contactPerson || '',
      customerEmail: found.email || '',
      customerPhone: found.phone || '',
      billingAddress: found.billingAddress || '',
      customerCity: found.city || '',
      customerState: found.state || '',
      customerPostalCode: found.postalCode || '',
      customerCountry: found.country || company.country || 'India',
      customerGstin: found.gstin || '',
    }));
  };

  const handleAddLineItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyManualLineItem(prev.gstEnabled ? prev.defaultGstRate : 0)],
    }));
  };

  const handleUpdateLineItem = (
    idx: number,
    patch: Partial<ManualInvoiceLineItem>
  ) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  const handleRemoveLineItem = (idx: number) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== idx) : prev.items,
    }));
  };

  const handleMoveLineItem = (idx: number, direction: -1 | 1) => {
    setFormData((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.items.length) return prev;
      const copy = [...prev.items];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return { ...prev, items: copy };
    });
  };

  const handleSaveQuotation = (targetStatus: QuotationStatus) => {
    const validation = validateQuotationData(
      formData,
      quotations,
      editingQuotationId || undefined
    );
    setValidationErrors(validation.errors);
    if (!validation.isValid) {
      setBanner({
        type: 'error',
        text: validation.errorList[0] || 'Please fix the highlighted fields before saving.',
      });
      return;
    }

    const existing = editingQuotationId
      ? quotations.find((q) => q.id === editingQuotationId)
      : undefined;

    const record = createQuotationRecord({
      data: formData,
      company,
      status: targetStatus,
      actorName,
      actorEmail,
      ownerUserId: authUser?.userId,
      existingRecord: existing,
    });

    setQuotations((prev) => {
      const without = prev.filter((q) => q.id !== record.id);
      return [record, ...without];
    });
    void syncQuotationToCloud(record);

    setEditingQuotationId(record.id);
    setBanner({
      type: 'success',
      text: `Quotation ${record.quotationNumber} saved as ${record.status}.`,
    });
    setViewMode('list');
  };

  const handleDownloadPdf = (q: QuotationRecord) => {
    const snap = buildQuotationSnapshot(q.data, company, template);
    const pdf = generateInvoicePDF({
      company: snap.companyWithCurrency,
      items: snap.items,
      fields: snap.rowFields,
      template: snap.quotationTemplate || template,
      paymentMade: 0,
      discount: snap.additionalDiscountAmt,
      additionalCharges: snap.additionalCharges,
      roundOffOptions: {
        enabled: q.data.roundOffEnabled,
        manualRoundOff: q.data.manualRoundOffOverride,
      },
    });
    pdf.save(`Quotation-${q.quotationNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
  };

  const handleUploadPdfToDrive = async (q: QuotationRecord) => {
    if (!authUser?.driveConnected) {
      setBanner({
        type: 'info',
        text: 'Connect Google Drive in Account & Integrations to save generated PDFs to your Drive.',
      });
      return;
    }
    setIsUploadingDrive(true);
    try {
      const snap = buildQuotationSnapshot(q.data, company, template);
      const pdf = generateInvoicePDF({
        company: snap.companyWithCurrency,
        items: snap.items,
        fields: snap.rowFields,
        template: snap.quotationTemplate || template,
        paymentMade: 0,
        discount: snap.additionalDiscountAmt,
        additionalCharges: snap.additionalCharges,
        roundOffOptions: {
          enabled: q.data.roundOffEnabled,
          manualRoundOff: q.data.manualRoundOffOverride,
        },
      });
      const dataUri = pdf.output('datauristring');
      const fileName = `Quotation-${q.quotationNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      const uploaded = await workspaceApi.uploadPdfToDrive({
        documentType: 'quotation',
        documentId: q.id,
        fileName,
        pdfBase64: dataUri,
      });
      setQuotations((prev) =>
        prev.map((item) =>
          item.id === q.id ? { ...item, pdfDriveFileId: uploaded.driveFileId } : item
        )
      );
      setBanner({
        type: 'success',
        text: `Saved ${uploaded.fileName} to your Google Drive (Invoice Studio/Generated PDFs).`,
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err?.message || 'Failed to upload quotation PDF to Google Drive.',
      });
    } finally {
      setIsUploadingDrive(false);
    }
  };

  const handleOpenApprovalModal = (q: QuotationRecord, defaultAction: QuotationStatus = 'Approved') => {
    setApprovalModalTarget(q);
    setApprovalAction(defaultAction);
    setApprovalNotes('');
    setRejectionReason(q.rejectionReason || '');
  };

  const handleConfirmApprovalChange = async () => {
    if (!approvalModalTarget) return;
    if (approvalAction === 'Not Approved' && !rejectionReason.trim()) {
      setBanner({
        type: 'error',
        text: 'Please provide a rejection reason when marking a quotation as Not Approved.',
      });
      return;
    }
    try {
      const updated = applyQuotationStatusTransition({
        quotation: approvalModalTarget,
        nextStatus: approvalAction,
        actorName,
        actorEmail,
        notes: approvalNotes,
        rejectionReason: approvalAction === 'Not Approved' ? rejectionReason : undefined,
      });
      setQuotations((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
      if (authUser?.userId) {
        workspaceApi
          .updateQuotationStatus(updated.id, {
            status: approvalAction,
            notes: approvalNotes || undefined,
            rejectionReason: approvalAction === 'Not Approved' ? rejectionReason : undefined,
          })
          .catch(() => {});
      }
      setBanner({
        type: 'success',
        text: `Quotation ${updated.quotationNumber} marked as ${updated.status}.`,
      });
      setApprovalModalTarget(null);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Status update failed.' });
    }
  };

  const handleConfirmConversion = async () => {
    if (!convertModalTarget) return;
    try {
      const { updatedQuotation, createdInvoice, manualInvoiceData } =
        convertApprovedQuotationToInvoice({
          quotation: convertModalTarget,
          company,
          template,
          existingInvoices: generationHistory,
          fields,
          actorName,
          actorEmail,
        });

      if (authUser?.userId) {
        workspaceApi
          .convertQuotation(convertModalTarget.id, createdInvoice)
          .catch(() => {});
      }

      setConvertModalTarget(null);
      onConvertedToInvoice(updatedQuotation, createdInvoice, manualInvoiceData);
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err?.message || 'Unable to convert quotation to invoice.',
      });
      setConvertModalTarget(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalTarget) return;
    const id = deleteModalTarget.id;
    const num = deleteModalTarget.quotationNumber;
    setQuotations((prev) => prev.filter((q) => q.id !== id));
    if (authUser?.userId) {
      workspaceApi.deleteQuotation(id).catch(() => {});
    }
    setDeleteModalTarget(null);
    setBanner({ type: 'info', text: `Deleted quotation ${num}.` });
  };

  const nextInvoicePreviewNumber = useMemo(
    () => generateNextInvoiceNumber(generationHistory, fields),
    [generationHistory, fields]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center space-x-2.5">
            <FileCheck2 className="w-7 h-7 text-indigo-600 shrink-0" />
            <span>Quotation Generator</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Create client quotations, track approval status with audit history, export PDFs, and convert approved quotations into linked invoices.
          </p>
        </div>

        <div className="flex items-center space-x-2.5 shrink-0">
          {viewMode === 'editor' ? (
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
            >
              Back to Quotations ({quotations.length})
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {sourceRows.length > 0 && (
                <>
                  <select
                    aria-label="Select spreadsheet row for quotation"
                    value={selectedImportRow}
                    onChange={(event) => setSelectedImportRow(Number(event.target.value))}
                    className="max-w-[180px] px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-xs"
                  >
                    {sourceRows.map((_, index) => (
                      <option key={index} value={index}>Import row {index + 1}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleImportSelectedSpreadsheetRow}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-cyan-300 bg-cyan-50 text-cyan-800 text-xs font-bold hover:bg-cyan-100"
                  >
                    <CloudUpload className="w-4 h-4" />
                    Import Row
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onNavigateTab('datasource')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50"
              >
                <CloudUpload className="w-4 h-4" />
                Import Excel / Google Sheet
              </button>
              <button
                type="button"
                onClick={handleOpenCreateNew}
                className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
              >
                <FilePlus2 className="w-4 h-4" />
                <span>Manual Quotation</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Notification Banner */}
      {banner && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : banner.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          <div className="flex items-center space-x-2 font-medium">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : banner.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setBanner(null)}
            className="text-slate-500 hover:text-slate-900 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Statistics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Total Quotations
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{stats.total}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            Draft: {stats.draft} · Pending: {stats.pendingApproval}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            Approved
          </p>
          <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">{stats.approved}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Ready to convert</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
            Converted
          </p>
          <p className="text-2xl font-bold text-indigo-700 mt-1 tabular-nums">{stats.converted}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Linked to invoices</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">
            Not Approved / Exp
          </p>
          <p className="text-2xl font-bold text-rose-700 mt-1 tabular-nums">
            {stats.notApproved + stats.expired}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            Rejected: {stats.notApproved} · Exp: {stats.expired}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Total Quoted Value
          </p>
          <p className="text-lg font-bold text-slate-900 mt-1 font-mono tabular-nums truncate">
            {formatCurrency(stats.totalQuotedValue, company.currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">All proposals</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            Approved Pipeline
          </p>
          <p className="text-lg font-bold text-emerald-700 mt-1 font-mono tabular-nums truncate">
            {formatCurrency(stats.approvedValue, company.currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Approved + converted</p>
        </div>
      </div>

      {/* LIST & HISTORY MODE */}
      {viewMode === 'list' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-4 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Search quotations"
                placeholder="Search quotation #, customer, project..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <select
                aria-label="Filter by quotation status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full py-2 px-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Pending Approval">Pending Approval</option>
                <option value="Approved">Approved</option>
                <option value="Not Approved">Not Approved</option>
                <option value="Expired">Expired</option>
                <option value="Converted to Invoice">Converted to Invoice</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <input
                type="date"
                aria-label="Filter from quotation date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="w-full py-2 px-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="md:col-span-2">
              <input
                type="date"
                aria-label="Filter to quotation date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="w-full py-2 px-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="md:col-span-2">
              <select
                aria-label="Sort quotations"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full py-2 px-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="newest">Sort: Latest Updated</option>
                <option value="amount_desc">Sort: Highest Amount</option>
                <option value="valid_until">Sort: Expiry Date</option>
              </select>
            </div>
          </div>

          {/* Quotations Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Quotation #</th>
                    <th className="py-3 px-4">Customer & Project</th>
                    <th className="py-3 px-4">Dates</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {paginatedQuotations.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 px-4 text-center text-slate-500">
                        <FileText className="w-9 h-9 text-slate-300 mx-auto mb-2" />
                        <p className="font-semibold text-slate-700">No quotations found</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Create your first quotation to track client approvals and convert approved proposals into invoices.
                        </p>
                        <button
                          type="button"
                          onClick={handleOpenCreateNew}
                          className="mt-4 inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Create First Quotation</span>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    paginatedQuotations.map((q) => {
                      const effectiveStatus = getEffectiveQuotationStatus(q);
                      const badge = STATUS_BADGE_STYLES[effectiveStatus];
                      const qCurrency = resolveQuotationCurrency(q.currencyCode, company);
                      const canConvert =
                        q.status === 'Approved' && !q.convertedInvoiceId;

                      return (
                        <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 align-top">
                            <p className="font-mono font-bold text-slate-900">{q.quotationNumber}</p>
                            {q.convertedInvoiceNumber && (
                              <button
                                type="button"
                                onClick={() => onNavigateTab('history')}
                                className="mt-1 text-[11px] font-mono text-indigo-600 hover:underline block cursor-pointer"
                              >
                                Invoice: {q.convertedInvoiceNumber}
                              </button>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <p className="font-semibold text-slate-900">{q.customerName}</p>
                            {q.projectName && (
                              <p className="text-[11px] text-slate-500 mt-0.5">{q.projectName}</p>
                            )}
                            {q.customerEmail && (
                              <p className="text-[11px] text-slate-400 font-mono">{q.customerEmail}</p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top font-mono text-[11px] text-slate-600 tabular-nums">
                            <p>Issued: {q.quotationDate}</p>
                            <p className="text-slate-500">Valid: {q.validUntilDate}</p>
                          </td>
                          <td className="py-3.5 px-4 align-top text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatCurrency(q.totalAmount, qCurrency)}
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <span
                              className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-md border text-[11px] font-semibold whitespace-nowrap ${badge.bg} ${badge.text} ${badge.border}`}
                            >
                              {effectiveStatus === 'Approved' ||
                              effectiveStatus === 'Converted to Invoice' ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : effectiveStatus === 'Not Approved' ? (
                                <XCircle className="w-3.5 h-3.5" />
                              ) : (
                                <Clock className="w-3.5 h-3.5" />
                              )}
                              <span>{effectiveStatus}</span>
                            </span>
                            {q.rejectionReason && effectiveStatus === 'Not Approved' && (
                              <p className="text-[10px] text-rose-600 mt-1 max-w-[180px] truncate" title={q.rejectionReason}>
                                Reason: {q.rejectionReason}
                              </p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                aria-label={`Preview ${q.quotationNumber}`}
                                onClick={() => setPreviewQuotation(q)}
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold inline-flex items-center space-x-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Preview</span>
                              </button>

                              {q.status !== 'Converted to Invoice' && (
                                <button
                                  type="button"
                                  aria-label={`Edit ${q.quotationNumber}`}
                                  onClick={() => handleOpenEdit(q)}
                                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold inline-flex items-center space-x-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Edit</span>
                                </button>
                              )}

                              <button
                                type="button"
                                aria-label={`Download PDF ${q.quotationNumber}`}
                                onClick={() => handleDownloadPdf(q)}
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold inline-flex items-center space-x-1 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>PDF</span>
                              </button>

                              <button
                                type="button"
                                aria-label={`Email ${q.quotationNumber}`}
                                onClick={() => onEmailQuotation(q.id)}
                                className="px-2 py-1 rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 font-semibold inline-flex items-center space-x-1 cursor-pointer"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                <span>Email</span>
                              </button>

                              {q.status !== 'Converted to Invoice' && (
                                <button
                                  type="button"
                                  aria-label={`Update approval for ${q.quotationNumber}`}
                                  onClick={() =>
                                    handleOpenApprovalModal(
                                      q,
                                      q.status === 'Approved' ? 'Not Approved' : 'Approved'
                                    )
                                  }
                                  className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-semibold inline-flex items-center space-x-1 cursor-pointer"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Review</span>
                                </button>
                              )}

                              {q.status === 'Converted to Invoice' ? (
                                <button
                                  type="button"
                                  onClick={() => onNavigateTab('history')}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold inline-flex items-center space-x-1 cursor-pointer"
                                >
                                  <FileCheck2 className="w-3.5 h-3.5" />
                                  <span>View Invoice</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`Convert ${q.quotationNumber} to Invoice`}
                                  disabled={!canConvert}
                                  title={
                                    canConvert
                                      ? 'Convert this approved quotation into a linked invoice'
                                      : `Quotation must be Approved before converting (current: ${effectiveStatus})`
                                  }
                                  onClick={() => {
                                    if (canConvert) setConvertModalTarget(q);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg font-bold inline-flex items-center space-x-1 transition-colors ${
                                    canConvert
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                  }`}
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                  <span>Convert to Invoice</span>
                                </button>
                              )}

                              <button
                                type="button"
                                aria-label={`Duplicate ${q.quotationNumber}`}
                                onClick={() => handleDuplicate(q)}
                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                                title="Duplicate Quotation"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                aria-label={`Approval history for ${q.quotationNumber}`}
                                onClick={() => setHistoryModalTarget(q)}
                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                                title="Approval History"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>

                              {q.status !== 'Converted to Invoice' && (
                                <button
                                  type="button"
                                  aria-label={`Delete ${q.quotationNumber}`}
                                  onClick={() => setDeleteModalTarget(q)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                                  title="Delete Quotation"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Showing {(page - 1) * pageSize + 1}–
                  {Math.min(page * pageSize, filteredQuotations.length)} of{' '}
                  {filteredQuotations.length} quotations
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-40 cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="font-mono font-bold">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE / EDIT QUOTATION FORM */}
      {viewMode === 'editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 8 Columns: Structured Form */}
          <div className="lg:col-span-8 space-y-6">
            {/* 1. Quotation Details */}
            <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">1. Quotation Information</h2>
                <span className="text-[11px] text-slate-500">
                  {editingQuotationId ? 'Editing existing quotation' : 'New quotation'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <label htmlFor="qt-number" className="block font-semibold text-slate-700 mb-1">
                    Quotation Number *
                  </label>
                  <input
                    id="qt-number"
                    type="text"
                    value={formData.quotationNumber}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, quotationNumber: e.target.value }))
                    }
                    className={`w-full px-3 py-2 rounded-lg border font-mono ${
                      validationErrors.quotationNumber
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-300 bg-slate-50'
                    }`}
                  />
                  {validationErrors.quotationNumber && (
                    <p className="text-[11px] text-rose-600 mt-1">{validationErrors.quotationNumber}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="qt-date" className="block font-semibold text-slate-700 mb-1">
                    Quotation Date *
                  </label>
                  <input
                    id="qt-date"
                    type="date"
                    value={formData.quotationDate}
                    onChange={(e) => setFormData((p) => ({ ...p, quotationDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="qt-valid-until" className="block font-semibold text-slate-700 mb-1">
                    Valid Until Date *
                  </label>
                  <input
                    id="qt-valid-until"
                    type="date"
                    value={formData.validUntilDate}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, validUntilDate: e.target.value }))
                    }
                    className={`w-full px-3 py-2 rounded-lg border font-mono ${
                      validationErrors.validUntilDate
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-300 bg-slate-50'
                    }`}
                  />
                  {validationErrors.validUntilDate && (
                    <p className="text-[11px] text-rose-600 mt-1">{validationErrors.validUntilDate}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="qt-currency" className="block font-semibold text-slate-700 mb-1">
                    Currency
                  </label>
                  <select
                    id="qt-currency"
                    value={formData.currencyCode}
                    onChange={(e) => setFormData((p) => ({ ...p, currencyCode: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  >
                    {CURRENCY_CATALOG.map((c) => (
                      <option key={c.currencyCode} value={c.currencyCode}>
                        {c.currencyCode} ({c.symbol}) — {c.currencyName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="qt-project" className="block font-semibold text-slate-700 mb-1">
                    Project Name
                  </label>
                  <input
                    id="qt-project"
                    type="text"
                    placeholder="e.g. Cloud ERP Implementation"
                    value={formData.projectName}
                    onChange={(e) => setFormData((p) => ({ ...p, projectName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-salesperson" className="block font-semibold text-slate-700 mb-1">
                    Salesperson / Owner
                  </label>
                  <input
                    id="qt-salesperson"
                    type="text"
                    value={formData.salesperson}
                    onChange={(e) => setFormData((p) => ({ ...p, salesperson: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="qt-subject" className="block font-semibold text-slate-700 mb-1">
                    Subject / Proposal Title
                  </label>
                  <input
                    id="qt-subject"
                    type="text"
                    placeholder="Commercial quotation for annual software & support services"
                    value={formData.subject}
                    onChange={(e) => setFormData((p) => ({ ...p, subject: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-ref" className="block font-semibold text-slate-700 mb-1">
                    Reference No
                  </label>
                  <input
                    id="qt-ref"
                    type="text"
                    placeholder="RFP-2026-09"
                    value={formData.referenceNumber}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, referenceNumber: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>
              </div>
            </section>

            {/* 2. Customer Information */}
            <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">2. Customer Details</h2>
                <div className="flex items-center space-x-2">
                  <label htmlFor="qt-customer-select" className="text-[11px] font-semibold text-slate-500">
                    Load Saved Customer:
                  </label>
                  <select
                    id="qt-customer-select"
                    value={formData.selectedCustomerId || ''}
                    onChange={(e) => handleSelectCustomer(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="">— Enter manually —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.customerName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="sm:col-span-2">
                  <label htmlFor="qt-cust-name" className="block font-semibold text-slate-700 mb-1">
                    Customer / Company Name *
                  </label>
                  <input
                    id="qt-cust-name"
                    type="text"
                    value={formData.customerName}
                    onChange={(e) => setFormData((p) => ({ ...p, customerName: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      validationErrors.customerName
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-300 bg-slate-50'
                    }`}
                  />
                  {validationErrors.customerName && (
                    <p className="text-[11px] text-rose-600 mt-1">{validationErrors.customerName}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="qt-cust-contact" className="block font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    id="qt-cust-contact"
                    type="text"
                    value={formData.contactPerson}
                    onChange={(e) => setFormData((p) => ({ ...p, contactPerson: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-cust-email" className="block font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    id="qt-cust-email"
                    type="email"
                    value={formData.customerEmail}
                    onChange={(e) => setFormData((p) => ({ ...p, customerEmail: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      validationErrors.customerEmail
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-300 bg-slate-50'
                    }`}
                  />
                  {validationErrors.customerEmail && (
                    <p className="text-[11px] text-rose-600 mt-1">{validationErrors.customerEmail}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="qt-cust-phone" className="block font-semibold text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    id="qt-cust-phone"
                    type="text"
                    value={formData.customerPhone}
                    onChange={(e) => setFormData((p) => ({ ...p, customerPhone: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-cust-gstin" className="block font-semibold text-slate-700 mb-1">
                    Tax ID / GSTIN
                  </label>
                  <input
                    id="qt-cust-gstin"
                    type="text"
                    value={formData.customerGstin}
                    onChange={(e) => setFormData((p) => ({ ...p, customerGstin: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label htmlFor="qt-cust-addr" className="block font-semibold text-slate-700 mb-1">
                    Street / Billing Address
                  </label>
                  <input
                    id="qt-cust-addr"
                    type="text"
                    value={formData.billingAddress}
                    onChange={(e) => setFormData((p) => ({ ...p, billingAddress: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-cust-city" className="block font-semibold text-slate-700 mb-1">
                    City
                  </label>
                  <input
                    id="qt-cust-city"
                    type="text"
                    value={formData.customerCity}
                    onChange={(e) => setFormData((p) => ({ ...p, customerCity: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-cust-state" className="block font-semibold text-slate-700 mb-1">
                    State / Province
                  </label>
                  <input
                    id="qt-cust-state"
                    type="text"
                    value={formData.customerState}
                    onChange={(e) => setFormData((p) => ({ ...p, customerState: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label htmlFor="qt-cust-country" className="block font-semibold text-slate-700 mb-1">
                    Country
                  </label>
                  <input
                    id="qt-cust-country"
                    type="text"
                    value={formData.customerCountry}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, customerCountry: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
              </div>
            </section>

            {/* 3. Line Items */}
            <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">
                  3. Quoted Line Items ({formData.items.length})
                </h2>
                <button
                  type="button"
                  onClick={handleAddLineItem}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Item</span>
                </button>
              </div>

              <div className="space-y-3">
                {formData.items.map((item, idx) => {
                  const calcItem = liveCalc.items[idx];
                  return (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700">Item #{idx + 1}</span>
                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            aria-label={`Move item ${idx + 1} up`}
                            disabled={idx === 0}
                            onClick={() => handleMoveLineItem(idx, -1)}
                            className="p-1 rounded text-slate-500 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move item ${idx + 1} down`}
                            disabled={idx === formData.items.length - 1}
                            onClick={() => handleMoveLineItem(idx, 1)}
                            className="p-1 rounded text-slate-500 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove item ${idx + 1}`}
                            disabled={formData.items.length <= 1}
                            onClick={() => handleRemoveLineItem(idx)}
                            className="p-1 rounded text-rose-500 hover:bg-rose-100 disabled:opacity-30 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                        <div className="sm:col-span-5">
                          <label className="block font-semibold text-slate-600 mb-1">
                            Item Name *
                          </label>
                          <input
                            type="text"
                            placeholder="Product or service name"
                            value={item.itemName}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, { itemName: e.target.value })
                            }
                            className={`w-full px-2.5 py-1.5 rounded-lg border bg-white ${
                              validationErrors[`item_${idx}_name`]
                                ? 'border-rose-400'
                                : 'border-slate-300'
                            }`}
                          />
                        </div>

                        <div className="sm:col-span-4">
                          <label className="block font-semibold text-slate-600 mb-1">
                            Description
                          </label>
                          <input
                            type="text"
                            placeholder="Optional deliverable details"
                            value={item.itemDescription}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, { itemDescription: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block font-semibold text-slate-600 mb-1">
                            HSN / SAC
                          </label>
                          <input
                            type="text"
                            placeholder="998314"
                            value={item.hsnSac}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, { hsnSac: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-semibold text-slate-600 mb-1">Qty</label>
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, {
                                quantity: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-semibold text-slate-600 mb-1">Unit</label>
                          <select
                            value={item.unit}
                            onChange={(e) => handleUpdateLineItem(idx, { unit: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white"
                          >
                            {ITEM_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-semibold text-slate-600 mb-1">
                            Unit Price
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={item.rate}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, {
                                rate: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-semibold text-slate-600 mb-1">
                            Discount
                          </label>
                          <div className="flex">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={item.discount}
                              onChange={(e) =>
                                handleUpdateLineItem(idx, {
                                  discount: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-2 py-1.5 rounded-l-lg border border-slate-300 bg-white font-mono tabular-nums"
                            />
                            <select
                              aria-label={`Discount type for item ${idx + 1}`}
                              value={item.discountType}
                              onChange={(e) =>
                                handleUpdateLineItem(idx, {
                                  discountType: e.target.value as 'fixed' | 'percentage',
                                })
                              }
                              className="px-1.5 py-1.5 rounded-r-lg border border-l-0 border-slate-300 bg-slate-100 text-[11px]"
                            >
                              <option value="fixed">Flat</option>
                              <option value="percentage">%</option>
                            </select>
                          </div>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-semibold text-slate-600 mb-1">
                            Tax / GST %
                          </label>
                          <select
                            disabled={!formData.gstEnabled}
                            value={item.gstPercentage}
                            onChange={(e) =>
                              handleUpdateLineItem(idx, {
                                gstPercentage: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white font-mono disabled:opacity-50"
                          >
                            {COMMON_GST_RATES.map((r) => (
                              <option key={r} value={r}>
                                {r}%
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2 flex flex-col justify-end text-right">
                          <span className="text-[10px] uppercase text-slate-400 font-semibold">
                            Line Total
                          </span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums py-1.5">
                            {formatCurrency(calcItem?.itemTotal || 0, liveCalc.currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 4. Tax, Discounts & Terms */}
            <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 text-xs">
              <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                4. Tax Settings, Terms & Conditions
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.gstEnabled}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, gstEnabled: e.target.checked }))
                    }
                  />
                  <span className="font-semibold text-slate-800">Enable Tax / GST</span>
                </label>

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Tax Type</label>
                  <select
                    disabled={!formData.gstEnabled}
                    value={formData.transactionType}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        transactionType: e.target.value as 'IGST' | 'CGST_SGST' | 'NONE',
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  >
                    <option value="IGST">IGST (Inter-state)</option>
                    <option value="CGST_SGST">CGST + SGST (Intra-state)</option>
                    <option value="NONE">No Tax</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">
                    Extra Discount ({formData.additionalDiscountType === 'percentage' ? '%' : 'Flat'})
                  </label>
                  <div className="flex">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={formData.additionalDiscount}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          additionalDiscount: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-2.5 py-2 rounded-l-lg border border-slate-300 bg-slate-50 font-mono"
                    />
                    <select
                      aria-label="Additional discount type"
                      value={formData.additionalDiscountType}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          additionalDiscountType: e.target.value as 'fixed' | 'percentage',
                        }))
                      }
                      className="px-2 py-2 rounded-r-lg border border-l-0 border-slate-300 bg-slate-100"
                    >
                      <option value="fixed">Flat</option>
                      <option value="percentage">%</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">
                    Additional Charges
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={formData.additionalCharges}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        additionalCharges: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Payment Terms</label>
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData((p) => ({ ...p, paymentTerms: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Delivery Terms</label>
                  <input
                    type="text"
                    value={formData.deliveryTerms}
                    onChange={(e) => setFormData((p) => ({ ...p, deliveryTerms: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-600 mb-1">
                    Validity Conditions
                  </label>
                  <input
                    type="text"
                    value={formData.validityConditions}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, validityConditions: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Notes</label>
                  <textarea
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">
                    Terms & Conditions
                  </label>
                  <textarea
                    rows={3}
                    value={formData.terms}
                    onChange={(e) => setFormData((p) => ({ ...p, terms: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
              </div>

              <label className="inline-flex items-center space-x-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={formData.includeBankDetails}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, includeBankDetails: e.target.checked }))
                  }
                />
                <span className="font-semibold text-slate-700">
                  Include Company Bank Details on Quotation PDF
                </span>
              </label>
            </section>
          </div>

          {/* Right 4 Columns: Live Summary & Primary Actions */}
          <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                Live Quotation Summary
              </h3>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {formatCurrency(liveCalc.summary.subtotal, liveCalc.currency)}
                  </span>
                </div>
                {liveCalc.summary.totalTax > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Total Tax / GST</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      {formatCurrency(liveCalc.summary.totalTax, liveCalc.currency)}
                    </span>
                  </div>
                )}
                {liveCalc.summary.totalDiscount > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Total Discount</span>
                    <span className="font-mono tabular-nums">
                      - {formatCurrency(liveCalc.summary.totalDiscount, liveCalc.currency)}
                    </span>
                  </div>
                )}
                {formData.additionalCharges > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Additional Charges</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {formatCurrency(formData.additionalCharges, liveCalc.currency)}
                    </span>
                  </div>
                )}
                <div className="border-t border-slate-200 pt-3 flex justify-between items-baseline">
                  <span className="font-bold text-slate-900 text-sm">Grand Total</span>
                  <span className="font-mono font-extrabold text-indigo-700 text-lg tabular-nums">
                    {formatCurrency(liveCalc.summary.totalInvoiceAmount, liveCalc.currency)}
                  </span>
                </div>
                <p className="text-[11px] italic text-slate-500 pt-1">
                  {liveCalc.summary.amountInWords}
                </p>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleSaveQuotation('Pending Approval')}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Save & Submit for Approval</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSaveQuotation('Draft')}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>Save as Draft</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const temp = createQuotationRecord({
                      data: formData,
                      company,
                      status: 'Draft',
                      actorName,
                      actorEmail,
                    });
                    setPreviewQuotation(temp);
                  }}
                  className="w-full py-2 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold inline-flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>Preview Quotation Sheet</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* QUOTATION PREVIEW MODAL */}
      {previewQuotation && (() => {
        const snap = buildQuotationSnapshot(previewQuotation.data, company, template);
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview Quotation ${previewQuotation.quotationNumber}`}
            className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto"
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Quotation Preview — {previewQuotation.quotationNumber}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Status: {getEffectiveQuotationStatus(previewQuotation)} · Customer:{' '}
                    {previewQuotation.customerName}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(previewQuotation)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>
                  {authUser?.driveConnected && (
                    <button
                      type="button"
                      disabled={isUploadingDrive}
                      onClick={() => void handleUploadPdfToDrive(previewQuotation)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer"
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                      <span>{isUploadingDrive ? 'Uploading...' : 'Save PDF to Drive'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Close quotation preview"
                    onClick={() => setPreviewQuotation(null)}
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-auto bg-slate-100 flex-1">
                <InvoicePreviewSheet
                  company={snap.companyWithCurrency}
                  template={snap.quotationTemplate || template}
                  rowFields={snap.rowFields}
                  items={snap.items}
                  summary={snap.summary}
                  compactScale
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* APPROVAL / REJECTION MODAL */}
      {approvalModalTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Review Quotation ${approvalModalTarget.quotationNumber}`}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                Update Approval Status — {approvalModalTarget.quotationNumber}
              </h3>
              <button
                type="button"
                aria-label="Close review modal"
                onClick={() => setApprovalModalTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="approval-status-select" className="block font-semibold text-slate-700 mb-1">
                  New Status
                </label>
                <select
                  id="approval-status-select"
                  value={approvalAction}
                  onChange={(e) => setApprovalAction(e.target.value as QuotationStatus)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-semibold"
                >
                  <option value="Approved">Approved (Enables Invoice Conversion)</option>
                  <option value="Not Approved">Not Approved (Rejected)</option>
                  <option value="Pending Approval">Pending Approval</option>
                  <option value="Draft">Draft</option>
                  <option value="Expired">Expired</option>
                </select>
              </div>

              {approvalAction === 'Not Approved' ? (
                <div>
                  <label htmlFor="rejection-reason" className="block font-semibold text-rose-700 mb-1">
                    Rejection Reason *
                  </label>
                  <textarea
                    id="rejection-reason"
                    rows={3}
                    placeholder="Explain why this quotation was not approved..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-rose-300 bg-rose-50/40"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="approval-notes" className="block font-semibold text-slate-700 mb-1">
                    Approval / Review Notes (Optional)
                  </label>
                  <textarea
                    id="approval-notes"
                    rows={3}
                    placeholder="Client signed off via email, PO expected next week..."
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Recorded as: <span className="font-semibold text-slate-700">{actorName}</span>
              </p>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setApprovalModalTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmApprovalChange()}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirm Status Change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPROVAL HISTORY MODAL */}
      {historyModalTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Approval History for ${historyModalTarget.quotationNumber}`}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                Status & Approval History — {historyModalTarget.quotationNumber}
              </h3>
              <button
                type="button"
                aria-label="Close history modal"
                onClick={() => setHistoryModalTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {(historyModalTarget.approvalHistory || []).length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No status events recorded yet.</p>
              ) : (
                historyModalTarget.approvalHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        {entry.previousStatus
                          ? `${entry.previousStatus} → ${entry.status}`
                          : entry.status}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      By: <span className="font-semibold">{entry.actorName}</span>
                      {entry.actorEmail ? ` (${entry.actorEmail})` : ''}
                    </p>
                    {entry.notes && <p className="text-slate-700">Note: {entry.notes}</p>}
                    {entry.rejectionReason && (
                      <p className="text-rose-700 font-medium">
                        Rejection Reason: {entry.rejectionReason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONVERT APPROVED QUOTATION TO INVOICE CONFIRMATION MODAL */}
      {convertModalTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Convert ${convertModalTarget.quotationNumber} to Invoice`}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <ArrowRightLeft className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Convert Approved Quotation to Invoice
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Confirm creating a new linked invoice from this approved proposal.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Source Quotation:</span>
                <span className="font-mono font-bold text-slate-900">
                  {convertModalTarget.quotationNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">New Invoice Number:</span>
                <span className="font-mono font-bold text-indigo-700">
                  {nextInvoicePreviewNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-900">
                  {convertModalTarget.customerName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Line Items:</span>
                <span className="font-mono font-semibold text-slate-900">
                  {convertModalTarget.data.items.length}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="font-bold text-slate-700">Total Amount:</span>
                <span className="font-mono font-bold text-emerald-700 tabular-nums">
                  {formatCurrency(
                    convertModalTarget.totalAmount,
                    resolveQuotationCurrency(convertModalTarget.currencyCode, company)
                  )}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                The original quotation will be locked as <strong>Converted to Invoice</strong> and preserved intact. The new invoice will start as <strong>Unpaid</strong> and open in Manual Entry for optional final review.
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setConvertModalTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmConversion()}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirm & Create Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteModalTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Delete Quotation ${deleteModalTarget.quotationNumber}`}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">
              Delete Quotation {deleteModalTarget.quotationNumber}?
            </h3>
            <p className="text-xs text-slate-600">
              This will permanently remove quotation <strong>{deleteModalTarget.quotationNumber}</strong> for{' '}
              <strong>{deleteModalTarget.customerName}</strong>.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setDeleteModalTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Delete Quotation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
