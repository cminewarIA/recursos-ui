# Plan de Implementación v14.8.0 — Registro de Temperatura en Gráficas (GPU y Discos)

## Justificación Funcional y Ubicación
El usuario solicitó mostrar el **registro de temperatura en la gráfica igual que ya está en CPU** (curva superpuesta en el eje derecho `°C`, línea discontinua naranja térmico `#fb923c` / `#ea580c`, `fillAlpha: 0`, `maxRight: 100`, preservando el historial completo en `recursos_history.db`).

Ubicaciones naturales según el dominio:
1. **`/inicio` (`OverviewView.tsx`)**:
   - Tarjeta **GPU**: superposición de `gpu_temp` (`°C`) sobre uso GPU (`%`), replicando exactamente el patrón de la tarjeta CPU.
   - Tarjetas individuales de **Discos con sensor térmico** (`DiskCard` cuando `temp_c != null`): superposición de `disk_temp` (`°C`) sobre lectura/escritura (`MB/s`).
2. **`/equipo/gpu` (`EquipmentView.tsx`)**:
   - Gráfica principal y sub-gráfica `compute`: superposición de `gpu_temp` (`°C`) igual que `usage_temp` en CPU.
3. **`/equipo/almacenamiento` (`EquipmentView.tsx`)**:
   - Al inspeccionar/ampliar un disco individual con sensor térmico: superposición de `disk_temp` (`°C`) sobre lectura/escritura. (La gráfica agregada global de almacenamiento conserva el eje derecho para ocupación `%`).
4. **Modal expandido (`ExpandedChartModal.tsx`)**:
   - Soporte de ventana en vivo (`5 min` / `20 min`) e historial completo SQLite (`telemetry_history.gpu_temp` y `device_series_history.val4` → `disk_temp`).

## Archivos Modificados
- `VERSION` (`14.7.2` → `14.8.0`)
- `server.py` (persistencia de `temp` en `io_history` y `val4`/`disk_temp` en `device_series_history`)
- `src/types/telemetry.ts` (`DiskIoSample.temp`, `TelemetryMetricKey` y `HistorySeries` con `disk_temp`)
- `src/components/OverviewView.tsx` (`gpuSeries` y `DiskCard` dual-axis)
- `src/components/EquipmentView.tsx` (`gpuSeries`, `compute` de GPU e inspección individual de discos)
- `src/components/ExpandedChartModal.tsx` (`GPU_SUB_HISTORY_FIELD_MAP`, buckets en vivo de disco y series SQLite `disk_temp`)
- `README.md` y `planes/walkthrough_v14.8.0.md`
