# ⚡ Recursos — Centro de Mando y Telemetría de Sistemas (`v4.9.1`)

Panel de control de alto rendimiento con interfaz híbrida **Apple Liquid Glass & Tesla Touch Cockpit (`v4.9.1`)**, telemetría de hardware en tiempo real, auditoría de red con **Motor de Mapa Geoespacial 100% Libre y Gratuito (OpenStreetMap / CartoDB Dark Matter)**, **Gráfico de Pastel Interactivo con Transiciones Animadas D3.js (`d3.pie`, `d3.arc`, `d3.interpolate`) de Distribución de Ancho de Banda por Subredes y Grupos de Dispositivos**, **Worker Asíncrono GeoIP (`ip-api.com`) con Caché Multinivel y Limpieza Automática de `localStorage` (`GEOIP_MAX_ENTRIES`)**, **Monitor de Umbral de Caudal por NIC con Alerta Visual en Leyenda** y gestión de contenedores con arquitectura **Zero-Hardcoding (100% Detección Dinámica de Hardware)**, **Acabado Metálico en Titanio Claro/Oscuro/Auto**, **Dock Táctil Flotante + Gestos Swipe**, **Tarjetas Bento Expandibles (`<dialog>`) con Gráficas Interactivas al Tacto**, **Motor Inteligente de Logos de SO y Dispositivos**, seguridad **Zero-Trust** y actualizaciones **OTA en 1 clic desde GitHub**.

---

## ✨ Novedades en `v4.9.1`
- **Estandarización del Criterio Estricto de Versionado Semántico (`GEMINI.md`)**:
  - Incorporada la regla formal de control de versiones unificado:
    - **`X.0.0` (Cambio de Diseño)**: Se sube el primer número ante cambios de diseño/interfaz y se restablecen a 0 los otros dos.
    - **`0.X.0` (Añadir o Quitar Función)**: Se sube el segundo número al añadir o retirar funciones y se restablece a 0 el tercer número.
    - **`0.0.X` (Actualización o Ajuste de Pequeños Detalles)**: Se sube el tercer número ante correcciones, actualizaciones menores, reglas o documentación.
  - Sincronización automática de directrices para Google AI Studio y Antigravity.

## ✨ Novedades en `v4.9.0`
- **Exclusividad del Motor de Mapa Libre y Autónomo (OpenStreetMap / CartoDB Dark Matter)**:
  - **Eliminación Total de Dependencias Propietarias y Claves API**:
    - Se retiró por completo la integración de Google Maps Platform, eliminando la solicitud de claves de API (`VITE_GOOGLE_MAPS_API_KEY`), modales de configuración y selectores innecesarios.
    - El mapa geoespacial funciona de manera 100% autónoma, ilimitada y sin costes mediante **Leaflet.js** con teselas oscuras de **CartoDB Dark Matter / OpenStreetMap**.
  - **Barra de Herramientas del Mapa Simplificada y Limpia**:
    - Sustituido el botón de configuración por una insignia fija y discreta `🗺️ OpenStreetMap (Libre)`.
    - Controles directos y ergonómicos: encuadre total inteligente (`fitAllBounds`), fijación rápida en el nodo host central (`focusServerNode`) y popups interactivos enriquecidos con telemetría de sockets y GeoIP.
  - **Código Optimizado y Arquitectura Limpia**:
    - Se simplificó `NetworkConnectionsMapEngine` en `index.html` y `static/index.html`, reduciendo complejidad y eliminando bloques de script superfluos.
    - En el backend (`server.py`), el endpoint `/api/maps/config` responde de forma directa declarando el motor libre sin sobrecarga de variables de entorno.

