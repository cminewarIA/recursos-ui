import { getActiveLocale, translateStatic } from '../i18n';

const TOKEN_STORAGE_KEY = 'recursos_device_token';
const LEGACY_TOKEN_STORAGE_KEY = 'sysmon_device_token';
const AUTH_PERSISTENCE_CONFIG_KEY = 'recursos_auth_persistence_config';

export interface AuthPersistenceConfig {
  token: string;
  wanDomain: string;
  lanIp: string;
  origin: string;
  mode: 'LAN' | 'WAN' | 'UNKNOWN';
  updatedAt: string;
}

const DEFAULT_AUTH_CONFIG: AuthPersistenceConfig = {
  token: '',
  wanDomain: '',
  lanIp: '',
  origin: '',
  mode: 'UNKNOWN',
  updatedAt: '',
};

let activeRestorePromise: Promise<boolean> | null = null;
let lastRestoreAttemptAt = 0;

function readRawAuthConfig(): AuthPersistenceConfig {
  try {
    const raw = localStorage.getItem(AUTH_PERSISTENCE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthPersistenceConfig>;
      if (parsed && typeof parsed === 'object') {
        return {
          token: String(parsed.token || '').trim(),
          wanDomain: String(parsed.wanDomain || '').trim(),
          lanIp: String(parsed.lanIp || '').trim(),
          origin: String(parsed.origin || '').trim(),
          mode: parsed.mode === 'LAN' || parsed.mode === 'WAN' ? parsed.mode : 'UNKNOWN',
          updatedAt: String(parsed.updatedAt || ''),
        };
      }
    }
  } catch {
    // ignore storage errors
  }
  return { ...DEFAULT_AUTH_CONFIG };
}

export function getAuthPersistenceConfig(): AuthPersistenceConfig {
  const cfg = readRawAuthConfig();
  const token = getStoredToken();
  return {
    ...cfg,
    token: token || cfg.token,
  };
}

export function saveAuthPersistenceConfig(patch: Partial<AuthPersistenceConfig>): AuthPersistenceConfig {
  const current = readRawAuthConfig();
  const next: AuthPersistenceConfig = {
    token: patch.token !== undefined ? String(patch.token).trim() : current.token,
    wanDomain: patch.wanDomain !== undefined ? String(patch.wanDomain).trim() : current.wanDomain,
    lanIp: patch.lanIp !== undefined ? String(patch.lanIp).trim() : current.lanIp,
    origin:
      patch.origin !== undefined
        ? String(patch.origin).trim()
        : current.origin || (typeof window !== 'undefined' ? window.location.origin : ''),
    mode: patch.mode !== undefined ? patch.mode : current.mode,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(AUTH_PERSISTENCE_CONFIG_KEY, JSON.stringify(next));
    if (next.token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, next.token);
      localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, next.token);
    }
  } catch {
    // ignore storage errors
  }
  return next;
}

export function getStoredToken(): string {
  try {
    const primary = (localStorage.getItem(TOKEN_STORAGE_KEY) || '').trim();
    if (primary) return primary;
    const legacy = (localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY) || '').trim();
    if (legacy) {
      localStorage.setItem(TOKEN_STORAGE_KEY, legacy);
      return legacy;
    }
    const cfg = readRawAuthConfig();
    if (cfg.token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, cfg.token);
      localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, cfg.token);
      return cfg.token;
    }
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    const winTok = String(window.__RECURSOS_DEVICE_TOKEN__ || '').trim();
    if (winTok) {
      setStoredToken(winTok);
      return winTok;
    }
    try {
      const bridgeTok = String(window.RecursosAndroidBridge?.getDeviceToken?.() || '').trim();
      if (bridgeTok) {
        setStoredToken(bridgeTok);
        return bridgeTok;
      }
    } catch {
      // ignore bridge errors
    }
  }
  return '';
}

