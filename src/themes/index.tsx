import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import bundledAlethiaMatrix from '../../themes/alethia-matrix.json';
import { ThemeMode } from '../types/telemetry';
import { detectNativeEnvironment } from '../utils/api';
import {
  ALLOWED_THEME_CSS_TOKENS,
  getActiveThemeModeTokens,
  sanitizeClientThemeDefinition,
  ThemeCatalogResponse,
  ThemeDefinition,
  ThemeManifestEntry,
} from './types';

const STORAGE_THEME_ID_KEY = 'recursos_theme_id';
const STORAGE_THEME_MODE_KEY = 'recursos_theme';
const STORAGE_THEMES_OTA_CACHE_KEY = 'recursos_themes_ota_cache_v1';
const GITHUB_THEMES_BASE_URL = 'https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/themes';

const BUNDLED_DEFAULT_THEME: ThemeDefinition = sanitizeClientThemeDefinition(
  bundledAlethiaMatrix,
  'local'
) as ThemeDefinition;

interface CachedOtaThemesPayload {
  default_theme: string;
  source: 'local' | 'github';
  synced_at: number | null;
  themes: ThemeDefinition[];
}

export interface ThemeSyncResult {
  ok: boolean;
  count: number;
  source: 'local' | 'github';
}

interface ThemeCatalogContextValue {
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
  themes: ThemeDefinition[];
  activeThemeId: string;
  activeTheme: ThemeDefinition;
  selectTheme: (themeId: string) => void;
  otaSource: 'local' | 'github';
  syncedAt: number | null;
  isSyncingThemes: boolean;
  syncThemesFromGitHub: () => Promise<ThemeSyncResult>;
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

function readCachedThemes(): CachedOtaThemesPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_THEMES_OTA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedOtaThemesPayload>;
    if (!parsed || !Array.isArray(parsed.themes) || parsed.themes.length === 0) return null;
    const valid = parsed.themes
      .map((item) => sanitizeClientThemeDefinition(item, item?.source === 'github' ? 'github' : 'local'))
      .filter((x): x is ThemeDefinition => Boolean(x));
    if (valid.length === 0) return null;
    return {
      default_theme: typeof parsed.default_theme === 'string' ? parsed.default_theme : BUNDLED_DEFAULT_THEME.id,
      source: parsed.source === 'github' ? 'github' : 'local',
      synced_at: typeof parsed.synced_at === 'number' ? parsed.synced_at : null,
      themes: valid,
    };
  } catch {
    return null;
  }
}

function mergeThemeLists(base: ThemeDefinition[], incoming: ThemeDefinition[]): ThemeDefinition[] {
  const byId = new Map<string, ThemeDefinition>();
  for (const t of base) byId.set(t.id, t);
  for (const t of incoming) byId.set(t.id, t);
  const list = Array.from(byId.values());
  list.sort((a, b) => {
    if (a.id === BUNDLED_DEFAULT_THEME.id) return -1;
    if (b.id === BUNDLED_DEFAULT_THEME.id) return 1;
    return a.id.localeCompare(b.id);
  });
  return list;
}

function applyThemeTokensToDom(theme: ThemeDefinition, mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-cockpit-theme-id', theme.id);
  if (mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');

  const tokens = getActiveThemeModeTokens(theme, mode);
  for (const key of ALLOWED_THEME_CSS_TOKENS) {
    if (tokens[key]) {
      root.style.setProperty(key, tokens[key]);
    } else {
      root.style.removeProperty(key);
    }
  }
}

function notifyNativeThemeBridges(theme: ThemeDefinition, mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  const tokens = getActiveThemeModeTokens(theme, mode);
  const canvasHex = tokens['--bg-canvas'] || (mode === 'dark' ? '#061007' : '#eaf2e6');
  const accentHex = tokens['--accent'] || (mode === 'dark' ? '#c6f19d' : '#1e6b38');

  try {
    window.RecursosAndroidBridge?.onThemeChanged?.(mode);
  } catch {
    // ignore
  }
  try {
    window.RecursosAndroidBridge?.onThemePaletteChanged?.(mode, theme.id, canvasHex, accentHex);
  } catch {
    // ignore
  }
  try {
    window.webkit?.messageHandlers?.recursosTheme?.postMessage?.(mode);
  } catch {
    // ignore
  }
  if (detectNativeEnvironment().isUbuntuNative) {
    void fetch('/api/native/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: mode,
        theme_id: theme.id,
        canvas: canvasHex,
        accent: accentHex,
      }),
    }).catch(() => {
      // ignore
    });
  }
}

