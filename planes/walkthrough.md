# Walkthrough Activo — v4.3.0 (Monitor de Umbral de Caudal NIC y Alerta en Leyenda del Mapa)

Ver documento detallado en `planes/walkthrough_v4_3_0_bandwidth_threshold_monitor.md`.

## Verificación Realizada
1. Motor `BandwidthThresholdMonitor` integrado con evaluación continua en `applyMetricsToDOM()` y persistencia en `localStorage` (`recursos_nic_bw_threshold_cfg`).
2. Alerta visual reactiva integrada en la leyenda del mapa (`#networkConnectionsMapLegend`, `#mapLegendBandwidthAlert`, `#mapLegendItemIncoming`, `#mapLegendItemOutgoing`) y en las tarjetas de interfaces (`#activeNicsGrid`).
3. Sincronización de `index.html` -> `static/index.html` y actualización de `VERSION` a `4.3.0`.
