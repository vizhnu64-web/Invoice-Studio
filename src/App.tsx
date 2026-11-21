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
  DriveWorkspaceConnection,
  EmailDeliveryLogEntry,
  GenerationRecord,
  GuidedWorkflowStep,
  IntegrationDiagnostics,
  InvoiceFieldConfig,
  InvoiceTemplate,
  ManualInvoiceData,
  MappingProfile,
  QuotationRecord,
  QuotationStatus,
  SpreadsheetData,
} from './types';
import {
  defaultCalculationSettings,
  defaultCompanySettings,
  defaultFieldCatalog,
  defaultMappingProfiles,
  defaultTemplates,
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
import { GuidedWorkflow } from './components/workflow/GuidedWorkflow';
import { EmailSendStatus } from './utils/emailService';
import { EMPTY_SPREADSHEET_DATA, storage } from './utils/storage';
import { fetchServerDiagnostics } from './utils/googleSheets';
import { DriveConnectResponse, workspaceApi } from './utils/workspaceApi';

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
  persistedInDrive: false,
  provider: 'gmail_smtp',
  host: 'smtp.gmail.com',
  port: 465,
  encryption: 'SSL',
  username: '',
  senderName: '',
  senderEmail: '',
  replyTo: '',
  hasPassword: false,
};

function readTabFromHash(): string {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_TABS.has(raw) ? raw : 'dashboard';
}

export type DriveSyncState = 'idle' | 'syncing' | 'synced' | 'error';

