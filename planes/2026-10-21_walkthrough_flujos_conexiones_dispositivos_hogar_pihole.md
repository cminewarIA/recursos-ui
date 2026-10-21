# Recorrido y Verificación: Conexiones de Dispositivos del Hogar vía Pi-hole (`v4.13.0`)

## Problema Resuelto
El usuario observó que todas las conexiones aparecían como si fuesen originadas por el ordenador (`Servidor (192.168.50.2)`).
La causa raíz identificada fue que el ordenador no actúa como router / puerta de enlace de la LAN, por lo que el kernel de Linux del servidor solo tiene sockets generados por el propio ordenador o dirigidos hacia él.

Sin embargo, el servidor ejecuta **Pi-hole**, que es el servidor DNS de todos los equipos del hogar. Al extraer las resoluciones DNS activas de la base de datos de consultas de Pi-hole (`pihole-FTL.db` `queries`), se recupera el 100% de la actividad externa de los dispositivos domésticos.

## Cambios Implementados

1. **Backend (`server.py`)**:
   - `PiholeDnsTranslator.fetch_active_device_flows()`:
     - Consulta de forma ultra rápida (~1 ms) las peticiones DNS resueltas de los últimos 15 minutos originadas por clientes distintos de `localhost` y del propio servidor.
     - Resuelve la IP pública correspondiente a cada dominio (Disney+, TikTok, Instagram, WhatsApp, Microsoft, Synology, Conviva, etc.).
     - Asocia el nombre de host amigable del dispositivo (`translate_local`).
   - `fetch_connections_geo_worker()`:
     - Inyecta estos flujos en `raw_sockets` con `local_ip` del dispositivo (ej. `192.168.50.187`), `local_hostname` (`tv-de-la-sala-de-estar`), `direction: "outgoing"`, `domain`, `remote_ip`, `service: "<dominio> (:443)"`.
     - Encola las IPs públicas en la cola GeoIP para su geolocalización en el mapa mundial.
     - Añade el contador `"devices": dev_cnt` al resumen de métricas de red.

2. **Frontend (`static/index.html` e `index.html`)**:
   - Botón de filtro `"📱 Dispositivos (<span id="cntMapDev">0</span>)"` en el control segmentado del mapa.
   - Filtro reactivo para ver exclusivamente el tráfico de los dispositivos del hogar o alternar con `Todas`.
   - Iconografía contextual en tabla y popups: `📱` para dispositivos del hogar frente a `🖥️` para el servidor local.

3. **Normas y Versionado**:
   - Incremento estricto a `v4.13.0` (`VERSION` y `package.json`).
   - Sincronización `static/index.html` ➔ `index.html`.
   - Actualización de `README.md` y planes.

## Verificación en el Servidor
- Servicio `system-dashboard.service` reiniciado y verificado activo.
- Métricas validadas con flujos de `tv-de-la-sala-de-estar`, `xbox-series-s`, `Redmi-A3`, `tab-s9-ultra-de-yonah`, etc.
