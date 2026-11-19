/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompanySettings,
  CurrencySettings,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceItem,
  InvoiceTemplate,
  ManualInvoiceData,
  QuotationApprovalHistoryEntry,
  QuotationData,
  QuotationRecord,
  QuotationStatus,
} from '../types';
import { CURRENCY_CATALOG, defaultCurrencySettings } from '../mockData';
import { calculateInvoiceSummary, calculateItemTotals } from './calculator';
import {
  convertManualInvoiceToGenerationRecord,
  createEmptyManualLineItem,
  generateNextInvoiceNumber,
} from './manualInvoice';

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveQuotationCurrency(
  currencyCode: string | undefined,
  company: CompanySettings
): CurrencySettings {
  const code = (currencyCode || company.currency?.currencyCode || company.currency?.code || 'INR')
    .trim()
    .toUpperCase();
  const matched = CURRENCY_CATALOG.find(
    (c) => (c.currencyCode || c.code || '').toUpperCase() === code
  );
  if (matched) return matched;
  return company.currency || defaultCurrencySettings;
}

export function generateNextQuotationNumber(quotations: QuotationRecord[] = []): string {
  const existing = new Set(
    quotations.map((q) => (q.quotationNumber || '').trim().toUpperCase()).filter(Boolean)
  );

  if (quotations.length > 0) {
    let bestPrefix = '';
    let maxSeq = 0;
    let padLen = 3;

    for (const q of quotations) {
      const match = (q.quotationNumber || '').match(/^(.*?)(\d+)$/);
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
      while (existing.has(candidate.toUpperCase())) {
        nextSeq += 1;
        candidate = `${bestPrefix}${String(nextSeq).padStart(padLen, '0')}`;
      }
      return candidate;
    }
  }

  const year = new Date().getFullYear();
  let seq = 1;
  let candidate = `QT-${year}-${String(seq).padStart(3, '0')}`;
  while (existing.has(candidate.toUpperCase())) {
    seq += 1;
    candidate = `QT-${year}-${String(seq).padStart(3, '0')}`;
  }
  return candidate;
}

export function isDuplicateQuotationNumber(
  quotationNumber: string,
  quotations: QuotationRecord[] = [],
  excludeId?: string
): boolean {
  const normalized = (quotationNumber || '').trim().toUpperCase();
  if (!normalized) return false;
  return quotations.some(
    (q) => q.id !== excludeId && (q.quotationNumber || '').trim().toUpperCase() === normalized
  );
}

export function createDefaultQuotationData(
  company: CompanySettings,
  quotations: QuotationRecord[] = []
): QuotationData {
  const today = new Date();
  const validUntil = new Date(today);
  validUntil.setDate(validUntil.getDate() + 15);

  const isoToday = today.toISOString().split('T')[0];
  const isoValidUntil = validUntil.toISOString().split('T')[0];

  return {
    quotationNumber: generateNextQuotationNumber(quotations),
    autoNumbering: true,
    quotationDate: isoToday,
    validUntilDate: isoValidUntil,
    referenceNumber: '',
    subject: '',
    projectName: '',
    salesperson: company.authorizedPerson || '',
    currencyCode: company.currency?.currencyCode || company.currency?.code || 'INR',

    selectedCustomerId: undefined,
    customerName: '',
    contactPerson: '',
    customerEmail: '',
    customerPhone: '',
    billingAddress: '',
    customerCity: '',
    customerState: '',
    customerPostalCode: '',
    customerCountry: company.country || 'India',
    customerGstin: '',

    items: [createEmptyManualLineItem(18)],

    gstEnabled: true,
    pricingType: 'exclusive',
    transactionType: 'IGST',
    defaultGstRate: 18,
    additionalDiscount: 0,
    additionalDiscountType: 'fixed',
    additionalCharges: 0,
    roundOffEnabled: true,
    manualRoundOffOverride: null,

    notes: company.content?.defaultNotes || 'Thank you for considering our proposal.',
    terms:
      company.content?.defaultTerms ||
      '1. Prices are valid until the quotation expiry date.\n2. Applicable taxes will be charged as per prevailing rates.',
    paymentTerms: '50% advance upon approval, 50% upon delivery.',
    deliveryTerms: 'Within 10 business days from order confirmation.',
    validityConditions: 'This quotation is valid for 15 days from the quotation date.',
    customFooterText: company.content?.footerMessage || '',
    includeBankDetails: true,
  };
}

