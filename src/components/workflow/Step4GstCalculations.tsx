/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { 
  GstConfigurationSettings, 
  CompanySettings, 
  AdvancedAmountCalculationSettings, 
  CalculationSettings, 
  SpreadsheetData, 
  InvoiceFieldConfig 
} from '../../types';
import { 
  Percent, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  ArrowLeft, 
  ShieldCheck, 
  HelpCircle,
  Sparkles,
  Info
} from 'lucide-react';
import { formatCurrency } from '../../utils/calculator';

interface Step4GstCalculationsProps {
  gstSettings: GstConfigurationSettings;
  setGstSettings: React.Dispatch<React.SetStateAction<GstConfigurationSettings>>;
  amountSettings: AdvancedAmountCalculationSettings;
  calculationSettings: CalculationSettings;
  setCalculationSettings: (settings: CalculationSettings) => void;
  company: CompanySettings;
  fields: InvoiceFieldConfig[];
  spreadsheetData: SpreadsheetData;
  selectedWorksheetName: string;
  onBack: () => void;
  onContinue: () => void;
}

export const Step4GstCalculations: React.FC<Step4GstCalculationsProps> = ({
  gstSettings,
  setGstSettings,
  amountSettings,
  calculationSettings,
  setCalculationSettings,
  company,
  fields,
  spreadsheetData,
  selectedWorksheetName,
  onBack,
  onContinue,
}) => {
  const activeWorksheet = spreadsheetData.worksheets.find(
    ws => ws.name === (selectedWorksheetName || spreadsheetData.activeSheetName)
  ) || spreadsheetData.worksheets[0];

  const headers = activeWorksheet?.headers || [];
  const sampleRow = activeWorksheet?.rows?.[0] || {};

  // Extract sample taxable amount from Row 1
  const sampleTaxableAmount = useMemo(() => {
    if (amountSettings.taxableAmount.method === 'fixed') {
      return amountSettings.taxableAmount.fixedValue || 50000;
    }
    if (amountSettings.taxableAmount.method === 'excel_column' && amountSettings.taxableAmount.sourceColumn) {
      const val = sampleRow[amountSettings.taxableAmount.sourceColumn];
      const parsed = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 50000;
    }
    const qCol = fields.find(f => f.id === 'item_quantity')?.sourceColumn;
    const rCol = fields.find(f => f.id === 'item_unit_price')?.sourceColumn;
    const q = qCol ? parseFloat(sampleRow[qCol]) || 1 : 1;
    const r = rCol ? parseFloat(sampleRow[rCol]) || 50000 : 50000;
    return q * r;
  }, [amountSettings, sampleRow, fields]);

  // Determine effective GST percentage
  const effectiveGstRate = useMemo(() => {
    if (!gstSettings.enabled) return 0;
    if (gstSettings.rateSource === 'fixed') return gstSettings.fixedRate || 18;
    if (gstSettings.rateColumn) {
      const raw = sampleRow[gstSettings.rateColumn];
      const parsed = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 18;
    }
    return 18;
  }, [gstSettings, sampleRow]);

  // Determine whether intra-state or inter-state
  const placeOfSupplyCol = fields.find(f => f.id === 'place_of_supply')?.sourceColumn;
  const samplePlaceOfSupply = placeOfSupplyCol ? String(sampleRow[placeOfSupplyCol] || '') : '';
  const isCompanyInHaryana = (company.state || '').toLowerCase().includes('haryana');
  const isCustomerInHaryana = samplePlaceOfSupply.toLowerCase().includes('haryana') || samplePlaceOfSupply.includes('06');

  const resolvedTaxType = useMemo(() => {
    if (gstSettings.taxType !== 'AUTO') return gstSettings.taxType;
    if (samplePlaceOfSupply && company.state) {
      return isCustomerInHaryana && isCompanyInHaryana ? 'CGST_SGST' : 'IGST';
    }
    return 'IGST';
  }, [gstSettings.taxType, samplePlaceOfSupply, company.state, isCustomerInHaryana, isCompanyInHaryana]);

  // Live Calculation Computation
  const calculationPreview = useMemo(() => {
    if (!gstSettings.enabled || effectiveGstRate === 0) {
      return {
        baseTaxable: sampleTaxableAmount,
        totalGst: 0,
        cgstAmt: 0,
        sgstAmt: 0,
        igstAmt: 0,
        finalInvoiceAmount: sampleTaxableAmount,
      };
    }

    if (gstSettings.pricingType === 'inclusive') {
      // Amount already includes GST: Base = Total / (1 + Rate / 100)
      const finalAmount = sampleTaxableAmount;
      const baseTaxable = finalAmount / (1 + effectiveGstRate / 100);
      const totalGst = finalAmount - baseTaxable;

      return {
        baseTaxable,
        totalGst,
        cgstAmt: resolvedTaxType === 'CGST_SGST' ? totalGst / 2 : 0,
        sgstAmt: resolvedTaxType === 'CGST_SGST' ? totalGst / 2 : 0,
        igstAmt: resolvedTaxType === 'IGST' ? totalGst : 0,
        finalInvoiceAmount: finalAmount,
      };
    } else {
      // Amount excludes GST: Total = Base + (Base * Rate / 100)
      const baseTaxable = sampleTaxableAmount;
      const totalGst = (baseTaxable * effectiveGstRate) / 100;

      return {
        baseTaxable,
        totalGst,
        cgstAmt: resolvedTaxType === 'CGST_SGST' ? totalGst / 2 : 0,
        sgstAmt: resolvedTaxType === 'CGST_SGST' ? totalGst / 2 : 0,
        igstAmt: resolvedTaxType === 'IGST' ? totalGst : 0,
        finalInvoiceAmount: baseTaxable + totalGst,
      };
    }
  }, [gstSettings, effectiveGstRate, sampleTaxableAmount, resolvedTaxType]);

  const handleToggleInclusive = (inclusive: boolean) => {
    setGstSettings(prev => ({ ...prev, pricingType: inclusive ? 'inclusive' : 'exclusive' }));
    setCalculationSettings({ ...calculationSettings, taxInclusive: inclusive });
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">Step 4: Configure GST & Tax Calculations</h2>
        <p className="text-sm text-slate-600 mt-1">
          Configure how tax is calculated for your invoices. Review each tax field separately, choose between inclusive or exclusive pricing, and eliminate any risk of double taxation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Configuration Form (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Card A: Enable GST & Pricing Mode */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">GST Enablement & Pricing Structure</h3>
                <p className="text-xs text-slate-500">Determine whether Goods & Services Tax applies to this invoice batch</p>
              </div>

              {/* Enable Toggle */}
              <button
                type="button"
                onClick={() => setGstSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  gstSettings.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    gstSettings.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {gstSettings.enabled ? (
              <div className="space-y-4 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    Pricing Mode (Tax Inclusive vs. Exclusive):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      onClick={() => handleToggleInclusive(false)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        gstSettings.pricingType === 'exclusive'
                          ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 shadow-xs'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100/60 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs">Tax Exclusive (Standard)</span>
                        <input
                          type="radio"
                          name="pricingType"
                          checked={gstSettings.pricingType === 'exclusive'}
                          onChange={() => handleToggleInclusive(false)}
                          className="text-indigo-600"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Item rate/subtotal is the taxable base. GST is added on top of the base amount to compute total.
                      </p>
                    </div>

                    <div
                      onClick={() => handleToggleInclusive(true)}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        gstSettings.pricingType === 'inclusive'
                          ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 shadow-xs'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100/60 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs">Tax Inclusive (All-Inclusive)</span>
                        <input
                          type="radio"
                          name="pricingType"
                          checked={gstSettings.pricingType === 'inclusive'}
                          onChange={() => handleToggleInclusive(true)}
                          className="text-indigo-600"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Excel amounts already include GST. The base taxable amount is extracted without adding tax twice.
                      </p>
                    </div>
                  </div>
                </div>

                {/* GST Rate Source */}
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <label className="block text-xs font-bold text-slate-700">
                    GST Rate Source:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center space-x-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer text-xs font-medium text-slate-800">
                      <input
                        type="radio"
                        name="rateSource"
                        value="fixed"
                        checked={gstSettings.rateSource === 'fixed'}
                        onChange={() => setGstSettings(prev => ({ ...prev, rateSource: 'fixed' }))}
                        className="text-indigo-600"
                      />
                      <span>Fixed Standard Rate</span>
                    </label>

                    <label className="flex items-center space-x-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer text-xs font-medium text-slate-800">
                      <input
                        type="radio"
                        name="rateSource"
                        value="column"
                        checked={gstSettings.rateSource === 'column'}
                        onChange={() => setGstSettings(prev => ({ ...prev, rateSource: 'column' }))}
                        className="text-indigo-600"
                      />
                      <span>Read from Excel Column</span>
                    </label>
                  </div>

                  {gstSettings.rateSource === 'fixed' ? (
                    <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                      <span className="font-semibold text-slate-700">Select Standard GST %:</span>
                      <select
                        value={gstSettings.fixedRate}
                        onChange={(e) => setGstSettings(prev => ({ ...prev, fixedRate: Number(e.target.value) }))}
                        className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 font-bold text-slate-800 outline-none"
                      >
                        <option value={18}>18% (Standard Services & Goods)</option>
                        <option value={12}>12% (IT & Hardware / Food)</option>
                        <option value={5}>5% (Essential Services)</option>
                        <option value={28}>28% (Luxury / Automobiles)</option>
                        <option value={0}>0% (Exempted / Zero Rated)</option>
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                      <span className="font-semibold text-slate-700 whitespace-nowrap">Tax Rate Column:</span>
                      <select
                        value={gstSettings.rateColumn || ''}
                        onChange={(e) => setGstSettings(prev => ({ ...prev, rateColumn: e.target.value }))}
                        className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none"
                      >
                        <option value="">-- Select Excel Column --</option>
                        {headers.map((h, hIdx) => (
                          <option key={`${h}_${hIdx}`} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 p-4 rounded-xl text-xs text-slate-500 font-medium">
                GST is currently disabled. Invoices will be generated without tax rows or GST breakdown.
              </div>
            )}
          </div>

          {/* Card B: Tax Type (IGST vs. CGST+SGST) */}
          {gstSettings.enabled && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Tax Type & Place of Supply Rule</h3>
                <p className="text-xs text-slate-500">
                  Select between Integrated GST (IGST) or Central + State GST (CGST + SGST)
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  onClick={() => setGstSettings(prev => ({ ...prev, taxType: 'AUTO' }))}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    gstSettings.taxType === 'AUTO'
                      ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs">Auto-Detect (Smart)</span>
                    <input
                      type="radio"
                      name="taxType"
                      checked={gstSettings.taxType === 'AUTO'}
                      onChange={() => setGstSettings(prev => ({ ...prev, taxType: 'AUTO' }))}
                      className="text-indigo-600"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 font-normal">
                    Compares supplier state ({company.state || 'Haryana'}) vs. customer place of supply.
                  </p>
                </div>

                <div
                  onClick={() => setGstSettings(prev => ({ ...prev, taxType: 'IGST' }))}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    gstSettings.taxType === 'IGST'
                      ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs">IGST (Inter-State)</span>
                    <input
                      type="radio"
                      name="taxType"
                      checked={gstSettings.taxType === 'IGST'}
                      onChange={() => setGstSettings(prev => ({ ...prev, taxType: 'IGST' }))}
                      className="text-indigo-600"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 font-normal">
                    Applies full {effectiveGstRate}% under Integrated GST for out-of-state customers.
                  </p>
                </div>

                <div
                  onClick={() => setGstSettings(prev => ({ ...prev, taxType: 'CGST_SGST' }))}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    gstSettings.taxType === 'CGST_SGST'
                      ? 'border-indigo-600 bg-indigo-50/40 text-indigo-950 font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs">CGST + SGST (Intra-State)</span>
                    <input
                      type="radio"
                      name="taxType"
                      checked={gstSettings.taxType === 'CGST_SGST'}
                      onChange={() => setGstSettings(prev => ({ ...prev, taxType: 'CGST_SGST' }))}
                      className="text-indigo-600"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 font-normal">
                    Splits tax equally into CGST ({effectiveGstRate / 2}%) and SGST ({effectiveGstRate / 2}%).
                  </p>
                </div>
              </div>

              {/* Resolved Tax Type Notice */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">
                  Active Tax Treatment for Sample Row #1:
                </span>
                <span className="font-bold text-indigo-700 bg-indigo-100/70 px-2.5 py-1 rounded-md">
                  {resolvedTaxType === 'CGST_SGST'
                    ? `CGST (${effectiveGstRate / 2}%) + SGST (${effectiveGstRate / 2}%)`
                    : `IGST (${effectiveGstRate}%)`}
                </span>
              </div>
            </div>
          )}

          {/* Card C: Tax Fields Breakdown Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm">Tax Fields Breakdown & Computation</h3>
              <p className="text-xs text-slate-500">Every tax component is audited independently</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 px-4 font-bold">Tax Field</th>
                    <th className="py-2.5 px-4 font-bold">Computation Formula</th>
                    <th className="py-2.5 px-4 font-bold text-right">Sample Row Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-sans">
                  <tr>
                    <td className="py-2.5 px-4 font-bold text-slate-900">Taxable Amount</td>
                    <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">
                      {gstSettings.pricingType === 'inclusive' ? 'Gross / (1 + GST%)' : 'Gross − Discount'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(calculationPreview.baseTaxable, company.currency)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-bold text-slate-900">GST Rate (%)</td>
                    <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">
                      {gstSettings.rateSource === 'fixed' ? 'Fixed Configuration' : `Excel Column (${gstSettings.rateColumn || 'Unmapped'})`}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-800">
                      {effectiveGstRate}%
                    </td>
                  </tr>
                  {resolvedTaxType === 'IGST' ? (
                    <tr>
                      <td className="py-2.5 px-4 font-bold text-indigo-700">IGST Amount</td>
                      <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">Taxable Amount × {effectiveGstRate}%</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-indigo-700">
                        {formatCurrency(calculationPreview.igstAmt, company.currency)}
                      </td>
                    </tr>
                  ) : (
                    <>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-indigo-700">CGST Amount</td>
                        <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">Taxable Amount × {effectiveGstRate / 2}%</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-indigo-700">
                          {formatCurrency(calculationPreview.cgstAmt, company.currency)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-indigo-700">SGST Amount</td>
                        <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">Taxable Amount × {effectiveGstRate / 2}%</td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-indigo-700">
                          {formatCurrency(calculationPreview.sgstAmt, company.currency)}
                        </td>
                      </tr>
                    </>
                  )}
                  <tr className="bg-slate-50 font-bold">
                    <td className="py-3 px-4 text-slate-900">Final Invoice Total</td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">Taxable Amount + Total GST</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 text-sm">
                      {formatCurrency(calculationPreview.finalInvoiceAmount, company.currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Realistic Example & Double-Taxation Protection (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 sticky top-20 space-y-4">
            <div className="flex items-center space-x-2 text-indigo-400 border-b border-slate-800 pb-3">
              <Sparkles className="w-5 h-5" />
              <h3 className="font-bold text-white text-sm">Live Invoice Tax Preview</h3>
            </div>

            <div className="space-y-2.5 text-xs font-sans">
              <div className="flex justify-between text-slate-300">
                <span>Quantity:</span>
                <span className="font-mono text-white">1 Nos</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Unit Rate:</span>
                <span className="font-mono text-white">{formatCurrency(sampleTaxableAmount, company.currency)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Gross Amount:</span>
                <span className="font-mono text-white">{formatCurrency(sampleTaxableAmount, company.currency)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Discount:</span>
                <span className="font-mono text-emerald-400">- {formatCurrency(0, company.currency)}</span>
              </div>
              <div className="flex justify-between text-amber-300 font-bold pt-1 border-t border-slate-800">
                <span>Taxable Amount:</span>
                <span className="font-mono">{formatCurrency(calculationPreview.baseTaxable, company.currency)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>GST Rate:</span>
                <span className="font-mono text-white">{effectiveGstRate}%</span>
              </div>
              {resolvedTaxType === 'IGST' ? (
                <div className="flex justify-between text-indigo-300">
                  <span>IGST Total:</span>
                  <span className="font-mono">{formatCurrency(calculationPreview.igstAmt, company.currency)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-indigo-300">
                    <span>CGST ({effectiveGstRate / 2}%):</span>
                    <span className="font-mono">{formatCurrency(calculationPreview.cgstAmt, company.currency)}</span>
                  </div>
                  <div className="flex justify-between text-indigo-300">
                    <span>SGST ({effectiveGstRate / 2}%):</span>
                    <span className="font-mono">{formatCurrency(calculationPreview.sgstAmt, company.currency)}</span>
                  </div>
                </>
              )}
              <div className="border-t border-slate-700 pt-3 flex justify-between items-center text-sm font-bold text-emerald-400">
                <span>Final Invoice Amount:</span>
                <span className="font-mono">{formatCurrency(calculationPreview.finalInvoiceAmount, company.currency)}</span>
              </div>
            </div>

            {/* Zero Double-Count Guarantee Badge */}
            <div className="bg-emerald-950/60 p-3.5 rounded-xl border border-emerald-500/30 text-emerald-300 text-[11px] space-y-1">
              <div className="flex items-center space-x-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zero Double-Counting Guarantee</span>
              </div>
              <p className="text-emerald-400/90 leading-relaxed">
                {gstSettings.pricingType === 'inclusive'
                  ? 'Your amounts are marked tax-inclusive. The engine extracts the base taxable value without adding GST a second time.'
                  : 'Your amounts are marked tax-exclusive. GST is calculated on the taxable amount and added exactly once.'}
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
          <span>Back to Amount Calculations</span>
        </button>

        <button
          onClick={onContinue}
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold text-sm shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <span>Continue to Review Imported Data</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
