# Walkthrough: Identificación de Servicio por IP y Bloqueo Directo en Mapa (`v4.10.0`)

Este recorrido detalla la implementación de la nueva funcionalidad que permite visualizar a qué servicio se conecta cada dirección IP (tanto en flujos entrantes como salientes) y ofrece la capacidad de bloquear o desbloquear cualquier IP directamente desde el popup del mapa geoespacial o desde la tabla de conexiones de red mediante Fail2ban.

## 🎯 Cambios Implementados

### 1. Detección Enriquecida de Servicios y Procesos en el Backend (`server.py`)
- **Ampliación de `PORT_SERVICE_LABELS`**: Se incorporó un diccionario de puertos y servicios conocidos que abarca los servicios locales (Emby, Caddy, Nextcloud, Immich, Home Assistant, Pi-hole, qBittorrent, OpenSSH, ADB, Samba, Tor, Ollama, go2rtc, WireGuard/Tailscale, etc.).
- **Inspección Dinámica de Puertos en Escucha (`update_listening_ports_map`)**: Mediante `sudo ss -tulpn` y `psutil`, el backend asocia en tiempo real los puertos de escucha a los procesos del host (`sshd`, `caddy`, `EmbyServer`, `python3`, `pihole-FTL`, etc.) y a los contenedores Docker activos (`DOCKER_CACHE`).
- **Conexiones Entrantes y Salientes**:
  - Cada conexión del socket incluye ahora:
    - `service`: Nombre del servicio conectado (ej. *Emby Media Server (:8096)*, *Caddy Reverse Proxy (Web/HTTPS)*, *Google Cast / Chromecast (:8009)*, *Telegram API / Bot (:443)*).
    - `process`: Proceso del sistema o contenedor asociado.
    - `jail`: Jail sugerida para Fail2ban (`caddy-scan`, `sshd`, `nextcloud`).
    - `details`: Resumen descriptivo de la conexión.
- **Mejora en los Endpoints de Seguridad (`/api/fail2ban/ban` y `/api/fail2ban/unban`)**:
  - Soporte de rutas limpias (`clean_path`).
  - Capacidad de baneo global (`jail: 'all'`) o por jail específica.
  - Actualización inmediata en memoria de `SECURITY_CACHE` para que los bloqueos y desbloqueos se reflejen al instante en el mapa y en la tabla sin latencia.

### 2. Controles de Bloqueo y Visualización en Frontend (`static/index.html` e `index.html`)
- **Popup Interactivo en Leaflet Map (`NetworkConnectionsMapEngine.buildInfoWindowNode`)**:
  - Muestra el distintivo del servicio conectado y el proceso local ejecutor.
  - Integra un bloque interactivo de control de seguridad Fail2ban:
    - Si la IP no está bloqueada: selector de jail con pre-selección inteligente y botón `🚫 Bloquear IP en Fail2ban`.
    - Si la IP está bloqueada: indicador visual rojo y botón `🔓 Desbloquear IP en Firewall`.
    - Protección visual automática para IPs del servidor / locales.
- **Tabla de Flujos Geolocalizados (`#networkConnectionsTableList`)**:
  - Insignia prominente `badge-blue` con el nombre del servicio al que se conecta cada IP.
  - Botón de acción rápida `🚫 Bloquear` o `🔓 Desbloquear` en cada fila.
- **Funciones Globales**:
  - `window.blockIpDirectly(ip, jail, serviceName)`
  - `window.unblockIpDirectly(ip, jail)`
  - Confirmación preventiva y notificaciones mediante Toasts.

### 3. Versionado Semántico y Documentación
- Conforme a la Regla 5 (`0.X.0` al añadir una nueva función), la versión se incrementó a **`v4.10.0`**.
- Actualizados `VERSION`, `package.json` y `README.md`.

---

## 🧪 Verificación y Pruebas

- **Sintaxis Python**: `python3 -m py_compile server.py` exitoso.
- **Reinicio del Servicio**: `systemctl restart system-dashboard.service` ejecutado sin errores.
- **Endpoint `/api/version`**: Responde `version: 4.10.0`.
- **Endpoint `/api/metrics`**: `connections_map.connections` entrega campos `service`, `process`, `jail` y `details`.
