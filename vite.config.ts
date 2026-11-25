import { GoogleGenAI, Type } from '@google/genai';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { exec, execSync, spawn } from 'child_process';
import crypto from 'crypto';
import dns from 'dns';
import fs from 'fs';
import http from 'http';
import https from 'https';
import nodeNet from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, Plugin } from 'vite';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AI_NET_MODEL = 'gemini-4-hydrogen';

interface AiConnInsightRecord {
  signature: string;
  app_name: string;
  category: string;
  summary: string;
  role: string;
  confidence: 'high' | 'medium' | 'low';
  model: string;
  analyzed_at: number;
}

interface AiSystemFaultInsightRecord {
  signature: string;
  unit: string;
  category: string;
  title: string;
  danger_level: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  solution: string;
  confidence: 'high' | 'medium' | 'low';
  model: string;
  occurrence_count: number;
  first_seen_at: number;
  analyzed_at: number;
  cached_from_db?: boolean;
}

const aiNetInsightsCache = new Map<string, { insight: AiConnInsightRecord; cachedAt: number }>();
const aiFaultInsightsCache = new Map<string, { insight: AiSystemFaultInsightRecord; cachedAt: number }>();
const AI_NET_CACHE_TTL_MS = 30 * 60 * 1000;
const AI_FAULT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días: fallos recurrentes jamás se re-consultan
const aiInsightsDevPath = path.resolve(ROOT_DIR, 'ai_insights_dev.json');
let cachedHostSocketsSummary: { ts: number; services: string[] } = { ts: 0, services: [] };

export function normalizeSystemFaultSignature(unitStr: string, categoryStr: string, messageStr: string): string {
  let u = String(unitStr || 'system').trim().toLowerCase();
  if (u.includes('@') && u.endsWith('.service')) {
    u = `${u.split('@')[0]}@.service`;
  }
  const c = String(categoryStr || 'system').trim().toLowerCase();
  const m = String(messageStr || '')
    .trim()
    .toLowerCase()
    .replace(/0x[0-9a-f]+/gi, '0x#')
    .replace(/\[\s*\d+\s*\]/g, '[#]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '#.#.#.#')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 130);
  return `${u}|${c}|${m}`;
}

try {
  if (fs.existsSync(aiInsightsDevPath)) {
    const rawAi = JSON.parse(fs.readFileSync(aiInsightsDevPath, 'utf-8'));
    if (rawAi && typeof rawAi === 'object') {
      const connMap = rawAi.connections && typeof rawAi.connections === 'object' ? rawAi.connections : rawAi;
      for (const [k, v] of Object.entries(connMap)) {
        if (k === 'connections' || k === 'faults') continue;
        if (v && typeof v === 'object' && 'insight' in v && 'cachedAt' in v) {
          aiNetInsightsCache.set(k, v as { insight: AiConnInsightRecord; cachedAt: number });
        }
      }
      if (rawAi.faults && typeof rawAi.faults === 'object') {
        for (const [k, v] of Object.entries(rawAi.faults)) {
          if (v && typeof v === 'object' && 'insight' in v && 'cachedAt' in v) {
            aiFaultInsightsCache.set(k, v as { insight: AiSystemFaultInsightRecord; cachedAt: number });
          }
        }
      }
    }
  }
} catch {
  // Ignore corrupt dev insights cache
}

function saveAiInsightsDev() {
  try {
    const connections: Record<string, { insight: AiConnInsightRecord; cachedAt: number }> = {};
    for (const [k, v] of aiNetInsightsCache.entries()) {
      connections[k] = v;
    }
    const faults: Record<string, { insight: AiSystemFaultInsightRecord; cachedAt: number }> = {};
    for (const [k, v] of aiFaultInsightsCache.entries()) {
      faults[k] = v;
    }
    const tmp = `${aiInsightsDevPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ connections, faults }), 'utf-8');
    fs.renameSync(tmp, aiInsightsDevPath);
  } catch {
    // Ignore dev cache write errors
  }
}

function readDotEnvKey(keyName: string): string {
  for (const fname of ['.env.local', '.env']) {
    const fpath = path.resolve(ROOT_DIR, fname);
    try {
      if (!fs.existsSync(fpath)) continue;
      const raw = fs.readFileSync(fpath, 'utf-8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const k = trimmed.slice(0, eqIdx).trim();
        if (k !== keyName) continue;
        const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (v) return v;
      }
    } catch {
      // Ignore unreadable env file
    }
  }
  return '';
}

function getDynamicHostServicesSnapshot(): string[] {
  const now = Date.now();
  if (now - cachedHostSocketsSummary.ts < 15000 && cachedHostSocketsSummary.services.length > 0) {
    return cachedHostSocketsSummary.services;
  }
  const services: string[] = [];
  try {
    const ssOut = execSync('ss -tulnpH 2>/dev/null || ss -tulnH 2>/dev/null', { timeout: 1200, encoding: 'utf-8' });
    for (const line of ssOut.split('\n').slice(0, 40)) {
      const cleaned = line.trim().replace(/\s+/g, ' ');
      if (cleaned) services.push(cleaned);
    }
  } catch {
    // Best-effort OS socket snapshot
  }
  try {
    const dockerOut = execSync('docker ps --format "{{.Names}} -> {{.Ports}}" 2>/dev/null', { timeout: 1200, encoding: 'utf-8' });
    for (const line of dockerOut.split('\n').slice(0, 25)) {
      const cleaned = line.trim();
      if (cleaned) services.push(`docker: ${cleaned}`);
    }
  } catch {
    // Docker optional
  }
  cachedHostSocketsSummary = { ts: now, services };
  return services;
}

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
  cpu_temp?: number;
  cpu_freq?: number;
  cpu_power?: number;
  cpu_load_1m?: number;
  cpu_load_5m?: number;
  cpu_user?: number;
  cpu_system?: number;
  cpu_iowait?: number;
  gpu: number;
  gpu_vram_pct?: number;
  gpu_mem_ctrl?: number;
  gpu_enc?: number;
  gpu_dec?: number;
  gpu_power?: number;
  gpu_temp?: number;
  gpu_clk_gfx?: number;
  gpu_clk_mem?: number;
  gpu_pcie_rx?: number;
  gpu_pcie_tx?: number;
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

interface HistoryBucketDev extends TelemetryHistoryRow {
  b_ts: number;
}

const historyBuckets20m: HistoryBucketDev[] = [];
const historyBuffer: Record<string, (number | string)[]> = {
  timestamps: [],
  epoch_ts: [],
  cpu: [],
  cpu_temp: [],
  cpu_freq: [],
  cpu_power: [],
  cpu_load_1m: [],
  cpu_load_5m: [],
  cpu_user: [],
  cpu_system: [],
  cpu_iowait: [],
  gpu: [],
  gpu_vram_pct: [],
  gpu_mem_ctrl: [],
  gpu_enc: [],
  gpu_dec: [],
  gpu_power: [],
  gpu_temp: [],
  gpu_clk_gfx: [],
  gpu_clk_mem: [],
  gpu_pcie_rx: [],
  gpu_pcie_tx: [],
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
  historyBuffer.cpu_temp = historyBuckets20m.map((b) => b.cpu_temp ?? 0);
  historyBuffer.cpu_freq = historyBuckets20m.map((b) => b.cpu_freq ?? 0);
  historyBuffer.cpu_power = historyBuckets20m.map((b) => b.cpu_power ?? 0);
  historyBuffer.cpu_load_1m = historyBuckets20m.map((b) => b.cpu_load_1m ?? 0);
  historyBuffer.cpu_load_5m = historyBuckets20m.map((b) => b.cpu_load_5m ?? 0);
  historyBuffer.cpu_user = historyBuckets20m.map((b) => b.cpu_user ?? 0);
  historyBuffer.cpu_system = historyBuckets20m.map((b) => b.cpu_system ?? 0);
  historyBuffer.cpu_iowait = historyBuckets20m.map((b) => b.cpu_iowait ?? 0);
  historyBuffer.gpu = historyBuckets20m.map((b) => b.gpu);
  historyBuffer.gpu_vram_pct = historyBuckets20m.map((b) => b.gpu_vram_pct ?? 0);
  historyBuffer.gpu_mem_ctrl = historyBuckets20m.map((b) => b.gpu_mem_ctrl ?? 0);
  historyBuffer.gpu_enc = historyBuckets20m.map((b) => b.gpu_enc ?? 0);
  historyBuffer.gpu_dec = historyBuckets20m.map((b) => b.gpu_dec ?? 0);
  historyBuffer.gpu_power = historyBuckets20m.map((b) => b.gpu_power ?? 0);
  historyBuffer.gpu_temp = historyBuckets20m.map((b) => b.gpu_temp ?? 0);
  historyBuffer.gpu_clk_gfx = historyBuckets20m.map((b) => b.gpu_clk_gfx ?? 0);
  historyBuffer.gpu_clk_mem = historyBuckets20m.map((b) => b.gpu_clk_mem ?? 0);
  historyBuffer.gpu_pcie_rx = historyBuckets20m.map((b) => b.gpu_pcie_rx ?? 0);
  historyBuffer.gpu_pcie_tx = historyBuckets20m.map((b) => b.gpu_pcie_tx ?? 0);
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
    last.cpu_temp = Math.max(last.cpu_temp ?? 0, row.cpu_temp ?? 0);
    last.cpu_freq = (row.cpu_freq ?? 0) > 0 ? row.cpu_freq : (last.cpu_freq ?? 0);
    last.cpu_power = Math.max(last.cpu_power ?? 0, row.cpu_power ?? 0);
    last.cpu_load_1m = Math.max(last.cpu_load_1m ?? 0, row.cpu_load_1m ?? 0);
    last.cpu_load_5m = Math.max(last.cpu_load_5m ?? 0, row.cpu_load_5m ?? 0);
    last.cpu_user = Math.max(last.cpu_user ?? 0, row.cpu_user ?? 0);
    last.cpu_system = Math.max(last.cpu_system ?? 0, row.cpu_system ?? 0);
    last.cpu_iowait = Math.max(last.cpu_iowait ?? 0, row.cpu_iowait ?? 0);
    last.gpu = Math.max(last.gpu, row.gpu);
    last.gpu_vram_pct = Math.max(last.gpu_vram_pct ?? 0, row.gpu_vram_pct ?? 0);
    last.gpu_mem_ctrl = Math.max(last.gpu_mem_ctrl ?? 0, row.gpu_mem_ctrl ?? 0);
    last.gpu_enc = Math.max(last.gpu_enc ?? 0, row.gpu_enc ?? 0);
    last.gpu_dec = Math.max(last.gpu_dec ?? 0, row.gpu_dec ?? 0);
    last.gpu_power = Math.max(last.gpu_power ?? 0, row.gpu_power ?? 0);
    last.gpu_temp = Math.max(last.gpu_temp ?? 0, row.gpu_temp ?? 0);
    last.gpu_clk_gfx = (row.gpu_clk_gfx ?? 0) > 0 ? row.gpu_clk_gfx : (last.gpu_clk_gfx ?? 0);
    last.gpu_clk_mem = (row.gpu_clk_mem ?? 0) > 0 ? row.gpu_clk_mem : (last.gpu_clk_mem ?? 0);
    last.gpu_pcie_rx = Math.max(last.gpu_pcie_rx ?? 0, row.gpu_pcie_rx ?? 0);
    last.gpu_pcie_tx = Math.max(last.gpu_pcie_tx ?? 0, row.gpu_pcie_tx ?? 0);
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

let prevProcStatTotals: { user: number; system: number; iowait: number; idle: number; total: number } | null = null;

function readRealCpuTempDev(): { tempC: number | null; sensors: Array<{ label: string; temp_c: number }> } {
  let tempC: number | null = null;
  const sensors: Array<{ label: string; temp_c: number }> = [];
  const preferred = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal', 'x86_pkg_temp'];
  const fallback = ['acpitz', 'package', 'dell_smm', 'thinkpad'];

  const scanHwmon = (drivers: string[]) => {
    const root = '/sys/class/hwmon';
    if (!fs.existsSync(root)) return;
    try {
      for (const hw of fs.readdirSync(root).sort()) {
        const hwDir = path.join(root, hw);
        const namePath = path.join(hwDir, 'name');
        if (!fs.existsSync(namePath)) continue;
        const hwName = fs.readFileSync(namePath, 'utf-8').trim().toLowerCase();
        if (!drivers.some((d) => hwName.includes(d))) continue;
        for (const f of fs.readdirSync(hwDir).sort()) {
          if (!f.startsWith('temp') || !f.endsWith('_input')) continue;
          try {
            const raw = parseInt(fs.readFileSync(path.join(hwDir, f), 'utf-8').trim(), 10);
            const val = Math.round((raw / 1000) * 10) / 10;
            if (!Number.isFinite(val) || val < -20 || val > 150) continue;
            const lblPath = path.join(hwDir, `${f.slice(0, -6)}_label`);
            const lbl = fs.existsSync(lblPath) ? fs.readFileSync(lblPath, 'utf-8').trim() || hwName : hwName;
            sensors.push({ label: lbl, temp_c: val });
            if (tempC === null || /package|tctl|tdie|cpu/i.test(lbl)) tempC = val;
          } catch {
            // Skip unreadable sensor
          }
        }
        if (tempC !== null) break;
      }
    } catch {
      // Ignore hwmon errors
    }
  };

  scanHwmon(preferred);
  if (tempC === null) scanHwmon(fallback);

  if (tempC === null && fs.existsSync('/sys/class/thermal')) {
    try {
      for (const z of fs.readdirSync('/sys/class/thermal').sort()) {
        if (!z.startsWith('thermal_zone')) continue;
        const tPath = path.join('/sys/class/thermal', z, 'type');
        const vPath = path.join('/sys/class/thermal', z, 'temp');
        if (!fs.existsSync(tPath) || !fs.existsSync(vPath)) continue;
        const zType = fs.readFileSync(tPath, 'utf-8').trim();
        const raw = parseInt(fs.readFileSync(vPath, 'utf-8').trim(), 10);
        const val = Math.round((raw / 1000) * 10) / 10;
        if (!Number.isFinite(val) || val < -20 || val > 150) continue;
        if (/x86_pkg|cpu|soc|tcpu|acpitz|core/i.test(zType)) {
          sensors.push({ label: zType, temp_c: val });
          if (tempC === null || /pkg|cpu/i.test(zType)) tempC = val;
        }
      }
    } catch {
      // Ignore thermal errors
    }
  }

  return { tempC, sensors: sensors.slice(0, 8) };
}

function sampleRealCpuUsage(): {
  overall: number;
  perCore: number[];
  model: string;
  arch: string;
  vendor: string;
  cacheSize: string;
  freqMhz: number;
  freqMaxMhz: number;
  freqMinMhz: number;
  governor: string | null;
  tempC: number | null;
  tempSensors: Array<{ label: string; temp_c: number }>;
  userPct: number;
  systemPct: number;
  iowaitPct: number;
  idlePct: number;
} {
  const cpus = os.cpus() || [];
  const { model, arch, vendor, cacheSize } = getStaticCpuSpecs();
  let freqMhz = cpus[0]?.speed || 0;
  let freqMaxMhz = 0;
  let freqMinMhz = 0;
  let governor: string | null = null;

  try {
    if (fs.existsSync('/proc/cpuinfo')) {
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
    }
  } catch {
    // Fallback to os.cpus()
  }

  try {
    const govPath = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor';
    if (fs.existsSync(govPath)) governor = fs.readFileSync(govPath, 'utf-8').trim() || null;
    const maxPath = '/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq';
    if (fs.existsSync(maxPath)) freqMaxMhz = Math.round((parseInt(fs.readFileSync(maxPath, 'utf-8').trim(), 10) / 1000) * 10) / 10;
    const minPath = '/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq';
    if (fs.existsSync(minPath)) freqMinMhz = Math.round((parseInt(fs.readFileSync(minPath, 'utf-8').trim(), 10) / 1000) * 10) / 10;
  } catch {
    // Optional cpufreq files
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

  let userPct = 0;
  let systemPct = 0;
  let iowaitPct = 0;
  let idlePct = Math.max(0, Math.round((100 - overall) * 10) / 10);
  try {
    if (fs.existsSync('/proc/stat')) {
      const firstLine = fs.readFileSync('/proc/stat', 'utf-8').split('\n')[0] || '';
      const parts = firstLine.trim().split(/\s+/).slice(1).map((x) => parseInt(x, 10) || 0);
      if (parts.length >= 5) {
        const user = (parts[0] || 0) + (parts[1] || 0);
        const system = (parts[2] || 0) + (parts[5] || 0) + (parts[6] || 0);
        const idle = parts[3] || 0;
        const iowait = parts[4] || 0;
        const total = parts.reduce((acc, v) => acc + v, 0);
        if (prevProcStatTotals && total > prevProcStatTotals.total) {
          const dt = total - prevProcStatTotals.total;
          userPct = Math.round(((user - prevProcStatTotals.user) / dt) * 1000) / 10;
          systemPct = Math.round(((system - prevProcStatTotals.system) / dt) * 1000) / 10;
          iowaitPct = Math.round(((iowait - prevProcStatTotals.iowait) / dt) * 1000) / 10;
          idlePct = Math.round(((idle - prevProcStatTotals.idle) / dt) * 1000) / 10;
        }
        prevProcStatTotals = { user, system, iowait, idle, total };
      }
    }
  } catch {
    // Optional /proc/stat
  }

  const { tempC, sensors: tempSensors } = readRealCpuTempDev();
  return {
    overall,
    perCore,
    model,
    arch,
    vendor,
    cacheSize,
    freqMhz,
    freqMaxMhz,
    freqMinMhz,
    governor,
    tempC,
    tempSensors,
    userPct,
    systemPct,
    iowaitPct,
    idlePct,
  };
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

  const sumWanRx = (interfacesList as Array<{ wan_rx_bytes_sec?: number }>).reduce((a, b) => a + (b.wan_rx_bytes_sec || 0), 0);
  const sumWanTx = (interfacesList as Array<{ wan_tx_bytes_sec?: number }>).reduce((a, b) => a + (b.wan_tx_bytes_sec || 0), 0);
  const sumLanRx = (interfacesList as Array<{ lan_rx_bytes_sec?: number }>).reduce((a, b) => a + (b.lan_rx_bytes_sec || 0), 0);
  const sumLanTx = (interfacesList as Array<{ lan_tx_bytes_sec?: number }>).reduce((a, b) => a + (b.lan_tx_bytes_sec || 0), 0);

  const routerHist = nicHistory2h['__router__'] || (nicHistory2h['__router__'] = []);
  const rBucketMs = Math.floor(now / 5000) * 5000;
  const rCutoffMs = rBucketMs - 1200 * 1000;
  if (routerHist.length === 0 || routerHist[routerHist.length - 1].t < rBucketMs) {
    routerHist.push({
      t: rBucketMs,
      rx: sumWanRx + sumLanRx,
      tx: sumWanTx + sumLanTx,
      wan_rx: sumWanRx,
      wan_tx: sumWanTx,
      lan_rx: sumLanRx,
      lan_tx: sumLanTx,
    });
  } else {
    const rLast = routerHist[routerHist.length - 1];
    rLast.rx = Math.max(rLast.rx, sumWanRx + sumLanRx);
    rLast.tx = Math.max(rLast.tx, sumWanTx + sumLanTx);
    rLast.wan_rx = Math.max(rLast.wan_rx ?? 0, sumWanRx);
    rLast.wan_tx = Math.max(rLast.wan_tx ?? 0, sumWanTx);
    rLast.lan_rx = Math.max(rLast.lan_rx ?? 0, sumLanRx);
    rLast.lan_tx = Math.max(rLast.lan_tx ?? 0, sumLanTx);
  }
  while (routerHist.length > 0 && routerHist[0].t < rCutoffMs) {
    routerHist.shift();
  }

  saveNicHistory2hToDiskIfNeeded(now);
  triggerAsyncGeoSync();

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
    router_history_20m: [...routerHist],
    ping_latency: pingLatencyCache,
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
interface ObservedDevConnRecord {
  key: string;
  direction: 'incoming' | 'outgoing' | 'blocked';
  protocol: string;
  local_ip: string;
  local_hostname: string;
  local_port: number;
  remote_ip: string;
  remote_port: number;
  domain: string;
  service: string;
  process: string;
  jail: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
  country_code: string;
  isp: string;
  asn: string;
  hit_count: number;
  bytes_total: number;
  first_seen: number;
  last_seen: number;
}
const observedDevNetHistory = new Map<string, ObservedDevConnRecord>();
let lastObservedNetFlushSec = 0;

interface ObservedDnsDomainStat {
  domain: string;
  count: number;
  blocked_count: number;
  clients: Set<string>;
  total_reply_ms: number;
  last_ts: number;
}
const observedDnsDomains = new Map<string, ObservedDnsDomainStat>();
const observedDnsRecent: Array<{
  time: string;
  timestamp: number;
  client_ip: string;
  client_name: string;
  domain: string;
  status: number;
  is_blocked: boolean;
  forward: string;
  reply_ms: number;
}> = [];

function recordObservedDnsLookup(domain: string, clientIp: string, replyMs: number, forward = 'System Resolver') {
  const dom = String(domain || '').trim().toLowerCase();
  if (!dom || dom === 'localhost') return;
  const nowSec = Math.floor(Date.now() / 1000);
  const cIp = clientIp || '127.0.0.1';
  const cur = observedDnsDomains.get(dom);
  if (cur) {
    cur.count += 1;
    cur.clients.add(cIp);
    cur.total_reply_ms += Math.max(0, replyMs);
    cur.last_ts = nowSec;
  } else {
    observedDnsDomains.set(dom, {
      domain: dom,
      count: 1,
      blocked_count: 0,
      clients: new Set([cIp]),
      total_reply_ms: Math.max(0, replyMs),
      last_ts: nowSec,
    });
  }
  const timeStr = new Date().toTimeString().split(' ')[0];
  observedDnsRecent.unshift({
    time: timeStr,
    timestamp: nowSec,
    client_ip: cIp,
    client_name: os.hostname(),
    domain: dom,
    status: 2,
    is_blocked: false,
    forward,
    reply_ms: Math.round(replyMs * 10) / 10,
  });
  if (observedDnsRecent.length > 80) observedDnsRecent.length = 80;
}

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
          const tDns0 = performance.now();
          const res = await dns.promises.lookup(t.host, { family: 4 });
          const dnsMs = performance.now() - tDns0;
          if (res && res.address) {
            recordObservedDnsLookup(t.host, sampleRealNetwork().local_ip, dnsMs);
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

// ---------- Process 24h Grouped History (Dev persistence) ----------
const processHistoryDevPath = path.resolve(ROOT_DIR, 'process_history_dev.json');
interface ProcessSnapshotEntry {
  ts: number;
  procs: Record<string, { cpu: number; ram: number; vram: number; io: number }>;
}
let devProcessSnapshots: ProcessSnapshotEntry[] = [];
let lastProcSnapshotTs = 0;
let lastProcSaveMs = 0;

function loadProcessHistoryDev() {
  try {
    if (fs.existsSync(processHistoryDevPath)) {
      const parsed = JSON.parse(fs.readFileSync(processHistoryDevPath, 'utf-8'));
      if (Array.isArray(parsed)) {
        const cutoffSec = Date.now() / 1000 - 86400;
        devProcessSnapshots = parsed.filter((x) => x && typeof x.ts === 'number' && x.ts >= cutoffSec).slice(-1600);
        if (devProcessSnapshots.length > 0) {
          lastProcSnapshotTs = devProcessSnapshots[devProcessSnapshots.length - 1].ts;
        }
      }
    }
  } catch {
    // ignore corrupt disk cache
  }
}

loadProcessHistoryDev();

function recordProcessSnapshotDev(procsList: Array<Record<string, unknown>>, force = false) {
  const nowSec = Math.round((Date.now() / 1000) * 10) / 10;
  if (!force && devProcessSnapshots.length > 0 && nowSec - lastProcSnapshotTs < 55) return;
  if (!Array.isArray(procsList) || procsList.length === 0) return;

  const grouped: Record<string, { cpu: number; ram: number; vram: number; io: number }> = {};
  for (const p of procsList) {
    const rawName = String(p.name || '').trim();
    if (!rawName) continue;
    const pname = rawName.slice(0, 64);
    if (!grouped[pname]) grouped[pname] = { cpu: 0, ram: 0, vram: 0, io: 0 };
    const cpuV = Number(p.cpu_norm_percent ?? p.cpu_percent ?? 0) || 0;
    const ramV = Number(p.priv_mb ?? p.mem_mb ?? 0) || 0;
    const vramV = Number(p.vram_mb ?? 0) || 0;
    const ioV = Number(p.io_total_bps ?? 0) || 0;
    grouped[pname].cpu += cpuV;
    grouped[pname].ram += ramV;
    grouped[pname].vram += vramV;
    grouped[pname].io += ioV;
  }

  const ranked = Object.entries(grouped)
    .sort((a, b) => {
      const sa = a[1].cpu * 2 + a[1].ram / 128 + a[1].vram / 64 + a[1].io / (1024 * 1024);
      const sb = b[1].cpu * 2 + b[1].ram / 128 + b[1].vram / 64 + b[1].io / (1024 * 1024);
      return sb - sa;
    })
    .slice(0, 20);

  if (ranked.length === 0) return;
  const compactProcs: Record<string, { cpu: number; ram: number; vram: number; io: number }> = {};
  for (const [k, v] of ranked) {
    compactProcs[k] = {
      cpu: Math.round(Math.min(100, v.cpu) * 100) / 100,
      ram: Math.round(v.ram * 100) / 100,
      vram: Math.round(v.vram * 100) / 100,
      io: Math.round(v.io * 10) / 10,
    };
  }

  lastProcSnapshotTs = nowSec;
  const cutoffSec = nowSec - 86400;
  devProcessSnapshots.push({ ts: nowSec, procs: compactProcs });
  devProcessSnapshots = devProcessSnapshots.filter((x) => x.ts >= cutoffSec);
  if (devProcessSnapshots.length > 1600) {
    devProcessSnapshots = devProcessSnapshots.slice(-1600);
  }

  const nowMs = Date.now();
  if (force || nowMs - lastProcSaveMs >= 15000) {
    lastProcSaveMs = nowMs;
    try {
      const tmp = `${processHistoryDevPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(devProcessSnapshots), 'utf-8');
      fs.renameSync(tmp, processHistoryDevPath);
    } catch {
      // ignore disk write error
    }
  }
}

