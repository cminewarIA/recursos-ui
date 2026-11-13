import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Grid,
  Home,
  MoreHorizontal,
  Wifi,
  X,
} from 'lucide-react';
import { OverviewView, ExpandChartSpec } from './components/OverviewView';
import { EquipmentView } from './components/EquipmentView';
import { NetworkSecurityView } from './components/NetworkSecurityView';
import { AppsMediaView } from './components/AppsMediaView';
import { MoreView } from './components/MoreView';
import { TelemetryChart } from './components/TelemetryChart';
import { MainTabId, MetricsPayload, ThemeMode, WifiClient } from './types/telemetry';
import { apiFetchJson, detectNativeEnvironment, setStoredToken } from './utils/api';
import { getDisplayVersionString, normalizeExternalRoute } from './utils/formatters';

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
      return normalizeExternalRoute(window.location.pathname);
    }
    return 'inicio';
  });
  const [subTabHint, setSubTabHint] = useState<string | undefined>(undefined);

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
    void fetchMetrics();
    const timer = setInterval(() => {
      void fetchMetrics();
    }, 1500);
    return () => clearInterval(timer);
  }, [fetchMetrics]);

  // Native bridge helpers (Ubuntu WebKit2 / Android WebView)
  useEffect(() => {
    window.switchView = (viewName: string) => {
      const normalized = normalizeExternalRoute(viewName);
      setActiveTab(normalized);
      const raw = (viewName || '').toLowerCase();
      if (raw.includes('dex')) setSubTabHint('dex');
      else if (raw.includes('version') || raw.includes('sistema')) setSubTabHint('updates');
      else if (raw.includes('cpu') || raw.includes('procesador')) setSubTabHint('cpu');
      else if (raw.includes('ram') || raw.includes('memoria')) setSubTabHint('ram');
      else if (raw.includes('gpu') || raw.includes('grafica')) setSubTabHint('gpu');
      else if (raw.includes('almacenamiento')) setSubTabHint('storage');
      else if (raw.includes('procesos')) setSubTabHint('processes');
      else setSubTabHint(undefined);
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
      void fetchMetrics();
    };
  }, [fetchMetrics]);

  // Register current browser/native session periodically on first mount
  useEffect(() => {
    const env = detectNativeEnvironment();
    const payload: Record<string, unknown> = {
      ...(window.__RECURSOS_DEVICE_TELEMETRY__ || {}),
      client_type: env.isUbuntuNative
        ? 'ubuntu_native'
        : env.isAndroidNative
          ? 'android_native'
          : 'web_browser',
      full_access: env.isNativeApp,
      app_version: window.__INITIAL_APP_VERSION__ || '12.0.0',
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

  const navItems: Array<{ id: MainTabId; label: string; icon: React.ReactNode }> = [
    { id: 'inicio', label: 'Inicio', icon: <Home className="h-5 w-5" /> },
    { id: 'equipo', label: 'Equipo', icon: <Cpu className="h-5 w-5" /> },
    { id: 'red', label: 'Red', icon: <Wifi className="h-5 w-5" /> },
    { id: 'programas', label: 'Programas', icon: <Grid className="h-5 w-5" /> },
    { id: 'mas', label: 'Más', icon: <MoreHorizontal className="h-5 w-5" /> },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] pb-24">
      {/* Minimal 3-Zone Top Bar (desktop sticky, mobile natural scroll to respect <= 15% sticky budget) */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 md:sticky md:top-0 md:z-30">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Zone 1: Brand with CMineWar logo */}
          <button
            type="button"
            onClick={() => navigateTo('inicio')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0"
          >
            {!logoBroken ? (
              <img
                src="/recursos-cockpit.png"
                alt="Recursos CMineWar"
                onError={() => setLogoBroken(true)}
                className="h-8 w-8 object-contain"
              />
            ) : (
              <Activity className="h-5 w-5 text-blue-600" />
            )}
            <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white">
              Recursos
            </span>
          </button>

          {/* Zone 2: Clean Desktop Typography Nav Links */}
          <nav aria-label="Navegación principal escritorio" className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-slate-900 underline decoration-2 underline-offset-8 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 quiet contextual action linking to Updates/Appearance */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => navigateTo('mas', 'updates')}
              className="min-h-[40px] rounded-xl border border-slate-200 px-3 py-1.5 font-mono text-xs font-semibold tabular-nums text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              v{displayVersion}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        {connError && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            {connError}
          </div>
        )}

        {loading && !metrics ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((k) => (
              <div
                key={k}
                className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              />
            ))}
          </div>
        ) : (
          <>
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
              <EquipmentView metrics={metrics} theme={theme} initialSubTab={subTabHint} />
            )}
            {activeTab === 'red' && (
              <NetworkSecurityView
                metrics={metrics}
                theme={theme}
                onPowerAction={handlePowerClick}
                actionPendingMac={pendingMac}
                onRefreshMetrics={() => void fetchMetrics()}
                onNotify={notify}
              />
            )}
            {activeTab === 'programas' && (
              <AppsMediaView
                metrics={metrics}
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
                onRefreshMetrics={() => void fetchMetrics()}
                onNotify={notify}
              />
            )}
          </>
        )}
      </main>

      {/* Fixed Bottom Touch Navigation Bar (<= 64px height, >= 44x44px hit targets) */}
      <nav
        aria-label="Barra de navegación inferior"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95"
      >
        <div className="mx-auto grid h-16 max-w-3xl grid-cols-5 items-center px-2">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {item.icon}
                <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Expanded Chart Modal (Interactive Tooltip included) */}
      {expandedChart && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setExpandedChart(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  {expandedChart.title}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{expandedChart.subtitle}</p>
              </div>
              <button
                type="button"
                aria-label="Cerrar gráfica ampliada"
                onClick={() => setExpandedChart(null)}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4">
              <TelemetryChart
                series={expandedChart.series}
                timestamps={expandedChart.timestamps}
                height={280}
                leftUnit={expandedChart.leftUnit}
                maxLeft={expandedChart.maxLeft}
                maxRight={expandedChart.maxRight}
                theme={theme}
              />
            </div>
          </div>
        </div>
      )}

      {/* Custom Shutdown Confirmation Modal */}
      {confirmShutdownClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setConfirmShutdownClient(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
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
                className="min-h-[42px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
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
          </div>
        </div>
      )}

      {/* Non-blocking Toast */}
      {toast && (
        <div className="fixed right-4 top-16 z-50 max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-white">
          <span className={toast.isError ? 'text-rose-600 dark:text-rose-400' : ''}>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
