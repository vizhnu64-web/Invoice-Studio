/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  CompanySettings, 
  InvoiceFieldConfig, 
  InvoiceTemplate, 
  SpreadsheetData, 
  CalculationSettings,
  GuidedWorkflowStep,
  AdvancedAmountCalculationSettings,
  GstConfigurationSettings,
  WorkflowSessionState
} from '../../types';
import { 
  FileSpreadsheet, 
  Database, 
  Calculator, 
  Percent, 
  CheckSquare, 
  FileCheck, 
  Cpu, 
  CheckCircle2, 
  ChevronRight,
  ArrowLeft,
  X
} from 'lucide-react';
import { storage, defaultAdvancedAmountSettings, defaultGstSettings } from '../../utils/storage';
import { Step1DataSource } from './Step1DataSource';
import { Step2FieldMapping } from './Step2FieldMapping';
import { Step3AmountCalculations } from './Step3AmountCalculations';
import { Step4GstCalculations } from './Step4GstCalculations';
import { Step5ReviewData } from './Step5ReviewData';
import { Step6FinalizeInvoice } from './Step6FinalizeInvoice';

interface GuidedWorkflowProps {
  company: CompanySettings;
  fields: InvoiceFieldConfig[];
  setFields: React.Dispatch<React.SetStateAction<InvoiceFieldConfig[]>>;
  template: InvoiceTemplate;
  spreadsheetData: SpreadsheetData;
  setSpreadsheetData: React.Dispatch<React.SetStateAction<SpreadsheetData>>;
  calculationSettings: CalculationSettings;
  setCalculationSettings: (settings: CalculationSettings) => void;
  onExitWorkflow: () => void;
  onFinishToGenerator: () => void;
}

const STEPS: Array<{ id: GuidedWorkflowStep; label: string; icon: any; shortDesc: string }> = [
  { id: 'source', label: '1. Data Source', icon: FileSpreadsheet, shortDesc: 'Upload & Select Sheet' },
  { id: 'mapping', label: '2. Data Mapping', icon: Database, shortDesc: 'Match Excel Columns' },
  { id: 'amount_calc', label: '3. Amount Calculations', icon: Calculator, shortDesc: 'Formulas & Rules' },
  { id: 'gst_calc', label: '4. GST Calculations', icon: Percent, shortDesc: 'Tax Breakdown & Mode' },
  { id: 'review', label: '5. Review Data', icon: CheckSquare, shortDesc: 'Audit & Edit Records' },
  { id: 'finalize', label: '6. Finalize', icon: FileCheck, shortDesc: 'Summary & Handoff' },
];

