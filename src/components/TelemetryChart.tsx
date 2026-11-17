import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { formatRelativeIndexAge } from '../utils/formatters';
import { TelemetryMetricKey, ThemeMode } from '../types/telemetry';
import { useI18n } from '../i18n';

export interface ChartSeries {
  id: string;
  metricKey?: TelemetryMetricKey;
  label: string;
  data: number[];
  color: string;
  unit?: string;
  decimals?: number;
  fillAlpha?: number;
  dashed?: boolean;
  axis?: 'left' | 'right';
}

interface TelemetryChartProps {
  series: ChartSeries[];
  timestamps?: string[];
  dateTimestamps?: string[];
  epochTs?: number[];
  height?: number;
  maxLeft?: number;
  maxRight?: number;
  leftUnit?: string;
  intervalSec?: number;
  significantDelta?: number;
  theme: ThemeMode;
  className?: string;
  formatLabel?: (index: number) => string;
  formatValue?: (series: ChartSeries, value: number) => string;
  emptyMessage?: string;
  onExpandClick?: () => void;
  interactionMode?: 'inspect' | 'pan';
  onPanDeltaSteps?: (deltaSteps: number) => void;
}

let cachedMeasureCtx: CanvasRenderingContext2D | null = null;
function measureAxisTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 6.2;
  if (!cachedMeasureCtx) {
    const offscreen = document.createElement('canvas');
    cachedMeasureCtx = offscreen.getContext('2d');
  }
  if (!cachedMeasureCtx) return text.length * 6.2;
  cachedMeasureCtx.font = font;
  return cachedMeasureCtx.measureText(text).width;
}

function getSensorSignificantThreshold(
  unit: string,
  scalePeak: number,
  decimals?: number,
  customDelta?: number
): number {
  if (typeof customDelta === 'number' && Number.isFinite(customDelta) && customDelta > 0) {
    return customDelta;
  }
  if (unit === '%') return 0.5;
  if (unit === '°C' || unit === 'C') return 0.5;
  if (unit === 'ms') {
    return Math.max(0.2, Math.min(2, scalePeak * 0.02));
  }
  if (unit === 'MB/s') {
    return Math.min(0.5, Math.max(0.02, scalePeak * 0.015));
  }
  if (decimals === 0) {
    return Math.max(1, scalePeak * 0.01);
  }
  return Math.max(0.25, scalePeak * 0.01);
}

interface BucketedSeriesResult {
  s: ChartSeries;
  values: number[];
  sourceIndices: number[]; // Empty when 1:1 (no downsampling applied)
}

/**
 * Agrupa series extensas en buckets que conservan picos y valles (min/max cronológico por bucket)
 * cuando la densidad de muestras supera la resolución horizontal en píxeles.
 */
function buildSeriesBuckets(rawData: number[], maxBuckets: number): { values: number[]; sourceIndices: number[] } {
  const n = rawData.length;
  if (n <= maxBuckets || maxBuckets < 8 || n <= 4) {
    const clean = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const v = Number(rawData[i]);
      clean[i] = Number.isFinite(v) ? v : 0;
    }
    return { values: clean, sourceIndices: [] };
  }

  const bucketCount = Math.max(2, Math.floor((maxBuckets - 2) / 2));
  const interiorLen = n - 2;
  const bucketSize = interiorLen / bucketCount;
  const values: number[] = [Number.isFinite(Number(rawData[0])) ? Number(rawData[0]) : 0];
  const sourceIndices: number[] = [0];

  for (let b = 0; b < bucketCount; b++) {
    const start = 1 + Math.floor(b * bucketSize);
    const end = Math.min(n - 1, 1 + Math.floor((b + 1) * bucketSize));
    if (start >= end) continue;

    let minIdx = start;
    let maxIdx = start;
    let minVal = Number(rawData[start]);
    if (!Number.isFinite(minVal)) minVal = 0;
    let maxVal = minVal;

    for (let i = start + 1; i < end; i++) {
      const raw = Number(rawData[i]);
      const val = Number.isFinite(raw) ? raw : 0;
      if (val < minVal) {
        minVal = val;
        minIdx = i;
      }
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }

    if (minIdx === maxIdx) {
      values.push(maxVal);
      sourceIndices.push(maxIdx);
    } else if (minIdx < maxIdx) {
      values.push(minVal, maxVal);
      sourceIndices.push(minIdx, maxIdx);
    } else {
      values.push(maxVal, minVal);
      sourceIndices.push(maxIdx, minIdx);
    }
  }

  const lastIdx = n - 1;
  const lastVal = Number(rawData[lastIdx]);
  values.push(Number.isFinite(lastVal) ? lastVal : 0);
  sourceIndices.push(lastIdx);
  return { values, sourceIndices };
}

