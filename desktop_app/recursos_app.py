#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recursos — Aplicación Nativa de Escritorio Linux (100% Puro GTK 3)
Sin WebKit, sin navegador embebido. Interfaz nativa real con widgets GTK,
gráficas de telemetría renderizadas con Cairo y pestaña exclusiva de espera y
proyección de vídeo por USB para móviles con Samsung DeX o Modo Escritorio de Android.
"""

import argparse
import collections
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
    background-color: #0b0e14;
    color: #f3f4f6;
}
headerbar {
    background-image: none;
    background-color: #111520;
    color: #f3f4f6;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.card {
    background-color: #151924;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 18px;
}
.card-highlight {
    background-color: #171d2b;
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 16px;
    padding: 24px;
}
.title-xl {
    font-size: 22px;
    font-weight: 800;
    color: #ffffff;
}
.title-lg {
    font-size: 16px;
    font-weight: 700;
    color: #f8fafc;
}
.metric-big {
    font-size: 28px;
    font-weight: 800;
    color: #38bdf8;
}
.subtitle {
    font-size: 12px;
    color: #94a3b8;
}
.badge-ready {
    background-color: rgba(16, 185, 129, 0.18);
    color: #34d399;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    font-size: 11px;
}
.badge-wait {
    background-color: rgba(245, 158, 11, 0.18);
    color: #fbbf24;
    border-radius: 8px;
    padding: 6px 14px;
    font-weight: 700;
    font-size: 12px;
}
.btn-primary {
    background-image: none;
    background-color: #0284c7;
    color: #ffffff;
    font-weight: 700;
    border-radius: 10px;
    padding: 10px 20px;
    border: none;
}
.btn-primary:hover {
    background-color: #0369a1;
}
.btn-danger {
    background-image: none;
    background-color: #e11d48;
    color: #ffffff;
    font-weight: 700;
    border-radius: 10px;
    padding: 10px 20px;
    border: none;
}
"""


class CairoSparkline(Gtk.DrawingArea):
    """Widget nativo GTK que dibuja una gráfica de telemetría suave usando Cairo."""

    def __init__(self, rgb_color=(0.22, 0.74, 0.97), max_points=60):
        super().__init__()
        self.rgb = rgb_color
        self.history = collections.deque([0.0] * max_points, maxlen=max_points)
        self.set_size_request(-1, 90)
        self.connect("draw", self.on_draw)

    def push_value(self, val):
        self.history.append(max(0.0, min(100.0, float(val))))
        self.queue_draw()

    def on_draw(self, widget, cr):
        alloc = self.get_allocation()
        w = alloc.width
        h = alloc.height
        if w <= 2 or h <= 2:
            return False

        # Fondo oscuro
        cr.set_source_rgba(0.05, 0.07, 0.10, 0.9)
        cr.rectangle(0, 0, w, h)
        cr.fill()

        # Líneas guía horizontales
        cr.set_source_rgba(1.0, 1.0, 1.0, 0.06)
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

        # Relleno bajo la curva
        r, g, b = self.rgb
        cr.set_source_rgba(r, g, b, 0.18)
        cr.move_to(coords[0][0], h)
        for x, y in coords:
            cr.line_to(x, y)
        cr.line_to(coords[-1][0], h)
        cr.close_path()
        cr.fill()

        # Trazo principal
        cr.set_source_rgba(r, g, b, 0.95)
        cr.set_line_width(2.2)
        cr.move_to(coords[0][0], coords[0][1])
        for x, y in coords[1:]:
            cr.line_to(x, y)
        cr.stroke()
        return False


