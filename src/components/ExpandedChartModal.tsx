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
import { COCKPIT_EASE, COCKPIT_SPRING, MorphPill } from './MotionPrimitives';
import { ChartSeries, TelemetryChart } from './TelemetryChart';
import { ExpandChartSpec } from './OverviewView';
import { ResourceProcessesPanel } from './ResourceProcessesPanel';
import {
  EntityHistoryResponse,
  GpuHistorySample,
  HistorySeries,
  MetricsPayload,
  PingHistoryResponse,
  TelemetryHistoryResponse,
  ThemeMode,
} from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import { useI18n } from '../i18n';

type HistoryPresetKey = 'live' | '1200' | '3600' | '21600' | '86400' | 'all';

interface ExpandedChartModalProps {
  spec: ExpandChartSpec;
  liveMetrics: MetricsPayload | null;
  theme: ThemeMode;
  onClose: () => void;
}

const LIVE_WINDOW_SECONDS = 300; // Ventana en directo de 5 minutos

const WINDOW_PRESETS: Array<{ key: HistoryPresetKey; labelKey: string; sec?: number }> = [
  { key: 'live', labelKey: 'charts.presets.live' },
  { key: '1200', labelKey: 'charts.presets.1200', sec: 1200 },
  { key: '3600', labelKey: 'charts.presets.3600', sec: 3600 },
  { key: '21600', labelKey: 'charts.presets.21600', sec: 21600 },
  { key: '86400', labelKey: 'charts.presets.86400', sec: 86400 },
  { key: 'all', labelKey: 'charts.presets.all' },
];

const PROBE_PALETTE_LIGHT = ['#ea580c', '#dc2626', '#d97706', '#0d9488', '#6366f1', '#1e6b38', '#0284c7', '#be185d'];
const PROBE_PALETTE_DARK = ['#fb923c', '#f87171', '#fbbf24', '#2dd4bf', '#a5b4fc', '#c6f19d', '#38bdf8', '#f472b6'];

const GPU_SUB_HISTORY_FIELD_MAP: Record<string, keyof Omit<GpuHistorySample, 't'>> = {
  gpu_compute: 'util',
  gpu_temp_overlay: 'temp',
  gpu_vram_pct: 'vram_pct',
  gpu_mem_ctrl: 'mem_util',
  gpu_enc: 'enc',
  gpu_dec: 'dec',
  gpu_power: 'power',
  gpu_temp: 'temp',
  gpu_clk_gfx: 'clock_gfx',
  gpu_clk_mem: 'clock_mem',
  gpu_pcie_rx: 'pcie_rx',
  gpu_pcie_tx: 'pcie_tx',
};

