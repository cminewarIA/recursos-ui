# Plan de Implementación: Corrección Integral de Bloqueo "Actualizando Continuamente" y Circuit Breaker de Auto-Actualización (`v10.5.2`)

## 1. Diagnóstico de la Causa Raíz
La interfaz web o nativa podía quedar atrapada mostrando "Actualizando..." o recargando continuamente por la confluencia de varios factores identificados:
1. **Bucle Infinito de Recarga por Caché del Navegador**: `checkWebAppAutoUpdate` detectaba una discrepancia entre la versión inicial en memoria (`_initialAppVersion` / `_initialAppHash`) y la telemetría del servidor (`info.version` / `info.local_hash`). Al ejecutar `window.location.reload(true)` (método cuyo parámetro `true` está deprecado en navegadores modernos), el navegador o WebView recargaba el HTML desde su caché de disco conservando la versión previa, provocando que a los 2 segundos el tick de telemetría volviera a disparar `triggerSmoothWebAppReload` indefinidamente.
2. **Ausencia de Circuit Breaker (Límite Anti-Bucle)**: No existía memoria en `sessionStorage` para registrar los intentos consecutivos de recarga, impidiendo abortar el bucle tras múltiples fallos de refresco de caché.
3. **Persistencia del Banner Flotante**: `#webAppAutoUpdateBanner` se colocaba en `display: inline-flex` sin timeout de seguridad ni reseteo al recargar o restaurar desde la memoria del navegador (`bfcache`), dejándolo visible permanentemente.
4. **Textos de Estado Confusos ("Instalando...")**: En `renderVersionInfo`, los badges y títulos mostraban textos fijos como `"Instalando (hash)"` o `"Instalando actualización..."` cuando simplemente había una versión remota disponible en GitHub (`hasUpdate`), en lugar de reservar el estado de instalación activa para cuando `info.auto_install_in_progress` fuese `true`.
5. **Reintentos Rápidos de Auto-Instalación**: Ante cualquier desincronización, `executeSystemUpdate(true)` se volvía a disparar cada 30 segundos, manteniendo la interfaz en estado de instalación perpetuo.

---

## 2. Solución Propuesta

### A. Frontend (`static/index.html` e `index.html`)
1. **Circuit Breaker con Backoff en `sessionStorage`**:
   - `recursos_update_reload_attempts`: Contador de recargas consecutivas sin éxito.
   - `recursos_last_update_reload_ts`: Timestamp del último intento.
   - Cooldown de 45 segundos por hash o versión.
   - Si se superan 2 intentos consecutivos sin que la versión cambie (indicador de caché persistente o proxy), se detiene la recarga automática y se muestra un aviso no intrusivo con botón de recarga manual.
2. **Cache-Busting Real en la Recarga**:
   - Sustituir `window.location.reload(true)` por una recarga limpia mediante URL con parámetro de versión/hash: `url.searchParams.set('_v', targetHash)`.
3. **Timeout de Seguridad y Auto-Ocultamiento del Banner Flotante**:
   - Asegurar que `#webAppAutoUpdateBanner` inicie en `display: none` al cargar la página.
   - Timeout de seguridad de 8 segundos en `triggerSmoothWebAppReload` para ocultar el banner y liberar la interfaz si la recarga es bloqueada por el navegador.
4. **Claridad de Estados en Insignias y Textos**:
   - Distinguir entre "Actualización disponible" (pasivo) e "Instalando actualización..." (activo únicamente cuando `info.auto_install_in_progress` o `_autoInstallInProgressClient` es `true`).
5. **Backoff Progresivo en Auto-Instalación**:
   - Incrementar el cooldown tras un intento de auto-instalación a 180 segundos para evitar llamadas repetitivas en bucle.

### B. Backend y Puentes Nativos (`server.py`, `desktop_app/recursos_app.py`, `vite.config.ts`)
1. Inyección uniforme de `<meta name="recursos-app-version">` y `window.__INITIAL_APP_VERSION__` / `window.__INITIAL_APP_HASH__` tanto en `server.py` como en `LocalHtmlBridgeServer` (Ubuntu) y Vite dev server.

### C. Versión Canónica (`v10.5.2` - Regla 3)
1. Sincronizar `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `README.md`.
2. Compilar e instalar `.deb` y verificar con `--test-mode` (Regla 6).
3. Publicar con `git push origin main --tags` (Regla 9).
