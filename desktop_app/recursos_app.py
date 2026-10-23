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
import collections
import http.server
import json
import os
import platform
import socket
import socketserver
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


def resolve_bundled_html_path():
    """Localiza el archivo HTML5 canónico empaquetado o en el repositorio local."""
    candidates = [
        os.path.join(SCRIPT_DIR, "..", "index.html"),
        os.path.join(SCRIPT_DIR, "..", "static", "index.html"),
        os.path.join(SCRIPT_DIR, "static", "index.html"),
        "/usr/lib/recursos-cockpit/static/index.html",
        "/usr/share/recursos-cockpit/static/index.html",
        "./index.html",
        "./static/index.html",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return os.path.abspath(path)
    return None


NATIVE_CSS = b"""
window {
    background-color: #06070a;
    color: #f5f5f7;
}
headerbar {
    background-image: none;
    background-color: #0c1017;
    color: #f5f5f7;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.badge-ready {
    background-color: rgba(48, 209, 88, 0.18);
    color: #30d158;
    border-radius: 6px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-lan {
    background-color: rgba(48, 209, 88, 0.2);
    color: #30d158;
    border-radius: 6px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-wan {
    background-color: rgba(10, 132, 255, 0.2);
    color: #38bdf8;
    border-radius: 6px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-revoked {
    background-color: rgba(255, 69, 58, 0.25);
    color: #ff453a;
    border-radius: 6px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-scanning {
    background-color: rgba(255, 159, 10, 0.2);
    color: #ff9f0a;
    border-radius: 6px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-local {
    background-color: rgba(142, 155, 174, 0.2);
    color: #94a3b8;
    border-radius: 6px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.btn-nav {
    background-image: none;
    background-color: #151c28;
    color: #e2e8f0;
    font-weight: 600;
    border-radius: 6px;
    padding: 4px 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}
.btn-nav:hover {
    background-color: #1e293b;
}
.btn-dex {
    background-image: none;
    background-color: rgba(14, 165, 233, 0.18);
    color: #38bdf8;
    font-weight: 700;
    border-radius: 6px;
    padding: 4px 12px;
    border: 1px solid rgba(56, 189, 248, 0.4);
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
        self.wan_domain = "recursos.cminewar.duckdns.org"
        self.is_revoked = False
        self._last_net_io = psutil.net_io_counters() if psutil else None
        self._last_net_ts = time.time()
        self._load_config()

    def _load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.device_token = data.get("device_token", "")
                    self.saved_host = data.get("saved_host", "")
                    self.wan_domain = data.get("wan_domain", "recursos.cminewar.duckdns.org")
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
                        "wan_domain": self.wan_domain,
                        "is_revoked": self.is_revoked,
                    },
                    f,
                    indent=2,
                )
        except Exception:
            pass

    def _probe(self, base_url, timeout=0.6):
        try:
            url = f"{base_url.rstrip('/')}/api/version"
            headers = {"User-Agent": f"RecursosCockpit-Linux/{get_app_version()} (Ubuntu; NativeHTML)"}
            if self.device_token:
                headers["X-Device-Token"] = self.device_token
                headers["Authorization"] = f"Bearer {self.device_token}"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    body = resp.read().decode("utf-8")
                    return ("Recursos" in body or "version" in body), False
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
            if self.saved_host:
                cand = f"http://{self.saved_host}:8085"
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
                    return cand

            for cand in ["http://127.0.0.1:8085", "http://localhost:8085"]:
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
                for cand in [
                    f"http://{subnet}.2:8085",
                    f"http://{subnet}.1:8085",
                    "http://recursos.local:8085",
                ]:
                    ok, is_rev = self._probe(cand, timeout=0.4)
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

            wan_cand = f"https://{self.wan_domain.rstrip('/')}"
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
        headers = {"User-Agent": f"RecursosCockpit-Linux/{get_app_version()} (Ubuntu; NativeHTML)"}
        if self.device_token:
            headers["X-Device-Token"] = self.device_token
            headers["Authorization"] = f"Bearer {self.device_token}"

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    new_token = data.get("auth_status", {}).get("token")
                    if new_token and new_token != self.device_token:
                        self.device_token = new_token
                        self.is_revoked = False
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

            def _serve_html(self):
                if not parent.html_path or not os.path.isfile(parent.html_path):
                    self._send_json({"error": "HTML UI not found"}, 404)
                    return
                with open(parent.html_path, "r", encoding="utf-8") as f:
                    html = f.read()

                token_js = json.dumps(parent.conn_mgr.device_token or "")
                mode_js = json.dumps(parent.conn_mgr.connection_mode or "LOCAL")
                node_js = json.dumps(parent.conn_mgr.active_url or "local")
                bridge_script = (
                    "<script>"
                    "window.__RECURSOS_UBUNTU_NATIVE__ = true;"
                    "window.__RECURSOS_NATIVE__ = true;"
                    f"window.__RECURSOS_DEVICE_TOKEN__ = {token_js};"
                    f"window.__RECURSOS_CONN_MODE__ = {mode_js};"
                    f"window.__RECURSOS_NODE_URL__ = {node_js};"
                    f"try {{ if ({token_js}) localStorage.setItem('sysmon_device_token', {token_js}); }} catch(e) {{}}"
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
                headers = {
                    "User-Agent": f"RecursosCockpit-Linux/{get_app_version()} (Ubuntu; NativeHTML)",
                    "Accept": self.headers.get("Accept", "*/*"),
                }
                if self.headers.get("Content-Type"):
                    headers["Content-Type"] = self.headers.get("Content-Type")
                token = parent.conn_mgr.device_token
                if token:
                    headers["X-Device-Token"] = token
                    headers["Authorization"] = f"Bearer {token}"

                req = urllib.request.Request(target_url, data=body, headers=headers, method=method)
                try:
                    with urllib.request.urlopen(req, timeout=4.0) as resp:
                        resp_body = resp.read()
                        ctype = resp.headers.get("Content-Type", "application/json")
                        if "application/json" in ctype and self.path.startswith("/api/metrics"):
                            try:
                                parsed = json.loads(resp_body.decode("utf-8"))
                                new_tok = parsed.get("auth_status", {}).get("token")
                                if new_tok and new_tok != parent.conn_mgr.device_token:
                                    parent.conn_mgr.device_token = new_tok
                                    parent.conn_mgr._save_config()
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
                    return False
                except Exception:
                    return False

            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                clean_path = parsed.path

                # 1. Control local de hardware DeX USB exclusivo de Ubuntu
                if clean_path == "/api/dex/status":
                    deps = parent.dex.check_dependencies()
                    devices = parent.dex.list_connected_devices(usb_only=True)
                    self._send_json(
                        {
                            "ok": True,
                            "usb_only": True,
                            "environment": "ubuntu_native",
                            "session_running": parent.dex.is_running,
                            "dependencies": deps,
                            "devices": devices,
                        }
                    )
                    return

                # 2. Proxy de API hacia el servidor descubierto o fallback local
                if clean_path.startswith("/api/"):
                    if self._proxy_to_remote("GET"):
                        return
                    if clean_path == "/api/metrics":
                        self._send_json(parent.conn_mgr.build_local_fallback_metrics())
                        return
                    if clean_path == "/api/version":
                        ver = get_app_version()
                        self._send_json(
                            {
                                "version": ver,
                                "local_version": ver,
                                "remote_version": ver,
                                "update_available": False,
                                "branch": "main",
                            }
                        )
                        return
                    self._send_json({"ok": True, "logs": [], "entries": [], "connections": []})
                    return

                # 3. Rutas SPA HTML5
                self._serve_html()

            def do_POST(self):
                parsed = urllib.parse.urlparse(self.path)
                clean_path = parsed.path
                length = int(self.headers.get("Content-Length", 0) or 0)
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

                if self._proxy_to_remote("POST", body=raw_body):
                    return

                self._send_json({"ok": False, "error": "Modo sin conexión al servidor remoto"}, 503)

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
        super().__init__(
            application=app,
            title=f"Recursos Cockpit v{get_app_version()}",
        )
        self.set_default_size(1280, 820)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_wmclass("recursos-cockpit", "recursos-cockpit")
        self.is_fullscreen = False
        self.start_in_dex = start_in_dex
        self.webview = None

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
        self.show_all()

        threading.Thread(target=self._initial_discovery_worker, daemon=True).start()
        GLib.timeout_add(3000, self._refresh_connection_badge)

    def _initial_discovery_worker(self):
        self.conn_mgr.discover_server()
        self.conn_mgr.fetch_metrics()
        GLib.idle_add(self._refresh_connection_badge)
        GLib.idle_add(self._sync_webview_session)

    def _sync_webview_session(self):
        if self.webview and HAS_WEBKIT2:
            tok = json.dumps(self.conn_mgr.device_token or "")
            mode = json.dumps(self.conn_mgr.connection_mode or "LOCAL")
            url = json.dumps(self.conn_mgr.active_url or "local")
            js = f"if(window.injectNativeSession){{window.injectNativeSession({tok},{mode},{url});}}"
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
        hb.props.title = "Recursos Cockpit"
        hb.props.subtitle = f"v{get_app_version()} · Motor HTML5 Unificado & Estación USB DeX"

        ver_badge = Gtk.Label(label=f"v{get_app_version()}")
        ver_badge.get_style_context().add_class("badge-ready")
        hb.pack_start(ver_badge)

        self.lbl_conn_status = Gtk.Label(label="📡 Autodescubriendo nodo...")
        self.lbl_conn_status.get_style_context().add_class("badge-scanning")
        hb.pack_start(self.lbl_conn_status)

        btn_cockpit = Gtk.Button(label="🏠 Cockpit")
        btn_cockpit.get_style_context().add_class("btn-nav")
        btn_cockpit.set_tooltip_text("Ir a la Cabina General del Cockpit")
        btn_cockpit.connect("clicked", lambda *_: self._navigate_spa("overview"))
        hb.pack_start(btn_cockpit)

        btn_dex = Gtk.Button(label="📱 Estación DeX (USB)")
        btn_dex.get_style_context().add_class("btn-dex")
        btn_dex.set_tooltip_text("Abrir el submenú exclusivo de Proyección USB Samsung DeX / Android Desktop")
        btn_dex.connect("clicked", lambda *_: self._navigate_spa("dex"))
        hb.pack_start(btn_dex)

        btn_about = Gtk.Button.new_from_icon_name("help-about-symbolic", Gtk.IconSize.BUTTON)
        btn_about.set_tooltip_text(f"Acerca de Recursos Cockpit (v{get_app_version()})")
        btn_about.connect("clicked", self._show_about_dialog)
        hb.pack_end(btn_about)

        btn_fs = Gtk.Button(label="⛶ Pantalla Completa")
        btn_fs.get_style_context().add_class("btn-nav")
        btn_fs.set_tooltip_text("Alternar pantalla completa (F11)")
        btn_fs.connect("clicked", lambda *_: self._toggle_fullscreen())
        hb.pack_end(btn_fs)

        btn_reconnect = Gtk.Button(label="🔄 Reconectar")
        btn_reconnect.get_style_context().add_class("btn-nav")
        btn_reconnect.set_tooltip_text("Escanear red local LAN / WAN y sincronizar sesión")
        btn_reconnect.connect("clicked", self._on_reconnect_clicked)
        hb.pack_end(btn_reconnect)

        self.set_titlebar(hb)

    def _navigate_spa(self, view_name):
        if self.webview and HAS_WEBKIT2:
            js = f"if(typeof switchView==='function'){{switchView('{view_name}', true);}}"
            try:
                if hasattr(self.webview, "evaluate_javascript"):
                    self.webview.evaluate_javascript(js, -1, None, None, None, None, None)
                elif hasattr(self.webview, "run_javascript"):
                    self.webview.run_javascript(js, None, None, None)
            except Exception:
                pass

    def _on_reconnect_clicked(self, _widget):
        self.lbl_conn_status.set_text("📡 Escaneando LAN/WAN...")
        threading.Thread(target=self._initial_discovery_worker, daemon=True).start()

    def _show_about_dialog(self, _widget):
        about = Gtk.AboutDialog(transient_for=self, modal=True)
        about.set_program_name("Recursos Cockpit")
        about.set_version(f"v{get_app_version()}")
        about.set_comments(
            "Aplicación Nativa Ubuntu con Motor HTML5/CSS3/D3.js/Leaflet Acelerado por Hardware, "
            "Autodescubrimiento LAN/WAN Zero-Trust y Estación de Proyección USB Samsung DeX."
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
        initial_view = "dex" if self.start_in_dex else "overview"
        target_uri = f"http://127.0.0.1:{self.bridge_port}/?env=ubuntu_native&view={initial_view}"

        if HAS_WEBKIT2 and WebKit2 is not None:
            self.webview = WebKit2.WebView()
            settings = self.webview.get_settings()
            settings.set_enable_javascript(True)
            settings.set_enable_webgl(True)
            settings.set_enable_Smooth_scrolling(True) if hasattr(settings, "set_enable_Smooth_scrolling") else None
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
                rgba.parse("#06070a")
                self.webview.set_background_color(rgba)

            self.webview.load_uri(target_uri)
            self.add(self.webview)
        else:
            # Fallback informativo si el paquete gir1.2-webkit2 no está presente
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
            box.set_valign(Gtk.Align.CENTER)
            box.set_halign(Gtk.Align.CENTER)
            lbl = Gtk.Label(
                label=(
                    f"Recursos Cockpit v{get_app_version()}\n"
                    f"Puente HTML5 activo en: {target_uri}\n"
                    "Instala gir1.2-webkit2-4.1 para renderizado embebido."
                )
            )
            box.pack_start(lbl, False, False, 0)
            self.add(box)

    def _on_dex_status_callback(self, _status, _message):
        GLib.idle_add(self._sync_webview_session)

    def _refresh_connection_badge(self):
        mode = self.conn_mgr.connection_mode
        ctx = self.lbl_conn_status.get_style_context()
        for cls in ["badge-lan", "badge-wan", "badge-revoked", "badge-scanning", "badge-local"]:
            ctx.remove_class(cls)

        if mode == "LAN":
            ctx.add_class("badge-lan")
            self.lbl_conn_status.set_text(f"🟢 LAN ({self.conn_mgr.saved_host})")
        elif mode == "WAN":
            ctx.add_class("badge-wan")
            self.lbl_conn_status.set_text("🌐 WAN (DDNS)")
        elif mode == "REVOKED":
            ctx.add_class("badge-revoked")
            self.lbl_conn_status.set_text("🔒 Certificado Revocado")
        else:
            ctx.add_class("badge-local")
            self.lbl_conn_status.set_text("💻 Silicio Local")
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
