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
import { useThemeCatalog } from '../themes';

interface NavItem {
  id: MainTabId;
  code: string;
  label: string;
  icon: React.ReactNode;
}

interface NavigationSidebarProps {
  activeTab: MainTabId;
  onNavigate: (tab: MainTabId, subTab?: string) => void;
  /** 'top-inline' renders inside the top header shell for top-bar / top-tabs desktop themes. */
  placement?: 'floating' | 'top-inline';
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeTab,
  onNavigate,
  placement = 'floating',
}) => {
  const { t } = useI18n();
  const { activeTheme } = useThemeCatalog();
  const navPosition = activeTheme.layout?.navPosition || 'bottom-dock';
  const surfaceShape = activeTheme.layout?.surfaceShape || 'rounded';

  const navItems: NavItem[] = [
    { id: 'inicio', code: '01', label: t('nav.inicio'), icon: <Home className="h-[clamp(16px,1.35vw,19px)] w-[clamp(16px,1.35vw,19px)] shrink-0" /> },
    { id: 'equipo', code: '02', label: t('nav.equipo'), icon: <Cpu className="h-[clamp(16px,1.35vw,19px)] w-[clamp(16px,1.35vw,19px)] shrink-0" /> },
    { id: 'programas', code: '03', label: t('nav.programas'), icon: <LayoutGrid className="h-[clamp(16px,1.35vw,19px)] w-[clamp(16px,1.35vw,19px)] shrink-0" /> },
    { id: 'red', code: '04', label: t('nav.red'), icon: <Wifi className="h-[clamp(16px,1.35vw,19px)] w-[clamp(16px,1.35vw,19px)] shrink-0" /> },
    { id: 'mas', code: '05', label: t('nav.mas'), icon: <Sliders className="h-[clamp(16px,1.35vw,19px)] w-[clamp(16px,1.35vw,19px)] shrink-0" /> },
  ];

  const isTopDesktopMode = navPosition === 'top-bar' || navPosition === 'top-tabs';
  const isSideDesktopMode =
    navPosition === 'left-hud' || navPosition === 'left-sidebar' || navPosition === 'right-rail';
  const isCornerDesktopMode = navPosition === 'corner-dock';

  const pillRadiusClass =
    surfaceShape === 'sharp' || surfaceShape === 'beveled' ? 'rounded-[2px]' : 'rounded-[14px]';

  // --------------------------------------------------------------------------
  // 1. TOP-INLINE DESKTOP BAR (GTA III, GTA IV -> top-bar | GTA V -> top-tabs)
  // --------------------------------------------------------------------------
  if (placement === 'top-inline') {
    if (!isTopDesktopMode) return null;

    if (navPosition === 'top-tabs') {
      // GTA V Pause-Menu Wide Top Tab Strip with Sky-Blue Top Accent Bar
      return (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: COCKPIT_EASE }}
          className="hidden md:block mt-2"
        >
          <LayoutGroup id="top-tabs-nav">
            <nav
              aria-label={t('nav.bottom_aria')}
              className="cockpit-topbar grid grid-cols-5 overflow-hidden p-0"
            >
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                    className={`relative flex min-h-[44px] items-center justify-center gap-2 border-r border-white/10 last:border-r-0 px-3 py-2.5 font-display text-xs font-bold uppercase tracking-[0.12em] transition-colors cursor-pointer ${
                      active
                        ? 'bg-white/12 text-white'
                        : 'text-[var(--text-secondary)] hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="gtav-top-tab-rule"
                        transition={COCKPIT_SPRING}
                        className="absolute inset-x-0 top-0 h-[3px] bg-[var(--accent)]"
                      />
                    )}
                    <span className={active ? 'text-[var(--accent)]' : 'opacity-75'}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </LayoutGroup>
        </motion.div>
      );
    }

    // GTA III / GTA IV Compact Horizontal Top Bar
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: COCKPIT_EASE }}
        className="hidden md:block mt-2"
      >
        <LayoutGroup id="top-bar-nav">
          <nav
            aria-label={t('nav.bottom_aria')}
            className="cockpit-topbar flex items-center justify-between gap-1.5 px-2 py-1.5"
          >
            <div className="grid w-full grid-cols-5 gap-1">
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                    className={`relative flex min-h-[38px] items-center justify-center gap-2 ${pillRadiusClass} px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.09em] transition-colors cursor-pointer ${
                      active
                        ? 'text-[#090c12]'
                        : 'text-[var(--text-secondary)] hover:bg-white/8 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {active && <MorphPill layoutId="top-bar-active-pill" className={pillRadiusClass} />}
                    <span className="relative z-10 inline-flex shrink-0">{item.icon}</span>
                    <span className="relative z-10 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </LayoutGroup>
      </motion.div>
    );
  }

  // --------------------------------------------------------------------------
  // 2. FLOATING LAYER: DESKTOP SIDE RAILS / CORNER DOCK / BOTTOM DOCK + MOBILE DOCK
  // --------------------------------------------------------------------------
  const renderMobileBottomDock = (hideOnDesktop: boolean) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05, ease: COCKPIT_EASE }}
      className={`pointer-events-none fixed inset-x-0 bottom-[clamp(0.5rem,1.35dvh,1rem)] z-40 px-[clamp(0.5rem,1.5vw,1rem)] ${
        hideOnDesktop ? 'flex md:hidden justify-center' : 'flex justify-center'
      }`}
    >
      <LayoutGroup id={hideOnDesktop ? 'mobile-dock-nav' : 'dock-nav'}>
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
                className={`relative flex min-h-[clamp(40px,5.8dvh,50px)] min-w-0 w-full flex-col items-center justify-center gap-0.5 ${pillRadiusClass} px-0.5 sm:px-1.5 py-[clamp(0.2rem,0.5dvh,0.35rem)] transition-colors cursor-pointer ${
                  active
                    ? 'font-bold text-[#0f1f10]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {active && (
                  <MorphPill
                    layoutId={hideOnDesktop ? 'mobile-dock-active-pill' : 'dock-active-pill'}
                    className={pillRadiusClass}
                  />
                )}
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

  // Desktop Left HUD (Cyberpunk 2077) / Left Pause Sidebar (GTA San Andreas) / Right Neon Rail (GTA Vice City)
  if (isSideDesktopMode) {
    const isRight = navPosition === 'right-rail';
    const isCyber = navPosition === 'left-hud';
    const sidePosClass = isRight ? 'right-3' : 'left-3';
    const widthClass = isRight
      ? 'w-[clamp(168px,14vw,202px)]'
      : 'w-[clamp(174px,14.5vw,210px)]';

    return (
      <>
        <motion.aside
          key={navPosition}
          initial={{ opacity: 0, x: isRight ? 24 : -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: COCKPIT_EASE }}
          aria-label={t('nav.bottom_aria')}
          className={`hidden md:flex fixed ${sidePosClass} top-4 bottom-4 z-40 ${widthClass} flex-col`}
        >
          <LayoutGroup id={`side-nav-${navPosition}`}>
            <nav className="cockpit-dock flex h-full w-full flex-col justify-between p-3">
              <div className="space-y-1.5">
                <div className="mb-3 flex items-center justify-between border-b border-[var(--border-hairline)] pb-2.5 px-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)] truncate">
                    {isCyber ? 'NETRUNNER // HUD' : isRight ? 'VICE // MENU' : 'PAUSE // MENU'}
                  </span>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)] cockpit-live-dot" />
                </div>

                {navItems.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => onNavigate(item.id)}
                      className={`relative flex min-h-[46px] w-full items-center gap-2.5 ${pillRadiusClass} px-3 py-2 text-left transition-colors cursor-pointer ${
                        active
                          ? 'font-bold text-[#090c12]'
                          : 'text-[var(--text-secondary)] hover:bg-white/8 hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {active && (
                        <MorphPill layoutId={`side-pill-${navPosition}`} className={pillRadiusClass} />
                      )}
                      {isCyber && (
                        <span
                          className={`relative z-10 font-mono text-[10px] font-bold tracking-widest ${
                            active ? 'text-[#090c12]/80' : 'text-[var(--hud-accent-2,var(--accent))] opacity-80'
                          }`}
                        >
                          {item.code}
                        </span>
                      )}
                      <span className="relative z-10 inline-flex shrink-0">{item.icon}</span>
                      <span className="relative z-10 truncate font-display text-xs font-bold uppercase tracking-[0.08em]">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[var(--border-hairline)] pt-2.5 px-1">
                <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  {activeTheme.id.replace(/-/g, ' ')}
                </span>
              </div>
            </nav>
          </LayoutGroup>
        </motion.aside>
        {renderMobileBottomDock(true)}
      </>
    );
  }

  // Desktop Bottom-Left Corner Dock (GTA VI · Leonida Vice)
  if (isCornerDesktopMode) {
    return (
      <>
        <motion.div
          key="corner-dock"
          initial={{ opacity: 0, y: 20, x: -16 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          transition={{ duration: 0.32, ease: COCKPIT_EASE }}
          className="hidden md:flex fixed left-4 bottom-4 z-40"
        >
          <LayoutGroup id="corner-dock-nav">
            <nav
              aria-label={t('nav.bottom_aria')}
              className="cockpit-dock flex items-center gap-1 p-1.5"
            >
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                    className={`relative flex min-h-[42px] items-center gap-2 rounded-[14px] px-3 py-1.5 transition-colors cursor-pointer ${
                      active
                        ? 'font-bold text-[#090c12]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {active && <MorphPill layoutId="corner-dock-pill" className="rounded-[14px]" />}
                    <span className="relative z-10 inline-flex shrink-0">{item.icon}</span>
                    <span className="relative z-10 font-mono text-[10.5px] font-bold uppercase tracking-[0.06em] whitespace-nowrap">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </LayoutGroup>
        </motion.div>
        {renderMobileBottomDock(true)}
      </>
    );
  }

  // Top-bar / top-tabs themes still render mobile bottom dock on < 768px
  if (isTopDesktopMode) {
    return renderMobileBottomDock(true);
  }

  // Default: centered bottom dock (Alethia Matrix, Navidad)
  return renderMobileBottomDock(false);
};
