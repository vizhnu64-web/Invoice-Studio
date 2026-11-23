/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cloud,
  CloudOff,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlink,
  UserCheck,
  Users,
  Wifi,
} from 'lucide-react';
import {
  BackendSmtpConfig,
  DriveSyncConflict,
  DriveWorkspaceConnection,
  GoogleConnectionStatus,
  GoogleVerifiedSession,
  IntegrationDiagnostics,
  SmtpProviderMethod,
} from '../types';
import {
  fetchGoogleClientConfig,
  getCachedGoogleClientConfig,
  GoogleClientConfig,
} from '../utils/googleAuthClient';
import { DriveBackupFile, workspaceApi } from '../utils/workspaceApi';
import { GOOGLE_STATUS_LABELS } from './Navbar';

interface GoogleIntegrationsViewProps {
  googleSession: GoogleVerifiedSession | null;
  driveConnection: DriveWorkspaceConnection | null;
  connectionStatus: GoogleConnectionStatus;
  driveSyncError: string | null;
  hasUnsavedChanges: boolean;
  syncConflict: DriveSyncConflict | null;
  diagnostics: IntegrationDiagnostics | null;
  smtpConfig: BackendSmtpConfig;
  setSmtpConfig: React.Dispatch<React.SetStateAction<BackendSmtpConfig>>;
  onConnectGoogleAccount: () => Promise<void>;
  onSwitchGoogleAccount: () => Promise<void>;
  onReconnectGoogleAccount: () => Promise<void>;
  onEnableGmailPermission: () => Promise<void>;
  onGrantDrivePermission: () => Promise<void>;
  onGrantSheetsPermission: () => Promise<void>;
  onCreateDefaultFolder: () => Promise<void>;
  onSelectExistingFolder: () => Promise<void>;
  onConnectFolderByUrl: (folderUrlOrId: string) => Promise<void>;
  onDisconnectDrive: () => void;
  onManualSync: () => Promise<void>;
  onCreateBackup: () => Promise<DriveBackupFile | null>;
  onRestoreBackup: (backupFileId: string) => Promise<void>;
  onDeleteDriveFile: (fileId: string) => Promise<void>;
  onResolveConflictReload: () => Promise<void>;
  onResolveConflictOverwrite: () => Promise<void>;
  onNavigateTab: (tab: string) => void;
  driveBackups: DriveBackupFile[];
  localCounts: {
    quotations: number;
    invoices: number;
    customers: number;
    emailLogs: number;
  };
}

const DRIVE_FOLDER_TREE = [
  'Invoice Studio/',
  '  ├── workspace/',
  '  │     ├── invoice-studio-data.json',
  '  │     ├── company-settings.json',
  '  │     ├── customer-data.json',
  '  │     ├── payment-data.json',
  '  │     ├── email-settings.json (encrypted)',
  '  │     └── email-history.json',
  '  ├── Invoices/   (Invoice PDFs)',
  '  ├── Quotations/ (Quotation PDFs)',
  '  ├── Assets/',
  '  │     ├── logos/',
  '  │     ├── signatures/',
  '  │     └── stamps/',
  '  └── Backups/    (Dated snapshots)',
];

