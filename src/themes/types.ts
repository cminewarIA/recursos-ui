import { ThemeMode } from '../types/telemetry';

export type LocalizedStringMap = Record<string, string>;

export interface MatrixEffectPalette {
  baseFill?: string;
  fadeAlpha?: number;
  trailColor?: string;
  midColor?: string;
  headColor?: string;
  glowColor?: string;
  speedMultiplier?: number;
  opacity?: number;
}

export interface ThemeBackgroundEffect {
  type: 'matrix-telemetry' | 'none';
  fps?: number;
  columnSpacingPx?: number;
  fontSizePx?: number;
  light?: MatrixEffectPalette;
  dark?: MatrixEffectPalette;
}

export interface ThemePreviewSwatch {
  canvas: string;
  surface: string;
  accent: string;
  rain?: string;
}

export interface ThemeDefinition {
  schema_version?: number;
  id: string;
  version: string;
  author?: string;
  source?: 'local' | 'github';
  name: LocalizedStringMap | string;
  description?: LocalizedStringMap | string;
  tags?: string[];
  has_animation?: boolean;
  preview?: {
    light: ThemePreviewSwatch;
    dark: ThemePreviewSwatch;
  };
  backgroundEffect?: ThemeBackgroundEffect;
  tokens: {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
}

export interface ThemeManifestEntry {
  id: string;
  file: string;
  version?: string;
  name?: LocalizedStringMap | string;
  description?: LocalizedStringMap | string;
  tags?: string[];
  has_animation?: boolean;
  preview?: {
    light: ThemePreviewSwatch;
    dark: ThemePreviewSwatch;
  };
}

export interface ThemeCatalogResponse {
  ok?: boolean;
  schema_version?: number;
  default_theme: string;
  source: 'local' | 'github';
  synced_at?: number | null;
  github_base_url?: string;
  themes: ThemeDefinition[];
}

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UNSAFE_CSS_RE = /[;{}<>`\\]|url\s*\(|expression\s*\(|@import|javascript:/i;

export const ALLOWED_THEME_CSS_TOKENS = new Set<string>([
  '--bg-canvas',
  '--bg-surface',
  '--bg-surface-solid',
  '--bg-subtle',
  '--bg-hover',
  '--surface-topbar',
  '--surface-bento',
  '--surface-subtile',
  '--surface-segmented',
  '--surface-dock',
  '--surface-hero-bg',
  '--surface-hero-grad-a',
  '--surface-hero-grad-b',
  '--surface-hero-dot',
  '--surface-blur',
  '--border-hairline',
  '--border-strong',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--alethia-obsidian',
  '--alethia-obsidian-elevated',
  '--alethia-lime',
  '--alethia-lime-soft',
  '--alethia-lime-ink',
  '--accent',
  '--accent-blue',
  '--accent-sky',
  '--ok',
  '--warn',
  '--danger',
  '--violet',
  '--ui-shadow',
  '--ui-shadow-strong',
]);

export function isSafeCssTokenValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return false;
  return !UNSAFE_CSS_RE.test(trimmed);
}

export function sanitizeTokenMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (ALLOWED_THEME_CSS_TOKENS.has(key) && isSafeCssTokenValue(val)) {
      out[key] = val.trim();
    }
  }
  return out;
}

export function sanitizeClientThemeDefinition(
  raw: unknown,
  source: 'local' | 'github' = 'local'
): ThemeDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id || '').trim().toLowerCase();
  if (!SAFE_ID_RE.test(id)) return null;
  const rawTokens = obj.tokens as Record<string, unknown> | undefined;
  if (!rawTokens || typeof rawTokens !== 'object') return null;
  const light = sanitizeTokenMap(rawTokens.light);
  const dark = sanitizeTokenMap(rawTokens.dark);
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) return null;

  const rawEff = obj.backgroundEffect as Record<string, unknown> | undefined;
  const effType = rawEff?.type === 'matrix-telemetry' ? 'matrix-telemetry' : 'none';
  const sanitizePal = (p: unknown): MatrixEffectPalette => {
    if (!p || typeof p !== 'object') return {};
    const po = p as Record<string, unknown>;
    const res: MatrixEffectPalette = {};
    for (const k of ['baseFill', 'trailColor', 'midColor', 'headColor', 'glowColor'] as const) {
      if (isSafeCssTokenValue(po[k])) res[k] = String(po[k]).trim();
    }
    if (typeof po.fadeAlpha === 'number') res.fadeAlpha = Math.max(0.03, Math.min(0.45, po.fadeAlpha));
    if (typeof po.speedMultiplier === 'number') res.speedMultiplier = Math.max(0.25, Math.min(2.5, po.speedMultiplier));
    if (typeof po.opacity === 'number') res.opacity = Math.max(0.1, Math.min(1.0, po.opacity));
    return res;
  };

  const backgroundEffect: ThemeBackgroundEffect =
    effType === 'matrix-telemetry'
      ? {
          type: 'matrix-telemetry',
          fps: typeof rawEff?.fps === 'number' ? Math.max(12, Math.min(60, Math.round(rawEff.fps))) : 28,
          columnSpacingPx:
            typeof rawEff?.columnSpacingPx === 'number'
              ? Math.max(14, Math.min(48, Math.round(rawEff.columnSpacingPx)))
              : 22,
          fontSizePx:
            typeof rawEff?.fontSizePx === 'number'
              ? Math.max(10, Math.min(20, Math.round(rawEff.fontSizePx)))
              : 13,
          light: sanitizePal(rawEff?.light),
          dark: sanitizePal(rawEff?.dark),
        }
      : { type: 'none' };

  const preview = {
    light: {
      canvas: light['--bg-canvas'] || '#eaf2e6',
      surface: light['--surface-bento'] || light['--bg-surface'] || 'rgba(255, 255, 255, 0.78)',
      accent: light['--accent'] || '#1e6b38',
      rain: backgroundEffect.light?.headColor || light['--accent'] || '#1e6b38',
    },
    dark: {
      canvas: dark['--bg-canvas'] || '#061007',
      surface: dark['--surface-bento'] || dark['--bg-surface'] || 'rgba(11, 23, 13, 0.75)',
      accent: dark['--accent'] || '#c6f19d',
      rain: backgroundEffect.dark?.headColor || dark['--accent'] || '#c6f19d',
    },
  };

  return {
    schema_version: 1,
    id,
    version: String(obj.version || '1.0.0').slice(0, 24),
    author: String(obj.author || 'Recursos Cockpit').slice(0, 64),
    source: (obj.source === 'github' ? 'github' : source),
    name: (obj.name as LocalizedStringMap | string) || id,
    description: (obj.description as LocalizedStringMap | string) || '',
    tags: Array.isArray(obj.tags) ? obj.tags.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    has_animation: backgroundEffect.type !== 'none',
    preview,
    backgroundEffect,
    tokens: { light, dark },
  };
}

export function resolveThemeLocalizedText(
  field: LocalizedStringMap | string | undefined,
  locale: string,
  fallback = ''
): string {
  if (!field) return fallback;
  if (typeof field === 'string') return field;
  const low = (locale || 'es').toLowerCase();
  const base = low.split('-')[0].split('_')[0];
  return field[low] || field[base] || field.es || field.en || Object.values(field)[0] || fallback;
}

export function getActiveThemeModeTokens(theme: ThemeDefinition, mode: ThemeMode): Record<string, string> {
  return mode === 'dark' ? theme.tokens.dark : theme.tokens.light;
}
