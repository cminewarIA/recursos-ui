# Plan de Implementación v12.22.1 — Auditoría Integral, Estabilidad Visual Multi-Viewport, Optimización SQLite y Cumplimiento de Normas

## 1. Diagnóstico Inicial
Tras revisar el proyecto completo frente a las 9 normas de `GEMINI.md` y ejecutar una auditoría geométrica automatizada en Chrome Headless CDP sobre las 17 vistas/subvistas y modales en 5 resoluciones (`1440×900`, `1024×768`, `768×1024`, `640×900`, `360×800`), se detectaron los siguientes defectos reales:

1. **Desbordamientos visuales (`OVERFLOW_X` / `CHILD_OUT` / `BOX_OUTSIDE_VP` / `BTN_CLIP`)**:
   - `Red → Aparatos en casa` (`router-traffic-widget` y su hermano `NicHistoryCard`): cabecera con métricas en `shrink-0` junto al título empujaba el contenido hasta `+101 px` fuera de la tarjeta y del viewport en `640 px`, `768 px` y `1024 px`.
   - `Red → Historial de tráfico (24 h)`: bloque derecho con 4 leyendas largas y `shrink-0` empujaba los botones `Actualizar` y `Ampliar` `+96 px` fuera del viewport en `640×900`.
   - `Red → Mapa de conexiones`: dominios largos sin espacios (`ca80a1adb12a4fbdac5ffcbc944e9a61.pacloudflare.com (:443)`, etc.) desbordaban `+21 px` a `+66 px` sus tarjetas `cockpit-subtile` y el `<section>` en todos los viewports (`360 px`–`1440 px`).
   - `Más → Actualizaciones y aspecto`: las 3 tarjetas de versión (`APP UBUNTU`, `SERVIDOR WEB LOCAL`, `GITHUB OFICIAL`) en `sm:grid-cols-3` dentro de `flex-1` junto a 3 botones `shrink-0` se aplastaban a `24 px–63 px` en `640 px` y `768 px`.
   - `Equipo → Programas en marcha`: barra segmentada `Procesador / Memoria / Vídeo / Almacenamiento` sin `flex-wrap` salía `+37 px` de la casilla y del viewport en `360×800`.
   - `.cockpit-bento`, `.cockpit-subtile`, `.cockpit-hero`, `.cockpit-segmented` carecían de `min-width: 0; max-width: 100%;` en `src/index.css`, permitiendo que hijos flex/grid ensanchasen tarjetas.
2. **Errores de consola en producción (Firebase / CSP)**:
   - `Content-Security-Policy` en `server.py` no incluía los orígenes de Firestore/Firebase Auth (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`), generando errores rojos en consola en cada carga, agravados por la llamada duplicada `void testConnection()` en `src/firebase/index.ts`.
3. **Rendimiento SQLite / RAM y Esquema `postinst` (Regla 8)**:
   - `recursos_history.db` acumuló `518 245` filas en `ping_history` y `250 032` filas en `telemetry_history`; al consultar la ventana `"all"` o rangos largos se cargaban todas las filas con `fetchall()` en memoria Python (causando picos de hasta `1,3 GB` de RAM).
   - `packaging/debian/postinst` omitía la 8ª tabla `ai_system_fault_insights` introducida en `v12.22.0`.
4. **Cumplimiento estricto de Reglas 1, 2 y 9**:
   - `packaging/debian/control` conservaba literales `12.8.0` en lugar del marcador neutro `0.0.0`.
   - `desktop_app/dex_controller.py` mantenía `import os` sin uso.
   - `static/visipics.rdp`, `static/visipics_externo.rdp` y `server.py` contenían referencias estáticas (`192.168.50.2`, `servidor.local`, `username:s:servidor`), y un comentario en `NetworkDevicesModal.tsx` citaba marcas fijas.

## 2. Plan de Corrección (`v12.22.1`)
- **UI y CSS (`src/index.css`, `NetworkSecurityView.tsx`, `MoreView.tsx`, `EquipmentView.tsx`, `NetworkDevicesModal.tsx`)**: aplicar contención defensiva `min-width: 0; max-width: 100%`, ajustar `--cockpit-card-min`, separar cabeceras densas en 2 filas simétricas, habilitar `flex-wrap` en selectores segmentados, y truncado/ruptura segura en nombres de dominio largos.
- **Firebase & CSP (`server.py`, `src/firebase/index.ts`)**: autorizar los dominios oficiales de Firebase en CSP y eliminar el `testConnection()` duplicado y los errores rojos en modo offline.
- **SQLite & Backend (`server.py`, `packaging/debian/postinst`)**: submuestreo temporal directo en SQL (`GROUP BY`) para ventanas grandes en `telemetry_history` y `ping_history`, tope de poda en `ping_history`, usuario RDP dinámico y paridad de las 8 tablas en `postinst`.
- **Higiene de normas (`packaging/debian/control`, `desktop_app/dex_controller.py`, `static/visipics*.rdp`, `README.md`)**: marcadores `0.0.0`, eliminación de imports sin uso y saneamiento de archivos RDP.
- **Verificación integral**: `tsc --noEmit --noUnusedLocals --noUnusedParameters`, `eslint`, `py_compile`, `npm run build`, Kotlin `:app:compileReleaseKotlin`, despliegue en producción local, y re-ejecución de la auditoría geométrica Chrome Headless CDP en todas las vistas, modales y resoluciones (incluido idioma largo `de` y tema oscuro) hasta lograr **0 desbordamientos y 0 errores de consola**.
