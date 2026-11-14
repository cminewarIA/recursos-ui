# Plan de Implementación v12.6.0 (`MINOR`) — Compatibilidad Android TV (Leanback / D-Pad) y Despliegue Simultáneo Ordenador + Smart TV

## 1. Objetivo y Justificación SemVer
- **Versión anterior**: `12.5.1`
- **Versión objetivo**: **`12.6.0`** (`MINOR`, por incorporación de una nueva funcionalidad mayor de plataforma: compatibilidad completa Android TV + flujo automatizado de compilación APK y despliegue simultáneo en Smart TV vía ADB cada vez que se instala en el ordenador).
- **Principio Zero-Hardcoding (`GEMINI.md` Regla 1)**: Toda detección de televisores Android TV (tanto dentro de la APK mediante `UiModeManager`/`PackageManager` como desde los scripts LAN vía tabla ARP `ip neigh` + puerto ADB TCP `5555` + `getprop ro.build.characteristics` / `pm list features`) es 100 % dinámica, sin fijar IPs, nombres ni marcas de fabricante en el código ni en los scripts.

## 2. Arquitectura y Cambios Realizados

### 2.1. Aplicación Nativa Android + Android TV (`android_app/`)
1. **`android_app/app/src/main/AndroidManifest.xml`**:
   - Declaración de `android.software.leanback`, `android.hardware.touchscreen` y `android.hardware.wifi` con `android:required="false"` para compatibilidad universal con móviles, tablets, Ethernet-only y Android TV (`SDK 26+`).
   - Banner oficial Android TV (`android:banner="@drawable/tv_banner"`).
   - `configChanges` extendido con `uiMode|keyboard|keyboardHidden|navigation`.
   - Intent filter `<category android:name="android.intent.category.LEANBACK_LAUNCHER" />` en `MainActivity`.
2. **Banner Oficial (`android_app/app/src/main/res/drawable-xhdpi/tv_banner.png`)**:
   - Generado en `640x360` PNG siguiendo la estética SVG oficial de Recursos Cockpit.
3. **Telemetría Nativa TV (`ApiService.kt`)**:
   - Detección dinámica `isTelevisionDevice(context)`.
   - Mantiene `client_type = "android_native"` (conservando privilegios `FULL_NATIVE_ACCESS` en `server.py`) e informa dinámicamente `client_label = "App Nativa Android TV (.apk)"`, `chassis_type = "Android TV / Smart TV"` y `; AndroidTV` en `User-Agent`.
4. **Navegación D-Pad, Overscan y Puente TV (`CockpitDashboard.kt`)**:
   - `detectTelevisionMode(context)` en Jetpack Compose.
   - Zona segura/overscan en la barra superior (`28.dp` horizontal en TV), foco D-Pad visible (`focusable()` + `onFocusChanged` con anillo cian) en botones **Volver a conectar** y **Reconectar (REVOKED)**.
   - `WebView` focuseable con `textZoom = 110` en TV, soporte de teclado/mando (`KEYCODE_MENU` / `KEYCODE_MEDIA_PLAY_PAUSE` para recargar), método JS `@JavascriptInterface fun isTelevision()` e inyección automática de `window.__RECURSOS_ANDROID_TV__` y atributo `<html data-tv="true">`.

### 2.2. Navegación D-Pad y Foco en la SPA React 19 (`src/`)
- `src/types/telemetry.ts` y `src/utils/api.ts`: tipado de `RecursosAndroidBridge` y detección `isAndroidTv` en `detectNativeEnvironment()`.
- `src/components/MotionPrimitives.tsx`: `BentoCard` interactiva con `role="button"`, `tabIndex={0}` y soporte `Enter` / `Espacio` para mando D-Pad.
- `src/App.tsx`: sincronización automática de `<html data-tv="true">` y `focusin` -> `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`.
- `src/index.css`: anillo de foco cian de alto contraste `[data-tv="true"] :focus-visible` y margen de desplazamiento seguro respecto a la barra superior.

### 2.3. Automatización Ordenador (`.deb`) + Android TV (`.apk`)
- `packaging/build_apk.sh`: detecta dinámicamente el Android SDK (`ANDROID_HOME`, `/opt/android-sdk`, `$HOME/Android/Sdk`), compila la APK release firmada con `gradle`/`gradlew assembleRelease`, publica `dist/recursos-cockpit_${VERSION}.apk` (+ symlink `dist/recursos-cockpit.apk`) y actualiza `dist/SHA256SUMS.txt` firmado.
- `packaging/install_tv_apk.sh`: escanea vecinos IPv4 activos (`ip -4 neigh`) con puerto `:5555` abierto y dispositivos ADB conectados, filtra aquellos cuyo `ro.build.characteristics` / `pm list features` corresponde a `television` / `leanback`, ejecuta `adb -s <serial> install -r -d <apk>` y verifica `versionName`.
- `packaging/install_all.sh`: ejecuta `build_deb.sh`, `sudo apt-get install --reinstall`, `/usr/bin/recursos-cockpit --test-mode`, `build_apk.sh` e `install_tv_apk.sh` en una única operación.
- Actualización de `GEMINI.md` (Regla 5) y `cockpit-release/SKILL.md`.

## 3. Plan de Verificación
1. `npx tsc --noEmit && npm run build` y `python3 -m py_compile server.py desktop_app/recursos_app.py`.
2. Paridad `sha256sum static/manual.html docs/index.html` y `node --check` sobre el script embebido del manual.
3. Ejecución de `bash packaging/install_all.sh` verificando:
   - Ordenador Linux: `dpkg -l | grep recursos-cockpit` == `12.6.0` y `/usr/bin/recursos-cockpit --test-mode`.
   - Smart TV Android en LAN: detección dinámica vía ADB, `adb install -r -d`, `dumpsys package com.cminewar.recursoscockpit` con `versionName=12.6.0` y arranque limpio (`am start`).
4. Despliegue limpio en `/home/servidor/servicios/dashboard/` preservando inodo de `recursos_history.db`, reinicio de `system-dashboard.service` y comprobación HTTP `200` de `/api/version` y `/download/recursos-cockpit.apk`.

