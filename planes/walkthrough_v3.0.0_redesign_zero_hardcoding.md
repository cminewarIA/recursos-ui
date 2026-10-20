# Walkthrough & Plan de Implementación — v3.0.0 (Aether Obsidian Telemetry OS & Zero-Hardcoding Hardware Engine)

## 1. Resumen Ejecutivo
Se ha descartado por completo la interfaz gráfica anterior y se ha diseñado desde cero el **Centro de Mando y Telemetría de Sistemas v3.0.0 (Aether Obsidian Telemetry OS)**, cumpliendo estrictamente la política de **Cero Hardcoding (100% Detección Dinámica de Hardware)** tanto en la interfaz HTML/JS como en los colectores del sistema operativo (`server.py` y middleware de telemetría en `vite.config.ts`).

## 2. Regla Estricta de Datos (Cero Hardcoding)
- **Eliminación total de valores predefinidos**: Se han eliminado del HTML, JS y backend cualquier cadena estática o modelo predefinido (como modelos fijos de CPU, GPU o cantidades de RAM/VRAM simuladas).
- **Estados de carga limpios (`.hw-detecting`)**: Mientras la interfaz realiza el sondeo inicial a `/api/metrics`, todos los campos de especificaciones muestran indicadores de carga animados (`Detectando hardware...`, `Sondeando sensores...`, `Analizando volúmenes montados...`) con efecto *shimmer* sutil.
- **Extracción 100% en tiempo real desde el Sistema Operativo**:
  - **Procesador (`/procesador`)**: Lectura directa desde `/proc/cpuinfo`, `lscpu`, `/sys/devices/system/cpu/cpu0/cpufreq` y sensores térmicos `/sys/class/thermal` / `hwmon`. Muestra modelo exacto, fabricante (`vendor_id`), arquitectura (`os.uname().machine`), tamaño de caché L3, núcleos físicos, hilos lógicos, frecuencia actual/máxima en MHz, temperatura y matriz individual de carga por cada hilo lógico.
  - **Memoria RAM (`/memoria`)**: Lectura directa desde `/proc/meminfo` y `/proc/swaps`. Calcula y desglosa en tiempo real el total físico instalado, memoria activa usada por procesos, caché/buffers del kernel, memoria disponible real y estado de particiones Swap/Zram.
  - **Tarjeta Gráfica (`/grafica`)**: Sondeo real mediante `nvidia-smi`, sensores DRM del kernel (`/sys/class/drm/card*/device/gpu_busy_percent`, `mem_info_vram_*`) y bus PCIe (`lspci`). Si el servidor no dispone de GPU dedicada o sensores concretos, reporta limpiamente su estado real sin inventar modelos ni cifras.
  - **Red e Interfaces (`/red`)**: Sondeo directo de interfaces activas (`psutil.net_if_addrs()`, `psutil.net_if_stats()`, `/proc/net/dev`), exponiendo el listado hardware de cada NIC activa (nombre de interfaz, dirección IPv4, MAC física, velocidad de enlace en Mbps, MTU y tráfico acumulado RX/TX), además del caudal en vivo de subida/bajada y clientes ARP/Wi-Fi.
  - **Almacenamiento (`/almacenamiento`)**: Inspección dinámica de todos los volúmenes montados reales, sistema de archivos, dispositivo físico (`/dev/...`), lecturas/escrituras por segundo y sensores térmicos NVMe/SMART.

## 3. Arquitectura Visual y Navegación Multipágina
- **Diseño Aether Obsidian Dark UI**: Superficies de obsidiana profunda (`#060911` a `#0C1220`), bordes especulares de 1px, tipografía técnica (`Space Grotesk`, `Inter` y `JetBrains Mono` con `tabular-nums`), medidores radiales SVG en los 4 pilares principales y osciloscopios Canvas de 60 FPS con gradiente vectorial y marcador de pulso en vivo.
- **Navegación Multipágina Nativa (`History API`)**:
  - Rutas limpias: `/`, `/procesador`, `/memoria`, `/grafica`, `/almacenamiento`, `/red`, `/seguridad`, `/aplicaciones`, `/descargas`, `/procesos`, `/dns`, `/version`.
  - Soporte completo para botones **Atrás / Adelante** del navegador y controles dedicados en la barra superior (`navStack` + `popstate`).
  - Corrección del enrutador en `server.py` y `vite.config.ts` para que las rutas `/dns` y `/version` carguen directamente su vista correspondiente sin redirigir a Vista General.
- **Seguridad Zero-Trust Intacta**: Mantiene y verifica el bloqueo por token de dispositivo (`X-Device-Token` y cookies HttpOnly), panel de auditoría y revocación de sesiones en 1 clic, e integración con Pi-hole v6 y Fail2ban.
