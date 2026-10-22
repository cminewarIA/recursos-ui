# Plan de Implementación: App Nativa GTK3 Pura y Purga de DeX en Web (v6.0.0)

El usuario ha especificado dos directivas de diseño fundamentales:
1. **En la versión web**: No nombrar bajo ningún concepto "DeX" ni "Modo DeX", y mostrar de forma clara y visible: **"Esperando dispositivo para conectarse en su versión nativa"**.
2. **En la app nativa**: La aplicación de escritorio para Linux **no debe ser una web app ni usar un visor web** (`WebKit2`), sino una **aplicación completamente funcional y 100% nativa** en GTK3 con widgets nativos para telemetría en tiempo real y conexión interactiva de dispositivos por hardware con Scrcpy/UHID.

Dado que esto representa un cambio integral de diseño visual y maquetación de la app nativa (de WebView embebido a GTK3 Adwaita nativo puro), la versión se incrementa a **`v6.0.0`** conforme a la Regla 5 (`MAJOR` por cambio de diseño).

---

## Cambios Propuestos

### 1. App Nativa para Linux (`desktop_app/recursos_app.py`)
- **Eliminación Total de WebKit**: Descartar `gir1.2-webkit2-4.1` y cualquier iframe / browser interno.
- **Construcción de Interfaz 100% Nativa en GTK3**:
  - `Gtk.HeaderBar`: Con icono del sistema, título "Recursos Cockpit", conmutador de tema, botón de pantalla completa y selector de vistas `Gtk.StackSwitcher`.
  - **Pestaña 1: Monitor del Sistema (Nativo Puro)**:
    - Tarjetas Adwaita nativas con métricas de silicio en vivo actualizadas con `GLib.timeout_add(1000, ...)`:
      - CPU: Carga total e hilos individuales con `Gtk.ProgressBar` coloreadas según umbrales (verde, ámbar, rojo).
      - RAM & Swap: Barras nativas de ocupación, megabytes usados y libres.
      - Discos: Espacio partición raíz y discos montados con lecturas de `psutil`.
      - Red: Tasa de transferencia en tiempo real KB/s (RX / TX).
  - **Pestaña 2: Conexión de Dispositivo (Nativo Puro)**:
    - Banner interactivo de detección: Si no hay dispositivo conectado, muestra estado dinámico y botón de escaneo.
    - Al detectar un dispositivo (ADB/USB o Wi-Fi):
      - Ficha del dispositivo: Modelo, fabricante, serial/IP, estado de autorización.
      - Controles nativos: Selector de resolución (1080p, 2K, nativa), conmutador de teclado/ratón UHID por hardware (`/dev/uhid`), conmutador de pantalla apagada en el móvil y activación de ADB sobre TCP/IP (Wi-Fi 5555).
      - Botón de acción: Iniciar sesión de proyección interactiva a 60 FPS con Scrcpy y botones para desconectar limpiamente.
  - **Pestaña 3: Registro & Diagnóstico**:
    - `Gtk.TextView` nativo con bitácora en vivo de eventos ADB, estado de conexión de dispositivos y atajos rápidos de teclado.

### 2. Frontend Web (`static/index.html` e `index.html`)
- **Purga Total del término "DeX"**:
  - Eliminar referencias a "Modo DeX", "Samsung DeX" o "DeX Desktop Cockpit".
  - En la cabecera: Botón `🐧 App Linux` que enlaza a la vista de descarga y conexión de dispositivo.
  - En la Vista General: Tarjeta Bento 11 renombrada a **"Conexión de Dispositivo & App Nativa"**, con texto visible: **"Esperando dispositivo para conectarse en su versión nativa"**.
  - En la Vista Dedicada (`viewDevice` / ruta `/app` y `/dispositivo`, manteniendo `/dex` como alias silencioso):
    - Banner prominente estilo Apple Glass: **"Esperando dispositivo para conectarse en su versión nativa"** con indicador de radar/pulso en vivo.
    - Explicación de que la interacción directa y control por hardware requieren la App Nativa Linux.
    - Botón de descarga directa de `recursos-cockpit_6.0.0_amd64.deb` e instrucciones paso a paso de instalación.
  - En el Floating Touch Dock: Cambiar etiqueta a `App` o `Dispositivo`.

### 3. Empaquetado Debian y CI/CD
- Actualizar `packaging/debian/control`:
  - Retirar `gir1.2-webkit2-4.1` de las dependencias.
  - Añadir `python3-psutil`.
- Actualizar `packaging/build_deb.sh` y compilar el nuevo paquete Debian `recursos-cockpit_6.0.0_amd64.deb`.
- Actualizar `.github/workflows/build-deb.yml`.

### 4. Servidor y Versión Canónica
- `VERSION` -> `6.0.0`
- `package.json` -> `6.0.0`
- `server.py`: Adaptar nombres y descargas para `6.0.0`.
- Documentar en `planes/walkthrough_v6.0.0.md` y `README.md`.

---

## Plan de Verificación

1. **Prueba de la App Nativa**: Ejecutar `python3 desktop_app/recursos_app.py --test-mode` comprobando que no utiliza WebKit y que inicializa todos los widgets GTK3 nativos.
2. **Empaquetado**: Ejecutar `./packaging/build_deb.sh` y validar que el archivo `dist/recursos-cockpit_6.0.0_amd64.deb` se construye correctamente sin dependencias de WebKit.
3. **Servidor y Endpoints**:
   - `sudo systemctl restart system-dashboard.service`
   - `curl -s http://127.0.0.1:8085/api/version` -> `"6.0.0"`
   - `curl -I http://127.0.0.1:8085/download/recursos-cockpit.deb` -> HTTP 200 OK
4. **Verificación Web**:
   - Búsqueda en el archivo web con ripgrep asegurando que no queden cadenas "DeX" visibles al usuario.
   - Verificación con Google Chrome Headless en la vista de dispositivo comprobando la presencia del texto exacto: "Esperando dispositivo para conectarse en su versión nativa".
5. **Git Push**: Sincronización automática de cambios a GitHub `main`.
