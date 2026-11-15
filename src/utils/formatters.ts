import { getCanonicalDisplayVersion } from './version';
import { translateStatic } from '../i18n';

export function formatBytes(bytes: number | undefined | null, decimals = 1): string {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), units.length - 1);
  const val = b / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number | undefined | null): string {
  const b = Number(bytesPerSec || 0);
  if (!Number.isFinite(b) || b <= 0) return '0 KB/s';
  if (b < 1024) return `${Math.round(b)} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB/s`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

export function formatMbRate(mbPerSec: number | undefined | null): string {
  const val = Number(mbPerSec || 0);
  if (!Number.isFinite(val) || val <= 0) return '0,0 MB/s';
  return `${val.toFixed(val >= 100 ? 0 : 1).replace('.', ',')} MB/s`;
}

export function formatTemp(tempC: number | null | undefined): string {
  if (tempC === null || tempC === undefined || !Number.isFinite(Number(tempC))) {
    return translateStatic('hardware.telemetry.no_sensor');
  }
  return `${Number(tempC).toFixed(1).replace('.', ',')} ${translateStatic('units.celsius')}`;
}

export function formatPct(pct: number | null | undefined, digits = 1): string {
  const val = Number(pct || 0);
  if (!Number.isFinite(val)) return `0 ${translateStatic('units.percent')}`;
  return `${val.toFixed(digits).replace('.', ',')} ${translateStatic('units.percent')}`;
}

export function formatRelativeIndexAge(index: number, totalLength: number, intervalSec = 1.5): string {
  const diffSamples = Math.max(0, totalLength - 1 - index);
  const secs = Math.round(diffSamples * intervalSec);
  if (secs <= 1) return translateStatic('time.just_now');
  if (secs < 60) return translateStatic('time.seconds_ago', { seconds: secs });
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0
    ? translateStatic('time.minutes_seconds_ago', { minutes: mins, seconds: rem })
    : translateStatic('time.minutes_ago', { minutes: mins });
}

export function getHealthTone(pct: number): {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
  textClass: string;
} {
  if (pct >= 88) {
    return {
      label: translateStatic('health.load_very_high'),
      tone: 'danger',
      textClass: 'text-red-600 dark:text-red-400',
    };
  }
  if (pct >= 70) {
    return {
      label: translateStatic('health.load_elevated'),
      tone: 'warn',
      textClass: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    label: translateStatic('health.working_well'),
    tone: 'ok',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  };
}

export function getDisplayVersionString(rawVersion?: string, displayVer?: string): string {
  return getCanonicalDisplayVersion(
    rawVersion || displayVer ? { current_version: rawVersion || '', display_version: displayVer } : undefined
  );
}

export function normalizeExternalRoute(pathStr: string): 'inicio' | 'equipo' | 'red' | 'programas' | 'mas' {
  const clean = (pathStr || '/').toLowerCase().replace(/^\/+/, '').split('/')[0];
  if (['inicio', 'resumen', ''].includes(clean)) return 'inicio';
  if (['equipo', 'procesador', 'cpu', 'memoria', 'ram', 'grafica', 'gpu', 'almacenamiento', 'storage', 'procesos', 'processes'].includes(clean)) return 'equipo';
  if (['red', 'seguridad', 'security', 'dns', 'duckdns', 'mapa', 'map'].includes(clean)) return 'red';
  if (['programas', 'aplicaciones', 'servicios', 'services', 'multimedia', 'media', 'descargas', 'downloads'].includes(clean)) return 'programas';
  if (['mas', 'sistema', 'version', 'updates', 'dispositivos', 'devices', 'dex', 'logs', 'manual', 'manual.html', 'readme', 'ayuda', 'docs'].includes(clean)) return 'mas';
  return 'inicio';
}

export function extractInitialSubTabFromRoute(pathStr: string): string | undefined {
  const clean = (pathStr || '/').toLowerCase().replace(/^\/+/, '').split('/')[0];
  if (['procesador', 'cpu'].includes(clean)) return 'cpu';
  if (['memoria', 'ram'].includes(clean)) return 'ram';
  if (['grafica', 'gpu'].includes(clean)) return 'gpu';
  if (['almacenamiento', 'storage'].includes(clean)) return 'storage';
  if (['procesos', 'processes'].includes(clean)) return 'processes';
  if (['seguridad', 'security'].includes(clean)) return 'security';
  if (['dns', 'duckdns'].includes(clean)) return 'dns';
  if (['mapa', 'map'].includes(clean)) return 'map';
  if (['multimedia', 'media', 'descargas', 'downloads'].includes(clean)) return 'media';
  if (['aplicaciones', 'servicios', 'services'].includes(clean)) return 'services';
  if (['sistema', 'version', 'updates'].includes(clean)) return 'updates';
  if (['dispositivos', 'devices'].includes(clean)) return 'devices';
  if (['logs'].includes(clean)) return 'logs';
  if (['dex'].includes(clean)) return 'dex';
  if (['manual', 'manual.html', 'readme', 'ayuda', 'docs'].includes(clean)) return 'manual';
  return undefined;
}
