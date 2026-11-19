/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCompanySettings, defaultFieldCatalog } from '../mockData';
import { storage } from './storage';
import { generateInvoicePDF } from './pdfGenerator';
import {
  applyQuotationStatusTransition,
  buildQuotationSnapshot,
  computeQuotation,
  computeQuotationStats,
  convertApprovedQuotationToInvoice,
  createDefaultQuotationData,
  createQuotationRecord,
  generateNextQuotationNumber,
  getEffectiveQuotationStatus,
  validateQuotationData,
} from './quotation';

const defaultTemplate = storage.loadTemplate();

describe('Quotation Generator Engine, Approval Workflow & PDF Suite', () => {
  test('1. Sequential quotation numbering & default creation', () => {
    const first = generateNextQuotationNumber([]);
    assert.match(first, /^QT-\d{4}-001$/);

    const data = createDefaultQuotationData(defaultCompanySettings, []);
    data.customerName = 'Acme Industries Pvt Ltd';
    data.customerEmail = 'procurement@acme.example';
    data.items[0].itemName = 'Annual SaaS Platform License';
    data.items[0].quantity = 2;
    data.items[0].rate = 25000;
    data.items[0].gstPercentage = 18;

    const record = createQuotationRecord({
      data,
      company: defaultCompanySettings,
      status: 'Draft',
      actorName: 'Sales Lead',
    });

    const second = generateNextQuotationNumber([record]);
    assert.match(second, /^QT-\d{4}-002$/);
    assert.strictEqual(record.subtotal, 50000);
    assert.strictEqual(record.totalTax, 9000);
    assert.strictEqual(record.totalAmount, 59000);
    assert.strictEqual(record.status, 'Draft');
    assert.strictEqual(record.approvalHistory.length, 1);
  });

  test('2. Quotation validation catches missing customer, bad email, bad dates, and empty items', () => {
    const data = createDefaultQuotationData(defaultCompanySettings, []);
    data.quotationNumber = '';
    data.customerName = '';
    data.customerEmail = 'invalid-email';
    data.quotationDate = '2026-06-15';
    data.validUntilDate = '2026-06-01';
    data.items[0].itemName = '';
    data.items[0].quantity = 0;

    const val = validateQuotationData(data, []);
    assert.strictEqual(val.isValid, false);
    assert.ok(val.errors.quotationNumber);
    assert.ok(val.errors.customerName);
    assert.ok(val.errors.customerEmail);
    assert.ok(val.errors.validUntilDate);
    assert.ok(val.errors.item_0_name);
    assert.ok(val.errors.item_0_qty);
  });

  test('3. Exclusive GST calculation parity & additional discount/charges', () => {
    const data = createDefaultQuotationData(defaultCompanySettings, []);
    data.customerName = 'Zenith Corp';
    data.pricingType = 'exclusive';
    data.items[0].itemName = 'Consulting';
    data.items[0].quantity = 1;
    data.items[0].rate = 10000;
    data.items[0].gstPercentage = 18;
    data.additionalDiscount = 10;
    data.additionalDiscountType = 'percentage';
    data.additionalCharges = 500;

    const computed = computeQuotation(data, defaultCompanySettings);
    assert.strictEqual(computed.summary.subtotal, 10000);
    assert.strictEqual(computed.additionalDiscountAmt, 1000);
    assert.strictEqual(computed.summary.totalTax, 1800);
    assert.strictEqual(computed.summary.totalInvoiceAmount, 11300);
  });

  test('4. Strict Approval Workflow: Draft -> Pending -> Approved -> Convert to Invoice (blocks unapproved & duplicate)', () => {
    const data = createDefaultQuotationData(defaultCompanySettings, []);
    data.customerName = 'Horizon Logistics';
    data.customerEmail = 'ap@horizon.example';
    data.validUntilDate = '2099-12-31';
    data.items[0].itemName = 'Warehouse Automation Suite';
    data.items[0].quantity = 1;
    data.items[0].rate = 40000;
    data.items[0].gstPercentage = 18;

    const draft = createQuotationRecord({
      data,
      company: defaultCompanySettings,
      status: 'Draft',
      actorName: 'Creator',
    });

    // Block Draft conversion
    assert.throws(
      () =>
        convertApprovedQuotationToInvoice({
          quotation: draft,
          company: defaultCompanySettings,
          template: defaultTemplate,
          fields: defaultFieldCatalog,
          existingInvoices: [],
        }),
      /Only Approved quotations/
    );

    // Submit for Pending Approval -> still blocked
    const pending = applyQuotationStatusTransition({
      quotation: draft,
      nextStatus: 'Pending Approval',
      actorName: 'Creator',
      notes: 'Sent to client',
    });
    assert.strictEqual(pending.status, 'Pending Approval');
    assert.throws(() =>
      convertApprovedQuotationToInvoice({
        quotation: pending,
        company: defaultCompanySettings,
        template: defaultTemplate,
        fields: defaultFieldCatalog,
        existingInvoices: [],
      })
    );

    // Reject -> blocks conversion
    const rejected = applyQuotationStatusTransition({
      quotation: pending,
      nextStatus: 'Not Approved',
      actorName: 'Client',
      rejectionReason: 'Budget deferred',
    });
    assert.strictEqual(rejected.status, 'Not Approved');
    assert.strictEqual(rejected.rejectionReason, 'Budget deferred');
    assert.throws(() =>
      convertApprovedQuotationToInvoice({
        quotation: rejected,
        company: defaultCompanySettings,
        template: defaultTemplate,
        fields: defaultFieldCatalog,
        existingInvoices: [],
      })
    );

    // Approve -> Convert to Invoice succeeds cleanly
    const approved = applyQuotationStatusTransition({
      quotation: pending,
      nextStatus: 'Approved',
      actorName: 'VP Finance',
      notes: 'PO #88412 issued',
    });
    assert.strictEqual(approved.status, 'Approved');
    assert.ok(approved.approvedAt);
    assert.strictEqual(approved.approvalHistory.length, 3);

    const { updatedQuotation, createdInvoice, manualInvoiceData } =
      convertApprovedQuotationToInvoice({
        quotation: approved,
        company: defaultCompanySettings,
        template: defaultTemplate,
        fields: defaultFieldCatalog,
        existingInvoices: [],
        actorName: 'VP Finance',
      });

    assert.strictEqual(updatedQuotation.status, 'Converted to Invoice');
    assert.strictEqual(updatedQuotation.convertedInvoiceId, createdInvoice.id);
    assert.strictEqual(updatedQuotation.convertedInvoiceNumber, createdInvoice.invoiceNumber);
    assert.strictEqual(createdInvoice.sourceQuotationId, approved.id);
    assert.strictEqual(createdInvoice.sourceQuotationNumber, approved.quotationNumber);
    assert.strictEqual(createdInvoice.paymentStatus, 'Unpaid');
    assert.strictEqual(createdInvoice.totalAmount, approved.totalAmount);
    assert.strictEqual(manualInvoiceData.paymentStatus, 'Unpaid');
    assert.strictEqual(manualInvoiceData.sourceQuotationId, approved.id);

    // Block duplicate conversion
    assert.throws(
      () =>
        convertApprovedQuotationToInvoice({
          quotation: updatedQuotation,
          company: defaultCompanySettings,
          template: defaultTemplate,
          fields: defaultFieldCatalog,
          existingInvoices: [createdInvoice],
        }),
      /already been converted/
    );

    // Stats check
    const stats = computeQuotationStats([draft, pending, approved, rejected, updatedQuotation]);
    assert.strictEqual(stats.total, 5);
    assert.strictEqual(stats.pendingApproval, 1);
    assert.strictEqual(stats.approved, 1);
    assert.strictEqual(stats.notApproved, 1);
    assert.strictEqual(stats.converted, 1);
  });

  test('5. Automatic expiry detection & Quotation PDF generation', () => {
    const data = createDefaultQuotationData(defaultCompanySettings, []);
    data.customerName = 'Expired Test Co';
    data.validUntilDate = '2020-01-01';
    data.items[0].itemName = 'Legacy Support';
    data.items[0].quantity = 1;
    data.items[0].rate = 5000;

    const rec = createQuotationRecord({
      data,
      company: defaultCompanySettings,
      status: 'Pending Approval',
    });
    assert.strictEqual(getEffectiveQuotationStatus(rec), 'Expired');

    // Generate Quotation PDF using centralized pdfGenerator
    const snapshot = buildQuotationSnapshot(rec.data, defaultCompanySettings, defaultTemplate);
    const pdf = generateInvoicePDF({
      company: snapshot.companyWithCurrency,
      items: snapshot.items,
      fields: snapshot.rowFields,
      template: snapshot.quotationTemplate || defaultTemplate,
      paymentMade: 0,
      discount: snapshot.additionalDiscountAmt,
      additionalCharges: snapshot.additionalCharges,
    });
    const dataUri = pdf.output('datauristring');
    assert.ok(dataUri.startsWith('data:application/pdf'));
    assert.ok(dataUri.length > 500);
  });
});
