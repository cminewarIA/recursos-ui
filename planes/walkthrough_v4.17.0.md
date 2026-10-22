# 📋 Verificación y Recorrido: Dispositivos de Red con Consumos Reales (v4.17.0)

## 🎯 Objetivo Cumplido
Incorporar al subapartado **Distribución de Ancho de Banda por Subredes y Grupos** (`#netBandwidthPieSection` en la pestaña de Red `/red`) la capacidad de visualizar directamente los **dispositivos de la red con sus consumos reales medidos** (descarga, subida y caudal en vivo), corrigiendo al mismo tiempo la distorsión que producían los contadores de hardware acumulados de interfaces troncales de enrutamiento.

---

## 🛠 Cambios Implementados

### 1. Frontend (`static/index.html` e `index.html`)
- **Nuevo Modo de Agrupación `📱 Dispositivos`**:
  - Añadido el botón `#btnPieGroupDevices` al selector segmentado de la sección:
    `[ 🌐 Subredes IP ] [ 📶 Grupos de Enlace ] [ 🖥️ Categorías ] [ 📱 Dispositivos ]`
  - Manejador `NetworkBandwidthPieChart.setGroupMode('devices')` integrado con transiciones vectoriales D3 fluidas.
- **Cálculo con Consumos Reales Medidos**:
  - El motor ahora toma directamente las métricas de `wifi_clients` alimentadas por Flow Cache L2 y contadores del sistema (`tx_bytes`, `rx_bytes`, `speed_down`, `speed_up`).
  - **Segregación Inteligente de Troncales**: Se excluyen los contadores acumulados de las interfaces de infraestructura (`Router Vodafone Gateway` y `Repetidor ASUS Switch`, que sumaban más de 18 TB desde el arranque del router), evitando que distorsionen y anulen a escala del 99.9% a los dispositivos reales de los usuarios.
  - **Top Consumidores & Agrupación Elegante**: En modo `devices`, los 8 dispositivos con mayor tráfico (`synology-nas`, `Galaxy Tab S10 Lite`, `TV Sala de Estar TCL`, `Galaxy S21`, `Google Home Mini`, `Redmi A3`, `Aspirador Xiaomi`, `Xbox One X`) disponen de sus propios sectores con la paleta de colores extendida; los dispositivos restantes se integran armoniosamente en `🌐 Otros dispositivos (${N})`.
- **Desglose Enriquecido en la Leyenda**:
  - En modo `devices`, cada elemento muestra su icono/emoji de tipo de dispositivo, nombre amigable, dirección IP, tipo de enlace (`Wi-Fi 5 GHz`, `Wi-Fi 2.4 GHz` o `Cable Gigabit`), consumo acumulado (`↓ Descarga · ↑ Subida`) o velocidad instantánea en vivo, y porcentaje relativo.
  - En los modos `subnets`, `groups` y `categories`, la leyenda ahora detalla los dispositivos concretos que componen cada segmento junto a sus consumos reales individuales (ejemplo: `TV Sala (3.96 GB), Xbox One X (1.03 GB), Xbox Series S (20 MB)`).
- **Lector Central HiDPI Reactivo**:
  - Al posar el cursor o pulsar un dispositivo en el gráfico o en la leyenda, el visor central muestra de inmediato el nombre del dispositivo, su IP y su porcentaje exacto de consumo.

### 2. Control de Versiones y Documentación
- Actualizado el archivo canónico [VERSION](file:///home/servidor/servicios/dashboard/VERSION) a `4.17.0` (Regla 5: `0.X.0` para nuevas funcionalidades).
- Actualizado [package.json](file:///home/servidor/servicios/dashboard/package.json) a `4.17.0`.
- Documentada la nueva característica y la distribución multidimensional en [README.md](file:///home/servidor/servicios/dashboard/README.md).
- Plan de implementación y recorrido respaldados en la carpeta `planes/` ([planes/implementation_plan_v4.17.0.md](file:///home/servidor/servicios/dashboard/planes/implementation_plan_v4.17.0.md) y [planes/walkthrough_v4.17.0.md](file:///home/servidor/servicios/dashboard/planes/walkthrough_v4.17.0.md)).

---

## 🔬 Verificación en el Servidor

### 1. Estado del Servicio
```bash
sudo systemctl restart system-dashboard.service
sudo systemctl status system-dashboard.service --no-pager
```
Resultado: Servicio Systemd activo y saludable en el puerto 8085.

### 2. Verificación de Versión
```bash
curl -s http://127.0.0.1:8085/api/version
```
Salida:
```json
{"version": "4.17.0", "app_name": "dashboard-recursos", "status": "ok"}
```

### 3. Verificación de Métricas de Clientes en Tiempo Real
Los 25 dispositivos conectados en la red local reportan sus consumos reales a través de `/api/metrics`:
- `synology-nas`: ~137 GB (Almacenamiento en red)
- `Galaxy Tab S10 Lite`: ~4.06 GB
- `TV Sala de Estar (TCL)`: ~3.96 GB
- `Galaxy S21`: ~2.77 GB
- `Google Home Mini (Principal)`: ~1.80 GB
- `Redmi-A3`: ~1.37 GB
- `aspirador-xiaomi-s40`: ~1.33 GB
- `Xbox One X`: ~1.03 GB (y hasta ~1.8 MB/s de caudal en vivo)
- Dispositivos domóticos y consolas en reposo con sus respectivos contadores.
