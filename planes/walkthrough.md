# Walkthrough — v7.0.1: Pantalla Completa Garantizada y Límite Dinámico de Zoom Mundial en el Mapa

## 1. Correcciones y Mejoras Verificadas (`v7.0.1`)

### A. Modo Pantalla Completa Real (`100vw × 100dvh`) y Accesibilidad Permanente
- **Eliminación de Trampa CSS (`backdrop-filter`)**: Se añadió la clase global `body.map-fullscreen-active` que neutraliza `backdrop-filter`, `transform`, `filter` y `contain` en `.connections-map-card` y sus ancestros mientras el mapa está en pantalla completa, ocultando además la barra superior del sistema y el dock táctil para que el mapa ocupe el 100% de la ventana (`100vw × 100dvh`) incluso dentro de iframes con permisos restringidos.
- **Controles de Pantalla Completa Siempre Visibles**:
  1. **Zona Derecha Fija en el HUD (`.map-hud-pinned-right`)**: Anclada a la derecha de la barra superior flotante para que los botones de `Zoom +`, `Zoom −`, `Encuadrar`, `Host` y `Pantalla Completa` nunca queden ocultos por desplazamiento horizontal.
  2. **Botón Flotante en Esquina Inferior Derecha (`#btnMapCornerFullscreen`)**: Acceso directo táctil en la esquina inferior derecha del mapa.
  3. **Botón en Cabecera de Sección (`#btnMapHeaderFullscreen`)**: Situado junto a la insignia `OpenStreetMap · SQLite GeoIP`.

### B. Bloqueo de Zoom-Out Más Allá del Mapa Mundial (`enforceMapWorldBounds`)
- **Cálculo Dinámico de `minZoom`**: La función `enforceMapWorldBounds()` mide las dimensiones reales de `#networkConnectionsMapCanvas` (`w × h`) al inicializar, redimensionar o conmutar Pantalla Completa y fija automáticamente el nivel mínimo de zoom (`minZoom`) de modo que la proyección Web Mercator (`256 * 2^z` px) sea siempre mayor que el ancho y alto del visor.
- **Fronteras Rígidas (`maxBoundsViscosity: 1.0` y `bounceAtZoomLimits: false`)**: Impide arrastrar o alejar la cámara más allá de los polos (`±85.05°`) o de los extremos longitudinales (`±179.99°`), eliminando por completo la aparición de franjas vacías o transparentes fuera del mapa.
- **Indicador Visual en Botones de Zoom (`syncZoomButtonsUI`)**: El botón `Zoom −` (`#btnMapZoomOut`) se deshabilita automáticamente al alcanzar el límite mundial de cobertura.
