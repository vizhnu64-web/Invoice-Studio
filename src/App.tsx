/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackendSmtpConfig,
  CalculationSettings,
  CompanySettings,
  CustomerRecord,
  EmailDeliveryLogEntry,
  GenerationRecord,
  GuidedWorkflowStep,
  InvoiceFieldConfig,
  InvoiceTemplate,
  ManualInvoiceData,
  MappingProfile,
  QuotationRecord,
  SpreadsheetData,
} from './types';
import {
  defaultCalculationSettings,
  defaultCompanySettings,
  defaultFieldCatalog,
  defaultMappingProfiles,
} from './mockData';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { CustomersView } from './components/CustomersView';
import { FieldCatalogView } from './components/FieldCatalogView';
import { DataSourceView } from './components/DataSourceView';
import { LayoutDesigner } from './components/LayoutDesigner';
import { GenerationCenter } from './components/GenerationCenter';
import { HistoryView } from './components/HistoryView';
import { CompanySettingsView } from './components/CompanySettingsView';
import { EmailCenterView } from './components/EmailCenterView';
import { ManualEntryView } from './components/ManualEntryView';
import { QuotationGeneratorView } from './components/QuotationGeneratorView';
import { GoogleIntegrationsView } from './components/GoogleIntegrationsView';
import {
  AuthGateScreen,
  OnboardingWizardModal,
} from './components/AuthOnboardingOverlay';
import { GuidedWorkflow } from './components/workflow/GuidedWorkflow';
import { EmailSendStatus } from './utils/emailService';
import { EMPTY_SPREADSHEET_DATA, storage } from './utils/storage';
import {
  fetchAuthStatus,
  fetchPersistedGoogleSheets,
  GoogleAccountUser,
  IntegrationDiagnostics,
  syncedPayloadToSpreadsheetData,
} from './utils/googleSheets';
import { workspaceApi } from './utils/workspaceApi';

const VALID_TABS = new Set([
  'dashboard',
  'customers',
  'workflow',
  'fields',
  'datasource',
  'manual',
  'quotations',
  'designer',
  'generation',
  'history',
  'email',
  'company',
  'integrations',
]);

const DEFAULT_SMTP_CONFIG: BackendSmtpConfig = {
  configured: false,
  host: '',
  port: 587,
  securityMode: 'STARTTLS',
  username: '',
  hasPassword: false,
  senderName: '',
  senderEmail: '',
  verifiedAt: null,
};

function readTabFromHash(): string {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_TABS.has(raw) ? raw : 'dashboard';
}

