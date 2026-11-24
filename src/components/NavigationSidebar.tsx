import React from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  Cpu,
  Home,
  LayoutGrid,
  Sliders,
  Wifi,
} from 'lucide-react';
import { COCKPIT_EASE, COCKPIT_SPRING, MorphPill } from './MotionPrimitives';
import { MainTabId } from '../types/telemetry';
import { useI18n } from '../i18n';

interface NavItem {
  id: MainTabId;
  label: string;
  icon: React.ReactNode;
}

interface NavigationSidebarProps {
  activeTab: MainTabId;
  onNavigate: (tab: MainTabId, subTab?: string) => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeTab,
  onNavigate,
}) => {
  const { t } = useI18n();

  const navItems: NavItem[] = [
    { id: 'inicio', label: t('nav.inicio'), icon: <Home className="h-[clamp(16px,1.4vw,19px)] w-[clamp(16px,1.4vw,19px)] shrink-0" /> },
    { id: 'equipo', label: t('nav.equipo'), icon: <Cpu className="h-[clamp(16px,1.4vw,19px)] w-[clamp(16px,1.4vw,19px)] shrink-0" /> },
    { id: 'programas', label: t('nav.programas'), icon: <LayoutGrid className="h-[clamp(16px,1.4vw,19px)] w-[clamp(16px,1.4vw,19px)] shrink-0" /> },
    { id: 'red', label: t('nav.red'), icon: <Wifi className="h-[clamp(16px,1.4vw,19px)] w-[clamp(16px,1.4vw,19px)] shrink-0" /> },
    { id: 'mas', label: t('nav.mas'), icon: <Sliders className="h-[clamp(16px,1.4vw,19px)] w-[clamp(16px,1.4vw,19px)] shrink-0" /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.06, ease: COCKPIT_EASE }}
      className="pointer-events-none fixed inset-x-0 bottom-[clamp(0.5rem,1.35dvh,1rem)] z-40 flex justify-center px-[clamp(0.5rem,1.5vw,1rem)]"
    >
      <LayoutGroup id="dock-nav">
        <nav
          aria-label={t('nav.bottom_aria')}
          className="cockpit-dock pointer-events-auto grid w-full max-w-[min(96vw,clamp(360px,46vw,620px))] grid-cols-5 items-stretch gap-0.5 sm:gap-1 p-[clamp(0.25rem,0.6vw,0.45rem)]"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                title={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                className={`relative flex min-h-[clamp(40px,5.8dvh,50px)] min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-[14px] px-0.5 sm:px-1.5 py-[clamp(0.2rem,0.5dvh,0.35rem)] transition-colors cursor-pointer ${
                  active
                    ? 'text-[#0f1f10] font-bold'
                    : 'text-slate-600 hover:text-[#0f1f10] dark:text-[#aebaa9] dark:hover:text-[#f5f4f2]'
                }`}
              >
                {active && <MorphPill layoutId="dock-active-pill" className="rounded-[14px]" />}
                <motion.span
                  animate={{ scale: active ? 1.06 : 1, y: active ? -1 : 0 }}
                  transition={COCKPIT_SPRING}
                  className="relative z-10 inline-flex shrink-0"
                >
                  {item.icon}
                </motion.span>
                <span className="relative z-10 w-full max-w-full text-center font-mono text-[clamp(8.5px,0.65vw+4px,10.5px)] font-semibold uppercase tracking-[0.04em] leading-[1.1] truncate">
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </nav>
      </LayoutGroup>
    </motion.div>
  );
};
