#!/usr/bin/env python3
"""
Catálogo centralizado de temas visuales espaciales (Schema v2) con paquete único
comprimido (themes-pack.rcpack.gz) y sincronización OTA desde GitHub para Recursos Cockpit.

Permite añadir, rediseñar o empaquetar temas (layouts, tipografías, gráficas, efectos e
ilustraciones WebP/JPEG embebidas) en un único archivo descargable desde GitHub sin
recompilar ni actualizar la aplicación principal.
"""

import gzip
import hashlib
import io
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

GITHUB_THEMES_BASE_URL = os.environ.get(
    "RECURSOS_THEMES_GITHUB_URL",
    "https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/themes",
).rstrip("/")

PACK_FILENAME = "themes-pack.rcpack.gz"
MAX_COMPRESSED_PACK_BYTES = 8 * 1024 * 1024     # 8 MB máximo comprimido
MAX_DECOMPRESSED_PACK_BYTES = 16 * 1024 * 1024  # 16 MB máximo descomprimido (anti gzip-bomb)
MAX_SINGLE_ASSET_CHARS = 1_200_000              # ~900 KB imagen base64 por fondo
MAX_PACK_ASSETS = 32

_ALLOWED_GITHUB_HOSTS = frozenset({
    "raw.githubusercontent.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
})

_THEMES_LOCK = threading.Lock()
_THEMES_OTA_SYNC_LOCK = threading.Lock()
_THEMES_OTA_BG_STARTED = False
_THEMES_OTA_LAST_TRY = 0.0

_SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SAFE_FILE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}\.json$")
_UNSAFE_CSS_VALUE_RE = re.compile(r"[;{}<>`\\]|url\s*\(|expression\s*\(|@import|javascript:", re.IGNORECASE)
_SAFE_FONT_STACK_RE = re.compile(r"^[A-Za-z0-9\s,'\"_-]{1,120}$")
_SAFE_GOOGLE_FONTS_QUERY_RE = re.compile(r"^[A-Za-z0-9+:;.,@&=-]{1,260}$")
_SAFE_RASTER_DATA_URI_RE = re.compile(r"^data:image/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$")

_ALLOWED_CSS_TOKENS = frozenset({
    "--bg-canvas",
    "--bg-surface",
    "--bg-surface-solid",
    "--bg-subtle",
    "--bg-hover",
    "--surface-topbar",
    "--surface-bento",
    "--surface-subtile",
    "--surface-segmented",
    "--surface-dock",
    "--surface-hero-bg",
    "--surface-hero-grad-a",
    "--surface-hero-grad-b",
    "--surface-hero-dot",
    "--surface-blur",
    "--border-hairline",
    "--border-strong",
    "--frost-highlight",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--alethia-obsidian",
    "--alethia-obsidian-elevated",
    "--alethia-lime",
    "--alethia-lime-soft",
    "--alethia-lime-ink",
    "--accent",
    "--accent-blue",
    "--accent-sky",
    "--ok",
    "--warn",
    "--danger",
    "--violet",
    "--hud-accent-2",
    "--hud-accent-3",
    "--panel-radius",
    "--font-display",
    "--font-sans",
    "--font-mono",
    "--ui-shadow",
    "--ui-shadow-strong",
})

_ALLOWED_EFFECT_TYPES = frozenset({"matrix-telemetry", "snowfall", "cyber-grid", "urban-rain", "none"})
_ALLOWED_COLOR_MODE_POLICIES = frozenset({"dual", "locked-dark", "locked-light"})
_ALLOWED_NAV_POSITIONS = frozenset({
    "bottom-dock",
    "left-sidebar",
    "left-hud",
    "right-rail",
    "top-bar",
    "top-tabs",
    "corner-dock",
})
_ALLOWED_SURFACE_SHAPES = frozenset({"rounded", "frosted", "beveled", "sharp"})
_ALLOWED_HEADER_STYLES = frozenset({"editorial", "hud-tactical", "classic-compact", "minimal"})
_ALLOWED_CHART_LINE_STYLES = frozenset({"smooth", "crisp", "neon"})