function shouldSkipInitialAuthGate(): boolean {
  if (typeof window === 'undefined') return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1' || params.has('google_auth')) {
    return true;
  }
  try {
    if (window.sessionStorage.getItem('invoice_studio_local_preview') === '1') {
      return true;
    }
  } catch {
    // Ignore storage access restrictions
  }
  return false;
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<string>(() => readTabFromHash());
  const [company, setCompany] = useState<CompanySettings>(() => storage.loadCompanySettings());
  const [fields, setFields] = useState<InvoiceFieldConfig[]>(() =>
    storage.loadFields(storage.loadCompanySettings())
  );
  const [mappingProfiles] = useState<MappingProfile[]>(defaultMappingProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string>('profile_tbt90days');
  const [spreadsheetData, setSpreadsheetData] = useState<SpreadsheetData>(() =>
    storage.loadSpreadsheetData()
  );
  const [generationHistory, setGenerationHistory] = useState<GenerationRecord[]>(() =>
    storage.loadHistory()
  );
  const [quotations, setQuotations] = useState<QuotationRecord[]>(() =>
    storage.loadQuotations()
  );
  const [customers, setCustomers] = useState<CustomerRecord[]>(() =>
    storage.loadCustomers()
  );
  const [template, setTemplate] = useState<InvoiceTemplate>(() => storage.loadTemplate());
  const [calculationSettings, setCalculationSettings] = useState<CalculationSettings>(() =>
    storage.loadCalculationSettings()
  );
  const [emailStatuses, setEmailStatuses] = useState<Record<string, EmailSendStatus>>(() =>
    storage.loadEmailStatuses()
  );
  const [emailLogs, setEmailLogs] = useState<EmailDeliveryLogEntry[]>(() =>
    storage.loadEmailLogs()
  );

  // Google OAuth + Google Drive Workspace state
  const [authUser, setAuthUser] = useState<GoogleAccountUser | null>(null);
  const [diagnostics, setDiagnostics] = useState<IntegrationDiagnostics | null>(null);
  const [smtpConfig, setSmtpConfig] = useState<BackendSmtpConfig>(DEFAULT_SMTP_CONFIG);
  const [showAuthGate, setShowAuthGate] = useState<boolean>(
    () => !shouldSkipInitialAuthGate()
  );
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const activeUserIdRef = useRef<string | null>(null);

  // Cross-tab handoff state
  const [preselectedEmailRecordId, setPreselectedEmailRecordId] = useState<string | null>(null);
  const [preselectedEmailQuotationId, setPreselectedEmailQuotationId] = useState<string | null>(
    null
  );
  const [incomingConvertedInvoice, setIncomingConvertedInvoice] =
    useState<ManualInvoiceData | null>(null);

  const resetWorkspaceToCleanDefaults = useCallback(() => {
    setCompany(defaultCompanySettings);
    setFields(defaultFieldCatalog);
    setTemplate(storage.loadTemplate());
    setCalculationSettings(defaultCalculationSettings);
    setSpreadsheetData(EMPTY_SPREADSHEET_DATA);
    setGenerationHistory([]);
    setQuotations([]);
    setCustomers([]);
    setEmailStatuses({});
    setEmailLogs([]);
    setSmtpConfig(DEFAULT_SMTP_CONFIG);
    setShowOnboarding(false);
    setPreselectedEmailRecordId(null);
    setPreselectedEmailQuotationId(null);
    setIncomingConvertedInvoice(null);
  }, []);

  const handleSignOutComplete = useCallback(() => {
    storage.clearAllUserWorkspaceCaches();
    storage.setActiveStorageUser(null);
    activeUserIdRef.current = null;
    setAuthUser(null);
    resetWorkspaceToCleanDefaults();
  }, [resetWorkspaceToCleanDefaults]);

  const setActiveTab = useCallback((tab: string) => {
    const target = VALID_TABS.has(tab) ? tab : 'dashboard';
    setActiveTabState(target);
    if (typeof window !== 'undefined') {
      const nextHash = `#/${target}`;
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
    }
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTabState(readTabFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const refreshAuthAndWorkspace = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setDiagnostics(status.diagnostics || null);

      if (status.authenticated && status.user) {
        const nextUid = status.user.userId || status.user.email;
        const switchedAccount =
          activeUserIdRef.current !== null && activeUserIdRef.current !== nextUid;

        if (switchedAccount) {
          storage.clearAllUserWorkspaceCaches();
          resetWorkspaceToCleanDefaults();
        }

        activeUserIdRef.current = nextUid;
        storage.setActiveStorageUser(nextUid);
        setAuthUser(status.user);
        setShowAuthGate(false);

        // Hydrate strictly isolated per-user workspace from Google Drive
        try {
          const ws = await workspaceApi.fetchWorkspace();
          if (ws.workspace?.companySettings) {
            setCompany(ws.workspace.companySettings);
            storage.saveCompanySettings(ws.workspace.companySettings);
          } else {
            setCompany(defaultCompanySettings);
          }
          if (ws.workspace?.template) {
            setTemplate(ws.workspace.template);
            storage.saveTemplate(ws.workspace.template);
          }
          if (Array.isArray(ws.workspace?.fields) && ws.workspace.fields.length > 0) {
            setFields(ws.workspace.fields);
            storage.saveFields(ws.workspace.fields);
          } else {
            setFields(defaultFieldCatalog);
          }
          if (ws.workspace?.calculationSettings) {
            setCalculationSettings(ws.workspace.calculationSettings);
            storage.saveCalculationSettings(ws.workspace.calculationSettings);
          } else {
            setCalculationSettings(defaultCalculationSettings);
          }
          const remoteCustomers = ws.customers || [];
          const remoteQuotations = ws.quotations || [];
          const remoteInvoices = ws.invoices || [];
          const remoteEmailLogs = ws.emailLogs || [];

          setCustomers(remoteCustomers);
          storage.saveCustomers(remoteCustomers);
          setQuotations(remoteQuotations);
          storage.saveQuotations(remoteQuotations);
          setGenerationHistory(remoteInvoices);
          storage.saveHistory(remoteInvoices);
          setSmtpConfig(ws.smtpConfig || DEFAULT_SMTP_CONFIG);
          setEmailLogs(remoteEmailLogs);
          storage.saveEmailLogs(remoteEmailLogs);
          setShowOnboarding(!ws.onboardingCompleted);
        } catch {
          // Keep current state if Drive read fails transiently
        }

        // Hydrate user's persisted Google Sheets metadata/data from Drive
        try {
          const res = await fetchPersistedGoogleSheets();
          if (res?.spreadsheet && res.spreadsheet.totalRows > 0) {
            const hydrated = syncedPayloadToSpreadsheetData(res.spreadsheet);
            setSpreadsheetData(hydrated);
            storage.saveSpreadsheetData(hydrated);
          } else if (switchedAccount) {
            setSpreadsheetData(EMPTY_SPREADSHEET_DATA);
          }
        } catch {
          // Silent when no synced spreadsheet exists yet
        }
      } else {
        if (activeUserIdRef.current !== null) {
          storage.clearAllUserWorkspaceCaches();
          storage.setActiveStorageUser(null);
          activeUserIdRef.current = null;
          resetWorkspaceToCleanDefaults();
        }
        setAuthUser(null);
        setSmtpConfig(DEFAULT_SMTP_CONFIG);
        setShowOnboarding(false);
      }
    } catch {
      // Offline / local preview fallback
    }
  }, [resetWorkspaceToCleanDefaults]);

  useEffect(() => {
    void refreshAuthAndWorkspace();

    // Clean OAuth redirect query params after full-page OAuth callback
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('google_auth')) {
        params.delete('google_auth');
        params.delete('feature');
        params.delete('google_auth_error');
        const cleaned = params.toString();
        const nextUrl = `${window.location.pathname}${cleaned ? `?${cleaned}` : ''}${
          window.location.hash
        }`;
        window.history.replaceState({}, '', nextUrl);
      }
    }
  }, [refreshAuthAndWorkspace]);

  const handleContinueLocalPreview = () => {
    try {
      window.sessionStorage.setItem('invoice_studio_local_preview', '1');
    } catch {
      // Ignore storage error
    }
    setShowAuthGate(false);
  };

  const handleSaveCustomer = async (customer: CustomerRecord) => {
    setCustomers((prev) => {
      const filtered = prev.filter((c) => c.id !== customer.id);
      const next = [customer, ...filtered];
      storage.saveCustomers(next);
      return next;
    });
    if (authUser?.userId) {
      await workspaceApi.saveCustomer(customer);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    setCustomers((prev) => {
      const next = prev.filter((c) => c.id !== customerId);
      storage.saveCustomers(next);
      return next;
    });
    if (authUser?.userId) {
      await workspaceApi.deleteCustomer(customerId);
    }
  };

  const handleSyncWorkspaceSnapshot = async () => {
    return workspaceApi.syncDrive({
      companySettings: company,
      template,
      fields,
      calculationSettings,
      customers,
      quotations,
      invoices: generationHistory,
      emailLogs,
    });
  };

  const handleUpdateEmailStatuses = (
    action: React.SetStateAction<Record<string, EmailSendStatus>>
  ) => {
    setEmailStatuses((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveEmailStatuses(next);
      return next;
    });
  };

  const handleUpdateEmailLogs = (action: React.SetStateAction<EmailDeliveryLogEntry[]>) => {
    setEmailLogs((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveEmailLogs(next);
      return next;
    });
  };

  const handleUpdateQuotations = (action: React.SetStateAction<QuotationRecord[]>) => {
    setQuotations((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveQuotations(next);
      if (authUser?.userId) {
        const prevMap = new Map(prev.map((q) => [q.id, q]));
        const nextIds = new Set(next.map((q) => q.id));
        for (const q of next) {
          const old = prevMap.get(q.id);
          if ((!old || old.updatedAt !== q.updatedAt) && q.status !== 'Converted to Invoice') {
            void workspaceApi.saveQuotation(q).catch(() => {});
          }
        }
        for (const old of prev) {
          if (!nextIds.has(old.id) && old.status !== 'Converted to Invoice') {
            void workspaceApi.deleteQuotation(old.id).catch(() => {});
          }
        }
      }
      return next;
    });
  };

  const handleStartGuidedWorkflow = (step?: GuidedWorkflowStep) => {
    if (step) {
      const currentSession = storage.loadWorkflowSession();
      if (currentSession) {
        storage.saveWorkflowSession({
          ...currentSession,
          currentStep: step,
        });
      }
    }
    setActiveTab('workflow');
  };

  const handleUpdateCalculationSettings = (settings: CalculationSettings) => {
    setCalculationSettings(settings);
    storage.saveCalculationSettings(settings);
    if (authUser?.userId) {
      void workspaceApi.saveWorkspace({ calculationSettings: settings }).catch(() => {});
    }
  };

  const handleUpdateCompany = (updatedCompany: CompanySettings) => {
    setCompany(updatedCompany);
    storage.saveCompanySettings(updatedCompany);
    let nextFields: InvoiceFieldConfig[] | null = null;
    setFields((prev) => {
      const updated = prev.map((f) => {
        if (f.id === 'company_legal_name')
          return { ...f, value: updatedCompany.legalName, defaultValue: updatedCompany.legalName };
        if (f.id === 'company_address') {
          const addr = `${updatedCompany.addressLine1}${
            updatedCompany.addressLine2 ? ', ' + updatedCompany.addressLine2 : ''
          }, ${updatedCompany.city}, ${updatedCompany.state} - ${updatedCompany.pinCode}`;
          return { ...f, value: addr, defaultValue: addr };
        }
        if (f.id === 'company_gstin')
          return { ...f, value: updatedCompany.gstin, defaultValue: updatedCompany.gstin };
        if (f.id === 'company_email')
          return { ...f, value: updatedCompany.email, defaultValue: updatedCompany.email };
        return f;
      });
      storage.saveFields(updated);
      nextFields = updated;
      return updated;
    });
    if (authUser?.userId) {
      void workspaceApi
        .saveWorkspace({
          companySettings: updatedCompany,
          ...(nextFields ? { fields: nextFields } : {}),
        })
        .catch(() => {});
    }
  };

  const handleUpdateFields = (action: React.SetStateAction<InvoiceFieldConfig[]>) => {
    setFields((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveFields(next);
      if (authUser?.userId) {
        void workspaceApi.saveWorkspace({ fields: next }).catch(() => {});
      }
      return next;
    });
  };

  const handleUpdateTemplate = (action: React.SetStateAction<InvoiceTemplate>) => {
    setTemplate((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveTemplate(next);
      if (authUser?.userId) {
        void workspaceApi.saveWorkspace({ template: next }).catch(() => {});
      }
      return next;
    });
  };

  const handleUpdateHistory = (action: React.SetStateAction<GenerationRecord[]>) => {
    setGenerationHistory((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveHistory(next);
      if (authUser?.userId) {
        const prevMap = new Map(prev.map((r) => [r.id, r]));
        const nextIds = new Set(next.map((r) => r.id));
        for (const rec of next) {
          const old = prevMap.get(rec.id);
          if (!old || old.updatedAt !== rec.updatedAt || old.revisionNumber !== rec.revisionNumber) {
            void workspaceApi.saveInvoice(rec).catch(() => {});
          }
        }
        for (const old of prev) {
          if (!nextIds.has(old.id)) {
            void workspaceApi.deleteInvoice(old.id).catch(() => {});
          }
        }
      }
      return next;
    });
  };

  const handlePersistSingleInvoice = (record: GenerationRecord) => {
    if (authUser?.userId) {
      void workspaceApi.saveInvoice(record).catch(() => {});
    }
  };

  const handleUpdateSpreadsheetData = (action: React.SetStateAction<SpreadsheetData>) => {
    setSpreadsheetData((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveSpreadsheetData(next);
      return next;
    });
  };

  const handleSendManualInvoiceByEmail = (recordId: string) => {
    setPreselectedEmailQuotationId(null);
    setPreselectedEmailRecordId(recordId);
    setActiveTab('email');
  };

  const handleEmailQuotation = (quotationId: string) => {
    setPreselectedEmailRecordId(null);
    setPreselectedEmailQuotationId(quotationId);
    setActiveTab('email');
  };

  const handleConvertedToInvoice = (
    updatedQuotation: QuotationRecord,
    createdInvoice: GenerationRecord,
    manualInvoiceData: ManualInvoiceData
  ) => {
    setQuotations((prev) => {
      const next = prev.map((q) => (q.id === updatedQuotation.id ? updatedQuotation : q));
      storage.saveQuotations(next);
      return next;
    });
    setGenerationHistory((prev) => {
      const next = [createdInvoice, ...prev];
      storage.saveHistory(next);
      return next;
    });
    setIncomingConvertedInvoice(manualInvoiceData);
    setActiveTab('manual');
  };

  const handleConsumeIncomingInvoice = useCallback(() => {
    setIncomingConvertedInvoice(null);
  }, []);

  const totalRecordsCount = spreadsheetData.worksheets.reduce(
    (acc, ws) => acc + ws.rows.length,
    0
  );

  if (showAuthGate && !authUser) {
    return (
      <AuthGateScreen
        diagnostics={diagnostics}
        onContinueLocalPreview={handleContinueLocalPreview}
        onSignedIn={refreshAuthAndWorkspace}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col selection:bg-indigo-600 selection:text-white">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeDataSourceName={spreadsheetData.fileName}
        totalRecordsCount={totalRecordsCount}
        onStartGuidedWorkflow={() => handleStartGuidedWorkflow('source')}
        authUser={authUser}
        onOpenAuthGate={() => setShowAuthGate(true)}
      />

      {showOnboarding && authUser && (
        <OnboardingWizardModal
          authUser={authUser}
          company={company}
          onUpdateCompany={handleUpdateCompany}
          onRefreshAuth={refreshAuthAndWorkspace}
          onFinishOnboarding={async () => {
            setShowOnboarding(false);
            await refreshAuthAndWorkspace();
          }}
        />
      )}

      <main className="flex-1 pb-16">
        {activeTab === 'dashboard' && (
          <DashboardView
            setActiveTab={setActiveTab}
            spreadsheetData={spreadsheetData}
            setSpreadsheetData={handleUpdateSpreadsheetData}
            generationHistory={generationHistory}
            company={company}
            onStartGuidedWorkflow={handleStartGuidedWorkflow}
          />
        )}
        {activeTab === 'customers' && (
          <CustomersView
            customers={customers}
            onSaveCustomer={handleSaveCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            isCloudConnected={Boolean(authUser?.driveConnected)}
          />
        )}
        {activeTab === 'manual' && (
          <ManualEntryView
            company={company}
            fields={fields}
            template={template}
            generationHistory={generationHistory}
            setGenerationHistory={handleUpdateHistory}
            onNavigateTab={setActiveTab}
            onSendByEmail={handleSendManualInvoiceByEmail}
            incomingConvertedInvoice={incomingConvertedInvoice}
            onConsumeIncomingInvoice={handleConsumeIncomingInvoice}
            onInvoiceSaved={handlePersistSingleInvoice}
          />
        )}
        {activeTab === 'quotations' && (
          <QuotationGeneratorView
            company={company}
            template={template}
            fields={fields}
            customers={customers}
            quotations={quotations}
            setQuotations={handleUpdateQuotations}
            generationHistory={generationHistory}
            authUser={authUser}
            onConvertedToInvoice={handleConvertedToInvoice}
            onEmailQuotation={handleEmailQuotation}
            onNavigateTab={setActiveTab}
          />
        )}
        {activeTab === 'integrations' && (
          <GoogleIntegrationsView
            authUser={authUser}
            diagnostics={diagnostics}
            smtpConfig={smtpConfig}
            setSmtpConfig={setSmtpConfig}
            onRefreshAuthAndWorkspace={refreshAuthAndWorkspace}
            onSignOutComplete={handleSignOutComplete}
            onSyncWorkspaceSnapshot={handleSyncWorkspaceSnapshot}
            onNavigateTab={setActiveTab}
            localCounts={{
              quotations: quotations.length,
              invoices: generationHistory.length,
              customers: customers.length,
              emailLogs: emailLogs.length,
            }}
          />
        )}
        {activeTab === 'workflow' && (
          <GuidedWorkflow
            company={company}
            fields={fields}
            setFields={handleUpdateFields}
            template={template}
            spreadsheetData={spreadsheetData}
            setSpreadsheetData={handleUpdateSpreadsheetData}
            calculationSettings={calculationSettings}
            setCalculationSettings={handleUpdateCalculationSettings}
            onExitWorkflow={() => setActiveTab('dashboard')}
            onFinishToGenerator={() => setActiveTab('generation')}
          />
        )}
        {activeTab === 'fields' && (
          <FieldCatalogView
            fields={fields}
            setFields={handleUpdateFields}
            mappingProfiles={mappingProfiles}
            activeProfileId={activeProfileId}
            setActiveProfileId={setActiveProfileId}
            spreadsheetData={spreadsheetData}
            calculationSettings={calculationSettings}
            setCalculationSettings={handleUpdateCalculationSettings}
          />
        )}
        {activeTab === 'datasource' && (
          <DataSourceView
            spreadsheetData={spreadsheetData}
            setSpreadsheetData={handleUpdateSpreadsheetData}
          />
        )}
        {activeTab === 'designer' && (
          <LayoutDesigner
            template={template}
            setTemplate={handleUpdateTemplate}
            company={company}
          />
        )}
        {activeTab === 'generation' && (
          <GenerationCenter
            spreadsheetData={spreadsheetData}
            company={company}
            fields={fields}
            template={template}
            generationHistory={generationHistory}
            setGenerationHistory={handleUpdateHistory}
            calculationSettings={calculationSettings}
            setCalculationSettings={handleUpdateCalculationSettings}
          />
        )}
        {activeTab === 'history' && (
          <HistoryView
            generationHistory={generationHistory}
            setGenerationHistory={handleUpdateHistory}
            company={company}
            template={template}
            emailStatuses={emailStatuses}
            setEmailStatuses={handleUpdateEmailStatuses}
          />
        )}
        {activeTab === 'email' && (
          <EmailCenterView
            generationHistory={generationHistory}
            quotations={quotations}
            company={company}
            template={template}
            emailStatuses={emailStatuses}
            setEmailStatuses={handleUpdateEmailStatuses}
            emailLogs={emailLogs}
            setEmailLogs={handleUpdateEmailLogs}
            authUser={authUser}
            smtpConfig={smtpConfig}
            initialSelectedRecordId={preselectedEmailRecordId}
            initialSelectedQuotationId={preselectedEmailQuotationId}
            onNavigateTab={setActiveTab}
            onRefreshAuth={refreshAuthAndWorkspace}
          />
        )}
        {activeTab === 'company' && (
          <CompanySettingsView
            company={company}
            setCompany={handleUpdateCompany}
          />
        )}
      </main>
    </div>
  );
}
