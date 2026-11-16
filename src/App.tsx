/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  CompanySettings,
  InvoiceFieldConfig,
  MappingProfile,
  SpreadsheetData,
  InvoiceTemplate,
  GenerationRecord,
  CalculationSettings,
  GuidedWorkflowStep,
} from './types';
import { defaultMappingProfiles } from './mockData';
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
import { GuidedWorkflow } from './components/workflow/GuidedWorkflow';
import { EmailSendStatus } from './utils/emailService';
import { storage } from './utils/storage';

const VALID_TABS = new Set([
  'dashboard',
  'workflow',
  'fields',
  'datasource',
  'manual',
  'designer',
  'generation',
  'history',
  'email',
  'company',
]);

function readTabFromHash(): string {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_TABS.has(raw) ? raw : 'dashboard';
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
  const [template, setTemplate] = useState<InvoiceTemplate>(() => storage.loadTemplate());
  const [calculationSettings, setCalculationSettings] = useState<CalculationSettings>(() =>
    storage.loadCalculationSettings()
  );
  const [emailStatuses, setEmailStatuses] = useState<Record<string, EmailSendStatus>>(() =>
    storage.loadEmailStatuses()
  );
  const [preselectedEmailRecordId, setPreselectedEmailRecordId] = useState<string | null>(null);

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

  const handleUpdateEmailStatuses = (
    action: React.SetStateAction<Record<string, EmailSendStatus>>
  ) => {
    setEmailStatuses((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveEmailStatuses(next);
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
  };

  const handleUpdateCompany = (updatedCompany: CompanySettings) => {
    setCompany(updatedCompany);
    storage.saveCompanySettings(updatedCompany);
    // Synchronize company-dependent fields
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
      return updated;
    });
  };

  const handleUpdateFields = (action: React.SetStateAction<InvoiceFieldConfig[]>) => {
    setFields((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveFields(next);
      return next;
    });
  };

  const handleUpdateTemplate = (action: React.SetStateAction<InvoiceTemplate>) => {
    setTemplate((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveTemplate(next);
      return next;
    });
  };

  const handleUpdateHistory = (action: React.SetStateAction<GenerationRecord[]>) => {
    setGenerationHistory((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      storage.saveHistory(next);
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

  const handleSendManualInvoiceByEmail = (recordId: string) => {
    setPreselectedEmailRecordId(recordId);
    setActiveTab('email');
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
        onStartGuidedWorkflow={() => handleStartGuidedWorkflow('source')}
      />

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
            company={company}
            template={template}
            emailStatuses={emailStatuses}
            setEmailStatuses={handleUpdateEmailStatuses}
            initialSelectedRecordId={preselectedEmailRecordId}
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
