import json
import os
import re
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http import cookies
from datetime import datetime
import ipaddress
import secrets
import hashlib
import hmac
import psutil
import sqlite3
import socket

# ==============================================================================
# Global Caches, Concurrency Locks & Configuration
# ==============================================================================
METRICS_CACHE = {}
METRICS_CACHE_BYTES = b"{}"
METRICS_LOCK = threading.Lock()

import urllib.request

DOCKER_CACHE = []
DOCKER_LOCK = threading.Lock()
SYSTEMD_CACHE = []
EXTRAS_CACHE = {"torrents": [], "torrent_stats": {}, "emby": {}, "parental": {}}

DISKS_CACHE = []
DISKS_LOCK = threading.Lock()

GPU_CACHE = {"available": False, "gpu_procs_map": {}}
GPU_LOCK = threading.Lock()

WIFI_CACHE = {
    "clients": [],
    "summary": {
        "total_clients": 0,
        "clients_24g": 0,
        "clients_5g": 0,
        "total_tx_bytes": 0,
        "total_rx_bytes": 0,
        "last_update": ""
    }
}
WIFI_LOCK = threading.Lock()

SECURITY_CACHE = {
    "available": True,
    "pihole": {
        "available": False,
        "domains_being_blocked": 0,
        "dns_queries_today": 0,
        "ads_blocked_today": 0,
        "ads_percentage_today": 0.0,
        "top_blocked": [],
        "status": "offline"
    },
    "fail2ban": {
        "available": False,
        "currently_banned": 0,
        "total_banned": 0,
        "jails": {},
        "banned_ips": [],
        "status": "offline"
    },
    "last_update": ""
}
SECURITY_LOCK = threading.Lock()

# Router ASUS RT-AX56U Settings
ROUTER_IP = "192.168.50.10"
ROUTER_USER = "Admin"
ROUTER_PASS = "LFDe7@0Q5m25RLQhIbYSBzK6K0hwD@"

# Zero-Trust Local Pairing Storage & Master Key
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TRUSTED_FILE = os.path.join(BASE_DIR, "trusted_devices.json")
TRUST_LOCK = threading.Lock()
ADMIN_MASTER_KEY = "Cminewar2026!"  # Clave maestra de desbloqueo remoto de emergencia

# ==============================================================================
# Rate Limiting & Anti-Brute-Force Shield for Master Key
# ==============================================================================
AUTH_ATTEMPTS = {}  # { ip: [timestamp1, timestamp2, ...] }
AUTH_LOCKOUTS = {}  # { ip: lockout_until_timestamp }
AUTH_RATE_LOCK = threading.Lock()

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION = 900  # 15 minutos en segundos
ATTEMPT_WINDOW = 600    # 10 minutos para evaluar frecuencia

def is_ip_locked_out(ip):
    now = time.time()
    with AUTH_RATE_LOCK:
        if ip in AUTH_LOCKOUTS:
            if now < AUTH_LOCKOUTS[ip]:
                return True, int(AUTH_LOCKOUTS[ip] - now)
            else:
                del AUTH_LOCKOUTS[ip]
                if ip in AUTH_ATTEMPTS:
                    del AUTH_ATTEMPTS[ip]
        return False, 0

def record_auth_failure(ip):
    now = time.time()
    with AUTH_RATE_LOCK:
        history = [t for t in AUTH_ATTEMPTS.get(ip, []) if now - t < ATTEMPT_WINDOW]
        history.append(now)
        AUTH_ATTEMPTS[ip] = history
        if len(history) >= MAX_FAILED_ATTEMPTS:
            AUTH_LOCKOUTS[ip] = now + LOCKOUT_DURATION
            print(f"[SECURITY ALERT] IP {ip} BLOQUEADA por {LOCKOUT_DURATION//60} min tras 5 intentos fallidos.")
            return True, LOCKOUT_DURATION
        return False, MAX_FAILED_ATTEMPTS - len(history)

def record_auth_success(ip):
    with AUTH_RATE_LOCK:
        if ip in AUTH_ATTEMPTS:
            del AUTH_ATTEMPTS[ip]
        if ip in AUTH_LOCKOUTS:
            del AUTH_LOCKOUTS[ip]

# Real-time Metrics History
HISTORY = {
    "timestamps": [],
    "cpu": [],
    "gpu": [],
    "ram": [],
    "ram_total": [],
    "net_rx": [],
    "net_tx": [],
    "disk_r": [],
    "disk_w": []
}
MAX_HISTORY = 40

# Static Hardware & OS Information (Cached at startup)
CPU_MODEL = "Intel(R) Core(TM) Processor"
try:
    with open("/proc/cpuinfo", "r") as f:
        for line in f:
            if "model name" in line:
                CPU_MODEL = line.split(":", 1)[1].strip()
                break
except Exception:
    pass

CORES_LOGICAL = psutil.cpu_count(logical=True) or 4
CORES_PHYSICAL = psutil.cpu_count(logical=False) or 2
HOSTNAME = os.uname().nodename
KERNEL = os.uname().release
BOOT_TIME = psutil.boot_time()


# ==============================================================================
# Security & Zero-Trust Local Pairing Functions
# ==============================================================================
def load_trusted_devices():
    if not os.path.exists(TRUSTED_FILE):
        return {}
    try:
        with open(TRUSTED_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_trusted_devices(devices):
    try:
        with open(TRUSTED_FILE, 'w', encoding='utf-8') as f:
            json.dump(devices, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[-] Error guardando dispositivos de confianza: {e}")

def hash_token(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()

def get_client_ip(handler):
    """
    Extrae la IP real del cliente con validación estricta anti-spoofing.
    Si la conexión directa proviene de localhost (Caddy proxy), se extrae la IP sanitizada por Caddy
    (X-Real-IP o la última IP de confianza en X-Forwarded-For).
    """
    direct_ip = handler.client_address[0]
    if direct_ip in ('127.0.0.1', '::1'):
        x_real = handler.headers.get('X-Real-IP')
        if x_real:
            return x_real.strip()
        xff = handler.headers.get('X-Forwarded-For')
        if xff:
            parts = [p.strip() for p in xff.split(',') if p.strip()]
            if parts:
                return parts[-1]
    return direct_ip

def is_local_ip(ip_str):
    """
    Determina con total precisión si una dirección IP es local (LAN de casa, loopback o Tailscale).
    Cualquier IP pública o externa fuera de estas subredes se considera EXTERIOR.
    """
    try:
        ip = ipaddress.ip_address(ip_str)
        if ip.is_loopback:
            return True
        for net in [ipaddress.ip_network('192.168.0.0/16'),
                    ipaddress.ip_network('10.0.0.0/8'),
                    ipaddress.ip_network('172.16.0.0/12'),
                    ipaddress.ip_network('100.64.0.0/10')]:
            if ip in net:
                return True
    except Exception:
        pass
    return False

def parse_user_agent(ua):
    if not ua:
        return "Dispositivo desconocido"
    ua_lower = ua.lower()
    dev = "PC"
    if "iphone" in ua_lower:
        dev = "iPhone"
    elif "ipad" in ua_lower:
        dev = "iPad"
    elif "android" in ua_lower:
        dev = "Android"
    elif "macintosh" in ua_lower:
        dev = "Mac"
    elif "windows" in ua_lower:
        dev = "Windows PC"
    elif "linux" in ua_lower:
        dev = "Linux PC"
    elif "nintendo" in ua_lower:
        dev = "Nintendo"
    
    browser = ""
    if "edg/" in ua_lower:
        browser = "Edge"
    elif "chrome/" in ua_lower:
        browser = "Chrome"
    elif "safari/" in ua_lower and "chrome" not in ua_lower:
        browser = "Safari"
    elif "firefox/" in ua_lower:
        browser = "Firefox"
    
    return f"{dev} • {browser}" if browser else dev

def check_trust_status(handler):
    """
    Verifica el origen de la petición y la presencia del token de confianza.
    Retorna un diccionario con el estado de autenticación y si se generó un nuevo token.
    """
    client_ip = get_client_ip(handler)
    is_local = is_local_ip(client_ip)
    
    # Extraer cookie _sysmon_trust
    cookie_header = handler.headers.get('Cookie', '')
    token = None
    if cookie_header:
        c = cookies.SimpleCookie()
        try:
            c.load(cookie_header)
            if '_sysmon_trust' in c:
                token = c['_sysmon_trust'].value
        except Exception:
            pass
            
    with TRUST_LOCK:
        devices = load_trusted_devices()
        token_hash = hash_token(token) if token else None
        device_entry = devices.get(token_hash) if token_hash else None
        new_token = None
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ua = handler.headers.get('User-Agent', '')

        if is_local:
            # En la red local, el dispositivo siempre tiene acceso.
            # Omitir persistencia de tokens para herramientas CLI locales (curl, scripts internos, urllib)
            if ua.startswith(('curl/', 'Wget/', 'python-requests', 'Go-http-client', 'Python-urllib')):
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "client_ip": client_ip,
                    "device_info": {"id": "cli_local", "name": "Herramienta Local (CLI)", "trusted": True},
                    "new_token": None
                }

            # Si es un navegador real en LAN y aún no tiene token o expiró, se le emite uno automáticamente.
            if not device_entry or not token:
                new_token = secrets.token_urlsafe(32)
                t_hash = hash_token(new_token)
                device_name = parse_user_agent(ua)
                device_entry = {
                    "id": f"dev_{secrets.token_hex(4)}",
                    "name": device_name,
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                    "local_ip": client_ip,
                    "user_agent": ua[:150],
                    "verified_in_lan": True,
                    "trusted": True
                }
                devices[t_hash] = device_entry
                save_trusted_devices(devices)
            else:
                # Dispositivo local ya emparejado: refrescar fecha y datos
                device_entry["last_seen"] = now_iso
                device_entry["local_ip"] = client_ip
                device_entry["verified_in_lan"] = True
                device_entry["trusted"] = True
                save_trusted_devices(devices)
                
            return {
                "is_local": True,
                "is_trusted": True,
                "client_ip": client_ip,
                "device_info": device_entry,
                "new_token": new_token
            }
        else:
            # Petición desde el EXTERIOR
            if device_entry and device_entry.get("trusted", False) and device_entry.get("verified_in_lan", True):
                # Dispositivo verificado previamente en la red local
                device_entry["last_seen"] = now_iso
                device_entry["last_external_ip"] = client_ip
                save_trusted_devices(devices)
                return {
                    "is_local": False,
                    "is_trusted": True,
                    "client_ip": client_ip,
                    "device_info": device_entry,
                    "new_token": None
                }
            else:
                # Dispositivo NO verificado en la red local -> TOTALMENTE NO DE CONFIANZA
                return {
                    "is_local": False,
                    "is_trusted": False,
                    "client_ip": client_ip,
                    "device_info": None,
                    "new_token": None
                }

def get_locked_page_html(client_ip):
    """Página interactiva para autorizar dispositivos remotos mediante la clave maestra."""
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Acceso al Servidor • Autorización Requerida</title>
  <style>
    :root {{
      --bg: #1e1e1e;
      --card-bg: #2d2d2d;
      --border: rgba(255, 255, 255, 0.1);
      --accent: #3584e4;
      --accent-hover: #1c71d8;
      --text: #ffffff;
      --text-dim: #9a9996;
      --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font); }}
    body {{
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }}
    .auth-card {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 32px 28px;
      width: 100%;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }}
    .auth-icon {{
      font-size: 42px;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
    }}
    p {{
      font-size: 13.5px;
      color: var(--text-dim);
      line-height: 1.5;
      margin-bottom: 24px;
    }}
    .input-box {{
      margin-bottom: 16px;
    }}
    input[type="password"] {{
      width: 100%;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: #242424;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }}
    input[type="password"]:focus {{
      border-color: var(--accent);
    }}
    button {{
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: var(--accent);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }}
    button:hover {{
      background: var(--accent-hover);
    }}
    .status-msg {{
      margin-top: 14px;
      font-size: 13px;
      min-height: 20px;
    }}
    .badge-ip {{
      display: inline-block;
      margin-top: 20px;
      font-size: 11px;
      color: var(--text-dim);
      background: rgba(255, 255, 255, 0.05);
      padding: 4px 10px;
      border-radius: 20px;
    }}
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="auth-icon">🛡️</div>
    <h1>Recursos del Servidor</h1>
    <p>Este dispositivo no está emparejado en la red local. Introduce la clave maestra de administrador para autorizarlo.</p>
    <form id="authForm" onsubmit="handleAuth(event)">
      <div class="input-box">
        <input type="password" id="masterKey" placeholder="Clave maestra de administrador" autofocus required />
      </div>
      <button type="submit" id="btnSubmit">Autorizar Dispositivo</button>
    </form>
    <div class="status-msg" id="statusMsg"></div>
    <div class="badge-ip">IP Origen: {client_ip}</div>
  </div>

  <script>
    async function handleAuth(e) {{
      e.preventDefault();
      const key = document.getElementById('masterKey').value.trim();
      const btn = document.getElementById('btnSubmit');
      const msg = document.getElementById('statusMsg');
      if (!key) return;

      btn.disabled = true;
      btn.textContent = 'Verificando...';
      msg.textContent = '';

      try {{
        const res = await fetch('/api/auth/unlock', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ key: key }})
        }});
        const data = await res.json();
        if (res.ok && data.success) {{
          msg.style.color = '#57e389';
          msg.textContent = '¡Autorizado con éxito! Cargando monitor...';
          setTimeout(() => {{ window.location.reload(); }}, 600);
        }} else {{
          msg.style.color = '#f87171';
          msg.textContent = data.error || 'Clave incorrecta.';
          btn.disabled = false;
          btn.textContent = 'Autorizar Dispositivo';
        }}
      }} catch (err) {{
        msg.style.color = '#f87171';
        msg.textContent = 'Error conectando con el servidor.';
        btn.disabled = false;
        btn.textContent = 'Autorizar Dispositivo';
      }}
    }}
  </script>