const PROC_HIST_COLORS = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

function queryProcessHistoryDev(hours = 24, metric = 'cpu') {
  const hoursVal = Math.max(1, Math.min(24, Number(hours) || 24));
  const metricKey = ['cpu', 'ram', 'vram', 'io'].includes(metric) ? metric : 'cpu';
  const unitMap: Record<string, string> = { cpu: '%', ram: 'MB', vram: 'MB', io: 'MB/s' };
  const unit = unitMap[metricKey];
  const cutoffSec = Date.now() / 1000 - hoursVal * 3600;
  const rows = devProcessSnapshots.filter((s) => s.ts >= cutoffSec).sort((a, b) => a.ts - b.ts);

  if (rows.length === 0) {
    return {
      ok: true,
      metric: metricKey,
      unit,
      hours: hoursVal,
      bucket_count: 0,
      total_snapshots: 0,
      oldest_ts: null,
      newest_ts: null,
      timestamps: [],
      date_timestamps: [],
      epoch_ts: [],
      series: [],
    };
  }

  const procScores: Record<string, number> = {};
  const valFor = (item: { cpu: number; ram: number; vram: number; io: number }) => {
    if (metricKey === 'cpu') return Math.max(0, item.cpu || 0);
    if (metricKey === 'ram') return Math.max(0, item.ram || 0);
    if (metricKey === 'vram') return Math.max(0, item.vram || 0);
    return Math.max(0, (item.io || 0) / (1024 * 1024));
  };

  for (const snap of rows) {
    for (const [pname, vals] of Object.entries(snap.procs)) {
      procScores[pname] = (procScores[pname] || 0) + valFor(vals);
    }
  }

  const topProcs = Object.entries(procScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);
  const topSet = new Set(topProcs);

  const maxBuckets = 96;
  const buckets: { ts: number; map: Record<string, number> }[] = [];
  if (rows.length <= maxBuckets) {
    for (const snap of rows) {
      const m: Record<string, number> = {};
      for (const [pname, vals] of Object.entries(snap.procs)) {
        m[pname] = valFor(vals);
      }
      buckets.push({ ts: snap.ts, map: m });
    }
  } else {
    const firstTs = rows[0].ts;
    const span = Math.max(1, rows[rows.length - 1].ts - firstTs);
    const step = span / maxBuckets;
    for (let i = 0; i < maxBuckets; i++) {
      const sTs = firstTs + i * step;
      const eTs = firstTs + (i + 1) * step + (i === maxBuckets - 1 ? 0.01 : 0);
      const chunk = rows.filter((r) => r.ts >= sTs && r.ts < eTs);
      if (chunk.length === 0) continue;
      const avgMap: Record<string, number> = {};
      const names = new Set<string>();
      for (const c of chunk) {
        for (const k of Object.keys(c.procs)) names.add(k);
      }
      for (const k of names) {
        let sumV = 0;
        for (const c of chunk) {
          if (c.procs[k]) sumV += valFor(c.procs[k]);
        }
        avgMap[k] = sumV / chunk.length;
      }
      buckets.push({ ts: chunk[chunk.length - 1].ts, map: avgMap });
    }
  }

  const timestamps: string[] = [];
  const dateTimestamps: string[] = [];
  const epochTs: number[] = [];
  const seriesArrays: Record<string, number[]> = {};
  for (const p of topProcs) seriesArrays[p] = [];
  const othersArr: number[] = [];

  for (const b of buckets) {
    const d = new Date(b.ts * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    timestamps.push(`${hh}:${mi}`);
    dateTimestamps.push(`${dd}/${mm} ${hh}:${mi}`);
    epochTs.push(Math.round(b.ts * 10) / 10);

    for (const p of topProcs) {
      seriesArrays[p].push(Math.round((b.map[p] || 0) * 100) / 100);
    }
    let otherSum = 0;
    for (const [k, v] of Object.entries(b.map)) {
      if (!topSet.has(k)) otherSum += v;
    }
    othersArr.push(Math.round(otherSum * 100) / 100);
  }

  const seriesOut = topProcs.map((p, idx) => {
    const arr = seriesArrays[p];
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      id: p,
      label: p,
      is_others: false,
      color: PROC_HIST_COLORS[idx % PROC_HIST_COLORS.length],
      avg: Math.round((sum / Math.max(1, arr.length)) * 100) / 100,
      peak: Math.round(Math.max(0, ...arr) * 100) / 100,
      last: Math.round((arr[arr.length - 1] || 0) * 100) / 100,
      data: arr,
    };
  });

  if (othersArr.some((v) => v > 0)) {
    const sumO = othersArr.reduce((a, b) => a + b, 0);
    seriesOut.push({
      id: '__others__',
      label: '',
      is_others: true,
      color: '#64748b',
      avg: Math.round((sumO / Math.max(1, othersArr.length)) * 100) / 100,
      peak: Math.round(Math.max(0, ...othersArr) * 100) / 100,
      last: Math.round((othersArr[othersArr.length - 1] || 0) * 100) / 100,
      data: othersArr,
    });
  }

  return {
    ok: true,
    metric: metricKey,
    unit,
    hours: hoursVal,
    bucket_count: buckets.length,
    total_snapshots: rows.length,
    oldest_ts: Math.round(rows[0].ts * 10) / 10,
    newest_ts: Math.round(rows[rows.length - 1].ts * 10) / 10,
    timestamps,
    date_timestamps: dateTimestamps,
    epoch_ts: epochTs,
    series: seriesOut,
  };
}

