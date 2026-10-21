# Plan de Implementación: Agrupamiento Dinámico por Zoom y Exclusión de Conexiones Locales

## 1. Contexto y Objetivos del Usuario
1. **Cero Texto Hardcodeado / Fijo**: Ningún nombre de ciudad, proveedor o texto estático en la lógica de agrupación o renderizado del mapa. Todas las etiquetas y títulos deben calcularse de forma 100% dinámica a partir de los datos recibidos (`remote_ip`, `city`, `country`, `isp`).
2. **Agrupamiento Dinámico según el Zoom (Clustering por Distancia de Píxeles en Pantalla)**:
   - Al hacer zoom hacia afuera (alejarse), los marcadores próximos en pantalla (< 48px) se combinan dinámicamente en una insignia de grupo (`🔀 N`) para no solaparse.
   - Al hacer zoom hacia adentro (acercarse), a medida que los puntos se separan visualmente en la pantalla, se desempaquetan dinámicamente en pines individuales o subgrupos independientes.
   - Escuchar el evento `'zoomend'` de Leaflet para recalcular instantáneamente los clusters.
3. **Excluir Conexiones Locales (LAN) del Mapa**:
   - No mostrar IPs privadas locales (`192.168.x.x`, `10.x.x.x`, `172.x.x.x`, `127.x.x.x`, etc.) como pines en el mapa.
   - Únicamente el nodo anfitrión central del servidor se ubica en Gran Canaria.
4. **Mostrar las IPs Públicas a las que se conectan los dispositivos de la casa**:
   - Integrar la lectura de kernel conntrack (`sudo -n conntrack -L`) en `server.py` para capturar todos los flujos activos y recientes de red entre los dispositivos de la casa (`192.168.50.x`) y las IPs públicas externas de Internet a las que acceden.
5. **Persistencia del Popup Abierto**:
   - Mantener abierto el popup de la IP seleccionada durante los refrescos periódicos de métricas y los eventos de zoom del mapa hasta que el usuario decida cerrarlo con el botón `[X]`.
6. **Incremento de Versión Semántica**:
   - Siguiendo la regla de control de versión (`0.0.X` para ajustes de detalle / corrección sin cambio mayor de diseño): pasar de `v4.11.0` a `v4.11.1`.

---

## 2. Cambios Propuestos

### Backend (`server.py`)
- En `fetch_connections_geo_worker()`:
  - Mantener la exclusión de IPs privadas para que no se generen pines LAN falsos ni órbitas.
  - Añadir lectura de kernel conntrack con `sudo -n conntrack -L`:
    - Identificar flujos donde el origen sea una IP privada de la casa (`192.168.50.x`) y el destino sea una IP pública externa (o viceversa).
    - Registrar el socket con su servicio y `source_hint` dinámico ("Servidor" o "Dispositivo 192.168.50.x").
    - Añadir estas IPs públicas a la cola de resolución GeoIP (`ip-api.com`).

### Frontend (`static/index.html` e `index.html`)
- En `NetworkConnectionsMapEngine`:
  - Almacenar `_currentConns` y `_currentSrv`.
  - Escuchar `this._leafletMap.on('zoomend', () => this.renderDynamicClusters())`.
  - Crear función `clusterConnections(conns)` que proyecte cada coordenada a píxeles de pantalla con `this._leafletMap.latLngToLayerPoint([lat, lng])` y agrupe aquellos con distancia `< 48px`.
  - Crear función `renderDynamicClusters()`:
    - Etiquetado 100% dinámico con `getDynamicClusterLabel(items)`.
    - Generación de marcadores y polilíneas hacia el nodo servidor.
    - Retención inteligente del popup activo mediante `activeConnId` y `activeIp`.
  - En `renderFromMetrics`: filtrar `conns.filter(c => !c.is_lan && typeof c.lat === 'number' && typeof c.lng === 'number')` y delegar a `renderDynamicClusters()`.

### Versión y Documentación
- `VERSION` -> `4.11.1`
- `package.json` -> `"version": "4.11.1"`
- `README.md` actualizado con las novedades de la versión `4.11.1`.
- `planes/2026-10-21_cluster_dinamico_zoom_y_excluir_lan.md` y `planes/walkthrough.md`.