def is_allowed_github_url(url_str):
    """Restringe descargas OTA únicamente a orígenes HTTPS oficiales de GitHub."""
    if not isinstance(url_str, str):
        return False
    try:
        parsed = urllib.parse.urlparse(url_str.strip())
        return (
            parsed.scheme == "https"
            and (parsed.hostname or "").lower() in _ALLOWED_GITHUB_HOSTS
        )
    except Exception:
        return False


def resolve_themes_base_dir(hint_path=None):
    """Resuelve dinámicamente la raíz del proyecto o paquete instalado sin rutas fijas."""
    candidates = []
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.append(here)
    if hint_path:
        abs_hint = os.path.abspath(hint_path)
        if os.path.isdir(abs_hint):
            candidates.append(abs_hint)
        else:
            hdir = os.path.dirname(abs_hint)
            candidates.extend([hdir, os.path.abspath(os.path.join(hdir, ".."))])
    candidates.extend([
        os.getcwd(),
        "/usr/lib/recursos-cockpit",
        "/usr/share/recursos-cockpit",
    ])
    for root in candidates:
        if os.path.isfile(os.path.join(root, "themes", PACK_FILENAME)) or os.path.isfile(
            os.path.join(root, "themes", "themes.json")
        ):
            return root
    return here


def _get_ota_themes_cache_dir():
    """Devuelve directorio de caché OTA fuera del árbol Git con fallback a /tmp."""
    candidates = []
    xdg = os.environ.get("XDG_CACHE_HOME", "").strip()
    if xdg:
        candidates.append(os.path.join(xdg, "recursos-cockpit", "themes"))
    home = os.path.expanduser("~")
    if home and home != "~" and not home.startswith("/nonexistent"):
        candidates.append(os.path.join(home, ".cache", "recursos-cockpit", "themes"))
    candidates.append(os.path.join(tempfile.gettempdir(), "recursos-cockpit-themes"))

    for cdir in candidates:
        try:
            os.makedirs(cdir, exist_ok=True)
            probe = os.path.join(cdir, ".write_test")
            with open(probe, "w", encoding="utf-8") as fp:
                fp.write("1")
            os.remove(probe)
            return cdir
        except Exception:
            continue
    fallback = os.path.join(tempfile.gettempdir(), "recursos-cockpit-themes")
    os.makedirs(fallback, exist_ok=True)
    return fallback


def is_valid_theme_id(theme_id):
    return bool(isinstance(theme_id, str) and _SAFE_ID_RE.match(theme_id.strip()))


def _is_safe_css_val(val):
    if not isinstance(val, str):
        return False
    cleaned = val.strip()
    if not cleaned or len(cleaned) > 120:
        return False
    return not _UNSAFE_CSS_VALUE_RE.search(cleaned)


def _sanitize_token_map(raw_map):
    if not isinstance(raw_map, dict):
        return {}
    clean = {}
    for k, v in raw_map.items():
        if isinstance(k, str) and k in _ALLOWED_CSS_TOKENS and _is_safe_css_val(v):
            clean[k] = str(v).strip()
    return clean


def _sanitize_localized_text(raw_val, fallback=""):
    if isinstance(raw_val, str):
        return {"es": raw_val.strip()[:280], "en": raw_val.strip()[:280]}
    if isinstance(raw_val, dict):
        out = {}
        for k, v in raw_val.items():
            if isinstance(k, str) and isinstance(v, str) and len(k.strip()) <= 16:
                val = v.strip()[:360]
                if val:
                    out[k.strip().lower()] = val
        if out:
            return out
    return {"es": fallback, "en": fallback} if fallback else {}


def _sanitize_effect_palette(raw_pal):
    if not isinstance(raw_pal, dict):
        return {}
    out = {}
    for key in ("baseFill", "trailColor", "midColor", "headColor", "glowColor"):
        val = raw_pal.get(key)
        if _is_safe_css_val(val):
            out[key] = str(val).strip()
    for key, lo, hi in (("fadeAlpha", 0.03, 0.45), ("speedMultiplier", 0.25, 2.5), ("opacity", 0.1, 1.0)):
        val = raw_pal.get(key)
        if isinstance(val, (int, float)):
            out[key] = max(lo, min(hi, float(val)))
    return out


