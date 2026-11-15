# Plan de Implementación v12.11.0 — Corrección de Avisos, Gráficas Temporales, Mapa GeoIP y Consola de Depuración IDE

## Resumen de Objetivos
1. **Restauración íntegra de `./server.py`**: Reconstruir las últimas líneas truncadas en el commit `v12.10.0` contrastando con producción `/home/servidor/servicios/dashboard/server.py` antes de aplicar cambios.
2. **Eliminación de raíz y gestión web de avisos del sistema**:
   - Arranque ordenado de `tor@default.service` tras asignación de IP LAN (`NetworkManager-wait-online.service` + `RestartSec=5s`).
   - Ampliación del filtro Fail2ban `[xrdp]` para bloquear escáneres TLS/X.224 (`bad header length`, `CR-TPDU (Connection Request) failed`, etc.) con `maxretry = 3` y `findtime = 20m`.
   - Protección de puertos PXE/TFTP (`udp 69,4011`) en `/home/servidor/servicios/firewall_guard/apply_firewall.sh` (`LAN_ONLY_GUARD`).
   - Inclusión de `failed_units_count` en el contador global de avisos (`server.py`), persistencia de marca de revisión (`ack_ts` en `.system_logs_ack.json` + `POST /api/system/logs/ack` y `/api/system/logs/clear` en `server.py` y `desktop_app/recursos_app.py`), y panel visual de revisión/listado de unidades fallidas y logs en `MoreView.tsx` con claves registradas en `./i18n/dictionary.csv`.
3. **Ajuste completo de línea temporal en Inspección Táctil y Gráficas**:
   - Eliminar el defecto en `ExpandedChartModal.tsx` donde `useEffect([hasMetricKeys, preset, fetchHistoricalSlice])` lanzaba `fetchHistoricalSlice({ limit: 90, metaOnly: false })` tras seleccionar `20 min`, `1 h`, `6 h`, `24 h` o `Todo`, anulando la petición de ventana completa.
   - Garantizar soporte consistente en `20 min` para NICs específicos (`liveNicHist`), GPU y discos, preservación estricta de extremos `[raw_rows[0], ..., raw_rows[-1]]` en `query_telemetry_history_from_sqlite()` (`server.py`), sincronización exacta de longitudes `series` / `timestamps` / `epochTs`, y trazado continuo sin recortes desde borde izquierdo a derecho en `TelemetryChart.tsx`.
4. **Visibilidad fiable del Mapa de Conexiones GeoIP (`Red -> Mapa`)**:
   - Reemplazar `useRef` estático en `NetworkSecurityView.tsx` por un *callback ref* reactivo (`mapContainerEl`) para que Leaflet (`window.L`) inicialice el mapa y las teselas exactamente cuando `<ViewStage>` (`AnimatePresence mode="wait"`) monte el contenedor DOM (~240 ms tras cambiar de pestaña), junto con `invalidateSize()` y `fitBounds` resiliente.
   - Limpiar la etiqueta `<script src="https://d3js.org/d3.v7.min.js">` no utilizada en `index.html` que provocaba bloqueos CSP en consola.
5. **Consola de Depuración del IDE y Depuración Integral**:
   - Configurar `.vscode/launch.json`, `.vscode/tasks.json` y `.vscode/settings.json` para depuración Python (`server.py`, `desktop_app/recursos_app.py`), Vite/TypeScript, navegador Chrome y compuesto *Full-Stack*.
   - Ejecutar verificación estática y en tiempo de ejecución (TS strict, Python compile/runtime, validación diccionario CSV, prueba automatizada DOM/Canvas/Leaflet en Chrome headless, `.deb` + `.apk` via `bash packaging/install_all.sh` y comprobación contra servicio systemd activo).

## Reglas Contractuales Aplicadas
- **Zero-Hardcoding** (`GEMINI.md` Regla 1).
- **Versión Única en `./VERSION` (`12.11.0`, `MINOR`)** (`GEMINI.md` Regla 2).
- **Documentación y walkthroughs en `./planes/` y sincronización de `README.md`, `static/manual.html` y `docs/index.html`** (`GEMINI.md` Reglas 3–4).
- **Empaquetado unificado `.deb` + Android TV `.apk`** (`GEMINI.md` Regla 5).
- **Diccionario único `./i18n/dictionary.csv` para todo texto visible** (`GEMINI.md` Regla 8).

