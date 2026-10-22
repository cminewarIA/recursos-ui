# Walkthrough — v6.3.0: Historial SQLite por Servicios, Geolocalización Exacta y Mapa a Pantalla Completa con HUD Adaptativo

## 1. Resumen de Cambios Implementados

### A. Capa de Almacenamiento SQLite (`geoip_history.db`) y Geolocalización Dual (`server.py`)
- **Esquema SQLite en Modo WAL (`init_geoip_history_db`)**:
  - `geoip_locations`: persiste `ip`, `lat`, `lng`, `city`, `region`, `postal`, `country`, `country_code`, `isp`, `asn`, `accuracy_source` y `updated_at`.
  - `connection_history`: persiste cada flujo geolocalizado catalogado por servicio (`service`, `conn_key`, `direction`, `protocol`, `local_ip`, `local_hostname`, `remote_ip`, `remote_port`, `domain`, `process`, `jail`, `lat`, `lng`, `city`, `region`, `postal`, `country`, `isp`, `asn`, `accuracy_source`, `first_seen`, `last_seen`, `hit_count`) con índices en `service`, `local_ip`, `direction` y `last_seen DESC`.
- **Mayor Precisión de Ubicaciones IP (`_enrich_ip_precision_with_ipwhois`)**:
  - Se amplió la consulta por lotes de `ip-api.com` para incluir `zip` (código postal) y `regionName`.
  - Se añadió refinamiento cruzado con `https://ipwho.is/<ip>` para obtener código postal, región y promediado de coordenadas sub-urbanas (`accuracy_source = "ip-api+ipwho.is"`).
- **Nuevos Endpoints REST**:
  - `GET /api/net/history`: devuelve `summary`, `services_catalog` (agrupado por servicio con conteo de conexiones, hits acumulados, IPs únicas, dispositivos únicos, países y marcas de tiempo), `devices_catalog` y `connections` filtrables por `service`, `device`, `direction` y búsqueda libre `q`.
  - `POST /api/net/history/clear`: vacía el historial de conexiones bajo petición autenticada.

### B. Controles Adaptativos Integrados en el Mapa y Pantalla Completa (`index.html` / `static/index.html`)
- **HUD Adaptativo Dentro del Mapa (`#networkConnectionsMapAdaptiveHud`)**:
  - Integrado directamente dentro de `#networkConnectionsMapStageWrap` (`z-index: 1060`) para que todos los controles permanezcan accesibles tanto en vista normal como en modo **Pantalla Completa**.
  - Incluye selector de modo (`🟢 En Vivo` vs `📚 Historial por Servicios`), filtros de dirección/dispositivos (`Todas`, `↓ Entrantes`, `↑ Salientes`, `📱 Dispositivos`, `🛡️ Bloqueadas`), barra adaptativa de chips de dispositivos LAN (`#mapHudDeviceFilterBar`), cajón interactivo del catálogo de servicios (`#mapHudServiceCatalogDrawer`) y botón `⛶ Pantalla Completa`.
- **Modo Pantalla Completa (`toggleConnectionsMapFullscreen`)**:
  - Combina la API nativa `requestFullscreen()` con la clase `.is-fullscreen` (`100vw x 100vh`) y reajusta automáticamente el lienzo de Leaflet (`_leafletMap.invalidateSize()`).

## 2. Verificación Realizada
- Validación de sintaxis de Python (`python3 -m py_compile server.py`).
- Prueba funcional de `init_geoip_history_db()`, `save_geoip_locations_to_sqlite()`, `record_connections_to_sqlite()` y `query_connection_history_from_sqlite()`.
- Sincronización 100% idéntica entre `index.html` y `static/index.html`.
- Empaquetado `.deb` actualizado a `6.3.0` y verificación de compilación con `compile_applet`.
