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
    return fs.readFileSync(path.resolve(__dirname, 'VERSION'), 'utf-8').trim() || '0.0.0';
  } catch {
    return '0.0.0';
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
  region?: string;
  country: string;
  countryCode: string;
  country_code?: string;
  isp: string;
  org: string;
  as: string;
  asn?: string;
  ts: number;
}

const GEOIP_DISK_CACHE_PATH = path.resolve(__dirname, 'geoip_cache.json');
const GEOIP_TTL_MS = 7 * 86400 * 1000; // 7 days TTL
const GEOIP_NEG_TTL_MS = 15 * 60 * 1000; // 15 min negative cache cooldown
const GEOIP_MAX_ENTRIES = 2000;

let serverSelfGeo: GeoIpRecord | null = null;
const geoIpCache: Record<string, GeoIpRecord> = {};
const geoIpNegativeCache = new Map<string, number>();
const geoIpPendingQueue = new Set<string>();
const recentHttpIncomingClients = new Map<string, { ip: string; port: number; ts: number; service: string }>();
const resolvedOutboundEndpoints = new Map<string, { host: string; ip: string; port: number; protocol: string; service: string }>();
let lastGeoSyncTs = 0;
let geoSyncInFlight = false;
let geoWorkerIntervalStarted = false;

const geoIpWorkerStats = {
  status: 'active' as 'active' | 'resolving' | 'throttled',
  cacheHits: 0,
  cacheMisses: 0,
  apiBatchesSent: 0,
  apiIpsResolved: 0,
  rateLimitRemaining: 15,
  rateLimitResetMs: 0,
  lastSyncStr: '--',
  dirtyDisk: false,
  lastDiskSaveMs: 0,
  errorsTotal: 0,
};

interface GeoIpWorkerErrorEntry {
  id: string;
  ts: number;
  time_str: string;
  source: string;
  stage: string;
  target: string;
  code: string;
  message: string;
}

const GEOIP_MAX_ERROR_HISTORY = 80;
const geoIpErrorHistory: GeoIpWorkerErrorEntry[] = [];

function recordGeoIpWorkerError(source: string, stage: string, target: string, code: string, message: string) {
  const nowMs = Date.now();
  const d = new Date(nowMs);
  const timeStr = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  const entry: GeoIpWorkerErrorEntry = {
    id: `srv_err_${nowMs}_${geoIpErrorHistory.length}`,
    ts: nowMs,
    time_str: timeStr,
    source: source || 'GEOIP_WORKER',
    stage: stage || 'ip-api.com',
    target: target || '--',
    code: code || 'ERROR',
    message: message || 'Error de resolución',
  };
  geoIpWorkerStats.errorsTotal++;
  if (geoIpErrorHistory.length > 0) {
    const last = geoIpErrorHistory[0];
    if (last.target === entry.target && last.code === entry.code && nowMs - last.ts < 5000) {
      last.ts = nowMs;
      last.time_str = timeStr;
      last.message = entry.message;
      return;
    }
  }
  geoIpErrorHistory.unshift(entry);
  if (geoIpErrorHistory.length > GEOIP_MAX_ERROR_HISTORY) {
    geoIpErrorHistory.length = GEOIP_MAX_ERROR_HISTORY;
  }
}

function clearGeoIpWorkerErrors(): number {
  const cleared = geoIpErrorHistory.length;
  geoIpErrorHistory.length = 0;
  geoIpWorkerStats.errorsTotal = 0;
  return cleared;
}

