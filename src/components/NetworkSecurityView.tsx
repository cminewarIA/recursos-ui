import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  Activity,
  ArrowDownUp,
  Bell,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Gauge,
  Globe,
  Globe2,
  History,
  Image as ImageIcon,
  Lock,
  MapPin,
  Maximize2,
  Power,
  PowerOff,
  RefreshCw,
  Router,
  Search,
  Send,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unlock,
  Wifi,
  Zap,
} from 'lucide-react';
import { COCKPIT_EASE, COCKPIT_SPRING, MorphPill, ViewStage } from './MotionPrimitives';
import { ExpandChartSpec } from './OverviewView';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import {
  AiConnectionInsight,
  AiIdentifyResponse,
  DnsTrafficStatsResponse,
  GeoConnectionItem,
  MetricsPayload,
  NetHistoryResponse,
  NetInterfaceInfo,
  NicHistoryBucket,
  SpeedTestHistoryResponse,
  SpeedTestResult,
  SpeedTestStatus,
  TelemetryHistoryResponse,
  TelegramBotStatusPayload,
  ThemeMode,
  WifiClient,
} from '../types/telemetry';
import { useFirebase } from '../firebase/FirebaseProvider';
import { apiFetchJson } from '../utils/api';
import { formatBytes, formatSpeed } from '../utils/formatters';
import { formatBandLabel, formatClientVendor, useI18n } from '../i18n';

function escapeMapHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type MapConnFilter = 'all' | 'incoming' | 'outgoing' | 'devices' | 'blocked';

interface ActiveMapPopupState {
  isOpen: boolean;
  clusterKey: string | null;
  selectedConnKey: string | null;
  remoteIp: string | null;
  representativeIp: string | null;
  clusterIps: string[];
  lat: number | null;
  lng: number | null;
}

interface NicHistoryCardProps {
  nic: NetInterfaceInfo;
  theme: ThemeMode;
  locale: string;
  onExpandChart?: (spec: ExpandChartSpec) => void;
}

