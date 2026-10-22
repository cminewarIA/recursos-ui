# Plan de Implementación — v9.0.0

## 1. Rediseño de Cuadrícula de Cápsulas para Flujos y Sockets Geolocalizados
- **Rejilla Responsiva de Cápsulas (`.conn-capsules-grid`)**: Sustituir la lista vertical unicolumna por una cuadrícula adaptable (`repeat(auto-fill, minmax(290px, 1fr))`) para maximizar el aprovechamiento del ancho de pantalla y mostrar un mayor número de conexiones en el mismo espacio.
- **Cápsula Compacta de Conexión (`.conn-capsule`)**:
  - Encabezado: dirección de flujo (`↓ IN`, `↑ OUT`, `🛡️ BLK`), badge interactivo de servicio y protocolo/estado (`TCP · ESTAB`), más hits acumulados en modo historial.
  - Centro: endpoint remoto (IP:puerto + dominio DNS Pi-hole) y dispositivo LAN de origen (`← 📱 Equipo:puerto`).
  - Pie de cápsula: ciudad, país, ISP, etiqueta de exactitud GeoIP (`🎯 ip-api+ipwho.is`), botón `📜 Historial` por dispositivo y botón de bloqueo/desbloqueo directo.
  - Al hacer clic en cualquier parte de la cápsula, se enfoca la coordenada geográfica en el mapa mundial.
  - Celda de ancho completo (`grid-column: 1 / -1`) para el cajón de historial SQLite por dispositivo (`.conn-dev-history-drawer`) cuando se despliega.

## 2. Grupos Compactos y Desglose Plegable en Distribución de Ancho de Banda
- **Tarjetas de Grupo Compactas por Defecto**: En "Desglose de Ancho de Banda por...", cada categoría muestra una tarjeta minimalista (~58px de altura) con nombre, swatch de color, porcentaje, consumo total y barra de progreso.
- **Desglose Desplegable al Hacer Clic (`toggleGroupExpand`)**: Al hacer clic en la tarjeta de grupo o en su botón `▼ Desglose (N)`, se despliega/pliega de forma interactiva la lista detallada de todos los dispositivos del grupo con su icono, nombre, IP, tipo de enlace (`Eth`/`5G`/`2.4G`) y consumo individual de descarga (`↓`) y subida (`↑`).
