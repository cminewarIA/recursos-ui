import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'motion/react';
import {
  Activity,
  ArrowDownUp,
  Cpu,
  Grid,
  Home,
  Maximize2,
  Moon,
  MoreHorizontal,
  RefreshCw,
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
import { ChartSeries, TelemetryChart } from './components/TelemetryChart';
import { MainTabId, MetricsPayload, TelemetryHistoryResponse, ThemeMode, VersionInfo, WifiClient } from './types/telemetry';
import { apiFetchJson, detectNativeEnvironment, setStoredToken } from './utils/api';
import { extractInitialSubTabFromRoute, formatSpeed, normalizeExternalRoute } from './utils/formatters';
import { getCanonicalDisplayVersion, getCanonicalVersion, isRemoteVersionHigher } from './utils/version';
import { useI18n } from './i18n';

interface ToastState {
  id: number;
  message: string;
  isError: boolean;
}

export function App() {
  const { t } = useI18n();
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
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);

  const [netHistory24h, setNetHistory24h] = useState<TelemetryHistoryResponse | null>(null);
  const [netHistoryLoading, setNetHistoryLoading] = useState<boolean>(true);
  const [netHistoryError, setNetHistoryError] = useState<boolean>(false);
  const netHistorySeqRef = useRef(0);

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
      setConnError(t('status.verify_lan_required'));
    } else {
      setConnError(t('status.reconnecting_server'));
    }
  }, [t]);

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
        void apiFetchJson<{ token?: string }>('/api/auth/register-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_telemetry: telemetry }),
        }).then((res) => {
          if (res.ok && res.data?.token) {
            setStoredToken(res.data.token);
          }
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
      app_version: getCanonicalVersion(),
      screen_width: window.screen?.width,
      screen_height: window.screen?.height,
    };
    void apiFetchJson<{ token?: string }>('/api/auth/register-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_telemetry: payload }),
    }).then((res) => {
      if (res.ok && res.data?.token) {
        setStoredToken(res.data.token);
      }
    });
  }, []);

  const handleVersionChange = useCallback((nextVer: VersionInfo) => {
    setVersionInfo(nextVer);
    setUpdateAvailable(isRemoteVersionHigher(nextVer));
  }, []);

  // Fetch /api/version on app load & periodically, update display version and updateAvailable state
  const refreshVersionInfo = useCallback(async () => {
    const res = await apiFetchJson<VersionInfo>('/api/version');
    if (res.ok && res.data) {
      handleVersionChange(res.data);
    }
  }, [handleVersionChange]);

  useEffect(() => {
    void refreshVersionInfo();
    const timerId = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        void refreshVersionInfo();
      }
    }, 300000);
    return () => window.clearInterval(timerId);
  }, [refreshVersionInfo]);

  const metricsCurrentVersion = metrics?.version_info?.current_version;
  useEffect(() => {
    if (!metricsCurrentVersion) return;
    if (!versionInfo) {
      setUpdateAvailable(isRemoteVersionHigher(metrics?.version_info));
      return;
    }
    if (metricsCurrentVersion !== versionInfo.current_version && !versionInfo.ubuntu_native_bridge) {
      void refreshVersionInfo();
    }
  }, [metricsCurrentVersion, metrics?.version_info, versionInfo, refreshVersionInfo]);

  // Fetch 24h persistent network traffic history from /api/metrics/history
  const fetchNetworkHistory24h = useCallback(async (showSpinner = false) => {
    const seq = ++netHistorySeqRef.current;
    if (showSpinner) {
      setNetHistoryLoading(true);
    }
    const res = await apiFetchJson<TelemetryHistoryResponse>('/api/metrics/history?window_sec=86400&limit=288');
    if (seq !== netHistorySeqRef.current) return;
    if (res.ok && res.data?.ok) {
      setNetHistory24h(res.data);
      setNetHistoryError(false);
    } else {
      setNetHistoryError(true);
    }
    setNetHistoryLoading(false);
  }, []);

  useEffect(() => {
    const isPaused = () =>
      (typeof document !== 'undefined' && document.hidden) ||
      Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__);

    void fetchNetworkHistory24h(true);
    const intervalId = window.setInterval(() => {
      if (!isPaused()) {
        void fetchNetworkHistory24h(false);
      }
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [fetchNetworkHistory24h]);

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
          name: client.name || client.hostname || client.ip || t('overview.device_fallback'),
        }),
      });
      setPendingMac(null);
      if (res.ok && res.data?.success !== false) {
        notify(
          res.data?.message ||
            (action === 'wake' ? t('status.wake_sent') : t('status.sleep_sent'))
        );
      } else {
        notify(res.data?.error || res.error || t('status.signal_error'), true);
      }
    },
    [notify, t]
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
        notify(res.data?.message || t('status.action_sent'));
        setTimeout(() => void fetchMetrics(), 900);
      } else {
        notify(res.data?.error || res.error || t('status.action_error'), true);
      }
    },
    [fetchMetrics, notify, t]
  );

  const activeVersionInfo = versionInfo ?? metrics?.version_info;
  const displayVersion = getCanonicalDisplayVersion(activeVersionInfo);
  const remoteDisplayVersion = activeVersionInfo?.remote_version
    ? getCanonicalDisplayVersion({
        current_version: activeVersionInfo.remote_version,
        display_version: activeVersionInfo.remote_display_version,
      })
    : displayVersion;
  const topbarErrors = Number(
    metrics?.system_errors_summary?.total_errors ?? metrics?.system_errors_summary?.total ?? 0
  );
  const cpuNow = Number(metrics?.cpu?.usage_percent ?? 0);
  const ramNow = Number(metrics?.ram?.percent ?? 0);
  const isHealthy = !connError && topbarErrors === 0 && cpuNow < 88 && ramNow < 90;

  const navItems: Array<{ id: MainTabId; label: string; icon: React.ReactNode }> = [
    { id: 'inicio', label: t('nav.inicio'), icon: <Home className="h-5 w-5" /> },
    { id: 'equipo', label: t('nav.equipo'), icon: <Cpu className="h-5 w-5" /> },
    { id: 'red', label: t('nav.red'), icon: <Wifi className="h-5 w-5" /> },
    { id: 'programas', label: t('nav.programas'), icon: <Grid className="h-5 w-5" /> },
    { id: 'mas', label: t('nav.mas'), icon: <MoreHorizontal className="h-5 w-5" /> },
  ];

  const network24hView = useMemo(() => {
    const dbSeries = netHistory24h?.series;
    const dbRx = dbSeries?.net_rx ?? [];
    const useFallbackLive = dbRx.length < 2 && (metrics?.history?.net_rx?.length ?? 0) >= 2;
    const sourceSeries = useFallbackLive ? metrics?.history : dbSeries;

    const rxTotal = sourceSeries?.net_rx ?? [];
    const txTotal = sourceSeries?.net_tx ?? [];
    const wanRxData = sourceSeries?.net_wan_rx?.length ? sourceSeries.net_wan_rx : rxTotal;
    const wanTxData = sourceSeries?.net_wan_tx?.length ? sourceSeries.net_wan_tx : txTotal;
    const lanRxData = sourceSeries?.net_lan_rx?.length ? sourceSeries.net_lan_rx : rxTotal.map(() => 0);
    const lanTxData = sourceSeries?.net_lan_tx?.length ? sourceSeries.net_lan_tx : txTotal.map(() => 0);

    const timestamps = sourceSeries?.timestamps ?? [];
    const dateTimestamps = sourceSeries?.date_timestamps ?? [];
    const epochTs = sourceSeries?.epoch_ts ?? [];

    const peakWanRxMb = wanRxData.length > 0 ? Math.max(...wanRxData) : 0;
    const peakWanTxMb = wanTxData.length > 0 ? Math.max(...wanTxData) : 0;
    const peakLanRxMb = lanRxData.length > 0 ? Math.max(...lanRxData) : 0;
    const peakLanTxMb = lanTxData.length > 0 ? Math.max(...lanTxData) : 0;

    const series: ChartSeries[] = [
      {
        id: 'net_wan_rx_24h',
        metricKey: 'net_wan_rx',
        label: t('hardware.net.wan_download'),
        data: wanRxData,
        color: '#0284c7',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.16,
      },
      {
        id: 'net_wan_tx_24h',
        metricKey: 'net_wan_tx',
        label: t('hardware.net.wan_upload'),
        data: wanTxData,
        color: '#10b981',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.08,
      },
      {
        id: 'net_lan_rx_24h',
        metricKey: 'net_lan_rx',
        label: t('hardware.net.lan_download'),
        data: lanRxData,
        color: '#6366f1',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.10,
      },
      {
        id: 'net_lan_tx_24h',
        metricKey: 'net_lan_tx',
        label: t('hardware.net.lan_upload'),
        data: lanTxData,
        color: '#f59e0b',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.06,
      },
    ];

    return {
      series,
      timestamps,
      dateTimestamps,
      epochTs,
      sampleCount: Math.max(wanRxData.length, wanTxData.length, lanRxData.length, lanTxData.length),
      peakWanRxMb,
      peakWanTxMb,
      peakLanRxMb,
      peakLanTxMb,
    };
  }, [netHistory24h, metrics?.history, t]);

  const openNetwork24hExpanded = useCallback(() => {
    setExpandedChart({
      title: t('overview.net_history_24h_title'),
      subtitle: t('overview.net_history_24h_sub'),
      series: network24hView.series,
      timestamps: network24hView.timestamps,
      epochTs: network24hView.epochTs,
      leftUnit: 'MB/s',
      chartKind: 'net',
    });
  }, [network24hView.series, network24hView.timestamps, network24hView.epochTs, t]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] pb-28">
        {/* Clean Frameless Brand Header with Enlarged Transparent CMineWar Emblem */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: COCKPIT_EASE }}
          className="cockpit-shell pt-3 sm:pt-4"
        >
          <header className="flex flex-wrap items-center justify-between gap-4 py-1">
            {/* Zone 1: Brand with enlarged transparent CMineWar emblem */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => navigateTo('inicio')}
              className="flex items-center gap-3.5 sm:gap-4 text-left whitespace-nowrap shrink-0"
            >
              {!logoBroken ? (
                <img
                  src="/recursos-cockpit.png"
                  alt={t('app.brand_alt')}
                  onError={() => setLogoBroken(true)}
                  className="h-20 w-20 sm:h-28 sm:w-28 shrink-0 object-contain drop-shadow-[0_4px_14px_rgba(14,165,233,0.26)] dark:drop-shadow-[0_6px_18px_rgba(56,189,248,0.34)]"
                />
              ) : (
                <div className="flex h-20 w-20 sm:h-28 sm:w-28 shrink-0 items-center justify-center">
                  <Activity className="h-10 w-10 text-sky-600 dark:text-sky-400" />
                </div>
              )}
              <div className="leading-tight">
                <span className="block font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  {t('app.brand')}
                </span>
                <span className="mt-0.5 block font-mono text-xs font-medium text-slate-500 dark:text-slate-400">
                  {metrics?.system?.hostname || t('app.cockpit_fallback')} · {theme === 'dark' ? t('app.theme_dark') : t('app.theme_light')}
                </span>
              </div>
            </motion.button>

            {/* Zone 2: Live Health Pill + Quick Theme + Version Pill */}
            <div className="flex items-center gap-2 shrink-0">
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => navigateTo(topbarErrors > 0 ? 'mas' : 'inicio', topbarErrors > 0 ? 'logs' : undefined)}
                className={`hidden sm:inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
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
                    ? t('status.reconnecting')
                    : topbarErrors > 0
                      ? `${topbarErrors} ${topbarErrors === 1 ? t('status.notice_single') : t('status.notice_plural')}`
                      : isHealthy
                        ? t('status.healthy')
                        : t('status.high_load')}
                </span>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9, rotate: 18 }}
                type="button"
                aria-label={theme === 'dark' ? t('app.toggle_to_light') : t('app.toggle_to_dark')}
                onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
                className="cockpit-subtile flex min-h-[38px] min-w-[38px] items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-300"
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
                title={
                  updateAvailable
                    ? t('more.new_version_available', { ver: remoteDisplayVersion })
                    : `v${displayVersion}`
                }
                aria-label={
                  updateAvailable
                    ? t('more.new_version_available', { ver: remoteDisplayVersion })
                    : `v${displayVersion}`
                }
                className={`${
                  updateAvailable ? 'cockpit-pill-emerald' : 'cockpit-pill-cyan'
                } inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1 font-mono text-xs font-semibold tabular-nums transition-opacity hover:opacity-90 whitespace-nowrap`}
              >
                {updateAvailable && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 cockpit-live-dot" />
                )}
                <span>v{displayVersion}</span>
              </motion.button>
            </div>
          </header>
        </motion.div>

        {/* Main Content Container */}
        <main className="cockpit-shell py-4 sm:py-5">
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
            <div className="cockpit-auto-grid">
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
                  onVersionChange={handleVersionChange}
                  onNotify={notify}
                />
              )}
            </ViewStage>
          )}

          {/* 24-Hour Network Traffic Evolution Section */}
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: COCKPIT_EASE }}
            aria-labelledby="network-24h-history-title"
            className="cockpit-bento mt-6 p-5"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="cockpit-pill-cyan inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <ArrowDownUp className="h-4 w-4" />
                  </span>
                  <h2
                    id="network-24h-history-title"
                    className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white sm:text-lg"
                  >
                    {t('overview.net_history_24h_title')}
                  </h2>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span>{t('overview.net_history_24h_sub')}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {t('overview.net_history_24h_badge')}
                  </span>
                  {network24hView.sampleCount > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">
                        {t('overview.net_history_24h_samples', { count: network24hView.sampleCount })}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-2 w-2 rounded-full bg-[#0284c7]" />
                    <span>{t('hardware.net.wan_download')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-2 w-2 rounded-full bg-[#10b981]" />
                    <span>{t('hardware.net.wan_upload')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-2 w-2 rounded-full bg-[#6366f1]" />
                    <span>{t('hardware.net.lan_download')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                    <span>{t('hardware.net.lan_upload')}</span>
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    type="button"
                    aria-label={t('network.refresh')}
                    onClick={() => void fetchNetworkHistory24h(true)}
                    className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                  >
                    <RefreshCw className={`h-4 w-4 ${netHistoryLoading ? 'animate-spin' : ''}`} />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    type="button"
                    aria-label={t('hardware.net.expand_aria')}
                    onClick={openNetwork24hExpanded}
                    className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </motion.button>
                </div>
              </div>
            </div>

            {/* Summary KPI row separated by clean hairline divider */}
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200/80 pt-4 sm:grid-cols-4 dark:border-slate-800">
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.wan_download')} ({t('overview.net_history_24h_peak_wan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-sky-700 dark:text-sky-300">
                  ↓ {formatSpeed(network24hView.peakWanRxMb * 1024 * 1024)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.wan_upload')} ({t('overview.net_history_24h_peak_wan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  ↑ {formatSpeed(network24hView.peakWanTxMb * 1024 * 1024)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.lan_download')} ({t('overview.net_history_24h_peak_lan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
                  ↓ {formatSpeed(network24hView.peakLanRxMb * 1024 * 1024)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.lan_upload')} ({t('overview.net_history_24h_peak_lan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  ↑ {formatSpeed(network24hView.peakLanTxMb * 1024 * 1024)}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-200/70 pt-4 dark:border-slate-800/80">
              {netHistoryLoading && network24hView.sampleCount < 2 ? (
                <div className="h-[220px] w-full animate-pulse rounded-xl bg-slate-100/80 dark:bg-slate-800/50" />
              ) : netHistoryError && network24hView.sampleCount < 2 ? (
                <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('overview.net_history_24h_error')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void fetchNetworkHistory24h(true)}
                    className="cockpit-subtile min-h-[40px] px-4 py-2 text-xs font-semibold text-sky-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-300 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    {t('overview.net_history_24h_retry')}
                  </button>
                </div>
              ) : (
                <TelemetryChart
                  series={network24hView.series}
                  timestamps={network24hView.timestamps}
                  dateTimestamps={network24hView.dateTimestamps}
                  epochTs={network24hView.epochTs}
                  height={220}
                  leftUnit="MB/s"
                  intervalSec={300}
                  theme={theme}
                  emptyMessage={t('overview.net_history_24h_empty')}
                  onExpandClick={openNetwork24hExpanded}
                />
              )}
            </div>
          </motion.section>
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
              aria-label={t('nav.bottom_aria')}
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
                  {t('status.power_confirm_title')}
                </h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  {t('status.power_confirm_body_pre')}{' '}
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
                    {t('status.power_confirm_cancel')}
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
                    {t('status.power_confirm_yes')}
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
