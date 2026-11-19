/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Cloud,
  FileCheck2,
  FileText,
  History,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Square,
} from 'lucide-react';
import {
  BackendSmtpConfig,
  CompanySettings,
  EmailDeliveryLogEntry,
  EmailDeliveryMethod,
  GenerationRecord,
  InvoiceTemplate,
  QuotationRecord,
} from '../types';
import { formatCurrency } from '../utils/calculator';
import { EmailSendStatus, EmailService } from '../utils/emailService';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import {
  buildQuotationSnapshot,
  resolveQuotationCurrency,
} from '../utils/quotation';
import { GoogleAccountUser } from '../utils/googleSheets';
import { storage } from '../utils/storage';
import { workspaceApi } from '../utils/workspaceApi';

interface EmailCenterViewProps {
  generationHistory: GenerationRecord[];
  quotations: QuotationRecord[];
  company: CompanySettings;
  template: InvoiceTemplate;
  emailStatuses: Record<string, EmailSendStatus>;
  setEmailStatuses: React.Dispatch<React.SetStateAction<Record<string, EmailSendStatus>>>;
  emailLogs: EmailDeliveryLogEntry[];
  setEmailLogs: React.Dispatch<React.SetStateAction<EmailDeliveryLogEntry[]>>;
  authUser: GoogleAccountUser | null;
  smtpConfig: BackendSmtpConfig;
  initialSelectedRecordId?: string | null;
  initialSelectedQuotationId?: string | null;
  onNavigateTab: (tab: string) => void;
  onRefreshAuth?: () => Promise<void>;
}

interface DispatchReport {
  timestamp: string;
  method: EmailDeliveryMethod;
  documentType: 'invoice' | 'quotation';
  totalSelected: number;
  totalRecipients: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    documentId: string;
    documentNumber: string;
    recipientEmail: string;
    status: 'sent' | 'failed';
    errorMessage: string | null;
  }>;
}

const DEFAULT_INVOICE_SUBJECT = 'Tax Invoice {{invoiceNumber}} from {{companyName}}';
const DEFAULT_INVOICE_BODY =
  'Dear {{customerName}},\n\nPlease find attached your tax invoice #{{invoiceNumber}} for {{totalAmount}} (Due Date: {{dueDate}}).\n\nPayment Method: {{paymentMethod}}\n\nThank you for your business!\n\nBest regards,\n{{companyName}}';

const DEFAULT_QUOTATION_SUBJECT = 'Quotation {{quotationNumber}} from {{companyName}}';
const DEFAULT_QUOTATION_BODY =
  'Dear {{customerName}},\n\nPlease find attached our quotation #{{quotationNumber}} for {{totalAmount}} (Valid Until: {{validUntil}}).\n\nProject / Reference: {{projectName}}\n\nPlease let us know once approved so we can proceed.\n\nBest regards,\n{{companyName}}';

