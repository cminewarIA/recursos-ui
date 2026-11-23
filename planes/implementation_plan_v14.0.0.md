# Rediseño Integral de la Interfaz — Recursos Cockpit v14.0.0

Rediseño global de la interfaz de Recursos Cockpit hacia una estética **Mission Control / Industrial Cyberpunk** de alta densidad, con navegación lateral colapsable en escritorio, cabecera unificada conforme al Top Bar Contract, instrumentación HUD de precisión con medidores radiales y micro-barras de saturación, y escalado fluido sin desbordamientos en las 5 vistas canónicas.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Al haber continuado sin seleccionar opciones en el cuestionario interactivo, se adoptan las direcciones arquitectónicas recomendadas por la normativa de diseño y las reglas del proyecto (`GEMINI.md`):

- **Dirección estética seleccionada**: **Mission Control & Industrial Cyberpunk Telemetry** (Obsidiana profunda `#0B0F17` / `#0F172A`, superficies estructurales de grafito mate `#1E293B`, acentos de precisión cian eléctrico `#06B6D4` / `#38BDF8`, indicadores de alerta en ámbar `#F59E0B` y coral `#EF4444`, complementado con un modo claro arquitectónico de alta pureza `#F8FAFC`).
- **Navegación y lienzo de trabajo**: En pantallas de escritorio (`md+`), la navegación principal pasa a una **barra lateral izquierda fija y colapsable** ($64\text{px}$ compacta / $240\text{px}$ expandida) que libera la totalidad de la altura vertical de la pantalla para gráficas y datos. En dispositivos móviles y pantallas estrechas (`< 768px`), se mantiene un dock inferior refinado con acceso táctil optimizado de $\ge 44\text{px}$.
- **Disciplina visual Anti-Slop**: Supresión total de píldoras estáticas y badges decorativos sobre metadatos; los datos secundarios se muestran como texto limpio con separadores tipográficos (`·`, `/`) y cifras numéricas estrictamente tabulares (`tabular-nums`).
- **Cero pérdida funcional y persistencia única**: Se preservan al 100% todos los módulos, histórico SQLite local (`recursos_history.db`), simplificación y diagnóstico IA de fallos y conexiones, sincronización Firebase, y herramientas de red/hardware en sus 5 apartados lógicos.

---

## 1. Overview & Core Concept

- **Qué hace**: Proporciona un centro de mando y observabilidad integral para servidores domésticos y de laboratorio en tiempo real (CPU, núcleos, GPU, RAM/ZRAM, discos independientes, tráfico WAN/LAN separado, topología de red, mapa GeoIP interactivo, Docker, Systemd, Speedtest y diagnóstico inteligente de fallos con IA).
- **Público objetivo**: Administradores de sistemas, desarrolladores, usuarios de home lab (NAS, Docker, media servers) y entusiastas del hardware que demandan lectura instantánea sin fricción visual ni saturación.
- **Propuesta de valor clave**: Transformar la telemetría del servidor en una experiencia de instrumentación de cabina aeronáutica/industrial, donde cada píxel transmite un dato útil, las series temporales ofrecen contexto inmediato (media, pico y actual) y las acciones críticas (reinicio, apagado, Wake-on-LAN) responden en menos de 200 ms.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Revisión Ejecutiva (0 a 3 segundos)**:
   - El usuario abre la aplicación y visualiza inmediatamente en `/inicio` la barra de estado superior con salud global, latencia de red y carga crítica.
   - En la zona Hero, medidores angulares y porcentuales de CPU, memoria y almacenamiento muestran el estado de los recursos principales de un solo vistazo.
2. **Exploración y Filtrado Profundo (3 a 30 segundos)**:
   - Con un clic o atajo en la barra lateral, el usuario conmuta entre `/inicio`, `/equipo`, `/red`, `/programas` y `/mas`.
   - En `/red`, alterna entre el tráfico exterior (WAN) y local (LAN), inspecciona las conexiones en el mapa interactivo agrupado por GeoIP o consulta el historial persistente de Speedtest y diagnósticos IA.
3. **Inspección Técnica y Diagnóstico Asistido**:
   - Al hacer clic en cualquier gráfica o alerta, se abre el modal de inspección táctil (`ExpandedChartModal`) sin saltos de scroll en el fondo, con zoom temporal (`5m` a `Todo`) y modo cursor de precisión.
   - En `/mas` y en el avisador de fallos, la IA clasifica el nivel de peligro y sugiere soluciones ejecutables en 1 clic.

### Visual Identity & Theme

