import json
import gzip
import html
import os
import pwd
import re
import subprocess
import sys
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
import shutil
import urllib.request
import urllib.parse

try:
    from i18n_catalog import (
        get_canonical_version,
        get_dictionary_bytes,
        get_dictionary_csv_bytes,
        get_gpu_process_label,
        get_hardware_disk_label,
        get_hardware_transport_label,
        get_systemd_role_label,
        schedule_background_dictionary_sync,
        sync_dictionary_from_github,
        t as i18n_t,
    )
except ImportError:
    def get_canonical_version(base_dir=None):
        v_path = os.path.join(base_dir or os.path.dirname(os.path.abspath(__file__)), "VERSION")
        if os.path.isfile(v_path):
            with open(v_path, "r", encoding="utf-8") as vf:
                return vf.read().strip().lstrip("vV") or "0.0.0"
        return "0.0.0"

    def i18n_t(key, lang=None, base_dir=None, fallback=None, **params):
        return (fallback or str(key)).format(**params) if params else (fallback or str(key))

    def get_dictionary_bytes(base_dir=None):
        return b"{}"

    def get_dictionary_csv_bytes(base_dir=None):
        return b"key,context,es\n"

    def get_hardware_transport_label(transport_key, lang=None, base_dir=None):
        return str(transport_key)

    def get_hardware_disk_label(label_key, params=None, lang=None, base_dir=None):
        return str((params or {}).get("name") or (params or {}).get("leaf") or label_key)

    def get_gpu_process_label(proc_key, fallback=None, lang=None, base_dir=None):
        return fallback or str(proc_key)

    def get_systemd_role_label(unit_name, lang=None, base_dir=None):
        return ""

    def sync_dictionary_from_github(base_dir=None, force=False, timeout=5.0, min_interval=900.0):
        return {"ok": False, "updated": False, "source": "local", "supported_locales": ["es"]}

    def schedule_background_dictionary_sync(base_dir=None, interval_sec=1800.0):
        return None

try:
    from themes_catalog import (
        get_single_theme_payload,
        get_theme_pack_bytes,
        get_themes_catalog_payload,
        start_background_themes_ota_sync,
        sync_themes_from_github,
    )
except ImportError:
    def get_themes_catalog_payload(base_dir=None):
        return {"ok": True, "schema_version": 2, "default_theme": "alethia-matrix", "source": "local", "assets": {}, "themes": []}

    def get_single_theme_payload(theme_id, base_dir=None):
        return None

    def get_theme_pack_bytes(base_dir=None):
        return None

    def sync_themes_from_github(base_dir=None, force=False, timeout=5.0):
        return {"ok": False, "source": "local"}

    def start_background_themes_ota_sync(base_dir=None):
        return None

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    AESGCM = None


# ==============================================================================
# Global Caches, Concurrency Locks & Configuration
# ==============================================================================
METRICS_CACHE = {}
METRICS_CACHE_BYTES = None
METRICS_CACHE_SEQ = 0
_METRICS_SERIALIZED_CACHE = {}
METRICS_LOCK = threading.Lock()

_NET_CONNS_LOCK = threading.Lock()
_NET_CONNS_CACHE = []
_NET_CONNS_CACHE_TS = 0.0
_UID_NAME_CACHE = {}
_LAST_CONN_HISTORY_SAVE_TS = 0.0
_LAST_GEOIP_PRUNE_TS = 0.0
_LAST_PMON_IDLE_POLL_TS = 0.0
_PMON_IDLE_CACHE = {}

def _invalidate_metrics_bytes_cache():
    global METRICS_CACHE_BYTES, METRICS_CACHE_SEQ
    METRICS_CACHE_BYTES = None
    METRICS_CACHE_SEQ += 1
    _METRICS_SERIALIZED_CACHE.clear()

def get_cached_inet_connections(max_age=3.5):
    """Comparte la instantánea de sockets `psutil.net_connections(kind='inet')` entre hilos para evitar escaneos redundantes de `/proc/*/fd/*`."""
    global _NET_CONNS_CACHE, _NET_CONNS_CACHE_TS
    now_mono = time.monotonic()
    with _NET_CONNS_LOCK:
        if _NET_CONNS_CACHE and (now_mono - _NET_CONNS_CACHE_TS) < max_age:
            return _NET_CONNS_CACHE
        try:
            conns = psutil.net_connections(kind="inet")
        except Exception:
            conns = _NET_CONNS_CACHE or []
        _NET_CONNS_CACHE = conns
        _NET_CONNS_CACHE_TS = time.monotonic()
        return _NET_CONNS_CACHE

def _resolve_uid_name(uids_val):
    """Resuelve el UID real a nombre de usuario con caché en memoria (evita cientos de llamadas C `pwd.getpwuid` por ciclo)."""
    if uids_val is None:
        return "system"
    uid = getattr(uids_val, "real", None)
    if uid is None:
        return "system"
    cached = _UID_NAME_CACHE.get(uid)
    if cached is not None:
        return cached
    try:
        name = pwd.getpwuid(uid).pw_name
    except Exception:
        name = str(uid)
    if len(_UID_NAME_CACHE) > 2048:
        _UID_NAME_CACHE.clear()
    _UID_NAME_CACHE[uid] = name
    return name

DOCKER_CACHE = []
DOCKER_LOCK = threading.Lock()
SYSTEMD_CACHE = []
EXTRAS_CACHE = {"torrents": [], "torrent_stats": {}, "emby": {}, "parental": {}}

DISKS_CACHE = []
DISKS_LOCK = threading.Lock()

GPU_CACHE = {"available": False, "gpu_procs_map": {}, "capabilities": {}, "history": []}
GPU_LOCK = threading.Lock()
_GPU_HISTORY_BUCKETS_20M = []  # cubetas de 5 s durante 20 min para sub-gráficas dinámicas de GPU
_PROC_IO_PREV = {}             # { pid: (ts_float, read_bytes, write_bytes) }

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

PING_LATENCY_LOCK = threading.Lock()
PING_LATENCY_CACHE = {
    "updated_at": "",
    "timestamps": [],
    "epoch_ts": [],
    "targets": [],
}
_PING_HISTORY_POINTS = []

ROUTER_HISTORY_LOCK = threading.Lock()
_ROUTER_HISTORY_BUCKETS_20M = []

PROCESS_HISTORY_LOCK = threading.Lock()
_LAST_PROC_HISTORY_RECORD_TS = 0.0

SPEEDTEST_LOCK = threading.Lock()
SPEEDTEST_STATE = {
    "running": False,
    "phase": "idle",
    "progress_pct": 0,
    "current_mbps": 0.0,
    "ping_ms": 0.0,
    "jitter_ms": 0.0,
    "packet_loss_pct": 0.0,
    "download_mbps": 0.0,
    "upload_mbps": 0.0,
    "server_name": "",
    "server_host": "",
    "server_location": "",
    "client_ip": "",
    "isp": "",
    "scope": "wan",
    "error": "",
    "started_at": 0.0,
    "last_result": None,
}
ACTIVE_SERVER_PORT = 8085

def _detect_default_gateway_ip():
    """Detecta dinámicamente la IP de la puerta de enlace por defecto desde /proc/net/route."""
    try:
        with open("/proc/net/route", "r", encoding="utf-8") as f:
            next(f, None)
            for line in f:
                fields = line.strip().split()
                if len(fields) >= 3 and fields[1] == "00000000":
                    gw_hex = fields[2]
                    if len(gw_hex) == 8:
                        gw_ip = ".".join(str(int(gw_hex[i:i+2], 16)) for i in (6, 4, 2, 0))
                        if gw_ip != "0.0.0.0":
                            return gw_ip
    except Exception:
        pass
    return ""

# Directorio base del proyecto, clave maestra y credenciales cifradas del router/AP (Zero-Hardcoding)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TRUSTED_FILE = os.path.join(BASE_DIR, "trusted_devices.json")
TRUST_LOCK = threading.Lock()
CUSTOM_LOGOS_FILE = os.path.join(BASE_DIR, "custom_logos.json")
CUSTOM_LOGOS_LOCK = threading.Lock()

def _load_or_create_admin_master_key():
    """Obtiene ADMIN_MASTER_KEY de entorno o genera/persiste una clave aleatoria segura en disco."""
    env_key = os.environ.get("ADMIN_MASTER_KEY", "").strip()
    if env_key:
        return env_key
    key_file = os.path.join(BASE_DIR, ".admin_master_key")
    if os.path.isfile(key_file):
        try:
            with open(key_file, "r", encoding="utf-8") as f:
                val = f.read().strip()
                if val:
                    return val
        except Exception:
            pass
    generated = secrets.token_urlsafe(24)
    try:
        with open(key_file, "w", encoding="utf-8") as f:
            f.write(generated)
        os.chmod(key_file, 0o600)
    except Exception:
        pass
    return generated

ADMIN_MASTER_KEY = _load_or_create_admin_master_key()
_ROUTER_VAULT_AAD = b"recursos-router-vault-v1"

def _get_router_vault_secret():
    """Combina ADMIN_MASTER_KEY con /etc/machine-id para ligar la bóveda al servidor físico."""
    machine_id = ""
    if os.path.isfile("/etc/machine-id"):
        try:
            with open("/etc/machine-id", "r", encoding="utf-8") as f:
                machine_id = f.read().strip()
        except Exception:
            pass
    return f"{ADMIN_MASTER_KEY}:{machine_id}".encode("utf-8")

def _encrypt_router_credentials_dict(payload):
    """Cifra credenciales del router con AES-256-GCM y PBKDF2-HMAC-SHA256."""
    if AESGCM is None or not isinstance(payload, dict):
        return {}
    salt = os.urandom(16)
    nonce = os.urandom(12)
    iterations = 200000
    key = hashlib.pbkdf2_hmac("sha256", _get_router_vault_secret(), salt, iterations, dklen=32)
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(nonce, raw, _ROUTER_VAULT_AAD)
    return {
        "encrypted": True,
        "cipher": "AES-256-GCM",
        "kdf": "PBKDF2-HMAC-SHA256",
        "iterations": iterations,
        "salt": base64.b64encode(salt).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }

def _decrypt_router_credentials_dict(enc_data):
    """Descifra el sobre AES-256-GCM de credenciales del router."""
    if AESGCM is None or not isinstance(enc_data, dict):
        return {}
    try:
        salt = base64.b64decode(str(enc_data.get("salt", "")))
        nonce = base64.b64decode(str(enc_data.get("nonce", "")))
        ciphertext = base64.b64decode(str(enc_data.get("ciphertext", "")))
        iterations = int(enc_data.get("iterations", 200000))
        key = hashlib.pbkdf2_hmac("sha256", _get_router_vault_secret(), salt, iterations, dklen=32)
        raw = AESGCM(key).decrypt(nonce, ciphertext, _ROUTER_VAULT_AAD)
        decoded = json.loads(raw.decode("utf-8"))
        return decoded if isinstance(decoded, dict) else {}
    except Exception:
        return {}

ROUTER_CREDS_LOCK = threading.Lock()

def _normalize_router_port(raw_port):
    try:
        p = int(str(raw_port or "").strip())
        if 1 <= p <= 65535:
            return p
    except Exception:
        pass
    return 22

def _load_router_credentials():
    """Carga IP/usuario/clave/puerto del router desde env o .router_credentials.json cifrado en AES-256-GCM."""
    cfg_ip = os.environ.get("RECURSOS_ROUTER_IP", "").strip()
    cfg_user = os.environ.get("RECURSOS_ROUTER_USER", "").strip()
    cfg_pass = os.environ.get("RECURSOS_ROUTER_PASS", "").strip()
    cfg_port = _normalize_router_port(os.environ.get("RECURSOS_ROUTER_PORT", "22"))
    creds_encrypted = False
    decrypt_failed = False
    creds_file = os.path.join(BASE_DIR, ".router_credentials.json")
    if os.path.isfile(creds_file):
        try:
            with open(creds_file, "r", encoding="utf-8") as f:
                raw_creds = json.load(f)
            if isinstance(raw_creds, dict):
                if raw_creds.get("encrypted") is True:
                    dec = _decrypt_router_credentials_dict(raw_creds)
                    if dec:
                        creds_encrypted = True
                        cfg_ip = cfg_ip or str(dec.get("router_ip", "")).strip()
                        cfg_user = cfg_user or str(dec.get("router_user", "")).strip()
                        cfg_pass = cfg_pass or str(dec.get("router_pass", "")).strip()
                        if dec.get("router_port") is not None and not os.environ.get("RECURSOS_ROUTER_PORT"):
                            cfg_port = _normalize_router_port(dec.get("router_port"))
                    else:
                        decrypt_failed = True
                else:
                    plain_ip = str(raw_creds.get("router_ip", "")).strip()
                    plain_user = str(raw_creds.get("router_user", "")).strip()
                    plain_pass = str(raw_creds.get("router_pass", "")).strip()
                    plain_port = _normalize_router_port(raw_creds.get("router_port"))
                    cfg_ip = cfg_ip or plain_ip
                    cfg_user = cfg_user or plain_user
                    cfg_pass = cfg_pass or plain_pass
                    if not os.environ.get("RECURSOS_ROUTER_PORT"):
                        cfg_port = plain_port
                    if plain_ip and plain_user and plain_pass and AESGCM is not None:
                        try:
                            enc_blob = _encrypt_router_credentials_dict({
                                "router_ip": plain_ip,
                                "router_user": plain_user,
                                "router_pass": plain_pass,
                                "router_port": cfg_port,
                            })
                            with open(creds_file, "w", encoding="utf-8") as wf:
                                json.dump(enc_blob, wf, indent=2)
                            os.chmod(creds_file, 0o600)
                            creds_encrypted = True
                        except Exception:
                            pass
        except Exception:
            pass
    if not cfg_ip:
        cfg_ip = _detect_default_gateway_ip()
    return cfg_ip, cfg_user, cfg_pass, cfg_port, creds_encrypted, decrypt_failed

ROUTER_IP, ROUTER_USER, ROUTER_PASS, ROUTER_SSH_PORT, ROUTER_CREDS_ENCRYPTED, ROUTER_CREDS_DECRYPT_FAILED = _load_router_credentials()

def _validate_router_credentials_input(ip_val, user_val, pass_val, port_val=22):
    clean_ip = str(ip_val or "").strip()
    clean_user = str(user_val or "").strip()
    clean_pass = str(pass_val or "")
    clean_port = _normalize_router_port(port_val)
    if not _is_lan_ipv4(clean_ip):
        return None, "La IP del router debe ser una dirección IPv4 privada válida en red local (LAN)."
    if not clean_user or clean_user.startswith("-") or not re.match(r"^[A-Za-z0-9._-]{1,64}$", clean_user):
        return None, "El usuario SSH del router contiene caracteres no válidos."
    if not clean_pass or len(clean_pass) > 256:
        return None, "Introduce la contraseña SSH del router."
    try:
        p_raw = int(str(port_val if port_val not in (None, "") else 22).strip())
        if not (1 <= p_raw <= 65535):
            return None, "El puerto SSH debe estar entre 1 y 65535."
        clean_port = p_raw
    except Exception:
        return None, "El puerto SSH debe ser numérico."
    return (clean_ip, clean_user, clean_pass, clean_port), ""

def _build_router_ssh_base_cmd(clean_ip, clean_user, clean_port, use_control_master=False):
    cmd = [
        "sshpass", "-e",
        "ssh",
        "-o", "PubkeyAuthentication=no",
        "-o", "PreferredAuthentications=password",
        "-o", "NumberOfPasswordPrompts=1",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        "-o", "ConnectTimeout=4",
    ]
    if use_control_master:
        cmd.extend([
            "-o", "ServerAliveInterval=25",
            "-o", "ControlMaster=auto",
            "-o", "ControlPersist=300",
            "-o", f"ControlPath={_router_ssh_control_path()}",
        ])
    cmd.extend(["-p", str(clean_port), f"{clean_user}@{clean_ip}"])
    return cmd

def _test_router_ssh_connection(ip_val, user_val, pass_val, port_val=22):
    validated, err = _validate_router_credentials_input(ip_val, user_val, pass_val, port_val)
    if not validated:
        return False, "", err
    clean_ip, clean_user, clean_pass, clean_port = validated
    if not shutil.which("sshpass") or not shutil.which("ssh"):
        return False, "", "sshpass o el cliente ssh no están disponibles en este servidor."
    ssh_env = os.environ.copy()
    ssh_env["SSHPASS"] = clean_pass
    cmd = _build_router_ssh_base_cmd(clean_ip, clean_user, clean_port, use_control_master=False) + [
        "nvram get productid 2>/dev/null || uname -n 2>/dev/null || echo OK",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=7, env=ssh_env)
        if res.returncode == 0:
            lines = [ln.strip() for ln in (res.stdout or "").splitlines() if ln.strip() and ln.strip() != "OK"]
            model_name = lines[0][:64] if lines else ""
            return True, model_name, ""
        err_out = (res.stderr or res.stdout or "").strip()
        if "permission denied" in err_out.lower() or res.returncode == 5:
            return False, "", "Autenticación SSH rechazada: usuario o contraseña incorrectos."
        if "connection refused" in err_out.lower():
            return False, "", f"Conexión rechazada en {clean_ip}:{clean_port} (verifica que SSH esté habilitado en el router)."
        if "timed out" in err_out.lower() or res.returncode == 255:
            return False, "", f"No se pudo conectar por SSH con {clean_ip}:{clean_port} ({err_out[:140] or 'tiempo agotado'})."
        return False, "", err_out[:180] or f"Error SSH (código {res.returncode})."
    except subprocess.TimeoutExpired:
        return False, "", f"Tiempo de espera agotado conectando por SSH con {clean_ip}:{clean_port}."
    except Exception as exc:
        return False, "", str(exc)[:180]

ROUTER_SSH_BACKOFF_UNTIL = 0.0
ROUTER_SSH_CONSECUTIVE_FAILS = 0
ROUTER_SSH_LAST_ERROR = ""

def _router_ssh_control_path():
    uid = os.getuid() if hasattr(os, "getuid") else 0
    return os.path.join("/tmp", f"recursos_router_ssh_{uid}.sock")

def _reset_router_ssh_session():
    global ROUTER_SSH_BACKOFF_UNTIL, ROUTER_SSH_CONSECUTIVE_FAILS, ROUTER_SSH_LAST_ERROR
    ROUTER_SSH_BACKOFF_UNTIL = 0.0
    ROUTER_SSH_CONSECUTIVE_FAILS = 0
    ROUTER_SSH_LAST_ERROR = ""
    ctl_path = _router_ssh_control_path()
    if os.path.exists(ctl_path):
        try:
            subprocess.run(["ssh", "-O", "exit", "-o", f"ControlPath={ctl_path}", "127.0.0.1"], capture_output=True, timeout=2)
        except Exception:
            pass
        try:
            if os.path.exists(ctl_path):
                os.remove(ctl_path)
        except Exception:
            pass

def _save_router_credentials_vault(ip_val, user_val, pass_val, port_val=22):
    global ROUTER_IP, ROUTER_USER, ROUTER_PASS, ROUTER_SSH_PORT, ROUTER_CREDS_ENCRYPTED, ROUTER_CREDS_DECRYPT_FAILED
    validated, err = _validate_router_credentials_input(ip_val, user_val, pass_val, port_val)
    if not validated:
        return False, err
    if AESGCM is None:
        return False, "Módulo criptográfico AES-256-GCM no disponible en Python."
    clean_ip, clean_user, clean_pass, clean_port = validated
    enc_blob = _encrypt_router_credentials_dict({
        "router_ip": clean_ip,
        "router_user": clean_user,
        "router_pass": clean_pass,
        "router_port": clean_port,
    })
    creds_file = os.path.join(BASE_DIR, ".router_credentials.json")
    tmp_file = f"{creds_file}.tmp"
    with open(tmp_file, "w", encoding="utf-8") as wf:
        json.dump(enc_blob, wf, indent=2)
    os.chmod(tmp_file, 0o600)
    os.replace(tmp_file, creds_file)
    with ROUTER_CREDS_LOCK:
        ROUTER_IP = clean_ip
        ROUTER_USER = clean_user
        ROUTER_PASS = clean_pass
        ROUTER_SSH_PORT = clean_port
        ROUTER_CREDS_ENCRYPTED = True
        ROUTER_CREDS_DECRYPT_FAILED = False
        _reset_router_ssh_session()
    with METRICS_LOCK:
        _invalidate_metrics_bytes_cache()
    return True, ""

def _clear_router_credentials_vault():
    global ROUTER_IP, ROUTER_USER, ROUTER_PASS, ROUTER_SSH_PORT, ROUTER_CREDS_ENCRYPTED, ROUTER_CREDS_DECRYPT_FAILED
    creds_file = os.path.join(BASE_DIR, ".router_credentials.json")
    if os.path.isfile(creds_file):
        try:
            os.remove(creds_file)
        except Exception:
            pass
    with ROUTER_CREDS_LOCK:
        ROUTER_IP = os.environ.get("RECURSOS_ROUTER_IP", "").strip() or _detect_default_gateway_ip()
        ROUTER_USER = os.environ.get("RECURSOS_ROUTER_USER", "").strip()
        ROUTER_PASS = os.environ.get("RECURSOS_ROUTER_PASS", "").strip()
        ROUTER_SSH_PORT = _normalize_router_port(os.environ.get("RECURSOS_ROUTER_PORT", "22"))
        ROUTER_CREDS_ENCRYPTED = False
        ROUTER_CREDS_DECRYPT_FAILED = False
        _reset_router_ssh_session()
    with METRICS_LOCK:
        _invalidate_metrics_bytes_cache()
    return True
# Hash criptográfico con sal (PBKDF2-HMAC-SHA256) para clave maestra secundaria de respaldo
_DEFAULT_SECONDARY_KEY_HASH = "pbkdf2_sha256$200000$d5d02ed57d1232f3da8f212fb615ad59$c1f752cd0c3ffe58203801901e98f7263401f847c74e815d375a8a3e5227ae3f"

def _verify_pbkdf2_secret(plain_candidate, encoded_hash):
    try:
        parts = str(encoded_hash or "").split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iterations = int(parts[1])
        salt = parts[2]
        expected_hex = parts[3]
        dk_hex = hashlib.pbkdf2_hmac(
            "sha256",
            plain_candidate.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        ).hex()
        return hmac.compare_digest(dk_hex, expected_hex)
    except Exception:
        return False

def verify_master_key(entered_key):
    if not entered_key:
        return False
    if ADMIN_MASTER_KEY and hmac.compare_digest(entered_key, ADMIN_MASTER_KEY):
        return True
    secondary_hash = os.environ.get("RECURSOS_ADMIN_SECRET_HASH", "").strip() or _DEFAULT_SECONDARY_KEY_HASH
    return _verify_pbkdf2_secret(entered_key, secondary_hash)

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
    global METRICS_CACHE_BYTES
    try:
        clean = logos_dict if isinstance(logos_dict, dict) else {}
        with open(CUSTOM_LOGOS_FILE, "w", encoding="utf-8") as f:
            json.dump(clean, f, indent=2, ensure_ascii=False)
        try:
            CUSTOM_LOGOS_CACHE["mtime"] = os.path.getmtime(CUSTOM_LOGOS_FILE)
        except Exception:
            CUSTOM_LOGOS_CACHE["mtime"] = time.time()
        CUSTOM_LOGOS_CACHE["data"] = dict(clean)
        with METRICS_LOCK:
            _invalidate_metrics_bytes_cache()
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

# Real-time Metrics History (Rolling 20-minute window in peak-preserving 5s buckets)
HISTORY_WINDOW_SECONDS = 1200  # 20 minutos
HISTORY_BUCKET_SECONDS = 5     # cubetas de 5s -> hasta 240 puntos en 20 minutos
MAX_HISTORY = HISTORY_WINDOW_SECONDS // HISTORY_BUCKET_SECONDS
_HISTORY_BUCKETS_20M = []

HISTORY = {
    "timestamps": [],
    "epoch_ts": [],
    "cpu": [],
    "cpu_temp": [],
    "cpu_freq": [],
    "cpu_power": [],
    "cpu_load_1m": [],
    "cpu_load_5m": [],
    "cpu_user": [],
    "cpu_system": [],
    "cpu_iowait": [],
    "gpu": [],
    "gpu_vram_pct": [],
    "gpu_mem_ctrl": [],
    "gpu_enc": [],
    "gpu_dec": [],
    "gpu_power": [],
    "gpu_temp": [],
    "gpu_clk_gfx": [],
    "gpu_clk_mem": [],
    "gpu_pcie_rx": [],
    "gpu_pcie_tx": [],
    "ram": [],
    "ram_total": [],
    "net_rx": [],
    "net_tx": [],
    "net_wan_rx": [],
    "net_wan_tx": [],
    "net_lan_rx": [],
    "net_lan_tx": [],
    "disk_r": [],
    "disk_w": [],
    "disk_pct": []
}

_EXTENDED_TELEMETRY_COLS = (
    "cpu_temp",
    "cpu_freq",
    "cpu_power",
    "cpu_load_1m",
    "cpu_load_5m",
    "cpu_user",
    "cpu_system",
    "cpu_iowait",
    "gpu_vram_pct",
    "gpu_mem_ctrl",
    "gpu_enc",
    "gpu_dec",
    "gpu_power",
    "gpu_temp",
    "gpu_clk_gfx",
    "gpu_clk_mem",
    "gpu_pcie_rx",
    "gpu_pcie_tx",
)

def _sync_history_dict_from_buckets():
    HISTORY["timestamps"] = [b["time_str"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["epoch_ts"] = [b["ts"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["cpu"] = [b["cpu"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["gpu"] = [b["gpu"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["ram"] = [b["ram"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["ram_total"] = [b["ram_total"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["net_rx"] = [b["net_rx"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["net_tx"] = [b["net_tx"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["net_wan_rx"] = [b.get("net_wan_rx", b["net_rx"]) for b in _HISTORY_BUCKETS_20M]
    HISTORY["net_wan_tx"] = [b.get("net_wan_tx", b["net_tx"]) for b in _HISTORY_BUCKETS_20M]
    HISTORY["net_lan_rx"] = [b.get("net_lan_rx", 0.0) for b in _HISTORY_BUCKETS_20M]
    HISTORY["net_lan_tx"] = [b.get("net_lan_tx", 0.0) for b in _HISTORY_BUCKETS_20M]
    HISTORY["disk_r"] = [b["disk_r"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["disk_w"] = [b["disk_w"] for b in _HISTORY_BUCKETS_20M]
    HISTORY["disk_pct"] = [b["disk_pct"] for b in _HISTORY_BUCKETS_20M]
    for col in _EXTENDED_TELEMETRY_COLS:
        HISTORY[col] = [b.get(col, 0.0) for b in _HISTORY_BUCKETS_20M]

def _push_history_bucket(
    sample_ts,
    time_str,
    cpu_val,
    gpu_val,
    ram_val,
    ram_tot_val,
    net_rx_val,
    net_tx_val,
    disk_r_val,
    disk_w_val,
    disk_pct_val,
    net_wan_rx_val=None,
    net_wan_tx_val=None,
    net_lan_rx_val=None,
    net_lan_tx_val=None,
    extra=None,
    sync=True,
):
    ts_num = float(sample_ts)
    b_ts = (int(ts_num) // HISTORY_BUCKET_SECONDS) * HISTORY_BUCKET_SECONDS
    cutoff_b_ts = b_ts - HISTORY_WINDOW_SECONDS

    c_v = round(float(cpu_val or 0.0), 2)
    g_v = round(float(gpu_val or 0.0), 2)
    r_v = round(float(ram_val or 0.0), 2)
    rt_v = round(float(ram_tot_val or 0.0), 2)
    nrx_v = round(float(net_rx_val or 0.0), 2)
    ntx_v = round(float(net_tx_val or 0.0), 2)
    nwan_rx_v = round(float(nrx_v if net_wan_rx_val is None else (net_wan_rx_val or 0.0)), 2)
    nwan_tx_v = round(float(ntx_v if net_wan_tx_val is None else (net_wan_tx_val or 0.0)), 2)
    nlan_rx_v = round(float(0.0 if net_lan_rx_val is None else (net_lan_rx_val or 0.0)), 2)
    nlan_tx_v = round(float(0.0 if net_lan_tx_val is None else (net_lan_tx_val or 0.0)), 2)
    dr_v = round(float(disk_r_val or 0.0), 2)
    dw_v = round(float(disk_w_val or 0.0), 2)
    dp_v = round(float(disk_pct_val or 0.0), 1)
    t_str = str(time_str or "")
    ext = extra if isinstance(extra, dict) else {}
    ext_vals = {
        col: round(float(ext.get(col) or 0.0), 2)
        for col in _EXTENDED_TELEMETRY_COLS
    }

    if not _HISTORY_BUCKETS_20M or _HISTORY_BUCKETS_20M[-1]["b_ts"] < b_ts:
        entry = {
            "b_ts": b_ts,
            "ts": round(ts_num, 2),
            "time_str": t_str,
            "cpu": c_v,
            "gpu": g_v,
            "ram": r_v,
            "ram_total": rt_v,
            "net_rx": nrx_v,
            "net_tx": ntx_v,
            "net_wan_rx": nwan_rx_v,
            "net_wan_tx": nwan_tx_v,
            "net_lan_rx": nlan_rx_v,
            "net_lan_tx": nlan_tx_v,
            "disk_r": dr_v,
            "disk_w": dw_v,
            "disk_pct": dp_v,
        }
        entry.update(ext_vals)
        _HISTORY_BUCKETS_20M.append(entry)
    elif _HISTORY_BUCKETS_20M[-1]["b_ts"] == b_ts:
        last_b = _HISTORY_BUCKETS_20M[-1]
        last_b["ts"] = round(ts_num, 2)
        if t_str:
            last_b["time_str"] = t_str
        last_b["cpu"] = max(last_b["cpu"], c_v)
        last_b["gpu"] = max(last_b["gpu"], g_v)
        last_b["ram"] = max(last_b["ram"], r_v)
        last_b["ram_total"] = max(last_b["ram_total"], rt_v)
        last_b["net_rx"] = max(last_b["net_rx"], nrx_v)
        last_b["net_tx"] = max(last_b["net_tx"], ntx_v)
        last_b["net_wan_rx"] = max(last_b.get("net_wan_rx", 0.0), nwan_rx_v)
        last_b["net_wan_tx"] = max(last_b.get("net_wan_tx", 0.0), nwan_tx_v)
        last_b["net_lan_rx"] = max(last_b.get("net_lan_rx", 0.0), nlan_rx_v)
        last_b["net_lan_tx"] = max(last_b.get("net_lan_tx", 0.0), nlan_tx_v)
        last_b["disk_r"] = max(last_b["disk_r"], dr_v)
        last_b["disk_w"] = max(last_b["disk_w"], dw_v)
        last_b["disk_pct"] = max(last_b["disk_pct"], dp_v)
        for col in _EXTENDED_TELEMETRY_COLS:
            nv = ext_vals[col]
            pv = last_b.get(col, 0.0)
            if col in ("cpu_freq", "gpu_clk_gfx", "gpu_clk_mem"):
                last_b[col] = nv if nv > 0 else pv
            else:
                last_b[col] = max(pv, nv)

    while _HISTORY_BUCKETS_20M and _HISTORY_BUCKETS_20M[0]["b_ts"] < cutoff_b_ts:
        _HISTORY_BUCKETS_20M.pop(0)

    if sync:
        _sync_history_dict_from_buckets()

# Rolling 20-Minute per-NIC Bandwidth History Buffer (100% OS-driven from /proc/net/dev)
NIC_BANDWIDTH_HISTORY_2H = {}  # { nic_name: [ {"t": ms_epoch, "rx": float_bytes_sec, "tx": float_bytes_sec}, ... ] }
NIC_BANDWIDTH_LOCK = threading.Lock()
MAX_NIC_HISTORY_SECONDS = 1200  # 20 minutos
NIC_BUCKET_INTERVAL_MS = 5000   # cubetas de 5 segundos (240 cubetas en 20 minutos)
NIC_HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nic_history_2h.json")
_LAST_NIC_HISTORY_SAVE_TS = 0.0

# Rolling 20-Minute per-Disk / Pool I/O History Buffer in 5s peak-preserving buckets (matching 5m Overview + 20m Modal)
DISK_BANDWIDTH_HISTORY = {}   # { io_key: [ {"t": ms_epoch, "r": float_bytes_sec, "w": float_bytes_sec}, ... ] }
DISK_PREV_COUNTERS = {}       # { io_key: (ts_float, read_bytes, write_bytes) }
DISK_BANDWIDTH_LOCK = threading.Lock()
MAX_DISK_HISTORY_SECONDS = 1200  # 20 minutos en cubetas de 5 s (240 puntos máx.; Inicio recorta últimos 5 min)
DISK_BUCKET_INTERVAL_MS = 5000


def _read_cifs_stats_by_host():
    """Lee contadores reales de lectura/escritura CIFS/SMB desde /proc/fs/cifs/Stats por host y por recurso UNC."""
    stats_path = "/proc/fs/cifs/Stats"
    by_host = {}
    by_share = {}
    if not os.path.exists(stats_path):
        return by_host, by_share
    try:
        with open(stats_path, "r", encoding="utf-8", errors="ignore") as f:
            current_host = None
            current_share = None
            for raw_line in f:
                line = raw_line.strip()
                if not line:
                    continue
                m_share = re.match(r"^\d+\)\s+(\\\\[^\\/\s]+[\\/][^\s]+)", line)
                if m_share:
                    unc = m_share.group(1).replace("\\", "/").lower().rstrip("/")
                    parts = [p for p in unc.split("/") if p]
                    current_host = parts[0] if parts else None
                    current_share = "//" + "/".join(parts) if parts else None
                    continue
                m_bytes = re.search(r"Bytes read:\s*(\d+)\s+Bytes written:\s*(\d+)", line)
                if m_bytes and current_host:
                    r_b = int(m_bytes.group(1))
                    w_b = int(m_bytes.group(2))
                    h_acc = by_host.setdefault(current_host, [0, 0])
                    h_acc[0] += r_b
                    h_acc[1] += w_b
                    if current_share:
                        s_acc = by_share.setdefault(current_share, [0, 0])
                        s_acc[0] += r_b
                        s_acc[1] += w_b
                    current_host = None
                    current_share = None
    except Exception:
        pass
    return (
        {k: (v[0], v[1]) for k, v in by_host.items()},
        {k: (v[0], v[1]) for k, v in by_share.items()},
    )


def _resolve_disk_io_counters(disk_entry, per_disk, cifs_by_host, cifs_by_share):
    """Resuelve clave I/O única y contadores acumulados (read_bytes, write_bytes) para un disco o pool."""
    dev = str(disk_entry.get("device") or "").strip()
    fs_type = str(disk_entry.get("fs_type") or disk_entry.get("fstype") or "").lower()
    is_net = bool(disk_entry.get("is_network")) or dev.startswith("//") or dev.startswith("\\\\") or fs_type in ("cifs", "smb3", "smbfs", "nfs", "nfs4")
    if is_net:
        norm = "//" + "/".join([p for p in dev.replace("\\", "/").lower().split("/") if p])
        host = norm.lstrip("/").split("/", 1)[0] if norm else ""
        if host and host in cifs_by_host:
            r_b, w_b = cifs_by_host[host]
            return f"cifs:{host}", r_b, w_b
        if norm and norm in cifs_by_share:
            r_b, w_b = cifs_by_share[norm]
            return f"cifs:{norm}", r_b, w_b
        return f"net:{host or norm or disk_entry.get('mountpoint', 'net')}", None, None

    dev_real = dev
    try:
        if dev.startswith("/dev/") and os.path.exists(dev):
            dev_real = os.path.realpath(dev)
    except Exception:
        pass
    base = os.path.basename(dev_real)
    candidates = [base]
    m_nvme = re.match(r"^(nvme\d+n\d+)p\d+$", base)
    if m_nvme:
        candidates.append(m_nvme.group(1))
    m_sd = re.match(r"^([a-z]+)\d+$", base)
    if m_sd:
        candidates.append(m_sd.group(1))
    for cand in candidates:
        st = per_disk.get(cand)
        if st is not None:
            return f"blk:{cand}", int(st.read_bytes), int(st.write_bytes)
    return f"blk:{base or disk_entry.get('mountpoint', 'disk')}", None, None


def _update_disk_io_history(disks_list, now_ts=None):
    """Calcula tasas L/E reales por disco/pool, actualiza historial y enriquece cada dict."""
    if not disks_list:
        return
    ts = float(now_ts if now_ts is not None else time.time())
    ts_ms = int(ts * 1000)
    try:
        per_disk = psutil.disk_io_counters(perdisk=True) or {}
    except Exception:
        per_disk = {}
    cifs_by_host, cifs_by_share = _read_cifs_stats_by_host()

    active_keys = set()
    computed_tick = {}
    with DISK_BANDWIDTH_LOCK:
        for d in disks_list:
            io_key, r_total, w_total = _resolve_disk_io_counters(d, per_disk, cifs_by_host, cifs_by_share)
            active_keys.add(io_key)
            if io_key not in computed_tick:
                r_sec = 0.0
                w_sec = 0.0
                if r_total is not None and w_total is not None:
                    prev = DISK_PREV_COUNTERS.get(io_key)
                    if prev is not None:
                        prev_ts, prev_r, prev_w = prev
                        dt = ts - prev_ts
                        if dt > 0.2:
                            dr = max(0, r_total - prev_r) if r_total >= prev_r else 0
                            dw = max(0, w_total - prev_w) if w_total >= prev_w else 0
                            r_sec = dr / dt
                            w_sec = dw / dt
                    DISK_PREV_COUNTERS[io_key] = (ts, r_total, w_total)
                hist = DISK_BANDWIDTH_HISTORY.setdefault(io_key, [])
                bucket_ms = (ts_ms // DISK_BUCKET_INTERVAL_MS) * DISK_BUCKET_INTERVAL_MS
                cutoff_ms = ts_ms - (MAX_DISK_HISTORY_SECONDS * 1000)
                r_round = round(r_sec, 1)
                w_round = round(w_sec, 1)
                if not hist or (hist[-1]["t"] // DISK_BUCKET_INTERVAL_MS) * DISK_BUCKET_INTERVAL_MS < bucket_ms:
                    hist.append({
                        "t": ts_ms,
                        "r": r_round,
                        "w": w_round,
                    })
                else:
                    hist[-1]["t"] = ts_ms
                    if r_round > hist[-1]["r"]:
                        hist[-1]["r"] = r_round
                    if w_round > hist[-1]["w"]:
                        hist[-1]["w"] = w_round
                while hist and hist[0]["t"] < cutoff_ms:
                    hist.pop(0)
                computed_tick[io_key] = (r_round, w_round, list(hist))

            r_val, w_val, hist_copy = computed_tick[io_key]
            d["io_device"] = io_key
            d["read_bytes_sec"] = r_val
            d["write_bytes_sec"] = w_val
            d["io_history"] = hist_copy

        # Limpiar contadores de discos desmontados/desconectados
        for old_k in list(DISK_PREV_COUNTERS.keys()):
            if old_k not in active_keys:
                DISK_PREV_COUNTERS.pop(old_k, None)
        for old_k in list(DISK_BANDWIDTH_HISTORY.keys()):
            if old_k not in active_keys:
                DISK_BANDWIDTH_HISTORY.pop(old_k, None)

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
                    wan_rx_v = max(0.0, float(pt.get("wan_rx", rx_v)))
                    wan_tx_v = max(0.0, float(pt.get("wan_tx", tx_v)))
                    lan_rx_v = max(0.0, float(pt.get("lan_rx", max(0.0, rx_v - wan_rx_v))))
                    lan_tx_v = max(0.0, float(pt.get("lan_tx", max(0.0, tx_v - wan_tx_v))))
                    if b_ts in bucket_map:
                        bucket_map[b_ts]["rx"] = max(bucket_map[b_ts]["rx"], rx_v)
                        bucket_map[b_ts]["tx"] = max(bucket_map[b_ts]["tx"], tx_v)
                        bucket_map[b_ts]["wan_rx"] = max(bucket_map[b_ts]["wan_rx"], wan_rx_v)
                        bucket_map[b_ts]["wan_tx"] = max(bucket_map[b_ts]["wan_tx"], wan_tx_v)
                        bucket_map[b_ts]["lan_rx"] = max(bucket_map[b_ts]["lan_rx"], lan_rx_v)
                        bucket_map[b_ts]["lan_tx"] = max(bucket_map[b_ts]["lan_tx"], lan_tx_v)
                    else:
                        bucket_map[b_ts] = {
                            "t": b_ts,
                            "rx": rx_v,
                            "tx": tx_v,
                            "wan_rx": wan_rx_v,
                            "wan_tx": wan_tx_v,
                            "lan_rx": lan_rx_v,
                            "lan_tx": lan_tx_v,
                        }
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

# Dynamic Socket Traffic & Speed Tracking (ss -tin Kernel Telemetry)
SOCKET_TRAFFIC_STATS = {}
SOCKET_TRAFFIC_LOCK = threading.Lock()
RE_SS_ADDR = re.compile(r'^\s*(\w+)\s+\d+\s+\d+\s+([^\s]+)\s+([^\s]+)')
RE_SS_BYTES_SENT = re.compile(r'bytes_sent:(\d+)')
RE_SS_BYTES_RCV = re.compile(r'bytes_received:(\d+)')

def _normalize_ss_addr(addr):
    addr = str(addr or "").strip()
    if addr.startswith("["):
        ip, port = addr[1:].split("]:")
    elif ":" in addr:
        parts = addr.rsplit(":", 1)
        ip, port = parts[0], parts[1]
    else:
        ip, port = addr, "0"
    ip = ip.replace("::ffff:", "")
    return ip, int(port) if port.isdigit() else 0

def poll_socket_traffic_metrics():
    """
    Sondea directamente los sockets TCP del kernel mediante 'ss -tin' para extraer
    los bytes enviados (TX / carga), bytes recibidos (RX / descarga) y calcular la velocidad instantánea (B/s).
    """
    global SOCKET_TRAFFIC_STATS
    now = time.time()
    current_raw = {}
    try:
        proc = subprocess.run(
            ["ss", "-tin"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=1.8
        )
        if proc.returncode == 0 and proc.stdout:
            lines = proc.stdout.splitlines()
            i = 0
            while i < len(lines):
                line = lines[i]
                m = RE_SS_ADDR.match(line)
                if m:
                    state, loc_str, rem_str = m.groups()
                    extra = ""
                    j = i + 1
                    while j < len(lines) and (lines[j].startswith("\t") or lines[j].startswith(" ")):
                        extra += " " + lines[j].strip()
                        j += 1
                    loc_ip, loc_port = _normalize_ss_addr(loc_str)
                    rem_ip, rem_port = _normalize_ss_addr(rem_str)
                    m_sent = RE_SS_BYTES_SENT.search(extra)
                    m_rcv = RE_SS_BYTES_RCV.search(extra)
                    b_sent = int(m_sent.group(1)) if m_sent else 0
                    b_rcv = int(m_rcv.group(1)) if m_rcv else 0
                    current_raw[(loc_ip, loc_port, rem_ip, rem_port)] = (b_sent, b_rcv)
                    i = j
                else:
                    i += 1
    except Exception:
        pass

    with SOCKET_TRAFFIC_LOCK:
        new_stats = {}
        for key, (b_sent, b_rcv) in current_raw.items():
            loc_ip, loc_port, rem_ip, rem_port = key
            prev = SOCKET_TRAFFIC_STATS.get(key)
            tx_speed = 0.0
            rx_speed = 0.0
            if prev:
                dt = max(0.001, now - prev.get("ts", now))
                if dt <= 30.0:
                    delta_sent = b_sent - prev.get("bytes_sent", b_sent)
                    delta_rcv = b_rcv - prev.get("bytes_received", b_rcv)
                    if delta_sent >= 0:
                        tx_speed = round(delta_sent / dt, 1)
                    if delta_rcv >= 0:
                        rx_speed = round(delta_rcv / dt, 1)
            b_total = b_sent + b_rcv
            stat_obj = {
                "bytes_sent": b_sent,
                "bytes_received": b_rcv,
                "bytes_total": b_total,
                "tx_speed": tx_speed,
                "rx_speed": rx_speed,
                "total_speed": round(tx_speed + rx_speed, 1),
                "ts": now
            }
            new_stats[key] = stat_obj
            new_stats[(rem_ip, rem_port, loc_ip, loc_port)] = stat_obj
            new_stats[(rem_ip, rem_port)] = stat_obj
            new_stats[(rem_ip, loc_port)] = stat_obj

        for old_k, old_v in SOCKET_TRAFFIC_STATS.items():
            if old_k not in new_stats and (now - old_v.get("ts", 0)) < 15.0:
                frozen = dict(old_v)
                frozen["tx_speed"] = 0.0
                frozen["rx_speed"] = 0.0
                frozen["total_speed"] = 0.0
                new_stats[old_k] = frozen

        SOCKET_TRAFFIC_STATS = new_stats
        return SOCKET_TRAFFIC_STATS

def get_socket_traffic(loc_ip, loc_port, rem_ip, rem_port):
    """Obtiene de forma segura la telemetría de tráfico para un socket o flujo."""
    with SOCKET_TRAFFIC_LOCK:
        res = SOCKET_TRAFFIC_STATS.get((loc_ip, int(loc_port or 0), rem_ip, int(rem_port or 0)))
        if res:
            return res
        res = SOCKET_TRAFFIC_STATS.get((rem_ip, int(rem_port or 0), loc_ip, int(loc_port or 0)))
        if res:
            return res
        res = SOCKET_TRAFFIC_STATS.get((rem_ip, int(rem_port or 0)))
        if res:
            return res
        res = SOCKET_TRAFFIC_STATS.get((rem_ip, int(loc_port or 0)))
        if res:
            return res
    return {
        "bytes_sent": 0,
        "bytes_received": 0,
        "bytes_total": 0,
        "tx_speed": 0.0,
        "rx_speed": 0.0,
        "total_speed": 0.0
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
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}" if TELEGRAM_BOT_TOKEN else ""
TELEGRAM_FILE_URL = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}" if TELEGRAM_BOT_TOKEN else ""

QBIT_API_URL = os.environ.get("QBIT_API_URL", "http://127.0.0.1:8082/api/v2").strip()
def _resolve_default_qbit_save_path():
    env_p = os.environ.get("QBIT_SAVE_PATH", "").strip()
    if env_p:
        return env_p
    rel_dl = os.path.join(BASE_DIR, "downloads")
    if os.path.exists("/mnt/almacenamiento/descargas"):
        return "/mnt/almacenamiento/descargas"
    return rel_dl

QBIT_SAVE_PATH = _resolve_default_qbit_save_path()

def _resolve_tg_data_file(filename, fallback_dir=None):
    """Resuelve rutas de persistencia buscando primero en env/relativa al proyecto y luego en fallback existente."""
    env_dir = os.environ.get("RECURSOS_DATA_DIR", "").strip() or os.environ.get("RECURSOS_SCRIPTS_DIR", "").strip()
    candidates = []
    if env_dir:
        candidates.append(os.path.join(env_dir, filename))
    candidates.extend([
        os.path.join(BASE_DIR, filename),
        os.path.join(BASE_DIR, "scripts", filename),
    ])
    if fallback_dir and os.path.isdir(fallback_dir):
        candidates.append(os.path.join(fallback_dir, filename))
    elif os.path.isdir("/home/servidor/scripts"):
        candidates.append(os.path.join("/home/servidor/scripts", filename))
    for cand in candidates:
        if os.path.exists(cand):
            return cand
    return candidates[0]

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
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    entry = {
        "id": f"tg-{int(time.time()*1000)}-{os.urandom(3).hex()}",
        "ts": time.time(),
        "time_str": now_str,
        "timestamp": now_str,
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
    "running": False,
    "online": False,
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
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_API_URL:
        if log_activity:
            record_tg_activity(
                direction="out",
                msg_type=log_type,
                target=str(chat_id),
                user_name=f"Chat {chat_id}",
                title=log_title or "Mensaje omitido (Bot sin token)",
                content=text,
                status="error",
                details={"error": "TELEGRAM_BOT_TOKEN no configurado en el entorno"}
            )
        return False

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
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_API_URL:
        with TELEGRAM_BOT_LOCK:
            TELEGRAM_BOT_CACHE["enabled"] = False
            TELEGRAM_BOT_CACHE["running"] = False
            TELEGRAM_BOT_CACHE["online"] = False
            TELEGRAM_BOT_CACHE["polling_active"] = False
            TELEGRAM_BOT_CACHE["last_action"] = "En espera (TELEGRAM_BOT_TOKEN no configurado)"
        return
    print("[TG BOT] Long-polling de Telegram integrado iniciado.")
    offset = 0
    with TELEGRAM_BOT_LOCK:
        TELEGRAM_BOT_CACHE["running"] = True
        TELEGRAM_BOT_CACHE["polling_active"] = True
        TELEGRAM_BOT_CACHE["online"] = True
        TELEGRAM_BOT_CACHE["last_action"] = "Sondeando api.telegram.org..."

    while True:
        try:
            with TELEGRAM_BOT_LOCK:
                TELEGRAM_BOT_CACHE["running"] = True
                TELEGRAM_BOT_CACHE["polling_active"] = True
                TELEGRAM_BOT_CACHE["online"] = True
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
                    sync_candidates = [
                        os.path.join(BASE_DIR, "sync_pihole_devices.py"),
                        os.path.join(BASE_DIR, "scripts", "sync_pihole_devices.py"),
                    ]
                    env_scripts = os.environ.get("RECURSOS_SCRIPTS_DIR", "").strip()
                    if env_scripts:
                        sync_candidates.insert(0, os.path.join(env_scripts, "sync_pihole_devices.py"))
                    if os.path.isdir("/home/servidor/scripts"):
                        sync_candidates.append("/home/servidor/scripts/sync_pihole_devices.py")
                    sync_script = next((p for p in sync_candidates if os.path.isfile(p)), None)
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
SYSTEM_LOGS_ACK_FILE = os.path.join(BASE_DIR, ".system_logs_ack.json")

def load_system_logs_ack_state():
    """Lee la marca temporal persistente de última revisión de avisos del sistema."""
    try:
        if os.path.isfile(SYSTEM_LOGS_ACK_FILE):
            with open(SYSTEM_LOGS_ACK_FILE, "r", encoding="utf-8") as af:
                data = json.load(af)
                if isinstance(data, dict):
                    return {
                        "ack_ts": float(data.get("ack_ts") or 0.0),
                        "ack_time_str": str(data.get("ack_time_str") or "") or None,
                    }
    except Exception:
        pass
    return {"ack_ts": 0.0, "ack_time_str": None}

def save_system_logs_ack_state(ack_ts=None):
    """Guarda (o reinicia con 0.0) la marca temporal de avisos revisados."""
    ts_val = time.time() if ack_ts is None else float(ack_ts or 0.0)
    time_str = datetime.fromtimestamp(ts_val).strftime("%d/%m %H:%M:%S") if ts_val > 0 else None
    payload = {"ack_ts": ts_val, "ack_time_str": time_str}
    with SYSTEM_LOGS_LOCK:
        try:
            with open(SYSTEM_LOGS_ACK_FILE, "w", encoding="utf-8") as af:
                json.dump(payload, af, ensure_ascii=False)
        except Exception as e:
            print(f"[-] Error guardando {SYSTEM_LOGS_ACK_FILE}: {e}")
        # Invalidar caché de logs para reflejar el nuevo corte temporal de inmediato
        for k in SYSTEM_LOGS_CACHE:
            SYSTEM_LOGS_CACHE[k]["ts"] = 0.0
    return payload

_RE_FAULT_HEX = re.compile(r'0x[0-9a-fA-F]+')
_RE_FAULT_BRACKET_NUM = re.compile(r'\[\s*\d+\s*\]')
_RE_FAULT_IPV4 = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b')
_RE_FAULT_NUM = re.compile(r'\b\d+\b')
_RE_FAULT_WS = re.compile(r'\s+')

def _normalize_system_fault_signature(unit_str, category_str, message_str):
    """Genera una firma canónica invariante ante PIDs, fechas o direcciones de memoria para no re-consultar fallos recurrentes."""
    u = str(unit_str or "system").strip().lower()
    if "@" in u and u.endswith(".service"):
        u = u.split("@", 1)[0] + "@.service"
    c = str(category_str or "system").strip().lower()
    m = str(message_str or "").strip().lower()
    m = _RE_FAULT_HEX.sub("0x#", m)
    m = _RE_FAULT_BRACKET_NUM.sub("[#]", m)
    m = _RE_FAULT_IPV4.sub("#.#.#.#", m)
    m = _RE_FAULT_NUM.sub("#", m)
    m = _RE_FAULT_WS.sub(" ", m).strip()[:130]
    return f"{u}|{c}|{m}"

def _lookup_stored_fault_insights(signatures=None, lang="es", history_limit=50):
    """Consulta en recursos_history.db los diagnósticos IA ya almacenados para fallos recurrentes."""
    lang_clean = (str(lang or "es").strip().lower()[:8]) or "es"
    by_sig = {}
    recent_list = []
    if not os.path.exists(RECURSOS_HISTORY_DB_FILE):
        return by_sig, recent_list
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=6.0)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT lang, signature, unit, category, title, danger_level,
                       summary, solution, confidence, model, occurrence_count,
                       first_seen_at, analyzed_at
                FROM ai_system_fault_insights
                WHERE lang = ?
                ORDER BY analyzed_at DESC
                LIMIT ?
                """,
                (lang_clean, max(20, int(history_limit)))
            ).fetchall()
            for r in rows:
                item = {
                    "signature": r["signature"],
                    "unit": r["unit"] or "",
                    "category": r["category"] or "system",
                    "title": r["title"] or "",
                    "danger_level": r["danger_level"] or "medium",
                    "summary": r["summary"] or "",
                    "solution": r["solution"] or "",
                    "confidence": r["confidence"] or "medium",
                    "model": r["model"] or AI_NET_MODEL,
                    "occurrence_count": int(r["occurrence_count"] or 1),
                    "first_seen_at": float(r["first_seen_at"] or r["analyzed_at"] or 0),
                    "analyzed_at": float(r["analyzed_at"] or 0),
                    "cached_from_db": True,
                }
                by_sig[r["signature"]] = item
                recent_list.append(item)

            if signatures:
                missing = [s for s in signatures if s and s not in by_sig]
                if missing:
                    placeholders = ",".join("?" for _ in missing)
                    extra_rows = conn.execute(
                        f"""
                        SELECT lang, signature, unit, category, title, danger_level,
                               summary, solution, confidence, model, occurrence_count,
                               first_seen_at, analyzed_at
                        FROM ai_system_fault_insights
                        WHERE lang = ? AND signature IN ({placeholders})
                        """,
                        [lang_clean] + missing
                    ).fetchall()
                    for r in extra_rows:
                        item = {
                            "signature": r["signature"],
                            "unit": r["unit"] or "",
                            "category": r["category"] or "system",
                            "title": r["title"] or "",
                            "danger_level": r["danger_level"] or "medium",
                            "summary": r["summary"] or "",
                            "solution": r["solution"] or "",
                            "confidence": r["confidence"] or "medium",
                            "model": r["model"] or AI_NET_MODEL,
                            "occurrence_count": int(r["occurrence_count"] or 1),
                            "first_seen_at": float(r["first_seen_at"] or r["analyzed_at"] or 0),
                            "analyzed_at": float(r["analyzed_at"] or 0),
                            "cached_from_db": True,
                        }
                        by_sig[r["signature"]] = item
        except Exception:
            pass
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    return by_sig, recent_list

def _apply_system_logs_ack_and_totals(raw_payload, lang="es"):
    if not isinstance(raw_payload, dict):
        return raw_payload
    ack_state = load_system_logs_ack_state()
    ack_ts = float(ack_state.get("ack_ts") or 0.0)
    ack_ts_ms = int(ack_ts * 1000) if ack_ts > 0 else 0

    raw_logs = list(raw_payload.get("logs") or [])
    if ack_ts_ms > 0:
        filtered_logs = [dict(e) for e in raw_logs if int((e or {}).get("ts") or 0) > ack_ts_ms]
    else:
        filtered_logs = [dict(e) for e in raw_logs]

    counts = {"docker": 0, "service": 0, "kernel": 0, "system": 0, "total": 0}
    active_sigs = []
    for entry in filtered_logs:
        cat = str((entry or {}).get("category") or "system")
        if cat not in counts:
            cat = "system"
        counts[cat] += 1
        counts["total"] += 1
        sig = entry.get("signature") or _normalize_system_fault_signature(
            entry.get("unit") or entry.get("source"), cat, entry.get("message")
        )
        entry["signature"] = sig
        active_sigs.append(sig)

    failed_units = [dict(u) if isinstance(u, dict) else {"unit": str(u), "description": str(u)} for u in (raw_payload.get("failed_units") or [])]
    for u in failed_units:
        sig = u.get("signature") or _normalize_system_fault_signature(
            u.get("unit"), "service", f"systemd unit failed: {u.get('description') or u.get('unit')} ({u.get('sub') or 'failed'})"
        )
        u["signature"] = sig
        active_sigs.append(sig)

    stored_by_sig, stored_history = _lookup_stored_fault_insights(active_sigs, lang=lang, history_limit=50)
    for entry in filtered_logs:
        sig = entry.get("signature")
        if sig and sig in stored_by_sig:
            entry["ai_insight"] = stored_by_sig[sig]
    for u in failed_units:
        sig = u.get("signature")
        if sig and sig in stored_by_sig:
            u["ai_insight"] = stored_by_sig[sig]

    failed_count = len(failed_units)
    effective_total = len(filtered_logs) + failed_count

    out = dict(raw_payload)
    out["logs"] = filtered_logs
    out["entries"] = filtered_logs
    out["log_errors_count"] = len(filtered_logs)
    out["total_errors"] = effective_total
    out["failed_units_count"] = failed_count
    out["failed_units"] = failed_units
    out["counts_by_category"] = counts
    out["ack_ts"] = ack_ts if ack_ts > 0 else None
    out["ack_time_str"] = ack_state.get("ack_time_str") if ack_ts > 0 else None
    out["ai_fault_insights"] = stored_by_sig
    out["ai_fault_history"] = stored_history
    return out

def fetch_effective_system_logs(priority_max=3, limit=80, force=False, lang="es"):
    raw_payload = fetch_system_logs(priority_max=priority_max, limit=limit, force=force)
    return _apply_system_logs_ack_and_totals(raw_payload, lang=lang)

def get_effective_system_errors_summary():
    data = fetch_effective_system_logs(priority_max=3, limit=50)
    return {
        "total": int(data.get("total_errors", 0)),
        "total_errors": int(data.get("total_errors", 0)),
        "log_errors_count": int(data.get("log_errors_count", 0)),
        "failed_units_count": int(data.get("failed_units_count", 0)),
        "failed_units": list(data.get("failed_units") or [])[:8],
        "ack_ts": data.get("ack_ts"),
        "ack_time_str": data.get("ack_time_str"),
        "counts_by_category": data.get("counts_by_category", {}),
        "fetched_at": data.get("fetched_at", ""),
        "ai_fault_insights": data.get("ai_fault_insights", {}),
        "ai_fault_history": list(data.get("ai_fault_history") or [])[:25],
    }

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
        if not force and cached.get("data") and (now - cached.get("ts", 0) < 18.0):
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
                u_name = parts[0]
                u_sub = parts[3] if len(parts) > 3 else "failed"
                u_desc = parts[4] if len(parts) > 4 else u_name
                failed_units.append({
                    "unit": u_name,
                    "load": parts[1] if len(parts) > 1 else "loaded",
                    "active": parts[2] if len(parts) > 2 else "failed",
                    "sub": u_sub,
                    "description": u_desc,
                    "signature": _normalize_system_fault_signature(
                        u_name, "service", f"systemd unit failed: {u_desc} ({u_sub})"
                    ),
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
                    "message": msg_str,
                    "signature": _normalize_system_fault_signature(unit_name, category, msg_str),
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
        "total_errors": total,
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
_SS_NEEDS_SUDO = False
_CONNTRACK_NEEDS_SUDO = False
_LAST_SQLITE_PRUNE_TS = 0.0

RE_SS_PORT = re.compile(r':(\d+)\s+')
RE_SS_PROC = re.compile(r'users:\(\(\"([^\"]+)\",pid=(\d+)')
RE_PIHOLE_LOG_REPLY = re.compile(
    r"(?:reply|cached|cached-stale)\s+([a-zA-Z0-9\.\-_]+)\s+is\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})"
)
RE_CONNTRACK_FLOW = re.compile(r"src=([^\s]+)\s+dst=([^\s]+)\s+sport=(\d+)\s+dport=(\d+)")

def _parse_ss_listening_output(stdout_text):
    parsed = {}
    has_proc_info = False
    for line in stdout_text.splitlines():
        m_port = RE_SS_PORT.search(line)
        m_proc = RE_SS_PROC.search(line)
        if m_port and m_proc:
            has_proc_info = True
            port = int(m_port.group(1))
            proc = m_proc.group(1)
            pid = int(m_proc.group(2))
            parsed[port] = {"proc": proc, "pid": pid}
    return parsed, has_proc_info

_DOCKER_PORT_RE = re.compile(r":(\d+)->\d+/(?:tcp|udp)")

def _extract_proc_service_hint(pid, raw_proc=""):
    """Extrae de forma 100% dinámica la unidad systemd, contenedor o ejecutable real desde /proc/<pid>."""
    hint = str(raw_proc or "").strip()
    if not pid:
        return hint
    try:
        cg_path = f"/proc/{int(pid)}/cgroup"
        if os.path.isfile(cg_path):
            with open(cg_path, "r", encoding="utf-8", errors="ignore") as f:
                cg_txt = f.read()
            m_unit = re.search(r"/system\.slice/([^\s/]+\.service)", cg_txt)
            if m_unit:
                unit_base = m_unit.group(1).replace(".service", "")
                if unit_base and unit_base not in ("docker", "containerd"):
                    return unit_base
    except Exception:
        pass
    try:
        cmd_path = f"/proc/{int(pid)}/cmdline"
        if os.path.isfile(cmd_path):
            with open(cmd_path, "rb") as f:
                parts = [p.decode("utf-8", errors="ignore") for p in f.read().split(b"\x00") if p]
            if parts:
                exe_base = os.path.basename(parts[0]).strip()
                if exe_base in ("python", "python3", "node", "nodejs", "java", "dotnet") and len(parts) > 1:
                    arg_base = os.path.basename(parts[1]).strip()
                    if arg_base:
                        return f"{exe_base} ({arg_base})"
                if exe_base and not hint:
                    return exe_base
    except Exception:
        pass
    return hint

def update_listening_ports_map(force=False):
    global LISTENING_PORTS_MAP, LAST_LISTENING_SCAN, _SS_NEEDS_SUDO
    now = time.time()
    if not force and (now - LAST_LISTENING_SCAN < 20.0) and LISTENING_PORTS_MAP:
        return LISTENING_PORTS_MAP
    LAST_LISTENING_SCAN = now
    new_map = {}
    try:
        if not _SS_NEEDS_SUDO:
            p = subprocess.run(['ss', '-tulpn', '-H'], capture_output=True, text=True, timeout=2.0)
            if p.returncode == 0:
                new_map, has_proc = _parse_ss_listening_output(p.stdout)
                if p.stdout.strip() and not has_proc:
                    p_sudo = subprocess.run(['sudo', '-n', 'ss', '-tulpn', '-H'], capture_output=True, text=True, timeout=2.0)
                    if p_sudo.returncode == 0:
                        sudo_map, sudo_has_proc = _parse_ss_listening_output(p_sudo.stdout)
                        if sudo_has_proc:
                            _SS_NEEDS_SUDO = True
                            new_map = sudo_map
            else:
                p_sudo = subprocess.run(['sudo', '-n', 'ss', '-tulpn', '-H'], capture_output=True, text=True, timeout=2.0)
                if p_sudo.returncode == 0:
                    _SS_NEEDS_SUDO = True
                    new_map, _ = _parse_ss_listening_output(p_sudo.stdout)
        else:
            p_sudo = subprocess.run(['sudo', '-n', 'ss', '-tulpn', '-H'], capture_output=True, text=True, timeout=2.0)
            if p_sudo.returncode == 0:
                new_map, _ = _parse_ss_listening_output(p_sudo.stdout)
    except Exception:
        pass

    # Enriquecer dinámicamente con cgroup/cmdline real para procesos genéricos
    for port_k, info in list(new_map.items()):
        pid = info.get("pid")
        raw_proc = info.get("proc", "")
        refined = _extract_proc_service_hint(pid, raw_proc)
        if refined:
            info["service_hint"] = refined

    # Correlación dinámica de puertos publicados por contenedores Docker reales en ejecución
    try:
        dp = subprocess.run(
            ['docker', 'ps', '--format', '{{.Names}}\t{{.Ports}}'],
            capture_output=True, text=True, timeout=2.0
        )
        if dp.returncode == 0 and dp.stdout:
            for dline in dp.stdout.splitlines():
                if "\t" not in dline:
                    continue
                cname, cports = dline.split("\t", 1)
                cname = cname.strip()
                if not cname:
                    continue
                for m_p in _DOCKER_PORT_RE.finditer(cports):
                    host_port = int(m_p.group(1))
                    cur = new_map.get(host_port, {})
                    cur_proc = str(cur.get("proc") or "")
                    if not cur or "docker" in cur_proc.lower() or not cur_proc:
                        new_map[host_port] = {
                            "proc": cname,
                            "pid": cur.get("pid"),
                            "service_hint": f"Docker · {cname}",
                            "container": cname,
                        }
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

def _resolve_recursos_history_db_path():
    """Resuelve la ruta persistente de recursos_history.db sin sobrescribir ni depender de rutas fijas."""
    env_path = os.environ.get("RECURSOS_HISTORY_DB_PATH", "").strip()
    if env_path:
        return env_path
    base_db = os.path.join(BASE_DIR, "recursos_history.db")
    legacy_db = os.path.join(BASE_DIR, "geoip_history.db")
    if os.path.exists(base_db) or os.path.exists(legacy_db) or os.access(BASE_DIR, os.W_OK):
        return base_db
    var_lib_dir = "/var/lib/recursos-cockpit"
    try:
        os.makedirs(var_lib_dir, exist_ok=True)
    except Exception:
        pass
    return os.path.join(var_lib_dir, "recursos_history.db")

RECURSOS_HISTORY_DB_FILE = _resolve_recursos_history_db_path()
_LEGACY_GEOIP_HISTORY_DB_FILE = os.path.join(os.path.dirname(RECURSOS_HISTORY_DB_FILE), "geoip_history.db")
GEOIP_HISTORY_DB_FILE = RECURSOS_HISTORY_DB_FILE
GEOIP_HISTORY_DB_LOCK = threading.Lock()
_TELEMETRY_SQLITE_BUFFER = []
_LAST_TELEMETRY_FLUSH_TS = 0.0
_LAST_TELEMETRY_PRUNE_TS = 0.0
_TELEMETRY_HISTORY_INITIALIZED = False

def _migrate_legacy_geoip_db_if_needed():
    """Migra de forma segura geoip_history.db → recursos_history.db sin perder el historial DNS/GeoIP previo."""
    if os.path.exists(RECURSOS_HISTORY_DB_FILE) or not os.path.exists(_LEGACY_GEOIP_HISTORY_DB_FILE):
        return
    try:
        for suffix in ("", "-wal", "-shm"):
            src = _LEGACY_GEOIP_HISTORY_DB_FILE + suffix
            dst = RECURSOS_HISTORY_DB_FILE + suffix
            if os.path.exists(src) and not os.path.exists(dst):
                os.replace(src, dst)
        print("[+] Base de datos migrada de geoip_history.db a recursos_history.db")
    except Exception as e:
        src_conn = None
        dst_conn = None
        try:
            src_conn = sqlite3.connect(_LEGACY_GEOIP_HISTORY_DB_FILE, timeout=10.0)
            dst_conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            src_conn.backup(dst_conn)
            print(f"[+] Copia de seguridad migrada de geoip_history.db a recursos_history.db ({e})")
        except Exception as e2:
            print(f"[-] Aviso migrando geoip_history.db -> recursos_history.db: {e2}")
        finally:
            if dst_conn is not None:
                try:
                    dst_conn.close()
                except Exception:
                    pass
            if src_conn is not None:
                try:
                    src_conn.close()
                except Exception:
                    pass

def init_geoip_history_db():
    """Inicializa de forma incremental la base de datos SQLite unificada (recursos_history.db) sin sobrescribir datos existentes."""
    global _TELEMETRY_HISTORY_INITIALIZED
    if _TELEMETRY_HISTORY_INITIALIZED and os.path.isfile(RECURSOS_HISTORY_DB_FILE):
        return
    with GEOIP_HISTORY_DB_LOCK:
        if _TELEMETRY_HISTORY_INITIALIZED and os.path.isfile(RECURSOS_HISTORY_DB_FILE):
            return
        conn = None
        try:
            parent_dir = os.path.dirname(RECURSOS_HISTORY_DB_FILE)
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
            _migrate_legacy_geoip_db_if_needed()
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
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
            conn.execute("CREATE INDEX IF NOT EXISTS idx_geoip_updated_at ON geoip_locations(updated_at DESC);")
            # Poda preventiva segura al arranque para mantener geoip_locations acotado (<=12,000 IPs, <=7d)
            try:
                ttl_sec = globals().get("GEOIP_TTL_SECONDS", 7 * 86400)
                cutoff_geo = time.time() - ttl_sec
                c_exp = conn.execute("DELETE FROM geoip_locations WHERE updated_at < ?", (cutoff_geo,)).rowcount or 0
                tot_geo = conn.execute("SELECT COUNT(*) FROM geoip_locations").fetchone()[0]
                c_cap = 0
                if tot_geo > 12000:
                    c_cap = conn.execute("""
                        DELETE FROM geoip_locations
                        WHERE ip NOT IN (
                            SELECT ip FROM geoip_locations ORDER BY updated_at DESC LIMIT 12000
                        )
                    """).rowcount or 0
                if (c_exp + c_cap) > 2000:
                    conn.commit()
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            except Exception:
                pass
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
            conn.execute("""
                CREATE TABLE IF NOT EXISTS telemetry_history (
                    ts REAL PRIMARY KEY,
                    time_str TEXT NOT NULL,
                    cpu REAL DEFAULT 0,
                    cpu_temp REAL DEFAULT 0,
                    cpu_freq REAL DEFAULT 0,
                    cpu_power REAL DEFAULT 0,
                    cpu_load_1m REAL DEFAULT 0,
                    cpu_load_5m REAL DEFAULT 0,
                    cpu_user REAL DEFAULT 0,
                    cpu_system REAL DEFAULT 0,
                    cpu_iowait REAL DEFAULT 0,
                    gpu REAL DEFAULT 0,
                    gpu_vram_pct REAL DEFAULT 0,
                    gpu_mem_ctrl REAL DEFAULT 0,
                    gpu_enc REAL DEFAULT 0,
                    gpu_dec REAL DEFAULT 0,
                    gpu_power REAL DEFAULT 0,
                    gpu_temp REAL DEFAULT 0,
                    gpu_clk_gfx REAL DEFAULT 0,
                    gpu_clk_mem REAL DEFAULT 0,
                    gpu_pcie_rx REAL DEFAULT 0,
                    gpu_pcie_tx REAL DEFAULT 0,
                    ram REAL DEFAULT 0,
                    ram_total REAL DEFAULT 0,
                    net_rx REAL DEFAULT 0,
                    net_tx REAL DEFAULT 0,
                    net_wan_rx REAL DEFAULT 0,
                    net_wan_tx REAL DEFAULT 0,
                    net_lan_rx REAL DEFAULT 0,
                    net_lan_tx REAL DEFAULT 0,
                    disk_r REAL DEFAULT 0,
                    disk_w REAL DEFAULT 0,
                    disk_pct REAL DEFAULT 0
                )
            """)
            existing_cols = {
                row[1] for row in conn.execute("PRAGMA table_info(telemetry_history)").fetchall()
            }
            for col_name in ("net_wan_rx", "net_wan_tx", "net_lan_rx", "net_lan_tx", *_EXTENDED_TELEMETRY_COLS):
                if col_name not in existing_cols:
                    conn.execute(f"ALTER TABLE telemetry_history ADD COLUMN {col_name} REAL DEFAULT 0;")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_history_ts ON telemetry_history(ts DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ping_history (
                    ts REAL NOT NULL,
                    target_id TEXT NOT NULL,
                    target_ip TEXT NOT NULL,
                    label TEXT DEFAULT '',
                    kind TEXT DEFAULT 'external',
                    rtt_ms REAL DEFAULT -1,
                    loss_pct REAL DEFAULT 0,
                    PRIMARY KEY (ts, target_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ping_history_ts ON ping_history(ts DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS process_history (
                    ts REAL NOT NULL,
                    proc_name TEXT NOT NULL,
                    cpu_pct REAL DEFAULT 0,
                    ram_mb REAL DEFAULT 0,
                    vram_mb REAL DEFAULT 0,
                    io_bps REAL DEFAULT 0,
                    PRIMARY KEY (ts, proc_name)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_process_history_ts ON process_history(ts DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ai_connection_insights (
                    lang TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    category TEXT DEFAULT '',
                    role TEXT DEFAULT '',
                    summary TEXT DEFAULT '',
                    confidence TEXT DEFAULT 'medium',
                    model TEXT DEFAULT '',
                    analyzed_at REAL NOT NULL,
                    PRIMARY KEY (lang, signature)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_conn_analyzed_at ON ai_connection_insights(analyzed_at DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ai_system_fault_insights (
                    lang TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    unit TEXT DEFAULT '',
                    category TEXT DEFAULT '',
                    title TEXT NOT NULL,
                    danger_level TEXT DEFAULT 'medium',
                    summary TEXT DEFAULT '',
                    solution TEXT DEFAULT '',
                    confidence TEXT DEFAULT 'medium',
                    model TEXT DEFAULT '',
                    occurrence_count INTEGER DEFAULT 1,
                    first_seen_at REAL NOT NULL,
                    analyzed_at REAL NOT NULL,
                    PRIMARY KEY (lang, signature)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_fault_analyzed_at ON ai_system_fault_insights(analyzed_at DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS speedtest_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    created_at TEXT NOT NULL,
                    download_mbps REAL NOT NULL,
                    upload_mbps REAL NOT NULL,
                    ping_ms REAL DEFAULT 0,
                    jitter_ms REAL DEFAULT 0,
                    packet_loss_pct REAL DEFAULT 0,
                    server_name TEXT DEFAULT '',
                    server_host TEXT DEFAULT '',
                    server_location TEXT DEFAULT '',
                    client_ip TEXT DEFAULT '',
                    isp TEXT DEFAULT '',
                    duration_ms INTEGER DEFAULT 0,
                    scope TEXT DEFAULT 'wan'
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_speedtest_history_ts ON speedtest_history(ts DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS device_series_history (
                    ts REAL NOT NULL,
                    entity_kind TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    val1 REAL DEFAULT 0,
                    val2 REAL DEFAULT 0,
                    val3 REAL DEFAULT 0,
                    val4 REAL DEFAULT 0,
                    PRIMARY KEY (entity_kind, entity_id, ts)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_dev_series_lookup ON device_series_history(entity_kind, entity_id, ts DESC);")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS service_console_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    time_str TEXT NOT NULL,
                    level TEXT NOT NULL DEFAULT 'INFO',
                    source TEXT NOT NULL DEFAULT 'server',
                    command TEXT DEFAULT '',
                    message TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_service_console_logs_ts ON service_console_logs(ts DESC);")
            conn.commit()
            _TELEMETRY_HISTORY_INITIALIZED = True
        except Exception as e:
            print(f"[-] Error inicializando SQLite recursos_history.db: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


SERVICE_CONSOLE_RETENTION_SECONDS = 86400  # 24 horas máximo en recursos_history.db
_SERVICE_CONSOLE_LOCK = threading.Lock()
_SERVICE_CONSOLE_LAST_PRUNE_TS = 0.0
_SERVICE_CONSOLE_WRITE_COUNT = 0
_SERVICE_CONSOLE_IN_PROGRESS = threading.local()
_SERVICE_CONSOLE_TEE_INSTALLED = False

_CONSOLE_SECRET_PATTERNS = (
    (re.compile(r'(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;\]"\']+'), r'\1[REDACTED]'),
    (re.compile(r'(?i)(bearer\s+)[A-Za-z0-9._\-~+/=]{12,}'), r'\1[REDACTED]'),
    (re.compile(r'(?i)((?:x-device-token|x-session-token|device_token|session_token|access_token|refresh_token|api[_-]?key|password|passwd|secret|signature|hmac|cookie)\s*[:=]\s*)[^\s&,;\]"\']+'), r'\1[REDACTED]'),
    (re.compile(r'(?i)([?&](?:token|sig|signature|key|api_key|password|secret)=)[^&\s"\']+'), r'\1[REDACTED]'),
)


def redact_service_console_secrets(text):
    """Enmascara tokens, cabeceras Bearer, contraseñas y firmas antes de persistir o mostrar logs."""
    out = str(text or "")
    for rx, repl in _CONSOLE_SECRET_PATTERNS:
        out = rx.sub(repl, out)
    return out


def _infer_console_level(message, default_level="INFO"):
    low = str(message or "").lower()
    if any(k in low for k in ("traceback", "error", "exception", "critical", "fatal", "[-]", "failed")):
        return "ERROR"
    if any(k in low for k in ("warn", "warning", "[!]", "timeout", "denegado", "403", "500")):
        return "WARN"
    if any(k in low for k in ("[ota]", "github", "themes_catalog", "i18n", "dictionary.csv", "sync")):
        return "OTA"
    if any(k in low for k in ("exec", "cmd:", "subprocess", "systemctl", "docker ", "dpkg", "git ")):
        return "CMD"
    return default_level


def record_service_console_log(message, level="INFO", source="server", command=""):
    """Persiste un evento de ejecución del servicio en recursos_history.db con retención estricta de 24h."""
    global _SERVICE_CONSOLE_LAST_PRUNE_TS, _SERVICE_CONSOLE_WRITE_COUNT
    if getattr(_SERVICE_CONSOLE_IN_PROGRESS, "active", False):
        return
    clean_msg = redact_service_console_secrets(str(message or "").replace("\r", "").strip())
    if not clean_msg:
        return
    clean_msg = clean_msg[:1800]
    clean_cmd = redact_service_console_secrets(str(command or "").strip())[:400]
    clean_level = str(level or "INFO").upper()[:12]
    if clean_level not in ("INFO", "CMD", "HTTP", "OTA", "WARN", "ERROR"):
        clean_level = "INFO"
    clean_src = re.sub(r"[^a-zA-Z0-9._-]", "", str(source or "server"))[:32] or "server"

    now_ts = time.time()
    time_str = datetime.fromtimestamp(now_ts).strftime("%Y-%m-%d %H:%M:%S")
    cutoff_ts = now_ts - SERVICE_CONSOLE_RETENTION_SECONDS

    _SERVICE_CONSOLE_IN_PROGRESS.active = True
    try:
        init_geoip_history_db()
        with _SERVICE_CONSOLE_LOCK:
            conn = None
            try:
                conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=5.0)
                conn.execute(
                    "INSERT INTO service_console_logs (ts, time_str, level, source, command, message) VALUES (?, ?, ?, ?, ?, ?)",
                    (now_ts, time_str, clean_level, clean_src, clean_cmd, clean_msg),
                )
                _SERVICE_CONSOLE_WRITE_COUNT += 1
                if (_SERVICE_CONSOLE_WRITE_COUNT % 40 == 0) or (now_ts - _SERVICE_CONSOLE_LAST_PRUNE_TS >= 60.0):
                    conn.execute("DELETE FROM service_console_logs WHERE ts < ?", (cutoff_ts,))
                    _SERVICE_CONSOLE_LAST_PRUNE_TS = now_ts
                conn.commit()
            except Exception:
                pass
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass
    finally:
        _SERVICE_CONSOLE_IN_PROGRESS.active = False


def prune_service_console_logs(now_ts=None):
    """Elimina cualquier registro de consola con más de 24 horas de antigüedad."""
    ts_ref = float(now_ts if now_ts is not None else time.time())
    cutoff_ts = ts_ref - SERVICE_CONSOLE_RETENTION_SECONDS
    init_geoip_history_db()
    with _SERVICE_CONSOLE_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=5.0)
            cur = conn.execute("DELETE FROM service_console_logs WHERE ts < ?", (cutoff_ts,))
            deleted = cur.rowcount if cur.rowcount is not None else 0
            conn.commit()
            return deleted
        except Exception:
            return 0
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def query_service_console_logs(after_id=0, window="24h", level="", q="", limit=350):
    """Consulta los logs de consola en modo solo lectura aplicando la ventana máxima de 24h."""
    init_geoip_history_db()
    now_ts = time.time()
    max_cutoff_ts = now_ts - SERVICE_CONSOLE_RETENTION_SECONDS
    win_map = {
        "live": 1800,
        "1h": 3600,
        "6h": 21600,
        "24h": SERVICE_CONSOLE_RETENTION_SECONDS,
    }
    win_key = str(window or "24h").strip().lower()
    win_sec = min(SERVICE_CONSOLE_RETENTION_SECONDS, win_map.get(win_key, SERVICE_CONSOLE_RETENTION_SECONDS))
    cutoff_ts = max(max_cutoff_ts, now_ts - win_sec)

    try:
        after_int = max(0, int(after_id or 0))
    except (TypeError, ValueError):
        after_int = 0
    try:
        limit_int = max(20, min(600, int(limit or 350)))
    except (TypeError, ValueError):
        limit_int = 350

    level_up = str(level or "").strip().upper()
    search_q = str(q or "").strip()

    with _SERVICE_CONSOLE_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=5.0)
            conn.row_factory = sqlite3.Row
            conn.execute("DELETE FROM service_console_logs WHERE ts < ?", (max_cutoff_ts,))
            conn.commit()

            where_clauses = ["ts >= ?"]
            params = [cutoff_ts]
            if after_int > 0:
                where_clauses.append("id > ?")
                params.append(after_int)
            if level_up and level_up != "ALL":
                where_clauses.append("level = ?")
                params.append(level_up)
            if search_q:
                where_clauses.append("(message LIKE ? OR source LIKE ? OR command LIKE ?)")
                like_val = f"%{search_q}%"
                params.extend([like_val, like_val, like_val])

            where_sql = " AND ".join(where_clauses)
            if after_int > 0:
                rows = conn.execute(
                    f"SELECT id, ts, time_str, level, source, command, message FROM service_console_logs WHERE {where_sql} ORDER BY id ASC LIMIT ?",
                    params + [limit_int],
                ).fetchall()
            else:
                rows = conn.execute(
                    f"SELECT id, ts, time_str, level, source, command, message FROM service_console_logs WHERE {where_sql} ORDER BY id DESC LIMIT ?",
                    params + [limit_int],
                ).fetchall()
                rows = list(reversed(rows))

            total_row = conn.execute(
                "SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS max_id FROM service_console_logs WHERE ts >= ?",
                (max_cutoff_ts,),
            ).fetchone()
            total_24h = int(total_row["cnt"] or 0) if total_row else 0
            max_id = int(total_row["max_id"] or 0) if total_row else 0

            entries = [
                {
                    "id": int(r["id"]),
                    "ts": float(r["ts"]),
                    "time_str": str(r["time_str"] or ""),
                    "level": str(r["level"] or "INFO"),
                    "source": str(r["source"] or "server"),
                    "command": str(r["command"] or ""),
                    "message": str(r["message"] or ""),
                }
                for r in rows
            ]
            return {
                "ok": True,
                "read_only": True,
                "retention_hours": 24,
                "window": win_key if win_key in win_map else "24h",
                "last_id": max(max_id, entries[-1]["id"] if entries else after_int),
                "total_24h": total_24h,
                "entries": entries,
            }
        except Exception as exc:
            return {
                "ok": False,
                "read_only": True,
                "retention_hours": 24,
                "window": win_key,
                "last_id": after_int,
                "total_24h": 0,
                "entries": [],
                "error": str(exc),
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


class _ServiceConsoleStreamTee:
    """Captura stdout/stderr del servicio en tiempo real sin alterar la salida original."""

    def __init__(self, orig_stream, source_name="stdout", default_level="INFO"):
        self._orig = orig_stream
        self._source = source_name
        self._default_level = default_level
        self._buf = ""

    def write(self, data):
        try:
            written = self._orig.write(data)
        except Exception:
            written = len(data) if data else 0
        try:
            if not data:
                return written
            self._buf += str(data)
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                clean = line.strip()
                if clean:
                    lvl = "ERROR" if self._source == "stderr" else _infer_console_level(clean, self._default_level)
                    record_service_console_log(clean, level=lvl, source=self._source)
        except Exception:
            pass
        return written

    def flush(self):
        try:
            self._orig.flush()
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._orig, name)


def install_service_console_tee():
    """Activa la captura pasiva de stdout/stderr hacia recursos_history.db."""
    global _SERVICE_CONSOLE_TEE_INSTALLED
    if _SERVICE_CONSOLE_TEE_INSTALLED:
        return
    _SERVICE_CONSOLE_TEE_INSTALLED = True
    try:
        sys.stdout = _ServiceConsoleStreamTee(sys.stdout, source_name="stdout", default_level="INFO")
        sys.stderr = _ServiceConsoleStreamTee(sys.stderr, source_name="stderr", default_level="ERROR")
    except Exception:
        pass


_ALLOWED_GITHUB_RELEASE_HOSTS = frozenset({
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
})
_NATIVE_RELEASES_CACHE = {"ts": 0.0, "data": None}
_NATIVE_RELEASES_LOCK = threading.Lock()


def is_allowed_github_release_url(url):
    try:
        parsed = urllib.parse.urlparse(str(url or "").strip())
        return parsed.scheme == "https" and (parsed.hostname or "").lower() in _ALLOWED_GITHUB_RELEASE_HOSTS
    except Exception:
        return False


def read_native_client_version(filename):
    path = os.path.join(BASE_DIR, filename)
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as fh:
                val = fh.read().strip().lstrip("vV")
                if val:
                    return val
    except Exception:
        pass
    return "1.1.1"


def _parse_semver_tuple(ver_str):
    nums = [int(p) for p in re.findall(r"\d+", str(ver_str or ""))[:3]]
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums)


def _extract_asset_version(asset_name, fallback_ver=""):
    m = re.search(r"(\d+\.\d+\.\d+)", str(asset_name or ""))
    return m.group(1) if m else str(fallback_ver or "")


def _is_native_release_tag(tag_str, platform):
    """Acepta únicamente etiquetas de releases nativas desacopladas (ubuntu-v*, android-v*, native-*), descartando v14.x heredadas."""
    low = str(tag_str or "").strip().lower()
    if not low:
        return False
    if platform == "ubuntu":
        return low.startswith("ubuntu-v") or low.startswith("native-")
    if platform == "android":
        return low.startswith("android-v") or low.startswith("native-")
    return low.startswith(("ubuntu-v", "android-v", "native-"))


def _is_compatible_native_version(cand_ver, canonical_remote_ver):
    """Evita que artefactos antiguos de la era monolítica (14.x) sobrescriban versiones desacopladas de cliente (1.x)."""
    cand_t = _parse_semver_tuple(cand_ver)
    canon_t = _parse_semver_tuple(canonical_remote_ver)
    if cand_t == (0, 0, 0):
        return False
    if canon_t[0] > 0 and canon_t[0] < 10 and cand_t[0] >= 10:
        return False
    return True


def get_github_native_releases_info(force_refresh=False):
    """Consulta dinámicamente la última compilación nativa en GitHub para Ubuntu (.deb) y Android (.apk), aislada de la versión del servidor."""
    now_ts = time.time()
    with _NATIVE_RELEASES_LOCK:
        if not force_refresh and _NATIVE_RELEASES_CACHE["data"] and (now_ts - _NATIVE_RELEASES_CACHE["ts"] < 60.0):
            return dict(_NATIVE_RELEASES_CACHE["data"])

    local_ubuntu_ver = read_native_client_version("UBUNTU_VERSION")
    local_android_ver = read_native_client_version("ANDROID_VERSION")
    server_ver = get_canonical_version(BASE_DIR)

    remote_ubuntu_ver = local_ubuntu_ver
    remote_android_ver = local_android_ver
    github_reachable = False
    tag_name = ""
    release_name = ""
    release_url = f"https://github.com/{GITHUB_REPO}/releases"
    published_at = ""
    sha256_url = ""
    deb_asset = None
    apk_asset = None
    headers = {
        "User-Agent": f"RecursosCockpit/{server_ver} (+https://github.com/{GITHUB_REPO})",
        "Accept": "application/vnd.github+json",
    }

    for fname, key in (("UBUNTU_VERSION", "ubuntu"), ("ANDROID_VERSION", "android")):
        try:
            raw_url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}/{fname}"
            if is_allowed_github_release_url(raw_url):
                r = requests.get(raw_url, headers=headers, timeout=4.0)
                if r.status_code == 200:
                    val = r.text.strip().lstrip("vV")
                    if re.match(r"^\d+\.\d+\.\d+$", val):
                        github_reachable = True
                        if key == "ubuntu":
                            remote_ubuntu_ver = val
                        else:
                            remote_android_ver = val
        except Exception:
            pass

    releases_list = []
    try:
        rel_api = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=15"
        if is_allowed_github_release_url(rel_api):
            r = requests.get(rel_api, headers=headers, timeout=5.0)
            if r.status_code == 200:
                parsed = r.json()
                if isinstance(parsed, list):
                    releases_list = [x for x in parsed if isinstance(x, dict) and not x.get("draft")]
                    github_reachable = True
    except Exception:
        pass

    for rel in releases_list:
        r_tag = str(rel.get("tag_name") or "").strip()
        if not _is_native_release_tag(r_tag, "any"):
            continue
        r_name = str(rel.get("name") or r_tag).strip()
        r_html = str(rel.get("html_url") or "").strip()
        r_pub = str(rel.get("published_at") or "").strip()
        if not tag_name and r_tag:
            tag_name = r_tag
            release_name = r_name
            if is_allowed_github_release_url(r_html):
                release_url = r_html
            published_at = r_pub

        assets = rel.get("assets") if isinstance(rel.get("assets"), list) else []
        for a in assets:
            if not isinstance(a, dict):
                continue
            a_name = str(a.get("name") or "").strip()
            a_url = str(a.get("browser_download_url") or "").strip()
            if not a_name or not is_allowed_github_release_url(a_url):
                continue
            a_size = int(a.get("size") or 0)
            a_pub = str(a.get("updated_at") or r_pub or "").strip()
            low_name = a_name.lower()
            if low_name == "sha256sums.txt" and not sha256_url:
                sha256_url = a_url
            elif low_name.endswith(".deb") and _is_native_release_tag(r_tag, "ubuntu"):
                cand_ver = _extract_asset_version(a_name, remote_ubuntu_ver)
                if not _is_compatible_native_version(cand_ver, remote_ubuntu_ver):
                    continue
                cand = {
                    "version": cand_ver,
                    "asset_name": a_name,
                    "download_url": a_url,
                    "size_bytes": a_size,
                    "published_at": a_pub,
                    "tag_name": r_tag,
                }
                if deb_asset is None or ("_" in a_name and "_" not in deb_asset["asset_name"]):
                    deb_asset = cand
            elif low_name.endswith(".apk") and _is_native_release_tag(r_tag, "android"):
                cand_ver = _extract_asset_version(a_name, remote_android_ver)
                if not _is_compatible_native_version(cand_ver, remote_android_ver):
                    continue
                cand = {
                    "version": cand_ver,
                    "asset_name": a_name,
                    "download_url": a_url,
                    "size_bytes": a_size,
                    "published_at": a_pub,
                    "tag_name": r_tag,
                }
                if apk_asset is None or ("_" in a_name and "_" not in apk_asset["asset_name"]):
                    apk_asset = cand
        if deb_asset and apk_asset:
            break

    deb_ver = (deb_asset or {}).get("version") or remote_ubuntu_ver
    apk_ver = (apk_asset or {}).get("version") or remote_android_ver

    deb_info = {
        "version": deb_ver,
        "local_version": local_ubuntu_ver,
        "asset_name": (deb_asset or {}).get("asset_name") or f"recursos-cockpit_{deb_ver}_amd64.deb",
        "download_url": (deb_asset or {}).get("download_url") or f"https://github.com/{GITHUB_REPO}/releases/tag/ubuntu-v{deb_ver}",
        "size_bytes": int((deb_asset or {}).get("size_bytes") or 0),
        "published_at": (deb_asset or {}).get("published_at") or published_at,
        "tag_name": (deb_asset or {}).get("tag_name") or f"ubuntu-v{deb_ver}",
        "available": bool(deb_asset),
        "update_available": bool(deb_asset) and (_parse_semver_tuple(deb_ver) > _parse_semver_tuple(local_ubuntu_ver)),
    }
    apk_info = {
        "version": apk_ver,
        "local_version": local_android_ver,
        "asset_name": (apk_asset or {}).get("asset_name") or f"recursos-cockpit_{apk_ver}.apk",
        "download_url": (apk_asset or {}).get("download_url") or f"https://github.com/{GITHUB_REPO}/releases/tag/android-v{apk_ver}",
        "size_bytes": int((apk_asset or {}).get("size_bytes") or 0),
        "published_at": (apk_asset or {}).get("published_at") or published_at,
        "tag_name": (apk_asset or {}).get("tag_name") or f"android-v{apk_ver}",
        "available": bool(apk_asset),
        "update_available": bool(apk_asset) and (_parse_semver_tuple(apk_ver) > _parse_semver_tuple(local_android_ver)),
    }

    payload = {
        "ok": True,
        "repo": GITHUB_REPO,
        "repo_url": f"https://github.com/{GITHUB_REPO}",
        "server_version": server_ver,
        "local_ubuntu_version": local_ubuntu_ver,
        "local_android_version": local_android_ver,
        "github_reachable": github_reachable,
        "tag_name": tag_name,
        "release_name": release_name or (f"Release {tag_name}" if tag_name else ""),
        "release_url": release_url,
        "published_at": published_at,
        "sha256_url": sha256_url,
        "deb": deb_info,
        "apk": apk_info,
        "checked_at": datetime.now().strftime("%H:%M:%S"),
    }
    with _NATIVE_RELEASES_LOCK:
        _NATIVE_RELEASES_CACHE["ts"] = now_ts
        _NATIVE_RELEASES_CACHE["data"] = dict(payload)
    return payload

def preload_telemetry_history_from_sqlite():
    """Precarga las últimas muestras de consumo (últimos 20 minutos) desde recursos_history.db."""
    init_geoip_history_db()
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            cutoff_ts = time.time() - HISTORY_WINDOW_SECONDS
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            ext_select = ", ".join(_EXTENDED_TELEMETRY_COLS)
            rows = conn.execute(f"""
                SELECT ts, time_str, cpu, gpu, ram, ram_total, net_rx, net_tx,
                       net_wan_rx, net_wan_tx, net_lan_rx, net_lan_tx,
                       disk_r, disk_w, disk_pct, {ext_select}
                FROM telemetry_history
                WHERE ts >= ?
                ORDER BY ts ASC
            """, (cutoff_ts,)).fetchall()
            if not rows:
                return
            _HISTORY_BUCKETS_20M.clear()
            for r in rows:
                nrx = float(r["net_rx"] or 0.0)
                ntx = float(r["net_tx"] or 0.0)
                wan_rx = float(r["net_wan_rx"] or 0.0)
                wan_tx = float(r["net_wan_tx"] or 0.0)
                lan_rx = float(r["net_lan_rx"] or 0.0)
                lan_tx = float(r["net_lan_tx"] or 0.0)
                if wan_rx == 0.0 and lan_rx == 0.0 and nrx > 0.0:
                    wan_rx = nrx
                if wan_tx == 0.0 and lan_tx == 0.0 and ntx > 0.0:
                    wan_tx = ntx
                ext_map = {col: float(r[col] or 0.0) for col in _EXTENDED_TELEMETRY_COLS}
                _push_history_bucket(
                    r["ts"] or 0.0,
                    r["time_str"] or "",
                    r["cpu"] or 0.0,
                    r["gpu"] or 0.0,
                    r["ram"] or 0.0,
                    r["ram_total"] or 0.0,
                    nrx,
                    ntx,
                    r["disk_r"] or 0.0,
                    r["disk_w"] or 0.0,
                    r["disk_pct"] or 0.0,
                    net_wan_rx_val=wan_rx,
                    net_wan_tx_val=wan_tx,
                    net_lan_rx_val=lan_rx,
                    net_lan_tx_val=lan_tx,
                    extra=ext_map,
                    sync=False,
                )
            _sync_history_dict_from_buckets()
        except Exception as e:
            print(f"[-] Error precargando telemetry_history desde SQLite: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

def record_telemetry_sample_to_sqlite(
    now_ts,
    time_str,
    cpu_val,
    gpu_val,
    ram_val,
    ram_tot_val,
    net_rx_val,
    net_tx_val,
    disk_r_val,
    disk_w_val,
    disk_pct_val,
    net_wan_rx_val=None,
    net_wan_tx_val=None,
    net_lan_rx_val=None,
    net_lan_tx_val=None,
    extra=None,
    force_flush=False,
):
    """Encola y persiste periódicamente en recursos_history.db cada muestra de consumo del sistema."""
    global _LAST_TELEMETRY_FLUSH_TS, _LAST_TELEMETRY_PRUNE_TS
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    nrx_v = round(float(net_rx_val or 0.0), 2)
    ntx_v = round(float(net_tx_val or 0.0), 2)
    nwan_rx_v = round(float(nrx_v if net_wan_rx_val is None else (net_wan_rx_val or 0.0)), 2)
    nwan_tx_v = round(float(ntx_v if net_wan_tx_val is None else (net_wan_tx_val or 0.0)), 2)
    nlan_rx_v = round(float(0.0 if net_lan_rx_val is None else (net_lan_rx_val or 0.0)), 2)
    nlan_tx_v = round(float(0.0 if net_lan_tx_val is None else (net_lan_tx_val or 0.0)), 2)
    ext = extra if isinstance(extra, dict) else {}
    ext_tuple = tuple(round(float(ext.get(col) or 0.0), 2) for col in _EXTENDED_TELEMETRY_COLS)
    sample = (
        round(float(now_ts), 3),
        str(time_str or ""),
        round(float(cpu_val or 0.0), 2),
        round(float(gpu_val or 0.0), 2),
        round(float(ram_val or 0.0), 2),
        round(float(ram_tot_val or 0.0), 2),
        nrx_v,
        ntx_v,
        nwan_rx_v,
        nwan_tx_v,
        nlan_rx_v,
        nlan_tx_v,
        round(float(disk_r_val or 0.0), 2),
        round(float(disk_w_val or 0.0), 2),
        round(float(disk_pct_val or 0.0), 1),
        *ext_tuple,
    )
    _TELEMETRY_SQLITE_BUFFER.append(sample)
    if not force_flush and len(_TELEMETRY_SQLITE_BUFFER) < 4 and (now_ts - _LAST_TELEMETRY_FLUSH_TS) < 6.0:
        return
    batch = list(_TELEMETRY_SQLITE_BUFFER)
    _TELEMETRY_SQLITE_BUFFER.clear()
    _LAST_TELEMETRY_FLUSH_TS = now_ts
    ext_cols_sql = ", ".join(_EXTENDED_TELEMETRY_COLS)
    placeholders = ", ".join(["?"] * (15 + len(_EXTENDED_TELEMETRY_COLS)))
    ext_updates_sql = ",\n                    ".join(f"{col}=excluded.{col}" for col in _EXTENDED_TELEMETRY_COLS)
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.executemany(f"""
                INSERT INTO telemetry_history (
                    ts, time_str, cpu, gpu, ram, ram_total,
                    net_rx, net_tx, net_wan_rx, net_wan_tx, net_lan_rx, net_lan_tx,
                    disk_r, disk_w, disk_pct, {ext_cols_sql}
                ) VALUES ({placeholders})
                ON CONFLICT(ts) DO UPDATE SET
                    time_str=excluded.time_str,
                    cpu=excluded.cpu,
                    gpu=excluded.gpu,
                    ram=excluded.ram,
                    ram_total=excluded.ram_total,
                    net_rx=excluded.net_rx,
                    net_tx=excluded.net_tx,
                    net_wan_rx=excluded.net_wan_rx,
                    net_wan_tx=excluded.net_wan_tx,
                    net_lan_rx=excluded.net_lan_rx,
                    net_lan_tx=excluded.net_lan_tx,
                    disk_r=excluded.disk_r,
                    disk_w=excluded.disk_w,
                    disk_pct=excluded.disk_pct,
                    {ext_updates_sql}
            """, batch)
            if now_ts - _LAST_TELEMETRY_PRUNE_TS >= 60.0:
                cutoff_7d = now_ts - (7 * 86400.0)
                conn.execute("DELETE FROM telemetry_history WHERE ts < ?", (cutoff_7d,))
                conn.execute("""
                    DELETE FROM telemetry_history
                    WHERE ts NOT IN (
                        SELECT ts FROM telemetry_history ORDER BY ts DESC LIMIT 250000
                    )
                """)
                _LAST_TELEMETRY_PRUNE_TS = now_ts
            conn.commit()
        except Exception as e:
            print(f"[-] Error guardando telemetry_history en SQLite: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

def _format_telemetry_rows_payload(rows):
    timestamps = []
    date_timestamps = []
    epoch_ts = []
    cpu = []
    gpu = []
    ram = []
    ram_total = []
    net_rx = []
    net_tx = []
    net_wan_rx = []
    net_wan_tx = []
    net_lan_rx = []
    net_lan_tx = []
    disk_r = []
    disk_w = []
    disk_pct = []
    ext_lists = {col: [] for col in _EXTENDED_TELEMETRY_COLS}
    for r in rows:
        ts_val = float(r["ts"] or 0.0)
        t_str = str(r["time_str"] or "")
        if not t_str and ts_val > 0:
            t_str = datetime.fromtimestamp(ts_val).strftime("%H:%M:%S")
        dt_str = datetime.fromtimestamp(ts_val).strftime("%d/%m %H:%M:%S") if ts_val > 0 else t_str
        timestamps.append(t_str)
        date_timestamps.append(dt_str)
        epoch_ts.append(round(ts_val, 3))
        cpu.append(round(float(r["cpu"] or 0.0), 2))
        gpu.append(round(float(r["gpu"] or 0.0), 2))
        ram.append(round(float(r["ram"] or 0.0), 2))
        ram_total.append(round(float(r["ram_total"] or 0.0), 2))
        nrx_val = round(float(r["net_rx"] or 0.0), 2)
        ntx_val = round(float(r["net_tx"] or 0.0), 2)
        keys = r.keys() if hasattr(r, "keys") else ()
        wan_rx_val = round(float((r["net_wan_rx"] if "net_wan_rx" in keys else 0.0) or 0.0), 2)
        wan_tx_val = round(float((r["net_wan_tx"] if "net_wan_tx" in keys else 0.0) or 0.0), 2)
        lan_rx_val = round(float((r["net_lan_rx"] if "net_lan_rx" in keys else 0.0) or 0.0), 2)
        lan_tx_val = round(float((r["net_lan_tx"] if "net_lan_tx" in keys else 0.0) or 0.0), 2)
        if wan_rx_val == 0.0 and lan_rx_val == 0.0 and nrx_val > 0.0:
            wan_rx_val = nrx_val
        if wan_tx_val == 0.0 and lan_tx_val == 0.0 and ntx_val > 0.0:
            wan_tx_val = ntx_val
        net_rx.append(nrx_val)
        net_tx.append(ntx_val)
        net_wan_rx.append(wan_rx_val)
        net_wan_tx.append(wan_tx_val)
        net_lan_rx.append(lan_rx_val)
        net_lan_tx.append(lan_tx_val)
        disk_r.append(round(float(r["disk_r"] or 0.0), 2))
        disk_w.append(round(float(r["disk_w"] or 0.0), 2))
        disk_pct.append(round(float(r["disk_pct"] or 0.0), 1))
        for col in _EXTENDED_TELEMETRY_COLS:
            val = float((r[col] if col in keys else 0.0) or 0.0)
            ext_lists[col].append(round(val, 2))
    out = {
        "timestamps": timestamps,
        "date_timestamps": date_timestamps,
        "epoch_ts": epoch_ts,
        "cpu": cpu,
        "gpu": gpu,
        "ram": ram,
        "ram_total": ram_total,
        "net_rx": net_rx,
        "net_tx": net_tx,
        "net_wan_rx": net_wan_rx,
        "net_wan_tx": net_wan_tx,
        "net_lan_rx": net_lan_rx,
        "net_lan_tx": net_lan_tx,
        "disk_r": disk_r,
        "disk_w": disk_w,
        "disk_pct": disk_pct,
    }
    out.update(ext_lists)
    return out

def query_telemetry_history_from_sqlite(before_ts=None, after_ts=None, window_sec=None, limit=180):
    """Consulta el historial persistente de consumo desde recursos_history.db con soporte de retroceso y submuestreo."""
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    try:
        limit_val = max(20, min(int(limit or 180), 600))
    except Exception:
        limit_val = 180

    b_ts = None
    a_ts = None
    w_sec = None
    try:
        if before_ts not in (None, "", "null", "undefined"):
            b_ts = float(before_ts)
    except Exception:
        b_ts = None
    try:
        if after_ts not in (None, "", "null", "undefined"):
            a_ts = float(after_ts)
    except Exception:
        a_ts = None
    if window_sec not in (None, "", "live", "all", "null", "undefined"):
        try:
            w_val = float(window_sec)
            if w_val > 0:
                w_sec = w_val
        except Exception:
            w_sec = None
    is_all_window = str(window_sec or "").strip().lower() == "all"

    empty_series = _format_telemetry_rows_payload([])
    ext_cols_sql = ", ".join(_EXTENDED_TELEMETRY_COLS)
    ext_agg_sql = ", ".join(
        f"MAX({c}) AS {c}" if c in ("cpu_temp", "gpu_temp", "gpu_vram_pct", "gpu_mem_ctrl", "gpu_enc", "gpu_dec", "gpu_pcie_rx", "gpu_pcie_tx")
        else f"AVG({c}) AS {c}"
        for c in _EXTENDED_TELEMETRY_COLS
    )
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            meta_row = cur.execute("""
                SELECT COUNT(*) AS cnt, MIN(ts) AS min_ts, MAX(ts) AS max_ts
                FROM telemetry_history
            """).fetchone()
            total_samples = int(meta_row["cnt"] or 0) if meta_row else 0
            oldest_ts = float(meta_row["min_ts"]) if meta_row and meta_row["min_ts"] is not None else None
            newest_ts = float(meta_row["max_ts"]) if meta_row and meta_row["max_ts"] is not None else None

            if total_samples == 0:
                return {
                    "ok": True,
                    "db_file": "recursos_history.db",
                    "oldest_ts": None,
                    "newest_ts": None,
                    "window_start_ts": None,
                    "window_end_ts": None,
                    "total_samples": 0,
                    "returned_samples": 0,
                    "has_older": False,
                    "has_newer": False,
                    "series": empty_series,
                }

            where_clauses = []
            params = []

            if is_all_window or w_sec is not None:
                end_ref = float(newest_ts) if is_all_window else float(b_ts if b_ts is not None else newest_ts)
                start_ref = float(oldest_ts or 0.0) if is_all_window else max(float(oldest_ts or 0.0), end_ref - float(w_sec))
                range_cnt_row = cur.execute(
                    "SELECT COUNT(*) AS c FROM telemetry_history WHERE ts >= ? AND ts <= ?",
                    (start_ref, end_ref),
                ).fetchone()
                range_cnt = int(range_cnt_row["c"] or 0) if range_cnt_row else 0
                if range_cnt > limit_val * 3 and end_ref > start_ref:
                    bucket_sec = max(1.0, (end_ref - start_ref) / float(limit_val))
                    raw_rows = cur.execute(f"""
                        SELECT MAX(ts) AS ts, MAX(time_str) AS time_str,
                               AVG(cpu) AS cpu, AVG(gpu) AS gpu, AVG(ram) AS ram, MAX(ram_total) AS ram_total,
                               MAX(net_rx) AS net_rx, MAX(net_tx) AS net_tx,
                               MAX(net_wan_rx) AS net_wan_rx, MAX(net_wan_tx) AS net_wan_tx,
                               MAX(net_lan_rx) AS net_lan_rx, MAX(net_lan_tx) AS net_lan_tx,
                               MAX(disk_r) AS disk_r, MAX(disk_w) AS disk_w, MAX(disk_pct) AS disk_pct,
                               {ext_agg_sql}
                        FROM telemetry_history
                        WHERE ts >= ? AND ts <= ?
                        GROUP BY CAST((ts - ?) / ? AS INTEGER)
                        ORDER BY ts ASC
                    """, (start_ref, end_ref, start_ref, bucket_sec)).fetchall()
                else:
                    raw_rows = cur.execute(f"""
                        SELECT ts, time_str, cpu, gpu, ram, ram_total,
                               net_rx, net_tx, net_wan_rx, net_wan_tx, net_lan_rx, net_lan_tx,
                               disk_r, disk_w, disk_pct, {ext_cols_sql}
                        FROM telemetry_history
                        WHERE ts >= ? AND ts <= ?
                        ORDER BY ts ASC
                    """, (start_ref, end_ref)).fetchall()
            elif a_ts is not None and b_ts is None:
                raw_rows = cur.execute(f"""
                    SELECT ts, time_str, cpu, gpu, ram, ram_total,
                           net_rx, net_tx, net_wan_rx, net_wan_tx, net_lan_rx, net_lan_tx,
                           disk_r, disk_w, disk_pct, {ext_cols_sql}
                    FROM telemetry_history
                    WHERE ts >= ?
                    ORDER BY ts ASC
                    LIMIT ?
                """, (a_ts, limit_val)).fetchall()
            else:
                if b_ts is not None:
                    where_clauses.append("ts <= ?")
                    params.append(b_ts)
                if a_ts is not None:
                    where_clauses.append("ts >= ?")
                    params.append(a_ts)
                where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
                desc_rows = cur.execute(f"""
                    SELECT ts, time_str, cpu, gpu, ram, ram_total,
                           net_rx, net_tx, net_wan_rx, net_wan_tx, net_lan_rx, net_lan_tx,
                           disk_r, disk_w, disk_pct, {ext_cols_sql}
                    FROM telemetry_history
                    {where_sql}
                    ORDER BY ts DESC
                    LIMIT ?
                """, (*params, limit_val)).fetchall()
                desc_rows.reverse()
                raw_rows = desc_rows

            # Si hay más muestras que el límite visual, submuestrear preservando extremos temporales y picos
            if len(raw_rows) > limit_val:
                bucket_size = len(raw_rows) / float(limit_val)
                sampled = []
                last_ts = None
                for idx in range(limit_val):
                    start_i = int(idx * bucket_size)
                    end_i = min(len(raw_rows), max(start_i + 1, int((idx + 1) * bucket_size)))
                    chunk = raw_rows[start_i:end_i]
                    if not chunk:
                        continue
                    if idx == 0:
                        rep = raw_rows[0]
                    elif idx == limit_val - 1:
                        rep = raw_rows[-1]
                    elif len(chunk) == 1:
                        rep = chunk[0]
                    else:
                        # Elegir el punto representativo con mayor carga combinada
                        rep = max(chunk, key=lambda r: float(r["cpu"] or 0.0) + float(r["ram"] or 0.0) + float(r["gpu"] or 0.0) + float(r["net_rx"] or 0.0))
                    ts_cur = float(rep["ts"] or 0.0)
                    if last_ts is not None and ts_cur <= last_ts:
                        continue
                    sampled.append(rep)
                    last_ts = ts_cur
                # Garantizar última muestra exacta en orden
                if raw_rows and sampled and float(sampled[-1]["ts"] or 0.0) < float(raw_rows[-1]["ts"] or 0.0):
                    if len(sampled) >= 2:
                        sampled[-1] = raw_rows[-1]
                    else:
                        sampled.append(raw_rows[-1])
                rows = sampled
            else:
                rows = raw_rows

            series_obj = _format_telemetry_rows_payload(rows)
            win_start = series_obj["epoch_ts"][0] if series_obj["epoch_ts"] else None
            win_end = series_obj["epoch_ts"][-1] if series_obj["epoch_ts"] else None
            has_older = bool(win_start is not None and oldest_ts is not None and win_start > (oldest_ts + 0.5))
            has_newer = bool(win_end is not None and newest_ts is not None and win_end < (newest_ts - 0.5))
            return {
                "ok": True,
                "db_file": "recursos_history.db",
                "oldest_ts": oldest_ts,
                "newest_ts": newest_ts,
                "window_start_ts": win_start,
                "window_end_ts": win_end,
                "total_samples": total_samples,
                "returned_samples": len(rows),
                "has_older": has_older,
                "has_newer": has_newer,
                "series": series_obj,
            }
        except Exception as e:
            print(f"[-] Error consultando telemetry_history en SQLite: {e}")
            return {
                "ok": False,
                "error": str(e),
                "db_file": "recursos_history.db",
                "oldest_ts": None,
                "newest_ts": None,
                "window_start_ts": None,
                "window_end_ts": None,
                "total_samples": 0,
                "returned_samples": 0,
                "has_older": False,
                "has_newer": False,
                "series": empty_series,
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


_LAST_DEV_SERIES_SQLITE_TS = 0.0
_DEV_SERIES_SQLITE_INTERVAL_SEC = 5.0
_CPU_THERMAL_PROBES_LIVE = collections.deque(maxlen=200)


def _push_cpu_thermal_probes_live(ts_now, time_str, sensors):
    """Mantiene historial en vivo (últimos ~5 min) por cada sonda térmica de CPU."""
    if not sensors:
        return
    probe_map = {}
    for s in sensors[:8]:
        lbl = str(s.get("label") or "").strip()
        if not lbl:
            continue
        try:
            probe_map[lbl] = round(float(s.get("temp_c") or 0.0), 1)
        except Exception:
            continue
    if probe_map:
        _CPU_THERMAL_PROBES_LIVE.append({
            "ts": round(float(ts_now), 3),
            "time_str": str(time_str or ""),
            "probes": probe_map,
        })


def get_cpu_thermal_probes_live_payload():
    """Devuelve las series en vivo alineadas de todas las sondas térmicas de CPU."""
    items = list(_CPU_THERMAL_PROBES_LIVE)
    if not items:
        return {"timestamps": [], "epoch_ts": [], "probes": {}}
    labels = []
    seen = set()
    for it in reversed(items):
        for lbl in it["probes"].keys():
            if lbl not in seen:
                seen.add(lbl)
                labels.append(lbl)
        if len(labels) >= 8:
            break
    timestamps = [it["time_str"] for it in items]
    epoch_ts = [it["ts"] for it in items]
    probes = {}
    for lbl in labels:
        last_val = 0.0
        arr = []
        for it in items:
            if lbl in it["probes"]:
                last_val = it["probes"][lbl]
            arr.append(last_val)
        probes[lbl] = arr
    return {"timestamps": timestamps, "epoch_ts": epoch_ts, "probes": probes}


def record_device_series_batch_to_sqlite(ts_now, rows, force=False):
    """Persiste muestras por entidad (discos, interfaces NIC y sondas térmicas CPU) en recursos_history.db."""
    global _LAST_DEV_SERIES_SQLITE_TS
    if not rows:
        return
    if not force and (ts_now - _LAST_DEV_SERIES_SQLITE_TS) < _DEV_SERIES_SQLITE_INTERVAL_SEC:
        return
    init_geoip_history_db()
    ts_bucket = round(float(ts_now), 3)
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=5.0)
            conn.executemany(
                """
                INSERT OR REPLACE INTO device_series_history
                (ts, entity_kind, entity_id, val1, val2, val3, val4)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        ts_bucket,
                        str(kind),
                        str(eid)[:128],
                        round(float(v1 or 0.0), 2),
                        round(float(v2 or 0.0), 2),
                        round(float(v3 or 0.0), 2),
                        round(float(v4 or 0.0), 2),
                    )
                    for (kind, eid, v1, v2, v3, v4) in rows
                    if kind and eid
                ],
            )
            conn.commit()
            _LAST_DEV_SERIES_SQLITE_TS = ts_now
        except Exception as e:
            print(f"[-] Error guardando device_series_history en SQLite: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def query_device_series_history_from_sqlite(entity_kind, entity_id, before_ts=None, after_ts=None, window_sec=None, limit=180):
    """Consulta historial SQLite completo por entidad ('disk' | 'nic' | 'cpu_sensor') con submuestreo GROUP BY."""
    init_geoip_history_db()
    kind = str(entity_kind or "").strip().lower()
    eid = str(entity_id or "").strip()
    empty_series = {"timestamps": [], "date_timestamps": [], "epoch_ts": []}
    if kind not in ("disk", "nic", "cpu_sensor") or not eid:
        return {
            "ok": False,
            "error": "invalid_entity",
            "db_file": "recursos_history.db",
            "entity_kind": kind,
            "entity_id": eid,
            "oldest_ts": None,
            "newest_ts": None,
            "window_start_ts": None,
            "window_end_ts": None,
            "total_samples": 0,
            "returned_samples": 0,
            "has_older": False,
            "has_newer": False,
            "series": empty_series,
        }

    try:
        limit_val = max(20, min(600, int(limit or 180)))
    except Exception:
        limit_val = 180

    b_ts = None
    a_ts = None
    win_sec_val = None
    is_all = False
    try:
        if before_ts is not None and str(before_ts).strip() != "":
            b_ts = float(before_ts)
    except Exception:
        b_ts = None
    try:
        if after_ts is not None and str(after_ts).strip() != "":
            a_ts = float(after_ts)
    except Exception:
        a_ts = None
    if window_sec is not None and str(window_sec).strip() != "":
        w_raw = str(window_sec).strip().lower()
        if w_raw == "all":
            is_all = True
        else:
            try:
                win_sec_val = max(60.0, float(w_raw))
            except Exception:
                win_sec_val = None

    def _fmt_dt(ts_f):
        try:
            lt = time.localtime(ts_f)
            return time.strftime("%H:%M:%S", lt), time.strftime("%d/%m %H:%M:%S", lt)
        except Exception:
            return "", ""

    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=5.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # Modo multi-sonda térmica ('cpu_sensor' + entity_id == '*')
            if kind == "cpu_sensor" and eid == "*":
                bounds = cur.execute(
                    "SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(DISTINCT ts) AS cnt FROM device_series_history WHERE entity_kind = 'cpu_sensor'"
                ).fetchone()
                oldest_ts = float(bounds["min_ts"]) if bounds and bounds["min_ts"] is not None else None
                newest_ts = float(bounds["max_ts"]) if bounds and bounds["max_ts"] is not None else None
                total_samples = int(bounds["cnt"] or 0) if bounds else 0
                if total_samples == 0 or newest_ts is None:
                    return {
                        "ok": True, "db_file": "recursos_history.db", "entity_kind": kind, "entity_id": eid,
                        "oldest_ts": oldest_ts, "newest_ts": newest_ts, "window_start_ts": None, "window_end_ts": None,
                        "total_samples": 0, "returned_samples": 0, "has_older": False, "has_newer": False,
                        "series": {**empty_series, "temp_c": [], "probes": {}},
                    }
                end_ref = b_ts if b_ts is not None else newest_ts
                start_ref = oldest_ts if is_all else (max(oldest_ts, end_ref - win_sec_val) if win_sec_val else (a_ts if a_ts is not None else max(oldest_ts, end_ref - 1200.0)))
                span_sec = max(1.0, end_ref - start_ref)
                bucket_sec = max(1.0, span_sec / float(limit_val))
                rows = cur.execute(
                    """
                    SELECT CAST(ts / ? AS INTEGER) AS bkt,
                           MAX(ts) AS ts,
                           entity_id,
                           AVG(val1) AS v1
                    FROM device_series_history
                    WHERE entity_kind = 'cpu_sensor' AND ts >= ? AND ts <= ?
                    GROUP BY bkt, entity_id
                    ORDER BY ts ASC
                    """,
                    (bucket_sec, start_ref, end_ref),
                ).fetchall()
                buckets = {}
                probe_order = []
                probe_seen = set()
                for r in rows:
                    bkt = int(r["bkt"])
                    lbl = str(r["entity_id"])
                    if lbl not in probe_seen and len(probe_order) < 8:
                        probe_seen.add(lbl)
                        probe_order.append(lbl)
                    if lbl not in probe_seen:
                        continue
                    entry = buckets.get(bkt)
                    if entry is None:
                        entry = {"ts": float(r["ts"]), "vals": {}}
                        buckets[bkt] = entry
                    else:
                        entry["ts"] = max(entry["ts"], float(r["ts"]))
                    entry["vals"][lbl] = round(float(r["v1"] or 0.0), 1)
                sorted_items = [buckets[k] for k in sorted(buckets.keys())]
                if len(sorted_items) > limit_val:
                    sorted_items = sorted_items[-limit_val:]
                ts_labels, dt_labels, epochs, temp_max_arr = [], [], [], []
                probes_out = {lbl: [] for lbl in probe_order}
                last_vals = {lbl: 0.0 for lbl in probe_order}
                for it in sorted_items:
                    t_s, d_s = _fmt_dt(it["ts"])
                    ts_labels.append(t_s)
                    dt_labels.append(d_s)
                    epochs.append(round(it["ts"], 3))
                    cur_vals = []
                    for lbl in probe_order:
                        if lbl in it["vals"]:
                            last_vals[lbl] = it["vals"][lbl]
                        probes_out[lbl].append(last_vals[lbl])
                        if last_vals[lbl] > 0:
                            cur_vals.append(last_vals[lbl])
                    temp_max_arr.append(round(max(cur_vals), 1) if cur_vals else 0.0)
                win_start = epochs[0] if epochs else None
                win_end = epochs[-1] if epochs else None
                return {
                    "ok": True,
                    "db_file": "recursos_history.db",
                    "entity_kind": kind,
                    "entity_id": eid,
                    "oldest_ts": oldest_ts,
                    "newest_ts": newest_ts,
                    "window_start_ts": win_start,
                    "window_end_ts": win_end,
                    "total_samples": total_samples,
                    "returned_samples": len(epochs),
                    "has_older": bool(win_start is not None and oldest_ts is not None and win_start > oldest_ts + 0.5),
                    "has_newer": bool(win_end is not None and newest_ts is not None and win_end < newest_ts - 0.5),
                    "series": {
                        "timestamps": ts_labels,
                        "date_timestamps": dt_labels,
                        "epoch_ts": epochs,
                        "temp_c": temp_max_arr,
                        "probes": probes_out,
                    },
                }

            bounds = cur.execute(
                "SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(*) AS cnt FROM device_series_history WHERE entity_kind = ? AND entity_id = ?",
                (kind, eid),
            ).fetchone()
            oldest_ts = float(bounds["min_ts"]) if bounds and bounds["min_ts"] is not None else None
            newest_ts = float(bounds["max_ts"]) if bounds and bounds["max_ts"] is not None else None
            total_samples = int(bounds["cnt"] or 0) if bounds else 0
            if total_samples == 0 or newest_ts is None:
                return {
                    "ok": True, "db_file": "recursos_history.db", "entity_kind": kind, "entity_id": eid,
                    "oldest_ts": oldest_ts, "newest_ts": newest_ts, "window_start_ts": None, "window_end_ts": None,
                    "total_samples": 0, "returned_samples": 0, "has_older": False, "has_newer": False,
                    "series": empty_series,
                }

            end_ref = b_ts if b_ts is not None else newest_ts
            if is_all:
                start_ref = oldest_ts
            elif win_sec_val is not None:
                start_ref = max(oldest_ts, end_ref - win_sec_val)
            elif a_ts is not None and b_ts is None:
                start_ref = a_ts
                end_ref = newest_ts
            else:
                start_ref = a_ts if a_ts is not None else max(oldest_ts, end_ref - 1200.0)

            cnt_win = int(cur.execute(
                "SELECT COUNT(*) FROM device_series_history WHERE entity_kind = ? AND entity_id = ? AND ts >= ? AND ts <= ?",
                (kind, eid, start_ref, end_ref),
            ).fetchone()[0] or 0)

            if cnt_win > limit_val and end_ref > start_ref:
                bucket_sec = max(1.0, (end_ref - start_ref) / float(limit_val))
                rows = cur.execute(
                    """
                    SELECT MAX(ts) AS ts,
                           MAX(val1) AS val1,
                           MAX(val2) AS val2,
                           AVG(val3) AS val3,
                           MAX(val4) AS val4
                    FROM device_series_history
                    WHERE entity_kind = ? AND entity_id = ? AND ts >= ? AND ts <= ?
                    GROUP BY CAST(ts / ? AS INTEGER)
                    ORDER BY ts ASC
                    """,
                    (kind, eid, start_ref, end_ref, bucket_sec),
                ).fetchall()
            else:
                rows = cur.execute(
                    """
                    SELECT ts, val1, val2, val3, val4
                    FROM device_series_history
                    WHERE entity_kind = ? AND entity_id = ? AND ts >= ? AND ts <= ?
                    ORDER BY ts ASC
                    LIMIT ?
                    """,
                    (kind, eid, start_ref, end_ref, limit_val),
                ).fetchall()

            ts_labels, dt_labels, epochs = [], [], []
            v1_list, v2_list, v3_list, v4_list = [], [], [], []
            for r in rows:
                ts_f = float(r["ts"] or 0.0)
                t_s, d_s = _fmt_dt(ts_f)
                ts_labels.append(t_s)
                dt_labels.append(d_s)
                epochs.append(round(ts_f, 3))
                v1_list.append(round(float(r["val1"] or 0.0), 2))
                v2_list.append(round(float(r["val2"] or 0.0), 2))
                v3_list.append(round(float(r["val3"] or 0.0), 2))
                v4_list.append(round(float(r["val4"] or 0.0), 2))

            series_out = {
                "timestamps": ts_labels,
                "date_timestamps": dt_labels,
                "epoch_ts": epochs,
            }
            if kind == "disk":
                series_out["disk_r"] = v1_list
                series_out["disk_w"] = v2_list
                series_out["disk_pct"] = v3_list
            elif kind == "nic":
                series_out["net_wan_rx"] = v1_list
                series_out["net_wan_tx"] = v2_list
                series_out["net_lan_rx"] = v3_list
                series_out["net_lan_tx"] = v4_list
                series_out["net_rx"] = [round(a + b, 2) for a, b in zip(v1_list, v3_list)]
                series_out["net_tx"] = [round(a + b, 2) for a, b in zip(v2_list, v4_list)]
            elif kind == "cpu_sensor":
                series_out["temp_c"] = v1_list
                series_out["cpu_temp"] = v1_list

            win_start = epochs[0] if epochs else None
            win_end = epochs[-1] if epochs else None
            return {
                "ok": True,
                "db_file": "recursos_history.db",
                "entity_kind": kind,
                "entity_id": eid,
                "oldest_ts": oldest_ts,
                "newest_ts": newest_ts,
                "window_start_ts": win_start,
                "window_end_ts": win_end,
                "total_samples": total_samples,
                "returned_samples": len(epochs),
                "has_older": bool(win_start is not None and oldest_ts is not None and win_start > oldest_ts + 0.5),
                "has_newer": bool(win_end is not None and newest_ts is not None and win_end < newest_ts - 0.5),
                "series": series_out,
            }
        except Exception as e:
            print(f"[-] Error consultando device_series_history en SQLite: {e}")
            return {
                "ok": False, "error": str(e), "db_file": "recursos_history.db",
                "entity_kind": kind, "entity_id": eid,
                "oldest_ts": None, "newest_ts": None, "window_start_ts": None, "window_end_ts": None,
                "total_samples": 0, "returned_samples": 0, "has_older": False, "has_newer": False,
                "series": empty_series,
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def _format_ping_history_targets(ordered_ts, rows_by_ts, target_meta):
    target_palette = ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4"]
    kind_order = {"gateway": 0, "external": 1, "dns": 2}
    freq_counts = {}
    for ts_val in ordered_ts:
        for tid in rows_by_ts.get(ts_val, {}).keys():
            freq_counts[tid] = freq_counts.get(tid, 0) + 1
    ranked_ids = sorted(
        target_meta.keys(),
        key=lambda tid: (
            kind_order.get(target_meta[tid].get("kind") or "external", 1),
            -freq_counts.get(tid, 0),
            tid,
        ),
    )[:5]

    targets_out = []
    for idx, tid in enumerate(ranked_ids):
        meta = target_meta[tid]
        raw_vals = [rows_by_ts.get(ts_val, {}).get(tid) for ts_val in ordered_ts]
        valid_vals = [float(v) for v in raw_vals if isinstance(v, (int, float)) and v >= 0]
        total_pts = max(1, len(raw_vals))
        loss_pct = round(((len(raw_vals) - len(valid_vals)) / float(total_pts)) * 100.0, 1)
        avg_ms = round(sum(valid_vals) / float(len(valid_vals)), 2) if valid_vals else None
        min_ms = round(min(valid_vals), 2) if valid_vals else None
        max_ms = round(max(valid_vals), 2) if valid_vals else None
        last_ms = (
            round(float(raw_vals[-1]), 2)
            if raw_vals and isinstance(raw_vals[-1], (int, float)) and raw_vals[-1] >= 0
            else None
        )
        jitter_ms = 0.0
        if len(valid_vals) >= 2:
            diffs = [abs(valid_vals[i] - valid_vals[i - 1]) for i in range(1, len(valid_vals))]
            jitter_ms = round(sum(diffs) / float(len(diffs)), 2)
        data_clean = [round(float(v), 2) if isinstance(v, (int, float)) and v >= 0 else 0.0 for v in raw_vals]
        targets_out.append({
            "id": tid,
            "ip": meta.get("ip") or "",
            "label": meta.get("label") or tid,
            "kind": meta.get("kind") or "external",
            "avg_ms": avg_ms,
            "last_ms": last_ms,
            "min_ms": min_ms,
            "max_ms": max_ms,
            "jitter_ms": jitter_ms,
            "loss_pct": loss_pct,
            "color": target_palette[idx % len(target_palette)],
            "data": data_clean,
        })
    return targets_out

def preload_ping_history_from_sqlite():
    """Precarga las últimas muestras de latencia ping (últimos 20 minutos) desde recursos_history.db."""
    global PING_LATENCY_CACHE
    init_geoip_history_db()
    cutoff_20m = time.time() - 1200.0
    rows = []
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT ts, target_id, target_ip, label, kind, rtt_ms
                FROM ping_history
                WHERE ts >= ?
                ORDER BY ts ASC
            """, (cutoff_20m,)).fetchall()
        except Exception as e:
            print(f"[-] Error precargando ping_history desde SQLite: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    if not rows:
        return
    rows_by_ts = {}
    target_meta = {}
    for r in rows:
        ts_val = round(float(r["ts"] or 0.0), 2)
        tid = str(r["target_id"] or "")
        if not tid:
            continue
        rows_by_ts.setdefault(ts_val, {})[tid] = float(r["rtt_ms"] if r["rtt_ms"] is not None else -1.0)
        target_meta[tid] = {
            "ip": str(r["target_ip"] or ""),
            "label": str(r["label"] or tid),
            "kind": str(r["kind"] or "external"),
        }
    ordered_ts = sorted(rows_by_ts.keys())
    with PING_LATENCY_LOCK:
        _PING_HISTORY_POINTS.clear()
        for ts_val in ordered_ts:
            t_str = datetime.fromtimestamp(ts_val).strftime("%H:%M:%S")
            _PING_HISTORY_POINTS.append({
                "ts": ts_val,
                "time_str": t_str,
                "values": {k: (v if v >= 0 else None) for k, v in rows_by_ts[ts_val].items()},
            })
        timestamps = [pt["time_str"] for pt in _PING_HISTORY_POINTS]
        epoch_ts = [pt["ts"] for pt in _PING_HISTORY_POINTS]
        targets_out = _format_ping_history_targets(ordered_ts, {
            ts_val: {k: (v if v >= 0 else None) for k, v in vals.items()}
            for ts_val, vals in rows_by_ts.items()
        }, target_meta)
        PING_LATENCY_CACHE = {
            "updated_at": timestamps[-1] if timestamps else "--",
            "timestamps": timestamps,
            "epoch_ts": epoch_ts,
            "targets": targets_out,
        }

def query_ping_history_from_sqlite(before_ts=None, after_ts=None, window_sec=None, limit=180):
    """Consulta el historial persistente de latencia ping desde recursos_history.db."""
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    try:
        limit_val = max(20, min(int(limit or 180), 600))
    except Exception:
        limit_val = 180

    b_ts = None
    a_ts = None
    w_sec = None
    try:
        if before_ts not in (None, "", "null", "undefined"):
            b_ts = float(before_ts)
    except Exception:
        b_ts = None
    try:
        if after_ts not in (None, "", "null", "undefined"):
            a_ts = float(after_ts)
    except Exception:
        a_ts = None
    if window_sec not in (None, "", "live", "all", "null", "undefined"):
        try:
            w_val = float(window_sec)
            if w_val > 0:
                w_sec = w_val
        except Exception:
            w_sec = None
    is_all_window = str(window_sec or "").strip().lower() == "all"

    empty_series = {
        "timestamps": [],
        "date_timestamps": [],
        "epoch_ts": [],
        "targets": [],
    }
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            meta_row = cur.execute("""
                SELECT COUNT(DISTINCT ts) AS cnt, MIN(ts) AS min_ts, MAX(ts) AS max_ts
                FROM ping_history
            """).fetchone()
            total_samples = int(meta_row["cnt"] or 0) if meta_row else 0
            oldest_ts = float(meta_row["min_ts"]) if meta_row and meta_row["min_ts"] is not None else None
            newest_ts = float(meta_row["max_ts"]) if meta_row and meta_row["max_ts"] is not None else None

            if total_samples == 0 or oldest_ts is None or newest_ts is None:
                return {
                    "ok": True,
                    "db_file": "recursos_history.db",
                    "oldest_ts": None,
                    "newest_ts": None,
                    "window_start_ts": None,
                    "window_end_ts": None,
                    "total_samples": 0,
                    "returned_samples": 0,
                    "has_older": False,
                    "has_newer": False,
                    "series": empty_series,
                }

            if is_all_window or w_sec is not None:
                end_ref = float(newest_ts) if is_all_window else float(b_ts if b_ts is not None else newest_ts)
                start_ref = float(oldest_ts) if is_all_window else max(float(oldest_ts), end_ref - float(w_sec))
                ping_cnt_row = cur.execute(
                    "SELECT COUNT(*) AS c FROM ping_history WHERE ts >= ? AND ts <= ?",
                    (start_ref, end_ref),
                ).fetchone()
                ping_cnt = int(ping_cnt_row["c"] or 0) if ping_cnt_row else 0
                if ping_cnt > limit_val * 12 and end_ref > start_ref:
                    bucket_sec = max(1.0, (end_ref - start_ref) / float(limit_val))
                    raw_rows = cur.execute("""
                        SELECT MAX(ts) AS ts, target_id, MAX(target_ip) AS target_ip,
                               MAX(label) AS label, MAX(kind) AS kind,
                               CASE WHEN MAX(rtt_ms) >= 0 THEN AVG(CASE WHEN rtt_ms >= 0 THEN rtt_ms END) ELSE -1.0 END AS rtt_ms
                        FROM ping_history
                        WHERE ts >= ? AND ts <= ?
                        GROUP BY CAST((ts - ?) / ? AS INTEGER), target_id
                        ORDER BY ts ASC
                    """, (start_ref, end_ref, start_ref, bucket_sec)).fetchall()
                else:
                    raw_rows = cur.execute("""
                        SELECT ts, target_id, target_ip, label, kind, rtt_ms
                        FROM ping_history
                        WHERE ts >= ? AND ts <= ?
                        ORDER BY ts ASC
                    """, (start_ref, end_ref)).fetchall()
            else:
                clauses = []
                params = []
                if a_ts is not None:
                    clauses.append("ts >= ?")
                    params.append(a_ts)
                if b_ts is not None:
                    clauses.append("ts <= ?")
                    params.append(b_ts)
                where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
                raw_rows = cur.execute(f"""
                    SELECT ts, target_id, target_ip, label, kind, rtt_ms
                    FROM ping_history
                    {where_sql}
                    ORDER BY ts ASC
                """, tuple(params)).fetchall()

            rows_by_ts = {}
            target_meta = {}
            for r in raw_rows:
                ts_val = round(float(r["ts"] or 0.0), 2)
                tid = str(r["target_id"] or "")
                if not tid:
                    continue
                rtt_val = float(r["rtt_ms"] if r["rtt_ms"] is not None else -1.0)
                rows_by_ts.setdefault(ts_val, {})[tid] = rtt_val if rtt_val >= 0 else None
                target_meta[tid] = {
                    "ip": str(r["target_ip"] or ""),
                    "label": str(r["label"] or tid),
                    "kind": str(r["kind"] or "external"),
                }

            all_ts = sorted(rows_by_ts.keys())
            if len(all_ts) > limit_val:
                bucket_size = len(all_ts) / float(limit_val)
                sampled_ts = []
                last_ts = None
                for idx in range(limit_val):
                    start_i = int(idx * bucket_size)
                    end_i = min(len(all_ts), max(start_i + 1, int((idx + 1) * bucket_size)))
                    chunk = all_ts[start_i:end_i]
                    if not chunk:
                        continue
                    if idx == 0:
                        rep_ts = all_ts[0]
                    elif idx == limit_val - 1:
                        rep_ts = all_ts[-1]
                    elif len(chunk) == 1:
                        rep_ts = chunk[0]
                    else:
                        rep_ts = max(
                            chunk,
                            key=lambda tv: max((v for v in rows_by_ts.get(tv, {}).values() if isinstance(v, (int, float))), default=0.0),
                        )
                    if last_ts is not None and rep_ts <= last_ts:
                        continue
                    sampled_ts.append(rep_ts)
                    last_ts = rep_ts
                if all_ts and sampled_ts and sampled_ts[-1] < all_ts[-1]:
                    if len(sampled_ts) >= 2:
                        sampled_ts[-1] = all_ts[-1]
                    else:
                        sampled_ts.append(all_ts[-1])
                ordered_ts = sampled_ts
            else:
                ordered_ts = all_ts

            timestamps = [datetime.fromtimestamp(ts_val).strftime("%H:%M:%S") for ts_val in ordered_ts]
            date_timestamps = [datetime.fromtimestamp(ts_val).strftime("%d/%m %H:%M:%S") for ts_val in ordered_ts]
            targets_out = _format_ping_history_targets(ordered_ts, rows_by_ts, target_meta)
            win_start = ordered_ts[0] if ordered_ts else None
            win_end = ordered_ts[-1] if ordered_ts else None
            has_older = bool(win_start is not None and oldest_ts is not None and win_start > (oldest_ts + 0.5))
            has_newer = bool(win_end is not None and newest_ts is not None and win_end < (newest_ts - 0.5))
            return {
                "ok": True,
                "db_file": "recursos_history.db",
                "oldest_ts": oldest_ts,
                "newest_ts": newest_ts,
                "window_start_ts": win_start,
                "window_end_ts": win_end,
                "total_samples": total_samples,
                "returned_samples": len(ordered_ts),
                "has_older": has_older,
                "has_newer": has_newer,
                "series": {
                    "timestamps": timestamps,
                    "date_timestamps": date_timestamps,
                    "epoch_ts": ordered_ts,
                    "targets": targets_out,
                },
            }
        except Exception as e:
            print(f"[-] Error consultando ping_history en SQLite: {e}")
            return {
                "ok": False,
                "error": str(e),
                "db_file": "recursos_history.db",
                "oldest_ts": None,
                "newest_ts": None,
                "window_start_ts": None,
                "window_end_ts": None,
                "total_samples": 0,
                "returned_samples": 0,
                "has_older": False,
                "has_newer": False,
                "series": empty_series,
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

def _push_router_history_bucket(now_ts, wan_rx, wan_tx, lan_rx, lan_tx):
    """Mantiene cubetas de 5s durante los últimos 20 minutos para el tráfico agregado del router."""
    now_ms = int(now_ts * 1000)
    bucket_ms = (now_ms // NIC_BUCKET_INTERVAL_MS) * NIC_BUCKET_INTERVAL_MS
    cutoff_ms = bucket_ms - (MAX_NIC_HISTORY_SECONDS * 1000)
    w_rx = round(float(wan_rx or 0.0), 1)
    w_tx = round(float(wan_tx or 0.0), 1)
    l_rx = round(float(lan_rx or 0.0), 1)
    l_tx = round(float(lan_tx or 0.0), 1)
    tot_rx = round(w_rx + l_rx, 1)
    tot_tx = round(w_tx + l_tx, 1)
    with ROUTER_HISTORY_LOCK:
        if not _ROUTER_HISTORY_BUCKETS_20M or _ROUTER_HISTORY_BUCKETS_20M[-1]["t"] < bucket_ms:
            _ROUTER_HISTORY_BUCKETS_20M.append({
                "t": bucket_ms,
                "rx": tot_rx,
                "tx": tot_tx,
                "wan_rx": w_rx,
                "wan_tx": w_tx,
                "lan_rx": l_rx,
                "lan_tx": l_tx,
            })
        else:
            last_b = _ROUTER_HISTORY_BUCKETS_20M[-1]
            last_b["rx"] = max(last_b["rx"], tot_rx)
            last_b["tx"] = max(last_b["tx"], tot_tx)
            last_b["wan_rx"] = max(last_b.get("wan_rx", 0.0), w_rx)
            last_b["wan_tx"] = max(last_b.get("wan_tx", 0.0), w_tx)
            last_b["lan_rx"] = max(last_b.get("lan_rx", 0.0), l_rx)
            last_b["lan_tx"] = max(last_b.get("lan_tx", 0.0), l_tx)
        while _ROUTER_HISTORY_BUCKETS_20M and _ROUTER_HISTORY_BUCKETS_20M[0]["t"] < cutoff_ms:
            _ROUTER_HISTORY_BUCKETS_20M.pop(0)
        return list(_ROUTER_HISTORY_BUCKETS_20M)


def record_process_snapshot_to_sqlite(now_ts, procs_list, force=False):
    """Guarda instantáneas agrupadas por nombre de proceso cada ~60s en recursos_history.db (retención 24h)."""
    global _LAST_PROC_HISTORY_RECORD_TS
    if not force and (now_ts - _LAST_PROC_HISTORY_RECORD_TS) < 55.0:
        return
    if not procs_list:
        return
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    _LAST_PROC_HISTORY_RECORD_TS = now_ts
    grouped = {}
    for p in procs_list:
        raw_name = str(p.get("name") or "").strip()
        if not raw_name:
            continue
        pname = raw_name[:64]
        slot = grouped.setdefault(pname, {"cpu": 0.0, "ram": 0.0, "vram": 0.0, "io": 0.0})
        slot["cpu"] += float(p.get("cpu_norm_percent") if p.get("cpu_norm_percent") is not None else (p.get("cpu_percent") or 0.0))
        slot["ram"] += float(p.get("priv_mb") if p.get("priv_mb") is not None else (p.get("mem_mb") or 0.0))
        slot["vram"] += float(p.get("vram_mb") or 0.0)
        slot["io"] += float(p.get("io_total_bps") or 0.0)
    if not grouped:
        return
    ranked = sorted(
        grouped.items(),
        key=lambda kv: (kv[1]["cpu"] * 2.0) + (kv[1]["ram"] / 128.0) + (kv[1]["vram"] / 64.0) + (kv[1]["io"] / (1024 * 1024)),
        reverse=True,
    )[:20]
    ts_round = round(float(now_ts), 1)
    rows = [
        (
            ts_round,
            name,
            round(min(100.0, vals["cpu"]), 2),
            round(vals["ram"], 2),
            round(vals["vram"], 2),
            round(vals["io"], 1),
        )
        for name, vals in ranked
    ]
    with PROCESS_HISTORY_LOCK:
        with GEOIP_HISTORY_DB_LOCK:
            conn = None
            try:
                conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
                conn.executemany("""
                    INSERT INTO process_history (ts, proc_name, cpu_pct, ram_mb, vram_mb, io_bps)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(ts, proc_name) DO UPDATE SET
                        cpu_pct=excluded.cpu_pct,
                        ram_mb=excluded.ram_mb,
                        vram_mb=excluded.vram_mb,
                        io_bps=excluded.io_bps
                """, rows)
                cutoff_24h = now_ts - 86400.0
                conn.execute("DELETE FROM process_history WHERE ts < ?", (cutoff_24h,))
                conn.commit()
            except Exception as e:
                print(f"[-] Error guardando process_history en SQLite: {e}")
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass


_PROC_HIST_COLORS = [
    "#0284c7",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ef4444",
    "#06b6d4",
]


def query_process_history_from_sqlite(hours=24, metric="cpu"):
    """Consulta la evolución histórica de procesos agrupados en las últimas 24h (Top 6 + Otros)."""
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    try:
        hours_val = max(1, min(int(hours or 24), 24))
    except Exception:
        hours_val = 24
    metric_key = str(metric or "cpu").strip().lower()
    if metric_key not in ("cpu", "ram", "vram", "io"):
        metric_key = "cpu"
    unit_map = {"cpu": "%", "ram": "MB", "vram": "MB", "io": "MB/s"}
    unit = unit_map[metric_key]
    now_ts = time.time()
    cutoff_ts = now_ts - (hours_val * 3600.0)

    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT ts, proc_name, cpu_pct, ram_mb, vram_mb, io_bps
                FROM process_history
                WHERE ts >= ?
                ORDER BY ts ASC
            """, (cutoff_ts,)).fetchall()
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "metric": metric_key,
                "unit": unit,
                "hours": hours_val,
                "bucket_count": 0,
                "total_snapshots": 0,
                "oldest_ts": None,
                "newest_ts": None,
                "timestamps": [],
                "date_timestamps": [],
                "epoch_ts": [],
                "series": [],
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    if not rows:
        return {
            "ok": True,
            "metric": metric_key,
            "unit": unit,
            "hours": hours_val,
            "bucket_count": 0,
            "total_snapshots": 0,
            "oldest_ts": None,
            "newest_ts": None,
            "timestamps": [],
            "date_timestamps": [],
            "epoch_ts": [],
            "series": [],
        }

    # Agrupar snapshots por ts y construir cubetas adaptativas (hasta ~96 cubetas para legibilidad)
    snapshots_by_ts = {}
    proc_scores = {}
    for r in rows:
        ts_v = float(r["ts"] or 0.0)
        pname = str(r["proc_name"] or "")
        if not pname:
            continue
        if metric_key == "cpu":
            val = float(r["cpu_pct"] or 0.0)
        elif metric_key == "ram":
            val = float(r["ram_mb"] or 0.0)
        elif metric_key == "vram":
            val = float(r["vram_mb"] or 0.0)
        else:
            val = float(r["io_bps"] or 0.0) / (1024.0 * 1024.0)
        snap = snapshots_by_ts.setdefault(ts_v, {})
        snap[pname] = snap.get(pname, 0.0) + max(0.0, val)
        proc_scores[pname] = proc_scores.get(pname, 0.0) + max(0.0, val)

    sorted_ts = sorted(snapshots_by_ts.keys())
    if not sorted_ts:
        return {
            "ok": True,
            "metric": metric_key,
            "unit": unit,
            "hours": hours_val,
            "bucket_count": 0,
            "total_snapshots": 0,
            "oldest_ts": None,
            "newest_ts": None,
            "timestamps": [],
            "date_timestamps": [],
            "epoch_ts": [],
            "series": [],
        }

    top_procs = [
        name for name, _ in sorted(proc_scores.items(), key=lambda kv: kv[1], reverse=True)[:6]
    ]
    top_set = set(top_procs)

    max_buckets = 96
    buckets = []
    if len(sorted_ts) <= max_buckets:
        for ts_v in sorted_ts:
            buckets.append((ts_v, snapshots_by_ts[ts_v]))
    else:
        span_total = max(1.0, sorted_ts[-1] - sorted_ts[0])
        step = span_total / float(max_buckets)
        for idx in range(max_buckets):
            b_start = sorted_ts[0] + idx * step
            b_end = sorted_ts[0] + (idx + 1) * step + (0.01 if idx == max_buckets - 1 else 0.0)
            chunk_ts = [t for t in sorted_ts if b_start <= t < b_end]
            if not chunk_ts:
                continue
            avg_map = {}
            all_names = set()
            for t in chunk_ts:
                all_names.update(snapshots_by_ts[t].keys())
            for pname in all_names:
                avg_map[pname] = sum(snapshots_by_ts[t].get(pname, 0.0) for t in chunk_ts) / float(len(chunk_ts))
            buckets.append((chunk_ts[-1], avg_map))

    timestamps = []
    date_timestamps = []
    epoch_ts = []
    series_arrays = {p: [] for p in top_procs}
    others_arr = []

    for b_ts, b_map in buckets:
        dt_obj = datetime.fromtimestamp(b_ts)
        timestamps.append(dt_obj.strftime("%H:%M"))
        date_timestamps.append(dt_obj.strftime("%d/%m %H:%M"))
        epoch_ts.append(round(b_ts, 1))
        for p in top_procs:
            series_arrays[p].append(round(float(b_map.get(p, 0.0)), 2))
        other_sum = sum(v for k, v in b_map.items() if k not in top_set)
        others_arr.append(round(float(other_sum), 2))

    series_out = []
    for idx, p in enumerate(top_procs):
        arr = series_arrays[p]
        n = max(1, len(arr))
        series_out.append({
            "id": p,
            "label": p,
            "is_others": False,
            "color": _PROC_HIST_COLORS[idx % len(_PROC_HIST_COLORS)],
            "avg": round(sum(arr) / float(n), 2),
            "peak": round(max(arr) if arr else 0.0, 2),
            "last": round(arr[-1] if arr else 0.0, 2),
            "data": arr,
        })

    if any(v > 0 for v in others_arr):
        n = max(1, len(others_arr))
        series_out.append({
            "id": "__others__",
            "label": "",
            "is_others": True,
            "color": "#64748b",
            "avg": round(sum(others_arr) / float(n), 2),
            "peak": round(max(others_arr) if others_arr else 0.0, 2),
            "last": round(others_arr[-1] if others_arr else 0.0, 2),
            "data": others_arr,
        })

    return {
        "ok": True,
        "metric": metric_key,
        "unit": unit,
        "hours": hours_val,
        "bucket_count": len(buckets),
        "total_snapshots": len(sorted_ts),
        "oldest_ts": round(sorted_ts[0], 1),
        "newest_ts": round(sorted_ts[-1], 1),
        "timestamps": timestamps,
        "date_timestamps": date_timestamps,
        "epoch_ts": epoch_ts,
        "series": series_out,
    }


def _read_resolv_nameservers():
    servers = []
    try:
        with open("/etc/resolv.conf", "r", encoding="utf-8") as f:
            for line in f:
                ln = line.strip()
                if not ln or ln.startswith("#"):
                    continue
                parts = ln.split()
                if len(parts) >= 2 and parts[0].lower() == "nameserver":
                    ip = parts[1].strip()
                    if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip) and not ip.startswith("127.") and ip not in servers:
                        servers.append(ip)
    except Exception:
        pass
    return servers


def _probe_host_rtt_ms(ip, tcp_port=None):
    """Mide latencia real ICMP o handshake TCP en milisegundos hacia un nodo activo."""
    try:
        proc = subprocess.run(
            ["ping", "-n", "-c", "1", "-W", "1", ip],
            capture_output=True,
            text=True,
            timeout=1.8,
        )
        if proc.returncode == 0 and proc.stdout:
            m = re.search(r"time[=<]([0-9.]+)\s*ms", proc.stdout)
            if m:
                return round(float(m.group(1)), 2)
    except Exception:
        pass
    ports = [int(tcp_port)] if tcp_port and int(tcp_port) > 0 else [443, 53, 80]
    for port in ports:
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1.2)
            t0 = time.perf_counter()
            err = sock.connect_ex((ip, port))
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            if err in (0, 111, 10061) and elapsed_ms < 1150.0:
                return round(elapsed_ms, 2)
        except Exception:
            pass
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass
    return None


def fetch_ping_latency_worker():
    """Sondea dinámicamente la puerta de enlace y nodos externos activos cada 5s (Zero-Hardcoding)."""
    global PING_LATENCY_CACHE
    target_palette = ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4"]
    time.sleep(2.0)
    last_db_prune = 0.0
    while True:
        try:
            targets_spec = []
            seen_ips = set()
            gw_ip = _detect_default_gateway_ip()
            with WIFI_LOCK:
                wifi_sum = dict(WIFI_CACHE.get("summary", {}))
            if gw_ip:
                gw_label = wifi_sum.get("gateway_name") or wifi_sum.get("router_model") or gw_ip
                targets_spec.append({
                    "id": f"gw_{gw_ip}",
                    "ip": gw_ip,
                    "label": str(gw_label),
                    "kind": "gateway",
                    "port": 80,
                })
                seen_ips.add(gw_ip)

            with CONNECTIONS_MAP_LOCK:
                conns = list(CONNECTIONS_MAP_CACHE.get("connections", []))
            for c in conns:
                if len(targets_spec) >= 4:
                    break
                if c.get("is_server_node") or c.get("is_lan"):
                    continue
                rip = str(c.get("remote_ip") or c.get("ip") or "").strip()
                if not rip or rip in seen_ips or not re.match(r"^\d+\.\d+\.\d+\.\d+$", rip):
                    continue
                seen_ips.add(rip)
                lbl = str(c.get("domain") or c.get("isp") or c.get("org") or c.get("service") or rip).strip()
                if len(lbl) > 26:
                    lbl = f"{lbl[:23]}..."
                targets_spec.append({
                    "id": f"ext_{rip}",
                    "ip": rip,
                    "label": lbl,
                    "kind": "external",
                    "port": int(c.get("remote_port") or c.get("port") or 443),
                })

            for dns_ip in _read_resolv_nameservers():
                if len(targets_spec) >= 5:
                    break
                if dns_ip in seen_ips:
                    continue
                seen_ips.add(dns_ip)
                targets_spec.append({
                    "id": f"dns_{dns_ip}",
                    "ip": dns_ip,
                    "label": f"DNS {dns_ip}",
                    "kind": "dns",
                    "port": 53,
                })

            now_ts = time.time()
            time_str = datetime.fromtimestamp(now_ts).strftime("%H:%M:%S")
            results_map = {}
            for spec in targets_spec:
                rtt = _probe_host_rtt_ms(spec["ip"], spec.get("port"))
                results_map[spec["id"]] = (spec, rtt)

            with PING_LATENCY_LOCK:
                _PING_HISTORY_POINTS.append({
                    "ts": round(now_ts, 2),
                    "time_str": time_str,
                    "values": {tid: rtt for tid, (_, rtt) in results_map.items()},
                })
                cutoff_20m = now_ts - 1200.0
                while _PING_HISTORY_POINTS and _PING_HISTORY_POINTS[0]["ts"] < cutoff_20m:
                    _PING_HISTORY_POINTS.pop(0)

                timestamps = [pt["time_str"] for pt in _PING_HISTORY_POINTS]
                epoch_ts = [pt["ts"] for pt in _PING_HISTORY_POINTS]
                targets_out = []
                for idx, spec in enumerate(targets_spec):
                    tid = spec["id"]
                    raw_vals = [pt["values"].get(tid) for pt in _PING_HISTORY_POINTS]
                    valid_vals = [float(v) for v in raw_vals if isinstance(v, (int, float)) and v >= 0]
                    total_pts = max(1, len(raw_vals))
                    loss_pct = round(((len(raw_vals) - len(valid_vals)) / float(total_pts)) * 100.0, 1)
                    avg_ms = round(sum(valid_vals) / float(len(valid_vals)), 2) if valid_vals else None
                    min_ms = round(min(valid_vals), 2) if valid_vals else None
                    max_ms = round(max(valid_vals), 2) if valid_vals else None
                    last_ms = round(float(raw_vals[-1]), 2) if raw_vals and isinstance(raw_vals[-1], (int, float)) and raw_vals[-1] >= 0 else None
                    jitter_ms = 0.0
                    if len(valid_vals) >= 2:
                        diffs = [abs(valid_vals[i] - valid_vals[i - 1]) for i in range(1, len(valid_vals))]
                        jitter_ms = round(sum(diffs) / float(len(diffs)), 2)
                    data_clean = [round(float(v), 2) if isinstance(v, (int, float)) and v >= 0 else 0.0 for v in raw_vals]
                    targets_out.append({
                        "id": tid,
                        "ip": spec["ip"],
                        "label": spec["label"],
                        "kind": spec["kind"],
                        "avg_ms": avg_ms,
                        "last_ms": last_ms,
                        "min_ms": min_ms,
                        "max_ms": max_ms,
                        "jitter_ms": jitter_ms,
                        "loss_pct": loss_pct,
                        "color": target_palette[idx % len(target_palette)],
                        "data": data_clean,
                    })
                PING_LATENCY_CACHE = {
                    "updated_at": time_str,
                    "timestamps": timestamps,
                    "epoch_ts": epoch_ts,
                    "targets": targets_out,
                }

            if results_map:
                if not _TELEMETRY_HISTORY_INITIALIZED:
                    init_geoip_history_db()
                db_rows = [
                    (
                        round(now_ts, 2),
                        tid,
                        spec["ip"],
                        spec["label"],
                        spec["kind"],
                        float(rtt) if rtt is not None else -1.0,
                        0.0 if rtt is not None else 100.0,
                    )
                    for tid, (spec, rtt) in results_map.items()
                ]
                with GEOIP_HISTORY_DB_LOCK:
                    conn = None
                    try:
                        conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
                        conn.executemany("""
                            INSERT OR REPLACE INTO ping_history (ts, target_id, target_ip, label, kind, rtt_ms, loss_pct)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, db_rows)
                        if now_ts - last_db_prune > 120.0:
                            del_age = conn.execute("DELETE FROM ping_history WHERE ts < ?", (now_ts - (7 * 86400.0),)).rowcount or 0
                            del_cap = 0
                            cnt_p = conn.execute("SELECT COUNT(*) FROM ping_history").fetchone()[0]
                            if cnt_p > 180000:
                                cut_row = conn.execute("SELECT ts FROM ping_history ORDER BY ts DESC LIMIT 1 OFFSET 180000").fetchone()
                                if cut_row and cut_row[0] is not None:
                                    del_cap = conn.execute("DELETE FROM ping_history WHERE ts < ?", (cut_row[0],)).rowcount or 0
                            if (del_age + del_cap) > 5000:
                                conn.commit()
                                conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
                            last_db_prune = now_ts
                        conn.commit()
                    except Exception:
                        pass
                    finally:
                        if conn is not None:
                            try:
                                conn.close()
                            except Exception:
                                pass
        except Exception:
            pass
        time.sleep(5.0)


def query_speedtest_history_from_sqlite(limit=100):
    """Consulta el historial de tests de velocidad persistido en recursos_history.db."""
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT id, ts, created_at, download_mbps, upload_mbps, ping_ms, jitter_ms,
                       packet_loss_pct, server_name, server_host, server_location,
                       client_ip, isp, duration_ms, scope
                FROM speedtest_history
                ORDER BY ts DESC, id DESC
                LIMIT ?
            """, (max(1, min(int(limit or 100), 500)),)).fetchall()
            items = [dict(r) for r in rows]
            best_dl = max((float(x.get("download_mbps") or 0.0) for x in items), default=0.0)
            best_ul = max((float(x.get("upload_mbps") or 0.0) for x in items), default=0.0)
            avg_ping = round(sum(float(x.get("ping_ms") or 0.0) for x in items) / float(len(items)), 2) if items else 0.0
            return {
                "ok": True,
                "db_file": "recursos_history.db",
                "total": len(items),
                "best_download_mbps": round(best_dl, 2),
                "best_upload_mbps": round(best_ul, 2),
                "avg_ping_ms": avg_ping,
                "items": items,
            }
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "db_file": "recursos_history.db",
                "total": 0,
                "best_download_mbps": 0.0,
                "best_upload_mbps": 0.0,
                "avg_ping_ms": 0.0,
                "items": [],
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def delete_speedtest_history_from_sqlite(entry_id=None):
    """Elimina uno o todos los registros de speedtest_history en recursos_history.db."""
    if not _TELEMETRY_HISTORY_INITIALIZED:
        init_geoip_history_db()
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
            if entry_id is not None:
                cur = conn.execute("DELETE FROM speedtest_history WHERE id = ?", (int(entry_id),))
            else:
                cur = conn.execute("DELETE FROM speedtest_history")
            deleted = cur.rowcount or 0
            conn.commit()
            return True, deleted
        except Exception:
            return False, 0
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def _run_ookla_cli_speedtest():
    """Ejecuta el binario oficial Ookla Speedtest CLI si está disponible en el sistema."""
    ookla_bin = shutil.which("speedtest")
    if not ookla_bin:
        return None
    try:
        ver_proc = subprocess.run([ookla_bin, "--version"], capture_output=True, text=True, timeout=4.0)
        ver_out = (ver_proc.stdout or "") + (ver_proc.stderr or "")
        if "ookla" not in ver_out.lower():
            return None
    except Exception:
        return None

    proc = subprocess.Popen(
        [ookla_bin, "--accept-license", "--accept-gdpr", "--progress=yes", "--format=jsonl"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    final_result = None
    last_ping = 0.0
    last_jitter = 0.0
    try:
        assert proc.stdout is not None
        for raw_line in proc.stdout:
            line = (raw_line or "").strip()
            if not line or not line.startswith("{"):
                continue
            try:
                evt = json.loads(line)
            except Exception:
                continue
            etype = str(evt.get("type") or "")
            if etype == "testStart":
                srv = evt.get("server") or {}
                iface = evt.get("interface") or {}
                loc_parts = [str(srv.get("location") or ""), str(srv.get("country") or "")]
                with SPEEDTEST_LOCK:
                    SPEEDTEST_STATE.update({
                        "server_name": f"Speedtest · {srv.get('name') or 'Ookla'}",
                        "server_host": str(srv.get("host") or "speedtest.net"),
                        "server_location": ", ".join(p for p in loc_parts if p),
                        "isp": str(evt.get("isp") or SPEEDTEST_STATE.get("isp") or ""),
                        "client_ip": str(iface.get("externalIp") or SPEEDTEST_STATE.get("client_ip") or ""),
                        "scope": "wan",
                    })
            elif etype == "ping":
                pobj = evt.get("ping") or {}
                last_ping = round(float(pobj.get("latency") or 0.0), 2)
                last_jitter = round(float(pobj.get("jitter") or 0.0), 2)
                prog = float(pobj.get("progress") or 0.0)
                with SPEEDTEST_LOCK:
                    SPEEDTEST_STATE.update({
                        "phase": "ping",
                        "ping_ms": last_ping,
                        "jitter_ms": last_jitter,
                        "progress_pct": max(8, min(20, 8 + int(prog * 12))),
                    })
            elif etype == "download":
                dobj = evt.get("download") or {}
                mbps = round((float(dobj.get("bandwidth") or 0.0) * 8.0) / 1_000_000.0, 2)
                prog = float(dobj.get("progress") or 0.0)
                with SPEEDTEST_LOCK:
                    SPEEDTEST_STATE.update({
                        "phase": "download",
                        "current_mbps": mbps,
                        "download_mbps": mbps,
                        "progress_pct": max(22, min(60, 22 + int(prog * 38))),
                    })
            elif etype == "upload":
                uobj = evt.get("upload") or {}
                mbps = round((float(uobj.get("bandwidth") or 0.0) * 8.0) / 1_000_000.0, 2)
                prog = float(uobj.get("progress") or 0.0)
                with SPEEDTEST_LOCK:
                    SPEEDTEST_STATE.update({
                        "phase": "upload",
                        "current_mbps": mbps,
                        "upload_mbps": mbps,
                        "progress_pct": max(62, min(96, 62 + int(prog * 34))),
                    })
            elif etype == "result":
                pobj = evt.get("ping") or {}
                dobj = evt.get("download") or {}
                uobj = evt.get("upload") or {}
                srv = evt.get("server") or {}
                iface = evt.get("interface") or {}
                loc_parts = [str(srv.get("location") or ""), str(srv.get("country") or "")]
                final_result = {
                    "download_mbps": round((float(dobj.get("bandwidth") or 0.0) * 8.0) / 1_000_000.0, 2),
                    "upload_mbps": round((float(uobj.get("bandwidth") or 0.0) * 8.0) / 1_000_000.0, 2),
                    "ping_ms": round(float(pobj.get("latency") or last_ping), 2),
                    "jitter_ms": round(float(pobj.get("jitter") or last_jitter), 2),
                    "packet_loss_pct": round(float(evt.get("packetLoss") or 0.0), 1),
                    "server_name": f"Speedtest · {srv.get('name') or 'Ookla'}",
                    "server_host": str(srv.get("host") or "speedtest.net"),
                    "server_location": ", ".join(p for p in loc_parts if p),
                    "client_ip": str(iface.get("externalIp") or ""),
                    "isp": str(evt.get("isp") or ""),
                    "scope": "wan",
                }
        proc.wait(timeout=45)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    return final_result if (proc.returncode == 0 and final_result) else None


def _run_speedtest_cli_python(default_client_ip="", default_isp=""):
    """Ejecuta speedtest-cli (paquete Python/APT) si está instalado."""
    import importlib.util
    cli_bin = shutil.which("speedtest-cli")
    cmd = None
    if cli_bin:
        cmd = [cli_bin, "--json"]
    elif importlib.util.find_spec("speedtest") is not None:
        import sys
        cmd = [sys.executable, "-m", "speedtest", "--json"]
    else:
        st_bin = shutil.which("speedtest")
        if st_bin:
            try:
                v = subprocess.run([st_bin, "--version"], capture_output=True, text=True, timeout=4.0)
                if "ookla" not in ((v.stdout or "") + (v.stderr or "")).lower():
                    cmd = [st_bin, "--json"]
            except Exception:
                pass
    if not cmd:
        return None

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    t_started = time.perf_counter()
    try:
        while proc.poll() is None:
            el = time.perf_counter() - t_started
            with SPEEDTEST_LOCK:
                if el < 4.0:
                    SPEEDTEST_STATE["phase"] = "ping"
                    SPEEDTEST_STATE["progress_pct"] = min(20, 8 + int(el * 3))
                elif el < 14.0:
                    SPEEDTEST_STATE["phase"] = "download"
                    SPEEDTEST_STATE["progress_pct"] = min(60, 22 + int((el - 4.0) * 3.8))
                else:
                    SPEEDTEST_STATE["phase"] = "upload"
                    SPEEDTEST_STATE["progress_pct"] = min(94, 62 + int((el - 14.0) * 2.5))
            if el > 50.0:
                proc.kill()
                return None
            time.sleep(0.35)
        out, _ = proc.communicate(timeout=2.0)
        if proc.returncode != 0 or not out:
            return None
        data = json.loads(out)
        srv = data.get("server") or {}
        cli = data.get("client") or {}
        sponsor = str(srv.get("sponsor") or srv.get("name") or "Speedtest.net")
        loc_parts = [str(srv.get("name") or ""), str(srv.get("country") or "")]
        return {
            "download_mbps": round(float(data.get("download") or 0.0) / 1_000_000.0, 2),
            "upload_mbps": round(float(data.get("upload") or 0.0) / 1_000_000.0, 2),
            "ping_ms": round(float(data.get("ping") or 0.0), 2),
            "jitter_ms": 0.0,
            "packet_loss_pct": 0.0,
            "server_name": f"Speedtest · {sponsor}",
            "server_host": str(srv.get("host") or "speedtest.net"),
            "server_location": ", ".join(p for p in loc_parts if p),
            "client_ip": str(cli.get("ip") or default_client_ip or ""),
            "isp": str(cli.get("isp") or default_isp or ""),
            "scope": "wan",
        }
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        return None


def _read_wan_iface_bytes():
    """Lee contadores reales RX/TX del kernel en /proc/net/dev excluyendo interfaces virtuales y loopback."""
    rx_total = 0
    tx_total = 0
    try:
        with open("/proc/net/dev", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if ":" not in line:
                    continue
                iface, rest = line.split(":", 1)
                iface = iface.strip()
                if not iface or iface == "lo" or iface.startswith(("docker", "veth", "br-", "virbr", "tun", "tap", "wg", "tailscale")):
                    continue
                fields = rest.split()
                if len(fields) >= 9:
                    rx_total += int(fields[0])
                    tx_total += int(fields[8])
    except Exception:
        pass
    return rx_total, tx_total


def _compute_sustained_speed_mbps(samples, total_app_bytes, total_elapsed_sec, nic_delta_bytes=0):
    """
    Calcula la velocidad sostenida al estilo Ookla Speedtest:
    - Descarta los primeros ~800 ms de rampa TCP slow-start si hay suficientes muestras.
    - Promedia los intervalos estabilizados del tramo superior (top 70% tras slow-start) para reflejar el caudal real de la fibra.
    - Contrasta con los bytes físicos medidos en la interfaz de red del kernel (/proc/net/dev).
    """
    effective_total_bytes = max(int(total_app_bytes), int(nic_delta_bytes))
    raw_avg_mbps = (effective_total_bytes * 8.0) / (max(0.05, total_elapsed_sec) * 1_000_000.0)
    if len(samples) < 4:
        return round(raw_avg_mbps, 2)

    t0 = samples[0][0]
    intervals_mbps = []
    post_warmup_bytes = 0
    post_warmup_time = 0.0

    for i in range(1, len(samples)):
        t_prev, b_prev = samples[i - 1]
        t_cur, b_cur = samples[i]
        dt = t_cur - t_prev
        db = max(0, b_cur - b_prev)
        if dt <= 0.02:
            continue
        inst_mbps = (db * 8.0) / (dt * 1_000_000.0)
        if (t_cur - t0) >= 0.75:
            intervals_mbps.append(inst_mbps)
            post_warmup_bytes += db
            post_warmup_time += dt

    sustained_post_warmup = (
        (post_warmup_bytes * 8.0) / (post_warmup_time * 1_000_000.0)
        if post_warmup_time >= 0.6
        else raw_avg_mbps
    )

    if len(intervals_mbps) >= 3:
        sorted_ints = sorted(intervals_mbps, reverse=True)
        # Eliminar pico aislado superior si supera >1.65x la mediana para evitar artefactos de buffer
        median_int = sorted_ints[len(sorted_ints) // 2]
        filtered_ints = [x for x in sorted_ints if x <= max(median_int * 1.65, raw_avg_mbps * 1.5)] or sorted_ints
        keep_n = max(2, int(round(len(filtered_ints) * 0.7)))
        top_window_mbps = sum(filtered_ints[:keep_n]) / float(keep_n)
        best_est = max(raw_avg_mbps, sustained_post_warmup, top_window_mbps * 0.96)
    else:
        best_est = max(raw_avg_mbps, sustained_post_warmup)

    if nic_delta_bytes > total_app_bytes and total_app_bytes > 0:
        nic_ratio = min(1.22, float(nic_delta_bytes) / float(total_app_bytes))
        best_est = max(best_est, sustained_post_warmup * nic_ratio)

    return round(best_est, 2)


def _run_speedtest_worker():
    """Ejecuta medición real Speedtest calibrada para líneas de fibra de alta velocidad y guarda en SQLite."""
    from concurrent.futures import ThreadPoolExecutor
    from requests.adapters import HTTPAdapter

    t_start = time.perf_counter()
    with SPEEDTEST_LOCK:
        SPEEDTEST_STATE.update({
            "running": True,
            "phase": "ping",
            "progress_pct": 6,
            "current_mbps": 0.0,
            "ping_ms": 0.0,
            "jitter_ms": 0.0,
            "packet_loss_pct": 0.0,
            "download_mbps": 0.0,
            "upload_mbps": 0.0,
            "server_name": "",
            "server_host": "",
            "server_location": "",
            "client_ip": "",
            "isp": "",
            "scope": "wan",
            "error": "",
            "started_at": time.time(),
        })
    try:
        server_name = HOSTNAME or socket.gethostname()
        server_host = "127.0.0.1"
        server_location = ""
        client_ip = SERVER_LOCAL_IP
        isp_name = ""
        with GEOIP_LOCK:
            if SERVER_SELF_GEO:
                client_ip = str(SERVER_SELF_GEO.get("ip") or SERVER_LOCAL_IP)
                isp_name = str(SERVER_SELF_GEO.get("isp") or SERVER_SELF_GEO.get("org") or "")
                city_s = str(SERVER_SELF_GEO.get("city") or "")
                country_s = str(SERVER_SELF_GEO.get("country") or "")
                server_location = ", ".join(x for x in (city_s, country_s) if x)

        # Prioridad 1: Binario nativo C++ oficial de Ookla (si está instalado en el sistema)
        cli_result = _run_ookla_cli_speedtest()

        if cli_result is not None:
            download_mbps = cli_result["download_mbps"]
            upload_mbps = cli_result["upload_mbps"]
            ping_ms = cli_result["ping_ms"]
            jitter_ms = cli_result["jitter_ms"]
            loss_pct = cli_result["packet_loss_pct"]
            server_name = cli_result["server_name"]
            server_host = cli_result["server_host"]
            server_location = cli_result["server_location"] or server_location
            client_ip = cli_result["client_ip"] or client_ip
            isp_name = cli_result["isp"] or isp_name
            scope = cli_result["scope"]
        else:
            # Prioridad 2: Motor nativo multi-stream de alta capacidad con sesiones HTTP Keep-Alive
            # (El antiguo script Python speedtest-cli de APT limita líneas de fibra por ser monohilo/GIL;
            #  se relega únicamente como respaldo final si fallase el motor multi-stream).
            st_headers = {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": "https://www.speedtest.net/",
                "Accept": "application/json,text/plain,*/*",
                "Cache-Control": "no-cache, no-store",
                "Pragma": "no-cache",
            }
            selected_base = None
            selected_upload_url = None
            wan_provider = None

            ctl_session = requests.Session()
            ctl_session.headers.update(st_headers)
            ctl_adapter = HTTPAdapter(pool_connections=16, pool_maxsize=16)
            ctl_session.mount("https://", ctl_adapter)
            ctl_session.mount("http://", ctl_adapter)

            # Obtener ISP/IP desde speedtest-config.php si es accesible
            try:
                cr = ctl_session.get("https://www.speedtest.net/speedtest-config.php", timeout=3.0)
                if cr.status_code == 200 and cr.text:
                    cfg_root = ET.fromstring(cr.text)
                    cli_node = cfg_root.find("client")
                    if cli_node is not None:
                        client_ip = str(cli_node.attrib.get("ip") or client_ip)
                        isp_name = str(cli_node.attrib.get("isp") or isp_name)
            except Exception:
                pass

            # Descubrir servidores cercanos de Speedtest.net y elegir el de menor latencia en paralelo
            candidates = []
            for api_url in (
                "https://www.speedtest.net/api/js/servers?engine=js&https_functional=true&limit=10",
                "https://www.speedtest.net/api/js/servers?engine=js&limit=10",
            ):
                try:
                    sr = ctl_session.get(api_url, timeout=3.5)
                    if sr.status_code == 200:
                        data = sr.json()
                        if isinstance(data, list) and data:
                            candidates = data
                            break
                except Exception:
                    continue

            def _probe_candidate(srv):
                raw_up = str(srv.get("url") or "").strip()
                if not raw_up or "/" not in raw_up:
                    return None
                try_urls = [raw_up]
                if raw_up.startswith("http://") and srv.get("https_functional"):
                    try_urls.insert(0, "https://" + raw_up[7:])
                for up_cand in try_urls:
                    base_cand = up_cand.rsplit("/", 1)[0]
                    lat_url = f"{base_cand}/latency.txt?x={int(time.time() * 1000)}"
                    try:
                        # 2 peticiones consecutivas en Keep-Alive para medir RTT real sin penalización DNS/TLS
                        ctl_session.get(lat_url, timeout=1.8)
                        p0 = time.perf_counter()
                        r2 = ctl_session.get(f"{base_cand}/latency.txt?x={int(time.time() * 1000)}_2", timeout=1.8)
                        if r2.status_code < 400:
                            ms = (time.perf_counter() - p0) * 1000.0
                            return (ms, srv, base_cand, up_cand)
                    except Exception:
                        continue
                return None

            best_probe = None
            if candidates:
                with ThreadPoolExecutor(max_workers=min(6, len(candidates[:8]))) as probe_pool:
                    probe_results = [p for p in probe_pool.map(_probe_candidate, candidates[:8]) if p is not None]
                if probe_results:
                    best_probe = min(probe_results, key=lambda x: x[0])

            if best_probe is not None:
                _, srv_obj, selected_base, selected_upload_url = best_probe
                wan_provider = "speedtest"
                sponsor = str(srv_obj.get("sponsor") or srv_obj.get("name") or "Speedtest.net")
                city_s = str(srv_obj.get("name") or "")
                country_s = str(srv_obj.get("country") or "")
                server_name = f"Speedtest · {sponsor}"
                server_host = urllib.parse.urlparse(selected_upload_url).hostname or "speedtest.net"
                server_location = ", ".join(p for p in (city_s, country_s) if p) or server_location
            else:
                # Respaldo WAN Cloudflare Edge si Speedtest.net estuviera bloqueado
                try:
                    cr = ctl_session.get("https://speed.cloudflare.com/__down?bytes=32768", timeout=2.5)
                    if cr.status_code == 200:
                        cf_ray = cr.headers.get("cf-ray", "")
                        colo = cf_ray.split("-")[-1] if "-" in cf_ray else ""
                        wan_provider = "cloudflare"
                        server_name = f"Cloudflare Edge ({colo})" if colo else "Cloudflare Speed Edge"
                        server_host = "speed.cloudflare.com"
                except Exception:
                    wan_provider = None

            scope = "wan" if wan_provider else "local_node"
            local_base = f"http://127.0.0.1:{ACTIVE_SERVER_PORT}/api/net/speedtest/payload"

            # 1. Ping & Jitter (8 muestras sobre sesión Keep-Alive para medir RTT de red puro sin handshake TLS)
            ping_samples = []
            ping_fails = 0
            for idx in range(8):
                if wan_provider == "speedtest" and selected_base:
                    p_url = f"{selected_base}/latency.txt?r={idx}_{int(time.time() * 1000)}"
                elif wan_provider == "cloudflare":
                    p_url = f"https://speed.cloudflare.com/__down?bytes=64&r={idx}_{int(time.time() * 1000)}"
                else:
                    p_url = f"{local_base}?bytes=64&r={idx}"
                p_t0 = time.perf_counter()
                try:
                    pr = ctl_session.get(p_url, timeout=2.0)
                    _ = pr.content
                    if idx > 0 or len(ping_samples) == 0:
                        ping_samples.append((time.perf_counter() - p_t0) * 1000.0)
                except Exception:
                    ping_fails += 1
                with SPEEDTEST_LOCK:
                    SPEEDTEST_STATE["progress_pct"] = 8 + int(((idx + 1) / 8.0) * 12)
            if len(ping_samples) > 2:
                # Descartar la primera muestra si incluye establecimiento de conexión inicial
                warm_pings = sorted(ping_samples[1:])
            else:
                warm_pings = sorted(ping_samples)
            ping_ms = round(warm_pings[len(warm_pings) // 2], 2) if warm_pings else 0.0
            jitter_ms = round(
                sum(abs(ping_samples[i] - ping_samples[i - 1]) for i in range(1, len(ping_samples))) / float(len(ping_samples) - 1),
                2,
            ) if len(ping_samples) >= 2 else 0.0
            loss_pct = round((ping_fails / 8.0) * 100.0, 1)

            with SPEEDTEST_LOCK:
                SPEEDTEST_STATE.update({
                    "phase": "download",
                    "progress_pct": 22,
                    "ping_ms": ping_ms,
                    "jitter_ms": jitter_ms,
                    "packet_loss_pct": loss_pct,
                    "server_name": server_name,
                    "server_host": server_host,
                    "server_location": server_location,
                    "client_ip": client_ip,
                    "isp": isp_name,
                    "scope": scope,
                })

            # 2. Descarga multi-stream de alta capacidad (8 flujos paralelos con Keep-Alive durante 6.5s)
            dl_duration = 6.5 if wan_provider else 2.8
            dl_workers_count = 8 if wan_provider else 4
            dl_lock = threading.Lock()
            dl_bytes = [0]
            dl_samples = []
            dl_nic_rx0, _ = _read_wan_iface_bytes()
            dl_t0 = time.perf_counter()
            dl_samples.append((dl_t0, 0))
            dl_deadline = dl_t0 + dl_duration

            def _dl_worker(worker_idx):
                sess = requests.Session()
                sess.headers.update(st_headers)
                adapter = HTTPAdapter(pool_connections=4, pool_maxsize=4)
                sess.mount("https://", adapter)
                sess.mount("http://", adapter)
                urls = (
                    [
                        f"{selected_base}/download?size=25000000&r={worker_idx}",
                        f"{selected_base}/random4000x4000.jpg?x={worker_idx}",
                        f"{selected_base}/random3500x3500.jpg?x={worker_idx}",
                        f"{selected_base}/random3000x3000.jpg?x={worker_idx}",
                    ]
                    if wan_provider == "speedtest" and selected_base
                    else (
                        ["https://speed.cloudflare.com/__down?bytes=25000000"]
                        if wan_provider == "cloudflare"
                        else [f"{local_base}?bytes=32000000"]
                    )
                )
                req_seq = 0
                try:
                    while time.perf_counter() < dl_deadline:
                        u = urls[req_seq % len(urls)]
                        req_seq += 1
                        sep = "&" if "?" in u else "?"
                        full_u = f"{u}{sep}t={int(time.time() * 1000)}_{req_seq}"
                        try:
                            with sess.get(full_u, stream=True, timeout=(2.5, 4.0)) as r:
                                if r.status_code >= 400:
                                    continue
                                for chunk in r.iter_content(chunk_size=262144):
                                    if not chunk:
                                        break
                                    now_p = time.perf_counter()
                                    with dl_lock:
                                        dl_bytes[0] += len(chunk)
                                        cur_total = dl_bytes[0]
                                        if not dl_samples or (now_p - dl_samples[-1][0]) >= 0.18:
                                            dl_samples.append((now_p, cur_total))
                                        el = max(0.08, now_p - dl_t0)
                                        live_dl = _compute_sustained_speed_mbps(dl_samples, cur_total, el)
                                    with SPEEDTEST_LOCK:
                                        SPEEDTEST_STATE["current_mbps"] = live_dl
                                        SPEEDTEST_STATE["download_mbps"] = live_dl
                                        SPEEDTEST_STATE["progress_pct"] = min(60, 22 + int((min(dl_duration, el) / dl_duration) * 38))
                                    if now_p >= dl_deadline:
                                        break
                        except Exception:
                            continue
                finally:
                    try:
                        sess.close()
                    except Exception:
                        pass

            with ThreadPoolExecutor(max_workers=dl_workers_count) as pool:
                list(pool.map(_dl_worker, range(dl_workers_count)))
            dl_t_end = time.perf_counter()
            dl_elapsed = max(0.05, dl_t_end - dl_t0)
            dl_nic_rx1, _ = _read_wan_iface_bytes()
            dl_nic_delta = max(0, dl_nic_rx1 - dl_nic_rx0) if scope == "wan" else 0
            dl_samples.append((dl_t_end, dl_bytes[0]))
            download_mbps = _compute_sustained_speed_mbps(dl_samples, dl_bytes[0], dl_elapsed, dl_nic_delta)

            with SPEEDTEST_LOCK:
                SPEEDTEST_STATE.update({
                    "phase": "upload",
                    "progress_pct": 62,
                    "download_mbps": download_mbps,
                    "current_mbps": 0.0,
                })

            # 3. Subida multi-stream de alta capacidad (6 flujos paralelos con Keep-Alive y bloques de 2 MB durante 5.5s)
            ul_duration = 5.5 if wan_provider else 2.4
            ul_workers_count = 6 if wan_provider else 4
            ul_lock = threading.Lock()
            ul_bytes = [0]
            ul_samples = []
            ul_chunk = (os.urandom(64 * 1024) * 32) if wan_provider else (b"\x00" * (8 * 1024 * 1024))
            _, ul_nic_tx0 = _read_wan_iface_bytes()
            ul_t0 = time.perf_counter()
            ul_samples.append((ul_t0, 0))
            ul_deadline = ul_t0 + ul_duration

            def _ul_worker(worker_idx):
                sess = requests.Session()
                sess.headers.update({
                    **st_headers,
                    "Content-Type": "application/octet-stream",
                })
                adapter = HTTPAdapter(pool_connections=4, pool_maxsize=4)
                sess.mount("https://", adapter)
                sess.mount("http://", adapter)
                target_u = (
                    selected_upload_url
                    if wan_provider == "speedtest" and selected_upload_url
                    else ("https://speed.cloudflare.com/__up" if wan_provider == "cloudflare" else local_base)
                )
                iter_idx = 0
                try:
                    while time.perf_counter() < ul_deadline and iter_idx < 60:
                        iter_idx += 1
                        try:
                            sep = "&" if "?" in target_u else "?"
                            post_u = f"{target_u}{sep}r={worker_idx}_{iter_idx}"
                            r = sess.post(post_u, data=ul_chunk, timeout=(2.5, 4.0))
                            if r.status_code >= 400 and wan_provider == "speedtest":
                                # Fallback a payload de 1 MB si el nodo limita el tamaño por POST
                                small_chunk = ul_chunk[:1024 * 1024]
                                r = sess.post(post_u, data=small_chunk, timeout=(2.5, 4.0))
                                sent_len = len(small_chunk) if r.status_code < 400 else 0
                            else:
                                sent_len = len(ul_chunk)
                            if sent_len <= 0:
                                continue
                            now_p = time.perf_counter()
                            with ul_lock:
                                ul_bytes[0] += sent_len
                                cur_total = ul_bytes[0]
                                if not ul_samples or (now_p - ul_samples[-1][0]) >= 0.18:
                                    ul_samples.append((now_p, cur_total))
                                el = max(0.08, now_p - ul_t0)
                                live_ul = _compute_sustained_speed_mbps(ul_samples, cur_total, el)
                            with SPEEDTEST_LOCK:
                                SPEEDTEST_STATE["current_mbps"] = live_ul
                                SPEEDTEST_STATE["upload_mbps"] = live_ul
                                SPEEDTEST_STATE["progress_pct"] = min(96, 62 + int((min(ul_duration, el) / ul_duration) * 34))
                        except Exception:
                            continue
                finally:
                    try:
                        sess.close()
                    except Exception:
                        pass

            with ThreadPoolExecutor(max_workers=ul_workers_count) as pool:
                list(pool.map(_ul_worker, range(ul_workers_count)))
            ul_t_end = time.perf_counter()
            ul_elapsed = max(0.05, ul_t_end - ul_t0)
            _, ul_nic_tx1 = _read_wan_iface_bytes()
            ul_nic_delta = max(0, ul_nic_tx1 - ul_nic_tx0) if scope == "wan" else 0
            ul_samples.append((ul_t_end, ul_bytes[0]))
            upload_mbps = _compute_sustained_speed_mbps(ul_samples, ul_bytes[0], ul_elapsed, ul_nic_delta)

            try:
                ctl_session.close()
            except Exception:
                pass

            # Respaldo de último recurso si el motor multi-stream no pudo conectar por firewall/proxy
            if download_mbps <= 0.0 and upload_mbps <= 0.0:
                py_fallback = _run_speedtest_cli_python(client_ip, isp_name)
                if py_fallback is not None:
                    download_mbps = py_fallback["download_mbps"]
                    upload_mbps = py_fallback["upload_mbps"]
                    ping_ms = py_fallback["ping_ms"] or ping_ms
                    server_name = py_fallback["server_name"] or server_name
                    server_host = py_fallback["server_host"] or server_host
                    server_location = py_fallback["server_location"] or server_location
                    client_ip = py_fallback["client_ip"] or client_ip
                    isp_name = py_fallback["isp"] or isp_name
                    scope = py_fallback["scope"]

        duration_ms = int((time.perf_counter() - t_start) * 1000)
        now_ts = time.time()
        created_at = datetime.fromtimestamp(now_ts).strftime("%Y-%m-%d %H:%M:%S")

        if not _TELEMETRY_HISTORY_INITIALIZED:
            init_geoip_history_db()
        inserted_id = 0
        with GEOIP_HISTORY_DB_LOCK:
            conn = None
            try:
                conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
                cur = conn.execute("""
                    INSERT INTO speedtest_history (
                        ts, created_at, download_mbps, upload_mbps, ping_ms, jitter_ms,
                        packet_loss_pct, server_name, server_host, server_location,
                        client_ip, isp, duration_ms, scope
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    round(now_ts, 3), created_at, download_mbps, upload_mbps, ping_ms, jitter_ms,
                    loss_pct, server_name, server_host, server_location, client_ip, isp_name, duration_ms, scope,
                ))
                inserted_id = cur.lastrowid or 0
                conn.execute("""
                    DELETE FROM speedtest_history
                    WHERE id NOT IN (SELECT id FROM speedtest_history ORDER BY ts DESC, id DESC LIMIT 500)
                """)
                conn.commit()
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass

        result_obj = {
            "id": inserted_id,
            "ts": round(now_ts, 3),
            "created_at": created_at,
            "download_mbps": download_mbps,
            "upload_mbps": upload_mbps,
            "ping_ms": ping_ms,
            "jitter_ms": jitter_ms,
            "packet_loss_pct": loss_pct,
            "server_name": server_name,
            "server_host": server_host,
            "server_location": server_location,
            "client_ip": client_ip,
            "isp": isp_name,
            "duration_ms": duration_ms,
            "scope": scope,
        }
        with SPEEDTEST_LOCK:
            SPEEDTEST_STATE.update({
                "running": False,
                "phase": "done",
                "progress_pct": 100,
                "current_mbps": upload_mbps,
                "download_mbps": download_mbps,
                "upload_mbps": upload_mbps,
                "ping_ms": ping_ms,
                "jitter_ms": jitter_ms,
                "packet_loss_pct": loss_pct,
                "server_name": server_name,
                "server_host": server_host,
                "server_location": server_location,
                "client_ip": client_ip,
                "isp": isp_name,
                "scope": scope,
                "completed_at": now_ts,
                "last_result": result_obj,
            })
    except Exception as exc:
        with SPEEDTEST_LOCK:
            SPEEDTEST_STATE.update({
                "running": False,
                "phase": "error",
                "progress_pct": 0,
                "error": str(exc),
            })

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
        conn = None
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
            global _LAST_GEOIP_PRUNE_TS
            if now - _LAST_GEOIP_PRUNE_TS >= 180.0:
                ttl_sec = globals().get("GEOIP_TTL_SECONDS", 7 * 86400)
                conn.execute("DELETE FROM geoip_locations WHERE updated_at < ?", (now - ttl_sec,))
                tot_geo = conn.execute("SELECT COUNT(*) FROM geoip_locations").fetchone()[0]
                if tot_geo > 12000:
                    conn.execute("""
                        DELETE FROM geoip_locations
                        WHERE ip NOT IN (
                            SELECT ip FROM geoip_locations ORDER BY updated_at DESC LIMIT 12000
                        )
                    """)
                _LAST_GEOIP_PRUNE_TS = now
            conn.commit()
        except Exception:
            pass
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

def record_connections_to_sqlite(connections_list):
    """Registra y actualiza en SQLite todas las conexiones públicas geolocalizadas catalogadas por servicio."""
    global _LAST_CONN_HISTORY_SAVE_TS
    if not connections_list:
        return
    now = time.time()
    if (now - _LAST_CONN_HISTORY_SAVE_TS) < 12.0:
        return
    _LAST_CONN_HISTORY_SAVE_TS = now
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
        conn = None
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
            # Mantener base de datos acotada a los 5000 flujos más recientes (poda cada 60s para evitar I/O cada 2.5s)
            global _LAST_SQLITE_PRUNE_TS
            if now - _LAST_SQLITE_PRUNE_TS >= 60.0:
                conn.execute("""
                    DELETE FROM connection_history
                    WHERE id NOT IN (
                        SELECT id FROM connection_history ORDER BY last_seen DESC LIMIT 5000
                    )
                """)
                _LAST_SQLITE_PRUNE_TS = now
            conn.commit()
        except Exception as e:
            print(f"[-] Error guardando historial de conexiones en SQLite: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

def query_connection_history_from_sqlite(service_filter=None, device_filter=None, direction_filter=None, search_query=None, hours_filter=None, limit=300, lang=None):
    """Consulta el historial de conexiones geolocalizadas, traducciones IA y catálogos desde recursos_history.db."""
    init_geoip_history_db()
    services_catalog = []
    countries_catalog = []
    domains_catalog = []
    devices_catalog = []
    connections = []
    ai_insights = {}
    summary = {
        "total_records": 0,
        "total_services": 0,
        "total_unique_ips": 0,
        "total_devices": 0,
        "total_countries": 0,
        "total_domains": 0,
        "total_hits": 0
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
        conn = None
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
                    COUNT(DISTINCT local_ip) AS total_devices,
                    COUNT(DISTINCT CASE WHEN TRIM(country) != '' THEN TRIM(country) ELSE NULL END) AS total_countries,
                    COUNT(DISTINCT CASE WHEN TRIM(domain) != '' THEN LOWER(TRIM(domain)) ELSE NULL END) AS total_domains,
                    COALESCE(SUM(hit_count), 0) AS total_hits
                FROM connection_history
            """)
            s_row = cur.fetchone()
            if s_row:
                summary = {
                    "total_records": int(s_row["total_records"] or 0),
                    "total_services": int(s_row["total_services"] or 0),
                    "total_unique_ips": int(s_row["total_unique_ips"] or 0),
                    "total_devices": int(s_row["total_devices"] or 0),
                    "total_countries": int(s_row["total_countries"] or 0),
                    "total_domains": int(s_row["total_domains"] or 0),
                    "total_hits": int(s_row["total_hits"] or 0)
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
                ORDER BY total_hits DESC, last_seen DESC
                LIMIT 120
            """, svc_params)
            for r in cur.fetchall():
                countries_list = [x.strip() for x in str(r["countries_csv"] or "").split(",") if x.strip()][:5]
                domains_list = [x.strip() for x in str(r["domains_csv"] or "").split(",") if x.strip()][:4]
                services_catalog.append({
                    "service": str(r["service"] or ""),
                    "connections_count": int(r["connections_count"] or 0),
                    "total_hits": int(r["total_hits"] or 0),
                    "hit_count": int(r["total_hits"] or 0),
                    "unique_ips": int(r["unique_ips"] or 0),
                    "unique_devices": int(r["unique_devices"] or 0),
                    "countries": countries_list,
                    "sample_domains": domains_list,
                    "first_seen": float(r["first_seen"] or 0),
                    "last_seen": float(r["last_seen"] or 0)
                })

            # 2b. Catálogo de países con más conexiones e impactos
            country_where = list(svc_where)
            country_where.append("(TRIM(country) != '' OR TRIM(country_code) != '')")
            country_where_sql = "WHERE " + " AND ".join(country_where)
            cur.execute(f"""
                SELECT
                    TRIM(country) AS country_name,
                    MAX(UPPER(TRIM(country_code))) AS country_code,
                    COUNT(*) AS connections_count,
                    SUM(hit_count) AS total_hits,
                    COUNT(DISTINCT remote_ip) AS unique_ips,
                    COUNT(DISTINCT CASE WHEN TRIM(city) != '' THEN TRIM(city) ELSE NULL END) AS cities_count,
                    COUNT(DISTINCT local_ip) AS unique_devices,
                    MAX(last_seen) AS last_seen
                FROM connection_history
                {country_where_sql}
                GROUP BY UPPER(TRIM(CASE WHEN TRIM(country_code) != '' THEN country_code ELSE country END))
                ORDER BY total_hits DESC, connections_count DESC
                LIMIT 60
            """, svc_params)
            for r in cur.fetchall():
                countries_catalog.append({
                    "country": str(r["country_name"] or r["country_code"] or ""),
                    "country_code": str(r["country_code"] or "").upper(),
                    "connections_count": int(r["connections_count"] or 0),
                    "total_hits": int(r["total_hits"] or 0),
                    "unique_ips": int(r["unique_ips"] or 0),
                    "cities_count": int(r["cities_count"] or 0),
                    "unique_devices": int(r["unique_devices"] or 0),
                    "last_seen": float(r["last_seen"] or 0)
                })

            # 2c. Catálogo de dominios más contactados en el historial
            dom_where = list(svc_where)
            dom_where.append("TRIM(domain) != ''")
            dom_where_sql = "WHERE " + " AND ".join(dom_where)
            cur.execute(f"""
                SELECT
                    LOWER(TRIM(domain)) AS domain_name,
                    COUNT(*) AS connections_count,
                    SUM(hit_count) AS total_hits,
                    COUNT(DISTINCT remote_ip) AS unique_ips,
                    COUNT(DISTINCT local_ip) AS unique_devices,
                    MAX(service) AS top_service,
                    MAX(country) AS top_country,
                    MAX(UPPER(TRIM(country_code))) AS top_country_code,
                    MAX(last_seen) AS last_seen
                FROM connection_history
                {dom_where_sql}
                GROUP BY domain_name
                ORDER BY total_hits DESC, connections_count DESC
                LIMIT 80
            """, svc_params)
            for r in cur.fetchall():
                domains_catalog.append({
                    "domain": str(r["domain_name"] or ""),
                    "connections_count": int(r["connections_count"] or 0),
                    "total_hits": int(r["total_hits"] or 0),
                    "unique_ips": int(r["unique_ips"] or 0),
                    "unique_devices": int(r["unique_devices"] or 0),
                    "top_service": str(r["top_service"] or ""),
                    "top_country": str(r["top_country"] or ""),
                    "top_country_code": str(r["top_country_code"] or ""),
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
            lang_clean = str(lang or "").strip().lower()[:8]
            if lang_clean:
                cur.execute(
                    """
                    SELECT signature, app_name, category, role, summary, confidence, model, analyzed_at
                    FROM ai_connection_insights
                    WHERE lang = ?
                    ORDER BY analyzed_at DESC
                    LIMIT 500
                    """,
                    (lang_clean,)
                )
            else:
                cur.execute(
                    """
                    SELECT signature, app_name, category, role, summary, confidence, model, analyzed_at
                    FROM ai_connection_insights
                    ORDER BY analyzed_at DESC
                    LIMIT 500
                    """
                )
            for ar in cur.fetchall():
                sig_k = str(ar["signature"] or "").strip()
                if not sig_k or sig_k in ai_insights:
                    continue
                ai_insights[sig_k] = {
                    "signature": sig_k,
                    "app_name": str(ar["app_name"] or ""),
                    "category": str(ar["category"] or ""),
                    "role": str(ar["role"] or ""),
                    "summary": str(ar["summary"] or ""),
                    "confidence": str(ar["confidence"] or "medium"),
                    "model": str(ar["model"] or ""),
                    "analyzed_at": float(ar["analyzed_at"] or 0),
                }
        except Exception as e:
            print(f"[-] Error consultando historial SQLite: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    return {
        "status": "ok",
        "summary": summary,
        "services_catalog": services_catalog,
        "countries_catalog": countries_catalog,
        "domains_catalog": domains_catalog,
        "devices_catalog": devices_catalog,
        "connections": connections,
        "ai_insights": ai_insights,
    }

def clear_connection_history_sqlite():
    """Vacía el historial de conexiones en SQLite manteniendo la caché de ubicaciones GeoIP."""
    init_geoip_history_db()
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.execute("DELETE FROM connection_history;")
            conn.commit()
            return True
        except Exception:
            return False
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

AI_NET_MODEL = "gemini-4-hydrogen"
_AI_NET_MEM_CACHE = {}
_AI_NET_CACHE_LOCK = threading.Lock()
_AI_NET_CACHE_TTL_SEC = 1800.0

def _read_server_env_key(key_name):
    val = os.environ.get(key_name, "").strip()
    if val:
        return val
    for fname in (".env.local", ".env"):
        fpath = os.path.join(BASE_DIR, fname)
        try:
            if not os.path.isfile(fpath):
                continue
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    stripped = line.strip()
                    if not stripped or stripped.startswith("#") or "=" not in stripped:
                        continue
                    k, v = stripped.split("=", 1)
                    if k.strip() == key_name:
                        cleaned = v.strip().strip('"').strip("'")
                        if cleaned:
                            return cleaned
        except Exception:
            pass
    return ""

def _collect_dynamic_host_context():
    """Recopila dinámicamente puertos en escucha, contenedores Docker y servicios activos para contexto de IA."""
    listen_summary = []
    try:
        lmap = update_listening_ports_map()
        for port_k, info in sorted(lmap.items()):
            lbl = info.get("service_hint") or info.get("proc") or ""
            if lbl:
                listen_summary.append(f":{port_k} -> {lbl}")
    except Exception:
        pass

    docker_names = []
    systemd_names = []
    with METRICS_LOCK:
        for d in (METRICS_CACHE.get("docker_activities") or [])[:25]:
            nm = str(d.get("name") or "").strip()
            if nm:
                docker_names.append(nm)
        for s in (METRICS_CACHE.get("systemd_services") or [])[:30]:
            if s.get("active"):
                nm = str(s.get("name") or s.get("unit") or "").strip()
                if nm:
                    systemd_names.append(nm)

    return {
        "hostname": HOSTNAME,
        "listening_ports": listen_summary[:45],
        "running_containers": docker_names,
        "active_services": systemd_names,
    }

def identify_connections_with_ai(connections_in, lang="es"):
    """Clasifica y simplifica conexiones de red mediante Gemini en el servidor con caché en SQLite."""
    init_geoip_history_db()
    if not isinstance(connections_in, list):
        return 400, {"ok": False, "code": "INVALID_PAYLOAD", "error": "connections debe ser una lista"}

    lang_clean = (str(lang or "es").strip().lower()[:8]) or "es"
    items = [c for c in connections_in if isinstance(c, dict)][:24]
    if not items:
        return 200, {"ok": True, "model": AI_NET_MODEL, "insights": {}}

    now_ts = time.time()
    result_insights = {}
    missing_items = []
    missing_sigs = []

    for c in items:
        sig = str(c.get("signature") or "").strip()
        if not sig:
            continue
        cache_k = (lang_clean, sig)
        cached_mem = None
        with _AI_NET_CACHE_LOCK:
            cached_mem = _AI_NET_MEM_CACHE.get(cache_k)
        if cached_mem and (now_ts - cached_mem.get("analyzed_at", 0)) < _AI_NET_CACHE_TTL_SEC:
            result_insights[sig] = cached_mem
        else:
            missing_sigs.append(sig)
            missing_items.append({
                "signature": sig,
                "direction": str(c.get("direction") or "outgoing"),
                "protocol": str(c.get("protocol") or "TCP"),
                "local_device": str(c.get("local_hostname") or c.get("local_ip") or ""),
                "local_port": int(c.get("local_port") or 0),
                "remote_ip": str(c.get("remote_ip") or ""),
                "remote_port": int(c.get("remote_port") or 0),
                "domain": str(c.get("domain") or ""),
                "raw_service": str(c.get("service") or ""),
                "process": str(c.get("process") or ""),
                "isp": str(c.get("isp") or ""),
                "asn": str(c.get("asn") or ""),
                "city": str(c.get("city") or ""),
                "country": str(c.get("country") or ""),
            })

    # Consultar caché persistente SQLite para firmas que no estaban en memoria
    if missing_sigs:
        still_missing = []
        db_hits = {}
        with GEOIP_HISTORY_DB_LOCK:
            conn = None
            try:
                conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
                conn.row_factory = sqlite3.Row
                placeholders = ",".join("?" for _ in missing_sigs)
                rows = conn.execute(
                    f"""
                    SELECT * FROM ai_connection_insights
                    WHERE lang = ? AND signature IN ({placeholders}) AND analyzed_at >= ?
                    """,
                    [lang_clean] + missing_sigs + [now_ts - _AI_NET_CACHE_TTL_SEC]
                ).fetchall()
                for r in rows:
                    db_hits[r["signature"]] = {
                        "signature": r["signature"],
                        "app_name": r["app_name"],
                        "category": r["category"],
                        "role": r["role"],
                        "summary": r["summary"],
                        "confidence": r["confidence"],
                        "model": r["model"],
                        "analyzed_at": float(r["analyzed_at"]),
                    }
            except Exception:
                pass
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass

        for item in missing_items:
            sig = item["signature"]
            if sig in db_hits:
                result_insights[sig] = db_hits[sig]
                with _AI_NET_CACHE_LOCK:
                    _AI_NET_MEM_CACHE[(lang_clean, sig)] = db_hits[sig]
            else:
                still_missing.append(item)
        missing_items = still_missing

    if not missing_items:
        return 200, {"ok": True, "model": AI_NET_MODEL, "insights": result_insights}

    api_key = _read_server_env_key("GEMINI_API_KEY")
    if not api_key or api_key == "MY_GEMINI_API_KEY":
        return 503, {
            "ok": False,
            "code": "GEMINI_API_KEY_MISSING",
            "error": "GEMINI_API_KEY no está configurada en el entorno del servidor.",
            "insights": result_insights,
        }

    host_ctx = _collect_dynamic_host_context()
    sys_instruction = (
        f'You are a Linux & home-server network telemetry analyst. Respond strictly in language code "{lang_clean}". '
        "Simplify noisy raw network connection telemetry into clear human identifications. "
        "Analyze ALL clues together: domain/rDNS patterns, local_port and remote_port, protocol, process name, "
        "local_device, ISP/ASN, and the host's real listening ports / containers / services in host_context. "
        "Correlate high local ports and dynamic residential ISP hostnames with local P2P/torrent listeners if active, "
        "or correlate cloud domains with mobile push/updates/media/photo sync when evidence matches. "
        "Keep every field concise: app_name (2-4 words), category (1-2 words), role (short direction tag), "
        "summary (one crisp sentence <= 95 chars explaining what this connection is doing without raw IP dumps)."
    )

    prompt_body = json.dumps({
        "target_language": lang_clean,
        "host_context": host_ctx,
        "connections_to_identify": missing_items,
    }, ensure_ascii=False)

    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{AI_NET_MODEL}:generateContent"
    req_payload = {
        "systemInstruction": {"parts": [{"text": sys_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": prompt_body}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "items": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "signature": {"type": "STRING"},
                                "app_name": {"type": "STRING"},
                                "category": {"type": "STRING"},
                                "role": {"type": "STRING"},
                                "summary": {"type": "STRING"},
                                "confidence": {"type": "STRING"},
                            },
                            "required": ["signature", "app_name", "category", "role", "summary", "confidence"],
                        },
                    }
                },
                "required": ["items"],
            },
        },
    }

    try:
        r = requests.post(
            gemini_url,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
                "User-Agent": "aistudio-build",
            },
            json=req_payload,
            timeout=22,
        )
        if r.status_code != 200:
            err_msg = f"Gemini HTTP {r.status_code}"
            try:
                err_j = r.json()
                err_msg = err_j.get("error", {}).get("message") or err_msg
            except Exception:
                pass
            return 502, {
                "ok": False,
                "code": "GEMINI_UPSTREAM_ERROR",
                "error": err_msg,
                "insights": result_insights,
            }

        resp_json = r.json()
        cand_parts = (((resp_json.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        raw_text = "".join(str(p.get("text") or "") for p in cand_parts).strip()
        parsed = json.loads(raw_text) if raw_text else {"items": []}
        ai_items = parsed.get("items") or []
        analyzed_ts = time.time()

        rows_to_save = []
        for it in ai_items:
            if not isinstance(it, dict):
                continue
            sig = str(it.get("signature") or "").strip()
            if not sig:
                continue
            conf_raw = str(it.get("confidence") or "medium").lower()
            conf = conf_raw if conf_raw in ("high", "medium", "low") else "medium"
            rec = {
                "signature": sig,
                "app_name": str(it.get("app_name") or "").strip() or "Servicio de red",
                "category": str(it.get("category") or "").strip() or "Red",
                "role": str(it.get("role") or "").strip() or "Conexión externa",
                "summary": str(it.get("summary") or "").strip(),
                "confidence": conf,
                "model": AI_NET_MODEL,
                "analyzed_at": analyzed_ts,
            }
            result_insights[sig] = rec
            with _AI_NET_CACHE_LOCK:
                _AI_NET_MEM_CACHE[(lang_clean, sig)] = rec
            rows_to_save.append((
                lang_clean,
                sig,
                rec["app_name"],
                rec["category"],
                rec["role"],
                rec["summary"],
                rec["confidence"],
                rec["model"],
                analyzed_ts,
            ))

        if rows_to_save:
            with GEOIP_HISTORY_DB_LOCK:
                conn = None
                try:
                    conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
                    conn.executemany(
                        """
                        INSERT OR REPLACE INTO ai_connection_insights
                        (lang, signature, app_name, category, role, summary, confidence, model, analyzed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        rows_to_save,
                    )
                    conn.commit()
                except Exception:
                    pass
                finally:
                    if conn is not None:
                        try:
                            conn.close()
                        except Exception:
                            pass

        return 200, {"ok": True, "model": AI_NET_MODEL, "insights": result_insights}
    except Exception as ex:
        return 502, {
            "ok": False,
            "code": "GEMINI_UPSTREAM_ERROR",
            "error": str(ex),
            "insights": result_insights,
        }


_AI_FAULT_MEM_CACHE = {}

def simplify_system_faults_with_ai(faults_in=None, lang="es"):
    """
    Simplifica los fallos detectados en el avisador de la interfaz mediante Gemini en el servidor,
    asigna nivel de peligro (critical/high/medium/low), ofrece pasos de solución y persiste
    en la tabla ai_system_fault_insights de recursos_history.db para no volver a consultar fallos recurrentes.
    """
    init_geoip_history_db()
    lang_clean = (str(lang or "es").strip().lower()[:8]) or "es"

    raw_items = []
    if isinstance(faults_in, list) and faults_in:
        raw_items = [f for f in faults_in if isinstance(f, dict)]
    else:
        eff = fetch_effective_system_logs(priority_max=4, limit=40, lang=lang_clean)
        for u in (eff.get("failed_units") or []):
            u_name = str(u.get("unit") or "systemd")
            u_desc = str(u.get("description") or u_name)
            u_sub = str(u.get("sub") or "failed")
            raw_items.append({
                "unit": u_name,
                "category": "service",
                "level": "CRIT",
                "message": f"systemd unit failed: {u_desc} ({u_sub})",
                "signature": u.get("signature"),
            })
        for lg in (eff.get("logs") or []):
            raw_items.append({
                "unit": str(lg.get("unit") or lg.get("source") or "system"),
                "category": str(lg.get("category") or "system"),
                "level": str(lg.get("level") or "ERR"),
                "message": str(lg.get("message") or ""),
                "signature": lg.get("signature"),
            })

    dedup_by_sig = {}
    sig_occurrence_counts = {}
    for f in raw_items:
        unit_s = str(f.get("unit") or f.get("source") or "system").strip()
        cat_s = str(f.get("category") or "system").strip()
        msg_s = str(f.get("message") or "").strip()
        if not msg_s:
            continue
        sig = str(f.get("signature") or "").strip() or _normalize_system_fault_signature(unit_s, cat_s, msg_s)
        sig_occurrence_counts[sig] = sig_occurrence_counts.get(sig, 0) + 1
        if sig not in dedup_by_sig and len(dedup_by_sig) < 20:
            dedup_by_sig[sig] = {
                "signature": sig,
                "unit": unit_s,
                "category": cat_s,
                "level": str(f.get("level") or "ERR"),
                "sample_message": msg_s[:280],
            }

    all_sigs = list(dedup_by_sig.keys())
    stored_by_sig, recent_history = _lookup_stored_fault_insights(all_sigs, lang=lang_clean, history_limit=50)

    result_insights = {}
    missing_items = []
    for sig, item_meta in dedup_by_sig.items():
        if sig in stored_by_sig:
            hit = dict(stored_by_sig[sig])
            hit["occurrence_count"] = max(int(hit.get("occurrence_count") or 1), sig_occurrence_counts.get(sig, 1))
            hit["cached_from_db"] = True
            result_insights[sig] = hit
            with _AI_NET_CACHE_LOCK:
                _AI_FAULT_MEM_CACHE[(lang_clean, sig)] = hit
        else:
            with _AI_NET_CACHE_LOCK:
                mem_hit = _AI_FAULT_MEM_CACHE.get((lang_clean, sig))
            if mem_hit:
                result_insights[sig] = mem_hit
            else:
                missing_items.append(item_meta)

    if not missing_items:
        return 200, {
            "ok": True,
            "model": AI_NET_MODEL,
            "insights": result_insights,
            "history": recent_history,
            "all_cached": True,
        }

    api_key = _read_server_env_key("GEMINI_API_KEY")
    if not api_key or api_key == "MY_GEMINI_API_KEY":
        return 503, {
            "ok": False,
            "code": "GEMINI_API_KEY_MISSING",
            "error": "GEMINI_API_KEY no está configurada en el entorno del servidor.",
            "insights": result_insights,
            "history": recent_history,
        }

    host_ctx = _collect_dynamic_host_context()
    sys_instruction = (
        f'You are a senior Linux, Docker, and home-server reliability engineer. Respond strictly in language code "{lang_clean}". '
        "Your job is to simplify raw system/kernel/systemd/Docker error logs detected by the interface alert notifier into clear, "
        "plain-language explanations for the server administrator, classify their real danger level, and provide concrete actionable solutions. "
        "For each fault item, return: "
        "- signature: exact signature string from input "
        "- title: short human-friendly title (2-6 words, no raw hex/PIDs) "
        "- danger_level: strictly one of 'critical', 'high', 'medium', or 'low' "
        "- summary: 1-2 clear sentences explaining what failed and why in plain language "
        "- solution: concrete, practical steps or exact terminal command to resolve or verify the issue "
        "- confidence: strictly one of 'high', 'medium', or 'low'."
    )

    prompt_body = json.dumps({
        "target_language": lang_clean,
        "host_context": host_ctx,
        "faults_to_diagnose": missing_items,
    }, ensure_ascii=False)

    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{AI_NET_MODEL}:generateContent"
    req_payload = {
        "systemInstruction": {"parts": [{"text": sys_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": prompt_body}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "items": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "signature": {"type": "STRING"},
                                "title": {"type": "STRING"},
                                "danger_level": {"type": "STRING"},
                                "summary": {"type": "STRING"},
                                "solution": {"type": "STRING"},
                                "confidence": {"type": "STRING"},
                            },
                            "required": ["signature", "title", "danger_level", "summary", "solution", "confidence"],
                        },
                    }
                },
                "required": ["items"],
            },
        },
    }

    try:
        r = requests.post(
            gemini_url,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
                "User-Agent": "aistudio-build",
            },
            json=req_payload,
            timeout=24,
        )
        if r.status_code != 200:
            err_msg = f"Gemini HTTP {r.status_code}"
            try:
                err_j = r.json()
                err_msg = err_j.get("error", {}).get("message") or err_msg
            except Exception:
                pass
            return 502, {
                "ok": False,
                "code": "GEMINI_UPSTREAM_ERROR",
                "error": err_msg,
                "insights": result_insights,
                "history": recent_history,
            }

        resp_json = r.json()
        cand_parts = (((resp_json.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        raw_text = "".join(str(p.get("text") or "") for p in cand_parts).strip()
        parsed = json.loads(raw_text) if raw_text else {"items": []}
        ai_items = parsed.get("items") or []
        analyzed_ts = time.time()

        rows_to_save = []
        for it in ai_items:
            if not isinstance(it, dict):
                continue
            sig = str(it.get("signature") or "").strip()
            if not sig:
                continue
            meta_in = dedup_by_sig.get(sig, {})
            danger_raw = str(it.get("danger_level") or "medium").strip().lower()
            danger = danger_raw if danger_raw in ("critical", "high", "medium", "low") else "medium"
            conf_raw = str(it.get("confidence") or "medium").strip().lower()
            conf = conf_raw if conf_raw in ("high", "medium", "low") else "medium"
            occ_count = max(1, sig_occurrence_counts.get(sig, 1))
            rec = {
                "signature": sig,
                "unit": str(meta_in.get("unit") or "system"),
                "category": str(meta_in.get("category") or "system"),
                "title": str(it.get("title") or "").strip() or str(meta_in.get("unit") or "Aviso del sistema"),
                "danger_level": danger,
                "summary": str(it.get("summary") or "").strip(),
                "solution": str(it.get("solution") or "").strip(),
                "confidence": conf,
                "model": AI_NET_MODEL,
                "occurrence_count": occ_count,
                "first_seen_at": analyzed_ts,
                "analyzed_at": analyzed_ts,
                "cached_from_db": False,
            }
            result_insights[sig] = rec
            with _AI_NET_CACHE_LOCK:
                _AI_FAULT_MEM_CACHE[(lang_clean, sig)] = rec
            rows_to_save.append((
                lang_clean,
                sig,
                rec["unit"],
                rec["category"],
                rec["title"],
                rec["danger_level"],
                rec["summary"],
                rec["solution"],
                rec["confidence"],
                rec["model"],
                occ_count,
                analyzed_ts,
                analyzed_ts,
            ))

        if rows_to_save:
            with GEOIP_HISTORY_DB_LOCK:
                conn = None
                try:
                    conn = sqlite3.connect(RECURSOS_HISTORY_DB_FILE, timeout=10.0)
                    conn.executemany(
                        """
                        INSERT INTO ai_system_fault_insights
                        (lang, signature, unit, category, title, danger_level, summary, solution, confidence, model, occurrence_count, first_seen_at, analyzed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(lang, signature) DO UPDATE SET
                            title = excluded.title,
                            danger_level = excluded.danger_level,
                            summary = excluded.summary,
                            solution = excluded.solution,
                            confidence = excluded.confidence,
                            model = excluded.model,
                            occurrence_count = ai_system_fault_insights.occurrence_count + excluded.occurrence_count,
                            analyzed_at = excluded.analyzed_at
                        """,
                        rows_to_save,
                    )
                    conn.commit()
                except Exception:
                    pass
                finally:
                    if conn is not None:
                        try:
                            conn.close()
                        except Exception:
                            pass

        _, updated_history = _lookup_stored_fault_insights(None, lang=lang_clean, history_limit=50)
        return 200, {
            "ok": True,
            "model": AI_NET_MODEL,
            "insights": result_insights,
            "history": updated_history,
            "all_cached": False,
        }
    except Exception as ex:
        return 502, {
            "ok": False,
            "code": "GEMINI_UPSTREAM_ERROR",
            "error": str(ex),
            "insights": result_insights,
            "history": recent_history,
        }


def load_geoip_disk_cache():
    """Carga la caché persistente de GeoIP desde SQLite y disco al iniciar el worker."""
    global GEOIP_CACHE, SERVER_SELF_GEO
    init_geoip_history_db()
    now = time.time()
    cutoff = now - GEOIP_TTL_SECONDS
    loaded = {}

    # 1. Cargar ubicaciones exactas acotadas desde SQLite geoip_locations
    with GEOIP_HISTORY_DB_LOCK:
        conn = None
        try:
            conn = sqlite3.connect(GEOIP_HISTORY_DB_FILE, timeout=10.0)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM geoip_locations WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT ?",
                (cutoff, int(GEOIP_MAX_ENTRIES))
            )
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
        except Exception:
            pass
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    # 2. Complementar con archivo JSON si existe (solo IPs ausentes en SQLite)
    json_only_loaded = {}
    if os.path.exists(GEOIP_CACHE_FILE):
        try:
            with open(GEOIP_CACHE_FILE, "r", encoding="utf-8", errors="ignore") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                entries = raw.get("entries", raw) if isinstance(raw.get("entries"), dict) else raw
                for ip_k, val in entries.items():
                    s_ip = str(ip_k)
                    if s_ip not in loaded and isinstance(val, dict) and isinstance(val.get("lat"), (int, float)) and isinstance(val.get("lng"), (int, float)):
                        ts = float(val.get("ts", now))
                        if ts >= cutoff:
                            entry_obj = {
                                "ip": s_ip,
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
                            loaded[s_ip] = entry_obj
                            json_only_loaded[s_ip] = entry_obj
        except Exception:
            pass

    with GEOIP_LOCK:
        GEOIP_CACHE.update(loaded)
        if not SERVER_SELF_GEO:
            SERVER_SELF_GEO = {
                "lat": float(os.environ.get("SERVER_GEO_LAT", 0.0)),
                "lng": float(os.environ.get("SERVER_GEO_LNG", 0.0)),
                "city": os.environ.get("SERVER_GEO_CITY", HOSTNAME),
                "country": os.environ.get("SERVER_GEO_COUNTRY", ""),
                "country_code": os.environ.get("SERVER_GEO_CC", "")
            }

    if json_only_loaded:
        save_geoip_locations_to_sqlite(json_only_loaded)

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
            con = None
            try:
                con = sqlite3.connect(f"file:{dbpath}?mode=ro", uri=True, timeout=1.0)
                cur = con.cursor()
                cur.execute("SELECT ip, name FROM network_addresses WHERE name IS NOT NULL AND name != ''")
                for ip, name in cur.fetchall():
                    ip = ip.strip()
                    name = name.strip()
                    if ip and name and ip not in new_map:
                        new_map[ip] = name
            except Exception:
                pass
            finally:
                if con is not None:
                    try:
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
        con = None
        try:
            con = sqlite3.connect(f"file:{dbpath}?mode=ro", uri=True, timeout=1.0)
            cur = con.cursor()
            cur.execute("""
                SELECT timestamp, domain, client 
                FROM queries 
                WHERE timestamp > ? 
                  AND client NOT IN ('127.0.0.1', '::1', ?)
                  AND status IN (1, 2, 3, 14, 17)
                ORDER BY timestamp DESC
                LIMIT 160
            """, (cutoff, SERVER_LOCAL_IP))
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
            self.flows_cache = flows
            self.last_flows_refresh = now
        except Exception:
            pass
        finally:
            if con is not None:
                try:
                    con.close()
                except Exception:
                    pass
        return flows

def fetch_connections_geo_worker():
    global CONNECTIONS_MAP_CACHE, SERVER_SELF_GEO, _CONNTRACK_NEEDS_SUDO
    load_geoip_disk_cache()
    pihole_translator = PiholeDnsTranslator()
    resolved_outbound_hosts = {}
    last_dns_retry_ts = 0.0
    outbound_targets = [
        ("api.github.com", 443, "TCP", "GitHub OTA Sync (api.github.com)"),
        ("cdn.simpleicons.org", 443, "TCP", "SimpleIcons Hardware CDN"),
        ("one.one.one.one", 53, "UDP", "Cloudflare DNS Upstream (1.1.1.1)"),
        ("dns.google", 53, "UDP", "Google Public DNS Upstream (8.8.8.8)")
    ]
    while True:
        try:
            now = time.time()
            # -1. Sondeo de tráfico, caudales y bytes acumulados por socket TCP del kernel (ss -tin)
            poll_socket_traffic_metrics()
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
                                    "lat": float(os.environ.get("SERVER_GEO_LAT") or sdata.get("lat") or 0.0),
                                    "lng": float(os.environ.get("SERVER_GEO_LNG") or sdata.get("lon") or 0.0),
                                    "city": os.environ.get("SERVER_GEO_CITY") or sdata.get("city") or HOSTNAME,
                                    "country": os.environ.get("SERVER_GEO_COUNTRY") or sdata.get("country") or "",
                                    "country_code": sdata.get("countryCode") or "",
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

            # 2. Resolve active DNS outbound targets (throttled retry on temporary DNS failure)
            if len(resolved_outbound_hosts) < len(outbound_targets) and (now - last_dns_retry_ts >= 30.0):
                last_dns_retry_ts = now
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
                conns = get_cached_inet_connections(max_age=3.0)
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

            # 3b. Inspect kernel conntrack flows (direct with CAP_NET_ADMIN first, sudo -n fallback)
            try:
                if not _CONNTRACK_NEEDS_SUDO:
                    ct_proc = subprocess.run(["conntrack", "-L"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2.5)
                    if ct_proc.returncode != 0:
                        ct_sudo = subprocess.run(["sudo", "-n", "conntrack", "-L"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2.5)
                        if ct_sudo.returncode == 0:
                            _CONNTRACK_NEEDS_SUDO = True
                            ct_proc = ct_sudo
                else:
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
                        listen_match = listening_map.get(loc_port) or (listening_map.get(rem_port) if dir_str == "outgoing" else None) or {}
                        resolved_proc = str(listen_match.get("service_hint") or listen_match.get("proc") or "").strip()
                        base_port_lbl = PORT_SERVICE_LABELS.get(target_port)
                        if resolved_proc and not base_port_lbl:
                            svc_label = f"{resolved_proc} (:{target_port})"
                        elif resolved_proc and base_port_lbl:
                            svc_label = base_port_lbl
                        else:
                            svc_label = base_port_lbl or f"{proto_str} Puerto :{target_port}"

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
                            "process": resolved_proc or "Kernel Conntrack",
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

            srv_lat = SERVER_SELF_GEO.get("lat", 0.0)
            srv_lng = SERVER_SELF_GEO.get("lng", 0.0)
            srv_city = SERVER_SELF_GEO.get("city") or HOSTNAME
            srv_country = SERVER_SELF_GEO.get("country") or ""
            srv_cc = SERVER_SELF_GEO.get("country_code") or ""

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

                traf = get_socket_traffic(s["local_ip"], s["local_port"], r_ip, s["remote_port"])
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
                    "bytes_sent": traf["bytes_sent"],
                    "bytes_received": traf["bytes_received"],
                    "bytes_total": traf["bytes_total"],
                    "tx_speed": traf["tx_speed"],
                    "rx_speed": traf["rx_speed"],
                    "total_speed": traf["total_speed"],
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
                    ep_loc_port = 48120 + (ep["port"] % 500)
                    ep_traf = get_socket_traffic(SERVER_LOCAL_IP, ep_loc_port, ep["ip"], ep["port"])
                    connections_out.append({
                        "id": f"out_{ep['host']}_{ep['ip']}",
                        "direction": "outgoing",
                        "protocol": ep["protocol"],
                        "local_ip": SERVER_LOCAL_IP,
                        "local_hostname": "Servidor",
                        "local_port": ep_loc_port,
                        "remote_ip": ep["ip"],
                        "remote_port": ep["port"],
                        "domain": ep["host"],
                        "service": ep["service"],
                        "process": "python3 (dashboard)",
                        "jail": "caddy-scan",
                        "details": f"Sincronización externa hacia {ep['service']}",
                        "state": "ESTABLISHED",
                        "bytes_sent": ep_traf["bytes_sent"],
                        "bytes_received": ep_traf["bytes_received"],
                        "bytes_total": ep_traf["bytes_total"],
                        "tx_speed": ep_traf["tx_speed"],
                        "rx_speed": ep_traf["rx_speed"],
                        "total_speed": ep_traf["total_speed"],
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
                        "bytes_sent": 0,
                        "bytes_received": 0,
                        "bytes_total": 0,
                        "tx_speed": 0.0,
                        "rx_speed": 0.0,
                        "total_speed": 0.0,
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
        # Wait up to 3.5 seconds or wake immediately when new remote IPs are enqueued
        GEOIP_WAKE_EVENT.wait(timeout=3.5)
        GEOIP_WAKE_EVENT.clear()


MAP_TILE_CACHE = collections.OrderedDict()
MAP_TILE_CACHE_LOCK = threading.Lock()
MAP_TILE_CACHE_MAX = 1500
MAP_TILE_TTL_SEC = 7 * 86400


def fetch_cached_map_tile(style, z, x, y):
    """Obtiene y cachea en memoria teselas 100 % gratuitas (OpenStreetMap / ArcGIS Canvas) sin API Key."""
    style = str(style or "light").strip().lower()
    if style not in ("light", "dark", "osm"):
        return None
    try:
        zi, xi, yi = int(z), int(x), int(y)
    except Exception:
        return None
    if zi < 0 or zi > 19:
        return None
    max_coord = 1 << zi
    if xi < 0 or yi < 0 or xi >= max_coord or yi >= max_coord:
        return None

    cache_key = f"{style}:{zi}:{xi}:{yi}"
    now = time.time()
    with MAP_TILE_CACHE_LOCK:
        cached = MAP_TILE_CACHE.get(cache_key)
        if cached and (now - cached[2]) < MAP_TILE_TTL_SEC:
            MAP_TILE_CACHE.move_to_end(cache_key)
            return cached[0], cached[1], cached[3]

    if style == "dark":
        candidates = [
            ("arcgis-dark", f"https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{zi}/{yi}/{xi}"),
            ("osm-de", f"https://tile.openstreetmap.de/{zi}/{xi}/{yi}.png"),
            ("osm", f"https://tile.openstreetmap.org/{zi}/{xi}/{yi}.png"),
        ]
    else:
        candidates = [
            ("osm", f"https://tile.openstreetmap.org/{zi}/{xi}/{yi}.png"),
            ("osm-de", f"https://tile.openstreetmap.de/{zi}/{xi}/{yi}.png"),
            ("arcgis-light", f"https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{zi}/{yi}/{xi}"),
        ]

    ver_ua = get_canonical_version(BASE_DIR) if "get_canonical_version" in globals() else "0.0.0"
    headers = {
        "User-Agent": f"RecursosCockpit/{ver_ua} (+https://github.com/cminewarIA/recursos-ui)",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
    }

    for prov_name, tile_url in candidates:
        try:
            r = requests.get(tile_url, headers=headers, timeout=6)
            ctype = (r.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if r.status_code == 200 and ctype.startswith("image/") and len(r.content) > 100:
                data = bytes(r.content)
                with MAP_TILE_CACHE_LOCK:
                    MAP_TILE_CACHE[cache_key] = (data, ctype, now, prov_name)
                    MAP_TILE_CACHE.move_to_end(cache_key)
                    while len(MAP_TILE_CACHE) > MAP_TILE_CACHE_MAX:
                        MAP_TILE_CACHE.popitem(last=False)
                return data, ctype, prov_name
        except Exception:
            continue
    return None

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
_GITHUB_COMMITS_CACHE = {
    "recent_commits": [],
    "remote_full_sha": "",
    "remote_sha": "",
    "remote_msg": "",
    "remote_date": "",
    "remote_author": "cminewarIA",
    "version": "",
    "timestamp": 0.0,
}
_VERSION_REFRESH_IN_FLIGHT = False
_LOCAL_GIT_SHA_CACHE = None
DETECTED_DOMAIN_CACHE = None

def get_local_git_sha_cached():
    """Devuelve el SHA corto local cacheado evitando ejecutar git rev-parse en cada petición HTTP."""
    global _LOCAL_GIT_SHA_CACHE
    with VERSION_LOCK:
        cached = VERSION_CACHE.get("data")
        if isinstance(cached, dict) and cached.get("local_hash") and cached["local_hash"] not in ("local", "HEAD"):
            _LOCAL_GIT_SHA_CACHE = cached["local_hash"]
            return _LOCAL_GIT_SHA_CACHE
    if _LOCAL_GIT_SHA_CACHE:
        return _LOCAL_GIT_SHA_CACHE
    sha = "HEAD"
    try:
        if os.path.isdir(os.path.join(BASE_DIR, ".git")):
            p_sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True, timeout=1.5)
            if p_sha.returncode == 0 and p_sha.stdout.strip():
                sha = p_sha.stdout.strip()[:7]
    except Exception:
        pass
    _LOCAL_GIT_SHA_CACHE = sha
    return sha

def get_version_info_cached_async():
    """Devuelve versión cacheada sin bloquear el colector de métricas; refresca en segundo plano si expiró."""
    global _VERSION_REFRESH_IN_FLIGHT
    now = time.time()
    cached_copy = None
    needs_refresh = False
    with VERSION_LOCK:
        if VERSION_CACHE["data"]:
            cached_copy = dict(VERSION_CACHE["data"])
            cached_copy["auto_install_enabled"] = AUTO_INSTALL_STATE.get("enabled", True)
            cached_copy["auto_install_in_progress"] = AUTO_INSTALL_STATE.get("in_progress", False)
            cached_copy["auto_install_status"] = AUTO_INSTALL_STATE.get("last_status", "")
            cached_copy["last_auto_install"] = AUTO_INSTALL_STATE.get("last_installed_at", "")
            if now - VERSION_CACHE["timestamp"] >= 60:
                needs_refresh = True
        else:
            needs_refresh = True

    if needs_refresh and not _VERSION_REFRESH_IN_FLIGHT:
        def _bg_ver_refresh():
            global _VERSION_REFRESH_IN_FLIGHT
            _VERSION_REFRESH_IN_FLIGHT = True
            try:
                get_version_info(force_refresh=False, allow_auto_trigger=True)
            finally:
                _VERSION_REFRESH_IN_FLIGHT = False
        threading.Thread(target=_bg_ver_refresh, daemon=True).start()

    if cached_copy is not None:
        return cached_copy

    pkg_ver = get_app_version()
    disp_ver = get_display_version(pkg_ver)
    return {
        "version": pkg_ver,
        "current_version": pkg_ver,
        "display_version": disp_ver,
        "local_hash": get_local_git_sha_cached(),
        "local_commit": get_local_git_sha_cached(),
        "public_domain": detect_system_dns_domain(),
        "local_ip": SERVER_LOCAL_IP,
        "auto_install_enabled": AUTO_INSTALL_STATE.get("enabled", True),
        "auto_install_in_progress": AUTO_INSTALL_STATE.get("in_progress", False),
        "auto_install_status": AUTO_INSTALL_STATE.get("last_status", ""),
        "last_auto_install": AUTO_INSTALL_STATE.get("last_installed_at", ""),
    }

def detect_local_server_ip():
    """Detecta automáticamente la IP privada LAN del servidor instalado sin valores fijos."""
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
    try:
        for _iface, addrs in psutil.net_if_addrs().items():
            for a in addrs:
                if a.family == socket.AF_INET and a.address and not a.address.startswith("127."):
                    return a.address
    except Exception:
        pass
    return "127.0.0.1"

SERVER_LOCAL_IP = detect_local_server_ip()

_VIRTUAL_NIC_PREFIXES = (
    "lo", "docker", "veth", "br-", "virbr", "tun", "tap", "wg",
    "tailscale", "podman", "cni", "flannel", "kube", "dummy"
)


def get_lan_broadcast_entries():
    """Devuelve dinámicamente [(local_ip, broadcast_ip, nic_name)] de NICs físicas activas."""
    entries = []
    seen = set()
    try:
        stats = psutil.net_if_stats() or {}
        addrs_map = psutil.net_if_addrs() or {}
        for pass_idx in (0, 1):
            for iface, addrs in addrs_map.items():
                iface_low = (iface or "").lower()
                is_virtual = iface_low.startswith(_VIRTUAL_NIC_PREFIXES)
                st = stats.get(iface)
                is_up = True if st is None else bool(st.isup)
                if pass_idx == 0 and (not is_up or is_virtual):
                    continue
                if pass_idx == 1 and iface_low == "lo":
                    continue
                for a in addrs:
                    if a.family == socket.AF_INET and a.address and not a.address.startswith("127."):
                        bcast = None
                        if getattr(a, "broadcast", None):
                            bcast = a.broadcast
                        elif getattr(a, "netmask", None):
                            try:
                                net = ipaddress.IPv4Network(f"{a.address}/{a.netmask}", strict=False)
                                bcast = str(net.broadcast_address)
                            except Exception:
                                bcast = None
                        if bcast:
                            key = (a.address, bcast)
                            if key not in seen:
                                seen.add(key)
                                entries.append((a.address, bcast, iface))
            if entries:
                break
    except Exception:
        pass
    return entries


def get_lan_broadcast_addresses():
    """Obtiene dinámicamente las direcciones de broadcast IPv4 de las NICs físicas activas."""
    bcasts = set()
    for _local_ip, bcast, _iface in get_lan_broadcast_entries():
        bcasts.add(bcast)
    bcasts.add("255.255.255.255")
    return sorted(bcasts)

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
        os.path.join(BASE_DIR, "Caddyfile"),
        os.path.join(BASE_DIR, "caddy", "Caddyfile"),
        os.path.join(BASE_DIR, "duck.sh"),
        os.path.join(BASE_DIR, "duckdns", "duck.sh"),
        os.path.join(BASE_DIR, "..", "caddy", "Caddyfile"),
        os.path.join(BASE_DIR, "..", "duckdns", "duck.sh"),
        "./Caddyfile",
        "./duck.sh",
        "./duckdns/duck.sh",
        "/etc/caddy/Caddyfile",
        "/opt/caddy/Caddyfile",
        "/etc/nginx/sites-enabled/default",
        "/etc/nginx/nginx.conf",
        "/etc/crontab"
    ]
    if os.path.isdir("/home/servidor"):
        candidate_files.extend([
            "/home/servidor/Caddyfile",
            "/home/servidor/servicios/caddy/Caddyfile",
            "/home/servidor/docker/caddy/Caddyfile",
            "/home/servidor/duckdns/duck.sh",
            "/home/servidor/servicios/duckdns/duck.sh",
        ])

    for base_search in ["/etc/nginx/conf.d", "/etc/nginx/sites-enabled", "/home/servidor"]:
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
    Llamada única a la versión oficial canónica definida en ./VERSION mediante i18n_catalog.
    """
    return get_canonical_version(BASE_DIR)

def get_display_version(pkg_ver=None):
    ver = (pkg_ver or get_app_version()).strip()
    env_disp = os.environ.get("RECURSOS_DISPLAY_VERSION", "").strip()
    if env_disp:
        return env_disp
    return ver

def _parse_semver_tuple(ver_str):
    try:
        clean = str(ver_str or "0").strip().lstrip("vV")
        clean = clean.split("-")[0].split("+")[0]
        parts = [int(p) for p in clean.split(".") if p.isdigit()]
        while len(parts) < 3:
            parts.append(0)
        return tuple(parts[:3])
    except Exception:
        return (0, 0, 0)

AUTO_INSTALL_CONFIG_FILE = os.path.join(BASE_DIR, "auto_install_config.json")
AUTO_INSTALL_LOCK = threading.Lock()
AUTO_INSTALL_EXEC_LOCK = threading.Lock()
AUTO_INSTALL_STATE = {
    "enabled": True,
    "in_progress": False,
    "last_installed_at": "",
    "last_status": "Activo · Vigilancia automática de actualizaciones",
    "last_output": "",
    "last_attempt_ts": 0.0,
    "perm_cooldown_until": 0.0,
}

def load_auto_install_preference():
    try:
        if os.path.isfile(AUTO_INSTALL_CONFIG_FILE):
            with open(AUTO_INSTALL_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if isinstance(cfg, dict) and "enabled" in cfg:
                    AUTO_INSTALL_STATE["enabled"] = bool(cfg["enabled"])
    except Exception:
        pass
    if not AUTO_INSTALL_STATE["enabled"]:
        AUTO_INSTALL_STATE["last_status"] = "Pausado · Actualizaciones automáticas desactivadas"
    return AUTO_INSTALL_STATE["enabled"]

def save_auto_install_preference(enabled):
    with AUTO_INSTALL_LOCK:
        AUTO_INSTALL_STATE["enabled"] = bool(enabled)
        AUTO_INSTALL_STATE["last_status"] = (
            "Activo · Vigilancia automática de actualizaciones"
            if AUTO_INSTALL_STATE["enabled"]
            else "Pausado · Actualizaciones automáticas desactivadas"
        )
        try:
            with open(AUTO_INSTALL_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump({"enabled": bool(enabled), "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}, f)
        except Exception:
            pass
    return AUTO_INSTALL_STATE["enabled"]

load_auto_install_preference()

def get_installed_deb_version():
    """Devuelve la versión del paquete Debian `recursos-cockpit` instalada en el sistema operativo local."""
    try:
        res = subprocess.run(
            ["dpkg-query", "-W", "-f=${Status}|${Version}", "recursos-cockpit"],
            capture_output=True, text=True, timeout=2
        )
        if res.returncode == 0 and "install ok installed" in (res.stdout or ""):
            parts = res.stdout.strip().split("|")
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip()
    except Exception:
        pass
    return ""

def ensure_local_deb_built_and_installed(target_version=None, force_rebuild=False, allow_install=True):
    """
    Compila el paquete `dist/recursos-cockpit_${VERSION}_amd64.deb` si no existe (o si force_rebuild=True)
    y lo instala inmediatamente en el sistema operativo cuando corresponde.
    """
    ver = (target_version or get_app_version()).strip()
    deb_rel = os.path.join("dist", f"recursos-cockpit_{ver}_amd64.deb")
    deb_abs = os.path.join(BASE_DIR, deb_rel)
    build_script = os.path.join(BASE_DIR, "packaging", "build_deb.sh")
    logs = []

    if (force_rebuild or not os.path.isfile(deb_abs)) and os.path.isfile(build_script):
        logs.append(f"[+] Compilando paquete de Ubuntu para v{get_display_version(ver)} ({ver})...")
        try:
            p_build = subprocess.run(
                ["bash", build_script],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=180
            )
            b_out = ((p_build.stdout or "") + "\n" + (p_build.stderr or "")).strip()
            if b_out:
                logs.append(b_out)
        except Exception as e:
            logs.append(f"[-] Error compilando paquete .deb: {e}")

    installed_ver = get_installed_deb_version()
    if not force_rebuild and installed_ver and _parse_semver_tuple(installed_ver) >= _parse_semver_tuple(ver) and os.path.isfile("/usr/bin/recursos-cockpit"):
        logs.append(f"[✓] Aplicación de escritorio v{get_display_version(installed_ver)} ya instalada y al día.")
        return True, "\n".join(logs)

    if not allow_install:
        return bool(installed_ver and _parse_semver_tuple(installed_ver) >= _parse_semver_tuple(ver)), "\n".join(logs)

    if os.path.isfile(deb_abs):
        logs.append(f"[+] Instalando paquete actualizado: {deb_rel}...")
        is_root = (os.geteuid() == 0) if hasattr(os, "geteuid") else False
        if is_root:
            install_cmds = [
                ["apt-get", "install", "--reinstall", "-y", deb_abs],
                ["dpkg", "--force-depends", "-i", deb_abs],
            ]
        else:
            install_cmds = [
                ["sudo", "-n", "apt-get", "install", "--reinstall", "-y", deb_abs],
                ["sudo", "-n", "dpkg", "--force-depends", "-i", deb_abs],
                ["dpkg", "--force-depends", "-i", deb_abs],
            ]

        perm_denied = False
        for cmd in install_cmds:
            try:
                p_inst = subprocess.run(cmd, cwd=BASE_DIR, capture_output=True, text=True, timeout=90)
                i_out = ((p_inst.stdout or "") + "\n" + (p_inst.stderr or "")).strip()
                if p_inst.returncode == 0:
                    if i_out:
                        logs.append(i_out)
                    logs.append(f"[✓] Instalación de recursos-cockpit v{get_display_version(ver)} completada.")
                    with AUTO_INSTALL_LOCK:
                        AUTO_INSTALL_STATE["perm_cooldown_until"] = 0.0
                    return True, "\n".join(logs)
                low_out = i_out.lower()
                if "password is required" in low_out or "superuser" in low_out or "permission denied" in low_out or "permiso denegado" in low_out:
                    perm_denied = True
            except Exception:
                continue

        if perm_denied:
            with AUTO_INSTALL_LOCK:
                AUTO_INSTALL_STATE["perm_cooldown_until"] = time.time() + 900.0
            logs.append("[!] Se necesitan permisos de administrador (sudo) para instalar el paquete en este equipo. Reintento automático pausado 15 min.")

    final_inst = get_installed_deb_version()
    return bool(final_inst and _parse_semver_tuple(final_inst) >= _parse_semver_tuple(ver)), "\n".join(logs)

_SAFE_GIT_Configured = False
_GENERATED_ARTIFACT_PREFIXES = (
    "static/index.html",
    "dist/",
    "packaging/",
    "nic_history_2h.json",
    "auto_install_config.json",
    "recursos_history.db",
    "geoip_history.db",
    "trusted_devices.json",
    "custom_logos.json",
    "planes/",
)

def _ensure_git_safe_directory():
    """Configura safe.directory para evitar errores 'dubious ownership' cuando systemd ejecuta como root."""
    global _SAFE_GIT_Configured
    if _SAFE_GIT_Configured:
        return
    _SAFE_GIT_Configured = True
    try:
        subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", BASE_DIR],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=3
        )
    except Exception:
        pass

def _get_git_status_summary():
    """
    Devuelve (has_any_dirty, has_code_dirty, modified_paths).
    Ignora archivos generados/runtime para que la autoactualización nunca se bloquee por artefactos locales.
    """
    _ensure_git_safe_directory()
    try:
        p_st = subprocess.run(
            ["git", "status", "--porcelain", "-uno"],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=3
        )
        if p_st.returncode != 0:
            return False, False, []
        raw_lines = [ln.strip() for ln in (p_st.stdout or "").splitlines() if ln.strip()]
        if not raw_lines:
            return False, False, []
        mod_paths = []
        code_dirty = False
        for ln in raw_lines:
            parts = ln.split(None, 1)
            rel_p = parts[1].strip().strip('"') if len(parts) > 1 else ln
            if " -> " in rel_p:
                rel_p = rel_p.split(" -> ", 1)[1].strip()
            mod_paths.append(rel_p)
            if not any(rel_p == pref.rstrip("/") or rel_p.startswith(pref) for pref in _GENERATED_ARTIFACT_PREFIXES):
                code_dirty = True
        return True, code_dirty, mod_paths
    except Exception:
        return False, False, []

def _download_and_apply_github_tarball(out_lines):
    """
    Motor de respaldo HTTPS directo: descarga y aplica el tarball oficial de GitHub
    preservando bases de datos (.db), configuraciones locales (.json) y claves (.env).
    """
    import tarfile
    import tempfile
    import shutil

    tar_urls = [
        f"https://codeload.github.com/{GITHUB_REPO}/tar.gz/refs/heads/{GITHUB_BRANCH}",
        f"https://github.com/{GITHUB_REPO}/archive/refs/heads/{GITHUB_BRANCH}.tar.gz",
    ]
    preserve_exact = {
        "recursos_history.db",
        "recursos_history.db-wal",
        "recursos_history.db-shm",
        "geoip_history.db",
        "geoip_history.db-wal",
        "geoip_history.db-shm",
        "nic_history_2h.json",
        "auto_install_config.json",
        "trusted_devices.json",
        "custom_logos.json",
        "telegram_bot_config.json",
        "parental_control.json",
        ".env",
        ".router_credentials.json",
        ".admin_master_key",
        ".admin_secondary_key_hash",
        ".device_tokens.json",
    }
    last_err = ""
    for t_url in tar_urls:
        try:
            req = urllib.request.Request(
                t_url,
                headers={"User-Agent": f"Recursos-Updater/{get_app_version()}"},
            )
            with urllib.request.urlopen(req, timeout=35.0) as resp:
                tar_bytes = resp.read()
            if len(tar_bytes) < 4096:
                last_err = f"Archivo demasiado pequeño desde {t_url}"
                continue
            with tempfile.TemporaryDirectory(prefix="recursos_ota_") as tmp_dir:
                tar_path = os.path.join(tmp_dir, "repo.tar.gz")
                with open(tar_path, "wb") as tf:
                    tf.write(tar_bytes)
                extract_dir = os.path.join(tmp_dir, "extracted")
                os.makedirs(extract_dir, exist_ok=True)
                with tarfile.open(tar_path, "r:gz") as tar_obj:
                    try:
                        tar_obj.extractall(path=extract_dir, filter="data")
                    except TypeError:
                        tar_obj.extractall(path=extract_dir)
                entries = [
                    os.path.join(extract_dir, d)
                    for d in os.listdir(extract_dir)
                    if os.path.isdir(os.path.join(extract_dir, d))
                ]
                src_root = entries[0] if entries else extract_dir
                ver_cand = os.path.join(src_root, "VERSION")
                if not os.path.isfile(ver_cand):
                    last_err = "El paquete descargado no contiene ./VERSION"
                    continue
                copied_files = 0
                for root_dir, dirs, files in os.walk(src_root):
                    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv")]
                    rel_dir = os.path.relpath(root_dir, src_root)
                    dest_dir = BASE_DIR if rel_dir == "." else os.path.join(BASE_DIR, rel_dir)
                    os.makedirs(dest_dir, exist_ok=True)
                    for fname in files:
                        rel_file = fname if rel_dir == "." else os.path.join(rel_dir, fname)
                        norm_rel = rel_file.replace("\\", "/")
                        if norm_rel in preserve_exact or norm_rel.endswith((".db", ".db-wal", ".db-shm", ".vault", "_dev.json")):
                            continue
                        src_f = os.path.join(root_dir, fname)
                        dst_f = os.path.join(dest_dir, fname)
                        shutil.copy2(src_f, dst_f)
                        copied_files += 1
                if os.path.isdir(os.path.join(BASE_DIR, ".git")):
                    try:
                        subprocess.run(["git", "fetch", "origin", GITHUB_BRANCH], cwd=BASE_DIR, capture_output=True, timeout=15)
                        subprocess.run(["git", "reset", "--soft", f"origin/{GITHUB_BRANCH}"], cwd=BASE_DIR, capture_output=True, timeout=5)
                    except Exception:
                        pass
                out_lines.append(f"[✓] Descarga directa HTTPS desde GitHub completada ({copied_files} archivos sincronizados hacia v{get_app_version()}).")
                return True
        except Exception as e:
            last_err = str(e)
    if last_err:
        out_lines.append(f"[-] Respaldo HTTPS desde GitHub falló: {last_err}")
    return False

def perform_auto_update_and_install(trigger_source="auto", do_git_pull=True, force_github_download=False):
    """
    Ejecuta la sincronización desde GitHub (`git pull` / `git reset` o descarga directa HTTPS Tarball)
    y compila + instala inmediatamente el paquete local `.deb` según se detecta.
    Cuando `force_github_download=True` o `trigger_source` es manual (`api_request`/`manual`),
    descarga siempre todos los archivos y traducciones desde GitHub aunque no detecte novedades,
    preservando `recursos_history.db`, secretos y configuraciones locales.
    """
    global _LOCAL_GIT_SHA_CACHE, METRICS_CACHE_BYTES
    if not AUTO_INSTALL_EXEC_LOCK.acquire(blocking=False):
        return {
            "success": True,
            "already_running": True,
            "message": "Actualización en marcha...",
            "output": AUTO_INSTALL_STATE.get("last_output", ""),
        }

    try:
        is_manual = trigger_source in ("api_request", "manual")
        force_full = bool(force_github_download or is_manual)
        if is_manual:
            with AUTO_INSTALL_LOCK:
                AUTO_INSTALL_STATE["perm_cooldown_until"] = 0.0

        with AUTO_INSTALL_LOCK:
            AUTO_INSTALL_STATE["in_progress"] = True
            AUTO_INSTALL_STATE["last_attempt_ts"] = time.time()
            AUTO_INSTALL_STATE["last_status"] = "Descargando todos los datos desde GitHub..." if force_full else "Comprobando y aplicando mejoras..."

        _ensure_git_safe_directory()
        out_lines = []
        has_git = os.path.isdir(os.path.join(BASE_DIR, ".git"))
        pull_ok = True
        code_updated = False
        did_stash = False
        before_ver = get_app_version()

        if do_git_pull:
            remote_ver_target = ""
            try:
                raw_ver_url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}/VERSION"
                req_rv = urllib.request.Request(raw_ver_url, headers={"User-Agent": "Recursos-Server-Monitor/12.0"})
                with urllib.request.urlopen(req_rv, timeout=4.0) as rv_resp:
                    if rv_resp.status == 200:
                        remote_ver_target = rv_resp.read().decode("utf-8", errors="ignore").strip().lstrip("vV")
            except Exception:
                pass

            if force_full:
                # Descarga completa garantizada desde GitHub aunque la versión local coincida o no haya novedades
                target_label = f"v{remote_ver_target}" if remote_ver_target else f"rama {GITHUB_BRANCH}"
                out_lines.append(f"[+] Descarga completa forzada desde GitHub ({target_label})...")
                pull_ok = _download_and_apply_github_tarball(out_lines)
                if not pull_ok and has_git:
                    out_lines.append("[i] Reintentando sincronización completa vía git fetch/reset desde GitHub...")
                    try:
                        p_fetch = subprocess.run(
                            ["git", "fetch", "--force", "--prune", "origin", GITHUB_BRANCH],
                            cwd=BASE_DIR, capture_output=True, text=True, timeout=25
                        )
                        p_reset = subprocess.run(
                            ["git", "reset", "--hard", f"origin/{GITHUB_BRANCH}"],
                            cwd=BASE_DIR, capture_output=True, text=True, timeout=15
                        )
                        pull_ok = (p_fetch.returncode == 0 and p_reset.returncode == 0)
                        out_lines.append(f"$ git reset --hard origin/{GITHUB_BRANCH}\n{(p_reset.stdout or p_reset.stderr or '').strip()}")
                    except Exception as e_git:
                        out_lines.append(f"[-] Fallback git también falló: {e_git}")
                        pull_ok = False
                try:
                    dict_sync = sync_dictionary_from_github(BASE_DIR, force=True, timeout=8.0)
                    if isinstance(dict_sync, dict) and dict_sync.get("ok"):
                        out_lines.append("[✓] Diccionario multi-idioma sincronizado desde GitHub.")
                except Exception:
                    pass
                code_updated = bool(pull_ok)
            elif not has_git:
                if remote_ver_target and _parse_semver_tuple(remote_ver_target) > _parse_semver_tuple(before_ver):
                    out_lines.append(f"[+] Sincronizando v{remote_ver_target} desde GitHub mediante paquete HTTPS directo...")
                    pull_ok = _download_and_apply_github_tarball(out_lines)
                    code_updated = bool(pull_ok and get_app_version() != before_ver)
                else:
                    pull_ok = True
                    out_lines.append(f"[✓] Versión local v{before_ver} ya está al día.")
            else:
                try:
                    p_before = subprocess.run(["git", "rev-parse", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True, timeout=3)
                    before_sha = p_before.stdout.strip() if p_before.returncode == 0 else ""

                    has_any_dirty, has_code_dirty, mod_paths = _get_git_status_summary()
                    # Restaurar artefactos autogenerados antes de actualizar para evitar conflictos espurios
                    if has_any_dirty and not has_code_dirty:
                        for mp in mod_paths:
                            subprocess.run(["git", "checkout", "--", mp], cwd=BASE_DIR, capture_output=True, timeout=3)

                    p_fetch = subprocess.run(
                        ["git", "fetch", "--prune", "origin", GITHUB_BRANCH],
                        cwd=BASE_DIR, capture_output=True, text=True, timeout=25
                    )
                    p_rver = subprocess.run(
                        ["git", "show", f"origin/{GITHUB_BRANCH}:VERSION"],
                        cwd=BASE_DIR, capture_output=True, text=True, timeout=5
                    )
                    remote_git_ver = p_rver.stdout.strip().lstrip("vV") if (p_rver.returncode == 0 and p_rver.stdout.strip()) else remote_ver_target

                    if remote_git_ver and _parse_semver_tuple(before_ver) > _parse_semver_tuple(remote_git_ver):
                        p_pull = subprocess.CompletedProcess([], 0, f"Versión local (v{before_ver}) superior a GitHub (v{remote_git_ver}).", "")
                    else:
                        if has_code_dirty:
                            p_st = subprocess.run(
                                ["git", "stash", "push", "-m", "auto-updater-backup"],
                                cwd=BASE_DIR, capture_output=True, text=True, timeout=10
                            )
                            did_stash = (p_st.returncode == 0 and "No local changes" not in (p_st.stdout or ""))
                        p_pull = subprocess.run(
                            ["git", "pull", "--ff-only", "origin", GITHUB_BRANCH],
                            cwd=BASE_DIR, capture_output=True, text=True, timeout=25
                        )
                        if p_pull.returncode != 0 and p_fetch.returncode == 0:
                            # Si las ramas divergieron o no hay upstream configurado, alinear limpiamente con origin/main
                            p_pull = subprocess.run(
                                ["git", "reset", "--hard", f"origin/{GITHUB_BRANCH}"],
                                cwd=BASE_DIR, capture_output=True, text=True, timeout=15
                            )
                        if did_stash:
                            p_pop = subprocess.run(["git", "stash", "pop"], cwd=BASE_DIR, capture_output=True, text=True, timeout=10)
                            if p_pop.returncode != 0:
                                out_lines.append("[!] Cambios locales preservados en git stash.")

                    p_after = subprocess.run(["git", "rev-parse", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True, timeout=3)
                    after_sha = p_after.stdout.strip() if p_after.returncode == 0 else ""
                    code_updated = bool((before_sha and after_sha and before_sha != after_sha) or (get_app_version() != before_ver))

                    pull_out = ((p_pull.stdout or "").strip() + "\n" + (p_pull.stderr or "").strip()).strip()
                    out_lines.append(f"$ git pull origin {GITHUB_BRANCH}\n{pull_out or 'Ya está actualizado.'}")
                    pull_ok = (p_pull.returncode == 0)

                    # Si git pull/reset falló, activar automáticamente el respaldo HTTPS Tarball
                    if not pull_ok:
                        out_lines.append("[i] Git pull devolvió error; activando descarga directa HTTPS desde GitHub...")
                        pull_ok = _download_and_apply_github_tarball(out_lines)
                        if pull_ok:
                            code_updated = bool(code_updated or get_app_version() != before_ver or is_manual)
                except Exception as e:
                    out_lines.append(f"[!] Aviso en cliente Git ({e}); activando descarga directa HTTPS desde GitHub...")
                    pull_ok = _download_and_apply_github_tarball(out_lines)
                    if pull_ok:
                        code_updated = bool(get_app_version() != before_ver or is_manual)

        new_ver = get_app_version()
        # Si el código fuente cambió y existe npm/package.json, reconstruir static/index.html antes del paquete .deb
        if code_updated and os.path.isfile(os.path.join(BASE_DIR, "package.json")):
            try:
                if subprocess.run(["which", "npm"], capture_output=True).returncode == 0:
                    out_lines.append("[+] Compilando interfaz web actualizada (npm run build)...")
                    p_npm = subprocess.run(["npm", "run", "build"], cwd=BASE_DIR, capture_output=True, text=True, timeout=120)
                    if p_npm.returncode == 0:
                        out_lines.append("[✓] Interfaz web compilada en static/index.html.")
            except Exception:
                pass

        # Limpiar APKs obsoletos en dist/ que no correspondan a la versión activa
        try:
            dist_dir_ota = os.path.join(BASE_DIR, "dist")
            expected_apk_name = f"recursos-cockpit_{new_ver}.apk"
            if os.path.isdir(dist_dir_ota):
                for stale_apk in glob.glob(os.path.join(dist_dir_ota, "recursos-cockpit_*.apk")):
                    if os.path.basename(stale_apk) != expected_apk_name:
                        try:
                            os.remove(stale_apk)
                        except OSError:
                            pass
                canonical_link = os.path.join(dist_dir_ota, "recursos-cockpit.apk")
                if os.path.lexists(canonical_link) and not os.path.isfile(os.path.join(dist_dir_ota, expected_apk_name)):
                    try:
                        os.remove(canonical_link)
                    except OSError:
                        pass
        except Exception:
            pass

        in_perm_cooldown = (time.time() < AUTO_INSTALL_STATE.get("perm_cooldown_until", 0.0))
        desktop_installed = os.path.isfile("/usr/bin/recursos-cockpit")
        should_install_deb = bool(desktop_installed or is_manual or trigger_source == "local_package_detected")
        if in_perm_cooldown and not is_manual:
            deb_ok = False
            deb_log = "Instalación del paquete local en espera (sin permisos sudo)."
        else:
            deb_ok, deb_log = ensure_local_deb_built_and_installed(
                new_ver,
                force_rebuild=code_updated,
                allow_install=should_install_deb,
            )
        if deb_log:
            out_lines.append(deb_log)

        _LOCAL_GIT_SHA_CACHE = None
        with VERSION_LOCK:
            VERSION_CACHE["data"] = None
            VERSION_CACHE["timestamp"] = 0
        updated_ver = get_version_info(force_refresh=True, allow_auto_trigger=False)
        with METRICS_LOCK:
            if isinstance(METRICS_CACHE, dict):
                METRICS_CACHE["version_info"] = updated_ver
            _invalidate_metrics_bytes_cache()

        combined_output = "\n".join([line for line in out_lines if line]).strip()
        now_str = datetime.now().strftime("%H:%M:%S")
        disp_ver = get_display_version(new_ver)

        overall_ok = bool(pull_ok and (deb_ok or not should_install_deb or not do_git_pull))
        if not do_git_pull:
            overall_ok = bool(deb_ok)

        with AUTO_INSTALL_LOCK:
            AUTO_INSTALL_STATE["in_progress"] = False
            AUTO_INSTALL_STATE["last_installed_at"] = now_str
            AUTO_INSTALL_STATE["last_output"] = combined_output
            if overall_ok:
                AUTO_INSTALL_STATE["last_status"] = f"Al día · v{disp_ver} ({now_str})"
            elif pull_ok and not deb_ok:
                AUTO_INSTALL_STATE["last_status"] = f"Código actualizado · Paquete pendiente de permisos ({now_str})"
            else:
                AUTO_INSTALL_STATE["last_status"] = f"Revisión con avisos ({now_str})"

        if code_updated:
            def delayed_service_restart():
                time.sleep(1.5)
                try:
                    subprocess.run(["sudo", "-n", "systemctl", "restart", "system-dashboard.service"], capture_output=True, timeout=15)
                except Exception:
                    pass
            threading.Thread(target=delayed_service_restart, daemon=True).start()

        return {
            "success": bool(pull_ok),
            "deb_installed": bool(deb_ok),
            "code_updated": bool(code_updated),
            "web_synced": bool(code_updated),
            "restarting": bool(code_updated),
            "message": f"Comprobación y actualización v{disp_ver} completada." if pull_ok else "No se pudo completar la descarga desde GitHub.",
            "output": combined_output or "Todo está al día.",
            "version_info": updated_ver,
        }
    finally:
        with AUTO_INSTALL_LOCK:
            AUTO_INSTALL_STATE["in_progress"] = False
        AUTO_INSTALL_EXEC_LOCK.release()

def auto_install_watcher_worker():
    """
    Hilo guardián que supervisa periódicamente si existe una nueva versión en GitHub
    o un paquete local `.deb` pendiente de compilar/instalar y lo instala según se detecta.
    """
    time.sleep(4.0)
    while True:
        try:
            if AUTO_INSTALL_STATE.get("enabled", True):
                now_ts = time.time()
                ver_target = get_app_version()
                inst_ver = get_installed_deb_version()
                build_script = os.path.join(BASE_DIR, "packaging", "build_deb.sh")
                in_perm_cooldown = (now_ts < AUTO_INSTALL_STATE.get("perm_cooldown_until", 0.0))
                if not in_perm_cooldown and os.path.isfile(build_script) and os.path.isfile("/usr/bin/recursos-cockpit") and (
                    not inst_ver
                    or _parse_semver_tuple(inst_ver) < _parse_semver_tuple(ver_target)
                ):
                    perform_auto_update_and_install(trigger_source="local_package_detected", do_git_pull=False)

                info = get_version_info(force_refresh=False, allow_auto_trigger=False)
                if info.get("update_available") and not info.get("ahead_of_remote"):
                    perform_auto_update_and_install(trigger_source="github_ota_detected", do_git_pull=True)
        except Exception as e:
            print(f"[-] Advertencia en auto_install_watcher_worker: {e}")
        time.sleep(60)

def get_version_info(force_refresh=False, allow_auto_trigger=True):
    """
    Obtiene la versión actual instalada localmente y la compara con GitHub (cminewarIA/recursos-ui)
    evitando falsos positivos cuando la copia local está por delante o carece de .git.
    """
    now = time.time()
    with VERSION_LOCK:
        if not force_refresh and VERSION_CACHE["data"] and (now - VERSION_CACHE["timestamp"] < 60):
            cached_copy = dict(VERSION_CACHE["data"])
            cached_copy["auto_install_enabled"] = AUTO_INSTALL_STATE.get("enabled", True)
            cached_copy["auto_install_in_progress"] = AUTO_INSTALL_STATE.get("in_progress", False)
            cached_copy["auto_install_status"] = AUTO_INSTALL_STATE.get("last_status", "")
            cached_copy["last_auto_install"] = AUTO_INSTALL_STATE.get("last_installed_at", "")
            return cached_copy

    _ensure_git_safe_directory()
    pkg_version = get_app_version()
    disp_version = get_display_version(pkg_version)
    has_git = os.path.isdir(os.path.join(BASE_DIR, ".git"))

    local_sha = "local"
    local_full_sha = ""
    local_msg = "Versión instalada en este equipo"
    local_date = datetime.now().strftime("%Y-%m-%d %H:%M")
    local_branch = GITHUB_BRANCH
    local_recent_commits = []

    if has_git:
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

            p_hist = subprocess.run(["git", "log", "-5", "--format=%h|%s|%ci"], cwd=BASE_DIR, capture_output=True, text=True, timeout=2)
            if p_hist.returncode == 0 and p_hist.stdout.strip():
                for line in p_hist.stdout.strip().splitlines():
                    ps = line.split("|")
                    if len(ps) >= 3:
                        local_recent_commits.append({
                            "sha": ps[0].strip(),
                            "message": ps[1].strip(),
                            "date": ps[2].strip()[:16],
                            "is_local_head": (ps[0].strip() == local_sha),
                        })
        except Exception:
            pass

    remote_sha = local_sha
    remote_full_sha = local_full_sha
    remote_msg = local_msg
    remote_date = local_date
    remote_author = "cminewarIA"
    remote_version = pkg_version
    recent_commits = []
    github_reachable = False

    # 1. Obtener primero versión SemVer canónica publicada en GitHub (sin límite de API REST)
    raw_ver_fetched = False
    try:
        raw_ver_url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}/VERSION"
        req_rv = urllib.request.Request(raw_ver_url, headers={"User-Agent": "Recursos-Server-Monitor/12.0"})
        with urllib.request.urlopen(req_rv, timeout=3.0) as rv_resp:
            if rv_resp.status == 200:
                rv_txt = rv_resp.read().decode("utf-8", errors="ignore").strip().lstrip("vV")
                if rv_txt:
                    remote_version = rv_txt
                    github_reachable = True
                    raw_ver_fetched = True
    except Exception:
        pass
    if not raw_ver_fetched and has_git:
        try:
            p_rv = subprocess.run(
                ["git", "show", f"origin/{GITHUB_BRANCH}:VERSION"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=2
            )
            if p_rv.returncode == 0 and p_rv.stdout.strip():
                remote_version = p_rv.stdout.strip().lstrip("vV")
        except Exception:
            pass

    # 2. Consultar commits REST API solo bajo demanda o cada 5 min para no agotar cuota de GitHub
    commits_cache_age = now - _GITHUB_COMMITS_CACHE.get("timestamp", 0.0)
    should_query_commits_api = bool(
        force_refresh
        or _GITHUB_COMMITS_CACHE.get("timestamp", 0.0) == 0.0
        or commits_cache_age >= 300.0
        or (raw_ver_fetched and remote_version != _GITHUB_COMMITS_CACHE.get("version"))
    )

    if should_query_commits_api:
        try:
            api_url = f"https://api.github.com/repos/{GITHUB_REPO}/commits?sha={GITHUB_BRANCH}&per_page=5"
            req = urllib.request.Request(
                api_url,
                headers={
                    "User-Agent": "Recursos-Server-Monitor/12.0",
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
                        _GITHUB_COMMITS_CACHE.update({
                            "recent_commits": list(recent_commits),
                            "remote_full_sha": remote_full_sha,
                            "remote_sha": remote_sha,
                            "remote_msg": remote_msg,
                            "remote_date": remote_date,
                            "remote_author": remote_author,
                            "version": remote_version,
                            "timestamp": now,
                        })
        except Exception:
            pass

    if not recent_commits and _GITHUB_COMMITS_CACHE.get("recent_commits"):
        recent_commits = [
            {**rc, "is_local_head": (rc.get("sha") == local_sha)}
            for rc in _GITHUB_COMMITS_CACHE["recent_commits"]
        ]
        if not remote_full_sha and _GITHUB_COMMITS_CACHE.get("remote_full_sha"):
            remote_full_sha = _GITHUB_COMMITS_CACHE["remote_full_sha"]
            remote_sha = _GITHUB_COMMITS_CACHE["remote_sha"] or remote_full_sha[:7]
            remote_msg = _GITHUB_COMMITS_CACHE["remote_msg"] or remote_msg
            remote_date = _GITHUB_COMMITS_CACHE["remote_date"] or remote_date
            remote_author = _GITHUB_COMMITS_CACHE["remote_author"] or remote_author

    if (not remote_full_sha or remote_full_sha == local_full_sha) and has_git and (force_refresh or not raw_ver_fetched):
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

    if not recent_commits and local_recent_commits:
        recent_commits = local_recent_commits

    _any_dirty, code_dirty, _mod_paths = _get_git_status_summary() if has_git else (False, False, [])
    local_clean = not code_dirty

    ahead_of_remote = False
    update_available = False
    behind_count = 0

    local_tuple = _parse_semver_tuple(pkg_version)
    remote_tuple = _parse_semver_tuple(remote_version) if remote_version else local_tuple

    if github_reachable and remote_version and remote_tuple > local_tuple:
        update_available = True
        ahead_of_remote = False
    elif github_reachable and remote_version and local_tuple > remote_tuple:
        ahead_of_remote = True
        update_available = False
    elif has_git and github_reachable and remote_full_sha and local_full_sha and remote_full_sha != local_full_sha:
        try:
            p_anc = subprocess.run(
                ["git", "merge-base", "--is-ancestor", remote_full_sha, "HEAD"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=2
            )
            if p_anc.returncode == 0:
                ahead_of_remote = True
                update_available = False
            elif not local_clean:
                ahead_of_remote = True
                update_available = False
            else:
                update_available = True
        except Exception:
            update_available = bool(local_clean and remote_sha != local_sha)
    elif has_git and github_reachable and remote_sha and local_sha not in ("local", "desconocido") and remote_sha != local_sha:
        if not local_clean:
            ahead_of_remote = True
            update_available = False
        else:
            update_available = True

    if update_available and recent_commits:
        for idx, rc in enumerate(recent_commits):
            if rc.get("sha") == local_sha:
                behind_count = idx
                break
        if behind_count == 0:
            behind_count = 1

    installed_deb_ver = get_installed_deb_version()
    package_installed = bool(installed_deb_ver)
    desktop_bin_exists = os.path.isfile("/usr/bin/recursos-cockpit")
    package_needs_install = bool(desktop_bin_exists and (not installed_deb_ver or _parse_semver_tuple(installed_deb_ver) < local_tuple))
    in_perm_cooldown = (now < AUTO_INSTALL_STATE.get("perm_cooldown_until", 0.0))

    can_auto_pull = bool(update_available and not ahead_of_remote)
    can_auto_deb = bool(package_needs_install and not in_perm_cooldown)

    if (
        allow_auto_trigger
        and AUTO_INSTALL_STATE.get("enabled", True)
        and (can_auto_pull or can_auto_deb)
        and not AUTO_INSTALL_STATE.get("in_progress", False)
        and (now - AUTO_INSTALL_STATE.get("last_attempt_ts", 0.0) > 25.0)
    ):
        threading.Thread(
            target=perform_auto_update_and_install,
            kwargs={"trigger_source": "detected_on_check", "do_git_pull": can_auto_pull},
            daemon=True,
        ).start()

    remote_disp = get_display_version(remote_version) if remote_version else disp_version
    pub_dom = detect_system_dns_domain()
    result = {
        "version": pkg_version,
        "current_version": pkg_version,
        "display_version": disp_version,
        "server_version": pkg_version,
        "server_display_version": disp_version,
        "remote_version": remote_version,
        "remote_display_version": remote_disp,
        "installed_deb_version": installed_deb_ver or pkg_version,
        "package_installed": package_installed,
        "package_needs_install": package_needs_install,
        "auto_install_enabled": AUTO_INSTALL_STATE.get("enabled", True),
        "auto_install_in_progress": AUTO_INSTALL_STATE.get("in_progress", False),
        "auto_install_status": AUTO_INSTALL_STATE.get("last_status", ""),
        "last_auto_install": AUTO_INSTALL_STATE.get("last_installed_at", ""),
        "has_git": has_git,
        "ahead_of_remote": ahead_of_remote,
        "repo": GITHUB_REPO,
        "repo_url": f"https://github.com/{GITHUB_REPO}",
        "branch": local_branch,
        "local_hash": local_sha,
        "local_commit": local_sha,
        "local_full_hash": local_full_sha,
        "local_subject": local_msg,
        "local_date": local_date,
        "local_clean": local_clean,
        "remote_hash": remote_sha,
        "remote_commit": remote_sha,
        "remote_full_hash": remote_full_sha,
        "remote_subject": remote_msg,
        "remote_date": remote_date,
        "remote_author": remote_author,
        "behind_count": behind_count,
        "commits_behind": behind_count,
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
_AUTH_SECRET_CACHE = {"path": None, "mtime_ns": None, "size": None, "secret": None}
TOKEN_MAX_AGE_SEC = 31536000       # 365 días de validez máxima
TOKEN_ROTATION_AGE_SEC = 15552000  # Rotación proactiva a los 180 días en sesiones activas
_DEVICE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{3,64}$")
_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")

def get_auth_secret():
    """Obtiene o genera la clave secreta de 256 bits con caché en memoria invalidada por ruta/mtime."""
    with AUTH_SECRET_LOCK:
        target_path = AUTH_SECRET_FILE
        try:
            st = os.stat(target_path)
            if (
                _AUTH_SECRET_CACHE["secret"] is not None
                and _AUTH_SECRET_CACHE["path"] == target_path
                and _AUTH_SECRET_CACHE["mtime_ns"] == st.st_mtime_ns
                and _AUTH_SECRET_CACHE["size"] == st.st_size
            ):
                return _AUTH_SECRET_CACHE["secret"]
            with open(target_path, 'rb') as f:
                sec = f.read().strip()
                if len(sec) >= 32:
                    _AUTH_SECRET_CACHE.update({
                        "path": target_path,
                        "mtime_ns": st.st_mtime_ns,
                        "size": st.st_size,
                        "secret": sec,
                    })
                    return sec
        except FileNotFoundError:
            pass
        except Exception:
            if _AUTH_SECRET_CACHE["secret"] is not None and _AUTH_SECRET_CACHE["path"] == target_path:
                return _AUTH_SECRET_CACHE["secret"]

        # Generar clave secreta criptográficamente segura de 32 bytes
        new_secret = secrets.token_bytes(32)
        st_mtime = None
        st_size = None
        try:
            tmp_secret = f"{target_path}.tmp"
            with open(tmp_secret, 'wb') as f:
                f.write(new_secret)
            os.chmod(tmp_secret, 0o600)
            os.replace(tmp_secret, target_path)
            st = os.stat(target_path)
            st_mtime = st.st_mtime_ns
            st_size = st.st_size
        except Exception as e:
            print(f"[-] Advertencia creando .auth_secret: {e}")
        _AUTH_SECRET_CACHE.update({
            "path": target_path,
            "mtime_ns": st_mtime,
            "size": st_size,
            "secret": new_secret,
        })
        return new_secret

def create_device_token(device_id):
    """Genera un token firmado con HMAC-SHA256 para un ID de dispositivo."""
    clean_id = str(device_id or "").strip()
    if not _DEVICE_ID_RE.match(clean_id):
        clean_id = re.sub(r"[^a-zA-Z0-9_-]", "", clean_id)[:64] or f"dev_{secrets.token_hex(6)}"
    secret = get_auth_secret()
    ts = int(time.time())
    nonce = secrets.token_hex(16)
    payload = f"{clean_id}:{ts}:{nonce}"
    sig = hmac.new(secret, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{clean_id}.{ts}.{nonce}.{sig}"

def parse_verified_device_token(token_str):
    """
    Valida formato estricto, expiración, deriva futura y firma HMAC-SHA256 en tiempo constante.
    Retorna (device_id, timestamp_int) si es válido, o (None, None) en caso contrario.
    """
    if not token_str or not isinstance(token_str, str):
        return None, None
    clean_tok = token_str.strip()
    if not clean_tok or len(clean_tok) > 256:
        return None, None
    parts = clean_tok.split('.')
    if len(parts) != 4:
        return None, None
    device_id, ts, nonce, sig = parts
    if not _DEVICE_ID_RE.match(device_id):
        return None, None
    if not ts.isdigit():
        return None, None
    if not (8 <= len(nonce) <= 64 and _HEX_RE.match(nonce)):
        return None, None
    if len(sig) != 64 or not _HEX_RE.match(sig):
        return None, None
    try:
        ts_int = int(ts)
        now_ts = time.time()
        if (now_ts - ts_int) > TOKEN_MAX_AGE_SEC or (ts_int - now_ts) > 86400:
            return None, None
    except Exception:
        return None, None
    payload = f"{device_id}:{ts}:{nonce}"
    secret = get_auth_secret()
    expected_sig = hmac.new(secret, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig.lower(), expected_sig):
        return device_id, ts_int
    return None, None

def verify_device_token(token_str):
    """
    Verifica criptográficamente la firma HMAC del token en tiempo constante.
    Valida además que el token no haya expirado (máximo 1 año de validez).
    Retorna el device_id si es válido, o None si es inválido o fue manipulado.
    """
    dev_id, _ = parse_verified_device_token(token_str)
    return dev_id

_NEIGH_MAC_CACHE = {}
_NEIGH_MAC_CACHE_LOCK = threading.Lock()
_DEVICE_IDENTITY_CACHE = {"by_id": {}, "by_ip": {}, "updated_at": 0.0}
_DEVICE_IDENTITY_CACHE_LOCK = threading.Lock()


def _refresh_device_identity_cache(devices):
    """Mantiene un índice rápido en memoria (ID/alias/IP -> nombre de dispositivo) para enriquecer logs HTTP sin I/O."""
    if not isinstance(devices, dict):
        return
    by_id = {}
    by_ip = {}
    for dev_k, entry in devices.items():
        if not isinstance(entry, dict):
            continue
        dev_name = str(entry.get("custom_alias") or entry.get("name") or "").strip()
        if not dev_name:
            continue
        dev_id = str(entry.get("id") or dev_k).strip()
        if dev_id:
            by_id[dev_id] = dev_name
        for aid in (entry.get("alias_ids") or []):
            aid_s = str(aid or "").strip()
            if aid_s:
                by_id[aid_s] = dev_name
        for ip_cand in (
            entry.get("local_ip"),
            entry.get("last_external_ip"),
            (entry.get("device_telemetry") or {}).get("local_ip") if isinstance(entry.get("device_telemetry"), dict) else "",
        ):
            norm = _normalize_ip_str(ip_cand)
            if norm and not norm.startswith("Externo"):
                by_ip[norm] = dev_name
        for obs in (entry.get("observed_ips") or []):
            if isinstance(obs, dict):
                norm = _normalize_ip_str(obs.get("ip"))
                if norm:
                    by_ip.setdefault(norm, dev_name)
    with _DEVICE_IDENTITY_CACHE_LOCK:
        _DEVICE_IDENTITY_CACHE["by_id"] = by_id
        _DEVICE_IDENTITY_CACHE["by_ip"] = by_ip
        _DEVICE_IDENTITY_CACHE["updated_at"] = time.time()


def _is_meaningful_device_value(val):
    """Determina si un valor de telemetría aporta información real y no debe sobrescribir datos ricos."""
    if val is None:
        return False
    if isinstance(val, bool):
        return True
    if isinstance(val, (int, float)):
        return val != 0
    s = str(val).strip()
    if not s:
        return False
    low = s.lower()
    return low not in (
        "unknown",
        "desconocido",
        "dispositivo desconocido",
        "cliente web",
        "cliente web linux",
        "cliente web windows",
        "web",
        "generic",
        "n/a",
        "none",
        "--",
        "00:00:00:00:00:00",
    )


def _merge_observed_ips(existing_list, new_ip, mode, now_iso, extra_list=None):
    """Consolida de forma incremental todas las direcciones IP observadas por el dispositivo físico."""
    by_ip = {}
    for src in (existing_list or [], extra_list or []):
        if not isinstance(src, list):
            continue
        for item in src:
            if isinstance(item, str):
                ip_c = _normalize_ip_str(item)
                if not ip_c or ip_c.startswith("Externo"):
                    continue
                by_ip[ip_c] = {
                    "ip": ip_c,
                    "mode": "LAN" if is_local_ip(ip_c) else "WAN",
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                }
            elif isinstance(item, dict):
                ip_c = _normalize_ip_str(item.get("ip"))
                if not ip_c or ip_c.startswith("Externo"):
                    continue
                prev = by_ip.get(ip_c)
                f_seen = str(item.get("first_seen") or now_iso)
                l_seen = str(item.get("last_seen") or now_iso)
                m_val = str(item.get("mode") or ("LAN" if is_local_ip(ip_c) else "WAN")).upper()
                if prev:
                    if f_seen and (not prev["first_seen"] or f_seen < prev["first_seen"]):
                        prev["first_seen"] = f_seen
                    if l_seen and (not prev["last_seen"] or l_seen > prev["last_seen"]):
                        prev["last_seen"] = l_seen
                    if m_val in ("LAN", "WAN"):
                        prev["mode"] = m_val
                else:
                    by_ip[ip_c] = {
                        "ip": ip_c,
                        "mode": m_val if m_val in ("LAN", "WAN") else ("LAN" if is_local_ip(ip_c) else "WAN"),
                        "first_seen": f_seen,
                        "last_seen": l_seen,
                    }

    clean_new = _normalize_ip_str(new_ip)
    if clean_new and not clean_new.startswith("Externo"):
        norm_mode = "LAN" if mode == "LAN" else "WAN"
        if clean_new in by_ip:
            by_ip[clean_new]["last_seen"] = now_iso
            by_ip[clean_new]["mode"] = norm_mode
        else:
            by_ip[clean_new] = {
                "ip": clean_new,
                "mode": norm_mode,
                "first_seen": now_iso,
                "last_seen": now_iso,
            }

    ordered = sorted(by_ip.values(), key=lambda x: str(x.get("last_seen") or ""), reverse=True)
    return ordered[:20]


def resolve_arp_mac_for_ip(ip_str):
    """
    Resuelve dinámicamente la dirección MAC física para una IP local combinando:
      1. Interfaces físicas del propio servidor (/sys/class/net) si corresponde al host
      2. Tabla ARP del kernel (/proc/net/arp)
      3. Tabla de vecinos `ip neigh` (IPv4/IPv6 y entradas STALE/REACHABLE) con caché breve
      4. Catálogo en memoria de ARP/Pi-hole/Router
    """
    clean_ip = _normalize_ip_str(ip_str)
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

    now_ts = time.time()
    with _NEIGH_MAC_CACHE_LOCK:
        cached = _NEIGH_MAC_CACHE.get(clean_ip)
        if cached and (now_ts - cached[1]) < 30.0:
            return cached[0]

    found_mac = ""
    try:
        if os.path.isfile("/proc/net/arp"):
            with open("/proc/net/arp", "r", encoding="utf-8") as f:
                for line in f.readlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 4 and parts[0] == clean_ip:
                        mac = parts[3].strip().lower()
                        if mac and mac != "00:00:00:00:00:00":
                            found_mac = mac
                            break
    except Exception:
        pass

    if not found_mac and shutil.which("ip"):
        try:
            ipaddress.ip_address(clean_ip)
            proc = subprocess.run(
                ["ip", "neigh", "show", "to", clean_ip],
                capture_output=True,
                text=True,
                timeout=0.6,
            )
            if proc.returncode == 0 and proc.stdout:
                m_ll = re.search(r"lladdr\s+([0-9a-fA-F:]{17})", proc.stdout)
                if m_ll:
                    cand = m_ll.group(1).strip().lower()
                    if cand and cand != "00:00:00:00:00:00":
                        found_mac = cand
        except Exception:
            pass

    if not found_mac:
        try:
            arp_map = get_arp_and_pihole_names()
            if isinstance(arp_map, dict):
                for mac_k, info in arp_map.items():
                    if isinstance(info, dict) and _normalize_ip_str(info.get("ip")) == clean_ip:
                        cand = str(mac_k or "").strip().lower()
                        if cand and cand != "00:00:00:00:00:00":
                            found_mac = cand
                            break
        except Exception:
            pass

    with _NEIGH_MAC_CACHE_LOCK:
        if len(_NEIGH_MAC_CACHE) > 256:
            _NEIGH_MAC_CACHE.clear()
        _NEIGH_MAC_CACHE[clean_ip] = (found_mac, now_ts)
    return found_mac


def normalize_lan_ip(ip_str):
    """Normaliza IPs de loopback hacia la IP LAN real del servidor para unificar identidad física."""
    clean_ip = _normalize_ip_str(ip_str)
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
    os_str = f"{t.get('os_distro', '')} {t.get('os_info', '')} {t.get('platform', '')} {t.get('client_type', '')} {ua or ''}".lower()
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


def extract_client_descriptor(ua, tel=None, client_ip="", is_local=True, now_iso="", prev_client=None):
    """
    Construye el descriptor del cliente/contenedor (App Nativa vs Navegador Web)
    que se conecta desde un dispositivo físico, preservando primera visita y metadatos.
    """
    t = tel if isinstance(tel, dict) else {}
    prev = prev_client if isinstance(prev_client, dict) else {}
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
    browser = str(t.get("browser_name") or "").strip() or "Web"
    if c_type == "ubuntu_native":
        c_key = "ubuntu_native"
        c_label = "App Nativa Ubuntu (.deb)"
        browser = "GTK3 + WebKit2"
    elif c_type == "android_native":
        c_key = "android_native"
        c_label = str(t.get("client_label") or "App Nativa Android (.apk)")
        browser = "Kotlin + WebView"
    else:
        if browser == "Web":
            if "edg/" in ua_lower or "edga/" in ua_lower or "edgios/" in ua_lower:
                browser = "Edge"
            elif "opr/" in ua_lower or "opera" in ua_lower:
                browser = "Opera"
            elif "brave" in ua_lower:
                browser = "Brave"
            elif "vivaldi" in ua_lower:
                browser = "Vivaldi"
            elif "samsungbrowser/" in ua_lower:
                browser = "Samsung Internet"
            elif "firefox/" in ua_lower or "fxios/" in ua_lower:
                browser = "Firefox"
            elif "chrome/" in ua_lower or "crios/" in ua_lower:
                browser = "Chrome"
            elif "safari/" in ua_lower and "chrome" not in ua_lower:
                browser = "Safari"
        c_key = f"web_{re.sub(r'[^a-z0-9]+', '_', browser.lower()).strip('_') or 'browser'}"
        c_label = f"Navegador Web ({browser})"

    ts_now = now_iso or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    first_seen = str(prev.get("first_seen") or ts_now)
    install_id = str(t.get("install_id") or t.get("installation_id") or prev.get("install_id") or "").strip()[:64]
    app_ver = str(t.get("client_version") or t.get("app_version") or prev.get("app_version") or "").strip()[:32]

    return {
        "client_key": c_key,
        "client_type": c_type,
        "client_label": c_label,
        "browser_engine": browser,
        "access_level": "FULL_NATIVE_ACCESS" if is_nat else "WEB_SANDBOX",
        "full_access": is_nat,
        "connection_mode": "LAN" if is_local else "WAN",
        "ip": normalize_lan_ip(client_ip) if is_local else client_ip,
        "user_agent": ua_str[:240] or str(prev.get("user_agent") or "")[:240],
        "app_version": app_ver,
        "install_id": install_id,
        "first_seen": first_seen,
        "last_seen": ts_now,
    }


def compute_physical_device_key(entry_or_tel, client_ip="", ua="", is_local=True):
    """
    Calcula la clave canónica única del dispositivo físico (Zero-Trust Hardware Identity)
    unificando múltiples navegadores y apps nativas del mismo equipo:
      1. Dirección MAC física (resuelta por telemetría, ARP, ip neigh o catálogo Pi-hole/router)
      2. Identificador de hardware nativo (ubn_* / and_*)
      3. IP LAN real verificada (sin fragmentar por cambios de User-Agent / Modo Escritorio)
      4. Modelo + fabricante + familia SO
      5. Huella/ID de hardware web persistente
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

    hw_id = normalize_hardware_id(d.get("hardware_id") or tel.get("hardware_id") or "")
    if hw_id and not hw_id.startswith("web_"):
        return f"phys_hw_{hw_id}"

    if lan_ip and not lan_ip.startswith("Externo") and is_local_ip(lan_ip):
        return f"phys_lan_{lan_ip}"

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


def _merge_telemetry_incremental(prev_tel, incoming_tel, prev_is_native=False, incoming_is_native=False):
    """
    Fusión incremental (merge-never-downgrade):
    - Nunca sobrescribe datos reales con vacíos o valores genéricos.
    - Protege atributos ricos de hardware/SO/arquitectura/MAC/root recopilados por apps nativas o navegadores más detallados.
    """
    protected_rich_keys = {
        "hardware_id", "manufacturer", "brand", "model", "board", "chassis_type",
        "hostname", "os_distro", "os_info", "kernel", "arch", "architecture", "supported_abis",
        "cpu_model", "cpu_cores_physical", "cpu_cores_logical", "gpu_model",
        "ram_total_gb", "ram_total_bytes", "storage_total_gb", "storage_free_gb",
        "mac_address", "interface_name", "root_access", "root_method", "client_version",
        "device_codename", "hardware_soc", "security_patch", "bios_version",
    }
    merged = dict(prev_tel) if isinstance(prev_tel, dict) else {}
    inc = incoming_tel if isinstance(incoming_tel, dict) else {}
    for k, v in inc.items():
        if not _is_meaningful_device_value(v):
            continue
        existing_val = merged.get(k)
        has_existing = _is_meaningful_device_value(existing_val)
        if k == "root_access":
            # Solo actualizar root_access desde cliente nativo o si no existía valor previo
            if incoming_is_native or not has_existing:
                merged[k] = bool(v)
            continue
        if prev_is_native and not incoming_is_native and k in protected_rich_keys and has_existing:
            continue
        if k in protected_rich_keys and has_existing and not incoming_is_native:
            # Entre navegadores, conservar el valor más descriptivo (más largo) para no perder detalle
            if isinstance(v, str) and isinstance(existing_val, str) and len(v.strip()) < len(existing_val.strip()):
                continue
        merged[k] = v
    return merged


def consolidate_devices_by_hardware(devices):
    """
    Unifica y agrupa registros en trusted_devices.json que pertenezcan al mismo
    dispositivo físico, garantizando 1 certificado por dispositivo físico y
    conservando todos los clientes, IPs observadas, IDs de instalación y telemetría rica.
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
        norm_hw = normalize_hardware_id(raw_v.get("hardware_id") or tel.get("hardware_id") or "")
        mac_addr = str(tel.get("mac_address") or raw_v.get("mac_address") or resolve_arp_mac_for_ip(lan_ip) or "").strip().lower()
        raw_install_ids = {
            str(x).strip()
            for x in (
                list(raw_v.get("installation_ids") or [])
                + [tel.get("install_id"), tel.get("installation_id"), norm_hw]
            )
            if x and str(x).strip()
        }

        # Buscar si ya existe un grupo para este mismo equipo físico (por phys_key, MAC, hardware_id, install_id o IP LAN)
        matched_key = None
        if phys_key in grouped_by_phys:
            matched_key = phys_key
        else:
            for existing_pk, existing_entry in grouped_by_phys.items():
                ex_tel = existing_entry.get("device_telemetry") if isinstance(existing_entry.get("device_telemetry"), dict) else {}
                ex_lan = normalize_lan_ip(existing_entry.get("local_ip") or ex_tel.get("local_ip") or "")
                ex_hw = normalize_hardware_id(existing_entry.get("hardware_id") or ex_tel.get("hardware_id") or "")
                ex_mac = str(ex_tel.get("mac_address") or existing_entry.get("mac_address") or "").strip().lower()
                ex_install_ids = {
                    str(x).strip()
                    for x in (
                        list(existing_entry.get("installation_ids") or [])
                        + [ex_tel.get("install_id"), ex_tel.get("installation_id"), ex_hw]
                    )
                    if x and str(x).strip()
                }

                if mac_addr and ex_mac and mac_addr == ex_mac and mac_addr != "00:00:00:00:00:00":
                    matched_key = existing_pk
                    break
                if norm_hw and ex_hw and norm_hw == ex_hw:
                    matched_key = existing_pk
                    break
                if raw_install_ids and ex_install_ids and (raw_install_ids & ex_install_ids):
                    matched_key = existing_pk
                    break
                if lan_ip and ex_lan and lan_ip == ex_lan and not lan_ip.startswith("Externo") and is_local_ip(lan_ip):
                    matched_key = existing_pk
                    break

        existing_clients = raw_v.get("clients") if isinstance(raw_v.get("clients"), list) else []
        cur_client_desc = extract_client_descriptor(
            ua_str,
            tel,
            lan_ip or raw_v.get("last_external_ip", ""),
            is_local=not bool(raw_v.get("last_external_ip") and not lan_ip),
            now_iso=raw_v.get("last_seen", ""),
        )
        now_fallback = raw_v.get("last_seen") or raw_v.get("first_seen") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if not matched_key:
            matched_key = phys_key
            phys_order.append(matched_key)
            base_entry = dict(raw_v)
            base_entry["id"] = dev_id
            base_entry["physical_key"] = matched_key
            alias_ids = list(dict.fromkeys([dev_id] + [str(x) for x in base_entry.get("alias_ids", []) if x]))
            base_entry["alias_ids"] = alias_ids
            base_entry["installation_ids"] = sorted(raw_install_ids)
            base_entry["observed_ips"] = _merge_observed_ips(
                base_entry.get("observed_ips"),
                lan_ip or raw_v.get("last_external_ip", ""),
                "LAN" if (lan_ip and not lan_ip.startswith("Externo")) else "WAN",
                now_fallback,
            )
            if raw_v.get("last_external_ip"):
                base_entry["observed_ips"] = _merge_observed_ips(
                    base_entry["observed_ips"], raw_v.get("last_external_ip"), "WAN", now_fallback
                )

            clients_map = {}
            for c_item in existing_clients:
                if isinstance(c_item, dict) and c_item.get("client_key"):
                    clients_map[c_item["client_key"]] = dict(c_item)
            if cur_client_desc["client_key"] not in clients_map:
                clients_map[cur_client_desc["client_key"]] = cur_client_desc
            base_entry["clients"] = list(clients_map.values())
            base_entry["certificate_serial"] = generate_certificate_serial(dev_id, matched_key)
            base_entry["certificate_scope"] = "PER_PHYSICAL_DEVICE"
            if base_entry.get("verified_in_lan") and not base_entry.get("lan_verified_at"):
                base_entry["lan_verified_at"] = base_entry.get("first_seen") or now_fallback
            if base_entry.get("verified_by_master_key") and not base_entry.get("master_verified_at"):
                base_entry["master_verified_at"] = base_entry.get("first_seen") or now_fallback
            grouped_by_phys[matched_key] = base_entry
        else:
            target = grouped_by_phys[matched_key]
            alias_ids = list(dict.fromkeys(list(target.get("alias_ids", [target["id"]])) + [dev_id] + list(raw_v.get("alias_ids", []))))
            target["alias_ids"] = alias_ids
            target["installation_ids"] = sorted(set(target.get("installation_ids") or []) | raw_install_ids)
            target["observed_ips"] = _merge_observed_ips(
                target.get("observed_ips"),
                lan_ip,
                "LAN",
                now_fallback,
                extra_list=raw_v.get("observed_ips"),
            )
            if raw_v.get("last_external_ip"):
                target["observed_ips"] = _merge_observed_ips(
                    target["observed_ips"], raw_v.get("last_external_ip"), "WAN", now_fallback
                )

            if raw_v.get("first_seen") and (not target.get("first_seen") or raw_v["first_seen"] < target["first_seen"]):
                target["first_seen"] = raw_v["first_seen"]
            if raw_v.get("last_seen") and (not target.get("last_seen") or raw_v["last_seen"] > target["last_seen"]):
                target["last_seen"] = raw_v["last_seen"]
            if raw_v.get("verified_in_lan"):
                target["verified_in_lan"] = True
                rv_lan_ts = raw_v.get("lan_verified_at") or raw_v.get("last_seen") or now_fallback
                if not target.get("lan_verified_at") or rv_lan_ts > target.get("lan_verified_at", ""):
                    target["lan_verified_at"] = rv_lan_ts
            if raw_v.get("verified_by_master_key"):
                target["verified_by_master_key"] = True
                rv_mk_ts = raw_v.get("master_verified_at") or raw_v.get("last_seen") or now_fallback
                if not target.get("master_verified_at") or rv_mk_ts > target.get("master_verified_at", ""):
                    target["master_verified_at"] = rv_mk_ts

            if raw_v.get("custom_alias") and not target.get("custom_alias"):
                target["custom_alias"] = raw_v["custom_alias"]
                target["name"] = raw_v["custom_alias"]

            target_tel = target.get("device_telemetry") if isinstance(target.get("device_telemetry"), dict) else {}
            incoming_is_native = bool(raw_v.get("full_access") or tel.get("full_access") or raw_v.get("client_type") in ("ubuntu_native", "android_native"))
            target_is_native = bool(target.get("full_access") or target_tel.get("full_access") or target.get("client_type") in ("ubuntu_native", "android_native"))

            merged_tel = _merge_telemetry_incremental(
                target_tel, tel, prev_is_native=target_is_native, incoming_is_native=incoming_is_native
            )

            if incoming_is_native and not target_is_native:
                target["client_type"] = raw_v.get("client_type") or merged_tel.get("client_type")
                target["client_label"] = raw_v.get("client_label") or merged_tel.get("client_label")
                target["access_level"] = "FULL_NATIVE_ACCESS"
                target["full_access"] = True
                merged_tel["client_type"] = target["client_type"]
                merged_tel["client_label"] = target["client_label"]
                merged_tel["access_level"] = "FULL_NATIVE_ACCESS"
                merged_tel["full_access"] = True
                if not target.get("custom_alias") and _is_meaningful_device_value(raw_v.get("name")):
                    target["name"] = raw_v["name"]
                    target["auto_name"] = raw_v.get("auto_name") or raw_v["name"]

            if mac_addr and mac_addr != "00:00:00:00:00:00" and not merged_tel.get("mac_address"):
                merged_tel["mac_address"] = mac_addr
            if merged_tel.get("mac_address"):
                target["mac_address"] = merged_tel["mac_address"]

            target["device_telemetry"] = merged_tel

            clients_map = {}
            for c_item in target.get("clients", []):
                if isinstance(c_item, dict) and c_item.get("client_key"):
                    clients_map[c_item["client_key"]] = dict(c_item)
            for c_item in existing_clients + [cur_client_desc]:
                if isinstance(c_item, dict) and c_item.get("client_key"):
                    ck = c_item["client_key"]
                    prev_c = clients_map.get(ck)
                    if not prev_c:
                        clients_map[ck] = dict(c_item)
                    else:
                        merged_c = dict(prev_c)
                        if str(c_item.get("last_seen", "")) >= str(prev_c.get("last_seen", "")):
                            for fk, fv in c_item.items():
                                if _is_meaningful_device_value(fv):
                                    merged_c[fk] = fv
                        if prev_c.get("first_seen") and (not merged_c.get("first_seen") or prev_c["first_seen"] < merged_c["first_seen"]):
                            merged_c["first_seen"] = prev_c["first_seen"]
                        clients_map[ck] = merged_c

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
            else:
                _refresh_device_identity_cache(consolidated)
            return consolidated
    except Exception:
        return {}

def save_trusted_devices(devices):
    """Guarda de forma atómica el registro de dispositivos de confianza y actualiza el índice en memoria."""
    try:
        temp_file = TRUSTED_FILE + ".tmp"
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(devices, f, indent=2, ensure_ascii=False)
        os.replace(temp_file, TRUSTED_FILE)
        _refresh_device_identity_cache(devices)
    except Exception as e:
        print(f"[-] Error guardando dispositivos de confianza: {e}")

def _normalize_ip_str(ip_str):
    """
    Normaliza direcciones IP eliminando corchetes IPv6, puertos adjuntos,
    identificadores de zona (%eth0) y envoltorios IPv4-mapped IPv6 (::ffff:x.x.x.x -> x.x.x.x).
    """
    raw = str(ip_str or "").strip()
    if not raw:
        return ""
    if raw.startswith("[") and "]" in raw:
        raw = raw[1:raw.index("]")]
    elif raw.count(":") == 1 and "." in raw:
        raw = raw.split(":", 1)[0]
    if "%" in raw:
        raw = raw.split("%", 1)[0]
    try:
        ip_obj = ipaddress.ip_address(raw)
        if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped is not None:
            return str(ip_obj.ipv4_mapped)
        return str(ip_obj)
    except Exception:
        return raw

def _is_request_https(handler):
    xfp = str(handler.headers.get('X-Forwarded-Proto') or '')
    protos = [p.strip().lower() for p in xfp.split(',') if p.strip()]
    x_ssl = str(handler.headers.get('X-Forwarded-Ssl') or '').strip().lower()
    return ('https' in protos) or (x_ssl == 'on') or bool(getattr(handler, 'is_https', False))

def _has_trust_cookie(handler):
    cookie_header = str(handler.headers.get('Cookie') or '')
    return '_sysmon_trust=' in cookie_header

def get_cookie_header_value(handler, token):
    """
    Construye la cabecera Set-Cookie con HttpOnly estricto.
    Usa SameSite=Lax (más fiable y persistente en navegadores modernos y WebViews)
    y activa Secure automáticamente cuando el tráfico llega por HTTPS / reverse proxy.
    """
    if _is_request_https(handler):
        return f"_sysmon_trust={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure"
    return f"_sysmon_trust={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax"

def get_clear_cookie_header_value(handler):
    """Construye la cabecera Set-Cookie para invalidar cookies revocadas o caducadas."""
    if _is_request_https(handler):
        return "_sysmon_trust=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax; Secure"
    return "_sysmon_trust=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"

def _is_trusted_proxy_ip(ip_str):
    norm_ip = _normalize_ip_str(ip_str)
    if not norm_ip:
        return False
    norm_server_ip = _normalize_ip_str(SERVER_LOCAL_IP)
    if norm_ip in ('127.0.0.1', '::1', 'localhost') or (norm_server_ip and norm_ip == norm_server_ip):
        return True
    try:
        ip_obj = ipaddress.ip_address(norm_ip)
        return ip_obj.is_loopback or (ip_obj in ipaddress.ip_network('172.16.0.0/12'))
    except Exception:
        return False

def get_client_ip(handler):
    """
    Extrae la IP real del cliente con validación estricta anti-spoofing (rightmost-untrusted).
    Acepta cabeceras de proxy inverso (CF-Connecting-IP, X-Real-IP, X-Forwarded-For, X-Recursos-Origin-IP)
    únicamente si el socket directo proviene de loopback, la IP local del servidor o bridges Docker.
    """
    raw_direct = handler.client_address[0] if getattr(handler, 'client_address', None) else ''
    direct_ip = _normalize_ip_str(raw_direct)
    hdrs = getattr(handler, 'headers', None)
    if hdrs and _is_trusted_proxy_ip(direct_ip):
        for single_hdr in ('CF-Connecting-IP', 'X-Real-IP', 'X-Recursos-Origin-IP'):
            h_val = hdrs.get(single_hdr)
            if h_val:
                cand = _normalize_ip_str(h_val)
                if cand:
                    try:
                        ipaddress.ip_address(cand)
                        return cand
                    except Exception:
                        pass
        xff = hdrs.get('X-Forwarded-For')
        if xff:
            valid_parts = []
            for raw_part in xff.split(','):
                if not raw_part.strip():
                    continue
                cand = _normalize_ip_str(raw_part)
                try:
                    ipaddress.ip_address(cand)
                    valid_parts.append(cand)
                except Exception:
                    continue
            if valid_parts:
                for part in reversed(valid_parts):
                    if not _is_trusted_proxy_ip(part):
                        return part
                return valid_parts[0]
    return direct_ip


def resolve_log_client_identity(handler):
    """
    Devuelve la cadena de origen real para los logs HTTP: `IP (NombreDispositivo)`
    cuando existe un dispositivo certificado o identificado en red local, o solo la IP real.
    """
    real_ip = get_client_ip(handler) or "-"
    dev_name = ""
    try:
        with _DEVICE_IDENTITY_CACHE_LOCK:
            cache_age = time.time() - _DEVICE_IDENTITY_CACHE["updated_at"]
            by_id = dict(_DEVICE_IDENTITY_CACHE["by_id"])
            by_ip = dict(_DEVICE_IDENTITY_CACHE["by_ip"])
        if not by_id and not by_ip and cache_age > 5.0 and os.path.exists(TRUSTED_FILE):
            with TRUST_LOCK:
                load_trusted_devices()
            with _DEVICE_IDENTITY_CACHE_LOCK:
                by_id = dict(_DEVICE_IDENTITY_CACHE["by_id"])
                by_ip = dict(_DEVICE_IDENTITY_CACHE["by_ip"])

        hdrs = getattr(handler, 'headers', None)
        if hdrs:
            tok = ""
            auth_h = hdrs.get('Authorization', '')
            if auth_h and auth_h.lower().startswith('bearer '):
                tok = auth_h[7:].strip()
            if not tok:
                tok = hdrs.get('X-Device-Token', '').strip()
            if not tok:
                cookie_h = hdrs.get('Cookie', '')
                if '_sysmon_trust=' in cookie_h:
                    c_obj = cookies.SimpleCookie()
                    try:
                        c_obj.load(cookie_h)
                        if '_sysmon_trust' in c_obj:
                            tok = str(c_obj['_sysmon_trust'].value or '').strip()
                    except Exception:
                        pass
            if tok:
                vid = verify_device_token(tok)
                if vid and vid in by_id:
                    dev_name = by_id[vid]
            if not dev_name:
                h_name = str(hdrs.get('X-Recursos-Device-Name') or '').strip()
                if h_name and _is_trusted_proxy_ip(handler.client_address[0] if getattr(handler, 'client_address', None) else ''):
                    dev_name = h_name[:48]

        if not dev_name and real_ip and real_ip != "-":
            norm_r = normalize_lan_ip(real_ip) if is_local_ip(real_ip) else real_ip
            dev_name = by_ip.get(real_ip) or by_ip.get(norm_r) or ""
            if not dev_name and is_local_ip(real_ip):
                if real_ip in ("127.0.0.1", "::1", SERVER_LOCAL_IP):
                    dev_name = socket.gethostname()
    except Exception:
        pass

    if dev_name:
        safe_name = re.sub(r"[\r\n\t]+", " ", dev_name).strip()[:48]
        return f"{real_ip} ({safe_name})"
    return real_ip

def is_local_ip(ip_str):
    """
    Determina con total precisión si una dirección IP es local (LAN de casa, loopback o Tailscale),
    desempaquetando direcciones IPv4-mapped IPv6 (::ffff:x.x.x.x).
    Cualquier IP pública o externa fuera de estas subredes se considera EXTERIOR (Datos móviles / WAN).
    """
    try:
        clean_ip = _normalize_ip_str(ip_str)
        if not clean_ip:
            return False
        ip = ipaddress.ip_address(clean_ip)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
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
    Fusiona de forma incremental y no destructiva los metadatos de hardware, SO, arquitectura,
    red, historial de IPs y clientes conectados en el certificado único del dispositivo físico.
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

    merged_tel = _merge_telemetry_incremental(
        prev_tel, tel, prev_is_native=prev_is_native, incoming_is_native=incoming_is_native
    )

    norm_ip = normalize_lan_ip(merged_tel.get("local_ip") or (client_ip if is_local else entry.get("local_ip", "")))
    if norm_ip and not norm_ip.startswith("Externo"):
        merged_tel["local_ip"] = norm_ip
        if not merged_tel.get("mac_address"):
            arp_mac = resolve_arp_mac_for_ip(norm_ip)
            if arp_mac:
                merged_tel["mac_address"] = arp_mac

    # Registrar/actualizar el cliente actual preservando su first_seen y consolidando todos los clientes
    clients_map = {}
    existing_clients_raw = entry.get("clients")
    existing_clients_iter = (
        existing_clients_raw
        if isinstance(existing_clients_raw, list)
        else list(existing_clients_raw.values())
        if isinstance(existing_clients_raw, dict)
        else []
    )
    for c_item in existing_clients_iter:
        if isinstance(c_item, dict) and c_item.get("client_key"):
            c_copy = dict(c_item)
            c_copy["is_active_client"] = False
            clients_map[c_copy["client_key"]] = c_copy
    prelim_desc = extract_client_descriptor(ua, tel, norm_ip if is_local else client_ip, is_local=is_local, now_iso=now_iso)
    prev_same_client = clients_map.get(prelim_desc["client_key"])
    client_desc = extract_client_descriptor(
        ua, tel, norm_ip if is_local else client_ip, is_local=is_local, now_iso=now_iso, prev_client=prev_same_client
    )
    client_desc["is_active_client"] = True
    clients_map[client_desc["client_key"]] = client_desc

    all_clients = sorted(
        clients_map.values(),
        key=lambda c: (not bool(c.get("full_access")), str(c.get("last_seen", ""))),
    )
    entry["clients"] = all_clients
    entry["active_client_key"] = client_desc["client_key"]
    entry["active_client_label"] = client_desc["client_label"]

    # Acumular identificadores de instalación / hardware asociados al dispositivo físico
    install_ids = {str(x).strip() for x in (entry.get("installation_ids") or []) if x and str(x).strip()}
    for cand_id in (
        tel.get("install_id"),
        tel.get("installation_id"),
        merged_tel.get("install_id"),
        merged_tel.get("hardware_id"),
        entry.get("hardware_id"),
    ):
        if cand_id and str(cand_id).strip():
            install_ids.add(str(cand_id).strip()[:64])
    entry["installation_ids"] = sorted(install_ids)[:24]

    # Acumular historial de IPs observadas (LAN y WAN)
    active_ip = norm_ip if is_local else _normalize_ip_str(client_ip)
    entry["observed_ips"] = _merge_observed_ips(
        entry.get("observed_ips"),
        active_ip,
        "LAN" if is_local else "WAN",
        now_iso,
    )

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
        primary_client_label = str(merged_tel.get("client_label") or "App Nativa Android (.apk)")
    else:
        primary_client_label = client_desc["client_label"]

    access_level = "FULL_NATIVE_ACCESS" if has_any_native_client else "WEB_SANDBOX"
    merged_tel["client_type"] = primary_client_type
    merged_tel["client_label"] = primary_client_label
    merged_tel["access_level"] = access_level
    merged_tel["full_access"] = has_any_native_client

    # Nombre descriptivo del dispositivo físico (priorizando hardware/hostname frente a genéricos de navegador)
    custom_alias = entry.get("custom_alias", "").strip()
    hw_model_name = (
        merged_tel.get("name")
        or (
            f"{merged_tel.get('manufacturer', '')} {merged_tel.get('model', '')}".strip()
            if (_is_meaningful_device_value(merged_tel.get("manufacturer")) or _is_meaningful_device_value(merged_tel.get("model")))
            else ""
        )
        or merged_tel.get("hostname")
        or ""
    )
    if not _is_meaningful_device_value(hw_model_name):
        hw_model_name = ""
    ua_parsed_name = parse_user_agent(ua)
    device_only_ua_name = ua_parsed_name.split("•")[0].strip() if "•" in ua_parsed_name else ua_parsed_name
    auto_name = hw_model_name or device_only_ua_name or ua_parsed_name

    if custom_alias:
        entry["name"] = custom_alias
    elif auto_name and (
        not _is_meaningful_device_value(entry.get("name"))
        or entry.get("name") in ("Dispositivo", "Dispositivo desconocido", "PC", "Linux PC", "Android", "Equipo")
        or "•" in str(entry.get("name", ""))
        or incoming_is_native
        or (hw_model_name and len(hw_model_name) > len(str(entry.get("name", ""))))
    ):
        entry["name"] = auto_name

    entry["auto_name"] = auto_name
    entry["client_type"] = primary_client_type
    entry["client_label"] = primary_client_label
    entry["access_level"] = access_level
    entry["full_access"] = has_any_native_client
    entry["app_version"] = merged_tel.get("client_version") or merged_tel.get("app_version") or entry.get("app_version") or get_app_version()
    entry["os_info"] = str(merged_tel.get("os_distro") or merged_tel.get("os_info") or merged_tel.get("platform") or entry.get("os_info") or "")
    entry["architecture"] = str(merged_tel.get("arch") or merged_tel.get("architecture") or entry.get("architecture") or "")
    entry["hostname"] = str(merged_tel.get("hostname") or entry.get("hostname") or "")
    entry["mac_address"] = str(merged_tel.get("mac_address") or entry.get("mac_address") or "").lower()
    entry["model"] = str(merged_tel.get("model") or entry.get("model") or "")
    entry["manufacturer"] = str(merged_tel.get("manufacturer") or entry.get("manufacturer") or "")
    has_root_consolidated = bool(entry.get("root_access") or merged_tel.get("root_access"))
    root_method_consolidated = str(merged_tel.get("root_method") or entry.get("root_method") or "").strip()
    entry["root_access"] = has_root_consolidated
    entry["root_method"] = root_method_consolidated
    if has_root_consolidated:
        merged_tel["root_access"] = True
    if root_method_consolidated:
        merged_tel["root_method"] = root_method_consolidated

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
        entry["verified_in_lan"] = True
        entry["lan_verified_at"] = now_iso
    else:
        entry["last_external_ip"] = client_ip
        if norm_ip and not entry.get("local_ip"):
            entry["local_ip"] = norm_ip
    if ua:
        entry["user_agent"] = ua[:240]
    entry["device_telemetry"] = merged_tel
    return entry


def find_device_by_id_or_physical(devices, verified_device_id, tel, client_ip, ua, is_local, allow_wan_hw_match=False):
    """
    Localiza el registro único del dispositivo físico ya sea por su ID de certificado,
    por un alias_id fusionado previamente, o por su identidad física de hardware/red (MAC, IP LAN, hardware_id, install_id).
    En peticiones WAN sin token HMAC válido está estrictamente prohibido asociar por cabeceras de telemetría.
    """
    if verified_device_id:
        if verified_device_id in devices:
            return verified_device_id, devices[verified_device_id], False
        for ex_id, ex_dev in devices.items():
            if verified_device_id in (ex_dev.get("alias_ids") or []):
                return ex_id, ex_dev, True

    if not is_local and not (allow_wan_hw_match and tel):
        return None, None, False

    cand_phys = compute_physical_device_key(tel, client_ip, ua, is_local=is_local)
    cand_lan = normalize_lan_ip((tel or {}).get("local_ip") or (client_ip if is_local else ""))
    cand_hw = normalize_hardware_id((tel or {}).get("hardware_id") or "")
    cand_install = str((tel or {}).get("install_id") or (tel or {}).get("installation_id") or "").strip()
    cand_mac = str((tel or {}).get("mac_address") or resolve_arp_mac_for_ip(cand_lan) or "").strip().lower()

    for ex_id, ex_dev in devices.items():
        if not ex_dev.get("trusted", True):
            continue
        ex_tel = ex_dev.get("device_telemetry") if isinstance(ex_dev.get("device_telemetry"), dict) else {}
        ex_phys = ex_dev.get("physical_key") or compute_physical_device_key(ex_dev, ex_dev.get("local_ip", ""), ex_dev.get("user_agent", ""), is_local=True)
        if cand_phys and ex_phys and cand_phys == ex_phys:
            return ex_id, ex_dev, True
        ex_mac = str(ex_tel.get("mac_address") or ex_dev.get("mac_address") or "").strip().lower()
        if cand_mac and ex_mac and cand_mac == ex_mac and cand_mac != "00:00:00:00:00:00":
            return ex_id, ex_dev, True
        ex_hw = normalize_hardware_id(ex_dev.get("hardware_id") or ex_tel.get("hardware_id") or "")
        if cand_hw and ex_hw and cand_hw == ex_hw:
            return ex_id, ex_dev, True
        if cand_install and cand_install in (ex_dev.get("installation_ids") or []):
            return ex_id, ex_dev, True
        if is_local and cand_lan and not cand_lan.startswith("Externo") and is_local_ip(cand_lan):
            ex_lan = normalize_lan_ip(ex_dev.get("local_ip") or ex_tel.get("local_ip") or "")
            if cand_lan == ex_lan:
                return ex_id, ex_dev, True

    return None, None, False


def _find_trusted_match_for_token(devices, candidate_token):
    if not candidate_token:
        return None, None, False
    verified_id = verify_device_token(candidate_token)
    if not verified_id:
        return None, None, False
    if verified_id in devices:
        return verified_id, devices[verified_id], False
    for ex_id, ex_dev in devices.items():
        if verified_id in (ex_dev.get("alias_ids") or []):
            return ex_id, ex_dev, True
    return None, None, False


def _is_device_certified(entry):
    return bool(
        isinstance(entry, dict)
        and entry.get("trusted", False)
        and (entry.get("verified_in_lan", False) or entry.get("verified_by_master_key", False))
    )


def check_trust_status(handler):
    """
    Verifica el origen de la petición y valida el certificado HMAC único por dispositivo físico.
    - Bloqueo estricto Zero-Trust: fuera de la red local (WAN), solo acceden dispositivos
      previamente certificados (en red local o mediante contraseña maestra) con token
      criptográfico vigente y no revocado.
    - En red local (LAN), certifica automáticamente unificando múltiples navegadores y apps
      nativas del mismo equipo físico bajo un único certificado.
    """
    client_ip = get_client_ip(handler)
    is_local = is_local_ip(client_ip)
    norm_client_ip = normalize_lan_ip(client_ip) if is_local else client_ip

    hdr_bearer = ""
    auth_hdr = handler.headers.get('Authorization', '')
    if auth_hdr and auth_hdr.lower().startswith('bearer '):
        hdr_bearer = auth_hdr[7:].strip()
    hdr_xtoken = handler.headers.get('X-Device-Token', '').strip()
    cookie_token = ""
    cookie_header = handler.headers.get('Cookie', '')
    if cookie_header:
        c = cookies.SimpleCookie()
        try:
            c.load(cookie_header)
            if '_sysmon_trust' in c:
                cookie_token = str(c['_sysmon_trust'].value or '').strip()
        except Exception:
            pass

    hdr_telemetry = extract_header_telemetry(handler)
    ua = handler.headers.get('User-Agent', '')
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with TRUST_LOCK:
        devices = load_trusted_devices()
        token = None
        verified_device_id = None
        token_ts = None
        matched_id = None
        device_entry = None
        token_needs_unification = False

        for cand_tok in [t for t in (hdr_bearer, hdr_xtoken, cookie_token) if t]:
            m_id, m_dev, needs_uni = _find_trusted_match_for_token(devices, cand_tok)
            if m_id and _is_device_certified(m_dev):
                token = cand_tok
                matched_id = m_id
                device_entry = m_dev
                verified_device_id, token_ts = parse_verified_device_token(cand_tok)
                token_needs_unification = needs_uni
                break

        if not matched_id and is_local:
            matched_id, device_entry, token_needs_unification = find_device_by_id_or_physical(
                devices, None, hdr_telemetry, norm_client_ip, ua, is_local=True
            )

        cookie_matched_id = None
        if cookie_token:
            c_mid, c_dev, _ = _find_trusted_match_for_token(devices, cookie_token)
            if c_mid and _is_device_certified(c_dev):
                cookie_matched_id = c_mid
        has_valid_cookie = bool(matched_id and cookie_matched_id == matched_id)
        needs_proactive_rotation = bool(token_ts and (time.time() - token_ts) > TOKEN_ROTATION_AGE_SEC)

        new_token = None
        if matched_id and (token_needs_unification or not token or verified_device_id != matched_id or needs_proactive_rotation):
            verified_device_id = matched_id
            new_token = create_device_token(matched_id)
            token = new_token
        elif matched_id and token and not has_valid_cookie:
            new_token = token

        if is_local:
            if ua.startswith(('curl/', 'Wget/', 'python-requests', 'Go-http-client', 'Python-urllib')) and not hdr_telemetry:
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "verified_in_lan": True,
                    "client_ip": norm_client_ip,
                    "device_info": {"id": "cli_local", "name": "Herramienta Local (CLI)", "trusted": True, "verified_in_lan": True},
                    "device_id": "cli_local",
                    "certificate_serial": "",
                    "new_token": None,
                    "token": None
                }

            if device_entry and device_entry.get("trusted", True):
                device_entry["last_seen"] = now_iso
                device_entry["verified_in_lan"] = True
                device_entry["trusted"] = True
                enrich_device_entry(device_entry, ua, hdr_telemetry, norm_client_ip, is_local=True)
                save_trusted_devices(devices)
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "verified_in_lan": True,
                    "client_ip": norm_client_ip,
                    "device_info": device_entry,
                    "device_id": verified_device_id,
                    "certificate_serial": device_entry.get("certificate_serial", ""),
                    "new_token": new_token,
                    "token": token
                }
            else:
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
                    "lan_verified_at": now_iso,
                    "local_ip": norm_client_ip,
                    "last_external_ip": "",
                    "user_agent": ua[:240],
                    "verified_in_lan": True,
                    "trusted": True
                }
                enrich_device_entry(device_entry, ua, hdr_telemetry, norm_client_ip, is_local=True)
                devices[dev_id] = device_entry
                save_trusted_devices(devices)
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "verified_in_lan": True,
                    "client_ip": norm_client_ip,
                    "device_info": device_entry,
                    "device_id": dev_id,
                    "certificate_serial": device_entry.get("certificate_serial", ""),
                    "new_token": new_token,
                    "token": new_token
                }
        else:
            # Petición desde el EXTERIOR (WAN): acceso permitido SOLO con certificado vigente (LAN o clave maestra)
            if _is_device_certified(device_entry):
                device_entry["last_seen"] = now_iso
                device_entry["last_external_ip"] = client_ip
                enrich_device_entry(device_entry, ua, hdr_telemetry, client_ip, is_local=False)
                save_trusted_devices(devices)
                return {
                    "is_local": False,
                    "is_trusted": True,
                    "verified_in_lan": bool(device_entry.get("verified_in_lan", False)),
                    "verified_by_master_key": bool(device_entry.get("verified_by_master_key", False)),
                    "client_ip": client_ip,
                    "device_info": device_entry,
                    "device_id": verified_device_id,
                    "certificate_serial": device_entry.get("certificate_serial", ""),
                    "new_token": new_token,
                    "token": token
                }
            else:
                return {
                    "is_local": False,
                    "is_trusted": False,
                    "verified_in_lan": False,
                    "verified_by_master_key": False,
                    "client_ip": client_ip,
                    "device_info": None,
                    "device_id": None,
                    "certificate_serial": "",
                    "new_token": None,
                    "token": None
                }

def get_locked_page_html(client_ip):
    """Pantalla de bloqueo estricto Zero-Trust (Alethia): sin fugas de versión, dominio ni métricas y certificación exclusiva en red local."""
    _ = html.escape(str(client_ip or ""))
    return """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Acceso protegido · Recursos Cockpit</title>
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #F5F4F2;
      --card-bg: #FFFFFF;
      --surface-2: #EEEDE9;
      --border: #E0DFDA;
      --accent: #1E6B38;
      --accent-hover: #15532B;
      --accent-ink: #FFFFFF;
      --badge-bg: rgba(217, 119, 6, 0.12);
      --badge-fg: #B45309;
      --text: #0F1F10;
      --text-dim: #465448;
      --success: #1E6B38;
      --error: #DC2626;
      --font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    html[data-theme="dark"] {
      --bg: #0A140B;
      --card-bg: #111F13;
      --surface-2: #18291A;
      --border: rgba(198, 241, 157, 0.16);
      --accent: #C6F19D;
      --accent-hover: #D8F7BA;
      --accent-ink: #0A140B;
      --badge-bg: rgba(245, 158, 11, 0.16);
      --badge-fg: #FCD34D;
      --text: #F5F4F2;
      --text-dim: #A6B8A8;
      --success: #C6F19D;
      --error: #F87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font); }
    body {
      background-color: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      -webkit-font-smoothing: antialiased;
    }
    .auth-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px 28px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 18px 42px rgba(10, 20, 11, 0.12);
    }
    .brand-logo {
      width: 84px;
      height: 84px;
      object-fit: contain;
      margin: 0 auto 14px;
      display: block;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 999px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
      margin-bottom: 14px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.55;
      margin-bottom: 18px;
    }
    .steps-box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 12.5px;
      color: var(--text-dim);
      line-height: 1.55;
      text-align: left;
      margin-bottom: 18px;
    }
    .steps-box strong {
      color: var(--text);
    }
    .retry-btn {
      width: 100%;
      min-height: 44px;
      padding: 11px 16px;
      border-radius: 12px;
      border: none;
      background: var(--accent);
      color: var(--accent-ink);
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s, background 0.15s;
    }
    .retry-btn:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    .retry-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .secondary-btn {
      width: 100%;
      min-height: 40px;
      margin-top: 10px;
      padding: 9px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .secondary-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .pwd-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 6px;
      text-align: left;
    }
    .pwd-input {
      width: 100%;
      min-height: 44px;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 14px;
      outline: none;
    }
    .pwd-input:focus {
      border-color: var(--accent);
    }
    .status-msg {
      margin-top: 12px;
      font-size: 12.5px;
      line-height: 1.45;
      min-height: 18px;
      color: var(--text-dim);
    }
  </style>
  <script>
    try {
      var t = localStorage.getItem('recursos_theme');
      if (t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch (e) {}
  </script>
</head>
<body>
  <main class="auth-card">
    <img src="/recursos-cockpit.png" alt="Recursos Cockpit" class="brand-logo" />
    <span class="badge">CERTIFICACIÓN REQUERIDA</span>
    <h1>Dispositivo no certificado</h1>
    <p class="subtitle">
      Por seguridad, no se muestra ningún dato del sistema hasta certificar este dispositivo en tu red local o mediante la contraseña maestra.
    </p>
    <form id="masterKeyForm" class="pwd-form" onsubmit="submitMasterPassword(event)">
      <input
        type="password"
        id="masterKeyInput"
        class="pwd-input"
        placeholder="Contraseña maestra del servidor"
        autocomplete="current-password"
        required
      />
      <button type="submit" id="btnUnlockMaster" class="retry-btn">
        Certificar y acceder
      </button>
    </form>
    <button type="button" id="btnRetryLan" class="secondary-btn" onclick="retryLanVerification()">
      Verificar automáticamente en red local
    </button>
    <div class="status-msg" id="statusMsg"></div>
  </main>

  <script>
    function getSavedCandidateToken() {
      try {
        if (window.RecursosAndroidBridge && typeof window.RecursosAndroidBridge.getDeviceToken === 'function') {
          var tBridge = (window.RecursosAndroidBridge.getDeviceToken() || '').trim();
          if (tBridge) return tBridge;
        }
      } catch (e) {}
      try {
        if (window.__RECURSOS_DEVICE_TOKEN__) return String(window.__RECURSOS_DEVICE_TOKEN__).trim();
      } catch (e) {}
      try {
        var tRec = (localStorage.getItem('recursos_device_token') || '').trim();
        if (tRec) return tRec;
        var tLegacy = (localStorage.getItem('sysmon_device_token') || '').trim();
        if (tLegacy) return tLegacy;
        var cfgRaw = localStorage.getItem('recursos_auth_persistence_config');
        if (cfgRaw) {
          var cfg = JSON.parse(cfgRaw);
          if (cfg && cfg.token) return String(cfg.token).trim();
        }
      } catch (e) {}
      return '';
    }

    function persistTokenLocally(tok) {
      if (!tok) return;
      try {
        localStorage.setItem('recursos_device_token', tok);
        localStorage.setItem('sysmon_device_token', tok);
        if (window.RecursosAndroidBridge && typeof window.RecursosAndroidBridge.onTokenUpdated === 'function') {
          window.RecursosAndroidBridge.onTokenUpdated(tok);
        }
      } catch (e) {}
    }

    function clearStoredTokens() {
      try {
        localStorage.removeItem('recursos_device_token');
        localStorage.removeItem('sysmon_device_token');
      } catch (e) {}
    }

    async function tryAutoRestoreSession() {
      var savedToken = getSavedCandidateToken();
      if (!savedToken) return false;
      var msg = document.getElementById('statusMsg');
      try {
        var res = await fetch('/api/auth/restore-session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + savedToken,
            'X-Device-Token': savedToken
          },
          body: JSON.stringify({ token: savedToken })
        });
        if (res.ok) {
          var data = await res.json();
          if (data && data.success) {
            if (data.token) persistTokenLocally(data.token);
            if (msg) {
              msg.style.color = 'var(--success)';
              msg.textContent = 'Certificado verificado. Accediendo...';
            }
            window.location.reload();
            return true;
          }
        } else if (res.status === 403) {
          clearStoredTokens();
        }
      } catch (e) {}
      return false;
    }

    async function submitMasterPassword(ev) {
      if (ev) ev.preventDefault();
      var input = document.getElementById('masterKeyInput');
      var btn = document.getElementById('btnUnlockMaster');
      var msg = document.getElementById('statusMsg');
      var pwd = input ? String(input.value || '').trim() : '';
      if (!pwd) return;
      if (btn) btn.disabled = true;
      if (msg) {
        msg.style.color = 'var(--text-dim)';
        msg.textContent = 'Verificando contraseña maestra...';
      }
      try {
        var res = await fetch('/api/auth/unlock', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: pwd })
        });
        var data = {};
        try { data = await res.json(); } catch (e) {}
        if (res.ok && data && data.success) {
          if (data.token) persistTokenLocally(data.token);
          if (msg) {
            msg.style.color = 'var(--success)';
            msg.textContent = 'Dispositivo certificado. Accediendo...';
          }
          window.location.reload();
          return;
        }
        if (res.status === 429) {
          if (msg) {
            msg.style.color = 'var(--error)';
            msg.textContent = 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.';
          }
        } else {
          if (msg) {
            msg.style.color = 'var(--error)';
            msg.textContent = 'Contraseña maestra incorrecta.';
          }
        }
      } catch (e) {
        if (msg) {
          msg.style.color = 'var(--error)';
          msg.textContent = 'No se pudo conectar con el servidor.';
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function retryLanVerification() {
      var btn = document.getElementById('btnRetryLan');
      var msg = document.getElementById('statusMsg');
      if (btn) btn.disabled = true;
      if (msg) {
        msg.style.color = 'var(--text-dim)';
        msg.textContent = 'Comprobando certificación en red local...';
      }
      try {
        var restored = await tryAutoRestoreSession();
        if (restored) return;
        var res = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) {
          var data = await res.json();
          if (data && data.is_trusted) {
            if (data.token) persistTokenLocally(data.token);
            if (msg) {
              msg.style.color = 'var(--success)';
              msg.textContent = 'Certificado emitido en red local. Accediendo...';
            }
            window.location.reload();
            return;
          }
        }
        if (msg) {
          msg.style.color = 'var(--error)';
          msg.textContent = 'Este equipo aún no está certificado en la red local.';
        }
      } catch (e) {
        if (msg) {
          msg.style.color = 'var(--error)';
          msg.textContent = 'No se pudo comprobar la red local ahora mismo.';
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryAutoRestoreSession);
    } else {
      tryAutoRestoreSession();
    }
  </script>
</body>
</html>"""



# ==============================================================================
# Hardware, OS & Metrics Collectors
# ==============================================================================
_CPU_RAPL_LOCK = threading.Lock()
_CPU_RAPL_PREV = {"ts": 0.0, "energy_uj": None, "watts": None}


def _read_cpu_temp_and_sensors():
    """Detecta dinámicamente la temperatura principal del procesador y sensores térmicos en Linux."""
    cpu_temp = None
    sensors = []
    preferred_drivers = ("coretemp", "k10temp", "zenpower", "cpu_thermal", "soc_thermal", "x86_pkg_temp")
    fallback_drivers = ("acpitz", "package", "dell_smm", "thinkpad", "asus")

    def _scan_hwmon(target_drivers):
        found_primary = None
        found_list = []
        hwmon_root = "/sys/class/hwmon"
        if not os.path.isdir(hwmon_root):
            return found_primary, found_list
        try:
            for hw in sorted(os.listdir(hwmon_root)):
                hw_dir = os.path.join(hwmon_root, hw)
                name_f = os.path.join(hw_dir, "name")
                if not os.path.exists(name_f):
                    continue
                try:
                    with open(name_f, "r", encoding="utf-8", errors="ignore") as nf:
                        hw_name = nf.read().strip().lower()
                except Exception:
                    continue
                if not any(k in hw_name for k in target_drivers):
                    continue
                try:
                    entries = sorted(os.listdir(hw_dir))
                except Exception:
                    continue
                for fname in entries:
                    if not (fname.startswith("temp") and fname.endswith("_input")):
                        continue
                    t_path = os.path.join(hw_dir, fname)
                    if not os.path.exists(t_path):
                        continue
                    try:
                        with open(t_path, "r", encoding="utf-8", errors="ignore") as tf:
                            raw_val = int(tf.read().strip())
                        temp_c = round(raw_val / 1000.0, 1)
                        if not (-20.0 <= temp_c <= 150.0):
                            continue
                    except Exception:
                        continue
                    prefix = fname[:-6]
                    lbl_path = os.path.join(hw_dir, f"{prefix}_label")
                    lbl = hw_name
                    if os.path.exists(lbl_path):
                        try:
                            with open(lbl_path, "r", encoding="utf-8", errors="ignore") as lf:
                                lbl = lf.read().strip() or hw_name
                        except Exception:
                            pass
                    found_list.append({"label": lbl, "temp_c": temp_c})
                    low_lbl = lbl.lower()
                    if found_primary is None or any(p in low_lbl for p in ("package", "tctl", "tdie", "cpu")):
                        found_primary = temp_c
                if found_primary is not None:
                    break
        except Exception:
            pass
        return found_primary, found_list

    cpu_temp, sensors = _scan_hwmon(preferred_drivers)
    if cpu_temp is None:
        cpu_temp, sensors = _scan_hwmon(fallback_drivers)

    if cpu_temp is None and os.path.isdir("/sys/class/thermal"):
        try:
            for z in sorted(os.listdir("/sys/class/thermal")):
                if not z.startswith("thermal_zone"):
                    continue
                z_dir = os.path.join("/sys/class/thermal", z)
                type_f = os.path.join(z_dir, "type")
                temp_f = os.path.join(z_dir, "temp")
                if not (os.path.exists(type_f) and os.path.exists(temp_f)):
                    continue
                try:
                    with open(type_f, "r", encoding="utf-8", errors="ignore") as tf:
                        z_type = tf.read().strip()
                    with open(temp_f, "r", encoding="utf-8", errors="ignore") as vf:
                        temp_c = round(int(vf.read().strip()) / 1000.0, 1)
                    if not (-20.0 <= temp_c <= 150.0):
                        continue
                    low_t = z_type.lower()
                    if any(k in low_t for k in ("x86_pkg", "cpu", "soc", "tcpu", "acpitz", "core")):
                        sensors.append({"label": z_type, "temp_c": temp_c})
                        if cpu_temp is None or "pkg" in low_t or "cpu" in low_t:
                            cpu_temp = temp_c
                except Exception:
                    continue
        except Exception:
            pass

    if cpu_temp is None and hasattr(psutil, "sensors_temperatures"):
        try:
            st = psutil.sensors_temperatures() or {}
            for key in ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz"):
                if key in st and st[key]:
                    for item in st[key]:
                        if item.current is not None and -20.0 <= item.current <= 150.0:
                            val = round(float(item.current), 1)
                            sensors.append({"label": item.label or key, "temp_c": val})
                            if cpu_temp is None:
                                cpu_temp = val
                    if cpu_temp is not None:
                        break
        except Exception:
            pass

    return cpu_temp, sensors[:8]


def _read_cpu_rapl_watts():
    """Lee el consumo eléctrico real del paquete CPU vía RAPL (/sys/class/powercap) si está disponible y legible."""
    rapl_root = "/sys/class/powercap"
    if not os.path.isdir(rapl_root):
        return None
    energy_path = None
    max_range_path = None
    try:
        candidates = []
        for entry in sorted(os.listdir(rapl_root)):
            if not entry.startswith("intel-rapl:") or entry.count(":") != 1:
                continue
            d_path = os.path.join(rapl_root, entry)
            e_file = os.path.join(d_path, "energy_uj")
            if os.path.exists(e_file) and os.access(e_file, os.R_OK):
                name_f = os.path.join(d_path, "name")
                dom_name = ""
                if os.path.exists(name_f):
                    try:
                        with open(name_f, "r", encoding="utf-8", errors="ignore") as nf:
                            dom_name = nf.read().strip().lower()
                    except Exception:
                        pass
                candidates.append((0 if "package" in dom_name else 1, e_file, os.path.join(d_path, "max_energy_range_uj")))
        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        _, energy_path, max_range_path = candidates[0]
        with open(energy_path, "r", encoding="utf-8", errors="ignore") as ef:
            curr_uj = int(ef.read().strip())
        max_uj = 0
        if os.path.exists(max_range_path) and os.access(max_range_path, os.R_OK):
            try:
                with open(max_range_path, "r", encoding="utf-8", errors="ignore") as mf:
                    max_uj = int(mf.read().strip())
            except Exception:
                max_uj = 0
        now_t = time.time()
        with _CPU_RAPL_LOCK:
            prev_t = _CPU_RAPL_PREV["ts"]
            prev_uj = _CPU_RAPL_PREV["energy_uj"]
            watts = _CPU_RAPL_PREV["watts"]
            if prev_uj is not None and (now_t - prev_t) >= 0.4:
                diff_uj = curr_uj - prev_uj
                if diff_uj < 0 and max_uj > 0:
                    diff_uj += max_uj
                if diff_uj >= 0:
                    w = (diff_uj / 1_000_000.0) / (now_t - prev_t)
                    if 0.0 <= w <= 600.0:
                        watts = round(w, 1)
                        _CPU_RAPL_PREV["watts"] = watts
            _CPU_RAPL_PREV["ts"] = now_t
            _CPU_RAPL_PREV["energy_uj"] = curr_uj
            return watts
    except Exception:
        return None


def get_cpu_info():
    try:
        per_cpu = psutil.cpu_percent(interval=None, percpu=True)
        cpu_percent = round(sum(per_cpu) / len(per_cpu), 1) if per_cpu else 0.0
        freq = psutil.cpu_freq()
        freq_current = round(freq.current, 1) if freq and freq.current else 0.0
        freq_max = round(freq.max, 1) if freq and freq.max else 0.0
        freq_min = round(freq.min, 1) if freq and freq.min else 0.0
        if freq_current <= 0 and os.path.exists("/proc/cpuinfo"):
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
        governor = None
        gov_path = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"
        if os.path.exists(gov_path):
            try:
                with open(gov_path, "r", encoding="utf-8", errors="ignore") as gf:
                    governor = gf.read().strip() or None
            except Exception:
                pass
        if freq_max <= 0:
            max_f_path = "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq"
            if os.path.exists(max_f_path):
                try:
                    with open(max_f_path, "r", encoding="utf-8", errors="ignore") as mf:
                        freq_max = round(int(mf.read().strip()) / 1000.0, 1)
                except Exception:
                    pass
        if freq_min <= 0:
            min_f_path = "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq"
            if os.path.exists(min_f_path):
                try:
                    with open(min_f_path, "r", encoding="utf-8", errors="ignore") as mf:
                        freq_min = round(int(mf.read().strip()) / 1000.0, 1)
                except Exception:
                    pass

        cpu_temp, temp_sensors = _read_cpu_temp_and_sensors()
        power_watts = _read_cpu_rapl_watts()
        user_pct = 0.0
        system_pct = 0.0
        iowait_pct = 0.0
        idle_pct = 100.0
        try:
            ct = psutil.cpu_times_percent(interval=None)
            user_pct = round(float(getattr(ct, "user", 0.0) or 0.0) + float(getattr(ct, "nice", 0.0) or 0.0), 1)
            system_pct = round(float(getattr(ct, "system", 0.0) or 0.0) + float(getattr(ct, "irq", 0.0) or 0.0) + float(getattr(ct, "softirq", 0.0) or 0.0), 1)
            iowait_pct = round(float(getattr(ct, "iowait", 0.0) or 0.0), 1)
            idle_pct = round(float(getattr(ct, "idle", 0.0) or 0.0), 1)
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
            "governor": governor,
            "temp_c": cpu_temp,
            "temp_sensors": temp_sensors,
            "power_watts": power_watts,
            "user_percent": user_pct,
            "system_percent": system_pct,
            "iowait_percent": iowait_pct,
            "idle_percent": idle_pct,
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2),
            "capabilities": {
                "usage": True,
                "temp": cpu_temp is not None,
                "freq": freq_current > 0,
                "power": power_watts is not None,
                "times": True,
                "load": True,
                "cores": len(per_cpu) > 0,
            },
        }
    except Exception as e:
        return {"error": str(e), "model": CPU_MODEL, "architecture": CPU_ARCH, "usage_percent": 0.0, "per_core_percent": [], "temp_c": None}

def _parse_gpu_num(raw_val, cast=float):
    """Convierte una lectura numérica de GPU (`'44 C'`, `'22.70 W'`, `'3 %'`) o devuelve None si es N/A."""
    if raw_val is None:
        return None
    txt = str(raw_val).strip()
    if not txt or txt.upper() in ("N/A", "NA", "NONE", "UNKNOWN", "-", "[N/A]", "[NOT SUPPORTED]"):
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", txt)
    if not m:
        return None
    try:
        return cast(float(m.group(0))) if cast is int else float(m.group(0))
    except Exception:
        return None


def _nvidia_pmon_snapshot():
    """Consulta utilización GPU por proceso (`sm`, `mem`, `enc`, `dec`, `fb`) mediante `nvidia-smi pmon -c 1 -s um`."""
    by_pid = {}
    try:
        out = subprocess.check_output(["nvidia-smi", "pmon", "-c", "1", "-s", "um"], timeout=2).decode("utf-8", errors="ignore")
        cols = None
        for raw_line in out.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#"):
                hdr_tokens = line.lstrip("#").split()
                if "pid" in hdr_tokens:
                    cols = [c.lower() for c in hdr_tokens]
                continue
            parts = line.split()
            if not cols or len(parts) < len(cols) - 1:
                continue
            row = {cols[i]: parts[i] for i in range(min(len(cols), len(parts)))}
            pid_val = _parse_gpu_num(row.get("pid"), cast=int)
            if not pid_val or pid_val <= 0:
                continue
            sm = _parse_gpu_num(row.get("sm"), cast=int)
            mem_u = _parse_gpu_num(row.get("mem"), cast=int)
            enc = _parse_gpu_num(row.get("enc"), cast=int)
            dec = _parse_gpu_num(row.get("dec"), cast=int)
            fb = _parse_gpu_num(row.get("fb"), cast=float)
            active_vals = [v for v in (sm, enc, dec) if v is not None]
            gpu_util = max(active_vals) if active_vals else None
            prev = by_pid.get(pid_val)
            if prev:
                if fb is not None:
                    prev["vram_mb"] = max(prev.get("vram_mb") or 0.0, fb)
                if gpu_util is not None:
                    prev["gpu_util"] = max(prev.get("gpu_util") or 0, gpu_util)
                if mem_u is not None:
                    prev["mem_util"] = max(prev.get("mem_util") or 0, mem_u)
                if enc is not None:
                    prev["enc_util"] = max(prev.get("enc_util") or 0, enc)
                if dec is not None:
                    prev["dec_util"] = max(prev.get("dec_util") or 0, dec)
            else:
                by_pid[pid_val] = {
                    "gpu_util": gpu_util,
                    "mem_util": mem_u,
                    "enc_util": enc,
                    "dec_util": dec,
                    "vram_mb": fb,
                    "type": str(row.get("type") or "").strip(),
                }
    except Exception:
        pass
    return by_pid


def _append_gpu_history_bucket(sample):
    """Registra una muestra en cubetas de 5 s (20 min) para las sub-gráficas dinámicas de GPU."""
    ts_num = time.time()
    b_ts = (int(ts_num) // HISTORY_BUCKET_SECONDS) * HISTORY_BUCKET_SECONDS
    cutoff_b_ts = b_ts - HISTORY_WINDOW_SECONDS
    t_ms = int(round(ts_num * 1000))

    bucket_entry = {
        "b_ts": b_ts,
        "t": t_ms,
        "util": sample.get("gpu_util_percent"),
        "mem_util": sample.get("mem_util_percent"),
        "vram_pct": sample.get("vram_percent"),
        "vram_mb": sample.get("vram_used_mb"),
        "enc": sample.get("encoder_util_percent"),
        "dec": sample.get("decoder_util_percent"),
        "temp": sample.get("temp_c"),
        "power": sample.get("power_watts"),
        "clock_gfx": sample.get("clock_graphics_mhz"),
        "clock_mem": sample.get("clock_mem_mhz"),
        "pcie_rx": round(float(sample["pcie_rx_kbps"]) / 1024.0, 2) if sample.get("pcie_rx_kbps") is not None else None,
        "pcie_tx": round(float(sample["pcie_tx_kbps"]) / 1024.0, 2) if sample.get("pcie_tx_kbps") is not None else None,
    }

    with GPU_LOCK:
        if not _GPU_HISTORY_BUCKETS_20M or _GPU_HISTORY_BUCKETS_20M[-1]["b_ts"] < b_ts:
            _GPU_HISTORY_BUCKETS_20M.append(bucket_entry)
        elif _GPU_HISTORY_BUCKETS_20M[-1]["b_ts"] == b_ts:
            last = _GPU_HISTORY_BUCKETS_20M[-1]
            last["t"] = t_ms
            for k in ("util", "mem_util", "vram_pct", "vram_mb", "enc", "dec", "pcie_rx", "pcie_tx"):
                nv = bucket_entry.get(k)
                pv = last.get(k)
                if nv is not None:
                    last[k] = nv if pv is None else max(pv, nv)
            for k in ("temp", "power", "clock_gfx", "clock_mem"):
                nv = bucket_entry.get(k)
                if nv is not None:
                    last[k] = nv

        while _GPU_HISTORY_BUCKETS_20M and _GPU_HISTORY_BUCKETS_20M[0]["b_ts"] < cutoff_b_ts:
            _GPU_HISTORY_BUCKETS_20M.pop(0)

        return [{k: v for k, v in b.items() if k != "b_ts"} for b in _GPU_HISTORY_BUCKETS_20M]


def _classify_gpu_process_name(pid_int, raw_pname, fallback_label):
    clean_cmd = str(raw_pname or "").strip()
    first_token = clean_cmd.split()[0] if clean_cmd else ""
    clean_name = os.path.basename(first_token) if first_token else fallback_label
    try:
        if pid_int is not None and pid_int > 0 and psutil.pid_exists(pid_int):
            p_obj = psutil.Process(pid_int)
            p_comm = p_obj.name()
            if p_comm:
                clean_name = p_comm
            if not clean_cmd:
                clean_cmd = " ".join(p_obj.cmdline()[:3])
    except Exception:
        pass

    lower = clean_name.lower()
    name_key = None
    if "chrome" in lower or "chromium" in lower:
        name_key = "chrome_gpu"
        display_name = get_gpu_process_label(name_key, "Google Chrome (GPU / Render)", base_dir=BASE_DIR)
    elif "gnome-shell" in lower:
        name_key = "gnome_shell"
        display_name = get_gpu_process_label(name_key, "GNOME Shell (Compositor Wayland)", base_dir=BASE_DIR)
    elif "xwayland" in lower:
        name_key = "xwayland"
        display_name = get_gpu_process_label(name_key, "Xwayland (Compatibilidad X11)", base_dir=BASE_DIR)
    elif "ptyxis" in lower:
        name_key = "ptyxis"
        display_name = get_gpu_process_label(name_key, "Ptyxis (Terminal)", base_dir=BASE_DIR)
    elif "nautilus" in lower:
        name_key = "nautilus"
        display_name = get_gpu_process_label(name_key, "Nautilus (Archivos)", base_dir=BASE_DIR)
    elif "ffmpeg" in lower:
        name_key = "ffmpeg_nvenc"
        display_name = get_gpu_process_label(name_key, "FFmpeg (Transcodificación NVENC)", base_dir=BASE_DIR)
    elif "python" in lower:
        if "asterisk" in clean_cmd.lower():
            display_name = "Python (Asterisk PBX / Whisper)"
        elif "immich" in clean_cmd.lower():
            display_name = "Python (Immich Machine Learning)"
        else:
            display_name = f"Python3 ({clean_name})"
    else:
        if not first_token:
            name_key = "gpu_process"
        display_name = clean_name
    return clean_name, display_name, name_key


def _collect_drm_gpu_info():
    """Respaldo genérico Zero-Hardcoding para GPUs AMD / Intel / ARM vía sysfs DRM y hwmon."""
    drm_root = "/sys/class/drm"
    gpu_name = ""
    driver_name = "Linux Kernel DRM"
    card_dev_dir = None

    if os.path.isdir(drm_root):
        for entry in sorted(os.listdir(drm_root)):
            if not re.match(r"^card\d+$", entry):
                continue
            cand_dev = os.path.join(drm_root, entry, "device")
            if os.path.isdir(cand_dev):
                card_dev_dir = cand_dev
                uevent_p = os.path.join(cand_dev, "uevent")
                if os.path.isfile(uevent_p):
                    try:
                        for ln in open(uevent_p, "r", errors="ignore"):
                            if ln.startswith("DRIVER="):
                                driver_name = ln.split("=", 1)[1].strip() or driver_name
                    except Exception:
                        pass
                break

    try:
        lspci_out = subprocess.check_output(["lspci"], timeout=2).decode("utf-8", errors="ignore")
        for line in lspci_out.splitlines():
            if any(k in line for k in ("VGA compatible controller:", "3D controller:", "Display controller:")):
                gpu_name = line.split(":", 2)[-1].strip()
                break
    except Exception:
        pass

    if not card_dev_dir and not gpu_name:
        return None

    def _read_sysfs_num(path, scale=1.0, cast=float):
        try:
            with open(path, "r", errors="ignore") as f:
                val = float(f.read().strip()) * scale
                return cast(round(val)) if cast is int else round(val, 2)
        except Exception:
            return None

    gpu_util = None
    mem_util = None
    vram_total_mb = 0
    vram_used_mb = 0
    vram_free_mb = 0
    vram_pct = 0.0
    temp_c = None
    power_w = None
    fan_pct = None
    clock_gfx = None
    clock_gfx_max = None
    clock_mem = None

    if card_dev_dir:
        gpu_util = _read_sysfs_num(os.path.join(card_dev_dir, "gpu_busy_percent"), cast=int)
        mem_util = _read_sysfs_num(os.path.join(card_dev_dir, "mem_busy_percent"), cast=int)
        v_tot_b = _read_sysfs_num(os.path.join(card_dev_dir, "mem_info_vram_total"))
        v_used_b = _read_sysfs_num(os.path.join(card_dev_dir, "mem_info_vram_used"))
        if v_tot_b and v_tot_b > 0:
            vram_total_mb = int(round(v_tot_b / (1024 * 1024)))
            vram_used_mb = int(round((v_used_b or 0.0) / (1024 * 1024)))
            vram_free_mb = max(0, vram_total_mb - vram_used_mb)
            vram_pct = round((vram_used_mb / vram_total_mb) * 100.0, 1)

        # Relojes Intel / AMD
        card_parent = os.path.dirname(card_dev_dir)
        clock_gfx = (
            _read_sysfs_num(os.path.join(card_parent, "gt_cur_freq_mhz"), cast=int)
            or _read_sysfs_num(os.path.join(card_parent, "gt/gt0/rps_cur_freq_mhz"), cast=int)
        )
        clock_gfx_max = (
            _read_sysfs_num(os.path.join(card_parent, "gt_max_freq_mhz"), cast=int)
            or _read_sysfs_num(os.path.join(card_parent, "gt/gt0/rps_max_freq_mhz"), cast=int)
        )
        for dpm_file, target in (("pp_dpm_sclk", "gfx"), ("pp_dpm_mclk", "mem")):
            dpm_path = os.path.join(card_dev_dir, dpm_file)
            if os.path.isfile(dpm_path):
                try:
                    freqs = []
                    active_mhz = None
                    with open(dpm_path, "r", errors="ignore") as f:
                        for ln in f:
                            m = re.search(r"(\d+)\s*Mhz", ln, re.IGNORECASE)
                            if m:
                                mv = int(m.group(1))
                                freqs.append(mv)
                                if "*" in ln:
                                    active_mhz = mv
                    if target == "gfx" and active_mhz is not None:
                        clock_gfx = active_mhz
                        clock_gfx_max = max(freqs) if freqs else clock_gfx_max
                    elif target == "mem" and active_mhz is not None:
                        clock_mem = active_mhz
                except Exception:
                    pass

        # Hwmon (temp / potencia / ventilador)
        hwmon_root = os.path.join(card_dev_dir, "hwmon")
        if os.path.isdir(hwmon_root):
            for hw in sorted(os.listdir(hwmon_root)):
                hdir = os.path.join(hwmon_root, hw)
                if not os.path.isdir(hdir):
                    continue
                if temp_c is None:
                    temp_c = _read_sysfs_num(os.path.join(hdir, "temp1_input"), scale=0.001, cast=int)
                if power_w is None:
                    power_w = (
                        _read_sysfs_num(os.path.join(hdir, "power1_average"), scale=1e-6, cast=float)
                        or _read_sysfs_num(os.path.join(hdir, "power1_input"), scale=1e-6, cast=float)
                    )
                if fan_pct is None:
                    pwm_v = _read_sysfs_num(os.path.join(hdir, "pwm1"))
                    if pwm_v is not None:
                        fan_pct = int(round((pwm_v / 255.0) * 100.0))

    caps = {
        "compute": gpu_util is not None,
        "vram": vram_total_mb > 0,
        "mem_ctrl": mem_util is not None,
        "encoder": False,
        "decoder": False,
        "power": power_w is not None,
        "temp": temp_c is not None,
        "clocks": (clock_gfx is not None) or (clock_mem is not None),
        "pcie": False,
        "fan": fan_pct is not None,
    }
    sample = {
        "available": True,
        "name": gpu_name or driver_name,
        "driver": driver_name,
        "cuda": "",
        "temp_c": temp_c,
        "gpu_util_percent": gpu_util if gpu_util is not None else 0,
        "mem_util_percent": mem_util,
        "encoder_util_percent": None,
        "decoder_util_percent": None,
        "vram_total_mb": vram_total_mb,
        "vram_used_mb": vram_used_mb,
        "vram_free_mb": vram_free_mb,
        "vram_percent": vram_pct,
        "bar1_used_mb": None,
        "bar1_total_mb": None,
        "fan_percent": fan_pct,
        "power_watts": power_w,
        "power_limit_watts": None,
        "clock_graphics_mhz": clock_gfx,
        "clock_max_graphics_mhz": clock_gfx_max,
        "clock_mem_mhz": clock_mem,
        "clock_max_mem_mhz": None,
        "clock_video_mhz": None,
        "pcie_rx_kbps": None,
        "pcie_tx_kbps": None,
        "pcie_gen": None,
        "pcie_width": None,
        "capabilities": caps,
        "processes": [],
        "gpu_procs_map": {},
    }
    sample["history"] = _append_gpu_history_bucket(sample)
    return sample


def get_gpu_info():
    try:
        xml_out = subprocess.check_output(['nvidia-smi', '-q', '-x'], timeout=3).decode('utf-8', errors='ignore')
        root = ET.fromstring(xml_out)
        gpu = root.find('gpu')
        if gpu is None:
            return {"available": False, "gpu_procs_map": {}, "capabilities": {}, "history": []}

        name = (gpu.findtext('product_name') or '').strip()
        driver = (root.findtext('driver_version') or gpu.findtext('driver_version') or '').strip()
        cuda = (root.findtext('cuda_version') or '').strip()

        temp = _parse_gpu_num(gpu.findtext('temperature/gpu_temp'), cast=int)
        mem_temp = _parse_gpu_num(gpu.findtext('temperature/memory_temp'), cast=int)

        gpu_util_raw = _parse_gpu_num(gpu.findtext('utilization/gpu_util'), cast=int)
        mem_util_raw = _parse_gpu_num(gpu.findtext('utilization/memory_util'), cast=int)
        enc_util_raw = _parse_gpu_num(gpu.findtext('utilization/encoder_util'), cast=int)
        dec_util_raw = _parse_gpu_num(gpu.findtext('utilization/decoder_util'), cast=int)
        jpeg_util_raw = _parse_gpu_num(gpu.findtext('utilization/jpeg_util'), cast=int)
        ofa_util_raw = _parse_gpu_num(gpu.findtext('utilization/ofa_util'), cast=int)

        mem_total = _parse_gpu_num(gpu.findtext('fb_memory_usage/total'), cast=int) or 0
        mem_used = _parse_gpu_num(gpu.findtext('fb_memory_usage/used'), cast=int) or 0
        mem_free = _parse_gpu_num(gpu.findtext('fb_memory_usage/free'), cast=int) or 0
        vram_pct = round((mem_used / mem_total * 100.0), 1) if mem_total > 0 else 0.0

        bar1_total = _parse_gpu_num(gpu.findtext('bar1_memory_usage/total'), cast=int)
        bar1_used = _parse_gpu_num(gpu.findtext('bar1_memory_usage/used'), cast=int)

        fan = _parse_gpu_num(gpu.findtext('fan_speed'), cast=int)
        power = (
            _parse_gpu_num(gpu.findtext('gpu_power_readings/instant_power_draw'))
            or _parse_gpu_num(gpu.findtext('gpu_power_readings/average_power_draw'))
            or _parse_gpu_num(gpu.findtext('gpu_power_readings/power_draw'))
            or _parse_gpu_num(gpu.findtext('power_readings/power_draw'))
        )
        if power is not None:
            power = round(power, 1)
        power_limit = (
            _parse_gpu_num(gpu.findtext('gpu_power_readings/current_power_limit'))
            or _parse_gpu_num(gpu.findtext('power_readings/power_limit'))
        )
        if power_limit is not None:
            power_limit = round(power_limit, 0)

        clock_gfx = _parse_gpu_num(gpu.findtext('clocks/graphics_clock'), cast=int)
        clock_max_gfx = _parse_gpu_num(gpu.findtext('max_clocks/graphics_clock'), cast=int)
        clock_mem = _parse_gpu_num(gpu.findtext('clocks/mem_clock'), cast=int)
        clock_max_mem = _parse_gpu_num(gpu.findtext('max_clocks/mem_clock'), cast=int)
        clock_vid = _parse_gpu_num(gpu.findtext('clocks/video_clock'), cast=int)

        pcie_tx_kbps = _parse_gpu_num(gpu.findtext('pci/tx_util'), cast=int)
        pcie_rx_kbps = _parse_gpu_num(gpu.findtext('pci/rx_util'), cast=int)
        pcie_gen_el = gpu.find('.//current_link_gen')
        pcie_width_el = gpu.find('.//current_link_width')
        pcie_gen = _parse_gpu_num(pcie_gen_el.text if pcie_gen_el is not None else None, cast=int)
        pcie_width = _parse_gpu_num(pcie_width_el.text if pcie_width_el is not None else None, cast=int)

        enc_sessions = _parse_gpu_num(gpu.findtext('encoder_stats/session_count'), cast=int)
        enc_fps = _parse_gpu_num(gpu.findtext('encoder_stats/average_fps'), cast=int)

        proc_nodes = gpu.findall('processes/process_info')
        global _LAST_PMON_IDLE_POLL_TS, _PMON_IDLE_CACHE
        now_pmon = time.monotonic()
        if proc_nodes or (now_pmon - _LAST_PMON_IDLE_POLL_TS >= 30.0):
            pmon_map = _nvidia_pmon_snapshot()
            _PMON_IDLE_CACHE = pmon_map
            _LAST_PMON_IDLE_POLL_TS = now_pmon
        else:
            pmon_map = _PMON_IDLE_CACHE

        processes = []
        gpu_procs_map = {}
        fallback_proc_label = get_gpu_process_label('gpu_process', 'Proceso GPU', base_dir=BASE_DIR)

        for p in proc_nodes:
            pid_str = (p.findtext('pid') or '').strip()
            pname = (p.findtext('process_name') or '').strip()
            pmem = (p.findtext('used_memory') or '').strip()
            ptype = (p.findtext('type') or '').strip()

            pid_int = _parse_gpu_num(pid_str, cast=int)
            vram_num = _parse_gpu_num(pmem, cast=float) or 0.0
            pmon_info = pmon_map.get(pid_int, {}) if pid_int else {}
            if vram_num <= 0 and pmon_info.get("vram_mb"):
                vram_num = float(pmon_info["vram_mb"])
            vram_proc_pct = round((vram_num / mem_total) * 100.0, 1) if mem_total > 0 and vram_num > 0 else 0.0

            p_gpu_util = pmon_info.get("gpu_util")
            p_mem_util = pmon_info.get("mem_util")
            p_enc_util = pmon_info.get("enc_util")
            p_dec_util = pmon_info.get("dec_util")

            if pid_int and pid_int > 0:
                gpu_procs_map[pid_int] = {
                    "vram_mb": round(vram_num, 1),
                    "vram_percent": vram_proc_pct,
                    "gpu_util_percent": p_gpu_util,
                    "mem_util_percent": p_mem_util,
                    "enc_util_percent": p_enc_util,
                    "dec_util_percent": p_dec_util,
                    "type": ptype or pmon_info.get("type", ""),
                }

            clean_name, display_name, name_key = _classify_gpu_process_name(pid_int, pname, fallback_proc_label)
            processes.append({
                "pid": pid_str,
                "name": display_name,
                "name_key": name_key,
                "raw_name": clean_name,
                "full_path": pname,
                "used_memory": pmem or (f"{int(round(vram_num))} MiB" if vram_num > 0 else "0 MiB"),
                "vram_mb": round(vram_num, 1),
                "vram_percent": vram_proc_pct,
                "gpu_util_percent": p_gpu_util,
                "gpu_mem_percent": p_mem_util,
                "gpu_enc_percent": p_enc_util,
                "gpu_dec_percent": p_dec_util,
                "type": ptype or pmon_info.get("type", ""),
            })

        processes.sort(
            key=lambda pr: (
                float(pr.get("gpu_util_percent") or -1),
                float(pr.get("vram_mb") or 0.0),
            ),
            reverse=True,
        )

        capabilities = {
            "compute": gpu_util_raw is not None,
            "vram": mem_total > 0,
            "mem_ctrl": mem_util_raw is not None,
            "encoder": enc_util_raw is not None,
            "decoder": dec_util_raw is not None,
            "jpeg": jpeg_util_raw is not None,
            "ofa": ofa_util_raw is not None,
            "power": power is not None,
            "temp": temp is not None,
            "mem_temp": mem_temp is not None,
            "clocks": (clock_gfx is not None) or (clock_mem is not None),
            "pcie": (pcie_tx_kbps is not None) or (pcie_rx_kbps is not None),
            "fan": fan is not None,
        }

        gpu_payload = {
            "available": True,
            "name": name,
            "driver": driver,
            "cuda": cuda,
            "temp_c": temp,
            "mem_temp_c": mem_temp,
            "gpu_util_percent": gpu_util_raw if gpu_util_raw is not None else 0,
            "mem_util_percent": mem_util_raw,
            "encoder_util_percent": enc_util_raw,
            "decoder_util_percent": dec_util_raw,
            "jpeg_util_percent": jpeg_util_raw,
            "ofa_util_percent": ofa_util_raw,
            "encoder_sessions": enc_sessions,
            "encoder_fps": enc_fps,
            "vram_total_mb": mem_total,
            "vram_used_mb": mem_used,
            "vram_free_mb": mem_free,
            "vram_percent": vram_pct,
            "bar1_used_mb": bar1_used,
            "bar1_total_mb": bar1_total,
            "fan_percent": fan,
            "power_watts": power,
            "power_limit_watts": power_limit,
            "clock_graphics_mhz": clock_gfx,
            "clock_max_graphics_mhz": clock_max_gfx,
            "clock_mem_mhz": clock_mem,
            "clock_max_mem_mhz": clock_max_mem,
            "clock_video_mhz": clock_vid,
            "pcie_tx_kbps": pcie_tx_kbps,
            "pcie_rx_kbps": pcie_rx_kbps,
            "pcie_gen": pcie_gen,
            "pcie_width": pcie_width,
            "capabilities": capabilities,
            "processes": processes,
            "gpu_procs_map": gpu_procs_map,
        }
        gpu_payload["history"] = _append_gpu_history_bucket(gpu_payload)
        return gpu_payload
    except Exception as e:
        drm_fallback = _collect_drm_gpu_info()
        if drm_fallback:
            return drm_fallback
        return {"available": False, "name": "", "error": str(e), "gpu_procs_map": {}, "capabilities": {}, "history": []}

def fetch_gpu_worker():
    global GPU_CACHE
    while True:
        try:
            info = get_gpu_info()
            with GPU_LOCK:
                GPU_CACHE = info
        except Exception:
            pass
        time.sleep(2.5)

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

def _read_hwmon_disk_temps():
    """Detecta temperaturas reales de unidades NVMe/SATA desde /sys/class/hwmon."""
    dev_temps = {}
    nvme_fallback = None
    try:
        for hw in os.listdir("/sys/class/hwmon"):
            hw_dir = os.path.join("/sys/class/hwmon", hw)
            name_f = os.path.join(hw_dir, "name")
            if not os.path.exists(name_f):
                continue
            with open(name_f, "r", encoding="utf-8", errors="ignore") as nf:
                hw_name = nf.read().strip().lower()
            if hw_name not in ("nvme", "drivetemp"):
                continue
            t1 = os.path.join(hw_dir, "temp1_input")
            if not os.path.exists(t1):
                continue
            try:
                with open(t1, "r", encoding="utf-8", errors="ignore") as tf:
                    temp_c = round(int(tf.read().strip()) / 1000.0, 1)
            except Exception:
                continue
            if hw_name == "nvme" and nvme_fallback is None:
                nvme_fallback = temp_c
            block_dir = os.path.join(hw_dir, "device", "block")
            if os.path.isdir(block_dir):
                for bdev in os.listdir(block_dir):
                    dev_temps[bdev] = temp_c
            # En NVMe algunos kernels exponen hwmon dentro de /sys/block/nvme0n1/device/hwmon*
            dev_link = os.path.realpath(os.path.join(hw_dir, "device"))
            nvme_node = os.path.basename(dev_link)
            if nvme_node.startswith("nvme"):
                dev_temps[nvme_node] = temp_c
    except Exception:
        pass
    return dev_temps, nvme_fallback


def _read_lsblk_metadata():
    """Lee discos físicos, particiones, modelos, buses y memorias extraíbles USB/MMC mediante lsblk."""
    by_path = {}
    by_mount = {}
    candidates = []
    try:
        raw = subprocess.check_output(
            [
                "lsblk", "-J", "-b", "-o",
                "NAME,KNAME,PATH,TYPE,SIZE,RM,HOTPLUG,TRAN,FSTYPE,UUID,LABEL,MODEL,MOUNTPOINT"
            ],
            timeout=2.5,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {}

    def walk(nodes, parent_meta=None):
        for node in nodes or []:
            if not isinstance(node, dict):
                continue
            name = str(node.get("name") or "")
            kname = str(node.get("kname") or name)
            path = str(node.get("path") or (f"/dev/{kname}" if kname else ""))
            btype = str(node.get("type") or "").lower()
            tran_own = str(node.get("tran") or "").strip().lower()
            model_own = str(node.get("model") or "").strip()
            rm_own = str(node.get("rm") or "").strip().lower() in ("1", "true", "yes")
            hp_own = str(node.get("hotplug") or "").strip().lower() in ("1", "true", "yes")

            tran = tran_own or (parent_meta.get("tran") if parent_meta else "") or ""
            model = model_own or (parent_meta.get("model") if parent_meta else "") or ""
            is_rm = rm_own or hp_own or (parent_meta.get("is_removable") if parent_meta else False) or (tran in ("usb", "mmc"))
            root_disk = kname if btype == "disk" else ((parent_meta.get("root_disk") if parent_meta else "") or kname)

            try:
                size_bytes = int(node.get("size") or 0)
            except Exception:
                size_bytes = 0

            fstype = str(node.get("fstype") or "").strip().lower()
            uuid = str(node.get("uuid") or "").strip()
            fs_label = str(node.get("label") or "").strip()
            mp = node.get("mountpoint")
            children = node.get("children") or []

            meta = {
                "name": name,
                "kname": kname,
                "path": path,
                "type": btype,
                "size_bytes": size_bytes,
                "tran": tran,
                "model": model,
                "is_removable": is_rm,
                "root_disk": root_disk,
                "fstype": fstype,
                "uuid": uuid,
                "fs_label": fs_label,
                "mountpoint": mp,
                "has_children": len(children) > 0,
            }
            if path:
                by_path[path] = meta
                try:
                    by_path[os.path.realpath(path)] = meta
                except Exception:
                    pass
            if mp and isinstance(mp, str) and mp != "[SWAP]":
                by_mount[mp] = meta

            is_virtual = (
                btype in ("loop", "rom", "zram")
                or name.startswith(("loop", "zram", "ram", "sr"))
                or fstype in ("swap", "squashfs")
                or mp == "[SWAP]"
            )
            if not is_virtual and size_bytes > 0:
                if btype in ("part", "lvm", "crypt", "md", "dm") or (btype == "disk" and not children):
                    candidates.append(meta)

            if children:
                walk(children, meta)

    walk(parsed.get("blockdevices"))
    return by_path, by_mount, candidates


def _resolve_transport_info(kind, fstype, tran, dev_name):
    t = (tran or "").strip().lower()
    fs = (fstype or "").strip().lower()
    dn = (dev_name or "").strip().lower()
    if kind == "network":
        if fs in ("cifs", "smb", "smb3"):
            tkey = "nas_smb"
            return tkey, get_hardware_transport_label(tkey, base_dir=BASE_DIR)
        if fs.startswith("nfs"):
            tkey = "nas_nfs"
            return tkey, get_hardware_transport_label(tkey, base_dir=BASE_DIR)
        return "local_disk", f"{fs.upper() or 'NET'}"
    if t == "usb":
        tkey = "usb_removable"
    elif t == "mmc" or "mmcblk" in dn:
        tkey = "sd_mmc"
    elif t == "nvme" or "nvme" in dn:
        tkey = "nvme_ssd"
    elif t in ("sata", "ata"):
        tkey = "sata_disk"
    elif kind == "removable":
        tkey = "removable"
    else:
        tkey = "local_disk"
    return tkey, get_hardware_transport_label(tkey, base_dir=BASE_DIR)


def _format_transport_badge(kind, fstype, tran, dev_name):
    _, label = _resolve_transport_info(kind, fstype, tran, dev_name)
    return label


def _compute_pool_key(kind, dev_name, mpoint, total_bytes, blk_meta=None):
    if kind == "network":
        dn = (dev_name or "").strip()
        if dn.startswith("//"):
            remote_host = dn.lstrip("/").split("/", 1)[0].lower()
        elif ":/" in dn:
            remote_host = dn.split(":", 1)[0].lower()
        else:
            remote_host = dn.lower() or mpoint
        return f"net:{remote_host}:{int(total_bytes)}"
    uuid = (blk_meta or {}).get("uuid") if blk_meta else ""
    base_dev = uuid or (blk_meta or {}).get("path") or dev_name or mpoint
    try:
        if not uuid and dev_name.startswith("/dev/"):
            base_dev = os.path.realpath(dev_name)
    except Exception:
        pass
    return f"{kind}:{base_dev}:{int(total_bytes)}"


def fetch_disks_worker():
    global DISKS_CACHE
    ignored_fstypes = {
        "proc", "sysfs", "tmpfs", "devtmpfs", "devpts", "cgroup", "cgroup2",
        "pstore", "securityfs", "debugfs", "tracefs", "configfs", "fusectl",
        "hugetlbfs", "mqueue", "binfmt_misc", "autofs", "squashfs", "overlay",
        "nsfs", "efivarfs", "fuse.lxcfs", "fuse.portal", "ramfs", "rpc_pipefs",
        "swap"
    }
    net_fstypes = {"cifs", "smb", "smb3", "nfs", "nfs4", "sshfs", "fuse.sshfs", "davfs", "glusterfs"}
    while True:
        try:
            dev_temps, nvme_fallback = _read_hwmon_disk_temps()
            blk_by_path, blk_by_mount, blk_candidates = _read_lsblk_metadata()

            disks = []
            seen_mounts = set()
            seen_mounted_devs = set()
            pool_primary_mount = {}
            partitions = []
            try:
                partitions = psutil.disk_partitions(all=True)
            except Exception:
                partitions = []

            for part in partitions:
                mpoint = part.mountpoint
                fstype = (part.fstype or "").lower()
                dev_name = part.device or ""
                if not mpoint or mpoint in seen_mounts:
                    continue
                if fstype in ignored_fstypes or mpoint.startswith(("/proc", "/sys", "/dev", "/run", "/snap")):
                    continue

                real_dev = dev_name
                try:
                    if dev_name.startswith("/dev/"):
                        real_dev = os.path.realpath(dev_name)
                except Exception:
                    pass

                blk = blk_by_mount.get(mpoint) or blk_by_path.get(real_dev) or blk_by_path.get(dev_name)
                is_net = fstype in net_fstypes or dev_name.startswith("//") or (":/" in dev_name and not dev_name.startswith("/"))
                is_removable = False if is_net else bool(blk and blk.get("is_removable"))

                # Excluir partición EFI del sistema (/boot/efi) salvo que sea un medio extraíble USB/SD
                if fstype == "vfat" and mpoint.startswith("/boot") and not is_removable:
                    continue

                seen_mounts.add(mpoint)
                try:
                    st = os.statvfs(mpoint)
                    total = st.f_blocks * st.f_frsize
                    free = st.f_bavail * st.f_frsize
                    used = max(0, total - (st.f_bfree * st.f_frsize))
                    if total == 0:
                        continue
                    percent = round((used / total) * 100, 1)
                    kind = "network" if is_net else ("removable" if is_removable else "local")
                    tran = (blk or {}).get("tran") or ""
                    model = (blk or {}).get("model") or ""
                    fs_label = (blk or {}).get("fs_label") or ""
                    transport_key, transport = _resolve_transport_info(kind, fstype, tran, dev_name)
                    pool_key = _compute_pool_key(kind, dev_name, mpoint, total, blk)

                    is_primary = pool_key not in pool_primary_mount
                    shared_with = None if is_primary else pool_primary_mount[pool_key]
                    if is_primary:
                        pool_primary_mount[pool_key] = mpoint

                    if mpoint == "/":
                        if model or dev_name:
                            label_key = "root_system"
                            label_params = {"name": model or dev_name}
                        else:
                            label_key = "root_plain"
                            label_params = {}
                    elif kind == "network":
                        share_leaf = os.path.basename(mpoint.rstrip("/")) or dev_name
                        remote_host = dev_name.lstrip("/").split("/", 1)[0] if dev_name.startswith("//") else dev_name.split(":", 1)[0]
                        if remote_host:
                            label_key = "network_share"
                            label_params = {"leaf": share_leaf, "host": remote_host}
                        else:
                            label_key = "network_share_plain"
                            label_params = {"leaf": share_leaf}
                    elif kind == "removable":
                        leaf = fs_label or os.path.basename(mpoint.rstrip("/")) or (blk or {}).get("name") or dev_name
                        if model and model.lower() not in leaf.lower():
                            label_key = "named_volume"
                            label_params = {"model": model, "name": leaf}
                        else:
                            label_key = "removable_media"
                            label_params = {"name": leaf}
                    else:
                        leaf = fs_label or os.path.basename(mpoint.rstrip("/")) or mpoint
                        if model:
                            label_key = "named_volume"
                            label_params = {"model": model, "name": leaf}
                        else:
                            label_key = "device_volume"
                            label_params = {"name": leaf}
                    label = get_hardware_disk_label(label_key, label_params, base_dir=BASE_DIR)

                    root_disk = (blk or {}).get("root_disk") or ""
                    kname = (blk or {}).get("kname") or ""
                    disk_temp = dev_temps.get(root_disk) or dev_temps.get(kname)
                    if disk_temp is None and ("nvme" in kname or "nvme" in dev_name or mpoint == "/"):
                        disk_temp = nvme_fallback

                    if real_dev:
                        seen_mounted_devs.add(real_dev)
                    if dev_name:
                        seen_mounted_devs.add(dev_name)

                    disks.append({
                        "mountpoint": mpoint,
                        "label": label,
                        "label_key": label_key,
                        "label_params": label_params,
                        "device": dev_name,
                        "fstype": part.fstype or fstype,
                        "fstype_key": None if (part.fstype or fstype) else "unformatted",
                        "kind": kind,
                        "transport": transport,
                        "transport_key": transport_key,
                        "model": model or None,
                        "mounted": True,
                        "is_removable": is_removable,
                        "pool_key": pool_key,
                        "pool_primary": is_primary,
                        "pool_shared_with": shared_with,
                        "temp_c": disk_temp,
                        "total_bytes": total,
                        "used_bytes": used,
                        "free_bytes": free,
                        "percent": percent,
                    })
                except Exception:
                    continue

            # Anotar puntos compartidos/subcarpetas dentro de cada entrada pool_primary (CIFS/bind-mounts)
            pool_groups = {}
            for d_item in disks:
                pk = d_item.get("pool_key")
                if not pk:
                    continue
                grp = pool_groups.setdefault(pk, {"mounts": [], "labels": []})
                mp_val = d_item.get("mountpoint")
                if mp_val and mp_val not in grp["mounts"]:
                    grp["mounts"].append(mp_val)
                leaf_val = os.path.basename(str(mp_val or "").rstrip("/")) or d_item.get("label") or mp_val
                if leaf_val and leaf_val not in grp["labels"]:
                    grp["labels"].append(leaf_val)
            for d_item in disks:
                if d_item.get("pool_primary"):
                    grp = pool_groups.get(d_item.get("pool_key"), {})
                    d_item["shared_mounts"] = list(grp.get("mounts") or [])
                    d_item["shared_labels"] = list(grp.get("labels") or [])

            # Incluir también memorias extraíbles USB/SD o discos de datos conectados en el sistema aunque no estén montados aún
            for blk in blk_candidates:
                bpath = blk.get("path") or ""
                bmp = blk.get("mountpoint")
                bfstype = blk.get("fstype") or ""
                bsize = int(blk.get("size_bytes") or 0)
                if bmp and bmp in seen_mounts:
                    continue
                if bpath and bpath in seen_mounted_devs:
                    continue
                if bfstype in ("linux_raid_member", "lvm2_member", "crypto_luks", "swap", "squashfs"):
                    continue
                is_rem = bool(blk.get("is_removable"))
                blabel = (blk.get("fs_label") or "").lower()
                # Ignorar pequeñas particiones EFI/reserva ocultas no extraíbles
                if not is_rem and (bsize < 256 * 1024 * 1024 or (bfstype == "vfat" and bsize <= 2500 * 1024 * 1024) or "efi" in blabel):
                    continue
                # Mostrar memorias extraíbles siempre, y particiones locales no montadas con formato válido
                if not is_rem and not bfstype:
                    continue
                kind = "removable" if is_rem else "local"
                transport_key, transport = _resolve_transport_info(kind, bfstype, blk.get("tran"), bpath)
                model = blk.get("model") or ""
                leaf = blk.get("fs_label") or blk.get("name") or bpath
                if model and model.lower() not in leaf.lower():
                    label_key = "named_volume"
                    label_params = {"model": model, "name": leaf}
                elif is_rem:
                    label_key = "removable_media"
                    label_params = {"name": leaf}
                else:
                    label_key = "disk_generic"
                    label_params = {"name": leaf}
                label = get_hardware_disk_label(label_key, label_params, base_dir=BASE_DIR)
                pool_key = _compute_pool_key(kind, bpath, bpath, bsize, blk)
                root_disk = blk.get("root_disk") or ""
                kname = blk.get("kname") or ""
                disk_temp = dev_temps.get(root_disk) or dev_temps.get(kname)
                disks.append({
                    "mountpoint": bpath,
                    "label": label,
                    "label_key": label_key,
                    "label_params": label_params,
                    "device": bpath,
                    "fstype": bfstype or i18n_t("hardware.storage.fstype.unformatted", base_dir=BASE_DIR, fallback="sin formato"),
                    "fstype_key": None if bfstype else "unformatted",
                    "kind": kind,
                    "transport": transport,
                    "transport_key": transport_key,
                    "model": model or None,
                    "mounted": False,
                    "is_removable": is_rem,
                    "pool_key": pool_key,
                    "pool_primary": False,
                    "pool_shared_with": None,
                    "temp_c": disk_temp,
                    "total_bytes": bsize,
                    "used_bytes": 0,
                    "free_bytes": bsize,
                    "percent": 0.0,
                })

            if not disks and os.path.exists("/"):
                try:
                    st = os.statvfs("/")
                    total = st.f_blocks * st.f_frsize
                    free = st.f_bavail * st.f_frsize
                    used = max(0, total - (st.f_bfree * st.f_frsize))
                    if total > 0:
                        disks.append({
                            "mountpoint": "/",
                            "label": get_hardware_disk_label("root_plain", {}, base_dir=BASE_DIR),
                            "label_key": "root_plain",
                            "label_params": {},
                            "device": "rootfs",
                            "fstype": "ext4",
                            "kind": "local",
                            "transport": get_hardware_transport_label("local_disk", base_dir=BASE_DIR),
                            "transport_key": "local_disk",
                            "model": None,
                            "mounted": True,
                            "is_removable": False,
                            "pool_key": f"local:rootfs:{total}",
                            "pool_primary": True,
                            "pool_shared_with": None,
                            "temp_c": nvme_fallback,
                            "total_bytes": total,
                            "used_bytes": used,
                            "free_bytes": free,
                            "percent": round((used / total) * 100, 1)
                        })
                except Exception:
                    pass
            with DISKS_LOCK:
                DISKS_CACHE = disks
        except Exception:
            pass
        time.sleep(4)

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
                        "image": meta.get("image", ""),
                        "state": meta.get("state", "running"),
                        "status": meta.get("status", "Up"),
                        "cpu_percent": round(cpu_val, 2),
                        "cpu_val": cpu_val,
                        "cpu_norm_percent": round(cpu_val / max(1, CORES_LOGICAL), 1),
                        "mem_usage": data.get("MemUsage", ""),
                        "mem_mb": round(mem_mb, 1),
                        "mem_percent": round(mem_pct_val, 2),
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
                        "image": meta.get("image", ""),
                        "state": meta.get("state", "exited"),
                        "status": meta.get("status", "Detenido"),
                        "cpu_percent": 0.0,
                        "cpu_val": 0.0,
                        "cpu_norm_percent": 0.0,
                        "mem_usage": "0MiB / --",
                        "mem_mb": 0.0,
                        "mem_percent": 0.0,
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
                    role_key = unit_id.replace(".service", "")
                    localized_role = get_systemd_role_label(role_key, base_dir=BASE_DIR) or role_tag
                    sysd_list.append({
                        "unit": unit_id,
                        "name": friendly_name,
                        "role": localized_role,
                        "role_key": role_key,
                        "description": localized_role,
                        "active": (st == "active"),
                        "state": st,
                        "state_key": st,
                        "active_state": st
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
                "available": False,
                "online": False,
                "server_name": "Emby Media Server",
                "active_streams": 0,
                "sessions": []
            }
            try:
                emby_candidates = [
                    os.environ.get("RECURSOS_EMBY_DB", "").strip(),
                    os.path.join(BASE_DIR, "emby", "library.db"),
                    os.path.join(BASE_DIR, "..", "emby", "programdata", "data", "library.db"),
                ]
                if os.path.exists("/home/servidor/servicios/emby/programdata/data/library.db"):
                    emby_candidates.append("/home/servidor/servicios/emby/programdata/data/library.db")
                emby_db = next((p for p in emby_candidates if p and os.path.isfile(p)), "")
                if emby_db and os.path.exists(emby_db):
                    conn_emby = None
                    try:
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
                        emby_data["online"] = True
                        emby_data["library_counts"] = {
                            "Películas": emby_data["movies_count"],
                            "Series": emby_data["series_count"],
                            "Episodios": emby_data["episodes_count"]
                        }
                    finally:
                        if conn_emby is not None:
                            try:
                                conn_emby.close()
                            except Exception:
                                pass
            except Exception:
                pass

            parental_info = {"authorized": False, "status": "BLOCKED", "reason": "Control de acceso inactivo"}
            try:
                st_candidates = [
                    os.environ.get("RECURSOS_PARENTAL_STATE", "").strip(),
                    os.path.join(BASE_DIR, "control_acceso_s10", "estado.json"),
                    os.path.join(BASE_DIR, "estado.json"),
                    os.path.join(BASE_DIR, "..", "control_acceso_s10", "estado.json"),
                ]
                if os.path.exists("/home/servidor/servicios/control_acceso_s10/estado.json"):
                    st_candidates.append("/home/servidor/servicios/control_acceso_s10/estado.json")
                st_file = next((p for p in st_candidates if p and os.path.isfile(p)), "")
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
def load_device_friendly_names():
    """Carga dinámicamente alias opcionales por MAC desde device_friendly_names.json (Zero-Hardcoding)."""
    aliases = {}
    for cand in [
        os.path.join(BASE_DIR, "device_friendly_names.json"),
        TELEGRAM_FRIENDLY_NAMES_FILE,
    ]:
        if cand and os.path.isfile(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        for k, v in data.items():
                            if k and v:
                                aliases[str(k).strip().upper()] = str(v).strip()
            except Exception:
                pass
    return aliases

def _is_lan_ipv4(ip_str):
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        return isinstance(ip_obj, ipaddress.IPv4Address) and ip_obj.is_private and not ip_obj.is_loopback
    except Exception:
        return False

# ==============================================================================
# Dynamic LAN/Wi-Fi Client & Traffic Monitor (Zero-Hardcoding)
# ==============================================================================
def get_arp_and_pihole_names():
    arp_map = {}
    friendly_names = load_device_friendly_names()

    # 1. Leer nombres estáticos de /etc/hosts
    hosts_ip_to_name = {}
    try:
        with open("/etc/hosts", "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    parts = line.split()
                    if len(parts) >= 2 and _is_lan_ipv4(parts[0]):
                        hosts_ip_to_name[parts[0]] = parts[1]
    except Exception:
        pass

    # 2. Leer tabla de vecinos ARP (ip neigh)
    try:
        p = subprocess.run(['ip', 'neigh'], capture_output=True, text=True, timeout=2)
        for line in p.stdout.splitlines():
            m = re.search(r'^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([0-9a-fA-F:]{17})', line)
            if m and _is_lan_ipv4(m.group(1)):
                ip, mac = m.group(1), m.group(2).upper()
                name = friendly_names.get(mac) or hosts_ip_to_name.get(ip, ip)
                arp_map[mac] = {'ip': ip, 'name': name}
    except Exception:
        pass

    # 3. Leer base de datos de Pi-hole FTL en modo solo lectura sin subprocesos ni bloqueos
    conn_pi = None
    try:
        conn_pi = sqlite3.connect("file:/etc/pihole/pihole-FTL.db?mode=ro", uri=True, timeout=2.0)
        cur_pi = conn_pi.cursor()
        cur_pi.execute(
            "SELECT network.hwaddr, network.macVendor, network_addresses.name, network_addresses.ip, network_addresses.lastSeen "
            "FROM network JOIN network_addresses ON network.id = network_addresses.network_id "
            "ORDER BY network_addresses.lastSeen DESC;"
        )
        for row in cur_pi.fetchall():
            mac = (row[0] or "").strip().upper()
            vendor = row[1] or ""
            name = row[2] or ""
            ip = (row[3] or "").strip()
            last_seen = int(row[4] or 0) if len(row) > 4 and row[4] is not None else 0
            if not mac or mac in ("00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF"):
                continue
            if not ip or ip == "0.0.0.0":
                continue
            if _is_lan_ipv4(ip):
                final_name = friendly_names.get(mac) or hosts_ip_to_name.get(ip) or name or vendor or ip
                if mac not in arp_map:
                    arp_map[mac] = {'ip': ip, 'name': final_name, 'vendor': vendor, 'last_seen': last_seen}
                else:
                    if vendor and not arp_map[mac].get('vendor'):
                        arp_map[mac]['vendor'] = vendor
                    if last_seen and not arp_map[mac].get('last_seen'):
                        arp_map[mac]['last_seen'] = last_seen
                    if friendly_names.get(mac):
                        arp_map[mac]['name'] = friendly_names[mac]
                    elif hosts_ip_to_name.get(ip):
                        arp_map[mac]['name'] = hosts_ip_to_name[ip]
                    elif name and arp_map[mac]['name'] == arp_map[mac]['ip']:
                        arp_map[mac]['name'] = name
                    elif vendor and arp_map[mac]['name'] == arp_map[mac]['ip']:
                        arp_map[mac]['name'] = f"{vendor} ({ip})"
    except Exception:
        pass
    finally:
        if conn_pi is not None:
            try:
                conn_pi.close()
            except Exception:
                pass
    return arp_map

def get_ip_to_device_name_map():
    arp_mac_map = get_arp_and_pihole_names()
    ip_to_name = {}
    for _mac, data in arp_mac_map.items():
        if isinstance(data, dict) and 'ip' in data and 'name' in data:
            ip_to_name[data['ip']] = data['name']
    return ip_to_name

def _build_duckdns_candidates(filename, extra_paths=None):
    cands = []
    env_dir = os.environ.get("DUCKDNS_DIR", "").strip()
    if env_dir:
        cands.append(os.path.join(env_dir, filename))
    cands.extend([
        os.path.join(BASE_DIR, "duckdns", filename),
        os.path.join(BASE_DIR, filename),
        os.path.join(BASE_DIR, "..", "duckdns", filename),
        os.path.join(BASE_DIR, "servicios", "duckdns", filename),
        f"./duckdns/{filename}",
        f"./{filename}",
    ])
    for ep in (extra_paths or []):
        if os.path.exists(ep):
            cands.append(ep)
    for sp in [f"/home/servidor/servicios/duckdns/{filename}", f"/home/servidor/duckdns/{filename}"]:
        if os.path.exists(sp):
            cands.append(sp)
    return cands

def get_duckdns_script_file():
    for p in _build_duckdns_candidates("duck.sh"):
        if os.path.isfile(p):
            return p
    return os.path.join(BASE_DIR, "duckdns", "duck.sh")

DUCKDNS_SCRIPT = get_duckdns_script_file()

def get_duckdns_log_file():
    for p in _build_duckdns_candidates("duck.log", [os.path.join(BASE_DIR, "logs", "duck.log"), "/mnt/almacenamiento/logs/duckdns/duck.log"]):
        if os.path.isfile(p):
            return p
    return os.path.join(BASE_DIR, "duck.log")

def get_duckdns_ip_cache_file():
    for p in _build_duckdns_candidates("last_ip.txt"):
        if os.path.isfile(p):
            return p
    return os.path.join(BASE_DIR, "last_ip.txt")

DUCKDNS_IP_CACHE = get_duckdns_ip_cache_file()

def get_duckdns_status():
    domain = os.environ.get("DUCKDNS_DOMAIN", "").strip()
    token = os.environ.get("DUCKDNS_TOKEN", "").strip()
    script_p = get_duckdns_script_file()
    if os.path.isfile(script_p):
        try:
            with open(script_p, "r", encoding="utf-8") as f:
                content = f.read()
                m_dom = re.search(r'DOMAIN=["\']?([^"\'\s]+)["\']?', content)
                m_tok = re.search(r'TOKEN=["\']?([^"\'\s]+)["\']?', content)
                if m_dom and not domain:
                    domain = m_dom.group(1)
                if m_tok and not token:
                    token = m_tok.group(1)
        except Exception:
            pass

    if not domain:
        sys_dom = detect_system_dns_domain()
        if sys_dom.endswith(".duckdns.org"):
            domain = sys_dom[:-len(".duckdns.org")].split(".")[-1]

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
                lines = [re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+', '', l).strip() for l in f]
                lines = [l for l in lines if l]
                if lines:
                    last_log_line = lines[-1]
                    m_ts = re.search(r'\[(.*?)\]', last_log_line)
                    if m_ts:
                        last_update_time = m_ts.group(1)
        except Exception:
            pass

    masked_token = (token[:4] + "*" * (len(token) - 8) + token[-4:]) if len(token) > 8 else ("****" if token else "")

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

    full_domain = f"{domain}.duckdns.org" if (domain and "." not in domain) else (domain or detect_system_dns_domain())
    script_installed = os.path.isfile(script_p)
    return {
        "available": script_installed,
        "installed": script_installed,
        "domain": domain,
        "full_domain": full_domain,
        "token_set": bool(token),
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
            lines = [re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+', '', l).strip() for l in f]
            lines = [l for l in lines if l]
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
        ok = (res.returncode == 0)
        return {
            "success": ok,
            "message": "Sincronización DuckDNS completada correctamente" if ok else (res.stderr.strip() or "Error al sincronizar DuckDNS"),
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
        return {
            "available": False,
            "summary": {
                "total_queries_24h": 0,
                "blocked_queries_24h": 0,
                "pct_blocked_24h": 0.0,
                "unique_domains_24h": 0,
                "unique_clients_24h": 0,
            },
            "top_domains": [],
            "clients": [],
            "recent_queries": [],
        }

    ip_to_name = get_ip_to_device_name_map()

    conn = None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.5)
        cur = conn.cursor()

        sql_summary = (
            "SELECT COUNT(*) AS total_q, "
            "SUM(CASE WHEN status IN (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16) THEN 1 ELSE 0 END) AS blocked_q, "
            "COUNT(DISTINCT LOWER(TRIM(domain))) AS unique_domains, "
            "COUNT(DISTINCT client) AS unique_clients "
            "FROM queries WHERE timestamp >= strftime('%s', 'now', '-24 hours');"
        )
        sum_row = cur.execute(sql_summary).fetchone()
        total_q_24h = int(sum_row[0] or 0) if sum_row else 0
        blocked_q_24h = int(sum_row[1] or 0) if sum_row else 0
        unique_doms_24h = int(sum_row[2] or 0) if sum_row else 0
        unique_clients_24h = int(sum_row[3] or 0) if sum_row else 0
        summary = {
            "total_queries_24h": total_q_24h,
            "blocked_queries_24h": blocked_q_24h,
            "pct_blocked_24h": round((blocked_q_24h / total_q_24h) * 100.0, 1) if total_q_24h > 0 else 0.0,
            "unique_domains_24h": unique_doms_24h,
            "unique_clients_24h": unique_clients_24h,
        }

        sql_global_domains = (
            "SELECT LOWER(TRIM(domain)) AS dom, "
            "COUNT(*) AS count, "
            "SUM(CASE WHEN status IN (1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16) THEN 1 ELSE 0 END) AS blocked_count, "
            "COUNT(DISTINCT client) AS clients_count, "
            "AVG(reply_time) * 1000.0 AS avg_reply_ms "
            "FROM queries "
            "WHERE domain IS NOT NULL AND TRIM(domain) != '' "
            "AND timestamp >= strftime('%s', 'now', '-24 hours') "
            "GROUP BY dom ORDER BY count DESC LIMIT 30;"
        )
        top_domains = []
        for d_row in cur.execute(sql_global_domains).fetchall():
            dom_name = d_row[0] or ""
            if not dom_name:
                continue
            d_count = int(d_row[1] or 0)
            d_blocked = int(d_row[2] or 0)
            top_domains.append({
                "domain": dom_name,
                "count": d_count,
                "blocked_count": d_blocked,
                "pct_blocked": round((d_blocked / d_count) * 100.0, 1) if d_count > 0 else 0.0,
                "clients_count": int(d_row[3] or 0),
                "avg_reply_ms": round(float(d_row[4] or 0.0), 1),
            })

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

        try:
            conn.close()
        except Exception:
            pass
        conn = None

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
            "summary": summary,
            "top_domains": top_domains,
            "clients": clients_list,
            "recent_queries": queries_list
        }
    except Exception as e:
        return {
            "available": False,
            "error": str(e),
            "summary": {
                "total_queries_24h": 0,
                "blocked_queries_24h": 0,
                "pct_blocked_24h": 0.0,
                "unique_domains_24h": 0,
                "unique_clients_24h": 0,
            },
            "top_domains": [],
            "clients": [],
            "recent_queries": [],
        }
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

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
    elif any(k in name_l for k in ["xbox", "series-s", "series-x"]):
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
    elif any(k in name_l for k in ["asus", "rt-", "rog"]):
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
_FCACHE_FLOW_PREV = {}          # { flow_key: bytes_est }
_FCACHE_LAST_TS = 0.0
_FCACHE_BASELINE_READY = False
_WL_BYTES_PREV = {}             # { mac: (ts, tx_bytes, rx_bytes) }
_GATEWAY_UPNP_CACHE = {"ts": 0.0, "ip": "", "data": {}}
_SERVER_DIRECT_NET_SPEEDS = {"wan_rx": 0.0, "wan_tx": 0.0, "lan_rx": 0.0, "lan_tx": 0.0, "ts": 0.0}
_SERVER_PEER_LAN_SPEEDS = {"ts": 0.0, "peers": {}}
_DEVICES_DB_CACHE = {"ts": 0.0, "payload": None}
_DEVICES_DB_LOCK = threading.Lock()
_PIHOLE_CATALOG_CACHE = {"ts": 0.0, "data": {}}

_RE_FCACHE_FLOW = re.compile(
    r'^(0x[0-9a-fA-F]+)@\S+\s+(\d+):\s+\d+\s+(\d+):\s+(\d+)\s+\S+\s+\S+\s+(\d+)\s+(?:EPHY|WPHY)\s+\d+\s+<([0-9a-fA-F:]{17})>\s+<([0-9a-fA-F:]{17})>.*?\b(\d+)\s+\d+\s*$'
)


def _discover_gateway_upnp_info(gw_ip):
    """Descubre dinámicamente fabricante, modelo y nombre UPnP IGD del router gateway sin valores fijos."""
    gw_ip = str(gw_ip or "").strip()
    if not gw_ip or not _is_lan_ipv4(gw_ip):
        return {}
    now = time.time()
    if _GATEWAY_UPNP_CACHE.get("ip") == gw_ip and (now - float(_GATEWAY_UPNP_CACHE.get("ts") or 0)) < 300.0:
        return dict(_GATEWAY_UPNP_CACHE.get("data") or {})

    locs = []
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.settimeout(0.75)
        msg = (
            "M-SEARCH * HTTP/1.1\r\n"
            f"HOST: {gw_ip}:1900\r\n"
            'MAN: "ssdp:discover"\r\n'
            "MX: 1\r\n"
            "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n"
        ).encode("utf-8")
        sock.sendto(msg, (gw_ip, 1900))
        while len(locs) < 3:
            try:
                data, _addr = sock.recvfrom(4096)
                for ln in data.decode("utf-8", errors="ignore").splitlines():
                    if ln.lower().startswith("location:"):
                        loc = ln.split(":", 1)[1].strip()
                        if loc.startswith("http") and loc not in locs:
                            locs.append(loc)
            except Exception:
                break
    except Exception:
        pass
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass

    for fallback_port in (52869, 49152, 5000, 1900):
        cand = f"http://{gw_ip}:{fallback_port}/gatedesc.xml"
        if cand not in locs:
            locs.append(cand)

    info = {}
    for loc_url in locs[:5]:
        try:
            with urllib.request.urlopen(loc_url, timeout=1.0) as resp:
                xml_txt = resp.read(32768).decode("utf-8", errors="ignore")
            root = ET.fromstring(xml_txt)
            manuf = ""
            model_name = ""
            model_num = ""
            friendly = ""
            for elem in root.iter():
                tag = elem.tag.split("}")[-1]
                val = (elem.text or "").strip()
                if not val:
                    continue
                if tag == "manufacturer" and not manuf:
                    manuf = val
                elif tag == "modelName" and not model_name:
                    model_name = val
                elif tag == "modelNumber" and not model_num:
                    model_num = val
                elif tag == "friendlyName" and not friendly:
                    friendly = val
            if manuf or model_name or friendly:
                model_parts = []
                if manuf:
                    model_parts.append(manuf)
                if model_name and model_name.lower() not in manuf.lower():
                    model_parts.append(model_name)
                info = {
                    "manufacturer": manuf,
                    "model_name": model_name,
                    "model_number": model_num,
                    "friendly_name": friendly,
                    "model_display": " ".join(model_parts).strip() or friendly,
                    "location": loc_url,
                }
                break
        except Exception:
            continue

    _GATEWAY_UPNP_CACHE["ip"] = gw_ip
    _GATEWAY_UPNP_CACHE["ts"] = now
    _GATEWAY_UPNP_CACHE["data"] = info
    return dict(info)


def _read_pihole_network_catalog(limit=2000, max_age=10.0):
    """Lee en modo solo lectura los equipos registrados en Pi-hole (`network` + `network_addresses`)."""
    now = time.time()
    cached = _PIHOLE_CATALOG_CACHE.get("data")
    if cached and (now - float(_PIHOLE_CATALOG_CACHE.get("ts") or 0.0)) < max_age:
        return dict(cached)

    db_path = "/etc/pihole/pihole-FTL.db"
    if not os.path.exists(db_path):
        return {}

    friendly_names = load_device_friendly_names()
    catalog = {}
    conn_pi = None
    try:
        conn_pi = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.5)
        cur_pi = conn_pi.cursor()
        cur_pi.execute(
            """
            SELECT n.hwaddr, n.interface, n.firstSeen, n.lastQuery, n.numQueries,
                   n.macVendor, na.ip, na.name, na.lastSeen
            FROM network n
            LEFT JOIN network_addresses na ON na.network_id = n.id
            ORDER BY COALESCE(na.lastSeen, n.lastQuery, n.firstSeen, 0) DESC
            """
        )
        for row in cur_pi.fetchall():
            mac = str(row[0] or "").strip().upper()
            if not mac or mac in ("00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF"):
                continue
            iface = str(row[1] or "").strip()
            first_seen = int(row[2] or 0)
            last_query = int(row[3] or 0)
            num_queries = int(row[4] or 0)
            vendor = str(row[5] or "").strip()
            ip = str(row[6] or "").strip()
            na_name = str(row[7] or "").strip()
            last_seen = int(row[8] or 0)
            eff_last = max(last_seen, last_query, first_seen)

            is_v4 = bool(ip and _is_lan_ipv4(ip))
            existing = catalog.get(mac)
            if existing is None:
                best_ip = ip if is_v4 else ""
                best_name = friendly_names.get(mac) or na_name or vendor or best_ip or mac
                catalog[mac] = {
                    "mac": mac,
                    "ip": best_ip,
                    "name": best_name,
                    "vendor": vendor,
                    "iface": iface,
                    "first_seen_ts": first_seen,
                    "last_seen_ts": eff_last,
                    "last_query_ts": last_query,
                    "pihole_queries": num_queries,
                }
            else:
                if is_v4 and not existing.get("ip"):
                    existing["ip"] = ip
                if na_name and existing.get("name") in ("", existing.get("mac"), existing.get("ip"), existing.get("vendor")):
                    existing["name"] = friendly_names.get(mac) or na_name
                if vendor and not existing.get("vendor"):
                    existing["vendor"] = vendor
                existing["pihole_queries"] = max(existing.get("pihole_queries", 0), num_queries)
                existing["last_seen_ts"] = max(existing.get("last_seen_ts", 0), eff_last)
                existing["last_query_ts"] = max(existing.get("last_query_ts", 0), last_query)
            if len(catalog) >= limit:
                break
    except Exception:
        pass
    finally:
        if conn_pi is not None:
            try:
                conn_pi.close()
            except Exception:
                pass

    _PIHOLE_CATALOG_CACHE["ts"] = now
    _PIHOLE_CATALOG_CACHE["data"] = catalog
    return dict(catalog)


def build_unified_devices_database(force_refresh=False):
    """Combina en vivo los dispositivos activos con el catálogo completo de Pi-hole, router Wi-Fi y Gateway."""
    now = time.time()
    with _DEVICES_DB_LOCK:
        cached = _DEVICES_DB_CACHE.get("payload")
        if not force_refresh and cached is not None and (now - float(_DEVICES_DB_CACHE.get("ts") or 0.0)) < 6.0:
            return cached

    with WIFI_LOCK:
        wifi_snapshot = list(WIFI_CACHE.get("clients", []))
        wifi_summary = dict(WIFI_CACHE.get("summary", {}))

    pihole_catalog = _read_pihole_network_catalog(limit=2000, max_age=0.0 if force_refresh else 10.0)
    friendly_names = load_device_friendly_names()

    merged = []
    seen_macs = set()
    for cl in wifi_snapshot:
        item = dict(cl)
        mac_u = str(item.get("mac") or "").upper()
        if mac_u:
            seen_macs.add(mac_u)
            ph = pihole_catalog.get(mac_u)
            if ph:
                srcs = list(item.get("sources") or [])
                if "pihole" not in srcs:
                    srcs.append("pihole")
                item["sources"] = srcs
                item["pihole_queries"] = int(item.get("pihole_queries") or ph.get("pihole_queries") or 0)
                item["first_seen_ts"] = int(item.get("first_seen_ts") or ph.get("first_seen_ts") or 0)
                item["last_seen_ts"] = max(int(item.get("last_seen_ts") or 0), int(ph.get("last_seen_ts") or 0))
        if item.get("last_seen_ts") and not item.get("last_seen"):
            try:
                item["last_seen"] = datetime.fromtimestamp(int(item["last_seen_ts"])).strftime("%d/%m %H:%M")
            except Exception:
                pass
        merged.append(item)

    for mac_u, ph in pihole_catalog.items():
        if mac_u in seen_macs:
            continue
        p_ip = str(ph.get("ip") or "").strip()
        if not p_ip:
            continue
        d_name = friendly_names.get(mac_u) or ph.get("name") or p_ip
        c_meta = classify_device(d_name, mac_u)
        dev_type = c_meta.get("type", "generic")
        is_wired_guess = dev_type in ("server", "pc", "nas", "network", "tv", "console")
        last_ts = int(ph.get("last_seen_ts") or 0)
        last_str = ""
        if last_ts > 0:
            try:
                last_str = datetime.fromtimestamp(last_ts).strftime("%d/%m %H:%M")
            except Exception:
                last_str = ""
        off_band_key = "lan_offline" if is_wired_guess else "wifi_offline"
        merged.append({
            "conn_type": "cable" if is_wired_guess else "wifi",
            "band": i18n_t(f"hardware.net.band.{off_band_key}", base_dir=BASE_DIR),
            "band_key": off_band_key,
            "iface": "pihole-db",
            "mac": mac_u,
            "ip": p_ip,
            "name": d_name,
            "tx_bytes": 0,
            "rx_bytes": 0,
            "speed_down": 0.0,
            "speed_up": 0.0,
            "wan_speed_down": 0.0,
            "wan_speed_up": 0.0,
            "lan_speed_down": 0.0,
            "lan_speed_up": 0.0,
            "rssi": 0 if is_wired_guess else -90,
            "in_network": 0,
            "dev_type": dev_type,
            "dev_icon": c_meta["icon"],
            "brand": c_meta.get("brand", "generic"),
            "brand_name": c_meta.get("brand_name") or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
            "vendor": ph.get("vendor") or c_meta.get("brand_name") or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
            "vendor_key": None if (ph.get("vendor") or c_meta.get("brand_name")) else "generic",
            "status": "offline",
            "online": False,
            "is_online": False,
            "is_server": False,
            "is_gateway": False,
            "sources": ["pihole"],
            "pihole_queries": int(ph.get("pihole_queries") or 0),
            "first_seen_ts": int(ph.get("first_seen_ts") or 0),
            "last_seen_ts": last_ts,
            "last_seen": last_str,
        })

    # Reordenar: en línea primero (por descarga WAN -> descarga total -> consultas Pi-hole -> último contacto)
    merged.sort(
        key=lambda x: (
            1 if x.get("online", True) else 0,
            float(x.get("wan_speed_down") or 0.0) + float(x.get("wan_speed_up") or 0.0),
            float(x.get("speed_down") or 0.0) + float(x.get("speed_up") or 0.0),
            int(x.get("last_seen_ts") or 0),
            int(x.get("pihole_queries") or 0),
        ),
        reverse=True,
    )

    payload = {
        "ok": True,
        "updated_at": datetime.now().strftime("%H:%M:%S"),
        "summary": wifi_summary,
        "devices": merged,
        "total_count": len(merged),
    }
    with _DEVICES_DB_LOCK:
        _DEVICES_DB_CACHE["ts"] = now
        _DEVICES_DB_CACHE["payload"] = payload
    return payload

def fetch_wifi_worker():
    global WIFI_CACHE, MAC_RATE_CACHE, _FCACHE_FLOW_PREV, _FCACHE_LAST_TS, _FCACHE_BASELINE_READY, _WL_BYTES_PREV, SERVER_LOCAL_IP, ROUTER_SSH_BACKOFF_UNTIL, ROUTER_SSH_CONSECUTIVE_FAILS, ROUTER_SSH_LAST_ERROR
    while True:
        try:
            if not SERVER_LOCAL_IP or SERVER_LOCAL_IP.startswith("127."):
                resolved_local_ip = detect_local_server_ip()
                if resolved_local_ip and not resolved_local_ip.startswith("127."):
                    SERVER_LOCAL_IP = resolved_local_ip
            arp_map = get_arp_and_pihole_names()
            pihole_catalog = _read_pihole_network_catalog(limit=2000, max_age=10.0)
            friendly_names = load_device_friendly_names()

            # Descubrir puerta de enlace y su descriptor UPnP dinámicamente
            gw_ip = _detect_default_gateway_ip()
            gw_mac = next((m for m, info in arp_map.items() if info.get("ip") == gw_ip), "") if gw_ip else ""
            gw_upnp = _discover_gateway_upnp_info(gw_ip) if gw_ip else {}

            # Detectar interfaces y MACs locales dinámicamente desde psutil y /proc/net/dev
            local_server_tx = 0
            local_server_rx = 0
            server_macs = set()
            cable_clients = []
            try:
                net_io_map = psutil.net_io_counters(pernic=True)
                net_if_addrs = psutil.net_if_addrs()
                net_if_stats = psutil.net_if_stats()
                for if_name, addrs in net_if_addrs.items():
                    if if_name == "lo" or if_name.startswith(("veth", "docker", "br-", "virbr", "tailscale", "tun", "wg")):
                        continue
                    st = net_if_stats.get(if_name)
                    if st and not st.isup:
                        continue
                    ipv4_addr = ""
                    mac_addr = ""
                    for a in addrs:
                        if a.family == socket.AF_INET and a.address and not a.address.startswith("127."):
                            ipv4_addr = a.address
                        elif hasattr(psutil, "AF_LINK") and a.family == psutil.AF_LINK and a.address and a.address != "00:00:00:00:00:00":
                            mac_addr = a.address.upper()
                    if not ipv4_addr:
                        continue
                    if mac_addr:
                        server_macs.add(mac_addr)
                    io_c = net_io_map.get(if_name)
                    tx_b = io_c.bytes_sent if io_c else 0
                    rx_b = io_c.bytes_recv if io_c else 0
                    local_server_tx += tx_b
                    local_server_rx += rx_b
                    link_mbps = st.speed if (st and st.speed) else 1000
                    srv_sources = ["server"]
                    if mac_addr and mac_addr in pihole_catalog:
                        srv_sources.append("pihole")
                    cable_clients.append({
                        "conn_type": "cable",
                        "band": f"Cable ({link_mbps} Mbps)" if link_mbps else "Ethernet Local",
                        "band_key": "cable_mbps" if link_mbps else "ethernet_local",
                        "band_params": {"mbps": link_mbps} if link_mbps else None,
                        "iface": if_name,
                        "mac": mac_addr or f"IFACE:{if_name.upper()}",
                        "ip": ipv4_addr,
                        "name": f"{HOSTNAME} ({if_name})",
                        "dev_type": "server",
                        "dev_icon": "server",
                        "brand": "linux",
                        "brand_name": "Este Servidor",
                        "vendor": "Este Servidor",
                        "vendor_key": "this_server",
                        "status": "online",
                        "online": True,
                        "is_online": True,
                        "is_server": True,
                        "is_local_host": bool(
                            (SERVER_LOCAL_IP and not SERVER_LOCAL_IP.startswith("127.") and ipv4_addr == SERVER_LOCAL_IP)
                            or (not any(cc.get("is_local_host") for cc in cable_clients) and _is_lan_ipv4(ipv4_addr))
                        ),
                        "is_gateway": False,
                        "sources": srv_sources,
                        "tx_bytes": tx_b,
                        "rx_bytes": rx_b,
                        "rssi": 1000,
                        "in_network": int(time.time() - BOOT_TIME)
                    })
            except Exception:
                pass

            # Descubrir dinámicamente la puerta de enlace en ARP
            gw_name_resolved = ""
            if gw_ip:
                gw_meta_src = arp_map.get(gw_mac, {}) if gw_mac else {}
                gw_name_resolved = friendly_names.get(gw_mac) or gw_meta_src.get("name") or f"Gateway ({gw_ip})"
                if gw_mac or _is_lan_ipv4(gw_ip):
                    gw_meta = classify_device(gw_name_resolved, gw_mac)
                    gw_sources = ["gateway"]
                    if gw_mac and gw_mac in pihole_catalog:
                        gw_sources.append("pihole")
                    cable_clients.append({
                        "conn_type": "cable",
                        "band": "Gateway Uplink",
                        "band_key": "gateway_uplink",
                        "iface": "WAN / LAN",
                        "mac": gw_mac or f"GW:{gw_ip}",
                        "ip": gw_ip,
                        "name": gw_name_resolved,
                        "dev_type": "network",
                        "dev_icon": "router",
                        "brand": gw_meta.get("brand", "generic"),
                        "brand_name": gw_upnp.get("model_display") or gw_meta.get("brand_name", "Gateway"),
                        "vendor": gw_upnp.get("model_display") or gw_meta.get("brand_name", "Gateway"),
                        "vendor_key": "gateway" if not gw_upnp.get("model_display") and gw_meta.get("brand_name", "Gateway") == "Gateway" else None,
                        "status": "online",
                        "online": True,
                        "is_online": True,
                        "is_server": False,
                        "is_gateway": True,
                        "sources": gw_sources,
                        "tx_bytes": 0,
                        "rx_bytes": 0,
                        "rssi": 1000,
                        "in_network": int(time.time() - BOOT_TIME)
                    })

            wifi_clients = []
            aimesh_wifi_map = {}
            router_wired_map = {}
            router_macs_seen = set()
            router_arp_mac_to_ip = {}
            asus_model = ""
            router_ssh_ok = False
            fcache_stats = {}
            fcache_wan_macs = set()
            asus_eth0_rx = asus_eth0_tx = 0
            asus_eth4_rx = asus_eth4_tx = 0
            asus_eth3_rx = asus_eth3_tx = 0

            # Sondeo opcional de AP/router vía SSH sólo si está explícitamente configurado
            with ROUTER_CREDS_LOCK:
                r_ip_now = ROUTER_IP
                r_user_now = ROUTER_USER
                r_pass_now = ROUTER_PASS
                r_port_now = ROUTER_SSH_PORT
                r_backoff_until = ROUTER_SSH_BACKOFF_UNTIL
            router_configured = bool(r_ip_now and r_user_now and r_pass_now)
            if router_configured and shutil.which("sshpass") and time.time() >= r_backoff_until:
                ctl_path = _router_ssh_control_path()
                try:
                    ssh_env = os.environ.copy()
                    ssh_env["SSHPASS"] = r_pass_now
                    ssh_cmd = _build_router_ssh_base_cmd(
                        r_ip_now,
                        r_user_now,
                        r_port_now,
                        use_control_master=True,
                    ) + [
                        '''
                        echo "=== ROUTER_MODEL ==="
                        nvram get productid 2>/dev/null
                        echo "=== WL_CLIENTS ==="
                        for iface in eth5 eth6; do
                            for mac in $(wl -i $iface assoclist 2>/dev/null | awk '{print $2}'); do
                                echo "=== $iface $mac ==="
                                wl -i $iface sta_info $mac 2>/dev/null | grep -E "(in network|tx total bytes|rx data bytes|smoothed rssi|idle)"
                            done
                        done
                        echo "=== CLIENTLIST_JSON ==="
                        cat /tmp/clientlist.json 2>/dev/null
                        echo ""
                        echo "=== BRCTL_MACS ==="
                        brctl showmacs br0 2>/dev/null
                        echo "=== ROUTER_ARP ==="
                        ip neigh 2>/dev/null || arp -n 2>/dev/null
                        echo "=== ETH_PORTS ==="
                        cat /proc/net/dev | grep -E "(eth0|eth3|eth4):"
                        echo "=== FCACHE_L2 ==="
                        cat /proc/fcache/l2list 2>/dev/null
                        '''
                    ]
                    p = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=10, env=ssh_env)
                    if p.returncode == 0:
                        router_ssh_ok = True
                        with ROUTER_CREDS_LOCK:
                            ROUTER_SSH_CONSECUTIVE_FAILS = 0
                            ROUTER_SSH_BACKOFF_UNTIL = 0.0
                            ROUTER_SSH_LAST_ERROR = ""
                        current = None
                        clientlist_lines = []
                        brctl_lines = []
                        router_arp_lines = []
                        eth_lines = []
                        fcache_lines = []
                        section = 'wifi'

                        for line in p.stdout.splitlines():
                            line = line.strip()
                            if line == '=== ROUTER_MODEL ===':
                                section = 'model'
                                current = None
                                continue
                            elif line == '=== WL_CLIENTS ===':
                                section = 'wifi'
                                current = None
                                continue
                            elif line == '=== CLIENTLIST_JSON ===':
                                section = 'clientlist'
                                current = None
                                continue
                            elif line == '=== BRCTL_MACS ===':
                                section = 'brctl'
                                current = None
                                continue
                            elif line == '=== ROUTER_ARP ===':
                                section = 'router_arp'
                                current = None
                                continue
                            elif line == '=== ETH_PORTS ===':
                                section = 'eth'
                                current = None
                                continue
                            elif line == '=== FCACHE_L2 ===':
                                section = 'fcache'
                                current = None
                                continue

                            if section == 'model':
                                if line and not asus_model:
                                    asus_model = line
                                continue
                            elif section == 'clientlist':
                                if line:
                                    clientlist_lines.append(line)
                                continue
                            elif section == 'brctl':
                                if line:
                                    brctl_lines.append(line)
                                continue
                            elif section == 'router_arp':
                                if line:
                                    router_arp_lines.append(line)
                                continue
                            elif section == 'eth':
                                if ':' in line:
                                    eth_lines.append(line)
                                continue
                            elif section == 'fcache':
                                if '<' in line and '>' in line:
                                    fcache_lines.append(line)
                                continue

                            if line.startswith('=== '):
                                parts = line.split()
                                if len(parts) >= 3:
                                    w_band_key = 'wifi_5ghz' if parts[1] == 'eth6' else 'wifi_24ghz'
                                    w_mac_u = parts[2].upper()
                                    router_macs_seen.add(w_mac_u)
                                    current = {
                                        'conn_type': 'wifi',
                                        'band': i18n_t(f'hardware.net.band.{w_band_key}', base_dir=BASE_DIR),
                                        'band_key': w_band_key,
                                        'iface': parts[1],
                                        'mac': w_mac_u,
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

                        for rline in router_arp_lines:
                            rm = re.search(r'(\d+\.\d+\.\d+\.\d+)\s+.*?(?:lladdr|at)\s+([0-9a-fA-F:]{17})', rline)
                            if rm and _is_lan_ipv4(rm.group(1)):
                                r_ip, r_mac = rm.group(1), rm.group(2).upper()
                                router_arp_mac_to_ip[r_mac] = r_ip
                                if gw_ip and r_ip == gw_ip and not gw_mac:
                                    gw_mac = r_mac

                        explicit_wired_macs = set()
                        clientlist_raw = "".join(clientlist_lines).strip()
                        if clientlist_raw:
                            try:
                                cl_data = json.loads(clientlist_raw)
                                if isinstance(cl_data, dict):
                                    for node_mac, node_bands in cl_data.items():
                                        node_u = str(node_mac).strip().upper()
                                        if not isinstance(node_bands, dict):
                                            continue
                                        for band_key, entries in node_bands.items():
                                            bk = str(band_key).upper()
                                            if bk.startswith("2G"):
                                                band_label = "2.4 GHz"
                                            elif bk.startswith("5G"):
                                                band_label = "5 GHz"
                                            elif bk.startswith("6G"):
                                                band_label = "6 GHz"
                                            else:
                                                continue
                                            if isinstance(entries, dict):
                                                iter_items = entries.items()
                                            elif isinstance(entries, list):
                                                iter_items = [
                                                    (e, {}) if isinstance(e, str) else (e.get("mac", ""), e)
                                                    for e in entries if isinstance(e, (str, dict))
                                                ]
                                            else:
                                                iter_items = []
                                            for raw_mac, meta in iter_items:
                                                m_u = str(raw_mac).strip().upper()
                                                if not re.match(r'^[0-9A-F]{2}(:[0-9A-F]{2}){5}$', m_u):
                                                    continue
                                                router_macs_seen.add(m_u)
                                                rssi_val = 0
                                                ip_val = ""
                                                if isinstance(meta, dict):
                                                    try:
                                                        rssi_val = int(meta.get("rssi", 0) or 0)
                                                    except Exception:
                                                        rssi_val = 0
                                                    ip_val = str(meta.get("ip", "") or "").strip()
                                                prev_w = aimesh_wifi_map.get(m_u)
                                                if not prev_w or (rssi_val != 0 and prev_w.get("rssi", 0) == 0):
                                                    aimesh_wifi_map[m_u] = {
                                                        "band": band_label,
                                                        "node": node_u,
                                                        "rssi": rssi_val,
                                                        "ip": ip_val
                                                    }

                                    for node_mac, node_bands in cl_data.items():
                                        node_u = str(node_mac).strip().upper()
                                        if not isinstance(node_bands, dict):
                                            continue
                                        for band_key, entries in node_bands.items():
                                            if "wired" not in str(band_key).lower():
                                                continue
                                            if isinstance(entries, dict):
                                                iter_items = entries.items()
                                            elif isinstance(entries, list):
                                                iter_items = [
                                                    (e, {}) if isinstance(e, str) else (e.get("mac", ""), e)
                                                    for e in entries if isinstance(e, (str, dict))
                                                ]
                                            else:
                                                iter_items = []
                                            for raw_mac, meta in iter_items:
                                                m_u = str(raw_mac).strip().upper()
                                                if not re.match(r'^[0-9A-F]{2}(:[0-9A-F]{2}){5}$', m_u):
                                                    continue
                                                router_macs_seen.add(m_u)
                                                if m_u in aimesh_wifi_map:
                                                    continue
                                                ip_val = str(meta.get("ip", "") or "").strip() if isinstance(meta, dict) else ""
                                                explicit_wired_macs.add(m_u)
                                                router_wired_map[m_u] = {
                                                    "node": node_u,
                                                    "iface": "LAN",
                                                    "ip": ip_val
                                                }
                            except Exception:
                                pass

                        for b_line in brctl_lines:
                            m_br = re.match(r'^\s*\d+\s+([0-9a-fA-F:]{17})\s+(yes|no)\b', b_line)
                            if not m_br:
                                continue
                            b_mac = m_br.group(1).upper()
                            is_local = (m_br.group(2).lower() == 'yes')
                            if is_local:
                                continue
                            router_macs_seen.add(b_mac)
                            if b_mac in aimesh_wifi_map:
                                continue
                            if b_mac not in router_wired_map and (b_mac in arp_map or b_mac in router_arp_mac_to_ip or b_mac in explicit_wired_macs):
                                router_wired_map[b_mac] = {
                                    "node": "br0",
                                    "iface": "LAN",
                                    "ip": router_arp_mac_to_ip.get(b_mac) or arp_map.get(b_mac, {}).get("ip", "")
                                }

                        # Medición precisa por FlowObject en Broadcom FlowCache separando WAN (<-> gw_mac) de LAN interna
                        now_fc = time.monotonic()
                        dt_fc = max(0.5, now_fc - _FCACHE_LAST_TS) if _FCACHE_LAST_TS > 0 else 5.0
                        cur_flow_map = {}

                        def _mac_bucket(m_key):
                            b = fcache_stats.get(m_key)
                            if b is None:
                                b = {
                                    "tx_bytes": 0, "rx_bytes": 0,
                                    "wan_down_bytes": 0, "wan_up_bytes": 0,
                                    "lan_down_bytes": 0, "lan_up_bytes": 0,
                                    "speed_down": 0.0, "speed_up": 0.0,
                                    "wan_speed_down": 0.0, "wan_speed_up": 0.0,
                                    "lan_speed_down": 0.0, "lan_speed_up": 0.0,
                                }
                                fcache_stats[m_key] = b
                            return b

                        for f_line in fcache_lines:
                            m_strict = _RE_FCACHE_FLOW.search(f_line)
                            if m_strict:
                                flow_id = m_strict.group(1)
                                idle_s = int(m_strict.group(2))
                                sw_hits = int(m_strict.group(3))
                                sw_bytes = int(m_strict.group(4))
                                hw_hits = int(m_strict.group(5))
                                src = m_strict.group(6).upper()
                                dst = m_strict.group(7).upper()
                                ack_prio = int(m_strict.group(8))
                                is_ack = (ack_prio == 1)
                                if is_ack:
                                    hw_est = hw_hits * 66
                                elif sw_hits > 0:
                                    avg_pkt = sw_bytes / sw_hits
                                    if hw_hits > 0 and avg_pkt < 120 and sw_hits <= 2:
                                        avg_pkt = 1420.0
                                    else:
                                        avg_pkt = max(64.0, min(1500.0, avg_pkt))
                                    hw_est = int(hw_hits * avg_pkt)
                                else:
                                    hw_est = hw_hits * 1420
                                flow_total = sw_bytes + hw_est
                            else:
                                m_fc = re.search(r'(\d+)\s+(?:EPHY|WPHY)\s+\d+\s+<([0-9a-fA-F:]{17})>\s+<([0-9a-fA-F:]{17})>', f_line)
                                if not m_fc:
                                    continue
                                flow_id = "fb"
                                idle_s = 0
                                hw_hits = int(m_fc.group(1))
                                src = m_fc.group(2).upper()
                                dst = m_fc.group(3).upper()
                                is_ack = (' 1   0' in f_line or f_line.endswith(' 1   0'))
                                flow_total = hw_hits * (66 if is_ack else 1420)

                            router_macs_seen.add(src)
                            router_macs_seen.add(dst)
                            f_key = f"{flow_id}:{src}>{dst}:{1 if is_ack else 0}"
                            cur_flow_map[f_key] = flow_total

                            if _FCACHE_BASELINE_READY:
                                prev_val = _FCACHE_FLOW_PREV.get(f_key)
                                if prev_val is not None:
                                    delta_b = max(0, flow_total - prev_val)
                                elif idle_s <= max(int(dt_fc) + 3, 12) and flow_total < 64 * 1024 * 1024:
                                    delta_b = flow_total
                                else:
                                    delta_b = 0
                            else:
                                delta_b = 0

                            if gw_mac and (src == gw_mac or dst == gw_mac):
                                fcache_wan_macs.add(dst if src == gw_mac else src)

                            b_dst = _mac_bucket(dst)
                            b_src = _mac_bucket(src)
                            b_dst["tx_bytes"] += flow_total
                            b_src["rx_bytes"] += flow_total

                            if gw_mac and src == gw_mac and dst != gw_mac:
                                b_dst["wan_down_bytes"] += delta_b
                                b_src["wan_down_bytes"] += delta_b
                            elif gw_mac and dst == gw_mac and src != gw_mac:
                                b_src["wan_up_bytes"] += delta_b
                                b_dst["wan_up_bytes"] += delta_b
                            else:
                                b_dst["lan_down_bytes"] += delta_b
                                b_src["lan_up_bytes"] += delta_b

                        _FCACHE_FLOW_PREV = cur_flow_map
                        _FCACHE_LAST_TS = now_fc
                        _FCACHE_BASELINE_READY = True

                        for _m_k, st_v in fcache_stats.items():
                            w_down = round(st_v["wan_down_bytes"] / dt_fc, 1)
                            w_up = round(st_v["wan_up_bytes"] / dt_fc, 1)
                            l_down = round(st_v["lan_down_bytes"] / dt_fc, 1)
                            l_up = round(st_v["lan_up_bytes"] / dt_fc, 1)
                            st_v["wan_speed_down"] = w_down
                            st_v["wan_speed_up"] = w_up
                            st_v["lan_speed_down"] = l_down
                            st_v["lan_speed_up"] = l_up
                            st_v["speed_down"] = round(w_down + l_down, 1)
                            st_v["speed_up"] = round(w_up + l_up, 1)

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
                    else:
                        if os.path.exists(ctl_path):
                            try:
                                os.remove(ctl_path)
                            except Exception:
                                pass
                        backoff_steps = (20, 45, 90, 180, 300)
                        err_txt = (p.stderr or p.stdout or "").strip()
                        clean_err = err_txt.splitlines()[-1][:140] if err_txt else f"SSH rc={p.returncode}"
                        with ROUTER_CREDS_LOCK:
                            ROUTER_SSH_CONSECUTIVE_FAILS += 1
                            idx_b = min(ROUTER_SSH_CONSECUTIVE_FAILS - 1, len(backoff_steps) - 1)
                            ROUTER_SSH_BACKOFF_UNTIL = time.time() + backoff_steps[idx_b]
                            ROUTER_SSH_LAST_ERROR = clean_err
                except Exception as exc_ssh:
                    if os.path.exists(ctl_path):
                        try:
                            os.remove(ctl_path)
                        except Exception:
                            pass
                    backoff_steps = (20, 45, 90, 180, 300)
                    with ROUTER_CREDS_LOCK:
                        ROUTER_SSH_CONSECUTIVE_FAILS += 1
                        idx_b = min(ROUTER_SSH_CONSECUTIVE_FAILS - 1, len(backoff_steps) - 1)
                        ROUTER_SSH_BACKOFF_UNTIL = time.time() + backoff_steps[idx_b]
                        ROUTER_SSH_LAST_ERROR = str(exc_ssh)[:140]

            # Incorporar delta directo de wl sta_info como refuerzo de velocidad Wi-Fi
            now_wl = time.monotonic()
            wl_speed_map = {}
            for wc in wifi_clients:
                wmac = wc.get("mac", "").upper()
                wtx = int(wc.get("tx_bytes") or 0)
                wrx = int(wc.get("rx_bytes") or 0)
                prev_wl = _WL_BYTES_PREV.get(wmac)
                if prev_wl and (wtx > 0 or wrx > 0):
                    p_ts, p_tx, p_rx = prev_wl
                    dt_wl = max(0.5, now_wl - p_ts)
                    wl_speed_map[wmac] = (
                        round(max(0, wtx - p_tx) / dt_wl, 1),
                        round(max(0, wrx - p_rx) / dt_wl, 1),
                    )
                if wtx > 0 or wrx > 0:
                    _WL_BYTES_PREV[wmac] = (now_wl, wtx, wrx)

            c_24 = 0
            c_5 = 0
            known_macs = set()
            known_ips = set()

            for c in cable_clients:
                known_macs.add(c['mac'].upper())
                known_ips.add(c['ip'])

            # Incorporar clientes cableados reales reportados por el router ASUS / brctl
            for w_mac, w_info in router_wired_map.items():
                if w_mac in known_macs:
                    continue
                info = arp_map.get(w_mac, {})
                c_ip = info.get('ip') or w_info.get('ip') or ''
                if not c_ip or not _is_lan_ipv4(c_ip) or c_ip in known_ips:
                    continue
                known_macs.add(w_mac)
                known_ips.add(c_ip)
                d_name = friendly_names.get(w_mac) or info.get('name') or c_ip
                c_meta = classify_device(d_name, w_mac)
                cable_clients.append({
                    "conn_type": "cable",
                    "band": i18n_t("hardware.net.band.cable_lan", base_dir=BASE_DIR),
                    "band_key": "cable_lan",
                    "iface": "LAN",
                    "mac": w_mac,
                    "ip": c_ip,
                    "name": d_name,
                    "dev_type": c_meta['type'],
                    "dev_icon": c_meta['icon'],
                    "brand": c_meta.get('brand', 'generic'),
                    "brand_name": c_meta.get('brand_name') or i18n_t("hardware.net.device.lan_device", base_dir=BASE_DIR),
                    "vendor": c_meta.get('brand_name') or i18n_t("hardware.net.device.lan_device", base_dir=BASE_DIR),
                    "vendor_key": None if c_meta.get('brand_name') else "lan_device",
                    "status": "online",
                    "online": True,
                    "is_online": True,
                    "is_server": (c_meta.get('type') == 'server'),
                    "is_gateway": False,
                    "asus_node": w_info.get("node", "br0"),
                    "tx_bytes": 0,
                    "rx_bytes": 0,
                    "rssi": 0,
                    "in_network": int(time.time() - BOOT_TIME)
                })

            dedup_wifi = []
            for c in wifi_clients:
                mac = c['mac'].upper()
                if mac not in known_macs:
                    info = arp_map.get(mac, {})
                    mesh_info = aimesh_wifi_map.get(mac, {})
                    c_ip = info.get('ip') or mesh_info.get('ip') or router_arp_mac_to_ip.get(mac) or 'Desconocida'
                    if c_ip in known_ips:
                        continue
                    known_macs.add(mac)
                    if c_ip != 'Desconocida':
                        known_ips.add(c_ip)
                    if mesh_info.get('band'):
                        c['band'] = mesh_info['band']
                    if mesh_info.get('node'):
                        c['asus_node'] = mesh_info['node']
                    if c.get('rssi', 0) == 0 and mesh_info.get('rssi'):
                        c['rssi'] = mesh_info['rssi']
                    c['ip'] = c_ip
                    c['name'] = friendly_names.get(mac) or info.get('name', mac)
                    c_meta = classify_device(c['name'], mac)
                    c['dev_type'] = c_meta['type']
                    c['dev_icon'] = c_meta['icon']
                    c['brand'] = c_meta.get('brand', 'generic')
                    c['brand_name'] = c_meta.get('brand_name', 'Dispositivo')
                    c['vendor'] = c_meta.get('brand_name', 'Dispositivo')
                    c['status'] = 'online'
                    c['online'] = True
                    c['is_online'] = True
                    c['is_server'] = False
                    c['is_gateway'] = False
                    if '2.4' in str(c['band']):
                        c_24 += 1
                    else:
                        c_5 += 1
                    dedup_wifi.append(c)

            # Incorporar clientes Wi-Fi en nodos AiMesh secundarios que no estaban en wl local
            for w_mac, mesh_info in aimesh_wifi_map.items():
                if w_mac in known_macs:
                    continue
                info = arp_map.get(w_mac, {})
                c_ip = info.get('ip') or mesh_info.get('ip') or router_arp_mac_to_ip.get(w_mac) or 'Desconocida'
                if c_ip != 'Desconocida' and c_ip in known_ips:
                    continue
                known_macs.add(w_mac)
                if c_ip != 'Desconocida':
                    known_ips.add(c_ip)
                d_name = friendly_names.get(w_mac) or info.get('name') or (c_ip if c_ip != 'Desconocida' else w_mac)
                c_meta = classify_device(d_name, w_mac)
                band_raw = mesh_info.get('band', '')
                band_key = 'wifi_24ghz' if '2.4' in band_raw else ('wifi_6ghz' if '6' in band_raw else 'wifi_5ghz')
                band_val = i18n_t(f'hardware.net.band.{band_key}', base_dir=BASE_DIR)
                if band_key == 'wifi_24ghz':
                    c_24 += 1
                else:
                    c_5 += 1
                dedup_wifi.append({
                    "conn_type": "wifi",
                    "band": band_val,
                    "band_key": band_key,
                    "iface": "AiMesh",
                    "asus_node": mesh_info.get("node", ""),
                    "mac": w_mac,
                    "ip": c_ip,
                    "name": d_name,
                    "in_network": int(time.time() - BOOT_TIME),
                    "tx_bytes": 0,
                    "rx_bytes": 0,
                    "rssi": mesh_info.get('rssi') or -62,
                    "dev_type": c_meta['type'],
                    "dev_icon": c_meta['icon'],
                    "brand": c_meta.get('brand', 'generic'),
                    "brand_name": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                    "vendor": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                    "vendor_key": None if c_meta.get('brand_name') else "generic",
                    "status": "online",
                    "online": True,
                    "is_online": True,
                    "is_server": False,
                    "is_gateway": False
                })
            wifi_clients = dedup_wifi

            # Incorporar vecinos ARP activos descubiertos dinámicamente en cualquier subred LAN privada
            arp_active_macs = set()
            try:
                p_neigh = subprocess.run(['ip', 'neigh'], capture_output=True, text=True, timeout=2)
                for nline in p_neigh.stdout.splitlines():
                    m_dev = re.search(r'\bdev\s+(\S+)', nline)
                    n_dev = m_dev.group(1) if m_dev else ""
                    if n_dev.startswith(("docker", "br-", "veth", "virbr", "tailscale", "tun", "wg")):
                        continue
                    m_n = re.search(r'^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([0-9a-fA-F:]{17})\s+(\w+)', nline)
                    if m_n and _is_lan_ipv4(m_n.group(1)):
                        n_ip, n_mac, n_state = m_n.group(1), m_n.group(2).upper(), m_n.group(3)
                        arp_active_macs.add(n_mac)
                        if n_state in ('REACHABLE', 'STALE', 'DELAY') and n_mac not in known_macs and n_ip not in known_ips:
                            known_macs.add(n_mac)
                            known_ips.add(n_ip)
                            info = arp_map.get(n_mac, {})
                            d_name = friendly_names.get(n_mac) or info.get('name') or n_ip
                            c_meta = classify_device(d_name, n_mac)
                            dev_type = c_meta.get("type", "generic")
                            is_active = (n_state in ('REACHABLE', 'DELAY'))
                            is_wired_fallback = (n_mac in router_wired_map) or (dev_type in ("server", "pc", "nas", "network", "tv", "console"))
                            is_24 = any(k in d_name.lower() for k in ["3ds", "esp", "tapo", "enchufe", "bombilla", "iot"])

                            if is_wired_fallback:
                                cable_clients.append({
                                    "conn_type": "cable",
                                    "band": i18n_t("hardware.net.band.cable_lan", base_dir=BASE_DIR),
                                    "band_key": "cable_lan",
                                    "iface": "LAN",
                                    "mac": n_mac,
                                    "ip": n_ip,
                                    "name": d_name,
                                    "tx_bytes": 0,
                                    "rx_bytes": 0,
                                    "rssi": 0,
                                    "in_network": int(time.time() - BOOT_TIME),
                                    "dev_type": dev_type,
                                    "dev_icon": c_meta['icon'],
                                    "brand": c_meta.get('brand', 'generic'),
                                    "brand_name": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                                    "vendor": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                                    "vendor_key": None if c_meta.get('brand_name') else "generic",
                                    "status": "online" if is_active else "idle",
                                    "online": is_active,
                                    "is_online": is_active,
                                    "is_server": (dev_type == "server"),
                                    "is_gateway": False
                                })
                            else:
                                if is_24:
                                    c_24 += 1
                                    band_key = "wifi_24ghz"
                                else:
                                    c_5 += 1
                                    band_key = "wifi_5ghz"
                                band_val = i18n_t(f"hardware.net.band.{band_key}", base_dir=BASE_DIR)
                                wifi_clients.append({
                                    "conn_type": "wifi",
                                    "band": band_val,
                                    "band_key": band_key,
                                    "iface": "arp-lan",
                                    "mac": n_mac,
                                    "ip": n_ip,
                                    "name": d_name,
                                    "tx_bytes": 0,
                                    "rx_bytes": 0,
                                    "rssi": -62 if is_active else -75,
                                    "in_network": int(time.time() - BOOT_TIME),
                                    "dev_type": dev_type,
                                    "dev_icon": c_meta['icon'],
                                    "brand": c_meta.get('brand', 'generic'),
                                    "brand_name": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                                    "vendor": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                                    "vendor_key": None if c_meta.get('brand_name') else "generic",
                                    "status": "online" if is_active else "idle",
                                    "online": is_active,
                                    "is_online": is_active,
                                    "is_server": False,
                                    "is_gateway": False
                                })
            except Exception:
                pass

            # Incorporar dispositivos LAN offline vistos recientemente en Pi-hole (<24h) o con alias conocido para mantener targets WoL tras expirar ARP
            now_epoch = time.time()
            for r_mac, r_info in arp_map.items():
                if not r_mac or r_mac in ("00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF") or r_mac in known_macs:
                    continue
                r_ip = str(r_info.get('ip') or '').strip()
                if not r_ip or r_ip == "0.0.0.0" or r_ip in known_ips or not _is_lan_ipv4(r_ip):
                    continue
                try:
                    ip_obj_r = ipaddress.ip_address(r_ip)
                    octs = r_ip.split('.')
                    if ip_obj_r.is_unspecified or ip_obj_r.is_loopback or (len(octs) == 4 and octs[0] == '172' and 16 <= int(octs[1]) <= 31):
                        continue
                except Exception:
                    continue
                last_seen = int(r_info.get('last_seen') or 0)
                has_friendly = r_mac in friendly_names
                if not has_friendly and (not last_seen or (now_epoch - last_seen) > 86400):
                    continue
                known_macs.add(r_mac)
                known_ips.add(r_ip)
                d_name = friendly_names.get(r_mac) or r_info.get('name') or r_ip
                c_meta = classify_device(d_name, r_mac)
                dev_type = c_meta.get("type", "generic")
                is_wired_off = (dev_type in ("server", "pc", "nas", "network", "tv", "console")) or has_friendly
                off_band_key = "lan_offline" if is_wired_off else "wifi_offline"
                off_entry = {
                    "conn_type": "cable" if is_wired_off else "wifi",
                    "band": i18n_t(f"hardware.net.band.{off_band_key}", base_dir=BASE_DIR),
                    "band_key": off_band_key,
                    "iface": "pihole-wol",
                    "mac": r_mac,
                    "ip": r_ip,
                    "name": d_name,
                    "tx_bytes": 0,
                    "rx_bytes": 0,
                    "rssi": 0 if is_wired_off else -85,
                    "in_network": 0,
                    "dev_type": dev_type,
                    "dev_icon": c_meta['icon'],
                    "brand": c_meta.get('brand', 'generic'),
                    "brand_name": c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                    "vendor": r_info.get('vendor') or c_meta.get('brand_name') or i18n_t("hardware.net.device.generic", base_dir=BASE_DIR),
                    "vendor_key": None if (r_info.get('vendor') or c_meta.get('brand_name')) else "generic",
                    "status": "offline",
                    "online": False,
                    "is_online": False,
                    "is_server": False,
                    "is_gateway": False,
                }
                if is_wired_off:
                    cable_clients.append(off_entry)
                else:
                    wifi_clients.append(off_entry)

            # Enriquecer cada dispositivo con velocidades WAN/LAN separadas, fuentes reales y datos de Pi-hole
            srv_direct = dict(_SERVER_DIRECT_NET_SPEEDS)
            srv_direct_fresh = (time.time() - float(srv_direct.get("ts") or 0.0)) < 10.0
            peer_lan_snap = dict(_SERVER_PEER_LAN_SPEEDS)
            peer_lan_fresh = (time.time() - float(peer_lan_snap.get("ts") or 0.0)) < 10.0
            peer_lan_map = peer_lan_snap.get("peers") if peer_lan_fresh and isinstance(peer_lan_snap.get("peers"), dict) else {}

            router_wan_rx_sum = 0.0
            router_wan_tx_sum = 0.0
            router_lan_rx_sum = 0.0
            router_lan_tx_sum = 0.0

            for c in cable_clients + wifi_clients:
                mac = c.get('mac', '').upper()
                srcs = set(c.get('sources') or [])
                ph = pihole_catalog.get(mac)
                if ph:
                    srcs.add("pihole")
                    c["pihole_queries"] = int(ph.get("pihole_queries") or 0)
                    c["first_seen_ts"] = int(ph.get("first_seen_ts") or 0)
                    c["last_seen_ts"] = int(ph.get("last_seen_ts") or 0)
                    if not c.get("last_seen") and c["last_seen_ts"] > 0:
                        try:
                            c["last_seen"] = datetime.fromtimestamp(c["last_seen_ts"]).strftime("%d/%m %H:%M")
                        except Exception:
                            pass
                    if ph.get("vendor") and c.get("vendor") in ("", "Dispositivo", "Dispositivo Genérico"):
                        c["vendor"] = ph["vendor"]
                if mac in router_macs_seen or c.get("iface") in ("eth5", "eth6", "AiMesh") or c.get("asus_node"):
                    srcs.add("asus")
                if c.get("is_gateway") or mac in fcache_wan_macs or mac in router_arp_mac_to_ip:
                    srcs.add("gateway")
                if mac in arp_active_macs:
                    srcs.add("arp")
                if c.get("is_server"):
                    srcs.add("server")
                c["sources"] = sorted(srcs)

                fc = fcache_stats.get(mac, {})
                if fc:
                    c['tx_bytes'] = max(c.get('tx_bytes', 0), fc.get('tx_bytes', 0))
                    c['rx_bytes'] = max(c.get('rx_bytes', 0), fc.get('rx_bytes', 0))

                wan_down = float(fc.get('wan_speed_down', 0.0) or 0.0)
                wan_up = float(fc.get('wan_speed_up', 0.0) or 0.0)
                lan_down = float(fc.get('lan_speed_down', 0.0) or 0.0)
                lan_up = float(fc.get('lan_speed_up', 0.0) or 0.0)

                if c.get("is_local_host") and srv_direct_fresh:
                    wan_down = max(wan_down, float(srv_direct.get("wan_rx") or 0.0))
                    wan_up = max(wan_up, float(srv_direct.get("wan_tx") or 0.0))
                    lan_down = max(lan_down, float(srv_direct.get("lan_rx") or 0.0))
                    lan_up = max(lan_up, float(srv_direct.get("lan_tx") or 0.0))
                elif not c.get("is_gateway"):
                    c_ip = str(c.get("ip") or "").strip()
                    if c_ip and c_ip in peer_lan_map:
                        p_spd = peer_lan_map[c_ip]
                        lan_down = max(lan_down, float(p_spd.get("lan_down") or 0.0))
                        lan_up = max(lan_up, float(p_spd.get("lan_up") or 0.0))
                    if mac in wl_speed_map:
                        wl_d, wl_u = wl_speed_map[mac]
                        cur_tot_d = wan_down + lan_down
                        cur_tot_u = wan_up + lan_up
                        if wl_d > cur_tot_d:
                            lan_down = round(lan_down + (wl_d - cur_tot_d), 1)
                        if wl_u > cur_tot_u:
                            lan_up = round(lan_up + (wl_u - cur_tot_u), 1)

                c['wan_speed_down'] = round(wan_down, 1)
                c['wan_speed_up'] = round(wan_up, 1)
                c['lan_speed_down'] = round(lan_down, 1)
                c['lan_speed_up'] = round(lan_up, 1)
                c['speed_down'] = round(wan_down + lan_down, 1)
                c['speed_up'] = round(wan_up + lan_up, 1)

                if not c.get('is_gateway'):
                    router_wan_rx_sum += wan_down
                    router_wan_tx_sum += wan_up
                    router_lan_rx_sum += lan_down
                    router_lan_tx_sum += lan_up

                if c['speed_down'] > 30000 or c['speed_up'] > 20000 or c['wan_speed_down'] > 5000 or c['wan_speed_up'] > 5000:
                    c['status'] = 'online'
                    c['online'] = True
                    c['is_online'] = True

            wifi_tx = sum(c.get('tx_bytes', 0) for c in wifi_clients)
            wifi_rx = sum(c.get('rx_bytes', 0) for c in wifi_clients)
            cable_tx = asus_eth4_tx + asus_eth0_tx + asus_eth3_tx + local_server_tx
            cable_rx = asus_eth4_rx + asus_eth0_rx + asus_eth3_rx + local_server_rx

            all_clients = cable_clients + wifi_clients
            all_clients.sort(key=lambda x: (x.get('wan_speed_down', 0), x.get('speed_down', 0), x.get('tx_bytes', 0), x.get('ip', '')), reverse=True)

            online_count = sum(1 for c in all_clients if c.get('online', c.get('status') == 'online'))
            detected_router_ip = ROUTER_IP or next((c.get('ip', '') for c in cable_clients if c.get('is_gateway')), '')
            router_wan_avail = bool(router_ssh_ok and gw_mac)
            if not router_wan_avail and srv_direct_fresh:
                router_wan_rx_sum = float(srv_direct.get("wan_rx") or 0.0)
                router_wan_tx_sum = float(srv_direct.get("wan_tx") or 0.0)
                router_lan_rx_sum = float(srv_direct.get("lan_rx") or 0.0)
                router_lan_tx_sum = float(srv_direct.get("lan_tx") or 0.0)

            pihole_online_cnt = sum(1 for c in all_clients if "pihole" in (c.get("sources") or []) and c.get("online", True))
            asus_cnt = sum(1 for c in all_clients if "asus" in (c.get("sources") or []))
            gw_cnt = sum(1 for c in all_clients if "gateway" in (c.get("sources") or []))

            summary = {
                "total_clients": len(all_clients),
                "online_clients": online_count,
                "clients_cable": len(cable_clients),
                "wired_clients": len(cable_clients),
                "clients_24g": c_24,
                "band_24g": c_24,
                "clients_5g": c_5,
                "band_5g": c_5,
                "router_ip": detected_router_ip,
                "router_model": asus_model,
                "asus_model": asus_model,
                "gateway_ip": gw_ip or "",
                "gateway_mac": gw_mac or "",
                "gateway_name": gw_name_resolved,
                "gateway_model": gw_upnp.get("model_display", ""),
                "router_online": bool(router_ssh_ok or any(c.get('is_gateway') for c in cable_clients)),
                "router_configured": router_configured,
                "router_ssh_error": ROUTER_SSH_LAST_ERROR,
                "router_encrypted": bool(ROUTER_CREDS_ENCRYPTED),
                "router_creds_decrypt_failed": bool(ROUTER_CREDS_DECRYPT_FAILED),
                "router_auth_mode": "SSH + AES-256-GCM" if ROUTER_CREDS_ENCRYPTED else "SSH",
                "router_wan_available": router_wan_avail,
                "router_wan_rx_bytes_sec": round(router_wan_rx_sum, 1),
                "router_wan_tx_bytes_sec": round(router_wan_tx_sum, 1),
                "router_lan_rx_bytes_sec": round(router_lan_rx_sum, 1),
                "router_lan_tx_bytes_sec": round(router_lan_tx_sum, 1),
                "router_traffic_source": (
                    f"{asus_model or 'Router'} + {gw_upnp.get('model_display') or gw_name_resolved or gw_ip}"
                    if router_wan_avail
                    else (HOSTNAME or "Host Local")
                ),
                "pihole_db_total": len(pihole_catalog),
                "sources_status": {
                    "pihole": {
                        "available": bool(pihole_catalog),
                        "count": len(pihole_catalog),
                        "online_count": pihole_online_cnt,
                        "label": "Pi-hole",
                    },
                    "asus": {
                        "available": bool(router_ssh_ok),
                        "count": asus_cnt,
                        "online_count": asus_cnt,
                        "model": asus_model,
                        "ip": ROUTER_IP or "",
                        "creds_decrypt_failed": bool(ROUTER_CREDS_DECRYPT_FAILED),
                    },
                    "gateway": {
                        "available": bool(gw_ip),
                        "count": gw_cnt,
                        "online_count": gw_cnt,
                        "label": gw_name_resolved or gw_ip,
                        "model": gw_upnp.get("model_display", ""),
                        "ip": gw_ip or "",
                    },
                },
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
        time.sleep(5)

# ==============================================================================
# Security Worker: Pi-hole DNS Shield & Fail2ban Intrusion Defense
# ==============================================================================
def fetch_security_worker():
    global SECURITY_CACHE
    cached_gravity = 0
    last_gravity_check = 0
    last_pihole_query_ts = 0.0
    cached_pihole_data = None
    last_f2b_mtime = -1.0
    last_f2b_size = -1
    cached_f2b_log_events = []  # lista de (ip_val, j_val, dt_str, ts)
    re_f2b_ban = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*?\[([^\]]+)\]\s+Ban\s+(\S+)")

    while True:
        try:
            now = time.time()
            # 1. Pi-hole Metrics (lectura nativa directa con caché de 18s para evitar agregaciones SQLite continuas)
            if cached_pihole_data is not None and (now - last_pihole_query_ts < 18.0):
                pihole_data = dict(cached_pihole_data)
            else:
                pihole_data = {
                    "available": False,
                    "online": False,
                    "status": "offline",
                    "domains_being_blocked": 0,
                    "domains_blocked": 0,
                    "dns_queries_today": 0,
                    "total_queries": 0,
                    "ads_blocked_today": 0,
                    "blocked_today": 0,
                    "ads_percentage_today": 0.0,
                    "percent_blocked": 0.0,
                    "top_blocked": []
                }
                conn_g = None
                conn_f = None
                try:
                    if now - last_gravity_check > 300 or cached_gravity == 0:
                        conn_g = sqlite3.connect("file:/etc/pihole/gravity.db?mode=ro", uri=True, timeout=2.0)
                        row_g = conn_g.execute("SELECT count(*) FROM gravity;").fetchone()
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

                    pct = round((blocked_q / total_q * 100), 1) if total_q > 0 else 0.0
                    pihole_data = {
                        "available": True,
                        "online": True,
                        "domains_being_blocked": cached_gravity,
                        "domains_blocked": cached_gravity,
                        "dns_queries_today": total_q,
                        "total_queries": total_q,
                        "ads_blocked_today": blocked_q,
                        "blocked_today": blocked_q,
                        "ads_percentage_today": pct,
                        "percent_blocked": pct,
                        "top_blocked": top_blocked,
                        "status": "online"
                    }
                    cached_pihole_data = dict(pihole_data)
                    last_pihole_query_ts = now
                except Exception as pe:
                    pihole_data["error"] = str(pe)
                    last_pihole_query_ts = now
                finally:
                    if conn_f is not None:
                        try:
                            conn_f.close()
                        except Exception:
                            pass
                    if conn_g is not None:
                        try:
                            conn_g.close()
                        except Exception:
                            pass

            # 2. Fail2ban Metrics & All-Time History
            f2b_data = {
                "available": False,
                "active": False,
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
                    f2b_data["active"] = True
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
                    conn = None
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
                    except Exception:
                        pass
                    finally:
                        if conn is not None:
                            try:
                                conn.close()
                            except Exception:
                                pass

                # Incorporar IPs registradas en el log vivo si no estaban en bips (cacheado por st_mtime/st_size)
                log_path = "/var/log/fail2ban.log"
                if os.path.exists(log_path):
                    try:
                        st_log = os.stat(log_path)
                        if st_log.st_mtime != last_f2b_mtime or st_log.st_size != last_f2b_size:
                            parsed_events = []
                            seen_log_ips = {}
                            with open(log_path, "r", errors="ignore") as lf:
                                for line in lf:
                                    m = re_f2b_ban.search(line)
                                    if m:
                                        dt_str, j_val, ip_val = m.group(1), m.group(2).strip(), m.group(3).strip()
                                        try:
                                            ts = int(datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").timestamp())
                                        except Exception:
                                            ts = 0
                                        seen_log_ips[ip_val] = (ip_val, j_val, dt_str, ts)
                            parsed_events = list(seen_log_ips.values())
                            cached_f2b_log_events = parsed_events
                            last_f2b_mtime = st_log.st_mtime
                            last_f2b_size = st_log.st_size
                        for ip_val, j_val, dt_str, ts in cached_f2b_log_events:
                            if ip_val not in known_ips:
                                known_ips.add(ip_val)
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
def get_system_processes(gpu_map=None, disk_io_total_bps=0.0):
    try:
        gpu_map = gpu_map or {}
        now_ts = time.time()
        logical_cores = max(1, psutil.cpu_count(logical=True) or os.cpu_count() or 1)
        procs = []
        vm_total = psutil.virtual_memory().total or 1
        seen_pids = set()

        # Mapa ligero de conexiones de red activas por PID (compartido con GeoIP worker)
        net_by_pid = {}
        total_pid_sockets = 0
        try:
            for c in get_cached_inet_connections(max_age=5.0):
                cpid = c.pid
                if not cpid:
                    continue
                entry = net_by_pid.get(cpid)
                if entry is None:
                    entry = {"total": 0, "established": 0, "ports": []}
                    net_by_pid[cpid] = entry
                entry["total"] += 1
                total_pid_sockets += 1
                if c.status == psutil.CONN_ESTABLISHED:
                    entry["established"] += 1
                lport = c.laddr.port if c.laddr else None
                if lport and lport not in entry["ports"] and len(entry["ports"]) < 3:
                    entry["ports"].append(lport)
        except Exception:
            pass

        for p in psutil.process_iter(['pid', 'name', 'uids', 'cpu_percent', 'memory_info', 'status', 'nice', 'num_threads']):
            try:
                info = p.info
                pid = info['pid']
                seen_pids.add(pid)
                cpu = float(info.get('cpu_percent') or 0.0)
                cpu_norm = round(min(100.0, cpu / logical_cores), 1)
                if cpu_norm == 0.0 and cpu >= 0.4:
                    cpu_norm = 0.1
                cpu_cores_used = round(cpu / 100.0, 2)
                num_threads = int(info.get('num_threads') or 1)

                mem_bytes = info['memory_info'].rss if info.get('memory_info') else 0
                mem_mb = round(mem_bytes / (1024 * 1024), 1)
                priv_mb = mem_mb
                shared_mb = 0.0

                if mem_mb > 5.0:
                    try:
                        with open(f"/proc/{pid}/statm", "r") as sf:
                            parts = sf.read().split()
                            rss_pages = int(parts[1])
                            shared_pages = int(parts[2])
                            shared_mb = round(shared_pages * 4096 / (1024 * 1024), 1)
                            priv_mb = round(max(0, rss_pages - shared_pages) * 4096 / (1024 * 1024), 1)
                    except Exception:
                        pass

                mem_pct = round((priv_mb * 1024 * 1024) / vm_total * 100.0, 1)

                # Lectura/escritura real por proceso desde /proc/<pid>/io (omitir kernel threads sin RSS/CPU)
                io_read_bps = 0.0
                io_write_bps = 0.0
                io_read_tot = 0
                io_write_tot = 0
                if mem_bytes > 0 or cpu > 0.0:
                    try:
                        with open(f"/proc/{pid}/io", "r") as iof:
                            for ln in iof:
                                if ln.startswith("read_bytes:"):
                                    io_read_tot = int(ln.split(":", 1)[1].strip())
                                elif ln.startswith("write_bytes:"):
                                    io_write_tot = int(ln.split(":", 1)[1].strip())
                        prev_io = _PROC_IO_PREV.get(pid)
                        if prev_io:
                            p_ts, p_r, p_w = prev_io
                            dt_io = now_ts - p_ts
                            if dt_io >= 0.3:
                                io_read_bps = round(max(0.0, (io_read_tot - p_r) / dt_io), 1)
                                io_write_bps = round(max(0.0, (io_write_tot - p_w) / dt_io), 1)
                        _PROC_IO_PREV[pid] = (now_ts, io_read_tot, io_write_tot)
                    except Exception:
                        pass

                io_total_bps = round(io_read_bps + io_write_bps, 1)

                gpu_data = gpu_map.get(pid, gpu_map.get(str(pid), {}))
                vram_mb = round(float(gpu_data.get('vram_mb', 0.0) or 0.0), 1)
                vram_pct = round(float(gpu_data.get('vram_percent', 0.0) or 0.0), 1)
                gpu_util_pct = gpu_data.get('gpu_util_percent')
                gpu_mem_pct = gpu_data.get('mem_util_percent')
                gpu_enc_pct = gpu_data.get('enc_util_percent')
                gpu_dec_pct = gpu_data.get('dec_util_percent')
                gpu_type = gpu_data.get('type', '')
                nice_val = info.get('nice') if info.get('nice') is not None else 0

                n_entry = net_by_pid.get(pid)
                net_conns = n_entry["total"] if n_entry else 0
                net_est = n_entry["established"] if n_entry else 0
                net_ports = ", ".join(f":{prt}" for prt in n_entry["ports"]) if (n_entry and n_entry["ports"]) else ""
                net_pct = round((net_conns / total_pid_sockets) * 100.0, 1) if (total_pid_sockets > 0 and net_conns > 0) else 0.0

                procs.append({
                    "pid": pid,
                    "name": info['name'] or "unknown",
                    "user": _resolve_uid_name(info.get('uids')),
                    "cpu_percent": round(cpu, 1),
                    "cpu_norm_percent": cpu_norm,
                    "cpu_cores_used": cpu_cores_used,
                    "num_threads": num_threads,
                    "mem_mb": mem_mb,
                    "priv_mb": priv_mb,
                    "shared_mb": shared_mb,
                    "mem_percent": mem_pct,
                    "io_read_bps": io_read_bps,
                    "io_write_bps": io_write_bps,
                    "io_total_bps": io_total_bps,
                    "io_percent": 0.0,
                    "io_read_total_bytes": io_read_tot,
                    "io_write_total_bytes": io_write_tot,
                    "net_connections": net_conns,
                    "net_established": net_est,
                    "net_percent": net_pct,
                    "net_ports": net_ports,
                    "vram_mb": vram_mb,
                    "vram_percent": vram_pct,
                    "gpu_util_percent": gpu_util_pct,
                    "gpu_mem_percent": gpu_mem_pct,
                    "gpu_enc_percent": gpu_enc_pct,
                    "gpu_dec_percent": gpu_dec_pct,
                    "gpu_type": gpu_type,
                    "nice": nice_val,
                    "status": info.get('status', 'running')
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        # Purgar PIDs terminados del historial E/S por proceso
        for old_pid in list(_PROC_IO_PREV.keys()):
            if old_pid not in seen_pids:
                _PROC_IO_PREV.pop(old_pid, None)

        sum_proc_io = sum(pr["io_total_bps"] for pr in procs)
        io_denom = max(float(disk_io_total_bps or 0.0), sum_proc_io)
        if io_denom > 0:
            for pr in procs:
                if pr["io_total_bps"] > 0:
                    pr["io_percent"] = round(min(100.0, (pr["io_total_bps"] / io_denom) * 100.0), 1)
                elif pr["io_read_total_bytes"] + pr["io_write_total_bytes"] > 0:
                    pr["io_percent"] = 0.0

        filtered = [
            pr for pr in procs
            if pr['cpu_percent'] > 0.0
            or pr['priv_mb'] > 5.0
            or pr['mem_mb'] > 15.0
            or pr['vram_mb'] > 0.0
            or pr['gpu_util_percent'] is not None
            or pr['io_total_bps'] > 0.0
            or (pr['io_read_total_bytes'] + pr['io_write_total_bytes']) >= 2 * 1024 * 1024
            or pr['net_connections'] > 0
        ]

        # Unión equilibrada de los principales consumidores de cada recurso para no perder ningún líder en Disco/GPU/Red/RAM/CPU
        selected_by_pid = {}
        buckets = (
            sorted(filtered, key=lambda x: (x['cpu_percent'], x['priv_mb']), reverse=True)[:45],
            sorted(filtered, key=lambda x: (x['priv_mb'], x['mem_mb']), reverse=True)[:45],
            sorted(filtered, key=lambda x: (float(x['gpu_util_percent'] or -1), x['vram_mb']), reverse=True)[:30],
            sorted(filtered, key=lambda x: (x['io_total_bps'], x['io_read_total_bytes'] + x['io_write_total_bytes']), reverse=True)[:35],
            sorted(filtered, key=lambda x: (x['net_established'], x['net_connections']), reverse=True)[:30],
        )
        for group in buckets:
            for item in group:
                if item['pid'] not in selected_by_pid:
                    selected_by_pid[item['pid']] = item

        top_procs = sorted(
            selected_by_pid.values(),
            key=lambda x: (x['vram_mb'], x['cpu_percent'], x['io_total_bps'], x['priv_mb']),
            reverse=True
        )[:140]
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
    global METRICS_CACHE, METRICS_CACHE_BYTES, HISTORY, SERVER_LOCAL_IP, _SERVER_PEER_LAN_SPEEDS
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

    prev_socket_bytes = {}  # { flow_key: (rx_bytes, tx_bytes, is_private, r_ip) }
    prev_cifs_totals = [0, 0]
    prev_cifs_by_host = {}  # { host_ip: (read_bytes, write_bytes) }
    ss_baseline_ready = False

    def sample_lan_wan_flow_shares(dt_sec):
        """
        Mide deltas de bytes en tiempo real por flujo TCP/CIFS clasificando cada par remoto
        mediante _is_private_ip (RFC1918 LAN privada vs WAN pública) y devuelve
        (wan_rx_share, wan_tx_share, peer_lan_speeds).
        """
        nonlocal prev_socket_bytes, prev_cifs_by_host, ss_baseline_ready
        lan_rx_delta = 0.0
        lan_tx_delta = 0.0
        wan_rx_delta = 0.0
        wan_tx_delta = 0.0
        lan_conns = 0
        wan_conns = 0
        cifs_peer_deltas = {}
        ss_peer_deltas = {}

        # 1. Contadores CIFS/SMB montados en red local
        try:
            cifs_hosts, _ = _read_cifs_stats_by_host()
            tot_cifs_r = sum(v[0] for v in cifs_hosts.values())
            tot_cifs_w = sum(v[1] for v in cifs_hosts.values())
            if prev_cifs_totals[0] > 0 or prev_cifs_totals[1] > 0:
                dr = max(0, tot_cifs_r - prev_cifs_totals[0])
                dw = max(0, tot_cifs_w - prev_cifs_totals[1])
                lan_rx_delta += dr
                lan_tx_delta += dw
            prev_cifs_totals[0] = tot_cifs_r
            prev_cifs_totals[1] = tot_cifs_w

            next_cifs_by_host = {}
            for c_host, (r_val, w_val) in cifs_hosts.items():
                c_ip = str(c_host).strip()
                next_cifs_by_host[c_ip] = (r_val, w_val)
                if c_ip in prev_cifs_by_host:
                    p_r, p_w = prev_cifs_by_host[c_ip]
                    d_r = max(0, r_val - p_r)
                    d_w = max(0, w_val - p_w)
                    if d_r > 0 or d_w > 0:
                        cifs_peer_deltas[c_ip] = (d_r, d_w)
            prev_cifs_by_host = next_cifs_by_host
        except Exception:
            pass

        # 2. Contadores TCP por socket del kernel (ss -tin -H state established)
        curr_sockets = {}
        try:
            p_ss = subprocess.run(
                ["ss", "-tin", "-H", "state", "established"],
                capture_output=True, text=True, timeout=1.2
            )
            if p_ss.returncode == 0 and p_ss.stdout:
                lines = p_ss.stdout.splitlines()
                cur_key = None
                cur_priv = True
                cur_r_ip = ""
                for ln in lines:
                    s = ln.strip()
                    if not s:
                        continue
                    parts = s.split()
                    if len(parts) >= 4 and (":" in parts[2] or ":" in parts[3]) and not s.startswith(("cubic", "bbr", "reno", "ts ", "sack")):
                        l_ep = parts[-2]
                        r_ep = parts[-1]
                        r_ip = r_ep.rsplit(":", 1)[0].strip("[]")
                        if r_ip.startswith("::ffff:"):
                            r_ip = r_ip[7:]
                        if r_ip in ("127.0.0.1", "::1", "0.0.0.0", "*"):
                            cur_key = None
                            cur_r_ip = ""
                            continue
                        cur_priv = _is_private_ip(r_ip)
                        cur_r_ip = r_ip
                        if cur_priv:
                            lan_conns += 1
                        else:
                            wan_conns += 1
                        cur_key = f"{l_ep}->{r_ep}"
                        curr_sockets.setdefault(cur_key, [0, 0, cur_priv, cur_r_ip])
                    elif cur_key is not None:
                        m_rcv = re.search(r"bytes_received:(\d+)", s)
                        m_ack = re.search(r"bytes_acked:(\d+)", s)
                        m_sent = re.search(r"bytes_sent:(\d+)", s)
                        rx_b = int(m_rcv.group(1)) if m_rcv else 0
                        tx_b = int(m_sent.group(1)) if m_sent else (int(m_ack.group(1)) if m_ack else 0)
                        curr_sockets[cur_key] = [rx_b, tx_b, cur_priv, cur_r_ip]
                        prev_entry = prev_socket_bytes.get(cur_key)
                        if prev_entry is not None:
                            d_rx = max(0, rx_b - prev_entry[0])
                            d_tx = max(0, tx_b - prev_entry[1])
                        elif ss_baseline_ready:
                            d_rx = rx_b
                            d_tx = tx_b
                        else:
                            d_rx = 0
                            d_tx = 0
                        if cur_priv:
                            lan_rx_delta += d_rx
                            lan_tx_delta += d_tx
                            if cur_r_ip and (d_rx > 0 or d_tx > 0):
                                acc_p = ss_peer_deltas.setdefault(cur_r_ip, [0, 0])
                                acc_p[0] += d_rx
                                acc_p[1] += d_tx
                        else:
                            wan_rx_delta += d_rx
                            wan_tx_delta += d_tx
                        cur_key = None
                        cur_r_ip = ""
            prev_socket_bytes = curr_sockets
            ss_baseline_ready = True
        except Exception:
            pass

        peer_lan_speeds = {}
        denom_dt = max(dt_sec, 0.001)
        for p_ip in set(cifs_peer_deltas.keys()) | set(ss_peer_deltas.keys()):
            if not _is_lan_ipv4(p_ip) or p_ip == SERVER_LOCAL_IP or p_ip.startswith("127."):
                continue
            c_r, c_w = cifs_peer_deltas.get(p_ip, (0, 0))
            s_r, s_w = ss_peer_deltas.get(p_ip, (0, 0))
            p_rx_from_peer = max(c_r, s_r)  # servidor lee/recibe -> subida del par remoto
            p_tx_to_peer = max(c_w, s_w)    # servidor escribe/envía -> descarga del par remoto
            lan_down = round(p_tx_to_peer / denom_dt, 1)
            lan_up = round(p_rx_from_peer / denom_dt, 1)
            if lan_down > 0.0 or lan_up > 0.0:
                peer_lan_speeds[p_ip] = {"lan_down": lan_down, "lan_up": lan_up}

        tot_rx_delta = lan_rx_delta + wan_rx_delta
        tot_tx_delta = lan_tx_delta + wan_tx_delta
        tot_conns = lan_conns + wan_conns

        if tot_rx_delta > 0:
            wan_rx_share = min(1.0, max(0.0, wan_rx_delta / tot_rx_delta))
        elif tot_conns > 0:
            wan_rx_share = min(1.0, max(0.0, wan_conns / float(tot_conns)))
        else:
            wan_rx_share = 0.65

        if tot_tx_delta > 0:
            wan_tx_share = min(1.0, max(0.0, wan_tx_delta / tot_tx_delta))
        elif tot_conns > 0:
            wan_tx_share = min(1.0, max(0.0, wan_conns / float(tot_conns)))
        else:
            wan_tx_share = 0.65

        return wan_rx_share, wan_tx_share, peer_lan_speeds

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

            if not SERVER_LOCAL_IP or SERVER_LOCAL_IP.startswith("127."):
                resolved_local_ip = detect_local_server_ip()
                if resolved_local_ip and not resolved_local_ip.startswith("127."):
                    SERVER_LOCAL_IP = resolved_local_ip
            
            curr_rx, curr_tx, interfaces, interfaces_list = get_real_net(prev_ifaces_map, dt)
            prev_ifaces_map = interfaces
            rx_bytes_sec = max(0, (curr_rx - last_rx) / dt)
            tx_bytes_sec = max(0, (curr_tx - last_tx) / dt)
            last_rx, last_tx = curr_rx, curr_tx

            wan_rx_share, wan_tx_share, peer_lan_speeds = sample_lan_wan_flow_shares(dt)
            wan_rx_bytes_sec = round(rx_bytes_sec * wan_rx_share, 1)
            lan_rx_bytes_sec = round(max(0.0, rx_bytes_sec - wan_rx_bytes_sec), 1)
            wan_tx_bytes_sec = round(tx_bytes_sec * wan_tx_share, 1)
            lan_tx_bytes_sec = round(max(0.0, tx_bytes_sec - wan_tx_bytes_sec), 1)
            _SERVER_DIRECT_NET_SPEEDS.update({
                "wan_rx": wan_rx_bytes_sec,
                "wan_tx": wan_tx_bytes_sec,
                "lan_rx": lan_rx_bytes_sec,
                "lan_tx": lan_tx_bytes_sec,
                "ts": now,
            })
            _SERVER_PEER_LAN_SPEEDS = {"ts": now, "peers": peer_lan_speeds}

            # Accumulate rolling 20-minute bandwidth history per NIC (5s fixed buckets, 240 buckets across 1200s)
            with NIC_BANDWIDTH_LOCK:
                now_ms = int(now * 1000)
                bucket_ms = (now_ms // NIC_BUCKET_INTERVAL_MS) * NIC_BUCKET_INTERVAL_MS
                cutoff_ms = bucket_ms - (MAX_NIC_HISTORY_SECONDS * 1000)
                for nic_item in interfaces_list:
                    n_name = nic_item["name"]
                    n_rx = float(nic_item["rx_bytes_sec"] or 0.0)
                    n_tx = float(nic_item["tx_bytes_sec"] or 0.0)
                    n_wan_rx = round(n_rx * wan_rx_share, 1)
                    n_lan_rx = round(max(0.0, n_rx - n_wan_rx), 1)
                    n_wan_tx = round(n_tx * wan_tx_share, 1)
                    n_lan_tx = round(max(0.0, n_tx - n_wan_tx), 1)
                    nic_item["wan_rx_bytes_sec"] = n_wan_rx
                    nic_item["wan_tx_bytes_sec"] = n_wan_tx
                    nic_item["lan_rx_bytes_sec"] = n_lan_rx
                    nic_item["lan_tx_bytes_sec"] = n_lan_tx

                    n_hist = NIC_BANDWIDTH_HISTORY_2H.setdefault(n_name, [])
                    if not n_hist or n_hist[-1]["t"] < bucket_ms:
                        n_hist.append({
                            "t": bucket_ms,
                            "rx": n_rx,
                            "tx": n_tx,
                            "wan_rx": n_wan_rx,
                            "wan_tx": n_wan_tx,
                            "lan_rx": n_lan_rx,
                            "lan_tx": n_lan_tx,
                        })
                    else:
                        n_hist[-1]["rx"] = max(n_hist[-1]["rx"], n_rx)
                        n_hist[-1]["tx"] = max(n_hist[-1]["tx"], n_tx)
                        n_hist[-1]["wan_rx"] = max(n_hist[-1].get("wan_rx", 0.0), n_wan_rx)
                        n_hist[-1]["wan_tx"] = max(n_hist[-1].get("wan_tx", 0.0), n_wan_tx)
                        n_hist[-1]["lan_rx"] = max(n_hist[-1].get("lan_rx", 0.0), n_lan_rx)
                        n_hist[-1]["lan_tx"] = max(n_hist[-1].get("lan_tx", 0.0), n_lan_tx)
                    
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
            
            if cycle_counter % 3 == 1 or not cached_procs:
                cached_procs = get_system_processes(
                    gpu_info.get("gpu_procs_map", {}),
                    disk_io_total_bps=read_bytes_sec + write_bytes_sec,
                )
            
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
                disks_info = [dict(item) for item in DISKS_CACHE]
            _update_disk_io_history(disks_info, now_ts=time.time())
            
            with WIFI_LOCK:
                wifi_data = dict(WIFI_CACHE)

            wifi_summary_copy = dict(wifi_data.get("summary", {}))
            router_wan_rx_live = float(wifi_summary_copy.get("router_wan_rx_bytes_sec", wan_rx_bytes_sec) or 0.0)
            router_wan_tx_live = float(wifi_summary_copy.get("router_wan_tx_bytes_sec", wan_tx_bytes_sec) or 0.0)
            router_lan_rx_live = float(wifi_summary_copy.get("router_lan_rx_bytes_sec", lan_rx_bytes_sec) or 0.0)
            router_lan_tx_live = float(wifi_summary_copy.get("router_lan_tx_bytes_sec", lan_tx_bytes_sec) or 0.0)
            router_hist_20m = _push_router_history_bucket(
                now, router_wan_rx_live, router_wan_tx_live, router_lan_rx_live, router_lan_tx_live
            )
            wifi_summary_copy["router_history_20m"] = router_hist_20m

            if cached_procs:
                record_process_snapshot_to_sqlite(now, cached_procs)

            with SECURITY_LOCK:
                security_data = dict(SECURITY_CACHE)
            
            with CONNECTIONS_MAP_LOCK:
                conn_map_data = dict(CONNECTIONS_MAP_CACHE)

            with PING_LATENCY_LOCK:
                ping_latency_data = dict(PING_LATENCY_CACHE)

            net_info = {
                "rx_bytes_sec": rx_bytes_sec,
                "tx_bytes_sec": tx_bytes_sec,
                "wan_rx_bytes_sec": wan_rx_bytes_sec,
                "wan_tx_bytes_sec": wan_tx_bytes_sec,
                "lan_rx_bytes_sec": lan_rx_bytes_sec,
                "lan_tx_bytes_sec": lan_tx_bytes_sec,
                "rx_total_bytes": curr_rx,
                "tx_total_bytes": curr_tx,
                "local_ip": SERVER_LOCAL_IP,
                "interfaces": interfaces,
                "interfaces_list": interfaces_list,
                "router_history_20m": router_hist_20m,
                "ping_latency": ping_latency_data,
                "connections_map": conn_map_data
            }
            
            disk_io_info = {
                "read_bytes_sec": read_bytes_sec,
                "write_bytes_sec": write_bytes_sec,
                "read_total_bytes": curr_r,
                "write_total_bytes": curr_w
            }
            
            unique_mounted_disks = [
                d for d in disks_info
                if d.get("mounted", True) and d.get("pool_primary", True)
            ]
            local_mounted_disks = [
                d for d in unique_mounted_disks
                if d.get("kind") in ("local", None)
            ]
            pct_source = local_mounted_disks or unique_mounted_disks or disks_info
            tot_d_bytes = sum(float(d.get("total_bytes") or 0) for d in pct_source)
            used_d_bytes = sum(float(d.get("used_bytes") or 0) for d in pct_source)
            if tot_d_bytes > 0:
                disk_pct_val = round((used_d_bytes / tot_d_bytes) * 100.0, 1)
            elif disks_info:
                disk_pct_val = round(float(disks_info[0].get("percent") or 0.0), 1)
            else:
                try:
                    disk_pct_val = round(float(psutil.disk_usage('/').percent), 1)
                except Exception:
                    disk_pct_val = 0.0

            t_str_sample = sys_info.get("time_str", "")
            cpu_sample = round(float(cpu_info.get("usage_percent", 0) or 0.0), 2)
            gpu_sample = round(float(gpu_info.get("gpu_util_percent", 0) if gpu_info.get("available") else 0), 2)
            ram_sample = round(float(ram_info.get("percent", 0) or 0.0), 2)
            ram_tot_sample = round(float(ram_info.get("total_used_percent", 0) or 0.0), 2)
            net_rx_sample = round(rx_bytes_sec / (1024 * 1024), 2)
            net_tx_sample = round(tx_bytes_sec / (1024 * 1024), 2)
            net_wan_rx_sample = round(wan_rx_bytes_sec / (1024 * 1024), 2)
            net_wan_tx_sample = round(wan_tx_bytes_sec / (1024 * 1024), 2)
            net_lan_rx_sample = round(lan_rx_bytes_sec / (1024 * 1024), 2)
            net_lan_tx_sample = round(lan_tx_bytes_sec / (1024 * 1024), 2)
            disk_r_sample = round(read_bytes_sec / (1024 * 1024), 2)
            disk_w_sample = round(write_bytes_sec / (1024 * 1024), 2)

            gpu_avail = bool(gpu_info.get("available"))
            extra_telemetry = {
                "cpu_temp": round(float(cpu_info.get("temp_c") or 0.0), 1),
                "cpu_freq": round(float(cpu_info.get("freq_mhz") or 0.0), 1),
                "cpu_power": round(float(cpu_info.get("power_watts") or 0.0), 1),
                "cpu_load_1m": round(float(cpu_info.get("load_1m") or 0.0), 2),
                "cpu_load_5m": round(float(cpu_info.get("load_5m") or 0.0), 2),
                "cpu_user": round(float(cpu_info.get("user_percent") or 0.0), 1),
                "cpu_system": round(float(cpu_info.get("system_percent") or 0.0), 1),
                "cpu_iowait": round(float(cpu_info.get("iowait_percent") or 0.0), 1),
                "gpu_vram_pct": round(float(gpu_info.get("vram_percent") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_mem_ctrl": round(float(gpu_info.get("mem_util_percent") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_enc": round(float(gpu_info.get("encoder_util_percent") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_dec": round(float(gpu_info.get("decoder_util_percent") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_power": round(float(gpu_info.get("power_watts") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_temp": round(float(gpu_info.get("temp_c") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_clk_gfx": round(float(gpu_info.get("clock_graphics_mhz") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_clk_mem": round(float(gpu_info.get("clock_mem_mhz") or 0.0), 1) if gpu_avail else 0.0,
                "gpu_pcie_rx": round(float(gpu_info.get("pcie_rx_kbps") or 0.0) / 1024.0, 2) if gpu_avail else 0.0,
                "gpu_pcie_tx": round(float(gpu_info.get("pcie_tx_kbps") or 0.0) / 1024.0, 2) if gpu_avail else 0.0,
            }

            _push_history_bucket(
                now,
                t_str_sample,
                cpu_sample,
                gpu_sample,
                ram_sample,
                ram_tot_sample,
                net_rx_sample,
                net_tx_sample,
                disk_r_sample,
                disk_w_sample,
                disk_pct_val,
                net_wan_rx_val=net_wan_rx_sample,
                net_wan_tx_val=net_wan_tx_sample,
                net_lan_rx_val=net_lan_rx_sample,
                net_lan_tx_val=net_lan_tx_sample,
                extra=extra_telemetry,
                sync=True,
            )

            record_telemetry_sample_to_sqlite(
                now,
                t_str_sample,
                cpu_sample,
                gpu_sample,
                ram_sample,
                ram_tot_sample,
                net_rx_sample,
                net_tx_sample,
                disk_r_sample,
                disk_w_sample,
                disk_pct_val,
                net_wan_rx_val=net_wan_rx_sample,
                net_wan_tx_val=net_wan_tx_sample,
                net_lan_rx_val=net_lan_rx_sample,
                net_lan_tx_val=net_lan_tx_sample,
                extra=extra_telemetry,
            )

            # Historial en vivo + SQLite por entidad (sondas térmicas CPU, discos individuales e interfaces NIC)
            cpu_sensors_now = cpu_info.get("temp_sensors") or []
            _push_cpu_thermal_probes_live(now, t_str_sample, cpu_sensors_now)
            cpu_info["temp_sensors_history"] = get_cpu_thermal_probes_live_payload()
            try:
                dev_series_rows = []
                for s_item in cpu_sensors_now[:8]:
                    if not isinstance(s_item, dict):
                        continue
                    s_lbl = str(s_item.get("label") or "").strip()
                    if s_lbl:
                        dev_series_rows.append(("cpu_sensor", s_lbl, float(s_item.get("temp_c") or 0.0), 0.0, 0.0, 0.0))
                for d_item in (disks_info or []):
                    if not isinstance(d_item, dict):
                        continue
                    d_key = str(d_item.get("device") or d_item.get("mountpoint") or "").strip()
                    if d_key:
                        dev_series_rows.append((
                            "disk",
                            d_key,
                            round(float(d_item.get("read_bytes_sec") or 0.0) / (1024 * 1024), 2),
                            round(float(d_item.get("write_bytes_sec") or 0.0) / (1024 * 1024), 2),
                            round(float(d_item.get("percent") or 0.0), 1),
                            0.0,
                        ))
                raw_nics = net_info.get("interfaces_list")
                if not isinstance(raw_nics, list):
                    ifaces_map = net_info.get("interfaces")
                    raw_nics = list(ifaces_map.values()) if isinstance(ifaces_map, dict) else []
                for nic_item in raw_nics:
                    if not isinstance(nic_item, dict):
                        continue
                    n_key = str(nic_item.get("name") or "").strip()
                    if n_key:
                        dev_series_rows.append((
                            "nic",
                            n_key,
                            round(float(nic_item.get("wan_rx_bytes_sec") or nic_item.get("rx_bytes_sec") or 0.0) / (1024 * 1024), 2),
                            round(float(nic_item.get("wan_tx_bytes_sec") or nic_item.get("tx_bytes_sec") or 0.0) / (1024 * 1024), 2),
                            round(float(nic_item.get("lan_rx_bytes_sec") or 0.0) / (1024 * 1024), 2),
                            round(float(nic_item.get("lan_tx_bytes_sec") or 0.0) / (1024 * 1024), 2),
                        ))
                if dev_series_rows:
                    record_device_series_batch_to_sqlite(now, dev_series_rows)
            except Exception as dev_series_err:
                if int(cycle_counter) % 20 == 1:
                    print(f"[-] Error preparando series por entidad: {dev_series_err}")
            
            with DOCKER_LOCK:
                systemd_acts = list(SYSTEMD_CACHE)
                torrents_acts = list(EXTRAS_CACHE.get("torrents", []))
                torrent_stats_act = dict(EXTRAS_CACHE.get("torrent_stats", {}))
                emby_act = dict(EXTRAS_CACHE.get("emby", {}))
                parental_acts = dict(EXTRAS_CACHE.get("parental", {}))

            with TELEGRAM_BOT_LOCK:
                telegram_bot_act = dict(TELEGRAM_BOT_CACHE)
            telegram_bot_act["online"] = bool(
                telegram_bot_act.get("polling_active")
                or (telegram_bot_act.get("enabled") and telegram_bot_act.get("running"))
            )

            sys_errors_summary = get_effective_system_errors_summary()
            ver_info_act = get_version_info_cached_async()
            with CUSTOM_LOGOS_LOCK:
                custom_logos_act = load_custom_logos()

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
                "wifi_summary": wifi_summary_copy,
                "security": security_data,
                "history": HISTORY,
                "telegram_bot": telegram_bot_act,
                "system_errors_summary": sys_errors_summary,
                "maps_engine": "leaflet",
                "version_info": ver_info_act,
                "custom_logos": custom_logos_act,
            }
            
            with METRICS_LOCK:
                METRICS_CACHE = payload
                _invalidate_metrics_bytes_cache()
                
        except Exception as loop_err:
            if int(cycle_counter) % 20 == 1:
                print(f"[-] Error en bucle de métricas: {loop_err}")
        time.sleep(1.5)


# ==============================================================================
# HTTP Request Handler & Zero-Trust Enforcement
# ==============================================================================
VALID_WEB_ROUTES = {
    "/",
    "/index.html",
    "/inicio",
    "/equipo",
    "/red",
    "/programas",
    "/mas",
    "/resumen",
    "/procesador",
    "/memoria",
    "/grafica",
    "/almacenamiento",
    "/seguridad",
    "/aplicaciones",
    "/multimedia",
    "/descargas",
    "/procesos",
    "/sistema",
    "/version",
    "/dns",
    "/duckdns",
    "/dex",
    "/ubuntu",
}

VALID_WEB_PREFIXES = (
    "/inicio",
    "/equipo",
    "/hardware",
    "/red",
    "/network",
    "/programas",
    "/apps",
    "/software",
    "/workloads",
    "/mas",
    "/more",
    "/resumen",
    "/procesador",
    "/cpu",
    "/memoria",
    "/ram",
    "/grafica",
    "/gpu",
    "/almacenamiento",
    "/storage",
    "/discos",
    "/seguridad",
    "/security",
    "/escudo",
    "/shield",
    "/aplicaciones",
    "/contenedores",
    "/containers",
    "/docker",
    "/servicios",
    "/services",
    "/systemd",
    "/multimedia",
    "/media",
    "/descargas",
    "/downloads",
    "/procesos",
    "/processes",
    "/bots",
    "/telegram",
    "/sistema",
    "/system",
    "/temas",
    "/themes",
    "/consola",
    "/console",
    "/terminal",
    "/version",
    "/actualizaciones",
    "/updates",
    "/dispositivos",
    "/devices",
    "/nodos",
    "/dns",
    "/duckdns",
    "/pihole",
    "/speedtest",
    "/testdevelocidad",
    "/velocidad",
    "/mapa",
    "/map",
    "/geoip",
    "/trafico",
    "/traffic",
    "/historial",
    "/history",
    "/dex",
    "/ubuntu",
    "/ajustes",
    "/settings",
    "/cloud",
    "/nube",
    "/health",
    "/salud",
    "/logs",
)

def is_valid_web_route(path_str):
    if not path_str:
        return False
    clean = "/" + str(path_str).strip("/").lower()
    if clean in ("/", "/index.html"):
        return True
    if clean.startswith("/api/") or clean.startswith("/assets/"):
        return False
    parts = [s for s in clean.strip("/").split("/") if s]
    if len(parts) > 2:
        return False
    last_seg = parts[-1] if parts else ""
    if "." in last_seg and not last_seg.endswith(".html"):
        return False
    return any(clean == p or clean.startswith(p + "/") for p in VALID_WEB_PREFIXES)

def send_wol_magic_packet(mac_str, target_ip="", details_out=None):
    """
    Envía paquetes mágicos Wake-on-LAN multivía y multired calculando
    dinámicamente las NICs físicas y broadcasts reales de la subred local.
    """
    clean_mac = re.sub(r'[^0-9A-Fa-f]', '', str(mac_str or "")).lower()
    if len(clean_mac) != 12 or clean_mac in ("000000000000", "ffffffffffff"):
        if isinstance(details_out, dict):
            details_out["channels"] = []
            details_out["targets"] = []
            details_out["error"] = "Dirección MAC inválida"
        return False

    mac_std = ":".join(clean_mac[i:i+2].upper() for i in range(0, 12, 2))
    hw_addr = bytes.fromhex(clean_mac)
    magic = b'\xff' * 6 + hw_addr * 16

    channels = []
    sent_targets = []
    errors = []

    def _add_ch(ch_name):
        if ch_name not in channels:
            channels.append(ch_name)

    entries = get_lan_broadcast_entries()
    bcasts = get_lan_broadcast_addresses()

    # 1. UDP Broadcast vinculado explícitamente a cada NIC física activa (evita enrutar por bridges Docker)
    for local_ip, bcast_ip, nic_name in entries:
        for port in (9, 7):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                    s.settimeout(1.0)
                    s.bind((local_ip, 0))
                    s.sendto(magic, (bcast_ip, port))
                _add_ch("udp_broadcast")
                if port == 9:
                    sent_targets.append(f"{bcast_ip}:9 ({nic_name})")
            except Exception as e:
                errors.append(f"{nic_name}->{bcast_ip}:{port}: {e}")

    # 2. Fallback UDP broadcast global 255.255.255.255 (puertos 9 y 7)
    for port in (9, 7):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                s.settimeout(1.0)
                s.sendto(magic, ("255.255.255.255", port))
            _add_ch("udp_broadcast")
            if port == 9:
                sent_targets.append("255.255.255.255:9")
        except Exception as e:
            errors.append(f"global:255.255.255.255:{port}: {e}")

    # 3. UDP Unicast directo opcional si se conoce la IP LAN del dispositivo
    ip_clean = str(target_ip or "").strip()
    if ip_clean:
        try:
            ip_obj = ipaddress.ip_address(ip_clean)
            if ip_obj.version == 4 and not ip_obj.is_loopback and not ip_obj.is_unspecified:
                for port in (9, 7):
                    try:
                        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                            s.settimeout(1.0)
                            s.sendto(magic, (str(ip_obj), port))
                        _add_ch("udp_unicast")
                        if port == 9:
                            sent_targets.append(f"{ip_obj}:9")
                    except Exception as e:
                        errors.append(f"unicast:{ip_obj}:{port}: {e}")
        except ValueError:
            pass

    # 4. Frame Layer-2 Ethernet EtherType 0x0842 (best-effort si hay permiso CAP_NET_RAW)
    if hasattr(socket, "AF_PACKET") and entries:
        try:
            addrs_map = psutil.net_if_addrs() or {}
            link_family = getattr(psutil, "AF_LINK", getattr(socket, "AF_PACKET", None))
            for _local_ip, _bcast_ip, nic_name in entries:
                src_mac_bytes = None
                for a in addrs_map.get(nic_name, []):
                    if link_family is not None and a.family == link_family and a.address:
                        src_clean = re.sub(r'[^0-9A-Fa-f]', '', a.address)
                        if len(src_clean) == 12:
                            src_mac_bytes = bytes.fromhex(src_clean)
                            break
                if src_mac_bytes is None:
                    src_mac_bytes = b'\x02\x00\x00\x00\x00\x01'
                try:
                    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0842)) as l2:
                        l2.bind((nic_name, 0))
                        frame = b'\xff' * 6 + src_mac_bytes + b'\x08\x42' + magic
                        l2.send(frame)
                    _add_ch("l2_ethernet")
                    sent_targets.append(f"L2:0x0842 ({nic_name})")
                except Exception:
                    pass
        except Exception:
            pass

    # 5. Herramienta wakeonlan solo sobre broadcasts físicos reales
    if shutil.which("wakeonlan"):
        for b_ip in bcasts:
            try:
                p = subprocess.run(["wakeonlan", "-i", b_ip, mac_std], capture_output=True, text=True, timeout=3)
                if p.returncode == 0:
                    _add_ch("wakeonlan_cli")
            except Exception as e:
                errors.append(f"wakeonlan:{b_ip}: {e}")

    # 6. Refuerzo opcional desde el router gateway ASUS vía SSH (ether-wake) si hay credenciales configuradas
    if ROUTER_IP and ROUTER_USER and ROUTER_PASS and shutil.which("sshpass"):
        try:
            ssh_env = os.environ.copy()
            ssh_env["SSHPASS"] = ROUTER_PASS
            p_gw = subprocess.run(
                [
                    "sshpass", "-e", "ssh",
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "ConnectTimeout=2",
                    f"{ROUTER_USER}@{ROUTER_IP}",
                    f"ether-wake -b -i br0 {mac_std} 2>/dev/null || ether-wake -b {mac_std} 2>/dev/null"
                ],
                capture_output=True, text=True, timeout=4, env=ssh_env
            )
            if p_gw.returncode == 0:
                _add_ch("router_ether_wake")
                sent_targets.append(f"router:{ROUTER_IP}")
        except Exception:
            pass

    ok = len(channels) > 0
    if isinstance(details_out, dict):
        details_out["mac"] = mac_std
        details_out["channels"] = channels
        details_out["targets"] = sent_targets
        details_out["errors"] = errors if not ok else []
    return ok


def _get_host_local_ips_and_macs():
    host_ips = {"127.0.0.1", "::1"}
    host_macs = set()
    if SERVER_LOCAL_IP:
        host_ips.add(SERVER_LOCAL_IP)
    if psutil:
        try:
            for addrs in psutil.net_if_addrs().values():
                for a in addrs:
                    if a.family == socket.AF_INET and a.address:
                        host_ips.add(a.address)
                    elif hasattr(psutil, "AF_LINK") and a.family == psutil.AF_LINK and a.address:
                        cm = re.sub(r'[^0-9A-Fa-f]', '', a.address).lower()
                        if len(cm) == 12:
                            host_macs.add(cm)
        except Exception:
            pass
    return host_ips, host_macs


def send_device_shutdown_signal(ip_str="", mac_str="", name_str=""):
    """
    Envía señal de apagado remota de forma 100% dinámica (Zero-Hardcoding):
    1) Webhook HTTP opcional configurado en RECURSOS_SHUTDOWN_HOOKS_FILE
    2) SSH no interactivo (BatchMode=yes) si puerto SSH responde y hay clave autorizada
    3) RPC Samba (`net rpc shutdown`) si existen credenciales en RECURSOS_RPC_USER/PASS
    4) Paquete mágico Sleep-on-LAN (MAC invertida vía UDP puertos 9 y 7)
    Protege explícitamente la IP y MAC del servidor anfitrión.
    """
    ip_clean = str(ip_str or "").strip()
    mac_clean = re.sub(r'[^0-9A-Fa-f]', '', str(mac_str or "")).lower()
    target_label = str(name_str or ip_clean or mac_str or "dispositivo").strip()

    valid_ip = None
    if ip_clean:
        try:
            ip_obj = ipaddress.ip_address(ip_clean)
            if ip_obj.is_loopback or ip_obj.is_unspecified:
                return False, "No se puede enviar señal de apagado a loopback o al servidor anfitrión", []
            valid_ip = str(ip_obj)
        except ValueError:
            valid_ip = None

    if not valid_ip and len(mac_clean) != 12:
        return False, "Se requiere una dirección IP o MAC válida", []

    host_ips, host_macs = _get_host_local_ips_and_macs()
    if (valid_ip and valid_ip in host_ips) or (len(mac_clean) == 12 and mac_clean in host_macs):
        return False, "Operación bloqueada: no se puede apagar el servidor anfitrión desde la lista de red", []

    channels_ok = []

    # 1. Webhook HTTP opcional por IP o MAC (sin URLs hardcodeadas)
    hooks_file = os.environ.get("RECURSOS_SHUTDOWN_HOOKS_FILE", "").strip()
    if hooks_file and os.path.isfile(hooks_file):
        try:
            with open(hooks_file, "r", encoding="utf-8") as hf:
                hooks_cfg = json.load(hf)
            hook_entry = None
            if isinstance(hooks_cfg, dict):
                for key_cand in [valid_ip, str(mac_str or "").lower(), str(mac_str or "").upper(), mac_clean]:
                    if key_cand and key_cand in hooks_cfg:
                        hook_entry = hooks_cfg[key_cand]
                        break
            if isinstance(hook_entry, dict) and hook_entry.get("url"):
                req_url = str(hook_entry["url"]).strip()
                if req_url.startswith(("http://", "https://")):
                    req_method = str(hook_entry.get("method", "POST")).upper()
                    req_hdrs = hook_entry.get("headers") if isinstance(hook_entry.get("headers"), dict) else {}
                    req_body = json.dumps(hook_entry.get("body")).encode("utf-8") if "body" in hook_entry else None
                    if req_body and "Content-Type" not in req_hdrs:
                        req_hdrs["Content-Type"] = "application/json"
                    req = urllib.request.Request(req_url, data=req_body, headers=req_hdrs, method=req_method)
                    with urllib.request.urlopen(req, timeout=3.0) as resp:
                        if 200 <= resp.status < 300:
                            channels_ok.append("webhook")
        except Exception:
            pass

    # 2. SSH no interactivo (solo si puerto SSH está abierto y acepta BatchMode)
    if valid_ip and shutil.which("ssh"):
        try:
            ssh_port = int(os.environ.get("RECURSOS_SSH_PORT", "22") or 22)
        except ValueError:
            ssh_port = 22
        ssh_reachable = False
        try:
            with socket.create_connection((valid_ip, ssh_port), timeout=0.6):
                ssh_reachable = True
        except Exception:
            ssh_reachable = False
        if ssh_reachable:
            ssh_user = os.environ.get("RECURSOS_SSH_USER", "").strip()
            ssh_target = f"{ssh_user}@{valid_ip}" if ssh_user else valid_ip
            try:
                p = subprocess.run(
                    [
                        "ssh",
                        "-p", str(ssh_port),
                        "-o", "BatchMode=yes",
                        "-o", "ConnectTimeout=2",
                        "-o", "StrictHostKeyChecking=accept-new",
                        ssh_target,
                        "sudo -n poweroff || systemctl poweroff",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=4,
                )
                if p.returncode == 0:
                    channels_ok.append("ssh")
            except Exception:
                pass

    # 3. Samba / Windows RPC shutdown opcional por variables de entorno
    rpc_user = os.environ.get("RECURSOS_RPC_USER", "").strip()
    rpc_pass = os.environ.get("RECURSOS_RPC_PASS", "").strip()
    if valid_ip and rpc_user and rpc_pass and shutil.which("net"):
        try:
            p = subprocess.run(
                ["net", "rpc", "shutdown", "-I", valid_ip, "-U", f"{rpc_user}%{rpc_pass}", "-f", "-t", "0"],
                capture_output=True,
                text=True,
                timeout=4,
            )
            if p.returncode == 0:
                channels_ok.append("rpc")
        except Exception:
            pass

    # 4. Paquete mágico Sleep-on-LAN (MAC invertida vía UDP puerto 9/7 por NIC física y unicast)
    if len(mac_clean) == 12 and mac_clean not in ("000000000000", "ffffffffffff"):
        hw_addr = bytes.fromhex(mac_clean)
        sol_magic = b'\xff' * 6 + hw_addr[::-1] * 16
        sol_sent = False
        for local_ip, bcast_ip, _nic_name in get_lan_broadcast_entries():
            for port in (9, 7):
                try:
                    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                        s.settimeout(1.0)
                        s.bind((local_ip, 0))
                        s.sendto(sol_magic, (bcast_ip, port))
                        sol_sent = True
                except Exception:
                    pass
        udp_targets = []
        if valid_ip and ":" not in valid_ip:
            udp_targets.append((valid_ip, 9))
            udp_targets.append((valid_ip, 7))
        udp_targets.append(("255.255.255.255", 9))
        udp_targets.append(("255.255.255.255", 7))
        for dst_ip, port in udp_targets:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                    s.settimeout(1.0)
                    s.sendto(sol_magic, (dst_ip, port))
                    sol_sent = True
            except Exception:
                pass
        if sol_sent:
            channels_ok.append("sol_udp")

    if any(ch in channels_ok for ch in ("webhook", "ssh", "rpc")):
        active_ch = ", ".join(channels_ok)
        return True, f"Señal de apagado enviada a {target_label} ({active_ch})", channels_ok
    if "sol_udp" in channels_ok:
        return True, f"Señal Sleep-on-LAN (SoL) enviada por red a {target_label}", channels_ok
    return False, f"No se pudo emitir la señal de apagado a {target_label} (requiere agente SoL, SSH o webhook)", channels_ok

class DashboardHTTPHandler(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json_body(self, max_bytes=65536):
        try:
            content_length = int(self.headers.get('Content-Length', 0) or 0)
        except (ValueError, TypeError):
            return None, 400
        if content_length < 0 or content_length > max_bytes:
            return None, 413
        if content_length == 0:
            return {}, None
        raw = self.rfile.read(content_length).decode('utf-8', errors='ignore')
        try:
            parsed = json.loads(raw)
            return (parsed if isinstance(parsed, dict) else {}), None
        except Exception:
            return {}, None

    def send_security_headers(self):
        dom = resolve_request_domain(self)
        env_origins = os.environ.get("RECURSOS_ALLOWED_ORIGINS", "").strip()
        host_origins = f"https://{SERVER_LOCAL_IP} http://{SERVER_LOCAL_IP} https://{HOSTNAME} https://{HOSTNAME}.local"
        csp_ancestors = (
            "'self' "
            "https://*.duckdns.org "
            f"{host_origins} "
            "http://localhost:* http://127.0.0.1:* "
            f"https://{dom} https://*.{dom} "
            f"{env_origins}"
        ).strip()
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header(
            'Content-Security-Policy',
            f"default-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net https://unpkg.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.tile.openstreetmap.de https://tile.openstreetmap.de https://server.arcgisonline.com data: blob:; "
            f"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com; "
            f"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://unpkg.com; "
            f"img-src 'self' data: blob: https: http:; "
            f"connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://autocomplete.clearbit.com https://cdn.simpleicons.org https://www.google.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.tile.openstreetmap.de https://tile.openstreetmap.de https://server.arcgisonline.com http://ip-api.com https://ip-api.com ws: wss: https://*.duckdns.org https://{dom}; "
            f"frame-src 'self' https://*.duckdns.org https://{dom} https://*.{dom}; "
            f"frame-ancestors {csp_ancestors};"
        )

    def do_HEAD(self):
        self.do_GET()

    def do_PUT(self):
        self.send_response(405)
        self.send_security_headers()
        self.end_headers()

    def do_DELETE(self):
        auth = check_trust_status(self)
        clean_path = self.path.split('?')[0].rstrip('/') or '/'
        if clean_path == "/api/net/speedtest/history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            entry_id = None
            if "?" in self.path:
                try:
                    q_params = urllib.parse.parse_qs(self.path.split("?", 1)[1])
                    if "id" in q_params:
                        entry_id = int(q_params["id"][0])
                except Exception:
                    entry_id = None
            ok, deleted = delete_speedtest_history_from_sqlite(entry_id)
            resp = json.dumps({"ok": ok, "success": ok, "deleted": deleted}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return
        self.send_response(405)
        self.send_security_headers()
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Allow', 'GET, POST, DELETE, HEAD')
        self.send_security_headers()
        self.end_headers()

    def _serve_html_with_bootstrap(self, auth, html_path, is_dashboard=True):
        """Sirve un documento HTML verificando Zero-Trust e inyectando metadatos de versión."""
        if not auth["is_trusted"]:
            locked_page = get_locked_page_html(auth["client_ip"]).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.send_security_headers()
            if _has_trust_cookie(self):
                self.send_header('Set-Cookie', get_clear_cookie_header_value(self))
            self.send_header('Content-Length', str(len(locked_page)))
            self.end_headers()
            self.wfile.write(locked_page)
            return

        try:
            with open(html_path, 'r', encoding='utf-8') as f:
                content_str = f.read()
            current_ver = get_app_version()
            disp_ver = get_display_version(current_ver)
            local_sha = get_local_git_sha_cached()
            if is_dashboard:
                content_str = content_str.replace(
                    'id="sidebarVersionTag">Sincronizando...<',
                    f'id="sidebarVersionTag">v{disp_ver}<'
                )
            build_injection = (
                f'<meta name="recursos-app-version" content="{current_ver}" data-display="{disp_ver}" data-commit="{local_sha}">'
                f'<script>window.__INITIAL_APP_VERSION__ = "{current_ver}"; window.__INITIAL_DISPLAY_VERSION__ = "{disp_ver}"; window.__INITIAL_APP_HASH__ = "{local_sha}";</script>'
            )
            if '</head>' in content_str:
                head_before, head_after = content_str.rsplit('</head>', 1)
                content_str = f'{head_before}{build_injection}\n</head>{head_after}'
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
            self.wfile.write(f"Error loading document: {e}".encode('utf-8'))

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
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

            auth_status_obj = {
                "is_local": auth["is_local"],
                "is_trusted": auth["is_trusted"],
                "verified_in_lan": bool(auth.get("verified_in_lan", True)),
                "certificate_serial": auth.get("certificate_serial") or (auth.get("device_info") or {}).get("certificate_serial", ""),
                "device_id": auth.get("device_id") or "",
                "client_ip": auth["client_ip"],
                "public_domain": req_domain,
                "local_ip": SERVER_LOCAL_IP,
                "token": auth.get("token") or auth.get("new_token") or "",
                "device_name": auth["device_info"]["name"] if auth.get("device_info") else "Dispositivo Local"
            }

            accept_enc = (self.headers.get('Accept-Encoding') or '').lower()
            wants_gzip = 'gzip' in accept_enc
            auth_cache_key = f"{auth_status_obj['client_ip']}|{req_domain}|{auth_status_obj['is_trusted']}|{auth_status_obj['token']}"

            out_bytes = None
            is_gzipped = False
            with METRICS_LOCK:
                cur_seq = METRICS_CACHE_SEQ
                cached_domain = (METRICS_CACHE.get("system") or {}).get("public_domain", "") if isinstance(METRICS_CACHE, dict) else ""
                if (
                    _METRICS_SERIALIZED_CACHE.get("seq") == cur_seq
                    and _METRICS_SERIALIZED_CACHE.get("domain") == req_domain
                ):
                    variant = (_METRICS_SERIALIZED_CACHE.get("variants") or {}).get(auth_cache_key)
                    if variant is not None:
                        raw_v, gz_v = variant
                        if wants_gzip:
                            if gz_v is None:
                                gz_v = gzip.compress(raw_v, compresslevel=4)
                                _METRICS_SERIALIZED_CACHE["variants"][auth_cache_key] = (raw_v, gz_v)
                            out_bytes = gz_v
                            is_gzipped = True
                        else:
                            out_bytes = raw_v
                    else:
                        base_bytes = _METRICS_SERIALIZED_CACHE.get("base_bytes")
                        if base_bytes and base_bytes.endswith(b"}"):
                            raw_v = base_bytes[:-1] + b', "auth_status": ' + json.dumps(auth_status_obj).encode('utf-8') + b'}'
                            gz_v = gzip.compress(raw_v, compresslevel=4) if wants_gzip else None
                            variants_dict = _METRICS_SERIALIZED_CACHE.setdefault("variants", {})
                            if len(variants_dict) >= 64:
                                variants_dict.clear()
                            variants_dict[auth_cache_key] = (raw_v, gz_v)
                            out_bytes = gz_v if wants_gzip else raw_v
                            is_gzipped = wants_gzip

                if out_bytes is None:
                    base_payload = dict(METRICS_CACHE) if isinstance(METRICS_CACHE, dict) else {}
                    if "system" in base_payload and isinstance(base_payload["system"], dict):
                        base_payload["system"] = dict(base_payload["system"])
                        base_payload["system"]["public_domain"] = req_domain
                        base_payload["system"]["local_ip"] = SERVER_LOCAL_IP
                    base_payload["maps_engine"] = "leaflet"
                    if "version_info" not in base_payload or cached_domain != req_domain:
                        vinfo_cp = dict(get_version_info_cached_async())
                        vinfo_cp["public_domain"] = req_domain
                        base_payload["version_info"] = vinfo_cp
                    if "system_errors_summary" not in base_payload:
                        base_payload["system_errors_summary"] = get_effective_system_errors_summary()
                    if "custom_logos" not in base_payload:
                        with CUSTOM_LOGOS_LOCK:
                            base_payload["custom_logos"] = load_custom_logos()
                    base_bytes = json.dumps(base_payload).encode('utf-8')
                    raw_v = base_bytes[:-1] + b', "auth_status": ' + json.dumps(auth_status_obj).encode('utf-8') + b'}' if base_bytes.endswith(b"}") else json.dumps({**base_payload, "auth_status": auth_status_obj}).encode('utf-8')
                    gz_v = gzip.compress(raw_v, compresslevel=4) if wants_gzip else None
                    _METRICS_SERIALIZED_CACHE.clear()
                    _METRICS_SERIALIZED_CACHE.update({
                        "seq": cur_seq,
                        "domain": req_domain,
                        "base_bytes": base_bytes,
                        "variants": {auth_cache_key: (raw_v, gz_v)},
                    })
                    out_bytes = gz_v if wants_gzip else raw_v
                    is_gzipped = wants_gzip

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Vary', 'Accept-Encoding')
            if is_gzipped:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(out_bytes)))
            self.end_headers()
            self.wfile.write(out_bytes)
            return

        # 1a-bis. HISTORIAL PERSISTENTE DE CONSUMO DESDE SQLITE (recursos_history.db)
        elif clean_path == "/api/metrics/history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            query_str = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query_str)
            before_ts = params.get('before_ts', [None])[0]
            after_ts = params.get('after_ts', [None])[0]
            window_sec = params.get('window_sec', params.get('window', [None]))[0]
            limit_param = params.get('limit', [180])[0]
            hist_payload = query_telemetry_history_from_sqlite(
                before_ts=before_ts,
                after_ts=after_ts,
                window_sec=window_sec,
                limit=limit_param,
            )
            resp = json.dumps(hist_payload).encode('utf-8')
            wants_gz = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower() and len(resp) > 2048
            if wants_gz:
                resp = gzip.compress(resp, compresslevel=4)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Vary', 'Accept-Encoding')
            if wants_gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1a-bis2. HISTORIAL PERSISTENTE POR ENTIDAD (discos individuales, NICs y sondas térmicas CPU)
        elif clean_path == "/api/metrics/entity-history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            query_str = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query_str)
            entity_kind = params.get('kind', [''])[0]
            entity_id = params.get('id', [''])[0]
            before_ts = params.get('before_ts', [None])[0]
            after_ts = params.get('after_ts', [None])[0]
            window_sec = params.get('window_sec', params.get('window', [None]))[0]
            limit_param = params.get('limit', [180])[0]
            ent_payload = query_device_series_history_from_sqlite(
                entity_kind=entity_kind,
                entity_id=entity_id,
                before_ts=before_ts,
                after_ts=after_ts,
                window_sec=window_sec,
                limit=limit_param,
            )
            resp = json.dumps(ent_payload).encode('utf-8')
            wants_gz = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower() and len(resp) > 2048
            if wants_gz:
                resp = gzip.compress(resp, compresslevel=4)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Vary', 'Accept-Encoding')
            if wants_gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1a-ter. HISTORIAL PERSISTENTE DE LATENCIA PING DESDE SQLITE (recursos_history.db)
        elif clean_path == "/api/net/ping-history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            query_str = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query_str)
            before_ts = params.get('before_ts', [None])[0]
            after_ts = params.get('after_ts', [None])[0]
            window_sec = params.get('window_sec', params.get('window', [None]))[0]
            limit_param = params.get('limit', [180])[0]
            ping_hist_payload = query_ping_history_from_sqlite(
                before_ts=before_ts,
                after_ts=after_ts,
                window_sec=window_sec,
                limit=limit_param,
            )
            resp = json.dumps(ping_hist_payload).encode('utf-8')
            wants_gz = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower() and len(resp) > 2048
            if wants_gz:
                resp = gzip.compress(resp, compresslevel=4)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Vary', 'Accept-Encoding')
            if wants_gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1a-quater. HISTORIAL DE PROCESOS 24H EN SQLITE (recursos_history.db)
        elif clean_path == "/api/metrics/process-history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            query_str = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query_str)
            hours_p = params.get('hours', ['24'])[0]
            metric_p = params.get('metric', ['cpu'])[0]
            proc_hist = query_process_history_from_sqlite(hours=hours_p, metric=metric_p)
            resp = json.dumps(proc_hist).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1a-quinquies. TEST DE VELOCIDAD Y SU HISTORIAL SQLITE
        elif clean_path == "/api/net/speedtest/status":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with SPEEDTEST_LOCK:
                st_copy = dict(SPEEDTEST_STATE)
            st_copy["ok"] = True
            resp = json.dumps(st_copy).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        elif clean_path == "/api/net/speedtest/history":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            hist_st = query_speedtest_history_from_sqlite(limit=100)
            resp = json.dumps(hist_st).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        elif clean_path == "/api/net/speedtest/payload":
            if c_ip not in ("127.0.0.1", "::1", "::ffff:127.0.0.1") and not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            query_str = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = urllib.parse.parse_qs(query_str)
            try:
                nbytes = max(1024, min(int(params.get('bytes', [1048576])[0]), 33554432))
            except Exception:
                nbytes = 1048576
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(nbytes))
            self.send_security_headers()
            self.end_headers()
            zero_block = b"\x00" * 65536
            remaining = nbytes
            while remaining > 0:
                chunk_len = min(remaining, len(zero_block))
                self.wfile.write(zero_block[:chunk_len])
                remaining -= chunk_len
            return

        elif clean_path == "/api/network/router-credentials":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with ROUTER_CREDS_LOCK:
                r_ip = ROUTER_IP
                r_port = ROUTER_SSH_PORT
                r_user = ROUTER_USER
                r_has_pass = bool(ROUTER_PASS)
                r_enc = bool(ROUTER_CREDS_ENCRYPTED)
                r_dec_fail = bool(ROUTER_CREDS_DECRYPT_FAILED)
            gw_detected = _detect_default_gateway_ip()
            payload = {
                "ok": True,
                "is_local": bool(auth.get("is_local")),
                "can_configure": True,
                "configured": bool(r_ip and r_user and r_has_pass and not r_dec_fail),
                "router_ip": r_ip or gw_detected or "",
                "router_port": int(r_port or 22),
                "router_user": r_user or "",
                "encrypted": r_enc,
                "decrypt_failed": r_dec_fail,
                "sshpass_available": bool(shutil.which("sshpass") and shutil.which("ssh")),
                "gateway_ip": gw_detected or "",
            }
            resp = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1a-ter. BASE DE DATOS UNIFICADA DE DISPOSITIVOS DE RED (Pi-hole + ASUS + Puerta de Enlace)
        elif clean_path == "/api/network/devices-db":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            force_ref = ("refresh=1" in self.path or "refresh=true" in self.path)
            db_payload = build_unified_devices_database(force_refresh=force_ref)
            resp = json.dumps(db_payload).encode('utf-8')
            wants_gz = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower() and len(resp) > 1024
            if wants_gz:
                resp = gzip.compress(resp, compresslevel=4)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Vary', 'Accept-Encoding')
            if wants_gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            if auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1b-dict. DICCIONARIO TABULAR CENTRALIZADO (CSV Y JSON DERIVADO AL VUELO + OTA GITHUB + GZIP)
        elif clean_path == "/api/dictionary":
            if ("refresh=1" in self.path or "refresh=true" in self.path or "sync=1" in self.path):
                sync_dictionary_from_github(BASE_DIR, force=True, timeout=5.0)
            dict_bytes = get_dictionary_bytes(BASE_DIR)
            wants_gz = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower() and len(dict_bytes) > 2048
            out_bytes = gzip.compress(dict_bytes, compresslevel=4) if wants_gz else dict_bytes
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Vary', 'Accept-Encoding')
            if wants_gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(out_bytes)))
            self.end_headers()
            self.wfile.write(out_bytes)
            return

        elif clean_path == "/i18n/dictionary.csv":
            if ("refresh=1" in self.path or "refresh=true" in self.path or "sync=1" in self.path):
                sync_dictionary_from_github(BASE_DIR, force=True, timeout=5.0)
            csv_bytes = get_dictionary_csv_bytes(BASE_DIR)
            wants_gz = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower() and len(csv_bytes) > 2048
            out_bytes = gzip.compress(csv_bytes, compresslevel=4) if wants_gz else csv_bytes
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Vary', 'Accept-Encoding')
            if wants_gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(out_bytes)))
            self.end_headers()
            self.wfile.write(out_bytes)
            return

        # 1b-auth-status. ESTADO ZERO-TRUST LIGERO (Cero datos del sistema si no está certificado en LAN)
        elif clean_path == "/api/auth/status":
            if auth["is_trusted"]:
                status_payload = {
                    "is_trusted": True,
                    "is_local": bool(auth.get("is_local")),
                    "verified_in_lan": bool(auth.get("verified_in_lan", True)),
                    "device_id": auth.get("device_id") or "",
                    "certificate_serial": auth.get("certificate_serial") or "",
                    "token": auth.get("token") or auth.get("new_token") or "",
                }
                code = 200
            else:
                status_payload = {
                    "is_trusted": False,
                    "is_local": False,
                    "verified_in_lan": False,
                    "status": "locked",
                }
                code = 403
            out_bytes = json.dumps(status_payload).encode("utf-8")
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            if auth["is_trusted"] and auth.get("new_token"):
                self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
            self.send_header('Content-Length', str(len(out_bytes)))
            self.end_headers()
            self.wfile.write(out_bytes)
            return

        # 1b-themes. CATÁLOGO DE TEMAS INDEPENDIENTES CON SINCRONIZACIÓN OTA HÍBRIDA (Zero-Trust)
        elif clean_path == "/api/themes":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            if ("refresh=1" in self.path or "refresh=true" in self.path or "sync=1" in self.path):
                sync_themes_from_github(BASE_DIR, force=True, timeout=5.0)
            themes_bytes = json.dumps(get_themes_catalog_payload(BASE_DIR), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(themes_bytes)))
            self.end_headers()
            self.wfile.write(themes_bytes)
            return

        elif clean_path in ("/api/themes/pack", "/themes/themes-pack.rcpack.gz"):
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            pack_bytes = get_theme_pack_bytes(BASE_DIR)
            if not pack_bytes:
                self.send_response(404)
                self.send_security_headers()
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/gzip')
            self.send_header('Content-Disposition', 'inline; filename="themes-pack.rcpack.gz"')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(pack_bytes)))
            self.end_headers()
            self.wfile.write(pack_bytes)
            return

        elif clean_path.startswith("/api/themes/") or clean_path.startswith("/themes/"):
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            rel_name = clean_path.split("/", 2)[-1] if clean_path.startswith("/themes/") else clean_path[len("/api/themes/"):]
            if rel_name == "themes.json":
                payload = get_themes_catalog_payload(BASE_DIR)
            else:
                payload = get_single_theme_payload(rel_name, BASE_DIR)
            if payload is None:
                self.send_response(404)
                self.send_security_headers()
                self.end_headers()
                return
            out_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(out_bytes)))
            self.end_headers()
            self.wfile.write(out_bytes)
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

        # 1b-native. COMPILACIONES NATIVAS EN GITHUB (.deb UBUNTU & .apk ANDROID)
        elif clean_path == "/api/native/github-releases":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            force_ref = ("refresh=1" in self.path or "refresh=true" in self.path)
            rel_data = get_github_native_releases_info(force_refresh=force_ref)
            resp = json.dumps(rel_data, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1b-console. CONSOLA DE SERVICIO EN SOLO LECTURA (RETENCIÓN MÁX. 24H)
        elif clean_path == "/api/system/console-logs":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            after_id = (qs.get("after_id") or ["0"])[0]
            window = (qs.get("window") or ["24h"])[0]
            level = (qs.get("level") or [""])[0]
            q_str = (qs.get("q") or [""])[0]
            limit = (qs.get("limit") or ["350"])[0]
            console_data = query_service_console_logs(
                after_id=after_id,
                window=window,
                level=level,
                q=q_str,
                limit=limit,
            )
            resp = json.dumps(console_data, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
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
            lang_q = (params.get('lang', ['es'])[0] or 'es').strip().lower()[:8] or 'es'

            logs_payload = fetch_effective_system_logs(priority_max=prio, limit=limit, force=force, lang=lang_q)
            if cat != 'all':
                filtered_logs = [entry for entry in logs_payload.get('logs', []) if entry.get('category') == cat]
                logs_payload = dict(logs_payload)
                logs_payload['logs'] = filtered_logs
                logs_payload['entries'] = filtered_logs
                logs_payload['total_errors'] = len(filtered_logs)

            resp = json.dumps(logs_payload, ensure_ascii=False).encode('utf-8')
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
            bot_data["online"] = bool(
                bot_data.get("polling_active")
                or (bot_data.get("enabled") and bot_data.get("running"))
            )
            with TELEGRAM_ACTIVITY_LOCK:
                raw_activity = list(TELEGRAM_ACTIVITY_LOG)
            activity_list = []
            for item in raw_activity:
                if isinstance(item, dict):
                    item_copy = dict(item)
                    if not item_copy.get("timestamp"):
                        item_copy["timestamp"] = item_copy.get("time_str", "")
                    activity_list.append(item_copy)
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

        # 1.1 CONFIGURACIÓN Y ESTADO DE MOTOR DE MAPAS (OpenStreetMap / ArcGIS Libre sin API Key)
        elif clean_path == "/api/maps/config":
            resp = json.dumps({
                "success": True,
                "engine": "leaflet",
                "provider": "OpenStreetMap",
                "free": True,
                "requires_api_key": False,
                "tile_proxy": True
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1.2 PROXY CACHEADO DE TESELAS DE MAPA SIN API KEY NI MARCAS DE AGUA
        elif clean_path.startswith("/api/maps/tile/"):
            m_tile = re.match(r"^/api/maps/tile/(light|dark|osm)/(\d+)/(\d+)/(\d+)(?:\.(?:png|jpg|jpeg))?$", clean_path)
            if not m_tile:
                self.send_response(400)
                self.send_security_headers()
                self.end_headers()
                return
            tile_res = fetch_cached_map_tile(m_tile.group(1), m_tile.group(2), m_tile.group(3), m_tile.group(4))
            if not tile_res:
                self.send_response(502)
                self.send_security_headers()
                self.end_headers()
                return
            tile_bytes, tile_ctype, tile_prov = tile_res
            self.send_response(200)
            self.send_header('Content-Type', tile_ctype)
            self.send_header('X-Tile-Provider', tile_prov)
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(tile_bytes)))
            self.end_headers()
            self.wfile.write(tile_bytes)
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
                        "app_version": v.get("app_version") or tel.get("client_version") or tel.get("app_version") or "",
                        "hardware_id": v.get("hardware_id") or tel.get("hardware_id") or dev_id,
                        "installation_ids": v.get("installation_ids") if isinstance(v.get("installation_ids"), list) else [],
                        "observed_ips": v.get("observed_ips") if isinstance(v.get("observed_ips"), list) else [],
                        "os_info": v.get("os_info") or tel.get("os_distro") or tel.get("os_info") or tel.get("platform") or "",
                        "architecture": v.get("architecture") or tel.get("arch") or tel.get("architecture") or "",
                        "hostname": v.get("hostname") or tel.get("hostname") or "",
                        "mac_address": v.get("mac_address") or tel.get("mac_address") or "",
                        "model": v.get("model") or tel.get("model") or "",
                        "manufacturer": v.get("manufacturer") or tel.get("manufacturer") or "",
                        "first_seen": v.get("first_seen", ""),
                        "last_seen": v.get("last_seen", ""),
                        "lan_verified_at": v.get("lan_verified_at") or v.get("first_seen", ""),
                        "local_ip": normalize_lan_ip(v.get("local_ip") or tel.get("local_ip") or ""),
                        "last_external_ip": v.get("last_external_ip", ""),
                        "connection_mode": v.get("connection_mode", "LAN" if not v.get("last_external_ip") else "WAN"),
                        "user_agent": ua_str,
                        "verified_in_lan": bool(v.get("verified_in_lan", False)),
                        "verified_by_master_key": bool(v.get("verified_by_master_key", False)),
                        "master_verified_at": v.get("master_verified_at", ""),
                        "trusted": bool(v.get("trusted", True)),
                        "is_current": is_cur_dev,
                        "root_access": bool(tel.get("root_access", False)),
                        "root_method": str(tel.get("root_method") or ""),
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
            lang_f = None
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
                    lang_f = q_params.get("lang", [None])[0]
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
                limit=lim_f,
                lang=lang_f
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

        # 2i. TELEMETRÍA E IDENTIDAD DE ENTORNO NATIVO / SANDBOX WEB
        elif clean_path == "/api/native/device-info":
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            hdr_tel = extract_header_telemetry(self)
            c_type = hdr_tel.get("client_type") or (auth.get("device_info") or {}).get("client_type") or "web_browser"
            is_nat = c_type in ("ubuntu_native", "android_native") or bool(hdr_tel.get("full_access"))
            info_payload = dict(hdr_tel)
            info_payload.setdefault("client_type", c_type)
            info_payload.setdefault("is_native", is_nat)
            info_payload.setdefault("access_level", "FULL_NATIVE_ACCESS" if is_nat else "WEB_SANDBOX")
            resp = json.dumps(info_payload, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 2j. MANUAL WEB INTERACTIVO (/manual, /manual.html, /readme)
        elif clean_path in ("/manual", "/manual.html", "/readme"):
            manual_path = os.path.join(STATIC_DIR, "manual.html")
            if not os.path.isfile(manual_path):
                manual_path = os.path.join(BASE_DIR, "docs", "index.html")
            self._serve_html_with_bootstrap(auth, manual_path, is_dashboard=False)
            return

        # 3. RUTAS WEB LIMPIAS MULTIPÁGINA (History API + Acceso Directo a Submenús)
        elif clean_path in VALID_WEB_ROUTES or is_valid_web_route(clean_path):
            index_path = os.path.join(STATIC_DIR, "index.html")
            if not os.path.isfile(index_path):
                index_path = os.path.join(BASE_DIR, "dist", "index.html")
            if not os.path.isfile(index_path):
                index_path = os.path.join(BASE_DIR, "index.html")
            self._serve_html_with_bootstrap(auth, index_path, is_dashboard=True)
            return

        # 4. ARCHIVOS ESTÁTICOS / DESCARGAS RDP CON DNS AUTODETECTADO
        elif clean_path in ["/visipics.rdp", "/visipics_externo.rdp", "/Asus_Router_CA.crt"]:
            filename = clean_path.lstrip("/")
            file_path = os.path.join(STATIC_DIR, filename)
            try:
                rdp_user = (os.environ.get("RECURSOS_RDP_USER") or os.environ.get("USER") or "").strip()
                rdp_user_line = f"username:s:{rdp_user}\n" if rdp_user else ""
                if filename == "visipics_externo.rdp":
                    rdp_text = (
                        f"full address:s:{req_domain}:3389\n"
                        f"{rdp_user_line}"
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
                        f"{rdp_user_line}"
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

        # 4a-bis. ARCHIVOS ESTÁTICOS DE BUNDLE VITE (/assets/*)
        elif clean_path.startswith("/assets/"):
            rel_asset = os.path.normpath(clean_path[len("/assets/"):]).lstrip("/\\")
            if not rel_asset or rel_asset.startswith("..") or "/../" in f"/{rel_asset}/":
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                self.wfile.write(b"Forbidden")
                return

            candidate_dirs = [
                os.path.join(BASE_DIR, "dist", "assets"),
                os.path.join(STATIC_DIR, "assets"),
                STATIC_DIR,
                os.path.join(BASE_DIR, "dist"),
                os.path.join(BASE_DIR, "desktop_app", "assets"),
            ]
            target_file = None
            for cdir in candidate_dirs:
                cand = os.path.join(cdir, rel_asset)
                if os.path.isfile(cand):
                    target_file = cand
                    break

            if target_file:
                try:
                    ext = os.path.splitext(target_file)[1].lower()
                    mime_map = {
                        ".js": "application/javascript; charset=utf-8",
                        ".mjs": "application/javascript; charset=utf-8",
                        ".css": "text/css; charset=utf-8",
                        ".svg": "image/svg+xml",
                        ".png": "image/png",
                        ".jpg": "image/jpeg",
                        ".jpeg": "image/jpeg",
                        ".webp": "image/webp",
                        ".ico": "image/x-icon",
                        ".woff2": "font/woff2",
                        ".woff": "font/woff",
                        ".ttf": "font/ttf",
                        ".json": "application/json; charset=utf-8",
                        ".map": "application/json; charset=utf-8",
                    }
                    mime_type = mime_map.get(ext, "application/octet-stream")
                    fsize = os.path.getsize(target_file)
                    self.send_response(200)
                    self.send_header('Content-Type', mime_type)
                    self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                    self.send_security_headers()
                    self.send_header('Content-Length', str(fsize))
                    self.end_headers()
                    with open(target_file, 'rb') as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                    return
                except Exception as e:
                    print(f"[ASSET SERVE ERROR] {rel_asset}: {e}")

            self.send_response(404)
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(b"Asset Not Found")
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
                specific_file = os.path.join(dist_dir, requested_name)
                if os.path.isfile(specific_file):
                    deb_file = specific_file

            if deb_file and os.path.isfile(deb_file):
                try:
                    fsize = os.path.getsize(deb_file)
                    out_fname = f"recursos-cockpit_{current_ver}_amd64.deb" if requested_name in ["recursos-cockpit.deb", "app.deb", "app_deb"] else os.path.basename(deb_file)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.debian.binary-package')
                    self.send_header('Content-Disposition', f'attachment; filename="{out_fname}"')
                    self.send_header('Content-Length', str(fsize))
                    self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                    self.send_security_headers()
                    self.end_headers()
                    with open(deb_file, 'rb') as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                    return
                except Exception as e:
                    print(f"[DOWNLOAD DEB ERROR] {e}")

            # Redirigir a la release oficial de GitHub si el .deb de la versión activa no está localmente
            github_deb = f"https://github.com/cminewarIA/recursos-ui/releases/download/v{current_ver}/recursos-cockpit_{current_ver}_amd64.deb"
            self.send_response(302)
            self.send_header('Location', github_deb)
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
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
                # Nunca servir una APK de una versión anterior almacenada en dist/
                if os.path.isfile(canonical_apk):
                    apk_file = canonical_apk
            else:
                specific_file = os.path.join(dist_dir, requested_name)
                if os.path.isfile(specific_file):
                    apk_file = specific_file

            if apk_file and os.path.isfile(apk_file):
                try:
                    fsize = os.path.getsize(apk_file)
                    out_fname = f"recursos-cockpit_{current_ver}.apk" if requested_name in ["recursos-cockpit.apk", "app.apk", "app_apk"] else os.path.basename(apk_file)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.android.package-archive')
                    self.send_header('Content-Disposition', f'attachment; filename="{out_fname}"')
                    self.send_header('Content-Length', str(fsize))
                    self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
                    self.send_security_headers()
                    self.end_headers()
                    with open(apk_file, 'rb') as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                    return
                except Exception as e:
                    print(f"[DOWNLOAD APK ERROR] {e}")

            # Redirigir a la release oficial de GitHub para obtener siempre el APK firmado de la versión activa
            github_apk = f"https://github.com/cminewarIA/recursos-ui/releases/download/v{current_ver}/recursos-cockpit_{current_ver}.apk"
            self.send_response(302)
            self.send_header('Location', github_apk)
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
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

        # 0. Sincronización OTA híbrida de temas independientes desde GitHub (protegida por Zero-Trust)
        if clean_path == "/api/themes/sync":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            sync_res = sync_themes_from_github(BASE_DIR, force=True, timeout=6.0)
            catalog = get_themes_catalog_payload(BASE_DIR)
            catalog["sync_result"] = sync_res
            resp = json.dumps(catalog, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 1. Certificación Zero-Trust mediante contraseña maestra (con bloqueo anti-fuerza bruta) o verificación LAN
        if clean_path in ("/api/auth/unlock", "/api/unlock"):
            is_locked_ip, wait_sec = is_ip_locked_out(client_ip)
            if is_locked_ip:
                err_resp = json.dumps({
                    "success": False,
                    "status": "locked_out",
                    "retry_after": wait_sec,
                    "error": "Demasiados intentos fallidos. Espera antes de volver a intentarlo."
                }).encode('utf-8')
                self.send_response(429)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Retry-After', str(wait_sec))
                self.send_security_headers()
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

            body, err_code = self._read_json_body(max_bytes=16384)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

            entered_key = str(
                (body or {}).get("key")
                or (body or {}).get("password")
                or (body or {}).get("master_key")
                or ""
            ).strip()

            if not entered_key:
                auth = check_trust_status(self)
                if auth["is_trusted"] and auth.get("is_local"):
                    resp = json.dumps({
                        "success": True,
                        "token": auth.get("token") or auth.get("new_token") or "",
                        "device_id": auth.get("device_id") or "",
                        "certificate_serial": auth.get("certificate_serial") or "",
                    }).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_security_headers()
                    if auth.get("new_token"):
                        self.send_header('Set-Cookie', get_cookie_header_value(self, auth["new_token"]))
                    self.send_header('Content-Length', str(len(resp)))
                    self.end_headers()
                    self.wfile.write(resp)
                    return

            if not entered_key or len(entered_key) > 512 or not verify_master_key(entered_key):
                locked_now, info_val = record_auth_failure(client_ip)
                if locked_now:
                    err_resp = json.dumps({
                        "success": False,
                        "status": "locked_out",
                        "retry_after": info_val,
                        "error": "Demasiados intentos fallidos. Espera antes de volver a intentarlo."
                    }).encode('utf-8')
                    self.send_response(429)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Retry-After', str(info_val))
                    self.send_security_headers()
                    self.send_header('Content-Length', str(len(err_resp)))
                    self.end_headers()
                    self.wfile.write(err_resp)
                    return
                err_resp = json.dumps({
                    "success": False,
                    "status": "invalid_master_key",
                    "remaining_attempts": info_val,
                    "error": "Contraseña maestra incorrecta."
                }).encode('utf-8')
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

            record_auth_success(client_ip)
            ua = self.headers.get('User-Agent', '')
            hdr_tel = extract_header_telemetry(self) or {}
            body_tel = (body or {}).get("device_telemetry")
            merged_tel_in = dict(hdr_tel)
            if isinstance(body_tel, dict):
                merged_tel_in.update(body_tel)

            is_local = is_local_ip(client_ip)
            norm_client_ip = normalize_lan_ip(client_ip) if is_local else client_ip
            now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            with TRUST_LOCK:
                devices = load_trusted_devices()
                matched_id, matched_dev, _ = find_device_by_id_or_physical(
                    devices, None, merged_tel_in, norm_client_ip, ua, is_local=is_local, allow_wan_hw_match=True
                )
                target_id = matched_id or f"dev_{secrets.token_hex(6)}"
                ua_parsed = parse_user_agent(ua)
                dev_only_name = ua_parsed.split("•")[0].strip() if "•" in ua_parsed else ua_parsed
                entry = matched_dev or {
                    "id": target_id,
                    "alias_ids": [target_id],
                    "name": dev_only_name,
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                    "local_ip": norm_client_ip if is_local else "",
                    "last_external_ip": "" if is_local else client_ip,
                    "user_agent": ua[:240],
                    "verified_in_lan": bool(is_local),
                    "verified_by_master_key": True,
                    "master_verified_at": now_iso,
                    "trusted": True,
                }
                entry["id"] = target_id
                entry["trusted"] = True
                entry["verified_by_master_key"] = True
                entry["master_verified_at"] = now_iso
                if is_local:
                    entry["verified_in_lan"] = True
                    entry["lan_verified_at"] = entry.get("lan_verified_at") or now_iso
                else:
                    entry["last_external_ip"] = client_ip
                entry["last_seen"] = now_iso
                enrich_device_entry(entry, ua, merged_tel_in, norm_client_ip if is_local else client_ip, is_local=is_local)
                devices[target_id] = entry

                consolidated = consolidate_devices_by_hardware(devices)
                if target_id not in consolidated:
                    for cid, cdev in consolidated.items():
                        if target_id in (cdev.get("alias_ids") or []):
                            target_id = cid
                            entry = cdev
                            break
                else:
                    entry = consolidated[target_id]
                save_trusted_devices(consolidated)
                issued_token = create_device_token(target_id)
                cert_serial = entry.get("certificate_serial", "")

            resp = json.dumps({
                "success": True,
                "token": issued_token,
                "device_id": target_id,
                "certificate_serial": cert_serial,
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Set-Cookie', get_cookie_header_value(self, issued_token))
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

            body, err_code = self._read_json_body(max_bytes=2048)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            dev_id = str((body or {}).get('id') or '').strip()
            client_key = str((body or {}).get('client_key') or '').strip()

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
                    req_lang_rev = self.headers.get('X-Recursos-Lang') or self.headers.get('Accept-Language')
                    resp = json.dumps({"success": False, "error": i18n_t("errors.device_not_found", lang=req_lang_rev, base_dir=BASE_DIR)}).encode('utf-8')

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

            body, err_code = self._read_json_body(max_bytes=32768)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

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
                    "verified_in_lan": bool(is_local),
                    "verified_by_master_key": bool(not is_local),
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

        # 2c-bis. Restauración criptográfica de sesión desde token persistido (cookie regenerada en WAN)
        elif clean_path == "/api/auth/restore-session":
            body, err_code = self._read_json_body(max_bytes=4096)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

            candidate_tok = str((body or {}).get('token') or '').strip()
            if not candidate_tok:
                auth_hdr = self.headers.get('Authorization', '')
                if auth_hdr and auth_hdr.lower().startswith('bearer '):
                    candidate_tok = auth_hdr[7:].strip()
            if not candidate_tok:
                candidate_tok = self.headers.get('X-Device-Token', '').strip()

            ua = self.headers.get('User-Agent', '')
            hdr_tel = extract_header_telemetry(self)
            is_local = is_local_ip(client_ip)
            norm_ip = normalize_lan_ip(client_ip) if is_local else client_ip
            now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            matched_id = None
            issued_token = None
            with TRUST_LOCK:
                devices = load_trusted_devices()
                m_id, entry, needs_uni = _find_trusted_match_for_token(devices, candidate_tok)
                if m_id and _is_device_certified(entry):
                    matched_id = m_id
                    verified_raw, tok_ts = parse_verified_device_token(candidate_tok)
                    needs_rot = bool(tok_ts and (time.time() - tok_ts) > TOKEN_ROTATION_AGE_SEC)
                    issued_token = create_device_token(matched_id) if (needs_uni or verified_raw != matched_id or needs_rot) else candidate_tok
                    entry["last_seen"] = now_iso
                    if not is_local:
                        entry["last_external_ip"] = client_ip
                    enrich_device_entry(entry, ua, hdr_tel, norm_ip, is_local=is_local)
                    save_trusted_devices(devices)

            if not matched_id or not issued_token:
                err_resp = json.dumps({"success": False, "status": "locked"}).encode('utf-8')
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                if _has_trust_cookie(self):
                    self.send_header('Set-Cookie', get_clear_cookie_header_value(self))
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

            ok_resp = json.dumps({
                "success": True,
                "device_id": matched_id,
                "token": issued_token
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_security_headers()
            self.send_header('Set-Cookie', get_cookie_header_value(self, issued_token))
            self.send_header('Content-Length', str(len(ok_resp)))
            self.end_headers()
            self.wfile.write(ok_resp)
            return

        # 2d. Renombrar alias personalizado de un dispositivo en el Panel de Seguridad
        elif clean_path == "/api/auth/rename-device":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            body, err_code = self._read_json_body(max_bytes=4096)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

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

            body, err_code = self._read_json_body(max_bytes=2048)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            target_ip = str((body or {}).get('ip', '')).strip()
            jail = str((body or {}).get('jail', '')).strip()

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

            body, err_code = self._read_json_body(max_bytes=2048)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            target_ip = str((body or {}).get('ip', '')).strip()
            jail = str((body or {}).get('jail', 'caddy-scan')).strip()

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

        # 5. Fail2ban: Importación masiva de IPs (Blocklist / Archivo TXT o CSV)
        elif clean_path == "/api/fail2ban/import":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            try:
                content_length = int(self.headers.get('Content-Length', 0) or 0)
            except (ValueError, TypeError):
                self.send_response(400)
                self.send_security_headers()
                self.end_headers()
                return
            if content_length < 0 or content_length > 5 * 1024 * 1024:  # Hasta 5 MB
                self.send_response(413)
                self.send_security_headers()
                self.end_headers()
                return

            post_data = self.rfile.read(content_length).decode('utf-8', errors='ignore') if content_length > 0 else ""
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
                conn = None
                try:
                    conn = sqlite3.connect(db_path, timeout=5.0)
                    cur = conn.cursor()
                    for vip in valid_ips:
                        cur.execute("""
                            INSERT OR REPLACE INTO bips(ip, jail, timeofban, bantime, bancount, data)
                            VALUES (?, ?, ?, 172800, 1, '{"source": "manual_import"}')
                        """, (vip, jail, now_ts))
                    conn.commit()
                except Exception:
                    pass
                finally:
                    if conn is not None:
                        try:
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
                "message": f"Se procesaron {len(valid_ips)} IPs: {banned_success} añadidas activamente al cortafuegos de Fail2ban ({jail}).",
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

            body, err_code = self._read_json_body(max_bytes=2048)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            mac = str((body or {}).get('mac', '')).strip()
            target_ip = str((body or {}).get('ip', '')).strip()

            clean_mac = re.sub(r'[^0-9A-Fa-f]', '', mac).lower()
            if len(clean_mac) == 12 and clean_mac not in ("000000000000", "ffffffffffff"):
                wol_details = {}
                ok = send_wol_magic_packet(mac, target_ip=target_ip, details_out=wol_details)
                if ok:
                    ch_txt = ", ".join(wol_details.get("channels") or ["udp"])
                    resp = json.dumps({
                        "success": True,
                        "message": f"Paquete mágico Wake-on-LAN enviado a {wol_details.get('mac', mac)} ({ch_txt})",
                        "channels": wol_details.get("channels", []),
                        "targets": wol_details.get("targets", []),
                    }).encode('utf-8')
                    status_code = 200
                else:
                    resp = json.dumps({
                        "success": False,
                        "error": f"Error al emitir paquete WoL a {mac}",
                        "channels": wol_details.get("channels", []),
                        "errors": wol_details.get("errors", []),
                    }).encode('utf-8')
                    status_code = 500
            else:
                resp = json.dumps({"success": False, "error": "Dirección MAC inválida"}).encode('utf-8')
                status_code = 400

            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Señal de Apagado por Red (Sleep-on-LAN / SSH / RPC / Webhook)
        elif clean_path in ("/api/wol/shutdown", "/api/device/shutdown"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            body, err_code = self._read_json_body(max_bytes=2048)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

            target_ip = str((body or {}).get('ip', '')).strip()
            target_mac = str((body or {}).get('mac', '')).strip()
            target_name = str((body or {}).get('name', '')).strip()
            ok, msg, channels = send_device_shutdown_signal(target_ip, target_mac, target_name)

            if ok:
                resp = json.dumps({"success": True, "message": msg, "channels": channels}).encode('utf-8')
                status_code = 200
            else:
                resp = json.dumps({"success": False, "error": msg, "channels": channels}).encode('utf-8')
                status_code = 400 if ("bloqueada" in msg.lower() or "requiere una dirección" in msg.lower()) else 200

            self.send_response(status_code)
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

            body, err_code = self._read_json_body(max_bytes=16384)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            raw_text = str((body or {}).get('message') or (body or {}).get('text') or '').strip()

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

            body, err_code = self._read_json_body(max_bytes=4096)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            body = body or {}

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

        # Configuración en caliente de credenciales SSH del router (protegido por Zero-Trust para dispositivos certificados + cifrado AES-256-GCM)
        elif clean_path == "/api/network/router-credentials":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                err_payload = {
                    "ok": False,
                    "error": "Dispositivo no certificado. Solo los dispositivos certificados pueden configurar el router.",
                }
                err_resp = json.dumps(err_payload, ensure_ascii=False).encode('utf-8')
                self.send_response(403)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

            body, err_code = self._read_json_body(max_bytes=8192)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

            data = body if isinstance(body, dict) else {}
            action = str(data.get("action") or "save").strip().lower()
            r_ip = str(data.get("router_ip") or "").strip()
            r_user = str(data.get("router_user") or "").strip()
            r_pass = str(data.get("router_pass") or "")
            r_port = data.get("router_port", 22)

            status_code = 200
            if action == "clear":
                _clear_router_credentials_vault()
                out_payload = {
                    "ok": True,
                    "configured": False,
                    "encrypted": False,
                    "message": "Credenciales del router eliminadas de la bóveda local.",
                }
            elif action == "test":
                ok_ssh, model_name, err_ssh = _test_router_ssh_connection(r_ip, r_user, r_pass, r_port)
                status_code = 200 if ok_ssh else 400
                out_payload = {
                    "ok": ok_ssh,
                    "model": model_name,
                    "message": f"Conexión SSH verificada{f' ({model_name})' if model_name else ''}." if ok_ssh else err_ssh,
                    "error": "" if ok_ssh else err_ssh,
                }
            elif action == "save":
                skip_test = bool(data.get("skip_test", False))
                model_name = ""
                if not skip_test:
                    ok_ssh, model_name, err_ssh = _test_router_ssh_connection(r_ip, r_user, r_pass, r_port)
                    if not ok_ssh:
                        status_code = 400
                        out_payload = {
                            "ok": False,
                            "model": "",
                            "error": err_ssh,
                            "message": err_ssh,
                        }
                    else:
                        ok_save, err_save = _save_router_credentials_vault(r_ip, r_user, r_pass, r_port)
                        status_code = 200 if ok_save else 500
                        out_payload = {
                            "ok": ok_save,
                            "configured": ok_save,
                            "encrypted": ok_save,
                            "model": model_name,
                            "router_ip": r_ip,
                            "router_port": _normalize_router_port(r_port),
                            "router_user": r_user,
                            "message": (
                                f"Credenciales cifradas en AES-256-GCM y activadas{f' ({model_name})' if model_name else ''}."
                                if ok_save
                                else err_save
                            ),
                            "error": "" if ok_save else err_save,
                        }
                else:
                    ok_save, err_save = _save_router_credentials_vault(r_ip, r_user, r_pass, r_port)
                    status_code = 200 if ok_save else 400
                    out_payload = {
                        "ok": ok_save,
                        "configured": ok_save,
                        "encrypted": ok_save,
                        "router_ip": r_ip,
                        "router_port": _normalize_router_port(r_port),
                        "router_user": r_user,
                        "message": "Credenciales cifradas en AES-256-GCM." if ok_save else err_save,
                        "error": "" if ok_save else err_save,
                    }
            else:
                status_code = 400
                out_payload = {"ok": False, "error": f"Acción no soportada: {action}"}

            resp = json.dumps(out_payload, ensure_ascii=False).encode('utf-8')
            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
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

        # Identificación y simplificación de conexiones mediante Gemini AI en servidor
        elif clean_path == "/api/net/ai-identify":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            body, err_code = self._read_json_body(max_bytes=524288)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            conns_in = (body or {}).get("connections") or []
            lang_in = str((body or {}).get("lang") or "es").strip().lower()[:8] or "es"
            http_status, ai_payload = identify_connections_with_ai(conns_in, lang_in)
            resp = json.dumps(ai_payload, ensure_ascii=False).encode('utf-8')
            self.send_response(http_status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Simplificación, nivel de peligro y soluciones IA para fallos del avisador (con persistencia SQLite anti-recurrentes)
        elif clean_path == "/api/system/logs/ai-simplify":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            body, err_code = self._read_json_body(max_bytes=524288)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            faults_in = (body or {}).get("faults") or []
            lang_in = str((body or {}).get("lang") or "es").strip().lower()[:8] or "es"
            http_status, ai_payload = simplify_system_faults_with_ai(faults_in, lang_in)
            resp = json.dumps(ai_payload, ensure_ascii=False).encode('utf-8')
            self.send_response(http_status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        elif clean_path == "/api/net/speedtest/run":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            with SPEEDTEST_LOCK:
                already_running = bool(SPEEDTEST_STATE.get("running"))
                if not already_running:
                    SPEEDTEST_STATE.update({
                        "running": True,
                        "phase": "ping",
                        "progress_pct": 4,
                        "current_mbps": 0.0,
                        "error": "",
                        "started_at": time.time(),
                    })
                st_copy = dict(SPEEDTEST_STATE)
            if not already_running:
                threading.Thread(target=_run_speedtest_worker, daemon=True, name="SpeedTestWorker").start()
            resp = json.dumps({
                "ok": True,
                "success": True,
                "started": not already_running,
                "already_running": already_running,
                "running": True,
                "status": st_copy,
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        elif clean_path == "/api/net/speedtest/history/clear":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            body, _ = self._read_json_body(max_bytes=2048)
            entry_id = (body or {}).get("id")
            ok, deleted = delete_speedtest_history_from_sqlite(int(entry_id) if entry_id is not None else None)
            resp = json.dumps({"ok": ok, "success": ok, "deleted": deleted}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        elif clean_path == "/api/net/speedtest/payload":
            auth = check_trust_status(self)
            if client_ip not in ("127.0.0.1", "::1", "::ffff:127.0.0.1") and not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            try:
                content_len = min(int(self.headers.get('Content-Length') or 0), 67108864)
            except Exception:
                content_len = 0
            drained = 0
            while drained < content_len:
                chunk = self.rfile.read(min(131072, content_len - drained))
                if not chunk:
                    break
                drained += len(chunk)
            resp = json.dumps({"ok": True, "received_bytes": drained}).encode('utf-8')
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

            body, err_code = self._read_json_body(max_bytes=4096)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            stype = str((body or {}).get('type', '')).strip()
            target = str((body or {}).get('target', '')).strip()
            action = str((body or {}).get('action', 'restart')).strip()

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

        # 6. Actualización e instalación automática desde GitHub (git pull + build .deb + apt install + reinicio)
        elif clean_path in ("/api/system/update", "/api/update"):
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            try:
                body_upd, _err_upd = self._read_json_body(max_bytes=16384)
                force_dl = True if not isinstance(body_upd, dict) else bool(body_upd.get("force", True))
                res_obj = perform_auto_update_and_install(
                    trigger_source="api_request",
                    do_git_pull=True,
                    force_github_download=force_dl,
                )
                resp = json.dumps(res_obj).encode('utf-8')
            except Exception as e:
                resp = json.dumps({
                    "success": False,
                    "error": f"Excepción durante la actualización e instalación automática: {str(e)}"
                }).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 6a-bis. Sincronización directa de web local desde la App Nativa de Ubuntu
        elif clean_path == "/api/system/sync-web":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return

            body, err_code = self._read_json_body(max_bytes=16 * 1024 * 1024)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return

            ALLOWED_WEB_SYNC_FILES = {
                "VERSION",
                "package.json",
                "i18n_catalog.py",
                "i18n/dictionary.csv",
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
            }
            incoming_ver = str((body or {}).get("version") or "").strip().lstrip("vV")
            force_sync = bool((body or {}).get("force", False))
            files_map = (body or {}).get("files") or {}
            sha_map = (body or {}).get("sha256") or {}

            if not incoming_ver or not isinstance(files_map, dict) or not files_map:
                resp = json.dumps({"success": False, "error": "Paquete web inválido o vacío."}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            current_srv_ver = get_app_version()
            if not force_sync and _parse_semver_tuple(incoming_ver) < _parse_semver_tuple(current_srv_ver):
                resp = json.dumps({
                    "success": False,
                    "error": f"La versión recibida ({incoming_ver}) es inferior a la actual del servidor ({current_srv_ver}).",
                    "server_version": current_srv_ver,
                }).encode('utf-8')
                self.send_response(409)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            decoded_entries = []
            try:
                for rel_path, b64_val in files_map.items():
                    clean_rel = str(rel_path or "").strip().lstrip("/")
                    if clean_rel not in ALLOWED_WEB_SYNC_FILES:
                        raise ValueError(f"Ruta no permitida en sincronización web: {clean_rel}")
                    raw_bytes = base64.b64decode(str(b64_val), validate=True)
                    expected_sha = str(sha_map.get(rel_path) or sha_map.get(clean_rel) or "").strip().lower()
                    if expected_sha:
                        actual_sha = hashlib.sha256(raw_bytes).hexdigest().lower()
                        if actual_sha != expected_sha:
                            raise ValueError(f"Suma SHA-256 inválida para {clean_rel}")
                    decoded_entries.append((clean_rel, raw_bytes))
            except Exception as val_err:
                resp = json.dumps({"success": False, "error": str(val_err)}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            written_files = []
            try:
                for clean_rel, raw_bytes in decoded_entries:
                    abs_target = os.path.abspath(os.path.join(BASE_DIR, clean_rel))
                    if not abs_target.startswith(os.path.abspath(BASE_DIR) + os.sep):
                        raise ValueError(f"Ruta fuera del directorio base: {clean_rel}")
                    os.makedirs(os.path.dirname(abs_target), exist_ok=True)
                    tmp_target = abs_target + ".sync_tmp"
                    with open(tmp_target, "wb") as tf:
                        tf.write(raw_bytes)
                    os.replace(tmp_target, abs_target)
                    written_files.append(clean_rel)
            except Exception as io_err:
                resp = json.dumps({"success": False, "error": f"Error escribiendo archivos web: {io_err}"}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_security_headers()
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            with VERSION_LOCK:
                VERSION_CACHE["data"] = None
                VERSION_CACHE["timestamp"] = 0
            new_ver_info = get_version_info(force_refresh=True, allow_auto_trigger=False)

            with METRICS_LOCK:
                if isinstance(METRICS_CACHE, dict):
                    METRICS_CACHE["version_info"] = new_ver_info
                _invalidate_metrics_bytes_cache()

            now_str = datetime.now().strftime("%H:%M:%S")
            disp_new = get_display_version(incoming_ver)
            with AUTO_INSTALL_LOCK:
                AUTO_INSTALL_STATE["last_installed_at"] = now_str
                AUTO_INSTALL_STATE["last_status"] = f"Web local sincronizada · v{disp_new} ({now_str})"

            resp = json.dumps({
                "success": True,
                "synced": True,
                "previous_version": current_srv_ver,
                "version": incoming_ver,
                "updated_files": written_files,
                "message": f"Web local actualizada en caliente a v{disp_new} ({len(written_files)} archivos).",
                "version_info": new_ver_info,
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_security_headers()
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # 6b. Configurar preferencia de instalación automática al detectar
        elif clean_path == "/api/system/auto-update":
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            body, err_code = self._read_json_body(max_bytes=4096)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            enabled = bool((body or {}).get("enabled", True))
            saved = save_auto_install_preference(enabled)
            with VERSION_LOCK:
                if isinstance(VERSION_CACHE.get("data"), dict):
                    VERSION_CACHE["data"]["auto_install_enabled"] = saved
                    VERSION_CACHE["data"]["auto_install_status"] = AUTO_INSTALL_STATE.get("last_status", "")
            if saved:
                threading.Thread(
                    target=get_version_info,
                    kwargs={"force_refresh": True, "allow_auto_trigger": True},
                    daemon=True,
                ).start()
            resp = json.dumps({
                "success": True,
                "auto_install_enabled": saved,
                "status": AUTO_INSTALL_STATE.get("last_status", ""),
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

            body, err_code = self._read_json_body(max_bytes=4 * 1024 * 1024)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            target_key = str((body or {}).get('key') or '').strip()
            logo_val = str((body or {}).get('logo') or '').strip()

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

            body, err_code = self._read_json_body(max_bytes=65536)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            req_ips = (body or {}).get("ips", [])
            force_sync = bool((body or {}).get("force_sync", False))

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
            auth = check_trust_status(self)
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            resp = json.dumps({
                "success": True,
                "engine": "leaflet",
                "provider": "OpenStreetMap",
                "free": True,
                "requires_api_key": False
            }).encode('utf-8')
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
            body, err_code = self._read_json_body(max_bytes=8192)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            body = body or {}
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

        # 12. Marcar avisos anteriores del sistema como revisados (con opción de reset)
        elif clean_path in ("/api/system/logs/ack", "/api/system/logs/clear"):
            auth = check_trust_status(self)
            req_lang = self.headers.get('X-Recursos-Lang') or self.headers.get('Accept-Language')
            if not auth["is_trusted"]:
                self.send_response(403)
                self.send_security_headers()
                self.end_headers()
                return
            body, err_code = self._read_json_body(max_bytes=4096)
            if err_code:
                self.send_response(err_code)
                self.send_security_headers()
                self.end_headers()
                return
            reset_flag = bool((body or {}).get("reset", False))
            ack_state = save_system_logs_ack_state(0.0 if reset_flag else time.time())
            summary = get_effective_system_errors_summary()
            with METRICS_LOCK:
                if isinstance(METRICS_CACHE, dict) and METRICS_CACHE:
                    METRICS_CACHE["system_errors_summary"] = summary
                    _invalidate_metrics_bytes_cache()
            resp = json.dumps({
                "success": True,
                "ok": True,
                "message": i18n_t("errors.system_logs_acked", lang=req_lang, base_dir=BASE_DIR),
                "ack_ts": ack_state.get("ack_ts"),
                "ack_time_str": ack_state.get("ack_time_str"),
                "system_errors_summary": summary,
            }, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
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
        try:
            msg = (format % args) if args else str(format)
            if "/api/system/console-logs" in msg or "/api/metrics" in msg:
                return
            client_origin = resolve_log_client_identity(self)
            lvl = "ERROR" if (" 500 " in msg or " 502 " in msg) else ("WARN" if (" 403 " in msg or " 404 " in msg) else "HTTP")
            record_service_console_log(f"{client_origin} {msg}", level=lvl, source="http")
        except Exception:
            pass
        return

_MDNS_ADVERTISER_LOCK = threading.Lock()
_MDNS_ADVERTISER_PROC = None
_MDNS_ZEROCONF_HANDLE = None

def start_mdns_service_advertiser(port=8085):
    """
    Publica dinamicamente el servicio HTTP de Recursos Cockpit en mDNS/DNS-SD (_recursos._tcp)
    para autodescubrimiento instantaneo en LAN desde Ubuntu y Android/TV.
    Respeta el servicio estatico de Avahi (/etc/avahi/services/recursos-cockpit.service) si ya
    coincide con el puerto activo para evitar anuncios duplicados.
    """
    global _MDNS_ADVERTISER_PROC, _MDNS_ZEROCONF_HANDLE
    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 8085

    avahi_service_file = "/etc/avahi/services/recursos-cockpit.service"
    if os.path.isfile(avahi_service_file):
        try:
            with open(avahi_service_file, "r", encoding="utf-8", errors="ignore") as f:
                xml_txt = f.read()
            if "_recursos._tcp" in xml_txt and f"<port>{port}</port>" in xml_txt:
                print(f"[mDNS] Servicio _recursos._tcp:{port} activo mediante Avahi ({avahi_service_file})")
                return True
        except Exception:
            pass

    avahi_pub = shutil.which("avahi-publish-service")
    if avahi_pub:
        def _run_avahi_pub():
            global _MDNS_ADVERTISER_PROC
            svc_name = socket.gethostname() or "recursos-cockpit"
            try:
                proc = subprocess.Popen(
                    [avahi_pub, "-s", svc_name, "_recursos._tcp", str(port), "path=/", "app=recursos-cockpit"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                with _MDNS_ADVERTISER_LOCK:
                    _MDNS_ADVERTISER_PROC = proc
                print(f"[mDNS] Publicando _recursos._tcp:{port} con avahi-publish-service ({svc_name})")
            except Exception as exc:
                print(f"[mDNS] No se pudo iniciar avahi-publish-service: {exc}")

        threading.Thread(target=_run_avahi_pub, daemon=True, name="MdnsAvahiPublisher").start()
        return True

    def _run_py_zeroconf():
        global _MDNS_ZEROCONF_HANDLE
        try:
            from zeroconf import ServiceInfo, Zeroconf
            host_name = socket.gethostname() or "recursos-cockpit"
            local_ip = SERVER_LOCAL_IP if _is_lan_ipv4(SERVER_LOCAL_IP) else None
            if not local_ip:
                return
            info = ServiceInfo(
                "_recursos._tcp.local.",
                f"{host_name}._recursos._tcp.local.",
                addresses=[socket.inet_aton(local_ip)],
                port=port,
                properties={"path": "/", "app": "recursos-cockpit"},
                server=f"{host_name}.local.",
            )
            zc = Zeroconf()
            zc.register_service(info)
            with _MDNS_ADVERTISER_LOCK:
                _MDNS_ZEROCONF_HANDLE = (zc, info)
            print(f"[mDNS] Publicando _recursos._tcp:{port} con python-zeroconf ({local_ip})")
        except Exception as exc:
            print(f"[mDNS] Zeroconf auxiliar no disponible: {exc}")

    threading.Thread(target=_run_py_zeroconf, daemon=True, name="MdnsZeroconfPublisher").start()
    return False

def run_server(port=None):
    global ACTIVE_SERVER_PORT
    if port is None:
        raw_port = os.environ.get("RECURSOS_PORT") or os.environ.get("PORT") or "8085"
        try:
            port = int(raw_port)
        except (TypeError, ValueError):
            port = 8085
    ACTIVE_SERVER_PORT = port
    install_service_console_tee()
    preload_telemetry_history_from_sqlite()
    record_service_console_log(
        f"Servicio Recursos Cockpit v{get_canonical_version(BASE_DIR)} inicializando en puerto {port} (retención consola: 24h)",
        level="INFO",
        source="lifecycle",
    )
    preload_ping_history_from_sqlite()
    threading.Thread(target=fetch_gpu_worker, daemon=True).start()
    threading.Thread(target=fetch_disks_worker, daemon=True).start()
    threading.Thread(target=fetch_docker_worker, daemon=True).start()
    threading.Thread(target=fetch_wifi_worker, daemon=True).start()
    threading.Thread(target=fetch_security_worker, daemon=True).start()
    threading.Thread(target=fetch_connections_geo_worker, daemon=True).start()
    threading.Thread(target=fetch_ping_latency_worker, daemon=True, name="PingLatencyWorker").start()
    threading.Thread(target=background_collector, daemon=True).start()
    threading.Thread(target=auto_install_watcher_worker, daemon=True, name="AutoInstallWatcher").start()
    threading.Thread(target=telegram_bot_polling_worker, daemon=True, name="TelegramBotPolling").start()
    threading.Thread(target=telegram_bot_monitor_worker, daemon=True, name="TelegramBotMonitor").start()
    schedule_background_dictionary_sync(BASE_DIR, interval_sec=1800.0)
    start_background_themes_ota_sync(BASE_DIR)
    start_mdns_service_advertiser(port)
    
    bind_host = os.environ.get("HOST", "0.0.0.0")
    server_address = (bind_host, port)
    httpd = ThreadingHTTPServer(server_address, DashboardHTTPHandler)
    print(f"[+] Monitor de Sistema iniciado en http://{bind_host}:{port} con Zero-Trust Pairing, Monitor Wi-Fi y Bot de Telegram Integrado")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
