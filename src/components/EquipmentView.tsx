import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  ListChecks,
  Maximize2,
  MemoryStick,
  Monitor,
  Search,
} from 'lucide-react';
import { AccordionBody, AnimatedMetricValue, MorphPill, ViewStage } from './MotionPrimitives';
import { ExpandChartSpec } from './OverviewView';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { MetricsPayload, SystemProcess, ThemeMode } from '../types/telemetry';
import { formatBytes, formatMbRate, formatPct, formatTemp } from '../utils/formatters';
import { formatDiskFstype, formatDiskLabel, formatDiskTransport, useI18n } from '../i18n';

type EquipmentSubTab = 'cpu' | 'ram' | 'gpu' | 'storage' | 'processes';

function resolveEquipmentSubTab(hint?: string): EquipmentSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'cpu' || h === 'procesador') return 'cpu';
  if (h === 'ram' || h === 'memoria') return 'ram';
  if (h === 'gpu' || h === 'grafica') return 'gpu';
  if (h === 'storage' || h === 'almacenamiento') return 'storage';
  if (h === 'processes' || h === 'procesos') return 'processes';
  return undefined;
}

interface EquipmentViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  initialSubTab?: string;
  navTick?: number;
  onExpandChart?: (spec: ExpandChartSpec) => void;
}