- **Aesthetic Direction**: *Industrial Cyberpunk Mission Control* — sobrio, funcional, con ritmo de cuadrícula estricto y geometría refinada.
- **Color Palette & Mood**:
  - *Modo Oscuro*: Fondo base Canvas `#0B0F17`, superficies Bento `#111827` con bordes sutiles `rgba(56, 189, 248, 0.12)`, acento primario cian eléctrico `#06B6D4` / `#38BDF8`, estado nominal esmeralda `#10B981`, advertencia ámbar `#F59E0B`, fallo crítico coral `#EF4444`.
  - *Modo Claro*: Fondo base Canvas `#F8FAFC`, superficies `#FFFFFF` con bordes `#E2E8F0`, acento primario azul marino/cobalto `#0284C7` y textos de alto contraste `#0F172A`.
  - *Regla 60-30-10*: 60% lienzo neutro, 30% superficies estructurales Bento, 10% acento funcional focalizado en botones activos, barras de progreso y cursores.
- **Typography & Hierarchy**:
  - *Fuente de Interfaz y Encabezados*: `Plus Jakarta Sans` / `Outfit` para títulos limpios y lectura humana sin estridencias mecánicas.
  - *Fuente de Datos, Telemetría y Código*: `JetBrains Mono` / `Geist Mono` con `font-variant-numeric: tabular-nums` para que contadores, IPs, velocidades y porcentajes permanezcan perfectamente alineados verticalmente.
  - *Escala Tipográfica*: Títulos Hero `clamp(1.75rem, 2.8vw, 2.5rem)`, títulos de sección `16px–20px` con tracking `-0.02em`, métricas primarias `24px–32px tabular-nums`, texto base `14px`, metadatos discretos `11px–12px`.
- **Component Styling & Layout**:
  - Rejilla adaptativa universal `.cockpit-auto-grid` basada en `minmax(clamp(260px, 22vw, 360px), 1fr)`.
  - Contenedores planos de elevación única con bordes hairline (`1px solid var(--border)`).
  - Eliminación de bordes gruesos asimétricos y de píldoras estáticas. Los indicadores de estado se presentan con etiquetas sobrias mono o insignias semánticas con texto explícito (accesibilidad para daltonismo).

### Interactive Feedback & Motion

- Transiciones fluidas en $\le 180\text{ms}$ utilizando curvas de desaceleración `cubic-bezier(0.16, 1, 0.3, 1)`.
- Respuesta elástica WAAPI confinada exclusivamente a los topes de scroll (`edge`), protegiendo los modales con `overscroll-contain`.
- Resaltado sutil en `:focus-visible` con anillo cian para navegación por teclado y control remoto de Android TV.

---

## 3. Key Product Decisions & Trade-Offs

- **Decisión 1: Barra lateral colapsable en escritorio frente a dock inferior permanente**:
  - *Enfoque*: En pantallas de escritorio y tablets apaisadas (`md+`), la navegación se traslada al lateral izquierdo con modo compacto de iconos y modo extendido. En móvil (`< 768px`), se preserva el dock flotante inferior.
  - *Por qué*: En monitores 1080p y portátiles 16:9 / 16:10, la altura vertical es el recurso más escaso para ver series temporales completas sin hacer scroll; una barra lateral aprovecha el espacio horizontal excedente.
  - *Alternativa descartada*: Mantener barra inferior en monitores ultrawide, lo que desperdiciaba franjas laterales de más de 400px.
- **Decisión 2: Instrumentación HUD Vectorial en vez de gráficos pesados Canvas**:
  - *Enfoque*: Medidores SVG vectoriales limpios y D3 para curvas de área continua, calculados con interpolación monótona Fritsch-Carlson y memoización de umbral.
  - *Por qué*: Consumo de CPU inferior al 1%, escalado nítido en pantallas 4K/Retina y renderizado inmediato sin pausas.
- **Decisión 3: Criterio de Versión `v14.0.0` (`MAJOR`) conforme a `GEMINI.md`**:
  - *Enfoque*: Al tratarse de un rediseño completo de la interfaz, el sistema de diseño y la disposición de navegación, se eleva la versión canónica a `14.0.0` restableciendo `MINOR` y `PATCH` a 0.
  - *Depuración obligatoria*: Auditoría de imports sin uso, verificación estricta de tipos (`tsc`), validación de diccionario en 31 idiomas y reconstrucción de paquetes nativos `.deb` y `.apk`.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Recursos Cockpit v14.0.0                        │
