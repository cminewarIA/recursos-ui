# Walkthrough y Verificación v9.4.0 — Identificación Total de Dispositivos Nativos y Panel de Identidad en Seguridad

## 1. Resumen de Cambios (`v9.4.0`)
1. **Telemetría de Acceso Total en App Nativa Ubuntu (`desktop_app/recursos_app.py`)**:
   - Se implementó `collect_native_device_telemetry()` leyendo dinámicamente `/sys/devices/virtual/dmi/id/*`, `/etc/os-release`, `/proc/cpuinfo`, `lspci`, `psutil` (CPU, RAM, disco raíz, batería e interfaces de red con IP y MAC) y `Gdk.Screen` (resolución física), generando una huella determinista `ubn_<hash>` a partir de `/etc/machine-id`.
   - El puente local `LocalHtmlBridgeServer` y `ServerConnectionManager` adjuntan `X-Device-Telemetry` (Base64 JSON) en cada petición, exponen `GET /api/native/device-info` e inyectan `window.__RECURSOS_NATIVE_DEVICE_INFO__` en el contenedor `WebKit2.WebView`.
2. **Telemetría de Acceso Total en App Nativa Android (`android_app/`)**:
   - Se añadió `NativeDeviceTelemetry` en `Models.kt` y `collectDeviceTelemetry()` en `ApiService.kt` extrayendo `Build.MANUFACTURER`, `Build.BRAND`, `Build.MODEL`, `Build.DEVICE`, `Build.BOARD`, `Build.SOC_MANUFACTURER`, `Build.SOC_MODEL`, `Build.VERSION.RELEASE`, `Build.VERSION.SDK_INT`, `Build.VERSION.SECURITY_PATCH`, `Build.SUPPORTED_ABIS`, RAM total (`ActivityManager.MemoryInfo`), almacenamiento interno (`StatFs`), batería (`BatteryManager`), resolución y DPI (`DisplayMetrics`), IP local, interfaz y MAC (`NetworkInterface`) y huella `and_<hash>` (`Settings.Secure.ANDROID_ID`).
   - `RecursosAndroidBridge` (`MainActivity.kt`) expone `@JavascriptInterface fun getDeviceTelemetryJson(): String` e inyecta la telemetría en el `WebView` (`CockpitDashboard.kt`).
3. **Backend Zero-Trust y Deduplicación por Hardware ID (`server.py` & `vite.config.ts`)**:
   - Se añadieron `extract_header_telemetry()`, `enrich_device_entry()`, deduplicación por `hardware_id` en `check_trust_status()` y los endpoints `POST /api/auth/register-device` y `POST /api/auth/rename-device`.
4. **Panel de Identidad de Dispositivos en `/seguridad` (`index.html` & `static/index.html`)**:
   - Se integró la sección `#secZeroTrustDevicesSection` en la vista de Seguridad (`/seguridad`) y se actualizó el modal Zero-Trust para mostrar filtros por tipo de cliente (`Todos`, `⚡ Apps Nativas`, `🌐 Web`), KPIs en vivo, edición de alias personalizado (`✏️ Alias`) y tarjetas de 6 celdas con todas las especificaciones técnicas del dispositivo.

## 2. Verificación Técnica
- **Sincronización Canónica (`VERSION` = `9.4.0`)**: Verificada en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
- **Modo Test de App Nativa Ubuntu (`--test-mode`)**: Comprobada la recolección real de `NativeDeviceTelemetry` y la compilación del paquete Debian `dist/recursos-cockpit_9.4.0_amd64.deb`.
- **Compilación y Linting**: Verificado con `lint_applet` y `compile_applet` sin errores.
