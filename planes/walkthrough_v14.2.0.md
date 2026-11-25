# Walkthrough v14.2.0 — Gráfica Térmica de CPU, 6 Widgets Dinámicos de CPU e Historial SQLite Universal Sin Tope de 20m

## Resumen de Cambios
1. **Temperatura de CPU en Todas las Gráficas de Procesador (`/inicio`, `/equipo/cpu` e Inspección Táctil)**:
   - Lectura dinámica de sensores térmicos (`_read_cpu_temp_and_sensors()` en `server.py` y `readRealCpuTempDev()` en `vite.config.ts`) priorizando `/sys/class/hwmon`, `/sys/class/thermal` y `psutil.sensors_temperatures()`, junto con consumo eléctrico RAPL (`/sys/class/powercap`), gobernador de frecuencia y desglose de tiempos (`user`, `system`, `iowait`) con bandera `capabilities` sin hardcoding ni valores ficticios.
   - `OverviewView.tsx`, `EquipmentView.tsx` y `ExpandedChartModal.tsx` representan la temperatura (`°C`) sobre el eje derecho como curva discontinua naranja térmico (`#fb923c` / `#ea580c`) sobre el porcentaje de uso de CPU (`%`), con techo dinámico auto-ajustable en `TelemetryChart.tsx`.

2. **6 Widgets Modulares Dinámicos en `/equipo/cpu` (Adaptados desde `/equipo/gpu`)**:
   - Cabecera resumen de 4 sensores en vivo (`Frecuencia`, `Temperatura`, `Carga 1m/5m` y `Consumo RAPL` o `Núcleos lógicos`) y barra dinámica de activación de gráficas según sensores realmente detectados (`active / total`).
   - Rejilla fluida `.cockpit-auto-grid` con pie narrativo `Media · Pico · Actual` (`ChartNarrativeFooter`) y ampliación a Inspección Táctil para los **6 widgets**:
     1. **Uso de CPU y Temperatura (`usage_temp`)**
     2. **Consumo Eléctrico RAPL y Temperatura (`power_temp`)** *(o solo Temperatura si no existe sensor RAPL)*
     3. **Frecuencia de Reloj y Gobernador (`freq`)**
     4. **Desglose de Ejecución: Usuario / Sistema / Espera E/S (`times`)**
     5. **Cola de Carga del Sistema: Load 1m / 5m (`load`)**
     6. **Sensores Térmicos por Sonda (`thermal_probes`)**: serie multi-sonda en vivo (`temp_sensors_history`) + filas táctiles individuales por sonda con barra térmica, estado semántico (`Óptima` / `Elevada` / `Crítica`) y acceso directo al historial SQLite individual de cada sonda.
   - Conserva debajo la carga por hilo/núcleo, detalles técnicos desplegables y `ResourceProcessesPanel`.

3. **Historial Completo Universal en `recursos_history.db` (Sin Tope de 20 Minutos en CPU, GPU, Red y Disco)**:
   - Ampliación de `telemetry_history` en `server.py`, `packaging/debian/postinst` y `vite.config.ts` con **18 sub-métricas extendidas de CPU y GPU** (`cpu_temp`, `cpu_freq`, `cpu_power`, `cpu_load_1m`, `cpu_load_5m`, `cpu_user`, `cpu_system`, `cpu_iowait`, `gpu_vram_pct`, `gpu_mem_ctrl`, `gpu_enc`, `gpu_dec`, `gpu_power`, `gpu_temp`, `gpu_clk_gfx`, `gpu_clk_mem`, `gpu_pcie_rx`, `gpu_pcie_tx`) con migración idempotente `ALTER TABLE`.
   - Nueva tabla granular **`device_series_history`** + índice `idx_dev_series_lookup` y endpoint **`GET /api/metrics/entity-history`** (con submuestreo SQL `GROUP BY` para ventanas largas y `"all"`) para persistir y consultar individualmente cada **disco físico/partición (`disk`)**, cada **interfaz de red (`nic`)** y cada **sonda térmica de CPU (`cpu_sensor`, individual y multi-sonda `*`)**.
   - Eliminación total de `GPU_SUB_PRESETS` (tope de 20m) en `ExpandedChartModal.tsx`; todas las gráficas de CPU, GPU, red (router y por NIC) y almacenamiento (global y por disco en `/inicio` y `/equipo/almacenamiento`) ofrecen `En vivo · 20m · 1h · 6h · 24h · Todo` y desplazamiento temporal histórico continuo.

4. **Internacionalización, Versión y Documentación**:
   - Registradas **36 nuevas claves `hardware.cpu.*`** (incluyendo las 6 claves del widget de sensores térmicos por sonda) en `./i18n/dictionary.csv` con traducciones en los **31 idiomas** (`1068` claves × `31` idiomas, 33 columnas exactas, 0 claves faltantes en `src/`).
   - `./VERSION` en **`14.2.0`** (`MINOR`) y `./README.md` sincronizado.

## Verificación Realizada (`GEMINI.md` Regla 7.2)
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **OK** (0 errores, 0 variables/parámetros sin uso).
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`: **OK**.
- Integridad de `./i18n/dictionary.csv`: **1068 claves × 31 idiomas** (33 columnas exactas), 0 filas malformadas, 0 duplicados, 0 claves faltantes en `src/`.
- Pruebas unitarias de `server.py` sobre SQLite temporal:
  - `telemetry_history`: migración `ALTER TABLE` + 18 columnas extendidas + consultas directas y submuestreadas `GROUP BY`: **OK**.
  - `device_series_history`: inserción en lote (`record_device_series_batch_to_sqlite`), buffer vivo multi-sonda (`get_cpu_thermal_probes_live_payload`) y consultas `query_device_series_history_from_sqlite` para `disk`, `nic`, sonda individual `cpu_sensor` y multi-sonda `*` (`3600`, `86400`, `all` submuestreado): **OK**.
- `npm run build`: **OK** (`dist/` y `static/` regenerados sin assets obsoletos).
- `bash packaging/build_deb.sh`: **OK** (`dist/recursos-cockpit_14.2.0_amd64.deb` generado y verificado sin archivos `.db`).
- `compile_applet`, `lint_applet` y reinicio de servidor de desarrollo: verificados en limpio.
