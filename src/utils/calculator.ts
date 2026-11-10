/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { InvoiceItem, CurrencySettings } from '../types';

export function formatIndianGrouping(intStr: string, sep: string = ','): string {
  if (intStr.length <= 3) return intStr;
  const lastThree = intStr.slice(-3);
  const rest = intStr.slice(0, -3);
  const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, sep);
  return restGrouped + sep + lastThree;
}

export function formatInternationalGrouping(intStr: string, sep: string = ','): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Deduplicates spreadsheet headers ensuring each column has a distinct name.
 * e.g. ['Sale Amount', 'Qty', 'Sale Amount'] -> ['Sale Amount', 'Qty', 'Sale Amount (2)']
 */
export function deduplicateHeaders(rawHeaders: any[]): string[] {
  const seen: Record<string, number> = {};
  return (rawHeaders || []).map((h, i) => {
    let name = String(h !== null && h !== undefined ? h : '').trim();
    if (!name) name = `Col_${i + 1}`;
    if (seen[name] !== undefined) {
      seen[name] += 1;
      return `${name} (${seen[name]})`;
    } else {
      seen[name] = 1;
      return name;
    }
  });
}

/**
 * Universal Currency Formatter
 * Formats any numerical amount according to the user's CurrencySettings.
 * Examples:
 * - INR: ₹ 50,000.00
 * - USD: $ 50,000.00
 * - EUR: € 50,000.00
 * - AED: 50,000.00 د.إ
 */
export function formatCurrency(
  amount: number,
  settings?: Partial<CurrencySettings>
): string {
  const code = settings?.code || settings?.currencyCode || 'INR';
  const symbol = settings?.symbol ?? '₹';
  const placement = settings?.placement || 'before';
  const decimals = settings?.decimalPlaces !== undefined ? settings.decimalPlaces : 2;
  const thousandSep = settings?.thousandSeparator || ',';
  const decimalSep = settings?.decimalSeparator || '.';
  const isIndian = settings?.grouping === 'indian' || 
    settings?.numberingSystem === 'indian' || 
    (!settings?.grouping && !settings?.numberingSystem && (code === 'INR' || symbol === '₹'));
  const showCode = Boolean(settings?.showCode);

  if (isNaN(amount) || amount === null || amount === undefined) {
    const zeroStr = decimals > 0 ? `0${decimalSep}${'0'.repeat(decimals)}` : '0';
    if (placement === 'after') {
      return `${zeroStr} ${symbol}${showCode ? ` ${code}` : ''}`;
    }
    return `${showCode ? `${code} ` : ''}${symbol} ${zeroStr}`;
  }

  const isNeg = amount < 0;
  const abs = Math.abs(amount);

  const fixed = abs.toFixed(decimals);
  const parts = fixed.split('.');
  const intPart = parts[0];
  const decPart = parts[1];

  const groupedInt = isIndian 
    ? formatIndianGrouping(intPart, thousandSep) 
    : formatInternationalGrouping(intPart, thousandSep);

  const numStr = decimals > 0 ? `${groupedInt}${decimalSep}${decPart}` : groupedInt;

  let formatted = '';
  if (placement === 'after') {
    formatted = `${numStr} ${symbol}${showCode ? ` ${code}` : ''}`;
  } else {
    formatted = `${showCode ? `${code} ` : ''}${symbol} ${numStr}`;
  }

  return isNeg ? `- ${formatted}` : formatted;
}

/**
 * Backward compatibility alias for existing code/tests expecting formatINR
 */
export function formatINR(amount: number): string {
  return formatCurrency(amount, {
    currencyCode: 'INR',
    code: 'INR',
    symbol: '₹',
    placement: 'before',
    decimalPlaces: 2,
    thousandSeparator: ',',
    decimalSeparator: '.',
    numberingSystem: 'indian',
    grouping: 'indian',
  });
}

function convertLessThanHundred(n: number): string {
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ',
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 0) return '';
  if (n < 20) return a[n];
  const digit = n % 10;
  const ten = Math.floor(n / 10);
  return b[ten] + (digit ? ' ' + a[digit] : ' ');
}

