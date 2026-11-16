# Plan de Implementación v12.16.1 — Depuración Integral Multi-Capa y Validación en 3 Ciclos Consecutivos

**Versión objetivo**: `./VERSION` (`12.16.1`, incremento `PATCH`)  
**Criterio de aceptación**: 3 ciclos consecutivos de auditoría y pruebas integrales con cero errores.

---

## Alcance Auditado y Correcciones Aplicadas

1. **Backend Python (`server.py`, `i18n_catalog.py`, `desktop_app/recursos_app.py`)**
   - Envoltorio `try ... finally` para el cierre garantizado de todas las conexiones SQLite (`recursos_history.db`, `geoip_history.db`, `pihole-FTL.db`, `gravity.db`, `fail2ban.sqlite3`, `library.db` de Emby) evitando fugas de descriptores y bloqueos ante excepciones.
   - Cierre incondicional en `finally` del socket UDP SSDP dentro de `_discover_gateway_upnp_info()`.
   - Acotamiento de `_METRICS_SERIALIZED_CACHE["variants"]` (máximo 64 entradas activas por secuencia) para prevenir crecimiento ilimitado de RAM en rotaciones de tokens.
   - Limpieza de importación no utilizada (`collections`) en `desktop_app/recursos_app.py`.

2. **Frontend React / TypeScript y Diccionario CSV (`src/`, `i18n/dictionary.csv`)**
   - `NetworkDevicesModal.tsx`: separación entre recarga manual (con spinner) y refresco periódico silencioso (cada 5,5 s), guarda de ciclo de vida (`mountedRef`), fallback consistente para `speed_down`/`speed_up` en el filtro de tráfico activo y eliminación de literales fijos (`Gateway`, `ASUS`) en favor de `t(...)` y metadatos dinámicos.
   - `OverviewView.tsx` y `EquipmentView.tsx`: formateo horario dinámico según el `locale` activo en lugar de `'es-ES'` estático.
   - `i18n/dictionary.csv`: sustitución de marca fija en `overview.db_source_asus` (`Router Wi-Fi / Mesh`) y adición de `overview.db_source_router_short` (`Router`).

3. **Middleware Dev (`vite.config.ts`), Manual y Empaquetado**
   - Paridad del objeto `summary` en `/api/network/devices-db` (`vite.config.ts`) respecto a `WifiSummary` de producción.
   - Sincronía exacta entre `static/manual.html` y `docs/index.html` con etiqueta neutra en diagrama SVG (`Router Wi-Fi / Mesh`).
   - Incremento de `./VERSION` a `12.16.1`, compilación de frontend (`npm run build` -> `dist/` y `static/index.html`), sincronía en `README.md` y construcción/verificación del paquete `.deb`.
