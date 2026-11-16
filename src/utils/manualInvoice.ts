/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompanySettings,
  CustomerRecord,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceItem,
  InvoiceTemplate,
  ManualInvoiceData,
  ManualInvoiceLineItem,
} from '../types';
import { calculateInvoiceSummary, calculateItemTotals } from './calculator';

export const INVOICE_TYPES = [
  'TAX INVOICE',
  'PROFORMA INVOICE',
  'COMMERCIAL INVOICE',
  'EXPORT INVOICE',
  'BILL OF SUPPLY',
  'CREDIT NOTE',
  'DEBIT NOTE',
];

export const SUPPORTED_PAYMENT_METHODS = [
  'UPI',
  'NEFT',
  'RTGS',
  'IMPS',
  'Cash',
  'Cheque',
  'Debit/Credit Card',
  'Payment Gateway',
  'Net Banking',
  'Demand Draft',
  'Other',
];

export const ITEM_UNITS = ['Nos', 'Hrs', 'Days', 'Months', 'Units', 'Pcs', 'Kg', 'Set', 'Box', 'License'];
export const COMMON_GST_RATES = [0, 5, 12, 18, 28];

export function createEmptyManualLineItem(defaultGstRate: number = 0): ManualInvoiceLineItem {
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemName: '',
    itemDescription: '',
    hsnSac: '',
    quantity: 1,
    unit: 'Nos',
    rate: 0,
    discount: 0,
    discountType: 'fixed',
    gstPercentage: defaultGstRate,
  };
}

/**
 * Generates the next sequential invoice number based on history or field auto-generate config.
 */
export function generateNextInvoiceNumber(
  history: GenerationRecord[] = [],
  fields: InvoiceFieldConfig[] = []
): string {
  const invField = fields.find(f => f.id === 'invoice_number' || f.key === 'invoice_number');
  const cfg = invField?.autoGenerateConfig;

  const existingNumbers = new Set(
    history.map(r => (r.invoiceNumber || '').trim().toUpperCase()).filter(Boolean)
  );

  // Extract highest trailing integer from history if matching pattern exists
  if (history.length > 0) {
    let bestPrefix = '';
    let maxSeq = 0;
    let padLen = 2;

    for (const rec of history) {
      const match = (rec.invoiceNumber || '').match(/^(.*?)(\d+)$/);
      if (match) {
        const prefix = match[1];
        const num = parseInt(match[2], 10);
        if (!isNaN(num) && num >= maxSeq) {
          maxSeq = num;
          bestPrefix = prefix;
          padLen = Math.max(padLen, match[2].length);
        }
      }
    }

    if (bestPrefix) {
      let nextSeq = maxSeq + 1;
      let candidate = `${bestPrefix}${String(nextSeq).padStart(padLen, '0')}`;
      while (existingNumbers.has(candidate.toUpperCase())) {
        nextSeq += 1;
        candidate = `${bestPrefix}${String(nextSeq).padStart(padLen, '0')}`;
      }
      return candidate;
    }
  }

  const prefix = cfg?.prefix || 'INV-2026-';
  let seq = cfg?.startNumber || 1;
  let candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  while (existingNumbers.has(candidate.toUpperCase())) {
    seq += 1;
    candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  }
  return candidate;
}

export function isDuplicateInvoiceNumber(
  invoiceNumber: string,
  history: GenerationRecord[] = [],
  excludeRecordId?: string
): boolean {
  const normalized = (invoiceNumber || '').trim().toUpperCase();
  if (!normalized) return false;
  return history.some(
    rec => rec.id !== excludeRecordId && (rec.invoiceNumber || '').trim().toUpperCase() === normalized
  );
}

