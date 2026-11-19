/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CalculationSettings,
  CompanySettings,
  CustomerRecord,
  EmailDeliveryLogEntry,
  GenerationRecord,
  InvoiceFieldConfig,
  InvoiceTemplate,
  QuotationRecord,
} from '../types';
import {
  buildCustomerCreatePayload,
  buildCustomerUpdatePayload,
  buildEmailLogCreatePayload,
  buildInvoiceCreatePayload,
  buildInvoiceUpdatePayload,
  buildQuotationConvertUpdatePayload,
  buildQuotationCreatePayload,
  buildQuotationUpdatePayload,
  buildUserPrivateAccountCreatePayload,
  buildUserProfileCreatePayload,
  buildUserProfileUpdatePayload,
  buildWorkspaceSettingsCreatePayload,
  buildWorkspaceSettingsUpdatePayload,
  sanitizeDocumentId,
} from './firebaseSanitizer';

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

export interface WorkspaceRealtimeCallbacks {
  onWorkspaceSettings: (payload: {
    companySettings?: CompanySettings;
    template?: InvoiceTemplate;
    calculationSettings?: CalculationSettings;
    fields?: InvoiceFieldConfig[];
  }) => void;
  onCustomers: (customers: CustomerRecord[]) => void;
  onQuotations: (quotations: QuotationRecord[]) => void;
  onInvoices: (invoices: GenerationRecord[]) => void;
  onEmailLogs: (logs: EmailDeliveryLogEntry[]) => void;
  onSyncActivity?: () => void;
  onError?: (err: Error) => void;
}

/**
 * Ensures the master `/users/{uid}` document and isolated `/users/{uid}/private/account`
 * PII document exist before any subcollection writes occur (Master Gate invariant).
 */
