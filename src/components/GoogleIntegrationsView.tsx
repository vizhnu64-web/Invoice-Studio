/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  FolderTree,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Unlink,
  Wifi,
} from 'lucide-react';
import {
  BackendSmtpConfig,
  DriveWorkspaceConnection,
  EmailDeliveryMethod,
  IntegrationDiagnostics,
} from '../types';
import type { DriveSyncState } from '../App';
import { extractDriveFolderId } from '../utils/googleSheets';
import {
  DriveBackupFile,
  DriveConnectResponse,
  workspaceApi,
} from '../utils/workspaceApi';

interface GoogleIntegrationsViewProps {
  driveConnection: DriveWorkspaceConnection | null;
  driveSyncState: DriveSyncState;
  driveSyncError: string | null;
  diagnostics: IntegrationDiagnostics | null;
  smtpConfig: BackendSmtpConfig;
  setSmtpConfig: React.Dispatch<React.SetStateAction<BackendSmtpConfig>>;
  onDriveConnected: (response: DriveConnectResponse) => void;
  onDisconnectDrive: () => void;
  onManualSync: () => Promise<any>;
  onRestoredSnapshot: (snapshot: any) => void;
  onNavigateTab: (tab: string) => void;
  localCounts: {
    quotations: number;
    invoices: number;
    customers: number;
    emailLogs: number;
  };
}

const DRIVE_FOLDER_TREE = [
  'Invoice Studio/',
  '  ├── Company Settings/',
  '  ├── Customers/',
  '  ├── Imported Data/',
  '  ├── Invoices/',
  '  │     ├── PDFs/',
  '  │     └── Records/',
  '  ├── Quotations/',
  '  │     ├── PDFs/',
  '  │     └── Records/',
  '  ├── Email History/',
  '  └── Backups/',
];

