#!/usr/bin/env bash
set -e

# ==============================================================================
# Script de Verificación del Entorno de Compilación (Linux & Android)
# ==============================================================================

echo "============================================================"
echo "🔍 Verificando Herramientas de Compilación del Sistema"
echo "============================================================"

# 1. Herramientas Linux (.deb)
echo -n "  -> dpkg-deb: "
if command -v dpkg-deb >/dev/null 2>&1; then
    echo "OK ($(dpkg-deb --version | head -n 1))"
else
    echo "FALTANTE"
fi

echo -n "  -> dpkg-architecture: "
if command -v dpkg-architecture >/dev/null 2>&1; then
    echo "OK ($(dpkg-architecture -qDEB_BUILD_ARCH))"
else
    echo "FALTANTE"
fi

echo -n "  -> binutils (as/ld): "
if command -v as >/dev/null 2>&1 && command -v ld >/dev/null 2>&1; then
    echo "OK ($(ld --version | head -n 1))"
else
    echo "FALTANTE"
fi

# 2. Herramientas Android (.apk)
echo -n "  -> Java JDK: "
if command -v java >/dev/null 2>&1; then
    echo "OK ($(java -version 2>&1 | head -n 1))"
else
    echo "FALTANTE"
fi

echo -n "  -> Gradle Wrapper: "
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$ROOT_DIR/android_app/gradlew" ]; then
    echo "OK (android_app/gradlew presente)"
else
    echo "FALTANTE"
fi

echo "============================================================"
echo "✅ Diagnóstico de Compilación Finalizado"
echo "============================================================"
