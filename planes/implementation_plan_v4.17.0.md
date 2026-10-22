# Plan de Implementación: Dispositivos de Red con Consumos Reales en Distribución de Ancho de Banda (v4.17.0)

El usuario ha solicitado que en el subapartado **Distribución de Ancho de Banda por Subredes y Grupos** (`#netBandwidthPieSection` en la vista de Red `/red`):
> *"estaria bien que contara con los dispositivos de la red con sus consumos reales"*

Actualmente, el gráfico agrupa por `Subredes IP`, `Grupos de Enlace` y `Tipo de Dispositivo`, pero carece de un modo directo para visualizar los **dispositivos individuales** de la red. Además, las interfaces troncales del router (`Router Vodafone` y `Repetidor ASUS`) acumulan contadores globales de hardware de más de 18 Terabytes desde el arranque, lo que distorsiona las proporciones y opaca los consumos reales medidos de los dispositivos clientes (Smart TVs, consolas, móviles, domótica, almacenamiento NAS, etc.).

---

## 🎯 Objetivos de la Implementación

1. **Nuevo Modo de Agrupación `📱 Dispositivos de Red` (`devices`)**:
   - Añadir el botón en el selector segmentado:
     `[ 🌐 Subredes IP ] [ 📶 Grupos de Enlace ] [ 🖥️ Categorías ] [ 📱 Dispositivos ]`
   - Permitir visualizar directamente el gráfico de pastel/donut dividido por dispositivos de la red con sus consumos reales.

2. **Cálculo con Consumos Reales Medidos (Zero-Hardcoding)**:
   - Utilizar las lecturas precisas de `wifi_clients` (alimentadas por Flow Cache L2 y contadores del sistema: `tx_bytes`, `rx_bytes`, `speed_down`, `speed_up`).
   - Diferenciar los dispositivos clientes de usuario final de las interfaces troncales de enrutamiento (`dev_type === 'network'`), permitiendo ver el consumo neto de los clientes sin que 18 TB de backhaul troncal anulen la visibilidad de los dispositivos reales.
   - En modo `devices`, listar los dispositivos dominantes (Top 8 por consumo) y agrupar los restantes en `🌐 Otros dispositivos (${N})` con su suma real para garantizar un gráfico armónico y legible.

3. **Enriquecimiento del Desglose en la Leyenda**:
   - Cada elemento de dispositivo mostrará su icono/avatar de marca, nombre (`Xbox One X`, `TV Sala de Estar`, `Galaxy S21`, etc.), IP, consumos desglosados (`↓ Descarga · ↑ Subida`) y porcentaje sobre el total.
   - En los modos existentes (`subnets`, `groups`, `categories`), la leyenda detallará los dispositivos reales que componen cada grupo junto a sus consumos individuales (ejemplo: `TV Sala (3.96 GB), Xbox (1.03 GB)`).
   - Sincronización bidireccional entre la leyenda, el gráfico D3 vectorial y el lector central HiDPI.

---

## 📂 Archivos Involucrados

| Archivo | Acción | Descripción |
| :--- | :---: | :--- |
| `static/index.html` | MODIFICAR | Añadir botón `#btnPieGroupDevices`, actualizar `NetworkBandwidthPieChart` (nuevo modo `devices`, refinamiento de `buildBuckets` con consumos reales y renderizado en leyenda). |
| `index.html` | MODIFICAR | Sincronización directa desde `static/index.html`. |
| `VERSION` | MODIFICAR | Incremento a `4.17.0` (Regla 5: nueva funcionalidad `0.X.0`). |
| `package.json` | MODIFICAR | Actualización de versión a `4.17.0`. |
| `README.md` | MODIFICAR | Documentar la nueva agrupación por dispositivos y actualización en historial de versiones (Regla 4). |
| `planes/walkthrough_v4.17.0.md` | CREAR | Bitácora y validación de las pruebas realizadas (Regla 3). |

---

## 🔍 Plan de Verificación

1. **Pruebas de Datos en Backend**:
   - Confirmar que `/api/metrics` suministra la lista completa de `wifi_clients` con `tx_bytes`, `rx_bytes`, `speed_down` y `speed_up` reales.
2. **Pruebas de Interfaz y Navegación**:
   - Probar el nuevo botón `📱 Dispositivos` en `/red`.
   - Alternar entre `📊 Tráfico Acumulado` y `⚡ Caudal en Vivo` verificando que las velocidades y volúmenes reflejan los datos reales de los clientes activos.
   - Verificar la interacción al pasar el cursor o pulsar sobre los sectores y la sincronización con el visor central.
3. **Control de Versión y Publicación**:
   - Verificar `git status` y confirmación automática con `git push origin main`.
