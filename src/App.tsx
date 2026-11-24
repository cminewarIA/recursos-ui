import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  Activity,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import { COCKPIT_EASE, COCKPIT_SPRING, ViewStage } from './components/MotionPrimitives';
import { OverviewView, ExpandChartSpec } from './components/OverviewView';
import { EquipmentView } from './components/EquipmentView';
import { NetworkSecurityView } from './components/NetworkSecurityView';
import { AppsMediaView } from './components/AppsMediaView';
import { MoreView } from './components/MoreView';
import { ExpandedChartModal } from './components/ExpandedChartModal';
import { NavigationSidebar } from './components/NavigationSidebar';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { MainTabId, MetricsPayload, TelemetryHistoryResponse, ThemeMode, VersionInfo, WifiClient } from './types/telemetry';
import { apiFetchJson, detectNativeEnvironment, setStoredToken } from './utils/api';
import { formatCanonicalRoute, normalizeSubTabForView, resolveAppRoute } from './utils/formatters';
import { getCanonicalDisplayVersion, getCanonicalVersion, isRemoteVersionHigher } from './utils/version';
import { useI18n } from './i18n';
import { useFirebase } from './firebase/FirebaseProvider';
import { installCockpitScrollContainment } from './utils/scrollContain';

interface ToastState {
  id: number;
  message: string;
  isError: boolean;
}

