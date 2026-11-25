import { ThemeMode } from '../types/telemetry';

export type LocalizedStringMap = Record<string, string>;

export type ThemeColorModePolicy = 'dual' | 'locked-dark' | 'locked-light';

export type ThemeNavPosition =
  | 'bottom-dock'
  | 'left-sidebar'
  | 'left-hud'
  | 'right-rail'
  | 'top-bar'
  | 'top-tabs'
  | 'corner-dock';

export type ThemeSurfaceShape = 'rounded' | 'frosted' | 'beveled' | 'sharp';

export type ThemeHeaderStyle = 'editorial' | 'hud-tactical' | 'classic-compact' | 'minimal';

export type ThemeEffectType = 'matrix-telemetry' | 'snowfall' | 'cyber-grid' | 'urban-rain' | 'none';

export type ThemeChartLineStyle = 'smooth' | 'crisp' | 'neon';

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
  type: ThemeEffectType;
  fps?: number;
  columnSpacingPx?: number;
  fontSizePx?: number;
  light?: MatrixEffectPalette;
  dark?: MatrixEffectPalette;
}

export interface ThemeLayoutConfig {
  navPosition: ThemeNavPosition;
  surfaceShape: ThemeSurfaceShape;
  headerStyle: ThemeHeaderStyle;
}

export interface ThemeTypographyConfig {
  displayFont?: string;
  bodyFont?: string;
  monoFont?: string;
  googleFontsFamily?: string;
}

export interface ThemeBackdropConfig {
  assetId?: string;
  scrimLight?: string;
  scrimDark?: string;
  blurPx?: number;
}

export interface ThemeChartModePalette {
  primary?: string;
  secondary?: string;
  tertiary?: string;
  quaternary?: string;
  grid?: string;
  averageLine?: string;
  glow?: boolean;
  lineStyle?: ThemeChartLineStyle;
}

