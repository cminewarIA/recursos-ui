# Plan de Implementación — Presentación Interactiva Keynote en `README.md` (`v4.13.1`)

## 1. Objetivo
Transformar el archivo `/README.md` en una presentación interactiva estilo **Apple Keynote & Tesla Touch Cockpit** compuesta por **10 diapositivas navegables** (`Slide 01` a `Slide 10`), documentando con máxima creatividad visual todas las características arquitectónicas, visuales, de red, ciberseguridad y telemetría del proyecto **System Cockpit (`dashboard-recursos`)**.

## 2. Decisiones Confirmadas con el Usuario
- **Alcance**: Exclusivamente dentro de `/README.md` como deck interactivo en Markdown/HTML5 (sin alterar el código funcional de la aplicación web).
- **Estilo Visual y Narrativo**: Estética **Apple Keynote & Tesla Touch Cockpit** con diagramas visuales y barra de navegación entre diapositivas.
- **Elementos Interactivos Incluidos**:
  1. Diagramas **Mermaid** (arquitectura, flujo GeoIP + LRU, secuencia `PiholeDnsTranslator`, pipeline IPS Fail2ban) y wireframes **ASCII/SVG** en las diapositivas.
  2. Controles de navegación entre diapositivas (`⏮ Anterior`, índice numérico `01`..`10`, `Siguiente ▶`) mediante anclas HTML (`#slide-01` a `#slide-10`) y **Notas del Orador desplegables** (`<details><summary>🎙️ Notas del Orador...</summary>...</details>`).
  3. Tabla comparativa interactiva del **Antes vs. Ahora** del sistema y catálogos desplegables de las 12 vistas SPA y endpoints REST.
  4. Diapositiva final con el **Historial Completo de Versiones (`v4.0.0` a `v4.13.1`)** y la filosofía **100% Zero-Hardcoding**.

## 3. Estructura de las 10 Diapositivas
1. **Slide 01**: Portada Keynote (`System Cockpit v4.13.1`), insignias dinámicas, wireframe panorámico ASCII del cockpit y barra de navegación.
2. **Slide 02**: Lenguaje de Diseño *Apple Liquid Glass + Tesla Touch Cockpit*, temas Space Black Titanium y Natural Brushed Titanium, Floating Touch Dock, Touch Swipe y modales `<dialog>` con scrubbing táctil.
3. **Slide 03**: Inteligencia Geoespacial en Vivo — Mapa Mundial OpenStreetMap (nodo central en Gran Canaria), clustering por zoom, persistencia de popups en 5 niveles, worker asíncrono `ip-api.com` y poda automática LRU en `localStorage` (`GEOIP_MAX_ENTRIES = 500`, `v4.13.0`).
4. **Slide 04**: Analítica Avanzada de Red — Gráfico de Pastel animado con **D3.js v7** (`d3.interpolate` + `attrTween`, `550ms cubic-out`, `v4.10.0`–`v4.11.0`) y Alerta Visual por Umbral de Ancho de Banda NIC (`v4.12.0`).
5. **Slide 05**: `PiholeDnsTranslator` y Visibilidad de Dispositivos del Hogar (`v4.7.0`–`v4.9.0`) con diagrama de secuencia Mermaid (`pihole-FTL.db`, DHCP leases, `nf_conntrack`, DNS inverso PTR).
6. **Slide 06**: Ciberdefensa Activa IPS (`v4.4.0`–`v4.6.0`) — Bloqueo de IPs en 1 clic desde el mapa y la tabla con `fail2ban-client`, `iptables`/`ufw` y hardening Zero-Trust.
7. **Slide 07**: Los 5 Pilares de Hardware (`CPU`, `RAM`, `GPU`, `Almacenamiento`, `Red`), orquestación Docker, suite multimedia qBittorrent + Emby, DuckDNS y motor de logos inteligente (`v4.2.0`–`v4.3.0`).
8. **Slide 08**: Filosofía Estricta **Zero-Hardcoding** (`GEMINI.md` Regla 7) y motor de renderizado desacoplado a **60 FPS** con auditor en vivo (`#perfAuditDialog`).
9. **Slide 09**: Tabla Comparativa Interactiva (*Antes vs. Ahora*) y Mapa de las 12 Vistas SPA y Endpoints REST.
10. **Slide 10**: Historial de Versiones (`v4.0.0` a `v4.13.1`), estructura del repositorio y comandos de despliegue rápido.

## 4. Control de Versión (`GEMINI.md` Regla 5)
- Incremento de tipo `PATCH` (`4.13.0` -> `4.13.1`) en `./VERSION` y `./package.json` al tratarse de una renovación documental en `README.md` sin alterar funciones ni diseño de la aplicación.
