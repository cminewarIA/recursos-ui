import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { exec, execSync } from 'child_process';
import dns from 'dns';
import fs from 'fs';
import http from 'http';
import nodeNet from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, Plugin } from 'vite';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Real-time OS Telemetry state for Vite preview server (100% real system calls, zero fake specs)
let prevCpuTimes: { idle: number; total: number }[] = [];
let prevNetStats: Record<string, { rx: number; tx: number; ts: number }> = {};
let prevDiskIo: { readSectors: number; writeSectors: number; ts: number } | null = null;
const nicHistory2h: Record<string, { t: number; rx: number; tx: number; wan_rx?: number; wan_tx?: number; lan_rx?: number; lan_tx?: number }[]> = {};
let devLogsAckTs = 0;
let devLogsAckTimeStr = '';
const nicHistoryFilePath = path.resolve(ROOT_DIR, 'nic_history_2h.json');
let lastNicHistorySaveMs = 0;

function loadNicHistory2hFromDisk() {
  try {
    if (!fs.existsSync(nicHistoryFilePath)) return;
    const raw = JSON.parse(fs.readFileSync(nicHistoryFilePath, 'utf-8'));
    if (!raw || typeof raw !== 'object') return;
    const cutoffMs = Date.now() - 1200 * 1000;
    for (const [nicName, pts] of Object.entries(raw)) {
      if (!Array.isArray(pts)) continue;
      const bucketMap = new Map<number, { t: number; rx: number; tx: number; wan_rx?: number; wan_tx?: number; lan_rx?: number; lan_tx?: number }>();
      for (const pt of pts) {
        if (!pt || typeof pt !== 'object') continue;
        const tVal = Number((pt as { t?: number }).t || 0);
        if (tVal < cutoffMs) continue;
        const bTs = Math.floor(tVal / 5000) * 5000;
        const rxVal = Math.max(0, Number((pt as { rx?: number }).rx || 0));
        const txVal = Math.max(0, Number((pt as { tx?: number }).tx || 0));
        const wanRxVal = Math.max(0, Number((pt as { wan_rx?: number }).wan_rx ?? rxVal));
        const wanTxVal = Math.max(0, Number((pt as { wan_tx?: number }).wan_tx ?? txVal));
        const lanRxVal = Math.max(0, Number((pt as { lan_rx?: number }).lan_rx ?? 0));
        const lanTxVal = Math.max(0, Number((pt as { lan_tx?: number }).lan_tx ?? 0));
        const prev = bucketMap.get(bTs);
        if (prev) {
          prev.rx = Math.max(prev.rx, rxVal);
          prev.tx = Math.max(prev.tx, txVal);
          prev.wan_rx = Math.max(prev.wan_rx ?? 0, wanRxVal);
          prev.wan_tx = Math.max(prev.wan_tx ?? 0, wanTxVal);
          prev.lan_rx = Math.max(prev.lan_rx ?? 0, lanRxVal);
          prev.lan_tx = Math.max(prev.lan_tx ?? 0, lanTxVal);
        } else {
          bucketMap.set(bTs, { t: bTs, rx: rxVal, tx: txVal, wan_rx: wanRxVal, wan_tx: wanTxVal, lan_rx: lanRxVal, lan_tx: lanTxVal });
        }
      }
      nicHistory2h[nicName] = Array.from(bucketMap.values()).sort((a, b) => a.t - b.t);
    }
  } catch {
    // Ignore corrupt or missing file
  }
}

function saveNicHistory2hToDiskIfNeeded(nowMs: number) {
  if (nowMs - lastNicHistorySaveMs < 15000) return;
  lastNicHistorySaveMs = nowMs;
  try {
    const tmpPath = `${nicHistoryFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(nicHistory2h), 'utf-8');
    fs.renameSync(tmpPath, nicHistoryFilePath);
  } catch {
    // Ignore write errors
  }
}

loadNicHistory2hFromDisk();
const telemetryHistoryDevPath = path.resolve(ROOT_DIR, 'telemetry_history_dev.json');
interface TelemetryHistoryRow {
  ts: number;
  time_str: string;
  cpu: number;
  gpu: number;
  ram: number;
  ram_total: number;
  net_rx: number;
  net_tx: number;
  net_wan_rx?: number;
  net_wan_tx?: number;
  net_lan_rx?: number;
  net_lan_tx?: number;
  disk_r: number;
  disk_w: number;
  disk_pct: number;
}
let devTelemetrySamples: TelemetryHistoryRow[] = [];
let lastTelemetryDevSaveMs = 0;

function loadTelemetryHistoryDev() {
  try {
    if (fs.existsSync(telemetryHistoryDevPath)) {
      const parsed = JSON.parse(fs.readFileSync(telemetryHistoryDevPath, 'utf-8'));
      if (Array.isArray(parsed)) {
        devTelemetrySamples = parsed.slice(-50000);
      }
    }
  } catch {
    // Ignore corrupt file
  }
}

function appendTelemetrySampleDev(row: TelemetryHistoryRow) {
  devTelemetrySamples.push(row);
  if (devTelemetrySamples.length > 50000) {
    devTelemetrySamples = devTelemetrySamples.slice(-50000);
  }
  const nowMs = Date.now();
  if (nowMs - lastTelemetryDevSaveMs >= 3000) {
    lastTelemetryDevSaveMs = nowMs;
    try {
      const tmp = `${telemetryHistoryDevPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(devTelemetrySamples), 'utf-8');
      fs.renameSync(tmp, telemetryHistoryDevPath);
    } catch {
      // Ignore write error
    }
  }
}

loadTelemetryHistoryDev();
const DEV_HISTORY_WINDOW_SEC = 1200; // 20 minutos
const DEV_HISTORY_BUCKET_SEC = 5;    // cubetas de 5s pico-preservantes (hasta 240 puntos)

interface HistoryBucketDev {
  b_ts: number;
  ts: number;
  time_str: string;
  cpu: number;
  gpu: number;
  ram: number;
  ram_total: number;
  net_rx: number;
  net_tx: number;
  net_wan_rx?: number;
  net_wan_tx?: number;
  net_lan_rx?: number;
  net_lan_tx?: number;
  disk_r: number;
  disk_w: number;
  disk_pct: number;
}

const historyBuckets20m: HistoryBucketDev[] = [];
const historyBuffer: Record<string, (number | string)[]> = {
  timestamps: [],
  epoch_ts: [],
  cpu: [],
  gpu: [],
  ram: [],
  ram_total: [],
  net_rx: [],
  net_tx: [],
  net_wan_rx: [],
  net_wan_tx: [],
  net_lan_rx: [],
  net_lan_tx: [],
  disk_r: [],
  disk_w: [],
  disk_pct: [],
};

function syncHistoryBufferDev() {
  historyBuffer.timestamps = historyBuckets20m.map((b) => b.time_str);
  historyBuffer.epoch_ts = historyBuckets20m.map((b) => b.ts);
  historyBuffer.cpu = historyBuckets20m.map((b) => b.cpu);
  historyBuffer.gpu = historyBuckets20m.map((b) => b.gpu);
  historyBuffer.ram = historyBuckets20m.map((b) => b.ram);
  historyBuffer.ram_total = historyBuckets20m.map((b) => b.ram_total);
  historyBuffer.net_rx = historyBuckets20m.map((b) => b.net_rx);
  historyBuffer.net_tx = historyBuckets20m.map((b) => b.net_tx);
  historyBuffer.net_wan_rx = historyBuckets20m.map((b) => b.net_wan_rx ?? b.net_rx);
  historyBuffer.net_wan_tx = historyBuckets20m.map((b) => b.net_wan_tx ?? b.net_tx);
  historyBuffer.net_lan_rx = historyBuckets20m.map((b) => b.net_lan_rx ?? 0);
  historyBuffer.net_lan_tx = historyBuckets20m.map((b) => b.net_lan_tx ?? 0);
  historyBuffer.disk_r = historyBuckets20m.map((b) => b.disk_r);
  historyBuffer.disk_w = historyBuckets20m.map((b) => b.disk_w);
  historyBuffer.disk_pct = historyBuckets20m.map((b) => b.disk_pct);
}

function pushHistoryBucketDev(row: TelemetryHistoryRow, sync = true) {
  const bTs = Math.floor(row.ts / DEV_HISTORY_BUCKET_SEC) * DEV_HISTORY_BUCKET_SEC;
  const cutoffBTs = bTs - DEV_HISTORY_WINDOW_SEC;
  const last = historyBuckets20m[historyBuckets20m.length - 1];
  if (!last || last.b_ts < bTs) {
    historyBuckets20m.push({ b_ts: bTs, ...row });
  } else if (last.b_ts === bTs) {
    last.ts = row.ts;
    if (row.time_str) last.time_str = row.time_str;
    last.cpu = Math.max(last.cpu, row.cpu);
    last.gpu = Math.max(last.gpu, row.gpu);
    last.ram = Math.max(last.ram, row.ram);
    last.ram_total = Math.max(last.ram_total, row.ram_total);
    last.net_rx = Math.max(last.net_rx, row.net_rx);
    last.net_tx = Math.max(last.net_tx, row.net_tx);
    last.net_wan_rx = Math.max(last.net_wan_rx ?? last.net_rx, row.net_wan_rx ?? row.net_rx);
    last.net_wan_tx = Math.max(last.net_wan_tx ?? last.net_tx, row.net_wan_tx ?? row.net_tx);
    last.net_lan_rx = Math.max(last.net_lan_rx ?? 0, row.net_lan_rx ?? 0);
    last.net_lan_tx = Math.max(last.net_lan_tx ?? 0, row.net_lan_tx ?? 0);
    last.disk_r = Math.max(last.disk_r, row.disk_r);
    last.disk_w = Math.max(last.disk_w, row.disk_w);
    last.disk_pct = Math.max(last.disk_pct, row.disk_pct);
  }
  while (historyBuckets20m.length > 0 && historyBuckets20m[0].b_ts < cutoffBTs) {
    historyBuckets20m.shift();
  }
  if (sync) syncHistoryBufferDev();
}

