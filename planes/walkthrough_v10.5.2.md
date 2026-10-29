# Walkthrough: Corrección del Bucle Continuo de Actualización y Circuit Breaker en la WebApp (`v10.5.2`)

## Resumen Ejecutivo
En respuesta a la incidencia reportada (**"revisa porque se queda la interfaz en actualizando continuamente"**), se realizó un diagnóstico exhaustivo de la lógica de actualización en cliente y servidor:

1. **Causa Raíz Principal**: 
   - El método `triggerSmoothWebAppReload()` invocaba `window.location.reload(true)`. En navegadores modernos y contenedores WebView, el parámetro `true` ha sido deprecado y es ignorado; si el documento HTML o las cabeceras HTTP permitían caché local, el navegador recargaba la versión previa que seguía conteniendo la versión antigua (`10.5.0` o `10.5.1`).
   - Al reiniciarse la página, la versión en memoria (`__INITIAL_APP_VERSION__`) seguía desfasada respecto a `/api/version` (`10.5.2`), reactivando de forma inmediata `checkWebAppAutoUpdate()` tras el primer tick de telemetría de 2 segundos, generando un **bucle infinito de recargas continuas**.
2. **Causa Raíz Secundaria (Confusión Visual en Insignias)**:
   - En `renderVersionInfo()`, cuando `hasUpdate` (`info.update_available`) era `true`, las insignias `dotVerHeader`, `lblVerHeader`, `ovVersionBadge`, `verStatusBadge` y `verDebInstalledBadge` mostraban textos como `"Instalando actualización..."` y `"Instalando (remoteHash)"` a pesar de que el proceso de auto-instalación en segundo plano aún no estuviera en ejecución (`info.auto_install_in_progress == false`), induciendo al usuario a creer que el sistema estaba bloqueado en una instalación perpetua.
3. **Falta de Inyección en App Nativa Linux**:
   - En `desktop_app/recursos_app.py`, el servidor interno `LocalHtmlBridgeServer` servía el archivo `index.html` sin inyectar `window.__INITIAL_APP_VERSION__` y `window.__INITIAL_APP_HASH__`, dejando la versión inicial no definida.

---

## Solución Implementada

### 1. Disyuntor (Circuit Breaker) Anti-Bucle en `sessionStorage`
- Se implementó un guardián en `triggerSmoothWebAppReload()`:
  - Registra marcas de tiempo y contadores en `sessionStorage`: `_webAppReloadCount`, `_webAppReloadLastTs`, `_webAppLastAttemptedTarget`.
  - Si se intentan 2 recargas consecutivas en menos de 45 segundos para el mismo hash/versión objetivo sin que la versión cargada cambie, el **Circuit Breaker** se dispara.
  - Al dispararse, cancela la auto-recarga desatendida y muestra una notificación no intrusiva con efecto *Apple Liquid Glass*: *"Se detectó una actualización a vX.Y.Z, pero la caché del navegador no se actualizó automáticamente"*, permitiendo al usuario forzar el refresco manualmente mediante un botón interactivo sin bloquear la pantalla.

### 2. Recarga con Cache-Busting Determinista en URL
- En lugar de confiar en `location.reload()`, se construye una nueva URL mutando el parámetro de consulta:
  ```javascript
  const url = new URL(window.location.href);
  url.searchParams.set('_v', (targetHash || Date.now().toString()).slice(0, 10));
  window.location.replace(url.toString());
  ```
- Esto garantiza que el navegador solicite una copia limpia del documento HTML al servidor, invalidando cualquier caché de disco intermedia.

### 3. Desactivación de Auto-Recarga en Contenedores Nativos
- Se comprueba `window.__RECURSOS_NATIVE__`, `window.__RECURSOS_UBUNTU_NATIVE__` y `window.RecursosAndroidBridge` para evitar recargas automáticas no deseadas en las aplicaciones de Ubuntu y Android, preservando la estabilidad del Native Bridge.

### 4. Desambiguación Estricta de Estados e Insignias de Instalación
- Se corrigió `renderVersionInfo()`:
  - Si hay actualización disponible (`hasUpdate == true`) pero la instalación **NO** está en curso (`!isActivelyInstalling`):
    - Insignias de cabecera y versión: Muestran `"Actualización disponible"` / `"Nueva versión vX.Y.Z"` con color cian/azul.
    - Insignia de paquete Debian (`#verDebInstalledBadge`): Muestra `"Actualización disponible en GitHub"` en lugar de `"Instalando..."`.
  - Solo cuando `info.auto_install_in_progress` o `_autoInstallInProgressClient` es `true` se despliega el estado `"Instalando..."` con animación de pulso ámbar.
  - Se incrementó el cooldown de auto-instalación a 180 segundos para evitar llamadas redundantes de reintento.

### 5. Inyección Dinámica en la App Nativa Ubuntu (`desktop_app/recursos_app.py`)
- `LocalHtmlBridgeServer` inyecta las etiquetas meta y variables globales `window.__INITIAL_APP_VERSION__` y `window.__INITIAL_APP_HASH__` al servir `index.html` al motor WebKit2.

### 6. Timeout de Seguridad en Banner Flotante
- Se añadió un temporizador de seguridad de 9 segundos y reseteo inicial (`display: none; opacity: 0;`) para asegurar que `#webAppAutoUpdateBanner` se oculte limpiamente incluso si la red sufre microcortes durante el refresco.

---

## Verificación de Resultados

| Componente / Prueba | Comando / Método de Verificación | Resultado | Estado |
| :--- | :--- | :--- | :---: |
| **Backend `/api/version`** | `curl -s http://127.0.0.1:8085/api/version` | `version: "10.5.2"`, `auto_install_in_progress: false`, `update_available: false` | ✅ PASADO |
| **Compilación Paquete Debian** | `bash packaging/build_deb.sh` | Generado `dist/recursos-cockpit_10.5.2_amd64.deb` y `SHA256SUMS.txt` | ✅ PASADO |
| **Instalación Local Debian** | `sudo dpkg -i ./dist/recursos-cockpit_10.5.2_amd64.deb` | Instalado limpiamente sobre 10.5.2 | ✅ PASADO |
| **Prueba Test-Mode App Nativa** | `/usr/bin/recursos-cockpit --test-mode` | `[OK] Recursos Native Ubuntu HTML5 App v10.5.2 validated successfully` | ✅ PASADO |
| **Paridad HTML Frontend** | `diff -u static/index.html index.html` | Idénticos al 100% | ✅ PASADO |
| **Validación de AST Python** | `python3 -m py_compile server.py desktop_app/*.py` | 0 errores de sintaxis | ✅ PASADO |
| **Compilación APK Android** | `cd android_app && ./gradlew assembleRelease` | Generado `app-release.apk` v10.5.2 | ✅ PASADO |
