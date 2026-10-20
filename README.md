# ⚡ Recursos — Centro de Mando y Telemetría de Sistemas (`v3.0.0`)

Panel de control de alto rendimiento, telemetría de hardware en tiempo real, auditoría de red y gestión de contenedores con arquitectura **Zero-Hardcoding (100% Detección Dinámica de Hardware)**, seguridad **Zero-Trust** y actualizaciones **OTA en 1 clic desde GitHub**.

---

## ✨ Novedades Principales en `v3.0.0` (Aether Obsidian Telemetry OS)

1. **Rediseño Integral de Interfaz Gráfica (Aether Obsidian UI)**:
   - Estética de centro de mando de sistemas con modo oscuro de alto contraste (`#060911` / `#0C1220`), bordes especulares de 1px, tipografía técnica (`Space Grotesk` + `JetBrains Mono` con `tabular-nums`) y jerarquía visual de alta densidad.
   - **Medidores Radiales SVG y Osciloscopios en Tiempo Real**: Gráficas vectoriales en Canvas de alta precisión con marcadores de pulso activo en vivo para CPU, Memoria RAM, GPU y Caudal de Red.
2. **Política Estricta de Cero Hardcoding (100% Detección Dinámica del Sistema Operativo)**:
   - **Prohibición absoluta de especificaciones estáticas o simuladas**: Ningún campo del HTML o JavaScript contiene nombres de procesadores, tarjetas gráficas ni cifras predefinidas.
   - **Estados de carga limpios (`.hw-detecting`)**: Mientras se realiza el sondeo inicial al kernel, la interfaz muestra indicadores elegantes de detección (`Detectando hardware...`, `Sondeando sensores...`).
   - **Procesador (`/procesador`)**: Modelo exacto, fabricante, arquitectura (`x86_64`/`aarch64`), caché L3, núcleos físicos/hilos lógicos, frecuencia actual/máxima en MHz, temperatura del encapsulado y matriz de carga individual por hilo lógico leídos desde `/proc/cpuinfo`, `lscpu`, `cpufreq` y `hwmon`.
   - **Memoria RAM (`/memoria`)**: Cantidad total instalada, memoria activa en uso, memoria disponible real, caché/buffers del kernel y barra de composición física en vivo leídos directamente desde `/proc/meminfo` y `/proc/swaps`.
   - **Tarjeta Gráfica (`/grafica`)**: Detección automática mediante `nvidia-smi`, sensores del kernel Linux (`/sys/class/drm`) y bus PCIe (`lspci`), reportando modelo real, VRAM usada/total, porcentaje de carga, temperatura, ventilador y consumo en vatios.
   - **Red e Interfaces (`/red`)**: Inspector de interfaces de red activas del sistema (nombre del adaptador, IPv4 local, dirección MAC, velocidad de enlace en Mbps, MTU y tráfico RX/TX acumulado), velocidad de subida/bajada en tiempo real y tabla de dispositivos conectados en LAN/Wi-Fi.
3. **Navegación Multipágina con Rutas Limpias (`History API`)**:
   - Cada módulo opera como una página web independiente con su propia ruta limpia (`/`, `/procesador`, `/memoria`, `/grafica`, `/almacenamiento`, `/red`, `/seguridad`, `/aplicaciones`, `/descargas`, `/procesos`, `/dns`, `/version`).
   - Soporte nativo completo para las flechas **Atrás** y **Adelante** del navegador y botones de historial integrados en la cabecera.
4. **Autodetección Dinámica de Dominio DNS (`/dns`)**:
   - Detección automática del dominio público o local inspeccionando scripts de DuckDNS (`duck.sh`), configuración de Caddy (`Caddyfile`), Nginx, cabeceras HTTP `Host` / `X-Forwarded-Host` y hostname del sistema.
5. **Control de Versión Unificado y Actualización OTA desde GitHub (`/version`)**:
   - Punto único de verdad en el archivo `/VERSION` (`3.0.0`).
   - Comparación en vivo entre el commit local y la rama `main` de `cminewarIA/recursos-ui` con actualización en 1 clic (`POST /api/system/update`) y reinicio automático del servicio.
