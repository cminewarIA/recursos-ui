# Plan de Implementación v9.1.2 · Auditoría Integral Línea a Línea de Interfaces Nativas (Android & Ubuntu) y Blindaje de Normas

## Contexto y Solicitud del Usuario
El usuario solicitó una revisión exhaustiva línea por línea de todo el código del proyecto, prestando especial atención a las interfaces nativas de **Android** (Kotlin + Jetpack Compose) y **Ubuntu** (GTK 3 + Cairo + DeX USB), para asegurar el cumplimiento al 100% de todas las directrices maestras del proyecto especificadas en `GEMINI.md`:
* **Regla 1 (Sincronización Previa Git)**
* **Regla 2 (Zero-Hardcoding & Rutas Universales)**
* **Regla 3 (Punto Único de Verdad de Versión `./VERSION`)**
* **Regla 4 (Almacenamiento de Planes en `./planes/`)**
* **Regla 5 (Actualización Obligatoria de `README.md`)**
* **Regla 6 (Compilación e Instalación Local del `.deb`)**
* **Regla 7 (Arquitectura Contractual de Apps Nativas: cero WebViews, DeX exclusivo en Ubuntu)**
* **Regla 8 (Simetría Total y Homogeneidad Visual)**

---

## Hallazgos de la Auditoría Línea por Línea

### 1. Aplicación Nativa Android (`android_app/`)
* **`ApiService.kt` (Líneas 37 y 69)**: Se detectó el valor fijo `"User-Agent", "RecursosCockpit-Android/8.5.0"`. Se corrigió para importar dinámicamente `com.cminewar.recursoscockpit.BuildConfig` y utilizar `${BuildConfig.VERSION_NAME}`, garantizando cumplimiento de las Reglas 2 y 3.
* **`Models.kt` (Línea 16)**: En `VersionInfo`, el parámetro por defecto tenía asignado el string `"8.5.0"`. Se purgó para establecer un fallback limpio sin versiones desfasadas.
* **`CockpitDashboard.kt`**: Se verificó la ausencia total de WebViews (`android.webkit.WebView`). Cuenta estrictamente con 8 pestañas estándar (`COCKPIT`, `CPU`, `RAM`, `DISKS`, `NET`, `SECURITY`, `DOCKER`, `PROCESSES`) sin ningún menú de DeX o proyección USB (cumpliendo con la Regla 7.5). El diseño aplica la estética *Apple Liquid Glass + Tesla Touch Cockpit* con radios de curvatura consistentes (6dp - 12dp) sin píldoras de 999dp.
* **`DiscoveryManager.kt`**: Detección dinámica de subred local (`getLocalSubnetBase()`) a través de las interfaces de red del sistema operativo (`NetworkInterface.getNetworkInterfaces()`) y conmutación automática a WAN (`recursos.cminewar.duckdns.org`).
* **`SecurePreferences.kt`**: Almacenamiento criptográfico con `EncryptedSharedPreferences` / Android KeyStore (`MasterKey` AES256-GCM / AES256-SIV).
* **`MainActivity.kt`**: Arquitectura 100% Jetpack Compose puro con ciclo reactivo continuo y reconexión transparente.

### 2. Aplicación Nativa Ubuntu / Linux (`desktop_app/`)
* **`desktop_app/recursos_app.py`**:
  - `get_app_version()` lee dinámicamente `./VERSION` en tiempo de ejecución.
  - La cabecera `User-Agent` interpola dinámicamente la versión canónica.
  - Interfaz 100% nativa pura con widgets GTK 3 y aceleración vectorial de gráficos mediante Cairo (`CairoSparkline`).
  - `--test-mode` valida dependencias, autodescubrimiento y controlador DeX USB sin fallos.
  - Estación DeX / Android Desktop Mode presente exclusivamente en esta versión de escritorio con Scrcpy y UHID (cumpliendo la Regla 7.5).
* **`desktop_app/dex_controller.py`**:
  - Sondeo dinámico de dispositivos mediante `adb devices -l` y detección de características DeX.
  - Gestión limpia de procesos scrcpy sin residuos en memoria.

### 3. Interfaz Web y Servidor (`server.py`, `vite.config.ts`, `index.html`)
* **Pestaña OTA (`index.html` & `static/index.html`)**:
  - Los atributos iniciales `download="recursos-cockpit_9.1.0_amd64.deb"` y `id="otaCardVersionBadge">v9.1.0` contenían versiones desfasadas. Se sincronizaron a `9.1.2`.
  - Se blindaron las variables de estado `window.connectionsMapDrawerOpen = false;` y `window.connectionsMapServiceDrawerOpen = false;` para prevenir cualquier `ReferenceError` en el manejador del clic de Leaflet.
* **`server.py`**:
  - Fallbacks de versión en `get_app_version()` actualizados a valor canónico limpio (`0.0.0`).
* **`vite.config.ts`**:
  - Fallback en `readAppVersion()` actualizado a `0.0.0`. Endpoints `/api/net/history` y `/download/*` validados con retorno HTTP 200 JSON y streaming de archivo.

---

## Criterio de Incremento de Versión (Regla 3.4)
* La versión canónica previa era `9.1.1`.
* Los cambios realizados corresponden a corrección de pequeños detalles, eliminación de strings hardcodeados residuales y blindaje de variables de entorno sin alteración de funcionalidades mayores (`0.0.X` PATCH).
* **Nueva Versión Canónica**: `9.1.2`.

---

## Archivos Sincronizados
1. `./VERSION` ➔ `9.1.2`
2. `package.json` ➔ `"version": "9.1.2"`
3. `packaging/debian/control` ➔ `Version: 9.1.2`
4. `android_app/app/build.gradle.kts` ➔ `versionName = "9.1.2"`, `versionCode = 90102`
5. `android_app/app/src/main/java/com/cminewar/recursoscockpit/data/ApiService.kt`
6. `android_app/app/src/main/java/com/cminewar/recursoscockpit/data/Models.kt`
7. `server.py` & `vite.config.ts`
8. `index.html` & `static/index.html`
9. `README.md`
10. `packaging/build_deb.sh` ejecutado, generando `dist/recursos-cockpit_9.1.2_amd64.deb` y `dist/SHA256SUMS.txt`.
