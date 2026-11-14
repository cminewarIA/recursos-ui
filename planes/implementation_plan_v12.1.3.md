# Plan de Implementación — `v12.1.3` (`v2B.1.3`): Nuevo `README.md` Visual e Interactivo con Suite SVG

**Fecha:** 2026-11-14  
**Incremento SemVer:** `PATCH` (`12.1.2` -> `12.1.3`, display `v2B.1.3`) conforme a la Regla 3.4 de `GEMINI.md`  
**Objetivo:** Transformar `README.md` en un manual visual e interactivo completo con diagramas SVG animados, paneles Bento, guías desplegables paso a paso por pantalla y explorador REST interactivo.

---

## Cambios Planificados
1. **Suite de 5 Gráficos Vectoriales SVG en `docs/assets/`**:
   - `hero-banner.svg`, `cockpit-ui-preview.svg`, `architecture-flow.svg`, `network-mesh-radar.svg`, `native-apps-bridge.svg` con soporte automático Claro/Oscuro (`@media (prefers-color-scheme: dark)`), animaciones SVG/CSS suaves y cero valores fijos privados (`Zero-Hardcoding`).
   - Validación sintáctica XML de todos los `.svg` con `xml.etree.ElementTree`.
2. **Reescritura Visual e Interactiva de `README.md`**:
   - Estructurado en 7 capítulos tipo manual de usuario con paneles Bento HTML, desplegables `<details>`/`<summary>` por vista (`/inicio`, `/equipo`, `/red`, `/programas`, `/mas`), optimización de caché `~17 ms` (`xychart-beta`), flujo Zero-Trust (`stateDiagram-v2` + `sequenceDiagram`), explorador de endpoints REST con comandos `curl` + JSON reales y guías de despliegue genéricas.
3. **Sincronización Canónica y Paquete `.deb` (`Reglas 3, 4, 5 y 6`) — Sin `git push`**:
   - Actualizar `VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `static/manual.html`, `docs/index.html` y `plugin.json` a `12.1.3` (`v2B.1.3`).
   - Compilar frontend (`tsc --noEmit && vite build`), compilar/firmar/instalar `dist/recursos-cockpit_12.1.3_amd64.deb` y verificar con `/usr/bin/recursos-cockpit --test-mode` y `dpkg -l`.