export const GoogleIntegrationsView: React.FC<GoogleIntegrationsViewProps> = ({
  googleSession,
  driveConnection,
  connectionStatus,
  driveSyncError,
  hasUnsavedChanges,
  syncConflict,
  diagnostics,
  smtpConfig,
  setSmtpConfig,
  onConnectGoogleAccount,
  onSwitchGoogleAccount,
  onReconnectGoogleAccount,
  onEnableGmailPermission,
  onGrantDrivePermission,
  onGrantSheetsPermission,
  onCreateDefaultFolder,
  onSelectExistingFolder,
  onConnectFolderByUrl,
  onDisconnectDrive,
  onManualSync,
  onCreateBackup,
  onRestoreBackup,
  onDeleteDriveFile,
  onResolveConflictReload,
  onResolveConflictOverwrite,
  onNavigateTab,
  driveBackups,
  localCounts,
}) => {
  const [publicConfig, setPublicConfig] = useState<GoogleClientConfig>(() =>
    getCachedGoogleClientConfig()
  );

  // Google account & Drive UI states
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveBackupLoading, setDriveBackupLoading] = useState(false);
  const [driveRestoringId, setDriveRestoringId] = useState<string | null>(null);
  const [driveDeletingId, setDriveDeletingId] = useState<string | null>(null);
  const [confirmRestoreBackup, setConfirmRestoreBackup] = useState<DriveBackupFile | null>(null);
  const [confirmDeleteBackup, setConfirmDeleteBackup] = useState<DriveBackupFile | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmOverwriteConflict, setConfirmOverwriteConflict] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccess, setDriveSuccess] = useState<string | null>(null);

  // Connect by Drive folder URL
  const [folderUrlInput, setFolderUrlInput] = useState('');
  const [connectingFolderUrl, setConnectingFolderUrl] = useState(false);

  // Connection diagnostic test state
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    email: string;
    checkedAt: string;
    folderOk: boolean;
    folderName?: string;
    folderError?: string;
    permissions: {
      identityConnected: boolean;
      driveGranted: boolean;
      sheetsGranted: boolean;
      gmailGranted: boolean;
    };
  } | null>(null);

  // Incremental permission action state
  const [grantingPerm, setGrantingPerm] = useState<'drive' | 'sheets' | 'gmail' | null>(null);

  // Drive counts
  const [driveCounts, setDriveCounts] = useState<{
    invoices: number;
    quotations: number;
    assets: number;
    backups: number;
  }>({
    invoices: 0,
    quotations: 0,
    assets: 0,
    backups: driveBackups.length,
  });

  // Gmail API test send state (Default email method)
  const [gmailTestRecipient, setGmailTestRecipient] = useState('');
  const [gmailSendingTest, setGmailSendingTest] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailSuccess, setGmailSuccess] = useState<string | null>(null);

  // Optional Custom SMTP configuration state
  const [showSmtpSection, setShowSmtpSection] = useState<boolean>(Boolean(smtpConfig.configured));
  const [smtpProvider, setSmtpProvider] = useState<SmtpProviderMethod>(
    smtpConfig.provider || 'custom_smtp'
  );
  const [smtpHost, setSmtpHost] = useState(smtpConfig.host || '');
  const [smtpPort, setSmtpPort] = useState<number>(smtpConfig.port || 587);
  const [smtpEncryption, setSmtpEncryption] = useState<'SSL' | 'STARTTLS' | 'NONE'>(
    smtpConfig.encryption || 'STARTTLS'
  );
  const [smtpUsername, setSmtpUsername] = useState(smtpConfig.username || '');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpSenderName, setSmtpSenderName] = useState(smtpConfig.senderName || '');
  const [smtpSenderEmail, setSmtpSenderEmail] = useState(smtpConfig.senderEmail || '');
  const [smtpReplyTo, setSmtpReplyTo] = useState(smtpConfig.replyTo || '');
  const [testEmailRecipient, setTestEmailRecipient] = useState('');

  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpSendingTest, setSmtpSendingTest] = useState(false);
  const [confirmDeleteSmtp, setConfirmDeleteSmtp] = useState(false);
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [smtpSuccess, setSmtpSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchGoogleClientConfig()
      .then((cfg) => {
        if (active) setPublicConfig(cfg);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (googleSession?.email && !gmailTestRecipient) {
      setGmailTestRecipient(googleSession.email);
    }
  }, [googleSession?.email, gmailTestRecipient]);

  useEffect(() => {
    setSmtpProvider(smtpConfig.provider || 'custom_smtp');
    setSmtpHost(
      smtpConfig.provider === 'gmail_smtp' ? 'smtp.gmail.com' : smtpConfig.host || ''
    );
    setSmtpPort(smtpConfig.port || (smtpConfig.provider === 'gmail_smtp' ? 465 : 587));
    setSmtpEncryption(smtpConfig.encryption || 'STARTTLS');
    setSmtpUsername(smtpConfig.username || '');
    setSmtpSenderName(smtpConfig.senderName || '');
    setSmtpSenderEmail(smtpConfig.senderEmail || '');
    setSmtpReplyTo(smtpConfig.replyTo || '');
    if (smtpConfig.configured) {
      setShowSmtpSection(true);
    }
  }, [smtpConfig]);

  useEffect(() => {
    setDriveCounts((prev) => ({ ...prev, backups: driveBackups.length }));
  }, [driveBackups.length]);

  useEffect(() => {
    if (
      !driveConnection?.isConnected ||
      connectionStatus === 'access_expired' ||
      connectionStatus === 'not_connected'
    ) {
      return;
    }
    let active = true;
    workspaceApi
      .fetchDriveFolderCounts()
      .then((counts) => {
        if (!active) return;
        setDriveCounts({
          invoices: counts.invoicePdfCount,
          quotations: counts.quotationPdfCount,
          assets: counts.assetCount,
          backups: counts.backupCount,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    driveConnection?.isConnected,
    driveConnection?.folderId,
    driveConnection?.lastSyncedAt,
    connectionStatus,
  ]);

  const isBusy =
    connectionStatus === 'connecting' ||
    connectionStatus === 'loading_workspace' ||
    connectionStatus === 'syncing';
  const isAccessExpired = connectionStatus === 'access_expired';
  const isPermissionMissing = connectionStatus === 'permission_missing';
  const perms = googleSession?.permissions || {
    identityConnected: false,
    driveGranted: false,
    sheetsGranted: false,
    gmailGranted: false,
  };
  const canUseDriveApi =
    Boolean(driveConnection?.isConnected) &&
    Boolean(googleSession) &&
    !isAccessExpired &&
    perms.driveGranted;

  const handleTestConnection = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setTestingConnection(true);
    try {
      const res = await workspaceApi.testGoogleConnection(driveConnection?.folderId);
      setTestResult({
        ok: res.ok,
        email: res.email,
        checkedAt: res.checkedAt,
        folderOk: res.folderCheck.ok,
        folderName: res.folderCheck.folderName,
        folderError: res.folderCheck.error,
        permissions: res.permissions,
      });
      setDriveSuccess(
        `Verified Google session for ${res.email}${res.folderCheck.folderName ? ` · Folder "${res.folderCheck.folderName}" accessible` : ''}.`
      );
    } catch (err: any) {
      setDriveError(err?.message || 'Google connection test failed.');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleConnectFolderUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderUrlInput.trim()) {
      setDriveError('Paste a Google Drive folder URL or folder ID first.');
      return;
    }
    setDriveError(null);
    setDriveSuccess(null);
    setConnectingFolderUrl(true);
    try {
      await onConnectFolderByUrl(folderUrlInput.trim());
      setFolderUrlInput('');
      setDriveSuccess('Connected Google Drive folder and loaded workspace successfully.');
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to connect the specified Google Drive folder.');
    } finally {
      setConnectingFolderUrl(false);
    }
  };

  const handleManualDriveSync = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setDriveSyncing(true);
    try {
      await onManualSync();
      setDriveSuccess(`Workspace synced to Google Drive at ${new Date().toLocaleTimeString()}.`);
    } catch (err: any) {
      setDriveError(err?.message || 'Sync to Google Drive failed.');
    } finally {
      setDriveSyncing(false);
    }
  };

  const handleCreateDriveBackup = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setDriveBackupLoading(true);
    try {
      const backup = await onCreateBackup();
      if (backup) {
        setDriveSuccess(`Created backup snapshot "${backup.name}" in Backups/.`);
      }
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to create Google Drive backup.');
    } finally {
      setDriveBackupLoading(false);
    }
  };

  const handleConfirmRestoreBackup = async () => {
    if (!confirmRestoreBackup) return;
    const target = confirmRestoreBackup;
    setConfirmRestoreBackup(null);
    setDriveError(null);
    setDriveSuccess(null);
    setDriveRestoringId(target.id);
    try {
      await onRestoreBackup(target.id);
      setDriveSuccess(`Backup "${target.name}" restored successfully into your workspace.`);
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to restore selected backup.');
    } finally {
      setDriveRestoringId(null);
    }
  };

  const handleConfirmDeleteBackup = async () => {
    if (!confirmDeleteBackup) return;
    const target = confirmDeleteBackup;
    setConfirmDeleteBackup(null);
    setDriveError(null);
    setDriveSuccess(null);
    setDriveDeletingId(target.id);
    try {
      await onDeleteDriveFile(target.id);
      setDriveSuccess(`Moved "${target.name}" to your Google Drive Trash.`);
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to delete selected Drive file.');
    } finally {
      setDriveDeletingId(null);
    }
  };

  const handleGrantPerm = async (kind: 'drive' | 'sheets' | 'gmail') => {
    setDriveError(null);
    setGmailError(null);
    setGrantingPerm(kind);
    try {
      if (kind === 'gmail') {
        await onEnableGmailPermission();
        setGmailSuccess('Gmail sending permission enabled for your connected Google account.');
      } else if (kind === 'sheets') {
        await onGrantSheetsPermission();
        setDriveSuccess('Google Sheets read permission enabled.');
      } else {
        await onGrantDrivePermission();
        setDriveSuccess('Google Drive workspace permission enabled.');
      }
    } catch (err: any) {
      const msg = err?.message || 'Permission request could not be completed.';
      if (kind === 'gmail') setGmailError(msg);
      else setDriveError(msg);
    } finally {
      setGrantingPerm(null);
    }
  };

  const handleSendGmailTest = async () => {
    setGmailError(null);
    setGmailSuccess(null);
    if (!gmailTestRecipient.trim()) {
      setGmailError('Enter a recipient email address for the Gmail test.');
      return;
    }
    setGmailSendingTest(true);
    try {
      const res = await workspaceApi.sendGmailTestEmail({
        recipientEmail: gmailTestRecipient.trim(),
        senderName: smtpSenderName.trim() || undefined,
      });
      setGmailSuccess(
        `Gmail API test email sent from ${res.senderEmail} to ${gmailTestRecipient.trim()} (Message ID: ${res.messageId || 'confirmed'}).`
      );
    } catch (err: any) {
      setGmailError(err?.message || 'Failed to send Gmail API test email.');
    } finally {
      setGmailSendingTest(false);
    }
  };

  const handleSelectSmtpProvider = (provider: SmtpProviderMethod) => {
    setSmtpProvider(provider);
    setSmtpError(null);
    setSmtpSuccess(null);
    if (provider === 'gmail_smtp') {
      setSmtpHost('smtp.gmail.com');
      setSmtpPort(465);
      setSmtpEncryption('SSL');
    } else {
      if (smtpHost === 'smtp.gmail.com') setSmtpHost('');
      setSmtpPort(587);
      setSmtpEncryption('STARTTLS');
    }
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpError(null);
    setSmtpSuccess(null);
    setSmtpSaving(true);
    try {
      const saved = await workspaceApi.saveSmtpConfig({
        provider: smtpProvider,
        host: smtpProvider === 'gmail_smtp' ? 'smtp.gmail.com' : smtpHost.trim(),
        port: Number(smtpPort),
        encryption: smtpEncryption,
        username: smtpUsername.trim(),
        password: smtpPassword.trim() || undefined,
        senderName: smtpSenderName.trim(),
        senderEmail: (smtpSenderEmail || smtpUsername).trim(),
        replyTo: smtpReplyTo.trim() || undefined,
      });
      setSmtpConfig(saved);
      setSmtpPassword('');
      setSmtpSuccess(
        'SMTP settings encrypted with AES-256-GCM and saved inside your Google Drive workspace/email-settings.json.'
      );
    } catch (err: any) {
      setSmtpError(err?.message || 'Failed to save SMTP configuration.');
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpError(null);
    setSmtpSuccess(null);
    setSmtpTesting(true);
    try {
      const res = await workspaceApi.testSmtpConfig({
        provider: smtpProvider,
        host: smtpProvider === 'gmail_smtp' ? 'smtp.gmail.com' : smtpHost.trim(),
        port: Number(smtpPort),
        encryption: smtpEncryption,
        username: smtpUsername.trim(),
        password: smtpPassword.trim() || undefined,
        senderName: smtpSenderName.trim(),
        senderEmail: (smtpSenderEmail || smtpUsername).trim(),
        replyTo: smtpReplyTo.trim() || undefined,
      });
      setSmtpSuccess(`SMTP connection verified successfully (${res.host}:${res.port}).`);
    } catch (err: any) {
      setSmtpError(err?.message || 'SMTP connection verification failed.');
    } finally {
      setSmtpTesting(false);
    }
  };

  const handleSendTestSmtpEmail = async () => {
    setSmtpError(null);
    setSmtpSuccess(null);
    if (!testEmailRecipient.trim()) {
      setSmtpError('Enter a recipient email address for the SMTP test email.');
      return;
    }
    setSmtpSendingTest(true);
    try {
      const res = await workspaceApi.sendTestEmail(testEmailRecipient.trim());
      setSmtpSuccess(
        `SMTP test email sent to ${testEmailRecipient.trim()} (Message ID: ${res.messageId || 'confirmed'}).`
      );
    } catch (err: any) {
      setSmtpError(err?.message || 'Failed to send SMTP test email.');
    } finally {
      setSmtpSendingTest(false);
    }
  };

  const handleDeleteSmtp = async () => {
    setSmtpError(null);
    setSmtpSuccess(null);
    try {
      await workspaceApi.deleteSmtpConfig();
      setSmtpConfig({
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
      });
      setSmtpUsername('');
      setSmtpPassword('');
      setSmtpSenderName('');
      setSmtpSenderEmail('');
      setSmtpReplyTo('');
      setConfirmDeleteSmtp(false);
      setSmtpSuccess('Encrypted SMTP configuration removed from your Google Drive folder.');
    } catch (err: any) {
      setSmtpError(err?.message || 'Failed to delete SMTP configuration.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Google Account, Drive &amp; Email Settings
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Connect one Google account to power private Google Drive workspace storage, Google
            Sheets importing, and direct Gmail API delivery — with no central database or service
            account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab('email')}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-2 self-start sm:self-auto cursor-pointer"
        >
          <Mail className="w-3.5 h-3.5" />
          <span>Open Email Center</span>
        </button>
      </div>

      {/* SECTION 1: GOOGLE ACCOUNT & SEPARATE PERMISSION STATUSES */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                isAccessExpired || isPermissionMissing
                  ? 'bg-amber-600 text-white'
                  : googleSession
                    ? 'bg-emerald-600 text-white'
                    : 'bg-indigo-600 text-white'
              }`}
            >
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Google Account Connection &amp; Permissions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Temporary access tokens stay strictly in browser memory and are verified on every
                backend request. Tokens are never saved to localStorage, cookies, or any database.
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold self-start md:self-auto whitespace-nowrap ${
              isAccessExpired || isPermissionMissing
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : connectionStatus === 'sync_failed'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : driveConnection?.isConnected || googleSession
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isAccessExpired ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : isPermissionMissing ? (
              <ShieldAlert className="w-3.5 h-3.5" />
            ) : driveConnection?.isConnected || googleSession ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <CloudOff className="w-3.5 h-3.5" />
            )}
            <span>{GOOGLE_STATUS_LABELS[connectionStatus]}</span>
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* OAuth Env Missing Warning */}
          {!publicConfig.configured && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="font-bold">Google OAuth Client Configuration Required</p>
                <p className="leading-relaxed">
                  Add <code className="font-mono break-all">VITE_GOOGLE_CLIENT_ID</code> (plus{' '}
                  <code className="font-mono break-all">VITE_GOOGLE_API_KEY</code> and{' '}
                  <code className="font-mono break-all">VITE_GOOGLE_APP_ID</code> for Google Picker)
                  in your deployment environment variables to enable live Google Account connection.
                </p>
              </div>
            </div>
          )}

          {/* Access Expired Banner */}
          {isAccessExpired && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold">Access Expired — Reconnect Google Account</p>
                  <p className="text-amber-900 leading-relaxed">
                    Your temporary in-memory Google access token has expired or was revoked.{' '}
                    {hasUnsavedChanges
                      ? 'Your unsaved changes are safely preserved in this tab and will sync immediately after reconnecting.'
                      : 'Reconnect your Google account to resume Drive sync, Sheets import, and Gmail sending.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onReconnectGoogleAccount()}
                className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reconnect Google Account</span>
              </button>
            </div>
          )}

          {/* Account Summary Bar + Actions */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {googleSession?.picture ? (
                <img
                  src={googleSession.picture}
                  alt={googleSession.name || googleSession.email}
                  className="w-10 h-10 rounded-xl border border-slate-200 object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0">
                {googleSession ? (
                  <>
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {googleSession.email}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {googleSession.name ? `${googleSession.name} · ` : ''}
                      Verified Google session in memory (isolated per Google account)
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-slate-900">No Google Account Connected</p>
                    <p className="text-xs text-slate-500">
                      Click Connect Google Account to access your own Google Drive, Google Sheets,
                      and Gmail sending.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!googleSession ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onConnectGoogleAccount()}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
                >
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Cloud className="w-4 h-4" />
                  )}
                  <span>Connect Google Account</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={testingConnection || isAccessExpired}
                    onClick={handleTestConnection}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {testingConnection ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                    )}
                    <span>Test Connection</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void onSwitchGoogleAccount()}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Switch Account</span>
                  </button>

                  {!confirmDisconnect ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="px-3.5 py-2 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>Disconnect</span>
                    </button>
                  ) : (
                    <div className="inline-flex flex-wrap items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5">
                      <span className="text-xs font-semibold text-rose-800">
                        {hasUnsavedChanges
                          ? 'Unsaved edits exist! Disconnect & clear memory?'
                          : 'Revoke session & clear memory?'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDisconnect(false);
                          setTestResult(null);
                          onDisconnectDrive();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer"
                      >
                        Yes, Disconnect
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(false)}
                        className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 4 Separate Permission Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Identity */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  Google Identity
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                    perms.identityConnected && !isAccessExpired
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  {perms.identityConnected && !isAccessExpired ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Verifies your Google email and immutable account ID (<code className="font-mono">openid email</code>).
              </p>
            </div>

            {/* 2. Google Drive */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between gap-2.5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-indigo-600" />
                    Google Drive
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                      perms.driveGranted && !isAccessExpired
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : googleSession
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    {perms.driveGranted && !isAccessExpired
                      ? 'Granted'
                      : googleSession
                        ? 'Missing'
                        : 'Not connected'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Private business storage in your own Drive folder (<code className="font-mono">drive.file</code>).
                </p>
              </div>
              {googleSession && !perms.driveGranted && (
                <button
                  type="button"
                  disabled={grantingPerm === 'drive'}
                  onClick={() => void handleGrantPerm('drive')}
                  className="w-full py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {grantingPerm === 'drive' && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Grant Drive Permission</span>
                </button>
              )}
            </div>

            {/* 3. Google Sheets */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between gap-2.5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    Google Sheets
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                      perms.sheetsGranted && !isAccessExpired
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : googleSession
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    {perms.sheetsGranted && !isAccessExpired
                      ? 'Granted'
                      : googleSession
                        ? 'Missing'
                        : 'Not connected'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Read spreadsheets &amp; worksheets (<code className="font-mono">spreadsheets.readonly</code>).
                </p>
              </div>
              {googleSession && !perms.sheetsGranted && (
                <button
                  type="button"
                  disabled={grantingPerm === 'sheets'}
                  onClick={() => void handleGrantPerm('sheets')}
                  className="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {grantingPerm === 'sheets' && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Grant Sheets Permission</span>
                </button>
              )}
            </div>

            {/* 4. Gmail Send (Optional Incremental) */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between gap-2.5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-rose-600" />
                    Gmail Send
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                      perms.gmailGranted && !isAccessExpired
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    {perms.gmailGranted && !isAccessExpired ? 'Granted' : 'Not enabled'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Optional incremental scope (<code className="font-mono">gmail.send</code>) to email PDFs directly.
                </p>
              </div>
              {googleSession && !perms.gmailGranted && (
                <button
                  type="button"
                  disabled={grantingPerm === 'gmail'}
                  onClick={() => void handleGrantPerm('gmail')}
                  className="w-full py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {grantingPerm === 'gmail' && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Enable Gmail Permission</span>
                </button>
              )}
            </div>
          </div>

          {/* Live Diagnostic Test Result */}
          {testResult && (
            <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-950 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  Backend Verification Passed ({testResult.email})
                </span>
                <span className="text-[11px] text-indigo-700">
                  {new Date(testResult.checkedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[11px] text-indigo-900">
                Drive: <strong>{testResult.permissions.driveGranted ? 'Yes' : 'No'}</strong> ·
                Sheets: <strong>{testResult.permissions.sheetsGranted ? 'Yes' : 'No'}</strong> ·
                Gmail: <strong>{testResult.permissions.gmailGranted ? 'Yes' : 'No'}</strong>
                {testResult.folderName && (
                  <>
                    {' '}
                    · Active Folder:{' '}
                    <strong>
                      {testResult.folderName} ({testResult.folderOk ? 'Accessible' : 'Error'})
                    </strong>
                  </>
                )}
              </p>
              {testResult.folderError && (
                <p className="text-[11px] text-rose-700 font-medium">{testResult.folderError}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* SECTION 2: GOOGLE DRIVE WORKSPACE STORAGE */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Google Drive Workspace Storage</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Auto-creates or opens your business&apos;s <code className="font-mono">Invoice Studio</code>{' '}
                folder, or connect any folder via Google Picker or Drive folder URL.
              </p>
            </div>
          </div>
          {driveConnection?.isConnected && (
            <a
              href={`https://drive.google.com/drive/folders/${driveConnection.folderId}`}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 self-start md:self-auto"
            >
              <span>Open Folder in Drive</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Columns */}
          <div className="lg:col-span-2 space-y-5">
            {/* Sync Conflict Resolution Card */}
            {syncConflict && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-bold">Sync Conflict Detected ({syncConflict.fileName})</p>
                    <p className="leading-relaxed">{syncConflict.message}</p>
                    <p className="text-[11px] text-rose-800">
                      Remote Drive modified time:{' '}
                      <strong>
                        {syncConflict.remoteModifiedTime
                          ? new Date(syncConflict.remoteModifiedTime).toLocaleString()
                          : 'Unknown'}
                      </strong>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={conflictBusy}
                    onClick={async () => {
                      setConflictBusy(true);
                      try {
                        await onResolveConflictReload();
                        setDriveSuccess('Reloaded the latest workspace data from Google Drive.');
                      } catch (err: any) {
                        setDriveError(err?.message || 'Failed to reload latest Drive workspace.');
                      } finally {
                        setConflictBusy(false);
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reload Latest from Drive</span>
                  </button>

                  {!confirmOverwriteConflict ? (
                    <button
                      type="button"
                      disabled={conflictBusy}
                      onClick={() => setConfirmOverwriteConflict(true)}
                      className="px-3.5 py-2 rounded-xl bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>Backup Remote &amp; Overwrite</span>
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-2 bg-white border border-rose-300 rounded-xl px-3 py-1.5">
                      <span className="text-xs font-semibold text-rose-900">
                        Save backup first &amp; push local changes?
                      </span>
                      <button
                        type="button"
                        disabled={conflictBusy}
                        onClick={async () => {
                          setConfirmOverwriteConflict(false);
                          setConflictBusy(true);
                          try {
                            await onResolveConflictOverwrite();
                            setDriveSuccess(
                              'Backed up the remote copy in Backups/ and synced your local changes.'
                            );
                          } catch (err: any) {
                            setDriveError(err?.message || 'Failed to resolve conflict.');
                          } finally {
                            setConflictBusy(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmOverwriteConflict(false)}
                        className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Active Folder & Folder Controls */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
              {driveConnection?.isConnected ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500">Connected Folder</p>
                    <p className="font-bold text-slate-900 mt-0.5 truncate">
                      {driveConnection.folderName}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
                      ID: {driveConnection.folderId}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-slate-200">
                    <p className="text-[11px] font-semibold text-slate-500">Owner Account</p>
                    <p className="font-bold text-slate-900 mt-0.5 truncate">
                      {driveConnection.accountEmail}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Last synced:{' '}
                      {driveConnection.lastSyncedAt
                        ? new Date(driveConnection.lastSyncedAt).toLocaleString()
                        : 'Pending'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-600 flex items-start gap-2">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    {googleSession
                      ? 'Choose or create a Google Drive folder below to load your existing workspace or initialize a fresh one.'
                      : 'Connect your Google account above to automatically open or create your private Invoice Studio Drive folder.'}
                  </span>
                </div>
              )}

              {/* Folder Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {driveConnection?.isConnected && (
                  <button
                    type="button"
                    onClick={handleManualDriveSync}
                    disabled={driveSyncing || isBusy || !canUseDriveApi}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {driveSyncing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Sync Now</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={isBusy || !googleSession || isAccessExpired || !perms.driveGranted}
                  onClick={() => void onCreateDefaultFolder()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Create / Open &ldquo;Invoice Studio&rdquo;</span>
                </button>

                <button
                  type="button"
                  disabled={isBusy || !googleSession || isAccessExpired || !perms.driveGranted}
                  onClick={() => void onSelectExistingFolder()}
                  className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{driveConnection?.isConnected ? 'Change Folder (Picker)' : 'Select Folder (Picker)'}</span>
                </button>

                {driveConnection?.isConnected && (
                  <button
                    type="button"
                    onClick={handleCreateDriveBackup}
                    disabled={driveBackupLoading || isBusy || !canUseDriveApi}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {driveBackupLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Archive className="w-3.5 h-3.5" />
                    )}
                    <span>Create Backup</span>
                  </button>
                )}
              </div>

              {/* Paste Drive Folder URL Option */}
              <form
                onSubmit={handleConnectFolderUrlSubmit}
                className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row gap-2"
              >
                <div className="relative flex-1">
                  <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={folderUrlInput}
                    onChange={(e) => setFolderUrlInput(e.target.value)}
                    disabled={!googleSession || isAccessExpired || !perms.driveGranted}
                    placeholder="Or paste Google Drive folder URL (https://drive.google.com/drive/folders/...) or Folder ID"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={
                    connectingFolderUrl ||
                    !folderUrlInput.trim() ||
                    !googleSession ||
                    isAccessExpired ||
                    !perms.driveGranted
                  }
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  {connectingFolderUrl ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5" />
                  )}
                  <span>Connect Folder URL</span>
                </button>
              </form>
            </div>

            {/* Feedback Alerts */}
            {(driveError || driveSyncError) && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Google Drive Sync Notice</p>
                  <p>{driveError || driveSyncError}</p>
                </div>
              </div>
            )}

            {driveSuccess && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="font-medium">{driveSuccess}</p>
              </div>
            )}

            {/* Storage Summary Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Sync Status</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {GOOGLE_STATUS_LABELS[connectionStatus]}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Workspace Records</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {localCounts.invoices} Inv · {localCounts.quotations} Qt · {localCounts.customers}{' '}
                  Cust
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Drive Files</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {driveCounts.invoices} Inv · {driveCounts.quotations} Qt · {driveCounts.assets}{' '}
                  Assets
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Backups</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {driveBackups.length} Snapshot{driveBackups.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            {/* Available Backups with Restore + Confirmed Delete */}
            {driveConnection?.isConnected && driveBackups.length > 0 && (
              <div className="border border-slate-200 rounded-2xl p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Available Drive Backups ({driveBackups.length})
                </h3>
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {driveBackups.map((b) => (
                    <div key={b.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{b.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {b.modifiedTime ? new Date(b.modifiedTime).toLocaleString() : 'Snapshot'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={driveRestoringId === b.id || !canUseDriveApi}
                          onClick={() => setConfirmRestoreBackup(b)}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white disabled:opacity-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          {driveRestoringId === b.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          <span>Restore</span>
                        </button>
                        <button
                          type="button"
                          disabled={driveDeletingId === b.id || !canUseDriveApi}
                          onClick={() => setConfirmDeleteBackup(b)}
                          title="Move backup snapshot to Drive Trash"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-600 hover:text-white disabled:opacity-50 text-slate-500 transition-colors cursor-pointer"
                        >
                          {driveDeletingId === b.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Auto-Created Folder Hierarchy */}
          <div className="bg-slate-900 text-slate-100 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-300 uppercase tracking-wide">
              <FolderTree className="w-4 h-4" />
              <span>Your Drive Folder Layout</span>
            </div>
            <p className="text-xs text-slate-400">
              Automatically created inside your Google Drive workspace without duplicating existing
              folders:
            </p>
            <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed bg-slate-950/70 rounded-xl p-3.5 overflow-x-auto border border-slate-800">
              {DRIVE_FOLDER_TREE.join('\n')}
            </pre>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Every business owns its own Drive files. No central database, service account, or
              shared global workspace is ever used.
            </p>
          </div>
        </div>
      </section>

      {/* Restore Backup Confirmation Modal */}
      {confirmRestoreBackup && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Restore Google Drive Backup?</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This will replace your current workspace records with snapshot{' '}
                  <strong className="text-slate-900">{confirmRestoreBackup.name}</strong> and sync
                  it to your connected Google Drive folder. Existing backup files are preserved.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRestoreBackup(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestoreBackup}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
              >
                Yes, Restore Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Backup Confirmation Modal */}
      {confirmDeleteBackup && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Backup File?</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Move <strong className="text-slate-900">{confirmDeleteBackup.name}</strong> to
                  your Google Drive Trash? Your live workspace files will not be affected.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteBackup(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteBackup}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Yes, Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: EMAIL SETTINGS — GMAIL API (DEFAULT) & CUSTOM SMTP (OPTIONAL) */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Email Delivery — Gmail API (Default) &amp; Optional Custom SMTP
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Send invoices and quotations with PDF attachments directly through your connected
                Google account using the Gmail API. Custom SMTP remains available as an optional
                business-owned alternative.
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 self-start md:self-auto ${
              perms.gmailGranted && !isAccessExpired
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : smtpConfig.configured
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            {perms.gmailGranted && !isAccessExpired ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Gmail API Ready</span>
              </>
            ) : smtpConfig.configured ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Custom SMTP Ready</span>
              </>
            ) : (
              <span>Enable Gmail or Configure SMTP</span>
            )}
          </span>
        </div>

        <div className="p-6 space-y-6">
          {/* Option 1: Gmail API (Default & Recommended) */}
          <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/30 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                    Default · Recommended
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    Scope: <code className="font-mono">gmail.send</code> (incremental)
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  Send via Connected Gmail Account (Gmail API)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  No SMTP host, port, or App Password needed. Invoice Studio requests the optional{' '}
                  <code className="font-mono">gmail.send</code> scope only when you enable it, and
                  dispatches PDF attachments directly from your verified Google address.
                </p>
              </div>

              {googleSession ? (
                perms.gmailGranted && !isAccessExpired ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold shrink-0 self-start sm:self-center">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Gmail Permission Active</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={grantingPerm === 'gmail' || isAccessExpired}
                    onClick={() => void handleGrantPerm('gmail')}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-2 shrink-0 self-start sm:self-center cursor-pointer"
                  >
                    {grantingPerm === 'gmail' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4" />
                    )}
                    <span>Enable Gmail Permission</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => void onConnectGoogleAccount()}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-2 shrink-0 self-start sm:self-center cursor-pointer"
                >
                  <Cloud className="w-4 h-4" />
                  <span>Connect Google Account First</span>
                </button>
              )}
            </div>

            {googleSession && perms.gmailGranted && !isAccessExpired && (
              <div className="bg-white rounded-xl border border-indigo-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">
                    Authenticated Sender:{' '}
                    <strong className="text-slate-900">{googleSession.email}</strong>
                  </span>
                  <span className="text-[11px] text-emerald-700 font-semibold">
                    RFC-2822 MIME + PDF attachment ready
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    value={gmailTestRecipient}
                    onChange={(e) => setGmailTestRecipient(e.target.value)}
                    placeholder="Recipient email for Gmail API test"
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={gmailSendingTest}
                    onClick={handleSendGmailTest}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {gmailSendingTest ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Send Gmail Test Email</span>
                  </button>
                </div>
              </div>
            )}

            {gmailError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{gmailError}</span>
              </div>
            )}

            {gmailSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{gmailSuccess}</span>
              </div>
            )}
          </div>

          {/* Option 2: Optional Custom SMTP / Gmail SMTP Collapsible Panel */}
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSmtpSection((prev) => !prev)}
              className="w-full px-5 py-4 bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <Server className="w-4 h-4 text-slate-600 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    Optional Alternative: Custom Business SMTP / Gmail SMTP
                  </p>
                  <p className="text-xs text-slate-500">
                    Use your own domain mail server (Zoho, Outlook 365, SES, cPanel) — encrypted
                    with AES-256-GCM inside your own Drive&apos;s{' '}
                    <code className="font-mono">workspace/email-settings.json</code>.
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-indigo-600 shrink-0">
                {showSmtpSection ? 'Hide SMTP' : 'Configure SMTP'}
              </span>
            </button>

            {showSmtpSection && (
              <div className="p-5 border-t border-slate-200 space-y-5 bg-white">
                {!canUseDriveApi && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Connect Your Google Drive Folder First</p>
                      <p className="mt-0.5 leading-relaxed">
                        To keep every business&apos;s SMTP credentials isolated without a central
                        database, encrypted SMTP settings are saved strictly inside your own
                        connected Google Drive folder.
                      </p>
                    </div>
                  </div>
                )}

                {diagnostics && !diagnostics.smtpEncryptionConfigured && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Server environment variable <code className="font-mono">SMTP_ENCRYPTION_KEY</code>{' '}
                      is not set yet. Configure a strong 32+ character secret before saving
                      production SMTP passwords.
                    </span>
                  </div>
                )}

                {/* SMTP Sub-Provider Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleSelectSmtpProvider('custom_smtp')}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                      smtpProvider === 'custom_smtp'
                        ? 'border-indigo-600 bg-indigo-50/50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <p className="text-xs font-bold text-slate-900">Custom Business SMTP</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Zoho Mail, Microsoft 365, AWS SES, Fastmail, or cPanel SMTP
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectSmtpProvider('gmail_smtp')}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                      smtpProvider === 'gmail_smtp'
                        ? 'border-indigo-600 bg-indigo-50/50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <p className="text-xs font-bold text-slate-900">Gmail SMTP (App Password)</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Uses <code className="font-mono">smtp.gmail.com:465</code> with a 16-char App
                      Password
                    </p>
                  </button>
                </div>

                <form onSubmit={handleSaveSmtp} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        SMTP Host *
                      </label>
                      <input
                        type="text"
                        required
                        disabled={smtpProvider === 'gmail_smtp'}
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="smtp.yourcompany.com"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Port *
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={65535}
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Encryption
                      </label>
                      <select
                        value={smtpEncryption}
                        onChange={(e) =>
                          setSmtpEncryption(e.target.value as 'SSL' | 'STARTTLS' | 'NONE')
                        }
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="STARTTLS">STARTTLS (Port 587)</option>
                        <option value="SSL">SSL / TLS (Port 465)</option>
                        <option value="NONE">None</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        SMTP Username *
                      </label>
                      <input
                        type="text"
                        required
                        value={smtpUsername}
                        onChange={(e) => setSmtpUsername(e.target.value)}
                        placeholder="billing@yourcompany.com"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        SMTP Password / App Password {smtpConfig.hasPassword ? '(Saved — leave blank to keep)' : '*'}
                      </label>
                      <div className="relative">
                        <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="password"
                          required={!smtpConfig.hasPassword}
                          value={smtpPassword}
                          onChange={(e) => setSmtpPassword(e.target.value)}
                          placeholder={smtpConfig.hasPassword ? '••••••••••••' : 'Enter SMTP password'}
                          className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sender Name
                      </label>
                      <input
                        type="text"
                        value={smtpSenderName}
                        onChange={(e) => setSmtpSenderName(e.target.value)}
                        placeholder="Acme Billing"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sender Email *
                      </label>
                      <input
                        type="email"
                        required
                        value={smtpSenderEmail}
                        onChange={(e) => setSmtpSenderEmail(e.target.value)}
                        placeholder="billing@yourcompany.com"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Reply-To (Optional)
                      </label>
                      <input
                        type="email"
                        value={smtpReplyTo}
                        onChange={(e) => setSmtpReplyTo(e.target.value)}
                        placeholder="accounts@yourcompany.com"
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={smtpSaving || !canUseDriveApi}
                      className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {smtpSaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>Save Encrypted SMTP in Drive</span>
                    </button>

                    <button
                      type="button"
                      disabled={smtpTesting || !canUseDriveApi}
                      onClick={handleTestSmtp}
                      className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {smtpTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                      )}
                      <span>Verify SMTP</span>
                    </button>

                    {smtpConfig.configured && !confirmDeleteSmtp && (
                      <button
                        type="button"
                        disabled={!canUseDriveApi}
                        onClick={() => setConfirmDeleteSmtp(true)}
                        className="px-3.5 py-2 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 disabled:opacity-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove SMTP</span>
                      </button>
                    )}

                    {confirmDeleteSmtp && (
                      <div className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5 ml-auto">
                        <span className="text-xs font-semibold text-rose-800">
                          Delete encrypted SMTP from Drive?
                        </span>
                        <button
                          type="button"
                          onClick={handleDeleteSmtp}
                          className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer"
                        >
                          Yes, Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSmtp(false)}
                          className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </form>

                {smtpConfig.configured && (
                  <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={testEmailRecipient}
                      onChange={(e) => setTestEmailRecipient(e.target.value)}
                      placeholder="Recipient email for SMTP test"
                      className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={smtpSendingTest || !canUseDriveApi}
                      onClick={handleSendTestSmtpEmail}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {smtpSendingTest ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Send SMTP Test Email</span>
                    </button>
                  </div>
                )}

                {smtpError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{smtpError}</span>
                  </div>
                )}

                {smtpSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{smtpSuccess}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
