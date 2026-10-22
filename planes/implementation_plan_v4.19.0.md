# Plan de Implementación v4.19.0 — Panel de Ajustes, Emisor y Registro de Mensajes del Bot de Telegram

## Descripción del Problema & Requerimiento
El usuario consulta: *"y tiene su panel de ajustes donde ver lo que manda o algo ?"*
Actualmente, el bot de Telegram se ejecuta de forma nativa en segundo plano dentro de `server.py`, pero la interfaz web solo cuenta con una tarjeta básica de telemetría y un botón de ping. No dispone de:
1. Un registro o visor de mensajes donde auditar exactamente qué envía el bot a Telegram ("lo que manda": alertas de descargas completadas, resúmenes de red, respuestas a comandos, notificaciones) y qué recibe (comandos, magnets, archivos `.torrent`).
2. Un panel de ajustes donde gestionar la lista blanca de usuarios autorizados (añadir/quitar administradores), configurar opciones de notificación (activar/pausar avisos de descargas) y emitir mensajes personalizados directamente a Telegram desde el navegador.

---

## Revisión del Usuario Requerida
> [!NOTE]
> Este cambio no altera la estabilidad ni la lógica del bot integrado en `server.py`; añade un buffer circular de auditoría en memoria (últimos 100 eventos) y nuevos controles en la interfaz web para inspeccionar y configurar el bot con comodidad.

---

## Cambios Propuestos

### Backend (`server.py`)
1. **Buffer de Auditoría en Memoria (`TELEGRAM_ACTIVITY_LOG`)**:
   - Registro cronológico de mensajes salientes (alertas completadas, respuestas a comandos, pings, difusiones) y entrantes (comandos `/status`, `/red`, magnets, documentos `.torrent`).
   - Cada entrada contiene: `id`, `ts`, `time_str`, `direction` (`out` / `in`), `type`, `target`, `user_name`, `title`, `content`, `status`.
2. **Registro Automático de Actividad**:
   - Interceptar `tg_send_message`, `broadcast_to_tg_whitelist` y el bucle de polling para registrar cada mensaje enviado y recibido.
3. **Endpoints de Control & Configuración**:
   - `GET /api/telegram_bot/activity`: Devuelve el historial de mensajes, la lista de usuarios autorizados y las preferencias.
   - `POST /api/telegram_bot/send`: Permite redactar y emitir un mensaje personalizado desde el dashboard a todos los administradores de Telegram.
   - `POST /api/telegram_bot/whitelist/add`: Añade un ID de usuario a la lista blanca.
   - `POST /api/telegram_bot/whitelist/remove`: Elimina un ID de usuario de la lista blanca.
   - `POST /api/telegram_bot/config`: Guarda preferencias (activar/desactivar notificaciones de descargas completadas).

### Frontend (`static/index.html` e `index.html`)
1. **Expansión de la Sección `#secTelegramBot`**:
   - Añadir selector por pestañas dentro del panel del bot:
     - **`📨 Historial de Mensajes`**: Visor dinámico con burbujas de mensajes que muestra exactamente el texto que manda el bot (alertas de qBittorrent, respuestas de red, pings) con fecha, hora y destinatario.
     - **`⚙️ Ajustes & Admins`**: Gestión visual de usuarios autorizados (añadir/eliminar IDs) y conmutadores de notificaciones.
     - **`📢 Enviar Mensaje`**: Caja de redacción con botón para difundir anuncios o avisos a Telegram desde el panel.
2. **Sincronización Reactiva**:
   - Actualización periódica del registro de actividad junto con las métricas del sistema.

### Control de Versión & Documentación
- `VERSION` -> `4.19.0` (`MINOR`: adición de panel de ajustes y visor de mensajes).
- `package.json` -> `4.19.0`.
- `README.md` -> Documentar el nuevo visor de mensajes y panel de ajustes del bot.
- `planes/walkthrough_v4.19.0.md` -> Documentar pruebas y verificación.

---

## Plan de Verificación
1. **Sintaxis Backend**: `python3 -m py_compile server.py`.
2. **Reinicio de Servicio**: `sudo systemctl restart system-dashboard.service`.
3. **Prueba de Endpoints**:
   - Verificar `GET /api/telegram_bot/activity`.
   - Probar `POST /api/telegram_bot/send` para verificar que el mensaje se envía a Telegram y aparece inmediatamente en el registro de "lo que manda".
4. **Prueba Frontend**: Google Chrome headless para confirmar que los tabs y el visor de mensajes renderizan sin errores.