export interface ThemeChartPalette {
  light: ThemeChartModePalette;
  dark: ThemeChartModePalette;
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
  colorModePolicy?: ThemeColorModePolicy;
  name: LocalizedStringMap | string;
  description?: LocalizedStringMap | string;
  tags?: string[];
  has_animation?: boolean;
  layout?: ThemeLayoutConfig;
  typography?: ThemeTypographyConfig;
  backdrop?: ThemeBackdropConfig;
  chartPalette?: ThemeChartPalette;
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

export interface ThemeCatalogResponse {
  ok?: boolean;
  schema_version?: number;
  pack_version?: string;
  pack_file?: string;
  pack_sha256?: string;
  default_theme: string;
  source: 'local' | 'github';
  synced_at?: number | null;
  github_base_url?: string;
  assets?: Record<string, string>;
  themes: ThemeDefinition[];
}

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UNSAFE_CSS_RE = /[;{}<>`\\]|url\s*\(|expression\s*\(|@import|javascript:/i;
const SAFE_FONT_STACK_RE = /^[A-Za-z0-9\s,'\"_-]{1,120}$/;
const SAFE_GOOGLE_FONTS_RE = /^[A-Za-z0-9+:;.,@&=-]{1,260}$/;
const SAFE_RASTER_DATA_URI_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

const ALLOWED_EFFECT_TYPES = new Set<ThemeEffectType>([
  'matrix-telemetry',
  'snowfall',
  'cyber-grid',
  'urban-rain',
  'none',
]);

const ALLOWED_NAV_POSITIONS = new Set<ThemeNavPosition>([
  'bottom-dock',
  'left-sidebar',
  'left-hud',
  'right-rail',
  'top-bar',
  'top-tabs',
  'corner-dock',
]);

const ALLOWED_SURFACE_SHAPES = new Set<ThemeSurfaceShape>(['rounded', 'frosted', 'beveled', 'sharp']);
const ALLOWED_HEADER_STYLES = new Set<ThemeHeaderStyle>(['editorial', 'hud-tactical', 'classic-compact', 'minimal']);
const ALLOWED_COLOR_POLICIES = new Set<ThemeColorModePolicy>(['dual', 'locked-dark', 'locked-light']);
const ALLOWED_CHART_LINE_STYLES = new Set<ThemeChartLineStyle>(['smooth', 'crisp', 'neon']);

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
  '--frost-highlight',
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
  '--hud-accent-2',
  '--hud-accent-3',
  '--panel-radius',
  '--font-display',
  '--font-sans',
  '--font-mono',
  '--ui-shadow',
  '--ui-shadow-strong',
]);

export function isSafeCssTokenValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return false;
  return !UNSAFE_CSS_RE.test(trimmed);
}

export function isSafeGoogleFontsQuery(value: unknown): value is string {
  return typeof value === 'string' && SAFE_GOOGLE_FONTS_RE.test(value.trim());
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

export function sanitizeAssetsMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 32) break;
    const id = String(key || '').trim().toLowerCase();
    if (!SAFE_ID_RE.test(id)) continue;
    if (typeof val !== 'string' || val.length > 1_200_000) continue;
    const trimmed = val.trim();
    if (SAFE_RASTER_DATA_URI_RE.test(trimmed)) {
      out[id] = trimmed;
      count += 1;
    }
  }
  return out;
}

function sanitizeChartModePalette(raw: unknown): ThemeChartModePalette {
  if (!raw || typeof raw !== 'object') return {};
  const po = raw as Record<string, unknown>;
  const out: ThemeChartModePalette = {};
  for (const k of ['primary', 'secondary', 'tertiary', 'quaternary', 'grid', 'averageLine'] as const) {
    if (isSafeCssTokenValue(po[k])) out[k] = String(po[k]).trim();
  }
  if (typeof po.glow === 'boolean') out.glow = po.glow;
  const ls = String(po.lineStyle || '').trim().toLowerCase() as ThemeChartLineStyle;
  if (ALLOWED_CHART_LINE_STYLES.has(ls)) out.lineStyle = ls;
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

  const finalLight = Object.keys(light).length > 0 ? light : { ...dark };
  const finalDark = Object.keys(dark).length > 0 ? dark : { ...light };

  const rawEff = obj.backgroundEffect as Record<string, unknown> | undefined;
  const rawEffType = String(rawEff?.type || 'none').trim().toLowerCase() as ThemeEffectType;
  const effType: ThemeEffectType = ALLOWED_EFFECT_TYPES.has(rawEffType) ? rawEffType : 'none';

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
    effType !== 'none'
      ? {
          type: effType,
          fps: typeof rawEff?.fps === 'number' ? Math.max(12, Math.min(60, Math.round(rawEff.fps))) : 28,
          ...(effType === 'matrix-telemetry'
            ? {
                columnSpacingPx:
                  typeof rawEff?.columnSpacingPx === 'number'
                    ? Math.max(14, Math.min(48, Math.round(rawEff.columnSpacingPx)))
                    : 22,
                fontSizePx:
                  typeof rawEff?.fontSizePx === 'number'
                    ? Math.max(10, Math.min(20, Math.round(rawEff.fontSizePx)))
                    : 13,
              }
            : {}),
          light: sanitizePal(rawEff?.light),
          dark: sanitizePal(rawEff?.dark),
        }
      : { type: 'none' };

  const rawLayout = (obj.layout as Record<string, unknown> | undefined) || {};
  const navRaw = String(rawLayout.navPosition || 'bottom-dock').trim().toLowerCase() as ThemeNavPosition;
  const shapeRaw = String(rawLayout.surfaceShape || 'rounded').trim().toLowerCase() as ThemeSurfaceShape;
  const headerRaw = String(rawLayout.headerStyle || 'editorial').trim().toLowerCase() as ThemeHeaderStyle;
  const layout: ThemeLayoutConfig = {
    navPosition: ALLOWED_NAV_POSITIONS.has(navRaw) ? navRaw : 'bottom-dock',
    surfaceShape: ALLOWED_SURFACE_SHAPES.has(shapeRaw) ? shapeRaw : 'rounded',
    headerStyle: ALLOWED_HEADER_STYLES.has(headerRaw) ? headerRaw : 'editorial',
  };

  const rawTypo = (obj.typography as Record<string, unknown> | undefined) || {};
  const typography: ThemeTypographyConfig = {};
  for (const fk of ['displayFont', 'bodyFont', 'monoFont'] as const) {
    const fv = rawTypo[fk];
    if (typeof fv === 'string' && SAFE_FONT_STACK_RE.test(fv.trim()) && !UNSAFE_CSS_RE.test(fv)) {
      typography[fk] = fv.trim();
    }
  }
  if (isSafeGoogleFontsQuery(rawTypo.googleFontsFamily)) {
    typography.googleFontsFamily = String(rawTypo.googleFontsFamily).trim();
  }

  const rawBackdrop = (obj.backdrop as Record<string, unknown> | undefined) || {};
  const backdrop: ThemeBackdropConfig = {};
  const assetId = String(rawBackdrop.assetId || '').trim().toLowerCase();
  if (assetId && SAFE_ID_RE.test(assetId)) backdrop.assetId = assetId;
  if (isSafeCssTokenValue(rawBackdrop.scrimLight)) backdrop.scrimLight = String(rawBackdrop.scrimLight).trim();
  if (isSafeCssTokenValue(rawBackdrop.scrimDark)) backdrop.scrimDark = String(rawBackdrop.scrimDark).trim();
  if (typeof rawBackdrop.blurPx === 'number') {
    backdrop.blurPx = Math.max(0, Math.min(24, Math.round(rawBackdrop.blurPx)));
  }

  const rawCp = obj.chartPalette as Record<string, unknown> | undefined;
  let chartPalette: ThemeChartPalette | undefined;
  if (rawCp && typeof rawCp === 'object') {
    const cpL = sanitizeChartModePalette(rawCp.light);
    const cpD = sanitizeChartModePalette(rawCp.dark);
    if (Object.keys(cpL).length > 0 || Object.keys(cpD).length > 0) {
      chartPalette = {
        light: Object.keys(cpL).length > 0 ? cpL : cpD,
        dark: Object.keys(cpD).length > 0 ? cpD : cpL,
      };
    }
  }

  const rawPolicy = String(obj.colorModePolicy || 'dual').trim().toLowerCase() as ThemeColorModePolicy;
  const colorModePolicy: ThemeColorModePolicy = ALLOWED_COLOR_POLICIES.has(rawPolicy) ? rawPolicy : 'dual';

  const preview = {
    light: {
      canvas: finalLight['--bg-canvas'] || '#edf6e9',
      surface: finalLight['--surface-bento'] || finalLight['--bg-surface'] || 'rgba(255, 255, 255, 0.50)',
      accent: finalLight['--accent'] || '#1e6b38',
      rain: backgroundEffect.light?.headColor || finalLight['--accent'] || '#1e6b38',
    },
    dark: {
      canvas: finalDark['--bg-canvas'] || '#061007',
      surface: finalDark['--surface-bento'] || finalDark['--bg-surface'] || 'rgba(11, 23, 13, 0.75)',
      accent: finalDark['--accent'] || '#c6f19d',
      rain: backgroundEffect.dark?.headColor || finalDark['--accent'] || '#c6f19d',
    },
  };

  return {
    schema_version: 2,
    id,
    version: String(obj.version || '1.0.0').slice(0, 24),
    author: String(obj.author || 'Recursos Cockpit').slice(0, 64),
    source: obj.source === 'github' ? 'github' : source,
    colorModePolicy,
    name: (obj.name as LocalizedStringMap | string) || id,
    description: (obj.description as LocalizedStringMap | string) || '',
    tags: Array.isArray(obj.tags) ? obj.tags.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    has_animation: backgroundEffect.type !== 'none',
    layout,
    typography,
    backdrop,
    chartPalette,
    preview,
    backgroundEffect,
    tokens: { light: finalLight, dark: finalDark },
  };
}

export function resolveThemeEffectiveMode(theme: ThemeDefinition, preferredMode: ThemeMode): ThemeMode {
  if (theme.colorModePolicy === 'locked-dark') return 'dark';
  if (theme.colorModePolicy === 'locked-light') return 'light';
  return preferredMode;
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

export function getActiveThemeChartPalette(theme: ThemeDefinition, mode: ThemeMode): ThemeChartModePalette | null {
  if (!theme.chartPalette) return null;
  return mode === 'dark' ? theme.chartPalette.dark : theme.chartPalette.light;
}
