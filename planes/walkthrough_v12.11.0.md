# Bitácora de Verificación · Recursos Cockpit v12.11.0

Bitácora de trabajo, diagnóstico y comprobación end-to-end para la versión **`12.11.0`** (conforme a `./VERSION`, `./GEMINI.md` y `./planes/implementation_plan_v12.11.0.md`).

---

## 1. Diagnóstico y Soluciones Implementadas

### 1.1. Mapa GeoIP de Conexiones (`Red -> Mapa de conexiones`) + Facilidad de Clic
- **Causa raíz inicial de visibilidad**: `<ViewStage>` (`src/components/MotionPrimitives.tsx`) utiliza `AnimatePresence mode="wait"`, montando el contenedor del mapa ~240 ms después de cambiar de subpestaña; `useEffect(..., [subTab, theme])` ejecutaba `mapContainerRef.current` cuando aún era `null`. Además, `index.html` cargaba `<script src="https://d3js.org/d3.v7.min.js">` bloqueado por CSP.
- **Causa raíz de dificultad al hacer clic**: más de 200 puntos de tamaño `radius: 5` apilados en mismas coordenadas y reconstrucción completa con `layer.clearLayers()` cada ~3 s, lo que cerraba los popups abiertos inmediatamente.
- **Solución (`src/components/NetworkSecurityView.tsx`, `src/index.css`, `index.html`, `i18n/dictionary.csv`)**:
  - Eliminación del `<script>` bloqueado por CSP en `index.html`.
  - Ref de callback de estado (`[mapContainerEl, setMapContainerEl]`) + `ResizeObserver` + `invalidateSize()` diferido y marcador fallback de `server_node`.
  - **Agrupación espacial dinámica por coordenadas** (`buildGeoClusterKey`), objetivo clicable ampliado (`hitRadius = Math.max(24, visRadius + 12)` -> `>= 48 px` con `cockpit-map-hit-target`), insignia numérica en clusters múltiples (`count > 1`), tooltips al pasar el cursor, **actualización incremental por registro (`markerRegistryRef`)** que actualiza contenido y estilo sin cerrar el popup abierto, botones directos `data-ban-ip` en popups, tema Oscuro/Claro en `.leaflet-popup-content-wrapper` / `.leaflet-tooltip`, y centrado automático (`focusConnectionOnMap`) al pulsar cualquier tarjeta en la lista inferior.

### 1.2. Ajuste Completo de Línea y Ventanas Temporales en Inspección Táctil (`ExpandedChartModal`)
- **Causa raíz**:
  1. En `src/components/ExpandedChartModal.tsx`, `useEffect` ligado a `[hasMetricKeys, preset, fetchHistoricalSlice]` disparaba `fetchHistoricalSlice({ limit: 90, metaOnly: true })` justo tras cambiar de preset y avanzaba `fetchSeqRef.current`, haciendo que respuestas válidas de `20 min`, `1 h`, `6 h`, `24 h` o `Todo` fueran descartadas por `seq !== fetchSeqRef.current` o sustituidas por `?limit=90`.
  2. La submuestra SQLite en `server.py` (`query_telemetry_history_from_sqlite`) y `vite.config.ts` podía omitir los extremos de ventana; y los modos locales de 20 min (`useLocal20mGpu`, `useLocal20mStorage`, `useLocal20mNet`) debían respetar la ventana exacta de 1200 s (y recurrir a SQLite si aún no acumulaban >= 1020 s).
- **Solución**:
  - `metaOnly` ya no incrementa `fetchSeqRef.current`, y el efecto de metadatos iniciales se ejecuta una sola vez (`[hasMetricKeys, fetchHistoricalSlice]`), reservando el refresco periódico solo para `preset === 'live'`.
  - Preservación de extremos exactos `raw_rows[0]` y `raw_rows[-1]` en `server.py` / `vite.config.ts`, slicing de 1200 s en `useLocal20m*`, atributo accesible `role="dialog" aria-modal="true"`, y protección de división en `traceMonotoneSpline` (`src/components/TelemetryChart.tsx`).

### 1.3. Erradicación de Avisos del Sistema y Control de Revisión (`POST /api/system/logs/ack`)
- **Correcciones en el sistema operativo**:
  - Drop-in systemd `/etc/systemd/system/tor@default.service.d/wait-network.conf` (`After=NetworkManager-wait-online.service`, `Restart=on-failure`) -> `tor@default.service` estable (`active`), `systemctl --failed`: `0 loaded units listed.`
  - Filtro `/etc/fail2ban/filter.d/xrdp.conf` y jail `[xrdp]` en `/etc/fail2ban/jail.local` actualizados (`Failregex: 21 total` en `fail2ban-regex`, IPs bloqueadas activamente) + `SyslogLevel=CORE` en `/etc/xrdp/xrdp.ini` manteniendo `/var/log/xrdp.log` en `LogLevel=INFO` para Fail2ban sin contaminar `journalctl -p 3` con sondeos TCP malformados.
  - Guardias UDP `69,4011` añadidas en `/home/servidor/servicios/firewall_guard/apply_firewall.sh` (IPv4/IPv6 `LAN_ONLY_GUARD DROP` tras reglas LAN/Tailscale/Docker).
- **Backend + UI (`server.py`, `desktop_app/recursos_app.py`, `src/components/MoreView.tsx`, `src/types/telemetry.ts`, `i18n/dictionary.csv`)**:
  - Incorporación de `failed_units_count`, marca temporal persistente `SYSTEM_LOGS_ACK_FILE` (`POST /api/system/logs/ack` y `/api/system/logs/clear`), y tarjeta dedicada **Salud y avisos del sistema** en `Más -> Actualizaciones y aspecto` con botón **Marcar revisados**.

