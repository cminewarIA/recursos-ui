#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recursos Cockpit · Aplicación Nativa de Escritorio para Linux
=============================================================
Combina el Centro de Telemetría y Ciberdefensa Cockpit con el
entorno exclusivo de proyección Samsung DeX y Android Desktop.
Desarrollada nativamente con GTK 3 y WebKit2GTK (sin Electron).
"""

import os
import sys
import argparse
import threading
import time
import subprocess
import signal

# Soporte para ejecución en modo test sin interfaz gráfica o display
IS_TEST_MODE = "--test-mode" in sys.argv or os.environ.get("RECURSOS_TEST_MODE") == "1"

if not IS_TEST_MODE:
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('WebKit2', '4.1')
    from gi.repository import Gtk, Gdk, GLib, WebKit2, Gio, GdkPixbuf

# Importar motor DeX local
try:
    from dex_controller import DexController
except ImportError:
    from desktop_app.dex_controller import DexController

DEFAULT_DASHBOARD_URL = os.environ.get("RECURSOS_URL", "http://127.0.0.1:8085")

class RecursosDesktopApp:
    def __init__(self, target_url=DEFAULT_DASHBOARD_URL):
        self.target_url = target_url
        self.dex = DexController(log_callback=self.on_dex_log)
        self.log_buffer = []
        self.detected_devices = []
        self.active_tab = "cockpit"

        if IS_TEST_MODE:
            print("[TEST MODE] RecursosDesktopApp inicializada correctamente en modo sin interfaz gráfica.")
            return

        self._build_ui()
        self._start_device_monitor()

    def _build_ui(self):
        # 1. Ventana Principal GTK
        self.window = Gtk.Window(title="Recursos Cockpit & Modo DeX")
        self.window.set_default_size(1280, 800)
        self.window.set_position(Gtk.WindowPosition.CENTER)

        # Icono de la ventana
        icon_path = os.path.join(os.path.dirname(__file__), "assets", "recursos-cockpit.svg")
        if os.path.exists(icon_path):
            self.window.set_icon_from_file(icon_path)

        # 2. HeaderBar Nativa Estilo GNOME / Adwaita
        self.header = Gtk.HeaderBar()
        self.header.set_show_close_button(True)
        self.header.set_title("Recursos Cockpit")
        self.header.set_subtitle("Telemetría 60 FPS & Samsung DeX Station")
        self.window.set_titlebar(self.header)

        # Botón de Recargar Cockpit
        self.btn_refresh = Gtk.Button.new_from_icon_name("view-refresh-symbolic", Gtk.IconSize.BUTTON)
        self.btn_refresh.set_tooltip_text("Recargar Panel Web (Ctrl+R)")
        self.btn_refresh.connect("clicked", lambda b: self.webview.reload() if hasattr(self, 'webview') else None)
        self.header.pack_start(self.btn_refresh)

        # Selector de Modos (Cockpit vs DeX)
        self.mode_stack_switcher = Gtk.StackSwitcher()
        self.header.set_custom_title(self.mode_stack_switcher)

        # Botón Pantalla Completa
        self.btn_fullscreen = Gtk.Button.new_from_icon_name("view-fullscreen-symbolic", Gtk.IconSize.BUTTON)
        self.btn_fullscreen.set_tooltip_text("Pantalla Completa (F11)")
        self.btn_fullscreen.connect("clicked", self._toggle_fullscreen)
        self.header.pack_end(self.btn_fullscreen)

        # 3. Stack Principal de Vistas
        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.CROSSFADE)
        self.stack.set_transition_duration(250)
        self.mode_stack_switcher.set_stack(self.stack)

        # --- VISTA 1: COCKPIT WEBVIEW ---
        self.cockpit_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.webview = WebKit2.WebView()
        settings = self.webview.get_settings()
        settings.set_enable_developer_extras(True)
        settings.set_enable_webgl(True)
        settings.set_enable_smooth_scrolling(True)
        settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)

        self.webview.load_uri(self.target_url)
        self.cockpit_box.pack_start(self.webview, True, True, 0)
        self.stack.add_titled(self.cockpit_box, "cockpit", "🛸 Cockpit")

        # --- VISTA 2: MODO DEX EXCLUSIVO ---
        self.dex_box = self._create_dex_ui()
        self.stack.add_titled(self.dex_box, "dex", "📱 Modo DeX")

        self.window.add(self.stack)

        # Atajos de teclado
        self.window.connect("key-press-event", self._on_key_press)
        self.window.connect("destroy", self._on_window_destroy)

    def _create_dex_ui(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        box.set_margin_top(20)
        box.set_margin_bottom(20)
        box.set_margin_start(24)
        box.set_margin_end(24)

        # Cabecera Bento DeX
        banner_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        lbl_icon = Gtk.Label()
        lbl_icon.set_markup("<span font='36'>📱</span>")
        banner_box.pack_start(lbl_icon, False, False, 0)

        info_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        lbl_title = Gtk.Label()
        lbl_title.set_markup("<span font='18' weight='bold'>Estación de Trabajo Samsung DeX & Android Desktop</span>")
        lbl_title.set_xalign(0)
        lbl_desc = Gtk.Label()
        lbl_desc.set_markup("<span color='#888888'>Función nativa exclusiva de la aplicación de escritorio. Control por hardware UHID, aceleración a 60 FPS y audio integrado.</span>")
        lbl_desc.set_xalign(0)
        info_box.pack_start(lbl_title, False, False, 0)
        info_box.pack_start(lbl_desc, False, False, 0)
        banner_box.pack_start(info_box, True, True, 0)
        box.pack_start(banner_box, False, False, 0)

        # Panel de Dispositivos Conectados
        frame_devs = Gtk.Frame(label="Dispositivos Móviles Detectados (USB / Wi-Fi)")
        self.devs_list_box = Gtk.ListBox()
        self.devs_list_box.set_selection_mode(Gtk.SelectionMode.SINGLE)
        frame_devs.add(self.devs_list_box)
        box.pack_start(frame_devs, False, False, 0)

        # Barra de Acciones Rápidas
        actions_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)

        self.btn_start_dex = Gtk.Button.new_with_label("🚀 Iniciar Samsung DeX (Pantalla Completa)")
        self.btn_start_dex.get_style_context().add_class("suggested-action")
        self.btn_start_dex.connect("clicked", self._on_start_dex_clicked)
        actions_bar.pack_start(self.btn_start_dex, True, True, 0)

        self.btn_start_windowed = Gtk.Button.new_with_label("🪟 Iniciar en Ventana")
        self.btn_start_windowed.connect("clicked", lambda b: self._on_start_dex_clicked(b, fullscreen=False))
        actions_bar.pack_start(self.btn_start_windowed, False, False, 0)

        self.btn_enable_wifi = Gtk.Button.new_with_label("📶 Activar Modo Wi-Fi (Sin Cables)")
        self.btn_enable_wifi.connect("clicked", self._on_enable_wifi_clicked)
        actions_bar.pack_start(self.btn_enable_wifi, False, False, 0)

        self.btn_stop_dex = Gtk.Button.new_with_label("⏹️ Detener")
        self.btn_stop_dex.get_style_context().add_class("destructive-action")
        self.btn_stop_dex.connect("clicked", lambda b: self.dex.stop_session())
        actions_bar.pack_start(self.btn_stop_dex, False, False, 0)

        box.pack_start(actions_bar, False, False, 0)

        # Terminal de Logs / Estado en Vivo
        frame_logs = Gtk.Frame(label="Registro de Conexión & Diagnósticos DeX")
        scrolled = Gtk.ScrolledWindow()
        scrolled.set_min_content_height(220)
        self.log_text_view = Gtk.TextView()
        self.log_text_view.set_editable(False)
        self.log_text_view.set_cursor_visible(False)
        self.log_text_buffer = self.log_text_view.get_buffer()
        scrolled.add(self.log_text_view)
        frame_logs.add(scrolled)
        box.pack_start(frame_logs, True, True, 0)

        return box

    def on_dex_log(self, msg, level="INFO"):
        ts = time.strftime("%H:%M:%S")
        entry = f"[{ts}] [{level}] {msg}\n"
        if not IS_TEST_MODE:
            GLib.idle_add(self._append_log_ui, entry)
        else:
            print(entry, end="")

    def _append_log_ui(self, entry):
        if hasattr(self, 'log_text_buffer'):
            iter_end = self.log_text_buffer.get_end_iter()
            self.log_text_buffer.insert(iter_end, entry)
            # Auto scroll
            adj = self.log_text_view.get_vadjustment()
            adj.set_value(adj.get_upper() - adj.get_page_size())
        return False

    def _start_device_monitor(self):
        """Hilo en segundo plano para escanear dispositivos ADB periódicamente."""
        def monitor_loop():
            while True:
                devs = self.dex.list_connected_devices()
                GLib.idle_add(self._update_devices_ui, devs)
                time.sleep(3.0)

        t = threading.Thread(target=monitor_loop, daemon=True)
        t.start()

    def _update_devices_ui(self, devs):
        self.detected_devices = devs
        # Limpiar list box
        for row in self.devs_list_box.get_children():
            self.devs_list_box.remove(row)

        if not devs:
            row = Gtk.ListBoxRow()
            lbl = Gtk.Label(label="Esperando conexión USB de tu móvil Samsung o Android (Activa 'Depuración USB')...")
            lbl.set_margin_top(12)
            lbl.set_margin_bottom(12)
            row.add(lbl)
            self.devs_list_box.add(row)
        else:
            for d in devs:
                row = Gtk.ListBoxRow()
                box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
                box.set_margin_top(8)
                box.set_margin_bottom(8)
                box.set_margin_start(12)
                box.set_margin_end(12)

                badge = "📱 Samsung Galaxy" if d["is_samsung"] else "📲 Android"
                conn_type = "📶 Wi-Fi" if d["is_wireless"] else "🔌 Cable USB"

                lbl_main = Gtk.Label()
                lbl_main.set_markup(f"<b>{d['model']}</b> ({d['id']}) · <span color='#00D2FF'>{badge}</span> · <span color='#30D158'>{conn_type}</span>")
                lbl_main.set_xalign(0)
                box.pack_start(lbl_main, True, True, 0)

                row.add(box)
                self.devs_list_box.add(row)

        self.devs_list_box.show_all()
        return False

    def _on_start_dex_clicked(self, btn, fullscreen=True):
        selected_id = None
        if self.detected_devices:
            selected_id = self.detected_devices[0]["id"]

        self.dex.log(f"Iniciando DeX (Pantalla completa: {fullscreen})...")
        threading.Thread(target=self.dex.start_dex_session, kwargs={"device_id": selected_id, "fullscreen": fullscreen}, daemon=True).start()

    def _on_enable_wifi_clicked(self, btn):
        selected_id = None
        if self.detected_devices:
            selected_id = self.detected_devices[0]["id"]
        if not selected_id:
            self.dex.log("Conecta primero el móvil por USB para activar el modo Wi-Fi.", "WARN")
            return
        threading.Thread(target=self.dex.enable_wireless_mode, args=(selected_id,), daemon=True).start()

    def _toggle_fullscreen(self, btn):
        if self.window.get_window().get_state() & Gdk.WindowState.FULLSCREEN:
            self.window.unfullscreen()
        else:
            self.window.fullscreen()

    def _on_key_press(self, widget, event):
        # F11: Fullscreen
        if event.keyval == Gdk.KEY_F11:
            self._toggle_fullscreen(None)
            return True
        # Ctrl+R: Recargar webview
        elif (event.state & Gdk.ModifierType.CONTROL_MASK) and event.keyval in (Gdk.KEY_r, Gdk.KEY_R):
            if hasattr(self, 'webview'):
                self.webview.reload()
            return True
        # Ctrl+D: Conmutar a Modo DeX
        elif (event.state & Gdk.ModifierType.CONTROL_MASK) and event.keyval in (Gdk.KEY_d, Gdk.KEY_D):
            current = self.stack.get_visible_child_name()
            self.stack.set_visible_child_name("dex" if current == "cockpit" else "cockpit")
            return True
        return False

    def _on_window_destroy(self, widget):
        self.dex.stop_session()
        Gtk.main_quit()

    def run(self):
        if IS_TEST_MODE:
            return 0
        self.window.show_all()
        Gtk.main()
        return 0

def main():
    parser = argparse.ArgumentParser(description="Recursos Cockpit · App Nativa Linux con Modo DeX")
    parser.add_argument("--url", default=DEFAULT_DASHBOARD_URL, help="URL del servidor Cockpit")
    parser.add_argument("--test-mode", action="store_true", help="Ejecutar en modo test sin interfaz gráfica")
    args = parser.parse_args()

    app = RecursosDesktopApp(target_url=args.url)
    return app.run()

if __name__ == "__main__":
    sys.exit(main())
