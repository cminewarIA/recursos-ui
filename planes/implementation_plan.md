# Plan de Implementación: Corrección de Marca de Agua 'API KEY REQUIRED' en el Mapa

El usuario ha reportado que en el mapa aparece el texto "api key requerid" (`API KEY REQUIRED`).

## Causa Raíz Identificada
El proveedor de teselas `basemaps.cartocdn.com` (CARTO Dark Matter) comenzó recientemente a exigir clave de API para todas las peticiones de teselas raster y vectoriales. Al solicitar las imágenes sin clave, el servidor de CARTO estampa una marca de agua roja/grisácea con el texto "API KEY REQUIRED" dentro de los propios archivos PNG de cada cuadrante cartográfico.

## Solución Propuesta (v4.9.2)
1. **Frontend (`index.html` y `static/index.html`):**
   - Reemplazar la URL de teselas de CARTO por **OpenStreetMap oficial y su espejo comunitario de alta disponibilidad**:
     - Primario: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
     - Respaldo dinámico en error: `https://tile.openstreetmap.de/{z}/{x}/{y}.png`
   - Incorporar en el CSS un filtro de inversión y rotación de tono específico para `.leaflet-tile-pane`:
     `filter: invert(100%) hue-rotate(180deg) brightness(85%) contrast(92%);`
     Esto genera un mapa oscuro elegante y nítido directamente sobre los datos 100% abiertos de OpenStreetMap, sin tocar los marcadores de colores (verde, cian, rojo, azul) ni los popups informativos.
   - Actualizar las etiquetas de atribución a `OpenStreetMap (100% Libre)`.
2. **Backend (`server.py`):**
   - Actualizar las cabeceras CSP para permitir `https://*.tile.openstreetmap.org` y `https://*.tile.openstreetmap.de`.
3. **Versión y Documentación:**
   - Incrementar versión de `4.9.1` a `4.9.2` (corrección de bugfix según regla estricta `0.0.X`).
   - Sincronizar `package.json`, `VERSION`, `README.md` y planes en `planes/`.
   - Reiniciar `system-dashboard.service`.
   - Ejecutar `git commit` y `git push origin main`.
