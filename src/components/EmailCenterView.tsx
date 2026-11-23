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
  Eye,
  FileCheck2,
  FileText,
  History,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Square,
} from 'lucide-react';
import {
  BackendSmtpConfig,
  CompanySettings,
  DriveWorkspaceConnection,
  EmailDeliveryLogEntry,
  GenerationRecord,
  GoogleVerifiedSession,
  InvoiceTemplate,
  QuotationRecord,
} from '../types';
import { formatCurrency } from '../utils/calculator';
import { EmailSendStatus } from '../utils/emailService';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { buildQuotationSnapshot, resolveQuotationCurrency } from '../utils/quotation';
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
  smtpConfig: BackendSmtpConfig;
  googleSession: GoogleVerifiedSession | null;
  driveConnection: DriveWorkspaceConnection | null;
  onConnectGoogle?: () => Promise<void>;
  onEnableGmailPermission?: () => Promise<void>;
  initialSelectedRecordId?: string | null;
  initialSelectedQuotationId?: string | null;
  onNavigateTab: (tab: string) => void;
}

const DEFAULT_INVOICE_SUBJECT = 'Tax Invoice {{documentNumber}} from {{companyName}}';
const DEFAULT_INVOICE_BODY =
  'Dear {{customerName}},\n\nPlease find attached your Tax Invoice #{{documentNumber}} for {{totalAmount}}.\n\nThank you for your business.\n\nBest regards,\n{{companyName}}';

const DEFAULT_QUOTATION_SUBJECT = 'Quotation {{documentNumber}} from {{companyName}}';
const DEFAULT_QUOTATION_BODY =
  'Dear {{customerName}},\n\nPlease find attached our Quotation #{{documentNumber}} for {{totalAmount}} (Valid until: {{validUntil}}).\n\nPlease let us know once approved so we can proceed.\n\nBest regards,\n{{companyName}}';

function renderTemplate(templateText: string, vars: Record<string, string>): string {
  return templateText.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? '');
}

