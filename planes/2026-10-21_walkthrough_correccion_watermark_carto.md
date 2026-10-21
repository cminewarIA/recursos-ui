# Recorrido de Verificación: Eliminación de Marca de Agua 'API KEY REQUIRED' (v4.9.2)

Se ha eliminado definitivamente el mensaje y marca de agua *"API KEY REQUIRED"* que aparecía en las teselas del mapa.

## Causa del Problema
Las teselas del mapa estaban configuradas para descargarse desde `basemaps.cartocdn.com` (CARTO). CARTO cambió recientemente su modelo de servicio libre y comenzó a estampar una marca de agua roja con el texto *"API KEY REQUIRED"* en cada cuadrante PNG descargado si no se envía una clave de pago.

## Solución Implementada
1. **Frontend (`index.html` y `static/index.html`):**
   - Reemplazada la fuente de teselas por el servidor oficial de **OpenStreetMap** (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`), con respaldo en tiempo real ante fallos de red hacia `https://tile.openstreetmap.de/{z}/{x}/{y}.png`.
   - Implementado en CSS un filtro de modo oscuro de alto rendimiento aplicado exclusivamente sobre `.leaflet-tile-pane`:
     `filter: invert(100%) hue-rotate(180deg) brightness(85%) contrast(92%);`
     Esto proporciona una cartografía oscura limpia y nativa sin marcas de agua ni sobreimpresiones, manteniendo el 100% de la fidelidad cromática de los marcadores de sockets y conexiones.
   - Actualizadas todas las referencias y atribuciones a `OpenStreetMap (100% Libre)`.
2. **Backend (`server.py`):**
   - Actualizadas las cabeceras CSP para autorizar `https://*.tile.openstreetmap.org` y `https://*.tile.openstreetmap.de`.
3. **Versión y Documentación:**
   - Versión incrementada a `4.9.2` siguiendo la regla `0.0.X` (corrección de bugfix en componente existente).
   - Documentación actualizada en `README.md`.
