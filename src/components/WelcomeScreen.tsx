/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Info,
  Loader2,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { GoogleConnectionStatus } from '../types';
import { getGooglePublicConfig, GoogleAuthSession } from '../utils/googleAuth';

interface WelcomeScreenProps {
  connectionStatus: GoogleConnectionStatus;
  googleSession: GoogleAuthSession | null;
  errorMessage: string | null;
  onConnectGoogleDrive: () => Promise<void>;
  onCreateDefaultFolder: () => Promise<void>;
  onSelectExistingFolder: () => Promise<void>;
  onDisconnectGoogle: () => void;
}

const STATUS_LABELS: Record<GoogleConnectionStatus, string> = {
  not_connected: 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  loading_workspace: 'Loading workspace',
  syncing: 'Syncing',
  synced: 'Synced',
  access_expired: 'Access expired',
  permission_missing: 'Permission missing',
  sync_failed: 'Sync failed',
};

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  connectionStatus,
  googleSession,
  errorMessage,
  onConnectGoogleDrive,
  onCreateDefaultFolder,
  onSelectExistingFolder,
  onDisconnectGoogle,
}) => {
  const publicConfig = getGooglePublicConfig();
  const isBusy =
    connectionStatus === 'connecting' || connectionStatus === 'loading_workspace';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Clean Top Brand Bar */}
      <header className="bg-slate-900 border-b border-slate-800 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-lg shadow-inner">
              IS
            </div>
            <div>
              <p className="text-sm sm:text-base font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent tracking-wide">
                INVOICE STUDIO
              </p>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Invoices &amp; Quotations Suite
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold border ${
                googleSession
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              {isBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : googleSession ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{STATUS_LABELS[connectionStatus]}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Value Proposition */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                Business-Owned Storage · Zero Central Database
              </p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Manage Invoices &amp; Quotations Privately in Your Own Google Drive
              </h1>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
                Connect your Google Drive to store your company profile, customers, invoices,
                quotations, PDFs, logos, and backups directly inside your own Google account.
                Invoice Studio does not require registration or store your business data on any
                central database.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Your Own Drive Folder</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Every business connects its own Google account and isolated Drive folder.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Invoices &amp; Quotations</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Create GST-ready invoices, quotation approvals, PDFs, and payment tracking.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Excel, CSV &amp; Google Sheets</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Import spreadsheets with column mapping and optional Google Sheets read access.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Your Own SMTP Delivery</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Send PDFs via Gmail SMTP or Custom SMTP with encrypted credentials in your Drive.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Action Card — shown first on mobile so Connect Google Drive CTA is above the fold */}
          <div className="lg:col-span-5 order-first lg:order-last">
            <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/70 border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 px-6 py-5 text-white">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">
                      {googleSession ? 'Select Your Workspace Folder' : 'Connect Google Drive'}
                    </h2>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {googleSession
                        ? 'Choose or create the folder that stores your business records'
                        : 'Authorize Google Drive access to open your private workspace'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {!googleSession ? (
                  <>
                    <div className="space-y-2.5 text-xs text-slate-600">
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>Least-privilege access:</strong> Requests only{' '}
                          <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                            drive.file
                          </code>{' '}
                          so Invoice Studio accesses only the folder and files you create or select
                          with it.
                        </span>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <Lock className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>In-memory token security:</strong> Your OAuth access token stays
                          in browser memory only and is cleared when you disconnect or close the
                          tab.
                        </span>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <FileText className="w-4 h-4 text-cyan-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>No Invoice Studio account:</strong> Simply choose your Google
                          account to load your existing Drive folder or start an empty workspace.
                        </span>
                      </div>
                    </div>

                    {!publicConfig.isOAuthConfigured && (
                      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="min-w-0 space-y-1">
                          <p className="font-bold">Google OAuth Environment Setup Needed</p>
                          <p className="leading-relaxed">
                            Configure{' '}
                            <code className="font-mono break-all">VITE_GOOGLE_CLIENT_ID</code>,{' '}
                            <code className="font-mono break-all">VITE_GOOGLE_API_KEY</code>, and{' '}
                            <code className="font-mono break-all">VITE_GOOGLE_APP_ID</code> in your
                            deployment environment to enable live Google Drive authorization.
                          </p>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={onConnectGoogleDrive}
                      disabled={isBusy}
                      className="w-full py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-3 cursor-pointer"
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                        </svg>
                      )}
                      <span>
                        {connectionStatus === 'connecting'
                          ? 'Connecting to Google...'
                          : 'Connect Google Drive'}
                      </span>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Connected Google Account Summary */}
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                          Authorized Google Account
                        </p>
                        <p className="text-xs font-bold text-emerald-950 truncate mt-0.5">
                          {googleSession.accountEmail}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onDisconnectGoogle}
                        disabled={isBusy}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-100 text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Switch</span>
                      </button>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      Create an <strong>Invoice Studio</strong> folder in your My Drive (or open it
                      if one already exists), or select an existing folder with Google Picker.
                    </p>

                    <div className="space-y-2.5">
                      <button
                        type="button"
                        onClick={onCreateDefaultFolder}
                        disabled={isBusy}
                        className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        {connectionStatus === 'loading_workspace' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FolderPlus className="w-4 h-4" />
                        )}
                        <span>
                          {connectionStatus === 'loading_workspace'
                            ? 'Loading workspace...'
                            : 'Create / Open "Invoice Studio" Folder'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={onSelectExistingFolder}
                        disabled={isBusy}
                        className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-60 text-slate-800 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <FolderOpen className="w-4 h-4 text-indigo-600" />
                        <span>Select Existing Folder (Google Picker)</span>
                      </button>
                    </div>

                    {!publicConfig.isPickerConfigured && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                        Google Picker requires <code className="font-mono">VITE_GOOGLE_API_KEY</code>{' '}
                        and <code className="font-mono">VITE_GOOGLE_APP_ID</code>. You can still use
                        &ldquo;Create / Open Invoice Studio Folder&rdquo; immediately.
                      </p>
                    )}
                  </>
                )}

                {errorMessage && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{errorMessage}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
