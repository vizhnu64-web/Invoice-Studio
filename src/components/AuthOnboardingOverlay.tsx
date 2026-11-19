/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FolderTree,
  HardDrive,
  Mail,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { CompanySettings } from '../types';
import { GoogleAccountUser, IntegrationDiagnostics } from '../utils/googleSheets';
import { workspaceApi } from '../utils/workspaceApi';

interface AuthGateScreenProps {
  diagnostics: IntegrationDiagnostics | null;
  onContinueLocalPreview: () => void;
  onSignedIn: () => Promise<void>;
}

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  diagnostics,
  onContinueLocalPreview,
  onSignedIn,
}) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoogleSignIn = async (preferRedirect: boolean = false) => {
    setIsConnecting(true);
    setErrorMsg(null);
    try {
      await workspaceApi.connectGoogle('signin', preferRedirect);
      await onSignedIn();
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          'Google Sign-In could not be completed. Allow popups, try Redirect Sign-In, or continue in Local Workspace Mode.'
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-12 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-900">
        {/* Left Brand / Value Panel */}
        <div className="md:col-span-7 p-8 sm:p-10 flex flex-col justify-between bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 space-y-8">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-lg">
                IS
              </div>
              <div>
                <p className="text-base font-bold tracking-wide text-white">INVOICE STUDIO</p>
                <p className="text-xs text-slate-400">
                  Quotations, Invoices, Google Drive Storage & Dual Email Delivery
                </p>
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight pt-2">
              Your private financial workspace, stored directly in your own Google Drive.
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Sign in with Google OAuth to store your company profile, customers, quotations,
              invoices, generated PDFs, and encrypted SMTP settings inside your personal{' '}
              <span className="font-mono text-slate-200">Invoice Studio/</span> Drive folder—with
              zero shared database.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <p className="font-semibold text-white">Google Drive Storage</p>
              <p className="text-slate-400 text-[11px]">
                Every user&apos;s records and PDFs stay isolated inside their own Google Drive.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <FileCheck2 className="w-4 h-4 text-indigo-400" />
              <p className="font-semibold text-white">Quotation Approval Flow</p>
              <p className="text-slate-400 text-[11px]">
                Draft, approve, and convert quotations into linked invoices without duplicates.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <Table2 className="w-4 h-4 text-cyan-400" />
              <p className="font-semibold text-white">Google Sheets & Excel</p>
              <p className="text-slate-400 text-[11px]">
                Paste any private Google Sheets URL or upload XLSX/CSV files for batch billing.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <Mail className="w-4 h-4 text-rose-400" />
              <p className="font-semibold text-white">Gmail API + Encrypted SMTP</p>
              <p className="text-slate-400 text-[11px]">
                Send PDFs from your connected Gmail or your own encrypted company SMTP server.
              </p>
            </div>
          </div>
        </div>

        {/* Right Sign-In Action Panel */}
        <div className="md:col-span-5 p-8 sm:p-10 flex flex-col justify-center space-y-5 bg-white text-slate-900">
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-slate-900">Sign in to Invoice Studio</h2>
            <p className="text-xs text-slate-500">
              Sign in with Google OAuth 2.0 to connect your private{' '}
              <span className="font-mono">Invoice Studio/</span> Google Drive workspace.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void handleGoogleSignIn(false)}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center space-x-2.5 shadow-sm transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span>{isConnecting ? 'Opening Google Sign-In...' : 'Sign in with Google'}</span>
            </button>

            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void handleGoogleSignIn(true)}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold flex items-center justify-center space-x-2 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Use Standard Redirect Sign-In</span>
            </button>
          </div>

          {diagnostics && !diagnostics.readyForGoogleSync ? (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-1">
              <p className="font-bold">OAuth environment variables not set in this runtime</p>
              <p className="text-amber-800">
                Configure{' '}
                <span className="font-mono font-semibold">
                  {diagnostics.missingEnvVars.join(', ')}
                </span>{' '}
                on Vercel (or <span className="font-mono">.env</span>) to activate live Google
                Sign-In.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Google OAuth + Drive Storage Ready</p>
                <p className="text-emerald-800">
                  Uses minimal <span className="font-mono">drive.file</span> scope so Invoice Studio
                  can only access files it creates.
                </p>
              </div>
            </div>
          )}

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-[11px]">
              <span className="bg-white px-2 text-slate-400 font-medium">or work locally</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onContinueLocalPreview}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center space-x-2 cursor-pointer"
          >
            <span>Continue in Local Workspace Mode</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <p className="text-[11px] text-slate-400 text-center">
            Your workspace starts clean and empty—no preloaded demo customers or sample invoices.
          </p>
        </div>
      </div>
    </div>
  );
};

