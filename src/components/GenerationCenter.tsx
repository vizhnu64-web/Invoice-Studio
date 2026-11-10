/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  SpreadsheetData, 
  CompanySettings, 
  InvoiceFieldConfig, 
  InvoiceTemplate, 
  GenerationRecord, 
  InvoiceItem,
  CalculationSettings
} from '../types';
import { 
  Download, 
  RefreshCw, 
  Eye, 
  PackageCheck,
  CheckCircle2,
  ExternalLink,
  Sliders,
  FileText,
  AlertCircle,
  Calculator,
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit3
} from 'lucide-react';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { 
  calculateItemTotals, 
  calculateInvoiceSummary, 
  formatCurrency,
  transformRowToInvoice,
  validateExcelMapping,
  buildAuditDataForRow
} from '../utils/calculator';
import JSZip from 'jszip';

interface GenerationCenterProps {
  spreadsheetData: SpreadsheetData;
  company: CompanySettings;
  fields: InvoiceFieldConfig[];
  template: InvoiceTemplate;
  generationHistory: GenerationRecord[];
  setGenerationHistory: (records: GenerationRecord[] | ((prev: GenerationRecord[]) => GenerationRecord[])) => void;
  calculationSettings?: CalculationSettings;
  setCalculationSettings?: (settings: CalculationSettings) => void;
}

interface PreviewModalData {
  row: Record<string, any>;
  rowFields: Record<string, any>;
  items: InvoiceItem[];
  summary: ReturnType<typeof calculateInvoiceSummary>;
}

