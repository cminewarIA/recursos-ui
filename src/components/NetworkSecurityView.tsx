import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function buildGeoClusterKey(conn: GeoConnectionItem): string | null {
  if (typeof conn.lat !== 'number' || typeof conn.lng !== 'number') return null;
  if (!Number.isFinite(conn.lat) || !Number.isFinite(conn.lng)) return null;
  if (conn.is_server_node) return 'server-node';
  return `${conn.lat.toFixed(2)},${conn.lng.toFixed(2)}`;
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
  const tileLayerRef = useRef<any>(null);
  // Registro incremental para actualizar marcadores sin cerrar popups abiertos durante el refresco en vivo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRegistryRef = useRef<Map<string, { hitMarker: any; visMarker: any; badgeMarker?: any; pulseMarker?: any; signature: string; lat: number; lng: number }>>(new Map());
  const handleBanIpRef = useRef<(ipToBan?: string) => Promise<void>>(async () => {});
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

  const geoConnections = useMemo(
    () => metrics?.net?.connections_map?.connections ?? [],
    [metrics?.net?.connections_map?.connections]
  );

  const serviceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of geoConnections) {
      const k = c.service || t('hardware.net.geo.direct_traffic');
      counts[k] = (counts[k] || 0) + 1;
    }
    const palette = ['#0284c7', '#10b981', '#7c3aed', '#f59e0b', '#0ea5e9', '#ec4899'];
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count], idx) => ({ name, count, color: palette[idx % palette.length] }));
  }, [geoConnections, t]);

  const bannedDetails = useMemo(
    () => metrics?.security?.fail2ban?.banned_details ?? [],
    [metrics?.security?.fail2ban?.banned_details]
  );

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
        if (r.ok && r.data?.logs) setDuckLogs(r.data.logs);
      });
    }
  }, [subTab]);

  // Leaflet map lifecycle & responsive ResizeObserver (reactivado en cuanto ViewStage monta el nodo real)
  useEffect(() => {
    if (subTab !== 'map' || !mapContainerEl) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
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
      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
      window.setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 120);
      window.setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 360);
    } else if (tileLayerRef.current) {
      mapContainerEl.classList.remove('cockpit-osm-dark-fallback');
      tileLayerRef.current.setUrl(primaryTileUrl);
    }

    const handlePopupActionClick = (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement | null)?.closest?.('[data-ban-ip]') as HTMLElement | null;
      const ip = target?.getAttribute('data-ban-ip');
      if (ip) {
        ev.preventDefault();
        ev.stopPropagation();
        void handleBanIpRef.current(ip);
      }
    };
    mapContainerEl.addEventListener('click', handlePopupActionClick);

    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    ro.observe(mapContainerEl);
    return () => {
      mapContainerEl.removeEventListener('click', handlePopupActionClick);
      ro.disconnect();
    };
  }, [subTab, theme, mapContainerEl]);

  // Agrupación espacial dinámica y actualización incremental sin cerrar popups activos
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    const L = window.L;
    if (!map || !layer || !L) return;

    const clusters = new Map<string, { key: string; lat: number; lng: number; isNode: boolean; items: GeoConnectionItem[] }>();
    let hasServerMarker = false;

    for (const c of geoConnections) {
      const key = buildGeoClusterKey(c);
      if (!key || typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
      if (c.is_server_node) hasServerMarker = true;
      const existing = clusters.get(key);
      if (existing) {
        existing.items.push(c);
      } else {
        clusters.set(key, {
          key,
          lat: c.lat,
          lng: c.lng,
          isNode: Boolean(c.is_server_node),
          items: [c],
        });
      }
    }

    const srvNode = metrics?.net?.connections_map?.server_node;
    if (
      !hasServerMarker &&
      srvNode &&
      typeof srvNode.lat === 'number' &&
      typeof srvNode.lng === 'number' &&
      Number.isFinite(srvNode.lat) &&
      Number.isFinite(srvNode.lng)
    ) {
      clusters.set('server-node', {
        key: 'server-node',
        lat: srvNode.lat,
        lng: srvNode.lng,
        isNode: true,
        items: [{ ...srvNode, is_server_node: true }],
      });
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
    const blockLabel = escapeMapHtml(t('network.block'));

    for (const cluster of clusters.values()) {
      validPoints.push([cluster.lat, cluster.lng]);
      const { key, lat, lng, isNode, items } = cluster;
      const primary = items[0];
      const placeName = [primary.city, primary.country].filter(Boolean).join(', ') || t('hardware.net.geo.location_fallback');
      const count = items.length;
      const visRadius = isNode ? 9 : Math.min(18, 7.5 + Math.sqrt(count) * 2.4);
      const hitRadius = Math.max(24, visRadius + 12);

      const tooltipText = isNode
        ? `${placeName} (${primary.ip || ''})`
        : count > 1
          ? t('network.map_cluster_count', { count, place: placeName })
          : `${primary.service || t('hardware.net.geo.conn_generic')} · ${placeName}`;

      const rowsHtml = items
        .slice(0, 8)
        .map((c) => {
          const remoteIp = c.remote_ip || c.ip || '';
          const svc = escapeMapHtml(c.service || t('hardware.net.geo.conn_generic'));
          const port = c.remote_port || c.port;
          const org = escapeMapHtml(c.org || c.isp || '');
          const proc = escapeMapHtml(c.process || '');
          const banBtn =
            !isNode && remoteIp
              ? `<button type="button" data-ban-ip="${escapeMapHtml(remoteIp)}" style="border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.12);color:#ef4444;border-radius:7px;padding:2px 8px;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;">${blockLabel}</button>`
              : '';
          return `<div style="padding:5px 0;border-top:1px solid rgba(148,163,184,0.22);display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:12px;">${svc}${port ? ` <span style="opacity:.65;font-weight:500;">:${escapeMapHtml(port)}</span>` : ''}${proc ? ` <span style="opacity:.7;font-weight:500;">· ${proc}</span>` : ''}</div>
              <div style="font-family:ui-monospace,monospace;font-size:11px;opacity:.88;">${escapeMapHtml(remoteIp)}</div>
              ${org ? `<div style="font-size:10.5px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;">${org}</div>` : ''}
            </div>
            ${banBtn}
          </div>`;
        })
        .join('');

      const moreHtml =
        count > 8
          ? `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed rgba(148,163,184,0.28);font-size:11px;opacity:.75;">${escapeMapHtml(t('network.map_popup_more', { count: count - 8 }))}</div>`
          : '';

      const popupHtml = `<div style="min-width:225px;max-width:315px;font-size:12px;line-height:1.35;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <strong style="font-size:12.5px;">${escapeMapHtml(placeName)}</strong>
          <span style="background:rgba(14,165,233,0.16);color:#0284c7;border-radius:999px;padding:1px 7px;font-size:10.5px;font-weight:700;font-family:ui-monospace,monospace;">${count}</span>
        </div>
        <div style="max-height:210px;overflow-y:auto;padding-right:2px;">${rowsHtml}</div>
        ${moreHtml}
      </div>`;

      const signature = `${lat.toFixed(3)},${lng.toFixed(3)}|${count}|${items
        .slice(0, 8)
        .map((c) => `${c.remote_ip || c.ip || ''}:${c.service || ''}:${c.remote_port || c.port || ''}`)
        .join(',')}|${blockLabel}`;

      const existing = registry.get(key);
      if (existing) {
        if (existing.signature !== signature) {
          existing.hitMarker.setLatLng([lat, lng]);
          existing.hitMarker.setRadius(hitRadius);
          existing.hitMarker.setTooltipContent(tooltipText);
          existing.hitMarker.setPopupContent(popupHtml);
          existing.visMarker.setLatLng([lat, lng]);
          existing.visMarker.setRadius(visRadius);
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
        color: isNode ? '#059669' : '#0284c7',
        fillColor: isNode ? '#10b981' : '#0ea5e9',
        fillOpacity: isNode ? 0.88 : 0.8,
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

      // Amplio objetivo táctil/ratón (>48 px diámetro) con cursor puntero y tooltip al pasar encima
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
      hitMarker.bindPopup(popupHtml, { maxWidth: 330, minWidth: 225, autoPan: true, closeButton: true });
      hitMarker.on('mouseover', () => {
        visMarker.setStyle({ weight: 3, fillOpacity: 0.95, color: isNode ? '#34d399' : '#38bdf8' });
      });
      hitMarker.on('mouseout', () => {
        visMarker.setStyle({ weight: 2, fillOpacity: isNode ? 0.88 : 0.8, color: isNode ? '#059669' : '#0284c7' });
      });
      hitMarker.addTo(layer);

      registry.set(key, { hitMarker, visMarker, badgeMarker, pulseMarker, signature, lat, lng });
    }

    if (validPoints.length > 0 && !map._fittedOnce) {
      map.fitBounds(L.latLngBounds(validPoints), { padding: [36, 36], maxZoom: 5 });
      map._fittedOnce = true;
    }
  }, [geoConnections, metrics?.net?.connections_map?.server_node, subTab, mapContainerEl, t]);

  const focusConnectionOnMap = (conn: GeoConnectionItem) => {
    const key = buildGeoClusterKey(conn);
    const map = mapInstanceRef.current;
    if (!key || !map) return;
    const entry = markerRegistryRef.current.get(key);
    mapContainerEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const targetLat = entry?.lat ?? conn.lat;
    const targetLng = entry?.lng ?? conn.lng;
    if (typeof targetLat === 'number' && typeof targetLng === 'number') {
      map.flyTo([targetLat, targetLng], Math.max(map.getZoom(), 6), { duration: 0.45 });
    }
    if (entry?.hitMarker) {
      window.setTimeout(() => {
        entry.hitMarker.openPopup();
      }, 220);
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

  const handleBanIp = async (ipToBan?: string) => {
    const ip = (ipToBan || banIpInput).trim();
    if (!ip) return;
    const res = await apiFetchJson<{ message?: string }>('/api/fail2ban/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, jail: banJailInput }),
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
        <div className="space-y-5">
          {/* Network Interfaces with 20m Sparkline + Tooltip */}
          <section className="cockpit-auto-grid">
            {interfaces.map((nic) => {
              const hist2h = nic.history_2h ?? [];
              const rxData = hist2h.map((b) => Math.round((b.rx / (1024 * 1024)) * 100) / 100);
              const txData = hist2h.map((b) => Math.round((b.tx / (1024 * 1024)) * 100) / 100);
              const nicTimestamps = hist2h.map((b) => new Date(b.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale));
              const nicEpochTs = hist2h.map((b) => Math.round(b.t / 1000));
              const nicSeries: ChartSeries[] = [
                { id: 'rx', metricKey: 'net_rx', label: t('hardware.net.download'), data: rxData, color: '#0284c7', unit: 'MB/s', decimals: 2 },
                { id: 'tx', metricKey: 'net_tx', label: t('hardware.net.upload'), data: txData, color: '#10b981', unit: 'MB/s', decimals: 2, fillAlpha: 0 },
              ];
              const expandNicSpec: ExpandChartSpec = {
                title: t('hardware.net.iface_full_title', { name: nic.name }),
                subtitle: t('hardware.net.iface_20m_subtitle', { ip: nic.ip || t('hardware.net.local_net') }),
                series: nicSeries,
                timestamps: nicTimestamps,
                epochTs: nicEpochTs,
                leftUnit: 'MB/s',
                chartKind: 'net',
                nicName: nic.name,
              };
              return (
                <div
                  key={nic.name}
                  className="cockpit-bento p-4"
                >
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
                      <div className="text-right font-mono text-xs tabular-nums">
                        <div className="text-sky-600 dark:text-sky-400">↓ {formatSpeed(nic.rx_bytes_sec)}</div>
                        <div className="text-emerald-600 dark:text-emerald-400">↑ {formatSpeed(nic.tx_bytes_sec)}</div>
                      </div>
                      {onExpandChart && (
                        <button
                          type="button"
                          aria-label={t('hardware.net.inspect_aria', { name: nic.name })}
                          onClick={() => onExpandChart(expandNicSpec)}
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
                      onExpandClick={onExpandChart ? () => onExpandChart(expandNicSpec) : undefined}
                      formatLabel={(idx) => {
                        const bucket = hist2h[idx];
                        return bucket ? new Date(bucket.t).toLocaleTimeString(locale === 'es' ? 'es-ES' : locale) : t('charts.sample_n', { n: idx + 1 });
                      }}
                    />
                  </div>
                </div>
              );
            })}
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
                          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900"
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-5 py-3.5 dark:border-slate-800">
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
                    {t('network.map_destinations_visible', { count: geoConnections.length })} · {t('network.map_click_hint')}
                  </p>
                </div>
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
                  className="cockpit-subtile inline-flex min-h-[40px] items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{t('network.refresh')}</span>
                </button>
              </div>
              <div ref={setMapContainerEl} className="relative h-[340px] lg:h-[420px] xl:h-[460px] w-full bg-slate-100 dark:bg-slate-900" />
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
              {geoConnections.slice(0, 25).map((c, idx) => {
                const remoteIp = c.remote_ip || c.ip || '';
                const hasCoords =
                  typeof c.lat === 'number' &&
                  typeof c.lng === 'number' &&
                  Number.isFinite(c.lat) &&
                  Number.isFinite(c.lng);
                return (
                  <div
                    key={`${remoteIp}-${idx}`}
                    className="cockpit-subtile flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors hover:border-sky-400/60"
                  >
                    <button
                      type="button"
                      disabled={!hasCoords}
                      onClick={() => focusConnectionOnMap(c)}
                      title={hasCoords ? t('network.focus_on_map') : undefined}
                      className="min-w-0 flex-1 text-left cursor-pointer disabled:cursor-default group"
                    >
                      <p className="font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                        {c.service || t('hardware.net.geo.external_conn')} · {c.city || t('hardware.net.geo.location_fallback')} {c.country ? `(${c.country})` : ''}
                      </p>
                      <p className="font-mono text-slate-500 dark:text-slate-400 truncate">
                        {remoteIp} {c.org ? `· ${c.org}` : ''}
                      </p>
                    </button>
                    {remoteIp && !c.is_server_node && (
                      <button
                        type="button"
                        onClick={() => handleBanIp(remoteIp)}
                        className="cockpit-btn-off inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors shrink-0"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                        <span>{t('network.block')}</span>
                      </button>
                    )}
                  </div>
                );
              })}
              {geoConnections.length === 0 && (
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
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {t('network.ddns_title')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('network.ddns_sub')}
                </p>
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
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {t('network.pihole_title')}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {(metrics?.security?.pihole?.online ?? metrics?.security?.pihole?.available)
                ? t('network.pihole_active')
                : t('network.pihole_missing')}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
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
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={COCKPIT_SPRING}
              className="cockpit-bento w-full max-w-md p-5 shadow-2xl"
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
