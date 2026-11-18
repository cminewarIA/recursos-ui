# Walkthrough — v12.19.0

## Cambios Verificados
- **Versión (`./VERSION`)**: Incrementada de `12.18.1` → `12.19.0` (*MINOR* por incorporación del nuevo subapartado funcional *Historial de tráfico* y reorganización estructural de la vista de Red).
- **Contención total del scroll en ventanas emergentes + Efecto Gelatina (`src/utils/scrollContain.ts`)**:
  - Captura unificada en `pointerdown` / `mousedown` / `mousemove` / `wheel` / `scroll` incluso en scrollbars finos o superpuestos en Linux/macOS/Android, evitando cualquier deriva de `window.scrollY` al arrastrar o empujar en los topes superior e inferior.
  - Exclusión de autoscroll de fondo mientras dura el arrastre de barra de desplazamiento y extensión al contenedor interior de popups de grupos Leaflet (`.leaflet-popup-content-wrapper`).
  - Física elástica (`animateScrollJelly`) ejecutada por GPU sobre `translate3d` + `scaleX` + `scaleY` sin saltos bruscos de interpolación WAAPI.
- **Subapartado `Historial de tráfico` (`/src/App.tsx`, `/src/components/NetworkSecurityView.tsx`, `/server.py`, `/vite.config.ts`)**:
  - Eliminada la sección global repetida de 24 h debajo de todas las pantallas.
  - Incorporada la subpestaña `'traffic'` en `/red` (y alias en `normalizeExternalRoute` / `window.switchView`) con:
    - Gráfica de Evolución 24 h WAN/LAN + KPIs máximos e Inspección Táctil.
    - Bloque *Curiosidades de tu red* derivado en tiempo real sin datos estáticos (Haversine km + luz en fibra óptica, volumen integrado WAN/LAN, pico y huella global ISP/países/bloqueos).
    - Tarjetas simétricas de **Dominios más utilizados**, **Servicios más usados** y **Países con más conexiones** respaldadas por SQLite + Pi-hole `/api/dns/traffic` + `/api/net/history`.
- **Tarjeta `Dispositivos con permiso de acceso` en cuadrícula multi-dispositivo (`src/components/MoreView.tsx`)**: Corregido el diseño que lucía correcto con un solo dispositivo pero comprimía textos y botones cuando coexistían múltiples dispositivos reales en `.cockpit-auto-grid-cards` (eliminando `sm:flex-row`, añadiendo `min-w-0`, `!items-start`, cabecera con icono por plataforma, franja IP/última visita alineada, chips de sesiones agrupadas, pie de acciones uniforme y detalle técnico encapsulado con scroll contenido).
- **Diccionario multi-idioma (`./i18n/dictionary.csv`) y documentación (`./README.md`)**:
  - Verificada la paridad exacta de `33` columnas (`964` filas).
  - Documentación y paquete Debian `.deb` actualizados sin errores de TypeScript, ESLint ni compilación Python/Vite.
