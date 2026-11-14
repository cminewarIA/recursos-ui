# Walkthrough de Verificación · Recursos Cockpit `v12.4.0`

## 1. Resumen de Implementación
Se ha completado la actualización **MINOR** `v12.4.0` dotando a la aplicación nativa de **Ubuntu Linux** y al backend de **detección triple simultánea de versiones** (**App Ubuntu**, **Servidor web local**, **GitHub**) y de un **único botón unificado de actualización** capaz de:
- Actualizar el paquete `.deb` desde GitHub Releases si GitHub supera a la App Ubuntu.
- Actualizar la **web local del servidor en caliente** mediante [`POST /api/system/sync-web`](../server.py) verificado por SHA-256 si la App Ubuntu y/o GitHub superan al servidor (incluido el caso en que la App Ubuntu esté por encima de GitHub), sin sobrescribir [`recursos_history.db`](../server.py) ni requerir `.git` en el nodo.
- Evitar cualquier downgrade automático cuando la versión instalada localmente es superior a GitHub.

## 2. Archivos Modificados y Verificados
- [`VERSION`](../VERSION), [`package.json`](../package.json), [`packaging/debian/control`](../packaging/debian/control), `/home/servidor/.gemini/config/plugins/recursos-cockpit/plugin.json`: sincronizados a `12.4.0`.
- [`packaging/build_deb.sh`](../packaging/build_deb.sh): inclusión de `package.json` dentro de `/usr/lib/recursos-cockpit/package.json`.
- [`server.py`](../server.py):
  - `_parse_semver_tuple()` y protección anti-downgrade en `ensure_local_deb_built_and_installed()`, `auto_install_watcher_worker()` y `get_version_info()`.
  - Limpieza de duplicados y endpoint `POST /api/system/sync-web` con lista blanca `ALLOWED_WEB_SYNC_FILES`, rechazo `409` en downgrade, verificación criptográfica `SHA-256` (`400` si falla), escritura atómica (`.sync_tmp` + `os.replace`) e invalidación inmediata de caché.
- [`desktop_app/recursos_app.py`](../desktop_app/recursos_app.py):
  - `resolve_bundled_root()`, `ServerConnectionManager._resolve_target_server_url()`, `probe_server_version_info()`, `collect_local_web_bundle()`, `sync_web_bundle_to_server()`, `_compute_version_comparison()`, `check_github_app_update()`, `_install_deb_from_github()`, `perform_unified_update()` y `update_installed_app_from_github()`.
  - `BridgeHandler`: timeout `60.0s` en `/api/system/*`, enriquecimiento triple en `/api/metrics` y `/api/version`, e interceptación de `POST /api/system/update` (`/api/update`) con ejecución unificada.
  - `RecursosNativeWindow`: Tarjeta 2 unificada sobre el único botón `btn_opt2_update`.
- [`src/types/telemetry.ts`](../src/types/telemetry.ts), [`src/components/MoreView.tsx`](../src/components/MoreView.tsx), [`src/App.tsx`](../src/App.tsx), [`src/utils/formatters.ts`](../src/utils/formatters.ts), [`vite.config.ts`](../vite.config.ts): cápsulas de estado (**App Ubuntu**, **Servidor web local**, **GitHub oficial**), botón único dinámico y recarga suave cuando `web_synced` es verdadero.
- [`README.md`](../README.md), [`static/manual.html`](../static/manual.html), [`docs/index.html`](../docs/index.html), [`docs/assets/hero-banner.svg`](../docs/assets/hero-banner.svg), [`docs/assets/cockpit-ui-preview.svg`](../docs/assets/cockpit-ui-preview.svg) y [`planes/implementation_plan_v12.4.0.md`](./implementation_plan_v12.4.0.md).

## 3. Resultados Observados Tras la Última Edición
- **Compilación Python, TypeScript y Frontend React 19**:
  - `python3 -m py_compile server.py desktop_app/recursos_app.py` → OK.
  - `./node_modules/.bin/tsc --noEmit` y `./node_modules/.bin/vite build` → OK (`static/index.html` generado con `429053` bytes).
- **Empaquetado e Instalación `.deb` (`GEMINI.md` §5)**:
  - `bash packaging/build_deb.sh` → generado y firmado con GPG [`dist/recursos-cockpit_12.4.0_amd64.deb`](../dist/recursos-cockpit_12.4.0_amd64.deb) + `SHA256SUMS.txt.asc`.
  - `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.4.0_amd64.deb` → OK (`ii recursos-cockpit 12.4.0 amd64` vía `dpkg -l`).
  - `/usr/bin/recursos-cockpit --test-mode` → `[OK] Recursos Native Ubuntu HTML5 App v12.4.0 validated successfully.`
- **Despliegue y Pruebas de Integración en Vivo (`:8085`)**:
  - `systemctl is-active system-dashboard.service` → `active`.
  - `[PASS 1]` `GET http://127.0.0.1:8085/api/version?refresh=1` → `server_version=12.4.0`, `remote_version=12.1.1`, `package_needs_install=False`.
  - `[PASS 2]` `check_github_app_update` en vivo → `App=12.4.0`, `Server=12.4.0`, `GitHub=12.1.1`, `mode=app_ahead_of_github`.
  - `[PASS 3]` Lógica SemVer triple verificada en escenarios simulados `App(12.5.0) > Server(12.4.0) > GitHub(12.1.1)` (`sync_app_to_server_ahead_of_github`) y `GitHub(12.6.0) > App/Server(12.4.0)` (`github_deb_and_server`).
  - `[PASS 4]` `POST http://127.0.0.1:8085/api/system/sync-web`: rechazo `409` ante downgrade (`12.3.0`), rechazo `400` ante SHA-256 inválido y ruta fuera de lista blanca, y sincronización válida `200 OK` (`12` archivos verificados).
  - `[PASS 5]` Puente `LocalHtmlBridgeServer` contra `:8085`: `/api/version`, `/api/metrics` y `POST /api/system/update` devuelven estado triple sin realizar downgrade.
  - `[PASS 6]` Simulación completa contra servidor en `12.3.0`: un clic en `POST /api/system/update` sobre el puente detectó `App(12.4.0) > Server(12.3.0)` (y superior a `GitHub 12.1.1`) y actualizó automáticamente los `12` archivos web del servidor simulado a `12.4.0` (`web_synced: True`, `deb_installed: False`).
  - `[PASS 7]` Inodo de [`/home/servidor/servicios/dashboard/recursos_history.db`](file:///home/servidor/servicios/dashboard/recursos_history.db) intacto (`1049392`, `68042752 bytes`).

