# Walkthrough v12.15.2 — Sincronización con `origin/main` (`v12.15.1`) e Integración de Optimizaciones CPU/RAM/SQLite/Gzip

- **Versión anterior**: `12.15.1` (`f875aef`)
- **Versión nueva**: `12.15.2` (`PATCH`)
- **Resumen**: Integración íntegra sobre la base `origin/main` (`v12.15.1`) de las mejoras de rendimiento backend, poda SQLite, compresión HTTP `gzip`, limpieza de timers Leaflet, variable TS sin usar y advertencias de Android Lint, junto a compilación `.deb` + `.apk`, despliegue en Android TV (`Xiaomi MiTV-AESP0`), producción (`/home/servidor/servicios/dashboard`) y sincronización completa con GitHub (`main` + tag `v12.15.2`).

## 1. Cambios Integrados sobre `v12.15.1`

- **[`server.py`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/server.py)**:
  - Índice `idx_geoip_updated_at` y poda automática de `geoip_locations` (`<=12,000` filas, `<=7` días) + `ORDER BY updated_at DESC LIMIT GEOIP_MAX_ENTRIES` en `load_geoip_disk_cache()` preservando `SERVER_SELF_GEO` dinámico sin valores fijos (`Zero-Hardcoding`).
  - Eliminado el upsert completo redundante en `save_geoip_disk_cache()`, espaciado `record_connections_to_sqlite()` a `>=12.0 s`, batching en `record_telemetry_sample_to_sqlite()` (`>=4` / `6.0 s`) y TTL pasivo de `fetch_system_logs()` a `18.0 s`.
  - Caché compartido `get_cached_inet_connections()`, resolución UID cacheada `_resolve_uid_name()`, omisión de `/proc/{pid}/io` para hilos sin RSS ni CPU, `cycle_counter % 3 == 1` para procesos, `GEOIP_WAKE_EVENT.wait(3.5)` y `_nvidia_pmon_snapshot()` condicional cuando haya procesos GPU o cada 30 s en reposo (`fetch_gpu_worker` a `2.5 s`).
  - Serialización JSON bajo demanda en `/api/metrics` + compresión `Content-Encoding: gzip` (`compresslevel=4`) en `/api/metrics` y `/api/metrics/history`, conservando las 4 curvas `net_wan_rx`, `net_wan_tx`, `net_lan_rx`, `net_lan_tx`.
- **Frontend ([`App.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/App.tsx) y [`NetworkSecurityView.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/NetworkSecurityView.tsx))**:
  - Eliminada variable declarada sin uso `dbTx` en `src/App.tsx` detectada con `--noUnusedLocals`.
  - Cancelación explícita de los `window.setTimeout` de `map.invalidateSize()` (`120 ms`, `360 ms`) en el `cleanup` del mapa Leaflet manteniendo `capture: true` de `v12.15.1`.
- **Android ([`ApiService.kt`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/android_app/app/src/main/java/com/cminewar/recursoscockpit/data/ApiService.kt) y recursos)**:
  - Retirado chequeo obsoleto `Build.VERSION.SDK_INT >= Build.VERSION_CODES.M`, limpiado `colors.xml` sin uso y cadenas huérfanas de `strings.xml`.
- **Permisos y Documentación**: Restaurado bit `+x` en `android_app/gradlew` y `packaging/*.sh`, actualizados [`VERSION`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/VERSION) y [`README.md`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/README.md) y retirados bundles Vite antiguos de `dist/assets/`.

## 2. Verificaciones Realizadas en `v12.15.2`

| Verificación | Resultado |
| :--- | :--- |
| Python estricto (`py_compile -W error::SyntaxWarning`) + TypeScript (`tsc --noEmit --noUnusedLocals --noUnusedParameters`) | 0 errores / 0 advertencias |
| Diccionario `i18n/dictionary.csv` + Manual (`cmp -s static/manual.html docs/index.html`) | 805 claves, `missing: 0`, manual sincronizado |
| Compilación Frontend (`npm run build`) | Vite `8.3.8` OK (`2.83 s`, bundle `static/index.html` y `dist/`) |
| Android Lint (`./gradlew lintDebug`) | `0 errors, 17 warnings` |
| Empaquetado Dual (`bash packaging/install_all.sh`) | `.deb` `12.15.2` firmado GPG + instalado (`--test-mode` OK); `.apk` `12.15.2` release firmada + instalada vía ADB en **Xiaomi MiTV-AESP0 (`192.168.50.30:5555`, `versionCode=121502`)** |
| Producción (`/home/servidor/servicios/dashboard`, `system-dashboard.service`) | `geoip_locations`: `12,000` filas con `idx_geoip_updated_at`; `telemetry_history`: `103,685` filas; `/api/metrics` con `gzip` (`224,493` → `37,461` bytes, `16.7%`); 4 series `WAN/LAN` presentes; CPU principal **`1.8%`**, `Thread-6` **`3.0%`**, `Thread-7` **`5.6%`** |
| Chrome Headless CDP (`/`, `/equipo`, `/red` con mapa Leaflet, `/programas`, `/mas` + móvil `390×844`) | `has12152: true` en las 5 vistas, `leaflet: true` en `/red`, `overflowX: false` (`scrollW: 390`), **`consoleErrors: []`**, **`exceptions: []`** |
| Salud OS (`systemctl --failed`) | `0 loaded units listed` |
