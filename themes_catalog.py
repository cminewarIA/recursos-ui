#!/usr/bin/env python3
"""
Catálogo centralizado de temas visuales independientes con sincronización OTA desde GitHub
para Recursos Cockpit.
Espejo arquitectónico de i18n_catalog.py: permite añadir o editar temas en ./themes/
sin recompilar ni actualizar la aplicación.
"""

import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request

GITHUB_THEMES_BASE_URL = os.environ.get(
    "RECURSOS_THEMES_GITHUB_URL",
    "https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/themes",
).rstrip("/")

_THEMES_LOCK = threading.Lock()
_THEMES_OTA_SYNC_LOCK = threading.Lock()
_THEMES_OTA_BG_STARTED = False
_THEMES_OTA_LAST_TRY = 0.0

_SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SAFE_FILE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}\.json$")
_UNSAFE_CSS_VALUE_RE = re.compile(r"[;{}<>`\\]|url\s*\(|expression\s*\(|@import|javascript:", re.IGNORECASE)

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
    "--ui-shadow",
    "--ui-shadow-strong",
})

_ALLOWED_EFFECT_TYPES = frozenset({"matrix-telemetry", "none"})


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
        if os.path.isfile(os.path.join(root, "themes", "themes.json")):
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
        return {"es": raw_val.strip()[:240], "en": raw_val.strip()[:240]}
    if isinstance(raw_val, dict):
        out = {}
        for k, v in raw_val.items():
            if isinstance(k, str) and isinstance(v, str) and len(k.strip()) <= 16:
                val = v.strip()[:320]
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
    if eff_type == "matrix-telemetry":
        fps = raw_eff.get("fps", 28)
        col_px = raw_eff.get("columnSpacingPx", 22)
        font_px = raw_eff.get("fontSizePx", 13)
        out["fps"] = max(12, min(60, int(fps) if isinstance(fps, (int, float)) else 28))
        out["columnSpacingPx"] = max(14, min(48, int(col_px) if isinstance(col_px, (int, float)) else 22))
        out["fontSizePx"] = max(10, min(20, int(font_px) if isinstance(font_px, (int, float)) else 13))
        out["light"] = _sanitize_effect_palette(raw_eff.get("light"))
        out["dark"] = _sanitize_effect_palette(raw_eff.get("dark"))
    return out


def sanitize_theme_definition(raw_theme, source="local", fallback_id=None):
    """Valida y sanea estrictamente una definición JSON de tema independiente."""
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

    bg_effect = _sanitize_background_effect(raw_theme.get("backgroundEffect"))
    raw_tags = raw_theme.get("tags") if isinstance(raw_theme.get("tags"), list) else []
    tags = [str(t).strip().lower()[:24] for t in raw_tags if isinstance(t, str) and t.strip()][:8]

    preview_light = {
        "canvas": light_tokens.get("--bg-canvas", "#eef4eb"),
        "surface": light_tokens.get("--surface-bento", light_tokens.get("--bg-surface", "rgba(255,255,255,0.78)")),
        "accent": light_tokens.get("--accent", "#1e6b38"),
        "rain": (bg_effect.get("light") or {}).get("headColor", light_tokens.get("--accent", "#1e6b38")),
    }
    preview_dark = {
        "canvas": dark_tokens.get("--bg-canvas", "#061007"),
        "surface": dark_tokens.get("--surface-bento", dark_tokens.get("--bg-surface", "rgba(11,23,13,0.75)")),
        "accent": dark_tokens.get("--accent", "#c6f19d"),
        "rain": (bg_effect.get("dark") or {}).get("headColor", dark_tokens.get("--accent", "#c6f19d")),
    }

    return {
        "schema_version": 1,
        "id": theme_id,
        "version": str(raw_theme.get("version") or "1.0.0").strip()[:24],
        "author": str(raw_theme.get("author") or "Recursos Cockpit").strip()[:64],
        "source": source,
        "name": _sanitize_localized_text(raw_theme.get("name"), fallback=theme_id),
        "description": _sanitize_localized_text(raw_theme.get("description"), fallback=""),
        "tags": tags,
        "has_animation": bg_effect.get("type") != "none",
        "preview": {"light": preview_light, "dark": preview_dark},
        "backgroundEffect": bg_effect,
        "tokens": {
            "light": light_tokens,
            "dark": dark_tokens,
        },
    }


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


def _fetch_remote_json(url, etag=None, timeout=5.0):
    headers = {
        "User-Agent": "Recursos-Cockpit-Themes-OTA/1.0",
        "Accept": "application/json",
    }
    if etag:
        headers["If-None-Match"] = etag
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(2 * 1024 * 1024)
            new_etag = resp.headers.get("ETag") or ""
            return 200, json.loads(raw.decode("utf-8")), new_etag
    except urllib.error.HTTPError as he:
        if he.code == 304:
            return 304, None, etag or ""
        return he.code, None, ""
    except Exception:
        return 0, None, ""


