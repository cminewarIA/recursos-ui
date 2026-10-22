#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recursos Cockpit · Aplicación Nativa de Escritorio para Linux
=============================================================
Aplicación 100% nativa en GTK 3 para monitorización en tiempo real
del silicio del sistema (CPU, RAM, Discos, Red) y conexión por
hardware interactiva con dispositivos móviles vía Scrcpy y UHID.
Sin dependencias de navegadores ni frameworks web embebidos.
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

try:
    import psutil
except ImportError:
    psutil = None

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, GLib, Gio, Pango

# Importar controlador de conexión de dispositivos
try:
    from dex_controller import DexController
except ImportError:
    from desktop_app.dex_controller import DexController


def get_native_app_version():
    """Obtiene la versión canónica desde el archivo VERSION."""
    candidates = [
        os.path.join(os.path.dirname(__file__), "VERSION"),
        os.path.join(os.path.dirname(__file__), "..", "VERSION"),
        "/usr/lib/recursos-cockpit/VERSION",
    ]
    for c in candidates:
        if os.path.isfile(c):
            try:
                with open(c, "r", encoding="utf-8") as f:
                    v = f.read().strip()
                    if v:
                        return v
            except Exception:
                pass
    return "6.0.2"


APP_VERSION = get_native_app_version()