## ✨ Novedades en `v4.8.0`
- **Motor Dual de Mapa Geoespacial de Red (OpenStreetMap / Leaflet Gratuito + Google Maps Platform Opcional)**:
  - **OpenStreetMap / CartoDB Dark Matter como Motor Predeterminado (Cero Claves, Cero Coste)**:
    - Resuelve de forma definitiva el aviso bloqueante *"Esperando configuración de VITE_GOOGLE_MAPS_API_KEY..."* activando automáticamente el motor **Leaflet.js + CartoDB Dark Matter**.
    - Renderiza instantáneamente todas las conexiones entrantes (verde `#10B981`), salientes (cian `#06B6D4`), IPs bloqueadas por el IPS Fail2ban (rojo `#F43F5E`) y el nodo host central sin requerir ninguna clave de API, tarjeta de crédito ni cuenta en Google Cloud.
    - Soporte completo para líneas geodésicas direccionales, popups interactivos enriquecidos con datos de GeoIP y ajuste dinámico de encuadre (`fitBounds`).
  - **Soporte Completo de Google Maps Platform Opcional**:
    - Si el usuario cuenta con una clave `VITE_GOOGLE_MAPS_API_KEY`, el dashboard permite utilizar Google Maps Platform con renderizado vectorial y marcadores avanzados.
  - **Selector y Configurador Visual en la Barra de Herramientas (`#mapEngineModal`)**:
    - Botón interactivo `🗺️ Motor: OpenStreetMap (Gratis)` en los controles del mapa que abre un diálogo para alternar fácilmente entre proveedores de mapas e introducir la clave de API con persistencia automática en `.env` y `localStorage`.
    - Botón de recuperación rápida en el overlay de estado para cambiar a OpenStreetMap con un solo clic si Google Maps no está autenticado.

## ✨ Novedades en `v4.7.0`
- **Transiciones Animadas Fluidas con D3.js v7 en el Gráfico de Pastel de la Pestaña `Red` (`NetworkBandwidthPieChart`)**:
  - **Interpolación Angular y Radial con `d3.pie()`, `d3.arc()`, `d3.transition()` y `d3.interpolate()` (`arcTween`)**:
    - **Cambio de Modo de Agrupación o Métrica (`680 ms`, `d3.easeCubicOut`)**: Al conmutar entre `🌐 Subredes IP`, `📶 Grupos de Enlace` y `🖥️ Tipo de Dispositivo` (o entre `📊 Tráfico Acumulado` y `⚡ Caudal en Vivo`), los sectores SVG (`#svgNetBandwidthPie path.bw-pie-arc-path`) interpolan suavemente sus ángulos (`startAngle`, `endAngle`), radios (`innerRadius`, `outerRadius`) y colores desde la disposición anterior sin parpadeos ni reconstrucciones bruscas del DOM.
    - **Actualización Continua ante Cambios en el Tráfico Detectado (`460 ms`, `d3.easeCubicOut`)**: Cuando la telemetría en vivo detecta variaciones en el caudal o volumen de red, cada sector transiciona de forma orgánica desde su estado angular previo (`_current` / `_prevArcStateByKey`) hacia la nueva proporción.
    - **Expansión Radial y Desplazamiento Centroidal al Pasar el Cursor o Fijar Selección (`210–240 ms`)**: Al señalar o pulsar un sector o fila de la leyenda, D3 anima la apertura radial del arco activo (`outerRadius: 98 -> 105`, `innerRadius: 58 -> 56`), proyecta el desplazamiento polar (`translate(dx, dy)`) y aplica un resplandor semántico (`drop-shadow`).
    - **Interpolación Numérica en el Indicador Central (`d3.interpolateNumber`) y Barras de Leyenda in-place**: El contador central (`#bwPieCenterVal`) anima progresivamente la cifra de bytes o caudal (`tween('text', ...)`) y las barras porcentuales de `#bwPieLegendList` se actualizan in-place preservando el estado hover y las transiciones CSS (`cubic-bezier(0.22, 1, 0.36, 1)`).

## ✨ Novedades en `v4.6.0`
- **Gráfico de Pastel Interactivo de Distribución de Ancho de Banda en la Pestaña `Red` (`NetworkBandwidthPieChart`)**:
  - **Tres Dimensiones de Agrupación Interactiva**:
    - **🌐 Por Subredes IP (`/24`)**: Agrupa el consumo de red entre las subredes IPv4 detectadas (`192.168.50.0/24`, `172.x.0.0/16` Docker, `100.x.0.0/16` Tailscale/Mesh, `10.x.x.0/24` VPN y flujos WAN externos), con subdivisión inteligente por segmento (Servidor/Cable, Wi-Fi 5 GHz y Wi-Fi 2.4 GHz) cuando todos los nodos locales comparten una única subred `/24`.
    - **📶 Por Grupos de Enlace**: Compara la proporción de ancho de banda entre **Ethernet Gigabit (Cableado)**, **Wi-Fi 5 GHz (Alta Velocidad)** y **Wi-Fi 2.4 GHz & Red IoT**.
    - **🖥️ Por Tipo / Rol de Dispositivo**: Clasifica automáticamente el consumo entre **Servidor Host & Infraestructura**, **Smart TV, Streaming & Consolas**, **Smartphones & Tablets**, **Ordenadores & Estaciones** y **Domótica, Cámaras & IoT**.
  - **Doble Modo de Métrica (`📊 Tráfico Acumulado` vs `⚡ Caudal en Vivo`)**: Permite alternar en tiempo real entre el volumen total transferido (`↓ RX + ↑ TX Bytes`) y el caudal instantáneo (`B/s`), con fallback automático si los enlaces están en reposo.
  - **Canvas HiDPI Interactivo + Leyenda Sincronizada**: Al pasar el cursor o pulsar sobre un sector del gráfico de pastel (o sobre una fila de la tabla de desglose), el sector se expande con brillo semántico y el indicador central muestra el nombre del segmento, su consumo exacto, porcentaje del total y número de nodos activos.
