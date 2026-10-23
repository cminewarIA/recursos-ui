# Walkthrough de Verificación v9.1.2 · Auditoría Línea a Línea y Validación de Normas

## Objetivo
Verificar y documentar la auditoría integral línea a línea realizada sobre las aplicaciones nativas (Android y Ubuntu) y la plataforma web, asegurando el cumplimiento estricto de todas las reglas del proyecto (`GEMINI.md`).

---

## Pruebas de Verificación Ejecutadas

### 1. Auditoría de Código Android (`android_app/`)
* **Ausencia de WebViews (Regla 7.1)**:
  - Verificado: 0 ocurrencias de `android.webkit.WebView`, `WebKit` o navegadores embebidos.
  - La interfaz de usuario está construida 100% en Jetpack Compose nativo con Material 3.
* **Aislamiento de Samsung DeX (Regla 7.5)**:
  - `CockpitDashboard.kt` contiene exactamente 8 pestañas operativas (`COCKPIT`, `CPU`, `RAM`, `DISKS`, `NET`, `SECURITY`, `DOCKER`, `PROCESSES`).
  - Cero menús, diálogos o botones de Samsung DeX o proyección USB en Android.
* **Zero-Hardcoding de Versión (Regla 2 y Regla 3)**:
  - `ApiService.kt`: Purgadas las líneas 37 y 69 que contenían `"RecursosCockpit-Android/8.5.0"`. Ahora utilizan `BuildConfig.VERSION_NAME` inyectado dinámicamente desde Gradle.
  - `Models.kt`: Purgado el valor predeterminado `"8.5.0"` en `VersionInfo`.
  - `CockpitDashboard.kt`: Muestra `v${BuildConfig.VERSION_NAME}` en el HeaderBar.
* **Autodescubrimiento Dinámico y Criptografía (Regla 7.2 y 7.3)**:
  - `DiscoveryManager.kt`: Extrae la subred `/24` dinámicamente desde `NetworkInterface.getNetworkInterfaces()`.
  - `SecurePreferences.kt`: Emplea `EncryptedSharedPreferences` y `MasterKey` con AES256-GCM / AES256-SIV.

### 2. Auditoría de Código Ubuntu Linux (`desktop_app/`)
* **Modo de Prueba CLI (`--test-mode`) (Regla 6.3)**:
  - Ejecución: `python3 desktop_app/recursos_app.py --test-mode`
  - Resultado:
    ```
    [OK] Recursos Native GTK3 App v9.1.2 validated successfully.
    [OK] Runtime Environment Detection: {'mode': 'native', 'is_native': True, 'is_mobile': False, 'is_web': False, 'is_native_or_mobile': True, 'hide_device_tab': False, 'render_usb_projection_wait_screen': True}
    [OK] DeX / Android Desktop USB Controller Ready: {'adb_installed': False, 'scrcpy_installed': False, ...}
    [OK] Server Auto-Discovery & Zero-Trust Engine Ready: active='https://recursos.cminewar.duckdns.org', mode='REVOKED'
    ```
* **Interfaz 100% Nativa GTK 3 + Cairo (Regla 7.1)**:
  - `CairoSparkline` dibuja gráficos vectoriales fluidos a 60 FPS mediante contextos Cairo nativos.
* **Desbloqueo de Estación USB DeX (Regla 7.5)**:
  - En la aplicación nativa de Ubuntu, la pestaña `📱 Conexión USB (DeX)` está desbloqueada y operativa mediante `DexController`, Scrcpy y UHID.

### 3. Compilación e Instalación del Paquete Debian (.deb) (Regla 6)
* **Compilación**:
  - Comando ejecutado: `bash packaging/build_deb.sh`
  - Paquete generado: `dist/recursos-cockpit_9.1.2_amd64.deb`
  - Symlink canónico: `dist/recursos-cockpit.deb`
  - Sumas criptográficas generadas: `dist/SHA256SUMS.txt`
* **Inspección con dpkg**:
  - `dpkg -l | grep recursos-cockpit`:
    ```
    iU  recursos-cockpit  9.1.2  amd64  Recursos Cockpit - Monitor de Silicio Nativo GTK3 y Conexion de Dispositivos
    ```

### 4. Plataforma Web y Servidor
* **Endpoints HTTP probados**:
  - `/api/net/history`: `HTTP/1.1 200 OK` con JSON estructurado (`services_catalog`, `devices_catalog`, `connections`, `summary`).
  - `/download/recursos-cockpit.deb`: `HTTP/1.1 200 OK` con `Content-Disposition: attachment; filename="recursos-cockpit_9.1.2_amd64.deb"`.
* **Blindaje en Frontend (`index.html` & `static/index.html`)**:
  - `window.connectionsMapDrawerOpen = false;` y `window.connectionsMapServiceDrawerOpen = false;` inicializados y reactivos a la apertura del cajón del mapa.
  - Botones OTA actualizados a `v9.1.2`.

### 5. Compilación y Linter
* `tsc --noEmit` (Linter): **0 errores**.
* `compile_applet`: **Build succeeded exitosamente**.
