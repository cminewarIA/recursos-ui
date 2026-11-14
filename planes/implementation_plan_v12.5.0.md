# Plan de Implementación · `v12.5.0` (Estética SVG Unificada, Animaciones 60 FPS, Puntos Exactos sobre Curva, Banner de Red y Deduplicación de Almacenamiento)

## 1. Alcance y Objetivos (`MINOR` -> `12.5.0`)
1. **Unificación estética total basada en `docs/assets/*.svg` en las 4 interfaces**:
   - **Web Cockpit (`React 19 + Motion v12 + Tailwind v4`)**: paleta `#F1F5F9` / `#FFFFFF` en claro y `#020617` / `#0F172A` en oscuro, tarjetas Bento de `18px`, píldoras de estado con indicadores en vivo y botones con degradado cian-azul `#0284C7 -> #0EA5E9`.
   - **Ubuntu Nativa (`GTK 3 + WebKit2` en `desktop_app/recursos_app.py`)**: hoja de estilo `NATIVE_CSS` alineada a los tokens SVG, hero gradient `.launcher-hero`, transiciones fluidas `Gtk.Stack` (`260ms`) y hover lift en tarjetas.
   - **Android Nativa (`Jetpack Compose + WebView` en `android_app/...`)**: esquemas Claro/Oscuro en `Color.kt` y `Theme.kt`, baliza sonar animada y transiciones `AnimatedVisibility` en `CockpitDashboard.kt`.
   - **Manual Interactivo (`static/manual.html` y `docs/index.html`)**: tokens `:root` sincronizados con los SVGs y entrada `v12.5.0`.
2. **Animaciones completas a 60 FPS (`motion` v12)**:
   - Nuevas primitivas en `src/components/MotionPrimitives.tsx`: `MorphPill` (`layoutId` deslizante compartido), `ViewStage` (crossfade + deslizamiento vertical entre vistas), `AnimatedMetricValue`, `BentoCard` con física de resorte (`COCKPIT_SPRING`), `AccordionBody` para desplegables técnicos y envoltorio `<MotionConfig reducedMotion="user">` en `src/App.tsx`.
   - Pulso radar animado en el nodo local del mapa `Leaflet` (`NetworkSecurityView.tsx`) y modales/toasts con `<AnimatePresence>`.
3. **Puntos de muestreo estrictamente ENCIMA de la línea en todas las gráficas**:
   - `src/components/TelemetryChart.tsx` y simulador `<canvas>` en `static/manual.html`: interpolación cúbica monótona `Fritsch–Carlson`, barrido horizontal luminoso sin desviación geométrica (`0.00px`) sobre el propio spline completo, orden estricto de capas (`relleno -> trazo spline -> barrido -> vértices en capa superior -> baliza sonar final -> aro hover`) garantizando que ningún punto flote fuera de la curva ni quede tapado por el trazo.
4. **Banner principal de Red e Internet + Discos duros, extraíbles y deduplicación real de NAS**:
   - En `OverviewView.tsx`: cuadrícula principal `2x2` con **CPU**, **Memoria RAM**, **GPU / Gráficos** y **Red e Internet** (gráfica HiDPI de `20m` Rx/Tx con modal ampliable `chartKind: 'net'`), acompañada del bloque **Almacenamiento y discos disponibles**.
   - En `server.py` (`fetch_disks_worker`, `_read_lsblk_metadata`, `_read_hwmon_disk_temps`, `_format_transport_badge`, `_compute_pool_key`), `vite.config.ts` (`sampleRealDisks`) y `src/types/telemetry.ts` (`DiskInfo`): lectura 100 % dinámica del sistema operativo Linux mediante `lsblk -J -b`, `psutil`/`df` y `/sys/class/hwmon`. Se listan por separado discos internos (NVMe/SATA), memorias extraíbles USB/SD (montadas o desmontadas) y recursos compartidos NAS, agrupando mediante `pool_key` los montajes que apuntan al mismo servidor/RAID remoto (evitando multiplicar los terabytes cuando varias carpetas comparten el mismo NAS).

## 2. Verificación Planificada
- Comprobación de tipos TypeScript (`npx tsc --noEmit`) y compilación Vite -> `static/index.html` (`npm run build`).
- Comprobación sintáctica Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`) y prueba en vivo de deduplicación de discos con los datos reales del equipo (`lsblk` + `psutil`).
- Generación, firma GPG e instalación local del paquete `.deb` (`bash packaging/build_deb.sh`, `sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.5.0_amd64.deb`, `/usr/bin/recursos-cockpit --test-mode`, `dpkg -l`).
- Despliegue limpio sobre `/home/servidor/servicios/dashboard` preservando `recursos_history.db`, verificación HTTP (`/api/version`, `/api/metrics`) e inspección visual en navegador (`http://127.0.0.1:8085/` y `/manual`).

