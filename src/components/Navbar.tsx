/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Cpu,
  DownloadCloud,
  FileCheck2,
  FilePlus2,
  History,
  Home,
  Layout,
  ListChecks,
  Loader2,
  Mail,
  Menu,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { DriveWorkspaceConnection } from '../types';
import type { DriveSyncState } from '../App';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeDataSourceName: string;
  totalRecordsCount: number;
  driveConnection: DriveWorkspaceConnection | null;
  driveSyncState?: DriveSyncState;
}

const PRIMARY_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'datasource', label: 'Import Data', icon: DownloadCloud },
  { id: 'manual', label: 'Manual Entry', icon: FilePlus2 },
  { id: 'quotations', label: 'Quotations', icon: FileCheck2 },
  { id: 'generation', label: 'Invoices', icon: Cpu },
  { id: 'email', label: 'Emailing', icon: Mail },
];

const SECONDARY_NAV_ITEMS = [
  {
    id: 'customers',
    label: 'Customers',
    description: 'Manage client contacts, billing addresses & GSTIN directory',
    icon: Users,
  },
  {
    id: 'integrations',
    label: 'Google Drive & Email',
    description: 'Connect Drive folder storage, Gmail SMTP & Custom SMTP',
    icon: Cloud,
  },
  {
    id: 'fields',
    label: 'Field Mapping',
    description: 'Configure spreadsheet columns, formulas & catalog fields',
    icon: SlidersHorizontal,
  },
  {
    id: 'workflow',
    label: 'Guided Workflow',
    description: 'Step-by-step Excel / Google Sheets invoice wizard',
    icon: ListChecks,
  },
  {
    id: 'company',
    label: 'Company Settings',
    description: 'Business profile, GSTIN, logo, signature & bank details',
    icon: Building2,
  },
  {
    id: 'designer',
    label: 'PDF Layout Designer',
    description: 'Customize Invoice & Quotation PDF sections & labels',
    icon: Layout,
  },
  {
    id: 'history',
    label: 'Invoice History',
    description: 'View, track payments, download & email generated invoices',
    icon: History,
  },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  activeDataSourceName,
  totalRecordsCount,
  driveConnection,
  driveSyncState = 'idle',
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const activeSecondaryItem = SECONDARY_NAV_ITEMS.find((item) => item.id === activeTab);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreOpen(false);
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId);
    setIsMoreOpen(false);
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2">
          {/* Brand Logo */}
          <button
            type="button"
            onClick={() => handleSelectTab('dashboard')}
            className="flex items-center space-x-2.5 shrink-0 py-1 text-left cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-lg shadow-inner shrink-0">
              IS
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <span className="text-sm sm:text-base font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent truncate tracking-wide">
                INVOICE STUDIO
              </span>
              <span className="hidden sm:block text-[10px] text-slate-400 truncate mt-0.5">
                Invoices & Quotations Suite
              </span>
            </div>
          </button>

          {/* Desktop Primary Navigation (6 tabs) + More Menu */}
          <nav
            aria-label="Main Navigation"
            className="hidden lg:flex items-center space-x-1 bg-slate-800/70 p-1.5 rounded-2xl border border-slate-800"
          >
            {PRIMARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-tab={item.id}
                  onClick={() => handleSelectTab(item.id)}
                  className={`flex items-center space-x-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}

            {/* More Dropdown */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                data-tab="more-menu"
                aria-expanded={isMoreOpen}
                aria-haspopup="menu"
                onClick={() => setIsMoreOpen((prev) => !prev)}
                className={`flex items-center space-x-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSecondaryItem
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : isMoreOpen
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Menu className="w-3.5 h-3.5 shrink-0" />
                <span>{activeSecondaryItem ? activeSecondaryItem.label : 'More'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                    isMoreOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isMoreOpen && (
                <div
                  role="menu"
                  aria-label="Secondary Navigation Tools"
                  className="absolute right-0 mt-2.5 w-72 bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 py-2 z-50"
                >
                  <div className="px-3.5 py-1.5 border-b border-slate-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Workspace & Settings
                    </p>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {SECONDARY_NAV_ITEMS.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          data-tab={item.id}
                          onClick={() => handleSelectTab(item.id)}
                          className={`w-full flex items-start space-x-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              isActive
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold leading-tight">{item.label}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                              {item.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </nav>

          {/* Right Workspace Storage Status + Mobile Menu Button (NO Sign-In) */}
          <div className="flex items-center space-x-2 shrink-0">
            {totalRecordsCount > 0 && (
              <div className="hidden 2xl:flex items-center space-x-1.5 bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700 text-xs text-slate-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate max-w-[110px] font-medium" title={activeDataSourceName}>
                  {activeDataSourceName || 'Imported Data'}
                </span>
                <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold">
                  {totalRecordsCount}
                </span>
              </div>
            )}

            <button
              type="button"
              data-tab="integrations"
              onClick={() => handleSelectTab('integrations')}
              title={
                driveConnection?.isConnected
                  ? `Connected to Google Drive folder: ${driveConnection.folderName}`
                  : 'Temporary workspace — click to connect a Google Drive folder for persistent storage'
              }
              className={`hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                driveConnection?.isConnected
                  ? driveSyncState === 'error'
                    ? 'bg-rose-950/60 border-rose-700/70 text-rose-200 hover:bg-rose-900/70'
                    : 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200 hover:bg-emerald-900/70'
                  : 'bg-amber-950/50 border-amber-700/60 text-amber-200 hover:bg-amber-900/60'
              }`}
            >
              {driveConnection?.isConnected ? (
                driveSyncState === 'syncing' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : driveSyncState === 'error' ? (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Cloud className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                )
              ) : (
                <CloudOff className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              )}
              <span className="max-w-[125px] truncate">
                {driveConnection?.isConnected ? driveConnection.folderName : 'Connect Drive'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="lg:hidden inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
            >
              {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              <span>Menu</span>
            </button>
          </div>
        </div>
      </div>

      {/* Responsive Mobile & Tablet Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-slate-900 border-t border-slate-800 px-4 py-4 space-y-4">
          <div className="space-y-1.5">
            <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Primary Workflows
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {PRIMARY_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-mobile-tab={item.id}
                    onClick={() => handleSelectTab(item.id)}
                    className={`flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-800">
            <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Settings & Tools
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SECONDARY_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-mobile-tab={item.id}
                    onClick={() => handleSelectTab(item.id)}
                    className={`flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 px-2">
            <span className="truncate">
              {driveConnection?.isConnected
                ? `Drive: ${driveConnection.folderName}`
                : 'Temporary Workspace (Not Backed Up)'}
            </span>
            <span className="font-mono text-indigo-300 font-bold">{totalRecordsCount} rows</span>
          </div>
        </div>
      )}
    </header>
  );
};
