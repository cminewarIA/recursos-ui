# Walkthrough — v12.2.1: Blindaje de `recursos_history.db` en Instalación y Actualizaciones

## 1. Cambios Realizados
- **[`server.py`](../server.py)**:
  - Añadida resolución portátil `_resolve_recursos_history_db_path()` (`RECURSOS_HISTORY_DB_PATH` → `BASE_DIR` si contiene DB o es escribible → `/var/lib/recursos-cockpit`).
  - Guard idempotente en `init_geoip_history_db()` para evitar re-inicializar un archivo SQLite ya abierto, utilizando exclusivamente `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
  - Sustituido `INSERT OR REPLACE` por `INSERT ... ON CONFLICT(ts) DO UPDATE SET ...` en `record_telemetry_sample_to_sqlite()` y añadido comentario protector en `perform_auto_update_and_install()`.
- **[`packaging/build_deb.sh`](../packaging/build_deb.sh), [`packaging/debian/postinst`](../packaging/debian/postinst) y [`packaging/debian/postrm`](../packaging/debian/postrm)**:
  - `build_deb.sh` elimina cualquier archivo `*.db`, `*.db-wal`, `*.db-shm`, `telemetry_history_dev.json` o `nic_history_2h.json` del árbol del `.deb` antes de empaquetar.
  - `postinst` detecta dinámicamente el directorio activo del servicio (`systemctl show -p WorkingDirectory --value system-dashboard.service`) o `/var/lib/recursos-cockpit`: si `recursos_history.db` no existe todavía, la crea con las tres tablas (`geoip_locations`, `connection_history`, `telemetry_history`) y ajusta propietario al dueño del directorio; si ya existe con las tres tablas, la verifica en modo solo lectura (`?mode=ro`) y sale sin tocar ni una sola fila.
  - `postrm` nunca borra `recursos_history.db` en actualizaciones o desinstalaciones.
- **Sincronización `12.2.1` (`PATCH`)**: actualizados [`VERSION`](../VERSION), [`package.json`](../package.json), [`packaging/debian/control`](../packaging/debian/control), [`README.md`](../README.md), [`docs/index.html`](../docs/index.html), [`static/manual.html`](../static/manual.html), [`docs/assets/`](../docs/assets/hero-banner.svg), React y `plugin.json`.

## 2. Verificaciones Ejecutadas
- `dpkg-deb -c dist/recursos-cockpit_12.2.1_amd64.deb | grep -E '\.db|history\.json'`: **0 archivos `.db` ni cachés dentro del `.deb`**.
- `tsc --noEmit && vite build`: **0 errores, compilado en `470 ms`**.
- `/usr/bin/recursos-cockpit --test-mode`: **`[OK] Recursos Native Ubuntu HTML5 App v12.2.1 validated successfully.`**.
- Prueba real de no-sobrescritura al actualizar el paquete `.deb` y el servicio `:8085`:
  - Antes: `inode: 1049392`, `uid:gid: 1000:1000`, `telemetry_rows: 154`, `conn_rows: 5043`.
  - Después de `apt-get install --reinstall -y ./dist/recursos-cockpit_12.2.1_amd64.deb` + despliegue + `systemctl restart system-dashboard.service`:
  - Después: **`inode: 1049392`** (archivo intacto), **`uid:gid: 1000:1000`**, **`telemetry_rows: 163`**, **`conn_rows: 5054`**.
- `GET /api/version` → `12.2.1` (`installed_deb_version: 12.2.1`), `GET /api/metrics/history` → `ok: True, total_samples: 163`.

