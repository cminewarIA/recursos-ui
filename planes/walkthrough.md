# Recorrido y Verificación: Motor Dual de Mapa de Red (OpenStreetMap / Leaflet Gratuito + Google Maps Opcional) - v4.8.0

Se ha solucionado el bloqueo que mostraba el aviso *"Esperando configuración de VITE_GOOGLE_MAPS_API_KEY..."* en la sección de Red mediante la implementación de una arquitectura de **Motor Dual de Mapas**, habilitando **OpenStreetMap (Leaflet.js + CartoDB Dark Matter)** de forma predeterminada y 100% gratuita sin requerir claves de API, manteniendo al mismo tiempo el soporte opcional de Google Maps Platform con configurador interactivo.

---

## 1. Problema Diagnosticado

- **Causa**: La integración inicial del mapa geoespacial (`NetworkConnectionsMapEngine`) en `v4.2.0` estaba acoplada de forma obligatoria a `google.maps.importLibrary('maps')`.
- Al no contar el servidor local con una clave `VITE_GOOGLE_MAPS_API_KEY` (debido a que Google Cloud exige registro y facturación), la función `ensureInitialized()` mostraba un cartel de bloqueo permanente, impidiendo visualizar las decenas de flujos de red reales detectados por el kernel.

---

## 2. Solución Implementada

### A. Motor Predeterminado OpenStreetMap (Leaflet.js + CartoDB Dark Matter)
- **Cero Claves y Cero Configuración**: Si no hay clave de Google Maps configurada, el mapa arranca automáticamente en modo OpenStreetMap.
- **Estética Dark Nativa**: Se integró la capa de teselas **CartoDB Dark Matter** (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`), encajando con la paleta de colores del sistema.
- **Visualización Completa de Sockets**:
  - **Nodo Host Central**: Marcador azul con icono de servidor y ficha técnica (IP LAN, WAN, ISP, GeoIP).
  - **Conexiones Entrantes (`↓ RX`)**: Marcadores verdes (`#10B981`) y líneas con trazo discontinuo.
  - **Conexiones Salientes (`↑ TX`)**: Marcadores cian (`#06B6D4`) y líneas continuas.
  - **Defensa IPS (`🛡️ Bloqueadas`)**: Marcadores rojos (`#F43F5E`) con las IPs neutralizadas por Fail2ban.
  - **Popups e Interacción Bidireccional**: Al pulsar cualquier fila de la tabla inferior de conexiones, el mapa se desplaza suavemente (`setView`) y abre el popup informativo del flujo.

### B. Selector y Configurador en la Interfaz (`#mapEngineModal`)
- Se añadió un botón en la barra de herramientas del mapa: `🗺️ OpenStreetMap (Gratis) ⚙️`.
- Al pulsarlo, se abre un diálogo modal para:
  1. Alternar entre **OpenStreetMap / CartoDB (Gratis)** y **Google Maps Platform**.
  2. Introducir o actualizar la clave `VITE_GOOGLE_MAPS_API_KEY` si el usuario desea utilizar Google Maps.
  3. Guardar la configuración de forma persistente tanto en el backend (`.env`) como en el frontend (`localStorage`).
- En caso de que se intente usar Google Maps sin clave o con fallo de autenticación, el overlay ofrece un botón rápido de un clic para volver a OpenStreetMap sin recargar la página.

### C. Backend y Cabeceras de Seguridad ([server.py](file:///home/servidor/servicios/dashboard/server.py))
- **Content-Security-Policy (CSP)**: Actualizado para autorizar teselas de `*.basemaps.cartocdn.com`, `*.tile.openstreetmap.org`, librerías desde `cdn.jsdelivr.net` / `unpkg.com` y resolución GeoIP desde `ip-api.com`.
- **Endpoints de Configuración**:
  - `GET /api/maps/config`: Informa al cliente si existe clave configurada y cuál es el motor activo.
  - `POST /api/maps/config`: Permite guardar o revocar de forma segura la clave en el archivo `.env` del servidor.

---

## 3. Pruebas y Verificación

1. **Consulta de Configuración de Mapas**:
   ```bash
   curl -s http://127.0.0.1:8085/api/maps/config
   # Respuesta: {"has_key": false, "masked_key": "", "engine": "leaflet"}
   ```
2. **Consulta de Versión Canónica**:
   ```bash
   curl -s http://127.0.0.1:8085/api/version
   # Confirma "version": "4.8.0"
   ```
3. **Verificación de Cabeceras CSP**:
   ```bash
   curl -s -I http://127.0.0.1:8085/ | grep -i content-security-policy
   # Confirma autorización de basemaps.cartocdn.com, tile.openstreetmap.org y cdn.jsdelivr.net
   ```
4. **Telemetría de Conexiones Activas**:
   - `connections_map` en `/api/metrics` recolecta más de 70 conexiones de red activas, listas para ser proyectadas geográficamente sin bloqueos de clave.
5. **Estado del Servicio**:
   - `systemctl is-active system-dashboard.service` $\rightarrow$ `active`.