export const EmailCenterView: React.FC<EmailCenterViewProps> = ({
  generationHistory,
  quotations,
  company,
  template,
  emailStatuses,
  setEmailStatuses,
  emailLogs,
  setEmailLogs,
  smtpConfig,
  googleSession,
  driveConnection,
  onConnectGoogle,
  onEnableGmailPermission,
  initialSelectedRecordId,
  initialSelectedQuotationId,
  onNavigateTab,
}) => {
  // Default to Gmail API (per Employee Database Studio architecture), with Custom SMTP as optional alternative
  const [providerMode, setProviderMode] = useState<'gmail_api' | 'smtp'>('gmail_api');
  const [enablingGmail, setEnablingGmail] = useState(false);

  const [docTab, setDocTab] = useState<'invoice' | 'quotation'>(() =>
    initialSelectedQuotationId ? 'quotation' : 'invoice'
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
  const [recipientOverrides, setRecipientOverrides] = useState<Record<string, string>>({});
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [subjectTemplate, setSubjectTemplate] = useState(() =>
    initialSelectedQuotationId ? DEFAULT_QUOTATION_SUBJECT : DEFAULT_INVOICE_SUBJECT
  );
  const [bodyTemplate, setBodyTemplate] = useState(() =>
    initialSelectedQuotationId ? DEFAULT_QUOTATION_BODY : DEFAULT_INVOICE_BODY
  );
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<string>('');
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSummary, setDispatchSummary] = useState<{
    sentCount: number;
    failedCount: number;
    persistedInDrive: boolean;
    providerUsed: 'gmail_api' | 'smtp';
    details: Array<{
      documentNumber: string;
      recipientEmail: string;
      status: string;
      error?: string;
      retryable?: boolean;
    }>;
  } | null>(null);

  useEffect(() => {
    if (initialSelectedQuotationId) {
      setDocTab('quotation');
      setSelectedIds([initialSelectedQuotationId]);
      setActivePreviewId(initialSelectedQuotationId);
      setSubjectTemplate(DEFAULT_QUOTATION_SUBJECT);
      setBodyTemplate(DEFAULT_QUOTATION_BODY);
    } else if (initialSelectedRecordId) {
      setDocTab('invoice');
      setSelectedIds([initialSelectedRecordId]);
      setActivePreviewId(initialSelectedRecordId);
      setSubjectTemplate(DEFAULT_INVOICE_SUBJECT);
      setBodyTemplate(DEFAULT_INVOICE_BODY);
    }
  }, [initialSelectedQuotationId, initialSelectedRecordId]);

  const handleSwitchDocTab = (tab: 'invoice' | 'quotation') => {
    setDocTab(tab);
    setSelectedIds([]);
    setDispatchSummary(null);
    setDispatchError(null);
    if (tab === 'invoice') {
      setSubjectTemplate(DEFAULT_INVOICE_SUBJECT);
      setBodyTemplate(DEFAULT_INVOICE_BODY);
      setActivePreviewId(generationHistory[0]?.id || null);
    } else {
      setSubjectTemplate(DEFAULT_QUOTATION_SUBJECT);
      setBodyTemplate(DEFAULT_QUOTATION_BODY);
      setActivePreviewId(quotations[0]?.id || null);
    }
  };

  const normalizedDocs = useMemo(() => {
    if (docTab === 'invoice') {
      return generationHistory.map((inv) => ({
        id: inv.id,
        type: 'invoice' as const,
        number: inv.invoiceNumber,
        customerName: inv.customerName || 'Customer',
        defaultEmail:
          inv.dataSnapshot?.rowFields?.customer_email ||
          inv.dataSnapshot?.manualData?.customerEmail ||
          '',
        amount: Number(inv.totalAmount || 0),
        formattedAmount: formatCurrency(inv.totalAmount || 0, company.currency),
        dateLabel: inv.generatedDate ? new Date(inv.generatedDate).toLocaleDateString() : '',
        validUntil: '',
        raw: inv,
      }));
    }
    return quotations.map((qt) => ({
      id: qt.id,
      type: 'quotation' as const,
      number: qt.quotationNumber,
      customerName: qt.customerName || 'Customer',
      defaultEmail: qt.customerEmail || qt.data?.customerEmail || '',
      amount: Number(qt.totalAmount || 0),
      formattedAmount: formatCurrency(
        qt.totalAmount || 0,
        resolveQuotationCurrency(qt.currencyCode, company)
      ),
      dateLabel: qt.quotationDate || '',
      validUntil: qt.validUntilDate || '',
      raw: qt,
    }));
  }, [docTab, generationHistory, quotations, company]);

  const filteredDocs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return normalizedDocs;
    return normalizedDocs.filter(
      (d) =>
        d.number.toLowerCase().includes(q) ||
        d.customerName.toLowerCase().includes(q) ||
        d.defaultEmail.toLowerCase().includes(q)
    );
  }, [normalizedDocs, searchTerm]);

  const activeDoc =
    normalizedDocs.find((d) => d.id === activePreviewId) || normalizedDocs[0] || null;

  const getRecipientEmail = (docId: string, fallback: string) =>
    recipientOverrides[docId] !== undefined ? recipientOverrides[docId] : fallback;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setActivePreviewId(id);
  };

  const buildVarsForDoc = (doc: (typeof normalizedDocs)[number]) => ({
    documentNumber: doc.number,
    invoiceNumber: doc.number,
    quotationNumber: doc.number,
    customerName: doc.customerName,
    companyName: company.displayName || company.legalName || 'Invoice Studio',
    totalAmount: doc.formattedAmount,
    validUntil: doc.validUntil || 'N/A',
  });

  const generatePdfBase64ForDoc = async (
    doc: (typeof normalizedDocs)[number]
  ): Promise<{ base64: string; fileName: string }> => {
    if (doc.type === 'invoice') {
      const inv = doc.raw as GenerationRecord;
      const snap = inv.dataSnapshot || {};
      const rowFields = snap.rowFields || {
        invoice_number: inv.invoiceNumber,
        customer_name: inv.customerName,
      };
      const items = Array.isArray(snap.items) ? snap.items : [];
      const pdfDoc = generateInvoicePDF({
        company,
        template,
        fields: rowFields,
        items,
        paymentMade: snap.paymentMade ?? inv.paymentAmount ?? 0,
        discount: snap.discount ?? 0,
        additionalCharges: snap.additionalCharges ?? 0,
      });
      const dataUri = pdfDoc.output('datauristring');
      return {
        base64: dataUri.split('base64,')[1] || '',
        fileName: `Invoice_${inv.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
      };
    }

    const qt = doc.raw as QuotationRecord;
    const snap = buildQuotationSnapshot(qt.data, company, template);
    const pdfDoc = generateInvoicePDF({
      company: snap.companyWithCurrency,
      template: snap.quotationTemplate || template,
      fields: snap.rowFields,
      items: snap.items,
      paymentMade: 0,
      discount: snap.additionalDiscountAmt,
      additionalCharges: snap.additionalCharges,
    });
    const dataUri = pdfDoc.output('datauristring');
    return {
      base64: dataUri.split('base64,')[1] || '',
      fileName: `Quotation_${qt.quotationNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
    };
  };

  const handleEnableGmailClick = async () => {
    if (!onEnableGmailPermission) return;
    setDispatchError(null);
    setEnablingGmail(true);
    try {
      await onEnableGmailPermission();
    } catch (err: any) {
      setDispatchError(err?.message || 'Unable to grant Gmail send permission.');
    } finally {
      setEnablingGmail(false);
    }
  };

  const dispatchTargets = async (targets: Array<(typeof normalizedDocs)[number]>) => {
    setDispatchError(null);
    setDispatchSummary(null);

    if (providerMode === 'gmail_api') {
      if (!googleSession) {
        setDispatchError('Connect your Google account first to send emails via Gmail API.');
        return;
      }
      if (!googleSession.permissions.gmailGranted) {
        setDispatchError(
          'Gmail send permission (gmail.send) has not been enabled yet. Click "Enable Gmail Permission" above to authorize sending.'
        );
        return;
      }
    } else if (!smtpConfig.configured) {
      setDispatchError(
        'Custom SMTP is not configured yet. Configure SMTP in Google Account & Email Settings or switch to Gmail API.'
      );
      return;
    }

    if (targets.length === 0) {
      setDispatchError('Select at least one invoice or quotation to send.');
      return;
    }

    setSending(true);
    setSendProgress(`Preparing PDF attachments for ${targets.length} document(s)...`);

    try {
      const itemsToSend = [];
      for (let i = 0; i < targets.length; i++) {
        const doc = targets[i];
        setSendProgress(`Generating PDF ${i + 1} of ${targets.length} (${doc.number})...`);
        const pdf = await generatePdfBase64ForDoc(doc);
        const vars = buildVarsForDoc(doc);
        itemsToSend.push({
          documentType: doc.type,
          documentNumber: doc.number,
          customerName: doc.customerName,
          recipientEmail: getRecipientEmail(doc.id, doc.defaultEmail).trim(),
          cc: ccInput.trim() || undefined,
          bcc: bccInput.trim() || undefined,
          subject: renderTemplate(subjectTemplate, vars),
          body: renderTemplate(bodyTemplate, vars),
          pdfBase64: pdf.base64,
          pdfFilename: pdf.fileName,
        });
      }

      setSendProgress(
        providerMode === 'gmail_api'
          ? `Sending via Gmail API (${googleSession?.email})...`
          : 'Sending via configured Custom SMTP server...'
      );

      const res =
        providerMode === 'gmail_api'
          ? await workspaceApi.sendGmailEmails({
              senderName: company.displayName || company.legalName || googleSession?.name || 'Invoice Studio',
              replyTo: company.email || undefined,
              items: itemsToSend,
            })
          : await workspaceApi.sendRealEmails({ items: itemsToSend });

      if (Array.isArray(res.logs) && res.logs.length > 0) {
        setEmailLogs((prev) => [...res.logs, ...prev].slice(0, 500));
      }

      setEmailStatuses((prev) => {
        const next = { ...prev };
        for (const r of res.results) {
          const matchedDoc = targets.find((t) => t.number === r.documentNumber);
          if (matchedDoc) {
            next[matchedDoc.id] = r.status === 'Sent' ? 'sent' : 'failed';
          }
        }
        return next;
      });

      setDispatchSummary({
        sentCount: res.sentCount,
        failedCount: res.failedCount,
        persistedInDrive: res.persistedInDrive,
        providerUsed: providerMode,
        details: res.results,
      });
    } catch (err: any) {
      setDispatchError(
        err?.message ||
          (providerMode === 'gmail_api'
            ? 'Failed to send email(s) via Gmail API.'
            : 'Failed to send email(s) via SMTP.')
      );
    } finally {
      setSending(false);
      setSendProgress('');
    }
  };

  const handleSendSelected = () => {
    const targets = normalizedDocs.filter((d) => selectedIds.includes(d.id));
    void dispatchTargets(targets);
  };

  const handleRetryFailed = () => {
    if (!dispatchSummary) return;
    const failedNumbers = new Set(
      dispatchSummary.details.filter((d) => d.status !== 'Sent').map((d) => d.documentNumber)
    );
    const targets = normalizedDocs.filter((d) => failedNumbers.has(d.number));
    void dispatchTargets(targets);
  };

  const gmailReady = Boolean(googleSession?.permissions.gmailGranted);
  const activeSenderEmail =
    providerMode === 'gmail_api'
      ? googleSession?.email || ''
      : smtpConfig.senderEmail || smtpConfig.username || '';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & Provider Selector */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
              <Mail className="w-6 h-6 text-indigo-600" />
              <span>Email Delivery Center</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Send invoices and quotations with PDF attachments individually or in batch using your
              connected Google account&apos;s Gmail API (default) or optional Custom SMTP.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('integrations')}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 self-start md:self-auto cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Email &amp; Google Settings</span>
          </button>
        </div>

        {/* Provider Toggle: Gmail API (Default) vs Custom SMTP (Optional Alternative) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setProviderMode('gmail_api')}
            onKeyDown={(e) => e.key === 'Enter' && setProviderMode('gmail_api')}
            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start justify-between gap-3 ${
              providerMode === 'gmail_api'
                ? 'border-indigo-600 bg-indigo-50/40'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="text-xs font-bold text-slate-900">Gmail API (Default)</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    gmailReady
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {gmailReady ? 'Ready' : googleSession ? 'Permission Needed' : 'Not Connected'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 truncate">
                {gmailReady
                  ? `Sending as ${googleSession?.email} (gmail.send only)`
                  : googleSession
                    ? `Connected as ${googleSession.email} — grant incremental gmail.send permission`
                    : 'Connect your Google account to send directly from Gmail'}
              </p>
            </div>
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              {!googleSession && onConnectGoogle ? (
                <button
                  type="button"
                  onClick={() => void onConnectGoogle()}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Cloud className="w-3 h-3" />
                  <span>Connect</span>
                </button>
              ) : googleSession && !gmailReady && onEnableGmailPermission ? (
                <button
                  type="button"
                  disabled={enablingGmail}
                  onClick={handleEnableGmailClick}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  {enablingGmail ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3 h-3" />
                  )}
                  <span>Enable Gmail Permission</span>
                </button>
              ) : null}
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setProviderMode('smtp')}
            onKeyDown={(e) => e.key === 'Enter' && setProviderMode('smtp')}
            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start justify-between gap-3 ${
              providerMode === 'smtp'
                ? 'border-indigo-600 bg-indigo-50/40'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-slate-700 shrink-0" />
                <span className="text-xs font-bold text-slate-900">
                  Custom SMTP (Optional Alternative)
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    smtpConfig.configured
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {smtpConfig.configured ? 'Configured' : 'Not Configured'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 truncate">
                {smtpConfig.configured
                  ? `${smtpConfig.host}:${smtpConfig.port} (${smtpConfig.senderEmail || smtpConfig.username})`
                  : 'Use your own domain SMTP server (credentials encrypted in your Drive)'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace: Left Document Selector + Right Composer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 cols: Document Selector */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => handleSwitchDocTab('invoice')}
                className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  docTab === 'invoice'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Invoices ({generationHistory.length})</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchDocTab('quotation')}
                className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  docTab === 'quotation'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Quotations ({quotations.length})</span>
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={`Search ${docTab}s by number, customer, or email...`}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs bg-slate-50"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {filteredDocs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No {docTab}s available yet. Create one first to send it by email.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = selectedIds.includes(doc.id);
                const statusInfo = emailStatuses[doc.id];
                return (
                  <div
                    key={doc.id}
                    className={`p-3.5 transition-colors ${
                      isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => toggleSelect(doc.id)}
                        className="mt-0.5 text-indigo-600 cursor-pointer"
                        aria-label={`Select ${doc.number}`}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setActivePreviewId(doc.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{doc.number}</p>
                          <span className="text-xs font-mono font-bold text-slate-800 shrink-0">
                            {doc.formattedAmount}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 truncate">{doc.customerName}</p>
                        <div className="mt-2">
                          <input
                            type="email"
                            value={getRecipientEmail(doc.id, doc.defaultEmail)}
                            onChange={(e) =>
                              setRecipientOverrides((prev) => ({
                                ...prev,
                                [doc.id]: e.target.value,
                              }))
                            }
                            placeholder="Enter customer email..."
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-mono"
                          />
                        </div>
                        {statusInfo && (
                          <p
                            className={`text-[11px] mt-1 font-medium ${
                              statusInfo === 'sent' ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {statusInfo === 'sent' ? 'Sent' : statusInfo === 'failed' ? 'Failed' : statusInfo}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right 7 cols: Email Composer & Live Preview */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">Compose Email</h2>
              <p className="text-[11px] text-slate-500">
                Sender:{' '}
                <strong className="text-slate-800">
                  {activeSenderEmail || 'Not configured'}
                </strong>{' '}
                via {providerMode === 'gmail_api' ? 'Gmail API' : 'Custom SMTP'}
              </p>
            </div>
            <span className="text-xs font-semibold text-indigo-600">
              {selectedIds.length} document{selectedIds.length === 1 ? '' : 's'} selected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">CC (Optional)</label>
              <input
                type="text"
                value={ccInput}
                onChange={(e) => setCcInput(e.target.value)}
                placeholder="finance@company.com"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">BCC (Optional)</label>
              <input
                type="text"
                value={bccInput}
                onChange={(e) => setBccInput(e.target.value)}
                placeholder="archive@company.com"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50"
              />
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Email Subject</label>
              <input
                type="text"
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Email Message Body
                <span className="ml-2 text-[11px] font-normal text-slate-500">
                  Variables: {'{{documentNumber}}'}, {'{{customerName}}'}, {'{{totalAmount}}'},{' '}
                  {'{{companyName}}'}
                </span>
              </label>
              <textarea
                rows={6}
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm leading-relaxed"
              />
            </div>
          </div>

          {activeDoc && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-700 min-w-0">
                <Paperclip className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="truncate font-mono">
                  {activeDoc.type === 'invoice' ? 'Invoice' : 'Quotation'}_
                  {activeDoc.number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPreviewModal((p) => !p)}
                className="text-indigo-600 font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{showPreviewModal ? 'Hide Preview' : 'Preview Email'}</span>
              </button>
            </div>
          )}

          {showPreviewModal && activeDoc && (
            <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-2 text-xs">
              <p className="font-bold text-indigo-900">
                From: {activeSenderEmail || '(not connected)'} → To:{' '}
                {getRecipientEmail(activeDoc.id, activeDoc.defaultEmail) || '(missing email)'}
              </p>
              <p className="font-semibold text-slate-900">
                Subject: {renderTemplate(subjectTemplate, buildVarsForDoc(activeDoc))}
              </p>
              <pre className="whitespace-pre-wrap font-sans text-slate-700 bg-white p-3 rounded-lg border border-indigo-100">
                {renderTemplate(bodyTemplate, buildVarsForDoc(activeDoc))}
              </pre>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <p className="text-[11px] text-slate-500">
              {driveConnection?.isConnected
                ? 'One email per recipient. Sent history is archived to your Google Drive (workspace/email-history.json).'
                : 'Connect Google Drive to archive sent email history permanently.'}
            </p>
            <button
              type="button"
              disabled={sending || selectedIds.length === 0}
              onClick={handleSendSelected}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>
                {sending
                  ? sendProgress || 'Sending...'
                  : `Send ${selectedIds.length || ''} ${
                      docTab === 'invoice' ? 'Invoice' : 'Quotation'
                    }${selectedIds.length === 1 ? '' : 's'} via ${
                      providerMode === 'gmail_api' ? 'Gmail API' : 'SMTP'
                    }`}
              </span>
            </button>
          </div>

          {dispatchError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{dispatchError}</span>
            </div>
          )}

          {dispatchSummary && (
            <div
              className={`p-4 rounded-xl border text-xs space-y-2 ${
                dispatchSummary.failedCount === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Delivery Complete ({dispatchSummary.providerUsed === 'gmail_api' ? 'Gmail API' : 'SMTP'}):{' '}
                    {dispatchSummary.sentCount} Sent, {dispatchSummary.failedCount} Failed
                  </span>
                </div>
                {dispatchSummary.failedCount > 0 && (
                  <button
                    type="button"
                    disabled={sending}
                    onClick={handleRetryFailed}
                    className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry Failed</span>
                  </button>
                )}
              </div>
              {dispatchSummary.details.map((d, i) => (
                <div key={i} className="text-[11px] flex items-center justify-between gap-2">
                  <span>
                    {d.documentNumber} → {d.recipientEmail || '(empty)'}
                  </span>
                  <span className="font-semibold">
                    {d.status === 'Sent' ? 'Sent' : d.error || 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Email History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <span>Email Delivery History ({emailLogs.length})</span>
          </h2>
        </div>

        {emailLogs.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            No emails sent in this workspace yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Document</th>
                  <th className="py-2.5 px-3">Recipient</th>
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emailLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {new Date(log.sentAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {log.documentNumber} ({log.documentType})
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{log.recipientEmail}</td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {log.deliveryMethod === 'gmail_api'
                        ? 'Gmail API'
                        : log.deliveryMethod === 'gmail_smtp'
                          ? 'Gmail SMTP'
                          : 'Custom SMTP'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          log.status === 'Sent'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {log.status}
                      </span>
                      {log.errorMessage && (
                        <p className="text-[11px] text-rose-600 mt-0.5">{log.errorMessage}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
