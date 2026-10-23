# Plan de Implementación v9.1.0: Botones de Descarga Directa (.apk & .deb) Exclusivos para la Versión Web en la Pestaña OTA

## 1. Contexto y Objetivos
El usuario solicitó:
> *"en la pestaña de ota en la web solo en la web pon unos botones de descarga de la apk y del deb"*

Para satisfacer este requerimiento con máxima fidelidad y apego a las normas del proyecto:
1. **Pestaña OTA (`/version` / `#viewVersion`)**:
   - Incorporar botones directos de descarga para el paquete Debian Linux (`recursos-cockpit_9.1.0_amd64.deb`) y el paquete Android (`recursos-cockpit_9.1.0.apk`) en la barra de acciones superior de la vista OTA.
   - Diseñar un Bento Panel dedicado (`#otaWebDownloadsCard`) bajo la cabecera de la vista OTA con información de versiones, arquitectura y botones de descarga de alto contraste.
2. **Aislamiento Estricto "Solo en la Web"**:
   - Los botones y tarjetas de descarga deben estar presentes exclusivamente en la interfaz web estándar.
   - En ejecución nativa pura (la aplicación de escritorio Ubuntu GTK3 o cliente Android Jetpack Compose), estos controles se suprimen de forma estricta mediante:
     - Detección en tiempo de ejecución en `EnvironmentDetector.applyEnvironmentLayout()` (`isNative ➔ display: none`).
     - Reglas CSS de aislamiento condicional `[data-runtime-env="native"] #otaWebDownloadButtons, [data-runtime-env="native"] #otaWebDownloadsCard { display: none !important; }`.
3. **Endpoints de Descarga en Backend y Dev Server**:
   - En `server.py`: nuevo manejador `/download/recursos-cockpit.apk` (junto al existente `/download/recursos-cockpit.deb`) con streaming de binarios desde `dist/` y redirección transparente 302 a GitHub Releases si el binario no está disponible localmente.
   - En `vite.config.ts`: middleware interceptor para `/download/recursos-cockpit.deb` y `/download/recursos-cockpit.apk` permitiendo descargas funcionales en el entorno de previsualización y desarrollo.
4. **Criterio de Incremento de Versión (Regla 3.4)**:
   - Añadir una nueva funcionalidad o ajustar un componente específico de la interfaz activa un incremento de versión **`MINOR`**: `v9.0.0` ➔ **`v9.1.0`** (con tercer dígito reseteado a 0).

---

## 2. Modificaciones Realizadas

### A. Frontend (`index.html` y `static/index.html`)
- Inyección de fila de botones de descarga directa en la cabecera del gestor OTA (`#otaWebDownloadButtons`):
  - Botón `.deb` para Linux Ubuntu / Debian amd64.
  - Botón `.apk` para Android (firmado oficialmente).
- Inyección del Bento Panel `#otaWebDownloadsCard` con descripción y enlaces canónicos.
- Actualización dinámica en `renderVersionInfoToUI()` para inyectar la versión activa en nombres de descarga y enlaces.
- Filtrado en `EnvironmentDetector.applyEnvironmentLayout()` y reglas CSS de aislamiento contra entornos nativos.
- Sincronización 100% idéntica entre `index.html` y `static/index.html`.

### B. Backend (`server.py`) y Servidor de Desarrollo (`vite.config.ts`)
- `server.py`: soporte para rutas de descarga de APK (`/download/recursos-cockpit.apk`, `/download/app.apk`, `/api/download/app_apk`), sirviendo el binario con MIME `application/vnd.android.package-archive` o redirigiendo a GitHub Releases.
- `vite.config.ts`: manejador de descargas para `.deb` y `.apk` en el middleware de desarrollo.

### C. Sincronización Canónica de Versiones (`9.1.0`)
- `./VERSION`: `9.1.0`
- `package.json`: `"version": "9.1.0"`
- `packaging/debian/control`: `Version: 9.1.0`
- `android_app/app/build.gradle.kts`: `versionName = "9.1.0"`, `versionCode = 90100`
- `README.md`: Badges, banner ASCII, tabla de descargas directas y tabla de historial de cambios sincronizados a `9.1.0`.

---

## 3. Plan de Verificación
1. Compilar el paquete Debian canónico: `bash packaging/build_deb.sh`.
2. Validar que la aplicación nativa de escritorio GTK3 ejecute limpiamente: `python3 desktop_app/recursos_app.py --test-mode`.
3. Validar tipado y sintaxis: `lint_applet` (`tsc --noEmit`).
4. Compilar la aplicación web: `compile_applet`.
