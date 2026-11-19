/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  DownloadCloud,
  FolderTree,
  HardDrive,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Table2,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { BackendSmtpConfig } from '../types';
import {
  GoogleAccountUser,
  IntegrationDiagnostics,
} from '../utils/googleSheets';
import { DriveStatusPayload, workspaceApi } from '../utils/workspaceApi';

interface GoogleIntegrationsViewProps {
  authUser: GoogleAccountUser | null;
  diagnostics: IntegrationDiagnostics | null;
  smtpConfig: BackendSmtpConfig;
  setSmtpConfig: React.Dispatch<React.SetStateAction<BackendSmtpConfig>>;
  onRefreshAuthAndWorkspace: () => Promise<void>;
  onSignOutComplete: () => void;
  onSyncWorkspaceSnapshot: () => Promise<{
    filesSynced: number;
    quotationsSynced: number;
    invoicesSynced: number;
    customersSynced: number;
  }>;
  onNavigateTab: (tab: string) => void;
  localCounts?: {
    quotations: number;
    invoices: number;
    customers: number;
    emailLogs: number;
  };
}

const DRIVE_SUBFOLDERS = [
  { name: 'Application Data', detail: 'workspace-state.json, customers, quotations, invoices, smtp-config.enc.json' },
  { name: 'Company Assets', detail: 'Logos, signatures, and brand files' },
  { name: 'Generated PDFs', detail: 'Exported quotation & invoice PDFs' },
  { name: 'Email Records', detail: 'email-logs.json delivery history' },
  { name: 'Backups', detail: 'Timestamped full-workspace JSON snapshots' },
];

