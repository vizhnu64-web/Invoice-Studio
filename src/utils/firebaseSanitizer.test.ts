import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUEPRINT_LIMITS,
  buildCustomerCreatePayload,
  buildEmailLogCreatePayload,
  buildInvoiceCreatePayload,
  buildQuotationConvertUpdatePayload,
  buildQuotationCreatePayload,
  buildUserPrivateAccountCreatePayload,
  buildUserProfileCreatePayload,
  buildWorkspaceSettingsCreatePayload,
  sanitizeDocumentId,
  stripUndefinedDeep,
} from './firebaseSanitizer';
import { storage } from './storage';
import { createQuotationRecord } from './quotation';

const FAKE_SERVER_TS = { _type: 'serverTimestamp' };

test('sanitizeDocumentId enforces blueprint ID regex and 128-char cap', () => {
  const dirty = 'inv 001/../../bad!!' + 'x'.repeat(200);
  const safe = sanitizeDocumentId(dirty, 'inv');
  assert.ok(safe.length >= 1 && safe.length <= BLUEPRINT_LIMITS.ID_MAX);
  assert.match(safe, BLUEPRINT_LIMITS.ID_PATTERN);

  const empty = sanitizeDocumentId('', 'qt');
  assert.match(empty, /^qt_/);
  assert.match(empty, BLUEPRINT_LIMITS.ID_PATTERN);
});

test('stripUndefinedDeep removes undefined keys and strips oversized base64 blobs', () => {
  const hugeDataUrl = 'data:image/png;base64,' + 'A'.repeat(BLUEPRINT_LIMITS.MAX_INLINE_ASSET_CHARS + 50);
  const cleaned = stripUndefinedDeep({
    keep: 'ok',
    dropMe: undefined,
    nested: { a: 1, b: undefined, logo: hugeDataUrl, smallLogo: 'data:image/png;base64,abc' },
    arr: [1, undefined, { x: undefined, y: 'z' }],
  }) as any;

  assert.equal('dropMe' in cleaned, false);
  assert.equal('b' in cleaned.nested, false);
  assert.equal(cleaned.nested.logo, '');
  assert.equal(cleaned.nested.smallLogo, 'data:image/png;base64,abc');
  assert.deepEqual(cleaned.arr, [1, { y: 'z' }]);
});

test('user profile & private account builders enforce strict allowlisted keys and bounds', () => {
  const profile = buildUserProfileCreatePayload(
    'uid_123',
    'A'.repeat(300),
    'https://example.com/' + 'p'.repeat(600),
    true,
    FAKE_SERVER_TS
  );
  assert.deepEqual(
    Object.keys(profile).sort(),
    ['createdAt', 'displayName', 'onboardingCompleted', 'photoURL', 'updatedAt', 'userId']
  );
  assert.equal((profile.displayName as string).length, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX);
  assert.equal((profile.photoURL as string).length, BLUEPRINT_LIMITS.PHOTO_URL_MAX);

  const priv = buildUserPrivateAccountCreatePayload('uid_123', 'user@example.com', FAKE_SERVER_TS);
  assert.deepEqual(Object.keys(priv).sort(), ['createdAt', 'email', 'updatedAt', 'userId']);
  assert.equal(priv.email, 'user@example.com');
});

test('workspace settings payload caps fields array to blueprint max (150)', () => {
  const company = storage.loadCompanySettings();
  const template = storage.loadTemplate();
  const calc = storage.loadCalculationSettings();
  const baseFields = storage.loadFields(company);
  const oversizedFields = Array.from({ length: 180 }, (_, idx) => ({
    ...baseFields[0],
    id: `field_${idx}`,
  }));

  const payload = buildWorkspaceSettingsCreatePayload(
    'uid_123',
    company,
    template,
    calc,
    oversizedFields,
    FAKE_SERVER_TS
  );
  assert.equal((payload.fields as unknown[]).length, BLUEPRINT_LIMITS.FIELDS_ARRAY_MAX);
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['calculationSettings', 'companySettings', 'createdAt', 'fields', 'template', 'updatedAt', 'userId']
  );
});

