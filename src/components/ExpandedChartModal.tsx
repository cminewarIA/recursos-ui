import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  Database,
  MoveHorizontal,
  Radio,
  Rewind,
  X,
} from 'lucide-react';
import { COCKPIT_SPRING, MorphPill } from './MotionPrimitives';
import { ChartSeries, TelemetryChart } from './TelemetryChart';
import { ExpandChartSpec } from './OverviewView';
import { HistorySeries, MetricsPayload, TelemetryHistoryResponse, ThemeMode } from '../types/telemetry';
import { apiFetchJson } from '../utils/api';

type HistoryPresetKey = 'live' | '1200' | '3600' | '21600' | '86400' | 'all';

interface ExpandedChartModalProps {
  spec: ExpandChartSpec;
  liveMetrics: MetricsPayload | null;
  theme: ThemeMode;
  onClose: () => void;
}

const WINDOW_PRESETS: Array<{ key: HistoryPresetKey; label: string; sec?: number }> = [
  { key: 'live', label: 'En vivo · 20 min' },
  { key: '1200', label: '20 min', sec: 1200 },
  { key: '3600', label: '1 h', sec: 3600 },
  { key: '21600', label: '6 h', sec: 21600 },
  { key: '86400', label: '24 h', sec: 86400 },
  { key: 'all', label: 'Todo' },
];

