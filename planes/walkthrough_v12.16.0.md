# Walkthrough v12.16.0 — Widgets Interactivos del Banner (Dispositivos Multifuente y Velocidad Global del Router)

## 1. Resumen de Cambios Implementados

- **Versión (`VERSION` = `12.16.0`)**: Incremento `MINOR` según `GEMINI.md` al añadir dos modales interactivos de inspección táctil sobre el banner principal y cálculo de caudal WAN/LAN global del router.
- **Backend (`server.py` + `vite.config.ts`)**:
  - Autodescubrimiento dinámico del modelo UPnP IGD de la puerta de enlace (`_discover_gateway_upnp_info()` → detectado dinámicamente `router-vodafone` / `ZTE F6600P` en `192.168.50.1`), modelo del router ASUS vía SSH (`nvram get productid` → `RT-AX56U` en `192.168.50.10`) y catálogo SQLite de Pi-hole (`_read_pihole_network_catalog()` sobre `/etc/pihole/pihole-FTL.db`).
  - Separación de flujos WAN (`<-> gw_mac` en Broadcom FlowCache `/proc/fcache/l2list`) frente a tráfico LAN interno por dispositivo y cálculo agregado de `router_wan_rx_bytes_sec`, `router_wan_tx_bytes_sec`, `router_lan_rx_bytes_sec`, `router_lan_tx_bytes_sec` y `router_traffic_source` dentro de `wifi_summary`.
  - Aislamiento `is_local_host` en `wifi_clients` para aplicar el fallback de interfaz local (`_SERVER_DIRECT_NET_SPEEDS`) exclusivamente sobre la IP real del servidor (`servidor (enp7s0)`), evitando atribución cruzada a otros equipos de la LAN o interfaces túnel virtuales.
  - Nuevo endpoint `GET /api/network/devices-db` (`build_unified_devices_database()`) con soporte gzip HTTP que unifica dispositivos conectados e históricos de Pi-hole, router ASUS y tabla vecina/puerta de enlace, además de su equivalente síncrono en el middleware de desarrollo de `vite.config.ts`.
- **Frontend (`src/components/OverviewView.tsx`, `src/components/NetworkDevicesModal.tsx`, `src/types/telemetry.ts`)**:
  - Los indicadores del banner superior (`data-testid="banner-devices-btn"` y `data-testid="banner-speed-btn"`) pasan a ser botones táctiles interactivos con estilo `Apple Liquid Glass + Tesla Touch Cockpit`:
    - El badge de dispositivos muestra el conteo conectado activo (`22 aparatos conectados`) y abre la pestaña de catálogo multifuente con filtros (`Conectados`, `Todas`, `Pi-hole`, `Router ASUS (RT-AX56U)`, `router-vodafone · ZTE F6600P`), búsqueda en vivo y acciones rápidas (`Encender` / `Apagar`).
    - El badge de velocidad muestra la velocidad WAN global del router (`Internet ↓ ... / ↑ ... · Router global`) y abre la pestaña de ancho de banda en vivo con KPIs globales del router (Descarga WAN, Subida WAN, Tráfico Interno LAN y fuente telemétrica activa) y ordenación táctil por `Descarga`, `Subida`, `Total`, `Red LAN` y `Nombre / IP` (ascendente/descendente).
- **Internacionalización (`i18n/dictionary.csv`) y Documentación (`README.md`, `planes/implementation_plan_v12.16.0.md`)**:
  - Registradas las nuevas claves `overview.*` en `./i18n/dictionary.csv` (837 claves totales verificadas, 0 faltantes en `src/`).
  - Sincronizados `README.md`, `static/manual.html` y `docs/index.html`.

---

## 2. Verificación Ejecutada (Resultados Reales Observados)

