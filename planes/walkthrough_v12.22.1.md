# Walkthrough v12.22.1 — Auditoría Integral, Estabilidad Visual Multi-Viewport, Optimización SQLite/Gzip y Cumplimiento de Normas

## 1. Resumen de Correcciones Aplicadas

### 1.1 Estabilidad Visual y Contención Total de Casillas (Regla 6)
- **[src/index.css](../src/index.css)**:
  - Añadido `min-width: 0; max-width: 100%;` a `.cockpit-bento`, `.cockpit-subtile`, `.cockpit-hero` y `.cockpit-segmented`, y `min-width: 0` en `.cockpit-auto-grid > *` y `.cockpit-auto-grid-cards > *` para evitar que hijos Flex/Grid expandan o rompan tarjetas.
  - Ajustado `--cockpit-card-min` en `.cockpit-auto-grid-cards` (`clamp(275px, 24vw, 370px)`) y `--cockpit-grid-min` (`clamp(225px, 20vw, 310px)`), evitando columnas microscópicas en tablets `768 px`.
  - Reforzado `.cockpit-subtab-btn` con `min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis;` para evitar desbordamientos en idiomas largos.
- **[src/components/NetworkSecurityView.tsx](../src/components/NetworkSecurityView.tsx)**:
  - **`RouterTrafficCard` (`router-traffic-widget`) y `NicHistoryCard`**: cabecera rediseñada en dos filas limpias (título/IP + botón `Maximize2` arriba, 4 métricas WAN/LAN en `grid-cols-2` con `min-w-0 truncate` abajo), eliminando desbordamientos de hasta `+101 px` y botones fuera de pantalla en `640 px`, `768 px` y `1024 px`.
  - **Sección `Historial de tráfico de red (24 h)`**: separada la fila título + botones (`Actualizar` / `Ampliar`) de la fila envolvente de leyendas, eliminando el desbordamiento de `+96 px` en `640×900`.
  - **Tarjetas de `Mapa de conexiones`**: añadido `min-w-0 overflow-hidden` y `truncate`/`break-words` sobre nombres de servicio, dominios largos sin espacios (`ca80a1adb12a4fbdac5ffcbc944e9a61.pacloudflare.com (:443)`, etc.) y franja inferior de tráfico adaptable (`flex-col sm:flex-row`).
- **[src/components/MoreView.tsx](../src/components/MoreView.tsx)**:
  - **Tarjeta de Actualizaciones**: movidas las 3 tarjetas de versión (`APP UBUNTU`, `SERVIDOR WEB LOCAL`, `GITHUB OFICIAL`) a ancho completo con `grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))]`, eliminando el colapso a `24 px–63 px` en `640 px` y `768 px`.
  - **Panel `Salud y avisos del sistema` (`system-health-panel`)**: cabecera cambiada a `xl:flex-row` sin `shrink-0` agresivo (eliminando desbordamiento en alemán a `768×1024`) y añadido `break-all` + `overflow-hidden` en los logs crudos JSON para evitar desbordamientos de `+110 px` en móvil `360×800`.
- **[src/components/EquipmentView.tsx](../src/components/EquipmentView.tsx)**:
  - **Programas en marcha ahora**: añadido `flex-wrap max-w-full` a la barra segmentada `proc-sort` y `w-full sm:w-52` al buscador, eliminando el desbordamiento `+37 px` en `360×800`.
- **[src/components/NetworkDevicesModal.tsx](../src/components/NetworkDevicesModal.tsx)**:
  - Filas de ancho de banda adaptables (`grid-cols-1 sm:grid-cols-3`, `min-w-0`, `flex-wrap`) y saneamiento de comentario con marcas fijas (Regla 1).

### 1.2 Eliminación de Errores de Consola (Firebase / CSP) y Rendimiento Backend
- **[server.py](../server.py)**:
  - **CSP (`send_security_headers()`)**: añadidos los orígenes oficiales de Firebase/Google Auth (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `*.firebaseio.com`, `apis.google.com`, `*.firebaseapp.com`, `accounts.google.com`).
  - **Submuestreo SQLite directo (`GROUP BY`)**: en `query_telemetry_history_from_sqlite()` y `query_ping_history_from_sqlite()` las consultas sobre rangos grandes (`window_sec=all` o ventanas extensas) agregan directamente en SQLite sin cargar cientos de miles de filas en RAM de Python.
  - **Poda acotada de `ping_history`**: tope máximo de `180 000` filas recientes con `PRAGMA wal_checkpoint(PASSIVE)` en `fetch_ping_latency_worker()`.
  - **Compresión HTTP `gzip` en `/api/dictionary` e `/i18n/dictionary.csv`**: reducción medida del **70,7 %** (`1 904 586 B` → `558 139 B`).
  - **Usuario RDP dinámico**: eliminado el literal `"username:s:servidor"` en `/visipics.rdp` y `/visipics_externo.rdp` usando `RECURSOS_RDP_USER` / `USER` del entorno.
