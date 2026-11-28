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
import { ChartNarrativeFooter } from './DataVizPrimitives';
import { ExpandChartSpec } from './OverviewView';
import { ResourceProcessesPanel } from './ResourceProcessesPanel';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import { CpuTempSensor, MainTabId, MetricsPayload, ThemeMode } from '../types/telemetry';
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
  const [disabledCpuGraphs, setDisabledCpuGraphs] = useState<Record<string, boolean>>({});
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
  const thermalOrange = isDarkTheme ? '#fb923c' : '#ea580c';
  const secondaryTeal = isDarkTheme ? '#5eead4' : '#0e7490';
  const tertiaryIndigo = isDarkTheme ? '#a5b4fc' : '#4f46e5';
  const warningAmber = isDarkTheme ? '#fbbf24' : '#d97706';

  const cpuCores = useMemo(() => metrics?.cpu?.per_core_percent ?? [], [metrics?.cpu?.per_core_percent]);
  const hasCpuTemp = useMemo(
    () =>
      (metrics?.cpu?.temp_c !== null && metrics?.cpu?.temp_c !== undefined) ||
      (hist?.cpu_temp ?? []).some((v) => Number.isFinite(v) && v > 0),
    [metrics?.cpu?.temp_c, hist?.cpu_temp]
  );

  const cpuSeries: ChartSeries[] = useMemo(() => {
    const list: ChartSeries[] = [
      { id: 'cpu', metricKey: 'cpu', label: t('equipment.sort_cpu'), data: hist?.cpu ?? [], color: primaryBotanical, unit: '%', axis: 'left' },
    ];
    if (hasCpuTemp) {
      const tempArr =
        hist?.cpu_temp && hist.cpu_temp.length >= 2
          ? hist.cpu_temp
          : metrics?.cpu?.temp_c !== null && metrics?.cpu?.temp_c !== undefined
            ? (hist?.cpu ?? [metrics.cpu.temp_c, metrics.cpu.temp_c]).map(() => Number(metrics.cpu?.temp_c ?? 0))
            : [];
      list.push({
        id: 'cpu_temp',
        metricKey: 'cpu_temp',
        label: t('hardware.cpu.series_temp'),
        data: tempArr,
        color: thermalOrange,
        unit: '°C',
        decimals: 1,
        axis: 'right',
        dashed: true,
        fillAlpha: 0,
      });
    }
    return list;
  }, [hist?.cpu, hist?.cpu_temp, metrics?.cpu?.temp_c, hasCpuTemp, primaryBotanical, thermalOrange, t]);

  // Sub-gráficas dinámicas de CPU adaptadas al patrón de GPU, con historial completo en SQLite
  const cpuSubgraphs = useMemo(() => {
    const cpu = metrics?.cpu;
    const caps = cpu?.capabilities ?? {};

    // Recortar a últimos 5 min para vista en vivo coherente con Inicio y GPU
    let sliceStart = 0;
    if (epochTs.length >= 2) {
      const latestEpoch = Number(epochTs[epochTs.length - 1] || 0);
      if (Number.isFinite(latestEpoch) && latestEpoch > 0) {
        const cutoff = latestEpoch - 300;
        const idx = epochTs.findIndex((tsVal) => Number(tsVal) >= cutoff);
        sliceStart = idx >= 0 ? Math.min(idx, Math.max(0, epochTs.length - 2)) : Math.max(0, epochTs.length - 2);
      }
    }
    const cTimestamps = timestamps.slice(sliceStart);
    const cEpochTs = epochTs.slice(sliceStart);
    const sliceOrFallback = (arr?: number[], fallbackVal?: number | null): number[] => {
      if (arr && arr.length >= 2) return arr.slice(sliceStart);
      if (fallbackVal !== null && fallbackVal !== undefined && Number.isFinite(Number(fallbackVal))) {
        return [Number(fallbackVal), Number(fallbackVal)];
      }
      return [];
    };

    const hasTemp = Boolean(caps.temp ?? hasCpuTemp);
    const hasPower = Boolean(caps.power ?? (cpu?.power_watts !== null && cpu?.power_watts !== undefined));
    const hasPowerTemp = hasTemp || hasPower;
    const hasFreq = Boolean(
      caps.freq ?? ((cpu?.freq_mhz ?? 0) > 0 || (hist?.cpu_freq ?? []).some((v) => v > 0))
    );

    const cards: Array<{
      id: 'usage_temp' | 'power_temp' | 'freq' | 'times' | 'load' | 'thermal_probes';
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
      entityKind?: 'cpu_sensor';
      entityId?: string;
      probesList?: CpuTempSensor[];
    }> = [];

    // 1. Uso y Temperatura del Procesador
    const usageTempSeries: ChartSeries[] = [
      {
        id: 'cpu_usage',
        metricKey: 'cpu',
        label: t('hardware.cpu.series_usage'),
        data: sliceOrFallback(hist?.cpu, cpu?.usage_percent ?? 0),
        color: primaryBotanical,
        unit: '%',
        decimals: 1,
        axis: 'left',
      },
    ];
    if (hasTemp) {
      usageTempSeries.push({
        id: 'cpu_temp_overlay',
        metricKey: 'cpu_temp',
        label: t('hardware.cpu.series_temp'),
        data: sliceOrFallback(hist?.cpu_temp, cpu?.temp_c ?? 0),
        color: thermalOrange,
        unit: '°C',
        decimals: 1,
        axis: 'right',
        dashed: true,
        fillAlpha: 0,
      });
    }
    cards.push({
      id: 'usage_temp',
      title: t('hardware.cpu.graph_usage_temp_title'),
      subtitle: hasTemp
        ? t('hardware.cpu.graph_usage_temp_sub', {
            usage: formatPct(cpu?.usage_percent ?? 0),
            temp: formatTemp(cpu?.temp_c),
            cores: cpu?.logical_cores ?? cpuCores.length,
          })
        : t('hardware.cpu.graph_usage_only_sub', {
            usage: formatPct(cpu?.usage_percent ?? 0),
            cores: cpu?.logical_cores ?? cpuCores.length,
          }),
      headline: hasTemp
        ? `${formatPct(cpu?.usage_percent ?? 0)} · ${formatTemp(cpu?.temp_c)}`
        : formatPct(cpu?.usage_percent ?? 0),
      available: true,
      leftUnit: '%',
      maxLeft: 100,
      maxRight: hasTemp ? 100 : undefined,
      timestamps: cTimestamps,
      epochTs: cEpochTs,
      series: usageTempSeries,
    });

    // 2. Temperatura y Consumo Eléctrico (RAPL)
    const powerTempSeries: ChartSeries[] = [];
    if (hasPower) {
      powerTempSeries.push({
        id: 'cpu_power',
        metricKey: 'cpu_power',
        label: t('hardware.cpu.series_power'),
        data: sliceOrFallback(hist?.cpu_power, cpu?.power_watts ?? 0),
        color: '#ea580c',
        unit: 'W',
        decimals: 1,
        axis: 'left',
      });
    }
    if (hasTemp) {
      powerTempSeries.push({
        id: 'cpu_temp',
        metricKey: 'cpu_temp',
        label: t('hardware.cpu.series_temp'),
        data: sliceOrFallback(hist?.cpu_temp, cpu?.temp_c ?? 0),
        color: hasPower ? '#ef4444' : thermalOrange,
        unit: '°C',
        decimals: 1,
        axis: hasPower ? 'right' : 'left',
        dashed: hasPower,
        fillAlpha: hasPower ? 0 : 0.16,
      });
    }
    cards.push({
      id: 'power_temp',
      title: hasPower ? t('hardware.cpu.graph_power_temp_title') : t('hardware.cpu.graph_thermal_title'),
      subtitle: hasPower
        ? t('hardware.cpu.graph_power_temp_sub', {
            power: `${cpu?.power_watts} W`,
            temp: formatTemp(cpu?.temp_c),
          })
        : t('hardware.cpu.graph_thermal_sub', {
            temp: formatTemp(cpu?.temp_c),
            sensors: cpu?.temp_sensors?.length ?? (hasTemp ? 1 : 0),
          }),
      headline: hasPower ? `${cpu?.power_watts} W` : formatTemp(cpu?.temp_c),
      available: hasPowerTemp && powerTempSeries.length > 0,
      leftUnit: hasPower ? 'W' : '°C',
      maxLeft: hasPower ? undefined : 100,
      maxRight: hasPower && hasTemp ? 100 : undefined,
      timestamps: cTimestamps,
      epochTs: cEpochTs,
      series: powerTempSeries,
    });

    // 3. Frecuencia de Reloj
    const freqCur = Math.round(Number(cpu?.freq_mhz ?? 0));
    const freqMax = Math.round(Number(cpu?.freq_max_mhz ?? 0));
    cards.push({
      id: 'freq',
      title: t('hardware.cpu.graph_freq_title'),
      subtitle: t('hardware.cpu.graph_freq_sub', {
        cur: freqCur > 0 ? `${freqCur} MHz` : '--',
        max: freqMax > 0 ? `${freqMax} MHz` : '--',
        gov: cpu?.governor || '--',
      }),
      headline: freqCur > 0 ? `${freqCur} MHz` : '--',
      available: hasFreq,
      leftUnit: 'MHz',
      timestamps: cTimestamps,
      epochTs: cEpochTs,
      series: hasFreq
        ? [
            {
              id: 'cpu_freq',
              metricKey: 'cpu_freq',
              label: t('hardware.cpu.series_freq'),
              data: sliceOrFallback(hist?.cpu_freq, cpu?.freq_mhz ?? 0),
              color: secondaryTeal,
              unit: 'MHz',
              decimals: 0,
            },
          ]
        : [],
    });

    // 4. Desglose de Ejecución (Usuario / Sistema / Espera E/S)
    cards.push({
      id: 'times',
      title: t('hardware.cpu.graph_times_title'),
      subtitle: t('hardware.cpu.graph_times_sub', {
        user: formatPct(cpu?.user_percent ?? 0),
        sys: formatPct(cpu?.system_percent ?? 0),
        io: formatPct(cpu?.iowait_percent ?? 0),
      }),
      headline: `${formatPct(cpu?.user_percent ?? 0)} / ${formatPct(cpu?.system_percent ?? 0)}`,
      available: true,
      leftUnit: '%',
      maxLeft: 100,
      timestamps: cTimestamps,
      epochTs: cEpochTs,
      series: [
        {
          id: 'cpu_user',
          metricKey: 'cpu_user',
          label: t('hardware.cpu.series_user'),
          data: sliceOrFallback(hist?.cpu_user, cpu?.user_percent ?? 0),
          color: primaryBotanical,
          unit: '%',
          decimals: 1,
        },
        {
          id: 'cpu_system',
          metricKey: 'cpu_system',
          label: t('hardware.cpu.series_system'),
          data: sliceOrFallback(hist?.cpu_system, cpu?.system_percent ?? 0),
          color: tertiaryIndigo,
          unit: '%',
          decimals: 1,
          fillAlpha: 0.08,
        },
        {
          id: 'cpu_iowait',
          metricKey: 'cpu_iowait',
          label: t('hardware.cpu.series_iowait'),
          data: sliceOrFallback(hist?.cpu_iowait, cpu?.iowait_percent ?? 0),
          color: warningAmber,
          unit: '%',
          decimals: 1,
          fillAlpha: 0,
          dashed: true,
        },
      ],
    });

    // 5. Cola de Carga del Sistema (Load 1m / 5m)
    cards.push({
      id: 'load',
      title: t('hardware.cpu.graph_load_title'),
      subtitle: t('hardware.cpu.graph_load_sub', {
        l1: (cpu?.load_1m ?? 0).toFixed(2),
        l5: (cpu?.load_5m ?? 0).toFixed(2),
        l15: (cpu?.load_15m ?? 0).toFixed(2),
        cores: cpu?.logical_cores ?? cpuCores.length,
      }),
      headline: (cpu?.load_1m ?? 0).toFixed(2),
      available: true,
      leftUnit: '',
      timestamps: cTimestamps,
      epochTs: cEpochTs,
      series: [
        {
          id: 'cpu_load_1m',
          metricKey: 'cpu_load_1m',
          label: t('hardware.cpu.series_load_1m'),
          data: sliceOrFallback(hist?.cpu_load_1m, cpu?.load_1m ?? 0),
          color: secondaryTeal,
          unit: '',
          decimals: 2,
        },
        {
          id: 'cpu_load_5m',
          metricKey: 'cpu_load_5m',
          label: t('hardware.cpu.series_load_5m'),
          data: sliceOrFallback(hist?.cpu_load_5m, cpu?.load_5m ?? 0),
          color: tertiaryIndigo,
          unit: '',
          decimals: 2,
          fillAlpha: 0,
          dashed: true,
        },
      ],
    });

    // 6. Sensores Térmicos Individuales por Sonda
    const probePalette =
      theme === 'dark'
        ? ['#fb923c', '#f87171', '#fbbf24', '#2dd4bf', '#a5b4fc', '#c6f19d']
        : ['#ea580c', '#dc2626', '#d97706', '#0d9488', '#6366f1', '#1e6b38'];
    const sensorsList = cpu?.temp_sensors ?? [];
    const probesHist = cpu?.temp_sensors_history;
    const hasProbes = sensorsList.length > 0;
    const probeSeries: ChartSeries[] = [];
    let probeTimestamps = cTimestamps;
    let probeEpochTs = cEpochTs;

    if (hasProbes) {
      if (probesHist && probesHist.epoch_ts.length >= 2 && Object.keys(probesHist.probes).length > 0) {
        probeTimestamps = probesHist.timestamps;
        probeEpochTs = probesHist.epoch_ts;
        Object.entries(probesHist.probes)
          .slice(0, 6)
          .forEach(([lbl, arr], idx) => {
            probeSeries.push({
              id: `cpu_probe_${idx}_${lbl}`,
              label: lbl,
              data: arr,
              color: probePalette[idx % probePalette.length],
              unit: '°C',
              decimals: 1,
              fillAlpha: idx === 0 ? 0.12 : 0,
            });
          });
      } else {
        sensorsList.slice(0, 6).forEach((s, idx) => {
          probeSeries.push({
            id: `cpu_probe_${idx}_${s.label}`,
            label: s.label,
            data: [s.temp_c, s.temp_c],
            color: probePalette[idx % probePalette.length],
            unit: '°C',
            decimals: 1,
            fillAlpha: idx === 0 ? 0.12 : 0,
          });
        });
      }
    }
    const maxProbeTemp = hasProbes ? Math.max(...sensorsList.map((s) => s.temp_c)) : null;
    cards.push({
      id: 'thermal_probes',
      title: t('hardware.cpu.graph_probes_title'),
      subtitle: hasProbes
        ? t('hardware.cpu.graph_probes_sub', {
            count: sensorsList.length,
            max: formatTemp(maxProbeTemp),
          })
        : t('hardware.cpu.sensor_unavailable'),
      headline: hasProbes ? formatTemp(maxProbeTemp) : '--',
      available: hasProbes,
      leftUnit: '°C',
      maxLeft: 100,
      timestamps: probeTimestamps,
      epochTs: probeEpochTs,
      series: probeSeries,
      entityKind: 'cpu_sensor',
      entityId: '*',
      probesList: sensorsList,
    });

    return cards;
  }, [
    metrics?.cpu,
    hist?.cpu,
    hist?.cpu_temp,
    hist?.cpu_power,
    hist?.cpu_freq,
    hist?.cpu_user,
    hist?.cpu_system,
    hist?.cpu_iowait,
    hist?.cpu_load_1m,
    hist?.cpu_load_5m,
    hasCpuTemp,
    cpuCores.length,
    timestamps,
    epochTs,
    theme,
    primaryBotanical,
    thermalOrange,
    secondaryTeal,
    tertiaryIndigo,
    warningAmber,
    t,
  ]);

  const ramSeries: ChartSeries[] = useMemo(
    () => [
      { id: 'ram', metricKey: 'ram', label: t('hardware.ram.active_series'), data: hist?.ram ?? [], color: secondaryTeal, unit: '%' },
      { id: 'ram_tot', metricKey: 'ram_total', label: t('hardware.ram.total_cached_series'), data: hist?.ram_total ?? [], color: tertiaryIndigo, unit: '%', fillAlpha: 0, dashed: true },
    ],
    [hist?.ram, hist?.ram_total, secondaryTeal, tertiaryIndigo, t]
  );
  const hasGpuTemp = useMemo(
    () =>
      Boolean(metrics?.gpu?.available) &&
      ((metrics?.gpu?.temp_c !== null && metrics?.gpu?.temp_c !== undefined) ||
        (hist?.gpu_temp ?? []).some((v) => Number.isFinite(v) && v > 0)),
    [metrics?.gpu?.available, metrics?.gpu?.temp_c, hist?.gpu_temp]
  );

  const gpuSeries: ChartSeries[] = useMemo(() => {
    const list: ChartSeries[] = [
      { id: 'gpu', metricKey: 'gpu', label: t('hardware.gpu.series_compute'), data: hist?.gpu ?? [], color: tertiaryIndigo, unit: '%', axis: 'left' },
    ];
    if (hasGpuTemp) {
      const tempArr =
        hist?.gpu_temp && hist.gpu_temp.length >= 2
          ? hist.gpu_temp
          : metrics?.gpu?.temp_c !== null && metrics?.gpu?.temp_c !== undefined
            ? (hist?.gpu ?? [metrics.gpu.temp_c, metrics.gpu.temp_c]).map(() => Number(metrics.gpu?.temp_c ?? 0))
            : [];
      list.push({
        id: 'gpu_temp',
        metricKey: 'gpu_temp',
        label: t('hardware.gpu.series_temp'),
        data: tempArr,
        color: thermalOrange,
        unit: '°C',
        decimals: 1,
        axis: 'right',
        dashed: true,
        fillAlpha: 0,
      });
    }
    return list;
  }, [hist?.gpu, hist?.gpu_temp, metrics?.gpu?.temp_c, hasGpuTemp, tertiaryIndigo, thermalOrange, t]);

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

    // 1. Uso 3D / Cómputo y Temperatura
    const computeSeriesList: ChartSeries[] = [
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
        axis: 'left',
      },
    ];
    if (hasTemp) {
      computeSeriesList.push({
        id: 'gpu_temp_overlay',
        metricKey: 'gpu_temp',
        label: t('hardware.gpu.series_temp'),
        data: pickNumeric(
          gHist.map((b) => b.temp),
          hist?.gpu_temp ??
            (gpu?.temp_c !== null && gpu?.temp_c !== undefined ? [Number(gpu.temp_c), Number(gpu.temp_c)] : [])
        ),
        color: thermalOrange,
        unit: '°C',
        decimals: 1,
        axis: 'right',
        dashed: true,
        fillAlpha: 0,
      });
    }
    cards.push({
      id: 'compute',
      title: t('hardware.gpu.graph_compute_title'),
      subtitle: t('hardware.gpu.graph_compute_sub'),
      headline: hasTemp
        ? `${formatPct(gpu?.gpu_util_percent ?? 0)} · ${formatTemp(gpu?.temp_c)}`
        : formatPct(gpu?.gpu_util_percent ?? 0),
      available: hasCompute,
      leftUnit: '%',
      maxLeft: 100,
      maxRight: hasTemp ? 100 : undefined,
      timestamps: gHist.length >= 2 ? gTimestamps : timestamps,
      epochTs: gHist.length >= 2 ? gEpochTs : epochTs,
      useMainGpuHistory: true,
      series: computeSeriesList,
    });

    // 2. Memoria VRAM y Controlador
    const vramSeriesList: ChartSeries[] = [];
    if (caps.vram ?? Number(gpu?.vram_total_mb || 0) > 0) {
      vramSeriesList.push({
        id: 'gpu_vram_pct',
        metricKey: 'gpu_vram_pct',
        label: t('hardware.gpu.series_vram_pct'),
        data: pickNumeric(gHist.map((b) => b.vram_pct), hist?.gpu_vram_pct ?? [Number(gpu?.vram_percent ?? 0), Number(gpu?.vram_percent ?? 0)]),
        color: '#1e6b38',
        unit: '%',
        decimals: 1,
      });
    }
    if (hasMemCtrl) {
      vramSeriesList.push({
        id: 'gpu_mem_ctrl',
        metricKey: 'gpu_mem_ctrl',
        label: t('hardware.gpu.series_mem_ctrl'),
        data: pickNumeric(gHist.map((b) => b.mem_util), hist?.gpu_mem_ctrl ?? [Number(gpu?.mem_util_percent ?? 0), Number(gpu?.mem_util_percent ?? 0)]),
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
        metricKey: 'gpu_enc',
        label: t('hardware.gpu.series_encoder'),
        data: pickNumeric(gHist.map((b) => b.enc), hist?.gpu_enc ?? [Number(gpu?.encoder_util_percent ?? 0), Number(gpu?.encoder_util_percent ?? 0)]),
        color: '#10b981',
        unit: '%',
        decimals: 1,
      });
    }
    if (hasDecoder) {
      videoSeriesList.push({
        id: 'gpu_dec',
        metricKey: 'gpu_dec',
        label: t('hardware.gpu.series_decoder'),
        data: pickNumeric(gHist.map((b) => b.dec), hist?.gpu_dec ?? [Number(gpu?.decoder_util_percent ?? 0), Number(gpu?.decoder_util_percent ?? 0)]),
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
        metricKey: 'gpu_power',
        label: t('hardware.gpu.series_power'),
        data: pickNumeric(gHist.map((b) => b.power), hist?.gpu_power ?? [Number(gpu?.power_watts ?? 0), Number(gpu?.power_watts ?? 0)]),
        color: '#ea580c',
        unit: 'W',
        decimals: 1,
        axis: 'left',
      });
    }
    if (hasTemp) {
      powerTempSeries.push({
        id: 'gpu_temp',
        metricKey: 'gpu_temp',
        label: t('hardware.gpu.series_temp'),
        data: pickNumeric(gHist.map((b) => b.temp), hist?.gpu_temp ?? [Number(gpu?.temp_c ?? 0), Number(gpu?.temp_c ?? 0)]),
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
        metricKey: 'gpu_clk_gfx',
        label: t('hardware.gpu.series_clock_gfx'),
        data: pickNumeric(gHist.map((b) => b.clock_gfx), hist?.gpu_clk_gfx ?? [Number(gpu.clock_graphics_mhz), Number(gpu.clock_graphics_mhz)]),
        color: '#1e6b38',
        unit: 'MHz',
        decimals: 0,
      });
    }
    if (gpu?.clock_mem_mhz !== null && gpu?.clock_mem_mhz !== undefined) {
      clockSeries.push({
        id: 'gpu_clk_mem',
        metricKey: 'gpu_clk_mem',
        label: t('hardware.gpu.series_clock_mem'),
        data: pickNumeric(gHist.map((b) => b.clock_mem), hist?.gpu_clk_mem ?? [Number(gpu.clock_mem_mhz), Number(gpu.clock_mem_mhz)]),
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
              metricKey: 'gpu_pcie_rx',
              label: t('hardware.gpu.series_pcie_rx'),
              data: pickNumeric(gHist.map((b) => b.pcie_rx), hist?.gpu_pcie_rx ?? [pcieRxMb, pcieRxMb]),
              color: '#1e6b38',
              unit: 'MB/s',
              decimals: 2,
            },
            {
              id: 'gpu_pcie_tx',
              metricKey: 'gpu_pcie_tx',
              label: t('hardware.gpu.series_pcie_tx'),
              data: pickNumeric(gHist.map((b) => b.pcie_tx), hist?.gpu_pcie_tx ?? [pcieTxMb, pcieTxMb]),
              color: '#10b981',
              unit: 'MB/s',
              decimals: 2,
              fillAlpha: 0.08,
            },
          ]
        : [],
    });

    return cards;
  }, [
    metrics?.gpu,
    hist?.gpu,
    hist?.gpu_vram_pct,
    hist?.gpu_mem_ctrl,
    hist?.gpu_enc,
    hist?.gpu_dec,
    hist?.gpu_power,
    hist?.gpu_temp,
    hist?.gpu_clk_gfx,
    hist?.gpu_clk_mem,
    hist?.gpu_pcie_rx,
    hist?.gpu_pcie_tx,
    timestamps,
    epochTs,
    locale,
    thermalOrange,
    t,
  ]);

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
        {subTab === 'cpu' && (() => {
          const availableCpuCount = cpuSubgraphs.filter((g) => g.available).length;
          const activeCpuGraphs = cpuSubgraphs.filter((g) => g.available && !disabledCpuGraphs[g.id]);
          const toggleCpuGraph = (id: string) => {
            setDisabledCpuGraphs((prev) => ({ ...prev, [id]: !prev[id] }));
          };
          return (
            <div className="space-y-4">
              {/* Cabecera de resumen de sensores y barra dinámica de sub-gráficas (paridad con GPU) */}
              <div className="cockpit-bento p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                      {t('equipment.cpu_perf')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {metrics?.cpu?.model || t('equipment.cpu_main_fallback')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AnimatedMetricValue
                      value={Number(metrics?.cpu?.usage_percent ?? 0)}
                      decimals={1}
                      suffix=" %"
                      className="font-mono text-2xl font-bold text-slate-900 dark:text-white"
                    />
                    <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
                      {formatTemp(metrics?.cpu?.temp_c)}
                    </span>
                    {metrics?.cpu?.governor && (
                      <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {metrics.cpu.governor}
                      </span>
                    )}
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
                            maxRight: hasCpuTemp ? 100 : undefined,
                            chartKind: 'cpu',
                          })
                        }
                        className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-[#c6f19d]"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Tira de resumen de sensores CPU */}
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-4 text-xs dark:border-slate-800 sm:grid-cols-4">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">{t('hardware.cpu.base_freq')}</span>
                    <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {metrics?.cpu?.freq_mhz ? `${Math.round(metrics.cpu.freq_mhz)} MHz` : '--'}
                      {metrics?.cpu?.freq_max_mhz ? (
                        <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          / {Math.round(metrics.cpu.freq_max_mhz)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">{t('hardware.cpu.temp_label')}</span>
                    <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {formatTemp(metrics?.cpu?.temp_c)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">{t('hardware.cpu.load_label')}</span>
                    <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {(metrics?.cpu?.load_1m ?? 0).toFixed(2)} / {(metrics?.cpu?.load_5m ?? 0).toFixed(2)} / {(metrics?.cpu?.load_15m ?? 0).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">
                      {metrics?.cpu?.power_watts !== null && metrics?.cpu?.power_watts !== undefined
                        ? t('hardware.cpu.power_draw')
                        : t('hardware.cpu.logical_cores')}
                    </span>
                    <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {metrics?.cpu?.power_watts !== null && metrics?.cpu?.power_watts !== undefined
                        ? `${metrics.cpu.power_watts} W`
                        : `${metrics?.cpu?.physical_cores || '--'} / ${metrics?.cpu?.logical_cores || cpuCores.length || '--'}`}
                    </p>
                  </div>
                </div>

                {/* Barra dinámica de sub-gráficas activadas/desactivadas según sensores CPU */}
                <div className="mt-4 border-t border-slate-200/70 pt-4 dark:border-slate-800">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {t('hardware.cpu.sensors_bar_label')}
                    </span>
                    <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                      {t('hardware.cpu.sensors_active_count', {
                        active: activeCpuGraphs.length,
                        total: availableCpuCount,
                      })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cpuSubgraphs.map((g) => {
                      const isEnabled = g.available && !disabledCpuGraphs[g.id];
                      return (
                        <button
                          key={g.id}
                          type="button"
                          disabled={!g.available}
                          onClick={() => g.available && toggleCpuGraph(g.id)}
                          title={!g.available ? t('hardware.cpu.sensor_unavailable') : g.subtitle}
                          className={`inline-flex min-h-[36px] items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                            !g.available
                              ? 'cockpit-subtile cursor-not-allowed opacity-45 text-slate-400 dark:text-slate-500'
                              : isEnabled
                                ? 'cockpit-pill-cyan ring-1 ring-[#1e6b38]/40 dark:ring-[#c6f19d]/40'
                                : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              !g.available
                                ? 'bg-slate-400/50'
                                : isEnabled
                                  ? 'bg-[#1e6b38] dark:bg-[#c6f19d] cockpit-live-dot'
                                  : 'bg-slate-400'
                            }`}
                          />
                          <span>{g.title}</span>
                          {!g.available && (
                            <span className="font-normal text-[10px] opacity-80">
                              ({t('hardware.cpu.sensor_unavailable')})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Rejilla paralela automática con las sub-gráficas activas de CPU */}
              {activeCpuGraphs.length === 0 ? (
                <div className="cockpit-bento p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('hardware.cpu.no_active_graphs')}
                </div>
              ) : (
                <div className="cockpit-auto-grid">
                  {activeCpuGraphs.map((g) => {
                    const buildExpandSpec = (): ExpandChartSpec => ({
                      title: g.title,
                      subtitle: `${metrics?.cpu?.model || t('equipment.cpu_main_fallback')} · ${g.subtitle}`,
                      series: g.series,
                      timestamps: g.timestamps,
                      epochTs: g.epochTs,
                      leftUnit: g.leftUnit,
                      maxLeft: g.maxLeft,
                      maxRight: g.maxRight,
                      chartKind: 'cpu',
                      entityKind: g.entityKind,
                      entityId: g.entityId,
                    });
                    return (
                      <div key={g.id} className="cockpit-bento flex min-w-0 flex-col justify-between p-5">
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
                            <span className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-[#c6f19d]">
                              {g.headline}
                            </span>
                            {onExpandChart && (
                              <button
                                type="button"
                                aria-label={t('hardware.cpu.inspect_aria')}
                                onClick={() => onExpandChart(buildExpandSpec())}
                                className="cockpit-subtile flex min-h-[36px] min-w-[36px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-[#c6f19d]"
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
                          <ChartNarrativeFooter
                            data={g.series[0]?.data ?? []}
                            secondaryData={
                              g.series[1] &&
                              g.series[1].axis !== 'right' &&
                              (g.series[1].unit ?? g.leftUnit) === (g.series[0]?.unit ?? g.leftUnit)
                                ? g.series[1].data
                                : undefined
                            }
                            unit={g.series[0]?.unit ?? g.leftUnit}
                            decimals={g.series[0]?.decimals ?? 1}
                          />
                        </div>
                        {g.id === 'thermal_probes' && g.probesList && g.probesList.length > 0 && (
                          <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-slate-200/70 pt-3 dark:border-slate-800 sm:grid-cols-2">
                            {g.probesList.slice(0, 8).map((probe, pIdx) => {
                              const pctBar = Math.max(8, Math.min(100, probe.temp_c));
                              const isCrit = probe.temp_c >= 85;
                              const isWarn = !isCrit && probe.temp_c >= 70;
                              const toneText = isCrit
                                ? 'text-rose-600 dark:text-rose-400'
                                : isWarn
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-[#c6f19d]';
                              const toneBar = isCrit
                                ? 'bg-rose-500'
                                : isWarn
                                  ? 'bg-amber-500'
                                  : 'bg-[#1e6b38] dark:bg-[#c6f19d]';
                              const statusTxt = isCrit
                                ? t('hardware.cpu.probe_status_crit')
                                : isWarn
                                  ? t('hardware.cpu.probe_status_warn')
                                  : t('hardware.cpu.probe_status_ok');
                              const openSingleProbe = () => {
                                if (!onExpandChart) return;
                                const pHist = metrics?.cpu?.temp_sensors_history;
                                const arr = pHist?.probes?.[probe.label];
                                onExpandChart({
                                  title: `${t('hardware.cpu.graph_probes_title')} · ${probe.label}`,
                                  subtitle: `${metrics?.cpu?.model || t('equipment.cpu_main_fallback')} · ${formatTemp(probe.temp_c)} · ${statusTxt}`,
                                  series: [
                                    {
                                      id: `probe_${probe.label}`,
                                      label: probe.label,
                                      data: arr && arr.length >= 2 ? arr : [probe.temp_c, probe.temp_c],
                                      color: thermalOrange,
                                      unit: '°C',
                                      decimals: 1,
                                      fillAlpha: 0.16,
                                    },
                                  ],
                                  timestamps: pHist?.timestamps?.length ? pHist.timestamps : g.timestamps,
                                  epochTs: pHist?.epoch_ts?.length ? pHist.epoch_ts : g.epochTs,
                                  leftUnit: '°C',
                                  maxLeft: 100,
                                  chartKind: 'cpu',
                                  entityKind: 'cpu_sensor',
                                  entityId: probe.label,
                                });
                              };
                              return (
                                <button
                                  key={`${probe.label}-${pIdx}`}
                                  type="button"
                                  onClick={openSingleProbe}
                                  aria-label={t('hardware.cpu.probe_inspect_aria', { label: probe.label })}
                                  className="cockpit-subtile flex min-w-0 flex-col gap-1 px-2.5 py-2 text-left transition-colors hover:border-[#1e6b38]/40 dark:hover:border-[#c6f19d]/40 cursor-pointer"
                                >
                                  <div className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="truncate font-medium text-slate-700 dark:text-slate-200" title={probe.label}>
                                      {probe.label}
                                    </span>
                                    <span className={`shrink-0 font-mono font-semibold tabular-nums ${toneText}`}>
                                      {formatTemp(probe.temp_c)} · {statusTxt}
                                    </span>
                                  </div>
                                  <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                                    <div
                                      className={`h-full rounded-full transition-all duration-200 ${toneBar}`}
                                      style={{ width: `${pctBar}%` }}
                                    />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Carga por núcleo + detalles técnicos */}
              <div className="cockpit-bento p-5">
                {cpuCores.length > 0 && (
                  <div>
                    <p className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
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
                          className="cockpit-subtile p-2 text-center transition-colors hover:border-[#1e6b38]/50 dark:hover:border-[#c6f19d]/50"
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
                  className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
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
          );
        })()}

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
                          maxRight: hasGpuTemp ? 100 : undefined,
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">
                        {isMounted ? formatPct(d.percent) : t('hardware.storage.unmounted')}
                      </span>
                      {onExpandChart && (
                        <button
                          type="button"
                          aria-label={t('hardware.storage.expand_aria', { name: formatDiskLabel(d, locale) })}
                          onClick={() => {
                            const dHist = d.io_history ?? [];
                            const dTs = dHist.length
                              ? dHist.map((b) => new Date(b.t).toLocaleTimeString(locale))
                              : timestamps;
                            const dEpoch = dHist.length ? dHist.map((b) => Math.round(b.t / 1000)) : epochTs;
                            const currentDiskTemp =
                              d.temp_c !== null && d.temp_c !== undefined && Number.isFinite(Number(d.temp_c))
                                ? Number(d.temp_c)
                                : null;
                            const hasDiskTemp =
                              currentDiskTemp !== null ||
                              dHist.some((b) => typeof b.temp === 'number' && Number.isFinite(b.temp) && b.temp > 0);
                            const diskExpandSeries: ChartSeries[] = [
                              {
                                id: 'disk_r',
                                metricKey: 'disk_r',
                                label: t('hardware.storage.read'),
                                data: dHist.length ? dHist.map((b) => Math.round((b.r / (1024 * 1024)) * 100) / 100) : [0, 0],
                                color: barColor,
                                unit: 'MB/s',
                                decimals: 2,
                                axis: 'left',
                              },
                              {
                                id: 'disk_w',
                                metricKey: 'disk_w',
                                label: t('hardware.storage.write'),
                                data: dHist.length ? dHist.map((b) => Math.round((b.w / (1024 * 1024)) * 100) / 100) : [0, 0],
                                color: '#f59e0b',
                                unit: 'MB/s',
                                decimals: 2,
                                fillAlpha: 0.08,
                                axis: 'left',
                              },
                            ];
                            if (hasDiskTemp) {
                              const firstValidTemp = dHist.find(
                                (b) => typeof b.temp === 'number' && Number.isFinite(b.temp) && b.temp > 0
                              )?.temp;
                              let lastTemp =
                                typeof firstValidTemp === 'number' && firstValidTemp > 0
                                  ? firstValidTemp
                                  : currentDiskTemp ?? 0;
                              diskExpandSeries.push({
                                id: 'disk_temp',
                                metricKey: 'disk_temp',
                                label: t('hardware.cpu.series_temp'),
                                data: dHist.length
                                  ? dHist.map((b) => {
                                      if (typeof b.temp === 'number' && Number.isFinite(b.temp) && b.temp > 0) {
                                        lastTemp = b.temp;
                                      }
                                      return lastTemp;
                                    })
                                  : [currentDiskTemp ?? 0, currentDiskTemp ?? 0],
                                color: thermalOrange,
                                unit: '°C',
                                decimals: 1,
                                axis: 'right',
                                dashed: true,
                                fillAlpha: 0,
                              });
                            }
                            onExpandChart({
                              title: formatDiskLabel(d, locale),
                              subtitle: `${d.mountpoint}${d.device && d.device !== d.mountpoint ? ` · ${d.device}` : ''}`,
                              series: diskExpandSeries,
                              timestamps: dTs,
                              epochTs: dEpoch,
                              leftUnit: 'MB/s',
                              maxRight: hasDiskTemp ? 100 : undefined,
                              chartKind: 'storage',
                              diskMountpoint: d.mountpoint,
                              entityKind: 'disk',
                              entityId: d.device || d.mountpoint,
                            });
                          }}
                          className="cockpit-subtile flex min-h-[34px] min-w-[34px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-amber-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-amber-300 cursor-pointer"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
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
