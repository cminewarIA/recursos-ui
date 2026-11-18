# Plan de Implementación — Revisión Integral Línea a Línea, Calibración Speedtest Fibra, Diagnóstico IA deConexiones y Avisos del Sistema, y Gelatina Solo en Topes de Scroll (`v12.22.0`)

## 1. Eliminación del Efecto Gelatina al Señalar/Pulsar (Exclusivo en Topes de Scroll)
Siguiendo tu indicación explícita (*"quita el efecto gelatina al señalar con el raton"* → *"Dejar el efecto gelatina solo en los topes de scroll"*):
- **Motor de Física (`src/utils/scrollContain.ts`)**:
  - Se elimina por completo `triggerElementJelly` y todos los disparadores asociados a eventos de ratón/puntero y teclado sobre elementos interactivos (`pointerover` / hover, `pointerdown`, `click`, `change` y `keydown` Enter/Espacio).
  - Se elimina la deformación intermedia durante el desplazamiento normal (`intensity === 'move'`), restringiendo `triggerScrollJelly` y `runStageCompanionDockJelly` **exclusivamente a `intensity === 'edge'`** (rebote elástico únicamente cuando la ventana principal, un contenedor con scroll o una ventana modal alcanza su tope superior, inferior, izquierdo o derecho).
  - Se mantiene intacto el aislamiento estricto de scroll (`overscroll-contain` y bloqueo de rueda/touch en modales y popups de Leaflet) para que el fondo nunca se mueva al desplazar una ventana emergente.
- **Estilos Globales y Primitivas de Movimiento (`src/index.css` y `src/components/MotionPrimitives.tsx`)**:
  - Se eliminan las deformaciones `scaleX(...) scaleY(...)` en `:hover` y `:active` de botones y sub-tarjetas (`.cockpit-subtile`, `.cockpit-btn-accent`, `.cockpit-btn-wol`, `.cockpit-btn-off`), dejando transiciones limpias de color, borde y luminosidad.
  - En `BentoCard`, `ViewStage`, `AccordionBody` y tarjetas de las 5 vistas (`OverviewView`, `EquipmentView`, `NetworkSecurityView`, `AppsMediaView`, `MoreView`, `App`), se retiran las propiedades `whileHover` y `whileTap` que deformaban o escalaban las tarjetas al pasar el ratón o hacer clic.

## 2. Calibración del Motor Local de Test de Velocidad (`Speedtest.net`) para Líneas de Fibra de Alta Velocidad
Para resolver el desajuste entre la velocidad medida en el navegador con `speedtest.net` y la medida desde la instalación local (`server.py` y `vite.config.ts`):
- **Causa raíz identificada en la revisión línea a línea**:
  1. En `server.py`, la prioridad 2 ejecutaba el script clásico de Python `speedtest-cli` (`/usr/bin/speedtest-cli`) antes que el motor paralelo integrado. Dicho script heredado de Python usa conexiones HTTP antiguas de un solo nodo y está limitado por el GIL de Python, saturándose artificialmente entre 50 y 150 Mbps en líneas de fibra de 600 Mbps o 1 Gbps.
  2. El motor integrado utilizaba solo **3 hilos de descarga** con archivos pequeños (8 MB sin bucle continuo ni reutilización TCP `Keep-Alive`) y **2 hilos de subida** con bloques de 512 KB abriendo un handshake TCP+TLS nuevo en cada petición, además de promediar el tiempo total incluyendo el *TCP slow-start* inicial.
- **Solución técnica implementada (`server.py` y `vite.config.ts`)**:
  1. **Prioridad estricta al binario oficial C++ de Ookla (`ookla-speedtest`) y al nuevo Motor Paralelo Multi-Stream con Keep-Alive**: Se relega el antiguo script Python `speedtest-cli` únicamente como último recurso si fallan los motores principales.
  2. **Sesiones Persistentes HTTP/HTTPS `Keep-Alive` (`requests.Session` con `HTTPAdapter(pool_connections=16, pool_maxsize=16)` en Python y `https.Agent({ keepAlive: true, maxSockets: 16 })` en Node)**: Elimina la penalización de renegociar TCP + TLS en cada bloque transferido.
  3. **Descarga Multi-Stream de Alta Capacidad (8 flujos paralelos durante 6.5 s)**: Cada trabajador mantiene un bucle continuo descargando payloads grandes (`random4000x4000.jpg` ~31 MB / `download?size=25000000` en nodos Ookla o bloques de 25 MB en Cloudflare CDN) con buffers de lectura de 256 KB.
  4. **Subida Multi-Stream de Alta Capacidad (6 flujos paralelos durante 5.5 s)**: Cada trabajador envía payloads de **2 MB** en bucle continuo reutilizando la misma conexión TLS persistente (`Keep-Alive`).
  5. **Cálculo de Velocidad Sostenida (Descarte de TCP Slow-Start + Contraste con Interfaz Física `/proc/net/dev`)**: Se muestrea el caudal cada 200 ms combinando los bytes de aplicación con el contador real del kernel en `/proc/net/dev` de la interfaz WAN física (cuando `scope == "wan"`), descartando el primer tramo de arranque (*TCP slow-start* de 800 ms) y calculando la media sostenida de las muestras estabilizadas (percentil superior / velocidad crucero real, idéntico al algoritmo de Ookla Speedtest).

