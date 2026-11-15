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
import threading

_CATALOG_LOCK = threading.Lock()
_DICT_CACHE = None
_DICT_MTIME = 0.0
_DICT_PATH = None
_CSV_BYTES_CACHE = None
_VER_CACHE = None
_VER_MTIME = 0.0
_VER_PATH = None

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
    "pt": "Português",
    "it": "Italiano",
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


def load_dictionary(base_dir=None):
    """Carga y cachea por mtime el diccionario único ./i18n/dictionary.csv."""
    global _DICT_CACHE, _DICT_MTIME, _DICT_PATH, _CSV_BYTES_CACHE
    dict_path = get_dictionary_file_path(base_dir)
    if dict_path:
        try:
            mtime = os.path.getmtime(dict_path)
            with _CATALOG_LOCK:
                if _DICT_CACHE is not None and _DICT_PATH == dict_path and _DICT_MTIME == mtime:
                    return _DICT_CACHE
                with open(dict_path, "rb") as fb:
                    raw_bytes = fb.read()
                parsed = parse_dictionary_csv_text(raw_bytes.decode("utf-8", errors="replace"))
                _DICT_CACHE = parsed
                _CSV_BYTES_CACHE = raw_bytes
                _DICT_MTIME = mtime
                _DICT_PATH = dict_path
                return _DICT_CACHE
        except Exception:
            pass
    if _DICT_CACHE is not None:
        return _DICT_CACHE
    return {
        "meta": {
            "default_locale": "es",
            "supported_locales": ["es"],
            "locale_names": {"es": "Español"},
            "source_format": "csv",
        },
        "flat": {"es": {}},
    }


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
