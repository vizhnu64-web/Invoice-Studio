/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Intelligent Auto-Mapping Engine for Invoice Fields
 * Matches spreadsheet column headers to standard invoice fields using a synonym dictionary,
 * exact matching, prefix/suffix stripping, and Levenshtein similarity.
 */

export interface MatchSuggestion {
  fieldId: string;
  column: string;
  confidence: number; // 0 to 100
  reason: string;
}

// Comprehensive synonym catalog for common invoice and billing spreadsheet headers
export const FIELD_SYNONYMS: Record<string, string[]> = {
  invoice_number: [
    'invoice number', 'invoice no', 'invoice no.', 'inv #', 'inv no', 'inv number',
    'invoice_num', 'invoice_no', 'invoice ref', 'bill no', 'bill number', 'bill #',
    'voucher no', 'reference no', 'ref #', 'doc no', 'document number', 'transaction id'
  ],
  invoice_date: [
    'invoice date', 'inv date', 'date', 'bill date', 'billing date', 'txn date',
    'transaction date', 'enrollment date', 'issue date', 'dated', 'inv_date'
  ],
  due_date: [
    'due date', 'payment due', 'payment due date', 'expiry date', 'valid till', 'due_date'
  ],
  place_of_supply: [
    'place of supply', 'supply place', 'billing location', 'location', 'pos', 'state',
    'destination state', 'supply state', 'client state'
  ],
  customer_name: [
    'customer name', 'client name', 'client', 'customer', 'buyer name', 'buyer',
    'participant name', 'student name', 'candidate name', 'billed to', 'bill to name',
    'bill to client', 'party name', 'name'
  ],
  customer_business: [
    'customer business', 'company name', 'organization', 'client company', 'business name',
    'firm name', 'agency name', 'enterprise'
  ],
  customer_address: [
    'customer address', 'client address', 'buyer address', 'address', 'billing address',
    'bill to address', 'street', 'city', 'location address'
  ],
  customer_gstin: [
    'customer gstin', 'gstin', 'gstin / uin', 'gst number', 'gst no', 'gst #',
    'client gstin', 'buyer gstin', 'tax id', 'vat number', 'tax registration'
  ],
  customer_email: [
    'customer email', 'client email', 'buyer email', 'email', 'email address', 'contact email'
  ],
  customer_phone: [
    'customer phone', 'client phone', 'phone', 'contact number', 'mobile', 'mobile no',
    'telephone', 'phone number'
  ],
  subject_description: [
    'subject', 'subject description', 'service subject', 'summary', 'project title',
    'purpose', 'work description'
  ],
  item_name: [
    'item description', 'description', 'product details', 'service details', 'item name',
    'particulars', 'service item', 'program title', 'product name', 'course name',
    'mentorship program', 'items', 'item'
  ],
  item_description: [
    'item description', 'description', 'product details', 'service details', 'item name',
    'particulars', 'service item', 'program title', 'product name', 'course name',
    'mentorship program', 'items', 'item'
  ],
  item_hsn: [
    'hsn', 'sac', 'hsn/sac', 'hsn / sac', 'hsn code', 'sac code', 'commodity code'
  ],
  item_quantity: [
    'quantity', 'qty', 'count', 'units', 'nos', 'qnty', 'pieces', 'volume', 'quantity ordered'
  ],
  item_unit: [
    'unit', 'uom', 'unit of measure', 'measurement'
  ],
  item_unit_price: [
    'rate', 'unit price', 'price', 'unit rate', 'item rate', 'cost per unit', 'price per unit', 'mrp', 'unit price in inr'
  ],
  item_amount: [
    'amount', 'line total', 'item total', 'total amount', 'line amount', 'fee', 'charge', 'gross amount'
  ],
  item_discount: [
    'discount', 'disc', 'discount amount', 'discount %', 'rebate', 'concession'
  ],
  item_gst_rate: [
    'gst %', 'gst rate', 'tax rate', 'tax %', 'gst percentage', 'tax percentage', 'gst', 'igst rate %', 'igst rate', 'cgst rate'
  ],
  subtotal: [
    'subtotal', 'sub total', 'taxable total', 'gross total', 'total before tax'
  ],
  total_invoice_amount: [
    'total invoice amount', 'grand total', 'net amount', 'invoice total', 'final amount', 'payable amount', 'amount paid'
  ],
  payment_made: [
    'payment made', 'payment received', 'paid amount', 'advance paid', 'amount received'
  ],
  notes_content: [
    'notes', 'remarks', 'comments', 'special instructions'
  ],
  terms_content: [
    'terms', 'terms and conditions', 'payment terms', 'conditions'
  ],
  payment_method: [
    'payment method', 'mode of payment', 'payment type', 'payment mode', 'transaction mode',
    'paid through', 'payment_method', 'mode', 'payment type / mode'
  ],
  payment_status: [
    'payment status', 'status', 'payment state', 'paid status', 'settled'
  ],
  payment_date: [
    'payment date', 'paid date', 'settlement date', 'received date', 'payment_date'
  ],
  payment_reference: [
    'payment reference', 'transaction reference', 'txn ref', 'utr', 'reference id',
    'transaction id', 'payment ref', 'cheque no', 'reference number'
  ],
  amount_paid: [
    'amount paid', 'paid amount', 'payment received', 'received amount', 'cleared amount', 'amount_paid'
  ]
};

