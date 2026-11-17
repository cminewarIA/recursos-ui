#!/usr/bin/env python3
"""
Catálogo centralizado de versión única y diccionario tabular (CSV tipo hoja de cálculo)
para Recursos Cockpit.
Cumple GEMINI.md Regla 2 (Llamada Única a ./VERSION) y Regla 8 (Diccionario CSV extensible por columnas).
"""

import csv
import io
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

GITHUB_DICTIONARY_RAW_URL = os.environ.get(
    "RECURSOS_I18N_GITHUB_URL",
    "https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv",
)

_CATALOG_LOCK = threading.Lock()
_OTA_SYNC_LOCK = threading.Lock()
_DICT_CACHE = None
_DICT_MTIME = 0.0
_DICT_OTA_MTIME = 0.0
_DICT_PATH = None
_CSV_BYTES_CACHE = None
_VER_CACHE = None
_VER_MTIME = 0.0
_VER_PATH = None
_DIRTY_CHECK_CACHE = (0.0, None, False)
_OTA_MEM_LAST_TRY = 0.0
_OTA_BG_THREAD_STARTED = False

_META_COLUMNS = {"key", "clave", "context", "contexto", "notes", "notas", "comment", "comentario"}


def resolve_catalog_base_dir(hint_path=None):
    """Resuelve dinámicamente la raíz del proyecto o paquete instalado sin rutas fijas."""
    candidates = []
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.append(here)
    if hint_path:
        hdir = os.path.dirname(os.path.abspath(hint_path))
        candidates.extend([hdir, os.path.abspath(os.path.join(hdir, ".."))])
    candidates.extend([
        os.getcwd(),
        "/usr/lib/recursos-cockpit",
        "/usr/share/recursos-cockpit",
    ])
    for root in candidates:
        if os.path.isfile(os.path.join(root, "i18n", "dictionary.csv")):
            return root
    for root in candidates:
        if os.path.isfile(os.path.join(root, "VERSION")):
            return root
    return here


def get_canonical_version(base_dir=None):
    """
    Punto único de lectura para la versión canónica desde ./VERSION.
    Mantiene caché por mtime para detectar actualizaciones en caliente con coste ~0.
    """
    global _VER_CACHE, _VER_MTIME, _VER_PATH
    roots = []
    if base_dir:
        roots.append(os.path.abspath(base_dir))
    roots.append(resolve_catalog_base_dir())

    for root in roots:
        ver_path = os.path.join(root, "VERSION")
        if os.path.isfile(ver_path):
            try:
                mtime = os.path.getmtime(ver_path)
                with _CATALOG_LOCK:
                    if _VER_CACHE and _VER_PATH == ver_path and _VER_MTIME == mtime:
                        return _VER_CACHE
                    with open(ver_path, "r", encoding="utf-8") as f:
                        val = f.read().strip().lstrip("vV")
                    if val:
                        _VER_CACHE = val
                        _VER_MTIME = mtime
                        _VER_PATH = ver_path
                        return _VER_CACHE
            except Exception:
                pass
    return _VER_CACHE or "0.0.0"


def get_dictionary_file_path(base_dir=None):
    if base_dir:
        abs_hint = os.path.abspath(base_dir)
        if os.path.isfile(abs_hint):
            return abs_hint
        for rel in (os.path.join("i18n", "dictionary.csv"), "dictionary.csv"):
            cand = os.path.join(abs_hint, rel)
            if os.path.isfile(cand):
                return cand
    root = resolve_catalog_base_dir()
    cand = os.path.join(root, "i18n", "dictionary.csv")
    if os.path.isfile(cand):
        return cand
    return None


def _detect_csv_delimiter(sample_line):
    in_quotes = False
    semi = 0
    comma = 0
    for ch in sample_line:
        if ch == '"':
            in_quotes = not in_quotes
        elif not in_quotes:
            if ch == ";":
                semi += 1
            elif ch == ",":
                comma += 1
    if semi > comma:
        return ";"
    return ","


