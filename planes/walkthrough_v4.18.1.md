# Walkthrough de Verificación — Optimización Integral de Red y Telemetría (`v4.18.1`)

## 1. Cambios Realizados

### Backend (`server.py`)
- **Caché de Logos por `mtime`**: `load_custom_logos()` ahora comprueba `os.path.getmtime(CUSTOM_LOGOS_FILE)` y reutiliza `CUSTOM_LOGOS_CACHE` en memoria, evitando lecturas de disco en cada petición `/api/metrics`.
- **Expresiones Regulares Precompiladas**: Se definieron `RE_SS_PORT`, `RE_SS_PROC`, `RE_PIHOLE_LOG_REPLY` y `RE_CONNTRACK_FLOW` a nivel de módulo.
- **Optimización de `PiholeDnsTranslator`**:
  - Nuevo diccionario inverso `self.dom_to_ip_cache` ($O(1)$) alimentado durante `refresh_external_domains()`.
  - Caché de flujos activos de dispositivos (`self.flows_cache`) con TTL de 12 segundos y límite de 4 resoluciones DNS síncronas por ciclo con caché negativa (`self.fwd_dns_negative`).
  - Presupuesto de resolución rDNS inversa (`rdns_budget`) en `translate_external()`.
- **Optimización de `fetch_connections_geo_worker()`**:
  - Caché local `pid_proc_cache` por ciclo para evitar llamadas repetidas a `psutil.Process(c.pid).name()`.
  - Uso de `RE_CONNTRACK_FLOW.search(line)` precompilado.
- **Deduplicación de `history_2h` y Pre-cálculo de Errores**:
  - `history_2h` se envía una única vez dentro de `interfaces_list`, reduciendo en ~66% el volumen del historial de interfaces en `/api/metrics`.
  - `system_errors_summary` se calcula en el hilo recolector (`background_collector()`) y se sirve desde `METRICS_CACHE`.

### Frontend (`index.html` y `static/index.html`)
- **`NicBandwidthStorageManager`**:
  - `_hydratedNics` garantiza que los ~1800 registros históricos de cada NIC se combinen y ordenen una única vez por sesión.
  - Recorte de ventana temporal en `getHistory()` mediante `.shift()` in-place y debounce de escritura en `localStorage` ampliado a 15s.
- **Actualización In-Place de `#activeNicsGrid`**:
  - Preservación de los elementos DOM y `<canvas>` entre refrescos de 2 segundos mediante `nicsGrid.dataset.structSig`, actualizando textos y sparklines en vivo sin destruir el estado de hover.
- **Renderizado Perezoso y Firmas de Cambio**:
  - `BandwidthThresholdMonitor.evaluateAndRender()` solo se ejecuta cuando la pestaña `network` está activa o al entrar en ella.
  - `networkDevicesList`, `networkConnectionsTableList` y `NetworkBandwidthPieChart` verifican firmas de cambio antes de tocar el DOM o disparar animaciones D3.

## 2. Verificación Técnica
- Validación de sintaxis de Python (`python3 -m py_compile server.py`): **OK (Código 0)**.
- Sincronización exacta entre `index.html` y `static/index.html`: **OK**.
- Sincronización de versión canónica `4.18.1` en `VERSION`, `package.json` y `README.md`: **OK**.
- Compilación del entorno con `compile_applet`: **OK**.
