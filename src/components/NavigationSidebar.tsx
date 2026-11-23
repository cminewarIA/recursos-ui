import React from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Home,
  LayoutGrid,
  Server,
  Sliders,
  Wifi,
} from 'lucide-react';
import { COCKPIT_SPRING, MorphPill } from './MotionPrimitives';
import { getCanonicalDisplayVersion } from '../utils/version';
import { MainTabId } from '../types/telemetry';
import { useI18n } from '../i18n';

interface NavItem {
  id: MainTabId;
  label: string;
  icon: React.ReactNode;
}

interface NavigationSidebarProps {
  activeTab: MainTabId;
  onNavigate: (tab: MainTabId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeTab,
  onNavigate,
  collapsed,
  onToggleCollapse,
}) => {
  const { t } = useI18n();

  const navItems: NavItem[] = [
    { id: 'inicio', label: t('nav.inicio'), icon: <Home className="h-5 w-5 shrink-0" /> },
    { id: 'equipo', label: t('nav.equipo'), icon: <Cpu className="h-5 w-5 shrink-0" /> },
    { id: 'programas', label: t('nav.programas'), icon: <LayoutGrid className="h-5 w-5 shrink-0" /> },
    { id: 'red', label: t('nav.red'), icon: <Wifi className="h-5 w-5 shrink-0" /> },
    { id: 'mas', label: t('nav.mas'), icon: <Sliders className="h-5 w-5 shrink-0" /> },
  ];

  return (
    <>
      {/* Desktop Left Sidebar (md+) */}
      <aside
        aria-label={t('nav.bottom_aria')}
        className={`cockpit-sidebar hidden md:flex flex-col justify-between fixed top-0 bottom-0 left-0 z-30 py-4 transition-all duration-200 select-none ${
          collapsed ? 'w-16 px-2' : 'w-56 px-3'
        }`}
      >
        {/* Top: Brand Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-2 min-h-[40px]">
            <div
              onClick={() => onNavigate('inicio')}
              className="flex items-center gap-2.5 cursor-pointer overflow-hidden"
              title={t('app.brand')}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0f1f10] text-[#c6f19d] dark:bg-[#c6f19d] dark:text-[#0f1f10] shadow-sm">
                <Server className="h-4 w-4" />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <span className="block font-display text-sm font-bold tracking-tight text-slate-900 dark:text-[#f5f4f2] truncate">
                    {t('app.brand')}
                  </span>
                  <span className="block font-mono text-[9.5px] uppercase tracking-[0.08em] text-[#1e6b38] dark:text-[#c6f19d] font-semibold">
                    Mission Control
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1.5 mt-2">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  title={item.label}
                  className={`cockpit-sidebar-btn relative ${
                    active
                      ? 'cockpit-sidebar-btn-active font-bold'
                      : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-[#c6f19d]'
                  } ${collapsed ? 'justify-center px-0' : 'justify-start'}`}
                >
                  <span className="inline-flex shrink-0">{item.icon}</span>
                  {!collapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom subtle indicator */}
        <div className="px-2 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
          {!collapsed ? (
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 dark:text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 cockpit-live-dot" />
                <span>ONLINE</span>
              </span>
              <span className="font-semibold text-slate-500 dark:text-slate-400">v{getCanonicalDisplayVersion()}</span>
            </div>
          ) : (
            <div className="flex justify-center" title={`v${getCanonicalDisplayVersion()} · Online`}>
              <span className="h-2 w-2 rounded-full bg-emerald-500 cockpit-live-dot" />
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Dock (< md) */}
      <div className="md:hidden pointer-events-none fixed inset-x-0 bottom-[clamp(0.45rem,1.25dvh,0.9rem)] z-40 flex justify-center px-2">
        <nav
          aria-label={t('nav.bottom_aria')}
          className="cockpit-dock pointer-events-auto grid w-full max-w-[min(96vw,500px)] grid-cols-5 items-stretch gap-1 p-1.5"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => onNavigate(item.id)}
                className={`relative flex min-h-[46px] min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-[12px] px-1 py-1 transition-colors cursor-pointer ${
                  active ? 'text-[#0f1f10] font-bold' : 'text-[#aebaa9] hover:text-[#f5f4f2]'
                }`}
              >
                {active && <MorphPill layoutId="mobile-dock-pill" className="rounded-[12px]" />}
                <motion.span
                  animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }}
                  transition={COCKPIT_SPRING}
                  className="relative z-10 inline-flex shrink-0"
                >
                  {item.icon}
                </motion.span>
                <span className="relative z-10 w-full max-w-full text-center font-mono text-[9px] font-semibold uppercase tracking-[0.04em] leading-[1.1] truncate">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
};
