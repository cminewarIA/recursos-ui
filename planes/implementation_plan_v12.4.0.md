# Plan de Implementación · Recursos Cockpit `v12.4.0` (`MINOR`)

## 1. Objetivo y Alcance
Dotar a la aplicación nativa de **Ubuntu Linux** ([`desktop_app/recursos_app.py`](../desktop_app/recursos_app.py)) y a su puente local `LocalHtmlBridgeServer` de **detección triple simultánea** entre:
- **App Ubuntu instalada** (`app_version`),
- **Servidor web local / remoto conectado** (`server_version` vía `/api/version`),
- **Versión oficial publicada en GitHub** (`github_version` vía Releases API y `VERSION`),

e implementar un **único botón inteligente de actualización** (tanto en el lanzador GTK Tarjeta 2 como dentro de la pestaña web **Más → Actualizaciones** en [`src/components/MoreView.tsx`](../src/components/MoreView.tsx)) que:
1. Detecta si la **App Ubuntu y/o GitHub** son superiores al servidor web local.
2. Actualiza la **web local en caliente** mediante el nuevo endpoint autenticado [`POST /api/system/sync-web`](../server.py) verificado con sumas **SHA-256** incluso cuando la App Ubuntu está por encima de GitHub, sin requerir `.git` en el servidor y manteniendo **intacta la base de datos [`recursos_history.db`](../server.py)** y los archivos de credenciales/secretos.
3. Si GitHub supera a la App Ubuntu, descarga el `.deb` oficial, valida firma/SHA-256, lo instala encima sin desinstalar y, acto seguido, sincroniza la web del servidor si sigue atrasada.

## 2. Arquitectura y Cambios Realizados

### 2.1 Backend [`server.py`](../server.py)
- **`_parse_semver_tuple()`**: comparación SemVer numérica limpia sin alias heredados.
- **Protección anti-downgrade en `get_version_info()` y `auto_install_watcher_worker()`**: `package_needs_install` y el vigía local solo reconstruyen o instalan cuando el `.deb` instalado es estrictamente inferior (`<`) a `VERSION` del servidor, nunca si la App Ubuntu es superior.
- **Nuevo endpoint `POST /api/system/sync-web`**:
  - Autenticación Zero-Trust obligatoria (`check_trust_status()`).
  - Lista blanca estricta `ALLOWED_WEB_SYNC_FILES` (`VERSION`, `package.json`, `static/index.html`, `static/manual.html`, `docs/index.html`, favicons e iconos Apple Touch).
  - Guardado anti-downgrade HTTP `409 Conflict` cuando `incoming_ver < current_srv_ver` (salvo `force: true`).
  - Validación Base64 + verificación criptográfica **SHA-256** por archivo (`400 Bad Request` si no coincide) y confinamiento estricto dentro de `BASE_DIR`.
  - Escritura atómica temporal (`.sync_tmp` + `os.replace`) e invalidación inmediata de `VERSION_CACHE` y `METRICS_CACHE_BYTES` con cero caída del servidor y preservación total de `recursos_history.db`.

### 2.2 Aplicación Nativa Ubuntu [`desktop_app/recursos_app.py`](../desktop_app/recursos_app.py)
- **`parse_semver_tuple()`** y **`resolve_bundled_root()`**.
- **`ServerConnectionManager`**:
  - `_resolve_target_server_url()` y `probe_server_version_info()`: detección rápida del servidor activo (URL actual, host guardado, loopback LAN o dominio WAN).
  - `collect_local_web_bundle()` y `sync_web_bundle_to_server()`: empaquetado de recursos web de la App Ubuntu con sumas SHA-256 y envío a `/api/system/sync-web`.
  - `_compute_version_comparison()` y `check_github_app_update()`: cálculo simultáneo de `app_above_server`, `app_above_github`, `github_above_server`, `github_above_app`, `server_needs_update`, `effective_update_available`, `update_mode`, `update_action_label` y `update_summary`.
  - `perform_unified_update()`: flujo transaccional en un único clic (`.deb` desde GitHub si aplica + sincronización web al servidor si App y/o GitHub superan al servidor, nunca realizando downgrades si la App supera a GitHub).
- **`BridgeHandler`**:
  - Timeout ampliado a `60.0s` en `/api/system/*`.
  - Enriquecimiento triple inmediato en `/api/metrics` (sin I/O adicional) y `/api/version`.
  - Interceptación de `POST /api/system/update` y `POST /api/update` para ejecutar `perform_unified_update(relaunch_on_deb=False)` y devolver `web_synced` / `deb_installed`.
- **Lanzador GTK Tarjeta 2**: visualización del estado triple y botón único dinámico `btn_opt2_update`.

### 2.3 Frontend y Modo Desarrollo
- [`src/types/telemetry.ts`](../src/types/telemetry.ts): ampliación de `VersionInfo`.
- [`src/components/MoreView.tsx`](../src/components/MoreView.tsx): cápsulas simétricas de estado (**App Ubuntu**, **Servidor web local**, **GitHub oficial**), etiqueta dinámica del botón único y recarga automática limpia de la interfaz cuando `web_synced === true`.
- [`vite.config.ts`](../vite.config.ts): paridad de campos SemVer en `/api/version` y stub `/api/system/sync-web` en modo dev.

### 2.4 Versionado, Empaquetado y Documentación
- Incremento **MINOR** según `GEMINI.md` (§2.4): `12.3.0` → **`12.4.0`**.
- Sincronización en [`VERSION`](../VERSION), [`package.json`](../package.json), [`packaging/debian/control`](../packaging/debian/control), [`packaging/build_deb.sh`](../packaging/build_deb.sh), [`README.md`](../README.md), [`static/manual.html`](../static/manual.html), [`docs/index.html`](../docs/index.html), SVGs y manifiesto del plugin.

## 3. Plan de Verificación
1. Compilación de sintaxis Python (`server.py` y `desktop_app/recursos_app.py`) y TypeScript + Vite (`tsc --noEmit` + `vite build`).
2. Construcción del paquete Debian `dist/recursos-cockpit_12.4.0_amd64.deb`, instalación local (`sudo apt-get install --reinstall -y`), prueba CLI `--test-mode` y verificación `dpkg -l`.
3. Despliegue a producción en `/home/servidor/servicios/dashboard` (`:8085`) verificando preservación exacta del inodo de `recursos_history.db`.
4. Pruebas de integración en vivo:
   - Consulta a `/api/version` en `:8085`.
   - Simulación controlada en `ServerConnectionManager` de App `12.5.0` vs. Servidor `12.4.0` vs. GitHub `12.3.0` verificando las banderas `app_above_server`, `app_above_github` y `effective_update_available`.
   - Prueba directa contra `POST /api/system/sync-web` verificando rechazo `409` por downgrade, rechazo `400` por SHA-256 inválido y sincronización válida `200` manteniendo la versión final limpia en `12.4.0`.

