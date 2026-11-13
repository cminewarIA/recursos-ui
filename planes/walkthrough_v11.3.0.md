# Walkthrough y Verificación (`v11.3.0`)

## 1. Resumen de Cambios Verificados
- **Interfaz Web (`index.html` y `static/index.html`)**:
  - Botón `⏻ Apagar` integrado simétricamente junto a `⚡ WoL` en cada dispositivo de `#networkDevicesList` (oculto de forma segura para la IP del propio servidor).
  - Confirmación interactiva previa (`showConfirmModal`), consumo de `POST /api/wol/shutdown` vía `safeReadJson`, feedback visual y sincronización byte a byte entre `index.html` y `static/index.html`.
- **Backend Python (`server.py`) y Dev Server (`vite.config.ts`)**:
  - Implementación de `send_device_shutdown_signal()` con bloqueo de `localhost`/IPs/MACs del anfitrión y canales *Zero-Hardcoding* (Webhook `RECURSOS_SHUTDOWN_HOOKS_FILE`, SSH no interactivo, RPC Samba opcional y Sleep-on-LAN UDP puertos `9`/`7`).
  - Pruebas unitarias en Python validando bloqueo de `127.0.0.1` y rechazo de entradas vacías/inválidas.
  - Compilación AST (`python3 -m py_compile`), validación sintáctica JS (`node --check`), comprobación de IDs únicos y enlaces `getElementById`, compilación Vite (`npm run build`) y verificación de tipos (`npm run lint`).
- **Paquete Nativo Debian (Regla 6)**:
  - Compilación de `dist/recursos-cockpit_11.3.0_amd64.deb` y `dist/SHA256SUMS.txt` mediante `bash packaging/build_deb.sh`.
  - Instalación local en contenedor y verificación funcional con `/usr/bin/recursos-cockpit --test-mode` y `dpkg -l | grep recursos-cockpit`.
