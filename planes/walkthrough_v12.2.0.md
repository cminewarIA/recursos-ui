# Walkthrough — v12.2.0: Base de Datos Unificada `recursos_history.db` e Inspección Táctil con Retroceso Temporal

## 1. Cambios Realizados
- **Unificación y Migración de Base de Datos SQLite ([`server.py`](../server.py), [`.gitignore`](../.gitignore))**:
  - Renombrada la base de datos unificada a `recursos_history.db` (`RECURSOS_HISTORY_DB_FILE`), conservando alias interno y ejecutando `_migrate_legacy_geoip_db_if_needed()` al arrancar para migrar automáticamente `geoip_history.db` (incluidos `-wal` y `-shm` o mediante `sqlite3.backup`) sin perder los registros de geolocalización y conexiones.
  - Creada la tabla `telemetry_history` + índice `idx_telemetry_history_ts` para almacenar de forma continua cada muestra de `cpu`, `gpu`, `ram`, `ram_total`, `net_rx`, `net_tx`, `disk_r`, `disk_w` y `disk_pct` con buffering, poda acotada cada `60s` (hasta 7 días / 250.000 muestras) y precarga automática al iniciar (`preload_telemetry_history_from_sqlite()`).
- **Endpoint de Historial de Consumo ([`server.py`](../server.py), [`vite.config.ts`](../vite.config.ts))**:
  - Añadido `GET /api/metrics/history` con parámetros `before_ts`, `after_ts`, `window_sec` (`300`, `1800`, `7200`, `86400`, `all`) y `limit`, aplicando submuestreo con conservación de picos para consultas de larga duración.
- **Pantalla de Inspección Táctil Histórica (`React 19 + Canvas HiDPI`)**:
  - [`src/types/telemetry.ts`](../src/types/telemetry.ts): definidos `TelemetryMetricKey`, `TelemetryHistoryResponse` y marcas temporales `date_timestamps` / `epoch_ts`.
  - [`src/components/TelemetryChart.tsx`](../src/components/TelemetryChart.tsx): soporte para tooltips con fecha y hora completa (`dateTimestamps`), conmutación entre inspección punto a punto (`inspect`) y deslizamiento horizontal en el tiempo (`pan`) más navegación con rueda.
  - [`src/components/ExpandedChartModal.tsx`](../src/components/ExpandedChartModal.tsx) y [`src/App.tsx`](../src/App.tsx): modal ampliado simétrico con actualización en directo (`En vivo`), selectores rápidos (`5 min`, `30 min`, `2 h`, `24 h`, `Todo`), botones táctiles (`Más antiguo`, `Retroceder`, `Avanzar`, `Volver a vivo`), deslizador cronológico de todo el historial en `recursos_history.db` y tarjeta resumen de mínimo/media/máximo.
  - [`src/components/OverviewView.tsx`](../src/components/OverviewView.tsx), [`src/components/EquipmentView.tsx`](../src/components/EquipmentView.tsx) y [`src/components/NetworkSecurityView.tsx`](../src/components/NetworkSecurityView.tsx): habilitada la expansión hacia el historial completo desde las gráficas de Inicio, Equipo y Red (CPU, RAM, GPU, Disco y Tráfico de red).
- **Sincronización de Versión `12.2.0` (`MINOR`) y Documentación**:
  - Actualizados [`VERSION`](../VERSION), [`package.json`](../package.json), [`packaging/debian/control`](../packaging/debian/control), [`src/App.tsx`](../src/App.tsx), [`src/components/MoreView.tsx`](../src/components/MoreView.tsx), [`src/utils/formatters.ts`](../src/utils/formatters.ts), [`docs/assets/hero-banner.svg`](../docs/assets/hero-banner.svg), [`docs/assets/cockpit-ui-preview.svg`](../docs/assets/cockpit-ui-preview.svg), [`docs/index.html`](../docs/index.html), [`static/manual.html`](../static/manual.html), [`README.md`](../README.md) y `plugin.json`.

## 2. Verificaciones Ejecutadas
- `python3 -m py_compile server.py`: **OK**.
- `tsc --noEmit && vite build`: **0 errores TypeScript, bundle compilado en `513 ms`**.
- `bash packaging/build_deb.sh` y `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.2.0_amd64.deb`: **OK (`dpkg -l` → `12.2.0`, firma GPG `4CFC86D58E9146AE`)**.
- `/usr/bin/recursos-cockpit --test-mode`: **`[OK] Recursos Native Ubuntu HTML5 App v12.2.0 validated successfully.`**.
- Despliegue en `/home/servidor/servicios/dashboard` (`system-dashboard.service` activo):
  - Migración automática verificada: `/home/servidor/servicios/dashboard/geoip_history.db` → `recursos_history.db` (`65M`) conservando **`358.062` filas en `geoip_locations`**, **`5.001` filas en `connection_history`** y registrando muestras continuas en **`telemetry_history`**.
  - `GET /api/version` devuelve `"current_version": "12.2.0"`, `"display_version": "12.2.0"`, `"installed_deb_version": "12.2.0"`.
  - `GET /api/metrics/history?window_sec=3600&limit=120` y `?window_sec=all&limit=120` responden `HTTP 200` con `ok: true` y todas las series históricas.
  - `GET /manual` responde `HTTP 200`.

