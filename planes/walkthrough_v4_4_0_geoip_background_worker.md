# Walkthrough v4.4.0 — Worker Asíncrono de GeoIP (`ip-api.com`) con Caché Multinivel para el Mapa de Conexiones

## 1. Resumen de la Arquitectura Implementada
Se ha diseñado e integrado un sistema completo de resolución **GeoIP asíncrona en segundo plano** contra `ip-api.com` tanto en el backend (`server.py` y `vite.config.ts`) como en el frontend (`index.html` y `static/index.html`) mediante un **Web Worker** dedicado y caché multinivel:

### A. Worker Asíncrono de Backend y Caché Persistente (`server.py` y `vite.config.ts`)
1. **Cola Asíncrona y Eventos de Despertado (`GEOIP_PENDING_QUEUE` + `GEOIP_WAKE_EVENT`)**:
   - Todas las IPs remotas públicas detectadas en sockets activos (`/proc/net/tcp`, `/proc/net/udp`, `psutil.net_connections`), clientes HTTP entrantes (`RECENT_HTTP_CLIENTS`), objetivos DNS salientes e IPs bloqueadas por Fail2ban se encolan automáticamente sin bloquear el hilo de métricas.
   - El worker despierta de inmediato cuando ingresan nuevas IPs no cacheadas y las agrupa en lotes de hasta 80 direcciones hacia `http://ip-api.com/batch?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query`.
2. **Caché en Memoria + Persistencia en Disco (`geoip_cache.json`)**:
   - Los resultados válidos se almacenan en `GEOIP_CACHE` (con TTL de 7 días y límite LRU de 2.000 IPs) y se guardan de forma atómica en `geoip_cache.json` para conservar la caché entre reinicios y reducir drásticamente las llamadas a `ip-api.com`.
   - **Caché Negativa (`GEOIP_NEGATIVE_CACHE`)**: Las IPs reservadas, CGNAT (`100.64.0.0/10`) o sin datos GeoIP reciben un enfriamiento de 15 minutos para no repetir consultas innecesarias a la API en cada ciclo.
   - **Control de Cuota (`X-Rl` y `X-Ttl`)**: Lectura de las cabeceras de límite de tasa de `ip-api.com` para pausar automáticamente las consultas en lote si la ventana de peticiones se agota.
3. **Nuevos Endpoints REST**:
   - `GET /api/net/geoip`: Expone las métricas del worker (`cached_ips`, `cache_hits`, `cache_misses`, `hit_rate_pct`, `api_batches_sent`, `pending_queue`, `rate_limit_remaining`, `last_sync`) y el estado de la caché.
   - `POST /api/net/geoip/resolve`: Resuelve en lote una lista de IPs solicitadas por el Web Worker del cliente devolviendo inmediatamente los aciertos en caché y consultando `ip-api.com` únicamente para las IPs faltantes.

### B. Web Worker Asíncrono en el Cliente (`GeoIpBackgroundWorker` en `index.html` / `static/index.html`)
1. **Hilo `Worker` en Segundo Plano (Blob URL)**:
   - Ejecuta la deduplicación, agrupación por lotes (debounce de 180ms) y peticiones asíncronas fuera del hilo principal de renderizado de la interfaz.
2. **Caché Cliente de Dos Niveles (`Map` + `localStorage`)**:
   - Mantiene hasta 1.000 registros GeoIP en `localStorage` (`recursos_geoip_cache_v1`) con TTL de 7 días.
   - Al recibir conexiones en `NetworkConnectionsMapEngine.renderFromMetrics()`, hidrata al instante cualquier conexión pendiente con los datos de la caché local (`0 ms`), cosecha las IPs ya resueltas por el servidor y envía al Web Worker únicamente las IPs públicas pendientes (`geo_status: "pending"`).
   - Cuando el Web Worker resuelve el lote, actualiza `latestMetrics` en caliente y redibuja suavemente los marcadores y líneas geodésicas en el mapa.
3. **Insignia Interactiva en la Cabecera del Mapa (`#geoIpWorkerStatusBadge`)**:
   - Muestra el estado en vivo (`🌐 GeoIP Caché: X IPs (Y% hit)` o `⏳ Worker GeoIP: Resolviendo N IPs...`) y permite sincronizar bajo demanda al hacer clic.
