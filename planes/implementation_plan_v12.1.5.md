# Plan de Implementación — v12.1.5 (`v2B.1.5`): Motor Cartográfico 100 % Libre (OpenStreetMap / Leaflet) sin API Key ni Dependencias de Google Maps

## 1. Diagnóstico
Se detectaron restos de configuración de Google Maps API (`VITE_GOOGLE_MAPS_API_KEY`, `maps_api_key`, resolución DNS a `maps.googleapis.com` y cabecera CSP de Google Maps) en `.env.example`, `vite.config.ts` y `server.py`, provocando avisos de API Key en entornos como Google AI Studio y manteniendo dominios obsoletos en el mapa geoespacial. Asimismo, en `src/components/NetworkSecurityView.tsx` el cambio dinámico entre tema claro/oscuro y el respaldo automático hacia `tile.openstreetmap.org` no se aplicaban tras instanciar Leaflet.

## 2. Cambios Aplicados
1. **`.env.example`**: Retirada de `VITE_GOOGLE_MAPS_API_KEY="YOUR_GOOGLE_MAPS_API_KEY"` y sustitución por nota explicativa del motor libre OpenStreetMap/Leaflet.
2. **`vite.config.ts`**:
   - Sustitución de `maps.googleapis.com` por `tile.openstreetmap.org` en objetivos DNS salientes.
   - Retirada de `mapsApiKey` / `VITE_GOOGLE_MAPS_API_KEY` y del campo `maps_api_key` en el payload de `/api/metrics` (reemplazado por `maps_engine: 'leaflet'`).
   - Nuevo endpoint `/api/maps/config` en modo dev devolviendo `{ success: true, engine: 'leaflet', provider: 'OpenStreetMap', free: true, requires_api_key: false }`.
3. **`server.py`**:
   - Limpieza de `https://maps.googleapis.com` y `https://*.googleapis.com` de la cabecera `Content-Security-Policy` (`default-src`, `script-src`, `connect-src`), añadiendo explícitamente `https://*.basemaps.cartocdn.com` y `https://basemaps.cartocdn.com` junto a OpenStreetMap.
   - Respuesta enriquecida en `/api/maps/config` (GET y POST) con `"free": True` y `"requires_api_key": False`.
4. **`src/components/NetworkSecurityView.tsx`**:
   - Actualización en vivo de la capa de teselas al alternar tema claro/oscuro (`setUrl`).
   - Fallback automático por evento `tileerror` hacia `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
   - Llamada diferida a `invalidateSize()` tras montar Leaflet y etiqueta `OpenStreetMap · Libre sin API` en la cabecera del mapa.
5. **Versionado y Paquete Nativo (`12.1.5` / `v2B.1.5`)**:
   - Sincronización en `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `static/manual.html`, `docs/index.html`, `docs/assets/*.svg`, `README.md` y plugin `recursos-cockpit`.
   - Compilación de SPA (`tsc` + `vite build`), empaquetado `.deb` firmado, instalación local y reinicio del servicio local en `:8085`.

