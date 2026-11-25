import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  GitCommit,
  Globe,
  Languages,
  Laptop,
  Lock,
  Moon,
  Palette,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  Usb,
} from 'lucide-react';
import { COCKPIT_SPRING, MorphPill, ViewStage } from './MotionPrimitives';
import { ServiceConsoleView } from './ServiceConsoleView';
import {
  AiSimplifyFaultsResponse,
  AiSystemFaultInsight,
  DexStatusPayload,
  FailedSystemdUnit,
  GithubNativeReleasesPayload,
  MetricsPayload,
  SystemErrorLogEntry,
  SystemErrorsSummary,
  ThemeMode,
  TrustedDevice,
  VersionInfo,
} from '../types/telemetry';
import { apiFetchJson, detectNativeEnvironment } from '../utils/api';
import { formatBytes, getDisplayVersionString } from '../utils/formatters';
import { getCanonicalDisplayVersion, getCanonicalVersion } from '../utils/version';
import { useI18n } from '../i18n';
import { resolveThemeLocalizedText, useThemeCatalog } from '../themes';
import { ThemeNavPosition } from '../themes/types';

function getThemeLayoutLabelKey(pos?: ThemeNavPosition): string {
  switch (pos) {
    case 'left-hud':
      return 'themes.layout_left_hud';
    case 'left-sidebar':
      return 'themes.layout_left_sidebar';
    case 'right-rail':
      return 'themes.layout_right_rail';
    case 'top-bar':
      return 'themes.layout_top_bar';
    case 'top-tabs':
      return 'themes.layout_top_tabs';
    case 'corner-dock':
      return 'themes.layout_corner_dock';
    default:
      return 'themes.layout_bottom_dock';
  }
}

type MoreSubTab = 'updates' | 'themes' | 'console' | 'devices' | 'manual' | 'dex';

function resolveMoreSubTab(hint?: string): MoreSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (['themes', 'temas', 'apariencia', 'appearance', 'matrix'].includes(h)) return 'themes';
  if (['console', 'consola', 'terminal', 'shell', 'stdout'].includes(h)) return 'console';
  if (['updates', 'actualizaciones', 'logs', 'sistema', 'version', 'settings', 'ajustes', 'health', 'salud'].includes(h)) return 'updates';
  if (['devices', 'dispositivos', 'nodos', 'security', 'seguridad'].includes(h)) return 'devices';
  if (['manual', 'manual.html', 'readme', 'ayuda', 'docs'].includes(h)) return 'manual';
  if (h === 'dex') return 'dex';
  return undefined;
}

