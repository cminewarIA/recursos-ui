import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Globe,
  Image as ImageIcon,
  Lock,
  MapPin,
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
import { TelemetryChart, ChartSeries } from './TelemetryChart';
import { FloatingTooltip, FloatingTooltipData } from './FloatingTooltip';
import {
  MetricsPayload,
  NetInterfaceInfo,
  TelegramBotStatusPayload,
  ThemeMode,
  WifiClient,
} from '../types/telemetry';
import { apiFetchJson } from '../utils/api';
import { formatBytes, formatSpeed } from '../utils/formatters';

type RedSubTab = 'home' | 'map' | 'security' | 'dns';

interface NetworkSecurityViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onPowerAction: (action: 'wake' | 'shutdown', client: WifiClient) => void;
  actionPendingMac: string | null;
  onRefreshMetrics: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

interface DuckDnsStatusPayload {
  available?: boolean;
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
  onPowerAction,
  actionPendingMac,
  onRefreshMetrics,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<RedSubTab>('home');
  const [clientQuery, setClientQuery] = useState('');
  const [showTechNet, setShowTechNet] = useState(false);

  // Logo picker modal
  const [logoModalClient, setLogoModalClient] = useState<WifiClient | null>(null);
  const [logoSearchQ, setLogoSearchQ] = useState('');
  const [logoResults, setLogoResults] = useState<LogoSearchResult[]>([]);
  const [logoSaving, setLogoSaving] = useState(false);

