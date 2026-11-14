# Walkthrough de Implementación y Verificación — `v12.1.2` (`v2B.1.2`)

**Fecha:** 2026-11-14  
**Tipo de cambio:** `PATCH` (`12.1.1` -> `12.1.2`, display `v2B.1.2`) conforme a la Regla 3.4 de `GEMINI.md`  
**Objetivo:** Eliminar de [`GEMINI.md`](../GEMINI.md) la regla obligatoria de publicación automática en GitHub (`git push`) y reflejar esa misma directriz en el plugin del IDE (`cockpit-release`).

---

## 1. Resumen de Cambios

- **[`GEMINI.md`](../GEMINI.md)**: Eliminada por completo la sección `## 9. Publicación Automática en GitHub (git push)`. A partir de ahora no se ejecuta `git push` de forma automática tras los cambios.
- **Plugin IDE `recursos-cockpit`**:
  - [`SKILL.md`](file:///home/servidor/.gemini/config/plugins/recursos-cockpit/skills/cockpit-release/SKILL.md): reemplazada la sección 5 para prohibir `git push` automático salvo solicitud expresa del usuario.
  - [`plugin.json`](file:///home/servidor/.gemini/config/plugins/recursos-cockpit/plugin.json): versión sincronizada a `12.1.2`.
- **Sincronización Canónica (`Reglas 3, 4, 5 y 6`)**:
  - [`VERSION`](../VERSION), [`package.json`](../package.json), [`packaging/debian/control`](../packaging/debian/control), [`src/App.tsx`](../src/App.tsx), [`src/components/MoreView.tsx`](../src/components/MoreView.tsx), [`static/manual.html`](../static/manual.html), [`docs/index.html`](../docs/index.html) y [`README.md`](../README.md) actualizados a `12.1.2` (`v2B.1.2`).
  - [`static/index.html`](../static/index.html) compilado con Vite.
  - Guardados [`planes/implementation_plan_v12.1.2.md`](./implementation_plan_v12.1.2.md) y [`planes/walkthrough_v12.1.2.md`](./walkthrough_v12.1.2.md).

---

## 2. Verificaciones Ejecutadas (Sin `git push`)

| Prueba / Comando | Resultado Observado | Estado |
| :--- | :--- | :--- |
| Validación JS de `static/manual.html` (`node --check`) | Código de salida `0` | Superado |
| Paridad `sha256sum static/manual.html docs/index.html` | `443e13166956f06dda4a2d2bc2b6429f1fdaf2083beb4131533747732063f839` | Superado |
| Frontend (`tsc --noEmit && vite build`) | `0` errores; `1669` módulos en `519ms` | Superado |
| Empaquetado y firma (`bash packaging/build_deb.sh`) | Generados `dist/recursos-cockpit_12.1.2_amd64.deb`, `dist/SHA256SUMS.txt` y firma GPG `4CFC86D58E9146AE` | Superado |
| Test nativo (`/usr/bin/recursos-cockpit --test-mode`) | `[OK] Recursos Native Ubuntu HTML5 App v12.1.2 validated successfully.` (`Bridge Port Test: 37159`) | Superado |
| Registro APT local (`dpkg -l \| grep recursos-cockpit`) | `ii  recursos-cockpit  12.1.2  amd64  Recursos Cockpit (v2B.1.2) - Panel Unificado y Control DeX` | Superado |
| Publicación remota (`git push`) | Omitida intencionadamente conforme a la nueva norma | Correcto |

