/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GenerationRecord, CompanySettings, InvoiceTemplate } from '../types';
import { 
  Mail, 
  Send, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  CheckSquare, 
  Square,
  Server,
  RotateCcw,
  UserCheck
} from 'lucide-react';
import { formatCurrency } from '../utils/calculator';
import { EmailService, EmailSendStatus, EmailConfig, BatchEmailReport } from '../utils/emailService';
import { storage } from '../utils/storage';

interface EmailCenterViewProps {
  generationHistory: GenerationRecord[];
  company: CompanySettings;
  template: InvoiceTemplate;
  emailStatuses: Record<string, EmailSendStatus>;
  setEmailStatuses: React.Dispatch<React.SetStateAction<Record<string, EmailSendStatus>>>;
}

export const EmailCenterView: React.FC<EmailCenterViewProps> = ({
  generationHistory,
  company,
  template,
  emailStatuses,
  setEmailStatuses,
}) => {
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [emailConfig, setEmailConfig] = useState<EmailConfig>(() => storage.loadEmailConfig());
  const [emailSubject, setEmailSubject] = useState('Tax Invoice {{invoiceNumber}} from {{companyName}}');
  const [emailBody, setEmailBody] = useState('Dear {{customerName}},\n\nPlease find attached your tax invoice #{{invoiceNumber}} for {{totalAmount}} (Due Date: {{dueDate}}).\n\nPayment Method: {{paymentMethod}}\n\nThank you for your business!\n\nBest regards,\n{{companyName}}');
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [isSendingSingle, setIsSendingSingle] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [batchReport, setBatchReport] = useState<BatchEmailReport | null>(null);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(generationHistory[0]?.id || null);
  const [customRecipientEmail, setCustomRecipientEmail] = useState<string>('');
  const [actionNotification, setActionNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const filteredRecords = generationHistory.filter(record =>
    record.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.worksheetName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const previewRecord = generationHistory.find(r => r.id === activePreviewId) || filteredRecords[0] || generationHistory[0];

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
      setConnectionStatus({ success: false, message: 'Unexpected connection error.' });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedRecordIds.length === filteredRecords.length) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(filteredRecords.map(r => r.id));
    }
  };

  const handleToggleRecord = (id: string) => {
    setSelectedRecordIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const interpolateVariables = (text: string, record: GenerationRecord) => {
    if (!record) return text;
    const rowFields = record.dataSnapshot?.rowFields || {};
    return text
      .replace(/\{\{invoiceNumber\}\}/g, record.invoiceNumber)
      .replace(/\{\{customerName\}\}/g, record.customerName)
      .replace(/\{\{totalAmount\}\}/g, formatCurrency(record.totalAmount, company.currency))
      .replace(/\{\{generatedDate\}\}/g, record.generatedDate)
      .replace(/\{\{companyName\}\}/g, company.legalName || 'Company')
      .replace(/\{\{worksheetName\}\}/g, record.worksheetName)
      .replace(/\{\{dueDate\}\}/g, rowFields['due_date'] || rowFields['DueDate'] || 'N/A')
      .replace(/\{\{paymentMethod\}\}/g, rowFields['payment_method'] || rowFields['paymentMethod'] || 'N/A')
      .replace(/\{\{placeOfSupply\}\}/g, rowFields['place_of_supply'] || 'N/A');
  };

  const getRecipientEmailForRecord = (record: GenerationRecord) => {
    if (activePreviewId === record.id && customRecipientEmail.trim()) {
      return customRecipientEmail.trim();
    }
    const rowFields = record.dataSnapshot?.rowFields || {};
    return rowFields['customer_email'] || rowFields['Email'] || `${record.customerName.toLowerCase().replace(/[^a-z0-9]/g, '')}@client.com`;
  };

  const updateStatus = (recordId: string, status: EmailSendStatus) => {
    setEmailStatuses(prev => {
      const next = { ...prev, [recordId]: status };
      storage.saveEmailStatuses(next);
      return next;
    });
  };

  const handleSendSingleEmail = async (record: GenerationRecord) => {
    const recipient = getRecipientEmailForRecord(record);
    if (!recipient || !EmailService.validateEmail(recipient)) {
      setActionNotification({ type: 'error', text: `Recipient email "${recipient}" for invoice #${record.invoiceNumber} is invalid.` });
      return;
    }

    setIsSendingSingle(true);
    setActionNotification(null);
    updateStatus(record.id, 'pending');

    try {
      const result = await EmailService.sendInvoiceEmail({
        recipientEmail: recipient,
        subject: interpolateVariables(emailSubject, record),
        body: interpolateVariables(emailBody, record),
        record,
        config: emailConfig,
      });

      updateStatus(record.id, result.status);
      if (result.success) {
        setActionNotification({ type: 'success', text: `Email successfully dispatched for invoice #${record.invoiceNumber} to ${recipient}!` });
      } else {
        setActionNotification({ type: 'error', text: `Failed to send invoice #${record.invoiceNumber}: ${result.message}` });
      }
    } catch {
      updateStatus(record.id, 'failed');
      setActionNotification({ type: 'error', text: `An unexpected error occurred while transmitting invoice #${record.invoiceNumber}.` });
    } finally {
      setIsSendingSingle(false);
    }
  };

  const handleSendBatchEmails = async () => {
    if (selectedRecordIds.length === 0) {
      setActionNotification({ type: 'error', text: 'Please select at least one invoice to email.' });
      return;
    }

    setIsSendingBatch(true);
    setBatchReport(null);
    setBatchProgress({ current: 0, total: selectedRecordIds.length, message: 'Preparing batch email queue with recipient isolation...' });

    const requests = selectedRecordIds.map(recordId => {
      const record = generationHistory.find(r => r.id === recordId)!;
      const recipient = getRecipientEmailForRecord(record);
      return {
        recipientEmail: recipient,
        subject: interpolateVariables(emailSubject, record),
        body: interpolateVariables(emailBody, record),
        record,
        config: emailConfig,
      };
    });

    // Mark all as pending
    selectedRecordIds.forEach(id => updateStatus(id, 'pending'));

    const report = await EmailService.sendBatchEmails(requests, (current, total, result) => {
      setBatchProgress({
        current,
        total,
        message: `Transmitted invoice #${result.invoiceNumber} to ${result.recipientEmail} (${result.status})...`
      });
      if (result.invoiceNumber) {
        const found = generationHistory.find(r => r.invoiceNumber === result.invoiceNumber);
        if (found) {
          updateStatus(found.id, result.status);
        }
      }
    });

    setIsSendingBatch(false);
    setBatchReport(report);
    setBatchProgress(null);
  };

  const handleRetryFailed = () => {
    if (!batchReport) return;
    const failedIds = batchReport.results
      .filter(r => r.status === 'failed')
      .map(r => {
        const found = generationHistory.find(g => g.invoiceNumber === r.invoiceNumber);
        return found ? found.id : null;
      })
      .filter(Boolean) as string[];

    if (failedIds.length > 0) {
      setSelectedRecordIds(failedIds);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center space-x-2">
            <Mail className="w-7 h-7 text-indigo-600" />
            <span>Invoice Email Dispatcher</span>
          </h1>
          <p className="text-sm text-slate-500">
            Dispatch individual invoices or execute multi-recipient bulk email runs with guaranteed recipient isolation (each customer receives only their specific invoice).
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleSendBatchEmails}
            disabled={isSendingBatch || selectedRecordIds.length === 0}
            className="flex items-center space-x-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:bg-slate-300 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-cyan-600/30 transition-all cursor-pointer"
          >
            {isSendingBatch ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Sending ({batchProgress?.current || 0}/{batchProgress?.total || selectedRecordIds.length})...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Send Batch ({selectedRecordIds.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionNotification && (
        <div className={`p-4 rounded-2xl border text-sm flex items-center justify-between shadow-sm transition-all ${
          actionNotification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
          actionNotification.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-900' :
          'bg-indigo-50 border-indigo-200 text-indigo-900'
        }`}>
          <div className="flex items-center space-x-2 font-medium">
            <span>{actionNotification.type === 'success' ? '✓' : actionNotification.type === 'error' ? '⚠' : 'ℹ'}</span>
            <span>{actionNotification.text}</span>
          </div>
          <button 
            onClick={() => setActionNotification(null)}
            className="text-xs font-bold opacity-60 hover:opacity-100 px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Batch Progress Bar */}
      {batchProgress && (
        <div className="p-4 rounded-2xl border text-xs flex items-center space-x-3 shadow-sm bg-amber-50 border-amber-200 text-amber-900">
          <RefreshCw className="w-5 h-5 animate-spin text-amber-600 shrink-0" />
          <span className="font-semibold text-sm">{batchProgress.message}</span>
        </div>
      )}

      {/* Final Batch Report Card */}
      {batchReport && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-900 text-sm">Batch Email Dispatch Summary</h3>
            </div>
            <span className="text-xs text-slate-500 font-mono">{new Date(batchReport.timestamp).toLocaleTimeString()}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
              <span className="block text-xs font-semibold text-slate-500">Selected Invoices</span>
              <span className="text-lg font-bold text-slate-900">{batchReport.totalSelected}</span>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
              <span className="block text-xs font-semibold text-slate-500">Unique Recipients</span>
              <span className="text-lg font-bold text-indigo-700">{batchReport.totalRecipients}</span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 text-center">
              <span className="block text-xs font-semibold text-emerald-700">Successfully Sent</span>
              <span className="text-lg font-bold text-emerald-800">{batchReport.successCount}</span>
            </div>
            <div className="bg-rose-50 p-3 rounded-xl border border-rose-200 text-center">
              <span className="block text-xs font-semibold text-rose-700">Failed</span>
              <span className="text-lg font-bold text-rose-800">{batchReport.failureCount}</span>
            </div>
          </div>

          {batchReport.failureCount > 0 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-rose-700 font-medium">Some invoice emails could not be delivered.</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Invoice Selection Table (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search invoice number or customer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-600 outline-none"
              />
            </div>
            <div className="text-xs font-semibold text-slate-600 whitespace-nowrap">
              {selectedRecordIds.length} of {generationHistory.length} selected
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
                        title={selectedRecordIds.length === filteredRecords.length ? 'Deselect All' : 'Select All'}
                      >
                        {selectedRecordIds.length === filteredRecords.length && filteredRecords.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4">Invoice No</th>
                    <th className="py-3 px-4">Customer Name</th>
                    <th className="py-3 px-4">Recipient Email</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        No invoices found in generation history.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map(record => {
                      const isSelected = selectedRecordIds.includes(record.id);
                      const emailStatus = emailStatuses[record.id];
                      const isPreviewActive = activePreviewId === record.id;
                      const recipientEmail = getRecipientEmailForRecord(record);

                      return (
                        <tr 
                          key={record.id} 
                          className={`transition-colors cursor-pointer ${isPreviewActive ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
                          onClick={() => {
                            setActivePreviewId(record.id);
                            setCustomRecipientEmail('');
                          }}
                        >
                          <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleToggleRecord(record.id)}
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
                          <td className="py-3 px-4 text-slate-800 font-medium">
                            {record.customerName}
                          </td>
                          <td className="py-3 px-4 text-slate-600 font-mono text-xs truncate max-w-[150px]">
                            {recipientEmail}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 text-xs">
                            {formatCurrency(record.totalAmount, company.currency)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {emailStatus === 'sent' && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                                <CheckCircle2 className="w-3 h-3 text-cyan-600" />
                                <span>Sent</span>
                              </span>
                            )}
                            {emailStatus === 'pending' && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
                                <span>Sending</span>
                              </span>
                            )}
                            {emailStatus === 'failed' && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertCircle className="w-3 h-3 text-rose-600" />
                                <span>Failed</span>
                              </span>
                            )}
                            {!emailStatus && (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleSendSingleEmail(record)}
                              disabled={isSendingSingle || isSendingBatch}
                              className="px-2.5 py-1 rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-700 font-bold text-xs transition-all cursor-pointer inline-flex items-center space-x-1"
                              title="Send invoice directly to this customer"
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
                                isPreviewActive
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              {isPreviewActive ? 'Active' : 'Preview'}
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

        {/* Right Column: Gateway Settings, Template & Live Preview (1 Col) */}
        <div className="space-y-6">
          {/* Gateway Config Card */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center space-x-2 text-indigo-600">
                <Server className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 text-sm">SMTP / Mailgun Gateway</h3>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition-colors cursor-pointer inline-flex items-center space-x-1 border border-indigo-200"
              >
                {isTestingConnection ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Server className="w-3 h-3" />}
                <span>Test Connection</span>
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

            <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <span className="font-bold text-slate-700">Provider:</span>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="bulkEmailProvider"
                  checked={emailConfig.provider === 'smtp'}
                  onChange={() => handleUpdateEmailConfig({ ...emailConfig, provider: 'smtp' })}
                  className="text-indigo-600"
                />
                <span className="font-medium text-slate-800">Mock SMTP</span>
              </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="bulkEmailProvider"
                  checked={emailConfig.provider === 'mailgun'}
                  onChange={() => handleUpdateEmailConfig({ ...emailConfig, provider: 'mailgun' })}
                  className="text-indigo-600"
                />
                <span className="font-medium text-slate-800">Mailgun API</span>
              </label>
            </div>

            {emailConfig.provider === 'smtp' ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">SMTP Server</label>
                  <input
                    type="text"
                    value={emailConfig.smtpServer || ''}
                    onChange={(e) => handleUpdateEmailConfig({ ...emailConfig, smtpServer: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Port</label>
                  <input
                    type="text"
                    value={emailConfig.smtpPort || ''}
                    onChange={(e) => handleUpdateEmailConfig({ ...emailConfig, smtpPort: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs">
                <label className="block font-bold text-slate-700 mb-1">Mailgun Domain</label>
                <input
                  type="text"
                  value={emailConfig.mailgunDomain || ''}
                  onChange={(e) => handleUpdateEmailConfig({ ...emailConfig, mailgunDomain: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-xs"
                />
              </div>
            )}
          </div>

          {/* Template & Variables Card */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4 text-xs">
            <div className="flex items-center space-x-2 text-indigo-600 border-b border-slate-200 pb-3">
              <Mail className="w-5 h-5" />
              <h3 className="font-bold text-slate-900 text-sm">Email Template & Variables</h3>
            </div>

            <div className="bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100 space-y-1.5">
              <p className="font-bold text-indigo-900 text-[11px]">Click variable to insert into body:</p>
              <div className="flex flex-wrap gap-1">
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
              <label className="block font-bold text-slate-700 mb-1">Subject Template</label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-[11px]"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Body Template</label>
              <textarea
                rows={4}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed font-mono text-[11px]"
              />
            </div>
          </div>

          {/* Live Preview Card with Recipient Edit & Single Send */}
          {previewRecord ? (
            <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-md space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-cyan-400">Live Preview: #{previewRecord.invoiceNumber}</span>
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">{previewRecord.customerName}</span>
              </div>

              <div className="space-y-2 text-[11px]">
                <div>
                  <label className="block text-slate-400 text-[10px] mb-0.5 font-bold">Recipient Email Address:</label>
                  <input
                    type="email"
                    value={customRecipientEmail || getRecipientEmailForRecord(previewRecord)}
                    onChange={(e) => setCustomRecipientEmail(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs font-mono outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="space-y-1 font-mono text-slate-300">
                  <p><span className="text-slate-500">Subject:</span> <span className="text-white font-bold">{interpolateVariables(emailSubject, previewRecord)}</span></p>
                </div>
              </div>

              <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 text-slate-200 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                {interpolateVariables(emailBody, previewRecord)}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-slate-400 text-[11px]">
                <span className="flex items-center space-x-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Attachment: {previewRecord.invoiceNumber}.pdf</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleSendSingleEmail(previewRecord)}
                  disabled={isSendingSingle}
                  className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-all cursor-pointer inline-flex items-center space-x-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Send This Invoice</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
              Select an invoice from the table to preview email
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
