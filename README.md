# ⚡ Recursos — Centro de Mando y Telemetría de Sistemas (`v4.0.1`)

Panel de control de alto rendimiento con interfaz híbrida **Apple Liquid Glass & Tesla Touch Cockpit (`v4.0.1`)**, telemetría de hardware en tiempo real, auditoría de red y gestión de contenedores con arquitectura **Zero-Hardcoding (100% Detección Dinámica de Hardware)**, **Acabado Metálico en Titanio Claro/Oscuro/Auto**, **Dock Táctil Flotante + Gestos Swipe**, **Tarjetas Bento Expandibles (`<dialog>`) con Gráficas Interactivas al Tacto**, **Motor Inteligente de Logos de SO y Dispositivos**, seguridad **Zero-Trust** y actualizaciones **OTA en 1 clic desde GitHub**.

---

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
