import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  Bell,
  Box,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  ListChecks,
  Play,
  RotateCw,
  Search,
  Send,
  ServerCog,
  Square,
} from 'lucide-react';
import { COCKPIT_EASE, MorphPill, ViewStage } from './MotionPrimitives';
import { ProcessHistoryStackedChart } from './ProcessHistoryStackedChart';
import {
  DockerActivity,
  MetricsPayload,
  SystemdService,
  SystemProcess,
  TelegramBotStatusPayload,
  ThemeMode,
} from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import { formatBytes, formatPct, formatSpeed } from '../utils/formatters';
import { formatSystemdState, useI18n } from '../i18n';

type AppsSubTab = 'processes' | 'containers' | 'services' | 'media' | 'bots';

function resolveAppsSubTab(hint?: string): AppsSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (['processes', 'procesos', 'process'].includes(h)) return 'processes';
  if (['containers', 'contenedores', 'docker'].includes(h)) return 'containers';
  if (['services', 'servicios', 'systemd', 'aplicaciones'].includes(h)) return 'services';
  if (['media', 'multimedia', 'descargas', 'downloads', 'emby', 'torrents'].includes(h)) return 'media';
  if (['bots', 'bot', 'telegram'].includes(h)) return 'bots';
  return undefined;
}

interface AppsMediaViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onServiceAction: (type: 'docker' | 'systemd', target: string, action: 'start' | 'restart' | 'stop') => void;
  actionPendingTarget: string | null;
  initialSubTab?: string;
  navTick?: number;
  onSubTabChange?: (sub: string) => void;
  onNotify?: (msg: string, isError?: boolean) => void;
}

