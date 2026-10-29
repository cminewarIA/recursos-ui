# Walkthrough: Auto-Actualización Reactiva de la WebApp (`v10.5.0`)

## Resumen Ejecutivo
Se ha implementado el sistema integral de **Auto-Actualización Reactiva de la WebApp**, permitiendo que cualquier cliente web o contenedor en ejecución detecte de forma automática, proactiva y continua cualquier actualización desplegada en el servidor (nuevos commits en GitHub, actualización del paquete `.deb`, reinicio tras actualización o cambios en el código local) y se auto-recargue suavemente (`window.location.reload(true)`), restaurando la vista y el estado activo del usuario sin requerir recargas manuales con F5.

---

## Cambios Implementados

### 1. Inyección Dinámica de Versión y Hash de Commit en el Servidor (`server.py`)
- Al servir `index.html` en la ruta `/`, el backend extrae el hash del commit local actual (`git rev-parse HEAD`, primeros 7 caracteres) y la versión semántica de `./VERSION`.
- Se inyecta dinámicamente en el `<head>` del HTML antes de enviarlo al navegador:
  ```html
  <meta name="recursos-app-version" content="10.5.0" data-commit="6153b17">
  <script>window.__INITIAL_APP_VERSION__ = "10.5.0"; window.__INITIAL_APP_HASH__ = "6153b17";</script>
  ```
- Esto garantiza que cada instancia de la WebApp en memoria conozca con exactitud matemática qué versión y commit tiene cargados.

### 2. Motor de Detección Reactiva y Recarga Suave (`static/index.html` e `index.html`)
- **Variables de huella inicial:** `_initialAppVersion`, `_initialAppHash`, `_lastKnownServerHash`, `_lastKnownServerVer`, `_isReloadingDueToUpdate`.
- **Preferencia en localStorage:** `isAutoReloadOnUpdateEnabled()` y `toggleAutoReloadPreference()` (`recursos_auto_reload_on_update`, activa por defecto).
- **Función de sondeo continuo `checkWebAppAutoUpdate(versionInfo)`**:
  - Invocada en cada tick de métricas en tiempo real (`applyMetricsToDOM`, cada 1-2 segundos) y en `checkSystemVersion` (cada 60 segundos).
  - Detecta discrepancias de hash (`serverHash !== clientHash`) o versión semántica (`serverVer !== clientVer`).
- **Función de transición suave `triggerSmoothWebAppReload(reasonMsg, newVersion, newHash)`**:
  - Despliega el HUD flotante `#webAppAutoUpdateBanner` (*Apple Liquid Glass*) informando al usuario en tiempo real.
  - Realiza un sondeo activo a `/api/version` hasta certificar que el servidor ha completado su reinicio (HTTP 200 OK).
  - Marca `sessionStorage.setItem('recursos_reloaded_from_update', 'true')` y ejecuta `window.location.reload(true)`.
  - Al recargar, conserva la URL canónica actual (`/network`, `/version`, etc.) y muestra una notificación toast verde de confirmación: *"WebApp sincronizada con éxito a v10.5.0"*.

### 3. Tarjeta Bento Simétrica en la Vista de Versión (`#webAppAutoReloadConfigCard`)
- Ubicada simétricamente en `#viewVersion` cumpliendo rigurosamente la **Regla 8**:
  - Interruptor `#chkAutoReloadOnUpdate` ("Auto-recargar webapp al detectar").
  - Insignia de estado `#verAutoReloadBadge` (`ACTIVO` / `PAUSADO`).
  - Insignia de versión cargada `#verAppLoadedBadge` (`Cargada: v10.5.0 (6153b17)`).
  - Descripción técnica explicativa para el operador.

### 4. Sincronización Canónica de Versiones a `10.5.0` (Regla 3)
- Versión canónica `./VERSION`: `10.5.0`
- `package.json`: `"version": "10.5.0"`
- `packaging/debian/control`: `Version: 10.5.0`
- `android_app/app/build.gradle.kts`: `versionCode = 100500`, `versionName = "10.5.0"`
- `README.md`: Badges de versión, banner ASCII, enlaces de descarga directa y tabla de historial con la entrada `v10.5.0`.

---

## Verificación Realizada

1. **Prueba de Inyección en HTML Servido**:
   - `curl -s http://127.0.0.1:8085/ | grep "recursos-app-version"`
   - Resultado: `<meta name="recursos-app-version" content="10.5.0" data-commit="6153b17"><script>window.__INITIAL_APP_VERSION__ = "10.5.0"; window.__INITIAL_APP_HASH__ = "6153b17";</script>` verificado.
2. **Prueba del Endpoint `/api/version`**:
   - `curl -s http://127.0.0.1:8085/api/version` responde HTTP 200 con versión `10.5.0`.
3. **Compilación e Instalación del Paquete Linux (`.deb`) (Regla 6)**:
   - `bash packaging/build_deb.sh` generó `dist/recursos-cockpit_10.5.0_amd64.deb`.
   - `sudo dpkg -i ./dist/recursos-cockpit_10.5.0_amd64.deb` instalado exitosamente.
   - `/usr/bin/recursos-cockpit --test-mode` validó `[OK] Recursos Native Ubuntu HTML5 App v10.5.0 validated successfully.`
   - `dpkg -l | grep recursos-cockpit` confirmó `10.5.0`.