export const EquipmentView: React.FC<EquipmentViewProps> = ({
  metrics,
  theme,
  initialSubTab,
  navTick,
  onExpandChart,
}) => {
  const { t, locale } = useI18n();
  const [subTab, setSubTab] = useState<EquipmentSubTab>(() => resolveEquipmentSubTab(initialSubTab) || 'cpu');
  const [showTech, setShowTech] = useState(false);
  const [procQuery, setProcQuery] = useState('');
  const [procSort, setProcSort] = useState<'cpu' | 'mem' | 'vram'>('cpu');
  const [coreTooltip, setCoreTooltip] = useState<FloatingTooltipData | null>(null);

  useEffect(() => {
    const mapped = resolveEquipmentSubTab(initialSubTab);
    if (mapped) setSubTab(mapped);
  }, [initialSubTab, navTick]);

  const hist = metrics?.history;
  const timestamps = hist?.timestamps ?? [];
  const epochTs = hist?.epoch_ts ?? [];

  const cpuCores = useMemo(() => metrics?.cpu?.per_core_percent ?? [], [metrics?.cpu?.per_core_percent]);
  const cpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'cpu', metricKey: 'cpu', label: t('equipment.sort_cpu'), data: hist?.cpu ?? [], color: '#0284c7', unit: '%' }],
    [hist?.cpu, t]
  );
  const ramSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'ram', metricKey: 'ram', label: t('hardware.ram.active_series'), data: hist?.ram ?? [], color: '#10b981', unit: '%' },
      { id: 'ram_tot', metricKey: 'ram_total', label: t('hardware.ram.total_cached_series'), data: hist?.ram_total ?? [], color: '#7c3aed', unit: '%', fillAlpha: 0, dashed: true },
    ],
    [hist?.ram, hist?.ram_total, t]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', metricKey: 'gpu', label: t('hardware.gpu.title'), data: hist?.gpu ?? [], color: '#7c3aed', unit: '%' }],
    [hist?.gpu, t]
  );

  const disks = useMemo(() => metrics?.disks ?? [], [metrics?.disks]);
  const diskReadHist = hist?.disk_r ?? [];
  const diskWriteHist = hist?.disk_w ?? [];
  const diskPctHist = useMemo(() => {
    if (hist?.disk_pct && hist.disk_pct.length > 0) return hist.disk_pct;
    const avg = disks.length ? disks[0].percent ?? 0 : 0;
    return diskReadHist.map(() => avg);
  }, [hist?.disk_pct, diskReadHist, disks]);

  const storageSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'r', metricKey: 'disk_r', label: t('hardware.storage.read'), data: diskReadHist, color: '#f59e0b', unit: 'MB/s', decimals: 2, axis: 'left' },
      { id: 'w', metricKey: 'disk_w', label: t('hardware.storage.write'), data: diskWriteHist, color: '#ea580c', unit: 'MB/s', decimals: 2, axis: 'left' },
      { id: 'p', metricKey: 'disk_pct', label: t('hardware.storage.used_space'), data: diskPctHist, color: '#64748b', unit: '%', decimals: 1, dashed: true, fillAlpha: 0, axis: 'right' },
    ],
    [diskReadHist, diskWriteHist, diskPctHist, t]
  );

  const filteredProcesses = useMemo(() => {
    const q = procQuery.trim().toLowerCase();
    const list: SystemProcess[] = [...(metrics?.system_processes ?? [])];
    const filtered = q
      ? list.filter((p) => p.name.toLowerCase().includes(q) || String(p.user || '').toLowerCase().includes(q))
      : list;
    filtered.sort((a, b) => {
      if (procSort === 'mem') return Number(b.priv_mb || b.mem_mb || 0) - Number(a.priv_mb || a.mem_mb || 0);
      if (procSort === 'vram') return Number(b.vram_mb || 0) - Number(a.vram_mb || 0);
      return Number(b.cpu_percent || 0) - Number(a.cpu_percent || 0);
    });
    return filtered.slice(0, 60);
  }, [metrics?.system_processes, procQuery, procSort]);

  const subTabs: Array<{ id: EquipmentSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'cpu', label: t('equipment.sort_cpu'), icon: <Cpu className="h-4 w-4" /> },
    { id: 'ram', label: t('hardware.ram.short_title'), icon: <MemoryStick className="h-4 w-4" /> },
    { id: 'gpu', label: t('hardware.gpu.short_title'), icon: <Monitor className="h-4 w-4" /> },
    { id: 'storage', label: t('hardware.storage.title'), icon: <HardDrive className="h-4 w-4" /> },
    { id: 'processes', label: t('equipment.processes'), icon: <ListChecks className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Sub-navigation segmented bar with animated MorphPill */}
      <LayoutGroup id="equipment-subtabs">
        <div className="cockpit-segmented flex items-center gap-1.5 overflow-x-auto p-1.5 no-scrollbar">
          {subTabs.map((tab) => {
            const active = subTab === tab.id;
            return (
              <motion.button
                whileTap={{ scale: 0.97 }}
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`relative inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="equipment-subtab-pill" className="rounded-xl" />}
                <span className="relative z-10 inline-flex items-center gap-2">
                  {tab.icon}
                  <span>{tab.label}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </LayoutGroup>

      <ViewStage tabKey={subTab}>
        {/* Subview: CPU */}
        {subTab === 'cpu' && (
          <div className="space-y-4">
            <div className="cockpit-bento p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {t('equipment.cpu_perf')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {metrics?.cpu?.model || t('equipment.cpu_main_fallback')}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <AnimatedMetricValue
                    value={Number(metrics?.cpu?.usage_percent ?? 0)}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-2xl font-bold text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
                    {formatTemp(metrics?.cpu?.temp_c)}
                  </span>
                {onExpandChart && (
                  <button
                    type="button"
                    aria-label={t('hardware.cpu.inspect_aria')}
                    onClick={() =>
                      onExpandChart({
                        title: t('hardware.cpu.chart_full_title'),
                        subtitle: metrics?.cpu?.model || t('equipment.cpu_main_fallback'),
                        series: cpuSeries,
                        timestamps,
                        epochTs,
                        leftUnit: '%',
                        maxLeft: 100,
                        chartKind: 'cpu',
                      })
                    }
                    className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4">
              <TelemetryChart
                series={cpuSeries}
                timestamps={timestamps}
                epochTs={epochTs}
                height={200}
                maxLeft={100}
                leftUnit="%"
                theme={theme}
                onExpandClick={
                  onExpandChart
                    ? () =>
                        onExpandChart({
                          title: t('hardware.cpu.chart_full_title'),
                          subtitle: metrics?.cpu?.model || t('equipment.cpu_main_fallback'),
                          series: cpuSeries,
                          timestamps,
                          epochTs,
                          leftUnit: '%',
                          maxLeft: 100,
                          chartKind: 'cpu',
                        })
                    : undefined
                }
              />
            </div>

            {cpuCores.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('hardware.cpu.threads_load', { cores: cpuCores.length })}
                </p>
                <div className="cockpit-cores-grid">
                  {cpuCores.map((val, idx) => (
                    <div
                      key={idx}
                      onPointerMove={(e) =>
                        setCoreTooltip({
                          visible: true,
                          clientX: e.clientX,
                          clientY: e.clientY,
                          title: t('hardware.cpu.core_n', { n: idx + 1 }),
                          entries: [
                            {
                              label: t('hardware.cpu.usage_current'),
                              value: formatPct(val),
                              color: val >= 85 ? '#ef4444' : val >= 60 ? '#f59e0b' : '#0284c7',
                            },
                          ],
                        })
                      }
                      onPointerLeave={() => setCoreTooltip(null)}
                      className="cockpit-subtile p-2 text-center transition-colors hover:border-sky-400 dark:hover:border-sky-500"
                    >
                      <div className="h-10 w-full flex items-end justify-center">
                        <div
                          className="w-full rounded-md transition-all duration-150"
                          style={{
                            height: `${Math.max(8, Math.min(100, val))}%`,
                            backgroundColor: val >= 85 ? '#ef4444' : val >= 60 ? '#f59e0b' : '#0284c7',
                          }}
                        />
                      </div>
                      <span className="mt-1 block font-mono text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                        {Math.round(val)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowTech((s) => !s)}
              className="mt-5 inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {showTech ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span>{t('equipment.technical_details')}</span>
            </button>
            <AccordionBody open={showTech}>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs font-mono tabular-nums text-slate-600 dark:border-slate-800 dark:text-slate-300 sm:grid-cols-4">
                <div>{t('equipment.tech_arch_row', { arch: metrics?.cpu?.architecture || '--' })}</div>
                <div>{t('hardware.cpu.physical_cores', { count: metrics?.cpu?.physical_cores || '--' })}</div>
                <div>{t('equipment.freq_row', { freq: metrics?.cpu?.freq_mhz ? `${Math.round(metrics.cpu.freq_mhz)} MHz` : '--' })}</div>
                <div>{t('equipment.load_1m_5m', { l1: metrics?.cpu?.load_1m ?? 0, l5: metrics?.cpu?.load_5m ?? 0 })}</div>
              </div>
            </AccordionBody>
          </div>
          <FloatingTooltip data={coreTooltip} />
        </div>
      )}

      {/* Subview: RAM */}
      {subTab === 'ram' && (
        <div className="cockpit-bento p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {t('equipment.ram_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('hardware.ram.used_by_apps_avail', {
                  used: formatBytes(metrics?.ram?.used_bytes),
                  avail: formatBytes(metrics?.ram?.available_bytes),
                })}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatPct(metrics?.ram?.percent)}
              </span>
              {onExpandChart && (
                <button
                  type="button"
                  aria-label={t('hardware.ram.inspect_aria')}
                  onClick={() =>
                    onExpandChart({
                      title: t('hardware.ram.chart_full_title'),
                      subtitle: t('equipment.ram_used_of_total', {
                        used: formatBytes(metrics?.ram?.used_bytes),
                        total: formatBytes(metrics?.ram?.total_bytes),
                      }),
                      series: ramSeries,
                      timestamps,
                      epochTs,
                      leftUnit: '%',
                      maxLeft: 100,
                      chartKind: 'ram',
                    })
                  }
                  className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-emerald-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-emerald-300"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-4">
            <TelemetryChart
              series={ramSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={210}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={
                onExpandChart
                  ? () =>
                      onExpandChart({
                        title: t('hardware.ram.chart_full_title'),
                        subtitle: t('equipment.ram_used_of_total', {
                          used: formatBytes(metrics?.ram?.used_bytes),
                          total: formatBytes(metrics?.ram?.total_bytes),
                        }),
                        series: ramSeries,
                        timestamps,
                        epochTs,
                        leftUnit: '%',
                        maxLeft: 100,
                        chartKind: 'ram',
                      })
                  : undefined
              }
            />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-xs dark:border-slate-800 sm:grid-cols-3">
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.ram.installed_total')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatBytes(metrics?.ram?.total_bytes)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.ram.cached_fast')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatBytes(metrics?.ram?.cached_total_bytes || metrics?.ram?.cached_bytes)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.ram.disk_swap')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatBytes(metrics?.ram?.swap_used_bytes)} / {formatBytes(metrics?.ram?.swap_total_bytes)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Subview: GPU */}
      {subTab === 'gpu' && (
        <div className="cockpit-bento p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {t('equipment.gpu_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {metrics?.gpu?.available ? metrics.gpu.name || t('hardware.gpu.detected_fallback') : t('hardware.gpu.no_dedicated')}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatPct(metrics?.gpu?.gpu_util_percent)}
              </span>
              <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
                {formatTemp(metrics?.gpu?.temp_c)}
              </span>
              {onExpandChart && (
                <button
                  type="button"
                  aria-label={t('hardware.gpu.inspect_aria')}
                  onClick={() =>
                    onExpandChart({
                      title: t('hardware.gpu.chart_full_title'),
                      subtitle: metrics?.gpu?.name || t('hardware.gpu.system_fallback'),
                      series: gpuSeries,
                      timestamps,
                      epochTs,
                      leftUnit: '%',
                      maxLeft: 100,
                      chartKind: 'gpu',
                    })
                  }
                  className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-violet-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-violet-300"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-4">
            <TelemetryChart
              series={gpuSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={200}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={
                onExpandChart
                  ? () =>
                      onExpandChart({
                        title: t('hardware.gpu.chart_full_title'),
                        subtitle: metrics?.gpu?.name || t('hardware.gpu.system_fallback'),
                        series: gpuSeries,
                        timestamps,
                        epochTs,
                        leftUnit: '%',
                        maxLeft: 100,
                        chartKind: 'gpu',
                      })
                  : undefined
              }
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs dark:border-slate-800 sm:grid-cols-4">
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.gpu.vram_label')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {metrics?.gpu?.vram_used_mb ?? 0} / {metrics?.gpu?.vram_total_mb ?? 0} MB
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.gpu.power_draw')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {metrics?.gpu?.power_watts !== null && metrics?.gpu?.power_watts !== undefined
                  ? `${metrics.gpu.power_watts} W`
                  : '--'}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.gpu.fan')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {metrics?.gpu?.fan_percent !== null && metrics?.gpu?.fan_percent !== undefined
                  ? `${metrics.gpu.fan_percent} %`
                  : t('hardware.gpu.fan_auto')}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">{t('hardware.gpu.driver')}</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums truncate">
                {metrics?.gpu?.driver || '--'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Subview: Almacenamiento */}
      {subTab === 'storage' && (
        <div className="space-y-4">
          <div className="cockpit-bento p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  {t('equipment.storage_live_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('hardware.storage.speed_now', {
                    read: formatMbRate((metrics?.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024)),
                    write: formatMbRate((metrics?.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024)),
                  })}
                </p>
              </div>
              {onExpandChart && (
                <button
                  type="button"
                  aria-label={t('hardware.storage.inspect_aria')}
                  onClick={() =>
                    onExpandChart({
                      title: t('hardware.storage.chart_full_title'),
                      subtitle: t('hardware.storage.chart_full_subtitle', {
                        read: formatMbRate((metrics?.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024)),
                        write: formatMbRate((metrics?.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024)),
                      }),
                      series: storageSeries,
                      timestamps,
                      epochTs,
                      leftUnit: 'MB/s',
                      maxRight: 100,
                      chartKind: 'storage',
                    })
                  }
                  className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-amber-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-amber-300"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-4">
              <TelemetryChart
                series={storageSeries}
                timestamps={timestamps}
                epochTs={epochTs}
                height={200}
                maxRight={100}
                leftUnit="MB/s"
                theme={theme}
                onExpandClick={
                  onExpandChart
                    ? () =>
                        onExpandChart({
                          title: t('hardware.storage.chart_full_title'),
                          subtitle: t('hardware.storage.chart_full_subtitle', {
                            read: formatMbRate((metrics?.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024)),
                            write: formatMbRate((metrics?.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024)),
                          }),
                          series: storageSeries,
                          timestamps,
                          epochTs,
                          leftUnit: 'MB/s',
                          maxRight: 100,
                          chartKind: 'storage',
                        })
                    : undefined
                }
              />
            </div>
          </div>

          <div className="cockpit-auto-grid">
            {disks.map((d, idx) => {
              const isRem = d.kind === 'removable' || Boolean(d.is_removable);
              const isNet = d.kind === 'network';
              const isMounted = d.mounted !== false;
              const pct = Math.min(100, Math.max(0, Number(d.percent || 0)));
              const barColor =
                pct >= 88 ? '#ef4444' : isRem ? '#7c3aed' : isNet ? '#0284c7' : '#f59e0b';
              return (
                <div
                  key={`${d.mountpoint}-${d.device || idx}`}
                  className="cockpit-bento p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {formatDiskLabel(d, locale)}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-400">
                        {d.mountpoint} {d.device && d.device !== d.mountpoint ? `· ${d.device}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {isMounted
                          ? t('hardware.storage.mounted_summary', {
                              used: formatBytes(d.used_bytes),
                              free: formatBytes(d.free_bytes),
                              total: formatBytes(d.total_bytes),
                            })
                          : t('hardware.storage.unmounted_summary', {
                              total: formatBytes(d.total_bytes),
                            })}
                      </p>
                    </div>
                    <span className="cockpit-pill-amber rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums">
                      {isMounted ? formatPct(d.percent) : t('hardware.storage.unmounted')}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {d.transport && (
                      <span className="cockpit-subtile rounded-md px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                        {formatDiskTransport(d, locale)}
                      </span>
                    )}
                    {d.fstype && (
                      <span className="cockpit-subtile rounded-md px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {formatDiskFstype(d, locale)}
                      </span>
                    )}
                    {isNet && d.pool_primary === false && (
                      <span className="cockpit-pill-cyan rounded-md px-2 py-0.5 text-[10px] font-semibold">
                        {t('hardware.storage.shared_pool_with', {
                          pool: d.pool_shared_with || t('hardware.storage.nas_badge'),
                        })}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                    <div
                      className="cockpit-progress-fill h-full rounded-full"
                      style={{
                        width: `${isMounted ? Math.max(2, pct) : 100}%`,
                        backgroundColor: barColor,
                        opacity: isMounted ? 1 : 0.35,
                      }}
                    />
                  </div>
                  {d.temp_c !== null && d.temp_c !== undefined && (
                    <p className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {t('equipment.disk_temp_line', { temp: formatTemp(d.temp_c) })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Subview: Programas en marcha */}
      {subTab === 'processes' && (
        <div className="cockpit-bento p-5">
          <div className="flex flex-col gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {t('equipment.processes_now_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('equipment.processes_sub')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={procQuery}
                  onChange={(e) => setProcQuery(e.target.value)}
                  placeholder={t('equipment.processes_search')}
                  className="cockpit-subtile min-h-[40px] pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
                />
              </div>
              <LayoutGroup id="proc-sort">
                <div className="cockpit-subtile flex items-center gap-1 p-1">
                  {(['cpu', 'mem', 'vram'] as const).map((k) => {
                    const active = procSort === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setProcSort(k)}
                        className={`relative min-h-[34px] rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                          active
                            ? 'text-sky-700 dark:text-sky-300'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                        }`}
                      >
                        {active && <MorphPill layoutId="proc-sort-pill" className="rounded-lg" />}
                        <span className="relative z-10">
                          {k === 'cpu' ? t('equipment.sort_cpu') : k === 'mem' ? t('equipment.sort_mem') : t('equipment.sort_vram')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">{t('equipment.col_program')}</th>
                  <th className="py-2.5 px-3 font-medium">{t('equipment.col_user')}</th>
                  <th className="py-2.5 px-3 text-right font-medium">{t('equipment.col_cpu')}</th>
                  <th className="py-2.5 px-3 text-right font-medium">{t('equipment.col_ram')}</th>
                  <th className="py-2.5 pl-3 text-right font-medium">{t('equipment.col_vram')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredProcesses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      {t('equipment.processes_none_match', { query: procQuery })}
                    </td>
                  </tr>
                ) : (
                  filteredProcesses.map((proc) => (
                    <tr key={`${proc.pid}-${proc.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{proc.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{t('equipment.pid_label', { pid: proc.pid })}</p>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{proc.user || t('equipment.user_system')}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {formatPct(proc.cpu_percent)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {Math.round(proc.priv_mb ?? proc.mem_mb ?? 0)} MB
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {proc.vram_mb ? `${Math.round(proc.vram_mb)} MB` : '--'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </ViewStage>
    </div>
  );
};
