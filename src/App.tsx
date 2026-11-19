/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import { defaultMappingProfiles, sampleSpreadsheetData } from './mockData';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
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
import { storage } from './utils/storage';
import {
  fetchAuthStatus,
  fetchPersistedGoogleSheets,
  GoogleAccountUser,
  IntegrationDiagnostics,
  syncedPayloadToSpreadsheetData,
} from './utils/googleSheets';
import { workspaceApi } from './utils/workspaceApi';
import { useFirebase } from './components/FirebaseProvider';
import {
  convertQuotationAtomicallyInFirestore,
  deleteInvoiceFromFirestore,
  deleteQuotationFromFirestore,
  saveCustomerToFirestore,
  saveEmailLogToFirestore,
  saveInvoiceToFirestore,
  saveQuotationToFirestore,
  saveWorkspaceSettingsToFirestore,
  subscribeToUserWorkspace,
} from './utils/firebaseSync';

const VALID_TABS = new Set([
  'dashboard',
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

  // Firebase Auth & Cloud Firestore state
  const {
    firebaseUser,
    isAuthReady,
    markCloudSynced,
    setCloudSyncState,
  } = useFirebase();

  // Multi-user Auth, Integrations & Onboarding state
  const [authUser, setAuthUser] = useState<GoogleAccountUser | null>(null);
  const [diagnostics, setDiagnostics] = useState<IntegrationDiagnostics | null>(null);
  const [smtpConfig, setSmtpConfig] = useState<BackendSmtpConfig>(DEFAULT_SMTP_CONFIG);
  const [showAuthGate, setShowAuthGate] = useState<boolean>(
    () => !shouldSkipInitialAuthGate()
  );
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  // Unified user identity: merges backend OAuth workspace user with active Firebase Auth user
  const effectiveAuthUser: GoogleAccountUser | null = authUser
    ? authUser
    : firebaseUser
      ? {
          userId: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || firebaseUser.email || 'Google User',
          picture: firebaseUser.photoURL || null,
          driveConnected: false,
          sheetsConnected: false,
          gmailConnected: false,
          smtpConfigured: false,
          onboardingCompleted: true,
        }
      : null;

  // Cross-tab handoff state
  const [preselectedEmailRecordId, setPreselectedEmailRecordId] = useState<string | null>(null);
  const [preselectedEmailQuotationId, setPreselectedEmailQuotationId] = useState<string | null>(
    null
  );
  const [incomingConvertedInvoice, setIncomingConvertedInvoice] =
    useState<ManualInvoiceData | null>(null);

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
        setAuthUser(status.user);
        setShowAuthGate(false);

        // Hydrate strictly isolated per-user cloud workspace
        try {
          const ws = await workspaceApi.fetchWorkspace();
          if (ws.workspace?.companySettings) {
            setCompany(ws.workspace.companySettings);
            storage.saveCompanySettings(ws.workspace.companySettings);
          }
          if (ws.workspace?.template) {
            setTemplate(ws.workspace.template);
            storage.saveTemplate(ws.workspace.template);
          }
          if (Array.isArray(ws.workspace?.fields) && ws.workspace.fields.length > 0) {
            setFields(ws.workspace.fields);
            storage.saveFields(ws.workspace.fields);
          }
          if (ws.workspace?.calculationSettings) {
            setCalculationSettings(ws.workspace.calculationSettings);
            storage.saveCalculationSettings(ws.workspace.calculationSettings);
          }
          setCustomers(ws.customers || []);
          setQuotations(ws.quotations || []);
          storage.saveQuotations(ws.quotations || []);
          setGenerationHistory(ws.invoices || []);
          storage.saveHistory(ws.invoices || []);
          setSmtpConfig(ws.smtpConfig || DEFAULT_SMTP_CONFIG);
          setEmailLogs(ws.emailLogs || []);
          storage.saveEmailLogs(ws.emailLogs || []);
          setShowOnboarding(!ws.onboardingCompleted);
        } catch {
          // Keep current state if workspace endpoint fails transiently
        }

        // Hydrate user's persisted Google Sheets
        try {
          const res = await fetchPersistedGoogleSheets();
          if (res?.spreadsheet && res.spreadsheet.totalRows > 0) {
            const hydrated = syncedPayloadToSpreadsheetData(res.spreadsheet);
            setSpreadsheetData((prev) => {
              const isDefaultOrEmpty =
                prev.fileName === sampleSpreadsheetData.fileName ||
                prev.fileName === 'No file uploaded' ||
                prev.fileName.toLowerCase().endsWith('.gsheet') ||
                prev.worksheets.length === 0;
              if (!isDefaultOrEmpty) return prev;
              storage.saveSpreadsheetData(hydrated);
              return hydrated;
            });
          }
        } catch {
          // Silent when no synced spreadsheet exists yet
        }
      } else {
        setAuthUser(null);
        setSmtpConfig(DEFAULT_SMTP_CONFIG);
        setShowOnboarding(false);
      }
    } catch {
      // Offline / local preview fallback
    }
  }, []);

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

  // Real-time Cloud Firestore listeners (attached strictly after auth is ready & user is signed in)
  useEffect(() => {
    if (!isAuthReady || !firebaseUser) {
      return;
    }
    setShowAuthGate(false);

    const unsubscribe = subscribeToUserWorkspace(firebaseUser.uid, {
      onWorkspaceSettings: (ws) => {
        if (ws.companySettings) {
          setCompany(ws.companySettings);
          storage.saveCompanySettings(ws.companySettings);
        }
        if (ws.template) {
          setTemplate(ws.template);
          storage.saveTemplate(ws.template);
        }
        if (ws.calculationSettings) {
          setCalculationSettings(ws.calculationSettings);
          storage.saveCalculationSettings(ws.calculationSettings);
        }
        if (ws.fields && ws.fields.length > 0) {
          setFields(ws.fields);
          storage.saveFields(ws.fields);
        }
      },
      onCustomers: (remoteCustomers) => {
        if (remoteCustomers.length > 0) {
          setCustomers(remoteCustomers);
          storage.saveCustomers(remoteCustomers);
        }
      },
      onQuotations: (remoteQuotations) => {
        if (remoteQuotations.length > 0) {
          setQuotations(remoteQuotations);
          storage.saveQuotations(remoteQuotations);
        }
      },
      onInvoices: (remoteInvoices) => {
        if (remoteInvoices.length > 0) {
          setGenerationHistory(remoteInvoices);
          storage.saveHistory(remoteInvoices);
        }
      },
      onEmailLogs: (remoteLogs) => {
        if (remoteLogs.length > 0) {
          setEmailLogs(remoteLogs);
          storage.saveEmailLogs(remoteLogs);
        }
      },
      onSyncActivity: () => {
        markCloudSynced();
      },
      onError: () => {
        setCloudSyncState('error');
      },
    });

    return () => {
      unsubscribe();
    };
  }, [isAuthReady, firebaseUser, markCloudSynced, setCloudSyncState]);

  const handleSyncLocalWorkspaceToFirestore = useCallback(async () => {
    if (!firebaseUser) {
      throw new Error('Sign in with Google (Firebase) first to sync your workspace to Cloud Firestore.');
    }
    await saveWorkspaceSettingsToFirestore(
      firebaseUser.uid,
      company,
      template,
      calculationSettings,
      fields
    );
    for (const customer of customers) {
      await saveCustomerToFirestore(firebaseUser.uid, customer);
    }
    for (const quotation of quotations) {
      await saveQuotationToFirestore(firebaseUser.uid, quotation);
    }
    for (const invoice of generationHistory) {
      await saveInvoiceToFirestore(firebaseUser.uid, invoice);
    }
    for (const log of emailLogs) {
      await saveEmailLogToFirestore(firebaseUser.uid, log);
    }
    markCloudSynced();
  }, [
    firebaseUser,
    company,
    template,
    calculationSettings,
    fields,
    customers,
    quotations,
    generationHistory,
    emailLogs,
    markCloudSynced,
  ]);

  const handleContinueLocalPreview = () => {
    try {
      window.sessionStorage.setItem('invoice_studio_local_preview', '1');
    } catch {
      // Ignore storage error
    }
    setShowAuthGate(false);
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
      if (firebaseUser) {
        const prevIds = new Set(prev.map((l) => l.id));
        const added = next.filter((l) => !prevIds.has(l.id));
        for (const entry of added) {
          void saveEmailLogToFirestore(firebaseUser.uid, entry).catch(() => {});
        }
      }
      return next;
    });
  };

  const handleUpdateQuotations = (action: React.SetStateAction<QuotationRecord[]>) => {
    setQuotations((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveQuotations(next);
      if (firebaseUser) {
        const prevMap = new Map(prev.map((q) => [q.id, q]));
        const nextIds = new Set(next.map((q) => q.id));
        for (const q of next) {
          const old = prevMap.get(q.id);
          if ((!old || old.updatedAt !== q.updatedAt) && q.status !== 'Converted to Invoice') {
            void saveQuotationToFirestore(firebaseUser.uid, q).catch(() => {});
          }
        }
        for (const old of prev) {
          if (!nextIds.has(old.id) && old.status !== 'Converted to Invoice') {
            void deleteQuotationFromFirestore(firebaseUser.uid, old.id).catch(() => {});
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
    if (firebaseUser) {
      void saveWorkspaceSettingsToFirestore(
        firebaseUser.uid,
        company,
        template,
        settings,
        fields
      ).catch(() => {});
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
    if (firebaseUser) {
      void saveWorkspaceSettingsToFirestore(
        firebaseUser.uid,
        updatedCompany,
        template,
        calculationSettings,
        nextFields || fields
      ).catch(() => {});
    }
  };

  const handleUpdateFields = (action: React.SetStateAction<InvoiceFieldConfig[]>) => {
    setFields((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveFields(next);
      if (authUser?.userId) {
        void workspaceApi.saveWorkspace({ fields: next }).catch(() => {});
      }
      if (firebaseUser) {
        void saveWorkspaceSettingsToFirestore(
          firebaseUser.uid,
          company,
          template,
          calculationSettings,
          next
        ).catch(() => {});
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
      if (firebaseUser) {
        void saveWorkspaceSettingsToFirestore(
          firebaseUser.uid,
          company,
          next,
          calculationSettings,
          fields
        ).catch(() => {});
      }
      return next;
    });
  };

  const handleUpdateHistory = (action: React.SetStateAction<GenerationRecord[]>) => {
    setGenerationHistory((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveHistory(next);
      if (firebaseUser) {
        const prevMap = new Map(prev.map((r) => [r.id, r]));
        const nextIds = new Set(next.map((r) => r.id));
        for (const rec of next) {
          const old = prevMap.get(rec.id);
          if (!old || old.updatedAt !== rec.updatedAt || old.revisionNumber !== rec.revisionNumber) {
            void saveInvoiceToFirestore(firebaseUser.uid, rec).catch(() => {});
          }
        }
        for (const old of prev) {
          if (!nextIds.has(old.id)) {
            void deleteInvoiceFromFirestore(firebaseUser.uid, old.id).catch(() => {});
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
    if (firebaseUser) {
      void saveInvoiceToFirestore(firebaseUser.uid, record).catch(() => {});
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
    if (firebaseUser) {
      void convertQuotationAtomicallyInFirestore(
        firebaseUser.uid,
        updatedQuotation,
        createdInvoice
      ).catch(() => {});
    }
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

  if (showAuthGate && !effectiveAuthUser) {
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
        authUser={effectiveAuthUser}
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
            authUser={effectiveAuthUser}
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
            onNavigateTab={setActiveTab}
            onSyncLocalToFirestore={handleSyncLocalWorkspaceToFirestore}
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
            authUser={effectiveAuthUser}
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