def _load_directory_catalog(themes_dir, source="local"):
    """Lee un manifiesto themes.json y sus archivos de tema independientes en un directorio dado."""
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
            tfile = str(entry.get("file") or f"{tid}.json").strip()
            if not is_valid_theme_id(tid) or not _SAFE_FILE_RE.match(tfile):
                continue
            raw_theme = _read_json_file(os.path.join(themes_dir, tfile))
            sanitized = sanitize_theme_definition(raw_theme, source=source, fallback_id=tid)
            if sanitized:
                themes[tid] = sanitized

    # Descubrimiento automático adicional de cualquier archivo *.json válido en el directorio
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


def sync_themes_from_github(base_dir=None, force=False, timeout=5.0):
    """
    Descarga desde GitHub el manifiesto themes/themes.json y cada archivo de tema independiente
    al directorio de caché OTA local (fuera de Git), sin requerir actualizar la app.
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
        prev_etag = None if force else meta.get("etag")

        manifest_url = f"{GITHUB_THEMES_BASE_URL}/themes.json"
        status, remote_manifest, new_etag = _fetch_remote_json(manifest_url, etag=prev_etag, timeout=timeout)
        if status == 304:
            meta["checked_at"] = int(time.time())
            try:
                _write_json_atomic(meta_path, meta)
            except Exception:
                pass
            return {"ok": True, "not_modified": True, "source": "github"}

        if status != 200 or not isinstance(remote_manifest, dict):
            return {"ok": False, "status": status, "source": "local"}

        entries = remote_manifest.get("themes")
        if not isinstance(entries, list) or not entries:
            return {"ok": False, "status": 422, "source": "local"}

        downloaded = []
        valid_entries = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            tid = str(entry.get("id") or "").strip().lower()
            tfile = str(entry.get("file") or f"{tid}.json").strip()
            if not is_valid_theme_id(tid) or not _SAFE_FILE_RE.match(tfile):
                continue
            theme_url = f"{GITHUB_THEMES_BASE_URL}/{tfile}"
            t_status, raw_theme, _ = _fetch_remote_json(theme_url, etag=None, timeout=timeout)
            if t_status == 200 and isinstance(raw_theme, dict):
                sanitized = sanitize_theme_definition(raw_theme, source="github", fallback_id=tid)
                if sanitized:
                    try:
                        _write_json_atomic(os.path.join(cache_dir, tfile), raw_theme)
                        downloaded.append(tid)
                        valid_entries.append(entry)
                    except Exception:
                        pass

        if not downloaded:
            return {"ok": False, "status": 502, "source": "local"}

        try:
            _write_json_atomic(
                os.path.join(cache_dir, "themes.json"),
                {
                    "schema_version": 1,
                    "default_theme": str(remote_manifest.get("default_theme") or "alethia-matrix").strip().lower(),
                    "themes": valid_entries,
                },
            )
            _write_json_atomic(
                meta_path,
                {
                    "etag": new_etag,
                    "synced_at": int(time.time()),
                    "checked_at": int(time.time()),
                    "themes_count": len(downloaded),
                    "source_url": GITHUB_THEMES_BASE_URL,
                },
            )
        except Exception:
            return {"ok": False, "status": 500, "source": "local"}

        return {
            "ok": True,
            "source": "github",
            "synced_count": len(downloaded),
            "theme_ids": downloaded,
            "synced_at": int(time.time()),
        }


def start_background_themes_ota_sync(base_dir=None):
    """Lanza una sincronización OTA no bloqueante al arrancar el servidor."""
    global _THEMES_OTA_BG_STARTED
    with _THEMES_LOCK:
        if _THEMES_OTA_BG_STARTED:
            return
        _THEMES_OTA_BG_STARTED = True

    def _worker():
        try:
            sync_themes_from_github(base_dir=base_dir, force=False, timeout=5.0)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True, name="themes-ota-sync").start()


def get_themes_catalog_payload(base_dir=None):
    """
    Devuelve el catálogo unificado de temas (empaquetados locales + temas OTA descargados de GitHub).
    """
    root = resolve_themes_base_dir(base_dir)
    local_dir = os.path.join(root, "themes")
    cache_dir = _get_ota_themes_cache_dir()

    local_default, local_themes = _load_directory_catalog(local_dir, source="local")
    ota_default, ota_themes = _load_directory_catalog(cache_dir, source="github")
    meta = _read_json_file(os.path.join(cache_dir, "themes_ota.meta.json")) or {}

    merged = dict(local_themes)
    for tid, tdef in ota_themes.items():
        merged[tid] = tdef

    default_theme = ota_default if ota_themes and ota_default in merged else (
        local_default if local_default in merged else (next(iter(merged.keys()), "alethia-matrix"))
    )

    ordered = []
    if default_theme in merged:
        ordered.append(merged[default_theme])
    for tid in sorted(merged.keys()):
        if tid != default_theme:
            ordered.append(merged[tid])

    return {
        "ok": True,
        "schema_version": 1,
        "default_theme": default_theme,
        "source": "github" if ota_themes else "local",
        "synced_at": meta.get("synced_at") or None,
        "github_base_url": GITHUB_THEMES_BASE_URL,
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