export function createDefaultManualInvoice(
  company: CompanySettings,
  fields: InvoiceFieldConfig[] = [],
  history: GenerationRecord[] = []
): ManualInvoiceData {
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 15);

  const isoToday = today.toISOString().split('T')[0];
  const isoDue = due.toISOString().split('T')[0];

  const defaultTitle = company.content?.invoiceTitle || 'TAX INVOICE';
  const defaultPlace = company.state ? `${company.state}` : '';

  return {
    invoiceNumber: generateNextInvoiceNumber(history, fields),
    autoNumbering: true,
    invoiceDate: isoToday,
    dueDate: isoDue,
    invoiceType: INVOICE_TYPES.includes(defaultTitle.toUpperCase()) ? defaultTitle.toUpperCase() : 'TAX INVOICE',
    poNumber: '',
    referenceNumber: '',
    placeOfSupply: defaultPlace,
    stateCode: '',
    reverseCharge: 'No',
    subject: '',
    additionalReference: '',

    selectedCustomerId: undefined,
    customerName: '',
    contactPerson: '',
    customerEmail: '',
    customerPhone: '',
    billingAddress: '',
    shippingAddress: '',
    sameAsBilling: true,
    customerCity: '',
    customerState: '',
    customerPostalCode: '',
    customerCountry: company.country || 'India',
    customerGstin: '',
    customerPan: '',
    customerReferenceNumber: '',

    items: [createEmptyManualLineItem(0)],

    gstEnabled: true,
    pricingType: 'exclusive',
    transactionType: 'IGST',
    defaultGstRate: 18,
    additionalDiscount: 0,
    additionalDiscountType: 'fixed',
    additionalCharges: 0,
    roundOffEnabled: true,
    manualRoundOffOverride: null,

    paymentMethod: 'UPI',
    paymentStatus: 'Unpaid',
    amountPaid: 0,
    paymentDate: isoToday,
    transactionReference: '',
    paymentNotes: '',

    notes: company.content?.defaultNotes || '',
    terms: company.content?.defaultTerms || '',
    paymentInstructions: company.content?.paymentInstructions || '',
    deliveryInstructions: '',
    additionalRemarks: '',
    customFooterText: company.content?.footerMessage || '',
  };
}

/**
 * Computes live line items and summary totals using the centralized calculation engine.
 */
export function computeManualInvoice(
  data: ManualInvoiceData,
  company: CompanySettings
) {
  const effectiveTaxType: 'IGST' | 'CGST_SGST' | 'NONE' = !data.gstEnabled
    ? 'NONE'
    : data.transactionType;

  const isTaxInclusive = data.pricingType === 'inclusive';

  const calculatedItems: InvoiceItem[] = data.items.map((line, idx) =>
    calculateItemTotals({
      id: line.id,
      serialNumber: idx + 1,
      itemName: line.itemName,
      itemDescription: line.itemDescription,
      hsnSac: line.hsnSac,
      quantity: line.quantity,
      unit: line.unit || 'Nos',
      rate: line.rate,
      discount: line.discount,
      discountType: line.discountType,
      gstPercentage: data.gstEnabled ? line.gstPercentage : 0,
      taxType: effectiveTaxType,
      calculationMode: 'calculated',
      isTaxInclusive,
    })
  );

  // Resolve additional invoice-level discount
  const totalItemTaxable = calculatedItems.reduce((acc, it) => acc + it.taxableAmount, 0);
  const additionalDiscountAmt =
    data.additionalDiscountType === 'percentage'
      ? (totalItemTaxable * (data.additionalDiscount || 0)) / 100
      : (data.additionalDiscount || 0);

  // Pre-compute raw invoice total so 'Paid' status accurately maps full payment if needed
  const prePaymentSummary = calculateInvoiceSummary(
    calculatedItems,
    additionalDiscountAmt,
    data.additionalCharges || 0,
    0,
    company.currency,
    {
      enabled: data.roundOffEnabled,
      manualRoundOff: data.manualRoundOffOverride,
    }
  );

  const effectiveAmountPaid =
    data.paymentStatus === 'Paid'
      ? prePaymentSummary.totalInvoiceAmount
      : data.paymentStatus === 'Unpaid'
        ? 0
        : Math.max(0, Math.min(prePaymentSummary.totalInvoiceAmount, data.amountPaid || 0));

  const summary = calculateInvoiceSummary(
    calculatedItems,
    additionalDiscountAmt,
    data.additionalCharges || 0,
    effectiveAmountPaid,
    company.currency,
    {
      enabled: data.roundOffEnabled,
      manualRoundOff: data.manualRoundOffOverride,
    }
  );

  return {
    items: calculatedItems,
    summary,
    additionalDiscountAmt,
    effectiveAmountPaid,
  };
}

