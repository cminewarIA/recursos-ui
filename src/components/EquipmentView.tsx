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
    () => [{ id: 'cpu', metricKey: 'cpu', label: 'Procesador', data: hist?.cpu ?? [], color: '#0284c7', unit: '%' }],
    [hist?.cpu]
  );
  const ramSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'ram', metricKey: 'ram', label: 'Memoria activa', data: hist?.ram ?? [], color: '#10b981', unit: '%' },
      { id: 'ram_tot', metricKey: 'ram_total', label: 'Total ocupada (con caché)', data: hist?.ram_total ?? [], color: '#7c3aed', unit: '%', fillAlpha: 0, dashed: true },
    ],
    [hist?.ram, hist?.ram_total]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', metricKey: 'gpu', label: 'Tarjeta gráfica', data: hist?.gpu ?? [], color: '#7c3aed', unit: '%' }],
    [hist?.gpu]
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
      { id: 'r', metricKey: 'disk_r', label: 'Lectura', data: diskReadHist, color: '#f59e0b', unit: 'MB/s', decimals: 2, axis: 'left' },
      { id: 'w', metricKey: 'disk_w', label: 'Escritura', data: diskWriteHist, color: '#ea580c', unit: 'MB/s', decimals: 2, axis: 'left' },
      { id: 'p', metricKey: 'disk_pct', label: 'Espacio usado', data: diskPctHist, color: '#64748b', unit: '%', decimals: 1, dashed: true, fillAlpha: 0, axis: 'right' },
    ],
    [diskReadHist, diskWriteHist, diskPctHist]
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
    { id: 'cpu', label: 'Procesador', icon: <Cpu className="h-4 w-4" /> },
    { id: 'ram', label: 'Memoria', icon: <MemoryStick className="h-4 w-4" /> },
    { id: 'gpu', label: 'Gráfica', icon: <Monitor className="h-4 w-4" /> },
    { id: 'storage', label: 'Almacenamiento', icon: <HardDrive className="h-4 w-4" /> },
    { id: 'processes', label: 'Programas en marcha', icon: <ListChecks className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Sub-navigation segmented bar with animated MorphPill */}
      <LayoutGroup id="equipment-subtabs">
        <div className="cockpit-segmented flex items-center gap-1.5 overflow-x-auto p-1.5 no-scrollbar">
          {subTabs.map((t) => {
            const active = subTab === t.id;
            return (
              <motion.button
                whileTap={{ scale: 0.97 }}
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`relative inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="equipment-subtab-pill" className="rounded-xl" />}
                <span className="relative z-10 inline-flex items-center gap-2">
                  {t.icon}
                  <span>{t.label}</span>
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
                    Rendimiento del procesador
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {metrics?.cpu?.model || 'Procesador principal'}
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
                    aria-label="Inspeccionar historial completo de procesador"
                    onClick={() =>
                      onExpandChart({
                        title: 'Uso del procesador e historial completo',
                        subtitle: metrics?.cpu?.model || 'Procesador principal',
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
                          title: 'Uso del procesador e historial completo',
                          subtitle: metrics?.cpu?.model || 'Procesador principal',
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
                  Carga por núcleo ({cpuCores.length} hilos disponibles)
                </p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 md:grid-cols-12">
                  {cpuCores.map((val, idx) => (
                    <div
                      key={idx}
                      onPointerMove={(e) =>
                        setCoreTooltip({
                          visible: true,
                          clientX: e.clientX,
                          clientY: e.clientY,
                          title: `Núcleo ${idx + 1}`,
                          entries: [
                            {
                              label: 'Uso actual',
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
              <span>Ver detalles técnicos</span>
            </button>
            <AccordionBody open={showTech}>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs font-mono tabular-nums text-slate-600 dark:border-slate-800 dark:text-slate-300 sm:grid-cols-4">
                <div>Arquitectura: {metrics?.cpu?.architecture || '--'}</div>
                <div>Núcleos físicos: {metrics?.cpu?.physical_cores || '--'}</div>
                <div>Frecuencia: {metrics?.cpu?.freq_mhz ? `${Math.round(metrics.cpu.freq_mhz)} MHz` : '--'}</div>
                <div>Carga (1m/5m): {metrics?.cpu?.load_1m ?? 0} / {metrics?.cpu?.load_5m ?? 0}</div>
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
                Memoria del equipo (RAM)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatBytes(metrics?.ram?.used_bytes)} ocupados por programas · {formatBytes(metrics?.ram?.available_bytes)} disponibles
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatPct(metrics?.ram?.percent)}
              </span>
              {onExpandChart && (
                <button
                  type="button"
                  aria-label="Inspeccionar historial completo de memoria RAM"
                  onClick={() =>
                    onExpandChart({
                      title: 'Uso de memoria RAM e historial completo',
                      subtitle: `${formatBytes(metrics?.ram?.used_bytes)} ocupados de ${formatBytes(metrics?.ram?.total_bytes)}`,
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
                        title: 'Uso de memoria RAM e historial completo',
                        subtitle: `${formatBytes(metrics?.ram?.used_bytes)} ocupados de ${formatBytes(metrics?.ram?.total_bytes)}`,
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
              <span className="text-slate-500 dark:text-slate-400">Memoria total instalada</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatBytes(metrics?.ram?.total_bytes)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">En caché para abrir más rápido</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatBytes(metrics?.ram?.cached_total_bytes || metrics?.ram?.cached_bytes)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Memoria de respaldo en disco</span>
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
                Tarjeta gráfica y vídeo
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {metrics?.gpu?.available ? metrics.gpu.name || 'Gráfica detectada' : 'Sin tarjeta gráfica dedicada activa'}
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
                  aria-label="Inspeccionar historial completo de tarjeta gráfica"
                  onClick={() =>
                    onExpandChart({
                      title: 'Actividad de tarjeta gráfica e historial completo',
                      subtitle: metrics?.gpu?.name || 'Gráfica del sistema',
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
                        title: 'Actividad de tarjeta gráfica e historial completo',
                        subtitle: metrics?.gpu?.name || 'Gráfica del sistema',
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
              <span className="text-slate-500 dark:text-slate-400">Memoria de vídeo</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {metrics?.gpu?.vram_used_mb ?? 0} / {metrics?.gpu?.vram_total_mb ?? 0} MB
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Consumo eléctrico</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {metrics?.gpu?.power_watts !== null && metrics?.gpu?.power_watts !== undefined
                  ? `${metrics.gpu.power_watts} W`
                  : '--'}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Ventilador</span>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {metrics?.gpu?.fan_percent !== null && metrics?.gpu?.fan_percent !== undefined
                  ? `${metrics.gpu.fan_percent} %`
                  : 'Automático'}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Controlador</span>
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
                  Actividad de discos en tiempo real
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Velocidad actual: lectura {formatMbRate((metrics?.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024))} · escritura{' '}
                  {formatMbRate((metrics?.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024))}
                </p>
              </div>
              {onExpandChart && (
                <button
                  type="button"
                  aria-label="Inspeccionar historial completo de almacenamiento"
                  onClick={() =>
                    onExpandChart({
                      title: 'Actividad de discos y espacio usado',
                      subtitle: `Lectura ${formatMbRate((metrics?.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024))} · Escritura ${formatMbRate((metrics?.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024))}`,
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
                          title: 'Actividad de discos y espacio usado',
                          subtitle: `Lectura ${formatMbRate((metrics?.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024))} · Escritura ${formatMbRate((metrics?.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024))}`,
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

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                        {d.label || d.mountpoint}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-400">
                        {d.mountpoint} {d.device && d.device !== d.mountpoint ? `· ${d.device}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {isMounted
                          ? `${formatBytes(d.used_bytes)} usados · ${formatBytes(d.free_bytes)} libres de ${formatBytes(d.total_bytes)}`
                          : `Extraíble detectada (sin montar) · ${formatBytes(d.total_bytes)}`}
                      </p>
                    </div>
                    <span className="cockpit-pill-amber rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums">
                      {isMounted ? formatPct(d.percent) : 'Sin montar'}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {d.transport && (
                      <span className="cockpit-subtile rounded-md px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                        {d.transport}
                      </span>
                    )}
                    {d.fstype && (
                      <span className="cockpit-subtile rounded-md px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {d.fstype.toUpperCase()}
                      </span>
                    )}
                    {isNet && d.pool_primary === false && (
                      <span className="cockpit-pill-cyan rounded-md px-2 py-0.5 text-[10px] font-semibold">
                        Comparte pool con {d.pool_shared_with || 'NAS'}
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
                      Temperatura del disco: {formatTemp(d.temp_c)}
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
                Programas en marcha ahora
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Procesos que están usando procesador o memoria en este momento
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={procQuery}
                  onChange={(e) => setProcQuery(e.target.value)}
                  placeholder="Buscar programa..."
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
                          {k === 'cpu' ? 'Procesador' : k === 'mem' ? 'Memoria' : 'Vídeo'}
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
                  <th className="py-2.5 pr-3 font-medium">Programa</th>
                  <th className="py-2.5 px-3 font-medium">Usuario</th>
                  <th className="py-2.5 px-3 text-right font-medium">Procesador</th>
                  <th className="py-2.5 px-3 text-right font-medium">Memoria</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Vídeo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredProcesses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No hay programas que coincidan con «{procQuery}».
                    </td>
                  </tr>
                ) : (
                  filteredProcesses.map((proc) => (
                    <tr key={`${proc.pid}-${proc.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{proc.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">ID {proc.pid}</p>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{proc.user || 'sistema'}</td>
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
