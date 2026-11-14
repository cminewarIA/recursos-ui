# Plan de Implementación — `v12.1.4` (`v2B.1.4`): Eliminación de `git pull` Automático al Inicio en `GEMINI.md`

**Fecha:** 2026-11-14  
**Incremento SemVer:** `PATCH` (`12.1.3` -> `12.1.4`, display `v2B.1.4`) conforme a la Regla 2.4 de `GEMINI.md`  
**Motivo:** Suprimir la obligación de ejecutar `git pull origin main` automáticamente antes de iniciar cualquier modificación, manteniendo sincronizado tanto [`GEMINI.md`](../GEMINI.md) como el plugin local `cockpit-release`.

---

## Cambios Planificados
1. **[`GEMINI.md`](../GEMINI.md)**: Eliminar la antigua sección `## 1. Sincronización Previa Obligatoria (git pull)` y renumerar las reglas restantes del `1` al `7`.
2. **Plugin IDE (`recursos-cockpit`)**: Actualizar `SKILL.md` para prohibir `git pull` automático al inicio salvo petición expresa, y sincronizar `plugin.json` a `12.1.4`.
3. **Sincronización Canónica (`12.1.4` / `v2B.1.4`) y Paquete `.deb` (`sin git pull` ni `git push`)**:
   - Actualizar `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html` y `README.md`.
   - Validar SVG/JS, compilar frontend (`tsc --noEmit && vite build`), compilar/firmar/instalar `dist/recursos-cockpit_12.1.4_amd64.deb` y verificar con `/usr/bin/recursos-cockpit --test-mode` y `dpkg -l`.

