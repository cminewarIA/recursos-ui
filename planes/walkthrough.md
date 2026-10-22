# Walkthrough y Verificación — v9.0.0

## Resumen de Cambios Implementados

1. **Cuadrícula de Cápsulas para Detalle de Flujos y Sockets Geolocalizados**:
   - Se reemplazó la lista tabular unicolumna por una rejilla responsiva CSS (`.conn-capsules-grid`, `minmax(290px, 1fr)`) que aprovecha de manera uniforme todo el ancho del contenedor.
   - Cada conexión se muestra como una cápsula compacta (`.conn-capsule`) con toda su información clave (dirección, servicio, protocolo/estado, IP:puerto, dominio, dispositivo de origen, ubicación e ISP).
   - Incluye acceso directo a `📜 Historial` en línea (con celda expandida `grid-column: 1 / -1`), bloqueo en 1 clic y enfoque automático en el mapa al hacer clic en la cápsula.

2. **Grupos Compactos con Desglose Plegable en Distribución de Ancho de Banda**:
   - En `NetworkBandwidthPieChart`, las tarjetas de categoría se presentan compactas por defecto con resumen minimalista.
   - Al pulsar sobre la tarjeta o su botón `▼ Desglose (N)`, se despliega de forma animada la lista de todos sus dispositivos y consumos individuales (`↓`, `↑` y total).

3. **Sincronización y Compilación**:
   - `/index.html` sincronizado con `/static/index.html`.
   - Versión incrementada a `9.0.0` en `/VERSION`, `/package.json`, `/README.md` y compilado Debian `/dist/recursos-cockpit_9.0.0_amd64.deb`.
