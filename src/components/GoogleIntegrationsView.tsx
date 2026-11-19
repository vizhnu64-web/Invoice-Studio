/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  DownloadCloud,
  FolderTree,
  HardDrive,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  Server,
  ShieldCheck,
  Table2,
  UserCheck,
} from 'lucide-react';
import { BackendSmtpConfig } from '../types';
import {
  GoogleAccountUser,
  IntegrationDiagnostics,
} from '../utils/googleSheets';
import { DriveStatusPayload, workspaceApi } from '../utils/workspaceApi';
import { useFirebase } from './FirebaseProvider';

interface GoogleIntegrationsViewProps {
  authUser: GoogleAccountUser | null;
  diagnostics: IntegrationDiagnostics | null;
  smtpConfig: BackendSmtpConfig;
  setSmtpConfig: React.Dispatch<React.SetStateAction<BackendSmtpConfig>>;
  onRefreshAuthAndWorkspace: () => Promise<void>;
  onNavigateTab: (tab: string) => void;
  onSyncLocalToFirestore?: () => Promise<void>;
  localCounts?: {
    quotations: number;
    invoices: number;
    customers: number;
    emailLogs: number;
  };
}

const STANDARD_DRIVE_FOLDERS = [
  'App Data',
  'Company Settings',
  'Customers',
  'Quotations',
  'Invoices',
  'Generated PDFs',
  'Email Records',
  'Backups',
];

