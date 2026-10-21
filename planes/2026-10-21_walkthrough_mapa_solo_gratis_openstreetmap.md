# Recorrido de Verificación: Motor Exclusivo Libre OpenStreetMap (v4.9.0)

Se ha completado la configuración para dejar de manera exclusiva el **mapa gratuito y libre de OpenStreetMap / CartoDB Dark Matter**, eliminando por completo cualquier dependencia, clave de API o modal de Google Maps.

## Cambios Realizados
1. **Frontend (`index.html` y `static/index.html`):**
   - Eliminado el diálogo `#mapEngineModal` y los controles de selección de motor cartográfico.
   - Reemplazado el botón de configuración por la insignia informativa `🗺️ OpenStreetMap (Libre)`.
   - Simplificado el overlay de inicialización (`#networkConnectionsMapStatus`), eliminando botones redundantes.
   - Refactorizado `NetworkConnectionsMapEngine` para operar exclusivamente con **Leaflet.js**:
     - Carga directa y reactiva con teselas CartoDB Dark Matter (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`).
     - Renderizado de nodo servidor, conexiones remotas (entrantes en verde `#10B981`, salientes en cian `#06B6D4`, bloqueadas en rojo `#F43F5E`) y polilíneas direccionales.
     - Conservadas las funciones de auto-encuadre `fitAllBounds()`, centrado de host `focusServerNode()` y enfoque por ID `focusConnectionById()`.
     - Eliminadas funciones obsoletas y bloques de script superfluos.
2. **Backend (`server.py`):**
   - Endpoint `/api/maps/config` simplificado para responder de inmediato `{ "engine": "leaflet", "provider": "OpenStreetMap", "free": true }`.
   - Eliminada la inyección de claves de Google Maps en el payload de métricas.
3. **Versión y Repositorio:**
   - Versión incrementada a `4.9.0` en `VERSION` y `package.json`.
   - Actualizado `README.md` con la sección `## ✨ Novedades en v4.9.0`.
   - Documentación y planes guardados en `planes/`.

## Pruebas Realizadas
- `sudo systemctl restart system-dashboard.service`: Servicio reiniciado y en ejecución activa.
- `curl -s http://127.0.0.1:8085/api/maps/config`: Verificado retorno de `{ "engine": "leaflet", "provider": "OpenStreetMap", "free": true }`.
- `curl -s http://127.0.0.1:8085/api/version`: Verificada versión `4.9.0`.