export const GuidedWorkflow: React.FC<GuidedWorkflowProps> = ({
  company,
  fields,
  setFields,
  template,
  spreadsheetData,
  setSpreadsheetData,
  calculationSettings,
  setCalculationSettings,
  onExitWorkflow,
  onFinishToGenerator,
}) => {
  // Load saved session or initialize defaults
  const savedSession = storage.loadWorkflowSession();

  const [currentStep, setCurrentStep] = useState<GuidedWorkflowStep>(
    savedSession?.currentStep || 'source'
  );
  const [completedSteps, setCompletedSteps] = useState<GuidedWorkflowStep[]>(
    savedSession?.completedSteps || []
  );
  const [selectedWorksheetName, setSelectedWorksheetName] = useState<string>(
    savedSession?.selectedWorksheetName || spreadsheetData.activeSheetName || spreadsheetData.worksheets[0]?.name || ''
  );
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(
    savedSession?.headerRowIndex ?? 0
  );
  const [startRowIndex, setStartRowIndex] = useState<number>(
    savedSession?.startRowIndex ?? 0
  );
  const [endRowIndex, setEndRowIndex] = useState<number | undefined>(
    savedSession?.endRowIndex
  );
  const [amountSettings, setAmountSettings] = useState<AdvancedAmountCalculationSettings>(
    savedSession?.amountSettings || defaultAdvancedAmountSettings
  );
  const [gstSettings, setGstSettings] = useState<GstConfigurationSettings>(
    savedSession?.gstSettings || defaultGstSettings
  );
  const [customEditedRows, setCustomEditedRows] = useState<Record<number, Record<string, any>>>(
    savedSession?.customEditedRows || {}
  );

  // Auto-save session on changes
  useEffect(() => {
    const sessionToSave: WorkflowSessionState = {
      currentStep,
      completedSteps,
      selectedWorksheetName,
      headerRowIndex,
      startRowIndex,
      endRowIndex,
      amountSettings,
      gstSettings,
      customEditedRows,
      updatedAt: new Date().toISOString()
    };
    storage.saveWorkflowSession(sessionToSave);
  }, [
    currentStep,
    completedSteps,
    selectedWorksheetName,
    headerRowIndex,
    startRowIndex,
    endRowIndex,
    amountSettings,
    gstSettings,
    customEditedRows
  ]);

  const markStepCompleted = (step: GuidedWorkflowStep) => {
    if (!completedSteps.includes(step)) {
      setCompletedSteps(prev => [...prev, step]);
    }
  };

  const handleStepTransition = (nextStep: GuidedWorkflowStep) => {
    markStepCompleted(currentStep);
    setCurrentStep(nextStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveTemplate = (name: string) => {
    const mappings: Record<string, string> = {};
    fields.forEach(f => {
      if (f.sourceColumn) mappings[f.id] = f.sourceColumn;
    });
    storage.saveMappingTemplate({
      name,
      description: `Saved from ${spreadsheetData.fileName} on ${new Date().toLocaleDateString()}`,
      mappings,
      amountSettings,
      gstSettings
    });
  };

  const handleFinalProceed = () => {
    // 1. Mark all steps completed
    setCompletedSteps(['source', 'mapping', 'amount_calc', 'gst_calc', 'review', 'finalize']);

    // 2. Synchronize calculation settings
    const isExcelAmountMode = amountSettings.taxableAmount.method === 'excel_column';
    setCalculationSettings({
      mode: isExcelAmountMode ? 'excel_amount' : 'calculated',
      taxInclusive: gstSettings.pricingType === 'inclusive'
    });

    // 3. Clear workflow session since it has successfully finished
    storage.clearWorkflowSession();

    // 4. Smooth handoff to Generator
    onFinishToGenerator();
  };

  const currentStepIdx = STEPS.findIndex(s => s.id === currentStep);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner / Exit Bar */}
      <div className="flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={onExitWorkflow}
            className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Exit to Dashboard</span>
          </button>
          <span className="text-slate-300">|</span>
          <span className="text-xs font-bold text-slate-800">
            Guided Invoice Creation Assistant
          </span>
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-500">
          <span>Step {currentStepIdx + 1} of 6</span>
          <span className="text-slate-300">•</span>
          <span className="text-emerald-600 font-semibold flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Progress Saved</span>
          </span>
        </div>
      </div>

      {/* Persistent Step Indicator / Wizard Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
        <div className="flex items-center justify-between min-w-[700px]">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isCurrent = step.id === currentStep;
            const isCompleted = completedSteps.includes(step.id);
            const isClickable = isCompleted || idx <= currentStepIdx;

            return (
              <React.Fragment key={step.id}>
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => setCurrentStep(step.id)}
                  className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl transition-all text-left ${
                    isCurrent
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : isCompleted
                      ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100/70 border border-emerald-200'
                      : isClickable
                      ? 'text-slate-700 hover:bg-slate-100'
                      : 'text-slate-400 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                      isCurrent
                        ? 'bg-white/20 text-white'
                        : isCompleted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isCompleted && !isCurrent ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-bold text-xs whitespace-nowrap leading-tight">{step.label}</p>
                    <p className={`text-[10px] whitespace-nowrap leading-tight ${
                      isCurrent ? 'text-indigo-100' : 'text-slate-400'
                    }`}>
                      {step.shortDesc}
                    </p>
                  </div>
                </button>

                {idx < STEPS.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mx-1" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="transition-opacity duration-200">
        {currentStep === 'source' && (
          <Step1DataSource
            spreadsheetData={spreadsheetData}
            setSpreadsheetData={setSpreadsheetData}
            selectedWorksheetName={selectedWorksheetName}
            setSelectedWorksheetName={setSelectedWorksheetName}
            headerRowIndex={headerRowIndex}
            setHeaderRowIndex={setHeaderRowIndex}
            startRowIndex={startRowIndex}
            setStartRowIndex={setStartRowIndex}
            endRowIndex={endRowIndex}
            setEndRowIndex={setEndRowIndex}
            onContinue={() => handleStepTransition('mapping')}
          />
        )}

        {currentStep === 'mapping' && (
          <Step2FieldMapping
            fields={fields}
            setFields={setFields}
            spreadsheetData={spreadsheetData}
            selectedWorksheetName={selectedWorksheetName}
            onBack={() => handleStepTransition('source')}
            onContinue={() => handleStepTransition('amount_calc')}
            onSaveTemplate={handleSaveTemplate}
          />
        )}

        {currentStep === 'amount_calc' && (
          <Step3AmountCalculations
            amountSettings={amountSettings}
            setAmountSettings={setAmountSettings}
            calculationSettings={calculationSettings}
            setCalculationSettings={setCalculationSettings}
            fields={fields}
            spreadsheetData={spreadsheetData}
            selectedWorksheetName={selectedWorksheetName}
            onBack={() => handleStepTransition('mapping')}
            onContinue={() => handleStepTransition('gst_calc')}
          />
        )}

        {currentStep === 'gst_calc' && (
          <Step4GstCalculations
            gstSettings={gstSettings}
            setGstSettings={setGstSettings}
            amountSettings={amountSettings}
            calculationSettings={calculationSettings}
            setCalculationSettings={setCalculationSettings}
            company={company}
            fields={fields}
            spreadsheetData={spreadsheetData}
            selectedWorksheetName={selectedWorksheetName}
            onBack={() => handleStepTransition('amount_calc')}
            onContinue={() => handleStepTransition('review')}
          />
        )}

        {currentStep === 'review' && (
          <Step5ReviewData
            spreadsheetData={spreadsheetData}
            selectedWorksheetName={selectedWorksheetName}
            startRowIndex={startRowIndex}
            endRowIndex={endRowIndex}
            fields={fields}
            company={company}
            amountSettings={amountSettings}
            gstSettings={gstSettings}
            customEditedRows={customEditedRows}
            setCustomEditedRows={setCustomEditedRows}
            onBackToMapping={() => handleStepTransition('mapping')}
            onBackToCalculations={() => handleStepTransition('amount_calc')}
            onContinue={() => handleStepTransition('finalize')}
          />
        )}

        {currentStep === 'finalize' && (
          <Step6FinalizeInvoice
            company={company}
            fields={fields}
            template={template}
            spreadsheetData={spreadsheetData}
            selectedWorksheetName={selectedWorksheetName}
            startRowIndex={startRowIndex}
            endRowIndex={endRowIndex}
            amountSettings={amountSettings}
            gstSettings={gstSettings}
            customEditedRows={customEditedRows}
            onBack={() => handleStepTransition('review')}
            onProceedToGenerator={handleFinalProceed}
          />
        )}
      </div>
    </div>
  );
};
