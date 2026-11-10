/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsPDFPkg, { type jsPDF } from 'jspdf';
const jsPDFConstructor = (jsPDFPkg as any).jsPDF || jsPDFPkg;
import autoTable from 'jspdf-autotable';
import { CompanySettings, InvoiceItem, InvoiceTemplate } from '../types';
import { calculateInvoiceSummary, formatCurrency } from './calculator';
import { registerUnicodeFonts, resolveUnicodeFont } from './pdfFonts';

interface GeneratePDFOptions {
  company: CompanySettings;
  items: InvoiceItem[];
  fields?: Record<string, any>;
  template?: InvoiceTemplate;
  paymentMade?: number;
  discount?: number;
  additionalCharges?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  if (!hex) return [79, 70, 229];
  let c = hex.replace('#', '').trim();
  if (c.length === 3) {
    c = c.split('').map(char => char + char).join('');
  }
  if (c.length !== 6) return [79, 70, 229];
  const num = parseInt(c, 16);
  if (isNaN(num)) return [79, 70, 229];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function generateInvoicePDF(options: GeneratePDFOptions): jsPDF {
  const { company, items, fields = {}, paymentMade = 0, discount = 0, additionalCharges = 0, template } = options;
  
  const orientation = template?.orientation || 'portrait';
  const doc = new jsPDFConstructor({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm portrait
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  let currentY = 14;

  // 1. Register TrueType Unicode fonts (NotoSans for ₹ U+20B9, DejaVuSans for Arabic)
  registerUnicodeFonts(doc);

  // 2. Determine font family with complete Unicode currency symbol support
  const currencySym = company.currency?.symbol ?? '₹';
  const validFont = resolveUnicodeFont(currencySym, company.typography?.bodyFont);
  doc.setFont(validFont, 'normal');

  // Dynamic Brand Palette colors from company settings
  const primaryBrandColor = company.brandPalette?.primaryColor || '#4f46e5';
  const headingHex = company.brandPalette?.headingColor || '#1e293b';
  const bodyTextHex = company.brandPalette?.bodyTextColor || '#334155';
  const tableHeaderBgHex = company.brandPalette?.tableHeaderBg || primaryBrandColor;
  const tableHeaderTextHex = company.brandPalette?.tableHeaderText || '#ffffff';
  const totalHighlightHex = company.brandPalette?.totalHighlightColor || primaryBrandColor;
  const footerBgHex = company.brandPalette?.footerBg || '#f1f5f9';

  const primaryRgb = hexToRgb(headingHex);
  const accentRgb = hexToRgb(primaryBrandColor);
  const tableHeaderBgRgb = hexToRgb(tableHeaderBgHex);
  const tableHeaderTextRgb = hexToRgb(tableHeaderTextHex);
  const bodyTextRgb = hexToRgb(bodyTextHex);
  const totalHighlightRgb = hexToRgb(totalHighlightHex);
  const grayRgb: [number, number, number] = [100, 116, 139]; // Slate 500
  const lightBgRgb: [number, number, number] = [248, 250, 252]; // Slate 50

  // 0. Optional Watermark
  if (company.assets?.showWatermark && company.assets?.watermarkText) {
    try {
      doc.saveGraphicsState();
      doc.setFont(validFont, 'bold');
      doc.setFontSize(48);
      doc.setTextColor(220, 220, 230);
      // Center of page, rotated
      doc.text(company.assets.watermarkText, pageWidth / 2, pageHeight / 2, {
        align: 'center',
        angle: 45
      });
      doc.restoreGraphicsState();
    } catch {
      // Fallback if graphics state is not supported
    }
  }

  // --- 1. Company Header & Invoice Title (Two-Column Balanced Layout) ---
  const showHeader = template?.showSections?.companyHeader !== false;
  if (showHeader) {
    const startHeaderY = currentY;
    const leftColWidth = contentWidth * 0.58;
    const rightColWidth = contentWidth * 0.38;
    const leftColX = margin;
    const rightColX = pageWidth - margin - rightColWidth;

    let leftY = startHeaderY;
    let rightY = startHeaderY;

    // Left Column: Logo & Company Details
    if (company.assets?.logoUrl && company.assets.logoUrl.startsWith('data:image')) {
      try {
        const logoW = Math.min(company.assets.logoWidth || 32, 40);
        // Omitting height parameter preserves natural aspect ratio without stretching
        const imgInfo = doc.addImage(company.assets.logoUrl, 'PNG', leftColX, leftY, logoW);
        const actualH = imgInfo && typeof imgInfo === 'object' && 'h' in imgInfo ? (imgInfo as any).h : (logoW * 0.4);
        leftY += actualH + 6;
      } catch (err) {
        console.warn('Could not render logo in PDF:', err);
      }
    }

    // Company Legal Name
    doc.setFont(validFont, 'bold');
    doc.setFontSize(15);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    const legalCompanyName = company.legalName || fields['company_legal_name'] || 'Company Legal Name';
    const nameLines = doc.splitTextToSize(legalCompanyName, leftColWidth);
    doc.text(nameLines, leftColX, leftY);
    leftY += nameLines.length * 6 + 1;

    // Company Address
    doc.setFont(validFont, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(bodyTextRgb[0], bodyTextRgb[1], bodyTextRgb[2]);
    const fullCompanyAddr = company.addressLine1
      ? `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`
      : (fields['company_address'] || '');
    if (fullCompanyAddr) {
      const addrLines = doc.splitTextToSize(fullCompanyAddr, leftColWidth);
      doc.text(addrLines, leftColX, leftY);
      leftY += addrLines.length * 4 + 2;
    }

    // Tax IDs & Contact Details
    const taxDetails = [
      company.gstin ? `GSTIN: ${company.gstin}` : '',
      company.pan ? `PAN: ${company.pan}` : '',
      company.cin ? `CIN: ${company.cin}` : ''
    ].filter(Boolean).join(' | ');

    if (taxDetails) {
      doc.setFont(validFont, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.text(taxDetails, leftColX, leftY);
      leftY += 4.5;
    }

    const contactDetails = [
      company.email ? `Email: ${company.email}` : '',
      company.phone ? `Phone: ${company.phone}` : '',
      company.website ? `Web: ${company.website}` : ''
    ].filter(Boolean).join(' | ');

    if (contactDetails) {
      doc.setFont(validFont, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
      const contactLines = doc.splitTextToSize(contactDetails, leftColWidth);
      doc.text(contactLines, leftColX, leftY);
      leftY += contactLines.length * 4;
    }

    // Right Column: TAX INVOICE & Metadata
    doc.setFont(validFont, 'bold');
    doc.setFontSize(18);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    const invTitle = template?.labels?.['invoice_title'] || fields['invoice_title'] || company.content?.invoiceTitle || 'TAX INVOICE';
    doc.text(invTitle, pageWidth - margin, rightY, { align: 'right' });
    rightY += 8;

    const invoiceNum = fields['invoice_number'] || 'INV-001';
    const invoiceDate = fields['invoice_date'] || '2026-11-01';
    const dueDate = fields['due_date'] || '';
    const placeOfSupply = fields['place_of_supply'] || `${company.state} (06)`;

    doc.setFont(validFont, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.text(`Invoice No: ${invoiceNum}`, pageWidth - margin, rightY, { align: 'right' });
    rightY += 5;

    doc.setFont(validFont, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(bodyTextRgb[0], bodyTextRgb[1], bodyTextRgb[2]);
    doc.text(`Date: ${invoiceDate}`, pageWidth - margin, rightY, { align: 'right' });
    rightY += 4.5;

    if (dueDate) {
      doc.text(`Due Date: ${dueDate}`, pageWidth - margin, rightY, { align: 'right' });
      rightY += 4.5;
    }

    if (placeOfSupply) {
      doc.text(`Place of Supply: ${placeOfSupply}`, pageWidth - margin, rightY, { align: 'right' });
      rightY += 4.5;
    }

    // Dynamic height calculation: advance currentY to max of left or right column height + padding
    const headerHeight = Math.max(leftY - startHeaderY, rightY - startHeaderY);
    currentY = startHeaderY + headerHeight + 4;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 6;
  }

  // --- 2. Bill To Section ---
  const showBillTo = template?.showSections?.billTo !== false;
  if (showBillTo) {
    doc.setFont(validFont, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    const billToLabel = template?.labels?.['bill_to'] || 'Billed To (Customer Details):';
    doc.text(billToLabel, margin, currentY);

    currentY += 4.5;
    doc.setFont(validFont, 'bold');
    doc.setFontSize(10.5);
    doc.text(fields['customer_name'] || 'Customer Name', margin, currentY);

    currentY += 4.5;
    doc.setFont(validFont, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
    if (fields['customer_business']) {
      doc.text(fields['customer_business'], margin, currentY);
      currentY += 4;
    }
    doc.text(fields['customer_address'] || 'Customer Address Here', margin, currentY, { maxWidth: contentWidth * 0.7 });

    currentY += 4;
    if (fields['customer_gstin']) {
      doc.text(`Customer GSTIN: ${fields['customer_gstin']}`, margin, currentY);
      currentY += 4;
    }
    currentY += 3;
  }

  // --- 3. Subject Section ---
  const showSubject = template?.showSections?.subject !== false;
  if (showSubject && fields['subject_description']) {
    doc.setFillColor(lightBgRgb[0], lightBgRgb[1], lightBgRgb[2]);
    doc.roundedRect(margin, currentY, contentWidth, 9, 1, 1, 'F');
    doc.setFont(validFont, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.text('Subject:', margin + 3, currentY + 5.5);
    doc.setFont(validFont, 'normal');
    doc.text(fields['subject_description'], margin + 20, currentY + 5.5);
    currentY += 12;
  }

  // --- 4. Items Table ---
  const showItemTable = template?.showSections?.itemTable !== false;
  if (showItemTable && items.length > 0) {
    const tableRows = items.map((item, idx) => {
      // Fix duplication: only append description if different from name
      const descText = item.itemDescription && item.itemDescription !== item.itemName
        ? `${item.itemName}\n${item.itemDescription}`
        : item.itemName;
      return [
        idx + 1,
        descText,
        item.hsnSac || '9983',
        `${item.quantity} ${item.unit || 'Nos'}`,
        formatCurrency(item.rate, company.currency),
        formatCurrency(item.taxableAmount, company.currency),
        `${item.gstPercentage}%`,
        formatCurrency(item.itemTotal, company.currency)
      ];
    });

    autoTable(doc, {
      startY: currentY,
      head: [['#', 'Item & Description', 'HSN/SAC', 'Qty', 'Rate', 'Taxable Amt', 'GST', 'Total']],
      body: tableRows,
      theme: 'grid',
      styles: {
        font: validFont,
        fontStyle: 'normal'
      },
      headStyles: {
        fillColor: tableHeaderBgRgb,
        textColor: tableHeaderTextRgb,
        font: validFont,
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        cellPadding: 2.5
      },
      bodyStyles: {
        font: validFont,
        fontSize: 8,
        textColor: bodyTextRgb,
        cellPadding: 3
      },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 58 },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 28, halign: 'right' },
        6: { cellWidth: 14, halign: 'center' },
        7: { cellWidth: 22, halign: 'right' }
      },
      margin: { left: margin, right: margin }
    });

    currentY = (doc as any).lastAutoTable.finalY + 6;
  }

  // --- 5. Invoice Summary & Tax Breakdown ---
  const summary = calculateInvoiceSummary(items, discount, additionalCharges, paymentMade, company.currency);
  const showSummary = template?.showSections?.taxSummary !== false;

  const summaryWidth = 80;
  const summaryX = pageWidth - margin - summaryWidth;

  if (showSummary) {
    doc.setFontSize(8);
    doc.setFont(validFont, 'normal');

    let summaryY = currentY;
    const addSummaryRow = (label: string, val: string, isBold = false, isHighlight = false) => {
      doc.setFont(validFont, isBold ? 'bold' : 'normal');
      if (isHighlight) {
        doc.setTextColor(totalHighlightRgb[0], totalHighlightRgb[1], totalHighlightRgb[2]);
      } else {
        doc.setTextColor(isBold ? primaryRgb[0] : grayRgb[0], isBold ? primaryRgb[1] : grayRgb[1], isBold ? primaryRgb[2] : grayRgb[2]);
      }
      doc.text(label, summaryX, summaryY);
      doc.text(val, pageWidth - margin, summaryY, { align: 'right' });
      summaryY += 5;
    };

    const subtotalLabel = template?.labels?.['subtotal'] || 'Subtotal:';
    addSummaryRow(subtotalLabel, formatCurrency(summary.subtotal, company.currency));
    if (summary.totalIgst > 0) {
      addSummaryRow('IGST Total:', formatCurrency(summary.totalIgst, company.currency));
    }
    if (summary.totalCgst > 0) {
      addSummaryRow('CGST Total:', formatCurrency(summary.totalCgst, company.currency));
      addSummaryRow('SGST Total:', formatCurrency(summary.totalSgst, company.currency));
    }
    if (discount > 0) {
      addSummaryRow('Discount:', `- ${formatCurrency(discount, company.currency)}`);
    }
    if (additionalCharges > 0) {
      addSummaryRow('Additional Charges:', formatCurrency(additionalCharges, company.currency));
    }
    if (summary.roundOff !== 0) {
      addSummaryRow('Round Off:', formatCurrency(summary.roundOff, company.currency));
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(summaryX, summaryY - 2, pageWidth - margin, summaryY - 2);
    summaryY += 1;

    addSummaryRow('Total Invoice Amount:', formatCurrency(summary.totalInvoiceAmount, company.currency), true, true);
    addSummaryRow('Payment Received:', formatCurrency(paymentMade, company.currency));
    addSummaryRow('Balance Due:', formatCurrency(summary.balanceDue, company.currency), true);

    // Left side: Amount in words & Bank Details
    let leftY = currentY;
    const leftWidth = contentWidth - summaryWidth - 8;

    if (template?.showSections?.amountInWords !== false) {
      doc.setFont(validFont, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.text('Amount in Words:', margin, leftY);
      leftY += 4;
      doc.setFont(validFont, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
      doc.text(summary.amountInWords, margin, leftY, { maxWidth: leftWidth });
      leftY += 8;
    }

    // Bank Details
    const showBank = template?.showSections?.bankDetails !== false;
    if (showBank) {
      const activeBank = company.bankAccounts.find(b => b.id === company.activeBankId) || company.bankAccounts.find(b => b.isDefault) || company.bankAccounts[0];
      if (activeBank) {
        doc.setFont(validFont, 'bold');
        doc.setFontSize(8);
        doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
        doc.text('Bank Details:', margin, leftY);
        leftY += 4;
        doc.setFont(validFont, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
        doc.text(`Bank: ${activeBank.bankName}${activeBank.branch ? ' (' + activeBank.branch + ')' : ''}`, margin, leftY);
        leftY += 4;
        doc.text(`Account Name: ${activeBank.accountHolderName}`, margin, leftY);
        leftY += 4;
        doc.text(`A/c No: ${activeBank.accountNumber} | IFSC: ${activeBank.ifscCode}`, margin, leftY);
        leftY += 4;
        if (activeBank.upiId) {
          doc.text(`UPI ID: ${activeBank.upiId}`, margin, leftY);
          leftY += 4;
        }
        if (company.content?.paymentInstructions) {
          doc.text(company.content.paymentInstructions, margin, leftY, { maxWidth: leftWidth });
          leftY += 4;
        }
        leftY += 4;
      }
    }

    // Notes
    const showNotes = template?.showSections?.notes !== false;
    const notesContent = fields['notes_content'] || company.content?.defaultNotes;
    if (showNotes && notesContent) {
      doc.setFont(validFont, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.text('Notes:', margin, leftY);
      leftY += 4;
      doc.setFont(validFont, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
      doc.text(notesContent, margin, leftY, { maxWidth: leftWidth });
      leftY += 6;
    }

    currentY = Math.max(summaryY + 6, leftY + 6);
  }

  // Check if signature & terms fit on current page
  if (currentY > pageHeight - 50) {
    doc.addPage();
    currentY = 20;
  }

  // Terms & Conditions
  const showTerms = template?.showSections?.terms !== false;
  if (showTerms) {
    doc.setFont(validFont, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.text('Terms & Conditions:', margin, currentY);
    currentY += 4;
    doc.setFont(validFont, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
    const termsText = fields['terms_content'] || company.content?.defaultTerms || '1. Goods once sold will not be taken back.\n2. Interest @ 18% p.a. will apply on delayed payments.\n3. Subject to jurisdiction.';
    doc.text(termsText, margin, currentY, { maxWidth: 110 });
  }

  // Authorized Signature
  const showSig = template?.showSections?.signature !== false;
  if (showSig) {
    doc.setFont(validFont, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    const sigHeading = company.signatureHeading || `For ${company.legalName}`;
    doc.text(sigHeading, pageWidth - margin, currentY, { align: 'right' });
    
    // If signature image uploaded
    let sigDrawn = false;
    if (company.assets?.signatureUrl && company.assets.signatureUrl.startsWith('data:image')) {
      try {
        const sigW = Math.min(company.assets.signatureWidth || 35, 45);
        const sigH = Math.min(company.assets.signatureHeight || 15, 20);
        doc.addImage(company.assets.signatureUrl, 'PNG', pageWidth - margin - sigW, currentY + 2, sigW, sigH);
        currentY += sigH + 4;
        sigDrawn = true;
      } catch (err) {
        console.warn('Could not draw signature image in PDF:', err);
      }
    }
    
    if (!sigDrawn) {
      currentY += 14;
    }

    doc.setFont(validFont, 'normal');
    doc.setFontSize(8);
    doc.text(company.authorizedPerson || 'Authorized Signatory', pageWidth - margin, currentY, { align: 'right' });
    currentY += 4;
    doc.setFontSize(7);
    doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
    doc.text(`(${company.designation || 'Director'})`, pageWidth - margin, currentY, { align: 'right' });
  }

  // Footer on all pages
  const showFooter = template?.showSections?.footer !== false;
  if (showFooter) {
    const totalPages = (doc.internal as any).getNumberOfPages ? (doc.internal as any).getNumberOfPages() : 1;
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);
      doc.setFontSize(7);
      doc.setTextColor(grayRgb[0], grayRgb[1], grayRgb[2]);
      const footerMsg = company.content?.footerMessage || 'This is a computer generated invoice powered by Invoice Studio.';
      doc.text(footerMsg, margin, pageHeight - 6);
      doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    }
  }

  return doc;
}
