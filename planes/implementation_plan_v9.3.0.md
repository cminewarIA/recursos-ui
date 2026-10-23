# Plan de Implementación v9.3.0 — Eliminación de la Normativa No-HTML y Reescritura de Apps Nativas (Ubuntu & Android) con Motor HTML5 Unificado

## 1. Objetivo
- Eliminar la restricción en `GEMINI.md` (Reglas 7 y 8) que prohibía el uso de HTML y contenedores WebView/WebKit2 en las aplicaciones nativas de Linux/Ubuntu y Android.
- Reescribir íntegramente tanto la **App Nativa de Ubuntu (`desktop_app/recursos_app.py`)** como la **App Nativa de Android (`android_app/`)** para que rendericen la interfaz canónica unificada HTML5/CSS3/D3.js v7/Leaflet (`index.html` / `static/index.html`) mediante contenedores nativos acelerados por hardware (`WebKit2.WebView` en GTK 3 y `android.webkit.WebView` en Jetpack Compose), acoplados con sus respectivos puentes nativos del sistema operativo (autodescubrimiento LAN `/24`, conmutación LAN ↔ WAN, persistencia criptográfica Zero-Trust y control físico de USB DeX `/dev/uhid` + `scrcpy` desbloqueado exclusivamente en Ubuntu).

## 2. Cambios Arquitectónicos

### 2.1. Reglas del Proyecto (`GEMINI.md`)
- **Regla 7.1**: Sustitución de la prohibición de HTML/WebViews por la norma de **Motor de Interfaz HTML5 Unificado con Contenedores Nativos Acelerados por Hardware (Ubuntu WebKit2 & Android WebView)**.
- **Regla 7.5 y Regla 8.2**: Paridad visual y funcional 100% exacta entre Web, Ubuntu y Android al compartir el mismo código fuente HTML5, manteniendo el desbloqueo exclusivo del submenú y controles de hardware DeX (`/dev/uhid` + `scrcpy`) en la App Nativa de Ubuntu.

### 2.2. Motor HTML5 Unificado (`index.html` y `static/index.html`)
- **Detección de Plataforma Nativa (`EnvironmentDetector`)**:
  - Identificación automática de `ubuntu` (`window.__RECURSOS_UBUNTU_NATIVE__` / `RecursosCockpit-Ubuntu`) y `android` (`window.__RECURSOS_ANDROID_NATIVE__` / `window.RecursosAndroidBridge`).
  - Ambas apps nativas despliegan las 12 vistas completas del Cockpit (con su barra lateral, Floating Touch Dock, mapas Leaflet y gráficas D3.js v7).
  - La vista #13 (`#viewDex` / `#navDexLi` / `#dockDex`) y sus controles de hardware (`#dexSelectDevice`, `#dexSelectResolution`, `#dexSelectFps`, `#chkDexUhid`, `#chkDexFullscreen`, `#chkDexScreenOff`, `#chkUsbAutoProject`) se desbloquean **exclusivamente en la App Nativa de Ubuntu**, mostrando en la web el mensaje pasivo: *"Esperando dispositivo para conectarse en su versión nativa"*.
  - Ocultación automática de los botones de descarga OTA `.deb` y `.apk` cuando se ejecuta dentro de las apps nativas.
- **Puente de Sesión Nativa (`window.injectNativeSession`)**:
  - Sincronización bidireccional del token `X-Device-Token` entre `localStorage` y `window.RecursosAndroidBridge` / `LocalHtmlBridgeServer`.

### 2.3. App Nativa Ubuntu (`desktop_app/recursos_app.py` y `packaging/`)
- **`LocalHtmlBridgeServer`**: Servidor HTTP loopback multi-hilo en `127.0.0.1:<puerto_efimero>` que:
  1. Sirve `index.html` inyectando `window.__RECURSOS_UBUNTU_NATIVE__ = true` y la sesión Zero-Trust activa.
  2. Intercepta localmente `/api/dex/status`, `/api/dex/start` y `/api/dex/stop` conectándolos directamente a `DexController` (`scrcpy` + `/dev/uhid` + `adb`).
  3. Proxifica de forma transparente el resto de rutas `/api/*` hacia el servidor LAN/WAN descubierto por `ServerConnectionManager`, o sintetiza telemetría local en tiempo real mediante `psutil` si no hay servidor externo accesible.
- **Ventana Nativa `Gtk.ApplicationWindow` + `WebKit2.WebView`**:
  - Cabecera nativa `Gtk.HeaderBar` con estado de enlace LAN/WAN/Local, acceso directo a `📱 Estación USB DeX`, recarga y diálogo modal de configuración de nodo/token Zero-Trust.
  - Empaquetado de `static/index.html` dentro de `/usr/lib/recursos-cockpit/static/index.html` en `packaging/build_deb.sh` y adición de `gir1.2-webkit2-4.1 | gir1.2-webkit2-4.0` en `packaging/debian/control`.

### 2.4. App Nativa Android (`android_app/`)
- **`RecursosAndroidBridge` (`@JavascriptInterface`)**: Expone `getDeviceToken()`, `onTokenUpdated()`, `getConnectionMode()`, `getActiveNodeUrl()`, `openNativeSettings()` y `triggerNodeRescan()` al motor HTML5.
- **`CockpitDashboard.kt` y `MainActivity.kt`**: Contenedor `AndroidView(WebView)` acelerado por hardware con User-Agent `RecursosCockpit-Android/${BuildConfig.VERSION_NAME} (NativeHTML)`, inyección automática de `window.__RECURSOS_ANDROID_NATIVE__ = true` y token desde `EncryptedSharedPreferences`, soporte de navegación hacia atrás (`BackHandler`) y barra superior nativa compacta con estado LAN/WAN y acceso a `SettingsDialog`.
