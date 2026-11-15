# Recorrido de Auditoría y Reparación — Recursos Cockpit v12.11.1

> **Versión canónica (`./VERSION`)**: `12.11.1` (`PATCH` sobre `12.11.0`)

## 1. Fallos Corregidos

1. **Emby Media recientes vacíos y etiquetas sin traducir** (`src/types/telemetry.ts`, `src/components/AppsMediaView.tsx`, `i18n/dictionary.csv`):
   - `server.py` emitía `title`, `series_name` y `type` en minúsculas (`"movie"` / `"episode"`), mientras `AppsMediaView.tsx` leía `item.name` / `item.series` (renderizando 6 filas en blanco) y consultaba `hardware.media.emby_type.<TitleCase>`.
   - Se amplió `EmbyRecentItem` (`title`, `series_name`, `name`, `series`, `id`, `year`), se deduplicó el prefijo de serie al mostrar `title || name`, se normalizó la clave de tipo a minúsculas y se registraron `.movie`, `.episode`, `.series`, `.audio` en `./i18n/dictionary.csv`.
2. **Error SVG `<svg> attribute height: Expected length, "auto"` en el Manual** (`static/manual.html`, `docs/index.html`):
   - El diagrama SVG de arquitectura en `static/manual.html:770` declaraba `height="auto"`, provocando `[rendering] Error: <svg> attribute height: Expected length, "auto".` en Chromium/WebKit2.
   - Se migró a estilo CSS inline `style="width: 100%; height: auto; display: block;"` y se resincronizó `docs/index.html` (`cmp -s`).
3. **Bytes NUL (`\x00`) en el visor de logs DuckDNS** (`server.py`, `src/components/NetworkSecurityView.tsx`):
   - `get_duckdns_status()` y `get_duckdns_logs()` solo usaban `.strip()`, conservando secuencias `\x00` de cortes previos en `duck.log`.
   - Se filtraron caracteres de control (`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+`) tanto en el backend como en el estado React de `duckLogs`.
4. **Unidad fija `%` en el eje Y derecho de gráficas duales** (`src/components/TelemetryChart.tsx`):
   - El eje derecho imprimía siempre `${rVal}%` incluso en la gráfica GPU de consumo eléctrico y temperatura (`°C`).
   - Se resolvió dinámicamente `resolvedRightUnit` desde la serie `axis === 'right'` (por defecto `%`) y se calculó `padR` con `ctx.measureText` evitando cualquier recorte (`marginPx: 8` verificado con `105°C`).
5. **Seguridad de diccionario en procesos GPU y bandas/proveedores LAN** (`src/components/ResourceProcessesPanel.tsx`, `src/i18n/index.tsx`, `server.py`, `i18n/dictionary.csv`):
   - Se reemplazó `t('hardware.gpu.proc.' + gp.name_key, undefined)` por `formatGpuProcessName(gp, locale)` en `ResourceProcessesPanel.tsx` (evitando mostrar claves literales si falta una traducción) tras admitir `null` en `formatGpuProcessName`.
   - Se emitieron `band_key`, `band_params` y `vendor_key` para nodos `Cable ({mbps} Mbps)`, `Ethernet Local`, `Gateway Uplink` y `Este Servidor` en `server.py` y se añadieron a `WifiClient`, `src/i18n/index.tsx` y `i18n/dictionary.csv`.
6. **Coherencia de memoria de procesos, unidades y cabecera de vídeo GPU** (`src/components/EquipmentView.tsx`):
   - Se unificó la ordenación por memoria con `??` (`priv_mb ?? mem_mb ?? 0`) coincidiendo con la celda mostrada, se aplicó `formatBytes` en lugar de `' MB'` literal y se ajustó la cabecera de `video` según capacidades (`hasEncoder` / `hasDecoder`) con `formatPct`.
7. **Sincronización de popup Leaflet tras `flyTo`** (`src/components/NetworkSecurityView.tsx`):
   - Se sustituyó el temporizador fijo `220ms` de `focusConnectionOnMap` por `map.once('moveend', ...)` con respaldo seguro a `520ms`, consultando el marcador vigente al finalizar el vuelo.
