# Plan de Implementación: Traducción de IPs Locales y Externas mediante Pi-hole (`v4.12.0`)

## 1. Contexto y Objetivos del Usuario
- El usuario ha solicitado: *"traduce las ip locales y las externa si pi hole las tiene"*.
- Objetivos:
  1. **IPs Locales (LAN)**: Traducir las direcciones de red interna (`192.168.50.x`) a nombres amigables de dispositivos del hogar utilizando la base de datos de Pi-hole FTL (`/etc/pihole/pihole-FTL.db`), `/etc/pihole/custom.list` y `/etc/hosts` (ej. `192.168.50.16` -> `tab-s9-ultra-de-yonah`, `192.168.50.187` -> `tv-de-la-sala-de-estar`, `192.168.50.74` -> `nintendo-switch-oled`, `192.168.50.252` -> `s25-yonah`).
  2. **IPs Externas (WAN)**: Traducir las direcciones IP públicas remotas a los nombres de dominio reales resueltos por Pi-hole mediante el análisis incremental y ultrarrápido de `/var/log/pihole/pihole.log` (`reply <domain> is <ip>`) y resolución PTR inversa de fallback (ej. `20.250.119.72` -> `api.github.com`, `172.217.119.4` -> `play.googleapis.com`, `1.1.1.1` -> `one.one.one.one`).
  3. **Visualización en el Dashboard**:
     - Mostrar los nombres de host locales en los detalles de las conexiones (saber exactamente qué dispositivo de la casa se conecta).
     - Mostrar los nombres de dominio en las insignias de los marcadores del mapa, en el diálogo popup de inspección y en la tabla interactiva de conexiones de red.
  4. **Control de Versión**:
     - Al tratarse de una nueva función, incrementar a `v4.12.0` (`0.X.0` según criterio de versión de `GEMINI.md`).

---

## 2. Cambios Propuestos

### Backend (`server.py`)
- Crear la clase `PiholeDnsTranslator`:
  - `refresh_local_names()`: Lee `/etc/pihole/custom.list`, `network_addresses` de `/etc/pihole/pihole-FTL.db`, `/etc/hosts` y `DEVICE_FRIENDLY_NAMES`.
  - `refresh_external_domains()`: Lector de log incremental sobre `/var/log/pihole/pihole.log` que extrae en menos de 1 ms las respuestas DNS (`reply domain is ip` y `reply ip is domain`).
  - Cache en memoria sincronizado en el hilo worker `fetch_connections_geo_worker()`.
- Enriquecer cada objeto de conexión en `connections_out`:
  - Campo `"local_hostname"`: Nombre del dispositivo LAN si Pi-hole lo tiene.
  - Campo `"domain"`: Dominio resuelto si Pi-hole lo tiene.
  - Actualizar `service` y `details` para incorporar el nombre del dispositivo local y el dominio.

### Frontend (`static/index.html` e `index.html`)
- Actualizar `getDynamicClusterLabel`: Si la conexión tiene `c.domain`, utilizarlo de forma preferente para que el marcador en el mapa muestre el dominio amigable (ej. `↓ play.googleapis.com`).
- Actualizar `buildInfoWindowNode`: Mostrar distintivo de dominio DNS Pi-hole y nombre del dispositivo de origen.
- Actualizar `buildGroupInfoWindowNode`: Mostrar dominios y nombres de dispositivos locales en la lista interactiva.
- Actualizar la tabla de conexiones (`networkConnectionsTableList`): Mostrar el distintivo `🌐 Dominio` y el nombre del dispositivo origen.

### Versión y Documentación
- `GEMINI.md`: Mantener reglas actualizadas.
- `VERSION` -> `4.12.0`
- `package.json` -> `"version": "4.12.0"`
- `README.md` -> Añadir sección `## ✨ Novedades en v4.12.0`.
- Documentar en `planes/2026-10-21_traduccion_ips_locales_y_externas_pihole.md` y `planes/walkthrough.md`.
