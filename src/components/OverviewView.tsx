import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cpu,
  HardDrive,
  Maximize2,
  MemoryStick,
  Monitor,
  Power,
  PowerOff,
  Router,
  Server,
  Sparkles,
  Usb,
  Wifi,
} from 'lucide-react';
import { AccordionBody, AnimatedMetricValue, COCKPIT_EASE, COCKPIT_SPRING } from './MotionPrimitives';
import {
  AlethiaActionButton,
  AlethiaSectionTag,
  ChartNarrativeFooter,
  RadialKpiGauge,
} from './DataVizPrimitives';
import { NetworkDevicesModal, NetworkInspectTab } from './NetworkDevicesModal';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import {
  AiSimplifyFaultsResponse,
  AiSystemFaultInsight,
  DiskInfo,
  MainTabId,
  MetricsPayload,
  ThemeMode,
  WifiClient,
} from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import {
  formatBytes,
  formatMbRate,
  formatSpeed,
  formatTemp,
  getHealthTone,
} from '../utils/formatters';
import {
  formatDiskFstype,
  formatDiskLabel,
  formatDiskTransport,
  useI18n,
} from '../i18n';

export interface ExpandChartSpec {
  title: string;
  subtitle: string;
  series: ChartSeries[];
  timestamps: string[];
  epochTs?: number[];
  leftUnit?: string;
  maxLeft?: number;
  maxRight?: number;
  chartKind?: 'cpu' | 'ram' | 'gpu' | 'storage' | 'net' | 'router' | 'ping';
  gpuSubmetric?: 'compute' | 'vram' | 'video' | 'power_temp' | 'clocks' | 'pcie';
  nicName?: string;
  diskMountpoint?: string;
  entityKind?: 'disk' | 'nic' | 'cpu_sensor';
  entityId?: string;
}

interface OverviewViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onNavigate: (tab: MainTabId, subTab?: string) => void;
  onExpandChart: (spec: ExpandChartSpec) => void;
  onPowerAction: (action: 'wake' | 'shutdown', client: WifiClient) => void;
  actionPendingMac: string | null;
}

const OVERVIEW_WINDOW_SECONDS = 300; // Ventana en vivo de 5 minutos en Inicio

interface OverviewDiskCardProps {
  disk: DiskInfo;
  timestamps: string[];
  epochTs: number[];
  theme: ThemeMode;
  locale: string;
  onExpandChart: (spec: ExpandChartSpec) => void;
}

