import type { VersionInfo } from '../types/telemetry';

declare const __APP_VERSION__: string;

/**
 * Fuente y llamada única de versión en el cliente React/TypeScript.
 * Prioriza el payload en vivo del backend, la inyección inicial del servidor/puente
 * nativo y la constante compilada directamente desde `./VERSION` vía Vite.
 */
export function getCanonicalVersion(versionInfo?: VersionInfo | null): string {
  const fromPayload = String(
    versionInfo?.current_version || versionInfo?.app_version || versionInfo?.version || ''
  )
    .trim()
    .replace(/^[vV]/, '');
  if (fromPayload) return fromPayload;

  if (typeof window !== 'undefined') {
    const fromWindow = String(window.__INITIAL_APP_VERSION__ || '')
      .trim()
      .replace(/^[vV]/, '');
    if (fromWindow) return fromWindow;

    const fromBridge = String(window.AndroidBridge?.getAppVersion?.() || '')
      .trim()
      .replace(/^[vV]/, '');
    if (fromBridge) return fromBridge;
  }

  const fromBuild = typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__).trim().replace(/^[vV]/, '') : '';
  return fromBuild || '0.0.0';
}

export function getCanonicalDisplayVersion(versionInfo?: VersionInfo | null): string {
  const explicitDisplay = String(versionInfo?.display_version || '').trim();
  if (explicitDisplay) return explicitDisplay;

  if (typeof window !== 'undefined') {
    const winDisplay = String(window.__INITIAL_DISPLAY_VERSION__ || '').trim();
    if (winDisplay) return winDisplay;
  }

  return getCanonicalVersion(versionInfo);
}

export function compareVersions(a: string, b: string): number {
  const parsePart = (part: string): [number, string] => {
    const trimmed = part.trim();
    if (/^\d+$/.test(trimmed)) return [Number.parseInt(trimmed, 10), ''];
    const m = trimmed.match(/^(\d+)(.*)$/);
    if (m) return [Number.parseInt(m[1], 10), m[2]];
    return [0, trimmed];
  };

  const splitParts = (val: string) =>
    String(val || '')
      .trim()
      .replace(/^[vV]/, '')
      .split(/[-+]/)[0]
      .split('.')
      .filter((p) => p.length > 0)
      .map(parsePart);

  const partsA = splitParts(a);
  const partsB = splitParts(b);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const [numA, sufA] = partsA[i] ?? [0, ''];
    const [numB, sufB] = partsB[i] ?? [0, ''];
    if (numA > numB) return 1;
    if (numA < numB) return -1;
    if (sufA !== sufB) return sufA > sufB ? 1 : -1;
  }
  return 0;
}

export function isRemoteVersionHigher(
  versionInfo?: VersionInfo | null,
  currentOverride?: string
): boolean {
  if (!versionInfo) return false;
  const remoteRaw = String(versionInfo.remote_version || versionInfo.github_version || '')
    .trim()
    .replace(/^[vV]/, '');
  const currentRaw = String(currentOverride || getCanonicalVersion(versionInfo))
    .trim()
    .replace(/^[vV]/, '');

  if (remoteRaw && remoteRaw !== '0.0.0' && currentRaw && currentRaw !== '0.0.0') {
    return compareVersions(remoteRaw, currentRaw) > 0;
  }
  return Boolean(
    versionInfo.effective_update_available ||
      versionInfo.github_above_server ||
      versionInfo.github_above_app ||
      versionInfo.update_available
  );
}
