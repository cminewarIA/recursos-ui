# Plan de Implementación v12.16.0 — Inspección Táctil de Dispositivos y Velocidad Global del Router en Banner Principal

- **Versión base**: `12.15.2` (`1e65290`)
- **Nueva versión**: `12.16.0` (`MINOR` — incorpora dos nuevos widgets interactivos en el banner principal y modal de inspección táctil multi-fuente para base de datos de dispositivos y ordenación de tráfico en tiempo real).

## 1. Backend ([`server.py`](./server.py) y [`vite.config.ts`](./vite.config.ts))

1. **Desglose de Tráfico Router Global vs LAN por Flujo (`/proc/fcache/l2list`) y Gateway Dinámico (`Zero-Hardcoding`)**:
   - Detección dinámica del MAC del gateway (`gw_mac`) vía `_detect_default_gateway_ip()` + `arp_map` / tabla ARP del router.
   - Descubrimiento pasivo UPnP IGD del gateway (`_discover_gateway_upnp_info(gw_ip)`, caché 300 s) obteniendo fabricante y modelo reales (`manufacturer`, `modelName`, `friendlyName`) y modelo del router ASUS (`nvram get productid`) + tabla ARP desde SSH.
   - Rastreo delta por `FlowObject` en `/proc/fcache/l2list` (`_FCACHE_FLOW_PREV`) para no perder incrementos de flujos activos al expirar flujos antiguos y estimar tamaño de paquete desde `SW_TotHits:TotalBytes` / `ACK_PRIO`.
   - Separación explícita en cada dispositivo y en el agregado del router:
     - `wan_speed_down` / `wan_speed_up`: flujos entre el dispositivo y `gw_mac` (Internet).
     - `lan_speed_down` / `lan_speed_up`: flujos internos entre equipos LAN (evitando contaminar la velocidad de Internet con copias NAS/LAN).
     - `router_wan_rx_bytes_sec` / `router_wan_tx_bytes_sec` en `wifi_summary` + respaldo del servidor `_SERVER_DIRECT_NET_SPEEDS` cuando proceda.
   - Reducción del intervalo de `fetch_wifi_worker()` de `12 s` a `5 s` (~323 ms SSH) para actualización ágil en vivo sin carga significativa.

2. **Base de Datos Multi-Fuente (`Pi-hole · ASUS · Gateway/Vodafone`) y Endpoint `GET /api/network/devices-db`**:
   - Etiquetado de origen `sources: ("pihole" | "asus" | "gateway" | "arp" | "server")[]`, `pihole_queries`, `first_seen_ts`, `last_seen_ts`, `asus_node` en `wifi_clients`.
   - Nuevo endpoint autenticado y cacheado `GET /api/network/devices-db` (con compresión `gzip`) que combina en vivo los dispositivos activos con el catálogo completo de Pi-hole (`/etc/pihole/pihole-FTL.db` tablas `network` + `network_addresses`), dispositivos reportados por el router ASUS (`brctl`, `wl`, `/tmp/*clientlist.json`, `/proc/fcache/l2list`) y dispositivos vinculados con el Gateway (`gw_mac` / ARP / SSDP UPnP), sin engordar `/api/metrics` en reposo.
   - Paridad equivalente añadida en el servidor de desarrollo [`vite.config.ts`](./vite.config.ts).

## 2. Frontend React 19, Tipos e i18n

1. **Tipos y Diccionario ([`src/types/telemetry.ts`](./src/types/telemetry.ts) y [`./i18n/dictionary.csv`](./i18n/dictionary.csv))**:
   - Añadir campos opcionales de velocidad WAN/LAN y fuentes en `WifiClient`, `WifiSummary` y `NetworkDevicesDbResponse`.
   - Registrar en `./i18n/dictionary.csv` todas las claves nuevas de interfaz para botones del banner, filtros de bases de datos, columnas y controles táctiles de ordenación.

2. **Banner Interactivo ([`src/components/OverviewView.tsx`](./src/components/OverviewView.tsx)) y Modal Táctil ([`src/components/NetworkDevicesModal.tsx`](./src/components/NetworkDevicesModal.tsx))**:
   - Convertir el contador de aparatos conectados y la píldora de velocidad de Internet del banner en botones táctiles interactivos con estética *Apple Liquid Glass + Tesla Touch Cockpit*.
   - La píldora de Internet del banner mostrará prioritariamente la **velocidad global del router (`router_wan_rx_bytes_sec` / `router_wan_tx_bytes_sec`)** con respaldo automático transparente al host local si no hay router externo conectado.
   - Nuevo componente simétrico `NetworkDevicesModal.tsx` (idéntico al modal de inspección táctil `ExpandedChartModal`):
     - **Modo Base de Datos (`devices`)**: filtros táctiles por fuente (`Todas`, `En línea`, `Pi-hole`, `ASUS`, `Gateway/Vodafone`), búsqueda rápida, vendor/MAC/IP/consultas DNS/última actividad y acciones WoL/Apagar.
     - **Modo Tráfico en Vivo (`bandwidth`)**: resumen global de Internet del router + tráfico interno LAN y lista interactiva ordenable con un toque por **Descarga WAN**, **Subida WAN**, **Total Internet**, **Tráfico LAN** o **Nombre / IP** (invirtiendo Asc/Desc al pulsar de nuevo), además de filtro rápido de equipos activos con consumo.

## 3. Verificación y Empaquetado

- Validar `tsc --noEmit --noUnusedLocals --noUnusedParameters`, `npm run build`, `py_compile -W error::SyntaxWarning`, `./i18n/dictionary.csv` (0 claves faltantes), Android `lintDebug`, `bash packaging/install_all.sh` (`.deb` + `.apk` + Android TV ADB), despliegue en producción `/home/servidor/servicios/dashboard`, pruebas Chrome Headless CDP haciendo clic en ambos widgets del banner y cambiando fuentes/ordenaciones, documentación (`README.md`, `walkthrough_v12.16.0.md`) y sincronización GitHub (`main` + tag `v12.16.0`).
