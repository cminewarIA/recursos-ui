# Walkthrough y Verificación Técnica · `v12.5.1` (`PATCH`)

## 1. Causa Raíz Exacta Verificada
- Se descargó una tesela real de `https://a.basemaps.cartocdn.com/dark_all/5/15/12.png`, confirmando que CARTO devolvía `HTTP 200 OK` con una imagen PNG de `2.5 KB` estampada con el texto **`API KEY REQUIRED · carto.com/basemaps/apikey`**. Al no devolver error HTTP, Leaflet no activaba el fallback `tileerror` hacia OpenStreetMap.
- Asimismo, las peticiones directas desde clientes con `User-Agent` genérico hacia `tile.openstreetmap.org` recibían HTTP `418 Access blocked` según la política oficial de OpenStreetMap.

## 2. Cambios Implementados
- **`server.py`**:
  - Eliminado `basemaps.cartocdn.com` y `*.basemaps.cartocdn.com` de `Content-Security-Policy` y autorizada `https://server.arcgisonline.com`.
  - Añadida caché LRU `MAP_TILE_CACHE` (`1500` entradas, TTL 7 días), `fetch_cached_map_tile(style, z, x, y)` con `User-Agent: RecursosCockpit/<version> (+https://github.com/cminewarIA/recursos-ui)` y endpoint **`GET /api/maps/tile/{light|dark|osm}/{z}/{x}/{y}.png`**:
    - `light`/`osm`: `https://tile.openstreetmap.org/{z}/{x}/{y}.png` -> respaldo `tile.openstreetmap.de` -> respaldo `ArcGIS World_Light_Gray_Base`.
    - `dark`: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` (oscuro nativo limpio) -> respaldo `tile.openstreetmap.de` / `tile.openstreetmap.org`.
  - Actualizado `GET /api/maps/config` con `"tile_proxy": true`.
- **`src/components/NetworkSecurityView.tsx` y `src/index.css`**:
  - Eliminado `basemaps.cartocdn.com`. Ahora el mapa usa `/api/maps/tile/${theme}/{z}/{x}/{y}.png` con respaldo automático `https://tile.openstreetmap.de/{z}/{x}/{y}.png` y filtro oscuro `.cockpit-osm-dark-fallback` solo si se activa dicho respaldo en tema oscuro.
- **`desktop_app/recursos_app.py` y `vite.config.ts`**:
  - Añadido respaldo directo `/api/maps/tile/...` en el puente local de Ubuntu (cuando el servidor remoto no está accesible) y en el middleware Vite de desarrollo.
- **Control de Versión (`12.5.1` · `PATCH`)**:
  - Actualizados `./VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `src/utils/formatters.ts`, `static/manual.html`, `docs/index.html`, `README.md`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg` y `plugin.json`.

## 3. Verificaciones Ejecutadas tras los Cambios Finales
- **`npx tsc --noEmit && npm run build`**: exit `0` (`2074` módulos, `static/index.html` regenerado).
- **`python3 -m py_compile server.py desktop_app/recursos_app.py`**: exit `0`.
- **Escaneo de referencias CARTO (`rg -n "basemaps\.cartocdn\.com|carto\.com/basemaps" src/ server.py desktop_app/ static/index.html`)**: `ZERO_CARTODB_REFERENCES`.
- **Paquete Debian `.deb`**:
  - `bash packaging/build_deb.sh` generó `dist/recursos-cockpit_12.5.1_amd64.deb` firmado con GPG (`4CFC86D58E9146AE`) y `SHA256SUMS.txt`.
  - `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.5.1_amd64.deb` completado sin errores.
  - `dpkg -l | grep recursos-cockpit` -> `ii  recursos-cockpit  12.5.1  amd64`.
  - `/usr/bin/recursos-cockpit --test-mode` -> `[OK] Recursos Native Ubuntu HTML5 App v12.5.1 validated successfully.`
- **Despliegue en `/home/servidor/servicios/dashboard` y verificación visual de teselas vivas**:
  - `recursos_history.db` intacta (`INODE=1049392`).
  - `system-dashboard.service` `active`.
  - `GET http://127.0.0.1:8085/api/version` -> `VERSION_API: 12.5.1 DEB: 12.5.1`.
  - `GET http://127.0.0.1:8085/api/maps/tile/dark/5/15/12.png` -> `HTTP 200`, `X-Tile-Provider: arcgis-dark`, `image/jpeg` 256×256 verificada visualmente sin marcas de agua.
  - `GET http://127.0.0.1:8085/api/maps/tile/light/5/15/12.png` -> `HTTP 200`, `X-Tile-Provider: osm`, `image/png` 256×256 verificada visualmente sin marcas de agua.

