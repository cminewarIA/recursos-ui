# Walkthrough `v4.7.0` — Transiciones Animadas D3.js en el Gráfico de Pastel de Ancho de Banda (`Red`)

## 1. Objetivo
Implementar una transición animada fluida utilizando **D3.js v7** (`d3.pie`, `d3.arc`, `d3.transition`, `d3.interpolate`, `d3.easeCubicOut`) en el gráfico de pastel de distribución de ancho de banda (`#netBandwidthPieSection`) dentro de la pestaña **Red** (`/red`), tanto al cambiar el modo de agrupación (`Subredes IP`, `Grupos de Enlace`, `Tipo de Dispositivo`) o el modo de métrica (`Tráfico Acumulado`, `Caudal en Vivo`), como cuando varía el tráfico de red detectado en tiempo real.

---

## 2. Arquitectura y Cambios Implementados

1. **Integración de D3.js v7 y Lienzo Vectorial `<svg id="svgNetBandwidthPie">`**:
   - Se incorporó D3 v7 (`https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js`) en la cabecera de `index.html` y `static/index.html` (manteniendo fallback automático a Canvas HiDPI si el entorno operase sin D3).
   - Se añadió el contenedor `<svg id="svgNetBandwidthPie" viewBox="-120 -120 240 240">` con anillo guía de fondo (`circle.bw-pie-track-ring`) y grupo vectorial de sectores (`g.bw-pie-slices-group`).

2. **Motor de Interpolación Angular y Radial (`renderD3Pie` & `arcTween`)**:
   - **Generación de Sectores con `d3.pie()` y `d3.arc()`**: Se emplea `d3.pie().sort(null).value(d => d.value).padAngle(0.022)` junto con `d3.arc().cornerRadius(4)` para generar arcos con esquinas suavizadas estilo Apple Liquid Glass.
   - **Morphing Fluido al Cambiar Modo de Agrupación o Métrica (`680 ms`, `d3.easeCubicOut`)**:
     - Al pulsar `🌐 Subredes IP`, `📶 Grupos de Enlace`, `🖥️ Tipo de Dispositivo`, `📊 Tráfico Acumulado` o `⚡ Caudal en Vivo`, cada `<path class="bw-pie-arc-path">` interpola su estado geométrico (`startAngle`, `endAngle`, `innerRadius`, `outerRadius`, `padAngle`) desde `this._current` hasta el nuevo objetivo mediante `d3.interpolate(startState, targetState)`.
     - Los sectores adicionales que entran (`enter()`) se despliegan suavemente desde el cierre del anillo (`2π`), mientras que los sectores que salen (`exit()`) pliegan su barrido angular hacia `2π` antes de eliminarse del DOM.
   - **Transición Orgánica ante Cambios de Tráfico en Vivo (`460 ms`, `d3.easeCubicOut`)**:
     - Se calcula una firma de estado (`_lastDataSignature`) en cada ciclo de telemetría; cuando el tráfico detectado cambia, los arcos transicionan suavemente hacia los nuevos ángulos sin reiniciar la animación si no hubo cambios.
   - **Animación de Hover y Selección Fijada (`animateHoverState`, `210–240 ms`)**:
     - Al pasar el ratón o tocar un sector (o su fila en la leyenda), D3 anima el radio exterior (`98 -> 105`), el radio interior (`58 -> 56`), la traslación polar hacia afuera (`translate(dx, dy)`) y el resplandor semántico (`drop-shadow`).

3. **Interpolación Numérica Central y Actualización In-Place de la Leyenda**:
   - El indicador central `#bwPieCenterVal` utiliza `d3.select(valEl).transition().duration(460).ease(d3.easeCubicOut).tween('text', ...)` con `d3.interpolateNumber` para animar suavemente el conteo de bytes o velocidad.
   - `renderLegendDOM()` actualiza in-place los nodos existentes cuando las claves de los segmentos coinciden, preservando el estado `:hover` y permitiendo que las barras `.bw-pie-legend-bar-fill` animen su anchura con `transition: width 0.55s cubic-bezier(0.22, 1, 0.36, 1)`.

---

## 3. Verificación y Sincronización
- Sincronizados `index.html` y `static/index.html`.
- Versión actualizada a `4.7.0` en `VERSION`, `package.json` y `README.md`.
- Compilación verificada con `compile_applet`.