_COMMON_LOCALE_DISPLAY = {
    "es": "Español",
    "en": "English",
    "fr": "Français",
    "de": "Deutsch",
    "it": "Italiano",
    "pt": "Português",
    "nl": "Nederlands",
    "pl": "Polski",
    "ro": "Română",
    "el": "Ελληνικά",
    "cs": "Čeština",
    "hu": "Magyar",
    "sv": "Svenska",
    "bg": "Български",
    "da": "Dansk",
    "fi": "Suomi",
    "sk": "Slovenčina",
    "hr": "Hrvatski",
    "lt": "Lietuvių",
    "sl": "Slovenščina",
    "lv": "Latviešu",
    "et": "Eesti",
    "ga": "Gaeilge",
    "mt": "Malti",
    "no": "Norsk",
    "uk": "Українська",
    "ru": "Русский",
    "tr": "Türkçe",
    "sr": "Srpski",
    "sq": "Shqip",
    "is": "Íslenska",
    "ca": "Català",
    "gl": "Galego",
    "eu": "Euskara",
}


def _infer_locale_display_name(code):
    low = str(code or "").strip().lower()
    base = low.split("-")[0].split("_")[0]
    return _COMMON_LOCALE_DISPLAY.get(low) or _COMMON_LOCALE_DISPLAY.get(base) or str(code).upper()


def parse_dictionary_csv_text(csv_text):
    """
    Convierte una hoja de cálculo CSV (`key,context,es,en,...`) en la estructura
    canónica consumida por Python y API JSON, detectando automáticamente cualquier
    columna de idioma nueva añadida a futuro sin tocar el código.
    """
    clean_text = (csv_text or "").lstrip("\ufeff\r\n")
    lines = clean_text.splitlines()
    first_line = next((ln for ln in lines if ln.strip()), "")
    delimiter = _detect_csv_delimiter(first_line)

    reader = csv.DictReader(io.StringIO(clean_text), delimiter=delimiter)
    if reader.fieldnames is not None:
        reader.fieldnames = [str(h or "").strip() for h in reader.fieldnames]
    headers = [h for h in (reader.fieldnames or []) if h]
    key_col = next((h for h in headers if h.lower() in ("key", "clave")), headers[0] if headers else "key")
    lang_cols = [h for h in headers if h.lower() not in _META_COLUMNS]
    if not lang_cols:
        lang_cols = ["es"]

    default_loc = lang_cols[0]
    locale_names = {loc: _infer_locale_display_name(loc) for loc in lang_cols}
    flat_locales = {loc: {} for loc in lang_cols}

    for row in reader:
        raw_key = str(row.get(key_col) or "").strip()
        if not raw_key or raw_key.startswith("#"):
            continue
        if raw_key == "__locale_name__":
            for loc in lang_cols:
                display = str(row.get(loc) or "").strip()
                if display:
                    locale_names[loc] = display
            continue
        if raw_key == "__default_locale__":
            for loc in lang_cols:
                flag = str(row.get(loc) or "").strip().lower()
                if flag in ("1", "true", "yes", "si", "sí", "default", "*"):
                    default_loc = loc
                    break
            continue

        for loc in lang_cols:
            val = row.get(loc)
            if val is not None:
                sval = str(val)
                if sval != "":
                    flat_locales[loc][raw_key] = sval

    return {
        "meta": {
            "default_locale": default_loc,
            "supported_locales": lang_cols,
            "locale_names": locale_names,
            "source_format": "csv",
        },
        "flat": flat_locales,
    }


def _get_ota_cache_paths():
    """Devuelve rutas de caché OTA fuera del árbol Git con fallback a /tmp si HOME es solo lectura."""
    candidates = []
    xdg = os.environ.get("XDG_CACHE_HOME", "").strip()
    if xdg:
        candidates.append(os.path.join(xdg, "recursos-cockpit"))
    home = os.path.expanduser("~")
    if home and home != "~" and not home.startswith("/nonexistent"):
        candidates.append(os.path.join(home, ".cache", "recursos-cockpit"))
    candidates.append(os.path.join(tempfile.gettempdir(), "recursos-cockpit-i18n"))

    for cdir in candidates:
        try:
            os.makedirs(cdir, exist_ok=True)
            probe = os.path.join(cdir, ".write_test")
            with open(probe, "w", encoding="utf-8") as fp:
                fp.write("1")
            os.remove(probe)
            return (
                os.path.join(cdir, "dictionary_remote.csv"),
                os.path.join(cdir, "dictionary_remote.meta.json"),
            )
        except Exception:
            continue
    fallback_dir = os.path.join(tempfile.gettempdir(), "recursos-cockpit-i18n")
    return (
        os.path.join(fallback_dir, "dictionary_remote.csv"),
        os.path.join(fallback_dir, "dictionary_remote.meta.json"),
    )


