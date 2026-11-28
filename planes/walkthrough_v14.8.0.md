# Walkthrough v14.8.0 — Registro de Temperatura en Gráficas (GPU y Discos)

## Cambios Implementados
1. **Versión y Documentación**:
   - `VERSION`: `14.7.2` → `14.8.0` (`UBUNTU_VERSION` y `ANDROID_VERSION` sin cambios al no modificar código nativo).
   - `planes/implementation_plan_v14.8.0.md` y `README.md` actualizados.

2. **Backend (`server.py`)**:
   - `_update_disk_io_history()`: registra `"temp"` (°C) en cada muestra de `io_history` para los discos con sensor `temp_c` válido (`> 0`), manteniéndolo omitido en discos sin sensor.
   - Bucle de persistencia `device_series_history`: guarda `temp_c` en `val4` para entradas `"disk"` (`0.0` si no hay sensor).
   - `query_device_series_history_from_sqlite()`: expone `series.disk_temp = v4_list` para `entity_kind == "disk"`.

3. **Frontend (`src/types/telemetry.ts`, `OverviewView.tsx`, `EquipmentView.tsx`, `ExpandedChartModal.tsx`)**:
   - `OverviewView.tsx`:
     - Tarjeta **GPU**: superpone la serie `gpu_temp` (`°C`, eje derecho discontinuo naranja térmico `#fb923c` / `#ea580c`, `fillAlpha: 0`, `maxRight: 100`) sobre el uso de GPU, siguiendo el mismo patrón de CPU.
     - Tarjetas **`DiskCard`** (cuando el disco tiene `temp_c` o histórico `temp > 0`): superpone `disk_temp` en el eje derecho discontinuo (`°C`, `maxRight: 100`) con *forward-fill* desde la primera muestra térmica válida. Los discos sin sensor no muestran curva ni eje derecho.
   - `EquipmentView.tsx`:
     - Vista **GPU**: añade `gpu_temp` al `gpuSeries` principal y a la sub-gráfica `compute` (`maxRight: 100`).
     - Vista **Almacenamiento**: al expandir un disco individual con sensor térmico, incluye la serie `disk_temp` (`°C` en eje derecho) y `maxRight: 100`.
   - `ExpandedChartModal.tsx`:
     - `GPU_SUB_HISTORY_FIELD_MAP`: añade `gpu_compute` (`util`) y `gpu_temp_overlay` (`temp`).
     - Live `disk` y modo histórico SQLite (`device_series_history`): resuelve la serie `disk_temp` sin ceros artificiales iniciales en ventana en vivo y con los valores reales persistidos en SQLite.

## Verificaciones Ejecutadas (después de la última edición)
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **OK** (0 errores).
- `python3 -m py_compile server.py`: **OK** (0 errores).
- Integridad `i18n/dictionary.csv`: **OK** (`1246` filas, `33` columnas, `0` filas descuadradas; claves reutilizadas `hardware.cpu.series_temp` y `hardware.gpu.series_temp`).
- `npm run build` (`vite v8.3.8`): **OK** (`2092 modules transformed`, bundle generado en `static/index.html` de `2.3 MB`).
- Despliegue local en `/home/servidor/servicios/dashboard` y reinicio de `system-dashboard.service`: **active**.
- Comprobación HTTP en vivo (`http://127.0.0.1:8085`):
  - `GET /`: `200 OK` (`2300996` bytes).
  - `GET /api/metrics`: versión `14.8.0`; `gpu.temp_c = 45`, `history.gpu_temp[-3:] = [43.0, 44.0, 45.0]`; disco `/dev/nvme0n1p2` con `temp_c = 34.9` y `io_history[-2:]` incluyendo `"temp": 34.9`; disco `/dev/sda1` (`temp_c = None`) sin campo `"temp"`.
  - `GET /api/metrics/entity-history?kind=disk&id=/dev/nvme0n1p2&window_sec=1200`: `ok: true`, `returned_samples: 180`, claves `['timestamps', 'date_timestamps', 'epoch_ts', 'disk_r', 'disk_w', 'disk_pct', 'disk_temp']`, `disk_temp[-3:] = [34.9, 34.9, 34.9]`.
