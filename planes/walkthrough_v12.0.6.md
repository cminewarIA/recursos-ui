# Walkthrough y Verificación v12.0.6 (v2B.0.6)

## Cambios Verificados

1. **Optimización del Backend y Eliminación de Spam PAM `sudo` (`server.py`)**:
   - **Ejecución directa con capacidades de kernel (`update_listening_ports_map` y `fetch_connections_geo_worker`)**: Intento directo de `ss -tulpn -H` y `conntrack -L` sin invocar `sudo` (aprovechando `AmbientCapabilities=CAP_NET_ADMIN CAP_DAC_READ_SEARCH CAP_SYS_PTRACE`), reservando `sudo -n` únicamente como respaldo en ejecuciones sin capacidades.
   - **Throttling de poda SQLite y sondeo GeoIP (`record_connections_to_sqlite`, `fetch_connections_geo_worker`)**: Limitación de la poda `DELETE FROM connection_history` a una ejecución cada `60s` (`_LAST_SQLITE_PRUNE_TS`), supresión de `maps.googleapis.com` de `outbound_targets` y espaciado de `30s` en reintentos DNS fallidos.
   - **Caché de Seguridad (`fetch_security_worker`)**: Memorización del parseo de `/var/log/fail2ban.log` por `(st_mtime, st_size)` y TTL de `18s` en las consultas agregadas a `/etc/pihole/pihole-FTL.db`.
   - **Serie `HISTORY["disk_pct"]`, Caché Asíncrona y Empalme en `/api/metrics`**: Registro continuo del porcentaje global de ocupación de almacenamiento en `HISTORY["disk_pct"]`, obtención no bloqueante de versión (`get_version_info_cached_async()`) y hash Git cacheado (`get_local_git_sha_cached()`), y ruta rápida en `do_GET("/api/metrics")` sirviendo `METRICS_CACHE_BYTES`.
   - **Normalización de APIs (`telegram_bot` y `duckdns`)**: Adición de `online` (junto a `running` coherente con el estado real) y `timestamp` en `/api/telegram_bot` / `record_tg_activity()`, así como `available` y `message` en DuckDNS (`get_duckdns_status()` / `update_duckdns_now()`).

2. **Reactividad de Subpestañas y Paridad en React 19 (`src/`)**:
   - Ampliación de `normalizeExternalRoute()` y nueva función `extractInitialSubTabFromRoute()` en [formatters.ts](./src/utils/formatters.ts).
   - Inicialización de `subTabHint` desde la ruta actual y propagación de `navTick` desde [App.tsx](./src/App.tsx) hacia [EquipmentView.tsx](./src/components/EquipmentView.tsx), [NetworkSecurityView.tsx](./src/components/NetworkSecurityView.tsx), [AppsMediaView.tsx](./src/components/AppsMediaView.tsx) y [MoreView.tsx](./src/components/MoreView.tsx) con `useEffect([initialSubTab, navTick])`.
   - Soporte directo de `logs` desde el enlace `"Abrir registro completo"` en [OverviewView.tsx](./src/components/OverviewView.tsx), desplegando automáticamente los registros técnicos en `MoreView`.
   - Compatibilidad en [NetworkSecurityView.tsx](./src/components/NetworkSecurityView.tsx) para `act.timestamp || act.time_str` y visualización del estado de servicio DDNS (`available ?? installed`).

3. **Pruebas y Validaciones Ejecutadas**:
   - `python3 -m py_compile server.py desktop_app/recursos_app.py`: `PY_COMPILE_OK`.
   - `npm run lint` (`tsc --noEmit`) y `npm run build` (`vite build`): `0` errores, `1669` módulos transformados, generando `static/index.html`.
   - Empaquetado e instalación Debian: `bash packaging/build_deb.sh` + `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.0.6_amd64.deb` completado sin errores.
   - Verificación nativa: `/usr/bin/recursos-cockpit --test-mode` (`[OK] Recursos Native Ubuntu HTML5 App v12.0.6 validated successfully.`) y `dpkg -l | grep recursos-cockpit` (`12.0.6 amd64`).
