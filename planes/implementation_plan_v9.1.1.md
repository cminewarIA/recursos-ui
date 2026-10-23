# Plan de Implementación v9.1.1: Corrección de Errores en Frontend y Manejador de Historial en Servidor Dev

## 1. Contexto y Errores Detectados
Se reportaron dos errores en tiempo de ejecución:
1. `Error consultando /api/net/history: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
   - **Causa raíz**: En el entorno de desarrollo y previsualización (Vite), la ruta `/api/net/history` no estaba interceptada por el middleware de telemetría. Al solicitarla, Vite devolvía la página SPA por defecto (`index.html`), comenzando por `<!DOCTYPE html>`. El frontend llamaba a `res.json()` de forma incondicional asumiendo JSON, lo que provocaba un `SyntaxError`.
2. `ReferenceError: connectionsMapServiceDrawerOpen is not defined at HTMLDivElement.<anonymous> (:13444:13)`
   - **Causa raíz**: En el listener global de clic del contenedor del mapa Leaflet (`container.addEventListener('click', ...)`), el código referenciaba el identificador obsoleto `connectionsMapServiceDrawerOpen` e invocaba `toggleMapServiceCatalogDrawer(false)`. Dicha variable no existía en el scope superior, produciendo una excepción `ReferenceError` no capturada al hacer clic sobre el mapa.

---

## 2. Acciones y Modificaciones Realizadas

### A. Corrección de `ReferenceError: connectionsMapServiceDrawerOpen`
- En `index.html` (y `static/index.html`):
  - Sustitución segura en el listener del contenedor del mapa por `connectionsMapDrawerOpen` y `toggleMapSideDrawer(false)`.
  - Definición explícita de `connectionsMapServiceDrawerOpen` y función puente `toggleMapServiceCatalogDrawer(force)` en el scope global del mapa para compatibilidad total ante cualquier llamada residual.
  - Sincronización continua de estado en `syncMapSideDrawerUI()`.

### B. Corrección de `SyntaxError` en `/api/net/history`
- En `vite.config.ts`:
  - Implementación del endpoint `/api/net/history` y `/api/net/history/clear` dentro del middleware de telemetría del servidor de desarrollo. Devuelve el catálogo estructurado de servicios, dispositivos, conexiones y resumen en JSON idéntico al backend de producción `server.py`.
- En `index.html` (y `static/index.html`):
  - En `NetworkConnectionsMapEngine.fetchHistoryData()` y `toggleDeviceInlineHistory()`, se incorporó validación estricta de la cabecera `content-type` (`cType.includes('application/json')`) previa al parseo con `res.json()`.
  - En caso de respuestas no JSON o fallos transitorios, se maneja de forma no bloqueante (`console.warn`) sin arrojar errores en la consola.

### C. Sincronización Canónica de Versiones (`9.1.1`)
- `./VERSION`: `9.1.1`
- `package.json`: `"version": "9.1.1"`
- `packaging/debian/control`: `Version: 9.1.1`
- `android_app/app/build.gradle.kts`: `versionName = "9.1.1"`, `versionCode = 90101`
- `README.md`: Badges, banner ASCII, enlaces de descarga directa y tabla de historial de versiones actualizados.
- Sincronización 100% idéntica entre `index.html` y `static/index.html`.

---

## 3. Plan de Verificación
1. Compilar el paquete Debian canónico: `bash packaging/build_deb.sh`.
2. Validar que la aplicación nativa ejecute limpiamente: `python3 desktop_app/recursos_app.py --test-mode`.
3. Validar TypeScript: `lint_applet` (`tsc --noEmit`).
4. Compilar la aplicación web: `compile_applet`.