interface OnboardingModalProps {
  authUser: GoogleAccountUser;
  company: CompanySettings;
  onUpdateCompany: (company: CompanySettings) => void;
  onRefreshAuth: () => Promise<void>;
  onFinishOnboarding: () => Promise<void>;
}

export const OnboardingWizardModal: React.FC<OnboardingModalProps> = ({
  authUser,
  company,
  onUpdateCompany,
  onRefreshAuth,
  onFinishOnboarding,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [companyName, setCompanyName] = useState(company.legalName || '');
  const [companyEmail, setCompanyEmail] = useState(company.email || authUser.email);
  const [companyGstin, setCompanyGstin] = useState(company.gstin || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConnectDrive = async () => {
    setBusy(true);
    setErr(null);
    try {
      await workspaceApi.connectGoogle('drive');
      await onRefreshAuth();
    } catch (e: any) {
      setErr(e?.message || 'Could not authorize Google Drive right now.');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    setBusy(true);
    setErr(null);
    try {
      const updatedCompany: CompanySettings = {
        ...company,
        legalName: companyName.trim() || company.legalName,
        displayName: companyName.trim() || company.displayName,
        email: companyEmail.trim() || company.email,
        gstin: companyGstin.trim(),
      };
      onUpdateCompany(updatedCompany);
      await workspaceApi.saveWorkspace({
        onboardingCompleted: true,
        companySettings: updatedCompany,
      });
      await onFinishOnboarding();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save onboarding settings to Google Drive.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invoice Studio Onboarding Setup"
      className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-slate-900 text-sm">
              Welcome to Invoice Studio ({step} / 2)
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-500">{authUser.email}</span>
        </div>

        {err && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
            {err}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 text-xs text-slate-600">
            <p className="text-sm font-bold text-slate-900">
              Your private Google Drive storage folder is ready.
            </p>
            <p>
              All business settings, customers, quotations, invoices, generated PDFs, email logs,
              and encrypted SMTP settings are stored exclusively inside your Google Drive under:
            </p>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-700 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-slate-900">
                <FolderTree className="w-3.5 h-3.5 text-emerald-600" />
                <span>Invoice Studio/</span>
              </div>
              <div className="pl-4 grid grid-cols-1 sm:grid-cols-2 gap-1 text-slate-600">
                <span>├ Application Data/</span>
                <span>├ Company Assets/</span>
                <span>├ Generated PDFs/</span>
                <span>├ Email Records/</span>
                <span>└ Backups/</span>
              </div>
            </div>

            {!authUser.driveConnected && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConnectDrive()}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold cursor-pointer"
              >
                {busy ? 'Authorizing Google Drive...' : 'Authorize Google Drive Storage'}
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center space-x-2 text-slate-900 font-bold text-sm">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <span>Confirm Your Business Profile</span>
            </div>
            <div>
              <label htmlFor="onb-company" className="block font-semibold text-slate-700 mb-1">
                Company / Legal Name
              </label>
              <input
                id="onb-company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
              />
            </div>
            <div>
              <label htmlFor="onb-email" className="block font-semibold text-slate-700 mb-1">
                Business Email
              </label>
              <input
                id="onb-email"
                type="email"
                value={companyEmail}
                onChange={(e) => setCompanyEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
              />
            </div>
            <div>
              <label htmlFor="onb-gstin" className="block font-semibold text-slate-700 mb-1">
                Tax ID / GSTIN (Optional)
              </label>
              <input
                id="onb-gstin"
                type="text"
                value={companyGstin}
                onChange={(e) => setCompanyGstin(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          {step === 2 ? (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleComplete()}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Skip setup
            </button>
          )}

          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleComplete()}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              {busy ? 'Saving to Google Drive...' : 'Enter Workspace'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
