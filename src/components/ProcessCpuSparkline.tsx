import React, { useId } from 'react';
import { SystemProcess } from '../types/telemetry';
import { formatPct } from '../utils/formatters';
import { useI18n } from '../i18n';

const MAX_SAMPLES = 24;
const MAX_TRACKED_PROCESSES = 240;

interface ProcessHistoryEntry {
  samples: number[];
  lastSeenTick: number;
}

const processCpuHistoryMap = new Map<string, ProcessHistoryEntry>();
let globalTick = 0;
let lastRecordedArrayRef: SystemProcess[] | null = null;

export function getProcessHistoryKey(pid: string | number, name: string): string {
  return `${pid}:${name}`;
}

/**
 * Registra una instantánea real de consumo CPU por proceso en el buffer circular en memoria.
 * Es idempotente sobre la misma referencia de array para evitar duplicados por re-render.
 */
export function recordProcessCpuSamples(processes?: SystemProcess[] | null): void {
  if (!processes || processes.length === 0) return;
  if (processes === lastRecordedArrayRef) return;
  lastRecordedArrayRef = processes;
  globalTick += 1;

  for (const proc of processes) {
    const key = getProcessHistoryKey(proc.pid, proc.name);
    const val = Math.max(
      0,
      Math.min(100, Number(proc.cpu_norm_percent ?? proc.cpu_percent ?? 0) || 0)
    );
    const existing = processCpuHistoryMap.get(key);
    if (existing) {
      existing.samples.push(Math.round(val * 10) / 10);
      if (existing.samples.length > MAX_SAMPLES) {
        existing.samples.splice(0, existing.samples.length - MAX_SAMPLES);
      }
      existing.lastSeenTick = globalTick;
    } else {
      processCpuHistoryMap.set(key, {
        samples: [Math.round(val * 10) / 10],
        lastSeenTick: globalTick,
      });
    }
  }

  // Poda acotada de procesos terminados para evitar crecimiento en memoria
  if (processCpuHistoryMap.size > MAX_TRACKED_PROCESSES) {
    for (const [k, entry] of processCpuHistoryMap.entries()) {
      if (globalTick - entry.lastSeenTick > 25) {
        processCpuHistoryMap.delete(k);
      }
    }
  }
}

export function getProcessCpuTrend(pid: string | number, name: string, currentPct: number): number[] {
  const key = getProcessHistoryKey(pid, name);
  const entry = processCpuHistoryMap.get(key);
  if (entry && entry.samples.length > 0) {
    return entry.samples;
  }
  const safeVal = Math.max(0, Math.min(100, Number(currentPct) || 0));
  return [Math.round(safeVal * 10) / 10];
}

/**
 * Determina si un proceso merece sparkline de tendencia de consumo alto:
 * - CPU normalizada actual >= 2.0 % (o bruta >= 5.0 %)
 * - O pico reciente en el buffer >= 2.0 %
 * - O figura entre los 5 procesos con mayor consumo activo (> 0.5 %)
 */
export function isHighConsumptionCpuProcess(opts: {
  normPct: number;
  rawPct?: number;
  rankIndex: number;
  samples: number[];
}): boolean {
  const peak = opts.samples.length > 0 ? Math.max(...opts.samples) : opts.normPct;
  if (opts.normPct >= 2.0 || (opts.rawPct !== undefined && opts.rawPct >= 5.0) || peak >= 2.0) {
    return true;
  }
  return opts.rankIndex < 5 && opts.normPct >= 0.5;
}

interface ProcessCpuSparklineProps {
  samples: number[];
  currentPct: number;
  width?: number;
  height?: number;
}

export const ProcessCpuSparkline: React.FC<ProcessCpuSparklineProps> = React.memo(
  ({ samples, currentPct, width = 54, height = 18 }) => {
    const { t } = useI18n();
    const gradId = useId();

    const points = samples.length >= 2 ? samples : [currentPct, currentPct];
    const peak = Math.max(...points, currentPct);
    const yCeiling = Math.min(100, Math.max(10, peak * 1.2));

    const padX = 2;
    const padY = 2.5;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const denom = Math.max(1, points.length - 1);

    const coords = points.map((v, i) => {
      const clamped = Math.max(0, Math.min(yCeiling, v));
      const x = padX + (i / denom) * innerW;
      const y = padY + innerH - (clamped / yCeiling) * innerH;
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });

    const linePath = coords
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`)
      .join(' ');
    const lastPt = coords[coords.length - 1];
    const firstPt = coords[0];
    const bottomY = padY + innerH;
    const areaPath = `${linePath} L${lastPt.x} ${bottomY} L${firstPt.x} ${bottomY} Z`;

    const toneClass =
      currentPct >= 60 || peak >= 70
        ? 'text-rose-600 dark:text-rose-400'
        : currentPct >= 25 || peak >= 35
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-[var(--accent)]';

    const summaryTitle = `${t('charts.stat_now')}: ${formatPct(currentPct)} · ${t('charts.stat_peak')}: ${formatPct(peak)}`;

    return (
      <span
        className={`inline-flex items-center shrink-0 ${toneClass}`}
        title={summaryTitle}
        role="img"
        aria-label={summaryTitle}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          fill="none"
          className="overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={lastPt.x} cy={lastPt.y} r="1.8" fill="currentColor" />
        </svg>
      </span>
    );
  }
);

ProcessCpuSparkline.displayName = 'ProcessCpuSparkline';
