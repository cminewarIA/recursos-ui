# Plan de Implementación v4.14.0 — Terminal de Errores en Tiempo Real del Nodo Principal (Worker GeoIP & Red)

## 1. Objetivo
Implementar un componente de terminal interactivo en el **Nodo Principal** (`MainNodeErrorTerminal`) que capture, consolide y muestre en tiempo real los errores procedentes del **Worker GeoIP** (tanto del hilo/worker en cliente como del worker en segundo plano del servidor hacia `ip-api.com`) y de las **peticiones de red HTTP** (`fetch` no-2xx, timeouts y caídas de enlace), incorporando filtros por origen y un botón para **limpiar el historial de errores** (`🗑️ Limpiar historial`).

## 2. Arquitectura Técnica (100% Zero-Hardcoding)

### 2.1. Backend (`server.py` y `vite.config.ts`)
- **Buffer Circular de Errores (`GEOIP_ERROR_HISTORY`)**:
  - Almacena hasta `80` eventos de error recientes con metadatos dinámicos: `id`, `ts`, `iso`, `source` (`GEOIP_WORKER` / `NETWORK_REQ`), `stage`, `target`, `code` y `message`.
- **Instrumentación en Tiempo Real**:
  - `resolve_geoip_batch_from_ip_api()`: Captura respuestas HTTP `429` (Rate Limit de `ip-api.com`), errores HTTP inesperados (`status != 200`), entradas con `status: "fail"` devueltas por `ip-api.com/batch` y excepciones de red/timeout (`URLError`, `TimeoutError`).
  - `fetch_connections_geo_worker()`: Registra errores de autolocalización del nodo servidor (`self-geoip`), fallos de resolución DNS (`socket.gethostbyname`) y excepciones del bucle del worker.
- **Exposición y Limpieza**:
  - `get_geoip_worker_summary()` expone `errors_count` y `error_history` dentro de `connections_map.geoip_worker`.
  - Nuevo endpoint `POST /api/net/geoip/clear-errors` que vacía `GEOIP_ERROR_HISTORY` y restablece `GEOIP_WORKER_STATS["errors"] = 0`.

### 2.2. Frontend (`static/index.html` e `index.html`)
- **Módulo `MainNodeErrorTerminal` (`window.MainNodeErrorTerminal`)**:
  - **Interceptor `window.fetch`**: Mide la latencia en milisegundos (`performance.now()`) e intercepta códigos HTTP `>= 400`, `429`, timeouts (`AbortError`) y errores de red (`TypeError` / `NET_ERR`).
  - **Integración con `GeoIpBackgroundWorker`**:
    - El Web Worker en segundo plano emite mensajes `GEOIP_WORKER_ERROR` ante cualquier fallo de `/api/net/geoip/resolve` o `ip-api.com/batch`.
    - El hilo principal captura `worker.onerror`, fallos del fallback `fetchBatchMainThread` y sincroniza `geoip_worker.error_history` desde `/api/metrics` deduplicando por firma.
  - **Persistencia y Limpieza**:
    - Persistencia acotada en `localStorage` (`recursos_node_error_history_v1`, máx. 80 entradas).
    - Acción `clearHistory()` que limpia el estado local, el `localStorage`, invoca `POST /api/net/geoip/clear-errors` y actualiza instantáneamente todas las vistas y popups abiertos.
- **Puntos de Montaje Sincronizados en el Nodo Principal**:
  1. **Vista General (`/`)**: Terminal acoplada bajo el `.command-banner` del Nodo Principal (`#ovMainNodeErrorTerminalCard`) con botón de acceso directo y contador en vivo (`#ovNodeErrorTerminalToggleBtn`).
  2. **Vista Red (`/red`)**: Terminal integrada en la tarjeta del Mapa Mundial del Nodo Central (`#netMainNodeErrorTerminalCard`) con filtros por origen (*Todos*, *GeoIP Worker*, *Peticiones Red*) y botón `🗑️ Limpiar historial`.
  3. **Popup del Mapa Mundial (`🖥️ NODO CENTRAL DEL SERVIDOR`)**: Consola en tiempo real (`#srvPopupNodeErrorTerminalOutput`) y botón `🗑️ Limpiar historial` dentro del globo de inspección del servidor central.

## 3. Control de Versión (`VERSION` & `package.json`)
- Según la **Regla 5 de `GEMINI.md`**, al añadir una nueva funcionalidad/componente corresponde un incremento **`MINOR` (`0.X.0`)** con reinicio del tercer dígito a `0`:
  - Versión anterior: `4.13.1`
  - Nueva versión canónica: **`4.14.0`**
