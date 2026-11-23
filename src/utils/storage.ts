/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AdvancedAmountCalculationSettings,
  CompanySettings,
  CustomerRecord,
  DriveWorkspaceConnection,
  EmailDeliveryLogEntry,
  EmailDeliveryMethod,
  GenerationRecord,
  GstConfigurationSettings,
  InvoiceFieldConfig,
  InvoiceTemplate,
  ManualInvoiceDraft,
  MappingProfile,
  QuotationRecord,
  SpreadsheetData,
  WorkflowSessionState,
} from '../types';
import {
  defaultCompanySettings,
  defaultFieldCatalog,
  defaultMappingProfiles,
  defaultTemplates,
} from '../mockData';

export const EMPTY_SPREADSHEET_DATA: SpreadsheetData = {
  fileName: '',
  activeSheetName: '',
  worksheets: [],
};

export const defaultAdvancedAmountSettings: AdvancedAmountCalculationSettings = {
  quantity: { method: 'automatic', fixedValue: 1 },
  unitRate: { method: 'excel_column', sourceColumn: '' },
  grossAmount: { method: 'automatic' },
  discount: { method: 'fixed', fixedValue: 0 },
  taxableAmount: { method: 'automatic' },
  additionalCharges: { method: 'fixed', fixedValue: 0 },
  lineTotal: { method: 'automatic' },
  subtotal: { method: 'automatic' },
};

export const defaultGstSettings: GstConfigurationSettings = {
  enabled: true,
  pricingType: 'exclusive',
  rateSource: 'fixed',
  fixedRate: 18,
  taxType: 'AUTO',
};

const BASE_KEYS = {
  COMPANY_PROFILES: 'company_profiles',
  ACTIVE_COMPANY_ID: 'active_company_id',
  FIELDS: 'fields',
  PROFILES: 'profiles',
  TEMPLATES: 'templates',
  ACTIVE_TEMPLATE: 'active_template',
  CALCULATION_SETTINGS: 'calculation_settings',
  HISTORY: 'history',
  SPREADSHEET: 'spreadsheet',
  WORKFLOW_SESSION: 'workflow_session',
  SAVED_MAPPING_TEMPLATES: 'saved_mapping_templates',
  CUSTOMERS: 'customers',
  MANUAL_DRAFTS: 'manual_drafts',
  ACTIVE_MANUAL_FORM: 'active_manual_form',
  QUOTATIONS: 'quotations',
  EMAIL_STATUSES: 'email_statuses',
  EMAIL_LOGS: 'email_logs',
  EMAIL_PREFS: 'email_prefs',
} as const;

export const USER_WORKSPACE_META_PREFIX = 'invoice_studio_workspace_';

/**
 * Non-secret browser metadata namespaced strictly by backend-verified Google `sub`.
 * NEVER stores access tokens, passwords, or authoritative business records.
 */
export interface UserWorkspaceBrowserMetadata {
  sub: string;
  folderId?: string;
  folderName?: string;
  folderUrl?: string;
  lastSpreadsheetId?: string;
  lastSpreadsheetTitle?: string;
  lastSyncedAt?: string;
  preferredEmailMethod?: EmailDeliveryMethod;
  updatedAt: string;
}

export function buildUserWorkspaceMetadataKey(googleSub: string): string {
  const safeSub = String(googleSub || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeSub) {
    throw new Error('A verified Google subject ID (sub) is required to namespace workspace metadata.');
  }
  return `${USER_WORKSPACE_META_PREFIX}${safeSub}`;
}