- **Wake-on-LAN Multivía (`send_wol_magic_packet`) y Feedback Visual de Acciones**: Emisión redundante de paquetes mágicos UDP por broadcast de subred (`192.168.50.255:9/:7`), broadcast global y binario `wakeonlan`, junto con estados de progreso en botones de servicios y contenedores.

## ✨ Novedades en `v4.5.0`
- **Utilería de Limpieza Periódica de `localStorage` para Caché GeoIP (`GeoIpLocalStorageCleaner` & `GEOIP_MAX_ENTRIES`)**:
  - **Control de Capacidad (`GEOIP_MAX_ENTRIES = 1000` en cliente / `2000` en backend)**: Cuando el número total de registros GeoIP en memoria o en `localStorage` (`recursos_geoip_cache_v1`) supera el límite `GEOIP_MAX_ENTRIES`, la utilería `GeoIpLocalStorageCleaner.pruneCache()` ordena las entradas por su marca temporal de uso más reciente (`Math.max(lastAccessed, ts)`) y poda automáticamente las entradas más antiguas hasta un umbral de compactación del 90% (`EVICTION_TARGET_RATIO = 0.9`), evitando reordenamientos continuos en cada lote.
  - **Purga Periódica de Entradas Caducadas (TTL) en Tiempo de Inactividad (`requestIdleCallback`)**: Un temporizador en segundo plano (`GEOIP_CLEANUP_INTERVAL_MS = 60s`) ejecuta barridos de mantenimiento mediante `requestIdleCallback` para eliminar entradas con TTL vencido (`> 7 días`), registros corruptos, claves heredadas obsoletas y entradas caducadas de la caché negativa (`> 10 min`) sin bloquear el hilo principal.
  - **Resiliencia ante `QuotaExceededError` y Escritura Debounced**: Escrituras agrupadas (`300 ms` debounce) y recuperación automática ante saturación de cuota de `localStorage` podando el 50% más antiguo de la caché.
  - **Telemetría de Ocupación en Vivo (`#geoIpWorkerStatusBadge`)**: El indicador de estado del mapa muestra ahora la ocupación respecto al límite (`GeoIP Caché: X/1000`), el peso en KB en `localStorage` y el contador de entradas obsoletas podadas.

## ✨ Novedades en `v4.4.0`
- **Worker Asíncrono de GeoIP en Segundo Plano (`ip-api.com`) con Caché Multinivel**:
  - **Cola de Resolución Asíncrona y Despertado Instantáneo (`GEOIP_PENDING_QUEUE` + `GEOIP_WAKE_EVENT`)**: Todas las direcciones IP públicas remotas detectadas en sockets del kernel (`/proc/net/tcp`, `/proc/net/udp`, `psutil.net_connections`), clientes HTTP entrantes, objetivos DNS salientes e IPs bloqueadas por Fail2ban se encolan de inmediato y se resuelven de forma no bloqueante en lotes de hasta 80 IPs contra `http://ip-api.com/batch`.
  - **Caché Persistente Multinivel (Disco + Memoria + Cliente)**:
    - **Backend (`server.py` y `vite.config.ts`)**: Caché en memoria (`GEOIP_CACHE`) respaldada por persistencia atómica en disco (`geoip_cache.json`) con TTL de 7 días (evitando volver a consultar `ip-api.com` tras reinicios del servidor) y **caché negativa** de 15 minutos para IPs reservadas o no resolubles.
    - **Control Inteligente de Rate-Limit (`X-Rl` / `X-Ttl`)**: Inspección automática de cabeceras de cuota de `ip-api.com` para proteger el límite de peticiones por minuto.
    - **Web Worker en el Navegador (`GeoIpBackgroundWorker`)**: Hilo `Worker` dedicado en segundo plano en el cliente con caché de dos niveles (`Map` en RAM + `localStorage` bajo `recursos_geoip_cache_v1`) que enriquece instantáneamente las conexiones desde caché local, resuelve IPs pendientes contra `/api/net/geoip/resolve` (`ip-api.com`) y actualiza en caliente los marcadores y líneas geodésicas del mapa sin bloquear la UI.
  - **Indicador Interactivo de Estado de Caché (`#geoIpWorkerStatusBadge`)**: Insignia en la barra superior del mapa que muestra en tiempo real las IPs almacenadas en caché, el porcentaje de aciertos (`% hit`) y el estado de resolución activa, permitiendo forzar una sincronización al instante con un clic.

