# Plan de Implementación v12.15.0 — Auditoría y Restauración Integral de todos los Planes Históricos del Mapa de Conexiones

## 1. Diagnóstico: ¿Por qué no estaban los cambios de los planes del mapa en la interfaz actual?

Tras auditar exhaustivamente todos los planes de implementación almacenados en `./planes/`, se identificaron **9 planes de implementación** en los que se solicitaron mejoras sobre el **Mapa de Conexiones (`Red -> Mapa de conexiones`)**:

1. **`planes/2026-10-21_mapa_solo_gratis_openstreetmap.md` (`v4.9.0`)** y **`planes/2026-10-21_correccion_watermark_carto_api_key_requerid.md` (`v4.9.2`)**:
   - Motor 100 % gratuito **OpenStreetMap + Leaflet** sin claves de API ni marcas de agua (`API key required`).
2. **`planes/2026-10-21_servicio_por_ip_y_bloqueo_en_mapa.md` (`v4.10.0`)**:
   - Identificación de servicio, protocolo y proceso local por IP (`service`, `protocol`, `process`), detección inteligente de cárcel Fail2ban (`sshd`, `caddy-scan`, `all`) y botón directo **Bloquear / Desbloquear IP** tanto dentro del popup del mapa como en las tarjetas inferiores.
3. **`planes/2026-10-21_agrupacion_conexiones_y_popup_persistente.md` (`v4.11.0`)**:
   - Agrupación visual de conexiones con insignia `🔀 N`, popup interactivo **Maestro-Detalle** (lista de IPs agrupadas -> clic en cualquier fila para inspeccionar su ficha completa -> botón `◀ Ver todas las conexiones (N)` para volver a la lista sin cerrar el globo) y persistencia del popup (`closePopupOnClick: false`, `closeOnClick: false`, `autoClose: false`).
4. **`planes/2026-10-21_cluster_dinamico_zoom_y_excluir_lan.md` (`v4.11.1`)**:
   - **Clustering dinámico por distancia en píxeles según el nivel de zoom** (`map.latLngToLayerPoint` con umbral `< 48 px` recalculado en `zoomend`) para que los marcadores se fusionen al alejar el mapa y se separen individualmente al acercar el zoom.
   - **Líneas de trayectoria (`L.polyline`)** desde el nodo central del servidor hasta cada clúster remoto coloreadas por tipo de tráfico.
   - **Exclusión estricta de IPs privadas LAN (`!c.is_lan`)** para que nunca aparezcan como chinchetas falsas en el mapa mundial.
5. **`planes/2026-10-21_persistencia_popups_y_regla_zero_hardcoding.md` (`v4.11.2`)**:
   - **Restauración multicriterio en 5 niveles** del popup abierto tras cada refresco de telemetría cada 2 s o tras hacer zoom (`clusterKey` -> `remoteIp` -> `representativeIp` -> `clusterIps` -> proximidad euclidiana `< 5°`) junto al guardia `isRedrawingMapRef`.
6. **`planes/2026-10-21_traduccion_ips_locales_y_externas_pihole.md` (`v4.12.0`)**:
   - Resolución y visualización del **dominio externo vía Pi-hole (`🌐 c.domain`)** y del **nombre amigable del dispositivo local del hogar (`📱 c.local_hostname · c.local_ip`)** en tooltips, popups y tarjetas.
7. **`planes/2026-10-21_flujos_conexiones_dispositivos_hogar_pihole.md` (`v4.13.0`)**:
   - **Barra de filtros interactivos del mapa** (`Todas (N)`, `↓ Entrantes (N)`, `↑ Salientes (N)`, `Dispositivos (N)`, `Bloqueadas (N)`) + buscador en tiempo real y botón `Centrar todo`.
8. **`planes/implementation_plan_v10.4.0.md` (`v10.4.0`)**:
   - **Franja simétrica de tráfico en tiempo real por conexión (`↓ Descarga rx_speed`, `↑ Carga tx_speed`, `∑ Total bytes_total`)** en cada cápsula de geolocalización y dentro del popup del mapa.
9. **`planes/implementation_plan_v12.11.0.md` y `v12.11.1.md`**:
   - Inicialización determinista con `setMapContainerEl` tras la transición de `<ViewStage>` y apertura encadenada a `moveend` en `flyTo`.

### Causa Raíz de la Ausencia en el Frontend Actual
- El backend en Python (`server.py`, función `fetch_connections_geo_worker`, líneas 4160–4264) **sí conservaba intactos todos los cálculos** (`domain`, `local_hostname`, `direction`, `jail`, `rx_speed`, `tx_speed`, `bytes_total`, `is_lan`, `server_node`, `summary`).
- Sin embargo, durante el rediseño integral de `v12.0.0` (`planes/implementation_plan_v12.0.0.md`), cuando se migró la interfaz desde el HTML monolítico antiguo (`NetworkConnectionsMapEngine` en `index.html`) hacia **React 19 + TypeScript (`src/components/NetworkSecurityView.tsx`)**, se escribió un componente de mapa simplificado que únicamente pintaba puntos básicos y omitía las funciones de los planes `v4.10.0` a `v10.4.0`.

---

## 2. Solución Implementada en v12.15.0

1. **`src/types/telemetry.ts`**:
   - Ampliación de `GeoConnectionItem` y `ConnectionsMapPayload` con todos los campos emitidos por `server.py` (`domain`, `local_hostname`, `protocol`, `jail`, `details`, `state`, `bytes_sent`, `bytes_received`, `bytes_total`, `tx_speed`, `rx_speed`, `total_speed`, `is_lan`, `summary`).
2. **`src/components/NetworkSecurityView.tsx`**:
   - **Exclusión de IPs LAN (`!c.is_lan`)** y conservación del nodo central `server_node` (`🏠`).
   - **Clustering dinámico en píxeles (`< 48 px`) reactivo al evento `zoomend`**, desagrupando automáticamente al hacer zoom in y agrupando con badge `🔀 N` al hacer zoom out.
   - **Polilíneas (`L.polyline`)** desde el servidor central hacia cada destino remoto según su estado (bloqueada, entrante, dispositivo del hogar o saliente).
   - **Popup interactivo Maestro-Detalle** con `closePopupOnClick: false`, `closeOnClick: false`, `autoClose: false`, navegación interna `data-select-conn-key` y `data-back-to-cluster`, más acciones directas `data-ban-ip` y `data-unban-ip` dentro del popup.
   - **Persistencia multicriterio en 5 niveles (`activePopupStateRef` + `isRedrawingMapRef`)** para que el popup abierto y la conexión inspeccionada no se cierren ni pierdan su vista durante las actualizaciones en vivo ni al hacer zoom.
   - **Barra de filtros interactivos (`Todas`, `↓ Entrantes`, `↑ Salientes`, `Dispositivos`, `Bloqueadas`)**, buscador instantáneo y botón `Centrar todo`.
   - **Cápsulas detalladas enriquecidas** con badge de dirección, dominio Pi-hole (`🌐`), dispositivo local (`📱`), franja simétrica de 3 columnas (`↓ Descarga`, `↑ Carga`, `∑ Total`) y conmutación entre **Bloquear** y **Desbloquear**.
3. **`i18n/dictionary.csv`**:
   - Registro de las 20 claves de internacionalización del mapa en `es` y `en`.
