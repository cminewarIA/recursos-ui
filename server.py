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
CUSTOM_LOGOS_FILE = os.path.join(BASE_DIR, "custom_logos.json")
CUSTOM_LOGOS_LOCK = threading.Lock()
ADMIN_MASTER_KEY = os.environ.get("ADMIN_MASTER_KEY", "Cminewar2026!")  # Clave maestra de rescate / desbloqueo remoto

def load_custom_logos():
    if not os.path.isfile(CUSTOM_LOGOS_FILE):
        return {}
    try:
        with open(CUSTOM_LOGOS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def save_custom_logos(logos_dict):
    try:
        with open(CUSTOM_LOGOS_FILE, "w", encoding="utf-8") as f:
            json.dump(logos_dict, f, indent=2, ensure_ascii=False)
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
MAX_NIC_HISTORY_SECONDS = 7200  # 2 hours

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
        "last_sync": "--"
    }
}
CONNECTIONS_MAP_LOCK = threading.Lock()
GEOIP_LOCK = threading.Lock()
GEOIP_CACHE_FILE = os.path.join(BASE_DIR, "geoip_cache.json")
GEOIP_TTL_SECONDS = 7 * 86400  # 7 days TTL for resolved GeoIP entries
GEOIP_NEG_TTL_SECONDS = 900    # 15 minutes cooldown for unresolvable/failed IPs
GEOIP_MAX_ENTRIES = 2000
GEOIP_MAX_CACHE_ENTRIES = GEOIP_MAX_ENTRIES

GEOIP_CACHE = {}           # { ip: { "lat", "lng", "city", "region", "country", "country_code", "isp", "asn", "ts" } }
GEOIP_NEGATIVE_CACHE = {}  # { ip: ts_failed }
GEOIP_PENDING_QUEUE = set()
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
    "last_disk_save_ts": 0.0
}

PORT_SERVICE_LABELS = {
    22: "SSH Daemon (OpenSSH)",
    53: "DNS Resolver (Pi-hole / Unbound)",
    80: "HTTP Web Server",
    123: "NTP Time Sync",
    443: "HTTPS / TLS Stream",
    2283: "Immich Photo Server",
    3000: "Panel Recursos Web UI",
    7878: "Radarr Media Service",
    8000: "Backend API Service",
    8080: "HTTP Proxy / Web Socket",
    8082: "qBittorrent Web UI",
    8085: "Panel Recursos Backend",
    8096: "Emby Media Server",
    8550: "Panel Recursos (HTTPS)",
    8989: "Sonarr Media Service",
    9000: "Portainer Docker Engine",
    51820: "WireGuard VPN Tunnel"
}

def _is_private_ip(ip_str):
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        return (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        )
    except Exception:
        return True

def load_geoip_disk_cache():
    """Carga la caché persistente de GeoIP desde disco al iniciar el worker."""
    global GEOIP_CACHE, SERVER_SELF_GEO
    if not os.path.exists(GEOIP_CACHE_FILE):
        return
    try:
        with open(GEOIP_CACHE_FILE, "r", encoding="utf-8", errors="ignore") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return
        now = time.time()
        cutoff = now - GEOIP_TTL_SECONDS
        entries = raw.get("entries", raw) if isinstance(raw.get("entries"), dict) else raw
        loaded = {}
        for ip_k, val in entries.items():
            if isinstance(val, dict) and isinstance(val.get("lat"), (int, float)) and isinstance(val.get("lng"), (int, float)):
                ts = float(val.get("ts", now))
                if ts >= cutoff:
                    loaded[str(ip_k)] = {
                        "ip": str(ip_k),
                        "lat": float(val["lat"]),
                        "lng": float(val["lng"]),
                        "city": str(val.get("city") or "Nodo Remoto"),
                        "region": str(val.get("region") or ""),
                        "country": str(val.get("country") or ""),
                        "country_code": str(val.get("country_code") or ""),
                        "isp": str(val.get("isp") or ""),
                        "asn": str(val.get("asn") or ""),
                        "ts": ts
                    }
        with GEOIP_LOCK:
            GEOIP_CACHE.update(loaded)
            if isinstance(raw.get("server_self_geo"), dict) and isinstance(raw["server_self_geo"].get("lat"), (int, float)):
                SERVER_SELF_GEO = dict(raw["server_self_geo"])
    except Exception:
        pass