## ✨ Novedades y Correcciones en `v4.3.1`
- **Corrección de Helper DOM `setText(id, val)`**:
  - Definida la función auxiliar global `setText(id, val)` junto a `escapeHtml(str)` en `index.html` y `static/index.html` para actualizar de forma segura los contadores, KPIs y metadatos del motor `NetworkConnectionsMapEngine.renderFromMetrics()`, eliminando el error `ReferenceError: setText is not defined` en la vista `/red`.

## ✨ Novedades en `v4.3.0`
- **Monitor de Umbral de Caudal de Red por NIC y Alerta Visual en la Leyenda del Mapa (`BandwidthThresholdMonitor`)**:
  - **Límite Configurable en Tiempo Real**: Control interactivo en la cabecera del mapa (`⚡ Umbral NIC`) que permite definir el límite máximo de tráfico entrante (`RX`) o saliente (`TX`) por interfaz de red en `KB/s` o `MB/s`, con persistencia automática en `localStorage` (`recursos_nic_bw_threshold_cfg`).
  - **Alerta Visual en la Leyenda del Mapa (`#networkConnectionsMapLegend`)**: Cuando cualquier tarjeta de red (NIC) supera el umbral configurado en descarga (`↓ RX`) o subida (`↑ TX`), la leyenda superpuesta del mapa activa un contorno luminoso de alerta (`.legend-bandwidth-alert-active`), resalta el sentido del tráfico afectado (`↓ Conexión Entrante` y/o `↑ Conexión Saliente` con `.legend-dir-exceeded`) y muestra una insignia pulsante (`⚠️ ALERTA CAUDAL NIC: <interfaz> (↓/↑ <caudal>) > <límite>`).
  - **Resaltado Sincronizado en Tarjetas NIC**: Las tarjetas individuales de interfaces de red en `#activeNicsGrid` también muestran una insignia de advertencia y borde reactivo cuando su caudal instantáneo supera el umbral establecido.

## ✨ Novedades en `v4.2.0`
- **Mapa Geoespacial Interactivo de Conexiones Entrantes y Salientes (Google Maps Platform)**:
  - Integración nativa en la vista de Red (`/red`) de un mapa vectorial interactivo (`Maps JavaScript API`) con marcadores avanzados (`AdvancedMarkerElement`), arcos geodésicos direccionales (`Polyline` con `geodesic: true` y flechas de flujo) y ventanas de inspección (`InfoWindow`).
  - **Inspección de Sockets en Vivo (Cero Hardcoding)**: Lectura directa de conexiones activas del kernel (`/proc/net/tcp`, `/proc/net/udp`, `psutil.net_connections`) e integración con bloqueos activos de Fail2ban IPS.
  - **Clasificación y Filtrado en Tiempo Real**: Controles segmentados para filtrar entre `Todas`, `↓ Entrantes` (Verde Esmeralda `#10B981`), `↑ Salientes` (Cian `#06B6D4`) y `🛡️ Bloqueadas` (Rosa `#F43F5E`), además de botones rápidos `🌍 Encuadrar Todo` y `🖥️ Nodo Host`.
  - **Tabla Interactiva de Flujos Geolocalizados**: Listado sincronizado bajo el mapa donde al pulsar cualquier conexión el mapa se desplaza suavemente (`panTo`) hacia el nodo remoto y despliega su ficha técnica completa (IP/Puerto local y remoto, protocolo, estado del socket, servicio, ciudad, país e ISP/ASN).