function formatEpochDateTime(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '--';
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} ${d.toLocaleTimeString('es-ES')}`;
}

export const ExpandedChartModal: React.FC<ExpandedChartModalProps> = ({
  spec,
  liveMetrics,
  theme,
  onClose,
}) => {
  const hasMetricKeys = useMemo(() => spec.series.some((s) => Boolean(s.metricKey)), [spec.series]);

  const [preset, setPreset] = useState<HistoryPresetKey>('live');
  const [interactionMode, setInteractionMode] = useState<'inspect' | 'pan'>('inspect');
  const [cursorEndTs, setCursorEndTs] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<TelemetryHistoryResponse | null>(null);
  const [metaBounds, setMetaBounds] = useState<{
    oldestTs: number | null;
    newestTs: number | null;
    totalSamples: number;
  }>({ oldestTs: null, newestTs: null, totalSamples: 0 });
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sliderDraftTs, setSliderDraftTs] = useState<number | null>(null);

  const fetchSeqRef = useRef(0);
  const sliderDebounceRef = useRef<number | null>(null);

  const activeWindowSec = useMemo(() => {
    if (preset === '1200') return 1200;
    if (preset === '3600') return 3600;
    if (preset === '21600') return 21600;
    if (preset === '86400') return 86400;
    return 1200;
  }, [preset]);

  const fetchHistoricalSlice = useCallback(
    async (opts: {
      beforeTs?: number | null;
      afterTs?: number | null;
      windowParam?: string | number | null;
      limit?: number;
      metaOnly?: boolean;
    }) => {
      if (!hasMetricKeys) return;
      const seq = ++fetchSeqRef.current;
      if (!opts.metaOnly) setLoadingHistory(true);

      const q = new URLSearchParams();
      q.set('limit', String(opts.limit ?? 220));
      if (opts.beforeTs !== undefined && opts.beforeTs !== null && Number.isFinite(opts.beforeTs)) {
        q.set('before_ts', String(opts.beforeTs));
      }
      if (opts.afterTs !== undefined && opts.afterTs !== null && Number.isFinite(opts.afterTs)) {
        q.set('after_ts', String(opts.afterTs));
      }
      if (opts.windowParam !== undefined && opts.windowParam !== null && opts.windowParam !== '') {
        q.set('window_sec', String(opts.windowParam));
      }

      const res = await apiFetchJson<TelemetryHistoryResponse>(`/api/metrics/history?${q.toString()}`);
      if (seq !== fetchSeqRef.current && !opts.metaOnly) return;

      if (res.ok && res.data?.ok) {
        setMetaBounds({
          oldestTs: res.data.oldest_ts,
          newestTs: res.data.newest_ts,
          totalSamples: res.data.total_samples,
        });
        if (!opts.metaOnly) {
          setHistoryData(res.data);
        }
      }
      if (!opts.metaOnly) setLoadingHistory(false);
    },
    [hasMetricKeys]
  );

  // Consultar metadatos del historial en SQLite al abrir y periódicamente mientras esté en vivo
  useEffect(() => {
    if (!hasMetricKeys) return;
    void fetchHistoricalSlice({ limit: 90, metaOnly: preset === 'live' });
    if (preset !== 'live') return;
    const id = window.setInterval(() => {
      void fetchHistoricalSlice({ limit: 60, metaOnly: true });
    }, 6000);
    return () => window.clearInterval(id);
  }, [hasMetricKeys, preset, fetchHistoricalSlice]);

  // Limpiar debounce al desmontar
  useEffect(() => {
    return () => {
      if (sliderDebounceRef.current !== null) {
        window.clearTimeout(sliderDebounceRef.current);
      }
    };
  }, []);

  const oldestTs = metaBounds.oldestTs;
  const newestTs = metaBounds.newestTs;

  const selectPreset = (nextPreset: HistoryPresetKey) => {
    setSliderDraftTs(null);
    setPreset(nextPreset);
    if (nextPreset === 'live') {
      setCursorEndTs(null);
      setHistoryData(null);
      return;
    }
    if (nextPreset === 'all') {
      setCursorEndTs(null);
      void fetchHistoricalSlice({ windowParam: 'all', limit: 320 });
      return;
    }
    const sec = Number(nextPreset);
    const refEnd = cursorEndTs ?? newestTs;
    void fetchHistoricalSlice({
      windowParam: sec,
      beforeTs: refEnd,
      limit: 240,
    });
  };

  const jumpToTimestampEnd = useCallback(
    (targetEndTs: number, explicitSpanSec?: number) => {
      if (!oldestTs || !newestTs) return;
      const span = explicitSpanSec ?? activeWindowSec;
      const minEnd = Math.min(newestTs, oldestTs + Math.min(span, Math.max(15, (newestTs - oldestTs) * 0.25)));
      const clampedEnd = Math.max(minEnd, Math.min(newestTs, targetEndTs));

      if (clampedEnd >= newestTs - 1.5 && preset === 'live') {
        setCursorEndTs(null);
        setHistoryData(null);
        return;
      }
      if (preset === 'live' || preset === 'all') {
        setPreset(span >= 86400 ? '86400' : span >= 21600 ? '21600' : span >= 3600 ? '3600' : '1200');
      }
      setCursorEndTs(clampedEnd);
      void fetchHistoricalSlice({
        windowParam: span,
        beforeTs: clampedEnd,
        limit: 240,
      });
    },
    [oldestTs, newestTs, activeWindowSec, preset, fetchHistoricalSlice]
  );

  const handleStepBackward = () => {
    if (!oldestTs || !newestTs) return;
    const span = preset === 'all' ? Math.max(1200, Math.min(3600, (newestTs - oldestTs) / 6)) : activeWindowSec;
    const currentEnd = cursorEndTs ?? historyData?.window_end_ts ?? newestTs;
    const nextEnd = currentEnd - Math.max(60, span * 0.6);
    jumpToTimestampEnd(nextEnd, span);
  };

  const handleStepForward = () => {
    if (!oldestTs || !newestTs) return;
    const span = activeWindowSec;
    const currentEnd = cursorEndTs ?? historyData?.window_end_ts ?? newestTs;
    const nextEnd = currentEnd + Math.max(60, span * 0.6);
    if (nextEnd >= newestTs - 2) {
      setCursorEndTs(null);
      setSliderDraftTs(null);
      if (preset === 'live') {
        setHistoryData(null);
      } else {
        void fetchHistoricalSlice({ windowParam: span, beforeTs: newestTs, limit: 240 });
      }
      return;
    }
    jumpToTimestampEnd(nextEnd, span);
  };

  const handleJumpOldest = () => {
    if (!oldestTs || !newestTs) return;
    const span = preset === 'live' || preset === 'all' ? 1200 : activeWindowSec;
    setPreset(span >= 86400 ? '86400' : span >= 21600 ? '21600' : span >= 3600 ? '3600' : '1200');
    const targetEnd = Math.min(newestTs, oldestTs + span);
    setCursorEndTs(targetEnd);
    void fetchHistoricalSlice({ windowParam: span, beforeTs: targetEnd, limit: 240 });
  };

  const handlePanDeltaSteps = useCallback(
    (deltaSteps: number) => {
      if (!hasMetricKeys || !oldestTs || !newestTs) return;
      const span = preset === 'live' || preset === 'all' ? 1200 : activeWindowSec;
      const secPerStep = Math.max(2, span / 40);
      const currentEnd = cursorEndTs ?? historyData?.window_end_ts ?? newestTs;
      const nextEnd = currentEnd + deltaSteps * secPerStep;
      if (nextEnd >= newestTs - 1.5) {
        setPreset('live');
        setCursorEndTs(null);
        setHistoryData(null);
        return;
      }
      jumpToTimestampEnd(nextEnd, span);
    },
    [hasMetricKeys, oldestTs, newestTs, preset, activeWindowSec, cursorEndTs, historyData?.window_end_ts, jumpToTimestampEnd]
  );

  // Construir series activas (En vivo desde liveMetrics vs Histórica desde recursos_history.db)
  const liveNicHist = useMemo(() => {
    if (spec.chartKind !== 'net' || !spec.nicName) return null;
    const iface = (liveMetrics?.net?.interfaces_list || []).find((n) => n.name === spec.nicName);
    return iface?.history_2h ?? null;
  }, [spec.chartKind, spec.nicName, liveMetrics?.net?.interfaces_list]);

  const liveDiskHist = useMemo(() => {
    if (spec.chartKind !== 'storage' || !spec.diskMountpoint) return null;
    const matched = (liveMetrics?.disks || []).find(
      (d) => d.mountpoint === spec.diskMountpoint || (d.shared_mounts || []).includes(spec.diskMountpoint || '')
    );
    return matched?.io_history ?? null;
  }, [spec.chartKind, spec.diskMountpoint, liveMetrics?.disks]);

  const resolvedSeries: ChartSeries[] = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) {
      if (spec.chartKind === 'net' && liveNicHist) {
        return spec.series.map((s) => {
          if (s.metricKey === 'net_rx') {
            return { ...s, data: liveNicHist.map((b) => Math.round((b.rx / (1024 * 1024)) * 100) / 100) };
          }
          if (s.metricKey === 'net_tx') {
            return { ...s, data: liveNicHist.map((b) => Math.round((b.tx / (1024 * 1024)) * 100) / 100) };
          }
          return s;
        });
      }
      if (spec.chartKind === 'storage' && liveDiskHist && liveDiskHist.length > 0) {
        return spec.series.map((s) => {
          if (s.id === 'disk_r' || s.metricKey === 'disk_r') {
            return { ...s, data: liveDiskHist.map((b) => Math.round((b.r / (1024 * 1024)) * 100) / 100) };
          }
          if (s.id === 'disk_w' || s.metricKey === 'disk_w') {
            return { ...s, data: liveDiskHist.map((b) => Math.round((b.w / (1024 * 1024)) * 100) / 100) };
          }
          return s;
        });
      }
      const liveHist = liveMetrics?.history;
      if (liveHist && spec.chartKind !== 'net') {
        return spec.series.map((s) => {
          if (s.metricKey && Array.isArray(liveHist[s.metricKey])) {
            return { ...s, data: liveHist[s.metricKey] ?? s.data };
          }
          return s;
        });
      }
      return spec.series;
    }

    const sqlHist: HistorySeries | undefined = historyData?.series;
    if (!sqlHist) return spec.series;
    return spec.series.map((s) => {
      if (s.metricKey && Array.isArray(sqlHist[s.metricKey])) {
        return { ...s, data: sqlHist[s.metricKey] ?? [] };
      }
      return s;
    });
  }, [preset, cursorEndTs, liveMetrics?.history, liveNicHist, liveDiskHist, spec.chartKind, spec.series, historyData]);

  const resolvedTimestamps = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) {
      if (spec.chartKind === 'net' && liveNicHist?.length) {
        return liveNicHist.map((b) => new Date(b.t).toLocaleTimeString('es-ES'));
      }
      if (spec.chartKind === 'storage' && liveDiskHist?.length) {
        return liveDiskHist.map((b) => new Date(b.t).toLocaleTimeString('es-ES'));
      }
      if (spec.chartKind !== 'net' && liveMetrics?.history?.timestamps?.length) {
        return liveMetrics.history.timestamps;
      }
      return spec.timestamps;
    }
    return historyData?.series?.timestamps ?? [];
  }, [preset, cursorEndTs, spec.chartKind, spec.timestamps, liveNicHist, liveDiskHist, liveMetrics?.history?.timestamps, historyData]);

  const resolvedDateTimestamps = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) return undefined;
    return historyData?.series?.date_timestamps;
  }, [preset, cursorEndTs, historyData]);

  const resolvedEpochTs = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) {
      if (spec.chartKind === 'net' && liveNicHist?.length) {
        return liveNicHist.map((b) => Math.round(b.t / 1000));
      }
      if (spec.chartKind === 'storage' && liveDiskHist?.length) {
        return liveDiskHist.map((b) => Math.round(b.t / 1000));
      }
      if (spec.chartKind !== 'net' && liveMetrics?.history?.epoch_ts?.length) {
        return liveMetrics.history.epoch_ts;
      }
      return spec.epochTs;
    }
    return historyData?.series?.epoch_ts;
  }, [preset, cursorEndTs, spec.chartKind, spec.epochTs, liveNicHist, liveDiskHist, liveMetrics?.history?.epoch_ts, historyData]);

  // Para velocidades/flujos delegamos en TelemetryChart el autoajuste exacto al pico visible en la ventana
  const dynamicMaxLeft = useMemo(() => {
    if (spec.maxLeft) return spec.maxLeft;
    return undefined;
  }, [spec.maxLeft]);

  // Estadísticas del tramo visible
  const windowStats = useMemo(() => {
    return resolvedSeries.map((s) => {
      const vals = s.data.filter((v) => Number.isFinite(v));
      if (!vals.length) {
        return {
          id: s.id,
          label: s.label,
          color: s.color,
          unit: s.unit ?? spec.leftUnit ?? '%',
          decimals: s.decimals ?? 1,
          min: 0,
          avg: 0,
          max: 0,
          last: 0,
        };
      }
      let min = vals[0];
      let max = vals[0];
      let sum = 0;
      for (const v of vals) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        unit: s.unit ?? spec.leftUnit ?? '%',
        decimals: s.decimals ?? 1,
        min,
        avg: sum / vals.length,
        max,
        last: vals[vals.length - 1],
      };
    });
  }, [resolvedSeries, spec.leftUnit]);

  const isLiveNow = preset === 'live' && cursorEndTs === null;
  const activeStartTs = historyData?.window_start_ts;
  const activeEndTs = sliderDraftTs ?? cursorEndTs ?? historyData?.window_end_ts ?? newestTs;
  const canStepBack = Boolean(oldestTs && newestTs && (isLiveNow ? metaBounds.totalSamples > 10 : (activeStartTs ?? activeEndTs ?? 0) > oldestTs + 2));
  const canStepForward = Boolean(!isLiveNow && newestTs && (activeEndTs ?? 0) < newestTs - 2);

  const totalSpanSec = oldestTs && newestTs ? Math.max(1, newestTs - oldestTs) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={COCKPIT_SPRING}
        className="cockpit-bento w-full max-w-4xl max-h-[94vh] overflow-y-auto p-4 sm:p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {spec.title}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  isLiveNow ? 'cockpit-pill-emerald' : 'cockpit-pill-cyan'
                }`}
              >
                {isLiveNow ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 cockpit-live-dot" />
                    Tiempo real
                  </>
                ) : (
                  <>
                    <Clock className="h-3 w-3" />
                    Inspección histórica
                  </>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              {spec.subtitle}
              {metaBounds.totalSamples > 0
                ? ` · ${metaBounds.totalSamples.toLocaleString('es-ES')} muestras en recursos_history.db`
                : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar gráfica ampliada"
            onClick={onClose}
            className="cockpit-subtile flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Barra simétrica de ventanas temporales y modo táctil */}
        {hasMetricKeys && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <LayoutGroup id="expanded-presets">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ventana temporal">
                {WINDOW_PRESETS.map((p) => {
                  const active = preset === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => selectPreset(p.key)}
                      className={`relative min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {active && <MorphPill layoutId="expanded-preset-pill" className="rounded-xl" />}
                      <span className="relative z-10">{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </LayoutGroup>

            <div className="flex items-center gap-1.5" role="group" aria-label="Modo de interacción táctil">
              <motion.button
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => setInteractionMode('inspect')}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  interactionMode === 'inspect'
                    ? 'cockpit-btn-accent'
                    : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Crosshair className="h-3.5 w-3.5" />
                <span>Inspeccionar</span>
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => setInteractionMode('pan')}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  interactionMode === 'pan'
                    ? 'cockpit-btn-accent'
                    : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <MoveHorizontal className="h-3.5 w-3.5" />
                <span>Deslizar tiempo</span>
              </motion.button>
            </div>
          </div>
        )}

        {/* Lienzo principal de inspección táctil */}
        <div className="cockpit-subtile relative mt-3 p-3">
          {loadingHistory && (
            <div className="cockpit-pill-cyan pointer-events-none absolute right-3 top-2 z-10 rounded-full px-2.5 py-0.5 text-[11px] font-medium">
              Cargando historial...
            </div>
          )}
          <TelemetryChart
            series={resolvedSeries}
            timestamps={resolvedTimestamps}
            dateTimestamps={resolvedDateTimestamps}
            epochTs={resolvedEpochTs}
            height={270}
            leftUnit={spec.leftUnit}
            maxLeft={dynamicMaxLeft}
            maxRight={spec.maxRight}
            theme={theme}
            interactionMode={hasMetricKeys ? interactionMode : 'inspect'}
            onPanDeltaSteps={hasMetricKeys ? handlePanDeltaSteps : undefined}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span>
              {isLiveNow
                ? `Inicio ventana: ${resolvedTimestamps[0] || '--'}`
                : `Desde: ${formatEpochDateTime(historyData?.window_start_ts)}`}
            </span>
            <span className="text-center text-slate-400 dark:text-slate-500">
              {interactionMode === 'pan'
                ? 'Arrastra hacia la derecha para retroceder · Rueda o botones también navegan'
                : 'Toca o desliza sobre la gráfica para inspeccionar valores exactos'}
            </span>
            <span>
              {isLiveNow
                ? `Último: ${resolvedTimestamps[resolvedTimestamps.length - 1] || '--'}`
                : `Hasta: ${formatEpochDateTime(historyData?.window_end_ts)}`}
            </span>
          </div>
        </div>

        {/* Controles táctiles de retroceso, avance y deslizador de línea de tiempo */}
        {hasMetricKeys && (
          <div className="cockpit-subtile mt-3 p-3 space-y-3">
            {/* Deslizador cronológico completo */}
            {oldestTs !== null && newestTs !== null && totalSpanSec > 5 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Database className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                    Línea temporal registrada ({formatEpochDateTime(oldestTs)} → {formatEpochDateTime(newestTs)})
                  </span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                    Cursor: {formatEpochDateTime(activeEndTs)}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Deslizador cronológico de historial"
                  min={oldestTs + Math.min(30, totalSpanSec * 0.1)}
                  max={newestTs}
                  step={Math.max(1, Math.floor(totalSpanSec / 400))}
                  value={Math.min(newestTs, Math.max(oldestTs, activeEndTs ?? newestTs))}
                  onChange={(e) => {
                    const nextVal = Number(e.target.value);
                    setSliderDraftTs(nextVal);
                    if (sliderDebounceRef.current !== null) {
                      window.clearTimeout(sliderDebounceRef.current);
                    }
                    sliderDebounceRef.current = window.setTimeout(() => {
                      setSliderDraftTs(null);
                      jumpToTimestampEnd(nextVal, preset === 'live' || preset === 'all' ? 1200 : activeWindowSec);
                    }, 90);
                  }}
                  className="h-2 w-full cursor-pointer accent-sky-600 dark:accent-sky-400 rounded-lg"
                />
              </div>
            )}

            {/* Botones táctiles simétricos */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                type="button"
                disabled={!canStepBack}
                onClick={handleJumpOldest}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Rewind className="h-4 w-4" />
                <span>Más antiguo</span>
              </button>
              <button
                type="button"
                disabled={!canStepBack}
                onClick={handleStepBackward}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Retroceder</span>
              </button>
              <button
                type="button"
                disabled={!canStepForward}
                onClick={handleStepForward}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span>Avanzar</span>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => selectPreset('live')}
                className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                  isLiveNow
                    ? 'cockpit-pill-emerald'
                    : 'cockpit-btn-accent'
                }`}
              >
                <Radio className="h-4 w-4" />
                <span>{isLiveNow ? 'En vivo activo' : 'Volver a vivo'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Resumen estadístico simétrico del tramo visible */}
        {windowStats.length > 0 && (
          <div
            className={`mt-3 grid gap-2 ${
              windowStats.length === 1
                ? 'grid-cols-1'
                : windowStats.length === 2
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1 sm:grid-cols-3'
            }`}
          >
            {windowStats.map((st) => (
              <div
                key={st.id}
                className="cockpit-subtile flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.color }} />
                  <span>{st.label}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                  <span>Mín {st.min.toFixed(st.decimals)}</span>
                  <span>Med {st.avg.toFixed(st.decimals)}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    Máx {st.max.toFixed(st.decimals)} {st.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

