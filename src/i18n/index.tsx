import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import dictionaryCsvRaw from '../../i18n/dictionary.csv?raw';
import { mergeCsvDictionaries, parseCsvDictionary, type ParsedDictionaryCatalog } from './csvParser';
import type { DiskInfo, WifiClient } from '../types/telemetry';

export type SupportedLocale = string;

const STORAGE_KEY = 'recursos_lang';
const OTA_CSV_STORAGE_KEY = 'recursos_i18n_github_csv';
const OTA_TS_STORAGE_KEY = 'recursos_i18n_github_ts';
const OTA_SYNC_TTL_MS = 15 * 60 * 1000;
const GITHUB_DICTIONARY_RAW_URL = 'https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv';

const bundledCatalog: ParsedDictionaryCatalog = parseCsvDictionary(dictionaryCsvRaw);

function loadInitialCatalog(): ParsedDictionaryCatalog {
  if (typeof window === 'undefined') return bundledCatalog;
  try {
    const cachedCsv = window.localStorage.getItem(OTA_CSV_STORAGE_KEY);
    const cachedTs = window.localStorage.getItem(OTA_TS_STORAGE_KEY) || undefined;
    if (cachedCsv) {
      const parsedOta = parseCsvDictionary(cachedCsv);
      return mergeCsvDictionaries(bundledCatalog, parsedOta, 'github', cachedTs, true);
    }
  } catch {
    // ignore storage errors
  }
  return bundledCatalog;
}

let liveCatalog: ParsedDictionaryCatalog = loadInitialCatalog();

function resolveInitialLocale(catalog: ParsedDictionaryCatalog): SupportedLocale {
  const defLoc = catalog.meta.default_locale || 'es';
  const supported = catalog.meta.supported_locales || [defLoc];
  if (typeof window === 'undefined') return defLoc;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && supported.includes(stored)) {
      return stored;
    }
  } catch {
    // ignore storage failures
  }
  return defLoc;
}

let activeLocaleRuntime: SupportedLocale = resolveInitialLocale(liveCatalog);

function interpolate(template: string, params?: Record<string, string | number | null | undefined>): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, name) => {
    const val = params[name];
    return val === undefined || val === null ? full : String(val);
  });
}

export function getActiveLocale(): SupportedLocale {
  return activeLocaleRuntime;
}

export function translateKey(
  locale: SupportedLocale,
  key: string,
  params?: Record<string, string | number | null | undefined>,
  fallback?: string,
  catalog: ParsedDictionaryCatalog = liveCatalog
): string {
  const defLoc = catalog.meta.default_locale || 'es';
  const targetMap = catalog.flat[locale] || {};
  const defaultMap = catalog.flat[defLoc] || {};
  const raw = targetMap[key] || defaultMap[key] || fallback || key;
  return interpolate(raw, params);
}

export function translateStatic(
  key: string,
  params?: Record<string, string | number | null | undefined>,
  fallback?: string
): string {
  return translateKey(activeLocaleRuntime, key, params, fallback, liveCatalog);
}

export function formatDiskTransport(disk?: DiskInfo | null, locale: SupportedLocale = activeLocaleRuntime): string {
  if (!disk) return '';
  if (disk.transport_key) {
    return translateKey(locale, `hardware.storage.transport.${disk.transport_key}`, undefined, disk.transport || '');
  }
  const raw = (disk.transport || '').trim();
  const map: Record<string, string> = {
    'NAS · NFS': 'nas_nfs',
    'NAS · SMB': 'nas_smb',
    'USB Extraíble': 'usb_removable',
    'Tarjeta SD/MMC': 'sd_mmc',
    'SSD NVMe': 'nvme_ssd',
    'Disco SATA': 'sata_disk',
    Extraíble: 'removable',
    'Disco local': 'local_disk',
  };
  const inferred = map[raw];
  return inferred ? translateKey(locale, `hardware.storage.transport.${inferred}`, undefined, raw) : raw;
}

