# Plan de Implementación v12.0.5 (v2B.0.5) — Bóveda Cifrada `AES-256-GCM` para Credenciales del Router ASUS AiMesh, Sondeo SSH sin Exposición en `cmdline` y Filtrado de Puentes Docker

## Motivación

1. **Cifrado en reposo de credenciales del router ASUS (`.router_credentials.json`)**:
   - Evitar el almacenamiento en texto plano en `.router_credentials.json` aplicando cifrado autenticado **`AES-256-GCM`** con derivación de clave **`PBKDF2-HMAC-SHA256`** (`200000` iteraciones) vinculada criptográficamente a `ADMIN_MASTER_KEY` (`.admin_master_key`) y al identificador único de la máquina (`/etc/machine-id`), manteniendo compatibilidad con variables de entorno y migración automática transparente al arrancar.
2. **Sondeo SSH sin exposición de contraseña en la tabla de procesos (`sshpass -e`)**:
   - Sustituir `sshpass -p <password>` por `sshpass -e` mediante variable de entorno privada `SSHPASS` acotada al subproceso SSH, evitando que la contraseña figure en `/proc/<pid>/cmdline`.
3. **Filtrado de interfaces virtuales y puentes Docker en `ip neigh` (`server.py`)**:
   - Excluir vecinos ARP de interfaces `docker*`, `br-*`, `veth*`, `virbr*`, `tailscale*`, `tun*`, `wg*` para evitar falsos dispositivos `Wi-Fi 5 GHz` (`172.x` internos).
4. **Visibilidad del estado de cifrado en la interfaz (`telemetry.ts` y `NetworkSecurityView.tsx`)**:
   - Exponer `router_encrypted` y `router_auth_mode` en `wifi_summary` y mostrarlo en el desplegable de detalles técnicos de la pestaña **Red**.

## Pasos Ejecutados

1. **`server.py`**:
   - Reordenación de `BASE_DIR` y `_load_or_create_admin_master_key()` junto a la nueva bóveda `_get_router_vault_secret()`, `_encrypt_router_credentials_dict()` y `_decrypt_router_credentials_dict()`, con migración automática en `_load_router_credentials()`.
   - Sondeo SSH en `fetch_wifi_worker` mediante `sshpass -e` + filtrado de interfaces virtuales en `ip neigh` + campos `router_encrypted` y `router_auth_mode` en `summary`.
2. **`src/types/telemetry.ts` y `src/components/NetworkSecurityView.tsx`**:
   - Tipado `WifiSummary` y visualización del estado cifrado junto a la puerta de enlace.
3. **Sincronización canónica `12.0.5` (`v2B.0.5`)**:
   - Actualización de `VERSION`, `package.json`, `packaging/debian/control`, `README.md` y compilación/instalación verificada de `dist/recursos-cockpit_12.0.5_amd64.deb`.