def detect_runtime_environment(force_env=None):
    """
    Detecta dinámicamente el entorno de ejecución (nativo, móvil o web).
    Si se ejecuta en un entorno nativo o móvil, oculta cualquier pestaña de navegación
    'Dispositivo' (o pestañas no web) y activa directamente la pantalla de espera
    optimizada para proyección por USB (Samsung DeX / Android Desktop).
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
        "hide_device_tab": True,
        "render_usb_projection_wait_screen": is_native_or_mobile,
    }


class RecursosNativeWindow(Gtk.ApplicationWindow):
    def __init__(self, app, start_in_dex=True, env_info=None):
        self.env_info = env_info or detect_runtime_environment()
        super().__init__(
            application=app,
            title=f"Recursos — Proyección USB (Samsung DeX / Android Desktop) v{get_app_version()}",
        )
        self.set_default_size(980, 660)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.is_fullscreen = False
        self.auto_launched_serials = set()

        self._apply_css()
        self._set_app_icon()
        self.dex = DexController(on_status_change=self._on_dex_status_callback)

        # Variables de red para cálculo de caudal
        self._last_net_io = psutil.net_io_counters() if psutil else None
        self._last_net_ts = time.time()

        self._build_headerbar()
        self._build_main_layout()

        # En entorno nativo o móvil se muestra directamente la pantalla de espera de proyección USB
        if self.env_info.get("render_usb_projection_wait_screen", True) or start_in_dex:
            self.stack.set_visible_child_name("usb_wait_screen")

        self.connect("key-press-event", self._on_key_press)

        # Timers nativos GLib
        self._refresh_usb_devices()
        GLib.timeout_add(2000, self._refresh_usb_devices)
        if not self.env_info.get("render_usb_projection_wait_screen", True):
            self._refresh_telemetry()
            GLib.timeout_add(1500, self._refresh_telemetry)

    def _set_app_icon(self):
        """Asigna el icono oficial del Dragón Rojo a la ventana GTK."""
        icon_candidates = [
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit.png"),
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit.svg"),
            "/usr/lib/recursos-cockpit/assets/recursos-cockpit.png",
            "/usr/share/icons/hicolor/512x512/apps/recursos-cockpit.png",
            "/usr/share/pixmaps/recursos-cockpit.png",
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
        hb.props.title = "Recursos"
        hb.props.subtitle = (
            f"v{get_app_version()} · Proyección USB (Samsung DeX / Android Desktop)"
        )

        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.SLIDE_LEFT_RIGHT)
        self.stack.set_transition_duration(200)

        # En entorno nativo/móvil ocultamos automáticamente la pestaña 'Dispositivo'
        # y cualquier barra de pestañas no web para mostrar únicamente la pantalla de espera USB
        self.switcher = Gtk.StackSwitcher()
        self.switcher.set_stack(self.stack)
        if self.env_info.get("is_native_or_mobile", True):
            self.switcher.set_no_show_all(True)
            self.switcher.set_visible(False)
        else:
            hb.set_custom_title(self.switcher)

        # Etiqueta de versión en la barra superior
        ver_badge = Gtk.Label(label=f"v{get_app_version()}")
        ver_badge.get_style_context().add_class("badge-ready")
        hb.pack_start(ver_badge)

        # Botón Pantalla Completa (F11)
        btn_fs = Gtk.Button(label="⛶ Pantalla Completa")
        btn_fs.set_tooltip_text("Alternar pantalla completa (F11)")
        btn_fs.connect("clicked", lambda *_: self._toggle_fullscreen())
        hb.pack_end(btn_fs)

        # Botón Acerca de con Logo Oficial Dragón
        btn_about = Gtk.Button.new_from_icon_name("help-about-symbolic", Gtk.IconSize.BUTTON)
        btn_about.set_tooltip_text(f"Acerca de Recursos Cockpit (v{get_app_version()})")
        btn_about.connect("clicked", self._show_about_dialog)
        hb.pack_end(btn_about)

        self.set_titlebar(hb)

    def _show_about_dialog(self, widget):
        """Muestra el diálogo nativo Acerca de con el logo del Dragón Rojo."""
        about = Gtk.AboutDialog(transient_for=self, modal=True)
        about.set_program_name("Recursos Cockpit")
        about.set_version(f"v{get_app_version()}")
        about.set_comments("Monitor de Silicio Nativo 60 FPS & Estación de Proyección USB por Hardware (Scrcpy + UHID)")
        about.set_website("https://github.com/cminewarIA/recursos-ui")
        about.set_website_label("GitHub cminewarIA/recursos-ui")
        about.set_authors(["cminewarIA"])
        about.set_license_type(Gtk.License.MIT_X11)

        logo_candidates = [
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit.png"),
            os.path.join(SCRIPT_DIR, "assets", "recursos-cockpit-logo.png"),
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
        # Si se detecta entorno nativo o móvil, ocultamos cualquier pestaña 'Dispositivo'
        # y renderizamos exclusivamente la pantalla de espera optimizada para proyección USB
        device_page = self._build_device_connection_ui()
        self.stack.add_named(device_page, "usb_wait_screen")

        if not self.env_info.get("is_native_or_mobile", True):
            telemetry_page = self._build_telemetry_ui()
            self.stack.add_titled(telemetry_page, "telemetry", "📊 Telemetría del Sistema")
            procs_page = self._build_processes_ui()
            self.stack.add_titled(procs_page, "processes", "⚙️ Procesos del Kernel")

        self.add(self.stack)

    def _build_telemetry_ui(self):
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)

        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        vbox.set_margin_top(20)
        vbox.set_margin_bottom(20)
        vbox.set_margin_start(24)
        vbox.set_margin_end(24)

        # Banner de Identidad del Host
        host_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        host_card.get_style_context().add_class("card")

        host_info_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        hostname = socket.gethostname()
        os_release = f"{platform.system()} {platform.release()} ({platform.machine()})"
        lbl_host = Gtk.Label(label=f"🖥️ Nodo Local: {hostname}", xalign=0)
        lbl_host.get_style_context().add_class("title-xl")
        self.lbl_host_sub = Gtk.Label(label=f"Kernel: {os_release} · Sondeo nativo directo", xalign=0)
        self.lbl_host_sub.get_style_context().add_class("subtitle")
        host_info_box.pack_start(lbl_host, False, False, 0)
        host_info_box.pack_start(self.lbl_host_sub, False, False, 0)

        host_card.pack_start(host_info_box, True, True, 0)

        self.lbl_uptime = Gtk.Label(label="Activo", xalign=1)
        self.lbl_uptime.get_style_context().add_class("badge-ready")
        host_card.pack_end(self.lbl_uptime, False, False, 0)

        vbox.pack_start(host_card, False, False, 0)

        # Grid 2x2 de Pilares de Hardware
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

        vbox.pack_start(grid, True, True, 0)
        scroll.add(vbox)
        return scroll

    def _build_device_connection_ui(self):
        """
        Interfaz nativa centrada exclusivamente en esperar la conexión por USB
        de un dispositivo móvil para proyectar el vídeo de Samsung DeX o el Modo Escritorio de Android.
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

        # Icono visual grande USB -> Monitor
        self.lbl_usb_icon = Gtk.Label(label="🔌  📱 ➔ 🖥️")
        attr_list = Pango.AttrList()
        attr_list.insert(Pango.attr_scale_new(2.6))
        self.lbl_usb_icon.set_attributes(attr_list)
        card.pack_start(self.lbl_usb_icon, False, False, 4)

        # Estado principal
        self.lbl_device_wait_title = Gtk.Label(
            label="Esperando que conectes un dispositivo por USB"
        )
        self.lbl_device_wait_title.get_style_context().add_class("title-xl")
        self.lbl_device_wait_title.set_justify(Gtk.Justification.CENTER)
        self.lbl_device_wait_title.set_line_wrap(True)
        card.pack_start(self.lbl_device_wait_title, False, False, 0)

        # Subtítulo descriptivo de proyección USB para Samsung DeX / Modo Escritorio Android
        self.lbl_device_wait_desc = Gtk.Label(
            label=(
                "Conecta tu teléfono móvil mediante cable USB para proyectar el vídeo en baja latencia "
                "con Samsung DeX o el Modo Escritorio de Android."
            )
        )
        self.lbl_device_wait_desc.get_style_context().add_class("subtitle")
        self.lbl_device_wait_desc.set_justify(Gtk.Justification.CENTER)
        self.lbl_device_wait_desc.set_line_wrap(True)
        self.lbl_device_wait_desc.set_max_width_chars(72)
        card.pack_start(self.lbl_device_wait_desc, False, False, 0)

        # Spinner + Badge de estado en tiempo real
        status_pill_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        status_pill_box.set_halign(Gtk.Align.CENTER)

        self.usb_spinner = Gtk.Spinner()
        self.usb_spinner.start()
        status_pill_box.pack_start(self.usb_spinner, False, False, 0)

        self.lbl_usb_live_badge = Gtk.Label(
            label="Escuchando puerto USB en tiempo real (Samsung DeX / Android Desktop Mode)..."
        )
        self.lbl_usb_live_badge.get_style_context().add_class("badge-wait")
        status_pill_box.pack_start(self.lbl_usb_live_badge, False, False, 0)

        card.pack_start(status_pill_box, False, False, 4)

        # Contenedor dinámico que muestra el dispositivo USB cuando es detectado
        self.usb_device_action_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.usb_device_action_box.set_halign(Gtk.Align.CENTER)
        card.pack_start(self.usb_device_action_box, False, False, 4)

        # Opción de lanzamiento automático al conectar el cable USB
        auto_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        auto_box.set_halign(Gtk.Align.CENTER)
        self.chk_auto_project_usb = Gtk.CheckButton(
            label="Iniciar proyección de vídeo automáticamente al conectar el móvil por USB"
        )
        self.chk_auto_project_usb.set_active(True)
        auto_box.pack_start(self.chk_auto_project_usb, False, False, 0)
        card.pack_start(auto_box, False, False, 2)

        outer.pack_start(card, False, False, 0)
        return outer

    def _build_processes_ui(self):
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        vbox.set_margin_top(18)
        vbox.set_margin_bottom(18)
        vbox.set_margin_start(22)
        vbox.set_margin_end(22)

        lbl = Gtk.Label(label="Procesos Activos del Sistema (Top CPU / Memoria)", xalign=0)
        lbl.get_style_context().add_class("title-lg")
        vbox.pack_start(lbl, False, False, 0)

        scroll = Gtk.ScrolledWindow()
        scroll.set_vexpand(True)

        self.proc_store = Gtk.ListStore(int, str, str, float, float)
        tree = Gtk.TreeView(model=self.proc_store)

        cols = [
            ("PID", 0),
            ("Proceso", 1),
            ("Usuario", 2),
            ("CPU %", 3),
            ("RAM (MB)", 4),
        ]
        for title, idx in cols:
            renderer = Gtk.CellRendererText()
            if idx in (3, 4):
                col = Gtk.TreeViewColumn(title, renderer)
                col.set_cell_data_func(
                    renderer,
                    lambda _col, cell, model, it, i=idx: cell.set_property(
                        "text", f"{model.get_value(it, i):.1f}"
                    ),
                )
            else:
                col = Gtk.TreeViewColumn(title, renderer, text=idx)
            col.set_resizable(True)
            tree.append_column(col)

        scroll.add(tree)
        vbox.pack_start(scroll, True, True, 0)
        return vbox

    def _on_dex_status_callback(self, message, level="info"):
        GLib.idle_add(self._update_status_badge, message, level)

    def _update_status_badge(self, message, level):
        self.lbl_usb_live_badge.set_text(message)
        ctx = self.lbl_usb_live_badge.get_style_context()
        if level == "success":
            ctx.remove_class("badge-wait")
            ctx.add_class("badge-ready")
        else:
            ctx.remove_class("badge-ready")
            ctx.add_class("badge-wait")
        return False

    def _refresh_usb_devices(self):
        threading.Thread(target=self._probe_usb_devices_worker, daemon=True).start()
        return True

    def _probe_usb_devices_worker(self):
        devices = self.dex.list_connected_devices(usb_only=True)
        GLib.idle_add(self._apply_usb_devices_to_ui, devices)

    def _apply_usb_devices_to_ui(self, devices):
        for child in self.usb_device_action_box.get_children():
            self.usb_device_action_box.remove(child)

        if not devices:
            self.auto_launched_serials.clear()
            self.usb_spinner.start()
            self.usb_spinner.set_visible(True)
            self.lbl_device_wait_title.set_text("Esperando que conectes un dispositivo por USB")
            self.lbl_device_wait_desc.set_text(
                "Conecta tu teléfono móvil mediante cable USB para proyectar el vídeo en baja latencia "
                "con Samsung DeX o el Modo Escritorio de Android."
            )
            if not self.dex.is_session_running():
                self._update_status_badge(
                    "Escuchando puerto USB en tiempo real (Samsung DeX / Android Desktop Mode)...",
                    "info",
                )
            self.usb_device_action_box.show_all()
            return False

        dev = devices[0]
        serial = dev.get("serial") or dev.get("id") or ""
        model = dev.get("model") or "Dispositivo Android"
        state = dev.get("state") or "unknown"
        mode_label = dev.get("desktop_mode_label") or "Samsung DeX / Modo Escritorio de Android"
        android_ver = dev.get("android_version")
        ver_suffix = f" · Android {android_ver}" if android_ver else ""

        if state == "device":
            self.usb_spinner.stop()
            self.usb_spinner.set_visible(False)
            self.lbl_device_wait_title.set_text(f"📱 {model} conectado por USB")
            self.lbl_device_wait_desc.set_text(
                f"Modo listo: {mode_label}{ver_suffix} (Serie USB: {serial})"
            )
            self._update_status_badge(
                f"Dispositivo USB listo para proyectar vídeo ({mode_label})",
                "success",
            )

            btn_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
            btn_row.set_halign(Gtk.Align.CENTER)

            btn_launch = Gtk.Button(
                label=f"🚀 Proyectar Vídeo por USB ({mode_label})"
            )
            btn_launch.get_style_context().add_class("btn-primary")
            btn_launch.connect("clicked", lambda *_, s=serial: self._launch_usb_projection(s))
            btn_row.pack_start(btn_launch, False, False, 0)

            if self.dex.is_session_running():
                btn_stop = Gtk.Button(label="⏹ Detener Proyección")
                btn_stop.get_style_context().add_class("btn-danger")
                btn_stop.connect("clicked", lambda *_: self.dex.stop_dex_session())
                btn_row.pack_start(btn_stop, False, False, 0)

            self.usb_device_action_box.pack_start(btn_row, False, False, 0)

            # Si está activada la proyección automática al conectar por USB, lanzarla una vez por conexión
            if (
                self.chk_auto_project_usb.get_active()
                and serial not in self.auto_launched_serials
                and not self.dex.is_session_running()
            ):
                self.auto_launched_serials.add(serial)
                self._launch_usb_projection(serial)
        else:
            self.usb_spinner.start()
            self.usb_spinner.set_visible(True)
            self.lbl_device_wait_title.set_text(f"Autorización USB pendiente en {model}")
            self.lbl_device_wait_desc.set_text(
                "Desbloquea la pantalla de tu móvil y acepta el diálogo de Depuración USB para proyectar Samsung DeX / Modo Escritorio."
            )
            self._update_status_badge(
                f"Esperando confirmación en pantalla del móvil ({serial})...",
                "warning",
            )

        self.usb_device_action_box.show_all()
        return False

    def _launch_usb_projection(self, serial):
        self.dex.start_dex_session(
            device_id=serial,
            resolution="1920x1080",
            fullscreen=False,
            max_fps=60,
            use_uhid=True,
            turn_screen_off=False,
        )

    def _refresh_telemetry(self):
        if not psutil:
            return True

        try:
            cpu_pct = psutil.cpu_percent(interval=None)
            cores_phys = psutil.cpu_count(logical=False) or 1
            cores_log = psutil.cpu_count(logical=True) or 1
            self.lbl_cpu_val.set_text(f"{cpu_pct:.1f}%")
            self.lbl_cpu_sub.set_text(f"{cores_phys} Núcleos Físicos / {cores_log} Hilos Lógicos")
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
                self.lbl_net_val.set_text(
                    f"↓ {self._fmt_speed(rx_s)} · ↑ {self._fmt_speed(tx_s)}"
                )
                self.lbl_net_sub.set_text(
                    f"Total: ↓ {net_io.bytes_recv / (1024**3):.2f} GB · ↑ {net_io.bytes_sent / (1024**3):.2f} GB"
                )
                norm_pct = min(100.0, ((rx_s + tx_s) / (10 * 1024 * 1024)) * 100.0)
                self.chart_net.push_value(norm_pct)
            self._last_net_io = net_io
            self._last_net_ts = now

            if self.stack.get_visible_child_name() == "processes":
                self._update_processes_list()
        except Exception:
            pass

        return True

    def _update_processes_list(self):
        if not psutil:
            return
        procs = []
        for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_info"]):
            try:
                info = p.info
                mem_mb = (info["memory_info"].rss / (1024 * 1024)) if info.get("memory_info") else 0.0
                procs.append(
                    (
                        int(info["pid"] or 0),
                        str(info["name"] or "proceso"),
                        str(info["username"] or "root"),
                        float(info["cpu_percent"] or 0.0),
                        float(mem_mb),
                    )
                )
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
        super().__init__(application_id="io.recursos.cockpit")
        self.win = None
        self.start_in_dex = start_in_dex

    def do_activate(self):
        if not self.win:
            self.win = RecursosNativeWindow(self, start_in_dex=self.start_in_dex)
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
        print(f"[OK] Recursos Native GTK3 App v{get_app_version()} validated successfully.")
        print(f"[OK] Runtime Environment Detection: {env_info}")
        print(f"[OK] DeX / Android Desktop USB Controller Ready: {deps}")
        sys.exit(0)

    if not HAS_GTK:
        print("Error: python3-gi / gir1.2-gtk-3.0 no está instalado en este entorno.", file=sys.stderr)
        sys.exit(1)

    app = RecursosNativeApp(start_in_dex=args.dex)
    sys.exit(app.run([sys.argv[0]]))


if __name__ == "__main__":
    main()