export function formatDiskLabel(disk?: DiskInfo | null, locale: SupportedLocale = activeLocaleRuntime): string {
  if (!disk) return translateKey(locale, 'hardware.storage.removable_fallback');
  if (disk.label_key) {
    return translateKey(locale, `hardware.storage.label.${disk.label_key}`, disk.label_params, disk.label || disk.mountpoint);
  }
  return disk.label || disk.mountpoint || translateKey(locale, 'hardware.storage.removable_fallback');
}

export function formatDiskFstype(disk?: DiskInfo | null, locale: SupportedLocale = activeLocaleRuntime): string {
  if (!disk) return '';
  if (disk.fstype_key === 'unformatted' || disk.fstype === 'sin formato') {
    return translateKey(locale, 'hardware.storage.fstype.unformatted');
  }
  return (disk.fstype || '').toUpperCase();
}

export function formatBandLabel(client?: WifiClient | null, locale: SupportedLocale = activeLocaleRuntime): string {
  if (!client) return '';
  if (client.band_key) {
    return translateKey(locale, `hardware.net.band.${client.band_key}`, client.band_params, client.band || '');
  }
  const raw = (client.band || '').trim();
  const mbpsMatch = raw.match(/^Cable\s*\((\d+)\s*Mbps\)$/i);
  if (mbpsMatch) {
    return translateKey(locale, 'hardware.net.band.cable_mbps', { mbps: mbpsMatch[1] }, raw);
  }
  const map: Record<string, string> = {
    'Cable LAN': 'cable_lan',
    'Ethernet Local': 'ethernet_local',
    'Gateway Uplink': 'gateway_uplink',
    'LAN (Offline)': 'lan_offline',
    'Wi-Fi 5 GHz': 'wifi_5ghz',
    '5 GHz': 'wifi_5ghz',
    '2.4 GHz': 'wifi_24ghz',
    '6 GHz': 'wifi_6ghz',
    'Wi-Fi (Offline)': 'wifi_offline',
  };
  const key = map[raw];
  return key ? translateKey(locale, `hardware.net.band.${key}`, undefined, raw) : raw;
}

export function formatClientVendor(client?: WifiClient | null, locale: SupportedLocale = activeLocaleRuntime): string {
  if (!client) return '';
  if (client.vendor_key) {
    return translateKey(locale, `hardware.net.device.${client.vendor_key}`, undefined, client.vendor || '');
  }
  const raw = (client.vendor || '').trim();
  const map: Record<string, string> = {
    Gateway: 'gateway',
    Servidor: 'server_node',
    'Este Servidor': 'this_server',
    'Dispositivo LAN': 'lan_device',
    Dispositivo: 'generic',
  };
  const key = map[raw];
  return key ? translateKey(locale, `hardware.net.device.${key}`, undefined, raw) : raw;
}

export function formatGpuProcessName(
  proc: { name?: string | null; name_key?: string | null } | null | undefined,
  locale: SupportedLocale = activeLocaleRuntime
): string {
  if (!proc) return translateKey(locale, 'hardware.gpu.proc.gpu_process');
  if (proc.name_key) {
    return translateKey(locale, `hardware.gpu.proc.${proc.name_key}`, undefined, proc.name || '');
  }
  const raw = (proc.name || '').trim();
  const map: Record<string, string> = {
    'Proceso GPU': 'gpu_process',
    'Google Chrome (GPU / Render)': 'chrome_gpu',
    'GNOME Shell (Compositor Wayland)': 'gnome_shell',
    'Xwayland (Compatibilidad X11)': 'xwayland',
    'Ptyxis (Terminal)': 'ptyxis',
    'Nautilus (Archivos)': 'nautilus',
    'FFmpeg (Transcodificación NVENC)': 'ffmpeg_nvenc',
    'Linux Kernel DRM': 'kernel_drm',
  };
  const key = map[raw];
  return key ? translateKey(locale, `hardware.gpu.proc.${key}`, undefined, raw) : raw;
}

