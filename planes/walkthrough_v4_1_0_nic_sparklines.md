# Walkthrough de Verificación — Gráficos Sparkline de Banda Ancha (Últimas 2 Horas) por NIC (`v4.1.0`)

## Solicitud del Usuario
*Añadir un nuevo gráfico de sparkline debajo de cada tarjeta de NIC en la vista de Red que muestre el historial de uso de banda ancha de las últimas 2 horas, persistiendo los datos en una estructura de almacenamiento temporal.*

---

## 1. Arquitectura y Componentes Implementados

### A. Estructura de Almacenamiento Temporal (`NicBandwidthStorageManager`)
- **Almacenamiento Persistente Temporal**:
  - Llave canónica: `recursos_nic_bandwidth_history_2h` almacenada en `localStorage` con fallback resiliente a `sessionStorage` y memoria volátil.
  - Formato JSON estructurado:
    ```json
    {
      "version": 1,
      "saved_at": 1729468000000,
      "nics": {
        "eth0": [
          { "t": 1729460800000, "rx": 245100.0, "tx": 31200.0 },
          { "t": 1729460815000, "rx": 298400.0, "tx": 45100.0 }
        ]
      }
    }
    ```
- **Ventana de Tiempo y Depuración Automática**:
  - Ventana máxima de 2 horas exactas (`2 * 60 * 60 * 1000` = `7.200.000 ms`).
  - Muestreo periódico de resolución (~15s) evitando inflación innecesaria de almacenamiento.
  - Poda automática de muestras con antigüedad mayor a 2 horas en cada ciclo de inserción.
  - Volcado asíncrono debounced (4s) y en eventos `pagehide` / `beforeunload`.

### B. Pre-alimentación Rodante en Servidor (`server.py`)
- Creación de búfer rodante en memoria `NIC_BANDWIDTH_HISTORY_2H` con lock concurrente `NIC_BANDWIDTH_LOCK`.
- Muestreo directo del subsistema del kernel Linux (`/proc/net/dev` vía `get_real_net()`).
- Muestras emitidas en el payload `/api/metrics` en `net.interfaces_history_2h` y en cada objeto `nic.history_2h`.
- Los clientes que se conectan por primera vez o limpian su caché reciben de inmediato hasta 2 horas de telemetría sin tener que esperar.

### C. Visualización Sparkline de Alta Fidelidad (Apple & Tesla Aesthetic)
- **Contenedor `.nic-sparkline-box`** integrado debajo del grid de parámetros de cada `.nic-card` en la vista de Red (`/red`).
- **Lienzo HTML5 Canvas con escalado Retina (DPR)**: Renderizado nítido a 60 FPS sin pixelación en pantallas de alta densidad.
- **Series Duales Contemporáneas**:
  - **Descarga (RX)**: Curva spline cuadrática en verde esmeralda (`#34D399`) con relleno de gradiente translúcido suave.
  - **Subida (TX)**: Línea de precisión en cian eléctrico (`#38BDF8`).
- **Eje Y Adaptativo con Suelo Mínimo**:
  - Umbral mínimo de 50 KB/s para evitar fluctuaciones engañosas cuando la interfaz está inactiva.
- **Insignias Informativas**:
  - Conteo de muestras registradas (`X pts`).
  - Caudal pico del intervalo de 2 horas (`Pico: ↓ ... MB/s · ↑ ... MB/s`).
- **Interacción Touch-Scrubbing & Hover**:
  - Al posar el ratón o deslizar el dedo sobre el lienzo, se activa una mira de coordenadas vertical con círculos de anclaje para RX y TX.
  - Tooltip flotante con desenfoque de cristal (`backdrop-filter: blur(10px)`) que detalla la velocidad exacta y el instante relativo (`-X min`).

---

## 2. Pruebas y Verificación

1. **Compilación de Sintaxis**:
   - `python3 -m py_compile server.py` -> Exitoso (código 0).
   - Verificación de scripts en `index.html` y `static/index.html`.
2. **Sincronización de Archivos**:
   - `VERSION` actualizado a `4.1.0`.
   - `package.json` actualizado a `4.1.0`.
   - `static/index.html` sincronizado idéntico a `index.html`.
   - `README.md` actualizado con la documentación completa de `v4.1.0`.