async function fetchDirectFromGitHub(): Promise<CachedOtaThemesPayload | null> {
  try {
    const manifestRes = await fetch(`${GITHUB_THEMES_BASE_URL}/themes.json`, { cache: 'no-store' });
    if (!manifestRes.ok) return null;
    const manifest = (await manifestRes.json()) as {
      default_theme?: string;
      themes?: ThemeManifestEntry[];
    };
    if (!manifest || !Array.isArray(manifest.themes) || manifest.themes.length === 0) return null;

    const fetched: ThemeDefinition[] = [];
    for (const entry of manifest.themes) {
      if (!entry?.id || !entry?.file) continue;
      if (!/^[a-z0-9][a-z0-9._-]{0,79}\.json$/.test(entry.file)) continue;
      try {
        const tRes = await fetch(`${GITHUB_THEMES_BASE_URL}/${entry.file}`, { cache: 'no-store' });
        if (!tRes.ok) continue;
        const raw = await tRes.json();
        const clean = sanitizeClientThemeDefinition(raw, 'github');
        if (clean) fetched.push(clean);
      } catch {
        // skip individual unreachable theme
      }
    }
    if (fetched.length === 0) return null;
    return {
      default_theme: manifest.default_theme || BUNDLED_DEFAULT_THEME.id,
      source: 'github',
      synced_at: Math.floor(Date.now() / 1000),
      themes: fetched,
    };
  } catch {
    return null;
  }
}

export const ThemeCatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cachedInitial = useMemo(() => readCachedThemes(), []);
  const [mode, setModeState] = useState<ThemeMode>(readInitialMode);
  const [themes, setThemes] = useState<ThemeDefinition[]>(() =>
    mergeThemeLists([BUNDLED_DEFAULT_THEME], cachedInitial?.themes || [])
  );
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

  const commitCatalog = useCallback((payload: ThemeCatalogResponse | CachedOtaThemesPayload) => {
    const cleaned = (payload.themes || [])
      .map((item) => sanitizeClientThemeDefinition(item, item?.source === 'github' ? 'github' : payload.source))
      .filter((x): x is ThemeDefinition => Boolean(x));
    if (cleaned.length === 0) return 0;

    let mergedLen = cleaned.length;
    setThemes((prev) => {
      const merged = mergeThemeLists([BUNDLED_DEFAULT_THEME, ...prev.filter((t) => t.source === 'local')], cleaned);
      mergedLen = merged.length;
      try {
        localStorage.setItem(
          STORAGE_THEMES_OTA_CACHE_KEY,
          JSON.stringify({
            default_theme: payload.default_theme || BUNDLED_DEFAULT_THEME.id,
            source: payload.source === 'github' ? 'github' : 'local',
            synced_at: payload.synced_at ?? Math.floor(Date.now() / 1000),
            themes: merged,
          } satisfies CachedOtaThemesPayload)
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
    setModeState(next);
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

  // Apply CSS custom properties & notify native shells whenever activeTheme or mode changes
  useEffect(() => {
    applyThemeTokensToDom(activeTheme, mode);
    notifyNativeThemeBridges(activeTheme, mode);
  }, [activeTheme, mode]);

  const syncThemesFromGitHub = useCallback(async (): Promise<ThemeSyncResult> => {
    setIsSyncingThemes(true);
    try {
      const apiRes = await fetch('/api/themes/sync', {
        method: 'POST',
        cache: 'no-store',
      });
      if (apiRes.ok) {
        const data = (await apiRes.json()) as ThemeCatalogResponse & { sync_result?: { ok?: boolean } };
        if (data && Array.isArray(data.themes) && data.themes.length > 0) {
          const count = commitCatalog(data);
          const src = data.source === 'github' ? 'github' : 'local';
          if (data.sync_result?.ok || src === 'github') {
            return { ok: true, count, source: src };
          }
        }
      }
    } catch {
      // fall through to direct GitHub raw fallback
    } finally {
      setIsSyncingThemes(false);
    }

    setIsSyncingThemes(true);
    try {
      const direct = await fetchDirectFromGitHub();
      if (direct && direct.themes.length > 0) {
        const count = commitCatalog(direct);
        return { ok: true, count, source: 'github' };
      }
      return { ok: false, count: themes.length, source: otaSource };
    } finally {
      setIsSyncingThemes(false);
    }
  }, [commitCatalog, otaSource, themes.length]);

  // Automatic background fetch of /api/themes on mount
  const didBootFetchRef = useRef(false);
  useEffect(() => {
    if (didBootFetchRef.current) return;
    didBootFetchRef.current = true;

    let cancelled = false;
    const bootFetch = async () => {
      try {
        const res = await fetch('/api/themes', { cache: 'no-store' });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as ThemeCatalogResponse;
          if (data && Array.isArray(data.themes) && data.themes.length > 0) {
            commitCatalog(data);
            return;
          }
        }
      } catch {
        // fallback below
      }
      if (!cancelled) {
        const direct = await fetchDirectFromGitHub();
        if (direct && !cancelled) {
          commitCatalog(direct);
        }
      }
    };
    void bootFetch();
    return () => {
      cancelled = true;
    };
  }, [commitCatalog]);

  const value = useMemo<ThemeCatalogContextValue>(
    () => ({
      mode,
      setMode,
      themes,
      activeThemeId: activeTheme.id,
      activeTheme,
      selectTheme,
      otaSource,
      syncedAt,
      isSyncingThemes,
      syncThemesFromGitHub,
    }),
    [
      mode,
      setMode,
      themes,
      activeTheme,
      selectTheme,
      otaSource,
      syncedAt,
      isSyncingThemes,
      syncThemesFromGitHub,
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
