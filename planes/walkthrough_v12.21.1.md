# Walkthrough y Verificación v12.21.1

## Cambios Aplicados
1. **Actualización de Normas del Proyecto (`./GEMINI.md`)**
   - **Regla 6 ampliada**: exigencia explícita de coherencia estética y lógica por dominio entre apartados (`/inicio`, `/equipo`, `/red`, `/programas`, `/mas`) y subapartados, comprobación lógica obligatoria de ubicación antes de añadir cualquier nueva función, y escalado automático fluido tanto al ancho como al alto disponible de la ventana (prohibiendo tamaños rígidos que recorten u oculten contenido).
   - **Regla 8 añadida**: obligatoriedad de que todas las gráficas y datos captados por el sistema (velocidad, tests, consumos, ping, procesos, conexiones GeoIP/DNS y traducciones/identificaciones de la IA) puedan consultarse en el historial desde **una única base de datos compartida (`recursos_history.db`)**, creada únicamente en local al instalar o arrancar el servidor web y **prohibida su subida, inclusión en paquetes o descarga desde GitHub**.
   - **Regla 9 añadida**: obligatoriedad de depurar el código (código muerto, importaciones sin uso, cachés residuales, compilación estricta y validación en vivo) tanto al añadir cualquier función (`MINOR`) como en cada actualización mayor (`MAJOR`).

2. **Blindaje de Base de Datos Única e Hidratación de Traducciones IA en Historial**
   - **`.gitignore` y `packaging/build_deb.sh`**: ampliación de exclusiones (`*.db*`, `*_dev.json`, `*.vault`) para garantizar que ninguna base de datos ni caché histórica local se versione en GitHub ni se empaquete en `.deb`.
   - **`packaging/debian/postinst`**: inicialización idempotente al instalar de las **7 tablas unificadas** dentro de `recursos_history.db` (`geoip_locations`, `connection_history`, `telemetry_history`, `ping_history`, `process_history`, `ai_connection_insights`, `speedtest_history`), sin sobrescribir jamás datos existentes.
   - **`server.py`, `vite.config.ts`, `src/types/telemetry.ts`, `src/components/NetworkSecurityView.tsx`**: `GET /api/net/history?lang=...` ahora devuelve también las traducciones IA previamente guardadas en `ai_connection_insights` (`ai_insights`) para hidratarlas automáticamente al abrir el historial en cualquier navegador o sesión.
   - **`README.md` y `./VERSION`**: versión `12.21.1` y documentación sincronizada según Regla 4.

## Depuración y Verificación Ejecutada
- `npx eslint firestore.rules`: OK (`0` errores).
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: OK (`0` errores ni símbolos sin uso).
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`: OK.
- `npm run build`: OK (`2107` módulos compilados).
- `bash packaging/build_deb.sh` + `dpkg -c dist/recursos-cockpit.deb`: paquete `recursos-cockpit_12.21.1_amd64.deb` generado y verificado libre de ficheros `.db`, `*_dev.json` y `.vault` (`DEB_CLEAN_VERIFIED`).
- Pruebas HTTP en vivo sobre `:3000`:
  - `GET /api/version` -> `12.21.1`
  - `POST /api/net/ai-identify` -> `ok: True` con insight almacenado
  - `GET /api/net/history?hours=24&lang=es&limit=50` -> devolvió `ai_insights` persistido junto a las conexiones del historial (`CONNS: 7`).
