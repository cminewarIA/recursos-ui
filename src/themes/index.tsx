import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import bundledAlethiaMatrix from '../../themes/alethia-matrix.json';
import { ThemeMode } from '../types/telemetry';
import { buildApiHeaders, detectNativeEnvironment } from '../utils/api';
import {
  ALLOWED_THEME_CSS_TOKENS,
  getActiveThemeModeTokens,
  isSafeGoogleFontsQuery,
  resolveThemeEffectiveMode,
  sanitizeAssetsMap,
  sanitizeClientThemeDefinition,
  ThemeCatalogResponse,
  ThemeDefinition,
} from './types';

const STORAGE_THEME_ID_KEY = 'recursos_theme_id';
const STORAGE_THEME_MODE_KEY = 'recursos_theme';
const STORAGE_THEMES_OTA_CACHE_KEY = 'recursos_themes_ota_cache_v2';
const GITHUB_THEMES_BASE_URL = 'https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/themes';
const GITHUB_THEMES_PACK_URL = `${GITHUB_THEMES_BASE_URL}/themes-pack.rcpack.gz`;
const GITHUB_THEMES_MANIFEST_URL = `${GITHUB_THEMES_BASE_URL}/themes.json`;
const MAX_CLIENT_PACK_BYTES = 8 * 1024 * 1024;
const THEME_FONTS_LINK_ID = 'cockpit-theme-fonts';

const BUNDLED_DEFAULT_THEME: ThemeDefinition = sanitizeClientThemeDefinition(
  bundledAlethiaMatrix,
  'local'
) as ThemeDefinition;

interface CachedOtaThemesMeta {
  pack_version: string;
  pack_file: string;
  default_theme: string;
  source: 'local' | 'github';
  synced_at: number | null;
  themes: ThemeDefinition[];
}

export interface ThemeSyncResult {
  ok: boolean;
  count: number;
  source: 'local' | 'github';
  packVersion?: string;
}

interface ThemeCatalogContextValue {
  /** Effective rendered mode (respecting locked-dark / locked-light game atmospheres). */
  mode: ThemeMode;
  /** User's saved light/dark preference used by dual-mode themes (Matrix, Navidad). */
  preferredMode: ThemeMode;
  /** True when the active theme locks light/dark mode to preserve its authentic game atmosphere. */
  isModeLocked: boolean;
  setMode: (next: ThemeMode) => void;
  themes: ThemeDefinition[];
  assets: Record<string, string>;
  packVersion: string;
  packFile: string;
  activeThemeId: string;
  activeTheme: ThemeDefinition;
  activeBackdropUrl: string | null;
  getThemeBackdropUrl: (theme: ThemeDefinition) => string | null;
  selectTheme: (themeId: string) => void;
  otaSource: 'local' | 'github';
  syncedAt: number | null;
  isSyncingThemes: boolean;
  syncThemesFromGitHub: () => Promise<ThemeSyncResult>;
  reloadThemesFromServer: () => Promise<void>;
}

const ThemeCatalogContext = createContext<ThemeCatalogContextValue | null>(null);

function readInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_THEME_MODE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    const nativePref =
      window.__RECURSOS_INITIAL_THEME__ ||
      window.RecursosAndroidBridge?.getPreferredTheme?.();
    if (nativePref === 'dark' || nativePref === 'light') return nativePref;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore storage errors
  }
  return 'light';
}

