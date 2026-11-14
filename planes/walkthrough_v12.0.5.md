# Walkthrough y Verificación v12.0.5 (v2B.0.5)

## Cambios Verificados

1. **Bóveda Cifrada `AES-256-GCM` para Credenciales del Router ASUS (`server.py`)**:
   - Reordenación de `BASE_DIR` y `_load_or_create_admin_master_key()` antes de `_load_router_credentials()`.
   - Cifrado autenticado `AES-256-GCM` con `PBKDF2-HMAC-SHA256` (`200000` iteraciones, AAD `recursos-router-vault-v1`), derivando la clave de `.admin_master_key` + `/etc/machine-id`.
   - Migración automática y atómica del archivo `.router_credentials.json` en disco con permisos `0o600` (verificado en disco: `'encrypted': True`, `'cipher': 'AES-256-GCM'`, `'HAS_PLAINTEXT_PASS': False`).

2. **Sondeo SSH seguro (`sshpass -e`) y Filtrado de Puentes Docker (`server.py`)**:
   - Paso de credenciales al subproceso SSH mediante variable `SSHPASS` acotada al entorno (`sshpass -e`), evitando exposición en `/proc/<pid>/cmdline`.
   - Filtrado de interfaces `docker*`, `br-*`, `veth*`, `virbr*`, `tailscale*`, `tun*`, `wg*` en `ip neigh`, erradicando las falsas entradas `172.x` en `wifi_clients`.
   - Exposición en `wifi_summary` de `router_encrypted` y `router_auth_mode` (`"SSH + AES-256-GCM"`), reflejados en [NetworkSecurityView.tsx](file:///home/servidor/servicios/dashboard/src/components/NetworkSecurityView.tsx) y [telemetry.ts](file:///home/servidor/servicios/dashboard/src/types/telemetry.ts).

3. **Pruebas y Validaciones Ejecutadas**:
   - `python3 -m py_compile server.py desktop_app/recursos_app.py desktop_app/dex_controller.py`: `PY_COMPILE_OK`.
   - `npm run lint` (`tsc --noEmit`) y `npm run build` (`vite build`): sin errores, actualizando `static/index.html` (`383K`).
   - Servicio `system-dashboard.service` reiniciado y verificado en vivo contra `http://127.0.0.1:8085/api/version?refresh=1` (`12.0.5` / `2B.0.5`) y `/api/metrics`:
     - `router_online: true`, `router_encrypted: true`, `router_auth_mode: "SSH + AES-256-GCM"`, `router_ip: "192.168.50.10"`.
     - `total_clients: 21` (`8` cable, `7` `2.4 GHz`, `6` `5 GHz`), `DOCKER_BRIDGE_COUNT: 0`, `LAN_5GHZ_COUNT: 0`.
   - Empaquetado e instalación local: `bash packaging/build_deb.sh` + `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.0.5_amd64.deb`, `/usr/bin/recursos-cockpit --test-mode` (`[OK] Recursos Native Ubuntu HTML5 App v12.0.5 validated successfully.`) y `dpkg -l | grep recursos-cockpit` (`12.0.5`).
