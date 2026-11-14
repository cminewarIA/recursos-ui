# Plan de Implementación v12.3.0 — Ventana de 20 Minutos, Escalas de Tiempo/Datos y Autoescala de Pico en Gráficas

> **Versión objetivo**: `12.3.0` (`MINOR`, conforme a `GEMINI.md` §2.4 al rediseñar/ajustar las escalas, ventana temporal y motor de renderizado de todas las gráficas).  
> **Fecha**: 2026-11-14  
> **Cumplimiento**: Reglas 1–7 de `GEMINI.md` (Zero-Hardcoding, SemVer unificado en `VERSION`, almacenamiento en `./planes/`, sincronización de `README.md` sin listar versiones pasadas, empaquetado e instalación `.deb` local y paridad Web/Ubuntu/Android).

---

## 1. Diagnóstico Inicial

1. **Ventana temporal inconsistente**:
   - En `server.py` (`MAX_HISTORY = 60`) y `vite.config.ts`, `HISTORY` almacenaba solo 60 muestras crudas (~90 segundos), mientras que los buffers por interfaz de red (`NIC_BANDWIDTH_HISTORY_2H`) acumulaban 2 horas (`7200` s en cubetas de 15 s).
   - No existía un eje `epoch_ts` en `HISTORY` para ubicar las muestras con precisión temporal real ni una ventana común de 20 minutos en todo el panel.
2. **Ausencia de escalas visibles y techo inflado**:
   - `TelemetryChart.tsx` dibujaba únicamente tres líneas horizontales sin números en el eje Y ni marcas horarias en el eje X.
   - `computedMaxLeft` en `TelemetryChart.tsx`, `diskThroughputMax` en `OverviewView.tsx` y `dynamicMaxLeft` en `ExpandedChartModal.tsx` aplicaban pisos fijos (`5` MB/s o `2` MB/s) y factores `Math.ceil(peak * 1.25)` que impedían que el techo de la escala en gráficas de velocidad coincidiera exactamente con el pico máximo registrado en los últimos 20 minutos.

---

## 2. Arquitectura Aplicada

### 2.1 Backend y Entorno de Desarrollo (`server.py`, `vite.config.ts`)
- Unificación de todas las gráficas en vivo (`HISTORY` y `NIC_BANDWIDTH_HISTORY_2H`) a una **ventana móvil exacta de 20 minutos (`1200` s)** con **cubetas cuantizadas de `5` s (`240` cubetas)** y **preservación del pico máximo (`max`)** por cubeta para que ningún pico breve de velocidad o carga quede suavizado ni desaparezca antes de cumplir 20 minutos.
- Incorporación de `epoch_ts` en `HISTORY`, precarga en arranque desde `recursos_history.db` filtrada a `ts >= now - 1200` (`preload_telemetry_history_from_sqlite()`), y sincronización continua desde `background_collector()`.

### 2.2 Motor de Gráficas (`src/components/TelemetryChart.tsx`)
- **Escala vertical (eje Y izquierdo y derecho opcional)**:
  - Cálculo de márgenes proporcionales (`padL`, `padR`, `padT`, `padB`) según el ancho real medido con `ctx.measureText`.
  - Etiquetas claras y tabulares adaptadas a la magnitud (`%` para uso de CPU/RAM/GPU/Espacio; `KB/s` o `MB/s` dinámicos para velocidades de lectura/escritura de disco y descarga/subida de red).
  - En métricas de velocidad (`leftUnit !== '%'`), **`computedMaxLeft` se fija exactamente al valor `peak` más alto presente en la ventana de 20 minutos** (`peak > 0.0001 ? peak : 0.1`) y se resalta en la marca superior (`y = padT`), actualizándose automáticamente cuando entra un nuevo pico o cuando el pico anterior abandona la ventana de 20 minutos.
- **Escala temporal (eje X)**:
  - Posicionamiento proporcional de cada muestra usando `epochTs` (con respaldo por índice si no hay marcas epoch) y marcas horarias limpias (`HH:MM`, `HH:MM:SS` si el tramo es corto o `DD/MM HH:MM` en historial largo de SQLite), con líneas de rejilla verticales sutiles y coincidencia exacta del puntero/toque.

### 2.3 Vistas e Inspección Táctil (`OverviewView.tsx`, `EquipmentView.tsx`, `NetworkSecurityView.tsx`, `ExpandedChartModal.tsx`)
- Eliminación de `diskThroughputMax` en `OverviewView.tsx` y del tope multiplicado `* 1.2` en `ExpandedChartModal.tsx`.
- Propagación de `timestamps`, `epochTs` y `nicName` en todas las vistas (`OverviewView`, `EquipmentView`, `NetworkSecurityView`) y actualización en vivo dentro del modal ampliado tanto para métricas globales como por interfaz de red.
- Ajuste de presets del visor ampliado (`En vivo · 20 min`, `20 min`, `1 h`, `6 h`, `24 h`, `Todo`) manteniendo intacto todo el retroceso histórico en `recursos_history.db`.

---

## 3. Plan de Verificación
1. `python3 -m py_compile server.py` sin errores.
2. Enlace temporal de `node_modules` para ejecutar `npx tsc --noEmit && npm run build` verificando compilación TypeScript y Vite/React 19 (`static/index.html` e `index.html`).
3. Empaquetado Debian (`bash packaging/build_deb.sh`), restauración de clave pública GPG temporal si se modifica y recompilación limpia si aplica, instalación local (`sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.3.0_amd64.deb`), verificación `--test-mode` y `dpkg -l | grep recursos-cockpit`.
4. Sincronización de archivos al servicio de producción `/home/servidor/servicios/dashboard` preservando intacto el archivo `/home/servidor/servicios/dashboard/recursos_history.db` (mismo inodo) y `nic_history_2h.json`, reinicio de `system-dashboard.service` y comprobación real de `/api/version` (`12.3.0`) y `/api/metrics` (`history.epoch_ts`, ventana <= 1200s y NIC `history_2h` en `:8085`).

