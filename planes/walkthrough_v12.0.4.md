# Walkthrough y Verificación v12.0.4 (v2B.0.4)

## Cambios Verificados

1. **Clasificación Real de Dispositivos LAN/Wi-Fi desde Router ASUS AiMesh (`server.py`, `.router_credentials.json`, `.gitignore`)**:
   - Cargador *Zero-Hardcoding* `_load_router_credentials()` con soporte para variables de entorno y archivo local git-ignored `.router_credentials.json` (`0600`).
   - Consulta SSH al router ASUS (`wl assoclist`, `wl sta_info`, `/tmp/clientlist.json`, `brctl showmacs br0`) y algoritmo en 2 pasadas para evitar que los clientes inalámbricos de nodos AiMesh secundarios aparezcan falsamente como cableados por el *backhaul* de `br0`.
   - Eliminación definitiva de la etiqueta `"LAN / 5 GHz"` en `ip neigh` (reemplazada por `"Cable LAN"`, `"2.4 GHz"` o `"Wi-Fi 5 GHz"`) e inclusión de campos normalizados en `wifi_clients` y `wifi_summary`.

2. **Corrección del Crash de `Programas` y Normalización de Esquemas (`server.py`, `src/types/telemetry.ts`, `AppsMediaView.tsx`, `OverviewView.tsx`, `NetworkSecurityView.tsx`, `MoreView.tsx`)**:
   - `docker_activities` emite `cpu_percent` y `mem_percent` como `float` e incluye `image`; `AppsMediaView.tsx` incorpora el helper `toNum()` para evitar excepciones `.toFixed(1)` si llega alguna cadena.
   - Corregido el cálculo de progreso en torrents (`0..100 %`, evitando `10000 %`).
   - Alineados `systemd_services`, `emby` (mostrando totales de biblioteca y `recent_media`), `pihole`, `fail2ban`, `system_errors_summary.total_errors` y campos de `/api/version` + logs del sistema.

3. **Pruebas y Validaciones Ejecutadas**:
   - **Sintaxis Python**: `python3 -m py_compile server.py desktop_app/recursos_app.py desktop_app/dex_controller.py` → `PY_COMPILE_OK`.
   - **Frontend TypeScript y Compilación Standalone**: `npm run lint` (`tsc --noEmit`) sin errores y `npm run build` (`vite build`) actualizando `static/index.html` (`383K`).
   - **Verificación en Vivo (`/api/version` y `/api/metrics`)**:
     - Servicio `system-dashboard.service` reiniciado (`active`).
     - Versión servida: `12.0.4` (`2B.0.4`).
     - Clientes de red (`26` totales, `24` activos, `8` cable, `7` en `2.4 GHz`, `11` en `5 GHz`, `router_ip: 192.168.50.10`, `router_online: true`), con **`LAN_5GHZ_COUNT: 0`**, equipos cableados reales en `"Cable LAN"` y dispositivos AiMesh en `"5 GHz"` / `"2.4 GHz"`.
     - Contenedores Docker con `cpu_percent`/`mem_percent` tipo `float` e `image` presente; Systemd con `active`/`active_state`/`description`; Emby (`online: True`, `417` películas, `45` series, `2641` episodios, `12` elementos recientes); Torrents (`100` -> `100 %`); Pi-hole (`online: True`, `3949` consultas, `558` bloqueos) y Fail2ban (`active: True`); `system_errors_summary.total_errors = 50`.
   - **Empaquetado e Instalación `.deb`**:
     - `bash packaging/build_deb.sh` generó `dist/recursos-cockpit_12.0.4_amd64.deb` firmado con GPG `4CFC86D58E9146AE`.
     - `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.0.4_amd64.deb` instalado correctamente.
     - `/usr/bin/recursos-cockpit --test-mode` validado (`[OK] Recursos Native Ubuntu HTML5 App v12.0.4 validated successfully.`) y `dpkg -l | grep recursos-cockpit` confirmó `12.0.4`.
