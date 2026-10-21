# Recorrido de Verificación: Agrupamiento Dinámico por Zoom y Exclusión de Conexiones Locales (`v4.11.1`)

## 1. Resumen de Cambios Realizados
- **Agrupamiento Dinámico según el Nivel de Zoom (`clusterConnections`)**:
  - Implementado algoritmo de clustering dinámico en base a distancia euclídea en píxeles de pantalla (`latLngToLayerPoint`, umbral 48px).
  - Al alejar el zoom, los nodos se agrupan en una insignia `🔀 N` evitando saturar la vista.
  - Al acercar el zoom, los nodos se disocian de inmediato en pines individuales conforme se separan en pantalla.
  - Evento `zoomend` de Leaflet conectado para recalcular clusters al vuelo sin recargar la página.
- **Cero Texto Hardcodeado / Fijo**:
  - Eliminado cualquier nombre de ciudad o proveedor estático en el código fuente.
  - El etiquetado se resuelve dinámicamente mediante `getDynamicClusterLabel` usando `remote_ip`, `city`, `country` e `isp`.
- **Exclusión de Conexiones Locales (LAN)**:
  - Se eliminaron las órbitas alrededor de Gran Canaria y la representación de IPs privadas locales en el mapa geográfico.
  - Únicamente el nodo anfitrión del servidor se sitúa en Gran Canaria (`27.9600° N, -15.5800° W`).
- **Captura de Flujos de Dispositivos del Hogar hacia IPs Públicas vía Kernel Conntrack**:
  - `server.py` ejecuta `sudo -n conntrack -L` en segundo plano cada ciclo.
  - Detecta todos los flujos salientes desde dispositivos del hogar (`192.168.50.x`) hacia IPs públicas externas (y viceversa).
  - Cada conexión indica en sus detalles qué dispositivo local originó el tráfico (ej. `Dispositivo 192.168.50.16`).
  - Todas las IPs públicas descubiertas entran en el worker GeoIP de `ip-api.com`.
- **Retención Absoluta del Popup Seleccionado**:
  - Se implementó un estado de popup persistente con `activeConnId` y `activeRemoteIp` que restaura la ventana informativa tras refrescos de métricas (cada 2s) y tras eventos de zoom.
- **Incremento de Versión Semántica**:
  - `VERSION` -> `4.11.1`
  - `package.json` -> `4.11.1`
  - `README.md` actualizado con la sección de novedades.

---

## 2. Pruebas y Validación Realizadas
1. **Compilación de Sintaxis Python**:
   - `python3 -m py_compile server.py` -> Exitoso sin errores (código 0).
2. **Inspección de Flujos de Conntrack**:
   - Más de 110 flujos públicos detectados con origen en IPs del hogar hacia la WAN.
3. **Sincronización de Archivos**:
   - `static/index.html` sincronizado con `index.html`.
