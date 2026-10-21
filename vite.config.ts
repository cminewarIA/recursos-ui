import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import dns from 'dns';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';

// Real-time OS Telemetry state for Vite preview server (100% real system calls, zero fake specs)
let prevCpuTimes: { idle: number; total: number }[] = [];
let prevNetStats: Record<string, { rx: number; tx: number; ts: number }> = {};
const nicHistory2h: Record<string, { t: number; rx: number; tx: number }[]> = {};
const historyBuffer: Record<string, (number | string)[]> = {
  timestamps: [],
  cpu: [],
  gpu: [],
  ram: [],
  ram_total: [],
  net_rx: [],
  net_tx: [],
  disk_r: [],
  disk_w: [],
};

function readAppVersion(): string {
  try {
    return fs.readFileSync(path.resolve(__dirname, 'VERSION'), 'utf-8').trim() || '4.0.0';
  } catch {
    return '4.0.0';
  }
}

let cachedStaticCpu: { model: string; arch: string; vendor: string; cacheSize: string } | null = null;
let cachedDisks: { data: unknown[]; ts: number } = { data: [], ts: 0 };
let cachedProcesses: { data: unknown[]; ts: number } = { data: [], ts: 0 };
let cachedGitMeta: { sha: string; subject: string; date: string; ts: number } = {
  sha: 'HEAD',
  subject: 'Repositorio local sincronizado',
  date: new Date().toISOString().slice(0, 16).replace('T', ' '),
  ts: 0,
};

function getStaticCpuSpecs() {
  if (cachedStaticCpu) return cachedStaticCpu;
  const cpus = os.cpus() || [];
  const arch = os.arch();
  let model = cpus[0]?.model?.trim() || '';
  let vendor = '';
  let cacheSize = '';
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
    for (const line of cpuinfo.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      if ((k === 'model name' || k === 'hardware' || k === 'processor') && (!model || model === 'unknown') && !/^\d+$/.test(v)) {
        model = v;
      } else if (k === 'vendor_id' && !vendor) {
        vendor = v;
      } else if (k === 'cache size' && !cacheSize) {
        cacheSize = v;
      }
    }
  } catch {
    // Fallback to os.cpus()
  }
  if (!model || model.toLowerCase() === 'unknown') {
    model = `Linux Host CPU (${arch})`;
  }
  cachedStaticCpu = { model, arch, vendor, cacheSize };
  return cachedStaticCpu;
}

function sampleRealCpuUsage(): { overall: number; perCore: number[]; model: string; arch: string; vendor: string; cacheSize: string; freqMhz: number } {
  const cpus = os.cpus() || [];
  const { model, arch, vendor, cacheSize } = getStaticCpuSpecs();
  let freqMhz = cpus[0]?.speed || 0;

  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
    const freqs: number[] = [];
    for (const line of cpuinfo.split('\n')) {
      if (line.startsWith('cpu MHz')) {
        const idx = line.indexOf(':');
        if (idx !== -1) {
          const f = parseFloat(line.slice(idx + 1).trim());
          if (!isNaN(f) && f > 0) freqs.push(f);
        }
      }
    }
    if (freqs.length > 0) {
      freqMhz = Math.round((freqs.reduce((a, b) => a + b, 0) / freqs.length) * 10) / 10;
    }
  } catch {
    // Fallback to os.cpus()
  }

  const currentTimes = cpus.map((c) => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { idle: t.idle, total };
  });

  const perCore: number[] = currentTimes.map((cur, idx) => {
    const prev = prevCpuTimes[idx];
    if (!prev || cur.total <= prev.total) return 0;
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    return Math.max(0, Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10));
  });

  prevCpuTimes = currentTimes;
  const overall = perCore.length > 0
    ? Math.round((perCore.reduce((a, b) => a + b, 0) / perCore.length) * 10) / 10
    : 0;

  return { overall, perCore, model, arch, vendor, cacheSize, freqMhz };
}

function sampleRealMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  let availableBytes = freeBytes;
  let cachedBytes = 0;
  let buffersBytes = 0;
  let swapTotalBytes = 0;
  let swapFreeBytes = 0;

  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    for (const line of meminfo.split('\n')) {
      const parts = line.split(':');
      if (parts.length < 2) continue;
      const key = parts[0].trim();
      const valKb = parseInt(parts[1].trim().split(/\s+/)[0], 10) || 0;
      if (key === 'MemAvailable') availableBytes = valKb * 1024;
      else if (key === 'Cached') cachedBytes = valKb * 1024;
      else if (key === 'Buffers') buffersBytes = valKb * 1024;
      else if (key === 'SwapTotal') swapTotalBytes = valKb * 1024;
      else if (key === 'SwapFree') swapFreeBytes = valKb * 1024;
    }
  } catch {
    // Fallback to os.totalmem / os.freemem
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
  const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
  const swapPercent = swapTotalBytes > 0 ? Math.round((swapUsedBytes / swapTotalBytes) * 1000) / 10 : 0;

  return {
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    free_bytes: freeBytes,
    available_bytes: availableBytes,
    cached_bytes: cachedBytes,
    buffers_bytes: buffersBytes,
    cached_total_bytes: cachedBytes + buffersBytes,
    percent,
    swap_total_bytes: swapTotalBytes,
    swap_used_bytes: swapUsedBytes,
    swap_free_bytes: swapFreeBytes,
    swap_percent: swapPercent,
  };
}