## ✨ Novedades en `v4.1.0`
- **Gráficos Sparkline de Banda Ancha (Últimas 2 Horas) por Tarjeta de Red (NIC)**:
  - Integración de un gráfico sparkline de alta resolución (Canvas HiDPI Retina) debajo de cada tarjeta de NIC en la vista de Red (`/red`).
  - Representación de series duales simultáneas: **Caudal de Descarga (RX)** en verde esmeralda Apple (`#34D399`) con relleno de gradiente translúcido suave y **Caudal de Subida (TX)** en cian Tesla (`#38BDF8`).
  - Escalado dinámico de eje Y con umbral mínimo de 50 KB/s para evitar picos artificiales en reposo.
  - Insignia de caudal pico alcanzado durante las 2 horas (`Pico: ↓ ... MB/s · ↑ ... MB/s`) y contador de muestras históricas.
  - **Interacción y Touch-Scrubbing**: Al tocar o arrastrar el cursor sobre el sparkline, se proyecta una línea guía temporal con marcadores de coordenadas y un tooltip flotante que revela el caudal exacto y el desfase de tiempo (`-X min`).
- **Estructura de Almacenamiento Temporal Persistente**:
  - Motor cliente `NicBandwidthStorageManager` que almacena el historial de las últimas 2 horas en una estructura temporal indexada (`recursos_nic_bandwidth_history_2h` en `localStorage` con fallback a `sessionStorage` y memoria).
  - Poda automática de muestras con antigüedad superior a 120 minutos (7.200 segundos).
  - Persistencia de muestras en segundo plano sin importar en qué vista navegue el usuario.
  - Búfer temporal rodante en backend (`server.py`) que pre-alimenta hasta 2 horas de telemetría de red muestreada directamente de `/proc/net/dev`, permitiendo que clientes nuevos o recién cargados reciban el historial completo de inmediato.

## ✨ Novedades y Correcciones en `v4.0.4`
- **Lógica de Scroll Horizontal y Preservación de Forma en `.floating-dock`**:
  - Fijación geométrica inmutable con altura constante (`height: 60px; min-height: 60px; max-height: 60px;` en escritorio y `52px` en móviles) y radio de píldora continuo (`border-radius: 9999px`), evitando cualquier deformación vertical o asimetría al desbordar elementos.
  - Implementación de `scroll-snap-type: x proximity` y espaciadores invisibles en los extremos (`::before` y `::after`), garantizando que los iconos exteriores nunca queden recortados contra los arcos redondeados.
  - Máscara de desvanecimiento suave en bordes (`mask-image` degradado) en pantallas táctiles y móviles (`<= 768px`), indicando sutilmente la presencia de más elementos navegables.
  - Soporte de desplazamiento horizontal con rueda de ratón en escritorio al estrechar la ventana.

## ✨ Novedades y Correcciones en `v4.0.3`
- **Jerarquía Z-Index Calibrada (Dock a 99 y Sidebar a 100)**:
  - Aplicado `z-index: 99` a las clases `.floating-dock` y `.floating-touch-dock` (así como a su contenedor `.floating-dock-shell`), garantizando que se muestren siempre sobre overlays y modales.
  - Asignado `z-index: 100` a la barra lateral desplegable (`.sidebar`), manteniéndola como la capa superior absoluta del sistema.
  - Ajustado `z-index: 90` en `.modal-overlay` para asegurar que el dock permanezca visible y accesible.

## ✨ Novedades y Correcciones en `v4.0.2`
- **Ajuste de Scroll Horizontal y Flexbox en `.floating-dock`**:
  - Declaración de `min-width: 0` y `width: 100%` en `.floating-dock` para garantizar que el contenedor flex permita el desbordamiento horizontal (`overflow-x: auto`) sin superar el ancho de pantalla ni recortar elementos.
  - Asignación de `flex: 0 0 auto`, `flex-shrink: 0` y `white-space: nowrap` a cada `.dock-item`, impidiendo que los textos o iconos colapsen, se compriman o se solapen cuando el viewport se estrecha.
  - Reglas de escalado responsive (`@media (max-width: 680px)`) para optimizar el tamaño de los iconos (`46px`), padding y fuentes en pantallas móviles angostas.