export function loadUserWorkspaceMetadata(
  googleSub: string,
  storageLike?: Pick<Storage, 'getItem'> | null
): UserWorkspaceBrowserMetadata | null {
  const store =
    storageLike !== undefined
      ? storageLike
      : typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? window.localStorage
        : null;
  if (!store || !googleSub) return null;
  try {
    const key = buildUserWorkspaceMetadataKey(googleSub);
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.sub !== googleSub) {
      return null;
    }
    return {
      sub: googleSub,
      folderId: typeof parsed.folderId === 'string' ? parsed.folderId : undefined,
      folderName: typeof parsed.folderName === 'string' ? parsed.folderName : undefined,
      folderUrl: typeof parsed.folderUrl === 'string' ? parsed.folderUrl : undefined,
      lastSpreadsheetId:
        typeof parsed.lastSpreadsheetId === 'string' ? parsed.lastSpreadsheetId : undefined,
      lastSpreadsheetTitle:
        typeof parsed.lastSpreadsheetTitle === 'string' ? parsed.lastSpreadsheetTitle : undefined,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
      preferredEmailMethod:
        parsed.preferredEmailMethod === 'gmail_api' ||
        parsed.preferredEmailMethod === 'gmail_smtp' ||
        parsed.preferredEmailMethod === 'custom_smtp'
          ? parsed.preferredEmailMethod
          : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveUserWorkspaceMetadata(
  googleSub: string,
  patch: Partial<Omit<UserWorkspaceBrowserMetadata, 'sub' | 'updatedAt'>>,
  storageLike?: Pick<Storage, 'getItem' | 'setItem'> | null
): UserWorkspaceBrowserMetadata | null {
  const store =
    storageLike !== undefined
      ? storageLike
      : typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? window.localStorage
        : null;
  if (!store || !googleSub) return null;

  try {
    const existing = loadUserWorkspaceMetadata(googleSub, store);
    // Explicitly whitelist ONLY non-secret metadata fields
    const next: UserWorkspaceBrowserMetadata = {
      sub: googleSub,
      folderId: patch.folderId !== undefined ? patch.folderId : existing?.folderId,
      folderName: patch.folderName !== undefined ? patch.folderName : existing?.folderName,
      folderUrl: patch.folderUrl !== undefined ? patch.folderUrl : existing?.folderUrl,
      lastSpreadsheetId:
        patch.lastSpreadsheetId !== undefined ? patch.lastSpreadsheetId : existing?.lastSpreadsheetId,
      lastSpreadsheetTitle:
        patch.lastSpreadsheetTitle !== undefined
          ? patch.lastSpreadsheetTitle
          : existing?.lastSpreadsheetTitle,
      lastSyncedAt: patch.lastSyncedAt !== undefined ? patch.lastSyncedAt : existing?.lastSyncedAt,
      preferredEmailMethod:
        patch.preferredEmailMethod !== undefined
          ? patch.preferredEmailMethod
          : existing?.preferredEmailMethod,
      updatedAt: new Date().toISOString(),
    };
    const key = buildUserWorkspaceMetadataKey(googleSub);
    store.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export function clearUserWorkspaceMetadata(
  googleSub: string,
  storageLike?: Pick<Storage, 'removeItem'> | null
): void {
  const store =
    storageLike !== undefined
      ? storageLike
      : typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? window.localStorage
        : null;
  if (!store || !googleSub) return;
  try {
    store.removeItem(buildUserWorkspaceMetadataKey(googleSub));
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Strictly in-memory business workspace store.
 *
 * Architecture guarantees:
 * - Zero global localStorage keys for business records.
 * - Zero access tokens or Drive credentials in localStorage/sessionStorage/IndexedDB.
 * - Non-secret UI/folder preferences may ONLY be stored under `invoice_studio_workspace_<google_sub>`.
 * - Switching accounts or disconnecting wipes all active in-memory workspace records completely.
 */
let activeWorkspaceId: string | null = null;
let activeAccountSub: string | null = null;
let activeDriveConnection: DriveWorkspaceConnection | null = null;
const memoryStore = new Map<string, string>();
let runtimeSessionId: string | null = null;

/**
 * Cleans up any legacy global localStorage keys while preserving valid `invoice_studio_workspace_<sub>`
 * non-secret metadata entries.
 */
export function purgeLegacyBrowserStorage(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(USER_WORKSPACE_META_PREFIX)) {
        // Verify it contains no accidental token fields; if corrupted, remove it
        try {
          const parsed = JSON.parse(window.localStorage.getItem(k) || '{}');
          if (!parsed || typeof parsed.sub !== 'string' || 'accessToken' in parsed || 'token' in parsed) {
            keysToRemove.push(k);
          }
        } catch {
          keysToRemove.push(k);
        }
        continue;
      }
      if (k.startsWith('invoice_studio_') || k.startsWith('invoiceStudio')) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage access restrictions
  }
}

export function getTempSessionId(): string {
  if (!runtimeSessionId) {
    runtimeSessionId = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  return runtimeSessionId;
}

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

export function setActiveWorkspaceId(folderId: string | null, accountSub?: string | null): void {
  activeWorkspaceId = folderId && folderId.trim() ? folderId.trim() : null;
  if (accountSub !== undefined) {
    activeAccountSub = accountSub && accountSub.trim() ? accountSub.trim() : null;
  }
}

export function getActiveAccountSub(): string | null {
  return activeAccountSub;
}

export function setActiveAccountSub(sub: string | null): void {
  activeAccountSub = sub && sub.trim() ? sub.trim() : null;
}

function buildScopedKey(baseKey: string, workspaceId?: string | null): string {
  const scope = workspaceId !== undefined ? workspaceId : getActiveWorkspaceId();
  const sub = activeAccountSub || 'anon';
  if (scope) {
    return `ws::${sub}::${scope}::${baseKey}`;
  }
  return `tmp::${getTempSessionId()}::${baseKey}`;
}

function readRaw(baseKey: string, workspaceId?: string | null): string | null {
  return memoryStore.get(buildScopedKey(baseKey, workspaceId)) ?? null;
}

function writeRaw(baseKey: string, value: string, workspaceId?: string | null): void {
  memoryStore.set(buildScopedKey(baseKey, workspaceId), value);
}

function removeRaw(baseKey: string, workspaceId?: string | null): void {
  memoryStore.delete(buildScopedKey(baseKey, workspaceId));
}

export function clearWorkspaceCaches(workspaceId?: string | null): void {
  for (const key of Object.values(BASE_KEYS)) {
    removeRaw(key, workspaceId);
  }
}

export function loadDriveConnection(): DriveWorkspaceConnection | null {
  return activeDriveConnection;
}

export function saveDriveConnection(connection: DriveWorkspaceConnection): void {
  activeDriveConnection = {
    accountSub: connection.accountSub || activeAccountSub || '',
    folderUrl: connection.folderUrl,
    folderId: connection.folderId,
    folderName: connection.folderName,
    accountEmail: connection.accountEmail,
    accountName: connection.accountName,
    isConnected: Boolean(connection.isConnected),
    lastSyncedAt: connection.lastSyncedAt,
    connectedAt: connection.connectedAt || new Date().toISOString(),
    hasDriveScope: Boolean(connection.hasDriveScope ?? true),
    hasSheetsScope: Boolean(connection.hasSheetsScope),
    hasGmailScope: Boolean(connection.hasGmailScope),
    subfolders: connection.subfolders,
  };
  if (activeDriveConnection.accountSub) {
    setActiveAccountSub(activeDriveConnection.accountSub);
    saveUserWorkspaceMetadata(activeDriveConnection.accountSub, {
      folderId: activeDriveConnection.folderId,
      folderName: activeDriveConnection.folderName,
      folderUrl: activeDriveConnection.folderUrl,
      lastSyncedAt: activeDriveConnection.lastSyncedAt,
    });
  }
  setActiveWorkspaceId(activeDriveConnection.folderId);
}

export function clearDriveConnection(): void {
  memoryStore.clear();
  activeDriveConnection = null;
  activeWorkspaceId = null;
  activeAccountSub = null;
  runtimeSessionId = null;
}

function createFreshCompanyDefaults(): CompanySettings {
  return {
    ...defaultCompanySettings,
    brandPalette: { ...defaultCompanySettings.brandPalette },
    typography: { ...defaultCompanySettings.typography },
    assets: { ...defaultCompanySettings.assets },
    content: {
      ...defaultCompanySettings.content,
      customTextBlocks: [],
    },
    currency: { ...defaultCompanySettings.currency },
    bankAccounts: [],
  };
}

export const storage = {
  purgeLegacyBrowserStorage,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  getActiveAccountSub,
  setActiveAccountSub,
  setActiveStorageUser: setActiveWorkspaceId,
  clearWorkspaceCaches,
  clearAllUserWorkspaceCaches: () => {
    memoryStore.clear();
  },
  loadDriveConnection,
  saveDriveConnection,
  clearDriveConnection,
  getTempSessionId,
  loadUserWorkspaceMetadata,
  saveUserWorkspaceMetadata,
  clearUserWorkspaceMetadata,

  // Company Profiles
  loadCompanyProfiles: (): CompanySettings[] => {
    try {
      const saved = readRaw(BASE_KEYS.COMPANY_PROFILES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p: any) => ({
            ...createFreshCompanyDefaults(),
            ...p,
            brandPalette: { ...defaultCompanySettings.brandPalette, ...(p.brandPalette || {}) },
            typography: { ...defaultCompanySettings.typography, ...(p.typography || {}) },
            assets: { ...defaultCompanySettings.assets, ...(p.assets || {}) },
            content: { ...defaultCompanySettings.content, ...(p.content || {}) },
            currency: { ...defaultCompanySettings.currency, ...(p.currency || {}) },
            bankAccounts: Array.isArray(p.bankAccounts) ? p.bankAccounts : [],
          }));
        }
      }
    } catch {
      // fallback
    }
    return [createFreshCompanyDefaults()];
  },

  saveCompanyProfiles: (profiles: CompanySettings[]) => {
    writeRaw(BASE_KEYS.COMPANY_PROFILES, JSON.stringify(profiles));
  },

  loadActiveCompanyId: (): string => {
    return readRaw(BASE_KEYS.ACTIVE_COMPANY_ID) || defaultCompanySettings.profileId;
  },

  saveActiveCompanyId: (id: string) => {
    writeRaw(BASE_KEYS.ACTIVE_COMPANY_ID, id);
  },

  loadCompany: (): CompanySettings => {
    const profiles = storage.loadCompanyProfiles();
    const activeId = storage.loadActiveCompanyId();
    return profiles.find((p) => p.profileId === activeId) || profiles[0] || createFreshCompanyDefaults();
  },

  saveCompany: (company: CompanySettings) => {
    const profiles = storage.loadCompanyProfiles();
    const idx = profiles.findIndex((p) => p.profileId === company.profileId);
    if (idx >= 0) {
      profiles[idx] = company;
    } else {
      profiles.push(company);
    }
    storage.saveCompanyProfiles(profiles);
    storage.saveActiveCompanyId(company.profileId);
  },

  loadCompanySettings: (): CompanySettings => storage.loadCompany(),
  saveCompanySettings: (company: CompanySettings) => storage.saveCompany(company),

  // Field Catalog
  loadFields: (company?: CompanySettings): InvoiceFieldConfig[] => {
    try {
      const saved = readRaw(BASE_KEYS.FIELDS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback
    }
    const base = defaultFieldCatalog.map((f) => ({ ...f }));
    if (!company) return base;
    return base.map((f) => {
      if (f.id === 'company_legal_name')
        return { ...f, value: company.legalName, defaultValue: company.legalName };
      if (f.id === 'company_gstin')
        return { ...f, value: company.gstin, defaultValue: company.gstin };
      if (f.id === 'company_email')
        return { ...f, value: company.email, defaultValue: company.email };
      return f;
    });
  },

  saveFields: (fields: InvoiceFieldConfig[]) => {
    writeRaw(BASE_KEYS.FIELDS, JSON.stringify(fields));
  },

  // Mapping Profiles
  loadProfiles: (): MappingProfile[] => {
    try {
      const saved = readRaw(BASE_KEYS.PROFILES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty by default
    }
    return [...defaultMappingProfiles];
  },

  saveProfiles: (profiles: MappingProfile[]) => {
    writeRaw(BASE_KEYS.PROFILES, JSON.stringify(profiles));
  },

  // PDF Templates
  loadTemplates: (): InvoiceTemplate[] => {
    try {
      const saved = readRaw(BASE_KEYS.TEMPLATES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback
    }
    return defaultTemplates.map((t) => ({
      ...t,
      showSections: { ...t.showSections },
      labels: { ...t.labels },
    }));
  },

  saveTemplates: (templates: InvoiceTemplate[]) => {
    writeRaw(BASE_KEYS.TEMPLATES, JSON.stringify(templates));
  },

  loadTemplate: (): InvoiceTemplate => {
    try {
      const saved = readRaw(BASE_KEYS.ACTIVE_TEMPLATE);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.showSections) return parsed;
      }
    } catch {
      // fallback
    }
    const first = defaultTemplates[0];
    return {
      ...first,
      showSections: { ...first.showSections },
      labels: { ...first.labels },
    };
  },

  saveTemplate: (template: InvoiceTemplate) => {
    writeRaw(BASE_KEYS.ACTIVE_TEMPLATE, JSON.stringify(template));
  },

  // Calculation Settings
  loadCalculationSettings: (): { mode: 'calculated' | 'excel_amount'; taxInclusive: boolean } => {
    try {
      const saved = readRaw(BASE_KEYS.CALCULATION_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.mode === 'string') return parsed;
      }
    } catch {
      // fallback
    }
    return { mode: 'calculated', taxInclusive: false };
  },

  saveCalculationSettings: (settings: { mode: 'calculated' | 'excel_amount'; taxInclusive: boolean }) => {
    writeRaw(BASE_KEYS.CALCULATION_SETTINGS, JSON.stringify(settings));
  },

  // Invoices History
  loadHistory: (): GenerationRecord[] => {
    try {
      const saved = readRaw(BASE_KEYS.HISTORY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty on fresh visit
    }
    return [];
  },

  saveHistory: (history: GenerationRecord[]) => {
    writeRaw(BASE_KEYS.HISTORY, JSON.stringify(history));
  },

  // Imported Spreadsheet
  loadSpreadsheet: (): SpreadsheetData => {
    try {
      const saved = readRaw(BASE_KEYS.SPREADSHEET);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.worksheets)) return parsed;
      }
    } catch {
      // empty on fresh visit
    }
    return { ...EMPTY_SPREADSHEET_DATA, worksheets: [] };
  },

  saveSpreadsheet: (data: SpreadsheetData) => {
    writeRaw(BASE_KEYS.SPREADSHEET, JSON.stringify(data));
  },

  loadSpreadsheetData: (): SpreadsheetData => storage.loadSpreadsheet(),
  saveSpreadsheetData: (data: SpreadsheetData) => storage.saveSpreadsheet(data),

  // Workflow Session & Saved Mapping Templates
  loadWorkflowSession: (): WorkflowSessionState | null => {
    try {
      const saved = readRaw(BASE_KEYS.WORKFLOW_SESSION);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  },

  saveWorkflowSession: (session: WorkflowSessionState) => {
    writeRaw(BASE_KEYS.WORKFLOW_SESSION, JSON.stringify(session));
  },

  clearWorkflowSession: () => {
    removeRaw(BASE_KEYS.WORKFLOW_SESSION);
  },

  loadSavedTemplates: (): Array<{ id: string; name: string; [key: string]: any }> => {
    try {
      const saved = readRaw(BASE_KEYS.SAVED_MAPPING_TEMPLATES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty
    }
    return [];
  },

  saveMappingTemplate: (templateItem: { id?: string; name: string; [key: string]: any }) => {
    const existing = storage.loadSavedTemplates();
    const item = {
      ...templateItem,
      id: templateItem.id || `tpl_${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
    const next = [item, ...existing.filter((t) => t.id !== item.id)];
    writeRaw(BASE_KEYS.SAVED_MAPPING_TEMPLATES, JSON.stringify(next));
    return next;
  },

  // Customers
  loadCustomers: (): CustomerRecord[] => {
    try {
      const saved = readRaw(BASE_KEYS.CUSTOMERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty on fresh visit
    }
    return [];
  },

  saveCustomers: (customers: CustomerRecord[]) => {
    writeRaw(BASE_KEYS.CUSTOMERS, JSON.stringify(customers));
  },

  saveCustomer: (customer: CustomerRecord): CustomerRecord[] => {
    const existing = storage.loadCustomers();
    const idx = existing.findIndex((c) => c.id === customer.id);
    const updated =
      idx >= 0 ? existing.map((c, i) => (i === idx ? customer : c)) : [customer, ...existing];
    storage.saveCustomers(updated);
    return updated;
  },

  deleteCustomer: (id: string): CustomerRecord[] => {
    const updated = storage.loadCustomers().filter((c) => c.id !== id);
    storage.saveCustomers(updated);
    return updated;
  },

  // Manual Drafts & Active Manual Form
  loadManualDrafts: (): ManualInvoiceDraft[] => {
    try {
      const saved = readRaw(BASE_KEYS.MANUAL_DRAFTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty
    }
    return [];
  },

  saveManualDraft: (draft: ManualInvoiceDraft): ManualInvoiceDraft[] => {
    const existing = storage.loadManualDrafts();
    const idx = existing.findIndex((d) => d.id === draft.id);
    const updated =
      idx >= 0 ? existing.map((d, i) => (i === idx ? draft : d)) : [draft, ...existing];
    writeRaw(BASE_KEYS.MANUAL_DRAFTS, JSON.stringify(updated));
    return updated;
  },

  deleteManualDraft: (id: string): ManualInvoiceDraft[] => {
    const updated = storage.loadManualDrafts().filter((d) => d.id !== id);
    writeRaw(BASE_KEYS.MANUAL_DRAFTS, JSON.stringify(updated));
    return updated;
  },

  loadActiveManualForm: (): any | null => {
    try {
      const saved = readRaw(BASE_KEYS.ACTIVE_MANUAL_FORM);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  },

  saveActiveManualForm: (formData: any) => {
    if (!formData) {
      removeRaw(BASE_KEYS.ACTIVE_MANUAL_FORM);
      return;
    }
    writeRaw(BASE_KEYS.ACTIVE_MANUAL_FORM, JSON.stringify(formData));
  },

  // Quotations
  loadQuotations: (): QuotationRecord[] => {
    try {
      const saved = readRaw(BASE_KEYS.QUOTATIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty on fresh visit
    }
    return [];
  },

  saveQuotations: (quotations: QuotationRecord[]) => {
    writeRaw(BASE_KEYS.QUOTATIONS, JSON.stringify(quotations));
  },

  // Email Statuses, Delivery Logs & Non-Sensitive Template Preferences (NEVER SMTP passwords)
  loadEmailStatuses: (): Record<string, any> => {
    try {
      const saved = readRaw(BASE_KEYS.EMAIL_STATUSES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // empty
    }
    return {};
  },

  saveEmailStatuses: (statuses: Record<string, any>) => {
    writeRaw(BASE_KEYS.EMAIL_STATUSES, JSON.stringify(statuses));
  },

  loadEmailLogs: (): EmailDeliveryLogEntry[] => {
    try {
      const saved = readRaw(BASE_KEYS.EMAIL_LOGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // empty
    }
    return [];
  },

  saveEmailLogs: (logs: EmailDeliveryLogEntry[]) => {
    writeRaw(BASE_KEYS.EMAIL_LOGS, JSON.stringify(logs.slice(0, 500)));
  },

  loadEmailConfig: (): {
    senderName: string;
    senderEmail: string;
    replyTo: string;
    defaultCc: string;
    defaultBcc: string;
    subjectTemplate: string;
    bodyTemplate: string;
  } => {
    try {
      const saved = readRaw(BASE_KEYS.EMAIL_PREFS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            senderName: String(parsed.senderName || ''),
            senderEmail: String(parsed.senderEmail || ''),
            replyTo: String(parsed.replyTo || ''),
            defaultCc: String(parsed.defaultCc || ''),
            defaultBcc: String(parsed.defaultBcc || ''),
            subjectTemplate: String(
              parsed.subjectTemplate || 'Invoice {invoice_number} from {company_name}'
            ),
            bodyTemplate: String(
              parsed.bodyTemplate ||
                'Dear {customer_name},\n\nPlease find attached Invoice {invoice_number} for {amount}.\n\nBest regards,\n{company_name}'
            ),
          };
        }
      }
    } catch {
      // default
    }
    return {
      senderName: '',
      senderEmail: '',
      replyTo: '',
      defaultCc: '',
      defaultBcc: '',
      subjectTemplate: 'Invoice {invoice_number} from {company_name}',
      bodyTemplate:
        'Dear {customer_name},\n\nPlease find attached Invoice {invoice_number} for {amount}.\n\nBest regards,\n{company_name}',
    };
  },

  saveEmailConfig: (prefs: Record<string, any>) => {
    const safePrefs = {
      senderName: String(prefs?.senderName || ''),
      senderEmail: String(prefs?.senderEmail || ''),
      replyTo: String(prefs?.replyTo || ''),
      defaultCc: String(prefs?.defaultCc || ''),
      defaultBcc: String(prefs?.defaultBcc || ''),
      subjectTemplate: String(prefs?.subjectTemplate || ''),
      bodyTemplate: String(prefs?.bodyTemplate || ''),
    };
    writeRaw(BASE_KEYS.EMAIL_PREFS, JSON.stringify(safePrefs));
  },
};
