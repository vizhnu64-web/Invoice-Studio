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

const STORAGE_VERSION = 'v3';
const DRIVE_CONNECTION_KEY = `invoice_studio_${STORAGE_VERSION}_drive_connection`;
const TEMP_SESSION_KEY = `invoice_studio_${STORAGE_VERSION}_temp_session_id`;

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

let activeWorkspaceId: string | null = null;
const memoryFallback = new Map<string, string>();

function hasWindowStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getTempStorage(): Storage | null {
  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    return window.sessionStorage;
  }
  return null;
}

/**
 * Generates or retrieves an ephemeral per-tab session ID used ONLY when no Google Drive folder is connected.
 * Keeps temporary browser tabs strictly isolated from each other and ensures fresh visits start clean.
 */
export function getTempSessionId(): string {
  const ss = getTempStorage();
  if (ss) {
    let existing = ss.getItem(TEMP_SESSION_KEY);
    if (!existing) {
      existing = `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      ss.setItem(TEMP_SESSION_KEY, existing);
    }
    return existing;
  }
  if (!memoryFallback.has(TEMP_SESSION_KEY)) {
    memoryFallback.set(
      TEMP_SESSION_KEY,
      `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    );
  }
  return memoryFallback.get(TEMP_SESSION_KEY)!;
}

/**
 * Returns the active workspace identifier:
 * - Connected Google Drive folderId when connected
 * - null when operating in a temporary unbacked-up session
 */
export function getActiveWorkspaceId(): string | null {
  if (activeWorkspaceId) return activeWorkspaceId;
  const conn = loadDriveConnection();
  if (conn?.isConnected && conn.folderId) {
    activeWorkspaceId = conn.folderId;
    return activeWorkspaceId;
  }
  return null;
}

/**
 * Switches the active workspace scope. Must be called when connecting, switching, or disconnecting a Drive folder.
 */
export function setActiveWorkspaceId(folderId: string | null): void {
  activeWorkspaceId = folderId && folderId.trim() ? folderId.trim() : null;
}

function buildScopedKey(baseKey: string, workspaceId?: string | null): string {
  const scope = workspaceId !== undefined ? workspaceId : getActiveWorkspaceId();
  if (scope) {
    return `invoice_studio_${STORAGE_VERSION}_ws_${scope}_${baseKey}`;
  }
  return `invoice_studio_${STORAGE_VERSION}_tmp_${getTempSessionId()}_${baseKey}`;
}

function readRaw(baseKey: string, workspaceId?: string | null): string | null {
  const scope = workspaceId !== undefined ? workspaceId : getActiveWorkspaceId();
  const fullKey = buildScopedKey(baseKey, scope);

  if (scope) {
    if (hasWindowStorage()) {
      return window.localStorage.getItem(fullKey);
    }
    return memoryFallback.get(fullKey) ?? null;
  }

  // Temporary unbacked-up workspace uses sessionStorage only (never leaks to future visitors or other businesses)
  const ss = getTempStorage();
  if (ss) {
    return ss.getItem(fullKey);
  }
  return memoryFallback.get(fullKey) ?? null;
}

function writeRaw(baseKey: string, value: string, workspaceId?: string | null): void {
  const scope = workspaceId !== undefined ? workspaceId : getActiveWorkspaceId();
  const fullKey = buildScopedKey(baseKey, scope);

  try {
    if (scope) {
      if (hasWindowStorage()) {
        window.localStorage.setItem(fullKey, value);
        return;
      }
    } else {
      const ss = getTempStorage();
      if (ss) {
        ss.setItem(fullKey, value);
        return;
      }
    }
    memoryFallback.set(fullKey, value);
  } catch (err) {
    console.warn('Browser storage quota reached:', err);
  }
}

function removeRaw(baseKey: string, workspaceId?: string | null): void {
  const scope = workspaceId !== undefined ? workspaceId : getActiveWorkspaceId();
  const fullKey = buildScopedKey(baseKey, scope);
  if (scope) {
    if (hasWindowStorage()) window.localStorage.removeItem(fullKey);
  } else {
    const ss = getTempStorage();
    if (ss) ss.removeItem(fullKey);
  }
  memoryFallback.delete(fullKey);
}

/**
 * Clears all cached records for a specific workspace (or current temporary workspace)
 * to guarantee strict isolation when disconnecting or switching Drive folders.
 */
export function clearWorkspaceCaches(workspaceId?: string | null): void {
  for (const key of Object.values(BASE_KEYS)) {
    removeRaw(key, workspaceId);
  }
}

// ============================================================
// DRIVE CONNECTION METADATA (NON-SENSITIVE ONLY — NO SECRETS)
// ============================================================

export function loadDriveConnection(): DriveWorkspaceConnection | null {
  try {
    const raw = hasWindowStorage()
      ? window.localStorage.getItem(DRIVE_CONNECTION_KEY)
      : memoryFallback.get(DRIVE_CONNECTION_KEY) ?? null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DriveWorkspaceConnection;
    if (!parsed || !parsed.folderId || !parsed.isConnected) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDriveConnection(connection: DriveWorkspaceConnection): void {
  const safePayload: DriveWorkspaceConnection = {
    folderUrl: connection.folderUrl,
    folderId: connection.folderId,
    folderName: connection.folderName,
    rootFolderId: connection.rootFolderId,
    isConnected: Boolean(connection.isConnected),
    lastSyncedAt: connection.lastSyncedAt,
    connectedAt: connection.connectedAt || new Date().toISOString(),
    serviceAccountEmail: connection.serviceAccountEmail || null,
  };
  const serialized = JSON.stringify(safePayload);
  if (hasWindowStorage()) {
    window.localStorage.setItem(DRIVE_CONNECTION_KEY, serialized);
  } else {
    memoryFallback.set(DRIVE_CONNECTION_KEY, serialized);
  }
  setActiveWorkspaceId(safePayload.folderId);
}

export function clearDriveConnection(): void {
  const previousFolderId = getActiveWorkspaceId();
  if (previousFolderId) {
    clearWorkspaceCaches(previousFolderId);
  }
  if (hasWindowStorage()) {
    window.localStorage.removeItem(DRIVE_CONNECTION_KEY);
  }
  memoryFallback.delete(DRIVE_CONNECTION_KEY);
  setActiveWorkspaceId(null);
  clearWorkspaceCaches(null);
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
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  setActiveStorageUser: setActiveWorkspaceId,
  clearWorkspaceCaches,
  clearAllUserWorkspaceCaches: () => {
    const current = getActiveWorkspaceId();
    if (current) clearWorkspaceCaches(current);
    clearWorkspaceCaches(null);
  },
  loadDriveConnection,
  saveDriveConnection,
  clearDriveConnection,
  getTempSessionId,

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
    } catch (err) {
      console.error('Failed to load company profiles', err);
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
      if (f.id === 'company_legal_name') return { ...f, value: company.legalName, defaultValue: company.legalName };
      if (f.id === 'company_gstin') return { ...f, value: company.gstin, defaultValue: company.gstin };
      if (f.id === 'company_email') return { ...f, value: company.email, defaultValue: company.email };
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
      idx >= 0
        ? existing.map((c, i) => (i === idx ? customer : c))
        : [customer, ...existing];
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
          // Strip any legacy sensitive keys if ever present
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
    // Strictly never store passwords or API keys in localStorage
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