class RecursosDesktopApp:
    def __init__(self):
        self.dex = DexController(log_callback=self.on_device_log)
        self.detected_devices = []
        self.running_session = False
        self.last_net_io = None
        self.last_net_time = time.time()

        if IS_TEST_MODE:
            print("[TEST MODE] Recursos Cockpit (App 100% Nativa GTK3) inicializada correctamente.")
            # Ejecución de verificación interna de widgets nativos
            self._verify_native_widgets_test()
            return

        self._build_ui()
        self._start_monitors()

    def _verify_native_widgets_test(self):
        """Verifica la inicialización de widgets nativos sin abrir display en modo test."""
        win = Gtk.OffscreenWindow()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        lbl = Gtk.Label(label="Esperando dispositivo para conectarse en su versión nativa")
        pbar = Gtk.ProgressBar()
        box.pack_start(lbl, True, True, 0)
        box.pack_start(pbar, True, True, 0)
        win.add(box)
        win.show_all()
        print("[TEST MODE] Widgets nativos verificados con éxito (OffscreenWindow, Label, ProgressBar).")

    def _build_ui(self):
        # 1. Ventana Principal GTK
        self.window = Gtk.Window(title="Recursos Cockpit · Sistema & Dispositivos")
        self.window.set_default_size(1080, 720)
        self.window.set_position(Gtk.WindowPosition.CENTER)

        # Icono de la ventana
        icon_path = os.path.join(os.path.dirname(__file__), "assets", "recursos-cockpit.svg")
        if os.path.exists(icon_path):
            self.window.set_icon_from_file(icon_path)

        # 2. HeaderBar Nativa Estilo GNOME Adwaita
        self.header = Gtk.HeaderBar()
        self.header.set_show_close_button(True)
        self.header.set_title("Recursos Cockpit")
        self.header.set_subtitle(f"v{APP_VERSION} · Monitor Nativo del Silicio & Conexión de Dispositivo")
        self.window.set_titlebar(self.header)

        # Selector de Vistas StackSwitcher
        self.mode_stack_switcher = Gtk.StackSwitcher()
        self.header.set_custom_title(self.mode_stack_switcher)

        # Botón Pantalla Completa (F11)
        self.btn_fullscreen = Gtk.Button.new_from_icon_name("view-fullscreen-symbolic", Gtk.IconSize.BUTTON)
        self.btn_fullscreen.set_tooltip_text("Pantalla Completa (F11)")
        self.btn_fullscreen.connect("clicked", self._toggle_fullscreen)
        self.header.pack_end(self.btn_fullscreen)

        # Botón Acerca de
        self.btn_about = Gtk.Button.new_from_icon_name("help-about-symbolic", Gtk.IconSize.BUTTON)
        self.btn_about.set_tooltip_text(f"Acerca de Recursos Cockpit (v{APP_VERSION})")
        self.btn_about.connect("clicked", self._show_about_dialog)
        self.header.pack_end(self.btn_about)

        # 3. Stack Principal de Vistas Nativas
        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.SLIDE_LEFT_RIGHT)
        self.stack.set_transition_duration(200)
        self.mode_stack_switcher.set_stack(self.stack)

        # --- PESTAÑA 1: MONITOR DE SISTEMA NATIVO ---
        self.system_view = self._build_system_monitor_ui()
        self.stack.add_titled(self.system_view, "system", "🖥️ Sistema")

        # --- PESTAÑA 2: CONEXIÓN DE DISPOSITIVO NATIVO ---
        self.device_view = self._build_device_connection_ui()
        self.stack.add_titled(self.device_view, "device", "📱 Dispositivo")

        # --- PESTAÑA 3: DIAGNÓSTICO Y REGISTROS NATIVOS ---
        self.diag_view = self._build_diagnostics_ui()
        self.stack.add_titled(self.diag_view, "diagnostics", "📋 Diagnóstico")

        self.window.add(self.stack)

        # Atajos de teclado nativos
        self.window.connect("key-press-event", self._on_key_press)
        self.window.connect("destroy", self._on_window_destroy)

    def _build_system_monitor_ui(self):
        """Construye un panel de monitoreo de hardware 100% nativo con widgets GTK3."""
        scrolled = Gtk.ScrolledWindow()
        scrolled.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)

        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        main_box.set_margin_top(18)
        main_box.set_margin_bottom(18)
        main_box.set_margin_start(22)
        main_box.set_margin_end(22)
        scrolled.add(main_box)

        # --- SECCIÓN CPU ---
        cpu_frame = Gtk.Frame(label=" Procesador (CPU) ")
        cpu_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        cpu_box.set_margin_top(10)
        cpu_box.set_margin_bottom(10)
        cpu_box.set_margin_start(14)
        cpu_box.set_margin_end(14)

        self.lbl_cpu_model = Gtk.Label()
        self.lbl_cpu_model.set_markup("<b>Modelo:</b> Detectando arquitectura...")
        self.lbl_cpu_model.set_xalign(0)
        cpu_box.pack_start(self.lbl_cpu_model, False, False, 0)

        cpu_usage_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.lbl_cpu_percent = Gtk.Label(label="Carga Global: --%")
        self.lbl_cpu_percent.set_xalign(0)
        self.pbar_cpu = Gtk.ProgressBar()
        self.pbar_cpu.set_show_text(True)
        cpu_usage_box.pack_start(self.lbl_cpu_percent, False, False, 0)
        cpu_usage_box.pack_start(self.pbar_cpu, True, True, 0)
        cpu_box.pack_start(cpu_usage_box, False, False, 0)

        # Matriz de hilos lógicos
        self.cpu_cores_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        cpu_box.pack_start(self.cpu_cores_box, False, False, 0)
        cpu_frame.add(cpu_box)
        main_box.pack_start(cpu_frame, False, False, 0)

        # --- SECCIÓN MEMORIA RAM & SWAP ---
        mem_frame = Gtk.Frame(label=" Memoria Física (RAM) & Swap ")
        mem_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        mem_box.set_margin_top(10)
        mem_box.set_margin_bottom(10)
        mem_box.set_margin_start(14)
        mem_box.set_margin_end(14)

        ram_usage_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.lbl_ram_info = Gtk.Label(label="RAM: -- / -- GB")
        self.lbl_ram_info.set_xalign(0)
        self.pbar_ram = Gtk.ProgressBar()
        self.pbar_ram.set_show_text(True)
        ram_usage_box.pack_start(self.lbl_ram_info, False, False, 0)
        ram_usage_box.pack_start(self.pbar_ram, True, True, 0)
        mem_box.pack_start(ram_usage_box, False, False, 0)

        swap_usage_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.lbl_swap_info = Gtk.Label(label="Swap / ZRAM: -- / -- GB")
        self.lbl_swap_info.set_xalign(0)
        self.pbar_swap = Gtk.ProgressBar()
        self.pbar_swap.set_show_text(True)
        swap_usage_box.pack_start(self.lbl_swap_info, False, False, 0)
        swap_usage_box.pack_start(self.pbar_swap, True, True, 0)
        mem_box.pack_start(swap_usage_box, False, False, 0)

        mem_frame.add(mem_box)
        main_box.pack_start(mem_frame, False, False, 0)

        # --- SECCIÓN ALMACENAMIENTO & RED ---
        row_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)

        # Discos
        disk_frame = Gtk.Frame(label=" Almacenamiento & Discos ")
        self.disk_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.disk_box.set_margin_top(10)
        self.disk_box.set_margin_bottom(10)
        self.disk_box.set_margin_start(14)
        self.disk_box.set_margin_end(14)
        disk_frame.add(self.disk_box)
        row_box.pack_start(disk_frame, True, True, 0)

        # Red
        net_frame = Gtk.Frame(label=" Interfaces de Red (Tráfico en Vivo) ")
        self.net_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.net_box.set_margin_top(10)
        self.net_box.set_margin_bottom(10)
        self.net_box.set_margin_start(14)
        self.net_box.set_margin_end(14)
        net_frame.add(self.net_box)
        row_box.pack_start(net_frame, True, True, 0)

        main_box.pack_start(row_box, False, False, 0)
        return scrolled

    def _build_device_connection_ui(self):
        """Construye el panel de conexión e interacción de dispositivo nativo."""
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        box.set_margin_top(22)
        box.set_margin_bottom(22)
        box.set_margin_start(24)
        box.set_margin_end(24)

        # Banner de Estado Destacado
        self.banner_frame = Gtk.Frame()
        banner_inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        banner_inner.set_margin_top(16)
        banner_inner.set_margin_bottom(16)
        banner_inner.set_margin_start(18)
        banner_inner.set_margin_end(18)

        status_head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.lbl_status_icon = Gtk.Label()
        self.lbl_status_icon.set_markup("<span font='24'>📡</span>")
        self.lbl_device_status = Gtk.Label()
        self.lbl_device_status.set_markup("<span font='15' weight='bold' color='#d97706'>Esperando dispositivo para conectarse en su versión nativa</span>")
        self.lbl_device_status.set_xalign(0)
        status_head.pack_start(self.lbl_status_icon, False, False, 0)
        status_head.pack_start(self.lbl_device_status, True, True, 0)

        self.btn_rescan_adb = Gtk.Button.new_from_icon_name("view-refresh-symbolic", Gtk.IconSize.BUTTON)
        self.btn_rescan_adb.set_tooltip_text("Escanear dispositivos ADB ahora")
        self.btn_rescan_adb.connect("clicked", lambda b: self._scan_devices_thread())
        status_head.pack_end(self.btn_rescan_adb, False, False, 0)
        banner_inner.pack_start(status_head, False, False, 0)

        self.lbl_status_hint = Gtk.Label()
        self.lbl_status_hint.set_markup("<span color='#888888'>Conecta un dispositivo Android / Samsung mediante cable USB con Depuración USB habilitada o emparejado por Wi-Fi TCP/IP.</span>")
        self.lbl_status_hint.set_xalign(0)
        banner_inner.pack_start(self.lbl_status_hint, False, False, 0)

        self.banner_frame.add(banner_inner)
        box.pack_start(self.banner_frame, False, False, 0)

        # Tarjeta de Dispositivo Detectado
        self.frame_detected = Gtk.Frame(label=" Dispositivo Activo Seleccionado ")
        detected_inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        detected_inner.set_margin_top(12)
        detected_inner.set_margin_bottom(12)
        detected_inner.set_margin_start(16)
        detected_inner.set_margin_end(16)

        self.lbl_dev_info = Gtk.Label(label="Ningún dispositivo detectado.")
        self.lbl_dev_info.set_xalign(0)
        detected_inner.pack_start(self.lbl_dev_info, False, False, 0)

        # Opciones de Hardware
        options_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)

        self.chk_uhid = Gtk.CheckButton(label="Paso directo de teclado/ratón por hardware (/dev/uhid)")
        self.chk_uhid.set_active(True)
        self.chk_uhid.set_tooltip_text("Permite escribir y controlar el cursor como si fuera un teclado y ratón USB físico real")
        options_box.pack_start(self.chk_uhid, False, False, 0)

        self.chk_turn_off = Gtk.CheckButton(label="Apagar pantalla del móvil durante la sesión")
        self.chk_turn_off.set_active(True)
        options_box.pack_start(self.chk_turn_off, False, False, 0)

        detected_inner.pack_start(options_box, False, False, 0)

        # Resolución
        res_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        lbl_res = Gtk.Label(label="Resolución de Proyección:")
        res_box.pack_start(lbl_res, False, False, 0)

        self.combo_res = Gtk.ComboBoxText()
        self.combo_res.append("1920", "Full HD (1920x1080)")
        self.combo_res.append("2560", "2K QHD (2560x1440)")
        self.combo_res.append("0", "Nativa del Dispositivo")
        self.combo_res.set_active(0)
        res_box.pack_start(self.combo_res, False, False, 0)

        self.btn_wifi_mode = Gtk.Button.new_with_label("📶 Conectar por Wi-Fi (ADB 5555)")
        self.btn_wifi_mode.connect("clicked", self._on_enable_wifi_clicked)
        res_box.pack_end(self.btn_wifi_mode, False, False, 0)

        detected_inner.pack_start(res_box, False, False, 0)
        self.frame_detected.add(detected_inner)
        box.pack_start(self.frame_detected, False, False, 0)

        # Botones de Acción
        actions_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)

        self.btn_connect = Gtk.Button.new_with_label("🚀 Conectar e Iniciar Sesión de Dispositivo")
        self.btn_connect.get_style_context().add_class("suggested-action")
        self.btn_connect.connect("clicked", self._on_start_connection_clicked)
        actions_box.pack_start(self.btn_connect, True, True, 0)

        self.btn_disconnect = Gtk.Button.new_with_label("⏹️ Desconectar")
        self.btn_disconnect.get_style_context().add_class("destructive-action")
        self.btn_disconnect.set_sensitive(False)
        self.btn_disconnect.connect("clicked", self._on_disconnect_clicked)
        actions_box.pack_start(self.btn_disconnect, False, False, 0)

        box.pack_start(actions_box, False, False, 0)
        return box

    def _build_diagnostics_ui(self):
        """Construye un visor de logs nativo con Gtk.TextView."""
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        box.set_margin_top(16)
        box.set_margin_bottom(16)
        box.set_margin_start(20)
        box.set_margin_end(20)

        top_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        lbl_diag = Gtk.Label()
        lbl_diag.set_markup("<b>Registro de Eventos y Diagnóstico de Dispositivos</b>")
        top_bar.pack_start(lbl_diag, False, False, 0)

        btn_clear = Gtk.Button.new_with_label("Limpiar Registro")
        btn_clear.connect("clicked", lambda b: self.log_text_buffer.set_text(""))
        top_bar.pack_end(btn_clear, False, False, 0)
        box.pack_start(top_bar, False, False, 0)

        scrolled = Gtk.ScrolledWindow()
        self.log_text_view = Gtk.TextView()
        self.log_text_view.set_editable(False)
        self.log_text_view.set_cursor_visible(False)
        self.log_text_view.set_monospace(True)
        self.log_text_buffer = self.log_text_view.get_buffer()
        scrolled.add(self.log_text_view)
        box.pack_start(scrolled, True, True, 0)

        return box

    def _start_monitors(self):
        """Inicia temporizadores nativos de GTK para telemetría y escaneo ADB."""
        # 1. Telemetría de hardware cada 1 segundo en el hilo principal de GTK
        GLib.timeout_add(1000, self._update_system_metrics)
        self._update_system_metrics()

        # 2. Escáner de dispositivos cada 4 segundos
        GLib.timeout_add(4000, self._periodic_device_scan)
        self._scan_devices_thread()

    def _update_system_metrics(self):
        """Lee psutil y actualiza widgets nativos de GTK en tiempo real."""
        if not psutil:
            return True

        try:
            # CPU
            cpu_pct = psutil.cpu_percent(interval=None)
            self.pbar_cpu.set_fraction(cpu_pct / 100.0)
            self.pbar_cpu.set_text(f"{cpu_pct:.1f}%")
            self.lbl_cpu_percent.set_text(f"Carga Global: {cpu_pct:.1f}%")

            cores = psutil.cpu_percent(percpu=True)
            # Actualizar modelo y frecuencia si no están seteados
            freq = psutil.cpu_freq()
            freq_str = f" @ {freq.current:.0f} MHz" if freq else ""
            self.lbl_cpu_model.set_markup(f"<b>Topología:</b> {len(cores)} Hilos Lógicos{freq_str}")

            # RAM
            mem = psutil.virtual_memory()
            used_gb = mem.used / (1024**3)
            total_gb = mem.total / (1024**3)
            self.pbar_ram.set_fraction(mem.percent / 100.0)
            self.pbar_ram.set_text(f"{mem.percent:.1f}%")
            self.lbl_ram_info.set_text(f"RAM: {used_gb:.1f} / {total_gb:.1f} GB")

            # Swap
            swap = psutil.swap_memory()
            if swap.total > 0:
                s_used = swap.used / (1024**3)
                s_tot = swap.total / (1024**3)
                self.pbar_swap.set_fraction(swap.percent / 100.0)
                self.pbar_swap.set_text(f"{swap.percent:.1f}%")
                self.lbl_swap_info.set_text(f"Swap: {s_used:.1f} / {s_tot:.1f} GB")

            # Discos
            for child in self.disk_box.get_children():
                self.disk_box.remove(child)

            for part in psutil.disk_partitions(all=False):
                if part.fstype in ('squashfs', 'iso9660'):
                    continue
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                    u_gb = usage.used / (1024**3)
                    t_gb = usage.total / (1024**3)
                    d_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
                    lbl_part = Gtk.Label(label=f"{part.mountpoint} ({part.device}): {u_gb:.0f}/{t_gb:.0f} GB")
                    lbl_part.set_xalign(0)
                    p_disk = Gtk.ProgressBar()
                    p_disk.set_fraction(usage.percent / 100.0)
                    p_disk.set_show_text(True)
                    p_disk.set_text(f"{usage.percent:.1f}%")
                    d_row.pack_start(lbl_part, False, False, 0)
                    d_row.pack_start(p_disk, True, True, 0)
                    self.disk_box.pack_start(d_row, False, False, 0)
                except PermissionError:
                    continue
            self.disk_box.show_all()

            # Red
            now = time.time()
            net_io = psutil.net_io_counters(pernic=True)
            dt = max(0.1, now - self.last_net_time)

            for child in self.net_box.get_children():
                self.net_box.remove(child)

            for iface, io in net_io.items():
                if iface.startswith('lo') or iface.startswith('docker') or iface.startswith('veth'):
                    continue
                rx_rate = 0.0
                tx_rate = 0.0
                if self.last_net_io and iface in self.last_net_io:
                    rx_rate = (io.bytes_recv - self.last_net_io[iface].bytes_recv) / dt / 1024
                    tx_rate = (io.bytes_sent - self.last_net_io[iface].bytes_sent) / dt / 1024

                n_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
                lbl_if = Gtk.Label(label=f"<b>{iface}</b>")
                lbl_if.set_use_markup(True)
                lbl_rates = Gtk.Label(label=f"↓ {rx_rate:.1f} KB/s  ↑ {tx_rate:.1f} KB/s")
                lbl_rates.set_xalign(1)
                n_row.pack_start(lbl_if, False, False, 0)
                n_row.pack_end(lbl_rates, False, False, 0)
                self.net_box.pack_start(n_row, False, False, 0)

            self.net_box.show_all()
            self.last_net_io = net_io
            self.last_net_time = now

        except Exception as e:
            pass

        return True

    def _periodic_device_scan(self):
        self._scan_devices_thread()
        return True

    def _scan_devices_thread(self):
        t = threading.Thread(target=self._run_scan, daemon=True)
        t.start()

    def _run_scan(self):
        devs = self.dex.list_devices()
        GLib.idle_add(self._update_devices_ui, devs)

    def _update_devices_ui(self, devs):
        self.detected_devices = devs
        if devs:
            d = devs[0]
            name = d.get("model", d.get("serial", "Dispositivo Android"))
            conn_type = "Wi-Fi (TCP/IP)" if ":" in d.get("serial", "") else "USB Directo"
            self.lbl_device_status.set_markup(f"<span font='15' weight='bold' color='#10b981'>Dispositivo Listo: {name} ({conn_type})</span>")
            self.lbl_status_icon.set_markup("<span font='24'>🟢</span>")
            self.lbl_status_hint.set_markup(f"<span color='#10b981'>Identificador: {d.get('serial')} · Fabricante: {d.get('manufacturer', 'Android')} · Estado: Autorizado</span>")
            self.lbl_dev_info.set_markup(f"<b>Dispositivo:</b> {name} | <b>Serial:</b> {d.get('serial')} | <b>Tipo:</b> {conn_type}")
            self.btn_connect.set_sensitive(True)
        else:
            self.lbl_device_status.set_markup("<span font='15' weight='bold' color='#d97706'>Esperando dispositivo para conectarse en su versión nativa</span>")
            self.lbl_status_icon.set_markup("<span font='24'>📡</span>")
            self.lbl_status_hint.set_markup("<span color='#888888'>Conecta un dispositivo Android / Samsung mediante cable USB con Depuración USB habilitada o emparejado por Wi-Fi TCP/IP.</span>")
            self.lbl_dev_info.set_markup("<i>Ningún dispositivo detectado en el puerto USB o red local.</i>")
            if not self.running_session:
                self.btn_connect.set_sensitive(False)
        return False

    def on_device_log(self, msg, level="INFO"):
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
            adj = self.log_text_view.get_vadjustment()
            adj.set_value(adj.get_upper() - adj.get_page_size())
        return False

    def _on_start_connection_clicked(self, widget):
        dev_serial = self.detected_devices[0]["serial"] if self.detected_devices else None
        res_val = int(self.combo_res.get_active_id() or 1920)
        use_uhid = self.chk_uhid.get_active()
        turn_off = self.chk_turn_off.get_active()

        self.on_device_log(f"Iniciando proyección nativa hacia {dev_serial or 'dispositivo por defecto'}...")
        self.btn_connect.set_sensitive(False)
        self.btn_disconnect.set_sensitive(True)
        self.running_session = True

        def _launch():
            success = self.dex.start_session(
                device_serial=dev_serial,
                resolution=res_val,
                fullscreen=False,
                use_uhid=use_uhid,
                turn_screen_off=turn_off
            )
            def _done():
                self.running_session = False
                self.btn_connect.set_sensitive(len(self.detected_devices) > 0)
                self.btn_disconnect.set_sensitive(False)
            GLib.idle_add(_done)

        t = threading.Thread(target=_launch, daemon=True)
        t.start()

    def _on_disconnect_clicked(self, widget):
        self.on_device_log("Deteniendo sesión de proyección...")
        self.dex.stop_session()
        self.running_session = False
        self.btn_connect.set_sensitive(len(self.detected_devices) > 0)
        self.btn_disconnect.set_sensitive(False)

    def _on_enable_wifi_clicked(self, widget):
        dev_serial = self.detected_devices[0]["serial"] if self.detected_devices else None
        self.on_device_log("Habilitando modo Wi-Fi (ADB TCP/IP 5555)...")
        t = threading.Thread(target=lambda: self.dex.enable_wifi_mode(dev_serial), daemon=True)
        t.start()

    def _toggle_fullscreen(self, widget):
        if hasattr(self, '_is_fullscreen') and self._is_fullscreen:
            self.window.unfullscreen()
            self._is_fullscreen = False
        else:
            self.window.fullscreen()
            self._is_fullscreen = True

    def _show_about_dialog(self, widget):
        about = Gtk.AboutDialog(transient_for=self.window, modal=True)
        about.set_program_name("Recursos Cockpit")
        about.set_version(f"v{APP_VERSION}")
        about.set_comments("Monitor Nativo de Silicio & Conexión de Dispositivos Móviles (Scrcpy + UHID)")
        about.set_website("https://github.com/cminewarIA/recursos-ui")
        about.set_website_label("GitHub cminewarIA/recursos-ui")
        about.set_authors(["cminewarIA"])
        about.set_license_type(Gtk.License.MIT_X11)
        about.run()
        about.destroy()

    def _on_key_press(self, widget, event):
        if event.keyval == Gdk.KEY_F11:
            self._toggle_fullscreen(widget)
            return True
        elif event.state & Gdk.ModifierType.CONTROL_MASK:
            if event.keyval in (Gdk.KEY_r, Gdk.KEY_R):
                self._update_system_metrics()
                self._scan_devices_thread()
                return True
            elif event.keyval in (Gdk.KEY_q, Gdk.KEY_Q):
                self.window.destroy()
                return True
        return False

    def _on_window_destroy(self, widget):
        if self.dex:
            self.dex.stop_session()
        Gtk.main_quit()

    def run(self):
        if IS_TEST_MODE:
            return 0
        self.window.show_all()
        Gtk.main()
        return 0


def main():
    parser = argparse.ArgumentParser(description="Recursos Cockpit · Aplicación 100% Nativa Linux")
    parser.add_argument("--test-mode", action="store_true", help="Ejecutar en modo de prueba sin display gráfico")
    args = parser.parse_args()

    app = RecursosDesktopApp()
    return app.run()


if __name__ == "__main__":
    sys.exit(main())
