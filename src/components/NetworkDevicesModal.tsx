import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  Activity,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  KeyRound,
  Laptop,
  Lock,
  Network,
  Power,
  PowerOff,
  RefreshCw,
  Router,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Trash2,
  Tv,
  Wifi,
  X,
} from 'lucide-react';
import { COCKPIT_EASE, COCKPIT_SPRING, MorphPill } from './MotionPrimitives';
import {
  MetricsPayload,
  NetworkDevicesDbResponse,
  RouterCredentialsStatus,
  WifiClient,
} from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import { formatSpeed } from '../utils/formatters';
import { useI18n } from '../i18n';

export type NetworkInspectTab = 'devices' | 'bandwidth';
type DbSourceFilter = 'all' | 'online' | 'pihole' | 'asus' | 'gateway';
type BandwidthSortKey = 'wan_down' | 'wan_up' | 'wan_total' | 'lan_total' | 'name';

interface NetworkDevicesModalProps {
  initialTab: NetworkInspectTab;
  metrics: MetricsPayload | null;
  onPowerAction: (action: 'wake' | 'shutdown', client: WifiClient) => void;
  actionPendingMac: string | null;
  onClose: () => void;
}

function renderDeviceIcon(devType?: string, isGateway?: boolean, isServer?: boolean) {
  if (isServer || devType === 'server') return <Server className="h-4 w-4" />;
  if (isGateway || devType === 'network') return <Router className="h-4 w-4" />;
  if (devType === 'nas') return <HardDrive className="h-4 w-4" />;
  if (devType === 'tv') return <Tv className="h-4 w-4" />;
  if (devType === 'computer') return <Laptop className="h-4 w-4" />;
  if (devType === 'phone' || devType === 'mobile') return <Smartphone className="h-4 w-4" />;
  return <Wifi className="h-4 w-4" />;
}

