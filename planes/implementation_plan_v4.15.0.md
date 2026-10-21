# Plan de Implementación v4.15.0: Corrección de Fallos y Deadlock GeoIP, Limpieza de Logs Invasivos y Rediseño Integral del README

El usuario solicita:
1. *"la interfas ahora muestra logs revisa que son los fallos que muestra y arreglalo"*: Diagnosticar y corregir la causa raíz de los fallos que se muestran en pantalla, y limpiar la interfaz para que no aparezcan volcados de logs ni terminales invasivas.
2. *"y a google ia estudio le pedi que hiciera un nuevo readme y hico una mierda mira su plan de implementacion y aver si lo haces mejor"*: Google AI Studio generó un README con formato de "presentación interactiva Keynote de 10 diapositivas con notas de orador", el cual resultó inadecuado. Reemplazarlo por un README técnico, exhaustivo, profesional y de primer nivel para GitHub y la comunidad.

---

## 1. Diagnóstico de los Fallos en la Interfaz

Tras investigar el código introducido en los commits `2dabf91` y `1901ecd`, se identificó la causa exacta de los problemas:

### Causa Raíz 1: Deadlock Catastrófico en `GEOIP_LOCK` (`server.py`)
- En `server.py` línea 207, `GEOIP_LOCK = threading.Lock()` es un cerrojo simple **no reentrante**.
- En la función `resolve_geoip_batch_from_ip_api()` (línea 537), el hilo adquiere `with GEOIP_LOCK:`.
- Si una IP del lote falla o no obtiene respuesta (líneas 577 y 583), se llama a `record_geoip_worker_error()`.
- Dentro de `record_geoip_worker_error()` (línea 252), se vuelve a ejecutar `with GEOIP_LOCK:`.
- **Resultado:** **Autobloqueo inmediato (Deadlock)**. El hilo del worker queda congelado eternamente esperando por su propio candado. A partir de ese segundo, cualquier petición que consulte GeoIP (incluyendo `/api/net/geoip/resolve` en `do_POST` y las métricas de red) se congela y sufre un `timeout`.

### Causa Raíz 2: Interceptor Global Invasivo de `window.fetch` (`static/index.html`)
- En `static/index.html` (líneas 10146-10219), AI Studio sobreescribió `window.fetch` a nivel global.
- Al producirse los timeouts provocados por el deadlock (o cualquier código HTTP >= 400), el interceptor volcaba instantáneamente mensajes de error en rojo en componentes visibles en la pantalla principal.

### Causa Raíz 3: Inyección de Terminales Invasivas en Vista General y Red
- En la pantalla principal (`#ovMainNodeErrorTerminalCard`) y en la vista de red (`#netMainNodeErrorTerminalCard`), se incrustaron tarjetas de consola de logs que rompen el diseño limpio de cristal (*Liquid Glass*).

### Causa Raíz 4: Petición Insegura desde el Navegador a `http://ip-api.com/batch`
- En el Web Worker (línea 9561), si el backend fallaba por el deadlock, el navegador intentaba llamar directamente a `http://ip-api.com/batch`. En conexiones HTTPS (DuckDNS/Caddy), el navegador bloqueaba la petición de inmediato por *Mixed Content / CORS*, arrojando `NET_ERR: Failed to fetch`.

---

## 2. Cambios Propuestos

### Componente 1: Backend (`server.py`)
- **Eliminar el Deadlock**:
  - Cambiar `GEOIP_LOCK = threading.Lock()` a `threading.RLock()` (candado reentrante).
  - En `record_geoip_worker_error`, evitar re-adquirir candados innecesarios y proteger el buffer circular de errores de forma segura y sin bloqueos cruzados.
- **Autorización Robusta en `/api/net/geoip/resolve`**:
  - Permitir peticiones legítimas del propio dashboard (LAN local, localhost, sesiones emparejadas con cookie `_sysmon_trust` o header `X-Device-Token`) sin retornar 403.
- **Limpieza de Errores Acumulados**:
  - Vaciar el historial acumulado en el servidor mediante `clear_geoip_worker_errors()`.

### Componente 2: Frontend (`static/index.html` e `index.html`)
- **Limpieza de UI**:
  - Retirar las tarjetas visibles de logs `#ovMainNodeErrorTerminalCard` y `#netMainNodeErrorTerminalCard` de las pantallas principales para restaurar la interfaz limpia y elegante.
  - Retirar el botón de toggle `#ovNodeErrorTerminalToggleBtn` de la cabecera.
