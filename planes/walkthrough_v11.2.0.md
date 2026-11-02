# Walkthrough Técnico · `v11.2.0` — Barra Superior Única con Desplegables Flotantes y Erradicación de Superposiciones

## 1. Resumen de Cambios Arquitectónicos (`v11.2.0`)
1. **Eliminación de la Doble Barra de Navegación**:
   - Se eliminó del flujo visual la segunda barra horizontal (`#orbitalSubnavBar` / `.orbital-subnav-bar`) que aparecía debajo de `.top-header`.
   - Toda la navegación de primer y segundo nivel reside ahora en una **única barra superior (`.top-header`)** de `56px` de altura:
     - **Izquierda (`.header-left`)**: Botón `Módulos` (cajón lateral completo `#appSidebar`) y ruta activa con truncado inteligente (`text-overflow: ellipsis`).
     - **Centro (`#orbitalDomainSwitcher`)**: Botón directo `Cabina` (`overview`) y tres selectores con menús desplegables flotantes *Liquid Glass* (`Silicio ▾`, `Red & Escudo ▾`, `Operaciones ▾`) que muestran las subvistas y sus badges en vivo (`CPU %`, `RAM %`, `GPU`, `Discos %`, `Red`, `IPS`, `Apps`, `Torrents`, `PIDs`, `Versión`) al pasar el ratón o hacer clic.
     - **Derecha (`.header-right`)**: Buscador contextual, reloj/telemetría 60 FPS, disparador `⌘K`, selector de tema, insignia de versión y botón Zero-Trust compacto (`LAN` / `WAN`).
2. **Corrección Integral de Superposiciones (Zero-Overlap)**:
   - **Cabecera (`.top-header`)**: `#ovBadgeTrust` muestra ahora `LAN` o `WAN` de forma concisa (moviendo la IP detallada al atributo `title` de `#btnHeaderZeroTrust`), y se añadieron media queries progresivas (`1320px`, `1120px`, `920px`) para evitar cualquier colisión horizontal.
   - **Inspector Táctil de Gráficas (`.chart-scrub-Floating`)**: Posicionamiento `position: absolute; top: 10px; right: 12px;` dentro de `.oscilloscope-stage` para que el indicador de muestra no empuje ni desborde `<canvas id="bentoSheetCanvas">`.
   - **Tarjetas de Historial por Dispositivo (`.conn-dev-hist-card`)**: Configuración `flex-direction: column; align-items: stretch;` junto a estilos dedicados para `.conn-dev-hist-card-top`, `.conn-dev-hist-card-dest` y `.conn-dev-hist-card-geo`, evitando que las 3 filas internas se aplasten en horizontal.
   - **Desglose de Dispositivos en Anillo de Ancho de Banda (`.bw-pie-dev-row`)**: Incorporación de `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` en `.bw-pie-dev-name` y `.bw-pie-dev-meta` para impedir que nombres largos de host invadan la columna de IP/medio.
   - **Panel Lateral del Mapa Geoespacial (`.map-side-drawer`)**: Ajuste de `top: 64px; bottom: 68px; max-height: calc(100% - 132px);` para respetar siempre los controles superiores y la leyenda inferior del mapa.
   - **Paleta de Comandos (`⌘K`) y Simetría de Pilares**: Estilizado explícito de `.cmd-palette-item-left`, `.cmd-palette-icon`, `.cmd-palette-title` y `.cmd-palette-sub`, y activación simétrica del texto central en los 4 anillos radiales SVG (`gaugeCpuText`, `gaugeRamText`, `gaugeGpuText`, `gaugeDiskText`).

## 2. Verificación y Sincronización Canónica
- **Versión Canónica**: `11.2.0` sincronizada en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
- **Paquete Nativo Debian (`.deb`)**: Compilado en `dist/recursos-cockpit_11.2.0_amd64.deb`, instalado localmente y verificado con `/usr/bin/recursos-cockpit --test-mode`.
