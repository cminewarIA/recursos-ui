# Plan de Implementación v9.5.0 — Indicador Visual de Permisos (Full Access vs Sandbox) y Reporte de Auditoría JSON en `#secZeroTrustDevicesSection`

## 1. Objetivo
Mejorar la visualización del listado de dispositivos Zero-Trust en `#secZeroTrustDevicesSection` (`/seguridad`):
1. **Indicador Visual de Permisos (`Full Access` vs `Sandbox`)**: Especificar visualmente qué tipo de permiso tiene cada dispositivo autorizado:
   - **Apps Nativas (`FULL ACCESS` / `RING_0_NATIVE_BRIDGE`)**: Clientes nativos Ubuntu `.deb` (`GTK 3 + WebKit2`) y Android `.apk` (`Kotlin + WebView`) con acceso directo al silicio/DMI, persistencia en Keyring/KeyStore, auto-conmutación LAN↔WAN y (en Ubuntu) control por hardware USB DeX (`/dev/uhid` + `scrcpy`).
   - **Clientes Web (`SANDBOX` / `RING_3_BROWSER_SANDBOX`)**: Sesiones ejecutadas dentro del aislamiento estándar del navegador web sin acceso directo a sensores del kernel ni subsistema USB/DeX.
2. **Descarga del Reporte de Auditoría Completo en JSON**: Permitir seleccionar cualquier dispositivo vinculado (mediante clic en su tarjeta o selector `#secSelectedAuditDevice` en la barra superior de `#secZeroTrustDevicesSection`) y descargar su reporte de auditoría completo en formato JSON (`auditoria-zerotrust-<id>-<timestamp>.json`), además de disponer de un botón directo `📥 Auditoría JSON` en cada tarjeta.

## 2. Archivos Modificados y Sincronizados
- `index.html` y `static/index.html` (`#secZeroTrustDevicesSection`, `buildDeviceIdentityCardHtml`, `renderTrustedDevices`, `buildDeviceAuditPayload`, `downloadDeviceAuditReport`).
- `VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `README.md` (`9.5.0`).