function convertThreeDigits(n: number): string {
  let str = '';
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (hundred > 0) {
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine '];
    str += a[hundred] + 'Hundred ';
  }
  if (rest > 0) {
    str += convertLessThanHundred(rest);
  }
  return str;
}

function convertIndianWords(n: number): string {
  if (n === 0) return '';
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ',
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  n %= 100;

  let res = '';
  if (crore > 0) res += convertLessThanHundred(crore) + 'Crore ';
  if (lakh > 0) res += convertLessThanHundred(lakh) + 'Lakh ';
  if (thousand > 0) res += convertLessThanHundred(thousand) + 'Thousand ';
  if (hundred > 0) res += a[hundred] + 'Hundred ';
  if (n > 0) {
    if (res !== '') res += 'and ';
    res += convertLessThanHundred(n);
  }
  return res.trim();
}

function convertInternationalWords(n: number): string {
  if (n === 0) return '';
  const billion = Math.floor(n / 1000000000);
  n %= 1000000000;
  const million = Math.floor(n / 1000000);
  n %= 1000000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const rest = n;

  let res = '';
  if (billion > 0) res += convertThreeDigits(billion) + 'Billion ';
  if (million > 0) res += convertThreeDigits(million) + 'Million ';
  if (thousand > 0) res += convertThreeDigits(thousand) + 'Thousand ';
  if (rest > 0) {
    res += convertThreeDigits(rest);
  }
  return res.trim();
}

export function formatAmountInWords(num: number, currency?: Partial<CurrencySettings>): string {
  const code = currency?.code || currency?.currencyCode || 'INR';
  const isIndian = currency?.grouping === 'indian' || 
    currency?.numberingSystem === 'indian' || 
    (!currency?.grouping && !currency?.numberingSystem && (code === 'INR' || currency?.symbol === '₹'));

  const mainUnit = (Math.abs(num) === 1 ? currency?.unitNameSingular : currency?.unitNamePlural) || 
    (code === 'USD' ? 'Dollars' : 
     code === 'EUR' ? 'Euros' : 
     code === 'GBP' ? 'Pounds' : 
     code === 'AED' ? 'Dirhams' : 'Rupees');

  const subUnit = currency?.subunitNamePlural || 
    (code === 'USD' || code === 'EUR' ? 'Cents' : 
     code === 'GBP' ? 'Pence' : 
     code === 'AED' ? 'Fils' : 'Paisa');

  if (isNaN(num) || num === 0) {
    return `Zero ${mainUnit} Only`;
  }

  const whole = Math.floor(Math.abs(num));
  const fraction = Math.round((Math.abs(num) - whole) * 100);

  const words = isIndian ? convertIndianWords(whole) : convertInternationalWords(whole);
  let result = `${words} ${mainUnit}`;
  if (fraction > 0) {
    const fractionWords = isIndian ? convertIndianWords(fraction) : convertInternationalWords(fraction);
    result += ` and ${fractionWords} ${subUnit}`;
  }
  return `${result} Only`;
}

export function numberToWordsINR(num: number): string {
  return formatAmountInWords(num, {
    currencyCode: 'INR',
    unitNamePlural: 'Rupees',
    subunitNamePlural: 'Paisa',
    numberingSystem: 'indian',
  });
}

/**
 * Robust numeric parser for spreadsheet and user-input values.
 * Handles:
 * - Direct numbers: 50000, 1250.50, 0
 * - Formatted strings with commas: "50,000", "1,25,000.50", "1,234,567.89"
 * - Currency symbols: "₹ 50,000.00", "$ 1,000", "€ 500.50", "د.إ 100", "¥ 5000"
 * - Currency codes: "INR 50,000", "USD 1000"
 * - European formatting: "1.250,50"
 * - Negative signs & parenthetical negatives: "- ₹ 500", "(500)", "-1000.50"
 * - Trailing/leading spaces
 * - Preserves full floating-point decimal precision without premature rounding
 * - Returns null for blank/empty/undefined/null cells (does NOT substitute default or adjacent values)
 */
