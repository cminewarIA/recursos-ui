# Plan de Implementación v13.0.0 — Rediseño Completo Alethia × Smart Visual Data (Zeus Vision)

## 1. Objetivo y Alcance (`MAJOR` 12.22.1 → 13.0.0)
De acuerdo con la Regla 2.4 de `./GEMINI.md`, el rediseño global completo del sistema visual, la tipografía, la paleta cromática, los componentes de visualización de datos y la arquitectura por capas corresponde a un incremento `MAJOR`: **`13.0.0`**.

El rediseño integra dos pilares de referencia inspeccionados directamente:
1. **Estándar de Análisis y Visualización de Datos (Zeus Vision)** (`https://zeus.vision/data-talk/mejores-practicas-de-visualizacion-de-datos-y-analisis/`): incorporación formal a las normas del proyecto (`./GEMINI.md`, Regla 10) de los dos bloques teóricos y los patrones extraídos de sus ejemplos de interfaz (anillos radiales KPI, series suavizadas con línea de tendencia/media y picos anotados, barras horizontales comparativas, micro-histogramas, tablas tabulares limpias, simplificación del color, ley del contraste, storytelling y principios de la Gestalt).
2. **Sistema Visual Alethia** (`https://codewebbarcelona.com/mejores-disenos-web-2027/#ref-alethia` y `alethia.earth`):
   - **Tipografía**: `Geist` (display y cuerpo con tracking editorial ajustado) + `Geist Mono` (micro-etiquetas técnicas, navegación y números `tabular-nums`).
   - **Cromática dual**: Obsidiana botánica profunda (`#0F1F10` / `#0A140B` / `#122014`) + piedra mineral cálida (`#F5F4F2` / `#FFFFFF` / `#EEEDE9`) + acento protagonista lima botánico eléctrico (`#C6F19D`, con texto `#0F1F10` de alto contraste AAA y variante forestal `#1E6B38` sobre claro).
   - **Alternancia oscuro → claro y despliegue por capas**: Hero Command Deck oscuro atmosférico con ruta directa al dato (KPIs ejecutivos radiales, botones clicables de dispositivos/velocidad global y botón Alethia con caja cuadrada `#C6F19D`) seguido de módulos analíticos minerales/obsidiana limpios, aireados y equilibrados.

## 2. Análisis de Ubicación Funcional (Regla 6.2)
- **Normas del proyecto (`./GEMINI.md`)**: se añade la **Regla 10** dedicada a mejores prácticas de análisis, narrativa y visualización de datos (Zeus Vision) y se actualiza la identidad estética en las Reglas 5.5 y 6.4.
- **Capa transversal de diseño (`index.html`, `src/index.css`, `src/components/DataVizPrimitives.tsx`, `src/components/TelemetryChart.tsx`, `src/components/FloatingTooltip.tsx`)**: todos los apartados heredan la misma tipografía, neutrales minerales/obsidiana, acentos botánicos, línea de media discontinua, píldoras de pico y pie narrativo `Media · Pico · Actual`.
- **Apartado `/inicio` (`src/components/OverviewView.tsx`)**: concentra la Capa 1 (Hero ejecutivo con anillos CPU/RAM/Disco + acceso directo a dispositivos y caudal global del router), Capa 2 (tarjetas KPI con anillos radiales Zeus + gráficas Alethia con media/pico/resumen) y Capa 3 (control rápido de aparatos en casa).
- **Apartados `/equipo`, `/red`, `/programas`, `/mas` y modales**: mantienen exactamente su pertenencia funcional sin desplazar módulos, unificando su sistema de acentos, botones activos, barras y series de gráficas al sistema simplificado Alethia × Zeus Vision.
- **Paridad de ecosistema (Regla 5 y 6.4)**: sincronización de `static/manual.html` + `docs/index.html`, `desktop_app/recursos_app.py` (GTK 3 CSS) y `android_app/.../theme/Color.kt` + `CockpitDashboard.kt`.

## 3. Cambios Planificados
1. **`GEMINI.md`**: añadir Regla 10 (Zeus Vision + ejemplos de interfaz) y actualizar identidad visual en Reglas 5.5 y 6.4.
2. **`i18n/dictionary.csv`**: registrar las nuevas claves de interfaz (`overview.layer_*`, `overview.hero_*`, `overview.exec_*`, `charts.stat_*`, `charts.trend_mean`) en los 31 idiomas sin huecos.
3. **`index.html` y `src/index.css`**: cargar `Geist` + `Geist Mono`, redefinir escala `@theme` mineral-obsidiana y tokens Alethia, rediseñar `.cockpit-hero`, `.cockpit-bento`, `.cockpit-dock`, `.cockpit-subtile`, `.cockpit-tag-lime`, `.cockpit-btn-alethia` y `.cockpit-pill-*`.
4. **`src/components/DataVizPrimitives.tsx`**: crear `RadialKpiGauge`, `AlethiaSectionTag`, `AlethiaActionButton`, `ChartNarrativeFooter` y `HorizontalRankBar`.
5. **`src/components/TelemetryChart.tsx` y `src/components/FloatingTooltip.tsx`**: añadir línea discontinua de media/tendencia, píldora de pico directo con sujeción segura dentro del lienzo, y tooltip obsidiana-lima.
6. **`src/App.tsx` y vistas (`OverviewView`, `EquipmentView`, `NetworkSecurityView`, `AppsMediaView`, `MoreView`, `ExpandedChartModal`, `NetworkDevicesModal`, `ProcessHistoryStackedChart`, `ResourceProcessesPanel`)**: rediseño de cabecera, dock obsidiana-lima, Hero Deck, tarjetas con anillos radiales y armonización integral de colores.
7. **Paridad de manual y apps nativas**: `static/manual.html`, `docs/index.html`, `desktop_app/recursos_app.py`, `android_app/.../Color.kt`, `CockpitDashboard.kt` y `README.md`.

## 4. Plan de Depuración y Verificación (Regla 9 — `MAJOR`)
- Compilación estricta: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `npx eslint firestore.rules`, `npm run build`.
- Validación Python y manual: `python3 -W error::SyntaxWarning -m py_compile`, auditoría AST de imports sin uso, paridad SHA-256 `static/manual.html` == `docs/index.html` y `node --check`.
- Validación i18n (`31` idiomas × todas las claves con `missing=0`) y Android Kotlin (`:app:compileReleaseKotlin` / `.apk`).
- Despliegue productivo (`/home/servidor/servicios/dashboard`), reinicio de `system-dashboard.service`, empaquetado `.deb` firmado con GPG + instalación + `/usr/bin/recursos-cockpit --test-mode`.
- Auditoría geométrica + consola en Chrome Headless CDP (17 vistas × 5 viewports + modales + tema oscuro + alemán `de`) e inspección visual directa de capturas de pantalla.