export default function App() {
  const [activeTab, setActiveTabState] = useState<string>(() => readTabFromHash());
  const [driveConnection, setDriveConnection] = useState<DriveWorkspaceConnection | null>(() =>
    storage.loadDriveConnection()
  );
  const [driveSyncState, setDriveSyncState] = useState<DriveSyncState>('idle');
  const [driveSyncError, setDriveSyncError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<IntegrationDiagnostics | null>(null);

  const [company, setCompany] = useState<CompanySettings>(() => storage.loadCompanySettings());
  const [fields, setFields] = useState<InvoiceFieldConfig[]>(() =>
    storage.loadFields(storage.loadCompanySettings())
  );
  const [mappingProfiles, setMappingProfiles] = useState<MappingProfile[]>(() =>
    storage.loadProfiles()
  );
  const [activeProfileId, setActiveProfileId] = useState<string>('');
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
  const [smtpConfig, setSmtpConfig] = useState<BackendSmtpConfig>(DEFAULT_SMTP_CONFIG);

  // Cross-tab navigation & filtering state
  const [preselectedEmailRecordId, setPreselectedEmailRecordId] = useState<string | null>(null);
  const [preselectedEmailQuotationId, setPreselectedEmailQuotationId] = useState<string | null>(
    null
  );
  const [incomingConvertedInvoice, setIncomingConvertedInvoice] =
    useState<ManualInvoiceData | null>(null);
  const [quotationStatusFilter, setQuotationStatusFilter] = useState<QuotationStatus | 'ALL'>(
    'ALL'
  );
  const [invoicePaymentFilter, setInvoicePaymentFilter] = useState<string>('ALL');

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const resetInMemoryWorkspace = useCallback(() => {
    const freshCompany: CompanySettings = {
      ...defaultCompanySettings,
      brandPalette: { ...defaultCompanySettings.brandPalette },
      typography: { ...defaultCompanySettings.typography },
      assets: { ...defaultCompanySettings.assets },
      content: { ...defaultCompanySettings.content, customTextBlocks: [] },
      currency: { ...defaultCompanySettings.currency },
      bankAccounts: [],
    };
    const freshTemplate: InvoiceTemplate = {
      ...defaultTemplates[0],
      showSections: { ...defaultTemplates[0].showSections },
      labels: { ...defaultTemplates[0].labels },
    };
    setCompany(freshCompany);
    setFields(defaultFieldCatalog.map((f) => ({ ...f })));
    setMappingProfiles([...defaultMappingProfiles]);
    setActiveProfileId('');
    setTemplate(freshTemplate);
    setCalculationSettings({ ...defaultCalculationSettings });
    setSpreadsheetData({ ...EMPTY_SPREADSHEET_DATA, worksheets: [] });
    setGenerationHistory([]);
    setQuotations([]);
    setCustomers([]);
    setEmailStatuses({});
    setEmailLogs([]);
    setSmtpConfig(DEFAULT_SMTP_CONFIG);
    setPreselectedEmailRecordId(null);
    setPreselectedEmailQuotationId(null);
    setIncomingConvertedInvoice(null);
    setQuotationStatusFilter('ALL');
    setInvoicePaymentFilter('ALL');
  }, []);

  const hydrateFromRemoteWorkspace = useCallback(
    (payload: {
      workspace: any;
      customers: CustomerRecord[];
      invoices: GenerationRecord[];
      quotations: QuotationRecord[];
      emailLogs: EmailDeliveryLogEntry[];
      smtpConfig?: BackendSmtpConfig;
      sheetsState?: any;
    }) => {
      const nextCompany: CompanySettings = payload.workspace?.company
        ? {
            ...defaultCompanySettings,
            ...payload.workspace.company,
            brandPalette: {
              ...defaultCompanySettings.brandPalette,
              ...(payload.workspace.company.brandPalette || {}),
            },
            typography: {
              ...defaultCompanySettings.typography,
              ...(payload.workspace.company.typography || {}),
            },
            assets: {
              ...defaultCompanySettings.assets,
              ...(payload.workspace.company.assets || {}),
            },
            content: {
              ...defaultCompanySettings.content,
              ...(payload.workspace.company.content || {}),
            },
            currency: {
              ...defaultCompanySettings.currency,
              ...(payload.workspace.company.currency || {}),
            },
            bankAccounts: Array.isArray(payload.workspace.company.bankAccounts)
              ? payload.workspace.company.bankAccounts
              : [],
          }
        : { ...defaultCompanySettings, bankAccounts: [] };

      const nextFields: InvoiceFieldConfig[] =
        Array.isArray(payload.workspace?.fieldCatalog) && payload.workspace.fieldCatalog.length > 0
          ? payload.workspace.fieldCatalog
          : defaultFieldCatalog.map((f) => ({ ...f }));

      const nextProfiles: MappingProfile[] = Array.isArray(payload.workspace?.mappingProfiles)
        ? payload.workspace.mappingProfiles
        : [];

      const remoteTemplate = payload.workspace?.layoutConfig?.templates?.[0];
      const nextTemplate: InvoiceTemplate = remoteTemplate
        ? remoteTemplate
        : {
            ...defaultTemplates[0],
            showSections: { ...defaultTemplates[0].showSections },
            labels: { ...defaultTemplates[0].labels },
          };

      const nextCustomers = Array.isArray(payload.customers) ? payload.customers : [];
      const nextInvoices = Array.isArray(payload.invoices) ? payload.invoices : [];
      const nextQuotations = Array.isArray(payload.quotations) ? payload.quotations : [];
      const nextEmailLogs = Array.isArray(payload.emailLogs) ? payload.emailLogs : [];

      setCompany(nextCompany);
      storage.saveCompanySettings(nextCompany);
      setFields(nextFields);
      storage.saveFields(nextFields);
      setMappingProfiles(nextProfiles);
      storage.saveProfiles(nextProfiles);
      setTemplate(nextTemplate);
      storage.saveTemplate(nextTemplate);
      setCustomers(nextCustomers);
      storage.saveCustomers(nextCustomers);
      setGenerationHistory(nextInvoices);
      storage.saveHistory(nextInvoices);
      setQuotations(nextQuotations);
      storage.saveQuotations(nextQuotations);
      setEmailLogs(nextEmailLogs);
      storage.saveEmailLogs(nextEmailLogs);
      if (payload.smtpConfig) {
        setSmtpConfig(payload.smtpConfig);
      }

      if (payload.sheetsState?.activeSpreadsheetId) {
        const ds = payload.sheetsState.datasets?.[payload.sheetsState.activeSpreadsheetId];
        if (ds && Array.isArray(ds.worksheets) && ds.worksheets.length > 0) {
          const hydratedSheet: SpreadsheetData = {
            fileName: `${ds.spreadsheetTitle} (Google Sheets)`,
            activeSheetName: ds.worksheets[0]?.name || '',
            worksheets: ds.worksheets.map((w: any) => ({
              name: w.name,
              headers: w.headers || [],
              rows: w.rows || [],
            })),
          };
          setSpreadsheetData(hydratedSheet);
          storage.saveSpreadsheetData(hydratedSheet);
        } else {
          setSpreadsheetData({ ...EMPTY_SPREADSHEET_DATA, worksheets: [] });
        }
      } else {
        setSpreadsheetData({ ...EMPTY_SPREADSHEET_DATA, worksheets: [] });
      }
    },
    []
  );

  // Load server diagnostics & verify saved Drive folder connection (if any) on startup
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const diag = await fetchServerDiagnostics();
        if (active) setDiagnostics(diag);
      } catch {
        // Silent if server health unreachable temporarily
      }

      const savedConn = storage.loadDriveConnection();
      if (savedConn?.isConnected && savedConn.folderId) {
        storage.setActiveWorkspaceId(savedConn.folderId);
        try {
          const remote = await workspaceApi.fetchRemoteWorkspace();
          if (!active) return;
          hydrateFromRemoteWorkspace(remote);
          const refreshedConn: DriveWorkspaceConnection = {
            ...savedConn,
            lastSyncedAt: remote.lastSyncedAt || savedConn.lastSyncedAt,
          };
          storage.saveDriveConnection(refreshedConn);
          setDriveConnection(refreshedConn);
          setDriveSyncState('synced');
          setDriveSyncError(null);
        } catch (err: any) {
          if (!active) return;
          setDriveSyncState('error');
          setDriveSyncError(
            err?.message || 'Unable to verify previously connected Google Drive folder.'
          );
        }
      } else {
        // Load ephemeral SMTP config if configured in this session
        try {
          const smtp = await workspaceApi.fetchSmtpConfig();
          if (active && smtp) setSmtpConfig(smtp);
        } catch {
          // Ignore
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [hydrateFromRemoteWorkspace]);

  const triggerDriveSync = useCallback(
    async (overrides?: {
      company?: CompanySettings;
      fields?: InvoiceFieldConfig[];
      mappingProfiles?: MappingProfile[];
      template?: InvoiceTemplate;
      customers?: CustomerRecord[];
      invoices?: GenerationRecord[];
      quotations?: QuotationRecord[];
      emailLogs?: EmailDeliveryLogEntry[];
    }) => {
      const currentConn = storage.loadDriveConnection();
      if (!currentConn?.isConnected || !currentConn.folderId) {
        return null;
      }

      setDriveSyncState('syncing');
      setDriveSyncError(null);

      try {
        const res = await workspaceApi.syncWorkspaceToDrive({
          workspace: {
            company: overrides?.company ?? company,
            fieldCatalog: overrides?.fields ?? fields,
            mappingProfiles: overrides?.mappingProfiles ?? mappingProfiles,
            layoutConfig: { templates: [overrides?.template ?? template] },
            updatedAt: new Date().toISOString(),
          },
          customers: overrides?.customers ?? customers,
          invoices: overrides?.invoices ?? generationHistory,
          quotations: overrides?.quotations ?? quotations,
          emailLogs: overrides?.emailLogs ?? emailLogs,
        });

        const updatedConn: DriveWorkspaceConnection = {
          ...currentConn,
          lastSyncedAt: res.syncedAt,
        };
        storage.saveDriveConnection(updatedConn);
        setDriveConnection(updatedConn);
        setDriveSyncState('synced');
        return res;
      } catch (err: any) {
        setDriveSyncState('error');
        setDriveSyncError(err?.message || 'Failed to sync changes to Google Drive.');
        throw err;
      }
    },
    [company, customers, emailLogs, fields, generationHistory, mappingProfiles, quotations, template]
  );

  const scheduleDriveSync = useCallback(
    (overrides?: Parameters<typeof triggerDriveSync>[0]) => {
      if (!driveConnection?.isConnected) return;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        void triggerDriveSync(overrides).catch(() => {});
      }, 650);
    },
    [driveConnection?.isConnected, triggerDriveSync]
  );

  const handleDriveConnected = useCallback(
    (response: DriveConnectResponse) => {
      // Strictly isolate workspaces: clear previous workspace caches before loading newly connected folder
      const prevId = storage.getActiveWorkspaceId();
      if (prevId && prevId !== response.folderId) {
        storage.clearWorkspaceCaches(prevId);
      }
      storage.clearWorkspaceCaches(null);
      resetInMemoryWorkspace();

      const nextConn: DriveWorkspaceConnection = {
        folderUrl: response.folderUrl,
        folderId: response.folderId,
        folderName: response.folderName,
        rootFolderId: response.rootFolderId,
        isConnected: true,
        lastSyncedAt: response.lastSyncedAt,
        connectedAt: new Date().toISOString(),
        serviceAccountEmail: response.serviceAccountEmail,
      };
      storage.saveDriveConnection(nextConn);
      setDriveConnection(nextConn);
      setDriveSyncState('synced');
      setDriveSyncError(null);

      hydrateFromRemoteWorkspace({
        workspace: response.workspace,
        customers: response.customers,
        invoices: response.invoices,
        quotations: response.quotations,
        emailLogs: response.emailLogs,
        smtpConfig: response.smtpConfig,
        sheetsState: response.sheetsState,
      });
    },
    [hydrateFromRemoteWorkspace, resetInMemoryWorkspace]
  );

  const handleDisconnectDrive = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    storage.clearDriveConnection();
    setDriveConnection(null);
    setDriveSyncState('idle');
    setDriveSyncError(null);
    resetInMemoryWorkspace();
  }, [resetInMemoryWorkspace]);

  const handleRestoreSnapshotToState = useCallback(
    (snapshot: any) => {
      hydrateFromRemoteWorkspace({
        workspace: snapshot?.workspace || null,
        customers: snapshot?.customers || [],
        invoices: snapshot?.invoices || [],
        quotations: snapshot?.quotations || [],
        emailLogs: snapshot?.emailLogs || [],
        sheetsState: snapshot?.sheetsState || null,
      });
    },
    [hydrateFromRemoteWorkspace]
  );

  // State updaters with workspace-scoped persistence + Drive auto-sync
  const handleSaveCustomer = async (customer: CustomerRecord) => {
    setCustomers((prev) => {
      const next = [customer, ...prev.filter((c) => c.id !== customer.id)];
      storage.saveCustomers(next);
      scheduleDriveSync({ customers: next });
      return next;
    });
  };

  const handleDeleteCustomer = async (customerId: string) => {
    setCustomers((prev) => {
      const next = prev.filter((c) => c.id !== customerId);
      storage.saveCustomers(next);
      scheduleDriveSync({ customers: next });
      return next;
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
      scheduleDriveSync({ emailLogs: next });
      return next;
    });
  };

  const handleUpdateQuotations = (action: React.SetStateAction<QuotationRecord[]>) => {
    setQuotations((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveQuotations(next);
      scheduleDriveSync({ quotations: next });
      return next;
    });
  };

  const handleStartGuidedWorkflow = (step?: GuidedWorkflowStep) => {
    if (step) {
      const currentSession = storage.loadWorkflowSession();
      if (currentSession) {
        storage.saveWorkflowSession({ ...currentSession, currentStep: step });
      }
    }
    setActiveTab('workflow');
  };

  const handleUpdateCalculationSettings = (settings: CalculationSettings) => {
    setCalculationSettings(settings);
    storage.saveCalculationSettings(settings);
  };

  const handleUpdateCompany = (updatedCompany: CompanySettings) => {
    setCompany(updatedCompany);
    storage.saveCompanySettings(updatedCompany);
    setFields((prev) => {
      const updated = prev.map((f) => {
        if (f.id === 'company_legal_name')
          return { ...f, value: updatedCompany.legalName, defaultValue: updatedCompany.legalName };
        if (f.id === 'company_address') {
          const parts = [
            updatedCompany.addressLine1,
            updatedCompany.addressLine2,
            updatedCompany.city,
            updatedCompany.state,
            updatedCompany.pinCode,
          ].filter(Boolean);
          const addr = parts.join(', ');
          return { ...f, value: addr, defaultValue: addr };
        }
        if (f.id === 'company_gstin')
          return { ...f, value: updatedCompany.gstin, defaultValue: updatedCompany.gstin };
        if (f.id === 'company_email')
          return { ...f, value: updatedCompany.email, defaultValue: updatedCompany.email };
        return f;
      });
      storage.saveFields(updated);
      scheduleDriveSync({ company: updatedCompany, fields: updated });
      return updated;
    });
  };

  const handleUpdateFields = (action: React.SetStateAction<InvoiceFieldConfig[]>) => {
    setFields((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveFields(next);
      scheduleDriveSync({ fields: next });
      return next;
    });
  };

  const handleUpdateTemplate = (action: React.SetStateAction<InvoiceTemplate>) => {
    setTemplate((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveTemplate(next);
      scheduleDriveSync({ template: next });
      return next;
    });
  };

  const handleUpdateHistory = (action: React.SetStateAction<GenerationRecord[]>) => {
    setGenerationHistory((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveHistory(next);
      scheduleDriveSync({ invoices: next });
      return next;
    });
  };

  const handleUpdateSpreadsheetData = (action: React.SetStateAction<SpreadsheetData>) => {
    setSpreadsheetData((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveSpreadsheetData(next);
      return next;
    });
  };

  const handleSendInvoiceByEmail = (recordId: string) => {
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
    const nextQuotations = quotations.map((q) =>
      q.id === updatedQuotation.id ? updatedQuotation : q
    );
    const nextInvoices = [createdInvoice, ...generationHistory];

    setQuotations(nextQuotations);
    storage.saveQuotations(nextQuotations);
    setGenerationHistory(nextInvoices);
    storage.saveHistory(nextInvoices);
    scheduleDriveSync({ quotations: nextQuotations, invoices: nextInvoices });

    setIncomingConvertedInvoice(manualInvoiceData);
    setActiveTab('manual');
  };

  const handleConsumeIncomingInvoice = useCallback(() => {
    setIncomingConvertedInvoice(null);
  }, []);

  const handleNavigateQuotationsFiltered = (status: QuotationStatus | 'ALL') => {
    setQuotationStatusFilter(status);
    setActiveTab('quotations');
  };

  const handleNavigateInvoicesFiltered = (paymentFilter: string) => {
    setInvoicePaymentFilter(paymentFilter);
    setActiveTab('history');
  };

  const totalRecordsCount = spreadsheetData.worksheets.reduce(
    (acc, ws) => acc + ws.rows.length,
    0
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col selection:bg-indigo-600 selection:text-white">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeDataSourceName={spreadsheetData.fileName}
        totalRecordsCount={totalRecordsCount}
        driveConnection={driveConnection}
        driveSyncState={driveSyncState}
      />

      <main className="flex-1 pb-16">
        {activeTab === 'dashboard' && (
          <DashboardView
            setActiveTab={setActiveTab}
            spreadsheetData={spreadsheetData}
            setSpreadsheetData={handleUpdateSpreadsheetData}
            generationHistory={generationHistory}
            quotations={quotations}
            customers={customers}
            company={company}
            driveConnection={driveConnection}
            driveSyncState={driveSyncState}
            onStartGuidedWorkflow={handleStartGuidedWorkflow}
            onNavigateQuotationsFiltered={handleNavigateQuotationsFiltered}
            onNavigateInvoicesFiltered={handleNavigateInvoicesFiltered}
          />
        )}
        {activeTab === 'customers' && (
          <CustomersView
            customers={customers}
            generationHistory={generationHistory}
            quotations={quotations}
            company={company}
            onSaveCustomer={handleSaveCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            isDriveConnected={Boolean(driveConnection?.isConnected)}
          />
        )}
        {activeTab === 'manual' && (
          <ManualEntryView
            company={company}
            fields={fields}
            template={template}
            generationHistory={generationHistory}
            setGenerationHistory={handleUpdateHistory}
            customers={customers}
            onSaveCustomer={handleSaveCustomer}
            onNavigateTab={setActiveTab}
            onSendByEmail={handleSendInvoiceByEmail}
            incomingConvertedInvoice={incomingConvertedInvoice}
            onConsumeIncomingInvoice={handleConsumeIncomingInvoice}
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
            driveConnection={driveConnection}
            diagnostics={diagnostics}
            initialStatusFilter={quotationStatusFilter}
            onConvertedToInvoice={handleConvertedToInvoice}
            onEmailQuotation={handleEmailQuotation}
            onNavigateTab={setActiveTab}
          />
        )}
        {activeTab === 'integrations' && (
          <GoogleIntegrationsView
            driveConnection={driveConnection}
            driveSyncState={driveSyncState}
            driveSyncError={driveSyncError}
            diagnostics={diagnostics}
            smtpConfig={smtpConfig}
            setSmtpConfig={setSmtpConfig}
            onDriveConnected={handleDriveConnected}
            onDisconnectDrive={handleDisconnectDrive}
            onManualSync={() => triggerDriveSync()}
            onRestoredSnapshot={handleRestoreSnapshotToState}
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
            diagnostics={diagnostics}
            driveConnection={driveConnection}
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
            initialPaymentFilter={invoicePaymentFilter}
            onSendByEmail={handleSendInvoiceByEmail}
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
            smtpConfig={smtpConfig}
            driveConnection={driveConnection}
            initialSelectedRecordId={preselectedEmailRecordId}
            initialSelectedQuotationId={preselectedEmailQuotationId}
            onNavigateTab={setActiveTab}
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