function areTelemetryChartPropsEqual(prev: TelemetryChartProps, next: TelemetryChartProps): boolean {
  if (
    prev.theme !== next.theme ||
    prev.height !== next.height ||
    prev.maxLeft !== next.maxLeft ||
    prev.maxRight !== next.maxRight ||
    prev.leftUnit !== next.leftUnit ||
    prev.intervalSec !== next.intervalSec ||
    prev.significantDelta !== next.significantDelta ||
    prev.interactionMode !== next.interactionMode ||
    prev.emptyMessage !== next.emptyMessage ||
    prev.className !== next.className ||
    Boolean(prev.onExpandClick) !== Boolean(next.onExpandClick) ||
    Boolean(prev.onPanDeltaSteps) !== Boolean(next.onPanDeltaSteps)
  ) {
    return false;
  }

  if (prev.series.length !== next.series.length) return false;

  const prevEpoch = prev.epochTs ?? [];
  const nextEpoch = next.epochTs ?? [];
  if (prevEpoch.length !== nextEpoch.length) return false;
  if (prevEpoch.length >= 2 && nextEpoch.length >= 2) {
    const windowJumpTolerance = Math.max((next.intervalSec ?? 5) * 3, 20);
    if (
      Math.abs(Number(nextEpoch[0]) - Number(prevEpoch[0])) > windowJumpTolerance ||
      Math.abs(Number(nextEpoch[nextEpoch.length - 1]) - Number(prevEpoch[prevEpoch.length - 1])) > windowJumpTolerance
    ) {
      return false;
    }
  }

  let leftScalePeak = typeof next.maxLeft === 'number' && next.maxLeft > 0 ? next.maxLeft : 0;
  let rightScalePeak = typeof next.maxRight === 'number' && next.maxRight > 0 ? next.maxRight : 100;

  for (let i = 0; i < next.series.length; i++) {
    const p = prev.series[i];
    const n = next.series[i];
    if (
      p.id !== n.id ||
      p.label !== n.label ||
      p.color !== n.color ||
      p.unit !== n.unit ||
      p.axis !== n.axis ||
      p.dashed !== n.dashed ||
      p.decimals !== n.decimals ||
      p.fillAlpha !== n.fillAlpha ||
      p.data.length !== n.data.length
    ) {
      return false;
    }
    for (let k = 0; k < n.data.length; k++) {
      const nv = Number(n.data[k]);
      const pv = Number(p.data[k]);
      if (n.axis === 'right') {
        if (Number.isFinite(nv) && nv > rightScalePeak) rightScalePeak = nv;
        if (Number.isFinite(pv) && pv > rightScalePeak) rightScalePeak = pv;
      } else {
        if (Number.isFinite(nv) && nv > leftScalePeak) leftScalePeak = nv;
        if (Number.isFinite(pv) && pv > leftScalePeak) leftScalePeak = pv;
      }
    }
  }

  const defaultLeftUnit = next.leftUnit ?? '%';
  for (let i = 0; i < next.series.length; i++) {
    const pData = prev.series[i].data;
    const nData = next.series[i].data;
    const len = nData.length;
    if (len === 0) continue;

    const unit = next.series[i].unit ?? defaultLeftUnit;
    const scalePeak = next.series[i].axis === 'right' ? rightScalePeak : leftScalePeak;
    const threshold = getSensorSignificantThreshold(
      unit,
      scalePeak,
      next.series[i].decimals,
      next.significantDelta
    );

    const pLast = Number(pData[len - 1] ?? 0);
    const nLast = Number(nData[len - 1] ?? 0);
    if (!Number.isFinite(pLast) || !Number.isFinite(nLast)) {
      if (pLast !== nLast) return false;
    } else {
      if ((pLast <= 0.001) !== (nLast <= 0.001)) return false;
      if (Math.abs(nLast - pLast) >= threshold) return false;
    }

    let pMin = Infinity;
    let pMax = -Infinity;
    let nMin = Infinity;
    let nMax = -Infinity;

    for (let k = 0; k < len; k++) {
      const pv = Number(pData[k] ?? 0);
      const nv = Number(nData[k] ?? 0);
      if (Number.isFinite(pv)) {
        if (pv < pMin) pMin = pv;
        if (pv > pMax) pMax = pv;
      }
      if (Number.isFinite(nv)) {
        if (nv < nMin) nMin = nv;
        if (nv > nMax) nMax = nv;
      }
      if (Math.abs(nv - pv) >= threshold) {
        return false;
      }
    }

    if (
      (Number.isFinite(pMax) && Number.isFinite(nMax) && Math.abs(nMax - pMax) >= threshold) ||
      (Number.isFinite(pMin) && Number.isFinite(nMin) && Math.abs(nMin - pMin) >= threshold)
    ) {
      return false;
    }
  }

  return true;
}

