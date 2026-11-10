/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  CompanySettings, 
  InvoiceFieldConfig, 
  InvoiceTemplate, 
  GenerationRecord, 
  SpreadsheetData, 
  CalculationSettings,
  AdvancedAmountCalculationSettings,
  GstConfigurationSettings,
  WorkflowSessionState
} from '../types';
import { defaultCompanySettings, defaultFieldCatalog, sampleSpreadsheetData, defaultCalculationSettings } from '../mockData';

const STORAGE_KEYS = {
  COMPANY: 'invoice_studio_company_settings_v2',
  FIELDS: 'invoice_studio_fields_v2',
  TEMPLATE: 'invoice_studio_template_v2',
  HISTORY: 'invoice_studio_history_v2',
  SPREADSHEET: 'invoice_studio_spreadsheet_v2',
  ACTIVE_PROFILE: 'invoice_studio_active_profile_v2',
  CALCULATION: 'invoice_studio_calculation_settings_v2',
  WORKFLOW_SESSION: 'invoice_studio_workflow_session_v2',
  SAVED_TEMPLATES: 'invoice_studio_saved_templates_v2',
};

// Fallback in-memory storage for non-browser / Node.js test environments
const memoryStore: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch (e) {
    // Ignore and fallback
  }
  return memoryStore[key] ?? null;
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    // Ignore and fallback
  }
  memoryStore[key] = value;
}

function safeRemoveItem(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (e) {
    // Ignore and fallback
  }
  delete memoryStore[key];
}

export const defaultAdvancedAmountSettings: AdvancedAmountCalculationSettings = {
  quantity: { method: 'automatic', sourceColumn: 'Quantity' },
  unitRate: { method: 'automatic', sourceColumn: 'Rate' },
  grossAmount: { method: 'automatic' },
  discount: { method: 'fixed', fixedValue: 0 },
  taxableAmount: { method: 'automatic' },
  additionalCharges: { method: 'fixed', fixedValue: 0 },
  lineTotal: { method: 'automatic' },
  subtotal: { method: 'automatic' }
};

export const defaultGstSettings: GstConfigurationSettings = {
  enabled: true,
  pricingType: 'exclusive',
  rateSource: 'fixed',
  fixedRate: 18,
  taxType: 'AUTO'
};

