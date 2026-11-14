# Plan de Implementación v12.2.1 — Blindaje de `recursos_history.db` en Instalación y Actualizaciones

- **Versión**: `12.2.1` (`PATCH` per `GEMINI.md` Rule 2.4)
- **Fecha**: 2026-11-14

## 1. Blindaje de Base de Datos en `server.py`
- `_resolve_recursos_history_db_path()`: detecta de forma dinámica y portable la ubicación persistente de `recursos_history.db` (`RECURSOS_HISTORY_DB_PATH` si está configurada, `BASE_DIR` si ya contiene DB o es escribible, o `/var/lib/recursos-cockpit` como respaldo en instalaciones de solo lectura).
- `init_geoip_history_db()`: guard idempotente que no reinicializa una base de datos ya abierta y únicamente crea tablas/índices faltantes (`IF NOT EXISTS`) sin alterar ni borrar datos acumulados.
- `record_telemetry_sample_to_sqlite()`: sustituido `INSERT OR REPLACE` por `INSERT ... ON CONFLICT(ts) DO UPDATE SET ...` para actualización estrictamente incremental.

## 2. Empaquetado Debian y Creación al Instalar (`packaging/`)
- `packaging/build_deb.sh`: exclusión explícita (`find "$PKG_DIR" ... -delete`) de cualquier archivo `.db`, `-wal`, `-shm`, `telemetry_history_dev.json` o `nic_history_2h.json` dentro del `.deb`, garantizando que `dpkg` / `apt` nunca sobrescriba una base de datos existente.
- `packaging/debian/postinst`: descubre dinámicamente `WorkingDirectory` del servicio (`systemctl show`) o usa `/var/lib/recursos-cockpit`; si `recursos_history.db` aún no existe en la instalación inicial, la crea con todas sus tablas (migrando `geoip_history.db` si existía) y ajusta propietario; si ya existe con todas las tablas, sale en modo solo lectura sin modificar ni una fila.
- `packaging/debian/postrm`: protege `recursos_history.db` en actualizaciones y desinstalaciones.

