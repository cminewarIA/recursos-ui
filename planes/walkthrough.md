# Recorrido y Verificación: Gestor DuckDNS, Telemetría de Tráfico DNS por IP y Corrección de Navegación (v2.3.0)

Se han corregido los fallos en la detección de DNS y redirección de navegación, y se ha integrado completamente la gestión de **DuckDNS**, sus registros en vivo y la telemetría de **tráfico DNS / peticiones por cliente IP** directamente en el dashboard.

---

## 1. Problemas Resueltos

### A. Corrección de "Detectando DNS..." permanente
- **Causa**: `lblSidebarDomain` y `ovPublicDomainBadge` tenían valores de texto fijos ("Detectando DNS...") que no eran actualizados en JavaScript.
- **Solución**: En `applyMetricsToDOM` (`static/index.html` e `index.html`) se incorporó la actualización reactiva del dominio público detectado (`data.sys.public_domain`), asociando además el enlace directo a la vista `/dns`.

### B. Corrección de Enrutamiento y Salto a "Vista General"
- **Causa**: Al hacer clic en los enlaces o botones de versión (`btnHeaderVersion`, `ovVersionCard`, `lblSidebarDomain`), se invocaba `navigateTo(event, 'system')` con `href="/sistema"`. Al no existir la vista `'system'` en el mapeo `PATH_TO_VIEW`, el router web caía en el fallback por defecto (`'overview'`).
- **Solución**:
  - Se mapearon explícitamente los botones a `'version'` (`href="/version"`).
  - Se añadieron alias tolerantes en `PATH_TO_VIEW`: `'/sistema': 'version'`, `'system': 'version'`.
  - Se añadieron `/dns` y `/duckdns` al mapa de rutas válidas en backend (`server.py`) y en el frontend.

---

## 2. Nueva Funcionalidad: Módulo DNS y DuckDNS Integrado (`/dns`)

Se implementó una vista dedicada completa de **DNS & Dominios Dinámicos** accesible desde `/dns` o mediante el nuevo acceso directo en la barra lateral (`navDns`):

### A. Panel de Control DuckDNS
- **Estado Dinámico**: Muestra el subdominio configurado (`cminewar.duckdns.org`), el token enmascarado (`41ea****...****e1e0`), la última IP pública sincronizada y el último heartbeat.
- **Actualización Inmediata**: Botón *"Forzar Actualización Ahora"* que ejecuta de forma no bloqueante `/home/servidor/servicios/duckdns/duck.sh` mediante el endpoint `POST /api/dns/duckdns/update`.
- **Configurador Seguro**: Modal interactivo para modificar el subdominio y token de DuckDNS (`POST /api/dns/duckdns/config`), con copia de seguridad automática (`duck.sh.bak`).

### B. Visor de Logs en Tiempo Real
- Lector de `/mnt/almacenamiento/logs/duckdns/duck.log` (`GET /api/dns/logs`).
- Resaltado de sintaxis (OK, ERROR, HEARTBEAT), botón de recarga manual e interruptor de auto-refresco en vivo cada 10 segundos.

### C. Telemetría de Tráfico DNS por Dispositivo / IP
- Conexión no bloqueante a SQLite de Pi-hole FTL (`/etc/pihole/pihole-FTL.db?mode=ro`).
- **Filtro por Cliente**: Permite seleccionar cualquier dispositivo de la red local con su nombre amigable de host o dirección IP.
- **Estadísticas de Tráfico**: Contador total de consultas, solicitudes bloqueadas por el sinkhole de Pi-hole y porcentaje de protección.
- **Top Dominios por IP**: Identificación de los servicios más consultados por cada dispositivo.
- **Registro en Vivo**: Tabla de las últimas consultas DNS (hora, cliente, dominio solicitado, estado de resolución y servidor de destino).

---

## 3. Endpoints Implementados en Backend ([server.py](file:///home/servidor/servicios/dashboard/server.py))

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/dns/duckdns` | Devuelve estado, subdominio, token enmascarado y fecha de última IP de DuckDNS. |
| `POST` | `/api/dns/duckdns/update` | Fuerza la ejecución inmediata de `duck.sh`. |
| `POST` | `/api/dns/duckdns/config` | Actualiza de forma segura el subdominio y token en `duck.sh`. |
| `GET` | `/api/dns/logs` | Devuelve las últimas líneas de `/mnt/almacenamiento/logs/duckdns/duck.log`. |
| `GET` | `/api/dns/traffic` | Analiza las consultas de `pihole-FTL.db` y las agrupa por cliente e IP. |

---

## 4. Control de Versiones y Cumplimiento de Reglas

1. **Regla 1 (git pull)**: Verificado e integrado antes de iniciar.
2. **Regla 2 (git push)**: Cambios listos para commit y push a `cminewarIA/recursos-ui` en rama `main`.
3. **Regla 3 (planes/)**: Todos los planes y walkthroughs almacenados en `/home/servidor/servicios/dashboard/planes/`.
4. **Regla 4 (README.md)**: Actualizado con la nueva sección 7 y endpoints de DNS.
5. **Regla 5 (VERSION)**:
   - Versión anterior: `2.2.0`
   - Versión nueva: `2.3.0` (actualizado en [`VERSION`](file:///home/servidor/servicios/dashboard/VERSION) y [`package.json`](file:///home/servidor/servicios/dashboard/package.json)).

---

## 5. Pruebas de Verificación Realizadas

1. **Estado de DuckDNS vía API**:
   ```bash
   curl -s http://127.0.0.1:8085/api/dns/duckdns
   # Devuelve installed: true, domain: "cminewar", last_registered_ip: "193.125.199.55"
   ```
2. **Actualización Forzada vía API**:
   ```bash
   curl -s -X POST http://127.0.0.1:8085/api/dns/duckdns/update
   # Ejecuta duck.sh con código de retorno 0 y actualiza heartbeat
   ```
3. **Logs en Vivo vía API**:
   ```bash
   curl -s http://127.0.0.1:8085/api/dns/logs
   # Devuelve las últimas 80 líneas del archivo duck.log
   ```
4. **Tráfico DNS por IP (Pi-hole FTL)**:
   ```bash
   curl -s http://127.0.0.1:8085/api/dns/traffic
   # Lee pihole-FTL.db devolviendo clientes locales (192.168.50.149, etc.), top dominios y queries recientes
   ```
5. **Navegación e Integridad de Rutas**:
   - `/dns`, `/version`, `/sistema` probados contra el servidor web con respuesta HTTP 200.
   - Botón de Versión y badge de Dominio en la interfaz dirigen ahora correctamente a sus respectivas vistas sin volver a la Vista General.
