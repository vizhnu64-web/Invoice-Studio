/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { 
  CompanySettings, 
  InvoiceFieldConfig, 
  InvoiceTemplate, 
  SpreadsheetData, 
  AdvancedAmountCalculationSettings, 
  GstConfigurationSettings 
} from '../../types';
import { 
  CheckCircle2, 
  AlertCircle, 
  Building, 
  FileText, 
  Calculator, 
  Percent, 
  Layout, 
  ArrowRight, 
  ArrowLeft, 
  ShieldCheck,
  Send,
  Sparkles,
  CreditCard,
  FileCheck,
  FileSpreadsheet
} from 'lucide-react';
import { formatCurrency } from '../../utils/calculator';

interface Step6FinalizeInvoiceProps {
  company: CompanySettings;
  fields: InvoiceFieldConfig[];
  template: InvoiceTemplate;
  spreadsheetData: SpreadsheetData;
  selectedWorksheetName: string;
  startRowIndex: number;
  endRowIndex: number | undefined;
  amountSettings: AdvancedAmountCalculationSettings;
  gstSettings: GstConfigurationSettings;
  customEditedRows: Record<number, Record<string, any>>;
  onBack: () => void;
  onProceedToGenerator: () => void;
}

export const Step6FinalizeInvoice: React.FC<Step6FinalizeInvoiceProps> = ({
  company,
  fields,
  template,
  spreadsheetData,
  selectedWorksheetName,
  startRowIndex,
  endRowIndex,
  amountSettings,
  gstSettings,
  customEditedRows,
  onBack,
  onProceedToGenerator,
}) => {
  const activeWorksheet = spreadsheetData.worksheets.find(
    ws => ws.name === (selectedWorksheetName || spreadsheetData.activeSheetName)
  ) || spreadsheetData.worksheets[0];

  const totalRowsCount = activeWorksheet?.rows.length || 0;
  const effectiveEndRow = endRowIndex !== undefined && endRowIndex <= totalRowsCount ? endRowIndex : totalRowsCount;
  const selectedRecordsCount = Math.max(0, effectiveEndRow - startRowIndex);

  // Validation Checklist
  const validationChecks = useMemo(() => {
    const invNoMapped = Boolean(fields.find(f => f.id === 'invoice_number')?.sourceColumn);
    const custMapped = Boolean(fields.find(f => f.id === 'customer_name')?.sourceColumn);
    const hasCompany = Boolean(company.legalName && company.gstin);
    const hasTemplate = Boolean(template.name);
    const hasRows = selectedRecordsCount > 0;

    return [
      {
        id: 'company',
        title: 'Company Identity & Branding',
        desc: `${company.legalName} (${company.gstin})`,
        passed: hasCompany
      },
      {
        id: 'mandatory_fields',
        title: 'Essential Field Mappings',
        desc: invNoMapped && custMapped ? 'Invoice No. and Customer Name are mapped' : 'Check Invoice No. and Customer Name mapping',
        passed: invNoMapped && custMapped
      },
      {
        id: 'calculations',
        title: 'Amount & Calculation Rules',
        desc: amountSettings.taxableAmount.method === 'excel_column' ? 'Direct Excel Column Mode' : 'Automatic (Qty × Rate − Discount)',
        passed: true
      },
      {
        id: 'gst',
        title: 'GST & Tax Configuration',
        desc: gstSettings.enabled ? `${gstSettings.pricingType === 'inclusive' ? 'Tax Inclusive' : 'Tax Exclusive'} (${gstSettings.fixedRate}%)` : 'Tax Disabled',
        passed: true
      },
      {
        id: 'dataset',
        title: 'Worksheet Records Ready',
        desc: `${selectedRecordsCount} row(s) selected from sheet "${activeWorksheet?.name}"`,
        passed: hasRows
      },
      {
        id: 'layout',
        title: 'A4 Layout Designer Template',
        desc: `${template.name} (${template.fontFamily})`,
        passed: hasTemplate
      }
    ];
  }, [fields, company, template, selectedRecordsCount, activeWorksheet, amountSettings, gstSettings]);

  const allPassed = validationChecks.every(c => c.passed);
  const activeBank = company.bankAccounts.find(b => b.id === company.activeBankId) || company.bankAccounts[0];

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">Step 6: Finalize Invoice Data and Elements</h2>
        <p className="text-sm text-slate-600 mt-1">
          Review your finalized setup summary before handing off to the Invoice Generator. Once confirmed, you can generate single or bulk PDFs, preview live A4 sheets, and export ZIP packages.
        </p>
      </div>

      {/* Grid: 6 Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Card 1: Company & Branding */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Building className="w-5 h-5" />
            <h3 className="font-bold text-slate-900 text-sm">Company Profile & Branding</h3>
          </div>
          <div className="space-y-1.5 text-xs text-slate-600">
            <p className="font-bold text-slate-900 text-sm">{company.legalName}</p>
            <p className="text-[11px] text-slate-500">{company.addressLine1}, {company.city}, {company.state}</p>
            <p className="text-[11px] font-mono text-slate-700">GSTIN: {company.gstin}</p>
            <div className="flex items-center space-x-2 pt-2 text-[11px]">
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                Currency: {company.currency?.code || 'INR'} ({company.currency?.symbol || '₹'})
              </span>
              {company.assets?.logoUrl && (
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
                  Logo Active
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Calculation Engine Summary */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Calculator className="w-5 h-5" />
            <h3 className="font-bold text-slate-900 text-sm">Amount Calculation Engine</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Calculation Mode:</span>
              <span className="font-bold text-slate-800">
                {amountSettings.taxableAmount.method === 'excel_column' ? 'Mapped Excel Column' : 'Calculated (Qty × Rate)'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Quantity Source:</span>
              <span className="font-semibold text-slate-700">
                {amountSettings.quantity.method === 'excel_column' ? amountSettings.quantity.sourceColumn : 'Row Column'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Rate / Unit Price:</span>
              <span className="font-semibold text-slate-700">
                {amountSettings.unitRate.method === 'excel_column' ? amountSettings.unitRate.sourceColumn : 'Row Rate'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500 font-medium">Line Discount:</span>
              <span className="font-semibold text-emerald-600">Configured</span>
            </div>
          </div>
        </div>

        {/* Card 3: GST & Tax Treatment */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Percent className="w-5 h-5" />
            <h3 className="font-bold text-slate-900 text-sm">GST & Tax Treatment</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">GST Status:</span>
              <span className="font-bold text-emerald-600">{gstSettings.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Pricing Type:</span>
              <span className="font-semibold text-slate-800">
                {gstSettings.pricingType === 'inclusive' ? 'Tax Inclusive (Zero double-tax)' : 'Tax Exclusive (Added to base)'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Standard Rate:</span>
              <span className="font-semibold text-slate-800">{gstSettings.fixedRate}%</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500 font-medium">Tax Allocation:</span>
              <span className="font-bold text-indigo-600">
                {gstSettings.taxType === 'CGST_SGST' ? 'CGST + SGST (9%+9%)' : 'IGST (18%)'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Worksheet & Record Scope */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <FileSpreadsheet className="w-5 h-5" />
            <h3 className="font-bold text-slate-900 text-sm">Worksheet & Record Scope</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Source File:</span>
              <span className="font-bold text-slate-800 truncate max-w-[140px]" title={spreadsheetData.fileName}>
                {spreadsheetData.fileName}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Worksheet:</span>
              <span className="font-bold text-indigo-600">{activeWorksheet?.name}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Record Range:</span>
              <span className="font-mono text-slate-700">Rows {startRowIndex + 1} to {effectiveEndRow}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500 font-medium">Invoices Ready:</span>
              <span className="font-bold text-emerald-600">{selectedRecordsCount} record(s)</span>
            </div>
          </div>
        </div>

        {/* Card 5: Bank & Payment Instructions */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <CreditCard className="w-5 h-5" />
            <h3 className="font-bold text-slate-900 text-sm">Bank & Transfer Details</h3>
          </div>
          <div className="space-y-1.5 text-xs text-slate-600">
            {activeBank ? (
              <>
                <p className="font-bold text-slate-900">{activeBank.bankName} ({activeBank.branch})</p>
                <p className="font-mono text-[11px] text-slate-700">A/c: {activeBank.accountNumber}</p>
                <p className="font-mono text-[11px] text-slate-700">IFSC: {activeBank.ifscCode}</p>
                {activeBank.upiId && <p className="font-mono text-[11px] text-indigo-600">UPI: {activeBank.upiId}</p>}
              </>
            ) : (
              <p className="text-slate-400">No active bank account configured.</p>
            )}
          </div>
        </div>

        {/* Card 6: PDF Template Layout */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Layout className="w-5 h-5" />
            <h3 className="font-bold text-slate-900 text-sm">PDF Layout & Typography</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Template Name:</span>
              <span className="font-bold text-slate-800">{template.name}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Page Format:</span>
              <span className="font-semibold text-slate-700">A4 Portrait (210 × 297 mm)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500 font-medium">Primary Font:</span>
              <span className="font-semibold text-slate-700">{template.fontFamily}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500 font-medium">Accent Color:</span>
              <div className="flex items-center space-x-1.5">
                <span className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{ backgroundColor: template.primaryColor }} />
                <span className="font-mono text-[11px] text-slate-700">{template.primaryColor}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Validation Checklist Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-base">Pre-Generation Validation Checklist</h3>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
            allPassed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {allPassed ? 'All Checks Passed - Ready to Generate' : 'Action Needed on Some Items'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {validationChecks.map((check) => (
            <div
              key={check.id}
              className={`p-3.5 rounded-xl border flex items-start space-x-3 transition-colors ${
                check.passed ? 'bg-emerald-50/40 border-emerald-200' : 'bg-rose-50/40 border-rose-200'
              }`}
            >
              {check.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-bold text-xs text-slate-900">{check.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{check.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Big Action Banner: Proceed to Invoice Generator */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 p-8 rounded-2xl shadow-xl text-white flex flex-col md:flex-row md:items-center justify-between gap-6 border border-indigo-500/20">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center space-x-2 bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-xs font-medium border border-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ready for Production PDF Generation</span>
          </div>
          <h3 className="text-2xl font-extrabold tracking-tight">
            Proceed to Invoice Generator
          </h3>
          <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
            Hands off your validated dataset and rules to the Generation Center. You can preview individual invoices as high-fidelity visual sheets or embedded PDFs, execute single or batch generation, and download ZIP archives.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            Back to Review
          </button>
          <button
            onClick={onProceedToGenerator}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-7 py-3.5 rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-600/30 cursor-pointer"
          >
            <span>Proceed to Generator</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
