import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  Maximize2,
  MemoryStick,
  Monitor,
  Power,
  PowerOff,
  Server,
  Usb,
  Wifi,
} from 'lucide-react';
import { AccordionBody, AnimatedMetricValue, COCKPIT_EASE, COCKPIT_SPRING } from './MotionPrimitives';
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
  epochTs?: number[];
  leftUnit?: string;
  maxLeft?: number;
  maxRight?: number;
  chartKind?: 'cpu' | 'ram' | 'gpu' | 'storage' | 'net';
  nicName?: string;
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
      return {
        usedBytes: 0,
        totalBytes: 0,
        freeBytes: 0,
        percent: 0,
        localUsedBytes: 0,
        localTotalBytes: 0,
        localFreeBytes: 0,
        localPercent: 0,
        netUsedBytes: 0,
        netTotalBytes: 0,
        netPoolsCount: 0,
        netMountsCount: 0,
        removableCount: 0,
        removableTotalBytes: 0,
        mainTemp: null as number | null,
      };
    }

    const resolvePoolKey = (d: DiskInfo): string => {
      if (d.pool_key) return d.pool_key;
      const fst = (d.fstype || '').toLowerCase();
      const dev = (d.device || '').trim();
      const isNet =
        d.kind === 'network' ||
        ['cifs', 'smb', 'smb3', 'nfs', 'nfs4', 'sshfs', 'fuse.sshfs', 'davfs'].includes(fst) ||
        dev.startsWith('//') ||
        (dev.includes(':/') && !dev.startsWith('/'));
      const total = Math.round(Number(d.total_bytes || 0));
      if (isNet) {
        const host = dev.startsWith('//')
          ? dev.replace(/^\/+/, '').split('/')[0].toLowerCase()
          : dev.includes(':/')
            ? dev.split(':')[0].toLowerCase()
            : dev.toLowerCase() || d.mountpoint;
        return `net:${host}:${total}`;
      }
      return `${d.kind || 'local'}:${dev || d.mountpoint}:${total}`;
    };

    const resolveKind = (d: DiskInfo): 'local' | 'removable' | 'network' => {
      if (d.kind) return d.kind;
      const fst = (d.fstype || '').toLowerCase();
      const dev = (d.device || '').trim();
      if (
        ['cifs', 'smb', 'smb3', 'nfs', 'nfs4', 'sshfs', 'fuse.sshfs', 'davfs'].includes(fst) ||
        dev.startsWith('//') ||
        (dev.includes(':/') && !dev.startsWith('/'))
      ) {
        return 'network';
      }
      if (d.is_removable) return 'removable';
      return 'local';
    };

    const seenPools = new Set<string>();
    const seenNetPools = new Set<string>();

    let total = 0;
    let used = 0;
    let free = 0;
    let localTotal = 0;
    let localUsed = 0;
    let localFree = 0;
    let netTotal = 0;
    let netUsed = 0;
    let netMountsCount = 0;
    let removableCount = 0;
    let removableTotal = 0;

    for (const d of disks) {
      const kind = resolveKind(d);
      const mounted = d.mounted !== false;
      const dTotal = Number(d.total_bytes || 0);
      const dUsed = Number(d.used_bytes || 0);
      const dFree = Number(d.free_bytes || 0);
      const pKey = resolvePoolKey(d);
      const isUniquePool = d.pool_primary !== false && !seenPools.has(pKey);

      if (kind === 'removable') {
        removableCount += 1;
        removableTotal += dTotal;
      }
      if (kind === 'network') {
        netMountsCount += 1;
        if (!seenNetPools.has(pKey)) {
          seenNetPools.add(pKey);
          netTotal += dTotal;
          netUsed += dUsed;
        }
      }

      if (!mounted || !isUniquePool) continue;
      seenPools.add(pKey);

      total += dTotal;
      used += dUsed;
      free += dFree;

      if (kind === 'local') {
        localTotal += dTotal;
        localUsed += dUsed;
        localFree += dFree;
      }
    }

    const root = disks.find((d) => d.mountpoint === '/') || disks[0];
    const headlineTotal = localTotal > 0 ? localTotal : total;
    const headlineUsed = localTotal > 0 ? localUsed : used;
    const headlinePct =
      headlineTotal > 0 ? Math.round((headlineUsed / headlineTotal) * 1000) / 10 : Number(root.percent || 0);
    const totalPct = total > 0 ? Math.round((used / total) * 1000) / 10 : headlinePct;

    return {
      usedBytes: used,
      totalBytes: total,
      freeBytes: free,
      percent: totalPct,
      localUsedBytes: localUsed,
      localTotalBytes: localTotal,
      localFreeBytes: localFree,
      localPercent: headlinePct,
      netUsedBytes: netUsed,
      netTotalBytes: netTotal,
      netPoolsCount: seenNetPools.size,
      netMountsCount,
      removableCount,
      removableTotalBytes: removableTotal,
      mainTemp: root.temp_c ?? null,
    };
  }, [disks]);

  const sortedDisks = useMemo(() => {
    const order = (d: DiskInfo) => (d.kind === 'removable' ? 1 : d.kind === 'network' ? 2 : 0);
    return [...disks].sort((a, b) => {
      const oa = order(a);
      const ob = order(b);
      if (oa !== ob) return oa - ob;
      if (a.mountpoint === '/') return -1;
      if (b.mountpoint === '/') return 1;
      return (a.mountpoint || '').localeCompare(b.mountpoint || '');
    });
  }, [disks]);

  const readRateBytes = Number(metrics?.disk_io?.read_bytes_sec ?? 0);
  const writeRateBytes = Number(metrics?.disk_io?.write_bytes_sec ?? 0);
  const netRxBytes = Number(metrics?.net?.rx_bytes_sec ?? 0);
  const netTxBytes = Number(metrics?.net?.tx_bytes_sec ?? 0);

  const activeInterfaces = useMemo(() => {
    const list =
      metrics?.net?.interfaces_list ||
      (metrics?.net?.interfaces ? Object.values(metrics.net.interfaces) : []);
    return list.filter((i) => i.is_up && i.name !== 'lo');
  }, [metrics?.net?.interfaces, metrics?.net?.interfaces_list]);

  const hist = metrics?.history;
  const timestamps = hist?.timestamps ?? [];
  const epochTs = hist?.epoch_ts ?? [];
  const cpuHist = hist?.cpu ?? [];
  const ramHist = hist?.ram ?? [];
  const gpuHist = hist?.gpu ?? [];
  const netRxHist = hist?.net_rx ?? [];
  const netTxHist = hist?.net_tx ?? [];
  const diskReadHist = hist?.disk_r ?? [];
  const diskWriteHist = hist?.disk_w ?? [];
  const diskPctHist = useMemo(() => {
    if (hist?.disk_pct && hist.disk_pct.length > 0) return hist.disk_pct;
    const len = Math.max(diskReadHist.length, timestamps.length);
    return len > 0 ? Array.from({ length: len }, () => storageSummary.localPercent) : [];
  }, [hist?.disk_pct, diskReadHist.length, timestamps.length, storageSummary.localPercent]);

  const cpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'cpu', metricKey: 'cpu', label: 'Procesador', data: cpuHist, color: '#0284c7', unit: '%' }],
    [cpuHist]
  );
  const ramSeries: ChartSeries[] = useMemo(
    () => [{ id: 'ram', metricKey: 'ram', label: 'Memoria RAM', data: ramHist, color: '#10b981', unit: '%' }],
    [ramHist]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', metricKey: 'gpu', label: 'Tarjeta gráfica', data: gpuHist, color: '#7c3aed', unit: '%' }],
    [gpuHist]
  );
  const netSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'net_rx', metricKey: 'net_rx', label: 'Descarga', data: netRxHist, color: '#0284c7', unit: 'MB/s', decimals: 2, fillAlpha: 0.16 },
      { id: 'net_tx', metricKey: 'net_tx', label: 'Subida', data: netTxHist, color: '#10b981', unit: 'MB/s', decimals: 2, fillAlpha: 0.08 },
    ],
    [netRxHist, netTxHist]
  );
  const storageSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'disk_r', metricKey: 'disk_r', label: 'Lectura', data: diskReadHist, color: '#f59e0b', unit: 'MB/s', decimals: 2, fillAlpha: 0.16, axis: 'left' },
      { id: 'disk_w', metricKey: 'disk_w', label: 'Escritura', data: diskWriteHist, color: '#ea580c', unit: 'MB/s', decimals: 2, fillAlpha: 0.08, axis: 'left' },
      { id: 'disk_pct', metricKey: 'disk_pct', label: 'Espacio usado', data: diskPctHist, color: '#64748b', unit: '%', decimals: 1, fillAlpha: 0, dashed: true, axis: 'right' },
    ],
    [diskReadHist, diskWriteHist, diskPctHist]
  );

  const cpuTone = getHealthTone(cpuPct);
  const ramTone = getHealthTone(ramPct);
  const gpuTone = getHealthTone(gpuPct);
  const diskTone = getHealthTone(storageSummary.localPercent);

  const onlineWifi = useMemo(
    () => (metrics?.wifi_clients ?? []).filter((c) => c.online !== false && c.is_online !== false),
    [metrics?.wifi_clients]
  );
  const controllableClients = useMemo(
    () => (metrics?.wifi_clients ?? []).filter((c) => !c.is_server && !c.is_gateway).slice(0, 6),
    [metrics?.wifi_clients]
  );

  const totalErrors = Number(metrics?.system_errors_summary?.total_errors ?? metrics?.system_errors_summary?.total ?? 0);
  const overallBusy = cpuPct >= 88 || ramPct >= 90 || storageSummary.percent >= 92;

  return (
    <div className="space-y-6">
      {/* Hero Telemetry Summary Banner (matching docs/assets/hero-banner.svg) */}
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.992 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.44, ease: COCKPIT_EASE }}
        className="cockpit-hero p-5 sm:p-6"
      >
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="cockpit-pill-cyan inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 text-sky-500 cockpit-live-dot cockpit-live-ring" />
                {metrics?.system?.hostname || 'Servidor doméstico'}
              </span>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Telemetría y control unificado
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              {overallBusy ? 'El servidor tiene carga alta ahora mismo' : 'Todo funciona con normalidad'}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="cockpit-subtile inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] tabular-nums">
                Encendido {metrics?.system?.uptime_str || '--'}
              </span>
              <span className="cockpit-subtile inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] tabular-nums">
                <Wifi className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                {onlineWifi.length} aparatos conectados
              </span>
              <span className="cockpit-subtile inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] tabular-nums">
                Internet ↓ {formatSpeed(metrics?.net?.rx_bytes_sec)} / ↑ {formatSpeed(metrics?.net?.tx_bytes_sec)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {totalErrors > 0 ? (
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => setShowErrorsDetail((v) => !v)}
                className="cockpit-pill-amber inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{totalErrors} {totalErrors === 1 ? 'aviso reciente' : 'avisos recientes'}</span>
                {showErrorsDetail ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => onNavigate('equipo')}
                className="cockpit-btn-accent inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap"
              >
                <Activity className="h-4 w-4 shrink-0" />
                <span>Ver equipo al detalle</span>
              </motion.button>
            )}
          </div>
        </div>

        <AccordionBody open={showErrorsDetail}>
          <div className="mt-4 border-t border-slate-200/80 pt-4 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Se han registrado {totalErrors} avisos en los servicios del servidor o en la geolocalización de red.
              </span>
              <button
                type="button"
                onClick={() => onNavigate('mas', 'logs')}
                className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
              >
                Abrir registro completo
              </button>
            </div>
          </div>
        </AccordionBody>
      </motion.section>

      {/* Primary 4 Real-Time Telemetry Widgets: CPU, RAM, GPU, Almacenamiento (cockpit-ui-preview.svg) */}
      <section aria-label="Panel de rendimiento en tiempo real" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 1. Procesador (CPU) */}
        <motion.article
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, delay: 0.04, ease: COCKPIT_EASE }}
          whileHover={{ y: -2, transition: { duration: 0.2 } }}
          className="cockpit-bento flex flex-col justify-between p-5"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-cyan inline-flex h-6 w-6 items-center justify-center rounded-lg">
                    <Cpu className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Procesador</span>
                  <span aria-hidden="true">·</span>
                  <span className={cpuTone.textClass}>{cpuTone.label}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                  <AnimatedMetricValue
                    value={cpuPct}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    {formatTemp(cpuTemp)}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs text-slate-500 dark:text-slate-400 max-w-[290px]">
                  {metrics?.cpu?.model || 'Procesador principal'} ({metrics?.cpu?.logical_cores || 0} núcleos)
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                aria-label="Ampliar gráfica de procesador"
                onClick={() =>
                  onExpandChart({
                    title: 'Uso del procesador en tiempo real',
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
              </motion.button>
            </div>

            {/* Sleek spring horizontal progress bar */}
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, Math.min(100, cpuPct))}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#0284c7] dark:bg-[#38bdf8]"
              />
            </div>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={cpuSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={160}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Uso del procesador en tiempo real',
                  subtitle: metrics?.cpu?.model || 'Procesador principal',
                  series: cpuSeries,
                  timestamps,
                  epochTs,
                  leftUnit: '%',
                  maxLeft: 100,
                  chartKind: 'cpu',
                })
              }
            />
          </div>
        </motion.article>

        {/* 2. Memoria RAM */}
        <motion.article
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, delay: 0.08, ease: COCKPIT_EASE }}
          whileHover={{ y: -2, transition: { duration: 0.2 } }}
          className="cockpit-bento flex flex-col justify-between p-5"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-emerald inline-flex h-6 w-6 items-center justify-center rounded-lg">
                    <MemoryStick className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Memoria RAM</span>
                  <span aria-hidden="true">·</span>
                  <span className={ramTone.textClass}>{ramTone.label}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                  <AnimatedMetricValue
                    value={ramPct}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-emerald rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    {formatBytes(ramUsed)} / {formatBytes(ramTotal)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Libre y lista: {formatBytes(metrics?.ram?.available_bytes)}
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                aria-label="Ampliar gráfica de memoria"
                onClick={() =>
                  onExpandChart({
                    title: 'Uso de memoria RAM en tiempo real',
                    subtitle: `${formatBytes(ramUsed)} usados de ${formatBytes(ramTotal)}`,
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
              </motion.button>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, Math.min(100, ramPct))}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#10b981] dark:bg-[#34d399]"
              />
            </div>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={ramSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={160}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Uso de memoria RAM en tiempo real',
                  subtitle: `${formatBytes(ramUsed)} usados de ${formatBytes(ramTotal)}`,
                  series: ramSeries,
                  timestamps,
                  epochTs,
                  leftUnit: '%',
                  maxLeft: 100,
                  chartKind: 'ram',
                })
              }
            />
          </div>
        </motion.article>

        {/* 3. Tarjeta gráfica (GPU) */}
        <motion.article
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, delay: 0.12, ease: COCKPIT_EASE }}
          whileHover={{ y: -2, transition: { duration: 0.2 } }}
          className="cockpit-bento flex flex-col justify-between p-5"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-violet inline-flex h-6 w-6 items-center justify-center rounded-lg">
                    <Monitor className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Tarjeta gráfica</span>
                  <span aria-hidden="true">·</span>
                  <span className={gpuAvail ? gpuTone.textClass : 'text-slate-500 dark:text-slate-400'}>
                    {gpuAvail ? gpuTone.label : 'En reposo'}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                  <AnimatedMetricValue
                    value={gpuAvail ? gpuPct : 0}
                    decimals={gpuAvail ? 1 : 0}
                    suffix=" %"
                    className="font-mono text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    {gpuAvail ? formatTemp(gpuTemp) : 'Integrada'}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs text-slate-500 dark:text-slate-400 max-w-[290px]">
                  {gpuAvail
                    ? `${metrics?.gpu?.name || 'Gráfica'}${gpuVramTotal > 0 ? ` · ${gpuVramUsed} / ${gpuVramTotal} MB vídeo` : ''}`
                    : 'Vídeo integrado sin carga multimedia'}
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                aria-label="Ampliar gráfica de tarjeta gráfica"
                onClick={() =>
                  onExpandChart({
                    title: 'Actividad de tarjeta gráfica en tiempo real',
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
              </motion.button>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(gpuAvail ? 2 : 0, Math.min(100, gpuPct))}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#7c3aed] dark:bg-[#a78bfa]"
              />
            </div>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={gpuSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={160}
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Actividad de tarjeta gráfica en tiempo real',
                  subtitle: metrics?.gpu?.name || 'Gráfica del sistema',
                  series: gpuSeries,
                  timestamps,
                  epochTs,
                  leftUnit: '%',
                  maxLeft: 100,
                  chartKind: 'gpu',
                })
              }
            />
          </div>
        </motion.article>

        {/* 4. Red e Internet (Tráfico en tiempo real Descarga / Subida MB/s) */}
        <motion.article
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, delay: 0.16, ease: COCKPIT_EASE }}
          whileHover={{ y: -2, transition: { duration: 0.2 } }}
          className="cockpit-bento flex flex-col justify-between p-5"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-cyan inline-flex h-6 w-6 items-center justify-center rounded-lg">
                    <ArrowDownUp className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Red e Internet</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {activeInterfaces.length > 0 ? `${activeInterfaces.length} enlace${activeInterfaces.length === 1 ? '' : 's'} activo${activeInterfaces.length === 1 ? '' : 's'}` : 'Activa'}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                  <span className="font-mono text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white sm:text-3xl">
                    ↓ {formatSpeed(netRxBytes)}
                  </span>
                  <span className="cockpit-pill-emerald rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    ↑ {formatSpeed(netTxBytes)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums">
                    {metrics?.net?.local_ip || activeInterfaces[0]?.ip || 'LAN'}
                    {activeInterfaces[0]?.name ? ` (${activeInterfaces.map((n) => n.name).slice(0, 2).join(', ')})` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-sky-600" /> Descarga
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Subida
                    </span>
                  </span>
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                aria-label="Ampliar gráfica de red"
                onClick={() =>
                  onExpandChart({
                    title: 'Tráfico de red global e historial completo',
                    subtitle: `${metrics?.net?.local_ip || 'Interfaz principal'} · ↓ ${formatSpeed(netRxBytes)} · ↑ ${formatSpeed(netTxBytes)}`,
                    series: netSeries,
                    timestamps,
                    epochTs,
                    leftUnit: 'MB/s',
                    chartKind: 'net',
                  })
                }
                className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
              >
                <Maximize2 className="h-4 w-4" />
              </motion.button>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.max(4, Math.min(100, ((netRxBytes + netTxBytes) / (1024 * 1024)) * 2.5))}%`,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                className="cockpit-progress-fill h-full rounded-full bg-gradient-to-r from-[#0284c7] to-[#10b981]"
              />
            </div>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={netSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={160}
              leftUnit="MB/s"
              theme={theme}
              emptyMessage="Registrando tráfico de red..."
              onExpandClick={() =>
                onExpandChart({
                  title: 'Tráfico de red global e historial completo',
                  subtitle: `${metrics?.net?.local_ip || 'Interfaz principal'} · ↓ ${formatSpeed(netRxBytes)} · ↑ ${formatSpeed(netTxBytes)}`,
                  series: netSeries,
                  timestamps,
                  epochTs,
                  leftUnit: 'MB/s',
                  chartKind: 'net',
                })
              }
            />
          </div>
        </motion.article>

        {/* 5. Almacenamiento + Unidades Separadas (Locales, Extraíbles USB/SD y Red/NAS deduplicado) */}
        <motion.article
          initial={{ opacity: 0, y: 16, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.44, delay: 0.2, ease: COCKPIT_EASE }}
          className="cockpit-bento md:col-span-2 flex flex-col justify-between p-5"
        >
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-amber inline-flex h-6 w-6 items-center justify-center rounded-lg">
                    <HardDrive className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    Almacenamiento y discos disponibles
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={diskTone.textClass}>{diskTone.label}</span>
                </div>

                <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                  <AnimatedMetricValue
                    value={storageSummary.localTotalBytes > 0 ? storageSummary.localPercent : storageSummary.percent}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-amber rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    L {formatMbRate(readRateBytes / (1024 * 1024))} · E {formatMbRate(writeRateBytes / (1024 * 1024))}
                  </span>
                  <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                    Local: {formatBytes(storageSummary.localUsedBytes)} / {formatBytes(storageSummary.localTotalBytes)}
                  </span>
                  {storageSummary.netPoolsCount > 0 && (
                    <span
                      title="Los recursos compartidos del mismo servidor NAS comparten el mismo espacio físico y no se multiplican en el total"
                      className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
                    >
                      NAS único ({storageSummary.netMountsCount} carpetas): {formatBytes(storageSummary.netUsedBytes)} / {formatBytes(storageSummary.netTotalBytes)}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                      storageSummary.removableCount > 0 ? 'cockpit-pill-violet' : 'cockpit-subtile text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    Extraíbles USB/SD: {storageSummary.removableCount > 0 ? `${storageSummary.removableCount} (${formatBytes(storageSummary.removableTotalBytes)})` : '0 conectadas'}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    Capacidad total combinada (sin duplicar NAS):{' '}
                    <strong className="font-mono text-slate-800 dark:text-slate-200">
                      {formatBytes(storageSummary.usedBytes)} / {formatBytes(storageSummary.totalBytes)}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> Lectura
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

              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                aria-label="Ampliar gráfica de almacenamiento"
                onClick={() =>
                  onExpandChart({
                    title: 'Actividad de discos y espacio usado',
                    subtitle: `Local libre: ${formatBytes(storageSummary.localFreeBytes)} · Combinado real: ${formatBytes(storageSummary.totalBytes)}`,
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
              </motion.button>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.max(
                    2,
                    Math.min(100, storageSummary.localTotalBytes > 0 ? storageSummary.localPercent : storageSummary.percent)
                  )}%`,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#f59e0b] dark:bg-[#fbbf24]"
              />
            </div>
          </div>

          <div className="mt-4">
            <TelemetryChart
              series={storageSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              height={165}
              maxRight={100}
              leftUnit="MB/s"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: 'Actividad de discos y espacio usado',
                  subtitle: `Local libre: ${formatBytes(storageSummary.localFreeBytes)} · Combinado real: ${formatBytes(storageSummary.totalBytes)}`,
                  series: storageSeries,
                  timestamps,
                  epochTs,
                  leftUnit: 'MB/s',
                  maxRight: 100,
                  chartKind: 'storage',
                })
              }
            />
          </div>

          {/* Unidades disponibles por separado: discos locales, memorias extraíbles y recursos compartidos NAS */}
          {sortedDisks.length > 0 && (
            <div className="mt-5 border-t border-slate-200/70 pt-4 dark:border-slate-800">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Unidades detectadas en el sistema ({sortedDisks.length})
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('equipo', 'storage')}
                  className="text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                >
                  Gestionar discos en detalle →
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {sortedDisks.map((d, idx) => {
                  const pct = Math.min(100, Math.max(0, Number(d.percent || 0)));
                  const isNet = d.kind === 'network';
                  const isRem = d.kind === 'removable' || Boolean(d.is_removable);
                  const isMounted = d.mounted !== false;
                  const barColor =
                    pct >= 90 ? '#ef4444' : isRem ? '#7c3aed' : isNet ? '#0284c7' : '#f59e0b';
                  const iconPillClass = isRem
                    ? 'cockpit-pill-violet'
                    : isNet
                      ? 'cockpit-pill-cyan'
                      : 'cockpit-pill-amber';
                  return (
                    <motion.div
                      key={`${d.mountpoint}-${d.device || idx}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: Math.min(idx * 0.03, 0.24), ease: COCKPIT_EASE }}
                      className="cockpit-subtile flex flex-col justify-between p-3"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconPillClass}`}>
                              {isRem ? (
                                <Usb className="h-3.5 w-3.5" />
                              ) : isNet ? (
                                <Server className="h-3.5 w-3.5" />
                              ) : (
                                <HardDrive className="h-3.5 w-3.5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                                {d.label || d.mountpoint}
                              </p>
                              <p className="truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                {d.mountpoint}
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-800 dark:text-slate-100">
                            {isMounted ? formatPct(pct) : 'Libre'}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {d.transport && (
                            <span className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {d.transport}
                            </span>
                          )}
                          {d.fstype && (
                            <span className="rounded-md bg-slate-200/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-400">
                              {d.fstype.toUpperCase()}
                            </span>
                          )}
                          {!isMounted && (
                            <span className="cockpit-pill-violet rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                              Conectada · Sin montar
                            </span>
                          )}
                          {isNet && d.pool_primary === false && (
                            <span
                              title={`Comparte capacidad física con ${d.pool_shared_with || 'otro recurso del mismo NAS'}`}
                              className="cockpit-pill-cyan rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                            >
                              Mismo pool NAS
                            </span>
                          )}
                          {d.temp_c !== null && d.temp_c !== undefined && (
                            <span className="cockpit-pill-amber rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                              {formatTemp(d.temp_c)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${isMounted ? Math.max(2, pct) : 100}%` }}
                            transition={{ duration: 0.45, ease: COCKPIT_EASE }}
                            className="h-full rounded-full"
                            style={{
                              backgroundColor: barColor,
                              opacity: isMounted ? 1 : 0.35,
                            }}
                          />
                        </div>
                        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                          {isMounted
                            ? `${formatBytes(d.used_bytes)} usados · ${formatBytes(d.free_bytes)} libres de ${formatBytes(d.total_bytes)}`
                            : `Capacidad total detectada: ${formatBytes(d.total_bytes)}`}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.article>
      </section>

      {/* Quick Control Row: Aparatos en casa con botones simétricos Encender / Apagar */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.44, delay: 0.2, ease: COCKPIT_EASE }}
        className="cockpit-bento p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Aparatos de tu red doméstica
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enciende o apaga equipos compatibles directamente desde aquí
            </p>
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={() => onNavigate('red')}
            className="cockpit-subtile min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-sky-300 whitespace-nowrap"
          >
            Ver todos ({metrics?.wifi_clients?.length ?? 0})
          </motion.button>
        </div>

        {controllableClients.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No se detectaron otros aparatos en tu red en este instante. Pulsa en «Ver todos» para revisar la red.
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {controllableClients.map((client, idx) => {
              const isOnline = client.online !== false && client.is_online !== false;
              const mac = client.mac || `idx-${idx}`;
              const pending = actionPendingMac === mac;
              const label = client.name || client.hostname || client.ip || 'Dispositivo de red';

              return (
                <motion.div
                  key={`${mac}-${client.ip || idx}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.04 * idx, ease: COCKPIT_EASE }}
                  whileHover={{ scale: 1.004 }}
                  className="cockpit-subtile flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isOnline ? 'cockpit-pill-cyan' : 'bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      <Wifi className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {label}
                        </p>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isOnline ? 'bg-emerald-500 text-emerald-500 cockpit-live-dot cockpit-live-ring' : 'bg-slate-400'
                          }`}
                        />
                      </div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {isOnline ? 'Conectado ahora' : 'Apagado o en espera'}
                        {client.ip ? ` · ${client.ip}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      type="button"
                      disabled={pending || !client.mac}
                      onClick={() => onPowerAction('wake', client)}
                      title="Enviar señal de encendido (Wake-on-LAN)"
                      className="cockpit-btn-wol inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap"
                    >
                      <Power className="h-3.5 w-3.5 shrink-0" />
                      <span>Encender</span>
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      type="button"
                      disabled={pending || (!client.ip && !client.mac)}
                      onClick={() => onPowerAction('shutdown', client)}
                      title="Enviar señal de apagado o suspensión por red"
                      className="cockpit-btn-off inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap"
                    >
                      <PowerOff className="h-3.5 w-3.5 shrink-0" />
                      <span>Apagar</span>
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.section>
    </div>
  );
};
