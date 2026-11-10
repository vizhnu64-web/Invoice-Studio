/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { InvoiceTemplate, CompanySettings } from '../types';
import { 
  Sliders,
  Type, 
  CheckCircle2, 
  Eye, 
  EyeOff, 
  Download, 
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Layers,
  FileCheck
} from 'lucide-react';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { calculateItemTotals, formatCurrency, formatAmountInWords } from '../utils/calculator';

interface LayoutDesignerProps {
  template: InvoiceTemplate;
  setTemplate: (template: InvoiceTemplate | ((prev: InvoiceTemplate) => InvoiceTemplate)) => void;
  company: CompanySettings;
}

export const LayoutDesigner: React.FC<LayoutDesignerProps> = ({
  template,
  setTemplate,
  company,
}) => {
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedElement, setSelectedElement] = useState<string>('companyHeader');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [previewMode, setPreviewMode] = useState<'visual' | 'native'>('visual');

  const handleToggleSection = (sectionKey: keyof typeof template.showSections) => {
    setTemplate(prev => ({
      ...prev,
      showSections: {
        ...prev.showSections,
        [sectionKey]: !prev.showSections[sectionKey]
      }
    }));
  };

  const handleLabelChange = (key: string, value: string) => {
    setTemplate(prev => ({
      ...prev,
      labels: {
        ...prev.labels,
        [key]: value
      }
    }));
  };

  const handleTemplatePropertyChange = (key: keyof InvoiceTemplate, value: any) => {
    setTemplate(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSaveTemplate = () => {
    // Calling setTemplate triggers persistence in App.tsx handleUpdateTemplate
    setTemplate(prev => ({ ...prev }));
    setSuccessMsg('Template layout & section visibility saved successfully.');
    setTimeout(() => setSuccessMsg(''), 3500);
  };

  // Sample data for unified live preview
  const sampleItems = useMemo(() => [
    calculateItemTotals({
      serialNumber: 1,
      itemName: '90 Days Mentorship Program & Consulting Services',
      itemDescription: 'Comprehensive Business Growth, Technology & Strategy Mentorship',
      hsnSac: '9983',
      quantity: 1,
      unit: 'Program',
      rate: 50000,
      gstPercentage: 18,
      taxType: 'IGST'
    })
  ], []);

  const sampleFields = useMemo(() => ({
    company_legal_name: company.legalName,
    company_address: `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`,
    company_gstin: company.gstin,
    company_email: company.email,
    company_phone: company.phone,
    invoice_title: template.labels?.['invoice_title'] || company.content?.invoiceTitle || 'TAX INVOICE',
    invoice_number: '2627/11/TBT/01',
    invoice_date: '2026-11-01',
    due_date: '2026-11-15',
    place_of_supply: `${company.state} (06)`,
    customer_name: 'Aarav Sharma',
    customer_business: 'Sharma Enterprises',
    customer_address: 'Plot 12, Industrial Area, Gurgaon, Haryana - 122001',
    customer_gstin: '06AABCS1234Q1ZU',
    subject_description: 'Invoice For 90 Days Mentorship Program & Consulting Services',
    notes_content: company.content?.defaultNotes,
    terms_content: company.content?.defaultTerms
  }), [company, template.labels]);

  // Generate PDF Blob URL with memoization and cleanup
  const { previewBlobUrl, pdfDoc } = useMemo(() => {
    try {
      const doc = generateInvoicePDF({ 
        company, 
        items: sampleItems, 
        fields: sampleFields, 
        template,
        paymentMade: 59000
      });
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      return { previewBlobUrl: url, pdfDoc: doc };
    } catch (err) {
      console.error('Error generating PDF preview:', err);
      return { previewBlobUrl: null, pdfDoc: null };
    }
  }, [company, sampleItems, sampleFields, template]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  const handleDownloadSamplePDF = () => {
    if (pdfDoc) {
      pdfDoc.save('Sample_Invoice_Preview.pdf');
    }
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
    <div className="max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-slate-900">PDF Layout Customization Studio</h1>
            <span className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-indigo-200 flex items-center space-x-1">
              <Sparkles className="w-3 h-3" />
              <span>Unified Engine</span>
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Real-time live A4 invoice preview reflecting company branding, palette, fonts, and section visibility.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {successMsg && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{successMsg}</span>
            </span>
          )}

          <button
            onClick={handleDownloadSamplePDF}
            className="flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border border-slate-300"
          >
            <Download className="w-4 h-4" />
            <span>Download Sample PDF</span>
          </button>

          <button
            onClick={handleSaveTemplate}
            className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm"
          >
            <FileCheck className="w-4 h-4" />
            <span>Save Template Layout</span>
          </button>
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT PANEL: Section Library & Visibility */}
        <div className="lg:col-span-3 bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-indigo-600" />
              <span>Section Library & Visibility</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Toggle sections to show or hide them dynamically across live preview and final generated invoices.
            </p>
          </div>

          <div className="space-y-2">
            {Object.entries(template.showSections).map(([key, visible]) => (
              <div 
                key={key} 
                onClick={() => setSelectedElement(key)}
                className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                  selectedElement === key ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className={`w-2 h-2 rounded-full ${visible ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="text-xs font-semibold text-slate-800 capitalize">
                    {key.replace(/([A-Z])/g, ' $1')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleSection(key as any);
                  }}
                  className={`p-1.5 rounded-lg transition-all ${
                    visible ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                  }`}
                  title={visible ? 'Hide section' : 'Show section'}
                >
                  {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Document Dimensions</h3>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span>Standard Format:</span>
                <span className="font-semibold text-slate-900">A4 Portrait (210 x 297 mm)</span>
              </div>
              <div className="flex justify-between">
                <span>Margins:</span>
                <span className="font-semibold text-slate-900">12 mm (Uniform boundaries)</span>
              </div>
              <div className="flex justify-between">
                <span>Print-Ready:</span>
                <span className="font-semibold text-emerald-600">Yes (300 DPI Vector)</span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER CANVAS: Live Unified Document & PDF Preview */}
        <div className="lg:col-span-6 bg-slate-100 p-6 rounded-2xl border border-slate-200 flex flex-col items-center justify-start min-h-[920px]">
          {/* Canvas Controls Bar */}
          <div className="w-full bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 mb-5">
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setPreviewMode('visual')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  previewMode === 'visual'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Interactive Layout
              </button>
              <button
                onClick={() => setPreviewMode('native')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  previewMode === 'native'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Native PDF Embed
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setZoomLevel(prev => Math.max(prev - 10, 60))}
                className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-semibold text-slate-700 w-12 text-center">
                {zoomLevel}%
              </span>
              <button
                onClick={() => setZoomLevel(prev => Math.min(prev + 10, 140))}
                className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoomLevel(100)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Reset Zoom"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {previewBlobUrl && (
              <a
                href={previewBlobUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Tab</span>
              </a>
            )}
          </div>

          {/* DOCUMENT PREVIEW CONTAINER */}
          {previewMode === 'visual' ? (
            <div 
              className="w-full flex justify-center overflow-auto transition-transform duration-200"
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
            >
              {/* Pixel-accurate A4 Sheet Simulation */}
              <div 
                className="w-[794px] min-h-[1123px] bg-white rounded-lg shadow-2xl border border-slate-300 p-10 flex flex-col justify-between text-slate-800 text-[11px] leading-relaxed relative"
                style={{ fontFamily: template.fontFamily || 'Helvetica, Arial, sans-serif' }}
              >
                {/* Optional Watermark */}
                {company.assets?.showWatermark && company.assets?.watermarkText && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-5 rotate-[-35deg] text-6xl font-extrabold text-slate-900">
                    {company.assets.watermarkText}
                  </div>
                )}

                <div className="space-y-6">
                  {/* HEADER SECTION */}
                  {template.showSections.companyHeader && (
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
                            {company.legalName || 'Company Legal Name'}
                          </h2>
                          <p className="text-slate-600 text-xs">
                            {company.addressLine1}{company.addressLine2 ? ', ' + company.addressLine2 : ''}, {company.city}, {company.state} - {company.pinCode}
                          </p>
                          <p className="text-slate-500 text-[10px]">
                            GSTIN: <span className="font-mono font-medium text-slate-700">{company.gstin}</span>
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
                            {template.labels?.['invoice_title'] || company.content?.invoiceTitle || 'TAX INVOICE'}
                          </h3>
                          <p className="font-bold text-slate-900 text-xs">
                            Invoice No: <span className="font-mono">2627/11/TBT/01</span>
                          </p>
                          <p className="text-slate-500 text-[11px]">
                            Date: <span className="font-mono">2026-11-01</span>
                          </p>
                          <p className="text-slate-500 text-[11px]">
                            Place of Supply: <span className="font-medium text-slate-700">{company.state} (06)</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* BILL TO SECTION */}
                  {template.showSections.billTo && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {template.labels?.['bill_to'] || 'Billed To (Customer Details):'}
                      </p>
                      <h4 className="font-bold text-slate-900 text-xs">Aarav Sharma</h4>
                      <p className="text-slate-600 font-medium">Sharma Enterprises</p>
                      <p className="text-slate-500 text-xs">Plot 12, Industrial Area, Gurgaon, Haryana - 122001</p>
                      <p className="text-slate-500 text-xs">
                        Customer GSTIN: <span className="font-mono">06AABCS1234Q1ZU</span>
                      </p>
                    </div>
                  )}

                  {/* SUBJECT SECTION */}
                  {template.showSections.subject && (
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center space-x-2">
                      <span className="font-bold text-slate-800 text-xs">Subject:</span>
                      <span className="text-slate-700 text-xs">Invoice For 90 Days Mentorship Program & Consulting Services</span>
                    </div>
                  )}

                  {/* ITEMS TABLE */}
                  {template.showSections.itemTable && (
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
                          <tr>
                            <td className="py-3 px-3 text-center text-slate-500 font-mono">1</td>
                            <td className="py-3 px-3">
                              <p className="font-bold text-slate-900">90 Days Mentorship Program & Consulting Services</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Comprehensive Business Growth, Technology & Strategy Mentorship</p>
                            </td>
                            <td className="py-3 px-3 text-center font-mono text-slate-600">9983</td>
                            <td className="py-3 px-3 text-center text-slate-700">1 Program</td>
                            <td className="py-3 px-3 text-right font-mono text-slate-800">{formatCurrency(50000, company.currency)}</td>
                            <td className="py-3 px-3 text-right font-mono text-slate-800">{formatCurrency(50000, company.currency)}</td>
                            <td className="py-3 px-3 text-center text-slate-700">18%</td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">{formatCurrency(59000, company.currency)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* SUMMARY & FINANCIAL BREAKDOWN */}
                  <div className="grid grid-cols-12 gap-6 pt-2">
                    {/* Left: Amount in Words, Bank Details, Notes */}
                    <div className="col-span-7 space-y-4">
                      {template.showSections.amountInWords && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount in Words:</p>
                          <p className="italic font-medium text-slate-700 text-xs">
                            {formatAmountInWords(59000, company.currency)}
                          </p>
                        </div>
                      )}

                      {template.showSections.bankDetails && activeBank && (
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-xs">
                          <p className="font-bold text-slate-900">Bank Details for Transfer:</p>
                          <p className="text-slate-600">Bank: <span className="font-medium text-slate-800">{activeBank.bankName}</span> ({activeBank.branch})</p>
                          <p className="text-slate-600">Account Name: <span className="font-medium text-slate-800">{activeBank.accountHolderName}</span></p>
                          <p className="text-slate-600">A/c No: <span className="font-mono font-medium text-slate-800">{activeBank.accountNumber}</span> | IFSC: <span className="font-mono font-medium text-slate-800">{activeBank.ifscCode}</span></p>
                          {activeBank.upiId && <p className="text-slate-600">UPI ID: <span className="font-mono font-medium text-slate-800">{activeBank.upiId}</span></p>}
                        </div>
                      )}

                      {template.showSections.notes && company.content?.defaultNotes && (
                        <div className="space-y-1 text-xs">
                          <p className="font-bold text-slate-900">Notes:</p>
                          <p className="text-slate-600 leading-relaxed">{company.content.defaultNotes}</p>
                        </div>
                      )}
                    </div>

                    {/* Right: Totals Box */}
                    {template.showSections.taxSummary && (
                      <div className="col-span-5 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                        <div className="flex justify-between text-slate-600">
                          <span>{template.labels?.['subtotal'] || 'Subtotal'}:</span>
                          <span className="font-mono font-medium text-slate-900">{formatCurrency(50000, company.currency)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>IGST Total (18%):</span>
                          <span className="font-mono font-medium text-slate-900">{formatCurrency(9000, company.currency)}</span>
                        </div>
                        <div className="border-t border-slate-300 pt-2 flex justify-between font-bold text-sm">
                          <span style={{ color: brandHighlight }}>Total Invoice Amount:</span>
                          <span className="font-mono" style={{ color: brandHighlight }}>{formatCurrency(59000, company.currency)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600 text-[11px]">
                          <span>Payment Received:</span>
                          <span className="font-mono text-emerald-600">{formatCurrency(59000, company.currency)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-xs text-slate-900">
                          <span>Balance Due:</span>
                          <span className="font-mono">{formatCurrency(0, company.currency)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* TERMS & SIGNATURE */}
                  <div className="grid grid-cols-12 gap-6 pt-4 border-t border-slate-200">
                    <div className="col-span-7">
                      {template.showSections.terms && (
                        <div className="space-y-1 text-[10px]">
                          <p className="font-bold text-slate-800 uppercase tracking-wide">Terms & Conditions:</p>
                          <p className="text-slate-500 whitespace-pre-line leading-relaxed">
                            {company.content?.defaultTerms || '1. Goods once sold will not be taken back.\n2. Interest @ 18% p.a. will apply on delayed payments.'}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="col-span-5 text-right space-y-2">
                      {template.showSections.signature && (
                        <div>
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
                      )}
                    </div>
                  </div>
                </div>

                {/* FOOTER */}
                {template.showSections.footer && (
                  <div className="border-t border-slate-200 pt-3 mt-6 flex justify-between items-center text-[10px] text-slate-500">
                    <span>{company.content?.footerMessage || 'This is a computer generated invoice powered by Invoice Studio.'}</span>
                    <span>Page 1 of 1</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full h-[850px] bg-white rounded-xl shadow-2xl border border-slate-300 p-2 overflow-hidden">
              {previewBlobUrl ? (
                <iframe 
                  src={previewBlobUrl} 
                  className="w-full h-full rounded-lg border-0 bg-white" 
                  title="Native PDF Preview" 
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400">
                  Loading PDF preview...
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT PANEL: Selected Element Properties & Labels */}
        <div className="lg:col-span-3 bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Type className="w-4 h-4 text-indigo-600" />
              <span>Element Properties & Labels</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Customize title headings, subtotal labels, and font families for the document template.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Active Element In Focus</label>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-indigo-600 capitalize">
                {selectedElement.replace(/([A-Z])/g, ' $1')}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Invoice Title Label</label>
              <input
                type="text"
                value={template.labels?.['invoice_title'] || 'TAX INVOICE'}
                onChange={(e) => handleLabelChange('invoice_title', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Billed To Header Label</label>
              <input
                type="text"
                value={template.labels?.['bill_to'] || 'Billed To'}
                onChange={(e) => handleLabelChange('bill_to', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Subtotal Header Label</label>
              <input
                type="text"
                value={template.labels?.['subtotal'] || 'Sub Total'}
                onChange={(e) => handleLabelChange('subtotal', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Document Font Family</label>
              <select
                value={template.fontFamily || 'Helvetica'}
                onChange={(e) => handleTemplatePropertyChange('fontFamily', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
              >
                <option value="Noto Sans">Noto Sans (Unicode TrueType - Recommended)</option>
                <option value="Helvetica">Helvetica / Arial (Clean Corporate)</option>
                <option value="Times">Times New Roman (Traditional Formal)</option>
                <option value="Courier">Courier (Monospace Technical)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Document Orientation</label>
              <select
                value={template.orientation || 'portrait'}
                onChange={(e) => handleTemplatePropertyChange('orientation', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
              >
                <option value="portrait">Portrait (Standard 210 x 297 mm)</option>
                <option value="landscape">Landscape (297 x 210 mm)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