8. **Actualización reactiva de `version_info` y sincronización Git de producción** (`src/components/MoreView.tsx`, `/home/servidor/servicios/dashboard`):
   - `MoreView.tsx` actualizaba `versionInfo` solo cuando era nulo; ahora sincroniza cada actualización de `metrics?.version_info`.
   - Además, el directorio productivo `/home/servidor/servicios/dashboard` conservaba su `.git` en `e48cd91` (`v12.8.0`), quedando desfasado en `/api/version`; se sincronizó código, compilación y referencia Git local preservando bases de datos `.db` y credenciales.
9. **Paridad ESM en Vite 8 y `/api/system/logs`** (`vite.config.ts`):
   - Se sustituyeron las 17 referencias a `__dirname` por `ROOT_DIR` (`path.dirname(fileURLToPath(import.meta.url))`), eliminando por completo las advertencias en Vite 8.
   - Se completaron `time_str`, `total`, `log_errors_count`, `failed_units_count`, `failed_units`, `ack_ts`, `ack_time_str` y `message` en `/api/system/logs`, `/api/system/logs/ack` y `system_errors_summary`.
10. **App Nativa Ubuntu y Android Compose** (`desktop_app/dex_controller.py`, `desktop_app/recursos_app.py`, `FloatingTouchDock.kt`, `android_app/gradlew`):
    - Se añadieron hilos de drenaje continuos para `stdout`/`stderr` de `scrcpy` evitando bloqueos de búfer sin perder mensajes de fallo temprano.
    - Se añadió la señal WebKit2 `create` en `recursos_app.py` para abrir enlaces `_blank` (como `/manual`) vía `xdg-open` y se completó la respuesta offline `/api/system/logs` y `/api/system/logs/ack`.
    - Se sustituyó `Icons.Default.FormatListBulleted` por `Icons.AutoMirrored.Filled.FormatListBulleted` en `FloatingTouchDock.kt` (0 avisos Kotlin) y se restauró `+x` en `android_app/gradlew`.

## 2. Verificación Ejecutada

| Comprobación | Resultado |
|---|---|
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 0 errores |
| `npm run build` (`vite v8.3.8`) | Correcto (`650ms`), 0 advertencias `__dirname` |
| `node --check` sobre JS de `static/manual.html` + paridad `docs/index.html` | Correcto |
| Auditoría CSV `./i18n/dictionary.csv` | 757 claves totales, 557 llamadas estrictas, `Missing: 0` |
| `python3 -W error::SyntaxWarning -m py_compile` (`server.py`, `i18n_catalog.py`, `recursos_app.py`, `dex_controller.py`) | Correcto |
| `ANDROID_HOME=/opt/android-sdk bash android_app/gradlew -p android_app lintDebug` | `BUILD SUCCESSFUL`, 0 errores ni advertencias Kotlin |
| `bash packaging/install_all.sh` | `.deb` v`12.11.1` firmado e instalado (`dpkg -l` coincide), `/usr/bin/recursos-cockpit --test-mode` OK, `.apk` release `12.11.1` compilada y firmada. Android TV en LAN no accesible vía ADB en ese momento (`0` dispositivos conectados) |
| Chrome Headless Escritorio + Móvil sobre `http://127.0.0.1:8085/` | 0 errores de consola, 0 errores HTTP, `badSvg: 0`, 6 títulos Emby visibles sin `movie`/`episode` crudos, 0 `\x00` en DuckDNS, 6/6 presets temporales de modal completos, popup Leaflet tras `Centrar en el mapa`, modal GPU dual `1078×270` sin recorte (`marginPx: 8`) |
| Vite 8 Dev (`--port 5179`) + `/api/system/logs` + `/api/system/logs/ack` | Arranque en `576 ms` sin avisos y paridad completa de esquema |
| Salud de sistema `systemctl --failed` y `/api/system/logs?refresh=1` | `0 loaded units listed`, `total_errors: 0`, `failed_units_count: 0` |
