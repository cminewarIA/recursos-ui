# Plan de Implementación v4.18.0 — Integración Nativa Completa del Bot de Telegram en el Dashboard

Integrar por completo todo el código del bot de Telegram (`telegram_comic_bot.py`) dentro de la arquitectura del servidor web (`server.py`), de forma que se ejecute 100% integrado como hilos de trabajo nativos del proceso del dashboard (`system-dashboard.service`), sin delegaciones externas ni necesidad de servicios auxiliares independientes.

## Requisitos y Objetivos
1. **Integración Nativa en `server.py`**:
   - Incorporar las funciones de autenticación y lista blanca (`is_user_allowed`, `load_whitelist`, `save_whitelist`).
   - Incorporar las funciones de cliente Telegram (`tg_send_message`, `broadcast_to_whitelist`).
   - Incorporar el gestor de descargas qBittorrent (`qbit_add_torrent_file`, `qbit_add_magnet`, `qbit_get_torrents`).
   - Incorporar el monitor continuo de torrents completados (`monitor_torrents_loop` / `telegram_bot_monitor_worker`), que detecta descargas al 100% y emite la alerta a Telegram.
   - Incorporar el bucle principal de recepción de Telegram (`telegram_bot_polling_worker`), con soporte completo para:
     - Documentos `.torrent` (descarga binaria desde Telegram e inyección directa en qBittorrent).
     - Enlaces `magnet:` y URLs `.torrent`.
     - Comandos `/start`, `/help`, `ayuda`.
     - Comandos `/status`, `/lista`, `/descargas` (consulta en vivo de qBittorrent).
     - Comandos `/red`, `/dispositivos`, `/equipos` (estado de clientes LAN en tiempo real).
     - Comandos `/actualizar_red`, `/sync_red`, `/sync`.
2. **Telemetría y Control en Tiempo Real**:
   - Estado del bot accesible en `/api/metrics` bajo el campo `telegram_bot` (estado de polling, usuarios autorizados, descargas notificadas, último mensaje recibido, timestamp de salud).
   - Endpoint `/api/telegram_bot/test` para enviar mensaje de prueba desde la interfaz web.
3. **Tarjeta Visual en el Dashboard Frontend (`static/index.html` e `index.html`)**:
   - Visualización del estado del bot integrado (badge verde pulsante, estado de polling, estadísticas de mensajes y descargas).
4. **Desactivación de Servicio Externo (`telegram-comic-bot.service`)**:
   - Desactivar y detener `telegram-comic-bot.service` para evitar colisión de `getUpdates` (Telegram prohíbe múltiples clientes polling simultáneos con el mismo token).
5. **Cero Hardcoding y Compatibilidad de Rutas**:
   - Token configurable mediante variable de entorno `TELEGRAM_BOT_TOKEN` con fallback seguro.
   - Rutas de almacenamiento persistente (`telegram_bot_allowed_users.json`, `telegram_notified_torrents.json`) con resolución inteligente: `./data/` o `./` relativo al repositorio y fallback a `/home/servidor/scripts/` si existe.

## Cambios Propuestos

### Backend (`server.py`)
- Crear módulo/clase integrado `TelegramIntegratedBot` con:
  - Manejo de token, URLs de Telegram y API de qBittorrent.
  - Hilo de polling (`getUpdates` con control de excepciones y timeouts silenciosos).
  - Hilo de monitorización de torrents completados (`qBittorrent`).
  - Cache y telemetría de salud (`TELEGRAM_BOT_CACHE` y `TELEGRAM_BOT_LOCK`).
- En `run_server(port=8085)`:
  - Lanzar los dos hilos daemon del bot junto con el resto de workers (`fetch_wifi_worker`, `fetch_security_worker`, etc.).
- En `get_metrics()`:
  - Exponer `metrics["telegram_bot"]` con estadísticas en tiempo real.
- En `DashboardHTTPHandler`:
  - Manejar endpoints opcionales `/api/telegram_bot/ping` o similar para pruebas directas.

### Frontend (`static/index.html` y sincronizado en `index.html`)
- Añadir sección / tarjeta "🤖 Bot de Telegram Integrado" en la vista de Servicios o General:
  - Indicador de estado nativo (Activo / En línea).
  - Destinatarios autorizados y torrents vigilados.
  - Botón interactivo para enviar ping de prueba a Telegram.

### Sistema y Servicios
- Detener y deshabilitar `telegram-comic-bot.service` (`sudo systemctl stop telegram-comic-bot.service && sudo systemctl disable telegram-comic-bot.service`).
- Reiniciar `system-dashboard.service`.

### Control de Versión y Documentación
- `VERSION` -> `4.18.0` (Regla 5: incremento `MINOR` por adición de nueva funcionalidad).
- `package.json` -> `4.18.0`.
- `README.md` -> Documentar la integración nativa del bot de Telegram en el backend del dashboard.
- `planes/walkthrough_v4.18.0.md` -> Registro detallado de pruebas y verificación.

## Plan de Verificación
1. **Pruebas Automatizadas de Sintaxis y Arranque**:
   - Validar sintaxis con `python3 -m py_compile server.py`.
   - Reiniciar `system-dashboard.service` y comprobar estado con `systemctl is-active`.
2. **Prueba de Polling Telegram**:
   - Verificar logs en `journalctl -u system-dashboard.service` que muestren el arranque de los dos hilos del bot.
   - Comprobar que `/api/metrics` devuelva `telegram_bot.running == True`.
3. **Prueba Funcional del Bot**:
   - Enviar `/status` o test ping y verificar respuesta inmediata.
4. **Prueba de la Interfaz Web**:
   - Validar con Google Chrome headless que el dashboard carga y la nueva tarjeta del bot renderiza correctamente.
