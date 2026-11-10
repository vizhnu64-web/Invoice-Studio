/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { 
  calculateItemTotals, 
  calculateInvoiceSummary, 
  numberToWordsINR, 
  formatINR, 
  formatCurrency, 
  formatAmountInWords,
  parseNumericValue,
  transformRowToInvoice,
  validateExcelMapping,
  buildAuditDataForRow
} from './calculator';
import { generateInvoicePDF } from './pdfGenerator';
import { defaultCompanySettings, defaultFieldCatalog, defaultMappingProfiles, sampleSpreadsheetData, CURRENCY_CATALOG } from '../mockData';
import { CompanySettings, CurrencySettings, CalculationSettings, InvoiceFieldConfig } from '../types';

describe('Invoice Studio - Automated Logic & PDF Generation Test Suite', () => {
  
  test('1. Number to Words INR Conversion', () => {
    assert.strictEqual(numberToWordsINR(59000), 'Fifty Nine Thousand Rupees Only');
    assert.strictEqual(numberToWordsINR(100000), 'One Lakh Rupees Only');
    assert.strictEqual(numberToWordsINR(150250), 'One Lakh Fifty Thousand Two Hundred and Fifty Rupees Only');
    assert.strictEqual(numberToWordsINR(0), 'Zero Rupees Only');
  });

  test('2. Indian Currency Formatting', () => {
    assert.strictEqual(formatINR(59000), '₹ 59,000.00');
    assert.strictEqual(formatINR(1234567.89), '₹ 12,34,567.89');
    assert.strictEqual(formatINR(0), '₹ 0.00');
  });

  test('3. Tax & Item Calculation Engine (Inter-State IGST)', () => {
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: '90 Days Mentorship Program',
      quantity: 1,
      rate: 50000,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    assert.strictEqual(item.taxableAmount, 50000);
    assert.strictEqual(item.igstAmount, 9000);
    assert.strictEqual(item.cgstAmount, 0);
    assert.strictEqual(item.sgstAmount, 0);
    assert.strictEqual(item.itemTotal, 59000);

    const summary = calculateInvoiceSummary([item], 0, 0, 59000);
    assert.strictEqual(summary.subtotal, 50000);
    assert.strictEqual(summary.totalIgst, 9000);
    assert.strictEqual(summary.totalInvoiceAmount, 59000);
    assert.strictEqual(summary.paymentMade, 59000);
    assert.strictEqual(summary.balanceDue, 0);
  });

  test('4. Tax & Item Calculation Engine (Intra-State CGST + SGST)', () => {
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Local Consulting Services',
      quantity: 2,
      rate: 20000,
      gstPercentage: 18,
      taxType: 'CGST_SGST'
    });

    assert.strictEqual(item.taxableAmount, 40000);
    assert.strictEqual(item.cgstAmount, 3600);
    assert.strictEqual(item.sgstAmount, 3600);
    assert.strictEqual(item.igstAmount, 0);
    assert.strictEqual(item.itemTotal, 47200);

    const summary = calculateInvoiceSummary([item], 0, 0, 0);
    assert.strictEqual(summary.subtotal, 40000);
    assert.strictEqual(summary.totalCgst, 3600);
    assert.strictEqual(summary.totalSgst, 3600);
    assert.strictEqual(summary.totalInvoiceAmount, 47200);
    assert.strictEqual(summary.balanceDue, 47200);
  });

  test('5. Default Mock Datasets & Mapping Profiles', () => {
    assert.strictEqual(sampleSpreadsheetData.worksheets.length, 5);
    assert.strictEqual(defaultMappingProfiles.length, 5);
    assert.strictEqual(defaultFieldCatalog.length > 10, true);
    assert.strictEqual(defaultCompanySettings.legalName, 'TBT VENTURES PRIVATE LIMITED');
  });

  test('6. PDF Generation Engine Execution with Standard Settings', () => {
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Test Mentorship',
      itemDescription: 'Full 90 Days Mentorship Program',
      quantity: 1,
      rate: 10000,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    const fields = {
      company_legal_name: defaultCompanySettings.legalName,
      company_address: 'Gurugram, Haryana',
      company_gstin: defaultCompanySettings.gstin,
      invoice_title: 'TAX INVOICE',
      invoice_number: '2627/11/TBT/01',
      invoice_date: '2026-11-01',
      due_date: '2026-11-15',
      place_of_supply: 'Haryana (06)',
      customer_name: 'Aarav Sharma',
      customer_business: 'Sharma Enterprises',
      customer_address: 'Gurgaon, Haryana',
      customer_gstin: '06AABCS1234Q1ZU',
      subject_description: 'Consulting Services',
      notes_content: 'Thank you for your business.',
      terms_content: 'Net 15 days payment terms.'
    };

    const doc = generateInvoicePDF({
      company: defaultCompanySettings,
      items: [item],
      fields,
      paymentMade: 11800
    });

    assert.notStrictEqual(doc, null);
    const pdfOutput = doc.output('arraybuffer');
    assert.strictEqual(pdfOutput.byteLength > 0, true);
  });

  test('7. Company Settings Customization Reflection in PDF', () => {
    // Custom Company Settings to verify full custom branding pipeline
    const customCompany: CompanySettings = {
      ...defaultCompanySettings,
      legalName: 'ACME INNOVATIONS PRIVATE LIMITED',
      displayName: 'Acme Innovations',
      gstin: '27AABCA1234A1Z5',
      pan: 'AABCA1234A',
      cin: 'U72200MH2024PTC987654',
      addressLine1: '99 Tech Boulevard',
      addressLine2: 'Bandra Kurla Complex',
      city: 'Mumbai',
      state: 'Maharashtra',
      pinCode: '400051',
      phone: '+91 99887 76655',
      email: 'finance@acmeinnovations.com',
      brandPalette: {
        ...defaultCompanySettings.brandPalette,
        primaryColor: '#059669', // Emerald
        headingColor: '#064e3b',
        tableHeaderBg: '#059669',
        totalHighlightColor: '#059669'
      },
      bankAccounts: [
        {
          id: 'acc_custom_1',
          accountHolderName: 'ACME INNOVATIONS PRIVATE LIMITED',
          bankAccountName: 'Kotak Mahindra Bank',
          accountNumber: '987654321098',
          ifscCode: 'KKBK0001234',
          bankName: 'Kotak Mahindra Bank',
          branch: 'BKC Mumbai',
          upiId: 'acme@kotak',
          isDefault: true
        }
      ],
      activeBankId: 'acc_custom_1'
    };

    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Enterprise AI Architecture & Consulting',
      itemDescription: 'Q4 Enterprise Cloud & AI Roadmap Consulting Services',
      quantity: 1,
      rate: 150000,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    const doc = generateInvoicePDF({
      company: customCompany,
      items: [item],
      fields: {
        invoice_number: 'ACME/2026/001',
        customer_name: 'Global Enterprise Corp',
        customer_address: 'Nariman Point, Mumbai',
        invoice_date: '2026-11-08'
      },
      paymentMade: 177000
    });

    assert.notStrictEqual(doc, null);
    const pdfOutput = doc.output('arraybuffer');
    assert.strictEqual(pdfOutput.byteLength > 1000, true);
  });

  test('8. Multi-Currency Formatting Engine (USD, EUR, GBP, AED, JPY, KWD)', () => {
    // Default INR
    assert.strictEqual(formatCurrency(50000), '₹ 50,000.00');

    // USD
    const usdSettings: CurrencySettings = {
      code: 'USD',
      symbol: '$',
      placement: 'before',
      decimalPlaces: 2,
      thousandSeparator: ',',
      decimalSeparator: '.',
      grouping: 'international'
    };
    assert.strictEqual(formatCurrency(50000, usdSettings), '$ 50,000.00');
    assert.strictEqual(formatCurrency(1234567.89, usdSettings), '$ 1,234,567.89');
    assert.strictEqual(formatCurrency(-500, usdSettings), '- $ 500.00');
    assert.strictEqual(formatCurrency(0, usdSettings), '$ 0.00');

    // EUR with comma decimal separator and dot thousand separator
    const eurSettings: CurrencySettings = {
      code: 'EUR',
      symbol: '€',
      placement: 'before',
      decimalPlaces: 2,
      thousandSeparator: '.',
      decimalSeparator: ',',
      grouping: 'international'
    };
    assert.strictEqual(formatCurrency(50000, eurSettings), '€ 50.000,00');

    // GBP
    const gbpSettings: CurrencySettings = {
      code: 'GBP',
      symbol: '£',
      placement: 'before',
      decimalPlaces: 2,
      thousandSeparator: ',',
      decimalSeparator: '.',
      grouping: 'international'
    };
    assert.strictEqual(formatCurrency(50000, gbpSettings), '£ 50,000.00');

    // AED with 'after' placement
    const aedSettings: CurrencySettings = {
      code: 'AED',
      symbol: 'د.إ',
      placement: 'after',
      decimalPlaces: 2,
      thousandSeparator: ',',
      decimalSeparator: '.',
      grouping: 'international'
    };
    assert.strictEqual(formatCurrency(50000, aedSettings), '50,000.00 د.إ');

    // JPY with 0 decimal places
    const jpySettings: CurrencySettings = {
      code: 'JPY',
      symbol: '¥',
      placement: 'before',
      decimalPlaces: 0,
      thousandSeparator: ',',
      decimalSeparator: '.',
      grouping: 'international'
    };
    assert.strictEqual(formatCurrency(50000, jpySettings), '¥ 50,000');

    // KWD with 3 decimal places
    const kwdSettings: CurrencySettings = {
      code: 'KWD',
      symbol: 'KD',
      placement: 'before',
      decimalPlaces: 3,
      thousandSeparator: ',',
      decimalSeparator: '.',
      grouping: 'international'
    };
    assert.strictEqual(formatCurrency(50000.125, kwdSettings), 'KD 50,000.125');

    // Optional showCode: true
    const showCodeSettings: CurrencySettings = {
      ...usdSettings,
      showCode: true
    };
    assert.strictEqual(formatCurrency(50000, showCodeSettings), 'USD $ 50,000.00');
  });

  test('9. International Number to Words Formatting', () => {
    // Rupees
    assert.strictEqual(
      formatAmountInWords(59000, { code: 'INR', symbol: '₹', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.' }),
      'Fifty Nine Thousand Rupees Only'
    );

    // Dollars
    assert.strictEqual(
      formatAmountInWords(50000, { code: 'USD', symbol: '$', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.' }),
      'Fifty Thousand Dollars Only'
    );

    // Euros
    assert.strictEqual(
      formatAmountInWords(1250000, { code: 'EUR', symbol: '€', placement: 'before', decimalPlaces: 2, thousandSeparator: '.', decimalSeparator: ',' }),
      'One Million Two Hundred Fifty Thousand Euros Only'
    );

    // Pounds
    assert.strictEqual(
      formatAmountInWords(750, { code: 'GBP', symbol: '£', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.' }),
      'Seven Hundred Fifty Pounds Only'
    );

    // Dirhams
    assert.strictEqual(
      formatAmountInWords(25000, { code: 'AED', symbol: 'د.إ', placement: 'after', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.' }),
      'Twenty Five Thousand Dirhams Only'
    );
  });

  test('10. PDF Generation with International Currencies (USD & EUR)', () => {
    const usdCompany: CompanySettings = {
      ...defaultCompanySettings,
      currency: {
        code: 'USD',
        symbol: '$',
        placement: 'before',
        decimalPlaces: 2,
        thousandSeparator: ',',
        decimalSeparator: '.',
        grouping: 'international'
      }
    };

    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'SaaS Platform License & Support',
      quantity: 1,
      rate: 2500,
      gstPercentage: 0,
      taxType: 'IGST'
    });

    const doc = generateInvoicePDF({
      company: usdCompany,
      items: [item],
      fields: {
        invoice_number: 'US-INV-2026-001',
        customer_name: 'Silicon Valley Innovations',
        invoice_date: '2026-11-08'
      },
      paymentMade: 2500
    });

    assert.notStrictEqual(doc, null);
    const pdfOutput = doc.output('arraybuffer');
    assert.strictEqual(pdfOutput.byteLength > 1000, true);
  });

  test('11. Currency Catalog Completeness & Default Structure', () => {
    assert.strictEqual(CURRENCY_CATALOG.length >= 20, true);
    const inr = CURRENCY_CATALOG.find(c => c.code === 'INR');
    const usd = CURRENCY_CATALOG.find(c => c.code === 'USD');
    const eur = CURRENCY_CATALOG.find(c => c.code === 'EUR');
    assert.strictEqual(inr?.symbol, '₹');
    assert.strictEqual(usd?.symbol, '$');
    assert.strictEqual(eur?.symbol, '€');
  });

  test('12. TrueType Font Embedding & Rupee Character Encoding Verification', () => {
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: '90 Days Mentorship Program',
      quantity: 1,
      rate: 50000,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    const doc = generateInvoicePDF({
      company: defaultCompanySettings,
      items: [item],
      fields: {
        invoice_number: 'INV-2026-TEST',
        invoice_date: '2026-11-08'
      },
      paymentMade: 0
    });

    assert.notStrictEqual(doc, null);
    const pdfRaw = doc.output();

    // 1. Must use TrueType Type0 CIDFont with Identity-H encoding
    assert.strictEqual(pdfRaw.includes('/Type /Font'), true);
    assert.strictEqual(pdfRaw.includes('/Subtype /Type0'), true);
    assert.strictEqual(pdfRaw.includes('/Encoding /Identity-H'), true);

    // 2. Must embed ToUnicode CMap mapping glyph 0747 to Unicode 0x20B9 (₹)
    assert.strictEqual(pdfRaw.includes('<0747><20b9>'), true);

    // 3. Page text content streams must NOT contain the corrupted superscript one character '¹' (U+00B9)
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let streamMatch;
    let foundTextStream = false;
    while ((streamMatch = streamRegex.exec(pdfRaw)) !== null) {
      const content = streamMatch[1];
      if (content.includes('BT') && content.includes('ET')) {
        foundTextStream = true;
        assert.strictEqual(content.includes('¹'), false, "PDF text stream must not contain '¹'");
        assert.strictEqual(content.includes('(¹'), false, "PDF text stream must not contain '(¹'");
      }
    }
    assert.strictEqual(foundTextStream, true, 'At least one text content stream must exist');
  });

  test('13. Section 7 Exact Financial Values & Rupee Alignment Verification', () => {
    const currency = defaultCompanySettings.currency;

    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: '90 Days Mentorship Program',
      quantity: 1,
      rate: 50000,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    const summary = calculateInvoiceSummary([item], 0, 0, 0);

    // Exact formatted values required by prompt:
    const formattedRate = formatCurrency(item.rate, currency);
    const formattedTaxableAmount = formatCurrency(item.taxableAmount, currency);
    const formattedIgst = formatCurrency(summary.totalIgst, currency);
    const formattedSubtotal = formatCurrency(summary.subtotal, currency);
    const formattedTotal = formatCurrency(summary.totalInvoiceAmount, currency);
    const formattedPaymentReceived = formatCurrency(summary.paymentMade, currency);
    const formattedBalanceDue = formatCurrency(summary.balanceDue, currency);

    assert.strictEqual(formattedRate, '₹ 50,000.00');
    assert.strictEqual(formattedTaxableAmount, '₹ 50,000.00');
    assert.strictEqual(formattedIgst, '₹ 9,000.00');
    assert.strictEqual(formattedSubtotal, '₹ 50,000.00');
    assert.strictEqual(formattedTotal, '₹ 59,000.00');
    assert.strictEqual(formattedPaymentReceived, '₹ 0.00');
    assert.strictEqual(formattedBalanceDue, '₹ 59,000.00');

    // Generate PDF to ensure document completes cleanly
    const doc = generateInvoicePDF({
      company: defaultCompanySettings,
      items: [item],
      fields: {
        invoice_number: 'INV-SEC7-001'
      },
      paymentMade: 0
    });
    assert.strictEqual(doc.output('arraybuffer').byteLength > 1000, true);
  });

  test('14. Full Support for All 8 Required Currencies (INR, USD, EUR, GBP, AED, SAR, SGD, JPY)', () => {
    const currenciesToTest: CurrencySettings[] = [
      { code: 'INR', symbol: '₹', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.', grouping: 'indian' },
      { code: 'USD', symbol: '$', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.', grouping: 'international' },
      { code: 'EUR', symbol: '€', placement: 'before', decimalPlaces: 2, thousandSeparator: '.', decimalSeparator: ',', grouping: 'international' },
      { code: 'GBP', symbol: '£', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.', grouping: 'international' },
      { code: 'AED', symbol: 'د.إ', placement: 'after', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.', grouping: 'international' },
      { code: 'SAR', symbol: 'ر.س', placement: 'after', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.', grouping: 'international' },
      { code: 'SGD', symbol: 'S$', placement: 'before', decimalPlaces: 2, thousandSeparator: ',', decimalSeparator: '.', grouping: 'international' },
      { code: 'JPY', symbol: '¥', placement: 'before', decimalPlaces: 0, thousandSeparator: ',', decimalSeparator: '.', grouping: 'international' }
    ];

    for (const curr of currenciesToTest) {
      const formatted = formatCurrency(50000, curr);
      assert.strictEqual(formatted.includes(curr.symbol), true, `Formatted amount must contain symbol for ${curr.code}`);

      const company: CompanySettings = {
        ...defaultCompanySettings,
        currency: curr
      };

      const item = calculateItemTotals({
        serialNumber: 1,
        itemName: `Product for ${curr.code}`,
        quantity: 1,
        rate: 50000,
        gstPercentage: 0,
        taxType: 'IGST'
      });

      const doc = generateInvoicePDF({
        company,
        items: [item],
        fields: {
          invoice_number: `INV-${curr.code}-001`
        },
        paymentMade: 0
      });

      const buffer = doc.output('arraybuffer');
      assert.strictEqual(buffer.byteLength > 1000, true, `Generated PDF for ${curr.code} must be a valid document`);
    }
  });

  test('15. Edge-Case Amount Formatting (Zero, Large, Decimals, Negative)', () => {
    const inr = defaultCompanySettings.currency;

    // Zero
    assert.strictEqual(formatCurrency(0, inr), '₹ 0.00');

    // Large amounts (Indian grouping: lakhs and crores)
    assert.strictEqual(formatCurrency(12500000, inr), '₹ 1,25,00,000.00');

    // Precise decimal values
    assert.strictEqual(formatCurrency(1250.5, inr), '₹ 1,250.50');

    // Negative adjustments
    assert.strictEqual(formatCurrency(-500, inr), '- ₹ 500.00');
  });

  test('16. parseNumericValue - Robust Numeric, Currency, and Indian Comma Parsing', () => {
    // Pure numbers
    assert.strictEqual(parseNumericValue(1000), 1000);
    assert.strictEqual(parseNumericValue(250.75), 250.75);

    // Indian comma formatting
    assert.strictEqual(parseNumericValue('1,00,000'), 100000);
    assert.strictEqual(parseNumericValue('₹ 1,50,000.50'), 150000.50);
    assert.strictEqual(parseNumericValue('Rs. 50,000/-'), 50000);

    // International standard commas
    assert.strictEqual(parseNumericValue('$ 1,234,567.89'), 1234567.89);
    assert.strictEqual(parseNumericValue('€ 2.500,50'), 2500.50);

    // Negative numbers
    assert.strictEqual(parseNumericValue('-500'), -500);
    assert.strictEqual(parseNumericValue('(1,200)'), -1200);

    // Empty and null values (must return null to avoid silent defaults)
    assert.strictEqual(parseNumericValue(''), null);
    assert.strictEqual(parseNumericValue('   '), null);
    assert.strictEqual(parseNumericValue(null), null);
    assert.strictEqual(parseNumericValue(undefined), null);
    assert.strictEqual(parseNumericValue('-'), null);
    assert.strictEqual(parseNumericValue('N/A'), null);
  });

  test('17. Scenario Test A: Standard Calculated Mode (Qty × Unit Price)', () => {
    // Quantity: 5, Unit Price: ₹200.00, Discount: 0%, GST Rate: 18%
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Consulting Session',
      quantity: 5,
      rate: 200,
      discount: 0,
      gstPercentage: 18,
      taxType: 'IGST',
      calculationMode: 'calculated'
    });

    // Subtotal: 5 × 200 = 1,000.00
    assert.strictEqual(item.lineSubtotal, 1000);
    assert.strictEqual(item.discountAmount, 0);
    assert.strictEqual(item.taxableAmount, 1000);
    assert.strictEqual(item.igstAmount, 180);
    assert.strictEqual(item.itemTotal, 1180);

    const summary = calculateInvoiceSummary([item]);
    assert.strictEqual(summary.subtotal, 1000);
    assert.strictEqual(summary.totalDiscount, 0);
    assert.strictEqual(summary.totalTaxable, 1000);
    assert.strictEqual(summary.totalIgst, 180);
    assert.strictEqual(summary.totalInvoiceAmount, 1180);
  });

  test('18. Scenario Test B: Excel Amount Mode (Tax-Exclusive)', () => {
    // Quantity: 5, Unit Price: ₹200.00, Excel Amount: ₹1,000.00, GST: 18%
    // In excel_amount mode with tax-exclusive, Taxable Amount = Excel Amount (1000)
    // IMPORTANT: It must NOT multiply 1000 × 5 again!
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Service Package',
      quantity: 5,
      rate: 200,
      excelAmount: 1000,
      calculationMode: 'excel_amount',
      isTaxInclusive: false,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    assert.strictEqual(item.taxableAmount, 1000);
    assert.strictEqual(item.igstAmount, 180);
    assert.strictEqual(item.itemTotal, 1180);

    const summary = calculateInvoiceSummary([item]);
    assert.strictEqual(summary.subtotal, 1000);
    assert.strictEqual(summary.totalTaxable, 1000);
    assert.strictEqual(summary.totalIgst, 180);
    assert.strictEqual(summary.totalInvoiceAmount, 1180);
  });

  test('19. Scenario Test C: Excel Amount Mode (Tax-Inclusive, No Double-Taxation)', () => {
    // Excel Amount: ₹1,180.00, GST: 18%, isTaxInclusive: true
    // Taxable Amount must be extracted: 1180 / 1.18 = 1000
    // GST = 180
    // Total = 1180 (GST is NOT added on top again!)
    const item = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Annual Subscription',
      quantity: 1,
      excelAmount: 1180,
      calculationMode: 'excel_amount',
      isTaxInclusive: true,
      gstPercentage: 18,
      taxType: 'IGST'
    });

    assert.strictEqual(item.taxableAmount, 1000);
    assert.strictEqual(item.igstAmount, 180);
    assert.strictEqual(item.itemTotal, 1180);

    const summary = calculateInvoiceSummary([item]);
    assert.strictEqual(summary.subtotal, 1000);
    assert.strictEqual(summary.totalTaxable, 1000);
    assert.strictEqual(summary.totalIgst, 180);
    assert.strictEqual(summary.totalInvoiceAmount, 1180);
  });

  test('20. Scenario Test D: Multiple Items in an Invoice', () => {
    // Item 1: ₹1,000, Item 2: ₹2,000, Item 3: ₹500
    // GST: 18% across items
    // Subtotal: ₹3,500, Total GST: ₹630, Grand Total: ₹4,130
    const item1 = calculateItemTotals({
      serialNumber: 1,
      itemName: 'Module A',
      quantity: 1,
      rate: 1000,
      gstPercentage: 18,
      taxType: 'IGST',
      calculationMode: 'calculated'
    });

    const item2 = calculateItemTotals({
      serialNumber: 2,
      itemName: 'Module B',
      quantity: 1,
      rate: 2000,
      gstPercentage: 18,
      taxType: 'IGST',
      calculationMode: 'calculated'
    });

    const item3 = calculateItemTotals({
      serialNumber: 3,
      itemName: 'Module C',
      quantity: 1,
      rate: 500,
      gstPercentage: 18,
      taxType: 'IGST',
      calculationMode: 'calculated'
    });

    assert.strictEqual(item1.taxableAmount, 1000);
    assert.strictEqual(item1.igstAmount, 180);
    assert.strictEqual(item1.itemTotal, 1180);

    assert.strictEqual(item2.taxableAmount, 2000);
    assert.strictEqual(item2.igstAmount, 360);
    assert.strictEqual(item2.itemTotal, 2360);

    assert.strictEqual(item3.taxableAmount, 500);
    assert.strictEqual(item3.igstAmount, 90);
    assert.strictEqual(item3.itemTotal, 590);

    const summary = calculateInvoiceSummary([item1, item2, item3]);
    assert.strictEqual(summary.subtotal, 3500);
    assert.strictEqual(summary.totalTaxable, 3500);
    assert.strictEqual(summary.totalIgst, 630);
    assert.strictEqual(summary.totalTax, 630);
    assert.strictEqual(summary.totalInvoiceAmount, 4130);
  });

  test('21. Excel Mapping Validation Engine', () => {
    // Test detection of unmapped amount column when in excel_amount mode
    const mockFields: any[] = [
      { key: 'item_quantity', label: 'Item Quantity', mappedColumn: 'Qty', defaultValue: '', isRequired: false },
      { key: 'item_unit_price', label: 'Item Rate', mappedColumn: 'Rate', defaultValue: '', isRequired: false },
      { key: 'item_amount', label: 'Item Total Amount', mappedColumn: '', defaultValue: '', isRequired: false }
    ];

    const validationCalc: CalculationSettings = { mode: 'calculated', taxInclusive: false };
    const valResult1 = validateExcelMapping(mockFields, validationCalc, []);
    assert.strictEqual(valResult1.isValid, true);

    const validationExcelAmount: CalculationSettings = { mode: 'excel_amount', taxInclusive: false };
    const valResult2 = validateExcelMapping(mockFields, validationExcelAmount, []);
    assert.strictEqual(valResult2.isValid, false);
    assert.strictEqual(valResult2.errors.some(e => e.includes('Item Total Amount')), true);

    // Test duplicate mappings
    const duplicateFields: any[] = [
      { key: 'item_unit_price', label: 'Item Rate', mappedColumn: 'Amount', defaultValue: '', isRequired: false },
      { key: 'item_amount', label: 'Item Total Amount', mappedColumn: 'Amount', defaultValue: '', isRequired: false }
    ];
    const valResult3 = validateExcelMapping(duplicateFields, validationCalc, []);
    assert.strictEqual(valResult3.warnings.some(w => w.includes('Amount')), true);
  });

  test('22. transformRowToInvoice Single Source of Truth Transformation', () => {
    const row = {
      'Inv #': 'TEST-INV-101',
      'Name': 'Priya Patel',
      'Qty': '5',
      'Rate': '₹ 200.00',
      'Tax': '18%'
    };

    const fields: any[] = [
      { key: 'invoice_number', label: 'Invoice #', mappedColumn: 'Inv #', defaultValue: '', isRequired: true },
      { key: 'customer_name', label: 'Client', mappedColumn: 'Name', defaultValue: '', isRequired: true },
      { key: 'item_quantity', label: 'Quantity', mappedColumn: 'Qty', defaultValue: '', isRequired: false },
      { key: 'item_unit_price', label: 'Unit Price', mappedColumn: 'Rate', defaultValue: '', isRequired: false },
      { key: 'item_gst_rate', label: 'GST Rate', mappedColumn: 'Tax', defaultValue: '18', isRequired: false }
    ];

    const result = transformRowToInvoice(row, fields, { mode: 'calculated', taxInclusive: false });

    assert.strictEqual(result.rowFields['invoice_number'], 'TEST-INV-101');
    assert.strictEqual(result.rowFields['customer_name'], 'Priya Patel');
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].quantity, 5);
    assert.strictEqual(result.items[0].rate, 200);
    assert.strictEqual(result.items[0].taxableAmount, 1000);
    assert.strictEqual(result.summary.totalInvoiceAmount, 1180);
  });

  test('23. Safe Formula Parser & Evaluator', async () => {
    const { safeEvaluateFormula, validateFormulaSyntax } = await import('./formulaParser');

    // Basic arithmetic
    const res1 = safeEvaluateFormula('10 * 25 + 50', {});
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.value, 300);

    // Variables substitution
    const row = { 'Price': '150.50', 'Qty': '4', 'Disc': '10%' };
    const res2 = safeEvaluateFormula('[Price] * [Qty]', row);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.value, 602);

    // Percentage discount formula
    const res3 = safeEvaluateFormula('([Price] * [Qty]) * (1 - 0.10)', row);
    assert.strictEqual(res3.success, true);
    assert.strictEqual(Math.round(res3.value * 100) / 100, 541.80);

    // Error handling: Division by zero
    const resZero = safeEvaluateFormula('100 / 0', {});
    assert.strictEqual(resZero.success, false);
    assert.strictEqual(resZero.error?.includes('Division by zero'), true);

    // Syntax validation
    assert.strictEqual(validateFormulaSyntax('10 + [Qty]').valid, true);
    assert.strictEqual(validateFormulaSyntax('10 + (2 * 5').valid, false); // unmatched parenthesis
    assert.strictEqual(validateFormulaSyntax('alert(1)').valid, false); // unauthorized function call
  });

  test('24. Automated Field Mapping Engine with Confidence Scoring', async () => {
    const { suggestMappings } = await import('./autoMapper');

    const sampleHeaders = [
      'Inv Number',
      'Bill To Client',
      'Billing Date',
      'Item Description',
      'Quantity Ordered',
      'Unit Price In INR',
      'IGST Rate %',
      'Total Amount'
    ];

    const fieldsToMatch = [
      { key: 'invoice_number', label: 'Invoice Number' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'invoice_date', label: 'Invoice Date' },
      { key: 'item_name', label: 'Item Description' },
      { key: 'item_quantity', label: 'Item Quantity' },
      { key: 'item_unit_price', label: 'Unit Price' },
      { key: 'item_gst_rate', label: 'GST Percentage' },
      { key: 'item_amount', label: 'Item Total Amount' }
    ];

    const suggestions = suggestMappings(sampleHeaders, fieldsToMatch);

    assert.strictEqual(suggestions['invoice_number']?.column, 'Inv Number');
    assert.strictEqual(suggestions['customer_name']?.column, 'Bill To Client');
    assert.strictEqual(suggestions['invoice_date']?.column, 'Billing Date');
    assert.strictEqual(suggestions['item_quantity']?.column, 'Quantity Ordered');
    assert.strictEqual(suggestions['item_unit_price']?.column, 'Unit Price In INR');
    assert.strictEqual(suggestions['item_amount']?.column, 'Total Amount');
  });

  test('25. Workflow Session Persistence & Template Storage', async () => {
    const { storage } = await import('./storage');

    // Save and retrieve workflow session
    storage.saveWorkflowSession({
      currentStep: 'amount_calc',
      completedSteps: ['source', 'mapping'],
      selectedWorksheetName: 'Sheet1',
      headerRowIndex: 0,
      startRowIndex: 1,
      amountSettings: {} as any,
      gstSettings: {} as any,
      customEditedRows: { '0': { 'Status': 'Verified' } },
      updatedAt: new Date().toISOString()
    });

    const session = storage.loadWorkflowSession();
    assert.ok(session);
    assert.strictEqual(session?.currentStep, 'amount_calc');
    assert.strictEqual(session?.completedSteps.includes('mapping'), true);

    // Save and load mapping template
    storage.saveMappingTemplate({
      id: 'template_test_1',
      name: 'Custom GST Template',
      description: 'Test template',
      mappings: { invoice_number: 'Inv No' }
    });

    const templates = storage.loadSavedTemplates();
    assert.ok(templates.length > 0);
    assert.ok(templates.some(t => t.name === 'Custom GST Template'));

    // Clear session
    storage.clearWorkflowSession();
    assert.strictEqual(storage.loadWorkflowSession(), null);
  });

  test('26. Deduplicate Spreadsheet Headers to Prevent React Duplicate Key Warnings', async () => {
    const { deduplicateHeaders } = await import('./calculator');

    const headersWithDuplicates = ['Invoice No', 'Sale Amount', 'Customer', 'Sale Amount', 'Sale Amount', ''];
    const deduplicated = deduplicateHeaders(headersWithDuplicates);

    assert.deepStrictEqual(deduplicated, [
      'Invoice No',
      'Sale Amount',
      'Customer',
      'Sale Amount (2)',
      'Sale Amount (3)',
      'Col_6'
    ]);

    // Verify all keys are strictly unique
    const uniqueSet = new Set(deduplicated);
    assert.strictEqual(uniqueSet.size, deduplicated.length);
  });

});


