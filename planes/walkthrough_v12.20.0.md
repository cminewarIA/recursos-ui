# Walkthrough y Verificación — v12.20.0

## Resumen de Cambios Verificados
1. **Barras de Subapartados Autoajustables y Escalado Fluido Integral**:
   - Reemplazadas las barras horizontales recortadas por `.cockpit-subtabs-bar` (`flex-wrap: wrap`) y `.cockpit-subtab-btn` con dimensionamiento `clamp()` combinado (`vw` + `dvh`) en `Equipo`, `Red`, `Programas` y `Más`.
   - Añadidas clases fluidas `.cockpit-chart-compact`, `.cockpit-chart-medium`, `.cockpit-chart-tall`, `.cockpit-chart-modal`, `.cockpit-map-box`, `.cockpit-manual-frame` y `.cockpit-scroll-panel`, integrando medición de ancho y alto en tiempo real en `TelemetryChart` y `ProcessHistoryStackedChart`.
   - Cabecera y dock inferior adaptados mediante `clamp()` en `App.tsx`, `ExpandedChartModal.tsx` y `NetworkDevicesModal.tsx`.

2. **Separación del Widget de Red en Router Exterior (WAN) + Red Local Interna (LAN)**:
   - Dividido el panel único de red en `OverviewView.tsx` en dos tarjetas independientes:
     - `overview-router-wan-card` (**Router · Exterior (WAN)**): velocidades externas (`↓` / `↑`), origen dinámico (`router_traffic_source` / `router_model` / `gateway_name` / `gateway_ip` / `local_ip`), serie `wanSeries` (`net_wan_rx` / `net_wan_tx`), barra proporcional e inspección táctil dedicada.
     - `overview-local-lan-card` (**Red Local · Interna (LAN)**): tráfico local interno (`↓` / `↑`), contador de enlaces activos y subredes locales, serie `lanSeries` (`net_lan_rx` / `net_lan_tx`), barra proporcional e inspección táctil independiente.
   - Registradas las 8 nuevas claves i18n en `i18n/dictionary.csv` (972 filas × 33 columnas uniformes, sin duplicados).

3. **Efecto Gelatina Universal en Toda la Interfaz**:
   - `src/utils/scrollContain.ts`: Extendida la física elástica (*squash-and-stretch* GPU-composited con `scale` y `translate` independientes) al viewport principal (`[data-cockpit-jelly-stage="true"]` con eco en `.cockpit-dock`), rueda de ratón, gestos táctiles, teclado, arrastre de barra de desplazamiento en cualquier contenedor o ventana, todos los paneles con scroll vertical/horizontal y feedback interactivo (`tap`, `press`, `hover` sutil) sobre botones, pestañas, subpestañas, tarjetas Bento, sub-tarjetas, pills e interruptores, manteniendo la contención estricta de modales/desplegables.
   - `src/App.tsx`, `src/index.css`, `src/components/MotionPrimitives.tsx`, `src/components/OverviewView.tsx` y `src/components/FloatingTooltip.tsx`: Keyframes elásticos (`cockpitFadeSlideUp`, `cockpitModalPop`, `cockpitToastIn`, `cockpitTooltipPop`), muelles `COCKPIT_SPRING` / `COCKPIT_PILL_SPRING` y barras de progreso elásticas con soporte completo para `prefers-reduced-motion` y `data-paused="true"`.

## Resultados de Compilación, Validación y Pruebas Reales
- **Diccionario CSV (`i18n/dictionary.csv`)**: Validado en Python — `972 rows, 33 cols`, cero filas desalineadas y cero claves duplicadas.
- **Reglas Firestore**: `npx eslint firestore.rules` — superado sin errores.
- **TypeScript estricto**: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` — superado sin errores.
- **Backend y Desktop Python**: `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py` — superado sin errores.
- **Build de Producción Vite**: `npm run build` — completado en `2.04s` (`dist/index.html`, CSS `80.57 kB`, JS `2,568.97 kB`).
- **Empaquetado Debian**: `bash packaging/build_deb.sh` — generado y firmado `/app/applet/dist/recursos-cockpit_12.20.0_amd64.deb` + `SHA256SUMS.txt.asc`.
- **Servidor en Vivo (`http://127.0.0.1:3000`)**: Reiniciado y verificado vía HTTP (`GET /api/version` → `12.20.0`, `GET /api/metrics` → `22` claves activas, `GET /` → HTML `2380` bytes, `GET /i18n/dictionary.csv` → `821561` bytes incluyendo `hardware.net.router_wan_title` y `hardware.net.local_lan_title`).