const NicHistoryCard = React.memo<NicHistoryCardProps>(({ nic, theme, locale, onExpandChart }) => {
  const { t } = useI18n();
  const hist2h = useMemo(() => nic.history_2h ?? [], [nic.history_2h]);

  const { nicSeries, nicTimestamps, nicEpochTs, expandNicSpec } = useMemo(() => {
    const wanRxData = hist2h.map((b) => Math.round(((b.wan_rx ?? b.rx) / (1024 * 1024)) * 100) / 100);
    const wanTxData = hist2h.map((b) => Math.round(((b.wan_tx ?? b.tx) / (1024 * 1024)) * 100) / 100);
    const lanRxData = hist2h.map((b) => Math.round(((b.lan_rx ?? 0) / (1024 * 1024)) * 100) / 100);
    const lanTxData = hist2h.map((b) => Math.round(((b.lan_tx ?? 0) / (1024 * 1024)) * 100) / 100);
    const timestamps = hist2h.map((b) => new Date(b.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale));
    const epochTs = hist2h.map((b) => Math.round(b.t / 1000));
    const series: ChartSeries[] = [
      { id: 'wan_rx', metricKey: 'net_wan_rx', label: t('hardware.net.wan_download'), data: wanRxData, color: theme === 'dark' ? '#c6f19d' : '#1e6b38', unit: 'MB/s', decimals: 2, fillAlpha: 0.16 },
      { id: 'wan_tx', metricKey: 'net_wan_tx', label: t('hardware.net.wan_upload'), data: wanTxData, color: '#10b981', unit: 'MB/s', decimals: 2, fillAlpha: 0.08 },
      { id: 'lan_rx', metricKey: 'net_lan_rx', label: t('hardware.net.lan_download'), data: lanRxData, color: '#6366f1', unit: 'MB/s', decimals: 2, fillAlpha: 0.10 },
      { id: 'lan_tx', metricKey: 'net_lan_tx', label: t('hardware.net.lan_upload'), data: lanTxData, color: '#f59e0b', unit: 'MB/s', decimals: 2, fillAlpha: 0.06 },
    ];
    const spec: ExpandChartSpec = {
      title: t('hardware.net.iface_full_title', { name: nic.name }),
      subtitle: t('hardware.net.iface_20m_subtitle', { ip: nic.ip || t('hardware.net.local_net') }),
      series,
      timestamps,
      epochTs,
      leftUnit: 'MB/s',
      chartKind: 'net',
      nicName: nic.name,
    };
    return { nicSeries: series, nicTimestamps: timestamps, nicEpochTs: epochTs, expandNicSpec: spec };
  }, [hist2h, nic.name, nic.ip, locale, theme, t]);

  const formatNicLabel = useCallback(
    (idx: number) => {
      const bucket = hist2h[idx];
      return bucket
        ? new Date(bucket.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale)
        : t('charts.sample_n', { n: idx + 1 });
    },
    [hist2h, locale, t]
  );

  const handleExpand = useCallback(() => {
    if (onExpandChart) onExpandChart(expandNicSpec);
  }, [onExpandChart, expandNicSpec]);

  const wanRxNow = nic.wan_rx_bytes_sec ?? nic.rx_bytes_sec;
  const wanTxNow = nic.wan_tx_bytes_sec ?? nic.tx_bytes_sec;
  const lanRxNow = nic.lan_rx_bytes_sec ?? 0;
  const lanTxNow = nic.lan_tx_bytes_sec ?? 0;

  return (
    <div className="cockpit-bento min-w-0 overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
            {t('hardware.net.iface_title', { name: nic.name })}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {nic.ip || t('hardware.net.no_local_ip')} · {nic.is_up ? t('hardware.net.active') : t('hardware.net.disconnected')}
          </p>
        </div>
        {onExpandChart && (
          <button
            type="button"
            aria-label={t('hardware.net.inspect_aria', { name: nic.name })}
            onClick={handleExpand}
            className="cockpit-subtile flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-2.5 gap-y-1 border-t border-slate-200/70 pt-2 font-mono text-[11px] tabular-nums dark:border-slate-800">
        <div className="min-w-0 truncate text-sky-600 dark:text-sky-400" title={t('hardware.net.wan_download')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.wan_short')}</span>
          ↓ {formatSpeed(wanRxNow)}
        </div>
        <div className="min-w-0 truncate text-right text-indigo-600 dark:text-indigo-400" title={t('hardware.net.lan_download')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.lan_short')}</span>
          ↓ {formatSpeed(lanRxNow)}
        </div>
        <div className="min-w-0 truncate text-emerald-600 dark:text-emerald-400" title={t('hardware.net.wan_upload')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.wan_short')}</span>
          ↑ {formatSpeed(wanTxNow)}
        </div>
        <div className="min-w-0 truncate text-right text-amber-600 dark:text-amber-400" title={t('hardware.net.lan_upload')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.lan_short')}</span>
          ↑ {formatSpeed(lanTxNow)}
        </div>
      </div>
      <div className="mt-3">
        <TelemetryChart
          series={nicSeries}
          timestamps={nicTimestamps}
          epochTs={nicEpochTs}
          heightClassName="cockpit-chart-compact"
          leftUnit="MB/s"
          theme={theme}
          emptyMessage={t('hardware.net.accumulating_20m')}
          onExpandClick={onExpandChart ? handleExpand : undefined}
          formatLabel={formatNicLabel}
        />
      </div>
    </div>
  );
});

interface RouterTrafficCardProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  locale: string;
  onExpandChart?: (spec: ExpandChartSpec) => void;
}

const RouterTrafficCard = React.memo<RouterTrafficCardProps>(({ metrics, theme, locale, onExpandChart }) => {
  const { t } = useI18n();
  const wifiSum = metrics?.wifi_summary;
  const routerHist: NicHistoryBucket[] = useMemo(
    () => wifiSum?.router_history_20m ?? metrics?.net?.router_history_20m ?? [],
    [wifiSum?.router_history_20m, metrics?.net?.router_history_20m]
  );

  const routerTitle =
    wifiSum?.router_traffic_source ||
    wifiSum?.router_model ||
    wifiSum?.gateway_name ||
    t('network.router_widget_title');
  const routerIp = wifiSum?.router_ip || wifiSum?.gateway_ip || metrics?.net?.local_ip || t('hardware.net.local_net');
  const wanRxNow = wifiSum?.router_wan_rx_bytes_sec ?? metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0;
  const wanTxNow = wifiSum?.router_wan_tx_bytes_sec ?? metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0;
  const lanRxNow = wifiSum?.router_lan_rx_bytes_sec ?? metrics?.net?.lan_rx_bytes_sec ?? 0;
  const lanTxNow = wifiSum?.router_lan_tx_bytes_sec ?? metrics?.net?.lan_tx_bytes_sec ?? 0;

  const { routerSeries, routerTimestamps, routerEpochTs, expandRouterSpec } = useMemo(() => {
    const wanRxData = routerHist.map((b) => Math.round(((b.wan_rx ?? b.rx) / (1024 * 1024)) * 100) / 100);
    const wanTxData = routerHist.map((b) => Math.round(((b.wan_tx ?? b.tx) / (1024 * 1024)) * 100) / 100);
    const lanRxData = routerHist.map((b) => Math.round(((b.lan_rx ?? 0) / (1024 * 1024)) * 100) / 100);
    const lanTxData = routerHist.map((b) => Math.round(((b.lan_tx ?? 0) / (1024 * 1024)) * 100) / 100);
    const timestamps = routerHist.map((b) => new Date(b.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale));
    const epochTs = routerHist.map((b) => Math.round(b.t / 1000));
    const series: ChartSeries[] = [
      { id: 'wan_rx', metricKey: 'net_wan_rx', label: t('hardware.net.wan_download'), data: wanRxData, color: theme === 'dark' ? '#c6f19d' : '#1e6b38', unit: 'MB/s', decimals: 2, fillAlpha: 0.16 },
      { id: 'wan_tx', metricKey: 'net_wan_tx', label: t('hardware.net.wan_upload'), data: wanTxData, color: '#10b981', unit: 'MB/s', decimals: 2, fillAlpha: 0.08 },
      { id: 'lan_rx', metricKey: 'net_lan_rx', label: t('hardware.net.lan_download'), data: lanRxData, color: '#6366f1', unit: 'MB/s', decimals: 2, fillAlpha: 0.10 },
      { id: 'lan_tx', metricKey: 'net_lan_tx', label: t('hardware.net.lan_upload'), data: lanTxData, color: '#f59e0b', unit: 'MB/s', decimals: 2, fillAlpha: 0.06 },
    ];
    const spec: ExpandChartSpec = {
      title: `${t('network.router_widget_title')} · ${routerTitle}`,
      subtitle: t('hardware.net.iface_20m_subtitle', { ip: routerIp }),
      series,
      timestamps,
      epochTs,
      leftUnit: 'MB/s',
      chartKind: 'router',
    };
    return { routerSeries: series, routerTimestamps: timestamps, routerEpochTs: epochTs, expandRouterSpec: spec };
  }, [routerHist, routerTitle, routerIp, locale, theme, t]);

  const formatRouterLabel = useCallback(
    (idx: number) => {
      const bucket = routerHist[idx];
      return bucket
        ? new Date(bucket.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale)
        : t('charts.sample_n', { n: idx + 1 });
    },
    [routerHist, locale, t]
  );

  const handleExpand = useCallback(() => {
    if (onExpandChart) onExpandChart(expandRouterSpec);
  }, [onExpandChart, expandRouterSpec]);

  return (
    <div className="cockpit-bento min-w-0 overflow-hidden p-4" data-testid="router-traffic-widget">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Router className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {t('network.router_widget_title')}
            </p>
          </div>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums" title={`${routerTitle} · ${routerIp}`}>
            {routerTitle} · {routerIp}
          </p>
        </div>
        {onExpandChart && (
          <button
            type="button"
            aria-label={t('hardware.net.inspect_aria', { name: routerTitle })}
            onClick={handleExpand}
            className="cockpit-subtile flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-2.5 gap-y-1 border-t border-slate-200/70 pt-2 font-mono text-[11px] tabular-nums dark:border-slate-800">
        <div className="min-w-0 truncate text-sky-600 dark:text-sky-400" title={t('hardware.net.wan_download')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.wan_short')}</span>
          ↓ {formatSpeed(wanRxNow)}
        </div>
        <div className="min-w-0 truncate text-right text-indigo-600 dark:text-indigo-400" title={t('hardware.net.lan_download')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.lan_short')}</span>
          ↓ {formatSpeed(lanRxNow)}
        </div>
        <div className="min-w-0 truncate text-emerald-600 dark:text-emerald-400" title={t('hardware.net.wan_upload')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.wan_short')}</span>
          ↑ {formatSpeed(wanTxNow)}
        </div>
        <div className="min-w-0 truncate text-right text-amber-600 dark:text-amber-400" title={t('hardware.net.lan_upload')}>
          <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.lan_short')}</span>
          ↑ {formatSpeed(lanTxNow)}
        </div>
      </div>
      <div className="mt-3">
        <TelemetryChart
          series={routerSeries}
          timestamps={routerTimestamps}
          epochTs={routerEpochTs}
          heightClassName="cockpit-chart-compact"
          leftUnit="MB/s"
          theme={theme}
          emptyMessage={t('network.router_accumulating')}
          onExpandClick={onExpandChart ? handleExpand : undefined}
          formatLabel={formatRouterLabel}
        />
      </div>
    </div>
  );
});

interface DynamicGeoCluster {
  key: string;
  lat: number;
  lng: number;
  isNode: boolean;
  items: GeoConnectionItem[];
}

function getConnIdentityKey(c: GeoConnectionItem, idx = 0): string {
  if (c.is_server_node) return 'server-node';
  const remIp = c.remote_ip || c.ip || '';
  const remPort = c.remote_port || c.port || 0;
  const locIp = c.local_ip || '';
  const locPort = c.local_port || 0;
  const dir = c.direction || 'out';
  return c.id || `${dir}:${locIp}:${locPort}->${remIp}:${remPort}:${idx}`;
}

function getConnAiSignature(c: GeoConnectionItem): string {
  const dir = String(c.direction || 'outgoing').trim().toLowerCase();
  const proto = String(c.protocol || 'TCP').trim().toUpperCase();
  const lPort = Number(c.local_port || 0);
  const rIp = String(c.remote_ip || c.ip || '').trim();
  const rPort = Number(c.remote_port || c.port || 0);
  const dom = String(c.domain || '').trim().toLowerCase();
  const svc = String(c.service || '').trim();
  const proc = String(c.process || '').trim();
  const isp = String(c.isp || c.org || '').trim();
  return `${dir}|${proto}|${lPort}|${rIp}|${rPort}|${dom}|${svc}|${proc}|${isp}`;
}

function isHomeDeviceConn(c: GeoConnectionItem, serverLocalIp?: string): boolean {
  if (c.is_server_node) return false;
  const locIp = String(c.local_ip || '').trim();
  if (!locIp || locIp === '127.0.0.1' || locIp === '::1') return false;
  if (serverLocalIp && locIp === serverLocalIp) return false;
  const host = String(c.local_hostname || '').trim().toLowerCase();
  if (host && host !== 'servidor' && host !== 'localhost') return true;
  if (String(c.process || '').toLowerCase().includes('pi-hole')) return true;
  return Boolean(serverLocalIp && locIp !== serverLocalIp);
}

function inferDefaultJail(c: GeoConnectionItem): string {
  if (c.jail) return c.jail;
  const port = Number(c.local_port || c.remote_port || c.port || 0);
  const svc = String(c.service || '').toLowerCase();
  if (port === 22 || svc.includes('ssh')) return 'sshd';
  if (port === 80 || port === 443 || svc.includes('http') || svc.includes('caddy')) return 'caddy-scan';
  return 'all';
}

function countryCodeToFlag(code?: string): string {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌐';
  return String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65, 0x1f1e6 + c.charCodeAt(1) - 65);
}

function localizeCountryName(rawName: string, code: string | undefined, locale: string): string {
  const c = String(code || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c) && typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const dn = new Intl.DisplayNames([locale || 'es'], { type: 'region' });
      const localized = dn.of(c);
      if (localized) return localized;
    } catch {
      // Fallback to raw geoip name
    }
  }
  return rawName || c || '--';
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

type RedSubTab = 'home' | 'traffic' | 'map' | 'speedtest' | 'security' | 'dns';
type ClientSortMode = 'down' | 'up' | 'lan' | 'name';

function resolveRedSubTab(hint?: string): RedSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'security' || h === 'seguridad') return 'security';
  if (h === 'traffic' || h === 'trafico' || h === 'historial' || h === 'history') return 'traffic';
  if (h === 'dns' || h === 'duckdns') return 'dns';
  if (h === 'map' || h === 'mapa') return 'map';
  if (h === 'speedtest' || h === 'velocidad') return 'speedtest';
  if (h === 'home' || h === 'red') return 'home';
  return undefined;
}

interface NetworkSecurityViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  initialSubTab?: string;
  navTick?: number;
  onExpandChart?: (spec: ExpandChartSpec) => void;
  onPowerAction: (action: 'wake' | 'shutdown', client: WifiClient) => void;
  actionPendingMac: string | null;
  onRefreshMetrics: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  netHistory24h?: TelemetryHistoryResponse | null;
  netHistoryLoading?: boolean;
  netHistoryError?: boolean;
  onRefreshNetHistory24h?: () => void;
}

interface DuckDnsStatusPayload {
  available?: boolean;
  installed?: boolean;
  domain?: string;
  full_domain?: string;
  last_registered_ip?: string;
  last_update_time?: string;
}

interface LogoSearchResult {
  title: string;
  subtitle: string;
  logo_url: string;
  fallback_url?: string;
}

export const NetworkSecurityView: React.FC<NetworkSecurityViewProps> = ({
  metrics,
  theme,
  initialSubTab,
  navTick,
  onExpandChart,
  onPowerAction,
  actionPendingMac,
  onRefreshMetrics,
  onNotify,
  netHistory24h,
  netHistoryLoading = false,
  netHistoryError = false,
  onRefreshNetHistory24h,
}) => {
  const { t, locale } = useI18n();
  const {
    user: fbUser,
    autoSync: fbAutoSync,
    syncedSpeedtests,
    syncedPingHistory,
    syncSpeedTestRecord,
  } = useFirebase();
  const fbSyncRef = useRef({
    user: fbUser,
    autoSync: fbAutoSync,
    hostname: metrics?.system?.hostname || 'host',
    syncSpeedTestRecord,
  });
  fbSyncRef.current = {
    user: fbUser,
    autoSync: fbAutoSync,
    hostname: metrics?.system?.hostname || 'host',
    syncSpeedTestRecord,
  };
  const lastSyncedSpeedtestIdRef = useRef<string | null>(null);

  const [subTab, setSubTab] = useState<RedSubTab>(() => resolveRedSubTab(initialSubTab) || 'home');
  const [clientQuery, setClientQuery] = useState('');
  const [clientSort, setClientSort] = useState<ClientSortMode>('down');
  const [showTechNet, setShowTechNet] = useState(false);

  // Speed Test state
  const [speedtestStatus, setSpeedtestStatus] = useState<SpeedTestStatus | null>(null);
  const [speedtestHistory, setSpeedtestHistory] = useState<SpeedTestHistoryResponse | null>(null);
  const [speedtestLoadingHistory, setSpeedtestLoadingHistory] = useState(false);
  const [speedtestClearing, setSpeedtestClearing] = useState(false);

  // Traffic history analytics sub-tab state
  const [netHistoryCatalog, setNetHistoryCatalog] = useState<NetHistoryResponse | null>(null);
  const [dnsTrafficStats, setDnsTrafficStats] = useState<DnsTrafficStatsResponse | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficFilterQuery, setTrafficFilterQuery] = useState('');
  const [domainsMode, setDomainsMode] = useState<'all' | 'blocked'>('all');

  // Map mode (Live vs History), multi-criteria filters & search
  const [mapMode, setMapMode] = useState<'live' | 'history'>('live');
  const [mapHistoryHours, setMapHistoryHours] = useState<'1' | '6' | '24' | '168' | 'all'>('24');
  const [mapFilter, setMapFilter] = useState<MapConnFilter>('all');
  const [mapDeviceFilter, setMapDeviceFilter] = useState<string>('all');
  const [mapServiceFilter, setMapServiceFilter] = useState<string>('all');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapHistoryData, setMapHistoryData] = useState<NetHistoryResponse | null>(null);
  const [mapHistoryLoading, setMapHistoryLoading] = useState(false);
  const [mapHistoryClearing, setMapHistoryClearing] = useState(false);
  const [mapZoomTick, setMapZoomTick] = useState(0);

  // Server-side Gemini AI connection identification & simplified presentation
  const [aiInsights, setAiInsights] = useState<Record<string, AiConnectionInsight>>(() => {
    try {
      const saved = sessionStorage.getItem(`recursos_ai_conn_insights_v1_${locale}`);
      return saved ? (JSON.parse(saved) as Record<string, AiConnectionInsight>) : {};
    } catch {
      return {};
    }
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLastModel, setAiLastModel] = useState<string | null>(null);
  const [aiSimplifiedView, setAiSimplifiedView] = useState(true);
  const [expandedTechKeys, setExpandedTechKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const mapped = resolveRedSubTab(initialSubTab);
    if (mapped) setSubTab(mapped);
  }, [initialSubTab, navTick]);

  // Logo picker modal
  const [logoModalClient, setLogoModalClient] = useState<WifiClient | null>(null);
  const [logoSearchQ, setLogoSearchQ] = useState('');
  const [logoResults, setLogoResults] = useState<LogoSearchResult[]>([]);
  const [logoSaving, setLogoSaving] = useState(false);

  useEffect(() => {
    if (!logoModalClient) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setLogoModalClient(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [logoModalClient]);

  // Map & GeoIP
  const [mapContainerEl, setMapContainerEl] = useState<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linesLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileLayerRef = useRef<any>(null);
  // Registro incremental para actualizar marcadores sin cerrar popups abiertos durante el refresco en vivo
  const markerRegistryRef = useRef<
    Map<
      string,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hitMarker: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        visMarker: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        badgeMarker?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pulseMarker?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lineLayer?: any;
        signature: string;
        lat: number;
        lng: number;
        cluster: DynamicGeoCluster;
      }
    >
  >(new Map());
  const activePopupStateRef = useRef<ActiveMapPopupState>({
    isOpen: false,
    clusterKey: null,
    selectedConnKey: null,
    remoteIp: null,
    representativeIp: null,
    clusterIps: [],
    lat: null,
    lng: null,
  });
  const isRedrawingMapRef = useRef(false);
  const handleBanIpRef = useRef<(ipToBan?: string, jailOverride?: string) => Promise<void>>(async () => {});
  const handleUnbanIpRef = useRef<(ip: string, jail?: string) => Promise<void>>(async () => {});
  const renderPopupHtmlForClusterRef = useRef<(cluster: DynamicGeoCluster, selectedConnKey: string | null) => string>(() => '');
  const [donutTooltip, setDonutTooltip] = useState<FloatingTooltipData | null>(null);

  // Fail2ban & Telegram
  const [banIpInput, setBanIpInput] = useState('');
  const [banJailInput, setBanJailInput] = useState('sshd');
  const [telegramData, setTelegramData] = useState<TelegramBotStatusPayload | null>(null);
  const [telegramMsg, setTelegramMsg] = useState('');

  // DuckDNS
  const [duckDns, setDuckDns] = useState<DuckDnsStatusPayload | null>(null);
  const [duckLogs, setDuckLogs] = useState<string[]>([]);
  const [duckUpdating, setDuckUpdating] = useState(false);

  const wifiClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    const list = metrics?.wifi_clients ?? [];
    const filtered = !q
      ? [...list]
      : list.filter(
          (c) =>
            String(c.name || '').toLowerCase().includes(q) ||
            String(c.hostname || '').toLowerCase().includes(q) ||
            String(c.ip || '').toLowerCase().includes(q) ||
            String(c.vendor || '').toLowerCase().includes(q)
        );
    filtered.sort((a, b) => {
      if (clientSort === 'name') {
        const na = String(a.name || a.hostname || a.ip || '').toLowerCase();
        const nb = String(b.name || b.hostname || b.ip || '').toLowerCase();
        return na.localeCompare(nb);
      }
      if (clientSort === 'up') {
        const ua = a.wan_speed_up ?? a.speed_up ?? 0;
        const ub = b.wan_speed_up ?? b.speed_up ?? 0;
        return ub - ua;
      }
      if (clientSort === 'lan') {
        const la = (a.lan_speed_down ?? 0) + (a.lan_speed_up ?? 0);
        const lb = (b.lan_speed_down ?? 0) + (b.lan_speed_up ?? 0);
        return lb - la;
      }
      const da = a.wan_speed_down ?? a.speed_down ?? 0;
      const db = b.wan_speed_down ?? b.speed_down ?? 0;
      return db - da;
    });
    return filtered;
  }, [metrics?.wifi_clients, clientQuery, clientSort]);

  const maxClientTotalBps = useMemo(() => {
    let peak = 1;
    for (const c of wifiClients) {
      const wanDown = c.wan_speed_down ?? c.speed_down ?? 0;
      const wanUp = c.wan_speed_up ?? c.speed_up ?? 0;
      const lanTotal = (c.lan_speed_down ?? 0) + (c.lan_speed_up ?? 0);
      const tot = wanDown + wanUp + lanTotal;
      if (tot > peak) peak = tot;
    }
    return peak;
  }, [wifiClients]);

  const pingLatency = metrics?.net?.ping_latency;
  const pingChartView = useMemo(() => {
    const targets = pingLatency?.targets ?? [];
    const timestamps = pingLatency?.timestamps ?? [];
    const epochTs = pingLatency?.epoch_ts ?? [];
    const series: ChartSeries[] = targets.map((tgt) => ({
      id: tgt.id,
      label: tgt.label,
      data: tgt.data ?? [],
      color: tgt.color,
      unit: 'ms',
      decimals: 2,
      fillAlpha: 0.12,
    }));
    const spec: ExpandChartSpec = {
      title: t('network.ping_latency_title'),
      subtitle: t('network.ping_latency_sub'),
      series,
      timestamps,
      epochTs,
      leftUnit: 'ms',
      chartKind: 'ping',
    };
    return { targets, timestamps, epochTs, series, expandSpec: spec };
  }, [pingLatency, t]);

  const interfaces: NetInterfaceInfo[] = useMemo(
    () => metrics?.net?.interfaces_list ?? Object.values(metrics?.net?.interfaces ?? {}),
    [metrics?.net?.interfaces_list, metrics?.net?.interfaces]
  );

  const nonRouterInterfaces = useMemo(
    () => interfaces.filter((nic) => nic.name.toLowerCase() !== 'router'),
    [interfaces]
  );

  const serverLocalIp = metrics?.net?.connections_map?.server_node?.ip || metrics?.net?.local_ip || metrics?.system?.local_ip || '';

  const liveGeoConnections = useMemo(() => {
    const list = metrics?.net?.connections_map?.connections ?? [];
    return list.filter((c) => !c.is_lan || c.is_server_node);
  }, [metrics?.net?.connections_map?.connections]);

  const loadMapHistory = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setMapHistoryLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '300');
      params.set('lang', locale);
      if (mapHistoryHours !== 'all') params.set('hours', mapHistoryHours);
      if (mapServiceFilter !== 'all') params.set('service', mapServiceFilter);
      if (mapDeviceFilter !== 'all') params.set('device', mapDeviceFilter);
      if (mapFilter !== 'all' && mapFilter !== 'blocked') params.set('direction', mapFilter);
      if (mapSearchQuery.trim()) params.set('q', mapSearchQuery.trim());

      const res = await apiFetchJson<NetHistoryResponse>(`/api/net/history?${params.toString()}`);
      if (res.ok && res.data) {
        setMapHistoryData(res.data);
        if (res.data.ai_insights && Object.keys(res.data.ai_insights).length > 0) {
          setAiInsights((prev) => ({ ...res.data!.ai_insights!, ...prev }));
        }
      }
      if (showSpinner) setMapHistoryLoading(false);
    },
    [locale, mapHistoryHours, mapServiceFilter, mapDeviceFilter, mapFilter, mapSearchQuery]
  );

  useEffect(() => {
    if (subTab !== 'map' || mapMode !== 'history') return;
    const debounced = window.setTimeout(() => {
      void loadMapHistory(true);
    }, 180);
    const intervalId = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        void loadMapHistory(false);
      }
    }, 15000);
    return () => {
      window.clearTimeout(debounced);
      window.clearInterval(intervalId);
    };
  }, [subTab, mapMode, loadMapHistory]);

  const handleClearMapHistory = async () => {
    setMapHistoryClearing(true);
    const res = await apiFetchJson<{ success?: boolean; message?: string }>('/api/net/history/clear', {
      method: 'POST',
    });
    setMapHistoryClearing(false);
    if (res.ok) {
      onNotify(t('network.map_history_cleared'));
      await loadMapHistory(true);
    } else {
      onNotify(res.error || t('status.signal_error'), true);
    }
  };

  // Persist AI insights per locale in sessionStorage cleanly (capped to 200 items)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`recursos_ai_conn_insights_v1_${locale}`);
      setAiInsights(saved ? (JSON.parse(saved) as Record<string, AiConnectionInsight>) : {});
    } catch {
      setAiInsights({});
    }
  }, [locale]);

  const rawGeoConnections = useMemo(() => {
    if (mapMode === 'history') {
      const srvNode = metrics?.net?.connections_map?.server_node;
      const histConns = (mapHistoryData?.connections ?? []).filter((c) => !c.is_lan || c.is_server_node);
      if (srvNode && !histConns.some((c) => c.is_server_node)) {
        return [{ ...srvNode, is_server_node: true }, ...histConns];
      }
      return histConns;
    }
    return liveGeoConnections;
  }, [mapMode, mapHistoryData?.connections, metrics?.net?.connections_map?.server_node, liveGeoConnections]);

  const bannedDetails = useMemo(
    () => metrics?.security?.fail2ban?.banned_details ?? [],
    [metrics?.security?.fail2ban?.banned_details]
  );

  const bannedIpSet = useMemo(() => {
    const set = new Set<string>();
    for (const b of bannedDetails) {
      if (b.ip) set.add(b.ip.trim());
    }
    for (const c of liveGeoConnections) {
      const ip = (c.remote_ip || c.ip || '').trim();
      if (ip && (c.direction === 'blocked' || c.state === 'BANNED')) {
        set.add(ip);
      }
    }
    for (const c of mapHistoryData?.connections ?? []) {
      const ip = (c.remote_ip || c.ip || '').trim();
      if (ip && (c.direction === 'blocked' || c.state === 'BANNED')) {
        set.add(ip);
      }
    }
    return set;
  }, [bannedDetails, liveGeoConnections, mapHistoryData?.connections]);

  const availableMapDevices = useMemo(() => {
    const devMap = new Map<string, { ip: string; label: string }>();
    for (const d of mapHistoryData?.devices_catalog ?? []) {
      const ip = String(d.ip || '').trim();
      if (!ip) continue;
      const nm = String(d.name || '').trim();
      devMap.set(ip, { ip, label: nm && nm !== ip ? `${nm} (${ip})` : ip });
    }
    for (const c of [...liveGeoConnections, ...(mapHistoryData?.connections ?? [])]) {
      if (c.is_server_node) continue;
      const ip = String(c.local_ip || '').trim();
      if (!ip) continue;
      const nm = String(c.local_hostname || '').trim();
      if (!devMap.has(ip) || (nm && devMap.get(ip)?.label === ip)) {
        devMap.set(ip, { ip, label: nm && nm !== ip ? `${nm} (${ip})` : ip });
      }
    }
    for (const w of metrics?.wifi_clients ?? []) {
      const ip = String(w.ip || '').trim();
      if (!ip) continue;
      const nm = String(w.name || w.hostname || '').trim();
      if (!devMap.has(ip)) {
        devMap.set(ip, { ip, label: nm && nm !== ip ? `${nm} (${ip})` : ip });
      }
    }
    return Array.from(devMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [mapHistoryData?.devices_catalog, mapHistoryData?.connections, liveGeoConnections, metrics?.wifi_clients]);

  const availableMapServices = useMemo(() => {
    const svcSet = new Set<string>();
    for (const s of mapHistoryData?.services_catalog ?? []) {
      const nm = String(s.service || '').trim();
      if (nm) svcSet.add(nm);
    }
    for (const c of [...liveGeoConnections, ...(mapHistoryData?.connections ?? [])]) {
      if (c.is_server_node) continue;
      const nm = String(c.service || '').trim();
      if (nm) svcSet.add(nm);
    }
    return Array.from(svcSet).sort((a, b) => a.localeCompare(b));
  }, [mapHistoryData?.services_catalog, mapHistoryData?.connections, liveGeoConnections]);

  const mapContextFiltered = useMemo(() => {
    const q = mapSearchQuery.trim().toLowerCase();
    return rawGeoConnections.filter((c) => {
      if (c.is_server_node) return true;
      if (mapDeviceFilter !== 'all' && String(c.local_ip || '').trim() !== mapDeviceFilter) {
        return false;
      }
      if (mapServiceFilter !== 'all' && String(c.service || '').trim() !== mapServiceFilter) {
        return false;
      }
      if (!q) return true;
      const ip = (c.remote_ip || c.ip || '').trim();
      const aiMatch = aiInsights[getConnAiSignature(c)];
      return (
        ip.toLowerCase().includes(q) ||
        String(c.domain || '').toLowerCase().includes(q) ||
        String(c.service || '').toLowerCase().includes(q) ||
        String(c.local_hostname || '').toLowerCase().includes(q) ||
        String(c.local_ip || '').toLowerCase().includes(q) ||
        String(c.city || '').toLowerCase().includes(q) ||
        String(c.country || '').toLowerCase().includes(q) ||
        String(c.isp || c.org || '').toLowerCase().includes(q) ||
        String(c.process || '').toLowerCase().includes(q) ||
        String(aiMatch?.app_name || '').toLowerCase().includes(q) ||
        String(aiMatch?.summary || '').toLowerCase().includes(q) ||
        String(aiMatch?.category || '').toLowerCase().includes(q)
      );
    });
  }, [rawGeoConnections, mapDeviceFilter, mapServiceFilter, mapSearchQuery, aiInsights]);

  const mapFilterCounts = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    let devices = 0;
    let blocked = 0;
    for (const c of mapContextFiltered) {
      if (c.is_server_node) continue;
      const ip = (c.remote_ip || c.ip || '').trim();
      const isBlk = c.direction === 'blocked' || c.state === 'BANNED' || (ip ? bannedIpSet.has(ip) : false);
      if (isBlk) blocked++;
      else if (c.direction === 'incoming') incoming++;
      else outgoing++;
      if (isHomeDeviceConn(c, serverLocalIp)) devices++;
    }
    return {
      all: mapContextFiltered.filter((c) => !c.is_server_node).length,
      incoming,
      outgoing,
      devices,
      blocked,
    };
  }, [mapContextFiltered, bannedIpSet, serverLocalIp]);

  const geoConnections = useMemo(() => {
    return mapContextFiltered.filter((c) => {
      if (c.is_server_node) return true;
      const ip = (c.remote_ip || c.ip || '').trim();
      const isBlk = c.direction === 'blocked' || c.state === 'BANNED' || (ip ? bannedIpSet.has(ip) : false);
      if (mapFilter === 'incoming' && (c.direction !== 'incoming' || isBlk)) return false;
      if (mapFilter === 'outgoing' && (c.direction === 'incoming' || isBlk)) return false;
      if (mapFilter === 'devices' && !isHomeDeviceConn(c, serverLocalIp)) return false;
      if (mapFilter === 'blocked' && !isBlk) return false;
      return true;
    });
  }, [mapContextFiltered, mapFilter, bannedIpSet, serverLocalIp]);

  const serviceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of geoConnections) {
      if (c.is_server_node) continue;
      const insight = aiSimplifiedView ? aiInsights[getConnAiSignature(c)] : undefined;
      const k = insight?.app_name || c.service || t('hardware.net.geo.direct_traffic');
      counts[k] = (counts[k] || 0) + 1;
    }
    const palette = ['#1e6b38', '#0e7490', '#4f46e5', '#d97706', '#2e8b47', '#be185d'];
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count], idx) => ({ name, count, color: palette[idx % palette.length] }));
  }, [geoConnections, aiInsights, aiSimplifiedView, t]);

  const handleSimplifyConnectionsWithAi = useCallback(async () => {
    const visibleConns = geoConnections.filter((c) => !c.is_server_node).slice(0, 36);
    if (visibleConns.length === 0) return;

    const batchPayload = visibleConns.slice(0, 24).map((c) => ({
      signature: getConnAiSignature(c),
      direction: c.direction || 'outgoing',
      protocol: c.protocol || 'TCP',
      local_ip: c.local_ip || '',
      local_hostname: c.local_hostname || '',
      local_port: Number(c.local_port || 0),
      remote_ip: (c.remote_ip || c.ip || '').trim(),
      remote_port: Number(c.remote_port || c.port || 0),
      domain: c.domain || '',
      service: c.service || '',
      process: c.process || '',
      isp: c.isp || c.org || '',
      asn: c.asn || '',
      city: c.city || '',
      country: c.country || '',
    }));

    setAiLoading(true);
    setAiError(null);
    const res = await apiFetchJson<AiIdentifyResponse>('/api/net/ai-identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: locale, connections: batchPayload }),
    });
    setAiLoading(false);

    if (res.data?.insights) {
      setAiInsights((prev) => {
        const merged = { ...prev, ...res.data!.insights };
        const entries = Object.entries(merged).slice(-200);
        const bounded = Object.fromEntries(entries);
        try {
          sessionStorage.setItem(`recursos_ai_conn_insights_v1_${locale}`, JSON.stringify(bounded));
        } catch {
          // Ignore quota issues
        }
        return bounded;
      });
    }

    if (res.ok && res.data?.ok) {
      setAiLastModel(res.data.model || null);
      setAiSimplifiedView(true);
      const count = Object.keys(res.data.insights || {}).length;
      if (count > 0) {
        onNotify(t('network.ai_identified_count', { count }));
      }
    } else {
      const errMsg =
        res.data?.code === 'GEMINI_API_KEY_MISSING'
          ? t('network.ai_error_missing_key')
          : res.data?.error || res.error || t('status.signal_error');
      setAiError(errMsg);
      onNotify(errMsg, true);
    }
  }, [geoConnections, locale, onNotify, t]);

  const loadSpeedtestData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSpeedtestLoadingHistory(true);
    const [stRes, histRes] = await Promise.all([
      apiFetchJson<SpeedTestStatus>('/api/net/speedtest/status'),
      apiFetchJson<SpeedTestHistoryResponse>('/api/net/speedtest/history?limit=100'),
    ]);
    if (stRes.ok && stRes.data) setSpeedtestStatus(stRes.data);
    if (histRes.ok && histRes.data) setSpeedtestHistory(histRes.data);
    if (showSpinner) setSpeedtestLoadingHistory(false);
  }, []);

  const loadTrafficAnalytics = useCallback(async (showSpinner = false) => {
    if (showSpinner) setTrafficLoading(true);
    const [histRes, dnsRes] = await Promise.all([
      apiFetchJson<NetHistoryResponse>(`/api/net/history?limit=400&lang=${encodeURIComponent(locale)}`),
      apiFetchJson<DnsTrafficStatsResponse>('/api/dns/traffic?limit=80'),
    ]);
    if (histRes.ok && histRes.data) {
      setNetHistoryCatalog(histRes.data);
      if (histRes.data.ai_insights && Object.keys(histRes.data.ai_insights).length > 0) {
        setAiInsights((prev) => ({ ...histRes.data!.ai_insights!, ...prev }));
      }
    }
    if (dnsRes.ok && dnsRes.data) setDnsTrafficStats(dnsRes.data);
    if (showSpinner) setTrafficLoading(false);
  }, [locale]);

  const network24hView = useMemo(() => {
    const dbSeries = netHistory24h?.series;
    const dbRx = dbSeries?.net_rx ?? [];
    const useFallbackLive = dbRx.length < 2 && (metrics?.history?.net_rx?.length ?? 0) >= 2;
    const sourceSeries = useFallbackLive ? metrics?.history : dbSeries;

    const rxTotal = sourceSeries?.net_rx ?? [];
    const txTotal = sourceSeries?.net_tx ?? [];
    const wanRxData = sourceSeries?.net_wan_rx?.length ? sourceSeries.net_wan_rx : rxTotal;
    const wanTxData = sourceSeries?.net_wan_tx?.length ? sourceSeries.net_wan_tx : txTotal;
    const lanRxData = sourceSeries?.net_lan_rx?.length ? sourceSeries.net_lan_rx : rxTotal.map(() => 0);
    const lanTxData = sourceSeries?.net_lan_tx?.length ? sourceSeries.net_lan_tx : txTotal.map(() => 0);

    const timestamps = sourceSeries?.timestamps ?? [];
    const dateTimestamps = sourceSeries?.date_timestamps ?? [];
    const epochTs = sourceSeries?.epoch_ts ?? [];

    const peakWanRxMb = wanRxData.length > 0 ? Math.max(...wanRxData) : 0;
    const peakWanTxMb = wanTxData.length > 0 ? Math.max(...wanTxData) : 0;
    const peakLanRxMb = lanRxData.length > 0 ? Math.max(...lanRxData) : 0;
    const peakLanTxMb = lanTxData.length > 0 ? Math.max(...lanTxData) : 0;

    const series: ChartSeries[] = [
      {
        id: 'net_wan_rx_24h',
        metricKey: 'net_wan_rx',
        label: t('hardware.net.wan_download'),
        data: wanRxData,
        color: theme === 'dark' ? '#c6f19d' : '#1e6b38',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.16,
      },
      {
        id: 'net_wan_tx_24h',
        metricKey: 'net_wan_tx',
        label: t('hardware.net.wan_upload'),
        data: wanTxData,
        color: '#10b981',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.08,
      },
      {
        id: 'net_lan_rx_24h',
        metricKey: 'net_lan_rx',
        label: t('hardware.net.lan_download'),
        data: lanRxData,
        color: '#6366f1',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.10,
      },
      {
        id: 'net_lan_tx_24h',
        metricKey: 'net_lan_tx',
        label: t('hardware.net.lan_upload'),
        data: lanTxData,
        color: '#f59e0b',
        unit: 'MB/s',
        decimals: 2,
        fillAlpha: 0.06,
      },
    ];

    return {
      series,
      wanRxData,
      wanTxData,
      lanRxData,
      lanTxData,
      timestamps,
      dateTimestamps,
      epochTs,
      sampleCount: Math.max(wanRxData.length, wanTxData.length, lanRxData.length, lanTxData.length),
      peakWanRxMb,
      peakWanTxMb,
      peakLanRxMb,
      peakLanTxMb,
    };
  }, [netHistory24h, metrics?.history, theme, t]);

  const openNetwork24hExpanded = useCallback(() => {
    if (!onExpandChart) return;
    onExpandChart({
      title: t('overview.net_history_24h_title'),
      subtitle: t('overview.net_history_24h_sub'),
      series: network24hView.series,
      timestamps: network24hView.timestamps,
      epochTs: network24hView.epochTs,
      leftUnit: 'MB/s',
      chartKind: 'net',
    });
  }, [onExpandChart, network24hView.series, network24hView.timestamps, network24hView.epochTs, t]);

  const topDomains = useMemo(() => {
    const q = trafficFilterQuery.trim().toLowerCase();
    const map = new Map<
      string,
      {
        domain: string;
        count: number;
        blockedCount: number;
        pctBlocked: number;
        uniqueIps: number;
        clientsCount: number;
        service: string;
        country: string;
        avgReplyMs: number | null;
        isPiholeSource: boolean;
      }
    >();

    for (const d of dnsTrafficStats?.top_domains ?? []) {
      const dom = String(d.domain || '').trim().toLowerCase();
      if (!dom) continue;
      const cnt = Number(d.count || 0);
      const blk = Number(d.blocked_count || 0);
      map.set(dom, {
        domain: dom,
        count: cnt,
        blockedCount: blk,
        pctBlocked: Number(d.pct_blocked ?? (cnt > 0 ? Math.round((blk / cnt) * 1000) / 10 : 0)),
        uniqueIps: 0,
        clientsCount: Number(d.clients_count || 0),
        service: '',
        country: '',
        avgReplyMs: typeof d.avg_reply_ms === 'number' ? d.avg_reply_ms : null,
        isPiholeSource: true,
      });
    }

    for (const d of netHistoryCatalog?.domains_catalog ?? []) {
      const dom = String(d.domain || '').trim().toLowerCase();
      if (!dom) continue;
      const cur = map.get(dom);
      const hits = Number(d.total_hits ?? d.connections_count ?? 0);
      if (cur) {
        cur.uniqueIps = Math.max(cur.uniqueIps, Number(d.unique_ips || 0));
        cur.clientsCount = Math.max(cur.clientsCount, Number(d.unique_devices || 0));
        if (!cur.service && d.top_service) cur.service = d.top_service;
        if (!cur.country && d.top_country) cur.country = d.top_country;
        if (hits > cur.count) cur.count = hits;
      } else {
        map.set(dom, {
          domain: dom,
          count: hits,
          blockedCount: 0,
          pctBlocked: 0,
          uniqueIps: Number(d.unique_ips || 0),
          clientsCount: Number(d.unique_devices || 0),
          service: d.top_service || '',
          country: d.top_country || '',
          avgReplyMs: null,
          isPiholeSource: false,
        });
      }
    }

    for (const c of rawGeoConnections) {
      if (c.is_server_node || c.is_lan) continue;
      const dom = String(c.domain || '').trim().toLowerCase();
      if (!dom) continue;
      const cur = map.get(dom);
      const isBlocked = c.direction === 'blocked' || c.state === 'BANNED';
      if (cur) {
        if (!cur.isPiholeSource) cur.count = Math.max(cur.count, 1);
        if (isBlocked && cur.blockedCount === 0) {
          cur.blockedCount = 1;
          cur.pctBlocked = Math.round((1 / Math.max(1, cur.count)) * 1000) / 10;
        }
        if (!cur.service && c.service) cur.service = c.service;
        if (!cur.country && c.country) cur.country = c.country;
      } else {
        map.set(dom, {
          domain: dom,
          count: 1,
          blockedCount: isBlocked ? 1 : 0,
          pctBlocked: isBlocked ? 100 : 0,
          uniqueIps: 1,
          clientsCount: 1,
          service: c.service || '',
          country: c.country || '',
          avgReplyMs: null,
          isPiholeSource: false,
        });
      }
    }

    let items = Array.from(map.values());
    if (domainsMode === 'blocked') {
      items = items.filter((item) => item.blockedCount > 0);
    }
    if (q) {
      items = items.filter(
        (item) =>
          item.domain.includes(q) ||
          item.service.toLowerCase().includes(q) ||
          item.country.toLowerCase().includes(q)
      );
    }
    items.sort((a, b) => (domainsMode === 'blocked' ? b.blockedCount - a.blockedCount : b.count - a.count));
    return items.slice(0, 12);
  }, [dnsTrafficStats?.top_domains, netHistoryCatalog?.domains_catalog, rawGeoConnections, domainsMode, trafficFilterQuery]);

  const topServices = useMemo(() => {
    const q = trafficFilterQuery.trim().toLowerCase();
    const map = new Map<
      string,
      { service: string; hitCount: number; ipsCount: number; devicesCount: number; protocols: string[] }
    >();

    for (const s of netHistoryCatalog?.services_catalog ?? []) {
      const name = String(s.service || '').trim();
      if (!name) continue;
      const hits = Number(s.hit_count ?? s.total_hits ?? s.connections_count ?? 0);
      map.set(name.toLowerCase(), {
        service: name,
        hitCount: hits,
        ipsCount: Number(s.unique_ips || 0),
        devicesCount: Number(s.unique_devices ?? s.device_count ?? 0),
        protocols: [],
      });
    }

    const liveIpsBySvc = new Map<string, Set<string>>();
    const liveDevsBySvc = new Map<string, Set<string>>();
    const liveHitsBySvc = new Map<string, number>();
    const liveProtosBySvc = new Map<string, Set<string>>();
    const liveCanonicalName = new Map<string, string>();

    for (const c of rawGeoConnections) {
      if (c.is_server_node || c.is_lan) continue;
      const svcName = String(c.service || t('hardware.net.geo.direct_traffic')).trim();
      const key = svcName.toLowerCase();
      liveCanonicalName.set(key, svcName);
      liveHitsBySvc.set(key, (liveHitsBySvc.get(key) || 0) + 1);
      if (c.remote_ip || c.ip) {
        const set = liveIpsBySvc.get(key) ?? new Set<string>();
        set.add(String(c.remote_ip || c.ip));
        liveIpsBySvc.set(key, set);
      }
      if (c.local_hostname || c.local_ip) {
        const set = liveDevsBySvc.get(key) ?? new Set<string>();
        set.add(String(c.local_hostname || c.local_ip));
        liveDevsBySvc.set(key, set);
      }
      if (c.protocol) {
        const set = liveProtosBySvc.get(key) ?? new Set<string>();
        set.add(String(c.protocol).toUpperCase());
        liveProtosBySvc.set(key, set);
      }
    }

    for (const [key, liveHits] of liveHitsBySvc.entries()) {
      const existing = map.get(key);
      const ipsCnt = liveIpsBySvc.get(key)?.size ?? 0;
      const devsCnt = liveDevsBySvc.get(key)?.size ?? 0;
      const protos = Array.from(liveProtosBySvc.get(key) ?? []);
      if (existing) {
        existing.hitCount = Math.max(existing.hitCount, liveHits);
        existing.ipsCount = Math.max(existing.ipsCount, ipsCnt);
        existing.devicesCount = Math.max(existing.devicesCount, devsCnt);
        if (existing.protocols.length === 0 && protos.length > 0) existing.protocols = protos;
      } else {
        map.set(key, {
          service: liveCanonicalName.get(key) || key,
          hitCount: liveHits,
          ipsCount: ipsCnt,
          devicesCount: devsCnt,
          protocols: protos,
        });
      }
    }

    let items = Array.from(map.values());
    if (q) {
      items = items.filter(
        (item) =>
          item.service.toLowerCase().includes(q) ||
          item.protocols.some((p) => p.toLowerCase().includes(q))
      );
    }
    items.sort((a, b) => b.hitCount - a.hitCount);
    return items.slice(0, 10);
  }, [netHistoryCatalog?.services_catalog, rawGeoConnections, trafficFilterQuery, t]);

  const topCountries = useMemo(() => {
    const q = trafficFilterQuery.trim().toLowerCase();
    const map = new Map<
      string,
      { country: string; countryCode: string; hitCount: number; uniqueIps: number; citiesCount: number; flag: string }
    >();

    for (const c of netHistoryCatalog?.countries_catalog ?? []) {
      const code = String(c.country_code || '').trim().toUpperCase();
      const rawName = String(c.country || '').trim();
      if (!rawName && !code) continue;
      const key = (code || rawName).toLowerCase();
      const localized = localizeCountryName(rawName, code, locale);
      map.set(key, {
        country: localized,
        countryCode: code,
        hitCount: Number(c.total_hits ?? c.connections_count ?? 0),
        uniqueIps: Number(c.unique_ips || 0),
        citiesCount: Number(c.cities_count || 0),
        flag: countryCodeToFlag(code),
      });
    }

    const liveHits = new Map<string, number>();
    const liveIps = new Map<string, Set<string>>();
    const liveCities = new Map<string, Set<string>>();
    const liveMeta = new Map<string, { rawName: string; code: string }>();

    for (const c of rawGeoConnections) {
      if (c.is_server_node || c.is_lan) continue;
      const code = String(c.country_code || '').trim().toUpperCase();
      const rawName = String(c.country || '').trim();
      if (!rawName && !code) continue;
      const key = (code || rawName).toLowerCase();
      liveMeta.set(key, { rawName: rawName || code, code });
      liveHits.set(key, (liveHits.get(key) || 0) + 1);
      if (c.remote_ip || c.ip) {
        const s = liveIps.get(key) ?? new Set<string>();
        s.add(String(c.remote_ip || c.ip));
        liveIps.set(key, s);
      }
      if (c.city) {
        const s = liveCities.get(key) ?? new Set<string>();
        s.add(String(c.city));
        liveCities.set(key, s);
      }
    }

    for (const [key, hits] of liveHits.entries()) {
      const meta = liveMeta.get(key);
      const ipsCnt = liveIps.get(key)?.size ?? 0;
      const citiesCnt = liveCities.get(key)?.size ?? 0;
      const existing = map.get(key);
      if (existing) {
        existing.hitCount = Math.max(existing.hitCount, hits);
        existing.uniqueIps = Math.max(existing.uniqueIps, ipsCnt);
        existing.citiesCount = Math.max(existing.citiesCount, citiesCnt);
      } else if (meta) {
        map.set(key, {
          country: localizeCountryName(meta.rawName, meta.code, locale),
          countryCode: meta.code,
          hitCount: hits,
          uniqueIps: ipsCnt,
          citiesCount: citiesCnt,
          flag: countryCodeToFlag(meta.code),
        });
      }
    }

    let items = Array.from(map.values());
    if (q) {
      items = items.filter(
        (item) => item.country.toLowerCase().includes(q) || item.countryCode.toLowerCase().includes(q)
      );
    }
    items.sort((a, b) => b.hitCount - a.hitCount);
    const totalHits = Math.max(1, items.reduce((acc, it) => acc + it.hitCount, 0));
    return items.slice(0, 10).map((it) => ({
      ...it,
      sharePct: Math.round((it.hitCount / totalHits) * 1000) / 10,
    }));
  }, [netHistoryCatalog?.countries_catalog, rawGeoConnections, trafficFilterQuery, locale]);

  const networkCuriosities = useMemo(() => {
    // 1. Farthest GeoIP node & speed of light in silica fiber (~204,200 km/s)
    const serverNode = metrics?.net?.connections_map?.server_node;
    const serverLat = Number(serverNode?.lat);
    const serverLng = Number(serverNode?.lng);
    let farthestKm = 0;
    let farthestTarget = '';

    if (Number.isFinite(serverLat) && Number.isFinite(serverLng)) {
      for (const c of rawGeoConnections) {
        if (c.is_server_node || c.is_lan) continue;
        const cLat = Number(c.lat);
        const cLng = Number(c.lng);
        if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
        const km = haversineKm(serverLat, serverLng, cLat, cLng);
        if (km > farthestKm) {
          farthestKm = km;
          const localizedCountry = localizeCountryName(c.country || '', c.country_code, locale);
          const place = [c.city, localizedCountry].filter(Boolean).join(', ');
          farthestTarget = c.domain || c.service || place || c.remote_ip || c.ip || '';
          if (place && (c.domain || c.service)) {
            farthestTarget = `${c.domain || c.service} · ${place}`;
          }
        }
      }
    }
    const farthestRoundedKm = Math.round(farthestKm);
    const lightFiberRttMs = farthestRoundedKm > 0 ? ((farthestRoundedKm * 2) / 204.2).toFixed(1) : '0.0';

    // 2. Integrated 24h traffic volume (WAN vs LAN) + HD 1080p stream mathematical equivalence
    const { wanRxData, wanTxData, lanRxData, lanTxData, timestamps, epochTs } = network24hView;
    const len = Math.max(wanRxData.length, wanTxData.length, lanRxData.length, lanTxData.length);
    let totalWanBytes = 0;
    let totalLanBytes = 0;
    let totalRxWeight = 0;
    let totalTxWeight = 0;
    let peakMb = 0;
    let peakTime = '--:--';

    for (let i = 0; i < len; i++) {
      const wr = Number(wanRxData[i] || 0);
      const wt = Number(wanTxData[i] || 0);
      const lr = Number(lanRxData[i] || 0);
      const lt = Number(lanTxData[i] || 0);
      const totMb = wr + wt + lr + lt;
      if (totMb >= peakMb) {
        peakMb = totMb;
        peakTime = timestamps[i] || '--:--';
      }
      totalRxWeight += wr + lr;
      totalTxWeight += wt + lt;

      let dt = 300;
      if (i > 0 && Number.isFinite(epochTs[i]) && Number.isFinite(epochTs[i - 1])) {
        const diff = Number(epochTs[i]) - Number(epochTs[i - 1]);
        if (diff > 0 && diff <= 1800) dt = diff;
      } else if (len > 1 && i === 0 && Number.isFinite(epochTs[1]) && Number.isFinite(epochTs[0])) {
        const diff = Number(epochTs[1]) - Number(epochTs[0]);
        if (diff > 0 && diff <= 1800) dt = diff;
      }
      totalWanBytes += (wr + wt) * 1024 * 1024 * dt;
      totalLanBytes += (lr + lt) * 1024 * 1024 * dt;
    }

    const combinedBytes = totalWanBytes + totalLanBytes;
    const wanPct = combinedBytes > 0 ? Math.round((totalWanBytes / combinedBytes) * 100) : 0;
    const lanPct = combinedBytes > 0 ? Math.max(0, 100 - wanPct) : 0;
    const combinedGb = combinedBytes / (1024 * 1024 * 1024);
    const hdHours = (combinedGb / 2.25).toFixed(1);
    const dlUlRatio =
      totalTxWeight > 0.001
        ? (totalRxWeight / totalTxWeight).toFixed(1)
        : totalRxWeight > 0
          ? '∞'
          : '1.0';

    // 3. Global footprint & shield (countries, ISPs/ASNs, blocked DNS + Fail2ban)
    const ispSet = new Set<string>();
    const countrySet = new Set<string>();
    for (const c of rawGeoConnections) {
      if (c.is_server_node || c.is_lan) continue;
      if (c.isp || c.org) ispSet.add(String(c.isp || c.org).trim());
      if (c.country_code || c.country) countrySet.add(String(c.country_code || c.country).trim().toLowerCase());
    }
    const countriesCount = Math.max(countrySet.size, netHistoryCatalog?.summary?.total_countries ?? topCountries.length);
    const blockedTotal =
      Number(dnsTrafficStats?.summary?.blocked_queries_24h ?? metrics?.security?.pihole?.blocked_today ?? 0) +
      Number(bannedDetails.length ?? 0);

    return {
      farthestKm: farthestRoundedKm,
      lightFiberRttMs,
      farthestTarget,
      hasVolume: len >= 2 && combinedBytes > 0,
      combinedBytes,
      wanPct,
      lanPct,
      hdHours,
      peakMb,
      peakTime,
      dlUlRatio,
      countriesCount,
      ispsCount: ispSet.size,
      blockedTotal,
    };
  }, [
    metrics?.net?.connections_map?.server_node,
    metrics?.security?.pihole?.blocked_today,
    rawGeoConnections,
    locale,
    network24hView,
    netHistoryCatalog?.summary?.total_countries,
    topCountries.length,
    dnsTrafficStats?.summary?.blocked_queries_24h,
    bannedDetails.length,
  ]);

  // Load Speedtest, Traffic Analytics, Telegram & DuckDNS on tab switch
  useEffect(() => {
    if (subTab === 'speedtest') {
      void loadSpeedtestData(true);
    } else if (subTab === 'traffic') {
      void loadTrafficAnalytics(true);
      const id = window.setInterval(() => {
        if (typeof document === 'undefined' || !document.hidden) {
          void loadTrafficAnalytics(false);
        }
      }, 15000);
      return () => window.clearInterval(id);
    } else if (subTab === 'security') {
      void apiFetchJson<TelegramBotStatusPayload>('/api/telegram_bot').then((r) => {
        if (r.ok && r.data) setTelegramData(r.data);
      });
    } else if (subTab === 'dns') {
      void apiFetchJson<DuckDnsStatusPayload>('/api/dns/duckdns').then((r) => {
        if (r.ok && r.data) setDuckDns(r.data);
      });
      void apiFetchJson<{ logs?: string[] }>('/api/dns/logs').then((r) => {
        if (r.ok && Array.isArray(r.data?.logs)) {
          const cleanLogs = r.data.logs
            .map((line) => String(line || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, '').trim())
            .filter(Boolean);
          setDuckLogs(cleanLogs);
        }
      });
    }
  }, [subTab, loadSpeedtestData, loadTrafficAnalytics]);

  // Poll speedtest status smoothly while test is active
  useEffect(() => {
    if (!speedtestStatus?.running) return;
    const id = window.setInterval(() => {
      void apiFetchJson<SpeedTestStatus>('/api/net/speedtest/status').then((r) => {
        if (!r.ok || !r.data) return;
        setSpeedtestStatus(r.data);
        if (!r.data.running) {
          void apiFetchJson<SpeedTestHistoryResponse>('/api/net/speedtest/history?limit=100').then((hr) => {
            if (hr.ok && hr.data) setSpeedtestHistory(hr.data);
            if (r.data?.phase === 'done') {
              const latestResult: SpeedTestResult | null | undefined =
                r.data.last_result ?? hr.data?.items?.[0];
              const { user: activeFbUser, autoSync: isAuto, hostname, syncSpeedTestRecord: pushRecord } =
                fbSyncRef.current;
              if (latestResult && activeFbUser && isAuto) {
                const dedupKey = `${latestResult.id}_${latestResult.ts}`;
                if (lastSyncedSpeedtestIdRef.current !== dedupKey) {
                  lastSyncedSpeedtestIdRef.current = dedupKey;
                  void pushRecord(latestResult, hostname).catch((err) => {
                    console.error('Firebase speedtest sync error:', err);
                  });
                }
              }
            }
          });
          if (r.data.phase === 'done') {
            onNotify(t('network.speedtest_completed'));
          } else if (r.data.phase === 'error' && r.data.error) {
            onNotify(r.data.error, true);
          }
        }
      });
    }, 450);
    return () => window.clearInterval(id);
  }, [speedtestStatus?.running, onNotify, t]);

  const handleStartSpeedtest = async () => {
    if (speedtestStatus?.running) return;
    const res = await apiFetchJson<{ ok?: boolean; running?: boolean; status?: SpeedTestStatus }>('/api/net/speedtest/run', { method: 'POST' });
    if (res.ok && res.data?.status) {
      setSpeedtestStatus(res.data.status);
    } else if (res.ok && (res.data?.running || res.data?.ok)) {
      setSpeedtestStatus((prev) => ({
        ok: true,
        running: true,
        phase: 'ping',
        progress_pct: 6,
        current_mbps: 0,
        ping_ms: prev?.ping_ms ?? 0,
        jitter_ms: prev?.jitter_ms ?? 0,
        packet_loss_pct: prev?.packet_loss_pct ?? 0,
        download_mbps: 0,
        upload_mbps: 0,
        server_name: prev?.server_name ?? '',
        server_host: prev?.server_host ?? '',
        server_location: prev?.server_location ?? '',
        client_ip: prev?.client_ip ?? '',
        isp: prev?.isp ?? '',
        scope: prev?.scope ?? 'wan',
        error: '',
      }));
      void loadSpeedtestData(false);
    } else {
      onNotify(res.error || t('status.signal_error'), true);
    }
  };

  const handleClearSpeedtestHistory = async (entryId?: number) => {
    setSpeedtestClearing(true);
    const url = entryId !== undefined ? `/api/net/speedtest/history?id=${entryId}` : '/api/net/speedtest/history';
    const res = await apiFetchJson<{ ok?: boolean }>(url, { method: 'DELETE' });
    setSpeedtestClearing(false);
    if (res.ok) {
      if (entryId === undefined) onNotify(t('network.speedtest_cleared'));
      await loadSpeedtestData(false);
    } else {
      onNotify(res.error || t('status.signal_error'), true);
    }
  };

  // Generador de HTML Maestro-Detalle para Popups de Grupos y Conexiones (v4.10.0, v4.11.0, v4.12.0, v10.4.0)
  const renderPopupHtmlForCluster = (cluster: DynamicGeoCluster, selectedConnKey: string | null): string => {
    const { isNode, items } = cluster;
    const primary = items[0] || {};
    const placeName = [primary.city, primary.country].filter(Boolean).join(', ') || t('hardware.net.geo.location_fallback');

    if (isNode) {
      const srvIp = escapeMapHtml(primary.public_ip || primary.ip || serverLocalIp || '--');
      const locIp = escapeMapHtml(primary.ip || serverLocalIp || '--');
      const org = escapeMapHtml(primary.org || primary.isp || metrics?.system?.hostname || 'Servidor');
      return `<div style="min-width:235px;max-width:320px;font-size:12px;line-height:1.4;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <strong style="font-size:12.5px;color:#10b981;">● ${escapeMapHtml(t('network.map_server_node_title'))}</strong>
          <span style="background:rgba(16,185,129,0.16);color:#10b981;border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700;font-family:ui-monospace,monospace;">HOST</span>
        </div>
        <div style="font-weight:600;margin-bottom:4px;">${escapeMapHtml(placeName)}</div>
        <div style="font-family:ui-monospace,monospace;font-size:11px;opacity:.9;">WAN: ${srvIp} · LAN: ${locIp}</div>
        <div style="font-size:11px;opacity:.75;margin-top:2px;">${org}</div>
      </div>`;
    }

    const count = items.length;
    const effectiveSelectedKey =
      count === 1
        ? getConnIdentityKey(items[0], 0)
        : selectedConnKey && items.some((c, i) => getConnIdentityKey(c, i) === selectedConnKey)
          ? selectedConnKey
          : null;

    if (effectiveSelectedKey) {
      const idx = items.findIndex((c, i) => getConnIdentityKey(c, i) === effectiveSelectedKey);
      const c = items[idx >= 0 ? idx : 0];
      const remoteIp = (c.remote_ip || c.ip || '').trim();
      const isBlocked = c.direction === 'blocked' || c.state === 'BANNED' || (remoteIp ? bannedIpSet.has(remoteIp) : false);
      const dirBadge = isBlocked
        ? `<span style="background:rgba(239,68,68,0.16);color:#ef4444;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;">${escapeMapHtml(t('network.map_direction_blocked'))}</span>`
        : c.direction === 'incoming'
          ? `<span style="background:rgba(16,185,129,0.16);color:#10b981;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;">${escapeMapHtml(t('network.map_direction_in'))}</span>`
          : `<span style="background:rgba(30,107,56,0.16);color:#1e6b38;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;">${escapeMapHtml(t('network.map_direction_out'))}</span>`;

      const aiInsight = aiSimplifiedView ? aiInsights[getConnAiSignature(c)] : undefined;
      const svc = escapeMapHtml(aiInsight?.app_name || c.service || t('hardware.net.geo.conn_generic'));
      const domain = c.domain ? escapeMapHtml(c.domain) : '';
      const localHost = escapeMapHtml(c.local_hostname || (c.local_ip === serverLocalIp ? 'Servidor' : c.local_ip || 'Servidor'));
      const localEndpoint = escapeMapHtml(`${c.local_ip || serverLocalIp || ''}${c.local_port ? `:${c.local_port}` : ''}`);
      const remoteEndpoint = escapeMapHtml(`${remoteIp}${c.remote_port || c.port ? `:${c.remote_port || c.port}` : ''}`);
      const proc = escapeMapHtml(c.process || c.protocol || 'TCP');
      const orgAsn = escapeMapHtml([c.isp || c.org, c.asn].filter(Boolean).join(' · ') || '--');
      const rxSpd = escapeMapHtml(formatSpeed(c.rx_speed || 0));
      const txSpd = escapeMapHtml(formatSpeed(c.tx_speed || 0));
      const totBytes = escapeMapHtml(formatBytes(c.bytes_total ?? ((c.bytes_received || 0) + (c.bytes_sent || 0))));
      const defJail = inferDefaultJail(c);

      const historyBadgeHtml =
        c.is_history && c.hit_count
          ? `<div style="margin-bottom:5px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:3px 7px;border-radius:7px;background:rgba(245,158,11,0.12);color:#d97706;font-size:10px;font-weight:700;">
              <span>🕒 ${escapeMapHtml(t('network.map_hits_badge', { count: c.hit_count }))}</span>
              ${c.last_seen ? `<span style="font-family:ui-monospace,monospace;">${escapeMapHtml(new Date(c.last_seen * 1000).toLocaleString(locale === 'es' ? 'es-ES' : locale))}</span>` : ''}
            </div>`
          : '';

      const aiBannerHtml = aiInsight
        ? `<div style="margin-bottom:6px;padding:6px 8px;border-radius:9px;background:rgba(30,107,56,0.12);border:1px solid rgba(30,107,56,0.28);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:2px;">
              <span style="font-size:10px;font-weight:800;color:#1e6b38;">✨ ${escapeMapHtml(aiInsight.category)}</span>
              <span style="font-size:10px;opacity:.78;">${escapeMapHtml(aiInsight.role)}</span>
            </div>
            <div style="font-size:11px;font-weight:500;line-height:1.35;">${escapeMapHtml(aiInsight.summary)}</div>
          </div>`
        : '';

      const backBtnHtml =
        count > 1
          ? `<button type="button" data-back-cluster="${escapeMapHtml(cluster.key)}" style="margin-bottom:7px;display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(30,107,56,0.35);background:rgba(30,107,56,0.1);color:#1e6b38;border-radius:8px;padding:3px 9px;font-size:10.5px;font-weight:700;cursor:pointer;width:100%;justify-content:center;">${escapeMapHtml(t('network.map_back_to_list', { count }))}</button>`
          : '';

      const actionHtml = remoteIp
        ? isBlocked
          ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(148,163,184,0.22);display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span style="font-size:10.5px;opacity:.8;">${escapeMapHtml(t('network.rule_label', { jail: c.jail || 'sshd' }))}</span>
              <button type="button" data-unban-ip="${escapeMapHtml(remoteIp)}" data-unban-jail="${escapeMapHtml(c.jail || 'all')}" style="border:1px solid rgba(16,185,129,0.45);background:rgba(16,185,129,0.14);color:#10b981;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;">${escapeMapHtml(t('network.unblock'))}</button>
            </div>`
          : `<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(148,163,184,0.22);display:flex;align-items:center;gap:6px;">
              <select data-jail-select="${escapeMapHtml(remoteIp)}" style="flex:1;border:1px solid rgba(148,163,184,0.35);background:transparent;color:inherit;border-radius:7px;padding:3px 6px;font-size:10.5px;">
                <option value="sshd" ${defJail === 'sshd' ? 'selected' : ''}>${escapeMapHtml(t('network.jail_ssh'))}</option>
                <option value="caddy-scan" ${defJail === 'caddy-scan' ? 'selected' : ''}>${escapeMapHtml(t('network.jail_caddy'))}</option>
                <option value="all" ${defJail === 'all' ? 'selected' : ''}>${escapeMapHtml(t('network.jail_all'))}</option>
              </select>
              <button type="button" data-ban-ip="${escapeMapHtml(remoteIp)}" style="border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.14);color:#ef4444;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;">${escapeMapHtml(t('network.block'))}</button>
            </div>`
        : '';

      return `<div style="min-width:255px;max-width:335px;font-size:12px;line-height:1.38;">
        ${backBtnHtml}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">
          <strong style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${svc}</strong>
          ${dirBadge}
        </div>
        ${aiBannerHtml}
        ${historyBadgeHtml}
        <div style="font-size:11px;opacity:.78;margin-bottom:6px;">📍 ${escapeMapHtml(placeName)} · 📱 ${localHost}</div>
        ${
          domain && !aiInsight
            ? `<div style="margin-bottom:4px;padding:3px 7px;border-radius:7px;background:rgba(30,107,56,0.1);font-family:ui-monospace,monospace;font-size:11px;color:#1e6b38;word-break:break-all;">🌐 ${domain}</div>`
            : ''
        }
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10.5px;margin-bottom:6px;">
          <div style="padding:4px 6px;border-radius:7px;background:rgba(148,163,184,0.1);">
            <div style="opacity:.68;">${escapeMapHtml(t('network.map_source_device'))}</div>
            <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${localHost}</div>
            <div style="font-family:ui-monospace,monospace;font-size:10px;opacity:.8;">${localEndpoint}</div>
          </div>
          <div style="padding:4px 6px;border-radius:7px;background:rgba(148,163,184,0.1);">
            <div style="opacity:.68;">${escapeMapHtml(t('network.map_process_label'))}</div>
            <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${proc}</div>
            <div style="font-family:ui-monospace,monospace;font-size:10px;opacity:.8;">${remoteEndpoint}</div>
          </div>
        </div>
        ${domain && aiInsight ? `<div style="font-family:ui-monospace,monospace;font-size:10px;opacity:.72;margin-bottom:3px;word-break:break-all;">🌐 ${domain}</div>` : ''}
        <div style="font-size:10.5px;opacity:.78;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🏢 ${orgAsn}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:5px 6px;border-radius:8px;background:rgba(148,163,184,0.12);font-family:ui-monospace,monospace;font-size:10.5px;text-align:center;">
          <div>
            <div style="font-size:9.5px;opacity:.7;">${escapeMapHtml(t('network.map_traffic_rx'))}</div>
            <div style="font-weight:700;color:#10b981;">${rxSpd}</div>
          </div>
          <div>
            <div style="font-size:9.5px;opacity:.7;">${escapeMapHtml(t('network.map_traffic_tx'))}</div>
            <div style="font-weight:700;color:#1e6b38;">${txSpd}</div>
          </div>
          <div>
            <div style="font-size:9.5px;opacity:.7;">${escapeMapHtml(t('network.map_traffic_total'))}</div>
            <div style="font-weight:700;color:#f59e0b;">${totBytes}</div>
          </div>
        </div>
        ${actionHtml}
      </div>`;
    }

    // Vista Lista de IPs del grupo (count > 1) con selección interactiva (v4.11.0 + IA + Historial)
    const rowsHtml = items
      .map((c, idx) => {
        const connKey = getConnIdentityKey(c, idx);
        const remoteIp = (c.remote_ip || c.ip || '').trim();
        const isBlocked = c.direction === 'blocked' || c.state === 'BANNED' || (remoteIp ? bannedIpSet.has(remoteIp) : false);
        const arrow = isBlocked ? '🛡️' : c.direction === 'incoming' ? '↓' : '↑';
        const aiInsight = aiSimplifiedView ? aiInsights[getConnAiSignature(c)] : undefined;
        const svc = escapeMapHtml(aiInsight?.app_name || c.service || t('hardware.net.geo.conn_generic'));
        const subLine = escapeMapHtml(
          aiInsight?.summary || `${c.domain || remoteIp}${c.domain && remoteIp ? ` (${remoteIp})` : ''}`
        );
        const localHost = c.local_hostname && c.local_hostname !== 'Servidor' ? ` · 📱 ${escapeMapHtml(c.local_hostname)}` : '';
        const hitChip = c.is_history && c.hit_count ? `<span style="color:#d97706;font-family:ui-monospace,monospace;font-size:10px;font-weight:700;">${c.hit_count}×</span>` : '';
        const spd = (c.rx_speed || 0) + (c.tx_speed || 0);
        const spdBadge = spd > 0 ? `<span style="color:#10b981;font-family:ui-monospace,monospace;font-size:10px;">${escapeMapHtml(formatSpeed(spd))}</span>` : '';
        return `<div style="padding:5px 4px;border-top:1px solid rgba(148,163,184,0.2);display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <button type="button" data-select-cluster="${escapeMapHtml(cluster.key)}" data-select-conn="${escapeMapHtml(connKey)}" style="flex:1;min-width:0;text-align:left;background:transparent;border:0;color:inherit;padding:0;cursor:pointer;">
            <div style="font-weight:700;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${arrow} ${aiInsight ? '✨ ' : ''}${svc}${localHost}</div>
            <div style="font-size:10.5px;opacity:.82;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${aiInsight ? '' : 'font-family:ui-monospace,monospace;'}">${subLine}</div>
          </button>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            ${hitChip}${spdBadge}
            <button type="button" data-select-cluster="${escapeMapHtml(cluster.key)}" data-select-conn="${escapeMapHtml(connKey)}" style="border:1px solid rgba(30,107,56,0.4);background:rgba(30,107,56,0.12);color:#1e6b38;border-radius:7px;padding:2px 7px;font-size:10px;font-weight:700;cursor:pointer;">${escapeMapHtml(t('network.map_inspect_conn'))}</button>
          </div>
        </div>`;
      })
      .join('');

    return `<div style="min-width:255px;max-width:335px;font-size:12px;line-height:1.36;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong style="font-size:12.5px;">🔀 ${escapeMapHtml(placeName)}</strong>
        <span style="background:rgba(30,107,56,0.16);color:#1e6b38;border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:700;font-family:ui-monospace,monospace;">${count}</span>
      </div>
      <div data-cockpit-scroll-contain="true" style="max-height:225px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px;">${rowsHtml}</div>
    </div>`;
  };
  renderPopupHtmlForClusterRef.current = renderPopupHtmlForCluster;

  // Leaflet map lifecycle & responsive ResizeObserver + zoomend clustering + persistent popup options
  useEffect(() => {
    if (subTab !== 'map' || !mapContainerEl) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        linesLayerRef.current = null;
        tileLayerRef.current = null;
        markerRegistryRef.current.clear();
      }
      return;
    }

    const L = window.L;
    if (!L) return;

    const primaryTileUrl =
      theme === 'dark'
        ? '/api/maps/tile/dark/{z}/{x}/{y}.png'
        : '/api/maps/tile/light/{z}/{x}/{y}.png';
    const osmFallbackUrl = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
    const invalidateTimers: number[] = [];

    if (!mapInstanceRef.current || mapInstanceRef.current.getContainer?.() !== mapContainerEl) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRegistryRef.current.clear();
      }
      mapContainerEl.classList.remove('cockpit-osm-dark-fallback');
      const map = L.map(mapContainerEl, {
        zoomControl: true,
        attributionControl: false,
        tapTolerance: 24,
        closePopupOnClick: false,
      }).setView([40.4, -3.7], 3);
      const layer = L.tileLayer(primaryTileUrl, { maxZoom: 18 });
      let switchedToOsm = false;
      layer.on('tileerror', () => {
        if (!switchedToOsm) {
          switchedToOsm = true;
          const isDarkActive =
            document.documentElement.getAttribute('data-theme') === 'dark' ||
            document.documentElement.classList.contains('dark');
          if (isDarkActive) {
            mapContainerEl.classList.add('cockpit-osm-dark-fallback');
          } else {
            mapContainerEl.classList.remove('cockpit-osm-dark-fallback');
          }
          layer.setUrl(osmFallbackUrl);
        }
      });
      layer.addTo(map);
      tileLayerRef.current = layer;
      linesLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;

      map.on('zoomend', () => {
        setMapZoomTick((v) => v + 1);
      });

      map.on('popupclose', () => {
        if (!isRedrawingMapRef.current) {
          activePopupStateRef.current.isOpen = false;
          activePopupStateRef.current.selectedConnKey = null;
        }
      });

      invalidateTimers.push(
        window.setTimeout(() => {
          mapInstanceRef.current?.invalidateSize();
        }, 120),
        window.setTimeout(() => {
          mapInstanceRef.current?.invalidateSize();
        }, 360)
      );
    } else if (tileLayerRef.current) {
      mapContainerEl.classList.remove('cockpit-osm-dark-fallback');
      tileLayerRef.current.setUrl(primaryTileUrl);
    }

    const handlePopupActionClick = (ev: MouseEvent) => {
      const targetEl = ev.target as HTMLElement | null;
      if (!targetEl) return;

      const closeBtn = targetEl.closest?.('.leaflet-popup-close-button');
      if (closeBtn) {
        activePopupStateRef.current = {
          isOpen: false,
          clusterKey: null,
          selectedConnKey: null,
          remoteIp: null,
          representativeIp: null,
          clusterIps: [],
          lat: null,
          lng: null,
        };
        return;
      }

      const selectConnBtn = targetEl.closest?.('[data-select-conn]') as HTMLElement | null;
      if (selectConnBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const cKey = selectConnBtn.getAttribute('data-select-cluster') || '';
        const connKey = selectConnBtn.getAttribute('data-select-conn') || '';
        const entry = markerRegistryRef.current.get(cKey);
        if (entry) {
          const matchedConn = entry.cluster.items.find((c, i) => getConnIdentityKey(c, i) === connKey);
          activePopupStateRef.current = {
            isOpen: true,
            clusterKey: cKey,
            selectedConnKey: connKey,
            remoteIp: matchedConn?.remote_ip || matchedConn?.ip || activePopupStateRef.current.remoteIp,
            representativeIp: entry.cluster.items[0]?.remote_ip || entry.cluster.items[0]?.ip || null,
            clusterIps: entry.cluster.items.map((c) => c.remote_ip || c.ip || '').filter(Boolean),
            lat: entry.lat,
            lng: entry.lng,
          };
          entry.hitMarker.setPopupContent(renderPopupHtmlForClusterRef.current(entry.cluster, connKey));
        }
        return;
      }

      const backBtn = targetEl.closest?.('[data-back-cluster]') as HTMLElement | null;
      if (backBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const cKey = backBtn.getAttribute('data-back-cluster') || '';
        const entry = markerRegistryRef.current.get(cKey);
        if (entry) {
          activePopupStateRef.current.selectedConnKey = null;
          entry.hitMarker.setPopupContent(renderPopupHtmlForClusterRef.current(entry.cluster, null));
        }
        return;
      }

      const unbanBtn = targetEl.closest?.('[data-unban-ip]') as HTMLElement | null;
      if (unbanBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const ip = unbanBtn.getAttribute('data-unban-ip') || '';
        const jail = unbanBtn.getAttribute('data-unban-jail') || 'all';
        if (ip) void handleUnbanIpRef.current(ip, jail);
        return;
      }

      const banBtn = targetEl.closest?.('[data-ban-ip]') as HTMLElement | null;
      const ip = banBtn?.getAttribute('data-ban-ip');
      if (ip) {
        ev.preventDefault();
        ev.stopPropagation();
        const popupRoot = banBtn?.closest?.('.leaflet-popup-content');
        const jailSel = popupRoot?.querySelector?.(`[data-jail-select="${ip}"]`) as HTMLSelectElement | null;
        const chosenJail = jailSel?.value || undefined;
        void handleBanIpRef.current(ip, chosenJail);
      }
    };
    mapContainerEl.addEventListener('click', handlePopupActionClick, true);

    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    ro.observe(mapContainerEl);
    return () => {
      invalidateTimers.forEach((timerId) => window.clearTimeout(timerId));
      mapContainerEl.removeEventListener('click', handlePopupActionClick, true);
      ro.disconnect();
    };
  }, [subTab, theme, mapContainerEl]);

  // Agrupamiento dinámico por distancia en píxeles (< 48px) + polilíneas + persistencia multicriterio de popups
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    const linesLayer = linesLayerRef.current;
    const L = window.L;
    if (!map || !layer || !L) return;

    isRedrawingMapRef.current = true;
    try {
      const srvNode = metrics?.net?.connections_map?.server_node;
      const srvLat = typeof srvNode?.lat === 'number' && Number.isFinite(srvNode.lat) ? srvNode.lat : null;
      const srvLng = typeof srvNode?.lng === 'number' && Number.isFinite(srvNode.lng) ? srvNode.lng : null;

      // 1. Proyección a píxeles de pantalla y clustering dinámico (< 48px) según nivel de zoom (v4.11.1)
      const pixelGroups: Array<{
        px: number;
        py: number;
        latSum: number;
        lngSum: number;
        isNode: boolean;
        items: GeoConnectionItem[];
      }> = [];

      let hasServerMarker = false;
      for (const c of geoConnections) {
        if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
        if (c.is_server_node) {
          hasServerMarker = true;
          pixelGroups.push({
            px: 0,
            py: 0,
            latSum: c.lat,
            lngSum: c.lng,
            isNode: true,
            items: [c],
          });
          continue;
        }
        const pt = map.latLngToLayerPoint ? map.latLngToLayerPoint([c.lat, c.lng]) : { x: c.lng * 10, y: c.lat * 10 };
        let merged = false;
        for (const g of pixelGroups) {
          if (g.isNode) continue;
          const dx = pt.x - g.px;
          const dy = pt.y - g.py;
          if (Math.hypot(dx, dy) < 48) {
            g.items.push(c);
            g.latSum += c.lat;
            g.lngSum += c.lng;
            const n = g.items.length;
            const avgPt = map.latLngToLayerPoint
              ? map.latLngToLayerPoint([g.latSum / n, g.lngSum / n])
              : { x: pt.x, y: pt.y };
            g.px = avgPt.x;
            g.py = avgPt.y;
            merged = true;
            break;
          }
        }
        if (!merged) {
          pixelGroups.push({
            px: pt.x,
            py: pt.y,
            latSum: c.lat,
            lngSum: c.lng,
            isNode: false,
            items: [c],
          });
        }
      }

      if (!hasServerMarker && srvLat !== null && srvLng !== null && srvNode) {
        pixelGroups.push({
          px: 0,
          py: 0,
          latSum: srvLat,
          lngSum: srvLng,
          isNode: true,
          items: [{ ...srvNode, is_server_node: true }],
        });
      }

      const clusters = new Map<string, DynamicGeoCluster>();
      for (const g of pixelGroups) {
        const n = g.items.length;
        const lat = g.latSum / n;
        const lng = g.lngSum / n;
        const key = g.isNode ? 'server-node' : `${lat.toFixed(3)},${lng.toFixed(3)}`;
        clusters.set(key, { key, lat, lng, isNode: g.isNode, items: g.items });
      }

      // Redibujar polilíneas hacia el nodo servidor
      if (linesLayer) {
        linesLayer.clearLayers();
        if (srvLat !== null && srvLng !== null && L.polyline) {
          for (const cluster of clusters.values()) {
            if (cluster.isNode) continue;
            const hasBlocked = cluster.items.some((c) => {
              const ip = (c.remote_ip || c.ip || '').trim();
              return c.direction === 'blocked' || c.state === 'BANNED' || (ip ? bannedIpSet.has(ip) : false);
            });
            const hasIncoming = cluster.items.some((c) => c.direction === 'incoming');
            const hasDevice = cluster.items.some((c) => isHomeDeviceConn(c, serverLocalIp));
            const lineColor = hasBlocked
              ? '#ef4444'
              : hasIncoming
                ? '#10b981'
                : hasDevice
                  ? '#8b5cf6'
                  : '#2e8b47';
            L.polyline(
              [
                [srvLat, srvLng],
                [cluster.lat, cluster.lng],
              ],
              {
                color: lineColor,
                weight: Math.min(3.2, 1.4 + Math.log2(cluster.items.length + 1) * 0.55),
                opacity: hasBlocked ? 0.55 : 0.38,
                dashArray: hasBlocked ? '5, 6' : undefined,
                interactive: false,
              }
            ).addTo(linesLayer);
          }
        }
      }

      const registry = markerRegistryRef.current;
      for (const [key, entry] of registry.entries()) {
        if (!clusters.has(key)) {
          layer.removeLayer(entry.hitMarker);
          layer.removeLayer(entry.visMarker);
          if (entry.badgeMarker) layer.removeLayer(entry.badgeMarker);
          if (entry.pulseMarker) layer.removeLayer(entry.pulseMarker);
          registry.delete(key);
        }
      }

      const validPoints: Array<[number, number]> = [];

      for (const cluster of clusters.values()) {
        validPoints.push([cluster.lat, cluster.lng]);
        const { key, lat, lng, isNode, items } = cluster;
        const primary = items[0];
        const placeName = [primary.city, primary.country].filter(Boolean).join(', ') || t('hardware.net.geo.location_fallback');
        const count = items.length;
        const visRadius = isNode ? 9.5 : Math.min(18, 7.5 + Math.sqrt(count) * 2.4);
        const hitRadius = Math.max(24, visRadius + 12);

        const hasBlocked =
          !isNode &&
          items.some((c) => {
            const ip = (c.remote_ip || c.ip || '').trim();
            return c.direction === 'blocked' || c.state === 'BANNED' || (ip ? bannedIpSet.has(ip) : false);
          });
        const hasIncoming = !isNode && items.some((c) => c.direction === 'incoming');
        const hasDevice = !isNode && items.some((c) => isHomeDeviceConn(c, serverLocalIp));

        const strokeColor = isNode
          ? '#059669'
          : hasBlocked
            ? '#dc2626'
            : hasIncoming
              ? '#059669'
              : hasDevice
                ? '#7c3aed'
                : '#1e6b38';
        const fillColor = isNode
          ? '#10b981'
          : hasBlocked
            ? '#ef4444'
            : hasIncoming
              ? '#10b981'
              : hasDevice
                ? '#8b5cf6'
                : '#2e8b47';

        // Etiqueta dinámica priorizando IA simplificada, dominio Pi-hole y contador de grupo
        const primaryInsight = aiSimplifiedView ? aiInsights[getConnAiSignature(primary)] : undefined;
        const primaryLabel = primaryInsight?.app_name || primary.domain || primary.service || primary.remote_ip || primary.ip || t('hardware.net.geo.conn_generic');
        const arrowPrefix = hasBlocked ? '🛡️' : hasIncoming ? '↓' : '↑';
        const tooltipText = isNode
          ? `● ${t('network.map_server_node_title')} · ${placeName} (${primary.public_ip || primary.ip || ''})`
          : count > 1
            ? `🔀 ${t('network.map_cluster_count', { count, place: placeName })} · ${primaryLabel}`
            : `${arrowPrefix} ${primaryLabel} · ${placeName}`;

        const selectedKeyForCluster =
          activePopupStateRef.current.isOpen && activePopupStateRef.current.clusterKey === key
            ? activePopupStateRef.current.selectedConnKey
            : null;
        const popupHtml = renderPopupHtmlForCluster(cluster, selectedKeyForCluster);

        const signature = `${lat.toFixed(3)},${lng.toFixed(3)}|${count}|${selectedKeyForCluster || ''}|${fillColor}|${aiSimplifiedView ? '1' : '0'}|${items
          .slice(0, 12)
          .map((c) => {
            const aiTag = aiSimplifiedView ? (aiInsights[getConnAiSignature(c)]?.app_name || '') : '';
            return `${c.remote_ip || c.ip || ''}:${c.domain || ''}:${c.service || ''}:${aiTag}:${c.hit_count || 0}:${c.rx_speed || 0}:${c.tx_speed || 0}:${c.bytes_total || 0}:${
              bannedIpSet.has((c.remote_ip || c.ip || '').trim()) ? '1' : '0'
            }`;
          })
          .join(',')}`;

        const existing = registry.get(key);
        if (existing) {
          existing.cluster = cluster;
          if (existing.signature !== signature) {
            existing.hitMarker.setLatLng([lat, lng]);
            existing.hitMarker.setRadius(hitRadius);
            existing.hitMarker.setTooltipContent(tooltipText);
            existing.hitMarker.setPopupContent(popupHtml);
            existing.visMarker.setLatLng([lat, lng]);
            existing.visMarker.setRadius(visRadius);
            existing.visMarker.setStyle({ color: strokeColor, fillColor });
            if (existing.badgeMarker) {
              layer.removeLayer(existing.badgeMarker);
              existing.badgeMarker = undefined;
            }
            if (!isNode && count > 1 && L.divIcon && L.marker) {
              const countIcon = L.divIcon({
                className: 'cockpit-map-count-badge bg-transparent border-0',
                html: `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;font-size:10px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(2,6,23,.85);">${count > 99 ? '99+' : count}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13],
              });
              existing.badgeMarker = L.marker([lat, lng], { icon: countIcon, interactive: false }).addTo(layer);
            }
            existing.signature = signature;
            existing.lat = lat;
            existing.lng = lng;
          }
          continue;
        }

        let pulseMarker;
        if (isNode && L.divIcon && L.marker) {
          const pulseIcon = L.divIcon({
            className: 'cockpit-map-count-badge bg-transparent border-0',
            html: '<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;"><span style="width:14px;height:14px;border-radius:9999px;background:#10b981;opacity:0.45;animation:cockpitPingRing 2s cubic-bezier(0,0,0.2,1) infinite;"></span></div>',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          pulseMarker = L.marker([lat, lng], { icon: pulseIcon, interactive: false }).addTo(layer);
        }

        const visMarker = L.circleMarker([lat, lng], {
          radius: visRadius,
          color: strokeColor,
          fillColor,
          fillOpacity: isNode ? 0.9 : 0.82,
          weight: 2,
          interactive: false,
        }).addTo(layer);

        let badgeMarker;
        if (!isNode && count > 1 && L.divIcon && L.marker) {
          const countIcon = L.divIcon({
            className: 'cockpit-map-count-badge bg-transparent border-0',
            html: `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-family:ui-monospace,monospace;font-size:10px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(2,6,23,.85);">${count > 99 ? '99+' : count}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          badgeMarker = L.marker([lat, lng], { icon: countIcon, interactive: false }).addTo(layer);
        }

        const hitMarker = L.circleMarker([lat, lng], {
          radius: hitRadius,
          color: '#c6f19d',
          fillColor: '#c6f19d',
          opacity: 0,
          fillOpacity: 0.01,
          weight: 0,
          interactive: true,
          className: 'cockpit-map-hit-target',
        });
        hitMarker.bindTooltip(tooltipText, { direction: 'top', offset: [0, -Math.max(8, visRadius * 0.65)], opacity: 0.96 });
        hitMarker.bindPopup(popupHtml, {
          maxWidth: 345,
          minWidth: 255,
          autoPan: true,
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
        });
        hitMarker.on('popupopen', () => {
          const currCluster = registry.get(key)?.cluster ?? cluster;
          activePopupStateRef.current = {
            isOpen: true,
            clusterKey: key,
            selectedConnKey:
              activePopupStateRef.current.clusterKey === key ? activePopupStateRef.current.selectedConnKey : null,
            remoteIp: currCluster.items[0]?.remote_ip || currCluster.items[0]?.ip || null,
            representativeIp: currCluster.items[0]?.remote_ip || currCluster.items[0]?.ip || null,
            clusterIps: currCluster.items.map((c) => c.remote_ip || c.ip || '').filter(Boolean),
            lat: currCluster.lat,
            lng: currCluster.lng,
          };
        });
        hitMarker.on('mouseover', () => {
          visMarker.setStyle({ weight: 3, fillOpacity: 0.96 });
        });
        hitMarker.on('mouseout', () => {
          visMarker.setStyle({ weight: 2, fillOpacity: isNode ? 0.9 : 0.82 });
        });
        hitMarker.addTo(layer);

        registry.set(key, { hitMarker, visMarker, badgeMarker, pulseMarker, signature, lat, lng, cluster });
      }

      // 2. Restauración Multicriterio en 5 niveles del Popup Activo (v4.11.2)
      const popupState = activePopupStateRef.current;
      if (popupState.isOpen) {
        let matchedEntry = popupState.clusterKey ? registry.get(popupState.clusterKey) : undefined;
        // Nivel 2: Por IP remota seleccionada
        if (!matchedEntry && popupState.remoteIp) {
          for (const entry of registry.values()) {
            if (entry.cluster.items.some((c) => (c.remote_ip || c.ip) === popupState.remoteIp)) {
              matchedEntry = entry;
              break;
            }
          }
        }
        // Nivel 3: Por IP representativa del cluster
        if (!matchedEntry && popupState.representativeIp) {
          for (const entry of registry.values()) {
            if (entry.cluster.items.some((c) => (c.remote_ip || c.ip) === popupState.representativeIp)) {
              matchedEntry = entry;
              break;
            }
          }
        }
        // Nivel 4: Por cualquiera de las IPs del cluster previo
        if (!matchedEntry && popupState.clusterIps.length > 0) {
          const prevSet = new Set(popupState.clusterIps);
          for (const entry of registry.values()) {
            if (entry.cluster.items.some((c) => prevSet.has(c.remote_ip || c.ip || ''))) {
              matchedEntry = entry;
              break;
            }
          }
        }
        // Nivel 5: Por proximidad geográfica (< 5 grados)
        if (!matchedEntry && popupState.lat !== null && popupState.lng !== null) {
          let bestDist = 5.0;
          for (const entry of registry.values()) {
            if (entry.cluster.isNode) continue;
            const d = Math.hypot(entry.lat - popupState.lat, entry.lng - popupState.lng);
            if (d < bestDist) {
              bestDist = d;
              matchedEntry = entry;
            }
          }
        }

        if (matchedEntry) {
          popupState.clusterKey = matchedEntry.cluster.key;
          matchedEntry.hitMarker.setPopupContent(
            renderPopupHtmlForCluster(matchedEntry.cluster, popupState.selectedConnKey)
          );
          if (!matchedEntry.hitMarker.isPopupOpen?.()) {
            matchedEntry.hitMarker.openPopup();
          }
        }
      }

      if (validPoints.length > 0 && !map._fittedOnce) {
        map.fitBounds(L.latLngBounds(validPoints), { padding: [36, 36], maxZoom: 5 });
        map._fittedOnce = true;
      }
    } finally {
      window.setTimeout(() => {
        isRedrawingMapRef.current = false;
      }, 60);
    }
  }, [geoConnections, metrics?.net?.connections_map?.server_node, bannedIpSet, serverLocalIp, subTab, mapContainerEl, mapZoomTick, aiInsights, aiSimplifiedView, locale, t]);

  const handleFitAllBounds = () => {
    const map = mapInstanceRef.current;
    const L = window.L;
    if (!map || !L) return;
    const pts: Array<[number, number]> = [];
    for (const entry of markerRegistryRef.current.values()) {
      pts.push([entry.lat, entry.lng]);
    }
    if (pts.length > 0) {
      map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 5 });
    }
  };

  const focusConnectionOnMap = (conn: GeoConnectionItem, idx = 0) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const connKey = getConnIdentityKey(conn, idx);
    const remIp = conn.remote_ip || conn.ip || '';

    // Buscar el cluster que contiene esta conexión
    let targetEntry:
      | {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hitMarker: any;
          lat: number;
          lng: number;
          cluster: DynamicGeoCluster;
        }
      | undefined;

    for (const entry of markerRegistryRef.current.values()) {
      if (
        entry.cluster.items.some(
          (c, i) => getConnIdentityKey(c, i) === connKey || (remIp && (c.remote_ip || c.ip) === remIp)
        )
      ) {
        targetEntry = entry;
        break;
      }
    }

    mapContainerEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const targetLat = targetEntry?.lat ?? conn.lat;
    const targetLng = targetEntry?.lng ?? conn.lng;

    const openTargetPopup = () => {
      // Re-buscar tras el zoom/flyTo por si el cluster se desempaquetó
      let latestEntry = targetEntry ? markerRegistryRef.current.get(targetEntry.cluster.key) : undefined;
      let resolvedConnKey: string | null = connKey;
      if (!latestEntry) {
        for (const entry of markerRegistryRef.current.values()) {
          const foundIdx = entry.cluster.items.findIndex(
            (c, i) => getConnIdentityKey(c, i) === connKey || (remIp && (c.remote_ip || c.ip) === remIp)
          );
          if (foundIdx >= 0) {
            latestEntry = entry;
            resolvedConnKey = getConnIdentityKey(entry.cluster.items[foundIdx], foundIdx);
            break;
          }
        }
      }
      if (latestEntry?.hitMarker) {
        activePopupStateRef.current = {
          isOpen: true,
          clusterKey: latestEntry.cluster.key,
          selectedConnKey: resolvedConnKey,
          remoteIp: remIp || null,
          representativeIp: latestEntry.cluster.items[0]?.remote_ip || latestEntry.cluster.items[0]?.ip || null,
          clusterIps: latestEntry.cluster.items.map((c) => c.remote_ip || c.ip || '').filter(Boolean),
          lat: latestEntry.lat,
          lng: latestEntry.lng,
        };
        latestEntry.hitMarker.setPopupContent(renderPopupHtmlForCluster(latestEntry.cluster, resolvedConnKey));
        latestEntry.hitMarker.openPopup();
      }
    };

    if (typeof targetLat === 'number' && typeof targetLng === 'number') {
      let opened = false;
      const fireOnce = () => {
        if (opened) return;
        opened = true;
        window.clearTimeout(fallbackTimer);
        openTargetPopup();
      };
      const fallbackTimer = window.setTimeout(fireOnce, 520);
      map.once('moveend', fireOnce);
      map.flyTo([targetLat, targetLng], Math.max(map.getZoom(), 6), { duration: 0.45 });
    } else {
      openTargetPopup();
    }
  };

  // Logo picker search
  useEffect(() => {
    if (!logoModalClient) return;
    const timer = setTimeout(() => {
      void apiFetchJson<{ results?: LogoSearchResult[] }>(
        `/api/logos/search?q=${encodeURIComponent(logoSearchQ)}`
      ).then((r) => {
        if (r.ok && r.data?.results) setLogoResults(r.data.results);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [logoModalClient, logoSearchQ]);

  const handleSaveLogo = async (logoUrl: string) => {
    if (!logoModalClient) return;
    const key = logoModalClient.custom_logo_key || logoModalClient.mac || logoModalClient.ip || logoModalClient.name || '';
    if (!key) return;
    setLogoSaving(true);
    const res = await apiFetchJson('/api/custom-logos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, logo: logoUrl }),
    });
    setLogoSaving(false);
    if (res.ok) {
      onNotify(logoUrl ? t('network.icon_updated') : t('network.icon_reset'));
      setLogoModalClient(null);
      onRefreshMetrics();
    } else {
      onNotify(res.error || t('network.icon_err'), true);
    }
  };

  const handleBanIp = async (ipToBan?: string, jailOverride?: string) => {
    const ip = (ipToBan || banIpInput).trim();
    if (!ip) return;
    const res = await apiFetchJson<{ message?: string }>('/api/fail2ban/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, jail: jailOverride || banJailInput }),
    });
    if (res.ok) {
      onNotify(res.data?.message || t('network.blocked_ok', { ip }));
      if (!ipToBan) setBanIpInput('');
      onRefreshMetrics();
    } else {
      onNotify(res.error || t('network.block_err'), true);
    }
  };
  handleBanIpRef.current = handleBanIp;

  const handleUnbanIp = async (ip: string, jail?: string) => {
    const res = await apiFetchJson<{ message?: string }>('/api/fail2ban/unban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, jail: jail || 'all' }),
    });
    if (res.ok) {
      onNotify(res.data?.message || t('network.unblocked_ok', { ip }));
      onRefreshMetrics();
    } else {
      onNotify(res.error || t('network.unblock_err'), true);
    }
  };
  handleUnbanIpRef.current = handleUnbanIp;

  const handleTelegramTest = async () => {
    const res = await apiFetchJson<{ message?: string }>('/api/telegram_bot/test', { method: 'POST' });
    if (res.ok) onNotify(res.data?.message || t('network.test_sent'));
    else onNotify(res.error || t('network.test_err'), true);
  };

  const handleTelegramSend = async () => {
    if (!telegramMsg.trim()) return;
    const res = await apiFetchJson<{ message?: string }>('/api/telegram_bot/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: telegramMsg.trim() }),
    });
    if (res.ok) {
      onNotify(res.data?.message || t('network.msg_sent'));
      setTelegramMsg('');
    } else {
      onNotify(res.error || t('network.msg_err'), true);
    }
  };

  const handleForceDuckDns = async () => {
    setDuckUpdating(true);
    const res = await apiFetchJson<{ message?: string }>('/api/dns/duckdns/update', { method: 'POST' });
    setDuckUpdating(false);
    if (res.ok) {
      onNotify(res.data?.message || t('network.ddns_updated'));
      void apiFetchJson<DuckDnsStatusPayload>('/api/dns/duckdns').then((r) => {
        if (r.ok && r.data) setDuckDns(r.data);
      });
    } else {
      onNotify(res.error || t('network.ddns_err'), true);
    }
  };

  const tabs: Array<{ id: RedSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: t('network.subtabs.home'), icon: <Wifi className="h-4 w-4" /> },
    { id: 'traffic', label: t('network.subtabs.traffic'), icon: <ArrowDownUp className="h-4 w-4" /> },
    { id: 'map', label: t('network.subtabs.map'), icon: <MapPin className="h-4 w-4" /> },
    { id: 'speedtest', label: t('network.subtabs.speedtest'), icon: <Gauge className="h-4 w-4" /> },
    { id: 'security', label: t('network.subtabs.security'), icon: <Shield className="h-4 w-4" /> },
    { id: 'dns', label: t('network.subtabs.dns'), icon: <Globe className="h-4 w-4" /> },
  ];

  // SVG Donut calculation
  const totalGeo = Math.max(1, serviceBreakdown.reduce((acc, s) => acc + s.count, 0));

  return (
    <div className="space-y-[clamp(0.85rem,1.8dvh,1.25rem)]">
      <LayoutGroup id="net-subtabs">
        <div className="cockpit-segmented cockpit-subtabs-bar">
          {tabs.map((tab) => {
            const active = subTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`cockpit-subtab-btn relative inline-flex items-center justify-center rounded-xl font-semibold transition-colors ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="net-subtab-pill" className="rounded-xl" />}
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

      {/* 1. Aparatos en casa */}
      {subTab === 'home' && (
        <div className="space-y-4">
          {/* Network Interfaces + Router Traffic (3rd top widget) */}
          <section className="cockpit-auto-grid">
            {nonRouterInterfaces.map((nic) => (
              <NicHistoryCard
                key={nic.name}
                nic={nic}
                theme={theme}
                locale={locale}
                onExpandChart={onExpandChart}
              />
            ))}
            <RouterTrafficCard
              metrics={metrics}
              theme={theme}
              locale={locale}
              onExpandChart={onExpandChart}
            />
          </section>

          {/* Real-Time Ping Latency Chart (Default Gateway + External Nodes) */}
          <section className="cockpit-bento p-5" data-testid="ping-latency-section">
            <div className="flex flex-col gap-3 pb-3 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cockpit-pill-cyan inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <Activity className="h-4 w-4" />
                  </span>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('network.ping_latency_title')}
                  </h2>
                  {pingLatency?.updated_at && pingLatency.updated_at !== '--' && (
                    <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                      {pingLatency.updated_at}
                    </span>
                  )}
                  {fbUser && syncedPingHistory.length > 0 && (
                    <span className="cockpit-pill-violet inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                      <Cloud className="h-3 w-3" />
                      <span>{t('firebase.synced_ping_title', { count: syncedPingHistory.length })}</span>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t('network.ping_latency_sub')}
                </p>
              </div>
              {onExpandChart && (
                <button
                  type="button"
                  aria-label={t('network.ping_expand_aria')}
                  onClick={() => onExpandChart(pingChartView.expandSpec)}
                  className="cockpit-subtile flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {pingChartView.targets.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {pingChartView.targets.map((tgt) => {
                  const badgeLabel =
                    tgt.kind === 'gateway'
                      ? t('network.ping_gateway_badge')
                      : tgt.kind === 'dns'
                        ? t('network.ping_dns_badge')
                        : t('network.ping_external_badge');
                  return (
                    <div key={tgt.id} className="cockpit-subtile flex flex-col gap-1 px-3 py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tgt.color }} />
                          <span className="truncate">{tgt.label}</span>
                        </span>
                        <span className="cockpit-pill-cyan shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                          {badgeLabel}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
                        <span className="text-slate-400 dark:text-slate-500 truncate">{tgt.ip}</span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {tgt.last_ms !== null ? `${tgt.last_ms.toFixed(1)} ms` : t('network.ping_unreachable')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                        <span>{t('network.ping_avg_short', { val: tgt.avg_ms !== null ? `${tgt.avg_ms.toFixed(1)}` : '--' })}</span>
                        <span>{t('network.ping_jitter_short', { val: `${tgt.jitter_ms.toFixed(1)}` })}</span>
                        <span>{t('network.ping_loss_short', { val: `${tgt.loss_pct.toFixed(0)}` })}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3">
              <TelemetryChart
                series={pingChartView.series}
                timestamps={pingChartView.timestamps}
                epochTs={pingChartView.epochTs}
                heightClassName="cockpit-chart-medium"
                leftUnit="ms"
                theme={theme}
                emptyMessage={t('network.ping_accumulating')}
                onExpandClick={onExpandChart ? () => onExpandChart(pingChartView.expandSpec) : undefined}
              />
            </div>
          </section>

          {/* Connected Devices with Independent Live Consumption + Sort + Custom Logo + WoL + Shutdown */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.router_devices_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('network.visible_devices', {
                    router: metrics?.wifi_summary?.router_model || t('network.router_fallback'),
                    count: wifiClients.length,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LayoutGroup id="home-client-sort">
                  <div className="cockpit-subtile flex flex-wrap items-center gap-1 p-1">
                    {(
                      [
                        { id: 'down', label: t('overview.bw_sort_down') },
                        { id: 'up', label: t('overview.bw_sort_up') },
                        { id: 'lan', label: t('overview.bw_sort_lan') },
                        { id: 'name', label: t('overview.bw_sort_name') },
                      ] as const
                    ).map((sOpt) => {
                      const active = clientSort === sOpt.id;
                      return (
                        <button
                          key={sOpt.id}
                          type="button"
                          onClick={() => setClientSort(sOpt.id)}
                          className={`relative min-h-[34px] rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                            active
                              ? 'text-sky-700 dark:text-sky-300'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                          }`}
                        >
                          {active && <MorphPill layoutId="home-client-sort-pill" className="rounded-lg" />}
                          <span className="relative z-10">{sOpt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </LayoutGroup>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    placeholder={t('network.search_devices')}
                    className="cockpit-subtile min-h-[40px] pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {wifiClients.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('network.no_devices_found')}
              </p>
            ) : (
              <div className="mt-4 cockpit-auto-grid-cards">
                {wifiClients.map((client, idx) => {
                  const isOnline = client.online !== false && client.is_online !== false;
                  const mac = client.mac || `c-${idx}`;
                  const busy = actionPendingMac === mac;
                  const logoKey = client.custom_logo_key || client.mac || client.ip || '';
                  const customLogo = logoKey ? metrics?.custom_logos?.[logoKey] : undefined;
                  const imgSrc = customLogo || client.logo_url;
                  const title = client.name || client.hostname || client.ip || t('network.device_fallback_alt');

                  const wanDown = client.wan_speed_down ?? client.speed_down ?? 0;
                  const wanUp = client.wan_speed_up ?? client.speed_up ?? 0;
                  const lanTotal = (client.lan_speed_down ?? 0) + (client.lan_speed_up ?? 0);
                  const clientTotal = wanDown + wanUp + lanTotal;
                  const barPct = clientTotal > 0 ? Math.min(100, Math.max(4, Math.round((clientTotal / maxClientTotalBps) * 100))) : 0;

                  return (
                    <div
                      key={`${mac}-${idx}`}
                      className="cockpit-subtile flex flex-col gap-3 p-3.5"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              setLogoModalClient(client);
                              setLogoSearchQ(client.brand || client.vendor || client.name || '');
                            }}
                            title={t('network.change_icon_title')}
                            className="cockpit-subtile flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden hover:border-sky-400 dark:hover:border-sky-500"
                          >
                            {imgSrc ? (
                              <img
                                src={imgSrc}
                                alt={title}
                                referrerPolicy="no-referrer"
                                className="h-6 w-6 object-contain"
                              />
                            ) : (
                              <ImageIcon className="h-4 w-4 text-slate-400" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                              <span
                                className={`text-xs font-medium ${
                                  isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {isOnline ? t('network.status_connected') : t('network.status_idle')}
                              </span>
                            </div>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {client.ip || '--'} {client.band ? `· ${formatBandLabel(client, locale)}` : ''}{' '}
                              {client.vendor ? `· ${formatClientVendor(client, locale)}` : ''}
                            </p>
                          </div>
                        </div>

                        {!client.is_server && !client.is_gateway && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={busy || !client.mac}
                              onClick={() => onPowerAction('wake', client)}
                              className="cockpit-btn-wol inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45"
                            >
                              <Power className="h-3.5 w-3.5" />
                              <span>{t('overview.wake_btn')}</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy || (!client.ip && !client.mac)}
                              onClick={() => onPowerAction('shutdown', client)}
                              className="cockpit-btn-off inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45"
                            >
                              <PowerOff className="h-3.5 w-3.5" />
                              <span>{t('overview.sleep_btn')}</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Independent Live Device Consumption Strip (matching top banner) */}
                      <div className="space-y-1.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800">
                        <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px] tabular-nums">
                          <div className="flex min-w-0 items-center justify-between gap-1">
                            <span className="truncate font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('overview.bw_wan_dl')}</span>
                            <span className="shrink-0 font-semibold text-sky-600 dark:text-sky-400">↓ {formatSpeed(wanDown)}</span>
                          </div>
                          <div className="flex min-w-0 items-center justify-between gap-1 border-x border-slate-200/70 px-1.5 dark:border-slate-800">
                            <span className="truncate font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('overview.bw_wan_ul')}</span>
                            <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">↑ {formatSpeed(wanUp)}</span>
                          </div>
                          <div className="flex min-w-0 items-center justify-between gap-1">
                            <span className="truncate font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('hardware.net.lan_short')}</span>
                            <span className="shrink-0 font-semibold text-indigo-600 dark:text-indigo-400">{formatSpeed(lanTotal)}</span>
                          </div>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-[width] duration-300"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowTechNet((v) => !v)}
              className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {showTechNet ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span>{t('equipment.technical_details')}</span>
            </button>
            {showTechNet && (
              <div className="cockpit-subtile mt-2 p-3 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                {t('hardware.net.accumulated_traffic', {
                  rx: formatBytes(metrics?.net?.rx_total_bytes),
                  tx: formatBytes(metrics?.net?.tx_total_bytes),
                })}
                {metrics?.wifi_summary?.router_ip ? t('hardware.net.gateway_label', { ip: metrics.wifi_summary.router_ip }) : ''}
                {metrics?.wifi_summary?.router_encrypted
                  ? t('hardware.net.encrypted_creds', { mode: metrics.wifi_summary.router_auth_mode || 'AES-256-GCM' })
                  : ''}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 2. Historial de tráfico, dominios, servicios, países y curiosidades */}
      {subTab === 'traffic' && (
        <div className="space-y-4">
          {/* 24-Hour Network Traffic Evolution Section */}
          <section
            aria-labelledby="network-24h-history-title"
            className="cockpit-bento min-w-0 overflow-hidden p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="cockpit-pill-cyan inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <ArrowDownUp className="h-4 w-4" />
                  </span>
                  <h2
                    id="network-24h-history-title"
                    className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white sm:text-lg"
                  >
                    {t('overview.net_history_24h_title')}
                  </h2>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span>{t('overview.net_history_24h_sub')}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {t('overview.net_history_24h_badge')}
                  </span>
                  {network24hView.sampleCount > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">
                        {t('overview.net_history_24h_samples', { count: network24hView.sampleCount })}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <motion.button
                  type="button"
                  aria-label={t('network.refresh')}
                  onClick={() => {
                    onRefreshNetHistory24h?.();
                    void loadTrafficAnalytics(true);
                  }}
                  className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                >
                  <RefreshCw className={`h-4 w-4 ${(netHistoryLoading || trafficLoading) ? 'animate-spin' : ''}`} />
                </motion.button>
                {onExpandChart && (
                  <motion.button
                    type="button"
                    aria-label={t('hardware.net.expand_aria')}
                    onClick={openNetwork24hExpanded}
                    className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </motion.button>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-[#1e6b38] dark:bg-[#c6f19d]" />
                <span>{t('hardware.net.wan_download')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-[#10b981]" />
                <span>{t('hardware.net.wan_upload')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-[#6366f1]" />
                <span>{t('hardware.net.lan_download')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                <span>{t('hardware.net.lan_upload')}</span>
              </span>
            </div>

            {/* Summary KPI row separated by clean hairline divider */}
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-4 dark:border-slate-800">
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.wan_download')} ({t('overview.net_history_24h_peak_wan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-sky-700 dark:text-sky-300">
                  ↓ {formatSpeed(network24hView.peakWanRxMb * 1024 * 1024)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.wan_upload')} ({t('overview.net_history_24h_peak_wan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  ↑ {formatSpeed(network24hView.peakWanTxMb * 1024 * 1024)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.lan_download')} ({t('overview.net_history_24h_peak_lan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
                  ↓ {formatSpeed(network24hView.peakLanRxMb * 1024 * 1024)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('hardware.net.lan_upload')} ({t('overview.net_history_24h_peak_lan')})
                </p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  ↑ {formatSpeed(network24hView.peakLanTxMb * 1024 * 1024)}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-200/70 pt-4 dark:border-slate-800/80">
              {netHistoryLoading && network24hView.sampleCount < 2 ? (
                <div className="cockpit-chart-tall w-full animate-pulse rounded-xl bg-slate-100/80 dark:bg-slate-800/50" />
              ) : netHistoryError && network24hView.sampleCount < 2 ? (
                <div className="cockpit-chart-tall flex flex-col items-center justify-center gap-3 text-center">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('overview.net_history_24h_error')}
                  </p>
                  <button
                    type="button"
                    onClick={() => onRefreshNetHistory24h?.()}
                    className="cockpit-subtile min-h-[40px] px-4 py-2 text-xs font-semibold text-sky-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-300 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    {t('overview.net_history_24h_retry')}
                  </button>
                </div>
              ) : (
                <TelemetryChart
                  series={network24hView.series}
                  timestamps={network24hView.timestamps}
                  dateTimestamps={network24hView.dateTimestamps}
                  epochTs={network24hView.epochTs}
                  heightClassName="cockpit-chart-tall"
                  leftUnit="MB/s"
                  intervalSec={300}
                  theme={theme}
                  emptyMessage={t('overview.net_history_24h_empty')}
                  onExpandClick={onExpandChart ? openNetwork24hExpanded : undefined}
                />
              )}
            </div>
          </section>

          {/* Search Bar & Analytics Intro */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('network.traffic_analytics_sub')}
            </p>
            <div className="relative shrink-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={trafficFilterQuery}
                onChange={(e) => setTrafficFilterQuery(e.target.value)}
                placeholder={t('network.traffic_search_placeholder')}
                className="cockpit-subtile min-h-[40px] w-full pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
              />
            </div>
          </div>

          {/* Curiosidades de tu red (4 real-telemetry calculation tiles) */}
          <section className="cockpit-bento p-5" data-testid="network-curiosities-section">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/70 dark:border-slate-800">
              <span className="cockpit-pill-violet inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.curiosities_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('network.curiosities_sub')}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* Tile 1: Farthest node & speed of light in fiber */}
              <div className="cockpit-subtile flex flex-col justify-between gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('network.curiosity_farthest_label')}
                  </span>
                  <Globe2 className="h-4 w-4 shrink-0 text-sky-500" />
                </div>
                <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {networkCuriosities.farthestKm > 0
                    ? `${networkCuriosities.farthestKm.toLocaleString(locale === 'es' ? 'es-ES' : locale)} km`
                    : '--'}
                </div>
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                  {networkCuriosities.farthestKm > 0
                    ? t('network.curiosity_farthest_detail', {
                        km: networkCuriosities.farthestKm.toLocaleString(locale === 'es' ? 'es-ES' : locale),
                        light_ms: networkCuriosities.lightFiberRttMs,
                      })
                    : t('network.curiosity_farthest_empty')}
                </p>
                {networkCuriosities.farthestTarget && (
                  <p className="truncate font-mono text-[10.5px] text-sky-600 dark:text-sky-400">
                    {networkCuriosities.farthestTarget}
                  </p>
                )}
              </div>

              {/* Tile 2: 24h integrated volume & WAN/LAN split + HD eq */}
              <div className="cockpit-subtile flex flex-col justify-between gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('network.curiosity_volume_label')}
                  </span>
                  <ArrowDownUp className="h-4 w-4 shrink-0 text-emerald-500" />
                </div>
                <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {networkCuriosities.hasVolume ? formatBytes(networkCuriosities.combinedBytes) : '--'}
                </div>
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                  {networkCuriosities.hasVolume
                    ? t('network.curiosity_volume_detail', {
                        wan_pct: networkCuriosities.wanPct,
                        lan_pct: networkCuriosities.lanPct,
                        hd_hours: networkCuriosities.hdHours,
                      })
                    : t('network.curiosity_volume_empty')}
                </p>
              </div>

              {/* Tile 3: Peak burst & DL/UL balance */}
              <div className="cockpit-subtile flex flex-col justify-between gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('network.curiosity_peak_label')}
                  </span>
                  <Zap className="h-4 w-4 shrink-0 text-amber-500" />
                </div>
                <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {networkCuriosities.peakMb > 0 ? formatSpeed(networkCuriosities.peakMb * 1024 * 1024) : '--'}
                </div>
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                  {t('network.curiosity_peak_detail', {
                    time: networkCuriosities.peakTime,
                    ratio: networkCuriosities.dlUlRatio,
                  })}
                </p>
              </div>

              {/* Tile 4: Global footprint & shield */}
              <div className="cockpit-subtile flex flex-col justify-between gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('network.curiosity_footprint_label')}
                  </span>
                  <Shield className="h-4 w-4 shrink-0 text-indigo-500" />
                </div>
                <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {networkCuriosities.countriesCount} · {networkCuriosities.ispsCount} ISP
                </div>
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                  {t('network.curiosity_footprint_detail', {
                    countries: networkCuriosities.countriesCount,
                    isps: networkCuriosities.ispsCount,
                    blocked: networkCuriosities.blockedTotal.toLocaleString(locale === 'es' ? 'es-ES' : locale),
                  })}
                </p>
              </div>
            </div>
          </section>

          {/* Symmetric 3-Widget Bento Grid: Top Domains + Top Services + Top Countries */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Widget 1: Dominios más utilizados */}
            <section className="cockpit-bento flex flex-col p-5" data-testid="traffic-top-domains">
              <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="cockpit-pill-cyan inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <Globe className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {t('network.traffic_top_domains_title')}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {(dnsTrafficStats?.top_domains?.length ?? 0) > 0
                        ? t('network.traffic_top_domains_sub_pihole')
                        : t('network.traffic_top_domains_sub_live')}
                    </p>
                  </div>
                </div>

                <div className="cockpit-subtile flex items-center gap-1 p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDomainsMode('all')}
                    className={`min-h-[30px] rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
                      domainsMode === 'all'
                        ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {t('network.traffic_domains_filter_all')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDomainsMode('blocked')}
                    className={`min-h-[30px] rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
                      domainsMode === 'blocked'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {t('network.traffic_domains_filter_blocked')}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex-1 space-y-2.5">
                {topDomains.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    {t('network.traffic_domains_empty')}
                  </p>
                ) : (
                  topDomains.map((d, idx) => {
                    const maxVal = Math.max(
                      1,
                      domainsMode === 'blocked' ? topDomains[0].blockedCount : topDomains[0].count
                    );
                    const val = domainsMode === 'blocked' ? d.blockedCount : d.count;
                    const barW = Math.min(100, Math.max(6, Math.round((val / maxVal) * 100)));
                    return (
                      <div key={d.domain} className="cockpit-subtile space-y-1.5 px-3 py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-[10px] font-semibold text-slate-400 tabular-nums">
                              #{idx + 1}
                            </span>
                            <span className="truncate font-mono font-semibold text-slate-900 dark:text-white" title={d.domain}>
                              {d.domain}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-sky-700 dark:text-sky-300">
                            {d.isPiholeSource
                              ? t('network.traffic_domain_queries', {
                                  count: d.count.toLocaleString(locale === 'es' ? 'es-ES' : locale),
                                })
                              : t('network.traffic_domain_hits', {
                                  count: d.count.toLocaleString(locale === 'es' ? 'es-ES' : locale),
                                })}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-500 dark:text-slate-400">
                          <span className="truncate">
                            {[
                              d.service,
                              d.country,
                              d.avgReplyMs !== null ? t('network.traffic_latency_unit', { ms: d.avgReplyMs }) : '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'DNS / TLS'}
                          </span>
                          {d.blockedCount > 0 && (
                            <span className="font-mono font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                              {t('network.traffic_domain_blocked_pct', { pct: d.pctBlocked })}
                            </span>
                          )}
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${
                              domainsMode === 'blocked'
                                ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                                : 'bg-gradient-to-r from-sky-500 to-cyan-400'
                            }`}
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Widget 2: Servicios más usados */}
            <section className="cockpit-bento flex flex-col p-5" data-testid="traffic-top-services">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                <span className="cockpit-pill-emerald inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                  <Server className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {t('network.traffic_top_services_title')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {t('network.traffic_top_services_sub')}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex-1 space-y-2.5">
                {topServices.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    {t('network.traffic_services_empty')}
                  </p>
                ) : (
                  topServices.map((s, idx) => {
                    const maxHits = Math.max(1, topServices[0].hitCount);
                    const barW = Math.min(100, Math.max(6, Math.round((s.hitCount / maxHits) * 100)));
                    return (
                      <div key={s.service} className="cockpit-subtile space-y-1.5 px-3 py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-[10px] font-semibold text-slate-400 tabular-nums">
                              #{idx + 1}
                            </span>
                            <span className="truncate font-semibold text-slate-900 dark:text-white" title={s.service}>
                              {s.service}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                            {t('network.traffic_domain_hits', {
                              count: s.hitCount.toLocaleString(locale === 'es' ? 'es-ES' : locale),
                            })}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-500 dark:text-slate-400">
                          <span className="font-mono tabular-nums">
                            {t('network.traffic_service_meta', { ips: s.ipsCount, devices: s.devicesCount })}
                          </span>
                          {s.protocols.length > 0 && (
                            <span className="font-mono text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-300">
                              {s.protocols.slice(0, 3).join(' · ')}
                            </span>
                          )}
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-300"
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Widget 3: Países con más conexiones */}
            <section className="cockpit-bento flex flex-col p-5" data-testid="traffic-top-countries">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                <span className="cockpit-pill-amber inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                  <Globe2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {t('network.traffic_top_countries_title')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {t('network.traffic_top_countries_sub')}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex-1 space-y-2.5">
                {topCountries.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    {t('network.traffic_countries_empty')}
                  </p>
                ) : (
                  topCountries.map((c, idx) => {
                    const maxHits = Math.max(1, topCountries[0].hitCount);
                    const barW = Math.min(100, Math.max(6, Math.round((c.hitCount / maxHits) * 100)));
                    return (
                      <div key={`${c.countryCode || c.country}-${idx}`} className="cockpit-subtile space-y-1.5 px-3 py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-base leading-none shrink-0" aria-hidden="true">
                              {c.flag}
                            </span>
                            <span className="truncate font-semibold text-slate-900 dark:text-white" title={c.country}>
                              {c.country}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-amber-700 dark:text-amber-300">
                            {c.hitCount.toLocaleString(locale === 'es' ? 'es-ES' : locale)} ({c.sharePct}%)
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          <span>{t('network.traffic_country_meta', { ips: c.uniqueIps, cities: c.citiesCount })}</span>
                          {c.countryCode && <span>{c.countryCode}</span>}
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-indigo-500 transition-[width] duration-300"
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {/* Widget 4: Historial de identificaciones IA (recursos_history.db) */}
          {(() => {
            const mergedAiMap: Record<string, AiConnectionInsight> = {
              ...(netHistoryCatalog?.ai_insights ?? {}),
              ...(mapHistoryData?.ai_insights ?? {}),
              ...aiInsights,
            };
            const q = trafficFilterQuery.trim().toLowerCase();
            const aiHistoryItems = Object.entries(mergedAiMap)
              .map(([sig, item]) => ({ ...item, signature: item.signature || sig }))
              .filter((item) => {
                if (!q) return true;
                return (
                  String(item.app_name || '').toLowerCase().includes(q) ||
                  String(item.category || '').toLowerCase().includes(q) ||
                  String(item.summary || '').toLowerCase().includes(q) ||
                  String(item.role || '').toLowerCase().includes(q) ||
                  String(item.signature || '').toLowerCase().includes(q)
                );
              })
              .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));

            return (
              <section className="cockpit-bento p-5" data-testid="traffic-ai-history">
                <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="cockpit-pill-violet inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {t('network.traffic_ai_history_title')}
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('network.traffic_ai_history_sub')}
                      </p>
                    </div>
                  </div>
                  <span className="cockpit-pill-violet rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                    {aiHistoryItems.length}
                  </span>
                </div>

                {aiHistoryItems.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    {t('network.traffic_ai_history_empty')}
                  </p>
                ) : (
                  <div
                    data-cockpit-scroll-contain="true"
                    className="cockpit-scroll-panel mt-3 cockpit-auto-grid-cards max-h-[380px] overflow-y-auto overscroll-contain pr-1"
                  >
                    {aiHistoryItems.slice(0, 36).map((item) => {
                      const sigParts = String(item.signature || '').split('|');
                      const dir = sigParts[0] || '';
                      const proto = sigParts[1] || '';
                      const remoteIp = sigParts[3] || '';
                      const remotePort = sigParts[4] || '';
                      const domain = sigParts[5] || '';
                      return (
                        <div key={item.signature} className="cockpit-subtile flex flex-col justify-between gap-2 p-3.5 text-xs">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                                <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                                <span>{item.app_name}</span>
                              </span>
                              <span className="cockpit-pill-cyan rounded-md px-2 py-0.5 text-[10px] font-semibold">
                                {item.category}
                              </span>
                            </div>
                            <p className="text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-200">
                              {item.summary}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 font-mono text-[10.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            <span className="truncate max-w-full">
                              {domain || remoteIp || item.role}
                              {remotePort && remotePort !== '0' ? `:${remotePort}` : ''}
                              {proto ? ` (${proto})` : ''}
                            </span>
                            {dir && (
                              <span className="shrink-0 uppercase text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                                {dir === 'incoming' ? t('network.map_direction_in') : t('network.map_direction_out')}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })()}
        </div>
      )}

      {/* 3. Mapa de conexiones */}
      {subTab === 'map' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="cockpit-bento lg:col-span-8 xl:col-span-9 overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-200/70 px-5 py-3.5 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                        {t('network.map_title')}
                      </h2>
                      <span className="cockpit-pill-emerald inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                        {t('network.map_engine')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('network.map_destinations_visible', { count: geoConnections.filter((c) => !c.is_server_node).length })} · {t('network.map_click_hint')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <LayoutGroup id="map-live-history-mode">
                      <div className="cockpit-segmented inline-flex rounded-xl p-1">
                        {(['live', 'history'] as const).map((modeOpt) => {
                          const active = mapMode === modeOpt;
                          return (
                            <motion.button
                              key={modeOpt}
                              type="button"
                              onClick={() => setMapMode(modeOpt)}
                              className={`relative inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                active
                                  ? 'text-sky-700 dark:text-sky-300'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                              }`}
                            >
                              {active && <MorphPill layoutId="map-mode-pill" className="rounded-lg" />}
                              <span className="relative z-10 inline-flex items-center gap-1">
                                {modeOpt === 'live' ? <Activity className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
                                <span>{t(modeOpt === 'live' ? 'network.map_mode_live' : 'network.map_mode_history')}</span>
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </LayoutGroup>

                    <motion.button
                      type="button"
                      disabled={aiLoading || geoConnections.filter((c) => !c.is_server_node).length === 0}
                      onClick={() => void handleSimplifyConnectionsWithAi()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/12 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300"
                    >
                      <Sparkles className={`h-3.5 w-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
                      <span>{aiLoading ? t('network.ai_identifying') : t('network.ai_identify_btn')}</span>
                    </motion.button>

                    {Object.keys(aiInsights).length > 0 && (
                      <motion.button
                        type="button"
                        onClick={() => setAiSimplifiedView((v) => !v)}
                        className={`cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                          aiSimplifiedView
                            ? 'text-indigo-700 dark:text-indigo-300 border-indigo-400/50'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <span>{aiSimplifiedView ? t('network.ai_mode_simple') : t('network.ai_mode_tech')}</span>
                      </motion.button>
                    )}

                    <motion.button
                      type="button"
                      onClick={handleFitAllBounds}
                      className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span>{t('network.map_fit_all')}</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      onClick={() => {
                        if (mapMode === 'history') {
                          void loadMapHistory(true);
                        } else {
                          void apiFetchJson('/api/net/geoip/resolve', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ips: [], force_sync: true }),
                          }).then(() => {
                            onNotify(t('network.locations_updated'));
                            onRefreshMetrics();
                          });
                        }
                      }}
                      className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${mapHistoryLoading ? 'animate-spin' : ''}`} />
                      <span>{t('network.refresh')}</span>
                    </motion.button>
                  </div>
                </div>

                {/* Barra de Historial Temporal (solo activa en modo Historial) */}
                {mapMode === 'history' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-500/8 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      {(
                        [
                          { id: '1' as const, label: t('network.map_history_1h') },
                          { id: '6' as const, label: t('network.map_history_6h') },
                          { id: '24' as const, label: t('network.map_history_24h') },
                          { id: '168' as const, label: t('network.map_history_7d') },
                          { id: 'all' as const, label: t('network.map_history_all') },
                        ]
                      ).map((hr) => {
                        const active = mapHistoryHours === hr.id;
                        return (
                          <motion.button
                            key={hr.id}
                            type="button"
                            onClick={() => setMapHistoryHours(hr.id)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                              active
                                ? 'cockpit-pill-amber ring-1 ring-amber-400/50'
                                : 'cockpit-subtile text-slate-600 hover:text-slate-900 dark:text-slate-300'
                            }`}
                          >
                            {hr.label}
                          </motion.button>
                        );
                      })}
                      <span className="ml-1 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                        {t('network.map_history_summary', {
                          records: mapHistoryData?.summary?.total_records ?? 0,
                          hits: mapHistoryData?.summary?.total_hits ?? 0,
                        })}
                      </span>
                    </div>
                    <motion.button
                      type="button"
                      disabled={mapHistoryClearing}
                      onClick={() => void handleClearMapHistory()}
                      className="cockpit-btn-off inline-flex min-h-[30px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>{t('network.map_history_clear')}</span>
                    </motion.button>
                  </div>
                )}

                {aiError && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    <span>{aiError}</span>
                    <button
                      type="button"
                      onClick={() => setAiError(null)}
                      className="rounded-md px-2 py-0.5 font-semibold hover:bg-rose-500/15"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* Barra de Filtros Interactivos + Selectores Dispositivo/Servicio + Buscador */}
                <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'all' as const, label: t('network.map_filter_all'), count: mapFilterCounts.all, activeCls: 'cockpit-pill-cyan ring-1 ring-sky-400/50 dark:ring-sky-500/40' },
                        { id: 'incoming' as const, label: t('network.map_filter_incoming'), count: mapFilterCounts.incoming, activeCls: 'cockpit-pill-amber ring-1 ring-amber-400/50 dark:ring-amber-500/40' },
                        { id: 'outgoing' as const, label: t('network.map_filter_outgoing'), count: mapFilterCounts.outgoing, activeCls: 'cockpit-pill-emerald ring-1 ring-emerald-400/50 dark:ring-emerald-500/40' },
                        { id: 'devices' as const, label: t('network.map_filter_devices'), count: mapFilterCounts.devices, activeCls: 'cockpit-pill-violet ring-1 ring-violet-400/50 dark:ring-violet-500/40' },
                        { id: 'blocked' as const, label: t('network.map_filter_blocked'), count: mapFilterCounts.blocked, activeCls: 'cockpit-pill-red ring-1 ring-rose-400/50 dark:ring-rose-500/40' },
                      ]
                    ).map((f) => {
                      const active = mapFilter === f.id;
                      return (
                        <motion.button
                          key={f.id}
                          type="button"
                          onClick={() => setMapFilter(f.id)}
                          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                            active
                              ? f.activeCls
                              : 'cockpit-subtile text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>{f.label}</span>
                          <span
                            className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                              active ? 'bg-black/10 dark:bg-white/10' : 'bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {f.count}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t('network.map_filter_device_all')}
                      value={mapDeviceFilter}
                      onChange={(e) => setMapDeviceFilter(e.target.value)}
                      className="cockpit-subtile min-h-[36px] min-w-[140px] flex-1 sm:flex-none px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-sky-500 dark:text-slate-100"
                    >
                      <option value="all">{t('network.map_filter_device_all')}</option>
                      {availableMapDevices.map((d) => (
                        <option key={d.ip} value={d.ip}>
                          {d.label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label={t('network.map_filter_service_all')}
                      value={mapServiceFilter}
                      onChange={(e) => setMapServiceFilter(e.target.value)}
                      className="cockpit-subtile min-h-[36px] min-w-[140px] flex-1 sm:flex-none px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-sky-500 dark:text-slate-100"
                    >
                      <option value="all">{t('network.map_filter_service_all')}</option>
                      {availableMapServices.map((svc) => (
                        <option key={svc} value={svc}>
                          {svc}
                        </option>
                      ))}
                    </select>

                    <div className="relative min-w-[185px] flex-1 sm:flex-none">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        value={mapSearchQuery}
                        onChange={(e) => setMapSearchQuery(e.target.value)}
                        placeholder={t('network.map_search_placeholder')}
                        className="cockpit-subtile w-full min-h-[36px] pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div ref={setMapContainerEl} className="cockpit-map-box relative w-full bg-slate-100 dark:bg-slate-900" />
            </div>

            {/* Service Breakdown Donut with interactive tooltip */}
            <div className="cockpit-bento lg:col-span-4 xl:col-span-3 p-5">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {t('network.top_services')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('network.donut_hint')}
              </p>

              <div className="mt-4 flex flex-col items-center">
                {serviceBreakdown.length === 0 ? (
                  <p className="py-12 text-xs text-slate-500 dark:text-slate-400">{t('network.no_external_conns')}</p>
                ) : (
                  <svg viewBox="0 0 160 160" className="h-[clamp(8.5rem,18vw,11.5rem)] w-[clamp(8.5rem,18vw,11.5rem)]">
                    {(() => {
                      let cumAngle = -Math.PI / 2;
                      return serviceBreakdown.map((seg) => {
                        const frac = seg.count / totalGeo;
                        const angle = frac * Math.PI * 2;
                        const start = cumAngle;
                        const end = cumAngle + angle;
                        cumAngle = end;
                        const rOut = 68;
                        const rIn = 42;
                        const x1 = 80 + rOut * Math.cos(start);
                        const y1 = 80 + rOut * Math.sin(start);
                        const x2 = 80 + rOut * Math.cos(end);
                        const y2 = 80 + rOut * Math.sin(end);
                        const x3 = 80 + rIn * Math.cos(end);
                        const y3 = 80 + rIn * Math.sin(end);
                        const x4 = 80 + rIn * Math.cos(start);
                        const y4 = 80 + rIn * Math.sin(start);
                        const largeArc = angle > Math.PI ? 1 : 0;
                        const d =
                          frac >= 0.999
                            ? `M 80 ${80 - rOut} A ${rOut} ${rOut} 0 1 1 79.9 ${80 - rOut} Z M 80 ${80 - rIn} A ${rIn} ${rIn} 0 1 0 79.9 ${80 - rIn} Z`
                            : `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x4} ${y4} Z`;
                        return (
                          <path
                            key={seg.name}
                            d={d}
                            fill={seg.color}
                            className="cursor-pointer transition-opacity hover:opacity-85"
                            onPointerMove={(e) =>
                              setDonutTooltip({
                                visible: true,
                                clientX: e.clientX,
                                clientY: e.clientY,
                                title: seg.name,
                                entries: [
                                  {
                                    label: t('network.connections_label'),
                                    value: `${seg.count} (${Math.round(frac * 100)} %)`,
                                    color: seg.color,
                                  },
                                ],
                              })
                            }
                            onPointerLeave={() => setDonutTooltip(null)}
                          />
                        );
                      });
                    })()}
                  </svg>
                )}

                <div className="mt-3 w-full space-y-1.5 text-xs">
                  {serviceBreakdown.map((seg) => (
                    <div key={seg.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 truncate text-slate-600 dark:text-slate-300">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="truncate">{seg.name}</span>
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {seg.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <FloatingTooltip data={donutTooltip} />
            </div>
          </div>

          <section className="cockpit-bento p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.detailed_conns')}
                </h3>
                {aiLastModel && Object.keys(aiInsights).length > 0 && (
                  <span className="cockpit-pill-cyan inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    <Sparkles className="h-3 w-3" />
                    <span>{t('network.ai_identified_count', { count: Object.keys(aiInsights).length })}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <motion.button
                  type="button"
                  disabled={aiLoading || geoConnections.filter((c) => !c.is_server_node).length === 0}
                  onClick={() => void handleSimplifyConnectionsWithAi()}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/12 px-3 py-1 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
                  <span>{aiLoading ? t('network.ai_identifying') : t('network.ai_identify_btn')}</span>
                </motion.button>
                {Object.keys(aiInsights).length > 0 && (
                  <motion.button
                    type="button"
                    onClick={() => setAiSimplifiedView((v) => !v)}
                    className="cockpit-subtile inline-flex min-h-[32px] items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <span>{aiSimplifiedView ? t('network.ai_mode_simple') : t('network.ai_mode_tech')}</span>
                  </motion.button>
                )}
              </div>
            </div>

            <div className="mt-3 cockpit-auto-grid-cards">
              {geoConnections
                .filter((c) => !c.is_server_node)
                .slice(0, 36)
                .map((c, idx) => {
                  const remoteIp = (c.remote_ip || c.ip || '').trim();
                  const isBanned = Boolean(remoteIp && (bannedIpSet.has(remoteIp) || c.direction === 'blocked' || c.state === 'BANNED'));
                  const isHomeDev = isHomeDeviceConn(c, serverLocalIp);
                  const hasCoords =
                    typeof c.lat === 'number' &&
                    typeof c.lng === 'number' &&
                    Number.isFinite(c.lat) &&
                    Number.isFinite(c.lng);
                  const dirBadge = isBanned
                    ? { label: t('network.map_direction_blocked'), cls: 'cockpit-pill-red' }
                    : c.direction === 'incoming'
                    ? { label: t('network.map_direction_in'), cls: 'cockpit-pill-amber' }
                    : { label: t('network.map_direction_out'), cls: 'cockpit-pill-emerald' };

                  const aiSig = getConnAiSignature(c);
                  const insight = aiInsights[aiSig];
                  const showSimplified = Boolean(insight && aiSimplifiedView);
                  const techCardKey = `${remoteIp}-${c.remote_port ?? idx}-${idx}`;
                  const techExpanded = Boolean(expandedTechKeys[techCardKey]);

                  return (
                    <div
                      key={techCardKey}
                      className="cockpit-subtile min-w-0 overflow-hidden flex flex-col justify-between gap-2.5 p-3.5 text-xs transition-colors hover:border-sky-400/60"
                    >
                      <div className="flex items-start justify-between gap-2.5 min-w-0">
                        <button
                          type="button"
                          disabled={!hasCoords}
                          onClick={() => focusConnectionOnMap(c, idx)}
                          title={hasCoords ? t('network.focus_on_map') : undefined}
                          className="min-w-0 flex-1 overflow-hidden text-left cursor-pointer disabled:cursor-default group"
                        >
                          <div className="flex flex-wrap items-center gap-1.5 mb-1 min-w-0">
                            <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${dirBadge.cls}`}>
                              {dirBadge.label}
                            </span>
                            {showSimplified && insight ? (
                              <>
                                <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-semibold text-sky-700 dark:text-sky-300 group-hover:underline">
                                  <Sparkles className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{insight.app_name}</span>
                                </span>
                                <span className="cockpit-pill-cyan shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                                  {insight.category}
                                </span>
                              </>
                            ) : (
                              <span
                                className="min-w-0 max-w-full truncate font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors"
                                title={c.service || t('hardware.net.geo.external_conn')}
                              >
                                {c.service || t('hardware.net.geo.external_conn')}
                              </span>
                            )}
                            {c.is_history && c.hit_count && (
                              <span className="cockpit-pill-amber shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums">
                                {t('network.map_hits_badge', { count: c.hit_count })}
                              </span>
                            )}
                            <span className="text-slate-400 shrink-0">·</span>
                            <span className="min-w-0 max-w-full text-slate-600 dark:text-slate-300 truncate">
                              {c.city || t('hardware.net.geo.location_fallback')} {c.country ? `(${c.country})` : ''}
                            </span>
                          </div>

                          {showSimplified && insight ? (
                            <div className="space-y-1 min-w-0">
                              <p className="text-[12px] font-medium leading-snug text-slate-800 dark:text-slate-100 break-words">
                                {insight.summary}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 min-w-0">
                                {(c.local_hostname || c.local_ip) && (
                                  <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-indigo-600 dark:text-indigo-400">
                                    <span className="truncate">📱 {c.local_hostname || c.local_ip}</span>
                                  </span>
                                )}
                                <span className="truncate max-w-full">{insight.role}</span>
                                {c.last_seen && (
                                  <span className="font-mono text-[10px] shrink-0">
                                    {t('network.map_last_seen', {
                                      time: new Date(c.last_seen * 1000).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale),
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                                {remoteIp}{c.remote_port ? `:${c.remote_port}` : ''} {c.org || c.isp ? `· ${c.org || c.isp}` : ''}
                              </p>

                              {(c.domain || c.local_hostname || isHomeDev) && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] min-w-0">
                                  {c.domain && (
                                    <span className="block min-w-0 max-w-full font-mono text-sky-600 dark:text-sky-400 truncate" title={c.domain}>
                                      🌐 {c.domain}
                                    </span>
                                  )}
                                  {(c.local_hostname || c.local_ip) && (
                                    <span className="block min-w-0 max-w-full text-indigo-600 dark:text-indigo-400 truncate">
                                      📱 {c.local_hostname || c.local_ip}{c.local_ip && c.local_hostname && c.local_hostname !== c.local_ip ? ` (${c.local_ip})` : ''}
                                    </span>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </button>

                        {remoteIp && !c.is_server_node && (
                          isBanned ? (
                            <motion.button
                              type="button"
                              onClick={() => void handleUnbanIp(remoteIp, c.jail || 'all')}
                              className="cockpit-btn-wol inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors shrink-0"
                            >
                              <Shield className="h-3.5 w-3.5" />
                              <span>{t('network.unblock')}</span>
                            </motion.button>
                          ) : (
                            <motion.button
                              type="button"
                              onClick={() => void handleBanIp(remoteIp, c.jail)}
                              className="cockpit-btn-off inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors shrink-0"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              <span>{t('network.block')}</span>
                            </motion.button>
                          )
                        )}
                      </div>

                      {showSimplified && (
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTechKeys((prev) => ({ ...prev, [techCardKey]: !prev[techCardKey] }))
                            }
                            className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                          >
                            {techExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            <span>{t('network.ai_tech_details')}</span>
                          </button>
                          {techExpanded && (
                            <div className="mt-1.5 space-y-0.5 rounded-lg bg-slate-200/50 p-2 font-mono text-[10.5px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                              {c.domain && <div className="truncate">🌐 {c.domain}</div>}
                              <div className="truncate">
                                {c.local_ip || serverLocalIp}:{c.local_port || 0} → {remoteIp}:{c.remote_port || c.port || 0}
                              </div>
                              <div className="truncate">
                                {c.process || c.protocol || 'TCP'} {c.org || c.isp ? `· ${c.org || c.isp}` : ''}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Franja simétrica de tráfico en tiempo real por conexión */}
                      <div className="mt-0.5 grid grid-cols-3 gap-1.5 border-t border-slate-200/70 pt-2 font-mono text-[11px] tabular-nums dark:border-slate-800">
                        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
                          <span className="truncate font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('network.map_traffic_rx')}</span>
                          <span className="truncate font-semibold text-sky-600 dark:text-sky-400">{formatSpeed(c.rx_speed ?? 0)}</span>
                        </div>
                        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 border-x border-slate-200/70 px-1.5 sm:px-2 dark:border-slate-800">
                          <span className="truncate font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('network.map_traffic_tx')}</span>
                          <span className="truncate font-semibold text-emerald-600 dark:text-emerald-400">{formatSpeed(c.tx_speed ?? 0)}</span>
                        </div>
                        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5">
                          <span className="truncate font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('network.map_traffic_total')}</span>
                          <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                            {formatBytes(c.bytes_total ?? ((c.bytes_received ?? 0) + (c.bytes_sent ?? 0)))}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              {geoConnections.filter((c) => !c.is_server_node).length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('network.no_external_instant')}
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* 2b. Test de Velocidad (Speed Test + Historial SQLite) */}
      {subTab === 'speedtest' && (
        <div className="space-y-4">
          <section className="cockpit-bento p-5" data-testid="speedtest-runner-card">
            <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cockpit-pill-cyan inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <Gauge className="h-4 w-4" />
                  </span>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('network.speedtest_title')}
                  </h2>
                  {speedtestStatus?.scope && (
                    <span className="cockpit-pill-emerald rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                      {speedtestStatus.scope === 'local_node'
                        ? t('network.speedtest_scope_local')
                        : t('network.speedtest_scope_wan')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t('network.speedtest_sub')}
                </p>
              </div>
              <button
                type="button"
                data-testid="speedtest-start-btn"
                disabled={Boolean(speedtestStatus?.running)}
                onClick={() => void handleStartSpeedtest()}
                className="cockpit-btn-accent inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold transition-all disabled:opacity-60"
              >
                {speedtestStatus?.running ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>{t('network.speedtest_running')}</span>
                  </>
                ) : (
                  <>
                    <Gauge className="h-4 w-4" />
                    <span>{t('network.speedtest_start')}</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Phase & Progress Bar */}
            <div className="cockpit-subtile mt-4 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {speedtestStatus?.phase === 'ping'
                    ? t('network.speedtest_phase_ping')
                    : speedtestStatus?.phase === 'download'
                      ? t('network.speedtest_phase_download')
                      : speedtestStatus?.phase === 'upload'
                        ? t('network.speedtest_phase_upload')
                        : speedtestStatus?.phase === 'done'
                          ? t('network.speedtest_phase_done')
                          : speedtestStatus?.phase === 'error'
                            ? t('network.speedtest_phase_error')
                            : t('network.speedtest_phase_idle')}
                </span>
                <span className="font-mono font-bold tabular-nums text-sky-600 dark:text-sky-400">
                  {Math.round(speedtestStatus?.progress_pct ?? 0)}%
                  {(speedtestStatus?.running && speedtestStatus.current_mbps > 0)
                    ? ` · ${speedtestStatus.current_mbps.toFixed(1)} Mbps`
                    : ''}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                <div
                  className="cockpit-progress-fill h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-500 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, speedtestStatus?.progress_pct ?? 0))}%` }}
                />
              </div>
              {(speedtestStatus?.server_name || speedtestStatus?.isp) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {speedtestStatus.server_name && (
                    <span>
                      {t('network.speedtest_server')}: <strong className="text-slate-700 dark:text-slate-200">{speedtestStatus.server_name}</strong>
                      {speedtestStatus.server_location ? ` (${speedtestStatus.server_location})` : ''}
                    </span>
                  )}
                  {speedtestStatus.isp && (
                    <span>
                      {t('network.speedtest_isp')}: <strong className="text-slate-700 dark:text-slate-200">{speedtestStatus.isp}</strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 4 Symmetric KPI Tiles */}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="cockpit-subtile rounded-xl p-3.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t('network.speedtest_download')}</span>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                  {(speedtestStatus?.download_mbps ?? 0).toFixed(1)} <span className="text-xs font-medium opacity-80">Mbps</span>
                </p>
              </div>
              <div className="cockpit-subtile rounded-xl p-3.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t('network.speedtest_upload')}</span>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {(speedtestStatus?.upload_mbps ?? 0).toFixed(1)} <span className="text-xs font-medium opacity-80">Mbps</span>
                </p>
              </div>
              <div className="cockpit-subtile rounded-xl p-3.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t('network.speedtest_ping')}</span>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {(speedtestStatus?.ping_ms ?? 0).toFixed(1)} <span className="text-xs font-medium text-slate-500">ms</span>
                </p>
              </div>
              <div className="cockpit-subtile rounded-xl p-3.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {t('network.speedtest_jitter')} · {t('network.speedtest_loss')}
                </span>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {(speedtestStatus?.jitter_ms ?? 0).toFixed(1)} <span className="text-xs font-medium text-slate-500">ms · {(speedtestStatus?.packet_loss_pct ?? 0).toFixed(0)}%</span>
                </p>
              </div>
            </div>
          </section>

          {/* Persisted SQLite Speed Test History */}
          <section className="cockpit-bento p-5" data-testid="speedtest-history-card">
            <div className="flex flex-col gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('network.speedtest_history_title')}
                  </h2>
                  <span className="cockpit-subtile rounded-full px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                    {speedtestHistory?.total ?? 0}
                  </span>
                  {fbUser && syncedSpeedtests.length > 0 && (
                    <span className="cockpit-pill-violet inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                      <Cloud className="h-3 w-3" />
                      <span>{t('firebase.synced_speedtests_title', { count: syncedSpeedtests.length })}</span>
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t('network.speedtest_history_sub')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {(speedtestHistory?.total ?? 0) > 0 && (
                  <>
                    <span className="cockpit-pill-cyan rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums">
                      {t('network.speedtest_best_dl')}: {(speedtestHistory?.best_download_mbps ?? 0).toFixed(1)} Mbps
                    </span>
                    <span className="cockpit-pill-emerald rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums">
                      {t('network.speedtest_best_ul')}: {(speedtestHistory?.best_upload_mbps ?? 0).toFixed(1)} Mbps
                    </span>
                    <button
                      type="button"
                      disabled={speedtestClearing}
                      onClick={() => void handleClearSpeedtestHistory()}
                      className="cockpit-btn-off inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('network.speedtest_clear_history')}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label={t('network.refresh')}
                  onClick={() => void loadSpeedtestData(true)}
                  className="cockpit-subtile flex min-h-[38px] min-w-[38px] items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
                >
                  <RefreshCw className={`h-4 w-4 ${speedtestLoadingHistory ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {(!speedtestHistory?.items || speedtestHistory.items.length === 0) ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('network.speedtest_history_empty')}
              </p>
            ) : (
              <>
                {/* Tarjetas compactas en móvil / tablet estrecho (cero scroll horizontal ni desbordamientos) */}
                <div className="mt-3 space-y-2 md:hidden">
                  {speedtestHistory.items.map((item) => (
                    <div key={`m-${item.id}`} className="cockpit-subtile p-3 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-white break-words">
                            {item.server_name}
                          </p>
                          <p className="font-mono text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400 break-words">
                            {item.created_at} · {item.scope === 'local_node' ? t('network.speedtest_scope_local') : t('network.speedtest_scope_wan')}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={t('network.speedtest_delete_row')}
                          onClick={() => void handleClearSpeedtestHistory(item.id)}
                          className="cockpit-subtile inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] tabular-nums">
                        <div className="rounded-lg bg-white/70 px-2 py-1 dark:bg-slate-900/60">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('network.speedtest_col_dl')}: </span>
                          <strong className="text-sky-600 dark:text-sky-400">{item.download_mbps.toFixed(1)} Mbps</strong>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-1 dark:bg-slate-900/60">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('network.speedtest_col_ul')}: </span>
                          <strong className="text-emerald-600 dark:text-emerald-400">{item.upload_mbps.toFixed(1)} Mbps</strong>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-1 dark:bg-slate-900/60">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('network.speedtest_col_ping')}: </span>
                          <strong className="text-slate-700 dark:text-slate-200">{item.ping_ms.toFixed(1)} ms</strong>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-1 dark:bg-slate-900/60">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('network.speedtest_col_jitter')}: </span>
                          <strong className="text-slate-600 dark:text-slate-300">{item.jitter_ms.toFixed(1)} ms</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tabla analítica limpia en escritorio (md+) */}
                <div className="mt-3 hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200/70 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="py-2.5 pr-3 font-medium">{t('network.speedtest_col_date')}</th>
                        <th className="py-2.5 px-3 font-medium">{t('network.speedtest_col_server')}</th>
                        <th className="py-2.5 px-3 text-right font-medium">{t('network.speedtest_col_dl')}</th>
                        <th className="py-2.5 px-3 text-right font-medium">{t('network.speedtest_col_ul')}</th>
                        <th className="py-2.5 px-3 text-right font-medium">{t('network.speedtest_col_ping')}</th>
                        <th className="py-2.5 px-3 text-right font-medium">{t('network.speedtest_col_jitter')}</th>
                        <th className="py-2.5 pl-2 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {speedtestHistory.items.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3 font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {item.created_at}
                          </td>
                          <td className="py-2.5 px-3 min-w-[140px]">
                            <p className="font-medium text-slate-900 dark:text-white break-words">
                              {item.server_name}
                            </p>
                            <p className="font-mono text-[10px] text-slate-400 break-words">
                              {item.scope === 'local_node' ? t('network.speedtest_scope_local') : t('network.speedtest_scope_wan')}
                              {item.isp ? ` · ${item.isp}` : ''}
                            </p>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-sky-600 dark:text-sky-400 whitespace-nowrap">
                            {item.download_mbps.toFixed(1)} Mbps
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {item.upload_mbps.toFixed(1)} Mbps
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {item.ping_ms.toFixed(1)} ms
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {item.jitter_ms.toFixed(1)} ms
                          </td>
                          <td className="py-2.5 pl-2 text-right">
                            <button
                              type="button"
                              aria-label={t('network.speedtest_delete_row')}
                              onClick={() => void handleClearSpeedtestHistory(item.id)}
                              className="cockpit-subtile inline-flex min-h-[32px] min-w-[32px] items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* 3. Protección y avisos (Fail2ban + Telegram) */}
      {subTab === 'security' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="cockpit-bento p-5">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200/70 dark:border-slate-800">
              <span className="cockpit-pill-red inline-flex h-8 w-8 items-center justify-center rounded-xl">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.firewall_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(metrics?.security?.fail2ban?.active ?? metrics?.security?.fail2ban?.available)
                    ? t('network.firewall_active', { count: bannedDetails.length })
                    : t('network.firewall_idle')}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="text"
                value={banIpInput}
                onChange={(e) => setBanIpInput(e.target.value)}
                placeholder={t('network.ip_to_block')}
                className="cockpit-subtile min-h-[44px] flex-1 px-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
              />
              <select
                value={banJailInput}
                onChange={(e) => setBanJailInput(e.target.value)}
                className="cockpit-subtile min-h-[44px] px-3 text-xs text-slate-900 outline-none dark:text-white"
              >
                <option value="sshd">{t('network.jail_ssh')}</option>
                <option value="caddy-scan">{t('network.jail_caddy')}</option>
                <option value="all">{t('network.jail_all')}</option>
              </select>
              <button
                type="button"
                onClick={() => handleBanIp()}
                className="cockpit-btn-accent min-h-[44px] rounded-xl px-4 text-xs font-semibold transition-all"
              >
                {t('network.block')}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {bannedDetails.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('network.no_banned_ips')}
                </p>
              ) : (
                bannedDetails.slice(0, 20).map((b, i) => (
                  <div key={`${b.ip}-${i}`} className="cockpit-subtile flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div>
                      <p className="font-mono font-semibold text-slate-900 dark:text-white">{b.ip}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {t('network.rule_label', { jail: b.jail || t('network.rule_general') })} {b.country ? `· ${b.country}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnbanIp(b.ip, b.jail)}
                      className="cockpit-btn-wol inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      <span>{t('network.unblock')}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="cockpit-bento p-5">
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="cockpit-pill-cyan inline-flex h-8 w-8 items-center justify-center rounded-xl">
                  <Bell className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('network.telegram_title')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {telegramData?.bot_status?.online ? t('network.telegram_listening') : t('network.telegram_bg')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleTelegramTest}
                className="cockpit-subtile min-h-[40px] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t('network.telegram_send_test')}
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={telegramMsg}
                onChange={(e) => setTelegramMsg(e.target.value)}
                placeholder={t('network.telegram_placeholder')}
                className="cockpit-subtile min-h-[44px] flex-1 px-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
              />
              <button
                type="button"
                onClick={handleTelegramSend}
                className="cockpit-btn-accent inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-all"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{t('network.send')}</span>
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {(telegramData?.activity ?? []).slice(0, 6).map((act, i) => {
                const timeLabel = act.timestamp || (act as unknown as { time_str?: string }).time_str || '';
                return (
                  <div key={i} className="cockpit-subtile p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-white">
                      <span>{act.title || t('network.notice_fallback')}</span>
                      <span className="font-mono text-[11px] font-normal text-slate-400">{timeLabel}</span>
                    </div>
                    <p className="mt-0.5 text-slate-600 dark:text-slate-300">{act.content}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* 4. Dirección e Internet (DuckDNS + Pi-hole) */}
      {subTab === 'dns' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="cockpit-bento p-5">
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="cockpit-pill-cyan inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                  <Globe className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {t('network.ddns_title')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('network.ddns_sub')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={duckUpdating}
                onClick={handleForceDuckDns}
                className="cockpit-btn-accent inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${duckUpdating ? 'animate-spin' : ''}`} />
                <span>{t('network.update_now')}</span>
              </button>
            </div>

            <div className="mt-4 space-y-2 text-xs">
              <div className="cockpit-subtile flex justify-between px-3 py-2">
                <span className="text-slate-500 dark:text-slate-400">{t('network.ddns_public_domain')}</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {duckDns?.full_domain || metrics?.system?.public_domain || '--'}
                </span>
              </div>
              <div className="cockpit-subtile flex justify-between px-3 py-2">
                <span className="text-slate-500 dark:text-slate-400">{t('network.ddns_last_ip')}</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                  {duckDns?.last_registered_ip || metrics?.system?.local_ip || '--'}
                </span>
              </div>
              <div className="cockpit-subtile flex justify-between px-3 py-2">
                <span className="text-slate-500 dark:text-slate-400">{t('network.ddns_service')}</span>
                <span
                  className={`font-semibold ${
                    (duckDns?.available ?? duckDns?.installed)
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {(duckDns?.available ?? duckDns?.installed) ? t('network.ddns_configured') : t('network.ddns_not_configured')}
                </span>
              </div>
              <div className="cockpit-subtile flex justify-between px-3 py-2">
                <span className="text-slate-500 dark:text-slate-400">{t('network.ddns_last_check')}</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {duckDns?.last_update_time || '--'}
                </span>
              </div>
            </div>

            {duckLogs.length > 0 && (
              <div
                data-cockpit-scroll-contain="true"
                className="cockpit-subtile cockpit-scroll-panel mt-4 overflow-y-auto overscroll-contain p-3 font-mono text-[11px] text-slate-600 dark:text-slate-300"
              >
                {duckLogs.slice(-6).map((l, idx) => (
                  <div key={idx}>{l}</div>
                ))}
              </div>
            )}
          </section>

          <section className="cockpit-bento p-5">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-200/70 dark:border-slate-800">
              <span className="cockpit-pill-emerald inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                <Shield className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.pihole_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(metrics?.security?.pihole?.online ?? metrics?.security?.pihole?.available)
                    ? t('network.pihole_active')
                    : t('network.pihole_missing')}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="cockpit-pill-cyan rounded-xl p-3.5">
                <span className="text-[11px] font-semibold opacity-80">{t('network.queries_today')}</span>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {(metrics?.security?.pihole?.total_queries ?? metrics?.security?.pihole?.dns_queries_today ?? 0).toLocaleString(locale === 'es' ? 'es-ES' : locale)}
                </p>
              </div>
              <div className="cockpit-pill-emerald rounded-xl p-3.5">
                <span className="text-[11px] font-semibold opacity-80">{t('network.ads_blocked')}</span>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {(metrics?.security?.pihole?.blocked_today ?? metrics?.security?.pihole?.ads_blocked_today ?? 0).toLocaleString(locale === 'es' ? 'es-ES' : locale)}
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
      </ViewStage>

      {/* Custom Logo Picker Modal */}
      <AnimatePresence>
        {logoModalClient && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
            transition={{ duration: 0.18 }}
            data-cockpit-scroll-contain="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overscroll-contain"
            onClick={() => setLogoModalClient(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              data-cockpit-scroll-contain="true"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
              transition={COCKPIT_SPRING}
              className="cockpit-bento cockpit-modal-enter w-full max-w-md p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.choose_icon_for', { name: logoModalClient.name || logoModalClient.ip })}
                </h3>
                <button
                  type="button"
                  disabled={logoSaving}
                  onClick={() => handleSaveLogo('')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t('network.reset_btn')}</span>
                </button>
              </div>
              <input
                type="search"
                value={logoSearchQ}
                onChange={(e) => setLogoSearchQ(e.target.value)}
                placeholder={t('network.search_brand')}
                className="cockpit-subtile mt-3 min-h-[42px] w-full px-3 text-xs text-slate-900 outline-none focus:border-sky-500 dark:text-white"
              />
              <div
                data-cockpit-scroll-contain="true"
                className="cockpit-scroll-panel mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto overscroll-contain"
              >
                {logoResults.map((res, idx) => (
                  <button
                    key={`${res.logo_url}-${idx}`}
                    type="button"
                    disabled={logoSaving}
                    onClick={() => handleSaveLogo(res.logo_url)}
                    className="cockpit-subtile flex flex-col items-center gap-1.5 p-2.5 text-center transition-colors hover:border-sky-500"
                  >
                    <img
                      src={res.logo_url}
                      alt={res.title}
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 object-contain"
                    />
                    <span className="w-full truncate text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      {res.title}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setLogoModalClient(null)}
                  className="cockpit-subtile min-h-[40px] px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {t('network.close_btn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