export async function ensureFirebaseUserInitialized(user: User): Promise<void> {
  const userId = sanitizeDocumentId(user.uid, 'user');
  const userPath = `users/${userId}`;
  const userRef = doc(db, 'users', userId);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(
        userRef,
        buildUserProfileCreatePayload(
          userId,
          user.displayName || user.email?.split('@')[0] || 'Invoice Studio User',
          user.photoURL,
          true,
          serverTimestamp()
        )
      );
    } else {
      await updateDoc(
        userRef,
        buildUserProfileUpdatePayload(
          user.displayName || (snap.data()?.displayName as string) || 'Invoice Studio User',
          user.photoURL,
          Boolean(snap.data()?.onboardingCompleted ?? true),
          serverTimestamp()
        )
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // Isolated PII document (/users/{uid}/private/account)
  if (user.email) {
    const privatePath = `users/${userId}/private/account`;
    const privateRef = doc(db, 'users', userId, 'private', 'account');
    try {
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(
          privateRef,
          buildUserPrivateAccountCreatePayload(userId, user.email, serverTimestamp())
        );
      } else if (privSnap.data()?.email !== user.email) {
        await updateDoc(privateRef, {
          email: user.email.trim().slice(0, 254),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }
}

/**
 * Attaches real-time Firestore `onSnapshot` listeners strictly scoped to the signed-in user.
 * Caller MUST only invoke this once Firebase Auth is ready and `user` is non-null.
 */
export function subscribeToUserWorkspace(
  userId: string,
  callbacks: WorkspaceRealtimeCallbacks
): Unsubscribe {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const unsubscribers: Unsubscribe[] = [];

  const emitError = (error: unknown, op: OperationType, path: string) => {
    try {
      handleFirestoreError(error, op, path);
    } catch (wrapped) {
      if (callbacks.onError && wrapped instanceof Error) {
        callbacks.onError(wrapped);
      }
    }
  };

  // 1. Workspace settings document
  const settingsPath = `users/${safeUid}/workspace/settings`;
  unsubscribers.push(
    onSnapshot(
      doc(db, 'users', safeUid, 'workspace', 'settings'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          callbacks.onWorkspaceSettings({
            companySettings: data.companySettings as CompanySettings | undefined,
            template: data.template as InvoiceTemplate | undefined,
            calculationSettings: data.calculationSettings as CalculationSettings | undefined,
            fields: Array.isArray(data.fields) ? (data.fields as InvoiceFieldConfig[]) : undefined,
          });
        }
        callbacks.onSyncActivity?.();
      },
      (error) => emitError(error, OperationType.GET, settingsPath)
    )
  );

  // 2. Customers subcollection (explicit where clause matches Pillar 8 list rule)
  const customersPath = `users/${safeUid}/customers`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'users', safeUid, 'customers'), where('userId', '==', safeUid)),
      (snap) => {
        const items: CustomerRecord[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id || d.id),
            customerName: String(raw.customerName || ''),
            contactPerson: raw.contactPerson as string | undefined,
            email: raw.email as string | undefined,
            phone: raw.phone as string | undefined,
            billingAddress: String(raw.billingAddress || ''),
            shippingAddress: raw.shippingAddress as string | undefined,
            city: raw.city as string | undefined,
            state: raw.state as string | undefined,
            postalCode: raw.postalCode as string | undefined,
            country: raw.country as string | undefined,
            gstin: raw.gstin as string | undefined,
            pan: raw.pan as string | undefined,
            referenceNumber: raw.referenceNumber as string | undefined,
            updatedAt: timestampToIso(raw.updatedAt),
          };
        });
        callbacks.onCustomers(items);
        callbacks.onSyncActivity?.();
      },
      (error) => emitError(error, OperationType.LIST, customersPath)
    )
  );

  // 3. Quotations subcollection
  const quotationsPath = `users/${safeUid}/quotations`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'users', safeUid, 'quotations'), where('userId', '==', safeUid)),
      (snap) => {
        const items: QuotationRecord[] = snap.docs
          .map((d) => {
            const raw = d.data();
            return {
              id: String(raw.id || d.id),
              ownerUserId: String(raw.userId || safeUid),
              quotationNumber: String(raw.quotationNumber || ''),
              quotationDate: String(raw.quotationDate || ''),
              validUntilDate: String(raw.validUntilDate || ''),
              customerName: String(raw.customerName || ''),
              customerEmail: raw.customerEmail as string | undefined,
              projectName: raw.projectName as string | undefined,
              salesperson: raw.salesperson as string | undefined,
              currencyCode: String(raw.currencyCode || 'INR'),
              status: raw.status as QuotationRecord['status'],
              subtotal: Number(raw.subtotal || 0),
              taxableAmount: Number(raw.taxableAmount || 0),
              totalTax: Number(raw.totalTax || 0),
              discountAmount: Number(raw.discountAmount || 0),
              totalAmount: Number(raw.totalAmount || 0),
              amountInWords: String(raw.amountInWords || ''),
              data: raw.data as QuotationRecord['data'],
              approvalHistory: Array.isArray(raw.approvalHistory)
                ? (raw.approvalHistory as QuotationRecord['approvalHistory'])
                : [],
              approvedAt: raw.approvedAt as string | undefined,
              approvedBy: raw.approvedBy as string | undefined,
              approvalNotes: raw.approvalNotes as string | undefined,
              rejectionReason: raw.rejectionReason as string | undefined,
              convertedInvoiceId: raw.convertedInvoiceId as string | undefined,
              convertedInvoiceNumber: raw.convertedInvoiceNumber as string | undefined,
              convertedAt: raw.convertedAt as string | undefined,
              createdAt: timestampToIso(raw.createdAt),
              updatedAt: timestampToIso(raw.updatedAt),
            };
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        callbacks.onQuotations(items);
        callbacks.onSyncActivity?.();
      },
      (error) => emitError(error, OperationType.LIST, quotationsPath)
    )
  );

  // 4. Invoices subcollection
  const invoicesPath = `users/${safeUid}/invoices`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'users', safeUid, 'invoices'), where('userId', '==', safeUid)),
      (snap) => {
        const items: GenerationRecord[] = snap.docs
          .map((d) => {
            const raw = d.data();
            return {
              id: String(raw.id || d.id),
              invoiceNumber: String(raw.invoiceNumber || ''),
              customerName: String(raw.customerName || ''),
              sourceType: raw.sourceType as GenerationRecord['sourceType'],
              sourceName: String(raw.sourceName || ''),
              worksheetName: String(raw.worksheetName || ''),
              generatedDate: String(raw.generatedDate || ''),
              totalAmount: Number(raw.totalAmount || 0),
              gstAmount: Number(raw.gstAmount || 0),
              templateId: String(raw.templateId || 'default'),
              profileId: String(raw.profileId || 'default'),
              revisionNumber: Number(raw.revisionNumber || 1),
              status: raw.status as GenerationRecord['status'],
              dataSnapshot: raw.dataSnapshot,
              paymentMethod: raw.paymentMethod as string | undefined,
              paymentStatus: raw.paymentStatus as string | undefined,
              paymentDate: raw.paymentDate as string | undefined,
              paymentReference: raw.paymentReference as string | undefined,
              paymentAmount:
                typeof raw.paymentAmount === 'number' ? raw.paymentAmount : undefined,
              paymentNotes: raw.paymentNotes as string | undefined,
              sourceQuotationId: raw.sourceQuotationId as string | undefined,
              sourceQuotationNumber: raw.sourceQuotationNumber as string | undefined,
              updatedAt: timestampToIso(raw.updatedAt),
            };
          })
          .sort((a, b) => (b.updatedAt || b.generatedDate).localeCompare(a.updatedAt || a.generatedDate));
        callbacks.onInvoices(items);
        callbacks.onSyncActivity?.();
      },
      (error) => emitError(error, OperationType.LIST, invoicesPath)
    )
  );

  // 5. Email Delivery Logs subcollection
  const emailLogsPath = `users/${safeUid}/emailLogs`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'users', safeUid, 'emailLogs'), where('userId', '==', safeUid)),
      (snap) => {
        const items: EmailDeliveryLogEntry[] = snap.docs
          .map((d) => {
            const raw = d.data();
            return {
              id: String(raw.id || d.id),
              userId: String(raw.userId || safeUid),
              documentType: raw.documentType as EmailDeliveryLogEntry['documentType'],
              documentId: String(raw.documentId || ''),
              documentNumber: String(raw.documentNumber || ''),
              recipientEmail: String(raw.recipientEmail || ''),
              cc: raw.cc as string | undefined,
              bcc: raw.bcc as string | undefined,
              deliveryMethod: raw.deliveryMethod as EmailDeliveryLogEntry['deliveryMethod'],
              senderEmail: String(raw.senderEmail || ''),
              subject: String(raw.subject || ''),
              status: raw.status as EmailDeliveryLogEntry['status'],
              providerMessageId: (raw.providerMessageId as string | undefined) ?? null,
              errorMessage: (raw.errorMessage as string | undefined) ?? null,
              createdAt: timestampToIso(raw.createdAt),
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        callbacks.onEmailLogs(items);
        callbacks.onSyncActivity?.();
      },
      (error) => emitError(error, OperationType.LIST, emailLogsPath)
    )
  );

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}

