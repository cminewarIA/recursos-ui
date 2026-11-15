# Bitácora de Verificación — Recursos Cockpit v12.10.0

## Resumen de Cambios Implementados

1. **Control de Versión (`./VERSION`) e Internacionalización (`./i18n/dictionary.csv`)**:
   - `./VERSION` incrementado de `12.9.0` a `12.10.0` (`MINOR`).
   - `./i18n/dictionary.csv` ampliado a `739` filas (`734` claves activas en `es`) con las claves bajo `equipment.active_procs.*`, `hardware.gpu.*` y `charts.presets.gpu_20m` para procesos consumidores por recurso, sub-gráficas GPU según sensores y ventana de `20 min` en sub-gráficas GPU.

2. **Backend (`server.py`) y Middleware Dev (`vite.config.ts`)**:
   - `get_gpu_info()` (con soporte NVIDIA XML + `nvidia-smi pmon -c 1 -s um` y respaldo AMD/Intel DRM `sysfs`/`hwmon`): calcula dinámicamente el mapa `capabilities` (`compute`, `vram`, `mem_ctrl`, `encoder`, `decoder`, `jpeg`, `ofa`, `power`, `temp`, `mem_temp`, `clocks`, `pcie`, `fan`), lectura de potencia en `<gpu_power_readings/instant_power_draw>`, frecuencias, transferencia PCIe RX/TX en KB/s, porcentajes por proceso y buffer móvil de 20 minutos (`_GPU_HISTORY_BUCKETS_20M` en cubetas de 5 s) expuesto en `gpu.history`.
   - `get_system_processes(gpu_map=None, disk_io_total_bps=0.0)`: calcula deltas por PID de `/proc/<pid>/io` (`io_read_bps`, `io_write_bps`, `io_total_bps`, `io_percent`), conexiones de red por PID (`net_connections`, `net_established`, `net_percent`, `net_ports`), núcleos e hilos CPU (`cpu_norm_percent`, `cpu_cores_used`, `num_threads`), memoria privada/compartida (`mem_percent`, `priv_mb`, `shared_mb`) y consumo GPU/VRAM (`vram_mb`, `vram_percent`, `gpu_util_percent`, `gpu_mem_percent`, `gpu_enc_percent`, `gpu_dec_percent`).
   - `sampleRealProcesses()` en `vite.config.ts` actualizado con las métricas por proceso (`cpu_norm_percent`, `cpu_cores_used`, `num_threads`, `mem_percent` y deltas de `/proc/<pid>/io`).

3. **Frontend React 19 (`src/`)**:
   - `src/types/telemetry.ts`: añadidas las interfaces `GpuCapabilities` y `GpuHistorySample`, y ampliados `GpuProcessInfo`, `GpuInfo` y `SystemProcess`.
   - `src/components/ResourceProcessesPanel.tsx`: componente simétrico compartido para `cpu`, `ram`, `gpu`, `storage` y `net` que muestra procesos consumidores activos con su `%` relativo y su consumo real.
   - `src/components/EquipmentView.tsx`: integrado `<ResourceProcessesPanel>` debajo de las gráficas en `Procesador`, `Memoria`, `Gráfica` y `Almacenamiento`; implementada la vista multi-gráfica reactiva en `Gráfica` (`compute`, `vram`, `video`, `power_temp`, `clocks`, `pcie`) activada o bloqueada dinámicamente según `gpu.capabilities`; añadida columna/ordenación de E/S de almacenamiento en la tabla completa de procesos.
   - `src/components/OverviewView.tsx` y `src/components/ExpandedChartModal.tsx`: soporte de `gpuSubmetric` con historial en vivo `5 min` / `20 min` desde `liveMetrics.gpu.history` y renderizado de `<ResourceProcessesPanel compact />` en la parte inferior de las ventanas de inspección táctil.

4. **Documentación (`static/manual.html`, `docs/index.html`, `README.md`)**:
   - Actualizado el listado histórico en `static/manual.html` manteniendo el primer elemento dinámico vinculado a `./VERSION` (`resolvedCanonicalVer`) y copiado bit a bit a `docs/index.html`.
   - Actualizado `README.md` en `Vista 2 · /equipo` y tabla de diferencias arquitectónicas.

---

## Verificaciones Ejecutadas

- **Paridad HTML / JS del Manual**:
  - `sha256sum static/manual.html docs/index.html` idéntico (`12a4dc5db4487c51170204cff7783877feae6fb55210241313f343544df5c450`).
  - Validación JS en Node (`MANUAL_JS_OK scripts=1`).
- **Paridad de Diccionario y Build Frontend/Python**:
  - Validación de claves i18n: `CSV_KEYS=736 CHECKED=412 MISSING=0` (y `USED_DOTTED=441 MISSING=0`).
  - `python3 -m py_compile i18n_catalog.py server.py desktop_app/recursos_app.py` sin errores.
  - `npx tsc --noEmit && npm run build` completado correctamente (`dist/` y `static/index.html` generados).
- **Empaquetado e Instalación Simultánea (`bash packaging/install_all.sh`)**:
  - Paquete Debian generado, firmado con GPG (`4CFC86D58E9146AE`) y reinstalado localmente:
    - `dpkg -l | grep recursos-cockpit` -> `ii recursos-cockpit 12.10.0 amd64`.
    - `/usr/bin/recursos-cockpit --test-mode` -> `[OK] Recursos Native Ubuntu HTML5 App v12.10.0 validated successfully` (`dex_unlocked: True`).
  - APK Android / Android TV compilada (`assembleRelease`), firmada y desplegada por ADB en `TCL Percee TV (SDK 26 · 192.168.50.187:5555)` (`versionCode=121000 minSdk=26 targetSdk=34 versionName=12.10.0`).
  - Integridad `SHA-256` verificada idéntica en las 4 copias de `i18n/dictionary.csv` (`c2a45fcb737e2ca1cb304a9313a155f9bdc942ebb46b717186144ca7e8358887`): repositorio, `/usr/lib/recursos-cockpit/i18n/dictionary.csv`, `android_app/app/build/generated/recursos_assets/i18n/dictionary.csv` y `/home/servidor/servicios/dashboard/i18n/dictionary.csv`.
- **Servicio Productivo (`/home/servidor/servicios/dashboard`, `system-dashboard.service`)**:
  - Servicio reiniciado y en estado `active` preservando `recursos_history.db`, secretos y cachés locales.
  - Endpoints verificados sobre `http://127.0.0.1:8085`:
    - `GET /` -> `HTTP 200` (`len=676585`, `has_active_procs_key=True`).
    - `GET /manual` -> `HTTP 200` (`len=99881`, `has_init_ver=True`).
    - `GET /readme` -> `HTTP 200`.
    - `GET /i18n/dictionary.csv` -> `HTTP 200` (`739` líneas).
    - `GET /api/version` -> `HTTP 200` (`version=12.10.0`).
    - `GET /api/dictionary` -> `HTTP 200` (`locales=['es']`, `keys=734`, `new_ok=True`).
    - `GET /api/metrics` -> `HTTP 200` (`NVIDIA GeForce GTX 1650`, `13` capacidades en `gpu.capabilities`, `gpu.history`, `gpu.processes` y `108` procesos en `system_processes` con CPU normalizado, núcleos/hilos, RAM privada, deltas de E/S en B/s y conexiones de red).