export const NetworkDevicesModal: React.FC<NetworkDevicesModalProps> = ({
  initialTab,
  metrics,
  onPowerAction,
  actionPendingMac,
  onClose,
}) => {
  const { t, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<NetworkInspectTab>(initialTab);
  const [sourceFilter, setSourceFilter] = useState<DbSourceFilter>('online');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<BandwidthSortKey>('wan_down');
  const [sortDesc, setSortDesc] = useState(true);
  const [onlyActiveTraffic, setOnlyActiveTraffic] = useState(false);

  const [dbResponse, setDbResponse] = useState<NetworkDevicesDbResponse | null>(null);
  const [loadingDb, setLoadingDb] = useState(false);
  const [routerFormOpen, setRouterFormOpen] = useState(false);
  const [routerCredStatus, setRouterCredStatus] = useState<RouterCredentialsStatus | null>(null);
  const [loadingRouterCreds, setLoadingRouterCreds] = useState(false);
  const [routerIpInput, setRouterIpInput] = useState('');
  const [routerPortInput, setRouterPortInput] = useState('22');
  const [routerUserInput, setRouterUserInput] = useState('');
  const [routerPassInput, setRouterPassInput] = useState('');
  const [showRouterPass, setShowRouterPass] = useState(false);
  const [routerActionBusy, setRouterActionBusy] = useState<'test' | 'save' | 'clear' | null>(null);
  const [routerFeedback, setRouterFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const fetchDevicesDb = useCallback(async (forceRefresh = false, silent = false) => {
    if (!silent) {
      setLoadingDb(true);
    }
    const url = forceRefresh ? '/api/network/devices-db?refresh=1' : '/api/network/devices-db';
    const res = await apiFetchJson<NetworkDevicesDbResponse>(url);
    if (!mountedRef.current) return;
    if (res.ok && res.data?.ok) {
      setDbResponse(res.data);
    }
    if (!silent) {
      setLoadingDb(false);
    }
  }, []);

  useEffect(() => {
    void fetchDevicesDb(false, false);
    const timerId = window.setInterval(() => {
      void fetchDevicesDb(false, true);
    }, 5500);
    return () => window.clearInterval(timerId);
  }, [fetchDevicesDb]);

  const liveClients = useMemo(() => metrics?.wifi_clients ?? [], [metrics?.wifi_clients]);
  const liveByMac = useMemo(() => {
    const map = new Map<string, WifiClient>();
    for (const c of liveClients) {
      const m = (c.mac || '').toUpperCase();
      if (m) map.set(m, c);
    }
    return map;
  }, [liveClients]);

  // Fusionar velocidades vivas más recientes sobre cualquier catálogo DB
  const mergedDevices = useMemo(() => {
    const baseList = dbResponse?.devices && dbResponse.devices.length > 0 ? dbResponse.devices : liveClients;
    const seen = new Set<string>();
    const out: WifiClient[] = [];
    for (const dev of baseList) {
      const mac = (dev.mac || '').toUpperCase();
      const liveMatch = mac ? liveByMac.get(mac) : undefined;
      const mergedItem = liveMatch ? { ...dev, ...liveMatch, pihole_queries: liveMatch.pihole_queries ?? dev.pihole_queries } : dev;
      const dedupKey = mac || `${dev.ip || ''}:${dev.name || ''}`;
      if (dedupKey) seen.add(dedupKey);
      out.push(mergedItem);
    }
    for (const lc of liveClients) {
      const mac = (lc.mac || '').toUpperCase();
      const dedupKey = mac || `${lc.ip || ''}:${lc.name || ''}`;
      if (!seen.has(dedupKey)) {
        out.push(lc);
      }
    }
    return out;
  }, [dbResponse?.devices, liveClients, liveByMac]);

  const summary = useMemo(
    () => dbResponse?.summary ?? metrics?.wifi_summary ?? {},
    [dbResponse?.summary, metrics?.wifi_summary]
  );

  const gatewayTitle = useMemo(() => {
    const gModel = summary.gateway_model?.trim();
    const gName = summary.gateway_name?.trim();
    if (gName && gModel && !gName.toLowerCase().includes(gModel.toLowerCase())) {
      return `${gName} · ${gModel}`;
    }
    return gName || gModel || t('overview.db_source_gateway');
  }, [summary.gateway_model, summary.gateway_name, t]);

  const asusTitle = useMemo(() => {
    return summary.asus_model ? `${t('overview.db_source_asus')} (${summary.asus_model})` : t('overview.db_source_asus');
  }, [summary.asus_model, t]);

  const sourceCounts = useMemo(() => {
    let online = 0;
    let pihole = 0;
    let asus = 0;
    let gateway = 0;
    for (const d of mergedDevices) {
      const isOnline = d.online !== false && d.is_online !== false;
      if (isOnline) online += 1;
      const srcs = d.sources ?? [];
      if (srcs.includes('pihole') || (d.pihole_queries ?? 0) > 0 || d.iface === 'pihole-db' || d.iface === 'pihole-wol') {
        pihole += 1;
      }
      if (srcs.includes('asus') || Boolean(d.asus_node) || d.iface === 'eth5' || d.iface === 'eth6' || d.iface === 'AiMesh') {
        asus += 1;
      }
      if (srcs.includes('gateway') || d.is_gateway || (d.wan_speed_down ?? 0) > 0 || (d.wan_speed_up ?? 0) > 0) {
        gateway += 1;
      }
    }
    return {
      all: mergedDevices.length,
      online,
      pihole,
      asus,
      gateway,
    };
  }, [mergedDevices]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredDevicesList = useMemo(() => {
    return mergedDevices.filter((d) => {
      const isOnline = d.online !== false && d.is_online !== false;
      const srcs = d.sources ?? [];
      if (sourceFilter === 'online' && !isOnline) return false;
      if (
        sourceFilter === 'pihole' &&
        !srcs.includes('pihole') &&
        (d.pihole_queries ?? 0) <= 0 &&
        d.iface !== 'pihole-db' &&
        d.iface !== 'pihole-wol'
      ) {
        return false;
      }
      if (
        sourceFilter === 'asus' &&
        !srcs.includes('asus') &&
        !d.asus_node &&
        d.iface !== 'eth5' &&
        d.iface !== 'eth6' &&
        d.iface !== 'AiMesh'
      ) {
        return false;
      }
      if (
        sourceFilter === 'gateway' &&
        !srcs.includes('gateway') &&
        !d.is_gateway &&
        (d.wan_speed_down ?? 0) <= 0 &&
        (d.wan_speed_up ?? 0) <= 0
      ) {
        return false;
      }
      if (normalizedQuery) {
        const hay = `${d.name || ''} ${d.hostname || ''} ${d.ip || ''} ${d.mac || ''} ${d.vendor || ''} ${d.band || ''}`.toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [mergedDevices, sourceFilter, normalizedQuery]);

  // Datos y ordenación para la pestaña de Velocidad de Internet
  const bandwidthDevices = useMemo(() => {
    const activePool = liveClients.filter((c) => {
      if (c.is_gateway) return false;
      const isOnline = c.online !== false && c.is_online !== false;
      const wanD = Number(c.wan_speed_down ?? c.speed_down ?? 0);
      const wanU = Number(c.wan_speed_up ?? c.speed_up ?? 0);
      const lanD = Number(c.lan_speed_down ?? 0);
      const lanU = Number(c.lan_speed_up ?? 0);
      const anyTraffic = wanD + wanU + lanD + lanU > 0;
      if (!isOnline && !anyTraffic) return false;
      if (onlyActiveTraffic && !anyTraffic) return false;
      if (normalizedQuery) {
        const hay = `${c.name || ''} ${c.hostname || ''} ${c.ip || ''} ${c.mac || ''} ${c.vendor || ''} ${c.band || ''}`.toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }
      return true;
    });

    const metricValue = (c: WifiClient): number => {
      const wanD = Number(c.wan_speed_down ?? c.speed_down ?? 0);
      const wanU = Number(c.wan_speed_up ?? c.speed_up ?? 0);
      const lanT = Number(c.lan_speed_down ?? 0) + Number(c.lan_speed_up ?? 0);
      if (sortBy === 'wan_down') return wanD;
      if (sortBy === 'wan_up') return wanU;
      if (sortBy === 'wan_total') return wanD + wanU;
      if (sortBy === 'lan_total') return lanT;
      return 0;
    };

    return [...activePool].sort((a, b) => {
      if (sortBy === 'name') {
        const cmp = (a.name || a.ip || '').localeCompare(b.name || b.ip || '', locale);
        return sortDesc ? -cmp : cmp;
      }
      const va = metricValue(a);
      const vb = metricValue(b);
      if (vb !== va) return sortDesc ? vb - va : va - vb;
      const fallbackA = Number(a.speed_down ?? 0) + Number(a.speed_up ?? 0);
      const fallbackB = Number(b.speed_down ?? 0) + Number(b.speed_up ?? 0);
      if (fallbackB !== fallbackA) return sortDesc ? fallbackB - fallbackA : fallbackA - fallbackB;
      return (a.name || a.ip || '').localeCompare(b.name || b.ip || '', locale);
    });
  }, [liveClients, onlyActiveTraffic, normalizedQuery, sortBy, sortDesc, locale]);

  const peakBwDeviceRate = useMemo(() => {
    let peak = 1024;
    for (const c of bandwidthDevices) {
      const top = Math.max(
        Number(c.wan_speed_down ?? 0),
        Number(c.wan_speed_up ?? 0),
        Number(c.lan_speed_down ?? 0) + Number(c.lan_speed_up ?? 0)
      );
      if (top > peak) peak = top;
    }
    return peak;
  }, [bandwidthDevices]);

  const globalDownRate = summary.router_wan_available
    ? Number(summary.router_wan_rx_bytes_sec ?? metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0)
    : Number(metrics?.net?.wan_rx_bytes_sec ?? metrics?.net?.rx_bytes_sec ?? 0);
  const globalUpRate = summary.router_wan_available
    ? Number(summary.router_wan_tx_bytes_sec ?? metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0)
    : Number(metrics?.net?.wan_tx_bytes_sec ?? metrics?.net?.tx_bytes_sec ?? 0);
  const globalLanRate =
    Number(summary.router_lan_rx_bytes_sec ?? metrics?.net?.lan_rx_bytes_sec ?? 0) +
    Number(summary.router_lan_tx_bytes_sec ?? metrics?.net?.lan_tx_bytes_sec ?? 0);

  const toggleSort = (key: BandwidthSortKey) => {
    if (sortBy === key) {
      setSortDesc((d) => !d);
    } else {
      setSortBy(key);
      setSortDesc(key !== 'name');
    }
  };

  const loadRouterCredStatus = useCallback(async () => {
    setLoadingRouterCreds(true);
    const res = await apiFetchJson<RouterCredentialsStatus>('/api/network/router-credentials');
    if (!mountedRef.current) return;
    setLoadingRouterCreds(false);
    if (res.ok && res.data) {
      setRouterCredStatus(res.data);
      const suggestedIp = res.data.router_ip || summary.router_ip || summary.gateway_ip || '';
      if (suggestedIp) setRouterIpInput(suggestedIp);
      setRouterPortInput(String(res.data.router_port || 22));
      if (res.data.router_user) setRouterUserInput(res.data.router_user);
    }
  }, [summary.gateway_ip, summary.router_ip]);

  const handleToggleRouterForm = () => {
    setRouterFeedback(null);
    setRouterPassInput('');
    setRouterFormOpen((prev) => {
      const next = !prev;
      if (next) {
        void loadRouterCredStatus();
      }
      return next;
    });
  };

  const handleRouterCredAction = async (action: 'test' | 'save' | 'clear') => {
    setRouterFeedback(null);
    if (action !== 'clear') {
      if (!routerIpInput.trim() || !routerUserInput.trim() || !routerPassInput) {
        setRouterFeedback({ ok: false, text: t('overview.router_cfg_fill_required') });
        return;
      }
    }
    setRouterActionBusy(action);
    const body =
      action === 'clear'
        ? { action }
        : {
            action,
            router_ip: routerIpInput.trim(),
            router_port: Number(routerPortInput.trim() || 22),
            router_user: routerUserInput.trim(),
            router_pass: routerPassInput,
          };
    const res = await apiFetchJson<RouterCredentialsStatus>('/api/network/router-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!mountedRef.current) return;
    setRouterActionBusy(null);
    if (res.ok && res.data?.ok !== false) {
      if (action === 'test') {
        const modelSuffix = res.data?.model ? ` (${res.data.model})` : '';
        setRouterFeedback({ ok: true, text: `${t('overview.router_cfg_test_ok')}${modelSuffix}` });
      } else if (action === 'save') {
        setRouterPassInput('');
        const modelSuffix = res.data?.model ? ` (${res.data.model})` : '';
        setRouterFeedback({ ok: true, text: `${t('overview.router_cfg_saved_ok')}${modelSuffix}` });
        setRouterCredStatus((prev) => ({
          ...(prev || {}),
          is_local: true,
          configured: true,
          encrypted: true,
          decrypt_failed: false,
          router_ip: res.data?.router_ip || routerIpInput.trim(),
          router_port: res.data?.router_port || Number(routerPortInput.trim() || 22),
          router_user: res.data?.router_user || routerUserInput.trim(),
        }));
        void fetchDevicesDb(true, false);
      } else {
        setRouterPassInput('');
        setRouterUserInput('');
        setRouterFeedback({ ok: true, text: t('overview.router_cfg_cleared_ok') });
        setRouterCredStatus((prev) => ({
          ...(prev || {}),
          configured: false,
          encrypted: false,
          decrypt_failed: false,
          router_user: '',
        }));
        void fetchDevicesDb(true, false);
      }
    } else {
      setRouterFeedback({
        ok: false,
        text: res.data?.error || res.data?.message || res.error || t('status.action_error'),
      });
    }
  };

  const titleText =
    activeTab === 'devices' ? t('overview.devices_modal_title') : t('overview.bandwidth_modal_title');
  const subtitleText =
    activeTab === 'devices' ? t('overview.devices_modal_sub') : t('overview.bandwidth_modal_sub');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
      transition={{ duration: 0.18 }}
      data-cockpit-scroll-contain="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5 backdrop-blur-sm overscroll-contain"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        data-cockpit-scroll-contain="true"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.16, ease: COCKPIT_EASE } }}
        transition={COCKPIT_SPRING}
        className="cockpit-bento cockpit-modal-enter w-[min(95vw,74rem)] max-h-[92dvh] overflow-y-auto overscroll-contain p-[clamp(0.85rem,1.8vw,1.35rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera estilo Inspección Táctil */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {titleText}
              </h2>
              <span className="cockpit-pill-emerald inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 cockpit-live-dot" />
                {t('charts.realtime')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              {subtitleText}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void fetchDevicesDb(true)}
              aria-label={t('network.refresh')}
              className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-300"
            >
              <RefreshCw className={`h-4 w-4 ${loadingDb ? 'animate-spin text-sky-600' : ''}`} />
            </button>
            <button
              type="button"
              aria-label={t('charts.close_aria')}
              onClick={onClose}
              className="cockpit-subtile flex min-h-[40px] min-w-[40px] items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Selector de Modo Principal + Buscador Táctil */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
          <LayoutGroup id="net-inspect-mode-tabs">
            <div className="cockpit-subtile inline-flex flex-wrap items-center gap-1 p-1 rounded-xl">
              {(
                [
                  {
                    key: 'devices' as NetworkInspectTab,
                    label: `${t('overview.tab_devices_db')} (${sourceCounts.online}/${sourceCounts.all})`,
                    icon: <Database className="h-3.5 w-3.5" />,
                  },
                  {
                    key: 'bandwidth' as NetworkInspectTab,
                    label: t('overview.tab_bandwidth_live'),
                    icon: <ArrowDownUp className="h-3.5 w-3.5" />,
                  },
                ] as const
              ).map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                      active
                        ? 'text-sky-700 dark:text-sky-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    {active && <MorphPill layoutId="net-inspect-mode-pill" className="rounded-lg" />}
                    <span className="relative z-10 inline-flex items-center gap-1.5">
                      {tab.icon}
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>

          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('overview.db_search_placeholder')}
              className="cockpit-subtile w-full rounded-xl py-2 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-2 focus:outline-sky-500 dark:text-slate-100"
            />
          </div>
        </div>

        {activeTab === 'devices' ? (
          <div className="mt-4 space-y-4">
            {/* Selector de Bases de Datos: Conectados · Todas · Pi-hole · Router · Puerta de enlace */}
            <LayoutGroup id="net-db-sources">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'online' as DbSourceFilter, label: `${t('overview.db_source_online')} (${sourceCounts.online})`, icon: <Activity className="h-3.5 w-3.5" /> },
                    { key: 'all' as DbSourceFilter, label: `${t('overview.db_source_all')} (${sourceCounts.all})`, icon: <Network className="h-3.5 w-3.5" /> },
                    { key: 'pihole' as DbSourceFilter, label: `${t('overview.db_source_pihole')} (${sourceCounts.pihole})`, icon: <Database className="h-3.5 w-3.5" /> },
                    { key: 'asus' as DbSourceFilter, label: `${asusTitle} (${sourceCounts.asus})`, icon: <Wifi className="h-3.5 w-3.5" /> },
                    { key: 'gateway' as DbSourceFilter, label: `${gatewayTitle} (${sourceCounts.gateway})`, icon: <Router className="h-3.5 w-3.5" /> },
                  ] as const
                ).map((item) => {
                  const active = sourceFilter === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSourceFilter(item.key)}
                      className={`relative min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                        active
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'cockpit-subtile text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                      }`}
                    >
                      {active && <MorphPill layoutId="net-db-source-pill" className="rounded-xl" />}
                      <span className="relative z-10 inline-flex items-center gap-1.5">
                        {item.icon}
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </LayoutGroup>

            {loadingDb && !dbResponse ? (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('overview.db_loading')}
              </div>
            ) : filteredDevicesList.length === 0 ? (
              <div className="cockpit-subtile py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('overview.db_empty')}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {filteredDevicesList.slice(0, 180).map((client, idx) => {
                  const isOnline = client.online !== false && client.is_online !== false;
                  const mac = client.mac || `idx-${idx}`;
                  const pending = actionPendingMac === mac;
                  const label = client.name || client.hostname || client.ip || t('overview.device_fallback');
                  const srcs = client.sources ?? [];
                  const wanD = Number(client.wan_speed_down ?? 0);
                  const wanU = Number(client.wan_speed_up ?? 0);
                  const lanT = Number(client.lan_speed_down ?? 0) + Number(client.lan_speed_up ?? 0);

                  return (
                    <div
                      key={`${mac}-${client.ip || idx}`}
                      className="cockpit-subtile flex flex-col justify-between gap-2.5 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              isOnline
                                ? 'cockpit-pill-cyan'
                                : 'bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {renderDeviceIcon(client.dev_type || client.device_type, client.is_gateway, client.is_server)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {label}
                              </p>
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  isOnline ? 'bg-emerald-500 cockpit-live-dot' : 'bg-slate-400'
                                }`}
                              />
                            </div>
                            <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              {client.ip || '--'} · {client.mac || '--'}
                            </p>
                            {client.vendor && (
                              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {client.vendor}
                              </p>
                            )}
                          </div>
                        </div>

                        {(wanD > 0 || wanU > 0 || lanT > 0) && (
                          <div className="text-right font-mono text-[11px] tabular-nums shrink-0">
                            {wanD > 0 || wanU > 0 ? (
                              <>
                                <div className="font-semibold text-sky-700 dark:text-sky-300">↓ {formatSpeed(wanD)}</div>
                                <div className="font-semibold text-emerald-700 dark:text-emerald-300">↑ {formatSpeed(wanU)}</div>
                              </>
                            ) : (
                              <div className="font-semibold text-indigo-700 dark:text-indigo-300">LAN {formatSpeed(lanT)}</div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-1 text-[10px] font-semibold">
                          {client.band && (
                            <span className="cockpit-subtile rounded-md px-1.5 py-0.5 text-slate-700 dark:text-slate-300">
                              {client.band}
                            </span>
                          )}
                          {srcs.includes('pihole') && (
                            <span className="cockpit-pill-red rounded-md px-1.5 py-0.5">
                              Pi-hole
                            </span>
                          )}
                          {srcs.includes('asus') && (
                            <span className="cockpit-pill-cyan rounded-md px-1.5 py-0.5">
                              {summary.asus_model || t('overview.db_source_router_short')}
                            </span>
                          )}
                          {srcs.includes('gateway') && (
                            <span className="cockpit-pill-violet rounded-md px-1.5 py-0.5">
                              {summary.gateway_name || t('overview.db_source_gateway')}
                            </span>
                          )}
                          {(client.pihole_queries ?? 0) > 0 && (
                            <span className="font-mono text-slate-500 dark:text-slate-400">
                              {t('overview.db_queries_dns', { count: (client.pihole_queries ?? 0).toLocaleString(locale) })}
                            </span>
                          )}
                          {client.last_seen && !isOnline && (
                            <span className="font-mono text-slate-500 dark:text-slate-400">
                              {t('overview.db_last_seen', { time: client.last_seen })}
                            </span>
                          )}
                        </div>

                        {!client.is_server && !client.is_gateway && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={pending || !client.mac}
                              onClick={() => onPowerAction('wake', client)}
                              title={t('overview.wake_title')}
                              className="cockpit-btn-wol inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-45 whitespace-nowrap"
                            >
                              <Power className="h-3 w-3 shrink-0" />
                              <span>{t('overview.wake_btn')}</span>
                            </button>
                            <button
                              type="button"
                              disabled={pending || (!client.ip && !client.mac)}
                              onClick={() => onPowerAction('shutdown', client)}
                              title={t('overview.sleep_title')}
                              className="cockpit-btn-off inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-45 whitespace-nowrap"
                            >
                              <PowerOff className="h-3 w-3 shrink-0" />
                              <span>{t('overview.sleep_btn')}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Resumen Global del Router (Internet WAN + Red LAN + Telemetría) */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="cockpit-subtile p-3">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('overview.bw_global_down')}</span>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-sky-700 dark:text-sky-300">
                  ↓ {formatSpeed(globalDownRate)}
                </p>
              </div>
              <div className="cockpit-subtile p-3">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('overview.bw_global_up')}</span>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  ↑ {formatSpeed(globalUpRate)}
                </p>
              </div>
              <div className="cockpit-subtile p-3">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('overview.bw_internal_lan')}</span>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
                  {formatSpeed(globalLanRate)}
                </p>
              </div>
              <div className="cockpit-subtile p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('overview.bw_source_label')}</span>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                    <span className="truncate">{summary.router_traffic_source || summary.gateway_name || '--'}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleRouterForm}
                  title={t('overview.router_cfg_btn')}
                  aria-label={t('overview.router_cfg_btn')}
                  className="cockpit-subtile shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:text-[#1e6b38] dark:text-slate-400 dark:hover:text-[#c6f19d] cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {!summary.router_wan_available && (
              <div className="cockpit-subtile flex flex-col gap-2.5 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300 border border-amber-500/25 bg-amber-500/5 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {summary.router_creds_decrypt_failed
                    ? t('overview.bw_router_decrypt_notice')
                    : t('overview.bw_router_unlinked_notice')}
                </span>
                <button
                  type="button"
                  data-testid="configure-router-btn"
                  onClick={handleToggleRouterForm}
                  className="cockpit-btn-accent shrink-0 inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-semibold cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>{t('overview.router_cfg_btn')}</span>
                </button>
              </div>
            )}

            {routerFormOpen && (
              <div
                data-testid="router-credentials-form"
                className="cockpit-subtile border border-emerald-500/25 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <KeyRound className="h-4 w-4 text-[#1e6b38] dark:text-[#c6f19d]" />
                      <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                        {t('overview.router_cfg_title')}
                      </h4>
                      <span className="cockpit-pill-emerald inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold">
                        <ShieldCheck className="h-3 w-3" />
                        <span>AES-256-GCM</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {t('overview.router_cfg_desc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRouterFormOpen(false)}
                    aria-label={t('charts.close_aria')}
                    className="cockpit-subtile inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {loadingRouterCreds ? (
                  <div className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                    <RefreshCw className="mx-auto mb-1.5 h-4 w-4 animate-spin" />
                  </div>
                ) : routerCredStatus?.is_local === false ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-3 text-xs text-amber-800 dark:text-amber-300">
                    <Lock className="h-4 w-4 shrink-0" />
                    <span>{t('overview.router_cfg_lan_only')}</span>
                  </div>
                ) : (
                  <>
                    {routerCredStatus?.sshpass_available === false && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                        {t('overview.router_cfg_sshpass_missing')}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4 text-xs">
                      <label className="block sm:col-span-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('overview.router_cfg_ip_label')}
                        </span>
                        <input
                          type="text"
                          value={routerIpInput}
                          onChange={(e) => setRouterIpInput(e.target.value)}
                          placeholder="192.168.1.1"
                          autoComplete="off"
                          className="cockpit-subtile mt-1 min-h-[38px] w-full px-3 font-mono text-xs text-slate-900 dark:text-white"
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('overview.router_cfg_port_label')}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={routerPortInput}
                          onChange={(e) => setRouterPortInput(e.target.value)}
                          placeholder="22"
                          className="cockpit-subtile mt-1 min-h-[38px] w-full px-3 font-mono text-xs text-slate-900 dark:text-white tabular-nums"
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('overview.router_cfg_user_label')}
                        </span>
                        <input
                          type="text"
                          value={routerUserInput}
                          onChange={(e) => setRouterUserInput(e.target.value)}
                          placeholder="admin"
                          autoComplete="off"
                          className="cockpit-subtile mt-1 min-h-[38px] w-full px-3 font-mono text-xs text-slate-900 dark:text-white"
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('overview.router_cfg_pass_label')}
                        </span>
                        <div className="relative mt-1">
                          <input
                            type={showRouterPass ? 'text' : 'password'}
                            value={routerPassInput}
                            onChange={(e) => setRouterPassInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleRouterCredAction('save');
                              }
                            }}
                            placeholder={t('overview.router_cfg_pass_placeholder')}
                            autoComplete="new-password"
                            className="cockpit-subtile min-h-[38px] w-full pl-3 pr-9 font-mono text-xs text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRouterPass((s) => !s)}
                            aria-label={t('overview.router_cfg_toggle_pass')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                          >
                            {showRouterPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </label>
                    </div>

                    {routerFeedback && (
                      <div
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                          routerFeedback.ok
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {routerFeedback.ok && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                        <span>{routerFeedback.text}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={Boolean(routerActionBusy)}
                          onClick={() => void handleRouterCredAction('test')}
                          className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${routerActionBusy === 'test' ? 'animate-spin' : ''}`} />
                          <span>
                            {routerActionBusy === 'test'
                              ? t('overview.router_cfg_testing')
                              : t('overview.router_cfg_test_btn')}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(routerActionBusy)}
                          onClick={() => void handleRouterCredAction('save')}
                          className="cockpit-btn-accent inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>
                            {routerActionBusy === 'save'
                              ? t('overview.router_cfg_saving')
                              : t('overview.router_cfg_save_btn')}
                          </span>
                        </button>
                      </div>
                      {(routerCredStatus?.configured ||
                        routerCredStatus?.decrypt_failed ||
                        summary.router_creds_decrypt_failed ||
                        summary.router_encrypted) && (
                        <button
                          type="button"
                          disabled={Boolean(routerActionBusy)}
                          onClick={() => void handleRouterCredAction('clear')}
                          className="cockpit-subtile inline-flex min-h-[38px] items-center gap-1.5 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{t('overview.router_cfg_clear_btn')}</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Controles Táctiles de Ordenación Rápida + Filtro Tráfico Activo */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <LayoutGroup id="net-bw-sort">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { key: 'wan_down' as BandwidthSortKey, label: t('overview.bw_sort_down') },
                      { key: 'wan_up' as BandwidthSortKey, label: t('overview.bw_sort_up') },
                      { key: 'wan_total' as BandwidthSortKey, label: t('overview.bw_sort_total') },
                      { key: 'lan_total' as BandwidthSortKey, label: t('overview.bw_sort_lan') },
                      { key: 'name' as BandwidthSortKey, label: t('overview.bw_sort_name') },
                    ] as const
                  ).map((opt) => {
                    const active = sortBy === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => toggleSort(opt.key)}
                        className={`relative min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                          active
                            ? 'text-sky-700 dark:text-sky-300'
                            : 'cockpit-subtile text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                        }`}
                      >
                        {active && <MorphPill layoutId="net-bw-sort-pill" className="rounded-xl" />}
                        <span className="relative z-10 inline-flex items-center gap-1">
                          {opt.label}
                          {active ? (
                            sortDesc ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-45" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>

              <button
                type="button"
                onClick={() => setOnlyActiveTraffic((v) => !v)}
                className={`min-h-[38px] rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  onlyActiveTraffic
                    ? 'cockpit-pill-cyan'
                    : 'cockpit-subtile text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {onlyActiveTraffic ? t('overview.bw_only_active') : t('overview.bw_show_all')} ({bandwidthDevices.length})
              </button>
            </div>

            {bandwidthDevices.length === 0 ? (
              <div className="cockpit-subtile py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('overview.bw_no_active_traffic')}
              </div>
            ) : (
              <div className="space-y-2">
                {bandwidthDevices.map((c, idx) => {
                  const label = c.name || c.hostname || c.ip || t('overview.device_fallback');
                  const wanD = Number(c.wan_speed_down ?? c.speed_down ?? 0);
                  const wanU = Number(c.wan_speed_up ?? c.speed_up ?? 0);
                  const lanT = Number(c.lan_speed_down ?? 0) + Number(c.lan_speed_up ?? 0);
                  const downPct = Math.min(100, Math.round((wanD / peakBwDeviceRate) * 100));
                  const upPct = Math.min(100, Math.round((wanU / peakBwDeviceRate) * 100));
                  const lanPct = Math.min(100, Math.round((lanT / peakBwDeviceRate) * 100));

                  return (
                    <div
                      key={`${c.mac || c.ip || idx}-${idx}`}
                      className="cockpit-subtile flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0 sm:w-[42%]">
                        <span className="font-mono text-[11px] font-bold text-slate-400 w-5 text-right shrink-0 tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="cockpit-pill-cyan flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                          {renderDeviceIcon(c.dev_type || c.device_type, c.is_gateway, c.is_server)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {label}
                          </p>
                          <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {c.ip || '--'} {c.band ? `· ${c.band}` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 items-center sm:grid-cols-3 sm:gap-3 sm:w-[56%] min-w-0">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[11px] font-mono tabular-nums">
                            <span className="truncate text-slate-500 dark:text-slate-400">{t('overview.bw_col_down')}</span>
                            <span className="font-bold text-sky-700 dark:text-sky-300 shrink-0">{formatSpeed(wanD)}</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-sky-500 transition-all duration-300"
                              style={{ width: `${downPct}%` }}
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[11px] font-mono tabular-nums">
                            <span className="truncate text-slate-500 dark:text-slate-400">{t('overview.bw_col_up')}</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300 shrink-0">{formatSpeed(wanU)}</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                              style={{ width: `${upPct}%` }}
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[11px] font-mono tabular-nums">
                            <span className="truncate text-slate-500 dark:text-slate-400">{t('overview.bw_col_lan')}</span>
                            <span className="font-bold text-indigo-700 dark:text-indigo-300 shrink-0">{formatSpeed(lanT)}</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                              style={{ width: `${lanPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
