# Plan de Implementación — Detección Dinámica de Entorno (Web vs Móvil / Nativo) y Proyección USB (v6.2.0)

## 1. Objetivo
Implementar una lógica de detección de entorno en tiempo de ejecución en toda la plataforma (`index.html`, `static/index.html`, `desktop_app/recursos_app.py` y `server.py`) de modo que:
1. **Entorno Móvil o Nativo (`mobile` / `native`)**:
   - Se oculta automáticamente la pestaña `'Dispositivo'` (y cualquier otra pestaña no web).
   - Se renderiza en su lugar una pantalla de espera optimizada para la proyección por cable USB (**Samsung DeX / Modo Escritorio de Android**).
2. **Versión Web (`web`)**:
   - Se garantiza que la pestaña `'Dispositivo'` no esté presente en ninguna barra de navegación (sidebar, dock táctil inferior, puntos de paginación swipe ni tabla de rutas).

## 2. Arquitectura Implementada

### A. Motor `EnvironmentDetector` en Frontend (`index.html` & `static/index.html`)
- **Detección Dinámica Sin Hardcoding (`EnvironmentDetector.detect()`)**:
  - Evalúa parámetros de entorno (`?env=native`, `?env=mobile`, `?env=web`, `?mode=dex`), puente nativo (`window.__RECURSOS_NATIVE__`), cabeceras/firmas de contenedor nativo (`RecursosNative`, `Electron`, `WebKitGTK`, `pywebview`, `; wv)`) y señales de entorno móvil (`navigator.userAgentData.mobile` y User-Agent móvil/DeX).
- **Política Estricta de Navegación (`EnvironmentDetector.enforceNavigationPolicy()`)**:
  - Asegura que en la versión web no exista ningún enlace ni pestaña `'Dispositivo'` (`#navDex`, `#dockDex`, `#navDevice`, `#dockDevice`, `[data-view="dex"]`, `[data-view="device"]`, `[data-non-web-tab]`) y purga cualquier ruta residual del diccionario de navegación.
- **Pantalla de Espera Optimizada para Proyección USB (`#usbProjectionWaitScreen`)**:
  - Cuando `EnvironmentDetector.applyEnvironmentLayout()` detecta un entorno móvil o nativo, oculta cualquier pestaña no web y muestra `#usbProjectionWaitScreen` con estado en vivo del puerto USB (`GET /api/dex/status`), opción de inicio automático al conectar el cable USB y botón de proyección en 1 clic (`POST /api/dex/start`).

### B. Detección de Entorno en Aplicación Nativa GTK 3 (`desktop_app/recursos_app.py`)
- **`detect_runtime_environment()`**:
  - Detecta la ejecución nativa o móvil y configura `RecursosNativeWindow` para ocultar automáticamente `Gtk.StackSwitcher` y cualquier pestaña `'Dispositivo'`, mostrando directamente la pantalla de espera de proyección por USB (`usb_wait_screen`) para Samsung DeX / Android Desktop.

### C. Endpoints REST de Estado y Control USB (`server.py`)
- `GET /api/dex/status`: Devuelve el entorno detectado, estado de herramientas (`adb`, `scrcpy`), sesión activa y lista de dispositivos conectados exclusivamente por USB (`usb_only=True`).
- `POST /api/dex/start` y `POST /api/dex/stop`: Inician o detienen la proyección de vídeo por USB con `DexController`.
