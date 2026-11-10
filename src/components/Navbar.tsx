/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  FileText, 
  Layout, 
  Cpu, 
  History, 
  Building2, 
  DownloadCloud,
  CheckCircle2
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeDataSourceName: string;
  totalRecordsCount: number;
  onStartGuidedWorkflow?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  activeTab, 
  setActiveTab, 
  activeDataSourceName, 
  totalRecordsCount,
  onStartGuidedWorkflow
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: FileText },
    { id: 'datasource', label: 'Data', icon: DownloadCloud },
    { id: 'designer', label: 'Layout', icon: Layout },
    { id: 'generation', label: 'Generate', icon: Cpu },
    { id: 'history', label: 'History', icon: History },
    { id: 'company', label: 'Company', icon: Building2 },
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3 shrink-0 py-1">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-xl shadow-inner shrink-0">
              IS
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <span className="text-sm sm:text-base font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent truncate tracking-wide">
                INVOICE STUDIO
              </span>
              <span className="block text-[10px] text-slate-400 truncate mt-0.5">Advanced Invoice Generator</span>
            </div>
          </div>

          <div className="hidden lg:flex items-center space-x-1">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  data-tab={item.id}
                  onClick={() => setActiveTab(item.id)}
                  style={{ whiteSpace: 'nowrap' }}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center space-x-3">
            {onStartGuidedWorkflow && (
              <button
                onClick={onStartGuidedWorkflow}
                className="flex items-center space-x-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <span>Create Invoice</span>
              </button>
            )}

            <div className="hidden sm:flex items-center space-x-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="truncate max-w-[140px]" title={activeDataSourceName}>
                {activeDataSourceName}
              </span>
              <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded font-mono">
                {totalRecordsCount} recs
              </span>
            </div>
          </div>
        </div>

        {/* Mobile Submenu */}
        <div className="flex lg:hidden overflow-x-auto py-2 space-x-1 border-t border-slate-800 scrollbar-none">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{ whiteSpace: 'nowrap' }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
