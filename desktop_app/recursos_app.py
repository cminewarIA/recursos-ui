#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recursos Cockpit — Aplicación Nativa de Escritorio Ubuntu Linux (GTK 3 + WebKit2 HTML5 Engine)
Arquitectura Híbrida Unificada:
- Contenedor nativo GTK 3 con aceleración por hardware WebKit2 que renderiza el 100% de la
  interfaz canónica HTML5/CSS3/D3.js v7/Leaflet en tiempo real.
- Puente local loopback (LocalHtmlBridgeServer) que inyecta la sesión criptográfica Zero-Trust,
  enruta la telemetría hacia el nodo descubierto (LAN o WAN DDNS con fallback a silicio local psutil)
  y desbloquea en exclusiva el subsistema de hardware USB DeX (/dev/uhid, scrcpy, adb).
"""

import argparse
import base64
import hashlib
import http.server
import ipaddress
import json
import os
import platform
import re
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import cairo
    HAS_CAIRO = True
except ImportError:
    cairo = None
    HAS_CAIRO = False

HAS_GTK = False
HAS_WEBKIT2 = False
WebKit2 = None

try:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import Gdk, GdkPixbuf, GLib, Gtk, Pango

    HAS_GTK = True

    for wk_ver in ("4.1", "4.0"):
        try:
            gi.require_version("WebKit2", wk_ver)
            from gi.repository import WebKit2 as _WK2

            WebKit2 = _WK2
            HAS_WEBKIT2 = True
            break
        except Exception:
            continue
except ImportError:
    class _GtkStub:
        DrawingArea = object
        ApplicationWindow = object
        Application = object

    Gtk = _GtkStub()
    Gdk = object()
    GLib = object()
    Pango = object()

try:
    import psutil
except ImportError:
    psutil = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
for _cand_dir in (
    SCRIPT_DIR,
    os.path.abspath(os.path.join(SCRIPT_DIR, "..")),
    "/usr/lib/recursos-cockpit",
    "/usr/share/recursos-cockpit",
):
    if os.path.isdir(_cand_dir) and _cand_dir not in sys.path:
        sys.path.insert(0, _cand_dir)

from dex_controller import DexController

try:
    from i18n_catalog import (
        get_canonical_version as _catalog_get_version,
        get_dictionary_bytes as _catalog_dict_bytes,
        get_dictionary_csv_bytes as _catalog_dict_csv_bytes,
        t as _catalog_t,
        resolve_catalog_base_dir as _catalog_base_dir,
        schedule_background_dictionary_sync as _catalog_schedule_sync,
        sync_dictionary_from_github as _catalog_sync_github,
    )
    HAS_I18N_CATALOG = True
except Exception:
    HAS_I18N_CATALOG = False
    def _catalog_get_version(*_a, **_kw):
        return "0.0.0"
    def _catalog_dict_bytes(*_a, **_kw):
        return b"{}"
    def _catalog_dict_csv_bytes(*_a, **_kw):
        return b"key,context,es\n"
    def _catalog_t(key, locale=None, params=None, fallback=None, base_dir=None):
        text = fallback if fallback is not None else key
        if params and isinstance(params, dict):
            for pk, pv in params.items():
                text = text.replace("{" + str(pk) + "}", str(pv))
        return text
    def _catalog_base_dir(*_a, **_kw):
        return os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
    def _catalog_schedule_sync(*_a, **_kw):
        return None
    def _catalog_sync_github(*_a, **_kw):
        return {"ok": False, "updated": False, "source": "local", "supported_locales": ["es"]}

try:
    from themes_catalog import (
        get_single_theme_payload as _themes_get_single,
        get_themes_catalog_payload as _themes_get_catalog,
        sync_themes_from_github as _themes_sync_github,
    )
except Exception:
    def _themes_get_catalog(*_a, **_kw):
        return {"ok": True, "schema_version": 1, "default_theme": "alethia-matrix", "source": "local", "themes": []}
    def _themes_get_single(*_a, **_kw):
        return None
    def _themes_sync_github(*_a, **_kw):
        return {"ok": False, "source": "local"}


def i18n_t(key, params=None, fallback=None, locale=None):
    base_dir = _catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
    kw = dict(params) if isinstance(params, dict) else {}
    if HAS_I18N_CATALOG:
        return _catalog_t(key, lang=locale, base_dir=base_dir, fallback=fallback, **kw)
    return _catalog_t(key, locale=locale, params=kw, fallback=fallback, base_dir=base_dir)


_ALLOWED_GITHUB_HOSTS = frozenset({
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
})


def is_allowed_github_url(url):
    try:
        parsed = urllib.parse.urlparse(str(url or "").strip())
        return parsed.scheme == "https" and (parsed.hostname or "").lower() in _ALLOWED_GITHUB_HOSTS
    except Exception:
        return False


def _read_version_file(filename, fallback="1.1.1"):
    for path in (
        os.path.join(SCRIPT_DIR, "..", filename),
        os.path.join(SCRIPT_DIR, filename),
        f"/usr/lib/recursos-cockpit/{filename}",
        f"/usr/share/recursos-cockpit/{filename}",
        f"./{filename}",
    ):
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    v = f.read().strip().lstrip("vV")
                    if v:
                        return v
            except Exception:
                pass
    return fallback


def get_app_version():
    """Lee la versión independiente del cliente nativo Ubuntu desde UBUNTU_VERSION (desacoplada de ./VERSION)."""
    return _read_version_file("UBUNTU_VERSION", fallback="1.1.1")


def get_android_client_version():
    """Lee la versión independiente del cliente Android desde ANDROID_VERSION."""
    return _read_version_file("ANDROID_VERSION", fallback="1.1.1")


def get_server_bundled_version():
    """Lee la versión del servidor/web empaquetado desde ./VERSION."""
    ver = _catalog_get_version(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
    if ver and ver != "0.0.0":
        return ver
    return _read_version_file("VERSION", fallback="0.0.0")


def get_display_version(raw_ver=None):
    return str(raw_ver or get_app_version()).strip()


_UBUNTU_ROOT_CACHE = {"checked": False, "root_access": False, "root_method": "none"}
_UBUNTU_ROOT_LOCK = threading.Lock()


def detect_ubuntu_root_status(force=False):
    """Comprueba acceso root en segundo plano sin mostrar ningún selector ni opción al usuario."""
    with _UBUNTU_ROOT_LOCK:
        if _UBUNTU_ROOT_CACHE["checked"] and not force:
            return {
                "root_access": bool(_UBUNTU_ROOT_CACHE["root_access"]),
                "root_method": str(_UBUNTU_ROOT_CACHE["root_method"]),
            }
    has_root = False
    method = "none"
    try:
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            has_root = True
            method = "uid0"
        else:
            p = subprocess.run(
                ["sudo", "-n", "true"],
                capture_output=True,
                text=True,
                timeout=1.5,
            )
            if p.returncode == 0:
                has_root = True
                method = "sudo"
    except Exception:
        has_root = False
        method = "none"
    with _UBUNTU_ROOT_LOCK:
        _UBUNTU_ROOT_CACHE["checked"] = True
        _UBUNTU_ROOT_CACHE["root_access"] = has_root
        _UBUNTU_ROOT_CACHE["root_method"] = method
    return {"root_access": has_root, "root_method": method}


def resolve_user_downloads_dir():
    """Resuelve dinámicamente la carpeta de Descargas del usuario (xdg-user-dir DOWNLOAD / ~/Downloads)."""
    try:
        p = subprocess.run(["xdg-user-dir", "DOWNLOAD"], capture_output=True, text=True, timeout=2.0)
        cand = (p.stdout or "").strip()
        if p.returncode == 0 and cand and os.path.isabs(cand):
            os.makedirs(cand, exist_ok=True)
            return cand
    except Exception:
        pass
    home = os.path.expanduser("~")
    for sub in ("Descargas", "Downloads"):
        cand = os.path.join(home, sub)
        if os.path.isdir(cand):
            return cand
    fallback = os.path.join(home, "Downloads")
    try:
        os.makedirs(fallback, exist_ok=True)
    except Exception:
        pass
    return fallback


def parse_semver_tuple(ver_str):
    clean = str(ver_str or "").strip().lstrip("vV")
    clean = clean.split("-")[0].split("+")[0]
    parts = []
    for p in clean.split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def resolve_bundled_root():
    """Devuelve el directorio raíz que contiene los archivos web empaquetados (VERSION, static/index.html, etc.)."""
    candidates = [
        os.path.abspath(os.path.join(SCRIPT_DIR, "..")),
        os.path.abspath(SCRIPT_DIR),
        "/usr/lib/recursos-cockpit",
        "/usr/share/recursos-cockpit",
        os.path.abspath("."),
    ]
    for root in candidates:
        if os.path.isfile(os.path.join(root, "static", "index.html")):
            return root
    for root in candidates:
        if os.path.isfile(os.path.join(root, "VERSION")):
            return root
    return os.path.abspath(os.path.join(SCRIPT_DIR, ".."))


def resolve_bundled_html_path():
    """Localiza el archivo HTML5 canónico compilado (static/index.html tiene prioridad)."""
    candidates = [
        os.path.join(SCRIPT_DIR, "..", "static", "index.html"),
        os.path.join(SCRIPT_DIR, "static", "index.html"),
        "/usr/lib/recursos-cockpit/static/index.html",
        "/usr/share/recursos-cockpit/static/index.html",
        "./static/index.html",
        os.path.join(SCRIPT_DIR, "..", "index.html"),
        "./index.html",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return os.path.abspath(path)
    return None


def resolve_static_asset_path(fname):
    safe_name = os.path.basename(str(fname or "").strip())
    if not safe_name:
        return None
    candidates = [
        os.path.join(SCRIPT_DIR, "..", "static", safe_name),
        os.path.join(SCRIPT_DIR, "assets", safe_name),
        os.path.join("/usr/lib/recursos-cockpit/static", safe_name),
        os.path.join("/usr/lib/recursos-cockpit/assets", safe_name),
        os.path.join("/usr/share/pixmaps", safe_name),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return os.path.abspath(path)
    return None


def _read_sysfs_str(path):
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                val = f.read().strip()
                if val and val.lower() not in (
                    "to be filled by o.e.m.",
                    "default string",
                    "none",
                    "unknown",
                    "not specified",
                ):
                    return val
    except Exception:
        pass
    return ""


_STATIC_HW_TELEMETRY_CACHE = None


def _collect_static_hw_telemetry():
    """Recopila una sola vez por proceso los campos DMI, CPU y GPU sin re-spawnear lspci en cada poll."""
    global _STATIC_HW_TELEMETRY_CACHE
    if _STATIC_HW_TELEMETRY_CACHE is not None:
        return _STATIC_HW_TELEMETRY_CACHE

    hostname = socket.gethostname()
    arch = platform.machine() or "x86_64"
    kernel = f"{platform.system()} {platform.release()}"

    os_distro = kernel
    if os.path.isfile("/etc/os-release"):
        try:
            with open("/etc/os-release", "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        os_distro = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass

    dmi_base = "/sys/devices/virtual/dmi/id"
    if not os.path.isdir(dmi_base):
        dmi_base = "/sys/class/dmi/id"
    manufacturer = (
        _read_sysfs_str(os.path.join(dmi_base, "sys_vendor"))
        or _read_sysfs_str(os.path.join(dmi_base, "board_vendor"))
    )
    product_name = (
        _read_sysfs_str(os.path.join(dmi_base, "product_name"))
        or _read_sysfs_str(os.path.join(dmi_base, "product_family"))
        or _read_sysfs_str("/proc/device-tree/model")
    )
    board_name = _read_sysfs_str(os.path.join(dmi_base, "board_name"))
    bios_version = _read_sysfs_str(os.path.join(dmi_base, "bios_version"))
    chassis_code = _read_sysfs_str(os.path.join(dmi_base, "chassis_type"))
    chassis_map = {
        "3": "Workstation Desktop",
        "4": "Low Profile Desktop",
        "6": "Mini Tower",
        "7": "Tower",
        "8": "Portable",
        "9": "Laptop",
        "10": "Notebook",
        "14": "Sub Notebook",
        "17": "Main Server Chassis",
        "23": "Rack Mount Chassis",
        "30": "Tablet",
        "31": "Convertible",
        "32": "Detachable",
        "35": "Mini PC",
    }
    chassis_type = chassis_map.get(chassis_code, "Linux Workstation")

    cpu_model = ""
    if os.path.isfile("/proc/cpuinfo"):
        try:
            with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if ":" in line:
                        k, v = line.split(":", 1)
                        if k.strip().lower() in ("model name", "hardware", "processor") and not v.strip().isdigit():
                            cpu_model = v.strip()
                            break
        except Exception:
            pass
    if not cpu_model or cpu_model.lower() == "unknown":
        proc_str = platform.processor()
        cpu_model = proc_str if (proc_str and proc_str.lower() != "unknown") else f"CPU ({arch})"

    phys_cores = (psutil.cpu_count(logical=False) or 1) if psutil else (os.cpu_count() or 1)
    log_cores = (psutil.cpu_count(logical=True) or 1) if psutil else (os.cpu_count() or 1)

    gpu_model = ""
    try:
        out = subprocess.check_output(
            ["sh", "-c", "lspci 2>/dev/null | grep -iE 'vga|3d|display' | head -n 1"],
            timeout=1.0,
        ).decode("utf-8", errors="ignore").strip()
        if ":" in out:
            gpu_model = out.split(":", 2)[-1].strip()
    except Exception:
        pass

    _STATIC_HW_TELEMETRY_CACHE = {
        "hostname": hostname,
        "arch": arch,
        "kernel": kernel,
        "os_distro": os_distro,
        "manufacturer": manufacturer,
        "product_name": product_name,
        "board_name": board_name,
        "bios_version": bios_version,
        "chassis_type": chassis_type,
        "cpu_model": cpu_model,
        "phys_cores": phys_cores,
        "log_cores": log_cores,
        "gpu_model": gpu_model,
    }
    return _STATIC_HW_TELEMETRY_CACHE


def collect_native_device_telemetry():
    """
    Recopila con acceso total al sistema operativo todos los metadatos de hardware,
    silicio, red, energía y entorno gráfico del equipo Ubuntu Linux sin ningún valor hardcodeado.
    """
    ver = get_app_version()
    hw = _collect_static_hw_telemetry()
    hostname = hw["hostname"]
    arch = hw["arch"]
    kernel = hw["kernel"]
    os_distro = hw["os_distro"]
    manufacturer = hw["manufacturer"]
    product_name = hw["product_name"]
    board_name = hw["board_name"]
    bios_version = hw["bios_version"]
    chassis_type = hw["chassis_type"]
    cpu_model = hw["cpu_model"]
    phys_cores = hw["phys_cores"]
    log_cores = hw["log_cores"]
    gpu_model = hw["gpu_model"]

    # 4. RAM & Almacenamiento (con respaldo directo /proc/meminfo y os.statvfs)
    vm = psutil.virtual_memory() if psutil else None
    ram_total_bytes = int(vm.total) if vm else 0
    if not ram_total_bytes and os.path.isfile("/proc/meminfo"):
        try:
            with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        parts = line.split()
                        if len(parts) >= 2 and parts[1].isdigit():
                            ram_total_bytes = int(parts[1]) * 1024
                        break
        except Exception:
            pass
    ram_total_gb = round(ram_total_bytes / (1024 ** 3), 1) if ram_total_bytes else 0.0

    storage_total_bytes = 0
    storage_free_bytes = 0
    if psutil:
        try:
            du = psutil.disk_usage("/")
            storage_total_bytes = int(du.total)
            storage_free_bytes = int(du.free)
        except Exception:
            pass
    if not storage_total_bytes:
        try:
            st = os.statvfs("/")
            storage_total_bytes = int(st.f_blocks * st.f_frsize)
            storage_free_bytes = int(st.f_bavail * st.f_frsize)
        except Exception:
            pass
    storage_total_gb = round(storage_total_bytes / (1024 ** 3), 1) if storage_total_bytes else 0.0
    storage_free_gb = round(storage_free_bytes / (1024 ** 3), 1) if storage_free_bytes else 0.0

    # 5. Batería y Energía
    battery_percent = None
    battery_charging = None
    if psutil and hasattr(psutil, "sensors_battery"):
        try:
            bat = psutil.sensors_battery()
            if bat is not None:
                battery_percent = int(round(bat.percent))
                battery_charging = bool(bat.power_plugged)
        except Exception:
            pass

    # 6. Interfaz de Red Activa, IP Local y MAC
    local_ip = "127.0.0.1"
    interface_name = "lo"
    mac_address = ""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    if psutil:
        try:
            if_addrs = psutil.net_if_addrs()
            for ifname, addr_list in if_addrs.items():
                if ifname == "lo" or ifname.startswith(("docker", "veth", "br-")):
                    continue
                if_ipv4 = ""
                if_mac = ""
                for addr in addr_list:
                    if addr.family == socket.AF_INET and addr.address:
                        if_ipv4 = addr.address
                    elif getattr(psutil, "AF_LINK", None) and addr.family == psutil.AF_LINK and addr.address:
                        if addr.address != "00:00:00:00:00:00":
                            if_mac = addr.address.upper()
                if if_ipv4 == local_ip or (local_ip == "127.0.0.1" and if_ipv4):
                    local_ip = if_ipv4
                    interface_name = ifname
                    mac_address = if_mac
                    break
        except Exception:
            pass

    if (interface_name == "lo" or not mac_address) and os.path.isdir("/sys/class/net"):
        try:
            for ifname in sorted(os.listdir("/sys/class/net")):
                if ifname == "lo" or ifname.startswith(("docker", "veth", "br-")):
                    continue
                addr_val = _read_sysfs_str(f"/sys/class/net/{ifname}/address")
                if addr_val and addr_val != "00:00:00:00:00:00":
                    if interface_name == "lo":
                        interface_name = ifname
                    if not mac_address:
                        mac_address = addr_val.upper()
                    break
        except Exception:
            pass

    # 7. Pantalla y Sesión Gráfica
    desktop_env = os.environ.get("XDG_CURRENT_DESKTOP") or os.environ.get("DESKTOP_SESSION") or "GTK3"
    session_type = os.environ.get("XDG_SESSION_TYPE") or "x11"
    desktop_session = f"{desktop_env} ({session_type.upper()})"
    screen_resolution = ""
    if HAS_GTK:
        try:
            disp = Gdk.Display.get_default()
            if disp:
                mon = disp.get_primary_monitor()
                if mon is None and disp.get_n_monitors() > 0:
                    mon = disp.get_monitor(0)
                if mon:
                    geo = mon.get_geometry()
                    screen_resolution = f"{geo.width}x{geo.height}"
        except Exception:
            pass

    # 8. Huella Criptográfica Única de Hardware (Hardware Fingerprint)
    raw_machine_id = _read_sysfs_str("/etc/machine-id") or _read_sysfs_str("/var/lib/dbus/machine-id")
    fp_seed = f"ubuntu_native:{raw_machine_id or mac_address or hostname}:{arch}"
    hardware_id = "ubn_" + hashlib.sha256(fp_seed.encode("utf-8")).hexdigest()[:16]

    display_title_parts = []
    if manufacturer and product_name:
        if manufacturer.lower() in product_name.lower():
            display_title_parts.append(product_name)
        else:
            display_title_parts.append(f"{manufacturer} {product_name}")
    elif product_name:
        display_title_parts.append(product_name)
    elif board_name:
        display_title_parts.append(f"{manufacturer} {board_name}".strip())
    display_model = " ".join(display_title_parts).strip() or f"Ubuntu Workstation ({hostname})"

    root_status = detect_ubuntu_root_status()
    return {
        "client_type": "ubuntu_native",
        "client_label": "App Nativa Ubuntu (.deb)",
        "access_level": "FULL_NATIVE_ACCESS",
        "full_access": True,
        "dex_capable": True,
        "app_version": ver,
        "client_version": ver,
        "root_access": bool(root_status.get("root_access", False)),
        "root_method": str(root_status.get("root_method") or "none"),
        "hardware_id": hardware_id,
        "install_id": hardware_id,
        "name": f"{display_model} · {hostname}",
        "hostname": hostname,
        "manufacturer": manufacturer or "Linux System",
        "brand": manufacturer or "Ubuntu",
        "model": product_name or board_name or hostname,
        "board": board_name,
        "bios_version": bios_version,
        "chassis_type": chassis_type,
        "os_distro": os_distro,
        "os_info": os_distro,
        "kernel": kernel,
        "arch": arch,
        "architecture": arch,
        "desktop_session": desktop_session,
        "cpu_model": cpu_model,
        "cpu_cores_physical": phys_cores,
        "cpu_cores_logical": log_cores,
        "gpu_model": gpu_model,
        "ram_total_bytes": ram_total_bytes,
        "ram_total_gb": ram_total_gb,
        "storage_total_bytes": storage_total_bytes,
        "storage_total_gb": storage_total_gb,
        "storage_free_gb": storage_free_gb,
        "battery_percent": battery_percent,
        "battery_charging": battery_charging,
        "screen_resolution": screen_resolution,
        "local_ip": local_ip,
        "interface_name": interface_name,
        "mac_address": mac_address,
    }


def encode_telemetry_header(telemetry_dict):
    try:
        raw = json.dumps(telemetry_dict, ensure_ascii=False).encode("utf-8")
        return base64.b64encode(raw).decode("ascii")
    except Exception:
        return ""


NATIVE_CSS_LIGHT = b"""
window {
    background-color: #f5f4f2;
    color: #0f1f10;
    font-family: "Geist", "Inter", "Ubuntu", sans-serif;
}
headerbar {
    background-image: none;
    background-color: #ffffff;
    color: #0f1f10;
    border-bottom: 1px solid #e0dfda;
    min-height: 44px;
    padding: 0 10px;
}
headerbar .title {
    color: #0f1f10;
    font-weight: 700;
}
headerbar .subtitle {
    color: #5f6c61;
    font-size: 11px;
}
headerbar button {
    color: #0f1f10;
    transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
headerbar:backdrop {
    background-color: #ffffff;
    color: #0f1f10;
}
headerbar:backdrop .title {
    color: #0f1f10;
}
headerbar:backdrop .subtitle {
    color: #5f6c61;
}
headerbar button.titlebutton,
headerbar .titlebutton,
headerbar:backdrop button.titlebutton,
headerbar:backdrop .titlebutton {
    background-image: none;
    background-color: #eeede9;
    color: #0f1f10;
    border: 1px solid #c8c6bd;
    border-radius: 9999px;
    min-width: 28px;
    min-height: 28px;
    margin: 0 3px;
    padding: 2px;
    box-shadow: none;
    opacity: 1;
}
headerbar button.titlebutton:hover,
headerbar .titlebutton:hover {
    background-color: #e5f8d3;
    border-color: #9bd86b;
    color: #0f1f10;
}
headerbar button.titlebutton.close,
headerbar .titlebutton.close,
headerbar:backdrop button.titlebutton.close,
headerbar:backdrop .titlebutton.close {
    background-color: #fee2e2;
    border-color: #fca5a5;
    color: #b91c1c;
}
headerbar button.titlebutton.close:hover,
headerbar .titlebutton.close:hover {
    background-color: #dc2626;
    border-color: #b91c1c;
    color: #ffffff;
}
headerbar button.titlebutton image,
headerbar .titlebutton image,
headerbar:backdrop button.titlebutton image,
headerbar:backdrop .titlebutton image {
    color: #0f1f10;
    opacity: 1;
    -gtk-icon-style: symbolic;
    -gtk-icon-shadow: none;
}
headerbar button.titlebutton.close image,
headerbar .titlebutton.close image,
headerbar:backdrop button.titlebutton.close image,
headerbar:backdrop .titlebutton.close image {
    color: #b91c1c;
}
headerbar button.titlebutton.close:hover image,
headerbar .titlebutton.close:hover image {
    color: #ffffff;
}
.btn-nav image {
    color: #0f1f10;
    -gtk-icon-style: symbolic;
}
.launcher-hero {
    background-image: linear-gradient(135deg, #0c190d, #0f1f10 55%, #162818);
    border: 1px solid #2b452d;
    border-radius: 22px;
    padding: 24px 28px;
    color: #f5f4f2;
    box-shadow: 0 14px 32px -10px rgba(10, 20, 11, 0.36);
}
.launcher-hero .launcher-title {
    font-size: 21px;
    font-weight: 800;
    color: #f5f4f2;
}
.launcher-hero .launcher-subtitle {
    font-size: 13px;
    color: #c8d2c6;
}
.launcher-card {
    background-color: #ffffff;
    border: 1px solid #e0dfda;
    border-radius: 18px;
    padding: 20px;
    box-shadow: 0 4px 16px -4px rgba(15, 31, 16, 0.06);
    transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.launcher-card:hover {
    border-color: #9bd86b;
    box-shadow: 0 12px 26px -8px rgba(30, 107, 56, 0.14);
}
.launcher-title {
    font-size: 20px;
    font-weight: 800;
    color: #0f1f10;
}
.launcher-card-title {
    font-size: 15px;
    font-weight: 700;
    color: #0f1f10;
}
.launcher-subtitle {
    font-size: 13px;
    color: #3e4d40;
}
.badge-ready {
    background-color: #c6f19d;
    border: 1px solid #9bd86b;
    color: #0f1f10;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-lan {
    background-color: #e5f8d3;
    border: 1px solid #9bd86b;
    color: #144d23;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-wan {
    background-color: #e6f5ee;
    border: 1px solid #7bd1a8;
    color: #0f5132;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-revoked {
    background-color: #fee2e2;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-scanning {
    background-color: #fef3c7;
    border: 1px solid #f5c95c;
    color: #92400e;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-local {
    background-color: #eeede9;
    border: 1px solid #c8c6bd;
    color: #3e4d40;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.btn-primary {
    background-image: linear-gradient(135deg, #0f1f10, #173019);
    color: #c6f19d;
    font-weight: 700;
    border-radius: 12px;
    padding: 10px 18px;
    border: 1px solid #2c4a2e;
    box-shadow: 0 6px 14px -4px rgba(15, 31, 16, 0.32);
    transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-primary:hover {
    background-image: linear-gradient(135deg, #173019, #1e6b38);
    color: #f5f4f2;
}
.btn-nav {
    background-image: none;
    background-color: #eeede9;
    color: #0f1f10;
    font-weight: 600;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid #c8c6bd;
    transition: all 180ms ease;
}
.btn-nav:hover {
    background-color: #e5f8d3;
    border-color: #9bd86b;
    color: #0f1f10;
}
.btn-dex {
    background-image: none;
    background-color: #c6f19d;
    color: #0f1f10;
    font-weight: 700;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid #9bd86b;
    transition: all 180ms ease;
}
.btn-dex:hover {
    background-color: #d5eebc;
}
"""

NATIVE_CSS_DARK = b"""
window {
    background-color: #0a140b;
    color: #f5f4f2;
    font-family: "Geist", "Inter", "Ubuntu", sans-serif;
}
headerbar {
    background-image: none;
    background-color: #111f13;
    color: #f5f4f2;
    border-bottom: 1px solid rgba(198, 241, 157, 0.14);
    min-height: 44px;
    padding: 0 10px;
}
headerbar .title {
    color: #f5f4f2;
    font-weight: 700;
}
headerbar .subtitle {
    color: #8b9a8c;
    font-size: 11px;
}
headerbar button {
    color: #f5f4f2;
    transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
headerbar:backdrop {
    background-color: #111f13;
    color: #f5f4f2;
}
headerbar:backdrop .title {
    color: #f5f4f2;
}
headerbar:backdrop .subtitle {
    color: #8b9a8c;
}
headerbar button.titlebutton,
headerbar .titlebutton,
headerbar:backdrop button.titlebutton,
headerbar:backdrop .titlebutton {
    background-image: none;
    background-color: #18291a;
    color: #f5f4f2;
    border: 1px solid rgba(198, 241, 157, 0.18);
    border-radius: 9999px;
    min-width: 28px;
    min-height: 28px;
    margin: 0 3px;
    padding: 2px;
    box-shadow: none;
    opacity: 1;
}
headerbar button.titlebutton:hover,
headerbar .titlebutton:hover {
    background-color: #213624;
    border-color: rgba(198, 241, 157, 0.42);
    color: #c6f19d;
}
headerbar button.titlebutton.close,
headerbar .titlebutton.close,
headerbar:backdrop button.titlebutton.close,
headerbar:backdrop .titlebutton.close {
    background-color: #34161a;
    border-color: rgba(251, 113, 133, 0.38);
    color: #fb7185;
}
headerbar button.titlebutton.close:hover,
headerbar .titlebutton.close:hover {
    background-color: #dc2626;
    border-color: #fb7185;
    color: #ffffff;
}
headerbar button.titlebutton image,
headerbar .titlebutton image,
headerbar:backdrop button.titlebutton image,
headerbar:backdrop .titlebutton image {
    color: #f5f4f2;
    opacity: 1;
    -gtk-icon-style: symbolic;
    -gtk-icon-shadow: none;
}
headerbar button.titlebutton.close image,
headerbar .titlebutton.close image,
headerbar:backdrop button.titlebutton.close image,
headerbar:backdrop .titlebutton.close image {
    color: #fb7185;
}
headerbar button.titlebutton.close:hover image,
headerbar .titlebutton.close:hover image {
    color: #ffffff;
}
.btn-nav image {
    color: #f5f4f2;
    -gtk-icon-style: symbolic;
}
.launcher-hero {
    background-image: linear-gradient(135deg, #0f1f10, #162818 58%, #1d3620);
    border: 1px solid rgba(198, 241, 157, 0.22);
    border-radius: 22px;
    padding: 24px 28px;
    color: #f5f4f2;
    box-shadow: 0 16px 36px -10px rgba(0, 0, 0, 0.65);
}
.launcher-hero .launcher-title {
    font-size: 21px;
    font-weight: 800;
    color: #f5f4f2;
}
.launcher-hero .launcher-subtitle {
    font-size: 13px;
    color: #c8d2c6;
}
.launcher-card {
    background-color: #111f13;
    border: 1px solid rgba(198, 241, 157, 0.14);
    border-radius: 18px;
    padding: 20px;
    box-shadow: 0 10px 26px -6px rgba(0, 0, 0, 0.55);
    transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.launcher-card:hover {
    border-color: rgba(198, 241, 157, 0.36);
    box-shadow: 0 14px 30px -8px rgba(0, 0, 0, 0.68);
}
.launcher-title {
    font-size: 20px;
    font-weight: 800;
    color: #f5f4f2;
}
.launcher-card-title {
    font-size: 15px;
    font-weight: 700;
    color: #f5f4f2;
}
.launcher-subtitle {
    font-size: 13px;
    color: #c8d2c6;
}
.badge-ready {
    background-color: #c6f19d;
    border: 1px solid #a8e474;
    color: #0f1f10;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-lan {
    background-color: rgba(198, 241, 157, 0.14);
    border: 1px solid rgba(198, 241, 157, 0.34);
    color: #c6f19d;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-wan {
    background-color: rgba(94, 234, 212, 0.14);
    border: 1px solid rgba(94, 234, 212, 0.32);
    color: #5eead4;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-revoked {
    background-color: rgba(251, 113, 133, 0.14);
    border: 1px solid rgba(251, 113, 133, 0.36);
    color: #fb7185;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-scanning {
    background-color: rgba(251, 191, 36, 0.14);
    border: 1px solid rgba(251, 191, 36, 0.34);
    color: #fbbf24;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-local {
    background-color: #18291a;
    border: 1px solid rgba(198, 241, 157, 0.18);
    color: #c8d2c6;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.btn-primary {
    background-image: none;
    background-color: #c6f19d;
    color: #0f1f10;
    font-weight: 700;
    border-radius: 12px;
    padding: 10px 18px;
    border: 1px solid #a8e474;
    box-shadow: 0 6px 16px -4px rgba(0, 0, 0, 0.45);
    transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-primary:hover {
    background-color: #d7f7b7;
    color: #0a140b;
}
.btn-nav {
    background-image: none;
    background-color: #18291a;
    color: #f5f4f2;
    font-weight: 600;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid rgba(198, 241, 157, 0.18);
    transition: all 180ms ease;
}
.btn-nav:hover {
    background-color: #213624;
    border-color: rgba(198, 241, 157, 0.42);
    color: #c6f19d;
}
.btn-dex {
    background-image: none;
    background-color: #c6f19d;
    color: #0f1f10;
    font-weight: 700;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid #a8e474;
    transition: all 180ms ease;
}
.btn-dex:hover {
    background-color: #d7f7b7;
}
"""

NATIVE_CSS = NATIVE_CSS_LIGHT



def _is_valid_wan_domain(dom):
    """Valida que el dominio público detectado sea un DNS real y no una IP LAN ni .local."""
    clean = str(dom or "").strip()
    if not clean:
        return False
    host = clean.split("://")[-1].split("/")[0].split(":")[0].strip().lower()
    if not host or host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local"):
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        return "." in host


class ServerConnectionManager:
    """
    Gestor de autodescubrimiento en red local (LAN), conmutación inteligente a WAN (DDNS)
    y persistencia criptográfica Zero-Trust para la aplicación nativa de Ubuntu.
    """

    def __init__(self, config_dir=None):
        if config_dir is None:
            config_dir = os.path.expanduser("~/.config/recursos-cockpit")
        self.config_dir = config_dir
        self.config_file = os.path.join(self.config_dir, "client_config.json")
        self.lock = threading.Lock()
        self.active_url = ""
        self.connection_mode = "DISCONNECTED"  # LAN, WAN, SCANNING, REVOKED, LOCAL
        self.latest_metrics = None
        self.device_token = ""
        self.saved_host = ""
        self.node_port = int(os.environ.get("RECURSOS_NODE_PORT", "8085"))
        self.wan_domain = os.environ.get("RECURSOS_WAN_DOMAIN", "").strip()
        self.auto_install_enabled = True
        self.auto_install_in_progress = False
        self.auto_install_status = ""
        self.last_auto_install = ""
        self._auto_perm_cooldown_until = 0.0
        self._update_exec_lock = threading.Lock()
        self._last_release_check_ts = 0.0
        self._cached_release_meta = {}
        self.is_revoked = False
        self.ui_theme = "light"
        self._last_net_io = psutil.net_io_counters() if psutil else None
        self._last_net_ts = time.time()
        self.github_update_info = None
        self.device_telemetry = collect_native_device_telemetry()
        self._load_config()
        if not self.auto_install_status:
            self.auto_install_status = i18n_t(
                "more.auto_enabled_status" if self.auto_install_enabled else "more.auto_paused_status"
            )
        try:
            _catalog_schedule_sync(_catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, ".."))), interval_sec=1800.0)
        except Exception:
            pass

    def refresh_device_telemetry(self):
        self.device_telemetry = collect_native_device_telemetry()
        self.device_telemetry["connection_mode"] = self.connection_mode
        return self.device_telemetry

    def _build_auth_headers(self, extra=None):
        ver = get_app_version()
        tel = self.device_telemetry if isinstance(self.device_telemetry, dict) else {}
        headers = {
            "User-Agent": f"RecursosCockpit-Linux/{ver} (Ubuntu; NativeHTML; FullAccess)",
            "X-Recursos-Client": "ubuntu_native",
            "X-Device-Telemetry": encode_telemetry_header(tel),
        }
        origin_ip = str(tel.get("local_ip") or "").strip()
        if origin_ip and origin_ip not in ("127.0.0.1", "::1", "localhost"):
            headers["X-Recursos-Origin-IP"] = origin_ip
        dev_name = str(tel.get("hostname") or tel.get("name") or "").strip()
        if dev_name:
            headers["X-Recursos-Device-Name"] = dev_name[:48]
        if self.device_token:
            headers["X-Device-Token"] = self.device_token
            headers["Authorization"] = f"Bearer {self.device_token}"
        if extra:
            headers.update(extra)
        return headers

    def _load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.device_token = data.get("device_token", "")
                    self.saved_host = data.get("saved_host", "")
                    self.node_port = int(data.get("node_port", 8085) or 8085)
                    self.wan_domain = str(data.get("wan_domain", "") or os.environ.get("RECURSOS_WAN_DOMAIN", "")).strip()
                    self.auto_install_enabled = bool(data.get("auto_install_enabled", True))
                    self.is_revoked = data.get("is_revoked", False)
                    saved_theme = str(data.get("ui_theme", "") or "").strip().lower()
                    if saved_theme in ("light", "dark"):
                        self.ui_theme = saved_theme
        except Exception:
            pass

    def _save_config(self):
        try:
            os.makedirs(self.config_dir, exist_ok=True)
            tmp_file = f"{self.config_file}.tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "device_token": self.device_token,
                        "saved_host": self.saved_host,
                        "node_port": self.node_port,
                        "wan_domain": self.wan_domain,
                        "auto_install_enabled": self.auto_install_enabled,
                        "is_revoked": self.is_revoked,
                        "ui_theme": self.ui_theme,
                        "hardware_id": self.device_telemetry.get("hardware_id", ""),
                    },
                    f,
                    indent=2,
                )
            try:
                os.chmod(tmp_file, 0o600)
            except Exception:
                pass
            os.replace(tmp_file, self.config_file)
        except Exception:
            pass

    def get_primary_lan_ip(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.2)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            if ip and not ip.startswith("127."):
                return ip
        except Exception:
            pass
        return str(self.device_telemetry.get("local_ip") or "127.0.0.1")

    def get_installed_deb_version(self):
        try:
            p = subprocess.run(
                ["dpkg-query", "-W", "-f=${Version}", "recursos-cockpit"],
                capture_output=True,
                text=True,
                timeout=2.0,
            )
            if p.returncode == 0 and p.stdout.strip():
                return p.stdout.strip()
        except Exception:
            pass
        return ""

    def detect_local_node_status(self):
        """Comprueba si existe un nodo local o la aplicación .deb instalada en esta máquina Ubuntu."""
        service_exists = os.path.isfile("/etc/systemd/system/system-dashboard.service")
        server_py_path = ""
        repo_dir = ""
        for cand in (
            os.path.join(SCRIPT_DIR, "..", "server.py"),
            "/usr/lib/recursos-cockpit/server.py",
            "/usr/share/recursos-cockpit/server.py",
        ):
            if os.path.isfile(cand):
                server_py_path = os.path.abspath(cand)
                parent_dir = os.path.dirname(server_py_path)
                if os.path.isdir(os.path.join(parent_dir, ".git")):
                    repo_dir = parent_dir
                break
        if not repo_dir:
            root_cand = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
            if os.path.isdir(os.path.join(root_cand, ".git")):
                repo_dir = root_cand

        running, _ = self._probe(f"http://127.0.0.1:{self.node_port}", timeout=0.5)
        service_active = False
        if service_exists:
            try:
                p = subprocess.run(
                    ["systemctl", "is-active", "system-dashboard.service"],
                    capture_output=True,
                    text=True,
                    timeout=1.5,
                )
                service_active = p.returncode == 0
            except Exception:
                pass
        installed_deb_version = self.get_installed_deb_version()
        app_installed_deb = bool(installed_deb_version) or os.path.isfile("/usr/bin/recursos-cockpit")
        installed = bool(service_exists or running)
        lan_ip = self.get_primary_lan_ip()
        return {
            "installed": installed,
            "running": bool(running or service_active),
            "service_exists": service_exists,
            "server_py_path": server_py_path,
            "repo_dir": repo_dir,
            "app_installed_deb": app_installed_deb,
            "installed_deb_version": installed_deb_version,
            "lan_ip": lan_ip,
            "port": self.node_port,
            "lan_url": f"http://{lan_ip}:{self.node_port}",
        }

    def _resolve_target_server_url(self, explicit_url=None):
        """Localiza de forma rápida el nodo servidor web activo (conectado, guardado, loopback o WAN)."""
        port = self.node_port or 8085
        candidates = []
        if explicit_url:
            candidates.append(str(explicit_url).strip().rstrip("/"))
        if self.active_url:
            candidates.append(str(self.active_url).strip().rstrip("/"))
        if self.saved_host:
            candidates.append(f"http://{self.saved_host}:{port}")
        candidates.extend([f"http://127.0.0.1:{port}", f"http://localhost:{port}"])
        wan_dom = (self.wan_domain or "").strip().rstrip("/")
        if wan_dom:
            wan_cand = wan_dom if wan_dom.startswith(("http://", "https://")) else f"https://{wan_dom}"
            candidates.append(wan_cand)

        seen = set()
        for cand in candidates:
            if not cand or cand in seen:
                continue
            seen.add(cand)
            timeout_val = 1.2 if cand.startswith("https://") else 0.6
            ok, is_rev = self._probe(cand, timeout=timeout_val)
            if ok and not is_rev:
                if not self.active_url:
                    self.active_url = cand
                    self.connection_mode = "WAN" if cand.startswith("https://") else "LAN"
                return cand
        return ""

    def probe_server_version_info(self, target_url=None, refresh=False):
        """Consulta /api/version en el servidor web activo y devuelve (payload_dict, reachable, base_url)."""
        base_url = self._resolve_target_server_url(target_url)
        if not base_url:
            return None, False, ""
        suffix = "/api/version?refresh=1" if refresh else "/api/version"
        req = urllib.request.Request(
            f"{base_url.rstrip('/')}{suffix}",
            headers=self._build_auth_headers({"Accept": "application/json"}),
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    if isinstance(payload, dict):
                        return payload, True, base_url
        except Exception:
            pass
        return None, False, base_url

    def collect_local_web_bundle(self, version_override=None):
        """Empaqueta los archivos estáticos web de esta App Ubuntu junto con sumas SHA-256."""
        bundle_root = resolve_bundled_root()
        sys_pkg_root = "/usr/lib/recursos-cockpit"
        if os.path.isfile(os.path.join(sys_pkg_root, "static", "index.html")):
            sys_ver_file = os.path.join(sys_pkg_root, "VERSION")
            cur_ver_file = os.path.join(bundle_root, "VERSION")
            try:
                sys_v = open(sys_ver_file, "r", encoding="utf-8").read().strip() if os.path.isfile(sys_ver_file) else "0.0.0"
                cur_v = open(cur_ver_file, "r", encoding="utf-8").read().strip() if os.path.isfile(cur_ver_file) else "0.0.0"
                if parse_semver_tuple(sys_v) >= parse_semver_tuple(cur_v):
                    bundle_root = sys_pkg_root
            except Exception:
                pass
        app_ver = str(version_override or self.get_installed_deb_version() or get_app_version()).strip().lstrip("vV")
        web_rel_paths = [
            "VERSION",
            "package.json",
            "i18n_catalog.py",
            "i18n/dictionary.csv",
            "static/index.html",
            "static/manual.html",
            "docs/index.html",
            "static/favicon.ico",
            "static/favicon.png",
            "static/favicon-16x16.png",
            "static/favicon-32x32.png",
            "static/favicon-192x192.png",
            "static/favicon-512x512.png",
            "static/apple-touch-icon.png",
        ]
        files_b64 = {}
        sha_map = {}
        for rel_path in web_rel_paths:
            abs_p = os.path.join(bundle_root, rel_path)
            if not os.path.isfile(abs_p) and rel_path.startswith("static/"):
                alt_p = resolve_static_asset_path(os.path.basename(rel_path))
                if alt_p and os.path.isfile(alt_p):
                    abs_p = alt_p
            if os.path.isfile(abs_p):
                try:
                    with open(abs_p, "rb") as f:
                        raw = f.read()
                    files_b64[rel_path] = base64.b64encode(raw).decode("ascii")
                    sha_map[rel_path] = hashlib.sha256(raw).hexdigest().lower()
                except Exception:
                    pass

        if "static/index.html" not in files_b64:
            html_path = resolve_bundled_html_path()
            if html_path and os.path.isfile(html_path):
                with open(html_path, "rb") as f:
                    raw = f.read()
                files_b64["static/index.html"] = base64.b64encode(raw).decode("ascii")
                sha_map["static/index.html"] = hashlib.sha256(raw).hexdigest().lower()

        if "docs/index.html" not in files_b64 and "static/manual.html" in files_b64:
            files_b64["docs/index.html"] = files_b64["static/manual.html"]
            sha_map["docs/index.html"] = sha_map["static/manual.html"]

        ver_bytes = (app_ver + "\n").encode("utf-8")
        files_b64["VERSION"] = base64.b64encode(ver_bytes).decode("ascii")
        sha_map["VERSION"] = hashlib.sha256(ver_bytes).hexdigest().lower()

        return {
            "version": app_ver,
            "files": files_b64,
            "sha256": sha_map,
            "root": bundle_root,
        }

    def sync_web_bundle_to_server(self, target_url=None, force=False, version_override=None):
        """Envía el paquete web compilado de la App Ubuntu a POST /api/system/sync-web en el servidor local."""
        base_url = self._resolve_target_server_url(target_url)
        if not base_url:
            return False, i18n_t("native_ubuntu.no_sync_server"), None
        bundle = self.collect_local_web_bundle(version_override=version_override)
        if "static/index.html" not in bundle["files"]:
            return False, i18n_t("native_ubuntu.no_index_html"), None

        payload_bytes = json.dumps(
            {
                "version": bundle["version"],
                "force": bool(force),
                "files": bundle["files"],
                "sha256": bundle["sha256"],
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url.rstrip('/')}/api/system/sync-web",
            data=payload_bytes,
            headers=self._build_auth_headers(
                {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                }
            ),
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25.0) as resp:
                res_obj = json.loads(resp.read().decode("utf-8"))
                ok = bool(res_obj.get("success"))
                msg = str(res_obj.get("message") or f"Web local sincronizada a v{bundle['version']}.")
                return ok, msg, res_obj
        except urllib.error.HTTPError as he:
            err_body = ""
            try:
                err_body = he.read().decode("utf-8", errors="ignore")
                err_json = json.loads(err_body)
                err_body = str(err_json.get("error") or err_body)
            except Exception:
                pass
            return False, f"HTTP {he.code} al sincronizar web local: {err_body or he.reason}", None
        except Exception as e:
            return False, f"No se pudo sincronizar la web local con el servidor: {e}", None

    def _compute_version_comparison(
        self,
        app_ver,
        gh_ver,
        server_ver,
        server_reachable,
        server_url="",
        installed_deb="",
        deb_url="https://github.com/cminewarIA/recursos-ui/releases/latest/download/recursos-cockpit.deb",
        deb_asset_name="recursos-cockpit.deb",
        sha_url="",
        release_url="https://github.com/cminewarIA/recursos-ui/releases/latest",
        err_msg="",
        deb_release_ver="",
    ):
        app_ver = str(app_ver or get_app_version()).strip().lstrip("vV")
        gh_ver = str(gh_ver or "").strip().lstrip("vV")
        deb_release_ver = str(deb_release_ver or gh_ver).strip().lstrip("vV")
        server_ver = str(server_ver or "").strip().lstrip("vV")
        installed_deb = str(installed_deb or "").strip().lstrip("vV")

        app_t = parse_semver_tuple(app_ver)
        gh_t = parse_semver_tuple(gh_ver) if gh_ver else (0, 0, 0)
        deb_rel_t = parse_semver_tuple(deb_release_ver) if deb_release_ver else (0, 0, 0)
        srv_t = parse_semver_tuple(server_ver) if (server_reachable and server_ver) else (0, 0, 0)

        github_above_app = bool(deb_release_ver and deb_rel_t > app_t)
        app_above_github = bool(gh_ver and app_t > gh_t)
        app_above_server = bool(server_reachable and server_ver and app_t > srv_t)
        github_above_server = bool(server_reachable and server_ver and gh_ver and gh_t > srv_t)
        server_needs_update = bool(app_above_server or github_above_server)
        effective_update_available = bool(github_above_app or server_needs_update)

        best_ver = app_ver
        best_t = app_t
        if deb_release_ver and deb_rel_t > best_t:
            best_ver = deb_release_ver
            best_t = deb_rel_t
        elif gh_ver and gh_t > best_t:
            best_ver = gh_ver
            best_t = gh_t
        if server_reachable and server_ver and srv_t > best_t:
            best_ver = server_ver

        app_disp = get_display_version(app_ver)
        gh_disp = get_display_version(deb_release_ver if github_above_app else gh_ver) if (gh_ver or deb_release_ver) else ""
        srv_disp = get_display_version(server_ver) if server_ver else ""

        if github_above_app and server_needs_update:
            update_mode = "github_deb_and_server"
            update_action_label = i18n_t("native_ubuntu.update_all_btn", {"ver": gh_disp})
            update_summary = i18n_t("native_ubuntu.summary_gh_all", {"gh": gh_disp, "app": app_disp, "srv": srv_disp})
        elif github_above_app:
            update_mode = "github_deb"
            update_action_label = i18n_t("native_ubuntu.update_app_btn", {"ver": gh_disp})
            update_summary = i18n_t("native_ubuntu.summary_gh_app", {"gh": gh_disp, "app": app_disp})
        elif app_above_server and app_above_github:
            update_mode = "sync_app_to_server_ahead_of_github"
            update_action_label = i18n_t("native_ubuntu.update_web_btn", {"ver": app_disp})
            update_summary = i18n_t("native_ubuntu.summary_app_srv_gh", {"app": app_disp, "gh": gh_disp, "srv": srv_disp})
        elif app_above_server:
            update_mode = "sync_app_to_server"
            update_action_label = i18n_t("native_ubuntu.update_web_btn", {"ver": app_disp})
            update_summary = i18n_t("native_ubuntu.summary_app_srv", {"app": app_disp, "srv": srv_disp})
        elif github_above_server:
            update_mode = "github_to_server"
            update_action_label = i18n_t("native_ubuntu.update_web_github_btn", {"ver": gh_disp})
            update_summary = i18n_t("native_ubuntu.summary_gh_srv", {"gh": gh_disp, "srv": srv_disp})
        elif app_above_github:
            update_mode = "app_ahead_of_github"
            update_action_label = (
                i18n_t("native_ubuntu.sync_local_web_btn", {"ver": app_disp})
                if server_reachable
                else i18n_t("native_ubuntu.version_uptodate", {"ver": app_disp})
            )
            if server_reachable:
                update_summary = i18n_t("native_ubuntu.summary_app_ahead_srv", {"app": app_disp, "gh": gh_disp})
            else:
                update_summary = i18n_t("native_ubuntu.summary_app_ahead", {"app": app_disp, "gh": gh_disp})
        elif gh_ver:
            update_mode = "up_to_date"
            update_action_label = i18n_t("native_ubuntu.update_reinstall_btn")
            if server_reachable:
                update_summary = i18n_t("native_ubuntu.summary_synced_all", {"gh": gh_disp})
            else:
                update_summary = i18n_t("native_ubuntu.summary_synced_pair", {"gh": gh_disp})
        else:
            update_mode = "offline_check"
            update_action_label = i18n_t("native_ubuntu.sync_retry_btn")
            update_summary = i18n_t("native_ubuntu.summary_offline")

        return {
            "local_version": app_ver,
            "local_display_version": app_disp,
            "app_version": app_ver,
            "app_display_version": app_disp,
            "installed_deb_version": installed_deb,
            "installed_display_version": get_display_version(installed_deb) if installed_deb else "",
            "app_installed_deb": bool(installed_deb) or os.path.isfile("/usr/bin/recursos-cockpit"),
            "server_version": server_ver,
            "server_display_version": srv_disp,
            "server_reachable": bool(server_reachable),
            "server_url": server_url,
            "github_version": gh_ver,
            "github_display_version": gh_disp,
            "deb_release_version": deb_release_ver,
            "update_available": github_above_app,
            "effective_update_available": effective_update_available,
            "app_above_server": app_above_server,
            "app_above_github": app_above_github,
            "github_above_server": github_above_server,
            "github_above_app": github_above_app,
            "server_needs_update": server_needs_update,
            "target_version": best_ver,
            "update_mode": update_mode,
            "update_action_label": update_action_label,
            "update_summary": update_summary,
            "deb_download_url": deb_url,
            "deb_asset_name": deb_asset_name,
            "sha256_url": sha_url,
            "release_url": release_url,
            "error": err_msg,
        }

    def fetch_github_native_releases(self, force_refresh=False):
        """Obtiene dinámicamente desde GitHub las últimas compilaciones nativas (.deb Ubuntu y .apk Android)."""
        now_ts = time.time()
        cached = getattr(self, "_native_releases_cache", None)
        if not force_refresh and isinstance(cached, dict) and (now_ts - float(cached.get("ts") or 0.0) < 60.0):
            return dict(cached["data"])

        local_ubuntu = get_app_version()
        installed_deb = self.get_installed_deb_version()
        if installed_deb and parse_semver_tuple(installed_deb) >= parse_semver_tuple(local_ubuntu):
            local_ubuntu = installed_deb
        local_android = get_android_client_version()
        server_ver = get_server_bundled_version()

        remote_ubuntu = local_ubuntu
        remote_android = local_android
        github_reachable = False
        tag_name = ""
        release_name = ""
        release_url = "https://github.com/cminewarIA/recursos-ui/releases"
        published_at = ""
        sha256_url = ""
        deb_asset = None
        apk_asset = None

        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": f"RecursosCockpit-Ubuntu/{local_ubuntu}",
        }

        for fname, key in (("UBUNTU_VERSION", "ubuntu"), ("ANDROID_VERSION", "android")):
            raw_u = f"https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/{fname}"
            if not is_allowed_github_url(raw_u):
                continue
            try:
                req = urllib.request.Request(raw_u, headers=headers)
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    val = resp.read().decode("utf-8").strip().lstrip("vV")
                    if re.match(r"^\d+\.\d+\.\d+$", val):
                        github_reachable = True
                        if key == "ubuntu":
                            remote_ubuntu = val
                        else:
                            remote_android = val
            except Exception:
                pass

        def _is_native_tag(tag_str, plat):
            low_t = str(tag_str or "").strip().lower()
            if not low_t:
                return False
            if plat == "ubuntu":
                return low_t.startswith("ubuntu-v") or low_t.startswith("native-")
            if plat == "android":
                return low_t.startswith("android-v") or low_t.startswith("native-")
            return low_t.startswith(("ubuntu-v", "android-v", "native-"))

        def _is_compat_native_ver(cand_ver, canonical_ver):
            c_t = parse_semver_tuple(cand_ver)
            r_t = parse_semver_tuple(canonical_ver)
            if c_t == (0, 0, 0):
                return False
            if 0 < r_t[0] < 10 and c_t[0] >= 10:
                return False
            return True

        releases_list = []
        try:
            rel_api = "https://api.github.com/repos/cminewarIA/recursos-ui/releases?per_page=15"
            if is_allowed_github_url(rel_api):
                req = urllib.request.Request(rel_api, headers=headers)
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    parsed = json.loads(resp.read().decode("utf-8"))
                    if isinstance(parsed, list):
                        releases_list = [r for r in parsed if isinstance(r, dict) and not r.get("draft")]
                        github_reachable = True
        except Exception:
            pass

        for rel in releases_list:
            r_tag = str(rel.get("tag_name") or "").strip()
            if not _is_native_tag(r_tag, "any"):
                continue
            r_name = str(rel.get("name") or r_tag).strip()
            r_html = str(rel.get("html_url") or "").strip()
            r_pub = str(rel.get("published_at") or "").strip()
            if not tag_name and r_tag:
                tag_name = r_tag
                release_name = r_name
                if is_allowed_github_url(r_html):
                    release_url = r_html
                published_at = r_pub

            for a in rel.get("assets", []) or []:
                if not isinstance(a, dict):
                    continue
                a_name = str(a.get("name") or "").strip()
                a_url = str(a.get("browser_download_url") or "").strip()
                if not a_name or not is_allowed_github_url(a_url):
                    continue
                a_size = int(a.get("size") or 0)
                a_pub = str(a.get("updated_at") or r_pub or "").strip()
                low = a_name.lower()
                m_ver = re.search(r"(\d+\.\d+\.\d+)", a_name)
                if low == "sha256sums.txt" and not sha256_url:
                    sha256_url = a_url
                elif low.endswith(".deb") and _is_native_tag(r_tag, "ubuntu"):
                    cand_ver = m_ver.group(1) if m_ver else remote_ubuntu
                    if not _is_compat_native_ver(cand_ver, remote_ubuntu):
                        continue
                    cand = {
                        "version": cand_ver,
                        "asset_name": a_name,
                        "download_url": a_url,
                        "size_bytes": a_size,
                        "published_at": a_pub,
                        "tag_name": r_tag,
                    }
                    if deb_asset is None or ("_" in a_name and "_" not in deb_asset["asset_name"]):
                        deb_asset = cand
                elif low.endswith(".apk") and _is_native_tag(r_tag, "android"):
                    cand_ver = m_ver.group(1) if m_ver else remote_android
                    if not _is_compat_native_ver(cand_ver, remote_android):
                        continue
                    cand = {
                        "version": cand_ver,
                        "asset_name": a_name,
                        "download_url": a_url,
                        "size_bytes": a_size,
                        "published_at": a_pub,
                        "tag_name": r_tag,
                    }
                    if apk_asset is None or ("_" in a_name and "_" not in apk_asset["asset_name"]):
                        apk_asset = cand
            if deb_asset and apk_asset:
                break

        deb_ver = (deb_asset or {}).get("version") or remote_ubuntu
        apk_ver = (apk_asset or {}).get("version") or remote_android
        payload = {
            "ok": True,
            "is_ubuntu_native": True,
            "downloads_dir": resolve_user_downloads_dir(),
            "repo": "cminewarIA/recursos-ui",
            "repo_url": "https://github.com/cminewarIA/recursos-ui",
            "server_version": server_ver,
            "local_ubuntu_version": local_ubuntu,
            "local_android_version": local_android,
            "github_reachable": github_reachable,
            "tag_name": tag_name,
            "release_name": release_name or (f"Release {tag_name}" if tag_name else ""),
            "release_url": release_url,
            "published_at": published_at,
            "sha256_url": sha256_url,
            "deb": {
                "version": deb_ver,
                "local_version": local_ubuntu,
                "asset_name": (deb_asset or {}).get("asset_name") or f"recursos-cockpit_{deb_ver}_amd64.deb",
                "download_url": (deb_asset or {}).get("download_url") or f"https://github.com/cminewarIA/recursos-ui/releases/tag/ubuntu-v{deb_ver}",
                "size_bytes": int((deb_asset or {}).get("size_bytes") or 0),
                "published_at": (deb_asset or {}).get("published_at") or published_at,
                "tag_name": (deb_asset or {}).get("tag_name") or f"ubuntu-v{deb_ver}",
                "available": bool(deb_asset),
                "update_available": bool(deb_asset) and (parse_semver_tuple(deb_ver) > parse_semver_tuple(local_ubuntu)),
            },
            "apk": {
                "version": apk_ver,
                "local_version": local_android,
                "asset_name": (apk_asset or {}).get("asset_name") or f"recursos-cockpit_{apk_ver}.apk",
                "download_url": (apk_asset or {}).get("download_url") or f"https://github.com/cminewarIA/recursos-ui/releases/tag/android-v{apk_ver}",
                "size_bytes": int((apk_asset or {}).get("size_bytes") or 0),
                "published_at": (apk_asset or {}).get("published_at") or published_at,
                "tag_name": (apk_asset or {}).get("tag_name") or f"android-v{apk_ver}",
                "available": bool(apk_asset),
                "update_available": bool(apk_asset) and (parse_semver_tuple(apk_ver) > parse_semver_tuple(local_android)),
            },
            "checked_at": time.strftime("%H:%M:%S"),
        }
        self._native_releases_cache = {"ts": now_ts, "data": dict(payload)}
        return payload

    def download_apk_to_downloads(self, releases_info=None):
        """Descarga la última APK desde GitHub y la guarda de forma segura en la carpeta Descargas del usuario."""
        rel = releases_info if isinstance(releases_info, dict) else self.fetch_github_native_releases(force_refresh=True)
        apk_meta = rel.get("apk") if isinstance(rel.get("apk"), dict) else {}
        apk_url = str(apk_meta.get("download_url") or "").strip()
        if not is_allowed_github_url(apk_url):
            return False, "URL de descarga APK no permitida por la política HTTPS de GitHub.", ""

        raw_name = os.path.basename(str(apk_meta.get("asset_name") or "recursos-cockpit.apk"))
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)
        if not safe_name.lower().endswith(".apk"):
            safe_name = f"{safe_name}.apk"

        downloads_dir = resolve_user_downloads_dir()
        dest_path = os.path.abspath(os.path.join(downloads_dir, safe_name))
        if not dest_path.startswith(os.path.abspath(downloads_dir) + os.sep):
            return False, "Ruta de destino inválida fuera de Descargas.", ""

        try:
            req = urllib.request.Request(
                apk_url,
                headers={"User-Agent": f"RecursosCockpit-Ubuntu/{get_app_version()}"},
            )
            with urllib.request.urlopen(req, timeout=45.0) as resp:
                apk_bytes = resp.read()
            if len(apk_bytes) < 50000 or not apk_bytes.startswith(b"PK\x03\x04"):
                return False, "El archivo descargado desde GitHub no es un paquete APK válido.", ""

            sha_url = str(rel.get("sha256_url") or "").strip()
            if sha_url and is_allowed_github_url(sha_url):
                try:
                    req_sha = urllib.request.Request(
                        sha_url,
                        headers={"User-Agent": f"RecursosCockpit-Ubuntu/{get_app_version()}"},
                    )
                    with urllib.request.urlopen(req_sha, timeout=10.0) as rsha:
                        sums_txt = rsha.read().decode("utf-8", errors="ignore")
                    expected = ""
                    for line in sums_txt.splitlines():
                        parts = line.strip().split()
                        if len(parts) >= 2 and (parts[1].lstrip("*") == safe_name or parts[1].endswith(".apk")):
                            expected = parts[0].lower()
                            break
                    if expected:
                        actual = hashlib.sha256(apk_bytes).hexdigest().lower()
                        if actual != expected:
                            return False, "Error de verificación SHA-256 al descargar la APK desde GitHub.", ""
                except Exception:
                    pass

            tmp_path = f"{dest_path}.part"
            with open(tmp_path, "wb") as fh:
                fh.write(apk_bytes)
            os.replace(tmp_path, dest_path)
            return True, f"APK guardada correctamente en {dest_path}", dest_path
        except Exception as exc:
            return False, f"No se pudo descargar la APK desde GitHub: {exc}", ""

    def check_github_app_update(self, target_url=None, probe_server=True, server_payload=None, refresh_server=False):
        """Consulta App Ubuntu (UBUNTU_VERSION), Servidor web local (VERSION) y GitHub Releases de forma desacoplada."""
        local_ver = get_app_version()
        installed_deb = self.get_installed_deb_version()
        if installed_deb and parse_semver_tuple(installed_deb) >= parse_semver_tuple(local_ver):
            app_ver = installed_deb
        else:
            app_ver = local_ver

        rel_meta = self.fetch_github_native_releases(force_refresh=bool(refresh_server))
        deb_meta = rel_meta.get("deb") if isinstance(rel_meta.get("deb"), dict) else {}
        deb_release_ver = str(deb_meta.get("version") or local_ver).strip().lstrip("vV")
        deb_url = str(deb_meta.get("download_url") or "https://github.com/cminewarIA/recursos-ui/releases/latest/download/recursos-cockpit.deb")
        deb_asset_name = str(deb_meta.get("asset_name") or "recursos-cockpit.deb")
        sha_url = str(rel_meta.get("sha256_url") or "")
        release_url = str(rel_meta.get("release_url") or "https://github.com/cminewarIA/recursos-ui/releases")
        err_msg = "" if rel_meta.get("github_reachable") else "Sin conexión con GitHub"

        gh_ver = deb_release_ver

        srv_ver = ""
        srv_reachable = False
        srv_url = str(target_url or self.active_url or "").strip().rstrip("/")
        if isinstance(server_payload, dict) and (server_payload.get("server_version") or server_payload.get("version") or server_payload.get("current_version")):
            srv_ver = str(
                server_payload.get("server_version")
                or server_payload.get("current_version")
                or server_payload.get("version")
                or ""
            ).strip().lstrip("vV")
            srv_reachable = bool(srv_ver)
            if not srv_url:
                srv_url = self._resolve_target_server_url(target_url)
        elif probe_server:
            srv_payload, srv_reachable, srv_url = self.probe_server_version_info(
                target_url=target_url,
                refresh=refresh_server,
            )
            if srv_reachable and isinstance(srv_payload, dict):
                srv_ver = str(
                    srv_payload.get("server_version")
                    or srv_payload.get("current_version")
                    or srv_payload.get("version")
                    or ""
                ).strip().lstrip("vV")

        info = self._compute_version_comparison(
            app_ver=app_ver,
            gh_ver=gh_ver,
            server_ver=srv_ver,
            server_reachable=srv_reachable,
            server_url=srv_url,
            installed_deb=installed_deb,
            deb_url=deb_url,
            deb_asset_name=deb_asset_name,
            sha_url=sha_url,
            release_url=release_url,
            err_msg=err_msg,
            deb_release_ver=deb_release_ver,
        )
        info["native_releases"] = rel_meta
        self.github_update_info = info
        return info

    def _install_deb_from_github(self, info, relaunch_on_deb=True, interactive=True):
        """Descarga, verifica SHA-256 e instala el paquete .deb oficial desde GitHub Releases sin interpolación shell."""
        deb_url = str(
            info.get("deb_download_url")
            or (info.get("deb") or {}).get("download_url")
            or "https://github.com/cminewarIA/recursos-ui/releases/latest/download/recursos-cockpit.deb"
        ).strip()
        if not is_allowed_github_url(deb_url):
            return False, "URL de descarga DEB no permitida por la política HTTPS de GitHub.", ""

        tmp_deb = os.path.join("/tmp", f"recursos-cockpit-github-update-{os.getpid()}.deb")
        try:
            req = urllib.request.Request(
                deb_url,
                headers={"User-Agent": f"RecursosCockpit-Updater/{get_app_version()}"},
            )
            with urllib.request.urlopen(req, timeout=40.0) as resp:
                deb_bytes = resp.read()
            if len(deb_bytes) < 10240 or not deb_bytes.startswith(b"!<arch>\n"):
                return False, "El archivo descargado desde GitHub no es un paquete .deb válido.", ""
            with open(tmp_deb, "wb") as f:
                f.write(deb_bytes)

            sha_url = str(info.get("sha256_url") or "").strip()
            if sha_url and is_allowed_github_url(sha_url):
                try:
                    req_sha = urllib.request.Request(
                        sha_url,
                        headers={"User-Agent": f"RecursosCockpit-Updater/{get_app_version()}"},
                    )
                    with urllib.request.urlopen(req_sha, timeout=10.0) as rsha:
                        sums_txt = rsha.read().decode("utf-8", errors="ignore")
                    expected = ""
                    target_name = info.get("deb_asset_name") or (info.get("deb") or {}).get("asset_name") or "recursos-cockpit.deb"
                    for line in sums_txt.splitlines():
                        parts = line.strip().split()
                        if len(parts) >= 2 and (parts[1].lstrip("*") == target_name or parts[1].endswith(".deb")):
                            expected = parts[0].lower()
                            break
                    if expected:
                        actual = hashlib.sha256(deb_bytes).hexdigest().lower()
                        if actual != expected:
                            return False, i18n_t("native_ubuntu.sha_error"), ""
                except Exception:
                    pass

            check_p = subprocess.run(["dpkg-deb", "--info", tmp_deb], capture_output=True, text=True, timeout=5)
            if check_p.returncode != 0:
                return False, i18n_t("native_ubuntu.deb_corrupt"), ""

            root_info = detect_ubuntu_root_status()
            dpkg_argv = ["dpkg", "-i", "--force-overwrite", tmp_deb]
            if root_info.get("root_method") == "uid0":
                cmd = dpkg_argv
            elif root_info.get("root_method") == "sudo":
                cmd = ["sudo", "-n"] + dpkg_argv
            elif interactive:
                has_pkexec = subprocess.run(["which", "pkexec"], capture_output=True).returncode == 0
                cmd = (["pkexec"] if has_pkexec else ["sudo"]) + dpkg_argv
            else:
                cmd = ["sudo", "-n"] + dpkg_argv

            inst = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            try:
                if os.path.exists(tmp_deb):
                    os.remove(tmp_deb)
            except Exception:
                pass
            if inst.returncode == 0:
                self._auto_perm_cooldown_until = 0.0
                new_ver = self.get_installed_deb_version() or info.get("deb_release_version") or (info.get("deb") or {}).get("version") or get_app_version()
                return True, i18n_t("native_ubuntu.deb_updated_part", {"ver": get_display_version(new_ver)}), new_ver
            err_detail = (inst.stderr or inst.stdout or "").strip()
            if not interactive:
                self._auto_perm_cooldown_until = time.time() + 900.0
            return False, i18n_t("native_ubuntu.deb_install_fail", {"err": err_detail[:180] or "permisos requeridos"}), ""
        except Exception as e:
            try:
                if os.path.exists(tmp_deb):
                    os.remove(tmp_deb)
            except Exception:
                pass
            return False, i18n_t("native_ubuntu.download_error", {"error": e}), ""

    def perform_unified_update(self, gh_info=None, target_url=None, relaunch_on_deb=True, interactive=True, force_download=False):
        """
        Actualización unificada en un solo botón:
        - En modo manual (`force_download=True`), descarga siempre todos los datos desde GitHub
          (paquete `.deb` oficial, actualización completa del servidor `/api/system/update` con `force=true`,
          diccionario multi-idioma y repositorio git local si existe) aunque no se detecten novedades.
        - En modo automático en segundo plano (`force_download=False`), solo actúa cuando existe versión superior.
        """
        if not self._update_exec_lock.acquire(blocking=False):
            cur_info = self.github_update_info or self.check_github_app_update(target_url=target_url, refresh_server=False)
            return True, i18n_t("more.auto_in_progress"), cur_info, {
                "already_running": True,
                "deb_installed": False,
                "web_synced": False,
                "output": i18n_t("more.auto_in_progress"),
            }

        self.auto_install_in_progress = True
        try:
            if interactive:
                self._auto_perm_cooldown_until = 0.0

            info = gh_info or self.check_github_app_update(target_url=target_url, refresh_server=True)
            st = self.detect_local_node_status()
            srv_url = info.get("server_url") or self._resolve_target_server_url(target_url)

            logs = []
            updated_parts = []
            deb_installed = False
            web_synced = False

            app_ver = info.get("app_version") or get_app_version()
            gh_ver = info.get("github_version") or ""
            deb_rel_ver = info.get("deb_release_version") or gh_ver
            srv_ver = info.get("server_version") or ""
            github_above_app = bool(info.get("github_above_app"))
            app_above_github = bool(info.get("app_above_github"))
            app_above_server = bool(info.get("app_above_server"))
            github_above_server = bool(info.get("github_above_server"))
            server_reachable = bool(info.get("server_reachable") or srv_url)

            logs.append(
                f"[i] Estado de versiones -> App Ubuntu: v{app_ver} · Servidor web: "
                f"{('v' + srv_ver) if srv_ver else 'no detectado'} · GitHub: {('v' + gh_ver) if gh_ver else 'sin acceso'}"
                + (f" (Release .deb: v{deb_rel_ver})" if deb_rel_ver and deb_rel_ver != gh_ver else "")
                + (" · [Modo descarga completa forzada]" if force_download else "")
            )

            # Paso 0: En descarga forzada, refrescar siempre también el diccionario multi-idioma desde GitHub
            if force_download:
                try:
                    _catalog_sync_github(force=True, timeout=8.0)
                    logs.append("[✓] Diccionario multi-idioma descargado desde GitHub.")
                except Exception as e_dict:
                    logs.append(f"[!] Aviso descargando diccionario desde GitHub: {e_dict}")

            # Paso 1: Descargar e instalar .deb oficial desde GitHub (si supera a la App o en descarga forzada)
            if github_above_app or (force_download and deb_rel_ver):
                if force_download and not github_above_app:
                    logs.append(f"[+] Descarga completa forzada: reinstalando paquete .deb oficial v{deb_rel_ver} desde GitHub...")
                else:
                    logs.append(f"[+] GitHub Release (v{deb_rel_ver}) es superior a la App Ubuntu (v{app_ver}). Instalando paquete .deb...")
                deb_ok, deb_msg, installed_new_ver = self._install_deb_from_github(
                    info,
                    relaunch_on_deb=relaunch_on_deb,
                    interactive=interactive,
                )
                if not deb_ok:
                    logs.append(f"[-] {deb_msg}")
                    self.auto_install_status = deb_msg
                    if not (force_download and server_reachable):
                        return False, deb_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
                else:
                    deb_installed = True
                    updated_parts.append(deb_msg)
                    logs.append(f"[✓] {deb_msg} instalada correctamente.")
                    app_ver = installed_new_ver or get_app_version()
                    if server_reachable and srv_ver:
                        app_above_server = parse_semver_tuple(app_ver) > parse_semver_tuple(srv_ver)
                    app_above_github = bool(gh_ver and parse_semver_tuple(app_ver) > parse_semver_tuple(gh_ver))
                    github_above_server = bool(server_reachable and srv_ver and gh_ver and parse_semver_tuple(gh_ver) > parse_semver_tuple(srv_ver))

            # Paso 2: Actualizar el servidor web local (descarga forzada directa desde GitHub o sincronización)
            if server_reachable and (force_download or app_above_server or github_above_server):
                app_covers_github = bool(not gh_ver or parse_semver_tuple(app_ver) >= parse_semver_tuple(gh_ver))
                if force_download or (github_above_server and not (app_above_server and app_covers_github)):
                    logs.append(
                        f"[+] Solicitando al servidor ({srv_url}) descarga completa directa desde GitHub"
                        + (f" (v{gh_ver})..." if gh_ver else "...")
                    )
                    srv_upd_err = ""
                    try:
                        req_srv = urllib.request.Request(
                            f"{srv_url.rstrip('/')}/api/system/update",
                            data=json.dumps({"force": bool(force_download)}).encode("utf-8"),
                            headers=self._build_auth_headers({"Content-Type": "application/json"}),
                            method="POST",
                        )
                        with urllib.request.urlopen(req_srv, timeout=60.0) as r_srv:
                            r_obj = json.loads(r_srv.read().decode("utf-8"))
                            if r_obj.get("output"):
                                logs.append(str(r_obj.get("output")))
                            if r_obj.get("success"):
                                web_synced = True
                                updated_parts.append(i18n_t("native_ubuntu.srv_github_part"))
                                logs.append(f"[✓] Servidor actualizado desde GitHub: {r_obj.get('message', 'OK')}")
                            else:
                                srv_upd_err = str(r_obj.get("message") or r_obj.get("error") or "Error al actualizar servidor")
                    except Exception as e_srv:
                        srv_upd_err = str(e_srv)
                        logs.append(f"[-] Actualización remota /api/system/update falló: {e_srv}")
                    if not web_synced and not deb_installed:
                        return False, srv_upd_err or "Error actualizando servidor desde GitHub", info, {
                            "deb_installed": False,
                            "web_synced": False,
                            "output": "\n".join(logs),
                        }
                elif app_above_server and app_covers_github:
                    if app_above_github:
                        logs.append(
                            f"[+] App Ubuntu (v{app_ver}) supera a GitHub (v{gh_ver}) y al servidor local (v{srv_ver}). Sincronizando web local..."
                        )
                    else:
                        logs.append(
                            f"[+] Sincronizando web local del servidor ({srv_url}) a v{app_ver}..."
                        )
                    sync_ok, sync_msg, _sync_res = self.sync_web_bundle_to_server(
                        target_url=srv_url,
                        version_override=app_ver,
                    )
                    if sync_ok:
                        web_synced = True
                        updated_parts.append(i18n_t("native_ubuntu.web_updated_part", {"ver": get_display_version(app_ver)}))
                        logs.append(f"[✓] {sync_msg}")
                    else:
                        logs.append(f"[!] Aviso en sincronización directa (/api/system/sync-web): {sync_msg}")
                        if not deb_installed:
                            return False, sync_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}

            # Paso 3: Sincronizar fuentes git locales desde GitHub si existen
            repo_dir = st.get("repo_dir")
            if repo_dir and os.path.isdir(os.path.join(repo_dir, ".git")) and (force_download or (github_above_app and not app_above_github)):
                try:
                    status_p = subprocess.run(
                        ["git", "-C", repo_dir, "status", "--porcelain"],
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                    if bool(status_p.stdout.strip()):
                        subprocess.run(
                            ["git", "-C", repo_dir, "stash", "push", "-u", "-m", "recursos-auto-update"],
                            capture_output=True,
                            timeout=10,
                        )
                    subprocess.run(
                        ["git", "-C", repo_dir, "fetch", "--force", "--prune", "origin", "main"],
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    if force_download:
                        subprocess.run(
                            ["git", "-C", repo_dir, "reset", "--hard", "origin/main"],
                            capture_output=True,
                            text=True,
                            timeout=20,
                        )
                    else:
                        pull_p = subprocess.run(
                            ["git", "-C", repo_dir, "pull", "--rebase", "origin", "main"],
                            capture_output=True,
                            text=True,
                            timeout=45,
                        )
                        if pull_p.returncode != 0:
                            subprocess.run(
                                ["git", "-C", repo_dir, "pull", "origin", "main"],
                                capture_output=True,
                                text=True,
                                timeout=45,
                            )
                    if st.get("service_exists"):
                        runner = "pkexec" if subprocess.run(["which", "pkexec"], capture_output=True).returncode == 0 else "sudo"
                        subprocess.run([runner, "systemctl", "restart", "system-dashboard.service"], capture_output=True, timeout=20)
                    logs.append("[✓] Repositorio local sincronizado desde GitHub.")
                except Exception as ge:
                    logs.append(f"[!] Aviso al actualizar repositorio git local: {ge}")

            # Si todo estaba igualado o la app supera GitHub y el usuario solicita sincronizar web local
            if not updated_parts:
                if app_above_github:
                    if server_reachable:
                        sync_ok, sync_msg, _ = self.sync_web_bundle_to_server(
                            target_url=srv_url,
                            force=True,
                            version_override=app_ver,
                        )
                        if sync_ok:
                            web_synced = True
                            updated_parts.append(i18n_t("native_ubuntu.web_updated_part", {"ver": get_display_version(app_ver)}))
                            logs.append(f"[✓] {sync_msg}")
                        else:
                            return False, sync_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
                    else:
                        msg = i18n_t(
                            "native_ubuntu.app_ahead_connect_srv",
                            {"app": get_display_version(app_ver), "gh": get_display_version(gh_ver)},
                        )
                        logs.append(f"[i] {msg}")
                        new_info = self.check_github_app_update(target_url=srv_url, refresh_server=True)
                        return True, msg, new_info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}

                if gh_ver and parse_semver_tuple(gh_ver) == parse_semver_tuple(app_ver) and server_reachable:
                    # Re-sincronización limpia explícita cuando el usuario pulsa el botón estando al día
                    sync_ok, sync_msg, _ = self.sync_web_bundle_to_server(target_url=srv_url, force=True, version_override=app_ver)
                    if sync_ok:
                        web_synced = True
                        updated_parts.append(i18n_t("native_ubuntu.web_updated_part", {"ver": get_display_version(app_ver)}))
                        logs.append(f"[✓] {sync_msg}")
                    else:
                        msg = i18n_t("native_ubuntu.ecosystem_uptodate", {"ver": get_display_version(app_ver)})
                        logs.append(f"[✓] {msg}")
                        new_info = self.check_github_app_update(target_url=srv_url, refresh_server=True)
                        return True, msg, new_info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
                elif deb_rel_ver and interactive:
                    deb_ok, deb_msg, _ = self._install_deb_from_github(info, relaunch_on_deb=relaunch_on_deb, interactive=True)
                    if deb_ok:
                        deb_installed = True
                        updated_parts.append(deb_msg)
                        logs.append(f"[✓] {deb_msg} reinstalada correctamente.")
                    else:
                        return False, deb_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
                else:
                    msg = i18n_t("native_ubuntu.app_offline_uptodate", {"ver": get_display_version(app_ver)})
                    logs.append(f"[i] {msg}")
                    return True, msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}

            new_info = self.check_github_app_update(target_url=srv_url, refresh_server=True)
            now_str = datetime.now().strftime("%H:%M:%S")
            self.last_auto_install = now_str
            final_msg = i18n_t("native_ubuntu.update_done", {"parts": ", ".join(updated_parts)})
            self.auto_install_status = f"{final_msg} ({now_str})"
            return True, final_msg, new_info, {
                "deb_installed": deb_installed,
                "web_synced": web_synced,
                "output": "\n".join(logs),
            }
        finally:
            self.auto_install_in_progress = False
            self._update_exec_lock.release()

    def run_auto_update_cycle(self, on_deb_installed_cb=None):
        """Comprueba y aplica en segundo plano actualizaciones no intrusivas cuando auto_install_enabled=True."""
        if not self.auto_install_enabled:
            self.auto_install_status = i18n_t("more.auto_paused_status")
            return False
        info = self.check_github_app_update(probe_server=True, refresh_server=False)
        if info.get("github_above_app") and time.time() >= self._auto_perm_cooldown_until:
            ok, msg, _new_info, flags = self.perform_unified_update(
                gh_info=info,
                relaunch_on_deb=False,
                interactive=False,
            )
            if ok and flags.get("deb_installed"):
                if on_deb_installed_cb:
                    on_deb_installed_cb()
                return True
            if not ok:
                self.auto_install_status = i18n_t(
                    "native_ubuntu.auto_perm_pending",
                    {"ver": info.get("github_display_version") or info.get("target_version") or ""},
                )
            return ok
        if info.get("server_reachable") and info.get("app_above_server") and not info.get("github_above_app"):
            ok, _msg, _new_info, flags = self.perform_unified_update(
                gh_info=info,
                relaunch_on_deb=False,
                interactive=False,
            )
            if ok and flags.get("web_synced"):
                self.auto_install_status = i18n_t(
                    "native_ubuntu.auto_synced_web",
                    {"ver": info.get("app_display_version") or get_display_version()},
                )
            return ok
        if not self.auto_install_status or self.auto_install_status == i18n_t("more.auto_paused_status"):
            self.auto_install_status = i18n_t("more.auto_enabled_status")
        return False

    def start_auto_update_watcher(self, on_deb_installed_cb=None):
        """Inicia el hilo demonio de vigilancia automática en la App Nativa de Ubuntu."""
        if getattr(self, "_auto_watcher_started", False):
            return
        self._auto_watcher_started = True

        def _watcher():
            time.sleep(10.0)
            while True:
                try:
                    if self.auto_install_enabled:
                        self.run_auto_update_cycle(on_deb_installed_cb=on_deb_installed_cb)
                except Exception:
                    pass
                time.sleep(120.0)

        threading.Thread(target=_watcher, daemon=True, name="UbuntuAutoUpdater").start()

    def update_installed_app_from_github(self, gh_info=None):
        """Envoltorio compatible para el lanzador GTK: ejecuta la descarga completa desde GitHub de App y Web local."""
        ok, msg, info, _flags = self.perform_unified_update(gh_info=gh_info, relaunch_on_deb=True, interactive=True, force_download=True)
        return ok, msg, info

    def install_or_enable_local_node(self):
        """Instala y arranca el nodo local como servicio si no existe, o devuelve sus datos LAN si ya está instalado."""
        status = self.detect_local_node_status()
        if status["installed"] and status["running"]:
            return True, f"El nodo local ya está instalado y activo en {status['lan_url']}", status
        server_py = status.get("server_py_path")
        if not server_py:
            return False, "No se encontró el archivo server.py para instalar el nodo local en este equipo.", status
        work_dir = os.path.dirname(server_py)
        unit_content = (
            "[Unit]\n"
            "Description=Recursos Cockpit Telemetry Node\n"
            "After=network-online.target\n"
            "Wants=network-online.target\n\n"
            "[Service]\n"
            "Type=simple\n"
            f"WorkingDirectory={work_dir}\n"
            f"ExecStart={sys.executable} {server_py}\n"
            "Restart=always\n"
            "RestartSec=3\n\n"
            "[Install]\n"
            "WantedBy=multi-user.target\n"
        )
        try:
            tmp_unit = os.path.join(self.config_dir, "system-dashboard.service")
            os.makedirs(self.config_dir, exist_ok=True)
            with open(tmp_unit, "w", encoding="utf-8") as f:
                f.write(unit_content)
            install_cmd = (
                f"cp {tmp_unit} /etc/systemd/system/system-dashboard.service && "
                "systemctl daemon-reload && systemctl enable --now system-dashboard.service"
            )
            runner = "pkexec" if subprocess.run(["which", "pkexec"], capture_output=True).returncode == 0 else "sudo"
            res = subprocess.run([runner, "sh", "-c", install_cmd], capture_output=True, text=True, timeout=45)
            if res.returncode == 0:
                time.sleep(1.0)
                new_status = self.detect_local_node_status()
                return True, f"Nodo local instalado y activo en {new_status['lan_url']}", new_status
        except Exception as e:
            return False, f"No se pudo completar la instalación automática: {e}", status

        # Fallback en espacio de usuario si no se concedieron privilegios de servicio
        try:
            subprocess.Popen(
                [sys.executable, server_py],
                cwd=work_dir,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            time.sleep(1.2)
            new_status = self.detect_local_node_status()
            if new_status["running"]:
                return True, f"Nodo local iniciado en {new_status['lan_url']}", new_status
        except Exception:
            pass
        return False, "Instalación cancelada o sin permisos suficientes.", status

    def clear_saved_node(self):
        self.saved_host = ""
        self.wan_domain = ""
        self.device_token = ""
        self.is_revoked = False
        self.active_url = ""
        self.connection_mode = "DISCONNECTED"
        self._save_config()

    def register_device_with_server(self, base_url=None):
        target_base = base_url or self.active_url
        if not target_base or self.is_revoked:
            return False
        try:
            telemetry = self.refresh_device_telemetry()
            url = f"{target_base.rstrip('/')}/api/auth/register-device"
            raw = json.dumps({"device_telemetry": telemetry}, ensure_ascii=False).encode("utf-8")
            headers = self._build_auth_headers({"Content-Type": "application/json"})
            req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    cfg_changed = False
                    new_tok = str(data.get("token") or "").strip()
                    if new_tok and new_tok != self.device_token:
                        self.device_token = new_tok
                        cfg_changed = True
                    if self.is_revoked:
                        self.is_revoked = False
                        cfg_changed = True
                    if cfg_changed:
                        self._save_config()
                    return True
        except urllib.error.HTTPError as he:
            if he.code == 403:
                self.is_revoked = True
                self.connection_mode = "REVOKED"
                self._save_config()
        except Exception:
            pass
        return False

    def _probe(self, base_url, timeout=0.6):
        try:
            url = f"{base_url.rstrip('/')}/api/version"
            headers = self._build_auth_headers()
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    body = resp.read().decode("utf-8")
                    try:
                        parsed = json.loads(body)
                        pub_dom = str(parsed.get("public_domain") or "").strip()
                        if _is_valid_wan_domain(pub_dom) and pub_dom != self.wan_domain:
                            self.wan_domain = pub_dom
                            self._save_config()
                    except Exception:
                        pass
                    return ("Recursos" in body or "version" in body or "current_version" in body), False
        except urllib.error.HTTPError as he:
            if he.code == 403:
                return True, True
        except Exception:
            pass
        return False, False

    def _get_local_subnet_base(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.2)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            parts = local_ip.split(".")
            if len(parts) == 4 and (
                local_ip.startswith("192.168.")
                or local_ip.startswith("10.")
                or local_ip.startswith("172.")
            ):
                return f"{parts[0]}.{parts[1]}.{parts[2]}"
        except Exception:
            pass
        return None

    def discover_server(self):
        with self.lock:
            port = self.node_port or 8085
            if self.saved_host:
                cand = f"http://{self.saved_host}:{port}"
                ok, is_rev = self._probe(cand, timeout=0.8)
                if is_rev:
                    self.is_revoked = True
                    self.connection_mode = "REVOKED"
                    self._save_config()
                    return cand
                if ok:
                    self.active_url = cand
                    self.connection_mode = "LAN"
                    self.is_revoked = False
                    self._save_config()
                    return cand

            for cand in [f"http://127.0.0.1:{port}", f"http://localhost:{port}"]:
                ok, is_rev = self._probe(cand, timeout=0.4)
                if is_rev:
                    self.is_revoked = True
                    self.connection_mode = "REVOKED"
                    self._save_config()
                    return cand
                if ok:
                    self.active_url = cand
                    self.connection_mode = "LAN"
                    self.saved_host = "127.0.0.1"
                    self.is_revoked = False
                    self._save_config()
                    return cand

            subnet = self._get_local_subnet_base()
            if subnet:
                cands = [f"http://{subnet}.{last}:{port}" for last in (2, 1, 10, 50, 100, 150, 200)]
                cands.append(f"http://recursos.local:{port}")
                for cand in cands:
                    ok, is_rev = self._probe(cand, timeout=0.35)
                    if is_rev:
                        self.is_revoked = True
                        self.connection_mode = "REVOKED"
                        self._save_config()
                        return cand
                    if ok:
                        self.active_url = cand
                        self.connection_mode = "LAN"
                        self.saved_host = cand.split("//")[1].split(":")[0]
                        self.is_revoked = False
                        self._save_config()
                        return cand

            wan_dom = (self.wan_domain or "").strip().rstrip("/")
            if wan_dom and _is_valid_wan_domain(wan_dom):
                wan_cand = wan_dom if wan_dom.startswith(("http://", "https://")) else f"https://{wan_dom}"
                ok, is_rev = self._probe(wan_cand, timeout=3.5)
                if is_rev:
                    self.is_revoked = True
                    self.connection_mode = "REVOKED"
                    self._save_config()
                    return wan_cand
                if ok:
                    self.active_url = wan_cand
                    self.connection_mode = "WAN"
                    self.is_revoked = False
                    self._save_config()
                    return wan_cand

            self.connection_mode = "LOCAL"
            return ""

    def fetch_metrics(self):
        if self.is_revoked:
            self.connection_mode = "REVOKED"
            return None

        if not self.active_url:
            self.discover_server()

        if not self.active_url:
            self.connection_mode = "LOCAL"
            return self.build_local_fallback_metrics()

        url = f"{self.active_url.rstrip('/')}/api/metrics"
        headers = self._build_auth_headers()

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    cfg_changed = False
                    new_token = str(data.get("auth_status", {}).get("token") or "").strip()
                    if new_token and new_token != self.device_token:
                        self.device_token = new_token
                        self.is_revoked = False
                        cfg_changed = True
                    pub_dom = str(
                        data.get("version_info", {}).get("public_domain")
                        or data.get("system", {}).get("public_domain")
                        or ""
                    ).strip()
                    if pub_dom and pub_dom != self.wan_domain and _is_valid_wan_domain(pub_dom):
                        self.wan_domain = pub_dom
                        cfg_changed = True
                    if cfg_changed:
                        self._save_config()

                    with self.lock:
                        self.latest_metrics = data
                    return data
        except urllib.error.HTTPError as he:
            if he.code == 403:
                self.is_revoked = True
                self.connection_mode = "REVOKED"
                self._save_config()
                return None
        except Exception:
            self.active_url = ""
        return self.build_local_fallback_metrics()

    def build_local_fallback_metrics(self):
        """Genera telemetría dinámica desde el silicio local usando psutil cuando no hay nodo externo."""
        ver = get_app_version()
        hostname = socket.gethostname()
        kernel = platform.release()
        cpu_pct = psutil.cpu_percent(interval=None) if psutil else 0.0
        per_cpu = psutil.cpu_percent(interval=None, percpu=True) if psutil else [0.0]
        phys_cores = (psutil.cpu_count(logical=False) or 1) if psutil else 1
        log_cores = (psutil.cpu_count(logical=True) or 1) if psutil else 1

        vm = psutil.virtual_memory() if psutil else None
        sm = psutil.swap_memory() if psutil else None

        disks_list = []
        if psutil:
            try:
                for part in psutil.disk_partitions(all=False):
                    try:
                        du = psutil.disk_usage(part.mountpoint)
                        disks_list.append(
                            {
                                "device": part.device,
                                "mountpoint": part.mountpoint,
                                "fstype": part.fstype,
                                "total_bytes": du.total,
                                "used_bytes": du.used,
                                "free_bytes": du.free,
                                "percent": du.percent,
                            }
                        )
                    except Exception:
                        continue
            except Exception:
                pass

        rx_s = 0.0
        tx_s = 0.0
        rx_tot = 0
        tx_tot = 0
        if psutil:
            try:
                now = time.time()
                net_io = psutil.net_io_counters()
                rx_tot = net_io.bytes_recv
                tx_tot = net_io.bytes_sent
                if self._last_net_io and now > self._last_net_ts:
                    dt = now - self._last_net_ts
                    rx_s = max(0.0, (net_io.bytes_recv - self._last_net_io.bytes_recv) / dt)
                    tx_s = max(0.0, (net_io.bytes_sent - self._last_net_io.bytes_sent) / dt)
                self._last_net_io = net_io
                self._last_net_ts = now
            except Exception:
                pass

        procs = []
        if psutil:
            try:
                for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_info"]):
                    try:
                        info = p.info
                        mem_mb = (
                            round(info["memory_info"].rss / (1024 * 1024), 1)
                            if info.get("memory_info")
                            else 0.0
                        )
                        procs.append(
                            {
                                "pid": int(info["pid"] or 0),
                                "name": str(info["name"] or "proceso"),
                                "user": str(info["username"] or "root"),
                                "cpu_percent": round(float(info["cpu_percent"] or 0.0), 1),
                                "priv_mb": mem_mb,
                                "mem_mb": mem_mb,
                            }
                        )
                    except Exception:
                        continue
                procs.sort(key=lambda x: (x["cpu_percent"], x["priv_mb"]), reverse=True)
            except Exception:
                pass

        return {
            "version": ver,
            "system": {
                "hostname": hostname,
                "kernel": kernel,
                "os_name": f"{platform.system()} {platform.release()}",
                "uptime_str": "Sesión Nativa Local",
            },
            "cpu": {
                "usage_percent": cpu_pct,
                "per_core": per_cpu,
                "physical_cores": phys_cores,
                "logical_cores": log_cores,
            },
            "ram": {
                "total_bytes": vm.total if vm else 0,
                "used_bytes": (vm.total - vm.available) if vm else 0,
                "available_bytes": vm.available if vm else 0,
                "percent": vm.percent if vm else 0.0,
                "swap_total_bytes": sm.total if sm else 0,
                "swap_used_bytes": sm.used if sm else 0,
                "swap_percent": sm.percent if sm else 0.0,
            },
            "disks": disks_list,
            "net": {
                "rx_bytes_sec": rx_s,
                "tx_bytes_sec": tx_s,
                "rx_total_bytes": rx_tot,
                "tx_total_bytes": tx_tot,
                "interfaces_list": [],
                "connections_map": {"server_node": {"ip": "127.0.0.1"}, "connections": []},
            },
            "system_processes": procs[:45],
            "docker_activities": [],
            "security": {"fail2ban": {"enabled": False, "total_banned": 0, "jails": []}},
        }


class _ThreadedTCPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class LocalHtmlBridgeServer:
    """
    Servidor puente loopback local (127.0.0.1) para la App Nativa de Ubuntu:
    - Sirve la interfaz HTML5 canónica con flags nativos de Ubuntu inyectados.
    - Intercepta /api/dex/* para controlar directamente el hardware USB local (/dev/uhid, scrcpy, adb).
    - Enruta de forma transparente /api/* hacia el servidor descubierto (LAN o WAN) con credenciales Zero-Trust,
      o responde con telemetría local de silicio si no hay conexión externa.
    """

    def __init__(
        self,
        conn_mgr: ServerConnectionManager,
        dex: DexController,
        on_deb_relaunch=None,
        on_theme_change=None,
    ):
        self.conn_mgr = conn_mgr
        self.dex = dex
        self.on_deb_relaunch = on_deb_relaunch
        self.on_theme_change = on_theme_change
        self.html_path = resolve_bundled_html_path()
        self.server = None
        self.port = 0
        self.thread = None

    def start(self):
        parent = self

        class BridgeHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def _send_json(self, data, status=200):
                raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _serve_html(self, target_html_path=None):
                html_file = target_html_path or parent.html_path
                if not html_file or not os.path.isfile(html_file):
                    self._send_json({"error": "HTML UI not found"}, 404)
                    return
                with open(html_file, "r", encoding="utf-8") as f:
                    html = f.read()

                token_js = json.dumps(parent.conn_mgr.device_token or "")
                mode_js = json.dumps(parent.conn_mgr.connection_mode or "LOCAL")
                node_js = json.dumps(parent.conn_mgr.active_url or "local")
                theme_js = json.dumps(parent.conn_mgr.ui_theme if parent.conn_mgr.ui_theme in ("light", "dark") else "light")
                dev_info_js = json.dumps(parent.conn_mgr.refresh_device_telemetry(), ensure_ascii=False)
                auth_cfg_js = json.dumps(
                    {
                        "token": parent.conn_mgr.device_token or "",
                        "wanDomain": parent.conn_mgr.wan_domain or "",
                        "lanIp": parent.conn_mgr.saved_host or parent.conn_mgr.get_primary_lan_ip() or "",
                        "origin": parent.conn_mgr.active_url or "",
                        "mode": (
                            "WAN"
                            if parent.conn_mgr.connection_mode == "WAN"
                            else ("LAN" if parent.conn_mgr.connection_mode == "LAN" else "UNKNOWN")
                        ),
                        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    },
                    ensure_ascii=False,
                )
                app_ver = get_app_version()
                disp_ver = get_display_version(app_ver)
                bridge_script = (
                    "<script>"
                    "window.__RECURSOS_UBUNTU_NATIVE__ = true;"
                    "window.__RECURSOS_NATIVE__ = true;"
                    "window.__RECURSOS_NATIVE_PLATFORM__ = 'ubuntu';"
                    f"window.__INITIAL_APP_VERSION__ = '{app_ver}';"
                    f"window.__INITIAL_DISPLAY_VERSION__ = '{disp_ver}';"
                    "window.__INITIAL_APP_HASH__ = 'HEAD';"
                    f"window.__RECURSOS_INITIAL_THEME__ = {theme_js};"
                    f"window.__RECURSOS_DEVICE_TOKEN__ = {token_js};"
                    f"window.__RECURSOS_CONN_MODE__ = {mode_js};"
                    f"window.__RECURSOS_NODE_URL__ = {node_js};"
                    f"window.__RECURSOS_DEVICE_TELEMETRY__ = {dev_info_js};"
                    f"try {{ var _cfg = {auth_cfg_js}; "
                    "if (_cfg.token) { localStorage.setItem('recursos_device_token', _cfg.token); localStorage.setItem('sysmon_device_token', _cfg.token); } "
                    "var _prev = {}; try { _prev = JSON.parse(localStorage.getItem('recursos_auth_persistence_config') || '{}') || {}; } catch(_) {} "
                    "var _merged = Object.assign({}, _prev, _cfg, { token: _cfg.token || _prev.token || '', wanDomain: _cfg.wanDomain || _prev.wanDomain || '', lanIp: _cfg.lanIp || _prev.lanIp || '' }); "
                    "localStorage.setItem('recursos_auth_persistence_config', JSON.stringify(_merged)); } catch(e) {}"
                    "</script>"
                )
                if "<head>" in html:
                    html = html.replace("<head>", "<head>\n" + bridge_script, 1)
                else:
                    html = bridge_script + html

                raw = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _proxy_to_remote(self, method="GET", body=None):
                active_base = parent.conn_mgr.active_url
                if not active_base and not parent.conn_mgr.is_revoked:
                    now_ts = time.time()
                    if now_ts - getattr(parent.conn_mgr, "_last_bridge_rediscover_ts", 0.0) > 8.0:
                        parent.conn_mgr._last_bridge_rediscover_ts = now_ts
                        active_base = parent.conn_mgr.discover_server()
                if not active_base:
                    return False
                target_url = f"{active_base.rstrip('/')}{self.path}"
                extra_hdrs = {
                    "Accept": self.headers.get("Accept", "*/*"),
                }
                if self.headers.get("Content-Type"):
                    extra_hdrs["Content-Type"] = self.headers.get("Content-Type")
                headers = parent.conn_mgr._build_auth_headers(extra_hdrs)

                req_timeout = 60.0 if self.path.startswith("/api/system/") else 4.0
                req = urllib.request.Request(target_url, data=body, headers=headers, method=method)
                try:
                    with urllib.request.urlopen(req, timeout=req_timeout) as resp:
                        resp_body = resp.read()
                        ctype = resp.headers.get("Content-Type", "application/json")
                        if "application/json" in ctype and (
                            self.path.startswith("/api/metrics")
                            or self.path.startswith("/api/auth/register-device")
                            or self.path.startswith("/api/auth/restore-session")
                        ):
                            try:
                                parsed = json.loads(resp_body.decode("utf-8"))
                                cfg_dirty = False
                                new_tok = str(
                                    parsed.get("token")
                                    or parsed.get("auth_status", {}).get("token")
                                    or ""
                                ).strip()
                                if new_tok and new_tok != parent.conn_mgr.device_token:
                                    parent.conn_mgr.device_token = new_tok
                                    parent.conn_mgr.is_revoked = False
                                    cfg_dirty = True
                                pub_dom = str(
                                    parsed.get("auth_status", {}).get("public_domain")
                                    or parsed.get("version_info", {}).get("public_domain")
                                    or parsed.get("system", {}).get("public_domain")
                                    or ""
                                ).strip()
                                if pub_dom and pub_dom != parent.conn_mgr.wan_domain and _is_valid_wan_domain(pub_dom):
                                    parent.conn_mgr.wan_domain = pub_dom
                                    cfg_dirty = True
                                if cfg_dirty:
                                    parent.conn_mgr._save_config()
                                if isinstance(parsed.get("version_info"), dict):
                                    srv_vinfo = parsed["version_info"]
                                    srv_ver_live = str(
                                        srv_vinfo.get("server_version")
                                        or srv_vinfo.get("current_version")
                                        or srv_vinfo.get("version")
                                        or ""
                                    ).strip().lstrip("vV")
                                    gh_cached = parent.conn_mgr.github_update_info or {}
                                    gh_ver_live = str(
                                        gh_cached.get("github_version")
                                        or srv_vinfo.get("remote_version")
                                        or ""
                                    ).strip().lstrip("vV")
                                    app_ver_live = str(
                                        gh_cached.get("app_version")
                                        or parent.conn_mgr.device_telemetry.get("app_version")
                                        or get_app_version()
                                    ).strip().lstrip("vV")
                                    comp = parent.conn_mgr._compute_version_comparison(
                                        app_ver=app_ver_live,
                                        gh_ver=gh_ver_live,
                                        server_ver=srv_ver_live,
                                        server_reachable=True,
                                        server_url=active_base,
                                        installed_deb=gh_cached.get("installed_deb_version") or "",
                                    )
                                    srv_vinfo.update(
                                        {
                                            "app_version": comp["app_version"],
                                            "app_display_version": comp["app_display_version"],
                                            "server_version": comp["server_version"],
                                            "server_display_version": comp["server_display_version"],
                                            "server_reachable": True,
                                            "remote_version": comp["github_version"] or srv_vinfo.get("remote_version"),
                                            "remote_display_version": comp["github_display_version"]
                                            or srv_vinfo.get("remote_display_version"),
                                            "app_above_server": comp["app_above_server"],
                                            "app_above_github": comp["app_above_github"],
                                            "github_above_server": comp["github_above_server"],
                                            "github_above_app": comp["github_above_app"],
                                            "server_needs_update": comp["server_needs_update"],
                                            "effective_update_available": comp["effective_update_available"],
                                            "update_available": bool(comp["effective_update_available"]),
                                            "ahead_of_remote": bool(comp["app_above_github"] and not comp["server_needs_update"]),
                                            "target_version": comp["target_version"],
                                            "update_mode": comp["update_mode"],
                                            "update_action_label": comp["update_action_label"],
                                            "update_summary": comp["update_summary"],
                                            "ubuntu_native_bridge": True,
                                        }
                                    )
                                    resp_body = json.dumps(parsed).encode("utf-8")
                            except Exception:
                                pass
                        self.send_response(resp.status)
                        self.send_header("Content-Type", ctype)
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Content-Length", str(len(resp_body)))
                        self.end_headers()
                        self.wfile.write(resp_body)
                        return True
                except urllib.error.HTTPError as he:
                    if he.code == 403:
                        parent.conn_mgr.is_revoked = True
                        parent.conn_mgr.connection_mode = "REVOKED"
                        parent.conn_mgr._save_config()
                    try:
                        err_body = he.read()
                    except Exception:
                        err_body = b""
                    if not err_body:
                        err_body = json.dumps({
                            "ok": False,
                            "success": False,
                            "error": f"Error HTTP {he.code} en el servidor remoto",
                        }).encode("utf-8")
                    ctype = he.headers.get("Content-Type", "application/json") if he.headers else "application/json"
                    self.send_response(he.code)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", str(len(err_body)))
                    self.end_headers()
                    self.wfile.write(err_body)
                    return True
                except Exception:
                    parent.conn_mgr.active_url = ""
                    return False

            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                clean_path = parsed.path

                if clean_path in (
                    "/recursos-cockpit.png",
                    "/favicon.ico",
                    "/favicon.png",
                    "/favicon-16x16.png",
                    "/favicon-32x32.png",
                    "/favicon-192x192.png",
                    "/favicon-512x512.png",
                    "/apple-touch-icon.png",
                ):
                    asset_path = resolve_static_asset_path(clean_path)
                    if asset_path and os.path.isfile(asset_path):
                        with open(asset_path, "rb") as af:
                            data = af.read()
                        ctype = "image/x-icon" if asset_path.endswith(".ico") else "image/png"
                        self.send_response(200)
                        self.send_header("Content-Type", ctype)
                        self.send_header("Cache-Control", "public, max-age=86400")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return

                if clean_path == "/api/native/device-info":
                    self._send_json(parent.conn_mgr.refresh_device_telemetry())
                    return

                if clean_path == "/api/native/github-releases":
                    force_ref = ("refresh=1" in self.path or "refresh=true" in self.path)
                    self._send_json(parent.conn_mgr.fetch_github_native_releases(force_refresh=force_ref))
                    return

                # 1. Control local de hardware DeX USB exclusivo de Ubuntu
                if clean_path == "/api/dex/status":
                    deps = parent.dex.check_dependencies()
                    devices = parent.dex.list_connected_devices(usb_only=True)
                    self._send_json(
                        {
                            "ok": True,
                            "success": True,
                            "usb_only": True,
                            "environment": "ubuntu_native",
                            "session_running": parent.dex.is_running,
                            "dependencies": deps,
                            "devices": devices,
                        }
                    )
                    return

                if clean_path == "/api/dex/devices":
                    devices = parent.dex.list_connected_devices(usb_only=True)
                    self._send_json(
                        {
                            "ok": True,
                            "success": True,
                            "usb_only": True,
                            "devices": devices,
                        }
                    )
                    return

                def _build_unified_version_payload(srv_payload=None, ver_comp=None, active_base=""):
                    if ver_comp is None:
                        ver_comp = parent.conn_mgr.check_github_app_update(
                            target_url=active_base,
                            probe_server=(srv_payload is None),
                            server_payload=srv_payload,
                        )
                    out_payload = dict(srv_payload) if isinstance(srv_payload, dict) else {}
                    srv_reachable = bool(ver_comp.get("server_reachable"))
                    shown_ver = ver_comp["server_version"] if srv_reachable else ver_comp["app_version"]
                    shown_disp = ver_comp["server_display_version"] if srv_reachable else ver_comp["app_display_version"]
                    rem_ver = ver_comp.get("github_version") or out_payload.get("remote_version") or ver_comp["app_version"]
                    rem_disp = ver_comp.get("github_display_version") or get_display_version(rem_ver)

                    auto_status = (
                        parent.conn_mgr.auto_install_status
                        or out_payload.get("auto_install_status")
                        or ("Comprobación directa desde App Ubuntu" if not srv_reachable else "")
                    )
                    out_payload.update(
                        {
                            "current_version": shown_ver,
                            "version": shown_ver,
                            "display_version": shown_disp,
                            "local_version": ver_comp["app_version"],
                            "app_version": ver_comp["app_version"],
                            "app_display_version": ver_comp["app_display_version"],
                            "server_version": ver_comp["server_version"],
                            "server_display_version": ver_comp["server_display_version"],
                            "server_reachable": srv_reachable,
                            "remote_version": rem_ver,
                            "remote_display_version": rem_disp,
                            "deb_release_version": ver_comp.get("deb_release_version") or rem_ver,
                            "installed_deb_version": ver_comp.get("installed_deb_version") or ver_comp["app_version"],
                            "package_installed": bool(ver_comp.get("app_installed_deb")),
                            "package_needs_install": bool(ver_comp.get("github_above_app")),
                            "update_available": bool(ver_comp.get("effective_update_available")),
                            "effective_update_available": bool(ver_comp.get("effective_update_available")),
                            "ahead_of_remote": bool(ver_comp.get("app_above_github") and not ver_comp.get("server_needs_update")),
                            "app_above_server": bool(ver_comp.get("app_above_server")),
                            "app_above_github": bool(ver_comp.get("app_above_github")),
                            "github_above_server": bool(ver_comp.get("github_above_server")),
                            "github_above_app": bool(ver_comp.get("github_above_app")),
                            "server_needs_update": bool(ver_comp.get("server_needs_update")),
                            "target_version": ver_comp.get("target_version"),
                            "update_mode": ver_comp.get("update_mode"),
                            "update_action_label": ver_comp.get("update_action_label"),
                            "update_summary": ver_comp.get("update_summary"),
                            "ubuntu_native_bridge": True,
                            "auto_install_enabled": parent.conn_mgr.auto_install_enabled
                            if not srv_reachable
                            else out_payload.get("auto_install_enabled", parent.conn_mgr.auto_install_enabled),
                            "auto_install_in_progress": bool(
                                parent.conn_mgr.auto_install_in_progress or out_payload.get("auto_install_in_progress", False)
                            ),
                            "auto_install_status": auto_status,
                            "last_auto_install": parent.conn_mgr.last_auto_install or out_payload.get("last_auto_install", ""),
                        }
                    )
                    if not srv_reachable:
                        out_payload.setdefault("has_git", False)
                        out_payload.setdefault("recent_commits", [])
                        out_payload.setdefault("branch", "main")
                    return out_payload

                # 2. Proxy de API hacia el servidor descubierto o fallback local
                if clean_path == "/api/version":
                    srv_payload = None
                    active_base = parent.conn_mgr._resolve_target_server_url()
                    if active_base:
                        try:
                            req_v = urllib.request.Request(
                                f"{active_base.rstrip('/')}{self.path}",
                                headers=parent.conn_mgr._build_auth_headers({"Accept": "application/json"}),
                                method="GET",
                            )
                            with urllib.request.urlopen(req_v, timeout=4.0) as rv:
                                if rv.status == 200:
                                    srv_payload = json.loads(rv.read().decode("utf-8"))
                                    pub_dom_v = str((srv_payload or {}).get("public_domain") or "").strip()
                                    if _is_valid_wan_domain(pub_dom_v) and pub_dom_v != parent.conn_mgr.wan_domain:
                                        parent.conn_mgr.wan_domain = pub_dom_v
                                        parent.conn_mgr._save_config()
                        except Exception:
                            srv_payload = None

                    ver_comp = parent.conn_mgr.check_github_app_update(
                        target_url=active_base,
                        probe_server=(srv_payload is None),
                        server_payload=srv_payload,
                        refresh_server=("refresh=1" in self.path or "refresh=true" in self.path),
                    )
                    out_payload = _build_unified_version_payload(srv_payload=srv_payload, ver_comp=ver_comp, active_base=active_base)
                    self._send_json(out_payload)
                    return

                if clean_path == "/api/dictionary":
                    if "refresh=1" in self.path or "refresh=true" in self.path or "sync=1" in self.path:
                        base_dir = _catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
                        _catalog_sync_github(base_dir=base_dir, force=True, timeout=5.0)
                        if self._proxy_to_remote("GET"):
                            return
                        raw_dict = _catalog_dict_bytes(base_dir)
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                        self.send_header("Content-Length", str(len(raw_dict)))
                        self.end_headers()
                        self.wfile.write(raw_dict)
                        return

                if clean_path == "/i18n/dictionary.csv":
                    base_dir = _catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
                    if "refresh=1" in self.path or "refresh=true" in self.path or "sync=1" in self.path:
                        _catalog_sync_github(base_dir=base_dir, force=True, timeout=5.0)
                    csv_bytes = _catalog_dict_csv_bytes(base_dir)
                    self.send_response(200)
                    self.send_header("Content-Type", "text/csv; charset=utf-8")
                    self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                    self.send_header("Content-Length", str(len(csv_bytes)))
                    self.end_headers()
                    self.wfile.write(csv_bytes)
                    return

                if clean_path.startswith("/api/"):
                    if self._proxy_to_remote("GET"):
                        return
                    if clean_path == "/api/dictionary":
                        base_dir = _catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
                        raw_dict = _catalog_dict_bytes(base_dir)
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                        self.send_header("Content-Length", str(len(raw_dict)))
                        self.end_headers()
                        self.wfile.write(raw_dict)
                        return
                    if clean_path == "/api/themes" or clean_path.startswith("/api/themes/"):
                        base_dir = _catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
                        if "refresh=1" in self.path or "refresh=true" in self.path or "sync=1" in self.path:
                            _themes_sync_github(base_dir=base_dir, force=True, timeout=5.0)
                        if clean_path == "/api/themes":
                            self._send_json(_themes_get_catalog(base_dir=base_dir))
                        else:
                            item_name = clean_path[len("/api/themes/"):]
                            item = _themes_get_catalog(base_dir=base_dir) if item_name == "themes.json" else _themes_get_single(item_name, base_dir=base_dir)
                            if item is None:
                                self._send_json({"ok": False, "error": "Theme not found"}, 404)
                            else:
                                self._send_json(item)
                        return
                    if clean_path.startswith("/api/maps/tile/"):
                        m_tile = re.match(r"^/api/maps/tile/(light|dark|osm)/(\d+)/(\d+)/(\d+)(?:\.(?:png|jpg|jpeg))?$", clean_path)
                        if not m_tile:
                            self.send_response(400)
                            self.end_headers()
                            return
                        t_style, zi, xi, yi = m_tile.group(1), int(m_tile.group(2)), int(m_tile.group(3)), int(m_tile.group(4))
                        t_urls = (
                            [
                                f"https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{zi}/{yi}/{xi}",
                                f"https://tile.openstreetmap.de/{zi}/{xi}/{yi}.png",
                            ]
                            if t_style == "dark"
                            else [
                                f"https://tile.openstreetmap.org/{zi}/{xi}/{yi}.png",
                                f"https://tile.openstreetmap.de/{zi}/{xi}/{yi}.png",
                                f"https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{zi}/{yi}/{xi}",
                            ]
                        )
                        for tu in t_urls:
                            try:
                                req_t = urllib.request.Request(
                                    tu,
                                    headers={
                                        "User-Agent": f"RecursosCockpit/{get_app_version()} (+https://github.com/cminewarIA/recursos-ui)",
                                        "Accept": "image/webp,image/png,image/jpeg,*/*;q=0.8",
                                    },
                                )
                                with urllib.request.urlopen(req_t, timeout=6) as tr:
                                    t_bytes = tr.read()
                                    t_ct = tr.headers.get_content_type() or "image/png"
                                    if tr.status == 200 and t_ct.startswith("image/") and len(t_bytes) > 100:
                                        self.send_response(200)
                                        self.send_header("Content-Type", t_ct)
                                        self.send_header("Cache-Control", "public, max-age=86400")
                                        self.send_header("Content-Length", str(len(t_bytes)))
                                        self.end_headers()
                                        self.wfile.write(t_bytes)
                                        return
                            except Exception:
                                continue
                        self.send_response(502)
                        self.end_headers()
                        return
                    if clean_path == "/api/metrics":
                        self._send_json(parent.conn_mgr.build_local_fallback_metrics())
                        return
                    if clean_path == "/api/auth/devices":
                        tel = parent.conn_mgr.refresh_device_telemetry()
                        self._send_json(
                            [
                                {
                                    "id": tel.get("hardware_id", "dev_local_ubuntu"),
                                    "name": tel.get("name", "Ubuntu Workstation"),
                                    "client_type": "ubuntu_native",
                                    "client_label": "App Nativa Ubuntu (.deb)",
                                    "access_level": "FULL_NATIVE_ACCESS",
                                    "full_access": True,
                                    "app_version": tel.get("app_version"),
                                    "local_ip": tel.get("local_ip", "127.0.0.1"),
                                    "last_external_ip": "",
                                    "first_seen": "Sesión Activa",
                                    "last_seen": "Ahora mismo",
                                    "verified_in_lan": True,
                                    "trusted": True,
                                    "is_current": True,
                                    "device_telemetry": tel,
                                }
                            ]
                        )
                        return
                    if clean_path == "/api/version":
                        ver = get_app_version()
                        disp_ver = get_display_version(ver)
                        gh = parent.conn_mgr.github_update_info or {}
                        inst_ver = parent.conn_mgr.get_installed_deb_version() or ver
                        rem_ver = gh.get("github_version") or ver
                        rem_disp = gh.get("github_display_version") or get_display_version(rem_ver)
                        self._send_json(
                            {
                                "current_version": ver,
                                "display_version": disp_ver,
                                "version": ver,
                                "local_version": ver,
                                "remote_version": rem_ver,
                                "remote_display_version": rem_disp,
                                "update_available": bool(gh.get("update_available", False)),
                                "ahead_of_remote": False,
                                "has_git": False,
                                "recent_commits": [],
                                "auto_install_enabled": parent.conn_mgr.auto_install_enabled,
                                "auto_install_status": "Comprobación directa por GitHub",
                                "installed_deb_version": inst_ver,
                                "package_installed": bool(inst_ver),
                                "package_needs_install": bool(gh.get("update_available", False)),
                                "branch": "main",
                            }
                        )
                        return
                    if clean_path == "/api/maps/config":
                        self._send_json(
                            {
                                "ok": True,
                                "provider": "leaflet_osm",
                                "requires_api_key": False,
                                "tile_url": "/api/maps/tile/{theme}/{z}/{x}/{y}.png",
                            }
                        )
                        return
                    if clean_path == "/api/system/logs":
                        self._send_json(
                            {
                                "ok": True,
                                "logs": [],
                                "entries": [],
                                "total": 0,
                                "total_errors": 0,
                                "log_errors_count": 0,
                                "failed_units_count": 0,
                                "failed_units": [],
                                "ack_ts": 0,
                                "ack_time_str": "",
                                "counts_by_category": {
                                    "all": 0,
                                    "total": 0,
                                    "systemd": 0,
                                    "docker": 0,
                                    "network": 0,
                                    "kernel": 0,
                                    "auth": 0,
                                    "app": 0,
                                },
                            }
                        )
                        return
                    self._send_json({"ok": False, "success": False, "error": f"Endpoint no encontrado: {clean_path}"}, status=404)
                    return

                # 2b. Manual Web Interactivo (/manual, /manual.html, /readme)
                if clean_path in ("/manual", "/manual.html", "/readme"):
                    manual_path = resolve_static_asset_path("manual.html")
                    if not manual_path:
                        docs_fallback = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "docs", "index.html"))
                        if os.path.isfile(docs_fallback):
                            manual_path = docs_fallback
                    if manual_path and os.path.isfile(manual_path):
                        self._serve_html(manual_path)
                        return

                # 3. Rutas SPA HTML5
                self._serve_html()

            def do_POST(self):
                parsed = urllib.parse.urlparse(self.path)
                clean_path = parsed.path
                try:
                    length = int(self.headers.get("Content-Length", 0) or 0)
                except (ValueError, TypeError):
                    self._send_json({"ok": False, "error": "Content-Length inválido"}, 400)
                    return
                if length < 0 or length > 5 * 1024 * 1024:
                    self._send_json({"ok": False, "error": "Payload demasiado grande"}, 413)
                    return
                raw_body = self.rfile.read(length) if length > 0 else b"{}"

                if clean_path == "/api/native/theme":
                    try:
                        payload = json.loads(raw_body.decode("utf-8"))
                    except Exception:
                        payload = {}
                    next_theme = str(payload.get("theme") or "").strip().lower()
                    if next_theme in ("light", "dark"):
                        if parent.conn_mgr.ui_theme != next_theme:
                            parent.conn_mgr.ui_theme = next_theme
                            parent.conn_mgr._save_config()
                        if parent.on_theme_change:
                            try:
                                parent.on_theme_change(next_theme)
                            except Exception:
                                pass
                    self._send_json({"ok": True, "theme": parent.conn_mgr.ui_theme})
                    return

                if clean_path == "/api/native/download-deb":
                    rel_info = parent.conn_mgr.fetch_github_native_releases(force_refresh=True)
                    ok_deb, msg_deb, new_ver = parent.conn_mgr._install_deb_from_github(
                        rel_info,
                        relaunch_on_deb=False,
                        interactive=True,
                    )
                    self._send_json({
                        "ok": ok_deb,
                        "message": msg_deb,
                        "installed_version": new_ver or get_app_version(),
                        "releases": rel_info,
                    })
                    return

                if clean_path == "/api/native/download-apk":
                    rel_info = parent.conn_mgr.fetch_github_native_releases(force_refresh=True)
                    ok_apk, msg_apk, saved_path = parent.conn_mgr.download_apk_to_downloads(rel_info)
                    self._send_json({
                        "ok": ok_apk,
                        "message": msg_apk,
                        "saved_path": saved_path,
                        "downloads_dir": resolve_user_downloads_dir(),
                        "releases": rel_info,
                    })
                    return

                if clean_path == "/api/themes/sync":
                    base_dir = _catalog_base_dir(os.path.abspath(os.path.join(SCRIPT_DIR, "..")))
                    sync_res = _themes_sync_github(base_dir=base_dir, force=True, timeout=6.0)
                    if self._proxy_to_remote("POST", raw_body):
                        return
                    cat = _themes_get_catalog(base_dir=base_dir)
                    cat["sync_result"] = sync_res
                    self._send_json(cat)
                    return

                if clean_path == "/api/dex/start":
                    try:
                        payload = json.loads(raw_body.decode("utf-8"))
                    except Exception:
                        payload = {}
                    serial = payload.get("serial") or payload.get("device_id") or None
                    resolution = str(payload.get("resolution") or "1920x1080")
                    max_fps = int(payload.get("max_fps") or 60)
                    use_uhid = bool(payload.get("use_uhid", True))
                    fullscreen = bool(payload.get("fullscreen", False))
                    turn_screen_off = bool(payload.get("turn_screen_off", False))

                    ok = parent.dex.start_dex_session(
                        device_id=serial,
                        resolution=resolution,
                        fullscreen=fullscreen,
                        max_fps=max_fps,
                        use_uhid=use_uhid,
                        turn_screen_off=turn_screen_off,
                        usb_only=True,
                    )
                    self._send_json(
                        {
                            "ok": ok,
                            "success": ok,
                            "session_running": parent.dex.is_running,
                        }
                    )
                    return

                if clean_path == "/api/dex/stop":
                    parent.dex.stop_session()
                    self._send_json({"ok": True, "success": True, "session_running": False})
                    return

                if clean_path in ("/api/system/update", "/api/update"):
                    ok, msg, updated_info, flags = parent.conn_mgr.perform_unified_update(
                        relaunch_on_deb=False,
                        interactive=True,
                        force_download=True,
                    )
                    srv_payload_after, _srv_ok, active_base_after = parent.conn_mgr.probe_server_version_info(refresh=False)
                    app_disp_cur = get_display_version(
                        updated_info.get("app_version") or parent.conn_mgr.get_installed_deb_version() or get_app_version()
                    )
                    srv_disp_cur = get_display_version(updated_info.get("server_version") or "")
                    rem_disp_cur = get_display_version(updated_info.get("github_version") or "")
                    srv_reach_cur = bool(updated_info.get("server_reachable"))
                    shown_ver_cur = updated_info.get("server_version") if srv_reach_cur else updated_info.get("app_version")
                    shown_disp_cur = srv_disp_cur if srv_reach_cur else app_disp_cur

                    unified_ver_info = dict(srv_payload_after) if isinstance(srv_payload_after, dict) else {}
                    unified_ver_info.update(
                        {
                            "current_version": shown_ver_cur or get_app_version(),
                            "version": shown_ver_cur or get_app_version(),
                            "display_version": shown_disp_cur or get_display_version(),
                            "local_version": updated_info.get("app_version") or get_app_version(),
                            "app_version": updated_info.get("app_version") or get_app_version(),
                            "app_display_version": app_disp_cur,
                            "server_version": updated_info.get("server_version") or "",
                            "server_display_version": srv_disp_cur,
                            "server_reachable": srv_reach_cur,
                            "remote_version": updated_info.get("github_version") or rem_disp_cur,
                            "remote_display_version": rem_disp_cur,
                            "deb_release_version": updated_info.get("deb_release_version") or rem_disp_cur,
                            "installed_deb_version": updated_info.get("installed_deb_version") or updated_info.get("app_version"),
                            "package_installed": bool(updated_info.get("app_installed_deb")),
                            "package_needs_install": bool(updated_info.get("github_above_app")),
                            "update_available": bool(updated_info.get("effective_update_available")),
                            "effective_update_available": bool(updated_info.get("effective_update_available")),
                            "ahead_of_remote": bool(updated_info.get("app_above_github") and not updated_info.get("server_needs_update")),
                            "app_above_server": bool(updated_info.get("app_above_server")),
                            "app_above_github": bool(updated_info.get("app_above_github")),
                            "github_above_server": bool(updated_info.get("github_above_server")),
                            "github_above_app": bool(updated_info.get("github_above_app")),
                            "server_needs_update": bool(updated_info.get("server_needs_update")),
                            "target_version": updated_info.get("target_version"),
                            "update_mode": updated_info.get("update_mode"),
                            "update_action_label": updated_info.get("update_action_label"),
                            "update_summary": updated_info.get("update_summary"),
                            "ubuntu_native_bridge": True,
                            "auto_install_enabled": parent.conn_mgr.auto_install_enabled,
                            "auto_install_in_progress": parent.conn_mgr.auto_install_in_progress,
                            "auto_install_status": parent.conn_mgr.auto_install_status,
                            "last_auto_install": parent.conn_mgr.last_auto_install,
                        }
                    )
                    will_relaunch = bool(ok and flags.get("deb_installed") and parent.on_deb_relaunch and os.environ.get("DISPLAY"))
                    self._send_json(
                        {
                            "success": ok,
                            "ok": ok,
                            "already_running": bool(flags.get("already_running", False)),
                            "deb_installed": flags.get("deb_installed", False),
                            "web_synced": flags.get("web_synced", False),
                            "relaunching": will_relaunch,
                            "message": msg,
                            "output": flags.get("output") or msg,
                            "version_info": unified_ver_info,
                        },
                        status=200,
                    )
                    if will_relaunch:
                        threading.Timer(0.9, parent.on_deb_relaunch).start()
                    return

                if clean_path == "/api/system/auto-update":
                    try:
                        payload = json.loads(raw_body.decode("utf-8"))
                    except Exception:
                        payload = {}
                    enabled_val = bool(payload.get("enabled", True))
                    parent.conn_mgr.auto_install_enabled = enabled_val
                    parent.conn_mgr.auto_install_status = i18n_t(
                        "more.auto_enabled_status" if enabled_val else "more.auto_paused_status"
                    )
                    parent.conn_mgr._save_config()
                    if enabled_val and parent.on_deb_relaunch:
                        threading.Thread(
                            target=parent.conn_mgr.run_auto_update_cycle,
                            kwargs={"on_deb_installed_cb": parent.on_deb_relaunch},
                            daemon=True,
                        ).start()
                    if self._proxy_to_remote("POST", body=raw_body):
                        return
                    self._send_json({
                        "ok": True,
                        "success": True,
                        "auto_install_enabled": parent.conn_mgr.auto_install_enabled,
                        "status": parent.conn_mgr.auto_install_status,
                    })
                    return

                if self._proxy_to_remote("POST", body=raw_body):
                    return

                if clean_path in ("/api/system/logs/clear", "/api/system/logs/ack"):
                    self._send_json(
                        {
                            "ok": True,
                            "success": True,
                            "system_errors_summary": {
                                "total": 0,
                                "total_errors": 0,
                                "log_errors_count": 0,
                                "failed_units_count": 0,
                                "failed_units": [],
                            },
                        }
                    )
                    return

                self._send_json({"ok": False, "error": "Modo sin conexión al servidor remoto"}, 503)

            def _handle_body_proxy(self, method):
                try:
                    length = int(self.headers.get("Content-Length", 0) or 0)
                except (ValueError, TypeError):
                    self._send_json({"ok": False, "error": "Content-Length inválido"}, 400)
                    return
                if length < 0 or length > 5 * 1024 * 1024:
                    self._send_json({"ok": False, "error": "Payload demasiado grande"}, 413)
                    return
                raw_body = self.rfile.read(length) if length > 0 else b""
                if self._proxy_to_remote(method, body=(raw_body if length > 0 else None)):
                    return
                self._send_json({"ok": False, "error": "Modo sin conexión al servidor remoto"}, 503)

            def do_PUT(self):
                self._handle_body_proxy("PUT")

            def do_DELETE(self):
                self._handle_body_proxy("DELETE")

            def do_PATCH(self):
                self._handle_body_proxy("PATCH")

            def do_OPTIONS(self):
                self.send_response(204)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Token")
                self.send_header("Content-Length", "0")
                self.end_headers()

        self.server = _ThreadedTCPServer(("127.0.0.1", 0), BridgeHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self.port

    def stop(self):
        if self.server:
            try:
                self.server.shutdown()
                self.server.server_close()
            except Exception:
                pass


def detect_runtime_environment(force_env=None):
    """
    Detecta dinámicamente el entorno de ejecución.
    En Ubuntu nativo habilita el motor HTML5 unificado y desbloquea la pestaña DeX USB.
    """
    env_override = (force_env or os.environ.get("RECURSOS_ENV") or "").strip().lower()
    machine = (platform.machine() or "").lower()
    is_mobile_arch = any(arch in machine for arch in ("aarch64", "arm", "armv7l", "armv8l"))
    is_android_env = bool(os.environ.get("ANDROID_ROOT") or os.environ.get("ANDROID_DATA"))

    if env_override == "web":
        mode = "web"
    elif env_override in ("mobile", "android") or is_android_env or is_mobile_arch:
        mode = "mobile"
    else:
        mode = "native"

    is_native_or_mobile = mode in ("native", "mobile")
    return {
        "mode": mode,
        "engine": "html5_webkit2",
        "is_native": mode == "native",
        "is_mobile": mode == "mobile",
        "is_web": mode == "web",
        "is_native_or_mobile": is_native_or_mobile,
        "hide_device_tab": False if mode == "native" else True,
        "dex_unlocked": mode == "native",
    }


class RecursosNativeWindow(Gtk.ApplicationWindow):
    def __init__(self, app, start_in_dex=False, env_info=None):
        self.env_info = env_info or detect_runtime_environment()
        disp_ver = get_display_version()
        super().__init__(
            application=app,
            title=i18n_t("native_ubuntu.win_title", {"ver": disp_ver}),
        )
        self.set_default_size(1280, 820)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.is_fullscreen = False
        self.start_in_dex = start_in_dex
        self.webview = None
        self.main_stack = None
        self._css_provider = None
        self._current_theme = "light"
        self._webview_uri_loaded = False
        self._pending_nav_view = "dex" if start_in_dex else None
        self._target_webview_uri = ""

        self.dex = DexController(on_status_change=self._on_dex_status_callback)
        self.conn_mgr = ServerConnectionManager()
        self._current_theme = self.conn_mgr.ui_theme if self.conn_mgr.ui_theme in ("light", "dark") else "light"
        self._apply_css(self._current_theme)
        self._set_app_icon()

        relaunch_cb = lambda: GLib.idle_add(self._reexec_after_update)
        theme_cb = lambda th: GLib.idle_add(self._apply_theme, th)
        self.bridge = LocalHtmlBridgeServer(
            self.conn_mgr,
            self.dex,
            on_deb_relaunch=relaunch_cb,
            on_theme_change=theme_cb,
        )
        self.bridge_port = self.bridge.start()

        self._build_headerbar()
        self._build_main_layout()

        self.connect("key-press-event", self._on_key_press)
        self.connect("destroy", lambda *_: self.bridge.stop())
        auto_enter_web = bool(self.start_in_dex or self.conn_mgr.saved_host or self.conn_mgr.wan_domain)
        if hasattr(self, "btn_back_home"):
            self.btn_back_home.set_no_show_all(True)
            self.btn_back_home.set_visible(auto_enter_web)
        self.show_all()

        GLib.idle_add(self._refresh_config_labels)
        GLib.idle_add(self._refresh_local_node_panel)
        GLib.idle_add(self._trigger_github_check_async)
        self.conn_mgr.start_auto_update_watcher(on_deb_installed_cb=relaunch_cb)
        if self.start_in_dex:
            self._connect_and_open_webview(target_view="dex")
        elif auto_enter_web:
            self._connect_and_open_webview(target_view="inicio")
        GLib.timeout_add(3000, self._refresh_connection_badge)

    def _connect_and_open_webview(self, target_view="inicio"):
        self.lbl_conn_status.set_text(i18n_t("native_ubuntu.searching_node"))
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text(i18n_t("native_ubuntu.searching_node_desc"))

        def worker():
            self.conn_mgr.discover_server()
            if self.conn_mgr.active_url and not self.conn_mgr.is_revoked:
                self.conn_mgr.register_device_with_server()
                self.conn_mgr.fetch_metrics()
            GLib.idle_add(self._on_node_connected_ui, target_view)

        threading.Thread(target=worker, daemon=True).start()

    def _on_node_connected_ui(self, target_view="inicio"):
        self._refresh_connection_badge()
        self._refresh_config_labels()
        if target_view:
            self._pending_nav_view = target_view
        if self.webview and HAS_WEBKIT2:
            if not self._webview_uri_loaded and self._target_webview_uri:
                nav_view = target_view or ("dex" if self.start_in_dex else "inicio")
                base_uri = self._target_webview_uri.split("?")[0]
                self.webview.load_uri(f"{base_uri}?env=ubuntu_native&view={nav_view}")
            else:
                self._set_webview_paused(False)
                self._sync_webview_session()
                if target_view:
                    self._navigate_spa(target_view)
                    self._pending_nav_view = None
        if self.main_stack:
            self.main_stack.set_visible_child_name("webview")
        if hasattr(self, "btn_back_home"):
            self.btn_back_home.set_visible(True)
        return False

    def _on_webview_create(self, _webview, navigation_action):
        """Open external target=_blank links cleanly in the Ubuntu system browser."""
        try:
            req = navigation_action.get_request() if navigation_action else None
            uri = (req.get_uri() if req else "") or ""
            if uri and (uri.startswith("http://") or uri.startswith("https://")):
                subprocess.Popen(
                    ["xdg-open", uri],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        except Exception:
            pass
        return None

    def _on_webview_load_changed(self, _webview, load_event):
        if HAS_WEBKIT2 and WebKit2 is not None and load_event == WebKit2.LoadEvent.FINISHED:
            self._webview_uri_loaded = True
            self._set_webview_paused(False)
            self._sync_webview_session()
            if self._pending_nav_view:
                nav = self._pending_nav_view
                self._pending_nav_view = None
                self._navigate_spa(nav)

    def _set_webview_paused(self, paused):
        if self.webview and HAS_WEBKIT2 and self._webview_uri_loaded:
            flag = "true" if paused else "false"
            js = f"window.__RECURSOS_PAUSED__={flag};window.dispatchEvent(new CustomEvent('recursos-visibility',{{detail:{{paused:{flag}}}}}));"
            try:
                if hasattr(self.webview, "evaluate_javascript"):
                    self.webview.evaluate_javascript(js, -1, None, None, None, None, None)
                elif hasattr(self.webview, "run_javascript"):
                    self.webview.run_javascript(js, None, None, None)
            except Exception:
                pass

    def _sync_webview_session(self):
        if self.webview and HAS_WEBKIT2:
            tok = json.dumps(self.conn_mgr.device_token or "")
            dev_info = json.dumps(self.conn_mgr.refresh_device_telemetry(), ensure_ascii=False)
            js = (
                f"window.__RECURSOS_DEVICE_TELEMETRY__={dev_info};"
                f"if(window.injectNativeSession){{window.injectNativeSession({tok},{dev_info});}}"
            )
            try:
                if hasattr(self.webview, "evaluate_javascript"):
                    self.webview.evaluate_javascript(js, -1, None, None, None, None, None)
                elif hasattr(self.webview, "run_javascript"):
                    self.webview.run_javascript(js, None, None, None)
            except Exception:
                pass
        return False

    def _set_app_icon(self):
        icon_candidates = [
            "/usr/share/pixmaps/recursos-cockpit.png",
            "/usr/share/icons/hicolor/512x512/apps/recursos-cockpit.png",
            "/usr/lib/recursos-cockpit/assets/recursos-cockpit.png",
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit.png"),
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit.svg"),
        ]
        for c in icon_candidates:
            if os.path.isfile(c):
                try:
                    self.set_icon_from_file(c)
                    break
                except Exception:
                    pass

    def _apply_css(self, theme_name=None):
        normalized = str(theme_name or self._current_theme or "light").strip().lower()
        is_dark = normalized == "dark"
        self._current_theme = "dark" if is_dark else "light"
        try:
            gtk_settings = Gtk.Settings.get_default()
            if gtk_settings is not None:
                gtk_settings.set_property("gtk-application-prefer-dark-theme", is_dark)
        except Exception:
            pass
        screen = Gdk.Screen.get_default()
        if screen:
            if self._css_provider is not None:
                try:
                    Gtk.StyleContext.remove_provider_for_screen(screen, self._css_provider)
                except Exception:
                    pass
            provider = Gtk.CssProvider()
            provider.load_from_data(NATIVE_CSS_DARK if is_dark else NATIVE_CSS_LIGHT)
            Gtk.StyleContext.add_provider_for_screen(
                screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )
            self._css_provider = provider
        if self.webview and HAS_WEBKIT2 and hasattr(self.webview, "set_background_color"):
            try:
                rgba = Gdk.RGBA()
                rgba.parse("#0a140b" if is_dark else "#f5f4f2")
                self.webview.set_background_color(rgba)
            except Exception:
                pass

    def _apply_theme(self, theme_name):
        normalized = str(theme_name or "").strip().lower()
        if normalized not in ("light", "dark"):
            return False
        if self.conn_mgr.ui_theme != normalized:
            self.conn_mgr.ui_theme = normalized
            self.conn_mgr._save_config()
        if normalized != self._current_theme or self._css_provider is None:
            self._apply_css(normalized)
        return False

    def _on_webkit_theme_message(self, _manager, js_result):
        try:
            raw_val = ""
            if hasattr(js_result, "get_js_value"):
                js_val = js_result.get_js_value()
                if js_val and hasattr(js_val, "to_string"):
                    raw_val = str(js_val.to_string() or "")
            elif isinstance(js_result, str):
                raw_val = js_result
            raw_val = raw_val.strip().lower()
            if raw_val in ("light", "dark"):
                self._apply_theme(raw_val)
        except Exception:
            pass

    def _build_headerbar(self):
        hb = Gtk.HeaderBar()
        hb.set_show_close_button(True)
        if hasattr(hb, "set_decoration_layout"):
            hb.set_decoration_layout(":minimize,maximize,close")
        disp_ver = get_display_version()
        hb.props.title = i18n_t("app.brand")
        hb.props.subtitle = i18n_t("native_ubuntu.subtitle", {"ver": disp_ver})

        self.btn_back_home = Gtk.Button(label=i18n_t("native_ubuntu.main_menu"))
        self.btn_back_home.get_style_context().add_class("btn-nav")
        self.btn_back_home.set_tooltip_text(i18n_t("native_ubuntu.main_menu_tip"))
        self.btn_back_home.connect("clicked", lambda *_: self._show_launcher_view("home"))
        hb.pack_start(self.btn_back_home)

        self.lbl_conn_status = Gtk.Label(label=i18n_t("native_ubuntu.ready_connect"))
        self.lbl_conn_status.get_style_context().add_class("badge-local")
        hb.pack_start(self.lbl_conn_status)

        btn_dex = Gtk.Button(label=i18n_t("native_ubuntu.usb_phone_screen"))
        btn_dex.get_style_context().add_class("btn-dex")
        btn_dex.set_tooltip_text(i18n_t("native_ubuntu.usb_phone_screen_tip"))
        btn_dex.connect("clicked", lambda *_: self._connect_and_open_webview(target_view="dex"))
        hb.pack_start(btn_dex)

        btn_about = Gtk.Button.new_from_icon_name("help-about-symbolic", Gtk.IconSize.BUTTON)
        btn_about.get_style_context().add_class("btn-nav")
        btn_about.set_tooltip_text(i18n_t("native_ubuntu.about_tip", {"ver": disp_ver}))
        btn_about.connect("clicked", self._show_about_dialog)
        hb.pack_end(btn_about)

        btn_fs = Gtk.Button(label=i18n_t("native_ubuntu.fullscreen"))
        btn_fs.get_style_context().add_class("btn-nav")
        btn_fs.set_tooltip_text(i18n_t("native_ubuntu.fullscreen_tip"))
        btn_fs.connect("clicked", lambda *_: self._toggle_fullscreen())
        hb.pack_end(btn_fs)

        self.set_titlebar(hb)

    def _show_launcher_view(self, stack_name="home"):
        if self.main_stack:
            self.main_stack.set_visible_child_name(stack_name)
        is_home = (stack_name == "home")
        if hasattr(self, "btn_back_home"):
            self.btn_back_home.set_visible(not is_home)
        if is_home:
            self._set_webview_paused(True)
            self._refresh_config_labels()
            self._refresh_local_node_panel()
        else:
            self._set_webview_paused(False)

    def _navigate_spa(self, view_name):
        if self.webview and HAS_WEBKIT2:
            if not self._webview_uri_loaded:
                self._pending_nav_view = view_name
                return
            js = f"if(typeof window.switchView==='function'){{window.switchView('{view_name}');}}"
            try:
                if hasattr(self.webview, "evaluate_javascript"):
                    self.webview.evaluate_javascript(js, -1, None, None, None, None, None)
                elif hasattr(self.webview, "run_javascript"):
                    self.webview.run_javascript(js, None, None, None)
            except Exception:
                pass

    def _show_about_dialog(self, _widget):
        about = Gtk.AboutDialog(transient_for=self, modal=True)
        about.set_program_name(i18n_t("app.brand"))
        about.set_version(f"v{get_display_version()}")
        about.set_comments(i18n_t("native_ubuntu.about_comments"))
        about.set_website("https://github.com/cminewarIA/recursos-ui")
        about.set_website_label("GitHub cminewarIA/recursos-ui")
        about.set_authors(["cminewarIA"])
        about.set_license_type(Gtk.License.MIT_X11)

        logo_candidates = [
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit.png"),
            "/usr/lib/recursos-cockpit/assets/recursos-cockpit.png",
        ]
        for l_path in logo_candidates:
            if os.path.isfile(l_path):
                try:
                    pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(l_path, 128, 128, True)
                    about.set_logo(pb)
                    break
                except Exception:
                    pass
        about.run()
        about.destroy()

    def _build_main_layout(self):
        self.main_stack = Gtk.Stack()
        self.main_stack.set_transition_type(Gtk.StackTransitionType.CROSSFADE)
        self.main_stack.set_transition_duration(260)

        # Page 1: Native 3-Option Home Launcher
        home_scroll = Gtk.ScrolledWindow()
        home_scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        center_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        center_box.set_valign(Gtk.Align.CENTER)
        center_box.set_halign(Gtk.Align.CENTER)
        center_box.set_margin_top(28)
        center_box.set_margin_bottom(28)
        center_box.set_margin_start(28)
        center_box.set_margin_end(28)
        center_box.set_size_request(680, -1)

        # Header with CMineWar Logo inside Asset Hero Card
        brand_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        brand_box.set_halign(Gtk.Align.FILL)
        brand_box.get_style_context().add_class("launcher-hero")
        logo_path = resolve_static_asset_path("recursos-cockpit.png")
        if logo_path:
            try:
                pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(logo_path, 140, 140, True)
                img = Gtk.Image.new_from_pixbuf(pb)
                brand_box.pack_start(img, False, False, 0)
            except Exception:
                pass
        title_lbl = Gtk.Label(label=i18n_t("native_ubuntu.title_banner", {"ver": get_display_version()}))
        title_lbl.get_style_context().add_class("launcher-title")
        sub_lbl = Gtk.Label(label=i18n_t("native_ubuntu.choose_mode"))
        sub_lbl.get_style_context().add_class("launcher-subtitle")
        brand_box.pack_start(title_lbl, False, False, 0)
        brand_box.pack_start(sub_lbl, False, False, 0)
        center_box.pack_start(brand_box, False, False, 4)

        self.lbl_home_status = Gtk.Label(label="")
        self.lbl_home_status.set_line_wrap(True)
        self.lbl_home_status.get_style_context().add_class("launcher-subtitle")
        center_box.pack_start(self.lbl_home_status, False, False, 0)

        # Opción 1: Conectar con el nodo
        card1 = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        card1.get_style_context().add_class("launcher-card")
        c1_text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        c1_t = Gtk.Label(label=i18n_t("native_ubuntu.opt1_title"), xalign=0)
        c1_t.get_style_context().add_class("launcher-card-title")
        c1_d = Gtk.Label(
            label=i18n_t("native_ubuntu.opt1_desc"),
            xalign=0,
        )
        c1_d.set_line_wrap(True)
        c1_d.get_style_context().add_class("launcher-subtitle")
        c1_text.pack_start(c1_t, False, False, 0)
        c1_text.pack_start(c1_d, False, False, 0)
        btn_opt1 = Gtk.Button(label=i18n_t("native_ubuntu.opt1_btn"))
        btn_opt1.get_style_context().add_class("btn-primary")
        btn_opt1.set_valign(Gtk.Align.CENTER)
        btn_opt1.connect("clicked", lambda *_: self._connect_and_open_webview("inicio"))
        card1.pack_start(c1_text, True, True, 0)
        card1.pack_end(btn_opt1, False, False, 0)
        center_box.pack_start(card1, False, False, 0)

        # Opción 2: Instalar nodo local (y actualizar desde GitHub cuando ya está instalada)
        card2 = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        card2.get_style_context().add_class("launcher-card")
        c2_top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        c2_text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        c2_t = Gtk.Label(label=i18n_t("native_ubuntu.opt2_title"), xalign=0)
        c2_t.get_style_context().add_class("launcher-card-title")
        self.lbl_node_info = Gtk.Label(
            label=i18n_t("native_ubuntu.checking_local"),
            xalign=0,
        )
        self.lbl_node_info.set_line_wrap(True)
        self.lbl_node_info.get_style_context().add_class("launcher-subtitle")
        self.lbl_github_info = Gtk.Label(
            label=i18n_t("native_ubuntu.checking_github"),
            xalign=0,
        )
        self.lbl_github_info.set_line_wrap(True)
        self.lbl_github_info.get_style_context().add_class("launcher-subtitle")
        c2_text.pack_start(c2_t, False, False, 0)
        c2_text.pack_start(self.lbl_node_info, False, False, 0)
        c2_text.pack_start(self.lbl_github_info, False, False, 0)
        self.lbl_github_releases = Gtk.Label(
            label=f"GitHub · Ubuntu .deb v{get_app_version()} · Android .apk v{get_android_client_version()}",
            xalign=0,
        )
        self.lbl_github_releases.set_line_wrap(True)
        self.lbl_github_releases.get_style_context().add_class("launcher-subtitle")
        c2_text.pack_start(self.lbl_github_releases, False, False, 0)

        c2_btns = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        c2_btns.set_valign(Gtk.Align.CENTER)
        self.btn_opt2 = Gtk.Button(label=i18n_t("native_ubuntu.install_node"))
        self.btn_opt2.get_style_context().add_class("btn-nav")
        self.btn_opt2.connect("clicked", self._on_install_local_node_clicked)
        self.btn_opt2_update = Gtk.Button(label=i18n_t("native_ubuntu.update_github"))
        self.btn_opt2_update.get_style_context().add_class("btn-nav")
        self.btn_opt2_update.connect("clicked", self._on_update_from_github_clicked)
        c2_btns.pack_start(self.btn_opt2, False, False, 0)
        c2_btns.pack_start(self.btn_opt2_update, False, False, 0)

        c2_top.pack_start(c2_text, True, True, 0)
        c2_top.pack_end(c2_btns, False, False, 0)
        card2.pack_start(c2_top, False, False, 0)

        c2_dl_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_dl_deb = Gtk.Button(label=i18n_t("native_ubuntu.download_install_deb", fallback="Descargar e instalar .deb (GitHub)"))
        self.btn_dl_deb.get_style_context().add_class("btn-primary")
        self.btn_dl_deb.connect("clicked", self._on_download_deb_clicked)
        self.btn_dl_apk = Gtk.Button(label=i18n_t("native_ubuntu.download_apk_downloads", fallback="Descargar .apk en Descargas"))
        self.btn_dl_apk.get_style_context().add_class("btn-nav")
        self.btn_dl_apk.connect("clicked", self._on_download_apk_clicked)
        c2_dl_row.pack_start(self.btn_dl_deb, False, False, 0)
        c2_dl_row.pack_start(self.btn_dl_apk, False, False, 0)
        card2.pack_start(c2_dl_row, False, False, 0)
        center_box.pack_start(card2, False, False, 0)

        # Opción 3: Configuraciones (Muestra y guarda la conexión detectada desde Opción 1)
        card3 = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        card3.get_style_context().add_class("launcher-card")
        c3_header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        c3_t = Gtk.Label(label=i18n_t("native_ubuntu.opt3_title"), xalign=0)
        c3_t.get_style_context().add_class("launcher-card-title")
        c3_header.pack_start(c3_t, True, True, 0)
        btn_forget = Gtk.Button(label=i18n_t("native_ubuntu.forget_conn"))
        btn_forget.get_style_context().add_class("btn-nav")
        btn_forget.connect("clicked", self._on_forget_config_clicked)
        c3_header.pack_end(btn_forget, False, False, 0)
        card3.pack_start(c3_header, False, False, 0)

        self.lbl_cfg_lan = Gtk.Label(label=i18n_t("native_ubuntu.lan_pending"), xalign=0)
        self.lbl_cfg_dns = Gtk.Label(label=i18n_t("native_ubuntu.dns_pending"), xalign=0)
        self.lbl_cfg_cert = Gtk.Label(label=i18n_t("native_ubuntu.cert_pending"), xalign=0)
        for lbl in (self.lbl_cfg_lan, self.lbl_cfg_dns, self.lbl_cfg_cert):
            lbl.get_style_context().add_class("launcher-subtitle")
            lbl.set_selectable(True)
            card3.pack_start(lbl, False, False, 0)

        center_box.pack_start(card3, False, False, 0)
        home_scroll.add(center_box)
        self.main_stack.add_named(home_scroll, "home")

        # Page 2: WebKit2 Unified Interface (single canonical Web UI)
        initial_view = "dex" if self.start_in_dex else "inicio"
        target_uri = f"http://localhost:{self.bridge_port}/?env=ubuntu_native&view={initial_view}"

        if HAS_WEBKIT2 and WebKit2 is not None:
            ucm = None
            try:
                if hasattr(WebKit2, "UserContentManager") and hasattr(WebKit2.WebView, "new_with_user_content_manager"):
                    ucm = WebKit2.UserContentManager()
                    ucm.register_script_message_handler("recursosTheme")
                    ucm.connect("script-message-received::recursosTheme", self._on_webkit_theme_message)
            except Exception:
                ucm = None
            self.webview = (
                WebKit2.WebView.new_with_user_content_manager(ucm)
                if ucm is not None
                else WebKit2.WebView()
            )
            settings = self.webview.get_settings()
            settings.set_enable_javascript(True)
            settings.set_enable_webgl(True)
            if hasattr(settings, "set_javascript_can_open_windows_automatically"):
                settings.set_javascript_can_open_windows_automatically(True)
            if hasattr(settings, "set_enable_smooth_scrolling"):
                settings.set_enable_smooth_scrolling(True)
            if hasattr(settings, "set_user_agent"):
                settings.set_user_agent(
                    f"Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 "
                    f"(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 "
                    f"RecursosCockpit-Linux/{get_app_version()} (Ubuntu; NativeHTML)"
                )
            if hasattr(WebKit2, "HardwareAccelerationPolicy") and hasattr(
                settings, "set_hardware_acceleration_policy"
            ):
                settings.set_hardware_acceleration_policy(
                    WebKit2.HardwareAccelerationPolicy.ALWAYS
                )

            if hasattr(self.webview, "set_background_color"):
                rgba = Gdk.RGBA()
                rgba.parse("#0a140b" if self._current_theme == "dark" else "#f5f4f2")
                self.webview.set_background_color(rgba)

            self._target_webview_uri = target_uri
            self.webview.connect("load-changed", self._on_webview_load_changed)
            self.webview.connect("create", self._on_webview_create)
            # Carga diferida: no cargar HTML5/animations hasta entrar al panel o --dex (evita consumo CPU en menú inicio)
            if self.start_in_dex:
                self.webview.load_uri(target_uri)
            self.main_stack.add_named(self.webview, "webview")
        else:
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
            box.set_valign(Gtk.Align.CENTER)
            box.set_halign(Gtk.Align.CENTER)
            lbl = Gtk.Label(
                label=i18n_t(
                    "native_ubuntu.webkit_missing",
                    {"ver": get_display_version(), "uri": target_uri},
                )
            )
            box.pack_start(lbl, False, False, 0)
            self.main_stack.add_named(box, "webview")

        self.main_stack.set_visible_child_name("webview" if self.start_in_dex else "home")
        self.add(self.main_stack)

    def _trigger_github_check_async(self):
        def worker():
            gh = self.conn_mgr.check_github_app_update()
            GLib.idle_add(self._refresh_local_node_panel, gh)

        threading.Thread(target=worker, daemon=True).start()
        return False

    def _refresh_local_node_panel(self, gh_info=None):
        st = self.conn_mgr.detect_local_node_status()
        gh = gh_info or self.conn_mgr.github_update_info
        app_installed = bool(st.get("app_installed_deb") or st.get("installed"))

        if st["installed"]:
            state_txt = (
                i18n_t("native_ubuntu.local_state_active")
                if st["running"]
                else i18n_t("native_ubuntu.local_state_installed")
            )
            self.lbl_node_info.set_text(
                i18n_t(
                    "native_ubuntu.node_info_running",
                    {"state": state_txt, "ip": st["lan_ip"], "port": st["port"]},
                )
            )
            self.btn_opt2.set_label(
                i18n_t("native_ubuntu.connect_local_node")
                if st["running"]
                else i18n_t("native_ubuntu.start_local_node")
            )
        elif st.get("app_installed_deb"):
            inst_ver = get_display_version(st.get("installed_deb_version") or get_app_version())
            self.lbl_node_info.set_text(
                i18n_t("native_ubuntu.node_info_deb", {"ver": inst_ver})
            )
            self.btn_opt2.set_label(i18n_t("native_ubuntu.install_node"))
        else:
            self.lbl_node_info.set_text(i18n_t("native_ubuntu.node_info_none"))
            self.btn_opt2.set_label(i18n_t("native_ubuntu.install_node"))

        if hasattr(self, "lbl_github_info") and hasattr(self, "btn_opt2_update"):
            has_server_gap = bool(gh and gh.get("server_needs_update"))
            self.btn_opt2_update.set_visible(app_installed or has_server_gap)
            ctx = self.btn_opt2_update.get_style_context()
            ctx.remove_class("btn-primary")
            ctx.remove_class("btn-nav")
            if gh and gh.get("effective_update_available"):
                summary = gh.get("update_summary") or i18n_t(
                    "native_ubuntu.unified_update_summary", {"ver": gh.get("target_version")}
                )
                btn_lbl = gh.get("update_action_label") or i18n_t(
                    "native_ubuntu.update_app_btn", {"ver": gh.get("target_version")}
                )
                self.lbl_github_info.set_text(summary)
                self.btn_opt2_update.set_label(btn_lbl)
                ctx.add_class("btn-primary")
            elif gh and gh.get("app_above_github"):
                srv_note = (
                    i18n_t("native_ubuntu.app_ahead_srv_note", {"ver": gh.get("server_display_version")})
                    if gh.get("server_reachable")
                    else ""
                )
                self.lbl_github_info.set_text(
                    i18n_t(
                        "native_ubuntu.app_ahead_info",
                        {
                            "app": gh.get("app_display_version"),
                            "gh": gh.get("github_display_version"),
                            "srv_note": srv_note,
                        },
                    )
                )
                self.btn_opt2_update.set_label(
                    gh.get("update_action_label") or i18n_t("native_ubuntu.sync_local_web_short")
                )
                ctx.add_class("btn-nav")
            elif gh and gh.get("github_version"):
                self.lbl_github_info.set_text(
                    gh.get("update_summary")
                    or i18n_t("native_ubuntu.github_ahead_msg", {"ver": gh.get("github_display_version")})
                )
                self.btn_opt2_update.set_label(
                    gh.get("update_action_label") or i18n_t("native_ubuntu.update_reinstall_btn")
                )
                ctx.add_class("btn-nav")
            else:
                self.lbl_github_info.set_text(i18n_t("native_ubuntu.unified_update_avail"))
                self.btn_opt2_update.set_label(i18n_t("native_ubuntu.check_and_update"))
                ctx.add_class("btn-nav")

        if hasattr(self, "lbl_github_releases"):
            rel_meta = (gh or {}).get("native_releases") if isinstance(gh, dict) else None
            if isinstance(rel_meta, dict):
                deb_m = rel_meta.get("deb") or {}
                apk_m = rel_meta.get("apk") or {}
                deb_mb = f" ({deb_m.get('size_bytes', 0) / (1024 * 1024):.1f} MB)" if deb_m.get("size_bytes") else ""
                apk_mb = f" ({apk_m.get('size_bytes', 0) / (1024 * 1024):.1f} MB)" if apk_m.get("size_bytes") else ""
                tag_str = f" · {rel_meta.get('tag_name')}" if rel_meta.get("tag_name") else ""
                self.lbl_github_releases.set_text(
                    f"GitHub{tag_str} · Ubuntu .deb v{deb_m.get('version', get_app_version())}{deb_mb} · Android .apk v{apk_m.get('version', get_android_client_version())}{apk_mb}"
                )
        return False

    def _on_download_deb_clicked(self, _widget):
        if hasattr(self, "btn_dl_deb"):
            self.btn_dl_deb.set_sensitive(False)
            self.btn_dl_deb.set_label("Descargando e instalando .deb...")
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text("Descargando la última compilación .deb desde GitHub...")

        def worker():
            rel_info = self.conn_mgr.fetch_github_native_releases(force_refresh=True)
            ok, msg, _new_ver = self.conn_mgr._install_deb_from_github(rel_info, relaunch_on_deb=False, interactive=True)
            GLib.idle_add(self._on_download_deb_finished, ok, msg, rel_info)

        threading.Thread(target=worker, daemon=True).start()

    def _on_download_deb_finished(self, ok, msg, rel_info):
        if hasattr(self, "btn_dl_deb"):
            self.btn_dl_deb.set_sensitive(True)
            self.btn_dl_deb.set_label(i18n_t("native_ubuntu.download_install_deb", fallback="Descargar e instalar .deb (GitHub)"))
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text(msg)
        if ok and os.environ.get("DISPLAY"):
            GLib.timeout_add(450, self._reexec_after_update)
        return False

    def _on_download_apk_clicked(self, _widget):
        if hasattr(self, "btn_dl_apk"):
            self.btn_dl_apk.set_sensitive(False)
            self.btn_dl_apk.set_label("Descargando .apk...")
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text("Descargando la última compilación .apk desde GitHub en Descargas...")

        def worker():
            rel_info = self.conn_mgr.fetch_github_native_releases(force_refresh=True)
            ok, msg, saved_path = self.conn_mgr.download_apk_to_downloads(rel_info)
            GLib.idle_add(self._on_download_apk_finished, ok, msg, saved_path)

        threading.Thread(target=worker, daemon=True).start()

    def _on_download_apk_finished(self, ok, msg, _saved_path):
        if hasattr(self, "btn_dl_apk"):
            self.btn_dl_apk.set_sensitive(True)
            self.btn_dl_apk.set_label(i18n_t("native_ubuntu.download_apk_downloads", fallback="Descargar .apk en Descargas"))
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text(msg)
        return False

    def _on_update_from_github_clicked(self, _widget):
        if hasattr(self, "btn_opt2_update"):
            self.btn_opt2_update.set_sensitive(False)
            self.btn_opt2_update.set_label(i18n_t("native_ubuntu.updating_btn"))
        if hasattr(self, "lbl_github_info"):
            self.lbl_github_info.set_text(i18n_t("native_ubuntu.updating_desc"))

        def worker():
            ok, msg, gh, flags = self.conn_mgr.perform_unified_update(relaunch_on_deb=False, interactive=True, force_download=True)
            GLib.idle_add(self._on_github_update_finished, ok, msg, gh, flags)

        threading.Thread(target=worker, daemon=True).start()

    def _reexec_after_update(self):
        try:
            self.bridge.stop()
        except Exception:
            pass
        exe = "/usr/bin/recursos-cockpit" if os.path.isfile("/usr/bin/recursos-cockpit") else f"{sys.executable} {os.path.abspath(__file__)}"
        args = " ".join(f"'{a}'" for a in sys.argv[1:])
        cmd_str = f"sleep 0.6 && {exe} {args} >/dev/null 2>&1"
        try:
            subprocess.Popen(["bash", "-c", cmd_str], start_new_session=True)
        except Exception:
            pass
        try:
            app = self.get_application()
            if app:
                app.quit()
            else:
                self.destroy()
        except Exception:
            pass
        return False

    def _on_github_update_finished(self, ok, msg, gh, flags=None):
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text(msg)
        if hasattr(self, "btn_opt2_update"):
            self.btn_opt2_update.set_sensitive(True)
        self._refresh_local_node_panel(gh)
        if ok:
            self._refresh_config_labels()
            if isinstance(flags, dict) and flags.get("deb_installed") and os.environ.get("DISPLAY"):
                if hasattr(self, "lbl_home_status"):
                    self.lbl_home_status.set_text(i18n_t("native_ubuntu.restarting_suffix", {"msg": msg}))
                GLib.timeout_add(450, self._reexec_after_update)
        return False

    def _refresh_config_labels(self):
        lan_txt = (
            f"{self.conn_mgr.saved_host}:{self.conn_mgr.node_port}"
            if self.conn_mgr.saved_host
            else i18n_t("native_ubuntu.lan_wait")
        )
        dns_txt = (
            self.conn_mgr.wan_domain
            if self.conn_mgr.wan_domain
            else i18n_t("native_ubuntu.dns_auto")
        )
        cert_txt = (
            i18n_t("native_ubuntu.cert_ok")
            if self.conn_mgr.device_token and not self.conn_mgr.is_revoked
            else (
                i18n_t("native_ubuntu.cert_revoked")
                if self.conn_mgr.is_revoked
                else i18n_t("native_ubuntu.cert_verify_lan")
            )
        )
        self.lbl_cfg_lan.set_text(i18n_t("native_ubuntu.lan_prefix", {"value": lan_txt}))
        self.lbl_cfg_dns.set_text(i18n_t("native_ubuntu.dns_prefix", {"value": dns_txt}))
        self.lbl_cfg_cert.set_text(i18n_t("native_ubuntu.cert_prefix", {"value": cert_txt}))
        return False

    def _on_install_local_node_clicked(self, _widget):
        st = self.conn_mgr.detect_local_node_status()
        if st["installed"] and st["running"]:
            self.conn_mgr.saved_host = "127.0.0.1"
            self.conn_mgr._save_config()
            self._connect_and_open_webview("inicio")
            return
        self.lbl_node_info.set_text(i18n_t("native_ubuntu.installing_node"))

        def worker():
            ok, msg, new_st = self.conn_mgr.install_or_enable_local_node()
            GLib.idle_add(self._on_install_finished, ok, msg, new_st)

        threading.Thread(target=worker, daemon=True).start()

    def _on_install_finished(self, ok, msg, _st):
        self.lbl_home_status.set_text(msg)
        self._refresh_local_node_panel()
        if ok:
            self._refresh_config_labels()
        return False

    def _on_forget_config_clicked(self, _widget):
        self.conn_mgr.clear_saved_node()
        self.lbl_home_status.set_text(i18n_t("native_ubuntu.forgotten_msg"))
        self._refresh_config_labels()
        self._refresh_connection_badge()

    def _on_dex_status_callback(self, _status, _message):
        GLib.idle_add(self._sync_webview_session)

    def _refresh_connection_badge(self):
        mode = self.conn_mgr.connection_mode
        ctx = self.lbl_conn_status.get_style_context()
        for cls in ["badge-lan", "badge-wan", "badge-revoked", "badge-scanning", "badge-local"]:
            ctx.remove_class(cls)

        if mode == "LAN":
            ctx.add_class("badge-lan")
            self.lbl_conn_status.set_text(i18n_t("native_ubuntu.red_local", {"host": self.conn_mgr.saved_host}))
        elif mode == "WAN":
            ctx.add_class("badge-wan")
            self.lbl_conn_status.set_text(i18n_t("native_ubuntu.external_conn", {"domain": self.conn_mgr.wan_domain or "DNS"}))
        elif mode == "REVOKED":
            ctx.add_class("badge-revoked")
            self.lbl_conn_status.set_text(i18n_t("native_ubuntu.access_revoked"))
        elif mode == "LOCAL":
            ctx.add_class("badge-local")
            self.lbl_conn_status.set_text(i18n_t("native_ubuntu.no_remote_node"))
        else:
            ctx.add_class("badge-local")
            self.lbl_conn_status.set_text(i18n_t("native_ubuntu.ready_connect"))
        return True

    def _on_key_press(self, _widget, event):
        if event.keyval == Gdk.KEY_F11:
            self._toggle_fullscreen()
            return True
        if event.keyval == Gdk.KEY_F5 and self.webview:
            self.webview.reload()
            return True
        return False

    def _toggle_fullscreen(self):
        if self.is_fullscreen:
            self.unfullscreen()
            self.is_fullscreen = False
        else:
            self.fullscreen()
            self.is_fullscreen = True


class RecursosNativeApp(Gtk.Application):
    def __init__(self, start_in_dex=False):
        super().__init__(
            application_id="com.cminewar.recursoscockpit",
            flags=0,
        )
        self.win = None
        self.start_in_dex = start_in_dex

    def do_startup(self):
        Gtk.Application.do_startup(self)
        GLib.set_prgname("recursos-cockpit")
        if not GLib.get_application_name():
            GLib.set_application_name("Recursos Cockpit")

    def do_activate(self):
        if not self.win:
            self.win = RecursosNativeWindow(self, start_in_dex=self.start_in_dex)
        self.win.show_all()
        self.win.present()


def main():
    parser = argparse.ArgumentParser(description="Recursos Native Ubuntu Cockpit (GTK3 + WebKit2 HTML5)")
    parser.add_argument(
        "--test-mode",
        action="store_true",
        help="Verifica dependencias, puente HTML5, controladores DeX e inicialización para CI",
    )
    parser.add_argument(
        "--dex",
        action="store_true",
        help="Abre directamente la vista desbloqueada de proyección USB (Samsung DeX / Android Desktop)",
    )
    args, _unknown = parser.parse_known_args()

    if args.test_mode:
        dex = DexController()
        deps = dex.check_dependencies()
        env_info = detect_runtime_environment()
        conn = ServerConnectionManager()
        discovered = conn.discover_server()
        html_file = resolve_bundled_html_path()
        bridge = LocalHtmlBridgeServer(conn, dex)
        port = bridge.start()
        bridge.stop()
        print(f"[OK] Recursos Native Ubuntu HTML5 App v{get_app_version()} validated successfully.")
        print(f"[OK] Bundled Canonical HTML5 UI: {html_file} (Bridge Port Test: {port})")
        print(f"[OK] Runtime Environment Detection: {env_info}")
        print(f"[OK] DeX / Android Desktop USB Controller Ready: {deps}")
        print(
            f"[OK] Server Auto-Discovery & Zero-Trust Engine Ready: active='{discovered}', mode='{conn.connection_mode}'"
        )
        sys.exit(0)

    if not HAS_GTK:
        print(
            i18n_t("native_ubuntu.gtk_missing"),
            file=sys.stderr,
        )
        sys.exit(1)

    GLib.set_prgname("recursos-cockpit")
    GLib.set_application_name(i18n_t("app.brand"))
    app = RecursosNativeApp(start_in_dex=args.dex)
    sys.exit(app.run([sys.argv[0]]))


if __name__ == "__main__":
    main()
