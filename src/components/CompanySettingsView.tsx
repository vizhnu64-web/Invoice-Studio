/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { CompanySettings, BankAccount, BrandPalette, CurrencySettings } from '../types';
import { 
  Building2, 
  Palette, 
  Type, 
  Image as ImageIcon, 
  Landmark, 
  FileText, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  Save,
  Upload,
  RotateCcw,
  Sparkles,
  Download,
  Check,
  Star,
  Info,
  Coins,
  Search,
  AlertCircle
} from 'lucide-react';
import { defaultCompanySettings, defaultCurrencySettings, CURRENCY_CATALOG } from '../mockData';
import { formatCurrency, formatAmountInWords } from '../utils/calculator';

interface CompanySettingsViewProps {
  company: CompanySettings;
  setCompany: (settings: CompanySettings) => void;
}

// 5 Professionally designed starter palettes
const STARTER_PALETTES: { name: string; description: string; palette: Partial<BrandPalette> }[] = [
  {
    name: 'Modern Indigo (Default)',
    description: 'Corporate tech, clean modern branding with rich indigo highlights',
    palette: {
      primaryColor: '#4f46e5',
      secondaryColor: '#0ea5e9',
      accentColor: '#10b981',
      headingColor: '#1e293b',
      bodyTextColor: '#334155',
      mutedTextColor: '#64748b',
      tableHeaderBg: '#4f46e5',
      tableHeaderText: '#ffffff',
      tableBorderColor: '#e2e8f0',
      sectionBg: '#f8fafc',
      invoiceBg: '#ffffff',
      dividerColor: '#cbd5e1',
      totalHighlightColor: '#4f46e5',
      footerBg: '#f1f5f9',
      footerTextColor: '#64748b',
    }
  },
  {
    name: 'Emerald Executive',
    description: 'Wealth, sustainability, consulting, and prestigious enterprise feel',
    palette: {
      primaryColor: '#059669',
      secondaryColor: '#10b981',
      accentColor: '#d97706',
      headingColor: '#064e3b',
      bodyTextColor: '#1f2937',
      mutedTextColor: '#4b5563',
      tableHeaderBg: '#059669',
      tableHeaderText: '#ffffff',
      tableBorderColor: '#d1fae5',
      sectionBg: '#f0fdf4',
      invoiceBg: '#ffffff',
      dividerColor: '#a7f3d0',
      totalHighlightColor: '#059669',
      footerBg: '#ecfdf5',
      footerTextColor: '#065f46',
    }
  },
  {
    name: 'Midnight Navy',
    description: 'Traditional legal, accounting, finance, and investment banking style',
    palette: {
      primaryColor: '#1e3a8a',
      secondaryColor: '#3b82f6',
      accentColor: '#f59e0b',
      headingColor: '#0f172a',
      bodyTextColor: '#334155',
      mutedTextColor: '#64748b',
      tableHeaderBg: '#1e3a8a',
      tableHeaderText: '#ffffff',
      tableBorderColor: '#cbd5e1',
      sectionBg: '#f8fafc',
      invoiceBg: '#ffffff',
      dividerColor: '#94a3b8',
      totalHighlightColor: '#1e3a8a',
      footerBg: '#f1f5f9',
      footerTextColor: '#475569',
    }
  },
  {
    name: 'Crimson Corporate',
    description: 'Bold, decisive, retail, and manufacturing agency branding',
    palette: {
      primaryColor: '#be123c',
      secondaryColor: '#f43f5e',
      accentColor: '#e11d48',
      headingColor: '#881337',
      bodyTextColor: '#1c1917',
      mutedTextColor: '#78716c',
      tableHeaderBg: '#be123c',
      tableHeaderText: '#ffffff',
      tableBorderColor: '#fecdd3',
      sectionBg: '#fff1f2',
      invoiceBg: '#ffffff',
      dividerColor: '#fda4af',
      totalHighlightColor: '#be123c',
      footerBg: '#fff1f2',
      footerTextColor: '#9f1239',
    }
  },
  {
    name: 'Monochrome Slate',
    description: 'Minimalist Scandinavian monochrome typography and high legibility',
    palette: {
      primaryColor: '#18181b',
      secondaryColor: '#3f3f46',
      accentColor: '#71717a',
      headingColor: '#09090b',
      bodyTextColor: '#27272a',
      mutedTextColor: '#71717a',
      tableHeaderBg: '#18181b',
      tableHeaderText: '#ffffff',
      tableBorderColor: '#e4e4e7',
      sectionBg: '#fafafa',
      invoiceBg: '#ffffff',
      dividerColor: '#d4d4d8',
      totalHighlightColor: '#18181b',
      footerBg: '#f4f4f5',
      footerTextColor: '#52525b',
    }
  }
];

