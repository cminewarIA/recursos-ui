# Verificación y Entrega — Recursos Cockpit v14.7.1

## Resumen del Cambio
- **Acceso desde cualquier dispositivo certificado Zero-Trust (`server.py`, `NetworkDevicesModal.tsx`)**:
  - `GET /api/network/router-credentials` devuelve `can_configure: true` para clientes autenticados y `POST /api/network/router-credentials` autoriza a cualquier dispositivo certificado (`auth["is_trusted"]`) sin exigir origen LAN, manteniendo `_is_lan_ipv4(r_ip)` contra SSRF.
  - Eliminado el bloqueo visual `is_local === false` dentro de `NetworkDevicesModal.tsx` y actualizado el texto `overview.router_cfg_desc`.
- **Estabilidad SSH (`ControlMaster` + Backoff en `fetch_wifi_worker()`)**:
  - Reutilización de sesión SSH mediante `ControlMaster=auto`, `ControlPersist=300`, `UserKnownHostsFile=/dev/null` y `ServerAliveInterval=25` para no abrir una nueva sesión Dropbear cada 5 s.
  - Limpieza automática del socket de control + *backoff* exponencial (`20s → 45s → 90s → 180s → 300s`) cuando el router cierra o rechaza la conexión SSH, exponiendo `router_configured` y `router_ssh_error` en `WIFI_CACHE.summary` junto con `overview.router_cfg_reconnecting_notice` para no mostrar falsamente que las credenciales no están guardadas.

## Verificación
- `python3 -W error::SyntaxWarning -m py_compile server.py`
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` y `npm run build`
- Validación CSV de `i18n/dictionary.csv` (`33` columnas, `0` duplicados)
- Pruebas HTTP sobre `server.DashboardHTTPHandler`: bloqueo `403` para no certificados (`is_trusted=False`), permiso `200` para certificados en WAN (`is_trusted=True, is_local=False`), rechazo SSRF (`8.8.8.8`) y verificación en vivo contra `http://127.0.0.1:8085`.