export function parseNumericValue(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  const str = String(val).trim();
  if (str === '') return null;

  // Common non-numeric placeholders in spreadsheets
  if (/^(n\/a|na|nil|null|none|-|--)$/i.test(str)) {
    return null;
  }

  // Check if negative (e.g. -50, (50), - $50)
  const isNegative = /^\s*-\s*/.test(str) || (str.startsWith('(') && str.endsWith(')'));

  // Strip words and abbreviations like "Rs.", "rs.", "INR", "USD", etc.
  let cleaned = str.replace(/[a-zA-Z]+\.?/g, ' ')
                   .replace(/[()\-+/\\]/g, ' ')
                   .trim();

  // Keep digits, commas, and dots
  cleaned = cleaned.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;

  // Detect decimal separator:
  // In European style "1.250,50", comma is decimal separator
  // In Standard/Indian style "1,25,000.50" or "50,000.00", dot is decimal separator
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European format: 1.250,50 -> 1250.50
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Standard / Indian: 1,25,000.50 -> 125000.50
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // Could be "50,000" (thousand separator) or "50,50" (European decimal)
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length !== 3) {
      // e.g. "50,5" or "50,25" -> decimal separator
      cleaned = cleaned.replace(',', '.');
    } else {
      // e.g. "50,000" or "1,25,000" -> thousand separator
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

export interface ItemCalculationInput {
  id?: string;
  serialNumber?: string | number;
  itemName?: string;
  itemDescription?: string;
  hsnSac?: string;
  unit?: string;
  quantity?: number | string | null;
  rate?: number | string | null; // Unit Price
  excelAmount?: number | string | null; // Mapped Line Amount from Excel
  discount?: number | string | null;
  discountType?: 'percentage' | 'fixed';
  gstPercentage?: number | string | null;
  taxType?: 'IGST' | 'CGST_SGST' | 'NONE';
  calculationMode?: 'calculated' | 'excel_amount';
  isTaxInclusive?: boolean; // When in 'excel_amount' mode, does excelAmount include GST?
}

/**
 * Centralized Line Item Calculation Engine
 * Supports two distinct calculation modes:
 * 1. 'calculated' mode:
 *    - Line Subtotal = Quantity × Unit Price
 *    - Discount Amount = configured discount
 *    - Taxable Amount = Line Subtotal − Discount Amount
 *    - GST Amount = Taxable Amount × GST Rate / 100
 *    - Line Total = Taxable Amount + GST Amount
 * 2. 'excel_amount' mode:
 *    - Uses mapped Excel amount directly as the line source
 *    - If tax-exclusive: Taxable Amount = Excel Amount, GST added on top
 *    - If tax-inclusive: Line Total = Excel Amount (tax extracted, never added a second time!)
 */
export function calculateItemTotals(item: Partial<InvoiceItem> | ItemCalculationInput): InvoiceItem {
  const calcMode = item.calculationMode || (item.excelAmount !== undefined && item.excelAmount !== null && item.rate === undefined ? 'excel_amount' : 'calculated');
  const isTaxInclusive = Boolean(item.isTaxInclusive);

  const rawQty = parseNumericValue(item.quantity);
  const qty = rawQty !== null ? rawQty : 1;

  const rawGst = parseNumericValue(item.gstPercentage);
  const gstPct = rawGst !== null ? rawGst : 18;
  const taxType = item.taxType || 'IGST';

  const rawDiscount = parseNumericValue(item.discount);
  const discountVal = rawDiscount !== null ? rawDiscount : 0;
  const discountType = item.discountType || 'fixed';

  let rate = 0;
  let lineSubtotal = 0;
  let discountAmount = 0;
  let taxableAmount = 0;
  let igstAmt = 0;
  let cgstAmt = 0;
  let sgstAmt = 0;
  let igstPct = 0;
  let cgstPct = 0;
  let sgstPct = 0;
  let itemTotal = 0;

  if (calcMode === 'excel_amount') {
    // Mode B: Excel Amount Mode
    const rawExcelAmount = parseNumericValue(item.excelAmount !== undefined && item.excelAmount !== null ? item.excelAmount : item.rate);
    const excelAmt = rawExcelAmount !== null ? rawExcelAmount : 0;

    if (isTaxInclusive) {
      // Test C scenario: Excel Amount already includes GST (e.g. ₹1,180 with 18% GST -> Total ₹1,180, Taxable ₹1,000, GST ₹180)
      itemTotal = excelAmt;
      taxableAmount = gstPct > 0 ? (itemTotal / (1 + gstPct / 100)) : itemTotal;
      const totalTax = itemTotal - taxableAmount;
      lineSubtotal = taxableAmount;
      discountAmount = 0;

      if (taxType === 'IGST') {
        igstPct = gstPct;
        igstAmt = totalTax;
      } else if (taxType === 'CGST_SGST') {
        cgstPct = gstPct / 2;
        sgstPct = gstPct / 2;
        cgstAmt = totalTax / 2;
        sgstAmt = totalTax / 2;
      }
      rate = qty > 0 ? (taxableAmount / qty) : taxableAmount;
    } else {
      // Test B scenario: Excel Amount is tax-exclusive (e.g. ₹1,000 with 18% GST -> Subtotal ₹1,000, GST ₹180, Total ₹1,180)
      lineSubtotal = excelAmt;
      discountAmount = discountType === 'percentage' ? (lineSubtotal * discountVal) / 100 : discountVal;
      taxableAmount = Math.max(0, lineSubtotal - discountAmount);

      if (taxType === 'IGST') {
        igstPct = gstPct;
        igstAmt = (taxableAmount * igstPct) / 100;
      } else if (taxType === 'CGST_SGST') {
        cgstPct = gstPct / 2;
        sgstPct = gstPct / 2;
        cgstAmt = (taxableAmount * cgstPct) / 100;
        sgstAmt = (taxableAmount * sgstPct) / 100;
      }
      const totalTax = igstAmt + cgstAmt + sgstAmt;
      itemTotal = taxableAmount + totalTax;
      rate = qty > 0 ? (lineSubtotal / qty) : lineSubtotal;
    }
  } else {
    // Mode A: Calculated Mode (Quantity × Unit Price - Discount + Tax)
    const rawRate = parseNumericValue(item.rate !== undefined && item.rate !== null ? item.rate : item.excelAmount);
    rate = rawRate !== null ? rawRate : 0;

    lineSubtotal = qty * rate;
    discountAmount = discountType === 'percentage' ? (lineSubtotal * discountVal) / 100 : discountVal;
    taxableAmount = Math.max(0, lineSubtotal - discountAmount);

    if (taxType === 'IGST') {
      igstPct = gstPct;
      igstAmt = (taxableAmount * igstPct) / 100;
    } else if (taxType === 'CGST_SGST') {
      cgstPct = gstPct / 2;
      sgstPct = gstPct / 2;
      cgstAmt = (taxableAmount * cgstPct) / 100;
      sgstAmt = (taxableAmount * sgstPct) / 100;
    }

    const totalTax = igstAmt + cgstAmt + sgstAmt;
    itemTotal = taxableAmount + totalTax;
  }

  return {
    id: item.id || Math.random().toString(36).substr(2, 9),
    serialNumber: item.serialNumber || 1,
    itemName: item.itemName || 'Professional Consulting Services',
    itemDescription: item.itemDescription || '',
    hsnSac: item.hsnSac || '9983',
    quantity: qty,
    unit: item.unit || 'Nos',
    rate,
    lineSubtotal,
    discount: discountVal,
    discountType,
    discountAmount,
    excelAmount: parseNumericValue(item.excelAmount) ?? undefined,
    isTaxInclusive,
    calculationMode: calcMode,
    taxableAmount,
    gstPercentage: gstPct,
    taxType,
    igstPercentage: igstPct,
    igstAmount: igstAmt,
    cgstPercentage: cgstPct,
    cgstAmount: cgstAmt,
    sgstPercentage: sgstPct,
    sgstAmount: sgstAmt,
    itemTotal,
  };
}

/**
 * Single Source of Truth for Grand Total & Summary Calculation
 *
 * Invoice Subtotal = Sum of line subtotals.
 * Total Discount = Sum of line discounts + additional discount.
 * Taxable Total = Invoice Subtotal − Total Discount.
 * Total GST = Sum of applicable GST amounts.
 * Grand Total = Taxable Total + Total GST + Other Charges − Additional Discounts.
 * If tax is already included in imported amounts, tax is preserved without adding GST again.
 * Balance Due = Grand Total − Advance Paid.
 */
export function calculateInvoiceSummary(
  items: InvoiceItem[], 
  additionalDiscount: number = 0, 
  otherCharges: number = 0, 
  advancePaid: number = 0,
  currency?: Partial<CurrencySettings>
) {
  let subtotal = 0;
  let totalLineDiscount = 0;
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  items.forEach(item => {
    subtotal += item.taxableAmount + (item.discountAmount || 0);
    totalLineDiscount += (item.discountAmount || 0);
    totalTaxable += item.taxableAmount;
    totalCgst += item.cgstAmount;
    totalSgst += item.sgstAmount;
    totalIgst += item.igstAmount;
  });

  const totalTax = totalCgst + totalSgst + totalIgst;
  const taxableTotalAfterDiscount = Math.max(0, totalTaxable - additionalDiscount);
  const grossTotal = taxableTotalAfterDiscount + totalTax + otherCharges;
  const roundedTotal = Math.round(grossTotal);
  const roundOff = roundedTotal - grossTotal;
  const balanceDue = Math.max(0, roundedTotal - advancePaid);

  return {
    subtotal,
    totalDiscount: totalLineDiscount + additionalDiscount,
    lineDiscount: totalLineDiscount,
    additionalDiscount,
    totalTaxable: taxableTotalAfterDiscount,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    otherCharges,
    additionalCharges: otherCharges, // alias for backwards compatibility
    discount: additionalDiscount + totalLineDiscount, // alias
    roundOff,
    grossTotal,
    totalInvoiceAmount: roundedTotal,
    amountInWords: formatAmountInWords(roundedTotal, currency),
    paymentMade: advancePaid,
    balanceDue,
  };
}

/**
 * Centralized Row-to-Invoice Data Transformation Engine
 * Strictly maps user-selected Excel columns without accidental fallbacks.
 */
export function evaluateFieldValue(field: any, row: Record<string, any>, rowIndex: number, company?: any): any {
  const key = field.id || field.key;
  
  // 1. Manual override / custom edited value in row
  if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
    return row[key];
  }
  if (field.manualValue !== undefined && field.manualValue !== '' && field.manualValue !== null) {
    return field.manualValue;
  }

  // 2. Mapping mode evaluation
  const mode = field.mappingMode || 'excel_column';
  const col = field.sourceColumn || field.mappedColumn;

  if (mode === 'empty') {
    return '';
  }

  if (mode === 'manual') {
    return field.manualValue !== undefined ? field.manualValue : (field.value || field.defaultValue || '');
  }

  if (mode === 'default') {
    return field.defaultValue !== undefined ? field.defaultValue : field.value;
  }

  if (mode === 'auto_generate' && field.autoGenerateConfig) {
    const cfg = field.autoGenerateConfig;
    if (key === 'invoice_number') {
      const prefix = cfg.prefix || 'INV-2026-';
      const start = cfg.startNumber || 1;
      return `${prefix}${String(start + rowIndex).padStart(3, '0')}`;
    }
    if (key === 'invoice_date') {
      return cfg.template || new Date().toISOString().split('T')[0];
    }
    if (key === 'due_date') {
      const days = cfg.daysOffset || 15;
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    }
    if (key === 'subject_description') {
      const tmpl = cfg.template || 'Invoice for {Customer Name}';
      const cust = row['Customer Name'] || row['Customer'] || row['Buyer Name'] || 'Customer';
      return tmpl.replace('{Customer Name}', String(cust));
    }
    if (cfg.template) {
      return cfg.template;
    }
  }

  // 3. Excel column mapping
  if (col && row[col] !== undefined && row[col] !== null && row[col] !== '') {
    return row[col];
  }

  // 4. Default fallback
  return field.defaultValue !== undefined ? field.defaultValue : (field.value || '');
}