function readCachedThemes(): CachedOtaThemesMeta | null {
  try {
    const raw = localStorage.getItem(STORAGE_THEMES_OTA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedOtaThemesMeta>;
    if (!parsed || !Array.isArray(parsed.themes) || parsed.themes.length === 0) return null;
    const valid = parsed.themes
      .map((item) => sanitizeClientThemeDefinition(item, item?.source === 'github' ? 'github' : 'local'))
      .filter((x): x is ThemeDefinition => Boolean(x));
    if (valid.length === 0) return null;
    return {
      pack_version: typeof parsed.pack_version === 'string' ? parsed.pack_version : '2.0.0',
      pack_file: typeof parsed.pack_file === 'string' ? parsed.pack_file : 'themes-pack.rcpack.gz',
      default_theme: typeof parsed.default_theme === 'string' ? parsed.default_theme : BUNDLED_DEFAULT_THEME.id,
      source: parsed.source === 'github' ? 'github' : 'local',
      synced_at: typeof parsed.synced_at === 'number' ? parsed.synced_at : null,
      themes: valid,
    };
  } catch {
    return null;
  }
}

const PREFERRED_THEME_ORDER = [
  'alethia-matrix',
  'navidad-escarcha',
  'cyberpunk-2077',
  'gta-iii',
  'gta-vice-city',
  'gta-san-andreas',
  'gta-iv',
  'gta-v',
  'gta-vi',
];

function mergeThemeLists(base: ThemeDefinition[], incoming: ThemeDefinition[]): ThemeDefinition[] {
  const byId = new Map<string, ThemeDefinition>();
  for (const t of base) byId.set(t.id, t);
  for (const t of incoming) byId.set(t.id, t);
  const list = Array.from(byId.values());
  list.sort((a, b) => {
    const ia = PREFERRED_THEME_ORDER.indexOf(a.id);
    const ib = PREFERRED_THEME_ORDER.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.id.localeCompare(b.id);
  });
  return list;
}

function syncGoogleFontsLink(theme: ThemeDefinition) {
  if (typeof document === 'undefined') return;
  const query = theme.typography?.googleFontsFamily;
  const existing = document.getElementById(THEME_FONTS_LINK_ID) as HTMLLinkElement | null;

  if (!query || !isSafeGoogleFontsQuery(query)) {
    if (existing) existing.remove();
    return;
  }

  const href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  if (existing) {
    if (existing.href !== href) {
      existing.href = href;
    }
    return;
  }

  const link = document.createElement('link');
  link.id = THEME_FONTS_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

function applyThemeTokensToDom(theme: ThemeDefinition, effectiveMode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const layout = theme.layout || {
    navPosition: 'bottom-dock',
    surfaceShape: 'rounded',
    headerStyle: 'editorial',
  };

  root.setAttribute('data-theme', effectiveMode);
  root.setAttribute('data-cockpit-theme-id', theme.id);
  root.setAttribute('data-cockpit-layout', layout.navPosition);
  root.setAttribute('data-cockpit-surface', layout.surfaceShape);
  root.setAttribute('data-cockpit-header', layout.headerStyle);

  if (effectiveMode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');

  const tokens = getActiveThemeModeTokens(theme, effectiveMode);
  for (const key of ALLOWED_THEME_CSS_TOKENS) {
    if (tokens[key]) {
      root.style.setProperty(key, tokens[key]);
    } else {
      root.style.removeProperty(key);
    }
  }

  // Apply theme typography custom properties cleanly
  if (theme.typography?.displayFont) {
    root.style.setProperty('--font-display', theme.typography.displayFont);
  }
  if (theme.typography?.bodyFont) {
    root.style.setProperty('--font-sans', theme.typography.bodyFont);
  }
  if (theme.typography?.monoFont) {
    root.style.setProperty('--font-mono', theme.typography.monoFont);
  }

  syncGoogleFontsLink(theme);
}

function notifyNativeThemeBridges(theme: ThemeDefinition, effectiveMode: ThemeMode) {
  if (typeof window === 'undefined') return;
  const tokens = getActiveThemeModeTokens(theme, effectiveMode);
  const canvasHex = tokens['--bg-canvas'] || (effectiveMode === 'dark' ? '#061007' : '#edf6e9');
  const accentHex = tokens['--accent'] || (effectiveMode === 'dark' ? '#c6f19d' : '#1e6b38');

  try {
    window.RecursosAndroidBridge?.onThemeChanged?.(effectiveMode);
  } catch {
    // ignore
  }
  try {
    window.RecursosAndroidBridge?.onThemePaletteChanged?.(effectiveMode, theme.id, canvasHex, accentHex);
  } catch {
    // ignore
  }
  try {
    window.webkit?.messageHandlers?.recursosTheme?.postMessage?.(effectiveMode);
  } catch {
    // ignore
  }
  if (detectNativeEnvironment().isUbuntuNative) {
    void fetch('/api/native/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: effectiveMode,
        theme_id: theme.id,
        canvas: canvasHex,
        accent: accentHex,
      }),
    }).catch(() => {
      // ignore
    });
  }
}

