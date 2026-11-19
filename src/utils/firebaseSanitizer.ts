/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CalculationSettings,
  CompanySettings,
  CustomerRecord,
  EmailDeliveryLogEntry,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceTemplate,
  QuotationApprovalHistoryEntry,
  QuotationRecord,
} from '../types';

/**
 * Verbatim volumetric boundaries & regexes synchronized with firebase-blueprint.json and firestore.rules.
 */
export const BLUEPRINT_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  ID_MAX: 128,
  DISPLAY_NAME_MAX: 120,
  PHOTO_URL_MAX: 512,
  EMAIL_MAX: 254,
  CUSTOMER_NAME_MAX: 200,
  CONTACT_PERSON_MAX: 150,
  PHONE_MAX: 40,
  ADDRESS_MAX: 500,
  CITY_MAX: 100,
  STATE_MAX: 100,
  POSTAL_CODE_MAX: 30,
  COUNTRY_MAX: 100,
  TAX_ID_MAX: 40,
  REFERENCE_MAX: 80,
  DOCUMENT_NUMBER_MAX: 80,
  DATE_MAX: 40,
  DATETIME_MAX: 64,
  PROJECT_NAME_MAX: 200,
  SALESPERSON_MAX: 120,
  CURRENCY_CODE_MAX: 12,
  AMOUNT_IN_WORDS_MAX: 500,
  APPROVER_MAX: 150,
  NOTES_MAX: 1000,
  SOURCE_NAME_MAX: 200,
  WORKSHEET_NAME_MAX: 120,
  PAYMENT_METHOD_MAX: 80,
  PAYMENT_STATUS_MAX: 60,
  PAYMENT_REF_MAX: 120,
  CC_BCC_MAX: 500,
  SUBJECT_MAX: 300,
  PROVIDER_MSG_ID_MAX: 256,
  FIELDS_ARRAY_MAX: 150,
  APPROVAL_HISTORY_MAX: 100,
  MAX_INLINE_ASSET_CHARS: 120_000,
} as const;

export function truncateString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