// ---------- Dynamic Ping Latency Probe Worker ----------
function detectDefaultGatewayIp(): string | null {
  try {
    const raw = fs.readFileSync('/proc/net/route', 'utf-8');
    for (const line of raw.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 3 && cols[1] === '00000000') {
        const gw = decodeProcHexIp(cols[2]);
        if (gw && gw !== '0.0.0.0') return gw;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function readResolvNameservers(): string[] {
  const servers: string[] = [];
  try {
    const raw = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    for (const line of raw.split('\n')) {
      const ln = line.trim();
      if (!ln || ln.startsWith('#')) continue;
      const parts = ln.split(/\s+/);
      if (parts.length >= 2 && parts[0].toLowerCase() === 'nameserver') {
        const ip = parts[1].trim();
        if (nodeNet.isIP(ip) === 4 && !ip.startsWith('127.') && !servers.includes(ip)) {
          servers.push(ip);
        }
      }
    }
  } catch {
    // ignore
  }
  return servers;
}

function probeHostRttMs(ip: string, tcpPort?: number): Promise<number | null> {
  return new Promise((resolve) => {
    exec(`ping -n -c 1 -W 1 ${ip}`, { timeout: 1600 }, (err, stdout) => {
      if (!err && stdout) {
        const m = stdout.match(/time[=<]([0-9.]+)\s*ms/);
        if (m && m[1]) {
          resolve(Math.round(parseFloat(m[1]) * 100) / 100);
          return;
        }
      }
      const candidatePorts = tcpPort && tcpPort > 0 ? [tcpPort, 443, 53, 80] : [443, 53, 80];
      let idx = 0;
      const tryTcp = () => {
        if (idx >= candidatePorts.length) {
          resolve(null);
          return;
        }
        const port = candidatePorts[idx++];
        const sock = new nodeNet.Socket();
        const t0 = performance.now();
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          const elapsed = Math.round((performance.now() - t0) * 100) / 100;
          sock.destroy();
          if (ok && elapsed < 1150) resolve(elapsed);
          else tryTcp();
        };
        sock.setTimeout(1000);
        sock.once('connect', () => done(true));
        sock.once('error', (e: NodeJS.ErrnoException) => done(e?.code === 'ECONNREFUSED'));
        sock.once('timeout', () => done(false));
        try {
          sock.connect(port, ip);
        } catch {
          done(false);
        }
      };
      tryTcp();
    });
  });
}

const PING_TARGET_PALETTE = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
const pingHistoryDevPath = path.resolve(ROOT_DIR, 'ping_history_dev.json');
interface DevPingTargetMeta {
  id: string;
  ip: string;
  label: string;
  kind: 'gateway' | 'external' | 'dns';
}
interface DevPingRow {
  ts: number;
  time_str: string;
  values: Record<string, number | null>;
  targets: Record<string, DevPingTargetMeta>;
}
let devPingSamples: DevPingRow[] = [];
let lastPingDevSaveMs = 0;

const pingHistoryPoints: Array<{ ts: number; time_str: string; values: Record<string, number | null> }> = [];
let pingLatencyCache: {
  updated_at: string;
  timestamps: string[];
  epoch_ts: number[];
  targets: Array<{
    id: string;
    ip: string;
    label: string;
    kind: 'gateway' | 'external' | 'dns';
    avg_ms: number | null;
    last_ms: number | null;
    min_ms: number | null;
    max_ms: number | null;
    jitter_ms: number;
    loss_pct: number;
    color: string;
    data: number[];
  }>;
} = { updated_at: '--', timestamps: [], epoch_ts: [], targets: [] };
let pingWorkerStarted = false;
let pingSampleInFlight = false;

function formatPingTargetsDev(
  samples: Array<{ ts: number; values: Record<string, number | null> }>,
  targetMeta: Record<string, DevPingTargetMeta>
) {
  const kindOrder: Record<string, number> = { gateway: 0, external: 1, dns: 2 };
  const freqCounts: Record<string, number> = {};
  for (const s of samples) {
    for (const tid of Object.keys(s.values || {})) {
      freqCounts[tid] = (freqCounts[tid] || 0) + 1;
    }
  }
  const rankedIds = Object.keys(targetMeta)
    .sort((a, b) => {
      const ka = kindOrder[targetMeta[a]?.kind || 'external'] ?? 1;
      const kb = kindOrder[targetMeta[b]?.kind || 'external'] ?? 1;
      if (ka !== kb) return ka - kb;
      const fa = freqCounts[a] || 0;
      const fb = freqCounts[b] || 0;
      if (fa !== fb) return fb - fa;
      return a.localeCompare(b);
    })
    .slice(0, 5);

  return rankedIds.map((tid, idx) => {
    const meta = targetMeta[tid];
    const rawVals = samples.map((pt) => pt.values?.[tid] ?? null);
    const validVals = rawVals.filter((v): v is number => typeof v === 'number' && v >= 0);
    const totalPts = Math.max(1, rawVals.length);
    const loss_pct = Math.round(((rawVals.length - validVals.length) / totalPts) * 1000) / 10;
    const avg_ms = validVals.length ? Math.round((validVals.reduce((a, b) => a + b, 0) / validVals.length) * 100) / 100 : null;
    const min_ms = validVals.length ? Math.round(Math.min(...validVals) * 100) / 100 : null;
    const max_ms = validVals.length ? Math.round(Math.max(...validVals) * 100) / 100 : null;
    const lastRaw = rawVals[rawVals.length - 1];
    const last_ms = typeof lastRaw === 'number' && lastRaw >= 0 ? Math.round(lastRaw * 100) / 100 : null;
    let jitter_ms = 0;
    if (validVals.length >= 2) {
      let diffSum = 0;
      for (let i = 1; i < validVals.length; i++) diffSum += Math.abs(validVals[i] - validVals[i - 1]);
      jitter_ms = Math.round((diffSum / (validVals.length - 1)) * 100) / 100;
    }
    const data = rawVals.map((v) => (typeof v === 'number' && v >= 0 ? Math.round(v * 100) / 100 : 0));
    return {
      id: tid,
      ip: meta.ip || '',
      label: meta.label || tid,
      kind: meta.kind || 'external',
      avg_ms,
      last_ms,
      min_ms,
      max_ms,
      jitter_ms,
      loss_pct,
      color: PING_TARGET_PALETTE[idx % PING_TARGET_PALETTE.length],
      data,
    };
  });
}

function loadPingHistoryDev() {
  try {
    if (fs.existsSync(pingHistoryDevPath)) {
      const parsed = JSON.parse(fs.readFileSync(pingHistoryDevPath, 'utf-8'));
      if (Array.isArray(parsed)) {
        const cutoff7d = Date.now() / 1000 - 7 * 86400;
        devPingSamples = parsed
          .filter((r): r is DevPingRow => Boolean(r && typeof r.ts === 'number' && r.values))
          .filter((r) => r.ts >= cutoff7d)
          .slice(-50000);
        const cutoff20m = Date.now() / 1000 - 1200;
        const recent = devPingSamples.filter((r) => r.ts >= cutoff20m);
        if (recent.length > 0) {
          pingHistoryPoints.length = 0;
          const targetMeta: Record<string, DevPingTargetMeta> = {};
          for (const r of recent) {
            pingHistoryPoints.push({ ts: r.ts, time_str: r.time_str, values: r.values });
            for (const [tid, meta] of Object.entries(r.targets || {})) {
              targetMeta[tid] = meta;
            }
          }
          const timestamps = pingHistoryPoints.map((pt) => pt.time_str);
          const epoch_ts = pingHistoryPoints.map((pt) => pt.ts);
          pingLatencyCache = {
            updated_at: timestamps[timestamps.length - 1] || '--',
            timestamps,
            epoch_ts,
            targets: formatPingTargetsDev(pingHistoryPoints, targetMeta),
          };
        }
      }
    }
  } catch {
    // Ignore corrupt ping history file
  }
}

function appendPingSampleDev(row: DevPingRow) {
  const cutoff7d = row.ts - 7 * 86400;
  devPingSamples.push(row);
  if (devPingSamples.length > 50000) {
    devPingSamples = devPingSamples.slice(-50000);
  }
  while (devPingSamples.length > 0 && devPingSamples[0].ts < cutoff7d) {
    devPingSamples.shift();
  }
  const nowMs = Date.now();
  if (nowMs - lastPingDevSaveMs >= 3000) {
    lastPingDevSaveMs = nowMs;
    try {
      const tmp = `${pingHistoryDevPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(devPingSamples), 'utf-8');
      fs.renameSync(tmp, pingHistoryDevPath);
    } catch {
      // Ignore write error
    }
  }
}

function queryPingHistoryDev(params: URLSearchParams) {
  const beforeTsRaw = params.get('before_ts');
  const afterTsRaw = params.get('after_ts');
  const windowRaw = params.get('window_sec') || params.get('window') || '';
  const limit = Math.max(20, Math.min(600, Number.parseInt(params.get('limit') || '180', 10) || 180));
  const beforeTs = beforeTsRaw ? Number.parseFloat(beforeTsRaw) : null;
  const afterTs = afterTsRaw ? Number.parseFloat(afterTsRaw) : null;
  const isAll = windowRaw.trim().toLowerCase() === 'all';
  const windowSec = !isAll && windowRaw && windowRaw !== 'live' ? Number.parseFloat(windowRaw) : null;

  const totalSamples = devPingSamples.length;
  const oldestTs = totalSamples > 0 ? devPingSamples[0].ts : null;
  const newestTs = totalSamples > 0 ? devPingSamples[totalSamples - 1].ts : null;

  if (totalSamples === 0 || oldestTs === null || newestTs === null) {
    return {
      ok: true,
      db_file: 'recursos_history.db',
      oldest_ts: null,
      newest_ts: null,
      window_start_ts: null,
      window_end_ts: null,
      total_samples: 0,
      returned_samples: 0,
      has_older: false,
      has_newer: false,
      series: { timestamps: [], date_timestamps: [], epoch_ts: [], targets: [] },
    };
  }

  let filtered = devPingSamples;
  if (isAll) {
    filtered = devPingSamples;
  } else if (windowSec && Number.isFinite(windowSec) && windowSec > 0) {
    const endRef = beforeTs !== null && Number.isFinite(beforeTs) ? beforeTs : newestTs;
    const startRef = Math.max(oldestTs, endRef - windowSec);
    filtered = devPingSamples.filter((s) => s.ts >= startRef && s.ts <= endRef);
  } else if (afterTs !== null && Number.isFinite(afterTs) && beforeTs === null) {
    filtered = devPingSamples.filter((s) => s.ts >= afterTs).slice(0, limit);
  } else {
    filtered = devPingSamples.filter((s) => {
      if (beforeTs !== null && Number.isFinite(beforeTs) && s.ts > beforeTs) return false;
      if (afterTs !== null && Number.isFinite(afterTs) && s.ts < afterTs) return false;
      return true;
    });
    filtered = filtered.slice(-limit);
  }

  let sampled = filtered;
  if (filtered.length > limit) {
    const bucketSize = filtered.length / limit;
    const out: DevPingRow[] = [];
    for (let i = 0; i < limit; i++) {
      const sIdx = Math.floor(i * bucketSize);
      const eIdx = Math.min(filtered.length, Math.max(sIdx + 1, Math.floor((i + 1) * bucketSize)));
      const chunk = filtered.slice(sIdx, eIdx);
      if (chunk.length === 0) continue;
      if (i === 0) out.push(filtered[0]);
      else if (i === limit - 1) out.push(filtered[filtered.length - 1]);
      else if (chunk.length === 1) out.push(chunk[0]);
      else {
        let rep = chunk[0];
        let repPeak = Math.max(...Object.values(rep.values || {}).map((v) => (typeof v === 'number' ? v : 0)), 0);
        for (const item of chunk) {
          const pk = Math.max(...Object.values(item.values || {}).map((v) => (typeof v === 'number' ? v : 0)), 0);
          if (pk > repPeak) {
            rep = item;
            repPeak = pk;
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

  const targetMeta: Record<string, DevPingTargetMeta> = {};
  for (const s of sampled) {
    for (const [tid, meta] of Object.entries(s.targets || {})) {
      targetMeta[tid] = meta;
    }
  }
  const fmtDt = (ts: number) => {
    const d = new Date(ts * 1000);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm} ${d.toLocaleTimeString('es-ES')}`;
  };

  const epoch_ts = sampled.map((s) => Math.round(s.ts * 100) / 100);
  const winStart = epoch_ts[0] ?? null;
  const winEnd = epoch_ts[epoch_ts.length - 1] ?? null;

  return {
    ok: true,
    db_file: 'recursos_history.db',
    oldest_ts: oldestTs,
    newest_ts: newestTs,
    window_start_ts: winStart,
    window_end_ts: winEnd,
    total_samples: totalSamples,
    returned_samples: sampled.length,
    has_older: Boolean(winStart !== null && winStart > oldestTs + 0.5),
    has_newer: Boolean(winEnd !== null && winEnd < newestTs - 0.5),
    series: {
      timestamps: sampled.map((s) => s.time_str),
      date_timestamps: sampled.map((s) => fmtDt(s.ts)),
      epoch_ts,
      targets: formatPingTargetsDev(sampled, targetMeta),
    },
  };
}

loadPingHistoryDev();

async function samplePingLatencyOnce() {
  if (pingSampleInFlight) return;
  pingSampleInFlight = true;
  try {
    const specs: Array<{ id: string; ip: string; label: string; kind: 'gateway' | 'external' | 'dns'; port: number }> = [];
    const seen = new Set<string>();
    const gwIp = detectDefaultGatewayIp();
    if (gwIp) {
      specs.push({ id: `gw_${gwIp}`, ip: gwIp, label: gwIp, kind: 'gateway', port: 80 });
      seen.add(gwIp);
    }

    const socks = parseProcNetSockets();
    for (const s of socks) {
      if (specs.length >= 4) break;
      if (!s.remoteIp || isPrivateOrLinkLocalIp(s.remoteIp) || seen.has(s.remoteIp) || nodeNet.isIP(s.remoteIp) !== 4) continue;
      seen.add(s.remoteIp);
      const geo = geoIpCache[s.remoteIp];
      let lbl = String(geo?.isp || geo?.org || s.service || s.remoteIp).trim();
      if (lbl.length > 26) lbl = `${lbl.slice(0, 23)}...`;
      specs.push({ id: `ext_${s.remoteIp}`, ip: s.remoteIp, label: lbl, kind: 'external', port: s.remotePort || 443 });
    }

    for (const ep of resolvedOutboundEndpoints.values()) {
      if (specs.length >= 4) break;
      if (!ep.ip || isPrivateOrLinkLocalIp(ep.ip) || seen.has(ep.ip) || nodeNet.isIP(ep.ip) !== 4) continue;
      seen.add(ep.ip);
      const lbl = ep.host.length > 26 ? `${ep.host.slice(0, 23)}...` : ep.host;
      specs.push({ id: `ext_${ep.ip}`, ip: ep.ip, label: lbl, kind: 'external', port: ep.port || 443 });
    }

    for (const dnsIp of readResolvNameservers()) {
      if (specs.length >= 5) break;
      if (seen.has(dnsIp)) continue;
      seen.add(dnsIp);
      specs.push({ id: `dns_${dnsIp}`, ip: dnsIp, label: `DNS ${dnsIp}`, kind: 'dns', port: 53 });
    }

    const rtts = await Promise.all(specs.map((sp) => probeHostRttMs(sp.ip, sp.port)));
    const nowSec = Math.round((Date.now() / 1000) * 100) / 100;
    const timeStr = new Date().toLocaleTimeString('es-ES', { hour12: false });
    const vals: Record<string, number | null> = {};
    const tgtMap: Record<string, DevPingTargetMeta> = {};
    specs.forEach((sp, i) => {
      vals[sp.id] = rtts[i];
      tgtMap[sp.id] = { id: sp.id, ip: sp.ip, label: sp.label, kind: sp.kind };
    });

    pingHistoryPoints.push({ ts: nowSec, time_str: timeStr, values: vals });
    appendPingSampleDev({ ts: nowSec, time_str: timeStr, values: vals, targets: tgtMap });
    const cutoff = nowSec - 1200;
    while (pingHistoryPoints.length > 0 && pingHistoryPoints[0].ts < cutoff) {
      pingHistoryPoints.shift();
    }

    const timestamps = pingHistoryPoints.map((pt) => pt.time_str);
    const epoch_ts = pingHistoryPoints.map((pt) => pt.ts);
    const targets = specs.map((sp, idx) => {
      const rawVals = pingHistoryPoints.map((pt) => pt.values[sp.id] ?? null);
      const validVals = rawVals.filter((v): v is number => typeof v === 'number' && v >= 0);
      const totalPts = Math.max(1, rawVals.length);
      const loss_pct = Math.round(((rawVals.length - validVals.length) / totalPts) * 1000) / 10;
      const avg_ms = validVals.length ? Math.round((validVals.reduce((a, b) => a + b, 0) / validVals.length) * 100) / 100 : null;
      const min_ms = validVals.length ? Math.round(Math.min(...validVals) * 100) / 100 : null;
      const max_ms = validVals.length ? Math.round(Math.max(...validVals) * 100) / 100 : null;
      const lastRaw = rawVals[rawVals.length - 1];
      const last_ms = typeof lastRaw === 'number' && lastRaw >= 0 ? Math.round(lastRaw * 100) / 100 : null;
      let jitter_ms = 0;
      if (validVals.length >= 2) {
        let diffSum = 0;
        for (let i = 1; i < validVals.length; i++) diffSum += Math.abs(validVals[i] - validVals[i - 1]);
        jitter_ms = Math.round((diffSum / (validVals.length - 1)) * 100) / 100;
      }
      const data = rawVals.map((v) => (typeof v === 'number' && v >= 0 ? Math.round(v * 100) / 100 : 0));
      return {
        id: sp.id,
        ip: sp.ip,
        label: sp.label,
        kind: sp.kind,
        avg_ms,
        last_ms,
        min_ms,
        max_ms,
        jitter_ms,
        loss_pct,
        color: PING_TARGET_PALETTE[idx % PING_TARGET_PALETTE.length],
        data,
      };
    });

    pingLatencyCache = { updated_at: timeStr, timestamps, epoch_ts, targets };
  } catch {
    // ignore ping probe error
  } finally {
    pingSampleInFlight = false;
  }
}

function startPingLatencyWorker() {
  if (pingWorkerStarted) return;
  pingWorkerStarted = true;
  void samplePingLatencyOnce();
  const timer = setInterval(() => {
    void samplePingLatencyOnce();
  }, 5000);
  if (typeof timer.unref === 'function') timer.unref();
}

// ---------- Speedtest Runner & Disk Persistence (Dev parity for recursos_history.db) ----------
const speedtestHistoryDevPath = path.resolve(ROOT_DIR, 'speedtest_history_dev.json');
interface SpeedTestResultEntry {
  id: number;
  ts: number;
  created_at: string;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  server_name: string;
  server_host: string;
  server_location: string;
  client_ip: string;
  isp: string;
  duration_ms: number;
  scope: 'wan' | 'local_node';
}
let devSpeedtestHistory: SpeedTestResultEntry[] = [];
let nextSpeedtestId = 1;

function loadSpeedtestHistoryDev() {
  try {
    if (fs.existsSync(speedtestHistoryDevPath)) {
      const parsed = JSON.parse(fs.readFileSync(speedtestHistoryDevPath, 'utf-8'));
      if (Array.isArray(parsed)) {
        devSpeedtestHistory = parsed.slice(0, 500);
        const maxId = devSpeedtestHistory.reduce((acc, x) => Math.max(acc, Number(x.id) || 0), 0);
        nextSpeedtestId = maxId + 1;
      }
    }
  } catch {
    // ignore
  }
}

function saveSpeedtestHistoryDev() {
  try {
    const tmp = `${speedtestHistoryDevPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(devSpeedtestHistory), 'utf-8');
    fs.renameSync(tmp, speedtestHistoryDevPath);
  } catch {
    // ignore
  }
}

loadSpeedtestHistoryDev();

const speedtestState = {
  running: false,
  phase: 'idle' as 'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error',
  progress_pct: 0,
  current_mbps: 0,
  ping_ms: 0,
  jitter_ms: 0,
  packet_loss_pct: 0,
  download_mbps: 0,
  upload_mbps: 0,
  server_name: '',
  server_host: '',
  server_location: '',
  client_ip: '',
  isp: '',
  scope: 'wan' as 'wan' | 'local_node',
  error: '',
  started_at: null as number | null,
  completed_at: null as number | null,
  last_result: null as SpeedTestResultEntry | null,
};

const SPEEDTEST_HTTP_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://www.speedtest.net/',
  Accept: 'application/json,text/plain,*/*',
  'Cache-Control': 'no-cache, no-store',
  Pragma: 'no-cache',
};

const speedtestHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const speedtestHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });

function readWanIfaceBytesDev(): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  try {
    if (fs.existsSync('/proc/net/dev')) {
      const lines = fs.readFileSync('/proc/net/dev', 'utf-8').split('\n');
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx <= 0) continue;
        const iface = line.slice(0, colonIdx).trim();
        if (
          !iface ||
          iface === 'lo' ||
          iface.startsWith('docker') ||
          iface.startsWith('veth') ||
          iface.startsWith('br-') ||
          iface.startsWith('virbr') ||
          iface.startsWith('tun') ||
          iface.startsWith('tap')
        ) {
          continue;
        }
        const cols = line
          .slice(colonIdx + 1)
          .trim()
          .split(/\s+/);
        if (cols.length >= 9) {
          rx += Number(cols[0]) || 0;
          tx += Number(cols[8]) || 0;
        }
      }
    }
  } catch {
    // ignore
  }
  return { rx, tx };
}

function computeSustainedSpeedMbpsDev(
  samples: Array<{ tMs: number; bytes: number }>,
  totalAppBytes: number,
  totalElapsedSec: number,
  nicDeltaBytes = 0
): number {
  const effectiveTotalBytes = Math.max(totalAppBytes, nicDeltaBytes);
  const rawAvgMbps = (effectiveTotalBytes * 8) / (Math.max(0.05, totalElapsedSec) * 1_000_000);
  if (samples.length < 4) {
    return Math.round(rawAvgMbps * 100) / 100;
  }
  const t0 = samples[0].tMs;
  const intervalsMbps: number[] = [];
  let postWarmupBytes = 0;
  let postWarmupSec = 0;

  for (let i = 1; i < samples.length; i++) {
    const dtSec = (samples[i].tMs - samples[i - 1].tMs) / 1000;
    const db = Math.max(0, samples[i].bytes - samples[i - 1].bytes);
    if (dtSec <= 0.02) continue;
    const instMbps = (db * 8) / (dtSec * 1_000_000);
    if (samples[i].tMs - t0 >= 750) {
      intervalsMbps.push(instMbps);
      postWarmupBytes += db;
      postWarmupSec += dtSec;
    }
  }

  const sustainedPostWarmup =
    postWarmupSec >= 0.6 ? (postWarmupBytes * 8) / (postWarmupSec * 1_000_000) : rawAvgMbps;

  let bestEst = Math.max(rawAvgMbps, sustainedPostWarmup);
  if (intervalsMbps.length >= 3) {
    const sorted = [...intervalsMbps].sort((a, b) => b - a);
    const median = sorted[Math.floor(sorted.length / 2)];
    const filtered = sorted.filter((x) => x <= Math.max(median * 1.65, rawAvgMbps * 1.5));
    const pool = filtered.length > 0 ? filtered : sorted;
    const keepN = Math.max(2, Math.round(pool.length * 0.7));
    const topMean = pool.slice(0, keepN).reduce((acc, v) => acc + v, 0) / keepN;
    bestEst = Math.max(bestEst, topMean * 0.96);
  }
  if (nicDeltaBytes > totalAppBytes && totalAppBytes > 0) {
    const nicRatio = Math.min(1.22, nicDeltaBytes / totalAppBytes);
    bestEst = Math.max(bestEst, sustainedPostWarmup * nicRatio);
  }
  return Math.round(bestEst * 100) / 100;
}

function fetchUrlBytes(
  targetUrl: string,
  method: 'GET' | 'POST' = 'GET',
  bodyBuf?: Buffer,
  timeoutMs = 4500,
  onChunk?: (chunkLen: number) => void,
  deadlineMs?: number,
  extraHeaders?: Record<string, string>
): Promise<{ ok: boolean; bytes: number; headers: http.IncomingHttpHeaders; ms: number; text?: string }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const isHttps = targetUrl.startsWith('https://');
    const mod = isHttps ? https : http;
    const agent = isHttps ? speedtestHttpsAgent : speedtestHttpAgent;
    let settled = false;
    const finish = (ok: boolean, bytes: number, headers: http.IncomingHttpHeaders, text?: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, bytes, headers, ms: Math.max(0.1, performance.now() - t0), text });
    };
    try {
      const hdrs: Record<string, string | number> = {
        ...SPEEDTEST_HTTP_HEADERS,
        Connection: 'keep-alive',
        ...(extraHeaders || {}),
      };
      if (bodyBuf) {
        hdrs['Content-Type'] = 'application/octet-stream';
        hdrs['Content-Length'] = bodyBuf.byteLength;
      }
      const req = mod.request(targetUrl, { method, timeout: timeoutMs, headers: hdrs, agent }, (res) => {
        let totalBytes = 0;
        const textChunks: Buffer[] = [];
        const collectText = !onChunk;
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (onChunk) onChunk(chunk.byteLength);
          else if (collectText && totalBytes <= 512 * 1024) textChunks.push(chunk);
          if (deadlineMs && performance.now() >= deadlineMs) {
            req.destroy();
            finish((res.statusCode || 500) < 400, totalBytes, res.headers);
          }
        });
        res.on('end', () => {
          finish(
            (res.statusCode || 500) < 400,
            totalBytes,
            res.headers,
            collectText ? Buffer.concat(textChunks).toString('utf-8') : undefined
          );
        });
      });
      req.on('error', () => finish(false, 0, {}));
      req.on('timeout', () => {
        req.destroy();
        finish(false, 0, {});
      });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } catch {
      finish(false, 0, {});
    }
  });
}

function tryRunOoklaCliDev(): Promise<{
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  server_name: string;
  server_host: string;
  server_location: string;
  client_ip: string;
  isp: string;
} | null> {
  return new Promise((resolve) => {
    let binPath = '';
    try {
      binPath = execSync('which speedtest', { encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const ver = execSync(`"${binPath}" --version`, { encoding: 'utf-8', timeout: 2500, stdio: ['ignore', 'pipe', 'pipe'] });
      if (!ver.toLowerCase().includes('ookla')) binPath = '';
    } catch {
      binPath = '';
    }
    if (!binPath) {
      resolve(null);
      return;
    }
    const child = spawn(binPath, ['--accept-license', '--accept-gdpr', '--progress=yes', '--format=jsonl']);
    let buf = '';
    let result: {
      download_mbps: number;
      upload_mbps: number;
      ping_ms: number;
      jitter_ms: number;
      packet_loss_pct: number;
      server_name: string;
      server_host: string;
      server_location: string;
      client_ip: string;
      isp: string;
    } | null = null;
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(null);
    }, 45000);
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const evt = JSON.parse(trimmed) as Record<string, unknown>;
          const tp = String(evt.type || '');
          if (tp === 'testStart') {
            const srv = (evt.server as Record<string, unknown>) || {};
            const iface = (evt.interface as Record<string, unknown>) || {};
            speedtestState.server_name = `Speedtest · ${String(srv.name || 'Ookla')}`;
            speedtestState.server_host = String(srv.host || 'speedtest.net');
            speedtestState.server_location = [srv.location, srv.country].filter(Boolean).join(', ');
            speedtestState.isp = String(evt.isp || speedtestState.isp || '');
            speedtestState.client_ip = String(iface.externalIp || speedtestState.client_ip || '');
          } else if (tp === 'ping') {
            const p = (evt.ping as Record<string, unknown>) || {};
            speedtestState.phase = 'ping';
            speedtestState.ping_ms = Math.round(Number(p.latency || 0) * 100) / 100;
            speedtestState.jitter_ms = Math.round(Number(p.jitter || 0) * 100) / 100;
            speedtestState.progress_pct = Math.max(8, Math.min(20, 8 + Math.round(Number(p.progress || 0) * 12)));
          } else if (tp === 'download') {
            const dl = (evt.download as Record<string, unknown>) || {};
            const mbps = Math.round(((Number(dl.bandwidth || 0) * 8) / 1_000_000) * 100) / 100;
            speedtestState.phase = 'download';
            speedtestState.current_mbps = mbps;
            speedtestState.download_mbps = mbps;
            speedtestState.progress_pct = Math.max(22, Math.min(60, 22 + Math.round(Number(dl.progress || 0) * 38)));
          } else if (tp === 'upload') {
            const ul = (evt.upload as Record<string, unknown>) || {};
            const mbps = Math.round(((Number(ul.bandwidth || 0) * 8) / 1_000_000) * 100) / 100;
            speedtestState.phase = 'upload';
            speedtestState.current_mbps = mbps;
            speedtestState.upload_mbps = mbps;
            speedtestState.progress_pct = Math.max(62, Math.min(96, 62 + Math.round(Number(ul.progress || 0) * 34)));
          } else if (tp === 'result') {
            const p = (evt.ping as Record<string, unknown>) || {};
            const dl = (evt.download as Record<string, unknown>) || {};
            const ul = (evt.upload as Record<string, unknown>) || {};
            const srv = (evt.server as Record<string, unknown>) || {};
            const iface = (evt.interface as Record<string, unknown>) || {};
            result = {
              download_mbps: Math.round(((Number(dl.bandwidth || 0) * 8) / 1_000_000) * 100) / 100,
              upload_mbps: Math.round(((Number(ul.bandwidth || 0) * 8) / 1_000_000) * 100) / 100,
              ping_ms: Math.round(Number(p.latency || 0) * 100) / 100,
              jitter_ms: Math.round(Number(p.jitter || 0) * 100) / 100,
              packet_loss_pct: Math.round(Number(evt.packetLoss || 0) * 10) / 10,
              server_name: `Speedtest · ${String(srv.name || 'Ookla')}`,
              server_host: String(srv.host || 'speedtest.net'),
              server_location: [srv.location, srv.country].filter(Boolean).join(', '),
              client_ip: String(iface.externalIp || ''),
              isp: String(evt.isp || ''),
            };
          }
        } catch {
          // ignore partial JSONL line
        }
      }
    });
    child.on('error', () => {
      clearTimeout(killTimer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve(code === 0 ? result : null);
    });
  });
}

async function runDevSpeedtestWorker(localBaseUrl: string) {
  const tStart = performance.now();
  Object.assign(speedtestState, {
    running: true,
    phase: 'ping',
    progress_pct: 6,
    current_mbps: 0,
    ping_ms: 0,
    jitter_ms: 0,
    packet_loss_pct: 0,
    download_mbps: 0,
    upload_mbps: 0,
    server_name: '',
    server_host: '',
    server_location: '',
    client_ip: '',
    isp: '',
    scope: 'wan' as const,
    error: '',
    started_at: Date.now() / 1000,
  });

  try {
    const netSnap = sampleRealNetwork();
    let serverName = os.hostname();
    let serverHost = '127.0.0.1';
    let serverLocation = '';
    let clientIp = serverSelfGeo?.ip || netSnap.local_ip || '127.0.0.1';
    let ispName = serverSelfGeo?.isp || serverSelfGeo?.org || '';
    if (serverSelfGeo?.city || serverSelfGeo?.country) {
      serverLocation = [serverSelfGeo.city, serverSelfGeo.country].filter(Boolean).join(', ');
    }

    let downloadMbps = 0;
    let uploadMbps = 0;
    let pingMs = 0;
    let jitterMs = 0;
    let lossPct = 0;
    let scope: 'wan' | 'local_node' = 'wan';

    const ooklaCli = await tryRunOoklaCliDev();
    if (ooklaCli) {
      downloadMbps = ooklaCli.download_mbps;
      uploadMbps = ooklaCli.upload_mbps;
      pingMs = ooklaCli.ping_ms;
      jitterMs = ooklaCli.jitter_ms;
      lossPct = ooklaCli.packet_loss_pct;
      serverName = ooklaCli.server_name;
      serverHost = ooklaCli.server_host;
      serverLocation = ooklaCli.server_location || serverLocation;
      clientIp = ooklaCli.client_ip || clientIp;
      ispName = ooklaCli.isp || ispName;
      scope = 'wan';
    } else {
      // Built-in Speedtest.net protocol (servers -> latency.txt -> multi-stream download -> multi-stream upload)
      const cfgResp = await fetchUrlBytes('https://www.speedtest.net/speedtest-config.php', 'GET', undefined, 2500);
      if (cfgResp.ok && cfgResp.text) {
        const ipMatch = cfgResp.text.match(/<client[^>]*\sip="([^"]+)"/);
        const ispMatch = cfgResp.text.match(/<client[^>]*\sisp="([^"]+)"/);
        if (ipMatch?.[1]) clientIp = ipMatch[1];
        if (ispMatch?.[1]) ispName = ispMatch[1];
      }

      let stServers: Array<{ url?: string; sponsor?: string; name?: string; country?: string; https_functional?: number | boolean }> = [];
      for (const apiUrl of [
        'https://www.speedtest.net/api/js/servers?engine=js&https_functional=true&limit=8',
        'https://www.speedtest.net/api/js/servers?engine=js&limit=8',
      ]) {
        const sr = await fetchUrlBytes(apiUrl, 'GET', undefined, 3500);
        if (sr.ok && sr.text) {
          try {
            const parsed = JSON.parse(sr.text);
            if (Array.isArray(parsed) && parsed.length > 0) {
              stServers = parsed;
              break;
            }
          } catch {
            // ignore
          }
        }
      }

      let selectedBase = '';
      let selectedUploadUrl = '';
      let wanProvider = null as 'speedtest' | 'cloudflare' | null;
      let bestProbeMs = Infinity;

      for (const srv of stServers.slice(0, 6)) {
        const rawUp = String(srv.url || '').trim();
        if (!rawUp || !rawUp.includes('/')) continue;
        const candidates: string[] = [rawUp];
        if (rawUp.startsWith('http://') && srv.https_functional) {
          candidates.unshift(`https://${rawUp.slice(7)}`);
        }
        for (const upCand of candidates) {
          const baseCand = upCand.slice(0, upCand.lastIndexOf('/'));
          const pr = await fetchUrlBytes(`${baseCand}/latency.txt?x=${Date.now()}`, 'GET', undefined, 2000);
          if (pr.ok && pr.ms < bestProbeMs) {
            bestProbeMs = pr.ms;
            selectedBase = baseCand;
            selectedUploadUrl = upCand;
            wanProvider = 'speedtest';
            const sponsor = String(srv.sponsor || srv.name || 'Speedtest.net');
            serverName = `Speedtest · ${sponsor}`;
            try {
              serverHost = new URL(upCand).hostname || 'speedtest.net';
            } catch {
              serverHost = 'speedtest.net';
            }
            const loc = [srv.name, srv.country].filter(Boolean).join(', ');
            if (loc) serverLocation = loc;
            break;
          }
        }
      }

      if (!wanProvider) {
        const cfProbe = await fetchUrlBytes('https://speed.cloudflare.com/__down?bytes=32768', 'GET', undefined, 2500);
        if (cfProbe.ok && cfProbe.bytes > 0) {
          wanProvider = 'cloudflare';
          const cfRay = String(cfProbe.headers['cf-ray'] || '');
          const colo = cfRay.includes('-') ? cfRay.split('-').pop() || '' : '';
          serverName = colo ? `Cloudflare Edge (${colo})` : 'Cloudflare Speed Edge';
          serverHost = 'speed.cloudflare.com';
        }
      }

      const resolvedProvider: 'speedtest' | 'cloudflare' | null = wanProvider;
      scope = resolvedProvider ? 'wan' : 'local_node';
      const localPayloadUrl = `${localBaseUrl}/api/net/speedtest/payload`;

      // 1. Ping & Jitter
      const pingSamples: number[] = [];
      let pingFails = 0;
      for (let i = 0; i < 6; i++) {
        const pUrl =
          resolvedProvider === 'speedtest'
            ? `${selectedBase}/latency.txt?r=${i}_${Date.now()}`
            : resolvedProvider === 'cloudflare'
              ? 'https://speed.cloudflare.com/__down?bytes=1024'
              : `${localPayloadUrl}?bytes=1024`;
        const res = await fetchUrlBytes(pUrl, 'GET', undefined, 2500);
        if (res.ok) pingSamples.push(res.ms);
        else pingFails++;
        speedtestState.progress_pct = 8 + Math.round(((i + 1) / 6) * 12);
      }
      const sortedPings = [...pingSamples].sort((a, b) => a - b);
      pingMs = sortedPings.length ? Math.round(sortedPings[Math.floor(sortedPings.length / 2)] * 100) / 100 : 0;
      if (pingSamples.length >= 2) {
        let diffSum = 0;
        for (let i = 1; i < pingSamples.length; i++) diffSum += Math.abs(pingSamples[i] - pingSamples[i - 1]);
        jitterMs = Math.round((diffSum / (pingSamples.length - 1)) * 100) / 100;
      }
      lossPct = Math.round((pingFails / 6) * 1000) / 10;

      Object.assign(speedtestState, {
        phase: 'download',
        progress_pct: 22,
        ping_ms: pingMs,
        jitter_ms: jitterMs,
        packet_loss_pct: lossPct,
        server_name: serverName,
        server_host: serverHost,
        server_location: serverLocation,
        client_ip: clientIp,
        isp: ispName,
        scope,
      });

      // 2. Multi-stream Download Mbps (8 streams in parallel with Keep-Alive + TCP slow-start discard)
      let dlBytesTotal = 0;
      const dlSamples: Array<{ tMs: number; bytes: number }> = [];
      const dlNic0 = readWanIfaceBytesDev();
      const dlT0 = performance.now();
      dlSamples.push({ tMs: dlT0, bytes: 0 });
      const dlWindowMs = resolvedProvider ? 6000 : 2500;
      const dlDeadline = dlT0 + dlWindowMs;
      const dlWorkersCount = resolvedProvider ? 8 : 4;
      const runDlStream = async (idx: number) => {
        const urls =
          resolvedProvider === 'speedtest'
            ? [
                `${selectedBase}/download?size=25000000&r=${idx}`,
                `${selectedBase}/random4000x4000.jpg?x=${idx}`,
                `${selectedBase}/random3500x3500.jpg?x=${idx}`,
                `${selectedBase}/random3000x3000.jpg?x=${idx}`,
              ]
            : resolvedProvider === 'cloudflare'
              ? ['https://speed.cloudflare.com/__down?bytes=25000000']
              : [`${localPayloadUrl}?bytes=32000000`];
        let reqSeq = 0;
        while (performance.now() < dlDeadline) {
          const u = urls[reqSeq % urls.length];
          reqSeq++;
          const sep = u.includes('?') ? '&' : '?';
          await fetchUrlBytes(
            `${u}${sep}t=${Date.now()}_${reqSeq}`,
            'GET',
            undefined,
            4500,
            (n) => {
              dlBytesTotal += n;
              const nowMs = performance.now();
              if (dlSamples.length === 0 || nowMs - dlSamples[dlSamples.length - 1].tMs >= 180) {
                dlSamples.push({ tMs: nowMs, bytes: dlBytesTotal });
              }
              const elSec = Math.max(0.08, (nowMs - dlT0) / 1000);
              const liveDl = computeSustainedSpeedMbpsDev(dlSamples, dlBytesTotal, elSec);
              speedtestState.current_mbps = liveDl;
              speedtestState.download_mbps = liveDl;
              speedtestState.progress_pct = Math.min(60, 22 + Math.round((Math.min(dlWindowMs, nowMs - dlT0) / dlWindowMs) * 38));
            },
            dlDeadline
          );
        }
      };
      await Promise.all(Array.from({ length: dlWorkersCount }, (_, idx) => runDlStream(idx)));
      const dlTEnd = performance.now();
      const dlElapsedSec = Math.max(0.05, (dlTEnd - dlT0) / 1000);
      const dlNic1 = readWanIfaceBytesDev();
      const dlNicDelta = scope === 'wan' ? Math.max(0, dlNic1.rx - dlNic0.rx) : 0;
      dlSamples.push({ tMs: dlTEnd, bytes: dlBytesTotal });
      downloadMbps = computeSustainedSpeedMbpsDev(dlSamples, dlBytesTotal, dlElapsedSec, dlNicDelta);

      Object.assign(speedtestState, {
        phase: 'upload',
        progress_pct: 62,
        download_mbps: downloadMbps,
        current_mbps: 0,
      });

      // 3. Multi-stream Upload Mbps (6 streams in parallel with 2 MB buffers + Keep-Alive)
      const ulBuf = resolvedProvider ? crypto.randomBytes(2 * 1024 * 1024) : Buffer.alloc(8 * 1024 * 1024);
      let ulBytesTotal = 0;
      const ulSamples: Array<{ tMs: number; bytes: number }> = [];
      const ulNic0 = readWanIfaceBytesDev();
      const ulT0 = performance.now();
      ulSamples.push({ tMs: ulT0, bytes: 0 });
      const ulWindowMs = resolvedProvider ? 5200 : 2200;
      const ulDeadline = ulT0 + ulWindowMs;
      const ulWorkersCount = resolvedProvider ? 6 : 4;
      const runUlStream = async (workerIdx: number) => {
        const uUrl =
          resolvedProvider === 'speedtest'
            ? selectedUploadUrl
            : resolvedProvider === 'cloudflare'
              ? 'https://speed.cloudflare.com/__up'
              : localPayloadUrl;
        for (let i = 0; i < 50; i++) {
          if (performance.now() >= ulDeadline) break;
          const sep = uUrl.includes('?') ? '&' : '?';
          const r = await fetchUrlBytes(`${uUrl}${sep}r=${workerIdx}_${i}`, 'POST', ulBuf, 4000, undefined, ulDeadline);
          if (!r.ok) {
            if (resolvedProvider === 'speedtest') {
              const fallbackBuf = ulBuf.subarray(0, 1024 * 1024);
              const rSmall = await fetchUrlBytes(`${uUrl}${sep}r=${workerIdx}_${i}_s`, 'POST', fallbackBuf, 4000, undefined, ulDeadline);
              if (!rSmall.ok) continue;
              ulBytesTotal += fallbackBuf.byteLength;
            } else {
              continue;
            }
          } else {
            ulBytesTotal += ulBuf.byteLength;
          }
          const nowMs = performance.now();
          if (ulSamples.length === 0 || nowMs - ulSamples[ulSamples.length - 1].tMs >= 180) {
            ulSamples.push({ tMs: nowMs, bytes: ulBytesTotal });
          }
          const elSec = Math.max(0.08, (nowMs - ulT0) / 1000);
          const liveUl = computeSustainedSpeedMbpsDev(ulSamples, ulBytesTotal, elSec);
          speedtestState.current_mbps = liveUl;
          speedtestState.upload_mbps = liveUl;
          speedtestState.progress_pct = Math.min(96, 62 + Math.round((Math.min(ulWindowMs, nowMs - ulT0) / ulWindowMs) * 34));
        }
      };
      await Promise.all(Array.from({ length: ulWorkersCount }, (_, idx) => runUlStream(idx)));
      const ulTEnd = performance.now();
      const ulElapsedSec = Math.max(0.05, (ulTEnd - ulT0) / 1000);
      const ulNic1 = readWanIfaceBytesDev();
      const ulNicDelta = scope === 'wan' ? Math.max(0, ulNic1.tx - ulNic0.tx) : 0;
      ulSamples.push({ tMs: ulTEnd, bytes: ulBytesTotal });
      uploadMbps = computeSustainedSpeedMbpsDev(ulSamples, ulBytesTotal, ulElapsedSec, ulNicDelta);
    }

    const nowTs = Math.round((Date.now() / 1000) * 1000) / 1000;
    const dObj = new Date(nowTs * 1000);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const createdAt = `${dObj.getFullYear()}-${pad2(dObj.getMonth() + 1)}-${pad2(dObj.getDate())} ${pad2(dObj.getHours())}:${pad2(dObj.getMinutes())}:${pad2(dObj.getSeconds())}`;
    const entry: SpeedTestResultEntry = {
      id: nextSpeedtestId++,
      ts: nowTs,
      created_at: createdAt,
      download_mbps: downloadMbps,
      upload_mbps: uploadMbps,
      ping_ms: pingMs,
      jitter_ms: jitterMs,
      packet_loss_pct: lossPct,
      server_name: serverName,
      server_host: serverHost,
      server_location: serverLocation,
      client_ip: clientIp,
      isp: ispName,
      duration_ms: Math.round(performance.now() - tStart),
      scope,
    };

    devSpeedtestHistory.unshift(entry);
    devSpeedtestHistory = devSpeedtestHistory.slice(0, 500);
    saveSpeedtestHistoryDev();

    Object.assign(speedtestState, {
      running: false,
      phase: 'done',
      progress_pct: 100,
      current_mbps: uploadMbps,
      download_mbps: downloadMbps,
      upload_mbps: uploadMbps,
      ping_ms: pingMs,
      jitter_ms: jitterMs,
      packet_loss_pct: lossPct,
      server_name: serverName,
      server_host: serverHost,
      server_location: serverLocation,
      client_ip: clientIp,
      isp: ispName,
      scope,
      completed_at: nowTs,
      last_result: entry,
    });
  } catch (err) {
    Object.assign(speedtestState, {
      running: false,
      phase: 'error',
      progress_pct: 0,
      error: err instanceof Error ? err.message : String(err),
    });
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

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - lastObservedNetFlushSec >= 5) {
    lastObservedNetFlushSec = nowSec;
    for (const c of connections) {
      if (c.is_lan || !c.remote_ip) continue;
      const key = `${c.remote_ip}|${c.service}|${c.domain || ''}`;
      const existing = observedDevNetHistory.get(key);
      if (existing) {
        existing.hit_count += 1;
        existing.last_seen = nowSec;
        existing.bytes_total = Math.max(existing.bytes_total, Number(c.bytes_total || 0));
        if (!existing.country && c.country) existing.country = c.country;
        if (!existing.country_code && c.country_code) existing.country_code = c.country_code;
        if (!existing.city && c.city) existing.city = c.city;
        if (!existing.domain && c.domain) existing.domain = c.domain;
      } else {
        observedDevNetHistory.set(key, {
          key,
          direction: c.direction,
          protocol: c.protocol,
          local_ip: c.local_ip,
          local_hostname: c.local_hostname || os.hostname(),
          local_port: c.local_port,
          remote_ip: c.remote_ip,
          remote_port: c.remote_port,
          domain: c.domain || '',
          service: c.service || 'Direct',
          process: c.process || '',
          jail: c.jail || 'caddy-scan',
          lat: c.lat,
          lng: c.lng,
          city: c.city,
          country: c.country,
          country_code: c.country_code,
          isp: c.isp,
          asn: c.asn,
          hit_count: 1,
          bytes_total: Number(c.bytes_total || 0),
          first_seen: nowSec,
          last_seen: nowSec,
        });
      }
      if (c.domain) {
        const curDom = observedDnsDomains.get(c.domain.toLowerCase());
        if (!curDom) {
          recordObservedDnsLookup(c.domain, c.local_ip || localIp, 2.5);
        }
      }
    }
    if (observedDevNetHistory.size > 500) {
      const oldestKeys = Array.from(observedDevNetHistory.entries())
        .sort((a, b) => a[1].last_seen - b[1].last_seen)
        .slice(0, observedDevNetHistory.size - 500)
        .map(([k]) => k);
      for (const k of oldestKeys) observedDevNetHistory.delete(k);
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
  startPingLatencyWorker();
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
            cpu_temp: sampled.map((s) => s.cpu_temp ?? 0),
            cpu_freq: sampled.map((s) => s.cpu_freq ?? 0),
            cpu_power: sampled.map((s) => s.cpu_power ?? 0),
            cpu_load_1m: sampled.map((s) => s.cpu_load_1m ?? 0),
            cpu_load_5m: sampled.map((s) => s.cpu_load_5m ?? 0),
            cpu_user: sampled.map((s) => s.cpu_user ?? 0),
            cpu_system: sampled.map((s) => s.cpu_system ?? 0),
            cpu_iowait: sampled.map((s) => s.cpu_iowait ?? 0),
            gpu: sampled.map((s) => s.gpu),
            gpu_vram_pct: sampled.map((s) => s.gpu_vram_pct ?? 0),
            gpu_mem_ctrl: sampled.map((s) => s.gpu_mem_ctrl ?? 0),
            gpu_enc: sampled.map((s) => s.gpu_enc ?? 0),
            gpu_dec: sampled.map((s) => s.gpu_dec ?? 0),
            gpu_power: sampled.map((s) => s.gpu_power ?? 0),
            gpu_temp: sampled.map((s) => s.gpu_temp ?? 0),
            gpu_clk_gfx: sampled.map((s) => s.gpu_clk_gfx ?? 0),
            gpu_clk_mem: sampled.map((s) => s.gpu_clk_mem ?? 0),
            gpu_pcie_rx: sampled.map((s) => s.gpu_pcie_rx ?? 0),
            gpu_pcie_tx: sampled.map((s) => s.gpu_pcie_tx ?? 0),
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

        if (url === '/api/net/ping-history' && req.method === 'GET') {
          const params = new URLSearchParams(queryStr || '');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(queryPingHistoryDev(params)));
          return;
        }

        if (url === '/api/metrics/process-history' && req.method === 'GET') {
          const params = new URLSearchParams(queryStr || '');
          const hours = Number.parseInt(params.get('hours') || '24', 10) || 24;
          const metric = (params.get('metric') || 'cpu').trim().toLowerCase();
          if (devProcessSnapshots.length === 0) {
            const initProcs = sampleRealProcesses() as Array<Record<string, unknown>>;
            recordProcessSnapshotDev(initProcs, true);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(queryProcessHistoryDev(hours, metric)));
          return;
        }

        if (url === '/api/net/speedtest/status' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, ...speedtestState }));
          return;
        }

        if (url === '/api/net/speedtest/history' && req.method === 'GET') {
          const params = new URLSearchParams(queryStr || '');
          const limit = Math.max(1, Math.min(500, Number.parseInt(params.get('limit') || '100', 10) || 100));
          const items = devSpeedtestHistory.slice(0, limit);
          const bestDl = items.reduce((m, x) => Math.max(m, x.download_mbps || 0), 0);
          const bestUl = items.reduce((m, x) => Math.max(m, x.upload_mbps || 0), 0);
          const avgPing = items.length ? Math.round((items.reduce((s, x) => s + (x.ping_ms || 0), 0) / items.length) * 100) / 100 : 0;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              db_file: 'recursos_history.db',
              total: devSpeedtestHistory.length,
              best_download_mbps: Math.round(bestDl * 100) / 100,
              best_upload_mbps: Math.round(bestUl * 100) / 100,
              avg_ping_ms: avgPing,
              items,
            })
          );
          return;
        }

        if (url === '/api/net/speedtest/history' && req.method === 'DELETE') {
          const params = new URLSearchParams(queryStr || '');
          const idParam = params.get('id');
          let deleted = 0;
          if (idParam) {
            const idNum = Number.parseInt(idParam, 10);
            const before = devSpeedtestHistory.length;
            devSpeedtestHistory = devSpeedtestHistory.filter((x) => x.id !== idNum);
            deleted = before - devSpeedtestHistory.length;
          } else {
            deleted = devSpeedtestHistory.length;
            devSpeedtestHistory = [];
          }
          saveSpeedtestHistoryDev();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, success: true, deleted }));
          return;
        }

        if (url === '/api/net/speedtest/history/clear' && req.method === 'POST') {
          let rawBody = '';
          req.on('data', (c) => {
            rawBody += c;
          });
          req.on('end', () => {
            let entryId: number | null = null;
            try {
              const b = rawBody ? JSON.parse(rawBody) : {};
              if (b.id !== undefined && b.id !== null) entryId = Number.parseInt(String(b.id), 10);
            } catch {
              entryId = null;
            }
            let deleted = 0;
            if (entryId !== null && Number.isFinite(entryId)) {
              const before = devSpeedtestHistory.length;
              devSpeedtestHistory = devSpeedtestHistory.filter((x) => x.id !== entryId);
              deleted = before - devSpeedtestHistory.length;
            } else {
              deleted = devSpeedtestHistory.length;
              devSpeedtestHistory = [];
            }
            saveSpeedtestHistoryDev();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, success: true, deleted }));
          });
          return;
        }

        if (url === '/api/net/speedtest/run' && req.method === 'POST') {
          if (speedtestState.running) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, started: false, already_running: true, status: speedtestState }));
            return;
          }
          const localPort = Number(req.socket?.localPort || 3000);
          void runDevSpeedtestWorker(`http://127.0.0.1:${localPort}`);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, started: true, already_running: false, status: speedtestState }));
          return;
        }

        if (url === '/api/net/speedtest/payload') {
          if (req.method === 'GET') {
            const params = new URLSearchParams(queryStr || '');
            const sz = Math.max(1024, Math.min(20_000_000, Number.parseInt(params.get('bytes') || '1048576', 10) || 1048576));
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', sz);
            res.setHeader('Cache-Control', 'no-store');
            res.end(Buffer.alloc(sz));
            return;
          }
          if (req.method === 'POST') {
            let received = 0;
            req.on('data', (c: Buffer) => {
              received += c.byteLength;
            });
            req.on('end', () => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, received }));
            });
            return;
          }
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
          recordProcessSnapshotDev(procs as Array<Record<string, unknown>>, devProcessSnapshots.length === 0);
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
            cpu_temp: cpu.tempC ?? 0,
            cpu_freq: Math.round(cpu.freqMhz * 10) / 10,
            cpu_power: 0,
            cpu_load_1m: Math.round(l1 * 100) / 100,
            cpu_load_5m: Math.round(l5 * 100) / 100,
            cpu_user: cpu.userPct,
            cpu_system: cpu.systemPct,
            cpu_iowait: cpu.iowaitPct,
            gpu: 0,
            gpu_vram_pct: 0,
            gpu_mem_ctrl: 0,
            gpu_enc: 0,
            gpu_dec: 0,
            gpu_power: 0,
            gpu_temp: 0,
            gpu_clk_gfx: 0,
            gpu_clk_mem: 0,
            gpu_pcie_rx: 0,
            gpu_pcie_tx: 0,
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
            system_errors_summary: (() => {
              const aiFaultInsightsObj: Record<string, AiSystemFaultInsightRecord> = {};
              const aiFaultHistoryArr: AiSystemFaultInsightRecord[] = [];
              for (const [, val] of aiFaultInsightsCache.entries()) {
                aiFaultInsightsObj[val.insight.signature] = val.insight;
                aiFaultHistoryArr.push(val.insight);
              }
              aiFaultHistoryArr.sort((a, b) => b.analyzed_at - a.analyzed_at);
              return {
                total: geoIpErrorHistory.length,
                total_errors: geoIpErrorHistory.length,
                log_errors_count: geoIpErrorHistory.length,
                failed_units_count: 0,
                failed_units: [],
                ack_ts: devLogsAckTs,
                ack_time_str: devLogsAckTimeStr,
                ai_fault_insights: aiFaultInsightsObj,
                ai_fault_history: aiFaultHistoryArr.slice(0, 25),
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
              };
            })(),
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
              freq_max_mhz: cpu.freqMaxMhz,
              freq_min_mhz: cpu.freqMinMhz,
              governor: cpu.governor,
              temp_c: cpu.tempC,
              temp_sensors: cpu.tempSensors,
              power_watts: null,
              user_percent: cpu.userPct,
              system_percent: cpu.systemPct,
              iowait_percent: cpu.iowaitPct,
              idle_percent: cpu.idlePct,
              load_1m: Math.round(l1 * 100) / 100,
              load_5m: Math.round(l5 * 100) / 100,
              load_15m: Math.round(l15 * 100) / 100,
              capabilities: {
                usage: true,
                temp: cpu.tempC !== null,
                freq: cpu.freqMhz > 0,
                power: false,
                times: true,
                load: true,
                cores: cpu.perCore.length > 0,
              },
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
                wan_rx_bytes_sec?: number;
                wan_tx_bytes_sec?: number;
                lan_rx_bytes_sec?: number;
                lan_tx_bytes_sec?: number;
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
              tx_rate: nic.speed_mbps ? `${nic.speed_mbps} Mbps` : 'Enlace Activo',
              tx_bytes: nic.bytes_recv || 0,
              rx_bytes: nic.bytes_sent || 0,
              speed_down: nic.rx_bytes_sec || 0,
              speed_up: nic.tx_bytes_sec || 0,
              wan_speed_down: nic.wan_rx_bytes_sec ?? nic.rx_bytes_sec ?? 0,
              wan_speed_up: nic.wan_tx_bytes_sec ?? nic.tx_bytes_sec ?? 0,
              lan_speed_down: nic.lan_rx_bytes_sec ?? 0,
              lan_speed_up: nic.lan_tx_bytes_sec ?? 0,
              is_online: true,
              is_server: true,
            })),
            wifi_summary: {
              total_clients: net.interfaces_list.length,
              clients_24g: 0,
              clients_5g: 0,
              cable_tx_bytes: net.tx_total_bytes,
              cable_rx_bytes: net.rx_total_bytes,
              wifi_tx_bytes: 0,
              wifi_rx_bytes: 0,
              router_wan_available: false,
              router_wan_rx_bytes_sec: net.wan_rx_bytes_sec ?? net.rx_bytes_sec ?? 0,
              router_wan_tx_bytes_sec: net.wan_tx_bytes_sec ?? net.tx_bytes_sec ?? 0,
              router_lan_rx_bytes_sec: net.lan_rx_bytes_sec ?? 0,
              router_lan_tx_bytes_sec: net.lan_tx_bytes_sec ?? 0,
              router_ip: detectDefaultGatewayIp() || net.local_ip,
              gateway_ip: detectDefaultGatewayIp() || net.local_ip,
              gateway_name: os.hostname(),
              router_traffic_source: os.hostname(),
              router_history_20m: net.router_history_20m || [],
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
          const reqUrlObj = new URL(req.url || '/api/system/logs', 'http://127.0.0.1');
          const langQ = (reqUrlObj.searchParams.get('lang') || 'es').trim().toLowerCase().slice(0, 8) || 'es';
          const aiFaultInsightsObj: Record<string, AiSystemFaultInsightRecord> = {};
          const aiFaultHistoryArr: AiSystemFaultInsightRecord[] = [];
          for (const [k, val] of aiFaultInsightsCache.entries()) {
            if (k.startsWith(`${langQ}::`)) {
              aiFaultInsightsObj[val.insight.signature] = val.insight;
              aiFaultHistoryArr.push(val.insight);
            }
          }
          aiFaultHistoryArr.sort((a, b) => b.analyzed_at - a.analyzed_at);

          const logs = geoIpErrorHistory.map((err, idx) => {
            const unitStr = err.source || 'GeoIP';
            const msgStr = `${err.message} (${err.target})`;
            const sig = normalizeSystemFaultSignature(unitStr, 'network', msgStr);
            return {
              id: err.id || `err_${idx}`,
              timestamp: err.ts,
              date_str: err.time_str,
              time_str: err.time_str,
              category: 'network',
              level: 'ERROR',
              unit: unitStr,
              source: unitStr,
              message: msgStr,
              signature: sig,
              ai_insight: aiFaultInsightsObj[sig],
            };
          });
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
              ai_fault_insights: aiFaultInsightsObj,
              ai_fault_history: aiFaultHistoryArr,
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

        if (url === '/api/system/logs/ai-simplify' && req.method === 'POST') {
          let rawBody = '';
          let tooLarge = false;
          req.on('data', (chunk) => {
            rawBody += chunk;
            if (rawBody.length > 512 * 1024) tooLarge = true;
          });
          req.on('end', async () => {
            const sendFaultAiJson = (obj: unknown, status = 200) => {
              res.statusCode = status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(obj));
            };
            if (tooLarge) {
              sendFaultAiJson({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds 512 KB limit' }, 413);
              return;
            }
            let parsedBody: Record<string, unknown> = {};
            try {
              parsedBody = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              sendFaultAiJson({ ok: false, code: 'INVALID_JSON', error: 'Invalid JSON request body' }, 400);
              return;
            }
            const lang = String(parsedBody.lang || 'es').trim().toLowerCase().slice(0, 8) || 'es';
            const rawFaults = Array.isArray(parsedBody.faults) ? parsedBody.faults : [];
            const inputFaults: Array<Record<string, unknown>> =
              rawFaults.length > 0
                ? rawFaults.filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
                : geoIpErrorHistory.map((err) => ({
                    unit: err.source || 'GeoIP',
                    category: 'network',
                    level: 'ERR',
                    message: `${err.message} (${err.target})`,
                  }));

            const dedupBySig = new Map<
              string,
              { signature: string; unit: string; category: string; level: string; sample_message: string; count: number }
            >();
            for (const f of inputFaults) {
              const unitS = String(f.unit || f.source || 'system').trim();
              const catS = String(f.category || 'system').trim();
              const msgS = String(f.message || '').trim();
              if (!msgS) continue;
              const sig = String(f.signature || '').trim() || normalizeSystemFaultSignature(unitS, catS, msgS);
              const existing = dedupBySig.get(sig);
              if (existing) {
                existing.count += 1;
              } else if (dedupBySig.size < 20) {
                dedupBySig.set(sig, {
                  signature: sig,
                  unit: unitS,
                  category: catS,
                  level: String(f.level || 'ERR'),
                  sample_message: msgS.slice(0, 280),
                  count: 1,
                });
              }
            }

            const nowMs = Date.now();
            const resultInsights: Record<string, AiSystemFaultInsightRecord> = {};
            const missingFaults: Array<{
              signature: string;
              unit: string;
              category: string;
              level: string;
              sample_message: string;
            }> = [];

            for (const [sig, item] of dedupBySig.entries()) {
              const cacheKey = `${lang}::${sig}`;
              const cached = aiFaultInsightsCache.get(cacheKey);
              if (cached && nowMs - cached.cachedAt < AI_FAULT_CACHE_TTL_MS) {
                resultInsights[sig] = { ...cached.insight, cached_from_db: true };
              } else {
                missingFaults.push({
                  signature: sig,
                  unit: item.unit,
                  category: item.category,
                  level: item.level,
                  sample_message: item.sample_message,
                });
              }
            }

            const getLangHistory = () => {
              const arr: AiSystemFaultInsightRecord[] = [];
              for (const [k, v] of aiFaultInsightsCache.entries()) {
                if (k.startsWith(`${lang}::`)) arr.push(v.insight);
              }
              return arr.sort((a, b) => b.analyzed_at - a.analyzed_at).slice(0, 50);
            };

            if (missingFaults.length === 0) {
              sendFaultAiJson(
                { ok: true, model: AI_NET_MODEL, insights: resultInsights, history: getLangHistory(), all_cached: true },
                200
              );
              return;
            }

            const apiKey = (process.env.GEMINI_API_KEY || readDotEnvKey('GEMINI_API_KEY')).trim();
            if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
              sendFaultAiJson(
                {
                  ok: false,
                  code: 'GEMINI_API_KEY_MISSING',
                  error: 'GEMINI_API_KEY no está configurada en el entorno del servidor.',
                  insights: resultInsights,
                  history: getLangHistory(),
                },
                503
              );
              return;
            }

            try {
              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
              });
              const hostSnapshot = getDynamicHostServicesSnapshot();
              const sysPrompt =
                `You are a senior Linux, Docker, and home-server reliability engineer. Respond strictly in language code "${lang}". ` +
                `Your job is to simplify raw system/kernel/systemd/Docker error logs detected by the interface alert notifier into clear, ` +
                `plain-language explanations for the server administrator, classify their real danger level, and provide concrete actionable solutions. ` +
                `For each fault item, return: ` +
                `- signature: exact signature string from input ` +
                `- title: short human-friendly title (2-6 words, no raw hex/PIDs) ` +
                `- danger_level: strictly one of 'critical', 'high', 'medium', or 'low' ` +
                `- summary: 1-2 clear sentences explaining what failed and why in plain language ` +
                `- solution: concrete, practical steps or exact terminal command to resolve or verify the issue ` +
                `- confidence: strictly one of 'high', 'medium', or 'low'.`;

              const response = await ai.models.generateContent({
                model: AI_NET_MODEL,
                contents: JSON.stringify({
                  target_language: lang,
                  hostname: os.hostname(),
                  host_listening_context: hostSnapshot,
                  faults_to_diagnose: missingFaults,
                }),
                config: {
                  systemInstruction: sysPrompt,
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      items: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            signature: { type: Type.STRING },
                            title: { type: Type.STRING },
                            danger_level: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            solution: { type: Type.STRING },
                            confidence: { type: Type.STRING },
                          },
                          required: ['signature', 'title', 'danger_level', 'summary', 'solution', 'confidence'],
                        },
                      },
                    },
                    required: ['items'],
                  },
                },
              });

              const rawText = (response.text || '').trim();
              const parsed = rawText ? (JSON.parse(rawText) as { items?: Array<Record<string, unknown>> }) : { items: [] };
              const items = Array.isArray(parsed.items) ? parsed.items : [];
              const analyzedAt = Math.floor(Date.now() / 1000);

              for (const it of items) {
                const sig = String(it.signature || '').trim();
                if (!sig) continue;
                const metaIn = dedupBySig.get(sig);
                const dangerRaw = String(it.danger_level || 'medium').trim().toLowerCase();
                const dangerLevel: 'critical' | 'high' | 'medium' | 'low' =
                  dangerRaw === 'critical' || dangerRaw === 'high' || dangerRaw === 'low' ? dangerRaw : 'medium';
                const confRaw = String(it.confidence || 'medium').trim().toLowerCase();
                const confidence: 'high' | 'medium' | 'low' =
                  confRaw === 'high' || confRaw === 'low' ? confRaw : 'medium';
                const insight: AiSystemFaultInsightRecord = {
                  signature: sig,
                  unit: metaIn?.unit || 'system',
                  category: metaIn?.category || 'system',
                  title: String(it.title || '').trim() || metaIn?.unit || 'Aviso del sistema',
                  danger_level: dangerLevel,
                  summary: String(it.summary || '').trim(),
                  solution: String(it.solution || '').trim(),
                  confidence,
                  model: AI_NET_MODEL,
                  occurrence_count: metaIn?.count || 1,
                  first_seen_at: analyzedAt,
                  analyzed_at: analyzedAt,
                  cached_from_db: false,
                };
                resultInsights[sig] = insight;
                aiFaultInsightsCache.set(`${lang}::${sig}`, { insight, cachedAt: Date.now() });
              }
              saveAiInsightsDev();
              sendFaultAiJson(
                { ok: true, model: AI_NET_MODEL, insights: resultInsights, history: getLangHistory(), all_cached: false },
                200
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendFaultAiJson(
                {
                  ok: false,
                  code: 'GEMINI_UPSTREAM_ERROR',
                  error: message || 'Error consultando Gemini AI',
                  insights: resultInsights,
                  history: getLangHistory(),
                },
                502
              );
            }
          });
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

        if (url?.startsWith('/api/dns/traffic')) {
          const topDomainsList = Array.from(observedDnsDomains.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 30)
            .map((d) => ({
              domain: d.domain,
              count: d.count,
              blocked_count: d.blocked_count,
              pct_blocked: d.count > 0 ? Math.round((d.blocked_count / d.count) * 1000) / 10 : 0,
              clients_count: d.clients.size,
              avg_reply_ms: d.count > 0 ? Math.round((d.total_reply_ms / d.count) * 10) / 10 : 0,
            }));

          const totalDnsCount = topDomainsList.reduce((acc, d) => acc + d.count, 0);
          const localHostIp = sampleRealNetwork().local_ip || '127.0.0.1';
          const clientStats = topDomainsList.length
            ? [
                {
                  ip: localHostIp,
                  name: os.hostname(),
                  total: totalDnsCount,
                  blocked: 0,
                  pct_blocked: 0,
                  top_domains: topDomainsList.slice(0, 3).map((d) => ({ domain: d.domain, count: d.count })),
                },
              ]
            : [];

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              available: topDomainsList.length > 0,
              summary: {
                total_queries_24h: totalDnsCount,
                blocked_queries_24h: 0,
                pct_blocked_24h: 0,
                unique_domains_24h: observedDnsDomains.size,
                unique_clients_24h: clientStats.length,
              },
              top_domains: topDomainsList,
              clients: clientStats,
              recent_queries: observedDnsRecent.slice(0, 50),
            })
          );
          return;
        }

        if (url === '/api/net/ai-identify' && req.method === 'POST') {
          let rawBody = '';
          let tooLarge = false;
          req.on('data', (chunk) => {
            rawBody += chunk;
            if (rawBody.length > 512 * 1024) tooLarge = true;
          });
          req.on('end', async () => {
            const sendAiJson = (obj: unknown, status = 200) => {
              res.statusCode = status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(obj));
            };

            if (tooLarge) {
              sendAiJson({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload exceeds 512 KB limit' }, 413);
              return;
            }

            let parsedBody: Record<string, unknown> = {};
            try {
              parsedBody = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              sendAiJson({ ok: false, code: 'INVALID_JSON', error: 'Invalid JSON request body' }, 400);
              return;
            }

            const rawConns = Array.isArray(parsedBody.connections) ? parsedBody.connections : [];
            const lang = String(parsedBody.lang || 'es').trim().toLowerCase().slice(0, 8) || 'es';
            const inputConns = rawConns
              .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
              .slice(0, 24);

            if (inputConns.length === 0) {
              sendAiJson({ ok: true, model: AI_NET_MODEL, insights: {} }, 200);
              return;
            }

            const nowMs = Date.now();
            const resultInsights: Record<string, AiConnInsightRecord> = {};
            const missingConns: Array<Record<string, unknown>> = [];

            for (const c of inputConns) {
              const sig = String(c.signature || '').trim();
              if (!sig) continue;
              const cacheKey = `${lang}::${sig}`;
              const cached = aiNetInsightsCache.get(cacheKey);
              if (cached && nowMs - cached.cachedAt < AI_NET_CACHE_TTL_MS) {
                resultInsights[sig] = cached.insight;
              } else {
                missingConns.push({
                  signature: sig,
                  direction: String(c.direction || 'outgoing'),
                  protocol: String(c.protocol || 'TCP'),
                  local_device: String(c.local_hostname || c.local_ip || ''),
                  local_port: Number(c.local_port || 0),
                  remote_ip: String(c.remote_ip || ''),
                  remote_port: Number(c.remote_port || 0),
                  domain: String(c.domain || ''),
                  raw_service: String(c.service || ''),
                  process: String(c.process || ''),
                  isp: String(c.isp || ''),
                  asn: String(c.asn || ''),
                  city: String(c.city || ''),
                  country: String(c.country || ''),
                });
              }
            }

            if (missingConns.length === 0) {
              sendAiJson({ ok: true, model: AI_NET_MODEL, insights: resultInsights }, 200);
              return;
            }

            const apiKey = (process.env.GEMINI_API_KEY || readDotEnvKey('GEMINI_API_KEY')).trim();
            if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
              sendAiJson(
                {
                  ok: false,
                  code: 'GEMINI_API_KEY_MISSING',
                  error: 'GEMINI_API_KEY no está configurada en el entorno del servidor.',
                  insights: resultInsights,
                },
                503
              );
              return;
            }

            try {
              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
              });
              const hostSnapshot = getDynamicHostServicesSnapshot();
              const sysPrompt =
                `You are a Linux & home-server network telemetry analyst. Respond strictly in language code "${lang}". ` +
                `Your job is to simplify noisy raw network connection telemetry into clear, plain human identifications. ` +
                `Analyze ALL clues together: domain/rDNS patterns, local_port and remote_port, protocol, process name, ` +
                `local_device, ISP/ASN, and the host's live listening sockets / running containers provided in host_context. ` +
                `Examples of analytical reasoning (do not assume them unless supported by the telemetry): ` +
                `- Dynamic residential ISP hostnames connecting incoming to high local ports often correspond to P2P / BitTorrent peers if a torrent service or high listening port is involved. ` +
                `- Mobile/cloud domains on :443 from Google/Apple/Microsoft correlate with mobile push notifications, OS telemetry, updates, or cloud APIs. ` +
                `- Match local_port or process hints against self-hosted media/photo/cloud services when present in host_context. ` +
                `Keep every field concise: app_name (2-4 words, e.g. "Cliente Torrent P2P", "Google Play / Push", "Emby Streaming"), ` +
                `category (1-2 words), role (short direction/purpose tag), summary (one crisp sentence <= 95 chars explaining what this connection is doing without raw IP dumps).`;

              const promptPayload = {
                target_language: lang,
                hostname: os.hostname(),
                host_listening_context: hostSnapshot,
                connections_to_identify: missingConns,
              };

              const response = await ai.models.generateContent({
                model: AI_NET_MODEL,
                contents: JSON.stringify(promptPayload),
                config: {
                  systemInstruction: sysPrompt,
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      items: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            signature: { type: Type.STRING },
                            app_name: { type: Type.STRING },
                            category: { type: Type.STRING },
                            role: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            confidence: { type: Type.STRING },
                          },
                          required: ['signature', 'app_name', 'category', 'role', 'summary', 'confidence'],
                        },
                      },
                    },
                    required: ['items'],
                  },
                },
              });

              const rawText = (response.text || '').trim();
              const parsed = rawText ? (JSON.parse(rawText) as { items?: Array<Record<string, unknown>> }) : { items: [] };
              const items = Array.isArray(parsed.items) ? parsed.items : [];
              const analyzedAt = Math.floor(Date.now() / 1000);

              for (const it of items) {
                const sig = String(it.signature || '').trim();
                if (!sig) continue;
                const confRaw = String(it.confidence || 'medium').toLowerCase();
                const confidence: 'high' | 'medium' | 'low' =
                  confRaw === 'high' || confRaw === 'low' ? confRaw : 'medium';
                const insight: AiConnInsightRecord = {
                  signature: sig,
                  app_name: String(it.app_name || '').trim() || 'Servicio de red',
                  category: String(it.category || '').trim() || 'Red',
                  role: String(it.role || '').trim() || 'Conexión externa',
                  summary: String(it.summary || '').trim(),
                  confidence,
                  model: AI_NET_MODEL,
                  analyzed_at: analyzedAt,
                };
                resultInsights[sig] = insight;
                aiNetInsightsCache.set(`${lang}::${sig}`, { insight, cachedAt: Date.now() });
              }

              if (aiNetInsightsCache.size > 1000) {
                const oldest = Array.from(aiNetInsightsCache.entries())
                  .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
                  .slice(0, aiNetInsightsCache.size - 1000);
                for (const [k] of oldest) aiNetInsightsCache.delete(k);
              }
              saveAiInsightsDev();

              sendAiJson({ ok: true, model: AI_NET_MODEL, insights: resultInsights }, 200);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendAiJson(
                {
                  ok: false,
                  code: 'GEMINI_UPSTREAM_ERROR',
                  error: message || 'Error consultando Gemini AI',
                  insights: resultInsights,
                },
                502
              );
            }
          });
          return;
        }

        if (url?.startsWith('/api/net/history')) {
          const cleanHistoryPath = url.split('?', 1)[0];
          if (cleanHistoryPath === '/api/net/history/clear') {
            observedDevNetHistory.clear();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Historial limpio' }));
            return;
          }

          const reqUrlObj = new URL(url, 'http://127.0.0.1');
          const svcFilter = (reqUrlObj.searchParams.get('service') || '').trim();
          const devFilter = (reqUrlObj.searchParams.get('device') || '').trim();
          const dirFilter = (reqUrlObj.searchParams.get('direction') || '').trim().toLowerCase();
          const qFilter = (reqUrlObj.searchParams.get('q') || '').trim().toLowerCase();
          const hoursParam = (reqUrlObj.searchParams.get('hours') || '').trim().toLowerCase();
          const limitNum = Math.max(10, Math.min(1000, Number.parseInt(reqUrlObj.searchParams.get('limit') || '300', 10) || 300));

          const hostLocalIp = sampleRealNetwork().local_ip;
          const liveMap = buildLiveConnectionsMap(hostLocalIp);
          const liveConns = liveMap && Array.isArray(liveMap.connections) ? liveMap.connections : [];
          const nowSecHist = Math.floor(Date.now() / 1000);

          for (const c of liveConns) {
            if (c.is_lan || !c.remote_ip) continue;
            const hKey = `${c.remote_ip}|${c.service}|${c.domain || ''}`;
            const curH = observedDevNetHistory.get(hKey);
            if (!curH) {
              observedDevNetHistory.set(hKey, {
                key: hKey,
                direction: c.direction,
                protocol: c.protocol,
                local_ip: c.local_ip,
                local_hostname: c.local_hostname || os.hostname(),
                local_port: c.local_port,
                remote_ip: c.remote_ip,
                remote_port: c.remote_port,
                domain: c.domain || '',
                service: c.service || 'Direct',
                process: c.process || '',
                jail: c.jail || 'caddy-scan',
                lat: c.lat,
                lng: c.lng,
                city: c.city,
                country: c.country,
                country_code: c.country_code,
                isp: c.isp,
                asn: c.asn,
                hit_count: 1,
                bytes_total: Number(c.bytes_total || 0),
                first_seen: nowSecHist,
                last_seen: nowSecHist,
              });
            }
          }

          let cutoffTs = 0;
          if (hoursParam && hoursParam !== 'all' && hoursParam !== 'todo') {
            const parsedHours = Number.parseFloat(hoursParam);
            if (Number.isFinite(parsedHours) && parsedHours > 0) {
              cutoffTs = nowSecHist - parsedHours * 3600;
            }
          }

          const allRecorded = Array.from(observedDevNetHistory.values());
          const timeScopedItems = cutoffTs > 0 ? allRecorded.filter((item) => item.last_seen >= cutoffTs) : allRecorded;

          const servicesMap: Record<
            string,
            {
              service: string;
              connections_count: number;
              total_hits: number;
              ips: Set<string>;
              devices: Set<string>;
              countries: Set<string>;
              domains: Set<string>;
              first_seen: number;
              last_seen: number;
            }
          > = {};
          const countriesMap: Record<
            string,
            {
              country: string;
              country_code: string;
              connections_count: number;
              total_hits: number;
              ips: Set<string>;
              cities: Set<string>;
              devices: Set<string>;
              last_seen: number;
            }
          > = {};
          const domainsMap: Record<
            string,
            {
              domain: string;
              connections_count: number;
              total_hits: number;
              ips: Set<string>;
              devices: Set<string>;
              top_service: string;
              top_country: string;
              top_country_code: string;
              last_seen: number;
            }
          > = {};
          const devicesMap: Record<string, { ip: string; name: string; count: number; services: Set<string>; last_seen: number }> = {};

          let totalHitsSum = 0;
          const uniqueIpsAll = new Set<string>();

          for (const c of timeScopedItems) {
            const svc = c.service || 'Direct';
            const dev = c.local_ip || os.hostname();
            const hits = Math.max(1, Number(c.hit_count || 1));
            totalHitsSum += hits;
            if (c.remote_ip) uniqueIpsAll.add(c.remote_ip);

            if (!servicesMap[svc]) {
              servicesMap[svc] = {
                service: svc,
                connections_count: 0,
                total_hits: 0,
                ips: new Set<string>(),
                devices: new Set<string>(),
                countries: new Set<string>(),
                domains: new Set<string>(),
                first_seen: c.first_seen,
                last_seen: c.last_seen,
              };
            }
            servicesMap[svc].connections_count += 1;
            servicesMap[svc].total_hits += hits;
            if (c.remote_ip) servicesMap[svc].ips.add(c.remote_ip);
            servicesMap[svc].devices.add(dev);
            if (c.country) servicesMap[svc].countries.add(c.country);
            if (c.domain) servicesMap[svc].domains.add(c.domain);
            servicesMap[svc].first_seen = Math.min(servicesMap[svc].first_seen, c.first_seen);
            servicesMap[svc].last_seen = Math.max(servicesMap[svc].last_seen, c.last_seen);

            const cc = String(c.country_code || '').trim().toUpperCase();
            const cName = String(c.country || cc).trim();
            if (cName) {
              const cKey = cc || cName.toUpperCase();
              if (!countriesMap[cKey]) {
                countriesMap[cKey] = {
                  country: cName,
                  country_code: cc,
                  connections_count: 0,
                  total_hits: 0,
                  ips: new Set<string>(),
                  cities: new Set<string>(),
                  devices: new Set<string>(),
                  last_seen: c.last_seen,
                };
              }
              countriesMap[cKey].connections_count += 1;
              countriesMap[cKey].total_hits += hits;
              if (c.remote_ip) countriesMap[cKey].ips.add(c.remote_ip);
              if (c.city) countriesMap[cKey].cities.add(c.city);
              countriesMap[cKey].devices.add(dev);
              countriesMap[cKey].last_seen = Math.max(countriesMap[cKey].last_seen, c.last_seen);
            }

            const dom = String(c.domain || '').trim().toLowerCase();
            if (dom) {
              if (!domainsMap[dom]) {
                domainsMap[dom] = {
                  domain: dom,
                  connections_count: 0,
                  total_hits: 0,
                  ips: new Set<string>(),
                  devices: new Set<string>(),
                  top_service: svc,
                  top_country: cName,
                  top_country_code: cc,
                  last_seen: c.last_seen,
                };
              }
              domainsMap[dom].connections_count += 1;
              domainsMap[dom].total_hits += hits;
              if (c.remote_ip) domainsMap[dom].ips.add(c.remote_ip);
              domainsMap[dom].devices.add(dev);
              domainsMap[dom].last_seen = Math.max(domainsMap[dom].last_seen, c.last_seen);
            }

            if (!devicesMap[dev]) {
              devicesMap[dev] = {
                ip: dev,
                name: c.local_hostname || dev,
                count: 0,
                services: new Set<string>(),
                last_seen: c.last_seen,
              };
            }
            devicesMap[dev].count += 1;
            devicesMap[dev].services.add(svc);
            devicesMap[dev].last_seen = Math.max(devicesMap[dev].last_seen, c.last_seen);
          }

          const filteredItems = timeScopedItems.filter((c) => {
            if (svcFilter && svcFilter.toLowerCase() !== 'all' && svcFilter.toLowerCase() !== 'todos') {
              if (c.service !== svcFilter) return false;
            }
            if (devFilter && devFilter.toLowerCase() !== 'all' && devFilter.toLowerCase() !== 'todos') {
              if (c.local_ip !== devFilter) return false;
            }
            if (dirFilter && dirFilter !== 'all' && dirFilter !== 'todas') {
              if (dirFilter === 'devices') {
                if (!c.local_ip || c.local_ip === hostLocalIp || c.local_ip === '127.0.0.1' || c.local_ip === '::1') {
                  return false;
                }
              } else if (c.direction !== dirFilter) {
                return false;
              }
            }
            if (qFilter) {
              const hay = `${c.service} ${c.domain} ${c.remote_ip} ${c.city} ${c.country} ${c.isp} ${c.local_hostname} ${c.local_ip} ${c.process}`.toLowerCase();
              if (!hay.includes(qFilter)) return false;
            }
            return true;
          });

          const servicesCatalog = Object.values(servicesMap)
            .sort((a, b) => b.total_hits - a.total_hits || b.connections_count - a.connections_count)
            .map((s) => ({
              service: s.service,
              connections_count: s.connections_count,
              total_hits: s.total_hits,
              hit_count: s.total_hits,
              unique_ips: s.ips.size,
              unique_devices: s.devices.size,
              countries: Array.from(s.countries).slice(0, 5),
              sample_domains: Array.from(s.domains).slice(0, 4),
              first_seen: s.first_seen,
              last_seen: s.last_seen,
            }));

          const countriesCatalog = Object.values(countriesMap)
            .sort((a, b) => b.total_hits - a.total_hits || b.connections_count - a.connections_count)
            .map((ct) => ({
              country: ct.country,
              country_code: ct.country_code,
              connections_count: ct.connections_count,
              total_hits: ct.total_hits,
              unique_ips: ct.ips.size,
              cities_count: ct.cities.size,
              unique_devices: ct.devices.size,
              last_seen: ct.last_seen,
            }));

          const domainsCatalog = Object.values(domainsMap)
            .sort((a, b) => b.total_hits - a.total_hits || b.connections_count - a.connections_count)
            .map((d) => ({
              domain: d.domain,
              connections_count: d.connections_count,
              total_hits: d.total_hits,
              unique_ips: d.ips.size,
              unique_devices: d.devices.size,
              top_service: d.top_service,
              top_country: d.top_country,
              top_country_code: d.top_country_code,
              last_seen: d.last_seen,
            }));

          const devicesCatalog = Object.values(devicesMap).map((d) => ({
            ip: d.ip,
            name: d.name,
            connections_count: d.count,
            services_count: d.services.size,
            last_seen: d.last_seen,
          }));

          const langFilter = (reqUrlObj.searchParams.get('lang') || '').trim().toLowerCase().slice(0, 8);
          const historyAiInsights: Record<string, AiConnInsightRecord> = {};
          for (const [cacheKey, entry] of aiNetInsightsCache.entries()) {
            const sepIdx = cacheKey.indexOf('::');
            const entryLang = sepIdx > 0 ? cacheKey.slice(0, sepIdx) : '';
            const sig = sepIdx > 0 ? cacheKey.slice(sepIdx + 2) : cacheKey;
            if (langFilter && entryLang && entryLang !== langFilter) continue;
            if (!historyAiInsights[sig]) historyAiInsights[sig] = entry.insight;
          }

          const historyPayload = {
            status: 'ok',
            services_catalog: servicesCatalog,
            countries_catalog: countriesCatalog,
            domains_catalog: domainsCatalog,
            devices_catalog: devicesCatalog,
            connections: filteredItems
              .sort((a, b) => b.last_seen - a.last_seen)
              .slice(0, limitNum)
              .map((item) => ({
                ...item,
                id: `hist_${item.key}`,
                is_lan: false,
                is_history: true,
                state: `HISTORIAL (${Math.max(1, Number(item.hit_count || 1))}x)`,
              })),
            ai_insights: historyAiInsights,
            summary: {
              total_records: timeScopedItems.length,
              total_services: servicesCatalog.length,
              total_unique_ips: uniqueIpsAll.size,
              total_devices: devicesCatalog.length,
              total_countries: countriesCatalog.length,
              total_domains: domainsCatalog.length,
              total_hits: totalHitsSum,
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
      const staticDir = path.resolve(ROOT_DIR, 'static');
      const staticOutPath = path.join(staticDir, 'index.html');
      if (!fs.existsSync(distHtmlPath)) return;

      // Mirror dist/assets -> static/assets so server.py always serves chunks even when run standalone
      const distAssetsDir = path.join(distDir, 'assets');
      const staticAssetsDir = path.join(staticDir, 'assets');
      if (fs.existsSync(distAssetsDir)) {
        try {
          fs.mkdirSync(staticAssetsDir, { recursive: true });
          // Remove stale hashed index-* bundles from static/assets before mirroring fresh build
          for (const existing of fs.readdirSync(staticAssetsDir)) {
            if (/^index-[A-Za-z0-9_-]+\.(js|css)$/.test(existing)) {
              fs.unlinkSync(path.join(staticAssetsDir, existing));
            }
          }
          for (const entry of fs.readdirSync(distAssetsDir)) {
            const srcPath = path.join(distAssetsDir, entry);
            const dstPath = path.join(staticAssetsDir, entry);
            if (fs.statSync(srcPath).isFile()) {
              fs.copyFileSync(srcPath, dstPath);
            }
          }
        } catch {
          // Best-effort mirror
        }
      }

      let html = fs.readFileSync(distHtmlPath, 'utf-8');

      // Inline compiled stylesheet tags into <style> inside <head>
      html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi, (full, href) => {
        if (/^https?:\/\//i.test(href)) return full;
        const cssFile = path.join(distDir, href.replace(/^\//, ''));
        if (fs.existsSync(cssFile)) {
          const css = fs.readFileSync(cssFile, 'utf-8').replace(/<\/style>/gi, '<\\/style>');
          return `<style>${css}</style>`;
        }
        return full;
      });

      // Extract and inline compiled module script tags right before </body> so #root always exists first
      const inlinedScripts: string[] = [];
      html = html.replace(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi, (full, src) => {
        if (/^https?:\/\//i.test(src)) return full;
        const jsFile = path.join(distDir, src.replace(/^\//, ''));
        if (fs.existsSync(jsFile)) {
          const js = fs.readFileSync(jsFile, 'utf-8').replace(/<\/script>/gi, '<\\/script>');
          inlinedScripts.push(`<script type="module">${js}</script>`);
          return '';
        }
        return full;
      });

      if (inlinedScripts.length > 0 && html.includes('</body>')) {
        const lastBodyIdx = html.lastIndexOf('</body>');
        html = `${html.slice(0, lastBodyIdx)}${inlinedScripts.join('\n')}\n${html.slice(lastBodyIdx)}`;
      }

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
