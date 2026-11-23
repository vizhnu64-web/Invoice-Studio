/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import {
  BackendSmtpConfig,
  CalculationSettings,
  CompanySettings,
  CustomerRecord,
  DriveSyncConflict,
  DriveWorkspaceConnection,
  EmailDeliveryLogEntry,
  GenerationRecord,
  GoogleConnectionStatus,
  GoogleVerifiedSession,
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
import {
  getAccessToken,
  GoogleAuthError,
  googleSessionStore,
  requestDriveConsent,
  requestGmailConsent,
  requestSheetsConsent,
  signInWithGoogle,
  signOutGoogle,
  subscribeGoogleSession,
} from './utils/googleAuthClient';
import { openDriveFolderPicker } from './utils/googlePicker';
import {
  DriveFileSummary,
  DriveSyncConflictError,
  DriveWorkspaceBundle,
  extractPaymentLedger,
} from './utils/googleDriveClient';
import {
  resetTrackedDriveRevisions,
  workspaceApi,
  WorkspaceApiError,
} from './utils/workspaceApi';

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
  provider: 'custom_smtp',
  host: '',
  port: 587,
  encryption: 'STARTTLS',
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

function buildEmptyCompany(): CompanySettings {
  return {
    ...defaultCompanySettings,
    brandPalette: { ...defaultCompanySettings.brandPalette },
    typography: { ...defaultCompanySettings.typography },
    assets: { ...defaultCompanySettings.assets },
    content: { ...defaultCompanySettings.content, customTextBlocks: [] },
    currency: { ...defaultCompanySettings.currency },
    bankAccounts: [],
  };
}

function buildEmptyTemplate(): InvoiceTemplate {
  return {
    ...defaultTemplates[0],
    showSections: { ...defaultTemplates[0].showSections },
    labels: { ...defaultTemplates[0].labels },
  };
}

function buildEmptyWorkspaceDefaults() {
  return {
    company: buildEmptyCompany(),
    fieldCatalog: defaultFieldCatalog.map((f) => ({ ...f })),
    mappingProfiles: [...defaultMappingProfiles],
    layoutConfig: { templates: [buildEmptyTemplate()] },
  };
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<string>(() => readTabFromHash());

  // Google OAuth & Drive Connection State (strictly in-memory; never stored in localStorage)
  const [googleSession, setGoogleSession] = useState<GoogleVerifiedSession | null>(null);
  const [driveConnection, setDriveConnection] = useState<DriveWorkspaceConnection | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<GoogleConnectionStatus>('not_connected');
  const [driveSyncError, setDriveSyncError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [syncConflict, setSyncConflict] = useState<DriveSyncConflict | null>(null);
  const [driveBackups, setDriveBackups] = useState<DriveFileSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<IntegrationDiagnostics | null>(null);
  const [globalConflictBusy, setGlobalConflictBusy] = useState(false);

  // Workspace Data State (genuinely empty on fresh visit — zero demo records)
  const [company, setCompany] = useState<CompanySettings>(() => buildEmptyCompany());
  const [fields, setFields] = useState<InvoiceFieldConfig[]>(() =>
    defaultFieldCatalog.map((f) => ({ ...f }))
  );
  const [mappingProfiles, setMappingProfiles] = useState<MappingProfile[]>(() => [
    ...defaultMappingProfiles,
  ]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [spreadsheetData, setSpreadsheetData] = useState<SpreadsheetData>(() => ({
    ...EMPTY_SPREADSHEET_DATA,
    worksheets: [],
  }));
  const [generationHistory, setGenerationHistory] = useState<GenerationRecord[]>([]);
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [template, setTemplate] = useState<InvoiceTemplate>(() => buildEmptyTemplate());
  const [calculationSettings, setCalculationSettings] = useState<CalculationSettings>(() => ({
    ...defaultCalculationSettings,
  }));
  const [emailStatuses, setEmailStatuses] = useState<Record<string, EmailSendStatus>>({});
  const [emailLogs, setEmailLogs] = useState<EmailDeliveryLogEntry[]>([]);
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
  const latestStateRef = useRef({
    company,
    fields,
    mappingProfiles,
    template,
    customers,
    generationHistory,
    quotations,
    emailLogs,
    spreadsheetData,
    driveConnection,
    googleSession,
  });

  useEffect(() => {
    latestStateRef.current = {
      company,
      fields,
      mappingProfiles,
      template,
      customers,
      generationHistory,
      quotations,
      emailLogs,
      spreadsheetData,
      driveConnection,
      googleSession,
    };
  }, [
    company,
    fields,
    mappingProfiles,
    template,
    customers,
    generationHistory,
    quotations,
    emailLogs,
    spreadsheetData,
    driveConnection,
    googleSession,
  ]);

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

  // Purge any leftover legacy/corrupted browser storage on startup + fetch server diagnostics
  useEffect(() => {
    storage.purgeLegacyBrowserStorage();
    let active = true;
    fetchServerDiagnostics()
      .then((diag) => {
        if (active) setDiagnostics(diag);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Keep React state synced with in-memory GoogleSessionStore (including incremental scope grants & expiry)
  useEffect(() => {
    const unsubSession = subscribeGoogleSession((snap) => {
      setGoogleSession(snap.session);
      if (snap.session) {
        setDriveConnection((prev) =>
          prev && prev.accountSub === snap.session!.sub
            ? {
                ...prev,
                accountEmail: snap.session!.email,
                accountName: snap.session!.name,
                hasDriveScope: snap.session!.permissions.driveGranted,
                hasSheetsScope: snap.session!.permissions.sheetsGranted,
                hasGmailScope: snap.session!.permissions.gmailGranted,
              }
            : prev
        );
      }
      if (snap.expired) {
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current);
          syncTimerRef.current = null;
        }
        setConnectionStatus((prev) =>
          prev === 'not_connected' ? 'not_connected' : 'access_expired'
        );
        setDriveSyncError(
          'Your Google access token expired. Your unsaved edits remain safely in memory — click Reconnect Google Account to resume syncing.'
        );
      }
    });
    return () => {
      unsubSession();
    };
  }, []);

  const resetInMemoryWorkspace = useCallback(() => {
    const freshCompany = buildEmptyCompany();
    const freshTemplate = buildEmptyTemplate();
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
    setDriveBackups([]);
    setSyncConflict(null);
    setHasUnsavedChanges(false);
    setPreselectedEmailRecordId(null);
    setPreselectedEmailQuotationId(null);
    setIncomingConvertedInvoice(null);
    setQuotationStatusFilter('ALL');
    setInvoicePaymentFilter('ALL');
  }, []);

  const buildCurrentBundle = useCallback(
    (overrides?: {
      company?: CompanySettings;
      fields?: InvoiceFieldConfig[];
      mappingProfiles?: MappingProfile[];
      template?: InvoiceTemplate;
      customers?: CustomerRecord[];
      invoices?: GenerationRecord[];
      quotations?: QuotationRecord[];
      emailLogs?: EmailDeliveryLogEntry[];
      spreadsheetData?: SpreadsheetData;
    }): DriveWorkspaceBundle => {
      const snap = latestStateRef.current;
      const nextInvoices = overrides?.invoices ?? snap.generationHistory;
      const nextSpreadsheet = overrides?.spreadsheetData ?? snap.spreadsheetData;
      return {
        version: 3,
        updatedAt: new Date().toISOString(),
        company: overrides?.company ?? snap.company,
        fieldCatalog: overrides?.fields ?? snap.fields,
        mappingProfiles: overrides?.mappingProfiles ?? snap.mappingProfiles,
        layoutConfig: { templates: [overrides?.template ?? snap.template] },
        customers: overrides?.customers ?? snap.customers,
        invoices: nextInvoices,
        quotations: overrides?.quotations ?? snap.quotations,
        payments: extractPaymentLedger(nextInvoices),
        emailLogs: overrides?.emailLogs ?? snap.emailLogs,
        spreadsheetData:
          nextSpreadsheet.worksheets && nextSpreadsheet.worksheets.length > 0
            ? nextSpreadsheet
            : null,
      };
    },
    []
  );

  const hydrateFromBundle = useCallback((bundle: DriveWorkspaceBundle) => {
    const nextCompany: CompanySettings = bundle.company
      ? {
          ...buildEmptyCompany(),
          ...bundle.company,
          brandPalette: {
            ...defaultCompanySettings.brandPalette,
            ...(bundle.company.brandPalette || {}),
          },
          typography: {
            ...defaultCompanySettings.typography,
            ...(bundle.company.typography || {}),
          },
          assets: {
            ...defaultCompanySettings.assets,
            ...(bundle.company.assets || {}),
          },
          content: {
            ...defaultCompanySettings.content,
            ...(bundle.company.content || {}),
          },
          currency: {
            ...defaultCompanySettings.currency,
            ...(bundle.company.currency || {}),
          },
          bankAccounts: Array.isArray(bundle.company.bankAccounts)
            ? bundle.company.bankAccounts
            : [],
        }
      : buildEmptyCompany();

    const nextFields: InvoiceFieldConfig[] =
      Array.isArray(bundle.fieldCatalog) && bundle.fieldCatalog.length > 0
        ? bundle.fieldCatalog
        : defaultFieldCatalog.map((f) => ({ ...f }));

    const nextProfiles: MappingProfile[] = Array.isArray(bundle.mappingProfiles)
      ? bundle.mappingProfiles
      : [];

    const remoteTemplate = bundle.layoutConfig?.templates?.[0];
    const nextTemplate: InvoiceTemplate = remoteTemplate ? remoteTemplate : buildEmptyTemplate();

    const nextCustomers = Array.isArray(bundle.customers) ? bundle.customers : [];
    const nextInvoices = Array.isArray(bundle.invoices) ? bundle.invoices : [];
    const nextQuotations = Array.isArray(bundle.quotations) ? bundle.quotations : [];
    const nextEmailLogs = Array.isArray(bundle.emailLogs) ? bundle.emailLogs : [];
    const nextSpreadsheet: SpreadsheetData =
      bundle.spreadsheetData && Array.isArray(bundle.spreadsheetData.worksheets)
        ? bundle.spreadsheetData
        : { ...EMPTY_SPREADSHEET_DATA, worksheets: [] };

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
    setSpreadsheetData(nextSpreadsheet);
    storage.saveSpreadsheetData(nextSpreadsheet);
  }, []);

  /**
   * Connects or opens a Google Drive workspace folder through the stateless backend `/api/drive/connect`,
   * isolating all in-memory data under `${session.sub}::${folderId}` and saving ONLY non-secret
   * folder metadata under `invoice_studio_workspace_<google_sub>`.
   */
  const connectAndLoadDriveWorkspace = useCallback(
    async (
      session: GoogleVerifiedSession,
      target?: { folderId?: string; folderUrl?: string }
    ) => {
      if (!session.permissions.driveGranted) {
        setConnectionStatus('permission_missing');
        setDriveSyncError(
          'Google Drive permission (drive.file) was not granted. Click Grant Drive Permission to load or store your workspace.'
        );
        return;
      }

      setConnectionStatus('loading_workspace');
      setDriveSyncError(null);
      setSyncConflict(null);

      try {
        // Strictly wipe previous workspace data from memory before loading target account/folder
        storage.clearDriveConnection();
        resetTrackedDriveRevisions();
        resetInMemoryWorkspace();

        const connected = await workspaceApi.connectDriveWorkspace({
          folderId: target?.folderId,
          folderUrl: target?.folderUrl,
          emptyDefaults: buildEmptyWorkspaceDefaults(),
        });

        storage.setActiveWorkspaceId(connected.subfolders.rootFolderId, session.sub);
        hydrateFromBundle(connected.bundle);
        setDriveBackups(connected.backups || []);

        const nextConn: DriveWorkspaceConnection = {
          folderUrl: connected.folderUrl,
          folderId: connected.subfolders.rootFolderId,
          folderName: connected.subfolders.rootFolderName,
          accountSub: session.sub,
          accountEmail: session.email,
          accountName: session.name,
          hasDriveScope: session.permissions.driveGranted,
          hasSheetsScope: session.permissions.sheetsGranted,
          hasGmailScope: session.permissions.gmailGranted,
          isConnected: true,
          lastSyncedAt: connected.lastSyncedAt,
          connectedAt: new Date().toISOString(),
          subfolders: connected.subfolders,
        };

        storage.saveDriveConnection(nextConn);
        storage.saveUserWorkspaceMetadata(session.sub, {
          folderId: nextConn.folderId,
          folderName: nextConn.folderName,
          lastSyncedAt: nextConn.lastSyncedAt,
        });

        setDriveConnection(nextConn);
        setConnectionStatus('synced');
        setHasUnsavedChanges(false);

        // Best-effort load per-business encrypted SMTP config from user's Drive
        workspaceApi
          .fetchSmtpConfig(nextConn.folderId)
          .then((cfg) => setSmtpConfig(cfg))
          .catch(() => setSmtpConfig(DEFAULT_SMTP_CONFIG));
      } catch (err: any) {
        if (
          (err instanceof WorkspaceApiError && err.status === 401) ||
          (err instanceof GoogleAuthError && err.code === 'GOOGLE_TOKEN_EXPIRED')
        ) {
          setConnectionStatus('access_expired');
        } else if (err instanceof WorkspaceApiError && err.status === 403) {
          setConnectionStatus('permission_missing');
        } else {
          setConnectionStatus('connected');
        }
        const msg = err?.message || 'Unable to load workspace from Google Drive.';
        setDriveSyncError(msg);
        throw err;
      }
    },
    [hydrateFromBundle, resetInMemoryWorkspace]
  );

  // Connect Google Account -> Verify via backend -> Auto-load saved folder for `sub` or locate/create "Invoice Studio"
  const handleConnectGoogleAccount = useCallback(async () => {
    setDriveSyncError(null);
    setConnectionStatus('connecting');
    try {
      const { session } = await signInWithGoogle({ prompt: 'select_account' });
      setGoogleSession(session);

      if (!session.permissions.driveGranted) {
        setConnectionStatus('permission_missing');
        setDriveSyncError(
          'Google Drive permission was not approved. Click Grant Drive Permission to store your workspace in Google Drive.'
        );
        return;
      }

      setConnectionStatus('connected');

      // Check per-account non-secret folder preference (`invoice_studio_workspace_<sub`)
      const savedMeta = storage.loadUserWorkspaceMetadata(session.sub);
      if (savedMeta?.folderId) {
        try {
          await connectAndLoadDriveWorkspace(session, { folderId: savedMeta.folderId });
          return;
        } catch {
          // Saved folder may have been trashed/unshared; fall back cleanly to default "Invoice Studio" folder
        }
      }

      await connectAndLoadDriveWorkspace(session);
    } catch (err: any) {
      setConnectionStatus(driveConnection?.isConnected ? 'access_expired' : 'not_connected');
      setDriveSyncError(err?.message || 'Google Account connection could not be completed.');
    }
  }, [connectAndLoadDriveWorkspace, driveConnection?.isConnected]);

  // Switch Google Account — wipe memory completely before connecting another Google account
  const handleSwitchGoogleAccount = useCallback(async () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    await signOutGoogle();
    resetTrackedDriveRevisions();
    storage.clearDriveConnection();
    setGoogleSession(null);
    setDriveConnection(null);
    resetInMemoryWorkspace();
    setConnectionStatus('not_connected');
    await handleConnectGoogleAccount();
  }, [handleConnectGoogleAccount, resetInMemoryWorkspace]);

  // Create or locate default "Invoice Studio" folder in user's My Drive
  const handleCreateDefaultFolder = useCallback(async () => {
    const session = googleSessionStore.getSession();
    if (!session || !googleSessionStore.isTokenValid()) {
      setConnectionStatus('access_expired');
      setDriveSyncError('Please connect or reconnect your Google account first.');
      return;
    }
    try {
      await connectAndLoadDriveWorkspace(session);
    } catch {
      // Error state handled inside connectAndLoadDriveWorkspace
    }
  }, [connectAndLoadDriveWorkspace]);

  // Select an existing Drive folder using official Google Picker
  const handleSelectExistingFolder = useCallback(async () => {
    const token = getAccessToken();
    const session = googleSessionStore.getSession();
    if (!token || !session) {
      setConnectionStatus('access_expired');
      setDriveSyncError('Please connect or reconnect your Google account first.');
      return;
    }
    setDriveSyncError(null);
    try {
      const picked = await openDriveFolderPicker(token);
      if (!picked) return;
      await connectAndLoadDriveWorkspace(session, { folderId: picked.id });
    } catch (err: any) {
      setDriveSyncError(err?.message || 'Failed to open Google Drive Folder Picker.');
    }
  }, [connectAndLoadDriveWorkspace]);

  // Connect Drive folder by pasted Google Drive folder URL or ID
  const handleConnectFolderByUrl = useCallback(
    async (folderUrlOrId: string) => {
      const session = googleSessionStore.getSession();
      if (!session || !googleSessionStore.isTokenValid()) {
        setConnectionStatus('access_expired');
        throw new Error('Please connect or reconnect your Google account first.');
      }
      await connectAndLoadDriveWorkspace(session, { folderUrl: folderUrlOrId });
    },
    [connectAndLoadDriveWorkspace]
  );

  // Sync workspace to user's connected Drive folder via stateless backend `/api/drive/workspace`
  const triggerDriveSync = useCallback(
    async (
      overrides?: Parameters<typeof buildCurrentBundle>[0],
      options?: { forceOverwrite?: boolean; allowEmptyOverwrite?: boolean }
    ) => {
      const currentConn = latestStateRef.current.driveConnection;
      if (!currentConn?.isConnected || !currentConn.folderId) {
        return;
      }
      if (!googleSessionStore.isTokenValid()) {
        setConnectionStatus('access_expired');
        setHasUnsavedChanges(true);
        setDriveSyncError(
          'Your Google access token expired. Unsaved changes are preserved — click Reconnect Google Account to sync.'
        );
        return;
      }

      setConnectionStatus('syncing');
      setDriveSyncError(null);

      try {
        const bundle = buildCurrentBundle(overrides);
        const { syncedAt } = await workspaceApi.saveDriveWorkspace(
          currentConn.folderId,
          bundle,
          options
        );

        const updatedConn: DriveWorkspaceConnection = {
          ...currentConn,
          lastSyncedAt: syncedAt,
        };
        storage.saveDriveConnection(updatedConn);
        if (updatedConn.accountSub) {
          storage.saveUserWorkspaceMetadata(updatedConn.accountSub, {
            folderId: updatedConn.folderId,
            folderName: updatedConn.folderName,
            lastSyncedAt: syncedAt,
          });
        }
        setDriveConnection(updatedConn);
        setConnectionStatus('synced');
        setHasUnsavedChanges(false);
        setSyncConflict(null);
      } catch (err: any) {
        if (
          (err instanceof WorkspaceApiError && err.status === 401) ||
          (err instanceof GoogleAuthError && err.code === 'GOOGLE_TOKEN_EXPIRED')
        ) {
          setConnectionStatus('access_expired');
          setHasUnsavedChanges(true);
          setDriveSyncError(
            'Your Google access token expired or was revoked. Unsaved changes are safely preserved — click Reconnect Google Account.'
          );
          return;
        }
        if (err instanceof WorkspaceApiError && err.status === 403) {
          setConnectionStatus('permission_missing');
          setHasUnsavedChanges(true);
          setDriveSyncError(err.message);
          return;
        }
        if (err instanceof DriveSyncConflictError) {
          setSyncConflict(err.conflict);
          setConnectionStatus('sync_failed');
          setHasUnsavedChanges(true);
          setDriveSyncError(err.message);
          return;
        }
        setConnectionStatus('sync_failed');
        setHasUnsavedChanges(true);
        setDriveSyncError(err?.message || 'Failed to sync changes to Google Drive.');
        throw err;
      }
    },
    [buildCurrentBundle]
  );

  // Reconnect after token expiration — preserves unsaved changes for same `sub`, wipes & loads if different `sub`
  const handleReconnectGoogleAccount = useCallback(async () => {
    setDriveSyncError(null);
    const prevConn = latestStateRef.current.driveConnection;
    const prevSession = latestStateRef.current.googleSession;
    const hintEmail = prevConn?.accountEmail || prevSession?.email;
    setConnectionStatus('connecting');

    try {
      const { session } = await signInWithGoogle({
        prompt: hintEmail ? '' : 'select_account',
        loginHint: hintEmail || undefined,
      });
      setGoogleSession(session);

      if (!session.permissions.driveGranted) {
        setConnectionStatus('permission_missing');
        setDriveSyncError('Google Drive permission is missing. Grant Drive permission to resume syncing.');
        return;
      }

      if (prevConn?.isConnected && prevConn.folderId) {
        // Strict account isolation: if user authorized a different Google `sub`, clear previous data & load new user's workspace
        if (prevConn.accountSub && session.sub !== prevConn.accountSub) {
          const savedMeta = storage.loadUserWorkspaceMetadata(session.sub);
          await connectAndLoadDriveWorkspace(
            session,
            savedMeta?.folderId ? { folderId: savedMeta.folderId } : undefined
          );
          return;
        }

        setConnectionStatus('connected');
        workspaceApi
          .fetchSmtpConfig(prevConn.folderId)
          .then((cfg) => setSmtpConfig(cfg))
          .catch(() => {});

        if (hasUnsavedChanges) {
          await triggerDriveSync();
        } else {
          setConnectionStatus('synced');
        }
      } else {
        await connectAndLoadDriveWorkspace(session);
      }
    } catch (err: any) {
      setConnectionStatus(prevConn?.isConnected ? 'access_expired' : 'not_connected');
      setDriveSyncError(err?.message || 'Could not reconnect Google Account.');
    }
  }, [connectAndLoadDriveWorkspace, hasUnsavedChanges, triggerDriveSync]);

  // Incremental Permission Requests
  const handleEnableGmailPermission = useCallback(async () => {
    setDriveSyncError(null);
    const { session } = await requestGmailConsent();
    setGoogleSession(session);
  }, []);

  const handleGrantSheetsPermission = useCallback(async () => {
    setDriveSyncError(null);
    const { session } = await requestSheetsConsent();
    setGoogleSession(session);
  }, []);

  const handleGrantDrivePermission = useCallback(async () => {
    setDriveSyncError(null);
    const { session } = await requestDriveConsent();
    setGoogleSession(session);
    if (session.permissions.driveGranted && !latestStateRef.current.driveConnection?.isConnected) {
      await connectAndLoadDriveWorkspace(session);
    }
  }, [connectAndLoadDriveWorkspace]);

  const scheduleDriveSync = useCallback(
    (overrides?: Parameters<typeof buildCurrentBundle>[0]) => {
      setHasUnsavedChanges(true);
      const currentConn = latestStateRef.current.driveConnection;
      if (!currentConn?.isConnected) return;
      if (!googleSessionStore.isTokenValid()) {
        setConnectionStatus('access_expired');
        return;
      }
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        void triggerDriveSync(overrides).catch(() => {});
      }, 700);
    },
    [triggerDriveSync]
  );

  // Conflict Resolution: Reload latest from Drive
  const handleResolveConflictReload = useCallback(async () => {
    const conn = latestStateRef.current.driveConnection;
    const session = googleSessionStore.getSession();
    if (!conn?.folderId || !session) return;
    setGlobalConflictBusy(true);
    try {
      await connectAndLoadDriveWorkspace(session, { folderId: conn.folderId });
    } finally {
      setGlobalConflictBusy(false);
    }
  }, [connectAndLoadDriveWorkspace]);

  // Conflict Resolution: Backup remote first, then push local changes
  const handleResolveConflictOverwrite = useCallback(async () => {
    const conn = latestStateRef.current.driveConnection;
    if (!conn?.folderId) return;
    setGlobalConflictBusy(true);
    try {
      const remoteLoaded = await workspaceApi.loadDriveWorkspace(conn.folderId);
      const backupRes = await workspaceApi.createDriveBackup(remoteLoaded.bundle);
      setDriveBackups(backupRes.backups);
      await triggerDriveSync(undefined, { forceOverwrite: true });
    } finally {
      setGlobalConflictBusy(false);
    }
  }, [triggerDriveSync]);

  // Create Backup
  const handleCreateBackup = useCallback(async (): Promise<DriveFileSummary | null> => {
    const conn = latestStateRef.current.driveConnection;
    if (!conn?.folderId) return null;
    await triggerDriveSync();
    const res = await workspaceApi.createDriveBackup(buildCurrentBundle());
    setDriveBackups(res.backups);
    return res.backup;
  }, [buildCurrentBundle, triggerDriveSync]);

  // Restore Backup
  const handleRestoreBackup = useCallback(
    async (backupFileId: string) => {
      const res = await workspaceApi.restoreDriveBackup(backupFileId);
      hydrateFromBundle(res.bundle);
      setDriveConnection((prev) => (prev ? { ...prev, lastSyncedAt: res.restoredAt } : prev));
      setHasUnsavedChanges(false);
      setConnectionStatus('synced');
    },
    [hydrateFromBundle]
  );

  // Explicit confirmed delete of a backup/PDF file inside user's Drive workspace
  const handleDeleteDriveFile = useCallback(async (fileId: string) => {
    await workspaceApi.deleteDriveFile(fileId);
    const updatedBackups = await workspaceApi.listDriveBackups();
    setDriveBackups(updatedBackups);
  }, []);

  // Disconnect Google cleanly — revoke token, wipe all in-memory data, stay on clean public dashboard
  const handleDisconnectDrive = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    void signOutGoogle();
    resetTrackedDriveRevisions();
    storage.clearDriveConnection();
    storage.purgeLegacyBrowserStorage();
    setGoogleSession(null);
    setDriveConnection(null);
    setConnectionStatus('not_connected');
    setDriveSyncError(null);
    resetInMemoryWorkspace();
  }, [resetInMemoryWorkspace]);

  // State updaters with in-memory cache + Drive auto-sync
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
    const prevAssets = latestStateRef.current.company.assets;
    setCompany(updatedCompany);
    storage.saveCompanySettings(updatedCompany);

    // Best-effort upload newly changed brand assets into dedicated Drive Assets subfolders
    if (latestStateRef.current.driveConnection?.isConnected && googleSessionStore.isTokenValid()) {
      const assetEntries: Array<{
        category: 'logos' | 'signatures' | 'stamps' | 'other';
        name: string;
        nextUrl?: string;
        prevUrl?: string;
      }> = [
        {
          category: 'logos',
          name: 'company-logo',
          nextUrl: updatedCompany.assets.logoUrl,
          prevUrl: prevAssets.logoUrl,
        },
        {
          category: 'signatures',
          name: 'authorized-signature',
          nextUrl: updatedCompany.assets.signatureUrl,
          prevUrl: prevAssets.signatureUrl,
        },
        {
          category: 'stamps',
          name: 'company-stamp',
          nextUrl: updatedCompany.assets.stampUrl,
          prevUrl: prevAssets.stampUrl,
        },
        {
          category: 'other',
          name: 'payment-qr',
          nextUrl: updatedCompany.assets.qrCodeUrl,
          prevUrl: prevAssets.qrCodeUrl,
        },
      ];
      for (const entry of assetEntries) {
        if (entry.nextUrl && entry.nextUrl !== entry.prevUrl && entry.nextUrl.startsWith('data:')) {
          void workspaceApi
            .uploadAssetToDrive({
              category: entry.category,
              assetName: entry.name,
              dataUrl: entry.nextUrl,
            })
            .catch(() => {});
        }
      }
    }

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
      scheduleDriveSync({ spreadsheetData: next });
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
        googleSession={googleSession}
        driveConnection={driveConnection}
        connectionStatus={connectionStatus}
        onConnectGoogle={() => void handleConnectGoogleAccount()}
        onReconnectDrive={() => void handleReconnectGoogleAccount()}
      />

      {/* Global Access Expired Banner (preserves unsaved changes across all tabs) */}
      {connectionStatus === 'access_expired' && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Access expired:</strong> Your Google authorization expired.
                {hasUnsavedChanges
                  ? ' Your unsaved changes are safely preserved in memory and will sync as soon as you reconnect.'
                  : ' Reconnect to resume Google Drive, Sheets, and Gmail operations.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleReconnectGoogleAccount()}
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconnect Google Account</span>
            </button>
          </div>
        </div>
      )}

      {/* Global Permission Missing Banner */}
      {connectionStatus === 'permission_missing' && activeTab !== 'integrations' && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Permission missing:</strong>{' '}
                {driveSyncError || 'Required Google permission is missing for your active workspace.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('integrations')}
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Manage Google Permissions</span>
            </button>
          </div>
        </div>
      )}

      {/* Global Sync Conflict Banner */}
      {syncConflict && activeTab !== 'integrations' && (
        <div className="bg-rose-50 border-b border-rose-200 text-rose-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>
                <strong>Drive sync conflict on {syncConflict.fileName}:</strong> Newer changes were
                saved from another browser or session.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={globalConflictBusy}
                onClick={() => void handleResolveConflictReload()}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reload Latest</span>
              </button>
              <button
                type="button"
                disabled={globalConflictBusy}
                onClick={() => setActiveTab('integrations')}
                className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Resolve in Drive Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Sync Failed Banner (surfaces Drive write errors on any tab) */}
      {connectionStatus === 'sync_failed' && !syncConflict && activeTab !== 'integrations' && (
        <div className="bg-rose-50 border-b border-rose-200 text-rose-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>
                <strong>Google Drive sync failed:</strong>{' '}
                {driveSyncError || 'Your latest changes could not be saved to Google Drive.'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void triggerDriveSync().catch(() => {})}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Sync</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('integrations')}
                className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Open Drive Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
            googleSession={googleSession}
            driveConnection={driveConnection}
            connectionStatus={connectionStatus}
            hasUnsavedChanges={hasUnsavedChanges}
            onConnectGoogle={handleConnectGoogleAccount}
            onSyncNow={() => triggerDriveSync()}
            onReconnectDrive={handleReconnectGoogleAccount}
            onEnableGmailPermission={handleEnableGmailPermission}
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
            googleSession={googleSession}
            driveConnection={driveConnection}
            connectionStatus={connectionStatus}
            driveSyncError={driveSyncError}
            hasUnsavedChanges={hasUnsavedChanges}
            syncConflict={syncConflict}
            diagnostics={diagnostics}
            smtpConfig={smtpConfig}
            setSmtpConfig={setSmtpConfig}
            onConnectGoogleAccount={handleConnectGoogleAccount}
            onSwitchGoogleAccount={handleSwitchGoogleAccount}
            onReconnectGoogleAccount={handleReconnectGoogleAccount}
            onEnableGmailPermission={handleEnableGmailPermission}
            onGrantDrivePermission={handleGrantDrivePermission}
            onGrantSheetsPermission={handleGrantSheetsPermission}
            onCreateDefaultFolder={handleCreateDefaultFolder}
            onSelectExistingFolder={handleSelectExistingFolder}
            onConnectFolderByUrl={handleConnectFolderByUrl}
            onDisconnectDrive={handleDisconnectDrive}
            onManualSync={() => triggerDriveSync()}
            onCreateBackup={handleCreateBackup}
            onRestoreBackup={handleRestoreBackup}
            onDeleteDriveFile={handleDeleteDriveFile}
            onResolveConflictReload={handleResolveConflictReload}
            onResolveConflictOverwrite={handleResolveConflictOverwrite}
            onNavigateTab={setActiveTab}
            driveBackups={driveBackups}
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
            googleSession={googleSession}
            driveConnection={driveConnection}
            onConnectGoogle={handleConnectGoogleAccount}
            onEnableGmailPermission={handleEnableGmailPermission}
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