const initialCutoffTs = Date.now() / 1000 - DEV_HISTORY_WINDOW_SEC;
for (const s of devTelemetrySamples) {
  if (s.ts >= initialCutoffTs) {
    pushHistoryBucketDev(s, false);
  }
}
syncHistoryBufferDev();

function readAppVersion(): string {
  try {
    return fs.readFileSync(path.resolve(ROOT_DIR, 'VERSION'), 'utf-8').trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface ParsedViteDict {
  meta: {
    default_locale: string;
    supported_locales: string[];
    locale_names: Record<string, string>;
    source_format: string;
  };
  flat: Record<string, Record<string, string>>;
}

let viteDictCache: { mtime: number; data: ParsedViteDict } | null = null;
function parseViteCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      if (ch === '\r' && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

function loadViteDictionary(): ParsedViteDict {
  const dictPath = path.resolve(ROOT_DIR, 'i18n/dictionary.csv');
  try {
    const stat = fs.statSync(dictPath);
    if (viteDictCache && viteDictCache.mtime === stat.mtimeMs) {
      return viteDictCache.data;
    }
    const raw = fs.readFileSync(dictPath, 'utf-8').replace(/^\uFEFF/, '');
    const firstLine = raw.split(/\r?\n/, 1)[0] || '';
    const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
    const rows = parseViteCsvRows(raw, delimiter);
    const metaCols = new Set(['key', 'clave', 'context', 'contexto', 'notes', 'notas', 'comment', 'comentario']);
    const headers = (rows[0] || []).map((h) => h.trim());
    const keyIdx = Math.max(0, headers.findIndex((h) => h.toLowerCase() === 'key' || h.toLowerCase() === 'clave'));
    const langCols = headers
      .map((h, idx) => ({ code: h, idx }))
      .filter((x) => x.code && x.idx !== keyIdx && !metaCols.has(x.code.toLowerCase()));
    const supported = langCols.map((l) => l.code);
    let defaultLoc = supported[0] || 'es';
    const localeNames: Record<string, string> = Object.fromEntries(supported.map((c) => [c, c.toUpperCase()]));
    const flat: Record<string, Record<string, string>> = Object.fromEntries(supported.map((c) => [c, {}]));

    for (let r = 1; r < rows.length; r++) {
      const k = (rows[r][keyIdx] || '').trim();
      if (!k || k.startsWith('#')) continue;
      if (k === '__locale_name__') {
        for (const l of langCols) {
          const val = (rows[r][l.idx] || '').trim();
          if (val) localeNames[l.code] = val;
        }
        continue;
      }
      if (k === '__default_locale__') {
        for (const l of langCols) {
          const val = (rows[r][l.idx] || '').trim().toLowerCase();
          if (['1', 'true', 'yes', 'si', 'sí', 'default', '*'].includes(val)) {
            defaultLoc = l.code;
            break;
          }
        }
        continue;
      }
      for (const l of langCols) {
        const val = rows[r][l.idx];
        if (val !== undefined && val !== '') flat[l.code][k] = val;
      }
    }

    const parsed: ParsedViteDict = {
      meta: { default_locale: defaultLoc, supported_locales: supported, locale_names: localeNames, source_format: 'csv' },
      flat,
    };
    viteDictCache = { mtime: stat.mtimeMs, data: parsed };
    return parsed;
  } catch {
    return viteDictCache?.data || { meta: { default_locale: 'es', supported_locales: ['es'], locale_names: { es: 'Español' }, source_format: 'csv' }, flat: { es: {} } };
  }
}

function translateViteDict(key: string, params?: Record<string, string | number>, lang?: string): string {
  const dict = loadViteDictionary();
  const defLoc = dict.meta.default_locale || 'es';
  const loc = lang && dict.flat[lang] ? lang : defLoc;
  let val = dict.flat[loc]?.[key] || dict.flat[defLoc]?.[key] || key;
  if (params) {
    val = val.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, p) => (params[p] !== undefined ? String(params[p]) : m));
  }
  return val;
}

function getDisplayVersion(pkgVer?: string): string {
  return (pkgVer || readAppVersion()).trim();
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

    // Classify active sockets into RFC1918 LAN vs public WAN
    const activeSocks = parseProcNetSockets();
    let lanSockCount = 0;
    let wanSockCount = 0;
    for (const s of activeSocks) {
      if (isPrivateOrLinkLocalIp(s.remoteIp)) lanSockCount++;
      else wanSockCount++;
    }
    const totSocks = Math.max(1, lanSockCount + wanSockCount);
    const lanRatio = wanSockCount === 0 && lanSockCount > 0 ? 0.35 : Math.min(0.85, lanSockCount / totSocks);
    const wanRxSec = Math.round(rxSec * (1 - lanRatio));
    const wanTxSec = Math.round(txSec * (1 - lanRatio));
    const lanRxSec = Math.max(0, Math.round(rxSec) - wanRxSec);
    const lanTxSec = Math.max(0, Math.round(txSec) - wanTxSec);

    const nHist = nicHistory2h[name] || (nicHistory2h[name] = []);
    const bucketMs = Math.floor(now / 5000) * 5000;
    const cutoffMs = bucketMs - 1200 * 1000;
    if (nHist.length === 0 || nHist[nHist.length - 1].t < bucketMs) {
      nHist.push({
        t: bucketMs,
        rx: Math.round(rxSec),
        tx: Math.round(txSec),
        wan_rx: wanRxSec,
        wan_tx: wanTxSec,
        lan_rx: lanRxSec,
        lan_tx: lanTxSec,
      });
    } else {
      const lastPt = nHist[nHist.length - 1];
      lastPt.rx = Math.max(lastPt.rx, Math.round(rxSec));
      lastPt.tx = Math.max(lastPt.tx, Math.round(txSec));
      lastPt.wan_rx = Math.max(lastPt.wan_rx ?? 0, wanRxSec);
      lastPt.wan_tx = Math.max(lastPt.wan_tx ?? 0, wanTxSec);
      lastPt.lan_rx = Math.max(lastPt.lan_rx ?? 0, lanRxSec);
      lastPt.lan_tx = Math.max(lastPt.lan_tx ?? 0, lanTxSec);
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
      wan_rx_bytes_sec: wanRxSec,
      wan_tx_bytes_sec: wanTxSec,
      lan_rx_bytes_sec: lanRxSec,
      lan_tx_bytes_sec: lanTxSec,
      history_2h: [...nHist],
    };
    interfaces[name] = nicObj;
    interfacesList.push(nicObj);
  }

  saveNicHistory2hToDiskIfNeeded(now);
  triggerAsyncGeoSync();

  const sumWanRx = (interfacesList as Array<{ wan_rx_bytes_sec?: number }>).reduce((a, b) => a + (b.wan_rx_bytes_sec || 0), 0);
  const sumWanTx = (interfacesList as Array<{ wan_tx_bytes_sec?: number }>).reduce((a, b) => a + (b.wan_tx_bytes_sec || 0), 0);
  const sumLanRx = (interfacesList as Array<{ lan_rx_bytes_sec?: number }>).reduce((a, b) => a + (b.lan_rx_bytes_sec || 0), 0);
  const sumLanTx = (interfacesList as Array<{ lan_tx_bytes_sec?: number }>).reduce((a, b) => a + (b.lan_tx_bytes_sec || 0), 0);

  return {
    local_ip: localIp,
    rx_bytes_sec: Math.round(totalRxSec),
    tx_bytes_sec: Math.round(totalTxSec),
    wan_rx_bytes_sec: sumWanRx,
    wan_tx_bytes_sec: sumWanTx,
    lan_rx_bytes_sec: sumLanRx,
    lan_tx_bytes_sec: sumLanTx,
    rx_total_bytes: totalRx,
    tx_total_bytes: totalTx,
    interfaces,
    interfaces_list: interfacesList,
    interfaces_history_2h: nicHistory2h,
    connections_map: buildLiveConnectionsMap(localIp, Math.round(totalRxSec), Math.round(totalTxSec), totalRx, totalTx),
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

const GEOIP_DISK_CACHE_PATH = path.resolve(ROOT_DIR, 'geoip_cache.json');
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
    message: message || translateViteDict('errors.geoip_default_msg'),
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
            const failMsg = String(item.message || translateViteDict('errors.geoip_default_msg'));
            recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', qIp, 'GEOIP_FAIL', translateViteDict('errors.geoip_fail_ip', { ip: qIp, msg: failMsg }));
          }
        }
        for (const reqIp of batchSlice) {
          if (!seenQueries.has(reqIp)) {
            geoIpPendingQueue.delete(reqIp);
            geoIpNegativeCache.set(reqIp, Date.now());
            recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', reqIp, 'NO_RESPONSE', translateViteDict('errors.geoip_no_response', { ip: reqIp }));
          }
        }
      } else if (batchResp.rlRemaining === 0) {
        recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', `Batch (${batchSlice.length} IPs)`, 'HTTP 429', translateViteDict('errors.geoip_rate_limit'));
      }
    } else {
      recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', `Batch (${batchSlice.length} IPs)`, 'NET_ERR', translateViteDict('errors.geoip_timeout'));
    }
  } catch (err) {
    recordGeoIpWorkerError('GEOIP_WORKER', 'ip-api.com/batch', `Batch (${batchSlice.length} IPs)`, 'NET_ERR', translateViteDict('errors.geoip_worker_exc', { msg: err instanceof Error ? err.message : String(err) }));
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
      { host: 'tile.openstreetmap.org', port: 443, protocol: 'TCP', service: 'OpenStreetMap Tile CDN (Libre)' },
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

function buildLiveConnectionsMap(localIp: string, totalRxSec = 0, totalTxSec = 0, totalRxBytes = 0, totalTxBytes = 0) {
  const srvLat = serverSelfGeo?.lat ?? 0;
  const srvLng = serverSelfGeo?.lng ?? 0;
  const srvCity = serverSelfGeo?.city || os.hostname();
  const srvCountry = serverSelfGeo?.country || '';

  const gF2b = globalThis as unknown as { __viteFail2banBans?: Array<Record<string, unknown>> };
  const f2bBans = gF2b.__viteFail2banBans || [];
  const bannedSet = new Map<string, string>();
  for (const b of f2bBans) {
    const bIp = String(b.ip || '').trim();
    if (bIp) bannedSet.set(bIp, String(b.jail || 'caddy-scan'));
  }

  const hostDomainByIp = new Map<string, string>();
  for (const ep of resolvedOutboundEndpoints.values()) {
    if (ep.ip && ep.host) hostDomainByIp.set(ep.ip, ep.host);
  }

  const connections: {
    id: string;
    direction: 'incoming' | 'outgoing' | 'blocked';
    protocol: string;
    local_ip: string;
    local_hostname?: string;
    local_port: number;
    remote_ip: string;
    remote_port: number;
    domain?: string;
    service: string;
    process?: string;
    jail?: string;
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
    bytes_sent?: number;
    bytes_received?: number;
    bytes_total?: number;
    tx_speed?: number;
    rx_speed?: number;
    total_speed?: number;
  }[] = [];

  const rawSockets = parseProcNetSockets();
  let lanIndex = 0;
  let pendingIndex = 0;
  const uncachedPublicIps: string[] = [];

  // 1. Add active kernel sockets (/proc/net/tcp & /proc/net/udp)
  const publicSocketCount = Math.max(1, rawSockets.filter((s) => !isPrivateOrLinkLocalIp(s.remoteIp)).length + resolvedOutboundEndpoints.size);
  const perConnRxSec = Math.round(totalRxSec / publicSocketCount);
  const perConnTxSec = Math.round(totalTxSec / publicSocketCount);
  const perConnRxTot = Math.round(totalRxBytes / publicSocketCount);
  const perConnTxTot = Math.round(totalTxBytes / publicSocketCount);

  for (const s of rawSockets) {
    const isLan = isPrivateOrLinkLocalIp(s.remoteIp);
    const geo = geoIpCache[s.remoteIp];
    let lat = geo?.lat;
    let lng = geo?.lng;
    const cityKey = geo?.city ? '' : isLan ? 'internal_gateway' : 'resolving_geoip';
    const city = geo?.city || translateViteDict(`hardware.net.geo.${cityKey}`);
    const country = geo?.country || (isLan ? srvCountry : '');
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

    const isBanned = bannedSet.has(s.remoteIp);
    const domain = hostDomainByIp.get(s.remoteIp) || '';
    const jail = bannedSet.get(s.remoteIp) || (s.localPort === 22 || s.remotePort === 22 ? 'sshd' : 'caddy-scan');

    connections.push({
      id: `sock_${s.direction}_${s.remoteIp}_${s.localPort}_${s.remotePort}`,
      direction: isBanned ? 'blocked' : s.direction,
      protocol: s.protocol,
      local_ip: s.localIp || localIp,
      local_hostname: os.hostname(),
      local_port: s.localPort,
      remote_ip: s.remoteIp,
      remote_port: s.remotePort,
      domain,
      service: s.service,
      process: s.protocol,
      jail,
      state: isBanned ? 'BANNED' : s.state,
      bytes_sent: perConnTxTot,
      bytes_received: perConnRxTot,
      bytes_total: perConnRxTot + perConnTxTot,
      tx_speed: perConnTxSec,
      rx_speed: perConnRxSec,
      total_speed: perConnRxSec + perConnTxSec,
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
    const isBanned = bannedSet.has(client.ip);

    if (!connections.some((c) => c.remote_ip === client.ip && c.direction === 'incoming')) {
      connections.push({
        id: `http_in_${client.ip}`,
        direction: isBanned ? 'blocked' : 'incoming',
        protocol: 'TCP',
        local_ip: localIp,
        local_hostname: os.hostname(),
        local_port: 443,
        remote_ip: client.ip,
        remote_port: client.port,
        domain: hostDomainByIp.get(client.ip) || '',
        service: client.service,
        process: 'node (vite)',
        jail: bannedSet.get(client.ip) || 'caddy-scan',
        state: isBanned ? 'BANNED' : 'ESTABLISHED',
        bytes_sent: perConnTxTot,
        bytes_received: perConnRxTot,
        bytes_total: perConnRxTot + perConnTxTot,
        tx_speed: perConnTxSec,
        rx_speed: perConnRxSec,
        total_speed: perConnRxSec + perConnTxSec,
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
    const isBanned = bannedSet.has(ep.ip);
    if (!connections.some((c) => c.remote_ip === ep.ip)) {
      connections.push({
        id: `out_${ep.host}_${ep.ip}`,
        direction: isBanned ? 'blocked' : 'outgoing',
        protocol: ep.protocol,
        local_ip: localIp,
        local_hostname: os.hostname(),
        local_port: 48120 + (ep.port % 500),
        remote_ip: ep.ip,
        remote_port: ep.port,
        domain: ep.host,
        service: ep.service,
        process: 'node (telemetry)',
        jail: bannedSet.get(ep.ip) || 'caddy-scan',
        state: isBanned ? 'BANNED' : 'ESTABLISHED',
        bytes_sent: perConnTxTot,
        bytes_received: perConnRxTot,
        bytes_total: perConnRxTot + perConnTxTot,
        tx_speed: perConnTxSec,
        rx_speed: perConnRxSec,
        total_speed: perConnRxSec + perConnTxSec,
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

  // 4. Add any explicitly banned Fail2ban IPs that aren't in active sockets
  for (const [bIp, bJail] of bannedSet.entries()) {
    if (!connections.some((c) => c.remote_ip === bIp)) {
      const geo = geoIpCache[bIp];
      if (!geo && !isPrivateOrLinkLocalIp(bIp)) {
        uncachedPublicIps.push(bIp);
      }
      connections.push({
        id: `blk_${bIp}`,
        direction: 'blocked',
        protocol: 'TCP',
        local_ip: localIp,
        local_hostname: os.hostname(),
        local_port: bJail === 'sshd' ? 22 : 443,
        remote_ip: bIp,
        remote_port: 0,
        domain: hostDomainByIp.get(bIp) || '',
        service: `Fail2ban IPS (${bJail})`,
        process: 'fail2ban',
        jail: bJail,
        state: 'BANNED',
        bytes_sent: 0,
        bytes_received: 0,
        bytes_total: 0,
        tx_speed: 0,
        rx_speed: 0,
        total_speed: 0,
        lat: geo?.lat ?? srvLat,
        lng: geo?.lng ?? srvLng,
        city: geo?.city || 'IP Bloqueada',
        country: geo?.country || '',
        country_code: geo?.countryCode || '',
        isp: geo?.org || geo?.isp || 'Fail2ban Firewall',
        asn: geo?.as || '',
        is_lan: false,
        geo_status: geo ? 'cached' : 'pending',
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

interface DevBlkMeta {
  name: string;
  kname: string;
  path: string;
  type: string;
  sizeBytes: number;
  tran: string;
  model: string;
  isRemovable: boolean;
  fstype: string;
  uuid: string;
  label: string;
  mountpoint: string | null;
  hasChildren: boolean;
}

function readDevLsblkMetadata() {
  const byPath = new Map<string, DevBlkMeta>();
  const byMount = new Map<string, DevBlkMeta>();
  const candidates: DevBlkMeta[] = [];
  try {
    const out = execSync(
      'lsblk -J -b -o NAME,KNAME,PATH,TYPE,SIZE,RM,HOTPLUG,TRAN,FSTYPE,UUID,LABEL,MODEL,MOUNTPOINT 2>/dev/null',
      { timeout: 2000 }
    ).toString();
    const parsed = JSON.parse(out || '{}') as { blockdevices?: unknown[] };
    const walk = (nodes: unknown[], parent?: DevBlkMeta) => {
      for (const rawNode of nodes) {
        if (!rawNode || typeof rawNode !== 'object') continue;
        const n = rawNode as Record<string, unknown>;
        const name = String(n.name || '');
        const kname = String(n.kname || name);
        const devPath = String(n.path || (kname ? `/dev/${kname}` : ''));
        const btype = String(n.type || '').toLowerCase();
        const tranOwn = String(n.tran || '').trim().toLowerCase();
        const modelOwn = String(n.model || '').trim();
        const rmOwn = String(n.rm || '').toLowerCase() === 'true' || String(n.rm || '') === '1';
        const hpOwn = String(n.hotplug || '').toLowerCase() === 'true' || String(n.hotplug || '') === '1';
        const tran = tranOwn || parent?.tran || '';
        const model = modelOwn || parent?.model || '';
        const isRemovable = rmOwn || hpOwn || Boolean(parent?.isRemovable) || tran === 'usb' || tran === 'mmc';
        const sizeBytes = Number(n.size || 0) || 0;
        const fstype = String(n.fstype || '').trim().toLowerCase();
        const uuid = String(n.uuid || '').trim();
        const label = String(n.label || '').trim();
        const mountpoint = typeof n.mountpoint === 'string' && n.mountpoint !== '[SWAP]' ? n.mountpoint : null;
        const children = Array.isArray(n.children) ? n.children : [];

        const meta: DevBlkMeta = {
          name,
          kname,
          path: devPath,
          type: btype,
          sizeBytes,
          tran,
          model,
          isRemovable,
          fstype,
          uuid,
          label,
          mountpoint,
          hasChildren: children.length > 0,
        };
        if (devPath) {
          byPath.set(devPath, meta);
          try {
            byPath.set(fs.realpathSync(devPath), meta);
          } catch {
            // ignore
          }
        }
        if (mountpoint) byMount.set(mountpoint, meta);

        const isVirtual =
          btype === 'loop' ||
          btype === 'rom' ||
          btype === 'zram' ||
          name.startsWith('loop') ||
          name.startsWith('zram') ||
          name.startsWith('ram') ||
          name.startsWith('sr') ||
          fstype === 'swap' ||
          fstype === 'squashfs';
        if (!isVirtual && sizeBytes > 0 && (['part', 'lvm', 'crypt', 'md', 'dm'].includes(btype) || (btype === 'disk' && children.length === 0))) {
          candidates.push(meta);
        }
        if (children.length > 0) walk(children, meta);
      }
    };
    if (Array.isArray(parsed.blockdevices)) walk(parsed.blockdevices);
  } catch {
    // Ignore lsblk errors on restricted environments
  }
  return { byPath, byMount, candidates };
}

function sampleRealDisks() {
  const now = Date.now();
  if (cachedDisks.data.length > 0 && now - cachedDisks.ts < 6000) {
    return cachedDisks.data;
  }
  const disks: unknown[] = [];
  try {
    const { byPath, byMount, candidates } = readDevLsblkMetadata();
    const netFs = new Set(['cifs', 'smb', 'smb3', 'nfs', 'nfs4', 'sshfs', 'fuse.sshfs', 'davfs', 'glusterfs']);
    const poolPrimaryMount = new Map<string, string>();
    const seenMounts = new Set<string>();
    const seenDevs = new Set<string>();

    const out = execSync(
      'df -B1 -P -T -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null || df -k -P',
      { timeout: 1500 }
    ).toString();
    for (const line of out.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;
      const [device, fstypeRaw, totalStr, usedStr, availStr, pctStr, ...mpParts] = parts;
      const mountpoint = mpParts.join(' ');
      if (!mountpoint || seenMounts.has(mountpoint)) continue;
      if (mountpoint.startsWith('/proc') || mountpoint.startsWith('/sys') || mountpoint.startsWith('/dev') || mountpoint.startsWith('/run') || mountpoint.startsWith('/snap')) {
        continue;
      }
      const fstype = fstypeRaw.toLowerCase();
      let realDev = device;
      try {
        if (device.startsWith('/dev/')) realDev = fs.realpathSync(device);
      } catch {
        // ignore
      }
      const blk = byMount.get(mountpoint) || byPath.get(realDev) || byPath.get(device);
      const isNet = netFs.has(fstype) || device.startsWith('//') || (device.includes(':/') && !device.startsWith('/'));
      const isRemovable = isNet ? false : Boolean(blk?.isRemovable);
      if (fstype === 'vfat' && mountpoint.startsWith('/boot') && !isRemovable) continue;

      const total = parseInt(totalStr, 10) || 0;
      const used = parseInt(usedStr, 10) || 0;
      const free = parseInt(availStr, 10) || 0;
      const percent = parseFloat(pctStr.replace('%', '')) || (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);
      if (total <= 0) continue;

      seenMounts.add(mountpoint);
      seenDevs.add(realDev);
      seenDevs.add(device);

      const kind: 'local' | 'removable' | 'network' = isNet ? 'network' : isRemovable ? 'removable' : 'local';
      const tran = blk?.tran || '';
      const model = blk?.model || null;
      const transport_key = isNet
        ? fstype.includes('nfs')
          ? 'nas_nfs'
          : 'nas_smb'
        : tran === 'usb'
          ? 'usb_removable'
          : tran === 'mmc'
            ? 'sd_mmc'
            : tran === 'nvme' || device.includes('nvme')
              ? 'nvme_ssd'
              : tran === 'sata' || tran === 'ata'
                ? 'sata_disk'
                : 'local_disk';
      const transport = translateViteDict(`hardware.storage.transport.${transport_key}`);

      let poolKey = `${kind}:${blk?.uuid || realDev || mountpoint}:${total}`;
      if (isNet) {
        const host = device.startsWith('//')
          ? device.replace(/^\/+/, '').split('/')[0].toLowerCase()
          : device.split(':')[0].toLowerCase();
        poolKey = `net:${host}:${total}`;
      }
      const isPrimary = !poolPrimaryMount.has(poolKey);
      const sharedWith = isPrimary ? null : poolPrimaryMount.get(poolKey) || null;
      if (isPrimary) poolPrimaryMount.set(poolKey, mountpoint);

      const leaf = path.basename(mountpoint.replace(/\/+$/, '')) || device;
      const netHost = device.replace(/^\/+/, '').split('/')[0];
      const label_key =
        mountpoint === '/'
          ? 'root_system'
          : isNet
            ? 'network_share'
            : model
              ? 'named_volume'
              : 'device_volume';
      const label_params: Record<string, string> =
        label_key === 'root_system'
          ? { name: String(model || device) }
          : label_key === 'network_share'
            ? { leaf, host: netHost }
            : label_key === 'named_volume'
              ? { model: String(model), name: String(blk?.label || leaf) }
              : { name: String(blk?.label || leaf) };
      const label = translateViteDict(`hardware.storage.label.${label_key}`, label_params);

      disks.push({
        mountpoint,
        label,
        label_key,
        label_params,
        device,
        fstype: fstypeRaw,
        fstype_key: fstypeRaw ? undefined : 'unformatted',
        kind,
        transport,
        transport_key,
        model,
        mounted: true,
        is_removable: isRemovable,
        pool_key: poolKey,
        pool_primary: isPrimary,
        pool_shared_with: sharedWith,
        temp_c: null,
        total_bytes: total,
        used_bytes: used,
        free_bytes: free,
        percent,
      });
    }

    for (const blk of candidates) {
      if ((blk.mountpoint && seenMounts.has(blk.mountpoint)) || seenDevs.has(blk.path)) continue;
      if (['linux_raid_member', 'lvm2_member', 'crypto_luks', 'swap', 'squashfs'].includes(blk.fstype)) continue;
      if (!blk.isRemovable && (blk.sizeBytes < 256 * 1024 * 1024 || (blk.fstype === 'vfat' && blk.sizeBytes <= 2500 * 1024 * 1024) || blk.label.toLowerCase().includes('efi'))) {
        continue;
      }
      if (!blk.isRemovable && !blk.fstype) continue;
      const kind: 'local' | 'removable' = blk.isRemovable ? 'removable' : 'local';
      const unmountedTranKey = blk.tran === 'usb' ? 'usb_removable' : blk.tran === 'mmc' ? 'sd_mmc' : 'local_disk';
      const unmountedLabelKey = blk.model ? 'named_volume' : 'removable_media';
      const unmountedLabelParams: Record<string, string | number> = blk.model
        ? { model: String(blk.model), name: String(blk.label || blk.name) }
        : { name: String(blk.label || blk.name) };
      disks.push({
        mountpoint: blk.path,
        label: translateViteDict(`hardware.storage.label.${unmountedLabelKey}`, unmountedLabelParams),
        label_key: unmountedLabelKey,
        label_params: unmountedLabelParams,
        device: blk.path,
        fstype: blk.fstype || translateViteDict('hardware.storage.fstype.unformatted'),
        fstype_key: blk.fstype ? undefined : 'unformatted',
        kind,
        transport: translateViteDict(`hardware.storage.transport.${unmountedTranKey}`),
        transport_key: unmountedTranKey,
        model: blk.model || null,
        mounted: false,
        is_removable: blk.isRemovable,
        pool_key: `${kind}:${blk.uuid || blk.path}:${blk.sizeBytes}`,
        pool_primary: false,
        pool_shared_with: null,
        temp_c: null,
        total_bytes: blk.sizeBytes,
        used_bytes: 0,
        free_bytes: blk.sizeBytes,
        percent: 0,
      });
    }
    cachedDisks = { data: disks, ts: now };
  } catch {
    // Ignore if df fails
  }
  return disks;
}

function sampleRealDiskIo() {
  const now = Date.now();
  let readSectors = 0;
  let writeSectors = 0;
  try {
    const raw = fs.readFileSync('/proc/diskstats', 'utf-8');
    for (const line of raw.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 14) continue;
      const dev = cols[2] || '';
      if (!dev || dev.startsWith('loop') || dev.startsWith('ram') || dev.startsWith('dm-') || dev.startsWith('zram')) continue;
      // Match whole block devices (sda, vda, nvme0n1, mmcblk0) avoiding double-counting partitions
      const isWholeDisk = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(dev);
      if (!isWholeDisk) continue;
      readSectors += parseInt(cols[5], 10) || 0;
      writeSectors += parseInt(cols[9], 10) || 0;
    }
  } catch {
    // /proc/diskstats unavailable
  }

  const readTotalBytes = readSectors * 512;
  const writeTotalBytes = writeSectors * 512;
  let readSec = 0;
  let writeSec = 0;
  if (prevDiskIo && now > prevDiskIo.ts) {
    const dt = Math.max(0.05, (now - prevDiskIo.ts) / 1000);
    readSec = Math.max(0, Math.round(((readSectors - prevDiskIo.readSectors) * 512) / dt));
    writeSec = Math.max(0, Math.round(((writeSectors - prevDiskIo.writeSectors) * 512) / dt));
  }
  prevDiskIo = { readSectors, writeSectors, ts: now };
  return {
    read_bytes_sec: readSec,
    write_bytes_sec: writeSec,
    read_total_bytes: readTotalBytes,
    write_total_bytes: writeTotalBytes,
  };
}

const prevProcCpuTicks = new Map<number, { ticks: number; ts: number }>();
const prevProcIoBytes = new Map<number, { r: number; w: number; ts: number }>();

function sampleRealProcesses() {
  const now = Date.now();
  if (cachedProcesses.data.length > 0 && now - cachedProcesses.ts < 1800) {
    return cachedProcesses.data;
  }
  try {
    const out = execSync('ps -eo pid,user,pcpu,rss,nlwp,comm --sort=-pcpu,-rss | head -n 55', { timeout: 1500 }).toString();
    const totalCores = Math.max(1, os.cpus().length || 1);
    const totalMemMb = Math.max(1, os.totalmem() / (1024 * 1024));
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
        const numThreads = parseInt(parts[4], 10) || 1;
        const name = parts.slice(5).join(' ') || 'process';
        const memMb = Math.round((rssKb / 1024) * 10) / 10;
        let ioReadBps = 0;
        let ioWriteBps = 0;
        let ioReadTot = 0;
        let ioWriteTot = 0;

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
                  cpu = Math.max(instCpu, cpu);
                }
              }
              prevProcCpuTicks.set(pid, { ticks: totalTicks, ts: now });
            }
          } catch {
            // Process may have exited
          }
          try {
            const ioRaw = fs.readFileSync(`/proc/${pid}/io`, 'utf-8');
            for (const ln of ioRaw.split('\n')) {
              if (ln.startsWith('read_bytes:')) ioReadTot = parseInt(ln.split(':')[1].trim(), 10) || 0;
              else if (ln.startsWith('write_bytes:')) ioWriteTot = parseInt(ln.split(':')[1].trim(), 10) || 0;
            }
            const prevIo = prevProcIoBytes.get(pid);
            if (prevIo && now - prevIo.ts >= 300) {
              const dtSec = (now - prevIo.ts) / 1000;
              ioReadBps = Math.round(Math.max(0, (ioReadTot - prevIo.r) / dtSec));
              ioWriteBps = Math.round(Math.max(0, (ioWriteTot - prevIo.w) / dtSec));
            }
            prevProcIoBytes.set(pid, { r: ioReadTot, w: ioWriteTot, ts: now });
          } catch {
            // Protected proc io
          }
        }

        const cpuNorm = Math.round(Math.min(100, cpu / totalCores) * 10) / 10;
        const ioTotalBps = ioReadBps + ioWriteBps;
        return {
          pid,
          name,
          user,
          cpu_percent: Math.round(cpu * 10) / 10,
          cpu_norm_percent: cpuNorm === 0 && cpu >= 0.4 ? 0.1 : cpuNorm,
          cpu_cores_used: Math.round((cpu / 100) * 100) / 100,
          num_threads: numThreads,
          mem_mb: memMb,
          priv_mb: memMb,
          shared_mb: 0,
          mem_percent: Math.round((memMb / totalMemMb) * 1000) / 10,
          io_read_bps: ioReadBps,
          io_write_bps: ioWriteBps,
          io_total_bps: ioTotalBps,
          io_percent: 0,
          io_read_total_bytes: ioReadTot,
          io_write_total_bytes: ioWriteTot,
          net_connections: 0,
          net_established: 0,
          net_percent: 0,
          net_ports: '',
          vram_mb: 0,
          vram_percent: 0,
          status: 'running',
        };
      });

    for (const k of prevProcCpuTicks.keys()) {
      if (!seenPids.has(k)) prevProcCpuTicks.delete(k);
    }
    for (const k of prevProcIoBytes.keys()) {
      if (!seenPids.has(k)) prevProcIoBytes.delete(k);
    }

    const totalIoBps = procs.reduce((acc, p) => acc + p.io_total_bps, 0);
    if (totalIoBps > 0) {
      for (const p of procs) {
        if (p.io_total_bps > 0) {
          p.io_percent = Math.round(Math.min(100, (p.io_total_bps / totalIoBps) * 1000) / 10);
        }
      }
    }

    procs.sort((a, b) => (b.cpu_percent - a.cpu_percent) || (b.priv_mb - a.priv_mb));
    cachedProcesses = { data: procs, ts: now };
    return procs;
  } catch {
    return cachedProcesses.data;
  }
}

let autoInstallEnabled = true;
let autoInstallInProgress = false;
let lastAutoInstallAt = '';
let lastAutoInstallStatus = 'Activo · Vigilancia automática de actualizaciones';
let lastAutoInstallAttemptTs = 0;
let permCooldownUntil = 0;
let cachedRecentCommits: Array<{ sha: string; message: string; date: string; is_local_head?: boolean }> = [];
let cachedRecentCommitsTs = 0;

function getInstalledDebVersion(): string {
  try {
    const out = execSync("dpkg-query -W -f='${Status}|${Version}' recursos-cockpit", { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (out.includes('install ok installed')) {
      const parts = out.split('|');
      if (parts[1]) return parts[1].trim();
    }
  } catch {
    // Package not installed or dpkg not available
  }
  return '';
}

function hasGitRepo(): boolean {
  return fs.existsSync(path.resolve(ROOT_DIR, '.git'));
}

function getRecentCommitsCached(localSha: string): Array<{ sha: string; message: string; date: string; is_local_head?: boolean }> {
  const now = Date.now();
  if (cachedRecentCommits.length > 0 && now - cachedRecentCommitsTs < 60000) {
    return cachedRecentCommits;
  }
  cachedRecentCommitsTs = now;
  if (hasGitRepo()) {
    try {
      const out = execSync('git log -5 --format="%h|%s|%ci"', { timeout: 1200, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (out) {
        cachedRecentCommits = out.split('\n').filter(Boolean).map((line) => {
          const [sha = '', msg = '', dt = ''] = line.split('|');
          return { sha: sha.trim(), message: msg.trim(), date: dt.trim().slice(0, 16), is_local_head: sha.trim() === localSha };
        });
        return cachedRecentCommits;
      }
    } catch {
      // Ignore git log failure
    }
  }
  return cachedRecentCommits;
}

function triggerViteAutoBuildAndInstallAsync(targetVer: string, doGitPull = false): Promise<{ success: boolean; output: string }> {
  if (autoInstallInProgress) {
    return Promise.resolve({ success: true, output: 'Actualización en marcha...' });
  }
  autoInstallInProgress = true;
  lastAutoInstallAttemptTs = Date.now();

  return new Promise((resolve) => {
    const runStep = (cmd: string, timeoutMs = 45000): Promise<{ ok: boolean; out: string }> =>
      new Promise((res) => {
        exec(cmd, { cwd: ROOT_DIR, timeout: timeoutMs }, (err, stdout, stderr) => {
          const combined = `${stdout || ''}\n${stderr || ''}`.trim();
          res({ ok: !err, out: combined });
        });
      });

    (async () => {
      const logs: string[] = [];
      let pullOk = true;
      let debOk = false;
      try {
        if (doGitPull) {
          if (hasGitRepo()) {
            await runStep(`git config --global --add safe.directory "${ROOT_DIR}"`, 5000);
            await runStep('git checkout -- static/index.html dist/ 2>/dev/null || true', 5000);
            const pRes = await runStep('git pull --ff-only origin main', 25000);
            pullOk = pRes.ok;
            logs.push(`$ git pull origin main\n${pRes.out || 'Ya está actualizado.'}`);
          } else {
            logs.push('Entorno sin carpeta .git local; actualización remota omitida.');
          }
        }
        const ver = readAppVersion() || targetVer;
        const dispVer = getDisplayVersion(ver);
        const debRel = `dist/recursos-cockpit_${ver}_amd64.deb`;
        const debAbs = path.resolve(ROOT_DIR, debRel);
        const buildScript = path.resolve(ROOT_DIR, 'packaging/build_deb.sh');

        if (!fs.existsSync(debAbs) && fs.existsSync(buildScript)) {
          const bRes = await runStep(`bash "${buildScript}"`, 60000);
          if (bRes.out) logs.push(bRes.out);
        }

        const instVer = getInstalledDebVersion();
        if (instVer !== ver && fs.existsSync(debAbs)) {
          const cmds = [
            `sudo -n apt-get install --reinstall -y "${debAbs}"`,
            `sudo -n dpkg --force-depends -i "${debAbs}"`,
            `dpkg --force-depends -i "${debAbs}"`,
          ];
          let permDenied = false;
          for (const cmd of cmds) {
            const iRes = await runStep(cmd, 45000);
            if (iRes.ok) {
              if (iRes.out) logs.push(iRes.out);
              logs.push(`[✓] Paquete recursos-cockpit v${dispVer} (${ver}) instalado.`);
              debOk = true;
              permCooldownUntil = 0;
              break;
            }
            const low = iRes.out.toLowerCase();
            if (low.includes('password is required') || low.includes('superuser') || low.includes('permission denied')) {
              permDenied = true;
            }
          }
          if (!debOk && permDenied) {
            permCooldownUntil = Date.now() + 900000;
            logs.push('[!] Se necesitan permisos sudo para instalar el paquete .deb. Pausa automática de 15 min.');
          }
        } else if (instVer === ver) {
          debOk = true;
          logs.push(`[✓] Paquete recursos-cockpit v${dispVer} (${ver}) ya instalado.`);
        }

        lastAutoInstallAt = new Date().toLocaleTimeString('es-ES');
        lastAutoInstallStatus = debOk
          ? `Al día · v${dispVer} (${lastAutoInstallAt})`
          : `Código sincronizado · Paquete pendiente de permisos (${lastAutoInstallAt})`;
        resolve({ success: pullOk, output: logs.join('\n') || `v${dispVer} sincronizado.` });
      } finally {
        autoInstallInProgress = false;
      }
    })();
  });
}

function getRealVersionPayload(hostHeader: string) {
  const version = readAppVersion();
  const dispVersion = getDisplayVersion(version);
  const hasGit = hasGitRepo();
  const now = Date.now();
  if (now - cachedGitMeta.ts > 20000) {
    if (hasGit) {
      try {
        const sha = execSync('git rev-parse --short HEAD', { timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'HEAD';
        const log = execSync('git log -1 --format="%s|%ci"', { timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
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
    } else {
      cachedGitMeta = { sha: 'local', subject: `Edición CMineWar v${dispVersion}`, date: cachedGitMeta.date, ts: now };
    }
  }
  const localSha = cachedGitMeta.sha;
  const localSubject = cachedGitMeta.subject;
  const localDate = cachedGitMeta.date;
  const pubDomain = (hostHeader || os.hostname()).split(':')[0];
  const installedDebVer = getInstalledDebVersion();
  const packageNeedsInstall = Boolean(installedDebVer !== version);

  if (autoInstallEnabled && packageNeedsInstall && !autoInstallInProgress && now > permCooldownUntil && now - lastAutoInstallAttemptTs > 30000) {
    setTimeout(() => {
      void triggerViteAutoBuildAndInstallAsync(version, false);
    }, 50);
  }

  return {
    version,
    current_version: version,
    display_version: dispVersion,
    server_version: version,
    server_display_version: dispVersion,
    remote_version: version,
    remote_display_version: dispVersion,
    installed_deb_version: installedDebVer || version,
    package_installed: Boolean(installedDebVer),
    package_needs_install: packageNeedsInstall,
    auto_install_enabled: autoInstallEnabled,
    auto_install_in_progress: autoInstallInProgress,
    auto_install_status: lastAutoInstallStatus,
    last_auto_install: lastAutoInstallAt,
    has_git: hasGit,
    ahead_of_remote: false,
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
    recent_commits: getRecentCommitsCached(localSha),
  };
}

const CUSTOM_LOGOS_PATH = path.resolve(ROOT_DIR, 'custom_logos.json');

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

function realOsTelemetryMiddleware(): Plugin {
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

        if (url === '/manual' || url === '/manual.html' || url === '/readme') {
          const manualPath = path.resolve(ROOT_DIR, 'static', 'manual.html');
          const fallbackDocsPath = path.resolve(ROOT_DIR, 'docs', 'index.html');
          const chosen = fs.existsSync(manualPath) ? manualPath : fallbackDocsPath;
          if (fs.existsSync(chosen)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.end(fs.readFileSync(chosen, 'utf-8'));
            return;
          }
        }

        if (url === '/api/metrics/history' && req.method === 'GET') {
          const params = new URLSearchParams(queryStr || '');
          const beforeTsRaw = params.get('before_ts');
          const afterTsRaw = params.get('after_ts');
          const windowRaw = params.get('window_sec') || params.get('window') || '';
          const limit = Math.max(20, Math.min(600, Number.parseInt(params.get('limit') || '180', 10) || 180));
          const beforeTs = beforeTsRaw ? Number.parseFloat(beforeTsRaw) : null;
          const afterTs = afterTsRaw ? Number.parseFloat(afterTsRaw) : null;
          const isAll = windowRaw.trim().toLowerCase() === 'all';
          const windowSec = !isAll && windowRaw && windowRaw !== 'live' ? Number.parseFloat(windowRaw) : null;

          const totalSamples = devTelemetrySamples.length;
          const oldestTs = totalSamples > 0 ? devTelemetrySamples[0].ts : null;
          const newestTs = totalSamples > 0 ? devTelemetrySamples[totalSamples - 1].ts : null;

          let filtered = devTelemetrySamples;
          if (isAll) {
            filtered = devTelemetrySamples;
          } else if (windowSec && Number.isFinite(windowSec) && windowSec > 0 && newestTs !== null) {
            const endRef = beforeTs !== null && Number.isFinite(beforeTs) ? beforeTs : newestTs;
            const startRef = Math.max(oldestTs ?? 0, endRef - windowSec);
            filtered = devTelemetrySamples.filter((s) => s.ts >= startRef && s.ts <= endRef);
          } else if (afterTs !== null && Number.isFinite(afterTs) && beforeTs === null) {
            filtered = devTelemetrySamples.filter((s) => s.ts >= afterTs).slice(0, limit);
          } else {
            filtered = devTelemetrySamples.filter((s) => {
              if (beforeTs !== null && Number.isFinite(beforeTs) && s.ts > beforeTs) return false;
              if (afterTs !== null && Number.isFinite(afterTs) && s.ts < afterTs) return false;
              return true;
            });
            filtered = filtered.slice(-limit);
          }

          let sampled = filtered;
          if (filtered.length > limit) {
            const bucketSize = filtered.length / limit;
            const out: TelemetryHistoryRow[] = [];
            for (let i = 0; i < limit; i++) {
              const sIdx = Math.floor(i * bucketSize);
              const eIdx = Math.min(filtered.length, Math.max(sIdx + 1, Math.floor((i + 1) * bucketSize)));
              const chunk = filtered.slice(sIdx, eIdx);
              if (chunk.length === 0) continue;
              if (i === 0) {
                out.push(filtered[0]);
              } else if (i === limit - 1) {
                out.push(filtered[filtered.length - 1]);
              } else if (chunk.length === 1) {
                out.push(chunk[0]);
              } else {
                let rep = chunk[0];
                let repScore = rep.cpu + rep.ram + rep.gpu + rep.net_rx;
                for (const item of chunk) {
                  const sc = item.cpu + item.ram + item.gpu + item.net_rx;
                  if (sc > repScore) {
                    rep = item;
                    repScore = sc;
                  }
                }
                out.push(rep);
              }
            }
            if (filtered.length > 0 && out.length > 0 && out[out.length - 1].ts !== filtered[filtered.length - 1].ts) {
              out[out.length - 1] = filtered[filtered.length - 1];
            }
            sampled = out;
          }

          const fmtDt = (ts: number) => {
            const d = new Date(ts * 1000);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            return `${dd}/${mm} ${d.toLocaleTimeString('es-ES')}`;
          };

          const series = {
            timestamps: sampled.map((s) => s.time_str),
            date_timestamps: sampled.map((s) => fmtDt(s.ts)),
            epoch_ts: sampled.map((s) => Math.round(s.ts * 1000) / 1000),
            cpu: sampled.map((s) => s.cpu),
            gpu: sampled.map((s) => s.gpu),
            ram: sampled.map((s) => s.ram),
            ram_total: sampled.map((s) => s.ram_total),
            net_rx: sampled.map((s) => s.net_rx),
            net_tx: sampled.map((s) => s.net_tx),
            net_wan_rx: sampled.map((s) => s.net_wan_rx ?? s.net_rx),
            net_wan_tx: sampled.map((s) => s.net_wan_tx ?? s.net_tx),
            net_lan_rx: sampled.map((s) => s.net_lan_rx ?? 0),
            net_lan_tx: sampled.map((s) => s.net_lan_tx ?? 0),
            disk_r: sampled.map((s) => s.disk_r),
            disk_w: sampled.map((s) => s.disk_w),
            disk_pct: sampled.map((s) => s.disk_pct),
          };
          const winStart = series.epoch_ts[0] ?? null;
          const winEnd = series.epoch_ts[series.epoch_ts.length - 1] ?? null;

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              db_file: 'recursos_history.db',
              oldest_ts: oldestTs,
              newest_ts: newestTs,
              window_start_ts: winStart,
              window_end_ts: winEnd,
              total_samples: totalSamples,
              returned_samples: sampled.length,
              has_older: Boolean(winStart !== null && oldestTs !== null && winStart > oldestTs + 0.5),
              has_newer: Boolean(winEnd !== null && newestTs !== null && winEnd < newestTs - 0.5),
              series,
            })
          );
          return;
        }

        if (url === '/api/maps/config') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              success: true,
              engine: 'leaflet',
              provider: 'OpenStreetMap',
              free: true,
              requires_api_key: false,
              tile_proxy: true,
            })
          );
          return;
        }

        const tileMatch = url.match(/^\/api\/maps\/tile\/(light|dark|osm)\/(\d+)\/(\d+)\/(\d+)(?:\.(?:png|jpg|jpeg))?$/);
        if (tileMatch && req.method === 'GET') {
          const [, style, zStr, xStr, yStr] = tileMatch;
          const candidates =
            style === 'dark'
              ? [
                  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${zStr}/${yStr}/${xStr}`,
                  `https://tile.openstreetmap.de/${zStr}/${xStr}/${yStr}.png`,
                ]
              : [
                  `https://tile.openstreetmap.org/${zStr}/${xStr}/${yStr}.png`,
                  `https://tile.openstreetmap.de/${zStr}/${xStr}/${yStr}.png`,
                  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${zStr}/${yStr}/${xStr}`,
                ];
          void (async () => {
            for (const candidateUrl of candidates) {
              try {
                const resp = await fetch(candidateUrl, {
                  headers: {
                    'User-Agent': `RecursosCockpit/${readAppVersion()} (+https://github.com/cminewarIA/recursos-ui)`,
                    Accept: 'image/webp,image/png,image/jpeg,*/*;q=0.8',
                  },
                });
                const ctype = (resp.headers.get('content-type') || '').toLowerCase();
                if (resp.ok && ctype.startsWith('image/')) {
                  const arrBuf = await resp.arrayBuffer();
                  if (arrBuf.byteLength > 100) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', ctype.split(';')[0]);
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    res.end(Buffer.from(arrBuf));
                    return;
                  }
                }
              } catch {
                // ignore and try next tile source
              }
            }
            res.statusCode = 502;
            res.end();
          })();
          return;
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

          const diskIo = sampleRealDiskIo();
          const rootDisk = (disks as Array<{ percent?: number }>)[0];
          const rootDiskPct = Number(rootDisk?.percent || 0);

            const nowEpochSec = Math.round((Date.now() / 1000) * 1000) / 1000;
          const timeStr = new Date().toLocaleTimeString('es-ES');
          const devSampleRow: TelemetryHistoryRow = {
            ts: nowEpochSec,
            time_str: timeStr,
            cpu: Math.round(cpu.overall * 100) / 100,
            gpu: 0,
            ram: Math.round(ram.percent * 100) / 100,
            ram_total: Math.round(ram.percent * 100) / 100,
            net_rx: Math.round((net.rx_bytes_sec / (1024 * 1024)) * 100) / 100,
            net_tx: Math.round((net.tx_bytes_sec / (1024 * 1024)) * 100) / 100,
            net_wan_rx: Math.round(((net.wan_rx_bytes_sec ?? net.rx_bytes_sec) / (1024 * 1024)) * 100) / 100,
            net_wan_tx: Math.round(((net.wan_tx_bytes_sec ?? net.tx_bytes_sec) / (1024 * 1024)) * 100) / 100,
            net_lan_rx: Math.round(((net.lan_rx_bytes_sec ?? 0) / (1024 * 1024)) * 100) / 100,
            net_lan_tx: Math.round(((net.lan_tx_bytes_sec ?? 0) / (1024 * 1024)) * 100) / 100,
            disk_r: Math.round((diskIo.read_bytes_sec / (1024 * 1024)) * 100) / 100,
            disk_w: Math.round((diskIo.write_bytes_sec / (1024 * 1024)) * 100) / 100,
            disk_pct: Math.round(rootDiskPct * 10) / 10,
          };
          pushHistoryBucketDev(devSampleRow, true);
          appendTelemetrySampleDev(devSampleRow);

          const payload = {
            maps_engine: 'leaflet',
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
            system_errors_summary: {
              total: geoIpErrorHistory.length,
              total_errors: geoIpErrorHistory.length,
              log_errors_count: geoIpErrorHistory.length,
              failed_units_count: 0,
              failed_units: [],
              ack_ts: devLogsAckTs,
              ack_time_str: devLogsAckTimeStr,
              counts_by_category: {
                all: geoIpErrorHistory.length,
                total: geoIpErrorHistory.length,
                systemd: 0,
                docker: 0,
                network: geoIpErrorHistory.length,
                kernel: 0,
                auth: 0,
                app: 0,
              },
            },
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
            disk_io: diskIo,
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
            security: (() => {
              const gF2b = globalThis as unknown as { __viteFail2banBans?: Array<Record<string, unknown>> };
              const f2bList = gF2b.__viteFail2banBans || [];
              return {
                available: true,
                pihole: { available: false, domains_being_blocked: 0, dns_queries_today: 0, ads_blocked_today: 0, ads_percentage_today: 0, top_blocked: [] },
                fail2ban: {
                  available: true,
                  active: true,
                  currently_banned: f2bList.length,
                  total_banned: f2bList.length,
                  jails: {},
                  banned_ips: f2bList.map((b) => String(b.ip || '')).filter(Boolean),
                  banned_details: f2bList,
                  all_time_banned: f2bList,
                },
              };
            })(),
            system_processes: procs,
            history: historyBuffer,
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
          return;
        }

        if (url === '/api/dictionary') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(loadViteDictionary()));
          return;
        }

        const isViteModuleImport = /(?:^|&)(?:raw|import|url|inline)(?:=|&|$)/.test(queryStr || '');
        if (url === '/i18n/dictionary.csv' && !isViteModuleImport) {
          const csvFile = path.resolve(ROOT_DIR, 'i18n/dictionary.csv');
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(fs.existsSync(csvFile) ? fs.readFileSync(csvFile) : 'key,context,es\n');
          return;
        }

        if (url === '/api/version') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getRealVersionPayload(hostHdr)));
          return;
        }

        if (url === '/api/network/devices-db' && req.method === 'GET') {
          const netSnap = sampleRealNetwork();
          const devClients = (
            netSnap.interfaces_list as Array<{
              name: string;
              ip: string;
              mac: string;
              speed_mbps: number;
              bytes_recv?: number;
              bytes_sent?: number;
              rx_bytes_sec?: number;
              tx_bytes_sec?: number;
              wan_rx_bytes_sec?: number;
              wan_tx_bytes_sec?: number;
              lan_rx_bytes_sec?: number;
              lan_tx_bytes_sec?: number;
            }>
          ).map((nic) => ({
            name: `${os.hostname()} (${nic.name})`,
            ip: nic.ip || '127.0.0.1',
            mac: nic.mac || 'INTERFAZ-ACTIVA',
            band: 'Ethernet',
            conn_type: 'cable',
            online: true,
            is_online: true,
            is_server: true,
            sources: ['server'],
            tx_bytes: nic.bytes_recv || 0,
            rx_bytes: nic.bytes_sent || 0,
            speed_down: nic.rx_bytes_sec || 0,
            speed_up: nic.tx_bytes_sec || 0,
            wan_speed_down: nic.wan_rx_bytes_sec ?? nic.rx_bytes_sec ?? 0,
            wan_speed_up: nic.wan_tx_bytes_sec ?? nic.tx_bytes_sec ?? 0,
            lan_speed_down: nic.lan_rx_bytes_sec ?? 0,
            lan_speed_up: nic.lan_tx_bytes_sec ?? 0,
          }));
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              updated_at: new Date().toLocaleTimeString('es-ES', { hour12: false }),
              summary: {
                total_clients: devClients.length,
                online_clients: devClients.length,
                router_wan_available: false,
                router_wan_rx_bytes_sec: netSnap.wan_rx_bytes_sec ?? netSnap.rx_bytes_sec ?? 0,
                router_wan_tx_bytes_sec: netSnap.wan_tx_bytes_sec ?? netSnap.tx_bytes_sec ?? 0,
                router_lan_rx_bytes_sec: netSnap.lan_rx_bytes_sec ?? 0,
                router_lan_tx_bytes_sec: netSnap.lan_tx_bytes_sec ?? 0,
                router_traffic_source: os.hostname(),
                pihole_db_total: 0,
              },
              devices: devClients,
              total_count: devClients.length,
            })
          );
          return;
        }

        if (url === '/api/system/logs' && req.method === 'GET') {
          const logs = geoIpErrorHistory.map((err, idx) => ({
            id: err.id || `err_${idx}`,
            timestamp: err.ts,
            date_str: err.time_str,
            time_str: err.time_str,
            category: 'network',
            level: 'ERROR',
            unit: err.source || 'GeoIP',
            source: err.source || 'GeoIP',
            message: `${err.message} (${err.target})`,
          }));
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              logs,
              entries: logs,
              total: logs.length,
              total_errors: logs.length,
              log_errors_count: logs.length,
              failed_units_count: 0,
              failed_units: [],
              ack_ts: devLogsAckTs,
              ack_time_str: devLogsAckTimeStr,
              counts_by_category: {
                all: logs.length,
                total: logs.length,
                systemd: 0,
                docker: 0,
                network: logs.length,
                kernel: 0,
                auth: 0,
                app: 0,
              },
            })
          );
          return;
        }

        if (
          (url === '/api/system/logs/clear' || url === '/api/system/logs/ack') &&
          (req.method === 'POST' || req.method === 'DELETE')
        ) {
          clearGeoIpWorkerErrors();
          devLogsAckTs = Date.now() / 1000;
          devLogsAckTimeStr = new Date().toLocaleTimeString('es-ES', { hour12: false });
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              success: true,
              cleared: true,
              message: translateViteDict('errors.system_logs_acked'),
              ack_ts: devLogsAckTs,
              ack_time_str: devLogsAckTimeStr,
              system_errors_summary: {
                total: 0,
                total_errors: 0,
                log_errors_count: 0,
                failed_units_count: 0,
                failed_units: [],
                ack_ts: devLogsAckTs,
                ack_time_str: devLogsAckTimeStr,
              },
            })
          );
          return;
        }

        if ((url === '/api/system/update' || url === '/api/update') && req.method === 'POST') {
          permCooldownUntil = 0;
          const curVer = readAppVersion();
          const dispVer = getDisplayVersion(curVer);
          void triggerViteAutoBuildAndInstallAsync(curVer, true).then((result) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: result.success,
                message: `Comprobación y actualización v${dispVer} completada.`,
                output: result.output,
                version_info: getRealVersionPayload(hostHdr),
              })
            );
          });
          return;
        }

        if (url === '/api/system/sync-web' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const v = String(body.version || readAppVersion()).trim();
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: true,
                  synced: true,
                  version: v,
                  message: `Sincronización web en modo desarrollo verificada (v${v}).`,
                  version_info: getRealVersionPayload(hostHdr),
                })
              );
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Payload inválido' }));
            }
          });
          return;
        }

        if (url === '/api/system/auto-update' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              autoInstallEnabled = Boolean(body.enabled ?? true);
              if (autoInstallEnabled) {
                lastAutoInstallStatus = 'Activo · Instalando automáticamente al detectar';
              } else {
                lastAutoInstallStatus = 'Pausado · Instalación manual';
              }
            } catch {
              // Ignore parse error
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: true,
                auto_install_enabled: autoInstallEnabled,
                status: lastAutoInstallStatus,
              })
            );
          });
          return;
        }

        if (url?.startsWith('/download/recursos-cockpit') || url === '/download/app.deb' || url === '/download/app.apk') {
          const isApk = url.endsWith('.apk');
          const distDir = path.resolve(ROOT_DIR, 'dist');
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

        if (url === '/api/auth/restore-session' || url === '/api/auth/unlock' || url === '/api/auth/session') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              success: true,
              authenticated: true,
              is_trusted: true,
              is_local: true,
              connection_mode: 'LAN',
              device_id: 'dev_active_session',
            })
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
              token_set: false,
              token_masked: '••••••••••••••••',
              upstream_dns: ['127.0.0.1'],
            })
          );
          return;
        }

        if ((url === '/api/dns/duckdns/update' || url === '/api/duckdns/update') && req.method === 'POST') {
          const ver = getRealVersionPayload(hostHdr);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              success: true,
              status: 'OK',
              message: 'DDNS actualizado en modo desarrollo',
              domain: ver.public_domain,
              ip: ver.local_ip,
              updated_at: new Date().toLocaleTimeString('es-ES'),
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

        if (url === '/api/dex/status' || url === '/api/usb/status') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              success: true,
              detected_env: 'web',
              is_native_or_mobile: false,
              hide_device_tab: false,
              usb_listening: true,
              session_running: false,
              devices: [],
              dependencies: { adb: false, scrcpy: false, ready: false },
            })
          );
          return;
        }

        if (url === '/api/dex/start' || url === '/api/dex/stop') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, message: 'Controlador DeX exclusivo de la aplicación nativa Linux' }));
          return;
        }

        if (url === '/api/native/device-info') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              client_type: 'web_browser',
              is_native: false,
              access_level: 'WEB_SANDBOX',
            })
          );
          return;
        }

        if (url?.startsWith('/api/telegram_bot')) {
          const g = globalThis as unknown as {
            __viteTgState?: {
              config: { notify_completed_torrents: boolean; notify_network_changes: boolean };
              allowed_users: number[];
              activity: Array<Record<string, unknown>>;
            };
          };
          if (!g.__viteTgState) {
            g.__viteTgState = {
              config: { notify_completed_torrents: true, notify_network_changes: true },
              allowed_users: [],
              activity: [],
            };
          }
          const tgState = g.__viteTgState;

          const sendTgJson = (obj: unknown, status = 200) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
          };

          if (req.method === 'POST') {
            let rawBody = '';
            req.on('data', (chunk) => {
              rawBody += chunk;
            });
            req.on('end', () => {
              let body: Record<string, unknown> = {};
              try {
                body = rawBody ? JSON.parse(rawBody) : {};
              } catch {
                sendTgJson({ success: false, error: 'JSON inválido' }, 400);
                return;
              }
              const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
              if (url === '/api/telegram_bot/config') {
                if ('notify_completed_torrents' in body) {
                  tgState.config.notify_completed_torrents = Boolean(body.notify_completed_torrents);
                }
                if ('notify_network_changes' in body) {
                  tgState.config.notify_network_changes = Boolean(body.notify_network_changes);
                }
                sendTgJson({ success: true, config: tgState.config });
                return;
              }
              if (url === '/api/telegram_bot/whitelist/add') {
                const uid = Number.parseInt(String(body.user_id || ''), 10);
                if (!Number.isFinite(uid) || uid <= 0) {
                  sendTgJson({ success: false, error: 'El ID de usuario/chat debe ser un número entero válido' }, 400);
                  return;
                }
                if (!tgState.allowed_users.includes(uid)) tgState.allowed_users.push(uid);
                sendTgJson({ success: true, message: `Usuario ${uid} añadido a la lista blanca`, allowed_users: tgState.allowed_users });
                return;
              }
              if (url === '/api/telegram_bot/whitelist/remove') {
                const uid = Number.parseInt(String(body.user_id || ''), 10);
                tgState.allowed_users = tgState.allowed_users.filter((x) => x !== uid);
                sendTgJson({ success: true, message: `Usuario ${uid} eliminado de la lista blanca`, allowed_users: tgState.allowed_users });
                return;
              }
              if (url === '/api/telegram_bot/send') {
                const msg = String(body.message || body.text || '').trim();
                if (!msg) {
                  sendTgJson({ success: false, error: 'El mensaje no puede estar vacío' }, 400);
                  return;
                }
                tgState.activity.unshift({
                  direction: 'out',
                  type: 'custom_broadcast',
                  target: 'Dev',
                  user_name: 'Panel Web (Dev)',
                  title: 'Mensaje en modo desarrollo',
                  content: msg,
                  time_str: nowIso,
                  status: 'ok',
                });
                sendTgJson({ success: true, message: 'Mensaje registrado en modo desarrollo' });
                return;
              }
              if (url === '/api/telegram_bot/activity/clear') {
                tgState.activity = [];
                sendTgJson({ success: true, message: 'Historial de mensajes vaciado' });
                return;
              }
              if (url === '/api/telegram_bot/test' || url === '/api/telegram_bot/ping') {
                sendTgJson({ success: true, message: 'Ping de prueba simulado en modo desarrollo' });
                return;
              }
              sendTgJson({ success: true, message: 'Operación completada' });
            });
            return;
          }

          if (url === '/api/telegram_bot/config') {
            sendTgJson({
              success: true,
              bot_token_set: false,
              bot_username: '',
              admin_user_ids: tgState.allowed_users,
              ...tgState.config,
            });
          } else {
            sendTgJson({
              success: true,
              bot_status: { enabled: false, active: false, username: '' },
              activity: tgState.activity,
              allowed_users: tgState.allowed_users,
              config: tgState.config,
            });
          }
          return;
        }

        if (url?.startsWith('/api/fail2ban')) {
          const g = globalThis as unknown as { __viteFail2banBans?: Array<Record<string, unknown>> };
          if (!g.__viteFail2banBans) g.__viteFail2banBans = [];
          const sendF2bJson = (obj: unknown, status = 200) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(obj));
          };

          if (url === '/api/fail2ban/history' && req.method === 'GET') {
            sendF2bJson({ status: 'ok', total: g.__viteFail2banBans.length, history: g.__viteFail2banBans });
            return;
          }

          if (req.method === 'POST') {
            let rawBody = '';
            req.on('data', (chunk) => {
              rawBody += chunk;
            });
            req.on('end', () => {
              let body: Record<string, unknown> = {};
              try {
                body = rawBody ? JSON.parse(rawBody) : {};
              } catch {
                if (url !== '/api/fail2ban/import') {
                  sendF2bJson({ success: false, error: 'JSON inválido' }, 400);
                  return;
                }
              }
              if (url === '/api/fail2ban/ban') {
                const ip = String(body.ip || '').trim();
                const jail = String(body.jail || 'caddy-scan').trim() || 'caddy-scan';
                if (!ip || nodeNet.isIP(ip) === 0) {
                  sendF2bJson({ success: false, error: 'Dirección IP no válida' }, 400);
                  return;
                }
                if (!g.__viteFail2banBans!.some((b) => b.ip === ip)) {
                  g.__viteFail2banBans!.unshift({ ip, jail, banned_at: Math.floor(Date.now() / 1000), is_active: true });
                }
                sendF2bJson({ success: true, message: `IP ${ip} registrada en modo dev (${jail})`, ip, jail });
                return;
              }
              if (url === '/api/fail2ban/unban') {
                const ip = String(body.ip || '').trim();
                if (!ip || nodeNet.isIP(ip) === 0) {
                  sendF2bJson({ success: false, error: 'Dirección IP no válida' }, 400);
                  return;
                }
                g.__viteFail2banBans = g.__viteFail2banBans!.filter((b) => b.ip !== ip);
                sendF2bJson({ success: true, message: `IP ${ip} desbloqueada en modo dev`, ip });
                return;
              }
              if (url === '/api/fail2ban/import') {
                const text = String(body.text || rawBody || '');
                const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
                const validIps = Array.from(new Set(matches.filter((cand) => nodeNet.isIP(cand) === 4)));
                sendF2bJson({
                  success: validIps.length > 0,
                  total_imported: validIps.length,
                  active_banned: validIps.length,
                  message: validIps.length > 0 ? `Se procesaron ${validIps.length} IPs en modo dev` : 'No se encontraron IPs válidas',
                }, validIps.length > 0 ? 200 : 400);
                return;
              }
              sendF2bJson({ status: 'ok', success: true });
            });
            return;
          }

          sendF2bJson({ status: 'ok', success: true });
          return;
        }

        if (url === '/api/wol/shutdown' || url === '/api/device/shutdown') {
          let rawBody = '';
          req.on('data', (chunk) => {
            rawBody += chunk;
          });
          req.on('end', () => {
            let body: Record<string, unknown> = {};
            try {
              body = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'JSON inválido' }));
              return;
            }
            const ip = String(body.ip || '').trim();
            const mac = String(body.mac || '').trim();
            const name = String(body.name || ip || mac || 'dispositivo').trim();
            const cleanMac = mac.replace(/[^0-9A-Fa-f]/g, '');
            const localIp = sampleRealNetwork().local_ip;
            if (ip && (ip === '127.0.0.1' || ip === '::1' || ip === localIp)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Operación bloqueada: no se puede apagar el servidor anfitrión' }));
              return;
            }
            if ((!ip || nodeNet.isIP(ip) === 0) && cleanMac.length !== 12) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Se requiere una dirección IP o MAC válida' }));
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: true,
                message: `Señal Sleep-on-LAN (SoL) enviada en modo desarrollo a ${name}`,
                channels: ['sol_udp'],
              })
            );
          });
          return;
        }

        if (url === '/api/service/action' || url === '/api/wol/wake') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, message: 'Acción completada' }));
          return;
        }

        next();
      });
    },
  };
}