def save_geoip_disk_cache(force=False):
    """Persiste de forma atómica la caché GeoIP en disco para reducir carga sobre ip-api.com tras reinicios."""
    now = time.time()
    with GEOIP_LOCK:
        if not force and not GEOIP_WORKER_STATS["dirty_disk"]:
            return
        if not force and (now - GEOIP_WORKER_STATS["last_disk_save_ts"] < 15.0):
            return
        # Prune oldest if over max limit
        if len(GEOIP_CACHE) > GEOIP_MAX_CACHE_ENTRIES:
            sorted_keys = sorted(GEOIP_CACHE.keys(), key=lambda k: GEOIP_CACHE[k].get("ts", 0), reverse=True)
            keep_keys = set(sorted_keys[:GEOIP_MAX_CACHE_ENTRIES])
            for k in list(GEOIP_CACHE.keys()):
                if k not in keep_keys:
                    del GEOIP_CACHE[k]
        snapshot = {
            "updated_at": now,
            "server_self_geo": dict(SERVER_SELF_GEO) if SERVER_SELF_GEO else {},
            "entries": dict(GEOIP_CACHE)
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
            "last_sync": GEOIP_WORKER_STATS["last_sync_str"]
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

def resolve_geoip_batch_from_ip_api(ip_list):
    """Consulta ip-api.com en lote (o individual si es 1 IP) respetando límites de tasa y actualizando GEOIP_CACHE."""
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
            "http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query",
            data=batch_payload,
            headers={"Content-Type": "application/json", "User-Agent": "RecursosDashboard-GeoIPWorker/4.4"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            rl_rem = resp.headers.get("X-Rl")
            rl_ttl = resp.headers.get("X-Ttl")
            b_res = json.loads(resp.read().decode("utf-8", errors="ignore"))

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
                            entry = {
                                "ip": q_ip,
                                "lat": float(item["lat"]),
                                "lng": float(item["lon"]),
                                "city": str(item.get("city") or "Nodo Remoto"),
                                "region": str(item.get("regionName") or ""),
                                "country": str(item.get("country") or ""),
                                "country_code": str(item.get("countryCode") or ""),
                                "isp": str(item.get("org") or item.get("isp") or ""),
                                "asn": str(item.get("as") or ""),
                                "ts": time.time()
                            }
                            GEOIP_CACHE[q_ip] = entry
                            GEOIP_NEGATIVE_CACHE.pop(q_ip, None)
                            resolved_now[q_ip] = entry
                            GEOIP_WORKER_STATS["api_ips_resolved"] += 1
                            GEOIP_WORKER_STATS["dirty_disk"] = True
                        else:
                            GEOIP_NEGATIVE_CACHE[q_ip] = time.time()

                    for req_ip in batch_slice:
                        if req_ip not in seen_queries:
                            GEOIP_PENDING_QUEUE.discard(req_ip)
                            GEOIP_NEGATIVE_CACHE[req_ip] = time.time()
    except urllib.error.HTTPError as he:
        with GEOIP_LOCK:
            if he.code == 429:
                GEOIP_WORKER_STATS["rate_limit_remaining"] = 0
                GEOIP_WORKER_STATS["rate_limit_reset_ts"] = time.time() + 62.0
    except Exception:
        pass
    finally:
        with GEOIP_LOCK:
            GEOIP_WORKER_STATS["status"] = "active"

    if resolved_now:
        save_geoip_disk_cache(force=False)
    return resolved_now

def fetch_connections_geo_worker():
    global CONNECTIONS_MAP_CACHE, SERVER_SELF_GEO
    load_geoip_disk_cache()
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
            # 1. Resolve server's own public WAN IP & GeoIP once or every 30 min
            if not SERVER_SELF_GEO or (now - SERVER_SELF_GEO.get("ts", 0) > 1800):
                try:
                    req = urllib.request.Request(
                        "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,isp,org,as,query",
                        headers={"User-Agent": "RecursosDashboard-GeoIPWorker/4.4"}
                    )
                    with urllib.request.urlopen(req, timeout=3.0) as resp:
                        sdata = json.loads(resp.read().decode("utf-8", errors="ignore"))
                        if sdata.get("status") == "success" and isinstance(sdata.get("lat"), (int, float)):
                            with GEOIP_LOCK:
                                SERVER_SELF_GEO = {
                                    "ip": sdata.get("query") or SERVER_LOCAL_IP,
                                    "lat": float(sdata.get("lat")),
                                    "lng": float(sdata.get("lon")),
                                    "city": sdata.get("city") or "Nodo Servidor",
                                    "country": sdata.get("country") or "",
                                    "country_code": sdata.get("countryCode") or "",
                                    "org": sdata.get("org") or sdata.get("isp") or HOSTNAME,
                                    "ts": now
                                }
                                GEOIP_WORKER_STATS["dirty_disk"] = True
                except Exception:
                    pass

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
                    except Exception:
                        pass

            # 3. Inspect active kernel sockets via psutil.net_connections
            listening_ports = {22, 53, 80, 443, 3000, 8080, 8082, 8085, 8096, 8550, 9000, 51820}
            raw_sockets = []
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
                    svc_port = loc_port if is_in else rem_port
                    raw_sockets.append({
                        "direction": direction,
                        "protocol": proto_str,
                        "local_ip": loc_ip if loc_ip != "0.0.0.0" else SERVER_LOCAL_IP,
                        "local_port": loc_port,
                        "remote_ip": rem_ip,
                        "remote_port": rem_port,
                        "state": c.status or "ACTIVE",
                        "service": PORT_SERVICE_LABELS.get(svc_port, f"{proto_str} Puerto :{svc_port}")
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

            srv_lat = SERVER_SELF_GEO.get("lat", 40.4168)
            srv_lng = SERVER_SELF_GEO.get("lng", -3.7038)
            srv_city = SERVER_SELF_GEO.get("city", "Nodo Servidor")
            srv_country = SERVER_SELF_GEO.get("country", "")
            srv_cc = SERVER_SELF_GEO.get("country_code", "")

            connections_out = []
            lan_idx = 0
            pending_idx = 0
            import math
            for s in raw_sockets:
                r_ip = s["remote_ip"]
                is_lan = _is_private_ip(r_ip)
                with GEOIP_LOCK:
                    geo = GEOIP_CACHE.get(r_ip)
                if geo:
                    lat, lng = geo["lat"], geo["lng"]
                    city, country, cc = geo["city"], geo["country"], geo["country_code"]
                    isp, asn = geo["isp"], geo["asn"]
                    geo_status = "cached"
                elif is_lan:
                    lan_idx += 1
                    angle = (lan_idx * 137.5 * 3.14159265) / 180.0
                    radius = 0.022 + (lan_idx % 4) * 0.008
                    lat = round(srv_lat + radius * math.cos(angle), 5)
                    lng = round(srv_lng + radius * math.sin(angle) * 1.4, 5)
                    city = "Red Local (LAN)"
                    country = srv_country
                    cc = srv_cc
                    isp = "Subred Privada / Enlace Directo"
                    asn = "LAN-LOCAL"
                    geo_status = "lan"
                else:
                    pending_idx += 1
                    angle = (pending_idx * 105.0 * 3.14159265) / 180.0
                    radius = 0.35 + (pending_idx % 5) * 0.12
                    lat = round(srv_lat + radius * math.cos(angle), 5)
                    lng = round(srv_lng + radius * math.sin(angle) * 1.4, 5)
                    city = "Resolviendo GeoIP..."
                    country = ""
                    cc = ""
                    isp = "En cola del Worker GeoIP (ip-api.com)"
                    asn = ""
                    geo_status = "pending"

                connections_out.append({
                    "id": f"sock_{s['direction']}_{r_ip}_{s['local_port']}_{s['remote_port']}",
                    "direction": s["direction"],
                    "protocol": s["protocol"],
                    "local_ip": s["local_ip"],
                    "local_port": s["local_port"],
                    "remote_ip": r_ip,
                    "remote_port": s["remote_port"],
                    "service": s["service"],
                    "state": s["state"],
                    "lat": lat,
                    "lng": lng,
                    "city": city,
                    "country": country,
                    "country_code": cc,
                    "isp": isp,
                    "asn": asn,
                    "is_lan": is_lan,
                    "geo_status": geo_status
                })

            for ep in resolved_outbound_hosts.values():
                with GEOIP_LOCK:
                    geo = GEOIP_CACHE.get(ep["ip"])
                if not geo:
                    continue
                if not any(c["remote_ip"] == ep["ip"] for c in connections_out):
                    connections_out.append({
                        "id": f"out_{ep['host']}_{ep['ip']}",
                        "direction": "outgoing",
                        "protocol": ep["protocol"],
                        "local_ip": SERVER_LOCAL_IP,
                        "local_port": 48120 + (ep["port"] % 500),
                        "remote_ip": ep["ip"],
                        "remote_port": ep["port"],
                        "service": ep["service"],
                        "state": "ESTABLISHED",
                        "lat": geo["lat"],
                        "lng": geo["lng"],
                        "city": geo["city"],
                        "country": geo["country"],
                        "country_code": geo["country_code"],
                        "isp": geo["isp"],
                        "asn": geo["asn"],
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
                    connections_out.append({
                        "id": f"blk_{b_ip}",
                        "direction": "blocked",
                        "protocol": "TCP",
                        "local_ip": SERVER_LOCAL_IP,
                        "local_port": 22,
                        "remote_ip": b_ip,
                        "remote_port": 0,
                        "service": f"Fail2ban IPS ({b_item.get('jail', 'sshd')})",
                        "state": "BANNED",
                        "lat": geo["lat"],
                        "lng": geo["lng"],
                        "city": geo["city"],
                        "country": geo["country"],
                        "country_code": geo["country_code"],
                        "isp": geo["isp"],
                        "asn": geo["asn"],
                        "is_lan": False,
                        "geo_status": "cached"
                    })

            inc_cnt = sum(1 for c in connections_out if c["direction"] == "incoming")
            out_cnt = sum(1 for c in connections_out if c["direction"] == "outgoing")
            blk_cnt = sum(1 for c in connections_out if c["direction"] == "blocked")
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
                        "blocked": blk_cnt
                    },
                    "connections": connections_out,
                    "geoip_worker": worker_summary
                }
            save_geoip_disk_cache(force=False)
        except Exception:
            pass
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
                return pkg_json.get("version", "2.1.0")
        except Exception:
            pass

    return "2.1.0"

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

def load_trusted_devices():
    """Carga el registro de dispositivos de confianza."""
    if not os.path.exists(TRUSTED_FILE):
        return {}
    try:
        with open(TRUSTED_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Soporte de migración si el archivo usaba hashes antiguos como claves
            normalized = {}
            for k, v in data.items():
                dev_id = v.get("id") or k
                normalized[dev_id] = v
            return normalized
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
    Verifica el origen de la petición y valida la credencial criptográfica HMAC.
    - Si conecta desde LAN local: emite credencial automática si no tiene, y autoriza.
    - Si conecta desde red externa (datos móviles): valida token firmado y verifica que
      fue emparejado previamente en LAN. Si no lo está, BLOQUEA el acceso.
    """
    client_ip = get_client_ip(handler)
    is_local = is_local_ip(client_ip)
    
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
            
    with TRUST_LOCK:
        devices = load_trusted_devices()
        verified_device_id = verify_device_token(token) if token else None
        device_entry = devices.get(verified_device_id) if verified_device_id else None
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
                    "device_id": "cli_local",
                    "new_token": None,
                    "token": None
                }

            # Si el dispositivo ya tiene un token firmado válido y registrado en devices
            if device_entry and device_entry.get("trusted", True):
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
                    "device_id": verified_device_id,
                    "new_token": None,
                    "token": token
                }
            else:
                # Dispositivo nuevo en LAN: emitir nueva credencial HMAC-SHA256
                dev_id = f"dev_{secrets.token_hex(6)}"
                new_token = create_device_token(dev_id)
                device_name = parse_user_agent(ua)
                device_entry = {
                    "id": dev_id,
                    "name": device_name,
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                    "local_ip": client_ip,
                    "last_external_ip": "",
                    "user_agent": ua[:150],
                    "verified_in_lan": True,
                    "trusted": True
                }
                devices[dev_id] = device_entry
                save_trusted_devices(devices)
                return {
                    "is_local": True,
                    "is_trusted": True,
                    "client_ip": client_ip,
                    "device_info": device_entry,
                    "device_id": dev_id,
                    "new_token": new_token,
                    "token": new_token
                }
        else:
            # Petición desde el EXTERIOR (Datos móviles / WAN)
            if device_entry and device_entry.get("trusted", False) and device_entry.get("verified_in_lan", True):
                # Dispositivo previamente emparejado en LAN con firma válida
                device_entry["last_seen"] = now_iso
                device_entry["last_external_ip"] = client_ip
                save_trusted_devices(devices)
                return {
                    "is_local": False,
                    "is_trusted": True,
                    "client_ip": client_ip,
                    "device_info": device_entry,
                    "device_id": verified_device_id,
                    "new_token": None,
                    "token": token
                }
            else:
                # Dispositivo NO verificado en LAN -> BLOQUEAR COMPLETAMENTE
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

def get_ip_to_device_name_map():
    arp_mac_map = get_arp_and_pihole_names()
    ip_to_name = {}
    for mac, data in arp_mac_map.items():
        if isinstance(data, dict) and 'ip' in data and 'name' in data:
            ip_to_name[data['ip']] = data['name']
    return ip_to_name

DUCKDNS_SCRIPT = "/home/servidor/servicios/duckdns/duck.sh"
DUCKDNS_LOG_CANDIDATES = [
    "/mnt/almacenamiento/logs/duckdns/duck.log",
    "/home/servidor/servicios/duckdns/duck.log"
]
DUCKDNS_IP_CACHE = "/home/servidor/servicios/duckdns/last_ip.txt"

def get_duckdns_log_file():
    for p in DUCKDNS_LOG_CANDIDATES:
        if os.path.isfile(p):
            return p
    return DUCKDNS_LOG_CANDIDATES[0]

def get_duckdns_status():
    domain = "cminewar"
    token = ""
    if os.path.isfile(DUCKDNS_SCRIPT):
        try:
            with open(DUCKDNS_SCRIPT, "r", encoding="utf-8") as f:
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
    if os.path.isfile(DUCKDNS_IP_CACHE):
        try:
            with open(DUCKDNS_IP_CACHE, "r", encoding="utf-8") as f:
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
        "installed": os.path.isfile(DUCKDNS_SCRIPT),
        "domain": domain,
        "full_domain": f"{domain}.duckdns.org",
        "token": token,
        "token_masked": masked_token,
        "last_registered_ip": last_ip,
        "last_log_entry": last_log_line,
        "last_update_time": last_update_time,
        "log_path": log_file,
        "script_path": DUCKDNS_SCRIPT,
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
    if not os.path.isfile(DUCKDNS_SCRIPT):
        return {"success": False, "message": "Script duck.sh no encontrado"}
    try:
        res = subprocess.run(["bash", DUCKDNS_SCRIPT], capture_output=True, text=True, timeout=25)
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

            # Accumulate rolling 2-hour bandwidth history per NIC (at least every 10-15s, pruned to 7200s)
            with NIC_BANDWIDTH_LOCK:
                cutoff_ms = int((now - MAX_NIC_HISTORY_SECONDS) * 1000)
                now_ms = int(now * 1000)
                for nic_item in interfaces_list:
                    n_name = nic_item["name"]
                    n_hist = NIC_BANDWIDTH_HISTORY_2H.setdefault(n_name, [])
                    if not n_hist or (now_ms - n_hist[-1]["t"] >= 10000):
                        n_hist.append({
                            "t": now_ms,
                            "rx": nic_item["rx_bytes_sec"],
                            "tx": nic_item["tx_bytes_sec"]
                        })
                    else:
                        n_hist[-1]["rx"] = max(n_hist[-1]["rx"], nic_item["rx_bytes_sec"])
                        n_hist[-1]["tx"] = max(n_hist[-1]["tx"], nic_item["tx_bytes_sec"])
                        n_hist[-1]["t"] = now_ms
                    
                    while n_hist and n_hist[0]["t"] < cutoff_ms:
                        n_hist.pop(0)
                    
                    nic_item["history_2h"] = list(n_hist)
                    if n_name in interfaces:
                        interfaces[n_name]["history_2h"] = list(n_hist)
            
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
                "interfaces_history_2h": {k: list(v) for k, v in NIC_BANDWIDTH_HISTORY_2H.items()},
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
    "/dispositivos",
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
            f"default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com data: blob:; "
            f"img-src 'self' data: blob: https: http:; "
            f"connect-src 'self' https://api.github.com https://autocomplete.clearbit.com https://cdn.simpleicons.org https://www.google.com ws: wss: https://*.cminewar.duckdns.org https://*.duckdns.org; "
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
            base_payload["maps_api_key"] = os.environ.get("VITE_GOOGLE_MAPS_API_KEY") or os.environ.get("GOOGLE_MAPS_API_KEY") or ""
            base_payload["version_info"] = get_version_info(force_refresh=False)
            base_payload["version_info"]["public_domain"] = req_domain
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

        # 2. LISTADO DE DISPOSITIVOS EMPAREJADOS
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
                for k, v in devices.items():
                    dev_id = v.get("id") or k
                    dev_list.append({
                        "id": dev_id,
                        "name": v.get("name", "Dispositivo"),
                        "first_seen": v.get("first_seen", ""),
                        "last_seen": v.get("last_seen", ""),
                        "local_ip": v.get("local_ip", ""),
                        "last_external_ip": v.get("last_external_ip", ""),
                        "verified_in_lan": v.get("verified_in_lan", True),
                        "trusted": v.get("trusted", True),
                        "is_current": (dev_id == caller_dev_id)
                    })
            resp = json.dumps(dev_list).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
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
                dev_id = f"dev_{secrets.token_hex(6)}"
                new_token = create_device_token(dev_id)
                now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                device_name = parse_user_agent(ua) + " (Desbloqueo Remoto)"
                
                with TRUST_LOCK:
                    devices = load_trusted_devices()
                    devices[dev_id] = {
                        "id": dev_id,
                        "name": device_name,
                        "first_seen": now_iso,
                        "last_seen": now_iso,
                        "local_ip": f"Externo ({client_ip})",
                        "last_external_ip": client_ip,
                        "user_agent": ua[:150],
                        "verified_in_lan": True,
                        "trusted": True
                    }
                    save_trusted_devices(devices)
                    
                resp = json.dumps({"success": True, "token": new_token, "message": "Dispositivo emparejado con éxito"}).encode('utf-8')
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

        # 2. Revocación individual de dispositivo
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
                found = False
                if dev_id in devices:
                    del devices[dev_id]
                    found = True
                else:
                    # Búsqueda por si dev_id estuviese anidado
                    for k in list(devices.keys()):
                        if devices[k].get('id') == dev_id:
                            del devices[k]
                            found = True
                            break
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

        # 2b. Revocación de todos los demás dispositivos (Pánico / Reset)
        elif self.path == "/api/auth/revoke_all_others":
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
                    if caller_dev_id and cur_id == caller_dev_id:
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

            if target_ip in ["127.0.0.1", "::1", "192.168.50.2", SERVER_LOCAL_IP]:
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
        elif self.path in ("/api/dns/duckdns/update", "/api/duckdns/update"):
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
        elif self.path.split('?')[0] == "/api/custom-logos":
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
        elif self.path.split('?')[0] in ("/api/net/geoip/resolve", "/api/net/geoip"):
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
    
    server_address = ('127.0.0.1', port)
    httpd = ThreadingHTTPServer(server_address, DashboardHTTPHandler)
    print(f"[+] Monitor de Sistema iniciado en http://127.0.0.1:{port} con Zero-Trust Pairing y Monitor Wi-Fi")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
