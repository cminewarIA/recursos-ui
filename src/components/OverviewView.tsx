import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  Maximize2,
  MemoryStick,
  Monitor,
  Power,
  PowerOff,
  Wifi,
} from 'lucide-react';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import {
  DiskInfo,
  MainTabId,
  MetricsPayload,
  ThemeMode,
  WifiClient,
} from '../types/telemetry';
import {
  formatBytes,
  formatMbRate,
  formatPct,
  formatSpeed,
  formatTemp,
  getHealthTone,
} from '../utils/formatters';

export interface ExpandChartSpec {
  title: string;
  subtitle: string;
  series: ChartSeries[];
  timestamps: string[];
  leftUnit?: string;
  maxLeft?: number;
  maxRight?: number;
}

interface OverviewViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onNavigate: (tab: MainTabId, subTab?: string) => void;
  onExpandChart: (spec: ExpandChartSpec) => void;
  onPowerAction: (action: 'wake' | 'shutdown', client: WifiClient) => void;
  actionPendingMac: string | null;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  metrics,
  theme,
  onNavigate,
  onExpandChart,
  onPowerAction,
  actionPendingMac,
}) => {
  const [showErrorsDetail, setShowErrorsDetail] = useState(false);

  const cpuPct = Number(metrics?.cpu?.usage_percent ?? 0);
  const cpuTemp = metrics?.cpu?.temp_c ?? null;
  const ramPct = Number(metrics?.ram?.percent ?? 0);
  const ramUsed = metrics?.ram?.used_bytes ?? 0;
  const ramTotal = metrics?.ram?.total_bytes ?? 0;

  const gpuAvail = Boolean(metrics?.gpu?.available);
  const gpuPct = Number(metrics?.gpu?.gpu_util_percent ?? 0);
  const gpuTemp = metrics?.gpu?.temp_c ?? null;
  const gpuVramUsed = metrics?.gpu?.vram_used_mb ?? 0;
  const gpuVramTotal = metrics?.gpu?.vram_total_mb ?? 0;

  const disks: DiskInfo[] = useMemo(() => metrics?.disks ?? [], [metrics?.disks]);
  const storageSummary = useMemo(() => {
    if (!disks.length) {
      return { usedBytes: 0, totalBytes: 0, freeBytes: 0, percent: 0, mainTemp: null as number | null };
    }
    const root = disks.find((d) => d.mountpoint === '/') || disks[0];
    let total = 0;
    let used = 0;
    let free = 0;
    for (const d of disks) {
      total += Number(d.total_bytes || 0);
      used += Number(d.used_bytes || 0);
      free += Number(d.free_bytes || 0);
    }
    const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : Number(root.percent || 0);
    return {
      usedBytes: used,
      totalBytes: total,
      freeBytes: free,
      percent: pct,
      mainTemp: root.temp_c ?? null,
    };
  }, [disks]);

  const readRateBytes = Number(metrics?.disk_io?.read_bytes_sec ?? 0);
  const writeRateBytes = Number(metrics?.disk_io?.write_bytes_sec ?? 0);

  const hist = metrics?.history;
  const timestamps = hist?.timestamps ?? [];
  const cpuHist = hist?.cpu ?? [];
  const ramHist = hist?.ram ?? [];
  const gpuHist = hist?.gpu ?? [];
  const diskReadHist = hist?.disk_r ?? [];
  const diskWriteHist = hist?.disk_w ?? [];
  const diskPctHist = useMemo(() => {
    if (hist?.disk_pct && hist.disk_pct.length > 0) return hist.disk_pct;
    const len = Math.max(diskReadHist.length, timestamps.length);
    return len > 0 ? Array.from({ length: len }, () => storageSummary.percent) : [];
  }, [hist?.disk_pct, diskReadHist.length, timestamps.length, storageSummary.percent]);

  const diskThroughputMax = useMemo(() => {
    const peak = Math.max(1, ...diskReadHist, ...diskWriteHist);
    if (peak <= 5) return 5;
    if (peak <= 25) return Math.ceil(peak * 1.25);
    return Math.ceil(peak * 1.2);
  }, [diskReadHist, diskWriteHist]);

  const cpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'cpu', label: 'Procesador', data: cpuHist, color: '#2563eb', unit: '%' }],
    [cpuHist]
  );
  const ramSeries: ChartSeries[] = useMemo(
    () => [{ id: 'ram', label: 'Memoria RAM', data: ramHist, color: '#0ea5e9', unit: '%' }],
    [ramHist]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', label: 'Tarjeta gráfica', data: gpuHist, color: '#16a34a', unit: '%' }],
    [gpuHist]
  );
  const storageSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'disk_r', label: 'Lectura', data: diskReadHist, color: '#d97706', unit: 'MB/s', decimals: 1, fillAlpha: 0.16, axis: 'left' },
      { id: 'disk_w', label: 'Escritura', data: diskWriteHist, color: '#ea580c', unit: 'MB/s', decimals: 1, fillAlpha: 0.08, axis: 'left' },
      { id: 'disk_pct', label: 'Espacio usado', data: diskPctHist, color: '#64748b', unit: '%', decimals: 1, fillAlpha: 0, dashed: true, axis: 'right' },
    ],
    [diskReadHist, diskWriteHist, diskPctHist]
  );

  const cpuTone = getHealthTone(cpuPct);
  const ramTone = getHealthTone(ramPct);
  const gpuTone = getHealthTone(gpuPct);
  const diskTone = getHealthTone(storageSummary.percent);

  const onlineWifi = useMemo(
    () => (metrics?.wifi_clients ?? []).filter((c) => c.online !== false && c.is_online !== false),
    [metrics?.wifi_clients]
  );
  const controllableClients = useMemo(
    () => (metrics?.wifi_clients ?? []).filter((c) => !c.is_server && !c.is_gateway).slice(0, 6),
    [metrics?.wifi_clients]
  );

  const totalErrors = Number(metrics?.system_errors_summary?.total_errors ?? 0);
  const overallBusy = cpuPct >= 88 || ramPct >= 90 || storageSummary.percent >= 92;

  return (
    <div className="space-y-6">
      {/* Editorial health summary banner */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Estado general del equipo · {metrics?.system?.hostname || 'Servidor doméstico'}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              {overallBusy ? 'El servidor tiene carga alta ahora mismo' : 'Todo funciona con normalidad'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Encendido {metrics?.system?.uptime_str || '--'}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{onlineWifi.length} aparatos conectados</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Internet: ↓ {formatSpeed(metrics?.net?.rx_bytes_sec)} / ↑ {formatSpeed(metrics?.net?.tx_bytes_sec)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {totalErrors > 0 ? (
              <button
                type="button"
                onClick={() => setShowErrorsDetail((v) => !v)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{totalErrors} {totalErrors === 1 ? 'aviso reciente' : 'avisos recientes'}</span>
                {showErrorsDetail ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('equipo')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 whitespace-nowrap"
              >
                <Activity className="h-4 w-4 shrink-0" />
                <span>Ver equipo al detalle</span>
              </button>
            )}
          </div>
        </div>

        {showErrorsDetail && (
          <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Se han registrado {totalErrors} avisos en los servicios del servidor o en la geolocalización de red.
              </span>
              <button
                type="button"
                onClick={() => onNavigate('mas', 'updates')}
                className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                Abrir registro completo
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Primary 4 Real-Time Telemetry Widgets: CPU, RAM, GPU, Almacenamiento */}
      <section aria-label="Panel de rendimiento en tiempo real" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 1. Procesador (CPU) */}
        <article className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Cpu className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Procesador</span>
                <span aria-hidden="true">·</span>
                <span className={cpuTone.textClass}>{cpuTone.label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                  {formatPct(cpuPct)}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {formatTemp(cpuTemp)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
                {metrics?.cpu?.model || 'Procesador principal'} ({metrics?.cpu?.logical_cores || 0} núcleos)
              </p>
            </div>
            <button
              type="button"
              aria-label="Ampliar gráfica de procesador"
              onClick={() =>
                onExpandChart({
                  title: 'Uso del procesador en tiempo real',
                  subtitle: metrics?.cpu?.model || 'Procesador principal',
                  series: cpuSeries,
                  timestamps,
                  leftUnit: '%',
                  maxLeft: 100,
                })
              }
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={cpuSeries}
              timestamps={timestamps}
              height={148}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Uso del procesador en tiempo real',
                  subtitle: metrics?.cpu?.model || 'Procesador principal',
                  series: cpuSeries,
                  timestamps,
                  leftUnit: '%',
                  maxLeft: 100,
                })
              }
            />
          </div>
        </article>

        {/* 2. Memoria RAM */}
        <article className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <MemoryStick className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                <span>Memoria RAM</span>
                <span aria-hidden="true">·</span>
                <span className={ramTone.textClass}>{ramTone.label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                  {formatPct(ramPct)}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {formatBytes(ramUsed)} / {formatBytes(ramTotal)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Libre y lista: {formatBytes(metrics?.ram?.available_bytes)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Ampliar gráfica de memoria"
              onClick={() =>
                onExpandChart({
                  title: 'Uso de memoria RAM en tiempo real',
                  subtitle: `${formatBytes(ramUsed)} usados de ${formatBytes(ramTotal)}`,
                  series: ramSeries,
                  timestamps,
                  leftUnit: '%',
                  maxLeft: 100,
                })
              }
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={ramSeries}
              timestamps={timestamps}
              height={148}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Uso de memoria RAM en tiempo real',
                  subtitle: `${formatBytes(ramUsed)} usados de ${formatBytes(ramTotal)}`,
                  series: ramSeries,
                  timestamps,
                  leftUnit: '%',
                  maxLeft: 100,
                })
              }
            />
          </div>
        </article>

        {/* 3. Tarjeta gráfica (GPU) */}
        <article className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Monitor className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>Tarjeta gráfica</span>
                <span aria-hidden="true">·</span>
                <span className={gpuAvail ? gpuTone.textClass : 'text-slate-500 dark:text-slate-400'}>
                  {gpuAvail ? gpuTone.label : 'En reposo'}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                  {gpuAvail ? formatPct(gpuPct) : '0 %'}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {gpuAvail ? formatTemp(gpuTemp) : 'Sin gráfica dedicada'}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
                {gpuAvail
                  ? `${metrics?.gpu?.name || 'Gráfica'}${gpuVramTotal > 0 ? ` · ${gpuVramUsed} / ${gpuVramTotal} MB vídeo` : ''}`
                  : 'Vídeo integrado sin carga multimedia'}
              </p>
            </div>
            <button
              type="button"
              aria-label="Ampliar gráfica de tarjeta gráfica"
              onClick={() =>
                onExpandChart({
                  title: 'Actividad de tarjeta gráfica en tiempo real',
                  subtitle: metrics?.gpu?.name || 'Gráfica del sistema',
                  series: gpuSeries,
                  timestamps,
                  leftUnit: '%',
                  maxLeft: 100,
                })
              }
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={gpuSeries}
              timestamps={timestamps}
              height={148}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Actividad de tarjeta gráfica en tiempo real',
                  subtitle: metrics?.gpu?.name || 'Gráfica del sistema',
                  series: gpuSeries,
                  timestamps,
                  leftUnit: '%',
                  maxLeft: 100,
                })
              }
            />
          </div>
        </article>

        {/* 4. Almacenamiento (Con gráfica en tiempo real de Lectura/Escritura MB/s + Espacio usado % + Tooltip) */}
        <article className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                <HardDrive className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>Almacenamiento</span>
                <span aria-hidden="true">·</span>
                <span className={diskTone.textClass}>{diskTone.label}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                  {formatPct(storageSummary.percent)}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  L {formatMbRate(readRateBytes / (1024 * 1024))} · E {formatMbRate(writeRateBytes / (1024 * 1024))}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {formatBytes(storageSummary.usedBytes)} usados de {formatBytes(storageSummary.totalBytes)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-amber-600" /> Lectura
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-orange-600" /> Escritura
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-0.5 w-3 bg-slate-500" /> Espacio
                  </span>
                </span>
              </div>
            </div>
            <button
              type="button"
              aria-label="Ampliar gráfica de almacenamiento"
              onClick={() =>
                onExpandChart({
                  title: 'Actividad de discos y espacio usado',
                  subtitle: `${formatBytes(storageSummary.freeBytes)} disponibles`,
                  series: storageSeries,
                  timestamps,
                  leftUnit: 'MB/s',
                  maxLeft: diskThroughputMax,
                  maxRight: 100,
                })
              }
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={storageSeries}
              timestamps={timestamps}
              height={148}
              maxLeft={diskThroughputMax}
              maxRight={100}
              leftUnit="MB/s"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Actividad de discos y espacio usado',
                  subtitle: `${formatBytes(storageSummary.freeBytes)} disponibles`,
                  series: storageSeries,
                  timestamps,
                  leftUnit: 'MB/s',
                  maxLeft: diskThroughputMax,
                  maxRight: 100,
                })
              }
            />
          </div>
        </article>
      </section>

      {/* Quick Control Row: Aparatos en casa con botones Encender (WoL) y Apagar juntos */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Aparatos de tu red doméstica
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enciende o apaga equipos compatibles directamente desde aquí
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('red')}
            className="min-h-[40px] rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Ver todos ({metrics?.wifi_clients?.length ?? 0})
          </button>
        </div>

        {controllableClients.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No se detectaron otros aparatos en tu red en este instante. Pulsa en «Ver todos» para revisar la red.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {controllableClients.map((client, idx) => {
              const isOnline = client.online !== false && client.is_online !== false;
              const mac = client.mac || `idx-${idx}`;
              const pending = actionPendingMac === mac;
              const label = client.name || client.hostname || client.ip || 'Dispositivo de red';

              return (
                <div
                  key={`${mac}-${client.ip || idx}`}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <Wifi className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {label}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {isOnline ? 'Conectado ahora' : 'Apagado o en espera'}
                        {client.ip ? ` · ${client.ip}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={pending || !client.mac}
                      onClick={() => onPowerAction('wake', client)}
                      title="Enviar señal de encendido (Wake-on-LAN)"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-45 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50 whitespace-nowrap"
                    >
                      <Power className="h-3.5 w-3.5 shrink-0" />
                      <span>Encender</span>
                    </button>
                    <button
                      type="button"
                      disabled={pending || (!client.ip && !client.mac)}
                      onClick={() => onPowerAction('shutdown', client)}
                      title="Enviar señal de apagado o suspensión por red"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/50 whitespace-nowrap"
                    >
                      <PowerOff className="h-3.5 w-3.5 shrink-0" />
                      <span>Apagar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