</body>
</html>"""


# ==============================================================================
# Hardware, OS & Metrics Collectors
# ==============================================================================
def get_cpu_info():
    try:
        per_cpu = psutil.cpu_percent(interval=None, percpu=True)
        cpu_percent = round(sum(per_cpu) / len(per_cpu), 1) if per_cpu else 0.0
        freq = psutil.cpu_freq()
        freq_current = round(freq.current, 1) if freq else 0
        cpu_temp = 0.0
        try:
            for hw in os.listdir("/sys/class/hwmon"):
                hw_dir = os.path.join("/sys/class/hwmon", hw)
                name_f = os.path.join(hw_dir, "name")
                if os.path.exists(name_f):
                    with open(name_f, "r") as nf:
                        if "coretemp" in nf.read():
                            t1 = os.path.join(hw_dir, "temp1_input")
                            if os.path.exists(t1):
                                with open(t1, "r") as tf:
                                    cpu_temp = round(int(tf.read().strip()) / 1000.0, 1)
                            break
        except Exception:
            pass
        load1, load5, load15 = os.getloadavg()
        return {
            "model": CPU_MODEL,
            "logical_cores": CORES_LOGICAL,
            "physical_cores": CORES_PHYSICAL,
            "usage_percent": cpu_percent,
            "per_core_percent": per_cpu,
            "freq_mhz": freq_current,
            "temp_c": cpu_temp,
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2)
        }
    except Exception as e:
        return {"error": str(e), "usage_percent": 0.0, "per_core_percent": [], "temp_c": 0.0}

def get_gpu_info():
    try:
        xml_out = subprocess.check_output(['nvidia-smi', '-q', '-x'], timeout=3).decode('utf-8', errors='ignore')
        root = ET.fromstring(xml_out)
        gpu = root.find('gpu')
        if gpu is None:
            return {"available": False, "gpu_procs_map": {}}
        
        name = gpu.findtext('product_name', 'NVIDIA GeForce GTX 1650')
        driver = root.findtext('driver_version', '') or gpu.findtext('driver_version', '595.84')
        cuda = root.findtext('cuda_version', '13.2')
        temp_str = gpu.findtext('temperature/gpu_temp', '0')
        temp = int(temp_str.replace('C', '').strip()) if temp_str else 0
        
        gpu_util_str = gpu.findtext('utilization/gpu_util', '0')
        gpu_util = int(gpu_util_str.replace('%', '').strip()) if gpu_util_str else 0
        
        mem_util_str = gpu.findtext('utilization/memory_util', '0')
        mem_util = int(mem_util_str.replace('%', '').strip()) if mem_util_str else 0
        
        mem_total_str = gpu.findtext('fb_memory_usage/total', '0')
        mem_total = int(mem_total_str.replace('MiB', '').strip()) if mem_total_str else 0
        
        mem_used_str = gpu.findtext('fb_memory_usage/used', '0')
        mem_used = int(mem_used_str.replace('MiB', '').strip()) if mem_used_str else 0
        
        mem_free_str = gpu.findtext('fb_memory_usage/free', '0')
        mem_free = int(mem_free_str.replace('MiB', '').strip()) if mem_free_str else 0
        
        fan_str = gpu.findtext('fan_speed', '0')
        fan = int(fan_str.replace('%', '').strip()) if fan_str and fan_str != 'N/A' else 0
        
        power_str = gpu.findtext('gpu_power_readings/power_draw', '0') or gpu.findtext('power_readings/power_draw', '0')
        power = float(power_str.replace('W', '').strip()) if power_str and power_str != 'N/A' else 0.0
        
        processes = []
        gpu_procs_map = {}
        for p in gpu.findall('processes/process_info'):
            pid_str = p.findtext('pid', '')
            pname = p.findtext('process_name', '')
            pmem = p.findtext('used_memory', '')
            ptype = p.findtext('type', '')
            
            # Limpiar nombre del comando/ejecutable eliminando argumentos de línea de comandos
            clean_cmd = pname.strip() if pname else ''
            first_token = clean_cmd.split()[0] if clean_cmd else ''
            clean_name = os.path.basename(first_token) if first_token else 'Desconocido'
            
            try:
                pid_int = int(pid_str)
                vram_num = float(pmem.replace('MiB', '').replace('MB', '').strip())
                gpu_procs_map[pid_int] = {"vram_mb": vram_num, "type": ptype}
                
                # Si el proceso existe en el sistema, obtener su nombre limpio de proceso
                if psutil.pid_exists(pid_int):
                    p_comm = psutil.Process(pid_int).name()
                    if p_comm:
                        clean_name = p_comm
            except Exception:
                pass
                
            # Asignar nombres limpios y descriptivos para procesos conocidos
            lower = clean_name.lower()
            if 'chrome' in lower:
                display_name = 'Google Chrome (GPU / Render)'
            elif 'gnome-shell' in lower:
                display_name = 'GNOME Shell (Compositor Wayland)'
            elif 'xwayland' in lower:
                display_name = 'Xwayland (Compatibilidad X11)'
            elif 'ptyxis' in lower:
                display_name = 'Ptyxis (Terminal)'
            elif 'nautilus' in lower:
                display_name = 'Nautilus (Archivos)'
            elif 'ffmpeg' in lower:
                display_name = 'FFmpeg (Transcodificación NVENC)'
            elif 'python' in lower:
                if 'asterisk' in clean_cmd:
                    display_name = 'Python (Asterisk PBX / Whisper)'
                elif 'immich' in clean_cmd:
                    display_name = 'Python (Immich Machine Learning)'
                else:
                    display_name = f'Python3 ({clean_name})'
            else:
                display_name = clean_name
                
            processes.append({
                "pid": pid_str,
                "name": display_name,
                "raw_name": clean_name,
                "full_path": pname,
                "used_memory": pmem,
                "type": ptype
            })
            
        return {
            "available": True,
            "name": name,
            "driver": driver,
            "cuda": cuda,
            "temp_c": temp,
            "gpu_util_percent": gpu_util,
            "mem_util_percent": mem_util,
            "vram_total_mb": mem_total,
            "vram_used_mb": mem_used,
            "vram_free_mb": mem_free,
            "vram_percent": round((mem_used / mem_total * 100), 1) if mem_total > 0 else 0,
            "fan_percent": fan,
            "power_watts": power,
            "processes": processes,
            "gpu_procs_map": gpu_procs_map
        }
    except Exception as e:
        return {"available": False, "error": str(e), "gpu_procs_map": {}}

def fetch_gpu_worker():
    global GPU_CACHE
    while True:
        try:
            info = get_gpu_info()
            with GPU_LOCK:
                GPU_CACHE = info
        except Exception:
            pass
        time.sleep(1.8)

def get_ram_info():
    try:
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()
        
        cached_total = getattr(vm, 'cached', 0) + getattr(vm, 'buffers', 0)
        total_used = vm.total - vm.free
        
        used_pct = round(vm.used / vm.total * 100, 1) if vm.total > 0 else 0.0
        cached_pct = round(cached_total / vm.total * 100, 1) if vm.total > 0 else 0.0
        total_used_pct = round(total_used / vm.total * 100, 1) if vm.total > 0 else 0.0
        avail_pct = round(vm.available / vm.total * 100, 1) if vm.total > 0 else 0.0
        free_pct = round(vm.free / vm.total * 100, 1) if vm.total > 0 else 0.0
        
        zram_used = 0
        zram_total = 0
        disk_swap_used = 0
        disk_swap_total = 0
        zram_active = False
        
        try:
            with open("/proc/swaps", "r") as f:
                for line in f.readlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 5:
                        dev = parts[0]
                        size_b = int(parts[2]) * 1024
                        used_b = int(parts[3]) * 1024
                        if "zram" in dev:
                            zram_active = True
                            zram_total += size_b
                            zram_used += used_b
                        else:
                            disk_swap_total += size_b
                            disk_swap_used += used_b
        except Exception:
            pass

        return {
            "total_bytes": vm.total,
            "used_bytes": vm.used,
            "free_bytes": vm.free,
            "available_bytes": vm.available,
            "cached_bytes": getattr(vm, 'cached', 0),
            "buffers_bytes": getattr(vm, 'buffers', 0),
            "cached_total_bytes": cached_total,
            "total_used_bytes": total_used,
            "percent": used_pct,
            "cached_percent": cached_pct,
            "total_used_percent": total_used_pct,
            "available_percent": avail_pct,
            "free_percent": free_pct,
            "swap_total_bytes": swap.total,
            "swap_used_bytes": swap.used,
            "swap_free_bytes": swap.free,
            "swap_percent": swap.percent,
            "zram_active": zram_active,
            "zram_total_bytes": zram_total,
            "zram_used_bytes": zram_used,
            "disk_swap_total_bytes": disk_swap_total,
            "disk_swap_used_bytes": disk_swap_used
        }
    except Exception as e:
        return {"error": str(e), "percent": 0.0, "total_used_percent": 0.0}

def fetch_disks_worker():
    global DISKS_CACHE
    target_mounts = [
        ("/", "SSD Sistema (NVMe /)", "/dev/nvme0n1p2", "ext4"),
        ("/mnt/almacenamiento", "HDD Almacenamiento 1TB (Servicios, Logs & Descargas)", "/dev/sda1", "ext4"),
        ("/home/servidor/nas/video", "NAS Synology • Video (Cine y Series)", "//192.168.50.3/video", "cifs / smb3"),
        ("/home/servidor/nas/photo", "NAS Synology • Fotos (Immich Library)", "//192.168.50.3/photo", "cifs / smb3"),
        ("/home/servidor/nas/onedrive", "NAS Synology • OneDrive (Nextcloud)", "//192.168.50.3/OneDrive", "cifs / smb3"),
        ("/home/servidor/nas/homes", "NAS Synology • Personal (Homes)", "//192.168.50.3/homes", "cifs / smb3")
    ]
    while True:
        try:
            nvme_temp = None
            try:
                for hw in os.listdir("/sys/class/hwmon"):
                    hw_dir = os.path.join("/sys/class/hwmon", hw)
                    name_f = os.path.join(hw_dir, "name")
                    if os.path.exists(name_f):
                        with open(name_f, "r") as nf:
                            if "nvme" in nf.read():
                                t1 = os.path.join(hw_dir, "temp1_input")
                                if os.path.exists(t1):
                                    with open(t1, "r") as tf:
                                        nvme_temp = round(int(tf.read().strip()) / 1000.0, 1)
                                break
            except Exception:
                pass

            disks = []
            for mpoint, label, dev_name, fstype in target_mounts:
                try:
                    if not os.path.exists(mpoint):
                        continue
                    st = os.statvfs(mpoint)
                    total = st.f_blocks * st.f_frsize
                    free = st.f_bavail * st.f_frsize
                    used = total - (st.f_bfree * st.f_frsize)
                    if total == 0:
                        continue
                    percent = round((used / total) * 100, 1)
                    disks.append({
                        "mountpoint": mpoint,
                        "label": label,
                        "device": dev_name,
                        "fstype": fstype,
                        "temp_c": nvme_temp if mpoint == "/" else None,
                        "total_bytes": total,
                        "used_bytes": used,
                        "free_bytes": free,
                        "percent": percent
                    })
                except Exception:
                    continue
            with DISKS_LOCK:
                DISKS_CACHE = disks
        except Exception:
            pass
        time.sleep(10)

SYSTEMD_MONITORED_UNITS = [
    ("emby-server.service", "Emby Media Server", "🎬 Multimedia NVENC"),
    ("pihole-FTL.service", "Pi-hole FTL DNS & DHCP", "🛡️ DNS Sinkhole"),
    ("qbittorrent-nox.service", "qBittorrent-nox", "📥 Gestor Torrents"),
    ("control-acceso-s10.service", "Control Parental (Galaxy A8)", "🔒 Portal Cautivo TV, Xiaomi TV Stick y Xbox"),
    ("network-monitor.service", "Monitor de Red LAN", "🌐 Escáner ARP"),
    ("network-watchdog.service", "Watchdog Conectividad", "📡 Vigilancia LAN/WAN"),
    ("services-monitor.service", "Monitor de Salud Telegram", "🤖 Alertas 24/7")
]

def fetch_docker_worker():
    global DOCKER_CACHE
    while True:
        try:
            # 1. Obtener estado de TODOS los contenedores (incluso detenidos)
            ps_out = subprocess.check_output(
                ['docker', 'ps', '-a', '--format', '{{json .}}'],
                timeout=5
            ).decode('utf-8', errors='ignore')
            all_meta = {}
            for line in ps_out.strip().split('\n'):
                if not line.strip():
                    continue
                try:
                    d = json.loads(line)
                    all_meta[d.get("Names", "")] = {
                        "id": d.get("ID", ""),
                        "state": d.get("State", "unknown"),
                        "status": d.get("Status", ""),
                        "image": d.get("Image", "")
                    }
                except Exception:
                    pass

            # 2. Obtener estadísticas en vivo de los contenedores en ejecución
            out = subprocess.check_output(
                ['docker', 'stats', '--no-stream', '--format', '{{json .}}'],
                timeout=5
            ).decode('utf-8', errors='ignore')
            
            containers = []
            seen_names = set()
            for line in out.strip().split('\n'):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    cname = data.get("Name", "")
                    seen_names.add(cname)
                    cpu_raw = data.get("CPUPerc", "0%")
                    cpu_val = float(cpu_raw.replace('%', '').strip() or 0.0)
                    
                    mem_raw = data.get("MemPerc", "0%")
                    mem_pct_val = float(mem_raw.replace('%', '').strip() or 0.0)
                    
                    mem_use_str = data.get("MemUsage", "").split('/')[0].strip()
                    mem_mb = 0.0
                    clean_str = mem_use_str.strip()
                    if "GiB" in clean_str or "GB" in clean_str:
                        num = float(clean_str.replace("GiB", "").replace("GB", "").strip() or 0)
                        mem_mb = num * 1024
                    elif "MiB" in clean_str or "MB" in clean_str:
                        mem_mb = float(clean_str.replace("MiB", "").replace("MB", "").strip() or 0)
                    elif "KiB" in clean_str or "kB" in clean_str or "KB" in clean_str:
                        mem_mb = float(clean_str.replace("KiB", "").replace("kB", "").replace("KB", "").strip() or 0) / 1024
                    elif "B" in clean_str:
                        mem_mb = float(clean_str.replace("B", "").strip() or 0) / (1024 * 1024)
                    
                    meta = all_meta.get(cname, {})
                    containers.append({
                        "name": cname,
                        "id": data.get("ID", ""),
                        "state": meta.get("state", "running"),
                        "status": meta.get("status", "Up"),
                        "cpu_percent": cpu_raw,
                        "cpu_val": cpu_val,
                        "cpu_norm_percent": round(cpu_val / max(1, CORES_LOGICAL), 1),
                        "mem_usage": data.get("MemUsage", ""),
                        "mem_mb": round(mem_mb, 1),
                        "mem_percent": mem_raw,
                        "mem_pct_val": mem_pct_val,
                        "net_io": data.get("NetIO", ""),
                        "block_io": data.get("BlockIO", ""),
                        "pids": data.get("PIDs", "")
                    })
                except Exception:
                    continue

            # Añadir contenedores detenidos para que sean visibles y se puedan arrancar
            for cname, meta in all_meta.items():
                if cname not in seen_names:
                    containers.append({
                        "name": cname,
                        "id": meta.get("id", ""),
                        "state": meta.get("state", "exited"),
                        "status": meta.get("status", "Detenido"),
                        "cpu_percent": "0.00%",
                        "cpu_val": 0.0,
                        "cpu_norm_percent": 0.0,
                        "mem_usage": "0MiB / --",
                        "mem_mb": 0.0,
                        "mem_percent": "0.00%",
                        "mem_pct_val": 0.0,
                        "net_io": "0B / 0B",
                        "block_io": "0B / 0B",
                        "pids": "0"
                    })

            sorted_c = sorted(containers, key=lambda x: (0 if x.get("state") != "running" else 1, -x.get('cpu_val', 0.0)))

            # 3. Estado de servicios Systemd principales (consulta única ultraligera)
            sysd_list = []
            try:
                unit_names = [u[0] for u in SYSTEMD_MONITORED_UNITS]
                p_sys = subprocess.run(
                    ['systemctl', 'is-active'] + unit_names,
                    capture_output=True, text=True, timeout=3
                )
                states = p_sys.stdout.strip().split('\n')
                for idx, (unit_id, friendly_name, role_tag) in enumerate(SYSTEMD_MONITORED_UNITS):
                    st = states[idx].strip() if idx < len(states) else "unknown"
                    sysd_list.append({
                        "unit": unit_id,
                        "name": friendly_name,
                        "role": role_tag,
                        "active": (st == "active"),
                        "state": st
                    })
            except Exception:
                pass

            # 4. Descargas qBittorrent
            torrents_list = []
            torrent_stats = {
                "dl_info_speed": 0,
                "up_info_speed": 0,
                "dl_info_data": 0,
                "up_info_data": 0,
                "connection_status": "disconnected",
                "active_count": 0,
                "downloading_count": 0,
                "seeding_count": 0
            }
            try:
                req_tr = urllib.request.Request("http://127.0.0.1:8082/api/v2/transfer/info")
                with urllib.request.urlopen(req_tr, timeout=1.2) as resp_tr:
                    tr_data = json.loads(resp_tr.read().decode("utf-8"))
                    torrent_stats["dl_info_speed"] = tr_data.get("dl_info_speed", 0)
                    torrent_stats["up_info_speed"] = tr_data.get("up_info_speed", 0)
                    torrent_stats["dl_info_data"] = tr_data.get("dl_info_data", 0)
                    torrent_stats["up_info_data"] = tr_data.get("up_info_data", 0)
                    torrent_stats["connection_status"] = tr_data.get("connection_status", "connected")
            except Exception:
                pass

            try:
                req = urllib.request.Request("http://127.0.0.1:8082/api/v2/torrents/info")
                with urllib.request.urlopen(req, timeout=1.5) as resp:
                    t_data = json.loads(resp.read().decode("utf-8"))
                    dl_cnt = 0
                    seed_cnt = 0
                    for t in t_data:
                        st = t.get("state", "")
                        st_lower = st.lower()
                        if "dl" in st_lower or "download" in st_lower:
                            dl_cnt += 1
                        elif "up" in st_lower or "seed" in st_lower:
                            seed_cnt += 1
                        torrents_list.append({
                            "name": t.get("name", ""),
                            "hash": t.get("hash", ""),
                            "progress": round(t.get("progress", 0.0) * 100, 1),
                            "state": st,
                            "dlspeed": t.get("dlspeed", 0),
                            "upspeed": t.get("upspeed", 0),
                            "size": t.get("total_size", 0) or t.get("size", 0),
                            "downloaded": t.get("downloaded", 0),
                            "uploaded": t.get("uploaded", 0),
                            "eta": t.get("eta", 8640000),
                            "ratio": round(t.get("ratio", 0.0), 2),
                            "num_seeds": t.get("num_seeds", 0),
                            "num_leechs": t.get("num_leechs", 0)
                        })
                    torrent_stats["active_count"] = len(torrents_list)
                    torrent_stats["downloading_count"] = dl_cnt
                    torrent_stats["seeding_count"] = seed_cnt
            except Exception:
                pass

            # 5. Base de datos SQLite de Emby (library.db)
            emby_data = {
                "movies_count": 0,
                "series_count": 0,
                "episodes_count": 0,
                "recent_media": [],
                "available": False
            }
            try:
                emby_db = "/home/servidor/servicios/emby/programdata/data/library.db"
                if os.path.exists(emby_db):
                    conn_emby = sqlite3.connect(f"file:{emby_db}?mode=ro", uri=True, timeout=1.5)
                    cur_emby = conn_emby.cursor()
                    cur_emby.execute("SELECT count(*) FROM MediaItems WHERE type = 5")
                    emby_data["movies_count"] = cur_emby.fetchone()[0]
                    cur_emby.execute("SELECT count(*) FROM MediaItems WHERE type = 6")
                    emby_data["series_count"] = cur_emby.fetchone()[0]
                    cur_emby.execute("SELECT count(*) FROM MediaItems WHERE type = 8")
                    emby_data["episodes_count"] = cur_emby.fetchone()[0]
                    
                    cur_emby.execute('''
                        SELECT Id, Name, SeriesName, ParentIndexNumber, IndexNumber, ProductionYear, type, DateCreated, Path
                        FROM MediaItems
                        WHERE type IN (5, 8)
                        ORDER BY DateCreated DESC
                        LIMIT 12
                    ''')
                    recent = []
                    for r in cur_emby.fetchall():
                        m_type = "movie" if r[6] == 5 else "episode"
                        title = f"{r[2]} - S{r[3]:02d}E{r[4]:02d}" if m_type == "episode" and r[2] and r[3] and r[4] else r[1]
                        recent.append({
                            "id": r[0],
                            "title": title,
                            "series_name": r[2] or "",
                            "season": r[3],
                            "episode": r[4],
                            "year": r[5],
                            "type": m_type,
                            "date_created": r[7],
                            "path": r[8] or ""
                        })
                    emby_data["recent_media"] = recent
                    emby_data["available"] = True
                    conn_emby.close()
            except Exception:
                pass

            parental_info = {"authorized": False, "status": "BLOCKED", "reason": "Galaxy A8 offline"}
            try:
                st_file = "/home/servidor/servicios/control_acceso_s10/estado.json"
                if os.path.exists(st_file):
                    with open(st_file, "r") as pf:
                        p_raw = json.load(pf)
                        st_val = p_raw.get("status", "BLOCKED")
                        auth_ok = (st_val == "UNBLOCKED")
                        parental_info = {
                            "authorized": auth_ok,
                            "permanent": auth_ok,
                            "status": st_val,
                            "reason": p_raw.get("reason", ""),
                            "last_change": p_raw.get("last_change", "")
                        }
            except Exception:
                pass

            with DOCKER_LOCK:
                DOCKER_CACHE = sorted_c
                SYSTEMD_CACHE[:] = sysd_list
                EXTRAS_CACHE["torrents"] = torrents_list
                EXTRAS_CACHE["torrent_stats"] = torrent_stats
                EXTRAS_CACHE["emby"] = emby_data
                EXTRAS_CACHE["parental"] = parental_info
        except Exception:
            pass
        time.sleep(3.5)

# ==============================================================================
DEVICE_FRIENDLY_NAMES = {
    "00:50:B6:BE:89:96": "servidor (Este Servidor)",
    "90:09:D0:08:EC:98": "synology-nas (Almacenamiento Red)",
    "18:B0:A4:D3:C5:3A": "Router Vodafone (Gateway Principal)",
    "D4:5D:64:C5:75:40": "Repetidor ASUS RT-AX56U (Switch & Wi-Fi 6)",
    "64:B5:C6:0A:80:45": "Nintendo 3DS",
    "78:20:A5:C0:C4:6A": "Nintendo Switch OLED",
    "40:44:F7:3E:6B:F1": "Nintendo Switch 2",
    "54:4C:8A:A8:93:D3": "Xbox Series S",
    "2C:54:91:66:C9:2F": "Xbox One X",
    "1A:C3:E4:9A:12:A8": "Galaxy Tab S9 Ultra (Yonah)",
    "E4:9F:7D:B2:C2:B2": "Galaxy Tab S10 Lite (Yanelis)",
    "F4:02:28:61:A1:98": "Galaxy S21 (Yanelis)",
    "7A:56:9B:5F:97:BE": "Galaxy S10 (Yonah)",
    "00:B5:D0:F2:69:F3": "Galaxy A8 (Control Parental)",
    "5A:F2:2B:00:BC:86": "Galaxy S25 (Yonah)",
    "CA:AB:12:6B:FC:62": "Xiaomi Redmi A3",
    "38:8B:59:30:C9:D6": "Google Home Mini (Principal)",
    "38:8B:59:2F:D0:00": "Google Home Mini (Cocina)",
    "38:8B:59:57:E2:ED": "Google Home Mini (Salón)",
    "C4:98:5C:81:22:6C": "TV Sala de Estar (TCL)",
    "54:2A:A2:EF:B0:B2": "Smart TV Philips 40PUH6400 (Wi-Fi)",
    "1C:5A:6B:95:F6:08": "Smart TV Philips 40PUH6400 (Ethernet)",
    "E4:C3:2A:CC:68:6A": "Bombilla TP-Link Tapo",
    "C0:F8:53:AE:9A:75": "Enchufe Tuya Smart",
    "C4:4F:33:89:21:13": "Luz de la cocina",
    "C4:4F:33:8C:5F:94": "Luz de la solana",
    "60:01:94:CF:16:E6": "Luz del baño",
    "70:3E:97:95:5F:64": "Xiaomi TV Stick (TV Dormitorio)",
    "7A:CA:DE:60:93:1B": "Sony Xperia XZ3",
    "00:90:4C:DB:A9:B8": "Ubuntu Phablet",
}

# ==============================================================================
# ASUS Wi-Fi Repeater Client & Traffic Monitor
# ==============================================================================
def get_arp_and_pihole_names():
    arp_map = {}
    
    # 1. Leer nombres estáticos de /etc/hosts
    hosts_ip_to_name = {}
    try:
        with open("/etc/hosts", "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    parts = line.split()
                    if len(parts) >= 2 and parts[0].startswith("192.168.50."):
                        hosts_ip_to_name[parts[0]] = parts[1]
    except Exception:
        pass

    # 2. Leer tabla de vecinos ARP (ip neigh)
    try:
        p = subprocess.run(['ip', 'neigh'], capture_output=True, text=True, timeout=2)
        for line in p.stdout.splitlines():
            m = re.search(r'^(192\.168\.50\.\d+)\s+.*lladdr\s+([0-9a-fA-F:]{17})', line)
            if m:
                ip, mac = m.group(1), m.group(2).upper()
                name = DEVICE_FRIENDLY_NAMES.get(mac) or hosts_ip_to_name.get(ip, ip)
                arp_map[mac] = {'ip': ip, 'name': name}
    except Exception:
        pass

    # 3. Leer base de datos de Pi-hole FTL en modo solo lectura sin subprocesos ni bloqueos
    try:
        conn_pi = sqlite3.connect("file:/etc/pihole/pihole-FTL.db?mode=ro", uri=True, timeout=2.0)
        cur_pi = conn_pi.cursor()
        cur_pi.execute(
            "SELECT network.hwaddr, network.macVendor, network_addresses.name, network_addresses.ip "
            "FROM network JOIN network_addresses ON network.id = network_addresses.network_id "
            "ORDER BY network_addresses.lastSeen DESC;"
        )
        for row in cur_pi.fetchall():
            mac = (row[0] or "").upper()
            vendor = row[1] or ""
            name = row[2] or ""
            ip = row[3] or ""
            if ip.startswith('192.168.50.'):
                final_name = DEVICE_FRIENDLY_NAMES.get(mac) or hosts_ip_to_name.get(ip) or name or vendor or ip
                if mac not in arp_map:
                    arp_map[mac] = {'ip': ip, 'name': final_name}
                else:
                    if DEVICE_FRIENDLY_NAMES.get(mac):
                        arp_map[mac]['name'] = DEVICE_FRIENDLY_NAMES[mac]
                    elif hosts_ip_to_name.get(ip):
                        arp_map[mac]['name'] = hosts_ip_to_name[ip]
                    elif name and arp_map[mac]['name'] == arp_map[mac]['ip']:
                        arp_map[mac]['name'] = name
        conn_pi.close()
    except Exception:
        pass
    return arp_map

def classify_device(name, mac):
    name_l = (name or "").lower()
    
    # 1. Detectar Marca / Fabricante
    brand = "generic"
    brand_name = "Dispositivo"
    
    if any(k in name_l for k in ["nintendo", "3ds", "2ds", "switch", "wii", "dsi"]):
        brand = "nintendo"
        brand_name = "Nintendo"
    elif any(k in name_l for k in ["xbox", "series-s", "series-x", "cminewar-s"]):
        brand = "xbox"
        brand_name = "Microsoft Xbox"
    elif any(k in name_l for k in ["samsung", "s21", "s10", "s20", "s22", "s23", "s24", "s25", "galaxy", "tab-s"]):
        brand = "samsung"
        brand_name = "Samsung"
    elif any(k in name_l for k in ["xiaomi", "redmi", "poco"]):
        brand = "xiaomi"
        brand_name = "Xiaomi"
    elif any(k in name_l for k in ["google", "home-mini", "pixel", "chromecast"]):
        brand = "google"
        brand_name = "Google"
    elif any(k in name_l for k in ["asus", "rt-ax56u"]):
        brand = "asus"
        brand_name = "ASUS"
    elif any(k in name_l for k in ["vodafone"]):
        brand = "vodafone"
        brand_name = "Vodafone"
    elif any(k in name_l for k in ["synology"]):
        brand = "synology"
        brand_name = "Synology"
    elif any(k in name_l for k in ["tapo", "tp-link", "tplink"]):
        brand = "tplink"
        brand_name = "TP-Link Tapo"
    elif any(k in name_l for k in ["esp", "esp32", "esp8266", "espressif", "domotica", "enchufe"]):
        brand = "espressif"
        brand_name = "Espressif IoT"
    elif any(k in name_l for k in ["tuya"]):
        brand = "tuya"
        brand_name = "Tuya Smart"
    elif any(k in name_l for k in ["sony", "playstation", "ps4", "ps5", "bravia", "xperia"]):
        brand = "sony"
        brand_name = "Sony"
    elif any(k in name_l for k in ["apple", "iphone", "ipad", "macbook"]):
        brand = "apple"
        brand_name = "Apple"
    elif any(k in name_l for k in ["acer"]):
        brand = "acer"
        brand_name = "Acer"
    elif any(k in name_l for k in ["ubuntu"]):
        brand = "ubuntu"
        brand_name = "Ubuntu"
    elif any(k in name_l for k in ["intel", "xeon"]):
        brand = "intel"
        brand_name = "Intel"

    # 2. Detectar Tipo e Icono
    if brand == "nintendo" or brand == "xbox" or any(k in name_l for k in ["playstation", "ps4", "ps5"]):
        dev_type = "game_console"
        dev_icon = "gamepad"
    elif any(k in name_l for k in ["tab", "ipad", "tablet"]):
        dev_type = "tablet"
        dev_icon = "tablet"
    elif any(k in name_l for k in ["iphone", "android", "mobile", "phone", "s21", "s10", "s20", "s22", "s23", "s24", "s25", "redmi", "pixel", "xperia"]):
        dev_type = "mobile"
        dev_icon = "mobile"
    elif any(k in name_l for k in ["tv", "bravia", "samsung-tv", "lg-tv", "chromecast", "firetv", "shield"]):
        dev_type = "smart_tv"
        dev_icon = "tv"
    elif any(k in name_l for k in ["speaker", "home-mini", "echo", "alexa"]):
        dev_type = "speaker"
        dev_icon = "speaker"
    elif any(k in name_l for k in ["esp", "domotica", "enchufe", "tapo", "shelly", "sonoff", "bulb", "bombilla", "luz"]):
        dev_type = "iot"
        dev_icon = "plug"
    elif any(k in name_l for k in ["nas", "synology", "servidor", "server"]):
        dev_type = "server"
        dev_icon = "server"
    elif any(k in name_l for k in ["asus", "router", "repeater", "gateway", "switch"]):
        dev_type = "network"
        dev_icon = "router"
    elif any(k in name_l for k in ["pc", "laptop", "desktop", "thinkpad", "macbook"]):
        dev_type = "computer"
        dev_icon = "laptop"
    else:
        dev_type = "device"
        dev_icon = "wifi"

    return {
        "type": dev_type,
        "icon": dev_icon,
        "brand": brand,
        "brand_name": brand_name
    }

MAC_RATE_CACHE = {}

def fetch_wifi_worker():
    global WIFI_CACHE, MAC_RATE_CACHE
    while True:
        try:
            arp_map = get_arp_and_pihole_names()

            # Leer estadísticas de red local cableada del servidor
            local_server_tx = 0
            local_server_rx = 0
            try:
                with open("/proc/net/dev", "r") as f:
                    for line in f:
                        if "enx" in line or "eth0" in line:
                            parts = line.split(":", 1)[1].split()
                            local_server_rx = int(parts[0])
                            local_server_tx = int(parts[8])
                            break
            except Exception:
                pass

            ssh_cmd = [
                'sshpass', '-p', ROUTER_PASS,
                'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=4',
                f'{ROUTER_USER}@{ROUTER_IP}',
                '''
                for iface in eth5 eth6; do
                    for mac in $(wl -i $iface assoclist | awk '{print $2}'); do
                        echo "=== $iface $mac ==="
                        wl -i $iface sta_info $mac | grep -E "(in network|tx total bytes|rx data bytes|smoothed rssi|idle)"
                    done
                done
                echo "=== ETH_PORTS ==="
                cat /proc/net/dev | grep -E "(eth0|eth3|eth4):"
                echo "=== FCACHE_L2 ==="
                cat /proc/fcache/l2list 2>/dev/null
                '''
            ]
            p = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=8)
            if p.returncode == 0:
                wifi_clients = []
                current = None
                eth_lines = []
                fcache_lines = []
                section = 'wifi'

                for line in p.stdout.splitlines():
                    line = line.strip()
                    if line == '=== ETH_PORTS ===':
                        section = 'eth'
                        current = None
                        continue
                    elif line == '=== FCACHE_L2 ===':
                        section = 'fcache'
                        current = None
                        continue

                    if section == 'eth':
                        if ':' in line:
                            eth_lines.append(line)
                        continue
                    elif section == 'fcache':
                        if '<' in line and '>' in line:
                            fcache_lines.append(line)
                        continue

                    # wifi
                    if line.startswith('=== '):
                        parts = line.split()
                        if len(parts) >= 3:
                            current = {
                                'conn_type': 'wifi',
                                'band': '5 GHz' if parts[1] == 'eth6' else '2.4 GHz',
                                'iface': parts[1],
                                'mac': parts[2].upper(),
                                'in_network': 0,
                                'tx_bytes': 0,
                                'rx_bytes': 0,
                                'rssi': 0
                            }
                            wifi_clients.append(current)
                    elif current:
                        if 'in network' in line:
                            m = re.search(r'in network (\d+) seconds', line)
                            if m: current['in_network'] = int(m.group(1))
                        elif 'tx total bytes:' in line:
                            m = re.search(r'tx total bytes:\s+(\d+)', line)
                            if m: current['tx_bytes'] = int(m.group(1))
                        elif 'rx data bytes:' in line:
                            m = re.search(r'rx data bytes:\s+(\d+)', line)
                            if m: current['rx_bytes'] = int(m.group(1))
                        elif 'smoothed rssi:' in line:
                            m = re.search(r'smoothed rssi:\s+([-\d]+)', line)
                            if m: current['rssi'] = int(m.group(1))

                # Procesar flujos acelerados por hardware del switch ASUS (Flow Cache L2)
                fcache_stats = {}
                for f_line in fcache_lines:
                    m_fc = re.search(r'(\d+)\s+(?:EPHY|WPHY)\s+\d+\s+<([0-9a-fA-F:]{17})>\s+<([0-9a-fA-F:]{17})>', f_line)
                    if m_fc:
                        hits = int(m_fc.group(1))
                        src = m_fc.group(2).upper()
                        dst = m_fc.group(3).upper()
                        is_ack = ' 1   0' in f_line or f_line.endswith(' 1   0')
                        bytes_est = hits * (66 if is_ack else 1450)

                        # dst recibe = descarga para el cliente (tx_bytes en dashboard)
                        fcache_stats.setdefault(dst, {'tx_bytes': 0, 'rx_bytes': 0})
                        fcache_stats[dst]['tx_bytes'] += bytes_est

                        # src transmite = subida del cliente (rx_bytes en dashboard)
                        fcache_stats.setdefault(src, {'tx_bytes': 0, 'rx_bytes': 0})
                        fcache_stats[src]['rx_bytes'] += bytes_est

                # Calcular tasas de velocidad en vivo por MAC
                now_t = time.time()
                for mac_k, st_v in fcache_stats.items():
                    prev = MAC_RATE_CACHE.get(mac_k)
                    if prev:
                        dt = now_t - prev['time']
                        if dt > 0:
                            st_v['speed_down'] = max(0, int((st_v['tx_bytes'] - prev['tx']) / dt))
                            st_v['speed_up'] = max(0, int((st_v['rx_bytes'] - prev['rx']) / dt))
                        else:
                            st_v['speed_down'] = 0
                            st_v['speed_up'] = 0
                    else:
                        st_v['speed_down'] = 0
                        st_v['speed_up'] = 0
                    MAC_RATE_CACHE[mac_k] = {'tx': st_v['tx_bytes'], 'rx': st_v['rx_bytes'], 'time': now_t}

                # Extraer tráfico cableado del ASUS
                asus_eth0_rx, asus_eth0_tx = 0, 0
                asus_eth4_rx, asus_eth4_tx = 0, 0
                asus_eth3_rx, asus_eth3_tx = 0, 0
                for line in eth_lines:
                    if 'eth0:' in line:
                        parts = line.split(':', 1)[1].split()
                        asus_eth0_rx, asus_eth0_tx = int(parts[0]), int(parts[8])
                    elif 'eth4:' in line:
                        parts = line.split(':', 1)[1].split()
                        asus_eth4_rx, asus_eth4_tx = int(parts[0]), int(parts[8])
                    elif 'eth3:' in line:
                        parts = line.split(':', 1)[1].split()
                        asus_eth3_rx, asus_eth3_tx = int(parts[0]), int(parts[8])

                # Dispositivos de Cable Ethernet reales (sin puertos falsos)
                cable_clients = [
                    {
                        "conn_type": "cable",
                        "band": "Cable Gigabit",
                        "iface": "Ethernet (1G)",
                        "mac": "00:50:B6:BE:89:96",
                        "ip": "192.168.50.2",
                        "name": "servidor (Este Servidor)",
                        "dev_type": "server",
                        "dev_icon": "server",
                        "brand": "intel",
                        "brand_name": "Intel Xeon / Linux",
                        "status": "online",
                        "tx_bytes": local_server_tx,
                        "rx_bytes": local_server_rx,
                        "rssi": 1000,
                        "in_network": int(time.time() - BOOT_TIME)
                    },
                    {
                        "conn_type": "cable",
                        "band": "Cable Gigabit",
                        "iface": "Ethernet (1G)",
                        "mac": "90:09:D0:08:EC:98",
                        "ip": "192.168.50.3",
                        "name": "synology-nas (Almacenamiento Red)",
                        "dev_type": "nas",
                        "dev_icon": "server",
                        "brand": "synology",
                        "brand_name": "Synology",
                        "status": "online",
                        "tx_bytes": 0,
                        "rx_bytes": 0,
                        "rssi": 1000,
                        "in_network": int(time.time() - BOOT_TIME)
                    },
                    {
                        "conn_type": "cable",
                        "band": "Cable Uplink",
                        "iface": "WAN (Gigabit)",
                        "mac": "18:B0:A4:D3:C5:3A",
                        "ip": "192.168.50.1",
                        "name": "Router Vodafone (Gateway Principal)",
                        "dev_type": "network",
                        "dev_icon": "router",
                        "brand": "vodafone",
                        "brand_name": "Vodafone",
                        "status": "online",
                        "tx_bytes": asus_eth0_tx,
                        "rx_bytes": asus_eth0_rx,
                        "rssi": 1000,
                        "in_network": int(time.time() - BOOT_TIME)
                    },
                    {
                        "conn_type": "cable",
                        "band": "Cable Gigabit",
                        "iface": "LAN (Gigabit)",
                        "mac": "D4:5D:64:C5:75:40",
                        "ip": "192.168.50.10",
                        "name": "Repetidor ASUS RT-AX56U (Switch & Wi-Fi 6)",
                        "dev_type": "network",
                        "dev_icon": "router",
                        "brand": "asus",
                        "brand_name": "ASUS",
                        "status": "online",
                        "tx_bytes": asus_eth4_tx,
                        "rx_bytes": asus_eth4_rx,
                        "rssi": 1000,
                        "in_network": int(time.time() - BOOT_TIME)
                    }
                ]

                c_24 = 0
                c_5 = 0
                wifi_tx = 0
                wifi_rx = 0

                known_macs = set()
                known_ips = set()

                # 1. Registrar clientes de cable
                for c in cable_clients:
                    known_macs.add(c['mac'].upper())
                    known_ips.add(c['ip'])
                # Prevenir duplicar el repetidor ASUS por su interfaz Wi-Fi secundaria
                known_macs.add("C8:7F:54:B1:9E:C0")
                known_ips.add("192.168.50.40")

                # 2. Clientes inalámbricos de wl0/wl1 del ASUS
                dedup_wifi = []
                for c in wifi_clients:
                    mac = c['mac'].upper()
                    if mac not in known_macs:
                        info = arp_map.get(mac, {})
                        c_ip = info.get('ip', 'Desconocida')
                        if c_ip in known_ips:
                            continue
                        known_macs.add(mac)
                        if c_ip != 'Desconocida':
                            known_ips.add(c_ip)
                        c['ip'] = c_ip
                        c['name'] = DEVICE_FRIENDLY_NAMES.get(mac) or info.get('name', mac)
                        c_meta = classify_device(c['name'], mac)
                        c['dev_type'] = c_meta['type']
                        c['dev_icon'] = c_meta['icon']
                        c['brand'] = c_meta.get('brand', 'generic')
                        c['brand_name'] = c_meta.get('brand_name', 'Dispositivo')
                        c['status'] = 'online'
                        
                        if c['band'] == '2.4 GHz':
                            c_24 += 1
                        else:
                            c_5 += 1
                        wifi_tx += c['tx_bytes']
                        wifi_rx += c['rx_bytes']
                        dedup_wifi.append(c)
                wifi_clients = dedup_wifi

                # Sondeo activo ultra-rápido de dispositivos conocidos para mantener el caché ARP caliente
                try:
                    probe_ips = [info['ip'] for info in arp_map.values() if info.get('ip') and info['ip'].startswith('192.168.50.')]
                    if probe_ips:
                        subprocess.run(['fping', '-a', '-r', '1', '-t', '100'] + probe_ips, capture_output=True, timeout=2)
                except Exception:
                    pass

                # 3. Agregar TODOS los demás dispositivos activos en la red (ej. Nintendo 3DS, Switch, etc.)
                try:
                    p_neigh = subprocess.run(['ip', 'neigh'], capture_output=True, text=True, timeout=2)
                    for nline in p_neigh.stdout.splitlines():
                        m_n = re.search(r'^(192\.168\.50\.\d+)\s+.*lladdr\s+([0-9a-fA-F:]{17})\s+(\w+)', nline)
                        if m_n:
                            n_ip, n_mac, n_state = m_n.group(1), m_n.group(2).upper(), m_n.group(3)
                            if n_state in ('REACHABLE', 'STALE', 'DELAY') and n_mac not in known_macs and n_ip not in known_ips:
                                known_macs.add(n_mac)
                                known_ips.add(n_ip)
                                info = arp_map.get(n_mac, {})
                                d_name = DEVICE_FRIENDLY_NAMES.get(n_mac) or info.get('name') or n_ip
                                c_meta = classify_device(d_name, n_mac)
                                is_24 = any(k in d_name.lower() for k in ["3ds", "esp", "tapo", "enchufe", "bombilla", "switch"])
                                if is_24: c_24 += 1
                                else: c_5 += 1
                                is_active = (n_state in ('REACHABLE', 'DELAY'))
                                wifi_clients.append({
                                    "conn_type": "wifi",
                                    "band": "2.4 GHz" if is_24 else "5 GHz",
                                    "iface": "wlan",
                                    "mac": n_mac,
                                    "ip": n_ip,
                                    "name": d_name,
                                    "tx_bytes": 0,
                                    "rx_bytes": 0,
                                    "rssi": -62 if is_active else -75,
                                    "in_network": int(time.time() - BOOT_TIME),
                                    "dev_type": c_meta['type'],
                                    "dev_icon": c_meta['icon'],
                                    "brand": c_meta.get('brand', 'generic'),
                                    "brand_name": c_meta.get('brand_name', 'Dispositivo'),
                                    "status": "online" if is_active else "idle"
                                })
                except Exception:
                    pass

                # 4. Asegurar que consolas registradas en reposo aparezcan (sin duplicar ninguna IP ni MAC)
                for r_mac, d_name in DEVICE_FRIENDLY_NAMES.items():
                    r_mac = r_mac.upper()
                    if r_mac not in known_macs:
                        info = arp_map.get(r_mac, {})
                        r_ip = info.get('ip')
                        if r_ip and r_ip.startswith('192.168.50.') and r_ip not in known_ips:
                            if any(k in d_name.lower() for k in ["switch", "xbox", "3ds", "playstation"]):
                                known_macs.add(r_mac)
                                known_ips.add(r_ip)
                                c_meta = classify_device(d_name, r_mac)
                                is_24 = any(k in d_name.lower() for k in ["3ds", "esp", "tapo", "enchufe", "bombilla", "switch"])
                                wifi_clients.append({
                                    "conn_type": "wifi",
                                    "band": "2.4 GHz" if is_24 else "5 GHz",
                                    "iface": "wlan",
                                    "mac": r_mac,
                                    "ip": r_ip,
                                    "name": d_name,
                                    "tx_bytes": 0,
                                    "rx_bytes": 0,
                                    "rssi": -85,
                                    "in_network": 0,
                                    "dev_type": c_meta['type'],
                                    "dev_icon": c_meta['icon'],
                                    "brand": c_meta.get('brand', 'generic'),
                                    "brand_name": c_meta.get('brand_name', 'Dispositivo'),
                                    "status": "idle"
                                })

                # Enlazar estadísticas de Flow Cache L2 a todos los clientes (Wi-Fi, 3DS, Switch, etc.)
                for c in cable_clients + wifi_clients:
                    mac = c.get('mac', '').upper()
                    if mac in fcache_stats:
                        fc = fcache_stats[mac]
                        c['tx_bytes'] = max(c.get('tx_bytes', 0), fc['tx_bytes'])
                        c['rx_bytes'] = max(c.get('rx_bytes', 0), fc['rx_bytes'])
                        c['speed_down'] = fc.get('speed_down', 0)
                        c['speed_up'] = fc.get('speed_up', 0)
                        if c['speed_down'] > 30000 or c['speed_up'] > 20000:
                            c['status'] = 'online'

                wifi_tx = sum(c.get('tx_bytes', 0) for c in wifi_clients)
                wifi_rx = sum(c.get('rx_bytes', 0) for c in wifi_clients)

                # Tráfico acumulado de cable (todos los puertos físicos)
                cable_tx = asus_eth4_tx + asus_eth0_tx + asus_eth3_tx + local_server_tx
                cable_rx = asus_eth4_rx + asus_eth0_rx + asus_eth3_rx + local_server_rx

                all_clients = cable_clients + wifi_clients
                all_clients.sort(key=lambda x: (x.get('speed_down', 0), x.get('tx_bytes', 0), x.get('ip', '')), reverse=True)

                summary = {
                    "total_clients": len(all_clients),
                    "clients_cable": len(cable_clients),
                    "clients_24g": c_24,
                    "clients_5g": c_5,
                    "total_tx_bytes": cable_tx + wifi_tx,
                    "total_rx_bytes": cable_rx + wifi_rx,
                    "cable_tx_bytes": cable_tx,
                    "cable_rx_bytes": cable_rx,
                    "wifi_tx_bytes": wifi_tx,
                    "wifi_rx_bytes": wifi_rx,
                    "last_update": datetime.now().strftime("%H:%M:%S")
                }

                with WIFI_LOCK:
                    WIFI_CACHE = {
                        "clients": all_clients,
                        "summary": summary
                    }
        except Exception:
            pass
        time.sleep(12)

# ==============================================================================
# Security Worker: Pi-hole DNS Shield & Fail2ban Intrusion Defense
# ==============================================================================
def fetch_security_worker():
    global SECURITY_CACHE
    cached_gravity = 0
    last_gravity_check = 0

    while True:
        try:
            now = time.time()
            # 1. Pi-hole Metrics (lectura nativa directa sin subprocesos ni bloqueos)
            pihole_data = {"available": False, "status": "offline"}
            try:
                if now - last_gravity_check > 300 or cached_gravity == 0:
                    conn_g = sqlite3.connect("file:/etc/pihole/gravity.db?mode=ro", uri=True, timeout=2.0)
                    row_g = conn_g.execute("SELECT count(*) FROM gravity;").fetchone()
                    conn_g.close()
                    if row_g and row_g[0]:
                        cached_gravity = int(row_g[0])
                        last_gravity_check = now

                conn_f = sqlite3.connect("file:/etc/pihole/pihole-FTL.db?mode=ro", uri=True, timeout=2.0)
                cur_f = conn_f.cursor()
                sql_today = "SELECT count(*), sum(CASE WHEN status IN (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16) THEN 1 ELSE 0 END) FROM query_storage WHERE timestamp >= strftime('%s', 'now', 'start of day');"
                row_t = cur_f.execute(sql_today).fetchone()
                total_q = int(row_t[0] or 0) if row_t else 0
                blocked_q = int(row_t[1] or 0) if row_t else 0

                sql_top = "SELECT domain, count(*) as c FROM queries WHERE status IN (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16) AND timestamp >= strftime('%s', 'now', 'start of day') GROUP BY domain ORDER BY c DESC LIMIT 5;"
                top_blocked = [{"domain": r[0], "count": int(r[1])} for r in cur_f.execute(sql_top).fetchall() if r[0]]
                conn_f.close()

                pct = round((blocked_q / total_q * 100), 1) if total_q > 0 else 0.0
                pihole_data = {
                    "available": True,
                    "domains_being_blocked": cached_gravity,
                    "dns_queries_today": total_q,
                    "ads_blocked_today": blocked_q,
                    "ads_percentage_today": pct,
                    "top_blocked": top_blocked,
                    "status": "online"
                }
            except Exception as pe:
                pihole_data["error"] = str(pe)

            # 2. Fail2ban Metrics & All-Time History
            f2b_data = {
                "available": False, 
                "jails": {}, 
                "total_banned": 0, 
                "currently_banned": 0, 
                "banned_ips": [], 
                "banned_details": [], 
                "all_time_banned": [],
                "total_all_time_count": 0,
                "status": "offline"
            }
            try:
                p_f2b = subprocess.run(["fail2ban-client", "status"], capture_output=True, text=True, timeout=2)
                if p_f2b.returncode == 0:
                    f2b_data["available"] = True
                    f2b_data["status"] = "online"
                    m = re.search(r"Jail list:\s+(.*)", p_f2b.stdout)
                    if m:
                        jails = [j.strip() for j in m.group(1).split(",") if j.strip()]
                        for j in jails:
                            pj = subprocess.run(["fail2ban-client", "status", j], capture_output=True, text=True, timeout=2)
                            if pj.returncode == 0:
                                cur_banned, tot_banned, cur_failed = 0, 0, 0
                                b_ips = []
                                for line in pj.stdout.splitlines():
                                    if "Currently banned:" in line:
                                        cur_banned = int(line.split(":")[-1].strip())
                                    elif "Total banned:" in line:
                                        tot_banned = int(line.split(":")[-1].strip())
                                    elif "Currently failed:" in line:
                                        cur_failed = int(line.split(":")[-1].strip())
                                    elif "Banned IP list:" in line:
                                        b_ips = [ip.strip() for ip in line.split(":")[-1].split() if ip.strip()]
                                f2b_data["jails"][j] = {
                                    "currently_banned": cur_banned,
                                    "total_banned": tot_banned,
                                    "currently_failed": cur_failed,
                                    "banned_ips": b_ips
                                }
                                f2b_data["currently_banned"] += cur_banned
                                f2b_data["total_banned"] += tot_banned
                                for ip in b_ips:
                                    if ip not in f2b_data["banned_ips"]:
                                        f2b_data["banned_ips"].append(ip)
                                    f2b_data["banned_details"].append({"ip": ip, "jail": j})

                # Extraer historial completo (All-Time) desde fail2ban.sqlite3
                all_time_list = []
                known_ips = set()
                currently_banned_set = set(f2b_data["banned_ips"])
                db_path = "/var/lib/fail2ban/fail2ban.sqlite3"
                if os.path.exists(db_path):
                    try:
                        conn = sqlite3.connect(db_path, timeout=1.5)
                        cur = conn.cursor()
                        cur.execute("""
                            SELECT ip, jail, timeofban, bantime, bancount
                            FROM bips
                            ORDER BY timeofban DESC
                        """)
                        for r in cur.fetchall():
                            ip_val, jail_val, tob_val, bt_val, bc_val = r
                            ban_dt = datetime.fromtimestamp(tob_val).strftime("%Y-%m-%d %H:%M:%S")
                            all_time_list.append({
                                "ip": ip_val,
                                "jail": jail_val,
                                "date": ban_dt,
                                "timestamp": tob_val,
                                "bantime": bt_val,
                                "bancount": bc_val,
                                "is_active": (ip_val in currently_banned_set)
                            })
                            known_ips.add(ip_val)
                        conn.close()
                    except Exception:
                        pass

                # Incorporar IPs registradas en el log vivo si no estaban en bips
                log_path = "/var/log/fail2ban.log"
                if os.path.exists(log_path):
                    try:
                        with open(log_path, "r", errors="ignore") as lf:
                            for line in lf:
                                m = re.search(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*?\[([^\]]+)\]\s+Ban\s+(\S+)", line)
                                if m:
                                    dt_str, j_val, ip_val = m.group(1), m.group(2).strip(), m.group(3).strip()
                                    if ip_val not in known_ips:
                                        known_ips.add(ip_val)
                                        try:
                                            ts = int(datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").timestamp())
                                        except Exception:
                                            ts = 0
                                        all_time_list.append({
                                            "ip": ip_val,
                                            "jail": j_val,
                                            "date": dt_str,
                                            "timestamp": ts,
                                            "bantime": 0,
                                            "bancount": 1,
                                            "is_active": (ip_val in currently_banned_set)
                                        })
                    except Exception:
                        pass

                all_time_list.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
                f2b_data["all_time_banned"] = all_time_list
                f2b_data["total_all_time_count"] = len(all_time_list)

            except Exception as fe:
                f2b_data["error"] = str(fe)

            with SECURITY_LOCK:
                SECURITY_CACHE = {
                    "available": True,
                    "pihole": pihole_data,
                    "fail2ban": f2b_data,
                    "last_update": datetime.now().strftime("%H:%M:%S")
                }
        except Exception:
            pass
        time.sleep(6)

# ==============================================================================
# Processes & Background Master Collector
# ==============================================================================
def get_system_processes(gpu_map=None):
    try:
        gpu_map = gpu_map or {}
        procs = []
        vm_total = psutil.virtual_memory().total or 1
        
        for p in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_info', 'status', 'nice']):
            try:
                info = p.info
                pid = info['pid']
                cpu = info.get('cpu_percent') or 0.0
                mem_bytes = info['memory_info'].rss if info.get('memory_info') else 0
                mem_mb = round(mem_bytes / (1024 * 1024), 1)
                
                priv_mb = mem_mb
                shared_mb = 0.0
                
                if mem_mb > 20.0:
                    try:
                        with open(f"/proc/{pid}/statm", "r") as sf:
                            parts = sf.read().split()
                            rss_pages = int(parts[1])
                            shared_pages = int(parts[2])
                            shared_mb = round(shared_pages * 4096 / (1024 * 1024), 1)
                            priv_mb = round(max(0, rss_pages - shared_pages) * 4096 / (1024 * 1024), 1)
                    except Exception:
                        pass
                
                mem_pct = round((priv_mb * 1024 * 1024) / vm_total * 100, 1)
                gpu_data = gpu_map.get(pid, {})
                vram_mb = round(gpu_data.get('vram_mb', 0.0), 1)
                gpu_type = gpu_data.get('type', '')
                nice_val = info.get('nice') if info.get('nice') is not None else 0
                
                procs.append({
                    "pid": pid,
                    "name": info['name'] or "unknown",
                    "user": info['username'] or "system",
                    "cpu_percent": round(cpu, 1),
                    "mem_mb": mem_mb,
                    "priv_mb": priv_mb,
                    "shared_mb": shared_mb,
                    "mem_percent": mem_pct,
                    "vram_mb": vram_mb,
                    "gpu_type": gpu_type,
                    "nice": nice_val,
                    "status": info.get('status', 'running')
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
                
        filtered = [pr for pr in procs if pr['cpu_percent'] > 0.0 or pr['priv_mb'] > 5.0 or pr['mem_mb'] > 15.0 or pr['vram_mb'] > 0.0]
        top_procs = sorted(filtered, key=lambda x: (x['vram_mb'], x['cpu_percent'], x['priv_mb']), reverse=True)[:100]
        return top_procs
    except Exception:
        return []

def get_system_info():
    try:
        uptime_seconds = int(time.time() - BOOT_TIME)
        hours, remainder = divmod(uptime_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        days, hours = divmod(hours, 24)
        uptime_str = f"{days}d {hours}h {minutes}m" if days > 0 else f"{hours}h {minutes}m {seconds}s"
        
        os_name = "Linux"
        try:
            with open("/etc/os-release", "r") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        os_name = line.split("=", 1)[1].strip().strip('"')
                        break
        except Exception:
            pass

        return {
            "hostname": HOSTNAME,
            "os": os_name,
            "kernel": KERNEL,
            "uptime_seconds": uptime_seconds,
            "uptime_str": uptime_str,
            "timestamp": time.time(),
            "time_str": time.strftime("%H:%M:%S")
        }
    except Exception:
        return {"uptime_str": "Unknown", "hostname": HOSTNAME, "kernel": KERNEL}

def background_collector():
    global METRICS_CACHE, METRICS_CACHE_BYTES, HISTORY
    last_time = time.time()
    psutil.cpu_percent(interval=None, percpu=True)
    
    def get_real_net():
        per_nic = psutil.net_io_counters(pernic=True)
        rx, tx = 0, 0
        interfaces = {}
        for nic_name, stats in per_nic.items():
            if nic_name == "lo" or nic_name.startswith(("veth", "docker", "br-")):
                continue
            rx += stats.bytes_recv
            tx += stats.bytes_sent
            interfaces[nic_name] = {
                "bytes_sent": stats.bytes_sent,
                "bytes_recv": stats.bytes_recv,
                "packets_sent": stats.packets_sent,
                "packets_recv": stats.packets_recv
            }
        return rx, tx, interfaces

    def get_real_disk():
        per_disk = psutil.disk_io_counters(perdisk=True) or {}
        r_bytes, w_bytes = 0, 0
        for d_name, d_st in per_disk.items():
            if d_name.startswith(("loop", "ram", "dm-")) or (d_name.startswith("sd") and len(d_name) > 3) or ("nvme" in d_name and "p" in d_name):
                continue
            r_bytes += d_st.read_bytes
            w_bytes += d_st.write_bytes
        return r_bytes, w_bytes

    last_rx, last_tx, _ = get_real_net()
    last_r, last_w = get_real_disk()
    cycle_counter = 0
    cached_procs = []
    
    while True:
        try:
            now = time.time()
            dt = max(now - last_time, 0.001)
            last_time = now
            cycle_counter += 1
            
            curr_rx, curr_tx, interfaces = get_real_net()
            rx_bytes_sec = max(0, (curr_rx - last_rx) / dt)
            tx_bytes_sec = max(0, (curr_tx - last_tx) / dt)
            last_rx, last_tx = curr_rx, curr_tx
            
            curr_r, curr_w = get_real_disk()
            read_bytes_sec = max(0, (curr_r - last_r) / dt)
            write_bytes_sec = max(0, (curr_w - last_w) / dt)
            last_r, last_w = curr_r, curr_w
            
            sys_info = get_system_info()
            cpu_info = get_cpu_info()
            ram_info = get_ram_info()
            
            with GPU_LOCK:
                gpu_info = dict(GPU_CACHE)
            
            if cycle_counter % 2 == 1 or not cached_procs:
                cached_procs = get_system_processes(gpu_info.get("gpu_procs_map", {}))
            
            with DOCKER_LOCK:
                docker_acts = [dict(c) for c in DOCKER_CACHE]
            
            container_vram = {}
            for g_pid, g_info in gpu_info.get("gpu_procs_map", {}).items():
                try:
                    with open(f"/proc/{g_pid}/cgroup", "r") as f:
                        cg = f.read()
                        for line in cg.splitlines():
                            if "docker-" in line:
                                c_id = line.split("docker-")[1].split(".scope")[0][:12]
                                container_vram[c_id] = container_vram.get(c_id, 0.0) + g_info.get("vram_mb", 0.0)
                                break
                            elif "docker/" in line:
                                c_id = line.split("docker/")[1].split("/")[0][:12]
                                container_vram[c_id] = container_vram.get(c_id, 0.0) + g_info.get("vram_mb", 0.0)
                                break
                except Exception:
                    pass

            for c in docker_acts:
                cid_short = c.get("id", "")[:12]
                c["vram_mb"] = round(container_vram.get(cid_short, 0.0), 1)
                
            with DISKS_LOCK:
                disks_info = list(DISKS_CACHE)
            
            with WIFI_LOCK:
                wifi_data = dict(WIFI_CACHE)
            
            with SECURITY_LOCK:
                security_data = dict(SECURITY_CACHE)
            
            net_info = {
                "rx_bytes_sec": rx_bytes_sec,
                "tx_bytes_sec": tx_bytes_sec,
                "rx_total_bytes": curr_rx,
                "tx_total_bytes": curr_tx,
                "interfaces": interfaces
            }
            
            disk_io_info = {
                "read_bytes_sec": read_bytes_sec,
                "write_bytes_sec": write_bytes_sec,
                "read_total_bytes": curr_r,
                "write_total_bytes": curr_w
            }
            
            HISTORY["timestamps"].append(sys_info.get("time_str", ""))
            HISTORY["cpu"].append(cpu_info.get("usage_percent", 0))
            HISTORY["gpu"].append(gpu_info.get("gpu_util_percent", 0) if gpu_info.get("available") else 0)
            HISTORY["ram"].append(ram_info.get("percent", 0))
            HISTORY["ram_total"].append(ram_info.get("total_used_percent", 0))
            HISTORY["net_rx"].append(round(rx_bytes_sec / (1024 * 1024), 2))
            HISTORY["net_tx"].append(round(tx_bytes_sec / (1024 * 1024), 2))
            HISTORY["disk_r"].append(round(read_bytes_sec / (1024 * 1024), 2))
            HISTORY["disk_w"].append(round(write_bytes_sec / (1024 * 1024), 2))
            
            for k in HISTORY:
                if len(HISTORY[k]) > MAX_HISTORY:
                    HISTORY[k] = HISTORY[k][-MAX_HISTORY:]
            
            with DOCKER_LOCK:
                systemd_acts = list(SYSTEMD_CACHE)
                torrents_acts = list(EXTRAS_CACHE.get("torrents", []))
                torrent_stats_act = dict(EXTRAS_CACHE.get("torrent_stats", {}))
                emby_act = dict(EXTRAS_CACHE.get("emby", {}))
                parental_acts = dict(EXTRAS_CACHE.get("parental", {}))

            payload = {
                "system": sys_info,
                "cpu": cpu_info,
                "gpu": gpu_info,
                "ram": ram_info,
                "disks": disks_info,
                "disk_io": disk_io_info,
                "net": net_info,
                "docker_activities": docker_acts,
                "systemd_services": systemd_acts,
                "torrents": torrents_acts,
                "torrent_stats": torrent_stats_act,
                "emby": emby_act,
                "parental_control": parental_acts,
                "system_processes": cached_procs,
                "wifi_clients": wifi_data.get("clients", []),
                "wifi_summary": wifi_data.get("summary", {}),
                "security": security_data,
                "history": HISTORY
            }
            
            serialized = json.dumps(payload).encode('utf-8')
            with METRICS_LOCK:
                METRICS_CACHE = payload
                METRICS_CACHE_BYTES = serialized
                
        except Exception:
            pass
        time.sleep(1.5)


# ==============================================================================
# HTTP Request Handler & Zero-Trust Enforcement
# ==============================================================================
class DashboardHTTPHandler(BaseHTTPRequestHandler):
    def send_security_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy', "default-src 'self' 'unsafe-inline' data:; connect-src 'self' ws: wss:; frame-src 'self' https://*.cminewar.duckdns.org; frame-ancestors 'self' https://cminewar.duckdns.org https://nextcloud.cminewar.duckdns.org;")

    def do_HEAD(self):
        self.do_GET()

    def do_PUT(self):
        self.send_response(405)
        self.send_security_headers()
        self.end_headers()

    def do_DELETE(self):
        self.send_response(405)
        self.send_security_headers()
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Allow', 'GET, POST, HEAD')
        self.send_security_headers()
        self.end_headers()

    def do_GET(self):
        auth = check_trust_status(self)

        # 1. API METRICS (Bloqueo 403 total si es externo no emparejado)
        if self.path == "/api/metrics":
            if not auth["is_trusted"]:
                err_resp = json.dumps({
                    "error": "Acceso externo denegado. Este dispositivo no está emparejado en la red local Wi-Fi.",
                    "status": "locked",
                    "client_ip": auth["client_ip"]
                }).encode('utf-8')
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

            with METRICS_LOCK:
                base_payload = dict(METRICS_CACHE)

            # Inyectar estado de seguridad contextual para la UI
            base_payload["auth_status"] = {
                "is_local": auth["is_local"],
                "is_trusted": auth["is_trusted"],
                "client_ip": auth["client_ip"],
                "device_name": auth["device_info"]["name"] if auth.get("device_info") else "Dispositivo Local"
            }
            data = json.dumps(base_payload).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', f'_sysmon_trust={auth["new_token"]}; Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # 2. LISTADO DE DISPOSITIVOS EMPAREJADOS
        elif self.path == "/api/auth/devices":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with TRUST_LOCK:
                devices = load_trusted_devices()
                dev_list = []
                for k, v in devices.items():
                    dev_list.append({
                        "id": v.get("id"),
                        "name": v.get("name"),
                        "first_seen": v.get("first_seen"),
                        "last_seen": v.get("last_seen"),
                        "local_ip": v.get("local_ip", ""),
                        "trusted": v.get("trusted", True)
                    })
            resp = json.dumps(dev_list).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2b. HISTORIAL COMPLETO ALL-TIME DE FAIL2BAN
        elif self.path == "/api/fail2ban/history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with SECURITY_LOCK:
                history_data = SECURITY_CACHE.get("fail2ban", {}).get("all_time_banned", [])
            resp = json.dumps({"status": "ok", "total": len(history_data), "history": history_data}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 3. INTERFAZ HTML PRINCIPAL (O Pantalla de Autorización si es externo no autorizado)
        elif self.path == "/" or self.path == "/index.html":
            if not auth["is_trusted"]:
                locked_page = get_locked_page_html(auth["client_ip"]).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(locked_page)))
                self.end_headers()
                self.wfile.write(locked_page)
                return

            index_path = os.path.join(STATIC_DIR, "index.html")
            try:
                with open(index_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.send_security_headers()
                if auth.get("new_token"):
                    self.send_header('Set-Cookie', f'_sysmon_trust={auth["new_token"]}; Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.send_security_headers()
                self.end_headers()
                self.wfile.write(f"Error loading dashboard: {e}".encode('utf-8'))
            return

        # 4. ARCHIVOS ESTÁTICOS / DESCARGAS
        elif self.path in ["/visipics.rdp", "/visipics_externo.rdp", "/Asus_Router_CA.crt"]:
            filename = self.path.lstrip("/")
            file_path = os.path.join(STATIC_DIR, filename)
            try:
                with open(file_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                if filename.endswith(".crt"):
                    self.send_header('Content-Type', 'application/x-x509-ca-cert')
                else:
                    self.send_header('Content-Type', 'application/x-rdp')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except Exception:
                self.send_response(404)
                self.send_security_headers()
                self.end_headers()
                self.wfile.write(b"Not Found")
            return
        else:
            self.send_response(404)
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")

    def do_POST(self):
        client_ip = get_client_ip(self)

        # 1. Desbloqueo remoto con clave maestra (Blindado contra fuerza bruta)
        if self.path == "/api/auth/unlock":
            locked, rem_time = is_ip_locked_out(client_ip)
            if locked:
                resp = json.dumps({
                    "success": False,
                    "error": f"Demasiados intentos fallidos. IP temporalmente bloqueada durante {rem_time} segundos."
                }).encode('utf-8')
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Retry-After', str(rem_time))
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 2048:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data)
            except Exception:
                body = {}
            
            entered_key = body.get('key', '').strip()
            ua = self.headers.get('User-Agent', '')
            
            if hmac.compare_digest(entered_key, ADMIN_MASTER_KEY):
                record_auth_success(client_ip)
                new_token = secrets.token_urlsafe(32)
                t_hash = hash_token(new_token)
                now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                device_name = parse_user_agent(ua) + " (Desbloqueo Remoto)"
                
                with TRUST_LOCK:
                    devices = load_trusted_devices()
                    devices[t_hash] = {
                        "id": f"dev_{secrets.token_hex(4)}",
                        "name": device_name,
                        "first_seen": now_iso,
                        "last_seen": now_iso,
                        "local_ip": f"Externo ({client_ip})",
                        "user_agent": ua[:150],
                        "trusted": True
                    }
                    save_trusted_devices(devices)
                    
                resp = json.dumps({"success": True, "message": "Dispositivo emparejado con éxito"}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Set-Cookie', f'_sysmon_trust={new_token}; Path=/; Max-Age=31536000; SameSite=None; Secure; Partitioned')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            else:
                time.sleep(1)  # Mitigación activa contra fuerza bruta
                is_locked, remaining = record_auth_failure(client_ip)
                if is_locked:
                    err_msg = f"Demasiados intentos fallidos. IP bloqueada durante {LOCKOUT_DURATION//60} minutos."
                else:
                    err_msg = f"Clave maestra incorrecta. Quedan {remaining} intentos antes del bloqueo temporal."
                resp = json.dumps({"success": False, "error": err_msg}).encode('utf-8')
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            return

        # 2. Revocación de dispositivo
        elif self.path == "/api/auth/revoke":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 2048:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data)
                dev_id = body.get('id', '')
            except Exception:
                dev_id = ''
                
            with TRUST_LOCK:
                devices = load_trusted_devices()
                target_key = None
                for k, v in devices.items():
                    if v.get('id') == dev_id:
                        target_key = k
                        break
                if target_key:
                    del devices[target_key]
                    save_trusted_devices(devices)
                    resp = json.dumps({"success": True}).encode('utf-8')
                else:
                    resp = json.dumps({"success": False, "error": "Dispositivo no encontrado"}).encode('utf-8')
                    
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 3. Fail2ban: Desbloqueo de IP
        elif self.path == "/api/fail2ban/unban":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 2048:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data)
                target_ip = body.get('ip', '').strip()
                jail = body.get('jail', '').strip()
            except Exception:
                target_ip = ''
                jail = ''

            try:
                ipaddress.ip_address(target_ip)
            except ValueError:
                resp = json.dumps({"success": False, "error": "Dirección IP no válida"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            if jail:
                cmd = ["sudo", "fail2ban-client", "set", jail, "unbanip", target_ip]
            else:
                cmd = ["sudo", "fail2ban-client", "unban", target_ip]

            p = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if p.returncode == 0:
                resp = json.dumps({"success": True, "message": f"IP {target_ip} desbloqueada exitosamente", "output": p.stdout.strip()}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": p.stderr.strip() or p.stdout.strip() or "Error al desbloquear IP"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 4. Fail2ban: Baneo manual de IP
        elif self.path == "/api/fail2ban/ban":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 2048:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data)
                target_ip = body.get('ip', '').strip()
                jail = body.get('jail', 'nextcloud').strip()
            except Exception:
                target_ip = ''
                jail = 'nextcloud'

            try:
                ipaddress.ip_address(target_ip)
            except ValueError:
                resp = json.dumps({"success": False, "error": "Dirección IP no válida"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            if target_ip in ["127.0.0.1", "::1", "192.168.50.2"]:
                resp = json.dumps({"success": False, "error": "No se puede bloquear la IP local o del servidor"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            cmd = ["sudo", "fail2ban-client", "set", jail, "banip", target_ip]
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if p.returncode == 0:
                resp = json.dumps({"success": True, "message": f"IP {target_ip} bloqueada en {jail}", "output": p.stdout.strip()}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": p.stderr.strip() or p.stdout.strip() or "Error al bloquear IP"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 5. Fail2ban: Importación masiva de IPs (Synology Blocklist / Archivo TXT o CSV)
        elif self.path == "/api/fail2ban/import":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 5 * 1024 * 1024:  # Hasta 5 MB
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8', errors='ignore')
            try:
                body = json.loads(post_data)
                raw_text = body.get('text', '')
                jail = body.get('jail', 'sshd').strip() or 'sshd'
                ips_list = body.get('ips', [])
            except Exception:
                raw_text = post_data
                jail = 'sshd'
                ips_list = []

            # Extraer todas las IPs candidatas del texto o lista
            candidate_ips = set(ips_list)
            if raw_text:
                found_ips = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', raw_text)
                for ip in found_ips:
                    candidate_ips.add(ip)

            valid_ips = []
            private_networks = [
                ipaddress.ip_network("127.0.0.0/8"),
                ipaddress.ip_network("10.0.0.0/8"),
                ipaddress.ip_network("172.16.0.0/12"),
                ipaddress.ip_network("192.168.0.0/16")
            ]

            for ip_str in candidate_ips:
                try:
                    ip_obj = ipaddress.ip_address(ip_str)
                    if any(ip_obj in net for net in private_networks):
                        continue  # Omitir IPs locales protegidas
                    valid_ips.append(str(ip_obj))
                except ValueError:
                    continue

            if not valid_ips:
                resp = json.dumps({"success": False, "error": "No se encontraron direcciones IP públicas válidas en los datos proporcionados"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            # Aplicar baneo masivo en Fail2ban
            banned_success = 0
            # Para no sobrecargar con cientos de subprocesos lentos, ejecutamos un comando agrupado
            # e insertamos en lote en la base de datos sqlite de fail2ban
            now_ts = int(time.time())
            db_path = "/var/lib/fail2ban/fail2ban.sqlite3"
            if os.path.exists(db_path):
                try:
                    conn = sqlite3.connect(db_path, timeout=5.0)
                    cur = conn.cursor()
                    for vip in valid_ips:
                        cur.execute("""
                            INSERT OR REPLACE INTO bips(ip, jail, timeofban, bantime, bancount, data)
                            VALUES (?, ?, ?, 172800, 1, '{"source": "synology_import"}')
                        """, (vip, jail, now_ts))
                    conn.commit()
                    conn.close()
                except Exception:
                    pass

            # Aplicar en fail2ban-client por lotes o llamadas
            for vip in valid_ips:
                cmd = ["sudo", "fail2ban-client", "set", jail, "banip", vip]
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
                if p.returncode == 0:
                    banned_success += 1

            resp = json.dumps({
                "success": True,
                "message": f"Se procesaron {len(valid_ips)} IPs del Synology: {banned_success} añadidas activamente al cortafuegos de Fail2ban ({jail}).",
                "total_imported": len(valid_ips),
                "active_banned": banned_success
            }).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Wake-on-LAN: Despertar Smart TV o equipo
        elif self.path == "/api/wol/wake":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data)
                mac = body.get('mac', '').strip()
            except Exception:
                mac = ''

            if re.match(r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$', mac):
                subprocess.run(["wakeonlan", mac], capture_output=True)
                resp = json.dumps({"success": True, "message": f"Paquete mágico Wake-on-LAN enviado a {mac}"}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": "Dirección MAC inválida"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Gestión de Contenedores Docker y Servicios Systemd (Iniciar / Reiniciar)
        elif self.path == "/api/service/action":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data)
                stype = body.get('type', '').strip()
                target = body.get('target', '').strip()
                action = body.get('action', 'restart').strip()
            except Exception:
                stype, target, action = '', '', ''

            if action not in ('start', 'restart', 'stop') or not re.match(r'^[a-zA-Z0-9_.-]+$', target):
                resp = json.dumps({"success": False, "error": "Parámetros inválidos"}).encode('utf-8')
            else:
                def run_svc_action():
                    try:
                        if stype == 'docker':
                            subprocess.run(["docker", action, target], capture_output=True, timeout=30)
                        elif stype == 'systemd':
                            allowed_units = {u[0] for u in SYSTEMD_MONITORED_UNITS}
                            if target in allowed_units:
                                subprocess.run(["sudo", "systemctl", action, target], capture_output=True, timeout=30)
                    except Exception:
                        pass

                threading.Thread(target=run_svc_action, daemon=True).start()
                verb = "Reiniciando" if action == "restart" else ("Iniciando" if action == "start" else "Deteniendo")
                resp = json.dumps({"success": True, "message": f"{verb} {target}..."}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        else:
            self.send_response(404)
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

    def log_message(self, format, *args):
        return

def run_server(port=8085):
    threading.Thread(target=fetch_gpu_worker, daemon=True).start()
    threading.Thread(target=fetch_disks_worker, daemon=True).start()
    threading.Thread(target=fetch_docker_worker, daemon=True).start()
    threading.Thread(target=fetch_wifi_worker, daemon=True).start()
    threading.Thread(target=fetch_security_worker, daemon=True).start()
    threading.Thread(target=background_collector, daemon=True).start()
    
    server_address = ('127.0.0.1', port)
    httpd = ThreadingHTTPServer(server_address, DashboardHTTPHandler)
    print(f"[+] Monitor de Sistema iniciado en http://127.0.0.1:{port} con Zero-Trust Pairing y Monitor Wi-Fi")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
