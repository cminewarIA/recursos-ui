import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { Layers, RefreshCw } from 'lucide-react';
import { MorphPill } from './MotionPrimitives';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { ProcessHistoryMetric, ProcessHistoryResponse, ThemeMode } from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import { formatBytes } from '../utils/formatters';
import { useI18n } from '../i18n';

interface ProcessHistoryStackedChartProps {
  theme: ThemeMode;
}

const METRIC_OPTIONS: Array<{ id: ProcessHistoryMetric; labelKey: string }> = [
  { id: 'cpu', labelKey: 'equipment.process_history_cpu' },
  { id: 'ram', labelKey: 'equipment.process_history_ram' },
  { id: 'vram', labelKey: 'equipment.process_history_vram' },
  { id: 'io', labelKey: 'equipment.process_history_io' },
];

function formatStackedValue(metric: ProcessHistoryMetric, val: number): string {
  if (!Number.isFinite(val) || val <= 0) {
    if (metric === 'cpu') return '0%';
    if (metric === 'io') return '0 MB/s';
    return '0 MB';
  }
  if (metric === 'cpu') return `${val.toFixed(1).replace('.', ',')}%`;
  if (metric === 'ram' || metric === 'vram') {
    return formatBytes(val * 1024 * 1024);
  }
  if (val < 1) {
    return `${Math.round(val * 1024)} KB/s`;
  }
  return `${val.toFixed(val >= 100 ? 0 : 2).replace('.', ',')} MB/s`;
}

