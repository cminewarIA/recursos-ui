import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Clock,
  Copy,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import { ServiceConsoleLogEntry, ServiceConsoleLogsResponse } from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import { useI18n } from '../i18n';

interface ServiceConsoleViewProps {
  onNotify: (msg: string, isError?: boolean) => void;
}

type ConsoleWindow = 'live' | '1h' | '6h' | '24h';
type ConsoleLevel = 'ALL' | 'INFO' | 'CMD' | 'HTTP' | 'OTA' | 'WARN' | 'ERROR';

const LEVELS: ConsoleLevel[] = ['ALL', 'INFO', 'CMD', 'HTTP', 'OTA', 'WARN', 'ERROR'];
const WINDOWS: ConsoleWindow[] = ['live', '1h', '6h', '24h'];
const MAX_VISIBLE_LINES = 600;

function getLevelBadgeClass(level: string): string {
  const norm = String(level || 'INFO').toUpperCase();
  if (norm === 'ERROR') {
    return 'bg-rose-500/15 text-rose-700 border border-rose-500/30 dark:bg-rose-500/20 dark:text-rose-300';
  }
  if (norm === 'WARN') {
    return 'bg-amber-500/15 text-amber-800 border border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-300';
  }
  if (norm === 'CMD') {
    return 'bg-indigo-500/15 text-indigo-700 border border-indigo-500/30 dark:bg-indigo-500/20 dark:text-indigo-300';
  }
  if (norm === 'HTTP') {
    return 'bg-sky-500/15 text-sky-700 border border-sky-500/30 dark:bg-sky-500/20 dark:text-sky-300';
  }
  if (norm === 'OTA') {
    return 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-300';
  }
  return 'bg-[#1e6b38]/12 text-[#1e6b38] border border-[#1e6b38]/25 dark:bg-[#c6f19d]/15 dark:text-[#c6f19d] dark:border-[#c6f19d]/25';
}

