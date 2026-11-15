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
