# Plan de Implementación v12.21.1

## Alcance y Ubicación Lógica
- **Tipo de cambio**: `PATCH` (`12.21.0` -> `12.21.1`) — actualización formal de reglas del proyecto (`./GEMINI.md`), refuerzo de exclusión de bases de datos en Git/empaquetado, hidratación de traducciones IA guardadas dentro del historial (`/red` → *Mapa de conexiones* y *Historial de tráfico*) y depuración de código.
- **Evaluación lógica de ubicación**: Las traducciones/identificaciones generadas por la IA pertenecen a la base de datos unificada `recursos_history.db` (`ai_connection_insights`) y se muestran directamente al consultar el historial de conexiones en `/red` (`GET /api/net/history`), manteniendo coherencia con el resto de historiales (telemetría, latencia ping, procesos y speedtest).

## Cambios Planificados
1. **`./GEMINI.md`**:
   - Ampliar la **Regla 6** con coherencia estética y lógica entre apartados/subapartados, análisis obligatorio de ubicación lógica antes de añadir funciones y escalado fluido automático al ancho y alto disponible del viewport.
   - Incorporar la **Regla 8**: historial completo unificado en una única base de datos compartida (`recursos_history.db`) que se crea únicamente al instalar/iniciar el servidor web y nunca puede descargarse ni versionarse desde GitHub.
   - Incorporar la **Regla 9**: depuración obligatoria del código (eliminación de código muerto, importaciones sin uso, validación estricta y pruebas) cada vez que se añada una función o se realice una actualización mayor.
2. **Exclusión Absoluta de Bases de Datos en Git y `.deb`**:
   - Reforzar `./.gitignore` (`*.db*`, `*_dev.json`, `*.vault`) y `./packaging/build_deb.sh`.
3. **Visibilidad del Historial IA en Base de Datos Unificada**:
   - Exponer las traducciones IA almacenadas (`ai_connection_insights` en `recursos_history.db` y respaldo dev) en `GET /api/net/history?lang=...` tanto en `server.py` como en `vite.config.ts` e hidratarlas automáticamente en `NetworkSecurityView.tsx`.
4. **Documentación (`README.md`) y Depuración Final**:
   - Sincronizar `./README.md`, validar tipos estrictos (`--noUnusedLocals --noUnusedParameters`), Python, CSV, ESLint, Vite build, `.deb` y endpoints en vivo.
