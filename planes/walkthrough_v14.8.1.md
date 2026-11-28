# Walkthrough v14.8.1 — Auditoría integral de gráficas y separación estricta LAN / WAN / Router

## Causas raíz detectadas y corregidas

1. **Contaminación LAN → WAN en `server.py` (`sample_lan_wan_flows` y `_split_rate_wan_lan`)**:
   - Se eliminó el reparto por proporción de conexiones (`wan_conns / tot_conns`) y el valor fijo `0.65` cuando las ráfagas eran UDP, CIFS/SMB o sockets efímeros, así como la extrapolación de pequeños *keepalives* WAN sobre tráfico físico LAN no medido.
   - Se implementó clasificación por interfaz local (`ip_to_nic`), detección de pares UDP establecidos (`ss -un -H state established`), deduplicación CIFS vs TCP por IP remota y normalización completa IPv6 (`%iface`, `::ffff:`) en `_is_private_ip()`.
2. **Sobrescritura de `0.0` en SQLite (`device_series_history` y `telemetry_history`)**:
   - Corregido el fallback falsy `nic_item.get("wan_rx_bytes_sec") or nic_item.get("rx_bytes_sec")` que volcaba todo el tráfico LAN puro como `net_wan_rx` cuando WAN era `0.0`.
   - Corregido `_format_telemetry_rows_payload()` para hacer fallback únicamente cuando las columnas son `NULL` (`None`) en filas heredadas.
   - Añadida entidad persistente `router` (`main`) y agregación `MAX(val3)` para `nic`/`router` en `query_device_series_history_from_sqlite()`.
3. **Espejo subida/bajada en LAN y duplicación Host → Router (`fetch_wifi_worker` y `background_collector`)**:
   - El sondeo SSH del router lee `sw_mode`, `wan0_ifname` / `wan0_gw_ifname` y `/proc/net/dev` completo para medir el puerto WAN físico exacto en modo Router (`sw_mode == 1`).
   - La agregación LAN del router ya no suma doblemente `lan_down` + `lan_up` del mismo flujo Servidor ↔ Cliente (evitando picos simétricos de bajada y subida simultáneos).
   - Cuando no hay telemetría SSH del router activa (`router_wan_available == False`), el backend y `RouterTrafficCard` dejan de copiar el tráfico del host local como si fuera el router.
4. **Doble conteo en NICs virtuales y particiones de disco**:
   - `get_real_net()` excluye ahora `virbr`, `cni`, `flannel`, `cali`, `podman`, `tun`, `tap`, `wg` y `tailscale`.
   - `get_real_disk()` usa regex exacta de particiones (`sd*N`, `vd*N`, `xvd*N`, `hd*N`, `nvme*p*`, `mmcblk*p*`, `md*p*`) y excluye `zram`, `sr` y `nbd`.
5. **Interfaz y visualización (`OverviewView`, `NetworkSecurityView`, `NetworkDevicesModal`, `ExpandedChartModal`, `TelemetryChart`, `DataVizPrimitives`, `EquipmentView`)**:
   - La tarjeta *Comunicación Local* en `/inicio` usa exclusivamente las series LAN direccionales del servidor local (`netLanRxHist`/`netLanTxHist`).
   - Eliminados todos los fallbacks `wan_rx ?? rx` y `wan_speed_down ?? speed_down`.
   - Añadidos selectores de ámbito (`Todo | WAN | LAN`) en NICs, Router (por defecto `WAN`) e historial 24h.
   - Corregido el cursor de navegación temporal (`activeWinEnd`) en `ExpandedChartModal` para entidades SQLite (`disk`, `nic`, `router`, `cpu_sensor`), el formato `KB/s` en tooltips de `TelemetryChart` y el cálculo bidireccional en `ChartNarrativeFooter`.

## Verificación
- `python3 -m py_compile server.py`: OK.
- Pruebas unitarias de `_is_private_ip`, `_split_rate_wan_lan`, regex de particiones y persistencia SQLite (`nic`, `router`, `telemetry_history` preservando `0.0`): OK.
- Integridad de `i18n/dictionary.csv` (1248 claves, 33 columnas exactas, cero duplicados): OK.
- Compilación y lint TypeScript/Vite (`npm run build` + `npm run lint`): verificados en cierre de entrega.