### 1.4. Consola de Depuración IDE y Depuración Completa del Código
- Instalado `python3-debugpy` (`1.8.19`), añadido soporte `RECURSOS_PORT` / `PORT` en `run_server()` (`server.py`).
- Creados/actualizados [`.vscode/launch.json`](../.vscode/launch.json), [`.vscode/tasks.json`](../.vscode/tasks.json) y [`.vscode/settings.json`](../.vscode/settings.json) con perfiles para `debugpy` (`server.py` en puerto `8095` con `-Xfrozen_modules=off` y `console: internalConsole`, `desktop_app/recursos_app.py --test-mode` / GTK3, attach remoto `5678`), Chrome DevTools (`8085`, `8095`, Vite `5173`) y compuesto Full-Stack.
- Corregidos en la auditoría de código:
  - Middleware `/i18n/dictionary.csv` en `vite.config.ts` ahora excluye importaciones Vite con `?raw`/`?import`/`?url`/`?inline`, resolviendo el error de tipo MIME `"text/csv"` al depurar con `vite --port 5173`.
  - Eliminados 3 imports no usados en `src/components/AppsMediaView.tsx` y `src/components/OverviewView.tsx` (`tsc --noEmit --noUnusedLocals --noUnusedParameters` limpio).
  - Eliminadas 2 ramas `else` redundantes en `when (connectionMode)` (`android_app/.../CockpitDashboard.kt`), dejando `compileReleaseKotlin` sin warnings.

---

## 2. Comprobaciones Ejecutadas y Resultados Observados

1. **Validación estática, diccionario i18n, manual y builds**:
   - `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py desktop_app/dex_controller.py packaging/sign_deb.py` -> código de salida `0`.
   - Auditoría AST de Python (`server.py`, `i18n_catalog.py`, `desktop_app/*.py`, `packaging/sign_deb.py`) -> `0` bare excepts, `0` defaults mutables, sin símbolos indefinidos.
   - Diccionario `i18n/dictionary.csv` -> `749` claves únicas (`Missing: 0` frente a `src/`, `server.py` y `desktop_app/recursos_app.py`).
   - Paridad SHA-256 `static/manual.html` == `docs/index.html` (`7293e67751c3645364a840964fae62521329f29ae044944909f1d802749f39a0`) + `node --check` sobre el JS embebido -> `Manual JS syntax OK`.
   - `npx tsc --noEmit --noUnusedLocals --noUnusedParameters && npm run build` -> `0` errores, bundle compilado en `619ms`.
   - JSON válido en `.vscode/settings.json`, `.vscode/tasks.json` y `.vscode/launch.json`.
2. **Depuración en vivo con `debugpy` y Vite HMR**:
   - `debugpy --listen 127.0.0.1:5678 server.py` (`RECURSOS_PORT=8095`): escucha confirmada en puertos `5678` y `8095`, HTTP `200` en `/`, `/manual`, `/readme`, `/api/version` (`12.11.0`), `/api/dictionary`, `/api/metrics`, `/api/metrics/history`, `/api/system/logs`, `/api/maps/config` y tiles PNG Oscuro/Claro sin tracebacks.
   - `debugpy --listen 127.0.0.1:5679 desktop_app/recursos_app.py --test-mode` -> salida `0`.
   - `npx vite --port 5173 --host 127.0.0.1` en Chrome headless -> `v12.11.0`, `errors=[]`, `http_errs=[]`.
3. **Empaquetado e instalación unificada (`bash packaging/install_all.sh`)**:
   - `.deb` `recursos-cockpit_12.11.0_amd64.deb` firmado GPG e instalado (`ii recursos-cockpit 12.11.0 amd64`), `/usr/bin/recursos-cockpit --test-mode` -> `[OK]`.
   - `.apk` compilada (`BUILD SUCCESSFUL in 39s`, `:app:compileReleaseKotlin` sin warnings) e instalada vía ADB en `TCL Percee TV (192.168.50.187:5555)` con `versionCode=121100 versionName=12.11.0`.
   - Servicio productivo `/home/servidor/servicios/dashboard` sincronizado y `system-dashboard.service` reiniciado (`active`).
4. **Verificación integral en Chrome headless sobre producción (`http://127.0.0.1:8085/`)**:
   - Mapa Claro y Oscuro montado (`1031x460`), `10/10` y `15/15` tiles cargados (`/api/maps/tile/{light|dark}/...`), `139` objetivos táctiles ampliados, `41` badges numéricos de cluster y **`popupPersisted: True` tras >3.4 s de refrescos en vivo**.
   - Presets `20 min`, `1 h`, `6 h`, `24 h`, `Todo` y `En vivo · 5 min` verificados en **NIC (`enp7s0`)**, **Inicio CPU**, y **Equipo (`Procesador`, `Memoria`, `Gráfica`, `Almacenamiento`)**: solicitudes `window_sec` exactas sin sobrescritura `?limit=90` y trazo continuo en las 5 franjas horizontales del canvas.
   - `GET /api/system/logs?refresh=1` -> `total_errors: 0, failed_units_count: 0`, más ciclo completo UI en **Más -> Actualizaciones y aspecto** (`reset -> Actualizar -> Marcar revisados -> clean`).
   - Total de errores de consola/CSP: **`0`**. Total errores HTTP >= 400: **`0`**.
