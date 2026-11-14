# Walkthrough de Verificación — Recursos Cockpit `v12.7.0`

**Fecha**: 2026-11-14  
**Versión activa**: `12.7.0` (incremento `MINOR` respecto a `v12.6.0` según `GEMINI.md`)  
**Alcance**: Paquetes mágicos Wake-on-LAN / Sleep-on-LAN multicanal, corrección de errores estructurales y consumo CPU en la App Nativa de Ubuntu, conversión de almacenamiento a widgets `1×1` independientes y dinámicos con telemetría L/E por unidad, prevención de downgrade automático en `server.py` y despliegue simultáneo PC (`.deb`) + Android TV (`.apk`).

---

## 1. Cambios Implementados

### 1.1 Paquetes Mágicos Wake-on-LAN / Sleep-on-LAN y Descubrimiento LAN (`server.py`)
- **Filtrado estricto de interfaces físicas (`get_lan_broadcast_entries` / `get_lan_broadcast_addresses`)**: excluye prefijos virtuales (`lo`, `docker`, `veth`, `br-`, `virbr`, `tun`, `tap`, `wg`, `tailscale`, etc.) e interfaces caídas, retornando únicamente `[('192.168.50.2', '192.168.50.255', 'enp7s0')]` en el entorno actual.
- **Emisión WoL multicanal verificada (`send_wol_magic_packet`)**: valida el formato MAC (rechazando `00:00:00:00:00:00` y `ff:ff:ff:ff:ff:ff`), vincula el socket al IP local físico de salida (`s.bind((local_ip, 0))`) en puertos UDP `9` y `7`, envía a `192.168.50.255`, `255.255.255.255`, unicast dirigido opcional a `target_ip`, trama raw L2 `AF_PACKET` (`EtherType 0x0842`) si hay permisos, `wakeonlan` CLI filtrado y `ether-wake` por SSH al router ASUS cuando corresponde. Solo devuelve `True` si al menos un canal emite correctamente.
- **Sleep-on-LAN coherente (`send_device_shutdown_signal`) y protección loopback**: emite paquete SoL con MAC invertida en puertos UDP `9` y `7` por interfaz física más webhook/SSH/RPC cuando aplica, bloqueando `127.0.0.1` y la propia IP del servidor.
- **Retención limpia de dispositivos offline WoL (`get_arp_and_pihole_names`, `fetch_wifi_worker`)**: conserva dispositivos LAN vistos recientemente en Pi-hole (`<24 h`) o con alias conocido tras expirar ARP (`xbox-one-x`, `pc-yonah`), excluyendo rangos puente `172.16.0.0/12` y filtrando entradas inválidas de Pi-hole (`00:00:00:00:00:00`, `FF:FF:FF:FF:FF:FF`, `0.0.0.0` / `is_unspecified`).

### 1.2 Estabilidad, Puente HTTP y CPU en la App Nativa de Ubuntu (`desktop_app/recursos_app.py`, `src/index.css`, `src/App.tsx`)
- Añadido `import re` faltante en `desktop_app/recursos_app.py`.
- Caché de hardware estático (`_collect_static_hw_telemetry()`) para evitar lanzar subprocesos `lspci` repetitivos en cada sondeo de telemetría.
- Reemplazado `Gdk.Screen` (`get_width`/`get_height`) por `Gdk.Display.get_default()` y eliminados `Gtk.Window.set_wmclass` y llamadas duplicadas a `GLib.set_application_name()` (cero warnings GTK propios en consola).
- `LocalHtmlBridgeServer` (`BridgeHandler`):
  - Propagación fiel de códigos HTTP y cuerpos JSON de error (`400`, `403` marcando `is_revoked=True`, `404`) desde el servidor remoto sin enmascarar con `503` ni falsos `200`.
  - Soporte añadido para `PUT`, `DELETE`, `PATCH` y `OPTIONS`.
  - Endpoints `/api/dex/devices` y fallback offline `/api/maps/config` (`provider: "leaflet_osm"`, `requires_api_key: false`) y `404 Not Found` para rutas `/api/*` inexistentes.
- Carga bajo demanda de `WebKitWebView` solo al entrar en `"webview"` (o `--dex`), sincronización segura en `load-changed` (`LoadEvent.FINISHED`), ocultación estricta de `btn_back_home` en `"home"`, pausa de animación y sondeo mediante `window.__RECURSOS_PAUSED__` / `document.hidden` y eliminación de animaciones CSS infinitas (`cockpitAuroraShift` / `cockpitShimmer`) que saturaban `WebKitWebProcess`.
- Corrección de `perform_unified_update()` y prevención de downgrade automático en `server.py` (`auto_install_watcher_worker()` / `perform_auto_update_and_install()` / `get_version_info()`): nunca ejecuta `git stash push` automático cuando el árbol tiene cambios locales ni revierte versiones locales superiores a la remota.