def _is_local_dictionary_dirty(dict_path):
    """Comprueba si ./i18n/dictionary.csv tiene cambios locales sin commitear (desarrollo activo)."""
    global _DIRTY_CHECK_CACHE
    if not dict_path or not os.path.isfile(dict_path):
        return False
    now = time.time()
    cached_ts, cached_path, cached_val = _DIRTY_CHECK_CACHE
    if cached_path == dict_path and (now - cached_ts) < 10.0:
        return cached_val
    dirty = False
    try:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(dict_path)))
        if os.path.isdir(os.path.join(repo_root, ".git")):
            p = subprocess.run(
                ["git", "-C", repo_root, "status", "--porcelain", "--", dict_path],
                capture_output=True,
                text=True,
                timeout=1.5,
            )
            if p.returncode == 0 and p.stdout.strip():
                dirty = True
    except Exception:
        dirty = False
    _DIRTY_CHECK_CACHE = (now, dict_path, dirty)
    return dirty


def merge_parsed_dictionaries(local_dict, remote_dict, prefer_remote_existing=True, ota_meta=None):
    """
    Fusiona el diccionario local empaquetado con el descargado OTA desde GitHub:
    - Añade automáticamente columnas/idiomas nuevos desde GitHub sin perder claves locales.
    - Conserva ediciones locales sin commitear cuando prefer_remote_existing=False.
    """
    if not remote_dict or not isinstance(remote_dict, dict):
        return local_dict
    r_flat = remote_dict.get("flat") or {}
    r_meta = remote_dict.get("meta") or {}
    r_locales = list(r_meta.get("supported_locales") or [])
    if not r_locales or not any(r_flat.get(loc) for loc in r_locales):
        return local_dict

    l_flat = local_dict.get("flat") or {}
    l_meta = local_dict.get("meta") or {}
    l_locales = list(l_meta.get("supported_locales") or ["es"])

    merged_locales = list(l_locales)
    for loc in r_locales:
        if loc not in merged_locales:
            merged_locales.append(loc)

    merged_names = dict(l_meta.get("locale_names") or {})
    for loc, name in (r_meta.get("locale_names") or {}).items():
        if loc not in merged_names or prefer_remote_existing:
            if name:
                merged_names[loc] = name
    for loc in merged_locales:
        merged_names.setdefault(loc, _infer_locale_display_name(loc))

    default_loc = str(l_meta.get("default_locale") or merged_locales[0])
    r_def = str(r_meta.get("default_locale") or "")
    if prefer_remote_existing and r_def in merged_locales:
        default_loc = r_def

    merged_flat = {}
    for loc in merged_locales:
        base_map = dict(l_flat.get(loc) or {})
        rem_map = r_flat.get(loc) or {}
        if loc not in l_flat or prefer_remote_existing:
            base_map.update(rem_map)
        else:
            for k, v in rem_map.items():
                if k not in base_map:
                    base_map[k] = v
        merged_flat[loc] = base_map

    out_meta = {
        "default_locale": default_loc,
        "supported_locales": merged_locales,
        "locale_names": merged_names,
        "source_format": "csv",
        "ota_source": "github",
        "github_raw_url": GITHUB_DICTIONARY_RAW_URL,
    }
    if ota_meta and isinstance(ota_meta, dict):
        if ota_meta.get("synced_at"):
            out_meta["ota_synced_at"] = ota_meta["synced_at"]
        if ota_meta.get("etag"):
            out_meta["ota_etag"] = ota_meta["etag"]
    return {"meta": out_meta, "flat": merged_flat}


def _serialize_catalog_to_csv_bytes(catalog):
    """Serializa el catálogo unificado en formato CSV RFC 4180 para servir a clientes OTA."""
    meta = catalog.get("meta") or {}
    flat = catalog.get("flat") or {}
    locales = list(meta.get("supported_locales") or ["es"])
    locale_names = meta.get("locale_names") or {}
    default_loc = str(meta.get("default_locale") or locales[0])

    all_keys = []
    seen = set()
    for loc in locales:
        for k in (flat.get(loc) or {}).keys():
            if k not in seen:
                seen.add(k)
                all_keys.append(k)

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["key", "context", *locales])
    writer.writerow([
        "__locale_name__",
        "Nombre visible del idioma",
        *[str(locale_names.get(loc) or _infer_locale_display_name(loc)) for loc in locales],
    ])
    writer.writerow([
        "__default_locale__",
        "Idioma predeterminado (*)",
        *["*" if loc == default_loc else "" for loc in locales],
    ])
    for k in all_keys:
        writer.writerow([k, "", *[str((flat.get(loc) or {}).get(k, "")) for loc in locales]])
    return buf.getvalue().encode("utf-8")


