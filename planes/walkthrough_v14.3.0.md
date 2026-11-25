# Walkthrough de Verificación v14.3.0

## Resumen de Cambios Verificados
1. **Motor de Temas Independientes OTA (`./themes/themes.json`, `./themes/alethia-matrix.json`, `themes_catalog.py`)**:
   - Cada tema reside en su propio archivo JSON declarativo con paletas completas para modo claro y oscuro, niveles de translucidez/blur y configuración opcional de fondo animado.
   - Sincronización OTA directa desde GitHub (`GET /api/themes`, `POST /api/themes/sync`, `GET /api/themes/<id>.json`, `GET /themes/*`) implementada en `server.py`, `vite.config.ts` y `desktop_app/recursos_app.py`, con caché local fuera de Git (`~/.cache/recursos-cockpit/themes/`) y saneamiento estricto de claves y valores CSS contra inyección y traversal.
2. **Tema «Alethia Matrix» con Lluvia de Telemetría Real (`MatrixTelemetryBackdrop.tsx`)**:
   - Sustituye el fondo estático por columnas descendentes en `<canvas>` HiDPI alimentadas exclusivamente con métricas reales en vivo del servidor (`CPU %`, `°C`, `CLK GHz`, `RAPL W`, `LOAD`, `RAM`, `WAN/LAN`, `IO`, `GPU`, `HOST`, `PID`).
   - Se adapta automáticamente a modo claro y modo oscuro manteniendo la misma estética, pausa automáticamente en segundo plano (`document.hidden` / `__RECURSOS_PAUSED__`) y respeta `prefers-reduced-motion: reduce`.
3. **Superficies Translúcidas Universales (`src/index.css`)**:
   - `.cockpit-topbar`, `.cockpit-hero`, `.cockpit-bento`, `.cockpit-subtile`, `.cockpit-segmented` y `.cockpit-dock` consumen los tokens semánticos translúcidos del tema activo con `backdrop-filter: blur(var(--surface-blur))` tanto en modo claro como en modo oscuro.
4. **Sección «Sistema» y Subpestaña «Temas» (`/sistema/temas`)**:
   - Pestaña `nav.mas` renombrada a **Sistema** en los 31 idiomas de `./i18n/dictionary.csv` (1086 filas × 33 columnas, 0 errores).
   - Rutas canónicas `/sistema/*` (`/sistema/temas`, `/sistema/actualizaciones`, `/sistema/dispositivos`, `/sistema/manual`, `/sistema/dex`) con compatibilidad retroactiva total para `/mas/*` y `/temas`.
   - Vista **Temas** dentro de **Sistema** con tarjetas de vista previa dual (claro/oscuro translúcido), aplicación inmediata y botón de sincronización OTA desde GitHub.

## Comprobaciones Ejecutadas
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **0 errores**.
- `python3 -m py_compile themes_catalog.py server.py desktop_app/recursos_app.py i18n_catalog.py`: **OK**.
- Pruebas unitarias y de seguridad en `themes_catalog.py` (carga de manifiesto, rechazo de path traversal y rechazo de inyección CSS): **THEMES_CATALOG_AND_SECURITY_TEST_OK**.
- Integridad de `./i18n/dictionary.csv`: **1086 filas × 33 columnas (31 idiomas), 0 errores**.
- `npm run build` + `bash packaging/build_deb.sh` + `compile_applet` + `lint_applet`: **OK**.
