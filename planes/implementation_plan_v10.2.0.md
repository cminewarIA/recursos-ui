# Plan de Implementación — v10.2.0: Ajuste Dinámico Universal a Pantalla en Todos los Apartados

## 1. Objetivo
Lograr que toda la interfaz y todos sus apartados internos (`#viewOverview`, `#viewProcessor`, `#viewMemory`, `#viewGpu`, `#viewDrives`, `#viewNetwork`, `#viewSecurity`, `#viewApps`, `#viewTorrents`, `#viewProcesses`, `#viewDns`, `#viewVersion`, `#viewDex`, modales y diálogos) se ajusten dinámica y simétricamente al 100% de cualquier pantalla (monitores 4K/Ultrawide, escritorio estándar, pantalla dividida, tablets y móviles tanto en versión Web como en los contenedores nativos Ubuntu GTK3/WebKit2 y Android WebView).

## 2. Cambios Arquitectónicos Implementados
1. **Desbloqueo del Ancho Completo del Viewport (`.view-page` y `.viewport-scroll`)**:
   - Sustitución de `max-width: 1400px` por `width: 100%; max-width: 100%; min-width: 0;` con espaciado fluido `clamp(12px, 1.4vw, 20px)` y padding adaptable en `.viewport-scroll`.
   - Uso de `100dvh` y tamaño tipográfico base fluido `clamp(12.5px, 0.2vw + 12px, 14px)`.
2. **Grillas Bento Auto-Adaptativas (`auto-fit` / `auto-fill` con `min(100%, ...)`)**:
   - `.telemetry-pillars-grid`, `.modules-bento-grid`, `.hw-spec-grid`, `.cores-matrix-grid`, `.nic-grid`, `.connections-map-kpi-strip`, `.conn-capsules-grid` y `.bw-pie-layout` escalan sin desbordamiento horizontal y mantienen simetría contractual (Regla 8 de `GEMINI.md`).
3. **Escalado Dinámico de Osciloscopios, Mapa Geoespacial Leaflet y Gráfico D3.js (`window.ProcessCpuBarChart`)**:
   - `.oscilloscope-stage` (`height: clamp(140px, 21dvh, 250px)`) y `.connections-map-stage-wrap` (`height: clamp(340px, 54dvh, 720px)`).
   - `window.ProcessCpuBarChart.render()` mide en vivo `#procCpuD3Wrap.clientWidth`, ajusta `this.width`, `this.margin.left` y `this.margin.right`, y actualiza dinámicamente el `viewBox` del SVG.
   - Estilizado responsivo completo para `<dialog class="bento-dialog">` (`width: min(94vw, 940px); max-height: min(88dvh, 860px)`).
4. **Motor Reactivo de Redimensionamiento (`ResizeObserver` + `visualViewport`)**:
   - Observación en tiempo real de `#mainScrollContainer`, `#networkConnectionsMapStageWrap` y `#procCpuD3Wrap` mediante `ResizeObserver` desacoplado con `requestAnimationFrame`, invalidando dimensiones de Leaflet (`invalidateSize`) y redibujando gráficas al instante.
5. **Sincronización Canónica de Versión (`10.2.0`)**:
   - Sincronización en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