### 2.1 Compilación Estática, Tipos, Python e i18n
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0` sin errores ni símbolos sin uso.
- `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py desktop_app/dex_controller.py packaging/sign_deb.py`: salida `0`.
- `cmp -s static/manual.html docs/index.html`: salida `0` (paridad exacta).
- Validador CSV i18n sobre `./i18n/dictionary.csv` y `src/**/*.{ts,tsx}`: `i18n keys: 837 | missing: 0 []`.

### 2.2 Servicio de Producción (`http://127.0.0.1:8085`) y Endpoints
- `systemctl is-active system-dashboard.service`: `active`.
- `systemctl --failed --no-pager`: `0 loaded units listed`.
- `GET /api/version`: `version: "12.16.0"`, `display_version: "12.16.0"`, `installed_deb_version: "12.16.0"`.
- `GET /api/metrics` (con `Accept-Encoding: gzip`): HTTP `200`, `Content-Encoding: gzip`, `wifi_summary.asus_model = "RT-AX56U"`, `wifi_summary.gateway_name = "router-vodafone"`, `wifi_summary.gateway_model = "ZTE F6600P"`, `wifi_summary.pihole_db_total = 1234`, `wifi_summary.router_wan_available = true`, `wifi_summary.router_traffic_source = "RT-AX56U + ZTE F6600P"`. Verificado también que `servidor (enp7s0)` tiene `is_local_host: true` y `synology-nas` mantiene `wan_speed_down: 0.0` (sin atribución duplicada del tráfico del servidor).
- `GET /api/network/devices-db` (con `Accept-Encoding: gzip`): HTTP `200`, `Content-Encoding: gzip`, `ok: true`, `total_count: 53`, con `summary.sources_status`: `pihole` (`count: 1234`, `online_count: 22`), `asus` (`model: "RT-AX56U"`, `count: 21`, `online_count: 21`), `gateway` (`label: "router-vodafone"`, `model: "ZTE F6600P"`, `count: 22`, `online_count: 22`).
- `GET /api/system/logs?refresh=1`: `success: true`, `failed_units_count: 0`, `counts_by_category`: `service: 0`, `kernel: 0`, `system: 0` (`docker: 80`).

### 2.3 Pruebas UI Interactivo en Chrome Headless CDP (`1440x900` y `390x844`)
- Renderizado inicial del banner en `http://127.0.0.1:8085/`:
  - `banner-devices-btn`: `"22 aparatos conectados"`.
  - `banner-speed-btn`: `"Internet ↓ 710.1 KB/s / ↑ 76.2 KB/s Router global"`.
- Apertura de `banner-devices-btn`: título `"Dispositivos en Red y Bases de Datos"`, botones activos de filtro `Pi-hole (53)`, `Router ASUS (RT-AX56U) (21)`, `router-vodafone · ZTE F6600P (22)`. Pulsación secuencial de los filtros `Pi-hole`, `ASUS` y `router-vodafone` y cierre limpio con tecla `Escape`.
- Apertura de `banner-speed-btn`: subtítulo `Velocidad Global y Consumo por Dispositivo`, métricas `↓ Descarga Global Router`, `↑ Subida Global Router`, `Tráfico Interno LAN` y fuente `RT-AX56U + ZTE F6600P`, cambio de ordenación con `Subida` y `Red LAN`, y cierre con `Escape`.
- Viewport móvil `390x844`: `scrollWidth: 390`, `innerWidth: 390`, `overflowX: false`, `dlgOverflowX: false`.
- Errores de consola y excepciones JS: `CONSOLE_ERRORS: []`, `EXCEPTIONS: []`.

### 2.4 Entorno Vite Dev y Empaquetado Nativo (Ubuntu `.deb` + Android `.apk`)
- Middleware Vite Dev (`http://127.0.0.1:5179`): `/api/version` devolvió `12.16.0` y `/api/network/devices-db` devolvió `ok=True`, `total_count=2`, `devices=2`.
- `dpkg -l | grep recursos-cockpit`: `recursos-cockpit 12.16.0 amd64`.
- `/usr/bin/recursos-cockpit --test-mode`: `[OK] Recursos Native Ubuntu HTML5 App v12.16.0 validated successfully` (`scrcpy 3.3.4`, `dex_unlocked: True`, `active='http://127.0.0.1:8085'`).
- Artefactos en `dist/`: `recursos-cockpit_12.16.0.apk`, `recursos-cockpit_12.16.0_amd64.deb`, `recursos-cockpit_12.16.0_amd64.deb.asc`, `SHA256SUMS.txt`, `SHA256SUMS.txt.asc`.
- Android TV via ADB (`192.168.50.30:5555`, `MiTV_AESP0`): `package:com.cminewar.recursoscockpit` con `versionCode=121600`, `versionName=12.16.0`.
