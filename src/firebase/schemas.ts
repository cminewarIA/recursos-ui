/**
 * Validation constants & defensive payload builders synchronized verbatim with
 * firebase-blueprint.json and firestore.rules.
 */

export const FIREBASE_SCHEMA_LIMITS = {
  ID_MAX_LEN: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  DISPLAY_NAME_MAX_LEN: 100,
  HOSTNAME_MAX_LEN: 120,
  APP_VERSION_MAX_LEN: 32,
  APP_VERSION_PATTERN: /^[0-9]+\.[0-9]+\.[0-9]+$/,
  EMAIL_MAX_LEN: 254,
  LOCALE_MIN_LEN: 2,
  LOCALE_MAX_LEN: 10,
  LOCALE_PATTERN: /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/,
  SPEEDTEST_SERVER_MAX_LEN: 160,
  SPEEDTEST_LOCATION_MAX_LEN: 160,
  ISP_MAX_LEN: 120,
  MAX_MBPS: 1_000_000,
  MAX_MS: 60_000,
  MAX_BPS: 1_000_000_000_000,
  MAX_DEVICES: 100_000,
} as const;

export function sanitizeFirebaseId(raw: string, fallback = 'default_id'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, FIREBASE_SCHEMA_LIMITS.ID_MAX_LEN);
  if (cleaned && FIREBASE_SCHEMA_LIMITS.ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

export function sanitizeBoundedString(raw: unknown, maxLen: number, fallback = ''): string {
  const s = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
  const out = s.slice(0, maxLen);
  return out || fallback;
}

export function sanitizeAppVersion(raw: unknown): string {
  const s = sanitizeBoundedString(raw, FIREBASE_SCHEMA_LIMITS.APP_VERSION_MAX_LEN, '1.0.0');
  return FIREBASE_SCHEMA_LIMITS.APP_VERSION_PATTERN.test(s) ? s : '1.0.0';
}

export function sanitizeLocale(raw: unknown): string {
  const s = sanitizeBoundedString(raw, FIREBASE_SCHEMA_LIMITS.LOCALE_MAX_LEN, 'es');
  return FIREBASE_SCHEMA_LIMITS.LOCALE_PATTERN.test(s) ? s : 'es';
}

export function clampNumber(raw: unknown, min: number, max: number, decimals = 2): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return min;
  const clamped = Math.min(max, Math.max(min, num));
  const factor = Math.pow(10, decimals);
  return Math.round(clamped * factor) / factor;
}

export interface UserWorkspaceMutableFields {
  displayName: string;
  lastHostname: string;
  appVersion: string;
}

export function buildUserWorkspaceMutableFields(input: {
  displayName?: unknown;
  lastHostname?: unknown;
  appVersion?: unknown;
}): UserWorkspaceMutableFields {
  return {
    displayName: sanitizeBoundedString(input.displayName, FIREBASE_SCHEMA_LIMITS.DISPLAY_NAME_MAX_LEN, ''),
    lastHostname: sanitizeBoundedString(input.lastHostname, FIREBASE_SCHEMA_LIMITS.HOSTNAME_MAX_LEN, 'host'),
    appVersion: sanitizeAppVersion(input.appVersion),
  };
}

export interface CockpitPreferencesMutableFields {
  theme: 'light' | 'dark';
  locale: string;
  autoSync: boolean;
}

export function buildCockpitPreferencesMutableFields(input: {
  theme?: unknown;
  locale?: unknown;
  autoSync?: unknown;
}): CockpitPreferencesMutableFields {
  return {
    theme: input.theme === 'dark' ? 'dark' : 'light',
    locale: sanitizeLocale(input.locale),
    autoSync: Boolean(input.autoSync),
  };
}

export interface SpeedTestMutableFields {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  packetLossPct: number;
  serverName: string;
  serverLocation: string;
  isp: string;
  hostname: string;
}