- **[src/firebase/index.ts](../src/firebase/index.ts)**:
  - Eliminada la llamada duplicada de módulo `void testConnection();` y gestionado el estado offline sin emitir `console.error`.

### 1.3 Cumplimiento de Normas (Reglas 1, 2, 4, 8 y 9)
- **[packaging/debian/control](../packaging/debian/control)**: sustituidos los literales `12.8.0` por marcadores neutros `0.0.0` (Regla 2.2).
- **[packaging/debian/postinst](../packaging/debian/postinst)**: añadida la 8ª tabla faltante `ai_system_fault_insights` y su índice `idx_ai_fault_analyzed_at` (paridad 100 % con `server.py`, Regla 8).
- **[desktop_app/dex_controller.py](../desktop_app/dex_controller.py)**: eliminado `import os` sin uso (Regla 9).
- **[static/visipics.rdp](../static/visipics.rdp)** y **[static/visipics_externo.rdp](../static/visipics_externo.rdp)**: reemplazados `192.168.50.2` / `servidor.local` / `username:s:servidor` por marcadores neutros `localhost:3389` (Regla 1).
- **[VERSION](../VERSION)** = `12.22.1`, **[README.md](../README.md)** sincronizado (`User=tu-usuario` y tabla de cambios actualizada).

---

## 2. Verificación Ejecutada (Resultados Reales Observados)

### 2.1 Compilación Estricta, Linting, Python, Manual e i18n
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0`.
- `npx eslint firestore.rules`: salida `0`.
- `npm run build` (`vite v8.3.8`): compilado en `1.36s` (`2105` módulos).
- `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py desktop_app/dex_controller.py packaging/sign_deb.py`: salida `0`; auditoría AST de imports sin uso: `0`.
- `cmp -s static/manual.html docs/index.html` y `node --check` sobre JS de `static/manual.html`: salida `0` (`MANUAL_JS_CHECK: OK`).
- Validador `./i18n/dictionary.csv`: `31` idiomas × `1006` claves completos (`missing=0`).
- Paridad de tablas SQLite `server.py` ↔ `packaging/debian/postinst`: `8` tablas idénticas (`100%`).
- Compilación Android Kotlin (`:app:compileReleaseKotlin`): `BUILD SUCCESSFUL in 25s`.

### 2.2 Paquete Debian `.deb`, Servicio Productivo y Rutas HTTP
- `bash packaging/build_deb.sh`: generado y firmado `dist/recursos-cockpit_12.22.1_amd64.deb` (clave GPG `4CFC86D58E9146AE`), `dpkg -c` verificado sin ficheros `.db`, `*_dev.json` ni `.vault` (`DEB_CLEAN_VERIFIED`).
- `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.22.1_amd64.deb` y `/usr/bin/recursos-cockpit --test-mode`: `[OK] Recursos Native Ubuntu HTML5 App v12.22.1 validated successfully` (`scrcpy 3.3.4`, `dex_unlocked: True`).
- `systemctl is-active system-dashboard.service`: `active`; `systemctl --failed --no-pager`: `0 loaded units listed`.
- Rutas en vivo (`http://127.0.0.1:8085`):
  - `/`, `/manual`, `/readme`: `HTTP 200`.
  - `/api/version?refresh=1`: `version: 12.22.1`, `installed_deb_version: 12.22.1`, `package_needs_install: False`, CSP con `firestore.googleapis.com`.
  - `/api/metrics/history?window_sec=all&limit=450`: `HTTP 200` (`568.6 ms`, `250 007` muestras agregadas → `450` devueltas).
  - `/api/net/ping-history?window_sec=all&limit=450`: `HTTP 200` (`447.8 ms`, `39 874` timestamps × `5` objetivos → `450` devueltas).
  - `/api/dictionary` (gzip): `HTTP 200`, `Content-Encoding: gzip`, `558 139 B` frente a `1 904 586 B` sin comprimir (**70,7 % ahorrado**).
  - Middleware Vite Dev (`127.0.0.1:5181`): `/api/version` = `12.22.1`, `/api/dictionary` = `31` idiomas.

### 2.3 Auditoría Geométrica Final en Chrome Headless CDP
- Escaneadas las **17 vistas/subvistas** en **`1440×900`, `1024×768`, `768×1024`, `640×900` y `360×800`**, los **modales** (`banner-devices-btn`, `banner-speed-btn`, `ExpandedChartModal`) en `1280×720` y `360×800`, y prueba de estrés en **Tema Oscuro + Alemán (`de`)** en `768×1024` y `360×800`:
  - `TOTAL_SCREENS_WITH_ISSUES: 0`
  - `CONSOLE_ERRORS: []`
  - `EXCEPTIONS: []`
  - `FAILED_REQS: []`
