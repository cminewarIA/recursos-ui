# Plan de Implementación: Agrupación de Conexiones en Mapa, Selector de IPs y Popups Persistentes (`v4.11.0`)

## Descripción del Problema y Objetivos
1. **Superposición de Marcadores**: Cuando múltiples conexiones coinciden en las mismas coordenadas (por ejemplo, múltiples sockets hacia Google, Cloudflare, Azure o dispositivos en red local con varios servicios), los pines se dibujaban uno encima del otro, ocultando las demás conexiones y haciendo imposible verlas todas.
2. **Visualización de Conexiones Múltiples ("ver como varios")**: El usuario solicita que si hay varias conexiones en un punto, el marcador se distinga visualmente como un grupo con su contador (ej. `🔀 4 Mountain View` o `🔀 2 192.168.50.242`), y que al pulsar sobre él se despliegue una **lista interactiva de las IPs**.
3. **Cierre Prematuro del Popup ("se me cierra enseguida")**: Leaflet cerraba el popup por dos motivos:
   - Cada 2 segundos el polling de `/api/metrics` redibuja las capas del mapa (`clearMapOverlays()`), destruyendo el marcador que tenía el popup abierto.
   - La opción por defecto de Leaflet `closeOnClick: true` / `closePopupOnClick: true` cerraba el popup al hacer clic o arrastrar mínimamente el mapa.
   El objetivo es que **el popup permanezca abierto de forma fija y estable** hasta que el usuario decida cerrarlo con el botón `×`.

---

## Cambios Propuestos

### 1. `static/index.html` e `index.html` (Frontend)
- **Agrupación de Conexiones por Coordenadas**:
  - Agrupar `filteredConns` mediante una clave geográfica (`lat_lng` redondeada a 3 decimales o identidad IP).
  - Si un grupo tiene 1 conexión: se renderiza el marcador individual habitual (`↓ IP` / `↑ IP`).
  - Si un grupo tiene 2 o más conexiones: se renderiza con estilo `.gmp-conn-marker.grouped` mostrando `🔀 [N] [Ciudad o IP]`.
- **Nuevo Generador de Popups para Grupos (`buildGroupInfoWindowNode`)**:
  - **Vista Lista (por defecto)**:
    - Encabezado con el número total de conexiones y ubicación geográfica.
    - Lista interactiva y desplazable con cada IP, puertos, servicio (`Emby`, `Google Cast`, etc.), estado del socket y flecha de dirección (`↓ / ↑`).
    - Al hacer clic sobre cualquier IP de la lista, el popup conmuta a la vista detallada de esa IP específica.
  - **Vista Detallada**:
    - Muestra todos los detalles técnicos (proceso local, puertos, ISP, ASN, telemetría).
    - Menú y botón de control de firewall Fail2ban (`🚫 Bloquear IP` / `🔓 Desbloquear`).
    - Botón `◀ Ver todas las conexiones (N)` para regresar a la lista de IPs sin cerrar el popup.
- **Persistencia de Popups y Prevención de Cierres Prematuros**:
  - Configurar Leaflet con `closePopupOnClick: false`, `closeOnClick: false`, `autoClose: false`.
  - Guardar el estado activo del popup (`_activePopupState = { type, groupKey, selectedConnId }`).
  - Durante el refresco cíclico de métricas (`renderFromMetrics`):
    - Activar bandera `_isRedrawing = true`.
    - Si había un popup abierto, restaurarlo automáticamente tras el refresco sin parpadeos ni pérdidas de foco.
    - El popup solo se cerrará cuando el usuario pulse explícitamente el botón de cierre `×` o seleccione otro nodo.
- **Integración con la Tabla de Conexiones**:
  - `focusConnectionById(connId)` localizará el grupo correspondiente, centrará el mapa y abrirá el popup directamente en la vista de detalle de esa conexión.

---

## Cambios en Control de Versiones y Documentación
- `VERSION` → `4.11.0` (según Regla 5: `0.X.0` al añadir nueva funcionalidad de agrupación interactiva y persistencia).
- `package.json` → `4.11.0`.
- `README.md` → Actualizar título y añadir sección `## ✨ Novedades en v4.11.0`.
- `planes/2026-10-21_agrupacion_conexiones_y_popup_persistente.md` y `planes/walkthrough.md`.

---

## Plan de Verificación
1. **Prueba de Agrupación Visual**:
   - Abrir vista de Red en el dashboard y comprobar que puntos con conexiones concurrentes (ej. Mountain View, Frankfurt o dispositivos LAN con varios sockets) muestran la insignia `🔀 N`.
2. **Prueba de Lista de IPs y Selección**:
   - Hacer clic en un marcador múltiple: verificar que se despliega la lista con las IPs.
   - Pulsar sobre una IP: verificar que se abren sus detalles y controles de firewall.
   - Pulsar `◀ Volver a la lista`: verificar que regresa al listado de conexiones.
3. **Prueba de Persistencia ante Refrescos**:
   - Dejar el popup abierto durante más de 10-15 segundos mientras el dashboard recibe actualizaciones cada 2 segundos.
   - Comprobar que el popup **no se cierra**, permitiendo leer los datos y pulsar los botones tranquilamente.
4. **Verificación de Versión**:
   - Probar `curl http://127.0.0.1:8085/api/version` y comprobar `4.11.0`.
