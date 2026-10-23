# Walkthrough v9.1.1: Corrección de Errores en Frontend y Manejador de Historial en Servidor Dev

## Resumen Ejecutivo de la Versión 9.1.1 (PATCH)
En cumplimiento de la **Regla 3.4** del proyecto (*0.0.X - Actualización o Ajuste de Pequeños Detalles / Bugfixes*), se publica la versión **`v9.1.1`**, solventando dos errores de ejecución en la interfaz web reportados durante el uso interactivo del mapa geoespacial y la consulta del historial de conexiones.

---

## 1. Corrección de `ReferenceError: connectionsMapServiceDrawerOpen is not defined`
* **Diagnóstico**: Al hacer clic sobre el lienzo del mapa interactivo (`container.addEventListener('click', ...)`), el evento intentaba evaluar la variable `connectionsMapServiceDrawerOpen` que no estaba definida en el contexto del script, provocando la excepción:
  `ReferenceError: connectionsMapServiceDrawerOpen is not defined at HTMLDivElement.<anonymous>`
* **Solución**:
  - Se actualizó el listener para consultar la variable vigente `connectionsMapDrawerOpen` y llamar a `toggleMapSideDrawer(false)`.
  - Se crearon las variables y funciones puente de compatibilidad `let connectionsMapServiceDrawerOpen = false` y `function toggleMapServiceCatalogDrawer(force)`.
  - Se sincronizó el estado en `syncMapSideDrawerUI()`.

---

## 2. Solución a `SyntaxError: Unexpected token '<'` en `/api/net/history`
* **Diagnóstico**: En el servidor de previsualización (Vite), la ruta `/api/net/history` no contaba con un manejador en el middleware. Vite devolvía la plantilla SPA `index.html` con código 200. La función `fetchHistoryData()` asumía JSON y al ejecutar `res.json()` fallaba con:
  `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
* **Solución**:
  - En `vite.config.ts`, se implementó el endpoint `/api/net/history` y `/api/net/history/clear` dentro de `realOsTelemetryMiddleware`, devolviendo datos JSON estructurados congruentes con `server.py`.
  - En `index.html` y `static/index.html`, se reforzó la validación: se verifica que `res.headers.get('content-type')` incluya `application/json` antes de parsear, capturando cualquier anomalía de forma segura sin romper la interfaz.

---

## 3. Sincronización Canónica de Versiones
- `VERSION`: `9.1.1`
- `package.json`: `"version": "9.1.1"`
- `packaging/debian/control`: `Version: 9.1.1`
- `android_app/app/build.gradle.kts`: `versionName = "9.1.1"`, `versionCode = 90101`
- `README.md`: Badges, banner ASCII, enlaces de descarga y tabla de versiones actualizada.
- `index.html` y `static/index.html`: Sincronizados al 100%.
