# Plan de Implementación: Flujos de Conexión de Dispositivos del Hogar vía Pi-hole (`v4.13.0`)

## Problema Detectado
El usuario indica: *"todas las conecciones las veo como si fuese del ordenador"*.
Actualmente:
1. El servidor (`192.168.50.2`) NO es la puerta de enlace predeterminada (default gateway) de los dispositivos de la casa; la puerta de enlace es el router (`192.168.50.1`).
2. Por ello, el tráfico TCP/UDP directo de tabletas, móviles, televisores y consolas hacia Internet no pasa por la interfaz de red del servidor y no existe en `conntrack` del servidor.
3. El worker anterior (`fetch_connections_geo_worker`) únicamente consultaba `psutil.net_connections()` (los sockets abiertos en el propio ordenador `192.168.50.2`), por lo que el 100% de las conexiones figuraban con `local_ip: 192.168.50.2` y `local_hostname: Servidor`.
4. Sin embargo, el servidor ejecuta **Pi-hole**, que SÍ es el servidor DNS de TODOS los dispositivos del hogar (`tab-s9-ultra`, `s25-yonah`, `xbox-series-s`, `tv-sala-estar`, `redmi-a3`, etc.), registrando en `/etc/pihole/pihole-FTL.db` (`queries`) todas sus conexiones hacia servicios de Internet en tiempo real (Disney+, TikTok, Instagram, WhatsApp, Microsoft, etc.).

## Solución Propuesta

### 1. Backend (`server.py`)
- Añadir en `PiholeDnsTranslator` el método `fetch_active_device_flows(cutoff_seconds=900, max_entries=50)`:
  - Consulta en SQLite (`mode=ro`) la vista `queries` de `/etc/pihole/pihole-FTL.db` buscando peticiones no locales (`client NOT IN ('127.0.0.1', '::1', SERVER_LOCAL_IP)`) y exitosas (`status IN (1, 2, 3, 14, 17)`) de los últimos 15 minutos.
  - Para cada petición, extrae el nombre del dispositivo (`translate_local(client)`), el dominio consultado y resuelve la IP remota pública (`ext_cache` o resolución DNS).
  - Devuelve los flujos activos de los equipos del hogar.
- En `fetch_connections_geo_worker()`:
  - Invocar `pihole_translator.fetch_active_device_flows()` e inyectar cada flujo en `raw_sockets` y `connections_out`:
    - `local_ip`: IP privada del dispositivo (ej. `192.168.50.187`).
    - `local_hostname`: Nombre amigable (`tv-de-la-sala-de-estar`).
    - `remote_ip`: IP pública del servicio.
    - `domain`: Dominio resuelto (`disney.connections.edge.bamgrid.com`).
    - `service`: Título del servicio (`Disney+ Streaming`, `TikTok CDN`, etc.).
    - `direction`: `"outgoing"`.
    - `details`: `Saliente desde tv-de-la-sala-de-estar (192.168.50.187) hacia disney.connections.edge.bamgrid.com (52.222.132.53)`.
    - `process`: `"Pi-hole DNS Flow"`.
    - `state`: `"ACTIVE"`.
  - Encolar las IPs públicas remotas en el worker GeoIP para que aparezcan geolocalizadas en el mapa mundial.

### 2. Frontend (`static/index.html` e `index.html`)
- Añadir botón de filtro `"📱 Dispositivos"` en el control segmentado del mapa (`fMapConnDev`):
  - `Todas (N)` | `↓ Entrantes (N)` | `↑ Salientes (N)` | `📱 Dispositivos (N)` | `🛡️ Bloqueadas (N)`.
  - Permite filtrar al instante para ver exclusivamente el tráfico generado por los dispositivos de la casa.
- En la tabla de conexiones y en los popups del mapa:
  - Mostrar el icono y nombre del dispositivo de origen (`tv-de-la-sala-de-estar`, `xbox-series-s`, `Redmi-A3`) para diferenciar de forma inmediata el tráfico del servidor del tráfico del hogar.

### 3. Versionado y Documentación
- Incrementar versión canónica a `v4.13.0` (Regla 5).
- Sincronizar `static/index.html` ➔ `index.html`.
- Actualizar `README.md`, bitácoras y `planes/walkthrough.md`.
- Reiniciar `system-dashboard.service`, verificar y ejecutar `git push origin main`.