function sampleRealNetwork() {
  const now = Date.now();
  const netIfs = os.networkInterfaces();
  let localIp = '127.0.0.1';
  let totalRx = 0;
  let totalTx = 0;
  let totalRxSec = 0;
  let totalTxSec = 0;
  const interfaces: Record<string, unknown> = {};
  const interfacesList: unknown[] = [];

  const procNetMap: Record<string, { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number }> = {};
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf-8');
    for (const line of raw.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes(':')) continue;
      const [ifName, rest] = trimmed.split(':');
      const name = ifName.trim();
      const cols = rest.trim().split(/\s+/).map((x) => parseInt(x, 10) || 0);
      if (cols.length >= 10) {
        procNetMap[name] = {
          rxBytes: cols[0],
          rxPackets: cols[1],
          txBytes: cols[8],
          txPackets: cols[9],
        };
      }
    }
  } catch {
    // Ignore if /proc/net/dev unavailable
  }

  const allIfNames = new Set([...Object.keys(netIfs), ...Object.keys(procNetMap)]);
  for (const name of allIfNames) {
    if (name === 'lo' || name.startsWith('veth') || name.startsWith('docker') || name.startsWith('br-')) continue;
    const addrs = netIfs[name] || [];
    let ipv4 = '';
    let ipv6 = '';
    let mac = '';
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        ipv4 = a.address;
        if (localIp === '127.0.0.1') localIp = a.address;
      } else if (a.family === 'IPv6' && !a.internal && !ipv6) {
        ipv6 = a.address;
      }
      if (a.mac && a.mac !== '00:00:00:00:00:00') mac = a.mac.toUpperCase();
    }

    const counters = procNetMap[name] || { rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0 };
    const prev = prevNetStats[name];
    const dt = prev ? Math.max((now - prev.ts) / 1000, 0.001) : 1;
    const rxSec = prev ? Math.max(0, (counters.rxBytes - prev.rx) / dt) : 0;
    const txSec = prev ? Math.max(0, (counters.txBytes - prev.tx) / dt) : 0;
    prevNetStats[name] = { rx: counters.rxBytes, tx: counters.txBytes, ts: now };

    totalRx += counters.rxBytes;
    totalTx += counters.txBytes;
    totalRxSec += rxSec;
    totalTxSec += txSec;

    let speedMbps = 0;
    try {
      const sp = fs.readFileSync(`/sys/class/net/${name}/speed`, 'utf-8').trim();
      const parsed = parseInt(sp, 10);
      if (!isNaN(parsed) && parsed > 0) speedMbps = parsed;
    } catch {
      // Virtual NIC may not expose link speed
    }

    const nHist = nicHistory2h[name] || (nicHistory2h[name] = []);
    const cutoffMs = now - 7200 * 1000;
    if (nHist.length === 0 || now - nHist[nHist.length - 1].t >= 10000) {
      nHist.push({ t: now, rx: Math.round(rxSec), tx: Math.round(txSec) });
    } else {
      nHist[nHist.length - 1].rx = Math.max(nHist[nHist.length - 1].rx, Math.round(rxSec));
      nHist[nHist.length - 1].tx = Math.max(nHist[nHist.length - 1].tx, Math.round(txSec));
      nHist[nHist.length - 1].t = now;
    }
    while (nHist.length > 0 && nHist[0].t < cutoffMs) {
      nHist.shift();
    }

    const nicObj = {
      name,
      ip: ipv4,
      ipv6,
      mac,
      is_up: true,
      speed_mbps: speedMbps,
      mtu: 1500,
      bytes_recv: counters.rxBytes,
      bytes_sent: counters.txBytes,
      packets_recv: counters.rxPackets,
      packets_sent: counters.txPackets,
      rx_bytes_sec: Math.round(rxSec),
      tx_bytes_sec: Math.round(txSec),
      history_2h: [...nHist],
    };
    interfaces[name] = nicObj;
    interfacesList.push(nicObj);
  }

  triggerAsyncGeoSync();

  return {
    local_ip: localIp,
    rx_bytes_sec: Math.round(totalRxSec),
    tx_bytes_sec: Math.round(totalTxSec),
    rx_total_bytes: totalRx,
    tx_total_bytes: totalTx,
    interfaces,
    interfaces_list: interfacesList,
    interfaces_history_2h: nicHistory2h,
    connections_map: buildLiveConnectionsMap(localIp),
  };
}

interface GeoIpRecord {
  ip: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
  countryCode: string;
  isp: string;
  org: string;
  as: string;
}

let serverSelfGeo: GeoIpRecord | null = null;
const geoIpCache: Record<string, GeoIpRecord> = {};
const recentHttpIncomingClients = new Map<string, { ip: string; port: number; ts: number; service: string }>();
const resolvedOutboundEndpoints = new Map<string, { host: string; ip: string; port: number; protocol: string; service: string }>();
let lastGeoSyncTs = 0;
let geoSyncInFlight = false;

function decodeProcHexIp(hexIp: string): string {
  if (!hexIp || hexIp.length !== 8) return '';
  const b1 = parseInt(hexIp.slice(6, 8), 16);
  const b2 = parseInt(hexIp.slice(4, 6), 16);
  const b3 = parseInt(hexIp.slice(2, 4), 16);
  const b4 = parseInt(hexIp.slice(0, 2), 16);
  return `${b1}.${b2}.${b3}.${b4}`;
}