export const EmailCenterView: React.FC<EmailCenterViewProps> = ({
  generationHistory,
  quotations,
  company,
  template,
  emailStatuses,
  setEmailStatuses,
  emailLogs,
  setEmailLogs,
  authUser,
  smtpConfig,
  initialSelectedRecordId,
  initialSelectedQuotationId,
  onNavigateTab,
  onRefreshAuth,
}) => {
  const [docTab, setDocTab] = useState<'invoice' | 'quotation'>(() =>
    initialSelectedQuotationId ? 'quotation' : 'invoice'
  );
  const [deliveryMethod, setDeliveryMethod] = useState<EmailDeliveryMethod>(() =>
    authUser?.gmailConnected ? 'gmail' : smtpConfig.configured ? 'smtp' : 'gmail'
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (initialSelectedQuotationId) return [initialSelectedQuotationId];
    if (initialSelectedRecordId) return [initialSelectedRecordId];
    return [];
  });
  const [activePreviewId, setActivePreviewId] = useState<string | null>(() => {
    if (initialSelectedQuotationId) return initialSelectedQuotationId;
    if (initialSelectedRecordId) return initialSelectedRecordId;
    return generationHistory[0]?.id || quotations[0]?.id || null;
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [invoiceSubject, setInvoiceSubject] = useState(DEFAULT_INVOICE_SUBJECT);
  const [invoiceBody, setInvoiceBody] = useState(DEFAULT_INVOICE_BODY);
  const [quotationSubject, setQuotationSubject] = useState(DEFAULT_QUOTATION_SUBJECT);
  const [quotationBody, setQuotationBody] = useState(DEFAULT_QUOTATION_BODY);

  const [customRecipientEmail, setCustomRecipientEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [bccEmail, setBccEmail] = useState('');

  const [isSending, setIsSending] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [dispatchProgress, setDispatchProgress] = useState<string | null>(null);
  const [dispatchReport, setDispatchReport] = useState<DispatchReport | null>(null);
  const [actionNotification, setActionNotification] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (initialSelectedQuotationId) {
      setDocTab('quotation');
      setActivePreviewId(initialSelectedQuotationId);
      setSelectedIds([initialSelectedQuotationId]);
      setCustomRecipientEmail('');
    }
  }, [initialSelectedQuotationId]);

  useEffect(() => {
    if (initialSelectedRecordId && !initialSelectedQuotationId) {
      setDocTab('invoice');
      setActivePreviewId(initialSelectedRecordId);
      setSelectedIds([initialSelectedRecordId]);
      setCustomRecipientEmail('');
    }
  }, [initialSelectedRecordId, initialSelectedQuotationId]);

  const activeSubject = docTab === 'invoice' ? invoiceSubject : quotationSubject;
  const setActiveSubject = docTab === 'invoice' ? setInvoiceSubject : setQuotationSubject;
  const activeBody = docTab === 'invoice' ? invoiceBody : quotationBody;
  const setActiveBody = docTab === 'invoice' ? setInvoiceBody : setQuotationBody;

  const filteredInvoices = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return generationHistory;
    return generationHistory.filter(
      (r) =>
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        (r.worksheetName || '').toLowerCase().includes(q)
    );
  }, [generationHistory, searchTerm]);

  const filteredQuotations = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter(
      (qt) =>
        qt.quotationNumber.toLowerCase().includes(q) ||
        qt.customerName.toLowerCase().includes(q) ||
        (qt.projectName || '').toLowerCase().includes(q) ||
        qt.status.toLowerCase().includes(q)
    );
  }, [quotations, searchTerm]);

  const currentListCount =
    docTab === 'invoice' ? filteredInvoices.length : filteredQuotations.length;

  const activeInvoice =
    docTab === 'invoice'
      ? generationHistory.find((r) => r.id === activePreviewId) ||
        filteredInvoices[0] ||
        generationHistory[0] ||
        null
      : null;

  const activeQuotation =
    docTab === 'quotation'
      ? quotations.find((q) => q.id === activePreviewId) ||
        filteredQuotations[0] ||
        quotations[0] ||
        null
      : null;

  const handleSwitchDocTab = (next: 'invoice' | 'quotation') => {
    setDocTab(next);
    setSelectedIds([]);
    setCustomRecipientEmail('');
    setDispatchReport(null);
    if (next === 'invoice') {
      setActivePreviewId(generationHistory[0]?.id || null);
    } else {
      setActivePreviewId(quotations[0]?.id || null);
    }
  };

  const handleToggleSelectAll = () => {
    const ids =
      docTab === 'invoice'
        ? filteredInvoices.map((r) => r.id)
        : filteredQuotations.map((q) => q.id);
    if (selectedIds.length === ids.length && ids.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(ids);
    }
  };

  const handleToggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const getInvoiceRecipient = (record: GenerationRecord) => {
    if (docTab === 'invoice' && activePreviewId === record.id && customRecipientEmail.trim()) {
      return customRecipientEmail.trim();
    }
    const rowFields = record.dataSnapshot?.rowFields || {};
    return (
      rowFields['customer_email'] ||
      rowFields['Email'] ||
      record.dataSnapshot?.manualSourceData?.customerEmail ||
      ''
    );
  };

  const getQuotationRecipient = (qt: QuotationRecord) => {
    if (docTab === 'quotation' && activePreviewId === qt.id && customRecipientEmail.trim()) {
      return customRecipientEmail.trim();
    }
    return qt.customerEmail || qt.data.customerEmail || '';
  };

  const interpolateInvoice = (text: string, record: GenerationRecord) => {
    const rowFields = record.dataSnapshot?.rowFields || {};
    return text
      .replace(/\{\{invoiceNumber\}\}/g, record.invoiceNumber)
      .replace(/\{\{documentNumber\}\}/g, record.invoiceNumber)
      .replace(/\{\{customerName\}\}/g, record.customerName)
      .replace(/\{\{totalAmount\}\}/g, formatCurrency(record.totalAmount, company.currency))
      .replace(/\{\{generatedDate\}\}/g, record.generatedDate)
      .replace(/\{\{companyName\}\}/g, company.legalName || 'Company')
      .replace(/\{\{worksheetName\}\}/g, record.worksheetName || '')
      .replace(/\{\{dueDate\}\}/g, rowFields['due_date'] || rowFields['DueDate'] || 'N/A')
      .replace(
        /\{\{paymentMethod\}\}/g,
        rowFields['payment_method'] || record.paymentMethod || 'N/A'
      )
      .replace(/\{\{placeOfSupply\}\}/g, rowFields['place_of_supply'] || 'N/A');
  };

  const interpolateQuotation = (text: string, qt: QuotationRecord) => {
    const curr = resolveQuotationCurrency(qt.currencyCode, company);
    return text
      .replace(/\{\{quotationNumber\}\}/g, qt.quotationNumber)
      .replace(/\{\{documentNumber\}\}/g, qt.quotationNumber)
      .replace(/\{\{customerName\}\}/g, qt.customerName)
      .replace(/\{\{totalAmount\}\}/g, formatCurrency(qt.totalAmount, curr))
      .replace(/\{\{validUntil\}\}/g, qt.validUntilDate || 'N/A')
      .replace(/\{\{projectName\}\}/g, qt.projectName || qt.data.subject || 'General Proposal')
      .replace(/\{\{companyName\}\}/g, company.legalName || 'Company')
      .replace(/\{\{status\}\}/g, qt.status);
  };

  const buildInvoicePdfBase64 = (record: GenerationRecord): { filename: string; contentBase64: string } => {
    const snap = record.dataSnapshot || {};
    const doc = generateInvoicePDF({
      company,
      items: snap.items || [],
      fields: snap.rowFields || {
        invoice_number: record.invoiceNumber,
        customer_name: record.customerName,
      },
      template,
      paymentMade: snap.paymentMade || 0,
      discount: snap.discount || 0,
      additionalCharges: snap.additionalCharges || 0,
    });
    const dataUri = doc.output('datauristring');
    const contentBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    const safeName = `${record.invoiceNumber.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`;
    return { filename: safeName, contentBase64 };
  };

  const buildQuotationPdfBase64 = (qt: QuotationRecord): { filename: string; contentBase64: string } => {
    const snap = buildQuotationSnapshot(qt.data, company);
    const curr = resolveQuotationCurrency(qt.currencyCode, company);
    const doc = generateInvoicePDF({
      company: { ...company, currency: curr },
      items: snap.items,
      fields: snap.rowFields,
      template,
      paymentMade: 0,
      discount: snap.additionalDiscountAmt,
      additionalCharges: snap.additionalCharges,
      roundOffOptions: {
        enabled: qt.data.roundOffEnabled,
        manualRoundOff: qt.data.manualRoundOffOverride,
      },
    });
    const dataUri = doc.output('datauristring');
    const contentBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    const safeName = `${qt.quotationNumber.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`;
    return { filename: safeName, contentBase64 };
  };

  const updateStatus = (docId: string, status: EmailSendStatus) => {
    setEmailStatuses((prev) => {
      const next = { ...prev, [docId]: status };
      storage.saveEmailStatuses(next);
      return next;
    });
  };

  const validateDeliveryMethodReady = (): string | null => {
    if (!authUser?.userId) {
      return 'Sign in with your Google Account in Account & Integrations to send real emails via Gmail API or encrypted Backend SMTP.';
    }
    if (deliveryMethod === 'gmail' && !authUser.gmailConnected) {
      return 'Connected Gmail Account is selected, but Gmail send permission is not yet authorized. Click "Connect Gmail" or explicitly choose "Company / User SMTP Account".';
    }
    if (deliveryMethod === 'smtp' && !smtpConfig.configured) {
      return 'Company / User SMTP Account is selected, but SMTP settings are not configured yet. Configure SMTP in Account & Integrations or explicitly choose "Connected Gmail Account".';
    }
    return null;
  };

  const handleConnectGmailInline = async () => {
    setIsConnectingGmail(true);
    setActionNotification(null);
    try {
      await workspaceApi.connectGoogle('gmail');
      await onRefreshAuth?.();
      setDeliveryMethod('gmail');
      setActionNotification({
        type: 'success',
        text: 'Gmail send permission authorized! You can now send invoices and quotations directly from your Gmail account.',
      });
    } catch (err: any) {
      setActionNotification({
        type: 'error',
        text: err?.message || 'Could not authorize Gmail right now. Check Account & Integrations.',
      });
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const dispatchDocuments = async (targetIds: string[]) => {
    if (targetIds.length === 0) {
      setActionNotification({
        type: 'error',
        text: `Select at least one ${docTab} to send.`,
      });
      return;
    }

    const readinessError = validateDeliveryMethodReady();
    if (readinessError) {
      setActionNotification({ type: 'error', text: readinessError });
      return;
    }

    // Validate CC / BCC if provided
    if (ccEmail.trim()) {
      const invalidCc = ccEmail
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !EmailService.validateEmail(s));
      if (invalidCc.length > 0) {
        setActionNotification({
          type: 'error',
          text: `Invalid CC address: ${invalidCc.join(', ')}`,
        });
        return;
      }
    }
    if (bccEmail.trim()) {
      const invalidBcc = bccEmail
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !EmailService.validateEmail(s));
      if (invalidBcc.length > 0) {
        setActionNotification({
          type: 'error',
          text: `Invalid BCC address: ${invalidBcc.join(', ')}`,
        });
        return;
      }
    }

    setIsSending(true);
    setActionNotification(null);
    setDispatchReport(null);
    setDispatchProgress(
      `Generating ${targetIds.length} PDF attachment(s) and dispatching via ${
        deliveryMethod === 'gmail' ? 'Connected Gmail Account' : 'Company / User SMTP'
      }...`
    );

    try {
      const items: Array<{
        documentType: 'invoice' | 'quotation';
        documentId: string;
        documentNumber: string;
        to: string;
        cc?: string;
        bcc?: string;
        subject: string;
        textBody: string;
        attachment: { filename: string; contentBase64: string; contentType: string };
      }> = [];

      for (const id of targetIds) {
        if (docTab === 'invoice') {
          const rec = generationHistory.find((r) => r.id === id);
          if (!rec) continue;
          const to = getInvoiceRecipient(rec);
          const pdf = buildInvoicePdfBase64(rec);
          items.push({
            documentType: 'invoice',
            documentId: rec.id,
            documentNumber: rec.invoiceNumber,
            to,
            cc: ccEmail.trim() || undefined,
            bcc: bccEmail.trim() || undefined,
            subject: interpolateInvoice(invoiceSubject, rec),
            textBody: interpolateInvoice(invoiceBody, rec),
            attachment: {
              filename: pdf.filename,
              contentBase64: pdf.contentBase64,
              contentType: 'application/pdf',
            },
          });
        } else {
          const qt = quotations.find((q) => q.id === id);
          if (!qt) continue;
          const to = getQuotationRecipient(qt);
          const pdf = buildQuotationPdfBase64(qt);
          items.push({
            documentType: 'quotation',
            documentId: qt.id,
            documentNumber: qt.quotationNumber,
            to,
            cc: ccEmail.trim() || undefined,
            bcc: bccEmail.trim() || undefined,
            subject: interpolateQuotation(quotationSubject, qt),
            textBody: interpolateQuotation(quotationBody, qt),
            attachment: {
              filename: pdf.filename,
              contentBase64: pdf.contentBase64,
              contentType: 'application/pdf',
            },
          });
        }
      }

      if (items.length === 0) {
        setActionNotification({ type: 'error', text: 'No matching documents found to send.' });
        return;
      }

      // Check empty/invalid recipients up-front if single send
      if (items.length === 1 && (!items[0].to || !EmailService.validateEmail(items[0].to))) {
        setActionNotification({
          type: 'error',
          text: `Enter a valid recipient email address for #${items[0].documentNumber} in the preview panel before sending.`,
        });
        return;
      }

      items.forEach((it) => updateStatus(it.documentId, 'pending'));

      const response = await workspaceApi.sendEmails({
        method: deliveryMethod,
        items,
      });

      const newLogs: EmailDeliveryLogEntry[] = [];
      for (const res of response.results) {
        updateStatus(res.documentId, res.status === 'sent' ? 'sent' : 'failed');
        newLogs.push({
          id: res.logId,
          documentType: docTab,
          documentId: res.documentId,
          documentNumber: res.documentNumber,
          recipientEmail: res.recipientEmail,
          cc: ccEmail.trim() || undefined,
          bcc: bccEmail.trim() || undefined,
          deliveryMethod: res.deliveryMethod,
          senderEmail: res.senderEmail,
          subject:
            items.find((i) => i.documentId === res.documentId)?.subject ||
            res.documentNumber,
          status: res.status,
          providerMessageId: res.providerMessageId,
          errorMessage: res.errorMessage,
          createdAt: new Date().toISOString(),
        });
      }

      setEmailLogs((prev) => {
        const next = [...newLogs, ...prev];
        storage.saveEmailLogs(next);
        return next;
      });

      const uniqueRecipients = new Set(
        response.results.map((r) => r.recipientEmail.toLowerCase()).filter(Boolean)
      ).size;

      setDispatchReport({
        timestamp: new Date().toISOString(),
        method: response.method,
        documentType: docTab,
        totalSelected: items.length,
        totalRecipients: uniqueRecipients,
        successCount: response.sentCount,
        failureCount: response.failedCount,
        results: response.results.map((r) => ({
          documentId: r.documentId,
          documentNumber: r.documentNumber,
          recipientEmail: r.recipientEmail,
          status: r.status,
          errorMessage: r.errorMessage,
        })),
      });

      if (response.failedCount === 0) {
        setActionNotification({
          type: 'success',
          text: `Successfully sent ${response.sentCount} ${docTab}(s) with PDF attachments via ${
            response.method === 'gmail' ? 'Connected Gmail Account' : 'Company / User SMTP'
          }.`,
        });
      } else {
        setActionNotification({
          type: 'error',
          text: `Sent ${response.sentCount}, failed ${response.failedCount}. Review the dispatch summary or email history below for details.`,
        });
      }
    } catch (err: any) {
      targetIds.forEach((id) => updateStatus(id, 'failed'));
      setActionNotification({
        type: 'error',
        text: err?.message || 'Email dispatch failed.',
      });
    } finally {
      setIsSending(false);
      setDispatchProgress(null);
    }
  };

  const handleRetryFailed = () => {
    if (!dispatchReport) return;
    const failedIds = dispatchReport.results
      .filter((r) => r.status === 'failed')
      .map((r) => r.documentId);
    if (failedIds.length > 0) {
      setSelectedIds(failedIds);
    }
  };

  const templateVariables =
    docTab === 'invoice'
      ? [
          '{{invoiceNumber}}',
          '{{customerName}}',
          '{{totalAmount}}',
          '{{dueDate}}',
          '{{companyName}}',
          '{{paymentMethod}}',
        ]
      : [
          '{{quotationNumber}}',
          '{{customerName}}',
          '{{totalAmount}}',
          '{{validUntil}}',
          '{{projectName}}',
          '{{companyName}}',
        ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header Bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center space-x-2">
            <Mail className="w-7 h-7 text-indigo-600 shrink-0" />
            <span>Email Delivery Center</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Send invoices and quotations with generated PDF attachments using your{' '}
            <span className="font-semibold text-slate-700">Connected Gmail Account</span> or{' '}
            <span className="font-semibold text-slate-700">Company / User SMTP Account</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Document Type Toggle */}
          <div
            role="tablist"
            aria-label="Document Type to Email"
            className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200"
          >
            <button
              type="button"
              role="tab"
              aria-selected={docTab === 'invoice'}
              onClick={() => handleSwitchDocTab('invoice')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center space-x-1.5 transition-colors cursor-pointer ${
                docTab === 'invoice'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Invoices ({generationHistory.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={docTab === 'quotation'}
              onClick={() => handleSwitchDocTab('quotation')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center space-x-1.5 transition-colors cursor-pointer ${
                docTab === 'quotation'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Quotations ({quotations.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void dispatchDocuments(selectedIds)}
            disabled={isSending || selectedIds.length === 0}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer"
          >
            {isSending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>
                  Send Selected ({selectedIds.length}) via{' '}
                  {deliveryMethod === 'gmail' ? 'Gmail' : 'SMTP'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Explicit Delivery Method Selector Banner */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Send Using (Explicit Method Selection)
            </h2>
            <p className="text-xs text-slate-500">
              Emails are dispatched strictly through the method you choose below — Invoice Studio never silently falls back between Gmail and SMTP.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('integrations')}
            className="text-xs font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-xl inline-flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Manage Gmail & SMTP in Account &amp; Integrations</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option 1: Connected Gmail Account */}
          <label
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start justify-between gap-3 ${
              deliveryMethod === 'gmail'
                ? 'border-indigo-600 bg-indigo-50/40'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                name="emailDeliveryMethod"
                value="gmail"
                checked={deliveryMethod === 'gmail'}
                onChange={() => setDeliveryMethod('gmail')}
                className="mt-1 text-indigo-600"
              />
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Mail className="w-4 h-4 text-rose-600" />
                  <span className="text-sm font-bold text-slate-900">
                    Connected Gmail Account
                  </span>
                </div>
                {authUser?.gmailConnected ? (
                  <p className="text-xs text-emerald-700 font-medium">
                    Ready • Sending as <span className="font-mono">{authUser.email}</span> (Gmail API)
                  </p>
                ) : (
                  <p className="text-xs text-amber-700">
                    {authUser?.email
                      ? `Signed in as ${authUser.email}, but Gmail send scope is not authorized yet.`
                      : 'Sign in with Google & grant Gmail send permission to use this method.'}
                  </p>
                )}
              </div>
            </div>
            {authUser?.email && !authUser.gmailConnected && (
              <button
                type="button"
                disabled={isConnectingGmail}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConnectGmailInline();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold shrink-0 cursor-pointer"
              >
                {isConnectingGmail ? 'Connecting...' : 'Connect Gmail'}
              </button>
            )}
          </label>

          {/* Option 2: Company / User SMTP Account */}
          <label
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start justify-between gap-3 ${
              deliveryMethod === 'smtp'
                ? 'border-indigo-600 bg-indigo-50/40'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                name="emailDeliveryMethod"
                value="smtp"
                checked={deliveryMethod === 'smtp'}
                onChange={() => setDeliveryMethod('smtp')}
                className="mt-1 text-indigo-600"
              />
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Server className="w-4 h-4 text-indigo-600" />
                  <span className="text-sm font-bold text-slate-900">
                    Company / User SMTP Account
                  </span>
                </div>
                {smtpConfig.configured ? (
                  <p className="text-xs text-emerald-700 font-medium">
                    Ready • <span className="font-mono">{smtpConfig.senderEmail}</span> via{' '}
                    <span className="font-mono">
                      {smtpConfig.host}:{smtpConfig.port}
                    </span>{' '}
                    ({smtpConfig.securityMode})
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Not configured yet. Store encrypted SMTP credentials in your Google Drive workspace via Account &amp; Integrations.
                  </p>
                )}
              </div>
            </div>
            {!smtpConfig.configured && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateTab('integrations');
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold shrink-0 cursor-pointer"
              >
                Configure SMTP
              </button>
            )}
          </label>
        </div>
      </div>

      {/* Action Notification */}
      {actionNotification && (
        <div
          role="status"
          className={`p-4 rounded-2xl border text-sm flex items-center justify-between shadow-sm ${
            actionNotification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : actionNotification.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          <div className="flex items-center space-x-2 font-medium">
            {actionNotification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{actionNotification.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotification(null)}
            className="text-xs font-bold opacity-60 hover:opacity-100 px-2 py-1 cursor-pointer"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Dispatch Progress */}
      {dispatchProgress && (
        <div className="p-4 rounded-2xl border text-xs flex items-center space-x-3 shadow-sm bg-amber-50 border-amber-200 text-amber-900">
          <RefreshCw className="w-5 h-5 animate-spin text-amber-600 shrink-0" />
          <span className="font-semibold text-sm">{dispatchProgress}</span>
        </div>
      )}

      {/* Dispatch Report Card */}
      {dispatchReport && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-900 text-sm">
                Email Dispatch Summary ({dispatchReport.method === 'gmail' ? 'Gmail API' : 'SMTP'})
              </h3>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              {new Date(dispatchReport.timestamp).toLocaleTimeString()}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
              <span className="block text-xs font-semibold text-slate-500">Selected</span>
              <span className="text-lg font-bold text-slate-900">
                {dispatchReport.totalSelected}
              </span>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
              <span className="block text-xs font-semibold text-slate-500">Unique Recipients</span>
              <span className="text-lg font-bold text-indigo-700">
                {dispatchReport.totalRecipients}
              </span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 text-center">
              <span className="block text-xs font-semibold text-emerald-700">Sent</span>
              <span className="text-lg font-bold text-emerald-800">
                {dispatchReport.successCount}
              </span>
            </div>
            <div className="bg-rose-50 p-3 rounded-xl border border-rose-200 text-center">
              <span className="block text-xs font-semibold text-rose-700">Failed</span>
              <span className="text-lg font-bold text-rose-800">
                {dispatchReport.failureCount}
              </span>
            </div>
          </div>

          {dispatchReport.failureCount > 0 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-rose-700 font-medium">
                Some emails failed validation or delivery. Inspect the history log below.
              </span>
              <button
                type="button"
                onClick={handleRetryFailed}
                className="px-3 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-bold transition-all cursor-pointer inline-flex items-center space-x-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Select Failed to Retry</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Document Selection Table */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder={
                  docTab === 'invoice'
                    ? 'Search invoice number or customer...'
                    : 'Search quotation number, customer, project, or status...'
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-600 outline-none"
              />
            </div>
            <div className="text-xs font-semibold text-slate-600 whitespace-nowrap">
              {selectedIds.length} of {currentListCount} selected
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4 w-10 text-center">
                      <button
                        type="button"
                        onClick={handleToggleSelectAll}
                        className="text-slate-500 hover:text-slate-900 cursor-pointer"
                        aria-label="Toggle select all documents"
                      >
                        {selectedIds.length === currentListCount && currentListCount > 0 ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4 whitespace-nowrap">
                      {docTab === 'invoice' ? 'Invoice No' : 'Quotation No'}
                    </th>
                    <th className="py-3 px-4 whitespace-nowrap">Customer</th>
                    <th className="py-3 px-4 whitespace-nowrap">Recipient</th>
                    <th className="py-3 px-4 whitespace-nowrap">Amount</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Email Status</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {docTab === 'invoice' ? (
                    filteredInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          No invoices found. Generate an invoice first in Manual Entry or Invoice Generator.
                        </td>
                      </tr>
                    ) : (
                      filteredInvoices.map((record) => {
                        const isSelected = selectedIds.includes(record.id);
                        const status = emailStatuses[record.id];
                        const isPreview = activeInvoice?.id === record.id;
                        const recipient = getInvoiceRecipient(record);

                        return (
                          <tr
                            key={record.id}
                            className={`transition-colors cursor-pointer ${
                              isPreview ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
                            }`}
                            onClick={() => {
                              setActivePreviewId(record.id);
                              setCustomRecipientEmail('');
                            }}
                          >
                            <td
                              className="py-3 px-4 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleToggleItem(record.id)}
                                aria-label={`Select invoice ${record.invoiceNumber}`}
                                className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-indigo-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900 font-mono text-xs">
                              {record.invoiceNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-800 font-medium text-xs">
                              {record.customerName}
                            </td>
                            <td className="py-3 px-4 text-slate-600 font-mono text-xs truncate max-w-[160px]">
                              {recipient || (
                                <span className="text-amber-600 italic">Set email in preview</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900 text-xs tabular-nums whitespace-nowrap">
                              {formatCurrency(record.totalAmount, company.currency)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {status === 'sent' && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Sent</span>
                                </span>
                              )}
                              {status === 'pending' && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  <span>Sending</span>
                                </span>
                              )}
                              {status === 'failed' && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  <AlertCircle className="w-3 h-3" />
                                  <span>Failed</span>
                                </span>
                              )}
                              {!status && <span className="text-slate-400 text-xs">—</span>}
                            </td>
                            <td
                              className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => void dispatchDocuments([record.id])}
                                disabled={isSending}
                                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs transition-all cursor-pointer inline-flex items-center space-x-1"
                              >
                                <Send className="w-3 h-3" />
                                <span>Send</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActivePreviewId(record.id);
                                  setCustomRecipientEmail('');
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                  isPreview
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                {isPreview ? 'Active' : 'Preview'}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )
                  ) : filteredQuotations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        No quotations found. Create one in the Quotations tab first.
                      </td>
                    </tr>
                  ) : (
                    filteredQuotations.map((qt) => {
                      const isSelected = selectedIds.includes(qt.id);
                      const status = emailStatuses[qt.id];
                      const isPreview = activeQuotation?.id === qt.id;
                      const recipient = getQuotationRecipient(qt);
                      const curr = resolveQuotationCurrency(qt.currencyCode, company);

                      return (
                        <tr
                          key={qt.id}
                          className={`transition-colors cursor-pointer ${
                            isPreview ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
                          }`}
                          onClick={() => {
                            setActivePreviewId(qt.id);
                            setCustomRecipientEmail('');
                          }}
                        >
                          <td
                            className="py-3 px-4 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleToggleItem(qt.id)}
                              aria-label={`Select quotation ${qt.quotationNumber}`}
                              className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-indigo-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900 font-mono text-xs">
                              {qt.quotationNumber}
                            </p>
                            <span className="text-[10px] font-semibold text-slate-500">
                              {qt.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-800 font-medium text-xs">
                            {qt.customerName}
                          </td>
                          <td className="py-3 px-4 text-slate-600 font-mono text-xs truncate max-w-[160px]">
                            {recipient || (
                              <span className="text-amber-600 italic">Set email in preview</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 text-xs tabular-nums whitespace-nowrap">
                            {formatCurrency(qt.totalAmount, curr)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {status === 'sent' && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Sent</span>
                              </span>
                            )}
                            {status === 'pending' && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Sending</span>
                              </span>
                            )}
                            {status === 'failed' && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertCircle className="w-3 h-3" />
                                <span>Failed</span>
                              </span>
                            )}
                            {!status && <span className="text-slate-400 text-xs">—</span>}
                          </td>
                          <td
                            className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => void dispatchDocuments([qt.id])}
                              disabled={isSending}
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs transition-all cursor-pointer inline-flex items-center space-x-1"
                            >
                              <Send className="w-3 h-3" />
                              <span>Send</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActivePreviewId(qt.id);
                                setCustomRecipientEmail('');
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                isPreview
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              {isPreview ? 'Active' : 'Preview'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Template, CC/BCC & Live Preview */}
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
            <div className="flex items-center space-x-2 text-indigo-600 border-b border-slate-200 pb-3">
              <Mail className="w-5 h-5" />
              <h3 className="font-bold text-slate-900 text-sm">
                {docTab === 'invoice' ? 'Invoice' : 'Quotation'} Email Template
              </h3>
            </div>

            <div className="bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100 space-y-1.5">
              <p className="font-bold text-indigo-900 text-[11px]">
                Click variable to insert into body:
              </p>
              <div className="flex flex-wrap gap-1">
                {templateVariables.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => setActiveBody((prev) => prev + ' ' + variable)}
                    className="px-2 py-0.5 bg-white border border-indigo-200 text-indigo-700 rounded-md font-mono text-[10px] hover:bg-indigo-100 transition-colors cursor-pointer"
                  >
                    {variable}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Subject Template</label>
              <input
                type="text"
                value={activeSubject}
                onChange={(e) => setActiveSubject(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-[11px]"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Body Template</label>
              <textarea
                rows={4}
                value={activeBody}
                onChange={(e) => setActiveBody(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed font-mono text-[11px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">CC (optional)</label>
                <input
                  type="text"
                  value={ccEmail}
                  onChange={(e) => setCcEmail(e.target.value)}
                  placeholder="accounts@company.com"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-[11px] font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">BCC (optional)</label>
                <input
                  type="text"
                  value={bccEmail}
                  onChange={(e) => setBccEmail(e.target.value)}
                  placeholder="archive@company.com"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-[11px] font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Live Preview Card */}
          {(docTab === 'invoice' && activeInvoice) || (docTab === 'quotation' && activeQuotation) ? (
            <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-md space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-cyan-400">
                  Live Preview:{' '}
                  {docTab === 'invoice'
                    ? `#${activeInvoice!.invoiceNumber}`
                    : `#${activeQuotation!.quotationNumber}`}
                </span>
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                  {deliveryMethod === 'gmail' ? 'via Gmail API' : 'via SMTP'}
                </span>
              </div>

              <div className="space-y-2 text-[11px]">
                <div>
                  <label className="block text-slate-400 text-[10px] mb-0.5 font-bold">
                    Recipient Email Address:
                  </label>
                  <input
                    type="email"
                    aria-label="Recipient Email Address"
                    placeholder="client@example.com"
                    value={
                      customRecipientEmail ||
                      (docTab === 'invoice'
                        ? getInvoiceRecipient(activeInvoice!)
                        : getQuotationRecipient(activeQuotation!))
                    }
                    onChange={(e) => setCustomRecipientEmail(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="space-y-1 font-mono text-slate-300">
                  <p>
                    <span className="text-slate-500">Subject:</span>{' '}
                    <span className="text-white font-bold">
                      {docTab === 'invoice'
                        ? interpolateInvoice(invoiceSubject, activeInvoice!)
                        : interpolateQuotation(quotationSubject, activeQuotation!)}
                    </span>
                  </p>
                  {ccEmail.trim() && (
                    <p>
                      <span className="text-slate-500">CC:</span> {ccEmail}
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 text-slate-200 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                {docTab === 'invoice'
                  ? interpolateInvoice(invoiceBody, activeInvoice!)
                  : interpolateQuotation(quotationBody, activeQuotation!)}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-slate-400 text-[11px] gap-2">
                <span className="flex items-center space-x-1.5 truncate">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">
                    PDF:{' '}
                    {docTab === 'invoice'
                      ? `${activeInvoice!.invoiceNumber}.pdf`
                      : `${activeQuotation!.quotationNumber}.pdf`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchDocuments([
                      docTab === 'invoice' ? activeInvoice!.id : activeQuotation!.id,
                    ])
                  }
                  disabled={isSending}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-xs transition-all cursor-pointer inline-flex items-center space-x-1 shrink-0"
                >
                  <Send className="w-3 h-3" />
                  <span>Send {docTab === 'invoice' ? 'Invoice' : 'Quotation'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
              Select a {docTab} from the table to preview its email and PDF attachment.
            </div>
          )}
        </div>
      </div>

      {/* Email Delivery History Log */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Email Delivery History ({emailLogs.length})
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Per-user audit log of Gmail & SMTP dispatches
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Document</th>
                <th className="py-2.5 px-4">Recipient</th>
                <th className="py-2.5 px-4">Method</th>
                <th className="py-2.5 px-4">Sender</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {emailLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No email delivery records yet.
                  </td>
                </tr>
              ) : (
                emailLogs.slice(0, 50).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900 mr-1.5">
                        {log.documentNumber}
                      </span>
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {log.documentType}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">
                      {log.recipientEmail}
                      {log.cc && (
                        <span className="block text-[10px] text-slate-400">CC: {log.cc}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          log.deliveryMethod === 'gmail'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}
                      >
                        {log.deliveryMethod === 'gmail' ? 'Gmail API' : 'SMTP'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 text-[11px]">
                      {log.senderEmail || '—'}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {log.status === 'sent' ? (
                        <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Sent</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-rose-700 font-bold">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Failed</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">
                      {log.errorMessage || log.providerMessageId || log.subject}
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
