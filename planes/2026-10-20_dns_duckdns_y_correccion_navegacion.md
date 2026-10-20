# Plan de Implementación: Corrección de Navegación, Detección DNS y Módulo de Gestión DuckDNS & Tráfico DNS por IP

Este plan aborda la resolución de los fallos de redirección y detección DNS reportados, e implementa el nuevo módulo integrado de administración de **DuckDNS**, logs en vivo y monitorización de **tráfico DNS / servicios por IP**.

## 1. Diagnóstico de los Problemas Reportados

### A. Fallo de "Detectando DNS..." permanente
- **Causa**: Los elementos HTML `ovPublicDomainBadge` (tarjeta cabecera) y `lblSidebarDomain` (sidebar) tenían textos estáticos `"Detectando DNS..."` y `"Detectando..."`, pero en JavaScript (`applyMetricsToDOM`) no existía ningún bloque que actualizara sus valores con el dominio detectado (`sys.public_domain`).

### B. Botón de GitHub y Dominio vuelven a la "Vista General"
- **Causa**: Varios botones y enlaces (`btnHeaderVersion`, `lblSidebarDomain`, `ovPublicDomainBadge`, `ovVersionCard`) utilizaban `onclick="return navigateTo(event, 'system')"` y `href="/sistema"`.
- En el enrutador (`switchView`): `allViews` contiene `'version'`, pero no `'system'`.
- Al buscar `PATH_TO_VIEW['/system']`, devolvía `undefined`, activando el fallback por defecto a `'overview'`. Por este motivo, al pulsar sobre cualquiera de estos botones, la interfaz siempre retornaba a la Vista General.

### C. Módulo DuckDNS, Configuración, Logs y Tráfico por IP
- El sistema cuenta con `/home/servidor/servicios/duckdns/duck.sh`, un cron en ejecución cada 5 minutos, y logs en `/mnt/almacenamiento/logs/duckdns/duck.log`.
- Se requiere integrarlo directamente en una nueva vista web (`/dns`), permitiendo:
  - Ver y editar la configuración de DuckDNS (dominio, token, etc.).
  - Botón de actualización manual inmediata de DuckDNS.
  - Visor de log en tiempo real con auto-refresco.
  - Opción de añadir y gestionar dominios/DNS adicionales.
  - Monitorización de tráfico DNS y servicios accedidos por cada IP de la red mediante lectura de `/etc/pihole/pihole-FTL.db`.

---

## 2. Cambios Propuestos

### Componente 1: Backend ([server.py](file:///home/servidor/servicios/dashboard/server.py))
1. **Rutas Web**:
   - Añadir `/dns` y `/duckdns` a `VALID_WEB_ROUTES`.
2. **Endpoints de API**:
   - `GET /api/dns/duckdns`: Lee la configuración de `duck.sh`, `last_ip.txt` y última línea de `duck.log`.
   - `POST /api/dns/duckdns/update`: Ejecuta la actualización manual de DuckDNS y refresca la IP.
   - `POST /api/dns/duckdns/config`: Permite guardar cambios en el dominio/token de DuckDNS.
   - `GET /api/dns/logs`: Devuelve las últimas 60 líneas de `duck.log`.
   - `GET /api/dns/traffic`: Lee de `/etc/pihole/pihole-FTL.db` para extraer:
     - Top clientes/IPs con desglose de dominios y servicios accedidos.
     - Registro en vivo de las últimas consultas DNS (timestamp, IP, dominio, estado y upstream).

---

### Componente 2: Frontend ([static/index.html](file:///home/servidor/servicios/dashboard/static/index.html) e [index.html](file:///home/servidor/servicios/dashboard/index.html))
1. **Corrección de Enrutamiento y Navegación**:
   - Enlazar correctamente los botones a `navigateTo(event, 'version')` con `href="/version"`.
   - Añadir alias `'system': 'version'` y `'/sistema': 'version'` en `PATH_TO_VIEW` para que ningún enlace roto redirija por error a `'overview'`.
2. **Corrección de Detección DNS**:
   - Actualizar dinámicamente `lblSidebarDomain` y `ovPublicDomainBadge` con el dominio detectado en `applyMetricsToDOM`.
3. **Nueva Vista `/dns` ("DNS & Dominios Dinámicos")**:
   - Añadir pestaña en el sidebar con icono y badge de estado.
   - Panel de control de DuckDNS: Estado, IP pública detectada vs IP en DuckDNS, token, botón de actualización forzada.
   - Visor de logs en vivo de DuckDNS.
   - Panel de Tráfico DNS por IP: Selector/filtro por dispositivo de la red, listado de servicios accedidos y registro de peticiones en tiempo real.

---

### Componente 3: Documentación y Versión ([VERSION](file:///home/servidor/servicios/dashboard/VERSION), [GEMINI.md](file:///home/servidor/servicios/dashboard/GEMINI.md), [README.md](file:///home/servidor/servicios/dashboard/README.md))
- Incrementar la versión de `2.2.0` a `2.3.0` (Regla 5).
- Guardar planes en `planes/` (Regla 3).
- Actualizar `README.md` (Regla 4).
- Confirmar y hacer `git push` a GitHub (Regla 2).

---

## 3. Plan de Verificación

### Pruebas Automatizadas y de Endpoints
- `curl -s http://127.0.0.1:8085/api/dns/duckdns` -> Verificar respuesta JSON con dominio y estado.
- `curl -s http://127.0.0.1:8085/api/dns/traffic` -> Verificar lectura de SQLite de Pi-hole con clientes y consultas.
- `curl -s -X POST http://127.0.0.1:8085/api/dns/duckdns/update` -> Verificar ejecución de actualización de DuckDNS.

### Pruebas de Interfaz
- Verificar que pulsar el botón de GitHub o Versión abre directamente la vista `/version` sin volver a la Vista General.
- Verificar que el badge de DNS muestra el dominio real (`cminewar.duckdns.org`) en lugar de "Detectando DNS...".
- Verificar que la nueva ruta `/dns` carga los controles de DuckDNS, el log y la tabla de tráfico DNS por IP.
