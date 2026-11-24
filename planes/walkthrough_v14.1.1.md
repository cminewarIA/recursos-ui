# Walkthrough v14.1.1 — Corrección de Descarga/Actualización de APK Android y Caché WebView

## Diagnóstico
1. **Entrega de APK obsoleta desde `server.py`**: `/download/recursos-cockpit.apk` (y `/download/recursos-cockpit.deb`) buscaba `dist/recursos-cockpit_<version>.apk` y, al no encontrarlo localmente en el servidor, caía en `glob("dist/recursos-cockpit_*.apk")` sirviendo cualquier APK antigua que permaneciera en `dist/` (por ejemplo `12.16`) con cabecera `Content-Disposition` renombrada a la versión actual, sin redirigir nunca a GitHub Releases.
2. **Symlink antiguo en `packaging/install_tv_apk.sh`**: si no existía `dist/recursos-cockpit_${VERSION}.apk`, caía en `dist/recursos-cockpit.apk` aunque apuntara a una APK anterior.
3. **Sin poda de APKs obsoletos en OTA**: `execute_github_update()` no eliminaba `dist/recursos-cockpit_*.apk` caducados tras actualizar de versión.
4. **Cliente Android sin detección de nueva APK ni invalidación de caché**: `CockpitDashboard.kt` usaba `WebSettings.LOAD_DEFAULT`, no limpiaba caché al detectar nueva versión del servidor, no tenía `DownloadListener` para descargas lanzadas desde el WebView y `MoreView.tsx` ocultaba el botón de descarga `.apk` dentro de la app Android.

## Cambios Aplicados
- **`server.py`**:
  - `/download/recursos-cockpit.apk` y `/download/recursos-cockpit.deb` solo sirven el artefacto local si coincide exactamente con la versión activa (`VERSION`); en caso contrario redirigen (`302`, `Cache-Control: no-store`) a la release oficial exacta en GitHub (`v<VERSION>`).
  - Durante OTA se eliminan APKs y symlinks caducados en `dist/` que no correspondan a la versión activa.
- **`packaging/install_tv_apk.sh`**:
  - Si no existe la APK exacta de `VERSION` en `dist/`, descarga automáticamente la APK oficial firmada `v${VERSION}` desde GitHub Releases en lugar de reutilizar un symlink antiguo.
- **`android_app/` (`SecurePreferences.kt`, `Models.kt`, `ApiService.kt`, `MainActivity.kt`, `CockpitDashboard.kt`)**:
  - `WebSettings.LOAD_NO_CACHE`, cabeceras `Cache-Control: no-cache` y `clearCache(true)` automático al detectar un cambio de versión del servidor.
  - `setDownloadListener` nativo para abrir descargas de `.apk` en el gestor del sistema.
  - Comparación SemVer entre la versión del servidor y `BuildConfig.VERSION_NAME` con aviso discreto Alethia in-app y botón directo **Actualizar**.
- **`src/components/MoreView.tsx`** e **`i18n/dictionary.csv`**:
  - Tarjeta de descarga Android `.apk` visible también desde la propia app Android con insignia `v<instalada> → v<actual>` cuando la APK instalada queda atrás.
  - Claves `native_android.apk_update_title` y `native_android.apk_update_action` registradas en los 31 idiomas.

## Verificación
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`
- Integridad de `./i18n/dictionary.csv` (31 idiomas, 33 columnas exactas)
- `npm run build` (`static/index.html` regenerado a `v14.1.1`)
- `bash packaging/build_deb.sh` (`dist/recursos-cockpit_14.1.1_amd64.deb` firmado)
- `compile_applet` + `lint_applet`
