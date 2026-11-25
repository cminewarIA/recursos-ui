# Plan de Implementación — v14.2.0 (Temperatura en Gráfica CPU, Widgets CPU estilo GPU e Historial Completo Universal)

## 1. Objetivos y Motivación
1. **Gráfica de CPU con Temperatura (`%` + `°C`)**: Integrar la serie histórica y en tiempo real de temperatura de CPU (`cpu_temp`) directamente sobre la gráfica principal de CPU (tanto en `/inicio` como en `/equipo/cpu` y en el modal ampliado `ExpandedChartModal`), usando eje izquierdo (`0–100 %`) y eje derecho (`°C`) con tooltip unificado y estadísticas `Mín · Media · Máx`.
2. **Widgets de CPU Adaptados al Patrón Dinámico de GPU (`/equipo/cpu`)**: Replicar el diseño modular de `/equipo/gpu` (tarjeta de cabecera con KPIs y tira de 4 sensores, barra dinámica de activación/desactivación de sub-gráficas según sensores disponibles en el hardware, y rejilla fluida `cockpit-auto-grid` de sub-gráficas interactivas ampliables) adaptado a métricas reales de CPU:
   - **Uso y Temperatura CPU** (`%` + `°C`)
   - **Temperatura y Consumo Eléctrico** (`°C` + `W` vía RAPL `/sys/class/powercap` si disponible)
   - **Frecuencia de Reloj** (`MHz` actual / rango mín–máx y gobernador `scaling_governor`)
   - **Desglose de Ejecución** (`Usuario %`, `Sistema/Kernel %`, `Espera E/S %`)
   - **Cola de Carga del Sistema** (`Load 1m` y `Load 5m` respecto a hilos lógicos)
   Manteniendo debajo la rejilla de carga por núcleo (`cockpit-cores-grid`), detalles técnicos desplegables y el panel de procesos consumidores de CPU.
3. **Historial Completo en SQLite (`recursos_history.db`) para TODAS las Gráficas (Fin del Límite de 20 Minutos)**:
   - Persistir en `telemetry_history` (migración idempotente `ALTER TABLE` en `server.py` + esquema actualizado en `packaging/debian/postinst` + paridad en `vite.config.ts`) tanto las nuevas series de CPU (`cpu_temp`, `cpu_freq`, `cpu_power`, `cpu_load_1m`, `cpu_load_5m`, `cpu_user`, `cpu_system`, `cpu_iowait`) como TODAS las sub-métricas de GPU (`gpu_vram_pct`, `gpu_mem_ctrl`, `gpu_enc`, `gpu_dec`, `gpu_power`, `gpu_temp`, `gpu_clk_gfx`, `gpu_clk_mem`, `gpu_pcie_rx`, `gpu_pcie_tx`).
   - Asignar `metricKey` a todas las sub-gráficas de GPU y CPU en `EquipmentView.tsx` y eliminar el límite `GPU_SUB_PRESETS` de 20 minutos en `ExpandedChartModal.tsx` para que **todas** las gráficas del dashboard ofrezcan `En vivo · 20m · 1h · 6h · 24h · Todo`, deslizador cronológico y arrastre panorámico sobre `recursos_history.db`.

## 2. Ubicación Funcional y Coherencia (`GEMINI.md` Regla 3.1)
- `/inicio` (`OverviewView.tsx`): La tarjeta de CPU añade la curva de temperatura (`°C` en eje derecho cuando hay sensor térmico activo) y su modal ampliado consulta el historial completo en `recursos_history.db`.
- `/equipo/cpu` (`EquipmentView.tsx`): Consolida la vista detallada de CPU con cabecera de sensores, barra dinámica de sub-gráficas y rejilla `cockpit-auto-grid` de widgets CPU, manteniendo la paridad visual Alethia × Zeus Vision con `/equipo/gpu`.
- `/equipo/gpu` (`EquipmentView.tsx`): Todas las 6 sub-gráficas (`compute`, `vram`, `video`, `power_temp`, `clocks`, `pcie`) pasan a vincularse a `telemetry_history` vía `metricKey`, desbloqueando el historial completo más allá de 20 minutos.

## 3. Cambios por Archivo
- `server.py`:
  - Mejorar `get_cpu_info()` con lectura dinámica de temperatura (`hwmon` priorizado + `/sys/class/thermal` + `psutil.sensors_temperatures()`), potencia RAPL (`/sys/class/powercap`, comprobando `os.path.exists()` y permisos), gobernador `cpufreq`, desglose `cpu_times_percent` (`user`, `system`, `iowait`) y `capabilities` dinámicas.
  - Ampliar `telemetry_history` con migración segura `ALTER TABLE` para las 18 nuevas columnas (`cpu_temp`, `cpu_freq`, `cpu_power`, `cpu_load_1m`, `cpu_load_5m`, `cpu_user`, `cpu_system`, `cpu_iowait`, `gpu_vram_pct`, `gpu_mem_ctrl`, `gpu_enc`, `gpu_dec`, `gpu_power`, `gpu_temp`, `gpu_clk_gfx`, `gpu_clk_mem`, `gpu_pcie_rx`, `gpu_pcie_tx`).
  - Actualizar `_HISTORY_BUCKETS_20M`, `HISTORY`, `preload_telemetry_history_from_sqlite`, `record_telemetry_sample_to_sqlite`, `_format_telemetry_rows_payload` y `query_telemetry_history_from_sqlite` (incluyendo agregaciones `GROUP BY` para ventanas largas).
- `packaging/debian/postinst`: Sincronizar el esquema inicial de `telemetry_history`.
- `vite.config.ts`: Añadir lectura real de sensores Linux (`/sys/class/hwmon`, `/sys/class/thermal`, `/sys/devices/system/cpu/cpu0/cpufreq`, `/proc/stat` para `user`/`system`/`iowait`) y persistencia en `TelemetryHistoryRow` / `/api/metrics/history`.
- `src/types/telemetry.ts`: Extender `CpuInfo` (`capabilities`, `power_watts`, `governor`, `user_percent`, `system_percent`, `iowait_percent`), `TelemetryMetricKey` y `HistorySeries`.
- `src/components/TelemetryChart.tsx`: Escala dinámica en eje derecho (`computedMaxRight`) para que series en `°C` nunca se recorten y mantengan etiquetas claras.
- `src/components/OverviewView.tsx`: Incorporar `cpu_temp` en la gráfica de CPU y en `ExpandChartSpec`.
- `src/components/EquipmentView.tsx`: Incorporar widgets dinámicos de CPU estilo GPU, `cpu_temp` en gráfica CPU y `metricKey` en todas las sub-gráficas de CPU y GPU.
- `src/components/ExpandedChartModal.tsx`: Usar historial completo de base de datos (`WINDOW_PRESETS`) para todas las sub-gráficas de GPU y CPU; conservar los buckets de 5s en vivo (`live`) para alta fluidez y consultar `/api/metrics/history` para `20m`–`Todo`.
- `i18n/dictionary.csv`: Registrar todas las nuevas claves `hardware.cpu.*` en los 31 idiomas.
- `VERSION`, `README.md`, `planes/walkthrough_v14.2.0.md`: Incrementar versión a `14.2.0` (`MINOR`) y documentar verificación completa.