export function sanitizeDocumentId(rawId: string | undefined | null, fallbackPrefix = 'doc'): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, BLUEPRINT_LIMITS.ID_MAX);
  if (cleaned.length >= 1 && BLUEPRINT_LIMITS.ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${fallbackPrefix}_${Date.now()}_${randomSuffix}`.slice(0, BLUEPRINT_LIMITS.ID_MAX);
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Recursively strips `undefined` values (rejected by Firestore) and caps oversized inline data URLs
 * so documents stay safely below Firestore's 1MB document limit.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.length > BLUEPRINT_LIMITS.MAX_INLINE_ASSET_CHARS) {
      return '' as unknown as T;
    }
    return value;
  }
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : 0) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    // Preserve Firestore FieldValue / Timestamp sentinel objects untouched
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        result[k] = stripUndefinedDeep(v);
      }
    }
    return result as T;
  }
  return value;
}

function assignOptionalString(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  maxLen: number
) {
  if (typeof value === 'string' && value.trim().length > 0) {
    target[key] = truncateString(value, maxLen);
  }
}

export function buildUserProfileCreatePayload(
  userId: string,
  displayName: string,
  photoURL: string | null | undefined,
  onboardingCompleted: boolean,
  timestampToken: unknown
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    userId: sanitizeDocumentId(userId, 'user'),
    displayName: truncateString(displayName, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
    onboardingCompleted: Boolean(onboardingCompleted),
    createdAt: timestampToken,
    updatedAt: timestampToken,
  };
  assignOptionalString(payload, 'photoURL', photoURL, BLUEPRINT_LIMITS.PHOTO_URL_MAX);
  return payload;
}

export function buildUserProfileUpdatePayload(
  displayName: string,
  photoURL: string | null | undefined,
  onboardingCompleted: boolean,
  timestampToken: unknown
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    displayName: truncateString(displayName, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
    onboardingCompleted: Boolean(onboardingCompleted),
    updatedAt: timestampToken,
  };
  if (typeof photoURL === 'string' && photoURL.trim().length > 0) {
    payload.photoURL = truncateString(photoURL, BLUEPRINT_LIMITS.PHOTO_URL_MAX);
  }
  return payload;
}

export function buildUserPrivateAccountCreatePayload(
  userId: string,
  email: string,
  timestampToken: unknown
): Record<string, unknown> {
  const safeEmail = truncateString(email, BLUEPRINT_LIMITS.EMAIL_MAX);
  return {
    userId: sanitizeDocumentId(userId, 'user'),
    email: safeEmail.length >= 3 ? safeEmail : 'unknown@user.invalid',
    createdAt: timestampToken,
    updatedAt: timestampToken,
  };
}

export function buildWorkspaceSettingsCreatePayload(
  userId: string,
  companySettings: CompanySettings,
  template: InvoiceTemplate,
  calculationSettings: CalculationSettings,
  fields: InvoiceFieldConfig[],
  timestampToken: unknown
): Record<string, unknown> {
  return {
    userId: sanitizeDocumentId(userId, 'user'),
    companySettings: stripUndefinedDeep(companySettings),
    template: stripUndefinedDeep(template),
    calculationSettings: stripUndefinedDeep(calculationSettings),
    fields: stripUndefinedDeep(fields.slice(0, BLUEPRINT_LIMITS.FIELDS_ARRAY_MAX)),
    createdAt: timestampToken,
    updatedAt: timestampToken,
  };
}

export function buildWorkspaceSettingsUpdatePayload(
  companySettings: CompanySettings,
  template: InvoiceTemplate,
  calculationSettings: CalculationSettings,
  fields: InvoiceFieldConfig[],
  timestampToken: unknown
): Record<string, unknown> {
  return {
    companySettings: stripUndefinedDeep(companySettings),
    template: stripUndefinedDeep(template),
    calculationSettings: stripUndefinedDeep(calculationSettings),
    fields: stripUndefinedDeep(fields.slice(0, BLUEPRINT_LIMITS.FIELDS_ARRAY_MAX)),
    updatedAt: timestampToken,
  };
}

export function buildCustomerCreatePayload(
  userId: string,
  customer: CustomerRecord,
  timestampToken: unknown
): Record<string, unknown> {
  const safeId = sanitizeDocumentId(customer.id, 'cust');
  const payload: Record<string, unknown> = {
    userId: sanitizeDocumentId(userId, 'user'),
    id: safeId,
    customerName: truncateString(customer.customerName, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX) || 'Unnamed Customer',
    billingAddress: truncateString(customer.billingAddress, BLUEPRINT_LIMITS.ADDRESS_MAX),
    createdAt: timestampToken,
    updatedAt: timestampToken,
  };
  assignOptionalString(payload, 'contactPerson', customer.contactPerson, BLUEPRINT_LIMITS.CONTACT_PERSON_MAX);
  assignOptionalString(payload, 'email', customer.email, BLUEPRINT_LIMITS.EMAIL_MAX);
  assignOptionalString(payload, 'phone', customer.phone, BLUEPRINT_LIMITS.PHONE_MAX);
  assignOptionalString(payload, 'shippingAddress', customer.shippingAddress, BLUEPRINT_LIMITS.ADDRESS_MAX);
  assignOptionalString(payload, 'city', customer.city, BLUEPRINT_LIMITS.CITY_MAX);
  assignOptionalString(payload, 'state', customer.state, BLUEPRINT_LIMITS.STATE_MAX);
  assignOptionalString(payload, 'postalCode', customer.postalCode, BLUEPRINT_LIMITS.POSTAL_CODE_MAX);
  assignOptionalString(payload, 'country', customer.country, BLUEPRINT_LIMITS.COUNTRY_MAX);
  assignOptionalString(payload, 'gstin', customer.gstin, BLUEPRINT_LIMITS.TAX_ID_MAX);
  assignOptionalString(payload, 'pan', customer.pan, BLUEPRINT_LIMITS.TAX_ID_MAX);
  assignOptionalString(payload, 'referenceNumber', customer.referenceNumber, BLUEPRINT_LIMITS.REFERENCE_MAX);
  return payload;
}

export function buildCustomerUpdatePayload(
  customer: CustomerRecord,
  timestampToken: unknown
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    customerName: truncateString(customer.customerName, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX) || 'Unnamed Customer',
    billingAddress: truncateString(customer.billingAddress, BLUEPRINT_LIMITS.ADDRESS_MAX),
    updatedAt: timestampToken,
  };
  assignOptionalString(payload, 'contactPerson', customer.contactPerson, BLUEPRINT_LIMITS.CONTACT_PERSON_MAX);
  assignOptionalString(payload, 'email', customer.email, BLUEPRINT_LIMITS.EMAIL_MAX);
  assignOptionalString(payload, 'phone', customer.phone, BLUEPRINT_LIMITS.PHONE_MAX);
  assignOptionalString(payload, 'shippingAddress', customer.shippingAddress, BLUEPRINT_LIMITS.ADDRESS_MAX);
  assignOptionalString(payload, 'city', customer.city, BLUEPRINT_LIMITS.CITY_MAX);
  assignOptionalString(payload, 'state', customer.state, BLUEPRINT_LIMITS.STATE_MAX);
  assignOptionalString(payload, 'postalCode', customer.postalCode, BLUEPRINT_LIMITS.POSTAL_CODE_MAX);
  assignOptionalString(payload, 'country', customer.country, BLUEPRINT_LIMITS.COUNTRY_MAX);
  assignOptionalString(payload, 'gstin', customer.gstin, BLUEPRINT_LIMITS.TAX_ID_MAX);
  assignOptionalString(payload, 'pan', customer.pan, BLUEPRINT_LIMITS.TAX_ID_MAX);
  assignOptionalString(payload, 'referenceNumber', customer.referenceNumber, BLUEPRINT_LIMITS.REFERENCE_MAX);
  return payload;
}

function sanitizeApprovalHistory(
  history: QuotationApprovalHistoryEntry[] | undefined
): QuotationApprovalHistoryEntry[] {
  if (!Array.isArray(history)) return [];
  return stripUndefinedDeep(history.slice(0, BLUEPRINT_LIMITS.APPROVAL_HISTORY_MAX));
}

export function buildQuotationCreatePayload(
  userId: string,
  quotation: QuotationRecord,
  timestampToken: unknown
): Record<string, unknown> {
  const safeId = sanitizeDocumentId(quotation.id, 'qt');
  const safeStatus =
    quotation.status === 'Converted to Invoice' ? 'Approved' : quotation.status || 'Draft';

  const payload: Record<string, unknown> = {
    userId: sanitizeDocumentId(userId, 'user'),
    id: safeId,
    quotationNumber:
      truncateString(quotation.quotationNumber, BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX) || 'QT-001',
    quotationDate: truncateString(quotation.quotationDate, BLUEPRINT_LIMITS.DATE_MAX),
    validUntilDate: truncateString(quotation.validUntilDate, BLUEPRINT_LIMITS.DATE_MAX),
    customerName:
      truncateString(quotation.customerName, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX) || 'Unnamed Customer',
    currencyCode: truncateString(quotation.currencyCode, BLUEPRINT_LIMITS.CURRENCY_CODE_MAX) || 'INR',
    status: safeStatus,
    subtotal: toSafeNumber(quotation.subtotal),
    taxableAmount: toSafeNumber(quotation.taxableAmount),
    totalTax: toSafeNumber(quotation.totalTax),
    discountAmount: toSafeNumber(quotation.discountAmount),
    totalAmount: toSafeNumber(quotation.totalAmount),
    amountInWords: truncateString(quotation.amountInWords, BLUEPRINT_LIMITS.AMOUNT_IN_WORDS_MAX),
    data: stripUndefinedDeep(quotation.data),
    approvalHistory: sanitizeApprovalHistory(quotation.approvalHistory),
    createdAt: timestampToken,
    updatedAt: timestampToken,
  };

  assignOptionalString(payload, 'customerEmail', quotation.customerEmail, BLUEPRINT_LIMITS.EMAIL_MAX);
  assignOptionalString(payload, 'projectName', quotation.projectName, BLUEPRINT_LIMITS.PROJECT_NAME_MAX);
  assignOptionalString(payload, 'salesperson', quotation.salesperson, BLUEPRINT_LIMITS.SALESPERSON_MAX);
  assignOptionalString(payload, 'approvedAt', quotation.approvedAt, BLUEPRINT_LIMITS.DATETIME_MAX);
  assignOptionalString(payload, 'approvedBy', quotation.approvedBy, BLUEPRINT_LIMITS.APPROVER_MAX);
  assignOptionalString(payload, 'approvalNotes', quotation.approvalNotes, BLUEPRINT_LIMITS.NOTES_MAX);
  assignOptionalString(payload, 'rejectionReason', quotation.rejectionReason, BLUEPRINT_LIMITS.NOTES_MAX);
  return payload;
}

export function buildQuotationUpdatePayload(
  quotation: QuotationRecord,
  timestampToken: unknown
): Record<string, unknown> {
  const safeStatus =
    quotation.status === 'Converted to Invoice' ? 'Approved' : quotation.status || 'Draft';

  const payload: Record<string, unknown> = {
    quotationNumber:
      truncateString(quotation.quotationNumber, BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX) || 'QT-001',
    quotationDate: truncateString(quotation.quotationDate, BLUEPRINT_LIMITS.DATE_MAX),
    validUntilDate: truncateString(quotation.validUntilDate, BLUEPRINT_LIMITS.DATE_MAX),
    customerName:
      truncateString(quotation.customerName, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX) || 'Unnamed Customer',
    currencyCode: truncateString(quotation.currencyCode, BLUEPRINT_LIMITS.CURRENCY_CODE_MAX) || 'INR',
    status: safeStatus,
    subtotal: toSafeNumber(quotation.subtotal),
    taxableAmount: toSafeNumber(quotation.taxableAmount),
    totalTax: toSafeNumber(quotation.totalTax),
    discountAmount: toSafeNumber(quotation.discountAmount),
    totalAmount: toSafeNumber(quotation.totalAmount),
    amountInWords: truncateString(quotation.amountInWords, BLUEPRINT_LIMITS.AMOUNT_IN_WORDS_MAX),
    data: stripUndefinedDeep(quotation.data),
    approvalHistory: sanitizeApprovalHistory(quotation.approvalHistory),
    updatedAt: timestampToken,
  };

  assignOptionalString(payload, 'customerEmail', quotation.customerEmail, BLUEPRINT_LIMITS.EMAIL_MAX);
  assignOptionalString(payload, 'projectName', quotation.projectName, BLUEPRINT_LIMITS.PROJECT_NAME_MAX);
  assignOptionalString(payload, 'salesperson', quotation.salesperson, BLUEPRINT_LIMITS.SALESPERSON_MAX);
  assignOptionalString(payload, 'approvedAt', quotation.approvedAt, BLUEPRINT_LIMITS.DATETIME_MAX);
  assignOptionalString(payload, 'approvedBy', quotation.approvedBy, BLUEPRINT_LIMITS.APPROVER_MAX);
  assignOptionalString(payload, 'approvalNotes', quotation.approvalNotes, BLUEPRINT_LIMITS.NOTES_MAX);
  assignOptionalString(payload, 'rejectionReason', quotation.rejectionReason, BLUEPRINT_LIMITS.NOTES_MAX);
  return payload;
}

export function buildQuotationConvertUpdatePayload(
  quotation: QuotationRecord,
  invoiceId: string,
  invoiceNumber: string,
  timestampToken: unknown
): Record<string, unknown> {
  return {
    status: 'Converted to Invoice',
    approvalHistory: sanitizeApprovalHistory(quotation.approvalHistory),
    convertedInvoiceId: sanitizeDocumentId(invoiceId, 'inv'),
    convertedInvoiceNumber: truncateString(invoiceNumber, BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX),
    convertedAt: truncateString(
      quotation.convertedAt || new Date().toISOString(),
      BLUEPRINT_LIMITS.DATETIME_MAX
    ),
    updatedAt: timestampToken,
  };
}

export function buildInvoiceCreatePayload(
  userId: string,
  record: GenerationRecord,
  timestampToken: unknown
): Record<string, unknown> {
  const safeId = sanitizeDocumentId(record.id, 'inv');
  const validSourceTypes = new Set(['excel', 'googlesheets', 'mock', 'manual']);
  const validStatuses = new Set(['success', 'warning', 'error']);

  const payload: Record<string, unknown> = {
    userId: sanitizeDocumentId(userId, 'user'),
    id: safeId,
    invoiceNumber:
      truncateString(record.invoiceNumber, BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX) || 'INV-001',
    customerName:
      truncateString(record.customerName, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX) || 'Unnamed Customer',
    sourceType: validSourceTypes.has(record.sourceType) ? record.sourceType : 'manual',
    sourceName: truncateString(record.sourceName, BLUEPRINT_LIMITS.SOURCE_NAME_MAX),
    worksheetName: truncateString(record.worksheetName, BLUEPRINT_LIMITS.WORKSHEET_NAME_MAX),
    generatedDate: truncateString(
      record.generatedDate || new Date().toISOString(),
      BLUEPRINT_LIMITS.DATETIME_MAX
    ),
    totalAmount: toSafeNumber(record.totalAmount),
    gstAmount: toSafeNumber(record.gstAmount),
    templateId: truncateString(record.templateId || 'default', BLUEPRINT_LIMITS.ID_MAX),
    profileId: truncateString(record.profileId || 'default', BLUEPRINT_LIMITS.ID_MAX),
    revisionNumber: toSafeNumber(record.revisionNumber, 1),
    status: validStatuses.has(record.status) ? record.status : 'success',
    dataSnapshot: stripUndefinedDeep(
      record.dataSnapshot && typeof record.dataSnapshot === 'object' ? record.dataSnapshot : {}
    ),
    createdAt: timestampToken,
    updatedAt: timestampToken,
  };

  assignOptionalString(payload, 'paymentMethod', record.paymentMethod, BLUEPRINT_LIMITS.PAYMENT_METHOD_MAX);
  assignOptionalString(payload, 'paymentStatus', record.paymentStatus, BLUEPRINT_LIMITS.PAYMENT_STATUS_MAX);
  assignOptionalString(payload, 'paymentDate', record.paymentDate, BLUEPRINT_LIMITS.DATETIME_MAX);
  assignOptionalString(payload, 'paymentReference', record.paymentReference, BLUEPRINT_LIMITS.PAYMENT_REF_MAX);
  if (typeof record.paymentAmount === 'number' && Number.isFinite(record.paymentAmount)) {
    payload.paymentAmount = record.paymentAmount;
  }
  assignOptionalString(payload, 'paymentNotes', record.paymentNotes, BLUEPRINT_LIMITS.NOTES_MAX);
  assignOptionalString(payload, 'sourceQuotationId', record.sourceQuotationId, BLUEPRINT_LIMITS.ID_MAX);
  assignOptionalString(
    payload,
    'sourceQuotationNumber',
    record.sourceQuotationNumber,
    BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX
  );
  return payload;
}

export function buildInvoiceUpdatePayload(
  record: GenerationRecord,
  timestampToken: unknown
): Record<string, unknown> {
  const validSourceTypes = new Set(['excel', 'googlesheets', 'mock', 'manual']);
  const validStatuses = new Set(['success', 'warning', 'error']);

  const payload: Record<string, unknown> = {
    invoiceNumber:
      truncateString(record.invoiceNumber, BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX) || 'INV-001',
    customerName:
      truncateString(record.customerName, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX) || 'Unnamed Customer',
    sourceType: validSourceTypes.has(record.sourceType) ? record.sourceType : 'manual',
    sourceName: truncateString(record.sourceName, BLUEPRINT_LIMITS.SOURCE_NAME_MAX),
    worksheetName: truncateString(record.worksheetName, BLUEPRINT_LIMITS.WORKSHEET_NAME_MAX),
    generatedDate: truncateString(
      record.generatedDate || new Date().toISOString(),
      BLUEPRINT_LIMITS.DATETIME_MAX
    ),
    totalAmount: toSafeNumber(record.totalAmount),
    gstAmount: toSafeNumber(record.gstAmount),
    templateId: truncateString(record.templateId || 'default', BLUEPRINT_LIMITS.ID_MAX),
    profileId: truncateString(record.profileId || 'default', BLUEPRINT_LIMITS.ID_MAX),
    revisionNumber: toSafeNumber(record.revisionNumber, 1),
    status: validStatuses.has(record.status) ? record.status : 'success',
    dataSnapshot: stripUndefinedDeep(
      record.dataSnapshot && typeof record.dataSnapshot === 'object' ? record.dataSnapshot : {}
    ),
    updatedAt: timestampToken,
  };

  assignOptionalString(payload, 'paymentMethod', record.paymentMethod, BLUEPRINT_LIMITS.PAYMENT_METHOD_MAX);
  assignOptionalString(payload, 'paymentStatus', record.paymentStatus, BLUEPRINT_LIMITS.PAYMENT_STATUS_MAX);
  assignOptionalString(payload, 'paymentDate', record.paymentDate, BLUEPRINT_LIMITS.DATETIME_MAX);
  assignOptionalString(payload, 'paymentReference', record.paymentReference, BLUEPRINT_LIMITS.PAYMENT_REF_MAX);
  if (typeof record.paymentAmount === 'number' && Number.isFinite(record.paymentAmount)) {
    payload.paymentAmount = record.paymentAmount;
  }
  assignOptionalString(payload, 'paymentNotes', record.paymentNotes, BLUEPRINT_LIMITS.NOTES_MAX);
  assignOptionalString(payload, 'sourceQuotationId', record.sourceQuotationId, BLUEPRINT_LIMITS.ID_MAX);
  assignOptionalString(
    payload,
    'sourceQuotationNumber',
    record.sourceQuotationNumber,
    BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX
  );
  return payload;
}

export function buildEmailLogCreatePayload(
  userId: string,
  entry: EmailDeliveryLogEntry,
  timestampToken: unknown
): Record<string, unknown> {
  const safeId = sanitizeDocumentId(entry.id, 'elog');
  const payload: Record<string, unknown> = {
    userId: sanitizeDocumentId(userId, 'user'),
    id: safeId,
    documentType: entry.documentType === 'quotation' ? 'quotation' : 'invoice',
    documentId: truncateString(entry.documentId, BLUEPRINT_LIMITS.ID_MAX) || 'doc',
    documentNumber:
      truncateString(entry.documentNumber, BLUEPRINT_LIMITS.DOCUMENT_NUMBER_MAX) || 'DOC-001',
    recipientEmail:
      truncateString(entry.recipientEmail, BLUEPRINT_LIMITS.EMAIL_MAX) || 'recipient@unknown.local',
    deliveryMethod: entry.deliveryMethod === 'smtp' ? 'smtp' : 'gmail',
    senderEmail: truncateString(entry.senderEmail, BLUEPRINT_LIMITS.EMAIL_MAX),
    subject: truncateString(entry.subject, BLUEPRINT_LIMITS.SUBJECT_MAX) || 'Invoice Document',
    status: entry.status === 'failed' ? 'failed' : 'sent',
    createdAt: timestampToken,
  };
  assignOptionalString(payload, 'cc', entry.cc, BLUEPRINT_LIMITS.CC_BCC_MAX);
  assignOptionalString(payload, 'bcc', entry.bcc, BLUEPRINT_LIMITS.CC_BCC_MAX);
  assignOptionalString(
    payload,
    'providerMessageId',
    entry.providerMessageId,
    BLUEPRINT_LIMITS.PROVIDER_MSG_ID_MAX
  );
  assignOptionalString(payload, 'errorMessage', entry.errorMessage, BLUEPRINT_LIMITS.NOTES_MAX);
  return payload;
}
