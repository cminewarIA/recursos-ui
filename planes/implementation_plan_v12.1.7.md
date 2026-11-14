# Plan de Implementación — v12.1.7: Simplificación de `README.md` sin Listado de Versiones Anteriores

## 1. Objetivo
Omitir en [`README.md`](../README.md) la enumeración histórica de versiones anteriores salvo para comunicar diferencias relevantes frente a arquitecturas previas, y actualizar dicha regla en [`GEMINI.md`](../GEMINI.md) y en la skill `cockpit-release`.

## 2. Cambios Aplicados
1. **`README.md`**:
   - Actualizada la versión activa a `12.1.7` (`v12.1.7`) en cabecera, badge, índice, muestras JSON y descargas `.deb`/`.apk`.
   - Reemplazado el bloque histórico SemVer por una tabla comparativa por ámbitos (*Arquitectura Anterior* vs *Versión Actual `v12.1.7`*) centrada únicamente en las diferencias arquitectónicas y funcionales.
2. **`GEMINI.md` y Skill `cockpit-release`**:
   - Regla 4 de `GEMINI.md` y paso 1.2 de `cockpit-release/SKILL.md` actualizados para reflejar que `README.md` solo muestra la versión vigente y las diferencias clave frente a arquitecturas anteriores.
3. **Sincronización Canónica (`12.1.7`)**:
   - Actualizados `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `src/utils/formatters.ts`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html` y `~/.gemini/config/plugins/recursos-cockpit/plugin.json`.
   - Compilación React 19, empaquetado `.deb`, instalación local, pruebas `--test-mode` y reinicio de `system-dashboard.service` en `:8085`.

