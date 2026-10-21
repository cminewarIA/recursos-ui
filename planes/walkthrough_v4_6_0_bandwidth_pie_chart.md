# Walkthrough v4.6.0 — Gráfico de Pastel de Distribución de Ancho de Banda por Subredes y Grupos de Dispositivos

## 1. Objetivo
Añadir un componente de visualización interactivo en la pestaña **Red** (`/red`, contenedor `#viewNetwork`) que muestre un **gráfico de pastel / donut** (`#canvasNetBandwidthPie` y motor `NetworkBandwidthPieChart`) con la distribución del ancho de banda entre las diferentes subredes IPv4 (`/24`) o grupos de dispositivos detectados, manteniendo además la utilería de limpieza periódica de `localStorage` para GeoIP (`GEOIP_MAX_ENTRIES`).

## 2. Arquitectura Implementada (`index.html`, `static/index.html`, `vite.config.ts`, `server.py`)
- **Componente Visual en `#viewNetwork` (`#netBandwidthPieSection`)**:
  - **Controles Segmentados de Agrupación**:
    1. `🌐 Subredes IP` (`subnets`): Agrupa los dispositivos e interfaces por subred IPv4 (`/24`, subredes Docker `172.16-31.x.x`, Tailscale `100.64-127.x.x`, VPN `10.x.x.x` y flujos WAN). Si todos los dispositivos locales residen en una misma subred `/24`, subdivide inteligentemente por segmento de subred (Nodo Servidor/Troncal, Segmento LAN Ethernet, Subred Wi-Fi 5 GHz y Subred Wi-Fi 2.4 GHz).
    2. `📶 Grupos de Enlace` (`groups`): Distribución entre `🔌 Ethernet Gigabit (Enlace Cableado)`, `📶 Wi-Fi 5 GHz (Alta Velocidad)` y `📡 Wi-Fi 2.4 GHz & Red IoT`.
    3. `🖥️ Tipo de Dispositivo` (`categories`): Clasificación heurística por rol (`Servidor Host & Infraestructura`, `Smart TV, Streaming & Consolas`, `Smartphones & Tablets`, `Ordenadores & Estaciones`, `Domótica, Cámaras & IoT`).
  - **Controles Segmentados de Métrica**:
    - `📊 Tráfico Acumulado` (`total_bytes`): Suma de tráfico descargado y subido (`↓ RX + ↑ TX`).
    - `⚡ Caudal en Vivo` (`live_speed`): Ancho de banda en tiempo real (`B/s`), con respaldo automático al acumulado cuando las interfaces están en reposo.
  - **Renderizado HiDPI en Canvas + Leyenda Interactiva**:
    - Soporte Retina (`devicePixelRatio`), resaltado al pasar el ratón o tocar un sector (`hover` y `click` para fijar), lectura central dinámica (`#bwPieCenterReadout`) e insignias de segmento dominante (`#bwPieTopSegmentBadge`) y total de nodos (`#bwPieActiveNodesBadge`).

## 3. Verificación
- Sincronizado `index.html` -> `static/index.html`.
- Validada la sintaxis de `server.py` (`python3 -m py_compile server.py`) y la compilación del proyecto (`compile_applet`).