export const GoogleIntegrationsView: React.FC<GoogleIntegrationsViewProps> = ({
  authUser,
  diagnostics,
  smtpConfig,
  setSmtpConfig,
  onRefreshAuthAndWorkspace,
  onNavigateTab,
  onSyncLocalToFirestore,
  localCounts,
}) => {
  const {
    firebaseUser,
    isSigningIn,
    cloudSyncState,
    lastCloudSyncAt,
    projectId,
    firestoreDatabaseId,
    signInWithFirebaseGoogle,
    signOutFirebase,
  } = useFirebase();
  const [driveStatus, setDriveStatus] = useState<DriveStatusPayload | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // SMTP form state (password is write-only, never hydrated or stored in localStorage)
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
  }, [smtpConfig]);

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

  const handleConnectFeature = (feature: 'signin' | 'drive' | 'sheets' | 'gmail') =>
    runAction(`connect_${feature}`, async () => {
      await workspaceApi.connectGoogle(feature);
      await onRefreshAuthAndWorkspace();
      if (feature === 'drive') {
        const st = await workspaceApi.getDriveStatus().catch(() => null);
        if (st) setDriveStatus(st);
      }
      setNotice({
        type: 'success',
        text:
          feature === 'signin'
            ? 'Signed in with your Google Account.'
            : `Connected ${feature.toUpperCase()} permission cleanly.`,
      });
    });

  const handleDisconnectFeature = (feature: 'all' | 'drive' | 'sheets' | 'gmail') =>
    runAction(`disconnect_${feature}`, async () => {
      await workspaceApi.disconnectGoogle(feature);
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'info',
        text:
          feature === 'all'
            ? 'Signed out of your Google Account. Your saved business records remain safely stored.'
            : `Disconnected ${feature.toUpperCase()} integration.`,
      });
    });

  const handleSyncDrive = () =>
    runAction('drive_sync', async () => {
      const res = await workspaceApi.syncDrive();
      const st = await workspaceApi.getDriveStatus().catch(() => null);
      if (st) setDriveStatus(st);
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'success',
        text: `Synced ${res.filesSynced} files to your Google Drive (${res.quotationsSynced} quotations, ${res.invoicesSynced} invoices, ${res.customersSynced} customers).`,
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
        text: `Restored from Google Drive: ${res.quotationsRestored} quotations, ${res.invoicesRestored} invoices, ${res.customersRestored} customers (${res.conflictsResolved} newer remote records merged).`,
      });
    });

  const handleSaveSmtp = (e: React.FormEvent) => {
    e.preventDefault();
    void runAction('save_smtp', async () => {
      if (!authUser?.userId) {
        throw new Error(
          'Sign in with Google first to store encrypted SMTP credentials securely on the backend database.'
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
      await onRefreshAuthAndWorkspace();
      setNotice({
        type: 'success',
        text: 'SMTP configuration saved with AES-256-GCM server-side password encryption.',
      });
    });
  };

  const handleTestSmtp = () =>
    runAction('test_smtp', async () => {
      if (!authUser?.userId) {
        throw new Error('Sign in with Google first to test SMTP delivery via the backend server.');
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
        text: `SMTP connection verified cleanly at ${new Date(res.verifiedAt).toLocaleTimeString()}.`,
      });
    });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center space-x-2.5">
            <Cloud className="w-7 h-7 text-indigo-600 shrink-0" />
            <span>Firebase Cloud & Google Integrations</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Sync your workspace in real time with Firebase Cloud Firestore, or connect Google Drive storage, Google Sheets import, Gmail delivery, and encrypted SMTP.
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border font-semibold whitespace-nowrap ${
              firebaseUser || authUser
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            <UserCheck className="w-4 h-4 shrink-0" />
            <span>{firebaseUser?.email || authUser?.email || 'Local Preview Mode'}</span>
          </span>
        </div>
      </div>

      {/* Firebase Authentication & Cloud Firestore Card */}
      <section className="bg-white p-6 rounded-2xl border border-indigo-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Firebase Authentication & Cloud Firestore Persistence
              </h2>
              <p className="text-[11px] text-slate-500">
                Project <span className="font-mono font-semibold text-slate-700">{projectId}</span> • Real-time owner-isolated Firestore sync
              </p>
            </div>
          </div>

          <span
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold border whitespace-nowrap shrink-0 w-fit ${
              firebaseUser
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {firebaseUser
              ? cloudSyncState === 'synced'
                ? 'Connected & Synced'
                : cloudSyncState === 'error'
                  ? 'Sync Attention Needed'
                  : 'Syncing...'
              : 'Not Signed In'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-7 space-y-2 text-xs text-slate-600">
            {firebaseUser ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <p className="font-bold text-slate-900">
                  {firebaseUser.displayName || 'Google Account'} ({firebaseUser.email})
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  UID: {firebaseUser.uid} • DB: {firestoreDatabaseId}
                </p>
                <p className="text-[11px] text-emerald-700">
                  {lastCloudSyncAt
                    ? `Last real-time sync: ${new Date(lastCloudSyncAt).toLocaleString()}`
                    : 'Listening for real-time updates across devices.'}
                </p>
              </div>
            ) : (
              <p>
                Sign in with your Google account via Firebase Authentication to automatically sync your company settings, templates, customers, quotations, invoices, and email logs to Cloud Firestore with strict per-user security rules.
              </p>
            )}

            {localCounts && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Quotations</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{localCounts.quotations}</p>
                </div>
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Invoices</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{localCounts.invoices}</p>
                </div>
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Customers</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{localCounts.customers}</p>
                </div>
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Email Logs</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{localCounts.emailLogs}</p>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 flex flex-wrap lg:justify-end gap-2">
            {!firebaseUser ? (
              <button
                type="button"
                disabled={busyAction !== null || isSigningIn}
                onClick={() =>
                  void runAction('firebase_signin', async () => {
                    await signInWithFirebaseGoogle();
                    setNotice({
                      type: 'success',
                      text: 'Signed in with Google via Firebase. Real-time Firestore cloud sync is active.',
                    });
                  })
                }
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center space-x-2 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {busyAction === 'firebase_signin' || isSigningIn
                    ? 'Signing in...'
                    : 'Sign in with Google (Firebase)'}
                </span>
              </button>
            ) : (
              <>
                {onSyncLocalToFirestore && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      void runAction('firebase_push', async () => {
                        await onSyncLocalToFirestore();
                        setNotice({
                          type: 'success',
                          text: 'Synced workspace settings, customers, quotations, invoices, and email logs to Cloud Firestore.',
                        });
                      })
                    }
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${busyAction === 'firebase_push' ? 'animate-spin' : ''}`}
                    />
                    <span>Sync Workspace to Firestore</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    void runAction('firebase_signout', async () => {
                      await signOutFirebase();
                      setNotice({
                        type: 'info',
                        text: 'Signed out of Firebase Authentication.',
                      });
                    })
                  }
                  className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Environment Diagnostics Notice (only when server env vars are missing) */}
      {diagnostics && !diagnostics.readyForGoogleSync && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1.5">
          <div className="flex items-center space-x-2 font-bold">
            <Database className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Optional Vercel Server OAuth Credentials Not Provisioned in This Preview Runtime</span>
          </div>
          <p className="text-amber-800">
            Firebase Authentication & Cloud Firestore above are active immediately. For optional server-side Google Drive, Sheets, and Gmail/SMTP APIs on Vercel, configure:{' '}
            <span className="font-mono font-semibold">
              {diagnostics.missingEnvVars.join(', ')}
            </span>
            .
          </p>
          <p className="text-[11px] text-amber-700 font-mono">
            Authorized Callback URI: {diagnostics.redirectUri}
          </p>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs font-medium flex items-center space-x-2 ${
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

      {/* 4 Google Workspace Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Google Account */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">1. Google Account</h2>
                  <p className="text-[11px] text-slate-500">
                    Scopes: openid, email, profile (Strict per-user data isolation)
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border whitespace-nowrap shrink-0 ${
                  authUser
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {authUser ? 'Signed In' : 'Not Signed In'}
              </span>
            </div>

            {authUser ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                <p className="font-bold text-slate-900">{authUser.name || 'Google User'}</p>
                <p className="font-mono text-slate-600">{authUser.email}</p>
                <p className="text-[11px] text-slate-500">
                  Verified Google ID isolates your quotations, invoices, settings, and SMTP config from all other users.
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                Sign in with your own Gmail or Google Workspace account to store and retrieve your workspace securely across devices.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleConnectFeature('signin')}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              {busyAction === 'connect_signin'
                ? 'Connecting...'
                : authUser
                  ? 'Switch Google Account'
                  : 'Continue with Google'}
            </button>
            {authUser && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleDisconnectFeature('all')}
                className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </section>

        {/* 2. Google Drive Storage */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">2. Google Drive Storage</h2>
                  <p className="text-[11px] text-slate-500">
                    Scope: drive.file (Only files created by Invoice Studio)
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border whitespace-nowrap shrink-0 ${
                  authUser?.driveConnected
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {authUser?.driveConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 inline-flex items-center space-x-1.5">
                  <FolderTree className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Invoice Studio/</span>
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {driveStatus?.lastSyncAt
                    ? `Synced ${new Date(driveStatus.lastSyncAt).toLocaleString()}`
                    : 'Not synced yet'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-600 font-mono">
                {STANDARD_DRIVE_FOLDERS.map((folder) => (
                  <span key={folder} className="truncate">
                    └ {folder}/
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
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
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'drive_sync' ? 'animate-spin' : ''}`} />
                  <span>Sync Now</span>
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleBackupDrive()}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Backup Now
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleRestoreDrive()}
                  className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-bold inline-flex items-center space-x-1 cursor-pointer"
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

        {/* 3. Google Sheets */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center">
                  <Table2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">3. Google Sheets Sync</h2>
                  <p className="text-[11px] text-slate-500">
                    Scope: spreadsheets.readonly (Private sheets owned/shared with you)
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border whitespace-nowrap shrink-0 ${
                  authUser?.sheetsConnected
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {authUser?.sheetsConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Import and synchronize your own spreadsheets into Invoice Studio. Synced records are stored strictly under your verified Google Account ID.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
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

        {/* 4. Gmail Delivery */}
        <section className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">4. Gmail Sending</h2>
                  <p className="text-[11px] text-slate-500">
                    Scope: gmail.send (Send PDF quotations & invoices from your Gmail)
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border whitespace-nowrap shrink-0 ${
                  authUser?.gmailConnected
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {authUser?.gmailConnected ? 'Enabled' : 'Not Connected'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {authUser?.gmailConnected
                ? `Emails sent via Gmail will be delivered directly from ${authUser.email} with attached PDF documents.`
                : 'Enable incremental gmail.send permission to send quotations and invoices directly through your connected Gmail address.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            {!authUser?.gmailConnected ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleConnectFeature('gmail')}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {busyAction === 'connect_gmail' ? 'Authorizing...' : 'Enable Gmail Sending'}
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

      {/* 5. Encrypted Backend SMTP Account Card */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                5. Company / User SMTP Email Account
              </h2>
              <p className="text-[11px] text-slate-500">
                Credentials are encrypted at rest with AES-256-GCM on the server and never stored in browser storage.
              </p>
            </div>
          </div>

          <span
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold border w-fit ${
              smtpConfig.configured
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {smtpConfig.configured
              ? smtpConfig.verifiedAt
                ? 'Configured & Verified'
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
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
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
                    ? '•••••••• (saved encrypted — enter to replace)'
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

          <div className="flex items-end space-x-2">
            <button
              type="submit"
              disabled={busyAction !== null}
              className="flex-1 py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold cursor-pointer"
            >
              {busyAction === 'save_smtp' ? 'Saving...' : 'Save SMTP'}
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleTestSmtp()}
              className="py-2 px-3.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold cursor-pointer"
            >
              {busyAction === 'test_smtp' ? 'Testing...' : 'Test'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
