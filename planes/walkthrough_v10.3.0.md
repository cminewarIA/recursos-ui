# Walkthrough v10.3.0 — Revisión Integral de Fallos e Instalación Automática al Detectar

## 1. Resumen de Objetivos
1. **Revisión y Corrección Integral de Fallos**:
   - **Puente Nativo Ubuntu & Controlador USB DeX (`desktop_app/dex_controller.py` y `desktop_app/recursos_app.py`)**:
     - Se corrigieron los errores `AttributeError: 'DexController' object has no attribute 'is_running'` y `'stop_session'`, además de `TypeError: start_dex_session() got an unexpected keyword argument 'usb_only'`.
     - Se añadió `ensure_dependencies_installed()` en `DexController` para instalar automáticamente `adb` y `scrcpy` si faltan al detectarse.
   - **Visibilidad de la Estación USB DeX en Ubuntu (`index.html` y `static/index.html`)**:
     - Se corrigió `performSwitchViewDOM()` donde `#usbProjectionWaitScreen` se ocultaba incondicionalmente (`display: none`) y se detenía el sondeo USB incluso al abrir la vista `/dex` en la App Nativa de Ubuntu.
   - **Reflow del Mapa Geoespacial y Endpoints del Dev Server (`index.html` y `vite.config.ts`)**:
     - Se corrigió la referencia a `NetworkConnectionsMapEngine` en `handleDynamicViewportReflow()`.
     - Se incorporaron los endpoints `/api/system/logs`, `/api/system/logs/clear`, `/api/system/update`, `/api/system/auto-update` y `system_errors_summary` en `vite.config.ts` para evitar errores en el Centro Unificado de Registro de Fallos (`SystemLogsCenter`).
   - **Sincronización de Versiones Estáticas Residuales**:
     - Se actualizaron los enlaces y badges de `#viewVersion` que habían quedado en `10.2.1` a la versión canónica `10.3.0`.

2. **Instalación Automática Inmediata según se Detectan (`server.py`, `vite.config.ts`, `index.html`)**:
   - **Backend (`server.py`)**:
     - `get_installed_deb_version()` verifica con `dpkg-query` la versión instalada de `recursos-cockpit`.
     - `ensure_local_deb_built_and_installed()` compila automáticamente `dist/recursos-cockpit_${VERSION}_amd64.deb` si no existe e instala el paquete en el sistema operativo (`apt-get install --reinstall -y` / `dpkg -i`) tan pronto como se detecta una diferencia de versión.
     - `perform_auto_update_and_install()` y el hilo guardián `auto_install_watcher_worker()` (junto con el disparador inmediato en `get_version_info()`) sincronizan desde GitHub (`git pull origin main`), compilan e instalan el paquete `.deb` automáticamente al detectar una actualización.
   - **Frontend (`index.html` y `static/index.html`)**:
     - Se añadió el panel simétrico `#autoInstallConfigCard` (**"Instalación Automática al Detectar"**) en `/version` con interruptor activo por defecto (`#chkAutoInstallOnDetect`), estado del paquete `.deb` instalado (`#verDebInstalledBadge`) y ejecución automática sin modales bloqueantes en `checkSystemVersion()` y `renderVersionInfo()`.

## 2. Verificación
- Versión canónica sincronizada a `10.3.0` en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
- Paquete Debian `dist/recursos-cockpit_10.3.0_amd64.deb` compilado, instalado localmente y verificado con `/usr/bin/recursos-cockpit --test-mode`.