export function setStoredToken(token: string): void {
  const clean = String(token || '').trim();
  if (!clean) return;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, clean);
    localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, clean);
    saveAuthPersistenceConfig({ token: clean });
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    window.__RECURSOS_DEVICE_TOKEN__ = clean;
    try {
      window.RecursosAndroidBridge?.onTokenUpdated?.(clean);
    } catch {
      // ignore bridge errors
    }
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    saveAuthPersistenceConfig({ token: '' });
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    delete window.__RECURSOS_DEVICE_TOKEN__;
  }
}

export function syncAuthPersistenceFromPayload(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;
  const authStatus =
    obj.auth_status && typeof obj.auth_status === 'object'
      ? (obj.auth_status as Record<string, unknown>)
      : null;
  const versionInfo =
    obj.version_info && typeof obj.version_info === 'object'
      ? (obj.version_info as Record<string, unknown>)
      : null;
  const systemInfo =
    obj.system && typeof obj.system === 'object'
      ? (obj.system as Record<string, unknown>)
      : null;

  const returnedToken = String(obj.token || authStatus?.token || '').trim();
  if (returnedToken) {
    setStoredToken(returnedToken);
  }

  const wanDomain = String(
    authStatus?.public_domain ||
      versionInfo?.public_domain ||
      systemInfo?.public_domain ||
      obj.public_domain ||
      ''
  ).trim();
  const lanIp = String(
    authStatus?.local_ip || systemInfo?.local_ip || obj.local_ip || ''
  ).trim();
  const hasIsLocal = authStatus && typeof authStatus.is_local === 'boolean';

  if (wanDomain || lanIp || hasIsLocal) {
    const patch: Partial<AuthPersistenceConfig> = {};
    if (wanDomain && !wanDomain.endsWith('.local') && wanDomain !== 'localhost' && wanDomain !== '127.0.0.1') {
      patch.wanDomain = wanDomain;
    }
    if (lanIp) {
      patch.lanIp = lanIp;
    }
    if (hasIsLocal) {
      patch.mode = authStatus?.is_local ? 'LAN' : 'WAN';
    }
    if (Object.keys(patch).length > 0) {
      saveAuthPersistenceConfig(patch);
    }
  }
}

export function detectNativeEnvironment(): {
  isUbuntuNative: boolean;
  isAndroidNative: boolean;
  isAndroidTv: boolean;
  isNativeApp: boolean;
} {
  if (typeof window === 'undefined') {
    return { isUbuntuNative: false, isAndroidNative: false, isAndroidTv: false, isNativeApp: false };
  }
  const ua = (navigator.userAgent || '').toLowerCase();
  const isUbuntuNative =
    Boolean(window.__RECURSOS_UBUNTU_NATIVE__) ||
    ua.includes('recursoscockpit-linux') ||
    Boolean(window.webkit?.messageHandlers?.recursosNative);
  const isAndroidNative =
    Boolean(window.__RECURSOS_ANDROID_NATIVE__) ||
    ua.includes('recursoscockpit-android') ||
    Boolean(window.AndroidBridge) ||
    Boolean(window.RecursosAndroidBridge);
  const telemetryChassis = String(window.__RECURSOS_DEVICE_TELEMETRY__?.chassis_type || '').toLowerCase();
  const bridgeTv = Boolean(window.RecursosAndroidBridge?.isTelevision?.());
  const isAndroidTv =
    Boolean(window.__RECURSOS_ANDROID_TV__) ||
    bridgeTv ||
    ua.includes('androidtv') ||
    ua.includes('smarttv') ||
    telemetryChassis.includes('tv');
  return {
    isUbuntuNative,
    isAndroidNative,
    isAndroidTv,
    isNativeApp: isUbuntuNative || isAndroidNative,
  };
}

export function sendUbuntuWindowAction(
  action:
    | 'minimize'
    | 'maximize'
    | 'unmaximize'
    | 'toggle_maximize'
    | 'fullscreen'
    | 'unfullscreen'
    | 'toggle_fullscreen'
    | 'close'
    | 'reload'
): void {
  if (typeof window === 'undefined') return;
  try {
    const handler = window.webkit?.messageHandlers?.recursosWindow;
    if (handler && typeof handler.postMessage === 'function') {
      handler.postMessage(action);
      return;
    }
  } catch {
    // Fallback al puente HTTP loopback local
  }
  void fetch('/api/native/window', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    credentials: 'same-origin',
  }).catch(() => undefined);
}

