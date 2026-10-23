#!/usr/bin/env bash
set -e

# ==============================================================================
# Script de Instalación Rápida de Paquetes de Compilación (Offline-First)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEBIAN_DIR="$PACKAGES_DIR/debian"

echo "⚡ [PACKAGES] Comprobando entorno de compilación Linux..."

# 1. Comprobar si las herramientas básicas de compilación ya están instaladas
if command -v dpkg-deb >/dev/null 2>&1 && command -v dpkg-architecture >/dev/null 2>&1 && command -v as >/dev/null 2>&1; then
    echo "✅ [PACKAGES] Todas las herramientas de compilación (.deb / binutils) ya están instaladas y operativas."
    exit 0
fi

echo "📦 [PACKAGES] Instalando paquetes de compilación desde caché local offline ($DEBIAN_DIR)..."

# 2. Intentar instalación offline directa desde la carpeta packages/debian/
if [ -d "$DEBIAN_DIR" ] && compgen -G "$DEBIAN_DIR/*.deb" > /dev/null; then
    if sudo dpkg -i --force-depends "$DEBIAN_DIR"/*.deb >/dev/null 2>&1; then
        echo "✅ [PACKAGES] Paquetes locales instalados con éxito."
        # Resolver dependencias menores si faltara alguna
        sudo apt-get install -f -y >/dev/null 2>&1 || true
    else
        echo "⚠️ [PACKAGES] Fallo parcial en dpkg local; resolviendo dependencias con apt-get..."
        sudo apt-get install -f -y || sudo apt-get install -y dpkg-dev binutils
    fi
else
    echo "⚠️ [PACKAGES] No se encontraron archivos .deb en $DEBIAN_DIR. Instalando vía repositorio..."
    sudo apt-get update -y && sudo apt-get install -y dpkg-dev binutils
fi

echo "✅ [PACKAGES] Entorno de compilación Linux listo."
