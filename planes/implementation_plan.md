# Plan de Implementación — v7.0.0: Rediseño de Precisión del HUD Flotante del Mapa, Panel Desplegable de Servicios y Modo Pantalla Completa

## 1. Objetivo del Rediseño (`MAJOR` v7.0.0)
Sustituir la interfaz anterior de botones apilados por una **Barra Superior Flotante de Precisión (`.map-hud-primary-bar`)** de una sola línea, un **Panel Desplegable Flotante de Servicios (`#mapHudServiceCatalogDrawer`)** en cristal oscuro y una **Tira Adaptativa de Dispositivos (`#mapHudDeviceFilterBar`)** que no obstruyan el lienzo del mapa ni colisionen con los controles de Leaflet, funcionando de forma idéntica en vista estándar y en **Pantalla Completa (`100vw × 100vh`)**.

## 2. Arquitectura Visual y Funcional
1. **Barra Superior Flotante Simétrica (`left: 12px; right: 12px; top: 12px;`)**:
   - Una sola línea horizontal (`flex-wrap: nowrap`) con tres zonas claramente diferenciadas y separadores verticales de `1px`:
     - **Zona Izquierda**: Conmutador segmentado `En Vivo` / `Historial` + botón desplegable `Servicios` (`#btnMapServicesDropdown`) con icono vectorial SVG de capas, contador tabular (`#cntMapHistServices`), indicador de servicio activo y botón rápido `×` (`#btnMapClearServiceQuick`).
     - **Zona Central**: Pista segmentada de filtrado adaptativo (`Todas`, `Entrantes`, `Salientes`, `Dispositivos`, `Bloqueadas`) con indicadores semánticos de `6px` y contadores `tabular-nums`.
     - **Zona Derecha**: Controles integrados de cámara y zoom en SVG (`Zoom +`, `Zoom −`, `Encuadrar`, `Host`) —reemplazando el control nativo de Leaflet que generaba asimetría— junto al botón de **Pantalla Completa**.
2. **Panel Desplegable Flotante de Servicios (`#mapHudServiceCatalogDrawer`)**:
   - Popover de cristal oscuro (`max-width: 720px`) con animación suave (`hudDropdownSlideIn`), operativo tanto en modo **En Vivo** (agregando servicios activos en tiempo real) como en modo **Historial SQLite**.
   - Incluye selector de ventana temporal (`Todo`, `6h`, `24h`, `7d`), buscador con icono SVG, recarga en vivo, limpieza de base de datos y cuadrícula CSS responsiva (`grid-template-columns: repeat(auto-fill, minmax(195px, 1fr))`).
   - Al seleccionar un servicio, filtra el mapa de inmediato y cierra el popover para despejar la vista cartográfica (también se cierra automáticamente al hacer clic sobre el mapa o pulsar `Escape`).
3. **Tira Adaptativa de Dispositivos LAN (`#mapHudDeviceFilterBar`)**:
   - Se muestra de forma adaptativa únicamente cuando el usuario activa el filtro `Dispositivos` o aísla un equipo específico, evitando ocupar espacio vertical en el resto de vistas.