export async function saveWorkspaceSettingsToFirestore(
  userId: string,
  companySettings: CompanySettings,
  template: InvoiceTemplate,
  calculationSettings: CalculationSettings,
  fields: InvoiceFieldConfig[]
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const path = `users/${safeUid}/workspace/settings`;
  const ref = doc(db, 'users', safeUid, 'workspace', 'settings');
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(
        ref,
        buildWorkspaceSettingsCreatePayload(
          safeUid,
          companySettings,
          template,
          calculationSettings,
          fields,
          serverTimestamp()
        )
      );
    } else {
      await updateDoc(
        ref,
        buildWorkspaceSettingsUpdatePayload(
          companySettings,
          template,
          calculationSettings,
          fields,
          serverTimestamp()
        )
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveCustomerToFirestore(
  userId: string,
  customer: CustomerRecord
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(customer.id, 'cust');
  const path = `users/${safeUid}/customers/${safeId}`;
  const ref = doc(db, 'users', safeUid, 'customers', safeId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, buildCustomerCreatePayload(safeUid, { ...customer, id: safeId }, serverTimestamp()));
    } else {
      await updateDoc(ref, buildCustomerUpdatePayload({ ...customer, id: safeId }, serverTimestamp()));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCustomerFromFirestore(
  userId: string,
  customerId: string
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(customerId, 'cust');
  const path = `users/${safeUid}/customers/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'customers', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveQuotationToFirestore(
  userId: string,
  quotation: QuotationRecord
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(quotation.id, 'qt');
  const path = `users/${safeUid}/quotations/${safeId}`;
  const ref = doc(db, 'users', safeUid, 'quotations', safeId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(
        ref,
        buildQuotationCreatePayload(safeUid, { ...quotation, id: safeId }, serverTimestamp())
      );
    } else if (existing.data()?.status !== 'Converted to Invoice') {
      await updateDoc(
        ref,
        buildQuotationUpdatePayload({ ...quotation, id: safeId }, serverTimestamp())
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Atomically converts an Approved quotation into a linked invoice using a single Firestore WriteBatch,
 * satisfying Pillar 7 (`existsAfter` invoice check) and Terminal State Locking in firestore.rules.
 */
export async function convertQuotationAtomicallyInFirestore(
  userId: string,
  updatedQuotation: QuotationRecord,
  createdInvoice: GenerationRecord
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeQuotationId = sanitizeDocumentId(updatedQuotation.id, 'qt');
  const safeInvoiceId = sanitizeDocumentId(createdInvoice.id, 'inv');
  const batchPath = `users/${safeUid}/quotations/${safeQuotationId}`;

  const quotationRef = doc(db, 'users', safeUid, 'quotations', safeQuotationId);
  const invoiceRef = doc(db, 'users', safeUid, 'invoices', safeInvoiceId);

  try {
    const existingQ = await getDoc(quotationRef);
    if (!existingQ.exists()) {
      // Ensure the quotation exists as Approved first if created while offline/local
      await setDoc(
        quotationRef,
        buildQuotationCreatePayload(
          safeUid,
          { ...updatedQuotation, id: safeQuotationId, status: 'Approved' },
          serverTimestamp()
        )
      );
    }
    const batch = writeBatch(db);
    batch.set(
      invoiceRef,
      buildInvoiceCreatePayload(safeUid, { ...createdInvoice, id: safeInvoiceId }, serverTimestamp())
    );
    batch.update(
      quotationRef,
      buildQuotationConvertUpdatePayload(
        updatedQuotation,
        safeInvoiceId,
        createdInvoice.invoiceNumber,
        serverTimestamp()
      )
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, batchPath);
  }
}

export async function deleteQuotationFromFirestore(
  userId: string,
  quotationId: string
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(quotationId, 'qt');
  const path = `users/${safeUid}/quotations/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'quotations', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveInvoiceToFirestore(
  userId: string,
  record: GenerationRecord
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(record.id, 'inv');
  const path = `users/${safeUid}/invoices/${safeId}`;
  const ref = doc(db, 'users', safeUid, 'invoices', safeId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(
        ref,
        buildInvoiceCreatePayload(safeUid, { ...record, id: safeId }, serverTimestamp())
      );
    } else {
      await updateDoc(ref, buildInvoiceUpdatePayload({ ...record, id: safeId }, serverTimestamp()));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteInvoiceFromFirestore(
  userId: string,
  invoiceId: string
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(invoiceId, 'inv');
  const path = `users/${safeUid}/invoices/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'invoices', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveEmailLogToFirestore(
  userId: string,
  entry: EmailDeliveryLogEntry
): Promise<void> {
  const safeUid = sanitizeDocumentId(userId, 'user');
  const safeId = sanitizeDocumentId(entry.id, 'elog');
  const path = `users/${safeUid}/emailLogs/${safeId}`;
  const ref = doc(db, 'users', safeUid, 'emailLogs', safeId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, buildEmailLogCreatePayload(safeUid, { ...entry, id: safeId }, serverTimestamp()));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
