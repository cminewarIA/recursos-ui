# Plan de Implementación Activo (`v4.18.1`)

Consulte el detalle completo en `./planes/implementation_plan_v4.18.1.md`.

## Resumen Ejecutivo (`v4.18.1` — PATCH)
- **Backend (`server.py`)**:
  - Deduplicación del historial de 2 horas (`history_2h`) en `/api/metrics` (~66% menos peso en la carga JSON de red).
  - Índice inverso $O(1)$ (`dom_to_ip_cache`), caché TTL de 12s para flujos activos de Pi-hole (`flows_cache`) y presupuesto por ciclo para consultas DNS/rDNS síncronas (`sync_dns_budget` y `rdns_budget`).
  - Caché por PID (`pid_proc_cache`) en `fetch_connections_geo_worker` y expresiones regulares precompiladas (`RE_SS_PORT`, `RE_SS_PROC`, `RE_PIHOLE_LOG_REPLY`, `RE_CONNTRACK_FLOW`).
  - Caché basada en `mtime` para `custom_logos.json` y pre-cálculo asíncrono de `system_errors_summary` en `background_collector()`.
- **Frontend (`index.html` y `static/index.html`)**:
  - Hidratación única por sesión (`_hydratedNics`) y recorte in-place con `.shift()` en `NicBandwidthStorageManager`.
  - Actualización in-place de tarjetas NIC y `<canvas>` en `#activeNicsGrid` sin destruir el DOM cada 2 segundos.
  - Renderizado perezoso y firmas de detección de cambios (`change signatures`) en `networkDevicesList`, `networkConnectionsTableList`, `NetworkBandwidthPieChart` y `BandwidthThresholdMonitor`.
