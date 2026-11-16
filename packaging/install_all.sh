#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Instalación Simultánea Ordenador Linux (.deb) + Android TV (.apk vía ADB)
# Regla de proyecto: cada vez que se instale en el ordenador, se compila e
# instala automáticamente la versión sincronizada en Android TV en la LAN.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$PROJECT_ROOT/VERSION")"
KEY_ASC="$PROJECT_ROOT/packaging/keys/recursos-cockpit-signing-key.asc"

echo "============================================================"
echo "🚀 Despliegue Unificado v${VERSION}: Ordenador (.deb) + Android TV (.apk)"
echo "============================================================"

# 1. Compilar e instalar paquete nativo Linux (.deb) en el ordenador
bash "$SCRIPT_DIR/build_deb.sh"
DEB_FILE="$PROJECT_ROOT/dist/recursos-cockpit_${VERSION}_amd64.deb"
echo "📥 Instalando paquete Debian local: $DEB_FILE"
sudo apt-get install --reinstall -y "$DEB_FILE"

echo "🧪 Verificando binario Linux instalado..."
/usr/bin/recursos-cockpit --test-mode
dpkg -l | grep recursos-cockpit

# 2. Compilar APK release firmada y desplegar automáticamente en Android TV (LAN ADB)
bash "$SCRIPT_DIR/build_apk.sh"
bash "$SCRIPT_DIR/install_tv_apk.sh" "$PROJECT_ROOT/dist/recursos-cockpit_${VERSION}.apk"

# Preservar clave ASCII pública limpia si build_deb la regeneró en Git
if command -v git >/dev/null 2>&1 && git -C "$PROJECT_ROOT" ls-files --error-unmatch "$KEY_ASC" >/dev/null 2>&1; then
    if ! git -C "$PROJECT_ROOT" diff --quiet -- "$KEY_ASC"; then
        git -C "$PROJECT_ROOT" checkout -- "$KEY_ASC" 2>/dev/null || true
    fi
fi

echo "============================================================"
echo "🎉 Ordenador (.deb) y Android TV (.apk) actualizados a v${VERSION}"
echo "============================================================"

