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
  Cloud,
  FileCheck2,
  HardDrive,
  Mail,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { CompanySettings } from '../types';
import { GoogleAccountUser, IntegrationDiagnostics } from '../utils/googleSheets';
import { workspaceApi } from '../utils/workspaceApi';

import { useFirebase } from './FirebaseProvider';

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
  const { signInWithFirebaseGoogle, isSigningIn, authError, projectId } = useFirebase();
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFirebaseGoogleSignIn = async () => {
    setIsConnecting(true);
    setErrorMsg(null);
    try {
      await signInWithFirebaseGoogle();
      await onSignedIn();
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          'Google Sign-In could not be completed. Allow popups or continue in Local Preview Mode.'
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const displayedError = errorMsg || authError;

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
                  Quotations, Invoices, Firebase Cloud Sync & Google Workspace
                </p>
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight pt-2">
              Your private financial workspace, synced in real time with Firebase.
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Sign in with your Google account to persist quotations, invoices, customer directories, company settings, and email logs in your isolated Cloud Firestore workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <FileCheck2 className="w-4 h-4 text-indigo-400" />
              <p className="font-semibold text-white">Quotation Approval Flow</p>
              <p className="text-slate-400 text-[11px]">
                Approve proposals and atomically convert approved quotations into linked invoices.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <Cloud className="w-4 h-4 text-amber-400" />
              <p className="font-semibold text-white">Firebase Cloud Firestore</p>
              <p className="text-slate-400 text-[11px]">
                Real-time per-user persistence isolated strictly under your verified Google UID.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <p className="font-semibold text-white">Google Drive & Sheets</p>
              <p className="text-slate-400 text-[11px]">
                Optional Drive folder backups and private spreadsheet synchronization.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-800 space-y-1">
              <Mail className="w-4 h-4 text-rose-400" />
              <p className="font-semibold text-white">Gmail API + Encrypted SMTP</p>
              <p className="text-slate-400 text-[11px]">
                Choose your connected Gmail or company SMTP server explicitly on every dispatch.
              </p>
            </div>
          </div>
        </div>

        {/* Right Sign-In Action Panel */}
        <div className="md:col-span-5 p-8 sm:p-10 flex flex-col justify-center space-y-5 bg-white text-slate-900">
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-slate-900">Sign in to Invoice Studio</h2>
            <p className="text-xs text-slate-500">
              Sign in with Google via Firebase Authentication to sync your private workspace across sessions and devices.
            </p>
          </div>

          {displayedError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{displayedError}</span>
            </div>
          )}

          <button
            type="button"
            disabled={isConnecting || isSigningIn}
            onClick={() => void handleFirebaseGoogleSignIn()}
            className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center space-x-2.5 shadow-sm transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>
              {isConnecting || isSigningIn ? 'Opening Google Sign-In...' : 'Continue with Google'}
            </span>
          </button>

          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 flex items-start space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Firebase Cloud Ready</p>
              <p className="text-emerald-800">
                Connected to project <span className="font-mono">{projectId}</span> with strict per-user Firestore security rules.
              </p>
            </div>
          </div>

          {diagnostics && !diagnostics.readyForGoogleSync && (
            <p className="text-[11px] text-slate-500">
              Optional Drive/Sheets/Gmail server sync can also be configured later in Integrations.
            </p>
          )}

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-[11px]">
              <span className="bg-white px-2 text-slate-400 font-medium">or explore locally</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onContinueLocalPreview}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center space-x-2 cursor-pointer"
          >
            <span>Continue in Local Preview Mode</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <p className="text-[11px] text-slate-400 text-center">
            Each Google account accesses only its own Firestore documents under strict security rules.
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
      await workspaceApi.syncDrive().catch(() => {});
      await onRefreshAuth();
    } catch (e: any) {
      setErr(e?.message || 'Could not connect Google Drive right now.');
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
      setErr(e?.message || 'Failed to save onboarding settings.');
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
            <Cloud className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-slate-900 text-sm">
              Welcome to Invoice Studio ({step} / 3)
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
          <div className="space-y-3 text-xs text-slate-600">
            <p className="text-sm font-bold text-slate-900">
              Your private multi-user workspace is ready.
            </p>
            <p>
              All quotations, invoices, customer records, PDF templates, and email logs are strictly tied to your Google Account (<span className="font-mono text-slate-800">{authUser.email}</span>).
            </p>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <p className="font-bold text-slate-800">Next steps (takes under 60 seconds):</p>
              <p>1. Optionally connect your Google Drive for automatic cloud folder backup.</p>
              <p>2. Confirm your company name and email for PDFs and quotations.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-xs">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-sm">Connect Your Google Drive</p>
                <p className="text-slate-600 mt-0.5">
                  Invoice Studio creates an <span className="font-mono font-semibold">Invoice Studio/</span> folder in your Drive using minimal <span className="font-mono">drive.file</span> permission so you can restore across browsers.
                </p>
              </div>
            </div>

            {authUser.driveConnected ? (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center space-x-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Google Drive is connected!</span>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConnectDrive()}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold cursor-pointer"
              >
                {busy ? 'Authorizing Google Drive...' : 'Connect Google Drive Now'}
              </button>
            )}
          </div>
        )}

        {step === 3 && (
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
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
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

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
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
              {busy ? 'Saving...' : 'Enter Workspace'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
