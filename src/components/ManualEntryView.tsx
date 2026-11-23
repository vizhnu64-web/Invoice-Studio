/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookMarked,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  History,
  Info,
  Mail,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  StickyNote,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  CompanySettings,
  CustomerRecord,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceTemplate,
  ManualInvoiceData,
  ManualInvoiceDraft,
  ManualInvoiceLineItem,
} from '../types';
import { formatCurrency } from '../utils/calculator';
import {
  COMMON_GST_RATES,
  INVOICE_TYPES,
  ITEM_UNITS,
  SUPPORTED_PAYMENT_METHODS,
  buildManualInvoiceSnapshot,
  computeManualInvoice,
  convertManualInvoiceToGenerationRecord,
  createDefaultManualInvoice,
  createEmptyManualLineItem,
  extractCustomerFromManualInvoice,
  generateNextInvoiceNumber,
  isDuplicateInvoiceNumber,
  validateManualInvoice,
} from '../utils/manualInvoice';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { googleTokenManager } from '../utils/googleAuth';
import { storage } from '../utils/storage';
import { workspaceApi } from '../utils/workspaceApi';
import { InvoicePreviewSheet } from './InvoicePreviewSheet';

interface ManualEntryViewProps {
  company: CompanySettings;
  fields: InvoiceFieldConfig[];
  template: InvoiceTemplate;
  generationHistory: GenerationRecord[];
  setGenerationHistory: React.Dispatch<React.SetStateAction<GenerationRecord[]>>;
  customers?: CustomerRecord[];
  onSaveCustomer?: (customer: CustomerRecord) => Promise<void> | void;
  onNavigateTab: (tab: string) => void;
  onSendByEmail: (recordId: string) => void;
  incomingConvertedInvoice?: ManualInvoiceData | null;
  onConsumeIncomingInvoice?: () => void;
  onInvoiceSaved?: (record: GenerationRecord) => void;
}

type SectionKey =
  | 'invoice_info'
  | 'customer_info'
  | 'items'
  | 'tax_settings'
  | 'payment_info'
  | 'notes_terms'
  | 'review';

const SECTIONS: { key: SectionKey; number: number; label: string }[] = [
  { key: 'invoice_info', number: 1, label: 'Invoice Info' },
  { key: 'customer_info', number: 2, label: 'Customer' },
  { key: 'items', number: 3, label: 'Line Items' },
  { key: 'tax_settings', number: 4, label: 'Tax & Calc' },
  { key: 'payment_info', number: 5, label: 'Payment' },
  { key: 'notes_terms', number: 6, label: 'Notes & Terms' },
  { key: 'review', number: 7, label: 'Review & Generate' },
];

