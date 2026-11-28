import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ThemeMode } from '../types/telemetry';
import { useI18n } from '../i18n';
import { useThemeCatalog } from '../themes';
import { getActiveThemeChartPalette } from '../themes/types';

interface RadialKpiGaugeProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  theme?: ThemeMode;
  invertedDark?: boolean;
  showPercentSign?: boolean;
}

/**
 * Anillo KPI radial segmentado (Zeus Vision — cuotas/saturación de un vistazo).
 * Aplica semántica automática de color si no se fija un tono explícito:
 * óptimo (botánico) -> elevado (ámbar) -> crítico (coral).
 */
export const RadialKpiGauge: React.FC<RadialKpiGaugeProps> = ({
  value,
  size = 54,
  strokeWidth = 5,
  color,
  label,
  theme = 'light',
  invertedDark = false,
  showPercentSign = true,
}) => {
  const { activeTheme } = useThemeCatalog();
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);
  const darkSurface = invertedDark || theme === 'dark';
  const chartPal = getActiveThemeChartPalette(activeTheme, darkSurface ? 'dark' : 'light');
  const isCustomTheme = activeTheme.id !== 'alethia-matrix';

  const resolvedStroke =
    color ??
    (pct >= 88
      ? darkSurface
        ? '#fb7185'
        : '#dc2626'
      : pct >= 70
        ? darkSurface
          ? '#fbbf24'
          : '#d97706'
        : isCustomTheme && chartPal?.primary
          ? chartPal.primary
          : darkSurface
            ? '#c6f19d'
            : '#1e6b38');

  const trackColor =
    isCustomTheme && chartPal?.grid
      ? chartPal.grid
      : darkSurface
        ? 'rgba(198, 241, 157, 0.14)'
        : 'rgba(15, 31, 16, 0.09)';

  return (
    <div className="inline-flex flex-col items-center justify-center shrink-0">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={resolvedStroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 520ms cubic-bezier(0.22, 1, 0.36, 1), stroke 240ms ease' }}
          />
        </svg>
        <span
          className={`absolute font-mono font-bold tabular-nums leading-none ${
            size >= 54 ? 'text-[11px]' : 'text-[10px]'
          } ${darkSurface ? 'text-[#f5f4f2]' : 'text-[#0f1f10]'}`}
        >
          {Math.round(pct)}
          {showPercentSign ? '%' : ''}
        </span>
      </div>
      {label ? (
        <span
          className={`mt-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.07em] ${
            darkSurface ? 'text-[#a8b6a9]' : 'text-slate-500'
          }`}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

interface AlethiaSectionTagProps {
  children: React.ReactNode;
  pulse?: boolean;
  tone?: 'lime' | 'amber' | 'danger';
  className?: string;
}

/**
 * Etiqueta técnica de capa estilo Alethia (fondo lima #C6F19D o semántico ámbar/coral, texto obsidiana #0F1F10).
 */
export const AlethiaSectionTag: React.FC<AlethiaSectionTagProps> = ({
  children,
  pulse = false,
  tone = 'lime',
  className = '',
}) => {
  const toneOverride =
    tone === 'amber'
      ? '!bg-[#fcd34d] !text-[#0f1f10]'
      : tone === 'danger'
        ? '!bg-[#fda4af] !text-[#0f1f10]'
        : '';
  return (
    <span className={`cockpit-tag-lime ${toneOverride} ${className}`}>
      {pulse ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#144d23] dark:bg-[#0f1f10] cockpit-live-dot" aria-hidden="true" />
      ) : null}
      <span>{children}</span>
    </span>
  );
};

interface AlethiaActionButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'dark' | 'surface';
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

/**
 * Botón arquitectónico firma Alethia: borde fino + etiqueta mono + icono cuadrado lima [#C6F19D].
 */
export const AlethiaActionButton: React.FC<AlethiaActionButtonProps> = ({
  label,
  onClick,
  variant = 'surface',
  icon,
  className = '',
  disabled = false,
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`cockpit-btn-alethia ${
      variant === 'dark' ? 'cockpit-btn-alethia-dark' : 'cockpit-btn-alethia-surface'
    } min-h-[42px] cursor-pointer whitespace-nowrap disabled:opacity-50 ${className}`}
  >
    <span className="truncate">{label}</span>
    <span className="cockpit-btn-alethia-icon" aria-hidden="true">
      {icon ?? <ChevronRight className="h-3.5 w-3.5" />}
    </span>
  </button>
);

interface ChartNarrativeFooterProps {
  data: number[];
  secondaryData?: number[];
  unit: string;
  decimals?: number;
  formatValue?: (val: number) => string;
}

/**
 * Pie narrativo compacto bajo gráficas (Zeus Vision Storytelling + Alethia Main Sensor AVERAGE):
 * resume Media, Pico y Valor Actual en tipografía tabular limpia.
 */
export const ChartNarrativeFooter: React.FC<ChartNarrativeFooterProps> = ({
  data,
  secondaryData,
  unit,
  decimals = 1,
  formatValue,
}) => {
  const { t } = useI18n();

  const stats = React.useMemo(() => {
    const len = Math.max(data.length, secondaryData?.length ?? 0);
    let count = 0;
    let sum = 0;
    let peak = -Infinity;
    let last = 0;
    for (let i = 0; i < len; i++) {
      const a = i < data.length ? Number(data[i]) : NaN;
      const b = secondaryData && i < secondaryData.length ? Number(secondaryData[i]) : NaN;
      const aOk = Number.isFinite(a);
      const bOk = Number.isFinite(b);
      if (!aOk && !bOk) continue;
      const v = aOk && bOk ? Math.max(a, b) : aOk ? a : b;
      count += 1;
      sum += v;
      if (v > peak) peak = v;
      last = v;
    }
    if (count === 0) return null;
    return { avg: sum / count, peak: Math.max(0, peak), now: last };
  }, [data, secondaryData]);

  if (!stats) return null;

  const fmt = (v: number) => {
    if (formatValue) return formatValue(v);
    if (unit === 'MB/s') {
      if (v < 1 && v > 0) return `${Math.round(v * 1024)} KB/s`;
      return `${v.toFixed(v < 10 ? 2 : 1).replace('.', ',')} MB/s`;
    }
    return `${v.toFixed(decimals).replace('.', ',')}${unit === '%' ? '%' : ` ${unit}`}`;
  };

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2 font-mono text-[10.5px] tabular-nums text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <span className="inline-flex items-center gap-1 min-w-0">
        <span className="uppercase tracking-[0.06em] opacity-75">{t('charts.stat_avg')}</span>
        <strong className="font-semibold text-slate-700 dark:text-slate-200">{fmt(stats.avg)}</strong>
      </span>
      <span className="inline-flex items-center gap-1 min-w-0">
        <span className="uppercase tracking-[0.06em] opacity-75">{t('charts.stat_peak')}</span>
        <strong className="font-semibold text-[var(--accent)]">{fmt(stats.peak)}</strong>
      </span>
      <span className="inline-flex items-center gap-1 min-w-0">
        <span className="uppercase tracking-[0.06em] opacity-75">{t('charts.stat_now')}</span>
        <strong className="font-semibold text-slate-900 dark:text-white">{fmt(stats.now)}</strong>
      </span>
    </div>
  );
};
