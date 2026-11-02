# Plan de Implementación — v11.0.0 (Rediseño Integral: Orbital Horizon & Liquid Titanium Command Matrix)

## 1. Desglose Conceptual de la Nueva Arquitectura de Información (UI/UX)
1. **Eliminación de Redundancia Estructural y Lienzo Panorámico al 100%**:
   - **Problema previo**: La interfaz mantenía una barra lateral izquierda fija de `244px` en escritorio simultáneamente con una barra superior y un dock inferior con los mismos 12 enlaces, restando espacio horizontal valioso a los osciloscopios, tablas y mapas.
   - **Nueva solución**: El lienzo principal (`.main-pane`) ocupa el **100% del ancho de la pantalla** sin columnas laterales permanentes. El índice completo de módulos (`#appSidebar`) se transforma en un **Cajón de Mando Flotante bajo demanda (*On-Demand Slide-Over Command Drawer*)** con cristal esmerilado (`backdrop-filter: blur(24px)`).
2. **Puente de Mando Orbital de 4 Dominios Cognitivos + Cinta Sub-Nav Contextual**:
   - En lugar de presentar 13 vistas planas al mismo nivel, la navegación superior se organiza en **4 dominios lógicos**:
     1. **`01 · Misión`**: Cabina Central (`/`).
     2. **`02 · Silicio`**: Procesador (`/procesador`), Memoria RAM & Swap (`/memoria`), Tarjeta Gráfica (`/grafica`) y Almacenamiento (`/almacenamiento`).
     3. **`03 · Red & Escudo`**: Red, Interfaces & Mapa Geoespacial (`/red`), Ciberdefensa & Certificados Zero-Trust (`/seguridad`) y DuckDNS & Tráfico FTL (`/dns`).
     4. **`04 · Operaciones`**: Contenedores Docker & Servicios (`/aplicaciones`), Descargas & Emby (`/descargas`), Monitor de Procesos D3.js (`/procesos`), Gestor OTA GitHub (`/version`) y Estación USB DeX (`/dex`, desbloqueada exclusivamente en Ubuntu Nativo según Regla 7.5).
   - Bajo el HUD superior se despliega la **Cinta Contextual de Sub-Navegación (`.orbital-subnav-bar`)** con píldoras técnicas e insignias numéricas en tiempo real para saltar en 1 clic entre cualquier subsistema.
3. **Nuevos Módulos de Valor Añadido**:
   - **Cinta Global de Signos Vitales e Índice de Salud del Nodo (`#ovVitalPulseRibbon`)**: Calcula dinámicamente un *Health Score (`0–100%`)* ponderando carga de CPU, presión de RAM, llenado de disco raíz y eventos de error del sistema, acompañado de 4 pods interactivos (Salud Global, Termodinámica & Reloj, Caudal WAN/LAN y Escudo Ciberdefensa).
   - **Paleta de Comandos Spotlight (`⌘K` / `Ctrl+K` · `#commandPaletteDialog`)**: Buscador modal instantáneo accesible por teclado o clic para saltar a cualquier vista, abrir el Centro Unificado de Fallos, auditar los 60 FPS o conmutar entre modo oscuro y claro.
4. **Sistema Visual "Obsidian Titanium & Ceramic Alabaster"**:
   - Modo Oscuro sobre vacío obsidiana (`#04060B`) y titanio líquido (`#0A0F1A` / `#101726`) con malla arquitectónica sutil y modo claro de alabastro cerámico (`#EEF2F6` / `#FFFFFF`).
   - Pilares de telemetría con barras láser superiores semánticas (Cian CPU, Violeta RAM, Esmeralda GPU, Ámbar Discos).

## 2. Sincronización Canónica (Reglas 3, 4, 5 y 6)
- Incremento `MAJOR` de `10.5.2` a **`11.0.0`** en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
- Compilación e instalación local verificada de `dist/recursos-cockpit_11.0.0_amd64.deb`.
