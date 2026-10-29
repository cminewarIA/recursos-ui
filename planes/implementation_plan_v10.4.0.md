# Plan de Implementación: Telemetría de Velocidad y Tráfico por Conexión Geolocalizada (v10.4.0)

Este documento detalla la arquitectura técnica e implementación para responder a la solicitud del usuario:
*"en el apartado este Detalle de Flujos y Sockets Geolocalizados (Pulsa una cápsula para enfocar en el mapa) podriamos mostrar la velocidad de carga y descarga y total con cada coneccion ?"*

## User Review Required

> [!IMPORTANT]
> **Criterio de Incremento de Versión (Regla 3):**
> Al tratarse de una nueva funcionalidad intermedia con métricas en tiempo real y rediseño simétrico del componente de cápsulas geolocalizadas, la versión canónica se incrementa a `10.4.0` (MINOR), restableciendo PATCH a 0.

## Propuesta de Diseño y Arquitectura

### 1. Extracción de Métricas de Tráfico en Tiempo Real (`server.py`)
- Mediante inspección periódica de sockets activos en el kernel (`ss -tin`), capturar:
  - `bytes_sent` (Carga / Subida / TX)
  - `bytes_received` (Descarga / Bajada / RX)
- Almacenar historial en memoria con deltas de tiempo ($\Delta t$) para derivar con precisión matemática la velocidad instantánea:
  - `rx_speed`: Caudal de descarga en bytes/segundo ($\Delta \text{bytes\_received} / \Delta t$)
  - `tx_speed`: Caudal de carga en bytes/segundo ($\Delta \text{bytes\_sent} / \Delta t$)
  - `bytes_total`: Volumen total acumulado transferido por la conexión (`bytes_sent + bytes_received`)
  - `total_speed`: Velocidad total combinada (`rx_speed + tx_speed`)
- Enriquecer cada objeto de conexión en `CONNECTIONS_MAP_CACHE` con estas propiedades.

### 2. Presentación Visual Simétrica en la Cuadrícula de Cápsulas (`index.html` y `static/index.html`)
- Añadir la tira `.conn-capsule-traffic` dentro de cada `.conn-capsule`:
  - `↓ Descarga`: Verde esmeralda (`#10B981` / `#34D399`) con formato monoespaciado tabular (`0 B/s`, `X.X KB/s`, `X.X MB/s`).
  - `↑ Carga`: Azul zafiro / cielo (`#38BDF8` / `#60A5FA`).
  - `∑ Total`: Púrpura / ámbar (`#C084FC` / `#F59E0B`) con volumen acumulado (`formatBytes`).
- Enriquecer igualmente el popup interactivo de Leaflet al pinchar sobre un nodo en el mapa con las mismas métricas de caudal y volumen.
- Aplicar diseño *Apple Liquid Glass* con simetría rigurosa (Regla 8) en temas oscuro y claro.

### 3. Sincronización de Versión y Empaquetado
- Actualizar `./VERSION` a `10.4.0`.
- Sincronizar `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts` y `README.md`.
- Compilar paquete Debian `packaging/build_deb.sh`, instalar con `sudo apt-get install` y validar con `/usr/bin/recursos-cockpit --test-mode`.
- Registrar walkthrough en `./planes/` y publicar en GitHub con `git push origin main --tags`.

## Verification Plan

### Automated Tests
- Compilación del paquete Debian: `bash packaging/build_deb.sh`.
- Verificación del ejecutable nativo: `/usr/bin/recursos-cockpit --test-mode`.
- Verificación de versión instalada: `dpkg -l | grep recursos-cockpit`.
- Verificación de payload JSON de `/api/metrics` para asegurar que las conexiones incluyen `rx_speed`, `tx_speed`, `bytes_total`.
- Verificación de paridad de archivos frontend: `diff -u index.html static/index.html`.

### Manual Verification
- Visualización de las cápsulas en la vista de red del dashboard en el navegador y en la app nativa.
- Comprobación de que las tasas de subida, bajada y volumen total se actualizan en vivo de forma fluida y simétrica.
