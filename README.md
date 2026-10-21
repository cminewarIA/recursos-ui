# ⚡ Recursos — Centro de Mando y Telemetría de Sistemas (`v4.3.0`)

Panel de control de alto rendimiento con interfaz híbrida **Apple Liquid Glass & Tesla Touch Cockpit (`v4.3.0`)**, telemetría de hardware en tiempo real, auditoría de red con **Mapa Geoespacial Interactivo de Conexiones Entrantes y Salientes (Google Maps Platform)**, **Monitor de Umbral de Caudal por NIC con Alerta Visual en Leyenda** y gestión de contenedores con arquitectura **Zero-Hardcoding (100% Detección Dinámica de Hardware)**, **Acabado Metálico en Titanio Claro/Oscuro/Auto**, **Dock Táctil Flotante + Gestos Swipe**, **Tarjetas Bento Expandibles (`<dialog>`) con Gráficas Interactivas al Tacto**, **Motor Inteligente de Logos de SO y Dispositivos**, seguridad **Zero-Trust** y actualizaciones **OTA en 1 clic desde GitHub**.

---

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
