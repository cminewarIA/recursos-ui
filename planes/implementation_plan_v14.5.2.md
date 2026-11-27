# Plan de Implementación v14.5.2 — Consumo Real por Dispositivo en «Velocidad Global y Consumo por Dispositivo»

## 1. Causas Raíz Detectadas
1. **`SERVER_LOCAL_IP` congelada en `127.0.0.1`**: cuando `server.py` arrancaba antes de asignarse la IPv4 LAN, `SERVER_LOCAL_IP` quedaba fijada en `"127.0.0.1"`, provocando que `is_local_host` valiese `False` en `servidor (enp7s0)` (`192.168.50.2`) y no se le aplicara `_SERVER_DIRECT_NET_SPEEDS`.
2. **Descarte del desglose LAN por par remoto**: `sample_lan_wan_flow_shares()` ya leía contadores CIFS (`/proc/fs/cifs/Stats`) y sockets TCP (`ss -tin -H state established`), pero solo devolvía proporciones globales sin propagar el caudal real por IP par (p. ej. NAS `192.168.50.3` transfiriendo ~100 MB/s con el servidor).
3. **Bóveda `.router_credentials.json` sin descifrar**: el archivo cifrado previo devolvía `{}` silenciosamente tras la rotación de `.admin_master_key`, dejando `asus.available = false` y `router_wan_available = false` sin avisar en el panel.

## 2. Cambios Aplicados
- **[server.py](../server.py)**:
  - Auto-refresco de `SERVER_LOCAL_IP` en `background_collector()` y `fetch_wifi_worker()` cuando es `127.0.0.1`/vacío, y detección robusta de `is_local_host`.
  - Nuevo estado compartido `_SERVER_PEER_LAN_SPEEDS` calculado desde los deltas CIFS/TCP por IP par en `sample_lan_wan_flow_shares()` (evitando doble conteo SMB y picos falsos en arranque) y aplicado a cada cliente correspondiente en `fetch_wifi_worker()`.
  - Señalización explícita `ROUTER_CREDS_DECRYPT_FAILED` → `summary.router_creds_decrypt_failed` y `sources_status.asus.creds_decrypt_failed`.
- **[NetworkDevicesModal.tsx](../src/components/NetworkDevicesModal.tsx)**, **[telemetry.ts](../src/types/telemetry.ts)** e **[dictionary.csv](../i18n/dictionary.csv)**:
  - Banner contextual (`overview.bw_router_decrypt_notice` / `overview.bw_router_unlinked_notice`) cuando `!summary.router_wan_available`.
  - Barra proporcional también en la columna **LAN interna** y visibilidad de velocidad LAN en tarjetas de la pestaña Dispositivos.
- **[VERSION](../VERSION)**: incrementado a **`14.5.2`** (`PATCH`).
