# Walkthrough y Verificación v12.21.0

## Resumen de Cambios Verificados
1. **Identificación y Simplificación IA del Lado Servidor (`POST /api/net/ai-identify`)**
   - Integración de `@google/genai` (`gemini-4-hydrogen`, User-Agent `aistudio-build`, API key exclusivamente en servidor mediante `GEMINI_API_KEY`) tanto en el entorno Dev (`vite.config.ts`) como en el backend Python de producción (`server.py`).
   - Enriquecimiento 100 % dinámico en tiempo de ejecución sin listas fijas (**Zero-Hardcoding**): se inspeccionan sockets en escucha (`ss -tulnpH`), grupos/comandos de procesos (`/proc/<pid>/cgroup`, `/proc/<pid>/cmdline`), puertos de contenedores activos (`docker ps`) y contexto de `psutil`/`conntrack` antes de caer en etiquetas genéricas como `Kernel Conntrack`.
   - Caché de resultados en memoria + persistencia SQLite (`ai_connection_insights` en `recursos_history.db`) + persistencia de sesión en el frontend con clave de idioma. Si falta la clave o falla el upstream, devuelve error honesto HTTP `503`/`502` visible en banner sin respuestas ficticias.
   - Integrado tanto en los **Popups del Mapa GeoIP** (vista de detalle, lista de clusters y tooltips) como en las tarjetas de **Conexiones detalladas** mediante título simplificado, resumen en 1 frase, desplegable **Detalles técnicos** bajo demanda y conmutador global **Vista IA simple / Vista técnica**.

2. **Restauración del Historial GeoIP y Filtros Multi-Criterio (`Red -> Mapa de conexiones`)**
   - Restauración del selector **En vivo / Historial** (`MorphPill`) respaldado por `GET /api/net/history`, ventanas temporales (`1 h`, `6 h`, `24 h`, `7 d`, `Todo`), resumen acumulado (`registros · IPs únicas · impactos`) y limpieza mediante `POST /api/net/history/clear`.
   - Selectores dinámicos de **Dispositivo** (`devices_catalog` + nodos LAN) y **Servicio** (`services_catalog` + servicios vivos) junto a las píldoras de dirección (`all`, `incoming`, `outgoing`, `devices`, `blocked`) y búsqueda en vivo sobre campos técnicos y simplificados por IA.
   - Paridad completa en `vite.config.ts` (`hours`, `service`, `device`, `direction`, `q`, `limit`, marcado `is_history: true` y catálogos calculados antes de filtrar).

3. **Internacionalización (`./i18n/dictionary.csv`) y Documentación (`README.md`)**
   - Añadidas 21 nuevas claves `network.*` cubriendo los 33 encabezados (`key,context,es,...,is`) de `./i18n/dictionary.csv`.
   - Actualizado `README.md` manteniendo `./VERSION` (`12.21.0`) como única fuente de verdad.

## Resultados de Pruebas y Compilación
- **Integridad CSV (`i18n/dictionary.csv`)**: `Columns: 33`, `Rows: 994`, `Bad width: []`, `Dups: []`, `Missing new keys: []` -> OK.
- **Reglas Firebase (`npx eslint firestore.rules`)**: salida `0` sin errores.
- **TypeScript estricto (`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`)**: salida `0` sin errores ni variables sin usar.
- **Compilación Python (`python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`)**: salida `0` sin errores.
- **Empaquetado Vite (`npm run build`)**: 2107 módulos transformados y compilados en `2.27s`.
- **Empaquetado Debian (`bash packaging/build_deb.sh`)**: generado y firmado `dist/recursos-cockpit_12.21.0_amd64.deb`, symlink `dist/recursos-cockpit.deb` y `SHA256SUMS.txt`.
- **Pruebas HTTP en vivo sobre `:3000` (tras `restart_dev_server`)**:
  - `GET /api/version` -> HTTP `200`, `"version": "12.21.0"`.
  - `GET /api/net/history?hours=24&direction=outgoing&limit=10` -> HTTP `200`, `status: 'ok'`, `conns: 7`, `first_is_history: True`.
  - `POST /api/net/ai-identify` (payload real con firma) -> HTTP `200`, `model: "gemini-4-hydrogen"`, insight simplificado devuelto y parseado correctamente.
  - `GET /` -> HTTP `200`.
