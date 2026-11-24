import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  Maximize2,
  MemoryStick,
  Monitor,
} from 'lucide-react';
import { AccordionBody, AnimatedMetricValue, MorphPill, ViewStage } from './MotionPrimitives';
import { ExpandChartSpec } from './OverviewView';
import { ResourceProcessesPanel } from './ResourceProcessesPanel';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { MainTabId, MetricsPayload, ThemeMode } from '../types/telemetry';
import { formatBytes, formatMbRate, formatPct, formatTemp } from '../utils/formatters';
import { formatDiskFstype, formatDiskLabel, formatDiskTransport, useI18n } from '../i18n';

type EquipmentSubTab = 'cpu' | 'ram' | 'gpu' | 'storage';

function resolveEquipmentSubTab(hint?: string): EquipmentSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'cpu' || h === 'procesador') return 'cpu';
  if (h === 'ram' || h === 'memoria') return 'ram';
  if (h === 'gpu' || h === 'grafica') return 'gpu';
  if (h === 'storage' || h === 'almacenamiento' || h === 'discos') return 'storage';
  return undefined;
}

interface EquipmentViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  initialSubTab?: string;
  navTick?: number;
  onExpandChart?: (spec: ExpandChartSpec) => void;
  onNavigate?: (tab: MainTabId, subTab?: string) => void;
  onSubTabChange?: (sub: string) => void;
}