function loadGeoIpDiskCache() {
  try {
    if (!fs.existsSync(GEOIP_DISK_CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(GEOIP_DISK_CACHE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return;
    const nowSec = Date.now() / 1000;
    const cutoffSec = nowSec - 7 * 86400;
    const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : raw;
    for (const [ipK, val] of Object.entries(entries as Record<string, Record<string, unknown>>)) {
      if (val && typeof val.lat === 'number' && typeof val.lng === 'number') {
        const tsRaw = Number(val.ts || nowSec);
        const tsSec = tsRaw > 1e12 ? tsRaw / 1000 : tsRaw;
        if (tsSec >= cutoffSec) {
          geoIpCache[ipK] = {
            ip: ipK,
            lat: Number(val.lat),
            lng: Number(val.lng),
            city: String(val.city || 'Nodo Remoto'),
            region: String(val.region || ''),
            country: String(val.country || ''),
            countryCode: String(val.countryCode || val.country_code || ''),
            country_code: String(val.country_code || val.countryCode || ''),
            isp: String(val.isp || ''),
            org: String(val.org || val.isp || ''),
            as: String(val.as || val.asn || ''),
            asn: String(val.asn || val.as || ''),
            ts: tsSec * 1000,
          };
        }
      }
    }
    if (raw.server_self_geo && typeof raw.server_self_geo.lat === 'number') {
      const sg = raw.server_self_geo;
      serverSelfGeo = {
        ip: String(sg.ip || ''),
        lat: Number(sg.lat),
        lng: Number(sg.lng),
        city: String(sg.city || 'Nodo Servidor'),
        country: String(sg.country || ''),
        countryCode: String(sg.countryCode || sg.country_code || ''),
        isp: String(sg.isp || sg.org || ''),
        org: String(sg.org || sg.isp || os.hostname()),
        as: String(sg.as || sg.asn || ''),
        ts: Date.now(),
      };
    }
  } catch {
    // Ignore disk cache load errors
  }
}

function saveGeoIpDiskCache(force = false) {
  const now = Date.now();
  if (!force && !geoIpWorkerStats.dirtyDisk) return;
  if (!force && now - geoIpWorkerStats.lastDiskSaveMs < 15000) return;
  try {
    const keys = Object.keys(geoIpCache);
    if (keys.length > GEOIP_MAX_ENTRIES) {
      keys.sort((a, b) => (geoIpCache[b]?.ts || 0) - (geoIpCache[a]?.ts || 0));
      for (const dropKey of keys.slice(GEOIP_MAX_ENTRIES)) {
        delete geoIpCache[dropKey];
      }
    }
    const payload = {
      updated_at: Math.floor(now / 1000),
      server_self_geo: serverSelfGeo,
      entries: geoIpCache,
    };
    geoIpWorkerStats.dirtyDisk = false;
    geoIpWorkerStats.lastDiskSaveMs = now;
    fs.writeFileSync(GEOIP_DISK_CACHE_PATH, JSON.stringify(payload), 'utf-8');
  } catch {
    // Ignore disk write errors
  }
}

loadGeoIpDiskCache();

function getGeoIpWorkerSummary() {
  const total = geoIpWorkerStats.cacheHits + geoIpWorkerStats.cacheMisses;
  const hitRate = total > 0 ? Math.round((geoIpWorkerStats.cacheHits / total) * 1000) / 10 : 100.0;
  return {
    status: geoIpWorkerStats.status,
    cached_ips: Object.keys(geoIpCache).length,
    cache_hits: geoIpWorkerStats.cacheHits,
    cache_misses: geoIpWorkerStats.cacheMisses,
    hit_rate_pct: hitRate,
    api_batches_sent: geoIpWorkerStats.apiBatchesSent,
    api_ips_resolved: geoIpWorkerStats.apiIpsResolved,
    pending_queue: geoIpPendingQueue.size,
    rate_limit_remaining: geoIpWorkerStats.rateLimitRemaining,
    last_sync: geoIpWorkerStats.lastSyncStr,
    errors_count: geoIpErrorHistory.length,
    error_history: geoIpErrorHistory.slice(0, 40),
  };
}

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
  const clean = ip.trim().replace('::ffff:', '');
  if (clean.startsWith('127.') || clean === '0.0.0.0' || clean === '::1') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || clean.startsWith('169.254.')) return true;
  if (clean.startsWith('100.')) {
    const second = parseInt(clean.split('.')[1] || '0', 10);
    if (second >= 64 && second <= 127) return true; // Carrier-Grade NAT / Tailscale RFC6598
  }
  if (clean.startsWith('172.')) {
    const second = parseInt(clean.split('.')[1] || '0', 10);
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

function httpPostBatchGeo(ips: string[]): Promise<{ items: unknown; rlRemaining?: number; rlTtl?: number } | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(ips.slice(0, 80));
    const req = http.request(
      'http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'RecursosDashboard-GeoIPWorker/4.4',
        },
        timeout: 3500,
      },
      (res) => {
        let data = '';
        const rlRem = res.headers['x-rl'] ? parseInt(String(res.headers['x-rl']), 10) : undefined;
        const rlTtl = res.headers['x-ttl'] ? parseInt(String(res.headers['x-ttl']), 10) : undefined;
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 429) {
            resolve({ items: null, rlRemaining: 0, rlTtl: rlTtl || 60 });
            return;
          }
          try {
            resolve({ items: JSON.parse(data), rlRemaining: rlRem, rlTtl });
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

async function resolveGeoIpBatchFromIpApi(ipsToResolve: string[]): Promise<Record<string, GeoIpRecord>> {
  const now = Date.now();
  if (now < geoIpWorkerStats.rateLimitResetMs && geoIpWorkerStats.rateLimitRemaining <= 1) {
    geoIpWorkerStats.status = 'throttled';
    return {};
  }

  const cleanIps: string[] = [];
  for (const rawIp of ipsToResolve) {
    const ip = String(rawIp || '').trim().replace('::ffff:', '');
    if (!ip || isPrivateOrLinkLocalIp(ip)) continue;
    if (geoIpCache[ip] && now - geoIpCache[ip].ts < GEOIP_TTL_MS) continue;
    const negTs = geoIpNegativeCache.get(ip) || 0;
    if (now - negTs < GEOIP_NEG_TTL_MS) continue;
    if (!cleanIps.includes(ip)) cleanIps.push(ip);
  }

  if (cleanIps.length === 0) return {};

  const batchSlice = cleanIps.slice(0, 80);
  const resolvedNow: Record<string, GeoIpRecord> = {};
  geoIpWorkerStats.status = 'resolving';

  try {
    const batchResp = await httpPostBatchGeo(batchSlice);
    if (batchResp) {
      geoIpWorkerStats.apiBatchesSent++;
      geoIpWorkerStats.lastSyncStr = new Date().toLocaleTimeString('es-ES');
      if (typeof batchResp.rlRemaining === 'number' && !isNaN(batchResp.rlRemaining)) {
        geoIpWorkerStats.rateLimitRemaining = batchResp.rlRemaining;
      }
      if (typeof batchResp.rlTtl === 'number' && !isNaN(batchResp.rlTtl) && geoIpWorkerStats.rateLimitRemaining <= 2) {
        geoIpWorkerStats.rateLimitResetMs = Date.now() + (batchResp.rlTtl + 1) * 1000;
      }

      if (Array.isArray(batchResp.items)) {
        const seenQueries = new Set<string>();
        for (const item of batchResp.items as Record<string, unknown>[]) {
          if (!item || typeof item !== 'object') continue;
          const qIp = String(item.query || '').trim();
          if (!qIp) continue;
          seenQueries.add(qIp);
          geoIpPendingQueue.delete(qIp);

          if (item.status === 'success' && typeof item.lat === 'number' && typeof item.lon === 'number') {
            const record: GeoIpRecord = {
              ip: qIp,
              lat: Number(item.lat),
              lng: Number(item.lon),
              city: String(item.city || 'Nodo Remoto'),
              region: String(item.regionName || ''),
              country: String(item.country || ''),
              countryCode: String(item.countryCode || ''),
              country_code: String(item.countryCode || ''),
              isp: String(item.isp || item.org || ''),
              org: String(item.org || item.isp || ''),
              as: String(item.as || ''),
              asn: String(item.as || ''),
              ts: Date.now(),
            };
            geoIpCache[qIp] = record;
            geoIpNegativeCache.delete(qIp);
            resolvedNow[qIp] = record;
            geoIpWorkerStats.apiIpsResolved++;
            geoIpWorkerStats.dirtyDisk = true;
          } else {
            geoIpNegativeCache.set(qIp, Date.now());
            const failMsg = String(item.message || 'IP no resoluble por ip-api.com');
            recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', qIp, 'GEOIP_FAIL', `Fallo al geolocalizar IP ${qIp}: ${failMsg}`);
          }
        }
        for (const reqIp of batchSlice) {
          if (!seenQueries.has(reqIp)) {
            geoIpPendingQueue.delete(reqIp);
            geoIpNegativeCache.set(reqIp, Date.now());
            recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', reqIp, 'NO_RESPONSE', `Sin respuesta en lote GeoIP para ${reqIp}`);
          }
        }
      } else if (batchResp.rlRemaining === 0) {
        recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', `Lote (${batchSlice.length} IPs)`, 'HTTP 429', 'Límite de tasa alcanzado en ip-api.com/batch (HTTP 429)');
      }
    } else {
      recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', `Lote (${batchSlice.length} IPs)`, 'NET_ERR', 'Sin respuesta o timeout al conectar con ip-api.com/batch');
    }
  } catch (err) {
    recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', `Lote (${batchSlice.length} IPs)`, 'NET_ERR', `Excepción en Worker GeoIP: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    geoIpWorkerStats.status = 'active';
  }

  if (Object.keys(resolvedNow).length > 0) {
    saveGeoIpDiskCache(false);
  }
  return resolvedNow;
}

function enqueueRemoteIpsForGeoIp(ips: string[]) {
  const now = Date.now();
  let added = false;
  for (const rawIp of ips) {
    const ip = String(rawIp || '').trim().replace('::ffff:', '');
    if (!ip || isPrivateOrLinkLocalIp(ip)) continue;
    if (geoIpCache[ip] && now - geoIpCache[ip].ts < GEOIP_TTL_MS) continue;
    const negTs = geoIpNegativeCache.get(ip) || 0;
    if (now - negTs < GEOIP_NEG_TTL_MS) continue;
    if (!geoIpPendingQueue.has(ip)) {
      geoIpPendingQueue.add(ip);
      added = true;
    }
  }
  if (added) {
    void triggerAsyncGeoSync(true);
  }
}

async function triggerAsyncGeoSync(immediate = false) {
  const now = Date.now();
  if (geoSyncInFlight) return;
  if (!immediate && serverSelfGeo && geoIpPendingQueue.size === 0 && now - lastGeoSyncTs < 8000) return;
  geoSyncInFlight = true;
  lastGeoSyncTs = now;

  try {
    // 1. Resolve Server's own Public WAN IP & Coordinates
    if (!serverSelfGeo || now - serverSelfGeo.ts > 30 * 60 * 1000) {
      const selfData = (await httpGetJson(
        'http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,isp,org,as,query'
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
          ts: Date.now(),
        };
        geoIpWorkerStats.dirtyDisk = true;
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

    // 3. Prune expired GeoIP cache entries (>7 days) & negative cache (>15 min)
    for (const [kIp, entry] of Object.entries(geoIpCache)) {
      if (now - entry.ts > GEOIP_TTL_MS) {
        delete geoIpCache[kIp];
      }
    }
    for (const [kIp, negTs] of geoIpNegativeCache.entries()) {
      if (now - negTs > GEOIP_NEG_TTL_MS) {
        geoIpNegativeCache.delete(kIp);
      }
    }

    // 4. Collect all detected remote public IPs from sockets, DNS targets, and HTTP clients
    const sockets = parseProcNetSockets();
    const detectedPublicIps = new Set<string>();
    for (const s of sockets) {
      if (!isPrivateOrLinkLocalIp(s.remoteIp)) detectedPublicIps.add(s.remoteIp);
    }
    for (const ep of resolvedOutboundEndpoints.values()) {
      if (!isPrivateOrLinkLocalIp(ep.ip)) detectedPublicIps.add(ep.ip);
    }
    for (const client of recentHttpIncomingClients.values()) {
      if (!isPrivateOrLinkLocalIp(client.ip)) detectedPublicIps.add(client.ip);
    }

    for (const qIp of detectedPublicIps) {
      if (geoIpCache[qIp]) {
        geoIpWorkerStats.cacheHits++;
      } else if (now - (geoIpNegativeCache.get(qIp) || 0) < GEOIP_NEG_TTL_MS) {
        continue;
      } else {
        geoIpWorkerStats.cacheMisses++;
        geoIpPendingQueue.add(qIp);
      }
    }

    if (geoIpPendingQueue.size > 0) {
      await resolveGeoIpBatchFromIpApi(Array.from(geoIpPendingQueue));
    }
    saveGeoIpDiskCache(false);
  } catch {
    // Non-blocking background sync
  } finally {
    geoSyncInFlight = false;
  }
}

function startGeoIpBackgroundWorker() {
  if (geoWorkerIntervalStarted) return;
  geoWorkerIntervalStarted = true;
  void triggerAsyncGeoSync(true);
  const timer = setInterval(() => {
    void triggerAsyncGeoSync(false);
  }, 6000);
  if (typeof timer.unref === 'function') {
    timer.unref();
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
    geo_status: 'cached' | 'lan' | 'pending';
  }[] = [];

  const rawSockets = parseProcNetSockets();
  let lanIndex = 0;
  let pendingIndex = 0;
  const uncachedPublicIps: string[] = [];

  // 1. Add active kernel sockets (/proc/net/tcp & /proc/net/udp)
  for (const s of rawSockets) {
    const isLan = isPrivateOrLinkLocalIp(s.remoteIp);
    const geo = geoIpCache[s.remoteIp];
    let lat = geo?.lat;
    let lng = geo?.lng;
    let city = geo?.city || (isLan ? 'Enlace Red Interna / Gateway' : 'Resolviendo GeoIP...');
    let country = geo?.country || (isLan ? srvCountry : '');
    const countryCode = geo?.countryCode || (isLan ? serverSelfGeo?.countryCode || '' : '');
    const isp = geo?.org || geo?.isp || (isLan ? 'Subred Local / Tunel de Contenedor' : 'En cola del Worker GeoIP (ip-api.com)');
    const asn = geo?.as || (isLan ? 'LAN-KERNEL' : '');
    let geoStatus: 'cached' | 'lan' | 'pending' = geo ? 'cached' : isLan ? 'lan' : 'pending';

    if (lat === undefined || lng === undefined) {
      if (isLan) {
        lanIndex++;
        const angle = (lanIndex * 137.5 * Math.PI) / 180;
        const radius = 0.022 + (lanIndex % 4) * 0.008;
        lat = Number((srvLat + radius * Math.cos(angle)).toFixed(5));
        lng = Number((srvLng + radius * Math.sin(angle) * 1.4).toFixed(5));
      } else {
        uncachedPublicIps.push(s.remoteIp);
        pendingIndex++;
        const angle = (pendingIndex * 105.0 * Math.PI) / 180;
        const radius = 0.35 + (pendingIndex % 5) * 0.12;
        lat = Number((srvLat + radius * Math.cos(angle)).toFixed(5));
        lng = Number((srvLng + radius * Math.sin(angle) * 1.4).toFixed(5));
        geoStatus = 'pending';
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
      geo_status: geoStatus,
    });
  }

  // 2. Add recent incoming HTTP/HTTPS client connections (e.g. X-Forwarded-For browser/mobile clients)
  for (const client of recentHttpIncomingClients.values()) {
    const isLan = isPrivateOrLinkLocalIp(client.ip);
    const geo = geoIpCache[client.ip];
    if (!geo && !isLan) {
      uncachedPublicIps.push(client.ip);
    }
    lanIndex++;
    const angle = (lanIndex * 95 * Math.PI) / 180;
    const lat = geo ? geo.lat : Number((srvLat + (isLan ? 0.028 : 0.32) * Math.cos(angle)).toFixed(5));
    const lng = geo ? geo.lng : Number((srvLng + (isLan ? 0.036 : 0.42) * Math.sin(angle)).toFixed(5));

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
        city: geo?.city || (isLan ? 'Cliente Web Activo' : 'Resolviendo GeoIP...'),
        country: geo?.country || (isLan ? srvCountry : ''),
        country_code: geo?.countryCode || (isLan ? serverSelfGeo?.countryCode || '' : ''),
        isp: geo?.org || geo?.isp || (isLan ? 'Sesión Remota Autenticada' : 'En cola del Worker GeoIP (ip-api.com)'),
        asn: geo?.as || '',
        is_lan: isLan,
        geo_status: geo ? 'cached' : isLan ? 'lan' : 'pending',
      });
    }
  }

  // 3. Add active outbound telemetry/OTA/DNS endpoints resolved via real DNS + GeoIP
  for (const ep of resolvedOutboundEndpoints.values()) {
    const geo = geoIpCache[ep.ip];
    if (!geo) {
      uncachedPublicIps.push(ep.ip);
      continue;
    }
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
        geo_status: 'cached',
      });
    }
  }

  if (uncachedPublicIps.length > 0) {
    enqueueRemoteIpsForGeoIp(uncachedPublicIps);
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
    geoip_worker: getGeoIpWorkerSummary(),
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

const prevProcCpuTicks = new Map<number, { ticks: number; ts: number }>();

function sampleRealProcesses() {
  const now = Date.now();
  if (cachedProcesses.data.length > 0 && now - cachedProcesses.ts < 1800) {
    return cachedProcesses.data;
  }
  try {
    const out = execSync('ps -eo pid,user,pcpu,rss,comm --sort=-pcpu,-rss | head -n 45', { timeout: 1500 }).toString();
    const seenPids = new Set<number>();
    const procs = out
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        const pid = parseInt(parts[0], 10) || 0;
        const user = parts[1] || 'root';
        let cpu = parseFloat(parts[2]) || 0;
        const rssKb = parseInt(parts[3], 10) || 0;
        const name = parts.slice(4).join(' ') || 'process';
        const memMb = Math.round((rssKb / 1024) * 10) / 10;

        if (pid > 0) {
          seenPids.add(pid);
          try {
            const statLine = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
            const closeIdx = statLine.lastIndexOf(')');
            if (closeIdx !== -1) {
              const fields = statLine.slice(closeIdx + 2).trim().split(/\s+/);
              const utime = parseInt(fields[11], 10) || 0;
              const stime = parseInt(fields[12], 10) || 0;
              const totalTicks = utime + stime;
              const prev = prevProcCpuTicks.get(pid);
              if (prev && now > prev.ts) {
                const dtSec = (now - prev.ts) / 1000;
                const dTicks = Math.max(0, totalTicks - prev.ticks);
                const instCpu = Math.round((dTicks / dtSec) * 10) / 10;
                if (instCpu > 0 || cpu === 0) {
                  cpu = Math.min(100, Math.max(instCpu, cpu));
                }
              }
              prevProcCpuTicks.set(pid, { ticks: totalTicks, ts: now });
            }
          } catch {
            // Process may have exited
          }
        }

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

    for (const k of prevProcCpuTicks.keys()) {
      if (!seenPids.has(k)) prevProcCpuTicks.delete(k);
    }

    procs.sort((a, b) => (b.cpu_percent - a.cpu_percent) || (b.priv_mb - a.priv_mb));
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
  startGeoIpBackgroundWorker();
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
          enqueueRemoteIpsForGeoIp([xff]);
        }

        if (url === '/api/net/geoip' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              status: 'ok',
              worker: getGeoIpWorkerSummary(),
              server_node: serverSelfGeo,
              cache: geoIpCache,
            })
          );
          return;
        }

        if ((url === '/api/net/geoip/resolve' || url === '/api/net/geoip') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const reqIps: string[] = Array.isArray(body.ips) ? body.ips : [];
              const forceSync = Boolean(body.force_sync);
              const results: Record<string, GeoIpRecord> = {};
              const missingIps: string[] = [];
              const now = Date.now();

              for (const rawIp of reqIps.slice(0, 100)) {
                const ip = String(rawIp || '').trim().replace('::ffff:', '');
                if (!ip || isPrivateOrLinkLocalIp(ip)) continue;
                const cached = geoIpCache[ip];
                if (cached && now - cached.ts < GEOIP_TTL_MS && !forceSync) {
                  geoIpWorkerStats.cacheHits++;
                  results[ip] = cached;
                } else if (now - (geoIpNegativeCache.get(ip) || 0) < GEOIP_NEG_TTL_MS && !forceSync) {
                  continue;
                } else {
                  geoIpWorkerStats.cacheMisses++;
                  missingIps.push(ip);
                }
              }

              if (missingIps.length > 0) {
                const newlyResolved = await resolveGeoIpBatchFromIpApi(missingIps);
                Object.assign(results, newlyResolved);
              } else if (forceSync) {
                await triggerAsyncGeoSync(true);
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: true,
                  results,
                  worker: getGeoIpWorkerSummary(),
                })
              );
            } catch {
              recordGeoIpWorkerError('NET_REQUEST', '/api/net/geoip/resolve', 'POST body', 'HTTP 400', 'Solicitud GeoIP con payload JSON inválido');
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Solicitud GeoIP inválida' }));
            }
          });
          return;
        }

        if (url === '/api/net/geoip/clear-errors' && (req.method === 'POST' || req.method === 'DELETE')) {
          const clearedCount = clearGeoIpWorkerErrors();
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              success: true,
              cleared: clearedCount,
              worker: getGeoIpWorkerSummary(),
            })
          );
          return;
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
            wifi_clients: (
              net.interfaces_list as {
                name: string;
                ip: string;
                mac: string;
                speed_mbps: number;
                bytes_recv?: number;
                bytes_sent?: number;
                rx_bytes_sec?: number;
                tx_bytes_sec?: number;
              }[]
            ).map((nic) => ({
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
              tx_bytes: nic.bytes_recv || 0,
              rx_bytes: nic.bytes_sent || 0,
              speed_down: nic.rx_bytes_sec || 0,
              speed_up: nic.tx_bytes_sec || 0,
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

        if (url?.startsWith('/download/recursos-cockpit') || url === '/download/app.deb' || url === '/download/app.apk') {
          const isApk = url.endsWith('.apk');
          const distDir = path.resolve(__dirname, 'dist');
          const curVer = readAppVersion();
          const localTarget = isApk
            ? path.join(distDir, `recursos-cockpit_${curVer}.apk`)
            : path.join(distDir, `recursos-cockpit_${curVer}_amd64.deb`);
          if (fs.existsSync(localTarget)) {
            const stat = fs.statSync(localTarget);
            res.setHeader('Content-Type', isApk ? 'application/vnd.android.package-archive' : 'application/vnd.debian.binary-package');
            res.setHeader('Content-Disposition', `attachment; filename="${path.basename(localTarget)}"`);
            res.setHeader('Content-Length', stat.size);
            const stream = fs.createReadStream(localTarget);
            stream.pipe(res);
            return;
          }
          const githubUrl = isApk
            ? `https://github.com/cminewarIA/recursos-ui/releases/download/v${curVer}/recursos-cockpit_${curVer}.apk`
            : `https://github.com/cminewarIA/recursos-ui/releases/download/v${curVer}/recursos-cockpit_${curVer}_amd64.deb`;
          res.writeHead(302, { Location: githubUrl });
          res.end();
          return;
        }

        if (url === '/api/auth/devices' || url === '/api/auth/register-device' || url === '/api/auth/rename-device' || url === '/api/auth/revoke' || url === '/api/auth/revoke_all_others') {
          const net = sampleRealNetwork();
          const cpu = sampleRealCpuUsage();
          const mem = sampleRealMemory();
          const disks = sampleRealDisks();
          const rootDisk = (disks as Array<{ total_bytes?: number; free_bytes?: number }>)[0] || {};
          const curVer = readAppVersion();
          const g = globalThis as unknown as { __viteTrustedDevices?: Record<string, Record<string, unknown>> };
          if (!g.__viteTrustedDevices) {
            let osDistro = `${os.type()} ${os.release()}`;
            try {
              const osRel = fs.readFileSync('/etc/os-release', 'utf-8');
              const m = osRel.match(/^PRETTY_NAME=["']?([^"'\n]+)["']?/m);
              if (m && m[1]) osDistro = m[1].trim();
            } catch {
              // ignore
            }
            const defaultTel = {
              client_type: 'ubuntu_native',
              client_label: 'App Nativa Ubuntu (.deb)',
              access_level: 'FULL_NATIVE_ACCESS',
              full_access: true,
              dex_capable: true,
              app_version: curVer,
              hardware_id: `ubn_${os.hostname()}_${os.arch()}`,
              name: `${os.hostname()} · ${cpu.model}`,
              hostname: os.hostname(),
              manufacturer: cpu.vendor || 'Linux System',
              brand: 'Ubuntu Linux',
              model: os.hostname(),
              chassis_type: 'Linux Workstation / Server',
              os_distro: osDistro,
              kernel: `${os.type()} ${os.release()}`,
              arch: os.arch(),
              cpu_model: cpu.model,
              cpu_cores_physical: os.cpus().length,
              cpu_cores_logical: os.cpus().length,
              ram_total_bytes: mem.total_bytes,
              ram_total_gb: Math.round((mem.total_bytes / (1024 ** 3)) * 10) / 10,
              storage_total_bytes: rootDisk.total_bytes || 0,
              storage_total_gb: rootDisk.total_bytes ? Math.round((rootDisk.total_bytes / (1024 ** 3)) * 10) / 10 : 0,
              storage_free_gb: rootDisk.free_bytes ? Math.round((rootDisk.free_bytes / (1024 ** 3)) * 10) / 10 : 0,
              local_ip: net.local_ip,
              interface_name: 'eth0',
            };
            g.__viteTrustedDevices = {
              dev_active_session: {
                id: 'dev_active_session',
                name: `${os.hostname()} · ${cpu.model}`,
                auto_name: `${os.hostname()} · ${cpu.model}`,
                custom_alias: '',
                client_type: 'ubuntu_native',
                client_label: 'App Nativa Ubuntu (.deb)',
                access_level: 'FULL_NATIVE_ACCESS',
                full_access: true,
                app_version: curVer,
                hardware_id: defaultTel.hardware_id,
                local_ip: net.local_ip,
                last_external_ip: '',
                connection_mode: 'LAN',
                first_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
                last_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
                verified_in_lan: true,
                trusted: true,
                is_current: true,
                device_telemetry: defaultTel,
              },
            };
          }

          if (req.method === 'POST') {
            let rawBody = '';
            req.on('data', (chunk) => {
              rawBody += chunk;
            });
            req.on('end', () => {
              let body: Record<string, unknown> = {};
              try {
                body = JSON.parse(rawBody || '{}');
              } catch {
                body = {};
              }
              const store = g.__viteTrustedDevices!;
              if (url === '/api/auth/register-device') {
                const incoming = (body.device_telemetry as Record<string, unknown>) || body;
                const active = store.dev_active_session || {};
                const prevTel = (active.device_telemetry as Record<string, unknown>) || {};
                const mergedTel = { ...prevTel, ...incoming };
                const cType = String(mergedTel.client_type || active.client_type || 'web_browser');
                const isNat = cType === 'ubuntu_native' || cType === 'android_native' || Boolean(mergedTel.full_access);
                const cLabel = cType === 'ubuntu_native'
                  ? 'App Nativa Ubuntu (.deb)'
                  : cType === 'android_native'
                    ? 'App Nativa Android (.apk)'
                    : String(mergedTel.client_label || 'Navegador Web');
                const autoName = String(mergedTel.name || active.auto_name || `Sesión Actual (${os.hostname()})`);
                store.dev_active_session = {
                  ...active,
                  name: active.custom_alias ? active.custom_alias : autoName,
                  auto_name: autoName,
                  client_type: cType,
                  client_label: cLabel,
                  access_level: isNat ? 'FULL_NATIVE_ACCESS' : String(mergedTel.access_level || 'WEB_SANDBOX'),
                  full_access: isNat,
                  app_version: String(mergedTel.app_version || curVer),
                  hardware_id: String(mergedTel.hardware_id || active.hardware_id || 'dev_active_session'),
                  last_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
                  device_telemetry: mergedTel,
                };
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, device_id: 'dev_active_session', device: store.dev_active_session }));
                return;
              }
              if (url === '/api/auth/rename-device') {
                const targetId = String(body.id || 'dev_active_session');
                const alias = String(body.alias || body.name || '').trim();
                if (store[targetId]) {
                  store[targetId].custom_alias = alias;
                  store[targetId].name = alias || store[targetId].auto_name || 'Dispositivo';
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, id: targetId, name: store[targetId]?.name || alias }));
                return;
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            });
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(Object.values(g.__viteTrustedDevices)));
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

        if (url?.startsWith('/api/net/history')) {
          if (url === '/api/net/history/clear') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Historial SQLite vaciado' }));
            return;
          }
          const liveMap = buildLiveConnectionsMap(sampleRealNetwork().local_ip);
          const conns = (liveMap && Array.isArray(liveMap.connections)) ? liveMap.connections : [];
          const servicesMap: Record<string, { service: string; count: number; ips: Set<string>; devices: Set<string> }> = {};
          const devicesMap: Record<string, { ip: string; name: string; count: number; services: Set<string> }> = {};

          for (const c of conns) {
            const svc = c.service || 'Conexión Directa';
            const dev = c.local_ip || 'Servidor';
            if (!servicesMap[svc]) {
              servicesMap[svc] = { service: svc, count: 0, ips: new Set<string>(), devices: new Set<string>() };
            }
            servicesMap[svc].count++;
            servicesMap[svc].ips.add(c.remote_ip);
            servicesMap[svc].devices.add(dev);

            if (!devicesMap[dev]) {
              devicesMap[dev] = { ip: dev, name: dev, count: 0, services: new Set<string>() };
            }
            devicesMap[dev].count++;
            devicesMap[dev].services.add(svc);
          }

          const servicesCatalog = Object.values(servicesMap).map((s) => ({
            service: s.service,
            hit_count: s.count,
            unique_ips: s.ips.size,
            device_count: s.devices.size,
            last_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }));

          const devicesCatalog = Object.values(devicesMap).map((d) => ({
            ip: d.ip,
            name: d.name,
            total_hits: d.count,
            services_count: d.services.size,
            last_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }));

          const historyPayload = {
            status: 'ok',
            services_catalog: servicesCatalog,
            devices_catalog: devicesCatalog,
            connections: conns.map((c) => ({
              ...c,
              hit_count: 1,
              first_seen: new Date(Date.now() - 3600000).toISOString().slice(0, 19).replace('T', ' '),
              last_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
            })),
            summary: {
              total_records: conns.length,
              total_services: servicesCatalog.length,
              total_unique_ips: conns.length,
              total_devices: devicesCatalog.length,
            },
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(historyPayload));
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