interface MoreViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onChangeTheme: (next: ThemeMode) => void;
  initialSubTab?: string;
  navTick?: number;
  onRefreshMetrics: () => void;
  onVersionChange?: (ver: VersionInfo) => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onSubTabChange?: (sub: string) => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  metrics,
  theme,
  onChangeTheme,
  initialSubTab,
  navTick,
  onRefreshMetrics,
  onVersionChange,
  onNotify,
  onSubTabChange,
}) => {
  const { locale, supportedLocales, localeNames, otaSource, isSyncingLanguages, setLocale, syncFromGitHub, t } = useI18n();
  const {
    themes: themeCatalog,
    activeThemeId,
    selectTheme,
    otaSource: themesOtaSource,
    syncedAt: themesSyncedAt,
    packVersion: themesPackVersion,
    packFile: themesPackFile,
    isModeLocked,
    getThemeBackdropUrl,
    isSyncingThemes,
    syncThemesFromGitHub,
  } = useThemeCatalog();
  const { isUbuntuNative, isAndroidNative } = detectNativeEnvironment();
  const installedAndroidVersion = useMemo(() => {
    if (!isAndroidNative || typeof window === 'undefined') return '';
    const tel = window.__RECURSOS_DEVICE_TELEMETRY__ as { app_version?: string; client_version?: string } | undefined;
    const raw = String(tel?.client_version || tel?.app_version || '').trim().replace(/^v/i, '');
    if (raw) return raw;
    const uaMatch = (navigator.userAgent || '').match(/RecursosCockpit-Android\/([0-9.]+)/i);
    return uaMatch ? uaMatch[1] : '';
  }, [isAndroidNative]);
  const [subTab, setSubTab] = useState<MoreSubTab>(() => resolveMoreSubTab(initialSubTab) || 'updates');

  const handleSelectSubTab = (id: MoreSubTab) => {
    setSubTab(id);
    onSubTabChange?.(id);
  };
  const manualIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const langPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!langPickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLangPickerOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) {
        setLangPickerOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [langPickerOpen]);

  const filteredLocales = useMemo(() => {
    const q = langSearch.trim().toLowerCase();
    if (!q) return supportedLocales;
    return supportedLocales.filter((loc) => {
      const displayName = (localeNames[loc] || loc).toLowerCase();
      return loc.toLowerCase().includes(q) || displayName.includes(q);
    });
  }, [langSearch, supportedLocales, localeNames]);

  useEffect(() => {
    try {
      manualIframeRef.current?.contentWindow?.postMessage({ type: 'RECURSOS_THEME', theme, locale }, '*');
    } catch {
      // ignore cross-origin frame message errors
    }
  }, [theme, locale]);

  // Updates state
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(metrics?.version_info ?? null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateOutput, setUpdateOutput] = useState('');
  const [showTechUpdate, setShowTechUpdate] = useState(() => initialSubTab?.toLowerCase() === 'logs');
  const [sysLogs, setSysLogs] = useState<SystemErrorLogEntry[]>([]);
  const [logsMeta, setLogsMeta] = useState<SystemErrorsSummary | null>(metrics?.system_errors_summary ?? null);
  const [acknowledgingLogs, setAcknowledgingLogs] = useState(false);
  const [simplifyingFaults, setSimplifyingFaults] = useState(false);
  const [aiFaultInsights, setAiFaultInsights] = useState<Record<string, AiSystemFaultInsight>>(
    () => metrics?.system_errors_summary?.ai_fault_insights ?? {}
  );
  const [aiFaultHistory, setAiFaultHistory] = useState<AiSystemFaultInsight[]>(
    () => metrics?.system_errors_summary?.ai_fault_history ?? []
  );

  useEffect(() => {
    const incomingInsights = metrics?.system_errors_summary?.ai_fault_insights;
    if (incomingInsights && Object.keys(incomingInsights).length > 0) {
      setAiFaultInsights((prev) => ({ ...prev, ...incomingInsights }));
    }
    const incomingHist = metrics?.system_errors_summary?.ai_fault_history;
    if (Array.isArray(incomingHist) && incomingHist.length > 0) {
      setAiFaultHistory(incomingHist);
    }
  }, [metrics?.system_errors_summary?.ai_fault_insights, metrics?.system_errors_summary?.ai_fault_history]);

  useEffect(() => {
    const mapped = resolveMoreSubTab(initialSubTab);
    if (mapped) {
      setSubTab(mapped);
      if (initialSubTab?.toLowerCase() === 'logs') {
        setShowTechUpdate(true);
      }
    }
  }, [initialSubTab, navTick]);

  // Devices state
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [expandedDevId, setExpandedDevId] = useState<string | null>(null);

  // DeX USB state (Ubuntu Native only)
  const [dexStatus, setDexStatus] = useState<DexStatusPayload | null>(null);
  const [dexResolution, setDexResolution] = useState('1920x1080');
  const [dexFps, setDexFps] = useState(60);
  const [dexFullscreen, setDexFullscreen] = useState(false);

  // GitHub Native Releases state (Ubuntu .deb & Android .apk decoupled from server version)
  const [githubReleases, setGithubReleases] = useState<GithubNativeReleasesPayload | null>(null);
  const [loadingGithubReleases, setLoadingGithubReleases] = useState(false);
  const [downloadingDeb, setDownloadingDeb] = useState(false);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [apkSavedPath, setApkSavedPath] = useState('');

  const loadGithubReleases = useCallback(async (force = false) => {
    setLoadingGithubReleases(true);
    const res = await apiFetchJson<GithubNativeReleasesPayload>(
      `/api/native/github-releases${force ? '?refresh=1' : ''}`
    );
    setLoadingGithubReleases(false);
    if (res.ok && res.data) {
      setGithubReleases(res.data);
    }
  }, []);

  const loadVersion = useCallback(async (force = false) => {
    setCheckingUpdate(true);
    const res = await apiFetchJson<VersionInfo>(`/api/version${force ? '?refresh=1' : ''}`);
    setCheckingUpdate(false);
    if (res.ok && res.data) {
      setVersionInfo(res.data);
      onVersionChange?.(res.data);
    }
  }, [onVersionChange]);

  const loadDevices = useCallback(async () => {
    const res = await apiFetchJson<TrustedDevice[]>('/api/auth/devices');
    if (res.ok && Array.isArray(res.data)) setDevices(res.data);
  }, []);

  const loadDex = useCallback(async () => {
    if (!isUbuntuNative) return;
    const res = await apiFetchJson<DexStatusPayload>('/api/dex/status');
    if (res.ok && res.data) setDexStatus(res.data);
  }, [isUbuntuNative]);

  const loadLogs = useCallback(async () => {
    const res = await apiFetchJson<{
      logs?: SystemErrorLogEntry[];
      total_errors?: number;
      log_errors_count?: number;
      failed_units_count?: number;
      failed_units?: Array<FailedSystemdUnit | string>;
      ack_ts?: number | null;
      ack_time_str?: string | null;
      ai_fault_insights?: Record<string, AiSystemFaultInsight>;
      ai_fault_history?: AiSystemFaultInsight[];
    }>('/api/system/logs?limit=30&refresh=1');
    if (res.ok && res.data) {
      if (Array.isArray(res.data.logs)) setSysLogs(res.data.logs);
      if (res.data.ai_fault_insights) {
        setAiFaultInsights((prev) => ({ ...prev, ...res.data!.ai_fault_insights }));
      }
      if (Array.isArray(res.data.ai_fault_history)) {
        setAiFaultHistory(res.data.ai_fault_history);
      }
      setLogsMeta({
        total: res.data.total_errors,
        total_errors: res.data.total_errors,
        log_errors_count: res.data.log_errors_count,
        failed_units_count: res.data.failed_units_count,
        failed_units: res.data.failed_units,
        ack_ts: res.data.ack_ts,
        ack_time_str: res.data.ack_time_str,
        ai_fault_insights: res.data.ai_fault_insights,
        ai_fault_history: res.data.ai_fault_history,
      });
    }
  }, []);

  const handleSimplifyFaultsWithAi = async () => {
    setSimplifyingFaults(true);
    const effSummary = logsMeta || metrics?.system_errors_summary;
    const res = await apiFetchJson<AiSimplifyFaultsResponse>('/api/system/logs/ai-simplify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logs: sysLogs,
        failed_units: effSummary?.failed_units ?? [],
        locale,
      }),
    });
    setSimplifyingFaults(false);
    if (res.ok && res.data?.status === 'ok') {
      if (res.data.ai_fault_insights) {
        setAiFaultInsights((prev) => ({ ...prev, ...res.data!.ai_fault_insights }));
      }
      if (Array.isArray(res.data.ai_fault_history)) {
        setAiFaultHistory(res.data.ai_fault_history);
      }
      onNotify(
        t('more.ai_fault_done_toast', {
          cached: res.data.cached_count ?? 0,
          fresh: res.data.newly_analyzed_count ?? 0,
        })
      );
      await loadLogs();
      onRefreshMetrics();
    } else {
      const errMsg =
        res.data?.error_key === 'network.ai_error_missing_key'
          ? t('network.ai_error_missing_key')
          : res.data?.error || res.error || t('more.ack_logs_err');
      onNotify(errMsg, true);
    }
  };

  const handleAckSystemLogs = async () => {
    setAcknowledgingLogs(true);
    const res = await apiFetchJson<{
      success?: boolean;
      message?: string;
      system_errors_summary?: SystemErrorsSummary;
    }>('/api/system/logs/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setAcknowledgingLogs(false);
    if (res.ok && res.data?.success !== false) {
      if (res.data?.system_errors_summary) {
        setLogsMeta(res.data.system_errors_summary);
      }
      setSysLogs([]);
      onNotify(res.data?.message || t('more.ack_logs_ok'));
      await loadLogs();
      onRefreshMetrics();
    } else {
      onNotify(res.error || t('more.ack_logs_err'), true);
    }
  };

  useEffect(() => {
    const incoming = metrics?.version_info;
    if (!incoming) return;
    setVersionInfo((prev) => {
      if (!prev) return incoming;
      if (prev.ubuntu_native_bridge && !incoming.ubuntu_native_bridge) {
        const nextServerVer = incoming.current_version || prev.server_version;
        if (nextServerVer && nextServerVer !== prev.server_version) {
          return {
            ...prev,
            server_version: nextServerVer,
            server_display_version: incoming.display_version || prev.server_display_version,
          };
        }
        return prev;
      }
      const nextCommits =
        Array.isArray(incoming.recent_commits) && incoming.recent_commits.length > 0
          ? incoming.recent_commits
          : prev.recent_commits;
      return {
        ...prev,
        ...incoming,
        recent_commits: nextCommits,
      };
    });
  }, [metrics?.version_info]);

  useEffect(() => {
    if (subTab === 'updates') {
      void loadVersion(false);
      void loadGithubReleases(false);
      void loadLogs();
    } else if (subTab === 'devices') {
      void loadDevices();
    } else if (subTab === 'dex') {
      void loadDex();
    }
  }, [subTab, loadVersion, loadGithubReleases, loadLogs, loadDevices, loadDex]);

  const activeVer = versionInfo || metrics?.version_info;
  const displayVer = getCanonicalDisplayVersion(activeVer);
  const remoteDisplayVer = activeVer?.remote_display_version || getDisplayVersionString(activeVer?.remote_version);
  const prevAutoRunningRef = useRef(false);

  useEffect(() => {
    const running = Boolean(activeVer?.auto_install_in_progress);
    if (prevAutoRunningRef.current && !running) {
      onRefreshMetrics();
      void loadVersion(false);
    }
    prevAutoRunningRef.current = running;

    if (subTab !== 'updates' || !running) return;
    const pollId = window.setInterval(() => {
      void loadVersion(false);
    }, 2500);
    return () => window.clearInterval(pollId);
  }, [subTab, activeVer?.auto_install_in_progress, loadVersion, onRefreshMetrics]);

  const handleApplyUpdate = async () => {
    setInstallingUpdate(true);
    const res = await apiFetchJson<{
      success?: boolean;
      already_running?: boolean;
      deb_installed?: boolean;
      web_synced?: boolean;
      code_updated?: boolean;
      restarting?: boolean;
      relaunching?: boolean;
      message?: string;
      output?: string;
      version_info?: VersionInfo;
    }>('/api/system/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    // Sincronizar también el diccionario de idiomas y el catálogo de temas directamente desde GitHub
    void syncFromGitHub();
    void syncThemesFromGitHub();
    setInstallingUpdate(false);
    if (res.data?.output) setUpdateOutput(res.data.output);
    if (res.data?.version_info) {
      setVersionInfo(res.data.version_info);
      onVersionChange?.(res.data.version_info);
    }
    if (res.data?.already_running) {
      onNotify(res.data?.message || t('more.auto_in_progress'));
      void loadVersion(false);
      return;
    }
    if (!res.ok || res.data?.success === false || res.data?.deb_installed === false) {
      if (res.data?.output) setShowTechUpdate(true);
    }
    if (res.ok && res.data?.success !== false) {
      onNotify(res.data?.message || t('more.update_checked_ok'));
      onRefreshMetrics();
      if (res.data?.relaunching) {
        onNotify(res.data?.message || t('more.update_restarting'));
      } else if (res.data?.restarting || res.data?.web_synced || res.data?.code_updated) {
        const delayMs = res.data?.restarting ? 2500 : 900;
        setTimeout(() => {
          window.location.reload();
        }, delayMs);
      } else {
        void loadVersion(true);
      }
    } else {
      onNotify(res.error || res.data?.message || t('more.update_failed'), true);
    }
  };

  const handleToggleAutoUpdate = async () => {
    const next = !(activeVer?.auto_install_enabled ?? true);
    const res = await apiFetchJson<{
      auto_install_enabled?: boolean;
      auto_install_in_progress?: boolean;
      status?: string;
      version_info?: VersionInfo;
    }>('/api/system/auto-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) {
      if (res.data?.version_info) {
        setVersionInfo(res.data.version_info);
        onVersionChange?.(res.data.version_info);
      } else {
        setVersionInfo((prev) => {
          if (!prev) return prev;
          const updated: VersionInfo = {
            ...prev,
            auto_install_enabled: res.data?.auto_install_enabled ?? next,
            auto_install_in_progress: res.data?.auto_install_in_progress ?? prev.auto_install_in_progress,
            auto_install_status:
              res.data?.status ||
              (next ? t('more.auto_enabled_status') : t('more.auto_paused_status')),
          };
          onVersionChange?.(updated);
          return updated;
        });
      }
      onNotify(next ? t('more.auto_on_toast') : t('more.auto_off_toast'));
      if (next) {
        setTimeout(() => {
          void loadVersion(false);
          onRefreshMetrics();
        }, 1200);
      }
    } else {
      onNotify(res.error || t('more.update_failed'), true);
    }
  };

  const handleSaveAlias = async (devId: string) => {
    const res = await apiFetchJson('/api/auth/rename-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: devId, alias: aliasDraft.trim() }),
    });
    if (res.ok) {
      setEditingId(null);
      onNotify(t('more.name_saved'));
      void loadDevices();
    } else {
      onNotify(res.error || t('more.name_err'), true);
    }
  };

  const handleRevokeDevice = async (devId: string) => {
    const res = await apiFetchJson('/api/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: devId }),
    });
    if (res.ok) {
      onNotify(t('more.device_revoked'));
      void loadDevices();
    }
  };

  const handleRevokeAllOthers = async () => {
    const res = await apiFetchJson<{ revoked_count?: number }>('/api/auth/revoke_all_others', { method: 'POST' });
    if (res.ok) {
      onNotify(t('more.devices_revoked_count', { count: res.data?.revoked_count ?? 0 }));
      void loadDevices();
    }
  };

  const handleDexAction = async (start: boolean, serial?: string) => {
    const res = await apiFetchJson<{ success?: boolean; session_running?: boolean; error?: string }>(
      start ? '/api/dex/start' : '/api/dex/stop',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: serial || '', resolution: dexResolution, max_fps: dexFps, fullscreen: dexFullscreen }),
      }
    );
    if (res.ok && res.data?.success) {
      onNotify(start ? t('more.dex_started') : t('more.dex_stopped'));
      void loadDex();
    } else {
      onNotify(res.data?.error || res.error || t('more.dex_err'), true);
    }
  };

  const triggerDirectDownload = (url: string, fallbackHref: string) => {
    const clean = String(url || '').trim();
    const safeUrl = clean.startsWith('https://') ? clean : fallbackHref;
    const anchor = document.createElement('a');
    anchor.href = safeUrl;
    anchor.rel = 'noopener noreferrer';
    anchor.setAttribute('download', '');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleDownloadGithubDeb = async () => {
    const ubuntuNativeBridge = isUbuntuNative || Boolean(githubReleases?.is_ubuntu_native);
    if (ubuntuNativeBridge) {
      setDownloadingDeb(true);
      const res = await apiFetchJson<{ ok?: boolean; message?: string; error?: string; relaunching?: boolean }>(
        '/api/native/download-deb',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      setDownloadingDeb(false);
      if (res.ok && res.data?.ok !== false) {
        onNotify(res.data?.message || t('updates.native_deb_installed_toast'));
        void loadGithubReleases(true);
      } else {
        onNotify(res.data?.error || res.data?.message || res.error || t('updates.native_deb_error_toast'), true);
      }
      return;
    }
    triggerDirectDownload(githubReleases?.deb?.download_url || '', '/download/recursos-cockpit.deb');
  };

  const handleDownloadGithubApk = async () => {
    const ubuntuNativeBridge = isUbuntuNative || Boolean(githubReleases?.is_ubuntu_native);
    if (ubuntuNativeBridge) {
      setDownloadingApk(true);
      setApkSavedPath('');
      const res = await apiFetchJson<{
        ok?: boolean;
        message?: string;
        saved_path?: string;
        downloads_dir?: string;
        error?: string;
      }>('/api/native/download-apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setDownloadingApk(false);
      if (res.ok && res.data?.ok !== false) {
        const saved = res.data?.saved_path || res.data?.downloads_dir || '';
        setApkSavedPath(saved);
        onNotify(res.data?.message || t('updates.native_apk_saved_toast', { path: saved }));
      } else {
        onNotify(res.data?.error || res.data?.message || res.error || t('updates.native_apk_error_toast'), true);
      }
      return;
    }
    triggerDirectDownload(githubReleases?.apk?.download_url || '', '/download/recursos-cockpit.apk');
  };

  return (
    <div className="space-y-[clamp(0.85rem,1.8dvh,1.25rem)]">
      {/* Sub-navigation auto-wrapping fluid bar (zero clipped tabs) */}
      <LayoutGroup id="more-subtabs">
        <div className="cockpit-segmented cockpit-subtabs-bar">
          {[
            { id: 'updates' as const, label: t('more.subtabs.updates'), icon: <GitCommit className="h-4 w-4" /> },
            { id: 'themes' as const, label: t('more.subtabs.themes'), icon: <Palette className="h-4 w-4" /> },
            { id: 'console' as const, label: t('more.subtabs.console'), icon: <Terminal className="h-4 w-4" /> },
            { id: 'devices' as const, label: t('more.subtabs.devices'), icon: <ShieldCheck className="h-4 w-4" /> },
            { id: 'manual' as const, label: t('more.subtabs.manual'), icon: <BookOpen className="h-4 w-4" /> },
            ...(isUbuntuNative
              ? [{ id: 'dex' as const, label: t('more.subtabs.dex'), icon: <Usb className="h-4 w-4" /> }]
              : []),
          ].map((tab) => {
            const active = subTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                type="button"
                onClick={() => handleSelectSubTab(tab.id)}
                className={`cockpit-subtab-btn relative inline-flex items-center justify-center rounded-xl font-semibold transition-colors ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="more-subtab-pill" className="rounded-xl" />}
                <span className="relative z-10 inline-flex items-center gap-[clamp(0.3rem,0.5vw,0.5rem)]">
                  {tab.icon}
                  <span>{tab.label}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </LayoutGroup>

      <ViewStage tabKey={subTab}>
      {/* 1. Actualizaciones y aspecto (Selector de Tema Claro/Oscuro e Idioma integrado aquí) */}
      {subTab === 'updates' && (
        <div className="space-y-4">
          {/* Theme & Spreadsheet Dictionary Switcher */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('more.appearance_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('more.appearance_desc')}
                </p>
              </div>
              <LayoutGroup id="theme-switcher">
                <div className="cockpit-subtile inline-flex items-center gap-1 p-1 shrink-0">
                  {(['light', 'dark'] as const).map((mode) => {
                    const active = theme === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onChangeTheme(mode)}
                        className={`relative inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                          active
                            ? 'text-sky-700 dark:text-sky-300'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                        }`}
                      >
                        {active && <MorphPill layoutId="theme-switcher-pill" className="rounded-lg" />}
                        <span className="relative z-10 inline-flex items-center gap-2">
                          {mode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                          <span>{mode === 'light' ? t('more.theme_light') : t('more.theme_dark')}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="inline-flex items-center gap-1.5 font-display text-sm font-semibold text-slate-900 dark:text-white">
                    <Languages className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                    <span>{t('more.language_label')}</span>
                  </h3>
                  <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold">
                    {t('more.language_columns_count', { count: supportedLocales.length })}
                  </span>
                  <span className="cockpit-pill-emerald rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold">
                    {otaSource === 'github' ? t('more.language_ota_github') : t('more.language_ota_local')}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t('more.language_desc')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="sync-languages-btn"
                  disabled={isSyncingLanguages}
                  onClick={async () => {
                    const res = await syncFromGitHub();
                    if (res.ok) {
                      onNotify(t('more.language_synced', { count: res.localesCount }));
                    } else {
                      onNotify(t('more.language_sync_error'), true);
                    }
                  }}
                  className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:text-sky-700 disabled:opacity-60 dark:text-slate-200 dark:hover:text-sky-300 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncingLanguages ? 'animate-spin' : ''}`} />
                  <span>{isSyncingLanguages ? t('more.language_syncing') : t('more.language_sync_btn')}</span>
                </button>
                <div ref={langPickerRef} className="relative w-full sm:w-auto">
                  <button
                    type="button"
                    data-testid="language-picker-btn"
                    aria-haspopup="listbox"
                    aria-expanded={langPickerOpen}
                    aria-label={t('more.language_select_aria')}
                    onClick={() => {
                      setLangPickerOpen((o) => !o);
                      setLangSearch('');
                    }}
                    className="cockpit-subtile inline-flex min-h-[40px] w-full sm:w-auto sm:min-w-[200px] items-center justify-between gap-2.5 px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:border-sky-400/70 dark:text-slate-100"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className="cockpit-pill-cyan rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">
                        {locale}
                      </span>
                      <span className="truncate">{localeNames[locale] || locale.toUpperCase()}</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${langPickerOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {langPickerOpen && (
                      <motion.div
                        data-cockpit-scroll-contain="true"
                        initial={{ opacity: 0, y: 6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={COCKPIT_SPRING}
                        className="cockpit-bento absolute left-0 right-0 sm:left-auto sm:right-0 z-40 mt-2 sm:w-[clamp(240px,26vw,340px)] overflow-hidden p-2.5 shadow-2xl"
                      >
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <input
                            type="search"
                            data-testid="language-search-input"
                            value={langSearch}
                            onChange={(e) => setLangSearch(e.target.value)}
                            placeholder={t('more.language_search_placeholder')}
                            autoFocus
                            className="cockpit-subtile min-h-[36px] w-full pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
                          />
                        </div>
                        <div
                          role="listbox"
                          aria-label={t('more.language_label')}
                          data-cockpit-scroll-contain="true"
                          className="cockpit-scroll-panel mt-2 space-y-1 overflow-y-auto overscroll-contain pr-0.5"
                        >
                          {filteredLocales.length === 0 ? (
                            <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                              {t('more.language_no_results', { query: langSearch })}
                            </p>
                          ) : (
                            filteredLocales.map((loc) => {
                              const active = locale === loc;
                              return (
                                <button
                                  key={loc}
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  data-lang-option={loc}
                                  onClick={() => {
                                    setLocale(loc);
                                    setLangPickerOpen(false);
                                    setLangSearch('');
                                  }}
                                  className={`flex min-h-[38px] w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors ${
                                    active
                                      ? 'cockpit-pill-cyan font-semibold'
                                      : 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-800/70'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className="cockpit-subtile inline-flex w-8 shrink-0 items-center justify-center rounded-md py-0.5 font-mono text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
                                      {loc}
                                    </span>
                                    <span className="truncate">{localeNames[loc] || loc.toUpperCase()}</span>
                                  </span>
                                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </section>

          {/* Unified App / Server / GitHub Updater */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {isUbuntuNative ? t('more.updates_native') : t('more.updates_github')}
                  </h2>
                  <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold">
                    v{displayVer}
                  </span>
                  {activeVer?.auto_install_in_progress && (
                    <span className="cockpit-pill-emerald inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>{t('more.auto_in_progress')}</span>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeVer?.update_summary
                    ? activeVer.update_summary
                    : activeVer?.update_available
                      ? t('more.new_version_available', { ver: remoteDisplayVer })
                      : activeVer?.ahead_of_remote
                        ? t('more.ahead_of_repo')
                        : t('more.up_to_date')}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeVer?.auto_install_status ||
                    (activeVer?.auto_install_enabled === false
                      ? t('more.auto_paused_status')
                      : t('more.auto_enabled_status'))}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                <button
                  type="button"
                  onClick={handleToggleAutoUpdate}
                  className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                    activeVer?.auto_install_enabled
                      ? 'cockpit-pill-emerald'
                      : 'cockpit-subtile text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {activeVer?.auto_install_enabled ? t('more.auto_on') : t('more.auto_off')}
                </button>
                <button
                  type="button"
                  disabled={checkingUpdate}
                  onClick={() => loadVersion(true)}
                  className="cockpit-subtile inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                  <span>{t('more.check_btn')}</span>
                </button>
                <button
                  type="button"
                  disabled={installingUpdate || Boolean(activeVer?.auto_install_in_progress)}
                  onClick={handleApplyUpdate}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-50 ${
                    activeVer?.effective_update_available || activeVer?.update_available
                      ? 'cockpit-btn-accent'
                      : 'cockpit-subtile text-slate-800 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {installingUpdate || activeVer?.auto_install_in_progress
                      ? t('more.updating_btn')
                      : activeVer?.update_action_label || t('more.update_now_btn')}
                  </span>
                </button>
              </div>
            </div>

            {(activeVer?.ubuntu_native_bridge || activeVer?.app_version || activeVer?.server_version) && (
              <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-2.5">
                <div className="cockpit-subtile min-w-0 px-3 py-2.5">
                  <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {t('more.app_ubuntu_card')}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-900 dark:text-white">
                    v{getDisplayVersionString(activeVer.app_version || activeVer.current_version, activeVer.app_display_version)}
                    {activeVer.app_above_github && (
                      <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        {t('more.above_github')}
                      </span>
                    )}
                  </p>
                </div>
                <div
                  className={`min-w-0 rounded-xl px-3 py-2.5 ${
                    activeVer.server_needs_update
                      ? 'cockpit-pill-cyan'
                      : 'cockpit-subtile'
                  }`}
                >
                  <p className="truncate text-[10px] font-medium uppercase tracking-wider opacity-75">
                    {t('more.local_web_card')}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs font-semibold">
                    {activeVer.server_reachable === false
                      ? t('more.no_connection')
                      : `v${getDisplayVersionString(
                          activeVer.server_version || activeVer.current_version,
                          activeVer.server_display_version
                        )}`}
                    {activeVer.server_needs_update && (
                      <span className="ml-1.5 text-[10px] font-medium text-sky-600 dark:text-sky-300">
                        {t('more.updatable')}
                      </span>
                    )}
                  </p>
                </div>
                <div
                  className={`min-w-0 rounded-xl px-3 py-2.5 ${
                    activeVer.github_above_app || activeVer.github_above_server
                      ? 'cockpit-pill-emerald'
                      : 'cockpit-subtile'
                  }`}
                >
                  <p className="truncate text-[10px] font-medium uppercase tracking-wider opacity-75">
                    {t('more.github_official_card')}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs font-semibold">
                    {remoteDisplayVer && remoteDisplayVer !== '0.0.0' ? `v${remoteDisplayVer}` : t('more.no_access')}
                  </p>
                </div>
              </div>
            )}

            {activeVer?.recent_commits && activeVer.recent_commits.length > 0 && (
              <div className="mt-5 border-t border-slate-200/70 pt-4 dark:border-slate-800">
                <p className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t('more.latest_changes')}
                </p>
                <div className="space-y-2">
                  {activeVer.recent_commits.slice(0, 5).map((c, idx) => (
                    <div
                      key={`${c.sha || idx}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="text-slate-800 dark:text-slate-200">{c.message || t('more.update_fallback')}</span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {c.short_sha || c.sha?.slice(0, 7) || ''} {c.date ? `· ${c.date}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowTechUpdate((v) => !v)}
              className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {showTechUpdate ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span>{t('equipment.technical_details')}</span>
            </button>

            {showTechUpdate && (
              <div className="mt-3 space-y-3 border-t border-slate-200/70 pt-3 text-xs font-mono text-slate-600 dark:border-slate-800 dark:text-slate-300">
                <div>
                  {t('more.internal_version_row', {
                    version: activeVer?.current_version || activeVer?.version || getCanonicalVersion(),
                    local: activeVer?.local_commit || activeVer?.local_hash || 'local',
                    remote: activeVer?.remote_commit || activeVer?.remote_hash || '--',
                  })}
                </div>
                {updateOutput && (
                  <pre
                    data-cockpit-scroll-contain="true"
                    className="cockpit-subtile cockpit-scroll-panel overflow-y-auto overscroll-contain whitespace-pre-wrap p-3 text-[11px]"
                  >
                    {updateOutput}
                  </pre>
                )}
                {sysLogs.length > 0 && (
                  <div
                    data-cockpit-scroll-contain="true"
                    className="cockpit-subtile cockpit-scroll-panel overflow-y-auto overscroll-contain p-3 text-[11px]"
                  >
                    <p className="mb-1 font-semibold">{t('more.system_warnings_title')}</p>
                    {sysLogs.slice(0, 12).map((log, idx) => (
                      <div key={idx} className="truncate">
                        [{log.timestamp || log.time_str || '--'}] {log.unit || log.source || log.category}: {log.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Panel dedicado de Salud y Avisos del Sistema + Simplificador IA con persistencia en recursos_history.db */}
          {(() => {
            const effSummary = logsMeta || metrics?.system_errors_summary;
            const failedUnitsList = effSummary?.failed_units ?? [];
            const failedCount = Number(effSummary?.failed_units_count ?? failedUnitsList.length ?? 0);
            const activeTotal = Number(effSummary?.total_errors ?? effSummary?.total ?? (sysLogs.length + failedCount));
            const ackTimeStr = effSummary?.ack_time_str;
            const isHealthy = activeTotal === 0 && failedCount === 0 && sysLogs.length === 0;
            const mergedInsights: Record<string, AiSystemFaultInsight> = {
              ...(effSummary?.ai_fault_insights ?? {}),
              ...aiFaultInsights,
            };
            const mergedHistory: AiSystemFaultInsight[] =
              aiFaultHistory.length > 0
                ? aiFaultHistory
                : effSummary?.ai_fault_history ?? Object.values(mergedInsights);

            const renderDangerBadge = (level?: string) => {
              const norm = String(level || 'medium').toLowerCase();
              if (norm === 'critical') {
                return (
                  <span className="cockpit-pill-rose rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    {t('more.ai_fault_danger_critical')}
                  </span>
                );
              }
              if (norm === 'high') {
                return (
                  <span className="cockpit-pill-amber rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    {t('more.ai_fault_danger_high')}
                  </span>
                );
              }
              if (norm === 'low') {
                return (
                  <span className="cockpit-pill-emerald rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    {t('more.ai_fault_danger_low')}
                  </span>
                );
              }
              return (
                <span className="cockpit-pill-cyan rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  {t('more.ai_fault_danger_medium')}
                </span>
              );
            };

            return (
              <section className="cockpit-bento overflow-hidden p-5" data-testid="system-health-panel">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isHealthy ? 'cockpit-pill-emerald' : 'cockpit-pill-amber'
                      }`}
                    >
                      {isHealthy ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                        {t('more.system_health_title')}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {isHealthy
                          ? t('more.system_health_clean')
                          : t('more.system_health_issues', { count: Math.max(activeTotal, sysLogs.length + failedCount) })}
                        {ackTimeStr ? ` · ${t('more.ack_logs_since', { time: ackTimeStr })}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {(sysLogs.length > 0 || failedUnitsList.length > 0) && (
                      <button
                        type="button"
                        data-testid="ai-simplify-faults-btn"
                        disabled={simplifyingFaults}
                        onClick={() => void handleSimplifyFaultsWithAi()}
                        className="cockpit-pill-violet inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Sparkles className={`h-3.5 w-3.5 ${simplifyingFaults ? 'animate-spin' : ''}`} />
                        <span>
                          {simplifyingFaults ? t('more.ai_fault_simplifying') : t('more.ai_fault_simplify_btn')}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadLogs()}
                      className="cockpit-subtile inline-flex min-h-[40px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>{t('network.refresh')}</span>
                    </button>
                    {(sysLogs.length > 0 || activeTotal > failedCount) && (
                      <button
                        type="button"
                        disabled={acknowledgingLogs}
                        onClick={() => void handleAckSystemLogs()}
                        className="cockpit-btn-accent inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{acknowledgingLogs ? t('more.acking_logs_btn') : t('more.ack_logs_btn')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {failedUnitsList.length > 0 && (
                  <div className="cockpit-pill-amber mt-4 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold">
                      {t('more.failed_units_label', { count: failedUnitsList.length })}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {failedUnitsList.map((u, idx) => {
                        const unitObj = typeof u === 'string' ? { unit: u } : u;
                        const label = unitObj.unit;
                        const sig = unitObj.signature || '';
                        const insight = unitObj.ai_insight || (sig ? mergedInsights[sig] : undefined);
                        return (
                          <div
                            key={`${label}-${idx}`}
                            className="cockpit-subtile rounded-xl p-3 text-xs text-slate-800 dark:text-slate-100"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-[11px] font-bold text-amber-900 dark:text-amber-200">
                                {label}
                              </span>
                              {insight && renderDangerBadge(insight.danger_level)}
                            </div>
                            {insight ? (
                              <div className="mt-1.5 space-y-1.5">
                                <p className="font-semibold text-slate-900 dark:text-white">{insight.title}</p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-300">{insight.summary}</p>
                                {insight.solution && (
                                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-2.5 py-1.5 text-[11px] text-emerald-950 dark:text-emerald-200">
                                    <span className="font-semibold">{t('more.ai_fault_solution_label')}: </span>
                                    <span>{insight.solution}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              unitObj.description && (
                                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  {unitObj.description}
                                </p>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {sysLogs.length > 0 ? (
                  <div
                    data-cockpit-scroll-contain="true"
                    className="cockpit-scroll-panel mt-4 space-y-2 overflow-y-auto overscroll-contain pr-1 text-xs"
                  >
                    {sysLogs.slice(0, 20).map((log, idx) => {
                      const sig = log.signature || '';
                      const insight = log.ai_insight || (sig ? mergedInsights[sig] : undefined);
                      return (
                        <div key={log.id || `${log.ts || idx}`} className="cockpit-subtile overflow-hidden p-3 space-y-1.5">
                          {insight ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {insight.title}
                                  </span>
                                  {renderDangerBadge(insight.danger_level)}
                                  <span className="cockpit-pill-cyan rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold">
                                    {t('more.ai_fault_cached_badge')}
                                  </span>
                                  {(insight.occurrence_count ?? 1) > 1 && (
                                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                      {t('more.ai_fault_occurrences', { count: insight.occurrence_count ?? 1 })}
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">
                                  [{log.time_str || '--'}] · {log.unit || log.source || 'sys'}
                                </span>
                              </div>
                              <p className="text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-200">
                                {insight.summary}
                              </p>
                              {insight.solution && (
                                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-emerald-950 dark:text-emerald-200">
                                  <span className="font-semibold">{t('more.ai_fault_solution_label')}: </span>
                                  <span>{insight.solution}</span>
                                </div>
                              )}
                              <p className="font-mono text-[10.5px] text-slate-400 dark:text-slate-500 break-all">
                                {log.message}
                              </p>
                            </>
                          ) : (
                            <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 break-all">
                              <span className="text-slate-400 dark:text-slate-500">[{log.time_str || '--'}]</span>{' '}
                              <span className="font-semibold text-slate-800 dark:text-slate-100">
                                {log.unit || log.source || 'sys'}:
                              </span>{' '}
                              <span>{log.message}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {t('more.no_logs_clean')}
                  </p>
                )}

                {mergedHistory.length > 0 && (
                  <div
                    className="mt-5 border-t border-slate-200/70 pt-4 dark:border-slate-800"
                    data-testid="ai-fault-history-list"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div>
                        <h3 className="inline-flex items-center gap-1.5 font-display text-xs font-semibold text-slate-900 dark:text-white">
                          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                          <span>{t('more.ai_fault_history_title')}</span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('more.ai_fault_sub')}
                        </p>
                      </div>
                      <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                        {mergedHistory.length}
                      </span>
                    </div>
                    <div
                      data-cockpit-scroll-contain="true"
                      className="cockpit-scroll-panel cockpit-auto-grid-cards max-h-[320px] overflow-y-auto overscroll-contain pr-1"
                    >
                      {mergedHistory.slice(0, 12).map((item) => (
                        <div key={item.signature} className="cockpit-subtile flex flex-col justify-between gap-2 p-3 text-xs">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {item.title}
                              </span>
                              {renderDangerBadge(item.danger_level)}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                              <span>{item.unit || item.category || 'system'}</span>
                              <span>·</span>
                              <span>{t('more.ai_fault_occurrences', { count: item.occurrence_count ?? 1 })}</span>
                              <span>·</span>
                              <span className="text-sky-600 dark:text-sky-400">{t('more.ai_fault_cached_badge')}</span>
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                              {item.summary}
                            </p>
                          </div>
                          {item.solution && (
                            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-2.5 py-1.5 text-[10.5px] text-emerald-950 dark:text-emerald-200">
                              <span className="font-semibold">{t('more.ai_fault_solution_label')}: </span>
                              <span>{item.solution}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })()}

          {/* Dynamic GitHub Native Builds (Ubuntu .deb & Android .apk — decoupled 1.1.1 lifecycle) */}
          <section className="cockpit-bento p-5" data-testid="github-native-releases-panel">
            <div className="flex flex-col gap-3 border-b border-slate-200/70 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('updates.native_releases_title')}
                  </h2>
                  {githubReleases?.tag_name && (
                    <span className="cockpit-pill-emerald rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold">
                      GitHub {githubReleases.tag_name}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t('updates.native_releases_desc')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {githubReleases?.release_url && (
                  <a
                    href={githubReleases.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cockpit-subtile inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:text-sky-700 dark:text-slate-200 dark:hover:text-sky-300"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>GitHub</span>
                  </a>
                )}
                <button
                  type="button"
                  disabled={loadingGithubReleases}
                  onClick={() => void loadGithubReleases(true)}
                  className="cockpit-subtile inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:text-sky-700 disabled:opacity-50 dark:text-slate-200 dark:hover:text-sky-300 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingGithubReleases ? 'animate-spin' : ''}`} />
                  <span>{t('more.check_btn')}</span>
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Ubuntu .deb Card */}
              <div className="cockpit-subtile flex flex-col justify-between gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="cockpit-pill-cyan inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                      <Laptop className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {t('more.ubuntu_app')}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {githubReleases?.deb?.asset_name || 'recursos-cockpit.deb'}
                        {githubReleases?.deb?.size_bytes
                          ? ` · ${formatBytes(githubReleases.deb.size_bytes)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 font-mono text-[10.5px] tabular-nums">
                    <span className="cockpit-pill-cyan rounded-md px-2 py-0.5 font-semibold">
                      GitHub v{githubReleases?.deb?.version || githubReleases?.local_ubuntu_version || '1.1.1'}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('updates.native_local_ver', {
                        ver: githubReleases?.local_ubuntu_version || '1.1.1',
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isUbuntuNative || githubReleases?.is_ubuntu_native
                      ? t('updates.native_deb_ubuntu_hint')
                      : t('more.ubuntu_app_sub')}
                  </span>
                  <button
                    type="button"
                    data-testid="download-github-deb-btn"
                    disabled={downloadingDeb}
                    onClick={handleDownloadGithubDeb}
                    className="cockpit-btn-accent inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold disabled:opacity-55 cursor-pointer"
                  >
                    {downloadingDeb ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {downloadingDeb
                        ? t('updates.native_deb_installing')
                        : isUbuntuNative || githubReleases?.is_ubuntu_native
                          ? t('updates.native_deb_install_btn')
                          : t('updates.native_deb_download_btn')}
                    </span>
                  </button>
                </div>
              </div>

              {/* Android .apk Card */}
              <div className="cockpit-subtile flex flex-col justify-between gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="cockpit-pill-emerald inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                      <Smartphone className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {t('more.android_app')}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {githubReleases?.apk?.asset_name || 'recursos-cockpit.apk'}
                        {githubReleases?.apk?.size_bytes
                          ? ` · ${formatBytes(githubReleases.apk.size_bytes)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 font-mono text-[10.5px] tabular-nums">
                    <span className="cockpit-pill-emerald rounded-md px-2 py-0.5 font-semibold">
                      GitHub v{githubReleases?.apk?.version || githubReleases?.local_android_version || '1.1.1'}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('updates.native_local_ver', {
                        ver: installedAndroidVersion || githubReleases?.local_android_version || '1.1.1',
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isUbuntuNative || githubReleases?.is_ubuntu_native
                      ? t('updates.native_apk_ubuntu_hint')
                      : t('more.android_app_sub')}
                  </span>
                  <button
                    type="button"
                    data-testid="download-github-apk-btn"
                    disabled={downloadingApk}
                    onClick={handleDownloadGithubApk}
                    className="cockpit-btn-accent inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold disabled:opacity-55 cursor-pointer"
                  >
                    {downloadingApk ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {downloadingApk
                        ? t('updates.native_apk_downloading')
                        : isUbuntuNative || githubReleases?.is_ubuntu_native
                          ? t('updates.native_apk_downloads_btn')
                          : t('updates.native_apk_download_btn')}
                    </span>
                  </button>
                </div>
                {apkSavedPath && (
                  <p className="truncate rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-[10.5px] text-emerald-800 dark:text-emerald-300">
                    {apkSavedPath}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 1b. Catálogo de Temas independientes con paquete único OTA desde GitHub */}
      {subTab === 'themes' && (
        <div className="space-y-4">
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/70 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-slate-900 dark:text-white">
                    <Palette className="h-4 w-4 text-[var(--accent)]" />
                    <span>{t('themes.title')}</span>
                  </h2>
                  <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold">
                    {t('themes.count_badge', { count: themeCatalog.length })}
                  </span>
                  <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                    {t('themes.pack_badge', { ver: themesPackVersion || '2.0.0' })}
                  </span>
                  <span className="cockpit-pill-emerald rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold">
                    {themesOtaSource === 'github' ? t('themes.ota_github') : t('themes.ota_local')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t('themes.subtitle')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <LayoutGroup id="themes-tab-mode-switcher">
                  <div
                    className={`cockpit-subtile inline-flex items-center gap-1 p-1 ${
                      isModeLocked ? 'opacity-65' : ''
                    }`}
                    title={isModeLocked ? t('themes.locked_atmosphere_hint') : undefined}
                  >
                    {(['light', 'dark'] as const).map((modeOpt) => {
                      const active = theme === modeOpt;
                      return (
                        <button
                          key={modeOpt}
                          type="button"
                          disabled={isModeLocked}
                          onClick={() => onChangeTheme(modeOpt)}
                          className={`relative inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                            isModeLocked
                              ? 'cursor-not-allowed'
                              : 'cursor-pointer'
                          } ${
                            active
                              ? 'text-[var(--accent)]'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                          }`}
                        >
                          {active && <MorphPill layoutId="themes-tab-mode-pill" className="rounded-lg" />}
                          <span className="relative z-10 inline-flex items-center gap-1.5">
                            {isModeLocked && active ? (
                              <Lock className="h-3 w-3 opacity-80" />
                            ) : modeOpt === 'light' ? (
                              <Sun className="h-3.5 w-3.5" />
                            ) : (
                              <Moon className="h-3.5 w-3.5" />
                            )}
                            <span>{modeOpt === 'light' ? t('more.theme_light') : t('more.theme_dark')}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </LayoutGroup>

                <button
                  type="button"
                  data-testid="sync-themes-btn"
                  disabled={isSyncingThemes}
                  onClick={async () => {
                    const res = await syncThemesFromGitHub();
                    if (res.ok) {
                      onNotify(t('themes.synced_ok', { count: res.count }));
                    } else {
                      onNotify(t('themes.sync_error'), true);
                    }
                  }}
                  className="cockpit-btn-accent inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold disabled:opacity-60 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncingThemes ? 'animate-spin' : ''}`} />
                  <span>{isSyncingThemes ? t('themes.syncing') : t('themes.sync_btn')}</span>
                </button>
              </div>
            </div>

            {isModeLocked && (
              <div className="mt-3 cockpit-subtile flex items-center gap-2 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">
                <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                <span>{t('themes.locked_atmosphere_hint')}</span>
              </div>
            )}

            <div className="mt-4 cockpit-auto-grid-cards">
              {themeCatalog.map((item) => {
                const isActive = item.id === activeThemeId;
                const itemName = resolveThemeLocalizedText(item.name, locale, item.id);
                const itemDesc = resolveThemeLocalizedText(item.description, locale, '');
                const backdropUrl = getThemeBackdropUrl(item);
                const navPos: ThemeNavPosition = item.layout?.navPosition || 'bottom-dock';
                const layoutLabel = t(getThemeLayoutLabelKey(navPos));
                const isLockedAtmosphere = item.colorModePolicy === 'locked-dark' || item.colorModePolicy === 'locked-light';
                const effectType = item.backgroundEffect?.type || 'none';
                const isAnimated = effectType !== 'none';

                const lightPrev = item.preview?.light || {
                  canvas: item.tokens.light['--bg-canvas'] || '#eaf2e6',
                  surface: item.tokens.light['--surface-bento'] || 'rgba(255,255,255,0.50)',
                  accent: item.tokens.light['--accent'] || '#1e6b38',
                  rain: item.backgroundEffect?.light?.headColor || '#1e6b38',
                };
                const darkPrev = item.preview?.dark || {
                  canvas: item.tokens.dark['--bg-canvas'] || '#061007',
                  surface: item.tokens.dark['--surface-bento'] || 'rgba(11,23,13,0.75)',
                  accent: item.tokens.dark['--accent'] || '#c6f19d',
                  rain: item.backgroundEffect?.dark?.headColor || '#c6f19d',
                };
                const chartDarkPrimary = item.chartPalette?.dark?.primary || darkPrev.accent;
                const chartDarkSecondary = item.chartPalette?.dark?.secondary || item.tokens.dark['--hud-accent-2'] || darkPrev.accent;

                const renderMiniNavWireframe = (accentColor: string) => {
                  if (navPos === 'left-hud' || navPos === 'left-sidebar') {
                    return (
                      <div
                        aria-hidden="true"
                        className="absolute left-1.5 top-2 bottom-2 z-20 flex w-2.5 flex-col justify-center gap-1 rounded-sm p-0.5"
                        style={{ backgroundColor: 'rgba(6, 10, 14, 0.72)', border: `1px solid ${accentColor}88` }}
                      >
                        <span className="h-2 w-full rounded-[1px]" style={{ backgroundColor: accentColor }} />
                        <span className="h-1.5 w-full rounded-[1px] bg-white/40" />
                        <span className="h-1.5 w-full rounded-[1px] bg-white/40" />
                        <span className="h-1.5 w-full rounded-[1px] bg-white/40" />
                      </div>
                    );
                  }
                  if (navPos === 'right-rail') {
                    return (
                      <div
                        aria-hidden="true"
                        className="absolute right-1.5 top-2 bottom-2 z-20 flex w-2.5 flex-col justify-center gap-1 rounded-full p-0.5"
                        style={{ backgroundColor: 'rgba(14, 6, 26, 0.76)', border: `1px solid ${accentColor}99` }}
                      >
                        <span className="h-2 w-full rounded-full" style={{ backgroundColor: accentColor }} />
                        <span className="h-1.5 w-full rounded-full bg-white/40" />
                        <span className="h-1.5 w-full rounded-full bg-white/40" />
                      </div>
                    );
                  }
                  if (navPos === 'top-bar' || navPos === 'top-tabs') {
                    return (
                      <div
                        aria-hidden="true"
                        className="absolute left-2 right-2 top-1.5 z-20 flex h-2.5 items-center gap-1 px-1"
                        style={{ backgroundColor: 'rgba(8, 10, 14, 0.78)', borderBottom: `1px solid ${accentColor}` }}
                      >
                        <span className="h-1 w-4" style={{ backgroundColor: accentColor }} />
                        <span className="h-1 w-3 bg-white/45" />
                        <span className="h-1 w-3 bg-white/45" />
                        <span className="h-1 w-3 bg-white/45" />
                      </div>
                    );
                  }
                  if (navPos === 'corner-dock') {
                    return (
                      <div
                        aria-hidden="true"
                        className="absolute right-2 bottom-1.5 z-20 flex h-2.5 items-center gap-1 rounded-full px-1.5"
                        style={{ backgroundColor: 'rgba(12, 8, 22, 0.80)', border: `1px solid ${accentColor}` }}
                      >
                        <span className="h-1 w-3 rounded-full" style={{ backgroundColor: accentColor }} />
                        <span className="h-1 w-1.5 rounded-full bg-white/45" />
                        <span className="h-1 w-1.5 rounded-full bg-white/45" />
                      </div>
                    );
                  }
                  return (
                    <div
                      aria-hidden="true"
                      className="absolute left-1/2 bottom-1.5 z-20 flex h-2.5 -translate-x-1/2 items-center gap-1 rounded-full px-2"
                      style={{ backgroundColor: 'rgba(10, 18, 12, 0.74)', border: `1px solid ${accentColor}88` }}
                    >
                      <span className="h-1 w-3 rounded-full" style={{ backgroundColor: accentColor }} />
                      <span className="h-1 w-1.5 rounded-full bg-white/45" />
                      <span className="h-1 w-1.5 rounded-full bg-white/45" />
                    </div>
                  );
                };

                return (
                  <motion.div
                    key={item.id}
                    layout
                    className={`cockpit-subtile flex flex-col justify-between gap-4 p-4 transition-all ${
                      isActive ? 'ring-2 ring-[var(--accent)]' : ''
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Visual Preview Canvas: Cinematic Artwork for Game Themes / Dual Light+Dark for Dual Themes */}
                      {isLockedAtmosphere && backdropUrl ? (
                        <div
                          className="relative h-28 overflow-hidden rounded-xl border border-black/15 dark:border-white/15"
                          style={{ backgroundColor: darkPrev.canvas }}
                        >
                          <img
                            src={backdropUrl}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                          <div
                            aria-hidden="true"
                            className="absolute inset-0"
                            style={{ backgroundColor: item.backdrop?.scrimDark || 'rgba(8, 10, 14, 0.42)' }}
                          />
                          {renderMiniNavWireframe(darkPrev.accent)}

                          {/* Translucent HUD sample widget */}
                          <div
                            className={`relative z-10 flex h-full flex-col justify-between p-2.5 ${
                              navPos === 'left-hud' || navPos === 'left-sidebar'
                                ? 'pl-6'
                                : navPos === 'right-rail'
                                  ? 'pr-6'
                                  : navPos === 'top-bar' || navPos === 'top-tabs'
                                    ? 'pt-5'
                                    : ''
                            }`}
                          >
                            <div
                              className="flex flex-1 flex-col justify-between rounded-lg border p-2 backdrop-blur-md"
                              style={{
                                backgroundColor: darkPrev.surface,
                                borderColor: `${darkPrev.accent}55`,
                                color: item.tokens.dark['--text-primary'] || '#f4f7f2',
                              }}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span
                                  className="font-mono text-[9px] font-bold uppercase tracking-wider truncate"
                                  style={{ color: darkPrev.accent }}
                                >
                                  {layoutLabel}
                                </span>
                                <span className="flex items-center gap-1 shrink-0">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: chartDarkPrimary }}
                                  />
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: chartDarkSecondary }}
                                  />
                                </span>
                              </div>

                              {/* Mini themed chart sparkline */}
                              <svg viewBox="0 0 120 26" className="h-6 w-full overflow-visible" aria-hidden="true">
                                <polyline
                                  fill="none"
                                  stroke={chartDarkSecondary}
                                  strokeWidth="1.4"
                                  strokeDasharray="3 2"
                                  opacity="0.7"
                                  points="0,20 20,17 42,19 66,12 88,15 120,9"
                                />
                                <polyline
                                  fill="none"
                                  stroke={chartDarkPrimary}
                                  strokeWidth="2"
                                  points="0,22 18,16 38,18 60,7 84,12 104,5 120,8"
                                />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            {
                              key: 'light',
                              label: t('themes.preview_light'),
                              p: lightPrev,
                              ink: item.tokens.light['--text-primary'] || '#0b1a0c',
                              scrim: item.backdrop?.scrimLight,
                            },
                            {
                              key: 'dark',
                              label: t('themes.preview_dark'),
                              p: darkPrev,
                              ink: item.tokens.dark['--text-primary'] || '#f4f7f2',
                              scrim: item.backdrop?.scrimDark,
                            },
                          ].map((sw) => (
                            <div
                              key={sw.key}
                              className="relative h-28 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 p-2"
                              style={{ backgroundColor: sw.p.canvas }}
                            >
                              {backdropUrl && (
                                <>
                                  <img
                                    src={backdropUrl}
                                    alt=""
                                    aria-hidden="true"
                                    loading="lazy"
                                    className="absolute inset-0 h-full w-full object-cover"
                                  />
                                  {sw.scrim && (
                                    <div
                                      aria-hidden="true"
                                      className="absolute inset-0"
                                      style={{ backgroundColor: sw.scrim }}
                                    />
                                  )}
                                </>
                              )}
                              {effectType === 'matrix-telemetry' && (
                                <div
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 flex justify-around px-1.5 font-mono text-[8px] font-bold leading-tight opacity-85 select-none"
                                  style={{ color: sw.p.rain || sw.p.accent }}
                                >
                                  <span className="flex flex-col">
                                    <span>C</span><span>P</span><span>U</span><span>4</span><span>2</span><span>%</span>
                                  </span>
                                  <span className="flex flex-col pt-2">
                                    <span>5</span><span>1</span><span>°</span><span>C</span><span>R</span><span>A</span>
                                  </span>
                                  <span className="flex flex-col">
                                    <span>W</span><span>A</span><span>N</span><span>↓</span><span>8</span><span>M</span>
                                  </span>
                                  <span className="flex flex-col pt-1">
                                    <span>I</span><span>O</span><span>1</span><span>2</span><span>M</span><span>S</span>
                                  </span>
                                </div>
                              )}
                              {effectType === 'snowfall' && (
                                <div
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 select-none"
                                  style={{
                                    backgroundImage:
                                      'radial-gradient(circle, rgba(255,255,255,0.92) 1.5px, transparent 2px), radial-gradient(circle, rgba(224,242,254,0.8) 1px, transparent 1.5px)',
                                    backgroundSize: '26px 26px, 18px 18px',
                                    backgroundPosition: '4px 6px, 12px 14px',
                                  }}
                                />
                              )}
                              <div
                                className="relative z-10 flex h-full flex-col justify-between rounded-lg border border-black/10 dark:border-white/20 p-2 backdrop-blur-md"
                                style={{ backgroundColor: sw.p.surface, color: sw.ink }}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-mono text-[9px] font-semibold uppercase tracking-wider opacity-85">
                                    {sw.label}
                                  </span>
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: sw.p.accent }}
                                  />
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="h-1.5 flex-1 rounded-full opacity-85"
                                    style={{ backgroundColor: sw.p.accent }}
                                  />
                                  <span className="h-1.5 w-5 rounded-full bg-current opacity-25" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                            {itemName}
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="cockpit-subtile rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                              v{item.version || '1.0.0'}
                            </span>
                            <span className="cockpit-pill-cyan rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold">
                              {isLockedAtmosphere ? t('themes.mode_native_badge') : t('themes.mode_dual_badge')}
                            </span>
                            {isAnimated && (
                              <span className="cockpit-pill-emerald rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold">
                                {t('themes.animated_badge')}
                              </span>
                            )}
                          </div>
                        </div>
                        {itemDesc && (
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            {itemDesc}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                        {layoutLabel} · {themesPackFile || 'themes-pack.rcpack.gz'}
                      </span>
                      {isActive ? (
                        <span className="cockpit-pill-lime inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0">
                          <Check className="h-3.5 w-3.5" />
                          <span>{t('themes.active_badge')}</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            selectTheme(item.id);
                            onNotify(t('themes.applied_toast', { name: itemName }));
                          }}
                          className="cockpit-btn-accent inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                        >
                          <span>{t('themes.apply_btn')}</span>
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-4 cockpit-subtile flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span>{t('themes.ota_hint')}</span>
              {themesSyncedAt ? (
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {new Date(themesSyncedAt * 1000).toLocaleString()}
                </span>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {/* 1c. Consola del servicio en tiempo real (Solo lectura · Retención máx. 24h) */}
      {subTab === 'console' && <ServiceConsoleView onNotify={onNotify} />}

      {/* 2. Dispositivos conectados (Zero-Trust pairing) */}
      {subTab === 'devices' && (
        <section className="cockpit-bento p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {t('more.devices_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('more.devices_sub')}
              </p>
            </div>
            {devices.length > 1 && (
              <button
                type="button"
                onClick={handleRevokeAllOthers}
                className="cockpit-btn-off min-h-[40px] rounded-xl px-3.5 text-xs font-semibold transition-colors"
              >
                {t('more.revoke_others')}
              </button>
            )}
          </div>

          {devices.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              {t('more.devices_empty')}
            </p>
          ) : (
            <div className="mt-4 cockpit-auto-grid-cards !items-start">
              {devices.map((dev) => {
                const isOpen = expandedDevId === dev.id;
                const accessText = dev.full_access ? t('more.native_verified') : t('more.web_verified');
                const tel = (dev.device_telemetry || {}) as Record<string, unknown>;
                const uaLower = String(dev.client_type || dev.client_label || tel.os_distro || '').toLowerCase();
                const isMobileDev =
                  uaLower.includes('android') || uaLower.includes('iphone') || uaLower.includes('ipad') || uaLower.includes('mobile');
                const isUbuntuOrDesktop =
                  uaLower.includes('ubuntu') || uaLower.includes('linux') || uaLower.includes('windows') || uaLower.includes('mac');
                const subtitleParts = [
                  dev.client_label || accessText,
                  dev.app_version ? `v${dev.app_version}` : '',
                  typeof tel.model === 'string' && tel.model && tel.model !== dev.name ? tel.model : '',
                ].filter(Boolean);
                const endpointText = `${dev.connection_mode || 'LAN'} · ${dev.local_ip || dev.last_external_ip || t('more.connected_fallback')}`;

                return (
                  <article key={dev.id} className="cockpit-subtile flex min-w-0 flex-col gap-3 p-4">
                    {/* Header: Device icon + Name/Subtitle + Access Badge */}
                    {editingId === dev.id ? (
                      <div className="flex w-full min-w-0 items-center gap-2">
                        <input
                          type="text"
                          value={aliasDraft}
                          onChange={(e) => setAliasDraft(e.target.value)}
                          className="cockpit-subtile min-h-[36px] min-w-0 flex-1 px-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveAlias(dev.id)}
                          className="cockpit-btn-accent inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{t('more.save_btn')}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span
                            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              dev.full_access ? 'cockpit-pill-violet' : 'cockpit-pill-cyan'
                            }`}
                          >
                            {isMobileDev ? (
                              <Smartphone className="h-4 w-4" />
                            ) : isUbuntuOrDesktop ? (
                              <Laptop className="h-4 w-4" />
                            ) : (
                              <Globe className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p
                                className="truncate text-sm font-semibold text-slate-900 dark:text-white"
                                title={dev.name}
                              >
                                {dev.name}
                              </p>
                              {dev.is_current && (
                                <span className="cockpit-pill-emerald shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">
                                  {t('more.this_device')}
                                </span>
                              )}
                            </div>
                            <p
                              className="truncate text-[11px] text-slate-500 dark:text-slate-400"
                              title={subtitleParts.join(' · ')}
                            >
                              {subtitleParts.join(' · ')}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            dev.full_access ? 'cockpit-pill-violet' : 'cockpit-pill-cyan'
                          }`}
                        >
                          {accessText}
                        </span>
                      </div>
                    )}

                    {/* Structured Network & Visit Telemetry Strip */}
                    <div className="grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-2.5 text-[11px] dark:border-slate-800">
                      <div className="min-w-0">
                        <span
                          className="block truncate font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200"
                          title={endpointText}
                        >
                          {endpointText}
                        </span>
                      </div>
                      <div className="min-w-0 text-right">
                        <span
                          className="block truncate font-mono tabular-nums text-slate-500 dark:text-slate-400"
                          title={`${t('more.last_visit_label')}: ${dev.last_seen || '--'}`}
                        >
                          {dev.last_seen || '--'}
                        </span>
                      </div>
                    </div>

                    {/* Grouped Client Containers if > 1 */}
                    {Array.isArray(dev.clients) && dev.clients.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {dev.clients.slice(0, 4).map((cl, ci) => (
                          <span
                            key={cl.client_key || `${dev.id}-cl-${ci}`}
                            className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-[10px] font-medium ${
                              cl.is_current_client
                                ? 'cockpit-pill-emerald'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300'
                            }`}
                          >
                            {cl.client_label || cl.client_type}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Uniform Action Footer pinned at bottom */}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2.5 dark:border-slate-800">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(dev.id);
                            setAliasDraft(dev.custom_alias || dev.name);
                          }}
                          className="cockpit-subtile min-h-[34px] px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          {t('more.rename_btn')}
                        </button>
                        {!dev.is_current && (
                          <button
                            type="button"
                            onClick={() => handleRevokeDevice(dev.id)}
                            className="cockpit-btn-off inline-flex min-h-[34px] items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>{t('more.disconnect_btn')}</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedDevId(isOpen ? null : dev.id)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white whitespace-nowrap"
                      >
                        <span>{t('equipment.technical_details')}</span>
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {isOpen && (() => {
                      const hasRoot = Boolean(dev.root_access ?? tel.root_access);
                      const rootMethod = String(dev.root_method || tel.root_method || '').trim();
                      const rootLabel = hasRoot
                        ? rootMethod
                          ? t('devices.root_active_method', { method: rootMethod })
                          : t('devices.root_active')
                        : t('devices.root_not_detected');

                      return (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200/70 bg-slate-950/[0.03] p-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-950/40 sm:grid-cols-2">
                            <div className="min-w-0">
                              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                {t('devices.credential_root_label')}
                              </span>
                              <span
                                className={`mt-0.5 inline-flex items-center gap-1 font-mono font-semibold ${
                                  hasRoot
                                    ? 'text-emerald-700 dark:text-[#c6f19d]'
                                    : 'text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {rootLabel}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                {t('devices.credential_cert_label')}
                              </span>
                              <span className="mt-0.5 block truncate font-mono text-slate-700 dark:text-slate-200">
                                {dev.certificate_serial || '--'}
                              </span>
                            </div>
                          </div>
                          <pre
                            data-cockpit-scroll-contain="true"
                            className="cockpit-scroll-panel w-full max-w-full overflow-auto overscroll-contain rounded-xl border border-slate-200/70 bg-slate-950/[0.03] p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
                          >
                            {JSON.stringify(
                              {
                                id: dev.id,
                                certificado: dev.certificate_serial,
                                root_access: hasRoot,
                                root_method: rootMethod || 'none',
                                hardware: dev.device_telemetry,
                              },
                              null,
                              2
                            )}
                          </pre>
                        </div>
                      );
                    })()}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 3. Manual Interactivo */}
      {subTab === 'manual' && (
        <section className="cockpit-bento space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {t('more.manual_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('more.manual_desc')}
              </p>
            </div>
            <a
              href="/manual"
              target="_blank"
              rel="noopener noreferrer"
              className="cockpit-btn-accent inline-flex min-h-[40px] items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-all"
            >
              <span>{t('more.open_fullscreen')}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="cockpit-subtile overflow-hidden">
            <iframe
              ref={manualIframeRef}
              src="/manual"
              title={t('more.manual_iframe_title')}
              onLoad={() => {
                try {
                  manualIframeRef.current?.contentWindow?.postMessage({ type: 'RECURSOS_THEME', theme, locale }, '*');
                } catch {
                  // ignore
                }
              }}
              className="cockpit-manual-frame w-full bg-white dark:bg-[#0a140b]"
            />
          </div>
        </section>
      )}

      {/* 4. Pantalla móvil USB (Solo en Ubuntu nativa; en web/Android mensaje pasivo) */}
      {subTab === 'dex' && (
        <section className="cockpit-bento p-5">
          {!isUbuntuNative ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Lock className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('more.dex_locked_msg')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      {t('more.dex_title')}
                    </h2>
                    <span className="cockpit-pill-emerald rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                      {t('more.dex_native_badge')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('more.dex_desc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadDex}
                  className="cockpit-subtile inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{t('more.scan_usb')}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <label className="block">
                  <span className="text-slate-500 dark:text-slate-400">{t('more.resolution')}</span>
                  <select
                    value={dexResolution}
                    onChange={(e) => setDexResolution(e.target.value)}
                    className="cockpit-subtile mt-1 min-h-[42px] w-full px-3"
                  >
                    <option value="1920x1080">{t('more.res_fhd')}</option>
                    <option value="2560x1440">{t('more.res_qhd')}</option>
                    <option value="1280x720">{t('more.res_hd')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-slate-500 dark:text-slate-400">{t('more.smoothness')}</span>
                  <select
                    value={dexFps}
                    onChange={(e) => setDexFps(Number(e.target.value))}
                    className="cockpit-subtile mt-1 min-h-[42px] w-full px-3"
                  >
                    <option value={60}>{t('more.dex_fps_val', { fps: 60 })}</option>
                    <option value={30}>{t('more.dex_fps_val', { fps: 30 })}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pt-5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dexFullscreen}
                    onChange={(e) => setDexFullscreen(e.target.checked)}
                    className="h-4 w-4 rounded accent-sky-600"
                  />
                  <span className="text-slate-700 dark:text-slate-300">{t('more.fullscreen_opt')}</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {dexStatus?.session_running ? (
                  <button
                    type="button"
                    onClick={() => handleDexAction(false)}
                    className="cockpit-btn-off min-h-[44px] rounded-xl px-5 text-xs font-semibold transition-colors"
                  >
                    {t('more.stop_projection')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDexAction(true, dexStatus?.devices?.[0]?.serial)}
                    className="cockpit-btn-accent min-h-[44px] rounded-xl px-5 text-xs font-semibold transition-all"
                  >
                    {t('more.start_projection')}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}
      </ViewStage>
    </div>
  );
};
