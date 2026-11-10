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
  Trash2,
  Mail,
  Send,
  X,
  Server,
  Key,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { formatCurrency } from '../utils/calculator';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { EmailService, EmailSendStatus, EmailConfig } from '../utils/emailService';
import { storage } from '../utils/storage';

interface HistoryViewProps {
  generationHistory: GenerationRecord[];
  setGenerationHistory: React.Dispatch<React.SetStateAction<GenerationRecord[]>>;
  company: CompanySettings;
  template: InvoiceTemplate;
  emailStatuses?: Record<string, EmailSendStatus>;
  setEmailStatuses?: React.Dispatch<React.SetStateAction<Record<string, EmailSendStatus>>>;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  generationHistory,
  setGenerationHistory,
  company,
  template,
  emailStatuses: externalEmailStatuses,
  setEmailStatuses: externalSetEmailStatuses,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [emailModalRecord, setEmailModalRecord] = useState<GenerationRecord | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [emailConfig, setEmailConfig] = useState<EmailConfig>(() => storage.loadEmailConfig());
  const [localEmailStatuses, setLocalEmailStatuses] = useState<Record<string, EmailSendStatus>>(() => storage.loadEmailStatuses());
  const [isSending, setIsSending] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const effectiveEmailStatuses = externalEmailStatuses || localEmailStatuses;
  const updateEmailStatuses = (recordId: string, status: EmailSendStatus) => {
    if (externalSetEmailStatuses) {
      externalSetEmailStatuses(prev => {
        const next = { ...prev, [recordId]: status };
        storage.saveEmailStatuses(next);
        return next;
      });
    } else {
      setLocalEmailStatuses(prev => {
        const next = { ...prev, [recordId]: status };
        storage.saveEmailStatuses(next);
        return next;
      });
    }
  };

