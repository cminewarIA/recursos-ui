# Plan de Implementación v12.11.2 — Resolución de Conflicto ERESOLVE (`vite@8.3.8` + `esbuild`) y `--legacy-peer-deps`

> **Versión objetivo (`./VERSION`)**: `12.11.2` (`PATCH` sobre `12.11.1`, conforme a Regla 2.4 de `GEMINI.md` por ajuste de dependencias, flujo CI y documentación sin cambios funcionales de interfaz).

## Diagnóstico

1. `vite@8.3.8` declara `peerOptional esbuild: "^0.27.0 || ^0.28.0"`, incompatible con instalaciones que resuelvan versiones anteriores de `esbuild` (`0.25.x`) o conflictos estrictos de dependencias `peer` en `npm`.
2. El flujo de CI (`.github/workflows/build-deb.yml`) y las instrucciones de despliegue (`README.md`) ejecutaban `npm install` sin `--legacy-peer-deps` y sin un archivo `.npmrc` raíz que garantice una resolución homogénea en cualquier entorno.

## Cambios Planificados

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `package.json` | Fijar rangos compatibles exactos `"vite": "^8.3.8"` y `"esbuild": "^0.28.2"` manteniendo `"version": "0.0.0"` como marcador neutro según Regla 2 de `GEMINI.md`. |
| 2 | `.npmrc` | Crear configuración raíz con `legacy-peer-deps=true` para asegurar `--legacy-peer-deps` por defecto en instalaciones locales y automáticas. |
| 3 | `.github/workflows/build-deb.yml` | Añadir explícitamente `--legacy-peer-deps` al paso `npm install --legacy-peer-deps --no-audit --no-fund`. |
| 4 | `README.md` | Actualizar el comando de compilación de la Opción B a `npm install --legacy-peer-deps && npm run build`. |
| 5 | `VERSION` | Incrementar `PATCH` (`12.11.1` → `12.11.2`). |

## Verificación Planificada

1. Prueba limpia en directorio temporal aislado con `package.json` y `.npmrc` ejecutando `npm install --legacy-peer-deps --no-audit --no-fund --dry-run`.
2. Ejecución de `npm install --legacy-peer-deps --no-audit --no-fund` y `npm run build` en el repositorio.
3. Compilación estática TypeScript (`lint_applet`) y compilación de applet (`compile_applet`).
4. Validación Python (`py_compile`) y empaquetado local `.deb` (`bash packaging/build_deb.sh` + instalación local + `/usr/bin/recursos-cockpit --test-mode`).
