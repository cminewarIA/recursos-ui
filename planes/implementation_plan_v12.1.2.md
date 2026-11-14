# Plan de Implementación — `v12.1.2` (`v2B.1.2`): Eliminación de la Regla de Auto-Publicación en GitHub

**Fecha:** 2026-11-14  
**Incremento SemVer:** `PATCH` (`12.1.1` -> `12.1.2`, display `v2B.1.2`) conforme a la Regla 3.4 de `GEMINI.md`  
**Motivo:** Retirar la obligación de ejecutar `git push origin main --tags` automáticamente al finalizar cualquier cambio.

---

## Cambios Planificados
1. **`GEMINI.md`**: Eliminar la sección `## 9. Publicación Automática en GitHub (git push)`.
2. **Plugin IDE (`~/.gemini/config/plugins/recursos-cockpit/`)**: Actualizar `skills/cockpit-release/SKILL.md` para suprimir el push automático en GitHub y sincronizar `version` en `plugin.json` a `12.1.2`.
3. **Sincronización Canónica (`Reglas 3, 4, 5 y 6`)**:
   - Actualizar `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `static/manual.html`, `docs/index.html` y `README.md` a `12.1.2` (`v2B.1.2`).
   - Recompilar `static/index.html` (`tsc --noEmit && vite build`).
   - Compilar, firmar GPG e instalar localmente `dist/recursos-cockpit_12.1.2_amd64.deb`, verificando `--test-mode` y `dpkg -l`.
   - **Sin `git push`** automático.