  const handleUpdateEmailConfig = (newConfig: EmailConfig) => {
    setEmailConfig(newConfig);
    storage.saveEmailConfig(newConfig);
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus(null);
    try {
      const res = await EmailService.testConnection(emailConfig);
      setConnectionStatus(res);
    } catch {
      setConnectionStatus({ success: false, message: 'Unexpected connection test failure.' });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const filteredHistory = generationHistory.filter(record => 
    record.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.worksheetName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleClearHistory = () => {
    if (!window.confirm('Are you sure you want to clear all generation history? This action cannot be undone.')) return;
    if (externalSetEmailStatuses) {
      externalSetEmailStatuses({});
    }
    setLocalEmailStatuses({});
    storage.saveEmailStatuses({});
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

  const interpolateVariables = (text: string) => {
    if (!emailModalRecord) return text;
    const rowFields = emailModalRecord.dataSnapshot?.rowFields || {};
    return text
      .replace(/\{\{invoiceNumber\}\}/g, emailModalRecord.invoiceNumber)
      .replace(/\{\{customerName\}\}/g, emailModalRecord.customerName)
      .replace(/\{\{totalAmount\}\}/g, formatCurrency(emailModalRecord.totalAmount, company.currency))
      .replace(/\{\{generatedDate\}\}/g, emailModalRecord.generatedDate)
      .replace(/\{\{companyName\}\}/g, company.legalName || 'Company')
      .replace(/\{\{worksheetName\}\}/g, emailModalRecord.worksheetName)
      .replace(/\{\{dueDate\}\}/g, rowFields['due_date'] || rowFields['DueDate'] || 'N/A')
      .replace(/\{\{paymentMethod\}\}/g, rowFields['payment_method'] || rowFields['paymentMethod'] || 'N/A')
      .replace(/\{\{placeOfSupply\}\}/g, rowFields['place_of_supply'] || 'N/A');
  };

  const handleOpenEmailModal = (record: GenerationRecord) => {
    const rowFields = record.dataSnapshot?.rowFields || {};
    const defaultEmail = rowFields['customer_email'] || rowFields['Email'] || `${record.customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@client.com`;
    setEmailModalRecord(record);
    setRecipientEmail(defaultEmail);
    setEmailSubject(`Tax Invoice {{invoiceNumber}} from {{companyName}}`);
    setEmailBody(`Dear {{customerName}},\n\nPlease find attached your tax invoice #{{invoiceNumber}} for {{totalAmount}} (Due Date: {{dueDate}}).\n\nPayment Method: {{paymentMethod}}\n\nThank you for your business!\n\nBest regards,\n{{companyName}}`);
    setActiveTab('edit');
    setStatusMessage(null);
  };

  const handleSendEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail.trim() || !emailModalRecord) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid recipient email address.' });
      return;
    }

    const recordId = emailModalRecord.id;
    setIsSending(true);
    setStatusMessage(null);
    updateEmailStatuses(recordId, 'pending');

    try {
      const result = await EmailService.sendInvoiceEmail({
        recipientEmail: recipientEmail.trim(),
        subject: interpolateVariables(emailSubject),
        body: interpolateVariables(emailBody),
        record: emailModalRecord,
        config: emailConfig,
      });

      updateEmailStatuses(recordId, result.status);
      setIsSending(false);

      if (result.success) {
        setStatusMessage({ type: 'success', text: result.message });
        setTimeout(() => {
          setEmailModalRecord(null);
          setStatusMessage(null);
        }, 2500);
      } else {
        setStatusMessage({ type: 'error', text: result.message });
      }
    } catch (err) {
      setIsSending(false);
      updateEmailStatuses(recordId, 'failed');
      setStatusMessage({ type: 'error', text: 'An unexpected error occurred while sending the email.' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Generation History & Versioning</h1>
          <p className="text-sm text-slate-500">View permanently stored invoices, download PDFs, email clients directly via EmailService (SMTP/Mailgun), and regenerate records.</p>
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
                <th className="py-3 px-4 text-center">Email Status</th>
                <th className="py-3 px-4 text-center">PDF Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No generated invoices found in history. Generate some invoices from the Generation Center!
                  </td>
                </tr>
              ) : (
                filteredHistory.map(record => {
                  const emailStatus = effectiveEmailStatuses[record.id];
                  return (
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
                        {emailStatus === 'sent' && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                            <CheckCircle2 className="w-3 h-3 text-cyan-600" />
                            <span>Email Sent</span>
                          </span>
                        )}
                        {emailStatus === 'pending' && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
                            <span>Sending...</span>
                          </span>
                        )}
                        {emailStatus === 'failed' && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            <span>Failed</span>
                          </span>
                        )}
                        {!emailStatus && (
                          <span className="text-slate-400 text-xs">Not Sent</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Success</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => handleOpenEmailModal(record)}
                          className="p-1.5 rounded-lg bg-cyan-50 text-cyan-600 hover:bg-cyan-100 transition-colors inline-flex items-center"
                          title="Email Invoice to Client via EmailService"
                        >
                          <Mail className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDownloadPDF(record)}
                          className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors inline-flex items-center"
                          title="Download PDF"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRegenerateRecord(record)}
                          className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors inline-flex items-center"
                          title="Regenerate with Latest Settings"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDuplicateRecord(record)}
                          className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors inline-flex items-center"
                          title="Duplicate Invoice"
                        >
                          <Copy className="w-4 h-4" />
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

      {/* Email Invoice Modal */}
      {emailModalRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-cyan-50 text-cyan-600 rounded-xl">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Email Invoice Preview & Sender</h3>
                  <p className="text-xs text-slate-500 font-mono">Invoice #{emailModalRecord.invoiceNumber} — {emailModalRecord.customerName}</p>
                </div>
              </div>
              <button
                onClick={() => setEmailModalRecord(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'edit'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1. Edit Template & Gateway
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'preview'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                2. Live Email Preview
              </button>
            </div>

            {statusMessage && (
              <div className={`p-4 rounded-xl text-xs flex items-center space-x-2 border ${
                statusMessage.type === 'success' 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}>
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
                )}
                <span className="font-semibold">{statusMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleSendEmailSubmit} className="space-y-4 text-xs">
              {activeTab === 'edit' ? (
                <>
                  {/* Provider Selector & Test Connection */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 gap-2">
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-slate-700">Gateway:</span>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="emailProvider"
                          checked={emailConfig.provider === 'smtp'}
                          onChange={() => handleUpdateEmailConfig({ ...emailConfig, provider: 'smtp' })}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium text-slate-800">Mock SMTP</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="emailProvider"
                          checked={emailConfig.provider === 'mailgun'}
                          onChange={() => handleUpdateEmailConfig({ ...emailConfig, provider: 'mailgun' })}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium text-slate-800">Mailgun API</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTestingConnection}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition-colors cursor-pointer inline-flex items-center justify-center space-x-1.5 border border-indigo-200"
                    >
                      {isTestingConnection ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Server className="w-3 h-3" />}
                      <span>{isTestingConnection ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                  </div>

                  {connectionStatus && (
                    <div className={`p-2.5 rounded-lg text-[11px] flex items-center space-x-2 border ${
                      connectionStatus.success ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'
                    }`}>
                      {connectionStatus.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                      <span>{connectionStatus.message}</span>
                    </div>
                  )}

                  {emailConfig.provider === 'smtp' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">SMTP Server</label>
                        <input
                          type="text"
                          value={emailConfig.smtpServer || ''}
                          onChange={(e) => handleUpdateEmailConfig({ ...emailConfig, smtpServer: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Port</label>
                        <input
                          type="text"
                          value={emailConfig.smtpPort || ''}
                          onChange={(e) => handleUpdateEmailConfig({ ...emailConfig, smtpPort: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Mailgun Domain</label>
                      <input
                        type="text"
                        value={emailConfig.mailgunDomain || ''}
                        onChange={(e) => handleUpdateEmailConfig({ ...emailConfig, mailgunDomain: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-mono"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Recipient Email Address <span className="text-rose-500">*</span></label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="client@company.com"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                  </div>

                  {/* Template Variables Helper Bar */}
                  <div className="bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100 space-y-1.5">
                    <p className="font-bold text-indigo-900 text-[11px]">Click variable to insert into subject or body:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['{{invoiceNumber}}', '{{customerName}}', '{{totalAmount}}', '{{dueDate}}', '{{companyName}}', '{{paymentMethod}}'].map(variable => (
                        <button
                          key={variable}
                          type="button"
                          onClick={() => setEmailBody(prev => prev + ' ' + variable)}
                          className="px-2 py-0.5 bg-white border border-indigo-200 text-indigo-700 rounded-md font-mono text-[10px] hover:bg-indigo-100 transition-colors cursor-pointer"
                        >
                          {variable}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Email Subject Template</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-[11px]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Message Body Template</label>
                    <textarea
                      rows={5}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed font-mono text-[11px]"
                      required
                    />
                  </div>
                </>
              ) : (
                /* Live Preview Tab */
                <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-700">Live Rendered Email Preview</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">Variables Interpolated</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center space-x-2 text-slate-600">
                      <span className="font-bold text-slate-700 w-16">To:</span>
                      <span className="font-mono bg-white px-2 py-1 rounded border border-slate-200 flex-1">{recipientEmail || 'client@company.com'}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-slate-600">
                      <span className="font-bold text-slate-700 w-16">From:</span>
                      <span className="font-mono bg-white px-2 py-1 rounded border border-slate-200 flex-1">{company.email || 'billing@company.com'} ({company.legalName})</span>
                    </div>
                    <div className="flex items-center space-x-2 text-slate-600">
                      <span className="font-bold text-slate-700 w-16">Subject:</span>
                      <span className="font-bold text-slate-900 bg-white px-2 py-1 rounded border border-slate-200 flex-1">{interpolateVariables(emailSubject)}</span>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                    <p className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Message Content:</p>
                    <div className="text-slate-800 whitespace-pre-wrap leading-relaxed text-xs bg-slate-50/60 p-3 rounded-lg border border-slate-100 font-sans">
                      {interpolateVariables(emailBody)}
                    </div>
                  </div>

                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200 flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-indigo-900">
                      <ShieldCheck className="w-4 h-4 text-indigo-600" />
                      <span className="font-medium">Attached PDF:</span>
                    </div>
                    <span className="font-mono font-bold text-indigo-700">
                      {emailModalRecord.invoiceNumber}.pdf ({formatCurrency(emailModalRecord.totalAmount, company.currency)})
                    </span>
                  </div>
                </div>
              )}

              {activeTab === 'edit' && (
                <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200 flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-indigo-900">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <span className="font-medium">Attached PDF:</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-700">
                    {emailModalRecord.invoiceNumber}.pdf ({formatCurrency(emailModalRecord.totalAmount, company.currency)})
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {activeTab === 'edit' ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100 transition-colors cursor-pointer"
                  >
                    Preview Email →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveTab('edit')}
                    className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    ← Back to Edit
                  </button>
                )}

                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => setEmailModalRecord(null)}
                    className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSending}
                    className="flex items-center space-x-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-300 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-cyan-600/30 cursor-pointer"
                  >
                    {isSending ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Sending via {emailConfig.provider.toUpperCase()}...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Send Invoice Email</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
