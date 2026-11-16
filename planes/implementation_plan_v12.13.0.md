# Plan de Implementación v12.13.0 — Segmentación de Tráfico de Red (LAN / WAN) y Autoactualizador Resiliente desde GitHub

## Resumen Ejecutivo
Este plan incorpora la visualización simultánea de **cuatro métricas de tráfico de red** (bajada y subida segmentadas entre red interna LAN y red externa WAN mediante clasificación RFC1918 en tiempo real) en todos los gráficos del panel y en el historial persistente de 24 horas, además de corregir la causa raíz del fallo *"No se pudo completar la descarga desde GitHub"* y del bloqueo de la autoactualización en el servidor local.

## Decisiones Confirmadas
1. **Visualización de las 4 curvas en todos los gráficos de red**:
   - Se muestran simultáneamente `Bajada Externa (WAN)`, `Subida Externa (WAN)`, `Bajada Interna (LAN)` y `Subida Interna (LAN)` en:
     - Tarjeta de Red en **Inicio** (`OverviewView.tsx`)
     - Tarjetas de interfaces en la vista **Red** (`NetworkSecurityView.tsx`)
     - Bloque de **Historial de tráfico de red (24 h)** (`App.tsx`)
     - **Modal de inspección ampliada** (`ExpandedChartModal.tsx`)
2. **Clasificación en tiempo real por IP destino/origen RFC1918**:
   - `server.py` mide los deltas de bytes por socket (`ss -tin` + contadores CIFS/SMB y conexiones activas) clasificando cada flujo como privado/local (`_is_private_ip`: RFC1918 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, loopback, link-local, CGNAT `100.64.0.0/10`) frente a IP pública enrutable (WAN), repartiendo de forma proporcional el caudal real medido en cada interfaz física para que `LAN + WAN == Total`.
3. **Reparación del actualizador manual y automático desde el navegador web en servidor local**:
   - Se configura automáticamente `git config --global --add safe.directory` sobre `BASE_DIR` para evitar rechazos por `dubious ownership` cuando el servicio corre bajo `root` o `systemd`.
   - Se filtran cambios locales en artefactos autogenerados (`static/index.html`, `dist/`, `nic_history_2h.json`, `auto_install_config.json`, etc.) para que nunca bloqueen la autoactualización (`is_meaningfully_dirty_tree()`).
   - Se unifica `git fetch origin main` + `git reset --hard origin/main` (preservando stashes de código si los hubiera) y se añade un **motor de respaldo directo por tarball HTTPS (`codeload.github.com`)** cuando Git falla o no existe `.git`, garantizando que la descarga desde GitHub nunca falle.
