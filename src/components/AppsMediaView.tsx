import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Play,
  RotateCw,
  Search,
  ServerCog,
  Square,
} from 'lucide-react';
import { COCKPIT_EASE, MorphPill, ViewStage } from './MotionPrimitives';
import { DockerActivity, MetricsPayload, SystemdService } from '../types/telemetry';
import { formatBytes, formatSpeed } from '../utils/formatters';
import { formatSystemdState, useI18n } from '../i18n';

type AppsSubTab = 'services' | 'media';

function resolveAppsSubTab(hint?: string): AppsSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'media' || h === 'downloads' || h === 'multimedia' || h === 'descargas') return 'media';
  if (h === 'services' || h === 'servicios' || h === 'aplicaciones') return 'services';
  return undefined;
}

interface AppsMediaViewProps {
  metrics: MetricsPayload | null;
  onServiceAction: (type: 'docker' | 'systemd', target: string, action: 'start' | 'restart' | 'stop') => void;
  actionPendingTarget: string | null;
  initialSubTab?: string;
  navTick?: number;
}

export const AppsMediaView: React.FC<AppsMediaViewProps> = ({
  metrics,
  onServiceAction,
  actionPendingTarget,
  initialSubTab,
  navTick,
}) => {
  const [subTab, setSubTab] = useState<AppsSubTab>(() => resolveAppsSubTab(initialSubTab) || 'services');
  const [query, setQuery] = useState('');
  const [showTechIds, setShowTechIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const mapped = resolveAppsSubTab(initialSubTab);
    if (mapped) setSubTab(mapped);
  }, [initialSubTab, navTick]);

  const toNum = (val: unknown, fallback = 0): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val.replace('%', '').trim());
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

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

  const { t, locale } = useI18n();

  const subTabs: Array<{ id: AppsSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'services', label: t('apps.subtabs.services'), icon: <Box className="h-4 w-4" /> },
    { id: 'media', label: t('apps.subtabs.media'), icon: <Film className="h-4 w-4" /> },
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
                whileTap={{ scale: 0.97 }}
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
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

        {subTab === 'services' && (
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

      {subTab === 'services' && (
        <div className="space-y-4">
          {/* Docker Containers */}
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

          {/* Systemd Services */}
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
                {systemdServices.slice(0, 30).map((s) => {
                  const unitTarget = s.unit || s.name;
                  const active = s.active === true || (s.active_state || s.state || '').toLowerCase() === 'active';
                  const stateLabel = formatSystemdState(s.active_state || s.state, locale);
                  const roleDesc = s.role_key
  ? t(`hardware.systemd.role.${s.role_key}`, undefined, s.description || s.role || '')
  : (s.description || s.role);
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

            {(emby?.movies_count || emby?.series_count || emby?.episodes_count) ? (
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
                {torrents.slice(0, 15).map((t) => {
                  const pct = Math.min(100, Math.max(0, Math.round(toNum(t.progress))));
                  return (
                    <div key={t.hash} className="cockpit-subtile p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{t.name}</p>
                        <span className="font-mono text-xs font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                          {pct} %
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5, ease: COCKPIT_EASE }}
                          className="cockpit-progress-fill h-full rounded-full bg-[#0284c7] dark:bg-[#38bdf8]"
                        />
                      </div>
                      <p className="mt-1.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatBytes(t.size)} · ↓ {formatSpeed(t.dlspeed)} · ↑ {formatSpeed(t.upspeed)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
      </ViewStage>
    </div>
  );
};
