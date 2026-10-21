# Plan de Implementación: Identificación de Servicio por IP y Bloqueo Directo desde el Mapa (`v4.10.0`)

Permitir al usuario ver con claridad qué servicio se está conectando con cada IP (tanto en conexiones entrantes como salientes) en la pestaña de redes, y dotar al mapa geoespacial y a la tabla de conexiones de un menú interactivo para bloquear o desbloquear IPs en tiempo real en el firewall del sistema (Fail2ban IPS).

## 📌 Contexto y Objetivos

1. **Identificación de Servicio por IP**:
   - Actualmente, algunas conexiones muestran únicamente el puerto o una etiqueta genérica.
   - Se requiere identificar con precisión a qué servicio local se conectan las IPs entrantes (por ejemplo, *Emby Media Server*, *Caddy Reverse Proxy / HTTPS*, *SSH Daemon*, *qBittorrent*, *Home Assistant*, *Immich*, *Pi-hole DNS*) y hacia qué servicio externo o destino van las salientes (*Google Cast / Smart TV*, *Telegram API*, *GitHub CDN*, *Samba*, etc.), incluyendo el proceso local involucrado (*EmbyServer*, *caddy*, *sshd*, *chrome*, *tailscaled*, etc.).
2. **Acción de Bloqueo / Desbloqueo Directo**:
   - Al pulsar sobre cualquier nodo o conexión en el mapa geoespacial (OpenStreetMap), el popup desplegará los detalles del servicio y controles directos para bloquear la IP en Fail2ban (con selección inteligente de jail: `caddy-scan`, `sshd`, `nextcloud`, `recidive`).
   - Si la IP ya estuviera bloqueada, se ofrecerá la opción de desbloquearla con 1 clic.
   - Se incorporará además un botón de acción rápida en la tabla interactiva de conexiones geolocalizadas.
3. **Control Estricto de Versiones**:
   - Al tratarse de una nueva función para el usuario, según la Regla 5 de `GEMINI.md`, se incrementará la versión a **`4.10.0`** (`0.X.0`).

---

## 🛠️ Cambios Propuestos

### Backend (`server.py`)

#### [MODIFY] [server.py](file:///home/servidor/servicios/dashboard/server.py)
- **Mapeo Avanzado de Puertos y Servicios (`KNOWN_PORTS` / `PORT_SERVICE_LABELS`)**:
  - Ampliar el diccionario de puertos para reconocer todos los servicios instalados (Emby, Caddy, Nextcloud, Immich, Home Assistant, Pi-hole, qBittorrent, SSH, Samba, Google Cast, Tuya IoT, Ollama, go2rtc, WireGuard/Tailscale, etc.).
- **Detección Dinámica de Procesos y Contenedores**:
  - Función de inspección de puertos en escucha y sockets activos (`psutil` + mapeo de procesos/contenedores Docker desde `DOCKER_CACHE`).
  - Resolución enriquecida para conexiones salientes: vinculación del proceso local (p. ej. `chrome`, `tailscaled`, `python3`) con el servicio de destino (DNS, Cast, SMB, CDN, APIs).
- **Mejoras en el Endpoint `/api/fail2ban/ban`**:
  - Selección inteligente de jail automática según el puerto/servicio (p. ej. puerto 22 -> `sshd`, 80/443 -> `caddy-scan`, otros -> `nextcloud` o `all`).
  - Protección de seguridad para impedir bloquear la IP local del servidor (`127.0.0.1`, `SERVER_LOCAL_IP`).
  - Respuesta detallada en JSON para notificación inmediata en frontend.

---

### Frontend (`static/index.html` e `index.html`)

#### [MODIFY] [static/index.html](file:///home/servidor/servicios/dashboard/static/index.html) e [index.html](file:///home/servidor/servicios/dashboard/index.html)
- **Popup Interactivo del Mapa (`NetworkConnectionsMapEngine.buildInfoWindowNode`)**:
  - Sección destacada con el **Servicio Conectado** y proceso responsable.
  - Bloque de control de seguridad Fail2ban:
    - Selector rápido de jail (o predeterminado inteligente según el servicio).
    - Botón `🛡️ Bloquear IP en Firewall` con confirmación y ejecución asíncrona.
    - Si la IP está en estado bloqueado: botón `🟢 Desbloquear IP`.
    - Feedback inmediato mediante Toasts del sistema y actualización reactiva de métricas y mapa.
- **Tabla de Flujos Geolocalizados (`#networkConnectionsTableList`)**:
  - Resaltado prominente del servicio conectado para cada IP.
  - Botón de acción rápida `🛡️ Bloquear` / `Desbloquear` en cada fila.
- **KPIs y Filtros de Red**:
  - Mostrar los principales servicios detectados en las tarjetas de conexiones entrantes y salientes.

---

### Documentación y Versión

#### [MODIFY] [VERSION](file:///home/servidor/servicios/dashboard/VERSION)
- Incrementar a `4.10.0`.

#### [MODIFY] [package.json](file:///home/servidor/servicios/dashboard/package.json)
- Sincronizar versión a `4.10.0`.

#### [MODIFY] [README.md](file:///home/servidor/servicios/dashboard/README.md)
- Añadir sección `## ✨ Novedades en v4.10.0` detallando la identificación de servicios y el bloqueo directo desde el mapa.

#### [NEW] `planes/2026-10-21_servicio_por_ip_y_bloqueo_en_mapa.md` y `planes/implementation_plan.md`
- Almacenar este plan en la carpeta obligatoria `planes/`.

---

## 🧪 Plan de Verificación

### Pruebas Automatizadas y de Backend
1. Ejecutar script de prueba en Python para comprobar la resolución de servicios y procesos en sockets activos.
2. Probar llamada al endpoint `/api/fail2ban/ban` y `/api/fail2ban/unban` con IP de prueba no crítica y verificar la respuesta y estado en Fail2ban.
3. Verificar reinicio del servicio `system-dashboard.service` sin fallos.

### Pruebas de Interfaz y Frontend
1. Consultar `/api/version` y verificar `version: 4.10.0`.
2. Verificar que en la pestaña de redes se listen los servicios claramente para cada conexión entrante y saliente.
3. Comprobar que al hacer clic en un marcador del mapa se abre el popup con el servicio conectado y el botón interactivo de bloqueo.
4. Probar la interactividad de bloqueo/desbloqueo y comprobar la aparición del toast de confirmación.
