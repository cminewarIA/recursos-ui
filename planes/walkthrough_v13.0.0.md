# Walkthrough v13.0.0 — Normativa Zeus Vision y Rediseño Completo Alethia × Smart Visual Data

## 1. Incorporación Normativa (Regla 10 de `./GEMINI.md`)
Se inspeccionaron directamente el artículo y las 4 capturas de ejemplos de interfaz de **Zeus Vision** (*Mejores prácticas de visualización de datos y análisis*) junto con la referencia **Alethia** (`#ref-alethia` en CodeWeb Barcelona y `alethia.earth`), incorporando formalmente en [GEMINI.md](../GEMINI.md):
- **Regla 10 (Análisis, Narrativa y Visualización de Datos — Estándar Zeus Vision + Alethia)**:
  1. *Selección del gráfico según la historia del dato* (anillos/arcos radiales KPI para cuotas y porcentajes; área suavizada con línea discontinua de media/tendencia y picos anotados para series temporales; barras horizontales proporcionales para rankings; micro-histogramas/barras apiladas para composición; tablas analíticas compactas `tabular-nums`).
  2. *Uso de colores efectivos, semánticos y simplificados* (ley del contraste, cero exceso de colores chillones, neutrales mineral/obsidiana como lienzo base, acento protagonista lima eléctrico `#C6F19D` / `#1E6B38` y semáforos inequívocos verde/ámbar/coral).
  3. *Narrativa detrás de los datos (Data Storytelling) y despliegue en 3 capas* (Capa 1: impacto ejecutivo + ruta directa al dato; Capa 2: contexto temporal con media, pico anotado y pie `Media · Pico · Actual`; Capa 3: inspección técnica profunda).
  4. *Principios de la Gestalt* (proximidad, semejanza, encierro y cierre) y los 5 pilares de visualización (*Claridad, Legibilidad, Equilibrio, Simplificación del color y Transmisión del mensaje apropiado*).
- **Reglas 5.5 y 6.4**: actualizada la identidad visual contractual universal a *Alethia Botanical Telemetry × Smart Visual Data — Zeus Vision* (`Geist` + `Geist Mono`).

---

## 2. Rediseño Completo de la Interfaz (`v13.0.0` — `MAJOR`)

### 2.1 Sistema de Diseño Global, Tipografía y Paleta Dual
- **[index.html](../index.html)** y **[src/index.css](../src/index.css)**:
  - Tipografía oficial **Alethia**: `Geist` (`400;500;600;700`) para títulos/interfaz con tracking editorial `-0.024em` y `Geist Mono` para navegación, etiquetas técnicas y cifras `tabular-nums`.
  - Escala `@theme` **Mineral-Obsidiana** (`#F8F8F6` → `#F5F4F2` → `#E4E3DD` en claro; `#1A281C` → `#111F13` → `#0A140B` en oscuro) y acento botánico **Alethia** (`#1E6B38` sobre claro / `#C6F19D` eléctrico sobre obsidiana).
  - **Hero Command Deck (`.cockpit-hero`)** en obsidiana botánica profunda `#0F1F10` en ambos modos, reproduciendo la alternancia *oscuro atmosférico → secciones minerales claras `#F5F4F2`/`#FFFFFF`* de Alethia.
  - **Dock flotante obsidiana-lima (`.cockpit-dock`)**, etiquetas sólidas lima (`.cockpit-tag-lime`), botones arquitectónicos con caja de icono cuadrada lima (`.cockpit-btn-alethia`) y corrección de `.cockpit-pill-rose`.

### 2.2 Componentes de Visualización Zeus Vision × Alethia
- **[src/components/DataVizPrimitives.tsx](../src/components/DataVizPrimitives.tsx)** *(nuevo)*:
  - `RadialKpiGauge`: anillo radial SVG segmentado con animación suave y semántica automática (óptimo botánico → elevado ámbar → crítico coral).
  - `AlethiaSectionTag`: micro-etiqueta mono de capa en lima `#C6F19D` (o semántico ámbar/coral cuando existen avisos o sobrecarga).
  - `AlethiaActionButton`: botón con borde fino, etiqueta `Geist Mono` y caja de icono cuadrada `#C6F19D`.
  - `ChartNarrativeFooter`: resumen estadístico compacto `MEDIA · PICO · ACTUAL` bajo cada gráfica.
- **[src/components/TelemetryChart.tsx](../src/components/TelemetryChart.tsx)** y **[src/components/FloatingTooltip.tsx](../src/components/FloatingTooltip.tsx)**:
  - **Línea discontinua de media/tendencia** y **píldora directa de pico global** calculada sobre el máximo real entre todas las series activas del eje izquierdo (con sujeción estricta dentro del lienzo y ocultación automática al inspeccionar con puntero).
  - Tooltip flotante en obsidiana `#0F1F10/96` con borde `#C6F19D/25` y cifras lima tabulares.
