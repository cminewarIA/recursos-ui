# Plan de Implementación: Auto-Actualización Automática de la WebApp al Detectar Actualizaciones (v10.5.0)

Este documento describe la arquitectura y los cambios técnicos para implementar la solicitud del usuario:
*"qioero que la webapp se auto acyualize cuando detecta una actualizacion"*

## User Review Required

> [!IMPORTANT]
> **Criterio de Incremento de Versión (Regla 3):**
> Se incorpora una nueva funcionalidad completa en la WebApp (detección y auto-actualización/auto-recarga continua del cliente web), por lo que la versión canónica se incrementa a `10.5.0` (MINOR), restableciendo PATCH a 0.

## Propuesta de Diseño y Arquitectura

### 1. Inyección de Huella de Versión de Carga en `server.py`
- Al servir `index.html` (líneas 7690-7705), `server.py` inyectará la huella exacta del servidor:
  - `<meta name="recursos-app-version" content="{current_ver}" data-commit="{local_sha}">`
  - `<script>window.__INITIAL_APP_VERSION__ = "{current_ver}"; window.__INITIAL_APP_HASH__ = "{local_sha}";</script>`
- Esto permite a la WebApp conocer con 100% de certeza la versión exacta de los archivos HTML/JS que tiene cargados en memoria.

### 2. Motor de Auto-Actualización en la WebApp (`static/index.html` e `index.html`)
- **Detección Bidireccional y Reactiva**:
  1. **Servidor con versión más nueva que la WebApp en memoria**:
     - Si en `/api/metrics` o `/api/version`, el servidor reporta `version !== window.__INITIAL_APP_VERSION__` o `local_hash !== window.__INITIAL_APP_HASH__`:
       - Significa que el servidor ya se ha actualizado (vía watcher en segundo plano, git pull, etc.).
       - La WebApp despliega un toast visual elegante: *"🚀 Nueva versión detectada en el servidor (vX.Y.Z · <hash>). Actualizando webapp..."*
       - Ejecuta automáticamente `window.location.reload(true)` tras 1.5s, preservando la vista activa.
  2. **Nueva versión detectada en GitHub o paquete local pendiente**:
     - Si `update_available === true` o `package_needs_install === true`:
       - Dispara de inmediato la instalación en segundo plano mediante `/api/system/update` o `perform_auto_update_and_install`.
       - Muestra el HUD/toast: *"📦 Actualización detectada en GitHub. Instalando y actualizando webapp automáticamente..."*
       - Entra en bucle de sondeo rápido de reconexión (cada 1s).
       - En cuanto el nuevo servidor esté operativo y responda con el nuevo commit: recarga automática transparente de la página (`window.location.reload(true)`).
  3. **Reconexión Resiliente ante Reinicio de Servicio**:
     - Durante el reinicio de `system-dashboard.service` (`Failed to fetch`), la WebApp no se bloquea ni muestra errores; muestra *"Reconectando tras actualización..."* y tan pronto como el endpoint `/api/version` responde `200 OK`, recarga de inmediato.

### 3. Interfaz de Configuración en el Panel de Versión (`#viewVersion`)
- Incorporación en `#autoInstallConfigCard` de un conmutador simétrico:
  - *"Auto-actualizar WebApp al detectar actualización"* (marcado como activo por defecto).
  - Persistencia en `localStorage` (`recursos_auto_reload_on_update`).
  - Badge de estado dinámico (`ACTIVO`).

### 4. Sincronización Canónica y Empaquetado
- Actualización de `./VERSION` a `10.5.0`.
- Sincronización de `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts` y `README.md`.
- Compilación del paquete Debian `packaging/build_deb.sh`, instalación local en el servidor físico y validación con `/usr/bin/recursos-cockpit --test-mode`.
- Compilación de APK Android Release `android_app/`.
- Registro de walkthrough en `./planes/` y publicación con `git push origin main --tags`.

## Verification Plan

### Automated Tests
- Validación de sintaxis Python: `python3 -m py_compile server.py`.
- Paridad de HTML: `diff -u index.html static/index.html`.
- Compilación Debian: `bash packaging/build_deb.sh`.
- Verificación nativa: `/usr/bin/recursos-cockpit --test-mode`.
- Verificación del paquete: `dpkg -l | grep recursos-cockpit`.
- Verificación de la API: `curl -s http://127.0.0.1:8085/api/version`.

### Manual Verification
- Comprobar que al cambiar la versión o detectar actualización, la WebApp muestra el aviso y se recarga automáticamente sin intervención manual.