function formatAxisTick(value: number, unit: string, isPeakTop = false): string {
  if (!Number.isFinite(value) || value <= 0.0001) {
    return unit === '%' ? '0%' : '0';
  }
  if (unit === '%') {
    return `${Math.round(value)}%`;
  }
  if (unit === 'MB/s') {
    if (value < 1) {
      const kbps = value * 1024;
      if (kbps < 10) return `${kbps.toFixed(1).replace('.', ',')} KB/s`;
      return `${Math.round(kbps)} KB/s`;
    }
    if (value < 10) {
      return `${value.toFixed(isPeakTop ? 2 : 1).replace('.', ',')} MB/s`;
    }
    if (value < 100) {
      return `${value.toFixed(1).replace('.', ',')} MB/s`;
    }
    return `${Math.round(value)} MB/s`;
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} ${unit}`;
}

function formatEpochTick(epochSec: number, spanSec: number): string {
  const d = new Date(epochSec * 1000);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (spanSec >= 86400 * 0.9) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mo} ${hh}:${mm}`;
  }
  if (spanSec < 180) {
    return `${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}`;
}

function traceMonotoneSpline(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  startWithMoveTo = true
): void {
  const n = pts.length;
  if (n === 0) return;
  if (startWithMoveTo) ctx.moveTo(pts[0].x, pts[0].y);
  else ctx.lineTo(pts[0].x, pts[0].y);

  if (n === 1) return;
  if (n === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }

  // Fritsch-Carlson monotone cubic Hermite interpolation:
  // pasa EXACTAMENTE por cada punto pts[i] sin flotar encima ni debajo de los picos.
  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const slope: number[] = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    const rawDx = pts[i + 1].x - pts[i].x;
    dx[i] = Math.max(0.0001, rawDx);
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = rawDx < 0.25 ? 0 : dy[i] / dx[i];
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slope[i - 1] + slope[i]) * 0.5;
    }
  }

  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slope[i]) < 1e-6) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope[i];
      const b = m[i + 1] / slope[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const t = 3 / h;
        m[i] = t * a * slope[i];
        m[i + 1] = t * b * slope[i];
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    if (pts[i + 1].x - pts[i].x < 0.25) {
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      continue;
    }
    const segDx = dx[i] / 3;
    const cp1x = pts[i].x + segDx;
    const cp1y = pts[i].y + m[i] * segDx;
    const cp2x = pts[i + 1].x - segDx;
    const cp2y = pts[i + 1].y - m[i + 1] * segDx;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pts[i + 1].x, pts[i + 1].y);
  }
}

