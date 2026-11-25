# Plan de Implementación v14.3.0 — Motor de Temas OTA, Alethia Matrix y Sección Sistema

## Objetivo
Sustituir el fondo estático por un motor de temas visuales declarativos almacenados en archivos JSON independientes (`./themes/themes.json` + `./themes/<id>.json`) con sincronización OTA desde GitHub sin recompilar ni actualizar la aplicación, estrenando **Alethia Matrix** con lluvia de terminal alimentada por métricas reales del servidor en tiempo real, superficies translúcidas consistentes en modo claro y oscuro, y la evolución del apartado **Más** hacia **Sistema** con la nueva vista independiente **Temas** (`/sistema/temas`).

## Cambios de Arquitectura
1. **Catálogo OTA de Temas (`./themes/`, `themes_catalog.py`)**:
   - Manifiesto `./themes/themes.json` + archivo independiente `./themes/alethia-matrix.json`.
   - Módulo `themes_catalog.py` (espejo de `i18n_catalog.py`) con caché local fuera de Git, soporte `ETag`/`If-None-Match`, saneamiento estricto de tokens CSS y validación de IDs.
   - Endpoints `GET /api/themes`, `GET /api/themes/<id>.json`, `GET /themes/*` y `POST /api/themes/sync` en `server.py`, `vite.config.ts` y `desktop_app/recursos_app.py`.
2. **Motor de Renderizado Frontend (`src/themes/`, `MatrixTelemetryBackdrop.tsx`, `src/index.css`)**:
   - `ThemeCatalogProvider` inyecta dinámicamente las variables CSS del tema activo para modo claro y oscuro, persiste `recursos_theme_id` + `recursos_theme`, y sincroniza con los puentes nativos Ubuntu/Android.
   - `MatrixTelemetryBackdrop` renderiza en `<canvas>` HiDPI columnas descendentes con telemetría real viva del servidor (`CPU`, `°C`, `RAM`, `LOAD`, `WAN/LAN`, `IO`, `GPU`, `PID`), pausado automático en segundo plano y soporte `prefers-reduced-motion`.
   - Superficies `.cockpit-topbar`, `.cockpit-hero`, `.cockpit-bento`, `.cockpit-subtile`, `.cockpit-segmented` y `.cockpit-dock` pasan a ser translúcidas (`rgba(...)` + `backdrop-filter: blur(...)`) en modo claro y oscuro en todos los temas.
3. **Renombrado a «Sistema» y Subpestaña «Temas»**:
   - `nav.mas` actualizado a **Sistema** en los 31 idiomas de `./i18n/dictionary.csv` junto con 18 nuevas claves para el gestor de temas.
   - Rutas canónicas `/sistema/*` (`/sistema/temas`, `/sistema/actualizaciones`, `/sistema/dispositivos`, `/sistema/manual`, `/sistema/dex`) manteniendo compatibilidad total con `/mas/*` y `/temas`.
   - Empaquetado automático de `themes_catalog.py` y `./themes/*.json` en `packaging/build_deb.sh`.
