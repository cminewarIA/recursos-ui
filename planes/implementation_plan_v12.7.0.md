# Plan de Implementación — Recursos Cockpit `v12.7.0`

**Fecha**: 2026-11-14  
**Versión previa sincronizada**: `12.6.0` (commit `f8a0b01` + tag `v12.6.0` en `origin/main`)  
**Versión objetivo**: `12.7.0` (`MINOR` — Rediseño completo de almacenamiento en widgets independientes completos animados + correcciones estructurales en App Nativa Ubuntu y WoL/SoL)

---

## 1. Diagnóstico Verificado Antes de Editar

1. **Paquetes Mágicos Wake-on-LAN / Sleep-on-LAN (`server.py`, `src/`)**:
   - `send_wol_magic_packet` devolvía `True` incondicionalmente incluso cuando fallaban los envíos UDP y recorría secuencialmente 11 direcciones de broadcast incluyendo 10 puentes Docker/`DOWN` mediante `wakeonlan`.
   - `get_lan_broadcast_addresses` incluía interfaces virtuales (`docker0`, `br-*`) y no enlazaba el socket al IP local físico de salida (`bind`), ni utilizaba transmisión multicast/capa-2 raw (`EtherType 0x0842`) o `ether-wake` en el router ASUS cuando hay credenciales SSH AES-256-GCM.
   - Los equipos recientemente vistos en reposo (`offline`) que pierden entrada ARP activa dejaban de ofrecerse para despertar si no tenían entrada `REACHABLE`/`STALE`.

2. **Errores Reales en la App Nativa de Ubuntu (`desktop_app/recursos_app.py`, `src/index.css`, `src/App.tsx`)**:
   - **Consumo ~100 % CPU en `WebKitWebProcess` (`SkiaGPUWorker` + `ThreadedCompositor`) + ~15 % en `python3`**: provocado por animación CSS infinita `cockpitAuroraShift` (`background-position` frame-a-frame) en `.cockpit-hero`, carga prematura del `WebView` antes de `discover_server()`, y sondeo HTTP constante incluso oculto en la pantalla inicial.
   - **Excepción `NameError: name 're' is not defined`** en `_proxy_to_remote` / fallback de tiles `/api/maps/tile/` al faltar `import re`.
   - **Enmascaramiento de errores en `LocalHtmlBridgeServer`**: `_proxy_to_remote` tragaba respuestas HTTP `4xx`/`5xx` devolviendo `False`, lo que convertía errores reales en `503 "Modo sin conexión..."` (en `POST`) o falsos `200 {"ok": true, ...}` (en `GET`), además de carecer de `do_PUT`, `do_DELETE`, `do_PATCH`, `do_OPTIONS` y fallback `/api/maps/config` + `/api/dex/devices`.
   - **Navegación & HeaderBar GTK**: `btn_back_home` permanecía visible en la vista `"home"` y `_sync_webview_session()` / `_navigate_spa()` se ejecutaban sin comprobar si WebKit2 había finalizado `load-changed`, pudiendo perder la transición al pulsar `Pantalla móvil USB` o `Conectar ahora`.
   - **Flujo de actualización unificada (`perform_unified_update` + `_install_deb_from_github`)**: cuando `app_above_github` el botón decía `"Sincronizar web local"` pero retornaba `"Sin cambios pendientes"` con `web_synced: False`; y `_install_deb_from_github` intentaba relanzar una instancia única D-Bus antes de completar la sincronización web.
   - **DeprecationWarning**: `Gdk.Screen.get_width()` / `get_height()` en `collect_native_device_telemetry()`.

3. **Almacenamiento en `OverviewView.tsx` + Telemetría por Disco en `server.py`**:
   - La vista `Inicio` mostraba un bloque gigante `md:col-span-2` ("Almacenamiento y discos disponibles") con 9 tarjetas pequeñas que repetían 4 carpetas del NAS (`video`, `onedrive`, `photo`, `homes`) y 3 bind-mounts del mismo disco físico (`TOSHIBA`).
   - Se eliminará dicho bloque grande y cada unidad física única (discos locales reales, memorias extraíbles USB/SD y pool NAS deduplicado) se renderizará como **widget independiente 1×1 completo idéntico a Procesador/RAM/GPU/Red**, con telemetría real de lectura/escritura por dispositivo e historial propio en tiempo real, animaciones de aparición y desaparición (`AnimatePresence`) ante conexión/desconexión y selector opcional compacto de modo rotativo/completo sin contenedores gigantes.

