# Walkthrough v14.2.0 — Gráfica Térmica de CPU, Widgets Dinámicos de CPU e Historial SQLite Universal

## Resumen de Cambios
1. **Temperatura de CPU en Todas las Gráficas de Procesador (`/inicio`, `/equipo/cpu` e Inspección Táctil)**:
   - Se incorporó la lectura dinámica de sensores térmicos (`_read_cpu_temp_and_sensors()` en `server.py` y `readRealCpuTempDev()` en `vite.config.ts`) priorizando `/sys/class/hwmon`, `/sys/class/thermal` y `psutil.sensors_temperatures()`, más lectura opcional de consumo eléctrico RAPL (`/sys/class/powercap`), gobernador de frecuencia y desglose de tiempos (`user`, `system`, `iowait`) con bandera `capabilities` sin hardcoding ni valores ficticios.
   - `OverviewView.tsx`, `EquipmentView.tsx` y `ExpandedChartModal.tsx` grafican la temperatura (`°C`) sobre el eje derecho (curva discontinua naranja térmico `#fb923c` / `#ea580c`) junto al porcentaje de uso de CPU (`%`), con techo dinámico auto-ajustable en `TelemetryChart.tsx` cuando se supera `maxRight`.

2. **Arquitectura Modular de Widgets en `/equipo/cpu` (Adaptada desde `/equipo/gpu`)**:
   - Tarjeta principal con resumen de 4 sensores en vivo (`Frecuencia`, `Temperatura`, `Carga 1m/5m` y `Consumo RAPL` o `Núcleos lógicos`).
   - Barra dinámica de activación de gráficas según sensores realmente detectados (`active / total`).
   - Rejilla fluida `.cockpit-auto-grid` de sub-gráficas CPU ampliables a Inspección Táctil:
     - **Uso de CPU y Temperatura (`usage_temp`)**
     - **Consumo Eléctrico RAPL y Temperatura (`power_temp`)** *(o solo Temperatura si no existe sensor RAPL)*
     - **Frecuencia de Reloj (`freq`)**
     - **Desglose de Ejecución: Usuario / Sistema / Espera E/S (`times`)**
     - **Cola de Carga del Sistema: Load 1m / 5m (`load`)**
   - Conserva debajo la carga por hilo/núcleo, la banda opcional de sensores térmicos detectados, detalles técnicos desplegables y `ResourceProcessesPanel`.

3. **Historial Completo Universal en `recursos_history.db` (Eliminación del Tope de 20 Minutos)**:
   - Se amplió la tabla `telemetry_history` en `server.py`, `packaging/debian/postinst` y `vite.config.ts` con las **18 sub-métricas extendidas de CPU y GPU**:
     `cpu_temp`, `cpu_freq`, `cpu_power`, `cpu_load_1m`, `cpu_load_5m`, `cpu_user`, `cpu_system`, `cpu_iowait`, `gpu_vram_pct`, `gpu_mem_ctrl`, `gpu_enc`, `gpu_dec`, `gpu_power`, `gpu_temp`, `gpu_clk_gfx`, `gpu_clk_mem`, `gpu_pcie_rx`, `gpu_pcie_tx`.
   - Migración automática e idempotente `ALTER TABLE` en `init_telemetry_db()` sobre bases de datos existentes sin pérdida de historial previo, y soporte completo en consultas directas y submuestreadas `GROUP BY` (`20m`, `1h`, `6h`, `24h`, `all`).
   - Todas las sub-gráficas de CPU y GPU en `EquipmentView.tsx` envían `metricKey` hacia `ExpandedChartModal.tsx`, desbloqueando `En vivo · 20m · 1h · 6h · 24h · Todo` y el desplazamiento temporal histórico en todas las gráficas sin excepción.

4. **Internacionalización, Versión y Documentación**:
   - Registradas las **30 nuevas claves `hardware.cpu.*`** en `./i18n/dictionary.csv` con traducciones en los **31 idiomas** (`1062` claves × `31` idiomas, 33 columnas exactas, 0 claves faltantes en `src/`).
   - `./VERSION` actualizada a **`14.2.0`** (`MINOR`) y `./README.md` sincronizado.

## Verificación Realizada (`GEMINI.md` Regla 7.2)
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **OK** (0 errores, 0 variables/parámetros sin uso).
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`: **OK**.
- Integridad de `./i18n/dictionary.csv`: **1062 claves × 31 idiomas**, 0 filas malformadas, 0 claves faltantes en `src/`.
- Prueba unitaria de `server.py`: `get_cpu_info()`, migración `ALTER TABLE` desde esquema previo, inserción y consultas `20m`/`1h`/`24h`/`all` (directas y submuestreadas `GROUP BY`) para las 18 columnas extendidas: **OK**.
- `npm run build`: **OK** (`dist/` y `static/` regenerados sin assets obsoletos).
- `bash packaging/build_deb.sh`: **OK** (`dist/recursos-cockpit_14.2.0_amd64.deb` generado y firmado GPG, verificado sin archivos `.db`).
- `compile_applet`, `lint_applet` y reinicio de servidor de desarrollo: ejecutados y verificados en limpio.