### 1.3 Widgets `1×1` Independientes de Almacenamiento (`OverviewView.tsx`, `ExpandedChartModal.tsx`, `server.py`, `src/types/telemetry.ts`)
- Eliminado el bloque contenedor `md:col-span-2` ("Almacenamiento y discos disponibles").
- Cada unidad física única (`pool_primary !== false`) se renderiza como widget `1×1` completo e independiente dentro de `<AnimatePresence mode="popLayout">`, con título/etiqueta, porcentaje animado, píldora de lectura/escritura (`L/E`), capacidad usada/total, temperatura cuando existe, rutas consolidadas en la propia píldora/etiqueta sin multiplicar TB, barra de progreso spring, gráfica `<TelemetryChart />` con historial `io_history` en vivo del kernel (`/proc/diskstats` + `/proc/fs/cifs/Stats`) y modal ampliado individual en `ExpandedChartModal.tsx`.
- Reducido el intervalo de `fetch_disks_worker` en `server.py` a `4 s` para reflejar conexión y extracción en vivo de unidades extraíbles/locales/NAS.

---

## 2. Verificaciones Ejecutadas (Tras las Últimas Ediciones)

| Prueba | Resultado observado |
| --- | --- |
| Sintaxis Python (`python3 -m py_compile ./server.py ./desktop_app/recursos_app.py`) | Código de salida `0`. |
| TypeScript & Build frontend (`npx tsc --noEmit` y `npm run build`) | Código de salida `0`; artefactos generados en `dist/` y `static/index.html`. |
| Sincronía de manual (`sha256sum ./static/manual.html ./docs/index.html` y validación JS Node) | Hash idéntico `57bc7cdd4a6cd1d6e874678e374561ac56f6d962c3eaeb739cbafaa085255478`; JS válido (`Manual scripts count: 1`). |
| Empaquetado e instalación unificada (`bash packaging/install_all.sh`) | Código de salida `0`: `.deb 12.7.0` firmado (GPG `4CFC86D58E9146AE`) instalado en PC (`ii recursos-cockpit 12.7.0`), `.apk 12.7.0` instalada en `TCL Percee TV (SDK 26 · 192.168.50.187:5555)` con `versionCode=120700 versionName=12.7.0`. Verificación `sha256sum -c SHA256SUMS.txt`: ambos `OK`. |
| Verificación de servicio y API en vivo (`127.0.0.1:8085`) | `/api/version` -> `version: "12.7.0"`, `installed_deb_version: "12.7.0"`, `update_available: false`. Base de datos `/home/servidor/servicios/dashboard/recursos_history.db` preservada (inode `1049392`). `/api/metrics` -> `3` pools primarios (`Sistema Raíz · SAMSUNG MZVLW256HEHP-000L7` `54.3%`, `TOSHIBA DT01ACA1 · ALMACENAMIENTO` `21.7%` con `4` rutas consolidadas, `video · NAS 192.168.50.3` `94.3%` con `4` comparticiones consolidadas), todos con `io_hist: 8`; `wifi_clients: 24` con `invalid_00_entries: []` y candidatos WoL offline (`xbox-one-x`, `pc-yonah`). |
| Paquetes Mágicos WoL / SoL (`POST /api/wol/wake` y `POST /api/wol/shutdown`) | MAC inválida `"bad-mac"` -> HTTP `400`. Prueba con MAC sintética `02:11:22:33:44:55` hacia `192.168.50.254`: `200 OK` en canales `udp_broadcast`, `udp_unicast`, `wakeonlan_cli`, `router_ether_wake` y SoL `sol_udp`. Captura previa con `tcpdump` en `enp7s0` verificó las tramas UDP en puertos `9`/`7` y trama L2 `0x0842` emitida por el router ASUS; loopback `127.0.0.1` bloqueado limpiamente. |
| App Nativa Ubuntu (`--test-mode`, `LocalHtmlBridgeServer` y `xvfb-run`) | `/usr/bin/recursos-cockpit --test-mode` -> `[OK] Recursos Native Ubuntu HTML5 App v12.7.0 validated successfully` (`dex_unlocked: True`). `BridgeHandler`: `/api/dex/devices` -> `200`, `/api/maps/config` (online y offline) -> `200` (`requires_api_key: false`), `/api/missing_ep` -> `404`, `POST /api/wol/wake` con `bad-mac` -> `400` real reenviado. Arranque GTK en `xvfb-run` durante `7 s`: cero `DeprecationWarning`, cero avisos `g_set_application_name()`, `WebKitNetworkPr` al `0.6 %` CPU y sin proceso `WebKitWebProcess` en la pantalla inicial. |
| Inspección visual en navegador (`browser` subagent / `chrome_devtools`) | No ejecutada por falta de sesión Google Chrome con remote debugging activo (`DevToolsActivePort` ausente en el entorno). Queda pendiente de validación visual directa por el usuario en su navegador o abriendo Chrome con `--remote-debugging-port`. |