## 3. Simplificación IA de Fallos del Avisador de la Interfaz con Nivel de Peligro, Soluciones y Caché Persistente en SQLite (`recursos_history.db`)
Siguiendo tu nueva solicitud (*"que la ia tambien simplifique los fallos detectados en el avisador de la interfaz y ofrezca soluciones y nivel de peligro y esa informacion la guarde en la base de datos tambien para no tener que consultar fallos recurrentes"*):
- **Tabla SQLite `ai_system_fault_insights` en la Base de Datos Única Local (`recursos_history.db`)**:
  - Se añade la tabla `ai_system_fault_insights (lang, signature, unit, category, title, danger_level, summary, solution, confidence, model, occurrence_count, first_seen_at, analyzed_at, PRIMARY KEY (lang, signature))` en `init_geoip_history_db()`.
  - **Firma Normalizada Anti-Recurrentes (`_normalize_system_fault_signature`)**: Cada fallo de `journalctl` o unidad caída de `systemctl --failed` se normaliza reemplazando PIDs, direcciones hexadecimales, puertos efímeros y marcas de tiempo variables por `#`. Así, cuando un mismo fallo vuelve a ocurrir (incluso con distinto PID o fecha), genera **exactamente la misma firma (`signature`)** y se resuelve instantáneamente desde `recursos_history.db` sin volver a consultar a Gemini.
- **Endpoint Backend `POST /api/system/logs/ai-simplify` y Enriquecimiento Automático en `GET /api/system/logs` y `/api/metrics`**:
  - `GET /api/system/logs` y `get_effective_system_errors_summary()` cruzan automáticamente los avisos activos con `ai_system_fault_insights` en `recursos_history.db`, adjuntando `ai_insight` a cada fallo ya conocido e incluyendo el historial persistido `ai_fault_insights`.
  - `POST /api/system/logs/ai-simplify` comprueba primero la caché en memoria y la tabla SQLite `ai_system_fault_insights`; únicamente envía a Gemini (`gemini-4-hydrogen`) los fallos cuya firma normalizada no exista aún en la base de datos local, guardando el diagnóstico (`title`, `danger_level`: `critical | high | medium | low`, `summary`, `solution`) en `recursos_history.db`.
- **Integración Visual en el Avisador de `/inicio` (`OverviewView.tsx`) y en el Panel de Salud y Avisos de `/mas` (`MoreView.tsx`)**:
  - En el desplegable del avisador de `/inicio` y en la tarjeta **"Salud y avisos del sistema"** de `/mas`, se añade el botón **"Simplificar avisos con IA"** (además de mostrar automáticamente los diagnósticos ya guardados en la base de datos para fallos recurrentes).
  - Cada fallo muestra su insignia semántica de **Nivel de peligro** (*Crítico*, *Peligro alto*, *Peligro medio*, *Peligro bajo*), título simplificado, explicación clara, pasos de solución recomendados y contador de recurrencia, más un registro histórico consultable de fallos diagnosticados por la IA en `recursos_history.db`.

## 4. Revisión Línea a Línea de los 5 Apartados (`/inicio`, `/equipo`, `/red`, `/programas`, `/mas`)
### A. Escalado Fluido Universal sin Recortes (Regla 6 de `GEMINI.md`)
- **`/red` (`src/components/NetworkSecurityView.tsx`)**:
  - En la barra de filtros del Mapa GeoIP y del Historial de conexiones, se reemplazan los anchos máximos rígidos (`max-w-[200px]`, `max-w-[210px]`, `max-w-[220px]`) por contenedores flexibles (`min-w-[clamp(9rem,18vw,14rem)] flex-1 sm:flex-initial`) para que los selectores de Dispositivo, Servicio y Ventana Temporal escalen sin truncar nombres largos.
  - En la tabla de historial de Speedtest y tablas de conexiones, se reemplaza `max-w-[200px]` en la columna de servidor/nodo por un contenedor fluido con ajuste automático.
- **`/inicio`, `/equipo`, `/programas`, `/mas`**:
  - Revisión de cabeceras, barras de subapartados (`cockpit-subtabs-bar`), tarjetas Bento y modales (`ExpandedChartModal`, `NetworkDevicesModal`) garantizando que todas las vistas escalen con `clamp()` y `auto-fit`/`minmax` sin desbordamientos horizontales.

### B. Historial Consultable Completo en Base de Datos Única (`recursos_history.db` — Regla 8 de `GEMINI.md`)
- **Nuevo Bloque de Historial de Identificaciones IA en `/red` → *Historial de tráfico* (`NetworkSecurityView.tsx`)**:
  - Se integra una sección dedicada **"Historial de identificaciones IA (`recursos_history.db`)"** dentro del subapartado *Historial de tráfico*, alimentada por `netHistory24h.ai_insights` (persistido en la tabla `ai_connection_insights` de `recursos_history.db`).
  - Permite buscar y filtrar por texto (`trafficFilterQuery`), ver la aplicación identificada (`app_name`), categoría (`category`), rol (`role`), nivel de confianza (`confidence`), firma técnica (`signature`), explicación (`summary`) y marca temporal de análisis (`analyzed_at`), además de lanzar un nuevo análisis IA o saltar directamente al mapa.
- **Traducción Completa (`./i18n/dictionary.csv`)**:
  - Se registran todas las claves nuevas de interfaz para el historial de identificaciones IA y para el simplificador IA de fallos y soluciones en las 33 columnas de idioma de `./i18n/dictionary.csv`.

### C. Depuración Integral de Código Muerto, Tipos y Coherencia Visual (Regla 9 de `GEMINI.md`)
- Limpieza de funciones y selectores huérfanos en `src/utils/scrollContain.ts` tras retirar el efecto gelatina en hover/click.
- Verificación estricta sin variables ni importaciones sin uso (`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`), compilación Python (`python3 -m py_compile`), validación ESLint (`npx eslint firestore.rules`), integridad de `./i18n/dictionary.csv` (33 columnas exactas), `npm run build` y empaquetado `.deb`.
- Sincronización de `./VERSION` (`12.22.0`), `./README.md` y registro de resultados en `./planes/walkthrough_v12.22.0.md`.
