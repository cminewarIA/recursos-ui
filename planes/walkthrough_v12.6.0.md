# Walkthrough y Verificación Final · Recursos Cockpit v12.6.0

## Resumen del Cambio (`MINOR`: `12.5.1` → `12.6.0`)
Se ha implementado compatibilidad nativa integral con **Android TV / Leanback** en la aplicación Android y en la interfaz React 19, junto con el sistema de compilación y despliegue simultáneo **Ordenador (`.deb`) + Android TV (`.apk` vía ADB)** libre de hardcoding.

## Cambios Implementados

1. **Manifiesto, Banner Oficial y Telemetría Android TV (`android_app/`)**:
   - `android_app/app/src/main/AndroidManifest.xml`: añadido `android.software.leanback`, `android.hardware.touchscreen` y `android.hardware.wifi` con `android:required="false"`, banner oficial `@drawable/tv_banner`, `configChanges` con `uiMode|keyboard|keyboardHidden|navigation` y categoría `<category android:name="android.intent.category.LEANBACK_LAUNCHER" />` en `MainActivity`.
   - `android_app/app/src/main/res/drawable-xhdpi/tv_banner.png`: generado en `640×360` PNG (`73K`) siguiendo la estética SVG oficial de Recursos Cockpit.
   - `android_app/app/src/main/java/com/cminewar/recursoscockpit/data/ApiService.kt`: detección dinámica `isTelevisionDevice()` por `UiModeManager` y `PackageManager`; mantiene `clientType = "android_native"` (con `FULL_NATIVE_ACCESS`) e informa `chassisType = "Android TV / Smart TV"`, `clientLabel = "App Nativa Android TV (.apk)"` y marcador `; AndroidTV` en `User-Agent`.
   - `android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt`:
     - `detectTelevisionMode(context)` en Jetpack Compose y método JS `@JavascriptInterface fun isTelevision()`.
     - Ajuste de overscan/zona segura en barra superior (`28.dp` horizontales en TV), indicadores de foco D-Pad (`focusable()` + `onFocusChanged` con anillo cian/blanco) en botones de reconexión, `WebView` focuseable con `textZoom = 110`, atajos de recarga (`KEYCODE_MENU` / `KEYCODE_MEDIA_PLAY_PAUSE`) e inyección de `window.__RECURSOS_ANDROID_TV__` + `<html data-tv="true">`.

2. **Soporte D-Pad y Foco Espacial en Frontend (`src/`)**:
   - `src/types/telemetry.ts` y `src/utils/api.ts`: tipado de `RecursosAndroidBridge` y detección `isAndroidTv` en `detectNativeEnvironment()`.
   - `src/components/MotionPrimitives.tsx`: `BentoCard` interactiva expone `role="button"`, `tabIndex={0}` y manejo `Enter` / `Espacio`.
   - `src/App.tsx` y `src/index.css`: sincronización de `<html data-tv="true">`, desplazamiento automático suave `focusin` (`scrollIntoView`) y anillo de foco cian de alto contraste `[data-tv="true"] :focus-visible`.

3. **Automatización Simultánea Ordenador + Android TV (`packaging/`) y Reglas**:
   - `packaging/build_apk.sh`: detección dinámica del Android SDK (`/opt/android-sdk`), compilación Gradle `assembleRelease` firmada con keystore permanente, salida en `dist/recursos-cockpit_12.6.0.apk` (+ symlink `dist/recursos-cockpit.apk`) y actualización firmada de `dist/SHA256SUMS.txt`.
   - `packaging/install_tv_apk.sh`: escaneo dinámico Zero-Hardcoding de vecinos IPv4 activos (`ip -4 neigh`) en puerto ADB `:5555` + dispositivos ADB conectados, verificación por `ro.build.characteristics` / `pm list features` (`tv` / `leanback` / `television`) e instalación `adb -s <serial> install -r -d`.
   - `packaging/install_all.sh`: orquesta `build_deb.sh` + `sudo apt-get install --reinstall` + `/usr/bin/recursos-cockpit --test-mode` + `build_apk.sh` + `install_tv_apk.sh`, restaurando `packaging/keys/recursos-cockpit-signing-key.asc` si procede.
   - Actualizados `GEMINI.md` (Regla 5), `cockpit-release/SKILL.md`, `plugin.json`, `VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `server.py`, `src/App.tsx`, `src/components/MoreView.tsx`, `src/utils/formatters.ts`, `docs/assets/*.svg`, `static/manual.html`, `docs/index.html` y `README.md`.

## Verificaciones Ejecutadas Tras los Cambios

- **Paridad Manual + Estático + Frontend + Python**:
  - `sha256sum static/manual.html docs/index.html` → idéntico (`a754599865adeb6ce9875c3733bee66efc6960bd165d58fb5f01d92afbb33459`).
  - `node --check` sobre el JavaScript de `static/manual.html` → `manual.html JS syntax OK`.
  - `npx tsc --noEmit && npm run build && python3 -m py_compile server.py desktop_app/recursos_app.py` → exit `0`.
  - Auditoría Zero-Hardcoding (`rg -in "192\.168\.|\btcl\b|\btlc\b"`): cero referencias a IPs fijas ni marcas en código o scripts.
- **Compilación e Instalación Simultánea (`bash packaging/install_all.sh`)**:
  - **Ordenador Linux (`.deb`)**:
    - Generado `dist/recursos-cockpit_12.6.0_amd64.deb` firmado GPG (`4CFC86D58E9146AE`).
    - `dpkg -l | grep recursos-cockpit` → `ii  recursos-cockpit 12.6.0 amd64`.
    - `/usr/bin/recursos-cockpit --test-mode` → `[OK] Recursos Native Ubuntu HTML5 App v12.6.0 validated successfully` + `dex_unlocked: True`.
  - **Android TV (`.apk` vía ADB)**:
    - Compilación Gradle release completada en `1m 7s` (`dist/recursos-cockpit_12.6.0.apk`, `SHA256SUMS.txt` y `SHA256SUMS.txt.asc` actualizados).
    - Descubierta dinámicamente en LAN `TCL Percee TV (SDK 26 · 192.168.50.187:5555)` → `Success`.
    - `dumpsys package com.cminewar.recursoscockpit` → `versionCode=120600 minSdk=26 targetSdk=34 versionName=12.6.0` con `android.intent.category.LEANBACK_LAUNCHER` resuelto hacia `com.cminewar.recursoscockpit/.MainActivity`.
    - Arranque verificado (`am start -W`): `Status: ok`, proceso activo `PID 17188`, registrado en `/api/auth/devices` con `chassis_type: "Android TV / Smart TV"`, `app_version: "12.6.0"`, `access_level: "FULL_NATIVE_ACCESS"`, `verified_in_lan: true`.
- **Servicio Web de Producción (`:8085`)**:
  - `system-dashboard.service` reiniciado y activo en `/home/servidor/servicios/dashboard`.
  - `recursos_history.db` intacta: inodo `1049392` (`68296704` bytes).
  - HTTP `200` verificado en `/api/version` (`"version": "12.6.0"`), `/` (`582971` B), `/manual` (`93748` B), `/readme` (`93748` B), `/download/recursos-cockpit.apk` (`11906126` B) y `/download/recursos-cockpit.deb` (`3925368` B).

