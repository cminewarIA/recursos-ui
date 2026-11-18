# Walkthrough & Depuración Integral — `v12.22.0`

## 1. Resumen de Mejoras y Cumplimiento de Normas (`GEMINI.md`)

1. **Efecto Gelatina Restringido Exclusivamente a los Topes de Scroll (`edge`)**:
   - Eliminada la función `triggerElementJelly`, el selector `INTERACTIVE_JELLY_SELECTOR` y todos los escuchadores de ratón/puntero (`pointerover`, `pointerdown`, `click`, `change`, `keydown`) y de desplazamiento intermedio (`'move'`) en `src/utils/scrollContain.ts`.
   - Eliminadas todas las deformaciones `scaleX(...) scaleY(...)` en `:hover` y `:active` dentro de `src/index.css` y todas las propiedades `whileHover` / `whileTap` de deformación elástica en `MotionPrimitives.tsx`, `App.tsx`, `OverviewView.tsx`, `EquipmentView.tsx`, `NetworkSecurityView.tsx`, `AppsMediaView.tsx`, `MoreView.tsx`, `ExpandedChartModal.tsx` y `ProcessHistoryStackedChart.tsx`.
   - Conservados intactos el bloqueo de encadenamiento de scroll en modales (`installGlobalModalScrollContain`) y el rebote elástico WAAPI (`triggerScrollJelly` + `runStageCompanionDockJelly`) **únicamente al alcanzar el límite superior, inferior, izquierdo o derecho del scroll (`edge`)**.

2. **Calibración del Motor Local de Test de Velocidad (`Speedtest.net`) para Líneas de Fibra de Alta Velocidad**:
   - **Prioridad al binario oficial C++ de Ookla (`speedtest`)**: `speedtest-cli` en Python monohilo pasa a ser el último recurso de emergencia por su cuello de botella de CPU/GIL en líneas >300 Mbps.
   - **Motor Paralelo HTTP Keep-Alive + Descarte de Arranque Lento TCP (`750 ms`) + Verificación Física `/proc/net/dev`**:
     - `server.py` (`_run_speedtest_worker`) utiliza `requests.Session` con `HTTPAdapter(pool_connections=16, pool_maxsize=16)` reutilizando el mismo handshake TLS en **8 hilos concurrentes de descarga** (`25 MB` por bloque) y **6 hilos concurrentes de subida** (`2 MB` por bloque).
     - `_compute_sustained_speed_mbps()` descarta los primeros `750 ms` de rampa TCP (*slow-start*) para calcular la velocidad sostenida real y la contrasta con el delta físico de bytes de la interfaz WAN (`/proc/net/dev`) mediante `_read_wan_iface_bytes()`.
     - Paridad completa en el servidor de desarrollo (`vite.config.ts`) mediante `http.Agent` / `https.Agent` con `keepAlive: true, maxSockets: 16`.

3. **Simplificación y Diagnóstico IA de Fallos del Avisador de la Interfaz con Nivel de Peligro, Soluciones y Deduplicación en `recursos_history.db`**:
   - **Normalización Determinista de Firmas (`_normalize_system_fault_signature`)**: Limpia PIDs, direcciones hexadecimales, marcas temporales, UUIDs y números efímeros de cada unidad `systemd` fallida o entrada `journalctl` / `docker` / `kernel` para que el mismo fallo recurrente genere siempre la misma firma canónica (`signature`).
   - **Tabla `ai_system_fault_insights` en `recursos_history.db` (`GEMINI.md` Regla 8)**:
     - Almacena `signature`, `category`, `unit_or_source`, `sample_message`, `title`, `danger_level` (`critical` | `high` | `medium` | `low`), `summary`, `solution`, `confidence`, `provider`, `model`, `locale`, `occurrence_count`, `first_seen` y `updated_at`.
     - Cada llamada a `GET /api/system/logs` o `/api/metrics` cruza automáticamente los avisos activos con `ai_system_fault_insights` e inyecta `ai_insight` en cada aviso conocido sin consultar a Gemini.
     - Al pulsar **Simplificar y diagnosticar con IA** (`POST /api/system/logs/ai-simplify`), el servidor resuelve desde SQLite los fallos ya conocidos (`cached_hits`) y consulta a Gemini (`gemini-3-flash-preview`) **únicamente por firmas nuevas** (`new_queries`), guardando el resultado en `recursos_history.db`.
   - **Integración Visual en `/inicio` y `/mas` (`Salud y avisos del sistema`)**:
     - En el avisador desplegable de `/inicio` y en `/mas` → *Salud y avisos del sistema*, cada unidad fallida y evento del registro muestra su **insignia de nivel de peligro (`Crítico`, `Alto`, `Medio`, `Bajo`)**, explicación clara en lenguaje sencillo y cuadro de **Solución recomendada**.
     - Incluye la sección consultable **Historial de diagnósticos IA (`recursos_history.db`)** en `/mas` con contador de ocurrencias (`×N`), nivel de peligro y solución persistida.

4. **Revisión Línea a Línea de los 5 Apartados (`/inicio`, `/equipo`, `/red`, `/programas`, `/mas`) y Escalado Fluido**:
   - Añadido el widget **Historial de identificaciones IA (`recursos_history.db`)** dentro de `/red` → *Historial de tráfico* (`data-testid="traffic-ai-history"`), permitiendo consultar todas las conexiones identificadas por la IA, su categoría, resumen y enfocar su ubicación en el mapa.
   - Sustituidos los anchos rígidos `max-w-[200px]` / `max-w-[210px]` / `max-w-[220px]` en selectores de filtro y celdas de historial Speedtest por contenedores fluidos adaptables.
   - Internacionalización completa en los **31 idiomas europeos** (`33 columnas` en `./i18n/dictionary.csv`) para todas las claves nuevas (`network.traffic_ai_history_*` y `more.ai_fault_*`).

---

## 2. Resultados de Depuración y Verificación (`GEMINI.md` Regla 9)

- **Integridad de `./i18n/dictionary.csv`**: 33 columnas exactas en todas las filas, 0 claves duplicadas, 0 celdas vacías.
- **Compilación TypeScript Estricta**: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` → **0 errores, 0 símbolos sin usar**.
- **Compilación Python**: `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py` → **OK**.
- **Validación Reglas Firestore**: `npx eslint firestore.rules` → **0 errores**.
- **Build Producción Web (`npm run build`) y Paquete Debian (`bash packaging/build_deb.sh`)**: Generados y verificados con `v12.22.0` desde `./VERSION`.
- **Pruebas HTTP en Vivo (`:3000`)**:
  - `GET /api/version` → `12.22.0`
  - `GET /api/system/logs` → Devuelve `entries`, `failed_units`, `ai_fault_insights` y `ai_fault_history`.
  - `POST /api/system/logs/ai-simplify` → Simplifica avisos activos, clasifica `danger_level`, ofrece `solution` y deduplica en segundas consultas (`cached_hits > 0, new_queries == 0`).
  - `GET /api/net/history` → Devuelve `ai_insights` y catálogos dinámicos.