const WEB_INSTALL_ID_KEY = 'recursos_web_install_id';

export function getOrCreateWebInstallId(): string {
  try {
    const existing = (localStorage.getItem(WEB_INSTALL_ID_KEY) || '').trim();
    if (existing) return existing;
    const rand =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : Math.random().toString(36).slice(2, 14) + Date.now().toString(36).slice(-4);
    const created = `web_${rand}`;
    localStorage.setItem(WEB_INSTALL_ID_KEY, created);
    return created;
  } catch {
    return '';
  }
}

interface NavigatorUADataLike {
  brands?: Array<{ brand?: string; version?: string }>;
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (
    hints: string[]
  ) => Promise<{
    architecture?: string;
    bitness?: string;
    model?: string;
    platform?: string;
    platformVersion?: string;
  }>;
}

function detectBrowserNameFromUa(ua: string): string {
  const s = ua || '';
  if (/Edg\//i.test(s)) return 'Microsoft Edge';
  if (/OPR\/|Opera/i.test(s)) return 'Opera';
  if (/Vivaldi\//i.test(s)) return 'Vivaldi';
  if (/Brave/i.test(s)) return 'Brave';
  if (/SamsungBrowser\//i.test(s)) return 'Samsung Internet';
  if (/Firefox\//i.test(s)) return 'Mozilla Firefox';
  if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) return 'Google Chrome';
  if (/Chromium\//i.test(s)) return 'Chromium';
  if (/Safari\//i.test(s) && !/Chrome|Chromium/i.test(s)) return 'Safari';
  return '';
}

export async function collectBrowserDeviceTelemetry(appVersion: string): Promise<Record<string, unknown>> {
  const env = detectNativeEnvironment();
  const baseNative = (window.__RECURSOS_DEVICE_TELEMETRY__ || {}) as Record<string, unknown>;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const ua = nav?.userAgent || '';
  const uaData = (nav as unknown as { userAgentData?: NavigatorUADataLike } | undefined)?.userAgentData;

  let architecture = '';
  let model = '';
  let osPlatform = uaData?.platform || nav?.platform || '';
  let osVersion = '';

  if (uaData?.getHighEntropyValues) {
    try {
      const high = await uaData.getHighEntropyValues([
        'architecture',
        'bitness',
        'model',
        'platform',
        'platformVersion',
      ]);
      if (high.architecture) {
        architecture = high.bitness ? `${high.architecture} (${high.bitness}-bit)` : high.architecture;
      }
      if (high.model) model = high.model;
      if (high.platform) osPlatform = high.platform;
      if (high.platformVersion) osVersion = high.platformVersion;
    } catch {
      // Ignore userAgentData permission/platform errors
    }
  }

  let browserName = '';
  if (!env.isNativeApp) {
    if (Array.isArray(uaData?.brands)) {
      const preferredBrand = uaData.brands.find(
        (b) => b.brand && !/Not.?A.?Brand|Chromium/i.test(b.brand)
      );
      browserName = preferredBrand?.brand || '';
    }
    if (!browserName) {
      browserName = detectBrowserNameFromUa(ua);
    }
  }

  const osInfo = [osPlatform, osVersion].filter(Boolean).join(' ').trim();
  const screenW = typeof window !== 'undefined' ? window.screen?.width : undefined;
  const screenH = typeof window !== 'undefined' ? window.screen?.height : undefined;
  const deviceMem = (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory;
  const hwCores = nav?.hardwareConcurrency;
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return '';
    }
  })();

  const webTelemetry: Record<string, unknown> = {
    client_type: env.isUbuntuNative
      ? 'ubuntu_native'
      : env.isAndroidNative
        ? 'android_native'
        : 'web_browser',
    full_access: env.isNativeApp,
    app_version: appVersion,
    install_id: getOrCreateWebInstallId(),
    browser_name: browserName || undefined,
    os_info: osInfo || undefined,
    architecture: architecture || undefined,
    model: model || undefined,
    cpu_cores_logical: typeof hwCores === 'number' && hwCores > 0 ? hwCores : undefined,
    ram_total_gb: typeof deviceMem === 'number' && deviceMem > 0 ? deviceMem : undefined,
    screen_width: screenW,
    screen_height: screenH,
    screen_resolution: screenW && screenH ? `${screenW}x${screenH}` : undefined,
    timezone: timezone || undefined,
    language: nav?.language || undefined,
  };

  // Preserve richer native telemetry fields while adding non-empty browser defaults
  const merged: Record<string, unknown> = { ...webTelemetry };
  for (const [k, v] of Object.entries(baseNative)) {
    if (v !== undefined && v !== null && v !== '') {
      merged[k] = v;
    }
  }
  return merged;
}

function encodeTelemetryBase64(): string {
  if (typeof window === 'undefined' || !window.__RECURSOS_DEVICE_TELEMETRY__) return '';
  try {
    const jsonStr = JSON.stringify(window.__RECURSOS_DEVICE_TELEMETRY__);
    const bytes = new TextEncoder().encode(jsonStr);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  } catch {
    return '';
  }
}

export function buildApiHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra || {});
  const token = getStoredToken();
  if (token) {
    if (!headers.has('X-Device-Token')) {
      headers.set('X-Device-Token', token);
    }
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  const env = detectNativeEnvironment();
  if (env.isUbuntuNative) {
    headers.set('X-Recursos-Env', 'native');
  } else if (env.isAndroidNative) {
    headers.set('X-Recursos-Env', 'mobile');
  } else {
    headers.set('X-Recursos-Env', 'web');
  }
  if (!headers.has('X-Device-Telemetry')) {
    const telemetryB64 = encodeTelemetryBase64();
    if (telemetryB64) {
      headers.set('X-Device-Telemetry', telemetryB64);
    }
  }
  headers.set('X-Recursos-Lang', getActiveLocale());
  return headers;
}

export async function restoreStoredSession(): Promise<boolean> {
  const token = getStoredToken();
  if (!token) return false;

  if (activeRestorePromise) {
    return activeRestorePromise;
  }

  const now = Date.now();
  if (now - lastRestoreAttemptAt < 4000) {
    return false;
  }
  lastRestoreAttemptAt = now;

  activeRestorePromise = (async () => {
    try {
      const res = await fetch('/api/auth/restore-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const data = (await res.json()) as { success?: boolean; token?: string };
        if (data?.success) {
          if (data.token) setStoredToken(data.token);
          return true;
        }
      } else if (res.status === 403) {
        clearStoredToken();
      }
    } catch {
      // ignore network error
    } finally {
      activeRestorePromise = null;
    }
    return false;
  })();

  return activeRestorePromise;
}

export async function apiFetchJson<T = Record<string, unknown>>(
  url: string,
  options?: RequestInit,
  allowAuthRetry = true
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: buildApiHeaders(options?.headers),
      credentials: 'same-origin',
    });

    if (
      res.status === 403 &&
      allowAuthRetry &&
      url !== '/api/auth/restore-session' &&
      url !== '/api/auth/unlock' &&
      getStoredToken()
    ) {
      const restored = await restoreStoredSession();
      if (restored) {
        return apiFetchJson<T>(url, options, false);
      }
    }

    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }
    if (res.ok && parsed) {
      syncAuthPersistenceFromPayload(parsed);
    }
    if (!res.ok) {
      const errMsg =
        (parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as Record<string, unknown>).error) : '') ||
        `Error HTTP ${res.status}`;
      return { ok: false, status: res.status, data: parsed, error: errMsg };
    }
    return { ok: true, status: res.status, data: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : translateStatic('errors.no_server_conn'),
    };
  }
}

