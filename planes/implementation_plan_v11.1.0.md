# Plan de Implementación — v11.1.0 (Purga de Redundancias Visuales y Unificación Espacial 4×2)

## 1. Diagnóstico de Redundancias Detectadas en `v11.0.0`
1. **Triple Sistema de Navegación Simultáneo**:
   - Coexistían al mismo tiempo: (a) Los **4 Dominios Superiores** (`01 · Misión` .. `04 · Operaciones`), (b) la **Cinta Contextual (`#orbitalSubnavBar`)** con los 13 módulos expuestos simultáneamente, (c) el **Dock Flotante Inferior (`#floatingDockShell`)** con los mismos 13 botones, y (d) el **Cajón Lateral (`#navDrawer`)**, además de los botones `< >` y el chip `/` en el header.
2. **Botones de Acción Duplicados**:
   - `📋 Diagnóstico Logs` y `⚡ Acciones Rápidas` en `#orbitalSubnavBar` duplicaban el botón `Logs` del panel central y el buscador `⌘K` de la barra superior.
   - El botón `Logo SO` junto al emblema interactivo `#hostOsEmblemBtn` duplicaba la misma acción de selección de icono.
   - Los botones `🖼️` y `🖼️ Logo` en tarjetas NIC y filas de dispositivos de red duplicaban el clic directo sobre el avatar del dispositivo/interfaz.
   - Múltiples insignias pasivas (`Auditoría 60fps`, `Telemetría Activa`, `Zero-Trust`) repetían información ya implícita en el indicador de pulso en tiempo real.
3. **Métricas y Tarjetas Duplicadas en `01 · Misión` (`#viewOverview`)**:
   - La cinta de 4 cápsulas `#ovVitalPulseRibbon` (`Índice de Salud`, `Carga & Térmica`, `Caudal WAN`, `Escudo & Nodos`) repetía exactamente los mismos valores situados justo debajo en los 4 pilares de telemetría (CPU, Red y Seguridad).
   - Los medidores radiales (`#gaugeCpuText`, `#gaugeGpuText`, `#gaugeDiskText`) mostraban el mismo porcentaje en el centro del anillo y a su lado en tipografía gigante.
   - El grid inferior `.modules-bento-grid` de 6 tarjetas incluía 2 tarjetas redundantes: `Dominio Dinámico & Tráfico DNS` (cuyos datos ya figuran en la cabecera del nodo `.command-banner` y en el dominio `03`) y `Control de Versión & GitHub OTA` (ya presente en `.top-header` y en el dominio `04`).

---

## 2. Arquitectura Depurada en `v11.1.0`
1. **Navegación Contextual Única y Limpia**:
   - **Retirada del Dock Inferior (`#floatingDockShell`)**: Ocultado visualmente (`display: none !important`), eliminando la barra flotante de 13 iconos en la parte inferior.
   - **Cinta Contextual Inteligente (`#orbitalSubnavBar`)**:
     - En **`01 · Misión` (`overview`)**: Se oculta automáticamente (`display: none`), dejando toda la altura vertical libre para el panel de mando.
     - En **`02 · Silicio`**, **`03 · Red & Escudo`** y **`04 · Operaciones`**: Muestra **únicamente las 3 a 5 píldoras pertenecientes al dominio activo**, sin mostrar las de otros dominios ni botones de acción duplicados.
   - **Cabecera Superior Depurada**: En la zona izquierda solo permanece `[☰ Módulos] Recursos` + un indicador sutil `/ Subvista` cuando se navega fuera de `overview`.
2. **Fusión de Salud Global en el Panel de Identidad del Nodo (`.command-banner`)**:
   - Se elimina `#ovVitalPulseRibbon` como fila separada y se integra el **Índice de Salud Global (`100% ÓPTIMO`)** + el acceso directo al **Inspector de Logs (`Logs`)** en el extremo derecho de `.command-banner`.
3. **Matriz Simétrica 4×2 en `01 · Misión`**:
   - **Fila Superior (4 Pilares de Telemetría)**: `01 · Procesador & Silicio`, `02 · Acelerador Gráfico`, `03 · Memoria & Almacenamiento`, `04 · Tráfico & Caudal de Red` — con anillos radiales limpios sin texto duplicado en su interior y pies de tarjeta de enlace directo.
   - **Fila Inferior (4 Módulos Operativos)**: `Red, Mapa & Clientes`, `Docker & Servicios`, `Ciberdefensa (Pi-hole & IPS)`, `Descargas & Videoteca` — logrando una simetría 4×2 perfecta.

---

## 3. Sincronización Canónica (`v11.1.0`)
- Incremento `MINOR` a **`11.1.0`** en `VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
- Compilación e instalación local verificada de `dist/recursos-cockpit_11.1.0_amd64.deb`.
