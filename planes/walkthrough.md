# Walkthrough y Verificación — v8.0.0

## Resumen de Cambios Implementados

1. **Menú Lateral Izquierdo Desplegable en el Mapa (`#mapSideDrawer`) y Consolidación de Controles**:
   - Se reemplazó la barra horizontal superior del mapa por un menú lateral izquierdo desplegable (`#mapSideDrawer`) accionado mediante `#btnMapDrawerToggle` en la esquina superior izquierda, acompañado de chips de acceso rápido para quitar filtros de servicio o dispositivo.
   - Se unificaron los controles de cámara (`Zoom +`, `Zoom −`, `Encuadrar`, `Host`) y el botón de `Pantalla Completa` en `.map-camera-toolbar` en la esquina superior derecha, eliminando los botones redundantes `#btnMapHeaderFullscreen` y `#btnMapCornerFullscreen`.
   - Se mantuvo el bloqueo matemático de límites mundiales (`enforceMapWorldBounds`) y el desbloqueo de `position: fixed` en pantalla completa (`body.map-fullscreen-active`).

2. **Detalle de Flujos y Sockets Geolocalizados de Alta Densidad con Historial SQLite por Dispositivo**:
   - Se rediseñaron las filas de `#networkConnectionsTableList` en una rejilla compacta de 5 columnas para mostrar más información en menos espacio vertical.
   - Cada fila y grupo de dispositivo incorpora el botón `📜 Historial` (`toggleDeviceHistoryInline`), que consulta `/api/net/history?device=<ip>` (con `services_catalog` filtrado por dispositivo en `server.py`) y despliega en línea el catálogo de servicios y las conexiones históricas de ese dispositivo.

3. **Distribución de Ancho de Banda con Todos los Dispositivos Siempre Visibles en Cada Subcategoría**:
   - En `NetworkBandwidthPieChart` (`Subredes`, `Grupos`, `Categorías` y `Dispositivos`), se eliminó el truncado de 3 dispositivos y se añadió `.bw-pie-devices-breakdown` siempre visible dentro de cada categoría, listando todos los dispositivos con su icono, IP, medio (`Eth`/`5G`/`2.4G`), barra proporcional y consumo individual (`↓`, `↑` y total).

4. **Cumplimiento de Reglas `GEMINI_md`**:
   - Sincronización idéntica entre `/index.html` y `/static/index.html`.
   - Actualización de versión canónica a `8.0.0` (`MAJOR`) en `/VERSION`, `/package.json` y paquete Debian `/dist/recursos-cockpit_8.0.0_amd64.deb`.
