# Walkthrough v12.16.2 — Optimización y Memoización de Gráficas de Telemetría

**Versión**: `12.16.2` (`./VERSION`, incremento `PATCH`)  
**Fecha**: 2026-11-16

---

## Cambios Implementados

1. **`src/components/TelemetryChart.tsx`**:
   - **`useMemo` para buckets de datos (`bucketedSeries`)**: encapsula `buildSeriesBuckets(...)` preservando picos y valles (min/max cronológico por bucket cuando la serie supera la densidad en píxeles del lienzo).
   - **`useMemo` para ejes y rejilla (`axisLayout`) y coordenadas vectoriales (`computedSeriesGeometry`)**: precalcula ticks X/Y, anchos de etiquetas y puntos `{ x, y }` fuera del bucle de animación de 30 FPS (`requestAnimationFrame`).
   - **`React.memo` con comparador de cambio significativo (`areTelemetryChartPropsEqual`)**: bloquea re-renderizados innecesarios cuando las fluctuaciones del sensor permanecen por debajo del umbral significativo por unidad (`%`, `°C`, `MB/s` dinámico por pico, o `significantDelta` explícito), reaccionando inmediatamente ante cambios reales, transiciones activo↔inactivo, variaciones de longitud o desplazamientos de ventana (`epochTs`).

2. **Memoización de Buckets en Vistas y Modales**:
   - **`src/components/OverviewView.tsx`**: extraído `OverviewDiskCard` (`React.memo`) con `useMemo` sobre el recorte de 5 minutos (`io_history`) y los arrays de lectura/escritura/fechas.
   - **`src/components/NetworkSecurityView.tsx`**: extraído `NicHistoryCard` (`React.memo`) con `useMemo` sobre `history_2h` (WAN/LAN Rx/Tx, timestamps y épocas) y `useCallback` para etiquetas.
   - **`src/components/ExpandedChartModal.tsx`**: consolidado `liveBucketWindow` en un único `useMemo` reutilizado por `resolvedSeries`, `resolvedTimestamps` y `resolvedEpochTs`.
   - **`src/components/EquipmentView.tsx`**: estabilizadas referencias `timestamps`/`epochTs` y completada dependencia `locale` en `gpuSubgraphs`.