const OverviewDiskCard = React.memo<OverviewDiskCardProps>(
  ({ disk: d, timestamps, epochTs, theme, locale, onExpandChart }) => {
    const { t } = useI18n();
    const isNet = d.kind === 'network';
    const isRem = d.kind === 'removable' || Boolean(d.is_removable);
    const isMounted = d.mounted !== false;
    const pct = Math.min(100, Math.max(0, Number(d.percent ?? 0)));
    const tone = getHealthTone(pct);
    const readMb = Number(d.read_bytes_sec ?? 0) / (1024 * 1024);
    const writeMb = Number(d.write_bytes_sec ?? 0) / (1024 * 1024);

    const pillClass = isRem
      ? 'cockpit-pill-violet'
      : isNet
        ? 'cockpit-pill-emerald'
        : 'cockpit-pill-amber';
    const isDark = theme === 'dark';
    const readColor = isRem
      ? isDark
        ? '#a5b4fc'
        : '#4f46e5'
      : isNet
        ? isDark
          ? '#5eead4'
          : '#0e7490'
        : isDark
          ? '#fbbf24'
          : '#b45309';
    const writeColor = isRem
      ? isDark
        ? '#c7d2fe'
        : '#6366f1'
      : isNet
        ? isDark
          ? '#c6f19d'
          : '#1e6b38'
        : isDark
          ? '#fdba74'
          : '#d97706';
    const barClass =
      pct >= 90
        ? 'bg-[#dc2626] dark:bg-[#fb7185]'
        : isRem
          ? 'bg-[#4f46e5] dark:bg-[#a5b4fc]'
          : isNet
            ? 'bg-[#0e7490] dark:bg-[#5eead4]'
            : 'bg-[#b45309] dark:bg-[#fbbf24]';

    const devStr = String(d.device || '');
    const netHost = isNet
      ? devStr.startsWith('//')
        ? devStr.replace(/^\/+/, '').split('/')[0]
        : devStr.includes(':/')
          ? devStr.split(':')[0]
          : devStr
      : '';
    const sharedLabels = (d.shared_labels || []).filter(Boolean);
    const resolvedDiskLabel = formatDiskLabel(d, locale);
    const resolvedTransport = formatDiskTransport(d, locale);
    const resolvedFstype = formatDiskFstype(d, locale);
    const widgetTitle =
      d.mountpoint === '/'
        ? t('hardware.storage.label.disk_system')
        : isNet
          ? t('hardware.storage.label.nas_host', { host: netHost || d.mountpoint })
          : resolvedDiskLabel;
    const statusText = !isMounted
      ? t('hardware.storage.unmounted')
      : isNet && sharedLabels.length > 1
        ? t('hardware.storage.folders_count', { count: sharedLabels.length })
        : isRem
          ? t('hardware.storage.removable_badge')
          : tone.label;
    const statusClass = !isMounted
      ? 'text-violet-600 dark:text-violet-400'
      : isNet
        ? 'text-sky-600 dark:text-sky-400'
        : tone.textClass;

    const { diskSeries, diskTimestamps, diskEpochTs } = useMemo(() => {
      const rawIoHist = d.io_history || [];
      let ioHist = rawIoHist;
      if (rawIoHist.length >= 2) {
        const latestMs = Number(rawIoHist[rawIoHist.length - 1]?.t ?? 0);
        if (!Number.isFinite(latestMs) || latestMs <= 0) {
          ioHist = rawIoHist.slice(-60);
        } else {
          const cutoffMs = latestMs - OVERVIEW_WINDOW_SECONDS * 1000;
          const idx = rawIoHist.findIndex((b) => Number(b.t) >= cutoffMs);
          if (idx < 0) {
            ioHist = rawIoHist.slice(-2);
          } else {
            const sliced = rawIoHist.slice(Math.min(idx, Math.max(0, rawIoHist.length - 2)));
            ioHist = sliced.length >= 2 ? sliced : rawIoHist.slice(-2);
          }
        }
      }

      const diskReadPoints =
        ioHist.length >= 2
          ? ioHist.map((b) => Math.round(((b.r || 0) / (1024 * 1024)) * 100) / 100)
          : [Math.round(readMb * 100) / 100, Math.round(readMb * 100) / 100];
      const diskWritePoints =
        ioHist.length >= 2
          ? ioHist.map((b) => Math.round(((b.w || 0) / (1024 * 1024)) * 100) / 100)
          : [Math.round(writeMb * 100) / 100, Math.round(writeMb * 100) / 100];
      const computedTimestamps =
        ioHist.length >= 2
          ? ioHist.map((b) => new Date(b.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale))
          : timestamps.slice(-2);
      const computedEpochTs =
        ioHist.length >= 2
          ? ioHist.map((b) => Math.round(b.t / 1000))
          : epochTs.slice(-2);

      const series: ChartSeries[] = [
        {
          id: 'disk_r',
          metricKey: 'disk_r',
          label: t('hardware.storage.read'),
          data: diskReadPoints,
          color: readColor,
          unit: 'MB/s',
          decimals: 2,
          fillAlpha: 0.16,
        },
        {
          id: 'disk_w',
          metricKey: 'disk_w',
          label: t('hardware.storage.write'),
          data: diskWritePoints,
          color: writeColor,
          unit: 'MB/s',
          decimals: 2,
          fillAlpha: 0.08,
        },
      ];

      return {
        diskSeries: series,
        diskTimestamps: computedTimestamps,
        diskEpochTs: computedEpochTs,
      };
    }, [d.io_history, readMb, writeMb, readColor, writeColor, locale, timestamps, epochTs, t]);

    const expandSpec = useMemo<ExpandChartSpec>(
      () => ({
        title: t('hardware.storage.activity_capacity', { name: widgetTitle }),
        subtitle: isMounted
          ? t('hardware.storage.free_of_total_mount', {
              free: formatBytes(d.free_bytes),
              total: formatBytes(d.total_bytes),
              mount: d.mountpoint,
            })
          : t('hardware.storage.detected_device', { dev: d.device || d.mountpoint }),
        series: diskSeries,
        timestamps: diskTimestamps,
        epochTs: diskEpochTs,
        leftUnit: 'MB/s',
        chartKind: 'storage',
        diskMountpoint: d.mountpoint,
        entityKind: 'disk',
        entityId: d.device || d.mountpoint,
      }),
      [widgetTitle, isMounted, d.free_bytes, d.total_bytes, d.mountpoint, d.device, diskSeries, diskTimestamps, diskEpochTs, t]
    );

    const subtitleText =
      isNet && sharedLabels.length > 0
        ? `${sharedLabels.join(' · ')}${resolvedTransport ? ` · ${resolvedTransport}` : ''}`
        : `${d.mountpoint}${resolvedTransport ? ` · ${resolvedTransport}` : ''}${resolvedFstype ? ` · ${resolvedFstype}` : ''}`;

    return (
      <motion.article
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.36, ease: COCKPIT_EASE }}
        className="cockpit-bento flex flex-col justify-between p-3.5 sm:p-4"
      >
        <div>
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className={`${pillClass} inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md`}>
                  {isRem ? (
                    <Usb className="h-3 w-3" />
                  ) : isNet ? (
                    <Server className="h-3 w-3" />
                  ) : (
                    <HardDrive className="h-3 w-3" />
                  )}
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {widgetTitle}
                </span>
                <span className={`shrink-0 text-[10.5px] font-medium ${statusClass}`}>{statusText}</span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                {isMounted ? (
                  <AnimatedMetricValue
                    value={pct}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                ) : (
                  <span className="font-mono text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                    {formatBytes(d.total_bytes)}
                  </span>
                )}
                <span className={`${pillClass} rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums`}>
                  {isMounted
                    ? `${formatBytes(d.used_bytes)} / ${formatBytes(d.total_bytes)}`
                    : resolvedTransport || t('hardware.storage.connected_badge')}
                </span>
                {d.temp_c !== null && d.temp_c !== undefined && (
                  <span className="cockpit-pill-amber rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                    {formatTemp(d.temp_c)}
                  </span>
                )}
              </div>

              <div className="mt-1 flex items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="min-w-0 truncate" title={subtitleText}>
                  {subtitleText}
                </span>
                <span aria-hidden="true" className="shrink-0">·</span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-slate-600 dark:text-slate-300">
                  {t('hardware.storage.read_short')} {formatMbRate(readMb)} · {t('hardware.storage.write_short')} {formatMbRate(writeMb)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isMounted && (
                <RadialKpiGauge
                  value={pct}
                  size={44}
                  strokeWidth={4.5}
                  theme={theme}
                  color={pct >= 90 ? undefined : readColor}
                />
              )}
              <motion.button
                type="button"
                aria-label={t('hardware.storage.expand_aria', { name: widgetTitle })}
                onClick={() => onExpandChart(expandSpec)}
                className="cockpit-subtile flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </motion.button>
            </div>
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${isMounted ? Math.max(2, pct) : 100}%` }}
              transition={{ type: 'spring', stiffness: 210, damping: 14, mass: 0.7 }}
              className={`cockpit-progress-fill h-full rounded-full ${barClass}`}
              style={{ opacity: isMounted ? 1 : 0.35 }}
            />
          </div>
        </div>

        <div className="mt-2.5">
          <TelemetryChart
            series={diskSeries}
            timestamps={diskTimestamps}
            epochTs={diskEpochTs}
            heightClassName="cockpit-chart-compact"
            leftUnit="MB/s"
            theme={theme}
            onExpandClick={() => onExpandChart(expandSpec)}
          />
          <ChartNarrativeFooter data={diskSeries[0]?.data ?? []} unit="MB/s" decimals={2} />
        </div>
      </motion.article>
    );
  }
);

export const OverviewView: React.FC<OverviewViewProps> = ({
  metrics,
  theme,
  onNavigate,
  onExpandChart,
  onPowerAction,
  actionPendingMac,
}) => {
  const { t, locale } = useI18n();
  const [showErrorsDetail, setShowErrorsDetail] = useState(false);
  const [devicesModalMode, setDevicesModalMode] = useState<NetworkInspectTab | null>(null);
  const [simplifyingOverviewFaults, setSimplifyingOverviewFaults] = useState(false);
  const [localFaultHistory, setLocalFaultHistory] = useState<AiSystemFaultInsight[]>([]);

  const handleOverviewSimplifyFaults = async () => {
    setSimplifyingOverviewFaults(true);
    const res = await apiFetchJson<AiSimplifyFaultsResponse>('/api/system/logs/ai-simplify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        failed_units: metrics?.system_errors_summary?.failed_units ?? [],
        locale,
      }),
    });
    setSimplifyingOverviewFaults(false);
    if (res.ok && res.data?.status === 'ok') {
      if (Array.isArray(res.data.ai_fault_history)) {
        setLocalFaultHistory(res.data.ai_fault_history);
      } else if (res.data.ai_fault_insights) {
        setLocalFaultHistory(Object.values(res.data.ai_fault_insights));
      }
    }
  };

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

  const independentDisks = useMemo(() => {
    const seenKeys = new Set<string>();
    const unique: DiskInfo[] = [];
    for (const d of disks) {
      if (d.pool_primary === false) continue;
      const key = d.pool_key || d.mountpoint || d.device || '';
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      unique.push(d);
    }
    const order = (d: DiskInfo) => (d.kind === 'removable' ? 1 : d.kind === 'network' ? 2 : 0);
    return unique.sort((a, b) => {
      const oa = order(a);
      const ob = order(b);
      if (oa !== ob) return oa - ob;
      if (a.mountpoint === '/') return -1;
      if (b.mountpoint === '/') return 1;
      return (a.mountpoint || '').localeCompare(b.mountpoint || '');
    });
  }, [disks]);

  const wifiSummary = metrics?.wifi_summary;
  const routerWanAvailable = Boolean(wifiSummary?.router_wan_available);

  const hostLanRxBytes = Number(metrics?.net?.lan_rx_bytes_sec ?? 0);
  const hostLanTxBytes = Number(metrics?.net?.lan_tx_bytes_sec ?? 0);
  const wanRxBytes = routerWanAvailable
    ? Number(wifiSummary?.router_wan_rx_bytes_sec ?? metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0)
    : Number(metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0);
  const wanTxBytes = routerWanAvailable
    ? Number(wifiSummary?.router_wan_tx_bytes_sec ?? metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0)
    : Number(metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0);
  const lanRxBytes = routerWanAvailable
    ? Number(wifiSummary?.router_lan_rx_bytes_sec ?? hostLanRxBytes)
    : hostLanRxBytes;
  const lanTxBytes = routerWanAvailable
    ? Number(wifiSummary?.router_lan_tx_bytes_sec ?? hostLanTxBytes)
    : hostLanTxBytes;

  const activeInterfaces = useMemo(() => {
    const list =
      metrics?.net?.interfaces_list ||
      (metrics?.net?.interfaces ? Object.values(metrics.net.interfaces) : []);
    return list.filter((i) => i.is_up && i.name !== 'lo');
  }, [metrics?.net?.interfaces, metrics?.net?.interfaces_list]);

  const hist = metrics?.history;
  const {
    timestamps,
    epochTs,
    cpuHist,
    cpuTempHist,
    ramHist,
    gpuHist,
    netWanRxHist,
    netWanTxHist,
    netLanRxHist,
    netLanTxHist,
  } = useMemo(() => {
    const rawTs = hist?.timestamps ?? [];
    const rawEpoch = hist?.epoch_ts ?? [];
    const rawCpu = hist?.cpu ?? [];
    const rawCpuTemp = hist?.cpu_temp ?? [];
    const rawRam = hist?.ram ?? [];
    const rawGpu = hist?.gpu ?? [];
    const rawNetRx = hist?.net_rx ?? [];
    const rawNetTx = hist?.net_tx ?? [];
    const rawWanRx = hist?.net_wan_rx && hist.net_wan_rx.length > 0 ? hist.net_wan_rx : rawNetRx;
    const rawWanTx = hist?.net_wan_tx && hist.net_wan_tx.length > 0 ? hist.net_wan_tx : rawNetTx;
    const rawLanRx =
      hist?.net_lan_rx && hist.net_lan_rx.length > 0 ? hist.net_lan_rx : rawNetRx.map(() => 0);
    const rawLanTx =
      hist?.net_lan_tx && hist.net_lan_tx.length > 0 ? hist.net_lan_tx : rawNetTx.map(() => 0);

    const totalLen = Math.max(
      rawTs.length,
      rawEpoch.length,
      rawCpu.length,
      rawRam.length,
      rawGpu.length,
      rawWanRx.length,
      rawWanTx.length,
      rawLanRx.length,
      rawLanTx.length
    );

    if (totalLen === 0) {
      return {
        timestamps: rawTs,
        epochTs: rawEpoch,
        cpuHist: rawCpu,
        cpuTempHist: rawCpuTemp,
        ramHist: rawRam,
        gpuHist: rawGpu,
        netWanRxHist: rawWanRx,
        netWanTxHist: rawWanTx,
        netLanRxHist: rawLanRx,
        netLanTxHist: rawLanTx,
      };
    }

    let startIdx = Math.max(0, totalLen - 60);
    if (rawEpoch.length >= 2) {
      const latestEpoch = Number(rawEpoch[rawEpoch.length - 1]);
      if (Number.isFinite(latestEpoch) && latestEpoch > 0) {
        const cutoff = latestEpoch - OVERVIEW_WINDOW_SECONDS;
        const foundIdx = rawEpoch.findIndex((t) => Number(t) >= cutoff);
        if (foundIdx >= 0) {
          startIdx = Math.min(foundIdx, Math.max(0, rawEpoch.length - 2));
        }
      }
    }

    return {
      timestamps: rawTs.slice(startIdx),
      epochTs: rawEpoch.slice(startIdx),
      cpuHist: rawCpu.slice(startIdx),
      cpuTempHist: rawCpuTemp.slice(startIdx),
      ramHist: rawRam.slice(startIdx),
      gpuHist: rawGpu.slice(startIdx),
      netWanRxHist: rawWanRx.slice(startIdx),
      netWanTxHist: rawWanTx.slice(startIdx),
      netLanRxHist: rawLanRx.slice(startIdx),
      netLanTxHist: rawLanTx.slice(startIdx),
    };
  }, [hist]);

  // Datos históricos específicos del router cuando tiene telemetría WAN/LAN activa
  const routerLiveWindow = useMemo(() => {
    const rawRouter = wifiSummary?.router_history_20m ?? metrics?.net?.router_history_20m ?? [];
    if (!routerWanAvailable || rawRouter.length < 2) return null;
    const latestEpoch = Math.round(rawRouter[rawRouter.length - 1].t / 1000);
    const cutoff = latestEpoch - OVERVIEW_WINDOW_SECONDS;
    let startIdx = rawRouter.findIndex((b) => Math.round(b.t / 1000) >= cutoff);
    if (startIdx < 0) startIdx = Math.max(0, rawRouter.length - 60);
    else startIdx = Math.min(startIdx, Math.max(0, rawRouter.length - 2));
    const sliced = rawRouter.slice(startIdx);
    const loc = locale === 'es' ? 'es-ES' : locale;
    return {
      timestamps: sliced.map((b) => new Date(b.t).toLocaleTimeString(loc)),
      epochTs: sliced.map((b) => Math.round(b.t / 1000)),
      wanRx: sliced.map((b) => Math.round(((b.wan_rx ?? b.rx) / (1024 * 1024)) * 100) / 100),
      wanTx: sliced.map((b) => Math.round(((b.wan_tx ?? b.tx) / (1024 * 1024)) * 100) / 100),
      lanRx: sliced.map((b) => Math.round(((b.lan_rx ?? 0) / (1024 * 1024)) * 100) / 100),
      lanTx: sliced.map((b) => Math.round(((b.lan_tx ?? 0) / (1024 * 1024)) * 100) / 100),
    };
  }, [wifiSummary?.router_history_20m, metrics?.net?.router_history_20m, routerWanAvailable, locale]);

  const isDarkTheme = theme === 'dark';
  const cpuChartColor = isDarkTheme ? '#c6f19d' : '#1e6b38';
  const cpuTempChartColor = isDarkTheme ? '#fb923c' : '#ea580c';
  const ramChartColor = isDarkTheme ? '#5eead4' : '#0e7490';
  const gpuChartColor = isDarkTheme ? '#a5b4fc' : '#4f46e5';
  const wanRxChartColor = isDarkTheme ? '#c6f19d' : '#1e6b38';
  const wanTxChartColor = isDarkTheme ? '#5eead4' : '#0e7490';
  const lanRxChartColor = isDarkTheme ? '#93c5fd' : '#4f46e5';
  const lanTxChartColor = isDarkTheme ? '#fbbf24' : '#b45309';

  const hasCpuTemp = useMemo(
    () => (cpuTemp !== null && Number.isFinite(cpuTemp)) || cpuTempHist.some((v) => Number.isFinite(v) && v > 0),
    [cpuTemp, cpuTempHist]
  );

  const cpuSeries: ChartSeries[] = useMemo(() => {
    const list: ChartSeries[] = [
      { id: 'cpu', metricKey: 'cpu', label: t('hardware.cpu.title'), data: cpuHist, color: cpuChartColor, unit: '%', axis: 'left' },
    ];
    if (hasCpuTemp) {
      const tempData =
        cpuTempHist.length >= 2
          ? cpuTempHist
          : cpuTemp !== null
            ? cpuHist.map(() => cpuTemp)
            : [];
      list.push({
        id: 'cpu_temp',
        metricKey: 'cpu_temp',
        label: t('hardware.cpu.series_temp'),
        data: tempData,
        color: cpuTempChartColor,
        unit: '°C',
        decimals: 1,
        axis: 'right',
        dashed: true,
        fillAlpha: 0,
      });
    }
    return list;
  }, [cpuHist, cpuTempHist, cpuTemp, hasCpuTemp, cpuChartColor, cpuTempChartColor, t]);
  const ramSeries: ChartSeries[] = useMemo(
    () => [{ id: 'ram', metricKey: 'ram', label: t('hardware.ram.title'), data: ramHist, color: ramChartColor, unit: '%' }],
    [ramHist, ramChartColor, t]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', metricKey: 'gpu', label: t('hardware.gpu.title'), data: gpuHist, color: gpuChartColor, unit: '%' }],
    [gpuHist, gpuChartColor, t]
  );
  const wanSeries: ChartSeries[] = useMemo(
    () => [
      {
        id: 'net_wan_rx',
        metricKey: 'net_wan_rx',
        label: t('hardware.net.wan_download'),
        data: routerLiveWindow ? routerLiveWindow.wanRx : netWanRxHist,
        color: wanRxChartColor,
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.16,
      },
      {
        id: 'net_wan_tx',
        metricKey: 'net_wan_tx',
        label: t('hardware.net.wan_upload'),
        data: routerLiveWindow ? routerLiveWindow.wanTx : netWanTxHist,
        color: wanTxChartColor,
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.08,
      },
    ],
    [routerLiveWindow, netWanRxHist, netWanTxHist, wanRxChartColor, wanTxChartColor, t]
  );
  const lanSeries: ChartSeries[] = useMemo(
    () => [
      {
        id: 'net_lan_rx',
        metricKey: 'net_lan_rx',
        label: t('hardware.net.lan_download'),
        data: routerLiveWindow ? routerLiveWindow.lanRx : netLanRxHist,
        color: lanRxChartColor,
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.14,
      },
      {
        id: 'net_lan_tx',
        metricKey: 'net_lan_tx',
        label: t('hardware.net.lan_upload'),
        data: routerLiveWindow ? routerLiveWindow.lanTx : netLanTxHist,
        color: lanTxChartColor,
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.08,
      },
    ],
    [routerLiveWindow, netLanRxHist, netLanTxHist, lanRxChartColor, lanTxChartColor, t]
  );

  const wanTimestamps = routerLiveWindow ? routerLiveWindow.timestamps : timestamps;
  const wanEpochTs = routerLiveWindow ? routerLiveWindow.epochTs : epochTs;
  const lanTimestamps = routerLiveWindow ? routerLiveWindow.timestamps : timestamps;
  const lanEpochTs = routerLiveWindow ? routerLiveWindow.epochTs : epochTs;
  const routerSourceLabel =
    wifiSummary?.router_traffic_source ||
    wifiSummary?.router_model ||
    wifiSummary?.gateway_name ||
    wifiSummary?.gateway_ip ||
    metrics?.net?.local_ip ||
    t('network.router_fallback');

  const cpuTone = getHealthTone(cpuPct);
  const ramTone = getHealthTone(ramPct);
  const gpuTone = getHealthTone(gpuPct);

  const onlineWifi = useMemo(
    () => (metrics?.wifi_clients ?? []).filter((c) => c.online !== false && c.is_online !== false),
    [metrics?.wifi_clients]
  );
  const bannerRxBytes = metrics?.wifi_summary?.router_wan_available
    ? Number(metrics?.wifi_summary?.router_wan_rx_bytes_sec ?? metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0)
    : Number(metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0);
  const bannerTxBytes = metrics?.wifi_summary?.router_wan_available
    ? Number(metrics?.wifi_summary?.router_wan_tx_bytes_sec ?? metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0)
    : Number(metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0);
  const controllableClients = useMemo(
    () => (metrics?.wifi_clients ?? []).filter((c) => !c.is_server && !c.is_gateway).slice(0, 6),
    [metrics?.wifi_clients]
  );

  const totalErrors = Number(metrics?.system_errors_summary?.total_errors ?? metrics?.system_errors_summary?.total ?? 0);
  const overallBusy = cpuPct >= 88 || ramPct >= 90 || storageSummary.percent >= 92;

  const activeFaultInsights = useMemo(() => {
    if (localFaultHistory.length > 0) return localFaultHistory;
    if (Array.isArray(metrics?.system_errors_summary?.ai_fault_history) && metrics.system_errors_summary.ai_fault_history.length > 0) {
      return metrics.system_errors_summary.ai_fault_history;
    }
    if (metrics?.system_errors_summary?.ai_fault_insights) {
      return Object.values(metrics.system_errors_summary.ai_fault_insights);
    }
    return [];
  }, [localFaultHistory, metrics?.system_errors_summary?.ai_fault_history, metrics?.system_errors_summary?.ai_fault_insights]);

  return (
    <div className="space-y-[clamp(1rem,2.2dvh,1.75rem)]">
      {/* CAPA 1 — Alethia Obsidian Command Deck: Impacto ejecutivo + ruta directa al dato */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={COCKPIT_SPRING}
        className="cockpit-hero p-[clamp(1rem,2.1vw,1.75rem)]"
      >
        <div className="relative z-10 flex flex-col justify-between gap-[clamp(0.85rem,1.8vw,1.5rem)] lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <AlethiaSectionTag pulse tone={overallBusy ? 'danger' : totalErrors > 0 ? 'amber' : 'lime'}>
                {totalErrors > 0 || overallBusy ? t('overview.hero_alert_tag') : t('overview.hero_verified_tag')}
              </AlethiaSectionTag>
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[#1e6b38] dark:text-[#c6f19d]/90">
                {metrics?.system?.hostname || t('overview.default_host')}
              </span>
              <span className="hidden sm:inline text-slate-400 dark:text-[#6e8270]" aria-hidden="true">·</span>
              <span className="text-xs font-medium text-slate-600 dark:text-[#b2c0b3]">
                {t('overview.subtitle')}
              </span>
            </div>

            <h1 className="mt-3 font-display text-[clamp(1.3rem,2.3vw+0.6rem,2.15rem)] font-semibold leading-[1.12] tracking-tight text-[#0f1f10] dark:text-[#f5f4f2]">
              {overallBusy ? t('overview.high_load_banner') : t('overview.all_normal_banner')}
            </h1>

            <div className="mt-3.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="alethia-hero-chip inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1 font-mono text-[11px] tabular-nums">
                {t('overview.uptime_badge', { uptime: metrics?.system?.uptime_str || '--' })}
              </span>
              <motion.button
                type="button"
                data-testid="banner-devices-btn"
                title={t('overview.devices_inspect_hint')}
                onClick={() => setDevicesModalMode('devices')}
                className="alethia-hero-chip inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1 font-mono text-[11px] font-semibold tabular-nums cursor-pointer"
              >
                <Wifi className="h-3.5 w-3.5 text-[#1e6b38] dark:text-[#c6f19d] shrink-0" />
                <span>{t('overview.connected_devices_count', { count: onlineWifi.length })}</span>
                <ChevronRight className="h-3 w-3 text-[#1e6b38]/75 dark:text-[#c6f19d]/75 shrink-0" />
              </motion.button>
              <motion.button
                type="button"
                data-testid="banner-speed-btn"
                title={t('overview.internet_rate_inspect_hint')}
                onClick={() => setDevicesModalMode('bandwidth')}
                className="alethia-hero-chip inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1 font-mono text-[11px] font-semibold tabular-nums cursor-pointer"
              >
                <span>
                  {t('overview.internet_rate_badge', {
                    rx: formatSpeed(bannerRxBytes),
                    tx: formatSpeed(bannerTxBytes),
                  })}
                </span>
                {metrics?.wifi_summary?.router_wan_available && (
                  <span className="hidden sm:inline-block rounded bg-[#e5f8d3] px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#144d23] dark:bg-[#c6f19d]/20 dark:text-[#c6f19d]">
                    {t('overview.router_global_badge')}
                  </span>
                )}
                <ChevronRight className="h-3 w-3 text-[#1e6b38]/75 dark:text-[#c6f19d]/75 shrink-0" />
              </motion.button>
            </div>
          </div>

          {/* Executive Zeus Vision Radial Pulse Strip + Signature Alethia CTA */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 shrink-0">
            <div className="inline-flex items-center gap-3.5 rounded-2xl border border-slate-200/90 bg-[#f5f4f2]/90 px-3.5 py-2.5 backdrop-blur-sm dark:border-[#c6f19d]/16 dark:bg-[#162818]/80">
              <RadialKpiGauge
                value={cpuPct}
                size={46}
                strokeWidth={4.5}
                theme={theme}
                label={t('overview.exec_cpu')}
              />
              <RadialKpiGauge
                value={ramPct}
                size={46}
                strokeWidth={4.5}
                theme={theme}
                label={t('overview.exec_ram')}
              />
              <RadialKpiGauge
                value={storageSummary.localPercent}
                size={46}
                strokeWidth={4.5}
                theme={theme}
                label={t('overview.exec_storage')}
              />
            </div>

            {totalErrors > 0 ? (
              <motion.button
                type="button"
                onClick={() => setShowErrorsDetail((v) => !v)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-400/60 bg-amber-100/90 px-4 py-2 font-mono text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-200/80 dark:border-amber-400/45 dark:bg-amber-500/18 dark:text-amber-200 dark:hover:bg-amber-500/28 cursor-pointer"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                <span>
                  {totalErrors} {totalErrors === 1 ? t('time.recent_notice') : t('time.recent_notices')}
                </span>
                {showErrorsDetail ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </motion.button>
            ) : (
              <AlethiaActionButton
                label={t('overview.see_equipment_detail')}
                variant={isDarkTheme ? 'dark' : 'surface'}
                onClick={() => onNavigate('equipo')}
              />
            )}
          </div>
        </div>

        <AccordionBody open={showErrorsDetail}>
          <div className="mt-4 border-t border-slate-200/80 pt-4 text-xs text-slate-700 dark:border-[#c6f19d]/15 dark:text-[#d6ded6] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('overview.errors_banner', { count: totalErrors })}</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="overview-ai-simplify-faults-btn"
                  disabled={simplifyingOverviewFaults}
                  onClick={() => void handleOverviewSimplifyFaults()}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#9bd86b] bg-[#e5f8d3] px-3 py-1 font-mono text-[11px] font-semibold text-[#144d23] transition-colors hover:bg-[#d7f3be] disabled:opacity-50 dark:border-[#c6f19d]/35 dark:bg-[#c6f19d]/14 dark:text-[#c6f19d] dark:hover:bg-[#c6f19d]/22 cursor-pointer"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${simplifyingOverviewFaults ? 'animate-spin' : ''}`} />
                  <span>
                    {simplifyingOverviewFaults ? t('more.ai_fault_simplifying') : t('more.ai_fault_simplify_btn')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('mas', 'logs')}
                  className="font-mono text-[11px] font-semibold text-[#1e6b38] hover:underline dark:text-[#c6f19d] cursor-pointer"
                >
                  {t('overview.open_full_log')}
                </button>
              </div>
            </div>
            {activeFaultInsights.length > 0 && (
              <div className="cockpit-auto-grid-cards">
                {activeFaultInsights.slice(0, 4).map((item) => {
                  const norm = String(item.danger_level || 'medium').toLowerCase();
                  const pillCls =
                    norm === 'critical'
                      ? 'cockpit-pill-rose'
                      : norm === 'high'
                        ? 'cockpit-pill-amber'
                        : norm === 'low'
                          ? 'cockpit-pill-emerald'
                          : 'cockpit-pill-cyan';
                  const dangerLabel =
                    norm === 'critical'
                      ? t('more.ai_fault_danger_critical')
                      : norm === 'high'
                        ? t('more.ai_fault_danger_high')
                        : norm === 'low'
                          ? t('more.ai_fault_danger_low')
                          : t('more.ai_fault_danger_medium');
                  return (
                    <div
                      key={item.signature}
                      className="rounded-xl border border-slate-200/80 bg-[#f5f4f2]/95 p-3 space-y-1.5 text-xs dark:border-[#c6f19d]/18 dark:bg-[#162818]/90"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-semibold text-slate-900 dark:text-[#f5f4f2]">{item.title}</span>
                        <span className={`${pillCls} rounded-full px-2 py-0.5 text-[10px] font-bold uppercase`}>
                          {dangerLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-[#c5d1c6]">{item.summary}</p>
                      {item.solution && (
                        <div className="rounded-lg border border-[#9bd86b]/70 bg-[#eaf7de] px-2.5 py-1.5 text-[10.5px] text-[#144d23] dark:border-[#c6f19d]/28 dark:bg-[#c6f19d]/10 dark:text-[#e6f5d8]">
                          <span className="font-semibold">{t('more.ai_fault_solution_label')}: </span>
                          <span>{item.solution}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </AccordionBody>
      </motion.section>

      {/* CAPA 2 — Telemetría en vivo con anillos KPI Zeus + tendencia y picos anotados */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <AlethiaSectionTag>{t('overview.layer_live_tag')}</AlethiaSectionTag>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t('overview.layer_live_sub')}
            </p>
          </div>
        </div>

        <section aria-label={t('overview.perf_grid_aria')} className="cockpit-auto-grid">
        {/* 1. Procesador (CPU) */}
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...COCKPIT_SPRING, delay: 0.03 }}
          className="cockpit-bento flex flex-col justify-between p-3.5 sm:p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-cyan inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                    <Cpu className="h-3 w-3" />
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{t('hardware.cpu.title')}</span>
                  <span className={`shrink-0 text-[10.5px] font-medium ${cpuTone.textClass}`}>{cpuTone.label}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <AnimatedMetricValue
                    value={cpuPct}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-cyan rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                    {formatTemp(cpuTemp)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {t('hardware.cpu.cores_summary', {
                    model: metrics?.cpu?.model || t('hardware.cpu.main_fallback'),
                    cores: metrics?.cpu?.logical_cores || 0,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <RadialKpiGauge value={cpuPct} size={44} strokeWidth={4.5} theme={theme} />
                <motion.button
                  type="button"
                  aria-label={t('hardware.cpu.expand_aria')}
                  onClick={() =>
                    onExpandChart({
                      title: t('hardware.cpu.chart_live_title'),
                      subtitle: metrics?.cpu?.model || t('hardware.cpu.main_fallback'),
                      series: cpuSeries,
                      timestamps,
                      epochTs,
                      leftUnit: '%',
                      maxLeft: 100,
                      maxRight: hasCpuTemp ? 100 : undefined,
                      chartKind: 'cpu',
                    })
                  }
                  className="cockpit-subtile flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </motion.button>
              </div>
            </div>

            {/* Sleek spring horizontal progress bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, Math.min(100, cpuPct))}%` }}
                transition={{ type: 'spring', stiffness: 210, damping: 14, mass: 0.7 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#1e6b38] dark:bg-[#c6f19d]"
              />
            </div>
          </div>

          <div className="mt-2.5">
            <TelemetryChart
              series={cpuSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              heightClassName="cockpit-chart-compact"
              maxLeft={100}
              maxRight={hasCpuTemp ? 100 : undefined}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: t('hardware.cpu.chart_live_title'),
                  subtitle: metrics?.cpu?.model || t('hardware.cpu.main_fallback'),
                  series: cpuSeries,
                  timestamps,
                  epochTs,
                  leftUnit: '%',
                  maxLeft: 100,
                  maxRight: hasCpuTemp ? 100 : undefined,
                  chartKind: 'cpu',
                })
              }
            />
            <ChartNarrativeFooter data={cpuHist} unit="%" decimals={1} />
          </div>
        </motion.article>

        {/* 2. Memoria RAM */}
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...COCKPIT_SPRING, delay: 0.06 }}
          className="cockpit-bento flex flex-col justify-between p-3.5 sm:p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-emerald inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                    <MemoryStick className="h-3 w-3" />
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{t('hardware.ram.title')}</span>
                  <span className={`shrink-0 text-[10.5px] font-medium ${ramTone.textClass}`}>{ramTone.label}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <AnimatedMetricValue
                    value={ramPct}
                    decimals={1}
                    suffix=" %"
                    className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-emerald rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                    {formatBytes(ramUsed)} / {formatBytes(ramTotal)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {t('overview.ram_free_ready', { avail: formatBytes(metrics?.ram?.available_bytes) })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <RadialKpiGauge
                  value={ramPct}
                  size={44}
                  strokeWidth={4.5}
                  theme={theme}
                  color={ramPct >= 70 ? undefined : ramChartColor}
                />
                <motion.button
                  type="button"
                  aria-label={t('hardware.ram.expand_aria')}
                  onClick={() =>
                    onExpandChart({
                      title: t('hardware.ram.chart_live_title'),
                      subtitle: t('hardware.ram.used_of_total', {
                        used: formatBytes(ramUsed),
                        total: formatBytes(ramTotal),
                      }),
                      series: ramSeries,
                      timestamps,
                      epochTs,
                      leftUnit: '%',
                      maxLeft: 100,
                      chartKind: 'ram',
                    })
                  }
                  className="cockpit-subtile flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </motion.button>
              </div>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, Math.min(100, ramPct))}%` }}
                transition={{ type: 'spring', stiffness: 210, damping: 14, mass: 0.7 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#0e7490] dark:bg-[#5eead4]"
              />
            </div>
          </div>

          <div className="mt-2.5">
            <TelemetryChart
              series={ramSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              heightClassName="cockpit-chart-compact"
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: t('hardware.ram.chart_live_title'),
                  subtitle: t('hardware.ram.used_of_total', {
                    used: formatBytes(ramUsed),
                    total: formatBytes(ramTotal),
                  }),
                  series: ramSeries,
                  timestamps,
                  epochTs,
                  leftUnit: '%',
                  maxLeft: 100,
                  chartKind: 'ram',
                })
              }
            />
            <ChartNarrativeFooter data={ramHist} unit="%" decimals={1} />
          </div>
        </motion.article>

        {/* 3. Tarjeta gráfica (GPU) */}
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...COCKPIT_SPRING, delay: 0.09 }}
          className="cockpit-bento flex flex-col justify-between p-3.5 sm:p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-violet inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                    <Monitor className="h-3 w-3" />
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{t('hardware.gpu.title')}</span>
                  <span className={`shrink-0 text-[10.5px] font-medium ${gpuAvail ? gpuTone.textClass : 'text-slate-500 dark:text-slate-400'}`}>
                    {gpuAvail ? gpuTone.label : t('hardware.gpu.idle')}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <AnimatedMetricValue
                    value={gpuAvail ? gpuPct : 0}
                    decimals={gpuAvail ? 1 : 0}
                    suffix=" %"
                    className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
                  />
                  <span className="cockpit-pill-violet rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                    {gpuAvail ? formatTemp(gpuTemp) : t('hardware.gpu.integrated_label')}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {gpuAvail
                    ? `${metrics?.gpu?.name || t('hardware.gpu.short_title')}${
                        gpuVramTotal > 0
                          ? t('hardware.gpu.vram_suffix', { used: gpuVramUsed, total: gpuVramTotal })
                          : ''
                      }`
                    : t('hardware.gpu.integrated_no_media')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <RadialKpiGauge
                  value={gpuAvail ? gpuPct : 0}
                  size={44}
                  strokeWidth={4.5}
                  theme={theme}
                  color={gpuAvail && gpuPct >= 70 ? undefined : gpuChartColor}
                />
                <motion.button
                  type="button"
                  aria-label={t('hardware.gpu.expand_aria')}
                  onClick={() =>
                    onExpandChart({
                      title: t('hardware.gpu.chart_live_title'),
                      subtitle: metrics?.gpu?.name || t('hardware.gpu.system_fallback'),
                      series: gpuSeries,
                      timestamps,
                      epochTs,
                      leftUnit: '%',
                      maxLeft: 100,
                      chartKind: 'gpu',
                    })
                  }
                  className="cockpit-subtile flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </motion.button>
              </div>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(gpuAvail ? 2 : 0, Math.min(100, gpuPct))}%` }}
                transition={{ type: 'spring', stiffness: 210, damping: 14, mass: 0.7 }}
                className="cockpit-progress-fill h-full rounded-full bg-[#4f46e5] dark:bg-[#a5b4fc]"
              />
            </div>
          </div>

          <div className="mt-2.5">
            <TelemetryChart
              series={gpuSeries}
              timestamps={timestamps}
              epochTs={epochTs}
              heightClassName="cockpit-chart-compact"
              maxLeft={100}
              leftUnit="%"
              theme={theme}
              onExpandClick={() =>
                onExpandChart({
                  title: t('hardware.gpu.chart_live_title'),
                  subtitle: metrics?.gpu?.name || t('hardware.gpu.system_fallback'),
                  series: gpuSeries,
                  timestamps,
                  epochTs,
                  leftUnit: '%',
                  maxLeft: 100,
                  chartKind: 'gpu',
                })
              }
            />
            <ChartNarrativeFooter data={gpuHist} unit="%" decimals={1} />
          </div>
        </motion.article>

        {/* 4. Router al Exterior (Datos WAN globales del router / salida Internet) */}
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...COCKPIT_SPRING, delay: 0.12 }}
          data-testid="overview-router-wan-card"
          className="cockpit-bento flex flex-col justify-between p-3.5 sm:p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-cyan inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                    <Router className="h-3 w-3" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {t('hardware.net.router_wan_title')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0 text-[11px] text-sky-600 dark:text-sky-400">
                    {routerWanAvailable ? t('overview.router_global_badge') : t('hardware.net.router_wan_badge')}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                    ↓ {formatSpeed(wanRxBytes)}
                  </span>
                  <span className="cockpit-pill-emerald rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                    ↑ {formatSpeed(wanTxBytes)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums truncate" title={routerSourceLabel}>
                    {routerSourceLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: wanRxChartColor }} /> {t('hardware.net.wan_download')}
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: wanTxChartColor }} /> {t('hardware.net.wan_upload')}
                    </span>
                  </span>
                </div>
              </div>
              <motion.button
                type="button"
                aria-label={t('hardware.net.router_wan_expand_aria')}
                onClick={() =>
                  onExpandChart({
                    title: t('hardware.net.wan_chart_live_title'),
                    subtitle: `${routerSourceLabel} · ↓ ${formatSpeed(wanRxBytes)} · ↑ ${formatSpeed(wanTxBytes)}`,
                    series: wanSeries,
                    timestamps: wanTimestamps,
                    epochTs: wanEpochTs,
                    leftUnit: 'MB/s',
                    chartKind: routerLiveWindow ? 'router' : 'net',
                  })
                }
                className="cockpit-subtile flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </motion.button>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.max(4, Math.min(100, ((wanRxBytes + wanTxBytes) / (1024 * 1024)) * 2.5))}%`,
                }}
                transition={{ type: 'spring', stiffness: 210, damping: 14, mass: 0.7 }}
                className="cockpit-progress-fill h-full rounded-full bg-gradient-to-r from-[#1e6b38] to-[#0e7490] dark:from-[#c6f19d] dark:to-[#5eead4]"
              />
            </div>
          </div>

          <div className="mt-2.5">
            <TelemetryChart
              series={wanSeries}
              timestamps={wanTimestamps}
              epochTs={wanEpochTs}
              heightClassName="cockpit-chart-compact"
              leftUnit="MB/s"
              theme={theme}
              emptyMessage={t('hardware.net.recording_traffic')}
              onExpandClick={() =>
                onExpandChart({
                  title: t('hardware.net.wan_chart_live_title'),
                  subtitle: `${routerSourceLabel} · ↓ ${formatSpeed(wanRxBytes)} · ↑ ${formatSpeed(wanTxBytes)}`,
                  series: wanSeries,
                  timestamps: wanTimestamps,
                  epochTs: wanEpochTs,
                  leftUnit: 'MB/s',
                  chartKind: routerLiveWindow ? 'router' : 'net',
                })
              }
            />
            <ChartNarrativeFooter data={wanSeries[0]?.data ?? []} unit="MB/s" decimals={2} />
          </div>
        </motion.article>

        {/* 5. Comunicación Local (Velocidad interna de red LAN sin tráfico externo) */}
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...COCKPIT_SPRING, delay: 0.15 }}
          data-testid="overview-local-lan-card"
          className="cockpit-bento flex flex-col justify-between p-3.5 sm:p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className="cockpit-pill-violet inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                    <ArrowDownUp className="h-3 w-3" />
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {t('hardware.net.local_lan_title')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0 text-[11px] text-indigo-600 dark:text-indigo-400">
                    {activeInterfaces.length > 0
                      ? activeInterfaces.length === 1
                        ? t('hardware.net.active_link_single', { count: activeInterfaces.length })
                        : t('hardware.net.active_link_plural', { count: activeInterfaces.length })
                      : t('hardware.net.local_lan_badge')}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-white">
                    ↓ {formatSpeed(lanRxBytes)}
                  </span>
                  <span className="cockpit-pill-amber rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
                    ↑ {formatSpeed(lanTxBytes)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums truncate">
                    {metrics?.net?.local_ip || activeInterfaces[0]?.ip || t('hardware.net.lan_tag')}
                    {activeInterfaces[0]?.name ? ` (${activeInterfaces.map((n) => n.name).slice(0, 2).join(', ')})` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lanRxChartColor }} /> {t('hardware.net.lan_download')}
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lanTxChartColor }} /> {t('hardware.net.lan_upload')}
                    </span>
                  </span>
                </div>
              </div>
              <motion.button
                type="button"
                aria-label={t('hardware.net.local_lan_expand_aria')}
                onClick={() =>
                  onExpandChart({
                    title: t('hardware.net.lan_chart_live_title'),
                    subtitle: `${metrics?.net?.local_ip || t('hardware.net.lan_tag')} · ↓ ${formatSpeed(lanRxBytes)} · ↑ ${formatSpeed(lanTxBytes)}`,
                    series: lanSeries,
                    timestamps: lanTimestamps,
                    epochTs: lanEpochTs,
                    leftUnit: 'MB/s',
                    chartKind: routerLiveWindow ? 'router' : 'net',
                  })
                }
                className="cockpit-subtile flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:border-[#1e6b38]/40 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:border-[#c6f19d]/40 dark:hover:text-[#c6f19d] cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </motion.button>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.max(4, Math.min(100, ((lanRxBytes + lanTxBytes) / (1024 * 1024)) * 2.5))}%`,
                }}
                transition={{ type: 'spring', stiffness: 210, damping: 14, mass: 0.7 }}
                className="cockpit-progress-fill h-full rounded-full bg-gradient-to-r from-[#4f46e5] to-[#b45309] dark:from-[#93c5fd] dark:to-[#fbbf24]"
              />
            </div>
          </div>

          <div className="mt-2.5">
            <TelemetryChart
              series={lanSeries}
              timestamps={lanTimestamps}
              epochTs={lanEpochTs}
              heightClassName="cockpit-chart-compact"
              leftUnit="MB/s"
              theme={theme}
              emptyMessage={t('hardware.net.recording_traffic')}
              onExpandClick={() =>
                onExpandChart({
                  title: t('hardware.net.lan_chart_live_title'),
                  subtitle: `${metrics?.net?.local_ip || t('hardware.net.lan_tag')} · ↓ ${formatSpeed(lanRxBytes)} · ↑ ${formatSpeed(lanTxBytes)}`,
                  series: lanSeries,
                  timestamps: lanTimestamps,
                  epochTs: lanEpochTs,
                  leftUnit: 'MB/s',
                  chartKind: routerLiveWindow ? 'router' : 'net',
                })
              }
            />
            <ChartNarrativeFooter data={lanSeries[0]?.data ?? []} unit="MB/s" decimals={2} />
          </div>
        </motion.article>

        {/* 5+. Widgets independientes y completos de almacenamiento (Locales, USB/SD Extraíbles y NAS único) */}
        <AnimatePresence mode="popLayout">
          {independentDisks.map((d) => {
            const widgetKey = d.pool_key || d.mountpoint || d.device || 'disk';
            return (
              <OverviewDiskCard
                key={widgetKey}
                disk={d}
                timestamps={timestamps}
                epochTs={epochTs}
                theme={theme}
                locale={locale}
                onExpandChart={onExpandChart}
              />
            );
          })}
        </AnimatePresence>
      </section>
      </div>

      {/* CAPA 3 — Control Rápido: Aparatos en casa con botones simétricos Encender / Apagar */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...COCKPIT_SPRING, delay: 0.16 }}
        className="cockpit-bento p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-800">
          <div className="space-y-1">
            <AlethiaSectionTag>{t('overview.layer_devices_tag')}</AlethiaSectionTag>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {t('overview.home_devices_title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('overview.home_devices_sub')}
            </p>
          </div>
          <AlethiaActionButton
            label={`${t('overview.view_all')} (${metrics?.wifi_clients?.length ?? 0})`}
            variant="surface"
            onClick={() => onNavigate('red')}
          />
        </div>

        {controllableClients.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('overview.home_devices_empty')}
          </div>
        ) : (
          <div className="mt-4 cockpit-auto-grid-cards">
            {controllableClients.map((client, idx) => {
              const isOnline = client.online !== false && client.is_online !== false;
              const mac = client.mac || `idx-${idx}`;
              const pending = actionPendingMac === mac;
              const label = client.name || client.hostname || client.ip || t('overview.device_fallback');

              return (
                <motion.div
                  key={`${mac}-${client.ip || idx}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...COCKPIT_SPRING, delay: Math.min(0.03 * idx, 0.24) }}
                  className="cockpit-subtile flex flex-col justify-between gap-3 p-3.5"
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
                        {isOnline ? t('overview.online_now') : t('overview.offline_wait')}
                        {client.ip ? ` · ${client.ip}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <motion.button
                      type="button"
                      disabled={pending || !client.mac}
                      onClick={() => onPowerAction('wake', client)}
                      title={t('overview.wake_title')}
                      className="cockpit-btn-wol inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap"
                    >
                      <Power className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('overview.wake_btn')}</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      disabled={pending || (!client.ip && !client.mac)}
                      onClick={() => onPowerAction('shutdown', client)}
                      title={t('overview.sleep_title')}
                      className="cockpit-btn-off inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap"
                    >
                      <PowerOff className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('overview.sleep_btn')}</span>
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.section>

      <AnimatePresence>
        {devicesModalMode && (
          <NetworkDevicesModal
            initialTab={devicesModalMode}
            metrics={metrics}
            onPowerAction={onPowerAction}
            actionPendingMac={actionPendingMac}
            onClose={() => setDevicesModalMode(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