- **Jerarquía Z-Index y Convivencia con la Barra Lateral (`.sidebar`)**:
  - Reestructuración de capas z-index: Sidebar Drawer (`z-index: 95`), Backdrop espacial atenuado (`z-index: 90`) y Dock flotante (`z-index: 70`).
  - Ocultación y repliegue automático del dock (`body.sidebar-open .floating-dock-shell { opacity: 0; transform: translateY(16px); }`) mientras el menú lateral de módulos está desplegado, evitando cualquier colisión o solapamiento táctil.
  - Estilización del fondo espacial desenfocado (`.sidebar-backdrop`) permitiendo cerrar la barra lateral tocando cualquier punto fuera de ella.

## ✨ Novedades y Correcciones en `v4.0.1`
- **Corrección Integral de la Barra Inferior (Floating Touch Dock)**:
  - Sincronización de selectores CSS (`.floating-dock-shell`, `.floating-dock`) asegurando posicionamiento flotante permanente (`position: fixed; bottom: calc(14px + env(safe-area-inset-bottom)); z-index: 85;`).
  - Integración de los puntos de paginación táctil (`.swipe-pagination-dots` / `.swipe-dot`) directamente dentro de la cápsula flotante, evitando interferencias con el flujo principal del DOM.
  - Corrección del auto-centrado de pestañas: reemplazo de `scrollIntoView()` por `dockContainer.scrollTo({ left, behavior: 'smooth' })`, eliminando saltos bruscos o indeseados en el scroll vertical de la ventana.
  - Soporte completo de área segura para dispositivos móviles y acabados translúcidos en modo Titanio Oscuro y Titanio Claro.

## ✨ Novedades Principales en `v4.0.0` (Apple Liquid Glass & Tesla Touch Cockpit)

1. **Arquitectura Visual Híbrida: Bento Cristal Apple + Cabina Táctil Tesla (`v4.0.0`)**:
   - **Cabina Panorámica 100% Ancho**: Eliminación de barras laterales fijas para aprovechar todo el lienzo con tarjetas Bento de cristal líquido (`backdrop-filter: blur(36px) saturate(190%)`), bordes especulares de `1px` y radios continuos (`24px`).
   - **Modo Claro / Oscuro Automático con Acabado Metálico y Titanio**:
     - **Titanio Oscuro (Space Black Titanium)**: Fondo `#07090E` con reflejos de cobalto y cian eléctrico.
     - **Titanio Claro (Natural Brushed Titanium)**: Fondo `#EEF2F7` de aluminio/titanio cepillado con cristal blanco translúcido y tipografía de alto contraste (`#0F172A`).
     - Conmutador instantáneo en el HUD superior (`🌗 Auto` / `☀️ Titanio Claro` / `🌙 Titanio Oscuro`) sincronizado automáticamente con el sistema operativo (`prefers-color-scheme`).
2. **Navegación Táctil de Última Generación (Dock Flotante + Gestos Swipe + View Transitions API)**:
   - **Dock Inferior Táctil Flotante (`#floatingTouchDock`)**: Barra suspendida de cristal líquido con física elástica (`cubic-bezier(0.22, 1, 0.36, 1)`), objetivos táctiles de `>= 48px` y desplazamiento horizontal táctil en móviles y tablets.
   - **Gestos de Deslizamiento Horizontal (`Touch Swipe`)**: Permite deslizar el dedo a izquierda o derecha sobre la cabina para cambiar de vista con indicadores dinámicos de paginación (`#swipePaginationDots`).
   - **HTML5 View Transitions API (`document.startViewTransition`)**: Transiciones espaciales nativas aceleradas por GPU al cambiar de módulo o alternar el acabado de titanio.
3. **Tarjetas Bento Expandibles (`<dialog>`) y Gráficas con Scrubbing Táctil**:
   - **Inspector Táctil Bento (`⤢ Inspector Táctil`)**: Cada pilar de telemetría (CPU, RAM, GPU, Discos, Red) puede expandirse en una hoja modal nativa HTML5 `<dialog>` sin abandonar la cabina general.
   - **Gráficas Interactivas al Tacto (60 Muestras / 2 Minutos)**: Deslizar el dedo o el cursor sobre cualquier osciloscopio despliega una mira vertical luminosa, resalta el punto de muestreo y muestra el valor exacto junto con el instante temporal (`hace Xs`).
