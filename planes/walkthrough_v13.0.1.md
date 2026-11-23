# Walkthrough v13.0.1 — Saneamiento, Desduplicación y Reordenación de Normas (`GEMINI.md`)

## 1. Cambios Realizados (`PATCH` 13.0.0 → 13.0.1)
- **[GEMINI.md](../GEMINI.md)**: revisado de principio a fin, eliminando todas las redundancias y compactando el documento de 10 secciones (111 líneas) a **8 normas claras y ordenadas por prioridad** (52 líneas) sin perder ningún requisito técnico:
  - Eliminada la muletilla repetitiva `- **Regla obligatoria**:` en todas las secciones.
  - Consolidada en una sola norma (**3. Diseño Visual, Coherencia Funcional y Visualización de Datos**) la identidad *Alethia × Zeus Vision*, paleta, tipografía (`Geist` + `Geist Mono`), paridad visual, escalado fluido, ubicación por dominio, patrones de gráficos de Zeus Vision, narrativa en 3 capas, Gestalt y simplificación cromática/contraste (anteriormente dispersos en 3 apartados distintos).
  - Unificada la excepción de traducciones OTA sin bump de versión (dejando el detalle técnico en **4. Internacionalización** y una referencia breve en **6. Control de Versión**).
  - Agrupada la trazabilidad (`./planes/`) y la sincronización de `./README.md` en **8. Trazabilidad y Documentación**.
- **[README.md](../README.md)**: actualizada la referencia a `./GEMINI.md` evitando números de regla rígidos.
- **[VERSION](../VERSION)**: incrementado a `13.0.1` conforme a la regla de `PATCH` para ajustes de reglas y documentación.

## 2. Verificación Ejecutada
- `npm run build` (`static/index.html` con `__APP_VERSION__ = 13.0.1`), sincronización a `/home/servidor/servicios/dashboard`, reinicio de `system-dashboard.service` (`active`), empaquetado e instalación de `dist/recursos-cockpit_13.0.1_amd64.deb` firmado con GPG, `/usr/bin/recursos-cockpit --test-mode` (`[OK]`) y comprobación HTTP `200` en `/`, `/manual`, `/readme` y `/api/version` (`13.0.1`, `package_needs_install: False`).
