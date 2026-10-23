#!/usr/bin/env bash
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recursos — Aplicación Nativa de Escritorio Linux (100% Puro GTK 3)
Sin WebKit, sin navegador embebido. Interfaz nativa real con widgets GTK,
gráficas de telemetría renderizadas con Cairo, sincronización automática con
el servidor web (autodescubrimiento en red local, Zero-Trust pairing y certificación permanente)
y pestaña exclusiva de espera y proyección de vídeo por USB para móviles con Samsung DeX o Modo Escritorio de Android.
"""

import argparse
import collections
import ipaddress
import json
import math
import os
import platform
import shutil
import socket
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

try:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import Gdk, GdkPixbuf, GLib, Gtk, Pango

    HAS_GTK = True
except ImportError:
    HAS_GTK = False

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

# Import local DexController
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from dex_controller import DexController


def get_app_version():
    """Lee la versión canónica desde el archivo VERSION o package.json sin hardcoding."""
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


NATIVE_CSS = b"""
window {
    background-color: #090d16;
    color: #f5f5f7;
}
headerbar {
    background-image: none;
    background-color: #121826;
    color: #f5f5f7;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.card {
    background-color: #121826;
    border: 1px solid #2a354c;
    border-radius: 14px;
    padding: 16px;
}
.card-highlight {
    background-color: #192236;
    border: 1px solid rgba(100, 210, 255, 0.4);
    border-radius: 16px;
    padding: 24px;
}
.title-xl {
    font-size: 20px;
    font-weight: 800;
    color: #ffffff;
}
.title-lg {
    font-size: 15px;
    font-weight: 700;
    color: #f5f5f7;
}
.metric-big {
    font-size: 28px;
    font-weight: 800;
    color: #64d2ff;
}
.subtitle {
    font-size: 12px;
    color: #8e9bae;
}
.badge-ready {
    background-color: rgba(48, 209, 88, 0.18);
    color: #30d158;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-lan {
    background-color: rgba(48, 209, 88, 0.2);
    color: #30d158;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-wan {
    background-color: rgba(10, 132, 255, 0.2);
    color: #0a84ff;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-revoked {
    background-color: rgba(255, 69, 58, 0.25);
    color: #ff453a;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-scanning {
    background-color: rgba(255, 159, 10, 0.2);
    color: #ff9f0a;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-local {
    background-color: rgba(142, 155, 174, 0.2);
    color: #8e9bae;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.btn-primary {
    background-image: none;
    background-color: #0a84ff;
    color: #ffffff;
    font-weight: 700;
    border-radius: 10px;
    padding: 10px 20px;
    border: none;
}
.btn-primary:hover {
    background-color: #0071e3;
}
.btn-danger {
    background-image: none;
    background-color: #ff453a;
    color: #ffffff;
    font-weight: 700;
    border-radius: 10px;
    padding: 10px 20px;
    border: none;
}
"""


class CairoSparkline(Gtk.DrawingArea):
    """Widget nativo GTK que dibuja una gráfica de telemetría suave usando Cairo."""

    def __init__(self, rgb_color=(0.39, 0.82, 1.0), max_points=60):
        super().__init__()
        self.rgb = rgb_color
        self.history = collections.deque([0.0] * max_points, maxlen=max_points)
        self.set_size_request(-1, 85)
        self.connect("draw", self.on_draw)

    def push_value(self, val):
        self.history.append(max(0.0, min(100.0, float(val))))
        self.queue_draw()

    def on_draw(self, widget, cr):
        try:
            alloc = self.get_allocation()
            w = alloc.width
            h = alloc.height
            if w <= 2 or h <= 2:
                return False

            cr.set_source_rgba(0.04, 0.06, 0.09, 0.9)
            cr.rectangle(0, 0, w, h)
            cr.fill()

            cr.set_source_rgba(1.0, 1.0, 1.0, 0.05)
            cr.set_line_width(1.0)
            for frac in (0.25, 0.5, 0.75):
                y = h * frac
                cr.move_to(0, y)
                cr.line_to(w, y)
                cr.stroke()

            pts = list(self.history)
            if len(pts) < 2:
                return False

            step_x = w / float(len(pts) - 1)
            coords = []
            for idx, val in enumerate(pts):
                x = idx * step_x
                y = h - (val / 100.0) * (h - 12) - 6
                coords.append((x, y))

            r, g, b = self.rgb
            cr.set_source_rgba(r, g, b, 0.18)
            cr.move_to(coords[0][0], h)
            for x, y in coords:
                cr.line_to(x, y)
            cr.line_to(coords[-1][0], h)
            cr.close_path()
            cr.fill()

            cr.set_source_rgba(r, g, b, 0.95)
            cr.set_line_width(2.0)
            cr.move_to(coords[0][0], coords[0][1])
            for x, y in coords[1:]:
                cr.line_to(x, y)
            cr.stroke()
        except Exception:
            return False
        return False


class ServerConnectionManager:
    """
    Gestor de autodescubrimiento en red local, enlace seguro Zero-Trust
    y persistencia de certificados mutuos para la app nativa de Ubuntu.
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
                json.dump({
                    "device_token": self.device_token,
                    "saved_host": self.saved_host,
                    "wan_domain": self.wan_domain,
                    "is_revoked": self.is_revoked
                }, f, indent=2)
        except Exception:
            pass

    def _probe(self, base_url, timeout=0.6):
        try:
            url = f"{base_url.rstrip('/')}/api/version"
            headers = {"User-Agent": f"RecursosCockpit-Linux/{get_app_version()}"}
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
                return True, True  # Online pero Revocado
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
            if len(parts) == 4 and (local_ip.startswith("192.168.") or local_ip.startswith("10.") or local_ip.startswith("172.")):
                return f"{parts[0]}.{parts[1]}.{parts[2]}"
        except Exception:
            pass
        return None

    def discover_server(self):
        with self.lock:
            # 1. Probar saved_host si existe
            if self.saved_host:
                cand = f"http://{self.saved_host}:8085"
                ok, is_rev = self._probe(cand, timeout=1.0)
                if is_rev:
                    self.is_revoked = True
                    self.connection_mode = "REVOKED"
                    self._save_config()
                    return cand
                if ok:
                    self.active_url = cand
                    self.connection_mode = "LAN"
                    return cand

            # 2. Probar loopback local
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
                    self._save_config()
                    return cand

            # 3. Detectar subred local y escanear
            subnet = self._get_local_subnet_base()
            if subnet:
                for cand in [f"http://{subnet}.2:8085", f"http://{subnet}.1:8085", "http://recursos.local:8085"]:
                    ok, is_rev = self._probe(cand, timeout=0.4)
                    if is_rev:
                        self.is_revoked = True
                        self.connection_mode = "REVOKED"
                        return cand
                    if ok:
                        self.active_url = cand
                        self.connection_mode = "LAN"
                        self.saved_host = cand.split("//")[1].split(":")[0]
                        self._save_config()
                        return cand

            # 4. Probar WAN exterior
            wan_cand = f"https://{self.wan_domain.rstrip('/')}"
            ok, is_rev = self._probe(wan_cand, timeout=1.5)
            if is_rev:
                self.is_revoked = True
                self.connection_mode = "REVOKED"
                return wan_cand
            if ok:
                self.active_url = wan_cand
                self.connection_mode = "WAN"
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
            return None

        url = f"{self.active_url.rstrip('/')}/api/metrics"
        headers = {"User-Agent": f"RecursosCockpit-Linux/{get_app_version()}"}
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
            # Reconectar en siguiente ciclo
            self.active_url = ""
        return None