function formatEpochDateTime(ts: number | null | undefined, locale = 'es'): string {
  if (!ts || !Number.isFinite(ts)) return '--';
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} ${d.toLocaleTimeString(locale)}`;
}

export const ExpandedChartModal: React.FC<ExpandedChartModalProps> = ({
  spec,
  liveMetrics,
  theme,
  onClose,
}) => {
  const { locale, t } = useI18n();
  const hasMetricKeys = useMemo(() => spec.series.some((s) => Boolean(s.metricKey)), [spec.series]);
  const isPingHistoryMode = spec.chartKind === 'ping';
  const isEntityHistoryMode = Boolean(spec.entityKind && spec.entityId);
  const hasDatabaseHistory = hasMetricKeys || isPingHistoryMode || isEntityHistoryMode;

  const [preset, setPreset] = useState<HistoryPresetKey>('live');
  const [interactionMode, setInteractionMode] = useState<'inspect' | 'pan'>('inspect');
  const [cursorEndTs, setCursorEndTs] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<TelemetryHistoryResponse | null>(null);
  const [entityHistoryData, setEntityHistoryData] = useState<EntityHistoryResponse | null>(null);
  const [pingHistoryData, setPingHistoryData] = useState<PingHistoryResponse | null>(null);
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
      if (!hasDatabaseHistory) return;
      // Las consultas solo-metadatos nunca deben invalidar la secuencia de ventanas históricas pedidas por el usuario
      const seq = opts.metaOnly ? fetchSeqRef.current : ++fetchSeqRef.current;
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

      if (isPingHistoryMode) {
        const res = await apiFetchJson<PingHistoryResponse>(`/api/net/ping-history?${q.toString()}`);
        if (!opts.metaOnly && seq !== fetchSeqRef.current) return;
        if (res.ok && res.data?.ok) {
          setMetaBounds({
            oldestTs: res.data.oldest_ts,
            newestTs: res.data.newest_ts,
            totalSamples: res.data.total_samples,
          });
          if (!opts.metaOnly) {
            setPingHistoryData(res.data);
          }
        }
      } else if (isEntityHistoryMode && spec.entityKind && spec.entityId) {
        q.set('kind', spec.entityKind);
        q.set('id', spec.entityId);
        const res = await apiFetchJson<EntityHistoryResponse>(`/api/metrics/entity-history?${q.toString()}`);
        if (!opts.metaOnly && seq !== fetchSeqRef.current) return;
        if (res.ok && res.data?.ok && res.data.total_samples > 0) {
          setMetaBounds({
            oldestTs: res.data.oldest_ts,
            newestTs: res.data.newest_ts,
            totalSamples: res.data.total_samples,
          });
          if (!opts.metaOnly) {
            setEntityHistoryData(res.data);
            setHistoryData(null);
          }
        } else if (hasMetricKeys) {
          // Respaldo transparente a telemetry_history si device_series_history aún no acumuló muestras para esta entidad
          const qGlobal = new URLSearchParams(q.toString());
          qGlobal.delete('kind');
          qGlobal.delete('id');
          const resGlobal = await apiFetchJson<TelemetryHistoryResponse>(`/api/metrics/history?${qGlobal.toString()}`);
          if (!opts.metaOnly && seq !== fetchSeqRef.current) return;
          if (resGlobal.ok && resGlobal.data?.ok) {
            setMetaBounds({
              oldestTs: resGlobal.data.oldest_ts,
              newestTs: resGlobal.data.newest_ts,
              totalSamples: resGlobal.data.total_samples,
            });
            if (!opts.metaOnly) {
              setHistoryData(resGlobal.data);
              setEntityHistoryData(null);
            }
          }
        }
      } else {
        const res = await apiFetchJson<TelemetryHistoryResponse>(`/api/metrics/history?${q.toString()}`);
        if (!opts.metaOnly && seq !== fetchSeqRef.current) return;

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
      }
      if (!opts.metaOnly) setLoadingHistory(false);
    },
    [hasDatabaseHistory, isPingHistoryMode, isEntityHistoryMode, hasMetricKeys, spec.entityKind, spec.entityId]
  );

  // Obtener límites temporales totales de la BD una sola vez al abrir la inspección
  useEffect(() => {
    if (!hasDatabaseHistory) return;
    void fetchHistoricalSlice({ limit: 2, metaOnly: true });
  }, [hasDatabaseHistory, fetchHistoricalSlice]);

  // Refresco periódico de metadatos únicamente mientras el usuario está en modo en vivo
  useEffect(() => {
    if (!hasDatabaseHistory || preset !== 'live') return;
    const id = window.setInterval(() => {
      void fetchHistoricalSlice({ limit: 2, metaOnly: true });
    }, 6000);
    return () => window.clearInterval(id);
  }, [hasDatabaseHistory, preset, fetchHistoricalSlice]);

  // Limpiar debounce al desmontar
  useEffect(() => {
    return () => {
      if (sliderDebounceRef.current !== null) {
        window.clearTimeout(sliderDebounceRef.current);
      }
    };
  }, []);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Cerrar inspección táctil con Escape (sin re-suscribir durante actualizaciones en vivo)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const oldestTs = metaBounds.oldestTs;
  const newestTs = metaBounds.newestTs;

  const selectPreset = (nextPreset: HistoryPresetKey) => {
    setSliderDraftTs(null);
    setPreset(nextPreset);
    if (nextPreset === 'live') {
      setCursorEndTs(null);
      setHistoryData(null);
      setEntityHistoryData(null);
      setPingHistoryData(null);
      return;
    }
    if (nextPreset === 'all') {
      setCursorEndTs(null);
      void fetchHistoricalSlice({ windowParam: 'all', limit: 360 });
      return;
    }
    const sec = Number(nextPreset);
    const refEnd = cursorEndTs ?? newestTs ?? undefined;
    void fetchHistoricalSlice({
      windowParam: sec,
      beforeTs: refEnd,
      limit: 280,
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
        setEntityHistoryData(null);
        setPingHistoryData(null);
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
    const activeWinEnd = isPingHistoryMode ? pingHistoryData?.window_end_ts : historyData?.window_end_ts;
    const currentEnd = cursorEndTs ?? activeWinEnd ?? newestTs;
    const nextEnd = currentEnd - Math.max(60, span * 0.6);
    jumpToTimestampEnd(nextEnd, span);
  };

  const handleStepForward = () => {
    if (!oldestTs || !newestTs) return;
    const span = activeWindowSec;
    const activeWinEnd = isPingHistoryMode ? pingHistoryData?.window_end_ts : historyData?.window_end_ts;
    const currentEnd = cursorEndTs ?? activeWinEnd ?? newestTs;
    const nextEnd = currentEnd + Math.max(60, span * 0.6);
    if (nextEnd >= newestTs - 2) {
      setCursorEndTs(null);
      setSliderDraftTs(null);
      if (preset === 'live') {
        setHistoryData(null);
        setPingHistoryData(null);
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
      if (!hasDatabaseHistory || !oldestTs || !newestTs) return;
      const span = preset === 'live' || preset === 'all' ? 1200 : activeWindowSec;
      const secPerStep = Math.max(2, span / 40);
      const activeWinEnd = isPingHistoryMode ? pingHistoryData?.window_end_ts : historyData?.window_end_ts;
      const currentEnd = cursorEndTs ?? activeWinEnd ?? newestTs;
      const nextEnd = currentEnd + deltaSteps * secPerStep;
      if (nextEnd >= newestTs - 1.5) {
        setPreset('live');
        setCursorEndTs(null);
        setHistoryData(null);
        setPingHistoryData(null);
        return;
      }
      jumpToTimestampEnd(nextEnd, span);
    },
    [
      hasDatabaseHistory,
      isPingHistoryMode,
      oldestTs,
      newestTs,
      preset,
      activeWindowSec,
      cursorEndTs,
      historyData?.window_end_ts,
      pingHistoryData?.window_end_ts,
      jumpToTimestampEnd,
    ]
  );

  // Construir series activas (En vivo desde liveMetrics vs Histórica desde recursos_history.db)
  const liveNicHist = useMemo(() => {
    if (spec.chartKind !== 'net' || !spec.nicName) return null;
    const iface = (liveMetrics?.net?.interfaces_list || []).find((n) => n.name === spec.nicName);
    return iface?.history_2h ?? null;
  }, [spec.chartKind, spec.nicName, liveMetrics?.net?.interfaces_list]);

  const liveRouterHist = useMemo(() => {
    if (spec.chartKind !== 'router') return null;
    return liveMetrics?.wifi_summary?.router_history_20m ?? liveMetrics?.net?.router_history_20m ?? null;
  }, [spec.chartKind, liveMetrics?.wifi_summary?.router_history_20m, liveMetrics?.net?.router_history_20m]);

  const livePingLatency = useMemo(() => {
    if (spec.chartKind !== 'ping') return null;
    return liveMetrics?.net?.ping_latency ?? null;
  }, [spec.chartKind, liveMetrics?.net?.ping_latency]);

  const { liveDiskHist, liveDiskTemp } = useMemo(() => {
    if (spec.chartKind !== 'storage' || !spec.diskMountpoint) {
      return { liveDiskHist: null, liveDiskTemp: null };
    }
    const matched = (liveMetrics?.disks || []).find(
      (d) => d.mountpoint === spec.diskMountpoint || (d.shared_mounts || []).includes(spec.diskMountpoint || '')
    );
    return {
      liveDiskHist: matched?.io_history ?? null,
      liveDiskTemp: matched?.temp_c ?? null,
    };
  }, [spec.chartKind, spec.diskMountpoint, liveMetrics?.disks]);

  const liveGpuHist = useMemo(() => {
    if (spec.chartKind !== 'gpu' || !spec.gpuSubmetric) return null;
    return liveMetrics?.gpu?.history ?? null;
  }, [spec.chartKind, spec.gpuSubmetric, liveMetrics?.gpu?.history]);

  const hasGpuSubHist = Boolean(
    spec.chartKind === 'gpu' && spec.gpuSubmetric && liveGpuHist && liveGpuHist.length > 0
  );

  const liveSliceWindow = useMemo(() => {
    const filterByEpoch = (rawEpoch: number[], spanSec: number): number => {
      if (rawEpoch.length < 2) return 0;
      const newest = Number(rawEpoch[rawEpoch.length - 1]);
      if (!Number.isFinite(newest) || newest <= 0) return Math.max(0, rawEpoch.length - 60);
      const cutoff = newest - spanSec;
      const idx = rawEpoch.findIndex((t) => Number(t) >= cutoff);
      return idx >= 0 ? Math.min(idx, Math.max(0, rawEpoch.length - 2)) : Math.max(0, rawEpoch.length - 2);
    };
    return { filterByEpoch };
  }, []);

  const liveCpuProbesHist = liveMetrics?.cpu?.temp_sensors_history;

  const hasSqlEntitySeries = Boolean(entityHistoryData?.series?.epoch_ts?.length);

  const useLocal20mGpu = Boolean(
    preset === '1200' &&
      cursorEndTs === null &&
      hasGpuSubHist &&
      liveGpuHist &&
      liveGpuHist.length > 10 &&
      !hasMetricKeys
  );
  const useLocal20mStorage = Boolean(
    preset === '1200' &&
      cursorEndTs === null &&
      spec.chartKind === 'storage' &&
      liveDiskHist &&
      liveDiskHist.length > 10 &&
      !hasSqlEntitySeries &&
      !(historyData?.series?.disk_r?.length)
  );
  const useLocal20mNet = Boolean(
    preset === '1200' &&
      cursorEndTs === null &&
      spec.chartKind === 'net' &&
      spec.nicName &&
      liveNicHist &&
      liveNicHist.length > 10 &&
      !hasSqlEntitySeries &&
      !(historyData?.series?.net_rx?.length)
  );

  const useLocal20mRouter = Boolean(
    preset === '1200' &&
      cursorEndTs === null &&
      spec.chartKind === 'router' &&
      liveRouterHist &&
      liveRouterHist.length > 10 &&
      !(historyData?.series?.net_wan_rx?.length)
  );

  const liveBucketWindow = useMemo(() => {
    const isLiveHead = preset === 'live' && cursorEndTs === null;
    const spanSec = isLiveHead ? LIVE_WINDOW_SECONDS : 1200;

    if ((isLiveHead && spec.chartKind === 'net' && liveNicHist) || (!isLiveHead && useLocal20mNet && liveNicHist)) {
      const epochsAll = liveNicHist.map((b) => Math.round(b.t / 1000));
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, spanSec);
      const sliced = liveNicHist.slice(startIdx);
      return {
        kind: 'nic' as const,
        sliced,
        epochs: epochsAll.slice(startIdx),
        timestamps: sliced.map((b) => new Date(b.t).toLocaleTimeString(locale)),
      };
    }

    if ((isLiveHead && spec.chartKind === 'router' && liveRouterHist) || (!isLiveHead && useLocal20mRouter && liveRouterHist)) {
      const epochsAll = liveRouterHist.map((b) => Math.round(b.t / 1000));
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, spanSec);
      const sliced = liveRouterHist.slice(startIdx);
      return {
        kind: 'nic' as const,
        sliced,
        epochs: epochsAll.slice(startIdx),
        timestamps: sliced.map((b) => new Date(b.t).toLocaleTimeString(locale)),
      };
    }

    if (isLiveHead && spec.chartKind === 'ping' && livePingLatency && livePingLatency.targets.length > 0) {
      const epochsAll = livePingLatency.epoch_ts ?? [];
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, LIVE_WINDOW_SECONDS);
      return {
        kind: 'ping' as const,
        livePingLatency,
        startIdx,
        epochs: epochsAll.slice(startIdx),
        timestamps: (livePingLatency.timestamps ?? []).slice(startIdx),
      };
    }

    if ((isLiveHead && spec.chartKind === 'storage' && liveDiskHist?.length) || (!isLiveHead && useLocal20mStorage && liveDiskHist)) {
      const epochsAll = liveDiskHist.map((b) => Math.round(b.t / 1000));
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, spanSec);
      const sliced = liveDiskHist.slice(startIdx);
      return {
        kind: 'disk' as const,
        sliced,
        epochs: epochsAll.slice(startIdx),
        timestamps: sliced.map((b) => new Date(b.t).toLocaleTimeString(locale)),
      };
    }

    if ((isLiveHead && hasGpuSubHist && liveGpuHist && liveGpuHist.length >= 2) || (!isLiveHead && useLocal20mGpu && liveGpuHist)) {
      const epochsAll = liveGpuHist.map((b) => Math.round(b.t / 1000));
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, spanSec);
      const sliced = liveGpuHist.slice(startIdx);
      return {
        kind: 'gpu' as const,
        sliced,
        epochs: epochsAll.slice(startIdx),
        timestamps: sliced.map((b) => new Date(b.t).toLocaleTimeString(locale)),
      };
    }

    if (isLiveHead && spec.entityKind === 'cpu_sensor' && liveCpuProbesHist && liveCpuProbesHist.epoch_ts.length >= 2) {
      const epochsAll = liveCpuProbesHist.epoch_ts;
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, LIVE_WINDOW_SECONDS);
      return {
        kind: 'cpu_probes' as const,
        liveCpuProbesHist,
        startIdx,
        epochs: epochsAll.slice(startIdx),
        timestamps: liveCpuProbesHist.timestamps.slice(startIdx),
      };
    }

    if (isLiveHead && liveMetrics?.history && (spec.chartKind !== 'net' || !spec.nicName) && spec.chartKind !== 'router' && spec.chartKind !== 'ping' && spec.entityKind !== 'cpu_sensor' && !(hasGpuSubHist && liveGpuHist && liveGpuHist.length >= 2)) {
      const liveHist = liveMetrics.history;
      const epochsAll = liveHist.epoch_ts ?? [];
      const startIdx = liveSliceWindow.filterByEpoch(epochsAll, LIVE_WINDOW_SECONDS);
      return {
        kind: 'main_live' as const,
        liveHist,
        startIdx,
        epochs: epochsAll.slice(startIdx),
        timestamps: (liveHist.timestamps ?? []).slice(startIdx),
      };
    }

    return null;
  }, [
    preset,
    cursorEndTs,
    spec.chartKind,
    spec.nicName,
    spec.gpuSubmetric,
    spec.entityKind,
    liveNicHist,
    liveRouterHist,
    livePingLatency,
    liveDiskHist,
    liveGpuHist,
    liveCpuProbesHist,
    hasGpuSubHist,
    useLocal20mNet,
    useLocal20mRouter,
    useLocal20mStorage,
    useLocal20mGpu,
    liveMetrics?.history,
    liveSliceWindow,
    locale,
  ]);

  const resolvedSeries: ChartSeries[] = useMemo(() => {
    if (liveBucketWindow?.kind === 'ping') {
      const { livePingLatency: pingP, startIdx } = liveBucketWindow;
      return pingP.targets.map((tgt) => ({
        id: tgt.id,
        label: tgt.label,
        data: (tgt.data || []).slice(startIdx),
        color: tgt.color,
        unit: 'ms',
        decimals: 2,
        fillAlpha: 0.12,
      }));
    }

    if (liveBucketWindow?.kind === 'nic') {
      const { sliced } = liveBucketWindow;
      return spec.series.map((s) => {
        if (s.metricKey === 'net_wan_rx') {
          return { ...s, data: sliced.map((b) => Math.round(((b.wan_rx ?? b.rx) / (1024 * 1024)) * 100) / 100) };
        }
        if (s.metricKey === 'net_wan_tx') {
          return { ...s, data: sliced.map((b) => Math.round(((b.wan_tx ?? b.tx) / (1024 * 1024)) * 100) / 100) };
        }
        if (s.metricKey === 'net_lan_rx') {
          return { ...s, data: sliced.map((b) => Math.round(((b.lan_rx ?? 0) / (1024 * 1024)) * 100) / 100) };
        }
        if (s.metricKey === 'net_lan_tx') {
          return { ...s, data: sliced.map((b) => Math.round(((b.lan_tx ?? 0) / (1024 * 1024)) * 100) / 100) };
        }
        if (s.metricKey === 'net_rx') {
          return { ...s, data: sliced.map((b) => Math.round((b.rx / (1024 * 1024)) * 100) / 100) };
        }
        if (s.metricKey === 'net_tx') {
          return { ...s, data: sliced.map((b) => Math.round((b.tx / (1024 * 1024)) * 100) / 100) };
        }
        return s;
      });
    }

    if (liveBucketWindow?.kind === 'disk') {
      const { sliced } = liveBucketWindow;
      const firstValidTemp = sliced.find(
        (b) => typeof b.temp === 'number' && Number.isFinite(b.temp) && b.temp > 0
      )?.temp;
      const seedTemp =
        typeof firstValidTemp === 'number' && firstValidTemp > 0
          ? firstValidTemp
          : typeof liveDiskTemp === 'number' && Number.isFinite(liveDiskTemp)
            ? liveDiskTemp
            : 0;
      return spec.series.map((s) => {
        if (s.id === 'disk_r' || s.metricKey === 'disk_r') {
          return { ...s, data: sliced.map((b) => Math.round((b.r / (1024 * 1024)) * 100) / 100) };
        }
        if (s.id === 'disk_w' || s.metricKey === 'disk_w') {
          return { ...s, data: sliced.map((b) => Math.round((b.w / (1024 * 1024)) * 100) / 100) };
        }
        if (s.id === 'disk_temp' || s.metricKey === 'disk_temp') {
          let lastTemp = seedTemp;
          return {
            ...s,
            data: sliced.map((b) => {
              if (typeof b.temp === 'number' && Number.isFinite(b.temp) && b.temp > 0) {
                lastTemp = b.temp;
              }
              return lastTemp;
            }),
          };
        }
        return s;
      });
    }

    if (liveBucketWindow?.kind === 'gpu') {
      const { sliced } = liveBucketWindow;
      return spec.series.map((s) => {
        const field = GPU_SUB_HISTORY_FIELD_MAP[s.id];
        if (!field) return s;
        return {
          ...s,
          data: sliced.map((b) => {
            const v = b[field];
            return typeof v === 'number' && Number.isFinite(v) ? v : 0;
          }),
        };
      });
    }

    if (liveBucketWindow?.kind === 'cpu_probes') {
      const { liveCpuProbesHist: pHist, startIdx } = liveBucketWindow;
      const palette = theme === 'dark' ? PROBE_PALETTE_DARK : PROBE_PALETTE_LIGHT;
      if (spec.entityId && spec.entityId !== '*') {
        const arr = pHist.probes[spec.entityId];
        if (arr && arr.length > startIdx) {
          return [
            {
              id: `probe_${spec.entityId}`,
              label: spec.entityId,
              data: arr.slice(startIdx),
              color: palette[0],
              unit: '°C',
              decimals: 1,
              fillAlpha: 0.16,
            },
          ];
        }
        return spec.series;
      }
      const entries = Object.entries(pHist.probes).slice(0, 6);
      if (entries.length > 0) {
        return entries.map(([lbl, arr], idx) => ({
          id: `probe_${idx}_${lbl}`,
          label: lbl,
          data: arr.slice(startIdx),
          color: palette[idx % palette.length],
          unit: '°C',
          decimals: 1,
          fillAlpha: idx === 0 ? 0.12 : 0,
        }));
      }
      return spec.series;
    }

    if (liveBucketWindow?.kind === 'main_live') {
      const { liveHist, startIdx } = liveBucketWindow;
      return spec.series.map((s) => {
        if (s.metricKey && Array.isArray(liveHist[s.metricKey])) {
          return { ...s, data: (liveHist[s.metricKey] ?? s.data).slice(startIdx) };
        }
        return s;
      });
    }

    if (preset === 'live' && cursorEndTs === null) {
      return spec.series;
    }

    if (isPingHistoryMode) {
      const targets = pingHistoryData?.series?.targets ?? [];
      if (targets.length === 0) return spec.series;
      return targets.map((tgt) => ({
        id: tgt.id,
        label: tgt.label,
        data: tgt.data || [],
        color: tgt.color,
        unit: 'ms',
        decimals: 2,
        fillAlpha: 0.12,
      }));
    }

    if (isEntityHistoryMode && entityHistoryData?.series) {
      const entSeries = entityHistoryData.series;
      if (spec.entityKind === 'cpu_sensor') {
        const palette = theme === 'dark' ? PROBE_PALETTE_DARK : PROBE_PALETTE_LIGHT;
        if (spec.entityId === '*' && entSeries.probes) {
          const entries = Object.entries(entSeries.probes).slice(0, 6);
          if (entries.length > 0) {
            return entries.map(([lbl, arr], idx) => ({
              id: `probe_sql_${idx}_${lbl}`,
              label: lbl,
              data: arr || [],
              color: palette[idx % palette.length],
              unit: '°C',
              decimals: 1,
              fillAlpha: idx === 0 ? 0.12 : 0,
            }));
          }
        }
        if (Array.isArray(entSeries.temp_c) && entSeries.temp_c.length > 0) {
          const first = spec.series[0];
          return [
            {
              ...(first || {
                id: 'cpu_probe_temp',
                label: spec.entityId || '°C',
                color: palette[0],
                unit: '°C',
                decimals: 1,
                fillAlpha: 0.16,
              }),
              data: entSeries.temp_c,
            },
          ];
        }
      }
      return spec.series.map((s) => {
        if (s.metricKey && Array.isArray(entSeries[s.metricKey])) {
          return { ...s, data: entSeries[s.metricKey] ?? [] };
        }
        if (s.id === 'disk_r' && Array.isArray(entSeries.disk_r)) return { ...s, data: entSeries.disk_r };
        if (s.id === 'disk_w' && Array.isArray(entSeries.disk_w)) return { ...s, data: entSeries.disk_w };
        if (s.id === 'disk_pct' && Array.isArray(entSeries.disk_pct)) return { ...s, data: entSeries.disk_pct };
        if (s.id === 'disk_temp' && Array.isArray(entSeries.disk_temp)) return { ...s, data: entSeries.disk_temp };
        return s;
      });
    }

    const sqlHist: HistorySeries | undefined = historyData?.series;
    if (!sqlHist) return spec.series;
    return spec.series.map((s) => {
      if (s.metricKey && Array.isArray(sqlHist[s.metricKey])) {
        return { ...s, data: sqlHist[s.metricKey] ?? [] };
      }
      return s;
    });
  }, [
    liveBucketWindow,
    preset,
    cursorEndTs,
    spec.series,
    spec.entityKind,
    spec.entityId,
    isPingHistoryMode,
    isEntityHistoryMode,
    pingHistoryData,
    entityHistoryData,
    historyData,
    theme,
  ]);

  const resolvedTimestamps = useMemo(() => {
    if (liveBucketWindow) {
      return liveBucketWindow.timestamps.length > 0 ? liveBucketWindow.timestamps : spec.timestamps;
    }
    if (preset === 'live' && cursorEndTs === null) {
      return spec.timestamps;
    }
    if (isPingHistoryMode) {
      return pingHistoryData?.series?.timestamps ?? spec.timestamps;
    }
    if (isEntityHistoryMode && entityHistoryData?.series?.timestamps?.length) {
      return entityHistoryData.series.timestamps;
    }
    return historyData?.series?.timestamps ?? spec.timestamps;
  }, [liveBucketWindow, preset, cursorEndTs, isPingHistoryMode, isEntityHistoryMode, pingHistoryData, entityHistoryData, spec.timestamps, historyData]);

  const resolvedDateTimestamps = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) return undefined;
    if (useLocal20mGpu || useLocal20mStorage || useLocal20mNet || useLocal20mRouter) return undefined;
    if (isPingHistoryMode) {
      return pingHistoryData?.series?.date_timestamps;
    }
    if (isEntityHistoryMode && entityHistoryData?.series?.date_timestamps?.length) {
      return entityHistoryData.series.date_timestamps;
    }
    return historyData?.series?.date_timestamps;
  }, [
    preset,
    cursorEndTs,
    useLocal20mGpu,
    useLocal20mStorage,
    useLocal20mNet,
    useLocal20mRouter,
    isPingHistoryMode,
    isEntityHistoryMode,
    pingHistoryData,
    entityHistoryData,
    historyData,
  ]);

  const resolvedEpochTs = useMemo(() => {
    if (liveBucketWindow) {
      return liveBucketWindow.epochs.length > 0 ? liveBucketWindow.epochs : spec.epochTs;
    }
    if (preset === 'live' && cursorEndTs === null) {
      return spec.epochTs;
    }
    if (isPingHistoryMode) {
      return pingHistoryData?.series?.epoch_ts ?? spec.epochTs;
    }
    if (isEntityHistoryMode && entityHistoryData?.series?.epoch_ts?.length) {
      return entityHistoryData.series.epoch_ts;
    }
    return historyData?.series?.epoch_ts ?? spec.epochTs;
  }, [liveBucketWindow, preset, cursorEndTs, isPingHistoryMode, isEntityHistoryMode, pingHistoryData, entityHistoryData, spec.epochTs, historyData]);

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
  const activeStartTs = isPingHistoryMode
    ? pingHistoryData?.window_start_ts
    : entityHistoryData?.window_start_ts ?? historyData?.window_start_ts;
  const activeWinEndTs = isPingHistoryMode
    ? pingHistoryData?.window_end_ts
    : entityHistoryData?.window_end_ts ?? historyData?.window_end_ts;
  const activeEndTs = sliderDraftTs ?? cursorEndTs ?? activeWinEndTs ?? newestTs;
  const canStepBack = Boolean(oldestTs && newestTs && (isLiveNow ? metaBounds.totalSamples > 10 : (activeStartTs ?? activeEndTs ?? 0) > oldestTs + 2));
  const canStepForward = Boolean(!isLiveNow && newestTs && (activeEndTs ?? 0) < newestTs - 2);

  const totalSpanSec = oldestTs && newestTs ? Math.max(1, newestTs - oldestTs) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
      transition={{ duration: 0.18 }}
      data-cockpit-scroll-contain="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5 backdrop-blur-sm overscroll-contain"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        data-cockpit-scroll-contain="true"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
        transition={COCKPIT_SPRING}
        className="cockpit-bento cockpit-modal-enter w-[min(95vw,74rem)] max-h-[92dvh] overflow-y-auto overscroll-contain p-[clamp(0.85rem,1.8vw,1.35rem)]"
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
                    {t('charts.realtime')}
                  </>
                ) : (
                  <>
                    <Clock className="h-3 w-3" />
                    {t('charts.history_inspect')}
                  </>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              {spec.subtitle}
              {metaBounds.totalSamples > 0
                ? t('charts.samples_in_db', { count: metaBounds.totalSamples.toLocaleString(locale) })
                : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('charts.close_aria')}
            onClick={onClose}
            className="cockpit-subtile flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Barra simétrica de ventanas temporales y modo táctil */}
        {(hasDatabaseHistory || hasGpuSubHist) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <LayoutGroup id="expanded-presets">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('charts.window_aria')}>
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
                      <span className="relative z-10">{t(p.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </LayoutGroup>

            {hasDatabaseHistory && (
              <div className="flex items-center gap-1.5" role="group" aria-label={t('charts.touch_mode_aria')}>
                <motion.button
                  type="button"
                  onClick={() => setInteractionMode('inspect')}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    interactionMode === 'inspect'
                      ? 'cockpit-btn-accent'
                      : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>{t('charts.inspect')}</span>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => setInteractionMode('pan')}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    interactionMode === 'pan'
                      ? 'cockpit-btn-accent'
                      : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <MoveHorizontal className="h-3.5 w-3.5" />
                  <span>{t('charts.pan_time')}</span>
                </motion.button>
              </div>
            )}
          </div>
        )}

        {/* Lienzo principal de inspección táctil */}
        <div className="cockpit-subtile relative mt-3 p-3">
          {loadingHistory && (
            <div className="cockpit-pill-cyan pointer-events-none absolute right-3 top-2 z-10 rounded-full px-2.5 py-0.5 text-[11px] font-medium">
              {t('charts.loading_history')}
            </div>
          )}
          <TelemetryChart
            series={resolvedSeries}
            timestamps={resolvedTimestamps}
            dateTimestamps={resolvedDateTimestamps}
            epochTs={resolvedEpochTs}
            heightClassName="cockpit-chart-modal"
            leftUnit={spec.leftUnit}
            maxLeft={dynamicMaxLeft}
            maxRight={spec.maxRight}
            theme={theme}
            interactionMode={hasDatabaseHistory ? interactionMode : 'inspect'}
            onPanDeltaSteps={hasDatabaseHistory ? handlePanDeltaSteps : undefined}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span>
              {isLiveNow || !activeStartTs
                ? t('charts.window_start', { time: resolvedTimestamps[0] || '--' })
                : t('charts.from_time', { time: formatEpochDateTime(activeStartTs, locale) })}
            </span>
            <span className="text-center text-slate-400 dark:text-slate-500">
              {interactionMode === 'pan' ? t('charts.pan_help_drag') : t('charts.pan_help_hover')}
            </span>
            <span>
              {isLiveNow || !activeWinEndTs
                ? t('time.last_sample', { time: resolvedTimestamps[resolvedTimestamps.length - 1] || '--' })
                : t('charts.until_time', { time: formatEpochDateTime(activeWinEndTs, locale) })}
            </span>
          </div>
        </div>

        {/* Controles táctiles de retroceso, avance y deslizador de línea de tiempo */}
        {hasDatabaseHistory && (
          <div className="cockpit-subtile mt-3 p-3 space-y-3">
            {/* Deslizador cronológico completo */}
            {oldestTs !== null && newestTs !== null && totalSpanSec > 5 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Database className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                    {t('charts.timeline_range', {
                      from: formatEpochDateTime(oldestTs, locale),
                      to: formatEpochDateTime(newestTs, locale),
                    })}
                  </span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                    {t('charts.cursor_time', { time: formatEpochDateTime(activeEndTs, locale) })}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label={t('charts.timeline_slider_aria')}
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
                className="cockpit-subtile inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Rewind className="h-4 w-4" />
                <span>{t('charts.oldest')}</span>
              </button>
              <button
                type="button"
                disabled={!canStepBack}
                onClick={handleStepBackward}
                className="cockpit-subtile inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>{t('charts.step_back')}</span>
              </button>
              <button
                type="button"
                disabled={!canStepForward}
                onClick={handleStepForward}
                className="cockpit-subtile inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span>{t('charts.step_forward')}</span>
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
                <span>{isLiveNow ? t('charts.live_active') : t('charts.back_to_live')}</span>
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
                  <span>{t('charts.min_val', { val: st.min.toFixed(st.decimals) })}</span>
                  <span>{t('charts.avg_val', { val: st.avg.toFixed(st.decimals) })}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {t('charts.max_val', { val: st.max.toFixed(st.decimals), unit: st.unit })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Procesos activos consumidores del recurso inspeccionado */}
        {spec.chartKind && (
          <ResourceProcessesPanel
            kind={spec.chartKind === 'router' || spec.chartKind === 'ping' ? 'net' : spec.chartKind}
            metrics={liveMetrics}
            compact
          />
        )}
      </motion.div>
    </motion.div>
  );
};