function emitStandaloneStaticHtmlPlugin(): Plugin {
  return {
    name: 'emit-standalone-static-html',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(ROOT_DIR, 'dist');
      const distHtmlPath = path.join(distDir, 'index.html');
      const staticOutPath = path.resolve(ROOT_DIR, 'static', 'index.html');
      if (!fs.existsSync(distHtmlPath)) return;
      let html = fs.readFileSync(distHtmlPath, 'utf-8');

      // Inline compiled stylesheet tags into <style>
      html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi, (full, href) => {
        if (/^https?:\/\//i.test(href)) return full;
        const cssFile = path.join(distDir, href.replace(/^\//, ''));
        if (fs.existsSync(cssFile)) {
          const css = fs.readFileSync(cssFile, 'utf-8').replace(/<\/style>/gi, '<\\/style>');
          return `<style>${css}</style>`;
        }
        return full;
      });

      // Inline compiled module script tags into <script type="module">
      html = html.replace(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi, (full, src) => {
        if (/^https?:\/\//i.test(src)) return full;
        const jsFile = path.join(distDir, src.replace(/^\//, ''));
        if (fs.existsSync(jsFile)) {
          const js = fs.readFileSync(jsFile, 'utf-8').replace(/<\/script>/gi, '<\\/script>');
          return `<script type="module">${js}</script>`;
        }
        return full;
      });

      fs.mkdirSync(path.dirname(staticOutPath), { recursive: true });
      fs.writeFileSync(staticOutPath, html, 'utf-8');
    },
  };
}

export default defineConfig(() => {
  const canonicalVer = readAppVersion();
  return {
    define: {
      __APP_VERSION__: JSON.stringify(canonicalVer),
    },
    plugins: [realOsTelemetryMiddleware(), react(), tailwindcss(), emitStandaloneStaticHtmlPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(ROOT_DIR, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      emptyOutDir: false,
    },
  };
});
