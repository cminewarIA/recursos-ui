# Plan de Implementación: Corrección escapeHtml y Retirada de Edición en DuckDNS (v2.3.1)

## 1. Objetivos de la Tarea

1. **Definición de `escapeHtml`**:
   - Resolver el error `ReferenceError: escapeHtml is not defined` en el visor de registros de DuckDNS y en las tablas de telemetría DNS.
   - Definir una función global `escapeHtml(str)` segura y ligera que sanitice caracteres HTML (`&`, `<`, `>`, `"`, `'`).
2. **Eliminación de la Edición de DuckDNS**:
   - Retirar la opción de edición en la tarjeta de credenciales de DuckDNS.
   - Retirar el botón de editar en la sección de dominios adicionales y sustituir el texto por una aclaración de solo lectura / gestión directa en `duck.sh`.
   - Eliminar el modal HTML `#duckConfigModal` y las funciones JavaScript asociadas (`openDuckConfigModal`, `closeDuckConfigModal`, `saveDuckDnsConfigFromModal`).
   - Retirar el endpoint `POST /api/dns/duckdns/config` y la función `save_duckdns_config()` de `server.py` por motivos de seguridad y robustez.
3. **Mantenimiento y Control de Versión**:
   - Incrementar la versión en [`VERSION`](file:///home/servidor/servicios/dashboard/VERSION) de `2.3.0` a `2.3.1`.
   - Sincronizar [`package.json`](file:///home/servidor/servicios/dashboard/package.json).
   - Actualizar [`README.md`](file:///home/servidor/servicios/dashboard/README.md).
   - Generar walkthrough y confirmar cambios en GitHub (`git push`).

---

## 2. Archivos Afectados

- `static/index.html` e `index.html`: Definición de `escapeHtml`, retirada de modal y botones de edición.
- `server.py`: Eliminación de endpoint y helper de modificación de `duck.sh`.
- `VERSION` y `package.json`: Salto de versión semántica a `2.3.1`.
- `README.md`: Reflejo de DuckDNS como visor/monitor de solo lectura.
- `planes/`: Documentación del plan y verificación.
