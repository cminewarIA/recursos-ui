# Walkthrough v4.5.0 — Utilería de Limpieza Periódica de `localStorage` para Caché GeoIP (`GEOIP_MAX_ENTRIES`)

## 1. Objetivo
Implementar una utilería de limpieza automática y periódica de `localStorage` (`GeoIpLocalStorageCleaner` / `pruneGeoIpLocalStorageCache`) para podar entradas GeoIP caducadas o antiguas cuando el total de entradas supere el límite `GEOIP_MAX_ENTRIES`, preservando el rendimiento de la interfaz y evitando el crecimiento indefinido del almacenamiento en el navegador.

## 2. Componentes Implementados (`index.html`, `static/index.html`, `server.py`)
1. **Constante de Límite `GEOIP_MAX_ENTRIES`**:
   - Definida en cliente (`const GEOIP_MAX_ENTRIES = 1000;`) y en el worker (`GeoIpBackgroundWorker.GEOIP_MAX_ENTRIES`), así como en el backend (`server.py` y `vite.config.ts` con `GEOIP_MAX_ENTRIES = 2000`).
2. **Utilería `GeoIpLocalStorageCleaner` y Helper `pruneGeoIpLocalStorageCache(options)`**:
   - **Purga por TTL (`GEOIP_CACHE_TTL_MS = 7 días`)**: Audita tanto el `Map` en memoria como el JSON persistido en `localStorage` (`recursos_geoip_cache_v1`), eliminando entradas cuya antigüedad supere el TTL o cuyas coordenadas sean inválidas, además de limpiar la caché negativa (`GEOIP_NEG_TTL_MS = 10 min`) y claves heredadas obsoletas.
   - **Desalojo por Capacidad (`GEOIP_MAX_ENTRIES`) con Recencia (`lastAccessed` / `ts`)**: Cada vez que se acierta una IP en caché (`processConnectionsList`), se actualiza su marca `lastAccessed`. Cuando el total de entradas supera `GEOIP_MAX_ENTRIES`, `pruneCache()` ordena las entradas por `Math.max(lastAccessed, ts)` descendente y poda las más antiguas compactando hasta el 90% del límite (`EVICTION_TARGET_RATIO = 0.9`) para evitar histéresis en inserciones sucesivas.
   - **Ejecución Periódica No Bloqueante (`startPeriodicCleanup`)**: Ejecuta un barrido cada `60 segundos` (`GEOIP_CLEANUP_INTERVAL_MS`) dentro de `window.requestIdleCallback` (con fallback a `setTimeout`) para no afectar los fotogramas de renderizado del mapa.
   - **Escritura Debounced y Recuperación ante `QuotaExceededError`**: Persistencia agrupada (`300 ms`) en `saveToLocalStorage()` y captura de `QuotaExceededError` con poda de emergencia del 50% más antiguo de las entradas.
3. **Visibilidad en la UI (`#geoIpWorkerStatusBadge`)**:
   - Muestra el uso actual frente al límite (`GeoIP Caché: X/1000 (Y% hit)`) y detalla en el tooltip el peso en `KB` dentro de `localStorage` y el número de entradas obsoletas podadas.
