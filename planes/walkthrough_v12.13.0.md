# Walkthrough de Implementación y Verificación — v12.13.0

## 1. Resumen de Cambios (v12.13.0)
- **Segmentación de Tráfico de Red en 4 Métricas (LAN Interna vs WAN Externa)**:
  - **Backend (`server.py`)**:
    - Nuevo clasificador en tiempo real `sample_lan_wan_flow_shares()` que inspecciona los flujos activos (`ss -tin -H state established` con contadores kernel `bytes_received`, `bytes_sent` / `bytes_acked` y montajes `CIFS/SMB`) y clasifica la IP remota mediante `_is_private_ip()` (rangos RFC1918 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, loopback, link-local y CGNAT `100.64.0.0/10`) frente a direcciones públicas enrutables WAN.
    - Desglose automático tanto del agregado global (`net.wan_rx_bytes_sec`, `net.wan_tx_bytes_sec`, `net.lan_rx_bytes_sec`, `net.lan_tx_bytes_sec`) como por cada interfaz física (`interfaces[].wan_rx_bytes_sec`, `wan_tx_bytes_sec`, `lan_rx_bytes_sec`, `lan_tx_bytes_sec` e `history_2h` con `wan_rx`, `wan_tx`, `lan_rx`, `lan_tx`).
    - Ampliación de `HISTORY` en memoria y migración incremental automática de `telemetry_history` en `recursos_history.db` (`ALTER TABLE telemetry_history ADD COLUMN net_wan_rx / net_wan_tx / net_lan_rx / net_lan_tx`) preservando el 100 % del histórico existente.
  - **Frontend (`OverviewView.tsx`, `NetworkSecurityView.tsx`, `App.tsx`, `ExpandedChartModal.tsx`)**:
    - Visualización simultánea de las 4 curvas en todas las gráficas de red (Inicio 5m, Interfaces en Red 20m, Historial de Consumo 24h y Modal de Inspección Táctil):
      - `Bajada Externa (WAN)` (`#0284c7`)
      - `Subida Externa (WAN)` (`#10b981`)
      - `Bajada Interna (LAN)` (`#6366f1`)
      - `Subida Interna (LAN)` (`#f59e0b`)
- **Reparación Integral del Auto-Actualizador Local y Descarga Manual desde GitHub (`server.py`)**:
  - Registro automático de `_ensure_git_safe_directory()` (`git config --global --add safe.directory <BASE_DIR>`) para evitar bloqueos `dubious ownership` cuando el servicio corre bajo `systemd` / `root`.
  - Filtro inteligente `_get_git_status_summary()` que excluye artefactos locales autogenerados (`static/index.html`, `dist/`, `packaging/`, `*.db`, `*.json`, `planes/`) para que nunca bloqueen `auto_install_watcher_worker()` ni `perform_auto_update_and_install()`.
  - Respaldo automático con `git reset --hard origin/main` tras `git fetch` si `git pull --ff-only` tropieza con artefactos locales, más descarga directa de tarball HTTPS (`_download_and_apply_github_tarball()` desde `codeload.github.com`) cuando Git falla o la instalación carece de `.git`, preservando siempre bases de datos `.db`, bóvedas `.json` y `.env`.
  - Reconstrucción automática del bundle (`npm run build`) tras actualizar el código fuente cuando `npm` está disponible.

## 2. Verificación Técnica
- Validación de diccionario `./i18n/dictionary.csv` con las 10 nuevas claves en los 8 idiomas (`es`, `en`, `fr`, `de`, `pt`, `it`, `zh`, `ja`).
- Compilación limpia de Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`) y TypeScript/Vite (`npm run build`).
- Empaquetado e instalación verificada del paquete nativo Debian `./dist/recursos-cockpit_12.13.0_amd64.deb` (`--test-mode` OK).
