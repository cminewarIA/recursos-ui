# Plan de Implementación y Verificación — v10.2.1: Corrección de Gráficas de Red de 2 Horas (`120 min`)

## 1. Diagnóstico de la Causa Raíz
1. **Sobrescritura del Timestamp de Bucket (`last.t = now` / `n_hist[-1]["t"] = now_ms`)**:
   - Tanto en `server.py`, `vite.config.ts` como en `NicBandwidthStorageManager.recordLiveSample` (`index.html`), cuando llegaba una nueva muestra cada 2 segundos (`now - last.t < 15000`), la rama de actualización sobrescribía `last.t = now`. Esto reiniciaba el contador de 15 segundos en cada ciclo de 2s e impedía crear nuevos puntos intermedios.
2. **Bloqueo Prematuro en `mergeServerHistory` (`_hydratedNics`)**:
   - El frontend ignoraba las actualizaciones posteriores de `history_2h` enviadas por el servidor tras la primera lectura y empleaba claves de `10000ms` frente a `15000ms` de `SAMPLE_INTERVAL_MS`.
3. **Ausencia de Rejilla Temporal Completa de 2 Horas (`480` slots de 15s = `120 min`) en `drawNicSparkline`**:
   - Si había menos de 2 horas de muestras (por ejemplo, 30 minutos), el gráfico solo trazaba puntos en el extremo derecho y el cursor interactivo (*scrub*) hacía tope en `-30 min` sin poder retroceder hasta `-2 horas` (`-120 min`).
4. **Escala No Lineal en `.nic-sparkline-axis`**:
   - El eje inferior tenía solo 4 etiquetas (`-2 horas`, `-1 hora`, `-30 min`, `Ahora`) distribuidas con `space-between` (`0%`, `33.3%`, `66.7%`, `100%`), distorsionando la escala al faltar la marca `-1h 30m` (`25%`).

## 2. Solución Implementada (`v10.2.1`)
- Cuantización determinista a buckets fijos de 15 segundos (`Math.floor(ts / 15000) * 15000`) en `server.py`, `vite.config.ts` e `index.html`, sin alterar el timestamp de inicio del bucket y con persistencia en `nic_history_2h.json`.
- Método `getFullTwoHourTimeline(nicName)` que reconstruye los **481 puntos exactos (`120 min` / `2 horas`)** desde `-2 horas` (`x = 0`) hasta `Ahora` (`x = w`), con soporte completo de inspección táctil/ratón (`formatMinutesAgoLabel`) en todo el rango `-2h 00m` ↔ `Ahora`.
- Eje horizontal lineal de 5 marcas (`-2 horas`, `-1h 30m`, `-1 hora`, `-30 min`, `Ahora`) alineadas con las líneas guía verticales del canvas (`25%`, `50%`, `75%`).
