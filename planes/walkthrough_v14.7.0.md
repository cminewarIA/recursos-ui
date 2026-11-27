# Verificación y Entrega — Recursos Cockpit v14.7.0

## Resumen del Cambio
- **Backend seguro LAN-only en caliente (`server.py`, `VERSION=14.7.0`)**:
  - Añadido `ROUTER_CREDS_LOCK` y soporte de puerto SSH (`ROUTER_SSH_PORT`) en `_load_router_credentials()` y `wifi_collector()`.
  - Añadidos helpers `_validate_router_credentials_input()`, `_test_router_ssh_connection()` (solo IPs RFC1918 LAN vía `_is_lan_ipv4`, bloqueo de flags en usuario y uso seguro de `SSHPASS` en entorno privado), `_save_router_credentials_vault()` (escritura atómica `0600` en AES-256-GCM + recarga en caliente + invalidación de `METRICS_CACHE_BYTES`) y `_clear_router_credentials_vault()`.
  - Añadidos `GET /api/network/router-credentials` (autenticado, sin exponer contraseña) y `POST /api/network/router-credentials` (bloqueo estricto LAN-only con HTTP `403` si `not auth["is_local"]`, soportando `test`, `save` y `clear`).
- **Formulario seguro en el modal de red (`src/components/NetworkDevicesModal.tsx`, `src/types/telemetry.ts`)**:
  - Botón **«Configurar router»** integrado en el aviso ámbar de credenciales y en la tarjeta de fuente de tráfico.
  - Pre-relleno dinámico desde router/gateway detectado (`Zero-Hardcoding`), botón **Probar SSH**, **Guardar y cifrar (AES-256-GCM)**, **Desvincular** y aviso pasivo bloqueado cuando se abre desde WAN.
- **i18n y Documentación**:
  - Añadidas 20 claves `overview.router_cfg_*` con traducciones en las 31 columnas de `i18n/dictionary.csv`.
  - Actualizado `README.md` y creado `planes/implementation_plan_v14.7.0.md`.

## Resultados Observados de Verificación
| Comprobación | Comando | Resultado |
| :--- | :--- | :--- |
| Compilación Python | `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py themes_catalog.py desktop_app/recursos_app.py desktop_app/dex_controller.py` | Exit `0` |
| TypeScript estricto | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | Exit `0` |
| Compilación Frontend | `npm run build` | Exit `0` (`✓ built in 1.07s`, standalone `static/index.html`) |
| Integridad CSV i18n | Script Python `csv.reader` sobre `i18n/dictionary.csv` | `[OK] 1246 rows, 33 cols, 0 duplicates` |
| Validación vault SSH + LAN-only HTTP 403 | Suite Python contra `server.DashboardHTTPHandler` y directorio temporal | `[OK] Router credentials vault, AES-256-GCM, SSH validation & LAN-only HTTP 403 verified` |