---

## 2. Arquitectura de Cambios Planificados

| Archivo | Cambios principales |
| --- | --- |
| `server.py` | Filtrado de interfaces físicas en `get_lan_broadcast_addresses`, WoL multicanal verificado (`bind` UDP + unicast + raw L2 `0x0842` opcional + `wakeonlan` filtrado + `ether-wake` por SSH al router cuando aplique), SoL coherente, retención segura de clientes LAN recientes en reposo para WoL, detección `per_disk` L/E real (kernel `/proc/diskstats` + `/proc/fs/cifs/Stats`) con historial por unidad y consolidación limpia de carpetas compartidas por `pool_key` con intervalo `fetch_disks_worker` de 4 s. |
| `desktop_app/recursos_app.py` | Añadir `import re`, propagar códigos/cuerpos `HTTPError` reales sin enmascarar con `503`/`200`, soportar `PUT/DELETE/PATCH/OPTIONS`, añadir `/api/dex/devices` y fallback `/api/maps/config`, carga bajo demanda de WebKit2 + cola de sesión/navegación en `load-changed`, ocultar `btn_back_home` en `"home"`, reemplazar `Gdk.Screen.get_width/height` por `Gdk.Display`, y corregir `perform_unified_update` + reinicio limpio tras actualización `.deb`. |
| `src/index.css` & `src/App.tsx` | Eliminar el repintado continuo `cockpitAuroraShift` manteniendo acabado cristalino GPU-eficiente; pausar sondeo `/api/metrics` cuando `document.hidden` esté activo y reanudar al volver el foco. |
| `src/types/telemetry.ts` & `src/components/OverviewView.tsx` | Añadir campos opcionales `read_bytes_sec`, `write_bytes_sec`, `io_history`, `shared_mounts` en `DiskInfo`; eliminar por completo el widget `md:col-span-2` y renderizar widgets 1×1 independientes y completos por cada unidad física única (local, USB/SD, NAS deduplicado) dentro de `AnimatePresence` con aparición/desaparición fluida. |
| Documentación y Empaquetado | Incrementar `VERSION` -> `12.7.0`, sincronizar `package.json`, `package-lock.json`, `packaging/debian/control`, `docs/assets/*.svg`, `static/manual.html`, `docs/index.html`, `README.md`, compilar e instalar simultáneamente `.deb` + `.apk` con `bash packaging/install_all.sh`. |

---

## 3. Plan de Verificación

1. `npx tsc --noEmit`, `npm run build`, `python3 -m py_compile server.py desktop_app/recursos_app.py desktop_app/dex_controller.py`, verificación `node --check` y `sha256sum` en `static/manual.html`/`docs/index.html`.
2. Prueba real en red de paquetes mágicos WoL/SoL (`POST /api/wol/wake` y `POST /api/wol/shutdown`) verificando tramas UDP con `tcpdump` en `enp7s0` y respuesta de errores ante MACs inválidas o loopback.
3. Prueba directa del puente nativo Ubuntu (`LocalHtmlBridgeServer` + `ServerConnectionManager` + arranque real en `DISPLAY=:0`) comprobando propagación `400/404`, ausencia de `DeprecationWarning` en código propio y reducción de CPU de `WebKitWebProcess` por debajo de niveles normales.
4. Verificación visual en navegador real mediante subagente `browser` sobre `/`: confirmar ausencia del bloque grande `col-span-2`, presencia de widgets 1×1 independientes completos con sus gráficas y animaciones de entrada/salida, y paridad en tema claro y oscuro.
5. Ejecución de `bash packaging/install_all.sh` instalando en PC (`.deb`) y Android TV vía ADB (`.apk`), despliegue limpio a `/home/servidor/servicios/dashboard/` conservando `recursos_history.db`, y registro final en `planes/walkthrough_v12.7.0.md`.

