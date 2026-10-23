# Plan de Implementación v9.4.0 — Identificación Integral de Hardware con Acceso Total en Apps Nativas y Panel de Identidad en Seguridad

## 1. Objetivo
Dotar a las aplicaciones nativas de **Ubuntu Linux (`.deb`)** y **Android (`.apk`)** de recolección completa de datos de hardware, sistema operativo, red, energía y silicio con acceso total del sistema operativo (*Zero-Hardcoding*), sincronizar esa identidad con el backend Zero-Trust y presentar todos los dispositivos con fichas técnicas detalladas en el **Panel de Seguridad (`/seguridad`)** y en el modal de **Sesiones y Dispositivos Confiables**.

## 2. Arquitectura e Implementación Realizada

### 2.1. App Nativa de Ubuntu (`desktop_app/recursos_app.py`)
- **`collect_native_device_telemetry()`**:
  - **DMI / SMBIOS (`/sys/devices/virtual/dmi/id/*`)**: Fabricante (`sys_vendor`), modelo de equipo (`product_name`), placa base (`board_vendor` / `board_name`), versión de BIOS (`bios_version`) y tipo de chasis (`chassis_type`, decodificando portátil, sobremesa, servidor, tablet, mini PC, etc.).
  - **Sistema Operativo & Entorno**: Distribución exacta desde `/etc/os-release` (`PRETTY_NAME`), versión del kernel (`platform.release()`), arquitectura (`platform.machine()`) y sesión gráfica (`XDG_CURRENT_DESKTOP`, `XDG_SESSION_TYPE`).
  - **Silicio (CPU & GPU)**: Modelo de procesador desde `/proc/cpuinfo`, núcleos físicos y hilos lógicos vía `psutil.cpu_count()`, y GPU detectada mediante `lspci`.
  - **Memoria, Almacenamiento y Batería**: Memoria RAM total (`psutil.virtual_memory().total`), almacenamiento raíz total y libre (`psutil.disk_usage("/")`), y porcentaje/estado de batería (`psutil.sensors_battery()`).
  - **Pantalla & Red Local**: Resolución de pantalla activa (`Gdk.Screen.get_default()`), interfaz de red activa (`psutil.net_if_addrs()`), dirección IP LAN y dirección física MAC.
  - **Huella Criptográfica Determinista (`hardware_id`)**: Hash SHA-256 (`ubn_<16_hex>`) calculado a partir de `/etc/machine-id` (o UUID de hardware/MAC).
- **Inyección y Sincronización**:
  - Cabeceras `X-Device-Telemetry` (JSON en Base64) y `X-Recursos-Client: ubuntu_native` en todas las peticiones de `ServerConnectionManager` y el proxy de `LocalHtmlBridgeServer`.
  - Endpoint local `GET /api/native/device-info` y variable global `window.__RECURSOS_NATIVE_DEVICE_INFO__` inyectada en `WebKit2.WebView`.

### 2.2. App Nativa de Android (`android_app/`)
- **`NativeDeviceTelemetry` (`Models.kt`) y `collectDeviceTelemetry()` (`ApiService.kt`)**:
  - **Identidad de Dispositivo (`android.os.Build`)**: `MANUFACTURER`, `BRAND`, `MODEL`, `DEVICE` (codename), `PRODUCT`, `BOARD`, `HARDWARE`, `DISPLAY` (build fingerprint), `SOC_MANUFACTURER` y `SOC_MODEL` (Android 12+ / API 31+).
  - **Sistema Operativo Android**: `Build.VERSION.RELEASE`, `Build.VERSION.SDK_INT`, `Build.VERSION.SECURITY_PATCH` y arquitecturas soportadas (`Build.SUPPORTED_ABIS`).
  - **Memoria, Almacenamiento y Batería**: RAM total vía `ActivityManager.MemoryInfo`, almacenamiento interno total/libre vía `StatFs(Environment.getDataDirectory())`, y nivel/estado de carga vía `BatteryManager`.
  - **Pantalla y Red**: Resolución física (`widthPx x heightPx`) y densidad (`densityDpi`) desde `DisplayMetrics`, interfaz Wi-Fi/LAN activa (`wlan0` / `eth0`), IP local IPv4 y MAC desde `NetworkInterface.getNetworkInterfaces()`.
  - **Huella Criptográfica Determinista (`hardware_id`)**: Hash SHA-256 (`and_<16_hex>`) generado desde `Settings.Secure.ANDROID_ID` + metadatos de placa.
- **Puente Nativo (`MainActivity.kt` y `CockpitDashboard.kt`)**:
  - `@JavascriptInterface fun getDeviceTelemetryJson(): String` expuesto en `window.RecursosAndroidBridge`.
  - Registro automático con `POST /api/auth/register-device` tras el emparejamiento o verificación de sesión y cabecera `X-Device-Telemetry` en cada llamada HTTP.

### 2.3. Backend Zero-Trust (`server.py` y `vite.config.ts`)
- **`extract_header_telemetry()` & `enrich_device_entry()`**: Decodificación automática de `X-Device-Telemetry` en cada petición autenticada, enriquecimiento de `trusted_devices.json` y deduplicación por `hardware_id` para evitar entradas duplicadas cuando un mismo dispositivo nativo renueva su token.
- **Nuevos Endpoints**:
  - `POST /api/auth/register-device`: Actualiza en vivo la telemetría completa de hardware del dispositivo actual.
  - `POST /api/auth/rename-device`: Permite asignar o modificar un alias personalizado (`custom_alias`) para cualquier dispositivo identificado.

### 2.4. Panel de Seguridad (`/seguridad`) y Modal Zero-Trust (`index.html` & `static/index.html`)
- **Nueva Sección `#secZeroTrustDevicesSection` en `/seguridad`**:
  - Filtros interactivos (`Todos`, `⚡ Apps Nativas`, `🌐 Web`), botón de sincronización de telemetría en vivo y botón de revocación masiva.
  - Barra de 4 KPIs simétricos: *Dispositivos Autorizados*, *Apps Nativas (Acceso Total)*, *Identidad de Este Dispositivo* y *Canal & Nivel de Privilegio*.
  - Tarjetas simétricas de dispositivo (`buildDeviceIdentityCardHtml`) con **6 celdas de especificación técnica**:
    1. **Equipo & Fabricante** (Modelo, placa/board y `hardware_id` determinista).
    2. **Sistema Operativo & Kernel** (Distro/Android Release, Kernel/SDK, sesión/parche de seguridad).
    3. **Silicio (CPU / SoC & GPU)** (Modelo de procesador/SoC, núcleos e hilos, GPU).
    4. **Memoria & Almacenamiento** (RAM total, almacenamiento total y espacio libre).
    5. **Red & Direccionamiento** (IP de sesión, IP LAN reportada, interfaz NIC y dirección MAC).
    6. **Pantalla, Energía & Acceso** (Resolución física, estado y porcentaje de batería, nivel de privilegio `FULL_NATIVE_ACCESS` vs `BROWSER_SANDBOX`).
  - Edición de alias en vivo (`✏️ Alias`) y revocación individual de sesión.