/**
 * Computes line items and totals for a quotation using the centralized Invoice Studio
 * calculation engine (`calculator.ts`). Never creates a duplicate calculation formula.
 */
export function computeQuotation(data: QuotationData, company: CompanySettings) {
  const currency = resolveQuotationCurrency(data.currencyCode, company);
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

  const totalItemTaxable = calculatedItems.reduce((acc, it) => acc + it.taxableAmount, 0);
  const additionalDiscountAmt =
    data.additionalDiscountType === 'percentage'
      ? (totalItemTaxable * (data.additionalDiscount || 0)) / 100
      : data.additionalDiscount || 0;

  const summary = calculateInvoiceSummary(
    calculatedItems,
    additionalDiscountAmt,
    data.additionalCharges || 0,
    0,
    currency,
    {
      enabled: data.roundOffEnabled,
      manualRoundOff: data.manualRoundOffOverride,
    }
  );

  return {
    items: calculatedItems,
    summary,
    currency,
    additionalDiscountAmt,
  };
}

export interface QuotationValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  errorList: string[];
  warnings: string[];
}

export function validateQuotationData(
  data: QuotationData,
  existingQuotations: QuotationRecord[] = [],
  excludeId?: string
): QuotationValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  if (!data.quotationNumber || !data.quotationNumber.trim()) {
    errors.quotationNumber = 'Quotation Number is required.';
  } else if (isDuplicateQuotationNumber(data.quotationNumber, existingQuotations, excludeId)) {
    errors.quotationNumber = `Quotation Number "${data.quotationNumber.trim()}" already exists.`;
  }

  if (!data.quotationDate || !DATE_ISO_REGEX.test(data.quotationDate)) {
    errors.quotationDate = 'Valid Quotation Date (YYYY-MM-DD) is required.';
  }

  if (!data.validUntilDate || !DATE_ISO_REGEX.test(data.validUntilDate)) {
    errors.validUntilDate = 'Valid Until / Expiry Date (YYYY-MM-DD) is required.';
  } else if (
    data.quotationDate &&
    DATE_ISO_REGEX.test(data.quotationDate) &&
    data.validUntilDate < data.quotationDate
  ) {
    errors.validUntilDate = 'Valid Until Date cannot be earlier than Quotation Date.';
  }

  if (!data.customerName || !data.customerName.trim()) {
    errors.customerName = 'Customer / Company Name is required.';
  }

  if (data.customerEmail && data.customerEmail.trim() && !EMAIL_REGEX.test(data.customerEmail.trim())) {
    errors.customerEmail = 'Please enter a valid customer email address.';
  }

  if (!data.items || data.items.length === 0) {
    errors.items = 'At least one quotation line item is required.';
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
      if (
        data.gstEnabled &&
        (isNaN(item.gstPercentage) || item.gstPercentage < 0 || item.gstPercentage > 100)
      ) {
        errors[`item_${idx}_gst`] = `Line item #${idx + 1}: Tax rate must be between 0% and 100%.`;
      }
    });
  }

  if (!data.billingAddress.trim()) {
    warnings.push('Customer address is blank.');
  }

  const errorList = Object.values(errors);
  return {
    isValid: errorList.length === 0,
    errors,
    errorList,
    warnings,
  };
}

