# Walkthrough v6.0.3 — Corrección de Error `parse5 nested-comment` y Placeholders Zero-Hardcoding

## 1. Causa Raíz Identificada
El compilador de Vite (`parse5`) reportaba el error:
```
Unable to parse HTML; parse5 error code nested-comment
```
Al auditar `index.html` y `static/index.html`, se localizó una línea de apertura de comentario HTML duplicada en la línea 4292 justo antes del encabezado de la sección 12 (`#viewDex`):
```html
<!-- ==================================================================
<!-- ==================================================================
     12. VISTA CONEXIÓN DE DISPOSITIVO & APP NATIVA (RUTA /dex, /app)
     ================================================================== -->
```

## 2. Solución Implementada
1. **Saneamiento de Comentarios HTML (`index.html` y `static/index.html`)**:
   - Se eliminó la línea `<!-- ==================================================================` duplicada en ambos archivos, garantizando que `parse5` valide el árbol DOM sin errores de comentarios anidados.
2. **Placeholders 100% Zero-Hardcoding**:
   - Se reemplazaron los textos iniciales estáticos de versión en `#debBadgeVersion`, `#btnDownloadDeb`, `#btnDownloadDebText`, `#debPkgNameDisplay` y `#debTerminalCommands` por placeholders neutros (`v...` y `recursos-cockpit.deb`), que son hidratados dinámicamente en tiempo de ejecución por `applyVersionToUI()` a partir de `/api/version` y `/api/metrics`.
3. **Control de Versión Unificado (`v6.0.3` - `PATCH`)**:
   - Actualizados `./VERSION`, `./package.json`, `./packaging/debian/control` y `./README.md` a la versión `6.0.3`.
