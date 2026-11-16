/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CompanySettings, InvoiceItem, InvoiceTemplate } from '../types';
import { formatCurrency } from '../utils/calculator';

export interface InvoicePreviewSheetProps {
  company: CompanySettings;
  template: InvoiceTemplate;
  rowFields: Record<string, any>;
  items: InvoiceItem[];
  summary: {
    subtotal: number;
    totalDiscount?: number;
    totalTaxable: number;
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    totalTax: number;
    otherCharges?: number;
    roundOff?: number;
    totalInvoiceAmount: number;
    amountInWords: string;
    paymentMade: number;
    balanceDue: number;
  };
  compactScale?: boolean;
}

export const InvoicePreviewSheet: React.FC<InvoicePreviewSheetProps> = ({
  company,
  template,
  rowFields,
  items,
  summary,
  compactScale = false,
}) => {
  const brandPrimary = company.brandPalette?.primaryColor || '#4f46e5';
  const brandHeading = company.brandPalette?.headingColor || '#1e293b';
  const brandTableBg = company.brandPalette?.tableHeaderBg || brandPrimary;
  const brandTableText = company.brandPalette?.tableHeaderText || '#ffffff';
  const brandHighlight = company.brandPalette?.totalHighlightColor || brandPrimary;

  const activeBank =
    company.bankAccounts.find(b => b.id === company.activeBankId) ||
    company.bankAccounts.find(b => b.isDefault) ||
    company.bankAccounts[0];

  const showHeader = template?.showSections?.companyHeader !== false;
  const showBillTo = template?.showSections?.billTo !== false;
  const showSubject = template?.showSections?.subject !== false;
  const showItemTable = template?.showSections?.itemTable !== false;
  const showTaxSummary = template?.showSections?.taxSummary !== false;
  const showAmountInWords = template?.showSections?.amountInWords !== false;
  const showBankDetails = template?.showSections?.bankDetails !== false;
  const showPaymentSummary = template?.showSections?.paymentSummary !== false;
  const showNotes = template?.showSections?.notes !== false;
  const showTerms = template?.showSections?.terms !== false;
  const showSignature = template?.showSections?.signature !== false;
  const showFooter = template?.showSections?.footer !== false;

  const hasSeparateShipping =
    Boolean(rowFields['shipping_address']) &&
    rowFields['shipping_address'] !== rowFields['customer_address'];

  const notesContent =
    rowFields['notes_content'] !== undefined
      ? rowFields['notes_content']
      : company.content?.defaultNotes;

  const termsContent =
    rowFields['terms_content'] !== undefined
      ? rowFields['terms_content']
      : company.content?.defaultTerms || '1. Goods once sold will not be taken back.';

  const footerText =
    rowFields['custom_footer_text'] ||
    company.content?.footerMessage ||
    'This is a computer generated invoice powered by Invoice Studio.';

  const discountVal = summary.totalDiscount || 0;
  const chargesVal = summary.otherCharges || 0;
  const roundOffVal = summary.roundOff || 0;

  return (
    <div
      className={`bg-white rounded-lg shadow-lg border border-slate-300 flex flex-col justify-between text-slate-800 leading-relaxed relative ${
        compactScale ? 'w-full p-6 text-[10px]' : 'w-[794px] min-h-[1050px] mx-auto p-10 text-[11px]'
      }`}
    >
      {company.assets?.showWatermark && company.assets?.watermarkText && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden opacity-10 select-none">
          <span className="text-5xl font-bold uppercase tracking-widest -rotate-45 text-slate-400">
            {company.assets.watermarkText}
          </span>
        </div>
      )}

      <div className="space-y-5 relative z-10">
        {/* Header */}
        {showHeader && (
          <div className="border-b border-slate-200 pb-4">
            {company.assets?.logoUrl && (
              <div
                className="mb-3 flex"
                style={{
                  justifyContent:
                    company.assets.logoAlignment === 'center'
                      ? 'center'
                      : company.assets.logoAlignment === 'right'
                        ? 'flex-end'
                        : 'flex-start',
                }}
              >
                <img
                  src={company.assets.logoUrl}
                  alt="Company Logo"
                  referrerPolicy="no-referrer"
                  style={{
                    width: `${company.assets.logoWidth || 40}mm`,
                    maxHeight: `${company.assets.logoHeight || 20}mm`,
                  }}
                  className="object-contain"
                />
              </div>
            )}

            <div className="flex justify-between items-start gap-4">
              <div className="space-y-1 max-w-[60%]">
                <h2 className="text-base sm:text-lg font-bold" style={{ color: brandHeading }}>
                  {rowFields['company_legal_name'] || company.legalName}
                </h2>
                <p className="text-slate-600 text-[11px]">
                  {rowFields['company_address'] || `${company.addressLine1}, ${company.city}`}
                </p>
                <p className="text-slate-500 text-[10px]">
                  GSTIN:{' '}
                  <span className="font-mono font-medium text-slate-700">
                    {rowFields['company_gstin'] || company.gstin}
                  </span>
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

              <div className="text-right space-y-0.5 shrink-0">
                <h3
                  className="text-sm sm:text-base font-extrabold tracking-tight uppercase"
                  style={{ color: brandPrimary }}
                >
                  {rowFields['invoice_title'] || template.labels?.['invoice_title'] || 'TAX INVOICE'}
                </h3>
                <p className="font-bold text-slate-900 text-xs">
                  Invoice No: <span className="font-mono">{rowFields['invoice_number'] || '—'}</span>
                </p>
                <p className="text-slate-500 text-[11px]">
                  Date: <span className="font-mono">{rowFields['invoice_date'] || '—'}</span>
                </p>
                {rowFields['due_date'] && (
                  <p className="text-slate-500 text-[11px]">
                    Due Date: <span className="font-mono">{rowFields['due_date']}</span>
                  </p>
                )}
                {rowFields['place_of_supply'] && (
                  <p className="text-slate-500 text-[11px]">
                    Place of Supply:{' '}
                    <span className="font-medium text-slate-700">{rowFields['place_of_supply']}</span>
                  </p>
                )}
                {rowFields['po_number'] && (
                  <p className="text-slate-500 text-[10px]">
                    PO No: <span className="font-mono">{rowFields['po_number']}</span>
                  </p>
                )}
                {rowFields['reference_number'] && (
                  <p className="text-slate-500 text-[10px]">
                    Ref No: <span className="font-mono">{rowFields['reference_number']}</span>
                  </p>
                )}
                {rowFields['reverse_charge'] === 'Yes' && (
                  <p className="text-amber-700 text-[10px] font-semibold">Reverse Charge: Yes</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bill To / Ship To */}
        {showBillTo && (
          <div className={`grid gap-4 ${hasSeparateShipping ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {template.labels?.['bill_to'] || 'Billed To (Customer Details):'}
              </p>
              <h4 className="font-bold text-slate-900 text-xs">
                {rowFields['customer_name'] || 'Customer Name'}
              </h4>
              {rowFields['customer_business'] && (
                <p className="text-slate-600 font-medium">{rowFields['customer_business']}</p>
              )}
              <p className="text-slate-500 text-[11px]">{rowFields['customer_address']}</p>
              {(rowFields['customer_gstin'] || rowFields['customer_pan']) && (
                <p className="text-slate-500 text-[10px] font-mono">
                  {rowFields['customer_gstin'] ? `GSTIN: ${rowFields['customer_gstin']}` : ''}
                  {rowFields['customer_gstin'] && rowFields['customer_pan'] ? ' | ' : ''}
                  {rowFields['customer_pan'] ? `PAN: ${rowFields['customer_pan']}` : ''}
                </p>
              )}
              {(rowFields['customer_phone'] || rowFields['customer_email']) && (
                <p className="text-slate-500 text-[10px]">
                  {rowFields['customer_phone'] ? `Ph: ${rowFields['customer_phone']}` : ''}
                  {rowFields['customer_phone'] && rowFields['customer_email'] ? ' | ' : ''}
                  {rowFields['customer_email'] ? `Email: ${rowFields['customer_email']}` : ''}
                </p>
              )}
            </div>

            {hasSeparateShipping && (
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ship To:</p>
                <p className="text-slate-600 text-[11px]">{rowFields['shipping_address']}</p>
              </div>
            )}
          </div>
        )}

        {/* Subject */}
        {showSubject && rowFields['subject_description'] && (
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center space-x-2">
            <span className="font-bold text-slate-800 text-[11px]">Subject:</span>
            <span className="text-slate-700 text-[11px]">{rowFields['subject_description']}</span>
          </div>
        )}

        {/* Items Table */}
        {showItemTable && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr style={{ backgroundColor: brandTableBg, color: brandTableText }}>
                  <th className="py-2 px-2.5 w-8 text-center font-bold whitespace-nowrap">#</th>
                  <th className="py-2 px-2.5 font-bold">Item & Description</th>
                  <th className="py-2 px-2 text-center font-bold whitespace-nowrap">HSN/SAC</th>
                  <th className="py-2 px-2 text-center font-bold whitespace-nowrap">Qty</th>
                  <th className="py-2 px-2 text-right font-bold whitespace-nowrap">Rate</th>
                  <th className="py-2 px-2 text-right font-bold whitespace-nowrap">Taxable Amt</th>
                  <th className="py-2 px-2 text-center font-bold whitespace-nowrap">GST</th>
                  <th className="py-2 px-2.5 text-right font-bold whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      Add line items to preview invoice table
                    </td>
                  </tr>
                ) : (
                  items.map((item, i) => (
                    <tr key={item.id || i}>
                      <td className="py-2.5 px-2.5 text-center text-slate-500 font-mono tabular-nums whitespace-nowrap">
                        {i + 1}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <p className="font-bold text-slate-900">{item.itemName || 'Untitled Item'}</p>
                        {item.itemDescription && item.itemDescription !== item.itemName && (
                          <p className="text-[10px] text-slate-500 mt-0.5">{item.itemDescription}</p>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-slate-600 whitespace-nowrap">
                        {item.hsnSac || '—'}
                      </td>
                      <td className="py-2.5 px-2 text-center text-slate-700 tabular-nums whitespace-nowrap">
                        {item.quantity} {item.unit || 'Nos'}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatCurrency(item.rate, company.currency)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatCurrency(item.taxableAmount, company.currency)}
                      </td>
                      <td className="py-2.5 px-2 text-center text-slate-700 tabular-nums whitespace-nowrap">
                        {item.gstPercentage}%
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                        {formatCurrency(item.itemTotal, company.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary & Bank Details */}
        {showTaxSummary && (
          <div className="grid grid-cols-12 gap-5 pt-2">
            <div className="col-span-12 sm:col-span-7 space-y-3">
              {showAmountInWords && (
                <div className="space-y-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Amount in Words:
                  </p>
                  <p className="italic font-medium text-slate-700 text-[11px]">
                    {summary.amountInWords}
                  </p>
                </div>
              )}

              {showBankDetails && activeBank && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-0.5 text-[11px]">
                  <p className="font-bold text-slate-900">Bank Details for Transfer:</p>
                  <p className="text-slate-600">
                    Bank: <span className="font-medium text-slate-800">{activeBank.bankName}</span>
                    {activeBank.branch ? ` (${activeBank.branch})` : ''}
                  </p>
                  <p className="text-slate-600">
                    Account Name:{' '}
                    <span className="font-medium text-slate-800">{activeBank.accountHolderName}</span>
                  </p>
                  <p className="text-slate-600">
                    A/c No:{' '}
                    <span className="font-mono font-medium text-slate-800">{activeBank.accountNumber}</span> |
                    IFSC: <span className="font-mono font-medium text-slate-800">{activeBank.ifscCode}</span>
                  </p>
                  {activeBank.upiId && (
                    <p className="text-slate-600">
                      UPI ID: <span className="font-mono font-medium text-slate-800">{activeBank.upiId}</span>
                    </p>
                  )}
                  {(rowFields['payment_instructions'] || company.content?.paymentInstructions) && (
                    <p className="text-slate-500 text-[10px] pt-1">
                      {rowFields['payment_instructions'] || company.content?.paymentInstructions}
                    </p>
                  )}
                </div>
              )}

              {showPaymentSummary &&
                (rowFields['payment_status'] || rowFields['payment_method'] || rowFields['payment_reference']) && (
                  <div className="text-[10px] text-slate-600">
                    <span className="font-bold text-slate-800">Payment Tracking: </span>
                    {[
                      rowFields['payment_status'] && `Status: ${rowFields['payment_status']}`,
                      rowFields['payment_method'] && `Method: ${rowFields['payment_method']}`,
                      rowFields['payment_reference'] && `Ref: ${rowFields['payment_reference']}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}

              {showNotes && notesContent && (
                <div className="space-y-0.5 text-[11px]">
                  <p className="font-bold text-slate-900">Notes:</p>
                  <p className="text-slate-600 leading-relaxed whitespace-pre-line">{notesContent}</p>
                </div>
              )}

              {rowFields['delivery_instructions'] && (
                <div className="space-y-0.5 text-[10px]">
                  <p className="font-bold text-slate-800">Delivery Instructions:</p>
                  <p className="text-slate-600">{rowFields['delivery_instructions']}</p>
                </div>
              )}

              {rowFields['additional_remarks'] && (
                <div className="space-y-0.5 text-[10px]">
                  <p className="font-bold text-slate-800">Remarks:</p>
                  <p className="text-slate-600">{rowFields['additional_remarks']}</p>
                </div>
              )}
            </div>

            <div className="col-span-12 sm:col-span-5 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-[11px] h-fit">
              <div className="flex justify-between text-slate-600">
                <span>{template.labels?.['subtotal'] || 'Subtotal'}:</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatCurrency(summary.subtotal, company.currency)}
                </span>
              </div>
              {summary.totalIgst > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>IGST Total:</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {formatCurrency(summary.totalIgst, company.currency)}
                  </span>
                </div>
              )}
              {summary.totalCgst > 0 && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST Total:</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      {formatCurrency(summary.totalCgst, company.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST Total:</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900">
                      {formatCurrency(summary.totalSgst, company.currency)}
                    </span>
                  </div>
                </>
              )}
              {discountVal > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Discount:</span>
                  <span className="font-mono tabular-nums text-rose-600">
                    - {formatCurrency(discountVal, company.currency)}
                  </span>
                </div>
              )}
              {chargesVal > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Additional Charges:</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {formatCurrency(chargesVal, company.currency)}
                  </span>
                </div>
              )}
              {roundOffVal !== 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Round Off:</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {formatCurrency(roundOffVal, company.currency)}
                  </span>
                </div>
              )}
              <div className="border-t border-slate-300 pt-2 flex justify-between font-bold text-xs sm:text-sm">
                <span style={{ color: brandHighlight }}>Total Invoice Amount:</span>
                <span className="font-mono tabular-nums" style={{ color: brandHighlight }}>
                  {formatCurrency(summary.totalInvoiceAmount, company.currency)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 text-[11px]">
                <span>Payment Received:</span>
                <span className="font-mono tabular-nums text-emerald-600">
                  {formatCurrency(summary.paymentMade, company.currency)}
                </span>
              </div>
              <div className="flex justify-between font-bold text-xs text-slate-900">
                <span>Balance Due:</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(summary.balanceDue, company.currency)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Terms & Signature */}
        <div className="grid grid-cols-12 gap-5 pt-4 border-t border-slate-200">
          <div className="col-span-7">
            {showTerms && (
              <div className="space-y-1 text-[10px]">
                <p className="font-bold text-slate-800 uppercase tracking-wide">Terms & Conditions:</p>
                <p className="text-slate-500 whitespace-pre-line leading-relaxed">{termsContent}</p>
              </div>
            )}
          </div>

          <div className="col-span-5 text-right space-y-1.5">
            {showSignature && (
              <>
                <p className="font-bold text-slate-900 text-xs">
                  {company.signatureHeading || `For ${company.legalName}`}
                </p>
                {company.assets?.signatureUrl ? (
                  <div className="my-2 flex justify-end">
                    <img
                      src={company.assets.signatureUrl}
                      alt="Authorized Signature"
                      referrerPolicy="no-referrer"
                      style={{
                        width: `${company.assets.signatureWidth || 35}mm`,
                        maxHeight: `${company.assets.signatureHeight || 15}mm`,
                      }}
                      className="object-contain"
                    />
                  </div>
                ) : (
                  <div className="h-8" />
                )}
                <p className="font-medium text-slate-900 text-xs">
                  {company.authorizedPerson || 'Authorized Signatory'}
                </p>
                <p className="text-slate-500 text-[10px]">({company.designation || 'Director'})</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="border-t border-slate-200 pt-3 mt-6 flex justify-between items-center text-[10px] text-slate-500 relative z-10">
          <span>{footerText}</span>
          <span>Page 1 of 1</span>
        </div>
      )}
    </div>
  );
};
