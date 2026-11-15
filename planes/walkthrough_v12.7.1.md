# Walkthrough de Implementación y Verificación — Recursos Cockpit `v12.7.1`

**Fecha**: 2026-11-14  
**Versión previa**: `12.7.0`  
**Versión publicada localmente**: `12.7.1` (`PATCH` conforme a SemVer de `GEMINI.md` Regla 2.4)

---

## 1. Resumen de Cambios Aplicados

1. **Trazado Limpio de Gráficas sin Saturación de Puntos (`src/components/TelemetryChart.tsx`)**:
   - Eliminado el bucle intermedio (`minSpacingPx = 11`) que dibujaba decenas de círculos a lo largo de la curva en cada serie.
   - Conservados exclusivamente en la capa superior del canvas —siempre por encima de todas las curvas y centrados en coordenadas exactas sobre la línea `Fritsch–Carlson`— el marcador vivo final con pulso sonar (`pts[pts.length - 1]`) y el punto interactivo de muestreo al pasar el cursor o tocar la pantalla (`hoverIdx`).
   - Añadida lógica `forceSecondsTick` en el eje X para conmutar automáticamente a formato `HH:MM:SS` en ventanas cortas (`<= 5 min`) cuando etiquetas `HH:MM` consecutivas coincidirían.

2. **Ventana Exacta de `5 minutos` (`300 s`) en Inicio y Modal En Vivo**:
   - **`src/components/OverviewView.tsx`**: Definido `OVERVIEW_WINDOW_SECONDS = 300` y recorte memoizado (`useMemo`) sobre `timestamps`, `epochTs`, `cpuHist`, `ramHist`, `gpuHist`, `netRxHist` y `netTxHist` (con respaldo `.slice(-60)`), además del recorte por marca temporal a los últimos `300_000 ms` en `d.io_history` dentro de `independentDisks`.
   - **`src/components/ExpandedChartModal.tsx`**: Actualizado el modo en vivo a `LIVE_WINDOW_SECONDS = 300` (`En vivo · 5 min`), manteniendo disponibles los selectores históricos **`20 min`**, **`1 h`**, **`6 h`**, **`24 h`** y **`Todo`**. Ampliado `resolvedSeries` / `resolvedTimestamps` / `resolvedEpochTs` con soporte de red global (`chartKind === 'net'` sin `nicName`) y lectura completa de `liveDiskHist` (> 10 muestras) en `preset === '1200'` cuando `cursorEndTs === null`.

3. **Buckets Pico de `5 s` en Backend para Historial de Discos (`server.py`)**:
   - Sustituido `MAX_DISK_HISTORY_SAMPLES = 90` por `MAX_DISK_HISTORY_SECONDS = 1200` y `DISK_BUCKET_INTERVAL_MS = 5000` en `_update_disk_io_history()`, igualando el patrón de cubetas pico-preservantes de `NIC_BANDWIDTH_HISTORY_2H` para cubrir la ventana completa de `5 minutos` en Inicio y `20 minutos` en inspección en vivo.
   - Actualizada versión de respaldo `ver_ua` a `12.7.1`.

4. **Sincronización SemVer y Documentación (`GEMINI.md` Reglas 2, 3 y 4)**:
   - Sincronizados a `12.7.1`: `./VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `src/App.tsx`, `src/utils/formatters.ts`, `src/components/MoreView.tsx`, `docs/assets/cockpit-ui-preview.svg`, `docs/assets/hero-banner.svg`, `README.md`, `static/manual.html` (incluyendo entrada `v12.7.1` en `CHANGELOG`) y su réplica idéntica `docs/index.html`.
   - Plan guardado en [implementation_plan_v12.7.1.md](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/planes/implementation_plan_v12.7.1.md).

---

## 2. Verificaciones Ejecutadas tras los Últimos Cambios

| Verificación | Comando / Método | Resultado Observado |
| :--- | :--- | :--- |
| **Paridad y JS de Manuales** | `sha256sum ./static/manual.html ./docs/index.html` + `node --check` sobre el `<script>` embebido | Código `0`; ambos ficheros comparten SHA-256 `0b8bc3f2764247f79a8a30d883070a50928664dd1a791ab28a9bfbe953395ced`; `manual.html inline JS check: OK`. |
| **TypeScript + Vite + Python** | `npx tsc --noEmit && npm run build && python3 -m py_compile ./server.py ./desktop_app/recursos_app.py` | Código `0`; compilado con `vite v8.3.8` (`dist/index.html` `2.41 kB`, `assets/index-tbzyXr-B.css` `57.08 kB`, `assets/index-Dw30KHiv.js` `523.29 kB`) y emitido bundle autónomo `./static/index.html`. |
| **Empaquetado e Instalación Dual** | `bash packaging/install_all.sh` | Generado y firmado con GPG (`4CFC86D58E9146AE`) `./dist/recursos-cockpit_12.7.1_amd64.deb` (`Version: 12.7.1`, `Replaces: recursos-cockpit (<< 12.7.1)`); instalado en Ubuntu (`ii recursos-cockpit 12.7.1 amd64`) y compilada APK `recursos-cockpit_12.7.1.apk` (`BUILD SUCCESSFUL in 40s`) desplegada vía ADB en `TCL Percee TV (SDK 26 · 192.168.50.187:5555)` con `versionCode=120701`, `versionName=12.7.1`. |
| **Modo Diagnóstico App Nativa** | `/usr/bin/recursos-cockpit --test-mode` + `cmp` de payload | Validado `[OK] Recursos Native Ubuntu HTML5 App v12.7.1 validated successfully` (`html5_webkit2`, `dex_unlocked: True`, `active='http://127.0.0.1:8085'`); paridad byte a byte entre `./static/index.html` y `/usr/lib/recursos-cockpit/static/index.html`. |
| **Servicio Productivo & BD** | `rsync` + `systemctl restart system-dashboard.service` + HTTP probes en `127.0.0.1:8085` | Servicio `active`; inodo BD preservado (`1049392`, `68997120` bytes); HTTP `200` en `/`, `/manual`, `/readme`, `/api/version?refresh=1` (`version: "12.7.1"`, `installed_deb_version: "12.7.1"`, `ahead_of_remote: true`, `update_available: false`) y `/api/metrics` (`222` puntos en `history`, `9` discos con cubetas de `~5 s`, p. ej. `/dev/nvme0n1p2` con `18` muestras acumuladas tras el reinicio); `static/index.html` en workspace y servicio idénticos conteniendo `En vivo · 5 min` y sin `En vivo · 20 min`. |

---

## 3. Nota de Control Git y Limitaciones de Prueba

- Siguiendo la pauta de la skill `cockpit-release`, los cambios quedan confirmados localmente en la rama `main` con etiqueta `v12.7.1` y sincronizados con la copia productiva local sin ejecutar `git push` automático hacia GitHub hasta que el usuario lo indique explícitamente.
- Las aserciones sobre la interfaz web en ejecución se verificaron mediante compilación TypeScript/Vite, análisis del bundle emitido (`static/index.html`) y respuestas en vivo de `127.0.0.1:8085`; la apertura visual directa en Chrome DevTools permaneció limitada al no existir una instancia previa de Chrome con depuración remota habilitada.

