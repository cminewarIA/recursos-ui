# Walkthrough v4.17.1 — Leyenda del mapa y desglose por dispositivo

## Problema
1. La leyenda inferior izquierda del mapa (Nodo Host, Entrante/Saliente, IP Bloqueada, Umbral NIC, OpenStreetMap) quedaba tapada por el mapa: Leaflet usa `z-index` 200–1000 y la leyenda tenía `z-index: 4`.
2. El filtro `📱 Dispositivos` mostraba una lista plana de sockets, sin desglosar por dispositivo.

## Cambios (`static/index.html` / `index.html`)
- `#networkConnectionsMapCanvas`: `position: relative; z-index: 0; isolation: isolate` (los panes de Leaflet quedan contenidos).
- `.connections-map-overlay-legend`: `z-index: 1050`; `.connections-map-status-overlay`: `z-index: 1100`.
- `NetworkConnectionsMapEngine.renderFromMetrics`: en modo `devices` agrupa por `local_ip`, enriquece con `wifi_clients` (nombre, icono, MAC, caudal y totales reales) → cabecera por dispositivo + filas de conexiones; chips `setConnectionsMapDevice(ip)` para filtrar el mapa a un solo dispositivo.
- Marcadores individuales en modo dispositivos: `dispositivo → destino`.
- Cero hardcoding: todo se deriva de telemetría en vivo.

## Verificación
- Servicio reiniciado, `/api/metrics` devuelve 160 conexiones, 40 de dispositivos LAN (Xbox, TV, Synology, móviles…).
