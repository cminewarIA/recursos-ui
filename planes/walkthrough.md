# Walkthrough Activo — v4.6.0 (Gráfico de Pastel de Distribución de Ancho de Banda en Pestaña Red)

Ver documento detallado en `planes/walkthrough_v4_6_0_bandwidth_pie_chart.md`.

## Verificación Realizada (`v4.6.0`)
1. Añadido el bloque `#netBandwidthPieSection` y el motor `NetworkBandwidthPieChart` en la pestaña **Red** (`#viewNetwork`) de `index.html` y `static/index.html`.
2. Soportadas 3 vistas de agrupación (**Subredes IP `/24`**, **Grupos de Enlace** y **Tipo de Dispositivo**) y 2 modos de métrica (**Tráfico Acumulado** y **Caudal en Vivo**).
3. Conservada la utilería `GeoIpLocalStorageCleaner` con poda automática bajo `GEOIP_MAX_ENTRIES` tanto en cliente como en servidor (`server.py`).
4. Sincronizada versión canónica `4.6.0` en `VERSION`, `package.json` y `README.md`.
