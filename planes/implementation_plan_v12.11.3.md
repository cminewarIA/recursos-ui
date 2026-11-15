# Plan de Implementación v12.11.3 — Consulta Inicial a `/api/version` en `App.tsx`

> **Versión objetivo (`./VERSION`)**: `12.11.3` (`PATCH` sobre `12.11.2`, conforme a Regla 2.4 de `GEMINI.md` por ajuste de carga inicial de versión y estado `updateAvailable` sin rediseño global).

## Cambios Planificados

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `src/utils/version.ts` | Añadir `compareVersions` e `isRemoteVersionHigher` para comparar de forma segura versiones semánticas/alfanuméricas entre `remote_version` y la versión local actual. |
| 2 | `src/App.tsx` | Añadir los estados `versionInfo` y `updateAvailable` (`boolean`); ejecutar petición inicial a `/api/version` al montar la app, actualizar la versión mostrada (`displayVersion`) con la respuesta y activar `updateAvailable` cuando la versión remota sea superior, reflejándolo de forma simétrica en la píldora de versión de la barra superior. |
| 3 | `VERSION` | Incrementar `PATCH` (`12.11.2` → `12.11.3`). |

## Verificación Planificada

1. `npx tsc --noEmit` (`lint_applet`) y `compile_applet` / `npm run build` sin errores.
2. Pruebas unitarias rápidas en Node para `compareVersions` e `isRemoteVersionHigher`.
3. Empaquetado e instalación local `.deb` (`bash packaging/build_deb.sh` + `/usr/bin/recursos-cockpit --test-mode`) verificando `v12.11.3`.
