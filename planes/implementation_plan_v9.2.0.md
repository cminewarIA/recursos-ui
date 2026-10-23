# Plan de Implementación — v9.2.0: Visualización D3.js de Uso de CPU de los 10 Procesos Principales

## 1. Objetivo
Implementar en la vista de Procesos (`#viewProcesses`, ruta `/procesos`) una visualización vectorial interactiva con **D3.js v7** que muestre en tiempo real la distribución de uso de CPU de los **10 procesos principales del sistema** mediante un **gráfico de barras horizontal animado**, cumpliendo de forma estricta las reglas de `GEMINI.md` (Zero-Hardcoding, Simetría y Homogeneidad Visual *Apple Liquid Glass + Tesla Touch Cockpit*, Control de Versión Canónico `9.2.0` y Compilación Nativa `.deb`).

## 2. Arquitectura y Diseño Técnico

### 2.1. Telemetría 100% Dinámica (Regla 2: Zero-Hardcoding)
- **Origen de Datos**: Consumo directo de `latestMetrics.system_processes` proveniente de `/api/metrics` (`server.py` con `psutil` en producción y `sampleRealProcesses()` con lectura diferencial de `/proc/[pid]/stat` `utime + stime` en `vite.config.ts`).
- **Filtrado Reactivo**: La visualización se alimenta de la lista filtrada por el buscador global (`filtered`), ordenando dinámicamente por `cpu_percent` descendente (con desempate por `priv_mb` y `pid`) y seleccionando los 10 primeros procesos activos.

### 2.2. Motor D3.js v7 (`window.ProcessCpuBarChart`)
- **Unión de Datos por Clave (`Keyed Data Join`)**: `barsLayer.selectAll('g.proc-d3-row').data(top10, d => String(d.pid))` para garantizar que cuando un proceso cambie de posición en el ranking Top 10, su fila se desplace verticalmente de forma animada a su nueva coordenada `yScale(String(d.pid))`.
- **Transiciones Suaves**: `d3.transition().duration(550).ease(d3.easeCubicOut)` tanto en la posición vertical de cada barra como en su longitud horizontal (`xScale(d.cpu_percent)`) y en el eje superior (`d3.axisTop`).
- **Interpolación Numérica Tabular**: Uso de `d3.interpolateNumber` en `.tween('text', ...)` sobre las etiquetas de valor para animar el porcentaje de CPU cuadro a cuadro con tipografía `tabular-nums`.
- **Codificación Semántica por Carga**:
  - `< 15%`: Gradiente Cian (`#0284c7` → `#38bdf8`).
  - `15% – 45%`: Gradiente Ámbar (`#d97706` → `#fbbf24`).
  - `> 45%`: Gradiente Rosa Coral (`#e11d48` → `#fb7185`).
- **Modos de Escala e Interacción**:
  - Selector segmentado entre **Escala Dinámica** (ajustada automáticamente al 115% del proceso líder con suelo mínimo de 5%) y **Escala 100%**.
  - Tooltip flotante *Liquid Glass* con nombre del proceso, PID, usuario, % de CPU absoluto, cuota porcentual dentro del Top 10 y memoria RAM privada/RSS.
  - Clic sobre cualquier barra del gráfico o fila de la tabla para resaltar el PID seleccionado y desplazar suavemente la lista de procesos.

## 3. Sincronización de Versión (`9.1.2` ➔ `9.2.0`)
- Incremento `MINOR` (`0.X.0`) según la Regla 3.4 de `GEMINI.md` por añadir una nueva función visual en la vista de procesos:
  - `./VERSION` ➔ `9.2.0`
  - `package.json` ➔ `"version": "9.2.0"`
  - `packaging/debian/control` ➔ `Version: 9.2.0`
  - `android_app/app/build.gradle.kts` ➔ `versionCode = 90200`, `versionName = "9.2.0"`
  - `index.html` y `static/index.html` sincronizados.
  - Compilación de `dist/recursos-cockpit_9.2.0_amd64.deb` y actualización de `README.md`.