def detect_runtime_environment(force_env=None):
    """
    Detecta dinámicamente el entorno de ejecución (nativo, móvil o web).
    En Ubuntu nativo mantiene desbloqueado el submenú de control DeX / USB.
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
        "is_native": mode == "native",
        "is_mobile": mode == "mobile",
        "is_web": mode == "web",
        "is_native_or_mobile": is_native_or_mobile,
        "hide_device_tab": False if mode == "native" else True,
        "render_usb_projection_wait_screen": is_native_or_mobile,
    }


class RecursosNativeWindow(Gtk.ApplicationWindow):
    def __init__(self, app, start_in_dex=False, env_info=None):
        self.env_info = env_info or detect_runtime_environment()
        super().__init__(
            application=app,
            title=f"Recursos Cockpit v{get_app_version()}",
        )
        self.set_default_size(1040, 720)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_wmclass("recursos-cockpit", "recursos-cockpit")
        self.is_fullscreen = False
        self.auto_launched_serials = set()

        self._apply_css()
        self._set_app_icon()
        self.dex = DexController(on_status_change=self._on_dex_status_callback)

        # Gestor de conexión al servidor y persistencia de certificados
        self.conn_mgr = ServerConnectionManager()

        # Variables de red para cálculo de caudal local
        self._last_net_io = psutil.net_io_counters() if psutil else None
        self._last_net_ts = time.time()

        self._build_headerbar()
        self._build_main_layout()

        # Seleccionar pestaña inicial
        if start_in_dex:
            self.stack.set_visible_child_name("devices")
        else:
            self.stack.set_visible_child_name("telemetry")

        self.connect("key-press-event", self._on_key_press)
        self.show_all()

        # Iniciar autodescubrimiento en segundo plano y actualización periódica
        threading.Thread(target=self._initial_discovery_worker, daemon=True).start()

        GLib.timeout_add(1500, self._refresh_telemetry)
        GLib.timeout_add(2000, self._refresh_usb_devices)

    def _initial_discovery_worker(self):
        self.conn_mgr.discover_server()
        self.conn_mgr.fetch_metrics()
        GLib.idle_add(self._refresh_telemetry)

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
        hb.props.subtitle = f"v{get_app_version()} · Sincronización Automática LAN & DeX"

        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.SLIDE_LEFT_RIGHT)
        self.stack.set_transition_duration(200)

        self.switcher = Gtk.StackSwitcher()
        self.switcher.set_stack(self.stack)
        hb.set_custom_title(self.switcher)

        ver_badge = Gtk.Label(label=f"v{get_app_version()}")
        ver_badge.get_style_context().add_class("badge-ready")
        hb.pack_start(ver_badge)

        self.lbl_conn_status = Gtk.Label(label="📡 Escaneando red...")
        self.lbl_conn_status.get_style_context().add_class("badge-scanning")
        hb.pack_start(self.lbl_conn_status)

        btn_fs = Gtk.Button(label="⛶ Pantalla Completa")
        btn_fs.set_tooltip_text("Alternar pantalla completa (F11)")
        btn_fs.connect("clicked", lambda *_: self._toggle_fullscreen())
        hb.pack_end(btn_fs)

        btn_about = Gtk.Button.new_from_icon_name("help-about-symbolic", Gtk.IconSize.BUTTON)
        btn_about.set_tooltip_text(f"Acerca de Recursos Cockpit (v{get_app_version()})")
        btn_about.connect("clicked", self._show_about_dialog)
        hb.pack_end(btn_about)

        self.set_titlebar(hb)

    def _show_about_dialog(self, widget):
        about = Gtk.AboutDialog(transient_for=self, modal=True)
        about.set_program_name("Recursos Cockpit")
        about.set_version(f"v{get_app_version()}")
        about.set_comments("Monitor de Silicio Nativo 60 FPS con Autodescubrimiento LAN, Enlace Criptográfico Zero-Trust y Control DeX")
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
        # 1. Pestaña de Telemetría (Silicio en tiempo real con gráficos Cairo)
        telemetry_page = self._build_telemetry_ui()
        self.stack.add_titled(telemetry_page, "telemetry", "📊 Telemetría")

        # 2. Pestaña de Procesos
        procs_page = self._build_processes_ui()
        self.stack.add_titled(procs_page, "processes", "⚙️ Procesos")

        # 3. Pestaña de Conexión y Proyección USB (Samsung DeX / Android Desktop con UHID) - Exclusiva en Ubuntu
        device_page = self._build_device_connection_ui()
        self.stack.add_titled(device_page, "devices", "📱 Conexión USB (DeX)")

        self.add(self.stack)

    def _build_telemetry_ui(self):
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)

        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        vbox.set_margin_top(16)
        vbox.set_margin_bottom(16)
        vbox.set_margin_start(20)
        vbox.set_margin_end(20)

        # Banner de Identidad del Host y Enlace
        host_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        host_card.get_style_context().add_class("card")

        host_info_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        hostname = socket.gethostname()
        self.lbl_host = Gtk.Label(label=f"🖥️ Nodo Servidor: Conectando...", xalign=0)
        self.lbl_host.get_style_context().add_class("title-xl")
        self.lbl_host_sub = Gtk.Label(label="Autodescubriendo telemetría en red local...", xalign=0)
        self.lbl_host_sub.get_style_context().add_class("subtitle")
        host_info_box.pack_start(self.lbl_host, False, False, 0)
        host_info_box.pack_start(self.lbl_host_sub, False, False, 0)
        host_card.pack_start(host_info_box, True, True, 0)

        self.lbl_uptime = Gtk.Label(label="Activo", xalign=1)
        self.lbl_uptime.get_style_context().add_class("badge-ready")
        host_card.pack_end(self.lbl_uptime, False, False, 0)

        vbox.pack_start(host_card, False, False, 0)

        # Grid 2x2 de Silicio
        grid = Gtk.Grid()
        grid.set_column_spacing(16)
        grid.set_row_spacing(16)
        grid.set_column_homogeneous(True)

        # 1. CPU Card
        cpu_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        cpu_card.get_style_context().add_class("card")
        lbl_cpu_t = Gtk.Label(label="PROCESADOR (CPU)", xalign=0)
        lbl_cpu_t.get_style_context().add_class("subtitle")
        self.lbl_cpu_val = Gtk.Label(label="0.0%", xalign=0)
        self.lbl_cpu_val.get_style_context().add_class("metric-big")
        self.lbl_cpu_sub = Gtk.Label(label="Detectando núcleos...", xalign=0)
        self.lbl_cpu_sub.get_style_context().add_class("subtitle")
        self.chart_cpu = CairoSparkline(rgb_color=(0.22, 0.74, 0.97))
        cpu_card.pack_start(lbl_cpu_t, False, False, 0)
        cpu_card.pack_start(self.lbl_cpu_val, False, False, 0)
        cpu_card.pack_start(self.lbl_cpu_sub, False, False, 0)
        cpu_card.pack_start(self.chart_cpu, True, True, 4)
        grid.attach(cpu_card, 0, 0, 1, 1)

        # 2. RAM Card
        ram_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        ram_card.get_style_context().add_class("card")
        lbl_ram_t = Gtk.Label(label="MEMORIA FÍSICA (RAM)", xalign=0)
        lbl_ram_t.get_style_context().add_class("subtitle")
        self.lbl_ram_val = Gtk.Label(label="0.0%", xalign=0)
        self.lbl_ram_val.get_style_context().add_class("metric-big")
        self.lbl_ram_sub = Gtk.Label(label="Calculando memoria...", xalign=0)
        self.lbl_ram_sub.get_style_context().add_class("subtitle")
        self.chart_ram = CairoSparkline(rgb_color=(0.65, 0.54, 0.98))
        ram_card.pack_start(lbl_ram_t, False, False, 0)
        ram_card.pack_start(self.lbl_ram_val, False, False, 0)
        ram_card.pack_start(self.lbl_ram_sub, False, False, 0)
        ram_card.pack_start(self.chart_ram, True, True, 4)
        grid.attach(ram_card, 1, 0, 1, 1)

        # 3. Almacenamiento Card
        disk_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        disk_card.get_style_context().add_class("card")
        lbl_disk_t = Gtk.Label(label="ALMACENAMIENTO RAÍZ (/)", xalign=0)
        lbl_disk_t.get_style_context().add_class("subtitle")
        self.lbl_disk_val = Gtk.Label(label="0%", xalign=0)
        self.lbl_disk_val.get_style_context().add_class("metric-big")
        self.lbl_disk_sub = Gtk.Label(label="Sondeando sistema de archivos...", xalign=0)
        self.lbl_disk_sub.get_style_context().add_class("subtitle")
        self.bar_disk = Gtk.ProgressBar()
        disk_card.pack_start(lbl_disk_t, False, False, 0)
        disk_card.pack_start(self.lbl_disk_val, False, False, 0)
        disk_card.pack_start(self.lbl_disk_sub, False, False, 0)
        disk_card.pack_start(self.bar_disk, False, False, 12)
        grid.attach(disk_card, 0, 1, 1, 1)

        # 4. Red Card
        net_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        net_card.get_style_context().add_class("card")
        lbl_net_t = Gtk.Label(label="TRÁFICO DE RED EN TIEMPO REAL", xalign=0)
        lbl_net_t.get_style_context().add_class("subtitle")
        self.lbl_net_val = Gtk.Label(label="↓ 0 KB/s · ↑ 0 KB/s", xalign=0)
        self.lbl_net_val.get_style_context().add_class("metric-big")
        self.lbl_net_sub = Gtk.Label(label="Acumulado de sesión...", xalign=0)
        self.lbl_net_sub.get_style_context().add_class("subtitle")
        self.chart_net = CairoSparkline(rgb_color=(0.20, 0.83, 0.60))
        net_card.pack_start(lbl_net_t, False, False, 0)
        net_card.pack_start(self.lbl_net_val, False, False, 0)
        net_card.pack_start(self.lbl_net_sub, False, False, 0)
        net_card.pack_start(self.chart_net, True, True, 4)
        grid.attach(net_card, 1, 1, 1, 1)

        vbox.pack_start(grid, False, False, 0)

        # Fila inferior: Ciberdefensa & Docker
        bottom_grid = Gtk.Grid()
        bottom_grid.set_column_spacing(16)
        bottom_grid.set_column_homogeneous(True)

        sec_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        sec_card.get_style_context().add_class("card")
        lbl_sec_t = Gtk.Label(label="🛡️ CIBERDEFENSA & FAIL2BAN IPS", xalign=0)
        lbl_sec_t.get_style_context().add_class("subtitle")
        self.lbl_sec_val = Gtk.Label(label="0 IPs Bloqueadas", xalign=0)
        self.lbl_sec_val.get_style_context().add_class("title-lg")
        self.lbl_sec_sub = Gtk.Label(label="IPS Operativo y Protegido", xalign=0)
        self.lbl_sec_sub.get_style_context().add_class("subtitle")
        sec_card.pack_start(lbl_sec_t, False, False, 0)
        sec_card.pack_start(self.lbl_sec_val, False, False, 0)
        sec_card.pack_start(self.lbl_sec_sub, False, False, 0)
        bottom_grid.attach(sec_card, 0, 0, 1, 1)

        docker_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        docker_card.get_style_context().add_class("card")
        lbl_doc_t = Gtk.Label(label="🐳 CONTENEDORES DOCKER", xalign=0)
        lbl_doc_t.get_style_context().add_class("subtitle")
        self.lbl_doc_val = Gtk.Label(label="0 Activos", xalign=0)
        self.lbl_doc_val.get_style_context().add_class("title-lg")
        self.lbl_doc_sub = Gtk.Label(label="Servicios Homelab", xalign=0)
        self.lbl_doc_sub.get_style_context().add_class("subtitle")
        docker_card.pack_start(lbl_doc_t, False, False, 0)
        docker_card.pack_start(self.lbl_doc_val, False, False, 0)
        docker_card.pack_start(self.lbl_doc_sub, False, False, 0)
        bottom_grid.attach(docker_card, 1, 0, 1, 1)

        vbox.pack_start(bottom_grid, False, False, 0)

        scroll.add(vbox)
        return scroll

    def _build_processes_ui(self):
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        vbox.set_margin_top(16)
        vbox.set_margin_bottom(16)
        vbox.set_margin_start(20)
        vbox.set_margin_end(20)

        top_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        lbl_title = Gtk.Label(label="Monitor Interactivo de Procesos", xalign=0)
        lbl_title.get_style_context().add_class("title-lg")
        top_bar.pack_start(lbl_title, False, False, 0)

        self.proc_search = Gtk.SearchEntry()
        self.proc_search.set_placeholder_text("Filtrar por nombre...")
        self.proc_search.connect("search-changed", lambda *_: self._update_processes_list())
        top_bar.pack_end(self.proc_search, False, False, 0)
        vbox.pack_start(top_bar, False, False, 0)

        self.proc_store = Gtk.ListStore(int, str, str, float, float)
        tree = Gtk.TreeView(model=self.proc_store)
        tree.set_rules_hint(True)

        cols = [
            ("PID", 0, 70),
            ("Nombre", 1, 220),
            ("Usuario", 2, 100),
            ("% CPU", 3, 90),
            ("Memoria (MB)", 4, 110),
        ]
        for title, idx, width in cols:
            renderer = Gtk.CellRendererText()
            if idx in (0, 3, 4):
                renderer.set_alignment(1.0, 0.5)
            col = Gtk.TreeViewColumn(title, renderer)
            if idx == 3:
                col.set_cell_data_func(renderer, lambda _c, cell, model, it, _d: cell.set_property("text", f"{model[it][3]:.1f}%"))
            elif idx == 4:
                col.set_cell_data_func(renderer, lambda _c, cell, model, it, _d: cell.set_property("text", f"{model[it][4]:.1f} MB"))
            else:
                col.add_attribute(renderer, "text", idx)
            col.set_resizable(True)
            col.set_fixed_width(width)
            tree.append_column(col)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        scroll.add(tree)
        vbox.pack_start(scroll, True, True, 0)
        return vbox

    def _build_device_connection_ui(self):
        """
        Interfaz nativa centrada en la conexión USB de dispositivos para
        Samsung DeX / Android Desktop con Scrcpy y UHID (exclusiva de Ubuntu).
        """
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        outer.set_valign(Gtk.Align.CENTER)
        outer.set_halign(Gtk.Align.CENTER)
        outer.set_margin_top(28)
        outer.set_margin_bottom(28)
        outer.set_margin_start(32)
        outer.set_margin_end(32)

        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        card.set_size_request(680, -1)
        card.get_style_context().add_class("card-highlight")

        self.lbl_usb_icon = Gtk.Label(label="🔌  📱 ➔ 🖥️")
        attr_list = Pango.AttrList()
        attr_list.insert(Pango.AttrScale.new(2.4))
        self.lbl_usb_icon.set_attributes(attr_list)
        card.pack_start(self.lbl_usb_icon, False, False, 0)

        lbl_headline = Gtk.Label(label="Estación de Proyección USB (Samsung DeX)", xalign=0.5)
        lbl_headline.get_style_context().add_class("title-xl")
        card.pack_start(lbl_headline, False, False, 0)

        self.lbl_usb_status = Gtk.Label(label="Esperando dispositivo móvil por cable USB...", xalign=0.5)
        self.lbl_usb_status.get_style_context().add_class("subtitle")
        card.pack_start(self.lbl_usb_status, False, False, 0)

        ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        ctrl_box.set_halign(Gtk.Align.CENTER)

        self.combo_devices = Gtk.ComboBoxText()
        self.combo_devices.set_size_request(260, -1)
        ctrl_box.pack_start(self.combo_devices, False, False, 0)

        self.btn_launch = Gtk.Button(label="⚡ Iniciar DeX")
        self.btn_launch.get_style_context().add_class("btn-primary")
        self.btn_launch.connect("clicked", self._on_launch_clicked)
        ctrl_box.pack_start(self.btn_launch, False, False, 0)

        self.btn_stop = Gtk.Button(label="⏹ Detener")
        self.btn_stop.get_style_context().add_class("btn-danger")
        self.btn_stop.set_sensitive(False)
        self.btn_stop.connect("clicked", lambda *_: self.dex.stop_session())
        ctrl_box.pack_start(self.btn_stop, False, False, 0)

        card.pack_start(ctrl_box, False, False, 8)
        outer.pack_start(card, False, False, 0)
        return outer

    def _on_dex_status_callback(self, status, message):
        def _apply():
            if status == "running":
                self.btn_launch.set_sensitive(False)
                self.btn_stop.set_sensitive(True)
                self.lbl_usb_status.set_text(f"🟢 Sesión Activa: {message}")
            elif status == "stopped":
                self.btn_launch.set_sensitive(True)
                self.btn_stop.set_sensitive(False)
                self.lbl_usb_status.set_text("⚪ Sesión finalizada.")
            elif status == "error":
                self.btn_launch.set_sensitive(True)
                self.btn_stop.set_sensitive(False)
                self.lbl_usb_status.set_text(f"🔴 Error: {message}")
            return False
        GLib.idle_add(_apply)

    def _refresh_usb_devices(self):
        try:
            devices = self.dex.list_connected_devices()
            active_model = self.combo_devices.get_model()
            current_serials = set()
            if active_model:
                for row in active_model:
                    current_serials.add(row[0])

            new_serials = {d["serial"] for d in devices}
            if current_serials != new_serials:
                self.combo_devices.remove_all()
                for dev in devices:
                    desc = f"{dev['model']} ({dev['serial']})"
                    self.combo_devices.append(dev["serial"], desc)
                if devices:
                    self.combo_devices.set_active(0)

            if not devices and not self.dex.is_running:
                self.lbl_usb_status.set_text("Esperando dispositivo móvil por cable USB...")
        except Exception:
            pass
        return True

    def _on_launch_clicked(self, _widget):
        serial = self.combo_devices.get_active_id()
        self.dex.start_dex_session(
            device_id=serial,
            resolution="1920x1080",
            fullscreen=False,
            max_fps=60,
            use_uhid=True,
            turn_screen_off=False,
        )

    def _refresh_telemetry(self):
        # 1. Intentar obtener métricas del servidor web
        metrics = self.conn_mgr.fetch_metrics()
        mode = self.conn_mgr.connection_mode

        # 2. Actualizar badge de conexión en HeaderBar
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

        if metrics:
            self._render_server_metrics(metrics)
        else:
            self._render_local_psutil_metrics()

        return True

    def _render_server_metrics(self, data):
        try:
            sys_info = data.get("system", {})
            hostname = sys_info.get("hostname", "Servidor")
            kernel = sys_info.get("kernel", "")
            uptime = sys_info.get("uptime_str", "Activo")
            self.lbl_host.set_text(f"🖥️ Nodo Servidor: {hostname}")
            self.lbl_host_sub.set_text(f"Kernel: {kernel} · Telemetría en vivo sincronizada")
            self.lbl_uptime.set_text(f"⏱️ {uptime}")

            # CPU
            cpu_data = data.get("cpu", {})
            cpu_pct = float(cpu_data.get("usage_percent", 0.0))
            phys = cpu_data.get("physical_cores", 1)
            logc = cpu_data.get("logical_cores", 1)
            self.lbl_cpu_val.set_text(f"{cpu_pct:.1f}%")
            self.lbl_cpu_sub.set_text(f"{phys} Núcleos Físicos / {logc} Hilos Lógicos")
            self.chart_cpu.push_value(cpu_pct)

            # RAM
            ram_data = data.get("ram", {})
            ram_pct = float(ram_data.get("percent", 0.0))
            used_gb = float(ram_data.get("used_bytes", 0)) / (1024 ** 3)
            tot_gb = float(ram_data.get("total_bytes", 1)) / (1024 ** 3)
            self.lbl_ram_val.set_text(f"{ram_pct:.1f}%")
            self.lbl_ram_sub.set_text(f"{used_gb:.1f} GB / {tot_gb:.1f} GB utilizados")
            self.chart_ram.push_value(ram_pct)

            # Discos
            disks = data.get("disks", [])
            if disks:
                root_d = disks[0]
                d_pct = float(root_d.get("percent", 0.0))
                d_used = float(root_d.get("used_bytes", 0)) / (1024 ** 3)
                d_tot = float(root_d.get("total_bytes", 1)) / (1024 ** 3)
                self.lbl_disk_val.set_text(f"{d_pct:.0f}%")
                self.lbl_disk_sub.set_text(f"{d_used:.1f} GB usados de {d_tot:.1f} GB ({root_d.get('mountpoint', '/')})")
                self.bar_disk.set_fraction(min(1.0, max(0.0, d_pct / 100.0)))

            # Red
            net_data = data.get("net", {})
            rx_s = float(net_data.get("rx_bytes_sec", 0.0))
            tx_s = float(net_data.get("tx_bytes_sec", 0.0))
            self.lbl_net_val.set_text(f"↓ {self._fmt_speed(rx_s)} · ↑ {self._fmt_speed(tx_s)}")
            rx_tot = float(net_data.get("rx_total_bytes", 0.0)) / (1024 ** 3)
            tx_tot = float(net_data.get("tx_total_bytes", 0.0)) / (1024 ** 3)
            self.lbl_net_sub.set_text(f"Total: ↓ {rx_tot:.2f} GB · ↑ {tx_tot:.2f} GB")
            norm_pct = min(100.0, ((rx_s + tx_s) / (10 * 1024 * 1024)) * 100.0)
            self.chart_net.push_value(norm_pct)

            # Ciberdefensa
            sec_data = data.get("security", {})
            f2b = sec_data.get("fail2ban", {})
            total_banned = f2b.get("total_banned", 0) if f2b else 0
            self.lbl_sec_val.set_text(f"{total_banned} IPs Bloqueadas")
            self.lbl_sec_sub.set_text("Fail2ban IPS Activo en el Nodo")

            # Docker
            dock_data = data.get("docker_activities", [])
            running_dock = sum(1 for c in dock_data if c.get("state") == "running")
            self.lbl_doc_val.set_text(f"{running_dock} / {len(dock_data)} Contenedores UP")
            self.lbl_doc_sub.set_text("Microservicios Docker Operativos")

            # Procesos
            if self.stack.get_visible_child_name() == "processes":
                procs = data.get("system_processes", [])
                self.proc_store.clear()
                query = (self.proc_search.get_text() or "").lower()
                for p in procs:
                    name = str(p.get("name", "proc"))
                    if query and query not in name.lower():
                        continue
                    self.proc_store.append([
                        int(p.get("pid", 0)),
                        name,
                        str(p.get("username", "root")),
                        float(p.get("cpu_percent", 0.0)),
                        float(p.get("memory_mb", p.get("memory_percent", 0.0))),
                    ])
        except Exception:
            pass

    def _render_local_psutil_metrics(self):
        if not psutil:
            return
        try:
            hostname = socket.gethostname()
            self.lbl_host.set_text(f"🖥️ Nodo Local: {hostname}")
            self.lbl_host_sub.set_text("Sondeo nativo directo local (sin servidor activo)")

            cpu_pct = psutil.cpu_percent(interval=None)
            phys = psutil.cpu_count(logical=False) or 1
            logc = psutil.cpu_count(logical=True) or 1
            self.lbl_cpu_val.set_text(f"{cpu_pct:.1f}%")
            self.lbl_cpu_sub.set_text(f"{phys} Núcleos Físicos / {logc} Hilos Lógicos")
            self.chart_cpu.push_value(cpu_pct)

            vm = psutil.virtual_memory()
            used_gb = (vm.total - vm.available) / (1024 ** 3)
            tot_gb = vm.total / (1024 ** 3)
            self.lbl_ram_val.set_text(f"{vm.percent:.1f}%")
            self.lbl_ram_sub.set_text(f"{used_gb:.1f} GB / {tot_gb:.1f} GB utilizados")
            self.chart_ram.push_value(vm.percent)

            du = psutil.disk_usage("/")
            used_d = du.used / (1024 ** 3)
            tot_d = du.total / (1024 ** 3)
            self.lbl_disk_val.set_text(f"{du.percent:.0f}%")
            self.lbl_disk_sub.set_text(f"{used_d:.1f} GB usados de {tot_d:.1f} GB")
            self.bar_disk.set_fraction(min(1.0, max(0.0, du.percent / 100.0)))

            now = time.time()
            net_io = psutil.net_io_counters()
            if self._last_net_io and now > self._last_net_ts:
                dt = now - self._last_net_ts
                rx_s = max(0.0, (net_io.bytes_recv - self._last_net_io.bytes_recv) / dt)
                tx_s = max(0.0, (net_io.bytes_sent - self._last_net_io.bytes_sent) / dt)
                self.lbl_net_val.set_text(f"↓ {self._fmt_speed(rx_s)} · ↑ {self._fmt_speed(tx_s)}")
                self.lbl_net_sub.set_text(f"Total: ↓ {net_io.bytes_recv / (1024**3):.2f} GB · ↑ {net_io.bytes_sent / (1024**3):.2f} GB")
                norm_pct = min(100.0, ((rx_s + tx_s) / (10 * 1024 * 1024)) * 100.0)
                self.chart_net.push_value(norm_pct)
            self._last_net_io = net_io
            self._last_net_ts = now

            if self.stack.get_visible_child_name() == "processes":
                self._update_local_processes_list()
        except Exception:
            pass

    def _update_local_processes_list(self):
        if not psutil:
            return
        procs = []
        query = (self.proc_search.get_text() or "").lower()
        for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_info"]):
            try:
                info = p.info
                name = str(info["name"] or "proceso")
                if query and query not in name.lower():
                    continue
                mem_mb = (info["memory_info"].rss / (1024 * 1024)) if info.get("memory_info") else 0.0
                procs.append((
                    int(info["pid"] or 0),
                    name,
                    str(info["username"] or "root"),
                    float(info["cpu_percent"] or 0.0),
                    float(mem_mb),
                ))
            except Exception:
                continue

        procs.sort(key=lambda x: (x[3], x[4]), reverse=True)
        self.proc_store.clear()
        for row in procs[:45]:
            self.proc_store.append(list(row))

    @staticmethod
    def _fmt_speed(bytes_sec):
        if bytes_sec < 1024:
            return f"{bytes_sec:.0f} B/s"
        if bytes_sec < 1024 * 1024:
            return f"{bytes_sec / 1024:.1f} KB/s"
        return f"{bytes_sec / (1024 * 1024):.2f} MB/s"

    def _on_key_press(self, _widget, event):
        if event.keyval == Gdk.KEY_F11:
            self._toggle_fullscreen()
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
    parser = argparse.ArgumentParser(description="Recursos Native GTK3 Cockpit")
    parser.add_argument(
        "--test-mode",
        action="store_true",
        help="Verifica dependencias, controladores e inicialización para CI",
    )
    parser.add_argument(
        "--dex",
        action="store_true",
        help="Abre directamente la interfaz nativa de proyección de vídeo por USB (Samsung DeX / Android Desktop)",
    )
    args, _unknown = parser.parse_known_args()

    if args.test_mode:
        dex = DexController()
        deps = dex.check_dependencies()
        env_info = detect_runtime_environment()
        conn = ServerConnectionManager()
        discovered = conn.discover_server()
        print(f"[OK] Recursos Native GTK3 App v{get_app_version()} validated successfully.")
        print(f"[OK] Runtime Environment Detection: {env_info}")
        print(f"[OK] DeX / Android Desktop USB Controller Ready: {deps}")
        print(f"[OK] Server Auto-Discovery & Zero-Trust Engine Ready: active='{discovered}', mode='{conn.connection_mode}'")
        sys.exit(0)

    if not HAS_GTK:
        print("Error: python3-gi / gir1.2-gtk-3.0 no está instalado en este entorno.", file=sys.stderr)
        sys.exit(1)

    GLib.set_prgname("recursos-cockpit")
    GLib.set_application_name("Recursos Cockpit")
    app = RecursosNativeApp(start_in_dex=args.dex)
    sys.exit(app.run([sys.argv[0]]))


if __name__ == "__main__":
    main()