export const GoogleIntegrationsView: React.FC<GoogleIntegrationsViewProps> = ({
  driveConnection,
  driveSyncState,
  driveSyncError,
  diagnostics,
  smtpConfig,
  setSmtpConfig,
  onDriveConnected,
  onDisconnectDrive,
  onManualSync,
  onRestoredSnapshot,
  onNavigateTab,
  localCounts,
}) => {
  // Drive Folder Connection State
  const [folderUrlInput, setFolderUrlInput] = useState(driveConnection?.folderUrl || '');
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveTesting, setDriveTesting] = useState(false);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveBackupLoading, setDriveBackupLoading] = useState(false);
  const [driveRestoringId, setDriveRestoringId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccess, setDriveSuccess] = useState<string | null>(null);
  const [permissionEmailHint, setPermissionEmailHint] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [backups, setBackups] = useState<DriveBackupFile[]>([]);
  const [pdfCounts, setPdfCounts] = useState<{ invoices: number; quotations: number }>({
    invoices: 0,
    quotations: 0,
  });

  // SMTP Email Configuration State (Option A: Gmail SMTP | Option B: Custom SMTP)
  const [smtpProvider, setSmtpProvider] = useState<EmailDeliveryMethod>(
    smtpConfig.provider || 'gmail_smtp'
  );
  const [smtpHost, setSmtpHost] = useState(smtpConfig.host || 'smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState<number>(smtpConfig.port || 465);
  const [smtpEncryption, setSmtpEncryption] = useState<'SSL' | 'STARTTLS' | 'NONE'>(
    smtpConfig.encryption || 'SSL'
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
    setFolderUrlInput(driveConnection?.folderUrl || '');
  }, [driveConnection?.folderUrl]);

  useEffect(() => {
    setSmtpProvider(smtpConfig.provider || 'gmail_smtp');
    setSmtpHost(
      smtpConfig.provider === 'gmail_smtp' ? 'smtp.gmail.com' : smtpConfig.host || ''
    );
    setSmtpPort(smtpConfig.port || (smtpConfig.provider === 'gmail_smtp' ? 465 : 587));
    setSmtpEncryption(smtpConfig.encryption || 'SSL');
    setSmtpUsername(smtpConfig.username || '');
    setSmtpSenderName(smtpConfig.senderName || '');
    setSmtpSenderEmail(smtpConfig.senderEmail || '');
    setSmtpReplyTo(smtpConfig.replyTo || '');
  }, [smtpConfig]);

  useEffect(() => {
    if (!driveConnection?.isConnected) {
      setBackups([]);
      setPdfCounts({ invoices: 0, quotations: 0 });
      return;
    }
    let active = true;
    workspaceApi
      .fetchDriveStatus()
      .then((status) => {
        if (!active) return;
        setBackups(status.backups || []);
        setPdfCounts({
          invoices: status.invoicePdfCount || 0,
          quotations: status.quotationPdfCount || 0,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [driveConnection?.isConnected, driveConnection?.folderId]);

  const serviceAccountEmail =
    permissionEmailHint ||
    driveConnection?.serviceAccountEmail ||
    diagnostics?.serviceAccountEmail ||
    null;

  const handleCopyServiceEmail = async () => {
    if (!serviceAccountEmail) return;
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleConnectDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    setDriveError(null);
    setDriveSuccess(null);
    setPermissionEmailHint(null);

    const trimmed = folderUrlInput.trim();
    const extracted = extractDriveFolderId(trimmed);
    if (!extracted) {
      setDriveError(
        'Invalid Google Drive folder URL. Paste a link like https://drive.google.com/drive/folders/<folder-id>.'
      );
      return;
    }

    setDriveLoading(true);
    try {
      const response = await workspaceApi.connectDriveFolder(trimmed);
      onDriveConnected(response);
      setBackups(response.backups || []);
      setDriveSuccess(
        response.restoredExistingWorkspace
          ? `Connected to "${response.folderName}" and restored existing Invoice Studio records.`
          : `Connected to "${response.folderName}" and initialized an empty Invoice Studio workspace.`
      );
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to connect Google Drive folder.');
      if (err?.details?.serviceAccountEmail) {
        setPermissionEmailHint(err.details.serviceAccountEmail);
      }
    } finally {
      setDriveLoading(false);
    }
  };

  const handleTestDrive = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setPermissionEmailHint(null);
    const targetUrl = folderUrlInput.trim() || driveConnection?.folderUrl || '';
    if (!targetUrl) {
      setDriveError('Paste a Google Drive folder URL before testing the connection.');
      return;
    }
    setDriveTesting(true);
    try {
      const res = await workspaceApi.testDriveConnection(targetUrl);
      setDriveSuccess(
        `Connection verified! Folder "${res.folderName}" is reachable with Editor permissions.`
      );
    } catch (err: any) {
      setDriveError(err?.message || 'Google Drive connection test failed.');
      if (err?.details?.serviceAccountEmail) {
        setPermissionEmailHint(err.details.serviceAccountEmail);
      }
    } finally {
      setDriveTesting(false);
    }
  };

  const handleManualDriveSync = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setDriveSyncing(true);
    try {
      const res = await onManualSync();
      if (res?.syncedAt) {
        setDriveSuccess(`Workspace synced to Google Drive at ${new Date(res.syncedAt).toLocaleTimeString()}.`);
      }
    } catch (err: any) {
      setDriveError(err?.message || 'Sync to Google Drive failed.');
    } finally {
      setDriveSyncing(false);
    }
  };

  const handleCreateBackup = async () => {
    setDriveError(null);
    setDriveSuccess(null);
    setDriveBackupLoading(true);
    try {
      await onManualSync();
      const res = await workspaceApi.createDriveBackup();
      setBackups(res.backups || []);
      setDriveSuccess(`Created backup snapshot "${res.backup.name}" in Backups/.`);
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to create Google Drive backup.');
    } finally {
      setDriveBackupLoading(false);
    }
  };

  const handleRestoreBackup = async (backupFileId: string) => {
    setDriveError(null);
    setDriveSuccess(null);
    setDriveRestoringId(backupFileId);
    try {
      const res = await workspaceApi.restoreDriveBackup(backupFileId);
      onRestoredSnapshot(res.snapshot);
      setDriveSuccess('Backup restored successfully into your workspace.');
    } catch (err: any) {
      setDriveError(err?.message || 'Failed to restore selected backup.');
    } finally {
      setDriveRestoringId(null);
    }
  };

  const handleSelectSmtpProvider = (provider: EmailDeliveryMethod) => {
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
        saved.persistedInDrive
          ? 'SMTP settings encrypted and saved to your Google Drive workspace.'
          : 'SMTP settings encrypted in server session memory. Connect a Google Drive folder to persist them across sessions.'
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

  const handleSendTestEmail = async () => {
    setSmtpError(null);
    setSmtpSuccess(null);
    if (!testEmailRecipient.trim()) {
      setSmtpError('Enter a recipient email address for the test email.');
      return;
    }
    setSmtpSendingTest(true);
    try {
      const res = await workspaceApi.sendTestEmail(testEmailRecipient.trim());
      setSmtpSuccess(
        `Test email sent to ${testEmailRecipient.trim()} (Message ID: ${res.messageId || 'confirmed'}).`
      );
    } catch (err: any) {
      setSmtpError(err?.message || 'Failed to send test email.');
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
        provider: 'gmail_smtp',
        host: 'smtp.gmail.com',
        port: 465,
        encryption: 'SSL',
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
      setSmtpSuccess('SMTP configuration removed.');
    } catch (err: any) {
      setSmtpError(err?.message || 'Failed to delete SMTP configuration.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Google Drive & Email Settings</h1>
          <p className="text-sm text-slate-500 mt-1">
            Connect your business Google Drive folder for persistent storage and configure Gmail
            SMTP or Custom SMTP for direct document delivery — no application sign-in required.
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

      {/* SECTION 1: GOOGLE DRIVE FOLDER CONNECTION */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                driveConnection?.isConnected
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 text-white'
              }`}
            >
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Google Drive Workspace Storage
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Paste a Google Drive folder URL shared with the Invoice Studio service account. Each
                connected folder acts as an isolated business workspace.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {driveConnection?.isConnected ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Connected: {driveConnection.folderName}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                <CloudOff className="w-3.5 h-3.5" />
                Temporary Session (Not Backed Up)
              </span>
            )}
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Columns: Connection Form, Controls & Status */}
          <div className="lg:col-span-2 space-y-5">
            {/* Service Account Sharing Instructions */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>How Service Account Folder Sharing Works</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                A Google Drive folder URL alone does not grant upload access. Share your business
                folder in Google Drive with the service account email below as{' '}
                <strong className="text-slate-900">Editor</strong>, then paste the folder URL and
                click <strong className="text-slate-900">Connect Folder</strong>.
              </p>
              {serviceAccountEmail ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <code className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-mono text-slate-900 break-all">
                    {serviceAccountEmail}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyServiceEmail}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedEmail ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedEmail ? 'Copied' : 'Copy Email'}</span>
                  </button>
                </div>
              ) : (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Server environment variables{' '}
                    <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and{' '}
                    <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code> are not
                    configured yet on this deployment. Add them on your server to enable live Google
                    Drive persistence.
                  </span>
                </div>
              )}
            </div>

            {/* Folder URL Form */}
            <form onSubmit={handleConnectDrive} className="space-y-3">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                Google Drive Folder URL
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={folderUrlInput}
                  onChange={(e) => setFolderUrlInput(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/1AbC2dEf3GhI..."
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={driveLoading}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  {driveLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Cloud className="w-4 h-4" />
                  )}
                  <span>{driveConnection?.isConnected ? 'Reconnect / Switch Folder' : 'Connect Folder'}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTestDrive}
                  disabled={driveTesting}
                  className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {driveTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  <span>Test Connection</span>
                </button>

                {driveConnection?.isConnected && (
                  <>
                    <button
                      type="button"
                      onClick={handleManualDriveSync}
                      disabled={driveSyncing}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {driveSyncing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>Sync Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCreateBackup}
                      disabled={driveBackupLoading}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {driveBackupLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Archive className="w-3.5 h-3.5" />
                      )}
                      <span>Create Backup</span>
                    </button>

                    {!confirmDisconnect ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(true)}
                        className="px-3.5 py-2 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                        <span>Disconnect Folder</span>
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5">
                        <span className="text-xs font-semibold text-rose-800">
                          Clear local session & disconnect?
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDisconnect(false);
                            onDisconnectDrive();
                            setDriveSuccess('Disconnected from Google Drive and cleared local cache.');
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
            </form>

            {/* Feedback Alerts */}
            {(driveError || driveSyncError) && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Google Drive Connection Error</p>
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

            {/* Current Storage Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Storage Status</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {driveConnection?.isConnected
                    ? driveSyncState === 'syncing'
                      ? 'Syncing...'
                      : driveSyncState === 'error'
                        ? 'Sync Error'
                        : 'Google Drive'
                    : 'Temporary Only'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Records in Session</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {localCounts.invoices} Inv · {localCounts.quotations} Qt · {localCounts.customers}{' '}
                  Cust
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Drive PDFs</p>
                <p className="text-xs font-bold text-slate-900 mt-1">
                  {pdfCounts.invoices} Inv · {pdfCounts.quotations} Qt
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">Last Sync</p>
                <p className="text-xs font-bold text-slate-900 mt-1 truncate">
                  {driveConnection?.lastSyncedAt
                    ? new Date(driveConnection.lastSyncedAt).toLocaleString()
                    : 'Never synced'}
                </p>
              </div>
            </div>

            {/* Backups List */}
            {driveConnection?.isConnected && backups.length > 0 && (
              <div className="border border-slate-200 rounded-2xl p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Available Drive Backups ({backups.length})
                </h3>
                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {backups.map((b) => (
                    <div key={b.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{b.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {b.modifiedTime ? new Date(b.modifiedTime).toLocaleString() : 'Snapshot'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={driveRestoringId === b.id}
                        onClick={() => handleRestoreBackup(b.id)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      >
                        {driveRestoringId === b.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        <span>Restore</span>
                      </button>
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
              <span>Managed Drive Structure</span>
            </div>
            <p className="text-xs text-slate-400">
              Automatically created inside your connected Google Drive folder:
            </p>
            <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed bg-slate-950/70 rounded-xl p-3.5 overflow-x-auto border border-slate-800">
              {DRIVE_FOLDER_TREE.join('\n')}
            </pre>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Structured JSON records and generated PDFs are stored directly in your folder. No
              third-party database is used.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 2: EMAIL INTEGRATION — GMAIL SMTP & CUSTOM SMTP */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Email Settings — Gmail SMTP & Custom SMTP
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Send invoices and quotations with PDF attachments directly from your own email
                account without signing in to Invoice Studio. Credentials are encrypted server-side.
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
              smtpConfig.configured
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            {smtpConfig.configured ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {smtpConfig.provider === 'gmail_smtp' ? 'Gmail SMTP Ready' : 'Custom SMTP Ready'}
              </>
            ) : (
              <span>Not Configured</span>
            )}
          </span>
        </div>

        <div className="p-6 space-y-6">
          {/* Option A vs Option B Switcher */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleSelectSmtpProvider('gmail_smtp')}
              className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                smtpProvider === 'gmail_smtp'
                  ? 'border-indigo-600 bg-indigo-50/50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-indigo-700">
                  Option A — Recommended for Gmail
                </span>
                {smtpProvider === 'gmail_smtp' && (
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                )}
              </div>
              <p className="text-sm font-bold text-slate-900 mt-1">Gmail SMTP (App Password)</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Uses smtp.gmail.com (Port 465 SSL or 587 STARTTLS) with a Google App Password.
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleSelectSmtpProvider('custom_smtp')}
              className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                smtpProvider === 'custom_smtp'
                  ? 'border-indigo-600 bg-indigo-50/50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Option B — Any Business Provider
                </span>
                {smtpProvider === 'custom_smtp' && (
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                )}
              </div>
              <p className="text-sm font-bold text-slate-900 mt-1">Custom SMTP Server</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Works with Zoho Mail, Outlook/Office 365, Brevo, Amazon SES, Hostinger, or cPanel.
              </p>
            </button>
          </div>

          {smtpProvider === 'gmail_smtp' && (
            <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-950 flex items-start gap-2.5">
              <KeyRound className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Important: Use a Gmail App Password</p>
                <p className="text-indigo-900 leading-relaxed">
                  Gmail SMTP requires a 16-character <strong>App Password</strong> generated from
                  your Google Account Security settings (2-Step Verification must be enabled). Do
                  not use your normal Gmail login password.
                </p>
              </div>
            </div>
          )}

          {/* SMTP Config Form */}
          <form onSubmit={handleSaveSmtp} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SMTP Host
                </label>
                <input
                  type="text"
                  value={smtpProvider === 'gmail_smtp' ? 'smtp.gmail.com' : smtpHost}
                  disabled={smtpProvider === 'gmail_smtp'}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.zoho.in or smtp.office365.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm disabled:bg-slate-100 disabled:text-slate-600"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SMTP Port
                </label>
                {smtpProvider === 'gmail_smtp' ? (
                  <select
                    value={smtpPort}
                    onChange={(e) => {
                      const p = Number(e.target.value);
                      setSmtpPort(p);
                      setSmtpEncryption(p === 465 ? 'SSL' : 'STARTTLS');
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm bg-white"
                  >
                    <option value={465}>465 (SSL / TLS)</option>
                    <option value={587}>587 (STARTTLS)</option>
                  </select>
                ) : (
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                    required
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Encryption Mode
                </label>
                <select
                  value={smtpEncryption}
                  onChange={(e) =>
                    setSmtpEncryption(e.target.value as 'SSL' | 'STARTTLS' | 'NONE')
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="SSL">SSL / TLS (Port 465)</option>
                  <option value="STARTTLS">STARTTLS (Port 587)</option>
                  {smtpProvider === 'custom_smtp' && <option value="NONE">None</option>}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {smtpProvider === 'gmail_smtp' ? 'Gmail Email Address (Username)' : 'SMTP Username'}
                </label>
                <input
                  type="text"
                  value={smtpUsername}
                  onChange={(e) => {
                    setSmtpUsername(e.target.value);
                    if (!smtpSenderEmail) setSmtpSenderEmail(e.target.value);
                  }}
                  placeholder={
                    smtpProvider === 'gmail_smtp' ? 'billing@gmail.com' : 'billing@yourdomain.com'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {smtpProvider === 'gmail_smtp' ? 'Gmail App Password' : 'SMTP Password'}
                  {smtpConfig.hasPassword && (
                    <span className="ml-2 text-[11px] font-medium text-emerald-700">
                      (Encrypted password saved — leave blank to keep existing)
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={
                    smtpConfig.hasPassword
                      ? '••••••••••••••• (unchanged)'
                      : smtpProvider === 'gmail_smtp'
                        ? '16-character App Password'
                        : 'Enter SMTP password'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                  required={!smtpConfig.hasPassword}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sender Name
                </label>
                <input
                  type="text"
                  value={smtpSenderName}
                  onChange={(e) => setSmtpSenderName(e.target.value)}
                  placeholder="Your Business Name"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sender Email
                </label>
                <input
                  type="email"
                  value={smtpSenderEmail}
                  onChange={(e) => setSmtpSenderEmail(e.target.value)}
                  placeholder="billing@yourdomain.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reply-To Address (Optional)
                </label>
                <input
                  type="email"
                  value={smtpReplyTo}
                  onChange={(e) => setSmtpReplyTo(e.target.value)}
                  placeholder="accounts@yourdomain.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="submit"
                disabled={smtpSaving}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
              >
                {smtpSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Email Settings</span>
              </button>

              <button
                type="button"
                onClick={handleTestSmtp}
                disabled={smtpTesting}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {smtpTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wifi className="w-4 h-4 text-indigo-600" />
                )}
                <span>Test SMTP Connection</span>
              </button>

              {smtpConfig.configured && !confirmDeleteSmtp && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteSmtp(true)}
                  className="px-3.5 py-2.5 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Credentials</span>
                </button>
              )}

              {confirmDeleteSmtp && (
                <div className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5">
                  <span className="text-xs font-semibold text-rose-800">Delete saved SMTP?</span>
                  <button
                    type="button"
                    onClick={handleDeleteSmtp}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer"
                  >
                    Confirm
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

          {/* Send Test Email Box */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 max-w-md">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Send a Test Email
              </label>
              <input
                type="email"
                value={testEmailRecipient}
                onChange={(e) => setTestEmailRecipient(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleSendTestEmail}
              disabled={smtpSendingTest || !smtpConfig.configured}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {smtpSendingTest ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Send Test Email</span>
            </button>
          </div>

          {smtpError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{smtpError}</span>
            </div>
          )}

          {smtpSuccess && (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{smtpSuccess}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
