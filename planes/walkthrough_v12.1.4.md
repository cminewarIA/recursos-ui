# Walkthrough de Implementación y Verificación — `v12.1.4` (`v2B.1.4`)

**Fecha:** 2026-11-14  
**Tipo de cambio:** `PATCH` (`12.1.3` -> `12.1.4`, display `v2B.1.4`) conforme a la Regla 2.4 de `GEMINI.md`  
**Objetivo:** Eliminar la regla de ejecución automática de `git pull` al iniciar cualquier tarea tanto en [`GEMINI.md`](../GEMINI.md) como en la skill del plugin `cockpit-release`.

---

## 1. Resumen de Cambios

- **[`GEMINI.md`](../GEMINI.md)**: Suprimida por completo la antigua sección `## 1. Sincronización Previa Obligatoria (git pull)` y renumeradas las reglas restantes del `1` al `7`. A partir de ahora no se ejecuta ni `git pull` automático al inicio ni `git push` automático al finalizar.
- **Plugin IDE `recursos-cockpit`**:
  - [`SKILL.md`](file:///home/servidor/.gemini/config/plugins/recursos-cockpit/skills/cockpit-release/SKILL.md): actualizada la sección 1 para prohibir `git pull` automático al empezar una tarea salvo solicitud expresa.
  - [`plugin.json`](file:///home/servidor/.gemini/config/plugins/recursos-cockpit/plugin.json): sincronizado `"version": "12.1.4"`.
- **Sincronización Canónica (`12.1.4` / `v2B.1.4`)**:
  - Actualizados [`VERSION`](../VERSION), [`package.json`](../package.json), [`packaging/debian/control`](../packaging/debian/control), [`src/App.tsx`](../src/App.tsx), [`src/components/MoreView.tsx`](../src/components/MoreView.tsx), [`docs/assets/hero-banner.svg`](../docs/assets/hero-banner.svg), [`docs/assets/cockpit-ui-preview.svg`](../docs/assets/cockpit-ui-preview.svg), [`static/manual.html`](../static/manual.html), [`docs/index.html`](../docs/index.html) y [`README.md`](../README.md).
  - Guardados [`planes/implementation_plan_v12.1.4.md`](./implementation_plan_v12.1.4.md) y [`planes/walkthrough_v12.1.4.md`](./walkthrough_v12.1.4.md).

---

## 2. Verificaciones Ejecutadas (Sin `git pull` ni `git push`)

| Prueba / Comando | Resultado Observado | Estado |
| :--- | :--- | :--- |
| Validación XML de `docs/assets/*.svg` (`xml.etree.ElementTree`) | `SVG_OK` (los 5 SVG bien formados) | Superado |
| Validación JS de `static/manual.html` (`node --check`) | Código de salida `0` | Superado |
| Paridad `sha256sum static/manual.html docs/index.html` | `6f5397a1b49c4b913a2188befbeb02f571b5ed94e5b7c327b86d8760f5ef6a39` | Superado |
| Frontend (`tsc --noEmit && vite build`) | `0` errores; `1669` módulos en `485ms` | Superado |
| Empaquetado y firma (`bash packaging/build_deb.sh`) | Generados `dist/recursos-cockpit_12.1.4_amd64.deb`, `dist/SHA256SUMS.txt` y firma GPG `4CFC86D58E9146AE` | Superado |
| Test nativo (`/usr/bin/recursos-cockpit --test-mode`) | `[OK] Recursos Native Ubuntu HTML5 App v12.1.4 validated successfully.` (`Bridge Port Test: 40625`) | Superado |
| Registro APT local (`dpkg -l \| grep recursos-cockpit`) | `ii  recursos-cockpit  12.1.4  amd64  Recursos Cockpit (v2B.1.4) - Panel Unificado y Control DeX` | Superado |
| Sincronización Git automática (`git pull` / `git push`) | Omitidas intencionadamente conforme a `GEMINI.md` | Correcto |