4. **Auditoría y Optimización de Rendimiento en Tiempo Real**:
   - **HUD Central de Rendimiento y Diagnóstico (`#perfAuditDialog`)**: Monitoriza en vivo la cadencia de cuadros (`RAF 60fps`), la latencia de red de `/api/metrics` en milisegundos (`ms`), el tiempo de pintado DOM+Canvas y el estado de memoria.
   - **Motor Desacoplado (`requestAnimationFrame` + `AbortController` + `Page Visibility`)**: Sincroniza el pintado de gráficas con el refresco de pantalla, evita solapamiento de peticiones en redes lentas y reduce el consumo en pestañas ocultas.
   - **Caché No Bloqueante en Backend**: Cacheo en memoria de topología estática de CPU/SO y caché con TTL para discos (`5s`) y estado Git (`30s`).
5. **Motor Inteligente de Logos del Sistema Operativo, Interfaces de Red y Dispositivos**:
   - **Logo Real del Sistema Operativo en `Nodo: <hostname>`**: Muestra automáticamente el logotipo oficial de la distribución Linux o sistema operativo activo (`/etc/os-release`, `uname`).
   - **Logos Automáticos para Interfaces de Red (NICs) y Dispositivos LAN/Wi-Fi**: Identificación visual por dirección MAC/OUI, hostname y tipo de enlace, con opción de **búsqueda web en Google/Catálogo** o **subida de archivo de imagen local** persistente en `custom_logos.json`.
6. **Política Estricta de Cero Hardcoding (100% Detección Dinámica del Sistema Operativo)**:
   - Todos los datos de CPU (`/proc/cpuinfo`, `cpufreq`, `hwmon`), Memoria RAM (`/proc/meminfo`, `/proc/swaps`), GPU (`nvidia-smi`, `/sys/class/drm`, `lspci`), Almacenamiento (`df`, `/proc/diskstats`) y Red (`/proc/net/dev`) se leen en vivo desde el sistema operativo.

---

## 🗺️ Mapa de Rutas Web y Endpoints API

### Rutas de Usuario (Frontend Multipágina + Dock Táctil)
| Ruta | Vista | Descripción |
| :--- | :--- | :--- |
| `/` | **Cabina General** | Bento de cristal líquido con emblema dinámico del SO, 4 pilares radiales expandibles y 6 módulos operativos |
| `/procesador` | **Procesador (CPU)** | Osciloscopio táctil de 60 muestras, especificaciones del kernel y matriz de hilos lógicos |
| `/memoria` | **Memoria RAM** | Osciloscopio interactivo de memoria, barra de composición física y estado de Swap/Zram |
| `/grafica` | **Tarjeta Gráfica** | Carga de GPU, uso de VRAM, temperatura, potencia y procesos gráficos activos |
| `/almacenamiento` | **Almacenamiento** | Velocidad de E/S en vivo y tarjetas detalladas por volumen montado |
| `/red` | **Red & Interfaces** | Caudal RX/TX, inspector de tarjetas de red (NICs) y clientes LAN/Wi-Fi con logos automáticos y subida local |
| `/seguridad` | **Seguridad & DNS** | Bloqueo DNS Pi-hole, dominios permitidos/bloqueados y jaulas Fail2ban |
| `/aplicaciones` | **Contenedores & Servicios** | Estado y control (iniciar/reiniciar) de contenedores Docker y unidades `systemd` |
| `/descargas` | **Descargas & Videoteca** | Torrents activos en qBittorrent y catálogo multimedia Emby Server |
| `/procesos` | **Monitor de Procesos** | Tabla en vivo de procesos del sistema ordenables por uso de CPU y RAM |
| `/dns` | **DNS & DuckDNS** | Estado del dominio detectado, actualización forzada DuckDNS y analizador DNS por cliente |
| `/version` | **Versión & GitHub OTA** | Comparativa de versión local vs GitHub, historial de commits y actualización OTA en 1 clic |

---

## 📁 Estructura del Proyecto

```text
/
├── VERSION                  # Punto único de verdad para la versión del sistema (4.0.0)
├── server.py                # Servidor backend Python (puerto 8085) con colectores reales del SO y motor de logos
├── index.html               # Interfaz principal Apple Liquid Glass & Tesla Touch Cockpit v4.0.0
├── static/
│   └── index.html           # Copia sincronizada servida directamente por server.py
├── custom_logos.json        # Almacenamiento persistente de logotipos personalizados (creado bajo demanda)
├── vite.config.ts           # Configuración Vite + middleware de telemetría real optimizado con caché no bloqueante
├── planes/                  # Planes de implementación, bitácoras y walkthroughs de verificación
├── GEMINI.md                # Reglas obligatorias de sincronización, versionado y despliegue
└── README.md                # Documentación oficial del proyecto
```
