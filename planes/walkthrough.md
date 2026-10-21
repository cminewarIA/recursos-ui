# Recorrido de Verificación: Agrupación de Conexiones en Mapa, Selector de IPs y Popups Persistentes (`v4.11.0`)

## Resumen del Cambio
- **Objetivo**: Resolver la superposición de marcadores concurrentes en el mapa de red, permitiendo ver marcadores agrupados con contador (`🔀 N`), una lista interactiva de IPs al pulsar sobre ellos con selector de detalle y acciones Fail2ban, y eliminar el cierre involuntario de los popups debido al polling de telemetría cada 2s o a clics en el mapa.
- **Versión**: Incrementada a `4.11.0` (según Regla 5: `0.X.0` al añadir nueva funcionalidad).

## Componentes Modificados
1. **`server.py`**:
   - `lan_coords_map` y `pending_coords_map`: Los sockets de una misma IP local o en espera comparten exactamente las mismas coordenadas en la órbita de Gran Canaria para agruparse coherentemente en un único pin de dispositivo físico.
2. **`static/index.html` e `index.html`**:
   - **CSS**: Clases `.gmp-conn-marker.grouped` y `.group-count-pill` para diferenciar marcadores agrupados con contadores estilizados según el flujo (`incoming`, `outgoing`, `blocked`).
   - **Leaflet Map Config**: `closePopupOnClick: false` en `L.map` y `autoClose: false`, `closeOnClick: false` en los popups.
   - **Gestión de Estado de Popup (`_activePopupState`)**: Registra el popup abierto (`server` o `group` con `groupKey` y `selectedConnId`).
   - **Preservación en Redibujado (`renderFromMetrics`)**: Durante las actualizaciones periódicas de 2 segundos, `savedPopupState` reabre de forma inmediata el popup sin parpadeos ni pérdidas de datos.
   - **`buildGroupInfoWindowNode`**:
     - Vista listado con todas las IPs, servicios y flechas de dirección.
     - Vista detalle al pulsar cualquier IP de la lista con botón `◀ Ver lista de IPs (N)`.
   - **Integración con Tabla**: `focusConnectionById(connId)` localiza el grupo y abre la vista detallada de esa conexión de forma directa.
3. **`VERSION` y `package.json`**:
   - Establecidos a `4.11.0`.
4. **`README.md`**:
   - Documentada la versión `4.11.0` y sus características.
