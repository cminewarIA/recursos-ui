# Plan de Implementación — Auditoría Integral y Cumplimiento Normativo (`v11.2.1`)

## 1. Objetivo y Alcance
Auditar el proyecto completo (**Backend Python**, **Servidor de Desarrollo Vite**, **App Nativa Ubuntu**, **App Nativa Android** e **Interfaz Web HTML5**) para corregir errores funcionales/seguridad y garantizar el cumplimiento estricto de las Reglas 1–9 de `GEMINI.md` (especialmente Regla 2 de *Cero Hardcoding*, Regla 3 de *Control de Versión Unificado*, Regla 4 de *Documentación en `planes/`*, Regla 5 de *`README.md`* y Regla 6 de *Compilación `.deb`*).

### Decisión de Versionado (Regla 3.4)
Se aplica incremento semántico `PATCH` a **`11.2.1`** desde `11.2.0` debido a que los cambios consisten en correcciones de fallos, endurecimiento de seguridad, eliminación de valores fijos y paridad entre entornos (sin rediseño visual global `X.0.0` ni adición/retiro de vistas `0.X.0`), además de preservar la monotonicidad de versiones exigida por `dpkg`/`apt` y Android `versionCode` (`110201`).

---

## 2. Cambios Planificados y Ejecutados
1. **Backend Python (`server.py`)**:
   - Autodetección de gateway vía `/proc/net/route` y eliminación de IPs/credenciales/tokens literales de router, `ADMIN_MASTER_KEY`, `TELEGRAM_BOT_TOKEN`, `DEVICE_FRIENDLY_NAMES` y rutas de red estáticas (`//192.168.50.x`).
   - Descubrimiento dinámico de particiones mediante `psutil.disk_partitions(all=True)`, interfaces de red vía `psutil.net_if_addrs()`, vecinos ARP/NDP vía `ip neigh` y direcciones de difusión de subred dinámicas para Wake-on-LAN.
   - Endurecimiento de seguridad: ocultación del token DuckDNS tras `token_set` + `token_masked`, eliminación de dominios fijos en CSP y de `Access-Control-Allow-Origin: *` en `/api/metrics`, validación Zero-Trust en `POST /api/maps/config`, lectura segura `_read_json_body()` en todas las rutas `POST` (corrigiendo `NameError` en `/api/system/auto-update`) y soporte para `GET /api/native/device-info`.
2. **Servidor de Desarrollo (`vite.config.ts`)**:
   - Implementación de manejadores `GET`/`POST` con estado en memoria y validación de JSON para `/api/dns/duckdns/update`, `/api/fail2ban/*` y `/api/telegram_bot/*`.
3. **Clientes Nativos (`desktop_app/recursos_app.py` y `android_app/`)**:
   - Eliminación de dominios fijos por defecto en `ServerConnectionManager`, `SecurePreferences.kt` y `DiscoveryManager.kt`; omisión segura de sondeos WAN cuando no existe dominio configurado y auto-aprendizaje dinámico de `public_domain` desde `/api/metrics` en LAN.
4. **Interfaz Web (`index.html` y `static/index.html`)**:
   - Alineación derecha del menú desplegable `.orbital-dropdown-menu` en `Operaciones`, eliminación de lookups DOM huérfanos en `MainNodeErrorTerminal` y `syncMapSideDrawerUI`, parseo JSON seguro (`safeReadJson`) en operaciones de seguridad/firewall y actualización de cadenas de versión iniciales a `v11.2.1`.
5. **Sincronización y Empaquetado (Reglas 3, 4, 5 y 6)**:
   - Sincronización de `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `README.md`, `./planes/` y generación/prueba de `dist/recursos-cockpit_11.2.1_amd64.deb`.
