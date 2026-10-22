# Walkthrough — v7.0.0: Rediseño de Precisión del HUD Flotante del Mapa, Panel Desplegable de Servicios y Modo Pantalla Completa

## 1. Resumen de Mejoras de Interfaz y Experiencia de Usuario (`v7.0.0`)

### A. Barra Superior Flotante de Una Sola Línea (`.map-hud-primary-bar`)
- **Simetría Total y Cero Colisiones**: Se desactivó el control de zoom nativo de Leaflet (`zoomControl: false`) y se integraron botones vectoriales SVG de `Zoom +`, `Zoom −`, `Encuadrar` y `Host` directamente en la zona derecha de la barra superior flotante (`left: 12px; right: 12px; top: 12px;`).
- **Jerarquía Limpia sin Saturación**: Se reemplazaron los botones apilados con emojis por pistas segmentadas (`.map-hud-seg-track`) sobre cristal oscuro (`rgba(9, 13, 22, 0.86)`, `backdrop-filter: blur(22px) saturate(185%)`), indicadores luminosos de `6px` (`.hud-status-pip`) y contadores monoespaciados `tabular-nums` (`.map-hud-count-pill`).

### B. Panel Desplegable de Servicios Operativo en Tiempo Real e Historial (`#mapHudServiceCatalogDrawer`)
- **Popover Flotante No Invasivo**: El botón `Servicios` (`#btnMapServicesDropdown`) abre un panel flotante de cristal oscuro (`max-width: 720px`) con cuadrícula CSS responsiva de tarjetas de servicio.
- **Catálogo Unificado (`buildUnifiedServicesCatalog`)**: Funciona tanto en modo **En Vivo** (agrupando al vuelo los servicios de las conexiones activas) como en modo **Historial SQLite** (`/api/net/history`).
- **Cierre Automático y Limpieza Rápida**: Al elegir un servicio en el desplegable, el mapa se filtra al instante, el panel se pliega para dejar el lienzo despejado y el botón superior muestra el nombre del servicio activo junto a un botón `×` (`#btnMapClearServiceQuick`) para restablecer el filtro en un clic.

### C. Controles Adaptativos de Dispositivos y Pantalla Completa
- **Tira Adaptativa de Equipos LAN (`#mapHudDeviceFilterBar`)**: Permanece oculta mientras se inspecciona el tráfico general y se despliega suavemente en una sola fila horizontal al pulsar `Dispositivos` o seleccionar un equipo.
- **Modo Pantalla Completa (`toggleConnectionsMapFullscreen`)**: Expande el contenedor del mapa a `100vw × 100vh` conservando intactos todos los controles flotantes y permitiendo cerrar el desplegable o salir de pantalla completa con la tecla `Escape`.