- **Desactivar el Interceptor Global Ruidoso**:
  - Desactivar o silenciar el monkey-patching agresivo de `window.fetch` para que las peticiones ordinarias no ensucien el DOM con mensajes de error.
- **Eliminar Peticiones Inseguras del Worker**:
  - Eliminar el fallback del cliente a `http://ip-api.com/batch`, delegando la resolución exclusivamente en el backend Python (que ya cuenta con caché en disco, control de rate limit y sin problemas de CORS ni contenido mixto).
  - Pasar credenciales (`credentials: 'include'`) y cabecera de autenticación si existe en las llamadas del Web Worker.
- **Sincronización**:
  - Copiar `static/index.html` a `index.html`.

### Componente 3: Rediseño Total del `README.md`
- **Eliminar por completo el formato de 10 diapositivas Keynote con notas de orador**.
- **Crear un README de nivel profesional para GitHub y producción**:
  1. **Hero Section de Alto Impacto**: Insignias oficiales, descripción clara del Cockpit, tecnologías y capturas/diagrama ASCII panorámico.
  2. **Arquitectura del Sistema**: Diagrama Mermaid de flujo desacoplado (Kernel Linux, `conntrack`, `pihole-FTL.db`, `fail2ban-client`, Caddy, Leaflet, D3.js).
  3. **Características Principales en Profundidad**:
     - *Telemetría de Hardware*: CPU por núcleo, frecuencias dinámicas, temperaturas `/sys`, RAM + ZRAM, GPU heterogénea, almacenamiento e I/O.
     - *Mapa Mundial GeoIP 100% Libre*: OpenStreetMap + Leaflet (sin Google Maps ni costes de API), clustering dinámico multinivel, persistencia de popups en 5 niveles.
     - *Monitor de Conexiones Pi-hole DNS*: Rastreo de dispositivos del hogar (`tv`, consolas, móviles) y sus destinos WAN en tiempo real.
     - *Ciberdefensa Activa IPS*: Bloqueo/Desbloqueo en 1-clic con Fail2ban e iptables, cárceles e historial.
     - *Visualización de Ancho de Banda con D3.js*: Gráficos de anillo animados e interpolados, alertas por umbral en NICs.
     - *Seguridad Zero-Trust*: Emparejamiento LAN automático y validación criptográfica HMAC-SHA256 para accesos WAN.
     - *Filosofía 100% Zero-Hardcoding*: Cero valores fijos, derivación dinámica total de hardware, red y geolocalización.
  4. **Catálogo de Vistas SPA (12 pantallas)** y **Referencia Completa de Endpoints REST API**.
  5. **Guía de Instalación y Despliegue**: Prerrequisitos, servicio systemd, Caddy reverse proxy, DuckDNS y variables de entorno.
  6. **Historial de Versiones Canónico** (`v4.0.0` a `v4.15.0`).

### Componente 4: Control de Versión y Reglas del Proyecto
- Actualizar `./VERSION` a `4.15.0` (Regla 5: incremento MINOR por retiro de componente invasivo de la UI y ajuste arquitectónico).
- Sincronizar `./package.json`.
- Guardar el plan y walkthrough en `planes/implementation_plan_v4.15.0.md` y `planes/walkthrough_v4.15.0.md` (Regla 3).
- Commit y `git push origin main` (Regla 2).

---

## 3. Plan de Verificación

### Pruebas Automatizadas y de Backend
- Reiniciar `system-dashboard.service` con `sudo systemctl restart system-dashboard.service`.
- Probar endpoint `/api/net/geoip/resolve` con `curl` verificando respuesta HTTP 200 en milisegundos (confirmando que no hay deadlock ni cuelgue).
- Probar endpoint `/api/metrics` verificando que `geoip_worker` responde correctamente con `errors_count: 0`.
- Validar sintaxis de `server.py` con `python3 -m py_compile server.py`.

### Pruebas de Interfaz y Frontend
- Cargar la interfaz web y verificar que la Vista General y la Vista de Red están completamente limpias de tarjetas de logs o mensajes de error en rojo.
- Comprobar que el mapa y los dispositivos siguen funcionando de forma fluida.
- Revisar que el nuevo `README.md` se renderiza de forma óptima en Markdown.
