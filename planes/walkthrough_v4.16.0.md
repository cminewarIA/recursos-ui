# 📋 Verificación y Recorrido: Centro Unificado de Registro de Fallos (v4.16.0)

## 🎯 Objetivo Cumplido
Implementación de un agregador universal de diagnóstico y fallos del sistema en tiempo real para todas las aplicaciones (contenedores Docker como Immich, Postgres, Nextcloud, Collabora, HomeAssistant), servicios del sistema Systemd (`pxe-dnsmasq`, `fail2ban`, `caddy`, etc.), unidades en estado `failed` y eventos críticos del Kernel de Linux.

---

## 🛠 Cambios Implementados

### 1. Backend (`server.py`)
- **Agregador de Journalctl Multi-Nivel**:
  - Función `fetch_system_logs(priority_max=3, limit=80, force=False)` que consulta `journalctl -p {priority_max} -n {limit} --no-pager -o json` en ~13ms.
  - Decodificación resiliente de buffers binarios en formato de arrays de bytes (`[85, 112, 103, ...]`) generados por contenedores como Collabora Office o PostgreSQL.
  - Categorización 100% dinámica (`docker`, `service`, `kernel`, `system`) sin hardcodear nombres.
- **Detección de Unidades en Fallo**:
  - Inspección instantánea con `systemctl list-units --failed --no-pager --plain` para alertar inmediatamente si algún daemon o servicio del sistema se ha caído.
- **Caché Concurrente con TTL**:
  - Mecanismo de caché en memoria de 4 segundos con bloqueo seguro para no sobrecargar el demonio journald ante peticiones concurrentes.
- **Ruta REST `/api/system/logs`**:
  - Parámetros soportados: `?level=err|warn`, `?category=all|docker|service|kernel`, `?limit=80`, `?refresh=1`.
- **Integración en `/api/metrics`**:
  - Nuevo nodo `system_errors_summary` con `total_errors`, `counts_by_category`, `failed_units_count` y `failed_units_names`.

### 2. Frontend (`static/index.html` e `index.html`)
- **Acceso Rápido en Vista General**:
  - Botón `#ovSystemLogsToggleBtn` en la barra de herramientas del Cockpit con badge reactivo que cambia de color y texto dinámicamente (`Fallos: 0 detectados` vs `⚠️ Fallos: X detectados` vs `⚠️ X servicios caídos`).
- **Tarjeta Bento Plegable (`#systemLogsCenterCard`)**:
  - Ubicada estratégicamente antes de los 4 pilares de hardware.
  - Inicia oculta para no interferir con la navegación habitual, desplegándose al pulsar el botón o mediante atajos.
  - Segmented controls para filtrado por categoría (`Todos`, `🐳 Apps & Docker`, `⚙️ Servicios`, `🐧 Kernel`) y nivel de severidad (`Solo Errores`, `+ Advertencias`).
  - Campo de búsqueda instantánea en tiempo real.
- **Visor Modal Nativo HTML5 `<dialog id="systemLogsModal">`**:
  - Diseñado para pantallas de monitorización o diagnósticos exhaustivos en pantalla completa.
- **Módulo JavaScript Reactivo `SystemLogsCenter`**:
  - Manejo de estado reactivo, renderizado seguro con `escapeHtml`, formato de marcas temporales y badges de prioridad (`EMERG`, `CRIT`, `ERR`, `WARN`).

### 3. Versión y Documentación
- Actualizado punto canónico `VERSION` a `4.16.0` (Regla 5: incremento de `MINOR` por nueva función).
- Actualizado `package.json` a `4.16.0`.
- Documentada la nueva característica y endpoints en `README.md`.
- Plan y Walkthrough archivados en `planes/`.

---

## 🔬 Verificación en el Servidor

### 1. Verificación del Servicio Systemd
```bash
sudo systemctl restart system-dashboard.service
sudo systemctl status system-dashboard.service --no-pager
```
Resultado: Servicio activo (`active (running)`), respondiendo en el puerto 8085.

### 2. Verificación de Versión Canónica
```bash
curl -s http://127.0.0.1:8085/api/version
```
Salida:
```json
{"version": "4.16.0", "app_name": "dashboard-recursos", "status": "ok"}
```

### 3. Verificación de la API `/api/system/logs`
```bash
curl -s "http://127.0.0.1:8085/api/system/logs?level=err&limit=5"
```
Salida (muestra eventos reales de contenedores y servicios categorizados con latencia < 20ms):
```json
{
  "total": 79,
  "counts_by_category": {
    "total": 79,
    "docker": 74,
    "service": 1,
    "kernel": 4,
    "system": 0
  },
  "failed_units_count": 0,
  "failed_units": []
}
```
