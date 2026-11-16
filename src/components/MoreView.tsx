import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
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
  Languages,
  Laptop,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Usb,
} from 'lucide-react';
import { MorphPill, ViewStage } from './MotionPrimitives';
import {
  DexStatusPayload,
  FailedSystemdUnit,
  MetricsPayload,
  SystemErrorLogEntry,
  SystemErrorsSummary,
  ThemeMode,
  TrustedDevice,
  VersionInfo,
} from '../types/telemetry';
import { apiFetchJson, detectNativeEnvironment } from '../utils/api';
import { getDisplayVersionString } from '../utils/formatters';
import { getCanonicalDisplayVersion, getCanonicalVersion } from '../utils/version';
import { useI18n } from '../i18n';

type MoreSubTab = 'updates' | 'devices' | 'manual' | 'dex';

function resolveMoreSubTab(hint?: string): MoreSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'updates' || h === 'logs' || h === 'sistema' || h === 'version') return 'updates';
  if (h === 'devices' || h === 'dispositivos' || h === 'nodos') return 'devices';
  if (h === 'manual' || h === 'readme' || h === 'ayuda' || h === 'docs') return 'manual';
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
}) => {
  const { locale, supportedLocales, localeNames, setLocale, t } = useI18n();
  const { isUbuntuNative, isNativeApp } = detectNativeEnvironment();
  const [subTab, setSubTab] = useState<MoreSubTab>(() => resolveMoreSubTab(initialSubTab) || 'updates');
  const manualIframeRef = useRef<HTMLIFrameElement | null>(null);

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
    }>('/api/system/logs?limit=30&refresh=1');
    if (res.ok && res.data) {
      if (Array.isArray(res.data.logs)) setSysLogs(res.data.logs);
      setLogsMeta({
        total: res.data.total_errors,
        total_errors: res.data.total_errors,
        log_errors_count: res.data.log_errors_count,
        failed_units_count: res.data.failed_units_count,
        failed_units: res.data.failed_units,
        ack_ts: res.data.ack_ts,
        ack_time_str: res.data.ack_time_str,
      });
    }
  }, []);

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
      void loadLogs();
    } else if (subTab === 'devices') {
      void loadDevices();
    } else if (subTab === 'dex') {
      void loadDex();
    }
  }, [subTab, loadVersion, loadLogs, loadDevices, loadDex]);

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
    }>('/api/system/update', { method: 'POST' });
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
      } else if (res.data?.restarting || res.data?.web_synced) {
        const delayMs = res.data?.restarting ? 2500 : 900;
        setTimeout(() => {
          window.location.reload();
        }, delayMs);
      } else {
        void loadVersion(false);
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

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <LayoutGroup id="more-subtabs">
        <div className="cockpit-segmented flex items-center gap-1.5 overflow-x-auto p-1.5 no-scrollbar">
          {[
            { id: 'updates' as const, label: t('more.subtabs.updates'), icon: <GitCommit className="h-4 w-4" /> },
            { id: 'devices' as const, label: t('more.subtabs.devices'), icon: <ShieldCheck className="h-4 w-4" /> },
            { id: 'manual' as const, label: t('more.subtabs.manual'), icon: <BookOpen className="h-4 w-4" /> },
            ...(isUbuntuNative
              ? [{ id: 'dex' as const, label: t('more.subtabs.dex'), icon: <Usb className="h-4 w-4" /> }]
              : []),
          ].map((tab) => {
            const active = subTab === tab.id;
            return (
              <motion.button
                whileTap={{ scale: 0.97 }}
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`relative inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="more-subtab-pill" className="rounded-xl" />}
                <span className="relative z-10 inline-flex items-center gap-2">
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
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t('more.language_desc')}
                </p>
              </div>
              <LayoutGroup id="lang-switcher">
                <div className="cockpit-subtile inline-flex flex-wrap items-center gap-1 p-1 shrink-0">
                  {supportedLocales.map((loc) => {
                    const active = locale === loc;
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => setLocale(loc)}
                        className={`relative inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
                          active
                            ? 'text-sky-700 dark:text-sky-300'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                        }`}
                      >
                        {active && <MorphPill layoutId="lang-switcher-pill" className="rounded-lg" />}
                        <span className="relative z-10">{localeNames[loc] || loc.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            </div>
          </section>

          {/* Unified App / Server / GitHub Updater */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

                {(activeVer?.ubuntu_native_bridge || activeVer?.app_version || activeVer?.server_version) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="cockpit-subtile px-3 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        {t('more.app_ubuntu_card')}
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-slate-900 dark:text-white">
                        v{getDisplayVersionString(activeVer.app_version || activeVer.current_version, activeVer.app_display_version)}
                        {activeVer.app_above_github && (
                          <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            {t('more.above_github')}
                          </span>
                        )}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl px-3 py-2.5 ${
                        activeVer.server_needs_update
                          ? 'cockpit-pill-cyan'
                          : 'cockpit-subtile'
                      }`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider opacity-75">
                        {t('more.local_web_card')}
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold">
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
                      className={`rounded-xl px-3 py-2.5 ${
                        activeVer.github_above_app || activeVer.github_above_server
                          ? 'cockpit-pill-emerald'
                          : 'cockpit-subtile'
                      }`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider opacity-75">
                        {t('more.github_official_card')}
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold">
                        {remoteDisplayVer && remoteDisplayVer !== '0.0.0' ? `v${remoteDisplayVer}` : t('more.no_access')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                  <pre className="cockpit-subtile max-h-40 overflow-y-auto whitespace-pre-wrap p-3 text-[11px]">
                    {updateOutput}
                  </pre>
                )}
                {sysLogs.length > 0 && (
                  <div className="cockpit-subtile max-h-40 overflow-y-auto p-3 text-[11px]">
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

          {/* Panel dedicado de Salud y Avisos del Sistema */}
          {(() => {
            const effSummary = logsMeta || metrics?.system_errors_summary;
            const failedUnitsList = effSummary?.failed_units ?? [];
            const failedCount = Number(effSummary?.failed_units_count ?? failedUnitsList.length ?? 0);
            const activeTotal = Number(effSummary?.total_errors ?? effSummary?.total ?? (sysLogs.length + failedCount));
            const ackTimeStr = effSummary?.ack_time_str;
            const isHealthy = activeTotal === 0 && failedCount === 0 && sysLogs.length === 0;
            return (
              <section className="cockpit-bento p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span
                      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isHealthy ? 'cockpit-pill-emerald' : 'cockpit-pill-amber'
                      }`}
                    >
                      {isHealthy ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    </span>
                    <div>
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
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                  <div className="cockpit-pill-amber mt-4 rounded-xl p-3">
                    <p className="text-xs font-semibold">
                      {t('more.failed_units_label', { count: failedUnitsList.length })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {failedUnitsList.map((u, idx) => {
                        const label = typeof u === 'string' ? u : u.unit;
                        return (
                          <span
                            key={`${label}-${idx}`}
                            className="cockpit-subtile rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-900 dark:text-amber-200"
                          >
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {sysLogs.length > 0 ? (
                  <div className="mt-4 max-h-60 space-y-1.5 overflow-y-auto pr-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {sysLogs.slice(0, 20).map((log, idx) => (
                      <div key={log.id || `${log.ts || idx}`} className="cockpit-subtile px-3 py-1.5">
                        <span className="text-slate-400 dark:text-slate-500">[{log.time_str || '--'}]</span>{' '}
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{log.unit || log.source || 'sys'}:</span>{' '}
                        <span>{log.message}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {t('more.no_logs_clean')}
                  </p>
                )}
              </section>
            );
          })()}

          {/* Native apps download (shown in Web browser only) */}
          {!isNativeApp && (
            <section className="cockpit-bento p-5">
              <div className="pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('more.native_apps_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('more.devices_desc')}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <a
                  href="/download/recursos-cockpit.deb"
                  className="cockpit-subtile flex min-h-[60px] items-center justify-between px-4 py-3 text-xs font-semibold text-slate-800 transition-colors hover:border-sky-400 dark:text-slate-100"
                >
                  <span className="flex items-center gap-3">
                    <span className="cockpit-pill-cyan inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Laptop className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block">{t('more.ubuntu_app')}</span>
                      <span className="font-normal text-slate-500 dark:text-slate-400">{t('more.ubuntu_app_sub')}</span>
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                </a>
                <a
                  href="/download/recursos-cockpit.apk"
                  className="cockpit-subtile flex min-h-[60px] items-center justify-between px-4 py-3 text-xs font-semibold text-slate-800 transition-colors hover:border-emerald-400 dark:text-slate-100"
                >
                  <span className="flex items-center gap-3">
                    <span className="cockpit-pill-emerald inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Smartphone className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block">{t('more.android_app')}</span>
                      <span className="font-normal text-slate-500 dark:text-slate-400">{t('more.android_app_sub')}</span>
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </a>
              </div>
            </section>
          )}
        </div>
      )}

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
            <div className="mt-4 cockpit-auto-grid-cards">
              {devices.map((dev) => {
                const isOpen = expandedDevId === dev.id;
                const accessText = dev.full_access ? t('more.native_verified') : t('more.web_verified');
                return (
                  <div key={dev.id} className="cockpit-subtile p-3.5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        {editingId === dev.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={aliasDraft}
                              onChange={(e) => setAliasDraft(e.target.value)}
                              className="cockpit-subtile min-h-[38px] px-3 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveAlias(dev.id)}
                              className="cockpit-btn-accent inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 text-xs font-semibold"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>{t('more.save_btn')}</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                              {dev.name} {dev.is_current ? t('more.this_device') : ''}
                            </p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                dev.full_access ? 'cockpit-pill-violet' : 'cockpit-pill-cyan'
                              }`}
                            >
                              {accessText}
                            </span>
                          </div>
                        )}
                        <p className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {dev.connection_mode || 'LAN'} · {dev.local_ip || dev.last_external_ip || t('more.connected_fallback')} · {t('more.last_visit_label')}:{' '}
                          {dev.last_seen || '--'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(dev.id);
                            setAliasDraft(dev.custom_alias || dev.name);
                          }}
                          className="cockpit-subtile min-h-[38px] px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {t('more.rename_btn')}
                        </button>
                        {!dev.is_current && (
                          <button
                            type="button"
                            onClick={() => handleRevokeDevice(dev.id)}
                            className="cockpit-btn-off inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>{t('more.disconnect_btn')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedDevId(isOpen ? null : dev.id)}
                          className="inline-flex min-h-[38px] items-center gap-1 px-2 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        >
                          <span>{t('equipment.technical_details')}</span>
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <pre className="mt-3 overflow-x-auto border-t border-slate-200/70 pt-3 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-300">
                        {JSON.stringify(
                          {
                            id: dev.id,
                            certificado: dev.certificate_serial,
                            hardware: dev.device_telemetry,
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
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
              className="h-[74vh] min-h-[540px] w-full bg-white dark:bg-[#020617]"
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