function normalizeHeader(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Calculates similarity between column name and standard field synonyms.
 * Returns score 0-100.
 */
export function calculateMatchScore(columnName: string, fieldId: string): { score: number; reason: string } {
  const normCol = normalizeHeader(columnName);
  const synonyms = FIELD_SYNONYMS[fieldId] || [];

  // 1. Exact match with fieldId itself (e.g. "customer_name" vs "customer name")
  const normFieldId = normalizeHeader(fieldId);
  if (normCol === normFieldId) {
    return { score: 100, reason: 'Exact field name match' };
  }

  // 2. Exact match with any synonym
  for (const syn of synonyms) {
    const normSyn = normalizeHeader(syn);
    if (normCol === normSyn) {
      return { score: 98, reason: `Exact match with synonym "${syn}"` };
    }
  }

  // 3. Normalized column contains synonym or synonym contains column
  for (const syn of synonyms) {
    const normSyn = normalizeHeader(syn);
    if (normCol.startsWith(normSyn) || normCol.endsWith(normSyn)) {
      return { score: 85, reason: `Prefix/suffix match with "${syn}"` };
    }
    if (normCol.includes(normSyn) && normSyn.length >= 4) {
      return { score: 75, reason: `Contains keyword "${syn}"` };
    }
  }

  // 4. Token overlap
  const colWords = normCol.split(' ').filter(w => w.length > 2);
  for (const syn of synonyms) {
    const synWords = normalizeHeader(syn).split(' ').filter(w => w.length > 2);
    const overlap = colWords.filter(w => synWords.includes(w));
    if (overlap.length > 0 && overlap.length === synWords.length) {
      return { score: 70, reason: `Keyword match on "${overlap.join(' ')}"` };
    }
  }

  return { score: 0, reason: 'No match' };
}

/**
 * Suggests best matches for all spreadsheet headers against invoice fields.
 * Accepts either (columnHeaders, availableFields) or (availableFields, columnHeaders).
 */
export function suggestMappings(
  arg1: any[],
  arg2: any[]
): Record<string, MatchSuggestion> {
  let columnHeaders: string[] = [];
  let availableFields: Array<{ id?: string; key?: string; displayName?: string; [key: string]: any }> = [];

  if (Array.isArray(arg1) && arg1.length > 0 && typeof arg1[0] === 'object' && arg1[0] !== null) {
    availableFields = arg1;
    columnHeaders = arg2 || [];
  } else {
    columnHeaders = arg1 || [];
    availableFields = arg2 || [];
  }

  const suggestions: Record<string, MatchSuggestion> = {};
  const usedColumns = new Set<string>();

  // Phase 1: High confidence matches (>= 85%)
  for (const field of availableFields) {
    const fieldId = String(field.id || field.key || '');
    if (!fieldId) continue;
    let bestMatch: { col: string; score: number; reason: string } | null = null;

    for (const col of columnHeaders) {
      if (usedColumns.has(col)) continue;
      const { score, reason } = calculateMatchScore(col, fieldId);
      if (score >= 85 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { col, score, reason };
      }
    }

    if (bestMatch) {
      suggestions[fieldId] = {
        fieldId,
        column: bestMatch.col,
        confidence: bestMatch.score,
        reason: bestMatch.reason
      };
      usedColumns.add(bestMatch.col);
    }
  }

  // Phase 2: Moderate confidence matches (>= 65%) for remaining unmapped fields
  for (const field of availableFields) {
    const fieldId = String(field.id || field.key || '');
    if (!fieldId || suggestions[fieldId]) continue;
    let bestMatch: { col: string; score: number; reason: string } | null = null;

    for (const col of columnHeaders) {
      if (usedColumns.has(col)) continue;
      const { score, reason } = calculateMatchScore(col, fieldId);
      if (score >= 65 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { col, score, reason };
      }
    }

    if (bestMatch) {
      suggestions[fieldId] = {
        fieldId,
        column: bestMatch.col,
        confidence: bestMatch.score,
        reason: bestMatch.reason
      };
      usedColumns.add(bestMatch.col);
    }
  }

  return suggestions;
}
