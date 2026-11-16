import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Globe,
  Image as ImageIcon,
  Lock,
  MapPin,
  Maximize2,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  Unlock,
  Wifi,
} from 'lucide-react';
import { COCKPIT_SPRING, MorphPill, ViewStage } from './MotionPrimitives';
import { ExpandChartSpec } from './OverviewView';
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import {
  GeoConnectionItem,
  MetricsPayload,
  NetInterfaceInfo,
  TelegramBotStatusPayload,
  ThemeMode,
  WifiClient,
} from '../types/telemetry';
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
      { id: 'wan_rx', metricKey: 'net_wan_rx', label: t('hardware.net.wan_download'), data: wanRxData, color: '#0284c7', unit: 'MB/s', decimals: 2, fillAlpha: 0.16 },
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
  }, [hist2h, nic.name, nic.ip, locale, t]);

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
    <div className="cockpit-bento p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('hardware.net.iface_title', { name: nic.name })}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {nic.ip || t('hardware.net.no_local_ip')} · {nic.is_up ? t('hardware.net.active') : t('hardware.net.disconnected')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-right font-mono text-[11px] tabular-nums">
            <div className="text-sky-600 dark:text-sky-400" title={t('hardware.net.wan_download')}>
              <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.wan_short')}</span>
              ↓ {formatSpeed(wanRxNow)}
            </div>
            <div className="text-indigo-600 dark:text-indigo-400" title={t('hardware.net.lan_download')}>
              <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.lan_short')}</span>
              ↓ {formatSpeed(lanRxNow)}
            </div>
            <div className="text-emerald-600 dark:text-emerald-400" title={t('hardware.net.wan_upload')}>
              <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.wan_short')}</span>
              ↑ {formatSpeed(wanTxNow)}
            </div>
            <div className="text-amber-600 dark:text-amber-400" title={t('hardware.net.lan_upload')}>
              <span className="text-[10px] font-sans text-slate-400 dark:text-slate-500 mr-1">{t('hardware.net.lan_short')}</span>
              ↑ {formatSpeed(lanTxNow)}
            </div>
          </div>
          {onExpandChart && (
            <button
              type="button"
              aria-label={t('hardware.net.inspect_aria', { name: nic.name })}
              onClick={handleExpand}
              className="cockpit-subtile flex min-h-[36px] min-w-[36px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-300"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-3">
        <TelemetryChart
          series={nicSeries}
          timestamps={nicTimestamps}
          epochTs={nicEpochTs}
          height={112}
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

type RedSubTab = 'home' | 'map' | 'security' | 'dns';

function resolveRedSubTab(hint?: string): RedSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'security' || h === 'seguridad') return 'security';
  if (h === 'dns' || h === 'duckdns') return 'dns';
  if (h === 'map' || h === 'mapa') return 'map';
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
}) => {
  const { t, locale } = useI18n();
  const [subTab, setSubTab] = useState<RedSubTab>(() => resolveRedSubTab(initialSubTab) || 'home');
  const [clientQuery, setClientQuery] = useState('');
  const [showTechNet, setShowTechNet] = useState(false);

  // Map filters & search (v4.13.0)
  const [mapFilter, setMapFilter] = useState<MapConnFilter>('all');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapZoomTick, setMapZoomTick] = useState(0);

  useEffect(() => {
    const mapped = resolveRedSubTab(initialSubTab);
    if (mapped) setSubTab(mapped);
  }, [initialSubTab, navTick]);

  // Logo picker modal
  const [logoModalClient, setLogoModalClient] = useState<WifiClient | null>(null);
  const [logoSearchQ, setLogoSearchQ] = useState('');
  const [logoResults, setLogoResults] = useState<LogoSearchResult[]>([]);
  const [logoSaving, setLogoSaving] = useState(false);

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
    if (!q) return list;
    return list.filter(
      (c) =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.hostname || '').toLowerCase().includes(q) ||
        String(c.ip || '').toLowerCase().includes(q) ||
        String(c.vendor || '').toLowerCase().includes(q)
    );
  }, [metrics?.wifi_clients, clientQuery]);

  const interfaces: NetInterfaceInfo[] = useMemo(
    () => metrics?.net?.interfaces_list ?? Object.values(metrics?.net?.interfaces ?? {}),
    [metrics?.net?.interfaces_list, metrics?.net?.interfaces]
  );

  const serverLocalIp = metrics?.net?.connections_map?.server_node?.ip || metrics?.net?.local_ip || metrics?.system?.local_ip || '';

  // Excluir IPs LAN falsas del mapa (v4.11.1), conservando únicamente conexiones públicas WAN y el nodo servidor
  const rawGeoConnections = useMemo(() => {
    const list = metrics?.net?.connections_map?.connections ?? [];
    return list.filter((c) => !c.is_lan || c.is_server_node);
  }, [metrics?.net?.connections_map?.connections]);

  const bannedDetails = useMemo(
    () => metrics?.security?.fail2ban?.banned_details ?? [],
    [metrics?.security?.fail2ban?.banned_details]
  );

  const bannedIpSet = useMemo(() => {
    const set = new Set<string>();
    for (const b of bannedDetails) {
      if (b.ip) set.add(b.ip.trim());
    }
    for (const c of rawGeoConnections) {
      const ip = (c.remote_ip || c.ip || '').trim();
      if (ip && (c.direction === 'blocked' || c.state === 'BANNED')) {
        set.add(ip);
      }
    }
    return set;
  }, [bannedDetails, rawGeoConnections]);

  const mapFilterCounts = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    let devices = 0;
    let blocked = 0;
    for (const c of rawGeoConnections) {
      if (c.is_server_node) continue;
      const ip = (c.remote_ip || c.ip || '').trim();
      const isBlk = c.direction === 'blocked' || c.state === 'BANNED' || (ip ? bannedIpSet.has(ip) : false);
      if (isBlk) blocked++;
      else if (c.direction === 'incoming') incoming++;
      else outgoing++;
      if (isHomeDeviceConn(c, serverLocalIp)) devices++;
    }
    return {
      all: rawGeoConnections.filter((c) => !c.is_server_node).length,
      incoming,
      outgoing,
      devices,
      blocked,
    };
  }, [rawGeoConnections, bannedIpSet, serverLocalIp]);

  const geoConnections = useMemo(() => {
    const q = mapSearchQuery.trim().toLowerCase();
    return rawGeoConnections.filter((c) => {
      if (c.is_server_node) return true;
      const ip = (c.remote_ip || c.ip || '').trim();
      const isBlk = c.direction === 'blocked' || c.state === 'BANNED' || (ip ? bannedIpSet.has(ip) : false);
      if (mapFilter === 'incoming' && (c.direction !== 'incoming' || isBlk)) return false;
      if (mapFilter === 'outgoing' && (c.direction === 'incoming' || isBlk)) return false;
      if (mapFilter === 'devices' && !isHomeDeviceConn(c, serverLocalIp)) return false;
      if (mapFilter === 'blocked' && !isBlk) return false;
      if (!q) return true;
      return (
        ip.toLowerCase().includes(q) ||
        String(c.domain || '').toLowerCase().includes(q) ||
        String(c.service || '').toLowerCase().includes(q) ||
        String(c.local_hostname || '').toLowerCase().includes(q) ||
        String(c.local_ip || '').toLowerCase().includes(q) ||
        String(c.city || '').toLowerCase().includes(q) ||
        String(c.country || '').toLowerCase().includes(q) ||
        String(c.isp || c.org || '').toLowerCase().includes(q) ||
        String(c.process || '').toLowerCase().includes(q)
      );
    });
  }, [rawGeoConnections, mapFilter, mapSearchQuery, bannedIpSet, serverLocalIp]);

  const serviceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of geoConnections) {
      if (c.is_server_node) continue;
      const k = c.service || t('hardware.net.geo.direct_traffic');
      counts[k] = (counts[k] || 0) + 1;
    }
    const palette = ['#0284c7', '#10b981', '#7c3aed', '#f59e0b', '#0ea5e9', '#ec4899'];
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count], idx) => ({ name, count, color: palette[idx % palette.length] }));
  }, [geoConnections, t]);

  // Load Telegram & DuckDNS on tab switch
  useEffect(() => {
    if (subTab === 'security') {
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
  }, [subTab]);

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
          : `<span style="background:rgba(14,165,233,0.16);color:#0ea5e9;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;">${escapeMapHtml(t('network.map_direction_out'))}</span>`;

      const svc = escapeMapHtml(c.service || t('hardware.net.geo.conn_generic'));
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

      const backBtnHtml =
        count > 1
          ? `<button type="button" data-back-cluster="${escapeMapHtml(cluster.key)}" style="margin-bottom:7px;display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(14,165,233,0.35);background:rgba(14,165,233,0.1);color:#0284c7;border-radius:8px;padding:3px 9px;font-size:10.5px;font-weight:700;cursor:pointer;width:100%;justify-content:center;">${escapeMapHtml(t('network.map_back_to_list', { count }))}</button>`
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
        <div style="font-size:11px;opacity:.78;margin-bottom:6px;">📍 ${escapeMapHtml(placeName)}</div>
        ${
          domain
            ? `<div style="margin-bottom:4px;padding:3px 7px;border-radius:7px;background:rgba(14,165,233,0.1);font-family:ui-monospace,monospace;font-size:11px;color:#0284c7;word-break:break-all;">🌐 ${domain}</div>`
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
        <div style="font-size:10.5px;opacity:.78;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🏢 ${orgAsn}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:5px 6px;border-radius:8px;background:rgba(148,163,184,0.12);font-family:ui-monospace,monospace;font-size:10.5px;text-align:center;">
          <div>
            <div style="font-size:9.5px;opacity:.7;">${escapeMapHtml(t('network.map_traffic_rx'))}</div>
            <div style="font-weight:700;color:#10b981;">${rxSpd}</div>
          </div>
          <div>
            <div style="font-size:9.5px;opacity:.7;">${escapeMapHtml(t('network.map_traffic_tx'))}</div>
            <div style="font-weight:700;color:#0ea5e9;">${txSpd}</div>
          </div>
          <div>
            <div style="font-size:9.5px;opacity:.7;">${escapeMapHtml(t('network.map_traffic_total'))}</div>
            <div style="font-weight:700;color:#f59e0b;">${totBytes}</div>
          </div>
        </div>
        ${actionHtml}
      </div>`;
    }

    // Vista Lista de IPs del grupo (count > 1) con selección interactiva (v4.11.0)
    const rowsHtml = items
      .map((c, idx) => {
        const connKey = getConnIdentityKey(c, idx);
        const remoteIp = (c.remote_ip || c.ip || '').trim();
        const isBlocked = c.direction === 'blocked' || c.state === 'BANNED' || (remoteIp ? bannedIpSet.has(remoteIp) : false);
        const arrow = isBlocked ? '🛡️' : c.direction === 'incoming' ? '↓' : '↑';
        const svc = escapeMapHtml(c.service || t('hardware.net.geo.conn_generic'));
        const domainOrIp = escapeMapHtml(c.domain || remoteIp);
        const localHost = c.local_hostname && c.local_hostname !== 'Servidor' ? ` · 📱 ${escapeMapHtml(c.local_hostname)}` : '';
        const spd = (c.rx_speed || 0) + (c.tx_speed || 0);
        const spdBadge = spd > 0 ? `<span style="color:#10b981;font-family:ui-monospace,monospace;font-size:10px;">${escapeMapHtml(formatSpeed(spd))}</span>` : '';
        return `<div style="padding:5px 4px;border-top:1px solid rgba(148,163,184,0.2);display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <button type="button" data-select-cluster="${escapeMapHtml(cluster.key)}" data-select-conn="${escapeMapHtml(connKey)}" style="flex:1;min-width:0;text-align:left;background:transparent;border:0;color:inherit;padding:0;cursor:pointer;">
            <div style="font-weight:700;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${arrow} ${svc}${localHost}</div>
            <div style="font-family:ui-monospace,monospace;font-size:10.5px;opacity:.86;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${domainOrIp} ${c.domain && remoteIp ? `<span style="opacity:.65;">(${escapeMapHtml(remoteIp)})</span>` : ''}</div>
          </button>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            ${spdBadge}
            <button type="button" data-select-cluster="${escapeMapHtml(cluster.key)}" data-select-conn="${escapeMapHtml(connKey)}" style="border:1px solid rgba(14,165,233,0.4);background:rgba(14,165,233,0.12);color:#0284c7;border-radius:7px;padding:2px 7px;font-size:10px;font-weight:700;cursor:pointer;">${escapeMapHtml(t('network.map_inspect_conn'))}</button>
          </div>
        </div>`;
      })
      .join('');

    return `<div style="min-width:255px;max-width:335px;font-size:12px;line-height:1.36;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong style="font-size:12.5px;">🔀 ${escapeMapHtml(placeName)}</strong>
        <span style="background:rgba(14,165,233,0.16);color:#0284c7;border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:700;font-family:ui-monospace,monospace;">${count}</span>
      </div>
      <div style="max-height:225px;overflow-y:auto;padding-right:2px;">${rowsHtml}</div>
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
                  : '#0ea5e9';
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
                : '#0284c7';
        const fillColor = isNode
          ? '#10b981'
          : hasBlocked
            ? '#ef4444'
            : hasIncoming
              ? '#10b981'
              : hasDevice
                ? '#8b5cf6'
                : '#0ea5e9';

        // Etiqueta dinámica priorizando dominio Pi-hole (v4.12.0) y contador de grupo (v4.11.0)
        const primaryLabel = primary.domain || primary.service || primary.remote_ip || primary.ip || t('hardware.net.geo.conn_generic');
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

        const signature = `${lat.toFixed(3)},${lng.toFixed(3)}|${count}|${selectedKeyForCluster || ''}|${fillColor}|${items
          .slice(0, 12)
          .map(
            (c) =>
              `${c.remote_ip || c.ip || ''}:${c.domain || ''}:${c.service || ''}:${c.rx_speed || 0}:${c.tx_speed || 0}:${c.bytes_total || 0}:${
                bannedIpSet.has((c.remote_ip || c.ip || '').trim()) ? '1' : '0'
              }`
          )
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
          color: '#38bdf8',
          fillColor: '#38bdf8',
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
  }, [geoConnections, metrics?.net?.connections_map?.server_node, bannedIpSet, serverLocalIp, subTab, mapContainerEl, mapZoomTick, t]);

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
    { id: 'map', label: t('network.subtabs.map'), icon: <MapPin className="h-4 w-4" /> },
    { id: 'security', label: t('network.subtabs.security'), icon: <Shield className="h-4 w-4" /> },
    { id: 'dns', label: t('network.subtabs.dns'), icon: <Globe className="h-4 w-4" /> },
  ];

  // SVG Donut calculation
  const totalGeo = Math.max(1, serviceBreakdown.reduce((acc, s) => acc + s.count, 0));

  return (
    <div className="space-y-5">
      <LayoutGroup id="net-subtabs">
        <div className="cockpit-segmented flex items-center gap-1.5 overflow-x-auto p-1.5 no-scrollbar">
          {tabs.map((tab) => {
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
                {active && <MorphPill layoutId="net-subtab-pill" className="rounded-xl" />}
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

      {/* 1. Aparatos en casa */}
      {subTab === 'home' && (
        <div className="space-y-4">
          {/* Network Interfaces with 20m Sparkline + Tooltip */}
          <section className="cockpit-auto-grid">
            {interfaces.map((nic) => (
              <NicHistoryCard
                key={nic.name}
                nic={nic}
                theme={theme}
                locale={locale}
                onExpandChart={onExpandChart}
              />
            ))}
          </section>

          {/* Connected Devices with Custom Logo + WoL + Shutdown */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
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

                  return (
                    <div
                      key={`${mac}-${idx}`}
                      className="cockpit-subtile flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
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
                          <div className="flex items-center gap-2">
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
                            className="cockpit-btn-wol inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45"
                          >
                            <Power className="h-3.5 w-3.5" />
                            <span>{t('overview.wake_btn')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy || (!client.ip && !client.mac)}
                            onClick={() => onPowerAction('shutdown', client)}
                            className="cockpit-btn-off inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45"
                          >
                            <PowerOff className="h-3.5 w-3.5" />
                            <span>{t('overview.sleep_btn')}</span>
                          </button>
                        </div>
                      )}
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

      {/* 2. Mapa de conexiones */}
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
                    <button
                      type="button"
                      onClick={handleFitAllBounds}
                      className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span>{t('network.map_fit_all')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void apiFetchJson('/api/net/geoip/resolve', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ips: [], force_sync: true }),
                        }).then(() => {
                          onNotify(t('network.locations_updated'));
                          onRefreshMetrics();
                        });
                      }}
                      className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>{t('network.refresh')}</span>
                    </button>
                  </div>
                </div>

                {/* Barra de Filtros Interactivos + Buscador en Vivo (v4.13.0) */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
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
                        <button
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
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative min-w-[210px]">
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
              <div ref={setMapContainerEl} className="relative h-[360px] lg:h-[440px] xl:h-[480px] w-full bg-slate-100 dark:bg-slate-900" />
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
                  <svg viewBox="0 0 160 160" className="h-44 w-44">
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
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white pb-3 border-b border-slate-200/70 dark:border-slate-800">
              {t('network.detailed_conns')}
            </h3>
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

                  return (
                    <div
                      key={`${remoteIp}-${c.remote_port ?? idx}-${idx}`}
                      className="cockpit-subtile flex flex-col justify-between gap-2.5 p-3.5 text-xs transition-colors hover:border-sky-400/60"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <button
                          type="button"
                          disabled={!hasCoords}
                          onClick={() => focusConnectionOnMap(c, idx)}
                          title={hasCoords ? t('network.focus_on_map') : undefined}
                          className="min-w-0 flex-1 text-left cursor-pointer disabled:cursor-default group"
                        >
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${dirBadge.cls}`}>
                              {dirBadge.label}
                            </span>
                            <span className="font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                              {c.service || t('hardware.net.geo.external_conn')}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-600 dark:text-slate-300 truncate">
                              {c.city || t('hardware.net.geo.location_fallback')} {c.country ? `(${c.country})` : ''}
                            </span>
                          </div>

                          <p className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                            {remoteIp}{c.remote_port ? `:${c.remote_port}` : ''} {c.org || c.isp ? `· ${c.org || c.isp}` : ''}
                          </p>

                          {/* Dominio Pi-hole y Dispositivo origen del hogar (v4.12.0 & v4.13.0) */}
                          {(c.domain || c.local_hostname || isHomeDev) && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                              {c.domain && (
                                <span className="inline-flex items-center gap-1 font-mono text-sky-600 dark:text-sky-400 truncate max-w-full">
                                  🌐 {c.domain}
                                </span>
                              )}
                              {(c.local_hostname || c.local_ip) && (
                                <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 truncate max-w-full">
                                  📱 {c.local_hostname || c.local_ip}{c.local_ip && c.local_hostname && c.local_hostname !== c.local_ip ? ` (${c.local_ip})` : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </button>

                        {remoteIp && !c.is_server_node && (
                          isBanned ? (
                            <button
                              type="button"
                              onClick={() => void handleUnbanIp(remoteIp, c.jail || 'all')}
                              className="cockpit-btn-wol inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors shrink-0"
                            >
                              <Shield className="h-3.5 w-3.5" />
                              <span>{t('network.unblock')}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleBanIp(remoteIp, c.jail)}
                              className="cockpit-btn-off inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors shrink-0"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              <span>{t('network.block')}</span>
                            </button>
                          )
                        )}
                      </div>

                      {/* Franja simétrica de tráfico en tiempo real por conexión (v10.4.0) */}
                      <div className="mt-0.5 grid grid-cols-3 gap-1.5 border-t border-slate-200/70 pt-2 font-mono text-[11px] tabular-nums dark:border-slate-800">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('network.map_traffic_rx')}</span>
                          <span className="font-semibold text-sky-600 dark:text-sky-400">{formatSpeed(c.rx_speed ?? 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-1 border-x border-slate-200/70 px-2 dark:border-slate-800">
                          <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('network.map_traffic_tx')}</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatSpeed(c.tx_speed ?? 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">{t('network.map_traffic_total')}</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
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
              <div className="cockpit-subtile mt-4 max-h-36 overflow-y-auto p-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
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
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
            onClick={() => setLogoModalClient(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
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
              <div className="mt-3 grid max-h-60 grid-cols-3 gap-2 overflow-y-auto">
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