/**
 * Centralized Row-to-Invoice Data Transformation Engine
 * Supports Excel column mapping, auto-generation, manual overrides, and multi-item lists.
 */
export function transformRowToInvoice(
  row: Record<string, any>,
  fields: any[],
  calcSettings?: { mode: 'calculated' | 'excel_amount'; taxInclusive: boolean },
  company?: any,
  template?: any,
  rowIndex: number = 0
) {
  const mode = calcSettings?.mode || 'calculated';
  const isTaxInclusive = Boolean(calcSettings?.taxInclusive);

  const fieldMap: Record<string, any> = {};
  fields.forEach(f => {
    const key = f.id || f.key;
    fieldMap[key] = evaluateFieldValue(f, row, rowIndex, company);
  });

  // Inject company defaults if not mapped to a spreadsheet column
  if (company) {
    if (!fieldMap['company_legal_name']) fieldMap['company_legal_name'] = company.legalName;
    if (!fieldMap['company_address']) {
      fieldMap['company_address'] = `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`;
    }
    if (!fieldMap['company_gstin']) fieldMap['company_gstin'] = company.gstin;
    if (!fieldMap['company_email']) fieldMap['company_email'] = company.email;
    if (!fieldMap['notes_content']) fieldMap['notes_content'] = company.content?.defaultNotes;
    if (!fieldMap['terms_content']) fieldMap['terms_content'] = company.content?.defaultTerms;
    if (!fieldMap['invoice_title']) {
      fieldMap['invoice_title'] = template?.labels?.['invoice_title'] || company.content?.invoiceTitle || 'TAX INVOICE';
    }
  }

  // Check for custom items in row (multi-item support)
  const customItems = row['custom_items'] || row['items'];
  let items: InvoiceItem[] = [];

  if (Array.isArray(customItems) && customItems.length > 0) {
    items = customItems.map(ci => calculateItemTotals(ci));
  } else {
    const rawItemName = fieldMap['item_name'] || row['Item Name'] || 'Professional Consulting & Mentorship Program';
    const rawDesc = fieldMap['item_description'] || row['Description'] || row['Subject'] || fieldMap['subject_description'] || 'Consulting & Mentorship Services';
    const rawHsn = fieldMap['item_hsn'] || row['HSN/SAC'] || '9983';
    const rawQty = fieldMap['item_quantity'] ?? row['Quantity'] ?? row['Qty'] ?? 1;
    const rawRate = fieldMap['item_unit_price'] ?? row['Rate'] ?? row['Unit Price'] ?? 0;
    const rawAmount = fieldMap['item_amount'] ?? row['Amount'] ?? row['Line Total'];
    const rawDiscount = fieldMap['item_discount'] ?? row['Discount'] ?? 0;
    const rawGst = fieldMap['item_gst_rate'] ?? row['GST %'] ?? row['Tax Rate'] ?? 18;

    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: String(rawItemName),
      itemDescription: String(rawDesc),
      hsnSac: String(rawHsn),
      quantity: rawQty,
      rate: rawRate,
      excelAmount: rawAmount,
      discount: rawDiscount,
      gstPercentage: rawGst,
      taxType: 'IGST',
      calculationMode: mode,
      isTaxInclusive,
    });
    items = [item];
  }

  const summary = calculateInvoiceSummary(items, 0, 0, 0, company?.currency);

  return {
    rowFields: fieldMap,
    items,
    summary,
  };
}

