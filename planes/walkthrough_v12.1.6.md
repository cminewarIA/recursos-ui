# Walkthrough — v12.1.6: Eliminación del Formato de Versión `2B`

## 1. Cambios Realizados
- [`server.py`](../server.py#L3717-L3722): Eliminada la regla de conversión `"2B." + ver[3:]` en `get_display_version()`, devolviendo siempre la versión semántica directa (`12.1.6`).
- [`vite.config.ts`](../vite.config.ts#L85-L87): Simplificada `getDisplayVersion()` para retornar `(pkgVer || readAppVersion()).trim()` sin alias `2B`.
- [`src/utils/formatters.ts`](../src/utils/formatters.ts#L73-L77): Eliminado el mapeo `12.` -> `2B.` en `getDisplayVersionString()`.
- [`desktop_app/recursos_app.py`](../desktop_app/recursos_app.py#L121-L122): Eliminada la transformación a `2B.` en `get_display_version()`.
- [`android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt#L90-L93): Simplificada `formatDisplayVersion()` a `"v$raw"`.
- Sincronizada la versión `12.1.6` y eliminadas todas las etiquetas `v2B` en `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html`, `README.md` y `~/.gemini/config/plugins/recursos-cockpit/plugin.json`.

## 2. Verificaciones Ejecutadas
- `grep -rn "2B\.\|v2B"` en código y bundle compilado (`server.py`, `vite.config.ts`, `src/`, `android_app/`, `packaging/`, `static/index.html`, `docs/assets/`): **0 coincidencias** en producción/presentación (solo mención histórica descriptiva del cambio en el changelog de `README.md`, `static/manual.html` y `docs/index.html`, más compatibilidad de parseo en `parse_semver_tuple()` de `desktop_app/recursos_app.py`).
- `python3 -m py_compile server.py desktop_app/recursos_app.py`: **OK**.
- `node --check` sobre el JavaScript embebido en `static/manual.html` y validación XML de `docs/assets/*.svg`: **OK**.
- `npx tsc --noEmit && npx vite build`: **OK (`482 ms`)**.
- `bash packaging/build_deb.sh` y `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.1.6_amd64.deb`: **OK (`dpkg -l` -> `12.1.6`)**.
- `/usr/bin/recursos-cockpit --test-mode`: **`[OK] Recursos Native Ubuntu HTML5 App v12.1.6 validated successfully.`**.
- Servicio local `:8085` (`systemctl restart system-dashboard.service`):
  - `GET /api/version`: `current_version = "12.1.6"`, `display_version = "12.1.6"`.
  - `GET /api/metrics` (`version_info`): `current_version = "12.1.6"`, `display_version = "12.1.6"`.