def _sanitize_background_effect(raw_eff):
    if not isinstance(raw_eff, dict):
        return {"type": "none"}
    eff_type = str(raw_eff.get("type") or "none").strip().lower()
    if eff_type not in _ALLOWED_EFFECT_TYPES:
        eff_type = "none"
    out = {"type": eff_type}
    if eff_type != "none":
        fps = raw_eff.get("fps", 28)
        out["fps"] = max(12, min(60, int(fps) if isinstance(fps, (int, float)) else 28))
        if eff_type == "matrix-telemetry":
            col_px = raw_eff.get("columnSpacingPx", 22)
            font_px = raw_eff.get("fontSizePx", 13)
            out["columnSpacingPx"] = max(14, min(48, int(col_px) if isinstance(col_px, (int, float)) else 22))
            out["fontSizePx"] = max(10, min(20, int(font_px) if isinstance(font_px, (int, float)) else 13))
        out["light"] = _sanitize_effect_palette(raw_eff.get("light"))
        out["dark"] = _sanitize_effect_palette(raw_eff.get("dark"))
    return out


def _sanitize_layout(raw_layout):
    if not isinstance(raw_layout, dict):
        return {
            "navPosition": "bottom-dock",
            "surfaceShape": "rounded",
            "headerStyle": "editorial",
        }
    nav = str(raw_layout.get("navPosition") or "bottom-dock").strip().lower()
    shape = str(raw_layout.get("surfaceShape") or "rounded").strip().lower()
    header = str(raw_layout.get("headerStyle") or "editorial").strip().lower()
    return {
        "navPosition": nav if nav in _ALLOWED_NAV_POSITIONS else "bottom-dock",
        "surfaceShape": shape if shape in _ALLOWED_SURFACE_SHAPES else "rounded",
        "headerStyle": header if header in _ALLOWED_HEADER_STYLES else "editorial",
    }


def _sanitize_typography(raw_typo):
    if not isinstance(raw_typo, dict):
        return {}
    out = {}
    for key in ("displayFont", "bodyFont", "monoFont"):
        val = raw_typo.get(key)
        if isinstance(val, str) and _SAFE_FONT_STACK_RE.match(val.strip()) and not _UNSAFE_CSS_VALUE_RE.search(val):
            out[key] = val.strip()
    gf = raw_typo.get("googleFontsFamily")
    if isinstance(gf, str) and _SAFE_GOOGLE_FONTS_QUERY_RE.match(gf.strip()):
        out["googleFontsFamily"] = gf.strip()
    return out


def _sanitize_backdrop(raw_bg, valid_asset_ids=None):
    if not isinstance(raw_bg, dict):
        return {}
    out = {}
    asset_id = str(raw_bg.get("assetId") or "").strip().lower()
    if asset_id and is_valid_theme_id(asset_id):
        if valid_asset_ids is None or asset_id in valid_asset_ids:
            out["assetId"] = asset_id
    for key in ("scrimLight", "scrimDark"):
        if _is_safe_css_val(raw_bg.get(key)):
            out[key] = str(raw_bg.get(key)).strip()
    blur = raw_bg.get("blurPx")
    if isinstance(blur, (int, float)):
        out["blurPx"] = max(0, min(24, int(blur)))
    return out


def _sanitize_chart_mode_palette(raw_pal):
    if not isinstance(raw_pal, dict):
        return {}
    out = {}
    for key in ("primary", "secondary", "tertiary", "quaternary", "grid", "averageLine"):
        if _is_safe_css_val(raw_pal.get(key)):
            out[key] = str(raw_pal.get(key)).strip()
    if isinstance(raw_pal.get("glow"), bool):
        out["glow"] = raw_pal["glow"]
    ls = str(raw_pal.get("lineStyle") or "").strip().lower()
    if ls in _ALLOWED_CHART_LINE_STYLES:
        out["lineStyle"] = ls
    return out


def _sanitize_chart_palette(raw_cp):
    if not isinstance(raw_cp, dict):
        return None
    light = _sanitize_chart_mode_palette(raw_cp.get("light"))
    dark = _sanitize_chart_mode_palette(raw_cp.get("dark"))
    if not light and not dark:
        return None
    return {"light": light or dark, "dark": dark or light}


