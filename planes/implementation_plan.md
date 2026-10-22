# Plan de Implementación — v6.3.0: Historial SQLite por Servicios, Geolocalización de Alta Precisión y HUD Adaptativo a Pantalla Completa en el Mapa

## 1. Objetivo
Dotar al Mapa Geoespacial de Red de:
1. **Capa de Persistencia SQLite (`geoip_history.db`) en `server.py`**:
   - Tabla `geoip_locations`: almacena las ubicaciones exactas de cada IP pública resuelta (`lat`, `lng`, `city`, `region`, `postal`, `country`, `country_code`, `isp`, `asn`, `accuracy_source`, `updated_at`).
   - Tabla `connection_history`: persiste el historial de todas las conexiones públicas geolocalizadas catalogadas por el **servicio** al que se conectaron (`service`, `conn_key`, `direction`, `protocol`, `local_ip`, `local_hostname`, `remote_ip`, `remote_port`, `domain`, `hit_count`, `first_seen`, `last_seen`, coordenadas y metadatos de precisión).
2. **Geolocalización Dual de Mayor Exactitud (`ip-api.com` + `ipwho.is`)**:
   - Solicitar código postal (`zip`) y región (`regionName`) en lotes de `ip-api.com`.
   - Enriquecer y refinar coordenadas sub-urbanas/locales con `ipwho.is` (`_enrich_ip_precision_with_ipwhois`) cuando faltan datos postales o como respaldo automático, registrando la fuente en `accuracy_source`.
3. **HUD Adaptativo Integrado en el Propio Mapa y Modo Pantalla Completa (`index.html` y `static/index.html`)**:
   - Integrar dentro de `#networkConnectionsMapStageWrap` la barra flotante `.connections-map-adaptive-hud` con:
     - Conmutador de modo `🟢 En Vivo` vs `📚 Historial por Servicios`.
     - Controles de filtrado (`Todas`, `↓ Entrantes`, `↑ Salientes`, `📱 Dispositivos`, `🛡️ Bloqueadas`).
     - Barra adaptativa de chips de dispositivos LAN (`#mapHudDeviceFilterBar`) directamente sobre el mapa.
     - Cajón interactivo del catálogo histórico de servicios (`#mapHudServiceCatalogDrawer`) con buscador en tiempo real y vaciado de base de datos con confirmación inline.
     - Botón `⛶ Pantalla Completa` (`toggleConnectionsMapFullscreen()`) con soporte para Fullscreen API nativa y fallback CSS `.is-fullscreen` + redimensionado automático de Leaflet (`invalidateSize()`).

## 2. Archivos Modificados
- `server.py`: Inicialización SQLite WAL (`init_geoip_history_db`), enriquecimiento dual GeoIP (`_enrich_ip_precision_with_ipwhois`), persistencia por lotes (`save_geoip_locations_to_sqlite`, `record_connections_to_sqlite`), consulta agregada por servicios (`query_connection_history_from_sqlite`) y endpoints `GET /api/net/history` y `POST /api/net/history/clear`.
- `index.html` y `static/index.html`: Estilos y estructura del HUD adaptativo dentro del mapa, modo Pantalla Completa y motor de catálogo histórico por servicios en `NetworkConnectionsMapEngine`.
- `VERSION` y `package.json`: Incremento `MINOR` a `6.3.0`.
- `README.md` y `planes/walkthrough.md`: Documentación actualizada.
