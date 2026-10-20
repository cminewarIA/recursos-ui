# Recorrido y Verificación: Corrección de escapeHtml y Modo Protegido de DuckDNS (v2.3.1)

En esta actualización se solventó el error de ejecución de JavaScript al cargar los registros en vivo y se configuró DuckDNS en modo protegido de solo lectura, retirando la capacidad de edición remota.

---

## 1. Problemas Atendidos y Soluciones

### A. Corrección de `ReferenceError: escapeHtml is not defined`
- **Diagnóstico**: La función `loadDuckDnsLogs()` y el renderizado de la tabla de consultas DNS invocaban `escapeHtml(line)` y `escapeHtml(q.domain)` para prevenir inyecciones HTML en el visor, pero la función no estaba definida en el contexto global de JavaScript. Esto provocaba que el bloque `try/catch` capturara la excepción e imprimiera en la terminal de logs:
  `Error al cargar registros: ReferenceError: escapeHtml is not defined`
- **Solución**: Se implementó una función global `escapeHtml(str)` al inicio del script en `static/index.html` e `index.html`:
  ```javascript
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  ```
  Ahora los registros de `duck.log` y las consultas DNS de Pi-hole FTL se renderizan y colorean correctamente sin errores en consola.

---

### B. Retirada de la Edición de DuckDNS (Modo Protegido / Solo Lectura)
- **Diagnóstico**: La edición de subdominios y tokens desde la web exponía a posibles desconfiguraciones accidentales del script central del servidor (`duck.sh`).
- **Solución**:
  1. **Frontend**:
     - Se eliminó el botón de edición (`Editar ✏️`) de la tarjeta *Token & Script*. Ahora muestra la insignia *"Solo Lectura"*.
     - Se eliminó el botón `⚙️ Editar Dominios en DuckDNS` de la sección inferior, reemplazando el texto por una indicación de que las credenciales están aseguradas en el script local (`/home/servidor/servicios/duckdns/duck.sh`) y enlazando únicamente al panel oficial externo de DuckDNS.
     - Se eliminó el modal dialog `#duckConfigModal`.
     - Se suprimieron las funciones JS `openDuckConfigModal`, `closeDuckConfigModal` y `saveDuckDnsConfigFromModal`.
  2. **Backend ([server.py](file:///home/servidor/servicios/dashboard/server.py))**:
     - Se eliminó la función `save_duckdns_config()`.
     - Se eliminó el endpoint `POST /api/dns/duckdns/config`. Cualquier llamada ahora devuelve `404 Not Found`.
  3. **Funcionalidades Mantenidas**:
     - El botón **"⚡ Forzar Actualización DuckDNS"** sigue activo para sincronizar manualmente la IP pública cuando se desee.
     - La visualización de registros en vivo (`duck.log`) y la telemetría de tráfico por IP de Pi-hole FTL continúan funcionando a la perfección.

---

## 2. Verificación Realizada

1. **Prueba de escapeHtml y visualización de logs**:
   ```bash
   curl -s http://127.0.0.1:8085/api/dns/logs
   ```
   Devuelve los registros JSON limpios. Las pruebas de carga en cliente confirman que los registros se procesan y renderizan en `<pre id="duckDnsLogsPre">` con sus colores sintácticos sin saltar al bloque de excepción.
2. **Endpoint de configuración deshabilitado**:
   ```bash
   curl -s -X POST http://127.0.0.1:8085/api/dns/duckdns/config
   # Respuesta: Not Found (404)
   ```
3. **Versión Semántica Activa**:
   ```bash
   curl -s http://127.0.0.1:8085/api/version
   # Confirma "version": "2.3.1"
   ```
4. **Estado del Servicio**:
   `system-dashboard.service` activo y sin errores en el journal.
