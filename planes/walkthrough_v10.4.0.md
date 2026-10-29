# Walkthrough: Telemetría de Velocidad y Tráfico Acumulado por Conexión Geolocalizada (v10.4.0)

Se ha implementado con éxito la medición en tiempo real de velocidad de carga (`TX`), velocidad de descarga (`RX`) y volumen total acumulado para cada socket y flujo geolocalizado del sistema, resolviendo con precisión matemática y simetría la solicitud del usuario:
*"en el apartado este Detalle de Flujos y Sockets Geolocalizados (Pulsa una cápsula para enfocar en el mapa) podriamos mostrar la velocidad de carga y descarga y total con cada coneccion ?"*

## Cambios Realizados

### 1. Backend (`server.py`)
- **Muestreo en Tiempo Real de Sockets del Kernel (`ss -tin`)**:
  - Implementación de `poll_socket_traffic_metrics()`, `_normalize_ss_addr()` y `get_socket_traffic()`.
  - Extracción de bytes transmitidos (`bytes_sent`) y bytes recibidos (`bytes_received`).
  - Cálculo de velocidad instantánea basado en deltas de tiempo ($\Delta t$):
    - `tx_speed`: Tasa de carga/subida en bytes/segundo ($\Delta \text{bytes\_sent} / \Delta t$).
    - `rx_speed`: Tasa de descarga/bajada en bytes/segundo ($\Delta \text{bytes\_received} / \Delta t$).
    - `bytes_total`: Tráfico acumulado transferido por la conexión (`bytes_sent + bytes_received`).
    - `total_speed`: Velocidad total combinada.
  - Normalización determinista de direcciones para soportar IPv4, IPv6, NAT y mapeo inverso de sockets.
  - Reducción del ciclo del worker geoespacial a `2.5s` para que los caudales de tráfico se refresquen en vivo con mínima latencia y nulo impacto en CPU.
- **Inyección en `CONNECTIONS_MAP_CACHE`**:
  - Cada objeto en la colección de conexiones expone `tx_speed`, `rx_speed`, `bytes_total`, `bytes_sent` y `bytes_received`, servidos tanto en `/api/metrics` como en `/api/net/geoip`.

### 2. Frontend (`index.html` y `static/index.html`)
- **Diseño Simétrico de Cápsulas (*Apple Liquid Glass* - Regla 8)**:
  - Nueva tira `.conn-capsule-traffic` dentro de `.conn-capsule` en `#networkConnectionsTableList`:
    - `↓ Descarga`: Verde esmeralda (`#34D399` / `#10B981`) con formato monoespaciado tabular (`0 B/s`, `X.X KB/s`, `X.X MB/s`).
    - `↑ Carga`: Azul cielo (`#38BDF8` / `#60A5FA`).
    - `∑ Total`: Ámbar/dorado (`#FBBF24`) con formateo dinámico de unidades (`formatBytes`).
  - Función auxiliar `formatConnSpeed(bytesPerSec)` para una representación concisa y legible.
  - Inclusión de las métricas de tráfico en `tableSig` para que las tarjetas actualicen sus velocidades dinámicamente sin perder foco ni scroll.
- **Telemetría Integrada en Popups de Leaflet**:
  - Inclusión de las métricas de caudal de bajada, caudal de subida y volumen total dentro de la ventana de información interactiva al pulsar cualquier conexión o clúster en el mapa.

### 3. Control de Versiones Canónico (Regla 3)
- Incremento a `10.4.0` (MINOR) en:
  - `./VERSION`
  - `package.json`
  - `packaging/debian/control`
  - `android_app/app/build.gradle.kts` (`versionCode = 100400`, `versionName = "10.4.0"`)
  - `README.md` (badges de cabecera, banner ASCII y tabla de versiones)

### 4. Compilación e Instalación Verificada (Regla 6)
- Compilación del paquete Debian con `bash packaging/build_deb.sh`:
  - `dist/recursos-cockpit_10.4.0_amd64.deb` generado con sumas SHA256.
- Instalación local completada y validada:
  - `dpkg -l | grep recursos-cockpit` -> `10.4.0`
  - `/usr/bin/recursos-cockpit --test-mode` -> `[OK] Recursos Native Ubuntu HTML5 App v10.4.0 validated successfully.`

## Verificación de Resultados

| Prueba | Comando / Endpoint | Resultado | Estado |
| :--- | :--- | :--- | :---: |
| Sintaxis Backend | `python3 -m py_compile server.py` | Compilación limpia sin errores | ✅ PASADO |
| Sincronización HTML | `diff -u index.html static/index.html` | 0 diferencias (100% idénticos) | ✅ PASADO |
| Versión en API | `curl -s http://127.0.0.1:8085/api/version` | `{"version": "10.4.0", ...}` | ✅ PASADO |
| Métricas en Vivo | `curl -s http://127.0.0.1:8085/api/metrics` | `rx_speed`, `tx_speed`, `bytes_total` presentes en sockets activos | ✅ PASADO |
| Test Mode Nativo | `/usr/bin/recursos-cockpit --test-mode` | Retorno 0, entorno nativo validado | ✅ PASADO |
