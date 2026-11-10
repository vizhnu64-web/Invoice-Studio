/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  SpreadsheetData, 
  InvoiceFieldConfig, 
  CompanySettings, 
  AdvancedAmountCalculationSettings, 
  GstConfigurationSettings 
} from '../../types';
import { 
  Search, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  ArrowLeft,
  Filter,
  Eye,
  FileSpreadsheet
} from 'lucide-react';
import { formatCurrency, transformRowToInvoice } from '../../utils/calculator';

interface Step5ReviewDataProps {
  spreadsheetData: SpreadsheetData;
  selectedWorksheetName: string;
  startRowIndex: number;
  endRowIndex: number | undefined;
  fields: InvoiceFieldConfig[];
  company: CompanySettings;
  amountSettings: AdvancedAmountCalculationSettings;
  gstSettings: GstConfigurationSettings;
  customEditedRows: Record<number, Record<string, any>>;
  setCustomEditedRows: React.Dispatch<React.SetStateAction<Record<number, Record<string, any>>>>;
  onBackToMapping: () => void;
  onBackToCalculations: () => void;
  onContinue: () => void;
}

export const Step5ReviewData: React.FC<Step5ReviewDataProps> = ({
  spreadsheetData,
  selectedWorksheetName,
  startRowIndex,
  endRowIndex,
  fields,
  company,
  amountSettings,
  gstSettings,
  customEditedRows,
  setCustomEditedRows,
  onBackToMapping,
  onBackToCalculations,
  onContinue,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, any>>({});
  const [excludedRowIndices, setExcludedRowIndices] = useState<number[]>([]);

  const activeWorksheet = spreadsheetData.worksheets.find(
    ws => ws.name === (selectedWorksheetName || spreadsheetData.activeSheetName)
  ) || spreadsheetData.worksheets[0];

  const rawRows = activeWorksheet?.rows || [];
  const effectiveEndRow = endRowIndex !== undefined && endRowIndex <= rawRows.length ? endRowIndex : rawRows.length;
  const rangedRows = rawRows.slice(startRowIndex, effectiveEndRow);

  // Compute transformed invoices for each row
  const transformedRows = useMemo(() => {
    return rangedRows.map((originalRow, localIdx) => {
      const globalIdx = startRowIndex + localIdx;
      // Merge with custom edited values if any
      const effectiveRow = {
        ...originalRow,
        ...(customEditedRows[globalIdx] || {})
      };

      const calcSettings = {
        mode: (amountSettings.taxableAmount.method === 'excel_column' ? 'excel_amount' : 'calculated') as 'calculated' | 'excel_amount',
        taxInclusive: gstSettings.pricingType === 'inclusive'
      };

      const transformed = transformRowToInvoice(effectiveRow, fields, calcSettings, company, undefined);

      return {
        globalIdx,
        originalRow,
        effectiveRow,
        invoiceNumber: transformed.rowFields['invoice_number'] || `INV-${globalIdx + 1}`,
        customerName: transformed.rowFields['customer_name'] || 'Unspecified Customer',
        customerGstin: transformed.rowFields['customer_gstin'] || '',
        invoiceDate: transformed.rowFields['invoice_date'] || '2026-11-01',
        itemDescription: transformed.items[0]?.itemDescription || transformed.items[0]?.itemName || '',
        quantity: transformed.items[0]?.quantity || 1,
        unit: transformed.items[0]?.unit || 'Nos',
        rate: transformed.items[0]?.rate || 0,
        discount: transformed.items[0]?.discountAmount || 0,
        taxableAmount: transformed.items[0]?.taxableAmount || 0,
        gstRate: transformed.items[0]?.gstPercentage || (gstSettings.enabled ? gstSettings.fixedRate : 0),
        taxTotal: transformed.summary.totalTax,
        grandTotal: transformed.summary.totalInvoiceAmount,
        isValid: Boolean(transformed.rowFields['invoice_number'] && transformed.rowFields['customer_name'])
      };
    });
  }, [rangedRows, customEditedRows, startRowIndex, fields, company, amountSettings, gstSettings]);

  // Filter out excluded rows & apply search
  const visibleRows = useMemo(() => {
    return transformedRows.filter(r => {
      if (excludedRowIndices.includes(r.globalIdx)) return false;
      if (!searchTerm.trim()) return true;
      const s = searchTerm.toLowerCase();
      return (
        r.invoiceNumber.toLowerCase().includes(s) ||
        r.customerName.toLowerCase().includes(s) ||
        r.itemDescription.toLowerCase().includes(s) ||
        r.customerGstin.toLowerCase().includes(s)
      );
    });
  }, [transformedRows, excludedRowIndices, searchTerm]);

  const handleStartEdit = (rowItem: typeof transformedRows[0]) => {
    setEditingRowIndex(rowItem.globalIdx);
    setEditFormData({
      invoiceNumber: rowItem.invoiceNumber,
      customerName: rowItem.customerName,
      customerGstin: rowItem.customerGstin,
      customerAddress: rowItem.effectiveRow['Customer Address'] || rowItem.effectiveRow['customer_address'] || '',
      itemName: rowItem.effectiveRow['Item Name'] || rowItem.effectiveRow['item_name'] || 'Professional Consulting & Mentorship Program',
      itemDescription: rowItem.itemDescription,
      hsnSac: rowItem.effectiveRow['HSN/SAC'] || rowItem.effectiveRow['item_hsn'] || '9983',
      quantity: rowItem.quantity,
      rate: rowItem.rate,
      discount: rowItem.discount,
      gstRate: rowItem.gstRate,
      subject: rowItem.effectiveRow['Subject'] || rowItem.effectiveRow['subject_description'] || '',
      notes: rowItem.effectiveRow['Notes'] || rowItem.effectiveRow['notes_content'] || '',
      terms: rowItem.effectiveRow['Terms'] || rowItem.effectiveRow['terms_content'] || ''
    });
  };

  const handleSaveEdit = (globalIdx: number) => {
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

    const invCol = fields.find(f => f.id === 'invoice_number')?.sourceColumn;
    const custCol = fields.find(f => f.id === 'customer_name')?.sourceColumn;
    const gstinCol = fields.find(f => f.id === 'customer_gstin')?.sourceColumn;
    const descCol = fields.find(f => f.id === 'item_description')?.sourceColumn;
    const qtyCol = fields.find(f => f.id === 'item_quantity')?.sourceColumn;
    const rateCol = fields.find(f => f.id === 'item_unit_price')?.sourceColumn;
    const discCol = fields.find(f => f.id === 'item_discount')?.sourceColumn;

    if (invCol) rowPatch[invCol] = editFormData.invoiceNumber;
    if (custCol) rowPatch[custCol] = editFormData.customerName;
    if (gstinCol) rowPatch[gstinCol] = editFormData.customerGstin;
    if (descCol) rowPatch[descCol] = editFormData.itemDescription;
    if (qtyCol) rowPatch[qtyCol] = editFormData.quantity;
    if (rateCol) rowPatch[rateCol] = editFormData.rate;
    if (discCol) rowPatch[discCol] = editFormData.discount;

    setCustomEditedRows(prev => ({
      ...prev,
      [globalIdx]: {
        ...(prev[globalIdx] || {}),
        ...rowPatch
      }
    }));

    setEditingRowIndex(null);
  };

  const handleToggleExcludeRow = (globalIdx: number) => {
    setExcludedRowIndices(prev => 
      prev.includes(globalIdx) ? prev.filter(i => i !== globalIdx) : [...prev, globalIdx]
    );
  };

  const totalCalculatedBatchAmount = visibleRows.reduce((acc, r) => acc + r.grandTotal, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Step 5: Review & Audit Imported Data</h2>
          <p className="text-sm text-slate-600 mt-1">
            Review every calculated invoice row before finalization. You can edit individual cells, override any invoice field (even if not present in Excel), or exclude unneeded records.
          </p>
        </div>

        <div className="flex items-center space-x-3 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 text-xs">
          <div>
            <span className="text-slate-500 font-medium">Batch Total:</span>
            <p className="font-bold text-emerald-600 font-mono text-sm">
              {formatCurrency(totalCalculatedBatchAmount, company.currency)}
            </p>
          </div>
          <div className="border-l border-slate-200 pl-3">
            <span className="text-slate-500 font-medium">Ready:</span>
            <p className="font-bold text-slate-800">{visibleRows.length} Invoices</p>
          </div>
        </div>
      </div>

      {/* Filter and Quick Navigation Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Invoice #, Customer, or Item..."
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 w-64"
            />
          </div>
          {excludedRowIndices.length > 0 && (
            <button
              onClick={() => setExcludedRowIndices([])}
              className="text-xs text-indigo-600 font-semibold hover:underline"
            >
              Restore {excludedRowIndices.length} excluded row(s)
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={onBackToMapping}
            className="text-slate-600 hover:text-slate-900 font-medium bg-slate-100 px-3 py-1.5 rounded-lg"
          >
            Adjust Field Mappings
          </button>
          <button
            onClick={onBackToCalculations}
            className="text-slate-600 hover:text-slate-900 font-medium bg-slate-100 px-3 py-1.5 rounded-lg"
          >
            Adjust Formulas & GST
          </button>
        </div>
      </div>

      {/* Spreadsheet-Style Data Review Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="py-3 px-3 w-10 text-center font-bold">#</th>
                <th className="py-3 px-3 font-bold">Invoice Details</th>
                <th className="py-3 px-3 font-bold">Customer Details</th>
                <th className="py-3 px-3 font-bold">Item Description</th>
                <th className="py-3 px-3 font-bold text-center w-16">Qty</th>
                <th className="py-3 px-3 font-bold text-right w-24">Unit Rate</th>
                <th className="py-3 px-3 font-bold text-right w-24">Taxable Amt</th>
                <th className="py-3 px-3 font-bold text-right w-20">GST</th>
                <th className="py-3 px-3 font-bold text-right w-28">Grand Total</th>
                <th className="py-3 px-3 font-bold text-center w-20">Status</th>
                <th className="py-3 px-3 font-bold text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white font-sans">
              {visibleRows.map((rowItem) => {
                const isEditing = editingRowIndex === rowItem.globalIdx;

                return (
                  <tr key={rowItem.globalIdx} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {rowItem.globalIdx + 1}
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-mono font-bold text-indigo-600">{rowItem.invoiceNumber}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{rowItem.invoiceDate}</p>
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900">{rowItem.customerName}</p>
                      {rowItem.customerGstin && (
                        <p className="text-[10px] font-mono text-slate-500">GST: {rowItem.customerGstin}</p>
                      )}
                    </td>
                    <td className="py-3 px-3 max-w-[200px]">
                      <p className="text-slate-800 font-medium truncate" title={rowItem.itemDescription}>
                        {rowItem.itemDescription}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-700">
                      {rowItem.quantity} {rowItem.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-800">
                      {formatCurrency(rowItem.rate, company.currency)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(rowItem.taxableAmount, company.currency)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-600">
                      {formatCurrency(rowItem.taxTotal, company.currency)}
                      <span className="block text-[10px] text-slate-400">({rowItem.gstRate}%)</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(rowItem.grandTotal, company.currency)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        rowItem.isValid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {rowItem.isValid ? 'Valid' : 'Incomplete'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="inline-flex items-center space-x-1">
                        <button
                          onClick={() => handleStartEdit(rowItem)}
                          className="p-1 text-indigo-600 hover:text-indigo-800 rounded-lg hover:bg-indigo-50 font-semibold flex items-center space-x-1 text-xs px-2"
                          title="Edit All Invoice Fields"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleToggleExcludeRow(rowItem.globalIdx)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                          title="Exclude Row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveEdit(editingRowIndex)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center space-x-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Save All Overrides</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-4">
        <button
          onClick={onBackToCalculations}
          className="inline-flex items-center space-x-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to GST Calculations</span>
        </button>

        <button
          onClick={onContinue}
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold text-sm shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <span>Continue to Finalize Invoice Elements</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
