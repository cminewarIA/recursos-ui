# Plan de Implementación — Apple Liquid Glass & Tesla Touch Cockpit (`v4.0.0`)

## 1. Dirección Visual y Arquitectónica: Híbrido Apple Liquid Glass + Cabina Táctil Tesla
- **Superficies de Cristal Líquido Especular (Apple VisionOS / macOS Sequoia)**: Paneles translúcidos multicapa (`backdrop-filter: blur(36px) saturate(190%)`), iluminación cenital especular de `1px` y radios de curvatura continua (`24px`–`28px`).
- **Acabado Metálico y Titanio Automático (Claro / Oscuro / Auto)**:
  - **Titanio Oscuro (Space Black Titanium)**: `#07090E` con reflejos de cobalto y cian eléctrico.
  - **Titanio Claro (Natural Brushed Titanium)**: `#EEF2F7` con tarjetas de cristal blanco translúcido (`rgba(255, 255, 255, 0.76)`) y tipografía de alto contraste (`#0F172A`).
  - Selector interactivo en el HUD superior (`🌗 Auto` / `☀️ Titanio Claro` / `🌙 Titanio Oscuro`) sincronizado con `prefers-color-scheme` y persistido en `localStorage`.
- **Cabina Panorámica sin Barra Lateral Fija**:
  - Se elimina la columna lateral estática para liberar el 100% del ancho de pantalla para las tarjetas Bento y osciloscopios.
  - La barra superior opera como un **HUD de 3 zonas estilo Tesla** (Ruta + Historial, Pulso Central de Telemetría + Auditoría de 60fps en vivo, y Controles de Tema/OTA/Zero-Trust).

## 2. Navegación Táctil, Dock Flotante y Gestos de Deslizamiento
- **Dock Inferior Táctil Flotante (`#floatingTouchDock`)**: Dock de cristal líquido suspendido con física elástica (`cubic-bezier(0.22, 1, 0.36, 1)`), objetivos táctiles de `>= 48px` y desplazamiento horizontal suave en pantallas móviles.
- **Gestos Táctiles Horizontales (`initTouchSwipeNavigation`)**: Deslizar horizontalmente el dedo sobre el lienzo principal cambia de módulo de forma fluida con indicadores de paginación táctil (`#swipePaginationDots`).
- **Transiciones Espaciales HTML5 (`document.startViewTransition`)**: Cambios de vista acelerados por GPU mediante la API nativa View Transitions de HTML5.

## 3. Tarjetas Bento Expandibles (`<dialog>`) y Gráficas con Scrubbing Táctil
- **Inspector Táctil Bento (`<dialog id="bentoExpandDialog">`)**: Cada pilar de hardware (CPU, RAM, GPU, Almacenamiento, Red) incorpora el botón `⤢ Inspector Táctil` que despliega una hoja modal nativa HTML5 `<dialog>` con especificaciones en vivo y osciloscopio interactivo de 60 muestras.
- **Gráficas Interactivas al Tacto (`bindCanvasTouchScrubbing`)**: Arrastrar el dedo o cursor sobre cualquier gráfica dibuja una mira vertical luminosa, resalta el nodo exacto y muestra el valor registrado junto con la marca temporal (`hace Xs`).

## 4. Auditoría de Rendimiento en Tiempo Real y Optimización del Servidor
- **Pipeline de Renderizado Desacoplado (`requestAnimationFrame`)**: Las respuestas de `/api/metrics` sincronizan el DOM y los lienzos Canvas exclusivamente dentro del ciclo `requestAnimationFrame` a 60fps.
- **Prevención de Solapamiento (`AbortController`) y `Page Visibility API`**: Evita peticiones encoladas en conexiones WAN lentas y pausa el sondeo pesado cuando la pestaña está en segundo plano.
- **Caché de Hardware Estático y Git TTL en Servidor**: Topología de CPU (`/proc/cpuinfo`), sistema operativo (`/etc/os-release`), discos (`5s` TTL) y estado Git (`30s` TTL) cacheados en memoria para reducir la latencia de `/api/metrics` a pocos milisegundos.