export function formatSystemdState(state?: string | null, locale: SupportedLocale = activeLocaleRuntime): string {
  const clean = (state || 'unknown').trim().toLowerCase();
  return translateKey(locale, `hardware.systemd.state.${clean}`, undefined, state || clean);
}

interface I18nContextValue {
  locale: SupportedLocale;
  supportedLocales: SupportedLocale[];
  localeNames: Record<string, string>;
  otaSource: string;
  otaSyncedAt: string | null;
  isSyncingLanguages: boolean;
  setLocale: (loc: SupportedLocale) => void;
  syncFromGitHub: () => Promise<{ ok: boolean; localesCount: number; source: string }>;
  t: (key: string, params?: Record<string, string | number | null | undefined>, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: liveCatalog.meta.default_locale || 'es',
  supportedLocales: liveCatalog.meta.supported_locales,
  localeNames: liveCatalog.meta.locale_names,
  otaSource: liveCatalog.meta.ota_source || 'local',
  otaSyncedAt: liveCatalog.meta.ota_synced_at || null,
  isSyncingLanguages: false,
  setLocale: () => undefined,
  syncFromGitHub: async () => ({ ok: false, localesCount: liveCatalog.meta.supported_locales.length, source: 'local' }),
  t: (key, params, fallback) => translateKey(liveCatalog.meta.default_locale || 'es', key, params, fallback, liveCatalog),
});