│                                                                        │
│   ┌───────────────────┐  ┌──────────────────────────────────────────┐  │
│   │   Sidebar Nav     │  │  Top Bar (Brand · Breadcrumb · Actions)  │  │
│   │   (Icons / Labels)│  └──────────────────────────────────────────┘  │
│   │                   │  ┌──────────────────────────────────────────┐  │
│   │   [01] Inicio     │  │  Main ViewStage (AnimatePresence)        │  │
│   │   [02] Equipo     │  │  ┌────────────────────────────────────┐  │  │
│   │   [03] Red        │  │  │ Dynamic Bento Grid Layout          │  │  │
│   │   [04] Programas  │  │  │ ┌──────────────┐ ┌───────────────┐ │  │  │
│   │   [05] Más        │  │  │ │ HUD Gauge    │ │ TelemetryChart│ │  │  │
│   │                   │  │  │ └──────────────┘ └───────────────┘ │  │  │
│   │   [Collapse/Exp]  │  │  └────────────────────────────────────┘  │  │
│   └───────────────────┘  └──────────────────────────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ HTTP SSE / Polling (~1.5s)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Backend Host (server.py)                         │
│  - Endpoint /api/metrics con Byte-Splicing en caché (~17 ms)           │
│  - Captura POSIX (ss, conntrack, /sys, psutil, procfs)                 │
│  - Persistencia única SQLite WAL (recursos_history.db)                 │
│  - Motor Speedtest Multi-stream Keep-Alive                             │
│  - Diagnóstico y simplificación IA (Gemini API)                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Component & State Architecture

1. **`src/App.tsx`**:
   - Orquesta la navegación lateral en escritorio (`sidebarOpen`, `toggleSidebar`), el Top Bar de 3 zonas y el ViewStage principal.
   - Conecta el estado global de telemetría (`MetricsPayload`), tema (`light`/`dark`), idioma y sincronización Firebase.
2. **`src/components/NavigationSidebar.tsx`** *(Nuevo componente)*:
   - Barra de navegación lateral fija en escritorio con tooltip flotante de atajos, iconos semánticos y transición fluida.
   - En pantallas móviles conmuta automáticamente a navegación táctil inferior sin recortes.
3. **`src/components/OverviewView.tsx`**:
   - Reorganizado en una jerarquía clara:
     1. *Banda de Control Ejecutivo*: 4 indicadores HUD vectoriales angulares (`CPU`, `RAM`, `Disco Primario`, `Red Total`).
     2. *Rejilla de Telemetría Dinámica*: Curvas de uso temporal en cubetas de 5s con anotación de media y pico, y desglose independiente por cada unidad de disco física.
     3. *Gestión de Dispositivos Domésticos*: Tarjetas de equipos activos con métricas de ancho de banda y botones simétricos de encendido (WoL) y apagado seguro.
4. **`src/components/EquipmentView.tsx`**:
   - Silicio por núcleo en micro-rejilla dinámica, telemetría GPU multivariante (3D, VRAM, Video, Temp, PCIe) y áreas apiladas de procesos de 24h.
5. **`src/components/NetworkSecurityView.tsx`**:
   - Medición WAN vs LAN desacoplada, histórico de Speedtest calibrado, mapa Leaflet GeoIP interactivo con clusters fluidos e histórico de identificaciones IA persistido en `recursos_history.db`.
6. **`src/components/AppsMediaView.tsx`** y **`src/components/MoreView.tsx`**:
   - Monitorización de Docker/Systemd/qBittorrent/Emby, y panel de configuración con diagnósticos IA de fallos, dispositivos HMAC y sincronización en la nube.

---

## 5. Implementation Phases & Verification Steps

1. **Fase 1: Sistema de Diseño & Tokens CSS (`src/index.css`)**:
   - Configuración de paleta *Mission Control* (Obsidiana `#0B0F17` / Cian `#06B6D4` / Grafito `#1E293B`), tipografía `Plus Jakarta Sans` + `JetBrains Mono` con `tabular-nums`, y variables `@theme` completas para modo claro y oscuro.
2. **Fase 2: Componente de Navegación Lateral & Top Bar Contract (`src/components/NavigationSidebar.tsx`, `src/App.tsx`)**:
   - Creación de la barra lateral colapsable en escritorio y adaptación del dock en móvil.
   - Refactorización de la cabecera superior en 3 zonas estrictas sin sobrecarga visual.
3. **Fase 3: Rediseño de Vistas y Componentes de Telemetría (`src/components/*`)**:
   - Adaptación de tarjetas Bento, medidores angulares y gráficas de `/inicio`, `/equipo`, `/red`, `/programas` y `/mas` bajo los nuevos patrones anti-slop.
4. **Fase 4: Diccionario i18n & Actualización de Versión (`./VERSION` -> `14.0.0`)**:
   - Incorporación de nuevas claves de navegación y opciones en las 33 columnas de `./i18n/dictionary.csv`.
5. **Fase 5: Depuración Estricta, Compilación y Empaquetado**:
   - `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `npx eslint firestore.rules`, `python3 -m py_compile`, `npm run build` y empaquetado `build_deb.sh`.