async function fetchDirectPackFromUrl(
  url: string,
  source: 'local' | 'github',
  useApiAuth = false
): Promise<ThemeCatalogResponse | null> {
  try {
    if (typeof DecompressionStream === 'undefined') return null;
    const res = await fetch(url, {
      cache: 'no-store',
      ...(useApiAuth ? { headers: buildApiHeaders(), credentials: 'same-origin' as RequestCredentials } : {}),
    });
    if (!res.ok || !res.body) return null;
    const contentLen = Number(res.headers.get('content-length') || 0);
    if (contentLen > MAX_CLIENT_PACK_BYTES) return null;

    const decompressedStream = res.body.pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(decompressedStream).text();
    if (!text || text.length > 16 * 1024 * 1024) return null;
    const parsed = JSON.parse(text) as Partial<ThemeCatalogResponse>;
    if (!parsed || !Array.isArray(parsed.themes) || parsed.themes.length === 0) return null;

    const cleanAssets = sanitizeAssetsMap(parsed.assets);
    const cleanThemes = parsed.themes
      .map((item) => sanitizeClientThemeDefinition(item, source))
      .filter((x): x is ThemeDefinition => Boolean(x));
    if (cleanThemes.length === 0) return null;

    return {
      ok: true,
      schema_version: 2,
      pack_version: typeof parsed.pack_version === 'string' ? parsed.pack_version : '2.0.0',
      pack_file: 'themes-pack.rcpack.gz',
      pack_sha256: typeof parsed.pack_sha256 === 'string' ? parsed.pack_sha256 : '',
      default_theme: typeof parsed.default_theme === 'string' ? parsed.default_theme : BUNDLED_DEFAULT_THEME.id,
      source,
      synced_at: Math.floor(Date.now() / 1000),
      assets: cleanAssets,
      themes: cleanThemes,
    };
  } catch {
    return null;
  }
}

function parseSemverTuple(v: string): number[] {
  const m = String(v || '').trim().match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
}

