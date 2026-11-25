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

export type AppViewId = 'inicio' | 'equipo' | 'red' | 'programas' | 'mas';

export interface AppRouteInfo {
  view: AppViewId;
  subTab?: string;
}

const DEFAULT_SUBTAB_BY_VIEW: Record<AppViewId, string | undefined> = {
  inicio: undefined,
  equipo: 'cpu',
  red: 'home',
  programas: 'processes',
  mas: 'updates',
};

const CANONICAL_SUBTAB_SLUG: Record<AppViewId, Record<string, string>> = {
  inicio: {},
  equipo: {
    cpu: 'cpu',
    ram: 'ram',
    gpu: 'gpu',
    storage: 'almacenamiento',
  },
  red: {
    home: 'resumen',
    traffic: 'trafico',
    map: 'mapa',
    speedtest: 'testdevelocidad',
    security: 'seguridad',
    dns: 'dns',
  },
  programas: {
    processes: 'procesos',
    containers: 'contenedores',
    services: 'servicios',
    media: 'multimedia',
    bots: 'bots',
  },
  mas: {
    updates: 'actualizaciones',
    themes: 'temas',
    devices: 'dispositivos',
    manual: 'manual',
    dex: 'dex',
  },
};

export function normalizeSubTabForView(view: AppViewId, hint?: string): string | undefined {
  if (!hint) return DEFAULT_SUBTAB_BY_VIEW[view];
  const h = hint.toLowerCase().trim();
  if (view === 'equipo') {
    if (['cpu', 'procesador'].includes(h)) return 'cpu';
    if (['ram', 'memoria'].includes(h)) return 'ram';
    if (['gpu', 'grafica'].includes(h)) return 'gpu';
    if (['storage', 'almacenamiento', 'discos', 'disco'].includes(h)) return 'storage';
    return 'cpu';
  }
  if (view === 'red') {
    if (['speedtest', 'testdevelocidad', 'velocidad', 'test'].includes(h)) return 'speedtest';
    if (['map', 'mapa', 'geoip'].includes(h)) return 'map';
    if (['traffic', 'trafico', 'historial', 'history'].includes(h)) return 'traffic';
    if (['security', 'seguridad', 'shield', 'escudo'].includes(h)) return 'security';
    if (['dns', 'duckdns', 'pihole'].includes(h)) return 'dns';
    if (['home', 'resumen', 'live', 'dispositivos', 'devices', 'lan', 'wifi', 'interfaces', 'inicio'].includes(h)) return 'home';
    return 'home';
  }
  if (view === 'programas') {
    if (['processes', 'procesos', 'process'].includes(h)) return 'processes';
    if (['containers', 'contenedores', 'docker'].includes(h)) return 'containers';
    if (['services', 'servicios', 'systemd', 'aplicaciones'].includes(h)) return 'services';
    if (['media', 'multimedia', 'descargas', 'downloads', 'emby', 'torrents'].includes(h)) return 'media';
    if (['bots', 'bot', 'telegram'].includes(h)) return 'bots';
    return 'processes';
  }
  if (view === 'mas') {
    if (['themes', 'temas', 'apariencia', 'appearance', 'matrix'].includes(h)) return 'themes';
    if (['devices', 'dispositivos', 'nodos', 'security', 'seguridad'].includes(h)) return 'devices';
    if (['manual', 'manual.html', 'readme', 'ayuda', 'docs'].includes(h)) return 'manual';
    if (['dex'].includes(h)) return 'dex';
    if (['updates', 'actualizaciones', 'version', 'sistema', 'settings', 'ajustes', 'cloud', 'nube', 'health', 'salud', 'logs'].includes(h)) return 'updates';
    return 'updates';
  }
  return undefined;
}

