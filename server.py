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
import base64
import secrets
import hashlib
import hmac
import psutil
import sqlite3
import socket
import requests
import collections
import glob


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
CUSTOM_LOGOS_FILE = os.path.join(BASE_DIR, "custom_logos.json")
CUSTOM_LOGOS_LOCK = threading.Lock()
ADMIN_MASTER_KEY = os.environ.get("ADMIN_MASTER_KEY", "Cminewar2026!")  # Clave maestra de rescate / desbloqueo remoto

CUSTOM_LOGOS_CACHE = {"mtime": -1.0, "data": {}}

def load_custom_logos():
    if not os.path.isfile(CUSTOM_LOGOS_FILE):
        CUSTOM_LOGOS_CACHE["mtime"] = -1.0
        CUSTOM_LOGOS_CACHE["data"] = {}
        return {}
    try:
        mtime = os.path.getmtime(CUSTOM_LOGOS_FILE)
        if mtime == CUSTOM_LOGOS_CACHE["mtime"] and isinstance(CUSTOM_LOGOS_CACHE["data"], dict):
            return dict(CUSTOM_LOGOS_CACHE["data"])
        with open(CUSTOM_LOGOS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            clean = data if isinstance(data, dict) else {}
            CUSTOM_LOGOS_CACHE["mtime"] = mtime
            CUSTOM_LOGOS_CACHE["data"] = clean
            return dict(clean)
    except Exception:
        return dict(CUSTOM_LOGOS_CACHE.get("data") or {})

def save_custom_logos(logos_dict):
    try:
        clean = logos_dict if isinstance(logos_dict, dict) else {}
        with open(CUSTOM_LOGOS_FILE, "w", encoding="utf-8") as f:
            json.dump(clean, f, indent=2, ensure_ascii=False)
        try:
            CUSTOM_LOGOS_CACHE["mtime"] = os.path.getmtime(CUSTOM_LOGOS_FILE)
        except Exception:
            CUSTOM_LOGOS_CACHE["mtime"] = time.time()
        CUSTOM_LOGOS_CACHE["data"] = dict(clean)
        return True
    except Exception:
        return False

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
MAX_HISTORY = 60

# Rolling 2-Hour per-NIC Bandwidth History Buffer (100% OS-driven from /proc/net/dev)
NIC_BANDWIDTH_HISTORY_2H = {}  # { nic_name: [ {"t": ms_epoch, "rx": float_bytes_sec, "tx": float_bytes_sec}, ... ] }
NIC_BANDWIDTH_LOCK = threading.Lock()
MAX_NIC_HISTORY_SECONDS = 7200  # 2 hours (120 minutes)
NIC_BUCKET_INTERVAL_MS = 15000  # 15-second quantized buckets (480 buckets across 2 hours)
NIC_HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nic_history_2h.json")
_LAST_NIC_HISTORY_SAVE_TS = 0.0

def _load_nic_history_2h():
    if not os.path.exists(NIC_HISTORY_FILE):
        return
    try:
        with open(NIC_HISTORY_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - (MAX_NIC_HISTORY_SECONDS * 1000)
        with NIC_BANDWIDTH_LOCK:
            for nic_name, pts in raw.items():
                if not isinstance(pts, list):
                    continue
                bucket_map = {}
                for pt in pts:
                    if not isinstance(pt, dict):
                        continue
                    t_val = int(pt.get("t", 0))
                    if t_val < cutoff_ms:
                        continue
                    b_ts = (t_val // NIC_BUCKET_INTERVAL_MS) * NIC_BUCKET_INTERVAL_MS
                    rx_v = max(0.0, float(pt.get("rx", 0.0)))
                    tx_v = max(0.0, float(pt.get("tx", 0.0)))
                    if b_ts in bucket_map:
                        bucket_map[b_ts]["rx"] = max(bucket_map[b_ts]["rx"], rx_v)
                        bucket_map[b_ts]["tx"] = max(bucket_map[b_ts]["tx"], tx_v)
                    else:
                        bucket_map[b_ts] = {"t": b_ts, "rx": rx_v, "tx": tx_v}
                NIC_BANDWIDTH_HISTORY_2H[nic_name] = sorted(bucket_map.values(), key=lambda x: x["t"])
    except Exception:
        pass

def _save_nic_history_2h_if_needed(now_sec):
    global _LAST_NIC_HISTORY_SAVE_TS
    if now_sec - _LAST_NIC_HISTORY_SAVE_TS < 30.0:
        return
    _LAST_NIC_HISTORY_SAVE_TS = now_sec
    try:
        with NIC_BANDWIDTH_LOCK:
            snapshot = {k: list(v) for k, v in NIC_BANDWIDTH_HISTORY_2H.items()}
        tmp_path = NIC_HISTORY_FILE + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
        os.replace(tmp_path, NIC_HISTORY_FILE)
    except Exception:
        pass

_load_nic_history_2h()

# Load environment variables from .env if present (never hardcode keys)
def _load_dotenv_file():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    s = line.strip()
                    if not s or s.startswith("#") or "=" not in s:
                        continue
                    k, v = s.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass

_load_dotenv_file()

CONNECTIONS_MAP_CACHE = {
    "server_node": {},
    "summary": {"total": 0, "incoming": 0, "outgoing": 0, "blocked": 0},
    "connections": [],
    "geoip_worker": {
        "status": "initializing",
        "cached_ips": 0,
        "cache_hits": 0,
        "cache_misses": 0,
        "hit_rate_pct": 100.0,
        "api_batches_sent": 0,
        "pending_queue": 0,
        "rate_limit_remaining": 15,
        "last_sync": "--",
        "errors_count": 0,
        "error_history": []
    }
}
CONNECTIONS_MAP_LOCK = threading.Lock()
GEOIP_LOCK = threading.RLock()
GEOIP_CACHE_FILE = os.path.join(BASE_DIR, "geoip_cache.json")
GEOIP_TTL_SECONDS = 7 * 86400  # 7 days TTL for resolved GeoIP entries
GEOIP_NEG_TTL_SECONDS = 900    # 15 minutes cooldown for unresolvable/failed IPs
GEOIP_MAX_ENTRIES = 2000
GEOIP_MAX_CACHE_ENTRIES = GEOIP_MAX_ENTRIES
GEOIP_MAX_ERROR_HISTORY = 80

GEOIP_CACHE = {}           # { ip: { "lat", "lng", "city", "region", "country", "country_code", "isp", "asn", "ts" } }
GEOIP_NEGATIVE_CACHE = {}  # { ip: ts_failed }
GEOIP_PENDING_QUEUE = set()
GEOIP_ERROR_HISTORY = []   # [ { "id", "ts", "time_str", "source", "stage", "target", "code", "message" } ]
GEOIP_WAKE_EVENT = threading.Event()
SERVER_SELF_GEO = {}
RECENT_HTTP_CLIENTS = {}   # { ip: { "ip", "port", "ts", "service" } }

GEOIP_WORKER_STATS = {
    "status": "active",
    "cache_hits": 0,
    "cache_misses": 0,
    "api_batches_sent": 0,
    "api_ips_resolved": 0,
    "rate_limit_remaining": 15,
    "rate_limit_reset_ts": 0.0,
    "last_sync_ts": 0.0,
    "last_sync_str": "--",
    "dirty_disk": False,
    "last_disk_save_ts": 0.0,
    "errors_total": 0
}

def record_geoip_worker_error(source, stage, target, code, message):
    """Registra en tiempo real errores del Worker GeoIP y de peticiones de red asociadas."""
    now_ms = int(time.time() * 1000)
    time_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    entry = {
        "id": f"srv_err_{now_ms}_{len(GEOIP_ERROR_HISTORY)}",
        "ts": now_ms,
        "time_str": time_str,
        "source": str(source or "GEOIP_WORKER"),
        "stage": str(stage or "ip-api.com"),
        "target": str(target or "--"),
        "code": str(code or "ERROR"),
        "message": str(message or "Error de resolución")
    }
    with GEOIP_LOCK:
        GEOIP_WORKER_STATS["errors_total"] = GEOIP_WORKER_STATS.get("errors_total", 0) + 1
        # Evitar duplicar exactamente el mismo objetivo y código en una ventana de 5s
        if GEOIP_ERROR_HISTORY:
            last = GEOIP_ERROR_HISTORY[0]
            if last.get("target") == entry["target"] and last.get("code") == entry["code"] and (now_ms - last.get("ts", 0) < 5000):
                last["ts"] = now_ms
                last["time_str"] = time_str
                last["message"] = entry["message"]
                return
        GEOIP_ERROR_HISTORY.insert(0, entry)
        if len(GEOIP_ERROR_HISTORY) > GEOIP_MAX_ERROR_HISTORY:
            del GEOIP_ERROR_HISTORY[GEOIP_MAX_ERROR_HISTORY:]

def clear_geoip_worker_errors():
    """Limpia el historial de errores en tiempo real del Worker GeoIP en el servidor."""
    with GEOIP_LOCK:
        cleared = len(GEOIP_ERROR_HISTORY)
        GEOIP_ERROR_HISTORY.clear()
        GEOIP_WORKER_STATS["errors_total"] = 0
        return cleared

# ==============================================================================
# BOT DE TELEGRAM INTEGRADO: GESTOR DE TORRENTS Y VIGILANCIA LAN (100% NATIVO)
# ==============================================================================
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8813089508:AAF68Ti_JfZQqPVfAOqgk6mMoPtzL6arLzo")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"
TELEGRAM_FILE_URL = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}"

QBIT_API_URL = os.environ.get("QBIT_API_URL", "http://127.0.0.1:8082/api/v2")
QBIT_SAVE_PATH = os.environ.get("QBIT_SAVE_PATH", "/mnt/almacenamiento/descargas")

def _resolve_tg_data_file(filename, fallback_dir="/home/servidor/scripts"):
    """Resuelve rutas de persistencia buscando primero relativa al proyecto y luego en fallback."""
    rel_path = os.path.join(BASE_DIR, filename)
    if os.path.exists(rel_path):
        return rel_path
    abs_path = os.path.join(fallback_dir, filename)
    if os.path.exists(abs_path):
        return abs_path
    if os.path.isdir(fallback_dir):
        return abs_path
    return rel_path

TELEGRAM_WHITELIST_FILE = _resolve_tg_data_file("telegram_bot_allowed_users.json")
TELEGRAM_NOTIFIED_FILE = _resolve_tg_data_file("telegram_notified_torrents.json")
TELEGRAM_NET_MONITOR_FILE = _resolve_tg_data_file("network_monitor_devices.json")
TELEGRAM_FRIENDLY_NAMES_FILE = _resolve_tg_data_file("device_friendly_names.json")
TELEGRAM_SETTINGS_FILE = _resolve_tg_data_file("telegram_bot_settings.json")

TELEGRAM_ACTIVITY_LOG = collections.deque(maxlen=100)
TELEGRAM_ACTIVITY_LOCK = threading.Lock()

DEFAULT_TELEGRAM_CONFIG = {
    "notify_completed_torrents": True,
    "notify_network_changes": False
}

def load_tg_config():
    """Carga las preferencias y ajustes del bot de Telegram."""
    if os.path.exists(TELEGRAM_SETTINGS_FILE):
        try:
            with open(TELEGRAM_SETTINGS_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                res = dict(DEFAULT_TELEGRAM_CONFIG)
                res.update(cfg)
                return res
        except Exception as e:
            print(f"[TG CONFIG ERROR] Error leyendo {TELEGRAM_SETTINGS_FILE}: {e}")
    return dict(DEFAULT_TELEGRAM_CONFIG)

def save_tg_config(cfg_dict):
    """Guarda las preferencias del bot en su archivo JSON."""
    try:
        os.makedirs(os.path.dirname(TELEGRAM_SETTINGS_FILE), exist_ok=True)
        current = load_tg_config()
        current.update(cfg_dict)
        with open(TELEGRAM_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
        return True
    except Exception as e:
        print(f"[TG CONFIG SAVE ERROR] {e}")
        return False

def record_tg_activity(direction, msg_type, target, user_name, title, content, status="ok", details=None):
    """Registra un evento de mensaje entrante o saliente del bot de Telegram."""
    entry = {
        "id": f"tg-{int(time.time()*1000)}-{os.urandom(3).hex()}",
        "ts": time.time(),
        "time_str": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "direction": direction,  # "out" (lo que manda el bot) | "in" (lo que recibe de usuarios)
        "type": msg_type,        # "torrent_completed", "command_reply", "command_received", "magnet_received", "torrent_file_received", "custom_broadcast", "ping_test", "auth_denied"
        "target": str(target) if target else "Todos (Broadcast)",
        "user_name": str(user_name or "Usuario"),
        "title": str(title or ""),
        "content": str(content or ""),
        "status": status,        # "ok", "error", "sent", "received", "denied"
        "details": details or {}
    }
    with TELEGRAM_ACTIVITY_LOCK:
        TELEGRAM_ACTIVITY_LOG.appendleft(entry)

TELEGRAM_BOT_CACHE = {
    "enabled": True,
    "running": True,
    "polling_active": False,
    "allowed_users_count": 0,
    "allowed_users": [],
    "notified_torrents_count": 0,
    "last_poll_ts": 0,
    "last_poll_str": "--",
    "last_message_ts": 0,
    "last_message_str": "--",
    "messages_processed": 0,
    "last_action": "Inicializando módulo...",
    "qbit_connected": False
}
TELEGRAM_BOT_LOCK = threading.Lock()

def load_tg_whitelist():
    """Carga el conjunto de IDs de usuarios autorizados en Telegram."""
    if os.path.exists(TELEGRAM_WHITELIST_FILE):
        try:
            with open(TELEGRAM_WHITELIST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                users = set(data.get("allowed_users", []))
                with TELEGRAM_BOT_LOCK:
                    TELEGRAM_BOT_CACHE["allowed_users_count"] = len(users)
                    TELEGRAM_BOT_CACHE["allowed_users"] = list(users)
                return users
        except Exception as e:
            print(f"[TG AUTH ERROR] Error leyendo {TELEGRAM_WHITELIST_FILE}: {e}")
    return set()

def save_tg_whitelist(users_set):
    """Guarda el conjunto de usuarios autorizados en el archivo JSON."""
    try:
        os.makedirs(os.path.dirname(TELEGRAM_WHITELIST_FILE), exist_ok=True)
        with open(TELEGRAM_WHITELIST_FILE, "w", encoding="utf-8") as f:
            json.dump({"allowed_users": list(users_set)}, f, indent=2)
        with TELEGRAM_BOT_LOCK:
            TELEGRAM_BOT_CACHE["allowed_users_count"] = len(users_set)
            TELEGRAM_BOT_CACHE["allowed_users"] = list(users_set)
    except Exception as e:
        print(f"[TG AUTH SAVE ERROR] {e}")

def is_tg_user_allowed(user_id):
    """Verifica si un usuario de Telegram está autorizado. El primero se registra automáticamente como admin."""
    wl = load_tg_whitelist()
    if not wl:
        wl.add(user_id)
        save_tg_whitelist(wl)
        print(f"[TG AUTH] Primer usuario registrado automáticamente como admin: {user_id}")
        return True
    return user_id in wl

def tg_format_size(bytes_val):
    if not bytes_val:
        return "0 B"
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if bytes_val < 1024.0:
            return f"{bytes_val:.2f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.2f} PB"

def tg_format_eta(seconds):
    if seconds <= 0 or seconds >= 8640000:
        return "∞"
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    d, h = divmod(h, 24)
    if d > 0:
        return f"{d}d {h}h"
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m {s}s"

def tg_send_message(chat_id, text, reply_to_message_id=None, parse_mode="Markdown", log_activity=True, log_title=None, log_type="command_reply"):
    """Envía un mensaje mediante la API oficial de Telegram y registra la actividad saliente."""
    url = f"{TELEGRAM_API_URL}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode
    }
    if reply_to_message_id:
        payload["reply_to_message_id"] = reply_to_message_id
    success = False
    err_str = ""
    try:
        r = requests.post(url, json=payload, timeout=20)
        res = r.json()
        if not res.get("ok") and parse_mode:
            payload.pop("parse_mode", None)
            r2 = requests.post(url, json=payload, timeout=20)
            res = r2.json()
        if res.get("ok"):
            success = True
        else:
            err_str = str(res.get("description", "Error de Telegram"))
    except Exception as e:
        err_str = str(e)
        print(f"[TG ERROR] Error enviando mensaje a {chat_id}: {e}")

    if log_activity:
        record_tg_activity(
            direction="out",
            msg_type=log_type,
            target=str(chat_id),
            user_name=f"Chat {chat_id}",
            title=log_title or "Mensaje emitido por el Bot",
            content=text,
            status="ok" if success else "error",
            details={"error": err_str} if not success else {}
        )
    return success

def broadcast_to_tg_whitelist(text, parse_mode="Markdown", log_title=None, log_type="broadcast"):
    """Difunde un mensaje a todos los administradores en la lista blanca y audita el envío."""
    users = load_tg_whitelist()
    sent_any = False
    for uid in users:
        ok = tg_send_message(uid, text, parse_mode=parse_mode, log_activity=False)
        if ok:
            sent_any = True

    record_tg_activity(
        direction="out",
        msg_type=log_type,
        target=f"{len(users)} administradores",
        user_name="Administradores",
        title=log_title or "Difusión a lista blanca",
        content=text,
        status="ok" if sent_any else "error",
        details={"admin_count": len(users), "users": list(users)}
    )
    return sent_any


def qbit_add_torrent_file(filename, file_bytes):
    """Añade un archivo .torrent a qBittorrent."""
    try:
        files = {
            "torrents": (filename, file_bytes, "application/x-bittorrent")
        }
        data = {
            "savepath": QBIT_SAVE_PATH,
            "autoTMM": "false"
        }
        res = requests.post(f"{QBIT_API_URL}/torrents/add", files=files, data=data, timeout=15)
        if res.status_code == 200:
            return True, "Torrent añadido con éxito a la cola de descargas."
        elif res.status_code == 409:
            return True, "El torrent ya estaba en qBittorrent."
        else:
            return False, f"Error {res.status_code}: {res.text}"
    except Exception as e:
        return False, f"Error de conexión con qBittorrent: {e}"

def qbit_add_magnet(magnet_url):
    """Añade un enlace magnet o URL a qBittorrent."""
    try:
        data = {
            "urls": magnet_url,
            "savepath": QBIT_SAVE_PATH,
            "autoTMM": "false"
        }
        res = requests.post(f"{QBIT_API_URL}/torrents/add", data=data, timeout=15)
        if res.status_code == 200:
            return True, "Enlace añadido con éxito a qBittorrent."
        elif res.status_code == 409:
            return True, "El enlace ya estaba en qBittorrent."
        else:
            return False, f"Error {res.status_code}: {res.text}"
    except Exception as e:
        return False, f"Error de conexión con qBittorrent: {e}"

def qbit_get_torrents_for_bot():
    """Obtiene la lista en vivo de torrents desde qBittorrent."""
    try:
        res = requests.get(f"{QBIT_API_URL}/torrents/info", timeout=10)
        if res.status_code == 200:
            with TELEGRAM_BOT_LOCK:
                TELEGRAM_BOT_CACHE["qbit_connected"] = True
            return res.json()
    except Exception:
        with TELEGRAM_BOT_LOCK:
            TELEGRAM_BOT_CACHE["qbit_connected"] = False
    return []

def load_tg_notified_hashes():
    """Carga los hashes de torrents que ya han sido notificados como completados."""
    if os.path.exists(TELEGRAM_NOTIFIED_FILE):
        try:
            with open(TELEGRAM_NOTIFIED_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                hashes = set(data.get("notified", []))
                with TELEGRAM_BOT_LOCK:
                    TELEGRAM_BOT_CACHE["notified_torrents_count"] = len(hashes)
                return hashes
        except Exception:
            return set()
    return set()

def save_tg_notified_hashes(hashes_set):
    """Guarda los hashes de torrents ya notificados."""
    try:
        os.makedirs(os.path.dirname(TELEGRAM_NOTIFIED_FILE), exist_ok=True)
        with open(TELEGRAM_NOTIFIED_FILE, "w", encoding="utf-8") as f:
            json.dump({"notified": list(hashes_set)}, f, indent=2)
        with TELEGRAM_BOT_LOCK:
            TELEGRAM_BOT_CACHE["notified_torrents_count"] = len(hashes_set)
    except Exception as e:
        print(f"[SAVE NOTIFIED ERROR] {e}")

# Pre-cargar listas persistentes al arrancar el módulo
try:
    load_tg_whitelist()
    load_tg_notified_hashes()
except Exception:
    pass

def telegram_bot_monitor_worker():
    """Hilo en segundo plano integrado que vigila el estado de las descargas en qBittorrent y avisa a Telegram al terminar."""
    print("[TG BOT] Monitor de descargas qBittorrent integrado iniciado.")
    notified_hashes = load_tg_notified_hashes()
    is_initial_run = not os.path.exists(TELEGRAM_NOTIFIED_FILE)

    if is_initial_run:
        initial_torrents = qbit_get_torrents_for_bot()
        for t in initial_torrents:
            progress = t.get("progress", 0)
            amount_left = t.get("amount_left", 1)
            state = t.get("state", "")
            if progress >= 1.0 or amount_left == 0 or state in ["uploading", "pausedUP", "stalledUP"]:
                notified_hashes.add(t.get("hash"))
        save_tg_notified_hashes(notified_hashes)

    while True:
        try:
            torrents = qbit_get_torrents_for_bot()
            updated = False
            for t in torrents:
                t_hash = t.get("hash")
                t_name = t.get("name", "Torrent")
                progress = t.get("progress", 0)
                amount_left = t.get("amount_left", 1)
                size = t.get("total_size", t.get("size", 0))
                state = t.get("state", "")

                is_completed = (progress >= 1.0 or amount_left == 0 or state in ["uploading", "pausedUP", "stalledUP"])

                if is_completed and t_hash not in notified_hashes:
                    notified_hashes.add(t_hash)
                    updated = True
                    size_str = tg_format_size(size)
                    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

                    cfg = load_tg_config()
                    if cfg.get("notify_completed_torrents", True):
                        alert_msg = (
                            "🎉 *¡Descarga completada!*\n\n"
                            f"📁 *Nombre:* `{t_name}`\n"
                            f"💾 *Tamaño:* {size_str}\n"
                            f"📂 *Guardado en:* `NAS Video / torrent`\n"
                            f"⏱️ *Hora:* {now_str}"
                        )
                        print(f"[TG BOT] Torrent completado: {t_name}. Notificando a Telegram...")
                        broadcast_to_tg_whitelist(
                            alert_msg,
                            log_title=f"🎉 Alerta: Descarga completada ({t_name})",
                            log_type="torrent_completed"
                        )
                    else:
                        print(f"[TG BOT] Torrent completado: {t_name}. Notificación omitida por ajustes.")
                        record_tg_activity(
                            direction="out",
                            msg_type="torrent_completed_skipped",
                            target="Nadie (Avisos en pausa)",
                            user_name="Sistema",
                            title=f"Descarga completada (avisos en pausa): {t_name}",
                            content=f"El torrent '{t_name}' ({size_str}) ha finalizado, pero los avisos están desactivados en ajustes.",
                            status="ok",
                            details={"torrent": t_name, "size": size_str}
                        )

            if updated:
                save_tg_notified_hashes(notified_hashes)

        except Exception as e:
            print(f"[TG MONITOR ERROR] {e}")

        time.sleep(10)

def telegram_bot_polling_worker():
    """Hilo principal de Telegram (long polling getUpdates) integrado en server.py."""
    print("[TG BOT] Long-polling de Telegram integrado iniciado.")
    offset = 0
    with TELEGRAM_BOT_LOCK:
        TELEGRAM_BOT_CACHE["polling_active"] = True
        TELEGRAM_BOT_CACHE["last_action"] = "Sondeando api.telegram.org..."

    while True:
        try:
            with TELEGRAM_BOT_LOCK:
                TELEGRAM_BOT_CACHE["polling_active"] = True
                TELEGRAM_BOT_CACHE["last_poll_ts"] = time.time()
                TELEGRAM_BOT_CACHE["last_poll_str"] = datetime.now().strftime("%H:%M:%S")

            url = f"{TELEGRAM_API_URL}/getUpdates?offset={offset}&timeout=25"
            r = requests.get(url, timeout=30)
            data = r.json()

            if not data.get("ok"):
                time.sleep(2)
                continue

            updates = data.get("result", [])
            for update in updates:
                offset = update["update_id"] + 1

                message = update.get("message")
                if not message:
                    continue

                user = message.get("from", {})
                user_id = user.get("id")
                first_name = user.get("first_name", "Amigo")
                chat_id = message["chat"]["id"]
                msg_id = message["message_id"]

                with TELEGRAM_BOT_LOCK:
                    TELEGRAM_BOT_CACHE["messages_processed"] += 1
                    TELEGRAM_BOT_CACHE["last_message_ts"] = time.time()
                    TELEGRAM_BOT_CACHE["last_message_str"] = datetime.now().strftime("%H:%M:%S")

                # Comprobación de seguridad
                if not is_tg_user_allowed(user_id):
                    print(f"[TG AUTH DENIED] Usuario no autorizado: {user_id} ({first_name})")
                    record_tg_activity(
                        direction="in",
                        msg_type="auth_denied",
                        target=str(chat_id),
                        user_name=f"{first_name} (ID: {user_id})",
                        title="⛔ Acceso no autorizado rechazado",
                        content="Intento de interacción por un usuario fuera de la lista blanca.",
                        status="denied"
                    )
                    tg_send_message(
                        chat_id,
                        "⛔ *Acceso no autorizado.* Este bot es privado para descargas de torrents en el NAS.",
                        log_title="Respuesta: Acceso no autorizado",
                        log_type="auth_denied"
                    )
                    continue

                # 1. Documento .torrent
                document = message.get("document")
                if document:
                    file_name = document.get("file_name", "archivo.torrent")
                    if file_name.lower().endswith(".torrent"):
                        record_tg_activity(
                            direction="in",
                            msg_type="torrent_file_received",
                            target=str(chat_id),
                            user_name=f"{first_name} (ID: {user_id})",
                            title=f"📥 Archivo recibido: {file_name}",
                            content=f"Documento .torrent enviado por {first_name}.",
                            status="received",
                            details={"file_name": file_name}
                        )
                        tg_send_message(
                            chat_id,
                            f"📥 *Descargando archivo torrent:* `{file_name}`...",
                            reply_to_message_id=msg_id,
                            log_title="Respuesta: Descargando archivo .torrent"
                        )
                        file_id = document["file_id"]
                        f_info = requests.get(f"{TELEGRAM_API_URL}/getFile?file_id={file_id}", timeout=20).json()
                        if f_info.get("ok"):
                            f_path = f_info["result"]["file_path"]
                            dl_url = f"{TELEGRAM_FILE_URL}/{f_path}"
                            f_bytes = requests.get(dl_url, timeout=30).content
                            ok, resp_msg = qbit_add_torrent_file(file_name, f_bytes)
                            if ok:
                                tg_send_message(
                                    chat_id,
                                    f"✅ *Torrent añadido a qBittorrent:*\n`{file_name}`\n\n⏳ Descargando... Te avisaré en cuanto termine.",
                                    reply_to_message_id=msg_id,
                                    log_title="Respuesta: Torrent añadido a qBittorrent"
                                )
                            else:
                                tg_send_message(
                                    chat_id,
                                    f"❌ *Error al añadir torrent:* {resp_msg}",
                                    reply_to_message_id=msg_id,
                                    log_title="Respuesta: Error al añadir torrent"
                                )
                        else:
                            tg_send_message(
                                chat_id,
                                "❌ Error al descargar el archivo desde Telegram.",
                                reply_to_message_id=msg_id,
                                log_title="Respuesta: Error al descargar archivo"
                            )
                        continue
                    else:
                        tg_send_message(
                            chat_id,
                            "ℹ️ Por favor, envía un archivo que termine en `.torrent`.",
                            reply_to_message_id=msg_id,
                            log_title="Respuesta: Tipo de archivo no admitido"
                        )
                        continue

                # 2. Mensajes de texto
                text = (message.get("text") or "").strip()
                if not text:
                    continue

                record_tg_activity(
                    direction="in",
                    msg_type="command_received",
                    target=str(chat_id),
                    user_name=f"{first_name} (ID: {user_id})",
                    title=f"💬 Mensaje/Comando: {text[:40]}",
                    content=text,
                    status="received"
                )

                # Comandos de bienvenida / ayuda
                if text in ["/start", "/help", "ayuda", "start"]:
                    help_msg = (
                        f"👋 *¡Hola {first_name}! Panel del Servidor Home NAS.*\n\n"
                        "📥 *Descargas (qBittorrent):*\n"
                        "• Envíame cualquier `.torrent` o enlace `magnet:` para descargarlo.\n"
                        "• `/status` o `/lista` — Ver descargas en curso.\n\n"
                        "🌐 *Red Local (Vigilancia LAN):*\n"
                        "• `/red` o `/dispositivos` — Ver equipos conectados y desconectados en tiempo real.\n"
                        "• `/actualizar_red` — Sincronizar nombres con Pi-hole, ADB y Google Home."
                    )
                    tg_send_message(
                        chat_id,
                        help_msg,
                        reply_to_message_id=msg_id,
                        log_title="Respuesta: Menú de ayuda (/help)"
                    )
                    continue

                # Comando /status o /lista
                if text in ["/status", "/lista", "/descargas"]:
                    torrents = qbit_get_torrents_for_bot()
                    active = [t for t in torrents if t.get("progress", 0) < 1.0 and t.get("amount_left", 1) > 0]
                    if not active:
                        tg_send_message(
                            chat_id,
                            "🟢 *No hay descargas activas en este momento.* Todas están completadas o en espera.",
                            reply_to_message_id=msg_id,
                            log_title="Respuesta: Descargas inactivas (/status)"
                        )
                    else:
                        msg_lines = [f"📊 *Descargas en curso ({len(active)}):*\n"]
                        for idx, t in enumerate(active[:8], 1):
                            name = t.get("name", "Torrent")
                            pct = t.get("progress", 0) * 100
                            size_str = tg_format_size(t.get("total_size", t.get("size", 0)))
                            speed_str = tg_format_size(t.get("dlspeed", 0)) + "/s"
                            eta_str = tg_format_eta(t.get("eta", 0))
                            msg_lines.append(
                                f"*{idx}. {name}*\n"
                                f"   ├ Progreso: *{pct:.1f}%* de {size_str}\n"
                                f"   └ Velocidad: {speed_str} | Restante: {eta_str}\n"
                            )
                        if len(active) > 8:
                            msg_lines.append(f"_... y {len(active) - 8} más._")
                        tg_send_message(
                            chat_id,
                            "\n".join(msg_lines),
                            reply_to_message_id=msg_id,
                            log_title=f"Respuesta: Estado de descargas ({len(active)} activas)"
                        )
                    continue

                # Comando /actualizar_red o /sync_red
                if text in ["/actualizar_red", "/sync_red", "/sync"]:
                    tg_send_message(
                        chat_id,
                        "🔄 *Sincronizando dispositivos de red con Pi-hole...*",
                        reply_to_message_id=msg_id,
                        log_title="Respuesta: Sincronizando dispositivos LAN"
                    )
                    sync_script = next((p for p in [
                        os.path.join(BASE_DIR, "sync_pihole_devices.py"),
                        os.path.join(BASE_DIR, "scripts", "sync_pihole_devices.py"),
                        "/home/servidor/scripts/sync_pihole_devices.py"
                    ] if os.path.exists(p)), None)
                    if sync_script:
                        try:
                            res = subprocess.run(["python3", sync_script], capture_output=True, text=True, timeout=25)
                            if res.returncode == 0:
                                tg_send_message(
                                    chat_id,
                                    "✅ *Sincronización completada con éxito.*\nSe han actualizado los nombres de Pi-hole utilizando datos de ADB y Google Home.",
                                    reply_to_message_id=msg_id,
                                    log_title="Respuesta: Sincronización exitosa con Pi-hole"
                                )
                            else:
                                tg_send_message(
                                    chat_id,
                                    f"⚠️ Sincronización finalizada con avisos:\n`{res.stderr[:300]}`",
                                    reply_to_message_id=msg_id,
                                    log_title="Respuesta: Sincronización con avisos"
                                )
                        except Exception as e:
                            tg_send_message(
                                chat_id,
                                f"❌ Error ejecutando sincronización: {e}",
                                reply_to_message_id=msg_id,
                                log_title="Respuesta: Error en sincronización LAN"
                            )
                    else:
                        tg_send_message(
                            chat_id,
                            "ℹ️ Script de sincronización de Pi-hole no disponible en este entorno.",
                            reply_to_message_id=msg_id,
                            log_title="Respuesta: Script sync no disponible"
                        )
                    continue

                # Comando /red o /dispositivos
                if text in ["/red", "/dispositivos", "/equipos", "red", "dispositivos"]:
                    devs = {}
                    if os.path.exists(TELEGRAM_NET_MONITOR_FILE):
                        try:
                            with open(TELEGRAM_NET_MONITOR_FILE, "r", encoding="utf-8") as f:
                                devs = json.load(f)
                        except Exception:
                            devs = {}

                    pihole_names = {}
                    if os.path.exists(TELEGRAM_FRIENDLY_NAMES_FILE):
                        try:
                            with open(TELEGRAM_FRIENDLY_NAMES_FILE, "r", encoding="utf-8") as fn_f:
                                fn_data = json.load(fn_f)
                                for f_ip, f_info in fn_data.items():
                                    pihole_names[f_ip] = f_info.get("friendly") or f_info.get("name")
                        except Exception:
                            pass

                    if os.path.exists("/etc/pihole/custom.list"):
                        try:
                            with open("/etc/pihole/custom.list", "r", encoding="utf-8") as pl_f:
                                for line in pl_f:
                                    p = line.strip().split()
                                    if len(p) >= 2 and not p[1].endswith(".duckdns.org"):
                                        if p[0] not in pihole_names:
                                            pihole_names[p[0]] = p[1]
                        except Exception:
                            pass

                    online_list = []
                    offline_list = []
                    now_dt = datetime.now()

                    if devs:
                        for mac, d in devs.items():
                            status = d.get("status", "offline")
                            ip = d.get("ip", "N/A")
                            name = pihole_names.get(ip) or d.get("name", "Desconocido")
                            vendor = d.get("vendor", "")

                            if status == "online":
                                conn_time = d.get("last_connected")
                                time_str = ""
                                if conn_time:
                                    try:
                                        c_dt = datetime.fromisoformat(conn_time)
                                        diff = int((now_dt - c_dt).total_seconds())
                                        if diff < 60:
                                            time_str = f"hace {diff}s"
                                        elif diff < 3600:
                                            time_str = f"hace {diff // 60}m"
                                        else:
                                            time_str = f"hace {diff // 3600}h {(diff % 3600) // 60}m"
                                    except Exception:
                                        pass
                                line = f"🟢 `{name}`\n   ├ IP: `{ip}` ({vendor})\n   └ Conectado: {time_str if time_str else 'Activo'}"
                                online_list.append((ip, line))
                            else:
                                disc_time = d.get("last_disconnected")
                                time_str = ""
                                if disc_time:
                                    try:
                                        d_dt = datetime.fromisoformat(disc_time)
                                        diff = int((now_dt - d_dt).total_seconds())
                                        if diff < 60:
                                            time_str = f"hace {diff}s"
                                        elif diff < 3600:
                                            time_str = f"hace {diff // 60}m"
                                        else:
                                            time_str = f"hace {diff // 3600}h {(diff % 3600) // 60}m"
                                    except Exception:
                                        pass
                                line = f"⚪ `{name}`\n   ├ Última IP: `{ip}`\n   └ Desconectado: {time_str if time_str else 'Inactivo'}"
                                offline_list.append((ip, line))
                    else:
                        with WIFI_LOCK:
                            clients_copy = list(WIFI_CACHE.get("clients", []))
                        for cl in clients_copy:
                            ip = cl.get("ip", "N/A")
                            name = cl.get("name") or pihole_names.get(ip) or ip
                            vendor = cl.get("vendor", "")
                            line = f"🟢 `{name}`\n   ├ IP: `{ip}` ({vendor})\n   └ Conectado: Activo"
                            online_list.append((ip, line))

                    def ip_sort_key(item):
                        try:
                            return [int(x) for x in item[0].split(".")]
                        except Exception:
                            return [999, 999, 999, 999]

                    online_list.sort(key=ip_sort_key)
                    offline_list.sort(key=ip_sort_key)

                    lines = [f"📡 *ESTADO DE LA RED LOCAL (LAN)*\n\n🟢 *Conectados ahora mismo ({len(online_list)}):*"]
                    for _, l in online_list:
                        lines.append(l)

                    if offline_list:
                        lines.append(f"\n⚪ *Desconectados recientemente ({len(offline_list)}):*")
                        for _, l in offline_list[:8]:
                            lines.append(l)
                        if len(offline_list) > 8:
                            lines.append(f"_... y {len(offline_list) - 8} dispositivos más._")

                    tg_send_message(
                        chat_id,
                        "\n".join(lines),
                        reply_to_message_id=msg_id,
                        log_title=f"Respuesta: Estado de red LAN ({len(online_list)} online)"
                    )
                    continue

                # Detección de enlaces Magnet
                magnet_matches = re.findall(r"magnet:\?[^\s]+", text)
                if magnet_matches:
                    for mag in magnet_matches:
                        ok, resp_msg = qbit_add_magnet(mag)
                        if ok:
                            tg_send_message(
                                chat_id,
                                "🧲 *Enlace Magnet añadido a qBittorrent.*\n\n⏳ Descargando... Te avisaré en cuanto termine.",
                                reply_to_message_id=msg_id,
                                log_title="Respuesta: Enlace magnet añadido"
                            )
                        else:
                            tg_send_message(
                                chat_id,
                                f"❌ *Error al añadir magnet:* {resp_msg}",
                                reply_to_message_id=msg_id,
                                log_title="Respuesta: Error al añadir magnet"
                            )
                    continue

                # Detección de URL .torrent directa
                url_torrent_matches = re.findall(r"https?://[^\s]+\.torrent[^\s]*", text)
                if url_torrent_matches:
                    for u in url_torrent_matches:
                        ok, resp_msg = qbit_add_magnet(u)
                        if ok:
                            tg_send_message(
                                chat_id,
                                f"🌐 *URL de torrent añadida:*\n`{u}`\n\n⏳ Descargando... Te avisaré en cuanto termine.",
                                reply_to_message_id=msg_id,
                                log_title="Respuesta: URL torrent añadida"
                            )
                        else:
                            tg_send_message(
                                chat_id,
                                f"❌ *Error al añadir URL torrent:* {resp_msg}",
                                reply_to_message_id=msg_id,
                                log_title="Respuesta: Error al añadir URL torrent"
                            )
                    continue

                # Texto no reconocido
                tg_send_message(
                    chat_id,
                    "ℹ️ Envíame un archivo `.torrent`, un enlace `magnet:?xt=...` o escribe `/status` para ver las descargas en curso.",
                    reply_to_message_id=msg_id,
                    log_title="Respuesta: Texto o comando no reconocido"
                )

        except requests.exceptions.Timeout:
            with TELEGRAM_BOT_LOCK:
                TELEGRAM_BOT_CACHE["polling_active"] = True
                TELEGRAM_BOT_CACHE["last_poll_ts"] = time.time()
                TELEGRAM_BOT_CACHE["last_poll_str"] = datetime.now().strftime("%H:%M:%S")
            continue
        except requests.exceptions.ConnectionError as ce:
            print(f"[TG BOT CONN WARN] Reintentando conexión con api.telegram.org: {ce}")
            time.sleep(5)
        except Exception as e:
            print(f"[TG BOT LOOP ERROR] {e}")
            time.sleep(3)

# ==============================================================================
# RECOLECTOR UNIFICADO DE FALLOS Y ERRORES DEL SISTEMA (APPS, SERVICIOS, KERNEL)
# ==============================================================================
SYSTEM_LOGS_CACHE = {
    "err": {"ts": 0.0, "data": None},
    "warn": {"ts": 0.0, "data": None}
}
SYSTEM_LOGS_LOCK = threading.Lock()

def fetch_system_logs(priority_max=3, limit=80, force=False):
    """
    Recopila de forma unificada y ultraligera todos los fallos, errores y eventos críticos
    procedentes de todas las aplicaciones (Docker, apps nativas), servicios systemd y kernel
    mediante systemd-journald y systemctl. 100% Zero-Hardcoding.
    """
    cache_key = "warn" if priority_max >= 4 else "err"
    now = time.time()
    with SYSTEM_LOGS_LOCK:
        cached = SYSTEM_LOGS_CACHE.get(cache_key, {})
        if not force and cached.get("data") and (now - cached.get("ts", 0) < 4.0):
            return cached["data"]

    # 1. Comprobar unidades en estado fallido (systemctl list-units --failed)
    failed_units = []
    try:
        p_fail = subprocess.run(
            ['systemctl', 'list-units', '--failed', '--no-pager', '--plain'],
            capture_output=True, text=True, timeout=2.5
        )
        for line in p_fail.stdout.strip().split('\n'):
            line = line.strip()
            if not line or line.startswith(('UNIT', '0 loaded', 'LOAD', '●')):
                continue
            parts = line.split(None, 4)
            if parts and parts[0].endswith(('.service', '.mount', '.socket', '.timer', '.target')):
                failed_units.append({
                    "unit": parts[0],
                    "load": parts[1] if len(parts) > 1 else "loaded",
                    "active": parts[2] if len(parts) > 2 else "failed",
                    "sub": parts[3] if len(parts) > 3 else "failed",
                    "description": parts[4] if len(parts) > 4 else parts[0]
                })
    except Exception:
        pass

    # 2. Consultar journalctl con prioridad especificada en formato JSON
    logs = []
    category_counts = {"docker": 0, "service": 0, "kernel": 0, "system": 0}
    try:
        cmd = ['journalctl', '-p', str(priority_max), '-n', str(min(200, max(20, limit))), '--no-pager', '-o', 'json']
        p_j = subprocess.run(cmd, capture_output=True, text=True, timeout=3.5)
        raw_lines = p_j.stdout.strip().split('\n')
        for raw_line in raw_lines:
            if not raw_line:
                continue
            try:
                item = json.loads(raw_line)
                msg = item.get("MESSAGE", "")
                if isinstance(msg, list):
                    try:
                        msg = bytes(msg).decode('utf-8', errors='replace')
                    except Exception:
                        msg = str(msg)
                msg_str = str(msg).strip()
                if not msg_str:
                    continue

                # Deducción dinámica de origen (Zero-Hardcoding)
                c_name = item.get("CONTAINER_NAME")
                sysd_unit = item.get("_SYSTEMD_UNIT") or ""
                syslog_id = item.get("SYSLOG_IDENTIFIER") or ""
                comm = item.get("_COMM") or ""
                transport = item.get("_TRANSPORT") or ""

                category = "system"
                if c_name:
                    unit_name = str(c_name)
                    category = "docker"
                elif "docker" in sysd_unit.lower() or "containerd" in sysd_unit.lower():
                    unit_name = syslog_id or comm or sysd_unit or "docker"
                    category = "docker"
                elif transport == "kernel" or syslog_id == "kernel" or comm == "kernel":
                    unit_name = "kernel"
                    category = "kernel"
                elif sysd_unit and sysd_unit.endswith(('.service', '.mount', '.socket', '.timer', '.slice')):
                    unit_name = sysd_unit
                    category = "service"
                elif syslog_id:
                    unit_name = syslog_id
                    category = "service" if syslog_id.endswith('.service') else "system"
                else:
                    unit_name = comm or "sistema"

                prio_num = 3
                try:
                    prio_num = int(item.get("PRIORITY", 3))
                except Exception:
                    pass

                prio_label = {
                    0: "EMERG",
                    1: "ALERT",
                    2: "CRIT",
                    3: "ERR",
                    4: "WARN"
                }.get(prio_num, "ERR")

                ts_us = int(item.get("__REALTIME_TIMESTAMP", 0))
                ts_ms = ts_us // 1000 if ts_us else int(time.time() * 1000)
                ts_sec = ts_ms / 1000.0
                time_str = datetime.fromtimestamp(ts_sec).strftime("%H:%M:%S")
                time_iso = datetime.fromtimestamp(ts_sec).strftime("%Y-%m-%d %H:%M:%S")

                seq = item.get("__SEQNUM") or len(logs)
                entry_id = f"syslog_{ts_ms}_{seq}"

                category_counts[category] = category_counts.get(category, 0) + 1

                logs.append({
                    "id": entry_id,
                    "ts": ts_ms,
                    "time_str": time_str,
                    "time_iso": time_iso,
                    "date_str": time_str,
                    "unit": unit_name,
                    "source": unit_name,
                    "container": unit_name if category == "docker" else "",
                    "category": category,
                    "level": prio_label,
                    "priority": prio_num,
                    "message": msg_str
                })
            except Exception:
                continue
    except Exception:
        pass

    # Invertir para mostrar primero los más recientes
    logs.reverse()
    category_counts["total"] = len(logs)

    result = {
        "success": True,
        "total_errors": len(logs),
        "failed_units_count": len(failed_units),
        "failed_units": failed_units,
        "counts_by_category": category_counts,
        "logs": logs,
        "entries": logs,
        "fetched_at": datetime.now().strftime("%H:%M:%S")
    }

    with SYSTEM_LOGS_LOCK:
        SYSTEM_LOGS_CACHE[cache_key] = {
            "ts": now,
            "data": result
        }

    return result

def get_system_errors_summary():
    """Devuelve un resumen ultraligero de fallos para incluirlo en /api/metrics."""
    data = fetch_system_logs(priority_max=3, limit=50)
    counts = data.get("counts_by_category", {})
    total = data.get("total_errors", 0)
    failed_u = data.get("failed_units_count", 0)
    return {
        "total": total,
        "failed_units_count": failed_u,
        "docker_errors": counts.get("docker", 0),
        "service_errors": counts.get("service", 0),
        "kernel_errors": counts.get("kernel", 0),
        "system_errors": counts.get("system", 0),
        "healthy": (total == 0 and failed_u == 0),
        "last_sync": data.get("fetched_at", "--")
    }

PORT_SERVICE_LABELS = {
    20: "FTP Datos",
    21: "FTP Servidor de Archivos",
    22: "SSH Daemon (OpenSSH)",
    25: "SMTP Correo Saliente",
    53: "DNS Resolver (Pi-hole / Unbound)",
    67: "DHCP Servidor de Red",
    68: "DHCP Cliente de Red",
    80: "HTTP Web (Caddy / Servidor Web)",
    110: "POP3 Servidor de Correo",
    123: "NTP Sincronización Horaria",
    143: "IMAP Servidor de Correo",
    443: "HTTPS / TLS (Caddy Proxy / Web)",
    445: "Samba / SMB (Archivos de Red)",
    465: "SMTPS Correo Seguro",
    587: "SMTP Envío Autenticado",
    993: "IMAPS Correo Seguro",
    995: "POP3S Correo Seguro",
    1883: "MQTT Broker IoT",
    1900: "UPnP / SSDP Descubrimiento",
    1926: "Tuya IoT Device",
    2019: "Caddy Admin API",
    2283: "Immich Photo Server",
    3000: "Panel Recursos Web UI",
    3306: "MySQL / MariaDB Database",
    4011: "PXE Boot Proxy",
    4200: "Shell In A Box",
    5000: "Flask API / Docker Registry",
    5037: "Android Debug Bridge (ADB)",
    5353: "mDNS / Avahi ZeroConf",
    5432: "PostgreSQL Database",
    5555: "Android ADB Remoto",
    6379: "Redis / Valkey Cache",
    7878: "Radarr Media Service",
    8000: "Backend API Service",
    8009: "Google Cast / Chromecast",
    8080: "HTTP Proxy / Web Socket",
    8081: "Torrent / Web Alternate",
    8082: "qBittorrent Web UI",
    8085: "Panel Recursos Backend",
    8088: "Pi-hole Web Admin",
    8089: "Nextcloud Web App",
    8096: "Emby Media Server",
    8123: "Home Assistant",
    8443: "HTTPS Alternativo",
    8550: "Panel Recursos (HTTPS)",
    8884: "Tesseract OCR Service",
    8989: "Sonarr Media Service",
    8998: "Python Script Server",
    8999: "Nginx Web Proxy",
    9000: "Portainer Docker Engine",
    9050: "Tor SOCKS Proxy",
    9090: "Cockpit Management Console",
    9091: "Transmission Torrent",
    9443: "Portainer HTTPS",
    9980: "Collabora Online (Nextcloud)",
    11434: "Ollama LLM Engine",
    18554: "go2rtc WebRTC Gateway",
    18555: "go2rtc RTSP Stream",
    32034: "Plex Companion / Cast",
    32400: "Plex Media Server",
    36367: "Tailscale Mesh VPN",
    36907: "Tailscale Mesh VPN",
    41641: "Tailscale WireGuard",
    51820: "WireGuard VPN Tunnel"
}

LISTENING_PORTS_MAP = {}
LAST_LISTENING_SCAN = 0.0

RE_SS_PORT = re.compile(r':(\d+)\s+')
RE_SS_PROC = re.compile(r'users:\(\(\"([^\"]+)\",pid=(\d+)')
RE_PIHOLE_LOG_REPLY = re.compile(
    r"(?:reply|cached|cached-stale)\s+([a-zA-Z0-9\.\-_]+)\s+is\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})"
)
RE_CONNTRACK_FLOW = re.compile(r"src=([^\s]+)\s+dst=([^\s]+)\s+sport=(\d+)\s+dport=(\d+)")

def update_listening_ports_map(force=False):
    global LISTENING_PORTS_MAP, LAST_LISTENING_SCAN
    now = time.time()
    if not force and (now - LAST_LISTENING_SCAN < 20.0) and LISTENING_PORTS_MAP:
        return LISTENING_PORTS_MAP
    LAST_LISTENING_SCAN = now
    new_map = {}
    try:
        p = subprocess.run(['sudo', 'ss', '-tulpn', '-H'], capture_output=True, text=True, timeout=2.0)
        if p.returncode == 0:
            for line in p.stdout.splitlines():
                m_port = RE_SS_PORT.search(line)
                m_proc = RE_SS_PROC.search(line)
                if m_port and m_proc:
                    port = int(m_port.group(1))
                    proc = m_proc.group(1)
                    pid = int(m_proc.group(2))
                    new_map[port] = {"proc": proc, "pid": pid}
    except Exception:
        pass
    if new_map:
        LISTENING_PORTS_MAP = new_map
    return LISTENING_PORTS_MAP


def _is_private_ip(ip_str):
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            return True
        if ip_obj in ipaddress.ip_network('100.64.0.0/10'):
            return True
    except Exception:
        return True
    return False

GEOIP_HISTORY_DB_FILE = os.path.join(BASE_DIR, "geoip_history.db")
GEOIP_HISTORY_DB_LOCK = threading.Lock()

def init_geoip_history_db():
    """Inicializa la base de datos SQLite para persistir ubicaciones GeoIP de alta precisión y el historial de conexiones catalogado por servicios."""
    with GEOIP_HISTORY_DB_LOCK:
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS geoip_locations (
                    ip TEXT PRIMARY KEY,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    city TEXT DEFAULT '',
                    region TEXT DEFAULT '',
                    postal TEXT DEFAULT '',
                    country TEXT DEFAULT '',
                    country_code TEXT DEFAULT '',
                    isp TEXT DEFAULT '',
                    asn TEXT DEFAULT '',
                    accuracy_source TEXT DEFAULT 'ip-api',
                    updated_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS connection_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conn_key TEXT UNIQUE NOT NULL,
                    direction TEXT NOT NULL,
                    protocol TEXT DEFAULT 'TCP',
                    local_ip TEXT DEFAULT '',
                    local_hostname TEXT DEFAULT '',
                    local_port INTEGER DEFAULT 0,
                    remote_ip TEXT NOT NULL,
                    remote_port INTEGER DEFAULT 0,
                    domain TEXT DEFAULT '',
                    service TEXT NOT NULL,
                    process TEXT DEFAULT '',
                    jail TEXT DEFAULT '',
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    city TEXT DEFAULT '',
                    region TEXT DEFAULT '',
                    postal TEXT DEFAULT '',
                    country TEXT DEFAULT '',
                    country_code TEXT DEFAULT '',
                    isp TEXT DEFAULT '',
                    asn TEXT DEFAULT '',
                    accuracy_source TEXT DEFAULT 'ip-api',
                    first_seen REAL NOT NULL,
                    last_seen REAL NOT NULL,
                    hit_count INTEGER DEFAULT 1
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_conn_hist_service ON connection_history(service);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_conn_hist_local_ip ON connection_history(local_ip);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_conn_hist_direction ON connection_history(direction);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_conn_hist_last_seen ON connection_history(last_seen DESC);")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[-] Error inicializando SQLite geoip_history.db: {e}")

def save_geoip_locations_to_sqlite(entries_dict):
    """Persiste un lote de ubicaciones GeoIP resueltas en la tabla SQLite geoip_locations."""
    if not entries_dict:
        return
    rows = []
    now = time.time()
    for ip_k, val in entries_dict.items():
        if not isinstance(val, dict) or not isinstance(val.get("lat"), (int, float)) or not isinstance(val.get("lng"), (int, float)):
            continue
        rows.append((
            str(ip_k),
            float(val["lat"]),
            float(val["lng"]),
            str(val.get("city") or ""),
            str(val.get("region") or ""),
            str(val.get("postal") or ""),
            str(val.get("country") or ""),
            str(val.get("country_code") or ""),
            str(val.get("isp") or ""),
            str(val.get("asn") or ""),
            str(val.get("accuracy_source") or "ip-api"),
            float(val.get("ts") or now)
        ))
    if not rows:
        return
    with GEOIP_HISTORY_DB_LOCK:
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.executemany("""
                INSERT INTO geoip_locations (
                    ip, lat, lng, city, region, postal, country, country_code, isp, asn, accuracy_source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(ip) DO UPDATE SET
                    lat=excluded.lat,
                    lng=excluded.lng,
                    city=excluded.city,
                    region=excluded.region,
                    postal=excluded.postal,
                    country=excluded.country,
                    country_code=excluded.country_code,
                    isp=excluded.isp,
                    asn=excluded.asn,
                    accuracy_source=excluded.accuracy_source,
                    updated_at=excluded.updated_at
            """, rows)
            conn.commit()
            conn.close()
        except Exception:
            pass

def record_connections_to_sqlite(connections_list):
    """Registra y actualiza en SQLite todas las conexiones públicas geolocalizadas catalogadas por servicio."""
    if not connections_list:
        return
    now = time.time()
    rows = []
    for c in connections_list:
        if not isinstance(c, dict) or c.get("is_lan"):
            continue
        lat = c.get("lat")
        lng = c.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if c.get("geo_status") == "pending":
            continue
        remote_ip = str(c.get("remote_ip") or "").strip()
        if not remote_ip or _is_private_ip(remote_ip):
            continue
        direction = str(c.get("direction") or "outgoing").strip()
        local_ip = str(c.get("local_ip") or "").strip()
        raw_service = str(c.get("service") or "").strip()
        if not raw_service:
            rport = int(c.get("remote_port") or 0)
            proto = str(c.get("protocol") or "TCP").upper()
            raw_service = f"{proto}/{rport}" if rport else proto
        # Normalize service catalog label (strip dynamic domain suffix after ' · ' if present so services group cleanly)
        service_catalog = raw_service.split(" · ")[0].strip() or raw_service
        conn_key = f"{remote_ip}|{service_catalog}|{local_ip}|{direction}"
        rows.append((
            conn_key,
            direction,
            str(c.get("protocol") or "TCP"),
            local_ip,
            str(c.get("local_hostname") or ""),
            int(c.get("local_port") or 0),
            remote_ip,
            int(c.get("remote_port") or 0),
            str(c.get("domain") or ""),
            service_catalog,
            str(c.get("process") or ""),
            str(c.get("jail") or ""),
            float(lat),
            float(lng),
            str(c.get("city") or ""),
            str(c.get("region") or ""),
            str(c.get("postal") or ""),
            str(c.get("country") or ""),
            str(c.get("country_code") or ""),
            str(c.get("isp") or ""),
            str(c.get("asn") or ""),
            str(c.get("accuracy_source") or "ip-api"),
            now,
            now
        ))
    if not rows:
        return
    with GEOIP_HISTORY_DB_LOCK:
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.executemany("""
                INSERT INTO connection_history (
                    conn_key, direction, protocol, local_ip, local_hostname, local_port,
                    remote_ip, remote_port, domain, service, process, jail,
                    lat, lng, city, region, postal, country, country_code, isp, asn, accuracy_source,
                    first_seen, last_seen, hit_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(conn_key) DO UPDATE SET
                    last_seen=excluded.last_seen,
                    hit_count=connection_history.hit_count + 1,
                    lat=excluded.lat,
                    lng=excluded.lng,
                    city=CASE WHEN excluded.city != '' THEN excluded.city ELSE connection_history.city END,
                    region=CASE WHEN excluded.region != '' THEN excluded.region ELSE connection_history.region END,
                    postal=CASE WHEN excluded.postal != '' THEN excluded.postal ELSE connection_history.postal END,
                    country=CASE WHEN excluded.country != '' THEN excluded.country ELSE connection_history.country END,
                    country_code=CASE WHEN excluded.country_code != '' THEN excluded.country_code ELSE connection_history.country_code END,
                    isp=CASE WHEN excluded.isp != '' THEN excluded.isp ELSE connection_history.isp END,
                    asn=CASE WHEN excluded.asn != '' THEN excluded.asn ELSE connection_history.asn END,
                    accuracy_source=excluded.accuracy_source,
                    domain=CASE WHEN excluded.domain != '' THEN excluded.domain ELSE connection_history.domain END,
                    local_hostname=CASE WHEN excluded.local_hostname != '' THEN excluded.local_hostname ELSE connection_history.local_hostname END,
                    process=CASE WHEN excluded.process != '' THEN excluded.process ELSE connection_history.process END
            """, rows)
            # Mantener base de datos acotada a los 5000 flujos más recientes
            conn.execute("""
                DELETE FROM connection_history
                WHERE id NOT IN (
                    SELECT id FROM connection_history ORDER BY last_seen DESC LIMIT 5000
                )
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[-] Error guardando historial de conexiones en SQLite: {e}")

def query_connection_history_from_sqlite(service_filter=None, device_filter=None, direction_filter=None, search_query=None, hours_filter=None, limit=300):
    """Consulta el historial de conexiones geolocalizadas y el catálogo agrupado por servicios desde SQLite."""
    init_geoip_history_db()
    services_catalog = []
    devices_catalog = []
    connections = []
    summary = {
        "total_records": 0,
        "total_services": 0,
        "total_unique_ips": 0,
        "total_devices": 0
    }
    try:
        limit_val = max(10, min(int(limit or 300), 1000))
    except Exception:
        limit_val = 300

    cutoff_ts = 0.0
    if hours_filter is not None and str(hours_filter).strip() not in ("", "0", "all"):
        try:
            h_val = float(hours_filter)
            if h_val > 0:
                cutoff_ts = time.time() - (h_val * 3600.0)
        except Exception:
            cutoff_ts = 0.0

    with GEOIP_HISTORY_DB_LOCK:
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # 1. Resumen global
            cur.execute("""
                SELECT
                    COUNT(*) AS total_records,
                    COUNT(DISTINCT service) AS total_services,
                    COUNT(DISTINCT remote_ip) AS total_unique_ips,
                    COUNT(DISTINCT local_ip) AS total_devices
                FROM connection_history
            """)
            s_row = cur.fetchone()
            if s_row:
                summary = {
                    "total_records": int(s_row["total_records"] or 0),
                    "total_services": int(s_row["total_services"] or 0),
                    "total_unique_ips": int(s_row["total_unique_ips"] or 0),
                    "total_devices": int(s_row["total_devices"] or 0)
                }

            # 2. Catálogo de servicios agregados (filtrado por dispositivo/tiempo si aplica)
            svc_where = []
            svc_params = []
            if cutoff_ts > 0:
                svc_where.append("last_seen >= ?")
                svc_params.append(cutoff_ts)
            if device_filter and str(device_filter).strip().lower() not in ("", "all", "todos"):
                svc_where.append("local_ip = ?")
                svc_params.append(str(device_filter).strip())
            svc_where_sql = ("WHERE " + " AND ".join(svc_where)) if svc_where else ""

            cur.execute(f"""
                SELECT
                    service,
                    COUNT(*) AS connections_count,
                    SUM(hit_count) AS total_hits,
                    COUNT(DISTINCT remote_ip) AS unique_ips,
                    COUNT(DISTINCT local_ip) AS unique_devices,
                    GROUP_CONCAT(DISTINCT CASE WHEN country != '' THEN country ELSE NULL END) AS countries_csv,
                    GROUP_CONCAT(DISTINCT CASE WHEN domain != '' THEN domain ELSE NULL END) AS domains_csv,
                    MIN(first_seen) AS first_seen,
                    MAX(last_seen) AS last_seen
                FROM connection_history
                {svc_where_sql}
                GROUP BY service
                ORDER BY last_seen DESC, total_hits DESC
                LIMIT 120
            """, svc_params)
            for r in cur.fetchall():
                countries_list = [x.strip() for x in str(r["countries_csv"] or "").split(",") if x.strip()][:5]
                domains_list = [x.strip() for x in str(r["domains_csv"] or "").split(",") if x.strip()][:4]
                services_catalog.append({
                    "service": str(r["service"] or "Desconocido"),
                    "connections_count": int(r["connections_count"] or 0),
                    "total_hits": int(r["total_hits"] or 0),
                    "unique_ips": int(r["unique_ips"] or 0),
                    "unique_devices": int(r["unique_devices"] or 0),
                    "countries": countries_list,
                    "sample_domains": domains_list,
                    "first_seen": float(r["first_seen"] or 0),
                    "last_seen": float(r["last_seen"] or 0)
                })

            # 3. Catálogo de dispositivos locales en el historial
            cur.execute("""
                SELECT
                    local_ip,
                    MAX(local_hostname) AS local_hostname,
                    COUNT(*) AS connections_count,
                    COUNT(DISTINCT service) AS services_count,
                    MAX(last_seen) AS last_seen
                FROM connection_history
                WHERE local_ip != ''
                GROUP BY local_ip
                ORDER BY connections_count DESC, last_seen DESC
                LIMIT 60
            """)
            for r in cur.fetchall():
                devices_catalog.append({
                    "ip": str(r["local_ip"] or ""),
                    "name": str(r["local_hostname"] or r["local_ip"] or ""),
                    "connections_count": int(r["connections_count"] or 0),
                    "services_count": int(r["services_count"] or 0),
                    "last_seen": float(r["last_seen"] or 0)
                })

            # 4. Consulta filtrada de conexiones históricas
            where_clauses = []
            params = []
            if cutoff_ts > 0:
                where_clauses.append("last_seen >= ?")
                params.append(cutoff_ts)
            if service_filter and str(service_filter).strip().lower() not in ("", "all", "todos"):
                where_clauses.append("service = ?")
                params.append(str(service_filter).strip())
            if device_filter and str(device_filter).strip().lower() not in ("", "all", "todos"):
                where_clauses.append("local_ip = ?")
                params.append(str(device_filter).strip())
            if direction_filter and str(direction_filter).strip().lower() not in ("", "all", "todas"):
                if direction_filter == "devices":
                    where_clauses.append("local_ip NOT IN (?, '127.0.0.1', '::1')")
                    params.append(SERVER_LOCAL_IP)
                else:
                    where_clauses.append("direction = ?")
                    params.append(str(direction_filter).strip())
            if search_query and str(search_query).strip():
                q_like = f"%{str(search_query).strip()}%"
                where_clauses.append("(service LIKE ? OR domain LIKE ? OR remote_ip LIKE ? OR city LIKE ? OR country LIKE ? OR isp LIKE ? OR local_hostname LIKE ?)")
                params.extend([q_like] * 7)

            where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
            cur.execute(f"""
                SELECT *
                FROM connection_history
                {where_sql}
                ORDER BY last_seen DESC
                LIMIT ?
            """, params + [limit_val])

            for r in cur.fetchall():
                loc_parts = [p for p in (r["city"], r["region"], r["postal"]) if p]
                precise_city = f"{r['city']} ({r['region']}{' · CP ' + r['postal'] if r['postal'] else ''})" if (r["region"] or r["postal"]) and r["city"] else (r["city"] or "Nodo Remoto")
                connections.append({
                    "id": f"hist_{r['id']}",
                    "direction": str(r["direction"] or "outgoing"),
                    "protocol": str(r["protocol"] or "TCP"),
                    "local_ip": str(r["local_ip"] or SERVER_LOCAL_IP),
                    "local_hostname": str(r["local_hostname"] or "Servidor"),
                    "local_port": int(r["local_port"] or 0),
                    "remote_ip": str(r["remote_ip"] or ""),
                    "remote_port": int(r["remote_port"] or 0),
                    "domain": str(r["domain"] or ""),
                    "service": str(r["service"] or "Servicio"),
                    "process": str(r["process"] or ""),
                    "jail": str(r["jail"] or "caddy-scan"),
                    "state": f"HISTORIAL ({int(r['hit_count'] or 1)}x)",
                    "details": f"Servicio: {r['service']} · Registrado {int(r['hit_count'] or 1)} veces · Precisión: {r['accuracy_source'] or 'ip-api'}",
                    "lat": float(r["lat"]),
                    "lng": float(r["lng"]),
                    "city": precise_city,
                    "raw_city": str(r["city"] or ""),
                    "region": str(r["region"] or ""),
                    "postal": str(r["postal"] or ""),
                    "country": str(r["country"] or ""),
                    "country_code": str(r["country_code"] or ""),
                    "isp": str(r["isp"] or ""),
                    "asn": str(r["asn"] or ""),
                    "accuracy_source": str(r["accuracy_source"] or "ip-api"),
                    "first_seen": float(r["first_seen"] or 0),
                    "last_seen": float(r["last_seen"] or 0),
                    "hit_count": int(r["hit_count"] or 1),
                    "is_lan": False,
                    "is_history": True,
                    "geo_status": "cached"
                })
            conn.close()
        except Exception as e:
            print(f"[-] Error consultando historial SQLite: {e}")

    return {
        "status": "ok",
        "summary": summary,
        "services_catalog": services_catalog,
        "devices_catalog": devices_catalog,
        "connections": connections
    }

def clear_connection_history_sqlite():
    """Vacía el historial de conexiones en SQLite manteniendo la caché de ubicaciones GeoIP."""
    init_geoip_history_db()
    with GEOIP_HISTORY_DB_LOCK:
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.execute("DELETE FROM connection_history;")
            conn.commit()
            conn.close()
            return True
        except Exception:
            return False

def load_geoip_disk_cache():
    """Carga la caché persistente de GeoIP desde SQLite y disco al iniciar el worker."""
    global GEOIP_CACHE, SERVER_SELF_GEO
    init_geoip_history_db()
    now = time.time()
    cutoff = now - GEOIP_TTL_SECONDS
    loaded = {}

    # 1. Cargar ubicaciones exactas desde SQLite geoip_locations
    with GEOIP_HISTORY_DB_LOCK:
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM geoip_locations WHERE updated_at >= ?", (cutoff,))
            for r in cur.fetchall():
                ip_k = str(r["ip"] or "").strip()
                if ip_k:
                    loaded[ip_k] = {
                        "ip": ip_k,
                        "lat": float(r["lat"]),
                        "lng": float(r["lng"]),
                        "city": str(r["city"] or "Nodo Remoto"),
                        "region": str(r["region"] or ""),
                        "postal": str(r["postal"] or ""),
                        "country": str(r["country"] or ""),
                        "country_code": str(r["country_code"] or ""),
                        "isp": str(r["isp"] or ""),
                        "asn": str(r["asn"] or ""),
                        "accuracy_source": str(r["accuracy_source"] or "ip-api"),
                        "ts": float(r["updated_at"] or now)
                    }
            conn.close()
        except Exception:
            pass

    # 2. Complementar con archivo JSON si existe
    if os.path.exists(GEOIP_CACHE_FILE):
        try:
            with open(GEOIP_CACHE_FILE, "r", encoding="utf-8", errors="ignore") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                entries = raw.get("entries", raw) if isinstance(raw.get("entries"), dict) else raw
                for ip_k, val in entries.items():
                    if str(ip_k) not in loaded and isinstance(val, dict) and isinstance(val.get("lat"), (int, float)) and isinstance(val.get("lng"), (int, float)):
                        ts = float(val.get("ts", now))
                        if ts >= cutoff:
                            loaded[str(ip_k)] = {
                                "ip": str(ip_k),
                                "lat": float(val["lat"]),
                                "lng": float(val["lng"]),
                                "city": str(val.get("city") or "Nodo Remoto"),
                                "region": str(val.get("region") or ""),
                                "postal": str(val.get("postal") or ""),
                                "country": str(val.get("country") or ""),
                                "country_code": str(val.get("country_code") or ""),
                                "isp": str(val.get("isp") or ""),
                                "asn": str(val.get("asn") or ""),
                                "accuracy_source": str(val.get("accuracy_source") or "ip-api"),
                                "ts": ts
                            }
        except Exception:
            pass

    with GEOIP_LOCK:
        GEOIP_CACHE.update(loaded)
        SERVER_SELF_GEO = {}
        SERVER_SELF_GEO["lat"] = float(os.environ.get("SERVER_GEO_LAT", 27.9600))
        SERVER_SELF_GEO["lng"] = float(os.environ.get("SERVER_GEO_LNG", -15.5800))
        SERVER_SELF_GEO["city"] = os.environ.get("SERVER_GEO_CITY", "Gran Canaria (Centro)")
        SERVER_SELF_GEO["country"] = os.environ.get("SERVER_GEO_COUNTRY", "España")
        SERVER_SELF_GEO["country_code"] = "ES"

    if loaded:
        save_geoip_locations_to_sqlite(loaded)

def save_geoip_disk_cache(force=False):
    """Persiste de forma atómica la caché GeoIP en disco y SQLite para reducir carga sobre ip-api.com tras reinicios."""
    now = time.time()
    with GEOIP_LOCK:
        if not force and not GEOIP_WORKER_STATS["dirty_disk"]:
            return
        if not force and (now - GEOIP_WORKER_STATS["last_disk_save_ts"] < 15.0):
            return
        if len(GEOIP_CACHE) > GEOIP_MAX_CACHE_ENTRIES:
            sorted_keys = sorted(GEOIP_CACHE.keys(), key=lambda k: GEOIP_CACHE[k].get("ts", 0), reverse=True)
            keep_keys = set(sorted_keys[:GEOIP_MAX_CACHE_ENTRIES])
            for k in list(GEOIP_CACHE.keys()):
                if k not in keep_keys:
                    del GEOIP_CACHE[k]
        entries_copy = dict(GEOIP_CACHE)
        snapshot = {
            "updated_at": now,
            "server_self_geo": dict(SERVER_SELF_GEO) if SERVER_SELF_GEO else {},
            "entries": entries_copy
        }
        GEOIP_WORKER_STATS["dirty_disk"] = False
        GEOIP_WORKER_STATS["last_disk_save_ts"] = now

    save_geoip_locations_to_sqlite(entries_copy)
    try:
        tmp_path = GEOIP_CACHE_FILE + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False)
        os.replace(tmp_path, GEOIP_CACHE_FILE)
    except Exception:
        pass

def get_geoip_worker_summary():
    with GEOIP_LOCK:
        hits = GEOIP_WORKER_STATS["cache_hits"]
        misses = GEOIP_WORKER_STATS["cache_misses"]
        total_lookups = hits + misses
        hit_rate = round((hits / total_lookups) * 100.0, 1) if total_lookups > 0 else 100.0
        return {
            "status": GEOIP_WORKER_STATS["status"],
            "cached_ips": len(GEOIP_CACHE),
            "cache_hits": hits,
            "cache_misses": misses,
            "hit_rate_pct": hit_rate,
            "api_batches_sent": GEOIP_WORKER_STATS["api_batches_sent"],
            "api_ips_resolved": GEOIP_WORKER_STATS["api_ips_resolved"],
            "pending_queue": len(GEOIP_PENDING_QUEUE),
            "rate_limit_remaining": GEOIP_WORKER_STATS["rate_limit_remaining"],
            "last_sync": GEOIP_WORKER_STATS["last_sync_str"],
            "errors_count": len(GEOIP_ERROR_HISTORY),
            "error_history": list(GEOIP_ERROR_HISTORY[:40])
        }

def enqueue_remote_ips_for_geoip(ips_iterable):
    """Encola direcciones IP remotas públicas para resolución asíncrona en segundo plano."""
    now = time.time()
    added = False
    with GEOIP_LOCK:
        for raw_ip in ips_iterable:
            ip_s = str(raw_ip or "").strip().replace("::ffff:", "")
            if not ip_s or _is_private_ip(ip_s):
                continue
            if ip_s in GEOIP_CACHE:
                continue
            neg_ts = GEOIP_NEGATIVE_CACHE.get(ip_s, 0)
            if now - neg_ts < GEOIP_NEG_TTL_SECONDS:
                continue
            if ip_s not in GEOIP_PENDING_QUEUE:
                GEOIP_PENDING_QUEUE.add(ip_s)
                added = True
    if added:
        GEOIP_WAKE_EVENT.set()

def _enrich_ip_precision_with_ipwhois(ip_s, base_entry=None):
    """Refina las coordenadas y localidad de una IP usando ipwho.is como segundo proveedor de alta precisión."""
    try:
        req = urllib.request.Request(
            f"https://ipwho.is/{ip_s}",
            headers={"User-Agent": "RecursosDashboard-GeoIPWorker/6.3"},
            method="GET"
        )
        with urllib.request.urlopen(req, timeout=2.2) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if not isinstance(data, dict) or not data.get("success", False):
            return base_entry
        lat = data.get("latitude")
        lng = data.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return base_entry
        conn_info = data.get("connection") if isinstance(data.get("connection"), dict) else {}
        city = str(data.get("city") or (base_entry or {}).get("city") or "Nodo Remoto")
        region = str(data.get("region") or (base_entry or {}).get("region") or "")
        postal = str(data.get("postal") or (base_entry or {}).get("postal") or "")
        country = str(data.get("country") or (base_entry or {}).get("country") or "")
        country_code = str(data.get("country_code") or (base_entry or {}).get("country_code") or "")
        isp = str(conn_info.get("org") or conn_info.get("isp") or (base_entry or {}).get("isp") or "")
        asn_num = conn_info.get("asn")
        asn = f"AS{asn_num}" if asn_num else str((base_entry or {}).get("asn") or "")
        # Promediar coordenadas si ambos proveedores coinciden en país para mayor exactitud sub-urbana, o usar ipwho.is si base_entry no tenía postal
        if base_entry and isinstance(base_entry.get("lat"), (int, float)) and isinstance(base_entry.get("lng"), (int, float)):
            if abs(float(base_entry["lat"]) - float(lat)) < 1.5 and abs(float(base_entry["lng"]) - float(lng)) < 1.5:
                lat = round((float(base_entry["lat"]) + float(lat)) / 2.0, 5)
                lng = round((float(base_entry["lng"]) + float(lng)) / 2.0, 5)
            acc_src = "ip-api+ipwho.is"
        else:
            acc_src = "ipwho.is"
        return {
            "ip": ip_s,
            "lat": float(lat),
            "lng": float(lng),
            "city": city,
            "region": region,
            "postal": postal,
            "country": country,
            "country_code": country_code,
            "isp": isp,
            "asn": asn,
            "accuracy_source": acc_src,
            "ts": time.time()
        }
    except Exception:
        return base_entry

def resolve_geoip_batch_from_ip_api(ip_list):
    """Consulta ip-api.com en lote (con código postal y región) y refina con ipwho.is para ubicaciones más exactas, persistiendo en SQLite."""
    now = time.time()
    clean_ips = []
    with GEOIP_LOCK:
        if now < GEOIP_WORKER_STATS["rate_limit_reset_ts"] and GEOIP_WORKER_STATS["rate_limit_remaining"] <= 1:
            return {}
        for ip_s in ip_list:
            if not ip_s or _is_private_ip(ip_s):
                continue
            if ip_s in GEOIP_CACHE:
                continue
            if now - GEOIP_NEGATIVE_CACHE.get(ip_s, 0) < GEOIP_NEG_TTL_SECONDS:
                continue
            if ip_s not in clean_ips:
                clean_ips.append(ip_s)

    if not clean_ips:
        return {}

    batch_slice = clean_ips[:80]
    resolved_now = {}
    try:
        with GEOIP_LOCK:
            GEOIP_WORKER_STATS["status"] = "resolving"
        batch_payload = json.dumps(batch_slice).encode("utf-8")
        req = urllib.request.Request(
            "http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,district,zip,lat,lon,isp,org,as,query",
            data=batch_payload,
            headers={"Content-Type": "application/json", "User-Agent": "RecursosDashboard-GeoIPWorker/6.3"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            rl_rem = resp.headers.get("X-Rl")
            rl_ttl = resp.headers.get("X-Ttl")
            b_res = json.loads(resp.read().decode("utf-8", errors="ignore"))

            preliminary_entries = {}
            failed_ips = []
            with GEOIP_LOCK:
                GEOIP_WORKER_STATS["api_batches_sent"] += 1
                GEOIP_WORKER_STATS["last_sync_ts"] = time.time()
                GEOIP_WORKER_STATS["last_sync_str"] = datetime.now().strftime("%H:%M:%S")
                if rl_rem is not None and str(rl_rem).isdigit():
                    GEOIP_WORKER_STATS["rate_limit_remaining"] = int(rl_rem)
                if rl_ttl is not None and str(rl_ttl).isdigit() and GEOIP_WORKER_STATS["rate_limit_remaining"] <= 2:
                    GEOIP_WORKER_STATS["rate_limit_reset_ts"] = time.time() + int(rl_ttl) + 1

                if isinstance(b_res, list):
                    seen_queries = set()
                    for item in b_res:
                        if not isinstance(item, dict):
                            continue
                        q_ip = str(item.get("query", "")).strip()
                        if not q_ip:
                            continue
                        seen_queries.add(q_ip)
                        GEOIP_PENDING_QUEUE.discard(q_ip)
                        if item.get("status") == "success" and isinstance(item.get("lat"), (int, float)) and isinstance(item.get("lon"), (int, float)):
                            raw_city = str(item.get("city") or "Nodo Remoto")
                            district = str(item.get("district") or "").strip()
                            city_with_district = f"{raw_city} · {district}" if (district and district.lower() not in raw_city.lower()) else raw_city
                            entry = {
                                "ip": q_ip,
                                "lat": float(item["lat"]),
                                "lng": float(item["lon"]),
                                "city": city_with_district,
                                "region": str(item.get("regionName") or ""),
                                "postal": str(item.get("zip") or ""),
                                "country": str(item.get("country") or ""),
                                "country_code": str(item.get("countryCode") or ""),
                                "isp": str(item.get("org") or item.get("isp") or ""),
                                "asn": str(item.get("as") or ""),
                                "accuracy_source": "ip-api",
                                "ts": time.time()
                            }
                            preliminary_entries[q_ip] = entry
                        else:
                            failed_ips.append((q_ip, str(item.get("message") or "IP no resoluble por ip-api.com")))

                    for req_ip in batch_slice:
                        if req_ip not in seen_queries:
                            GEOIP_PENDING_QUEUE.discard(req_ip)
                            failed_ips.append((req_ip, "Sin respuesta en lote GeoIP"))

            # Refinar precisión en hasta 4 IPs por ciclo (cuando falta código postal o ciudad exacta) y recuperar fallos con ipwho.is
            refinement_budget = 4
            for q_ip, entry in preliminary_entries.items():
                if refinement_budget > 0 and (not entry.get("postal") or entry.get("city") in ("", "Nodo Remoto")):
                    refinement_budget -= 1
                    entry = _enrich_ip_precision_with_ipwhois(q_ip, entry) or entry
                with GEOIP_LOCK:
                    GEOIP_CACHE[q_ip] = entry
                    GEOIP_NEGATIVE_CACHE.pop(q_ip, None)
                    resolved_now[q_ip] = entry
                    GEOIP_WORKER_STATS["api_ips_resolved"] += 1
                    GEOIP_WORKER_STATS["dirty_disk"] = True

            for f_ip, fail_msg in failed_ips:
                fallback_entry = None
                if refinement_budget > 0:
                    refinement_budget -= 1
                    fallback_entry = _enrich_ip_precision_with_ipwhois(f_ip, None)
                with GEOIP_LOCK:
                    if fallback_entry:
                        GEOIP_CACHE[f_ip] = fallback_entry
                        GEOIP_NEGATIVE_CACHE.pop(f_ip, None)
                        resolved_now[f_ip] = fallback_entry
                        GEOIP_WORKER_STATS["api_ips_resolved"] += 1
                        GEOIP_WORKER_STATS["dirty_disk"] = True
                    else:
                        GEOIP_NEGATIVE_CACHE[f_ip] = time.time()
                        record_geoip_worker_error("GEOIP_WORKER", "ip-api.com/batch", f_ip, "GEOIP_FAIL", f"Fallo al geolocalizar IP {f_ip}: {fail_msg}")
    except urllib.error.HTTPError as he:
        with GEOIP_LOCK:
            if he.code == 429:
                GEOIP_WORKER_STATS["rate_limit_remaining"] = 0
                GEOIP_WORKER_STATS["rate_limit_reset_ts"] = time.time() + 62.0
        record_geoip_worker_error(
            "GEOIP_WORKER",
            "ip-api.com/batch",
            f"Lote ({len(batch_slice)} IPs)",
            f"HTTP {he.code}",
            f"Error HTTP {he.code} ({getattr(he, 'reason', 'HTTPError')}) al consultar ip-api.com/batch"
        )
    except Exception as ex:
        record_geoip_worker_error(
            "GEOIP_WORKER",
            "ip-api.com/batch",
            f"Lote ({len(batch_slice)} IPs)",
            "NET_ERR",
            f"Excepción de red en Worker GeoIP: {str(ex)}"
        )
    finally:
        with GEOIP_LOCK:
            GEOIP_WORKER_STATS["status"] = "active"

    if resolved_now:
        save_geoip_locations_to_sqlite(resolved_now)
        save_geoip_disk_cache(force=False)
    return resolved_now

class PiholeDnsTranslator:
    """Traduce en tiempo real IPs locales (a nombres de host amigables)
    e IPs remotas WAN (a nombres de dominio resueltos) consultando Pi-hole
    (custom.list, pihole-FTL.db, /var/log/pihole/pihole.log) y rDNS con caché O(1)."""
    def __init__(self):
        self.local_cache = {}
        self.last_local_refresh = 0.0
        self.ext_cache = {}         # { ip: domain_lower }
        self.dom_to_ip_cache = {}   # { domain_lower: ip } -> Índice inverso O(1)
        self.ext_log_offset = 0
        self.ext_log_inode = None
        self.last_ext_refresh = 0.0
        self.rdns_cache = {}
        self.rdns_negative = {}
        self.fwd_dns_negative = {}  # { domain_lower: ts_failed }
        self.flows_cache = []
        self.last_flows_refresh = 0.0

    def refresh_local_names(self):
        now = time.time()
        if now - self.last_local_refresh < 45.0 and self.local_cache:
            return
        self.last_local_refresh = now
        new_map = {}

        # 1. /etc/pihole/custom.list (nombres manuales y sincronizados)
        cpath = "/etc/pihole/custom.list"
        if os.path.exists(cpath):
            try:
                with open(cpath, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split()
                        if len(parts) >= 2:
                            ip = parts[0].strip()
                            names = parts[1:]
                            clean_names = [n for n in names if not n.endswith(".duckdns.org")]
                            chosen = clean_names[-1] if clean_names else names[0]
                            new_map[ip] = chosen
            except Exception:
                pass

        # 2. /etc/pihole/pihole-FTL.db (arrendamientos DHCP dinámicos)
        dbpath = "/etc/pihole/pihole-FTL.db"
        if os.path.exists(dbpath):
            try:
                con = sqlite3.connect(f"file:{dbpath}?mode=ro", uri=True, timeout=1.0)
                cur = con.cursor()
                cur.execute("SELECT ip, name FROM network_addresses WHERE name IS NOT NULL AND name != ''")
                for ip, name in cur.fetchall():
                    ip = ip.strip()
                    name = name.strip()
                    if ip and name and ip not in new_map:
                        new_map[ip] = name
                con.close()
            except Exception:
                pass

        # 3. /etc/hosts
        hpath = "/etc/hosts"
        if os.path.exists(hpath):
            try:
                with open(hpath, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split()
                        if len(parts) >= 2:
                            ip = parts[0].strip()
                            if ip not in new_map and not ip.startswith("127."):
                                new_map[ip] = parts[1].strip()
            except Exception:
                pass

        if new_map:
            self.local_cache = new_map

    def refresh_external_domains(self):
        lpath = "/var/log/pihole/pihole.log"
        if not os.path.exists(lpath):
            return
        try:
            st = os.stat(lpath)
            curr_inode = getattr(st, "st_ino", 0)
            curr_size = st.st_size

            # Manejar rotación de log o lectura inicial
            if self.ext_log_inode != curr_inode or curr_size < self.ext_log_offset:
                self.ext_log_inode = curr_inode
                # En la primera ejecución leer los últimos 3 MB para tener historial inmediato
                self.ext_log_offset = max(0, curr_size - 3_000_000)

            if curr_size == self.ext_log_offset:
                return

            with open(lpath, "r", encoding="utf-8", errors="ignore") as f:
                f.seek(self.ext_log_offset)
                chunk = f.read()
                self.ext_log_offset = f.tell()

            if chunk:
                # Patrones de respuesta de dnsmasq en Pi-hole con regex precompilada
                for dom, ip in RE_PIHOLE_LOG_REPLY.findall(chunk):
                    if not _is_private_ip(ip):
                        d_low = dom.lower()
                        self.ext_cache[ip] = d_low
                        self.dom_to_ip_cache[d_low] = ip

            # Evitar crecimiento ilimitado de memoria
            if len(self.ext_cache) > 25000:
                keys = list(self.ext_cache.keys())
                for k in keys[:5000]:
                    old_dom = self.ext_cache.pop(k, None)
                    if old_dom and self.dom_to_ip_cache.get(old_dom) == k:
                        self.dom_to_ip_cache.pop(old_dom, None)
        except Exception:
            pass

    def translate_local(self, ip, server_ip=None):
        if not ip:
            return ""
        if server_ip and ip == server_ip:
            return "Servidor"
        return self.local_cache.get(ip, "")

    def translate_external(self, ip, rdns_budget=None):
        if not ip or _is_private_ip(ip):
            return ""
        dom = self.ext_cache.get(ip)
        if dom:
            return dom
        now = time.time()
        if ip in self.rdns_cache:
            dom_cached, exp = self.rdns_cache[ip]
            if now < exp:
                return dom_cached
            else:
                del self.rdns_cache[ip]
        if ip in self.rdns_negative and (now - self.rdns_negative[ip] < 1800):
            return ""
        if rdns_budget is not None:
            if rdns_budget[0] <= 0:
                return ""
            rdns_budget[0] -= 1
        try:
            name, _, _ = socket.gethostbyaddr(ip)
            if name and name != ip:
                self.rdns_cache[ip] = (name, now + 21600)
                return name
        except Exception:
            self.rdns_negative[ip] = now
        return ""

    def fetch_active_device_flows(self, cutoff_seconds=900, max_entries=50):
        """Extrae de Pi-hole las consultas DNS externas recientes realizadas por
        otros dispositivos del hogar usando índice inverso O(1) y caché temporal de 12s."""
        now = time.time()
        if (now - self.last_flows_refresh < 12.0) and self.flows_cache:
            return list(self.flows_cache[:max_entries])

        dbpath = "/etc/pihole/pihole-FTL.db"
        if not os.path.exists(dbpath):
            return []
        cutoff = int(now) - cutoff_seconds
        flows = []
        sync_dns_budget = 4  # Máximo 4 resoluciones DNS síncronas nuevas por ciclo
        try:
            con = sqlite3.connect(f"file:{dbpath}?mode=ro", uri=True, timeout=1.0)
            cur = con.cursor()
            cur.execute("""
                SELECT timestamp, domain, client 
                FROM queries 
                WHERE timestamp > ? 
                  AND client NOT IN ('127.0.0.1', '::1', '192.168.50.2')
                  AND status IN (1, 2, 3, 14, 17)
                ORDER BY timestamp DESC
                LIMIT 160
            """, (cutoff,))
            seen = set()
            for ts, dom, client in cur.fetchall():
                if not dom:
                    continue
                d_low = dom.lower()
                if d_low.endswith((".local", ".lan", ".arpa")):
                    continue
                key = (client, d_low)
                if key in seen:
                    continue
                seen.add(key)

                # Búsqueda O(1) en índice inverso dom_to_ip_cache
                ext_ip = self.dom_to_ip_cache.get(d_low)
                if not ext_ip and sync_dns_budget > 0:
                    neg_ts = self.fwd_dns_negative.get(d_low, 0.0)
                    if now - neg_ts >= 900.0:
                        sync_dns_budget -= 1
                        try:
                            ext_ip = socket.gethostbyname(dom)
                            if ext_ip and not _is_private_ip(ext_ip):
                                self.ext_cache[ext_ip] = d_low
                                self.dom_to_ip_cache[d_low] = ext_ip
                            else:
                                self.fwd_dns_negative[d_low] = now
                        except Exception:
                            self.fwd_dns_negative[d_low] = now

                if ext_ip and not _is_private_ip(ext_ip):
                    loc_name = self.translate_local(client) or f"Dispositivo {client}"
                    flows.append({
                        "client_ip": client,
                        "client_name": loc_name,
                        "domain": dom,
                        "remote_ip": ext_ip,
                        "timestamp": ts
                    })
                    if len(flows) >= max_entries:
                        break
            con.close()
            self.flows_cache = flows
            self.last_flows_refresh = now
        except Exception:
            pass
        return flows

def fetch_connections_geo_worker():
    global CONNECTIONS_MAP_CACHE, SERVER_SELF_GEO
    load_geoip_disk_cache()
    pihole_translator = PiholeDnsTranslator()
    resolved_outbound_hosts = {}
    outbound_targets = [
        ("api.github.com", 443, "TCP", "GitHub OTA Sync (api.github.com)"),
        ("maps.googleapis.com", 443, "TCP", "Google Maps Platform API"),
        ("cdn.simpleicons.org", 443, "TCP", "SimpleIcons Hardware CDN"),
        ("one.one.one.one", 53, "UDP", "Cloudflare DNS Upstream (1.1.1.1)"),
        ("dns.google", 53, "UDP", "Google Public DNS Upstream (8.8.8.8)")
    ]
    while True:
        try:
            now = time.time()
            # 0. Actualizar traductor de DNS de Pi-hole (nombres locales y dominios externos)
            pihole_translator.refresh_local_names()
            pihole_translator.refresh_external_domains()
            # 1. Resolve server's own public WAN IP & GeoIP once or every 30 min
            if not SERVER_SELF_GEO or (now - SERVER_SELF_GEO.get("ts", 0) > 1800):
                try:
                    req = urllib.request.Request(
                        "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,isp,org,as,query",
                        headers={"User-Agent": "RecursosDashboard-GeoIPWorker/4.4"}
                    )
                    with urllib.request.urlopen(req, timeout=3.0) as resp:
                        sdata = json.loads(resp.read().decode("utf-8", errors="ignore"))
                        if sdata.get("status") == "success":
                            with GEOIP_LOCK:
                                SERVER_SELF_GEO = {
                                    "ip": sdata.get("query") or SERVER_LOCAL_IP,
                                    "lat": float(os.environ.get("SERVER_GEO_LAT", 27.9600)),
                                    "lng": float(os.environ.get("SERVER_GEO_LNG", -15.5800)),
                                    "city": os.environ.get("SERVER_GEO_CITY", "Gran Canaria (Centro)"),
                                    "country": sdata.get("country") or "España",
                                    "country_code": sdata.get("countryCode") or "ES",
                                    "org": sdata.get("org") or sdata.get("isp") or HOSTNAME,
                                    "ts": now
                                }
                                GEOIP_WORKER_STATS["dirty_disk"] = True
                        else:
                            record_geoip_worker_error(
                                "GEOIP_WORKER",
                                "ip-api.com/json",
                                SERVER_LOCAL_IP,
                                "SELF_GEO_FAIL",
                                f"Fallo al consultar IP WAN propia: {sdata.get('message', 'status!=success')}"
                            )
                except Exception as self_ex:
                    record_geoip_worker_error(
                        "GEOIP_WORKER",
                        "ip-api.com/json",
                        "WAN Self-IP",
                        "NET_ERR",
                        f"Error de red al resolver IP pública del nodo: {str(self_ex)}"
                    )

            # 2. Resolve active DNS outbound targets
            for host_name, port_num, proto_str, svc_label in outbound_targets:
                if host_name not in resolved_outbound_hosts:
                    try:
                        resolved_ip = socket.gethostbyname(host_name)
                        if resolved_ip:
                            resolved_outbound_hosts[host_name] = {
                                "host": host_name,
                                "ip": resolved_ip,
                                "port": port_num,
                                "protocol": proto_str,
                                "service": svc_label
                            }
                    except Exception as dns_ex:
                        record_geoip_worker_error(
                            "NET_REQUEST",
                            "DNS Lookup",
                            host_name,
                            "DNS_ERR",
                            f"No se pudo resolver el host saliente {host_name}: {str(dns_ex)}"
                        )

            # 3. Inspect active kernel sockets via psutil.net_connections
            listening_map = update_listening_ports_map()
            listening_ports = set(listening_map.keys()) | {22, 53, 80, 443, 2283, 3000, 8080, 8082, 8085, 8088, 8089, 8096, 8123, 8550, 8884, 9000, 9980, 11434, 18554, 18555, 32400, 51820}
            raw_sockets = []
            pid_proc_cache = {}
            rdns_budget = [6]  # Límite por ciclo para evitar bloqueos por rDNS síncrono
            try:
                conns = psutil.net_connections(kind="inet")
                for c in conns:
                    if c.status == "LISTEN" and c.laddr:
                        listening_ports.add(c.laddr.port)
                seen_keys = set()
                for c in conns:
                    if c.status == "LISTEN" or not c.raddr or not c.laddr:
                        continue
                    rem_ip = c.raddr.ip.replace("::ffff:", "")
                    loc_ip = c.laddr.ip.replace("::ffff:", "")
                    rem_port = c.raddr.port
                    loc_port = c.laddr.port
                    if not rem_ip or rem_ip in ("0.0.0.0", "127.0.0.1", "::1") or rem_ip.startswith("127."):
                        continue
                    proto_str = "TCP" if c.type == socket.SOCK_STREAM else "UDP"
                    is_in = (loc_port in listening_ports) or (loc_port < 10000 and rem_port > 10000)
                    direction = "incoming" if is_in else "outgoing"
                    dedup_key = f"{direction}:{rem_ip}:{loc_port if is_in else rem_port}"
                    if dedup_key in seen_keys:
                        continue
                    seen_keys.add(dedup_key)

                    proc_name = ""
                    if c.pid:
                        if c.pid in pid_proc_cache:
                            proc_name = pid_proc_cache[c.pid]
                        else:
                            try:
                                proc_name = psutil.Process(c.pid).name()
                            except Exception:
                                proc_name = ""
                            pid_proc_cache[c.pid] = proc_name
                    if not proc_name:
                        if is_in and loc_port in listening_map:
                            proc_name = listening_map[loc_port].get("proc", "")
                        elif not is_in and rem_port in listening_map:
                            proc_name = listening_map[rem_port].get("proc", "")

                    container_hint = ""
                    if "docker" in proc_name.lower():
                        if loc_port == 8089 or rem_port == 8089:
                            container_hint = "Nextcloud Hub"
                        elif loc_port == 2283 or rem_port == 2283:
                            container_hint = "Immich Photo Server"
                        elif loc_port == 8884 or rem_port == 8884:
                            container_hint = "Tesseract OCR"
                        elif loc_port == 3000 or rem_port == 3000:
                            container_hint = "Panel Recursos Web / NodeODM"
                        elif loc_port == 9980 or rem_port == 9980:
                            container_hint = "Collabora Online"

                    if is_in:
                        svc_port = loc_port
                        base_svc = PORT_SERVICE_LABELS.get(svc_port)
                        if container_hint:
                            svc_label = f"{container_hint} (:{svc_port})"
                        elif base_svc:
                            svc_label = base_svc
                        elif proc_name:
                            svc_label = f"{proc_name.capitalize()} (:{svc_port})"
                        else:
                            svc_label = f"{proto_str} Puerto :{svc_port}"
                        if svc_port == 22:
                            suggested_jail = "sshd"
                        elif svc_port in (80, 443):
                            suggested_jail = "caddy-scan"
                        else:
                            suggested_jail = "nextcloud"
                        details_str = f"Entrante desde {rem_ip} hacia {svc_label}"
                    else:
                        svc_port = rem_port
                        suggested_jail = "caddy-scan"
                        if _is_private_ip(rem_ip):
                            if svc_port == 8009:
                                svc_label = "Google Cast / Chromecast (:8009)"
                            elif svc_port == 5555:
                                svc_label = "Android ADB Remoto (:5555)"
                            elif svc_port == 445:
                                svc_label = "Samba / SMB Red Compartida (:445)"
                            elif svc_port == 1926:
                                svc_label = "Tuya IoT Device (:1926)"
                            elif svc_port == 32034:
                                svc_label = "Plex Companion / Cast (:32034)"
                            elif svc_port == 8096:
                                svc_label = "Emby Media Server (:8096)"
                            elif svc_port == 53:
                                svc_label = "DNS Consulta Interna (:53)"
                            else:
                                svc_label = PORT_SERVICE_LABELS.get(svc_port, f"LAN Servicio :{svc_port}")
                        else:
                            svc_label = PORT_SERVICE_LABELS.get(svc_port, f"{proto_str} Puerto :{svc_port}")
                    norm_loc_ip = loc_ip if loc_ip != "0.0.0.0" else SERVER_LOCAL_IP
                    loc_name = pihole_translator.translate_local(norm_loc_ip, SERVER_LOCAL_IP)
                    ext_dom = pihole_translator.translate_external(rem_ip, rdns_budget)
                    target_label = f"{ext_dom} ({rem_ip})" if ext_dom else rem_ip

                    if is_in:
                        details_str = f"Entrante desde {target_label} hacia {svc_label}"
                    else:
                        p_info = f" desde {proc_name}" if proc_name else ""
                        loc_info = f" ({loc_name})" if loc_name else ""
                        details_str = f"Saliente{p_info}{loc_info} hacia {svc_label} ({target_label})"

                    raw_sockets.append({
                        "direction": direction,
                        "protocol": proto_str,
                        "local_ip": norm_loc_ip,
                        "local_hostname": loc_name,
                        "local_port": loc_port,
                        "remote_ip": rem_ip,
                        "remote_port": rem_port,
                        "domain": ext_dom,
                        "state": c.status or "ACTIVE",
                        "service": svc_label,
                        "process": proc_name,
                        "jail": suggested_jail,
                        "details": details_str
                    })
            except Exception:
                pass

            # 3b. Inspect kernel conntrack flows (public traffic involving home devices & host)
            try:
                ct_proc = subprocess.run(["sudo", "-n", "conntrack", "-L"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2.5)
                if ct_proc.returncode == 0 and ct_proc.stdout:
                    for line in ct_proc.stdout.splitlines():
                        m = RE_CONNTRACK_FLOW.search(line)
                        if not m:
                            continue
                        proto_str = "TCP" if "tcp" in line[:8] else ("UDP" if "udp" in line[:8] else "NET")
                        state_str = "ESTABLISHED" if "ESTABLISHED" in line else ("TIME_WAIT" if "TIME_WAIT" in line else "ACTIVE")
                        s_ip, d_ip, s_port, d_port = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))

                        # Identify public vs private flow
                        if _is_private_ip(s_ip) and not _is_private_ip(d_ip):
                            rem_ip, rem_port = d_ip, d_port
                            loc_ip, loc_port = s_ip, s_port
                            dir_str = "outgoing"
                        elif not _is_private_ip(s_ip) and _is_private_ip(d_ip):
                            rem_ip, rem_port = s_ip, s_port
                            loc_ip, loc_port = d_ip, d_port
                            dir_str = "incoming"
                        else:
                            continue

                        dedup_key = f"{dir_str}:{rem_ip}:{rem_port if dir_str == 'outgoing' else loc_port}"
                        if dedup_key in seen_keys:
                            continue
                        seen_keys.add(dedup_key)

                        target_port = loc_port if dir_str == "incoming" else rem_port
                        svc_label = PORT_SERVICE_LABELS.get(target_port, f"{proto_str} Puerto :{target_port}")

                        loc_name = pihole_translator.translate_local(loc_ip, SERVER_LOCAL_IP)
                        ext_dom = pihole_translator.translate_external(rem_ip, rdns_budget)
                        source_hint = loc_name if loc_name else ("Servidor" if loc_ip == SERVER_LOCAL_IP else f"Dispositivo {loc_ip}")
                        target_info = f"{ext_dom} ({rem_ip})" if ext_dom else rem_ip

                        if dir_str == "incoming":
                            details_str = f"Entrante desde {target_info} hacia {svc_label} ({source_hint})"
                        else:
                            details_str = f"Saliente desde {source_hint} hacia {svc_label} ({target_info})"

                        raw_sockets.append({
                            "direction": dir_str,
                            "protocol": proto_str,
                            "local_ip": loc_ip,
                            "local_hostname": loc_name,
                            "local_port": loc_port,
                            "remote_ip": rem_ip,
                            "remote_port": rem_port,
                            "domain": ext_dom,
                            "state": state_str,
                            "service": svc_label,
                            "process": "Kernel Conntrack",
                            "jail": "caddy-scan",
                            "details": details_str
                        })
            except Exception:
                pass

            # 3c. Inspect active external DNS flows from home LAN devices (Pi-hole)
            try:
                device_flows = pihole_translator.fetch_active_device_flows(cutoff_seconds=900, max_entries=50)
                for df in device_flows:
                    d_client = df["client_ip"]
                    d_name = df["client_name"]
                    d_dom = df["domain"]
                    d_rem_ip = df["remote_ip"]

                    dedup_key = f"outgoing:{d_rem_ip}:{d_client}"
                    if dedup_key in seen_keys:
                        continue
                    seen_keys.add(dedup_key)

                    svc_label = f"{d_dom} (:443)"
                    details_str = f"Saliente desde {d_name} ({d_client}) hacia {d_dom} ({d_rem_ip})"

                    raw_sockets.append({
                        "direction": "outgoing",
                        "protocol": "DNS/TLS",
                        "local_ip": d_client,
                        "local_hostname": d_name,
                        "local_port": 443,
                        "remote_ip": d_rem_ip,
                        "remote_port": 443,
                        "domain": d_dom,
                        "state": "ACTIVE",
                        "service": svc_label,
                        "process": "Pi-hole DNS Flow",
                        "jail": "caddy-scan",
                        "details": details_str
                    })
            except Exception:
                pass

            # 4. Collect Fail2ban banned IPs
            with SECURITY_LOCK:
                f2b_banned = list(SECURITY_CACHE.get("fail2ban", {}).get("banned_details", []))

            # 5. Prune expired GEOIP_CACHE entries (>7 days), negative cache (>15 min), and enforce GEOIP_MAX_ENTRIES
            ttl_cutoff = now - GEOIP_TTL_SECONDS
            neg_cutoff = now - GEOIP_NEG_TTL_SECONDS
            with GEOIP_LOCK:
                for k_ip in list(GEOIP_CACHE.keys()):
                    if GEOIP_CACHE[k_ip].get("ts", 0) < ttl_cutoff:
                        del GEOIP_CACHE[k_ip]
                if len(GEOIP_CACHE) > GEOIP_MAX_ENTRIES:
                    sorted_ips = sorted(GEOIP_CACHE.items(), key=lambda x: x[1].get("ts", 0), reverse=True)
                    keep_ips = {k for k, _ in sorted_ips[:int(GEOIP_MAX_ENTRIES * 0.85)]}
                    for k_ip in list(GEOIP_CACHE.keys()):
                        if k_ip not in keep_ips:
                            del GEOIP_CACHE[k_ip]
                for k_ip in list(GEOIP_NEGATIVE_CACHE.keys()):
                    if GEOIP_NEGATIVE_CACHE[k_ip] < neg_cutoff:
                        del GEOIP_NEGATIVE_CACHE[k_ip]

            # 6. Collect all detected remote public IPs and check cache vs queue
            detected_public_ips = []
            for s in raw_sockets:
                if not _is_private_ip(s["remote_ip"]):
                    detected_public_ips.append(s["remote_ip"])
            for ep in resolved_outbound_hosts.values():
                if not _is_private_ip(ep["ip"]):
                    detected_public_ips.append(ep["ip"])
            for cl_ip in list(RECENT_HTTP_CLIENTS.keys()):
                if not _is_private_ip(cl_ip):
                    detected_public_ips.append(cl_ip)
            for b_item in f2b_banned[:25]:
                b_ip = b_item.get("ip", "")
                if b_ip and not _is_private_ip(b_ip):
                    detected_public_ips.append(b_ip)

            candidate_ips = []
            with GEOIP_LOCK:
                for q_ip in set(detected_public_ips):
                    if q_ip in GEOIP_CACHE:
                        GEOIP_WORKER_STATS["cache_hits"] += 1
                    elif now - GEOIP_NEGATIVE_CACHE.get(q_ip, 0) < GEOIP_NEG_TTL_SECONDS:
                        continue
                    else:
                        GEOIP_WORKER_STATS["cache_misses"] += 1
                        GEOIP_PENDING_QUEUE.add(q_ip)
                candidate_ips = list(GEOIP_PENDING_QUEUE)[:80]

            if candidate_ips:
                resolve_geoip_batch_from_ip_api(candidate_ips)

            srv_lat = SERVER_SELF_GEO.get("lat", 27.9600)
            srv_lng = SERVER_SELF_GEO.get("lng", -15.5800)
            srv_city = SERVER_SELF_GEO.get("city", "Gran Canaria (Centro)")
            srv_country = SERVER_SELF_GEO.get("country", "España")
            srv_cc = SERVER_SELF_GEO.get("country_code", "ES")

            connections_out = []
            pending_idx = 0
            pending_coords_map = {}
            import math
            for s in raw_sockets:
                r_ip = s["remote_ip"]
                if _is_private_ip(r_ip):
                    continue  # El usuario no desea conexiones locales internas en el mapa
                with GEOIP_LOCK:
                    geo = GEOIP_CACHE.get(r_ip)
                if geo:
                    lat, lng = geo["lat"], geo["lng"]
                    raw_city = geo.get("city", "Nodo Remoto")
                    region = geo.get("region", "")
                    postal = geo.get("postal", "")
                    city = f"{raw_city} ({region}{' · CP ' + postal if postal else ''})" if (region or postal) and raw_city else raw_city
                    country, cc = geo["country"], geo["country_code"]
                    isp, asn = geo["isp"], geo["asn"]
                    acc_src = geo.get("accuracy_source", "ip-api")
                    geo_status = "cached"
                else:
                    if r_ip in pending_coords_map:
                        lat, lng = pending_coords_map[r_ip]
                    else:
                        pending_idx += 1
                        angle = (pending_idx * 105.0 * 3.14159265) / 180.0
                        radius = 0.35 + (pending_idx % 5) * 0.12
                        lat = round(srv_lat + radius * math.cos(angle), 5)
                        lng = round(srv_lng + radius * math.sin(angle) * 1.4, 5)
                        pending_coords_map[r_ip] = (lat, lng)
                    city = "Resolviendo GeoIP..."
                    raw_city = ""
                    region = ""
                    postal = ""
                    country = ""
                    cc = ""
                    isp = "En cola del Worker GeoIP (ip-api.com)"
                    asn = ""
                    acc_src = "pending"
                    geo_status = "pending"

                ext_domain = s.get("domain") or pihole_translator.translate_external(r_ip, rdns_budget)
                loc_hostname = s.get("local_hostname") or pihole_translator.translate_local(s["local_ip"], SERVER_LOCAL_IP)
                svc_title = s["service"]

                if ext_domain:
                    svc_title = f"{ext_domain} (:{s['remote_port']})"
                elif geo and s["direction"] == "outgoing" and geo.get("isp"):
                    clean_isp = str(geo.get("isp")).split(",")[0].strip()
                    if clean_isp and len(clean_isp) <= 36:
                        svc_title = f"{clean_isp} (:{s['remote_port']})"

                connections_out.append({
                    "id": f"sock_{s['direction']}_{r_ip}_{s['local_port']}_{s['remote_port']}",
                    "direction": s["direction"],
                    "protocol": s["protocol"],
                    "local_ip": s["local_ip"],
                    "local_hostname": loc_hostname,
                    "local_port": s["local_port"],
                    "remote_ip": r_ip,
                    "remote_port": s["remote_port"],
                    "domain": ext_domain,
                    "service": svc_title,
                    "process": s.get("process", ""),
                    "jail": s.get("jail", "caddy-scan"),
                    "details": s.get("details", ""),
                    "state": s["state"],
                    "lat": lat,
                    "lng": lng,
                    "city": city,
                    "raw_city": raw_city,
                    "region": region,
                    "postal": postal,
                    "country": country,
                    "country_code": cc,
                    "isp": isp,
                    "asn": asn,
                    "accuracy_source": acc_src,
                    "is_lan": False,
                    "geo_status": geo_status
                })

            for ep in resolved_outbound_hosts.values():
                with GEOIP_LOCK:
                    geo = GEOIP_CACHE.get(ep["ip"])
                if not geo:
                    continue
                if not any(c["remote_ip"] == ep["ip"] for c in connections_out):
                    ep_reg = geo.get("region", "")
                    ep_zip = geo.get("postal", "")
                    ep_city = f"{geo['city']} ({ep_reg}{' · CP ' + ep_zip if ep_zip else ''})" if (ep_reg or ep_zip) and geo.get("city") else geo.get("city", "Nodo Remoto")
                    connections_out.append({
                        "id": f"out_{ep['host']}_{ep['ip']}",
                        "direction": "outgoing",
                        "protocol": ep["protocol"],
                        "local_ip": SERVER_LOCAL_IP,
                        "local_hostname": "Servidor",
                        "local_port": 48120 + (ep["port"] % 500),
                        "remote_ip": ep["ip"],
                        "remote_port": ep["port"],
                        "domain": ep["host"],
                        "service": ep["service"],
                        "process": "python3 (dashboard)",
                        "jail": "caddy-scan",
                        "details": f"Sincronización externa hacia {ep['service']}",
                        "state": "ESTABLISHED",
                        "lat": geo["lat"],
                        "lng": geo["lng"],
                        "city": ep_city,
                        "raw_city": geo.get("city", ""),
                        "region": ep_reg,
                        "postal": ep_zip,
                        "country": geo["country"],
                        "country_code": geo["country_code"],
                        "isp": geo["isp"],
                        "asn": geo["asn"],
                        "accuracy_source": geo.get("accuracy_source", "ip-api"),
                        "is_lan": False,
                        "geo_status": "cached"
                    })

            for b_item in f2b_banned[:25]:
                b_ip = b_item.get("ip", "")
                if not b_ip:
                    continue
                with GEOIP_LOCK:
                    geo = GEOIP_CACHE.get(b_ip)
                if not geo:
                    continue
                if not any(c["remote_ip"] == b_ip and c["direction"] == "blocked" for c in connections_out):
                    b_jail = b_item.get("jail", "sshd")
                    b_domain = pihole_translator.translate_external(b_ip)
                    b_reg = geo.get("region", "")
                    b_zip = geo.get("postal", "")
                    b_city = f"{geo['city']} ({b_reg}{' · CP ' + b_zip if b_zip else ''})" if (b_reg or b_zip) and geo.get("city") else geo.get("city", "Nodo Remoto")
                    connections_out.append({
                        "id": f"blk_{b_ip}",
                        "direction": "blocked",
                        "protocol": "TCP",
                        "local_ip": SERVER_LOCAL_IP,
                        "local_hostname": "Servidor",
                        "local_port": 22 if b_jail == "sshd" else 443,
                        "remote_ip": b_ip,
                        "remote_port": 0,
                        "domain": b_domain,
                        "service": f"Fail2ban IPS ({b_jail})" + (f" · {b_domain}" if b_domain else ""),
                        "process": "fail2ban",
                        "jail": b_jail,
                        "details": f"IP bloqueada en firewall por Fail2ban (jail {b_jail}){': ' + b_domain if b_domain else ''}",
                        "state": "BANNED",
                        "lat": geo["lat"],
                        "lng": geo["lng"],
                        "city": b_city,
                        "raw_city": geo.get("city", ""),
                        "region": b_reg,
                        "postal": b_zip,
                        "country": geo["country"],
                        "country_code": geo["country_code"],
                        "isp": geo["isp"],
                        "asn": geo["asn"],
                        "accuracy_source": geo.get("accuracy_source", "ip-api"),
                        "is_lan": False,
                        "geo_status": "cached"
                    })

            inc_cnt = sum(1 for c in connections_out if c["direction"] == "incoming")
            out_cnt = sum(1 for c in connections_out if c["direction"] == "outgoing")
            blk_cnt = sum(1 for c in connections_out if c["direction"] == "blocked")
            dev_cnt = sum(1 for c in connections_out if c.get("local_ip") not in (SERVER_LOCAL_IP, "127.0.0.1", "::1"))
            worker_summary = get_geoip_worker_summary()

            with CONNECTIONS_MAP_LOCK:
                CONNECTIONS_MAP_CACHE = {
                    "server_node": {
                        "ip": SERVER_LOCAL_IP,
                        "public_ip": SERVER_SELF_GEO.get("ip", SERVER_LOCAL_IP),
                        "lat": srv_lat,
                        "lng": srv_lng,
                        "city": srv_city,
                        "country": srv_country,
                        "country_code": srv_cc,
                        "org": SERVER_SELF_GEO.get("org", HOSTNAME)
                    },
                    "summary": {
                        "total": len(connections_out),
                        "incoming": inc_cnt,
                        "outgoing": out_cnt,
                        "blocked": blk_cnt,
                        "devices": dev_cnt
                    },
                    "connections": connections_out,
                    "geoip_worker": worker_summary
                }
            record_connections_to_sqlite(connections_out)
            save_geoip_disk_cache(force=False)
        except Exception as e:
            import traceback
            traceback.print_exc()
        # Wait up to 6 seconds or wake immediately when new remote IPs are enqueued
        GEOIP_WAKE_EVENT.wait(timeout=6.0)
        GEOIP_WAKE_EVENT.clear()

# Dynamic Hardware & OS Information (Queried directly from OS kernel at startup)
def _detect_cpu_static_specs():
    model = ""
    vendor = ""
    cache_size = ""
    arch = os.uname().machine
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if ":" not in line:
                    continue
                k, v = [x.strip() for x in line.split(":", 1)]
                kl = k.lower()
                if kl in ("model name", "hardware", "processor", "cpu model") and not model and not v.isdigit():
                    model = v
                elif kl == "vendor_id" and not vendor:
                    vendor = v
                elif kl == "cache size" and not cache_size:
                    cache_size = v
    except Exception:
        pass
    if not model:
        try:
            out = subprocess.check_output(["lscpu"], timeout=2).decode("utf-8", errors="ignore")
            for line in out.splitlines():
                if "Model name:" in line or "Nombre del modelo:" in line:
                    model = line.split(":", 1)[1].strip()
                    break
        except Exception:
            pass
    if not model:
        model = f"CPU ({arch})"
    return model, arch, vendor, cache_size

CPU_MODEL, CPU_ARCH, CPU_VENDOR, CPU_CACHE = _detect_cpu_static_specs()
CORES_LOGICAL = psutil.cpu_count(logical=True) or os.cpu_count() or 1
CORES_PHYSICAL = psutil.cpu_count(logical=False) or CORES_LOGICAL
HOSTNAME = os.uname().nodename
KERNEL = os.uname().release
BOOT_TIME = psutil.boot_time()

# ==============================================================================
# Dynamic DNS / Domain Auto-Detection & GitHub Version Manager
# ==============================================================================
GITHUB_REPO = "cminewarIA/recursos-ui"
GITHUB_BRANCH = "main"
VERSION_CACHE = {"data": None, "timestamp": 0}
VERSION_LOCK = threading.Lock()
DETECTED_DOMAIN_CACHE = None

def detect_local_server_ip():
    """Detecta automáticamente la IP privada LAN del servidor instalado."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return "192.168.50.2"

SERVER_LOCAL_IP = detect_local_server_ip()

def detect_system_dns_domain():
    """
    Busca automáticamente el dominio DNS público o local configurado en el ordenador instalado:
    1. Variable de entorno PUBLIC_DOMAIN / SERVER_DOMAIN.
    2. Archivos de configuración de proxy inverso (Caddyfile, Nginx) o scripts de DuckDNS.
    3. FQDN del sistema (socket.getfqdn()).
    """
    global DETECTED_DOMAIN_CACHE
    if DETECTED_DOMAIN_CACHE:
        return DETECTED_DOMAIN_CACHE

    env_dom = os.environ.get("PUBLIC_DOMAIN") or os.environ.get("SERVER_DOMAIN")
    if env_dom and "." in env_dom:
        DETECTED_DOMAIN_CACHE = env_dom.strip().lower()
        return DETECTED_DOMAIN_CACHE

    candidate_files = [
        # 1. Rutas relativas al repositorio (GitHub / Google AI Studio / Simulador)
        os.path.join(BASE_DIR, "Caddyfile"),
        os.path.join(BASE_DIR, "caddy", "Caddyfile"),
        os.path.join(BASE_DIR, "duck.sh"),
        os.path.join(BASE_DIR, "duckdns", "duck.sh"),
        os.path.join(BASE_DIR, "..", "caddy", "Caddyfile"),
        os.path.join(BASE_DIR, "..", "duckdns", "duck.sh"),
        "./Caddyfile",
        "./duck.sh",
        "./duckdns/duck.sh",
        # 2. Rutas del servidor local físico
        "/etc/caddy/Caddyfile",
        "/home/servidor/Caddyfile",
        "/home/servidor/servicios/caddy/Caddyfile",
        "/home/servidor/docker/caddy/Caddyfile",
        "/opt/caddy/Caddyfile",
        "/etc/nginx/sites-enabled/default",
        "/etc/nginx/nginx.conf",
        "/home/servidor/duckdns/duck.sh",
        "/home/servidor/servicios/duckdns/duck.sh",
        "/etc/crontab"
    ]

    # También buscar en directorios de servicios comunes si existen
    for base_search in ["/home/servidor", "/etc/nginx/conf.d", "/etc/nginx/sites-enabled"]:
        if os.path.isdir(base_search):
            try:
                for entry in os.listdir(base_search):
                    full_p = os.path.join(base_search, entry)
                    if os.path.isfile(full_p) and any(k in entry.lower() for k in ["caddy", "duck", "nginx", "dns", ".conf"]):
                        candidate_files.append(full_p)
            except Exception:
                pass

    ignored_domains = {
        "googleapis.com", "gstatic.com", "github.com", "docker.io",
        "ubuntu.com", "archlinux.org", "debian.org", "cloudflare.com",
        "letsencrypt.org", "example.com", "localhost.localdomain"
    }

    for fpath in candidate_files:
        if not os.path.isfile(fpath):
            continue
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(32768)
            # 1. Buscar dominios explícitos *.duckdns.org o *.ddns.net
            m_duck = re.findall(r'\b([a-zA-Z0-9_-]+\.(?:duckdns\.org|ddns\.net|no-ip\.org|synology\.me|tail[a-z0-9]+\.ts\.net))\b', content, re.IGNORECASE)
            if m_duck:
                # Preferir el dominio raíz si hay subdominios como nextcloud.xxx.duckdns.org
                for d in m_duck:
                    d_low = d.lower()
                    if not d_low.startswith(("www.", "nextcloud.", "emby.", "immich.", "pihole.")):
                        DETECTED_DOMAIN_CACHE = d_low
                        return DETECTED_DOMAIN_CACHE
                DETECTED_DOMAIN_CACHE = m_duck[0].lower()
                return DETECTED_DOMAIN_CACHE

            # 2. Buscar parámetro domains= en scripts de DuckDNS
            m_param = re.search(r'domains\s*=\s*["\']?([a-zA-Z0-9_-]+)["\']?', content, re.IGNORECASE)
            if m_param and "duckdns.org" in content.lower():
                DETECTED_DOMAIN_CACHE = f"{m_param.group(1).lower()}.duckdns.org"
                return DETECTED_DOMAIN_CACHE

            # 3. Buscar directivas de dominio en Caddyfile o server_name en Nginx
            m_caddy = re.findall(r'(?:https?://|server_name\s+)([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', content)
            for dom in m_caddy:
                dom_l = dom.lower().strip(".")
                if dom_l not in ignored_domains and not re.match(r'^\d+\.\d+\.\d+\.\d+$', dom_l):
                    DETECTED_DOMAIN_CACHE = dom_l
                    return DETECTED_DOMAIN_CACHE
        except Exception:
            continue

    # 4. Intentar obtener desde contenedores Docker activos (ej. variables de entorno de Caddy / Nextcloud / DuckDNS)
    try:
        p_dock = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=1.5
        )
        if p_dock.returncode == 0:
            for cname in p_dock.stdout.splitlines():
                cname = cname.strip()
                if any(k in cname.lower() for k in ["caddy", "duckdns", "nginx", "proxy", "nextcloud"]):
                    p_insp = subprocess.run(
                        ["docker", "inspect", "--format", "{{json .Config.Env}} {{json .Mounts}}", cname],
                        capture_output=True, text=True, timeout=1.5
                    )
                    if p_insp.returncode == 0:
                        m_env = re.findall(r'\b([a-zA-Z0-9_-]+\.(?:duckdns\.org|ddns\.net|ts\.net))\b', p_insp.stdout, re.IGNORECASE)
                        if m_env:
                            DETECTED_DOMAIN_CACHE = m_env[0].lower()
                            return DETECTED_DOMAIN_CACHE
    except Exception:
        pass

    # 5. Comprobar FQDN del sistema operativo
    try:
        fqdn = socket.getfqdn().strip().lower()
        if "." in fqdn and not fqdn.startswith("localhost") and not fqdn.endswith(".local"):
            DETECTED_DOMAIN_CACHE = fqdn
            return DETECTED_DOMAIN_CACHE
    except Exception:
        pass

    return f"{HOSTNAME}.local"

def resolve_request_domain(handler=None):
    """
    Devuelve el dominio DNS del servidor, priorizando la detección en el equipo
    o el Host con el que el cliente está navegando si es un dominio público válido.
    """
    sys_dom = detect_system_dns_domain()
    if handler:
        host_hdr = handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or ""
        host_clean = host_hdr.split(",")[0].strip().split(":")[0].lower()
        if host_clean and "." in host_clean and not re.match(r'^\d+\.\d+\.\d+\.\d+$', host_clean):
            if not host_clean.endswith((".run.app", "localhost", ".local")):
                return host_clean
            elif sys_dom.endswith(".local") and not host_clean.startswith("localhost"):
                return host_clean
    return sys_dom

def get_app_version():
    """
    Lee la versión oficial canónica desde el archivo centralizado VERSION en la raíz del proyecto.
    Si no existe o falla la lectura, recurre a package.json o al valor base.
    """
    v_file = os.path.join(BASE_DIR, "VERSION")
    if os.path.isfile(v_file):
        try:
            with open(v_file, "r", encoding="utf-8") as vf:
                v = vf.read().strip()
                if v:
                    return v
        except Exception:
            pass

    pkg_path = os.path.join(BASE_DIR, "package.json")
    if os.path.isfile(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as pf:
                pkg_json = json.load(pf)
                return pkg_json.get("version", "0.0.0")
        except Exception:
            pass

    return "0.0.0"

def get_version_info(force_refresh=False):
    """
    Obtiene la versión actual instalada localmente (Git commit, fecha, versión semántica)
    y la compara en tiempo real con el repositorio remoto en GitHub (cminewarIA/recursos-ui).
    """
    now = time.time()
    with VERSION_LOCK:
        if not force_refresh and VERSION_CACHE["data"] and (now - VERSION_CACHE["timestamp"] < 90):
            return dict(VERSION_CACHE["data"])

    pkg_version = get_app_version()


    local_sha = "desconocido"
    local_full_sha = ""
    local_msg = "Versión local instalada"
    local_date = datetime.now().strftime("%Y-%m-%d %H:%M")
    local_branch = GITHUB_BRANCH

    try:
        p_sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True, timeout=2)
        if p_sha.returncode == 0 and p_sha.stdout.strip():
            local_full_sha = p_sha.stdout.strip()
            local_sha = local_full_sha[:7]

        p_log = subprocess.run(["git", "log", "-1", "--format=%s|%ci|%an"], cwd=BASE_DIR, capture_output=True, text=True, timeout=2)
        if p_log.returncode == 0 and "|" in p_log.stdout:
            parts = p_log.stdout.strip().split("|")
            local_msg = parts[0]
            local_date = parts[1][:16] if len(parts) > 1 else local_date

        p_br = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True, timeout=2)
        if p_br.returncode == 0 and p_br.stdout.strip():
            local_branch = p_br.stdout.strip()
    except Exception:
        pass

    remote_sha = local_sha
    remote_full_sha = local_full_sha
    remote_msg = local_msg
    remote_date = local_date
    remote_author = "cminewarIA"
    recent_commits = []
    github_reachable = False

    # Consultar API pública de GitHub para obtener el último commit y historial de main
    try:
        api_url = f"https://api.github.com/repos/{GITHUB_REPO}/commits?sha={GITHUB_BRANCH}&per_page=5"
        req = urllib.request.Request(
            api_url,
            headers={
                "User-Agent": "Recursos-Server-Monitor/2.0",
                "Accept": "application/vnd.github.v3+json"
            }
        )
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            if resp.status == 200:
                commits_data = json.loads(resp.read().decode("utf-8"))
                if isinstance(commits_data, list) and len(commits_data) > 0:
                    github_reachable = True
                    latest = commits_data[0]
                    remote_full_sha = latest.get("sha", "")
                    remote_sha = remote_full_sha[:7] if remote_full_sha else local_sha
                    commit_obj = latest.get("commit", {})
                    remote_msg = commit_obj.get("message", "").splitlines()[0]
                    raw_date = commit_obj.get("committer", {}).get("date", "")
                    if raw_date:
                        remote_date = raw_date.replace("T", " ").replace("Z", "")[:16]
                    remote_author = commit_obj.get("author", {}).get("name", "cminewarIA")

                    for c in commits_data:
                        c_sha = (c.get("sha") or "")[:7]
                        c_obj = c.get("commit", {})
                        c_msg = (c_obj.get("message") or "").splitlines()[0]
                        c_dt = (c_obj.get("committer", {}).get("date") or "").replace("T", " ").replace("Z", "")[:16]
                        recent_commits.append({
                            "sha": c_sha,
                            "message": c_msg,
                            "date": c_dt,
                            "is_local_head": (c_sha == local_sha)
                        })
    except Exception:
        # Fallback con git ls-remote si la API REST tiene límite o no responde
        try:
            p_ls = subprocess.run(
                ["git", "ls-remote", f"https://github.com/{GITHUB_REPO}.git", f"refs/heads/{GITHUB_BRANCH}"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=3
            )
            if p_ls.returncode == 0 and p_ls.stdout.strip():
                github_reachable = True
                remote_full_sha = p_ls.stdout.split()[0].strip()
                remote_sha = remote_full_sha[:7]
        except Exception:
            pass

    update_available = bool(
        github_reachable and
        remote_sha and
        local_sha != "desconocido" and
        remote_sha != local_sha
    )

    local_clean = True
    try:
        p_st = subprocess.run(["git", "status", "--porcelain"], cwd=BASE_DIR, capture_output=True, text=True, timeout=2)
        if p_st.returncode == 0:
            local_clean = (len(p_st.stdout.strip()) == 0)
    except Exception:
        pass

    behind_count = 0
    if update_available and recent_commits:
        for idx, rc in enumerate(recent_commits):
            if rc.get("sha") == local_sha:
                behind_count = idx
                break
        if behind_count == 0:
            behind_count = 1

    pub_dom = detect_system_dns_domain()
    result = {
        "version": pkg_version,
        "repo": GITHUB_REPO,
        "repo_url": f"https://github.com/{GITHUB_REPO}",
        "branch": local_branch,
        "local_hash": local_sha,
        "local_full_hash": local_full_sha,
        "local_subject": local_msg,
        "local_date": local_date,
        "local_clean": local_clean,
        "remote_hash": remote_sha,
        "remote_full_hash": remote_full_sha,
        "remote_subject": remote_msg,
        "remote_date": remote_date,
        "remote_author": remote_author,
        "behind_count": behind_count,
        "local": {
            "sha": local_sha,
            "full_sha": local_full_sha,
            "message": local_msg,
            "date": local_date,
            "clean": local_clean
        },
        "remote": {
            "sha": remote_sha,
            "full_sha": remote_full_sha,
            "message": remote_msg,
            "date": remote_date,
            "author": remote_author,
            "reachable": github_reachable
        },
        "update_available": update_available,
        "recent_commits": recent_commits,
        "public_domain": pub_dom,
        "local_ip": SERVER_LOCAL_IP,
        "checked_at": datetime.now().strftime("%H:%M:%S")
    }

    with VERSION_LOCK:
        VERSION_CACHE["data"] = result
        VERSION_CACHE["timestamp"] = now

    return dict(result)


# ==============================================================================
# Security & Zero-Trust Local Pairing Functions (HMAC-SHA256 Signed Tokens)
# ==============================================================================
AUTH_SECRET_FILE = os.path.join(BASE_DIR, ".auth_secret")
AUTH_SECRET_LOCK = threading.Lock()

def get_auth_secret():
    """Obtiene o genera la clave secreta de 256 bits para firmar tokens criptográficos."""
    with AUTH_SECRET_LOCK:
        if os.path.exists(AUTH_SECRET_FILE):
            try:
                with open(AUTH_SECRET_FILE, 'rb') as f:
                    sec = f.read().strip()
                    if len(sec) >= 32:
                        return sec
            except Exception:
                pass
        # Generar clave secreta criptográficamente segura de 32 bytes
        new_secret = secrets.token_bytes(32)
        try:
            with open(AUTH_SECRET_FILE, 'wb') as f:
                f.write(new_secret)
            os.chmod(AUTH_SECRET_FILE, 0o600)
        except Exception as e:
            print(f"[-] Advertencia creando .auth_secret: {e}")
        return new_secret

def create_device_token(device_id):
    """Genera un token firmado con HMAC-SHA256 para un ID de dispositivo."""
    secret = get_auth_secret()
    ts = int(time.time())
    nonce = secrets.token_hex(16)
    payload = f"{device_id}:{ts}:{nonce}"
    sig = hmac.new(secret, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{device_id}.{ts}.{nonce}.{sig}"

def verify_device_token(token_str):
    """
    Verifica criptográficamente la firma HMAC del token en tiempo constante.
    Valida además que el token no haya expirado (máximo 1 año de validez).
    Retorna el device_id si es válido, o None si es inválido o fue manipulado.
    """
    if not token_str or not isinstance(token_str, str):
        return None
    parts = token_str.split('.')
    if len(parts) != 4:
        return None
    device_id, ts, nonce, sig = parts
    try:
        ts_int = int(ts)
        if abs(time.time() - ts_int) > 31536000:  # 1 año en segundos
            return None
    except Exception:
        return None
    payload = f"{device_id}:{ts}:{nonce}"
    secret = get_auth_secret()
    expected_sig = hmac.new(secret, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expected_sig):
        return device_id
    return None

def resolve_arp_mac_for_ip(ip_str):
    """
    Resuelve dinámicamente la dirección MAC física para una IP local mediante /proc/net/arp
    o interfaces locales (/sys/class/net) si corresponde al propio nodo servidor.
    """
    clean_ip = str(ip_str or "").strip()
    if not clean_ip or clean_ip.startswith("Externo"):
        return ""
    if clean_ip in ("127.0.0.1", "::1", "localhost", SERVER_LOCAL_IP):
        try:
            net_dir = "/sys/class/net"
            if os.path.isdir(net_dir):
                for iface in sorted(os.listdir(net_dir)):
                    if iface == "lo" or iface.startswith(("docker", "veth", "br-", "virbr")):
                        continue
                    addr_file = os.path.join(net_dir, iface, "address")
                    if os.path.isfile(addr_file):
                        with open(addr_file, "r", encoding="utf-8") as f:
                            mac = f.read().strip().lower()
                        if mac and mac != "00:00:00:00:00:00":
                            return mac
        except Exception:
            pass
    try:
        if os.path.isfile("/proc/net/arp"):
            with open("/proc/net/arp", "r", encoding="utf-8") as f:
                for line in f.readlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 4 and parts[0] == clean_ip:
                        mac = parts[3].strip().lower()
                        if mac and mac != "00:00:00:00:00:00":
                            return mac
    except Exception:
        pass
    return ""


def normalize_lan_ip(ip_str):
    """Normaliza IPs de loopback hacia la IP LAN real del servidor para unificar identidad física."""
    clean_ip = str(ip_str or "").strip()
    if clean_ip in ("127.0.0.1", "::1", "localhost") and SERVER_LOCAL_IP and SERVER_LOCAL_IP != "127.0.0.1":
        return SERVER_LOCAL_IP
    return clean_ip


def normalize_hardware_id(hw_id):
    """
    Normaliza el identificador de hardware eliminando sufijos aleatorios de sesión web
    (ej: web_1a2b3c_9f8e7d -> web_1a2b3c) para mantener identidad determinista por equipo.
    """
    raw = str(hw_id or "").strip()
    if not raw or raw.startswith("dev_"):
        return ""
    if raw.startswith("web_"):
        parts = raw.split("_")
        if len(parts) >= 3:
            return f"web_{parts[1]}"
    return raw


def extract_os_family(ua, tel=None):
    """Extrae la familia de sistema operativo normalizada del dispositivo físico."""
    t = tel if isinstance(tel, dict) else {}
    os_str = f"{t.get('os_distro', '')} {t.get('client_type', '')} {ua or ''}".lower()
    if "android" in os_str:
        return "android"
    if "iphone" in os_str or "ipad" in os_str or "ios" in os_str:
        return "ios"
    if "macintosh" in os_str or "mac os" in os_str or "macos" in os_str:
        return "macos"
    if "windows" in os_str:
        return "windows"
    if "ubuntu" in os_str or "linux" in os_str or "debian" in os_str:
        return "linux"
    return "other"


def extract_client_descriptor(ua, tel=None, client_ip="", is_local=True, now_iso=""):
    """
    Construye el descriptor del cliente/contenedor (App Nativa vs Navegador Web)
    que se conecta desde un dispositivo físico.
    """
    t = tel if isinstance(tel, dict) else {}
    ua_str = str(ua or "")
    ua_lower = ua_str.lower()
    c_type = t.get("client_type") or ""
    if not c_type:
        if "recursoscockpit-linux" in ua_lower:
            c_type = "ubuntu_native"
        elif "recursoscockpit-android" in ua_lower:
            c_type = "android_native"
        else:
            c_type = "web_browser"

    is_nat = c_type in ("ubuntu_native", "android_native") or bool(t.get("full_access"))
    browser = "Web"
    if c_type == "ubuntu_native":
        c_key = "ubuntu_native"
        c_label = "App Nativa Ubuntu (.deb)"
        browser = "GTK3 + WebKit2"
    elif c_type == "android_native":
        c_key = "android_native"
        c_label = "App Nativa Android (.apk)"
        browser = "Kotlin + WebView"
    else:
        if "edg/" in ua_lower:
            browser = "Edge"
        elif "opr/" in ua_lower or "opera" in ua_lower:
            browser = "Opera"
        elif "chrome/" in ua_lower or "crios/" in ua_lower:
            browser = "Chrome"
        elif "firefox/" in ua_lower or "fxios/" in ua_lower:
            browser = "Firefox"
        elif "safari/" in ua_lower and "chrome" not in ua_lower:
            browser = "Safari"
        c_key = f"web_{browser.lower()}"
        c_label = f"Navegador Web ({browser})"

    return {
        "client_key": c_key,
        "client_type": c_type,
        "client_label": c_label,
        "browser_engine": browser,
        "access_level": "FULL_NATIVE_ACCESS" if is_nat else "WEB_SANDBOX",
        "full_access": is_nat,
        "connection_mode": "LAN" if is_local else "WAN",
        "ip": normalize_lan_ip(client_ip) if is_local else client_ip,
        "user_agent": ua_str[:220],
        "last_seen": now_iso or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def compute_physical_device_key(entry_or_tel, client_ip="", ua="", is_local=True):
    """
    Calcula la clave canónica del dispositivo físico (Zero-Trust Hardware Identity)
    para que el certificado se emita por dispositivo físico y agrupe todos sus clientes.
    """
    d = entry_or_tel if isinstance(entry_or_tel, dict) else {}
    tel = d.get("device_telemetry") if isinstance(d.get("device_telemetry"), dict) else d
    raw_lan_ip = d.get("local_ip") or tel.get("local_ip") or (client_ip if is_local else "")
    lan_ip = normalize_lan_ip(raw_lan_ip)
    ua_str = ua or d.get("user_agent") or ""
    os_fam = extract_os_family(ua_str, tel)

    mac = str(tel.get("mac_address") or d.get("mac_address") or "").strip().lower()
    if (not mac or mac == "00:00:00:00:00:00") and lan_ip and not lan_ip.startswith("Externo"):
        mac = resolve_arp_mac_for_ip(lan_ip)

    if mac and mac != "00:00:00:00:00:00":
        clean_mac = re.sub(r"[^0-9a-f]", "", mac)
        if len(clean_mac) >= 12:
            return f"phys_mac_{clean_mac[:12]}"

    if lan_ip and not lan_ip.startswith("Externo") and is_local_ip(lan_ip) and os_fam != "other":
        return f"phys_lan_{lan_ip}_{os_fam}"

    hw_id = normalize_hardware_id(d.get("hardware_id") or tel.get("hardware_id") or "")
    if hw_id and not hw_id.startswith("web_"):
        return f"phys_hw_{hw_id}"

    mfg = str(tel.get("manufacturer") or tel.get("brand") or "").strip().lower()
    mdl = str(tel.get("model") or "").strip().lower()
    if mfg and mdl and mfg not in ("cliente web", "web", "generic"):
        seed = f"{mfg}:{mdl}:{os_fam}:{lan_ip or client_ip}"
        return "phys_mod_" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]

    if hw_id:
        return f"phys_hw_{hw_id}"

    fallback_ip = lan_ip or client_ip or "unknown"
    return f"phys_ip_{fallback_ip}_{os_fam}"


def generate_certificate_serial(dev_id, physical_key=""):
    """Genera un número de serie de certificado determinista por dispositivo físico."""
    secret = get_auth_secret()
    seed = f"zt-device-cert:{dev_id}:{physical_key}".encode("utf-8")
    digest = hmac.new(secret, seed, hashlib.sha256).hexdigest().upper()
    return f"ZT-{digest[:4]}-{digest[4:8]}-{digest[8:12]}"


def consolidate_devices_by_hardware(devices):
    """
    Unifica y agrupa registros en trusted_devices.json que pertenezcan al mismo
    dispositivo físico, garantizando 1 certificado por dispositivo físico y
    conservando la lista de clientes/contenedores agrupados (Native App + Navegadores).
    """
    if not isinstance(devices, dict) or not devices:
        return {}

    grouped_by_phys = {}
    phys_order = []

    # Ordenar primero los registros con full_access (App Nativa) y más antiguos para que sean la raíz canónica
    sorted_items = sorted(
        devices.items(),
        key=lambda kv: (
            not bool(kv[1].get("full_access") or (kv[1].get("device_telemetry") or {}).get("full_access")),
            str(kv[1].get("first_seen") or "9999"),
        ),
    )

    for raw_k, raw_v in sorted_items:
        if not isinstance(raw_v, dict):
            continue
        dev_id = str(raw_v.get("id") or raw_k).strip()
        if not dev_id or dev_id == "cli_local":
            continue

        tel = raw_v.get("device_telemetry") if isinstance(raw_v.get("device_telemetry"), dict) else {}
        ua_str = str(raw_v.get("user_agent") or "")
        lan_ip = normalize_lan_ip(raw_v.get("local_ip") or tel.get("local_ip") or "")
        if lan_ip and not lan_ip.startswith("Externo"):
            raw_v["local_ip"] = lan_ip
            if isinstance(raw_v.get("device_telemetry"), dict):
                raw_v["device_telemetry"]["local_ip"] = lan_ip

        phys_key = compute_physical_device_key(raw_v, lan_ip, ua_str, is_local=bool(lan_ip and not lan_ip.startswith("Externo")))
        os_fam = extract_os_family(ua_str, tel)
        norm_hw = normalize_hardware_id(raw_v.get("hardware_id") or tel.get("hardware_id") or "")
        mac_addr = str(tel.get("mac_address") or resolve_arp_mac_for_ip(lan_ip) or "").strip().lower()

        # Buscar si ya existe un grupo para este mismo equipo físico (por phys_key, MAC, hardware_id o IP LAN + SO)
        matched_key = None
        if phys_key in grouped_by_phys:
            matched_key = phys_key
        else:
            for existing_pk, existing_entry in grouped_by_phys.items():
                ex_tel = existing_entry.get("device_telemetry") if isinstance(existing_entry.get("device_telemetry"), dict) else {}
                ex_lan = normalize_lan_ip(existing_entry.get("local_ip") or ex_tel.get("local_ip") or "")
                ex_os = extract_os_family(existing_entry.get("user_agent", ""), ex_tel)
                ex_hw = normalize_hardware_id(existing_entry.get("hardware_id") or ex_tel.get("hardware_id") or "")
                ex_mac = str(ex_tel.get("mac_address") or "").strip().lower()

                if mac_addr and ex_mac and mac_addr == ex_mac and mac_addr != "00:00:00:00:00:00":
                    matched_key = existing_pk
                    break
                if norm_hw and ex_hw and norm_hw == ex_hw:
                    matched_key = existing_pk
                    break
                if lan_ip and ex_lan and lan_ip == ex_lan and not lan_ip.startswith("Externo") and os_fam == ex_os and os_fam != "other":
                    matched_key = existing_pk
                    break

        # Extraer clientes registrados en este registro
        existing_clients = raw_v.get("clients") if isinstance(raw_v.get("clients"), list) else []
        cur_client_desc = extract_client_descriptor(
            ua_str,
            tel,
            lan_ip or raw_v.get("last_external_ip", ""),
            is_local=not bool(raw_v.get("last_external_ip") and not lan_ip),
            now_iso=raw_v.get("last_seen", ""),
        )

        if not matched_key:
            matched_key = phys_key
            phys_order.append(matched_key)
            base_entry = dict(raw_v)
            base_entry["id"] = dev_id
            base_entry["physical_key"] = matched_key
            alias_ids = list(dict.fromkeys([dev_id] + [str(x) for x in base_entry.get("alias_ids", []) if x]))
            base_entry["alias_ids"] = alias_ids

            clients_map = {}
            for c_item in existing_clients:
                if isinstance(c_item, dict) and c_item.get("client_key"):
                    clients_map[c_item["client_key"]] = dict(c_item)
            clients_map[cur_client_desc["client_key"]] = cur_client_desc
            base_entry["clients"] = list(clients_map.values())
            base_entry["certificate_serial"] = generate_certificate_serial(dev_id, matched_key)
            base_entry["certificate_scope"] = "PER_PHYSICAL_DEVICE"
            grouped_by_phys[matched_key] = base_entry
        else:
            target = grouped_by_phys[matched_key]
            # Registrar el ID secundario en alias_ids para que su token siga siendo reconocido y unificado
            alias_ids = list(dict.fromkeys(list(target.get("alias_ids", [target["id"]])) + [dev_id] + list(raw_v.get("alias_ids", []))))
            target["alias_ids"] = alias_ids

            # Conservar primera fecha de emparejamiento y última actividad más reciente
            if raw_v.get("first_seen") and (not target.get("first_seen") or raw_v["first_seen"] < target["first_seen"]):
                target["first_seen"] = raw_v["first_seen"]
            if raw_v.get("last_seen") and (not target.get("last_seen") or raw_v["last_seen"] > target["last_seen"]):
                target["last_seen"] = raw_v["last_seen"]

            if raw_v.get("custom_alias") and not target.get("custom_alias"):
                target["custom_alias"] = raw_v["custom_alias"]
                target["name"] = raw_v["custom_alias"]

            # Fusionar telemetría priorizando datos nativos (Full Access) sobre Sandbox Web
            target_tel = target.get("device_telemetry") if isinstance(target.get("device_telemetry"), dict) else {}
            incoming_is_native = bool(raw_v.get("full_access") or tel.get("full_access") or raw_v.get("client_type") in ("ubuntu_native", "android_native"))
            target_is_native = bool(target.get("full_access") or target_tel.get("full_access") or target.get("client_type") in ("ubuntu_native", "android_native"))

            merged_tel = dict(target_tel)
            for tk, tv in tel.items():
                if tv is None or tv == "":
                    continue
                if incoming_is_native or tk not in merged_tel or not merged_tel.get(tk) or not target_is_native:
                    merged_tel[tk] = tv

            if incoming_is_native and not target_is_native:
                target["client_type"] = raw_v.get("client_type") or merged_tel.get("client_type")
                target["client_label"] = raw_v.get("client_label") or merged_tel.get("client_label")
                target["access_level"] = "FULL_NATIVE_ACCESS"
                target["full_access"] = True
                merged_tel["client_type"] = target["client_type"]
                merged_tel["client_label"] = target["client_label"]
                merged_tel["access_level"] = "FULL_NATIVE_ACCESS"
                merged_tel["full_access"] = True
                if not target.get("custom_alias") and raw_v.get("name"):
                    target["name"] = raw_v["name"]
                    target["auto_name"] = raw_v.get("auto_name") or raw_v["name"]

            target["device_telemetry"] = merged_tel

            # Fusionar lista de clientes del dispositivo físico
            clients_map = {}
            for c_item in target.get("clients", []):
                if isinstance(c_item, dict) and c_item.get("client_key"):
                    clients_map[c_item["client_key"]] = dict(c_item)
            for c_item in existing_clients:
                if isinstance(c_item, dict) and c_item.get("client_key"):
                    prev_c = clients_map.get(c_item["client_key"])
                    if not prev_c or str(c_item.get("last_seen", "")) >= str(prev_c.get("last_seen", "")):
                        clients_map[c_item["client_key"]] = dict(c_item)
            prev_cur = clients_map.get(cur_client_desc["client_key"])
            if not prev_cur or str(cur_client_desc.get("last_seen", "")) >= str(prev_cur.get("last_seen", "")):
                clients_map[cur_client_desc["client_key"]] = cur_client_desc

            target["clients"] = sorted(
                clients_map.values(),
                key=lambda c: (not bool(c.get("full_access")), str(c.get("last_seen", ""))),
            )

    consolidated = {}
    for pk in phys_order:
        entry = grouped_by_phys[pk]
        consolidated[entry["id"]] = entry
    return consolidated


def load_trusted_devices():
    """Carga el registro de dispositivos de confianza unificados por dispositivo físico."""
    if not os.path.exists(TRUSTED_FILE):
        return {}
    try:
        with open(TRUSTED_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            normalized = {}
            for k, v in data.items():
                if isinstance(v, dict):
                    dev_id = v.get("id") or k
                    normalized[dev_id] = v
            consolidated = consolidate_devices_by_hardware(normalized)
            if len(consolidated) != len(normalized):
                save_trusted_devices(consolidated)
            return consolidated
    except Exception:
        return {}

def save_trusted_devices(devices):
    """Guarda de forma atómica el registro de dispositivos de confianza."""
    try:
        temp_file = TRUSTED_FILE + ".tmp"
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(devices, f, indent=2, ensure_ascii=False)
        os.replace(temp_file, TRUSTED_FILE)
    except Exception as e:
        print(f"[-] Error guardando dispositivos de confianza: {e}")

def get_cookie_header_value(handler, token):
    """
    Construye la cabecera Set-Cookie con HttpOnly estricto.
    Ajusta SameSite y Secure según si la conexión es HTTPS/proxy o HTTP directo en LAN.
    """
    is_https = handler.headers.get('X-Forwarded-Proto') == 'https' or getattr(handler, 'is_https', False)
    if is_https:
        return f"_sysmon_trust={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=None; Secure; Partitioned"
    else:
        return f"_sysmon_trust={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax"

def get_client_ip(handler):
    """
    Extrae la IP real del cliente con validación estricta anti-spoofing.
    Si la conexión directa proviene de localhost (Caddy proxy) o del servidor local,
    se extrae la IP sanitizada por el proxy (X-Real-IP o el cliente original en X-Forwarded-For).
    """
    direct_ip = handler.client_address[0]
    if direct_ip in ('127.0.0.1', '::1', 'localhost', '192.168.50.2', SERVER_LOCAL_IP):
        x_real = handler.headers.get('X-Real-IP')
        if x_real:
            return x_real.strip()
        xff = handler.headers.get('X-Forwarded-For')
        if xff:
            parts = [p.strip() for p in xff.split(',') if p.strip()]
            if parts:
                return parts[0]
    return direct_ip

def is_local_ip(ip_str):
    """
    Determina con total precisión si una dirección IP es local (LAN de casa, loopback o Tailscale).
    Cualquier IP pública o externa fuera de estas subredes se considera EXTERIOR (Datos móviles / WAN).
    """
    try:
        ip = ipaddress.ip_address(ip_str)
        if ip.is_loopback or ip.is_private or ip.is_link_local:
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

    if "recursoscockpit-linux" in ua_lower:
        return "App Nativa Ubuntu (.deb)"
    if "recursoscockpit-android" in ua_lower:
        m = re.search(r"android\s+[\d.]+;\s*([^;)]+)", ua, re.IGNORECASE)
        if m:
            model_str = m.group(1).strip()
            if model_str and model_str.lower() not in ("wv", "mobile", "linux"):
                return f"{model_str} · App Nativa Android"
        return "App Nativa Android (.apk)"

    dev = "Equipo"
    if "iphone" in ua_lower:
        dev = "Apple iPhone"
    elif "ipad" in ua_lower:
        dev = "Apple iPad"
    elif "android" in ua_lower:
        m = re.search(r"android\s+[\d.]+;\s*([^;)]+)", ua, re.IGNORECASE)
        if m:
            cand = m.group(1).replace("Build/", "").strip()
            if cand and cand.lower() not in ("k", "wv", "mobile", "linux"):
                dev = f"Android ({cand})"
            else:
                dev = "Dispositivo Android"
        else:
            dev = "Dispositivo Android"
    elif "macintosh" in ua_lower or "mac os x" in ua_lower:
        dev = "Apple Mac"
    elif "windows nt 10.0" in ua_lower:
        dev = "Windows 10/11 PC"
    elif "windows" in ua_lower:
        dev = "Windows PC"
    elif "ubuntu" in ua_lower:
        dev = "Ubuntu Linux PC"
    elif "linux" in ua_lower:
        dev = "Linux Workstation"
    elif "nintendo" in ua_lower:
        dev = "Nintendo"

    browser = ""
    if "recursoscockpit" in ua_lower or "nativehtml" in ua_lower:
        browser = "Motor Nativo HTML5"
    elif "edg/" in ua_lower:
        browser = "Edge"
    elif "opr/" in ua_lower or "opera" in ua_lower:
        browser = "Opera"
    elif "chrome/" in ua_lower:
        browser = "Chrome"
    elif "safari/" in ua_lower and "chrome" not in ua_lower:
        browser = "Safari"
    elif "firefox/" in ua_lower:
        browser = "Firefox"

    return f"{dev} • {browser}" if browser else dev


def extract_header_telemetry(handler):
    """Decodifica la cabecera X-Device-Telemetry (Base64 JSON) enviada por las apps nativas."""
    raw_b64 = handler.headers.get("X-Device-Telemetry", "").strip()
    if not raw_b64:
        return {}
    try:
        decoded = base64.b64decode(raw_b64).decode("utf-8", errors="ignore")
        data = json.loads(decoded)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def enrich_device_entry(entry, ua, telemetry, client_ip, is_local):
    """
    Fusiona los metadatos de hardware, SO, red y clientes conectados en el registro
    del dispositivo físico, preservando la telemetría de silicio de Apps Nativas
    cuando el mismo equipo también abre sesiones en navegadores web.
    """
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    tel = telemetry if isinstance(telemetry, dict) else {}
    prev_tel = entry.get("device_telemetry") if isinstance(entry.get("device_telemetry"), dict) else {}

    ua_lower = (ua or "").lower()
    incoming_client_type = tel.get("client_type") or ""
    if not incoming_client_type:
        if "recursoscockpit-linux" in ua_lower:
            incoming_client_type = "ubuntu_native"
        elif "recursoscockpit-android" in ua_lower:
            incoming_client_type = "android_native"
        else:
            incoming_client_type = "web_browser"

    incoming_is_native = incoming_client_type in ("ubuntu_native", "android_native") or bool(tel.get("full_access"))
    prev_is_native = bool(entry.get("full_access") or prev_tel.get("full_access") or entry.get("client_type") in ("ubuntu_native", "android_native"))

    # Proteger campos profundos de hardware obtenidos por App Nativa frente a sobreescritura por Web Sandbox
    protected_hw_keys = {
        "hardware_id", "manufacturer", "model", "board", "chassis_type",
        "os_distro", "kernel", "cpu_model", "cpu_cores_physical",
        "ram_total_gb", "storage_total_gb", "storage_free_gb", "mac_address", "interface_name"
    }
    merged_tel = dict(prev_tel)
    for k, v in tel.items():
        if v is None or v == "":
            continue
        if prev_is_native and not incoming_is_native and k in protected_hw_keys and merged_tel.get(k):
            continue
        merged_tel[k] = v

    norm_ip = normalize_lan_ip(merged_tel.get("local_ip") or (client_ip if is_local else entry.get("local_ip", "")))
    if norm_ip and not norm_ip.startswith("Externo"):
        merged_tel["local_ip"] = norm_ip
        if not merged_tel.get("mac_address"):
            arp_mac = resolve_arp_mac_for_ip(norm_ip)
            if arp_mac:
                merged_tel["mac_address"] = arp_mac

    # Registrar/actualizar el cliente actual dentro de la lista agrupada de clientes del dispositivo
    client_desc = extract_client_descriptor(ua, tel, norm_ip if is_local else client_ip, is_local=is_local, now_iso=now_iso)
    clients_map = {}
    for c_item in (entry.get("clients") if isinstance(entry.get("clients"), list) else []):
        if isinstance(c_item, dict) and c_item.get("client_key"):
            c_copy = dict(c_item)
            c_copy["is_active_client"] = False
            clients_map[c_copy["client_key"]] = c_copy
    client_desc["is_active_client"] = True
    clients_map[client_desc["client_key"]] = client_desc

    all_clients = sorted(
        clients_map.values(),
        key=lambda c: (not bool(c.get("full_access")), str(c.get("last_seen", ""))),
    )
    entry["clients"] = all_clients
    entry["active_client_key"] = client_desc["client_key"]
    entry["active_client_label"] = client_desc["client_label"]

    has_any_native_client = incoming_is_native or prev_is_native or any(bool(c.get("full_access")) for c in all_clients)
    if has_any_native_client:
        native_c = next((c for c in all_clients if c.get("full_access")), None)
        primary_client_type = (
            incoming_client_type if incoming_is_native else (
                (native_c.get("client_type") if native_c else None) or entry.get("client_type") or "ubuntu_native"
            )
        )
    else:
        primary_client_type = incoming_client_type

    if primary_client_type == "ubuntu_native":
        primary_client_label = "App Nativa Ubuntu (.deb)"
    elif primary_client_type == "android_native":
        primary_client_label = "App Nativa Android (.apk)"
    else:
        primary_client_label = client_desc["client_label"]

    access_level = "FULL_NATIVE_ACCESS" if has_any_native_client else "WEB_SANDBOX"
    merged_tel["client_type"] = primary_client_type
    merged_tel["client_label"] = primary_client_label
    merged_tel["access_level"] = access_level
    merged_tel["full_access"] = has_any_native_client

    # Nombre descriptivo del dispositivo físico (sin mezclar el navegador si se conoce el modelo de hardware)
    custom_alias = entry.get("custom_alias", "").strip()
    hw_model_name = (
        merged_tel.get("name")
        or (
            f"{merged_tel.get('manufacturer', '')} {merged_tel.get('model', '')}".strip()
            if (merged_tel.get("manufacturer") or merged_tel.get("model"))
            else ""
        )
    )
    if hw_model_name and hw_model_name.lower() in ("cliente web", "cliente web linux", "cliente web windows"):
        hw_model_name = ""
    ua_parsed_name = parse_user_agent(ua)
    device_only_ua_name = ua_parsed_name.split("•")[0].strip() if "•" in ua_parsed_name else ua_parsed_name
    auto_name = hw_model_name or device_only_ua_name or ua_parsed_name

    if custom_alias:
        entry["name"] = custom_alias
    elif auto_name and (
        not entry.get("name")
        or entry.get("name") in ("Dispositivo", "Dispositivo desconocido", "PC", "Linux PC", "Android")
        or "•" in str(entry.get("name", ""))
        or incoming_is_native
    ):
        entry["name"] = auto_name

    entry["auto_name"] = auto_name
    entry["client_type"] = primary_client_type
    entry["client_label"] = primary_client_label
    entry["access_level"] = access_level
    entry["full_access"] = has_any_native_client
    entry["app_version"] = merged_tel.get("app_version") or entry.get("app_version") or get_app_version()

    norm_hw_id = normalize_hardware_id(merged_tel.get("hardware_id") or entry.get("hardware_id") or "")
    if norm_hw_id:
        entry["hardware_id"] = norm_hw_id
        merged_tel["hardware_id"] = norm_hw_id

    phys_key = compute_physical_device_key(entry, norm_ip if is_local else client_ip, ua, is_local=is_local)
    entry["physical_key"] = phys_key
    entry["certificate_serial"] = generate_certificate_serial(entry.get("id", "dev"), phys_key)
    entry["certificate_scope"] = "PER_PHYSICAL_DEVICE"

    entry["connection_mode"] = "LAN" if is_local else "WAN"
    if is_local:
        entry["local_ip"] = norm_ip or client_ip
    else:
        entry["last_external_ip"] = client_ip
        if norm_ip and not entry.get("local_ip"):
            entry["local_ip"] = norm_ip
    if ua:
        entry["user_agent"] = ua[:220]
    entry["device_telemetry"] = merged_tel
    return entry


def find_device_by_id_or_physical(devices, verified_device_id, tel, client_ip, ua, is_local):
    """
    Localiza el registro único del dispositivo físico ya sea por su ID de certificado,
    por un alias_id fusionado previamente, o por su identidad física de hardware/red (MAC, IP LAN + SO, hardware_id).
    """
    if verified_device_id:
        if verified_device_id in devices:
            return verified_device_id, devices[verified_device_id], False
        for ex_id, ex_dev in devices.items():
            if verified_device_id in (ex_dev.get("alias_ids") or []):
                return ex_id, ex_dev, True

    if not is_local and not tel:
        return None, None, False

    cand_phys = compute_physical_device_key(tel, client_ip, ua, is_local=is_local)
    cand_lan = normalize_lan_ip((tel or {}).get("local_ip") or (client_ip if is_local else ""))
    cand_os = extract_os_family(ua, tel)
    cand_hw = normalize_hardware_id((tel or {}).get("hardware_id") or "")
    cand_mac = str((tel or {}).get("mac_address") or resolve_arp_mac_for_ip(cand_lan) or "").strip().lower()

    for ex_id, ex_dev in devices.items():
        if not ex_dev.get("trusted", True):
            continue
        ex_tel = ex_dev.get("device_telemetry") if isinstance(ex_dev.get("device_telemetry"), dict) else {}
        ex_phys = ex_dev.get("physical_key") or compute_physical_device_key(ex_dev, ex_dev.get("local_ip", ""), ex_dev.get("user_agent", ""), is_local=True)
        if cand_phys and ex_phys and cand_phys == ex_phys:
            return ex_id, ex_dev, True
        ex_mac = str(ex_tel.get("mac_address") or "").strip().lower()
        if cand_mac and ex_mac and cand_mac == ex_mac and cand_mac != "00:00:00:00:00:00":
            return ex_id, ex_dev, True
        ex_hw = normalize_hardware_id(ex_dev.get("hardware_id") or ex_tel.get("hardware_id") or "")
        if cand_hw and ex_hw and cand_hw == ex_hw:
            return ex_id, ex_dev, True
        if is_local and cand_lan and not cand_lan.startswith("Externo"):
            ex_lan = normalize_lan_ip(ex_dev.get("local_ip") or ex_tel.get("local_ip") or "")
            ex_os = extract_os_family(ex_dev.get("user_agent", ""), ex_tel)
            if cand_lan == ex_lan and cand_os == ex_os and cand_os != "other":
                return ex_id, ex_dev, True

    return None, None, False


def check_trust_status(handler):
    """
    Verifica el origen de la petición y valida el certificado HMAC por dispositivo físico.
    - Los certificados se emiten por DISPOSITIVO FÍSICO (no por cada navegador/cliente aislado).
    - Múltiples clientes del mismo dispositivo comparten el certificado del equipo y se agrupan bajo él.
    """
    client_ip = get_client_ip(handler)
    is_local = is_local_ip(client_ip)
    norm_client_ip = normalize_lan_ip(client_ip) if is_local else client_ip

    # Extraer credencial HMAC: verificar Authorization Bearer, cabecera X-Device-Token o Cookie _sysmon_trust
    token = None
    auth_hdr = handler.headers.get('Authorization', '')
    if auth_hdr and auth_hdr.lower().startswith('bearer '):
        token = auth_hdr[7:].strip()
    if not token:
        x_tok = handler.headers.get('X-Device-Token', '')
        if x_tok:
            token = x_tok.strip()
    if not token:
        cookie_header = handler.headers.get('Cookie', '')
        if cookie_header:
            c = cookies.SimpleCookie()
            try:
                c.load(cookie_header)
                if '_sysmon_trust' in c:
                    token = c['_sysmon_trust'].value
            except Exception:
                pass

    hdr_telemetry = extract_header_telemetry(handler)
    ua = handler.headers.get('User-Agent', '')
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with TRUST_LOCK:
        devices = load_trusted_devices()
        verified_device_id = verify_device_token(token) if token else None
        matched_id, device_entry, token_needs_unification = find_device_by_id_or_physical(
            devices, verified_device_id, hdr_telemetry, norm_client_ip, ua, is_local
        )

        new_token = None
        if matched_id and (token_needs_unification or not token or verified_device_id != matched_id):
            verified_device_id = matched_id
            new_token = create_device_token(matched_id)
            token = new_token

        if is_local:
            # Omitir persistencia de tokens para herramientas CLI locales sin telemetría nativa
            if ua.startswith(('curl/', 'Wget/', 'python-requests', 'Go-http-client', 'Python-urllib')) and not hdr_telemetry:
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "client_ip": norm_client_ip,
                    "device_info": {"id": "cli_local", "name": "Herramienta Local (CLI)", "trusted": True},
                    "device_id": "cli_local",
                    "new_token": None,
                    "token": None
                }

            # Si el dispositivo físico ya existe y es de confianza, reutilizar su certificado único y agrupar el cliente
            if device_entry and device_entry.get("trusted", True):
                device_entry["last_seen"] = now_iso
                device_entry["verified_in_lan"] = True
                device_entry["trusted"] = True
                enrich_device_entry(device_entry, ua, hdr_telemetry, norm_client_ip, is_local=True)
                save_trusted_devices(devices)
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "client_ip": norm_client_ip,
                    "device_info": device_entry,
                    "device_id": verified_device_id,
                    "new_token": new_token,
                    "token": token
                }
            else:
                # Dispositivo físico nuevo en LAN: emitir certificado único de dispositivo
                dev_id = f"dev_{secrets.token_hex(6)}"
                new_token = create_device_token(dev_id)
                ua_parsed = parse_user_agent(ua)
                device_name = ua_parsed.split("•")[0].strip() if "•" in ua_parsed else ua_parsed
                device_entry = {
                    "id": dev_id,
                    "alias_ids": [dev_id],
                    "name": device_name,
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                    "local_ip": norm_client_ip,
                    "last_external_ip": "",
                    "user_agent": ua[:220],
                    "verified_in_lan": True,
                    "trusted": True
                }
                enrich_device_entry(device_entry, ua, hdr_telemetry, norm_client_ip, is_local=True)
                devices[dev_id] = device_entry
                save_trusted_devices(devices)
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "client_ip": norm_client_ip,
                    "device_info": device_entry,
                    "device_id": dev_id,
                    "new_token": new_token,
                    "token": new_token
                }
        else:
            # Petición desde el EXTERIOR (Datos móviles / WAN)
            if device_entry and device_entry.get("trusted", False) and device_entry.get("verified_in_lan", True):
                device_entry["last_seen"] = now_iso
                device_entry["last_external_ip"] = client_ip
                enrich_device_entry(device_entry, ua, hdr_telemetry, client_ip, is_local=False)
                save_trusted_devices(devices)
                return {
                    "is_local": False,
                    "is_trusted": True,
                    "client_ip": client_ip,
                    "device_info": device_entry,
                    "device_id": verified_device_id,
                    "new_token": new_token,
                    "token": token
                }
            else:
                return {
                    "is_local": False,
                    "is_trusted": False,
                    "client_ip": client_ip,
                    "device_info": None,
                    "device_id": None,
                    "new_token": None,
                    "token": None
                }

def get_locked_page_html(client_ip):
    """Página interactiva y segura para autorizar dispositivos remotos mediante la clave maestra."""
    dom = detect_system_dns_domain()
    return f"""<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Acceso al Servidor • Autorización Requerida ({dom})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg: #0B0F17;
      --card-bg: #111827;
      --border: #1E293B;
      --border-focus: #0EA5E9;
      --primary: #0284C7;
      --primary-hover: #0EA5E9;
      --text: #F8FAFC;
      --text-dim: #94A3B8;
      --success: #10B981;
      --error: #EF4444;
      --font: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
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
      -webkit-font-smoothing: antialiased;
    }}
    .auth-card {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 34px 30px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    }}
    .auth-icon-squircle {{
      width: 60px;
      height: 60px;
      border-radius: 16px;
      background: linear-gradient(135deg, #0082c9, #005686);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      margin: 0 auto 18px;
      box-shadow: 0 6px 18px rgba(0, 130, 201, 0.35);
    }}
    h1 {{
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #ffffff;
      margin-bottom: 8px;
    }}
    .badge-unpaired {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      background: rgba(255, 204, 0, 0.12);
      border: 1px solid rgba(255, 204, 0, 0.3);
      color: #ffd13b;
      font-size: 11.5px;
      font-weight: 600;
      margin-bottom: 16px;
    }}
    .desc {{
      font-size: 13.5px;
      color: var(--text-dim);
      line-height: 1.55;
      margin-bottom: 20px;
      text-align: left;
    }}
    .info-box {{
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 12px;
      color: #bbbbbb;
      line-height: 1.5;
      text-align: left;
      margin-bottom: 20px;
    }}
    .info-box strong {{
      color: #ffffff;
    }}
    .input-box {{
      position: relative;
      margin-bottom: 16px;
    }}
    input[type="password"], input[type="text"] {{
      width: 100%;
      padding: 12px 42px 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #181818;
      color: #ffffff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }}
    input:focus {{
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(0, 145, 242, 0.25);
    }}
    .toggle-pwd-btn {{
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .toggle-pwd-btn:hover {{
      color: #ffffff;
    }}
    button[type="submit"] {{
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: none;
      background: var(--primary);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }}
    button[type="submit"]:hover:not(:disabled) {{
      background: var(--primary-hover);
    }}
    button[type="submit"]:disabled {{
      opacity: 0.5;
      cursor: not-allowed;
    }}
    .status-msg {{
      margin-top: 14px;
      font-size: 12.5px;
      line-height: 1.4;
      min-height: 20px;
    }}
    .badge-ip {{
      display: inline-block;
      margin-top: 22px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      padding: 4px 10px;
      border-radius: 20px;
    }}
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="auth-icon-squircle">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
    <h1>Servidor Cminewar</h1>
    <div class="badge-unpaired">🔒 Dispositivo Externo No Vinculado</div>
    
    <p class="desc">
      El acceso remoto a través de datos móviles (4G/5G) o redes externas requiere que el dispositivo esté vinculado para prevenir intrusiones.
    </p>

    <div class="info-box">
      <strong>¿Cómo acceder?</strong><br>
      • <strong>Automático:</strong> Conecta este dispositivo a la red Wi-Fi local de casa una vez.<br>
      • <strong>Inmediato:</strong> Introduce abajo la <strong>Clave Maestra de Rescate</strong> para vincularlo ahora mismo.
    </div>

    <form id="authForm" onsubmit="handleAuth(event)">
      <div class="input-box">
        <input type="password" id="masterKey" placeholder="Clave maestra de administrador" autofocus required />
        <button type="button" class="toggle-pwd-btn" onclick="togglePasswordVisibility()" title="Mostrar/ocultar clave">
          <svg id="eyeIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <button type="submit" id="btnSubmit">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Autorizar Dispositivo</span>
      </button>
    </form>
    <div class="status-msg" id="statusMsg"></div>
    <div class="badge-ip">IP Origen: {client_ip}</div>
  </div>

  <script>
    let countdownInterval = null;

    function togglePasswordVisibility() {{
      const input = document.getElementById('masterKey');
      if (input.type === 'password') {{
        input.type = 'text';
      }} else {{
        input.type = 'password';
      }}
    }}

    function startLockoutCountdown(seconds) {{
      const btn = document.getElementById('btnSubmit');
      const msg = document.getElementById('statusMsg');
      btn.disabled = true;
      let remaining = seconds;

      if (countdownInterval) clearInterval(countdownInterval);
      countdownInterval = setInterval(() => {{
        remaining--;
        if (remaining <= 0) {{
          clearInterval(countdownInterval);
          btn.disabled = false;
          btn.innerHTML = '<span>Intentar Nuevamente</span>';
          msg.style.color = 'var(--text-dim)';
          msg.textContent = 'El bloqueo temporal ha finalizado. Puedes volver a intentarlo.';
        }} else {{
          msg.style.color = 'var(--error)';
          msg.textContent = `Demasiados intentos fallidos. IP temporalmente bloqueada (${{remaining}}s restantes).`;
        }}
      }}, 1000);
    }}

    async function handleAuth(e) {{
      e.preventDefault();
      const key = document.getElementById('masterKey').value.trim();
      const btn = document.getElementById('btnSubmit');
      const msg = document.getElementById('statusMsg');
      if (!key) return;

      btn.disabled = true;
      btn.innerHTML = '<span>Verificando...</span>';
      msg.textContent = '';

      try {{
        const res = await fetch('/api/auth/unlock', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ key: key }})
        }});
        const data = await res.json();
        if (res.ok && data.success) {{
          if (data.token) {{
            try {{ localStorage.setItem('sysmon_device_token', data.token); }} catch(e) {{}}
          }}
          msg.style.color = 'var(--success)';
          msg.textContent = '¡Dispositivo autorizado con éxito! Recargando monitor...';
          setTimeout(() => {{ window.location.reload(); }}, 600);
        }} else if (res.status === 429) {{
          const retrySec = parseInt(res.headers.get('Retry-After') || '900', 10);
          startLockoutCountdown(retrySec);
        }} else {{
          msg.style.color = 'var(--error)';
          msg.textContent = data.error || 'Clave incorrecta.';
          btn.disabled = false;
          btn.innerHTML = '<span>Autorizar Dispositivo</span>';
        }}
      }} catch (err) {{
        msg.style.color = 'var(--error)';
        msg.textContent = 'Error conectando con el servidor.';
        btn.disabled = false;
        btn.innerHTML = '<span>Autorizar Dispositivo</span>';
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
        freq_current = round(freq.current, 1) if freq and freq.current else 0.0
        freq_max = round(freq.max, 1) if freq and freq.max else 0.0
        freq_min = round(freq.min, 1) if freq and freq.min else 0.0
        if freq_current <= 0:
            try:
                with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as f:
                    freqs = []
                    for line in f:
                        if "cpu MHz" in line:
                            freqs.append(float(line.split(":", 1)[1].strip()))
                    if freqs:
                        freq_current = round(sum(freqs) / len(freqs), 1)
            except Exception:
                pass
        cpu_temp = None
        try:
            if os.path.isdir("/sys/class/hwmon"):
                for hw in os.listdir("/sys/class/hwmon"):
                    hw_dir = os.path.join("/sys/class/hwmon", hw)
                    name_f = os.path.join(hw_dir, "name")
                    if os.path.exists(name_f):
                        with open(name_f, "r") as nf:
                            hw_name = nf.read().strip().lower()
                            if any(k in hw_name for k in ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz", "package")):
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
            "architecture": CPU_ARCH,
            "vendor": CPU_VENDOR,
            "cache_size": CPU_CACHE,
            "logical_cores": CORES_LOGICAL,
            "physical_cores": CORES_PHYSICAL,
            "usage_percent": cpu_percent,
            "per_core_percent": per_cpu,
            "freq_mhz": freq_current,
            "freq_max_mhz": freq_max,
            "freq_min_mhz": freq_min,
            "temp_c": cpu_temp,
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2)
        }
    except Exception as e:
        return {"error": str(e), "model": CPU_MODEL, "architecture": CPU_ARCH, "usage_percent": 0.0, "per_core_percent": [], "temp_c": None}

def get_gpu_info():
    try:
        xml_out = subprocess.check_output(['nvidia-smi', '-q', '-x'], timeout=3).decode('utf-8', errors='ignore')
        root = ET.fromstring(xml_out)
        gpu = root.find('gpu')
        if gpu is None:
            return {"available": False, "gpu_procs_map": {}}
        
        name = (gpu.findtext('product_name') or '').strip()
        driver = (root.findtext('driver_version') or gpu.findtext('driver_version') or '').strip()
        cuda = (root.findtext('cuda_version') or '').strip()
        temp_str = gpu.findtext('temperature/gpu_temp', '')
        temp = int(temp_str.replace('C', '').strip()) if temp_str and temp_str != 'N/A' else None
        
        gpu_util_str = gpu.findtext('utilization/gpu_util', '0')
        gpu_util = int(gpu_util_str.replace('%', '').strip()) if gpu_util_str and gpu_util_str != 'N/A' else 0
        
        mem_util_str = gpu.findtext('utilization/memory_util', '0')
        mem_util = int(mem_util_str.replace('%', '').strip()) if mem_util_str and mem_util_str != 'N/A' else 0
        
        mem_total_str = gpu.findtext('fb_memory_usage/total', '0')
        mem_total = int(mem_total_str.replace('MiB', '').strip()) if mem_total_str and mem_total_str != 'N/A' else 0
        
        mem_used_str = gpu.findtext('fb_memory_usage/used', '0')
        mem_used = int(mem_used_str.replace('MiB', '').strip()) if mem_used_str and mem_used_str != 'N/A' else 0
        
        mem_free_str = gpu.findtext('fb_memory_usage/free', '0')
        mem_free = int(mem_free_str.replace('MiB', '').strip()) if mem_free_str and mem_free_str != 'N/A' else 0
        
        fan_str = gpu.findtext('fan_speed', '')
        fan = int(fan_str.replace('%', '').strip()) if fan_str and fan_str != 'N/A' else None
        
        power_str = gpu.findtext('gpu_power_readings/power_draw', '') or gpu.findtext('power_readings/power_draw', '')
        power = float(power_str.replace('W', '').strip()) if power_str and power_str != 'N/A' else None
        
        processes = []
        gpu_procs_map = {}
        for p in gpu.findall('processes/process_info'):
            pid_str = p.findtext('pid', '')
            pname = p.findtext('process_name', '')
            pmem = p.findtext('used_memory', '')
            ptype = p.findtext('type', '')
            
            clean_cmd = pname.strip() if pname else ''
            first_token = clean_cmd.split()[0] if clean_cmd else ''
            clean_name = os.path.basename(first_token) if first_token else 'Proceso GPU'
            
            try:
                pid_int = int(pid_str)
                vram_num = float(pmem.replace('MiB', '').replace('MB', '').strip())
                gpu_procs_map[pid_int] = {"vram_mb": vram_num, "type": ptype}
                
                if psutil.pid_exists(pid_int):
                    p_comm = psutil.Process(pid_int).name()
                    if p_comm:
                        clean_name = p_comm
            except Exception:
                pass
                
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
        # Fallback dinámico para GPU AMD / Intel integrada mediante sysfs / lspci
        try:
            lspci_out = subprocess.check_output(['lspci'], timeout=2).decode('utf-8', errors='ignore')
            for line in lspci_out.splitlines():
                if any(k in line for k in ('VGA compatible controller:', '3D controller:', 'Display controller:')):
                    gpu_name = line.split(':', 2)[-1].strip()
                    return {
                        "available": True,
                        "name": gpu_name,
                        "driver": "Linux Kernel DRM",
                        "cuda": "",
                        "temp_c": None,
                        "gpu_util_percent": 0,
                        "mem_util_percent": 0,
                        "vram_total_mb": 0,
                        "vram_used_mb": 0,
                        "vram_free_mb": 0,
                        "vram_percent": 0,
                        "fan_percent": None,
                        "power_watts": None,
                        "processes": [],
                        "gpu_procs_map": {}
                    }
        except Exception:
            pass
        return {"available": False, "name": "", "error": str(e), "gpu_procs_map": {}}

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
                emby_candidates = [
                    os.path.join(BASE_DIR, "emby", "library.db"),
                    os.path.join(BASE_DIR, "..", "emby", "programdata", "data", "library.db"),
                    "/home/servidor/servicios/emby/programdata/data/library.db"
                ]
                emby_db = next((p for p in emby_candidates if os.path.isfile(p)), "")
                if emby_db and os.path.exists(emby_db):
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
                st_candidates = [
                    os.path.join(BASE_DIR, "control_acceso_s10", "estado.json"),
                    os.path.join(BASE_DIR, "estado.json"),
                    os.path.join(BASE_DIR, "..", "control_acceso_s10", "estado.json"),
                    "/home/servidor/servicios/control_acceso_s10/estado.json"
                ]
                st_file = next((p for p in st_candidates if os.path.isfile(p)), "")
                if st_file and os.path.exists(st_file):
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

def get_ip_to_device_name_map():
    arp_mac_map = get_arp_and_pihole_names()
    ip_to_name = {}
    for mac, data in arp_mac_map.items():
        if isinstance(data, dict) and 'ip' in data and 'name' in data:
            ip_to_name[data['ip']] = data['name']
    return ip_to_name

DUCKDNS_SCRIPT_CANDIDATES = [
    # 1. Rutas relativas al repositorio (GitHub / Google AI Studio / Simulador)
    os.path.join(BASE_DIR, "duckdns", "duck.sh"),
    os.path.join(BASE_DIR, "duck.sh"),
    os.path.join(BASE_DIR, "..", "duckdns", "duck.sh"),
    os.path.join(BASE_DIR, "servicios", "duckdns", "duck.sh"),
    "./duckdns/duck.sh",
    "./duck.sh",
    # 2. Rutas del servidor local físico
    "/home/servidor/servicios/duckdns/duck.sh",
    "/home/servidor/duckdns/duck.sh"
]

def get_duckdns_script_file():
    for p in DUCKDNS_SCRIPT_CANDIDATES:
        if os.path.isfile(p):
            return p
    return DUCKDNS_SCRIPT_CANDIDATES[0]

DUCKDNS_SCRIPT = get_duckdns_script_file()

DUCKDNS_LOG_CANDIDATES = [
    # 1. Rutas relativas al repositorio (GitHub / Google AI Studio / Simulador)
    os.path.join(BASE_DIR, "duck.log"),
    os.path.join(BASE_DIR, "duckdns", "duck.log"),
    os.path.join(BASE_DIR, "..", "duckdns", "duck.log"),
    os.path.join(BASE_DIR, "logs", "duck.log"),
    "./duck.log",
    # 2. Rutas del servidor local físico
    "/mnt/almacenamiento/logs/duckdns/duck.log",
    "/home/servidor/servicios/duckdns/duck.log"
]

def get_duckdns_log_file():
    for p in DUCKDNS_LOG_CANDIDATES:
        if os.path.isfile(p):
            return p
    return DUCKDNS_LOG_CANDIDATES[0]

DUCKDNS_IP_CACHE_CANDIDATES = [
    # 1. Rutas relativas al repositorio (GitHub / Google AI Studio / Simulador)
    os.path.join(BASE_DIR, "last_ip.txt"),
    os.path.join(BASE_DIR, "duckdns", "last_ip.txt"),
    os.path.join(BASE_DIR, "..", "duckdns", "last_ip.txt"),
    "./last_ip.txt",
    # 2. Rutas del servidor local físico
    "/home/servidor/servicios/duckdns/last_ip.txt",
    "/home/servidor/duckdns/last_ip.txt"
]

def get_duckdns_ip_cache_file():
    for p in DUCKDNS_IP_CACHE_CANDIDATES:
        if os.path.isfile(p):
            return p
    return DUCKDNS_IP_CACHE_CANDIDATES[0]

DUCKDNS_IP_CACHE = get_duckdns_ip_cache_file()

def get_duckdns_status():
    domain = "cminewar"
    token = ""
    script_p = get_duckdns_script_file()
    if os.path.isfile(script_p):
        try:
            with open(script_p, "r", encoding="utf-8") as f:
                content = f.read()
                m_dom = re.search(r'DOMAIN=["\']?([^"\'\s]+)["\']?', content)
                m_tok = re.search(r'TOKEN=["\']?([^"\'\s]+)["\']?', content)
                if m_dom:
                    domain = m_dom.group(1)
                if m_tok:
                    token = m_tok.group(1)
        except Exception:
            pass

    last_ip = ""
    ip_cache_p = get_duckdns_ip_cache_file()
    if os.path.isfile(ip_cache_p):
        try:
            with open(ip_cache_p, "r", encoding="utf-8") as f:
                last_ip = f.read().strip()
        except Exception:
            pass

    log_file = get_duckdns_log_file()
    last_log_line = ""
    last_update_time = ""
    if os.path.isfile(log_file):
        try:
            with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                lines = [l.strip() for l in f if l.strip()]
                if lines:
                    last_log_line = lines[-1]
                    m_ts = re.search(r'\[(.*?)\]', last_log_line)
                    if m_ts:
                        last_update_time = m_ts.group(1)
        except Exception:
            pass

    masked_token = (token[:4] + "*" * (len(token) - 8) + token[-4:]) if len(token) > 8 else "****"

    upstream_dns = []
    try:
        with open("/etc/resolv.conf", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("nameserver"):
                    parts = line.split()
                    if len(parts) > 1:
                        upstream_dns.append(parts[1])
    except Exception:
        pass

    return {
        "installed": os.path.isfile(script_p),
        "domain": domain,
        "full_domain": f"{domain}.duckdns.org",
        "token": token,
        "token_masked": masked_token,
        "last_registered_ip": last_ip,
        "last_log_entry": last_log_line,
        "last_update_time": last_update_time,
        "log_path": log_file,
        "script_path": script_p,
        "upstream_dns": upstream_dns
    }

def get_duckdns_logs(limit=60):
    log_file = get_duckdns_log_file()
    if not os.path.isfile(log_file):
        return []
    try:
        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = [l.strip() for l in f if l.strip()]
            return lines[-limit:]
    except Exception as e:
        return [f"Error leyendo log: {e}"]

def update_duckdns_now():
    script_p = get_duckdns_script_file()
    if not os.path.isfile(script_p):
        return {"success": False, "message": "Script duck.sh no encontrado"}
    try:
        res = subprocess.run(["bash", script_p], capture_output=True, text=True, timeout=25)
        st = get_duckdns_status()
        return {
            "success": res.returncode == 0,
            "returncode": res.returncode,
            "stdout": res.stdout.strip(),
            "stderr": res.stderr.strip(),
            "status": st
        }
    except Exception as e:
        return {"success": False, "message": str(e)}


def get_dns_traffic_stats(client_filter=None, limit=50):
    db_path = "/etc/pihole/pihole-FTL.db"
    if not os.path.isfile(db_path):
        return {"available": False, "clients": [], "queries": []}

    ip_to_name = get_ip_to_device_name_map()

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.5)
        cur = conn.cursor()

        sql_clients = (
            "SELECT client, count(*) as count, "
            "sum(CASE WHEN status IN (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16) THEN 1 ELSE 0 END) as blocked "
            "FROM queries WHERE timestamp >= strftime('%s', 'now', '-24 hours') "
            "GROUP BY client ORDER BY count DESC LIMIT 25;"
        )
        client_rows = cur.execute(sql_clients).fetchall()

        clients_list = []
        for row in client_rows:
            c_ip = row[0]
            c_total = int(row[1] or 0)
            c_blocked = int(row[2] or 0)
            c_name = ip_to_name.get(c_ip, c_ip)

            sql_top_doms = (
                "SELECT domain, count(*) as c FROM queries "
                "WHERE client = ? AND timestamp >= strftime('%s', 'now', '-24 hours') "
                "GROUP BY domain ORDER BY c DESC LIMIT 3;"
            )
            top_doms = [
                {"domain": d_row[0], "count": int(d_row[1])}
                for d_row in cur.execute(sql_top_doms, (c_ip,)).fetchall()
                if d_row[0]
            ]

            clients_list.append({
                "ip": c_ip,
                "name": c_name,
                "total": c_total,
                "blocked": c_blocked,
                "pct_blocked": round((c_blocked / c_total * 100), 1) if c_total > 0 else 0.0,
                "top_domains": top_doms
            })

        if client_filter:
            sql_recent = (
                "SELECT timestamp, client, domain, status, forward, reply_time "
                "FROM queries WHERE client = ? ORDER BY id DESC LIMIT ?;"
            )
            recent_rows = cur.execute(sql_recent, (client_filter, limit)).fetchall()
        else:
            sql_recent = (
                "SELECT timestamp, client, domain, status, forward, reply_time "
                "FROM queries ORDER BY id DESC LIMIT ?;"
            )
            recent_rows = cur.execute(sql_recent, (limit,)).fetchall()

        conn.close()

        queries_list = []
        for q in recent_rows:
            ts = int(q[0] or 0)
            c_ip = q[1] or ""
            domain = q[2] or ""
            status = int(q[3] or 0)
            forward = q[4] or "Sinkhole / Cache"
            reply_time = round(float(q[5] or 0) * 1000, 1)

            is_blocked = status in (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16)
            dt_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S")

            queries_list.append({
                "time": dt_str,
                "timestamp": ts,
                "client_ip": c_ip,
                "client_name": ip_to_name.get(c_ip, c_ip),
                "domain": domain,
                "status": status,
                "is_blocked": is_blocked,
                "forward": forward,
                "reply_ms": reply_time
            })

        return {
            "available": True,
            "clients": clients_list,
            "recent_queries": queries_list
        }
    except Exception as e:
        return {"available": False, "error": str(e), "clients": [], "recent_queries": []}

BRAND_DOMAINS_MAP = {
    "ubuntu": ("Ubuntu Linux", "ubuntu.com", "https://cdn.simpleicons.org/ubuntu/E95420"),
    "debian": ("Debian GNU/Linux", "debian.org", "https://cdn.simpleicons.org/debian/A81D33"),
    "arch": ("Arch Linux", "archlinux.org", "https://cdn.simpleicons.org/archlinux/1793D1"),
    "fedora": ("Fedora Linux", "fedoraproject.org", "https://cdn.simpleicons.org/fedora/51A2DA"),
    "alpine": ("Alpine Linux", "alpinelinux.org", "https://cdn.simpleicons.org/alpinelinux/0D597F"),
    "kali": ("Kali Linux", "kali.org", "https://cdn.simpleicons.org/kalilinux/557C94"),
    "linuxmint": ("Linux Mint", "linuxmint.com", "https://cdn.simpleicons.org/linuxmint/87CF3E"),
    "manjaro": ("Manjaro", "manjaro.org", "https://cdn.simpleicons.org/manjaro/35BF5C"),
    "opensuse": ("openSUSE", "opensuse.org", "https://cdn.simpleicons.org/opensuse/73BA25"),
    "redhat": ("Red Hat Enterprise Linux", "redhat.com", "https://cdn.simpleicons.org/redhat/EE0000"),
    "centos": ("CentOS", "centos.org", "https://cdn.simpleicons.org/centos/262577"),
    "rocky": ("Rocky Linux", "rockylinux.org", "https://cdn.simpleicons.org/rockylinux/10B981"),
    "almalinux": ("AlmaLinux", "almalinux.org", "https://cdn.simpleicons.org/almalinux/38BDF8"),
    "proxmox": ("Proxmox VE", "proxmox.com", "https://cdn.simpleicons.org/proxmox/E57000"),
    "raspbian": ("Raspberry Pi OS", "raspberrypi.com", "https://cdn.simpleicons.org/raspberrypi/A22846"),
    "linux": ("Linux OS", "kernel.org", "https://cdn.simpleicons.org/linux/FCC624"),
    "nintendo": ("Nintendo", "nintendo.com", "https://www.google.com/s2/favicons?sz=128&domain=nintendo.com"),
    "xbox": ("Microsoft Xbox", "xbox.com", "https://www.google.com/s2/favicons?sz=128&domain=xbox.com"),
    "playstation": ("Sony PlayStation", "playstation.com", "https://cdn.simpleicons.org/playstation/0070D1"),
    "sony": ("Sony", "sony.com", "https://www.google.com/s2/favicons?sz=128&domain=sony.com"),
    "samsung": ("Samsung", "samsung.com", "https://www.google.com/s2/favicons?sz=128&domain=samsung.com"),
    "xiaomi": ("Xiaomi", "mi.com", "https://cdn.simpleicons.org/xiaomi/FF6900"),
    "google": ("Google", "google.com", "https://www.google.com/s2/favicons?sz=128&domain=google.com"),
    "asus": ("ASUS", "asus.com", "https://www.google.com/s2/favicons?sz=128&domain=asus.com"),
    "vodafone": ("Vodafone", "vodafone.es", "https://www.google.com/s2/favicons?sz=128&domain=vodafone.com"),
    "synology": ("Synology", "synology.com", "https://cdn.simpleicons.org/synology/B5B5B6"),
    "tplink": ("TP-Link Tapo", "tp-link.com", "https://cdn.simpleicons.org/tplink/4ACBD6"),
    "espressif": ("Espressif IoT", "espressif.com", "https://cdn.simpleicons.org/espressif/E7352C"),
    "tuya": ("Tuya Smart", "tuya.com", "https://www.google.com/s2/favicons?sz=128&domain=tuya.com"),
    "apple": ("Apple", "apple.com", "https://cdn.simpleicons.org/apple/F8FAFC"),
    "acer": ("Acer", "acer.com", "https://cdn.simpleicons.org/acer/83B81A"),
    "intel": ("Intel", "intel.com", "https://cdn.simpleicons.org/intel/0071C5"),
    "amd": ("AMD", "amd.com", "https://cdn.simpleicons.org/amd/ED1C24"),
    "nvidia": ("NVIDIA", "nvidia.com", "https://cdn.simpleicons.org/nvidia/76B900"),
    "realtek": ("Realtek", "realtek.com", "https://www.google.com/s2/favicons?sz=128&domain=realtek.com"),
    "hp": ("HP", "hp.com", "https://cdn.simpleicons.org/hp/0096D6"),
    "dell": ("Dell", "dell.com", "https://cdn.simpleicons.org/dell/007DB8"),
    "lenovo": ("Lenovo", "lenovo.com", "https://cdn.simpleicons.org/lenovo/E2231A"),
    "lg": ("LG Electronics", "lg.com", "https://cdn.simpleicons.org/lg/A50034"),
    "amazon": ("Amazon", "amazon.com", "https://www.google.com/s2/favicons?sz=128&domain=amazon.com"),
    "microsoft": ("Microsoft Windows", "microsoft.com", "https://www.google.com/s2/favicons?sz=128&domain=microsoft.com"),
    "ubiquiti": ("Ubiquiti UniFi", "ui.com", "https://cdn.simpleicons.org/ubiquiti/0559C9"),
    "mikrotik": ("MikroTik", "mikrotik.com", "https://cdn.simpleicons.org/mikrotik/293239"),
    "tailscale": ("Tailscale", "tailscale.com", "https://cdn.simpleicons.org/tailscale/F8FAFC"),
    "wireguard": ("WireGuard", "wireguard.com", "https://cdn.simpleicons.org/wireguard/88171A"),
    "docker": ("Docker", "docker.com", "https://cdn.simpleicons.org/docker/2496ED"),
}

def classify_device(name, mac):
    name_l = (name or "").lower()
    mac_u = (mac or "").upper()
    
    # 1. Detectar Marca / Fabricante
    brand = "generic"
    brand_name = "Dispositivo"
    
    if any(k in name_l for k in ["nintendo", "3ds", "2ds", "switch", "wii", "dsi"]):
        brand = "nintendo"
        brand_name = "Nintendo"
    elif any(k in name_l for k in ["xbox", "series-s", "series-x", "cminewar-s"]):
        brand = "xbox"
        brand_name = "Microsoft Xbox"
    elif any(k in name_l for k in ["playstation", "ps4", "ps5", "dualsense"]):
        brand = "playstation"
        brand_name = "Sony PlayStation"
    elif any(k in name_l for k in ["samsung", "s21", "s10", "s20", "s22", "s23", "s24", "s25", "galaxy", "tab-s"]):
        brand = "samsung"
        brand_name = "Samsung"
    elif any(k in name_l for k in ["xiaomi", "redmi", "poco"]):
        brand = "xiaomi"
        brand_name = "Xiaomi"
    elif any(k in name_l for k in ["google", "home-mini", "pixel", "chromecast", "nest"]):
        brand = "google"
        brand_name = "Google"
    elif any(k in name_l for k in ["asus", "rt-ax56u", "rog"]):
        brand = "asus"
        brand_name = "ASUS"
    elif any(k in name_l for k in ["vodafone"]):
        brand = "vodafone"
        brand_name = "Vodafone"
    elif any(k in name_l for k in ["synology", "diskstation"]):
        brand = "synology"
        brand_name = "Synology"
    elif any(k in name_l for k in ["tapo", "tp-link", "tplink", "archer", "deco"]):
        brand = "tplink"
        brand_name = "TP-Link Tapo"
    elif any(k in name_l for k in ["esp", "esp32", "esp8266", "espressif", "domotica", "enchufe"]):
        brand = "espressif"
        brand_name = "Espressif IoT"
    elif any(k in name_l for k in ["tuya", "smartlife"]):
        brand = "tuya"
        brand_name = "Tuya Smart"
    elif any(k in name_l for k in ["sony", "bravia", "xperia"]):
        brand = "sony"
        brand_name = "Sony"
    elif any(k in name_l for k in ["apple", "iphone", "ipad", "macbook", "imac", "airpods", "homepod"]):
        brand = "apple"
        brand_name = "Apple"
    elif any(k in name_l for k in ["acer", "nitro", "predator"]):
        brand = "acer"
        brand_name = "Acer"
    elif any(k in name_l for k in ["ubuntu"]):
        brand = "ubuntu"
        brand_name = "Ubuntu"
    elif any(k in name_l for k in ["debian"]):
        brand = "debian"
        brand_name = "Debian"
    elif any(k in name_l for k in ["raspberry", "raspbian", "pi-hole"]):
        brand = "raspbian"
        brand_name = "Raspberry Pi"
    elif any(k in name_l for k in ["intel", "xeon", "nuc"]):
        brand = "intel"
        brand_name = "Intel"
    elif any(k in name_l for k in ["lg", "webos"]):
        brand = "lg"
        brand_name = "LG"
    elif any(k in name_l for k in ["amazon", "echo", "alexa", "firetv", "kindle"]):
        brand = "amazon"
        brand_name = "Amazon"
    elif any(k in name_l for k in ["hp", "hewlett", "laserjet", "deskjet"]):
        brand = "hp"
        brand_name = "HP"
    elif any(k in name_l for k in ["dell", "alienware", "optiplex"]):
        brand = "dell"
        brand_name = "Dell"
    elif any(k in name_l for k in ["lenovo", "thinkpad", "ideapad"]):
        brand = "lenovo"
        brand_name = "Lenovo"
    elif any(k in name_l for k in ["windows", "surface", "desktop-"]):
        brand = "microsoft"
        brand_name = "Microsoft Windows"
    elif mac_u.startswith(("90:09:D0", "00:11:32")):
        brand = "synology"
        brand_name = "Synology"
    elif mac_u.startswith(("D4:5D:64", "C8:7F:54", "04:D4:C4", "2C:FD:A1")):
        brand = "asus"
        brand_name = "ASUS"

    # 2. Detectar Tipo e Icono
    if brand in ("nintendo", "xbox", "playstation") or any(k in name_l for k in ["playstation", "ps4", "ps5"]):
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
    elif any(k in name_l for k in ["asus", "router", "repeater", "gateway", "switch", "vodafone"]):
        dev_type = "network"
        dev_icon = "router"
    elif any(k in name_l for k in ["pc", "laptop", "desktop", "thinkpad", "macbook"]):
        dev_type = "computer"
        dev_icon = "laptop"
    else:
        dev_type = "device"
        dev_icon = "wifi"

    b_info = BRAND_DOMAINS_MAP.get(brand)
    brand_domain = b_info[1] if b_info else ""
    auto_logo_url = b_info[2] if b_info else ""

    return {
        "type": dev_type,
        "icon": dev_icon,
        "brand": brand,
        "brand_name": brand_name,
        "brand_domain": brand_domain,
        "auto_logo_url": auto_logo_url
    }

def search_logos_catalog(query):
    q = (query or "").strip().lower()
    results = []
    seen_urls = set()

    def add_item(title, subtitle, url, fallback_url=""):
        if not url or url in seen_urls:
            return
        seen_urls.add(url)
        results.append({
            "title": title,
            "subtitle": subtitle,
            "logo_url": url,
            "fallback_url": fallback_url or url
        })

    # 1. Coincidencias en el catálogo curado de sistemas operativos y fabricantes
    for key, (label, domain, primary_url) in BRAND_DOMAINS_MAP.items():
        if not q or q in key or q in label.lower() or q in domain.lower():
            google_fav = f"https://www.google.com/s2/favicons?sz=128&domain={domain}"
            add_item(label, f"Oficial · {domain}", primary_url, google_fav)
            if primary_url != google_fav:
                add_item(f"{label} (Google Icon)", domain, google_fav, primary_url)

    # 2. Si el usuario escribió un dominio o marca, buscar en vivo en Clearbit Autocomplete + Google Favicons
    if q and len(q) >= 2:
        try:
            req = urllib.request.Request(
                f"https://autocomplete.clearbit.com/v1/companies/suggest?query={urllib.parse.quote(q)}",
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if isinstance(data, list):
                    for item in data[:8]:
                        c_name = item.get("name") or q.capitalize()
                        c_dom = item.get("domain") or ""
                        c_logo = item.get("logo") or ""
                        g_fav = f"https://www.google.com/s2/favicons?sz=128&domain={c_dom}" if c_dom else ""
                        if c_logo:
                            add_item(c_name, f"Web · {c_dom}", c_logo, g_fav)
                        if g_fav:
                            add_item(f"{c_name} (Google Favicon)", c_dom, g_fav, c_logo)
        except Exception:
            pass

        # 3. Búsqueda directa por slug en SimpleIcons y Google S2 Favicon
        clean_slug = re.sub(r'[^a-z0-9.]', '', q)
        if "." in clean_slug:
            add_item(f"Dominio {clean_slug}", "Google Favicon S2 (128px)", f"https://www.google.com/s2/favicons?sz=128&domain={clean_slug}")
        elif clean_slug:
            add_item(f"{q.capitalize()} (SimpleIcons)", f"cdn.simpleicons.org/{clean_slug}", f"https://cdn.simpleicons.org/{clean_slug}")
            add_item(f"{q.capitalize()} (.com Google)", f"{clean_slug}.com", f"https://www.google.com/s2/favicons?sz=128&domain={clean_slug}.com")

    return results[:24]

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
        os_id = "linux"
        os_id_like = ""
        try:
            with open("/etc/os-release", "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("PRETTY_NAME="):
                        os_name = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("ID="):
                        os_id = line.split("=", 1)[1].strip().strip('"').strip("'").lower()
                    elif line.startswith("ID_LIKE="):
                        os_id_like = line.split("=", 1)[1].strip().strip('"').strip("'").lower()
        except Exception:
            pass

        lookup_key = os_id if os_id in BRAND_DOMAINS_MAP else (os_id_like.split()[0] if os_id_like and os_id_like.split()[0] in BRAND_DOMAINS_MAP else "linux")
        for cand in ("ubuntu", "debian", "arch", "fedora", "alpine", "kali", "linuxmint", "manjaro", "opensuse", "proxmox", "raspbian", "redhat", "centos", "rocky", "almalinux"):
            if cand in os_id or cand in os_name.lower():
                lookup_key = cand
                break

        b_tuple = BRAND_DOMAINS_MAP.get(lookup_key, BRAND_DOMAINS_MAP["linux"])
        os_domain = b_tuple[1]
        os_logo_url = b_tuple[2]

        return {
            "hostname": HOSTNAME,
            "os": os_name,
            "os_id": lookup_key,
            "os_domain": os_domain,
            "os_logo_url": os_logo_url,
            "kernel": KERNEL,
            "uptime_seconds": uptime_seconds,
            "uptime_str": uptime_str,
            "public_domain": detect_system_dns_domain(),
            "local_ip": SERVER_LOCAL_IP,
            "timestamp": time.time(),
            "time_str": time.strftime("%H:%M:%S")
        }
    except Exception:
        return {
            "uptime_str": "Unknown",
            "hostname": HOSTNAME,
            "os": "Linux",
            "os_id": "linux",
            "os_domain": "kernel.org",
            "os_logo_url": "https://cdn.simpleicons.org/linux/FCC624",
            "kernel": KERNEL,
            "public_domain": detect_system_dns_domain(),
            "local_ip": SERVER_LOCAL_IP
        }

def background_collector():
    global METRICS_CACHE, METRICS_CACHE_BYTES, HISTORY
    last_time = time.time()
    psutil.cpu_percent(interval=None, percpu=True)
    
    def get_real_net(prev_ifaces=None, dt_sec=1.0):
        per_nic = psutil.net_io_counters(pernic=True)
        if_addrs = psutil.net_if_addrs() if hasattr(psutil, 'net_if_addrs') else {}
        if_stats = psutil.net_if_stats() if hasattr(psutil, 'net_if_stats') else {}
        rx, tx = 0, 0
        interfaces = {}
        interfaces_list = []
        for nic_name, stats in per_nic.items():
            if nic_name == "lo" or nic_name.startswith(("veth", "docker", "br-")):
                continue
            rx += stats.bytes_recv
            tx += stats.bytes_sent

            ipv4_addr = ""
            ipv6_addr = ""
            mac_addr = ""
            for snic in if_addrs.get(nic_name, []):
                fam_name = getattr(snic.family, 'name', str(snic.family))
                if fam_name == 'AF_INET' or snic.family == socket.AF_INET:
                    ipv4_addr = snic.address
                elif fam_name == 'AF_INET6' or snic.family == socket.AF_INET6:
                    if not ipv6_addr:
                        ipv6_addr = snic.address.split('%')[0]
                elif 'PACKET' in fam_name or 'LINK' in fam_name or snic.address.count(':') == 5:
                    if snic.address and snic.address != '00:00:00:00:00:00':
                        mac_addr = snic.address.upper()

            st_info = if_stats.get(nic_name)
            is_up = bool(st_info.isup) if st_info else True
            speed_mbps = int(st_info.speed) if st_info and st_info.speed and st_info.speed > 0 else 0
            mtu = int(st_info.mtu) if st_info and st_info.mtu else 1500

            prev_nic = (prev_ifaces or {}).get(nic_name, {})
            nic_rx_sec = max(0.0, (stats.bytes_recv - prev_nic.get("bytes_recv", stats.bytes_recv)) / max(dt_sec, 0.001)) if prev_ifaces else 0.0
            nic_tx_sec = max(0.0, (stats.bytes_sent - prev_nic.get("bytes_sent", stats.bytes_sent)) / max(dt_sec, 0.001)) if prev_ifaces else 0.0

            nic_obj = {
                "name": nic_name,
                "ip": ipv4_addr,
                "ipv6": ipv6_addr,
                "mac": mac_addr,
                "is_up": is_up,
                "speed_mbps": speed_mbps,
                "mtu": mtu,
                "bytes_sent": stats.bytes_sent,
                "bytes_recv": stats.bytes_recv,
                "packets_sent": stats.packets_sent,
                "packets_recv": stats.packets_recv,
                "rx_bytes_sec": round(nic_rx_sec, 1),
                "tx_bytes_sec": round(nic_tx_sec, 1)
            }
            interfaces[nic_name] = nic_obj
            interfaces_list.append(nic_obj)
        return rx, tx, interfaces, interfaces_list

    def get_real_disk():
        per_disk = psutil.disk_io_counters(perdisk=True) or {}
        r_bytes, w_bytes = 0, 0
        for d_name, d_st in per_disk.items():
            if d_name.startswith(("loop", "ram", "dm-")) or (d_name.startswith("sd") and len(d_name) > 3) or ("nvme" in d_name and "p" in d_name):
                continue
            r_bytes += d_st.read_bytes
            w_bytes += d_st.write_bytes
        return r_bytes, w_bytes

    last_rx, last_tx, prev_ifaces_map, _ = get_real_net()
    last_r, last_w = get_real_disk()
    cycle_counter = 0
    cached_procs = []
    
    while True:
        try:
            now = time.time()
            dt = max(now - last_time, 0.001)
            last_time = now
            cycle_counter += 1
            
            curr_rx, curr_tx, interfaces, interfaces_list = get_real_net(prev_ifaces_map, dt)
            prev_ifaces_map = interfaces
            rx_bytes_sec = max(0, (curr_rx - last_rx) / dt)
            tx_bytes_sec = max(0, (curr_tx - last_tx) / dt)
            last_rx, last_tx = curr_rx, curr_tx

            # Accumulate rolling 2-hour bandwidth history per NIC (15s fixed buckets, 480 buckets across 7200s)
            with NIC_BANDWIDTH_LOCK:
                now_ms = int(now * 1000)
                bucket_ms = (now_ms // NIC_BUCKET_INTERVAL_MS) * NIC_BUCKET_INTERVAL_MS
                cutoff_ms = bucket_ms - (MAX_NIC_HISTORY_SECONDS * 1000)
                for nic_item in interfaces_list:
                    n_name = nic_item["name"]
                    n_hist = NIC_BANDWIDTH_HISTORY_2H.setdefault(n_name, [])
                    if not n_hist or n_hist[-1]["t"] < bucket_ms:
                        n_hist.append({
                            "t": bucket_ms,
                            "rx": nic_item["rx_bytes_sec"],
                            "tx": nic_item["tx_bytes_sec"]
                        })
                    else:
                        n_hist[-1]["rx"] = max(n_hist[-1]["rx"], nic_item["rx_bytes_sec"])
                        n_hist[-1]["tx"] = max(n_hist[-1]["tx"], nic_item["tx_bytes_sec"])
                    
                    while n_hist and n_hist[0]["t"] < cutoff_ms:
                        n_hist.pop(0)
                    
                    # Incluir history_2h únicamente en interfaces_list (evita triplicar el payload JSON)
                    nic_item["history_2h"] = list(n_hist)
                    if n_name in interfaces:
                        interfaces[n_name] = {k: v for k, v in nic_item.items() if k != "history_2h"}
            _save_nic_history_2h_if_needed(now)
            
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
            
            with CONNECTIONS_MAP_LOCK:
                conn_map_data = dict(CONNECTIONS_MAP_CACHE)

            net_info = {
                "rx_bytes_sec": rx_bytes_sec,
                "tx_bytes_sec": tx_bytes_sec,
                "rx_total_bytes": curr_rx,
                "tx_total_bytes": curr_tx,
                "local_ip": SERVER_LOCAL_IP,
                "interfaces": interfaces,
                "interfaces_list": interfaces_list,
                "connections_map": conn_map_data
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

            with TELEGRAM_BOT_LOCK:
                telegram_bot_act = dict(TELEGRAM_BOT_CACHE)

            sys_errors_summary = get_system_errors_summary()

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
                "history": HISTORY,
                "telegram_bot": telegram_bot_act,
                "system_errors_summary": sys_errors_summary
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
VALID_WEB_ROUTES = {
    "/",
    "/index.html",
    "/resumen",
    "/procesador",
    "/memoria",
    "/grafica",
    "/almacenamiento",
    "/red",
    "/seguridad",
    "/aplicaciones",
    "/multimedia",
    "/descargas",
    "/procesos",
    "/sistema",
    "/version",
    "/dns",
    "/duckdns"
}

def send_wol_magic_packet(mac_str):
    """
    Envía paquetes mágicos Wake-on-LAN multivía y multired:
    1. Socket UDP broadcast a la subred LAN directa (192.168.50.255:9 y :7).
    2. Socket UDP broadcast global (255.255.255.255:9).
    3. Binario wakeonlan apuntando explícitamente a la subred 192.168.50.255.
    """
    clean_mac = re.sub(r'[^0-9A-Fa-f]', '', mac_str)
    if len(clean_mac) != 12:
        return False

    hw_addr = bytes.fromhex(clean_mac)
    magic = b'\xff' * 6 + hw_addr * 16

    targets = [
        ('192.168.50.255', 9),
        ('192.168.50.255', 7),
        ('255.255.255.255', 9)
    ]
    for bcast_ip, port in targets:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                s.settimeout(1.0)
                s.sendto(magic, (bcast_ip, port))
        except Exception:
            pass

    try:
        subprocess.run(["wakeonlan", "-i", "192.168.50.255", mac_str], capture_output=True, timeout=3)
    except Exception:
        pass

    return True

class DashboardHTTPHandler(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_security_headers(self):
        dom = resolve_request_domain(self)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        
        # Permitir que el dashboard sea embebido de forma segura como Web App en Nextcloud Hub y accesos LAN/WAN
        csp_ancestors = (
            "'self' "
            "https://cminewar.duckdns.org "
            "https://*.cminewar.duckdns.org "
            "https://*.duckdns.org "
            "https://192.168.50.2 http://192.168.50.2 "
            "https://servidor https://servidor.lan "
            "http://localhost:* http://127.0.0.1:* "
            f"https://{dom} https://*.{dom}"
        )
        self.send_header(
            'Content-Security-Policy',
            f"default-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://*.googleapis.com data: blob:; "
            f"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://*.googleapis.com; "
            f"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://unpkg.com; "
            f"img-src 'self' data: blob: https: http:; "
            f"connect-src 'self' https://api.github.com https://autocomplete.clearbit.com https://cdn.simpleicons.org https://www.google.com https://maps.googleapis.com https://*.googleapis.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.tile.openstreetmap.de https://tile.openstreetmap.de http://ip-api.com https://ip-api.com ws: wss: https://*.cminewar.duckdns.org https://*.duckdns.org; "
            f"frame-src 'self' https://cminewar.duckdns.org https://*.cminewar.duckdns.org https://*.duckdns.org https://*.{dom}; "
            f"frame-ancestors {csp_ancestors};"
        )

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
        clean_path = self.path.split('?')[0].rstrip('/') or '/'
        req_domain = resolve_request_domain(self)
        c_ip = auth.get("client_ip", "")
        if c_ip and c_ip not in ("127.0.0.1", "::1"):
            RECENT_HTTP_CLIENTS[c_ip] = {
                "ip": c_ip,
                "port": 443,
                "ts": time.time(),
                "service": "Panel Recursos Web UI (HTTPS)"
            }
            enqueue_remote_ips_for_geoip([c_ip])

        # 1. API METRICS (Bloqueo 403 total si es externo no emparejado)
        if clean_path == "/api/metrics":
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

            if "system" in base_payload and isinstance(base_payload["system"], dict):
                base_payload["system"] = dict(base_payload["system"])
                base_payload["system"]["public_domain"] = req_domain
                base_payload["system"]["local_ip"] = SERVER_LOCAL_IP

            # Inyectar estado de seguridad contextual y versión para la UI
            base_payload["auth_status"] = {
                "is_local": auth["is_local"],
                "is_trusted": auth["is_trusted"],
                "client_ip": auth["client_ip"],
                "public_domain": req_domain,
                "local_ip": SERVER_LOCAL_IP,
                "token": auth.get("token") or auth.get("new_token") or "",
                "device_name": auth["device_info"]["name"] if auth.get("device_info") else "Dispositivo Local"
            }
            base_payload["maps_engine"] = "leaflet"
            base_payload["version_info"] = get_version_info(force_refresh=False)
            base_payload["version_info"]["public_domain"] = req_domain
            if "system_errors_summary" not in base_payload:
                base_payload["system_errors_summary"] = get_system_errors_summary()
            with CUSTOM_LOGOS_LOCK:
                base_payload["custom_logos"] = load_custom_logos()
            data = json.dumps(base_payload).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # 1b. API VERSION & GITHUB SYNC STATUS
        elif clean_path == "/api/version":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            force_ref = ("refresh=1" in self.path or "refresh=true" in self.path)
            ver_data = get_version_info(force_refresh=force_ref)
            ver_data["public_domain"] = req_domain
            ver_data["local_ip"] = SERVER_LOCAL_IP
            resp = json.dumps(ver_data).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1c. REGISTRO UNIFICADO DE FALLOS Y ERRORES DEL SISTEMA (APPS, SERVICIOS, KERNEL)
        elif clean_path == "/api/system/logs":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            query_str = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query_str)
            prio = 4 if params.get('level', ['err'])[0].lower() in ('warn', 'warning', '4') else 3
            cat = params.get('category', ['all'])[0].lower()
            try:
                limit = int(params.get('limit', [80])[0])
            except Exception:
                limit = 80
            force = (params.get('refresh', ['0'])[0] in ('1', 'true'))

            logs_payload = fetch_system_logs(priority_max=prio, limit=limit, force=force)
            if cat != 'all':
                filtered_logs = [entry for entry in logs_payload.get('logs', []) if entry.get('category') == cat]
                logs_payload = dict(logs_payload)
                logs_payload['logs'] = filtered_logs
                logs_payload['entries'] = filtered_logs
                logs_payload['total_errors'] = len(filtered_logs)

            resp = json.dumps(logs_payload).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1d. ESTADO, TELEMETRÍA Y REGISTRO DE MENSAJES DEL BOT DE TELEGRAM INTEGRADO
        elif clean_path in ("/api/telegram_bot", "/api/telegram_bot/activity"):
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with TELEGRAM_BOT_LOCK:
                bot_data = dict(TELEGRAM_BOT_CACHE)
            with TELEGRAM_ACTIVITY_LOCK:
                activity_list = list(TELEGRAM_ACTIVITY_LOG)
            wl = list(load_tg_whitelist())
            cfg = load_tg_config()
            resp = json.dumps({
                "success": True,
                "bot_status": bot_data,
                "activity": activity_list,
                "allowed_users": wl,
                "config": cfg
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1.1 CONFIGURACIÓN Y ESTADO DE MOTOR DE MAPAS (OpenStreetMap / CartoDB)
        elif clean_path == "/api/maps/config":
            resp = json.dumps({
                "engine": "leaflet",
                "provider": "OpenStreetMap",
                "free": True
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2. LISTADO DE DISPOSITIVOS EMPAREJADOS CON IDENTIFICACIÓN COMPLETA DE HARDWARE
        elif clean_path == "/api/auth/devices":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with TRUST_LOCK:
                devices = load_trusted_devices()
                dev_list = []
                caller_dev_id = auth.get("device_id")
                caller_ua = self.headers.get("User-Agent", "")
                caller_client_desc = extract_client_descriptor(caller_ua, extract_header_telemetry(self), auth.get("client_ip", ""), is_local=auth.get("is_local", True))
                for k, v in devices.items():
                    dev_id = v.get("id") or k
                    alias_ids = v.get("alias_ids") if isinstance(v.get("alias_ids"), list) else [dev_id]
                    is_cur_dev = (dev_id == caller_dev_id) or (caller_dev_id in alias_ids)
                    tel = v.get("device_telemetry") if isinstance(v.get("device_telemetry"), dict) else {}
                    ua_str = v.get("user_agent", "")
                    c_type = v.get("client_type") or tel.get("client_type") or (
                        "ubuntu_native" if "recursoscockpit-linux" in ua_str.lower() else (
                            "android_native" if "recursoscockpit-android" in ua_str.lower() else "web_browser"
                        )
                    )
                    raw_clients = v.get("clients") if isinstance(v.get("clients"), list) else []
                    if not raw_clients:
                        raw_clients = [extract_client_descriptor(ua_str, tel, v.get("local_ip", ""), is_local=not bool(v.get("last_external_ip")), now_iso=v.get("last_seen", ""))]
                    clients_out = []
                    for c_obj in raw_clients:
                        if not isinstance(c_obj, dict):
                            continue
                        c_copy = dict(c_obj)
                        c_copy["is_current_client"] = bool(is_cur_dev and c_copy.get("client_key") == caller_client_desc.get("client_key"))
                        clients_out.append(c_copy)

                    is_nat = (
                        c_type in ("ubuntu_native", "android_native")
                        or bool(v.get("full_access") or tel.get("full_access"))
                        or any(bool(c.get("full_access")) for c in clients_out)
                    )
                    c_label = v.get("client_label") or tel.get("client_label") or (
                        "App Nativa Ubuntu (.deb)" if c_type == "ubuntu_native" else (
                            "App Nativa Android (.apk)" if c_type == "android_native" else "Navegador Web"
                        )
                    )
                    phys_key = v.get("physical_key") or compute_physical_device_key(v, v.get("local_ip", ""), ua_str, is_local=True)
                    cert_serial = v.get("certificate_serial") or generate_certificate_serial(dev_id, phys_key)
                    dev_list.append({
                        "id": dev_id,
                        "alias_ids": alias_ids,
                        "physical_key": phys_key,
                        "certificate_serial": cert_serial,
                        "certificate_scope": "PER_PHYSICAL_DEVICE",
                        "name": v.get("custom_alias") or v.get("name") or tel.get("name") or "Dispositivo",
                        "auto_name": v.get("auto_name") or tel.get("name") or v.get("name") or "Dispositivo",
                        "custom_alias": v.get("custom_alias", ""),
                        "client_type": c_type,
                        "client_label": c_label,
                        "active_client_key": caller_client_desc.get("client_key") if is_cur_dev else (v.get("active_client_key") or (clients_out[0].get("client_key") if clients_out else "")),
                        "active_client_label": caller_client_desc.get("client_label") if is_cur_dev else (v.get("active_client_label") or c_label),
                        "clients": clients_out,
                        "clients_count": len(clients_out),
                        "access_level": "FULL_NATIVE_ACCESS" if is_nat else (v.get("access_level") or "WEB_SANDBOX"),
                        "full_access": is_nat,
                        "app_version": v.get("app_version") or tel.get("app_version") or "",
                        "hardware_id": v.get("hardware_id") or tel.get("hardware_id") or dev_id,
                        "first_seen": v.get("first_seen", ""),
                        "last_seen": v.get("last_seen", ""),
                        "local_ip": normalize_lan_ip(v.get("local_ip") or tel.get("local_ip") or ""),
                        "last_external_ip": v.get("last_external_ip", ""),
                        "connection_mode": v.get("connection_mode", "LAN" if not v.get("last_external_ip") else "WAN"),
                        "user_agent": ua_str,
                        "verified_in_lan": v.get("verified_in_lan", True),
                        "trusted": v.get("trusted", True),
                        "is_current": is_cur_dev,
                        "device_telemetry": tel
                    })
                dev_list.sort(key=lambda x: (not x.get("is_current", False), not x.get("full_access", False), x.get("last_seen", "")), reverse=False)
            resp = json.dumps(dev_list, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2b. HISTORIAL COMPLETO ALL-TIME DE FAIL2BAN
        elif clean_path == "/api/fail2ban/history":
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

        # 2c. GESTOR DNS & DUCKDNS STATUS
        elif clean_path == "/api/dns/duckdns":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            st = get_duckdns_status()
            resp = json.dumps(st).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2d. LOGS EN VIVO DE DUCKDNS
        elif clean_path == "/api/dns/logs":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            logs = get_duckdns_logs(limit=80)
            resp = json.dumps({"status": "ok", "total": len(logs), "logs": logs}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2e. MONITOR DE TRÁFICO DNS & SERVICIOS POR IP
        elif clean_path == "/api/dns/traffic":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            client_ip = None
            if "?" in self.path:
                try:
                    q_str = self.path.split("?", 1)[1]
                    q_params = urllib.parse.parse_qs(q_str)
                    client_ip = q_params.get("client", [None])[0]
                except Exception:
                    pass
            traffic = get_dns_traffic_stats(client_filter=client_ip, limit=50)
            resp = json.dumps(traffic).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2f. LOGOS PERSONALIZADOS Y BÚSQUEDA AUTOMÁTICA DE LOGOS EN LA WEB
        elif clean_path == "/api/custom-logos":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with CUSTOM_LOGOS_LOCK:
                logos = load_custom_logos()
            resp = json.dumps({"logos": logos}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        elif clean_path == "/api/logos/search":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            q_val = ""
            if "?" in self.path:
                try:
                    q_str = self.path.split("?", 1)[1]
                    q_params = urllib.parse.parse_qs(q_str)
                    q_val = q_params.get("q", [""])[0]
                except Exception:
                    pass
            results = search_logos_catalog(q_val)
            resp = json.dumps({"query": q_val, "results": results}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2g. ESTADO DEL WORKER ASÍNCRONO Y CACHÉ GEOIP (ip-api.com)
        elif clean_path == "/api/net/geoip":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            worker_info = get_geoip_worker_summary()
            with GEOIP_LOCK:
                cache_copy = dict(GEOIP_CACHE)
                srv_geo_copy = dict(SERVER_SELF_GEO) if SERVER_SELF_GEO else {}
            resp = json.dumps({
                "status": "ok",
                "worker": worker_info,
                "server_node": srv_geo_copy,
                "cache": cache_copy
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2g-bis. HISTORIAL DE CONEXIONES GEOLOCALIZADAS CATALOGADAS POR SERVICIOS (SQLite)
        elif clean_path == "/api/net/history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            svc_f = None
            dev_f = None
            dir_f = None
            q_f = None
            hours_f = None
            lim_f = 300
            if "?" in self.path:
                try:
                    q_str = self.path.split("?", 1)[1]
                    q_params = urllib.parse.parse_qs(q_str)
                    svc_f = q_params.get("service", [None])[0]
                    dev_f = q_params.get("device", [None])[0]
                    dir_f = q_params.get("direction", [None])[0]
                    q_f = q_params.get("q", [None])[0]
                    hours_f = q_params.get("hours", [None])[0]
                    if "limit" in q_params:
                        lim_f = int(q_params["limit"][0])
                except Exception:
                    pass
            hist_payload = query_connection_history_from_sqlite(
                service_filter=svc_f,
                device_filter=dev_f,
                direction_filter=dir_f,
                search_query=q_f,
                hours_filter=hours_f,
                limit=lim_f
            )
            resp = json.dumps(hist_payload).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2h. ESTADO EN TIEMPO REAL DEL CONTROLADOR USB (SAMSUNG DEX / ANDROID DESKTOP)
        elif clean_path in ("/api/dex/status", "/api/usb/status"):
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            ua_str = (self.headers.get('User-Agent') or '').lower()
            env_hdr = (self.headers.get('X-Recursos-Env') or '').strip().lower()
            is_mobile_ua = any(k in ua_str for k in ('android', 'iphone', 'ipad', 'ipod', 'mobile', 'samsungbrowser', 'dex'))
            is_native_ua = any(k in ua_str for k in ('recursosnative', 'electron', 'webkitgtk', 'pywebview', '; wv)'))
            detected_env = env_hdr if env_hdr in ('native', 'mobile', 'web') else ('native' if is_native_ua else ('mobile' if is_mobile_ua else 'web'))
            dex_payload = {
                "success": True,
                "detected_env": detected_env,
                "is_native_or_mobile": detected_env in ("native", "mobile"),
                "hide_device_tab": True,
                "usb_listening": True,
                "session_running": False,
                "devices": [],
                "dependencies": {"adb": False, "scrcpy": False, "ready": False}
            }
            try:
                from desktop_app.dex_controller import DexController
                if not hasattr(DashboardHTTPHandler, "_shared_dex_ctrl"):
                    DashboardHTTPHandler._shared_dex_ctrl = DexController()
                ctrl = DashboardHTTPHandler._shared_dex_ctrl
                dex_payload["dependencies"] = ctrl.check_dependencies()
                dex_payload["devices"] = ctrl.list_connected_devices(usb_only=True)
                dex_payload["session_running"] = ctrl.is_session_running()
            except Exception as dex_err:
                dex_payload["error"] = str(dex_err)
            resp = json.dumps(dex_payload).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 3. RUTAS WEB LIMPIAS MULTIPÁGINA (History API + Acceso Directo)
        elif clean_path in VALID_WEB_ROUTES:
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
            if not os.path.isfile(index_path):
                index_path = os.path.join(BASE_DIR, "index.html")
            try:
                with open(index_path, 'r', encoding='utf-8') as f:
                    content_str = f.read()
                current_ver = get_app_version()
                content_str = content_str.replace('id="sidebarVersionTag">Sincronizando...<', f'id="sidebarVersionTag">v{current_ver}<')
                content = content_str.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.send_security_headers()
                if auth.get("new_token"):
                    self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.send_security_headers()
                self.end_headers()
                self.wfile.write(f"Error loading dashboard: {e}".encode('utf-8'))
            return

        # 4. ARCHIVOS ESTÁTICOS / DESCARGAS RDP CON DNS AUTODETECTADO
        elif clean_path in ["/visipics.rdp", "/visipics_externo.rdp", "/Asus_Router_CA.crt"]:
            filename = clean_path.lstrip("/")
            file_path = os.path.join(STATIC_DIR, filename)
            try:
                if filename == "visipics_externo.rdp":
                    rdp_text = (
                        f"full address:s:{req_domain}:3389\n"
                        "username:s:servidor\n"
                        "prompt for credentials:i:0\n"
                        "administrative session:i:1\n"
                        "screen mode id:i:2\n"
                        "use multimon:i:0\n"
                        "desktopwidth:i:1920\n"
                        "desktopheight:i:1080\n"
                        "smart sizing:i:1\n"
                        "dynamic resolution:i:1\n"
                        "redirectclipboard:i:1\n"
                        "autoreconnection enabled:i:1\n"
                        "authentication level:i:0\n"
                        "enableworkspacereconnect:i:1\n"
                        "drivestoredirect:s:*\n"
                    )
                    content = rdp_text.encode('utf-8')
                elif filename == "visipics.rdp":
                    rdp_text = (
                        f"full address:s:{SERVER_LOCAL_IP}:3389\n"
                        "username:s:servidor\n"
                        "prompt for credentials:i:0\n"
                        "administrative session:i:1\n"
                        "screen mode id:i:2\n"
                        "use multimon:i:0\n"
                        "desktopwidth:i:1920\n"
                        "desktopheight:i:1080\n"
                        "smart sizing:i:1\n"
                        "dynamic resolution:i:1\n"
                        "redirectclipboard:i:1\n"
                        "autoreconnection enabled:i:1\n"
                        "authentication level:i:0\n"
                        "enableworkspacereconnect:i:1\n"
                        "drivestoredirect:s:*\n"
                    )
                    content = rdp_text.encode('utf-8')
                else:
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

        # 4a. ARCHIVOS ESTÁTICOS DE IDENTIDAD VISUAL & FAVICONS
        elif clean_path in [
            "/favicon.ico",
            "/favicon.png",
            "/favicon-16x16.png",
            "/favicon-32x32.png",
            "/favicon-192x192.png",
            "/favicon-512x512.png",
            "/apple-touch-icon.png",
            "/recursos-cockpit.png",
            "/assets/recursos-cockpit.png"
        ]:
            fname = os.path.basename(clean_path)
            target_file = os.path.join(STATIC_DIR, fname)
            if not os.path.isfile(target_file):
                target_file = os.path.join(BASE_DIR, "desktop_app", "assets", fname)

            if os.path.isfile(target_file):
                try:
                    fsize = os.path.getsize(target_file)
                    mime_type = "image/x-icon" if fname.endswith(".ico") else "image/png"
                    self.send_response(200)
                    self.send_header('Content-Type', mime_type)
                    self.send_header('Cache-Control', 'public, max-age=86400')
                    self.send_security_headers()
                    self.send_header('Content-Length', str(fsize))
                    self.end_headers()
                    with open(target_file, 'rb') as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                    return
                except Exception as e:
                    print(f"[FAVICON SERVE ERROR] {e}")

            self.send_response(404)
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(b"Icon Not Found")
            return

        # 4b. DESCARGA DIRECTA DE LA APP NATIVA PARA LINUX (.deb)
        elif clean_path in ["/download/recursos-cockpit.deb", "/download/app.deb", "/api/download/app_deb"] or (
            clean_path.startswith("/download/recursos-cockpit") and clean_path.endswith(".deb")
        ):
            dist_dir = os.path.join(BASE_DIR, "dist")
            current_ver = get_app_version()
            canonical_deb = os.path.join(dist_dir, f"recursos-cockpit_{current_ver}_amd64.deb")

            # Si el paquete canónico para la versión activa no existe, compilarlo automáticamente
            if not os.path.isfile(canonical_deb):
                build_script = os.path.join(BASE_DIR, "packaging", "build_deb.sh")
                if os.path.isfile(build_script):
                    try:
                        subprocess.run(["bash", build_script], cwd=BASE_DIR, check=True, timeout=30)
                    except Exception as build_err:
                        print(f"[AUTO-BUILD DEB ERROR] {build_err}")

            requested_name = os.path.basename(clean_path)
            deb_file = None
            if requested_name in ["recursos-cockpit.deb", "app.deb", "app_deb"]:
                if os.path.isfile(canonical_deb):
                    deb_file = canonical_deb
                else:
                    candidates = sorted(glob.glob(os.path.join(dist_dir, "recursos-cockpit_*.deb")), reverse=True)
                    deb_file = candidates[0] if candidates else None
            else:
                specific_file = os.path.join(dist_dir, requested_name)
                if os.path.isfile(specific_file):
                    deb_file = specific_file
                elif os.path.isfile(canonical_deb):
                    deb_file = canonical_deb

            if deb_file and os.path.isfile(deb_file):
                try:
                    fsize = os.path.getsize(deb_file)
                    out_fname = f"recursos-cockpit_{current_ver}_amd64.deb" if requested_name in ["recursos-cockpit.deb", "app.deb", "app_deb"] else os.path.basename(deb_file)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.debian.binary-package')
                    self.send_header('Content-Disposition', f'attachment; filename="{out_fname}"')
                    self.send_header('Content-Length', str(fsize))
                    self.send_security_headers()
                    self.end_headers()
                    with open(deb_file, 'rb') as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                    return
                except Exception as e:
                    print(f"[DOWNLOAD DEB ERROR] {e}")

            # Redirigir a la release oficial de GitHub si no está disponible localmente
            github_deb = f"https://github.com/cminewarIA/recursos-ui/releases/download/v{current_ver}/recursos-cockpit_{current_ver}_amd64.deb"
            self.send_response(302)
            self.send_header('Location', github_deb)
            self.send_security_headers()
            self.end_headers()
            return

        # 4c. DESCARGA DIRECTA DE LA APP NATIVA PARA ANDROID (.apk)
        elif clean_path in ["/download/recursos-cockpit.apk", "/download/app.apk", "/api/download/app_apk"] or (
            clean_path.startswith("/download/recursos-cockpit") and clean_path.endswith(".apk")
        ):
            dist_dir = os.path.join(BASE_DIR, "dist")
            current_ver = get_app_version()
            canonical_apk = os.path.join(dist_dir, f"recursos-cockpit_{current_ver}.apk")
            requested_name = os.path.basename(clean_path)
            apk_file = None
            if requested_name in ["recursos-cockpit.apk", "app.apk", "app_apk"]:
                if os.path.isfile(canonical_apk):
                    apk_file = canonical_apk
                else:
                    candidates = sorted(glob.glob(os.path.join(dist_dir, "recursos-cockpit_*.apk")), reverse=True)
                    apk_file = candidates[0] if candidates else None
            else:
                specific_file = os.path.join(dist_dir, requested_name)
                if os.path.isfile(specific_file):
                    apk_file = specific_file
                elif os.path.isfile(canonical_apk):
                    apk_file = canonical_apk

            if apk_file and os.path.isfile(apk_file):
                try:
                    fsize = os.path.getsize(apk_file)
                    out_fname = f"recursos-cockpit_{current_ver}.apk" if requested_name in ["recursos-cockpit.apk", "app.apk", "app_apk"] else os.path.basename(apk_file)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.android.package-archive')
                    self.send_header('Content-Disposition', f'attachment; filename="{out_fname}"')
                    self.send_header('Content-Length', str(fsize))
                    self.send_security_headers()
                    self.end_headers()
                    with open(apk_file, 'rb') as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                    return
                except Exception as e:
                    print(f"[DOWNLOAD APK ERROR] {e}")

            # Redirigir a la release oficial de GitHub si no está disponible localmente
            github_apk = f"https://github.com/cminewarIA/recursos-ui/releases/download/v{current_ver}/recursos-cockpit_{current_ver}.apk"
            self.send_response(302)
            self.send_header('Location', github_apk)
            self.send_security_headers()
            self.end_headers()
            return
        else:
            self.send_response(404)
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")

    def do_POST(self):
        client_ip = get_client_ip(self)
        clean_path = self.path.split('?')[0].rstrip('/') or '/'

        # 1. Desbloqueo remoto con clave maestra (Blindado contra fuerza bruta)
        if clean_path in ("/api/auth/unlock", "/api/unlock"):
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
                now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                hdr_tel = extract_header_telemetry(self)
                ua_parsed = parse_user_agent(ua)
                device_name = (ua_parsed.split("•")[0].strip() if "•" in ua_parsed else ua_parsed) + " (Desbloqueo Remoto)"

                with TRUST_LOCK:
                    devices = load_trusted_devices()
                    matched_id, existing_entry, _ = find_device_by_id_or_physical(
                        devices, None, hdr_tel, client_ip, ua, is_local=False
                    )
                    if matched_id and existing_entry:
                        dev_id = matched_id
                        new_token = create_device_token(dev_id)
                        existing_entry["last_seen"] = now_iso
                        existing_entry["last_external_ip"] = client_ip
                        existing_entry["verified_in_lan"] = True
                        existing_entry["trusted"] = True
                        enrich_device_entry(existing_entry, ua, hdr_tel, client_ip, is_local=False)
                        devices[dev_id] = existing_entry
                    else:
                        dev_id = f"dev_{secrets.token_hex(6)}"
                        new_token = create_device_token(dev_id)
                        new_entry = {
                            "id": dev_id,
                            "alias_ids": [dev_id],
                            "name": device_name,
                            "first_seen": now_iso,
                            "last_seen": now_iso,
                            "local_ip": f"Externo ({client_ip})",
                            "last_external_ip": client_ip,
                            "user_agent": ua[:220],
                            "verified_in_lan": True,
                            "trusted": True
                        }
                        enrich_device_entry(new_entry, ua, hdr_tel, client_ip, is_local=False)
                        devices[dev_id] = new_entry
                    save_trusted_devices(consolidate_devices_by_hardware(devices))

                resp = json.dumps({"success": True, "token": new_token, "device_id": dev_id, "message": "Certificado de dispositivo emitido con éxito"}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Set-Cookie', get_cookie_header_value(self, new_token))
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

        # 2. Revocación de certificado de dispositivo físico (o de un cliente agrupado concreto)
        elif clean_path == "/api/auth/revoke":
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
                dev_id = str(body.get('id') or '').strip()
                client_key = str(body.get('client_key') or '').strip()
            except Exception:
                dev_id = ''
                client_key = ''

            with TRUST_LOCK:
                devices = load_trusted_devices()
                found = False
                target_key = None
                if dev_id in devices:
                    target_key = dev_id
                else:
                    for k in list(devices.keys()):
                        if devices[k].get('id') == dev_id or dev_id in (devices[k].get('alias_ids') or []):
                            target_key = k
                            break

                if target_key:
                    target_entry = devices[target_key]
                    cur_clients = target_entry.get("clients") if isinstance(target_entry.get("clients"), list) else []
                    # Si se solicita desvincular un único cliente agrupado y el dispositivo tiene más de un cliente
                    if client_key and len(cur_clients) > 1:
                        remaining_clients = [c for c in cur_clients if c.get("client_key") != client_key]
                        if len(remaining_clients) != len(cur_clients):
                            target_entry["clients"] = remaining_clients
                            has_nat = any(bool(c.get("full_access")) for c in remaining_clients)
                            target_entry["full_access"] = has_nat
                            target_entry["access_level"] = "FULL_NATIVE_ACCESS" if has_nat else "WEB_SANDBOX"
                            if remaining_clients:
                                target_entry["client_type"] = remaining_clients[0].get("client_type", "web_browser")
                                target_entry["client_label"] = remaining_clients[0].get("client_label", "Navegador Web")
                            found = True
                    else:
                        del devices[target_key]
                        found = True

                if found:
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

        # 2b. Revocación de todos los demás dispositivos físicos (Pánico / Reset)
        elif clean_path == "/api/auth/revoke_all_others":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            caller_dev_id = auth.get("device_id")
            with TRUST_LOCK:
                devices = load_trusted_devices()
                new_devices = {}
                count_revoked = 0
                for k, v in devices.items():
                    cur_id = v.get("id") or k
                    alias_ids = v.get("alias_ids") if isinstance(v.get("alias_ids"), list) else [cur_id]
                    if caller_dev_id and (cur_id == caller_dev_id or caller_dev_id in alias_ids):
                        new_devices[cur_id] = v
                    else:
                        count_revoked += 1
                save_trusted_devices(new_devices)

            resp = json.dumps({"success": True, "revoked_count": count_revoked}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2c. Registro y sincronización de telemetría profunda del dispositivo físico (Apps Nativas y Web)
        elif clean_path == "/api/auth/register-device":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 32768:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            raw_post = self.rfile.read(content_length).decode('utf-8', errors='ignore') if content_length > 0 else "{}"
            try:
                body = json.loads(raw_post)
            except Exception:
                body = {}

            telemetry = body.get("device_telemetry") if isinstance(body.get("device_telemetry"), dict) else body
            caller_dev_id = auth.get("device_id")
            ua = self.headers.get('User-Agent', '')
            is_local = auth.get("is_local", True)
            norm_client_ip = normalize_lan_ip(client_ip) if is_local else client_ip
            now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            issued_token = auth.get("token") or auth.get("new_token")

            with TRUST_LOCK:
                devices = load_trusted_devices()
                target_id = caller_dev_id if (caller_dev_id and caller_dev_id != "cli_local") else None

                # Buscar si existe otro registro del mismo dispositivo físico (por MAC, IP LAN + SO o hardware_id)
                matched_id, matched_dev, _ = find_device_by_id_or_physical(
                    devices, target_id, telemetry, norm_client_ip, ua, is_local
                )
                if matched_id:
                    if not target_id:
                        target_id = matched_id
                        issued_token = create_device_token(matched_id)
                    elif matched_id != target_id:
                        # Unificar registros del mismo dispositivo físico bajo un único certificado
                        target_id = matched_id
                        issued_token = create_device_token(matched_id)

                if not target_id:
                    target_id = f"dev_{secrets.token_hex(6)}"
                    issued_token = create_device_token(target_id)

                ua_parsed = parse_user_agent(ua)
                dev_only_name = ua_parsed.split("•")[0].strip() if "•" in ua_parsed else ua_parsed
                entry = devices.get(target_id) or {
                    "id": target_id,
                    "alias_ids": [target_id],
                    "name": dev_only_name,
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                    "local_ip": norm_client_ip if is_local else "",
                    "last_external_ip": "" if is_local else client_ip,
                    "verified_in_lan": True,
                    "trusted": True,
                }
                entry["id"] = target_id
                entry["last_seen"] = now_iso
                enrich_device_entry(entry, ua, telemetry, norm_client_ip if is_local else client_ip, is_local=is_local)
                devices[target_id] = entry
                consolidated = consolidate_devices_by_hardware(devices)
                if target_id not in consolidated:
                    for cid, cdev in consolidated.items():
                        if target_id in (cdev.get("alias_ids") or []):
                            target_id = cid
                            entry = cdev
                            issued_token = create_device_token(target_id)
                            break
                else:
                    entry = consolidated[target_id]
                save_trusted_devices(consolidated)

            resp = json.dumps({
                "success": True,
                "device_id": target_id,
                "token": issued_token,
                "device": entry
            }, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_security_headers()
            if issued_token:
                self.send_header('Set-Cookie', get_cookie_header_value(self, issued_token))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2d. Renombrar alias personalizado de un dispositivo en el Panel de Seguridad
        elif clean_path == "/api/auth/rename-device":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 4096:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            raw_post = self.rfile.read(content_length).decode('utf-8', errors='ignore') if content_length > 0 else "{}"
            try:
                body = json.loads(raw_post)
            except Exception:
                body = {}

            dev_id = str(body.get("id") or "").strip()
            alias = str(body.get("alias") or body.get("name") or "").strip()[:80]

            with TRUST_LOCK:
                devices = load_trusted_devices()
                target_dev = devices.get(dev_id)
                if not target_dev:
                    for k, v in devices.items():
                        if v.get("id") == dev_id:
                            target_dev = v
                            break
                if target_dev:
                    target_dev["custom_alias"] = alias
                    target_dev["name"] = alias if alias else (target_dev.get("auto_name") or "Dispositivo")
                    save_trusted_devices(devices)
                    resp = json.dumps({"success": True, "id": dev_id, "name": target_dev["name"]}, ensure_ascii=False).encode('utf-8')
                else:
                    resp = json.dumps({"success": False, "error": "Dispositivo no encontrado"}, ensure_ascii=False).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 3. Fail2ban: Desbloqueo de IP
        elif clean_path == "/api/fail2ban/unban":
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

            if jail and jail != 'all':
                cmd = ["sudo", "fail2ban-client", "set", jail, "unbanip", target_ip]
            else:
                cmd = ["sudo", "fail2ban-client", "unban", target_ip]

            p = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if p.returncode == 0:
                # Actualizar inmediatamente SECURITY_CACHE para reflejar el desbloqueo
                with SECURITY_LOCK:
                    f2b_d = SECURITY_CACHE.get("fail2ban", {})
                    if "banned_details" in f2b_d:
                        f2b_d["banned_details"] = [b for b in f2b_d["banned_details"] if b.get("ip") != target_ip]
                    if "banned_ips" in f2b_d:
                        f2b_d["banned_ips"] = [ip for ip in f2b_d["banned_ips"] if ip != target_ip]
                resp = json.dumps({"success": True, "message": f"IP {target_ip} desbloqueada exitosamente", "ip": target_ip, "output": p.stdout.strip()}).encode('utf-8')
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
        elif clean_path == "/api/fail2ban/ban":
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
                jail = body.get('jail', 'caddy-scan').strip()
            except Exception:
                target_ip = ''
                jail = 'caddy-scan'

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

            if target_ip in ["127.0.0.1", "::1", SERVER_LOCAL_IP]:
                resp = json.dumps({"success": False, "error": "No se puede bloquear la IP local o del servidor"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            if not jail or jail == 'auto':
                jail = 'caddy-scan'

            success = False
            last_err = ""
            if jail == 'all':
                active_jails = ['caddy-scan', 'sshd', 'nextcloud', 'recidive']
                for j in active_jails:
                    cmd = ["sudo", "fail2ban-client", "set", j, "banip", target_ip]
                    p = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                    if p.returncode == 0:
                        success = True
                    else:
                        last_err = p.stderr.strip() or p.stdout.strip()
            else:
                cmd = ["sudo", "fail2ban-client", "set", jail, "banip", target_ip]
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                success = (p.returncode == 0)
                last_err = p.stderr.strip() or p.stdout.strip()

            if success:
                # Actualizar inmediatamente SECURITY_CACHE para reflejar el bloqueo
                with SECURITY_LOCK:
                    f2b_d = SECURITY_CACHE.get("fail2ban", {})
                    if "banned_details" in f2b_d:
                        if not any(b.get("ip") == target_ip for b in f2b_d["banned_details"]):
                            f2b_d["banned_details"].append({"ip": target_ip, "jail": jail, "banned_at": int(time.time()), "is_active": True})
                    if "banned_ips" in f2b_d:
                        if target_ip not in f2b_d["banned_ips"]:
                            f2b_d["banned_ips"].append(target_ip)
                resp = json.dumps({"success": True, "message": f"IP {target_ip} bloqueada en firewall (jail: {jail})", "ip": target_ip, "jail": jail}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": last_err or "Error al bloquear IP en Fail2ban"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 5. Fail2ban: Importación masiva de IPs (Synology Blocklist / Archivo TXT o CSV)
        elif clean_path == "/api/fail2ban/import":
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
        elif clean_path in ("/api/wol/wake", "/api/wol"):
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

            clean_mac = re.sub(r'[^0-9A-Fa-f]', '', mac)
            if len(clean_mac) == 12:
                ok = send_wol_magic_packet(mac)
                if ok:
                    resp = json.dumps({"success": True, "message": f"Paquete mágico Wake-on-LAN enviado a {mac}"}).encode('utf-8')
                else:
                    resp = json.dumps({"success": False, "error": f"Error al emitir paquete WoL a {mac}"}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": "Dirección MAC inválida"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Test ping para Bot de Telegram integrado
        elif clean_path in ("/api/telegram_bot/test", "/api/telegram_bot/ping"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            test_msg = (
                f"🧪 *Prueba de Conexión del Bot Integrado*\n\n"
                f"🟢 *Panel de Control:* Dashboard Recursos\n"
                f"⏱️ *Hora:* `{now_str}`\n"
                f"🤖 *Motor:* Bot nativo integrado en server.py\n"
                f"📡 *Estado:* Operativo y respondiendo a comandos."
            )
            success = broadcast_to_tg_whitelist(
                test_msg,
                log_title="🧪 Ping de prueba emitido",
                log_type="ping_test"
            )
            if success:
                resp = json.dumps({"success": True, "message": "Mensaje de prueba emitido con éxito a Telegram"}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": "No se pudo emitir mensaje o no hay usuarios autorizados en la lista blanca"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Enviar mensaje / comunicado directo a Telegram desde la web
        elif clean_path == "/api/telegram_bot/send":
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
                raw_text = (body.get('message') or body.get('text') or '').strip()
            except Exception:
                raw_text = ''

            if not raw_text:
                resp = json.dumps({"success": False, "error": "El mensaje no puede estar vacío"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            formatted_text = f"📢 *Aviso desde Panel Recursos Web:*\n\n{raw_text}\n\n⏱️ `{now_str}`"
            success = broadcast_to_tg_whitelist(
                formatted_text,
                log_title="📢 Mensaje emitido desde el Panel Web",
                log_type="custom_broadcast"
            )

            if success:
                resp = json.dumps({"success": True, "message": "Mensaje emitido con éxito a Telegram"}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": "No se pudo emitir el mensaje o no hay administradores en la lista blanca"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Añadir usuario a la lista blanca de Telegram
        elif clean_path == "/api/telegram_bot/whitelist/add":
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
                user_id = int(str(body.get('user_id', '')).strip())
            except Exception:
                user_id = 0

            if user_id <= 0:
                resp = json.dumps({"success": False, "error": "El ID de usuario/chat debe ser un número entero válido"}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            wl = load_tg_whitelist()
            wl.add(user_id)
            save_tg_whitelist(wl)

            record_tg_activity(
                direction="out",
                msg_type="whitelist_update",
                target=user_id,
                user_name="Ajustes Dashboard",
                title="Usuario añadido a lista blanca",
                content=f"Se ha autorizado al usuario con Chat ID {user_id} para acceder al bot de Telegram.",
                status="ok"
            )

            resp = json.dumps({"success": True, "message": f"Usuario {user_id} añadido a la lista blanca", "allowed_users": list(wl)}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Eliminar usuario de la lista blanca de Telegram
        elif clean_path == "/api/telegram_bot/whitelist/remove":
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
                user_id = int(str(body.get('user_id', '')).strip())
            except Exception:
                user_id = 0

            wl = load_tg_whitelist()
            if user_id in wl:
                if len(wl) <= 1:
                    resp = json.dumps({"success": False, "error": "No puedes eliminar el único administrador registrado"}).encode('utf-8')
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.send_security_headers()
                    self.send_header('Content-Length', str(len(resp)))
                    self.end_headers()
                    self.wfile.write(resp)
                    return
                wl.remove(user_id)
                save_tg_whitelist(wl)
                record_tg_activity(
                    direction="out",
                    msg_type="whitelist_update",
                    target=user_id,
                    user_name="Ajustes Dashboard",
                    title="Usuario revocado de lista blanca",
                    content=f"Se han revocado los permisos al usuario con Chat ID {user_id}.",
                    status="ok"
                )
                resp = json.dumps({"success": True, "message": f"Usuario {user_id} eliminado de la lista blanca", "allowed_users": list(wl)}).encode('utf-8')
            else:
                resp = json.dumps({"success": False, "error": f"El usuario {user_id} no está en la lista blanca"}).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Guardar configuración y preferencias del Bot de Telegram
        elif clean_path == "/api/telegram_bot/config":
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
            except Exception:
                body = {}

            cfg = load_tg_config()
            if "notify_completed_torrents" in body:
                cfg["notify_completed_torrents"] = bool(body["notify_completed_torrents"])
            if "notify_network_changes" in body:
                cfg["notify_network_changes"] = bool(body["notify_network_changes"])

            save_tg_config(cfg)
            record_tg_activity(
                direction="out",
                msg_type="config_update",
                target="Sistema",
                user_name="Ajustes Dashboard",
                title="Configuración de notificaciones actualizada",
                content=f"Avisos de descargas completadas: {'Activados' if cfg.get('notify_completed_torrents') else 'Pausados'}.",
                status="ok"
            )

            resp = json.dumps({"success": True, "config": cfg}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Limpiar el historial de actividad en memoria
        elif clean_path == "/api/telegram_bot/activity/clear":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            with TELEGRAM_ACTIVITY_LOCK:
                TELEGRAM_ACTIVITY_LOG.clear()

            record_tg_activity(
                direction="out",
                msg_type="log_cleared",
                target="Registro",
                user_name="Ajustes Dashboard",
                title="Historial de mensajes vaciado",
                content="Se ha limpiado el buffer de auditoría en memoria del bot.",
                status="ok"
            )

            resp = json.dumps({"success": True, "message": "Historial de mensajes vaciado"}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Limpiar historial SQLite de conexiones geolocalizadas por servicios
        elif clean_path == "/api/net/history/clear":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            ok = clear_connection_history_sqlite()
            resp = json.dumps({"success": ok, "message": "Historial SQLite de conexiones por servicios vaciado"}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Gestión de Contenedores Docker y Servicios Systemd (Iniciar / Reiniciar)
        elif clean_path in ("/api/service/action", "/api/service/restart"):
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
                            unit_name = target if target.endswith('.service') else f"{target}.service"
                            subprocess.run(["sudo", "systemctl", action, unit_name], capture_output=True, timeout=30)
                    except Exception as e:
                        print(f"[-] Error ejecutando acción {action} sobre {target}: {e}")

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

        # 6. Actualización en 1 clic desde GitHub (git pull origin main + reinicio limpio)
        elif clean_path in ("/api/system/update", "/api/update"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            try:
                p_fetch = subprocess.run(
                    ["git", "fetch", "origin", GITHUB_BRANCH],
                    cwd=BASE_DIR, capture_output=True, text=True, timeout=20
                )
                p_pull = subprocess.run(
                    ["git", "pull", "--ff-only", "origin", GITHUB_BRANCH],
                    cwd=BASE_DIR, capture_output=True, text=True, timeout=25
                )
                if p_pull.returncode != 0:
                    # Si falla por cambios locales o bloqueo de working tree, resguardar con stash y reintentar
                    subprocess.run(["git", "stash"], cwd=BASE_DIR, capture_output=True, timeout=10)
                    p_pull = subprocess.run(
                        ["git", "pull", "--ff-only", "origin", GITHUB_BRANCH],
                        cwd=BASE_DIR, capture_output=True, text=True, timeout=25
                    )
                    if p_pull.returncode != 0:
                        p_pull = subprocess.run(
                            ["git", "pull", "origin", GITHUB_BRANCH],
                            cwd=BASE_DIR, capture_output=True, text=True, timeout=25
                        )

                pull_out = (p_pull.stdout.strip() + "\n" + p_pull.stderr.strip()).strip()
                updated_ver = get_version_info(force_refresh=True)

                if p_pull.returncode == 0:
                    def delayed_service_restart():
                        time.sleep(1.5)
                        try:
                            subprocess.run(["sudo", "systemctl", "restart", "system-dashboard.service"], capture_output=True, timeout=15)
                        except Exception:
                            pass

                    threading.Thread(target=delayed_service_restart, daemon=True).start()
                    resp = json.dumps({
                        "success": True,
                        "message": "Actualización descargada desde GitHub correctamente. Reiniciando servicio system-dashboard...",
                        "output": pull_out or "Already up to date.",
                        "version_info": updated_ver
                    }).encode('utf-8')
                else:
                    resp = json.dumps({
                        "success": False,
                        "error": f"Error al ejecutar git pull: {pull_out or 'Código ' + str(p_pull.returncode)}",
                        "output": pull_out,
                        "version_info": updated_ver
                    }).encode('utf-8')
            except Exception as e:
                resp = json.dumps({
                    "success": False,
                    "error": f"Excepción durante la actualización desde GitHub: {str(e)}"
                }).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 7. Forzar actualización de DuckDNS en vivo
        elif clean_path in ("/api/dns/duckdns/update", "/api/duckdns/update"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            res = update_duckdns_now()
            resp = json.dumps(res).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 8. Guardar / Restablecer Logo Personalizado (Archivo Local DataURL o URL Web)
        elif clean_path == "/api/custom-logos":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 4 * 1024 * 1024:  # Hasta 4 MB para archivos de imagen locales
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8', errors='ignore')
            try:
                body = json.loads(post_data)
                target_key = (body.get('key') or '').strip()
                logo_val = (body.get('logo') or '').strip()
            except Exception:
                target_key, logo_val = '', ''

            if not target_key or len(target_key) > 120:
                resp = json.dumps({"success": False, "error": "Identificador de elemento inválido"}).encode('utf-8')
                self.send_response(400)
            else:
                with CUSTOM_LOGOS_LOCK:
                    logos = load_custom_logos()
                    if logo_val:
                        logos[target_key] = logo_val
                    elif target_key in logos:
                        del logos[target_key]
                    save_custom_logos(logos)
                resp = json.dumps({"success": True, "key": target_key, "logos": logos}).encode('utf-8')
                self.send_response(200)

            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 9. Resolución GeoIP en Lote / Bajo Demanda (Web Worker -> Backend Cache -> ip-api.com)
        elif clean_path in ("/api/net/geoip/resolve", "/api/net/geoip"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 65536:
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8', errors='ignore') if content_length > 0 else "{}"
            try:
                body = json.loads(post_data)
                req_ips = body.get("ips", [])
                force_sync = bool(body.get("force_sync", False))
            except Exception:
                req_ips = []
                force_sync = False

            if not isinstance(req_ips, list):
                req_ips = []

            resolved_map = {}
            missing_ips = []
            now = time.time()
            with GEOIP_LOCK:
                for raw_ip in req_ips[:100]:
                    ip_s = str(raw_ip or "").strip().replace("::ffff:", "")
                    if not ip_s or _is_private_ip(ip_s):
                        continue
                    cached_item = GEOIP_CACHE.get(ip_s)
                    if cached_item and not force_sync:
                        GEOIP_WORKER_STATS["cache_hits"] += 1
                        resolved_map[ip_s] = cached_item
                    elif now - GEOIP_NEGATIVE_CACHE.get(ip_s, 0) < GEOIP_NEG_TTL_SECONDS and not force_sync:
                        continue
                    else:
                        GEOIP_WORKER_STATS["cache_misses"] += 1
                        missing_ips.append(ip_s)

            if missing_ips:
                newly_resolved = resolve_geoip_batch_from_ip_api(missing_ips)
                resolved_map.update(newly_resolved)
                GEOIP_WAKE_EVENT.set()
            elif force_sync:
                GEOIP_WAKE_EVENT.set()

            resp = json.dumps({
                "success": True,
                "results": resolved_map,
                "worker": get_geoip_worker_summary()
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 9b. Limpiar historial de errores del Worker GeoIP en el nodo principal
        elif clean_path == "/api/net/geoip/clear-errors":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            cleared_count = clear_geoip_worker_errors()
            resp = json.dumps({
                "success": True,
                "cleared": cleared_count,
                "worker": get_geoip_worker_summary()
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 10. Configuración del Motor de Mapas (Modo Libre Fijo)
        elif clean_path == "/api/maps/config":
            resp = json.dumps({"success": True, "engine": "leaflet", "provider": "OpenStreetMap"}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 11. Control de Proyección USB (Samsung DeX / Android Desktop) para Entorno Nativo/Móvil
        elif clean_path in ("/api/dex/start", "/api/dex/stop"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8', errors='ignore') if content_length > 0 else "{}"
            try:
                body = json.loads(post_data)
            except Exception:
                body = {}
            try:
                from desktop_app.dex_controller import DexController
                if not hasattr(DashboardHTTPHandler, "_shared_dex_ctrl"):
                    DashboardHTTPHandler._shared_dex_ctrl = DexController()
                ctrl = DashboardHTTPHandler._shared_dex_ctrl
                if clean_path == "/api/dex/stop":
                    ok = ctrl.stop_dex_session()
                    resp = json.dumps({"success": bool(ok), "session_running": ctrl.is_session_running()}).encode('utf-8')
                else:
                    serial = str(body.get("serial") or body.get("device_id") or "").strip()
                    res_str = str(body.get("resolution") or "1920x1080").strip()
                    ok = ctrl.start_dex_session(
                        device_id=serial or None,
                        resolution=res_str,
                        fullscreen=bool(body.get("fullscreen", False)),
                        max_fps=int(body.get("max_fps", 60)),
                        use_uhid=True,
                        turn_screen_off=False
                    )
                    resp = json.dumps({"success": bool(ok), "session_running": ctrl.is_session_running()}).encode('utf-8')
            except Exception as e:
                resp = json.dumps({"success": False, "error": str(e)}).encode('utf-8')
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
    threading.Thread(target=fetch_connections_geo_worker, daemon=True).start()
    threading.Thread(target=background_collector, daemon=True).start()
    threading.Thread(target=telegram_bot_polling_worker, daemon=True, name="TelegramBotPolling").start()
    threading.Thread(target=telegram_bot_monitor_worker, daemon=True, name="TelegramBotMonitor").start()
    
    bind_host = os.environ.get("HOST", "0.0.0.0")
    server_address = (bind_host, port)
    httpd = ThreadingHTTPServer(server_address, DashboardHTTPHandler)
    print(f"[+] Monitor de Sistema iniciado en http://{bind_host}:{port} con Zero-Trust Pairing, Monitor Wi-Fi y Bot de Telegram Integrado")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
