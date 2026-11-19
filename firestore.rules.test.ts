import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const rulesSource = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

test('firestore.rules uses rules_version 2 and opens with a global default-deny catch-all', () => {
  assert.match(rulesSource, /rules_version\s*=\s*'2';/);
  const firstMatchIdx = rulesSource.indexOf('match /{document=**}');
  const usersMatchIdx = rulesSource.indexOf('match /users/{userId}');
  assert.ok(firstMatchIdx > 0, 'Global default-deny match /{document=**} must exist');
  assert.ok(
    firstMatchIdx < usersMatchIdx,
    'Global default-deny catch-all must be the very first match block inside /databases/{database}/documents'
  );
  assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('every collection path declared in firebase-blueprint.json has an explicit match block in firestore.rules', () => {
  const firestorePaths = Object.keys(blueprint.firestore || {});
  assert.equal(firestorePaths.length, 7);

  const expectedMatches = [
    'match /users/{userId}',
    'match /private/{docId}',
    'match /workspace/{docId}',
    'match /customers/{customerId}',
    'match /quotations/{quotationId}',
    'match /invoices/{invoiceId}',
    'match /emailLogs/{logId}',
  ];
  for (const m of expectedMatches) {
    assert.ok(rulesSource.includes(m), `Missing required match block: ${m}`);
  }
});

test('Dirty Dozen #1, #2, #3: Verified Owner & Zero Blanket Reads / Cross-Tenant Isolation', () => {
  assert.match(rulesSource, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesSource, /request\.auth\.uid == userId/);
  // Must NEVER allow blanket isSignedIn() reads
  assert.doesNotMatch(rulesSource, /allow\s+(read|get|list)\s*:\s*if\s+isSignedIn\(\)\s*;/);
  // Every allow list must explicitly validate resource.data.userId == request.auth.uid (no client delegation)
  const listMatches = [...rulesSource.matchAll(/allow list:\s*if\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(listMatches.length >= 4);
  for (const expr of listMatches) {
    if (expr === 'false') continue;
    assert.ok(
      expr.includes('resource.data.userId == request.auth.uid'),
      `allow list must enforce resource.data.userId == request.auth.uid, got: ${expr}`
    );
    assert.ok(!expr.includes('get(') && !expr.includes('exists('), 'allow list must not perform get()/exists()');
  }
});

test('Dirty Dozen #4, #5, #6, #7: Anti-Update-Gap validation blueprints, hasOnly, immutability, and Temporal Integrity', () => {
  // All 7 entities have dedicated validation blueprint functions
  const helpers = [
    'isValidUserProfile',
    'isValidUserPrivateAccount',
    'isValidWorkspaceSettings',
    'isValidCustomerRecord',
    'isValidQuotationRecord',
    'isValidInvoiceRecord',
    'isValidEmailLogRecord',
  ];
  for (const fn of helpers) {
    assert.ok(rulesSource.includes(`function ${fn}(`), `Missing validation blueprint ${fn}`);
  }

  // Temporal integrity: createdAt == request.time on create, updatedAt == request.time on update
  assert.ok(rulesSource.includes('incoming().createdAt == request.time'));
  assert.ok(rulesSource.includes('incoming().updatedAt == request.time'));
  assert.ok(rulesSource.includes('incoming().createdAt == existing().createdAt'));
  assert.ok(rulesSource.includes('incoming().userId == existing().userId'));

  // Action-based update key allowlisting
  assert.ok(rulesSource.includes('incoming().diff(existing()).affectedKeys().hasOnly('));
});

test('Dirty Dozen #8, #9: Quotation Terminal State Locking, Approved-Only Conversion & Atomic Batch Invariant', () => {
  // Cannot create already converted quotation or pre-populate convertedInvoiceId
  assert.ok(rulesSource.includes("incoming().status != 'Converted to Invoice'"));
  assert.ok(rulesSource.includes("!('convertedInvoiceId' in incoming())"));
  // Terminal state lock blocks all edits/deletes once Converted to Invoice
  assert.ok(rulesSource.includes("existing().status != 'Converted to Invoice'"));
  // Conversion requires existing Approved status AND atomic invoice existence via existsAfter
  assert.ok(rulesSource.includes("existing().status == 'Approved'"));
  assert.ok(
    rulesSource.includes(
      'existsAfter(/databases/$(database)/documents/users/$(userId)/invoices/$(incoming().convertedInvoiceId))'
    )
  );
});

test('Dirty Dozen #10, #11, #12: Path Variable Hardening, Bounded Arrays, and Append-Only Email Audit Logs', () => {
  assert.ok(
    rulesSource.includes("id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$')")
  );
  // Bounded arrays with first-element type guards
  assert.ok(rulesSource.includes('data.fields.size() <= 150'));
  assert.ok(rulesSource.includes('(data.fields.size() == 0 || data.fields[0] is map)'));
  assert.ok(rulesSource.includes('data.approvalHistory.size() <= 100'));
  assert.ok(rulesSource.includes('(data.approvalHistory.size() == 0 || data.approvalHistory[0] is map)'));
  // Append-only email logs forbid all updates
  assert.match(rulesSource, /match \/emailLogs\/\{logId\}[\s\S]*allow update:\s*if false;/);
});
