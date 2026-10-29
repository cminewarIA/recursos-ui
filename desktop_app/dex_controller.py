#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recursos DeX & Android Desktop Mode USB Video Projection Controller
Manages USB device detection, Samsung DeX / Android Desktop display mode,
and low-latency USB video projection via scrcpy + UHID hardware input.
"""

import os
import shutil
import subprocess
import threading
import time


class DexController:
    def __init__(self, on_status_change=None):
        self.on_status_change = on_status_change
        self.scrcpy_proc = None
        self.active_device = None
        self._lock = threading.Lock()

    def _emit_status(self, message, level="info"):
        if callable(self.on_status_change):
            try:
                self.on_status_change(message, level)
            except Exception:
                pass

    def ensure_dependencies_installed(self):
        """Automatically install adb and scrcpy if missing when detected."""
        adb_path = shutil.which("adb")
        scrcpy_path = shutil.which("scrcpy")
        if adb_path and scrcpy_path:
            return True
        missing = []
        if not adb_path:
            missing.append("adb")
        if not scrcpy_path:
            missing.append("scrcpy")
        self._emit_status(
            f"Instalando dependencias detectadas automáticamente ({', '.join(missing)})...",
            "info",
        )
        try:
            subprocess.run(
                ["sudo", "-n", "apt-get", "install", "-y"] + missing,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except Exception:
            pass
        return bool(shutil.which("adb") and shutil.which("scrcpy"))

    def check_dependencies(self, auto_install=True):
        """Return dict with availability and version info of adb and scrcpy."""
        adb_path = shutil.which("adb")
        scrcpy_path = shutil.which("scrcpy")
        if auto_install and (not adb_path or not scrcpy_path):
            self.ensure_dependencies_installed()
            adb_path = shutil.which("adb")
            scrcpy_path = shutil.which("scrcpy")
        scrcpy_ver = ""
        supports_new_display = False
        if scrcpy_path:
            try:
                res = subprocess.run(
                    [scrcpy_path, "--version"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                first_line = (res.stdout or "").splitlines()[0] if res.stdout else ""
                scrcpy_ver = first_line.strip()
                help_res = subprocess.run(
                    [scrcpy_path, "--help"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                if "--new-display" in (help_res.stdout or ""):
                    supports_new_display = True
            except Exception:
                pass

        return {
            "adb_installed": bool(adb_path),
            "scrcpy_installed": bool(scrcpy_path),
            "adb_path": adb_path or "No instalado (sudo apt install adb)",
            "scrcpy_path": scrcpy_path or "No instalado (sudo apt install scrcpy)",
            "scrcpy_version": scrcpy_ver,
            "supports_new_display": supports_new_display,
            "ready": bool(adb_path and scrcpy_path),
        }

    def list_connected_devices(self, usb_only=True):
        """Query `adb devices -l` and return connected USB mobile devices with metadata."""
        if not shutil.which("adb"):
            return []

        try:
            res = subprocess.run(
                ["adb", "devices", "-l"],
                capture_output=True,
                text=True,
                timeout=4,
            )
            lines = (res.stdout or "").strip().splitlines()
            devices = []
            for line in lines[1:]:
                line = line.strip()
                if not line or line.startswith("*"):
                    continue
                parts = line.split()
                if len(parts) < 2:
                    continue
                dev_id = parts[0]
                state = parts[1]

                is_wireless = ":" in dev_id
                if usb_only and is_wireless:
                    continue

                meta = {}
                for token in parts[2:]:
                    if ":" in token:
                        k, v = token.split(":", 1)
                        meta[k] = v

                model = meta.get("model", "Smartphone Android").replace("_", " ")
                manufacturer = ""
                android_ver = ""
                dex_capable = False

                if state == "device":
                    manufacturer = self._get_prop(dev_id, "ro.product.manufacturer") or ""
                    brand = self._get_prop(dev_id, "ro.product.brand") or ""
                    mkt_name = self._get_prop(dev_id, "ro.config.marketing_name") or ""
                    if mkt_name:
                        model = mkt_name
                    elif manufacturer and not model.lower().startswith(manufacturer.lower()):
                        model = f"{manufacturer.capitalize()} {model}"
                    android_ver = self._get_prop(dev_id, "ro.build.version.release") or ""
                    dex_feature = self._get_prop(dev_id, "ro.build.characteristics") or ""
                    is_samsung = "samsung" in f"{manufacturer} {brand} {model}".lower()
                    try:
                        sdk_int = int(self._get_prop(dev_id, "ro.build.version.sdk") or "0")
                    except ValueError:
                        sdk_int = 0
                    dex_capable = is_samsung or sdk_int >= 29 or "dex" in dex_feature.lower()

                mode_label = (
                    "Samsung DeX / Modo Escritorio"
                    if "samsung" in f"{manufacturer} {model}".lower()
                    else "Modo Escritorio de Android"
                )

                devices.append(
                    {
                        "id": dev_id,
                        "serial": dev_id,
                        "state": state,
                        "model": model,
                        "manufacturer": manufacturer,
                        "android_version": android_ver,
                        "dex_capable": dex_capable,
                        "desktop_mode_label": mode_label,
                        "transport": "Wi-Fi" if is_wireless else "USB",
                        "product": meta.get("product", ""),
                    }
                )
            return devices
        except Exception:
            return []

    def list_devices(self):
        """Alias for list_connected_devices() for backwards compatibility."""
        return self.list_connected_devices(usb_only=True)

    def _get_prop(self, device_id, prop_name):
        try:
            res = subprocess.run(
                ["adb", "-s", str(device_id), "shell", "getprop", prop_name],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if res.returncode == 0:
                return (res.stdout or "").strip()
        except Exception:
            pass
        return ""

    def is_session_running(self):
        with self._lock:
            return self.scrcpy_proc is not None and self.scrcpy_proc.poll() is None

    @property
    def is_running(self):
        """Property alias for is_session_running() used by LocalHtmlBridgeServer."""
        return self.is_session_running()

    def start_dex_session(
        self,
        device_id=None,
        resolution="1920x1080",
        fullscreen=False,
        max_fps=60,
        use_uhid=True,
        turn_screen_off=False,
        usb_only=True,
    ):
        """
        Launch USB video projection for Samsung DeX or Android Desktop Mode.
        Configures experimental desktop mode settings on the Android device via USB
        and starts low-latency video projection via scrcpy.
        """
        deps = self.check_dependencies(auto_install=True)
        if not deps["ready"]:
            self._emit_status(
                "Faltan dependencias en el sistema: instala 'adb' y 'scrcpy' para proyectar por USB.",
                "error",
            )
            return False

        devices = self.list_connected_devices(usb_only=usb_only)
        authorized = [d for d in devices if d["state"] == "device"]
        if not authorized:
            if any(d["state"] == "unauthorized" for d in devices):
                self._emit_status(
                    "Dispositivo USB detectado pero pendiente de autorización. Acepta la huella RSA en la pantalla del móvil.",
                    "warning",
                )
            else:
                self._emit_status(
                    "Esperando conexión de un dispositivo móvil por cable USB...",
                    "warning",
                )
            return False

        target_dev = authorized[0]
        if device_id:
            for d in authorized:
                if d["id"] == device_id or d["serial"] == device_id:
                    target_dev = d
                    break

        target_id = target_dev["id"]
        mode_label = target_dev.get("desktop_mode_label", "Samsung DeX / Modo Escritorio")

        with self._lock:
            if self.scrcpy_proc is not None and self.scrcpy_proc.poll() is None:
                self._emit_status(f"Proyección USB ya activa con {target_dev['model']}", "info")
                return True

        def _worker():
            self._emit_status(
                f"Configurando {mode_label} por USB en {target_dev['model']} ({target_id})...",
                "info",
            )

            # Enable Android Desktop Mode / freeform window support over USB (non-destructive)
            desktop_settings_cmds = [
                ["adb", "-s", target_id, "shell", "settings", "put", "global", "force_desktop_mode_on_external_displays", "1"],
                ["adb", "-s", target_id, "shell", "settings", "put", "global", "enable_freeform_support", "1"],
            ]
            for cmd in desktop_settings_cmds:
                try:
                    subprocess.run(cmd, capture_output=True, timeout=2)
                except Exception:
                    pass

            res_clean = str(resolution or "1920x1080").split()[0].strip()
            if "x" not in res_clean:
                res_clean = "1920x1080"

            base_cmd = [
                "scrcpy",
                "-s",
                target_id,
                f"--window-title=Recursos — {mode_label} ({target_dev['model']})",
                f"--max-fps={int(max_fps)}",
                "--stay-awake",
            ]

            if fullscreen:
                base_cmd.append("--fullscreen")

            if turn_screen_off:
                base_cmd.append("--turn-screen-off")

            if use_uhid:
                base_cmd.extend(["--keyboard=uhid", "--mouse=uhid"])

            # Try virtual desktop display first if scrcpy supports --new-display (Android Desktop Mode / DeX)
            cmd_candidates = []
            if deps.get("supports_new_display"):
                cmd_candidates.append(base_cmd + [f"--new-display={res_clean}/240"])
            cmd_candidates.append(base_cmd + ["-m", "1920", "--video-bit-rate=16M"])
            cmd_candidates.append(["scrcpy", "-s", target_id, f"--window-title=Recursos — {mode_label}"])

            for attempt_idx, cmd in enumerate(cmd_candidates):
                try:
                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                    )
                    with self._lock:
                        self.scrcpy_proc = proc
                        self.active_device = target_id

                    time.sleep(0.9)
                    if proc.poll() is None:
                        self._emit_status(
                            f"Proyectando vídeo por USB: {target_dev['model']} ({mode_label})",
                            "success",
                        )
                        proc.wait()
                        break
                except Exception as exc:
                    if attempt_idx == len(cmd_candidates) - 1:
                        self._emit_status(f"Error al iniciar proyección USB: {exc}", "error")

            with self._lock:
                self.scrcpy_proc = None
                self.active_device = None
            self._emit_status("Esperando conexión de dispositivo por USB...", "info")

        threading.Thread(target=_worker, daemon=True).start()
        return True

    def start_session(
        self,
        device_serial=None,
        resolution="1920x1080",
        fullscreen=False,
        use_uhid=True,
        turn_screen_off=False,
    ):
        """Alias for start_dex_session() accepting device_serial."""
        return self.start_dex_session(
            device_id=device_serial,
            resolution=resolution,
            fullscreen=fullscreen,
            use_uhid=use_uhid,
            turn_screen_off=turn_screen_off,
        )

    def stop_dex_session(self):
        """Terminate active scrcpy projection process cleanly."""
        with self._lock:
            proc = self.scrcpy_proc
            self.scrcpy_proc = None
            self.active_device = None

        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            self._emit_status("Proyección USB finalizada. Esperando dispositivo...", "info")
            return True
        return False

    def stop_session(self):
        """Alias for stop_dex_session() used by LocalHtmlBridgeServer."""
        return self.stop_dex_session()

