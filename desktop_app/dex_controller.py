#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Motor Nativo de Samsung DeX y Android Desktop para Recursos Cockpit Linux App
==============================================================================
Basado en la arquitectura de alto rendimiento de Lapdock OS / Modo DEx.
Gestiona la detección de dispositivos Android/Samsung por USB y Wi-Fi,
crea pantallas virtuales adaptadas a la resolución del monitor, activa
el entorno Samsung DeX y lanza Scrcpy con aceleración de hardware UHID.
"""

import os
import sys
import time
import subprocess
import threading
import re
import socket
import json

class DexController:
    def __init__(self, log_callback=None):
        self.log_callback = log_callback or self._default_log
        self.current_process = None
        self.process_lock = threading.Lock()
        self.active_device_id = None
        self.active_os_type = "UNKNOWN"
        self.active_target_display = None
        self.is_running = False

    def _default_log(self, msg, level="INFO"):
        ts = time.strftime("%H:%M:%S")
        print(f"[{ts}] [{level}] {msg}", flush=True)

    def log(self, msg, level="INFO"):
        self.log_callback(msg, level)

    def list_connected_devices(self):
        """Lista todos los dispositivos Android/Samsung detectados por ADB."""
        devices = []
        try:
            res = subprocess.run(["adb", "devices", "-l"], capture_output=True, text=True, timeout=3)
            if res.returncode == 0:
                lines = res.stdout.strip().splitlines()
                for line in lines[1:]:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] == "device":
                        dev_id = parts[0]
                        model = "Android"
                        for p in parts[2:]:
                            if p.startswith("model:"):
                                model = p.split(":", 1)[1]
                            elif p.startswith("device:"):
                                dev_name = p.split(":", 1)[1]
                        
                        # Detectar fabricante
                        mfg = self.get_device_prop(dev_id, "ro.product.manufacturer")
                        is_samsung = "samsung" in mfg.lower()
                        os_type = "SAMSUNG_DEX" if is_samsung else "ANDROID_DESKTOP"

                        devices.append({
                            "id": dev_id,
                            "model": model,
                            "manufacturer": mfg,
                            "is_samsung": is_samsung,
                            "os_type": os_type,
                            "is_wireless": ":" in dev_id
                        })
        except Exception as e:
            self.log(f"Error listando dispositivos ADB: {e}", "WARN")
        return devices

    def get_device_prop(self, device_id, prop_name):
        """Consulta una propiedad del sistema Android mediante getprop."""
        try:
            res = subprocess.run(
                ["adb", "-s", device_id, "shell", f"getprop {prop_name}"],
                capture_output=True, text=True, timeout=2
            )
            return res.stdout.strip()
        except Exception:
            return ""

    def enable_wireless_mode(self, device_id):
        """Activa el modo inalámbrico ADB TCP/IP en el puerto 5555."""
        if not device_id:
            self.log("⚠️ Ningún dispositivo seleccionado para modo inalámbrico.", "WARN")
            return False, "Sin dispositivo"

        if ":" in device_id:
            self.log(f"✅ El dispositivo ya opera de forma inalámbrica en {device_id}.", "SUCCESS")
            return True, device_id

        self.log(f"Configurando ADB sobre TCP/IP en puerto 5555 para {device_id}...")
        try:
            subprocess.run(["adb", "-s", device_id, "tcpip", "5555"], capture_output=True, text=True, timeout=5)
            time.sleep(1.0)

            # Obtener IP Wi-Fi
            phone_ip = None
            ip_out = subprocess.run(["adb", "-s", device_id, "shell", "ip -f inet addr show wlan0"], capture_output=True, text=True, timeout=3).stdout
            m = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)", ip_out)
            if m:
                phone_ip = m.group(1)

            if not phone_ip:
                route_out = subprocess.run(["adb", "-s", device_id, "shell", "ip route"], capture_output=True, text=True, timeout=3).stdout
                m2 = re.search(r"src\s+(\d+\.\d+\.\d+\.\d+)", route_out)
                if m2:
                    phone_ip = m2.group(1)

            if not phone_ip:
                prop_ip = self.get_device_prop(device_id, "dhcp.wlan0.ipaddress")
                if re.match(r"^\d+\.\d+\.\d+\.\d+$", prop_ip):
                    phone_ip = prop_ip

            if phone_ip:
                target_addr = f"{phone_ip}:5555"
                self.log(f"IP Wi-Fi detectada en el terminal: {phone_ip}. Conectando...")
                conn_res = subprocess.run(["adb", "connect", target_addr], capture_output=True, text=True, timeout=5)
                self.log(f"ADB Connect: {conn_res.stdout.strip()}", "SUCCESS")
                return True, target_addr
            else:
                return False, "No se pudo detectar la IP Wi-Fi del terminal. Asegúrate de estar en la misma red."
        except Exception as e:
            self.log(f"Error activando modo inalámbrico: {e}", "ERROR")
            return False, str(e)

    def prepare_desktop_display(self, device_id, is_samsung, width=1920, height=1080):
        """Habilita flags de escritorio y genera la pantalla virtual adaptada."""
        self.log(f"Optimizando entorno de escritorio para {device_id}...")
        try:
            # Flags globales de escritorio en Android
            subprocess.run(["adb", "-s", device_id, "shell", "settings put global enable_freeform_support 1"], timeout=2, capture_output=True)
            subprocess.run(["adb", "-s", device_id, "shell", "settings put global force_desktop_mode_on_external_displays 1"], timeout=2, capture_output=True)
            subprocess.run(["adb", "-s", device_id, "shell", "settings put global enable_non_resizable_multi_window 1"], timeout=2, capture_output=True)
        except Exception:
            pass

        # Buscar display secundario existente
        target_display = self._find_secondary_display(device_id)

        # Si no existe, crear pantalla virtual overlay
        if not target_display:
            dpi = 160 if width >= 1920 else 140
            overlay_val = f"{width}x{height}/{dpi}"
            self.log(f"🖥️ Creando pantalla virtual panorámica ({overlay_val})...")
            try:
                subprocess.run(
                    ["adb", "-s", device_id, "shell", f"settings put global overlay_display_devices {overlay_val}"],
                    timeout=3, capture_output=True
                )
                time.sleep(1.2)
                target_display = self._find_secondary_display(device_id)
            except Exception as e:
                self.log(f"Aviso al configurar pantalla virtual: {e}", "WARN")

        # Iniciar el lanzador correspondiente
        if target_display:
            if is_samsung:
                self.log(f"✨ Iniciando Samsung DeX Desktop en pantalla {target_display}...")
                subprocess.run(
                    ["adb", "-s", device_id, "shell", "am", "start", "-n", "com.sec.android.app.desktoplauncher/com.android.launcher3.Launcher", "--display", str(target_display)],
                    timeout=2, capture_output=True
                )
                subprocess.run(
                    ["adb", "-s", device_id, "shell", "am", "start", "-n", "com.sec.android.app.launcher/com.honeyspace.dexservice.SecondaryLauncher", "--display", str(target_display)],
                    timeout=2, capture_output=True
                )
            else:
                self.log(f"✨ Iniciando Modo Escritorio Android en pantalla {target_display}...")
                subprocess.run(
                    ["adb", "-s", device_id, "shell", "am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME", "--display", str(target_display)],
                    timeout=2, capture_output=True
                )

        return target_display

    def _find_secondary_display(self, device_id):
        try:
            chk = subprocess.run(["scrcpy", "-s", device_id, "--list-displays"], capture_output=True, text=True, timeout=4)
            disp_ids = re.findall(r"--display-id=(\d+)", chk.stdout + chk.stderr)
            sec_ids = [did for did in disp_ids if did != "0"]
            return sec_ids[-1] if sec_ids else None
        except Exception:
            return None

    def start_dex_session(self, device_id=None, fullscreen=True, max_fps=60):
        """Inicia una sesión interactiva completa de Samsung DeX o Android Desktop."""
        self.stop_session()

        devices = self.list_connected_devices()
        if not devices:
            self.log("❌ No se detectó ningún terminal conectado por USB o Wi-Fi.", "ERROR")
            return False, "No hay dispositivos conectados"

        target_dev = None
        if device_id:
            for d in devices:
                if d["id"] == device_id:
                    target_dev = d
                    break

        if not target_dev:
            # Priorizar Samsung si existe
            target_dev = next((d for d in devices if d["is_samsung"]), devices[0])

        dev_id = target_dev["id"]
        is_samsung = target_dev["is_samsung"]
        self.active_device_id = dev_id
        self.active_os_type = target_dev["os_type"]

        self.log(f"🚀 Iniciando sesión para {target_dev['model']} ({'Samsung DeX' if is_samsung else 'Android Desktop'})...", "SUCCESS")

        # Preparar pantalla
        sec_disp = self.prepare_desktop_display(dev_id, is_samsung)
        self.active_target_display = sec_disp

        # Construir argumentos de Scrcpy
        cmd = ["scrcpy", "-s", dev_id]
        if sec_disp:
            cmd.append(f"--display-id={sec_disp}")

        # Optimizaciones de hardware y latencia
        cmd.extend([
            "--stay-awake",
            f"--max-fps={max_fps}",
            "--keyboard=uhid",
            "--mouse=uhid",
            "--video-codec=h264",
            "--audio-codec=raw",
            "--window-title=Recursos Cockpit · Modo DeX"
        ])

        if fullscreen:
            cmd.append("--fullscreen")

        try:
            self.log(f"Ejecutando Scrcpy nativo: {' '.join(cmd)}")
            proc = subprocess.Popen(cmd)
            with self.process_lock:
                self.current_process = proc
                self.is_running = True

            # Monitorear finalización en segundo plano
            threading.Thread(target=self._monitor_proc, args=(proc, dev_id), daemon=True).start()
            return True, f"Sesión iniciada en {target_dev['model']}"
        except FileNotFoundError:
            self.log("❌ 'scrcpy' no está instalado en el sistema local.", "ERROR")
            return False, "scrcpy no encontrado. Instálalo con: sudo apt install scrcpy"
        except Exception as e:
            self.log(f"Error al iniciar Scrcpy: {e}", "ERROR")
            return False, str(e)

    def _monitor_proc(self, proc, device_id):
        proc.wait()
        with self.process_lock:
            if self.current_process == proc:
                self.current_process = None
                self.is_running = False
        self.cleanup_virtual_display(device_id)
        self.log(f"Sesión DeX finalizada para {device_id}.")

    def cleanup_virtual_display(self, device_id=None):
        dev = device_id or self.active_device_id
        if dev:
            try:
                subprocess.run(
                    ["adb", "-s", dev, "shell", "settings put global overlay_display_devices ''"],
                    timeout=2, capture_output=True
                )
            except Exception:
                pass

    def stop_session(self):
        """Detiene cualquier proyección activa de Scrcpy."""
        with self.process_lock:
            if self.current_process and self.current_process.poll() is None:
                self.log("Deteniendo sesión de proyección activa...")
                try:
                    self.current_process.terminate()
                    self.current_process.wait(timeout=1.5)
                except Exception:
                    try:
                        self.current_process.kill()
                    except Exception:
                        pass
                self.current_process = None
                self.is_running = False

        if self.active_device_id:
            self.cleanup_virtual_display(self.active_device_id)
            self.active_device_id = None
