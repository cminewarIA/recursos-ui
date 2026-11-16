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
import { ResourceProcessesPanel } from './ResourceProcessesPanel';
import { GpuHistorySample, HistorySeries, MetricsPayload, TelemetryHistoryResponse, ThemeMode } from '../types/telemetry';
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

const GPU_SUB_PRESETS: Array<{ key: HistoryPresetKey; labelKey: string; sec?: number }> = [
  { key: 'live', labelKey: 'charts.presets.live' },
  { key: '1200', labelKey: 'charts.presets.gpu_20m', sec: 1200 },
];

const GPU_SUB_HISTORY_FIELD_MAP: Record<string, keyof Omit<GpuHistorySample, 't'>> = {
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
      if (!opts.metaOnly) setLoadingHistory(false);
    },
    [hasMetricKeys]
  );

  // Obtener límites temporales totales de la BD una sola vez al abrir la inspección
  useEffect(() => {
    if (!hasMetricKeys) return;
    void fetchHistoricalSlice({ limit: 2, metaOnly: true });
  }, [hasMetricKeys, fetchHistoricalSlice]);

  // Refresco periódico de metadatos únicamente mientras el usuario está en modo en vivo
  useEffect(() => {
    if (!hasMetricKeys || preset !== 'live') return;
    const id = window.setInterval(() => {
      void fetchHistoricalSlice({ limit: 2, metaOnly: true });
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

  const useLocal20mGpu = Boolean(
    preset === '1200' && cursorEndTs === null && hasGpuSubHist && liveGpuHist && liveGpuHist.length >= 2
  );
  const useLocal20mStorage = Boolean(
    preset === '1200' &&
      cursorEndTs === null &&
      spec.chartKind === 'storage' &&
      liveDiskHist &&
      liveDiskHist.length > 10 &&
      ((liveDiskHist[liveDiskHist.length - 1].t - liveDiskHist[0].t) >= 1020_000 ||
        !(historyData?.series?.disk_r?.length))
  );
  const useLocal20mNet = Boolean(
    preset === '1200' &&
      cursorEndTs === null &&
      spec.chartKind === 'net' &&
      spec.nicName &&
      liveNicHist &&
      liveNicHist.length > 10 &&
      ((liveNicHist[liveNicHist.length - 1].t - liveNicHist[0].t) >= 1020_000 ||
        !(historyData?.series?.net_rx?.length))
  );

  const resolvedSeries: ChartSeries[] = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) {
      if (spec.chartKind === 'net' && liveNicHist) {
        const startIdx = liveSliceWindow.filterByEpoch(
          liveNicHist.map((b) => Math.round(b.t / 1000)),
          LIVE_WINDOW_SECONDS
        );
        const sliced = liveNicHist.slice(startIdx);
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
      if (spec.chartKind === 'storage' && liveDiskHist && liveDiskHist.length > 0) {
        const startIdx = liveSliceWindow.filterByEpoch(
          liveDiskHist.map((b) => Math.round(b.t / 1000)),
          LIVE_WINDOW_SECONDS
        );
        const sliced = liveDiskHist.slice(startIdx);
        return spec.series.map((s) => {
          if (s.id === 'disk_r' || s.metricKey === 'disk_r') {
            return { ...s, data: sliced.map((b) => Math.round((b.r / (1024 * 1024)) * 100) / 100) };
          }
          if (s.id === 'disk_w' || s.metricKey === 'disk_w') {
            return { ...s, data: sliced.map((b) => Math.round((b.w / (1024 * 1024)) * 100) / 100) };
          }
          return s;
        });
      }
      if (hasGpuSubHist && liveGpuHist) {
        const startIdx = liveSliceWindow.filterByEpoch(
          liveGpuHist.map((b) => Math.round(b.t / 1000)),
          LIVE_WINDOW_SECONDS
        );
        const sliced = liveGpuHist.slice(startIdx);
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
      const liveHist = liveMetrics?.history;
      if (liveHist && (spec.chartKind !== 'net' || !spec.nicName) && !spec.gpuSubmetric) {
        const startIdx = liveSliceWindow.filterByEpoch(liveHist.epoch_ts ?? [], LIVE_WINDOW_SECONDS);
        return spec.series.map((s) => {
          if (s.metricKey && Array.isArray(liveHist[s.metricKey])) {
            return { ...s, data: (liveHist[s.metricKey] ?? s.data).slice(startIdx) };
          }
          return s;
        });
      }
      return spec.series;
    }

    if (useLocal20mGpu && liveGpuHist) {
      const startIdx = liveSliceWindow.filterByEpoch(liveGpuHist.map((b) => Math.round(b.t / 1000)), 1200);
      const sliced = liveGpuHist.slice(startIdx);
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

    if (useLocal20mStorage && liveDiskHist) {
      const startIdx = liveSliceWindow.filterByEpoch(liveDiskHist.map((b) => Math.round(b.t / 1000)), 1200);
      const sliced = liveDiskHist.slice(startIdx);
      return spec.series.map((s) => {
        if (s.id === 'disk_r' || s.metricKey === 'disk_r') {
          return { ...s, data: sliced.map((b) => Math.round((b.r / (1024 * 1024)) * 100) / 100) };
        }
        if (s.id === 'disk_w' || s.metricKey === 'disk_w') {
          return { ...s, data: sliced.map((b) => Math.round((b.w / (1024 * 1024)) * 100) / 100) };
        }
        return s;
      });
    }

    if (useLocal20mNet && liveNicHist) {
      const startIdx = liveSliceWindow.filterByEpoch(liveNicHist.map((b) => Math.round(b.t / 1000)), 1200);
      const sliced = liveNicHist.slice(startIdx);
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

    const sqlHist: HistorySeries | undefined = historyData?.series;
    if (!sqlHist) return spec.series;
    return spec.series.map((s) => {
      if (s.metricKey && Array.isArray(sqlHist[s.metricKey])) {
        return { ...s, data: sqlHist[s.metricKey] ?? [] };
      }
      return s;
    });
  }, [preset, cursorEndTs, liveMetrics?.history, liveNicHist, liveDiskHist, liveGpuHist, hasGpuSubHist, useLocal20mGpu, useLocal20mStorage, useLocal20mNet, spec.chartKind, spec.nicName, spec.gpuSubmetric, spec.series, historyData, liveSliceWindow]);

  const resolvedTimestamps = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) {
      if (spec.chartKind === 'net' && liveNicHist?.length) {
        const startIdx = liveSliceWindow.filterByEpoch(liveNicHist.map((b) => Math.round(b.t / 1000)), LIVE_WINDOW_SECONDS);
        return liveNicHist.slice(startIdx).map((b) => new Date(b.t).toLocaleTimeString(locale));
      }
      if (spec.chartKind === 'storage' && liveDiskHist?.length) {
        const startIdx = liveSliceWindow.filterByEpoch(liveDiskHist.map((b) => Math.round(b.t / 1000)), LIVE_WINDOW_SECONDS);
        return liveDiskHist.slice(startIdx).map((b) => new Date(b.t).toLocaleTimeString(locale));
      }
      if (hasGpuSubHist && liveGpuHist) {
        const startIdx = liveSliceWindow.filterByEpoch(liveGpuHist.map((b) => Math.round(b.t / 1000)), LIVE_WINDOW_SECONDS);
        return liveGpuHist.slice(startIdx).map((b) => new Date(b.t).toLocaleTimeString(locale));
      }
      if ((spec.chartKind !== 'net' || !spec.nicName) && !spec.gpuSubmetric && liveMetrics?.history?.timestamps?.length) {
        const startIdx = liveSliceWindow.filterByEpoch(liveMetrics?.history?.epoch_ts ?? [], LIVE_WINDOW_SECONDS);
        return liveMetrics.history.timestamps.slice(startIdx);
      }
      return spec.timestamps;
    }
    if (useLocal20mGpu && liveGpuHist) {
      const startIdx = liveSliceWindow.filterByEpoch(liveGpuHist.map((b) => Math.round(b.t / 1000)), 1200);
      return liveGpuHist.slice(startIdx).map((b) => new Date(b.t).toLocaleTimeString(locale));
    }
    if (useLocal20mStorage && liveDiskHist) {
      const startIdx = liveSliceWindow.filterByEpoch(liveDiskHist.map((b) => Math.round(b.t / 1000)), 1200);
      return liveDiskHist.slice(startIdx).map((b) => new Date(b.t).toLocaleTimeString(locale));
    }
    if (useLocal20mNet && liveNicHist) {
      const startIdx = liveSliceWindow.filterByEpoch(liveNicHist.map((b) => Math.round(b.t / 1000)), 1200);
      return liveNicHist.slice(startIdx).map((b) => new Date(b.t).toLocaleTimeString(locale));
    }
    return historyData?.series?.timestamps ?? spec.timestamps;
  }, [preset, cursorEndTs, spec.chartKind, spec.nicName, spec.gpuSubmetric, spec.timestamps, liveNicHist, liveDiskHist, liveGpuHist, hasGpuSubHist, useLocal20mGpu, useLocal20mStorage, useLocal20mNet, locale, liveMetrics?.history?.timestamps, liveMetrics?.history?.epoch_ts, historyData, liveSliceWindow]);

  const resolvedDateTimestamps = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) return undefined;
    if (useLocal20mGpu || useLocal20mStorage || useLocal20mNet) return undefined;
    return historyData?.series?.date_timestamps;
  }, [preset, cursorEndTs, useLocal20mGpu, useLocal20mStorage, useLocal20mNet, historyData]);

  const resolvedEpochTs = useMemo(() => {
    if (preset === 'live' && cursorEndTs === null) {
      if (spec.chartKind === 'net' && liveNicHist?.length) {
        const epochs = liveNicHist.map((b) => Math.round(b.t / 1000));
        return epochs.slice(liveSliceWindow.filterByEpoch(epochs, LIVE_WINDOW_SECONDS));
      }
      if (spec.chartKind === 'storage' && liveDiskHist?.length) {
        const epochs = liveDiskHist.map((b) => Math.round(b.t / 1000));
        return epochs.slice(liveSliceWindow.filterByEpoch(epochs, LIVE_WINDOW_SECONDS));
      }
      if (hasGpuSubHist && liveGpuHist) {
        const epochs = liveGpuHist.map((b) => Math.round(b.t / 1000));
        return epochs.slice(liveSliceWindow.filterByEpoch(epochs, LIVE_WINDOW_SECONDS));
      }
      if ((spec.chartKind !== 'net' || !spec.nicName) && !spec.gpuSubmetric && liveMetrics?.history?.epoch_ts?.length) {
        const epochs = liveMetrics.history.epoch_ts;
        return epochs.slice(liveSliceWindow.filterByEpoch(epochs, LIVE_WINDOW_SECONDS));
      }
      return spec.epochTs;
    }
    if (useLocal20mGpu && liveGpuHist) {
      const epochs = liveGpuHist.map((b) => Math.round(b.t / 1000));
      return epochs.slice(liveSliceWindow.filterByEpoch(epochs, 1200));
    }
    if (useLocal20mStorage && liveDiskHist) {
      const epochs = liveDiskHist.map((b) => Math.round(b.t / 1000));
      return epochs.slice(liveSliceWindow.filterByEpoch(epochs, 1200));
    }
    if (useLocal20mNet && liveNicHist) {
      const epochs = liveNicHist.map((b) => Math.round(b.t / 1000));
      return epochs.slice(liveSliceWindow.filterByEpoch(epochs, 1200));
    }
    return historyData?.series?.epoch_ts ?? spec.epochTs;
  }, [preset, cursorEndTs, spec.chartKind, spec.nicName, spec.gpuSubmetric, spec.epochTs, liveNicHist, liveDiskHist, liveGpuHist, hasGpuSubHist, useLocal20mGpu, useLocal20mStorage, useLocal20mNet, liveMetrics?.history?.epoch_ts, historyData, liveSliceWindow]);

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
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={COCKPIT_SPRING}
        className="cockpit-bento w-full max-w-6xl max-h-[94vh] overflow-y-auto p-4 sm:p-5 shadow-2xl"
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
            className="cockpit-subtile flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Barra simétrica de ventanas temporales y modo táctil */}
        {(hasMetricKeys || hasGpuSubHist) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <LayoutGroup id="expanded-presets">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('charts.window_aria')}>
                {(hasMetricKeys ? WINDOW_PRESETS : GPU_SUB_PRESETS).map((p) => {
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

            {hasMetricKeys && (
              <div className="flex items-center gap-1.5" role="group" aria-label={t('charts.touch_mode_aria')}>
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
                  <span>{t('charts.inspect')}</span>
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
              {isLiveNow || !historyData?.window_start_ts
                ? t('charts.window_start', { time: resolvedTimestamps[0] || '--' })
                : t('charts.from_time', { time: formatEpochDateTime(historyData.window_start_ts, locale) })}
            </span>
            <span className="text-center text-slate-400 dark:text-slate-500">
              {interactionMode === 'pan' ? t('charts.pan_help_drag') : t('charts.pan_help_hover')}
            </span>
            <span>
              {isLiveNow || !historyData?.window_end_ts
                ? t('time.last_sample', { time: resolvedTimestamps[resolvedTimestamps.length - 1] || '--' })
                : t('charts.until_time', { time: formatEpochDateTime(historyData.window_end_ts, locale) })}
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
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Rewind className="h-4 w-4" />
                <span>{t('charts.oldest')}</span>
              </button>
              <button
                type="button"
                disabled={!canStepBack}
                onClick={handleStepBackward}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>{t('charts.step_back')}</span>
              </button>
              <button
                type="button"
                disabled={!canStepForward}
                onClick={handleStepForward}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
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
          <ResourceProcessesPanel kind={spec.chartKind} metrics={liveMetrics} compact />
        )}
      </motion.div>
    </motion.div>
  );
};

