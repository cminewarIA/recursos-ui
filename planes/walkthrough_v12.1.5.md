# Walkthrough — v12.1.5 (`v2B.1.5`): Geomapa 100 % Libre (OpenStreetMap / CartoDB) sin API Key

## 1. Cambios Realizados
- [`.env.example`](../.env.example): Eliminada la variable `VITE_GOOGLE_MAPS_API_KEY="YOUR_GOOGLE_MAPS_API_KEY"` que disparaba peticiones de clave de API en Google AI Studio.
- [`vite.config.ts`](../vite.config.ts):
  - Reemplazado el objetivo DNS `maps.googleapis.com` por `tile.openstreetmap.org`.
  - Eliminados `loadEnv`/`mapsApiKey`/`VITE_GOOGLE_MAPS_API_KEY` y sustituido `maps_api_key` en `/api/metrics` por `maps_engine: 'leaflet'`.
  - Añadido `/api/maps/config` en modo dev con `{ success: true, engine: 'leaflet', provider: 'OpenStreetMap', free: true, requires_api_key: false }`.
- [`server.py`](../server.py):
  - Retirados `https://maps.googleapis.com` y `https://*.googleapis.com` de `Content-Security-Policy` y añadidos explícitamente `https://*.basemaps.cartocdn.com`, `https://basemaps.cartocdn.com`, `https://*.tile.openstreetmap.org` y `https://tile.openstreetmap.org`.
  - Enriquecido `/api/maps/config` (GET y POST) con `"free": True` y `"requires_api_key": False`.
- [`src/components/NetworkSecurityView.tsx`](../src/components/NetworkSecurityView.tsx):
  - Cambio dinámico automático de teselas claro/oscuro mediante `tileLayerRef.current.setUrl(...)`.
  - Respaldo automático por evento `tileerror` hacia `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
  - Ajuste de tamaño diferido `invalidateSize()` e insignia `OpenStreetMap · Libre sin API` en la cabecera del mapa.
- Versionado y documentación actualizados a `12.1.5` (`v2B.1.5`): `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `static/manual.html`, `docs/index.html`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `README.md` y plugin `recursos-cockpit`.

## 2. Verificaciones Ejecutadas
- `grep -rnI "VITE_GOOGLE_MAPS\|maps_api_key\|maps\.googleapis" .env.example vite.config.ts server.py src/ static/index.html`: **0 coincidencias**.
- Validación XML de `docs/assets/*.svg`: **OK**.
- `npx tsc --noEmit && npx vite build`: **OK (`495 ms`, `static/index.html` regenerado)**.
- `bash packaging/build_deb.sh`: **OK (`dist/recursos-cockpit_12.1.5_amd64.deb`, `3,7 MB`, firmado GPG + `SHA256SUMS.txt`)**.
- `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.1.5_amd64.deb`: **OK (`dpkg -l | grep recursos-cockpit` -> `12.1.5`)**.
- `/usr/bin/recursos-cockpit --test-mode`: **`[OK] Recursos Native Ubuntu HTML5 App v12.1.5 validated successfully.`**.
- Servicio local `:8085` (`systemctl restart system-dashboard.service`):
  - `GET /api/version`: `12.1.5` (`2B.1.5`).
  - `GET /api/maps/config`: `{'success': True, 'engine': 'leaflet', 'provider': 'OpenStreetMap', 'free': True, 'requires_api_key': False}`.
  - CSP verificada: sin `maps.googleapis.com` (`False`), con `basemaps.cartocdn.com` y `tile.openstreetmap.org` (`True`).