export const ProcessHistoryStackedChart: React.FC<ProcessHistoryStackedChartProps> = ({ theme }) => {
  const { t, locale } = useI18n();
  const [metric, setMetric] = useState<ProcessHistoryMetric>('cpu');
  const [data, setData] = useState<ProcessHistoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isolatedId, setIsolatedId] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 480, height: 224 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const seqRef = useRef(0);
  const plotBoundsRef = useRef<{ padL: number; padR: number; padT: number; padB: number }>({
    padL: 52,
    padR: 14,
    padT: 12,
    padB: 22,
  });

  const fetchHistory = useCallback(
    async (targetMetric: ProcessHistoryMetric, showSpinner = false) => {
      const seq = ++seqRef.current;
      if (showSpinner) setLoading(true);
      const res = await apiFetchJson<ProcessHistoryResponse>(
        `/api/metrics/process-history?hours=24&metric=${targetMetric}`
      );
      if (seq !== seqRef.current) return;
      if (res.ok && res.data?.ok) {
        setData(res.data);
      }
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    setIsolatedId(null);
    void fetchHistory(metric, true);
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        void fetchHistory(metric, false);
      }
    }, 30000);
    return () => window.clearInterval(id);
  }, [metric, fetchHistory]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(160, Math.floor(entry.contentRect.width));
        const h = Math.max(130, Math.floor(entry.contentRect.height) || 224);
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeSeries = useMemo(() => {
    const raw = data?.series ?? [];
    return raw.map((s) => ({
      ...s,
      displayLabel: s.is_others || s.id === '__others__' ? t('equipment.process_others') : s.label,
    }));
  }, [data?.series, t]);

  const bucketCount = useMemo(() => {
    const len = data?.timestamps?.length ?? 0;
    return len;
  }, [data?.timestamps]);

  // Precompute stacked cumulative upper/lower bounds from bottom (Others -> Top6 or filtered)
  const stackedGeometry = useMemo(() => {
    const visible = isolatedId
      ? activeSeries.filter((s) => s.id === isolatedId)
      : [...activeSeries].reverse(); // Others at bottom, highest rank on top

    const n = bucketCount;
    if (n === 0 || visible.length === 0) {
      return { visible, stackedRows: [] as Array<{ y0: number[]; y1: number[]; series: (typeof visible)[0] }>, peakY: metric === 'cpu' ? 100 : 10 };
    }

    const running = new Array<number>(n).fill(0);
    const stackedRows = visible.map((s) => {
      const y0 = new Array<number>(n);
      const y1 = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const val = Math.max(0, Number(s.data[i] ?? 0) || 0);
        y0[i] = running[i];
        running[i] += val;
        y1[i] = running[i];
      }
      return { y0, y1, series: s };
    });

    let maxSum = 0;
    for (let i = 0; i < n; i++) {
      if (running[i] > maxSum) maxSum = running[i];
    }
    const peakY =
      metric === 'cpu'
        ? Math.max(10, Math.min(100, Math.ceil(Math.max(maxSum, 1) * 1.15)))
        : Math.max(1, maxSum * 1.15);

    return { visible, stackedRows, peakY };
  }, [activeSeries, isolatedId, bucketCount, metric]);

  const formatYAxisLabel = useCallback(
    (val: number): string => {
      if (val <= 0.0001) return '0';
      if (metric === 'cpu') return `${Math.round(val)}%`;
      if (metric === 'ram' || metric === 'vram') {
        if (val >= 1024) return `${(val / 1024).toFixed(1).replace('.', ',')} GB`;
        return `${Math.round(val)} MB`;
      }
      if (val < 1) return `${Math.round(val * 1024)} KB/s`;
      return `${val.toFixed(val >= 100 ? 0 : 1).replace('.', ',')} MB/s`;
    },
    [metric]
  );

  // Canvas draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width: w, height: h } = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isDark = theme === 'dark';
    const gridColor = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)';
    const textColor = isDark ? 'rgba(203,213,225,0.72)' : 'rgba(71,85,105,0.78)';
    const fontAxis = '600 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

    const n = bucketCount;
    const { stackedRows, peakY } = stackedGeometry;
    const padL = metric === 'cpu' ? 38 : 56;
    const padR = 14;
    const padT = 12;
    const padB = 22;
    plotBoundsRef.current = { padL, padR, padT, padB };
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(20, h - padT - padB);

    // Y gridlines
    ctx.font = fontAxis;
    ctx.textBaseline = 'middle';
    const fracs = [0, 0.25, 0.5, 0.75, 1];
    for (const frac of fracs) {
      const gy = Math.round(padT + plotH * frac) + 0.5;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();

      const lbl = formatYAxisLabel(peakY * (1 - frac));
      ctx.fillStyle = textColor;
      ctx.textAlign = 'right';
      ctx.fillText(lbl, padL - 6, frac === 0 ? Math.max(8, gy) : gy);
    }

    if (n === 0 || stackedRows.length === 0) return;

    const getX = (i: number) => (n === 1 ? padL + plotW * 0.5 : padL + (i / (n - 1)) * plotW);
    const getY = (v: number) => padT + plotH - (Math.min(peakY, Math.max(0, v)) / peakY) * plotH;

    // Single snapshot pill fallback when n === 1
    if (n === 1) {
      const cx = padL + plotW * 0.5;
      const barW = Math.min(48, plotW * 0.18);
      for (const row of stackedRows) {
        const yBot = getY(row.y0[0]);
        const yTop = getY(row.y1[0]);
        ctx.fillStyle = `${row.series.color}b8`;
        ctx.fillRect(cx - barW / 2, yTop, barW, Math.max(1, yBot - yTop));
      }
    } else {
      // Draw each stacked area stratum
      for (const row of stackedRows) {
        const { y0, y1, series } = row;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const px = getX(i);
          const py = getY(y1[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        for (let i = n - 1; i >= 0; i--) {
          ctx.lineTo(getX(i), getY(y0[i]));
        }
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, `${series.color}9e`);
        grad.addColorStop(1, `${series.color}54`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Top border stroke for crisp separation
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const px = getX(i);
          const py = getY(y1[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // X-axis time ticks
    const tsLabels = data?.timestamps ?? [];
    const tickCount = plotW < 280 ? 3 : plotW < 520 ? 5 : 7;
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'top';
    for (let tIdx = 0; tIdx < tickCount; tIdx++) {
      const frac = tIdx / (tickCount - 1);
      const dataIdx = Math.min(n - 1, Math.round(frac * (n - 1)));
      const tx = padL + frac * plotW;
      ctx.textAlign = tIdx === 0 ? 'left' : tIdx === tickCount - 1 ? 'right' : 'center';
      ctx.fillText(tsLabels[dataIdx] || '--:--', tx, padT + plotH + 6);
    }

    // Hover crosshair & dots
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < n) {
      const hx = getX(hoverIdx);
      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(198,241,157,0.65)' : 'rgba(30,107,56,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, padT);
      ctx.lineTo(hx, padT + plotH);
      ctx.stroke();
      ctx.restore();

      for (const row of stackedRows) {
        const hy = getY(row.y1[hoverIdx]);
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = row.series.color;
        ctx.fill();
        ctx.strokeStyle = isDark ? '#111f13' : '#ffffff';
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    }
  }, [size, theme, bucketCount, stackedGeometry, metric, data?.timestamps, hoverIdx, formatYAxisLabel]);

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (bucketCount === 0 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { padL, padR } = plotBoundsRef.current;
    const plotW = Math.max(20, rect.width - padL - padR);
    const relX = Math.max(0, Math.min(plotW, e.clientX - rect.left - padL));
    const frac = plotW > 0 ? relX / plotW : 0;
    const idx = bucketCount === 1 ? 0 : Math.min(bucketCount - 1, Math.max(0, Math.round(frac * (bucketCount - 1))));
    setHoverIdx(idx);
    setPointerPos({ x: e.clientX, y: e.clientY });
  };

  const tooltipData: FloatingTooltipData | null = useMemo(() => {
    if (hoverIdx === null || !pointerPos || !data || hoverIdx >= bucketCount) return null;
    const dateLabel = data.date_timestamps?.[hoverIdx] || data.timestamps?.[hoverIdx] || '--';
    const entries: FloatingTooltipData['entries'] = [];
    let totalAtIdx = 0;

    for (const s of activeSeries) {
      if (isolatedId && s.id !== isolatedId) continue;
      const val = Number(s.data[hoverIdx] ?? 0) || 0;
      totalAtIdx += val;
      if (val > 0 || activeSeries.length <= 4) {
        entries.push({
          label: s.displayLabel,
          value: formatStackedValue(metric, val),
          color: s.color,
        });
      }
    }

    if (!isolatedId && entries.length > 1) {
      entries.push({
        label: t('equipment.process_history_total'),
        value: formatStackedValue(metric, totalAtIdx),
        color: '#c6f19d',
      });
    }

    return {
      visible: entries.length > 0,
      clientX: pointerPos.x,
      clientY: pointerPos.y,
      title: dateLabel,
      subtitle: metric.toUpperCase(),
      entries,
    };
  }, [hoverIdx, pointerPos, data, bucketCount, activeSeries, isolatedId, metric, t]);

  return (
    <section className="cockpit-bento p-5">
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="cockpit-pill-cyan inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
              <Layers className="h-4 w-4" />
            </span>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {t('equipment.process_history_title')}
            </h2>
            {(data?.total_snapshots ?? 0) > 0 && (
              <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                {t('equipment.process_history_snapshots', {
                  count: (data?.total_snapshots ?? 0).toLocaleString(locale),
                })}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('equipment.process_history_sub')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <LayoutGroup id="proc-history-metric">
            <div className="cockpit-subtile flex flex-wrap items-center gap-1 p-1">
              {METRIC_OPTIONS.map((opt) => {
                const active = metric === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMetric(opt.id)}
                    className={`relative min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'text-sky-700 dark:text-sky-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    {active && <MorphPill layoutId="proc-history-metric-pill" className="rounded-lg" />}
                    <span className="relative z-10">{t(opt.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <motion.button
            type="button"
            aria-label={t('network.refresh')}
            onClick={() => void fetchHistory(metric, true)}
            className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </motion.button>
        </div>
      </div>

      {/* Symmetrical Legend Filter Pills (Top 6 + Others) */}
      {activeSeries.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {activeSeries.map((s) => {
            const isActive = isolatedId === s.id;
            const isDimmed = isolatedId !== null && !isActive;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setIsolatedId((cur) => (cur === s.id ? null : s.id))}
                className={`cockpit-subtile inline-flex min-h-[32px] items-center gap-2 rounded-lg px-2.5 py-1 text-xs transition-all ${
                  isActive
                    ? 'ring-1 ring-sky-500/60 text-slate-900 dark:text-white font-semibold'
                    : isDimmed
                      ? 'opacity-45 text-slate-500 dark:text-slate-400'
                      : 'text-slate-700 hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="max-w-[140px] truncate">{s.displayLabel}</span>
                <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  {formatStackedValue(metric, s.avg)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* HiDPI Stacked Area Canvas */}
      <div className="cockpit-subtile relative mt-3 overflow-hidden p-[clamp(0.5rem,1.2vw,0.85rem)]">
        <div ref={containerRef} className="cockpit-chart-tall relative w-full">
          {bucketCount === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-slate-500 dark:text-slate-400">
              {loading ? t('charts.loading_history') : t('equipment.process_history_empty')}
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => {
                setHoverIdx(null);
                setPointerPos(null);
              }}
              style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
            />
          )}
        </div>
      </div>

      <FloatingTooltip data={tooltipData} />
    </section>
  );
};