export const CompanySettingsView: React.FC<CompanySettingsViewProps> = ({
  company,
  setCompany,
}) => {
  const [activeTab, setActiveTab] = useState<'identity' | 'colors' | 'currency' | 'typography' | 'assets' | 'bank' | 'content'>('identity');
  const [currencySearch, setCurrencySearch] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  const handleCurrencyChange = (key: keyof CurrencySettings, value: any) => {
    setCompany({
      ...company,
      currency: {
        ...defaultCurrencySettings,
        ...(company.currency || {}),
        [key]: value
      }
    });
  };

  const handleSelectCurrencyCatalog = (item: typeof CURRENCY_CATALOG[0]) => {
    setCompany({
      ...company,
      currency: {
        code: item.code,
        symbol: item.symbol,
        placement: item.placement,
        decimalPlaces: item.decimalPlaces,
        thousandSeparator: item.thousandSeparator,
        decimalSeparator: item.decimalSeparator,
        grouping: item.grouping,
        showCode: company.currency?.showCode || false,
      }
    });
    setSuccessMsg(`Switched currency to ${item.name} (${item.symbol}).`);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleResetCurrency = () => {
    setCompany({
      ...company,
      currency: { ...defaultCurrencySettings }
    });
    setSuccessMsg('Reset currency configuration to Indian Rupee (INR ₹).');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleChange = (e: React.ChangeEvent<any>) => {
    const { name, value } = e.target;
    setCompany({ ...company, [name]: value });
  };

  const handlePaletteChange = (key: string, value: string) => {
    setCompany({
      ...company,
      brandPalette: {
        ...company.brandPalette,
        [key]: value
      }
    });
  };

  const handleApplyStarterPalette = (palette: Partial<BrandPalette>) => {
    setCompany({
      ...company,
      brandPalette: {
        ...company.brandPalette,
        ...palette
      }
    });
    setSuccessMsg('Applied starter color palette successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleTypographyChange = (key: string, value: any) => {
    setCompany({
      ...company,
      typography: {
        ...company.typography,
        [key]: value
      }
    });
  };

  const handleAssetChange = (key: string, value: any) => {
    setCompany({
      ...company,
      assets: {
        ...company.assets,
        [key]: value
      }
    });
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please upload a valid image file (PNG, JPG, or SVG).');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result as string;
      handleAssetChange('logoUrl', result);
      setSuccessMsg('Logo uploaded and applied to invoices.');
      setTimeout(() => setSuccessMsg(''), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleSignatureFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please upload a valid image file (PNG, JPG, or SVG).');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result as string;
      handleAssetChange('signatureUrl', result);
      setSuccessMsg('Authorized signature image uploaded.');
      setTimeout(() => setSuccessMsg(''), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleContentChange = (key: string, value: string) => {
    setCompany({
      ...company,
      content: {
        ...company.content,
        [key]: value
      }
    });
  };

  const handleAddBankAccount = () => {
    const newAcc: BankAccount = {
      id: 'acc_' + Math.random().toString(36).substr(2, 9),
      accountHolderName: company.legalName,
      bankAccountName: 'New Bank Account',
      accountNumber: '',
      ifscCode: '',
      bankName: '',
      branch: '',
      upiId: '',
      isDefault: company.bankAccounts.length === 0,
    };
    setCompany({
      ...company,
      bankAccounts: [...company.bankAccounts, newAcc]
    });
  };

  const handleDeleteBankAccount = (id: string) => {
    setCompany({
      ...company,
      bankAccounts: company.bankAccounts.filter(acc => acc.id !== id)
    });
  };

  const handleUpdateBankAccount = (id: string, key: string, value: any) => {
    setCompany({
      ...company,
      bankAccounts: company.bankAccounts.map(acc => acc.id === id ? { ...acc, [key]: value } : acc)
    });
  };

  const handleSetDefaultBank = (id: string) => {
    setCompany({
      ...company,
      activeBankId: id,
      bankAccounts: company.bankAccounts.map(acc => ({
        ...acc,
        isDefault: acc.id === id
      }))
    });
    setSuccessMsg('Active invoice bank account updated.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setCompany({ ...company });
    setSuccessMsg('Company settings & brand configuration saved permanently.');
    setTimeout(() => setSuccessMsg(''), 3500);
  };

  const handleResetToDefault = () => {
    if (confirm('Are you sure you want to reset all company settings and branding to defaults?')) {
      setCompany(defaultCompanySettings);
      setSuccessMsg('Reset all settings to default configuration.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  const tabs = [
    { id: 'identity', label: 'Company Identity', icon: Building2 },
    { id: 'colors', label: 'Brand & Colors', icon: Palette },
    { id: 'currency', label: 'Currency & Numbers', icon: Coins },
    { id: 'typography', label: 'Typography', icon: Type },
    { id: 'assets', label: 'Logo & Signature', icon: ImageIcon },
    { id: 'bank', label: 'Bank Accounts', icon: Landmark },
    { id: 'content', label: 'Invoice Content', icon: FileText },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header Card */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-slate-900">Company Settings & Brand Customization</h1>
            <span className="bg-emerald-50 text-emerald-700 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-emerald-200">
              Live Synchronized
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Configure business identity, logo, brand colors, typography, bank details, and notes synced live with all PDF outputs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {successMsg && (
            <span className="flex items-center space-x-1.5 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-xs font-semibold border border-emerald-200 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{successMsg}</span>
            </span>
          )}

          {errorMsg && (
            <span className="flex items-center space-x-1.5 bg-rose-50 text-rose-700 px-4 py-2 rounded-xl text-xs font-semibold border border-rose-200 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{errorMsg}</span>
            </span>
          )}

          <button
            type="button"
            onClick={handleResetToDefault}
            className="flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
            title="Reset to initial defaults"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={() => handleSave()}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-semibold transition-all shadow-sm shadow-indigo-600/30"
          >
            <Save className="w-4 h-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      {/* Subnavigation Tabs */}
      <div className="flex overflow-x-auto space-x-2 border-b border-slate-200 pb-2 scrollbar-none">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-6">
        {/* ========================================================= */}
        {/* TAB 1: COMPANY IDENTITY */}
        {/* ========================================================= */}
        {activeTab === 'identity' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                <span>Company Legal & Contact Identity</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                These details populate the company header, legal disclaimers, and tax compliance sections in your invoices.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Company Legal Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="legalName"
                  value={company.legalName}
                  onChange={handleChange}
                  placeholder="e.g. TBT VENTURES PRIVATE LIMITED"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company Display / Brand Name</label>
                <input
                  type="text"
                  name="displayName"
                  value={company.displayName}
                  onChange={handleChange}
                  placeholder="e.g. ThinkBeyondThink"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tagline / Mission</label>
                <input
                  type="text"
                  name="tagline"
                  value={company.tagline}
                  onChange={handleChange}
                  placeholder="e.g. Accelerating Enterprise Growth & Mentorship"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GSTIN <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="gstin"
                  value={company.gstin}
                  onChange={handleChange}
                  placeholder="e.g. 06AAACT1234F1Z5"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-mono uppercase"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">PAN Number</label>
                <input
                  type="text"
                  name="pan"
                  value={company.pan}
                  onChange={handleChange}
                  placeholder="e.g. AAACT1234F"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">CIN Number</label>
                <input
                  type="text"
                  name="cin"
                  value={company.cin}
                  onChange={handleChange}
                  placeholder="e.g. U74999HR2023PTC123456"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-mono uppercase"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Registered Address Line 1 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="addressLine1"
                  value={company.addressLine1}
                  onChange={handleChange}
                  placeholder="e.g. 3rd Floor, Tower B, Cyber City"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Address Line 2 (Optional)</label>
                <input
                  type="text"
                  name="addressLine2"
                  value={company.addressLine2}
                  onChange={handleChange}
                  placeholder="e.g. Sector 43"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Branch / Additional Address</label>
                <input
                  type="text"
                  name="branchAddress"
                  value={company.branchAddress}
                  onChange={handleChange}
                  placeholder="e.g. DLF Phase 4"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                <input
                  type="text"
                  name="city"
                  value={company.city}
                  onChange={handleChange}
                  placeholder="e.g. Gurugram"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">State & PIN Code</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    name="state"
                    value={company.state}
                    onChange={handleChange}
                    placeholder="e.g. Haryana"
                    className="border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    required
                  />
                  <input
                    type="text"
                    name="pinCode"
                    value={company.pinCode}
                    onChange={handleChange}
                    placeholder="e.g. 122002"
                    className="border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Official Billing Email</label>
                <input
                  type="email"
                  name="email"
                  value={company.email}
                  onChange={handleChange}
                  placeholder="billing@thinkbeyondthink.com"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Phone Number</label>
                <input
                  type="text"
                  name="phone"
                  value={company.phone}
                  onChange={handleChange}
                  placeholder="+91 98765 43210"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company Website</label>
                <input
                  type="url"
                  name="website"
                  value={company.website}
                  onChange={handleChange}
                  placeholder="https://thinkbeyondthink.com"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Support Email</label>
                <input
                  type="email"
                  name="supportEmail"
                  value={company.supportEmail}
                  onChange={handleChange}
                  placeholder="support@thinkbeyondthink.com"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: BRAND & COLORS */}
        {/* ========================================================= */}
        {activeTab === 'colors' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <Palette className="w-5 h-5 text-indigo-600" />
                <span>Brand Identity & Color Customization</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Changes apply instantly across headers, table headers, totals highlights, dividers, and footers.
              </p>
            </div>

            {/* Curated Starter Palettes */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  1-Click Professional Brand Palettes
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {STARTER_PALETTES.map(p => (
                  <div
                    key={p.name}
                    onClick={() => handleApplyStarterPalette(p.palette)}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 hover:border-indigo-500 hover:shadow-md cursor-pointer transition-all space-y-2 group"
                  >
                    <div className="flex items-center space-x-1.5">
                      <div 
                        className="w-4 h-4 rounded-full border border-slate-300 shadow-xs" 
                        style={{ backgroundColor: p.palette.primaryColor }} 
                      />
                      <div 
                        className="w-4 h-4 rounded-full border border-slate-300 shadow-xs" 
                        style={{ backgroundColor: p.palette.secondaryColor }} 
                      />
                      <div 
                        className="w-4 h-4 rounded-full border border-slate-300 shadow-xs" 
                        style={{ backgroundColor: p.palette.accentColor }} 
                      />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {p.name}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">
                        {p.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Individual Color Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[
                { key: 'primaryColor', label: 'Primary Brand Color', desc: 'Main accent, title and highlights' },
                { key: 'secondaryColor', label: 'Secondary Color', desc: 'Subheadings and badges' },
                { key: 'accentColor', label: 'Accent Color', desc: 'Callouts and status' },
                { key: 'headingColor', label: 'Heading Text Color', desc: 'Company name and section headers' },
                { key: 'bodyTextColor', label: 'Body Text Color', desc: 'Table body and descriptions' },
                { key: 'mutedTextColor', label: 'Muted Text Color', desc: 'Labels, dates, and place of supply' },
                { key: 'tableHeaderBg', label: 'Table Header Background', desc: 'Item table top banner' },
                { key: 'tableHeaderText', label: 'Table Header Text', desc: 'Text in table header columns' },
                { key: 'tableBorderColor', label: 'Table Border Color', desc: 'Grid lines inside table' },
                { key: 'dividerColor', label: 'Divider Line Color', desc: 'Horizontal separation lines' },
                { key: 'totalHighlightColor', label: 'Total Highlight Color', desc: 'Grand Total invoice amount' },
                { key: 'footerBg', label: 'Footer Background', desc: 'Bottom document margin area' },
              ].map(item => {
                const currentColor = (company.brandPalette as any)[item.key] || '#4f46e5';
                return (
                  <div key={item.key} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800">{item.label}</label>
                      <p className="text-[10px] text-slate-400">{item.desc}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => handlePaletteChange(item.key, e.target.value)}
                        className="w-9 h-9 rounded-lg border border-slate-300 cursor-pointer p-0.5 bg-white shadow-xs"
                      />
                      <input
                        type="text"
                        value={currentColor}
                        onChange={(e) => handlePaletteChange(item.key, e.target.value)}
                        className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono uppercase outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: TYPOGRAPHY */}
        {/* ========================================================= */}
        {activeTab === 'typography' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <Type className="w-5 h-5 text-indigo-600" />
                <span>Document Typography & Print Legibility</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select standard high-fidelity vector PDF fonts supported natively by PDF rendering engines.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Heading Font Family</label>
                <select
                  value={company.typography.headingFont}
                  onChange={(e) => handleTypographyChange('headingFont', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
                >
                  <option value="Noto Sans">Noto Sans (Unicode TrueType - Recommended)</option>
                  <option value="Helvetica">Helvetica (Standard Corporate Sans-Serif)</option>
                  <option value="Times-Roman">Times Roman (Traditional Formal Serif)</option>
                  <option value="Courier">Courier (Monospace Technical)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Body & Table Font Family</label>
                <select
                  value={company.typography.bodyFont}
                  onChange={(e) => handleTypographyChange('bodyFont', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
                >
                  <option value="Noto Sans">Noto Sans (Unicode TrueType - Recommended)</option>
                  <option value="Helvetica">Helvetica (High Legibility)</option>
                  <option value="Times-Roman">Times Roman (Serif)</option>
                  <option value="Courier">Courier (Monospace)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Base Font Size (pt)</label>
                <input
                  type="number"
                  min="8"
                  max="13"
                  value={company.typography.fontSize}
                  onChange={(e) => handleTypographyChange('fontSize', Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">Default 9 pt for standard A4 density</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Text Alignment</label>
                <select
                  value={company.typography.textAlign}
                  onChange={(e) => handleTypographyChange('textAlign', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="left">Left Aligned</option>
                  <option value="center">Center Aligned</option>
                  <option value="right">Right Aligned</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: ASSETS & SIGNATURES */}
        {/* ========================================================= */}
        {activeTab === 'assets' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-8">
            {/* LOGO SECTION */}
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <ImageIcon className="w-5 h-5 text-indigo-600" />
                <span>Company Logo Customization</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                {/* Logo Upload & Controls */}
                <div className="md:col-span-7 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Upload Logo File (PNG, JPG, SVG)</label>
                    <div className="flex items-center space-x-3">
                      <input 
                        type="file" 
                        ref={logoInputRef}
                        accept="image/png, image/jpeg, image/svg+xml"
                        onChange={handleLogoFileUpload}
                        className="hidden" 
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm"
                      >
                        <Upload className="w-4 h-4" />
                        <span>Choose File</span>
                      </button>
                      {company.assets.logoUrl && (
                        <button
                          type="button"
                          onClick={() => handleAssetChange('logoUrl', '')}
                          className="flex items-center space-x-1 text-rose-600 hover:text-rose-700 bg-rose-50 px-3 py-2 rounded-xl text-xs font-semibold"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove Logo</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Or Direct Image / Data URL</label>
                    <input
                      type="text"
                      value={company.assets.logoUrl}
                      onChange={(e) => handleAssetChange('logoUrl', e.target.value)}
                      placeholder="https://example.com/logo.png or data:image/png;base64,..."
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Width (mm)</label>
                      <input
                        type="number"
                        min="20"
                        max="60"
                        value={company.assets.logoWidth || 40}
                        onChange={(e) => handleAssetChange('logoWidth', Number(e.target.value))}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Max Height (mm)</label>
                      <input
                        type="number"
                        min="10"
                        max="30"
                        value={company.assets.logoHeight || 15}
                        onChange={(e) => handleAssetChange('logoHeight', Number(e.target.value))}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Alignment</label>
                      <select
                        value={company.assets.logoAlignment || 'left'}
                        onChange={(e) => handleAssetChange('logoAlignment', e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Logo Preview Card */}
                <div className="md:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[160px]">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Live Logo Preview</p>
                  {company.assets.logoUrl ? (
                    <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs max-w-full">
                      <img 
                        src={company.assets.logoUrl} 
                        alt="Company Logo Preview" 
                        style={{
                          width: `${company.assets.logoWidth || 40}mm`,
                          maxHeight: `${company.assets.logoHeight || 15}mm`
                        }}
                        className="object-contain" 
                      />
                    </div>
                  ) : (
                    <div className="text-center text-slate-400 text-xs py-4">
                      <ImageIcon className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                      <span>No logo uploaded yet</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <hr className="border-slate-200" />

            {/* AUTHORIZED SIGNATORY & SIGNATURE SECTION */}
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>Authorized Signatory & Signature Stamp</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-7 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Authorized Person Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        name="authorizedPerson"
                        value={company.authorizedPerson}
                        onChange={handleChange}
                        placeholder="e.g. Aarav Sharma"
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                      <input
                        type="text"
                        name="designation"
                        value={company.designation}
                        onChange={handleChange}
                        placeholder="e.g. Director / Partner"
                        className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Signature Heading</label>
                    <input
                      type="text"
                      name="signatureHeading"
                      value={company.signatureHeading}
                      onChange={handleChange}
                      placeholder={`For ${company.legalName}`}
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Upload Signature Graphic (PNG/JPG)</label>
                    <div className="flex items-center space-x-3">
                      <input 
                        type="file" 
                        ref={sigInputRef}
                        accept="image/png, image/jpeg"
                        onChange={handleSignatureFileUpload}
                        className="hidden" 
                      />
                      <button
                        type="button"
                        onClick={() => sigInputRef.current?.click()}
                        className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Signature</span>
                      </button>
                      {company.assets.signatureUrl && (
                        <button
                          type="button"
                          onClick={() => handleAssetChange('signatureUrl', '')}
                          className="flex items-center space-x-1 text-rose-600 hover:text-rose-700 bg-rose-50 px-3 py-2 rounded-xl text-xs font-semibold"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Signature Width (mm)</label>
                      <input
                        type="number"
                        min="20"
                        max="50"
                        value={company.assets.signatureWidth || 35}
                        onChange={(e) => handleAssetChange('signatureWidth', Number(e.target.value))}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Signature Height (mm)</label>
                      <input
                        type="number"
                        min="10"
                        max="25"
                        value={company.assets.signatureHeight || 15}
                        onChange={(e) => handleAssetChange('signatureHeight', Number(e.target.value))}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[160px]">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Signature Box Preview</p>
                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs text-right w-full">
                    <p className="font-bold text-slate-800 text-xs">{company.signatureHeading || `For ${company.legalName}`}</p>
                    {company.assets.signatureUrl ? (
                      <div className="my-2 flex justify-end">
                        <img 
                          src={company.assets.signatureUrl} 
                          alt="Signature Preview" 
                          style={{
                            width: `${company.assets.signatureWidth || 35}mm`,
                            maxHeight: `${company.assets.signatureHeight || 15}mm`
                          }}
                          className="object-contain" 
                        />
                      </div>
                    ) : (
                      <div className="h-10 flex items-center justify-end text-[10px] text-slate-400 italic">
                        (Signature space)
                      </div>
                    )}
                    <p className="font-medium text-slate-900 text-xs">{company.authorizedPerson || 'Authorized Signatory'}</p>
                    <p className="text-slate-500 text-[10px]">({company.designation || 'Director'})</p>
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-200" />

            {/* WATERMARK */}
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-900">Document Watermark</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="showWatermark"
                    checked={company.assets.showWatermark}
                    onChange={(e) => handleAssetChange('showWatermark', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded-md focus:ring-indigo-500"
                  />
                  <label htmlFor="showWatermark" className="text-xs font-semibold text-slate-800 cursor-pointer">
                    Enable Semi-Transparent Watermark Across Pages
                  </label>
                </div>

                {company.assets.showWatermark && (
                  <div>
                    <input
                      type="text"
                      value={company.assets.watermarkText}
                      onChange={(e) => handleAssetChange('watermarkText', e.target.value)}
                      placeholder="e.g. PAID, CONFIDENTIAL, ORIGINAL"
                      className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs uppercase font-mono outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 5: BANK ACCOUNTS */}
        {/* ========================================================= */}
        {activeTab === 'bank' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <Landmark className="w-5 h-5 text-indigo-600" />
                  <span>Company Bank Accounts & UPI</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select which bank account is marked active/default to be automatically printed on invoices.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddBankAccount}
                className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add Bank Account</span>
              </button>
            </div>

            <div className="space-y-4">
              {company.bankAccounts.map((acc, index) => {
                const isSelected = acc.id === company.activeBankId || acc.isDefault;
                return (
                  <div 
                    key={acc.id} 
                    className={`p-5 rounded-2xl border transition-all space-y-4 ${
                      isSelected 
                        ? 'bg-indigo-50/40 border-indigo-500 ring-1 ring-indigo-500' 
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                          {acc.bankAccountName || `Bank Account ${index + 1}`}
                        </span>
                        {isSelected ? (
                          <span className="flex items-center space-x-1 bg-indigo-600 text-white text-[10px] px-2.5 py-0.5 rounded-full font-semibold">
                            <Star className="w-3 h-3 fill-current" />
                            <span>Active On Invoices</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetDefaultBank(acc.id)}
                            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-200 px-2.5 py-0.5 rounded-full"
                          >
                            Set as Active
                          </button>
                        )}
                      </div>

                      {company.bankAccounts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBankAccount(acc.id)}
                          className="text-rose-600 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-50"
                          title="Delete Bank Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Account Label</label>
                        <input
                          type="text"
                          value={acc.bankAccountName}
                          onChange={(e) => handleUpdateBankAccount(acc.id, 'bankAccountName', e.target.value)}
                          placeholder="e.g. HDFC Current Account"
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Bank Name</label>
                        <input
                          type="text"
                          value={acc.bankName}
                          onChange={(e) => handleUpdateBankAccount(acc.id, 'bankName', e.target.value)}
                          placeholder="e.g. HDFC Bank"
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Branch</label>
                        <input
                          type="text"
                          value={acc.branch}
                          onChange={(e) => handleUpdateBankAccount(acc.id, 'branch', e.target.value)}
                          placeholder="e.g. Cyber City, Gurugram"
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Account Number</label>
                        <input
                          type="text"
                          value={acc.accountNumber}
                          onChange={(e) => handleUpdateBankAccount(acc.id, 'accountNumber', e.target.value)}
                          placeholder="e.g. 50200012345678"
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">IFSC Code</label>
                        <input
                          type="text"
                          value={acc.ifscCode}
                          onChange={(e) => handleUpdateBankAccount(acc.id, 'ifscCode', e.target.value)}
                          placeholder="e.g. HDFC0001234"
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none font-mono uppercase"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">UPI ID (Optional)</label>
                        <input
                          type="text"
                          value={acc.upiId}
                          onChange={(e) => handleUpdateBankAccount(acc.id, 'upiId', e.target.value)}
                          placeholder="e.g. business@hdfcbank"
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none font-mono"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 6: INVOICE CONTENT */}
        {/* ========================================================= */}
        {activeTab === 'content' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>Default Invoice Content, Notes & Terms</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure default text blocks that appear whenever an invoice does not have row-specific text.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Default Invoice Title</label>
                  <input
                    type="text"
                    value={company.content.invoiceTitle || 'TAX INVOICE'}
                    onChange={(e) => handleContentChange('invoiceTitle', e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Invoice Subtitle</label>
                  <input
                    type="text"
                    value={company.content.invoiceSubtitle || 'Original For Recipient'}
                    onChange={(e) => handleContentChange('invoiceSubtitle', e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Default Notes</label>
                <textarea
                  rows={3}
                  value={company.content.defaultNotes}
                  onChange={(e) => handleContentChange('defaultNotes', e.target.value)}
                  placeholder="Thank you for your business..."
                  className="w-full border border-slate-300 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Default Terms & Conditions</label>
                <textarea
                  rows={4}
                  value={company.content.defaultTerms}
                  onChange={(e) => handleContentChange('defaultTerms', e.target.value)}
                  placeholder="1. Goods once sold will not be taken back..."
                  className="w-full border border-slate-300 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Instructions</label>
                <input
                  type="text"
                  value={company.content.paymentInstructions || ''}
                  onChange={(e) => handleContentChange('paymentInstructions', e.target.value)}
                  placeholder="Please transfer via NEFT/RTGS or UPI to the bank account above."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Footer Message</label>
                <input
                  type="text"
                  value={company.content.footerMessage}
                  onChange={(e) => handleContentChange('footerMessage', e.target.value)}
                  placeholder="This is a computer generated invoice powered by Invoice Studio."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 7: CURRENCY & NUMBER FORMATTING */}
        {/* ========================================================= */}
        {activeTab === 'currency' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <Coins className="w-5 h-5 text-indigo-600" />
                  <span>Currency & Number Formatting</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Customize the currency symbol, code, digit grouping, decimal places, and separators applied across all invoices.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetCurrency}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>Reset to INR (₹)</span>
              </button>
            </div>

            {/* Live Number Formatting Preview Card */}
            <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white rounded-2xl p-5 shadow-sm border border-indigo-800">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Live Formatting Preview</span>
                </span>
                <span className="text-[11px] bg-indigo-800/80 text-indigo-200 px-2.5 py-0.5 rounded-full font-mono">
                  {company.currency?.code || 'INR'} · {company.currency?.symbol || '₹'} · {company.currency?.grouping || 'indian'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2">
                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-indigo-200 uppercase tracking-wider">Unit Rate</div>
                  <div className="text-sm font-semibold text-white mt-1 truncate">
                    {formatCurrency(1250.5, company.currency)}
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-indigo-200 uppercase tracking-wider">Subtotal</div>
                  <div className="text-sm font-semibold text-white mt-1 truncate">
                    {formatCurrency(50000, company.currency)}
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-indigo-200 uppercase tracking-wider">Tax (18%)</div>
                  <div className="text-sm font-semibold text-emerald-300 mt-1 truncate">
                    {formatCurrency(9000, company.currency)}
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-indigo-200 uppercase tracking-wider">Grand Total</div>
                  <div className="text-base font-bold text-amber-300 mt-0.5 truncate">
                    {formatCurrency(59000, company.currency)}
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-indigo-200 uppercase tracking-wider">Large Amount</div>
                  <div className="text-sm font-semibold text-white mt-1 truncate">
                    {formatCurrency(1250000, company.currency)}
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-indigo-200 uppercase tracking-wider">Discount / Credit</div>
                  <div className="text-sm font-semibold text-rose-300 mt-1 truncate">
                    {formatCurrency(-500, company.currency)}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-indigo-200 gap-2">
                <div>
                  <span className="text-indigo-400 font-medium">In Words (for {formatCurrency(59000, company.currency)}):</span>{' '}
                  <span className="italic text-white font-medium">{formatAmountInWords(59000, company.currency)}</span>
                </div>
              </div>
            </div>

            {/* Quick Pick Popular Currencies */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Popular Currencies (Quick Select)
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
                  { code: 'USD', name: 'US Dollar', symbol: '$' },
                  { code: 'EUR', name: 'Euro', symbol: '€' },
                  { code: 'GBP', name: 'British Pound', symbol: '£' },
                  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
                  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س' },
                  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
                  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
                  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
                  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
                ].map((item) => {
                  const isCurrent = (company.currency?.code || 'INR') === item.code;
                  const catItem = CURRENCY_CATALOG.find(c => c.code === item.code);
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => catItem && handleSelectCurrencyCatalog(catItem)}
                      className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        isCurrent
                          ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600 ring-offset-1'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      <span className="font-bold">{item.symbol}</span>
                      <span>{item.code}</span>
                      <span className="text-[10px] opacity-75 hidden sm:inline">({item.name})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detailed Formatting Configuration Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              {/* Currency Code */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Currency Code
                </label>
                <input
                  type="text"
                  value={company.currency?.code || 'INR'}
                  onChange={(e) => handleCurrencyChange('code', e.target.value.toUpperCase())}
                  placeholder="e.g. INR, USD, EUR"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold uppercase outline-none focus:ring-2 focus:ring-indigo-600"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">ISO 4217 standard 3-letter code</span>
              </div>

              {/* Currency Symbol */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Display Symbol
                </label>
                <input
                  type="text"
                  value={company.currency?.symbol ?? '₹'}
                  onChange={(e) => handleCurrencyChange('symbol', e.target.value)}
                  placeholder="e.g. ₹, $, €, £, د.إ"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-600"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Rendered in table and summaries</span>
              </div>

              {/* Placement */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Symbol Placement
                </label>
                <select
                  value={company.currency?.placement || 'before'}
                  onChange={(e) => handleCurrencyChange('placement', e.target.value as 'before' | 'after')}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="before">Before Amount (e.g. {company.currency?.symbol || '₹'} 50,000.00)</option>
                  <option value="after">After Amount (e.g. 50,000.00 {company.currency?.symbol || '₹'})</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Prefix or suffix to numbers</span>
              </div>

              {/* Decimal Places */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Decimal Places
                </label>
                <select
                  value={company.currency?.decimalPlaces ?? 2}
                  onChange={(e) => handleCurrencyChange('decimalPlaces', parseInt(e.target.value, 10))}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value={0}>0 decimals (e.g. JPY, rounded)</option>
                  <option value={2}>2 decimals (Standard, e.g. .00)</option>
                  <option value={3}>3 decimals (e.g. KWD, OMR, BHD)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Precision for fractional units</span>
              </div>

              {/* Grouping / Numbering System */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Numbering System
                </label>
                <select
                  value={company.currency?.grouping || 'indian'}
                  onChange={(e) => handleCurrencyChange('grouping', e.target.value as 'indian' | 'international')}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="indian">Indian (1,23,456.78 - Lakhs/Crores)</option>
                  <option value="international">International (123,456.78 - Millions)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Digit grouping convention</span>
              </div>

              {/* Thousand Separator */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Thousand Separator
                </label>
                <select
                  value={company.currency?.thousandSeparator || ','}
                  onChange={(e) => handleCurrencyChange('thousandSeparator', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                >
                  <option value=",">, (Comma - 50,000)</option>
                  <option value=".">. (Dot - 50.000)</option>
                  <option value=" ">[Space] (50 000)</option>
                  <option value="'">' (Apostrophe - 50'000)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Delimits thousands & multiples</span>
              </div>

              {/* Decimal Separator */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Decimal Separator
                </label>
                <select
                  value={company.currency?.decimalSeparator || '.'}
                  onChange={(e) => handleCurrencyChange('decimalSeparator', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                >
                  <option value=".">. (Dot - 50.00)</option>
                  <option value=",">, (Comma - 50,00)</option>
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">Separates whole from decimals</span>
              </div>

              {/* Show Code Toggle */}
              <div className="flex flex-col justify-center">
                <label className="flex items-center space-x-2 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={company.currency?.showCode || false}
                    onChange={(e) => handleCurrencyChange('showCode', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-semibold text-slate-700">Display Currency Code</span>
                </label>
                <span className="text-[10px] text-slate-400 mt-1">
                  e.g. {company.currency?.code || 'INR'} {company.currency?.symbol || '₹'} 50,000.00
                </span>
              </div>
            </div>

            {/* Searchable Full Catalog */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Full International Currency Catalog ({CURRENCY_CATALOG.length} currencies)
                </label>
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    placeholder="Search by code, country, or name..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs outline-none focus:bg-white focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-72 overflow-y-auto p-1">
                {CURRENCY_CATALOG.filter((c) => {
                  if (!currencySearch.trim()) return true;
                  const q = currencySearch.toLowerCase();
                  const name = c.name || c.currencyName || '';
                  const code = c.code || c.currencyCode || '';
                  const country = c.country || '';
                  const symbol = c.symbol || '';
                  return (
                    name.toLowerCase().includes(q) ||
                    code.toLowerCase().includes(q) ||
                    country.toLowerCase().includes(q) ||
                    symbol.toLowerCase().includes(q)
                  );
                }).map((c) => {
                  const itemCode = c.code || c.currencyCode || 'INR';
                  const isCurrent = (company.currency?.code || company.currency?.currencyCode || 'INR') === itemCode;
                  return (
                    <div
                      key={itemCode}
                      onClick={() => handleSelectCurrencyCatalog(c)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        isCurrent
                          ? 'bg-indigo-50/70 border-indigo-400 ring-1 ring-indigo-400'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-xs text-slate-900">{c.code}</span>
                          <span className="text-[11px] text-slate-500 truncate">({c.country})</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{c.name}</div>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 text-xs">
                          {c.symbol}
                        </span>
                        {isCurrent && <Check className="w-4 h-4 text-indigo-600" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Non-destructive guarantee notice */}
            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 flex items-start space-x-2.5 text-xs text-amber-800">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Calculation Integrity:</span> Changing currency settings updates the visual symbols, decimal presentation, and text in invoice documents without converting or altering your underlying quantities, item rates, or financial totals.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
