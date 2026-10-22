# Plan de Implementación — v7.0.1: Pantalla Completa Garantizada y Límite Dinámico de Zoom Mundial en el Mapa

## 1. Objetivo (`PATCH` v7.0.1)
1. Garantizar que el mapa geoespacial (`#networkConnectionsMapStageWrap`) pueda activarse y visualizarse siempre a **Pantalla Completa real (`100vw × 100dvh`)** tanto en navegadores de escritorio/móvil como dentro de contenedores `<iframe>` restringidos (sin quedar atrapado dentro de `.connections-map-card` ni ocultar el botón de Pantalla Completa fuera del borde derecho en pantallas estrechas).
2. Impedir que el usuario pueda hacer **zoom-out más allá de los límites del mapa mundial** (`[-85.0511°, -179.99°]` a `[85.0511°, 179.99°]`), evitando por completo que se vea el fondo vacío/transparente alrededor de los bordes superior, inferior o laterales del mapa.

## 2. Solución Técnica Implementada
1. **Pantalla Completa sin Trampa de `backdrop-filter` (`body.map-fullscreen-active`)**:
   - En CSS, `.connections-map-card` tenía `backdrop-filter: blur(22px)`, lo cual creaba un bloque contenedor que atrapaba los elementos hijos con `position: fixed`. Al activar `body.map-fullscreen-active`, se desactivan `backdrop-filter`, `transform`, `filter` y `contain` en todos los ancestros y se ocultan `.top-header`, `.floating-dock-shell` y `.sidebar`, permitiendo que `#networkConnectionsMapStageWrap.is-fullscreen` ocupe el `100vw × 100dvh` con `z-index: 2147483640`.
   - En `.map-hud-primary-bar`, se dividió el carril izquierdo/central deslizable (`.map-hud-scroll-track`) de la **zona derecha anclada (`.map-hud-pinned-right`)**, de modo que los botones de `Zoom +`, `Zoom −`, `Encuadrar`, `Host` y `Pantalla Completa` permanezcan siempre visibles sin recortarse en pantallas de menor anchura.
   - Se añadieron además dos accesos directos adicionales: un botón flotante en la esquina inferior derecha del mapa (`#btnMapCornerFullscreen`) y un botón `Pantalla Completa` en la barra de cabecera de la sección (`#btnMapHeaderFullscreen`).
2. **Límite Matemático de Zoom-Out y Fronteras Mundiales (`enforceMapWorldBounds`)**:
   - Se configuró Leaflet con `zoomSnap: 0.25`, `zoomDelta: 0.5`, `maxBounds: [[-85.05112878, -179.99], [85.05112878, 179.99]]`, `maxBoundsViscosity: 1.0` y `bounceAtZoomLimits: false`.
   - `enforceMapWorldBounds()` calcula dinámicamente el `minZoom` exacto en función del ancho y alto actuales del contenedor (`Math.ceil(Math.log2((Math.max(w, h) + 20) / 256) * 4) / 4` y `getBoundsZoom(worldBounds, true)`), asegurando que las teselas de OpenStreetMap cubran siempre el 100% del lienzo tanto en vista estándar como en pantalla completa.
