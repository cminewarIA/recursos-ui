#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Compilación de APK Release Firmada (Android + Android TV)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PKG_NAME="recursos-cockpit"
VERSION="$(tr -d '[:space:]' < "$PROJECT_ROOT/ANDROID_VERSION")"
ANDROID_DIR="$PROJECT_ROOT/android_app"
OUTPUT_DIR="$PROJECT_ROOT/dist"

echo "============================================================"
echo "📱 Construyendo APK Android / Android TV: ${PKG_NAME}_${VERSION}.apk"
echo "============================================================"

if [ ! -d "$ANDROID_DIR" ]; then
    echo "❌ No se encuentra el directorio Android: $ANDROID_DIR" >&2
    exit 1
fi

# Detección dinámica del Android SDK (Zero-Hardcoding)
SDK_CANDIDATES=()
[ -n "${ANDROID_HOME:-}" ] && SDK_CANDIDATES+=("$ANDROID_HOME")
[ -n "${ANDROID_SDK_ROOT:-}" ] && SDK_CANDIDATES+=("$ANDROID_SDK_ROOT")
SDK_CANDIDATES+=("$HOME/Android/Sdk" "/opt/android-sdk" "/usr/lib/android-sdk")

DETECTED_SDK=""
for candidate in "${SDK_CANDIDATES[@]}"; do
    if [ -d "$candidate/platforms" ]; then
        DETECTED_SDK="$candidate"
        break
    fi
done

if [ -z "$DETECTED_SDK" ]; then
    echo "❌ No se detectó un Android SDK válido. Define ANDROID_HOME o instala en /opt/android-sdk." >&2
    exit 1
fi

export ANDROID_HOME="$DETECTED_SDK"
export ANDROID_SDK_ROOT="$DETECTED_SDK"
echo "🔍 Android SDK detectado en: $ANDROID_HOME"

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/${PKG_NAME}_*.apk "$OUTPUT_DIR"/${PKG_NAME}.apk

pushd "$ANDROID_DIR" >/dev/null
if command -v gradle >/dev/null 2>&1; then
    gradle --no-daemon assembleRelease
elif [ -f "$ANDROID_DIR/gradlew" ]; then
    bash "$ANDROID_DIR/gradlew" --no-daemon assembleRelease
else
    echo "❌ No se encontró ni 'gradle' ni 'gradlew' en $ANDROID_DIR" >&2
    popd >/dev/null
    exit 1
fi
popd >/dev/null

APK_BUILT="$(find "$ANDROID_DIR/app/build/outputs/apk/release" -maxdepth 1 -type f -name "*.apk" ! -name "*unsigned*" | head -n 1 || true)"
if [ -z "$APK_BUILT" ] || [ ! -f "$APK_BUILT" ]; then
    echo "❌ No se encontró la APK release compilada en $ANDROID_DIR/app/build/outputs/apk/release/" >&2
    exit 1
fi

APK_OUT="$OUTPUT_DIR/${PKG_NAME}_${VERSION}.apk"
cp -f "$APK_BUILT" "$APK_OUT"
ln -sf "${PKG_NAME}_${VERSION}.apk" "$OUTPUT_DIR/${PKG_NAME}.apk"

# Actualizar SHA256SUMS.txt manteniendo .deb y .apk versionados en dist/
cd "$OUTPUT_DIR"
SHA_TARGETS=()
for f in ${PKG_NAME}_*_amd64.deb ${PKG_NAME}_*.apk; do
    [ -f "$f" ] && SHA_TARGETS+=("$f")
done
if [ "${#SHA_TARGETS[@]}" -gt 0 ]; then
    sha256sum "${SHA_TARGETS[@]}" > "SHA256SUMS.txt"
    if command -v python3 >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/sign_deb.py" ]; then
        python3 "$SCRIPT_DIR/sign_deb.py" --sha-only "$OUTPUT_DIR/SHA256SUMS.txt"
    fi
fi

echo "============================================================"
echo "✅ APK compilada y firmada correctamente:"
echo "   -> $APK_OUT"
echo "   -> $OUTPUT_DIR/${PKG_NAME}.apk (symlink canónico)"
echo "   -> $OUTPUT_DIR/SHA256SUMS.txt"
echo "============================================================"

