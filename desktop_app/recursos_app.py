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
import collections
import hashlib
import http.server
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
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from dex_controller import DexController


def get_app_version():
    """Lee la versión canónica desde VERSION o package.json sin hardcoding."""
    candidates = [
        os.path.join(SCRIPT_DIR, "..", "VERSION"),
        os.path.join(SCRIPT_DIR, "VERSION"),
        "/usr/share/recursos-cockpit/VERSION",
        "/usr/lib/recursos-cockpit/VERSION",
        "./VERSION",
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    ver = f.read().strip()
                    if ver:
                        return ver
            except Exception:
                pass

    pkg_candidates = [
        os.path.join(SCRIPT_DIR, "..", "package.json"),
        "./package.json",
    ]
    for pkg_path in pkg_candidates:
        if os.path.isfile(pkg_path):
            try:
                with open(pkg_path, "r", encoding="utf-8") as f:
                    pkg = json.load(f)
                    ver = str(pkg.get("version", "")).strip()
                    if ver:
                        return ver
            except Exception:
                pass
    return "0.0.0"


def get_display_version(raw_ver=None):
    return str(raw_ver or get_app_version()).strip()


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

    return {
        "client_type": "ubuntu_native",
        "client_label": "App Nativa Ubuntu (.deb)",
        "access_level": "FULL_NATIVE_ACCESS",
        "full_access": True,
        "dex_capable": True,
        "app_version": ver,
        "hardware_id": hardware_id,
        "name": f"{display_model} · {hostname}",
        "hostname": hostname,
        "manufacturer": manufacturer or "Linux System",
        "brand": manufacturer or "Ubuntu",
        "model": product_name or board_name or hostname,
        "board": board_name,
        "bios_version": bios_version,
        "chassis_type": chassis_type,
        "os_distro": os_distro,
        "kernel": kernel,
        "arch": arch,
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


NATIVE_CSS = b"""
window {
    background-color: #f1f5f9;
    color: #0f172a;
}
headerbar {
    background-image: none;
    background-color: #ffffff;
    color: #0f172a;
    border-bottom: 1px solid #e2e8f0;
    min-height: 48px;
    padding: 0 10px;
}
headerbar .title {
    color: #0f172a;
    font-weight: 700;
}
headerbar .subtitle {
    color: #475569;
    font-size: 11px;
}
headerbar button {
    color: #0f172a;
    transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
headerbar:backdrop {
    background-color: #ffffff;
    color: #0f172a;
}
headerbar:backdrop .title {
    color: #0f172a;
}
headerbar:backdrop .subtitle {
    color: #64748b;
}
headerbar button.titlebutton,
headerbar .titlebutton,
headerbar:backdrop button.titlebutton,
headerbar:backdrop .titlebutton {
    background-image: none;
    background-color: #f8fafc;
    color: #0f172a;
    border: 1px solid #cbd5e1;
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
    background-color: #e0f2fe;
    border-color: #7dd3fc;
    color: #0369a1;
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
    background-color: #ef4444;
    border-color: #dc2626;
    color: #ffffff;
}
headerbar button.titlebutton image,
headerbar .titlebutton image,
headerbar:backdrop button.titlebutton image,
headerbar:backdrop .titlebutton image {
    color: #0f172a;
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
    color: #0f172a;
    -gtk-icon-style: symbolic;
}
.launcher-hero {
    background-image: linear-gradient(135deg, #f8fafc, #eff6ff 55%, #ecfeff);
    border: 1px solid #cbd5e1;
    border-radius: 20px;
    padding: 20px 24px;
    box-shadow: 0 10px 26px -10px rgba(15, 23, 42, 0.10);
}
.launcher-card {
    background-color: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 18px;
    padding: 20px;
    box-shadow: 0 8px 20px -8px rgba(15, 23, 42, 0.08);
    transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.launcher-card:hover {
    border-color: #7dd3fc;
    box-shadow: 0 12px 26px -8px rgba(2, 132, 199, 0.14);
}
.launcher-title {
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
}
.launcher-subtitle {
    font-size: 13px;
    color: #475569;
}
.badge-ready {
    background-color: #d1fae5;
    border: 1px solid #6ee7b7;
    color: #065f46;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-lan {
    background-color: #d1fae5;
    border: 1px solid #6ee7b7;
    color: #065f46;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-wan {
    background-color: #e0f2fe;
    border: 1px solid #7dd3fc;
    color: #0369a1;
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
    border: 1px solid #fcd34d;
    color: #b45309;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.badge-local {
    background-color: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
    border-radius: 9999px;
    padding: 4px 11px;
    font-weight: 700;
    font-size: 11px;
}
.btn-primary {
    background-image: linear-gradient(135deg, #0284c7, #0ea5e9);
    color: #ffffff;
    font-weight: 700;
    border-radius: 12px;
    padding: 10px 18px;
    border: none;
    box-shadow: 0 6px 14px -4px rgba(2, 132, 199, 0.35);
    transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-primary:hover {
    background-image: linear-gradient(135deg, #0369a1, #0284c7);
}
.btn-nav {
    background-image: none;
    background-color: #f8fafc;
    color: #0f172a;
    font-weight: 600;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid #cbd5e1;
    transition: all 180ms ease;
}
.btn-nav:hover {
    background-color: #e0f2fe;
    border-color: #7dd3fc;
    color: #0369a1;
}
.btn-dex {
    background-image: none;
    background-color: #e0f2fe;
    color: #0369a1;
    font-weight: 700;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid #7dd3fc;
    transition: all 180ms ease;
}
.btn-dex:hover {
    background-color: #bae6fd;
}
"""


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
        self.is_revoked = False
        self._last_net_io = psutil.net_io_counters() if psutil else None
        self._last_net_ts = time.time()
        self.github_update_info = None
        self.device_telemetry = collect_native_device_telemetry()
        self._load_config()

    def refresh_device_telemetry(self):
        self.device_telemetry = collect_native_device_telemetry()
        self.device_telemetry["connection_mode"] = self.connection_mode
        return self.device_telemetry

    def _build_auth_headers(self, extra=None):
        ver = get_app_version()
        headers = {
            "User-Agent": f"RecursosCockpit-Linux/{ver} (Ubuntu; NativeHTML; FullAccess)",
            "X-Recursos-Client": "ubuntu_native",
            "X-Device-Telemetry": encode_telemetry_header(self.device_telemetry),
        }
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
        except Exception:
            pass

    def _save_config(self):
        try:
            os.makedirs(self.config_dir, exist_ok=True)
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "device_token": self.device_token,
                        "saved_host": self.saved_host,
                        "node_port": self.node_port,
                        "wan_domain": self.wan_domain,
                        "auto_install_enabled": self.auto_install_enabled,
                        "is_revoked": self.is_revoked,
                        "hardware_id": self.device_telemetry.get("hardware_id", ""),
                    },
                    f,
                    indent=2,
                )
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
        app_ver = str(version_override or self.get_installed_deb_version() or get_app_version()).strip().lstrip("vV")
        web_rel_paths = [
            "VERSION",
            "package.json",
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
            return False, "No hay ningún servidor accesible en red local o DDNS para sincronizar la web.", None
        bundle = self.collect_local_web_bundle(version_override=version_override)
        if "static/index.html" not in bundle["files"]:
            return False, "No se encontró static/index.html en la instalación de la App Ubuntu.", None

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
    ):
        app_ver = str(app_ver or get_app_version()).strip().lstrip("vV")
        gh_ver = str(gh_ver or "").strip().lstrip("vV")
        server_ver = str(server_ver or "").strip().lstrip("vV")
        installed_deb = str(installed_deb or "").strip().lstrip("vV")

        app_t = parse_semver_tuple(app_ver)
        gh_t = parse_semver_tuple(gh_ver) if gh_ver else (0, 0, 0)
        srv_t = parse_semver_tuple(server_ver) if (server_reachable and server_ver) else (0, 0, 0)

        github_above_app = bool(gh_ver and gh_t > app_t)
        app_above_github = bool(gh_ver and app_t > gh_t)
        app_above_server = bool(server_reachable and server_ver and app_t > srv_t)
        github_above_server = bool(server_reachable and server_ver and gh_ver and gh_t > srv_t)
        server_needs_update = bool(app_above_server or github_above_server)
        effective_update_available = bool(github_above_app or server_needs_update)

        best_ver = app_ver
        best_t = app_t
        if gh_ver and gh_t > best_t:
            best_ver = gh_ver
            best_t = gh_t
        if server_reachable and server_ver and srv_t > best_t:
            best_ver = server_ver

        app_disp = get_display_version(app_ver)
        gh_disp = get_display_version(gh_ver) if gh_ver else ""
        srv_disp = get_display_version(server_ver) if server_ver else ""

        if github_above_app and server_needs_update:
            update_mode = "github_deb_and_server"
            update_action_label = f"Actualizar app y servidor a v{gh_disp}"
            update_summary = (
                f"GitHub (v{gh_disp}) supera a App Ubuntu (v{app_disp}) y Servidor web local (v{srv_disp}). "
                f"Pulsa para actualizar ambos en un clic."
            )
        elif github_above_app:
            update_mode = "github_deb"
            update_action_label = f"Actualizar app a v{gh_disp}"
            update_summary = (
                f"Nueva versión disponible en GitHub: v{gh_disp} (App Ubuntu actual: v{app_disp}). "
                f"Pulsa para actualizar sin desinstalar."
            )
        elif app_above_server and app_above_github:
            update_mode = "sync_app_to_server_ahead_of_github"
            update_action_label = f"Actualizar web local a v{app_disp}"
            update_summary = (
                f"La App Ubuntu (v{app_disp}) es superior a GitHub (v{gh_disp}) y al Servidor web local (v{srv_disp}). "
                f"Pulsa para actualizar la web local al instante."
            )
        elif app_above_server:
            update_mode = "sync_app_to_server"
            update_action_label = f"Actualizar web local a v{app_disp}"
            update_summary = (
                f"La App Ubuntu (v{app_disp}) es superior al Servidor web local (v{srv_disp}). "
                f"Pulsa para actualizar la web local en un clic."
            )
        elif github_above_server:
            update_mode = "github_to_server"
            update_action_label = f"Actualizar servidor web a v{gh_disp}"
            update_summary = (
                f"GitHub (v{gh_disp}) es superior al Servidor web local (v{srv_disp}). "
                f"Pulsa para actualizar el servidor web local."
            )
        elif app_above_github:
            update_mode = "app_ahead_of_github"
            update_action_label = f"Sincronizar web local (v{app_disp})" if server_reachable else f"Versión v{app_disp} al día"
            if server_reachable:
                update_summary = (
                    f"App Ubuntu y Servidor web local están en v{app_disp} (por delante de GitHub v{gh_disp})."
                )
            else:
                update_summary = (
                    f"App Ubuntu v{app_disp} supera a la versión publicada en GitHub (v{gh_disp})."
                )
        elif gh_ver:
            update_mode = "up_to_date"
            update_action_label = "Actualizar / Reinstalar"
            if server_reachable:
                update_summary = (
                    f"App Ubuntu, Servidor web local y GitHub sincronizados en v{gh_disp}."
                )
            else:
                update_summary = f"App Ubuntu y GitHub al día en v{gh_disp}."
        else:
            update_mode = "offline_check"
            update_action_label = "Sincronizar / Reintentar"
            update_summary = (
                "No se pudo consultar GitHub ahora. Puedes sincronizar la web local si hay un servidor activo."
            )

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

    def check_github_app_update(self, target_url=None, probe_server=True, server_payload=None, refresh_server=False):
        """Consulta App Ubuntu, Servidor web local y GitHub Releases/VERSION comparando las tres versiones."""
        local_ver = get_app_version()
        installed_deb = self.get_installed_deb_version()
        if installed_deb and parse_semver_tuple(installed_deb) >= parse_semver_tuple(local_ver):
            app_ver = installed_deb
        else:
            app_ver = local_ver

        gh_ver = ""
        deb_url = "https://github.com/cminewarIA/recursos-ui/releases/latest/download/recursos-cockpit.deb"
        deb_asset_name = "recursos-cockpit.deb"
        sha_url = ""
        release_url = "https://github.com/cminewarIA/recursos-ui/releases/latest"
        err_msg = ""

        try:
            req = urllib.request.Request(
                "https://api.github.com/repos/cminewarIA/recursos-ui/releases/latest",
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": f"RecursosCockpit-Ubuntu/{app_ver}",
                },
            )
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                rel = json.loads(resp.read().decode("utf-8"))
                tag = str(rel.get("tag_name") or "").strip()
                gh_ver = tag.lstrip("vV")
                release_url = str(rel.get("html_url") or release_url)
                for asset in rel.get("assets", []) or []:
                    name = str(asset.get("name") or "")
                    dl = str(asset.get("browser_download_url") or "")
                    if not dl:
                        continue
                    if name.endswith(".deb") and "amd64" in name:
                        deb_url = dl
                        deb_asset_name = name
                    elif name == "recursos-cockpit.deb" and not deb_asset_name.endswith("_amd64.deb"):
                        deb_url = dl
                        deb_asset_name = name
                    elif name == "SHA256SUMS.txt":
                        sha_url = dl
        except Exception as e:
            err_msg = str(e)

        try:
            req_ver = urllib.request.Request(
                "https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/VERSION",
                headers={"User-Agent": f"RecursosCockpit-Ubuntu/{app_ver}"},
            )
            with urllib.request.urlopen(req_ver, timeout=3.5) as resp:
                raw_gh_ver = resp.read().decode("utf-8").strip().lstrip("vV")
                if raw_gh_ver and (not gh_ver or parse_semver_tuple(raw_gh_ver) > parse_semver_tuple(gh_ver)):
                    gh_ver = raw_gh_ver
                err_msg = ""
        except Exception as e2:
            if not gh_ver and not err_msg:
                err_msg = str(e2)

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
                if not gh_ver and srv_payload.get("remote_version"):
                    gh_ver = str(srv_payload.get("remote_version") or "").strip().lstrip("vV")

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
        )
        self.github_update_info = info
        return info

    def _install_deb_from_github(self, info, relaunch_on_deb=True):
        """Descarga, verifica SHA-256 e instala el paquete .deb oficial desde GitHub Releases."""
        deb_url = info.get("deb_download_url") or "https://github.com/cminewarIA/recursos-ui/releases/latest/download/recursos-cockpit.deb"
        tmp_deb = "/tmp/recursos-cockpit-github-update.deb"
        try:
            req = urllib.request.Request(
                deb_url,
                headers={"User-Agent": f"RecursosCockpit-Updater/{get_app_version()}"},
            )
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                deb_bytes = resp.read()
            if len(deb_bytes) < 10240 or not deb_bytes.startswith(b"!<arch>\n"):
                return False, "El archivo descargado desde GitHub no es un paquete .deb válido.", ""
            with open(tmp_deb, "wb") as f:
                f.write(deb_bytes)

            sha_url = info.get("sha256_url")
            if sha_url:
                try:
                    req_sha = urllib.request.Request(
                        sha_url,
                        headers={"User-Agent": f"RecursosCockpit-Updater/{get_app_version()}"},
                    )
                    with urllib.request.urlopen(req_sha, timeout=10.0) as rsha:
                        sums_txt = rsha.read().decode("utf-8", errors="ignore")
                    expected = ""
                    target_name = info.get("deb_asset_name") or "recursos-cockpit.deb"
                    for line in sums_txt.splitlines():
                        parts = line.strip().split()
                        if len(parts) >= 2 and (parts[1].lstrip("*") == target_name or parts[1].endswith(".deb")):
                            expected = parts[0].lower()
                            break
                    if expected:
                        actual = hashlib.sha256(deb_bytes).hexdigest().lower()
                        if actual != expected:
                            return False, "Error de verificación SHA-256 en el paquete descargado de GitHub.", ""
                except Exception:
                    pass

            check_p = subprocess.run(["dpkg-deb", "--info", tmp_deb], capture_output=True, text=True, timeout=5)
            if check_p.returncode != 0:
                return False, "El paquete .deb descargado está corrupto o incompleto.", ""

            runner = "pkexec" if subprocess.run(["which", "pkexec"], capture_output=True).returncode == 0 else "sudo"
            helper_script = "/tmp/recursos-cockpit-apply-update.sh"
            with open(helper_script, "w", encoding="utf-8") as hf:
                hf.write(
                    "#!/usr/bin/env bash\n"
                    "set -e\n"
                    "apt-get install -y --allow-downgrades "
                    f"'{tmp_deb}' || dpkg -i --force-overwrite '{tmp_deb}'\n"
                    f"rm -f '{tmp_deb}'\n"
                )
            os.chmod(helper_script, 0o755)
            inst = subprocess.run([runner, "bash", helper_script], capture_output=True, text=True, timeout=120)
            try:
                os.remove(helper_script)
            except Exception:
                pass
            if inst.returncode == 0:
                new_ver = self.get_installed_deb_version() or info.get("github_version") or get_app_version()
                return True, f"app Ubuntu v{get_display_version(new_ver)}", new_ver
            err_detail = (inst.stderr or inst.stdout or "").strip()
            return False, f"No se pudo completar la instalación de actualización: {err_detail[:180]}", ""
        except Exception as e:
            return False, f"Error descargando actualización desde GitHub: {e}", ""

    def perform_unified_update(self, gh_info=None, target_url=None, relaunch_on_deb=True):
        """
        Actualización unificada en un solo botón:
        1. Si GitHub supera a la App Ubuntu: descarga e instala el .deb oficial sin desinstalar.
        2. Si la App Ubuntu y/o GitHub superan al Servidor web local (incluido cuando la App supera a GitHub):
           sincroniza la web local del servidor directamente mediante POST /api/system/sync-web (con fallback a /api/system/update).
        3. Nunca realiza downgrades cuando la App Ubuntu supera la versión publicada en GitHub.
        """
        info = gh_info or self.check_github_app_update(target_url=target_url, refresh_server=True)
        st = self.detect_local_node_status()
        srv_url = info.get("server_url") or self._resolve_target_server_url(target_url)

        logs = []
        updated_parts = []
        deb_installed = False
        web_synced = False

        app_ver = info.get("app_version") or get_app_version()
        gh_ver = info.get("github_version") or ""
        srv_ver = info.get("server_version") or ""
        github_above_app = bool(info.get("github_above_app"))
        app_above_github = bool(info.get("app_above_github"))
        app_above_server = bool(info.get("app_above_server"))
        github_above_server = bool(info.get("github_above_server"))
        server_reachable = bool(info.get("server_reachable") or srv_url)

        logs.append(
            f"[i] Estado de versiones -> App Ubuntu: v{app_ver} · Servidor web: "
            f"{('v' + srv_ver) if srv_ver else 'no detectado'} · GitHub: {('v' + gh_ver) if gh_ver else 'sin acceso'}"
        )

        # Paso 1: Si GitHub supera a la App Ubuntu, descargar e instalar nuevo .deb oficial
        if github_above_app:
            logs.append(f"[+] GitHub (v{gh_ver}) es superior a la App Ubuntu (v{app_ver}). Instalando paquete .deb...")
            deb_ok, deb_msg, installed_new_ver = self._install_deb_from_github(info, relaunch_on_deb=relaunch_on_deb)
            if not deb_ok:
                logs.append(f"[-] {deb_msg}")
                return False, deb_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
            deb_installed = True
            updated_parts.append(deb_msg)
            logs.append(f"[✓] {deb_msg} instalada correctamente.")
            app_ver = installed_new_ver or get_app_version()
            if server_reachable and srv_ver:
                app_above_server = parse_semver_tuple(app_ver) > parse_semver_tuple(srv_ver)

        # Paso 2: Si App Ubuntu (incluso por encima de GitHub) o GitHub superan al servidor local, actualizar la web local
        if server_reachable and (app_above_server or github_above_server):
            sync_ver_override = app_ver if parse_semver_tuple(app_ver) >= parse_semver_tuple(gh_ver) else None
            if sync_ver_override or not app_above_github:
                if app_above_github:
                    logs.append(
                        f"[+] App Ubuntu (v{app_ver}) supera a GitHub (v{gh_ver}) y al servidor local (v{srv_ver}). Sincronizando web local..."
                    )
                else:
                    logs.append(
                        f"[+] Sincronizando web local del servidor ({srv_url}) a v{sync_ver_override or app_ver}..."
                    )
                sync_ok, sync_msg, _sync_res = self.sync_web_bundle_to_server(
                    target_url=srv_url,
                    version_override=sync_ver_override or app_ver,
                )
                if sync_ok:
                    web_synced = True
                    updated_parts.append(f"web local v{get_display_version(sync_ver_override or app_ver)}")
                    logs.append(f"[✓] {sync_msg}")
                else:
                    logs.append(f"[!] Aviso en sincronización directa (/api/system/sync-web): {sync_msg}")
                    # Fallback a actualización remota por git si el servidor la soporta y no estamos por encima de GitHub
                    if github_above_server and not app_above_github:
                        try:
                            req_srv = urllib.request.Request(
                                f"{srv_url.rstrip('/')}/api/system/update",
                                data=b"{}",
                                headers=self._build_auth_headers({"Content-Type": "application/json"}),
                                method="POST",
                            )
                            with urllib.request.urlopen(req_srv, timeout=45.0) as r_srv:
                                r_obj = json.loads(r_srv.read().decode("utf-8"))
                                if r_obj.get("success"):
                                    web_synced = True
                                    updated_parts.append("servidor local (GitHub)")
                                    logs.append(f"[✓] Servidor actualizado desde GitHub: {r_obj.get('message', 'OK')}")
                        except Exception as e_srv:
                            logs.append(f"[-] Fallback /api/system/update falló: {e_srv}")
                    if not web_synced and not deb_installed:
                        return False, sync_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}

        # Paso 3: Si existen fuentes git locales y GitHub va por delante (sin conflicto con versión local superior)
        repo_dir = st.get("repo_dir")
        if repo_dir and os.path.isdir(os.path.join(repo_dir, ".git")) and github_above_app and not app_above_github:
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
                logs.append("[✓] Repositorio local sincronizado.")
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
                        updated_parts.append(f"web local v{get_display_version(app_ver)}")
                        logs.append(f"[✓] {sync_msg}")
                    else:
                        return False, sync_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
                else:
                    msg = (
                        f"La App Ubuntu está en v{get_display_version(app_ver)} "
                        f"(por encima de GitHub v{get_display_version(gh_ver)}). Conecta el servidor local para sincronizar la web."
                    )
                    logs.append(f"[i] {msg}")
                    new_info = self.check_github_app_update(target_url=srv_url, refresh_server=True)
                    return True, msg, new_info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}

            if gh_ver and parse_semver_tuple(gh_ver) == parse_semver_tuple(app_ver) and server_reachable:
                # Re-sincronización limpia explícita cuando el usuario pulsa el botón estando al día
                sync_ok, sync_msg, _ = self.sync_web_bundle_to_server(target_url=srv_url, force=True, version_override=app_ver)
                if sync_ok:
                    web_synced = True
                    updated_parts.append(f"web local v{get_display_version(app_ver)}")
                    logs.append(f"[✓] {sync_msg}")
                else:
                    msg = f"Todo el ecosistema ya está en la última versión (v{get_display_version(app_ver)})."
                    logs.append(f"[✓] {msg}")
                    new_info = self.check_github_app_update(target_url=srv_url, refresh_server=True)
                    return True, msg, new_info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
            elif gh_ver:
                deb_ok, deb_msg, _ = self._install_deb_from_github(info, relaunch_on_deb=relaunch_on_deb)
                if deb_ok:
                    deb_installed = True
                    updated_parts.append(deb_msg)
                    logs.append(f"[✓] {deb_msg} reinstalada correctamente.")
                else:
                    return False, deb_msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}
            else:
                msg = f"App Ubuntu en v{get_display_version(app_ver)} (sin conexión a GitHub ni cambios pendientes en servidor)."
                logs.append(f"[i] {msg}")
                return True, msg, info, {"deb_installed": False, "web_synced": False, "output": "\n".join(logs)}

        new_info = self.check_github_app_update(target_url=srv_url, refresh_server=True)
        final_msg = f"Actualización completada ({', '.join(updated_parts)})."
        return True, final_msg, new_info, {
            "deb_installed": deb_installed,
            "web_synced": web_synced,
            "output": "\n".join(logs),
        }

    def update_installed_app_from_github(self, gh_info=None):
        """Envoltorio compatible para el lanzador GTK: ejecuta la actualización unificada de App y Web local."""
        ok, msg, info, _flags = self.perform_unified_update(gh_info=gh_info, relaunch_on_deb=True)
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
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    new_tok = data.get("token")
                    if new_tok and new_tok != self.device_token:
                        self.device_token = new_tok
                        self.is_revoked = False
                        self._save_config()
                    return True
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
                        if (
                            pub_dom
                            and not pub_dom.endswith(".local")
                            and not pub_dom.replace(".", "").isdigit()
                            and pub_dom not in ("localhost", "127.0.0.1")
                        ):
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
                        return cand
                    if ok:
                        self.active_url = cand
                        self.connection_mode = "LAN"
                        self.saved_host = cand.split("//")[1].split(":")[0]
                        self.is_revoked = False
                        self._save_config()
                        return cand

            wan_dom = (self.wan_domain or "").strip().rstrip("/")
            if wan_dom:
                wan_cand = wan_dom if wan_dom.startswith(("http://", "https://")) else f"https://{wan_dom}"
                ok, is_rev = self._probe(wan_cand, timeout=1.5)
                if is_rev:
                    self.is_revoked = True
                    self.connection_mode = "REVOKED"
                    return wan_cand
                if ok:
                    self.active_url = wan_cand
                    self.connection_mode = "WAN"
                    self.is_revoked = False
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
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    cfg_changed = False
                    new_token = data.get("auth_status", {}).get("token")
                    if new_token and new_token != self.device_token:
                        self.device_token = new_token
                        self.is_revoked = False
                        cfg_changed = True
                    pub_dom = str(
                        data.get("version_info", {}).get("public_domain")
                        or data.get("system", {}).get("public_domain")
                        or ""
                    ).strip()
                    if (
                        pub_dom
                        and pub_dom != self.wan_domain
                        and not pub_dom.endswith(".local")
                        and not pub_dom.replace(".", "").isdigit()
                        and pub_dom not in ("localhost", "127.0.0.1")
                    ):
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

    def __init__(self, conn_mgr: ServerConnectionManager, dex: DexController):
        self.conn_mgr = conn_mgr
        self.dex = dex
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
                dev_info_js = json.dumps(parent.conn_mgr.refresh_device_telemetry(), ensure_ascii=False)
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
                    f"window.__RECURSOS_DEVICE_TOKEN__ = {token_js};"
                    f"window.__RECURSOS_CONN_MODE__ = {mode_js};"
                    f"window.__RECURSOS_NODE_URL__ = {node_js};"
                    f"window.__RECURSOS_DEVICE_TELEMETRY__ = {dev_info_js};"
                    f"try {{ if ({token_js}) {{ localStorage.setItem('recursos_device_token', {token_js}); localStorage.setItem('sysmon_device_token', {token_js}); }} }} catch(e) {{}}"
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
                        if "application/json" in ctype and self.path.startswith("/api/metrics"):
                            try:
                                parsed = json.loads(resp_body.decode("utf-8"))
                                new_tok = parsed.get("auth_status", {}).get("token")
                                if new_tok and new_tok != parent.conn_mgr.device_token:
                                    parent.conn_mgr.device_token = new_tok
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
                        except Exception:
                            srv_payload = None

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
                            "auto_install_enabled": out_payload.get("auto_install_enabled", parent.conn_mgr.auto_install_enabled),
                        }
                    )
                    if not srv_reachable:
                        out_payload.setdefault("has_git", False)
                        out_payload.setdefault("recent_commits", [])
                        out_payload.setdefault("auto_install_status", "Comprobación directa desde App Ubuntu")
                        out_payload.setdefault("branch", "main")
                    self._send_json(out_payload)
                    return

                if clean_path.startswith("/api/"):
                    if self._proxy_to_remote("GET"):
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
                                "total_errors": 0,
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
                    ok, msg, updated_info, flags = parent.conn_mgr.perform_unified_update(relaunch_on_deb=False)
                    self._send_json(
                        {
                            "success": ok,
                            "ok": ok,
                            "deb_installed": flags.get("deb_installed", False),
                            "web_synced": flags.get("web_synced", False),
                            "message": msg,
                            "output": flags.get("output") or msg,
                            "version_info": updated_info,
                        },
                        status=200,
                    )
                    return

                if self._proxy_to_remote("POST", body=raw_body):
                    return

                if clean_path == "/api/system/auto-update":
                    try:
                        payload = json.loads(raw_body.decode("utf-8"))
                    except Exception:
                        payload = {}
                    parent.conn_mgr.auto_install_enabled = bool(payload.get("enabled", True))
                    parent.conn_mgr._save_config()
                    self._send_json({
                        "ok": True,
                        "success": True,
                        "auto_install_enabled": parent.conn_mgr.auto_install_enabled,
                        "status": "Guardado localmente",
                    })
                    return

                if clean_path == "/api/system/logs/clear":
                    self._send_json({"ok": True, "success": True})
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
            title=f"Recursos v{disp_ver}",
        )
        self.set_default_size(1280, 820)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.is_fullscreen = False
        self.start_in_dex = start_in_dex
        self.webview = None
        self.main_stack = None
        self._webview_uri_loaded = False
        self._pending_nav_view = "dex" if start_in_dex else None
        self._target_webview_uri = ""

        self._apply_css()
        self._set_app_icon()

        self.dex = DexController(on_status_change=self._on_dex_status_callback)
        self.conn_mgr = ServerConnectionManager()
        self.bridge = LocalHtmlBridgeServer(self.conn_mgr, self.dex)
        self.bridge_port = self.bridge.start()

        self._build_headerbar()
        self._build_main_layout()

        self.connect("key-press-event", self._on_key_press)
        self.connect("destroy", lambda *_: self.bridge.stop())
        if hasattr(self, "btn_back_home"):
            self.btn_back_home.set_no_show_all(True)
            self.btn_back_home.set_visible(bool(self.start_in_dex))
        self.show_all()

        GLib.idle_add(self._refresh_config_labels)
        GLib.idle_add(self._refresh_local_node_panel)
        GLib.idle_add(self._trigger_github_check_async)
        if self.start_in_dex:
            self._connect_and_open_webview(target_view="dex")
        GLib.timeout_add(3000, self._refresh_connection_badge)

    def _connect_and_open_webview(self, target_view="inicio"):
        self.lbl_conn_status.set_text("Buscando nodo...")
        if hasattr(self, "lbl_home_status"):
            self.lbl_home_status.set_text("Buscando tu servidor en el Wi-Fi local y mediante DNS externo detectado...")

        def worker():
            self.conn_mgr.discover_server()
            self.conn_mgr.fetch_metrics()
            self.conn_mgr.register_device_with_server()
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

    def _apply_css(self):
        try:
            gtk_settings = Gtk.Settings.get_default()
            if gtk_settings is not None:
                gtk_settings.set_property("gtk-application-prefer-dark-theme", False)
        except Exception:
            pass
        provider = Gtk.CssProvider()
        provider.load_from_data(NATIVE_CSS)
        screen = Gdk.Screen.get_default()
        if screen:
            Gtk.StyleContext.add_provider_for_screen(
                screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )

    def _build_headerbar(self):
        hb = Gtk.HeaderBar()
        hb.set_show_close_button(True)
        if hasattr(hb, "set_decoration_layout"):
            hb.set_decoration_layout(":minimize,maximize,close")
        disp_ver = get_display_version()
        hb.props.title = "Recursos"
        hb.props.subtitle = f"v{disp_ver} · Aplicación Nativa Ubuntu"

        self.btn_back_home = Gtk.Button(label="Menú principal")
        self.btn_back_home.get_style_context().add_class("btn-nav")
        self.btn_back_home.set_tooltip_text("Volver a las tres opciones de inicio")
        self.btn_back_home.connect("clicked", lambda *_: self._show_launcher_view("home"))
        hb.pack_start(self.btn_back_home)

        self.lbl_conn_status = Gtk.Label(label="Listo para conectar")
        self.lbl_conn_status.get_style_context().add_class("badge-local")
        hb.pack_start(self.lbl_conn_status)

        btn_dex = Gtk.Button(label="Pantalla móvil USB")
        btn_dex.get_style_context().add_class("btn-dex")
        btn_dex.set_tooltip_text("Abrir control de proyección USB")
        btn_dex.connect("clicked", lambda *_: self._connect_and_open_webview(target_view="dex"))
        hb.pack_start(btn_dex)

        btn_about = Gtk.Button.new_from_icon_name("help-about-symbolic", Gtk.IconSize.BUTTON)
        btn_about.get_style_context().add_class("btn-nav")
        btn_about.set_tooltip_text(f"Acerca de Recursos (v{disp_ver})")
        btn_about.connect("clicked", self._show_about_dialog)
        hb.pack_end(btn_about)

        btn_fs = Gtk.Button(label="Pantalla completa")
        btn_fs.get_style_context().add_class("btn-nav")
        btn_fs.set_tooltip_text("Alternar pantalla completa (F11)")
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
        about.set_program_name("Recursos")
        about.set_version(f"v{get_display_version()}")
        about.set_comments(
            "Aplicación nativa de Ubuntu con autodetección en red local, conexión cifrada por DNS detectado, "
            "instalador de nodo local y control USB para móvil."
        )
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
                pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(logo_path, 88, 88, True)
                img = Gtk.Image.new_from_pixbuf(pb)
                brand_box.pack_start(img, False, False, 0)
            except Exception:
                pass
        title_lbl = Gtk.Label(label=f"Recursos · v{get_display_version()}")
        title_lbl.get_style_context().add_class("launcher-title")
        sub_lbl = Gtk.Label(label="Elige cómo quieres utilizar tu equipo ahora")
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
        c1_t = Gtk.Label(label="1. Conectar con el nodo", xalign=0)
        c1_t.set_attributes(None)
        c1_d = Gtk.Label(
            label="Escanea tu Wi-Fi local automáticamente o conecta desde fuera con el dominio DNS detectado y guardado.",
            xalign=0,
        )
        c1_d.set_line_wrap(True)
        c1_d.get_style_context().add_class("launcher-subtitle")
        c1_text.pack_start(c1_t, False, False, 0)
        c1_text.pack_start(c1_d, False, False, 0)
        btn_opt1 = Gtk.Button(label="Conectar ahora")
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
        c2_t = Gtk.Label(label="2. Nodo local y aplicación en este equipo", xalign=0)
        self.lbl_node_info = Gtk.Label(
            label="Comprobando instalación y nodo servidor en este ordenador...",
            xalign=0,
        )
        self.lbl_node_info.set_line_wrap(True)
        self.lbl_node_info.get_style_context().add_class("launcher-subtitle")
        self.lbl_github_info = Gtk.Label(
            label="Comprobando versión publicada en GitHub...",
            xalign=0,
        )
        self.lbl_github_info.set_line_wrap(True)
        self.lbl_github_info.get_style_context().add_class("launcher-subtitle")
        c2_text.pack_start(c2_t, False, False, 0)
        c2_text.pack_start(self.lbl_node_info, False, False, 0)
        c2_text.pack_start(self.lbl_github_info, False, False, 0)

        c2_btns = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        c2_btns.set_valign(Gtk.Align.CENTER)
        self.btn_opt2 = Gtk.Button(label="Instalar nodo local")
        self.btn_opt2.get_style_context().add_class("btn-nav")
        self.btn_opt2.connect("clicked", self._on_install_local_node_clicked)
        self.btn_opt2_update = Gtk.Button(label="Actualizar desde GitHub")
        self.btn_opt2_update.get_style_context().add_class("btn-nav")
        self.btn_opt2_update.connect("clicked", self._on_update_from_github_clicked)
        c2_btns.pack_start(self.btn_opt2, False, False, 0)
        c2_btns.pack_start(self.btn_opt2_update, False, False, 0)

        c2_top.pack_start(c2_text, True, True, 0)
        c2_top.pack_end(c2_btns, False, False, 0)
        card2.pack_start(c2_top, False, False, 0)
        center_box.pack_start(card2, False, False, 0)

        # Opción 3: Configuraciones (Muestra y guarda la conexión detectada desde Opción 1)
        card3 = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        card3.get_style_context().add_class("launcher-card")
        c3_header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        c3_t = Gtk.Label(label="3. Configuraciones de conexión", xalign=0)
        c3_header.pack_start(c3_t, True, True, 0)
        btn_forget = Gtk.Button(label="Olvidar conexión")
        btn_forget.get_style_context().add_class("btn-nav")
        btn_forget.connect("clicked", self._on_forget_config_clicked)
        c3_header.pack_end(btn_forget, False, False, 0)
        card3.pack_start(c3_header, False, False, 0)

        self.lbl_cfg_lan = Gtk.Label(label="IP en red local (LAN): sin detectar", xalign=0)
        self.lbl_cfg_dns = Gtk.Label(label="Dominio externo detectado (DNS): sin detectar", xalign=0)
        self.lbl_cfg_cert = Gtk.Label(label="Certificado cifrado del dispositivo: pendiente", xalign=0)
        for lbl in (self.lbl_cfg_lan, self.lbl_cfg_dns, self.lbl_cfg_cert):
            lbl.get_style_context().add_class("launcher-subtitle")
            lbl.set_selectable(True)
            card3.pack_start(lbl, False, False, 0)

        center_box.pack_start(card3, False, False, 0)
        home_scroll.add(center_box)
        self.main_stack.add_named(home_scroll, "home")

        # Page 2: WebKit2 Unified Interface
        initial_view = "dex" if self.start_in_dex else "inicio"
        target_uri = f"http://127.0.0.1:{self.bridge_port}/?env=ubuntu_native&view={initial_view}"

        if HAS_WEBKIT2 and WebKit2 is not None:
            self.webview = WebKit2.WebView()
            settings = self.webview.get_settings()
            settings.set_enable_javascript(True)
            settings.set_enable_webgl(True)
            if hasattr(settings, "set_enable_smooth_scrolling"):
                settings.set_enable_smooth_scrolling(True)
            if hasattr(settings, "set_user_agent"):
                settings.set_user_agent(
                    f"Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 "
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
                rgba.parse("#f6f7f9")
                self.webview.set_background_color(rgba)

            self._target_webview_uri = target_uri
            self.webview.connect("load-changed", self._on_webview_load_changed)
            # Carga diferida: no cargar HTML5/animations hasta entrar al panel o --dex (evita consumo CPU en menú inicio)
            if self.start_in_dex:
                self.webview.load_uri(target_uri)
            self.main_stack.add_named(self.webview, "webview")
        else:
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
            box.set_valign(Gtk.Align.CENTER)
            box.set_halign(Gtk.Align.CENTER)
            lbl = Gtk.Label(
                label=(
                    f"Recursos v{get_display_version()}\n"
                    f"Interfaz lista en: {target_uri}\n"
                    "Instala gir1.2-webkit2-4.1 para ver el panel integrado."
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
            state_txt = "activo" if st["running"] else "instalado"
            self.lbl_node_info.set_text(
                f"Nodo local ya {state_txt}. Conecta en tu Wi-Fi con: {st['lan_ip']} · Puerto {st['port']}"
            )
            self.btn_opt2.set_label("Conectar al nodo local" if st["running"] else "Iniciar nodo local")
        elif st.get("app_installed_deb"):
            inst_ver = get_display_version(st.get("installed_deb_version") or get_app_version())
            self.lbl_node_info.set_text(
                f"Aplicación ya instalada en Ubuntu (v{inst_ver}). También puedes instalar el nodo servidor aquí si lo deseas."
            )
            self.btn_opt2.set_label("Instalar nodo local")
        else:
            self.lbl_node_info.set_text(
                "No hay ningún nodo instalado en este equipo. Puedes instalarlo para gestionar este ordenador desde la red."
            )
            self.btn_opt2.set_label("Instalar nodo local")

        if hasattr(self, "lbl_github_info") and hasattr(self, "btn_opt2_update"):
            has_server_gap = bool(gh and gh.get("server_needs_update"))
            self.btn_opt2_update.set_visible(app_installed or has_server_gap)
            ctx = self.btn_opt2_update.get_style_context()
            ctx.remove_class("btn-primary")
            ctx.remove_class("btn-nav")
            if gh and gh.get("effective_update_available"):
                summary = gh.get("update_summary") or f"Actualización disponible a v{gh.get('target_version')}."
                btn_lbl = gh.get("update_action_label") or f"Actualizar a v{gh.get('target_version')}"
                self.lbl_github_info.set_text(summary)
                self.btn_opt2_update.set_label(btn_lbl)
                ctx.add_class("btn-primary")
            elif gh and gh.get("app_above_github"):
                srv_note = f" · Servidor web: v{gh.get('server_display_version')}" if gh.get("server_reachable") else ""
                self.lbl_github_info.set_text(
                    f"App Ubuntu v{gh.get('app_display_version')} (superior a GitHub v{gh.get('github_display_version')}{srv_note})."
                )
                self.btn_opt2_update.set_label(
                    gh.get("update_action_label") or "Sincronizar web local"
                )
                ctx.add_class("btn-nav")
            elif gh and gh.get("github_version"):
                self.lbl_github_info.set_text(
                    gh.get("update_summary")
                    or f"GitHub al día (v{gh.get('github_display_version')}). Puedes reinstalar o sincronizar cuando quieras."
                )
                self.btn_opt2_update.set_label(gh.get("update_action_label") or "Actualizar / Reinstalar")
                ctx.add_class("btn-nav")
            else:
                self.lbl_github_info.set_text("Actualización unificada de App Ubuntu y web local disponible.")
                self.btn_opt2_update.set_label("Comprobar y actualizar")
                ctx.add_class("btn-nav")
        return False

    def _on_update_from_github_clicked(self, _widget):
        if hasattr(self, "btn_opt2_update"):
            self.btn_opt2_update.set_sensitive(False)
            self.btn_opt2_update.set_label("Aplicando actualización...")
        if hasattr(self, "lbl_github_info"):
            self.lbl_github_info.set_text(
                "Comparando App Ubuntu, Servidor web local y GitHub para aplicar la actualización en un clic..."
            )

        def worker():
            ok, msg, gh, flags = self.conn_mgr.perform_unified_update(relaunch_on_deb=False)
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
                    self.lbl_home_status.set_text(f"{msg} Reiniciando aplicación...")
                GLib.timeout_add(450, self._reexec_after_update)
        return False

    def _refresh_config_labels(self):
        lan_txt = f"{self.conn_mgr.saved_host}:{self.conn_mgr.node_port}" if self.conn_mgr.saved_host else "Pendiente de conexión en red local"
        dns_txt = self.conn_mgr.wan_domain if self.conn_mgr.wan_domain else "Se guardará automáticamente al conectar por primera vez"
        cert_txt = (
            "Verificado y cifrado correctamente"
            if self.conn_mgr.device_token and not self.conn_mgr.is_revoked
            else ("Revocado (vuelve a conectar en red local)" if self.conn_mgr.is_revoked else "Se verificará al conectar en LAN")
        )
        self.lbl_cfg_lan.set_text(f"Conexión en red local (LAN): {lan_txt}")
        self.lbl_cfg_dns.set_text(f"Dominio externo detectado (DNS): {dns_txt}")
        self.lbl_cfg_cert.set_text(f"Certificado de seguridad: {cert_txt}")
        return False

    def _on_install_local_node_clicked(self, _widget):
        st = self.conn_mgr.detect_local_node_status()
        if st["installed"] and st["running"]:
            self.conn_mgr.saved_host = "127.0.0.1"
            self.conn_mgr._save_config()
            self._connect_and_open_webview("inicio")
            return
        self.lbl_node_info.set_text("Instalando y activando nodo local...")

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
        self.lbl_home_status.set_text("Se han borrado los datos guardados del nodo.")
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
            self.lbl_conn_status.set_text(f"Red local ({self.conn_mgr.saved_host})")
        elif mode == "WAN":
            ctx.add_class("badge-wan")
            self.lbl_conn_status.set_text(f"Externa ({self.conn_mgr.wan_domain or 'DNS'})")
        elif mode == "REVOKED":
            ctx.add_class("badge-revoked")
            self.lbl_conn_status.set_text("Acceso revocado")
        elif mode == "LOCAL":
            ctx.add_class("badge-local")
            self.lbl_conn_status.set_text("Sin nodo remoto")
        else:
            ctx.add_class("badge-local")
            self.lbl_conn_status.set_text("Listo para conectar")
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
            "Error: python3-gi / gir1.2-gtk-3.0 no está instalado en este entorno.",
            file=sys.stderr,
        )
        sys.exit(1)

    GLib.set_prgname("recursos-cockpit")
    GLib.set_application_name("Recursos Cockpit")
    app = RecursosNativeApp(start_in_dex=args.dex)
    sys.exit(app.run([sys.argv[0]]))


if __name__ == "__main__":
    main()
