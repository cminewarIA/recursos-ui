# Walkthrough v12.12.1 — Revisión y Corrección del Actualizador Manual y Automático

## Resumen Ejecutivo
Se auditó y corrigió el ciclo completo de actualización manual y automática entre el servidor backend (`server.py`), la aplicación nativa Ubuntu GTK/WebKit2 (`desktop_app/recursos_app.py`) y la interfaz React (`src/components/MoreView.tsx`, `src/App.tsx`). La versión canónica se incrementó a `12.12.1` (`PATCH`).

---

## Correcciones Implementadas

### 1. Servidor Backend (`server.py`)
- **Actualización manual vs automática (`perform_auto_update_and_install`)**:
  - Se unificó `is_manual = trigger_source in ("api_request", "manual")` para que las peticiones desde la WebUI realicen correctamente `git stash` / `git pull` / `git stash pop` incluso con cambios locales pendientes.
  - Se reemplazó la detección por texto de salida (`"Ya está actualizado"`) por la comparación exacta de hashes (`before_sha != after_sha`) para reconstruir y reiniciar el servicio solo cuando el código realmente cambia.
  - Se reporta explícitamente si falta el repositorio `.git` cuando la versión remota supera a la local.
  - Al finalizar, se limpian `_LOCAL_GIT_SHA_CACHE`, `VERSION_CACHE` y se actualiza `METRICS_CACHE["version_info"]`.
- **Rate-limit de GitHub y vigilante automático (`get_version_info`, `auto_install_watcher_worker`)**:
  - Se añadió `_GITHUB_COMMITS_CACHE` (TTL 300s): las consultas periódicas leen primero `raw.githubusercontent.com/.../VERSION` y solo consultan `api.github.com/commits` al forzar refresco, expirar el caché o cambiar `VERSION`, conservando commits en caché ante error HTTP 403.
  - Se ajustó `auto_install_watcher_worker` a ciclos de 90s y se añadió guarda para no intentar instalar `.deb` en servidores headless sin `/usr/bin/recursos-cockpit`.
  - Se blindó `get_version_info(allow_auto_trigger=True)` para exigir `has_git and not ahead_of_remote and local_clean` en actualizaciones Git automáticas.
- **Control de auto-actualización (`POST /api/system/auto-update`)**:
  - Se sincroniza `AUTO_INSTALL_STATE["last_status"]` y `VERSION_CACHE` al pausar o reactivar, evaluando la actualización tras reanudar sin disparos ciegos.

### 2. App Nativa Ubuntu y Puente HTML5 (`desktop_app/recursos_app.py`)
- **Resolución GitHub sin dependencia única de API**:
  - `_compute_version_comparison()` y `check_github_app_update()` cachean metadatos de `releases/latest` con fallback vía redirección HTTP (`HEAD`) y verificación directa del asset `.deb` correspondiente a `VERSION`, evitando fallos por rate-limit (403) y desajustes entre `VERSION` de rama y Releases publicados.
- **Corrección de flujo unificado (`perform_unified_update`)**:
  - Protegido por `_update_exec_lock`.
  - Cuando GitHub supera al servidor y la app local aún no tiene la última versión (`github_above_server` con app antigua), ahora solicita al servidor ejecutar `/api/system/update` en lugar de subir un bundle web antiguo desde el cliente.
  - `collect_local_web_bundle()` prioriza `/usr/lib/recursos-cockpit` si su `VERSION >= resolve_bundled_root()/VERSION`.
- **Auto-actualizador nativo silencioso y relanzamiento**:
  - Se añadió `run_auto_update_cycle()` / `start_auto_update_watcher()` (cada 120s): sincroniza automáticamente el bundle web si `app_above_server`, e instala `.deb` silenciosamente mediante `sudo -n` en modo no interactivo (aplicando cooldown de 15 min y estado `native_ubuntu.auto_perm_pending` si requiere contraseña).
  - En modo manual (`interactive=True`), usa `apt-get install --reinstall -y --allow-downgrades` vía `pkexec`/`sudo` y dispara `relaunching: True` + `on_deb_relaunch` tras actualizar desde WebKit2.
  - `LocalHtmlBridgeServer` unifica el esquema `/api/version` en `POST /api/system/update` y persiste localmente `auto_install_enabled` / `auto_install_status` en `POST /api/system/auto-update` antes de hacer proxy al servidor.

### 3. Interfaz React (`src/components/MoreView.tsx`, `src/App.tsx`, `src/types/telemetry.ts`)
- Se añadieron `auto_install_in_progress` y `last_auto_install` a `VersionInfo`.
- `MoreView.tsx` ya no sobrescribe cada 1.5s los campos enriquecidos de `/api/version` (`ubuntu_native_bridge`, `recent_commits`, etc.) con el resumen de `/api/metrics`; ahora fusiona cambios respetando el contexto nativo.
- Se añadió polling cada 2.5s mientras `auto_install_in_progress` está activo, badge animado de actualización en curso, auto-expansión del detalle técnico ante errores o avisos en `deb_installed === false`, y manejo diferenciado de `relaunching`, `restarting`, `web_synced` y `already_running`.
- `App.tsx` sincroniza `versionInfo` y `updateAvailable` en la barra superior mediante `onVersionChange` y refresco periódico cada 5 minutos o al cambiar `metrics.version_info.current_version`.

### 4. Internacionalización y Versión (`./VERSION`, `./i18n/dictionary.csv`)
- `./VERSION` actualizado a `12.12.1`.
- Registradas 5 nuevas claves i18n en `./i18n/dictionary.csv` (`more.auto_paused_status`, `more.auto_in_progress`, `more.update_restarting`, `native_ubuntu.auto_perm_pending`, `native_ubuntu.auto_synced_web`) y normalizados saltos de línea CRLF.

---

## Verificación Realizada
- **Diccionario i18n (`i18n_catalog.load_dictionary()`)**: 773 claves en español cargadas correctamente, incluidas las 5 nuevas claves.
- **Sintaxis Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`)**: Exit code `0`.
- **Bundle Web (`npm run build`)**: Generado en `1.20s` (actualiza `dist/` y `static/index.html` con versión `12.12.1`).
- **Compilación y Linting (`compile_applet` + `lint_applet`)**: `tsc --noEmit` sin errores y compilación Vite exitosa.
- **Empaquetado Debian e Instalación Local**:
  - `bash packaging/build_deb.sh` -> generado y firmado `./dist/recursos-cockpit_12.12.1_amd64.deb` (`SHA256SUMS.txt` y `.asc`).
  - `dpkg --force-depends -i ./dist/recursos-cockpit_12.12.1_amd64.deb` -> instalado (`ii recursos-cockpit 12.12.1 amd64`).
  - `/usr/bin/recursos-cockpit --test-mode` -> validado `[OK] Recursos Native Ubuntu HTML5 App v12.12.1 validated successfully.` y puente HTML5 en `/usr/lib/recursos-cockpit/static/index.html`.
- *(Nota de entorno)*: El contenedor no incluye Android SDK/Gradle ni `psutil`/`requests` en el Python del sistema, por lo que no se ejecutó compilación de `.apk` ni ejecución en vivo de `server.py` en este entorno.
