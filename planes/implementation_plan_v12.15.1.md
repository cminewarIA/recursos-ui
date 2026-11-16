# Plan de Implementación v12.15.1 — Depuración Integral de Código (Frontend, Backend, Diccionario CSV y Middleware de Desarrollo)

## 1. Hallazgos de la Auditoría de Depuración (`v12.15.1`)

1. **Diccionario i18n (`./i18n/dictionary.csv`) y Etiquetas del Mapa (`NetworkSecurityView.tsx`)**:
   - Las claves `network.map_filter_all`, `network.map_filter_incoming`, `network.map_filter_outgoing`, `network.map_filter_devices` y `network.map_filter_blocked` contenían `({count})` literal en `./i18n/dictionary.csv`, mientras el botón ya renderizaba su propio badge numérico `<span>{f.count}</span>`, provocando que apareciera `({count})` sin interpolar junto al contador.
   - Asimismo, las etiquetas `network.map_filter_incoming`, `network.map_filter_outgoing`, `network.map_direction_in`, `network.map_direction_out`, `network.map_traffic_rx`, `network.map_traffic_tx` y `network.map_traffic_total` ya incluían los símbolos `↓`, `↑` y `∑` en el CSV y además se anteponían en JSX, duplicando el icono (`↓ ↓`).

2. **Delegación de Eventos en Popups de Leaflet (`NetworkSecurityView.tsx`)**:
   - Leaflet registra `L.DomEvent.disableClickPropagation` sobre `.leaflet-popup`, deteniendo la propagación en fase de burbujeo (*bubbling*). Al registrar `mapContainerEl.addEventListener('click', handlePopupActionClick, true)` en **fase de captura (`capture: true`)**, los clics sobre `[data-select-conn]`, `[data-back-cluster]`, `[data-ban-ip]` y `[data-unban-ip]` dentro del popup se interceptan siempre antes de que Leaflet detenga el burbujeo.

3. **Cumplimiento Zero-Hardcoding en `SERVER_SELF_GEO` (`server.py`)**:
   - En `server.py` (`load_geoip_disk_cache` y `fetch_connections_geo_worker`), cuando `ip-api.com/json` devolvía la geolocalización pública del servidor, se sobreescribían `lat`, `lng` y `city` con valores estáticos por defecto salvo que existieran variables de entorno. Ahora toma directamente `sdata.get("lat")`, `sdata.get("lon")`, `sdata.get("city")` y `sdata.get("country")` de la telemetría real (respetando overrides opcionales `SERVER_GEO_*`).

4. **Sincronización de Endpoints y 4 Curvas WAN/LAN en el Servidor Vite (`vite.config.ts`)**:
   - Añadidos handlers JSON para `/api/auth/restore-session`, `/api/auth/unlock` y `/api/auth/session` para evitar respuestas HTML por fallback SPA.
   - Incorporadas las 4 series `net_wan_rx`, `net_wan_tx`, `net_lan_rx`, `net_lan_tx` en `sampleRealNetwork()`, `nicHistory2h`, `historyBuffer` y `/api/metrics/history`.
   - Sincronizado el estado de bloqueos de Fail2ban (`__viteFail2banBans`) tanto en `metrics.security.fail2ban` como en `connections_map` (incluyendo `domain`, `local_hostname`, `jail` y velocidades `rx_speed`, `tx_speed`, `bytes_total`).
   - Añadido `git config --global --add safe.directory` y limpieza de artefactos compilados (`static/index.html`, `dist/`) antes de `git pull` en `/api/system/update`.
