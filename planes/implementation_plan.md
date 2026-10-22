# Plan de Implementación — v6.3.0: Mapa Geoespacial Adaptativo en Pantalla Completa con Historial por Servicios y Precisión GeoIP en SQLite

## 1. Decisiones de Arquitectura Confirmadas
- **Interfaz Adaptativa Dentro del Mapa (HUD Flotante)**: Barra superior flotante translúcida (`.connections-map-adaptive-hud`) integrada dentro del contenedor `#networkConnectionsMapStageWrap`, equipada con selector de modo (`🟢 En Vivo` vs `📚 Historial por Servicios`), filtros de dirección/dispositivos, barra adaptativa de chips de dispositivos LAN (`#mapHudDeviceFilterBar`), panel desplegable colapsable de Catálogo de Servicios (`#mapHudServiceCatalogDrawer`) y botón de **Pantalla Completa (`⛶`)** operativo en todo momento.
- **Estructura del Historial en SQLite (`geoip_history.db`)**: Agrupación deduplicada (`UPSERT`) por servicio, dispositivo e IP remota con contador incremental de conexiones (`hit_count`) y marcas de tiempo (`first_seen`, `last_seen`), complementada con filtro de ventana temporal (`hours`).
- **Geolocalización de Alta Exactitud Combinada (`ip-api.com` + `ipwho.is`)**: Consulta en lote a `ip-api.com` incluyendo distrito (`district`), código postal (`zip`) y región (`regionName`), refinando coordenadas sub-urbanas y metadatos ISP/ASN con `ipwho.is` (`_enrich_ip_precision_with_ipwhois`) y cacheando de forma persistente en la tabla SQLite `geoip_locations`.

## 2. Componentes Implementados
1. **Capa de Persistencia SQLite (`geoip_history.db`) en `server.py`**:
   - Tabla `geoip_locations`: almacena las ubicaciones exactas de cada IP pública resuelta (`lat`, `lng`, `city`, `region`, `postal`, `country`, `country_code`, `isp`, `asn`, `accuracy_source`, `updated_at`).
   - Tabla `connection_history`: persiste el historial de todas las conexiones públicas geolocalizadas catalogadas por el **servicio** al que se conectaron (`service`, `conn_key`, `direction`, `protocol`, `local_ip`, `local_hostname`, `remote_ip`, `remote_port`, `domain`, `hit_count`, `first_seen`, `last_seen`, coordenadas y metadatos de precisión).
   - Endpoints REST: `GET /api/net/history` (con soporte de filtrado por `service`, `device`, `direction`, `q`, `hours` y `limit`) y `POST /api/net/history/clear`.
2. **HUD Adaptativo y Modo Pantalla Completa (`index.html` y `static/index.html`)**:
   - Controles integrados directamente en `#networkConnectionsMapStageWrap` para operar sin interrupciones tanto en vista estándar como en Pantalla Completa (`100vw × 100vh`).
   - Panel desplegable de servicios con buscador en tiempo real, selector de ventana temporal (`Todo el historial`, `Últimas 6h`, `Últimas 24h`, `Últimos 7 días`), cifras tabulares (`tabular-nums`) con contador `hit_count` (`x`) y vaciado de base de datos con confirmación inline.
