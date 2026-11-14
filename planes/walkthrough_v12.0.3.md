# Walkthrough y Verificación v12.0.3 (v2B.0.3)

## Resumen de correcciones
- **`package.json`**: Actualizado `esbuild` a `^0.28.0` para cumplir `peerOptional esbuild@"^0.27.0 || ^0.28.0"` requerido por `vite@8.3.8` y resolver el error `npm error code ERESOLVE` en GitHub Actions.
- **`.github/workflows/build-deb.yml`**: Configurado `npm install --no-audit --no-fund` en la compilación web de CI.
- **`server.py` y `vite.config.ts`**: Actualizados `get_display_version()` y `getDisplayVersion()` para mapear cualquier versión `12.x` a `2B.x`.
- **Sincronización canónica**: Actualizados `VERSION`, `package.json`, `packaging/debian/control`, `README.md` y `planes/` a `12.0.3` (`v2B.0.3`).

## Verificaciones realizadas
1. Prueba de resolución limpia (`npm install --dry-run`) en directorio temporal con `esbuild@^0.28.0`: resolución exitosa de 264 paquetes sin conflictos `ERESOLVE`.
2. Sincronización de `node_modules` locales, compilación de producción (`npm run build`), verificación AST Python (`py_compile`) y validación TypeScript (`compile_applet` + `lint_applet`).
3. Empaquetado y firma GPG (`bash packaging/build_deb.sh`), comprobación de miembro `_gpgorigin` y `gpg --verify`, instalación local sobre `12.0.2` (`dpkg -l`) y validación `/usr/bin/recursos-cockpit --test-mode`.
