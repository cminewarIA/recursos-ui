#!/usr/bin/env bash
set -e

# ==============================================================================
# Script de Construcción de Paquete Debian (.deb) para Recursos Cockpit & DeX
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PKG_NAME="recursos-cockpit"
VERSION="$(cat "$PROJECT_ROOT/VERSION" | tr -d '[:space:]')"
ARCH="amd64"
BUILD_DIR="$PROJECT_ROOT/build_deb"
OUTPUT_DIR="$PROJECT_ROOT/dist"
PKG_DIR="$BUILD_DIR/${PKG_NAME}_${VERSION}_${ARCH}"

echo "============================================================"
echo "📦 Construyendo paquete Debian: ${PKG_NAME}_${VERSION}_${ARCH}.deb"
echo "============================================================"

# Limpiar compilaciones previas y paquetes obsoletos
rm -rf "$BUILD_DIR"
mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/*.deb
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/usr/lib/$PKG_NAME"
mkdir -p "$PKG_DIR/usr/lib/$PKG_NAME/assets"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/scalable/apps"

# 1. Copiar metadatos de DEBIAN
cp "$SCRIPT_DIR/debian/control" "$PKG_DIR/DEBIAN/control"
cp "$SCRIPT_DIR/debian/postinst" "$PKG_DIR/DEBIAN/postinst"
cp "$SCRIPT_DIR/debian/prerm" "$PKG_DIR/DEBIAN/prerm"
cp "$SCRIPT_DIR/debian/postrm" "$PKG_DIR/DEBIAN/postrm"
chmod 755 "$PKG_DIR/DEBIAN/postinst" "$PKG_DIR/DEBIAN/prerm" "$PKG_DIR/DEBIAN/postrm"

# Ajustar versión en DEBIAN/control
sed -i "s/^Version:.*/Version: $VERSION/" "$PKG_DIR/DEBIAN/control"

# 2. Copiar archivos de la aplicación y punto único de verdad de versión
cp "$PROJECT_ROOT/desktop_app/recursos_app.py" "$PKG_DIR/usr/lib/$PKG_NAME/recursos_app.py"
cp "$PROJECT_ROOT/desktop_app/dex_controller.py" "$PKG_DIR/usr/lib/$PKG_NAME/dex_controller.py"
cp "$PROJECT_ROOT/desktop_app/assets/"* "$PKG_DIR/usr/lib/$PKG_NAME/assets/"
cp "$PROJECT_ROOT/VERSION" "$PKG_DIR/usr/lib/$PKG_NAME/VERSION"
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME"/*.py
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME"/VERSION
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME/assets"/*

# 3. Crear lanzador en /usr/bin/recursos-cockpit
cat << 'EOF' > "$PKG_DIR/usr/bin/recursos-cockpit"
#!/usr/bin/env bash
export PYTHONUNBUFFERED=1
APP_DIR="/usr/lib/recursos-cockpit"
if [ ! -d "$APP_DIR" ]; then
    APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib/recursos-cockpit" && pwd)"
fi
exec python3 "$APP_DIR/recursos_app.py" "$@"
EOF
chmod 755 "$PKG_DIR/usr/bin/recursos-cockpit"

# 4. Copiar entrada de escritorio (.desktop) e iconos oficiales multirresolución
cp "$PROJECT_ROOT/desktop_app/recursos-cockpit.desktop" "$PKG_DIR/usr/share/applications/recursos-cockpit.desktop"
chmod 644 "$PKG_DIR/usr/share/applications/recursos-cockpit.desktop"

mkdir -p "$PKG_DIR/usr/share/pixmaps"
cp "$PROJECT_ROOT/desktop_app/assets/recursos-cockpit.png" "$PKG_DIR/usr/share/pixmaps/recursos-cockpit.png"
chmod 644 "$PKG_DIR/usr/share/pixmaps/recursos-cockpit.png"

for S in 16 32 48 64 128 256 512; do
    mkdir -p "$PKG_DIR/usr/share/icons/hicolor/${S}x${S}/apps"
    if [ -f "$PROJECT_ROOT/desktop_app/assets/recursos-cockpit-${S}.png" ]; then
        cp "$PROJECT_ROOT/desktop_app/assets/recursos-cockpit-${S}.png" "$PKG_DIR/usr/share/icons/hicolor/${S}x${S}/apps/recursos-cockpit.png"
    else
        cp "$PROJECT_ROOT/desktop_app/assets/recursos-cockpit.png" "$PKG_DIR/usr/share/icons/hicolor/${S}x${S}/apps/recursos-cockpit.png"
    fi
    chmod 644 "$PKG_DIR/usr/share/icons/hicolor/${S}x${S}/apps/recursos-cockpit.png"
done

cp "$PROJECT_ROOT/desktop_app/assets/recursos-cockpit.svg" "$PKG_DIR/usr/share/icons/hicolor/scalable/apps/recursos-cockpit.svg"
chmod 644 "$PKG_DIR/usr/share/icons/hicolor/scalable/apps/recursos-cockpit.svg"

# 5. Generar paquete .deb
dpkg-deb --build --root-owner-group "$PKG_DIR" "$OUTPUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"
cd "$OUTPUT_DIR"
ln -sf "${PKG_NAME}_${VERSION}_${ARCH}.deb" "${PKG_NAME}.deb"

# 6. Generar sumas de verificación SHA256
sha256sum "${PKG_NAME}_${VERSION}_${ARCH}.deb" > "SHA256SUMS.txt"

echo "============================================================"
echo "✅ Paquete generado exitosamente:"
echo "   -> $OUTPUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"
echo "   -> $OUTPUT_DIR/${PKG_NAME}.deb (symlink canónico)"
echo "   -> $OUTPUT_DIR/SHA256SUMS.txt"
echo "============================================================"
