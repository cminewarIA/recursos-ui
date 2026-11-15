# Recorrido de Verificación — Recursos Cockpit v12.11.3

> **Versión canónica (`./VERSION`)**: `12.11.3` (`PATCH` sobre `12.11.2`)

## 1. Cambios Aplicados

1. **Comparación de versiones (`src/utils/version.ts`)**:
   - Se añadieron `compareVersions(a, b)` e `isRemoteVersionHigher(versionInfo, currentOverride?)` para comparar segmentos numéricos/alfanuméricos entre `remote_version` / `github_version` y la versión local vigente.
2. **Consulta inicial a `/api/version` y estado `updateAvailable` (`src/App.tsx`)**:
   - Se añadieron los estados `versionInfo` (`VersionInfo | null`) y `updateAvailable` (`boolean`).
   - Al montar `App`, un `useEffect` consulta `/api/version` mediante `apiFetchJson<VersionInfo>('/api/version')`, guarda el resultado en `versionInfo` para actualizar `displayVersion` (`getCanonicalDisplayVersion(versionInfo ?? metrics?.version_info)`) y actualiza `updateAvailable` mediante `isRemoteVersionHigher(res.data)`.
   - Cuando `updateAvailable` es `true`, la píldora de versión en la barra superior cambia de `cockpit-pill-cyan` a `cockpit-pill-emerald` con punto indicador y tooltip accesible (`more.new_version_available`).
3. **Versión canónica (`./VERSION`)**:
   - Incrementada de `12.11.2` a `12.11.3`.

## 2. Verificación Ejecutada

| Comprobación | Resultado |
|---|---|
| Pruebas unitarias `tsx` de `compareVersions` e `isRemoteVersionHigher` | `VERSION_HELPERS_OK` (7 aserciones superadas) |
| `npm run build` (`vite v8.3.8`) + `compile_applet` | Correcto (`1.16s`), genera `static/index.html` |
| `lint_applet` (`tsc --noEmit`) | Correcto (0 errores) |
| `bash packaging/build_deb.sh` + `dpkg --force-depends -i` + `/usr/bin/recursos-cockpit --test-mode` | `.deb` `v12.11.3` generado y firmado con GPG (`E475D0B94EA06397`), `dpkg -l` coincide (`12.11.3`), `--test-mode` OK (`[OK] Recursos Native Ubuntu HTML5 App v12.11.3 validated successfully.`) |
| Compilación APK Android (`packaging/build_apk.sh` / `install_all.sh`) | No ejecutada en este contenedor (sin Android SDK ni dispositivo ADB conectado) |
