# Walkthrough v9.5.0 — Indicador de Permisos Zero-Trust (Full Access vs Sandbox) y Exportación de Auditoría JSON

## Resumen de Cambios
1. **Indicador Visual de Permisos (`Full Access` vs `Sandbox`) en `#secZeroTrustDevicesSection`**:
   - Se actualizaron los filtros segmentados (`Todos`, `🔓 Full Access`, `🔒 Sandbox`) y el indicador KPI de permisos (`X Full · Y Sandbox`).
   - En cada tarjeta de dispositivo (`buildDeviceIdentityCardHtml`) se incorporó tanto el badge de cabecera (`🔓 PERMISO: FULL ACCESS` / `🔒 PERMISO: SANDBOX`) como un bloque visual de auditoría de permisos que detalla el anillo de privilegio (`Puente Nativo GTK3/WebKit2 o Kotlin/Android` vs `Aislamiento de Navegador Web`) y las capacidades habilitadas o restringidas.
2. **Exportación de Reporte de Auditoría Completo en Formato JSON**:
   - Se añadió en la cabecera de `#secZeroTrustDevicesSection` el selector interactivo `#secSelectedAuditDevice` junto al botón `📥 Descargar Reporte JSON`, sincronizado al hacer clic sobre cualquier tarjeta del listado (`🎯 SELECCIONADO`).
   - Se añadió el botón directo `📥 Auditoría JSON` en la esquina superior derecha de cada tarjeta de dispositivo.
   - La función `downloadDeviceAuditReport(devId)` genera y descarga dinámicamente `auditoria-zerotrust-<hardware_id>-<timestamp>.json` con `audit_metadata`, `device_identity`, `permission_profile` (`capabilities_granted`, `capabilities_restricted`), `zero_trust_session` y `hardware_telemetry`.
3. **Verificación y Empaquetado (`.deb`)**:
   - Sincronización canónica a `v9.5.0` en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `README.md`, `index.html` y `static/index.html`.
   - Compilación de `dist/recursos-cockpit_9.5.0_amd64.deb` y verificación con `--test-mode`.
