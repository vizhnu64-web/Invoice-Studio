# Invoice Studio — Firestore Security Specification (Phase 0 TDD)

## 1. Master Source of Truth & Relationship Mapping
- **Master Document**: `/users/{userId}` is the root authority for each tenant.
- **Strict Tenant Isolation**: Every subcollection (`/users/{userId}/private/{docId}`, `/users/{userId}/workspace/{docId}`, `/users/{userId}/customers/{customerId}`, `/users/{userId}/quotations/{quotationId}`, `/users/{userId}/invoices/{invoiceId}`, `/users/{userId}/emailLogs/{logId}`) belongs exclusively to `userId`.
- **Master Gate**: Subcollection single-document writes verify parent user profile existence (`exists(/databases/$(database)/documents/users/$(userId))`), and all operations require `request.auth != null && request.auth.uid == userId && request.auth.token.email_verified == true`.
- **PII Isolation**: User email is isolated in `/users/{userId}/private/{docId}`. Customer emails/addresses and invoice/quotation recipient details are strictly isolated under `/users/{userId}/...` with zero cross-user read or list access.

## 2. Data Invariants
1. **Default Deny**: No unmatched document path may be read or written.
2. **Verified Identity**: All writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Zero Cross-Tenant Access**: User B can never read, list, create, update, or delete any document under `/users/{userA}/...`.
4. **Immutable Ownership & Timestamps**: `userId` and `createdAt` can never be changed after creation. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
5. **Path Variable Hardening**: Every single-document ID (`userId`, `docId`, `customerId`, `quotationId`, `invoiceId`, `logId`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` chars.
6. **Strict Schema & No Shadow Fields**: Every create checks `hasAll` + `hasOnly`, and every update uses action-based `affectedKeys().hasOnly(...)` wrapped by `isValid[Entity](incoming())`.
7. **Terminal State Locking (Quotations)**: Once a quotation has `status == 'Converted to Invoice'`, NO further updates are permitted on that quotation, and conversion is only permitted when `existing().status == 'Approved'`.
8. **Append-Only Email Logs**: `/users/{userId}/emailLogs/{logId}` documents cannot be updated after creation (audit trail integrity).
9. **Bounded Lists**: `fields` array in workspace settings is capped at `<= 150`, and `approvalHistory` in quotations is capped at `<= 100`.
10. **Secure List Queries**: Every `allow list` checks `resource.data.userId == request.auth.uid` directly on `resource.data` (no `get()`/`exists()` inside `allow list`).

## 3. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Cross-Tenant Read/Write**: User B tries to read or write `/users/userA/quotations/q_1`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` tries to create `/users/userA/invoices/inv_1`.
3. **Identity Spoofing**: User A tries to create `/users/userA/customers/cust_1` with `{ "userId": "userB", ... }`.
4. **Shadow Field Injection (Create)**: User A creates `/users/userA` with an extra `"isAdmin": true` ghost field.
5. **Shadow Update Injection (Update)**: User A updates `/users/userA/customers/cust_1` adding `"role": "superadmin"`.
6. **Immutable Field Tampering**: User A updates `/users/userA/invoices/inv_1` attempting to alter `createdAt` or `userId`.
7. **Forged Client Timestamp**: User A creates `/users/userA/quotations/q_1` with a client-supplied past timestamp instead of `request.time`.
8. **Quotation State Shortcutting**: User A tries to update a `Draft` quotation directly to `status: "Converted to Invoice"` without first reaching `Approved`.
9. **Terminal State Unlocking**: User A tries to edit a quotation whose existing `status` is `"Converted to Invoice"`.
10. **ID Poisoning / Oversized Path ID**: User A tries to write `/users/userA/invoices/<200-char-id-with-spaces-or-slashes>`.
11. **Value Poisoning / Oversized String**: User A tries to write a quotation with `customerName` > 200 chars or `status: 12345` (wrong type).
12. **Audit Log Tampering**: User A tries to `update` an existing `/users/userA/emailLogs/log_1` document to change `status` from `"failed"` to `"sent"`.
