# Plan de Implementación — v10.1.0: Certificados Zero-Trust por Dispositivo Físico y Agrupación de Clientes

## 1. Objetivo
Garantizar que los certificados de seguridad Zero-Trust (`HMAC-SHA256`) se emitan por **dispositivo físico** en lugar de generar certificados independientes por cada navegador o cliente abierto en el mismo dispositivo, y agrupar todos los contenedores/clientes de un mismo dispositivo físico bajo una única tarjeta de dispositivo en `#secZeroTrustDevicesSection` y `#trustDialog`.

## 2. Arquitectura Backend (`server.py`)
1. **Identificación Física Determinista (`compute_physical_device_key` y `resolve_arp_mac_for_ip`)**:
   - Resolución dinámica de dirección MAC desde `/proc/net/arp` para IPs LAN y `/sys/class/net/*/address` para el nodo local.
   - Normalización de IPs de loopback (`127.0.0.1`, `::1`, `localhost`) hacia la IP LAN real del servidor (`SERVER_LOCAL_IP`).
   - Cálculo de `physical_key` basado en MAC física, `hardware_id` nativo determinista o combinación `local_ip + os_family` (`linux`, `android`, `windows`, `macos`, `ios`).
2. **Emisión y Reutilización de Certificado por Dispositivo (`check_trust_status` y `/api/auth/register-device`)**:
   - Búsqueda previa de dispositivo físico existente mediante `find_device_by_id_or_physical()`.
   - Reutilización del certificado único del dispositivo (`dev_id` y `certificate_serial` con formato `ZT-XXXX-XXXX-XXXX`) cuando cualquier cliente del mismo equipo conecta.
   - Consolidación retrocompatible mediante `consolidate_devices_by_hardware()` y preservación de `alias_ids`.
3. **Agrupación de Clientes y Protección de Telemetría Nativa (`enrich_device_entry`)**:
   - Registro de cada contenedor cliente (`ubuntu_native`, `android_native`, `web_chrome`, `web_firefox`, `web_safari`, `web_edge`, etc.) en el array `clients` del dispositivo físico.
   - Protección de los datos profundos de hardware obtenidos por las Apps Nativas (`FULL_NATIVE_ACCESS`) para que no sean sobrescritos cuando el mismo equipo abre un navegador web (`WEB_SANDBOX`).
   - Soporte en `/api/auth/revoke` para desvincular un cliente individual (`client_key`) o revocar el certificado completo del dispositivo físico (`id`).

## 3. Interfaz Frontend y Reporte de Auditoría JSON (`index.html` y `static/index.html`)
1. **Huella Determinista en Navegador (`collectClientDeviceTelemetry`)**:
   - Eliminación de sufijos aleatorios `Date.now()` en `sysmon_hw_fingerprint` para producir identificadores deterministas por hardware (`hw_<hash>`).
2. **Visualización Agrupada en `#secZeroTrustDevicesSection`**:
   - Insignia de número de serie del certificado de equipo (`CERTIFICADO EQUIPO: ZT-...`) e indicador de clientes agrupados (`N CLIENTES AGRUPADOS`).
   - Bloque simétrico **"Clientes & Contenedores Agrupados bajo el Certificado"** dentro de cada tarjeta de dispositivo, mostrando cada cliente con su nivel de permiso (`FULL ACCESS` vs `SANDBOX`), estado activo, modo de conexión (`LAN`/`WAN`), última actividad y opción de desvinculación individual.
3. **Reporte JSON Enriquecido (`buildDeviceAuditPayload`)**:
   - Inclusión de `device_certificate` (`certificate_serial`, `certificate_scope: "PER_PHYSICAL_DEVICE"`, `physical_device_key`, `grouped_clients_count`) y `grouped_clients_on_device`.