export const GoogleIntegrationsView: React.FC<GoogleIntegrationsViewProps> = ({
  authUser,
  diagnostics,
  smtpConfig,
  setSmtpConfig,
  onRefreshAuthAndWorkspace,
  onSignOutComplete,
  onSyncWorkspaceSnapshot,
  onNavigateTab,
  localCounts,
}) => {
  const [driveStatus, setDriveStatus] = useState<DriveStatusPayload | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Gmail & SMTP test email inputs
  const [gmailTestTo, setGmailTestTo] = useState(authUser?.email || '');
  const [smtpTestTo, setSmtpTestTo] = useState(authUser?.email || smtpConfig.senderEmail || '');
  const [confirmDeleteSmtp, setConfirmDeleteSmtp] = useState(false);

  // SMTP form state (password is write-only, never prefilled or saved in browser storage)
  const [smtpHost, setSmtpHost] = useState(smtpConfig.host || '');
  const [smtpPort, setSmtpPort] = useState(String(smtpConfig.port || 587));
  const [smtpSecurity, setSmtpSecurity] = useState<'SSL' | 'STARTTLS' | 'NONE'>(
    smtpConfig.securityMode || 'STARTTLS'
  );
  const [smtpUsername, setSmtpUsername] = useState(smtpConfig.username || '');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpSenderName, setSmtpSenderName] = useState(smtpConfig.senderName || '');
  const [smtpSenderEmail, setSmtpSenderEmail] = useState(smtpConfig.senderEmail || '');

  useEffect(() => {
    setSmtpHost(smtpConfig.host || '');
    setSmtpPort(String(smtpConfig.port || 587));
    setSmtpSecurity(smtpConfig.securityMode || 'STARTTLS');
    setSmtpUsername(smtpConfig.username || '');
    setSmtpSenderName(smtpConfig.senderName || '');
    setSmtpSenderEmail(smtpConfig.senderEmail || '');
    if (smtpConfig.senderEmail && !smtpTestTo) {
      setSmtpTestTo(smtpConfig.senderEmail);
    }
  }, [smtpConfig]);

  useEffect(() => {
    if (authUser?.email) {
      setGmailTestTo((prev) => prev || authUser.email);
      setSmtpTestTo((prev) => prev || authUser.email);
    }
  }, [authUser?.email]);

  useEffect(() => {
    if (!authUser?.userId) {
      setDriveStatus(null);
      return;
    }
    workspaceApi
      .getDriveStatus()
      .then((res) => setDriveStatus(res))
      .catch(() => {});
  }, [authUser?.userId, authUser?.driveConnected]);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    setNotice(null);
    try {
      await fn();
    } catch (err: any) {
      setNotice({
        type: 'error',
        text: err?.message || 'Operation failed. Please check your configuration and try again.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectFeature = (
    feature: 'signin' | 'drive' | 'sheets' | 'gmail',
    preferRedirect: boolean = false
  ) =>
    runAction(`connect_${feature}`, async () => {
      await workspaceApi.connectGoogle(feature, preferRedirect);
      await onRefreshAuthAndWorkspace();
      if (feature === 'signin' || feature === 'drive') {
        const st = await workspaceApi.getDriveStatus().catch(() => null);
        if (st) setDriveStatus(st);
      }
      setNotice({
        type: 'success',
        text:
          feature === 'signin'
            ? 'Signed in with your Google Account and connected your Google Drive workspace.'
            : `Connected ${feature.toUpperCase()} permission cleanly.`,
      });
    });

  const handleDisconnectFeature = (feature: 'all' | 'drive' | 'sheets' | 'gmail') =>
    runAction(`disconnect_${feature}`, async () => {
      await workspaceApi.disconnectGoogle(feature);
      if (feature === 'all') {
        setDriveStatus(null);
        onSignOutComplete();
        setNotice({
          type: 'info',
          text: 'Signed out cleanly and cleared local workspace cache. Your files remain safely stored in your Google Drive.',
        });
      } else {
        await onRefreshAuthAndWorkspace();
        setNotice({
          type: 'info',
          text: `Disconnected ${feature.toUpperCase()} permission.`,
        });
      }
    });

  const handleSyncDrive = () =>
    runAction('drive_sync', async () => {
      const res = await onSyncWorkspaceSnapshot();
      const st = await workspaceApi.getDriveStatus().catch(() => null);
      if (st) setDriveStatus(st);
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'success',
        text: `Synced ${res.filesSynced} files to Google Drive (${res.customersSynced} customers, ${res.quotationsSynced} quotations, ${res.invoicesSynced} invoices).`,
      });
    });

  const handleBackupDrive = () =>
    runAction('drive_backup', async () => {
      const res = await workspaceApi.createDriveBackup();
      setNotice({
        type: 'success',
        text: `Created backup snapshot "${res.fileName}" inside Invoice Studio/Backups.`,
      });
    });

  const handleRestoreDrive = () =>
    runAction('drive_restore', async () => {
      const res = await workspaceApi.restoreFromDrive();
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'success',
        text: `Restored from Google Drive: ${res.customersRestored} customers, ${res.quotationsRestored} quotations, ${res.invoicesRestored} invoices.`,
      });
    });

  const handleSendTestEmail = (method: 'gmail' | 'smtp') =>
    runAction(`test_email_${method}`, async () => {
      if (!authUser?.userId) {
        throw new Error('Sign in with Google first to send a test email via the backend server.');
      }
      const targetEmail = (method === 'gmail' ? gmailTestTo : smtpTestTo).trim();
      if (!targetEmail) {
        throw new Error('Enter a recipient email address for the test email.');
      }
      const res = await workspaceApi.sendTestEmail({
        method,
        to: targetEmail,
      });
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'success',
        text: `Test email delivered via ${method.toUpperCase()} from ${res.senderEmail} to ${res.recipientEmail}.`,
      });
    });

  const handleSaveSmtp = (e: React.FormEvent) => {
    e.preventDefault();
    void runAction('save_smtp', async () => {
      if (!authUser?.userId) {
        throw new Error(
          'Sign in with Google first so your encrypted SMTP configuration can be saved to your private Google Drive.'
        );
      }
      const res = await workspaceApi.saveSmtpConfig({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        securityMode: smtpSecurity,
        username: smtpUsername,
        password: smtpPassword || undefined,
        senderName: smtpSenderName,
        senderEmail: smtpSenderEmail,
      });
      setSmtpConfig(res.smtpConfig);
      setSmtpPassword('');
      setConfirmDeleteSmtp(false);
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'success',
        text: 'SMTP configuration encrypted with AES-256-GCM and saved to Invoice Studio/Application Data/smtp-config.enc.json.',
      });
    });
  };

  const handleTestSmtpConnection = () =>
    runAction('test_smtp', async () => {
      if (!authUser?.userId) {
        throw new Error('Sign in with Google first to test your SMTP server connection.');
      }
      const res = await workspaceApi.testSmtpConnection({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        securityMode: smtpSecurity,
        username: smtpUsername,
        password: smtpPassword || undefined,
      });
      setSmtpConfig((prev) => ({ ...prev, verifiedAt: res.verifiedAt }));
      setNotice({
        type: 'success',
        text: `SMTP handshake verified cleanly at ${new Date(res.verifiedAt).toLocaleTimeString()}.`,
      });
    });

  const handleDeleteSmtp = () =>
    runAction('delete_smtp', async () => {
      const res = await workspaceApi.deleteSmtpConfig();
      setSmtpConfig(res.smtpConfig);
      setSmtpHost('');
      setSmtpPort('587');
      setSmtpSecurity('STARTTLS');
      setSmtpUsername('');
      setSmtpPassword('');
      setSmtpSenderName('');
      setSmtpSenderEmail('');
      setConfirmDeleteSmtp(false);
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'info',
        text: 'Removed saved SMTP configuration from your Google Drive.',
      });
    });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 flex items-start sm:items-center gap-2.5">
            <Cloud className="w-6 h-6 text-indigo-600 shrink-0 mt-1 sm:mt-0" />
            <span>Account, Google Drive &amp; Email Settings</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage Google OAuth sign-in, your private Google Drive storage folder, Google Sheets
            import access, Gmail sending, and encrypted SMTP credentials.
          </p>
        </div>

        <div className="flex flex-col lg:items-end gap-1.5 text-xs shrink-0">
          <div className="inline-flex items-center gap-1.5 font-semibold text-slate-800 whitespace-nowrap">
            <UserCheck
              className={`w-4 h-4 shrink-0 ${
                authUser ? 'text-emerald-600' : 'text-slate-400'
              }`}
            />
            <span className="font-mono">{authUser?.email || 'Local Workspace Mode'}</span>
          </div>
          {localCounts && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 font-mono tabular-nums">
              <span className="whitespace-nowrap">{localCounts.customers} customers</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{localCounts.quotations} quotations</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{localCounts.invoices} invoices</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{localCounts.emailLogs} email logs</span>
            </div>
          )}
        </div>
      </div>

      {/* Environment Diagnostics Notice (only when server env vars are missing) */}
      {diagnostics && !diagnostics.readyForGoogleSync && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1.5">
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Google OAuth Environment Variables Needed for Live Cloud Connections</span>
          </div>
          <p className="text-amber-800">
            Missing server environment variable(s):{' '}
            <span className="font-mono font-semibold">
              {diagnostics.missingEnvVars.join(', ')}
            </span>
            . Set these in your Vercel Project Settings (or local <span className="font-mono">.env</span>)
            to enable live Google Sign-In, Drive storage, Sheets import, Gmail delivery, and
            encrypted SMTP persistence.
          </p>
          <p className="text-[11px] text-amber-700 font-mono">
            Authorized OAuth Redirect URI: {diagnostics.redirectUri}
          </p>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs font-medium flex items-center gap-2 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : notice.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* 4 Core Google Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Google Account */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">1. Google Account</h2>
                  <p className="text-[11px] text-slate-500">
                    OAuth 2.0 encrypted HttpOnly session · Strict per-user isolation
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-bold whitespace-nowrap shrink-0 ${
                  authUser ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {authUser ? 'Signed In' : 'Not Signed In'}
              </span>
            </div>

            {authUser ? (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                <p className="font-bold text-slate-900">{authUser.name || 'Google Account'}</p>
                <p className="font-mono text-slate-600">{authUser.email}</p>
                <p className="text-[11px] text-slate-500">
                  All records are stored strictly in this user&apos;s personal Google Drive. Signing
                  out immediately clears local browser state and session cookies.
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-600 leading-relaxed">
                Sign in with your Google Account to persist customers, quotations, invoices, PDFs,
                and settings directly in your own Google Drive across sessions and devices.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleConnectFeature('signin', false)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              {busyAction === 'connect_signin'
                ? 'Connecting...'
                : authUser
                  ? 'Switch Google Account'
                  : 'Sign in with Google'}
            </button>
            {!authUser && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleConnectFeature('signin', true)}
                className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Redirect Sign-In
              </button>
            )}
            {authUser && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleDisconnectFeature('all')}
                className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </section>

        {/* 2. Google Drive Storage (Sole Persistent Storage) */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">2. Google Drive Storage</h2>
                  <p className="text-[11px] text-slate-500">
                    Scope: drive.file · Sole persistent storage for your workspace
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-bold whitespace-nowrap shrink-0 ${
                  authUser?.driveConnected ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {authUser?.driveConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800 inline-flex items-center gap-1.5 font-mono">
                  <FolderTree className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Invoice Studio/</span>
                </span>
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {driveStatus?.lastSyncAt
                    ? `Synced ${new Date(driveStatus.lastSyncAt).toLocaleString()}`
                    : 'Ready to sync'}
                </span>
              </div>
              <ul className="space-y-1 text-[11px] text-slate-600">
                {DRIVE_SUBFOLDERS.map((folder) => (
                  <li key={folder.name} className="flex items-baseline justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-800 shrink-0">
                      └ {folder.name}/
                    </span>
                    <span className="text-slate-500 truncate text-right">{folder.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            {!authUser?.driveConnected ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleConnectFeature('drive')}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {busyAction === 'connect_drive' ? 'Authorizing...' : 'Connect Google Drive'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleSyncDrive()}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${busyAction === 'drive_sync' ? 'animate-spin' : ''}`}
                  />
                  <span>Sync Now</span>
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleBackupDrive()}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Create Backup
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleRestoreDrive()}
                  className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  <span>Restore</span>
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleDisconnectFeature('drive')}
                  className="px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </section>

        {/* 3. Google Sheets Import */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center shrink-0">
                  <Table2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">3. Google Sheets Import</h2>
                  <p className="text-[11px] text-slate-500">
                    Scope: spreadsheets.readonly · Read-only pasted URL import
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-bold whitespace-nowrap shrink-0 ${
                  authUser?.sheetsConnected ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {authUser?.sheetsConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Grant read-only Sheets access to validate tabs, auto-detect header rows, and import
              private spreadsheets directly from any pasted Google Sheets URL.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            {!authUser?.sheetsConnected ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleConnectFeature('sheets')}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {busyAction === 'connect_sheets' ? 'Authorizing...' : 'Connect Google Sheets'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNavigateTab('datasource')}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold cursor-pointer"
                >
                  Open Sheets Importer
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleDisconnectFeature('sheets')}
                  className="px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </section>

        {/* 4. Email Method A — Gmail API */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">4. Gmail Sending (Method A)</h2>
                  <p className="text-[11px] text-slate-500">
                    Scope: gmail.send · Sends invoices &amp; quotations from your Gmail
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-bold whitespace-nowrap shrink-0 ${
                  authUser?.gmailConnected ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {authUser?.gmailConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {authUser?.gmailConnected
                ? `Connected Gmail sender: ${authUser.email}. Emails include your generated PDF attachments and are logged in Invoice Studio/Email Records.`
                : 'Enable Gmail sending permission to dispatch quotations and invoices directly from your connected Gmail account.'}
            </p>

            {authUser?.gmailConnected && (
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <input
                  type="email"
                  aria-label="Gmail test recipient email"
                  placeholder="Recipient for Gmail test email"
                  value={gmailTestTo}
                  onChange={(e) => setGmailTestTo(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs font-mono"
                />
                <button
                  type="button"
                  disabled={busyAction !== null || !gmailTestTo.trim()}
                  onClick={() => void handleSendTestEmail('gmail')}
                  className="px-3.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-800 text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {busyAction === 'test_email_gmail' ? 'Sending...' : 'Send Test Email'}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
            {!authUser?.gmailConnected ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleConnectFeature('gmail')}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {busyAction === 'connect_gmail' ? 'Authorizing...' : 'Connect Gmail Sending'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNavigateTab('email')}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                >
                  Open Email Dispatcher
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleDisconnectFeature('gmail')}
                  className="px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
                >
                  Disconnect Gmail
                </button>
              </>
            )}
          </div>
        </section>
      </div>

      {/* 5. Email Method B — Encrypted User SMTP Account */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                5. SMTP Email Configuration (Method B)
              </h2>
              <p className="text-[11px] text-slate-500">
                Encrypted with AES-256-GCM on the server and saved in your private Google Drive (
                <span className="font-mono">smtp-config.enc.json</span>). Passwords are never
                returned to the browser.
              </p>
            </div>
          </div>

          <span
            className={`text-xs font-bold whitespace-nowrap shrink-0 ${
              smtpConfig.configured ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            {smtpConfig.configured
              ? smtpConfig.verifiedAt
                ? 'Configured · Verified'
                : 'Configured'
              : 'Not Configured'}
          </span>
        </div>

        <form onSubmit={handleSaveSmtp} className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label htmlFor="smtp-host" className="block font-semibold text-slate-700 mb-1">
              SMTP Host *
            </label>
            <input
              id="smtp-host"
              type="text"
              placeholder="smtp.yourcompany.com"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
            />
          </div>

          <div>
            <label htmlFor="smtp-port" className="block font-semibold text-slate-700 mb-1">
              SMTP Port *
            </label>
            <input
              id="smtp-port"
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="smtp-security" className="block font-semibold text-slate-700 mb-1">
              Encryption / Security
            </label>
            <select
              id="smtp-security"
              value={smtpSecurity}
              onChange={(e) =>
                setSmtpSecurity(e.target.value as 'SSL' | 'STARTTLS' | 'NONE')
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
            >
              <option value="STARTTLS">TLS / STARTTLS (Port 587)</option>
              <option value="SSL">SSL / TLS (Port 465)</option>
              <option value="NONE">None (Local Relay Only)</option>
            </select>
          </div>

          <div>
            <label htmlFor="smtp-user" className="block font-semibold text-slate-700 mb-1">
              SMTP Username
            </label>
            <input
              id="smtp-user"
              type="text"
              placeholder="billing@yourcompany.com"
              value={smtpUsername}
              onChange={(e) => setSmtpUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
            />
          </div>

          <div>
            <label htmlFor="smtp-pass" className="block font-semibold text-slate-700 mb-1">
              SMTP Password / App Password
            </label>
            <div className="relative">
              <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="smtp-pass"
                type="password"
                autoComplete="new-password"
                placeholder={
                  smtpConfig.hasPassword
                    ? 'Saved encrypted — enter to replace'
                    : 'Enter SMTP password'
                }
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="smtp-sender-name" className="block font-semibold text-slate-700 mb-1">
              Sender Display Name
            </label>
            <input
              id="smtp-sender-name"
              type="text"
              placeholder="Acme Billing Desk"
              value={smtpSenderName}
              onChange={(e) => setSmtpSenderName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="smtp-sender-email" className="block font-semibold text-slate-700 mb-1">
              Sender Email Address *
            </label>
            <input
              id="smtp-sender-email"
              type="email"
              placeholder="invoices@yourcompany.com"
              value={smtpSenderEmail}
              onChange={(e) => setSmtpSenderEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={busyAction !== null}
              className="flex-1 py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold cursor-pointer whitespace-nowrap"
            >
              {busyAction === 'save_smtp' ? 'Saving...' : 'Save SMTP'}
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleTestSmtpConnection()}
              className="py-2 px-3.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold cursor-pointer whitespace-nowrap"
            >
              {busyAction === 'test_smtp' ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </form>

        {/* Send Test Email via SMTP & Delete SMTP Controls */}
        <div className="pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 max-w-xl">
            <label htmlFor="smtp-test-recipient" className="font-semibold text-slate-700 whitespace-nowrap">
              Send SMTP Test Email:
            </label>
            <input
              id="smtp-test-recipient"
              type="email"
              placeholder="recipient@example.com"
              value={smtpTestTo}
              onChange={(e) => setSmtpTestTo(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
            />
            <button
              type="button"
              disabled={busyAction !== null || !smtpConfig.configured || !smtpTestTo.trim()}
              onClick={() => void handleSendTestEmail('smtp')}
              className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{busyAction === 'test_email_smtp' ? 'Sending...' : 'Send Test Email'}</span>
            </button>
          </div>

          {smtpConfig.configured && (
            <div className="flex items-center gap-2">
              {!confirmDeleteSmtp ? (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => setConfirmDeleteSmtp(true)}
                  className="px-3.5 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete SMTP Config</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-rose-700 font-semibold">Confirm delete?</span>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleDeleteSmtp()}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
                  >
                    Yes, Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSmtp(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