/**
 * Excel Mapping Validation Function
 * Validates mappings before generation to prevent silent substitutions and calculation errors.
 */
export function validateExcelMapping(
  fields: any[],
  calcSettings: { mode: 'calculated' | 'excel_amount'; taxInclusive: boolean },
  sampleRows: Record<string, any>[]
): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const getField = (id: string) => fields.find(f => (f.id === id || f.key === id));
  const getCol = (f: any) => f?.sourceColumn || f?.mappedColumn;

  const qtyField = getField('item_quantity');
  const rateField = getField('item_unit_price');
  const amountField = getField('item_amount');

  const rateCol = getCol(rateField);
  const amountCol = getCol(amountField);

  if (calcSettings.mode === 'calculated') {
    if (!rateCol) {
      warnings.push("Unit Price / Rate column is not mapped. The engine will check row fields or use default rate.");
    }
  } else if (calcSettings.mode === 'excel_amount') {
    if (!amountCol) {
      errors.push("Excel Amount mode is active, but the Item Total Amount column is not mapped.");
    }
  }

  // Check for duplicate mappings
  if (rateCol && amountCol && rateCol === amountCol) {
    warnings.push(`Same column "${rateCol}" is mapped to both Unit Price and Line Amount. Please verify your calculation mode.`);
  }

  // Validate numeric values in sample rows
  if (sampleRows && sampleRows.length > 0) {
    const firstRow = sampleRows[0];
    if (calcSettings.mode === 'calculated' && rateCol) {
      const val = firstRow[rateCol];
      if (val !== undefined && val !== null && val !== '') {
        const parsed = parseNumericValue(val);
        if (parsed === null) {
          errors.push(`Column "${rateCol}" contains non-numeric value "${val}" which cannot be parsed as a number.`);
        }
      }
    }
    if (calcSettings.mode === 'excel_amount' && amountCol) {
      const val = firstRow[amountCol];
      if (val !== undefined && val !== null && val !== '') {
        const parsed = parseNumericValue(val);
        if (parsed === null) {
          errors.push(`Column "${amountCol}" contains non-numeric value "${val}" which cannot be parsed as a number.`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Builds Audit/Debug verification table data for an Excel row
 * Required by section 6: Debugging & Verification View
 */
export function buildAuditDataForRow(
  row: Record<string, any>,
  fields: any[],
  calcSettings: { mode: 'calculated' | 'excel_amount'; taxInclusive: boolean },
  currency?: Partial<CurrencySettings>
) {
  const getField = (id: string) => fields.find(f => (f.id === id || f.key === id));
  const getCol = (f: any) => f?.sourceColumn || f?.mappedColumn;

  const qtyField = getField('item_quantity');
  const rateField = getField('item_unit_price');
  const amountField = getField('item_amount');
  const gstField = getField('item_gst_rate');

  const qtyCol = getCol(qtyField) || (row['Quantity'] !== undefined ? 'Quantity' : row['Qty'] !== undefined ? 'Qty' : 'Unmapped');
  const rateCol = getCol(rateField) || (row['Rate'] !== undefined ? 'Rate' : row['Unit Price'] !== undefined ? 'Unit Price' : 'Unmapped');
  const amountCol = getCol(amountField) || (row['Amount'] !== undefined ? 'Amount' : row['Line Total'] !== undefined ? 'Line Total' : 'Unmapped');
  const gstCol = getCol(gstField) || (row['GST %'] !== undefined ? 'GST %' : row['Tax Rate'] !== undefined ? 'Tax Rate' : 'Unmapped');

  const rawQty = qtyCol !== 'Unmapped' ? row[qtyCol] : undefined;
  const rawRate = rateCol !== 'Unmapped' ? row[rateCol] : undefined;
  const rawAmount = amountCol !== 'Unmapped' ? row[amountCol] : undefined;
  const rawGst = gstCol !== 'Unmapped' ? row[gstCol] : undefined;

  const transformed = transformRowToInvoice(row, fields, calcSettings, undefined, undefined);
  const item = transformed.items[0];
  const summary = transformed.summary;

  return [
    {
      field: 'Quantity',
      sourceColumn: qtyCol,
      importedValue: rawQty !== undefined ? String(rawQty) : '—',
      finalValue: `${item.quantity} ${item.unit || 'Nos'}`,
      isMapped: qtyCol !== 'Unmapped'
    },
    {
      field: 'Unit Price',
      sourceColumn: rateCol,
      importedValue: rawRate !== undefined ? String(rawRate) : '—',
      finalValue: formatCurrency(item.rate, currency),
      isMapped: rateCol !== 'Unmapped'
    },
    {
      field: 'Line Amount',
      sourceColumn: amountCol,
      importedValue: rawAmount !== undefined ? String(rawAmount) : '—',
      finalValue: formatCurrency(item.taxableAmount, currency),
      isMapped: amountCol !== 'Unmapped'
    },
    {
      field: 'GST / Tax',
      sourceColumn: gstCol,
      importedValue: rawGst !== undefined ? String(rawGst) : '—',
      finalValue: `${formatCurrency(item.igstAmount || (item.cgstAmount + item.sgstAmount), currency)} (${item.gstPercentage}%)`,
      isMapped: gstCol !== 'Unmapped'
    },
    {
      field: 'Grand Total',
      sourceColumn: 'Calculated Engine',
      importedValue: '—',
      finalValue: formatCurrency(summary.totalInvoiceAmount, currency),
      isMapped: true
    }
  ];
}

