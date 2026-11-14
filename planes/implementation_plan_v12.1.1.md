# Plan de Implementación — `v12.1.1` (`v2B.1.1`): Creación de un `README.md` Completamente Nuevo desde Cero

**Fecha:** 2026-11-14  
**Incremento SemVer:** `PATCH` (`12.1.0` -> `12.1.1`, display `v2B.1.1`) conforme a la Regla 3.4 de `GEMINI.md`  
**Motivo:** El archivo `README.md` anterior superaba los `135 KB` por arrastrar un historial heredado kilométrico desde `v4.0.0` y rutas locales codificadas. Se reemplaza íntegramente por un documento nuevo desde cero (`README.md`), limpio, visual y 100% *Zero-Hardcoding*.

---

## Cambios Planificados
1. **Sincronización Canónica (`Regla 3`)**:
   - Actualizar `VERSION`, `package.json`, `packaging/debian/control` y fallbacks de `src/App.tsx` y `src/components/MoreView.tsx` a `12.1.1` / `v2B.1.1`.
   - Actualizar referencias en `static/manual.html` (y copia idéntica en `docs/index.html`) e incorporar `v12.1.1 (v2B.1.1)` al `CHANGELOG` interactivo.
2. **Compilación Frontend React 19**:
   - Ejecutar `tsc --noEmit` y `vite build` para regenerar `static/index.html`.
3. **Reescritura Total de `README.md` (`Regla 2` y `Regla 5`)**:
   - Estructura en 9 bloques visuales limpios con 3 diagramas Mermaid (`flowchart TB`, `flowchart LR`, `sequenceDiagram`), matriz comparativa Web/Ubuntu/Android, tabla de vistas y endpoints REST, enlaces oficiales `12.1.1`, guía de despliegue genérica sin rutas privadas y tabla SemVer concisa.
4. **Empaquetado, Instalación Local y Despliegue (`Reglas 4, 6 y 9`)**:
   - Guardar `planes/implementation_plan_v12.1.1.md` y `planes/walkthrough_v12.1.1.md`.
   - Compilar e instalar `dist/recursos-cockpit_12.1.1_amd64.deb`, verificar con `/usr/bin/recursos-cockpit --test-mode` y `dpkg -l`.
   - Commit semántico, etiqueta `v12.1.1`, `git push origin main --tags`, despliegue en `/home/servidor/servicios/dashboard` y comprobación HTTP en vivo (`8085`).

