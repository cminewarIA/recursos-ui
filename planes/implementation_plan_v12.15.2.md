# Plan de Implementación v12.15.2 — Integración de Optimización CPU/RAM/SQLite/Gzip y Limpieza Estática sobre Base `v12.15.1`

- **Versión base**: `12.15.1` (`origin/main`, commit `f875aef`)
- **Nueva versión**: `12.15.2` (`PATCH` — portabilidad íntegra de las mejoras de rendimiento backend, SQLite, ancho de banda HTTP, limpieza de timers y lint Android preservando al 100 % las funciones `v12.15.1` como 4 curvas WAN/LAN, mapa Leaflet `capture: true`, 805 claves CSV y Zero-Hardcoding de `SERVER_SELF_GEO`).

## Cambios Incluidos

1. **Backend y SQLite ([`server.py`](./server.py))**:
   - Añadir índice `idx_geoip_updated_at` sobre `geoip_locations(updated_at DESC)` en `init_geoip_history_db()` y poda automática (>7 días / tope 12 000 IPs + `PRAGMA wal_checkpoint(TRUNCATE)` cuando proceda).
   - Acotar `load_geoip_disk_cache()` (`ORDER BY updated_at DESC LIMIT GEOIP_MAX_ENTRIES`) evitando re-escribir filas leídas de SQLite y conservando intacto `SERVER_SELF_GEO` dinámico de `v12.15.1`.
   - Eliminar el upsert redundante completo de `GEOIP_CACHE` en `save_geoip_disk_cache()`.
   - Espaciar `record_connections_to_sqlite()` a `>=12.0 s`, agrupar `record_telemetry_sample_to_sqlite()` (`>=4` muestras / `6.0 s`) y ampliar el TTL pasivo de `fetch_system_logs()` a `18.0 s` (con `force=True` inmediato bajo demanda).
   - Compartir instantánea `get_cached_inet_connections()` entre `fetch_connections_geo_worker` y `get_system_processes()`; añadir caché UID `_resolve_uid_name()`, omitir `/proc/{pid}/io` en hilos sin RSS/CPU y ajustar cadencia (`cycle_counter % 3 == 1`, `GEOIP_WAKE_EVENT.wait(3.5)`).
   - Consultar `_nvidia_pmon_snapshot()` en `get_gpu_info()` solo cuando existan procesos GPU o cada 30 s en reposo (`fetch_gpu_worker` a `2.5 s`).
   - Serialización JSON perezosa bajo demanda en `/api/metrics` + compresión `Accept-Encoding: gzip` (`compresslevel=4`) en `/api/metrics` y `/api/metrics/history`.

2. **Frontend y Android**:
   - [`src/components/NetworkSecurityView.tsx`](./src/components/NetworkSecurityView.tsx): Cancelar explícitamente ambos `window.setTimeout` (`invalidateSize`) en la función de limpieza del `useEffect`, manteniendo la delegación `capture: true` de `v12.15.1`.
   - [`android_app/`](./android_app): Retirar chequeo obsoleto `SDK_INT >= M` en `ApiService.kt`, limpiar `colors.xml` no usado y cadenas huérfanas de `strings.xml`.

3. **Empaquetado, Despliegue y Sincronización Total**:
   - Validar compilación Python, TypeScript estricto, diccionario CSV, manual HTML, `npm run build` y Android `lintDebug`.
   - Compilar e instalar `.deb` + `.apk` (`bash packaging/install_all.sh`), sincronizar con producción (`/home/servidor/servicios/dashboard` sin alterar `recursos_history.db` ni credenciales), comprobar caída real de CPU/RAM en vivo y subir commit + tag `v12.15.2` a `origin/main` en GitHub.