- **[src/App.tsx](../src/App.tsx)** y **[src/components/OverviewView.tsx](../src/components/OverviewView.tsx)**:
  - Cabecera arquitectónica `.cockpit-topbar` con navegación `Geist Mono` en escritorio (`xl+`), estado en vivo, selector de tema y píldora de versión con indicador cuadrado `#C6F19D`.
  - **Capa 1 (Hero Deck)** con acceso clicable directo a dispositivos conectados (`banner-devices-btn`) y velocidad global del router (`banner-speed-btn`), tira ejecutiva de 3 anillos radiales (`CPU`, `RAM`, `Disco`) y botón Alethia.
  - **Capa 2 (Telemetría en vivo)** con títulos completos sin truncado en `1440 px`, anillos radiales en tarjetas porcentuales, gráficas con media/pico y pie narrativo `Media · Pico · Actual`.
  - **Capa 3 (Red doméstica)** con encabezado `AlethiaSectionTag` y botón `AlethiaActionButton`.
- **Armonización integral de vistas secundarias y paridad de ecosistema**:
  - Eliminación de los 28 literales hexadecimales legados (`#0284c7`, `#38bdf8`, `#0ea5e9`, `#020617`, `#0f172a`) en `EquipmentView.tsx`, `NetworkSecurityView.tsx`, `AppsMediaView.tsx`, `ProcessHistoryStackedChart.tsx`, `ResourceProcessesPanel.tsx` y `MoreView.tsx`.
  - Conversión del historial de **Speedtest** en `NetworkSecurityView.tsx` a tarjetas compactas en `< 768 px` (`md:hidden`) y tabla analítica en escritorio (`md:block`), eliminando desbordamientos horizontales en `360×800` y `640×900`.
  - Paridad completa en [static/manual.html](../static/manual.html) + [docs/index.html](../docs/index.html), [desktop_app/recursos_app.py](../desktop_app/recursos_app.py) (`NATIVE_CSS`), [Color.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/theme/Color.kt), [CockpitDashboard.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt), [i18n/dictionary.csv](../i18n/dictionary.csv) (+11 claves nuevas en los 31 idiomas), [VERSION](../VERSION) (`13.0.0`) y [README.md](../README.md).

---

## 3. Depuración y Verificación Ejecutada (Regla 9 — Actualización Mayor `13.0.0`)

### 3.1 Validación Estática, Compilación, Python, i18n y Manual
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0` (eliminado import `Activity` sin uso en `OverviewView.tsx`).
- `npx eslint firestore.rules`: salida `0`.
- `npm run build` (`vite v8.3.8`): compilado sin errores (`2106` módulos en `4.59s`; `static/index.html` actualizado).
- `python3 -W error::SyntaxWarning -m py_compile` sobre `server.py`, `i18n_catalog.py`, `desktop_app/recursos_app.py`, `desktop_app/dex_controller.py` y `packaging/sign_deb.py`: salida `0`; auditoría AST: `PYTHON_UNUSED_IMPORTS: 0`.
- `./i18n/dictionary.csv`: `31` idiomas × `1017` claves no-meta, `missing=0`.
- `static/manual.html` == `docs/index.html`: `MANUAL_SHA256_PARITY: OK` y `MANUAL_JS_CHECK: OK (1 scripts)`.

### 3.2 Empaquetado Nativo (`.deb` + `.apk`) y Servicio Productivo
- **Ubuntu (`.deb`)**: `bash packaging/build_deb.sh` generó y firmó `dist/recursos-cockpit_13.0.0_amd64.deb` (clave GPG `4CFC86D58E9146AE`), verificado sin `.db`/`_dev.json`/`.vault` (`DEB_CLEAN_VERIFIED`), instalado (`recursos-cockpit 13.0.0 amd64`) y validado con `/usr/bin/recursos-cockpit --test-mode` (`[OK] Recursos Native Ubuntu HTML5 App v13.0.0 validated successfully`, `dex_unlocked: True`, `scrcpy 3.3.4`).
- **Android / Android TV (`.apk`)**: `bash packaging/build_apk.sh` (`SDK /opt/android-sdk`) completó `:app:assembleRelease` y `:app:lintVitalRelease` (`BUILD SUCCESSFUL in 43s`), generando `dist/recursos-cockpit_13.0.0.apk` + `SHA256SUMS.txt.asc`.
- **Producción (`/home/servidor/servicios/dashboard`)**: `system-dashboard.service` `active`, `0 loaded units listed`, `/api/version?refresh=1` -> `VERSION: 13.0.0 DEB: 13.0.0 NEEDS_INSTALL: False`, `HTTP 200` en `/`, `/manual` y `/readme`.

### 3.3 Auditoría Geométrica, Consola e Inspección Visual Real en Chrome Headless CDP
- **Pasada #1** detectó 3 detalles pulidos de inmediato: pico en multi-serie (`TelemetryChart.tsx`), tabla Speedtest en `360–640 px` (`NetworkSecurityView.tsx`), y truncado de títulos + tono semántico ámbar del tag Hero (`OverviewView.tsx`).
- **Pasada #2 final** (17 vistas × 5 viewports `1440×900`, `1024×768`, `768×1024`, `640×900`, `360×800` + modales `banner-devices-btn`, `banner-speed-btn`, `ExpandedChartModal` + estrés Tema Oscuro + Alemán `de`, más inspección visual directa de las capturas PNG):
  - `TOTAL_SCREENS_WITH_ISSUES: 0`
  - `CONSOLE_ERRORS: []`
  - `EXCEPTIONS: []`
  - `FAILED_REQS: []`