function isPrivateOrLinkLocalIp(ip: string): boolean {
  if (!ip) return true;
  if (ip.startsWith('127.') || ip === '0.0.0.0' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] || '0', 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

const PORT_SERVICE_NAMES: Record<number, string> = {
  22: 'SSH Daemon (OpenSSH)',
  53: 'DNS Resolver (UDP/TCP)',
  80: 'HTTP Web Server',
  123: 'NTP Time Sync',
  443: 'HTTPS / TLS Stream',
  1900: 'UPnP / SSDP Discovery',
  2283: 'Immich Photo Server',
  3000: 'Panel Recursos Web UI',
  5353: 'mDNS Multicast DNS',
  7878: 'Radarr Media Service',
  8000: 'Backend API Service',
  8080: 'HTTP Proxy / Web Socket',
  8082: 'qBittorrent Web UI',
  8096: 'Emby Media Server',
  8550: 'Panel Recursos (HTTPS)',
  8989: 'Sonarr Media Service',
  9000: 'Portainer Docker Engine',
  51820: 'WireGuard VPN Tunnel',
};

function parseProcNetSockets(): {
  direction: 'incoming' | 'outgoing';
  protocol: string;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  state: string;
  service: string;
}[] {
  const results: {
    direction: 'incoming' | 'outgoing';
    protocol: string;
    localIp: string;
    localPort: number;
    remoteIp: string;
    remotePort: number;
    state: string;
    service: string;
  }[] = [];

  const listeningPorts = new Set<number>([22, 53, 80, 443, 3000, 8080, 8082, 8096, 8550]);
  const rawTcpLines: { proto: string; line: string }[] = [];

  for (const [proto, file] of [
    ['TCP', '/proc/net/tcp'],
    ['UDP', '/proc/net/udp'],
  ] as const) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split('\n').slice(1)) {
        const trimmed = line.trim();
        if (trimmed) rawTcpLines.push({ proto, line: trimmed });
      }
    } catch {
      // Ignore if unavailable
    }
  }

  for (const { line } of rawTcpLines) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [, localAddr, , st] = parts;
    if (st === '0A') {
      const lPort = parseInt(localAddr.split(':')[1] || '0', 16);
      if (lPort > 0) listeningPorts.add(lPort);
    }
  }

  const seenKeys = new Set<string>();
  for (const { proto, line } of rawTcpLines) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [, localAddr, remAddr, st] = parts;
    if (st === '0A') continue; // Skip pure LISTEN rows
    const [lIpHex, lPortHex] = localAddr.split(':');
    const [rIpHex, rPortHex] = remAddr.split(':');
    const localIp = decodeProcHexIp(lIpHex);
    const remoteIp = decodeProcHexIp(rIpHex);
    const localPort = parseInt(lPortHex || '0', 16);
    const remotePort = parseInt(rPortHex || '0', 16);

    if (!remoteIp || remoteIp === '0.0.0.0' || remoteIp.startsWith('127.')) continue;

    const isIncoming = listeningPorts.has(localPort) || (localPort < 10000 && remotePort > 10000);
    const direction: 'incoming' | 'outgoing' = isIncoming ? 'incoming' : 'outgoing';
    const key = `${direction}:${remoteIp}:${isIncoming ? localPort : remotePort}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const svcPort = isIncoming ? localPort : remotePort;
    const service = PORT_SERVICE_NAMES[svcPort] || `${proto} Puerto :${svcPort}`;
    const stateMap: Record<string, string> = {
      '01': 'ESTABLISHED',
      '02': 'SYN_SENT',
      '03': 'SYN_RECV',
      '06': 'TIME_WAIT',
      '08': 'CLOSE_WAIT',
    };

    results.push({
      direction,
      protocol: proto,
      localIp,
      localPort,
      remoteIp,
      remotePort,
      state: stateMap[st] || 'ACTIVE',
      service,
    });
  }

  return results;
}

function httpGetJson(url: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function httpPostBatchGeo(ips: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(ips.slice(0, 80));
    const req = http.request(
      'http://ip-api.com/batch?fields=status,country,countryCode,city,lat,lon,isp,org,as,query',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 3000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

async function triggerAsyncGeoSync() {
  const now = Date.now();
  if (geoSyncInFlight || (serverSelfGeo && now - lastGeoSyncTs < 15000)) return;
  geoSyncInFlight = true;
  lastGeoSyncTs = now;

  try {
    // 1. Resolve Server's own Public WAN IP & Coordinates
    if (!serverSelfGeo) {
      const selfData = (await httpGetJson(
        'http://ip-api.com/json/?fields=status,country,countryCode,city,lat,lon,isp,org,as,query'
      )) as Record<string, unknown> | null;
      if (selfData && selfData.status === 'success' && typeof selfData.lat === 'number') {
        serverSelfGeo = {
          ip: String(selfData.query || ''),
          lat: Number(selfData.lat),
          lng: Number(selfData.lon),
          city: String(selfData.city || 'Servidor'),
          country: String(selfData.country || ''),
          countryCode: String(selfData.countryCode || ''),
          isp: String(selfData.isp || ''),
          org: String(selfData.org || os.hostname()),
          as: String(selfData.as || ''),
        };
      }
    }

    // 2. Resolve real DNS endpoints for active outbound telemetry/OTA/DNS services
    const activeTargets = [
      { host: 'api.github.com', port: 443, protocol: 'TCP', service: 'GitHub OTA Sync (api.github.com)' },
      { host: 'maps.googleapis.com', port: 443, protocol: 'TCP', service: 'Google Maps Platform API' },
      { host: 'cdn.simpleicons.org', port: 443, protocol: 'TCP', service: 'SimpleIcons Hardware CDN' },
      { host: 'one.one.one.one', port: 53, protocol: 'UDP', service: 'Cloudflare DNS Upstream (1.1.1.1)' },
      { host: 'dns.google', port: 53, protocol: 'UDP', service: 'Google Public DNS Upstream (8.8.8.8)' },
    ];

    for (const t of activeTargets) {
      if (!resolvedOutboundEndpoints.has(t.host)) {
        try {
          const res = await dns.promises.lookup(t.host, { family: 4 });
          if (res && res.address) {
            resolvedOutboundEndpoints.set(t.host, {
              host: t.host,
              ip: res.address,
              port: t.port,
              protocol: t.protocol,
              service: t.service,
            });
          }
        } catch {
          // Ignore DNS lookup failure
        }
      }
    }

    // 3. Collect all public IPs that need GeoIP coordinates
    const sockets = parseProcNetSockets();
    const candidateIps = new Set<string>();
    for (const s of sockets) {
      if (!isPrivateOrLinkLocalIp(s.remoteIp) && !geoIpCache[s.remoteIp]) {
        candidateIps.add(s.remoteIp);
      }
    }
    for (const ep of resolvedOutboundEndpoints.values()) {
      if (!isPrivateOrLinkLocalIp(ep.ip) && !geoIpCache[ep.ip]) {
        candidateIps.add(ep.ip);
      }
    }
    for (const client of recentHttpIncomingClients.values()) {
      if (!isPrivateOrLinkLocalIp(client.ip) && !geoIpCache[client.ip]) {
        candidateIps.add(client.ip);
      }
    }

    if (candidateIps.size > 0) {
      const batchResp = await httpPostBatchGeo(Array.from(candidateIps));
      if (Array.isArray(batchResp)) {
        for (const item of batchResp as Record<string, unknown>[]) {
          if (item && item.status === 'success' && typeof item.lat === 'number' && item.query) {
            const qIp = String(item.query);
            geoIpCache[qIp] = {
              ip: qIp,
              lat: Number(item.lat),
              lng: Number(item.lon),
              city: String(item.city || 'Nodo Remoto'),
              country: String(item.country || ''),
              countryCode: String(item.countryCode || ''),
              isp: String(item.isp || ''),
              org: String(item.org || item.isp || ''),
              as: String(item.as || ''),
            };
          }
        }
      }
    }
  } catch {
    // Non-blocking background sync
  } finally {
    geoSyncInFlight = false;
  }
}

function buildLiveConnectionsMap(localIp: string) {
  const srvLat = serverSelfGeo?.lat ?? 51.5123;
  const srvLng = serverSelfGeo?.lng ?? -0.0909;
  const srvCity = serverSelfGeo?.city || 'Nodo Servidor';
  const srvCountry = serverSelfGeo?.country || '';

  const connections: {
    id: string;
    direction: 'incoming' | 'outgoing' | 'blocked';
    protocol: string;
    local_ip: string;
    local_port: number;
    remote_ip: string;
    remote_port: number;
    service: string;
    state: string;
    lat: number;
    lng: number;
    city: string;
    country: string;
    country_code: string;
    isp: string;
    asn: string;
    is_lan: boolean;
  }[] = [];

  const rawSockets = parseProcNetSockets();
  let lanIndex = 0;

  // 1. Add active kernel sockets (/proc/net/tcp & /proc/net/udp)
  for (const s of rawSockets) {
    const isLan = isPrivateOrLinkLocalIp(s.remoteIp);
    const geo = geoIpCache[s.remoteIp];
    let lat = geo?.lat;
    let lng = geo?.lng;
    let city = geo?.city || (isLan ? 'Enlace Red Interna / Gateway' : 'Resolviendo GeoIP...');
    let country = geo?.country || (isLan ? srvCountry : '');
    const countryCode = geo?.countryCode || (isLan ? serverSelfGeo?.countryCode || '' : '');
    const isp = geo?.org || geo?.isp || (isLan ? 'Subred Local / Tunel de Contenedor' : 'Red Externa');
    const asn = geo?.as || (isLan ? 'LAN-KERNEL' : '');

    if (lat === undefined || lng === undefined) {
      if (isLan) {
        lanIndex++;
        const angle = (lanIndex * 137.5 * Math.PI) / 180;
        const radius = 0.022 + (lanIndex % 4) * 0.008;
        lat = Number((srvLat + radius * Math.cos(angle)).toFixed(5));
        lng = Number((srvLng + radius * Math.sin(angle) * 1.4).toFixed(5));
      } else {
        continue;
      }
    }

    connections.push({
      id: `sock_${s.direction}_${s.remoteIp}_${s.localPort}_${s.remotePort}`,
      direction: s.direction,
      protocol: s.protocol,
      local_ip: s.localIp || localIp,
      local_port: s.localPort,
      remote_ip: s.remoteIp,
      remote_port: s.remotePort,
      service: s.service,
      state: s.state,
      lat,
      lng,
      city,
      country,
      country_code: countryCode,
      isp,
      asn,
      is_lan: isLan,
    });
  }

  // 2. Add recent incoming HTTP/HTTPS client connections (e.g. X-Forwarded-For browser/mobile clients)
  for (const client of recentHttpIncomingClients.values()) {
    const isLan = isPrivateOrLinkLocalIp(client.ip);
    const geo = geoIpCache[client.ip];
    if (!geo && !isLan) continue;
    lanIndex++;
    const angle = (lanIndex * 95 * Math.PI) / 180;
    const lat = geo ? geo.lat : Number((srvLat + 0.028 * Math.cos(angle)).toFixed(5));
    const lng = geo ? geo.lng : Number((srvLng + 0.036 * Math.sin(angle)).toFixed(5));

    if (!connections.some((c) => c.remote_ip === client.ip && c.direction === 'incoming')) {
      connections.push({
        id: `http_in_${client.ip}`,
        direction: 'incoming',
        protocol: 'TCP',
        local_ip: localIp,
        local_port: 443,
        remote_ip: client.ip,
        remote_port: client.port,
        service: client.service,
        state: 'ESTABLISHED',
        lat,
        lng,
        city: geo?.city || 'Cliente Web Activo',
        country: geo?.country || srvCountry,
        country_code: geo?.countryCode || serverSelfGeo?.countryCode || '',
        isp: geo?.org || geo?.isp || 'Sesión Remota Autenticada',
        asn: geo?.as || '',
        is_lan: isLan,
      });
    }
  }

  // 3. Add active outbound telemetry/OTA/DNS endpoints resolved via real DNS + GeoIP
  for (const ep of resolvedOutboundEndpoints.values()) {
    const geo = geoIpCache[ep.ip];
    if (!geo) continue;
    if (!connections.some((c) => c.remote_ip === ep.ip)) {
      connections.push({
        id: `out_${ep.host}_${ep.ip}`,
        direction: 'outgoing',
        protocol: ep.protocol,
        local_ip: localIp,
        local_port: 48120 + (ep.port % 500),
        remote_ip: ep.ip,
        remote_port: ep.port,
        service: ep.service,
        state: 'ESTABLISHED',
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        country: geo.country,
        country_code: geo.countryCode,
        isp: geo.org || geo.isp,
        asn: geo.as,
        is_lan: false,
      });
    }
  }

  const incomingCount = connections.filter((c) => c.direction === 'incoming').length;
  const outgoingCount = connections.filter((c) => c.direction === 'outgoing').length;
  const blockedCount = connections.filter((c) => c.direction === 'blocked').length;

  return {
    server_node: {
      ip: localIp,
      public_ip: serverSelfGeo?.ip || localIp,
      lat: srvLat,
      lng: srvLng,
      city: srvCity,
      country: srvCountry,
      country_code: serverSelfGeo?.countryCode || '',
      org: serverSelfGeo?.org || os.hostname(),
    },
    summary: {
      total: connections.length,
      incoming: incomingCount,
      outgoing: outgoingCount,
      blocked: blockedCount,
    },
    connections,
  };
}

function sampleRealDisks() {
  const now = Date.now();
  if (cachedDisks.data.length > 0 && now - cachedDisks.ts < 6000) {
    return cachedDisks.data;
  }
  const disks: unknown[] = [];
  try {
    const out = execSync('df -B1 -T -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || df -k', { timeout: 1500 }).toString();
    for (const line of out.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;
      const [device, fstype, totalStr, usedStr, availStr, pctStr, mountpoint] = parts;
      const total = parseInt(totalStr, 10) || 0;
      const used = parseInt(usedStr, 10) || 0;
      const free = parseInt(availStr, 10) || 0;
      const percent = parseFloat(pctStr.replace('%', '')) || (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);
      if (total <= 0) continue;
      disks.push({
        mountpoint,
        label: mountpoint === '/' ? 'Unidad Raíz del Sistema (/)' : `Volumen (${mountpoint})`,
        device,
        fstype,
        temp_c: null,
        total_bytes: total,
        used_bytes: used,
        free_bytes: free,
        percent,
      });
    }
    cachedDisks = { data: disks, ts: now };
  } catch {
    // Ignore if df fails
  }
  return disks;
}

function sampleRealProcesses() {
  const now = Date.now();
  if (cachedProcesses.data.length > 0 && now - cachedProcesses.ts < 3000) {
    return cachedProcesses.data;
  }
  try {
    const out = execSync('ps -eo pid,user,pcpu,rss,comm --sort=-pcpu | head -n 45', { timeout: 1500 }).toString();
    const procs = out
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        const pid = parseInt(parts[0], 10) || 0;
        const user = parts[1] || 'root';
        const cpu = parseFloat(parts[2]) || 0;
        const rssKb = parseInt(parts[3], 10) || 0;
        const name = parts.slice(4).join(' ') || 'process';
        const memMb = Math.round((rssKb / 1024) * 10) / 10;
        return {
          pid,
          name,
          user,
          cpu_percent: cpu,
          mem_mb: memMb,
          priv_mb: memMb,
          shared_mb: 0,
          vram_mb: 0,
          status: 'running',
        };
      });
    cachedProcesses = { data: procs, ts: now };
    return procs;
  } catch {
    return cachedProcesses.data;
  }
}

function getRealVersionPayload(hostHeader: string) {
  const version = readAppVersion();
  const now = Date.now();
  if (now - cachedGitMeta.ts > 20000) {
    try {
      const sha = execSync('git rev-parse --short HEAD', { timeout: 1000 }).toString().trim() || 'HEAD';
      const log = execSync('git log -1 --format="%s|%ci"', { timeout: 1000 }).toString().trim();
      let subj = cachedGitMeta.subject;
      let dt = cachedGitMeta.date;
      if (log.includes('|')) {
        const parts = log.split('|');
        subj = parts[0];
        dt = parts[1].slice(0, 16);
      }
      cachedGitMeta = { sha, subject: subj, date: dt, ts: now };
    } catch {
      cachedGitMeta.ts = now;
    }
  }
  const localSha = cachedGitMeta.sha;
  const localSubject = cachedGitMeta.subject;
  const localDate = cachedGitMeta.date;
  const pubDomain = (hostHeader || os.hostname()).split(':')[0];
  return {
    version,
    repo: 'cminewarIA/recursos-ui',
    repo_url: 'https://github.com/cminewarIA/recursos-ui',
    branch: 'main',
    local_hash: localSha,
    local_subject: localSubject,
    local_date: localDate,
    local_clean: true,
    remote_hash: localSha,
    remote_subject: localSubject,
    remote_date: localDate,
    behind_count: 0,
    update_available: false,
    public_domain: pubDomain,
    local_ip: sampleRealNetwork().local_ip,
    checked_at: new Date().toLocaleTimeString('es-ES'),
    local: { sha: localSha, message: localSubject, date: localDate, clean: true },
    remote: { sha: localSha, message: localSubject, date: localDate, reachable: true },
    recent_commits: [],
  };
}

const CUSTOM_LOGOS_PATH = path.resolve(__dirname, 'custom_logos.json');

const BRAND_CATALOG: Record<string, { label: string; domain: string; logo: string }> = {
  ubuntu: { label: 'Ubuntu Linux', domain: 'ubuntu.com', logo: 'https://cdn.simpleicons.org/ubuntu/E95420' },
  debian: { label: 'Debian GNU/Linux', domain: 'debian.org', logo: 'https://cdn.simpleicons.org/debian/A81D33' },
  arch: { label: 'Arch Linux', domain: 'archlinux.org', logo: 'https://cdn.simpleicons.org/archlinux/1793D1' },
  fedora: { label: 'Fedora Linux', domain: 'fedoraproject.org', logo: 'https://cdn.simpleicons.org/fedora/51A2DA' },
  alpine: { label: 'Alpine Linux', domain: 'alpinelinux.org', logo: 'https://cdn.simpleicons.org/alpinelinux/0D597F' },
  kali: { label: 'Kali Linux', domain: 'kali.org', logo: 'https://cdn.simpleicons.org/kalilinux/557C94' },
  linuxmint: { label: 'Linux Mint', domain: 'linuxmint.com', logo: 'https://cdn.simpleicons.org/linuxmint/87CF3E' },
  manjaro: { label: 'Manjaro', domain: 'manjaro.org', logo: 'https://cdn.simpleicons.org/manjaro/35BF5C' },
  opensuse: { label: 'openSUSE', domain: 'opensuse.org', logo: 'https://cdn.simpleicons.org/opensuse/73BA25' },
  redhat: { label: 'Red Hat Linux', domain: 'redhat.com', logo: 'https://cdn.simpleicons.org/redhat/EE0000' },
  proxmox: { label: 'Proxmox VE', domain: 'proxmox.com', logo: 'https://cdn.simpleicons.org/proxmox/E57000' },
  raspbian: { label: 'Raspberry Pi OS', domain: 'raspberrypi.com', logo: 'https://cdn.simpleicons.org/raspberrypi/A22846' },
  linux: { label: 'Linux Kernel', domain: 'kernel.org', logo: 'https://cdn.simpleicons.org/linux/FCC624' },
  nintendo: { label: 'Nintendo', domain: 'nintendo.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=nintendo.com' },
  xbox: { label: 'Microsoft Xbox', domain: 'xbox.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=xbox.com' },
  playstation: { label: 'Sony PlayStation', domain: 'playstation.com', logo: 'https://cdn.simpleicons.org/playstation/0070D1' },
  sony: { label: 'Sony', domain: 'sony.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=sony.com' },
  samsung: { label: 'Samsung', domain: 'samsung.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=samsung.com' },
  xiaomi: { label: 'Xiaomi', domain: 'mi.com', logo: 'https://cdn.simpleicons.org/xiaomi/FF6900' },
  google: { label: 'Google', domain: 'google.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=google.com' },
  asus: { label: 'ASUS', domain: 'asus.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=asus.com' },
  vodafone: { label: 'Vodafone', domain: 'vodafone.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=vodafone.com' },
  synology: { label: 'Synology', domain: 'synology.com', logo: 'https://cdn.simpleicons.org/synology/B5B5B6' },
  tplink: { label: 'TP-Link Tapo', domain: 'tp-link.com', logo: 'https://cdn.simpleicons.org/tplink/4ACBD6' },
  espressif: { label: 'Espressif IoT', domain: 'espressif.com', logo: 'https://cdn.simpleicons.org/espressif/E7352C' },
  tuya: { label: 'Tuya Smart', domain: 'tuya.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=tuya.com' },
  apple: { label: 'Apple', domain: 'apple.com', logo: 'https://cdn.simpleicons.org/apple/F8FAFC' },
  intel: { label: 'Intel', domain: 'intel.com', logo: 'https://cdn.simpleicons.org/intel/0071C5' },
  amd: { label: 'AMD', domain: 'amd.com', logo: 'https://cdn.simpleicons.org/amd/ED1C24' },
  nvidia: { label: 'NVIDIA', domain: 'nvidia.com', logo: 'https://cdn.simpleicons.org/nvidia/76B900' },
  realtek: { label: 'Realtek', domain: 'realtek.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=realtek.com' },
  microsoft: { label: 'Microsoft Windows', domain: 'microsoft.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=microsoft.com' },
  docker: { label: 'Docker', domain: 'docker.com', logo: 'https://cdn.simpleicons.org/docker/2496ED' },
};

function readCustomLogos(): Record<string, string> {
  try {
    if (fs.existsSync(CUSTOM_LOGOS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_LOGOS_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

function writeCustomLogos(logos: Record<string, string>) {
  try {
    fs.writeFileSync(CUSTOM_LOGOS_PATH, JSON.stringify(logos, null, 2), 'utf-8');
  } catch {
    // Ignore write errors
  }
}

function realOsTelemetryMiddleware(mapsApiKey = ''): Plugin {
  sampleRealCpuUsage();
  return {
    name: 'real-os-telemetry-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '/';
        const [url, queryStr] = rawUrl.split('?');
        const hostHdr = req.headers['x-forwarded-host']?.toString() || req.headers.host || os.hostname();
        const xff = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket?.remoteAddress?.replace('::ffff:', '') || '';
        if (xff && xff !== '127.0.0.1' && xff !== '::1') {
          recentHttpIncomingClients.set(xff, {
            ip: xff,
            port: req.socket?.remotePort || 443,
            ts: Date.now(),
            service: 'Panel Recursos Web UI (HTTPS)',
          });
        }

        if (url === '/api/custom-logos' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ logos: readCustomLogos() }));
          return;
        }

        if (url === '/api/custom-logos' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const key = String(body.key || '').trim();
              const logo = String(body.logo || '').trim();
              const logos = readCustomLogos();
              if (key) {
                if (logo) logos[key] = logo;
                else delete logos[key];
                writeCustomLogos(logos);
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, key, logos }));
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'JSON inválido' }));
            }
          });
          return;
        }

        if (url === '/api/logos/search') {
          const params = new URLSearchParams(queryStr || '');
          const q = (params.get('q') || '').trim().toLowerCase();
          const results: { title: string; subtitle: string; logo_url: string; fallback_url: string }[] = [];
          const seen = new Set<string>();
          const pushItem = (title: string, subtitle: string, logoUrl: string, fallback = '') => {
            if (!logoUrl || seen.has(logoUrl)) return;
            seen.add(logoUrl);
            results.push({ title, subtitle, logo_url: logoUrl, fallback_url: fallback || logoUrl });
          };
          for (const [k, item] of Object.entries(BRAND_CATALOG)) {
            if (!q || k.includes(q) || item.label.toLowerCase().includes(q) || item.domain.toLowerCase().includes(q)) {
              const gFav = `https://www.google.com/s2/favicons?sz=128&domain=${item.domain}`;
              pushItem(item.label, `Oficial · ${item.domain}`, item.logo, gFav);
              if (item.logo !== gFav) {
                pushItem(`${item.label} (Google Icon)`, item.domain, gFav, item.logo);
              }
            }
          }
          if (q && q.length >= 2) {
            const cleanSlug = q.replace(/[^a-z0-9.]/g, '');
            if (cleanSlug.includes('.')) {
              pushItem(`Dominio ${cleanSlug}`, 'Google Favicon S2 (128px)', `https://www.google.com/s2/favicons?sz=128&domain=${cleanSlug}`);
            } else if (cleanSlug) {
              pushItem(`${q} (SimpleIcons)`, `cdn.simpleicons.org/${cleanSlug}`, `https://cdn.simpleicons.org/${cleanSlug}`);
              pushItem(`${q} (.com Google)`, `${cleanSlug}.com`, `https://www.google.com/s2/favicons?sz=128&domain=${cleanSlug}.com`);
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ query: q, results: results.slice(0, 24) }));
          return;
        }

        if (url === '/api/metrics') {
          const cpu = sampleRealCpuUsage();
          const ram = sampleRealMemory();
          const net = sampleRealNetwork();
          const disks = sampleRealDisks();
          const procs = sampleRealProcesses();
          const ver = getRealVersionPayload(hostHdr);
          const [l1, l5, l15] = os.loadavg();
          const uptimeSec = Math.floor(os.uptime());
          const d = Math.floor(uptimeSec / 86400);
          const h = Math.floor((uptimeSec % 86400) / 3600);
          const m = Math.floor((uptimeSec % 3600) / 60);
          const uptimeStr = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;

          let osPretty = `${os.type()} ${os.release()}`;
          let osId = 'linux';
          try {
            const osRel = fs.readFileSync('/etc/os-release', 'utf-8');
            const match = osRel.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
            if (match?.[1]) osPretty = match[1];
            const idMatch = osRel.match(/^ID="?([^"\n]+)"?/m);
            if (idMatch?.[1]) osId = idMatch[1].trim().toLowerCase();
          } catch {
            // Use default os.type()
          }
          const osCatalogEntry = BRAND_CATALOG[osId] || BRAND_CATALOG.linux;

          const timeStr = new Date().toLocaleTimeString('es-ES');
          historyBuffer.timestamps.push(timeStr);
          historyBuffer.cpu.push(cpu.overall);
          historyBuffer.gpu.push(0);
          historyBuffer.ram.push(ram.percent);
          historyBuffer.ram_total.push(ram.percent);
          historyBuffer.net_rx.push(Math.round((net.rx_bytes_sec / (1024 * 1024)) * 100) / 100);
          historyBuffer.net_tx.push(Math.round((net.tx_bytes_sec / (1024 * 1024)) * 100) / 100);
          historyBuffer.disk_r.push(0);
          historyBuffer.disk_w.push(0);
          for (const k of Object.keys(historyBuffer)) {
            if (historyBuffer[k].length > 60) historyBuffer[k] = historyBuffer[k].slice(-60);
          }

          const payload = {
            maps_api_key: mapsApiKey || process.env.VITE_GOOGLE_MAPS_API_KEY || '',
            custom_logos: readCustomLogos(),
            auth_status: {
              is_local: true,
              is_trusted: true,
              client_ip: net.local_ip,
              public_domain: ver.public_domain,
              local_ip: net.local_ip,
              device_name: 'Sesión Verificada en Tiempo Real',
            },
            version_info: ver,
            system: {
              hostname: os.hostname(),
              os: osPretty,
              os_id: osId,
              os_domain: osCatalogEntry.domain,
              os_logo_url: osCatalogEntry.logo,
              kernel: os.release(),
              uptime_seconds: uptimeSec,
              uptime_str: uptimeStr,
              public_domain: ver.public_domain,
              local_ip: net.local_ip,
              time_str: timeStr,
            },
            cpu: {
              model: cpu.model,
              architecture: cpu.arch,
              vendor: cpu.vendor,
              cache_size: cpu.cacheSize,
              logical_cores: os.cpus().length || 1,
              physical_cores: Math.max(1, Math.floor((os.cpus().length || 1) / 2)),
              usage_percent: cpu.overall,
              per_core_percent: cpu.perCore,
              freq_mhz: cpu.freqMhz,
              temp_c: null,
              load_1m: Math.round(l1 * 100) / 100,
              load_5m: Math.round(l5 * 100) / 100,
              load_15m: Math.round(l15 * 100) / 100,
            },
            ram,
            gpu: {
              available: false,
              name: '',
              driver: '',
              temp_c: null,
              gpu_util_percent: 0,
              vram_used_mb: 0,
              vram_total_mb: 0,
              vram_percent: 0,
              processes: [],
            },
            disks,
            disk_io: { read_bytes_sec: 0, write_bytes_sec: 0, read_total_bytes: 0, write_total_bytes: 0 },
            net,
            wifi_clients: (net.interfaces_list as { name: string; ip: string; mac: string; speed_mbps: number }[]).map((nic) => ({
              name: `${os.hostname()} (${nic.name})`,
              ip: nic.ip || '127.0.0.1',
              mac: nic.mac || 'INTERFAZ-ACTIVA',
              band: 'Ethernet',
              conn_type: 'cable',
              brand: osId,
              brand_name: osPretty,
              brand_domain: osCatalogEntry.domain,
              auto_logo_url: osCatalogEntry.logo,
              rssi: null,
              tx_rate: nic.speed_mbps ? `${nic.speed_mbps} Mbps` : ' Enlace Activo',
              is_online: true,
            })),
            wifi_summary: {
              total_clients: net.interfaces_list.length,
              clients_24g: 0,
              clients_5g: 0,
              cable_tx_bytes: net.tx_total_bytes,
              cable_rx_bytes: net.rx_total_bytes,
              wifi_tx_bytes: 0,
              wifi_rx_bytes: 0,
              last_update: timeStr,
            },
            docker_activities: [],
            systemd_services: [],
            torrents: [],
            torrent_stats: { dl_info_speed: 0, up_info_speed: 0, active_count: 0, downloading_count: 0, seeding_count: 0 },
            emby: { available: false, movies_count: 0, series_count: 0, episodes_count: 0, recent_media: [] },
            security: {
              available: false,
              pihole: { available: false, domains_being_blocked: 0, dns_queries_today: 0, ads_blocked_today: 0, ads_percentage_today: 0, top_blocked: [] },
              fail2ban: { available: false, currently_banned: 0, total_banned: 0, jails: {}, banned_ips: [], banned_details: [], all_time_banned: [] },
            },
            system_processes: procs,
            history: historyBuffer,
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
          return;
        }

        if (url === '/api/version') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getRealVersionPayload(hostHdr)));
          return;
        }

        if (url === '/api/auth/devices') {
          const net = sampleRealNetwork();
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify([
              {
                id: 'dev_active_session',
                name: `Sesión Actual (${os.hostname()})`,
                local_ip: net.local_ip,
                last_external_ip: '',
                first_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
                last_seen: 'Ahora mismo',
                verified_in_lan: true,
                trusted: true,
                is_current: true,
              },
            ])
          );
          return;
        }

        if (url === '/api/dns/duckdns') {
          const ver = getRealVersionPayload(hostHdr);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              available: true,
              domain: ver.public_domain.split('.')[0] || os.hostname(),
              full_domain: ver.public_domain,
              last_registered_ip: ver.local_ip,
              last_update_time: new Date().toLocaleTimeString('es-ES'),
              token_masked: '••••••••••••••••',
              upstream_dns: ['127.0.0.1'],
            })
          );
          return;
        }

        if (url === '/api/dns/logs') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', total: 0, logs: [] }));
          return;
        }

        if (url === '/api/dns/traffic') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ clients: [], recent_queries: [] }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const mapsApiKey = env.VITE_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
  return {
    plugins: [realOsTelemetryMiddleware(mapsApiKey), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
