# Walkthrough & Verificación — v10.1.0: Certificados por Dispositivo Físico y Agrupación de Clientes

## 1. Resumen de Cambios Realizados
- **Emisión de Certificados por Dispositivo Físico (`server.py`)**:
  - Se implementaron `resolve_arp_mac_for_ip()`, `normalize_lan_ip()`, `normalize_hardware_id()`, `extract_os_family()`, `extract_client_descriptor()`, `compute_physical_device_key()`, `generate_certificate_serial()`, `consolidate_devices_by_hardware()` y `find_device_by_id_or_physical()`.
  - Cuando múltiples clientes del mismo dispositivo físico (por ejemplo, la App Nativa Ubuntu `.deb` o Android `.apk` junto con navegadores Chrome/Firefox/Safari) se conectan al servidor, comparten un **único certificado de dispositivo físico** (`ZT-XXXX-XXXX-XXXX`) y se agrupan automáticamente dentro de la propiedad `clients` del dispositivo.
  - Se protege la telemetría profunda de hardware de las Apps Nativas (`FULL_NATIVE_ACCESS`) frente a sesiones en navegadores web (`WEB_SANDBOX`) del mismo equipo.
- **Visualización Agrupada y Auditoría JSON (`index.html` y `static/index.html`)**:
  - En `#secZeroTrustDevicesSection` y `#trustDialog`, cada tarjeta representa un **dispositivo físico único** con su insignia `CERTIFICADO EQUIPO: ZT-...`, indicador `PERMISO: FULL ACCESS` / `PERMISO: SANDBOX`, contador `N CLIENTES AGRUPADOS` y el panel detallado de todos los clientes/contenedores vinculados a ese dispositivo.
  - Se añadió soporte para desvincular un contenedor cliente individual (`revokeDeviceClient`) cuando un equipo tiene múltiples clientes registrados, o revocar el certificado completo del dispositivo (`revokeDevice`).
  - El reporte descargable en JSON (`downloadDeviceAuditReport`) incluye ahora el bloque `device_certificate` (`certificate_scope: "PER_PHYSICAL_DEVICE"`) y la lista `grouped_clients_on_device`.
- **Sincronización Canónica de Versión (`10.1.0`)**:
  - Actualizados `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.

## 2. Verificación Técnica
- Validación de sintaxis Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`).
- Compilación e instalación del paquete Debian canónico `dist/recursos-cockpit_10.1.0_amd64.deb` mediante `bash packaging/build_deb.sh`.
- Ejecución de `/usr/bin/recursos-cockpit --test-mode` y verificación con `lint_applet` y `compile_applet`.