export const ServiceConsoleView: React.FC<ServiceConsoleViewProps> = ({ onNotify }) => {
  const { t } = useI18n();
  const [windowRange, setWindowRange] = useState<ConsoleWindow>('live');
  const [levelFilter, setLevelFilter] = useState<ConsoleLevel>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entries, setEntries] = useState<ServiceConsoleLogEntry[]>([]);
  const [total24h, setTotal24h] = useState(0);
  const [retentionHours, setRetentionHours] = useState(24);
  const [errorMsg, setErrorMsg] = useState('');

  const lastIdRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const fetchLogs = useCallback(
    async (incremental: boolean) => {
      const params = new URLSearchParams();
      params.set('window', windowRange);
      params.set('level', levelFilter);
      params.set('limit', '350');
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }
      if (incremental && lastIdRef.current > 0) {
        params.set('after_id', String(lastIdRef.current));
      } else {
        setRefreshing(true);
      }

      const res = await apiFetchJson<ServiceConsoleLogsResponse>(
        `/api/system/console-logs?${params.toString()}`
      );
      setLoading(false);
      setRefreshing(false);

      if (!res.ok || !res.data || res.data.ok === false) {
        setErrorMsg(res.data?.error || res.error || t('console.load_error'));
        return;
      }

      setErrorMsg('');
      const payload = res.data;
      setTotal24h(Number(payload.total_24h || 0));
      setRetentionHours(Number(payload.retention_hours || 24));
      const incoming = Array.isArray(payload.entries) ? payload.entries : [];

      if (incremental && lastIdRef.current > 0) {
        if (incoming.length > 0) {
          setEntries((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const merged = [...prev];
            for (const row of incoming) {
              if (!seen.has(row.id)) {
                merged.push(row);
                seen.add(row.id);
              }
            }
            return merged.length > MAX_VISIBLE_LINES
              ? merged.slice(merged.length - MAX_VISIBLE_LINES)
              : merged;
          });
        }
        if (payload.last_id > lastIdRef.current) {
          lastIdRef.current = payload.last_id;
        }
      } else {
        setEntries(
          incoming.length > MAX_VISIBLE_LINES
            ? incoming.slice(incoming.length - MAX_VISIBLE_LINES)
            : incoming
        );
        lastIdRef.current = Number(payload.last_id || 0);
      }
    },
    [levelFilter, searchQuery, t, windowRange]
  );

  // Reload full snapshot whenever window, level, or search changes
  useEffect(() => {
    lastIdRef.current = 0;
    const timer = window.setTimeout(() => {
      void fetchLogs(false);
    }, searchQuery ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs, searchQuery]);

  // Live incremental tail polling every 2s when active & not paused
  useEffect(() => {
    if (paused || windowRange !== 'live') return;
    const poll = window.setInterval(() => {
      void fetchLogs(true);
    }, 2000);
    return () => window.clearInterval(poll);
  }, [fetchLogs, paused, windowRange]);

  // Auto-scroll terminal viewport to newest line when enabled
  useEffect(() => {
    if (!autoScroll || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [entries, autoScroll]);

  const handleCopyVisible = async () => {
    if (entries.length === 0) return;
    const text = entries
      .map((item) => {
        const parts = [`[${item.time_str}]`, `[${item.level}]`, `[${item.source}]`];
        if (item.command) parts.push(item.command);
        if (item.message) parts.push(item.message);
        return parts.join(' ');
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      onNotify(t('console.copied_toast', { count: entries.length }));
    } catch {
      onNotify(t('console.copy_error'), true);
    }
  };

  const windowLabels = useMemo<Record<ConsoleWindow, string>>(
    () => ({
      live: t('console.window_live'),
      '1h': t('console.window_1h'),
      '6h': t('console.window_6h'),
      '24h': t('console.window_24h'),
    }),
    [t]
  );

  return (
    <section
      className="cockpit-bento flex flex-col gap-4 p-4 sm:p-5"
      data-testid="service-console-panel"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200/70 pb-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-slate-900 dark:text-white">
              <Terminal className="h-4 w-4 text-[#1e6b38] dark:text-[#c6f19d]" />
              <span>{t('console.title')}</span>
            </h2>
            <span className="cockpit-pill-emerald inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold">
              <Lock className="h-3 w-3" />
              <span>{t('console.readonly_badge')}</span>
            </span>
            <span className="cockpit-pill-cyan inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
              <Clock className="h-3 w-3" />
              <span>{t('console.retention_badge', { hours: retentionHours })}</span>
            </span>
            <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
              {t('console.total_24h_badge', { count: total24h })}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('console.subtitle')}
          </p>
        </div>

        {/* Stream & action controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            disabled={windowRange !== 'live'}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors disabled:opacity-45 cursor-pointer ${
              !paused && windowRange === 'live'
                ? 'cockpit-pill-emerald'
                : 'cockpit-subtile text-slate-700 dark:text-slate-200'
            }`}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{paused ? t('console.resume_btn') : t('console.pause_btn')}</span>
          </button>

          <button
            type="button"
            onClick={() => setAutoScroll((a) => !a)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors cursor-pointer ${
              autoScroll
                ? 'cockpit-pill-cyan'
                : 'cockpit-subtile text-slate-600 dark:text-slate-300'
            }`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span>{t('console.autoscroll_btn')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              lastIdRef.current = 0;
              void fetchLogs(false);
            }}
            disabled={refreshing}
            className="cockpit-subtile inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:text-sky-700 dark:text-slate-200 dark:hover:text-sky-300 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t('console.refresh_btn')}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyVisible}
            disabled={entries.length === 0}
            className="cockpit-subtile inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:text-emerald-700 disabled:opacity-45 dark:text-slate-200 dark:hover:text-emerald-300 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>{t('console.copy_btn')}</span>
          </button>
        </div>
      </div>

      {/* Filters bar: Time Window + Level Filter + Search */}
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="cockpit-subtile inline-flex items-center gap-1 p-1">
            {WINDOWS.map((win) => {
              const active = windowRange === win;
              return (
                <button
                  key={win}
                  type="button"
                  onClick={() => {
                    setWindowRange(win);
                    if (win === 'live') setPaused(false);
                  }}
                  className={`min-h-[30px] rounded-lg px-2.5 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#1e6b38] text-white dark:bg-[#c6f19d] dark:text-[#0a140b]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {windowLabels[win]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {LEVELS.map((lvl) => {
              const active = levelFilter === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setLevelFilter(lvl)}
                  className={`min-h-[30px] rounded-lg px-2.5 font-mono text-[10.5px] font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'cockpit-pill-cyan ring-1 ring-sky-500/40'
                      : 'cockpit-subtile text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {lvl === 'ALL' ? t('console.level_all') : lvl}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative w-full xl:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('console.search_placeholder')}
            aria-label={t('console.search_placeholder')}
            className="cockpit-subtile min-h-[36px] w-full pl-8 pr-8 text-xs text-slate-900 outline-none focus:border-[#1e6b38] dark:text-white dark:focus:border-[#c6f19d]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Strictly Read-Only Terminal Output Viewport (zero command input) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/75 backdrop-blur-md dark:border-[#233a25] dark:bg-[#071108]/85">
        {/* Terminal Status Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 bg-slate-100/70 px-3.5 py-2 font-mono text-[11px] dark:border-[#1c301e] dark:bg-[#0d1c0f]/80">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                windowRange === 'live' && !paused
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]'
                  : 'bg-amber-500'
              }`}
            />
            <span className="font-semibold">recursos-service.log</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500 dark:text-slate-400">
              {windowRange === 'live' && !paused
                ? t('console.status_streaming')
                : paused
                  ? t('console.status_paused')
                  : windowLabels[windowRange]}
            </span>
          </div>
          <span className="tabular-nums text-slate-500 dark:text-slate-400">
            {t('console.visible_lines', { count: entries.length })}
          </span>
        </div>

        {/* Scrollable Log Lines */}
        <div
          ref={scrollContainerRef}
          data-cockpit-scroll-contain="true"
          role="log"
          aria-live="polite"
          aria-readonly="true"
          className="h-[clamp(300px,54dvh,560px)] overflow-y-auto overscroll-contain p-3 font-mono text-[11.5px] leading-relaxed select-text"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              <span>{t('console.loading')}</span>
            </div>
          ) : errorMsg ? (
            <div className="flex h-full items-center justify-center text-xs text-rose-600 dark:text-rose-400">
              {errorMsg}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-xs text-slate-500 dark:text-slate-400">
              <Terminal className="h-6 w-6 opacity-40" />
              <span>{t('console.empty')}</span>
            </div>
          ) : (
            <div className="space-y-1">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[auto_auto_1fr] items-baseline gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.04]"
                >
                  <span className="shrink-0 tabular-nums text-[10.5px] text-slate-500 dark:text-slate-400">
                    {entry.time_str}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${getLevelBadgeClass(
                      entry.level
                    )}`}
                  >
                    {entry.level}
                  </span>
                  <div className="min-w-0 break-words text-slate-800 dark:text-[#e6f0e5]">
                    <span className="mr-1.5 text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">
                      [{entry.source}]
                    </span>
                    {entry.command && (
                      <span className="mr-1.5 font-semibold text-[#1e6b38] dark:text-[#c6f19d]">
                        {entry.command}
                      </span>
                    )}
                    <span>{entry.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Read-only footer notice (explicitly no input prompt) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 bg-slate-50/70 px-3.5 py-2 text-[11px] text-slate-500 dark:border-[#1c301e] dark:bg-[#0a150c]/80 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3 shrink-0" />
            <span>{t('console.readonly_footer')}</span>
          </span>
          <span className="font-mono text-[10.5px] tabular-nums">
            SQLite · recursos_history.db
          </span>
        </div>
      </div>
    </section>
  );
};
