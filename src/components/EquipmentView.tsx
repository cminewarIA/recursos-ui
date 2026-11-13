import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  ListChecks,
  MemoryStick,
  Monitor,
  Search,
} from 'lucide-react';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { MetricsPayload, SystemProcess, ThemeMode } from '../types/telemetry';
import { formatBytes, formatMbRate, formatPct, formatTemp } from '../utils/formatters';

type EquipmentSubTab = 'cpu' | 'ram' | 'gpu' | 'storage' | 'processes';

interface EquipmentViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  initialSubTab?: string;
}

export const EquipmentView: React.FC<EquipmentViewProps> = ({
  metrics,
  theme,
  initialSubTab,
}) => {
  const [subTab, setSubTab] = useState<EquipmentSubTab>(() => {
    if (
      initialSubTab === 'cpu' ||
      initialSubTab === 'ram' ||
      initialSubTab === 'gpu' ||
      initialSubTab === 'storage' ||
      initialSubTab === 'processes'
    ) {
      return initialSubTab;
    }
    return 'cpu';
  });
  const [showTech, setShowTech] = useState(false);
  const [procQuery, setProcQuery] = useState('');
  const [procSort, setProcSort] = useState<'cpu' | 'mem' | 'vram'>('cpu');
  const [coreTooltip, setCoreTooltip] = useState<FloatingTooltipData | null>(null);

  const hist = metrics?.history;
  const timestamps = hist?.timestamps ?? [];

  const cpuCores = useMemo(() => metrics?.cpu?.per_core_percent ?? [], [metrics?.cpu?.per_core_percent]);
  const cpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'cpu', label: 'Procesador', data: hist?.cpu ?? [], color: '#2563eb', unit: '%' }],
    [hist?.cpu]
  );
  const ramSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'ram', label: 'Memoria activa', data: hist?.ram ?? [], color: '#0ea5e9', unit: '%' },
      { id: 'ram_tot', label: 'Total ocupada (con caché)', data: hist?.ram_total ?? [], color: '#6366f1', unit: '%', fillAlpha: 0, dashed: true },
    ],
    [hist?.ram, hist?.ram_total]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', label: 'Tarjeta gráfica', data: hist?.gpu ?? [], color: '#16a34a', unit: '%' }],
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
      { id: 'r', label: 'Lectura', data: diskReadHist, color: '#d97706', unit: 'MB/s', axis: 'left' },
      { id: 'w', label: 'Escritura', data: diskWriteHist, color: '#ea580c', unit: 'MB/s', axis: 'left' },
      { id: 'p', label: 'Espacio usado', data: diskPctHist, color: '#64748b', unit: '%', dashed: true, fillAlpha: 0, axis: 'right' },
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
      {/* Sub-navigation segmented bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 no-scrollbar dark:border-slate-800 dark:bg-slate-900">
        {subTabs.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Subview: CPU */}
      {subTab === 'cpu' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                  Rendimiento del procesador
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {metrics?.cpu?.model || 'Procesador principal'}
                </p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatPct(metrics?.cpu?.usage_percent)}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {formatTemp(metrics?.cpu?.temp_c)}
                </span>
              </div>
            </div>
            <div className="mt-4">
              <TelemetryChart
                series={cpuSeries}
                timestamps={timestamps}
                height={200}
                maxLeft={100}
                leftUnit="%"
                theme={theme}
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
                              color: val >= 85 ? '#dc2626' : val >= 60 ? '#d97706' : '#2563eb',
                            },
                          ],
                        })
                      }
                      onPointerLeave={() => setCoreTooltip(null)}
                      className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-center transition-colors hover:border-blue-300 dark:border-slate-800 dark:bg-slate-800/50"
                    >
                      <div className="h-10 w-full flex items-end justify-center">
                        <div
                          className="w-full rounded-md transition-all duration-150"
                          style={{
                            height: `${Math.max(8, Math.min(100, val))}%`,
                            backgroundColor: val >= 85 ? '#dc2626' : val >= 60 ? '#d97706' : '#2563eb',
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
            {showTech && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs font-mono tabular-nums text-slate-600 dark:border-slate-800 dark:text-slate-300 sm:grid-cols-4">
                <div>Arquitectura: {metrics?.cpu?.architecture || '--'}</div>
                <div>Núcleos físicos: {metrics?.cpu?.physical_cores || '--'}</div>
                <div>Frecuencia: {metrics?.cpu?.freq_mhz ? `${Math.round(metrics.cpu.freq_mhz)} MHz` : '--'}</div>
                <div>Carga (1m/5m): {metrics?.cpu?.load_1m ?? 0} / {metrics?.cpu?.load_5m ?? 0}</div>
              </div>
            )}
          </div>
          <FloatingTooltip data={coreTooltip} />
        </div>
      )}

      {/* Subview: RAM */}
      {subTab === 'ram' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                Memoria del equipo (RAM)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatBytes(metrics?.ram?.used_bytes)} ocupados por programas · {formatBytes(metrics?.ram?.available_bytes)} disponibles
              </p>
            </div>
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {formatPct(metrics?.ram?.percent)}
            </span>
          </div>
          <div className="mt-4">
            <TelemetryChart
              series={ramSeries}
              timestamps={timestamps}
              height={210}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
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
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                Tarjeta gráfica y vídeo
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {metrics?.gpu?.available ? metrics.gpu.name || 'Gráfica detectada' : 'Sin tarjeta gráfica dedicada activa'}
              </p>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatPct(metrics?.gpu?.gpu_util_percent)}
              </span>
              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {formatTemp(metrics?.gpu?.temp_c)}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <TelemetryChart
              series={gpuSeries}
              timestamps={timestamps}
              height={200}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
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
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
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
            </div>
            <div className="mt-4">
              <TelemetryChart
                series={storageSeries}
                timestamps={timestamps}
                height={200}
                maxRight={100}
                leftUnit="MB/s"
                theme={theme}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {disks.map((d) => (
              <div
                key={d.mountpoint}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {d.label || d.mountpoint}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {formatBytes(d.used_bytes)} usados · {formatBytes(d.free_bytes)} libres de {formatBytes(d.total_bytes)}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatPct(d.percent)}
                  </span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(d.percent || 0)))}%`,
                      backgroundColor: Number(d.percent || 0) >= 88 ? '#dc2626' : '#d97706',
                    }}
                  />
                </div>
                {d.temp_c !== null && d.temp_c !== undefined && (
                  <p className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    Temperatura del disco: {formatTemp(d.temp_c)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subview: Programas en marcha */}
      {subTab === 'processes' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
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
                  className="min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(['cpu', 'mem', 'vram'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setProcSort(k)}
                    className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                      procSort === k
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {k === 'cpu' ? 'Procesador' : k === 'mem' ? 'Memoria' : 'Vídeo'}
                  </button>
                ))}
              </div>
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
    </div>
  );
};
