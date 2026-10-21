# Walkthrough v4.2.0 — Mapa Geoespacial de Conexiones Entrantes y Salientes (Google Maps Platform)

## 1. Resumen de la Implementación
Se ha integrado un **Mapa Geoespacial Interactivo de Conexiones Entrantes y Salientes** impulsado por **Google Maps Platform (`Maps JavaScript API`)** dentro de la vista de Red (`/red` -> `#viewNetwork`), manteniendo una arquitectura 100% libre de datos estáticos (Zero-Hardcoding) y cumpliendo las directrices de seguridad, atribución y rendimiento de Google Maps Platform.

## 2. Arquitectura Backend (`server.py` y `vite.config.ts`)
- **Inspección de Sockets del Kernel en Tiempo Real**:
  - Lectura directa de conexiones TCP/UDP activas mediante `psutil.net_connections(kind='inet')` y `/proc/net/tcp` + `/proc/net/udp`.
  - Clasificación automática del sentido del flujo (`incoming` vs `outgoing`) cruzando los puertos locales en escucha (`LISTEN`) y el rango de puertos de servicio frente a puertos efímeros.
  - Incorporación automática de direcciones IP bloqueadas activamente por **Fail2ban IPS** con estado `blocked`.
- **Geolocalización IP con Caché en Memoria (Cumplimiento ToS < 30 días)**:
  - Resolución asíncrona no bloqueante de la IP pública del nodo servidor (`server_node`) y resolución por lotes (`ip-api.com/batch`) de las IPs públicas remotas con TTL inferior a 25 días.
  - Posicionamiento determinista en anillo local para conexiones de subred interna (`is_lan: true`).
- **Seguridad de Credenciales (`VITE_GOOGLE_MAPS_API_KEY`)**:
  - Ninguna clave API ha sido codificada en el código fuente. Se lee dinámicamente desde variables de entorno (`import.meta.env.VITE_GOOGLE_MAPS_API_KEY` y `os.environ.get("VITE_GOOGLE_MAPS_API_KEY")`).

## 3. Arquitectura Frontend (`index.html` y `static/index.html`)
- **Motor `NetworkConnectionsMapEngine`**:
  - Carga dinámica mediante el cargador oficial `google.maps.importLibrary('maps')` y `google.maps.importLibrary('marker')`.
  - Configuración del mapa con `mapId: 'DEMO_MAP_ID'`, `renderingType: 'VECTOR'` y atribución `internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio']`.
  - Uso exclusivo de `AdvancedMarkerElement` con insignias HTML personalizadas (`marker.append(badge)`) para el Nodo Host (`🖥️`), conexiones entrantes (`↓` en verde esmeralda `#10B981`), conexiones salientes (`↑` en cian `#06B6D4`) e IPs bloqueadas (`🛡️` en rosa `#F43F5E`).
  - Trazado de arcos geodésicos (`google.maps.Polyline` con `geodesic: true` y colores hexadecimales) con símbolos direccionales (`FORWARD_CLOSED_ARROW`) orientados según el sentido real del tráfico.
  - Instancia única reutilizable de `google.maps.InfoWindow` con ficha técnica del socket y atribución `Google Maps`.
- **Controles y Tabla Sincronizada**:
  - Filtros segmentados (`Todas`, `↓ Entrantes`, `↑ Salientes`, `🛡️ Bloqueadas`), botones `🌍 Encuadrar Todo` y `🖥️ Nodo Host`, y tabla interactiva inferior que centra el mapa al hacer clic en cualquier fila.