export const storage = {

  loadCompanySettings(): CompanySettings {
    try {
      const data = safeGetItem(STORAGE_KEYS.COMPANY);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          ...defaultCompanySettings,
          ...parsed,
          brandPalette: { ...defaultCompanySettings.brandPalette, ...(parsed.brandPalette || {}) },
          typography: { ...defaultCompanySettings.typography, ...(parsed.typography || {}) },
          assets: { ...defaultCompanySettings.assets, ...(parsed.assets || {}) },
          content: { ...defaultCompanySettings.content, ...(parsed.content || {}) },
          currency: { ...defaultCompanySettings.currency, ...(parsed.currency || {}) },
          bankAccounts: Array.isArray(parsed.bankAccounts) && parsed.bankAccounts.length > 0 
            ? parsed.bankAccounts 
            : defaultCompanySettings.bankAccounts
        };
      }
    } catch (e) {
      console.warn('Failed to load company settings from storage:', e);
    }
    return defaultCompanySettings;
  },

  saveCompanySettings(settings: CompanySettings): boolean {
    try {
      safeSetItem(STORAGE_KEYS.COMPANY, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.error('Failed to save company settings to storage:', e);
      return false;
    }
  },

  loadFields(company?: CompanySettings): InvoiceFieldConfig[] {
    try {
      const data = safeGetItem(STORAGE_KEYS.FIELDS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Sync with company settings defaults if provided
          if (company) {
            return parsed.map((f: InvoiceFieldConfig) => {
              if (f.id === 'company_legal_name' && !f.value) return { ...f, value: company.legalName, defaultValue: company.legalName };
              if (f.id === 'company_address' && !f.value) {
                const addr = `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`;
                return { ...f, value: addr, defaultValue: addr };
              }
              if (f.id === 'company_gstin' && !f.value) return { ...f, value: company.gstin, defaultValue: company.gstin };
              if (f.id === 'company_email' && !f.value) return { ...f, value: company.email, defaultValue: company.email };
              return f;
            });
          }
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load fields from storage:', e);
    }
    
    // Default fallback with company synchronization
    if (company) {
      return defaultFieldCatalog.map(f => {
        if (f.id === 'company_legal_name') return { ...f, value: company.legalName, defaultValue: company.legalName };
        if (f.id === 'company_address') {
          const addr = `${company.addressLine1}${company.addressLine2 ? ', ' + company.addressLine2 : ''}, ${company.city}, ${company.state} - ${company.pinCode}`;
          return { ...f, value: addr, defaultValue: addr };
        }
        if (f.id === 'company_gstin') return { ...f, value: company.gstin, defaultValue: company.gstin };
        if (f.id === 'company_email') return { ...f, value: company.email, defaultValue: company.email };
        return f;
      });
    }
    return defaultFieldCatalog;
  },

  saveFields(fields: InvoiceFieldConfig[]): boolean {
    try {
      safeSetItem(STORAGE_KEYS.FIELDS, JSON.stringify(fields));
      return true;
    } catch (e) {
      console.error('Failed to save fields to storage:', e);
      return false;
    }
  },

  loadTemplate(): InvoiceTemplate {
    const defaultTemplate: InvoiceTemplate = {
      id: 'modern-clean-v1',
      name: 'Modern Corporate Clean',
      isDefault: true,
      orientation: 'portrait',
      primaryColor: '#0f172a',
      fontFamily: 'Inter',
      showSections: {
        companyHeader: true,
        invoiceDetails: true,
        billTo: true,
        subject: true,
        itemTable: true,
        taxSummary: true,
        amountInWords: true,
        paymentSummary: true,
        notes: true,
        bankDetails: true,
        signature: true,
        terms: true,
        footer: true
      },
      labels: {
        invoice_title: 'TAX INVOICE',
        bill_to: 'Billed To (Customer Details):',
        subtotal: 'Subtotal'
      }
    };

    try {
      const data = safeGetItem(STORAGE_KEYS.TEMPLATE);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          ...defaultTemplate,
          ...parsed,
          showSections: { ...defaultTemplate.showSections, ...(parsed.showSections || {}) },
          labels: { ...defaultTemplate.labels, ...(parsed.labels || {}) }
        };
      }
    } catch (e) {
      console.warn('Failed to load template from storage:', e);
    }
    return defaultTemplate;
  },

  saveTemplate(template: InvoiceTemplate): boolean {
    try {
      safeSetItem(STORAGE_KEYS.TEMPLATE, JSON.stringify(template));
      return true;
    } catch (e) {
      console.error('Failed to save template to storage:', e);
      return false;
    }
  },

  loadHistory(): GenerationRecord[] {
    try {
      const data = safeGetItem(STORAGE_KEYS.HISTORY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed.map((rec: GenerationRecord) => {
            const rf = rec.dataSnapshot?.rowFields || {};
            return {
              ...rec,
              paymentMethod: rec.paymentMethod || rf['payment_method'] || 'UPI',
              paymentStatus: rec.paymentStatus || rf['payment_status'] || 'Paid',
              paymentDate: rec.paymentDate || rf['payment_date'] || rec.generatedDate,
              paymentReference: rec.paymentReference || rf['payment_reference'] || '',
              paymentAmount: rec.paymentAmount !== undefined ? rec.paymentAmount : Number(rf['amount_paid'] || rec.totalAmount || 0),
              paymentNotes: rec.paymentNotes || rf['payment_notes'] || ''
            };
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load history from storage:', e);
    }
    return [];
  },

  saveHistory(records: GenerationRecord[]): boolean {
    try {
      safeSetItem(STORAGE_KEYS.HISTORY, JSON.stringify(records));
      return true;
    } catch (e) {
      console.error('Failed to save history to storage:', e);
      return false;
    }
  },

  loadSpreadsheetData(): SpreadsheetData {
    try {
      const data = safeGetItem(STORAGE_KEYS.SPREADSHEET);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.worksheets) && parsed.worksheets.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load spreadsheet data from storage:', e);
    }
    return sampleSpreadsheetData;
  },

  saveSpreadsheetData(data: SpreadsheetData): boolean {
    try {
      safeSetItem(STORAGE_KEYS.SPREADSHEET, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Failed to save spreadsheet data to storage:', e);
      return false;
    }
  },

  loadCalculationSettings(): CalculationSettings {
    try {
      const data = safeGetItem(STORAGE_KEYS.CALCULATION);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          ...defaultCalculationSettings,
          ...parsed
        };
      }
    } catch (e) {
      console.warn('Failed to load calculation settings from storage:', e);
    }
    return defaultCalculationSettings;
  },

  saveCalculationSettings(settings: CalculationSettings): boolean {
    try {
      safeSetItem(STORAGE_KEYS.CALCULATION, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.error('Failed to save calculation settings to storage:', e);
      return false;
    }
  },

  loadWorkflowSession(): WorkflowSessionState | null {
    try {
      const data = safeGetItem(STORAGE_KEYS.WORKFLOW_SESSION);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && parsed.currentStep) {
          return {
            currentStep: parsed.currentStep || 'source',
            completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps : [],
            selectedWorksheetName: parsed.selectedWorksheetName || '',
            headerRowIndex: typeof parsed.headerRowIndex === 'number' ? parsed.headerRowIndex : 0,
            startRowIndex: typeof parsed.startRowIndex === 'number' ? parsed.startRowIndex : 0,
            endRowIndex: parsed.endRowIndex,
            amountSettings: { ...defaultAdvancedAmountSettings, ...(parsed.amountSettings || {}) },
            gstSettings: { ...defaultGstSettings, ...(parsed.gstSettings || {}) },
            customEditedRows: parsed.customEditedRows || {},
            updatedAt: parsed.updatedAt || new Date().toISOString()
          };
        }
      }
    } catch (e) {
      console.warn('Failed to load workflow session from storage:', e);
    }
    return null;
  },

  saveWorkflowSession(session: WorkflowSessionState): boolean {
    try {
      safeSetItem(STORAGE_KEYS.WORKFLOW_SESSION, JSON.stringify(session));
      return true;
    } catch (e) {
      console.error('Failed to save workflow session to storage:', e);
      return false;
    }
  },

  clearWorkflowSession(): boolean {
    try {
      safeRemoveItem(STORAGE_KEYS.WORKFLOW_SESSION);
      return true;
    } catch (e) {
      console.error('Failed to clear workflow session:', e);
      return false;
    }
  },

  loadSavedTemplates(): Array<{ id: string; name: string; description: string; mappings: Record<string, string>; amountSettings?: any; gstSettings?: any; updatedAt: string }> {
    try {
      const data = safeGetItem(STORAGE_KEYS.SAVED_TEMPLATES);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load saved templates:', e);
    }
    return [];
  },

  saveMappingTemplate(template: { id?: string; name: string; description?: string; mappings?: Record<string, string>; fields?: any[]; amountSettings?: any; gstSettings?: any }): boolean {
    try {
      const current = this.loadSavedTemplates();
      // Support both mappings record or array of fields
      let mappingsRecord: Record<string, string> = template.mappings || {};
      if (Array.isArray(template.fields)) {
        template.fields.forEach(f => {
          if (f.key || f.id) {
            mappingsRecord[f.key || f.id] = f.mappedColumn || f.sourceColumn || '';
          }
        });
      }

      const newTemplate = {
        id: template.id || `template_${Date.now()}`,
        name: template.name,
        description: template.description || '',
        mappings: mappingsRecord,
        amountSettings: template.amountSettings,
        gstSettings: template.gstSettings,
        updatedAt: new Date().toISOString()
      };
      const filtered = current.filter(t => t.id !== newTemplate.id && t.name !== newTemplate.name);
      safeSetItem(STORAGE_KEYS.SAVED_TEMPLATES, JSON.stringify([newTemplate, ...filtered]));
      return true;
    } catch (e) {
      console.error('Failed to save mapping template:', e);
      return false;
    }
  }
};
