# Walkthrough v12.16.1 — Depuración Integral Multi-Capa y 3 Ciclos Consecutivos Limpios

**Versión**: `12.16.1` (`./VERSION`, incremento `PATCH`)  
**Fecha de verificación**: 2026-11-16  
**Estado**: Validado sin errores en **3 ciclos consecutivos** completos.

---

## 1. Hallazgos y Correcciones Aplicadas

### Backend Python (`server.py`, `desktop_app/recursos_app.py`)
- **Cierre garantizado de conexiones SQLite (`server.py`)**: Las 21 llamadas `sqlite3.connect(...)` distribuidas entre la inicialización de historial, caché GeoIP, consultas Pi-hole (`pihole-FTL.db`, `gravity.db`), biblioteca Emby (`library.db`) y base Fail2ban quedan protegidas dentro de bloques `try ... finally` con `.close()`, evitando fugas de descriptores o bloqueos WAL ante excepciones.
- **Cierre de socket SSDP/UPnP (`server.py`)**: El socket UDP utilizado en `_discover_gateway_upnp_info()` cierra siempre dentro de `finally: sock.close()`.
- **Acotamiento de caché en memoria (`server.py`)**: `_METRICS_SERIALIZED_CACHE["variants"]` limita sus variantes por secuencia a un máximo de 64 entradas para prevenir crecimiento ilimitado de RAM con clientes/tokens rotativos.
- **Limpieza en app nativa Linux (`desktop_app/recursos_app.py`)**: Eliminada la importación sin uso `import collections`.

### Frontend React/TypeScript, i18n CSV y Documentación (`src/`, `i18n/dictionary.csv`, `static/manual.html`, `docs/index.html`, `vite.config.ts`)
- **Modal de dispositivos (`src/components/NetworkDevicesModal.tsx`)**:
  - Agregada guarda `mountedRef` para ignorar respuestas asíncronas tardías tras el desmontaje.
  - Separado el refresco manual (`silent = false`) del sondeo en segundo plano cada 5,5 s (`silent = true`) para evitar parpadeos de spinner.
  - Alineado el filtro de tráfico activo con fallback consistente (`wan_speed_down ?? speed_down`, `wan_speed_up ?? speed_up`).
  - Reemplazados literales fijos `'Gateway'` y `'ASUS'` por `t('overview.db_source_gateway')` y `{summary.asus_model || t('overview.db_source_router_short')}`.
- **Formateo horario dependiente del idioma (`src/components/OverviewView.tsx`, `src/components/EquipmentView.tsx`)**: Sustituido `'es-ES'` fijo por `locale === 'es' ? 'es-ES' : locale`.
- **Diccionario y etiqueta neutra (`i18n/dictionary.csv`)**: Neutralizado `overview.db_source_asus` (`Router Wi-Fi / Mesh`) y añadida la clave `overview.db_source_router_short` (`Router`), cumpliendo Cero-Hardcoding (Regla 1 y Regla 8).
- **Paridad Dev (`vite.config.ts`)**: Añadidos `router_lan_rx_bytes_sec`, `router_lan_tx_bytes_sec`, `router_traffic_source` y `pihole_db_total` al resumen de `/api/network/devices-db`.
- **Manual y README (`static/manual.html`, `docs/index.html`, `README.md`)**: Sincronía exacta del diagrama SVG (`Router Wi-Fi / Mesh`) y actualización del capítulo de arquitectura a `v12.16.1`.

---

## 2. Resultado de los 3 Ciclos Consecutivos de Depuración

Cada ciclo ejecutó íntegramente sin modificaciones intermedias:
1. Compilación bytecode Python (`server.py`, `i18n_catalog.py`, `desktop_app/recursos_app.py`).
2. Auditoría AST de `server.py` (21+ `sqlite3.connect` protegidos en `try...finally .close()` y cierre `sock.close()` en UPnP).
3. Validación CSV (`i18n/dictionary.csv`, UTF-8 sin duplicados ni marcas fijas), coherencia `./VERSION == 12.16.1` y paridad exacta `static/manual.html == docs/index.html`.
4. Pruebas E2E en vivo contra servidor Vite (`:3000`): `/api/version`, `/api/metrics`, `/api/network/devices-db`, y ciclo `POST /api/fail2ban/ban` → `unban`.
5. Pruebas E2E aisladas sobre `server.py`: `init_geoip_history_db`, escritura/lectura SQLite (`record_telemetry_sample_to_sqlite` + `query_telemetry_history_from_sqlite`), `build_unified_devices_database` y servidor HTTP real `DashboardHTTPHandler` con compresión `gzip` (`/api/version`, `/api/dictionary`, `/api/metrics/history`).
6. Validación sintáctica de scripts shell (`bash -n`).
7. TypeScript estricto (`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`), lint (`npm run lint`) y build de producción (`npm run build`).
8. Verificación del paquete `.deb` (`dist/recursos-cockpit_12.16.1_amd64.deb`: metadatos + inclusión de `VERSION`, `i18n/dictionary.csv`, `i18n_catalog.py`, `static/index.html`, `static/manual.html`) y modo prueba Ubuntu nativo (`desktop_app/recursos_app.py --test-mode`).

| Ciclo | Resultado | Salida clave |
|---|---|---|
| Ciclo 1/3 | Superado | `PY_E2E_OK`, Vite build limpio, `=== PASS 1/3 CLEAN ===` |
| Ciclo 2/3 | Superado | `PY_E2E_OK`, Vite build limpio, `=== PASS 2/3 CLEAN ===` |
| Ciclo 3/3 | Superado | `PY_E2E_OK`, Vite build limpio, `=== PASS 3/3 CLEAN ===` |
