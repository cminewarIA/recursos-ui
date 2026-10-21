# Plan de Implementación: Motor Dual de Mapa de Red (OpenStreetMap / Leaflet Gratuito + Google Maps Opcional)

## 1. Diagnóstico del Problema

El usuario reporta que en la sección de **Red**, el mapa de conexiones muestra de forma bloqueante:
> *"Esperando configuración de VITE_GOOGLE_MAPS_API_KEY... Configura la variable de entorno VITE_GOOGLE_MAPS_API_KEY para activar el mapa interactivo de conexiones."*

### Causa Raíz
1. En la versión `v4.2.0`, se integró un visor geoespacial de flujos de red acoplado exclusivamente a Google Maps Platform (`importLibrary('maps')`).
2. Google Maps Platform exige una clave de API registrada con facturación en Google Cloud Console. En el servidor local del usuario no está configurada la variable `VITE_GOOGLE_MAPS_API_KEY`.
3. Al estar vacía la clave (`getApiKey() === ''`), `ensureInitialized()` bloqueaba por completo la renderización del mapa y mostraba el overlay de espera, impidiendo visualizar los 76 sockets y conexiones ya recolectados por la telemetría del kernel.

---

## 2. Solución Propuesta: Motor Dual Inteligente

1. **OpenStreetMap / Leaflet (CartoDB Dark Matter) como Motor Predeterminado**:
   - 100% gratuito, libre y sin necesidad de ninguna clave de API ni registro.
   - Si no existe `VITE_GOOGLE_MAPS_API_KEY` (o si el usuario prefiere OpenStreetMap), el mapa se inicializa inmediatamente con **Leaflet** y teselas oscuras de **CartoDB Dark Matter**, encajando con el diseño Nextcloud Hub.
   - Traza los mismos marcadores del servidor central y conexiones entrantes, salientes y bloqueadas (IPS), con polilíneas geodésicas y popups interactivos.
2. **Google Maps Platform (Opcional)**:
   - Se mantiene el soporte completo de Google Maps si el usuario cuenta con una clave válida.
3. **Selector y Configurador de Motor en la UI**:
   - Botón `🗺️ Motor: OpenStreetMap (Gratis)` / `Google Maps` en la barra de control del mapa.
   - Modal interactivo para alternar entre motores e introducir/guardar la clave `VITE_GOOGLE_MAPS_API_KEY` si se desea.
4. **Backend ([server.py](file:///home/servidor/servicios/dashboard/server.py))**:
   - Endpoint `GET /api/maps/config` y `POST /api/maps/config` para gestionar la clave de forma segura en `.env`.
   - Ajuste de cabeceras CSP (`Content-Security-Policy`) para permitir teselas de CartoDB (`*.basemaps.cartocdn.com`), OpenStreetMap (`*.tile.openstreetmap.org`) y CDNs (`cdn.jsdelivr.net`, `unpkg.com`).
5. **Control de Versiones y Documentación**:
   - Incrementar versión en [`VERSION`](file:///home/servidor/servicios/dashboard/VERSION) de `4.7.0` a `4.8.0`.
   - Sincronizar [`package.json`](file:///home/servidor/servicios/dashboard/package.json).
   - Actualizar [`README.md`](file:///home/servidor/servicios/dashboard/README.md).
   - Registrar walkthrough en `planes/`.
   - Confirmar y hacer `git push` a `origin/main`.

---

## 3. Plan de Verificación

1. Cargar la vista de Red sin ninguna API key configurada y comprobar que el mapa de OpenStreetMap se inicializa al instante sin mostrar el aviso de espera.
2. Comprobar que los 76 nodos y conexiones actuales se grafican con sus colores (verde entrante, cian saliente, rojo bloqueado, azul host).
3. Verificar que al pulsar sobre las filas de la tabla de conexiones el mapa se centra y abre el popup informativo del socket.
4. Verificar que el botón de selector de motor permite cambiar de proveedor y configurar la API key.
5. Comprobar la sintaxis del backend y el estado del servicio `system-dashboard.service`.