def sanitize_assets_map(raw_assets):
    """Sanea mapa de recursos gráficos embebidos: únicamente raster webp/jpeg/png en base64 (cero SVG/scripts)."""
    if not isinstance(raw_assets, dict):
        return {}
    clean = {}
    for k, v in raw_assets.items():
        if len(clean) >= MAX_PACK_ASSETS:
            break
        aid = str(k or "").strip().lower()
        if not is_valid_theme_id(aid):
            continue
        if not isinstance(v, str) or len(v) > MAX_SINGLE_ASSET_CHARS:
            continue
        val = v.strip()
        if _SAFE_RASTER_DATA_URI_RE.match(val):
            clean[aid] = val
    return clean


def sanitize_theme_definition(raw_theme, source="local", fallback_id=None, valid_asset_ids=None):
    """Valida y sanea estrictamente una definición JSON de tema independiente (Schema v1 y v2)."""
    if not isinstance(raw_theme, dict):
        return None
    theme_id = str(raw_theme.get("id") or fallback_id or "").strip().lower()
    if not is_valid_theme_id(theme_id):
        return None

    tokens_raw = raw_theme.get("tokens")
    if not isinstance(tokens_raw, dict):
        return None
    light_tokens = _sanitize_token_map(tokens_raw.get("light"))
    dark_tokens = _sanitize_token_map(tokens_raw.get("dark"))
    if not light_tokens and not dark_tokens:
        return None
    if not light_tokens:
        light_tokens = dict(dark_tokens)
    if not dark_tokens:
        dark_tokens = dict(light_tokens)

    bg_effect = _sanitize_background_effect(raw_theme.get("backgroundEffect"))
    layout = _sanitize_layout(raw_theme.get("layout"))
    typography = _sanitize_typography(raw_theme.get("typography"))
    backdrop = _sanitize_backdrop(raw_theme.get("backdrop"), valid_asset_ids=valid_asset_ids)
    chart_palette = _sanitize_chart_palette(raw_theme.get("chartPalette"))

    policy_raw = str(raw_theme.get("colorModePolicy") or "dual").strip().lower()
    color_mode_policy = policy_raw if policy_raw in _ALLOWED_COLOR_MODE_POLICIES else "dual"

    raw_tags = raw_theme.get("tags") if isinstance(raw_theme.get("tags"), list) else []
    tags = [str(t).strip().lower()[:24] for t in raw_tags if isinstance(t, str) and t.strip()][:8]

    preview_light = {
        "canvas": light_tokens.get("--bg-canvas", "#eef4eb"),
        "surface": light_tokens.get("--surface-bento", light_tokens.get("--bg-surface", "rgba(255,255,255,0.52)")),
        "accent": light_tokens.get("--accent", "#1e6b38"),
        "rain": (bg_effect.get("light") or {}).get("headColor", light_tokens.get("--accent", "#1e6b38")),
    }
    preview_dark = {
        "canvas": dark_tokens.get("--bg-canvas", "#061007"),
        "surface": dark_tokens.get("--surface-bento", dark_tokens.get("--bg-surface", "rgba(11,23,13,0.75)")),
        "accent": dark_tokens.get("--accent", "#c6f19d"),
        "rain": (bg_effect.get("dark") or {}).get("headColor", dark_tokens.get("--accent", "#c6f19d")),
    }

    result = {
        "schema_version": 2,
        "id": theme_id,
        "version": str(raw_theme.get("version") or "1.0.0").strip()[:24],
        "author": str(raw_theme.get("author") or "Recursos Cockpit").strip()[:64],
        "source": source,
        "colorModePolicy": color_mode_policy,
        "name": _sanitize_localized_text(raw_theme.get("name"), fallback=theme_id),
        "description": _sanitize_localized_text(raw_theme.get("description"), fallback=""),
        "tags": tags,
        "has_animation": bg_effect.get("type") != "none",
        "layout": layout,
        "typography": typography,
        "backdrop": backdrop,
        "preview": {"light": preview_light, "dark": preview_dark},
        "backgroundEffect": bg_effect,
        "tokens": {
            "light": light_tokens,
            "dark": dark_tokens,
        },
    }
    if chart_palette:
        result["chartPalette"] = chart_palette
    return result


