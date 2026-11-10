/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  InvoiceFieldConfig, 
  SpreadsheetData 
} from '../../types';
import { 
  Wand2, 
  RotateCcw, 
  Save, 
  Search, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  HelpCircle, 
  ArrowRight, 
  ArrowLeft,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  ChevronDown,
  Eye,
  EyeOff
} from 'lucide-react';
import { suggestMappings } from '../../utils/autoMapper';

interface Step2FieldMappingProps {
  fields: InvoiceFieldConfig[];
  setFields: React.Dispatch<React.SetStateAction<InvoiceFieldConfig[]>>;
  spreadsheetData: SpreadsheetData;
  selectedWorksheetName: string;
  onBack: () => void;
  onContinue: () => void;
  onSaveTemplate?: (name: string) => void;
}

export const Step2FieldMapping: React.FC<Step2FieldMappingProps> = ({
  fields,
  setFields,
  spreadsheetData,
  selectedWorksheetName,
  onBack,
  onContinue,
  onSaveTemplate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [templateName, setTemplateName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'warn'; text: string } | null>(null);

  const activeWorksheet = spreadsheetData.worksheets.find(
    ws => ws.name === (selectedWorksheetName || spreadsheetData.activeSheetName)
  ) || spreadsheetData.worksheets[0];

  const headers = activeWorksheet?.headers || [];
  const sampleRow = activeWorksheet?.rows?.[0] || {};

  // Auto-map handler
  const handleAutoMap = () => {
    const suggestions = suggestMappings(headers, fields);
    let matchedCount = 0;

    setFields(prev => prev.map(f => {
      const sug = suggestions[f.id];
      if (sug && sug.column) {
        matchedCount++;
        return {
          ...f,
          sourceColumn: sug.column,
          mappedColumn: sug.column,
          fetchEnabled: true
        };
      }
      return f;
    }));

    setFeedbackMsg({
      type: 'success',
      text: `Auto-mapping completed! Suggested mappings applied for ${matchedCount} fields.`
    });
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleClearAll = () => {
    if (!window.confirm('Are you sure you want to clear all mapped columns?')) return;
    setFields(prev => prev.map(f => ({
      ...f,
      sourceColumn: '',
      mappedColumn: ''
    })));
    setFeedbackMsg({
      type: 'warn',
      text: 'All column mappings cleared.'
    });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleUpdateFieldMapping = (fieldId: string, colName: string) => {
    setFields(prev => prev.map(f => {
      if (f.id === fieldId) {
        return {
          ...f,
          sourceColumn: colName,
          mappedColumn: colName,
          fetchEnabled: Boolean(colName)
        };
      }
      return f;
    }));
  };

  const handleToggleRequired = (fieldId: string) => {
    setFields(prev => prev.map(f => {
      if (f.id === fieldId) {
        const nextRequired = !f.required;
        return { ...f, required: nextRequired, isRequired: nextRequired };
      }
      return f;
    }));
  };

  const handleUpdateLabel = (fieldId: string, newLabel: string) => {
    setFields(prev => prev.map(f => {
      if (f.id === fieldId) {
        return { ...f, displayName: newLabel, label: newLabel };
      }
      return f;
    }));
  };

  const handleTogglePdfVisibility = (fieldId: string) => {
    setFields(prev => prev.map(f => {
      if (f.id === fieldId) {
        const nextVis = f.pdfVisibility === false ? true : false;
        return { ...f, pdfVisibility: nextVis };
      }
      return f;
    }));
  };

  const handleUpdateMappingMode = (fieldId: string, mode: string) => {
    setFields(prev => prev.map(f => {
      if (f.id === fieldId) {
        return {
          ...f,
          mappingMode: mode as any,
          fetchEnabled: mode === 'excel_column'
        };
      }
      return f;
    }));
  };

  const handleAddCustomField = () => {
    const customName = prompt('Enter name for the new custom field (e.g., PO Number, Sales Rep):');
    if (!customName || !customName.trim()) return;
    const cleanId = `custom_${customName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const newField: InvoiceFieldConfig = {
      id: cleanId,
      key: cleanId,
      defaultName: customName.trim(),
      displayName: customName.trim(),
      label: customName.trim(),
      category: 'custom',
      dataType: 'string',
      dataSource: 'excel',
      sourceColumn: '',
      mappedColumn: '',
      fetchEnabled: false,
      pdfVisibility: true,
      value: '',
      defaultValue: '',
      required: false,
      isRequired: false,
      isCustom: true
    };
    setFields(prev => [...prev, newField]);
    setFeedbackMsg({
      type: 'success',
      text: `Added custom field "${customName.trim()}".`
    });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleDeleteField = (fieldId: string) => {
    setFields(prev => prev.filter(f => f.id !== fieldId));
  };

  // Status computation for each field
  const getFieldStatus = (f: InvoiceFieldConfig) => {
    const col = f.sourceColumn || f.mappedColumn;
    const isRequired = Boolean(f.required || f.isRequired);

    if (!col) {
      if (isRequired) return { status: 'missing_required', label: 'Missing Required', color: 'bg-rose-50 text-rose-700 border-rose-200' };
      return { status: 'unmapped', label: 'Unmapped', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }

    if (!headers.includes(col)) {
      return { status: 'invalid', label: 'Column Not in Sheet', color: 'bg-amber-50 text-amber-700 border-amber-200' };
    }

    return { status: 'matched', label: 'Matched', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  // Filtered fields
  const filteredFields = useMemo(() => {
    return fields.filter(f => {
      const matchesSearch = 
        (f.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (f.defaultName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (f.sourceColumn || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCat = filterCategory === 'all' || f.category === filterCategory;
      return matchesSearch && matchesCat;
    });
  }, [fields, searchTerm, filterCategory]);

  // Statistics
  const mappedCount = fields.filter(f => Boolean(f.sourceColumn || f.mappedColumn)).length;
  const totalCount = fields.length;
  const missingRequiredCount = fields.filter(f => (f.required || f.isRequired) && !f.sourceColumn).length;

  const handleSaveTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName.trim()) return;
    if (onSaveTemplate) onSaveTemplate(templateName.trim());
    setShowSaveModal(false);
    setTemplateName('');
    setFeedbackMsg({ type: 'success', text: `Template "${templateName.trim()}" saved for future reuse.` });
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Step 2: Map Invoice Data to Excel Columns</h2>
          <p className="text-sm text-slate-600 mt-1">
            Match each invoice attribute (like Customer Name, Date, or Item Details) to the corresponding column in your worksheet "{activeWorksheet?.name}".
          </p>
        </div>

        {/* Progress pill */}
        <div className="flex items-center space-x-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
          <div className="text-right">
            <span className="text-xs font-bold text-slate-700">Mapping Progress</span>
            <p className="text-xs text-indigo-600 font-mono font-bold">
              {mappedCount} of {totalCount} fields mapped
            </p>
          </div>
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-indigo-600 flex items-center justify-center font-bold text-xs text-slate-800">
            {Math.round((mappedCount / totalCount) * 100)}%
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div className={`p-4 rounded-xl text-xs font-semibold flex items-center space-x-2 border ${
          feedbackMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
        }`}>
          {feedbackMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleAutoMap}
            className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Wand2 className="w-4 h-4" />
            <span>Auto-Map Columns</span>
          </button>
          <button
            onClick={handleClearAll}
            className="inline-flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Clear All</span>
          </button>
          <button
            onClick={() => setShowSaveModal(true)}
            className="inline-flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
          >
            <Save className="w-3.5 h-3.5 text-slate-500" />
            <span>Save as Template</span>
          </button>
          <button
            onClick={handleAddCustomField}
            className="inline-flex items-center space-x-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-600" />
            <span>Add Custom Field</span>
          </button>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search fields or columns..."
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 w-48 sm:w-60"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-none"
          >
            <option value="all">All Categories</option>
            <option value="customer">Customer Info</option>
            <option value="invoice">Invoice Details</option>
            <option value="item">Item & Services</option>
            <option value="summary">Totals & Summary</option>
            <option value="custom">Custom Fields</option>
          </select>
        </div>
      </div>

      {/* Required Validation Notice if any missing */}
      {missingRequiredCount > 0 && (
        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start space-x-3 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Attention:</span> {missingRequiredCount} mandatory field(s) are currently unmapped (e.g. Invoice Number or Customer Name). While you can still proceed, we recommend mapping them or providing default values to ensure standard invoice generation.
          </div>
        </div>
      )}

      {/* Mapping Table with Inline Editable PDF Labels & Show/Hide Visibility Toggles */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="py-3 px-4 font-bold w-1/3">Invoice Field & PDF Label Name</th>
                <th className="py-3 px-4 font-bold w-1/4">Selected Source Column</th>
                <th className="py-3 px-4 font-bold w-1/5">Sample Value (Row 1)</th>
                <th className="py-3 px-4 font-bold w-24 text-center">PDF Show / Hide</th>
                <th className="py-3 px-4 font-bold w-24 text-center">Status</th>
                <th className="py-3 px-4 font-bold text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredFields.map((field) => {
                const statusInfo = getFieldStatus(field);
                const currentColumn = field.sourceColumn || field.mappedColumn || '';
                const sampleVal = currentColumn && sampleRow[currentColumn] !== undefined
                  ? String(sampleRow[currentColumn])
                  : (field.value || field.defaultValue ? String(field.value || field.defaultValue) : '—');

                return (
                  <tr key={field.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Column 1: Invoice Field & Inline Editable PDF Label Name */}
                    <td className="py-3 px-4 space-y-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[10px] font-mono text-slate-400">{field.id}</span>
                        {(field.required || field.isRequired) && (
                          <span className="text-rose-500 font-bold">*</span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={field.displayName !== undefined ? field.displayName : field.defaultName}
                        onChange={(e) => handleUpdateLabel(field.id, e.target.value)}
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="PDF Display Label Name"
                        title="Manually enter PDF display label name"
                      />
                    </td>

                    {/* Column 2: Mapping Method & Source / Config */}
                    <td className="py-3 px-4 space-y-1.5">
                      <select
                        value={field.mappingMode || (currentColumn ? 'excel_column' : 'default')}
                        onChange={(e) => handleUpdateMappingMode(field.id, e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        <option value="excel_column">1. Select Excel Column</option>
                        <option value="auto_generate">2. Auto Generate</option>
                        <option value="manual">3. Manual Entry</option>
                        <option value="default">4. Use Default Value</option>
                        <option value="empty">5. Leave Empty</option>
                      </select>

                      {(!field.mappingMode || field.mappingMode === 'excel_column') && (
                        <select
                          value={currentColumn}
                          onChange={(e) => handleUpdateFieldMapping(field.id, e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 outline-none font-mono cursor-pointer"
                        >
                          <option value="">-- Choose Column --</option>
                          {headers.map((h, hIdx) => (
                            <option key={`${h}_${hIdx}`} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      )}

                      {field.mappingMode === 'manual' && (
                        <input
                          type="text"
                          value={field.manualValue !== undefined ? field.manualValue : (field.value || '')}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFields(prev => prev.map(f => f.id === field.id ? { ...f, manualValue: val, value: val } : f));
                          }}
                          className="w-full bg-white border border-indigo-300 rounded-lg px-2.5 py-1 text-xs text-slate-900 outline-none font-medium"
                          placeholder="Enter manual value..."
                        />
                      )}

                      {field.mappingMode === 'auto_generate' && (
                        <div className="bg-indigo-50/70 p-2 rounded-lg border border-indigo-200 text-[11px] space-y-1">
                          <span className="font-bold text-indigo-900 block">Auto-Generate Rule</span>
                          <input
                            type="text"
                            value={field.autoGenerateConfig?.template || field.autoGenerateConfig?.prefix || 'INV-2026-'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFields(prev => prev.map(f => f.id === field.id ? { ...f, autoGenerateConfig: { ...(f.autoGenerateConfig || {}), template: val, prefix: val } } : f));
                            }}
                            className="w-full bg-white border border-indigo-300 rounded px-2 py-0.5 font-mono text-xs"
                            placeholder="Prefix or template..."
                          />
                        </div>
                      )}

                      {field.mappingMode === 'default' && (
                        <p className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          Default: {String(field.defaultValue || '—')}
                        </p>
                      )}
                    </td>

                    {/* Column 3: Sample Value */}
                    <td className="py-3 px-4">
                      <span className="font-mono text-slate-600 truncate block max-w-xs" title={sampleVal}>
                        {sampleVal}
                      </span>
                    </td>

                    {/* Column 4: Show / Hide PDF Visibility Toggle */}
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleTogglePdfVisibility(field.id)}
                        className={`inline-flex items-center space-x-1 px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          field.pdfVisibility !== false
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                        }`}
                        title="Toggle visibility in generated PDF"
                      >
                        {field.pdfVisibility !== false ? (
                          <>
                            <Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                            <span>Show</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span>Hide</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Column 5: Status Badge */}
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </td>

                    {/* Column 6: Actions */}
                    <td className="py-3 px-4 text-right">
                      {field.isCustom ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteField(field.id)}
                          className="p-1.5 text-rose-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Delete custom field"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Data Source</span>
        </button>

        <button
          onClick={onContinue}
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold text-sm shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <span>Continue to Amount Calculations</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Save Template Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">Save Current Mapping as Template</h3>
            <p className="text-xs text-slate-500">
              Save this mapping configuration so you can instantly reapply it whenever you upload spreadsheets with similar column structures.
            </p>
            <form onSubmit={handleSaveTemplateSubmit} className="space-y-4">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Monthly Consulting Excel Template"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-sm"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
