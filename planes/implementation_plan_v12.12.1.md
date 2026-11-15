# Plan de Implementación v12.12.1 — Revisión y Corrección del Actualizador Manual y Automático

## Diagnóstico de Problemas Detectados

1. **`server.py` (Backend Manual & Automático)**:
   - `POST /api/system/update` invocaba `perform_auto_update_and_install(trigger_source="api_request")`, pero las comprobaciones de `git status --porcelain` y `git stash` solo reconocían `trigger_source == "manual"`, impidiendo actualizar manualmente cuando existían cambios locales pendientes.
   - El reinicio diferido de `system-dashboard.service` se decidía buscando cadenas textuales (`"Ya está actualizado"` / `"Already up to date"`) en lugar de comparar `git rev-parse HEAD` antes y después del `git pull` (provocando reinicios innecesarios cuando la copia local estaba por delante).
   - `_LOCAL_GIT_SHA_CACHE` y `METRICS_CACHE["version_info"]` no se invalidaban al finalizar `git pull` o instalar el `.deb`.
   - `auto_install_watcher_worker()` llamaba a `get_version_info(force_refresh=True)` cada 60s consultando `api.github.com/commits`, alcanzando el límite de 60 req/h sin token de GitHub.
   - `get_version_info(allow_auto_trigger=True)` disparaba actualizaciones automáticas incluso cuando `local_clean == False` o cuando el entorno era un servidor sin aplicación de escritorio instalada (`/usr/bin/recursos-cockpit`).
   - `POST /api/system/auto-update` no actualizaba `AUTO_INSTALL_STATE["last_status"]` al pausar ni verificaba estado antes de lanzar trabajo en segundo plano al reactivar.

2. **`desktop_app/recursos_app.py` (App Nativa Ubuntu + Puente HTML5)**:
   - No existía vigilante automático de actualizaciones en segundo plano pese a existir `auto_install_enabled`.
   - `check_github_app_update()` mezclaba la versión de `main/VERSION` con la URL de descarga `releases/latest` (y dependía exclusivamente de `api.github.com`, vulnerable a 403 rate-limit), pudiendo ofrecer una versión de `VERSION` antes de publicarse el `.deb` en Releases.
   - `perform_unified_update()` en el Paso 2 enviaba el bundle web local viejo al servidor cuando `gh_ver > app_ver == srv_ver` en lugar de solicitar `/api/system/update` al servidor.
   - `LocalHtmlBridgeServer` en `POST /api/system/update` devolvía el dict interno de `check_github_app_update()` sin los campos canónicos de `/api/version` (`current_version`, `remote_version`, `ubuntu_native_bridge`, `auto_install_enabled`, `recent_commits`), y nunca relanzaba la app Ubuntu tras instalar un `.deb` nuevo desde la vista HTML5.
   - `POST /api/system/auto-update` hacía proxy al servidor remoto sin sincronizar `conn_mgr.auto_install_enabled` localmente.
   - `_install_deb_from_github()` no usaba `--reinstall` en `apt-get` ni separaba modo silencioso (`sudo -n`) para auto-actualización vs interactivo (`pkexec`) para actualización manual.

3. **`src/components/MoreView.tsx` y `src/App.tsx` (Interfaz React)**:
   - `MoreView.tsx` sobrescribía cada 1.5s el estado rico `versionInfo` (proveniente de `/api/version`) con `metrics.version_info` (resumen del colector), borrando tarjetas puente nativas y `recent_commits`.
   - No existía polling mientras `auto_install_in_progress` era `true` ni expansión automática de logs técnicos cuando la actualización terminaba con avisos/errores.
   - `src/App.tsx` no refrescaba `/api/version` periódicamente ni recibía actualizaciones desde `MoreView`, dejando desactualizada la píldora superior tras actualizar.

## Cambios Planificados
- Corregir flujo manual, caché de commits, guardas del auto-instalador y estado de `auto-update` en `server.py`.
- Añadir vigilante automático no intrusivo, separación de versión `.deb` release vs repo `VERSION`, resolución de fallback sin API rate-limit, sincronización correcta con el servidor, payload `/api/version` unificado y relanzamiento tras `.deb` en `desktop_app/recursos_app.py`.
- Corregir preservación de estado, polling en curso, expansión de errores y sincronización de versión con `App.tsx` en `src/components/MoreView.tsx` y `src/App.tsx`.
- Añadir claves i18n en `./i18n/dictionary.csv`, actualizar `./VERSION` a `12.12.1`, compilar bundle (`npm run build`), verificar `tsc` + `vite`, y generar/probar el paquete `.deb`.
