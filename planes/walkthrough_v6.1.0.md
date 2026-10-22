# Walkthrough v6.1.0 — Auditoría Integral de Errores, Retiro de Pestaña Dispositivo en Web y Proyección USB en App Nativa

## 1. Resumen de Objetivos Cumplidos
1. **Eliminación total de la pestaña de Dispositivo en la versión Web**:
   - Retirado el enlace `#navDex` del menú lateral (sidebar).
   - Retirado el botón `#btnHeaderNativeApp` de la barra superior.
   - Retirada la tarjeta #11 de la cuadrícula Bento en la Vista General.
   - Retirada la vista completa `#viewDex` del DOM.
   - Retirado el punto de paginación extra en `#swipePaginationDots` y el icono `#dockDex` del Floating Touch Dock.
   - Limpiados los diccionarios de enrutamiento SPA (`VIEW_TO_PATH`, `PATH_TO_VIEW`, `VIEW_TITLES`, `SWIPE_VIEWS_ORDER`) y `VALID_WEB_ROUTES` en `server.py`.
2. **Interfaz de espera por USB en la versión Nativa GTK 3 (`desktop_app/`)**:
   - La pestaña **📱 Dispositivo (USB DeX)** en `desktop_app/recursos_app.py` muestra únicamente una interfaz limpia esperando la conexión por cable USB de un teléfono móvil para proyectar el vídeo con **Samsung DeX** o el **Modo Escritorio de Android** mediante `scrcpy` y `/dev/uhid`.
   - Añadido soporte para proyección automática al detectar el dispositivo por USB o inicio en 1 clic.
3. **Auditoría y corrección de errores en todo el proyecto**:
   - **Sincronización de firmas en `desktop_app/`**: Corregidas las discrepancias entre `recursos_app.py` y `dex_controller.py` (`list_connected_devices` / `list_devices`, `start_dex_session` / `start_session`, claves `id` y `serial`, y soporte de argumentos `--dex` y `--test-mode`).
   - **Cero Hardcoding**: Eliminado el fallback `"6.0.2"` en `recursos_app.py` y las IPs `"192.168.50.2"` en `index.html`, `static/index.html` y `server.py`, así como la ruta fija de `sync_pihole_devices.py`.
   - **Variables CSS**: Definidas `--accent-purple`, `--accent-purple-bright` y `--glass-shadow` tanto en `:root` (tema oscuro) como en `html[data-theme="light"]`.
   - **Compatibilidad iFrame / Modales No Bloqueantes**: Sustituidas todas las llamadas `window.confirm(...)` por `await showConfirmModal(...)`.
   - **Autenticación y Seguridad en API**: Añadidas las cabeceras `X-Device-Token` en `GeoIpBackgroundWorker` y `SystemLogsCenter.fetchLogs`, añadido chequeo de confianza en `POST /api/net/geoip/resolve`, y unificado el uso de `clean_path` en `do_POST` de `server.py`.
   - **Sincronización de Versión (`6.1.0`)**: Actualizados `./VERSION`, `./package.json` y `./packaging/debian/control`.