def _read_json_file(path):
    try:
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:
        return None


def _write_json_atomic(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _write_bytes_atomic(path, raw_bytes):
    tmp = f"{path}.tmp"
    with open(tmp, "wb") as fp:
        fp.write(raw_bytes)
    os.replace(tmp, path)


def safe_decompress_pack_bytes(gz_bytes):
    """Descomprime un paquete .rcpack.gz con protección estricta contra bombas gzip."""
    if not isinstance(gz_bytes, (bytes, bytearray)):
        return None
    if len(gz_bytes) == 0 or len(gz_bytes) > MAX_COMPRESSED_PACK_BYTES:
        return None
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(gz_bytes), mode="rb") as gz:
            chunks = []
            total = 0
            while True:
                chunk = gz.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DECOMPRESSED_PACK_BYTES:
                    return None
                chunks.append(chunk)
            raw_json = b"".join(chunks)
        parsed = json.loads(raw_json.decode("utf-8"))
        if not isinstance(parsed, dict):
            return None
        return parsed
    except Exception:
        return None


def _parse_pack_dict(raw_pack, source="local"):
    """Valida y sanea un paquete único de temas completo (assets + themes + metadatos)."""
    if not isinstance(raw_pack, dict):
        return None
    assets = sanitize_assets_map(raw_pack.get("assets"))
    valid_asset_ids = set(assets.keys())
    raw_themes = raw_pack.get("themes")
    if not isinstance(raw_themes, list) or not raw_themes:
        return None

    themes = {}
    ordered_ids = []
    for item in raw_themes:
        sanitized = sanitize_theme_definition(item, source=source, valid_asset_ids=valid_asset_ids)
        if sanitized:
            tid = sanitized["id"]
            if tid not in themes:
                ordered_ids.append(tid)
            themes[tid] = sanitized

    if not themes:
        return None

    cand_def = str(raw_pack.get("default_theme") or "alethia-matrix").strip().lower()
    default_theme = cand_def if cand_def in themes else ordered_ids[0]
    return {
        "pack_version": str(raw_pack.get("pack_version") or "2.0.0").strip()[:24],
        "pack_sha256": str(raw_pack.get("pack_sha256") or "").strip()[:64],
        "generated_at": int(raw_pack.get("generated_at") or 0) if isinstance(raw_pack.get("generated_at"), (int, float)) else None,
        "default_theme": default_theme,
        "ordered_ids": ordered_ids,
        "assets": assets,
        "themes": themes,
    }


def _load_pack_from_file(pack_path, source="local"):
    try:
        if not os.path.isfile(pack_path):
            return None
        size = os.path.getsize(pack_path)
        if size <= 0 or size > MAX_COMPRESSED_PACK_BYTES:
            return None
        with open(pack_path, "rb") as fp:
            gz_bytes = fp.read(MAX_COMPRESSED_PACK_BYTES + 1)
        parsed = safe_decompress_pack_bytes(gz_bytes)
        if not parsed:
            return None
        return _parse_pack_dict(parsed, source=source)
    except Exception:
        return None


