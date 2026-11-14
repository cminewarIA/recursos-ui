# Plan de Implementación y Optimización Integral (`v12.0.6` · `v2B.0.6`)

## Objetivo
Revisar de extremo a extremo el proyecto `recursos-ui` (backend Python `server.py`, frontend React 19 + TypeScript `src/`, empaquetado `.deb` y documentación `README.md`), corregir inconsistencias de esquemas y navegación entre backend y UI, eliminar cuellos de botella de CPU/SQLite/subprocesos y erradicar el spam de sesiones PAM `sudo` en `journalctl`.

---

## Diagnóstico de la Auditoría

1. **Inundación de sesiones PAM `sudo` y sobrecarga de CPU en `server.py`**:
   - Aunque `system-dashboard.service` dispone de `AmbientCapabilities=CAP_NET_ADMIN CAP_DAC_READ_SEARCH CAP_SYS_PTRACE`, `update_listening_ports_map()` ejecutaba `sudo ss -tulpn -H` cada 20s y `fetch_connections_geo_worker()` ejecutaba `sudo -n conntrack -L` cada 2.5s, generando miles de registros PAM y lanzamientos innecesarios de `sudo`.
   - `record_connections_to_sqlite()` ejecutaba una poda `DELETE FROM connection_history WHERE id NOT IN (...)` cada **2.5 segundos** sobre hasta 5000 registros.
   - `fetch_connections_geo_worker()` conservaba `maps.googleapis.com` en `outbound_targets` (obsoleto tras migrar a OpenStreetMap/CARTO) y reintentaba resolución DNS fallida en cada ciclo de 2.5s.
   - `fetch_security_worker()` leía y aplicaba regex sobre todo `/var/log/fail2ban.log` y consultaba tablas completas de `/etc/pihole/pihole-FTL.db` cada 6 segundos.
   - `/api/metrics` ignoraba `METRICS_CACHE_BYTES`, copiaba el diccionario completo y ejecutaba `json.dumps()` en cada petición HTTP, mientras `do_GET` ejecutaba `git rev-parse HEAD` en cada carga de documento HTML.
2. **Discrepancias Backend ↔ Frontend**:
   - `HISTORY["disk_pct"]` existía en `vite.config.ts` y `OverviewView.tsx`/`EquipmentView.tsx`, pero faltaba en `server.py`, obligando a la UI a sintetizar un array plano de respaldo.
   - `/api/telegram_bot` no devolvía `bot_status.online` ni `timestamp` en las entradas de `activity`, por lo que `NetworkSecurityView.tsx` mostraba siempre `"Estado en segundo plano"` y fechas vacías.
   - `get_duckdns_status()` solo devolvía `installed` (no `available`) y `update_duckdns_now()` omitía `message`.
3. **Navegación de subpestañas y enlaces profundos en React 19 (`src/`)**:
   - `EquipmentView.tsx` y `MoreView.tsx` solo leían `initialSubTab` al montar el componente (`useState`), ignorando cambios posteriores (por ejemplo, pulsar el botón `v2B.0.6` de la barra superior mientras ya se estaba en `Más`).
   - `AppsMediaView.tsx` y `NetworkSecurityView.tsx` no aceptaban `initialSubTab`, e `App.tsx` no extraía subpestañas desde rutas directas (`/seguridad`, `/dns`, `/multimedia`, `/procesos`, `/dex`, etc.).
   - El enlace `"Abrir registro completo"` de `OverviewView.tsx` navegaba a `updates` sin desplegar los detalles técnicos con los avisos del sistema (`logs`).
4. **Documentación (`README.md`)**:
   - Comandos de ejemplo en las líneas 69, 78 y 82 desactualizados (`10.3.0`/`10.2.1`) y ausencia de entrada `v12.0.5` en el histórico de descargas directas.

---

## Cambios Planificados

1. **`server.py`**:
   - `_parse_ss_listening_output()` + ejecución directa sin `sudo` de `ss -tulpn -H` y `conntrack -L` aprovechando capacidades del kernel, con fallback a `sudo -n` solo cuando falten privilegios.
   - Poda SQLite de `connection_history` acotada a una vez cada `60s` (`_LAST_SQLITE_PRUNE_TS`).
   - Supresión de `maps.googleapis.com` y throttling de reintentos DNS (`30s`) en `fetch_connections_geo_worker()`.
   - Caché por `(st_mtime, st_size)` para `/var/log/fail2ban.log` y TTL de `18s` para Pi-hole SQLite en `fetch_security_worker()`.
   - Incorporación de `HISTORY["disk_pct"]`, `get_local_git_sha_cached()`, `get_version_info_cached_async()` no bloqueante y serialización rápida por empalme en `do_GET("/api/metrics")`.
   - Campos `online`, `running` coherente y `timestamp` en Telegram; campos `available` y `message` en DuckDNS.
2. **Frontend React 19 (`src/`)**:
   - `extractInitialSubTabFromRoute()` y ampliación de `normalizeExternalRoute()` en `src/utils/formatters.ts`.
   - Estado `subTabHint` inicializado desde URL y contador `navTick` en `src/App.tsx`.
   - Sincronización reactiva con `useEffect([initialSubTab, navTick])` en `EquipmentView.tsx`, `MoreView.tsx`, `AppsMediaView.tsx` y `NetworkSecurityView.tsx`.
   - Soporte `logs` en `MoreView.tsx` / `OverviewView.tsx`, compatibilidad `timestamp || time_str` en Telegram y estado `Servicio DDNS` en DuckDNS.
3. **Versionado (`12.0.6` · `v2B.0.6`), Compilación Web, `.deb`, Servicio Activo y Git**:
   - Sincronización en `VERSION`, `package.json`, `packaging/debian/control`, `README.md`, `planes/`.
   - Compilación `npm run lint` + `npm run build` (`static/index.html`).
   - Empaquetado e instalación de `dist/recursos-cockpit_12.0.6_amd64.deb`, prueba `--test-mode`, commit/tag/push en GitHub y sincronización de `/home/servidor/servicios/dashboard` con reinicio de `system-dashboard.service`.