def _read_ota_remote_state():
    """Lee CSV y metadatos cacheados de la última descarga válida desde GitHub."""
    csv_path, meta_path = _get_ota_cache_paths()
    if not os.path.isfile(csv_path):
        return None, {}, 0.0
    try:
        ota_mtime = os.path.getmtime(csv_path)
        with open(csv_path, "rb") as fb:
            raw = fb.read()
        parsed = parse_dictionary_csv_text(raw.decode("utf-8", errors="replace"))
        def_loc = str((parsed.get("meta") or {}).get("default_locale") or "es")
        if len((parsed.get("flat") or {}).get(def_loc) or {}) < 20:
            return None, {}, 0.0
        meta_obj = {}
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as fm:
                    meta_obj = json.load(fm)
            except Exception:
                meta_obj = {}
        return parsed, meta_obj, ota_mtime
    except Exception:
        return None, {}, 0.0


def sync_dictionary_from_github(base_dir=None, force=False, timeout=5.0, min_interval=900.0):
    """
    Descarga ./i18n/dictionary.csv desde GitHub (ETag / If-None-Match) y lo cachea fuera de Git
    para incorporar nuevos idiomas o traducciones OTA sin actualizar ni recompilar la app.
    """
    global _DICT_CACHE, _DICT_OTA_MTIME, _CSV_BYTES_CACHE, _OTA_MEM_LAST_TRY
    csv_path, meta_path = _get_ota_cache_paths()

    with _OTA_SYNC_LOCK:
        now = time.time()
        meta_obj = {}
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as fm:
                    meta_obj = json.load(fm)
            except Exception:
                meta_obj = {}

        if not force:
            if (now - _OTA_MEM_LAST_TRY) < 60.0:
                cat = load_dictionary(base_dir)
                return {
                    "ok": os.path.isfile(csv_path),
                    "updated": False,
                    "source": (cat.get("meta") or {}).get("ota_source", "local"),
                    "supported_locales": (cat.get("meta") or {}).get("supported_locales", ["es"]),
                }
            last_ok = float(meta_obj.get("last_checked_ts") or 0.0)
            if os.path.isfile(csv_path) and last_ok > 0 and (now - last_ok) < min_interval:
                cat = load_dictionary(base_dir)
                return {
                    "ok": True,
                    "updated": False,
                    "cached": True,
                    "source": (cat.get("meta") or {}).get("ota_source", "github"),
                    "supported_locales": (cat.get("meta") or {}).get("supported_locales", ["es"]),
                }

        _OTA_MEM_LAST_TRY = now
        headers = {
            "User-Agent": "RecursosCockpit-i18n/1.0 (+https://github.com/cminewarIA/recursos-ui)",
            "Accept": "text/csv, text/plain;q=0.9, */*;q=0.8",
        }
        if os.path.isfile(csv_path):
            if meta_obj.get("etag"):
                headers["If-None-Match"] = str(meta_obj["etag"])
            if meta_obj.get("last_modified"):
                headers["If-Modified-Since"] = str(meta_obj["last_modified"])

        req = urllib.request.Request(GITHUB_DICTIONARY_RAW_URL, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw_bytes = resp.read()
                parsed = parse_dictionary_csv_text(raw_bytes.decode("utf-8", errors="replace"))
                def_loc = str((parsed.get("meta") or {}).get("default_locale") or "es")
                if len((parsed.get("flat") or {}).get(def_loc) or {}) < 20:
                    raise ValueError("CSV remoto inválido o incompleto")
                os.makedirs(os.path.dirname(csv_path), exist_ok=True)
                tmp_csv = f"{csv_path}.tmp"
                with open(tmp_csv, "wb") as fw:
                    fw.write(raw_bytes)
                os.replace(tmp_csv, csv_path)

                new_meta = {
                    "url": GITHUB_DICTIONARY_RAW_URL,
                    "etag": resp.headers.get("ETag", ""),
                    "last_modified": resp.headers.get("Last-Modified", ""),
                    "synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                    "last_checked_ts": now,
                    "supported_locales": (parsed.get("meta") or {}).get("supported_locales", ["es"]),
                }
                tmp_meta = f"{meta_path}.tmp"
                with open(tmp_meta, "w", encoding="utf-8") as fm:
                    json.dump(new_meta, fm, ensure_ascii=False, indent=2)
                os.replace(tmp_meta, meta_path)

                with _CATALOG_LOCK:
                    _DICT_CACHE = None
                    _CSV_BYTES_CACHE = None
                    _DICT_OTA_MTIME = 0.0

                cat = load_dictionary(base_dir)
                return {
                    "ok": True,
                    "updated": True,
                    "source": "github",
                    "synced_at": new_meta["synced_at"],
                    "supported_locales": (cat.get("meta") or {}).get("supported_locales", ["es"]),
                }
        except urllib.error.HTTPError as he:
            if he.code == 304 and os.path.isfile(csv_path):
                meta_obj["last_checked_ts"] = now
                if not meta_obj.get("synced_at"):
                    meta_obj["synced_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
                try:
                    tmp_meta = f"{meta_path}.tmp"
                    with open(tmp_meta, "w", encoding="utf-8") as fm:
                        json.dump(meta_obj, fm, ensure_ascii=False, indent=2)
                    os.replace(tmp_meta, meta_path)
                except Exception:
                    pass
                cat = load_dictionary(base_dir)
                return {
                    "ok": True,
                    "updated": False,
                    "not_modified": True,
                    "source": (cat.get("meta") or {}).get("ota_source", "github"),
                    "synced_at": meta_obj.get("synced_at"),
                    "supported_locales": (cat.get("meta") or {}).get("supported_locales", ["es"]),
                }
            cat = load_dictionary(base_dir)
            return {
                "ok": False,
                "updated": False,
                "error": f"HTTP {he.code}",
                "source": (cat.get("meta") or {}).get("ota_source", "local"),
                "supported_locales": (cat.get("meta") or {}).get("supported_locales", ["es"]),
            }
        except Exception as exc:
            cat = load_dictionary(base_dir)
            return {
                "ok": False,
                "updated": False,
                "error": str(exc),
                "source": (cat.get("meta") or {}).get("ota_source", "local"),
                "supported_locales": (cat.get("meta") or {}).get("supported_locales", ["es"]),
            }


def schedule_background_dictionary_sync(base_dir=None, interval_sec=1800.0):
    """Lanza un hilo demonio único para actualizar ./i18n/dictionary.csv OTA desde GitHub."""
    global _OTA_BG_THREAD_STARTED
    with _CATALOG_LOCK:
        if _OTA_BG_THREAD_STARTED:
            return
        _OTA_BG_THREAD_STARTED = True

    def _worker():
        time.sleep(2.0)
        while True:
            try:
                sync_dictionary_from_github(base_dir=base_dir, force=False, timeout=5.0, min_interval=900.0)
            except Exception:
                pass
            if interval_sec <= 0:
                break
            time.sleep(interval_sec)

    threading.Thread(target=_worker, name="i18n-github-ota", daemon=True).start()


def load_dictionary(base_dir=None):
    """Carga y fusiona ./i18n/dictionary.csv con la caché OTA de GitHub (coste ~0 por mtime)."""
    global _DICT_CACHE, _DICT_MTIME, _DICT_OTA_MTIME, _DICT_PATH, _CSV_BYTES_CACHE
    dict_path = get_dictionary_file_path(base_dir)
    ota_csv_path, _ = _get_ota_cache_paths()
    ota_mtime = os.path.getmtime(ota_csv_path) if os.path.isfile(ota_csv_path) else 0.0
    local_mtime = os.path.getmtime(dict_path) if (dict_path and os.path.isfile(dict_path)) else 0.0

    with _CATALOG_LOCK:
        if (
            _DICT_CACHE is not None
            and _DICT_PATH == dict_path
            and _DICT_MTIME == local_mtime
            and _DICT_OTA_MTIME == ota_mtime
        ):
            return _DICT_CACHE

    local_parsed = None
    raw_local_bytes = None
    if dict_path and os.path.isfile(dict_path):
        try:
            with open(dict_path, "rb") as fb:
                raw_local_bytes = fb.read()
            local_parsed = parse_dictionary_csv_text(raw_local_bytes.decode("utf-8", errors="replace"))
        except Exception:
            local_parsed = None

    if local_parsed is None:
        local_parsed = {
            "meta": {
                "default_locale": "es",
                "supported_locales": ["es"],
                "locale_names": {"es": "Español"},
                "source_format": "csv",
                "ota_source": "local",
            },
            "flat": {"es": {}},
        }
    else:
        local_parsed["meta"]["ota_source"] = "local"
        local_parsed["meta"]["github_raw_url"] = GITHUB_DICTIONARY_RAW_URL

    ota_parsed, ota_meta, valid_ota_mtime = _read_ota_remote_state()
    if ota_parsed is not None:
        prefer_remote = not _is_local_dictionary_dirty(dict_path)
        final_catalog = merge_parsed_dictionaries(
            local_parsed,
            ota_parsed,
            prefer_remote_existing=prefer_remote,
            ota_meta=ota_meta,
        )
        csv_bytes = _serialize_catalog_to_csv_bytes(final_catalog)
    else:
        final_catalog = local_parsed
        csv_bytes = raw_local_bytes if raw_local_bytes is not None else b"key,context,es\n"

    with _CATALOG_LOCK:
        _DICT_CACHE = final_catalog
        _CSV_BYTES_CACHE = csv_bytes
        _DICT_MTIME = local_mtime
        _DICT_OTA_MTIME = valid_ota_mtime if ota_parsed is not None else ota_mtime
        _DICT_PATH = dict_path
        return _DICT_CACHE


def get_default_locale(base_dir=None):
    data = load_dictionary(base_dir)
    return str(data.get("meta", {}).get("default_locale") or "es")


def normalize_locale(lang=None, base_dir=None):
    data = load_dictionary(base_dir)
    meta = data.get("meta", {})
    supported = meta.get("supported_locales") or list((data.get("flat") or {}).keys()) or ["es"]
    default_loc = str(meta.get("default_locale") or "es")
    if not lang:
        return default_loc
    supported_ci = {str(s).lower(): s for s in supported}
    clean = str(lang).strip().lower().split(",")[0].split(";")[0].strip().replace("_", "-")
    if clean in supported_ci:
        return supported_ci[clean]
    base = clean.split("-")[0]
    if base in supported_ci:
        return supported_ci[base]
    return default_loc


def t(key, lang=None, base_dir=None, fallback=None, **params):
    """Resuelve una clave del diccionario tabular compartido con interpolación segura `{param}`."""
    data = load_dictionary(base_dir)
    flat = data.get("flat") or {}
    default_loc = str(data.get("meta", {}).get("default_locale") or "es")
    target_loc = normalize_locale(lang, base_dir)

    raw = (flat.get(target_loc) or {}).get(key)
    if not raw and target_loc != default_loc:
        raw = (flat.get(default_loc) or {}).get(key)
    if not raw:
        raw = fallback if fallback is not None else str(key)

    if params:
        try:
            return raw.format(**params)
        except Exception:
            return raw
    return raw


def get_hardware_transport_label(transport_key, lang=None, base_dir=None):
    return t(f"hardware.storage.transport.{transport_key}", lang=lang, base_dir=base_dir, fallback=str(transport_key))


def get_hardware_disk_label(label_key, params=None, lang=None, base_dir=None):
    return t(f"hardware.storage.label.{label_key}", lang=lang, base_dir=base_dir, **(params or {}))


def get_gpu_process_label(proc_key, fallback=None, lang=None, base_dir=None):
    return t(f"hardware.gpu.proc.{proc_key}", lang=lang, base_dir=base_dir, fallback=fallback)


def get_systemd_role_label(unit_name, lang=None, base_dir=None):
    clean = str(unit_name or "").replace(".service", "").strip()
    data = load_dictionary(base_dir)
    flat = data.get("flat") or {}
    loc = normalize_locale(lang, base_dir)
    def_loc = str(data.get("meta", {}).get("default_locale") or "es")
    key = f"hardware.systemd.role.{clean}"
    return (flat.get(loc) or {}).get(key) or (flat.get(def_loc) or {}).get(key) or ""


def get_dictionary_bytes(base_dir=None):
    """Devuelve el catálogo JSON estructurado generado al vuelo desde ./i18n/dictionary.csv."""
    data = load_dictionary(base_dir)
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def get_dictionary_csv_bytes(base_dir=None):
    """Devuelve la hoja CSV cruda original para descarga o lectura externa directa."""
    load_dictionary(base_dir)
    if _CSV_BYTES_CACHE is not None:
        return _CSV_BYTES_CACHE
    dict_path = get_dictionary_file_path(base_dir)
    if dict_path and os.path.isfile(dict_path):
        with open(dict_path, "rb") as f:
            return f.read()
    return b"key,context,es\n"
