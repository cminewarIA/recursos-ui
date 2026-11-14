import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'motion/react';
import {
  Activity,
  Cpu,
  Grid,
  Home,
  Moon,
  MoreHorizontal,
  Sun,
  Wifi,
} from 'lucide-react';
import { COCKPIT_EASE, COCKPIT_SPRING, MorphPill, ViewStage } from './components/MotionPrimitives';
import { OverviewView, ExpandChartSpec } from './components/OverviewView';
import { EquipmentView } from './components/EquipmentView';
import { NetworkSecurityView } from './components/NetworkSecurityView';
import { AppsMediaView } from './components/AppsMediaView';
import { MoreView } from './components/MoreView';
import { ExpandedChartModal } from './components/ExpandedChartModal';
import { MainTabId, MetricsPayload, ThemeMode, WifiClient } from './types/telemetry';
import { apiFetchJson, detectNativeEnvironment, setStoredToken } from './utils/api';
import { extractInitialSubTabFromRoute, getDisplayVersionString, normalizeExternalRoute } from './utils/formatters';

interface ToastState {
  id: number;
  message: string;
  isError: boolean;
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('recursos_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [activeTab, setActiveTab] = useState<MainTabId>(() => {
    if (typeof window !== 'undefined') {
      const qView = new URLSearchParams(window.location.search).get('view');
      return normalizeExternalRoute(qView || window.location.pathname);
    }
    return 'inicio';
  });
  const [subTabHint, setSubTabHint] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') {
      const qView = new URLSearchParams(window.location.search).get('view');
      return extractInitialSubTabFromRoute(qView || window.location.pathname);
    }
    return undefined;
  });
  const [navTick, setNavTick] = useState(0);

  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);

  const [expandedChart, setExpandedChart] = useState<ExpandChartSpec | null>(null);
  const [pendingMac, setPendingMac] = useState<string | null>(null);
  const [pendingServiceTarget, setPendingServiceTarget] = useState<string | null>(null);
  const [confirmShutdownClient, setConfirmShutdownClient] = useState<WifiClient | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, isError = false) => {
    const id = Date.now();
    setToast({ id, message, isError });
    setTimeout(() => {
      setToast((cur) => (cur?.id === id ? null : cur));
    }, 3600);
  }, []);

  // Sync theme with DOM & localStorage
  const applyTheme = useCallback((next: ThemeMode) => {
    setTheme(next);
    try {
      localStorage.setItem('recursos_theme', next);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
      if (next === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [applyTheme, theme]);

  // Fetch telemetry
  const fetchMetrics = useCallback(async () => {
    const res = await apiFetchJson<MetricsPayload>('/api/metrics');
    setLoading(false);
    if (res.ok && res.data) {
      setMetrics(res.data);
      setConnError(null);
      if (res.data.auth_status?.token) {
        setStoredToken(res.data.auth_status.token);
      }
    } else if (res.status === 403) {
      setConnError('Este dispositivo requiere verificación inicial en la red Wi-Fi local.');
    } else {
      setConnError('Reconectando con el servidor...');
    }
  }, []);

  useEffect(() => {
    const isPaused = () =>
      (typeof document !== 'undefined' && document.hidden) ||
      Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__);

    const syncDomPauseAttr = () => {
      if (typeof document !== 'undefined') {
        if (isPaused()) {
          document.documentElement.setAttribute('data-paused', 'true');
        } else {
          document.documentElement.removeAttribute('data-paused');
        }
      }
    };

    syncDomPauseAttr();
    if (!isPaused()) {
      void fetchMetrics();
    }

    const timer = setInterval(() => {
      if (!isPaused()) {
        void fetchMetrics();
      }
    }, 1500);

    const onVisibilityOrPause = () => {
      syncDomPauseAttr();
      if (!isPaused()) {
        void fetchMetrics();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityOrPause);
    window.addEventListener('recursos-visibility', onVisibilityOrPause);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityOrPause);
      window.removeEventListener('recursos-visibility', onVisibilityOrPause);
    };
  }, [fetchMetrics]);

  // Native bridge helpers (Ubuntu WebKit2 / Android WebView)
  useEffect(() => {
    window.switchView = (viewName: string) => {
      const normalized = normalizeExternalRoute(viewName);
      setActiveTab(normalized);
      const raw = (viewName || '').toLowerCase();
      let sub = extractInitialSubTabFromRoute(viewName);
      if (!sub) {
        if (raw.includes('dex')) sub = 'dex';
        else if (raw.includes('version') || raw.includes('sistema')) sub = 'updates';
        else if (raw.includes('cpu') || raw.includes('procesador')) sub = 'cpu';
        else if (raw.includes('ram') || raw.includes('memoria')) sub = 'ram';
        else if (raw.includes('gpu') || raw.includes('grafica')) sub = 'gpu';
        else if (raw.includes('almacenamiento')) sub = 'storage';
        else if (raw.includes('procesos')) sub = 'processes';
        else if (raw.includes('seguridad')) sub = 'security';
        else if (raw.includes('dns') || raw.includes('duckdns')) sub = 'dns';
        else if (raw.includes('multimedia') || raw.includes('descargas')) sub = 'media';
      }
      setSubTabHint(sub);
      setNavTick((t) => t + 1);
    };

    window.injectNativeSession = (token: string, telemetry?: Record<string, unknown>) => {
      if (token) setStoredToken(token);
      if (telemetry) {
        window.__RECURSOS_DEVICE_TELEMETRY__ = telemetry;
        void apiFetchJson('/api/auth/register-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_telemetry: telemetry }),
        });
      }
      if (detectNativeEnvironment().isAndroidTv) {
        document.documentElement.setAttribute('data-tv', 'true');
      }
      void fetchMetrics();
    };
  }, [fetchMetrics]);

  // Android TV / D-Pad smooth scroll-to-focus helper & attribute sync
  useEffect(() => {
    const syncTvAttr = () => {
      if (detectNativeEnvironment().isAndroidTv) {
        document.documentElement.setAttribute('data-tv', 'true');
      }
    };
    syncTvAttr();
    const handleFocusIn = (ev: FocusEvent) => {
      if (document.documentElement.getAttribute('data-tv') !== 'true') return;
      const target = ev.target as HTMLElement | null;
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    };
    document.addEventListener('focusin', handleFocusIn, { passive: true });
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  // Register current browser/native session periodically on first mount
  useEffect(() => {
    const env = detectNativeEnvironment();
    if (env.isAndroidTv) {
      document.documentElement.setAttribute('data-tv', 'true');
    }
    const payload: Record<string, unknown> = {
      ...(window.__RECURSOS_DEVICE_TELEMETRY__ || {}),
      client_type: env.isUbuntuNative
        ? 'ubuntu_native'
        : env.isAndroidNative
          ? 'android_native'
          : 'web_browser',
      full_access: env.isNativeApp,
      app_version: window.__INITIAL_APP_VERSION__ || '12.7.0',
      screen_width: window.screen?.width,
      screen_height: window.screen?.height,
    };
    void apiFetchJson('/api/auth/register-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_telemetry: payload }),
    });
  }, []);

  const navigateTo = useCallback((tab: MainTabId, sub?: string) => {
    setActiveTab(tab);
    setSubTabHint(sub);
    setNavTick((t) => t + 1);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const targetPath = tab === 'inicio' ? '/' : `/${tab}`;
      if (window.location.pathname !== targetPath) {
        window.history.replaceState(null, '', targetPath);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const executePowerAction = useCallback(
    async (action: 'wake' | 'shutdown', client: WifiClient) => {
      const macKey = client.mac || client.ip || 'dev';
      setPendingMac(macKey);
      const endpoint = action === 'wake' ? '/api/wol/wake' : '/api/wol/shutdown';
      const res = await apiFetchJson<{ success?: boolean; message?: string; error?: string }>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mac: client.mac || '',
          ip: client.ip || '',
          name: client.name || client.hostname || client.ip || 'dispositivo',
        }),
      });
      setPendingMac(null);
      if (res.ok && res.data?.success !== false) {
        notify(
          res.data?.message ||
            (action === 'wake' ? 'Señal de encendido enviada.' : 'Señal de apagado enviada.')
        );
      } else {
        notify(res.data?.error || res.error || 'No se pudo enviar la señal al dispositivo.', true);
      }
    },
    [notify]
  );

  const handlePowerClick = useCallback(
    (action: 'wake' | 'shutdown', client: WifiClient) => {
      if (action === 'shutdown') {
        setConfirmShutdownClient(client);
        return;
      }
      void executePowerAction('wake', client);
    },
    [executePowerAction]
  );

  const handleServiceAction = useCallback(
    async (type: 'docker' | 'systemd', target: string, action: 'start' | 'restart' | 'stop') => {
      setPendingServiceTarget(target);
      const res = await apiFetchJson<{ message?: string; error?: string }>('/api/service/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, target, action }),
      });
      setPendingServiceTarget(null);
      if (res.ok) {
        notify(res.data?.message || 'Orden enviada al servidor.');
        setTimeout(() => void fetchMetrics(), 900);
      } else {
        notify(res.data?.error || res.error || 'No se pudo completar la acción.', true);
      }
    },
    [fetchMetrics, notify]
  );

  const displayVersion = getDisplayVersionString(
    metrics?.version_info?.current_version || window.__INITIAL_APP_VERSION__,
    metrics?.version_info?.display_version || window.__INITIAL_DISPLAY_VERSION__
  );
  const topbarErrors = Number(
    metrics?.system_errors_summary?.total_errors ?? metrics?.system_errors_summary?.total ?? 0
  );
  const cpuNow = Number(metrics?.cpu?.usage_percent ?? 0);
  const ramNow = Number(metrics?.ram?.percent ?? 0);
  const isHealthy = !connError && topbarErrors === 0 && cpuNow < 88 && ramNow < 90;

  const navItems: Array<{ id: MainTabId; label: string; icon: React.ReactNode }> = [
    { id: 'inicio', label: 'Inicio', icon: <Home className="h-5 w-5" /> },
    { id: 'equipo', label: 'Equipo', icon: <Cpu className="h-5 w-5" /> },
    { id: 'red', label: 'Red', icon: <Wifi className="h-5 w-5" /> },
    { id: 'programas', label: 'Programas', icon: <Grid className="h-5 w-5" /> },
    { id: 'mas', label: 'Más', icon: <MoreHorizontal className="h-5 w-5" /> },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] pb-28">
        {/* Unified Cockpit Topbar (matching docs/assets/cockpit-ui-preview.svg) */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: COCKPIT_EASE }}
          className="mx-auto max-w-6xl px-3 pt-3 sm:px-6 md:sticky md:top-3 md:z-30"
        >
          <header className="cockpit-topbar">
            <div className="flex h-14 items-center justify-between gap-3 px-3.5 sm:px-5">
              {/* Zone 1: Brand with CMineWar emblem */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => navigateTo('inicio')}
                className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50/80 p-1 dark:border-sky-800/70 dark:bg-sky-950/60">
                  {!logoBroken ? (
                    <img
                      src="/recursos-cockpit.png"
                      alt="Recursos CMineWar"
                      onError={() => setLogoBroken(true)}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Activity className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  )}
                </div>
                <div className="leading-tight">
                  <span className="block font-display text-sm font-bold tracking-tight text-slate-900 dark:text-white sm:text-base">
                    Recursos
                  </span>
                  <span className="hidden sm:block font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    {metrics?.system?.hostname || 'Cockpit'} · {theme === 'dark' ? 'Oscuro' : 'Claro'}
                  </span>
                </div>
              </motion.button>

              {/* Zone 2: Desktop Segmented Pills con layoutId deslizante */}
              <LayoutGroup id="desktop-nav">
                <nav aria-label="Navegación principal escritorio" className="hidden md:flex items-center gap-1">
                  {navItems.map((item) => {
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateTo(item.id)}
                        className={`relative rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                          active
                            ? 'text-sky-700 dark:text-sky-300'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                        }`}
                      >
                        {active && <MorphPill layoutId="desktop-nav-pill" className="rounded-xl shadow-xs" />}
                        <span className="relative z-10">{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </LayoutGroup>

              {/* Zone 3: Live Health Pill + Quick Theme + Version Pill */}
              <div className="flex items-center gap-2 shrink-0">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  onClick={() => navigateTo(topbarErrors > 0 ? 'mas' : 'inicio', topbarErrors > 0 ? 'logs' : undefined)}
                  className={`hidden sm:inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    connError || topbarErrors > 0 ? 'cockpit-pill-amber' : 'cockpit-pill-emerald'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      connError || topbarErrors > 0
                        ? 'bg-amber-500 text-amber-500'
                        : 'bg-emerald-500 text-emerald-500 cockpit-live-dot cockpit-live-ring'
                    }`}
                  />
                  <span>
                    {connError
                      ? 'Reconectando'
                      : topbarErrors > 0
                        ? `${topbarErrors} ${topbarErrors === 1 ? 'aviso' : 'avisos'}`
                        : isHealthy
                          ? 'Sistema Saludable'
                          : 'Carga Alta'}
                  </span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.9, rotate: 18 }}
                  type="button"
                  aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                  onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="cockpit-subtile flex min-h-[36px] min-w-[36px] items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={theme}
                      initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                      transition={{ duration: 0.2 }}
                      className="inline-flex"
                    >
                      {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-sky-700" />}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => navigateTo('mas', 'updates')}
                  className="cockpit-pill-cyan min-h-[36px] rounded-xl px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition-opacity hover:opacity-90 whitespace-nowrap"
                >
                  v{displayVersion}
                </motion.button>
              </div>
            </div>
          </header>
        </motion.div>

        {/* Main Content Container */}
        <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-5">
          <AnimatePresence>
            {connError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="cockpit-pill-amber mb-4 rounded-xl px-4 py-3 text-xs font-medium"
              >
                {connError}
              </motion.div>
            )}
          </AnimatePresence>

          {loading && !metrics ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="cockpit-bento h-56 animate-pulse p-5"
                />
              ))}
            </div>
          ) : (
            <ViewStage tabKey={activeTab}>
              {activeTab === 'inicio' && (
                <OverviewView
                  metrics={metrics}
                  theme={theme}
                  onNavigate={navigateTo}
                  onExpandChart={setExpandedChart}
                  onPowerAction={handlePowerClick}
                  actionPendingMac={pendingMac}
                />
              )}
              {activeTab === 'equipo' && (
                <EquipmentView
                  metrics={metrics}
                  theme={theme}
                  initialSubTab={subTabHint}
                  navTick={navTick}
                  onExpandChart={setExpandedChart}
                />
              )}
              {activeTab === 'red' && (
                <NetworkSecurityView
                  metrics={metrics}
                  theme={theme}
                  initialSubTab={subTabHint}
                  navTick={navTick}
                  onExpandChart={setExpandedChart}
                  onPowerAction={handlePowerClick}
                  actionPendingMac={pendingMac}
                  onRefreshMetrics={() => void fetchMetrics()}
                  onNotify={notify}
                />
              )}
              {activeTab === 'programas' && (
                <AppsMediaView
                  metrics={metrics}
                  initialSubTab={subTabHint}
                  navTick={navTick}
                  onServiceAction={handleServiceAction}
                  actionPendingTarget={pendingServiceTarget}
                />
              )}
              {activeTab === 'mas' && (
                <MoreView
                  metrics={metrics}
                  theme={theme}
                  onChangeTheme={applyTheme}
                  initialSubTab={subTabHint}
                  navTick={navTick}
                  onRefreshMetrics={() => void fetchMetrics()}
                  onNotify={notify}
                />
              )}
            </ViewStage>
          )}
        </main>

        {/* Centered Floating Glassmorphic Dock with Spring Morph Pill */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: COCKPIT_EASE }}
          className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3"
        >
          <LayoutGroup id="dock-nav">
            <nav
              aria-label="Barra de navegación inferior"
              className="cockpit-dock pointer-events-auto grid w-full max-w-[540px] grid-cols-5 items-center gap-1 p-1.5"
            >
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`relative flex min-h-[46px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 transition-colors ${
                      active
                        ? 'text-sky-700 dark:text-sky-300 font-semibold'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {active && <MorphPill layoutId="dock-active-pill" className="rounded-[14px]" />}
                    <motion.span
                      animate={{ scale: active ? 1.1 : 1, y: active ? -1 : 0 }}
                      transition={COCKPIT_SPRING}
                      className="relative z-10 inline-flex"
                    >
                      {item.icon}
                    </motion.span>
                    <span className="relative z-10 text-[11px] font-semibold tracking-tight whitespace-nowrap">
                      {item.label}
                    </span>
                  </motion.button>
                );
              })}
            </nav>
          </LayoutGroup>
        </motion.div>

        {/* Expanded Chart Modal (Inspección táctil e historial completo SQLite) */}
        <AnimatePresence>
          {expandedChart && (
            <ExpandedChartModal
              spec={expandedChart}
              liveMetrics={metrics}
              theme={theme}
              onClose={() => setExpandedChart(null)}
            />
          )}
        </AnimatePresence>

        {/* Custom Shutdown Confirmation Modal */}
        <AnimatePresence>
          {confirmShutdownClient && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
              onClick={() => setConfirmShutdownClient(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={COCKPIT_SPRING}
                className="cockpit-bento w-full max-w-sm p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  ¿Enviar señal de apagado?
                </h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  Se enviará una señal de suspensión o apagado a{' '}
                  <strong>
                    {confirmShutdownClient.name || confirmShutdownClient.hostname || confirmShutdownClient.ip}
                  </strong>
                  .
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmShutdownClient(null)}
                    className="cockpit-subtile min-h-[42px] px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = confirmShutdownClient;
                      setConfirmShutdownClient(null);
                      void executePowerAction('shutdown', target);
                    }}
                    className="min-h-[42px] rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Sí, apagar
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Non-blocking Animated Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 24, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.94 }}
              transition={COCKPIT_SPRING}
              className="cockpit-bento fixed right-4 top-20 z-50 max-w-xs px-4 py-3 text-xs font-medium text-slate-900 shadow-xl dark:text-white"
            >
              <span className={toast.isError ? 'text-rose-600 dark:text-rose-400' : 'text-sky-700 dark:text-sky-300'}>
                {toast.message}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

export default App;
