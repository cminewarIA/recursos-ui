# Walkthrough y Verificación Técnica · `v12.5.0`

## 1. Resumen de Implementación Realizada
1. **Control de Versión Unificado (`12.5.0` · `MINOR`)**:
   - Actualizado `./VERSION` y sincronizado en `package.json`, `package-lock.json`, `packaging/debian/control`, `src/utils/formatters.ts`, `src/App.tsx`, `src/components/MoreView.tsx`, `static/manual.html`, `docs/index.html`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `README.md` y plugin metadata.
2. **Estética Unificada Basada en `docs/assets/*.svg` en las 4 Interfaces**:
   - **Web React 19**: paleta `#F1F5F9` / `#FFFFFF` (claro) y `#020617` / `#0F172A` (oscuro), tarjetas de `18px`, botones `#0284C7 -> #0EA5E9`.
   - **Ubuntu Nativa (`desktop_app/recursos_app.py`)**: actualizado `NATIVE_CSS` a la paleta SVG con `.launcher-hero`, `.btn-primary` degradado, hover lift y transiciones `Gtk.Stack` de `260 ms`.
   - **Android Nativa (`android_app/...`)**: actualizados `Color.kt`, `Theme.kt` y `CockpitDashboard.kt` con esquemas Claro/Oscuro, pulso sonar animado y transiciones `AnimatedVisibility`.
   - **Manual Interactivo (`static/manual.html` y `docs/index.html`)**: tokens CSS `:root` sincronizados con los SVGs y entrada `v12.5.0` en `CHANGELOG`.
3. **Interfaz Completamente Animada (`motion` v12)**:
   - Instalado `motion` (`npm install --no-audit --no-fund`) y creadas las primitivas en `src/components/MotionPrimitives.tsx` (`COCKPIT_SPRING`, `COCKPIT_PILL_SPRING`, `COCKPIT_EASE`, `MorphPill`, `AnimatedMetricValue`, `BentoCard`, `ViewStage`, `AccordionBody`), envueltas en `<MotionConfig reducedMotion="user">` en `src/App.tsx` e integradas en las vistas `OverviewView.tsx`, `EquipmentView.tsx`, `NetworkSecurityView.tsx`, `AppsMediaView.tsx`, `MoreView.tsx` y `ExpandedChartModal.tsx`.
4. **Curvas Monótonas y Puntos de Muestreo Exactamente Encima de la Línea**:
   - En `src/components/TelemetryChart.tsx` y `drawSimCanvas()` de `static/manual.html`: interpolación cúbica monótona `Fritsch–Carlson`, barrido luminoso horizontal sin desplazamiento respecto al spline completo y orden estricto de capas (`relleno -> trazo spline -> barrido -> vértices en capa superior -> baliza sonar final -> aro hover`).
5. **Banner de Red e Internet + Discos, Extraíbles y Deduplicación Real de Almacenamiento**:
   - En `src/components/OverviewView.tsx`: cuadrícula principal `2x2` con **CPU**, **Memoria RAM**, **GPU / Gráficos** y **Red e Internet** (gráfica HiDPI de `20m` Rx/Tx con modal ampliable `chartKind: 'net'`), acompañada del bloque **Almacenamiento y discos disponibles** con tarjetas por unidad (`sortedDisks`) y resumen deduplicado (`storageSummary`).
   - En `server.py` (`_read_hwmon_disk_temps`, `_read_lsblk_metadata`, `_format_transport_badge`, `_compute_pool_key`, `fetch_disks_worker`), `vite.config.ts` (`sampleRealDisks`) y `src/types/telemetry.ts` (`DiskInfo`): lectura directa del sistema Linux mediante `lsblk -J -b`, `psutil`/`os.statvfs` y `/sys/class/hwmon`, clasificando `local`, `removable` (incluyendo USB/SD desmontadas) y `network`, y deduplicando con `pool_key` los montajes que comparten el mismo disco local o servidor NAS.

## 2. Verificaciones Ejecutadas y Resultados Observados
- **Compilación Frontend & TypeScript (`npx tsc --noEmit && npm run build`)**:
  - Salida `0`. Vite transformó `2074` módulos y generó `static/index.html` (`578K`, `<html` presente).
- **Verificación Sintáctica Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`)**:
  - Salida `0`.
- **Prueba Real de Telemetría y Deduplicación de Discos sobre el Hardware Local**:
  - Diagnóstico del "32 TB": `fetch_disks_worker()` detectó que `//192.168.50.3` estaba montado 4 veces (`video`, `onedrive`, `photo`, `homes`, `7.20 TiB` cada uno) y `/dev/sda1` (`915.8 GiB`) presentaba bind mounts (`/mnt/almacenamiento`, `/home/servidor/servicios/emby/programdata/logs`, `/var/log` y `/var/lib/docker/volumes/webodm_appmedia/_data`). Sin deduplicar sumaban `31.705 TiB` (`34.860 TB` decimales).
  - Con `pool_key` deduplicado, el total combinado real reportado es **`8.320 TiB`** (`9.148 TB` decimales), manteniendo visibles los `9` puntos de montaje con `pool_primary` y `pool_shared_with`.
- **Empaquetado e Instalación Debian (`GEMINI.md` Regla 5)**:
  - `bash packaging/build_deb.sh` generó y firmó con GPG `dist/recursos-cockpit_12.5.0_amd64.deb` (`4CFC86D58E9146AE`) y `SHA256SUMS.txt`.
  - `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.5.0_amd64.deb` instaló `12.5.0` sobre `12.4.0`.
  - `dpkg -l | grep recursos-cockpit` confirmó `ii  recursos-cockpit  12.5.0  amd64`.
  - `/usr/bin/recursos-cockpit --test-mode` devolvió `[OK] Recursos Native Ubuntu HTML5 App v12.5.0 validated successfully.` y detección completa de DeX (`adb` y `scrcpy 3.3.4`).
- **Despliegue en `/home/servidor/servicios/dashboard` e Integridad de `recursos_history.db`**:
  - Sincronizados archivos de código y frontend excluyendo `*.db*` y secretos locales; el inodo de `recursos_history.db` permaneció intacto (`INODE=1049392`, pasando de `68194304` bytes antes del reinicio a `68206592` bytes tras reanudar la recolección).
  - `sudo systemctl restart system-dashboard.service` -> servicio `active`.
  - `GET http://127.0.0.1:8085/` -> HTTP `200` (contiene `"Red e Internet"` y `"Almacenamiento y discos disponibles"`).
  - `GET http://127.0.0.1:8085/manual` -> HTTP `200` (badge `v12.5.0` y `__INITIAL_APP_VERSION__ = ['12.5.0']`).
  - `GET http://127.0.0.1:8085/api/version` -> HTTP `200` (`version: 12.5.0`, `installed_deb_version: 12.5.0`, `remote_version: 12.4.0`).
  - `GET http://127.0.0.1:8085/api/metrics` -> HTTP `200` (`version_info.current_version: 12.5.0`, `9` volúmenes con deduplicación activa en `8.320 TiB`, y muestras recientes de `disk_pct` ajustadas a `28.3 %`).
- **Compilación Nativa Android / Verificación Visual en Navegador**:
  - **No verificadas en ejecución**: no se compiló el `.apk` con Gradle en esta sesión ni se completó la verificación visual en vivo con el subagente `browser` porque Google Chrome no estaba abierto con depuración remota (`ENOENT: Could not find DevToolsActivePort at /home/servidor/.config/google-chrome/DevToolsActivePort`).