export const GenerationCenter: React.FC<GenerationCenterProps> = ({
  spreadsheetData,
  company,
  fields,
  template,
  generationHistory,
  setGenerationHistory,
  calculationSettings = { mode: 'calculated', taxInclusive: false },
  setCalculationSettings,
}) => {
  const [selectedRowIndices, setSelectedRowIndices] = useState<number[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>('Invoice_Preview.pdf');
  const [previewData, setPreviewData] = useState<PreviewModalData | null>(null);
  const [previewTab, setPreviewTab] = useState<'sheet' | 'pdf' | 'audit'>('sheet');
  const [auditRowIndex, setAuditRowIndex] = useState<number>(0);
  const [showAuditPanel, setShowAuditPanel] = useState<boolean>(true);

  const [customEditedRows, setCustomEditedRows] = useState<Record<number, Record<string, any>>>({});
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, any>>({});

  const activeWorksheet = spreadsheetData.worksheets.find(ws => ws.name === spreadsheetData.activeSheetName) || spreadsheetData.worksheets[0];
  const rows = activeWorksheet ? activeWorksheet.rows : [];

  const validation = validateExcelMapping(fields, calculationSettings, rows);

  const handleSelectAll = () => {
    if (selectedRowIndices.length === rows.length) {
      setSelectedRowIndices([]);
    } else {
      setSelectedRowIndices(rows.map((_, idx) => idx));
    }
  };

  const handleToggleRow = (idx: number) => {
    setSelectedRowIndices(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleStartEdit = (idx: number, row: Record<string, any>) => {
    const effectiveRow = { ...row, ...(customEditedRows[idx] || {}) };
    const { rowFields, items } = transformRowToInvoice(effectiveRow, fields, calculationSettings, company, template);
    setEditingRowIndex(idx);
    setEditFormData({
      invoiceNumber: rowFields['invoice_number'] || `INV-${idx + 1}`,
      customerName: rowFields['customer_name'] || 'Customer',
      customerGstin: rowFields['customer_gstin'] || '',
      customerAddress: effectiveRow['Customer Address'] || effectiveRow['customer_address'] || '',
      itemName: effectiveRow['Item Name'] || effectiveRow['item_name'] || items[0]?.itemName || 'Professional Consulting & Mentorship Program',
      itemDescription: items[0]?.itemDescription || '',
      hsnSac: items[0]?.hsnSac || '9983',
      quantity: items[0]?.quantity || 1,
      rate: items[0]?.rate || 0,
      discount: items[0]?.discountAmount || 0,
      gstRate: items[0]?.gstPercentage || 18,
      subject: effectiveRow['Subject'] || effectiveRow['subject_description'] || '',
      notes: effectiveRow['Notes'] || effectiveRow['notes_content'] || company.content?.defaultNotes || '',
      terms: effectiveRow['Terms'] || effectiveRow['terms_content'] || company.content?.defaultTerms || ''
    });
  };

  const handleSaveEdit = (idx: number) => {
    const rowPatch: Record<string, any> = {
      'Invoice No': editFormData.invoiceNumber,
      'Customer Name': editFormData.customerName,
      'GSTIN': editFormData.customerGstin,
      'Customer Address': editFormData.customerAddress,
      'Item Name': editFormData.itemName,
      'Description': editFormData.itemDescription,
      'HSN/SAC': editFormData.hsnSac,
      'Quantity': editFormData.quantity,
      'Rate': editFormData.rate,
      'Discount': editFormData.discount,
      'GST %': editFormData.gstRate,
      'Subject': editFormData.subject,
      'Notes': editFormData.notes,
      'Terms': editFormData.terms,
      'invoice_number': editFormData.invoiceNumber,
      'customer_name': editFormData.customerName,
      'customer_gstin': editFormData.customerGstin,
      'customer_address': editFormData.customerAddress,
      'item_name': editFormData.itemName,
      'item_description': editFormData.itemDescription,
      'item_hsn': editFormData.hsnSac,
      'item_quantity': editFormData.quantity,
      'item_unit_price': editFormData.rate,
      'item_discount': editFormData.discount,
      'item_gst_rate': editFormData.gstRate,
      'subject_description': editFormData.subject,
      'notes_content': editFormData.notes,
      'terms_content': editFormData.terms,
    };

    setCustomEditedRows(prev => ({
      ...prev,
      [idx]: {
        ...(prev[idx] || {}),
        ...rowPatch
      }
    }));

    setEditingRowIndex(null);
  };

  const handlePreviewInvoice = (row: Record<string, any>, idx?: number) => {
    try {
      const effectiveRow = idx !== undefined ? { ...row, ...(customEditedRows[idx] || {}) } : row;
      const { rowFields, items, summary } = transformRowToInvoice(effectiveRow, fields, calculationSettings, company, template);
      const pdf = generateInvoicePDF({ company, items, fields: rowFields, template });
      const blob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const fileName = `${(rowFields['invoice_number'] || 'INV').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
      setPreviewFileName(fileName);
      setPreviewPdfUrl(blobUrl);
      setPreviewData({ row: effectiveRow, rowFields, items, summary });
      setPreviewTab('sheet');
    } catch (err) {
      console.error('Error generating preview:', err);
      showNotification('error', 'Failed to generate preview: ' + (err as Error).message);
    }
  };

  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(prev => prev?.message === message ? null : prev);
    }, 5000);
  };

  const handleClosePreview = () => {
    if (previewPdfUrl && previewPdfUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewPdfUrl);
    }
    setPreviewPdfUrl(null);
    setPreviewData(null);
  };

  const handleRegenerateRow = (row: Record<string, any>, idx?: number) => {
    const effectiveRow = idx !== undefined ? { ...row, ...(customEditedRows[idx] || {}) } : row;
    const { rowFields, items } = transformRowToInvoice(effectiveRow, fields, calculationSettings, company, template);
    const pdf = generateInvoicePDF({ company, items, fields: rowFields, template });
    const fileName = `${(rowFields['invoice_number'] || 'INV').replace(/[/\\?%*:|"<>]/g, '_')}_regenerated.pdf`;
    pdf.save(fileName);
    showNotification('success', `Regenerated invoice ${fileName}`);
  };

  const handleGenerateSelected = async (asZip: boolean = false, isRegenerate: boolean = false) => {
    if (selectedRowIndices.length === 0) {
      showNotification('error', 'Please select at least one record to generate invoices.');
      return;
    }

    if (!validation.isValid) {
      showNotification('error', `Cannot generate invoices due to mapping errors: ${validation.errors.join('; ')}. Please correct mappings in the Fields tab.`);
      return;
    }

    setIsGenerating(true);
    setProgressMsg(isRegenerate ? 'Regenerating selected invoices with latest settings...' : 'Initializing generation engine...');

    const zip = new JSZip();
    const newRecords: GenerationRecord[] = [];

    for (let i = 0; i < selectedRowIndices.length; i++) {
      const rowIndex = selectedRowIndices[i];
      const row = { ...rows[rowIndex], ...(customEditedRows[rowIndex] || {}) };
      setProgressMsg(`Processing invoice ${i + 1} of ${selectedRowIndices.length}...`);

      const { rowFields, items, summary } = transformRowToInvoice(row, fields, calculationSettings, company, template);

      const pdf = generateInvoicePDF({ company, items, fields: rowFields, template });
      const pdfBlob = pdf.output('blob');
      const prefix = isRegenerate ? 'Regenerated_' : '';
      const fileName = `${prefix}${(rowFields['invoice_number'] || `INV-${i+1}`).replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;

      if (asZip) {
        zip.file(fileName, pdfBlob);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(pdfBlob);
        link.download = fileName;
        link.click();
      }

      newRecords.push({
        id: Math.random().toString(36).substr(2, 9),
        invoiceNumber: rowFields['invoice_number'] || `2627/11/TBT/${i+1}`,
        customerName: rowFields['customer_name'] || 'Customer',
        sourceType: 'excel',
        sourceName: spreadsheetData.fileName,
        worksheetName: activeWorksheet.name,
        generatedDate: new Date().toISOString().split('T')[0],
        totalAmount: summary.totalInvoiceAmount,
        gstAmount: summary.totalTax,
        templateId: template.id,
        profileId: 'profile_tbt90days',
        revisionNumber: isRegenerate ? 2 : 1,
        status: 'success',
        dataSnapshot: { rowFields, items },
        paymentMethod: rowFields['payment_method'] || 'UPI',
        paymentStatus: rowFields['payment_status'] || 'Paid',
        paymentDate: rowFields['payment_date'] || rowFields['invoice_date'] || '',
        paymentReference: rowFields['payment_reference'] || '',
        paymentAmount: Number(rowFields['amount_paid'] || summary.totalInvoiceAmount),
        paymentNotes: rowFields['payment_notes'] || ''
      });
    }

    if (asZip && selectedRowIndices.length > 0) {
      setProgressMsg('Compressing ZIP archive...');
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `Invoices_Batch_${Date.now()}.zip`;
      link.click();
    }

    setGenerationHistory(prev => [...newRecords, ...prev]);
    setIsGenerating(false);
    setProgressMsg('');
    showNotification('success', `Successfully ${isRegenerate ? 'regenerated' : 'generated'} ${selectedRowIndices.length} invoice(s)!`);
  };

  const handleClearGenerationData = () => {
    setSelectedRowIndices([]);
    showNotification('info', 'Cleared selected records.');
  };

  const brandPrimary = company.brandPalette?.primaryColor || '#4f46e5';
  const brandHeading = company.brandPalette?.headingColor || '#1e293b';
  const brandTableBg = company.brandPalette?.tableHeaderBg || brandPrimary;
  const brandTableText = company.brandPalette?.tableHeaderText || '#ffffff';
  const brandHighlight = company.brandPalette?.totalHighlightColor || brandPrimary;

  const activeBank = company.bankAccounts.find(b => b.id === company.activeBankId) || 
    company.bankAccounts.find(b => b.isDefault) || 
    company.bankAccounts[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {notification && (
        <div className={`p-4 rounded-xl flex items-center justify-between border shadow-sm transition-all ${
          notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
          notification.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-900' :
          'bg-indigo-50 border-indigo-200 text-indigo-900'
        }`}>
          <div className="flex items-center space-x-2 text-sm font-semibold">
            <span>{notification.type === 'success' ? '✓' : notification.type === 'error' ? '⚠' : 'ℹ'}</span>
            <span>{notification.message}</span>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-xs font-bold opacity-60 hover:opacity-100 px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Generation Control Center</h1>
          <p className="text-sm text-slate-500">
            Select records from worksheet, verify calculations, preview invoices, and generate high-fidelity PDFs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleGenerateSelected(false, false)}
            disabled={isGenerating || selectedRowIndices.length === 0}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm"
          >
            {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>Generate Selected ({selectedRowIndices.length})</span>
          </button>

          <button
            onClick={() => handleGenerateSelected(false, true)}
            disabled={isGenerating || selectedRowIndices.length === 0}
            className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Regenerate All Selected</span>
          </button>

          <button
            onClick={() => handleGenerateSelected(true, false)}
            disabled={isGenerating || selectedRowIndices.length === 0}
            className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm"
          >
            <PackageCheck className="w-4 h-4 text-cyan-400" />
            <span>ZIP Export</span>
          </button>

          <button
            onClick={handleClearGenerationData}
            disabled={selectedRowIndices.length === 0}
            className="flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-700 px-3.5 py-2.5 rounded-xl text-sm font-bold border border-rose-200 transition-all cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear All</span>
          </button>
        </div>
      </div>

      {/* Calculation Mode Quick Bar */}
      {setCalculationSettings && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Calculation Mode</span>
              <span className="text-sm font-semibold text-slate-900">
                {calculationSettings.mode === 'calculated' ? 'Calculated (Qty × Rate − Disc + GST)' : 'Excel Amount Mode (Direct Column)'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setCalculationSettings({ ...calculationSettings, mode: 'calculated' })}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  calculationSettings.mode === 'calculated'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Calculated Mode
              </button>
              <button
                type="button"
                onClick={() => setCalculationSettings({ ...calculationSettings, mode: 'excel_amount' })}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  calculationSettings.mode === 'excel_amount'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Excel Amount Mode
              </button>
            </div>

            {calculationSettings.mode === 'excel_amount' && (
              <label className="flex items-center space-x-2 bg-indigo-50/70 text-indigo-900 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border border-indigo-200">
                <input
                  type="checkbox"
                  checked={calculationSettings.taxInclusive}
                  onChange={(e) => setCalculationSettings({ ...calculationSettings, taxInclusive: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span>Excel Amount includes GST</span>
              </label>
            )}

            <button
              onClick={() => setShowAuditPanel(prev => !prev)}
              className="flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAuditPanel ? 'Hide Audit' : 'Show Audit'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Validation Warning / Error Banner */}
      {!validation.isValid && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-start space-x-3 text-red-900">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-bold">Excel Mapping Validation Error:</p>
            <ul className="list-disc list-inside space-y-0.5 text-red-700">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {validation.warnings.length > 0 && validation.isValid && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start space-x-3 text-amber-900">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-bold">Excel Mapping Notice:</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
              {validation.warnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Import Validation & Calculation Audit View (Section 6 Requirement) */}
      {showAuditPanel && rows.length > 0 && (
        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-wide text-white flex items-center space-x-2">
                  <span>Import Validation & Calculation Audit</span>
                  <span className="text-xs font-mono font-normal bg-indigo-500/30 text-indigo-300 px-2.5 py-0.5 rounded-full">
                    Row #{auditRowIndex + 1} of {rows.length}
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Verifies raw Excel cell values vs. parsed invoice values according to the active calculation mode.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 font-medium">Inspect Row:</span>
              <select
                value={auditRowIndex}
                onChange={(e) => setAuditRowIndex(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-1.5 outline-none font-medium"
              >
                {rows.map((r, i) => (
                  <option key={i} value={i}>
                    Row #{i + 1} - {r['Invoice No'] || r['Invoice Number'] || r['Inv #'] || `Record ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800/80 text-slate-300 border-b border-slate-700">
                  <th className="py-2.5 px-4 font-semibold">Field</th>
                  <th className="py-2.5 px-4 font-semibold">Excel Source Column</th>
                  <th className="py-2.5 px-4 font-semibold">Imported Value (Raw Excel)</th>
                  <th className="py-2.5 px-4 font-semibold">Final Invoice Value (Parsed)</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-sans">
                {buildAuditDataForRow(rows[auditRowIndex] || rows[0], fields, calculationSettings, company.currency).map((auditRow) => (
                  <tr key={auditRow.field} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-200">{auditRow.field}</td>
                    <td className="py-3 px-4 font-mono text-indigo-300">
                      {auditRow.sourceColumn}
                    </td>
                    <td className="py-3 px-4 font-mono text-amber-300">
                      {auditRow.importedValue}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                      {auditRow.finalValue}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        auditRow.isMapped ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'
                      }`}>
                        {auditRow.isMapped ? 'Mapped' : 'Unmapped / Default'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-2xl flex items-center space-x-3 text-indigo-900">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
          <span className="font-semibold text-sm">{progressMsg}</span>
        </div>
      )}

      {/* Records Selection Table */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Select Records from Worksheet: <span className="text-indigo-600">{activeWorksheet?.name}</span>
            </h2>
            <p className="text-xs text-slate-500">Choose rows to include in this generation batch</p>
          </div>
          <button
            onClick={handleSelectAll}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-200"
          >
            {selectedRowIndices.length === rows.length ? 'Deselect All' : 'Select All Rows'}
          </button>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                <th className="py-3 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={selectedRowIndices.length === rows.length && rows.length > 0}
                    onChange={handleSelectAll}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="py-3 px-4">#</th>
                {activeWorksheet?.headers.slice(0, 5).map((header, hIdx) => (
                  <th key={`${header}_${hIdx}`} className="py-3 px-4 whitespace-nowrap">{header}</th>
                ))}
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {rows.map((row, idx) => {
                const isSelected = selectedRowIndices.includes(idx);
                return (
                  <tr key={idx} className={`hover:bg-slate-50/80 ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                    <td className="py-3 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleRow(idx)}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">{idx + 1}</td>
                    {activeWorksheet.headers.slice(0, 5).map((header, cIdx) => (
                      <td key={`${header}_${cIdx}`} className="py-3 px-4 text-slate-800 whitespace-nowrap">
                        {String(row[header] !== undefined ? row[header] : '')}
                      </td>
                    ))}
                    <td className="py-3 px-4 text-right space-x-1.5">
                      <button
                        onClick={() => handleStartEdit(idx, row)}
                        className="inline-flex items-center space-x-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
                        title="Edit Invoice Fields"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => { setAuditRowIndex(idx); setShowAuditPanel(true); }}
                        className="inline-flex items-center space-x-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
                        title="Audit Excel values and calculations"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Audit</span>
                      </button>
                      <button
                        onClick={() => handlePreviewInvoice(row, idx)}
                        className="inline-flex items-center space-x-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </button>
                      <button
                        onClick={() => handleRegenerateRow(row, idx)}
                        className="inline-flex items-center space-x-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Regenerate</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* PDF & Visual Sheet Preview Modal */}
      {previewData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center space-x-3">
                <h3 className="text-base font-bold text-slate-900">
                  Invoice Preview: <span className="font-mono text-indigo-600">{previewData.rowFields['invoice_number']}</span>
                </h3>

                {/* View Mode Toggle */}
                <div className="flex items-center space-x-1 bg-white p-1 rounded-lg border border-slate-200">
                  <button
                    onClick={() => setPreviewTab('sheet')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                      previewTab === 'sheet' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Visual Sheet
                  </button>
                  <button
                    onClick={() => setPreviewTab('pdf')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                      previewTab === 'pdf' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Embedded PDF
                  </button>
                  <button
                    onClick={() => setPreviewTab('audit')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                      previewTab === 'audit' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Calculation Audit
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {previewPdfUrl && (
                  <a
                    href={previewPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Tab</span>
                  </a>
                )}
                {previewPdfUrl && (
                  <a
                    href={previewPdfUrl}
                    download={previewFileName}
                    className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </a>
                )}
                <button
                  onClick={handleClosePreview}
                  className="text-slate-400 hover:text-slate-600 font-bold text-lg px-2"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 bg-slate-100 p-6 overflow-y-auto">
              {previewTab === 'sheet' ? (
                /* High-fidelity Visual Sheet */
                <div className="w-[794px] min-h-[1050px] mx-auto bg-white rounded-lg shadow-xl border border-slate-300 p-10 flex flex-col justify-between text-slate-800 text-[11px] leading-relaxed relative">
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="border-b border-slate-200 pb-5">
                      {company.assets?.logoUrl && (
                        <div 
                          className="mb-3 flex"
                          style={{
                            justifyContent: 
                              company.assets.logoAlignment === 'center' ? 'center' :
                              company.assets.logoAlignment === 'right' ? 'flex-end' : 'flex-start'
                          }}
                        >
                          <img 
                            src={company.assets.logoUrl} 
                            alt="Logo" 
                            style={{ 
                              width: `${company.assets.logoWidth || 40}mm`, 
                              maxHeight: `${company.assets.logoHeight || 20}mm` 
                            }}
                            className="object-contain" 
                          />
                        </div>
                      )}

                      <div className="flex justify-between items-start">
                        <div className="space-y-1 max-w-[60%]">
                          <h2 className="text-lg font-bold" style={{ color: brandHeading }}>
                            {previewData.rowFields['company_legal_name'] || company.legalName}
                          </h2>
                          <p className="text-slate-600 text-xs">
                            {previewData.rowFields['company_address'] || `${company.addressLine1}, ${company.city}`}
                          </p>
                          <p className="text-slate-500 text-[10px]">
                            GSTIN: <span className="font-mono font-medium text-slate-700">{previewData.rowFields['company_gstin'] || company.gstin}</span>
                            {company.email && ` | Email: ${company.email}`}
                            {company.phone && ` | Phone: ${company.phone}`}
                          </p>
                          {(company.pan || company.cin) && (
                            <p className="text-slate-500 text-[10px]">
                              {company.pan && `PAN: ${company.pan}`}
                              {company.pan && company.cin && ' | '}
                              {company.cin && `CIN: ${company.cin}`}
                            </p>
                          )}
                        </div>

                        <div className="text-right space-y-1">
                          <h3 className="text-base font-extrabold tracking-tight uppercase" style={{ color: brandPrimary }}>
                            {previewData.rowFields['invoice_title'] || 'TAX INVOICE'}
                          </h3>
                          <p className="font-bold text-slate-900 text-xs">
                            Invoice No: <span className="font-mono">{previewData.rowFields['invoice_number']}</span>
                          </p>
                          <p className="text-slate-500 text-[11px]">
                            Date: <span className="font-mono">{previewData.rowFields['invoice_date'] || '2026-11-01'}</span>
                          </p>
                          <p className="text-slate-500 text-[11px]">
                            Place of Supply: <span className="font-medium text-slate-700">{previewData.rowFields['place_of_supply'] || `${company.state} (06)`}</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Customer Section */}
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {template.labels?.['bill_to'] || 'Billed To (Customer Details):'}
                      </p>
                      <h4 className="font-bold text-slate-900 text-xs">{previewData.rowFields['customer_name']}</h4>
                      {previewData.rowFields['customer_business'] && (
                        <p className="text-slate-600 font-medium">{previewData.rowFields['customer_business']}</p>
                      )}
                      <p className="text-slate-500 text-xs">{previewData.rowFields['customer_address']}</p>
                      {previewData.rowFields['customer_gstin'] && (
                        <p className="text-slate-500 text-xs">
                          Customer GSTIN: <span className="font-mono">{previewData.rowFields['customer_gstin']}</span>
                        </p>
                      )}
                    </div>

                    {/* Subject */}
                    {previewData.rowFields['subject_description'] && (
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center space-x-2">
                        <span className="font-bold text-slate-800 text-xs">Subject:</span>
                        <span className="text-slate-700 text-xs">{previewData.rowFields['subject_description']}</span>
                      </div>
                    )}

                    {/* Table */}
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr style={{ backgroundColor: brandTableBg, color: brandTableText }}>
                            <th className="py-2.5 px-3 w-8 text-center font-bold">#</th>
                            <th className="py-2.5 px-3 font-bold">Item & Description</th>
                            <th className="py-2.5 px-3 w-20 text-center font-bold">HSN/SAC</th>
                            <th className="py-2.5 px-3 w-16 text-center font-bold">Qty</th>
                            <th className="py-2.5 px-3 w-24 text-right font-bold">Rate</th>
                            <th className="py-2.5 px-3 w-24 text-right font-bold">Taxable Amt</th>
                            <th className="py-2.5 px-3 w-16 text-center font-bold">GST</th>
                            <th className="py-2.5 px-3 w-24 text-right font-bold">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {previewData.items.map((item, i) => (
                            <tr key={item.id || i}>
                              <td className="py-3 px-3 text-center text-slate-500 font-mono">{i + 1}</td>
                              <td className="py-3 px-3">
                                <p className="font-bold text-slate-900">{item.itemName}</p>
                                {item.itemDescription && item.itemDescription !== item.itemName && (
                                  <p className="text-[10px] text-slate-500 mt-0.5">{item.itemDescription}</p>
                                )}
                              </td>
                              <td className="py-3 px-3 text-center font-mono text-slate-600">{item.hsnSac}</td>
                              <td className="py-3 px-3 text-center text-slate-700">{item.quantity} {item.unit || 'Nos'}</td>
                              <td className="py-3 px-3 text-right font-mono text-slate-800">{formatCurrency(item.rate, company.currency)}</td>
                              <td className="py-3 px-3 text-right font-mono text-slate-800">{formatCurrency(item.taxableAmount, company.currency)}</td>
                              <td className="py-3 px-3 text-center text-slate-700">{item.gstPercentage}%</td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">{formatCurrency(item.itemTotal, company.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Summary */}
                    <div className="grid grid-cols-12 gap-6 pt-2">
                      <div className="col-span-7 space-y-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount in Words:</p>
                          <p className="italic font-medium text-slate-700 text-xs">
                            {previewData.summary.amountInWords}
                          </p>
                        </div>

                        {activeBank && (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
                            <p className="font-bold text-slate-900">Bank Details for Transfer:</p>
                            <p className="text-slate-600">Bank: <span className="font-medium text-slate-800">{activeBank.bankName}</span> ({activeBank.branch})</p>
                            <p className="text-slate-600">Account Name: <span className="font-medium text-slate-800">{activeBank.accountHolderName}</span></p>
                            <p className="text-slate-600">A/c No: <span className="font-mono font-medium text-slate-800">{activeBank.accountNumber}</span> | IFSC: <span className="font-mono font-medium text-slate-800">{activeBank.ifscCode}</span></p>
                            {activeBank.upiId && <p className="text-slate-600">UPI ID: <span className="font-mono font-medium text-slate-800">{activeBank.upiId}</span></p>}
                          </div>
                        )}

                        {company.content?.defaultNotes && (
                          <div className="space-y-1 text-xs">
                            <p className="font-bold text-slate-900">Notes:</p>
                            <p className="text-slate-600 leading-relaxed">{previewData.rowFields['notes_content'] || company.content.defaultNotes}</p>
                          </div>
                        )}
                      </div>

                      <div className="col-span-5 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                        <div className="flex justify-between text-slate-600">
                          <span>{template.labels?.['subtotal'] || 'Subtotal'}:</span>
                          <span className="font-mono font-medium text-slate-900">{formatCurrency(previewData.summary.subtotal, company.currency)}</span>
                        </div>
                        {previewData.summary.totalIgst > 0 && (
                          <div className="flex justify-between text-slate-600">
                            <span>IGST Total:</span>
                            <span className="font-mono font-medium text-slate-900">{formatCurrency(previewData.summary.totalIgst, company.currency)}</span>
                          </div>
                        )}
                        <div className="border-t border-slate-300 pt-2 flex justify-between font-bold text-sm">
                          <span style={{ color: brandHighlight }}>Total Invoice Amount:</span>
                          <span className="font-mono" style={{ color: brandHighlight }}>{formatCurrency(previewData.summary.totalInvoiceAmount, company.currency)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600 text-[11px]">
                          <span>Payment Received:</span>
                          <span className="font-mono text-emerald-600">{formatCurrency(previewData.summary.totalInvoiceAmount, company.currency)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-xs text-slate-900">
                          <span>Balance Due:</span>
                          <span className="font-mono">{formatCurrency(0, company.currency)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Terms & Signature */}
                    <div className="grid grid-cols-12 gap-6 pt-4 border-t border-slate-200">
                      <div className="col-span-7">
                        <div className="space-y-1 text-[10px]">
                          <p className="font-bold text-slate-800 uppercase tracking-wide">Terms & Conditions:</p>
                          <p className="text-slate-500 whitespace-pre-line leading-relaxed">
                            {previewData.rowFields['terms_content'] || company.content?.defaultTerms || '1. Goods once sold will not be taken back.'}
                          </p>
                        </div>
                      </div>

                      <div className="col-span-5 text-right space-y-2">
                        <p className="font-bold text-slate-900 text-xs">
                          {company.signatureHeading || `For ${company.legalName}`}
                        </p>
                        {company.assets?.signatureUrl ? (
                          <div className="my-2 flex justify-end">
                            <img 
                              src={company.assets.signatureUrl} 
                              alt="Signature" 
                              style={{
                                width: `${company.assets.signatureWidth || 35}mm`,
                                maxHeight: `${company.assets.signatureHeight || 15}mm`
                              }}
                              className="object-contain"
                            />
                          </div>
                        ) : (
                          <div className="h-10" />
                        )}
                        <p className="font-medium text-slate-900 text-xs">{company.authorizedPerson || 'Authorized Signatory'}</p>
                        <p className="text-slate-500 text-[10px]">({company.designation || 'Director'})</p>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-slate-200 pt-3 mt-6 flex justify-between items-center text-[10px] text-slate-500">
                    <span>{company.content?.footerMessage || 'This is a computer generated invoice powered by Invoice Studio.'}</span>
                    <span>Page 1 of 1</span>
                  </div>
                </div>
              ) : previewTab === 'pdf' ? (
                /* Native PDF Embed View */
                <div className="w-full h-full min-h-[750px] bg-white rounded-xl shadow-md border border-slate-300 p-2 overflow-hidden">
                  {previewPdfUrl ? (
                    <iframe 
                      src={previewPdfUrl} 
                      className="w-full h-full rounded-lg border-0 bg-white" 
                      title="Native PDF Preview" 
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      Loading PDF...
                    </div>
                  )}
                </div>
              ) : (
                /* Calculation Audit View */
                <div className="max-w-4xl mx-auto space-y-4">
                  <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-4">
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                          <Sliders className="w-4 h-4 text-indigo-400" />
                          <span>Detailed Excel Import & Calculation Audit</span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Invoice: <span className="text-indigo-300 font-mono font-medium">{previewData.rowFields['invoice_number']}</span> | Customer: <span className="text-slate-200 font-medium">{previewData.rowFields['customer_name']}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          Mode: {calculationSettings.mode === 'calculated' ? 'Calculated (Qty × Rate)' : 'Mapped Excel Amount'}
                        </span>
                        {calculationSettings.mode === 'excel_amount' && (
                          <span className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                            calculationSettings.taxInclusive 
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' 
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          }`}>
                            {calculationSettings.taxInclusive ? 'Amount Includes GST' : 'Amount Excludes GST'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto border border-slate-800 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-800/80 text-slate-300 border-b border-slate-700">
                            <th className="py-2.5 px-4 font-semibold">Field</th>
                            <th className="py-2.5 px-4 font-semibold">Excel Source Column</th>
                            <th className="py-2.5 px-4 font-semibold">Imported Raw Value</th>
                            <th className="py-2.5 px-4 font-semibold">Final Parsed Value</th>
                            <th className="py-2.5 px-4 font-semibold text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 font-sans">
                          {buildAuditDataForRow(previewData.row, fields, calculationSettings, company.currency).map((auditRow) => (
                            <tr key={auditRow.field} className="hover:bg-slate-800/50 transition-colors">
                              <td className="py-3 px-4 font-bold text-slate-200">{auditRow.field}</td>
                              <td className="py-3 px-4 font-mono text-indigo-300">
                                {auditRow.sourceColumn}
                              </td>
                              <td className="py-3 px-4 font-mono text-amber-300">
                                {auditRow.importedValue}
                              </td>
                              <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                                {auditRow.finalValue}
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  auditRow.isMapped ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'
                                }`}>
                                  {auditRow.isMapped ? 'Mapped' : 'Unmapped / Default'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comprehensive Edit Modal for All Invoice Fields */}
      {editingRowIndex !== null && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Edit Invoice Fields (Row #{editingRowIndex + 1})
                </h3>
                <p className="text-xs text-slate-500">
                  Override or add any invoice information independently of Excel spreadsheet columns.
                </p>
              </div>
              <button
                onClick={() => setEditingRowIndex(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Invoice Number</label>
                  <input
                    type="text"
                    value={editFormData.invoiceNumber || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, invoiceNumber: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={editFormData.customerName || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, customerName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Customer GSTIN</label>
                  <input
                    type="text"
                    value={editFormData.customerGstin || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, customerGstin: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Customer Address</label>
                  <input
                    type="text"
                    value={editFormData.customerAddress || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, customerAddress: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Item Name</label>
                  <input
                    type="text"
                    value={editFormData.itemName || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, itemName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">HSN / SAC</label>
                  <input
                    type="text"
                    value={editFormData.hsnSac || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, hsnSac: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">GST Rate (%)</label>
                  <input
                    type="number"
                    value={editFormData.gstRate || 18}
                    onChange={(e) => setEditFormData({ ...editFormData, gstRate: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Item Description / Service Details</label>
                <textarea
                  rows={2}
                  value={editFormData.itemDescription || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, itemDescription: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={editFormData.quantity || 1}
                    onChange={(e) => setEditFormData({ ...editFormData, quantity: parseFloat(e.target.value) || 1 })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Unit Price / Rate</label>
                  <input
                    type="number"
                    value={editFormData.rate || 0}
                    onChange={(e) => setEditFormData({ ...editFormData, rate: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Line Discount</label>
                  <input
                    type="number"
                    value={editFormData.discount || 0}
                    onChange={(e) => setEditFormData({ ...editFormData, discount: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Invoice Subject</label>
                <input
                  type="text"
                  value={editFormData.subject || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, subject: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Professional Consulting & Mentorship Program"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Invoice Notes</label>
                  <textarea
                    rows={2}
                    value={editFormData.notes || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Terms & Conditions</label>
                  <textarea
                    rows={2}
                    value={editFormData.terms || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, terms: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
              <button
                onClick={() => setEditingRowIndex(null)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveEdit(editingRowIndex)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center space-x-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save All Overrides</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
