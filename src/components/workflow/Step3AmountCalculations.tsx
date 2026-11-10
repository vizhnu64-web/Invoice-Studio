/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  AdvancedAmountCalculationSettings, 
  CalculationMethod, 
  CalculationSettings, 
  InvoiceFieldConfig, 
  SpreadsheetData 
} from '../../types';
import { 
  Calculator, 
  Layers, 
  ArrowRight, 
  ArrowLeft, 
  Sliders, 
  Plus, 
  CheckCircle2, 
  Code2, 
  Sparkles,
  Info
} from 'lucide-react';
import { safeEvaluateFormula } from '../../utils/formulaParser';

interface Step3AmountCalculationsProps {
  amountSettings: AdvancedAmountCalculationSettings;
  setAmountSettings: React.Dispatch<React.SetStateAction<AdvancedAmountCalculationSettings>>;
  calculationSettings: CalculationSettings;
  setCalculationSettings: (settings: CalculationSettings) => void;
  fields: InvoiceFieldConfig[];
  spreadsheetData: SpreadsheetData;
  selectedWorksheetName: string;
  onBack: () => void;
  onContinue: () => void;
}

export const Step3AmountCalculations: React.FC<Step3AmountCalculationsProps> = ({
  amountSettings,
  setAmountSettings,
  calculationSettings,
  setCalculationSettings,
  fields,
  spreadsheetData,
  selectedWorksheetName,
  onBack,
  onContinue,
}) => {
  const [activeFormulaField, setActiveFormulaField] = useState<string | null>(null);

  const activeWorksheet = spreadsheetData.worksheets.find(
    ws => ws.name === (selectedWorksheetName || spreadsheetData.activeSheetName)
  ) || spreadsheetData.worksheets[0];

  const headers = activeWorksheet?.headers || [];
  const sampleRow = activeWorksheet?.rows?.[0] || {};

  // Helper to change method
  const handleUpdateFieldMethod = (
    fieldKey: keyof AdvancedAmountCalculationSettings,
    method: CalculationMethod,
    sourceColumn?: string
  ) => {
    setAmountSettings(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        method,
        sourceColumn: sourceColumn !== undefined ? sourceColumn : prev[fieldKey]?.sourceColumn
      }
    }));

    // Synchronize overall calculation mode
    if (fieldKey === 'taxableAmount' || fieldKey === 'lineTotal') {
      if (method === 'excel_column') {
        setCalculationSettings({ ...calculationSettings, mode: 'excel_amount' });
      } else {
        setCalculationSettings({ ...calculationSettings, mode: 'calculated' });
      }
    }
  };

  const handleUpdateFixedValue = (
    fieldKey: keyof AdvancedAmountCalculationSettings,
    val: number
  ) => {
    setAmountSettings(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        fixedValue: val
      }
    }));
  };

  const handleAppendFormula = (
    fieldKey: keyof AdvancedAmountCalculationSettings,
    token: string
  ) => {
    setAmountSettings(prev => {
      const current = prev[fieldKey]?.formula || '';
      const updated = current ? `${current} ${token}` : token;
      return {
        ...prev,
        [fieldKey]: {
          ...prev[fieldKey],
          formula: updated
        }
      };
    });
  };

  // Live simulation for preview box
  const getFieldVal = (fieldKey: keyof AdvancedAmountCalculationSettings): number => {
    const cfg = amountSettings[fieldKey];
    if (!cfg) return 0;

    if (cfg.method === 'fixed' || cfg.method === 'manual') {
      return cfg.fixedValue || 0;
    }

    if (cfg.method === 'excel_column' && cfg.sourceColumn) {
      const raw = sampleRow[cfg.sourceColumn];
      const parsed = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (cfg.method === 'formula' && cfg.formula) {
      const scope: Record<string, number> = {
        Quantity: getFieldVal('quantity'),
        Rate: getFieldVal('unitRate'),
        Unit_Price: getFieldVal('unitRate'),
        Gross_Amount: getFieldVal('quantity') * getFieldVal('unitRate'),
        Discount: getFieldVal('discount'),
      };
      const res = safeEvaluateFormula(cfg.formula, scope);
      return res.success ? res.value : 0;
    }

    // Default 'automatic' rules
    if (fieldKey === 'quantity') {
      const qCol = fields.find(f => f.id === 'item_quantity')?.sourceColumn;
      return qCol ? parseFloat(sampleRow[qCol]) || 1 : 1;
    }
    if (fieldKey === 'unitRate') {
      const rCol = fields.find(f => f.id === 'item_unit_price')?.sourceColumn;
      return rCol ? parseFloat(sampleRow[rCol]) || 50000 : 50000;
    }
    if (fieldKey === 'grossAmount') {
      return getFieldVal('quantity') * getFieldVal('unitRate');
    }
    if (fieldKey === 'discount') {
      const dCol = fields.find(f => f.id === 'item_discount')?.sourceColumn;
      return dCol ? parseFloat(sampleRow[dCol]) || 0 : 0;
    }
    if (fieldKey === 'taxableAmount') {
      const gross = getFieldVal('grossAmount');
      const disc = getFieldVal('discount');
      return Math.max(0, gross - disc);
    }
    if (fieldKey === 'additionalCharges') {
      return cfg.fixedValue || 0;
    }
    if (fieldKey === 'lineTotal' || fieldKey === 'subtotal') {
      return getFieldVal('taxableAmount');
    }

    return 0;
  };

  const previewQty = getFieldVal('quantity');
  const previewRate = getFieldVal('unitRate');
  const previewGross = getFieldVal('grossAmount');
  const previewDiscount = getFieldVal('discount');
  const previewTaxable = getFieldVal('taxableAmount');

  const formulaFields: Array<{
    key: keyof AdvancedAmountCalculationSettings;
    title: string;
    description: string;
    defaultFormula: string;
  }> = [
    {
      key: 'quantity',
      title: 'Item Quantity',
      description: 'The number of units, hours, or items billed.',
      defaultFormula: '[Quantity]'
    },
    {
      key: 'unitRate',
      title: 'Unit Rate / Price',
      description: 'The unit selling price excluding taxes and discounts.',
      defaultFormula: '[Rate]'
    },
    {
      key: 'grossAmount',
      title: 'Gross Amount (Line Subtotal)',
      description: 'Quantity × Unit Rate before any line discounts.',
      defaultFormula: 'Quantity * Rate'
    },
    {
      key: 'discount',
      title: 'Line Discount Amount',
      description: 'Discount subtracted from Gross Amount.',
      defaultFormula: '0'
    },
    {
      key: 'taxableAmount',
      title: 'Taxable Amount (Base for GST)',
      description: 'The net amount on which GST will be computed.',
      defaultFormula: 'Gross_Amount - Discount'
    },
    {
      key: 'additionalCharges',
      title: 'Additional Charges (Shipping / Handling)',
      description: 'Fixed or extra charges added before taxes.',
      defaultFormula: '0'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">Step 3: Configure Amount Calculations</h2>
        <p className="text-sm text-slate-600 mt-1">
          Choose how each invoice amount is obtained. You can use an Excel column, calculate automatically, or enter values manually.
        </p>
      </div>

      {/* Main Grid: Config Cards + Live Simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Configuration Cards for each amount field (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {formulaFields.map(({ key, title, description, defaultFormula }) => {
            const currentCfg = amountSettings[key] || { method: 'automatic' };
            const isFormulaOpen = activeFormulaField === key;

            return (
              <div key={key} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
                    <p className="text-xs text-slate-500">{description}</p>
                  </div>
                  <span className="text-xs font-mono font-bold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg">
                    Preview: ₹{getFieldVal(key).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Calculation Method Selection */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleUpdateFieldMethod(key, 'automatic')}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold text-center transition-all ${
                      currentCfg.method === 'automatic'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    Automatic
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateFieldMethod(key, 'excel_column')}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold text-center transition-all ${
                      currentCfg.method === 'excel_column'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    Excel Column
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateFieldMethod(key, 'fixed')}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold text-center transition-all ${
                      currentCfg.method === 'fixed'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    Fixed Value
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleUpdateFieldMethod(key, 'formula');
                      setActiveFormulaField(isFormulaOpen ? null : key);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold text-center transition-all ${
                      currentCfg.method === 'formula'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    Custom Formula
                  </button>
                </div>

                {/* Detail inputs depending on method */}
                {currentCfg.method === 'excel_column' && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center space-x-3 text-xs">
                    <span className="font-semibold text-slate-600 whitespace-nowrap">Source Column:</span>
                    <select
                      value={currentCfg.sourceColumn || ''}
                      onChange={(e) => handleUpdateFieldMethod(key, 'excel_column', e.target.value)}
                      className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none"
                    >
                      <option value="">-- Select Column --</option>
                      {headers.map((h, hIdx) => (
                        <option key={`${h}_${hIdx}`} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                )}

                {currentCfg.method === 'fixed' && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center space-x-3 text-xs">
                    <span className="font-semibold text-slate-600 whitespace-nowrap">Enter Fixed Amount:</span>
                    <input
                      type="number"
                      step="any"
                      value={currentCfg.fixedValue !== undefined ? currentCfg.fixedValue : 0}
                      onChange={(e) => handleUpdateFixedValue(key, parseFloat(e.target.value) || 0)}
                      className="w-32 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none font-mono"
                    />
                  </div>
                )}

                {currentCfg.method === 'formula' && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700">Formula Expression:</span>
                      <span className="text-[11px] text-slate-500">e.g., Quantity * Rate - Discount</span>
                    </div>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={currentCfg.formula || defaultFormula}
                        onChange={(e) => setAmountSettings(prev => ({
                          ...prev,
                          [key]: { ...prev[key], formula: e.target.value }
                        }))}
                        className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-xs text-indigo-700 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setAmountSettings(prev => ({
                          ...prev,
                          [key]: { ...prev[key], formula: defaultFormula }
                        }))}
                        className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 px-3 py-1 rounded-lg text-xs font-semibold"
                      >
                        Reset Formula
                      </button>
                    </div>

                    {/* Formula Token Helpers */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-slate-400 font-semibold mr-1">Insert Variable:</span>
                      {['Quantity', 'Rate', 'Gross_Amount', 'Discount'].map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleAppendFormula(key, v)}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-mono font-medium"
                        >
                          +{v}
                        </button>
                      ))}
                      <span className="text-[10px] text-slate-400 font-semibold mx-1">Operators:</span>
                      {['+', '-', '*', '/', '(', ')'].map(op => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => handleAppendFormula(key, op)}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-2 py-0.5 rounded text-[11px] font-mono font-bold"
                        >
                          {op}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Live Calculation Preview Summary (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 sticky top-20 space-y-4">
            <div className="flex items-center space-x-2 text-indigo-400 border-b border-slate-800 pb-3">
              <Calculator className="w-5 h-5" />
              <h3 className="font-bold text-white text-sm">Live Calculation Simulator</h3>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Updates in real time based on Row #1 of your worksheet. This validates your formulas before generating invoices.
            </p>

            <div className="space-y-3 pt-2 text-xs border-t border-slate-800 font-sans">
              <div className="flex justify-between items-center text-slate-300">
                <span>Quantity:</span>
                <span className="font-mono font-bold text-white">{previewQty} Nos</span>
              </div>

              <div className="flex justify-between items-center text-slate-300">
                <span>Unit Rate:</span>
                <span className="font-mono font-bold text-white">₹{previewRate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center text-slate-300">
                <span>Gross Subtotal:</span>
                <span className="font-mono font-bold text-indigo-300">₹{previewGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center text-slate-300">
                <span>Discount Applied:</span>
                <span className="font-mono text-emerald-400">- ₹{previewDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="border-t border-slate-800 pt-3 flex justify-between items-center font-bold text-sm">
                <span className="text-amber-300">Net Taxable Amount:</span>
                <span className="font-mono text-amber-300">₹{previewTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700 space-y-1.5 text-[11px] text-slate-300">
              <div className="flex items-center space-x-1.5 font-bold text-slate-200">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>Calculation Guarantee:</span>
              </div>
              <p className="text-slate-400">
                If an Excel column is selected, that exact mapped amount is used directly without duplicate discount deductions or multiplying by quantity again.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-4">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Field Mapping</span>
        </button>

        <button
          onClick={onContinue}
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold text-sm shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <span>Continue to GST & Tax Calculations</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