export interface ManualInvoiceValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  errorList: string[];
  warnings: string[];
}

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateManualInvoice(
  data: ManualInvoiceData,
  history: GenerationRecord[] = [],
  excludeRecordId?: string
): ManualInvoiceValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  // 1. Invoice Information
  if (!data.invoiceNumber || !data.invoiceNumber.trim()) {
    errors.invoiceNumber = 'Invoice Number is required.';
  } else if (isDuplicateInvoiceNumber(data.invoiceNumber, history, excludeRecordId)) {
    errors.invoiceNumber = `Invoice Number "${data.invoiceNumber.trim()}" already exists in Generation History. Please use a unique invoice number.`;
  }

  if (!data.invoiceDate || !DATE_ISO_REGEX.test(data.invoiceDate)) {
    errors.invoiceDate = 'Valid Invoice Date (YYYY-MM-DD) is required.';
  }

  if (data.dueDate) {
    if (!DATE_ISO_REGEX.test(data.dueDate)) {
      errors.dueDate = 'Due Date must be a valid date (YYYY-MM-DD).';
    } else if (data.invoiceDate && DATE_ISO_REGEX.test(data.invoiceDate) && data.dueDate < data.invoiceDate) {
      errors.dueDate = 'Due Date cannot be earlier than Invoice Date.';
    }
  }

  // 2. Customer Information
  if (!data.customerName || !data.customerName.trim()) {
    errors.customerName = 'Customer / Company Name is required.';
  }

  if (data.customerEmail && data.customerEmail.trim() && !EMAIL_REGEX.test(data.customerEmail.trim())) {
    errors.customerEmail = 'Please enter a valid customer email address.';
  }

  // 3. Items Validation
  if (!data.items || data.items.length === 0) {
    errors.items = 'At least one invoice line item is required.';
  } else {
    data.items.forEach((item, idx) => {
      if (!item.itemName || !item.itemName.trim()) {
        errors[`item_${idx}_name`] = `Line item #${idx + 1}: Item Name is required.`;
      }
      if (isNaN(item.quantity) || item.quantity <= 0) {
        errors[`item_${idx}_qty`] = `Line item #${idx + 1}: Quantity must be greater than 0.`;
      }
      if (isNaN(item.rate) || item.rate < 0) {
        errors[`item_${idx}_rate`] = `Line item #${idx + 1}: Rate cannot be negative.`;
      }
      if (isNaN(item.discount) || item.discount < 0) {
        errors[`item_${idx}_discount`] = `Line item #${idx + 1}: Discount cannot be negative.`;
      }
      if (data.gstEnabled && (isNaN(item.gstPercentage) || item.gstPercentage < 0 || item.gstPercentage > 100)) {
        errors[`item_${idx}_gst`] = `Line item #${idx + 1}: GST rate must be between 0% and 100%.`;
      }
    });
  }

  // 4. Payment validation
  if (data.paymentStatus === 'Partially Paid' && (isNaN(data.amountPaid) || data.amountPaid < 0)) {
    errors.amountPaid = 'Amount Paid cannot be negative.';
  }

  // Warnings (non-blocking)
  if (data.gstEnabled && data.items.some(i => !i.hsnSac.trim())) {
    warnings.push('Some line items do not have an HSN/SAC code.');
  }
  if (!data.billingAddress.trim()) {
    warnings.push('Customer billing address is blank.');
  }

  const errorList = Object.values(errors);
  return {
    isValid: errorList.length === 0,
    errors,
    errorList,
    warnings,
  };
}

/**
 * Formats full customer address consistently for Invoice Preview & PDF rendering.
 */
