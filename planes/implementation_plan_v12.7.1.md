# Plan de Implementación — Recursos Cockpit `v12.7.1`

**Fecha**: 2026-11-14  
**Versión previa**: `12.7.0` (`2743999` + tag `v12.7.0`)  
**Versión objetivo**: `12.7.1` (`PATCH` según `GEMINI.md`: ajuste de ventana temporal a `5 min` en Inicio y limpieza de densidad de puntos en las gráficas)

---

## 1. Diagnóstico en Código Fuente

1. **Ventana temporal de 20 minutos en Inicio (`OverviewView.tsx`, `server.py`)**:
   - `server.py` acumula el búfer en vivo a `HISTORY_WINDOW_SECONDS = 1200` (20 minutos) y `OverviewView.tsx` pasaba íntegramente `history` (`20 min`) a las tarjetas de `Inicio` (`CPU`, `RAM`, `GPU`, `Red e Internet`), mientras `DISK_BANDWIDTH_HISTORY` guardaba solo `MAX_DISK_HISTORY_SAMPLES = 90` cada `1.2 s` (~`2.2 min`).
   - En consecuencia, las tarjetas de **Inicio** mostraban `20 min` en lugar de `5 min`, con distinta escala temporal entre CPU/RAM/GPU/Red y discos.

2. **Exceso de puntos visibles en todas las gráficas (`TelemetryChart.tsx`)**:
   - `TelemetryChart.tsx` ejecutaba un bucle intermedio (`for (let i = 0; i < pts.length - 1; i++)`) dibujando marcadores circulares cada `minSpacingPx = 11` píxeles a lo largo de toda la curva (`~25–80` puntos por serie y más de `50–160` en series dobles de Red y Disco), saturando visualmente las líneas.

---

## 2. Cambios Planificados

1. **`src/components/TelemetryChart.tsx`**:
   - Eliminar el bucle de puntos intermedios cada `11 px`, conservando curvas continuas Fritsch–Carlson limpias.
   - Mantener estrictamente en las capas superiores (por encima de todas las curvas y centrados en las coordenadas exactas sobre la línea):
     - El **punto vivo final con pulso sonar** (`pts[pts.length - 1]`).
     - Los **marcadores interactivos de muestreo** al inspeccionar con ratón o toque (`hoverIdx`).
   - Evitar etiquetas `HH:MM` repetidas en el eje X en ventanas cercanas a `5 min` usando `HH:MM:SS` automáticamente si hubiera colisión entre ticks consecutivos.

2. **`src/components/OverviewView.tsx` & `src/components/ExpandedChartModal.tsx`**:
   - Filtrar las series e historiales de **Inicio** (`Procesador`, `Memoria RAM`, `Tarjeta gráfica`, `Red e Internet` y cada widget independiente de almacenamiento) a los **últimos `5 minutos` (`300 s`)** por marca temporal (`epoch_ts` / `t`), con fallback `.slice(-60)`.
   - Actualizar `ExpandedChartModal.tsx` para ofrecer el modo en directo como **`En vivo · 5 min`** (recorte `300 s` en tiempo real) conservando los selectores históricos **`20 min`**, **`1 h`**, **`6 h`**, **`24 h`** y **`Todo`**, e incluir soporte en `En vivo · 5 min` / `20 min` para la gráfica global de Red (`chartKind === 'net'` sin `nicName`) y discos (`liveDiskHist`).

3. **`server.py`**:
   - Alinear `DISK_BANDWIDTH_HISTORY` con cubetas pico-preservantes de `5 s` (`DISK_BUCKET_INTERVAL_MS = 5000`, retención `MAX_DISK_HISTORY_SECONDS = 1200`) idénticas al patrón de `NIC_BANDWIDTH_HISTORY_2H`, asegurando que los discos alcancen `5 minutos` exactos en Inicio (y hasta `20 min` en el búfer en vivo).
   - Actualizar versión de respaldo a `12.7.1`.

4. **Sincronización SemVer, Documentación y Despliegue Dual (`GEMINI.md` Reglas 2, 4 y 5)**:
   - Actualizar `./VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `src/App.tsx`, `src/utils/formatters.ts`, `src/components/MoreView.tsx`, `docs/assets/cockpit-ui-preview.svg`, `docs/assets/hero-banner.svg`, `README.md`, `static/manual.html` y `docs/index.html` a `12.7.1`.
   - Compilar frontend (`npx tsc --noEmit && npm run build`), validar Python (`py_compile`), ejecutar `bash packaging/install_all.sh` (PC `.deb` + Android TV `.apk`), desplegar en `/home/servidor/servicios/dashboard/`, sincronizar GitHub (`main` + tag `v12.7.1`) y documentar resultados en `planes/walkthrough_v12.7.1.md`.