def _load_legacy_directory_catalog(themes_dir, source="local"):
    """Fallback de compatibilidad para archivos JSON individuales sueltos."""
    manifest = _read_json_file(os.path.join(themes_dir, "themes.json"))
    default_theme = "alethia-matrix"
    themes = {}

    if isinstance(manifest, dict):
        cand_def = str(manifest.get("default_theme") or "").strip().lower()
        if is_valid_theme_id(cand_def):
            default_theme = cand_def
        entries = manifest.get("themes") if isinstance(manifest.get("themes"), list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            tid = str(entry.get("id") or "").strip().lower()
            tfile = str(entry.get("file") or "").strip()
            if not is_valid_theme_id(tid) or not _SAFE_FILE_RE.match(tfile):
                continue
            raw_theme = _read_json_file(os.path.join(themes_dir, tfile))
            sanitized = sanitize_theme_definition(raw_theme, source=source, fallback_id=tid)
            if sanitized:
                themes[tid] = sanitized

    if os.path.isdir(themes_dir):
        try:
            for fname in sorted(os.listdir(themes_dir)):
                if fname == "themes.json" or not _SAFE_FILE_RE.match(fname):
                    continue
                if fname.endswith(".meta.json"):
                    continue
                raw_theme = _read_json_file(os.path.join(themes_dir, fname))
                sanitized = sanitize_theme_definition(raw_theme, source=source)
                if sanitized and sanitized["id"] not in themes:
                    themes[sanitized["id"]] = sanitized
        except Exception:
            pass

    return default_theme, themes


def _fetch_remote_bytes(url, etag=None, timeout=8.0, max_bytes=MAX_COMPRESSED_PACK_BYTES):
    if not is_allowed_github_url(url):
        return 403, None, ""
    headers = {
        "User-Agent": "Recursos-Cockpit-Themes-OTA/2.0",
        "Accept": "application/octet-stream, application/gzip, application/json",
    }
    if etag:
        headers["If-None-Match"] = etag
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            final_url = resp.geturl()
            if not is_allowed_github_url(final_url):
                return 403, None, ""
            raw = resp.read(max_bytes + 1)
            if len(raw) > max_bytes:
                return 413, None, ""
            new_etag = resp.headers.get("ETag") or ""
            return 200, raw, new_etag
    except urllib.error.HTTPError as he:
        if he.code == 304:
            return 304, None, etag or ""
        return he.code, None, ""
    except Exception:
        return 0, None, ""


def sync_themes_from_github(base_dir=None, force=False, timeout=8.0):
    """
    Descarga de forma atómica el paquete único `themes-pack.rcpack.gz` desde GitHub
    al caché OTA local del usuario, validando origen HTTPS, tamaño, descompresión
    segura y saneamiento estricto sin tocar código ni versiones de la aplicación.
    """
    global _THEMES_OTA_LAST_TRY
    now = time.time()
    if not force and (now - _THEMES_OTA_LAST_TRY) < 60.0:
        return {"ok": True, "skipped": True, "source": "cache"}

    with _THEMES_OTA_SYNC_LOCK:
        _THEMES_OTA_LAST_TRY = time.time()
        cache_dir = _get_ota_themes_cache_dir()
        meta_path = os.path.join(cache_dir, "themes_ota.meta.json")
        meta = _read_json_file(meta_path) or {}
        prev_etag = None if force else meta.get("pack_etag")

        pack_url = f"{GITHUB_THEMES_BASE_URL}/{PACK_FILENAME}"
        status, gz_bytes, new_etag = _fetch_remote_bytes(
            pack_url,
            etag=prev_etag,
            timeout=timeout,
            max_bytes=MAX_COMPRESSED_PACK_BYTES,
        )
        if status == 304:
            meta["checked_at"] = int(time.time())
            try:
                _write_json_atomic(meta_path, meta)
            except Exception:
                pass
            return {"ok": True, "not_modified": True, "source": "github"}

        if status == 200 and gz_bytes:
            parsed_raw = safe_decompress_pack_bytes(gz_bytes)
            sanitized_pack = _parse_pack_dict(parsed_raw, source="github") if parsed_raw else None
            if not sanitized_pack:
                return {"ok": False, "status": 422, "source": "local"}
            try:
                _write_bytes_atomic(os.path.join(cache_dir, PACK_FILENAME), gz_bytes)
                _write_json_atomic(
                    meta_path,
                    {
                        "pack_etag": new_etag,
                        "pack_version": sanitized_pack["pack_version"],
                        "pack_sha256": sanitized_pack["pack_sha256"] or hashlib.sha256(gz_bytes).hexdigest(),
                        "synced_at": int(time.time()),
                        "checked_at": int(time.time()),
                        "themes_count": len(sanitized_pack["themes"]),
                        "assets_count": len(sanitized_pack["assets"]),
                        "source_url": pack_url,
                    },
                )
            except Exception:
                return {"ok": False, "status": 500, "source": "local"}
            return {
                "ok": True,
                "source": "github",
                "pack_version": sanitized_pack["pack_version"],
                "synced_count": len(sanitized_pack["themes"]),
                "theme_ids": sanitized_pack["ordered_ids"],
                "synced_at": int(time.time()),
            }

        return {"ok": False, "status": status, "source": "local"}


def start_background_themes_ota_sync(base_dir=None):
    """Lanza una sincronización OTA no bloqueante al arrancar el servidor."""
    global _THEMES_OTA_BG_STARTED
    with _THEMES_LOCK:
        if _THEMES_OTA_BG_STARTED:
            return
        _THEMES_OTA_BG_STARTED = True

    def _worker():
        try:
            sync_themes_from_github(base_dir=base_dir, force=False, timeout=6.0)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True, name="themes-ota-sync").start()


