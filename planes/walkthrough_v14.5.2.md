# Walkthrough v14.5.2 — Consumo Real por Dispositivo en «Velocidad Global y Consumo por Dispositivo»

## 1. Causas Raíz Verificadas en Producción (`14.5.1`)
1. `SERVER_LOCAL_IP` quedó en `"127.0.0.1"` tras el arranque temprano del servicio, impidiendo reconocer al servidor local (`servidor (enp7s0)` / `192.168.50.2`) con `is_local_host = True` y bloqueando la inyección de `_SERVER_DIRECT_NET_SPEEDS`.
2. `sample_lan_wan_flow_shares()` en [server.py](../server.py) leía los contadores CIFS y TCP por par remoto, pero no pasaba ese caudal por IP a `fetch_wifi_worker()`, dejando al NAS (`192.168.50.3`) y demás pares activos en `0 B/s`.
3. `/home/servidor/servicios/dashboard/.router_credentials.json` (14 nov) no se podía descifrar con `.admin_master_key` (16 nov), devolviendo `{}` silenciosamente y dejando `router_wan_available = false`.

## 2. Correcciones Implementadas
- **[server.py](../server.py)**:
  - Auto-refresco de `SERVER_LOCAL_IP` cuando empieza por `127.` en `background_collector()` y `fetch_wifi_worker()`, además de marcado fiable de `is_local_host` para las interfaces LAN reales.
  - Nuevo mapa compartido `_SERVER_PEER_LAN_SPEEDS` alimentado en `sample_lan_wan_flow_shares()` con deltas CIFS (`/proc/fs/cifs/Stats`) y TCP (`ss -tin -H state established`) deduplicados por par remoto LAN, aplicado en `fetch_wifi_worker()` sobre `lan_speed_down`/`lan_speed_up`/`speed_down`/`speed_up`.
  - Señalización explícita `ROUTER_CREDS_DECRYPT_FAILED` → `summary.router_creds_decrypt_failed` y `sources_status.asus.creds_decrypt_failed`.
- **[NetworkDevicesModal.tsx](../src/components/NetworkDevicesModal.tsx)**, **[telemetry.ts](../src/types/telemetry.ts)** e **[dictionary.csv](../i18n/dictionary.csv)**:
  - Barra horizontal proporcional en la columna **LAN interna** y visualización de velocidad LAN en tarjetas de dispositivos.
  - Aviso contextual cuando `!summary.router_wan_available` explicando si las credenciales cifradas del router requieren re-guardado o si falta el enlace SSH.
- **[VERSION](../VERSION)**: actualizado a **`14.5.2`** (`PATCH`).

## 3. Verificación Estática y Compilación
- `python3 -W error::SyntaxWarning -m py_compile server.py`: salida `0`.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0`.
- `i18n/dictionary.csv`: `1194` filas válidas × `33` columnas (`malformed rows: []`).
- `npm run build`: `vite v8.3.8`, `2092 modules transformed`, compilado en `5.57s` ([static/index.html](../static/index.html)).