function readAuthHeaders(): Record<string, string> {
  const dictHeaders: Record<string, string> = {};
  try {
    const tok = (
      window.localStorage.getItem('recursos_device_token') ||
      window.localStorage.getItem('sysmon_device_token') ||
      window.__RECURSOS_DEVICE_TOKEN__ ||
      window.RecursosAndroidBridge?.getDeviceToken?.() ||
      ''
    ).trim();
    if (tok) {
      dictHeaders['X-Device-Token'] = tok;
      dictHeaders['Authorization'] = `Bearer ${tok}`;
    }
  } catch {
    // ignore storage errors
  }
  return dictHeaders;
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<ParsedDictionaryCatalog>(liveCatalog);
  const [locale, setLocaleState] = useState<SupportedLocale>(() => resolveInitialLocale(liveCatalog));
  const [isSyncingLanguages, setIsSyncingLanguages] = useState(false);

  const applyResolvedCatalog = useCallback((nextCat: ParsedDictionaryCatalog) => {
    liveCatalog = nextCat;
    setCatalog(nextCat);
    const def = nextCat.meta.default_locale || 'es';
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && nextCat.meta.supported_locales.includes(saved)) {
        activeLocaleRuntime = saved;
        setLocaleState(saved);
        return;
      }
    } catch {
      // ignore storage errors
    }
    if (!nextCat.meta.supported_locales.includes(activeLocaleRuntime)) {
      activeLocaleRuntime = def;
      setLocaleState(def);
    }
  }, []);

  const fetchDirectFromGitHub = useCallback(async (baseCatalog: ParsedDictionaryCatalog): Promise<ParsedDictionaryCatalog | null> => {
    try {
      const ghRes = await fetch(GITHUB_DICTIONARY_RAW_URL, { cache: 'no-store' });
      if (!ghRes.ok) return null;
      const csvText = await ghRes.text();
      const parsedGh = parseCsvDictionary(csvText);
      const defLoc = parsedGh.meta.default_locale || 'es';
      if (Object.keys(parsedGh.flat?.[defLoc] || {}).length < 20) return null;
      const syncedAt = new Date().toISOString();
      try {
        window.localStorage.setItem(OTA_CSV_STORAGE_KEY, csvText);
        window.localStorage.setItem(OTA_TS_STORAGE_KEY, syncedAt);
      } catch {
        // ignore storage quota errors
      }
      return mergeCsvDictionaries(baseCatalog, parsedGh, 'github', syncedAt, true);
    } catch {
      return null;
    }
  }, []);

  const syncFromGitHub = useCallback(async (): Promise<{ ok: boolean; localesCount: number; source: string }> => {
    setIsSyncingLanguages(true);
    try {
      let nextCat = liveCatalog;
      let serverSynced = false;
      try {
        const res = await fetch('/api/dictionary?refresh=1', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: readAuthHeaders(),
        });
        if (res.ok) {
          const remote: ParsedDictionaryCatalog | null = await res.json();
          if (remote?.meta?.supported_locales?.length && remote.flat) {
            nextCat = mergeCsvDictionaries(bundledCatalog, remote, remote.meta.ota_source, remote.meta.ota_synced_at, true);
            serverSynced = remote.meta.ota_source === 'github';
          }
        }
      } catch {
        // fallback directo a GitHub si /api/dictionary no responde o no tiene salida OTA
      }

      if (!serverSynced) {
        const direct = await fetchDirectFromGitHub(nextCat);
        if (direct) {
          nextCat = direct;
          serverSynced = true;
        }
      }

      applyResolvedCatalog(nextCat);
      return {
        ok: serverSynced,
        localesCount: nextCat.meta.supported_locales.length,
        source: nextCat.meta.ota_source || 'local',
      };
    } finally {
      setIsSyncingLanguages(false);
    }
  }, [applyResolvedCatalog, fetchDirectFromGitHub]);

  // Sincronización automática OTA al iniciar (/api/dictionary + respaldo directo GitHub cada >15 min)
  useEffect(() => {
    let active = true;
    (async () => {
      let currentCat = liveCatalog;
      let serverHasGitHubOta = false;
      try {
        const res = await fetch('/api/dictionary', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: readAuthHeaders(),
        });
        if (res.ok) {
          const remote: ParsedDictionaryCatalog | null = await res.json();
          if (active && remote?.meta?.supported_locales?.length && remote.flat) {
            currentCat = mergeCsvDictionaries(bundledCatalog, remote, remote.meta.ota_source, remote.meta.ota_synced_at, true);
            serverHasGitHubOta = remote.meta.ota_source === 'github';
            applyResolvedCatalog(currentCat);
          }
        }
      } catch {
        // ignore network errors during initial dictionary check
      }

      if (!active) return;
      let shouldFetchDirect = !serverHasGitHubOta;
      try {
        const lastTsRaw = window.localStorage.getItem(OTA_TS_STORAGE_KEY);
        const lastMs = lastTsRaw ? Date.parse(lastTsRaw) : 0;
        if (Number.isFinite(lastMs) && lastMs > 0 && Date.now() - lastMs < OTA_SYNC_TTL_MS && !serverHasGitHubOta) {
          shouldFetchDirect = false;
        }
      } catch {
        // ignore
      }

      if (shouldFetchDirect) {
        const direct = await fetchDirectFromGitHub(currentCat);
        if (active && direct) {
          applyResolvedCatalog(direct);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [applyResolvedCatalog, fetchDirectFromGitHub]);

  const setLocale = useCallback(
    (next: SupportedLocale) => {
      const supported = catalog.meta.supported_locales || ['es'];
      const valid = supported.includes(next) ? next : catalog.meta.default_locale || 'es';
      activeLocaleRuntime = valid;
      setLocaleState(valid);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, valid);
        } catch {
          // ignore storage failures
        }
        document.documentElement.lang = valid;
      }
    },
    [catalog]
  );

  useEffect(() => {
    activeLocaleRuntime = locale;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number | null | undefined>, fallback?: string) =>
      translateKey(locale, key, params, fallback, catalog),
    [locale, catalog]
  );

  const value = useMemo(
    () => ({
      locale,
      supportedLocales: catalog.meta.supported_locales,
      localeNames: catalog.meta.locale_names,
      otaSource: catalog.meta.ota_source || 'local',
      otaSyncedAt: catalog.meta.ota_synced_at || null,
      isSyncingLanguages,
      setLocale,
      syncFromGitHub,
      t,
    }),
    [locale, catalog, isSyncingLanguages, setLocale, syncFromGitHub, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