  // Map & GeoIP
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileLayerRef = useRef<any>(null);
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
      const k = c.service || 'Tráfico directo';
      counts[k] = (counts[k] || 0) + 1;
    }
    const palette = ['#2563eb', '#16a34a', '#d97706', '#0ea5e9', '#6366f1', '#ec4899'];
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count], idx) => ({ name, count, color: palette[idx % palette.length] }));
  }, [geoConnections]);

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

  // Leaflet map lifecycle & responsive ResizeObserver
  useEffect(() => {
    if (subTab !== 'map') {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        tileLayerRef.current = null;
      }
      return;
    }

    const container = mapContainerRef.current;
    const L = window.L;
    if (!container || !L) return;

    if (!mapInstanceRef.current) {
      const map = L.map(container, { zoomControl: true, attributionControl: false }).setView([40.4, -3.7], 3);
      const tileUrl =
        theme === 'dark'
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current = L.tileLayer(tileUrl, { maxZoom: 18 }).addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, [subTab, theme]);

  // Update Leaflet markers when connections change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    const L = window.L;
    if (!map || !layer || !L) return;

    layer.clearLayers();
    const validPoints: Array<[number, number]> = [];
    for (const c of geoConnections) {
      if (typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        validPoints.push([c.lat, c.lng]);
        const isNode = Boolean(c.is_server_node);
        const marker = L.circleMarker([c.lat, c.lng], {
          radius: isNode ? 8 : 5,
          color: isNode ? '#16a34a' : '#2563eb',
          fillColor: isNode ? '#22c55e' : '#3b82f6',
          fillOpacity: 0.75,
          weight: 2,
        });
        marker.bindPopup(
          `<div style="font-size:12px"><strong>${c.service || 'Conexión'}</strong><br/>${c.remote_ip || c.ip || ''}<br/>${c.city || ''} ${c.country || ''}<br/>${c.org || c.isp || ''}</div>`
        );
        marker.addTo(layer);
      }
    }
    if (validPoints.length > 0 && !mapInstanceRef.current._fittedOnce) {
      map.fitBounds(L.latLngBounds(validPoints), { padding: [30, 30], maxZoom: 6 });
      mapInstanceRef.current._fittedOnce = true;
    }
  }, [geoConnections, subTab]);

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
      onNotify(logoUrl ? 'Icono actualizado correctamente.' : 'Icono restablecido.');
      setLogoModalClient(null);
      onRefreshMetrics();
    } else {
      onNotify(res.error || 'No se pudo guardar el icono.', true);
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
      onNotify(res.data?.message || `Dirección ${ip} bloqueada.`);
      if (!ipToBan) setBanIpInput('');
      onRefreshMetrics();
    } else {
      onNotify(res.error || 'No se pudo bloquear esa dirección.', true);
    }
  };

  const handleUnbanIp = async (ip: string, jail?: string) => {
    const res = await apiFetchJson<{ message?: string }>('/api/fail2ban/unban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, jail: jail || 'all' }),
    });
    if (res.ok) {
      onNotify(res.data?.message || `Acceso restaurado para ${ip}.`);
      onRefreshMetrics();
    } else {
      onNotify(res.error || 'Error al desbloquear la dirección.', true);
    }
  };

  const handleTelegramTest = async () => {
    const res = await apiFetchJson<{ message?: string }>('/api/telegram_bot/test', { method: 'POST' });
    if (res.ok) onNotify(res.data?.message || 'Mensaje de prueba enviado a Telegram.');
    else onNotify(res.error || 'No se pudo enviar el aviso de prueba.', true);
  };

  const handleTelegramSend = async () => {
    if (!telegramMsg.trim()) return;
    const res = await apiFetchJson<{ message?: string }>('/api/telegram_bot/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: telegramMsg.trim() }),
    });
    if (res.ok) {
      onNotify(res.data?.message || 'Mensaje enviado correctamente.');
      setTelegramMsg('');
    } else {
      onNotify(res.error || 'Error al enviar el mensaje.', true);
    }
  };

  const handleForceDuckDns = async () => {
    setDuckUpdating(true);
    const res = await apiFetchJson<{ message?: string }>('/api/dns/duckdns/update', { method: 'POST' });
    setDuckUpdating(false);
    if (res.ok) {
      onNotify(res.data?.message || 'Dirección externa actualizada.');
      void apiFetchJson<DuckDnsStatusPayload>('/api/dns/duckdns').then((r) => {
        if (r.ok && r.data) setDuckDns(r.data);
      });
    } else {
      onNotify(res.error || 'No se pudo actualizar DuckDNS.', true);
    }
  };

  const tabs: Array<{ id: RedSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: 'Aparatos en casa', icon: <Wifi className="h-4 w-4" /> },
    { id: 'map', label: 'Mapa de conexiones', icon: <MapPin className="h-4 w-4" /> },
    { id: 'security', label: 'Protección y avisos', icon: <Shield className="h-4 w-4" /> },
    { id: 'dns', label: 'Dirección e Internet', icon: <Globe className="h-4 w-4" /> },
  ];

  // SVG Donut calculation
  const totalGeo = Math.max(1, serviceBreakdown.reduce((acc, s) => acc + s.count, 0));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 no-scrollbar dark:border-slate-800 dark:bg-slate-900">
        {tabs.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Aparatos en casa */}
      {subTab === 'home' && (
        <div className="space-y-5">
          {/* Network Interfaces with 2h Sparkline + Tooltip */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {interfaces.map((nic) => {
              const hist2h = nic.history_2h ?? [];
              const rxData = hist2h.map((b) => Math.round((b.rx / (1024 * 1024)) * 100) / 100);
              const txData = hist2h.map((b) => Math.round((b.tx / (1024 * 1024)) * 100) / 100);
              const nicSeries: ChartSeries[] = [
                { id: 'rx', label: 'Descarga', data: rxData, color: '#2563eb', unit: 'MB/s', decimals: 2 },
                { id: 'tx', label: 'Subida', data: txData, color: '#16a34a', unit: 'MB/s', decimals: 2, fillAlpha: 0 },
              ];
              return (
                <div
                  key={nic.name}
                  className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        Conexión {nic.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {nic.ip || 'Sin dirección local'} · {nic.is_up ? 'Activa' : 'Desconectada'}
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <div className="text-blue-600 dark:text-blue-400">↓ {formatSpeed(nic.rx_bytes_sec)}</div>
                      <div className="text-emerald-600 dark:text-emerald-400">↑ {formatSpeed(nic.tx_bytes_sec)}</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <TelemetryChart
                      series={nicSeries}
                      height={92}
                      leftUnit="MB/s"
                      theme={theme}
                      emptyMessage="Acumulando historial de últimas 2 horas..."
                      formatLabel={(idx) => {
                        const bucket = hist2h[idx];
                        return bucket ? new Date(bucket.t).toLocaleTimeString('es-ES') : `Muestra ${idx + 1}`;
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </section>

          {/* Connected Devices with Custom Logo + WoL + Shutdown */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Aparatos detectados en el router
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {metrics?.wifi_summary?.router_model || 'Router principal'} · {wifiClients.length} dispositivos visibles
                </p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="Buscar teléfono, TV o PC..."
                  className="min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            {wifiClients.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No se encontraron dispositivos con ese nombre o dirección.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {wifiClients.map((client, idx) => {
                  const isOnline = client.online !== false && client.is_online !== false;
                  const mac = client.mac || `c-${idx}`;
                  const busy = actionPendingMac === mac;
                  const logoKey = client.custom_logo_key || client.mac || client.ip || '';
                  const customLogo = logoKey ? metrics?.custom_logos?.[logoKey] : undefined;
                  const imgSrc = customLogo || client.logo_url;
                  const title = client.name || client.hostname || client.ip || 'Aparato de red';

                  return (
                    <div
                      key={`${mac}-${idx}`}
                      className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            setLogoModalClient(client);
                            setLogoSearchQ(client.brand || client.vendor || client.name || '');
                          }}
                          title="Cambiar icono del dispositivo"
                          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800"
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
                              {isOnline ? 'Conectado' : 'En reposo'}
                            </span>
                          </div>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {client.ip || '--'} {client.band ? `· ${client.band}` : ''}{' '}
                            {client.vendor ? `· ${client.vendor}` : ''}
                          </p>
                        </div>
                      </div>

                      {!client.is_server && !client.is_gateway && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={busy || !client.mac}
                            onClick={() => onPowerAction('wake', client)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-45 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            <Power className="h-3.5 w-3.5" />
                            <span>Encender</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy || (!client.ip && !client.mac)}
                            onClick={() => onPowerAction('shutdown', client)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-45 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                          >
                            <PowerOff className="h-3.5 w-3.5" />
                            <span>Apagar</span>
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
              <span>Ver detalles técnicos</span>
            </button>
            {showTechNet && (
              <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs font-mono tabular-nums text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                Tráfico acumulado: ↓ {formatBytes(metrics?.net?.rx_total_bytes)} · ↑ {formatBytes(metrics?.net?.tx_total_bytes)}
                {metrics?.wifi_summary?.router_ip ? ` · Puerta de enlace: ${metrics.wifi_summary.router_ip}` : ''}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 2. Mapa de conexiones */}
      {subTab === 'map' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Ubicación de las conexiones activas
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {geoConnections.length} destinos visibles en el mapa mundial
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
                      onNotify('Ubicaciones actualizadas.');
                      onRefreshMetrics();
                    });
                  }}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Actualizar</span>
                </button>
              </div>
              <div ref={mapContainerRef} className="h-[340px] w-full bg-slate-100 dark:bg-slate-800" />
            </div>

            {/* Service Breakdown Donut with interactive tooltip */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Servicios más usados
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pasa el dedo o cursor sobre cada segmento
              </p>

              <div className="mt-4 flex flex-col items-center">
                {serviceBreakdown.length === 0 ? (
                  <p className="py-12 text-xs text-slate-500 dark:text-slate-400">Sin conexiones externas activas.</p>
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
                                    label: 'Conexiones',
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

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-slate-800">
              Conexiones detalladas
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {geoConnections.slice(0, 25).map((c, idx) => {
                const remoteIp = c.remote_ip || c.ip || '';
                return (
                  <div key={`${remoteIp}-${idx}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {c.service || 'Conexión externa'} · {c.city || 'Ubicación'} {c.country ? `(${c.country})` : ''}
                      </p>
                      <p className="font-mono text-slate-500 dark:text-slate-400">
                        {remoteIp} {c.org ? `· ${c.org}` : ''}
                      </p>
                    </div>
                    {remoteIp && !c.is_server_node && (
                      <button
                        type="button"
                        onClick={() => handleBanIp(remoteIp)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                        <span>Bloquear</span>
                      </button>
                    )}
                  </div>
                );
              })}
              {geoConnections.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No hay conexiones externas en este instante.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* 3. Protección y avisos (Fail2ban + Telegram) */}
      {subTab === 'security' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
              <Lock className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Bloqueo automático de intrusos
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(metrics?.security?.fail2ban?.active ?? metrics?.security?.fail2ban?.available)
                    ? `Cortafuegos activo · ${bannedDetails.length} direcciones bloqueadas`
                    : 'Cortafuegos en reposo'}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="text"
                value={banIpInput}
                onChange={(e) => setBanIpInput(e.target.value)}
                placeholder="Dirección IP a bloquear (ej. 1.2.3.4)"
                className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <select
                value={banJailInput}
                onChange={(e) => setBanJailInput(e.target.value)}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="sshd">Acceso SSH</option>
                <option value="caddy-scan">Web / Caddy</option>
                <option value="all">Todas las reglas</option>
              </select>
              <button
                type="button"
                onClick={() => handleBanIp()}
                className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
              >
                Bloquear
              </button>
            </div>

            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {bannedDetails.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No hay direcciones bloqueadas ahora mismo.
                </p>
              ) : (
                bannedDetails.slice(0, 20).map((b, i) => (
                  <div key={`${b.ip}-${i}`} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                    <div>
                      <p className="font-mono font-semibold text-slate-900 dark:text-white">{b.ip}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        Regla: {b.jail || 'general'} {b.country ? `· ${b.country}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnbanIp(b.ip, b.jail)}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      <span>Desbloquear</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Avisos por Telegram
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {telegramData?.bot_status?.online ? 'Bot conectado y escuchando' : 'Estado en segundo plano'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleTelegramTest}
                className="min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                Enviar prueba
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={telegramMsg}
                onChange={(e) => setTelegramMsg(e.target.value)}
                placeholder="Escribe un aviso para enviar al móvil..."
                className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                onClick={handleTelegramSend}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Enviar</span>
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {(telegramData?.activity ?? []).slice(0, 6).map((act, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/50">
                  <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-white">
                    <span>{act.title || 'Aviso'}</span>
                    <span className="font-mono text-[11px] font-normal text-slate-400">{act.timestamp || ''}</span>
                  </div>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">{act.content}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 4. Dirección e Internet (DuckDNS + Pi-hole) */}
      {subTab === 'dns' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Dirección desde fuera de casa (DDNS)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nombre web autodetectado para entrar cuando estás fuera del Wi-Fi
                </p>
              </div>
              <button
                type="button"
                disabled={duckUpdating}
                onClick={handleForceDuckDns}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${duckUpdating ? 'animate-spin' : ''}`} />
                <span>Actualizar ahora</span>
              </button>
            </div>

            <div className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Dirección pública detectada</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {duckDns?.full_domain || metrics?.system?.public_domain || '--'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Última dirección IP registrada</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                  {duckDns?.last_registered_ip || metrics?.system?.local_ip || '--'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Última comprobación</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {duckDns?.last_update_time || '--'}
                </span>
              </div>
            </div>

            {duckLogs.length > 0 && (
              <div className="mt-4 max-h-36 overflow-y-auto rounded-xl bg-slate-50 p-3 font-mono text-[11px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                {duckLogs.slice(-6).map((l, idx) => (
                  <div key={idx}>{l}</div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Filtro de anuncios y rastreadores (Pi-hole)
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {(metrics?.security?.pihole?.online ?? metrics?.security?.pihole?.available)
                ? 'Protección activa para todos los aparatos conectados al Wi-Fi'
                : 'Filtro DNS no detectado en este equipo'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                <span className="text-slate-500 dark:text-slate-400">Consultas hoy</span>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {(metrics?.security?.pihole?.total_queries ?? metrics?.security?.pihole?.dns_queries_today ?? 0).toLocaleString('es-ES')}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                <span className="text-slate-500 dark:text-slate-400">Anuncios bloqueados</span>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {(metrics?.security?.pihole?.blocked_today ?? metrics?.security?.pihole?.ads_blocked_today ?? 0).toLocaleString('es-ES')}
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Custom Logo Picker Modal */}
      {logoModalClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setLogoModalClient(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Elegir icono para {logoModalClient.name || logoModalClient.ip}
              </h3>
              <button
                type="button"
                disabled={logoSaving}
                onClick={() => handleSaveLogo('')}
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Restablecer</span>
              </button>
            </div>
            <input
              type="search"
              value={logoSearchQ}
              onChange={(e) => setLogoSearchQ(e.target.value)}
              placeholder="Buscar marca (Apple, Samsung, LG, Sony...)"
              className="mt-3 min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <div className="mt-3 grid max-h-60 grid-cols-3 gap-2 overflow-y-auto">
              {logoResults.map((res, idx) => (
                <button
                  key={`${res.logo_url}-${idx}`}
                  type="button"
                  disabled={logoSaving}
                  onClick={() => handleSaveLogo(res.logo_url)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 p-2.5 text-center hover:border-blue-500 dark:border-slate-700"
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
                className="min-h-[40px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
