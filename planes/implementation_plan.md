# Plan de Implementación — v8.0.0

## 1. Menú Lateral Izquierdo Desplegable y Adaptativo dentro del Mapa (`#mapSideDrawer`)
- **Activador Compacto Superior Izquierdo (`#btnMapDrawerToggle`)**: Botón flotante con indicador de modo (`En Vivo` / `Historial SQLite`), resumen del filtro activo, contador de flujos visibles y chips rápidos (`#btnMapClearServiceQuick`, `#btnMapClearDeviceQuick`) para limpiar filtros activos con un solo clic sin abrir el cajón.
- **Panel Lateral Retráctil (`#mapSideDrawer`)**: Cajón vertical adaptativo (`width: min(350px, calc(100% - 24px))`) con 4 secciones organizadas:
  1. Conmutador de modo (`En Vivo` vs `Historial SQLite`).
  2. Cuadrícula de filtros de dirección y tráfico (`Todas`, `Entrantes`, `Salientes`, `Dispositivos`, `Bloqueadas`).
  3. Lista siempre accesible de equipos LAN detectados (`#mapHudDeviceFilterBar`).
  4. Buscador instantáneo, selector de ventana temporal (`Todo`, `6h`, `24h`, `7d`), botón `Limpiar BD` y catálogo interactivo de servicios (`#mapHistServicesCatalogList`).
- **Barra Unificada de Cámara y Pantalla Completa (`.map-camera-toolbar`)**: Anclada en la esquina superior derecha del mapa con controles de `Zoom +`, `Zoom −`, `Encuadrar`, `Host` y el único botón canónico de `Pantalla Completa`, eliminando los botones redundantes.

## 2. Tabla de Alta Densidad en "Detalle de Flujos y Sockets Geolocalizados" con Historial por Dispositivo
- **Filas Tabulares de Alta Densidad (`.conn-row-item`)**: Distribución en 5 columnas compactas (Dirección, Destino Remoto + Dominio + Servicio, Equipo Local + Puerto, Ubicación + ISP + Precisión GeoIP + Protocolo/Estado, y Acciones).
- **Historial SQLite Desplegable por Dispositivo (`toggleDeviceHistoryInline`)**: Botón `📜 Historial` en cada fila y cabecera de grupo que consulta `/api/net/history?device=<local_ip>` y despliega en línea (`.conn-dev-history-drawer`) los chips de servicios usados por ese dispositivo y sus conexiones históricas geolocalizadas.

## 3. Desglose Completo de Todos los Dispositivos en "Distribución de Ancho de Banda por Subredes y Grupos"
- **Lista Desglosada Siempre Visible (`.bw-pie-devices-breakdown`)**: En todos los modos (`Subredes`, `Grupos`, `Categorías` y `Dispositivos`), cada tarjeta de categoría muestra la lista completa de todos los dispositivos que la componen ordenados por consumo, con su icono, nombre, IP, tipo de enlace (`Eth` / `5G` / `2.4G`), barra de proporción, descarga (`↓`), subida (`↑`) y total.
