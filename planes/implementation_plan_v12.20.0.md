# Plan de Implementación — v12.20.0: Subapartados Autoajustables, Escalado Fluido, Red Dual (WAN/LAN) y Efecto Gelatina Universal

## Contexto y Objetivos
1. **Subapartados Autoajustables y Escalado Fluido Integral**: Evitar recortes laterales en barras `.cockpit-segmented` y sustituir alturas/anchos rígidos en píxeles por escalado continuo proporcional al ancho y alto del viewport (`clamp()` con `vw` y `dvh`).
2. **Separación de "Red e Internet" en Dos Widgets Independientes (`OverviewView`)**: Dividir el panel combinado de red en **Router · Exterior (WAN)** (`overview-router-wan-card`) y **Red Local · Interna (LAN)** (`overview-local-lan-card`), cada uno con su telemetría en vivo, gráfica dedicada, barra proporcional e inspección táctil independiente.
3. **Efecto Gelatina Universal en Toda la Interfaz (`scrollContain.ts`, `index.css`, `MotionPrimitives.tsx`, `App.tsx`, `OverviewView.tsx`, `FloatingTooltip.tsx`)**: Extender la física elástica (*squash-and-stretch* GPU-composited) desde las ventanas modales al conjunto completo de la aplicación:
   - Scroll del documento principal (`#cockpit-scroll-stage` + eco elástico en `.cockpit-dock`), arrastre de la barra de desplazamiento del navegador, rueda de ratón, gestos táctiles y teclado.
   - Contenedores desplazables internos (verticales y horizontales), listas de procesos, logs, dominios, popups de mapas, desplegables y modales (preservando el bloqueo estricto anti-scroll de fondo).
   - Interacciones globales sobre botones, pestañas, subpestañas, tarjetas Bento, sub-tarjetas, barras de progreso, interruptores, toasts y tooltips con curvas elásticas y respeto total a `prefers-reduced-motion` y `data-paused`.

## Archivos Modificados
- `src/index.css`: Reglas `.cockpit-subtabs-bar`, `.cockpit-subtab-btn`, clases de altura fluida (`cockpit-chart-*`, `cockpit-map-box`, `cockpit-manual-frame`, `cockpit-scroll-panel`), keyframes elásticos (`cockpitFadeSlideUp`, `cockpitModalPop`, `cockpitToastIn`, `cockpitTooltipPop`) y transiciones *spring* con overshoot.
- `src/utils/scrollContain.ts`: Motor universal de contención y física gelatina para viewport principal (`[data-cockpit-jelly-stage="true"]`), dock, scroll vertical/horizontal y feedback táctil/ratón sobre cualquier elemento interactivo.
- `src/components/MotionPrimitives.tsx`: Ajuste elástico de `COCKPIT_SPRING`, `COCKPIT_PILL_SPRING`, `COCKPIT_EASE`, `BentoCard`, `ViewStage` y `AccordionBody`.
- `src/App.tsx`: Contenedor `#cockpit-scroll-stage` libre de elementos `fixed`, cabecera y dock con escalado fluido y transiciones elásticas.
- `src/components/OverviewView.tsx`: Separación de widgets Router Exterior WAN y Red Local Interna LAN + adaptación de todas las tarjetas y barras de progreso a física *spring* elástica.
- `src/components/EquipmentView.tsx`, `src/components/NetworkSecurityView.tsx`, `src/components/AppsMediaView.tsx`, `src/components/MoreView.tsx`, `src/components/TelemetryChart.tsx`, `src/components/ProcessHistoryStackedChart.tsx`, `src/components/ExpandedChartModal.tsx`, `src/components/NetworkDevicesModal.tsx`, `src/components/FloatingTooltip.tsx`: Subtabs responsivos, alturas fluidas y animaciones elásticas.
- `i18n/dictionary.csv`: 8 claves nuevas registradas en los 31 idiomas (33 columnas).
- `VERSION`: Actualizada a `12.20.0`.
