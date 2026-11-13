import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { formatRelativeIndexAge } from '../utils/formatters';
import { ThemeMode } from '../types/telemetry';

export interface ChartSeries {
  id: string;
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
  height?: number;
  maxLeft?: number;
  maxRight?: number;
  leftUnit?: string;
  intervalSec?: number;
  theme: ThemeMode;
  className?: string;
  formatLabel?: (index: number) => string;
  formatValue?: (series: ChartSeries, value: number) => string;
  emptyMessage?: string;
  onExpandClick?: () => void;
}

export const TelemetryChart: React.FC<TelemetryChartProps> = ({
  series,
  timestamps = [],
  height = 152,
  maxLeft,
  maxRight = 100,
  leftUnit = '%',
  intervalSec = 1.5,
  theme,
  className = '',
  formatLabel,
  formatValue,
  emptyMessage = 'Recopilando datos en tiempo real...',
  onExpandClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 320, height });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  const sampleCount = useMemo(() => {
    let maxLen = 0;
    for (const s of series) {
      if (s.data.length > maxLen) maxLen = s.data.length;
    }
    return maxLen;
  }, [series]);

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
    let peak = 1;
    for (const s of series) {
      if (s.axis === 'right') continue;
      for (const v of s.data) {
        if (Number.isFinite(v) && v > peak) peak = v;
      }
    }
    if (leftUnit === '%') return Math.max(100, Math.ceil(peak));
    if (peak <= 2) return 2;
    if (peak <= 10) return Math.ceil(peak * 1.25);
    return Math.ceil(peak * 1.2);
  }, [series, maxLeft, leftUnit]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = size.width;
    const h = size.height;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 6;
    const padR = 6;
    const padT = 10;
    const padB = 10;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(20, h - padT - padB);

    const gridColor = theme === 'dark' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.06)';
    const crosshairColor = theme === 'dark' ? 'rgba(226, 232, 240, 0.35)' : 'rgba(15, 23, 42, 0.25)';

    // Subtle horizontal grid lines (25%, 50%, 75%)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75]) {
      const gy = Math.round(padT + plotH * frac) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
    }

    if (sampleCount < 2) return;

    const getPointXY = (s: ChartSeries, idx: number): { x: number; y: number } => {
      const len = s.data.length;
      const val = Number(s.data[idx] ?? 0);
      const maxScale = s.axis === 'right' ? maxRight : computedMaxLeft;
      const ratio = Math.max(0, Math.min(1, val / Math.max(0.0001, maxScale)));
      const xOffsetIdx = sampleCount - len + idx;
      const x = padL + (sampleCount > 1 ? (xOffsetIdx / (sampleCount - 1)) * plotW : plotW);
      const y = padT + plotH - ratio * plotH;
      return { x, y };
    };

    // Draw each series smoothly
    for (const s of series) {
      if (!s.data || s.data.length < 2) continue;
      const pts = s.data.map((_, i) => getPointXY(s, i));

      // Area fill if fillAlpha > 0
      const fillAlpha = s.fillAlpha ?? (s.dashed ? 0 : 0.14);
      if (fillAlpha > 0) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, `${s.color}${Math.round(fillAlpha * 255).toString(16).padStart(2, '0')}`);
        grad.addColorStop(1, `${s.color}00`);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT + plotH);
        ctx.lineTo(pts[0].x, pts[0].y);
        for (let i = 0; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(pts[pts.length - 1].x, padT + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Stroke line
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.dashed ? 1.6 : 2.1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }

    // Hover / touch crosshair & highlighted sample points
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < sampleCount) {
      const xPos = padL + (sampleCount > 1 ? (hoverIdx / (sampleCount - 1)) * plotW : plotW);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xPos, padT);
      ctx.lineTo(xPos, padT + plotH);
      ctx.strokeStyle = crosshairColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.restore();

      for (const s of series) {
        const localIdx = hoverIdx - (sampleCount - s.data.length);
        if (localIdx < 0 || localIdx >= s.data.length) continue;
        const pt = getPointXY(s, localIdx);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = theme === 'dark' ? '#111827' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s.color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }
  }, [size, series, sampleCount, computedMaxLeft, maxRight, theme, hoverIdx]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  const updatePointer = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || sampleCount < 2) return;
      const rect = canvas.getBoundingClientRect();
      const padL = 6;
      const padR = 6;
      const plotW = Math.max(1, rect.width - padL - padR);
      const relX = Math.max(0, Math.min(plotW, clientX - rect.left - padL));
      const idx = Math.round((relX / plotW) * (sampleCount - 1));
      setHoverIdx(Math.max(0, Math.min(sampleCount - 1, idx)));
      setPointerPos({ x: clientX, y: clientY });
    },
    [sampleCount]
  );

  const clearPointer = useCallback(() => {
    setHoverIdx(null);
    setPointerPos(null);
  }, []);

  const tooltipData: FloatingTooltipData | null = useMemo(() => {
    if (hoverIdx === null || !pointerPos || sampleCount < 2) return null;
    const title = formatLabel
      ? formatLabel(hoverIdx)
      : timestamps[hoverIdx] || `Muestra ${hoverIdx + 1}`;
    const subtitle = formatLabel ? undefined : formatRelativeIndexAge(hoverIdx, sampleCount, intervalSec);
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
  }, [hoverIdx, pointerPos, sampleCount, timestamps, intervalSec, series, formatLabel, formatValue, leftUnit]);

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px` }}
      className={`relative w-full select-none ${onExpandClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={() => {
        if (onExpandClick) onExpandClick();
      }}
    >
      {sampleCount < 2 ? (
        <div className="flex h-full items-center justify-center text-xs text-slate-400 dark:text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: `${height}px` }}
          className="block touch-pan-y"
          onPointerMove={(e) => updatePointer(e.clientX, e.clientY)}
          onPointerLeave={clearPointer}
          onTouchStart={(e) => {
            if (e.touches[0]) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchMove={(e) => {
            if (e.touches[0]) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchEnd={clearPointer}
        />
      )}
      <FloatingTooltip data={tooltipData} />
    </div>
  );
};