export function formatQuotationCustomerAddress(data: QuotationData): string {
  return [
    data.billingAddress?.trim(),
    [data.customerCity?.trim(), data.customerState?.trim()].filter(Boolean).join(', '),
    data.customerPostalCode?.trim(),
    data.customerCountry?.trim(),
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Builds the unified snapshot consumed by BOTH `InvoicePreviewSheet` and `generateInvoicePDF`.
 */
export function buildQuotationSnapshot(
  data: QuotationData,
  company: CompanySettings,
  template?: InvoiceTemplate
) {
  const { items, summary, currency, additionalDiscountAmt } = computeQuotation(data, company);
  const companyWithCurrency: CompanySettings = {
    ...company,
    currency,
  };

  const companyAddr = company.addressLine1
    ? `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`
    : '';

  const customerAddress = formatQuotationCustomerAddress(data);
  const combinedTerms = [
    data.terms?.trim(),
    data.paymentTerms?.trim() ? `Payment Terms: ${data.paymentTerms.trim()}` : '',
    data.deliveryTerms?.trim() ? `Delivery Terms: ${data.deliveryTerms.trim()}` : '',
    data.validityConditions?.trim() ? `Validity: ${data.validityConditions.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const rowFields: Record<string, any> = {
    document_type: 'quotation',
    company_legal_name: company.legalName,
    company_address: companyAddr,
    company_gstin: company.gstin,
    company_email: company.email,

    invoice_title: 'QUOTATION',
    invoice_number: data.quotationNumber.trim(),
    quotation_number: data.quotationNumber.trim(),
    invoice_date: data.quotationDate,
    valid_until: data.validUntilDate,
    due_date: '',
    reference_number: data.referenceNumber,
    project_name: data.projectName,
    salesperson: data.salesperson,
    subject_description: data.subject,

    customer_name: data.customerName.trim() || 'Customer Name',
    customer_business: data.contactPerson ? `Attn: ${data.contactPerson}` : '',
    customer_contact_person: data.contactPerson,
    customer_email: data.customerEmail,
    customer_phone: data.customerPhone,
    customer_address: customerAddress || 'Customer Address',
    customer_gstin: data.customerGstin,

    include_bank_details: data.includeBankDetails,
    notes_content: data.notes,
    terms_content: combinedTerms,
    payment_terms: data.paymentTerms,
    delivery_terms: data.deliveryTerms,
    validity_conditions: data.validityConditions,
    custom_footer_text:
      data.customFooterText ||
      company.content?.footerMessage ||
      'This is a computer generated quotation powered by Invoice Studio.',
  };

  const quotationTemplate: InvoiceTemplate | undefined = template
    ? {
        ...template,
        showSections: {
          ...template.showSections,
          bankDetails: data.includeBankDetails && template.showSections.bankDetails,
          paymentSummary: false,
        },
        labels: {
          ...template.labels,
          invoice_title: 'QUOTATION',
          bill_to: 'Prepared For (Customer Details):',
        },
      }
    : undefined;

  return {
    rowFields,
    items,
    summary,
    currency,
    companyWithCurrency,
    quotationTemplate,
    additionalDiscountAmt,
    additionalCharges: data.additionalCharges || 0,
  };
}

export function createQuotationRecord(params: {
  data: QuotationData;
  company: CompanySettings;
  status?: QuotationStatus;
  actorName?: string;
  actorEmail?: string;
  ownerUserId?: string;
  existingRecord?: QuotationRecord;
}): QuotationRecord {
  const nowIso = new Date().toISOString();
  const { summary } = computeQuotation(params.data, params.company);
  const id =
    params.existingRecord?.id ||
    params.data.id ||
    `qt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const nextStatus: QuotationStatus =
    params.status || params.existingRecord?.status || 'Draft';

  const historyEntry: QuotationApprovalHistoryEntry | null =
    !params.existingRecord || params.existingRecord.status !== nextStatus
      ? {
          id: `qhist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          status: nextStatus,
          previousStatus: params.existingRecord?.status,
          timestamp: nowIso,
          actorName: params.actorName || params.company.authorizedPerson || 'Workspace User',
          actorEmail: params.actorEmail || params.company.email,
          notes: params.existingRecord
            ? `Status changed to ${nextStatus}`
            : `Quotation created as ${nextStatus}`,
        }
      : null;

  const existingHistory = params.existingRecord?.approvalHistory || [];

  return {
    id,
    ownerUserId: params.ownerUserId || params.existingRecord?.ownerUserId,
    quotationNumber: params.data.quotationNumber.trim(),
    quotationDate: params.data.quotationDate,
    validUntilDate: params.data.validUntilDate,
    customerName: params.data.customerName.trim(),
    customerEmail: params.data.customerEmail.trim() || undefined,
    projectName: params.data.projectName.trim() || undefined,
    salesperson: params.data.salesperson.trim() || undefined,
    currencyCode: params.data.currencyCode || params.company.currency?.currencyCode || 'INR',
    status: nextStatus,
    subtotal: summary.subtotal,
    taxableAmount: summary.totalTaxable,
    totalTax: summary.totalTax,
    discountAmount: summary.totalDiscount,
    totalAmount: summary.totalInvoiceAmount,
    amountInWords: summary.amountInWords,
    data: { ...params.data, id },
    approvalHistory: historyEntry ? [historyEntry, ...existingHistory] : existingHistory,
    approvedAt: params.existingRecord?.approvedAt,
    approvedBy: params.existingRecord?.approvedBy,
    approvalNotes: params.existingRecord?.approvalNotes,
    rejectionReason: params.existingRecord?.rejectionReason,
    convertedInvoiceId: params.existingRecord?.convertedInvoiceId,
    convertedInvoiceNumber: params.existingRecord?.convertedInvoiceNumber,
    convertedAt: params.existingRecord?.convertedAt,
    driveFileId: params.existingRecord?.driveFileId,
    pdfDriveFileId: params.existingRecord?.pdfDriveFileId,
    createdAt: params.existingRecord?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

export function getEffectiveQuotationStatus(
  quotation: QuotationRecord,
  todayIso: string = new Date().toISOString().split('T')[0]
): QuotationStatus {
  if (
    quotation.status === 'Converted to Invoice' ||
    quotation.status === 'Approved' ||
    quotation.status === 'Not Approved' ||
    quotation.status === 'Expired'
  ) {
    return quotation.status;
  }
  if (quotation.validUntilDate && quotation.validUntilDate < todayIso) {
    return 'Expired';
  }
  return quotation.status;
}

export function applyQuotationStatusTransition(params: {
  quotation: QuotationRecord;
  nextStatus: QuotationStatus;
  actorName: string;
  actorEmail?: string;
  notes?: string;
  rejectionReason?: string;
}): QuotationRecord {
  if (params.quotation.status === 'Converted to Invoice') {
    throw new Error('Converted quotations are immutable and cannot change status.');
  }
  if (params.nextStatus === 'Converted to Invoice') {
    throw new Error('Use convertApprovedQuotationToInvoice() to convert an approved quotation.');
  }

  const nowIso = new Date().toISOString();
  const entry: QuotationApprovalHistoryEntry = {
    id: `qhist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    status: params.nextStatus,
    previousStatus: params.quotation.status,
    timestamp: nowIso,
    actorName: params.actorName || 'Workspace User',
    actorEmail: params.actorEmail,
    notes: params.notes?.trim() || undefined,
    rejectionReason: params.rejectionReason?.trim() || undefined,
  };

  return {
    ...params.quotation,
    status: params.nextStatus,
    approvedAt: params.nextStatus === 'Approved' ? nowIso : params.quotation.approvedAt,
    approvedBy: params.nextStatus === 'Approved' ? params.actorName : params.quotation.approvedBy,
    approvalNotes:
      params.nextStatus === 'Approved'
        ? params.notes?.trim() || params.quotation.approvalNotes
        : params.quotation.approvalNotes,
    rejectionReason:
      params.nextStatus === 'Not Approved'
        ? params.rejectionReason?.trim() || ''
        : params.quotation.rejectionReason,
    approvalHistory: [entry, ...(params.quotation.approvalHistory || [])],
    updatedAt: nowIso,
  };
}

/**
 * STRICT CONVERSION ENGINE:
 * Converts ONLY an Approved quotation into a linked Unpaid Invoice.
 * - Blocks Draft, Pending Approval, Not Approved, Expired, or Already Converted quotations.
 * - Preserves the original quotation financial data intact & links both records cleanly.
 * - Never auto-marks the resulting invoice as Paid.
 */
export function convertApprovedQuotationToInvoice(params: {
  quotation: QuotationRecord;
  company: CompanySettings;
  template: InvoiceTemplate;
  existingInvoices: GenerationRecord[];
  fields?: InvoiceFieldConfig[];
  actorName?: string;
  actorEmail?: string;
}): {
  updatedQuotation: QuotationRecord;
  createdInvoice: GenerationRecord;
  manualInvoiceData: ManualInvoiceData;
} {
  const { quotation, company, template, existingInvoices, fields = [] } = params;

  if (quotation.convertedInvoiceId || quotation.status === 'Converted to Invoice') {
    throw new Error(
      `Quotation ${quotation.quotationNumber} has already been converted to invoice ${quotation.convertedInvoiceNumber || quotation.convertedInvoiceId}. Duplicate conversion is prevented.`
    );
  }

  if (quotation.status !== 'Approved') {
    throw new Error(
      `Only Approved quotations can be converted to an invoice. Current status is "${quotation.status}".`
    );
  }

  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 15);
  const isoToday = today.toISOString().split('T')[0];
  const isoDue = due.toISOString().split('T')[0];
  const nextInvoiceNumber = generateNextInvoiceNumber(existingInvoices, fields);

  const qData = quotation.data;
  const currency = resolveQuotationCurrency(quotation.currencyCode, company);
  const companyWithCurrency: CompanySettings = { ...company, currency };

  const manualInvoiceData: ManualInvoiceData = {
    invoiceNumber: nextInvoiceNumber,
    autoNumbering: true,
    invoiceDate: isoToday,
    dueDate: isoDue,
    invoiceType: company.content?.invoiceTitle?.toUpperCase() || 'TAX INVOICE',
    poNumber: '',
    referenceNumber: qData.referenceNumber || quotation.quotationNumber,
    placeOfSupply: qData.customerState || company.state || '',
    stateCode: '',
    reverseCharge: 'No',
    subject:
      qData.subject ||
      (qData.projectName
        ? `Invoice for ${qData.projectName} (Ref: ${quotation.quotationNumber})`
        : `Invoice converted from Quotation ${quotation.quotationNumber}`),
    additionalReference: `Quotation ${quotation.quotationNumber}`,

    selectedCustomerId: qData.selectedCustomerId,
    customerName: qData.customerName,
    contactPerson: qData.contactPerson,
    customerEmail: qData.customerEmail,
    customerPhone: qData.customerPhone,
    billingAddress: qData.billingAddress,
    shippingAddress: qData.billingAddress,
    sameAsBilling: true,
    customerCity: qData.customerCity,
    customerState: qData.customerState,
    customerPostalCode: qData.customerPostalCode,
    customerCountry: qData.customerCountry,
    customerGstin: qData.customerGstin,
    customerPan: '',
    customerReferenceNumber: quotation.quotationNumber,

    // Deep clone line items so later invoice edits NEVER mutate the original quotation
    items: qData.items.map((it) => ({ ...it })),

    gstEnabled: qData.gstEnabled,
    pricingType: qData.pricingType,
    transactionType: qData.transactionType,
    defaultGstRate: qData.defaultGstRate,
    additionalDiscount: qData.additionalDiscount,
    additionalDiscountType: qData.additionalDiscountType,
    additionalCharges: qData.additionalCharges,
    roundOffEnabled: qData.roundOffEnabled,
    manualRoundOffOverride: qData.manualRoundOffOverride ?? null,

    // Strictly Unpaid on conversion — never auto-mark paid
    paymentMethod: 'UPI',
    paymentStatus: 'Unpaid',
    amountPaid: 0,
    paymentDate: '',
    transactionReference: '',
    paymentNotes: qData.paymentTerms || '',

    notes: qData.notes,
    terms: qData.terms,
    paymentInstructions: qData.paymentTerms || company.content?.paymentInstructions || '',
    deliveryInstructions: qData.deliveryTerms || '',
    additionalRemarks: `Converted from Approved Quotation ${quotation.quotationNumber}`,
    customFooterText: qData.customFooterText || company.content?.footerMessage || '',
    sourceQuotationId: quotation.id,
    sourceQuotationNumber: quotation.quotationNumber,
  };

  const baseRecord = convertManualInvoiceToGenerationRecord(
    manualInvoiceData,
    companyWithCurrency,
    template
  );

  const nowIso = new Date().toISOString();
  const createdInvoice: GenerationRecord = {
    ...baseRecord,
    sourceName: `Quotation ${quotation.quotationNumber}`,
    worksheetName: 'Converted Quotation',
    paymentStatus: 'Unpaid',
    paymentAmount: 0,
    sourceQuotationId: quotation.id,
    sourceQuotationNumber: quotation.quotationNumber,
    updatedAt: nowIso,
  };

  manualInvoiceData.id = createdInvoice.id;

  const conversionEntry: QuotationApprovalHistoryEntry = {
    id: `qhist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    status: 'Converted to Invoice',
    previousStatus: 'Approved',
    timestamp: nowIso,
    actorName: params.actorName || company.authorizedPerson || 'Workspace User',
    actorEmail: params.actorEmail || company.email,
    notes: `Converted to Invoice ${createdInvoice.invoiceNumber}`,
  };

  const updatedQuotation: QuotationRecord = {
    ...quotation,
    status: 'Converted to Invoice',
    convertedInvoiceId: createdInvoice.id,
    convertedInvoiceNumber: createdInvoice.invoiceNumber,
    convertedAt: nowIso,
    approvalHistory: [conversionEntry, ...(quotation.approvalHistory || [])],
    updatedAt: nowIso,
  };

  return {
    updatedQuotation,
    createdInvoice,
    manualInvoiceData,
  };
}

export interface QuotationDashboardStats {
  total: number;
  draft: number;
  pendingApproval: number;
  approved: number;
  notApproved: number;
  expired: number;
  converted: number;
  totalQuotedValue: number;
  approvedValue: number;
}

export function computeQuotationStats(
  quotations: QuotationRecord[],
  todayIso: string = new Date().toISOString().split('T')[0]
): QuotationDashboardStats {
  const stats: QuotationDashboardStats = {
    total: quotations.length,
    draft: 0,
    pendingApproval: 0,
    approved: 0,
    notApproved: 0,
    expired: 0,
    converted: 0,
    totalQuotedValue: 0,
    approvedValue: 0,
  };

  for (const q of quotations) {
    const effective = getEffectiveQuotationStatus(q, todayIso);
    const amount = Number(q.totalAmount || 0);
    stats.totalQuotedValue += amount;

    if (effective === 'Draft') stats.draft++;
    else if (effective === 'Pending Approval') stats.pendingApproval++;
    else if (effective === 'Approved') {
      stats.approved++;
      stats.approvedValue += amount;
    } else if (effective === 'Not Approved') stats.notApproved++;
    else if (effective === 'Expired') stats.expired++;
    else if (effective === 'Converted to Invoice') {
      stats.converted++;
      stats.approvedValue += amount;
    }
  }

  return stats;
}