test('quotation create payload forbids convertedInvoiceId and caps approvalHistory to 100', () => {
  const company = storage.loadCompanySettings();
  const qt = createQuotationRecord({
    data: {
      quotationNumber: 'QT-2026-01',
      autoNumbering: false,
      quotationDate: '2026-11-18',
      validUntilDate: '2026-12-18',
      referenceNumber: 'REF-1',
      subject: 'Proposal',
      projectName: 'Cloud Upgrade',
      salesperson: 'Alex',
      currencyCode: 'INR',
      customerName: 'Acme Corp ' + 'Z'.repeat(250),
      contactPerson: 'Jane',
      customerEmail: 'jane@acme.test',
      customerPhone: '1234567890',
      billingAddress: '123 Main St',
      customerCity: 'Bengaluru',
      customerState: 'Karnataka',
      customerPostalCode: '560001',
      customerCountry: 'India',
      customerGstin: '',
      items: [
        {
          id: 'item_1',
          itemName: 'Consulting',
          itemDescription: 'Architecture review',
          hsnSac: '9983',
          quantity: 1,
          unit: 'Hrs',
          rate: 5000,
          discount: 0,
          discountType: 'fixed',
          gstPercentage: 18,
        },
      ],
      gstEnabled: true,
      pricingType: 'exclusive',
      transactionType: 'CGST_SGST',
      defaultGstRate: 18,
      additionalDiscount: 0,
      additionalDiscountType: 'fixed',
      additionalCharges: 0,
      roundOffEnabled: true,
      notes: '',
      terms: '',
      paymentTerms: '',
      deliveryTerms: '',
      validityConditions: '',
      customFooterText: '',
      includeBankDetails: true,
    },
    company,
    actorName: 'Tester',
  });

  qt.approvalHistory = Array.from({ length: 120 }, (_, i) => ({
    id: `h_${i}`,
    status: 'Draft',
    timestamp: new Date().toISOString(),
    actorName: 'Tester',
  }));

  const createPayload = buildQuotationCreatePayload('uid_123', qt, FAKE_SERVER_TS);
  assert.equal((createPayload.customerName as string).length, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX);
  assert.equal((createPayload.approvalHistory as unknown[]).length, BLUEPRINT_LIMITS.APPROVAL_HISTORY_MAX);
  assert.equal('convertedInvoiceId' in createPayload, false);
  assert.equal('convertedInvoiceNumber' in createPayload, false);
  assert.equal('convertedAt' in createPayload, false);

  const convertPayload = buildQuotationConvertUpdatePayload(
    qt,
    'inv_999',
    'INV-2026-099',
    FAKE_SERVER_TS
  );
  assert.deepEqual(
    Object.keys(convertPayload).sort(),
    ['approvalHistory', 'convertedAt', 'convertedInvoiceId', 'convertedInvoiceNumber', 'status', 'updatedAt']
  );
  assert.equal(convertPayload.status, 'Converted to Invoice');
});

test('customer, invoice, and emailLog builders emit only allowlisted keys within blueprint limits', () => {
  const cust = buildCustomerCreatePayload(
    'uid_1',
    {
      id: 'cust 1',
      customerName: 'B'.repeat(250),
      billingAddress: 'Addr',
      email: 'billing@acme.test',
      updatedAt: '2026-11-18T00:00:00.000Z',
    },
    FAKE_SERVER_TS
  );
  assert.match(cust.id as string, BLUEPRINT_LIMITS.ID_PATTERN);
  assert.equal((cust.customerName as string).length, BLUEPRINT_LIMITS.CUSTOMER_NAME_MAX);

  const inv = buildInvoiceCreatePayload(
    'uid_1',
    {
      id: 'inv_1',
      invoiceNumber: 'INV-101',
      customerName: 'Acme Corp',
      sourceType: 'manual',
      sourceName: 'Manual Entry',
      worksheetName: 'Manual',
      generatedDate: '2026-11-18T00:00:00.000Z',
      totalAmount: 1180,
      gstAmount: 180,
      templateId: 'tpl_1',
      profileId: 'prof_1',
      revisionNumber: 1,
      status: 'success',
      dataSnapshot: { foo: 'bar', undefField: undefined },
    },
    FAKE_SERVER_TS
  );
  assert.equal('undefField' in (inv.dataSnapshot as Record<string, unknown>), false);

  const log = buildEmailLogCreatePayload(
    'uid_1',
    {
      id: 'log_1',
      documentType: 'invoice',
      documentId: 'inv_1',
      documentNumber: 'INV-101',
      recipientEmail: 'client@acme.test',
      deliveryMethod: 'gmail',
      senderEmail: 'sender@acme.test',
      subject: 'Invoice ' + 'S'.repeat(400),
      status: 'sent',
      createdAt: '2026-11-18T00:00:00.000Z',
    },
    FAKE_SERVER_TS
  );
  assert.equal((log.subject as string).length, BLUEPRINT_LIMITS.SUBJECT_MAX);
  assert.equal('updatedAt' in log, false);
});