6. **Seguridad Zero-Trust por Dispositivo**:
   - Autenticación persistente por dispositivo (`X-Device-Token` + Cookie `HttpOnly`), panel de auditoría de sesiones activas con revocación instantánea e integración en tiempo real con **Pi-hole v6** y **Fail2ban**.

---

## 🗺️ Mapa de Rutas Web y Endpoints API

### Rutas de Usuario (Frontend Multipágina)
| Ruta | Vista | Descripción |
| :--- | :--- | :--- |
| `/` | **Vista General** | Resumen ejecutivo con 4 pilares radiales (CPU, RAM, GPU, Disco) y 6 módulos operativos |
| `/procesador` | **Procesador (CPU)** | Osciloscopio de carga, especificaciones del kernel y matriz de hilos lógicos |
| `/memoria` | **Memoria RAM** | Osciloscopio de memoria, barra de composición física y estado de Swap/Zram |
| `/grafica` | **Tarjeta Gráfica** | Carga de GPU, uso de VRAM, temperatura, potencia y driver activo |
| `/almacenamiento` | **Almacenamiento** | Velocidad de E/S en vivo y tarjetas detalladas por volumen montado y NVMe/SMART |
| `/red` | **Red & Interfaces** | Caudal RX/TX, inspector de tarjetas de red (NICs) activas y clientes LAN/Wi-Fi |
| `/seguridad` | **Seguridad & DNS** | Bloqueo DNS Pi-hole, dominios permitidos/bloqueados y jaulas Fail2ban |
| `/aplicaciones` | **Contenedores & Servicios** | Estado y control (iniciar/reiniciar) de contenedores Docker y unidades `systemd` |
| `/descargas` | **Descargas & Videoteca** | Torrents activos en qBittorrent y catálogo multimedia Emby Server |
| `/procesos` | **Monitor de Procesos** | Tabla en vivo de procesos del sistema ordenables por uso de CPU y RAM |
| `/dns` | **DNS & DuckDNS** | Estado del dominio detectado, actualización forzada DuckDNS y analizador DNS por cliente |
| `/version` | **Versión & GitHub OTA** | Comparativa de versión local vs GitHub, historial de commits y actualización OTA en 1 clic |

### Endpoints del Backend (`server.py`)
- `GET /api/metrics`: Telemetría completa en tiempo real (CPU, RAM, GPU, discos, interfaces de red, clientes Wi-Fi/LAN, Docker, systemd, Pi-hole, Fail2ban, qBittorrent, Emby, dominio detectado y estado de versión).
- `GET /api/version`: Comparación en vivo entre la versión local (`VERSION` + commit git) y el repositorio remoto en GitHub (`?force=1` para consulta inmediata).
- `POST /api/system/update`: Ejecuta `git pull origin main`, sincroniza archivos y reinicia el servicio automáticamente.
- `GET /api/dns/duckdns` y `POST /api/dns/duckdns/update`: Estado de sincronización de IP pública con DuckDNS y forzado de actualización.
- `GET /api/dns/<ip>`: Historial de consultas DNS realizadas por un cliente específico en Pi-hole FTL.
- `GET /api/auth/devices`, `POST /api/auth/login`, `POST /api/auth/revoke`: Gestión de seguridad Zero-Trust y sesiones autorizadas.
- `POST /api/service/action`: Inicio o reinicio de contenedores Docker y servicios `systemd`.
- `POST /api/wol/wake`: Envío de paquetes mágicos Wake-on-LAN (WoL).

---

## 📁 Estructura del Proyecto

```text
/
├── VERSION                  # Punto único de verdad para la versión del sistema (3.0.0)
├── server.py                # Servidor backend Python (puerto 8085) con colectores reales del SO
├── index.html               # Interfaz principal Aether Obsidian Telemetry OS v3.0.0
├── static/
│   └── index.html           # Copia sincronizada servida directamente por server.py
├── vite.config.ts           # Configuración Vite + middleware de telemetría real para entorno preview
├── planes/                  # Planes de implementación, bitácoras y walkthroughs de verificación
├── GEMINI.md                # Reglas obligatorias de sincronización, versionado y despliegue
└── README.md                # Documentación oficial del proyecto
```