const TelemetryChartComponent: React.FC<TelemetryChartProps> = ({
  series,
  timestamps = [],
  dateTimestamps = [],
  epochTs = [],
  height = 152,
  maxLeft,
  maxRight = 100,
  leftUnit = '%',
  intervalSec = 5,
  theme,
  className = '',
  formatLabel,
  formatValue,
  emptyMessage,
  onExpandClick,
  interactionMode = 'inspect',
  onPanDeltaSteps,
}) => {
  const { t } = useI18n();
  const resolvedEmptyMessage = emptyMessage ?? t('charts.empty_collecting');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const panAnchorXRef = useRef<number | null>(null);
  const panAccumPxRef = useRef<number>(0);
  const didPanRef = useRef<boolean>(false);
  const plotBoundsRef = useRef<{ padL: number; padR: number; padT: number; padB: number }>({
    padL: 44,
    padR: 12,
    padT: 10,
    padB: 20,
  });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 320, height });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const animPhaseRef = useRef<number>(0);
  const mountStartMsRef = useRef<number>(0);
  const mountRevealedRef = useRef<boolean>(false);
  const drawChartRef = useRef<() => void>(() => {});

  const sampleCount = useMemo(() => {
    let maxLen = 0;
    for (const s of series) {
      if (s.data.length > maxLen) maxLen = s.data.length;
    }
    return maxLen;
  }, [series]);

  const hasRightAxis = useMemo(() => series.some((s) => s.axis === 'right'), [series]);
  const resolvedRightUnit = useMemo(() => series.find((s) => s.axis === 'right')?.unit ?? '%', [series]);

  const validEpochRange = useMemo(() => {
    if (!epochTs || epochTs.length < 2) return null;
    const usable = epochTs.slice(-sampleCount);
    if (usable.length < 2) return null;
    const tStart = Number(usable[0]);
    const tEnd = Number(usable[usable.length - 1]);
    if (!Number.isFinite(tStart) || !Number.isFinite(tEnd) || tEnd <= tStart) return null;
    return { tStart, tEnd, spanSec: tEnd - tStart, arr: usable };
  }, [epochTs, sampleCount]);

  useEffect(() => {
    setSize((prev) => (prev.height === height ? prev : { ...prev, height }));
  }, [height]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(120, Math.floor(entry.contentRect.width));
        setSize((prev) => (prev.width === w && prev.height === height ? prev : { width: w, height }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const computedMaxLeft = useMemo(() => {
    if (typeof maxLeft === 'number' && maxLeft > 0) return maxLeft;
    let peak = 0;
    for (const s of series) {
      if (s.axis === 'right') continue;
      for (const v of s.data) {
        if (Number.isFinite(v) && v > peak) peak = v;
      }
    }
    if (leftUnit === '%') return Math.max(100, Math.ceil(peak));
    // Para velocidades / flujos: el punto más alto registrado en la ventana visible es exactamente el techo de la escala
    return peak > 0.0001 ? peak : 0.1;
  }, [series, maxLeft, leftUnit]);

  // Memoización de buckets visuales de datos para curvas densas (preserva exactamente picos y valles)
  const bucketedSeries: BucketedSeriesResult[] = useMemo(() => {
    const maxBuckets = Math.max(48, Math.floor((size.width - 56) / 2.2));
    return series
      .filter((s) => s.data && s.data.length >= 2)
      .map((s) => {
        const { values, sourceIndices } = buildSeriesBuckets(s.data, maxBuckets);
        return { s, values, sourceIndices };
      });
  }, [series, size.width]);

  // Memoización del diseño de ejes, etiquetas de escala y rejilla temporal
  const axisLayout = useMemo(() => {
    const w = size.width;
    const h = size.height;
    const compact = h < 110;
    const fontAxis = `${compact ? '600 9.5px' : '600 10px'} ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    const gridFracs = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const leftLabels = gridFracs.map((f) =>
      formatAxisTick(computedMaxLeft * (1 - f), leftUnit, f === 0)
    );
    let maxLeftLabelW = 0;
    for (const lbl of leftLabels) {
      const mw = measureAxisTextWidth(lbl, fontAxis);
      if (mw > maxLeftLabelW) maxLeftLabelW = mw;
    }

    const maxRightLabelW = hasRightAxis
      ? measureAxisTextWidth(`${Math.round(maxRight)}${resolvedRightUnit}`, fontAxis)
      : 0;
    const padL = Math.max(leftUnit === '%' ? 34 : 48, Math.ceil(maxLeftLabelW) + 10);
    const padR = hasRightAxis ? Math.max(36, Math.ceil(maxRightLabelW) + 12) : 12;
    const padT = compact ? 9 : 11;
    const padB = compact ? 18 : 20;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(20, h - padT - padB);

    const gridLines = gridFracs.map((frac, i) => {
      const gy = Math.round(padT + plotH * frac) + 0.5;
      const yText = frac === 0 ? Math.max(7, gy + 1) : frac === 1 ? Math.min(padT + plotH - 1, gy) : gy;
      const rightVal = hasRightAxis ? `${Math.round(maxRight * (1 - frac))}${resolvedRightUnit}` : '';
      return {
        frac,
        gy,
        yText,
        leftLabel: leftLabels[i],
        rightLabel: rightVal,
      };
    });

    const tickCount = plotW < 230 ? 3 : plotW < 400 ? 4 : 5;
    let forceSecondsTick = false;
    if (validEpochRange) {
      const seenMm = new Set<string>();
      for (let ti = 0; ti < tickCount; ti++) {
        const frac = tickCount > 1 ? ti / (tickCount - 1) : 0;
        const tickTs = validEpochRange.tStart + frac * validEpochRange.spanSec;
        const lbl = formatEpochTick(tickTs, validEpochRange.spanSec);
        if (seenMm.has(lbl)) {
          forceSecondsTick = true;
          break;
        }
        seenMm.add(lbl);
      }
    }

    const xTicks: Array<{
      gx: number;
      showLine: boolean;
      label: string;
      align: CanvasTextAlign;
    }> = [];

    if (sampleCount >= 2) {
      for (let ti = 0; ti < tickCount; ti++) {
        const frac = tickCount > 1 ? ti / (tickCount - 1) : 0;
        const gx = Math.round(padL + frac * plotW) + 0.5;
        let xLabel = '';
        if (validEpochRange) {
          const tickTs = validEpochRange.tStart + frac * validEpochRange.spanSec;
          xLabel = formatEpochTick(tickTs, forceSecondsTick ? 120 : validEpochRange.spanSec);
        } else {
          const approxIdx = Math.round(frac * (sampleCount - 1));
          const rawDate = dateTimestamps[approxIdx];
          const rawTs = timestamps[approxIdx] || '';
          if (rawDate) {
            xLabel = rawDate.slice(0, 11);
          } else if (rawTs) {
            const estSpan = (sampleCount - 1) * intervalSec;
            xLabel = estSpan >= 180 && rawTs.length >= 5 ? rawTs.slice(0, 5) : rawTs;
          }
        }
        xTicks.push({
          gx,
          showLine: ti > 0 && ti < tickCount - 1,
          label: xLabel,
          align: ti === 0 ? 'left' : ti === tickCount - 1 ? 'right' : 'center',
        });
      }
    }

    return {
      w,
      h,
      fontAxis,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      gridLines,
      xTicks,
    };
  }, [
    size.width,
    size.height,
    computedMaxLeft,
    leftUnit,
    hasRightAxis,
    maxRight,
    resolvedRightUnit,
    validEpochRange,
    sampleCount,
    dateTimestamps,
    timestamps,
    intervalSec,
  ]);

  useEffect(() => {
    plotBoundsRef.current = {
      padL: axisLayout.padL,
      padR: axisLayout.padR,
      padT: axisLayout.padT,
      padB: axisLayout.padB,
    };
  }, [axisLayout.padL, axisLayout.padR, axisLayout.padT, axisLayout.padB]);

  const getXForGlobalIndex = useCallback(
    (globalIdx: number): number => {
      const { padL, plotW } = axisLayout;
      if (validEpochRange) {
        const offsetInEpoch = globalIdx - (sampleCount - validEpochRange.arr.length);
        const tVal = validEpochRange.arr[Math.max(0, Math.min(validEpochRange.arr.length - 1, offsetInEpoch))];
        if (Number.isFinite(tVal)) {
          const frac = Math.max(0, Math.min(1, (tVal - validEpochRange.tStart) / validEpochRange.spanSec));
          return padL + frac * plotW;
        }
      }
      return padL + (sampleCount > 1 ? (globalIdx / (sampleCount - 1)) * plotW : plotW);
    },
    [axisLayout, validEpochRange, sampleCount]
  );

  // Memoización de las coordenadas vectoriales por bucket/punto para evitar recalcular geometría a 30fps
  const computedSeriesGeometry = useMemo(() => {
    if (sampleCount < 2) return [];
    const { padT, plotH } = axisLayout;
    return bucketedSeries.map(({ s, values, sourceIndices }) => {
      const rawLen = s.data.length;
      const maxScale = s.axis === 'right' ? maxRight : computedMaxLeft;
      const denomScale = Math.max(0.0001, maxScale);
      const pts = values.map((val, bi) => {
        const origIdx = sourceIndices.length > 0 ? sourceIndices[bi] : bi;
        const ratio = Math.max(0, Math.min(1, val / denomScale));
        const xOffsetIdx = sampleCount - rawLen + origIdx;
        return {
          x: getXForGlobalIndex(xOffsetIdx),
          y: padT + plotH - ratio * plotH,
        };
      });
      return { s, pts, sourceIndices };
    });
  }, [bucketedSeries, axisLayout, sampleCount, maxRight, computedMaxLeft, getXForGlobalIndex]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h, fontAxis, padL, padR, padT, plotW, plotH, gridLines, xTicks } = axisLayout;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const gridColor = theme === 'dark' ? 'rgba(51, 65, 85, 0.55)' : 'rgba(203, 213, 225, 0.85)';
    const topLineColor = theme === 'dark' ? 'rgba(71, 85, 105, 0.7)' : 'rgba(203, 213, 225, 0.95)';
    const axisLabelColor = theme === 'dark' ? 'rgba(148, 163, 184, 0.9)' : 'rgba(100, 116, 139, 0.95)';
    const peakLabelColor = theme === 'dark' ? 'rgba(125, 211, 252, 0.98)' : 'rgba(2, 132, 199, 0.98)';
    const crosshairColor = theme === 'dark' ? 'rgba(56, 189, 248, 0.5)' : 'rgba(2, 132, 199, 0.42)';

    // Horizontal grid lines + Left/Right Y-axis scale labels
    ctx.font = fontAxis;
    ctx.textBaseline = 'middle';
    for (const line of gridLines) {
      ctx.save();
      ctx.strokeStyle = line.frac === 0 || line.frac === 1 ? topLineColor : gridColor;
      ctx.lineWidth = 1;
      if (line.frac > 0 && line.frac < 1) ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(padL, line.gy);
      ctx.lineTo(padL + plotW, line.gy);
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = 'right';
      ctx.fillStyle = line.frac === 0 && leftUnit !== '%' ? peakLabelColor : axisLabelColor;
      ctx.fillText(line.leftLabel, padL - 6, line.yText);

      if (hasRightAxis) {
        ctx.textAlign = 'left';
        ctx.fillStyle = axisLabelColor;
        ctx.fillText(line.rightLabel, padL + plotW + 6, line.yText);
      }
    }

    if (sampleCount < 2) return;

    // Vertical grid lines + X-axis Time scale ticks
    ctx.font = fontAxis;
    ctx.textBaseline = 'top';
    for (const tick of xTicks) {
      if (tick.showLine) {
        ctx.save();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(tick.gx, padT);
        ctx.lineTo(tick.gx, padT + plotH);
        ctx.stroke();
        ctx.restore();
      }
      if (tick.label) {
        ctx.fillStyle = axisLabelColor;
        ctx.textAlign = tick.align;
        ctx.fillText(tick.label, tick.gx, padT + plotH + 5);
      }
    }

    // Smooth horizontal clip reveal on initial mount
    const prefersReduced =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let revealFrac = 1;
    if (!prefersReduced && !mountRevealedRef.current) {
      if (mountStartMsRef.current === 0) mountStartMsRef.current = performance.now();
      const rawT = Math.min(1, (performance.now() - mountStartMsRef.current) / 560);
      revealFrac = 1 - Math.pow(1 - rawT, 3);
      if (rawT >= 1) mountRevealedRef.current = true;
    }

    ctx.save();
    if (revealFrac < 1) {
      ctx.beginPath();
      ctx.rect(padL - 4, 0, (plotW + padR + 8) * revealFrac, h);
      ctx.clip();
    }

    // 1. Draw gradient area fills under every curve first
    for (const { s, pts } of computedSeriesGeometry) {
      const fillAlpha = s.fillAlpha ?? (s.dashed ? 0 : 0.16);
      if (fillAlpha > 0) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, `${s.color}${Math.round(fillAlpha * 255).toString(16).padStart(2, '0')}`);
        grad.addColorStop(1, `${s.color}00`);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT + plotH);
        traceMonotoneSpline(ctx, pts, false);
        ctx.lineTo(pts[pts.length - 1].x, padT + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    // 2. Stroke smooth monotone spline lines (exact knot alignment, zero overshoot)
    for (const { s, pts } of computedSeriesGeometry) {
      ctx.save();
      ctx.beginPath();
      traceMonotoneSpline(ctx, pts, true);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.dashed ? 1.6 : 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.stroke();

      // Luminous traveling wave overlay clipped onto the EXACT full spline
      if (!s.dashed && pts.length >= 6 && revealFrac >= 1) {
        const sweepFrac = animPhaseRef.current % 1;
        const winStartX = padL + Math.max(0, sweepFrac - 0.14) * plotW;
        const winEndX = padL + Math.min(1, sweepFrac + 0.04) * plotW;
        if (winEndX > winStartX) {
          const glowGrad = ctx.createLinearGradient(winStartX, 0, winEndX, 0);
          const highlightColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.36)' : 'rgba(255, 255, 255, 0.58)';
          glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
          glowGrad.addColorStop(0.55, highlightColor);
          glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.beginPath();
          traceMonotoneSpline(ctx, pts, true);
          ctx.strokeStyle = glowGrad;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    const dotBgFill = theme === 'dark' ? '#0f172a' : '#ffffff';

    // 3. Draw pulsing live tip beacon STRICTLY ON TOP OF all lines and right ON the final knot
    const pulseWave = 0.5 + 0.5 * Math.sin(animPhaseRef.current * Math.PI * 2);
    for (const { s, pts } of computedSeriesGeometry) {
      if (s.dashed || pts.length === 0) continue;

      const tip = pts[pts.length - 1];
      ctx.save();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4.2 + pulseWave * 4.8, 0, Math.PI * 2);
      ctx.fillStyle = `${s.color}${Math.round((0.32 - pulseWave * 0.24) * 255).toString(16).padStart(2, '0')}`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = dotBgFill;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // 4. Hover / touch crosshair & highlighted active sample points
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < sampleCount) {
      const xPos = getXForGlobalIndex(hoverIdx);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xPos, padT);
      ctx.lineTo(xPos, padT + plotH);
      ctx.strokeStyle = crosshairColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.restore();

      for (const { s, pts, sourceIndices } of computedSeriesGeometry) {
        const localIdx = hoverIdx - (sampleCount - s.data.length);
        if (localIdx < 0 || localIdx >= s.data.length) continue;

        let pt: { x: number; y: number } | undefined;
        if (sourceIndices.length === 0) {
          pt = pts[localIdx];
        } else {
          let lo = 0;
          let hi = sourceIndices.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sourceIndices[mid] < localIdx) lo = mid + 1;
            else hi = mid;
          }
          const bestIdx =
            lo > 0 && Math.abs(sourceIndices[lo - 1] - localIdx) < Math.abs(sourceIndices[lo] - localIdx)
              ? lo - 1
              : lo;
          pt = pts[bestIdx];
        }
        if (!pt) continue;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.8, 0, Math.PI * 2);
        ctx.fillStyle = dotBgFill;
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = s.color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }
  }, [axisLayout, computedSeriesGeometry, getXForGlobalIndex, leftUnit, hasRightAxis, sampleCount, theme, hoverIdx]);

  drawChartRef.current = drawChart;

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  // Continuous lightweight 30fps live animation loop (sonar tip beacon + subtle wave sweep)
  useEffect(() => {
    if (sampleCount < 2 || typeof window === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let rafId = 0;
    let lastTick = 0;
    const step = (ts: number) => {
      rafId = window.requestAnimationFrame(step);
      if (document.hidden) return;
      if (ts - lastTick < 34) return;
      lastTick = ts;
      animPhaseRef.current = (ts / 2400) % 1;
      drawChartRef.current();
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [sampleCount]);

  const updatePointer = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || sampleCount < 2) return;
      const rect = canvas.getBoundingClientRect();
      const { padL, padR } = plotBoundsRef.current;
      const plotW = Math.max(1, rect.width - padL - padR);
      const relX = Math.max(0, Math.min(plotW, clientX - rect.left - padL));
      const frac = relX / plotW;

      let idx = Math.round(frac * (sampleCount - 1));
      if (validEpochRange) {
        const targetTs = validEpochRange.tStart + frac * validEpochRange.spanSec;
        let bestDist = Infinity;
        let bestLocal = 0;
        const arr = validEpochRange.arr;
        for (let i = 0; i < arr.length; i++) {
          const dist = Math.abs(arr[i] - targetTs);
          if (dist < bestDist) {
            bestDist = dist;
            bestLocal = i;
          }
        }
        idx = (sampleCount - arr.length) + bestLocal;
      }

      setHoverIdx(Math.max(0, Math.min(sampleCount - 1, idx)));
      setPointerPos({ x: clientX, y: clientY });
    },
    [sampleCount, validEpochRange]
  );

  const clearPointer = useCallback(() => {
    setHoverIdx(null);
    setPointerPos(null);
  }, []);

  const tooltipData: FloatingTooltipData | null = useMemo(() => {
    if (hoverIdx === null || !pointerPos || sampleCount < 2) return null;
    const fullDateTitle = dateTimestamps[hoverIdx];
    const title = formatLabel
      ? formatLabel(hoverIdx)
      : fullDateTitle || timestamps[hoverIdx] || t('charts.sample_n', { n: hoverIdx + 1 });
    let computedSubtitle: string | undefined;
    if (!formatLabel) {
      if (fullDateTitle) {
        computedSubtitle = t('charts.sample_of', { n: hoverIdx + 1, total: sampleCount });
      } else if (validEpochRange) {
        const epochIdx = Math.max(0, Math.min(validEpochRange.arr.length - 1, hoverIdx - (sampleCount - validEpochRange.arr.length)));
        const ageSec = Math.max(0, Math.round(validEpochRange.tEnd - validEpochRange.arr[epochIdx]));
        if (ageSec <= 3) computedSubtitle = t('time.now');
        else if (ageSec < 60) computedSubtitle = t('time.seconds_ago', { seconds: ageSec });
        else {
          const mins = Math.floor(ageSec / 60);
          const remSec = ageSec % 60;
          computedSubtitle =
            remSec > 0
              ? t('time.minutes_seconds_ago', { minutes: mins, seconds: remSec })
              : t('time.minutes_ago', { minutes: mins });
        }
      } else {
        computedSubtitle = formatRelativeIndexAge(hoverIdx, sampleCount, intervalSec);
      }
    }
    const subtitle = computedSubtitle;
    const entries = series
      .map((s) => {
        const localIdx = hoverIdx - (sampleCount - s.data.length);
        if (localIdx < 0 || localIdx >= s.data.length) return null;
        const val = Number(s.data[localIdx] ?? 0);
        const dec = s.decimals ?? 1;
        const formatted = formatValue
          ? formatValue(s, val)
          : `${val.toFixed(dec).replace('.', ',')} ${s.unit ?? leftUnit}`;
        return {
          label: s.label,
          value: formatted,
          color: s.color,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (entries.length === 0) return null;

    return {
      visible: true,
      clientX: pointerPos.x,
      clientY: pointerPos.y,
      title,
      subtitle,
      entries,
    };
  }, [hoverIdx, pointerPos, sampleCount, timestamps, dateTimestamps, validEpochRange, intervalSec, series, formatLabel, formatValue, leftUnit, t]);

  const handlePanMove = useCallback(
    (clientX: number) => {
      if (interactionMode !== 'pan' || !onPanDeltaSteps || panAnchorXRef.current === null) return;
      const dx = clientX - panAnchorXRef.current;
      panAnchorXRef.current = clientX;
      panAccumPxRef.current += dx;
      const pxPerStep = Math.max(8, (size.width - 12) / Math.max(12, Math.min(sampleCount, 40)));
      const stepDelta = Math.trunc(panAccumPxRef.current / pxPerStep);
      if (stepDelta !== 0) {
        didPanRef.current = true;
        panAccumPxRef.current -= stepDelta * pxPerStep;
        // Arrastrar hacia la derecha -> retroceder en el tiempo (delta negativo = hacia el pasado)
        onPanDeltaSteps(-stepDelta);
      }
    },
    [interactionMode, onPanDeltaSteps, size.width, sampleCount]
  );

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px` }}
      className={`relative w-full select-none ${
        onExpandClick
          ? 'cursor-pointer'
          : interactionMode === 'pan'
            ? 'cursor-grab active:cursor-grabbing'
            : ''
      } ${className}`}
      onClick={() => {
        if (didPanRef.current) {
          didPanRef.current = false;
          return;
        }
        if (onExpandClick) onExpandClick();
      }}
      onWheel={(e) => {
        if (!onPanDeltaSteps) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
        if (Math.abs(delta) >= 6) {
          e.preventDefault();
          onPanDeltaSteps(delta > 0 ? 4 : -4);
        }
      }}
    >
      {sampleCount < 2 ? (
        <div className="flex h-full items-center justify-center text-xs text-slate-400 dark:text-slate-500">
          {resolvedEmptyMessage}
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: `${height}px` }}
          className={`block ${interactionMode === 'pan' ? 'touch-none' : 'touch-pan-y'}`}
          onPointerDown={(e) => {
            if (interactionMode === 'pan') {
              panAnchorXRef.current = e.clientX;
              panAccumPxRef.current = 0;
              didPanRef.current = false;
            }
          }}
          onPointerMove={(e) => {
            if (interactionMode === 'pan' && panAnchorXRef.current !== null && (e.buttons & 1) === 1) {
              handlePanMove(e.clientX);
            } else {
              updatePointer(e.clientX, e.clientY);
            }
          }}
          onPointerUp={() => {
            panAnchorXRef.current = null;
            panAccumPxRef.current = 0;
          }}
          onPointerLeave={() => {
            panAnchorXRef.current = null;
            panAccumPxRef.current = 0;
            clearPointer();
          }}
          onTouchStart={(e) => {
            if (e.touches[0]) {
              if (interactionMode === 'pan') {
                panAnchorXRef.current = e.touches[0].clientX;
                panAccumPxRef.current = 0;
                didPanRef.current = false;
              } else {
                updatePointer(e.touches[0].clientX, e.touches[0].clientY);
              }
            }
          }}
          onTouchMove={(e) => {
            if (e.touches[0]) {
              if (interactionMode === 'pan') {
                handlePanMove(e.touches[0].clientX);
              } else {
                updatePointer(e.touches[0].clientX, e.touches[0].clientY);
              }
            }
          }}
          onTouchEnd={() => {
            panAnchorXRef.current = null;
            panAccumPxRef.current = 0;
            clearPointer();
          }}
        />
      )}
      <FloatingTooltip data={tooltipData} />
    </div>
  );
};

export const TelemetryChart = React.memo(TelemetryChartComponent, areTelemetryChartPropsEqual);

