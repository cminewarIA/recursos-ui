# Plan de Implementación `v12.8.0` — Layout Fluido Multi-Pantalla y Rejilla Paralela Automática de Widgets

## 1. Objetivo
Eliminar los márgenes laterales excesivos al maximizar el navegador en monitores medianos, grandes o ultrawide (`1920×1080`, `2560×1440`+) y permitir que los widgets de telemetría y tarjetas de control se distribuyan **en paralelo automáticamente** según el ancho disponible de pantalla, manteniendo simetría visual estricta en móvil, tablet, escritorio y Android TV.

## 2. Control de Versión SemVer (`GEMINI.md` Regla 2.4)
- **Versión previa**: `12.7.2`
- **Nueva versión**: **`12.8.0`** (`MINOR`, ajuste estructural del sistema de layout y rejillas multi-columna en la interfaz).
- **Archivos a sincronizar**: `VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `server.py`, `src/App.tsx`, `src/utils/formatters.ts`, `src/components/MoreView.tsx`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html` y `README.md`.

## 3. Diseño Técnico Detallado

### 3.1 Contenedor Fluido Ancho Completo (`.cockpit-shell`) y Clases Grid en `src/index.css`
1. **`.cockpit-shell`**:
   - Reemplaza `max-w-6xl` (`1152px`) por ancho fluido completo (`width: 100%`) con márgenes laterales proporcionales (`padding-inline: clamp(0.75rem, 1.8vw, 2.25rem)`).
   - En Android TV (`[data-tv="true"]`), asegura padding mínimo de overscan (`padding-inline: max(1.5rem, 2.5vw)`).
   - Se aplica de forma idéntica tanto al contenedor de la barra superior (`<header>`) como al `<main>` para mantener alineación vertical perfecta entre bordes.
2. **`.cockpit-auto-grid`** (widgets de telemetría con gráfica HiDPI):
   - `grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--cockpit-grid-min)), 1fr))` con `gap: 1rem` (`1.125rem` desde `1024px`).
   - `--cockpit-grid-min: 315px` en `< 1024px` (1 col en móvil, 2 cols en tablet `768px+` y TV).
   - `--cockpit-grid-min: 360px` desde `1024px` (3 cols en portátiles `1280px–1440px`, 4 cols en Full HD `1920px` alineando CPU+RAM+GPU+Red en la fila superior, 6+ cols en QHD `2560px` y estiramiento `auto-fit` cuando hay menos widgets).
3. **`.cockpit-auto-grid-cards`** (listas densas de aparatos, contenedores Docker, servicios systemd, conexiones GeoIP y dispositivos confiables):
   - `repeat(auto-fit, minmax(min(100%, var(--cockpit-card-min)), 1fr))` con `gap: 0.75rem`, `--cockpit-card-min: 350px` base y `400px` desde `1280px`.
4. **`.cockpit-cores-grid`** (núcleos de CPU en `EquipmentView.tsx`):
   - `repeat(auto-fit, minmax(56px, 1fr))` con `gap: 0.5rem`.

### 3.2 Actualización Homogénea de Componentes (`src/` y `static/manual.html`)
- **`src/App.tsx`**: Aplicar `.cockpit-shell` en cabecera y `<main>`, y `.cockpit-auto-grid` en el skeleton de carga inicial. Mantener centrada y ergonómica `.cockpit-dock` inferior.
- **`src/components/OverviewView.tsx`**: Aplicar `.cockpit-auto-grid` a la sección principal de widgets (CPU, RAM, GPU, Red y discos independientes plug-and-play); eliminar límites fijos `max-w-[290px]` y `max-w-[260px]` sustituyéndolos por truncado fluido `min-w-0 truncate`; convertir `"Aparatos de tu red doméstica"` a `.cockpit-auto-grid-cards`.
- **`src/components/EquipmentView.tsx`**: Aplicar `.cockpit-cores-grid` a hilos de CPU y `.cockpit-auto-grid` a tarjetas de discos en Almacenamiento.
- **`src/components/NetworkSecurityView.tsx`**: Aplicar `.cockpit-auto-grid` a interfaces de red, `.cockpit-auto-grid-cards` a `"Aparatos detectados en el router"` y `"Conexiones detalladas"`, y ampliar la proporción del mapa GeoIP en escritorio (`lg:grid-cols-12`, mapa `lg:col-span-8 xl:col-span-9 h-[340px] lg:h-[420px] xl:h-[460px]`, donut `lg:col-span-4 xl:col-span-3`).
- **`src/components/AppsMediaView.tsx`**: Convertir las listas `"Aplicaciones instaladas (Contenedores)"` y `"Servicios de fondo del servidor"` a rejillas `.cockpit-auto-grid-cards` con tarjetas `.cockpit-subtile`.
- **`src/components/MoreView.tsx`**: Aplicar `.cockpit-auto-grid-cards` en `"Dispositivos con permiso de acceso"` y ampliar altura mínima del iframe del manual (`h-[74vh] min-h-[540px]`).
- **`src/components/ExpandedChartModal.tsx`**: Ampliar el modal de inspección (`max-w-4xl` -> `max-w-6xl`).
- **`static/manual.html` y `docs/index.html`**: Ampliar `.topbar-inner` y `.layout` (`max-width: 100%` + padding `clamp(16px, 2vw, 36px)`) y `.grid-3` adaptativo con `auto-fit`.

## 4. Plan de Verificación
1. `npx tsc --noEmit && npm run build`, `python3 -m py_compile`, `node --check` sobre el manual y verificación SHA-256 `static/manual.html == docs/index.html`.
2. Comprobación del renderizado y conteo de columnas por viewport mediante el servidor Vite / servicio real (`1920×1080`, `1280×800`, `390×844`) si Chrome está operativo, o inspección exhaustiva CSS/DOM del bundle compilado.
3. Compilación e instalación unificada PC (`.deb` firmado GPG) + Android TV (`.apk` vía ADB) con `bash packaging/install_all.sh`.
4. Sincronización segura en `/home/servidor/servicios/dashboard/` (preservando inodo de `recursos_history.db`), reinicio de `system-dashboard.service`, comprobación HTTP `200` y confirmación local en `main` con etiqueta `v12.8.0` (sin `git push` automático).

