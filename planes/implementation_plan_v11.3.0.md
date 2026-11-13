# Plan de Implementación — Botón de Señal de Apagado Remoto junto a WoL (`v11.3.0`)

## 1. Objetivo y Alcance
Incorporar un botón simétrico de señal de apagado remoto (`⏻ Apagar`) inmediatamente al lado del botón `⚡ WoL` en la lista de dispositivos de red (`#networkDevicesList`), respaldado por endpoints reales tanto en el servidor Python (`server.py`) como en el servidor de desarrollo Vite (`vite.config.ts`), cumpliendo estrictamente las Reglas 1–9 de `GEMINI.md`.

### Decisión de Versionado (Regla 3.4)
Se aplica incremento semántico `MINOR` a **`11.3.0`** desde `11.2.1` porque se añade una nueva funcionalidad completa a la interfaz y a la API REST (señal de apagado remoto multicanal junto a Wake-on-LAN), actualizando `versionCode` de Android a `110300`.

---

## 2. Arquitectura y Diseño Implementado
1. **Frontend (`index.html` y `static/index.html`)**:
   - En el renderizado de `#networkDevicesList`, agrupación simétrica de `⚡ WoL` y `⏻ Apagar` dentro de un contenedor `inline-flex` (`gap: 6px`) respetando la Regla 8 de simetría visual.
   - Detección dinámica de las IPs del propio servidor anfitrión (`hostIps`) para impedir que el botón de apagado aparezca sobre el mismo nodo que ejecuta el Cockpit.
   - Función `shutdownDevice(mac, ip, encName, btn)` con modal de confirmación previa (`showConfirmModal`), bloqueo temporal del botón (`⏳ Enviando...`), lectura JSON segura (`safeReadJson`), notificaciones `showToast` y refresco automático de telemetría tras 2 segundos.
2. **Backend Python (`server.py`)**:
   - Helper `_get_host_local_ips_and_macs()` que inspecciona dinámicamente `SERVER_LOCAL_IP` y `psutil.net_if_addrs()`.
   - Función `send_device_shutdown_signal(ip_str, mac_str, name_str)` con validación de IPv4/IPv6 y MAC, bloqueo explícito de loopback (`127.0.0.1`, `::1`, `0.0.0.0`) y de cualquier IP/MAC del anfitrión, y envío multicanal 100% *Zero-Hardcoding*:
     1. Webhook HTTP opcional configurado mediante `RECURSOS_SHUTDOWN_HOOKS_FILE`.
     2. SSH no interactivo (`BatchMode=yes`, `ConnectTimeout=2`, `RECURSOS_SSH_USER`/`RECURSOS_SSH_PORT`) si el puerto SSH responde.
     3. RPC Samba (`net rpc shutdown`) opcional mediante `RECURSOS_RPC_USER`/`RECURSOS_RPC_PASS`.
     4. Paquete mágico UDP **Sleep-on-LAN (SoL)** (`0xFF * 6 + reversed(MAC) * 16`) hacia la IP objetivo (puertos `9` y `7`) y todas las direcciones de difusión dinámicas (`get_lan_broadcast_addresses()`).
   - Ruta `POST /api/wol/shutdown` (alias `/api/device/shutdown`) protegida por `check_trust_status()` (`403`) y `_read_json_body(max_bytes=2048)`.
3. **Servidor de Desarrollo (`vite.config.ts`)**:
   - Paridad con manejador `POST /api/wol/shutdown` y `/api/device/shutdown`, validación de IP (`nodeNet.isIP`) y MAC, rechazo de direcciones locales del servidor (`400`) y respuesta JSON estructurada.
4. **Sincronización y Empaquetado (Reglas 3, 4, 5 y 6)**:
   - Sincronización de `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `static/index.html`, `README.md`, `./planes/*_v11.3.0.md` y compilación/prueba de `dist/recursos-cockpit_11.3.0_amd64.deb`.
