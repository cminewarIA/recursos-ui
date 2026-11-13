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
  if (tempC === null || tempC === undefined || !Number.isFinite(Number(tempC))) return 'Sin sensor';
  return `${Number(tempC).toFixed(1).replace('.', ',')} °C`;
}

export function formatPct(pct: number | null | undefined, digits = 1): string {
  const val = Number(pct || 0);
  if (!Number.isFinite(val)) return '0 %';
  return `${val.toFixed(digits).replace('.', ',')} %`;
}

export function formatRelativeIndexAge(index: number, totalLength: number, intervalSec = 1.5): string {
  const diffSamples = Math.max(0, totalLength - 1 - index);
  const secs = Math.round(diffSamples * intervalSec);
  if (secs <= 1) return 'ahora mismo';
  if (secs < 60) return `hace ${secs} s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `hace ${mins} min ${rem} s` : `hace ${mins} min`;
}

export function getHealthTone(pct: number): {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
  textClass: string;
} {
  if (pct >= 88) {
    return {
      label: 'Carga muy alta',
      tone: 'danger',
      textClass: 'text-red-600 dark:text-red-400',
    };
  }
  if (pct >= 70) {
    return {
      label: 'Carga elevada',
      tone: 'warn',
      textClass: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    label: 'Funcionando bien',
    tone: 'ok',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  };
}

export function getDisplayVersionString(rawVersion?: string, displayVer?: string): string {
  if (displayVer && displayVer.trim()) return displayVer.trim();
  if (!rawVersion) return '2B.0.0';
  if (rawVersion.startsWith('12.')) return `2B.${rawVersion.slice(3)}`;
  return rawVersion;
}

export function normalizeExternalRoute(pathStr: string): 'inicio' | 'equipo' | 'red' | 'programas' | 'mas' {
  const clean = (pathStr || '/').toLowerCase().replace(/^\/+/, '').split('/')[0];
  if (['inicio', 'resumen', ''].includes(clean)) return 'inicio';
  if (['equipo', 'procesador', 'memoria', 'grafica', 'almacenamiento', 'procesos'].includes(clean)) return 'equipo';
  if (['red', 'seguridad', 'dns', 'duckdns'].includes(clean)) return 'red';
  if (['programas', 'aplicaciones', 'multimedia', 'descargas'].includes(clean)) return 'programas';
  if (['mas', 'sistema', 'version', 'dex'].includes(clean)) return 'mas';
  return 'inicio';
}
