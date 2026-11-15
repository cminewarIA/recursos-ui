# Recorrido de Verificación — Recursos Cockpit v12.11.2

> **Versión canónica (`./VERSION`)**: `12.11.2` (`PATCH` sobre `12.11.1`)

## 1. Cambios Aplicados

1. **Resolución de conflicto `ERESOLVE` entre `vite@8.3.8` y `esbuild`** (`package.json`):
   - Se actualizaron las especificaciones de dependencias en `package.json` a rangos compatibles con la versión vigente de Vite 8: `"vite": "^8.3.8"` (que requiere `peerOptional esbuild: "^0.27.0 || ^0.28.0"`) y `"esbuild": "^0.28.2"`.
   - Se conservó `"version": "0.0.0"` como marcador neutro según la Regla 2 de `./GEMINI.md`.
2. **Activación consistente de `--legacy-peer-deps`** (`.npmrc`, `.github/workflows/build-deb.yml`, `README.md`):
   - Se creó `/.npmrc` con `legacy-peer-deps=true` para garantizar una resolución sin conflictos `ERESOLVE` en cualquier `npm install` local o automatizado.
   - Se actualizó `.github/workflows/build-deb.yml` a `npm install --legacy-peer-deps --no-audit --no-fund`.
   - Se actualizó el comando de despliegue en `README.md` a `npm install --legacy-peer-deps && npm run build`.
3. **Sincronización de versión canónica (`./VERSION`)**:
   - Se incrementó `PATCH` de `12.11.1` a `12.11.2` en `./VERSION`.

## 2. Verificación Ejecutada

| Comprobación | Resultado |
|---|---|
| `npm install --legacy-peer-deps --no-audit --no-fund --dry-run` (directorio temporal limpio con `package.json` y `.npmrc`) | Correcto (`added 264 packages`, sin errores `ERESOLVE`) |
| `npm install --legacy-peer-deps --no-audit --no-fund` (en raíz del proyecto) | Correcto (`up to date`, `vite@8.3.8` + `esbuild@0.28.2`) |
| `npm run build` (`vite v8.3.8`) | Correcto (`built in 1.18s`), genera `static/index.html` |
| `python3 -W error::SyntaxWarning -m py_compile` (`server.py`, `i18n_catalog.py`, `recursos_app.py`, `dex_controller.py`, `sign_deb.py`) | Correcto (0 errores ni advertencias) |
| `bash packaging/build_deb.sh` + instalación local + `/usr/bin/recursos-cockpit --test-mode` | `.deb` v`12.11.2` generado y firmado con GPG (`E475D0B94EA06397`), `dpkg -l` coincide (`12.11.2`), `--test-mode` OK (`[OK] Recursos Native Ubuntu HTML5 App v12.11.2 validated successfully.`) |
| Compilación APK Android (`packaging/build_apk.sh` / `install_all.sh`) | No ejecutada en este contenedor (sin Android SDK ni dispositivo ADB conectado) |
