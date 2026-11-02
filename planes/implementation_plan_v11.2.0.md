# Plan de Implementación v11.2.0 — Eliminación de Doble Barra de Navegación y Corrección Integral de Superposiciones Visuales

## 1. Objetivo de la Versión (`v11.2.0`)
Responder de forma directa a la solicitud del usuario:
> *"la doble barra de navegacion no me gusta y hay objetos que se superponen"*

De acuerdo con la Regla 3.4 de `GEMINI.md`, se incrementa la versión `MINOR` (`11.1.0` -> `11.2.0`) al rediseñar el sistema de navegación superior para eliminar por completo la segunda barra horizontal (`#orbitalSubnavBar`) y corregir todas las colisiones y superposiciones de elementos en la interfaz.

---

## 2. Diagnóstico Técnico de Problemas Detectados

1. **Doble Barra de Navegación (`#orbitalSubnavBar` bajo `.top-header`)**:
   - En `v11.0.0`/`v11.1.0`, al seleccionar los dominios `02 · Silicio`, `03 · Red & Escudo` o `04 · Operaciones`, se desplegaba una segunda barra horizontal completa (`#orbitalSubnavBar`) debajo de `.top-header`, generando una doble barra de navegación apilada que restaba altura útil y recargaba la cabecera.
2. **Colisión y Superposición Horizontal en `.top-header`**:
   - La suma de anchuras de `.header-left` (`Módulos` + `Recursos / [Título de Vista]`), el selector central `.orbital-domain-switcher` y `.header-right` (`#searchBox` + `#hudCenterTelemetry` + `⌘K` + `🌗` + `v11.1.0` + `#ovBadgeTrust` con texto largo `LAN (192.168.1.X)`) superaba los `1.450px` sin ajuste flexible, provocando que los tres bloques chocaran y se superpusieran en pantallas estándar, portátiles, tablets y contenedores de previsualización.
3. **Superposición de `.chart-scrub-Floating` sobre el `<canvas>` en `#bentoExpandDialog`**:
   - La clase `.chart-scrub-Floating` dentro de `.oscilloscope-stage` carecía de posicionamiento absoluto y estilos propios tras la reestructuración CSS, empujando y solapando el lienzo `<canvas id="bentoSheetCanvas">`.
4. **Superposición de Tarjetas en el Cajón de Historial por Dispositivo (`.conn-dev-hist-card`)**:
   - `.conn-dev-hist-card` estaba definida como fila horizontal (`display: flex; align-items: center`) pero contenía tres bloques verticales (`.conn-dev-hist-card-top`, `.conn-dev-hist-card-dest`, `.conn-dev-hist-card-geo`), provocando que el texto de destino, servicio y geolocalización se aplastara y superpusiera horizontalmente.
5. **Superposición de Columnas en el Desglose del Gráfico de Pastel (`.bw-pie-dev-row`)**:
   - Las clases `.bw-pie-dev-name`, `.bw-pie-dev-meta` y `.bw-pie-dev-io` carecían de `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, causando que los nombres largos de dispositivos invadieran y se superpusieran sobre la columna de IP/medio.
6. **Superposición del Panel Lateral del Mapa (`.map-side-drawer`) con la Barra Superior y Leyenda Inferior**:
   - En `#networkConnectionsMapStageWrap`, cuando los controles superiores o la leyenda inferior hacían salto de línea, su altura superaba los márgenes `top: 56px` / `bottom: 52px` de `.map-side-drawer`.
7. **Estilos de Alineación en `#commandPaletteDialog` (`.cmd-palette-item-left`) y `.node-err-log-entry`**:
   - Se completan las reglas CSS de `.cmd-palette-item-left`, `.cmd-palette-icon`, `.cmd-palette-title`, `.cmd-palette-sub` y `.node-err-*` para garantizar truncado limpio y cero solapamientos.

---

## 3. Solución Arquitectónica Implementada en `v11.2.0`

### A. Barra Única de Navegación con Menús Flotantes Integrados (Cero Doble Barra)
- Se elimina la segunda barra horizontal (`#orbitalSubnavBar`) bajo `.top-header`.
- En la única barra superior (`.top-header`), el selector central utiliza **menús desplegables flotantes de cristal líquido (`orbital-dropdown-menu`)** integrados en cada dominio (`Cabina`, `Silicio ▾`, `Red & Escudo ▾`, `Operaciones ▾`):
  - Al pulsar `Cabina`, se navega directamente a la vista general (`/`).
  - Al pasar el cursor o pulsar sobre `Silicio ▾`, `Red & Escudo ▾` u `Operaciones ▾`, se despliega un popover flotante limpio con las subvistas del dominio y sus contadores en tiempo real (`subBadgeCpu`, `subBadgeRam`, `subBadgeGpu`, `subBadgeDrives`, `subBadgeNet`, `subBadgeSec`, `subBadgeApps`, `subBadgeTorrents`, `subBadgeProcs`, `subBadgeVersion`).
  - Se mantiene además el acceso directo por cajón lateral (`☰ Módulos`) y paleta `⌘K`.

### B. Erradicación Total de Superposiciones (Zero-Overlap Layout)
- **`.top-header` anticolisión**:
  - Se simplifica el indicador `#ovBadgeTrust` en la cabecera a formato compacto (`LAN` / `WAN`) conservando la IP detallada en el tooltip y en el modal Zero-Trust.
  - Se aplican restricciones `min-width: 0`, truncado con elipsis en `#currentViewTitle` y puntos de ruptura progresivos (`1260px`, `1024px`, `840px`) para que jamás colisionen las 3 zonas de la barra superior.
- **`.chart-scrub-Floating`**: Posicionamiento flotante (`position: absolute; top: 10px; right: 12px; pointer-events: none`) dentro de `.oscilloscope-stage`.
- **`.conn-dev-hist-card`**: Estructura vertical (`flex-direction: column`) con separación limpia entre servicio, IP/dominio y geolocalización.
- **`.bw-pie-dev-row`**: Celdas con `min-width: 0` y truncado tabular sin invasión de columnas.
- **`.map-side-drawer`**: Ajuste de márgenes verticales y `z-index` coordinado con los controles superiores y la leyenda inferior del mapa Leaflet.

---

## 4. Sincronización y Empaquetado Obligatorio (`GEMINI.md`)
1. Actualizar `./VERSION` a `11.2.0`.
2. Sincronizar `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
3. Compilar e instalar el paquete Debian nativo `dist/recursos-cockpit_11.2.0_amd64.deb` y verificar `/usr/bin/recursos-cockpit --test-mode`.