export function resolveAppRoute(pathStr: string): AppRouteInfo {
  const clean = (pathStr || '/').split('?')[0].split('#')[0].toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!clean || clean === 'inicio' || clean === 'resumen') {
    return { view: 'inicio' };
  }

  const parts = clean.split('/');
  const p0 = parts[0];
  const p1 = parts.length > 1 ? parts[1] : undefined;

  // View-prefixed independent submenu routes (/red/testdevelocidad, /equipo/almacenamiento, /programas/procesos, /sistema/temas)
  if (['equipo', 'hardware'].includes(p0)) {
    return { view: 'equipo', subTab: normalizeSubTabForView('equipo', p1) };
  }
  if (['red', 'network'].includes(p0)) {
    return { view: 'red', subTab: normalizeSubTabForView('red', p1) };
  }
  if (['programas', 'apps', 'software', 'workloads'].includes(p0)) {
    return { view: 'programas', subTab: normalizeSubTabForView('programas', p1) };
  }
  if (['mas', 'more', 'sistema', 'system'].includes(p0)) {
    return { view: 'mas', subTab: normalizeSubTabForView('mas', p1) };
  }

  // Direct top-level shorthand aliases (/speedtest, /testdevelocidad, /cpu, /procesos, /temas, /dex, etc.)
  if (['speedtest', 'testdevelocidad', 'velocidad'].includes(p0)) return { view: 'red', subTab: 'speedtest' };
  if (['mapa', 'map', 'geoip'].includes(p0)) return { view: 'red', subTab: 'map' };
  if (['trafico', 'traffic', 'historial', 'history'].includes(p0)) return { view: 'red', subTab: 'traffic' };
  if (['seguridad', 'security', 'shield', 'escudo'].includes(p0)) return { view: 'red', subTab: 'security' };
  if (['dns', 'duckdns', 'pihole'].includes(p0)) return { view: 'red', subTab: 'dns' };
  if (['cpu', 'procesador'].includes(p0)) return { view: 'equipo', subTab: 'cpu' };
  if (['ram', 'memoria'].includes(p0)) return { view: 'equipo', subTab: 'ram' };
  if (['gpu', 'grafica'].includes(p0)) return { view: 'equipo', subTab: 'gpu' };
  if (['almacenamiento', 'storage', 'discos', 'disco'].includes(p0)) return { view: 'equipo', subTab: 'storage' };
  if (['procesos', 'processes'].includes(p0)) return { view: 'programas', subTab: 'processes' };
  if (['contenedores', 'containers', 'docker'].includes(p0)) return { view: 'programas', subTab: 'containers' };
  if (['aplicaciones', 'servicios', 'services', 'systemd'].includes(p0)) return { view: 'programas', subTab: 'services' };
  if (['multimedia', 'media', 'descargas', 'downloads', 'emby', 'torrents'].includes(p0)) return { view: 'programas', subTab: 'media' };
  if (['bots', 'bot', 'telegram'].includes(p0)) return { view: 'programas', subTab: 'bots' };
  if (['temas', 'themes', 'apariencia', 'appearance'].includes(p0)) return { view: 'mas', subTab: 'themes' };
  if (['actualizaciones', 'updates', 'version', 'ajustes', 'settings', 'cloud', 'nube', 'health', 'salud', 'logs'].includes(p0)) return { view: 'mas', subTab: 'updates' };
  if (['dispositivos', 'devices', 'nodos'].includes(p0)) return { view: 'mas', subTab: 'devices' };
  if (['dex'].includes(p0)) return { view: 'mas', subTab: 'dex' };
  if (['manual', 'manual.html', 'readme', 'ayuda', 'docs'].includes(p0)) return { view: 'mas', subTab: 'manual' };

  return { view: 'inicio' };
}

export function formatCanonicalRoute(view: AppViewId, subTab?: string): string {
  if (view === 'inicio') return '/';
  const viewSlug = view === 'mas' ? 'sistema' : view;
  const normalized = normalizeSubTabForView(view, subTab);
  if (!normalized) return `/${viewSlug}`;
  const slug = CANONICAL_SUBTAB_SLUG[view]?.[normalized] || normalized;
  return `/${viewSlug}/${slug}`;
}

export function normalizeExternalRoute(pathStr: string): AppViewId {
  return resolveAppRoute(pathStr).view;
}

export function extractInitialSubTabFromRoute(pathStr: string): string | undefined {
  return resolveAppRoute(pathStr).subTab;
}