export const AppsMediaView: React.FC<AppsMediaViewProps> = ({
  metrics,
  theme,
  onServiceAction,
  actionPendingTarget,
  initialSubTab,
  navTick,
  onSubTabChange,
  onNotify,
}) => {
  const { t, locale } = useI18n();
  const [subTab, setSubTab] = useState<AppsSubTab>(() => resolveAppsSubTab(initialSubTab) || 'processes');
  const [query, setQuery] = useState('');
  const [procSort, setProcSort] = useState<'cpu' | 'mem' | 'vram' | 'io'>('cpu');
  const [showTechIds, setShowTechIds] = useState<Record<string, boolean>>({});

  const [telegramData, setTelegramData] = useState<TelegramBotStatusPayload | null>(null);
  const [telegramMsg, setTelegramMsg] = useState('');
  const [telegramSending, setTelegramSending] = useState(false);

  useEffect(() => {
    const mapped = resolveAppsSubTab(initialSubTab);
    if (mapped) setSubTab(mapped);
  }, [initialSubTab, navTick]);

  const handleSelectSubTab = useCallback(
    (tabId: AppsSubTab) => {
      setSubTab(tabId);
      onSubTabChange?.(tabId);
    },
    [onSubTabChange]
  );

  const loadTelegramData = useCallback(async () => {
    const r = await apiFetchJson<TelegramBotStatusPayload>('/api/telegram_bot');
    if (r.ok && r.data) {
      setTelegramData(r.data);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'bots') {
      void loadTelegramData();
    }
  }, [subTab, loadTelegramData]);

  const handleTelegramTest = async () => {
    const res = await apiFetchJson<{ message?: string; error?: string }>('/api/telegram_bot/test', { method: 'POST' });
    if (res.ok) {
      onNotify?.(res.data?.message || t('network.telegram_send_test'));
      void loadTelegramData();
    } else {
      onNotify?.(res.data?.error || t('status.signal_error'), true);
    }
  };

  const handleTelegramSend = async () => {
    if (!telegramMsg.trim() || telegramSending) return;
    setTelegramSending(true);
    const res = await apiFetchJson<{ message?: string; error?: string }>('/api/telegram_bot/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: telegramMsg.trim() }),
    });
    setTelegramSending(false);
    if (res.ok) {
      onNotify?.(res.data?.message || t('network.send'));
      setTelegramMsg('');
      void loadTelegramData();
    } else {
      onNotify?.(res.data?.error || t('status.signal_error'), true);
    }
  };

  const toNum = (val: unknown, fallback = 0): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val.replace('%', '').trim());
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  const filteredProcesses = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: SystemProcess[] = [...(metrics?.system_processes ?? [])];
    const filtered = q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            String(p.user || '').toLowerCase().includes(q) ||
            String(p.pid).includes(q)
        )
      : list;
    filtered.sort((a, b) => {
      if (procSort === 'mem') return Number(b.priv_mb ?? b.mem_mb ?? 0) - Number(a.priv_mb ?? a.mem_mb ?? 0);
      if (procSort === 'vram') return Number(b.vram_mb || 0) - Number(a.vram_mb || 0);
      if (procSort === 'io') return Number(b.io_total_bps || 0) - Number(a.io_total_bps || 0);
      return Number(b.cpu_percent || 0) - Number(a.cpu_percent || 0);
    });
    return filtered.slice(0, 80);
  }, [metrics?.system_processes, query, procSort]);

  const containers: DockerActivity[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = metrics?.docker_activities ?? [];
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q) || String(c.image || '').toLowerCase().includes(q));
  }, [metrics?.docker_activities, query]);

  const systemdServices: SystemdService[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = metrics?.systemd_services ?? [];
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.description || s.role || '').toLowerCase().includes(q)
    );
  }, [metrics?.systemd_services, query]);

  const torrents = metrics?.torrents ?? [];
  const torrentStats = metrics?.torrent_stats;
  const emby = metrics?.emby;

  const subTabs: Array<{ id: AppsSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'processes', label: t('apps.subtabs.processes'), icon: <ListChecks className="h-4 w-4" /> },
    { id: 'containers', label: t('apps.subtabs.containers'), icon: <Box className="h-4 w-4" /> },
    { id: 'services', label: t('apps.subtabs.services'), icon: <ServerCog className="h-4 w-4" /> },
    { id: 'media', label: t('apps.subtabs.media'), icon: <Film className="h-4 w-4" /> },
    { id: 'bots', label: t('apps.subtabs.bots'), icon: <Send className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-[clamp(0.85rem,1.8dvh,1.25rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <LayoutGroup id="apps-subtabs">
          <div className="cockpit-segmented cockpit-subtabs-bar sm:flex-1">
            {subTabs.map((tab) => {
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
                  {active && <MorphPill layoutId="apps-subtab-pill" className="rounded-xl" />}
                  <span className="relative z-10 inline-flex items-center gap-[clamp(0.3rem,0.5vw,0.5rem)]">
                    {tab.icon}
                    <span>{tab.label}</span>
                  </span>
                </motion.button>
              );
            })}
          </div>
        </LayoutGroup>

        {subTab !== 'bots' && (
          <div className="relative w-full sm:w-[clamp(200px,24vw,300px)] shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('apps.filter_placeholder')}
              className="cockpit-subtile w-full min-h-[clamp(36px,5dvh,44px)] pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
            />
          </div>
        )}
      </div>

      <ViewStage tabKey={subTab}>
        {/* Subview 1: Procesos del Sistema */}
        {subTab === 'processes' && (
          <div className="space-y-4">
            <ProcessHistoryStackedChart theme={theme} />

            <div className="cockpit-bento p-5">
              <div className="flex flex-col gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {t('equipment.processes_now_title')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('equipment.processes_sub')}
                  </p>
                </div>
                <LayoutGroup id="proc-sort-apps">
                  <div className="cockpit-subtile flex flex-wrap items-center gap-1 p-1 max-w-full">
                    {(['cpu', 'mem', 'vram', 'io'] as const).map((k) => {
                      const active = procSort === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setProcSort(k)}
                          className={`relative min-h-[34px] flex-1 sm:flex-initial rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                            active
                              ? 'text-sky-700 dark:text-sky-300'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                          }`}
                        >
                          {active && <MorphPill layoutId="proc-sort-apps-pill" className="rounded-lg" />}
                          <span className="relative z-10">
                            {k === 'cpu'
                              ? t('equipment.sort_cpu')
                              : k === 'mem'
                                ? t('equipment.sort_mem')
                                : k === 'vram'
                                  ? t('equipment.sort_vram')
                                  : t('hardware.storage.title')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </LayoutGroup>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200/70 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="py-2.5 pr-3 font-medium">{t('equipment.col_program')}</th>
                      <th className="py-2.5 px-3 font-medium">{t('equipment.col_user')}</th>
                      <th className="py-2.5 px-3 text-right font-medium">{t('equipment.col_cpu')}</th>
                      <th className="py-2.5 px-3 text-right font-medium">{t('equipment.col_ram')}</th>
                      <th className="py-2.5 px-3 text-right font-medium">{t('equipment.col_vram')}</th>
                      <th className="py-2.5 pl-3 text-right font-medium">{t('hardware.storage.title')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                    {filteredProcesses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                          {t('equipment.processes_none_match', { query })}
                        </td>
                      </tr>
                    ) : (
                      filteredProcesses.map((proc) => (
                        <tr key={`${proc.pid}-${proc.name}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3">
                            <p className="font-medium text-slate-900 dark:text-slate-100">{proc.name}</p>
                            <p className="font-mono text-[11px] text-slate-400">
                              {t('equipment.pid_label', { pid: proc.pid })}
                            </p>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                            {proc.user || t('equipment.user_system')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                            {formatPct(proc.cpu_norm_percent ?? proc.cpu_percent)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatBytes(Number(proc.priv_mb ?? proc.mem_mb ?? 0) * 1024 * 1024)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {proc.vram_mb ? formatBytes(Number(proc.vram_mb) * 1024 * 1024) : '--'}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {proc.io_total_bps ? formatSpeed(proc.io_total_bps) : '--'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Subview 2: Contenedores Docker */}
        {subTab === 'containers' && (
          <div className="space-y-4">
            <section className="cockpit-bento p-5">
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="cockpit-pill-cyan inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <Box className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      {t('apps.installed_apps')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('apps.apps_detected', { count: containers.length })}
                    </p>
                  </div>
                </div>
              </div>

              {containers.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('apps.containers_empty')}
                </p>
              ) : (
                <div className="mt-4 cockpit-auto-grid-cards">
                  {containers.map((c) => {
                    const running = (c.state || '').toLowerCase() === 'running';
                    const busy = actionPendingTarget === c.name;
                    const techOpen = Boolean(showTechIds[c.id || c.name]);
                    return (
                      <div key={c.id || c.name} className="cockpit-subtile flex flex-col justify-between p-3.5">
                        <div className="flex flex-col gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{c.name}</p>
                              <span
                                className={`shrink-0 text-xs font-medium ${
                                  running ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {running ? t('apps.container_running') : t('apps.container_stopped')}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {t('apps.container_metrics', {
                                cpu: toNum(c.cpu_val ?? c.cpu_percent).toFixed(1),
                                mem: c.mem_usage || `${toNum(c.mem_pct_val ?? c.mem_percent).toFixed(1)} %`,
                              })}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {!running ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onServiceAction('docker', c.name, 'start')}
                                className="cockpit-btn-wol inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
                              >
                                <Play className="h-3.5 w-3.5" />
                                <span>{t('apps.start')}</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onServiceAction('docker', c.name, 'restart')}
                                  className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <RotateCw className="h-3.5 w-3.5" />
                                  <span>{t('apps.restart')}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onServiceAction('docker', c.name, 'stop')}
                                  className="cockpit-btn-off inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
                                >
                                  <Square className="h-3.5 w-3.5" />
                                  <span>{t('apps.stop')}</span>
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setShowTechIds((prev) => ({ ...prev, [c.id || c.name]: !prev[c.id || c.name] }))
                              }
                              className="inline-flex min-h-[38px] items-center gap-1 px-2 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            >
                              <span>{t('apps.details')}</span>
                              {techOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>

                        {techOpen && (
                          <div className="mt-2.5 space-y-0.5 border-t border-slate-200/70 pt-2.5 text-xs font-mono text-slate-600 dark:border-slate-800 dark:text-slate-300">
                            <div className="truncate">{t('apps.image_label', { image: c.image || '--' })}</div>
                            <div>{t('apps.container_io', { net: c.net_io || '--', disk: c.block_io || '--' })}</div>
                            <div>{t('apps.exact_state_label', { state: c.status || c.state || '--' })}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Subview 3: Servicios Systemd */}
        {subTab === 'services' && (
          <div className="space-y-4">
            <section className="cockpit-bento p-5">
              <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <span className="cockpit-pill-violet inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                  <ServerCog className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('apps.systemd_title')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('apps.systemd_sub')}
                  </p>
                </div>
              </div>

              {systemdServices.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('apps.systemd_empty')}
                </p>
              ) : (
                <div className="mt-4 cockpit-auto-grid-cards">
                  {systemdServices.slice(0, 45).map((s) => {
                    const unitTarget = s.unit || s.name;
                    const active = s.active === true || (s.active_state || s.state || '').toLowerCase() === 'active';
                    const stateLabel = formatSystemdState(s.active_state || s.state, locale);
                    const roleDesc = s.role_key
                      ? t(`hardware.systemd.role.${s.role_key}`, undefined, s.description || s.role || '')
                      : s.description || s.role;
                    const busy = actionPendingTarget === unitTarget;
                    return (
                      <div
                        key={unitTarget}
                        className="cockpit-subtile flex flex-col justify-between gap-2.5 p-3.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
                              {s.name}
                            </span>
                            <span
                              className={`shrink-0 text-xs font-medium ${
                                active ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {active ? t('hardware.systemd.state.active') : stateLabel}
                            </span>
                          </div>
                          {roleDesc && (
                            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{roleDesc}</p>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onServiceAction('systemd', unitTarget, 'restart')}
                            className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                            <span>{t('apps.restart')}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Subview 4: Multimedia y Descargas */}
        {subTab === 'media' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Emby / Multimedia */}
            <section className="cockpit-bento p-5">
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="cockpit-pill-violet inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <Film className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      {t('apps.media_title')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {(emby?.online ?? emby?.available)
                        ? t('apps.emby_streams', {
                            name: emby?.server_name || 'Emby',
                            count: emby?.active_streams || 0,
                          })
                        : t('apps.emby_unavailable')}
                    </p>
                  </div>
                </div>
              </div>

              {emby?.movies_count || emby?.series_count || emby?.episodes_count ? (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="cockpit-pill-cyan rounded-xl px-2 py-2.5">
                    <p className="font-mono text-sm font-bold tabular-nums">
                      {emby?.movies_count ?? emby?.library_counts?.['Películas'] ?? 0}
                    </p>
                    <p className="text-[11px] opacity-85">{t('apps.movies')}</p>
                  </div>
                  <div className="cockpit-pill-emerald rounded-xl px-2 py-2.5">
                    <p className="font-mono text-sm font-bold tabular-nums">
                      {emby?.series_count ?? emby?.library_counts?.['Series'] ?? 0}
                    </p>
                    <p className="text-[11px] opacity-85">{t('apps.series')}</p>
                  </div>
                  <div className="cockpit-pill-violet rounded-xl px-2 py-2.5">
                    <p className="font-mono text-sm font-bold tabular-nums">
                      {emby?.episodes_count ?? emby?.library_counts?.['Episodios'] ?? 0}
                    </p>
                    <p className="text-[11px] opacity-85">{t('apps.episodes')}</p>
                  </div>
                </div>
              ) : null}

              {emby?.sessions && emby.sessions.length > 0 ? (
                <div className="mt-3 divide-y divide-slate-200/70 dark:divide-slate-800">
                  {emby.sessions.map((sess, i) => (
                    <div key={i} className="py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {sess.series_name ? `${sess.series_name} — ${sess.item_name}` : sess.item_name || t('apps.now_playing')}
                        </p>
                        <span className="font-mono text-xs tabular-nums text-slate-500">
                          {Math.round(sess.progress_percent ?? 0)} %
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {sess.user || t('apps.user_fallback')} · {sess.device || sess.client || t('apps.screen_fallback')} ·{' '}
                        {sess.is_paused ? t('hardware.media.emby_state.paused') : t('hardware.media.emby_state.playing')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : emby?.recent_media && emby.recent_media.length > 0 ? (
                <div className="mt-3 divide-y divide-slate-200/70 dark:divide-slate-800">
                  {emby.recent_media.slice(0, 6).map((item, idx) => {
                    const rawTitle = (item.title || item.name || '').trim();
                    const rawSeries = (item.series_name || item.series || '').trim();
                    const displayTitle =
                      rawSeries && rawTitle && !rawTitle.toLowerCase().includes(rawSeries.toLowerCase())
                        ? `${rawSeries} — ${rawTitle}`
                        : rawTitle || rawSeries || '--';
                    const typeKey = item.type ? item.type.trim().toLowerCase() : '';
                    return (
                      <div key={item.id ?? idx} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                        <span className="truncate font-medium text-slate-900 dark:text-white">
                          {displayTitle}
                        </span>
                        {item.type && (
                          <span className="cockpit-subtile shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                            {t(`hardware.media.emby_type.${typeKey}`, undefined, t(`hardware.media.emby_type.${item.type}`, undefined, item.type))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('apps.nobody_watching')}
                </p>
              )}
            </section>

            {/* Torrents / Descargas */}
            <section className="cockpit-bento p-5">
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="cockpit-pill-cyan inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <Download className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      {t('apps.downloads_title')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {t('apps.dl_speeds', {
                        dl: formatSpeed(torrentStats?.dl_info_speed),
                        up: formatSpeed(torrentStats?.up_info_speed),
                      })}
                    </p>
                  </div>
                </div>
              </div>

              {torrents.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('apps.downloads_empty')}
                </p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {torrents.slice(0, 15).map((tor) => {
                    const pct = Math.min(100, Math.max(0, Math.round(toNum(tor.progress))));
                    return (
                      <div key={tor.hash} className="cockpit-subtile p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{tor.name}</p>
                          <span className="font-mono text-xs font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                            {pct} %
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: COCKPIT_EASE }}
                            className="cockpit-progress-fill h-full rounded-full bg-[#1e6b38] dark:bg-[#c6f19d]"
                          />
                        </div>
                        <p className="mt-1.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatBytes(tor.size)} · ↓ {formatSpeed(tor.dlspeed)} · ↑ {formatSpeed(tor.upspeed)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Subview 5: Bots y Automatización (Telegram) */}
        {subTab === 'bots' && (
          <div className="space-y-4">
            <section className="cockpit-bento p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="cockpit-pill-cyan inline-flex h-8 w-8 items-center justify-center rounded-xl">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      {t('network.telegram_title')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {telegramData?.bot_status?.online ? t('network.telegram_listening') : t('network.telegram_bg')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTelegramTest}
                  className="cockpit-subtile min-h-[40px] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {t('network.telegram_send_test')}
                </button>
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={telegramMsg}
                  onChange={(e) => setTelegramMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleTelegramSend();
                  }}
                  placeholder={t('network.telegram_placeholder')}
                  className="cockpit-subtile min-h-[44px] flex-1 px-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
                />
                <button
                  type="button"
                  disabled={telegramSending || !telegramMsg.trim()}
                  onClick={handleTelegramSend}
                  className="cockpit-btn-accent inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-all disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{t('network.send')}</span>
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {(telegramData?.activity ?? []).slice(0, 10).map((act, i) => {
                  const timeLabel = act.timestamp || (act as unknown as { time_str?: string }).time_str || '';
                  return (
                    <div key={i} className="cockpit-subtile p-3 text-xs">
                      <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-white">
                        <span>{act.title || t('network.notice_fallback')}</span>
                        <span className="font-mono text-[11px] font-normal text-slate-400">{timeLabel}</span>
                      </div>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-300">{act.content}</p>
                    </div>
                  );
                })}
                {(telegramData?.activity ?? []).length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    {t('network.telegram_bg')}
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </ViewStage>
    </div>
  );
};
