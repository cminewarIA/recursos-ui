# Plan de Implementación — v12.19.0

## Resumen Ejecutivo
1. **Aislamiento hermético del scroll en ventanas emergentes + física elástica tipo gelatina (`src/utils/scrollContain.ts`)**:
   - Impedir que arrastrar el pulgar de la barra de desplazamiento o hacer rueda/gesto táctil en los extremos de cualquier ventana modal, desplegable (`role="listbox"`) o lista de grupo Leaflet arrastre el documento principal de fondo.
   - Bloquear también `<html>` (`document.documentElement.style.overflowY`) durante bloqueos de modal sin mover el ancho útil ni perder la posición `scrollY`.
   - Aplicar animación GPU WAAPI con `easing: 'linear'` a nivel de efecto y curvas amortiguadas por fotograma clave (`cockpit-scroll-jelly`) diferenciando rebote en bordes (`480 ms`) y desplazamiento interior suave (`280 ms`).
2. **Subapartado dedicado `Historial de tráfico` en Vista Red (`/src/components/NetworkSecurityView.tsx` & `/src/App.tsx`)**:
   - Retirar el bloque global *Historial de Tráfico de Red (24 h)* de `/src/App.tsx` para que deje de repetirse debajo de todas las vistas y subapartados.
   - Crear la pestaña `'traffic'` (*Historial de tráfico*) dentro de `/red`, alojando en un diseño simétrico Bento:
     - **Evolución del Tráfico de Red (24 h)** (WAN/LAN Bajada y Subida, picos máximos e Inspección Táctil).
     - **Curiosidades de tu red**: 4 cálculos reales en vivo (*Zero-Hardcoding*):
       1. Nodo GeoIP más lejano (fórmula Haversine en km) + latencia física mínima ida y vuelta de la luz en fibra de sílice (`~204,200 km/s`).
       2. Volumen total integrado de las últimas 24 h (reparto WAN/LAN y equivalencia en horas de vídeo HD 1080p).
       3. Ráfaga pico exacta (hora y proporción descarga/subida).
       4. Huella global en vivo (países distintos, proveedores ISP y total de bloqueos DNS/IPS).
     - **Dominios más utilizados**: fusión de top 24 h Pi-hole + `domains_catalog` SQLite + conexiones activas con filtro *Todos / Bloqueados*.
     - **Servicios más usados**: catálogo agrupado (`services_catalog` + conexiones activas) con impactos, IPs únicas, dispositivos y protocolos.
     - **Países con más conexiones**: catálogo geográfico (`countries_catalog` + GeoIP en vivo) con bandera regional Unicode e internacionalización vía `Intl.DisplayNames`.
3. **Endpoints de backend y paridad dev (`server.py` & `vite.config.ts`)**:
   - Ampliar `/api/net/history` con `countries_catalog`, `domains_catalog`, `services_catalog` y resumen cuantitativo.
   - Ampliar `/api/dns/traffic` con resumen 24 h y lista agregada `top_domains` reales de Pi-hole (`pihole-FTL.db` o caché observada en Vite dev).
4. **Internacionalización completa (`./i18n/dictionary.csv`)**:
   - Registrar las nuevas claves en los 31 idiomas del diccionario tabular sin romper paridad de columnas.
5. **Simetría multi-dispositivo en `Dispositivos con permiso de acceso` (`src/components/MoreView.tsx`)**:
   - Refactorizar cada tarjeta de dispositivo autorizado como columna vertical compacta (`min-w-0 flex-col`) optimizada para compartir filas en `.cockpit-auto-grid-cards` (`!items-start`), sustituyendo `sm:flex-row` (que dependía del viewport y aplastaba textos/botones en tarjetas de ~310 px cuando hay varios dispositivos reales) por cabecera con icono por tipo de hardware, tiras de IP/visita alineadas y pie uniforme al fondo junto a detalles técnicos encapsulados (`max-h-48 overflow-auto overscroll-contain`).

