# Plan de Implementación v12.2.0 — Historial Persistente de Consumo en SQLite Unificado (`recursos_history.db`) e Inspección Táctil con Retroceso Temporal

- **Versión**: `12.2.0` (`MINOR` per `GEMINI.md` Rule 2.4)
- **Fecha**: 2026-11-14

## 1. Unificación de Base de Datos SQLite (`geoip_history.db` → `recursos_history.db`)
- Se renombra el almacenamiento SQLite WAL principal a `recursos_history.db` (`RECURSOS_HISTORY_DB_FILE` en `server.py`), manteniendo migración automática de archivos legados `geoip_history.db` (incluidos `-wal` y `-shm`, o respaldo `sqlite3.backup`) para conservar íntegros los registros previos de ubicaciones GeoIP y conexiones por servicios.
- Se añade la tabla `telemetry_history` con índice `idx_telemetry_history_ts` sobre `ts DESC` para persistir muestras continuas de consumo: CPU (`%`), GPU (`%`), RAM (`%`), RAM total ocupada (`%`), Red RX/TX (`MB/s`), Lectura/Escritura de disco (`MB/s`) y Espacio en disco (`%`).
- Al arrancar (`run_server()`), `preload_telemetry_history_from_sqlite()` precarga las últimas 60 muestras en `HISTORY`, y `background_collector()` encola y guarda muestras periódicamente con poda acotada (7 días / 250.000 muestras).
- Actualizado `.gitignore` con `recursos_history.db*` y `telemetry_history_dev.json`.

## 2. API REST de Consulta Histórica (`GET /api/metrics/history`)
- Nuevo endpoint `GET /api/metrics/history` implementado en `server.py` (`query_telemetry_history_from_sqlite`) y en el middleware de desarrollo `vite.config.ts`.
- Soporta parámetros `before_ts`, `after_ts`, `window_sec` (`300`, `1800`, `7200`, `86400`, `all`) y `limit` (con submuestreo inteligente que preserva los picos reales cuando se consultan grandes ventanas temporales).

## 3. Inspección Táctil Interactiva con Retroceso Temporal Completo
- **`src/types/telemetry.ts`**: nuevos tipos `TelemetryMetricKey` y `TelemetryHistoryResponse`, además de `date_timestamps` y `epoch_ts` en `HistorySeries`.
- **`src/components/TelemetryChart.tsx`**: soporte para `metricKey`, etiquetas con fecha y hora completa (`dateTimestamps`), modo dual `Inspeccionar` vs. `Deslizar tiempo` (gesto táctil horizontal y rueda) y callback `onPanDeltaSteps`.
- **`src/components/OverviewView.tsx`, `src/components/EquipmentView.tsx` y `src/components/NetworkSecurityView.tsx`**: todas las gráficas de consumo (CPU, RAM, GPU, Almacenamiento y Red RX/TX) exponen su botón y gesto de expansión hacia la Pantalla de Inspección Táctil.
- **`src/components/ExpandedChartModal.tsx` y `src/App.tsx`**: nuevo modal simétrico con actualización en vivo, selector de ventanas (`En vivo`, `5 min`, `30 min`, `2 h`, `24 h`, `Todo`), botones táctiles (`Más antiguo`, `Retroceder`, `Avanzar`, `Volver a vivo`), deslizador cronológico sobre toda la historia registrada en `recursos_history.db` y tarjeta de estadísticas del tramo (`Mín`, `Med`, `Máx`).

## 4. Documentación, Empaquetado Debian y Despliegue
- Sincronizada la versión `12.2.0` en `VERSION`, `package.json`, `packaging/debian/control`, `README.md`, `docs/index.html`, `static/manual.html`, SVGs en `docs/assets/`, React y `plugin.json`.
- Compilación del paquete `.deb` firmado con GPG, instalación local y despliegue sincronizado en `/home/servidor/servicios/dashboard` (`:8085`).

