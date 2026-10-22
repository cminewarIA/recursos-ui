# Plan de Implementación — Optimización Integral del Subsistema de Red y Telemetría (`v4.18.1`)

## 1. Diagnóstico de Cuellos de Botella Detectados

Tras auditar de extremo a extremo el motor de backend (`server.py`) y el motor reactivo del frontend (`index.html` y `static/index.html`), se identificaron los siguientes cuellos de botella principales:

1. **Triplicación del Payload de Historial de Red (`server.py`)**:
   - En cada ciclo de `background_collector()` (cada 2s), el array `history_2h` (hasta 1800 muestras por interfaz de red) se inyectaba simultáneamente en tres claves distintas del JSON `/api/metrics`: `network.interfaces[name].history_2h`, `network.interfaces_list[i].history_2h` y `network.interfaces_history_2h[name]`, multiplicando por 3 el tamaño del payload de red y el coste de `json.dumps()`.
2. **Complejidad $O(N \times M)$ y Bloqueos Síncronos en `PiholeDnsTranslator` y `fetch_connections_geo_worker` (`server.py`)**:
   - `fetch_active_device_flows()` ejecutaba en cada barrido un bucle anidado sobre todos los dominios de SQLite (`pihole-FTL.db`) y la totalidad de `self.ext_cache.items()`, además de lanzar llamadas bloqueantes a `socket.gethostbyname()` y `socket.gethostbyaddr()` sin límite de presupuesto por ciclo.
   - `psutil.Process(c.pid).name()` se invocaba repetidamente para el mismo PID en cada conexión de `psutil.net_connections()`.
   - Las expresiones regulares de `conntrack`, `ss` y `pihole.log` se recompilaban en cada línea dentro de bucles intensivos.
3. **Lectura Síncrona en el Hilo HTTP `/api/metrics` (`server.py`)**:
   - `load_custom_logos()` abría y parseaba `custom_logos.json` desde disco en cada petición GET a `/api/metrics` (cada 2 segundos).
   - `get_system_errors_summary()` podía ejecutarse de forma síncrona en la ruta HTTP si la caché expiraba durante una petición.
4. **Re-ordenación $O(K \log K)$ y Destrucción del DOM cada 2s en la Pestaña Red (`index.html` / `static/index.html`)**:
   - `NicBandwidthStorageManager.recordAllFromPayload()` volvía a fusionar y ordenar (`Array.sort`) los ~1800 puntos del servidor (`history_2h`) cada 2 segundos para cada NIC.
   - `#activeNicsGrid` reconstruía su `innerHTML` completo cada 2s, destruyendo los nodos `<canvas>` de los sparklines de ancho de banda y perdiendo el estado de inspección interactiva (hover/scrub).
   - `networkDevicesList` y `networkConnectionsTableList` reconstruían su `innerHTML` cada 2s incluso cuando la lista de dispositivos o conexiones no había cambiado.
   - `BandwidthThresholdMonitor.evaluateAndRender()` y `MainNodeErrorTerminal.renderAll()` se ejecutaban incondicionalmente cada 2 segundos aunque el usuario estuviera en otra pestaña o no hubieran llegado errores nuevos.

---

## 2. Arquitectura de las Optimizaciones Implementadas

### A. Backend (`server.py`)
1. **Deduplicación del Payload `/api/metrics`**:
   - Se mantiene `history_2h` únicamente en `network.interfaces_list[i].history_2h`, eliminando las copias redundantes en `network.interfaces[name]` y `network.interfaces_history_2h`.
2. **Índice Inverso $O(1)$ y Presupuesto DNS/rDNS en `PiholeDnsTranslator`**:
   - Se añade `self.dom_to_ip_cache` (diccionario `domain -> ip`) actualizado automáticamente en `refresh_external_domains()`, sustituyendo el escaneo lineal $O(N \times M)$ por búsquedas $O(1)$.
   - Se añade caché con TTL de 12 segundos (`self.flows_cache`) en `fetch_active_device_flows()` y un presupuesto máximo de 4 resoluciones DNS síncronas por ciclo (`sync_dns_budget = 4`) con caché negativa de 15 minutos (`self.fwd_dns_negative`).
   - Se añade `rdns_budget` a `translate_external(ip, rdns_budget)` para limitar `socket.gethostbyaddr()` a un máximo de 6 llamadas por ciclo en `fetch_connections_geo_worker()`.
3. **Caché de Procesos por PID y Precompilación de Expresiones Regulares**:
   - `pid_proc_cache` memoriza el nombre de proceso por PID durante cada barrido de conexiones.
   - Se precompilan a nivel de módulo `RE_SS_PORT`, `RE_SS_PROC`, `RE_PIHOLE_LOG_REPLY` y `RE_CONNTRACK_FLOW`.
4. **Caché por `mtime` de `custom_logos.json` y Resumen de Errores Asíncrono**:
   - `load_custom_logos()` verifica `os.path.getmtime(CUSTOM_LOGOS_FILE)` y sirve desde `CUSTOM_LOGOS_CACHE` sin leer ni parsear disco si el archivo no ha cambiado.
   - `background_collector()` pre-calcula `system_errors_summary` e inyecta el resultado en `METRICS_CACHE`, liberando el hilo HTTP de llamadas a `systemctl`/`journalctl`.

### B. Frontend Reactivo (`index.html` y `static/index.html`)
1. **Hidratación Única por Sesión en `NicBandwidthStorageManager`**:
   - Se incorpora `_hydratedNics: new Set()` para que el historial de 2h del servidor se fusione una sola vez por interfaz al cargar la sesión; los ciclos posteriores de 2s solo insertan el delta en tiempo real ($O(1)$) y purgan muestras antiguas con `.shift()` in-place.
   - El volcado a `localStorage` se espacia de 4s a 15s para reducir bloqueos de serialización en el hilo principal.
2. **Actualización In-Place de Tarjetas NIC y `<canvas>` (`#activeNicsGrid`)**:
   - Se verifica `nicsGrid.dataset.structSig`: mientras la lista de interfaces activas no cambie, las tarjetas DOM y sus `<canvas>` se conservan intactos, actualizando únicamente los textos de caudal (`#nicRxTxVal_`), bytes acumulados (`#nicTotalBytesVal_`), badges de umbral (`#nicExceedBadge_`) y redibujando `drawNicSparkline(nic.name)` sin interrumpir el hover del usuario.
3. **Renderizado Perezoso y Firmas de Cambio (`Change Signatures`)**:
   - `BandwidthThresholdMonitor.evaluateAndRender()` se ejecuta solo cuando `activeView === 'network'` y al conmutar a la vista de Red en `performSwitchViewDOM()`.
   - `networkDevicesList` y `networkConnectionsTableList` calculan una firma ligera (`renderSig` / `_lastTableSignature`) y omiten la reconstrucción de `innerHTML` cuando los datos y filtros permanecen invariables.
   - `NetworkBandwidthPieChart.renderFromMetrics()` aborta la reconstrucción de la leyenda y las transiciones D3.js cuando no hay cambio de modo ni variación de tráfico (`!isModeSwitch && !hasTrafficShift`).
   - Se elimina la llamada redundante a `MainNodeErrorTerminal.renderAll()` en cada pulso de 2s.
