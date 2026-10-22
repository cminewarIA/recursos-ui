# 🚀 Recorrido y Verificación v6.0.2: Sincronización Estricta de Versión del Paquete .deb

## 🎯 Objetivo Cumplido
Garantizar que el archivo empaquetado para Linux (`.deb`), sus metadatos internos (`control`), el backend de distribución (`server.py`), la aplicación nativa (`desktop_app/recursos_app.py`) y la interfaz reactiva (`static/index.html` e `index.html`) coincidan al 100% con la versión canónica definida en `./VERSION` (`6.0.2`), bajo el principio de Zero-Hardcoding.

---

## 🛠️ Cambios Implementados

### 1. Control Canónico de Versión (Punto Único de Verdad)
- **`VERSION`**: Incrementada a `6.0.2` (ajuste y sincronización de empaquetado `.deb`).
- **`package.json`**: Sincronizada clave `"version": "6.0.2"`.
- **`packaging/debian/control`**: Sincronizado campo `Version: 6.0.2`.

### 2. Limpieza y Construcción de Paquetes (`packaging/build_deb.sh`)
- **Limpieza de obsoletos**: Se añadió purga de archivos `.deb` antiguos en `dist/` (`rm -f "$OUTPUT_DIR"/*.deb`) antes de iniciar la construcción, evitando la acumulación de versiones previas.
- **Punto de verdad en el paquete**: Se copia `./VERSION` a `/usr/lib/recursos-cockpit/VERSION` dentro del `.deb`.
- **Symlink canónico**: Se crea automáticamente el enlace relativo `recursos-cockpit.deb -> recursos-cockpit_6.0.2_amd64.deb` para accesos genéricos.
- **Sumas de verificación**: Actualización automática de `SHA256SUMS.txt`.

### 3. Servidor Cockpit (`server.py`)
- **Detección Dinámica**: El manejador de `/download/` lee `current_ver = get_app_version()` para ubicar el paquete canónico `recursos-cockpit_{current_ver}_amd64.deb`.
- **Auto-compilación al vuelo**: Si el archivo canónico para la versión activa no existe al recibir una petición de descarga, invoca automáticamente `packaging/build_deb.sh` en un subproceso de forma transparente.
- **Soporte de rutas versionadas y canónicas**: Soporta `/download/recursos-cockpit.deb`, `/download/recursos-cockpit_6.0.2_amd64.deb` y variantes con la cabecera `Content-Disposition: attachment; filename="recursos-cockpit_{current_ver}_amd64.deb"`.

### 4. Aplicación Nativa GTK 3 (`desktop_app/recursos_app.py`)
- **Lectura Dinámica de Versión**: Función `get_native_app_version()` que lee `./VERSION` tanto en desarrollo como una vez instalada en `/usr/lib/recursos-cockpit/VERSION`.
- **HeaderBar**: Muestra `v6.0.2 · Monitor Nativo del Silicio & Conexión de Dispositivo`.
- **Diálogo Acerca de**: Añadido botón `help-about-symbolic` en la cabecera con un diálogo nativo de GNOME `Gtk.AboutDialog` mostrando la versión canónica, licencia MIT y créditos.

### 5. Frontend Web Reactivo (`static/index.html` e `index.html`)
- **Zero-Hardcoding**: En `renderVersionInfo(info)`, se actualizan dinámicamente mediante el endpoint `/api/version`:
  - El badge de versión de la tarjeta Bento (`#debBadgeVersion`).
  - La URL del botón de descarga (`#btnDownloadDeb` -> `/download/recursos-cockpit_{version}_amd64.deb`).
  - El texto del botón (`#btnDownloadDebText`).
  - El nombre del paquete en la guía de instalación (`#debPkgNameDisplay`).
  - El bloque de comandos de terminal interactivo (`#debTerminalCommands` con `wget` adaptado a la versión actual).

---

## 🧪 Pruebas y Verificaciones Realizadas

| Prueba | Comando / Endpoint | Resultado Esperado | Resultado Obtenido | Estado |
| :--- | :--- | :--- | :--- | :---: |
| **Compilación .deb** | `./packaging/build_deb.sh` | Paquete `recursos-cockpit_6.0.2_amd64.deb` generado | Generado (12,024 bytes) con symlink canónico | ✅ Superado |
| **Metadatos .deb** | `dpkg-deb -I dist/recursos-cockpit_6.0.2_amd64.deb` | `Version: 6.0.2` | Confirmado `Version: 6.0.2` | ✅ Superado |
| **Archivos en .deb** | `dpkg-deb -c dist/recursos-cockpit_6.0.2_amd64.deb` | Incluye `/usr/lib/recursos-cockpit/VERSION` | Confirmada presencia del archivo `VERSION` | ✅ Superado |
| **Sintaxis Python** | `python3 -m py_compile server.py desktop_app/recursos_app.py` | Salida limpia sin errores | 0 advertencias / 0 errores | ✅ Superado |
| **App Nativa Test** | `python3 desktop_app/recursos_app.py --test-mode` | Inicialización correcta de widgets nativos | Inicializada con éxito | ✅ Superado |
| **Endpoint /api/version** | `curl -s http://127.0.0.1:8085/api/version` | `"version": "6.0.2"` | `"version": "6.0.2"` | ✅ Superado |
| **Descarga Canónica** | `curl -sI http://127.0.0.1:8085/download/recursos-cockpit.deb` | HTTP 200 `filename="recursos-cockpit_6.0.2_amd64.deb"` | HTTP 200 OK con Content-Disposition 6.0.2 | ✅ Superado |
| **Descarga Versionada** | `curl -sI http://127.0.0.1:8085/download/recursos-cockpit_6.0.2_amd64.deb` | HTTP 200 `filename="recursos-cockpit_6.0.2_amd64.deb"` | HTTP 200 OK | ✅ Superado |
| **Sincronización Web** | `diff -q static/index.html index.html` | Idénticos | Idénticos sin diferencias | ✅ Superado |
