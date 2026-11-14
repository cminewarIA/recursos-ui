#!/usr/bin/env bash
set -e

# ==============================================================================
# Script de Construcción y Firma de Paquete Debian (.deb) para Recursos Cockpit
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
rm -f "$OUTPUT_DIR"/*.deb "$OUTPUT_DIR"/*.deb.asc
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/usr/lib/$PKG_NAME"
mkdir -p "$PKG_DIR/usr/lib/$PKG_NAME/assets"
mkdir -p "$PKG_DIR/usr/lib/$PKG_NAME/static"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/scalable/apps"
mkdir -p "$PKG_DIR/usr/share/keyrings"

# 1. Copiar metadatos de DEBIAN
cp "$SCRIPT_DIR/debian/control" "$PKG_DIR/DEBIAN/control"
cp "$SCRIPT_DIR/debian/postinst" "$PKG_DIR/DEBIAN/postinst"
cp "$SCRIPT_DIR/debian/prerm" "$PKG_DIR/DEBIAN/prerm"
cp "$SCRIPT_DIR/debian/postrm" "$PKG_DIR/DEBIAN/postrm"
chmod 755 "$PKG_DIR/DEBIAN/postinst" "$PKG_DIR/DEBIAN/prerm" "$PKG_DIR/DEBIAN/postrm"

# Ajustar versión y Replaces dinámico en DEBIAN/control
sed -i "s/^Version:.*/Version: $VERSION/" "$PKG_DIR/DEBIAN/control"
sed -i "s/^Replaces:.*/Replaces: $PKG_NAME (<< $VERSION)/" "$PKG_DIR/DEBIAN/control"

# 2. Copiar archivos de la aplicación, motor HTML5 unificado compilado y versión canónica
cp "$PROJECT_ROOT/desktop_app/recursos_app.py" "$PKG_DIR/usr/lib/$PKG_NAME/recursos_app.py"
cp "$PROJECT_ROOT/desktop_app/dex_controller.py" "$PKG_DIR/usr/lib/$PKG_NAME/dex_controller.py"
if [ -f "$PROJECT_ROOT/static/index.html" ]; then
    cp "$PROJECT_ROOT/static/index.html" "$PKG_DIR/usr/lib/$PKG_NAME/static/index.html"
else
    cp "$PROJECT_ROOT/index.html" "$PKG_DIR/usr/lib/$PKG_NAME/static/index.html"
fi
cp "$PROJECT_ROOT/static/"*.png "$PROJECT_ROOT/static/favicon.ico" "$PKG_DIR/usr/lib/$PKG_NAME/static/" 2>/dev/null || true
cp "$PROJECT_ROOT/desktop_app/assets/"* "$PKG_DIR/usr/lib/$PKG_NAME/assets/"
cp "$PROJECT_ROOT/VERSION" "$PKG_DIR/usr/lib/$PKG_NAME/VERSION"
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME"/*.py
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME"/VERSION
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME/static/"*
chmod 644 "$PKG_DIR/usr/lib/$PKG_NAME/assets"/*

# Incluir clave pública GPG si existe en packaging/keys o generar keyring antes de empacar
if [ -f "$SCRIPT_DIR/keys/recursos-cockpit-signing-key.asc" ] && command -v gpg >/dev/null 2>&1; then
    gpg --dearmor < "$SCRIPT_DIR/keys/recursos-cockpit-signing-key.asc" > "$PKG_DIR/usr/share/keyrings/recursos-cockpit-archive-keyring.gpg" 2>/dev/null || true
    chmod 644 "$PKG_DIR/usr/share/keyrings/recursos-cockpit-archive-keyring.gpg" 2>/dev/null || true
fi

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

# Calcular Installed-Size exacto para compatibilidad con Snap Store / App Center / PackageKit
INSTALLED_SIZE=$(du -sk "$PKG_DIR" | awk '{print $1}')
if ! grep -q "^Installed-Size:" "$PKG_DIR/DEBIAN/control"; then
    sed -i "/^Architecture:/a Installed-Size: $INSTALLED_SIZE" "$PKG_DIR/DEBIAN/control"
else
    sed -i "s/^Installed-Size:.*/Installed-Size: $INSTALLED_SIZE/" "$PKG_DIR/DEBIAN/control"
fi

# 5. Generar paquete .deb con compresión xz (compatible universalmente con snap-store / apt / dpkg)
DEB_OUT="$OUTPUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"
dpkg-deb -Zxz --build --root-owner-group "$PKG_DIR" "$DEB_OUT"

# 6. Firmar el paquete .deb (_gpgorigin + .deb.asc) y calcular sumas SHA256 firmadas
cd "$OUTPUT_DIR"
if command -v python3 >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/sign_deb.py" ]; then
    python3 "$SCRIPT_DIR/sign_deb.py" "$DEB_OUT"
fi
sha256sum "${PKG_NAME}_${VERSION}_${ARCH}.deb" > "SHA256SUMS.txt"
if command -v python3 >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/sign_deb.py" ]; then
    python3 "$SCRIPT_DIR/sign_deb.py" --sha-only "$OUTPUT_DIR/SHA256SUMS.txt"
fi
ln -sf "${PKG_NAME}_${VERSION}_${ARCH}.deb" "${PKG_NAME}.deb"
if [ -f "${DEB_OUT}.asc" ]; then
    ln -sf "${PKG_NAME}_${VERSION}_${ARCH}.deb.asc" "${PKG_NAME}.deb.asc"
fi

echo "============================================================"
echo "✅ Paquete generado y firmado exitosamente:"
echo "   -> $DEB_OUT"
echo "   -> $OUTPUT_DIR/${PKG_NAME}.deb (symlink canónico)"
echo "   -> $OUTPUT_DIR/SHA256SUMS.txt"
echo "============================================================"