export function App() {
  const { t, locale, setLocale } = useI18n();
  const {
    user: fbUser,
    autoSync: fbAutoSync,
    syncedPreferences: fbPrefs,
    syncPreferences: fbSyncPreferences,
    syncHostSnapshot: fbSyncHostSnapshot,
    syncPingSnapshot: fbSyncPingSnapshot,
  } = useFirebase();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('recursos_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const applyingRemotePrefRef = useRef(false);
  const lastNodeSyncMsRef = useRef(0);
  const lastPingSyncMsRef = useRef(0);

  const [activeTab, setActiveTab] = useState<MainTabId>(() => {
    if (typeof window !== 'undefined') {
      const qView = new URLSearchParams(window.location.search).get('view');
      return resolveAppRoute(qView || window.location.pathname).view;
    }
    return 'inicio';
  });
  const [subTabHint, setSubTabHint] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') {
      const qView = new URLSearchParams(window.location.search).get('view');
      return resolveAppRoute(qView || window.location.pathname).subTab;
    }
    return undefined;
  });
  const [navTick, setNavTick] = useState(0);
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  // Global Ctrl+K / Cmd+K quick search shortcut
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // Bidirectional browser Back / Forward (popstate) sync for independent submenu pages
  useEffect(() => {
    const onPopState = () => {
      const qView = new URLSearchParams(window.location.search).get('view');
      const resolved = resolveAppRoute(qView || window.location.pathname);
      setActiveTab(resolved.view);
      setSubTabHint(resolved.subTab);
      setNavTick((tVal) => tVal + 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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

  // Apply remote Cloud Firestore preferences when received via real-time onSnapshot
  useEffect(() => {
    if (!fbUser?.emailVerified || !fbPrefs) return;
    applyingRemotePrefRef.current = true;
    if (fbPrefs.theme && fbPrefs.theme !== theme) {
      applyTheme(fbPrefs.theme);
    }
    if (fbPrefs.locale && fbPrefs.locale !== locale) {
      setLocale(fbPrefs.locale);
    }
    const id = window.setTimeout(() => {
      applyingRemotePrefRef.current = false;
    }, 50);
    return () => window.clearTimeout(id);
  }, [fbUser?.emailVerified, fbPrefs, theme, locale, applyTheme, setLocale]);

  // Persist local theme/locale changes to Cloud Firestore when authenticated
  useEffect(() => {
    if (!fbUser?.emailVerified || applyingRemotePrefRef.current) return;
    void fbSyncPreferences({ theme, locale }).catch(() => {
      // Structured Firestore error already logged by handleFirestoreError
    });
  }, [fbUser?.emailVerified, theme, locale, fbSyncPreferences]);

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
      const resolved = resolveAppRoute(viewName);
      setActiveTab(resolved.view);
      setSubTabHint(resolved.subTab);
      setNavTick((tVal) => tVal + 1);
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        const targetPath = formatCanonicalRoute(resolved.view, resolved.subTab);
        if (window.location.pathname !== targetPath) {
          window.history.replaceState({ tab: resolved.view, sub: resolved.subTab }, '', targetPath);
        }
      }
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

  // Close shutdown confirmation dialog on Escape
  useEffect(() => {
    if (!confirmShutdownClient) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setConfirmShutdownClient(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmShutdownClient]);

  // Lock background viewport when modals open & add elastic jelly overscroll physics on modals/popovers
  useEffect(() => {
    return installCockpitScrollContainment();
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
    const normalizedSub = normalizeSubTabForView(tab, sub);
    setActiveTab(tab);
    setSubTabHint(normalizedSub);
    setNavTick((tVal) => tVal + 1);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const targetPath = formatCanonicalRoute(tab, normalizedSub);
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ tab, sub: normalizedSub }, '', targetPath);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSubTabChange = useCallback((tab: MainTabId, sub: string) => {
    const normalizedSub = normalizeSubTabForView(tab, sub);
    setSubTabHint(normalizedSub);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const targetPath = formatCanonicalRoute(tab, normalizedSub);
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ tab, sub: normalizedSub }, '', targetPath);
      }
    }
  }, []);

  // Keep browser document.title synced with the active independent page route
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const routePath = formatCanonicalRoute(activeTab, subTabHint);
    const baseTitle = t('app.brand');
    document.title = routePath === '/' ? baseTitle : `${baseTitle} · ${routePath}`;
  }, [activeTab, subTabHint, t]);

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

  // Throttled live host telemetry snapshot sync to Cloud Firestore (every 20s when autoSync enabled)
  useEffect(() => {
    if (!fbUser?.emailVerified || !fbAutoSync || !metrics) return;
    const nowMs = Date.now();
    if (nowMs - lastNodeSyncMsRef.current < 20_000) return;
    lastNodeSyncMsRef.current = nowMs;
    void fbSyncHostSnapshot(metrics, isHealthy, Boolean(connError)).catch(() => {
      // Structured Firestore error logged by handleFirestoreError
    });
  }, [fbUser?.emailVerified, fbAutoSync, metrics, isHealthy, connError, fbSyncHostSnapshot]);

  // Throttled ping latency history snapshot sync to Cloud Firestore (every 60s when autoSync enabled)
  useEffect(() => {
    if (!fbUser?.emailVerified || !fbAutoSync || !metrics?.net?.ping_latency?.targets?.length) return;
    const nowMs = Date.now();
    if (nowMs - lastPingSyncMsRef.current < 60_000) return;
    lastPingSyncMsRef.current = nowMs;
    void fbSyncPingSnapshot(metrics).catch(() => {
      // Structured Firestore error logged by handleFirestoreError
    });
  }, [fbUser?.emailVerified, fbAutoSync, metrics, fbSyncPingSnapshot]);

  const currentRoutePath = formatCanonicalRoute(activeTab, subTabHint);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] pb-[clamp(5rem,12dvh,7.25rem)]">
        <div id="cockpit-scroll-stage" data-cockpit-jelly-stage="true">
          {/* Clean Editorial Top Header: Brand + Route · Quick Search (Ctrl+K) · Health & Theme */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: COCKPIT_EASE }}
            className="cockpit-shell pt-[clamp(0.5rem,1.4dvh,1.1rem)]"
          >
          <header className="cockpit-topbar flex flex-wrap items-center justify-between gap-[clamp(0.5rem,1.5vw,1rem)] px-[clamp(0.75rem,1.6vw,1.25rem)] py-[clamp(0.45rem,0.9dvh,0.7rem)]">
            {/* Zone 1: Brand with CMineWar emblem & current independent route */}
            <motion.button
              type="button"
              onClick={() => navigateTo('inicio')}
              className="flex min-w-0 items-center gap-[clamp(0.55rem,1.2vw,0.9rem)] text-left cursor-pointer"
            >
              {!logoBroken ? (
                <img
                  src="/recursos-cockpit.png"
                  alt={t('app.brand_alt')}
                  onError={() => setLogoBroken(true)}
                  className="h-[clamp(2.25rem,min(5vw,7.5dvh),3.25rem)] w-[clamp(2.25rem,min(5vw,7.5dvh),3.25rem)] shrink-0 object-contain drop-shadow-[0_4px_12px_rgba(30,107,56,0.22)] dark:drop-shadow-[0_4px_16px_rgba(198,241,157,0.28)]"
                />
              ) : (
                <div className="flex h-[clamp(2.25rem,min(5vw,7.5dvh),3.25rem)] w-[clamp(2.25rem,min(5vw,7.5dvh),3.25rem)] shrink-0 items-center justify-center rounded-xl border border-[#9bd86b] bg-[#e5f8d3] text-[#144d23] dark:border-[#c6f19d]/25 dark:bg-[#0f1f10] dark:text-[#c6f19d]">
                  <Activity className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 leading-tight">
                <span className="block truncate font-display text-[clamp(1rem,1.15vw+0.55rem,1.35rem)] font-bold tracking-tight text-slate-900 dark:text-[#f5f4f2]">
                  {t('app.brand')}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[clamp(0.625rem,0.45vw+0.42rem,0.72rem)] tracking-[0.04em] text-slate-500 dark:text-slate-400">
                  {metrics?.system?.hostname || t('app.cockpit_fallback')} · {currentRoutePath}
                </span>
              </div>
            </motion.button>

            {/* Zone 2: Global Quick Search Trigger (Ctrl+K) */}
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              aria-label={t('search.quick_search')}
              className="cockpit-subtile hidden md:flex items-center justify-between gap-4 min-h-[38px] w-[clamp(210px,24vw,340px)] px-3.5 text-xs text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-slate-900 dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#f5f4f2] cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 truncate">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{t('search.quick_search')}</span>
              </span>
              <kbd className="shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                Ctrl K
              </kbd>
            </button>

            {/* Zone 3: Mobile Search + Live Health + Quick Theme + Version */}
            <div className="flex items-center gap-2 shrink-0">
              <motion.button
                type="button"
                aria-label={t('search.quick_search')}
                onClick={() => setSearchModalOpen(true)}
                className="cockpit-subtile flex md:hidden min-h-[36px] min-w-[36px] items-center justify-center text-slate-700 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-200 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
              >
                <Search className="h-4 w-4" />
              </motion.button>
              <motion.button
                type="button"
                onClick={() => navigateTo(topbarErrors > 0 ? 'mas' : 'inicio', topbarErrors > 0 ? 'logs' : undefined)}
                className={`hidden sm:inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.03em] transition-colors whitespace-nowrap cursor-pointer ${
                  connError || topbarErrors > 0 ? 'cockpit-pill-amber' : 'cockpit-pill-emerald'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    connError || topbarErrors > 0
                      ? 'bg-amber-500 text-amber-500'
                      : 'bg-[#1e6b38] dark:bg-[#c6f19d] text-[#1e6b38] dark:text-[#c6f19d] cockpit-live-dot cockpit-live-ring'
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
                type="button"
                aria-label={theme === 'dark' ? t('app.toggle_to_light') : t('app.toggle_to_dark')}
                onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
                className="cockpit-subtile flex min-h-[36px] min-w-[36px] items-center justify-center text-slate-700 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-200 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
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
                    {theme === 'dark' ? <Sun className="h-4 w-4 text-[#c6f19d]" /> : <Moon className="h-4 w-4 text-[#0f1f10]" />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>

              <motion.button
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
                  updateAvailable ? 'cockpit-pill-lime' : 'cockpit-subtile text-slate-800 dark:text-[#f5f4f2]'
                } inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums transition-opacity hover:opacity-90 whitespace-nowrap cursor-pointer`}
              >
                <span
                  className={`h-2 w-2 rounded-[3px] ${
                    updateAvailable
                      ? 'bg-[#0f1f10] cockpit-live-dot'
                      : 'bg-[#1e6b38] dark:bg-[#c6f19d] ring-1 ring-[#0f1f10]/15 dark:ring-[#0f1f10]/20'
                  }`}
                />
                <span>v{displayVersion}</span>
              </motion.button>
            </div>
          </header>
        </motion.div>

        {/* Main Content Container */}
        <main className="cockpit-shell py-[clamp(0.5rem,1.6dvh,1.25rem)]">
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
                  className="cockpit-bento cockpit-chart-medium animate-pulse p-5"
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
                  onNavigate={navigateTo}
                  onSubTabChange={(sub) => handleSubTabChange('equipo', sub)}
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
                  netHistory24h={netHistory24h}
                  netHistoryLoading={netHistoryLoading}
                  netHistoryError={netHistoryError}
                  onRefreshNetHistory24h={() => void fetchNetworkHistory24h(true)}
                  onSubTabChange={(sub) => handleSubTabChange('red', sub)}
                />
              )}
              {activeTab === 'programas' && (
                <AppsMediaView
                  metrics={metrics}
                  theme={theme}
                  initialSubTab={subTabHint}
                  navTick={navTick}
                  onServiceAction={handleServiceAction}
                  actionPendingTarget={pendingServiceTarget}
                  onSubTabChange={(sub) => handleSubTabChange('programas', sub)}
                  onNotify={notify}
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
                  onSubTabChange={(sub) => handleSubTabChange('mas', sub)}
                />
              )}
            </ViewStage>
          )}
        </main>
        </div>

        {/* Ergonomic Obsidian Floating Dock with Electric Lime Spring Morph Pill */}
        <NavigationSidebar activeTab={activeTab} onNavigate={navigateTo} />

        {/* Global Quick Search Modal (Ctrl+K) with direct deep-link routes */}
        <GlobalSearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          onNavigate={navigateTo}
          metrics={metrics}
        />

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
              exit={{ opacity: 0, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
              transition={{ duration: 0.18 }}
              data-cockpit-scroll-contain="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overscroll-contain"
              onClick={() => setConfirmShutdownClient(null)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                data-cockpit-scroll-contain="true"
                initial={{ opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
                transition={COCKPIT_SPRING}
                className="cockpit-bento cockpit-modal-enter w-full max-w-sm p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="pb-3 border-b border-slate-200/70 dark:border-slate-800">
                  <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('status.power_confirm_title')}
                  </h3>
                </div>
                <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
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
                    className="cockpit-subtile min-h-[42px] px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
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
                    className="cockpit-btn-off min-h-[42px] rounded-xl px-4 text-xs font-semibold transition-colors"
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
              className="cockpit-bento cockpit-toast-enter fixed right-4 top-20 z-50 max-w-xs px-4 py-3 text-xs font-medium text-slate-900 dark:text-white"
            >
              <span className={toast.isError ? 'text-rose-600 dark:text-rose-400' : 'text-[#1e6b38] dark:text-[#c6f19d]'}>
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
