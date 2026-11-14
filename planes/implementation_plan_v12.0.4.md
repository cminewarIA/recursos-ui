# Plan de Implementación v12.0.4 (v2B.0.4) — Telemetría Real de Banda/Cable desde Router ASUS AiMesh y Corrección Integral de Esquema en Programas & Vistas React 19

## Diagnóstico de Problemas Detectados

1. **Etiqueta imprecisa `"LAN / 5 GHz"` en clientes de red (`server.py` · `fetch_wifi_worker`)**:
   - Los dispositivos descubiertos únicamente mediante el respaldo `ip neigh` recibían la etiqueta híbrida `"LAN / 5 GHz"` en lugar de distinguir si estaban cableados o en `2.4 GHz` / `5 GHz`.
   - Aunque la base de datos de Pi-hole (`/etc/pihole/pihole-FTL.db`) únicamente registra la interfaz Ethernet local del servidor (`enp7s0`), el router principal **ASUS AiMesh** conectado por LAN expone en `/tmp/clientlist.json` y `brctl showmacs br0` las asociaciones exactas por nodo AiMesh (`2G`, `5G`, `6G` y `wired_mac`).
   - Adicionalmente, dado que el nodo AiMesh secundario utiliza *backhaul* cableado hacia el nodo principal, sus clientes inalámbricos figuran simultáneamente en `wired_mac` del nodo principal y en `2G`/`5G` del nodo secundario, por lo que es obligatorio recolectar primero todas las asociaciones Wi-Fi de todos los nodos AiMesh antes de consolidar `router_wired_map`.

2. **Cierre inesperado / pantalla en blanco en la pestaña `Programas` (`AppsMediaView.tsx`) y desajustes de esquema Backend ↔ Frontend**:
   - **Crash fatal en Docker (`AppsMediaView.tsx`)**: `fetch_docker_worker()` emitía `"cpu_percent"` y `"mem_percent"` como cadenas (`"6.57%"`), provocando un `TypeError` en tiempo de ejecución al invocar `.toFixed(1)` en React 19.
   - **Progreso de torrents al `10000 %`**: `server.py` ya emitía `"progress"` en escala `0..100` (`round(progress * 100, 1)`), y `AppsMediaView.tsx` volvía a multiplicarlo por `100`.
   - **Campos desalineados en Systemd, Emby, Pi-hole, Fail2ban, Errores y Logs**: Discrepancias de nombres de clave entre `server.py` y las vistas React (`active`/`state`/`role` vs `active_state`/`description`; `emby.available`/`movies_count`/`recent_media` vs `emby.online`/`library_counts`; `pihole.available`/`dns_queries_today`/`ads_blocked_today` vs `online`/`total_queries`/`blocked_today`; `fail2ban.available` vs `active`; `system_errors_summary.total` vs `total_errors`; `version`/`local_hash`/`remote_hash` y `time_str`/`source`).

## Cambios Implementados

1. **Almacenamiento seguro Zero-Hardcoding de credenciales del router (`.router_credentials.json`, `.gitignore`, `server.py`)**:
   - Carga mediante `_load_router_credentials()` con prioridad: variables de entorno (`RECURSOS_ROUTER_*`), archivo local ignorado por Git `.router_credentials.json` (permisos `0600`) y autodescubrimiento de puerta de enlace (`_detect_default_gateway_ip()`).

2. **Extracción real de banda Wi-Fi y enlace cableado en `fetch_wifi_worker` (`server.py`)**:
   - Consulta vía SSH al router ASUS AiMesh (`/tmp/clientlist.json`, `brctl showmacs br0`, `wl -i eth5/eth6 assoclist` y `sta_info`).
   - Parser en 2 pasadas que clasifica primero los clientes `"2G"`/`"5G"`/`"6G"` de todos los nodos AiMesh e incorpora posteriormente `"wired_mac"` + MACs activas de `br0` (`is local? == no` y no Wi-Fi) como `"Cable LAN"`.
   - Sustitución definitiva de `"LAN / 5 GHz"` en el respaldo `ip neigh` por `"Cable LAN"`, `"2.4 GHz"` o `"Wi-Fi 5 GHz"` y normalización de `online`, `is_online`, `is_server`, `is_gateway`, `vendor`, `wired_clients`, `band_24g`, `band_5g`, `online_clients`, `router_ip` y `router_online`.

3. **Normalización de esquema en `server.py`, `src/types/telemetry.ts` y vistas React 19 (`AppsMediaView.tsx`, `NetworkSecurityView.tsx`, `OverviewView.tsx`, `MoreView.tsx`)**:
   - Emisión numérica de `cpu_percent`/`mem_percent` + `image` en `fetch_docker_worker()`, alias compatibles en `systemd_services`, `emby`, `pihole`, `fail2ban`, `system_errors_summary` y `/api/version`.
   - Tolerancia defensiva en `AppsMediaView.tsx` (`toNum()`), corrección del porcentaje de torrents (`0..100 %`), visualización de catálogo y añadidos recientes de Emby cuando no hay streams activos, y respaldos de compatibilidad en `OverviewView.tsx`, `NetworkSecurityView.tsx` y `MoreView.tsx`.

4. **Sincronización Canónica, Paquete `.deb` y Documentación (`VERSION`, `package.json`, `packaging/debian/control`, `README.md`)**:
   - Incremento `PATCH` a `12.0.4` (`v2B.0.4`), compilación web (`npm run lint`, `npm run build`), validación Python (`py_compile`), verificación en vivo sobre `/api/metrics`, compilación e instalación de `dist/recursos-cockpit_12.0.4_amd64.deb` y publicación en GitHub.