export function buildSpeedTestMutableFields(input: {
  downloadMbps?: unknown;
  uploadMbps?: unknown;
  pingMs?: unknown;
  jitterMs?: unknown;
  packetLossPct?: unknown;
  serverName?: unknown;
  serverLocation?: unknown;
  isp?: unknown;
  hostname?: unknown;
}): SpeedTestMutableFields {
  return {
    downloadMbps: clampNumber(input.downloadMbps, 0, FIREBASE_SCHEMA_LIMITS.MAX_MBPS, 2),
    uploadMbps: clampNumber(input.uploadMbps, 0, FIREBASE_SCHEMA_LIMITS.MAX_MBPS, 2),
    pingMs: clampNumber(input.pingMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    jitterMs: clampNumber(input.jitterMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    packetLossPct: clampNumber(input.packetLossPct, 0, 100, 2),
    serverName: sanitizeBoundedString(input.serverName, FIREBASE_SCHEMA_LIMITS.SPEEDTEST_SERVER_MAX_LEN, ''),
    serverLocation: sanitizeBoundedString(input.serverLocation, FIREBASE_SCHEMA_LIMITS.SPEEDTEST_LOCATION_MAX_LEN, ''),
    isp: sanitizeBoundedString(input.isp, FIREBASE_SCHEMA_LIMITS.ISP_MAX_LEN, ''),
    hostname: sanitizeBoundedString(input.hostname, FIREBASE_SCHEMA_LIMITS.HOSTNAME_MAX_LEN, 'host'),
  };
}

export interface HostSnapshotMutableFields {
  hostname: string;
  appVersion: string;
  cpuPercent: number;
  ramPercent: number;
  gpuPercent: number;
  wanRxBps: number;
  wanTxBps: number;
  onlineDevices: number;
  healthStatus: 'healthy' | 'busy' | 'reconnecting';
}

export function buildHostSnapshotMutableFields(input: {
  hostname?: unknown;
  appVersion?: unknown;
  cpuPercent?: unknown;
  ramPercent?: unknown;
  gpuPercent?: unknown;
  wanRxBps?: unknown;
  wanTxBps?: unknown;
  onlineDevices?: unknown;
  healthStatus?: unknown;
}): HostSnapshotMutableFields {
  const rawStatus = String(input.healthStatus || '');
  const healthStatus: 'healthy' | 'busy' | 'reconnecting' =
    rawStatus === 'busy' || rawStatus === 'reconnecting' ? rawStatus : 'healthy';
  return {
    hostname: sanitizeBoundedString(input.hostname, FIREBASE_SCHEMA_LIMITS.HOSTNAME_MAX_LEN, 'host'),
    appVersion: sanitizeAppVersion(input.appVersion),
    cpuPercent: clampNumber(input.cpuPercent, 0, 100, 1),
    ramPercent: clampNumber(input.ramPercent, 0, 100, 1),
    gpuPercent: clampNumber(input.gpuPercent, 0, 100, 1),
    wanRxBps: clampNumber(input.wanRxBps, 0, FIREBASE_SCHEMA_LIMITS.MAX_BPS, 0),
    wanTxBps: clampNumber(input.wanTxBps, 0, FIREBASE_SCHEMA_LIMITS.MAX_BPS, 0),
    onlineDevices: Math.round(clampNumber(input.onlineDevices, 0, FIREBASE_SCHEMA_LIMITS.MAX_DEVICES, 0)),
    healthStatus,
  };
}

export interface PingSampleMutableFields {
  hostname: string;
  targetIp: string;
  targetLabel: string;
  kind: 'gateway' | 'external' | 'dns';
  avgMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  jitterMs: number;
  lossPct: number;
}

export function buildPingSampleMutableFields(input: {
  hostname?: unknown;
  targetIp?: unknown;
  targetLabel?: unknown;
  kind?: unknown;
  avgMs?: unknown;
  minMs?: unknown;
  maxMs?: unknown;
  lastMs?: unknown;
  jitterMs?: unknown;
  lossPct?: unknown;
}): PingSampleMutableFields {
  const rawKind = String(input.kind || '');
  const kind: 'gateway' | 'external' | 'dns' =
    rawKind === 'gateway' || rawKind === 'dns' ? rawKind : 'external';
  return {
    hostname: sanitizeBoundedString(input.hostname, FIREBASE_SCHEMA_LIMITS.HOSTNAME_MAX_LEN, 'host'),
    targetIp: sanitizeBoundedString(input.targetIp, 64, '0.0.0.0'),
    targetLabel: sanitizeBoundedString(input.targetLabel, 120, ''),
    kind,
    avgMs: clampNumber(input.avgMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    minMs: clampNumber(input.minMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    maxMs: clampNumber(input.maxMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    lastMs: clampNumber(input.lastMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    jitterMs: clampNumber(input.jitterMs, 0, FIREBASE_SCHEMA_LIMITS.MAX_MS, 2),
    lossPct: clampNumber(input.lossPct, 0, 100, 1),
  };
}

