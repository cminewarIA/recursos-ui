# Walkthrough & Verificación — v9.2.0: Gráfico de Barras Horizontal Animado D3.js en Vista de Procesos

## 1. Resumen de Cambios Implementados

1. **Visualización D3.js v7 en la Vista de Procesos (`index.html` & `static/index.html`)**:
   - Se añadió la sección `#procCpuD3Section` en la parte superior de `#viewProcesses` (`/procesos`) manteniendo la simetría estructural y estética *Apple Liquid Glass + Tesla Touch Cockpit* (Regla 8).
   - Se implementó el motor `window.ProcessCpuBarChart` basado en **D3.js v7** con:
     - Escalas dinámicas `d3.scaleLinear()` (horizontal) y `d3.scaleBand()` (vertical, indexada por PID).
     - Conmutador interactivo entre **Escala Dinámica** y **Escala 100%** (`setProcD3ScaleMode`).
     - Tira superior de métricas en vivo con separadores limpios (`·`) y números tabulares (`Carga Top 10`, `Proceso Líder` y `RAM Privada Top 10`).
     - Animaciones fluidas de 550 ms (`d3.easeCubicOut`) en el ancho de las barras, reordenamiento vertical por ranking y tweening numérico continuo (`d3.interpolateNumber`).
     - Tooltip interactivo translúcido con cuota porcentual sobre el Top 10 y selección bidireccional de PID con la tabla inferior `#processesList`.

2. **Telemetría Diferencial de CPU en Tiempo Real (`vite.config.ts`)**:
   - Se actualizó `sampleRealProcesses()` para leer los ticks de CPU del kernel en `/proc/[pid]/stat` (`utime + stime`) y calcular el delta instantáneo entre muestras consecutivas, ofreciendo lecturas dinámicas reales sin ningún valor estático (Regla 2: Zero-Hardcoding).

3. **Sincronización Canónica `v9.2.0` y Empaquetado Nativo (Reglas 3, 4, 5 y 6)**:
   - Actualizados `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md` a la versión `9.2.0`.
   - Compilado el paquete Debian canónico `dist/recursos-cockpit_9.2.0_amd64.deb` y verificado con `python3 desktop_app/recursos_app.py --test-mode`.

## 2. Verificación Técnica
- **Validación App Nativa GTK3 (`--test-mode`)**: `[OK] Recursos Native GTK3 App v9.2.0 validated successfully.`
- **Compilación y Linter TypeScript/Vite**: Verificados mediante `lint_applet` y `compile_applet`.
