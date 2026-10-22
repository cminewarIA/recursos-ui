# Walkthrough v4.18.0 — Integración Nativa del Bot de Telegram en el Backend

## Objetivo Completado
Se ha integrado por completo todo el código del bot de Telegram (`telegram_comic_bot.py`) directamente dentro del servidor web del dashboard (`server.py`), ejecutándose de forma 100% nativa dentro del proceso de `system-dashboard.service`. Se eliminó la dependencia de scripts independientes o servicios externos.

---

## Cambios Realizados

### 1. Backend (`server.py`)
- **Importación y Configuración**:
  - Incorporación de `requests` para las llamadas HTTP/HTTPS a la API oficial de Telegram y qBittorrent.
  - Configuración vía variables de entorno (`TELEGRAM_BOT_TOKEN`, `QBIT_API_URL`, `QBIT_SAVE_PATH`) con fallbacks seguros.
- **Rutas de Persistencia Resilientes**:
  - Función `_resolve_tg_data_file` que comprueba rutas relativas al proyecto y fallback a `/home/servidor/scripts/` para mantener compatibilidad con `telegram_bot_allowed_users.json` y `telegram_notified_torrents.json`.
- **Hilos de Ejecución Daemon**:
  - `telegram_bot_polling_worker`: Long-polling de `getUpdates` con gestión silenciosa de `requests.exceptions.Timeout`, control de reconexión y procesamiento de:
    - Archivos `.torrent` (descarga binaria y transferencia a qBittorrent).
    - Enlaces magnet y URLs directas.
    - Comandos `/start`, `/help`, `/status`, `/red`, `/actualizar_red`.
  - `telegram_bot_monitor_worker`: Vigilancia cada 10s de descargas en qBittorrent; envía alertas automáticas a la lista blanca al completarse un torrent.
- **Telemetría y Endpoints REST**:
  - `TELEGRAM_BOT_CACHE` integrado en `background_collector` y expuesto en `/api/metrics` y `/api/telegram_bot`.
  - Nuevo endpoint `POST /api/telegram_bot/test` para enviar mensajes de prueba desde la interfaz web.
- **Arranque Integrado**:
  - Hilos iniciados en `run_server(port=8085)`.

### 2. Frontend (`static/index.html` e `index.html`)
- **Tarjeta Interactiva del Bot**:
  - Ubicada en la vista de Aplicaciones (`viewApps`), mostrando estado en vivo, sondeo, usuarios autorizados, torrents notificados y estado de qBittorrent.
  - Botón interactivo "📨 Enviar Ping de Prueba" que se comunica con `/api/telegram_bot/test` mediante tokens Zero-Trust.

### 3. Sistema y Control de Versión
- Desactivación y detención de `telegram-comic-bot.service` (`systemctl stop & disable`) para evitar colisiones de `getUpdates`.
- Versión actualizada a `v4.18.0` (`MINOR`) en `VERSION`, `package.json` y `README.md`.

---

## Verificación Realizada

1. **Compilación de Sintaxis**:
   `python3 -m py_compile server.py` -> Exitoso sin errores.
2. **Reinicio de Servicio**:
   `sudo systemctl restart system-dashboard.service` -> Activo y en ejecución.
3. **Comprobación de Métricas**:
   `/api/metrics` y `/api/telegram_bot` devuelven el estado del bot integrado con `polling_active: true`.
4. **Verificación de Inactividad de Servicio Externo**:
   `telegram-comic-bot.service` inactivo y deshabilitado.
