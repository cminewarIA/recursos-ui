# Plan de Implementación y Verificación — v10.2.2: Restauración del Estilo Visual Original de Gráficas Sparkline de Red con Persistencia de 2 Horas (`120 min`)

## 1. Objetivo
- Restaurar el diseño visual original de las gráficas sparkline por NIC (`drawNicSparkline` y `.nic-sparkline-box`) para que la curva ocupe de forma fluida todo el ancho del lienzo sin rellenos planos de ceros a la izquierda ni líneas guía verticales adicionales, manteniendo el almacenamiento y persistencia corregidos de **2 horas completas (`7200s` = `120 min` = `480` muestras de 15s)**.

## 2. Cambios Realizados (`v10.2.2`)
1. **Renderizado Visual Original (`drawNicSparkline` en `index.html` y `static/index.html`)**:
   - Trazado directo de la serie almacenada (`NicBandwidthStorageManager.getHistory(nicName)`) distribuida suavemente a todo el ancho del `<canvas>` (`x = (i / (totalPts - 1)) * w`).
   - Eliminación de las líneas verticales adicionales y del relleno de ceros a la izquierda, manteniendo únicamente las 3 líneas horizontales sutiles de horizonte, las 4 etiquetas originales del eje (`-2 horas`, `-1 hora`, `-30 min`, `Ahora`) y el indicador `${peak.count} pts`.
2. **Almacenamiento Real de 2 Horas (`120 min`) sin Corte a 30 Minutos**:
   - Cuantización determinista a buckets fijos de 15 segundos (`Math.floor(ts / 15000) * 15000`) sin sobrescribir `last.t = now` en `server.py`, `vite.config.ts` y `NicBandwidthStorageManager`.
   - Volcado rápido cada 3 segundos a `localStorage` y persistencia automática en disco (`nic_history_2h.json`) tanto en `server.py` como en `vite.config.ts`.
3. **Sincronización Canónica (`v10.2.2`)**:
   - Sincronización en `VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
