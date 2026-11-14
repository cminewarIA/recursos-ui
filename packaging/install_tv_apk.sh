#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Despliegue Dinámico de APK en Dispositivos Android TV de la LAN (Zero-Hardcoding)
# Descubre automáticamente televisores Android / Leanback accesibles vía ADB
# (USB o ADB sobre TCP/IP en la tabla de vecinos de la LAN) e instala la APK.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION")"
PKG_ID="com.cminewar.recursoscockpit"

APK_PATH="${1:-$PROJECT_ROOT/dist/recursos-cockpit_${VERSION}.apk}"
if [ ! -f "$APK_PATH" ] && [ -f "$PROJECT_ROOT/dist/recursos-cockpit.apk" ]; then
    APK_PATH="$PROJECT_ROOT/dist/recursos-cockpit.apk"
fi

if [ ! -f "$APK_PATH" ]; then
    echo "❌ No se encontró la APK a instalar ($APK_PATH). Ejecuta primero: bash packaging/build_apk.sh" >&2
    exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "⚠️  'adb' no está instalado; omitiendo instalación remota en Android TV."
    exit 0
fi

echo "============================================================"
echo "📺 Descubriendo dispositivos Android TV vía ADB en la LAN..."
echo "============================================================"

adb start-server >/dev/null 2>&1 || true

# Reconectar dispositivos marcados como offline (típico en TCP/IP tras reposo)
while read -r serial state _; do
    [ -z "${serial:-}" ] && continue
    if [ "$state" = "offline" ] && [[ "$serial" == *:* ]]; then
        adb disconnect "$serial" >/dev/null 2>&1 || true
    fi
done < <(adb devices | tail -n +2)

# Descubrimiento dinámico Zero-Hardcoding de puertos ADB (:5555) activos en vecinos LAN
if command -v python3 >/dev/null 2>&1 && command -v ip >/dev/null 2>&1; then
    DISCOVERED_ADB_HOSTS=$(python3 - <<'PY'
import concurrent.futures
import socket
import subprocess

ips = set()
try:
    out = subprocess.check_output(["ip", "-4", "neigh", "show"], text=True, stderr=subprocess.DEVNULL)
    for line in out.splitlines():
        parts = line.split()
        if not parts:
            continue
        state = parts[-1].upper()
        if state in ("FAILED", "INCOMPLETE"):
            continue
        ip = parts[0]
        if ip.count(".") == 3 and not ip.startswith("127.") and not ip.startswith("169.254."):
            ips.add(ip)
except Exception:
    pass

def probe(ip: str):
    try:
        with socket.create_connection((ip, 5555), timeout=0.45):
            return ip
    except OSError:
        return None

if ips:
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        for hit in pool.map(probe, sorted(ips)):
            if hit:
                print(hit)
PY
)
    for host in $DISCOVERED_ADB_HOSTS; do
        target="${host}:5555"
        if ! adb devices | awk 'NR>1 && $2=="device" {print $1}' | grep -qxF "$target"; then
            timeout 5 adb connect "$target" >/dev/null 2>&1 || true
        fi
    done
fi

mapfile -t ACTIVE_SERIALS < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')

if [ "${#ACTIVE_SERIALS[@]}" -eq 0 ]; then
    echo "⚠️  No se detectó ningún dispositivo Android conectado vía ADB (USB/LAN)."
    echo "   Verifica que el televisor esté encendido con Depuración USB/ADB activa."
    exit 0
fi

INSTALLED_COUNT=0
FAILED_COUNT=0

for serial in "${ACTIVE_SERIALS[@]}"; do
    chars="$(timeout 4 adb -s "$serial" shell getprop ro.build.characteristics 2>/dev/null | tr -d '\r' || true)"
    brand="$(timeout 4 adb -s "$serial" shell getprop ro.product.brand 2>/dev/null | tr -d '\r' || true)"
    model="$(timeout 4 adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)"
    sdk="$(timeout 4 adb -s "$serial" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || true)"
    features="$(timeout 5 adb -s "$serial" shell pm list features 2>/dev/null | tr -d '\r' || true)"

    if [[ "$chars" == *tv* ]] || echo "$features" | grep -qE "android\.hardware\.type\.television|android\.software\.leanback"; then
        echo "🎯 Android TV detectada: ${brand:-Android} ${model:-TV} (SDK ${sdk:-?} · ${serial})"
        echo "   Instalando $(basename "$APK_PATH")..."
        if adb -s "$serial" install -r -d "$APK_PATH"; then
            ver_info="$(adb -s "$serial" shell dumpsys package "$PKG_ID" 2>/dev/null | grep -E "versionName|versionCode" | tr -d '\r' | xargs || true)"
            echo "   ✅ Instalada en ${brand:-Android} ${model:-TV}: ${ver_info}"
            INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
        else
            echo "   ❌ Error instalando APK en ${serial}" >&2
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    else
        echo "ℹ️  Dispositivo ADB omitido (no es Android TV): ${brand:-?} ${model:-?} (${serial})"
    fi
done

echo "============================================================"
if [ "$FAILED_COUNT" -gt 0 ]; then
    echo "❌ Falló la instalación en $FAILED_COUNT televisor(es) Android TV." >&2
    exit 1
fi
if [ "$INSTALLED_COUNT" -eq 0 ]; then
    echo "⚠️  Dispositivos ADB revisados, pero ninguno reportó perfil Android TV / Leanback."
else
    echo "✅ APK instalada correctamente en $INSTALLED_COUNT televisor(es) Android TV."
fi
echo "============================================================"

