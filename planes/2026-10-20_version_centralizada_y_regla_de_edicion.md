# Trazabilidad de Versión: Sistema de Versionado Centralizado (`VERSION`) y Regla de Edición

**Fecha**: 2026-10-20  
**Versión Inicial**: `2.1.0`  
**Versión Final**: `2.2.0`  
**Objetivo**: Establecer un único punto de verdad para el número de versión de toda la aplicación, eliminando versiones estáticas o hardcodeadas, y configurar las reglas de inicio y fin de edición.

---

## 1. Problema Identificado
- Anteriormente existían versiones dispares en el proyecto: `package.json` mostraba `1.0.0`, `server.py` tenía un fallback `2.0.0`, y `static/index.html` tenía cadenas estáticas fijas como `v2.0` en badges del sidebar y tarjetas de vista general.
- No existía una vinculación dinámica entre la versión semántica de la aplicación y la interfaz gráfica.

---

## 2. Solución Implementada
1. **Archivo Canónico Único (`VERSION`)**:
   - Creado `/home/servidor/servicios/dashboard/VERSION` en texto plano conteniendo la versión semántica limpia del sistema (ej. `2.2.0`).
   - Sincronizado con `"version": "2.2.0"` en `package.json`.
2. **Backend Dinámico (`server.py`)**:
   - Implementada la función `get_app_version()` que lee el archivo `VERSION` en tiempo de ejecución.
   - `/api/version` y `/api/metrics` reportan el campo `version` leído directamente de dicho archivo.
   - Al servir `index.html`, `server.py` sustituye los marcadores iniciales con la versión activa para prevenir cualquier desfase visual.
3. **Frontend Reactivo (`static/index.html` y espejo `index.html`)**:
   - Modificada la función `renderVersionInfo(info)` para actualizar automáticamente todos los componentes visuales:
     - Badge superior del sidebar (`sidebarVersionTag`).
     - Badge de navegación (`badgeNavVersion`).
     - Botón de estado en la cabecera (`lblVersionHeader`).
     - Tarjeta Bento en la Vista General (`ovVersionCommit` y `ovBadgeGitVersion`).
     - Badges semánticos en la vista `/version` (`verAppSemanticVersion` y `verHeaderVersionBadge`).
   - Enlace automático en `applyMetricsToDOM` para actualizar la versión con el sondeo de `/api/metrics`.

---

## 3. Regla Operativa 5
- **Inicio de edición**: Identificar la versión canónica actual en `VERSION`.
- **Durante la edición**: Cualquier componente debe consultar o recibir la versión desde `VERSION`.
- **Fin de edición**: Incrementar la versión en `VERSION` (y `package.json`) antes del commit y push a GitHub.
