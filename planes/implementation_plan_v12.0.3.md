# Plan de Implementación v12.0.3 (v2B.0.3) — Corrección `ERESOLVE` en GitHub Actions y Formateo Dinámico `2B.x`

## Diagnóstico del fallo en GitHub Actions
En el paso `npm install` del job `build-packages` (`.github/workflows/build-deb.yml`), `npm` falló con código de salida 1 (`ERESOLVE could not resolve`) debido al conflicto de pares entre:
- `vite@^8.3.0` (`vite@8.3.8`), que declara `peerOptional esbuild@"^0.27.0 || ^0.28.0"`.
- `esbuild@^0.25.0` declarado en `devDependencies` de `package.json`.

Adicionalmente, `server.py` y `vite.config.ts` comparaban únicamente `ver == "12.0.0"` en `get_display_version` / `getDisplayVersion`, lo que habría impedido mostrar `2B.0.3` para `12.0.3`.

## Cambios planificados
1. **`package.json`**: Actualizar `esbuild` en `devDependencies` de `^0.25.0` a `^0.28.0` y sincronizar `"version": "12.0.3"`.
2. **`.github/workflows/build-deb.yml`**: Añadir `--no-audit --no-fund` a `npm install` para agilizar la instalación limpia en runners de GitHub Actions.
3. **`server.py` y `vite.config.ts`**: Generalizar `get_display_version()` / `getDisplayVersion()` con comprobación de prefijo `12.` para formatear dinámicamente cualquier versión `12.x` como `2B.x`.
4. **Sincronización y Empaquetado (`VERSION`, `packaging/debian/control`, `README.md`, `.deb`)**: Incremento `PATCH` a `12.0.3`, actualización de documentación, compilación y firma GPG de `dist/recursos-cockpit_12.0.3_amd64.deb`, instalación local y verificación con `--test-mode`.
