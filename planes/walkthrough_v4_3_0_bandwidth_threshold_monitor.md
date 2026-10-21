# Walkthrough v4.3.0 — Monitor de Umbral de Caudal de Red por NIC y Alerta Visual en la Leyenda del Mapa

## 1. Resumen de la Implementación
Se ha diseñado e integrado el motor **`BandwidthThresholdMonitor`** en la vista de Red (`/red`), proporcionando supervisión continua en tiempo real del caudal entrante (`RX`) y saliente (`TX`) de cada tarjeta de red (NIC) del sistema frente a un límite configurable por el usuario, proyectando una alerta visual directa en la leyenda superpuesta del mapa geoespacial.

## 2. Componentes Implementados

### 2.1. Control Configurable de Umbral (`#nicBwThresholdInput` y `#nicBwThresholdUnit`)
- Ubicado en la barra de herramientas superior del **Mapa Geoespacial de Conexiones Entrantes y Salientes**.
- Permite ajustar en caliente el valor numérico del umbral y seleccionar la unidad (`KB/s` o `MB/s`, por defecto `5 MB/s`).
- Persistencia automática en `localStorage` (con respaldo en `sessionStorage`) bajo la clave `recursos_nic_bw_threshold_cfg`.
- Reevaluación inmediata al modificar el valor (`oninput` / `onchange` -> `updateNicBandwidthThresholdFromUI()`).

### 2.2. Alerta Visual en la Leyenda del Mapa (`#networkConnectionsMapLegend`)
- **Insignia de Estado / Alerta (`#mapLegendBandwidthAlert`)**:
  - **Estado Normal (`.normal`)**: Muestra `⚡ Umbral NIC: Normal (< X MB/s)` en tono esmeralda translúcido.
  - **Estado de Superación de Umbral (`.exceeded`)**: Se transforma en una insignia de alerta pulsante (`⚠️ ALERTA CAUDAL NIC: <nic> (↓ ... · ↑ ...) > <límite>`) con degradado rojo/ámbar de alta visibilidad.
  - Al hacer clic sobre la insignia en la leyenda, el foco se dirige automáticamente al campo `#nicBwThresholdInput` para facilitar el ajuste rápido del límite.
- **Resaltado Direccional en la Leyenda**:
  - Si cualquier NIC supera el umbral de tráfico entrante (`rx_bytes_sec > limit`), el elemento `#mapLegendItemIncoming` (`↓ Conexión Entrante`) recibe la clase `.legend-dir-exceeded`.
  - Si cualquier NIC supera el umbral de tráfico saliente (`tx_bytes_sec > limit`), el elemento `#mapLegendItemOutgoing` (`↑ Conexión Saliente`) recibe la clase `.legend-dir-exceeded`.
- **Contorno de Alerta en la Leyenda**: El contenedor `#networkConnectionsMapLegend` activa la clase `.legend-bandwidth-alert-active` con resplandor carmesí cuando existe al menos una interfaz excediendo el límite.

### 2.3. Sincronización con las Tarjetas de Interfaces de Red (`#activeNicsGrid`)
- Cada tarjeta de interfaz de red evalúa su caudal mediante `BandwidthThresholdMonitor.checkNic(nic)` y, en caso de superar el umbral, resalta su borde y muestra una etiqueta `⚠️ Supera umbral (↓ ... · ↑ ...)`.

## 3. Verificación y Sincronización
- Sincronizado `index.html` con `static/index.html`.
- Versión actualizada a `4.3.0` en `VERSION`, `package.json` y `README.md`.
- Build verificado con `compile_applet`.
