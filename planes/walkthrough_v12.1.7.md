# Walkthrough — v12.1.7: Simplificación de `README.md` sin Listado de Versiones Anteriores

## 1. Cambios Realizados
- [`README.md`](../README.md):
  - Eliminada la tabla histórica de versiones anteriores (`SemVer`) del Capítulo 7.
  - Sustituida por una tabla comparativa enfocada únicamente en diferencias clave (*Arquitectura Anterior* vs *Versión Actual `v12.1.7`*) por ámbito (`Interfaz y Renderizado`, `Mapa Geoespacial GeoIP`, `Telemetría y Permisos Linux`, `Seguridad de Credenciales`, `Documentación y Manual`).
  - Actualizada la versión activa a `12.1.7` (`v12.1.7`) en cabecera, badge, índice, ejemplos REST y enlaces de descarga.
- [`GEMINI.md`](../GEMINI.md) (Regla 4) y [`cockpit-release/SKILL.md`](file:///home/servidor/.gemini/config/plugins/recursos-cockpit/skills/cockpit-release/SKILL.md):
  - Reflejada la norma de sincronizar `./README.md` con la versión activa y evitar listar versiones anteriores salvo para comunicar diferencias relevantes.
- Sincronización `12.1.7`: `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `src/utils/formatters.ts`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html` y `~/.gemini/config/plugins/recursos-cockpit/plugin.json`.

## 2. Verificaciones Ejecutadas
- `grep -rn "12\.1\.[0-6]\|12\.0\." README.md`: **0 coincidencias**.
- `grep -rnE "\bv[0-9]+\.[0-9]+" README.md`: únicamente `v12.1.7`.
- Validación XML en `docs/assets/*.svg` y `node --check` sobre el JavaScript de `static/manual.html`: **OK**.
- `npx tsc --noEmit && npx vite build`: **OK (`455 ms`)**.
- `bash packaging/build_deb.sh` y `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.1.7_amd64.deb`: **OK (`dpkg -l` → `12.1.7`)**.
- `/usr/bin/recursos-cockpit --test-mode`: **`[OK] Recursos Native Ubuntu HTML5 App v12.1.7 validated successfully.`**.
- Servicio local `:8085` (`systemctl restart system-dashboard.service`): `GET /api/version` y `GET /api/metrics` devuelven `"current_version": "12.1.7"` y `"display_version": "12.1.7"`, y `/manual` responde `HTTP 200`.