export function formatCustomerFullAddress(data: ManualInvoiceData): string {
  const parts = [
    data.billingAddress?.trim(),
    [data.customerCity?.trim(), data.customerState?.trim()].filter(Boolean).join(', '),
    data.customerPostalCode?.trim(),
    data.customerCountry?.trim(),
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Builds the unified fields map & calculated items consumed by BOTH InvoicePreviewSheet and generateInvoicePDF.
 */
export function buildManualInvoiceSnapshot(
  data: ManualInvoiceData,
  company: CompanySettings,
  template?: InvoiceTemplate
) {
  const { items, summary, additionalDiscountAmt, effectiveAmountPaid } = computeManualInvoice(data, company);

  const companyAddr = company.addressLine1
    ? `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`
    : '';

  const customerBillingFull = formatCustomerFullAddress(data);
  const effectiveShipping = data.sameAsBilling ? customerBillingFull : (data.shippingAddress || customerBillingFull);

  const rowFields: Record<string, any> = {
    company_legal_name: company.legalName,
    company_address: companyAddr,
    company_gstin: company.gstin,
    company_email: company.email,

    invoice_title: data.invoiceType || template?.labels?.['invoice_title'] || company.content?.invoiceTitle || 'TAX INVOICE',
    invoice_number: data.invoiceNumber.trim(),
    invoice_date: data.invoiceDate,
    due_date: data.dueDate,
    po_number: data.poNumber,
    reference_number: data.referenceNumber,
    place_of_supply: data.placeOfSupply
      ? (data.stateCode ? `${data.placeOfSupply} (${data.stateCode})` : data.placeOfSupply)
      : '',
    state_code: data.stateCode,
    reverse_charge: data.reverseCharge,
    subject_description: data.subject,
    additional_reference: data.additionalReference,

    customer_name: data.customerName.trim() || 'Customer Name',
    customer_business: data.contactPerson ? `Attn: ${data.contactPerson}` : '',
    customer_contact_person: data.contactPerson,
    customer_email: data.customerEmail,
    customer_phone: data.customerPhone,
    customer_address: customerBillingFull || 'Customer Billing Address',
    shipping_address: effectiveShipping,
    customer_gstin: data.customerGstin,
    customer_pan: data.customerPan,
    customer_reference: data.customerReferenceNumber,

    payment_method: data.paymentMethod,
    payment_status: data.paymentStatus,
    payment_date: data.paymentDate,
    payment_reference: data.transactionReference,
    amount_paid: effectiveAmountPaid,
    payment_notes: data.paymentNotes,

    notes_content: data.notes,
    terms_content: data.terms,
    payment_instructions: data.paymentInstructions,
    delivery_instructions: data.deliveryInstructions,
    additional_remarks: data.additionalRemarks,
    custom_footer_text: data.customFooterText,
  };

  return {
    rowFields,
    items,
    summary,
    additionalDiscountAmt,
    additionalCharges: data.additionalCharges || 0,
    effectiveAmountPaid,
  };
}

/**
 * Converts a finalized ManualInvoiceData into a unified GenerationRecord compatible with History, Dashboard, and Email Center.
 */
export function convertManualInvoiceToGenerationRecord(
  data: ManualInvoiceData,
  company: CompanySettings,
  template: InvoiceTemplate
): GenerationRecord {
  const { rowFields, items, summary, additionalDiscountAmt, additionalCharges, effectiveAmountPaid } =
    buildManualInvoiceSnapshot(data, company, template);

  return {
    id: `man_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    invoiceNumber: rowFields['invoice_number'],
    customerName: rowFields['customer_name'],
    sourceType: 'manual',
    sourceName: 'Manual Entry',
    worksheetName: 'Manual Entry',
    generatedDate: data.invoiceDate || new Date().toISOString().split('T')[0],
    totalAmount: summary.totalInvoiceAmount,
    gstAmount: summary.totalTax,
    templateId: template.id,
    profileId: 'manual_entry',
    revisionNumber: 1,
    status: 'success',
    dataSnapshot: {
      rowFields,
      items,
      discount: additionalDiscountAmt,
      additionalCharges,
      paymentMade: effectiveAmountPaid,
      manualSourceData: data,
    },
    paymentMethod: data.paymentMethod,
    paymentStatus: data.paymentStatus,
    paymentDate: data.paymentDate,
    paymentReference: data.transactionReference,
    paymentAmount: effectiveAmountPaid,
    paymentNotes: data.paymentNotes,
  };
}

export function extractCustomerFromManualInvoice(
  data: ManualInvoiceData,
  existingId?: string
): CustomerRecord {
  return {
    id: existingId || data.selectedCustomerId || `cust_${Date.now()}`,
    customerName: data.customerName.trim(),
    contactPerson: data.contactPerson.trim(),
    email: data.customerEmail.trim(),
    phone: data.customerPhone.trim(),
    billingAddress: data.billingAddress.trim(),
    shippingAddress: data.sameAsBilling ? data.billingAddress.trim() : data.shippingAddress.trim(),
    city: data.customerCity.trim(),
    state: data.customerState.trim(),
    postalCode: data.customerPostalCode.trim(),
    country: data.customerCountry.trim(),
    gstin: data.customerGstin.trim(),
    pan: data.customerPan.trim(),
    referenceNumber: data.customerReferenceNumber.trim(),
    updatedAt: new Date().toISOString(),
  };
}
