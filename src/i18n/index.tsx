import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import dictionaryCsvRaw from '../../i18n/dictionary.csv?raw';
import { parseCsvDictionary, type ParsedDictionaryCatalog } from './csvParser';
import type { DiskInfo, WifiClient } from '../types/telemetry';

export type SupportedLocale = string;

const STORAGE_KEY = 'recursos_lang';

let liveCatalog: ParsedDictionaryCatalog = parseCsvDictionary(dictionaryCsvRaw);

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
    return translateKey(locale, `hardware.net.band.${client.band_key}`, undefined, client.band || '');
  }
  const raw = (client.band || '').trim();
  const map: Record<string, string> = {
    'Cable LAN': 'cable_lan',
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
    'Dispositivo LAN': 'lan_device',
    Dispositivo: 'generic',
  };
  const key = map[raw];
  return key ? translateKey(locale, `hardware.net.device.${key}`, undefined, raw) : raw;
}

export function formatGpuProcessName(
  proc: { name?: string; name_key?: string } | null | undefined,
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
  setLocale: (loc: SupportedLocale) => void;
  t: (key: string, params?: Record<string, string | number | null | undefined>, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: liveCatalog.meta.default_locale || 'es',
  supportedLocales: liveCatalog.meta.supported_locales,
  localeNames: liveCatalog.meta.locale_names,
  setLocale: () => undefined,
  t: (key, params, fallback) => translateKey(liveCatalog.meta.default_locale || 'es', key, params, fallback, liveCatalog),
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<ParsedDictionaryCatalog>(liveCatalog);
  const [locale, setLocaleState] = useState<SupportedLocale>(() => resolveInitialLocale(liveCatalog));

  // Sincronización en vivo con /api/dictionary (si se añade una nueva columna al CSV sin recompilar el frontend)
  useEffect(() => {
    let active = true;
    fetch('/api/dictionary', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((remote: ParsedDictionaryCatalog | null) => {
        if (!active || !remote || !remote.meta?.supported_locales?.length || !remote.flat) return;
        liveCatalog = remote;
        setCatalog(remote);
        const def = remote.meta.default_locale || 'es';
        try {
          const saved = window.localStorage.getItem(STORAGE_KEY);
          if (saved && remote.meta.supported_locales.includes(saved)) {
            activeLocaleRuntime = saved;
            setLocaleState(saved);
            return;
          }
        } catch {
          // ignore
        }
        if (!remote.meta.supported_locales.includes(activeLocaleRuntime)) {
          activeLocaleRuntime = def;
          setLocaleState(def);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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
      setLocale,
      t,
    }),
    [locale, catalog, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
