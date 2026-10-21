# Plan de Implementación: Motor Único y Gratuito OpenStreetMap / Leaflet

El usuario ha solicitado dejar **únicamente el mapa gratis** (`deja solo el mapa gratis`), eliminando por completo Google Maps, la necesidad de claves de API y los selectores de motor cartográfico.

## 1. Objetivos y Cambios Propuestos
1. **Frontend (`index.html` y `static/index.html`):**
   - Eliminar el botón de configuración `btnMapEngineConfig` y el modal `#mapEngineModal`.
   - Mostrar en la barra de herramientas del mapa una etiqueta informativa limpia de OpenStreetMap (`🗺️ OpenStreetMap (Libre)`).
   - Eliminar el contenedor `#mapStatusActionWrap` del overlay de estado.
   - Refactorizar y simplificar `NetworkConnectionsMapEngine`:
     - Eliminar todo el código de Google Maps (`loadBootstrap`, `importLibrary`, `AdvancedMarkerElement`, `Polyline`, `InfoWindow`, `gm_authFailure`).
     - Mantener exclusivamente la inicialización directa y reactiva de **Leaflet.js** con teselas de **CartoDB Dark Matter**.
     - Conservar marcadores de host, conexiones entrantes (verde), salientes (cian), bloqueadas (rojo), polilíneas y popups interactivos.
     - Conservar `fitAllBounds()`, `focusServerNode()` y `focusConnectionById()`.
     - Eliminar funciones obsoletas: `openMapEngineModal()`, `closeMapEngineModal()`, `onMapEngineChoiceChanged()`, `saveMapEngineConfig()`, `switchToLeafletEngine()`.
     - Eliminar la inyección de `VITE_GOOGLE_MAPS_API_KEY` en el `<script type="module">`.
2. **Backend (`server.py`):**
   - Simplificar `/api/maps/config` para devolver siempre `{ "engine": "leaflet", "provider": "OpenStreetMap", "free": true }`.
   - Mantener las cabeceras CSP optimizadas para Leaflet y teselas de OpenStreetMap / CartoDB.
3. **Control de Versión y Reglas:**
   - Incrementar la versión canónica a `4.9.0` en `VERSION` y `package.json`.
   - Actualizar `README.md` documentando la simplificación a motor 100% libre.
   - Guardar plan y walkthrough en la carpeta `planes/`.
   - Reiniciar `system-dashboard.service`.
   - Ejecutar `git commit` y `git push origin main`.