export const ManualEntryView: React.FC<ManualEntryViewProps> = ({
  company,
  fields,
  template,
  generationHistory,
  setGenerationHistory,
  customers: externalCustomers,
  onSaveCustomer,
  onNavigateTab,
  onSendByEmail,
  incomingConvertedInvoice,
  onConsumeIncomingInvoice,
  onInvoiceSaved,
}) => {
  const [formData, setFormData] = useState<ManualInvoiceData>(() => {
    const savedWorking = storage.loadActiveManualForm();
    if (savedWorking) {
      // Refresh invoice number if auto-numbering is enabled and current number became a duplicate
      if (
        savedWorking.autoNumbering &&
        isDuplicateInvoiceNumber(savedWorking.invoiceNumber, generationHistory)
      ) {
        return {
          ...savedWorking,
          invoiceNumber: generateNextInvoiceNumber(generationHistory, fields),
        };
      }
      return savedWorking;
    }
    return createDefaultManualInvoice(company, fields, generationHistory);
  });

  const [localCustomers, setLocalCustomers] = useState<CustomerRecord[]>(() =>
    externalCustomers ?? storage.loadCustomers()
  );
  const customers = externalCustomers ?? localCustomers;
  const [drafts, setDrafts] = useState<ManualInvoiceDraft[]>(() => storage.loadManualDrafts());
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const [expandedSections, setExpandedSections] = useState<Record<SectionKey, boolean>>({
    invoice_info: true,
    customer_info: true,
    items: true,
    tax_settings: true,
    payment_info: true,
    notes_terms: true,
    review: true,
  });

  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedRecord, setGeneratedRecord] = useState<GenerationRecord | null>(null);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Modals (never use window.alert / window.confirm)
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [draftTitleInput, setDraftTitleInput] = useState('');
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);

  // Persist active working form to localStorage automatically
  useEffect(() => {
    storage.saveActiveManualForm(formData);
  }, [formData]);

  // Hydrate invoice converted from an Approved Quotation
  useEffect(() => {
    if (!incomingConvertedInvoice) return;
    setFormData(incomingConvertedInvoice);
    const matched = generationHistory.find(
      (r) =>
        (incomingConvertedInvoice.id && r.id === incomingConvertedInvoice.id) ||
        r.invoiceNumber === incomingConvertedInvoice.invoiceNumber
    );
    setGeneratedRecord(matched || null);
    setActiveDraftId(null);
    setShowValidationErrors(false);
    setNotification({
      type: 'success',
      text: incomingConvertedInvoice.sourceQuotationNumber
        ? `Invoice #${incomingConvertedInvoice.invoiceNumber} created from Approved Quotation ${incomingConvertedInvoice.sourceQuotationNumber} (Status: Unpaid). You can review, edit, download PDF, or email it now.`
        : `Loaded Invoice #${incomingConvertedInvoice.invoiceNumber} for editing.`,
    });
    onConsumeIncomingInvoice?.();
  }, [incomingConvertedInvoice, generationHistory, onConsumeIncomingInvoice]);

  // Real-time invoice computation & validation
  const snapshot = useMemo(
    () => buildManualInvoiceSnapshot(formData, company, template),
    [formData, company, template]
  );

  const validation = useMemo(
    () => validateManualInvoice(formData, generationHistory, generatedRecord?.id),
    [formData, generationHistory, generatedRecord]
  );

  const isDuplicateNumber = useMemo(
    () => isDuplicateInvoiceNumber(formData.invoiceNumber, generationHistory, generatedRecord?.id),
    [formData.invoiceNumber, generationHistory, generatedRecord]
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        (c.contactPerson || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.gstin || '').toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const activeBank =
    company.bankAccounts.find((b) => b.id === company.activeBankId) ||
    company.bankAccounts.find((b) => b.isDefault) ||
    company.bankAccounts[0];

  const updateField = <K extends keyof ManualInvoiceData>(key: K, value: ManualInvoiceData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (generatedRecord && key === 'invoiceNumber') {
      setGeneratedRecord(null);
    }
  };

  const toggleSection = (key: SectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const scrollToSection = (key: SectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [key]: true }));
    const el = document.getElementById(`manual-section-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // --- Customer Directory Handlers ---
  const handleSelectCustomer = (customer: CustomerRecord) => {
    setFormData((prev) => ({
      ...prev,
      selectedCustomerId: customer.id,
      customerName: customer.customerName,
      contactPerson: customer.contactPerson || '',
      customerEmail: customer.email || '',
      customerPhone: customer.phone || '',
      billingAddress: customer.billingAddress || '',
      shippingAddress: customer.shippingAddress || '',
      sameAsBilling:
        !customer.shippingAddress || customer.shippingAddress === customer.billingAddress,
      customerCity: customer.city || '',
      customerState: customer.state || '',
      customerPostalCode: customer.postalCode || '',
      customerCountry: customer.country || company.country || 'India',
      customerGstin: customer.gstin || '',
      customerPan: customer.pan || '',
      customerReferenceNumber: customer.referenceNumber || '',
    }));
    setShowCustomerDropdown(false);
    setCustomerSearch('');
    setNotification({
      type: 'info',
      text: `Loaded customer "${customer.customerName}" into invoice form.`,
    });
  };

  const handleSaveCustomerToDirectory = () => {
    if (!formData.customerName.trim()) {
      setNotification({
        type: 'error',
        text: 'Enter a Customer / Company Name before saving to the directory.',
      });
      return;
    }
    const existingMatch = customers.find(
      (c) =>
        c.id === formData.selectedCustomerId ||
        c.customerName.trim().toLowerCase() === formData.customerName.trim().toLowerCase()
    );
    const customerObj = extractCustomerFromManualInvoice(formData, existingMatch?.id);
    if (onSaveCustomer) {
      void onSaveCustomer(customerObj);
    } else {
      storage.saveCustomer(customerObj);
      setLocalCustomers(storage.loadCustomers());
    }
    setFormData((prev) => ({ ...prev, selectedCustomerId: customerObj.id }));
    setNotification({
      type: 'success',
      text: existingMatch
        ? `Updated customer "${customerObj.customerName}" in Customer Directory.`
        : `Saved "${customerObj.customerName}" to Customer Directory.`,
    });
  };

  // --- Line Item Handlers ---
  const handleAddItem = () => {
    const newItem = createEmptyManualLineItem(
      formData.gstEnabled ? formData.defaultGstRate : 0
    );
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
    }));
  };

  const handleUpdateItem = (
    itemId: string,
    patch: Partial<ManualInvoiceLineItem>
  ) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }));
  };

  const handleDuplicateItem = (index: number) => {
    const source = formData.items[index];
    if (!source) return;
    const copy: ManualInvoiceLineItem = {
      ...source,
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
    const next = [...formData.items];
    next.splice(index + 1, 0, copy);
    setFormData((prev) => ({ ...prev, items: next }));
  };

  const handleRemoveItem = (index: number) => {
    if (formData.items.length <= 1) {
      setNotification({
        type: 'info',
        text: 'An invoice must contain at least one line item.',
      });
      return;
    }
    const next = formData.items.filter((_, idx) => idx !== index);
    setFormData((prev) => ({ ...prev, items: next }));
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= formData.items.length) return;
    const next = [...formData.items];
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    setFormData((prev) => ({ ...prev, items: next }));
  };

  const handleApplyDefaultGstToAll = () => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) => ({
        ...item,
        gstPercentage: prev.gstEnabled ? prev.defaultGstRate : 0,
      })),
    }));
    setNotification({
      type: 'info',
      text: `Applied ${formData.gstEnabled ? formData.defaultGstRate : 0}% GST to all ${formData.items.length} line items.`,
    });
  };

  // --- Draft Handlers ---
  const openSaveDraftDialog = () => {
    const defaultTitle =
      formData.customerName.trim()
        ? `${formData.invoiceNumber || 'Draft'} — ${formData.customerName.trim()}`
        : `${formData.invoiceNumber || 'Untitled Draft'}`;
    setDraftTitleInput(defaultTitle);
    setShowSaveDraftModal(true);
  };

  const handleConfirmSaveDraft = () => {
    const draftId = activeDraftId || `draft_${Date.now()}`;
    const draft: ManualInvoiceDraft = {
      id: draftId,
      title: draftTitleInput.trim() || `${formData.invoiceNumber || 'Manual Draft'}`,
      data: formData,
      updatedAt: new Date().toISOString(),
    };
    storage.saveManualDraft(draft);
    setDrafts(storage.loadManualDrafts());
    setActiveDraftId(draftId);
    setShowSaveDraftModal(false);
    setNotification({
      type: 'success',
      text: `Saved draft "${draft.title}". You can resume editing it anytime.`,
    });
  };

  const handleLoadDraft = (draft: ManualInvoiceDraft) => {
    setFormData(draft.data);
    setActiveDraftId(draft.id);
    setGeneratedRecord(null);
    setShowValidationErrors(false);
    setShowDraftsModal(false);
    setNotification({
      type: 'info',
      text: `Loaded draft "${draft.title}".`,
    });
  };

  const handleDeleteDraft = (draftId: string) => {
    storage.deleteManualDraft(draftId);
    setDrafts(storage.loadManualDrafts());
    if (activeDraftId === draftId) setActiveDraftId(null);
  };

  // --- Generation & PDF Handlers ---
  const buildAndDownloadPdf = (record?: GenerationRecord) => {
    const targetFields = record ? record.dataSnapshot.rowFields : snapshot.rowFields;
    const targetItems = record ? record.dataSnapshot.items : snapshot.items;
    const targetDiscount = record ? record.dataSnapshot.discount : snapshot.additionalDiscountAmt;
    const targetCharges = record ? record.dataSnapshot.additionalCharges : snapshot.additionalCharges;
    const targetPaid = record ? record.dataSnapshot.paymentMade : snapshot.effectiveAmountPaid;
    const targetManual = record?.dataSnapshot?.manualSourceData || formData;

    const doc = generateInvoicePDF({
      company,
      items: targetItems,
      fields: targetFields,
      template,
      paymentMade: targetPaid,
      discount: targetDiscount,
      additionalCharges: targetCharges,
      roundOffOptions: {
        enabled: targetManual.roundOffEnabled,
        manualRoundOff: targetManual.manualRoundOffOverride,
      },
    });

    const safeFileName = `${(targetFields['invoice_number'] || 'Invoice').replace(/[/\\?%*:|"<>]/g, '-')}.pdf`;
    doc.save(safeFileName);

    // Best-effort upload to user's connected Google Drive Invoices/ folder
    if (storage.getActiveWorkspaceId() && googleTokenManager.isTokenValid()) {
      try {
        const dataUri = doc.output('datauristring');
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

  const handleGenerateInvoice = async (): Promise<GenerationRecord | null> => {
    if (isGenerating) return null;
    setShowValidationErrors(true);

    if (!validation.isValid) {
      setNotification({
        type: 'error',
        text: `Please resolve ${validation.errorList.length} validation issue(s) before generating the invoice.`,
      });
      scrollToSection('review');
      return null;
    }

    setIsGenerating(true);
    try {
      const existingRec =
        (generatedRecord &&
          generationHistory.find((r) => r.id === generatedRecord.id)) ||
        (formData.id
          ? generationHistory.find((r) => r.id === formData.id)
          : undefined);

      const baseRecord = convertManualInvoiceToGenerationRecord(
        formData,
        company,
        template
      );
      const record: GenerationRecord = {
        ...baseRecord,
        id: existingRec?.id || formData.id || baseRecord.id,
        revisionNumber: existingRec ? (existingRec.revisionNumber || 1) + 1 : 1,
        sourceQuotationId:
          formData.sourceQuotationId || existingRec?.sourceQuotationId,
        sourceQuotationNumber:
          formData.sourceQuotationNumber || existingRec?.sourceQuotationNumber,
        updatedAt: new Date().toISOString(),
      };

      setGenerationHistory((prev) => {
        const idx = prev.findIndex((r) => r.id === record.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = record;
          return copy;
        }
        return [record, ...prev];
      });
      setGeneratedRecord(record);
      onInvoiceSaved?.(record);

      // Remove loaded draft cleanly once converted into a finalized invoice
      if (activeDraftId) {
        storage.deleteManualDraft(activeDraftId);
        setDrafts(storage.loadManualDrafts());
        setActiveDraftId(null);
      }

      setNotification({
        type: 'success',
        text: existingRec
          ? `Invoice #${record.invoiceNumber} updated in History (${formatCurrency(record.totalAmount, company.currency)}).`
          : `Invoice #${record.invoiceNumber} generated and saved to History (${formatCurrency(record.totalAmount, company.currency)}).`,
      });

      return record;
    } catch (err) {
      console.error('Error generating manual invoice:', err);
      setNotification({
        type: 'error',
        text: 'Failed to generate invoice. Please check the form values and try again.',
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAndDownload = async () => {
    if (generatedRecord) {
      buildAndDownloadPdf(generatedRecord);
      return;
    }
    const rec = await handleGenerateInvoice();
    if (rec) {
      buildAndDownloadPdf(rec);
    }
  };

  const handleSendGeneratedByEmail = async () => {
    let rec = generatedRecord;
    if (!rec) {
      rec = await handleGenerateInvoice();
    }
    if (rec) {
      onSendByEmail(rec.id);
    }
  };

  const handleCreateAnother = () => {
    const nextBlank = createDefaultManualInvoice(company, fields, generationHistory);
    setFormData(nextBlank);
    setGeneratedRecord(null);
    setActiveDraftId(null);
    setShowValidationErrors(false);
    setNotification({
      type: 'info',
      text: `Started a fresh invoice (#${nextBlank.invoiceNumber}).`,
    });
    scrollToSection('invoice_info');
  };

  const handleConfirmReset = () => {
    const fresh = createDefaultManualInvoice(company, fields, generationHistory);
    setFormData(fresh);
    setGeneratedRecord(null);
    setActiveDraftId(null);
    setShowValidationErrors(false);
    setShowResetConfirmModal(false);
    setNotification({
      type: 'info',
      text: 'Manual invoice form has been reset.',
    });
  };

  // Section completion badges for top progress bar
  const sectionComplete: Record<SectionKey, boolean> = {
    invoice_info: Boolean(formData.invoiceNumber.trim() && formData.invoiceDate && !validation.errors.invoiceNumber && !validation.errors.dueDate),
    customer_info: Boolean(formData.customerName.trim() && !validation.errors.customerEmail),
    items: formData.items.length > 0 && formData.items.every((it) => it.itemName.trim() && it.quantity > 0),
    tax_settings: true,
    payment_info: !validation.errors.amountPaid,
    notes_terms: true,
    review: validation.isValid,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Page Header & Quick Actions */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <FilePlus2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                Manual Invoice Entry
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Create a single multi-item invoice manually with live GST calculations, customer directory lookup, and instant PDF export.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowDraftsModal(true)}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            <FolderOpen className="w-4 h-4 text-indigo-600" />
            <span>Saved Drafts ({drafts.length})</span>
          </button>

          <button
            type="button"
            onClick={openSaveDraftDialog}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4 text-slate-600" />
            <span>Save as Draft</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPreviewModal(true)}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-colors cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>Preview Invoice</span>
          </button>

          <button
            type="button"
            onClick={() => setShowResetConfirmModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-slate-600 text-xs font-semibold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Inline Notification Banner */}
      {notification && (
        <div
          role="status"
          className={`p-3.5 rounded-2xl border text-xs sm:text-sm flex items-center justify-between shadow-sm ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : notification.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          <div className="flex items-center space-x-2 font-medium">
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
            {notification.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            {notification.type === 'info' && <Info className="w-4 h-4 text-indigo-600 shrink-0" />}
            <span>{notification.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="p-1 opacity-60 hover:opacity-100 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Linked Source Quotation Info Banner */}
      {formData.sourceQuotationNumber && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 text-indigo-900">
            <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>
              Converted from Approved Quotation{' '}
              <span className="font-mono font-bold">{formData.sourceQuotationNumber}</span>.
              Edits here update only this invoice — the source quotation remains immutable and linked.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('quotations')}
            className="px-3 py-1.5 rounded-lg bg-white border border-indigo-300 text-indigo-700 font-bold hover:bg-indigo-100 shrink-0 cursor-pointer"
          >
            View Quotations
          </button>
        </div>
      )}

      {/* Generated Success Banner */}
      {generatedRecord && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-emerald-800 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>Invoice #{generatedRecord.invoiceNumber} Generated Successfully</span>
            </div>
            <p className="text-xs text-emerald-700">
              Saved to Generation History for {generatedRecord.customerName} • Total:{' '}
              <span className="font-mono font-bold tabular-nums">
                {formatCurrency(generatedRecord.totalAmount, company.currency)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => buildAndDownloadPdf(generatedRecord)}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={handleSendGeneratedByEmail}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm cursor-pointer"
            >
              <Mail className="w-4 h-4" />
              <span>Send by Email</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('history')}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>View in History</span>
            </button>
            <button
              type="button"
              onClick={handleCreateAnother}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Invoice</span>
            </button>
          </div>
        </div>
      )}

      {/* 7-Section Progress & Quick-Jump Step Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2.5 shadow-xs overflow-x-auto">
        <div className="flex items-center space-x-1.5 min-w-max">
          {SECTIONS.map((sec) => {
            const done = sectionComplete[sec.key];
            return (
              <button
                key={sec.key}
                type="button"
                onClick={() => scrollToSection(sec.key)}
                className="flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200/80 transition-colors cursor-pointer"
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    done
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {done ? <Check className="w-3 h-3" /> : sec.number}
                </span>
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split Layout: Form (Left 8 cols) + Live Summary & Preview (Right 4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: 7 FORM SECTIONS */}
        <div className="xl:col-span-8 space-y-6">
          {/* SECTION 1: INVOICE INFORMATION */}
          <section
            id="manual-section-invoice_info"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <button
              type="button"
              onClick={() => toggleSection('invoice_info')}
              className="w-full px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  1
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Invoice Information
                  </h2>
                  <p className="text-xs text-slate-500">
                    Numbering, dates, supply state, and reference metadata
                  </p>
                </div>
              </div>
              {expandedSections.invoice_info ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {expandedSections.invoice_info && (
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Invoice Number with Auto-Number toggle */}
                  <div className="md:col-span-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700">
                        Invoice Number <span className="text-rose-500">*</span>
                      </label>
                      <label className="inline-flex items-center space-x-1 text-[11px] text-slate-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.autoNumbering}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            updateField('autoNumbering', checked);
                            if (checked) {
                              updateField(
                                'invoiceNumber',
                                generateNextInvoiceNumber(generationHistory, fields)
                              );
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>Auto</span>
                      </label>
                    </div>
                    <div className="flex space-x-1.5">
                      <input
                        type="text"
                        aria-label="Invoice Number"
                        value={formData.invoiceNumber}
                        onChange={(e) => {
                          updateField('invoiceNumber', e.target.value);
                          if (formData.autoNumbering) updateField('autoNumbering', false);
                        }}
                        placeholder="INV-2026-001"
                        className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-600 ${
                          isDuplicateNumber || (showValidationErrors && validation.errors.invoiceNumber)
                            ? 'border-rose-400 bg-rose-50/40'
                            : 'border-slate-300'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          updateField('autoNumbering', true);
                          updateField(
                            'invoiceNumber',
                            generateNextInvoiceNumber(generationHistory, fields)
                          );
                        }}
                        title="Generate next sequential invoice number"
                        className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                    {isDuplicateNumber && (
                      <p className="text-[11px] text-rose-600 font-medium mt-1">
                        Duplicate invoice number detected in History. Choose a unique number.
                      </p>
                    )}
                    {!isDuplicateNumber && showValidationErrors && validation.errors.invoiceNumber && (
                      <p className="text-[11px] text-rose-600 mt-1">{validation.errors.invoiceNumber}</p>
                    )}
                  </div>

                  {/* Invoice Date */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Invoice Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      aria-label="Invoice Date"
                      value={formData.invoiceDate}
                      onChange={(e) => updateField('invoiceDate', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                    {showValidationErrors && validation.errors.invoiceDate && (
                      <p className="text-[11px] text-rose-600 mt-1">{validation.errors.invoiceDate}</p>
                    )}
                  </div>

                  {/* Due Date */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Due Date
                    </label>
                    <input
                      type="date"
                      aria-label="Due Date"
                      value={formData.dueDate}
                      onChange={(e) => updateField('dueDate', e.target.value)}
                      className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600 ${
                        validation.errors.dueDate ? 'border-rose-400' : 'border-slate-300'
                      }`}
                    />
                    {validation.errors.dueDate && (
                      <p className="text-[11px] text-rose-600 mt-1">{validation.errors.dueDate}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Invoice Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Invoice Type
                    </label>
                    <select
                      aria-label="Invoice Type"
                      value={formData.invoiceType}
                      onChange={(e) => updateField('invoiceType', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      {INVOICE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* PO Number */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Purchase Order (PO) Number
                    </label>
                    <input
                      type="text"
                      value={formData.poNumber}
                      onChange={(e) => updateField('poNumber', e.target.value)}
                      placeholder="Optional PO #"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  {/* Reference Number */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Reference Number
                    </label>
                    <input
                      type="text"
                      value={formData.referenceNumber}
                      onChange={(e) => updateField('referenceNumber', e.target.value)}
                      placeholder="Quote / Contract Ref"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Place of Supply
                    </label>
                    <input
                      type="text"
                      value={formData.placeOfSupply}
                      onChange={(e) => updateField('placeOfSupply', e.target.value)}
                      placeholder="e.g., Haryana / Maharashtra"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      State Code
                    </label>
                    <input
                      type="text"
                      value={formData.stateCode}
                      onChange={(e) => updateField('stateCode', e.target.value)}
                      placeholder="e.g., 06 or 27"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Reverse Charge
                    </label>
                    <select
                      aria-label="Reverse Charge"
                      value={formData.reverseCharge}
                      onChange={(e) => updateField('reverseCharge', e.target.value as 'Yes' | 'No')}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Subject / Engagement Summary
                    </label>
                    <input
                      type="text"
                      value={formData.subject}
                      onChange={(e) => updateField('subject', e.target.value)}
                      placeholder="e.g., Q4 Cloud Consulting & Software Retainer"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Additional Reference Details
                    </label>
                    <input
                      type="text"
                      value={formData.additionalReference}
                      onChange={(e) => updateField('additionalReference', e.target.value)}
                      placeholder="Department, project code, or delivery ref"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 2: CUSTOMER INFORMATION */}
          <section
            id="manual-section-customer_info"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <button
              type="button"
              onClick={() => toggleSection('customer_info')}
              className="w-full px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  2
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Customer Information
                  </h2>
                  <p className="text-xs text-slate-500">
                    Select from saved directory or enter billing, shipping, and tax details
                  </p>
                </div>
              </div>
              {expandedSections.customer_info ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {expandedSections.customer_info && (
              <div className="p-6 space-y-5">
                {/* Customer Directory Lookup Bar */}
                <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <div className="flex items-center space-x-2">
                      <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="text-xs font-bold text-indigo-950">Customer Directory:</span>
                    </div>
                    <div className="relative mt-1.5">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={customerSearch}
                        onFocus={() => setShowCustomerDropdown(true)}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setShowCustomerDropdown(true);
                        }}
                        placeholder={`Search ${customers.length} saved customers by name, GSTIN, or email...`}
                        className="w-full bg-white border border-indigo-200 rounded-xl pl-8 pr-8 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      {showCustomerDropdown && (
                        <button
                          type="button"
                          onClick={() => setShowCustomerDropdown(false)}
                          className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label="Close customer dropdown"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {showCustomerDropdown && (
                      <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-30 max-h-56 overflow-y-auto divide-y divide-slate-100">
                        {filteredCustomers.length === 0 ? (
                          <div className="p-3 text-xs text-slate-400 text-center">
                            No matching customers found. Fill the fields below and click Save Customer.
                          </div>
                        ) : (
                          filteredCustomers.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => handleSelectCustomer(c)}
                              className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 flex items-center justify-between transition-colors cursor-pointer"
                            >
                              <div>
                                <p className="text-xs font-bold text-slate-900">{c.customerName}</p>
                                <p className="text-[11px] text-slate-500">
                                  {[c.contactPerson, c.email, c.city].filter(Boolean).join(' • ')}
                                </p>
                              </div>
                              {c.gstin && (
                                <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                                  {c.gstin}
                                </span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveCustomerToDirectory}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white border border-indigo-300 hover:bg-indigo-600 hover:text-white text-indigo-700 text-xs font-bold transition-colors shrink-0 self-end cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Save Customer to Directory</span>
                  </button>
                </div>

                {/* Primary Customer Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Customer / Company Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      aria-label="Customer Name"
                      value={formData.customerName}
                      onChange={(e) => updateField('customerName', e.target.value)}
                      placeholder="e.g., Acme Solutions Pvt Ltd"
                      className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600 ${
                        showValidationErrors && validation.errors.customerName
                          ? 'border-rose-400 bg-rose-50/40'
                          : 'border-slate-300'
                      }`}
                    />
                    {showValidationErrors && validation.errors.customerName && (
                      <p className="text-[11px] text-rose-600 mt-1">{validation.errors.customerName}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Contact Person
                    </label>
                    <input
                      type="text"
                      value={formData.contactPerson}
                      onChange={(e) => updateField('contactPerson', e.target.value)}
                      placeholder="e.g., Priya Nair"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Customer Email
                    </label>
                    <input
                      type="email"
                      aria-label="Customer Email"
                      value={formData.customerEmail}
                      onChange={(e) => updateField('customerEmail', e.target.value)}
                      placeholder="billing@customer.test"
                      className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600 ${
                        validation.errors.customerEmail ? 'border-rose-400' : 'border-slate-300'
                      }`}
                    />
                    {validation.errors.customerEmail && (
                      <p className="text-[11px] text-rose-600 mt-1">{validation.errors.customerEmail}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={formData.customerPhone}
                      onChange={(e) => updateField('customerPhone', e.target.value)}
                      placeholder="+91 98XXX XXXXX"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Customer Reference ID
                    </label>
                    <input
                      type="text"
                      value={formData.customerReferenceNumber}
                      onChange={(e) => updateField('customerReferenceNumber', e.target.value)}
                      placeholder="Optional Client Code"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                {/* Billing & Shipping */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Billing Address
                    </label>
                    <textarea
                      rows={2}
                      value={formData.billingAddress}
                      onChange={(e) => updateField('billingAddress', e.target.value)}
                      placeholder="Street address, suite, building..."
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700">Shipping Address</label>
                      <label className="inline-flex items-center space-x-1.5 text-[11px] text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.sameAsBilling}
                          onChange={(e) => updateField('sameAsBilling', e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>Same as Billing Address</span>
                      </label>
                    </div>
                    <textarea
                      rows={2}
                      disabled={formData.sameAsBilling}
                      value={formData.sameAsBilling ? formData.billingAddress : formData.shippingAddress}
                      onChange={(e) => updateField('shippingAddress', e.target.value)}
                      placeholder="Enter separate delivery / shipping address..."
                      className="w-full bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">City</label>
                    <input
                      type="text"
                      value={formData.customerCity}
                      onChange={(e) => updateField('customerCity', e.target.value)}
                      placeholder="City"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">State</label>
                    <input
                      type="text"
                      value={formData.customerState}
                      onChange={(e) => updateField('customerState', e.target.value)}
                      placeholder="State"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Postal Code</label>
                    <input
                      type="text"
                      value={formData.customerPostalCode}
                      onChange={(e) => updateField('customerPostalCode', e.target.value)}
                      placeholder="PIN / ZIP"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Country</label>
                    <input
                      type="text"
                      value={formData.customerCountry}
                      onChange={(e) => updateField('customerCountry', e.target.value)}
                      placeholder="Country"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Customer GSTIN / Tax ID
                    </label>
                    <input
                      type="text"
                      value={formData.customerGstin}
                      onChange={(e) => updateField('customerGstin', e.target.value.toUpperCase())}
                      placeholder="e.g., 27AABCA1234A1Z5"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono uppercase outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Customer PAN (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.customerPan}
                      onChange={(e) => updateField('customerPan', e.target.value.toUpperCase())}
                      placeholder="e.g., AABCA1234A"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono uppercase outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 3: INVOICE LINE ITEMS */}
          <section
            id="manual-section-items"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => toggleSection('items')}
                className="flex items-center space-x-3 text-left cursor-pointer"
              >
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  3
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Invoice Items ({formData.items.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Add, edit, duplicate, or reorder line items with automatic tax computation
                  </p>
                </div>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Item</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleSection('items')}
                  className="p-1.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                  aria-label="Toggle items section"
                >
                  {expandedSections.items ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {expandedSections.items && (
              <div className="p-5 sm:p-6 space-y-4">
                {formData.items.map((item, idx) => {
                  const calcItem = snapshot.items[idx];
                  const itemNameError =
                    showValidationErrors && validation.errors[`item_${idx}_name`];

                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
                    >
                      {/* Row Header */}
                      <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                        <span className="text-xs font-bold text-slate-700 font-mono">
                          Line Item #{idx + 1}
                        </span>
                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            onClick={() => handleMoveItem(idx, 'up')}
                            disabled={idx === 0}
                            title="Move Up"
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveItem(idx, 'down')}
                            disabled={idx === formData.items.length - 1}
                            title="Move Down"
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateItem(idx)}
                            title="Duplicate Item"
                            className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-100 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            title="Remove Item"
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-100 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Item Name, Description, HSN/SAC */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        <div className="md:col-span-5">
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Item / Service Name <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            aria-label={`Item ${idx + 1} Name`}
                            value={item.itemName}
                            onChange={(e) =>
                              handleUpdateItem(item.id, { itemName: e.target.value })
                            }
                            placeholder="e.g., Enterprise Advisory Retainer"
                            className={`w-full bg-white border rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600 ${
                              itemNameError ? 'border-rose-400 bg-rose-50/40' : 'border-slate-300'
                            }`}
                          />
                          {itemNameError && (
                            <p className="text-[11px] text-rose-600 mt-1">{itemNameError}</p>
                          )}
                        </div>

                        <div className="md:col-span-4">
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Description
                          </label>
                          <input
                            type="text"
                            aria-label={`Item ${idx + 1} Description`}
                            value={item.itemDescription}
                            onChange={(e) =>
                              handleUpdateItem(item.id, { itemDescription: e.target.value })
                            }
                            placeholder="Optional details..."
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>

                        <div className="md:col-span-3">
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            HSN / SAC Code
                          </label>
                          <input
                            type="text"
                            aria-label={`Item ${idx + 1} HSN/SAC`}
                            value={item.hsnSac}
                            onChange={(e) =>
                              handleUpdateItem(item.id, { hsnSac: e.target.value })
                            }
                            placeholder="Optional"
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>
                      </div>

                      {/* Qty, Unit, Rate, Discount, GST % */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 items-end">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            aria-label={`Item ${idx + 1} Quantity`}
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateItem(item.id, {
                                quantity: Math.max(0, parseFloat(e.target.value) || 0),
                              })
                            }
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Unit
                          </label>
                          <select
                            aria-label={`Item ${idx + 1} Unit`}
                            value={item.unit}
                            onChange={(e) => handleUpdateItem(item.id, { unit: e.target.value })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                          >
                            {ITEM_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Unit Rate ({company.currency?.symbol || '₹'})
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`Item ${idx + 1} Rate`}
                            value={item.rate}
                            onChange={(e) =>
                              handleUpdateItem(item.id, {
                                rate: Math.max(0, parseFloat(e.target.value) || 0),
                              })
                            }
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>

                        <div className="col-span-2 sm:col-span-1 md:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Discount
                          </label>
                          <div className="flex">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              aria-label={`Item ${idx + 1} Discount`}
                              value={item.discount}
                              onChange={(e) =>
                                handleUpdateItem(item.id, {
                                  discount: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              }
                              className="w-full bg-white border border-r-0 border-slate-300 rounded-l-xl px-2.5 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                            />
                            <select
                              aria-label={`Item ${idx + 1} Discount Type`}
                              value={item.discountType}
                              onChange={(e) =>
                                handleUpdateItem(item.id, {
                                  discountType: e.target.value as 'fixed' | 'percentage',
                                })
                              }
                              className="bg-slate-100 border border-slate-300 rounded-r-xl px-2 py-2 text-xs font-semibold text-slate-700 outline-none"
                            >
                              <option value="fixed">{company.currency?.symbol || '₹'}</option>
                              <option value="percentage">%</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            GST %
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            disabled={!formData.gstEnabled}
                            aria-label={`Item ${idx + 1} GST Rate`}
                            value={formData.gstEnabled ? item.gstPercentage : 0}
                            onChange={(e) =>
                              handleUpdateItem(item.id, {
                                gstPercentage: Math.max(
                                  0,
                                  Math.min(100, parseFloat(e.target.value) || 0)
                                ),
                              })
                            }
                            className="w-full bg-white disabled:bg-slate-100 disabled:text-slate-400 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>
                      </div>

                      {/* Read-Only Computed Totals for Item */}
                      {calcItem && (
                        <div className="bg-white rounded-xl border border-slate-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px]">
                          <div className="flex flex-wrap items-center gap-4 text-slate-600">
                            <span>
                              Taxable:{' '}
                              <strong className="font-mono tabular-nums text-slate-900">
                                {formatCurrency(calcItem.taxableAmount, company.currency)}
                              </strong>
                            </span>
                            {formData.gstEnabled && formData.transactionType === 'CGST_SGST' ? (
                              <>
                                <span>
                                  CGST:{' '}
                                  <strong className="font-mono tabular-nums text-slate-800">
                                    {formatCurrency(calcItem.cgstAmount, company.currency)}
                                  </strong>
                                </span>
                                <span>
                                  SGST:{' '}
                                  <strong className="font-mono tabular-nums text-slate-800">
                                    {formatCurrency(calcItem.sgstAmount, company.currency)}
                                  </strong>
                                </span>
                              </>
                            ) : (
                              <span>
                                IGST:{' '}
                                <strong className="font-mono tabular-nums text-slate-800">
                                  {formatCurrency(calcItem.igstAmount, company.currency)}
                                </strong>
                              </span>
                            )}
                          </div>
                          <div className="text-slate-900 font-bold">
                            Line Total:{' '}
                            <span className="font-mono tabular-nums text-indigo-700">
                              {formatCurrency(calcItem.itemTotal, company.currency)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={handleAddItem}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-xs font-bold text-indigo-700 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Another Line Item</span>
                </button>
              </div>
            )}
          </section>

          {/* SECTION 4: TAX & CALCULATION SETTINGS */}
          <section
            id="manual-section-tax_settings"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <button
              type="button"
              onClick={() => toggleSection('tax_settings')}
              className="w-full px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  4
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Tax & Calculation Settings
                  </h2>
                  <p className="text-xs text-slate-500">
                    GST mode, tax exclusivity, invoice-level discounts, charges, and round-off
                  </p>
                </div>
              </div>
              {expandedSections.tax_settings ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {expandedSections.tax_settings && (
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* GST Enabled Toggle */}
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Enable GST</p>
                      <p className="text-[11px] text-slate-500">Turn off for Non-GST</p>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Enable GST"
                      checked={formData.gstEnabled}
                      onChange={(e) => updateField('gstEnabled', e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer"
                    />
                  </div>

                  {/* Pricing Mode */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Pricing Mode
                    </label>
                    <select
                      aria-label="Pricing Mode"
                      value={formData.pricingType}
                      onChange={(e) =>
                        updateField('pricingType', e.target.value as 'exclusive' | 'inclusive')
                      }
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="exclusive">Tax Exclusive (GST added on top)</option>
                      <option value="inclusive">Tax Inclusive (GST extracted cleanly)</option>
                    </select>
                  </div>

                  {/* Transaction Tax Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Tax Supply Split
                    </label>
                    <select
                      aria-label="Tax Supply Split"
                      disabled={!formData.gstEnabled}
                      value={formData.transactionType}
                      onChange={(e) =>
                        updateField(
                          'transactionType',
                          e.target.value as 'IGST' | 'CGST_SGST' | 'NONE'
                        )
                      }
                      className="w-full bg-slate-50 disabled:bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="IGST">Inter-State (IGST)</option>
                      <option value="CGST_SGST">Intra-State (CGST + SGST)</option>
                    </select>
                  </div>
                </div>

                {/* Default GST Rate + Quick Apply */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">Default GST Rate:</span>
                    {COMMON_GST_RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        disabled={!formData.gstEnabled}
                        onClick={() => updateField('defaultGstRate', rate)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                          formData.defaultGstRate === rate && formData.gstEnabled
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40'
                        }`}
                      >
                        {rate}%
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={!formData.gstEnabled}
                    onClick={handleApplyDefaultGstToAll}
                    className="text-xs font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    Apply {formData.defaultGstRate}% to All Items
                  </button>
                </div>

                {/* Invoice-level Discount, Additional Charges, Round-off */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Invoice Discount
                    </label>
                    <div className="flex">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        aria-label="Invoice Additional Discount"
                        value={formData.additionalDiscount}
                        onChange={(e) =>
                          updateField(
                            'additionalDiscount',
                            Math.max(0, parseFloat(e.target.value) || 0)
                          )
                        }
                        className="w-full bg-slate-50 border border-r-0 border-slate-300 rounded-l-xl px-3 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                      <select
                        aria-label="Invoice Additional Discount Type"
                        value={formData.additionalDiscountType}
                        onChange={(e) =>
                          updateField(
                            'additionalDiscountType',
                            e.target.value as 'fixed' | 'percentage'
                          )
                        }
                        className="bg-slate-100 border border-slate-300 rounded-r-xl px-2.5 py-2 text-xs font-semibold text-slate-700"
                      >
                        <option value="fixed">{company.currency?.symbol || '₹'}</option>
                        <option value="percentage">%</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Additional / Shipping Charges
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      aria-label="Additional Charges"
                      value={formData.additionalCharges}
                      onChange={(e) =>
                        updateField(
                          'additionalCharges',
                          Math.max(0, parseFloat(e.target.value) || 0)
                        )
                      }
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700">Round-Off</label>
                      <label className="inline-flex items-center space-x-1 text-[11px] text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.roundOffEnabled}
                          onChange={(e) => updateField('roundOffEnabled', e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>Auto</span>
                      </label>
                    </div>
                    <div className="flex space-x-1.5">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Auto"
                        value={
                          formData.manualRoundOffOverride === null ||
                          formData.manualRoundOffOverride === undefined
                            ? ''
                            : formData.manualRoundOffOverride
                        }
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateField(
                            'manualRoundOffOverride',
                            raw === '' ? null : parseFloat(raw) || 0
                          );
                        }}
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                      {formData.manualRoundOffOverride !== null &&
                        formData.manualRoundOffOverride !== undefined && (
                          <button
                            type="button"
                            onClick={() => updateField('manualRoundOffOverride', null)}
                            className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                          >
                            Reset
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 5: PAYMENT INFORMATION */}
          <section
            id="manual-section-payment_info"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <button
              type="button"
              onClick={() => toggleSection('payment_info')}
              className="w-full px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  5
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Payment Information
                  </h2>
                  <p className="text-xs text-slate-500">
                    Payment status, method, received amount, and receiving bank summary
                  </p>
                </div>
              </div>
              {expandedSections.payment_info ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {expandedSections.payment_info && (
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Payment Method
                    </label>
                    <select
                      aria-label="Payment Method"
                      value={formData.paymentMethod}
                      onChange={(e) => updateField('paymentMethod', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      {SUPPORTED_PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Payment Status
                    </label>
                    <select
                      aria-label="Payment Status"
                      value={formData.paymentStatus}
                      onChange={(e) => {
                        const status = e.target.value as 'Unpaid' | 'Partially Paid' | 'Paid';
                        updateField('paymentStatus', status);
                        if (status === 'Unpaid') updateField('amountPaid', 0);
                        if (status === 'Paid')
                          updateField('amountPaid', snapshot.summary.totalInvoiceAmount);
                      }}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="Unpaid">Unpaid</option>
                      <option value="Partially Paid">Partially Paid</option>
                      <option value="Paid">Paid</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Amount Paid ({company.currency?.symbol || '₹'})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      aria-label="Amount Paid"
                      disabled={formData.paymentStatus !== 'Partially Paid'}
                      value={
                        formData.paymentStatus === 'Paid'
                          ? snapshot.summary.totalInvoiceAmount
                          : formData.paymentStatus === 'Unpaid'
                            ? 0
                            : formData.amountPaid
                      }
                      onChange={(e) =>
                        updateField('amountPaid', Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      className="w-full bg-slate-50 disabled:bg-slate-100 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono tabular-nums outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Payment Date
                    </label>
                    <input
                      type="date"
                      value={formData.paymentDate}
                      onChange={(e) => updateField('paymentDate', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Transaction Reference / UTR
                    </label>
                    <input
                      type="text"
                      value={formData.transactionReference}
                      onChange={(e) => updateField('transactionReference', e.target.value)}
                      placeholder="UTR / Cheque / Gateway Ref"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Balance Due (Computed)
                    </label>
                    <div className="bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono tabular-nums font-bold text-slate-900">
                      {formatCurrency(snapshot.summary.balanceDue, company.currency)}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Payment Notes
                  </label>
                  <input
                    type="text"
                    value={formData.paymentNotes}
                    onChange={(e) => updateField('paymentNotes', e.target.value)}
                    placeholder="Optional installment note or settlement remarks..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                {/* Read-only Receiving Bank Summary */}
                {activeBank && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-1.5 font-bold text-slate-800">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Receiving Bank Account (Shown on PDF):</span>
                      </div>
                      <p className="text-slate-600">
                        {activeBank.bankName} ({activeBank.branch}) • A/c{' '}
                        <span className="font-mono font-semibold text-slate-800">
                          {activeBank.accountNumber}
                        </span>{' '}
                        • IFSC{' '}
                        <span className="font-mono font-semibold text-slate-800">
                          {activeBank.ifscCode}
                        </span>
                        {activeBank.upiId ? ` • UPI: ${activeBank.upiId}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigateTab('company')}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 whitespace-nowrap cursor-pointer"
                    >
                      Edit in Company Settings →
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* SECTION 6: NOTES & TERMS */}
          <section
            id="manual-section-notes_terms"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <button
              type="button"
              onClick={() => toggleSection('notes_terms')}
              className="w-full px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                  6
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Notes & Terms
                  </h2>
                  <p className="text-xs text-slate-500">
                    Invoice-specific notes, terms, payment & delivery instructions (does not overwrite global company defaults)
                  </p>
                </div>
              </div>
              {expandedSections.notes_terms ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {expandedSections.notes_terms && (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Invoice Notes
                    </label>
                    <textarea
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => updateField('notes', e.target.value)}
                      placeholder="Thank you for your business..."
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Terms & Conditions
                    </label>
                    <textarea
                      rows={3}
                      value={formData.terms}
                      onChange={(e) => updateField('terms', e.target.value)}
                      placeholder="Payment due within 15 days..."
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Payment Instructions
                    </label>
                    <input
                      type="text"
                      value={formData.paymentInstructions}
                      onChange={(e) => updateField('paymentInstructions', e.target.value)}
                      placeholder="Quote invoice # during NEFT/UPI transfer"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Delivery Instructions
                    </label>
                    <input
                      type="text"
                      value={formData.deliveryInstructions}
                      onChange={(e) => updateField('deliveryInstructions', e.target.value)}
                      placeholder="Optional dispatch / delivery note"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Additional Remarks
                    </label>
                    <input
                      type="text"
                      value={formData.additionalRemarks}
                      onChange={(e) => updateField('additionalRemarks', e.target.value)}
                      placeholder="Optional remarks"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Custom Footer Text
                    </label>
                    <input
                      type="text"
                      value={formData.customFooterText}
                      onChange={(e) => updateField('customFooterText', e.target.value)}
                      placeholder="Computer generated invoice footer"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 7: REVIEW & GENERATE */}
          <section
            id="manual-section-review"
            className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24"
          >
            <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                  7
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Review & Generate Invoice
                  </h2>
                  <p className="text-xs text-slate-500">
                    Verify totals, inspect validation status, save draft, or export PDF
                  </p>
                </div>
              </div>
              <ShieldCheck
                className={`w-5 h-5 ${validation.isValid ? 'text-emerald-600' : 'text-amber-500'}`}
              />
            </div>

            <div className="p-6 space-y-5">
              {/* Validation Errors / Warnings */}
              {!validation.isValid && showValidationErrors && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-1.5">
                  <p className="text-xs font-bold text-rose-800 flex items-center space-x-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>Please fix the following required fields before generating:</span>
                  </p>
                  <ul className="list-disc list-inside text-xs text-rose-700 space-y-0.5">
                    {validation.errorList.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 space-y-1">
                  <p className="font-bold">Optional Reminders:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {validation.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Final Financial Overview Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 font-semibold">Line Items</p>
                  <p className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {formData.items.length}
                  </p>
                </div>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 font-semibold">Subtotal</p>
                  <p className="text-base font-bold text-slate-900 font-mono tabular-nums">
                    {formatCurrency(snapshot.summary.subtotal, company.currency)}
                  </p>
                </div>
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 font-semibold">Total Tax</p>
                  <p className="text-base font-bold text-slate-900 font-mono tabular-nums">
                    {formatCurrency(snapshot.summary.totalTax, company.currency)}
                  </p>
                </div>
                <div className="bg-indigo-50 p-3.5 rounded-xl border border-indigo-200">
                  <p className="text-[11px] text-indigo-700 font-semibold">Grand Total</p>
                  <p className="text-base font-bold text-indigo-900 font-mono tabular-nums">
                    {formatCurrency(snapshot.summary.totalInvoiceAmount, company.currency)}
                  </p>
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openSaveDraftDialog}
                    className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save as Draft</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPreviewModal(true)}
                    className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Full Preview</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isGenerating || Boolean(generatedRecord)}
                    onClick={handleGenerateInvoice}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-emerald-700 disabled:opacity-90 text-white text-xs font-bold shadow-sm cursor-pointer"
                  >
                    {generatedRecord ? <CheckCircle2 className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                    <span>
                      {isGenerating ? 'Generating...' : generatedRecord ? 'Generated & Saved' : 'Generate Invoice'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleGenerateAndDownload}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-xs font-bold shadow-md shadow-indigo-600/20 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Generate & Download PDF</span>
                  </button>

                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleSendGeneratedByEmail}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white text-xs font-bold shadow-sm cursor-pointer"
                  >
                    <Mail className="w-4 h-4" />
                    <span>Send by Email</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: STICKY LIVE SUMMARY & SCALED INVOICE PREVIEW */}
        <aside className="xl:col-span-4 xl:sticky xl:top-20 space-y-5">
          {/* Live Calculation Summary Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <Calculator className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Live Invoice Summary</h3>
              </div>
              <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold">
                {formData.invoiceNumber || 'NO #'}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Customer:</span>
                <span className="font-semibold text-slate-900 truncate max-w-[180px]">
                  {formData.customerName.trim() || 'Not specified'}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Subtotal ({formData.items.length} items):</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatCurrency(snapshot.summary.subtotal, company.currency)}
                </span>
              </div>
              {snapshot.summary.totalCgst > 0 && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST:</span>
                    <span className="font-mono tabular-nums text-slate-800">
                      {formatCurrency(snapshot.summary.totalCgst, company.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST:</span>
                    <span className="font-mono tabular-nums text-slate-800">
                      {formatCurrency(snapshot.summary.totalSgst, company.currency)}
                    </span>
                  </div>
                </>
              )}
              {snapshot.summary.totalIgst > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>IGST:</span>
                  <span className="font-mono tabular-nums text-slate-800">
                    {formatCurrency(snapshot.summary.totalIgst, company.currency)}
                  </span>
                </div>
              )}
              {snapshot.summary.totalDiscount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Total Discount:</span>
                  <span className="font-mono tabular-nums text-rose-600">
                    - {formatCurrency(snapshot.summary.totalDiscount, company.currency)}
                  </span>
                </div>
              )}
              {snapshot.additionalCharges > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Additional Charges:</span>
                  <span className="font-mono tabular-nums text-slate-800">
                    {formatCurrency(snapshot.additionalCharges, company.currency)}
                  </span>
                </div>
              )}
              {snapshot.summary.roundOff !== 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Round Off:</span>
                  <span className="font-mono tabular-nums text-slate-800">
                    {formatCurrency(snapshot.summary.roundOff, company.currency)}
                  </span>
                </div>
              )}

              <div className="border-t border-slate-200 pt-2.5 flex justify-between text-sm font-bold text-slate-900">
                <span>Grand Total:</span>
                <span className="font-mono tabular-nums text-indigo-700">
                  {formatCurrency(snapshot.summary.totalInvoiceAmount, company.currency)}
                </span>
              </div>

              <div className="flex justify-between text-slate-600">
                <span>Amount Paid:</span>
                <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                  {formatCurrency(snapshot.summary.paymentMade, company.currency)}
                </span>
              </div>
              <div className="flex justify-between font-bold text-slate-900">
                <span>Balance Due:</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(snapshot.summary.balanceDue, company.currency)}
                </span>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[11px] text-slate-600 italic">
              {snapshot.summary.amountInWords}
            </div>
          </div>

          {/* Live Invoice Template Mini-Preview */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="text-xs font-bold">Live Invoice Preview</span>
              <button
                type="button"
                onClick={() => setShowPreviewModal(true)}
                className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 inline-flex items-center space-x-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Expand Full Sheet</span>
              </button>
            </div>
            <div className="p-3 bg-slate-200/70 max-h-[480px] overflow-y-auto">
              <InvoicePreviewSheet
                company={company}
                template={template}
                rowFields={snapshot.rowFields}
                items={snapshot.items}
                summary={snapshot.summary}
                compactScale
              />
            </div>
          </div>
        </aside>
      </div>

      {/* FULL PREVIEW MODAL */}
      {showPreviewModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Full Invoice Preview"
        >
          <div className="bg-slate-100 rounded-2xl shadow-2xl border border-slate-300 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-bold text-sm sm:text-base">
                  Invoice Preview — #{formData.invoiceNumber || 'DRAFT'}
                </h3>
                <p className="text-xs text-slate-400">
                  Matches final PDF layout, logo alignment, brand colors, and tax breakdown
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => buildAndDownloadPdf(generatedRecord || undefined)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  aria-label="Close Preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <InvoicePreviewSheet
                company={company}
                template={template}
                rowFields={snapshot.rowFields}
                items={snapshot.items}
                summary={snapshot.summary}
              />
            </div>
          </div>
        </div>
      )}

      {/* SAVE DRAFT MODAL */}
      {showSaveDraftModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Save Invoice Draft</h3>
              <button
                type="button"
                onClick={() => setShowSaveDraftModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Draft Title
              </label>
              <input
                type="text"
                value={draftTitleInput}
                onChange={(e) => setDraftTitleInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowSaveDraftModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveDraft}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                Save Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAVED DRAFTS MODAL */}
      {showDraftsModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Saved Manual Drafts ({drafts.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowDraftsModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {drafts.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  No manual drafts saved yet. Click "Save as Draft" anytime to store work-in-progress invoices.
                </p>
              ) : (
                drafts.map((d) => (
                  <div
                    key={d.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{d.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {d.data.items.length} item(s) • Saved{' '}
                        {new Date(d.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoadDraft(d)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDraft(d.id)}
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-100 cursor-pointer"
                        aria-label={`Delete draft ${d.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* RESET CONFIRMATION MODAL (Non-blocking UI) */}
      {showResetConfirmModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Reset Manual Invoice Form?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              This will clear all unsaved fields in the current manual entry form and start a fresh invoice with the next sequential invoice number. Saved drafts and generated invoices in History will not be affected.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
