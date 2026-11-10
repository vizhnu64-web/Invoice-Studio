/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  InvoiceFieldConfig, 
  MappingProfile, 
  SpreadsheetData, 
  FieldCategory, 
  DataSourceType 
} from '../types';
import { 
  Search, 
  Plus, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Trash2, 
  ChevronDown, 
  ChevronRight, 
  SlidersHorizontal,
  CheckCircle2,
  Calculator,
  AlertCircle
} from 'lucide-react';

import { CalculationSettings } from '../types';

interface FieldCatalogViewProps {
  fields: InvoiceFieldConfig[];
  setFields: React.Dispatch<React.SetStateAction<InvoiceFieldConfig[]>>;
  mappingProfiles: MappingProfile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  spreadsheetData: SpreadsheetData;
  calculationSettings?: CalculationSettings;
  setCalculationSettings?: (settings: CalculationSettings) => void;
}

export const FieldCatalogView: React.FC<FieldCatalogViewProps> = ({
  fields,
  setFields,
  mappingProfiles,
  activeProfileId,
  setActiveProfileId,
  spreadsheetData,
  calculationSettings,
  setCalculationSettings,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddingCustomField, setIsAddingCustomField] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // New Custom Field State
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldCategory, setNewFieldCategory] = useState<FieldCategory>('custom');
  const [newFieldSource, setNewFieldSource] = useState<DataSourceType>('manual');
  const [newFieldDefaultValue, setNewFieldDefaultValue] = useState('');

  const activeWorksheet = spreadsheetData.worksheets.find(ws => ws.name === spreadsheetData.activeSheetName) || spreadsheetData.worksheets[0];
  const availableColumns = activeWorksheet ? activeWorksheet.headers : [];

  const handleToggleFetch = (id: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, fetchEnabled: !f.fetchEnabled } : f));
  };

  const handleToggleVisibility = (id: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, pdfVisibility: !f.pdfVisibility } : f));
  };

  const handleUpdateLabel = (id: string, newLabel: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, displayName: newLabel } : f));
  };

  const handleUpdateSourceColumn = (id: string, col: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, sourceColumn: col, dataSource: col ? 'excel' : f.dataSource } : f));
  };

  const handleUpdateDataSource = (id: string, source: DataSourceType) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, dataSource: source } : f));
  };

  const handleApplyProfile = (profileId: string) => {
    setActiveProfileId(profileId);
    const profile = mappingProfiles.find(p => p.id === profileId);
    if (!profile) return;

    setFields(prev => prev.map(field => {
      const mapping = profile.mappings[field.id];
      if (mapping) {
        return {
          ...field,
          sourceColumn: mapping.column,
          fetchEnabled: mapping.fetchEnabled,
          pdfVisibility: mapping.pdfVisibility,
          displayName: mapping.displayName || field.displayName,
          dataSource: 'excel'
        };
      }
      return field;
    }));

    if (profile.calculationSettings && setCalculationSettings) {
      setCalculationSettings(profile.calculationSettings);
    }
  };

  const handleAddCustomField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName.trim()) return;

    const id = 'custom_' + Math.random().toString(36).substr(2, 9);
    const newField: InvoiceFieldConfig = {
      id,
      defaultName: newFieldName,
      displayName: newFieldName,
      category: newFieldCategory,
      dataType: 'string',
      dataSource: newFieldSource,
      fetchEnabled: true,
      pdfVisibility: true,
      value: newFieldDefaultValue,
      defaultValue: newFieldDefaultValue,
      required: false,
      displayOrder: fields.length + 1,
      isCustom: true
    };

    setFields(prev => [...prev, newField]);
    setNewFieldName('');
    setNewFieldDefaultValue('');
    setIsAddingCustomField(false);
  };

  const handleDeleteCustomField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
  };

  const toggleSectionCollapse = (cat: string) => {
    setCollapsedSections(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  // 11 Logical Categories as requested
  const categories: { key: string; label: string; match: (f: InvoiceFieldConfig) => boolean }[] = [
    { key: 'company', label: '1. Company Information', match: f => f.category === 'company' },
    { key: 'invoice', label: '2. Invoice Information', match: f => f.category === 'invoice' },
    { key: 'customer', label: '3. Customer Information', match: f => f.category === 'customer' },
    { key: 'subject', label: '4. Subject', match: f => f.category === 'subject' },
    { key: 'item', label: '5. Invoice Items', match: f => f.category === 'item' },
    { key: 'tax', label: '6. Tax Details', match: f => f.category === 'summary' && f.id.includes('tax') || f.id.includes('gst') || f.id.includes('subtotal') },
    { key: 'payment', label: '7. Payment Details', match: f => f.category === 'summary' && (f.id.includes('payment') || f.id.includes('balance') || f.id.includes('total')) },
    { key: 'bank', label: '8. Bank Details', match: f => f.category === 'bank' },
    { key: 'notes', label: '9. Notes', match: f => f.category === 'notes' },
    { key: 'terms_footer', label: '10. Terms and Footer', match: f => f.category === 'terms' || f.category === 'footer' },
    { key: 'custom', label: '11. Custom Fields', match: f => f.category === 'custom' || f.isCustom === true },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & Profiles */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Universal Invoice Field Manager & Mapping</h1>
          <p className="text-sm text-slate-500">Configure every field appearing in your PDF, control fetch settings, visibility, and source column mappings across 11 logical groups.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Profile:</span>
            <select
              value={activeProfileId}
              onChange={(e) => handleApplyProfile(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-600 outline-none font-medium"
            >
              {mappingProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.worksheetName})</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setIsAddingCustomField(true)}
            className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Custom Field</span>
          </button>
        </div>
      </div>

      {/* Calculation Engine & Amount Mapping Settings */}
      {calculationSettings && setCalculationSettings && (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Amount Calculation Engine</h2>
                <p className="text-xs text-slate-500">Configure how line amounts and totals are calculated from Excel columns</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setCalculationSettings({ ...calculationSettings, mode: 'calculated' })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  calculationSettings.mode === 'calculated'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Calculated Mode (Qty × Rate)
              </button>
              <button
                type="button"
                onClick={() => setCalculationSettings({ ...calculationSettings, mode: 'excel_amount' })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  calculationSettings.mode === 'excel_amount'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Excel Amount Mode (Direct Amount)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
              <span className="font-semibold text-slate-800">
                Active Mode: {calculationSettings.mode === 'calculated' ? 'Calculated Mode (Qty × Unit Price)' : 'Excel Amount Mode (Direct Column)'}
              </span>
              <p className="text-slate-600 leading-relaxed">
                {calculationSettings.mode === 'calculated'
                  ? 'Line Subtotal = Quantity × Unit Price − Discount. GST is applied to the taxable amount to derive Line Total.'
                  : 'Uses the mapped Excel Amount column directly as the line amount. Never multiplies by quantity or applies discounts twice.'}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-center space-y-2">
              {calculationSettings.mode === 'excel_amount' ? (
                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={calculationSettings.taxInclusive}
                    onChange={(e) => setCalculationSettings({ ...calculationSettings, taxInclusive: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="font-semibold text-slate-800">Excel Amount includes GST / Tax</span>
                    <p className="text-[11px] text-slate-500">
                      {calculationSettings.taxInclusive 
                        ? 'Extracts base taxable amount; GST is NOT added a second time.' 
                        : 'Amount is tax-exclusive; GST is calculated and added to form grand total.'}
                    </p>
                  </div>
                </label>
              ) : (
                <div className="text-slate-600">
                  <span className="font-semibold text-slate-800">Strict Mapping Guarantee:</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">Numeric values are parsed preserving decimals without accidental fallbacks to adjacent columns.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative w-full">
        <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search fields, display labels, or source columns across all categories..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-600 outline-none shadow-sm"
        />
      </div>

      {/* Add Custom Field Modal */}
      {isAddingCustomField && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Create Custom Invoice Field</h3>
            <form onSubmit={handleAddCustomField} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Field Name / Label</label>
                <input
                  type="text"
                  placeholder="e.g. Project Code"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={newFieldCategory}
                  onChange={(e) => setNewFieldCategory(e.target.value as FieldCategory)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="custom">Custom</option>
                  <option value="invoice">Invoice</option>
                  <option value="customer">Customer</option>
                  <option value="summary">Summary</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Data Source</label>
                <select
                  value={newFieldSource}
                  onChange={(e) => setNewFieldSource(e.target.value as DataSourceType)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="manual">Manual Input</option>
                  <option value="excel">Excel Column</option>
                  <option value="static">Static Default Value</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Default Value</label>
                <input
                  type="text"
                  placeholder="Default value"
                  value={newFieldDefaultValue}
                  onChange={(e) => setNewFieldDefaultValue(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingCustomField(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                >
                  Add Field
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grouped Expandable Categories */}
      <div className="space-y-4">
        {categories.map(cat => {
          const categoryFields = fields.filter(f => {
            const matchesCategory = cat.match(f);
            const matchesSearch = f.defaultName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                  f.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                  (f.sourceColumn && f.sourceColumn.toLowerCase().includes(searchTerm.toLowerCase()));
            return matchesCategory && matchesSearch;
          });

          if (categoryFields.length === 0 && searchTerm) return null;

          const isCollapsed = collapsedSections[cat.key];

          return (
            <div key={cat.key} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div 
                onClick={() => toggleSectionCollapse(cat.key)}
                className="flex items-center justify-between p-4 bg-slate-50 border-b border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  {isCollapsed ? <ChevronRight className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                  <h2 className="text-base font-bold text-slate-900">{cat.label}</h2>
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full font-semibold">
                    {categoryFields.length} fields
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-medium">Click to collapse / expand</span>
              </div>

              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-white">
                        <th className="py-3 px-4">Invoice Field</th>
                        <th className="py-3 px-4">Data Source</th>
                        <th className="py-3 px-4">Source Column</th>
                        <th className="py-3 px-4 text-center">Fetch</th>
                        <th className="py-3 px-4 text-center">PDF Visibility</th>
                        <th className="py-3 px-4">PDF Display Label</th>
                        <th className="py-3 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {categoryFields.map(field => (
                        <tr key={field.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-900 block">{field.defaultName}</span>
                            <span className="text-xs text-slate-400 font-mono">{field.id}</span>
                          </td>

                          <td className="py-3 px-4">
                            <select
                              value={field.dataSource}
                              onChange={(e) => handleUpdateDataSource(field.id, e.target.value as DataSourceType)}
                              className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg px-2.5 py-1.5 outline-none font-medium"
                            >
                              <option value="excel">Excel / Sheet</option>
                              <option value="company">Company</option>
                              <option value="calculated">Calculated</option>
                              <option value="manual">Manual</option>
                              <option value="static">Static</option>
                            </select>
                          </td>

                          <td className="py-3 px-4">
                            <select
                              value={field.sourceColumn || ''}
                              onChange={(e) => handleUpdateSourceColumn(field.id, e.target.value)}
                              className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg px-2.5 py-1.5 outline-none font-medium max-w-[160px] truncate"
                            >
                              <option value="">-- None --</option>
                              {availableColumns.map((col, cIdx) => (
                                <option key={`${col}_${cIdx}`} value={col}>{col}</option>
                              ))}
                            </select>
                          </td>

                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleToggleFetch(field.id)}
                              className={`p-1.5 rounded-lg transition-all ${
                                field.fetchEnabled
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-100 text-slate-400'
                              }`}
                              title={field.fetchEnabled ? 'Fetch Enabled' : 'Fetch Disabled'}
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </td>

                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleToggleVisibility(field.id)}
                              className={`p-1.5 rounded-lg transition-all ${
                                field.pdfVisibility
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : 'bg-slate-100 text-slate-400'
                              }`}
                              title={field.pdfVisibility ? 'Visible in PDF' : 'Hidden from PDF'}
                            >
                              {field.pdfVisibility ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            </button>
                          </td>

                          <td className="py-3 px-4">
                            <input
                              type="text"
                              value={field.displayName}
                              onChange={(e) => handleUpdateLabel(field.id, e.target.value)}
                              className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-indigo-600 w-full"
                            />
                          </td>

                          <td className="py-3 px-4">
                            {field.isCustom ? (
                              <button
                                onClick={() => handleDeleteCustomField(field.id)}
                                className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                                title="Delete Custom Field"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400 font-mono">System</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
