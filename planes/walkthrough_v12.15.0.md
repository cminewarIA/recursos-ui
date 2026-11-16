# Walkthrough v12.15.0 — Restauración Integral de Todas las Funciones Históricas del Mapa de Conexiones

## 1. Resumen de Verificación
- **Versión Canónica (`./VERSION`)**: `12.15.0`
- **Causa Raíz Identificada**:
  - Entre `v4.9.0` y `v10.4.0` se implementaron 8 planes sucesivos de mejoras sobre el mapa en el motor clásico `NetworkConnectionsMapEngine` del HTML monolítico.
  - Al reescribir la interfaz desde cero en React 19 (`v12.0.0`), `src/components/NetworkSecurityView.tsx` implementó únicamente un visor básico de Leaflet, dejando de mostrar los metadatos que `server.py` (`fetch_connections_geo_worker`) seguía enviando en tiempo real.
- **Funciones Restauradas en `src/components/NetworkSecurityView.tsx`**:
  1. **Exclusión de IPs LAN (`v4.11.1`)**: Filtrado `!c.is_lan || c.is_server_node` para evitar chinchetas falsas de red local en el mapa mundial.
  2. **Clustering Dinámico por Zoom (`v4.11.1`)**: Agrupación automática por distancia en pantalla (`map.latLngToLayerPoint < 48px`) suscrita a `zoomend`, fusionando marcadores cercanos con insignia `🔀 N` al alejar el mapa y separándolos al acercar el zoom.
  3. **Líneas de Trayectoria (`v4.11.1`)**: Trazado de `L.polyline` desde el nodo central del servidor (`🏠`) hacia cada clúster remoto con color semántico según dirección/estado.
  4. **Popup Interactivo Maestro-Detalle y Bloqueo Fail2ban (`v4.10.0` y `v4.11.0`)**: Selección de cualquier conexión dentro de un clúster (`Ver detalle ->`), botón `◀ Ver todas las conexiones (N)` para regresar al listado del grupo sin cerrar el popup, y botón directo **Bloquear / Desbloquear IP** con detección de cárcel Fail2ban (`sshd`, `caddy-scan`, `all`).
  5. **Persistencia Multicriterio en 5 Niveles (`v4.11.2`)**: Conservación automática del popup abierto y de la sub-conexión seleccionada a través de refrescos de telemetría y cambios de zoom (`clusterKey` -> `remoteIp` -> `representativeIp` -> `clusterIps` -> proximidad `< 5°`).
  6. **Dominios Pi-hole y Dispositivos del Hogar (`v4.12.0`)**: Visualización de `🌐 c.domain` y `📱 c.local_hostname (c.local_ip)` tanto en los popups del mapa como en las tarjetas inferiores.
  7. **Barra de Filtros Interactivos y Buscador (`v4.13.0`)**: Filtros con contadores en vivo (`Todas`, `↓ Entrantes`, `↑ Salientes`, `Dispositivos`, `Bloqueadas`), buscador instantáneo y botón `Centrar todo`.
  8. **Velocidad de Subida/Bajada y Bytes Totales por Conexión (`v10.4.0`)**: Franja simétrica de 3 columnas (`↓ Descarga`, `↑ Carga`, `∑ Total`) en cada tarjeta de geolocalización y en el popup del mapa.

## 2. Validación de Compilación y Empaquetado
- `npm run build` y `npm run lint`: **OK** (0 errores).
- `bash packaging/build_deb.sh`: Paquete `./dist/recursos-cockpit_12.15.0_amd64.deb` generado, instalado y verificado con `/usr/bin/recursos-cockpit --test-mode` (`SELF_TEST_OK version=12.15.0`).