function isVersionHigher(candidate: string, current: string): boolean {
  const a = parseSemverTuple(candidate);
  const b = parseSemverTuple(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function fetchDirectLooseThemesFromGitHub(
  existingThemes: ThemeDefinition[]
): Promise<ThemeDefinition[]> {
  try {
    const manifestRes = await fetch(GITHUB_THEMES_MANIFEST_URL, { cache: 'no-store' });
    if (!manifestRes.ok) return [];
    const manifest = (await manifestRes.json()) as {
      themes?: Array<{ id?: string; file?: string; version?: string }>;
    };
    const entries = Array.isArray(manifest?.themes) ? manifest.themes : [];
    const existingById = new Map(existingThemes.map((t) => [t.id, t]));
    const downloaded: ThemeDefinition[] = [];

    for (const entry of entries) {
      const file = String(entry?.file || '').trim();
      if (!file || !/^[a-zA-Z0-9._-]+\.json$/.test(file) || file === 'themes.json') continue;
      const tid = String(entry?.id || '').trim().toLowerCase();
      const manifestVer = String(entry?.version || '').trim();
      const existing = tid ? existingById.get(tid) : undefined;
      if (existing && manifestVer && !isVersionHigher(manifestVer, existing.version || '0.0.0')) {
        continue;
      }
      try {
        const tRes = await fetch(`${GITHUB_THEMES_BASE_URL}/${encodeURIComponent(file)}`, {
          cache: 'no-store',
        });
        if (!tRes.ok) continue;
        const raw = await tRes.json();
        const cleaned = sanitizeClientThemeDefinition(raw, 'github');
        if (cleaned) {
          downloaded.push(cleaned);
        }
      } catch {
        // skip individual theme fetch failure
      }
    }
    return downloaded;
  } catch {
    return [];
  }
}

export const ThemeCatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cachedInitial = useMemo(() => readCachedThemes(), []);
  const [preferredMode, setPreferredModeState] = useState<ThemeMode>(readInitialMode);
  const [themes, setThemes] = useState<ThemeDefinition[]>(() =>
    mergeThemeLists([BUNDLED_DEFAULT_THEME], cachedInitial?.themes || [])
  );
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [packVersion, setPackVersion] = useState<string>(cachedInitial?.pack_version || '2.0.0');
  const [packFile, setPackFile] = useState<string>(cachedInitial?.pack_file || 'themes-pack.rcpack.gz');
  const [otaSource, setOtaSource] = useState<'local' | 'github'>(cachedInitial?.source || 'local');
  const [syncedAt, setSyncedAt] = useState<number | null>(cachedInitial?.synced_at ?? null);
  const [isSyncingThemes, setIsSyncingThemes] = useState(false);

  const [activeThemeId, setActiveThemeId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_THEME_ID_KEY)?.trim().toLowerCase();
      if (stored) return stored;
    } catch {
      // ignore
    }
    return cachedInitial?.default_theme || BUNDLED_DEFAULT_THEME.id;
  });

  const activeTheme = useMemo(() => {
    return themes.find((item) => item.id === activeThemeId) || themes[0] || BUNDLED_DEFAULT_THEME;
  }, [themes, activeThemeId]);

  const effectiveMode = useMemo(
    () => resolveThemeEffectiveMode(activeTheme, preferredMode),
    [activeTheme, preferredMode]
  );

  const isModeLocked = activeTheme.colorModePolicy === 'locked-dark' || activeTheme.colorModePolicy === 'locked-light';

  const getThemeBackdropUrl = useCallback(
    (theme: ThemeDefinition): string | null => {
      const assetId = theme.backdrop?.assetId;
      if (!assetId) return null;
      return assets[assetId] || null;
    },
    [assets]
  );

  const activeBackdropUrl = useMemo(
    () => getThemeBackdropUrl(activeTheme),
    [activeTheme, getThemeBackdropUrl]
  );

  const commitCatalog = useCallback((payload: ThemeCatalogResponse) => {
    const cleaned = (payload.themes || [])
      .map((item) => sanitizeClientThemeDefinition(item, item?.source === 'github' ? 'github' : payload.source))
      .filter((x): x is ThemeDefinition => Boolean(x));
    if (cleaned.length === 0) return 0;

    if (payload.assets && typeof payload.assets === 'object') {
      const cleanAssets = sanitizeAssetsMap(payload.assets);
      if (Object.keys(cleanAssets).length > 0) {
        setAssets((prev) => ({ ...prev, ...cleanAssets }));
      }
    }

    const nextPackVer = payload.pack_version || '2.0.0';
    const nextPackFile = payload.pack_file || 'themes-pack.rcpack.gz';
    setPackVersion(nextPackVer);
    setPackFile(nextPackFile);

    let mergedLen = cleaned.length;
    setThemes((prev) => {
      const merged = mergeThemeLists([BUNDLED_DEFAULT_THEME, ...prev.filter((t) => t.source === 'local')], cleaned);
      mergedLen = merged.length;
      try {
        localStorage.setItem(
          STORAGE_THEMES_OTA_CACHE_KEY,
          JSON.stringify({
            pack_version: nextPackVer,
            pack_file: nextPackFile,
            default_theme: payload.default_theme || BUNDLED_DEFAULT_THEME.id,
            source: payload.source === 'github' ? 'github' : 'local',
            synced_at: payload.synced_at ?? Math.floor(Date.now() / 1000),
            themes: merged,
          } satisfies CachedOtaThemesMeta)
        );
      } catch {
        // ignore quota errors
      }
      return merged;
    });

    setOtaSource(payload.source === 'github' ? 'github' : 'local');
    if (typeof payload.synced_at === 'number') {
      setSyncedAt(payload.synced_at);
    }
    return mergedLen;
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setPreferredModeState(next);
    try {
      localStorage.setItem(STORAGE_THEME_MODE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const selectTheme = useCallback((themeId: string) => {
    const clean = themeId.trim().toLowerCase();
    setActiveThemeId(clean);
    try {
      localStorage.setItem(STORAGE_THEME_ID_KEY, clean);
    } catch {
      // ignore
    }
  }, []);

  // Apply CSS tokens, typography, layout attributes & native bridge sync
  useEffect(() => {
    applyThemeTokensToDom(activeTheme, effectiveMode);
    notifyNativeThemeBridges(activeTheme, effectiveMode);
  }, [activeTheme, effectiveMode]);

  const syncThemesFromGitHub = useCallback(async (): Promise<ThemeSyncResult> => {
    setIsSyncingThemes(true);
    try {
      const apiRes = await fetch('/api/themes/sync', {
        method: 'POST',
        cache: 'no-store',
        headers: buildApiHeaders(),
        credentials: 'same-origin',
      });
      if (apiRes.status === 403) {
        return { ok: false, count: themes.length, source: otaSource, packVersion };
      }
      if (apiRes.ok) {
        const data = (await apiRes.json()) as ThemeCatalogResponse & { sync_result?: { ok?: boolean } };
        if (data && Array.isArray(data.themes) && data.themes.length > 0) {
          const count = commitCatalog(data);
          const src = data.source === 'github' ? 'github' : 'local';
          if (data.sync_result?.ok || src === 'github') {
            return { ok: true, count, source: src, packVersion: data.pack_version };
          }
        }
      }
    } catch {
      // fall through to direct hybrid sync from GitHub
    }

    try {
      const directPack = await fetchDirectPackFromUrl(GITHUB_THEMES_PACK_URL, 'github');
      const baseThemes = directPack?.themes || themes;
      const looseThemes = await fetchDirectLooseThemesFromGitHub(baseThemes);
      if (directPack || looseThemes.length > 0) {
        const mergedList = mergeThemeLists(directPack?.themes || [], looseThemes);
        const combinedPayload: ThemeCatalogResponse = {
          ok: true,
          schema_version: 2,
          pack_version: directPack?.pack_version || packVersion,
          pack_file: directPack?.pack_file || packFile,
          pack_sha256: directPack?.pack_sha256 || '',
          default_theme: directPack?.default_theme || BUNDLED_DEFAULT_THEME.id,
          source: 'github',
          synced_at: Math.floor(Date.now() / 1000),
          assets: directPack?.assets || {},
          themes: mergedList,
        };
        const count = commitCatalog(combinedPayload);
        return { ok: true, count, source: 'github', packVersion: combinedPayload.pack_version };
      }
      const localPack = await fetchDirectPackFromUrl('/api/themes/pack', 'local', true);
      if (localPack && localPack.themes.length > 0) {
        const count = commitCatalog(localPack);
        return { ok: true, count, source: 'local', packVersion: localPack.pack_version };
      }
      return { ok: false, count: themes.length, source: otaSource, packVersion };
    } finally {
      setIsSyncingThemes(false);
    }
  }, [commitCatalog, otaSource, packFile, packVersion, themes]);

  const reloadThemesFromServer = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/themes', {
        cache: 'no-store',
        headers: buildApiHeaders(),
        credentials: 'same-origin',
      });
      if (res.status === 403) {
        // Zero-Trust locked: do not load extra themes until LAN certification succeeds
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as ThemeCatalogResponse;
        if (data && Array.isArray(data.themes) && data.themes.length > 0) {
          commitCatalog(data);
          return;
        }
      }
    } catch {
      // fallback below
    }
    const localPack = await fetchDirectPackFromUrl('/api/themes/pack', 'local', true);
    if (localPack) {
      commitCatalog(localPack);
    }
  }, [commitCatalog]);

  // Automatic background fetch of /api/themes on mount (respects Zero-Trust 403 silently)
  const didBootFetchRef = useRef(false);
  useEffect(() => {
    if (didBootFetchRef.current) return;
    didBootFetchRef.current = true;
    void reloadThemesFromServer();
  }, [reloadThemesFromServer]);

  const value = useMemo<ThemeCatalogContextValue>(
    () => ({
      mode: effectiveMode,
      preferredMode,
      isModeLocked,
      setMode,
      themes,
      assets,
      packVersion,
      packFile,
      activeThemeId: activeTheme.id,
      activeTheme,
      activeBackdropUrl,
      getThemeBackdropUrl,
      selectTheme,
      otaSource,
      syncedAt,
      isSyncingThemes,
      syncThemesFromGitHub,
      reloadThemesFromServer,
    }),
    [
      effectiveMode,
      preferredMode,
      isModeLocked,
      setMode,
      themes,
      assets,
      packVersion,
      packFile,
      activeTheme,
      activeBackdropUrl,
      getThemeBackdropUrl,
      selectTheme,
      otaSource,
      syncedAt,
      isSyncingThemes,
      syncThemesFromGitHub,
      reloadThemesFromServer,
    ]
  );

  return <ThemeCatalogContext.Provider value={value}>{children}</ThemeCatalogContext.Provider>;
};

export function useThemeCatalog(): ThemeCatalogContextValue {
  const ctx = useContext(ThemeCatalogContext);
  if (!ctx) {
    throw new Error('useThemeCatalog must be used within ThemeCatalogProvider');
  }
  return ctx;
}

export * from './types';