def get_theme_pack_bytes(base_dir=None):
    """Devuelve los bytes del paquete único .rcpack.gz activo (OTA si válido, o local)."""
    root = resolve_themes_base_dir(base_dir)
    cache_pack = os.path.join(_get_ota_themes_cache_dir(), PACK_FILENAME)
    local_pack = os.path.join(root, "themes", PACK_FILENAME)
    for candidate in (cache_pack, local_pack):
        try:
            if os.path.isfile(candidate) and 0 < os.path.getsize(candidate) <= MAX_COMPRESSED_PACK_BYTES:
                with open(candidate, "rb") as fp:
                    return fp.read()
        except Exception:
            continue
    return None


def get_themes_catalog_payload(base_dir=None):
    """
    Devuelve el catálogo unificado Schema v2 (temas + assets WebP embebidos + metadatos del paquete).
    """
    root = resolve_themes_base_dir(base_dir)
    local_dir = os.path.join(root, "themes")
    cache_dir = _get_ota_themes_cache_dir()

    local_pack = _load_pack_from_file(os.path.join(local_dir, PACK_FILENAME), source="local")
    ota_pack = _load_pack_from_file(os.path.join(cache_dir, PACK_FILENAME), source="github")
    meta = _read_json_file(os.path.join(cache_dir, "themes_ota.meta.json")) or {}

    merged_themes = {}
    merged_assets = {}
    ordered_ids = []

    if local_pack:
        merged_assets.update(local_pack["assets"])
        for tid in local_pack["ordered_ids"]:
            merged_themes[tid] = local_pack["themes"][tid]
            ordered_ids.append(tid)
    else:
        _, legacy_local = _load_legacy_directory_catalog(local_dir, source="local")
        for tid, tdef in legacy_local.items():
            merged_themes[tid] = tdef
            if tid not in ordered_ids:
                ordered_ids.append(tid)

    if ota_pack:
        merged_assets.update(ota_pack["assets"])
        for tid in ota_pack["ordered_ids"]:
            merged_themes[tid] = ota_pack["themes"][tid]
            if tid not in ordered_ids:
                ordered_ids.append(tid)

    active_pack = ota_pack or local_pack
    default_theme = (
        active_pack["default_theme"]
        if active_pack and active_pack["default_theme"] in merged_themes
        else ("alethia-matrix" if "alethia-matrix" in merged_themes else (ordered_ids[0] if ordered_ids else "alethia-matrix"))
    )

    ordered = []
    if default_theme in merged_themes:
        ordered.append(merged_themes[default_theme])
    for tid in ordered_ids:
        if tid != default_theme and tid in merged_themes:
            ordered.append(merged_themes[tid])

    return {
        "ok": True,
        "schema_version": 2,
        "pack_version": (active_pack or {}).get("pack_version", "2.0.0"),
        "pack_file": PACK_FILENAME,
        "pack_sha256": (active_pack or {}).get("pack_sha256", ""),
        "default_theme": default_theme,
        "source": "github" if ota_pack else "local",
        "synced_at": meta.get("synced_at") or None,
        "github_base_url": GITHUB_THEMES_BASE_URL,
        "assets": merged_assets,
        "themes": ordered,
    }


def get_single_theme_payload(theme_id, base_dir=None):
    """Devuelve un único tema saneado por su ID."""
    clean_id = str(theme_id or "").strip().lower()
    if clean_id.endswith(".json"):
        clean_id = clean_id[:-5]
    if not is_valid_theme_id(clean_id):
        return None
    catalog = get_themes_catalog_payload(base_dir=base_dir)
    for item in catalog.get("themes", []):
        if item.get("id") == clean_id:
            return item
    return None
