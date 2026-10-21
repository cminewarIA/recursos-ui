# Walkthrough Activo (`v4.7.0`) — Transiciones Animadas D3.js en el Gráfico de Pastel de Ancho de Banda (`Red`)

Consulta el detalle completo de esta versión en `planes/walkthrough_v4_7_0_d3_pie_transitions.md`.

## Resumen de `v4.7.0`
- **Transición Animada Fluida con D3.js v7 (`#svgNetBandwidthPie`)**:
  - Uso de `d3.pie()`, `d3.arc().cornerRadius(4)`, `d3.transition().ease(d3.easeCubicOut)` y `d3.interpolate()` (`attrTween('d', ...)`) para animar de forma continua los ángulos y radios de cada sector al cambiar el modo de agrupación (`subnets`, `groups`, `categories`), el modo de métrica (`total_bytes`, `live_speed`) o el tráfico detectado en vivo.
  - Interpolación numérica progresiva (`d3.interpolateNumber`) en el indicador central (`#bwPieCenterVal`) y actualización in-place de las barras de porcentaje en `#bwPieLegendList`.
- **Sincronización Completa**:
  - `index.html` y `static/index.html` sincronizados.
  - `VERSION` y `package.json` actualizados a `4.7.0`.
  - `README.md` actualizado con las novedades de `v4.7.0`.