export const EquipmentView: React.FC<EquipmentViewProps> = ({
  metrics,
  theme,
  initialSubTab,
  navTick,
  onExpandChart,
  onNavigate,
  onSubTabChange,
}) => {
  const { t, locale } = useI18n();
  const [subTab, setSubTab] = useState<EquipmentSubTab>(() => resolveEquipmentSubTab(initialSubTab) || 'cpu');
  const [showTech, setShowTech] = useState(false);
  const [disabledGpuGraphs, setDisabledGpuGraphs] = useState<Record<string, boolean>>({});
  const [coreTooltip, setCoreTooltip] = useState<FloatingTooltipData | null>(null);

  const handleSelectSubTab = (id: EquipmentSubTab) => {
    setSubTab(id);
    onSubTabChange?.(id);
  };

  useEffect(() => {
    const mapped = resolveEquipmentSubTab(initialSubTab);
    if (mapped) setSubTab(mapped);
  }, [initialSubTab, navTick]);

  const hist = metrics?.history;
  const timestamps = useMemo(() => hist?.timestamps ?? [], [hist?.timestamps]);
  const epochTs = useMemo(() => hist?.epoch_ts ?? [], [hist?.epoch_ts]);

  const isDarkTheme = theme === 'dark';
  const primaryBotanical = isDarkTheme ? '#c6f19d' : '#1e6b38';
  const secondaryTeal = isDarkTheme ? '#5eead4' : '#0e7490';
  const tertiaryIndigo = isDarkTheme ? '#a5b4fc' : '#4f46e5';

  const cpuCores = useMemo(() => metrics?.cpu?.per_core_percent ?? [], [metrics?.cpu?.per_core_percent]);
  const cpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'cpu', metricKey: 'cpu', label: t('equipment.sort_cpu'), data: hist?.cpu ?? [], color: primaryBotanical, unit: '%' }],
    [hist?.cpu, primaryBotanical, t]
  );
  const ramSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'ram', metricKey: 'ram', label: t('hardware.ram.active_series'), data: hist?.ram ?? [], color: secondaryTeal, unit: '%' },
      { id: 'ram_tot', metricKey: 'ram_total', label: t('hardware.ram.total_cached_series'), data: hist?.ram_total ?? [], color: tertiaryIndigo, unit: '%', fillAlpha: 0, dashed: true },
    ],
    [hist?.ram, hist?.ram_total, secondaryTeal, tertiaryIndigo, t]
  );
  const gpuSeries: ChartSeries[] = useMemo(
    () => [{ id: 'gpu', metricKey: 'gpu', label: t('hardware.gpu.series_compute'), data: hist?.gpu ?? [], color: tertiaryIndigo, unit: '%' }],
    [hist?.gpu, tertiaryIndigo, t]
  );

  // Sub-gráficas de GPU dinámicamente activadas/desactivadas según capacidades reales de la tarjeta
  const gpuSubgraphs = useMemo(() => {
    const gpu = metrics?.gpu;
    const avail = Boolean(gpu?.available);
    const caps = gpu?.capabilities ?? {};
    const rawGpuHist = gpu?.history ?? [];

    // Recortar a últimos 5 min para vista en vivo coherente con Inicio
    let sliceStart = 0;
    if (rawGpuHist.length >= 2) {
      const latestMs = Number(rawGpuHist[rawGpuHist.length - 1]?.t || 0);
      if (latestMs > 0) {
        const cutoffMs = latestMs - 300 * 1000;
        const idx = rawGpuHist.findIndex((b) => Number(b.t) >= cutoffMs);
        sliceStart = idx >= 0 ? Math.min(idx, Math.max(0, rawGpuHist.length - 2)) : Math.max(0, rawGpuHist.length - 2);
      }
    }
    const gHist = rawGpuHist.slice(sliceStart);
    const gTimestamps = gHist.length >= 2 ? gHist.map((b) => new Date(b.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale)) : timestamps;
    const gEpochTs = gHist.length >= 2 ? gHist.map((b) => Math.round(b.t / 1000)) : epochTs;

    const pickNumeric = (vals: Array<number | null | undefined>, fallbackHist?: number[]): number[] => {
      if (vals.length >= 2 && vals.some((v) => v !== null && v !== undefined)) {
        return vals.map((v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : 0));
      }
      if (fallbackHist && fallbackHist.length >= 2) return fallbackHist;
      const single = vals.find((v) => v !== null && v !== undefined);
      if (single !== undefined && single !== null) return [Number(single), Number(single)];
      return [];
    };

    const hasCompute = avail && (caps.compute ?? gpu?.gpu_util_percent !== undefined);
    const hasVram = avail && ((caps.vram ?? Number(gpu?.vram_total_mb || 0) > 0) || Boolean(caps.mem_ctrl));
    const hasMemCtrl = avail && (caps.mem_ctrl ?? (gpu?.mem_util_percent !== null && gpu?.mem_util_percent !== undefined));
    const hasEncoder = avail && (caps.encoder ?? (gpu?.encoder_util_percent !== null && gpu?.encoder_util_percent !== undefined));
    const hasDecoder = avail && (caps.decoder ?? (gpu?.decoder_util_percent !== null && gpu?.decoder_util_percent !== undefined));
    const hasVideo = hasEncoder || hasDecoder;
    const hasPower = avail && (caps.power ?? (gpu?.power_watts !== null && gpu?.power_watts !== undefined));
    const hasTemp = avail && (caps.temp ?? (gpu?.temp_c !== null && gpu?.temp_c !== undefined));
    const hasPowerTemp = hasPower || hasTemp;
    const hasClocks = avail && (caps.clocks ?? (gpu?.clock_graphics_mhz !== null && gpu?.clock_graphics_mhz !== undefined));
    const hasPcie = avail && (caps.pcie ?? (gpu?.pcie_rx_kbps !== null && gpu?.pcie_rx_kbps !== undefined));

    const cards: Array<{
      id: 'compute' | 'vram' | 'video' | 'power_temp' | 'clocks' | 'pcie';
      title: string;
      subtitle: string;
      headline: string;
      available: boolean;
      leftUnit: string;
      maxLeft?: number;
      maxRight?: number;
      timestamps: string[];
      epochTs: number[];
      series: ChartSeries[];
      useMainGpuHistory?: boolean;
    }> = [];

    // 1. Uso 3D / Cómputo
    cards.push({
      id: 'compute',
      title: t('hardware.gpu.graph_compute_title'),
      subtitle: t('hardware.gpu.graph_compute_sub'),
      headline: formatPct(gpu?.gpu_util_percent ?? 0),
      available: hasCompute,
      leftUnit: '%',
      maxLeft: 100,
      timestamps: gHist.length >= 2 ? gTimestamps : timestamps,
      epochTs: gHist.length >= 2 ? gEpochTs : epochTs,
      useMainGpuHistory: true,
      series: [
        {
          id: 'gpu_compute',
          metricKey: 'gpu',
          label: t('hardware.gpu.series_compute'),
          data: pickNumeric(
            gHist.map((b) => b.util),
            hist?.gpu ?? [Number(gpu?.gpu_util_percent ?? 0), Number(gpu?.gpu_util_percent ?? 0)]
          ),
          color: '#7c3aed',
          unit: '%',
          decimals: 1,
        },
      ],
    });

    // 2. Memoria VRAM y Controlador
    const vramSeriesList: ChartSeries[] = [];
    if (caps.vram ?? Number(gpu?.vram_total_mb || 0) > 0) {
      vramSeriesList.push({
        id: 'gpu_vram_pct',
        label: t('hardware.gpu.series_vram_pct'),
        data: pickNumeric(gHist.map((b) => b.vram_pct), [Number(gpu?.vram_percent ?? 0), Number(gpu?.vram_percent ?? 0)]),
        color: '#1e6b38',
        unit: '%',
        decimals: 1,
      });
    }
    if (hasMemCtrl) {
      vramSeriesList.push({
        id: 'gpu_mem_ctrl',
        label: t('hardware.gpu.series_mem_ctrl'),
        data: pickNumeric(gHist.map((b) => b.mem_util), [Number(gpu?.mem_util_percent ?? 0), Number(gpu?.mem_util_percent ?? 0)]),
        color: '#06b6d4',
        unit: '%',
        decimals: 1,
        fillAlpha: 0,
        dashed: true,
      });
    }
    cards.push({
      id: 'vram',
      title: t('hardware.gpu.graph_vram_title'),
      subtitle: hasMemCtrl
        ? t('hardware.gpu.graph_vram_sub', {
            used: gpu?.vram_used_mb ?? 0,
            total: gpu?.vram_total_mb ?? 0,
            ctrl: gpu?.mem_util_percent ?? 0,
          })
        : t('hardware.gpu.graph_vram_only_sub', {
            used: gpu?.vram_used_mb ?? 0,
            total: gpu?.vram_total_mb ?? 0,
          }),
      headline: formatPct(gpu?.vram_percent ?? 0),
      available: hasVram && vramSeriesList.length > 0,
      leftUnit: '%',
      maxLeft: 100,
      timestamps: gTimestamps,
      epochTs: gEpochTs,
      series: vramSeriesList,
    });

    // 3. Codificador y Decodificador de Vídeo
    const videoSeriesList: ChartSeries[] = [];
    if (hasEncoder) {
      videoSeriesList.push({
        id: 'gpu_enc',
        label: t('hardware.gpu.series_encoder'),
        data: pickNumeric(gHist.map((b) => b.enc), [Number(gpu?.encoder_util_percent ?? 0), Number(gpu?.encoder_util_percent ?? 0)]),
        color: '#10b981',
        unit: '%',
        decimals: 1,
      });
    }
    if (hasDecoder) {
      videoSeriesList.push({
        id: 'gpu_dec',
        label: t('hardware.gpu.series_decoder'),
        data: pickNumeric(gHist.map((b) => b.dec), [Number(gpu?.decoder_util_percent ?? 0), Number(gpu?.decoder_util_percent ?? 0)]),
        color: '#f59e0b',
        unit: '%',
        decimals: 1,
      });
    }
    cards.push({
      id: 'video',
      title: t('hardware.gpu.graph_video_title'),
      subtitle: t('hardware.gpu.graph_video_sub', {
        enc: hasEncoder ? (gpu?.encoder_util_percent ?? '--') : '--',
        dec: hasDecoder ? (gpu?.decoder_util_percent ?? '--') : '--',
      }),
      headline:
        hasEncoder && hasDecoder
          ? `${formatPct(gpu?.encoder_util_percent ?? 0)} / ${formatPct(gpu?.decoder_util_percent ?? 0)}`
          : hasEncoder
          ? formatPct(gpu?.encoder_util_percent ?? 0)
          : formatPct(gpu?.decoder_util_percent ?? 0),
      available: hasVideo && videoSeriesList.length > 0,
      leftUnit: '%',
      maxLeft: 100,
      timestamps: gTimestamps,
      epochTs: gEpochTs,
      series: videoSeriesList,
    });

    // 4. Consumo Eléctrico y Temperatura
    const powerTempSeries: ChartSeries[] = [];
    if (hasPower) {
      powerTempSeries.push({
        id: 'gpu_power',
        label: t('hardware.gpu.series_power'),
        data: pickNumeric(gHist.map((b) => b.power), [Number(gpu?.power_watts ?? 0), Number(gpu?.power_watts ?? 0)]),
        color: '#ea580c',
        unit: 'W',
        decimals: 1,
        axis: 'left',
      });
    }
    if (hasTemp) {
      powerTempSeries.push({
        id: 'gpu_temp',
        label: t('hardware.gpu.series_temp'),
        data: pickNumeric(gHist.map((b) => b.temp), [Number(gpu?.temp_c ?? 0), Number(gpu?.temp_c ?? 0)]),
        color: '#ef4444',
        unit: '°C',
        decimals: 0,
        axis: hasPower ? 'right' : 'left',
        dashed: hasPower,
        fillAlpha: hasPower ? 0 : 0.14,
      });
    }
    cards.push({
      id: 'power_temp',
      title: t('hardware.gpu.graph_power_temp_title'),
      subtitle: t('hardware.gpu.graph_power_temp_sub', {
        power: gpu?.power_watts !== null && gpu?.power_watts !== undefined ? `${gpu.power_watts} W` : '--',
        limit: gpu?.power_limit_watts ? `${gpu.power_limit_watts} W` : '--',
        temp: formatTemp(gpu?.temp_c),
      }),
      headline:
        gpu?.power_watts !== null && gpu?.power_watts !== undefined
          ? `${gpu.power_watts} W`
          : formatTemp(gpu?.temp_c),
      available: hasPowerTemp && powerTempSeries.length > 0,
      leftUnit: hasPower ? 'W' : '°C',
      maxRight: hasPower && hasTemp ? 105 : undefined,
      timestamps: gTimestamps,
      epochTs: gEpochTs,
      series: powerTempSeries,
    });

    // 5. Relojes de Frecuencia (Núcleo / Memoria)
    const clockSeries: ChartSeries[] = [];
    if (gpu?.clock_graphics_mhz !== null && gpu?.clock_graphics_mhz !== undefined) {
      clockSeries.push({
        id: 'gpu_clk_gfx',
        label: t('hardware.gpu.series_clock_gfx'),
        data: pickNumeric(gHist.map((b) => b.clock_gfx), [Number(gpu.clock_graphics_mhz), Number(gpu.clock_graphics_mhz)]),
        color: '#1e6b38',
        unit: 'MHz',
        decimals: 0,
      });
    }
    if (gpu?.clock_mem_mhz !== null && gpu?.clock_mem_mhz !== undefined) {
      clockSeries.push({
        id: 'gpu_clk_mem',
        label: t('hardware.gpu.series_clock_mem'),
        data: pickNumeric(gHist.map((b) => b.clock_mem), [Number(gpu.clock_mem_mhz), Number(gpu.clock_mem_mhz)]),
        color: '#a855f7',
        unit: 'MHz',
        decimals: 0,
        fillAlpha: 0,
        dashed: true,
      });
    }
    cards.push({
      id: 'clocks',
      title: t('hardware.gpu.graph_clocks_title'),
      subtitle: t('hardware.gpu.graph_clocks_sub', {
        gfx: gpu?.clock_graphics_mhz ?? '--',
        gfxMax: gpu?.clock_max_graphics_mhz ?? '--',
        mem: gpu?.clock_mem_mhz ?? '--',
      }),
      headline: gpu?.clock_graphics_mhz ? `${gpu.clock_graphics_mhz} MHz` : '--',
      available: hasClocks && clockSeries.length > 0,
      leftUnit: 'MHz',
      timestamps: gTimestamps,
      epochTs: gEpochTs,
      series: clockSeries,
    });

    // 6. Enlace PCIe RX / TX
    const pcieRxMb = gpu?.pcie_rx_kbps !== null && gpu?.pcie_rx_kbps !== undefined ? gpu.pcie_rx_kbps / 1024 : 0;
    const pcieTxMb = gpu?.pcie_tx_kbps !== null && gpu?.pcie_tx_kbps !== undefined ? gpu.pcie_tx_kbps / 1024 : 0;
    cards.push({
      id: 'pcie',
      title: t('hardware.gpu.graph_pcie_title'),
      subtitle: t('hardware.gpu.graph_pcie_sub', {
        gen: gpu?.pcie_gen ?? '--',
        width: gpu?.pcie_width ?? '--',
        rx: formatMbRate(pcieRxMb),
        tx: formatMbRate(pcieTxMb),
      }),
      headline: formatMbRate(pcieRxMb + pcieTxMb),
      available: hasPcie,
      leftUnit: 'MB/s',
      timestamps: gTimestamps,
      epochTs: gEpochTs,
      series: hasPcie
        ? [
            {
              id: 'gpu_pcie_rx',
              label: t('hardware.gpu.series_pcie_rx'),
              data: pickNumeric(gHist.map((b) => b.pcie_rx), [pcieRxMb, pcieRxMb]),
              color: '#1e6b38',
              unit: 'MB/s',
              decimals: 2,
            },
            {
              id: 'gpu_pcie_tx',
              label: t('hardware.gpu.series_pcie_tx'),
              data: pickNumeric(gHist.map((b) => b.pcie_tx), [pcieTxMb, pcieTxMb]),
              color: '#10b981',
              unit: 'MB/s',
              decimals: 2,
              fillAlpha: 0.08,
            },
          ]
        : [],
    });

    return cards;
  }, [metrics?.gpu, hist?.gpu, timestamps, epochTs, locale, t]);

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

  const subTabs: Array<{ id: EquipmentSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'cpu', label: t('equipment.sort_cpu'), icon: <Cpu className="h-4 w-4" /> },
    { id: 'ram', label: t('hardware.ram.short_title'), icon: <MemoryStick className="h-4 w-4" /> },
    { id: 'gpu', label: t('hardware.gpu.short_title'), icon: <Monitor className="h-4 w-4" /> },
    { id: 'storage', label: t('hardware.storage.title'), icon: <HardDrive className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-[clamp(0.85rem,1.8dvh,1.25rem)]">
      {/* Sub-navigation auto-wrapping fluid segmented bar (zero clipped/hidden tabs) */}
      <LayoutGroup id="equipment-subtabs">
        <div className="cockpit-segmented cockpit-subtabs-bar">
          {subTabs.map((tab) => {
            const active = subTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                type="button"
                onClick={() => handleSelectSubTab(tab.id)}
                className={`cockpit-subtab-btn relative inline-flex items-center justify-center rounded-xl font-semibold transition-colors ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="equipment-subtab-pill" className="rounded-xl" />}
                <span className="relative z-10 inline-flex items-center gap-[clamp(0.3rem,0.5vw,0.5rem)]">
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
                heightClassName="cockpit-chart-tall"
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
                              color: val >= 85 ? '#dc2626' : val >= 60 ? '#d97706' : primaryBotanical,
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
                            backgroundColor: val >= 85 ? '#dc2626' : val >= 60 ? '#d97706' : primaryBotanical,
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
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-3 text-xs font-mono tabular-nums text-slate-600 dark:border-slate-800 dark:text-slate-300 sm:grid-cols-4">
                <div>{t('equipment.tech_arch_row', { arch: metrics?.cpu?.architecture || '--' })}</div>
                <div>{t('hardware.cpu.physical_cores', { count: metrics?.cpu?.physical_cores || '--' })}</div>
                <div>{t('equipment.freq_row', { freq: metrics?.cpu?.freq_mhz ? `${Math.round(metrics.cpu.freq_mhz)} MHz` : '--' })}</div>
                <div>{t('equipment.load_1m_5m', { l1: metrics?.cpu?.load_1m ?? 0, l5: metrics?.cpu?.load_5m ?? 0 })}</div>
              </div>
            </AccordionBody>
          </div>
          <ResourceProcessesPanel
            kind="cpu"
            metrics={metrics}
            onViewAllProcesses={() => onNavigate?.('programas', 'processes')}
          />
          <FloatingTooltip data={coreTooltip} />
        </div>
      )}

      {/* Subview: RAM */}
      {subTab === 'ram' && (
        <div className="space-y-4">
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
              heightClassName="cockpit-chart-tall"
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
          <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-200/70 pt-4 text-xs dark:border-slate-800 sm:grid-cols-3">
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
        <ResourceProcessesPanel
          kind="ram"
          metrics={metrics}
          onViewAllProcesses={() => onNavigate?.('programas', 'processes')}
        />
        </div>
      )}

      {/* Subview: GPU */}
      {subTab === 'gpu' && (() => {
        const availableCount = gpuSubgraphs.filter((g) => g.available).length;
        const activeGraphs = gpuSubgraphs.filter((g) => g.available && !disabledGpuGraphs[g.id]);
        const toggleGpuGraph = (id: string) => {
          setDisabledGpuGraphs((prev) => ({ ...prev, [id]: !prev[id] }));
        };
        return (
          <div className="space-y-4">
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatPct(metrics?.gpu?.gpu_util_percent)}
                  </span>
                  <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
                    {formatTemp(metrics?.gpu?.temp_c)}
                  </span>
                  {metrics?.gpu?.cuda && (
                    <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      {t('hardware.gpu.cuda_badge', { cuda: metrics.gpu.cuda })}
                    </span>
                  )}
                  {metrics?.gpu?.bar1_total_mb ? (
                    <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                      {t('hardware.gpu.bar1_badge', {
                        used: metrics.gpu.bar1_used_mb ?? 0,
                        total: metrics.gpu.bar1_total_mb,
                      })}
                    </span>
                  ) : null}
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

              {/* Resumen de sensores */}
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-4 text-xs dark:border-slate-800 sm:grid-cols-4">
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

              {/* Barra dinámica de sub-gráficas activadas/desactivadas según hardware */}
              <div className="mt-4 border-t border-slate-200/70 pt-4 dark:border-slate-800">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t('hardware.gpu.sensors_bar_label')}
                  </span>
                  <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    {t('hardware.gpu.sensors_active_count', {
                      active: activeGraphs.length,
                      total: availableCount,
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {gpuSubgraphs.map((g) => {
                    const isEnabled = g.available && !disabledGpuGraphs[g.id];
                    return (
                      <button
                        key={g.id}
                        type="button"
                        disabled={!g.available}
                        onClick={() => g.available && toggleGpuGraph(g.id)}
                        title={!g.available ? t('hardware.gpu.sensor_unavailable') : g.subtitle}
                        className={`inline-flex min-h-[36px] items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                          !g.available
                            ? 'cockpit-subtile cursor-not-allowed opacity-45 text-slate-400 dark:text-slate-500'
                            : isEnabled
                              ? 'cockpit-pill-violet ring-1 ring-violet-400/50 dark:ring-violet-500/40'
                              : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            !g.available
                              ? 'bg-slate-400/50'
                              : isEnabled
                                ? 'bg-violet-500 cockpit-live-dot'
                                : 'bg-slate-400'
                          }`}
                        />
                        <span>{g.title}</span>
                        {!g.available && (
                          <span className="font-normal text-[10px] opacity-80">
                            ({t('hardware.gpu.sensor_unavailable')})
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Rejilla paralela automática con las gráficas disponibles activas */}
            {activeGraphs.length === 0 ? (
              <div className="cockpit-bento p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('hardware.gpu.no_active_graphs')}
              </div>
            ) : (
              <div className="cockpit-auto-grid">
                {activeGraphs.map((g) => {
                  const buildExpandSpec = (): ExpandChartSpec => ({
                    title: g.title,
                    subtitle: `${metrics?.gpu?.name || t('hardware.gpu.system_fallback')} · ${g.subtitle}`,
                    series: g.useMainGpuHistory ? gpuSeries : g.series,
                    timestamps: g.useMainGpuHistory ? timestamps : g.timestamps,
                    epochTs: g.useMainGpuHistory ? epochTs : g.epochTs,
                    leftUnit: g.leftUnit,
                    maxLeft: g.maxLeft,
                    maxRight: g.maxRight,
                    chartKind: 'gpu',
                    gpuSubmetric: g.useMainGpuHistory ? undefined : g.id,
                  });
                  return (
                    <div key={g.id} className="cockpit-bento flex flex-col justify-between p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {g.title}
                          </h3>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate" title={g.subtitle}>
                            {g.subtitle}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums">
                            {g.headline}
                          </span>
                          {onExpandChart && (
                            <button
                              type="button"
                              aria-label={t('hardware.gpu.inspect_aria')}
                              onClick={() => onExpandChart(buildExpandSpec())}
                              className="cockpit-subtile flex min-h-[36px] min-w-[36px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-violet-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-violet-300"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-3">
                        <TelemetryChart
                          series={g.series}
                          timestamps={g.timestamps}
                          epochTs={g.epochTs}
                          heightClassName="cockpit-chart-medium"
                          maxLeft={g.maxLeft}
                          maxRight={g.maxRight}
                          leftUnit={g.leftUnit}
                          theme={theme}
                          onExpandClick={onExpandChart ? () => onExpandChart(buildExpandSpec()) : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <ResourceProcessesPanel
              kind="gpu"
              metrics={metrics}
              onViewAllProcesses={() => onNavigate?.('programas', 'processes')}
            />
          </div>
        );
      })()}

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
                heightClassName="cockpit-chart-tall"
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
                pct >= 88 ? '#dc2626' : isRem ? tertiaryIndigo : isNet ? secondaryTeal : '#d97706';
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
          <ResourceProcessesPanel
            kind="storage"
            metrics={metrics}
            onViewAllProcesses={() => onNavigate?.('programas', 'processes')}
          />
        </div>
      )}
      </ViewStage>
    </div>
  );
};
