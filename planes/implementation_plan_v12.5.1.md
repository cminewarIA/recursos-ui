# Plan de Implementación · `v12.5.1` (`PATCH` · Eliminación Definitiva de `basemaps.cartocdn.com` "API KEY REQUIRED" y Proxy Cacheado `/api/maps/tile/`)

## 1. Diagnóstico Real Confirmado
Al descargar directamente teselas PNG desde `https://a.basemaps.cartocdn.com/dark_all/...` se comprobó que CARTO responde con `HTTP 200 OK` devolviendo una imagen PNG de `2.5 KB` estampada con **`API KEY REQUIRED · carto.com/basemaps/apikey`**. Al responder `200 OK`, Leaflet no activaba el evento `tileerror` ni conmutaba a OpenStreetMap. Asimismo, las peticiones desde clientes WebKit2/WebView hacia `tile.openstreetmap.org` sin `User-Agent` específico recibían HTTP `418 Access blocked`.

## 2. Solución Arquitectónica (`12.5.1` · `PATCH`)
1. **`server.py`**:
   - Añadir caché LRU en memoria (`MAP_TILE_CACHE`, TTL 7 días, máx. 1500 teselas) y `fetch_cached_map_tile(style, z, x, y)` con `User-Agent: RecursosCockpit/<version>`.
   - Exponer `GET /api/maps/tile/{light|dark|osm}/{z}/{x}/{y}.png` enviando:
     - Modo claro (`light`/`osm`): `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, respaldo `https://tile.openstreetmap.de/{z}/{x}/{y}.png` y `ArcGIS World_Light_Gray_Base`.
     - Modo oscuro (`dark`): `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` (oscuro nativo sin marcas ni API Key) y respaldo `tile.openstreetmap.de` / `tile.openstreetmap.org`.
   - Eliminar `basemaps.cartocdn.com` y `*.basemaps.cartocdn.com` de las cabeceras CSP.
2. **`src/components/NetworkSecurityView.tsx` + `src/index.css`**:
   - Sustituir `basemaps.cartocdn.com` por `/api/maps/tile/${theme}/{z}/{x}/{y}.png` con respaldo `https://tile.openstreetmap.de/{z}/{x}/{y}.png` y clase `.cockpit-osm-dark-fallback` para aplicar inversión oscura CSS únicamente si entra el respaldo OSM en modo oscuro.
3. **`desktop_app/recursos_app.py` y `vite.config.ts`**:
   - Añadir respaldo local directo en `LocalHtmlBridgeServer` (Ubuntu `.deb`) y middleware de desarrollo Vite para `/api/maps/tile/...`.
4. **Sincronización SemVer `12.5.1` y Despliegue**:
   - Actualizar `VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, React/Manual/README/SVGs, compilar SPA, construir e instalar `.deb`, sincronizar `/home/servidor/servicios/dashboard` sin tocar `recursos_history.db`, y verificar `/api/maps/tile/dark/3/3/3.png` y `/api/maps/tile/light/3/3/3.png` visualmente con `read_file`.

