# Reglas y Pautas del Proyecto (Dashboard / Recursos)

## 1. Compatibilidad Universal de Rutas y Cero Hardcoding (Zero-Hardcoding)
- **Regla obligatoria**:
  1. **Rutas Relativas al Repositorio**: Todas las referencias a archivos del proyecto (`VERSION`, `planes/`, `static/`, scripts de DuckDNS o Caddy) deben resolverse mediante rutas relativas (`./` y `BASE_DIR`), evitando codificar o asumir rutas fijas del servidor físico (`/home/servidor/...`) que provoquen errores en contenedores de Google AI Studio o entornos cloud. Cuando sea necesario acceder a rutas locales del servidor físico, se debe verificar previamente su existencia con `os.path.exists()`.
  2. **Cero Nombres Fijos (Zero-Hardcoding)**: Queda terminantemente prohibido codificar valores estáticos, marcas, nombres de ciudades, ubicaciones o proveedores ("Mountain View", "Madrid", "Google", "AWS"). Toda etiqueta, ubicación o agrupación se calcula de forma 100% dinámica a partir de la telemetría en tiempo real (`remote_ip`, `city`, `country`, `isp`, `asn`).
  3. **Hardware Dinámico**: Sensores térmicos, núcleos CPU, discos, interfaces de red (NICs), particiones y GPUs deben detectarse e instanciarse dinámicamente mediante las APIs del sistema (`psutil`, `/sys`, `ip-api`), nunca con listas o arrays estáticos.
  4. **Agrupamientos Dinámicos**: Los grupos y clusters del mapa o tablas se computan dinámicamente según coordenadas o distancias en tiempo de ejecución.

## 2. Control de Versión Unificado, Llamada Única y Criterio Estricto de Incremento (`VERSION`)
- **Regla obligatoria**:
  1. **Punto y Archivo Único de Verdad (`./VERSION`)**: La versión canónica de la aplicación reside **exclusivamente** en `./VERSION`. Queda estrictamente prohibido duplicar o escribir números de versión estáticos/hardcodeados en código fuente (`src/`, `server.py`, `desktop_app/`), HTML/Manual, `README.md`, SVG o fallbacks literales.
  2. **Llamada Única por Capa (Cero Duplicación)**: Todo lugar donde se mencione, muestre o utilice la versión debe consultar dinámicamente la única fuente `./VERSION` mediante su punto único de acceso:
     - **Python / Backend / Ubuntu Nativo**: `get_canonical_version()` / `get_app_version()` (en `i18n_catalog.py`, `server.py` y `desktop_app/recursos_app.py`), expuesto por `/api/version` y `/api/metrics`.
     - **Frontend React / Vite**: `getCanonicalVersion()` (`src/utils/version.ts`) apoyado en `__APP_VERSION__` inyectado por `vite.config.ts` directamente desde `./VERSION` y `window.__INITIAL_APP_VERSION__` / `/api/version`.
     - **Manual Interactivo (`static/manual.html` & `docs/index.html`)**: función única `resolveCanonicalVersion()` que consulta `window.__INITIAL_APP_VERSION__`, `/api/version` o `./VERSION` / `../VERSION` en runtime e hidrata dinámicamente badges, descargas, comandos y ejemplos.
     - **Empaquetado Debian y Android**: `packaging/build_deb.sh`, `packaging/build_apk.sh` y `android_app/app/build.gradle.kts` leen `./VERSION` en tiempo de compilación (`packaging/debian/control` y `package.json` mantienen marcadores neutros `0.0.0` inyectados únicamente al generar artefactos si la herramienta lo exige).
     - **Documentación (`README.md` y SVG)**: referencia directa a [`./VERSION`](./VERSION), badges dinámicos apuntando a `VERSION` y enlaces `releases/latest`, evitando incrustar la versión activa en decenas de líneas.
  3. **Identificación al Inicio y Pre-Sincronización con GitHub**: Consultar `./VERSION` al iniciar cualquier tarea y, antes de modificar código o incrementar la versión, comprobar mediante `git fetch origin`, `git rev-list --left-right --count origin/main...HEAD` y `git status --short` si existen commits remotos pendientes en GitHub o cambios locales sin sincronizar; si los hay, integrarlos/sincronizarlos primero para evitar divergencias o colisiones de versión.
  4. **Criterio Estricto de Incremento (`MAJOR.MINOR.PATCH`)**:
     - **Excepción Multi-Idioma (Cero Bump para Traducciones)**: Añadir columnas de nuevos idiomas o completar/corregir traducciones en `./i18n/dictionary.csv` **NO requiere modificar `./VERSION`** ni recompilar/reempaquetar `.deb` o `.apk`, dado que web, backend y clientes nativos sincronizan el diccionario en línea (OTA) desde GitHub.
     - **`X.0.0` (Rediseño Completo de la Aplicación)**: Se incrementa `MAJOR` **únicamente cuando se rediseña la aplicación completamente** (cambio integral de arquitectura visual, nuevo sistema de diseño global de toda la app o rediseño de pies a cabeza). Los otros dos números se restablecen obligatoriamente a 0 (ej: `4.9.1` -> `5.0.0`).
     - **`0.X.0` (Actualización Intermedia / Añadir, Quitar o Rediseñar una Función o Aspecto Concreto)**: Se incrementa `MINOR` **cuando se añade una nueva función, se retira una existente o se rediseña/ajusta un aspecto o función concreta de la interfaz** (ej: rediseño de un componente, formato cuadrícula/cápsulas, desplegables modulares). El tercer número se restablece a 0 (ej: `8.0.0` -> `8.1.0`).
     - **`0.0.X` (Actualización o Ajuste de Pequeños Detalles)**: Se incrementa `PATCH` **cuando se actualiza algo existente, se corrigen errores (bugfixes) o se ajustan pequeños detalles** (modificación de textos, reglas, ajustes de rendimiento o documentación sin alterar funciones completas ni el diseño general) (ej: `8.3.7` -> `8.3.8`).

## 3. Almacenamiento Obligatorio de Planes de Implementación y Walkthroughs (`planes/`)
- **Regla obligatoria**: Todos los planes de implementación (`implementation_plan.md`, `implementation_plan_v*.md`), archivos de recorrido y verificación (`walkthrough.md`, `walkthrough_v*.md`), bitácoras de trabajo y pruebas deben guardarse SIEMPRE en la carpeta `./planes/`. Jamás deben limitarse a directorios temporales de las IAs (`.gemini/antigravity/brain`).
- **Objetivo**: Garantizar que Google AI Studio, clientes móviles y Antigravity compartan permanentemente el contexto técnico exacto tras sincronizar con Git.

## 4. Actualización Obligatoria del README (`README.md`)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación, corrección, nueva funcionalidad, cambio de diseño, ajuste de reglas o incremento de versión, se debe sincronizar inmediatamente `./README.md` con la versión activa (badges de versión, banner, enlaces de descarga y ejemplos), evitando nombrar o listar versiones anteriores salvo para comunicar diferencias relevantes de arquitectura o funcionamiento.

## 5. Arquitectura Contractual de Aplicaciones Nativas (Linux & Android)
- **Regla obligatoria**: El diseño y desarrollo de cualquier aplicación cliente nativa (Linux/Ubuntu y Android) debe ajustarse de forma estricta y permanente a los siguientes principios:
  1. **Motor de Interfaz HTML5 Unificado con Contenedores Nativos (Ubuntu WebKit2 & Android WebView)**:
     - Las aplicaciones nativas de Ubuntu Linux (`.deb`) y Android (`.apk`) renderizan directamente la interfaz canónica completa en HTML5, CSS3, D3.js v7 y OpenStreetMap/Leaflet mediante contenedores nativos acelerados por hardware (`WebKit2` integrado en GTK 3 en Linux, y `android.webkit.WebView` integrado en Kotlin/Jetpack Compose en Android).
     - Cada contenedor nativo integra un puente del sistema operativo (*Native Bridge*) que gestiona en segundo plano el autodescubrimiento de red, la persistencia criptográfica de credenciales, la conmutación LAN ↔ WAN y el acceso a periféricos locales.
  2. **Autodescubrimiento y Enlace en Red Local (Wi-Fi / LAN)**:
     - Al conectarse a la red Wi-Fi o LAN local, las apps nativas implementan autodescubrimiento dinámico (mDNS/Zeroconf `_recursos._tcp`, SSDP o escaneo de subred) para localizar automáticamente el servidor sin introducir IPs manuales.
     - Descubierto el nodo, se inicia el protocolo de enlace (*pairing handshake*) para vincular el dispositivo e inyectar la sesión en el motor HTML5.
  3. **Autenticación, Criptografía y Consumo Seguro de APIs**:
     - Las apps nativas se certifican con el sistema de tokens/certificados criptográficos del servidor.
     - Durante el enlace, el servidor emite una credencial/token firmado que la app almacena en el gestor seguro del sistema (configuración protegida / Keyring en Linux, Android KeyStore / `EncryptedSharedPreferences` en Android) y sincroniza automáticamente con el cliente HTML5 (`X-Device-Token` / `Bearer`).
     - Toda comunicación viaja 100% cifrada bajo TLS/HTTPS en WAN y canales autenticados en LAN, con cero exposición de credenciales en texto plano.
  4. **Acceso Dual Transparente y Conexión Automática (LAN / WAN Exterior)**:
     - **Conexión Inmediata al Abrir**: La app nativa se conecta instantánea y automáticamente al nodo enlazado sin solicitar credenciales repetitivas.
     - **Conmutación Inteligente LAN ↔ WAN**:
       - *En Red Local (Wi-Fi/LAN)*: Comunicación directa con la IP/puerto local a latencia mínima.
       - *Desde el Exterior (Red Móvil / Internet / WAN)*: Conmutación automática exclusivamente hacia el dominio público / DDNS propio del servidor del usuario (aprendido dinámicamente tras emparejarse en su LAN local o configurado manualmente en la app), utilizando la credencial criptográfica del emparejamiento y sin ningún dominio ni dirección WAN/LAN fija del autor incluida en el código o en los instaladores.
  5. **Paridad Visual de Interfaz y Desbloqueo Exclusivo de DeX en Ubuntu**:
     - **Paridad Estética y Estructural Absoluta**: Al compartir el mismo motor de interfaz HTML5/CSS3/D3.js/Leaflet, todas las interfaces (web y nativas) mantienen idéntica identidad visual, filosofía de diseño (*Alethia Botanical Telemetry × Smart Visual Data — Zeus Vision*), paleta de colores mineral-obsidiana con acento lima eléctrico, tarjetas, gráficos vectoriales a 60 FPS e iconografía.
     - **Diferenciación Funcional Contractual (Desbloqueo de DeX)**:
       - *App Nativa de Ubuntu*: Al disponer de acceso directo a `/dev/uhid`, `scrcpy` y el subsistema USB a través de su puente nativo local, desbloquea dinámicamente el submenú de control DeX / Modo Escritorio Android (`/dex`) con todos sus controles de resolución, tasa de refresco (60 FPS), auto-conexión y modo pantalla completa.
       - *Versión Web y Clientes Externos (incluido Android)*: Todo submenú de DeX permanece estrictamente bloqueado y oculto en la navegación, mostrando únicamente el mensaje pasivo si se consulta: *"Esperando dispositivo para conectarse en su versión nativa"*.

## 6. Coherencia Estética, Lógica por Apartados, Simetría y Escalado Fluido Universal (Web, Linux/Ubuntu y Android)
- **Regla obligatoria**:
  1. **Coherencia Estética y Lógica por Dominio Funcional**: Todos los apartados (`/inicio`, `/equipo`, `/red`, `/programas`, `/mas`) y sus subapartados deben mantener estricta coherencia estética y lógica. Cada módulo, gráfica, tabla o control debe residir únicamente en el apartado al que pertenece funcionalmente, sin elementos descontextualizados ni redundancias entre vistas.
  2. **Análisis Obligatorio de Ubicación al Añadir Funciones**: Antes de implementar cualquier nueva funcionalidad, métrica, gráfica o botón, es obligatorio comprobar de forma lógica en qué apartado y subapartado encaja mejor (justificándolo en el plan dentro de `./planes/`) y rehusar dispersarla fuera de su sección natural.
  3. **Escalado Automático al Ancho y Alto de la Ventana Disponible**: Todos los elementos de la interfaz —cabeceras, barras de apartados/subapartados, rejillas Bento, tarjetas, gráficas, mapas, tablas y ventanas emergentes— deben escalar automáticamente tanto al ancho como al alto disponible del viewport (`auto-fit`/`minmax`, distribución envolvente adaptable sin recortes laterales, `clamp()`, alturas fluidas y `ResizeObserver`), asegurando que todo el contenido permanezca visible y legible en cualquier resolución o tamaño de ventana. Queda prohibido usar tamaños rígidos/fijos que recorten o oculten funciones.
  4. **Simetría Contractual y Ecosistema Homogéneo Universal**: La experiencia entre Web, Ubuntu (`GTK 3 + WebKit2`) y Android/TV (`Jetpack Compose + WebView`) comparte la misma identidad (*Alethia Botanical Telemetry × Smart Visual Data — Zeus Vision*), espaciado simétrico, radios, tipografía tabular (`Geist` + `Geist Mono`) y física elástica uniforme en cualquier componente nuevo o existente.

## 7. Diccionario Tabular Centralizado del Proyecto, Traducciones y Lecturas de Hardware (`./i18n/dictionary.csv`)
- **Regla obligatoria**:
  1. **Diccionario Único en Formato Hoja de Cálculo (`./i18n/dictionary.csv`)**: Todo el texto mostrado al usuario en la interfaz web (`src/`), el manual interactivo (`static/manual.html` / `docs/index.html`), las respuestas de usuario del servidor (`server.py`), la aplicación nativa de Ubuntu (`desktop_app/recursos_app.py`) y la aplicación nativa Android/TV (`android_app/`) debe resolverse mediante claves desde el diccionario CSV único `./i18n/dictionary.csv` (estructura tabular `key,context,es,...`, con la traducción base marcada en la columna `es` y filas de metadatos `__locale_name__` y `__default_locale__`). Queda prohibido dispersar literales de interfaz sin clave en componentes o ventanas.
  2. **Extensibilidad Automática por Columnas y Actualización OTA desde GitHub (Cero Cambios de Código ni de Versión al Traducir)**: Todos los analizadores (`i18n_catalog.py`, `src/i18n/csvParser.ts`, `vite.config.ts`, `manual.html` y `I18nDictionary.kt`) deben autodetectar dinámicamente cualquier nueva columna de idioma (`en`, `fr`, `de`, `pt`, etc.) agregada a `./i18n/dictionary.csv` (admitiendo delimitador `,` o `;` y UTF-8 con/sin BOM) y soportar su sincronización OTA desde GitHub (`raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv`) con fallback offline al CSV empaquetado, permitiendo incorporar idiomas nuevos en backend, web, Ubuntu Desktop y Android/TV sin modificar código ni incrementar `./VERSION`.
  3. **Traducción e Internacionalización de Lecturas de Hardware**: Los nombres dinámicos propios procedentes del sistema operativo (modelo de CPU/GPU, hostname, punto de montaje, interfaz de red, cmdline de procesos) se conservan dinámicos por Regla 1 (Zero-Hardcoding), pero **todas** las clasificaciones, etiquetas descriptivas, estados térmicos/energéticos/de montaje, tipos de transporte de almacenamiento (`NVMe`, `SATA`, `USB Extraíble`, `Tarjeta SD/MMC`, `NAS SMB/NFS`), bandas de red, roles de procesos GPU/systemd, estados de torrent/Emby, mensajes de salud, unidades y formatos temporales de telemetría deben emitirse con claves estructuradas (`*_key`) y traducirse íntegramente a través de `./i18n/dictionary.csv` (`i18n_catalog.py` en Python, `useI18n()` / `formatters.ts` en React y `I18nDictionary` en Android).
  4. **Paridad y Registro Obligatorio**: Al añadir cualquier nueva pantalla, métrica de hardware, alerta o botón, se debe registrar inmediatamente su `key` y `context` con su texto en la columna base `es` dentro de `./i18n/dictionary.csv`, empaquetando el CSV automáticamente en `.deb`, `.apk` y servicio web.

## 8. Historial Unificado en Base de Datos Única Local (`recursos_history.db`) — Creación en Instalación y Exclusión de GitHub
- **Regla obligatoria**:
  1. **Consulta Histórica Universal**: Todas las gráficas y datos captados por el sistema —velocidad de red e Internet, tests de velocidad (`Speedtest.net`), consumos de hardware (CPU, GPU, RAM, E/S y procesos), latencia ping, conexiones GeoIP/DNS y traducciones/identificaciones generadas por la IA— deben persistirse y poder consultarse en el historial desde sus vistas y modales de inspección.
  2. **Base de Datos Única Compartida (`recursos_history.db`)**: Todo el historial del servidor reside centralizado en **una única base de datos SQLite compartida** (`recursos_history.db` en modo `WAL`), evitando fragmentar historiales productivos en múltiples archivos independientes.
  3. **Creación Exclusiva al Instalar y Prohibición Absoluta de Descarga desde GitHub**: `recursos_history.db` (junto con `-wal`, `-shm` y cualquier archivo local de persistencia/caché `*_dev.json`, `.vault` o `.db`) **se crea exclusivamente en local al instalarse o arrancarse el servidor web por primera vez**, nunca debe subirse ni descargarse desde GitHub ni incluirse en instaladores `.deb`/`.apk`, y permanece intacta frente a cualquier actualización OTA o reinstalación (`.gitignore`, `packaging/build_deb.sh` y el motor OTA de `server.py` garantizan su preservación).

## 9. Depuración Obligatoria del Código al Añadir Funciones y en Actualizaciones Mayores
- **Regla obligatoria**:
  1. **Saneamiento Obligatorio (`MINOR` y `MAJOR`)**: Tanto al **añadir cualquier nueva función** (`0.X.0`) como en **cada actualización mayor / rediseño** (`X.0.0`), es obligatorio ejecutar una depuración completa del código antes de dar la tarea por finalizada.
  2. **Criterios de Depuración y Verificación**:
     - Eliminar código muerto, variables/importaciones sin uso, ramas redundantes, claves huérfanas y cachés o ficheros temporales obsoletos.
     - Verificar compilación estricta sin advertencias ni símbolos sin usar (`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `python3 -m py_compile`, validación ESLint/reglas, integridad de `./i18n/dictionary.csv`, `npm run build`, empaquetado `.deb` y prueba en vivo de rutas HTTP).
     - Registrar explícitamente los resultados de la depuración en `./planes/walkthrough_v*.md`.

## 10. Mejores Prácticas de Análisis, Narrativa y Visualización de Datos (Estándar Zeus Vision + Ejemplos de Interfaz y Estética Alethia)
- **Regla obligatoria**: Toda vista, gráfica, tarjeta KPI, tabla o panel del ecosistema debe aplicar de forma estricta las mejores prácticas de análisis y visualización de datos (referencia *Zeus Vision — Mejores prácticas de visualización de datos y análisis*) y los patrones de sus ejemplos de interfaz integrados bajo la dirección visual *Alethia*:
  1. **Bloque de Análisis Previo — Selección del Gráfico Según la Historia del Dato**:
     - Nunca elegir una visualización solo por apariencia; asignar cada tipo de gráfico al dato que mejor representa (según los ejemplos de interfaz de referencia):
       - **Anillos / arcos radiales segmentados con cifra central y estado**: para porcentajes de uso, saturación, cuotas o tasas (CPU, RAM, GPU, ocupación de discos).
       - **Gráficas de área suavizada con línea discontinua de tendencia/media y picos anotados**: para series temporales en vivo e historial (`TelemetryChart`), permitiendo detectar de inmediato desviaciones sobre la media y picos máximos.
       - **Barras horizontales proporcionales con valor tabular alineado a la derecha**: para rankings y comparativas por origen (procesos por consumo, dispositivos por velocidad de descarga/carga, tráfico por interfaz).
       - **Micro-histogramas y barras apiladas por periodo con rejilla sutil**: para composición temporal y evolución de consumo sin ruido visual de líneas excesivas.
       - **Tablas analíticas compactas de alta legibilidad**: cabeceras sobrias, columnas alineadas, filas limpias y cifras `tabular-nums`.
  2. **Uso de Colores Efectivos, Semánticos y Simplificados (Ley del Contraste)**:
     - Mantener una paleta sobria y consistente que reduzca la carga cognitiva: neutrales minerales (`#F5F4F2` / `#FFFFFF`) en tema claro y obsidiana botánica (`#0A140B` / `#0F1F10` / `#122014`) en tema oscuro, reservando el acento protagonista lima botánico eléctrico (`#C6F19D` / `#1E6B38`) para el dato activo y las señales de foco.
     - Aplicar semántica inequívoca sin excesos cromáticos: verde/botánico para estado óptimo o positivo, ámbar para carga elevada o aviso, y rojo/coral exclusivamente para degradación o fallo crítico.
     - Garantizar siempre la **ley del contraste** entre cifras, ejes, etiquetas y fondos; prohibido usar colores chillones sin propósito comunicativo o rellenos recargados que dificulten leer los datos.
  3. **Narrativa Detrás de los Datos (*Data Storytelling*) y Despliegue por Capas (Alethia + Zeus)**:
     - Estructurar cada pantalla en **tres capas progresivas con ruta directa al dato**:
       1. *Capa 1 — Impacto ejecutivo y acceso directo*: cabecera de estado global con alternancia oscuro→claro, KPIs protagonistas con variación/estado comprensibles en 1 segundo y accesos clicables directos (dispositivos, velocidad global, alertas, detalle).
       2. *Capa 2 — Contexto temporal y tendencia*: módulos de telemetría equilibrados con línea de media/tendencia, píldora de pico directo y pie narrativo compacto (`Media · Pico · Actual`).
       3. *Capa 3 — Desglose técnico profundo*: tablas ordenables, listas de procesos, mapas y diagnósticos IA bajo demanda.
  4. **Principios de Diseño de la Gestalt**:
     - **Proximidad**: agrupar métricas relacionadas dentro de módulos y sub-bloques coherentes sin mezclar dominios.
     - **Semejanza**: emplear la misma anatomía de tarjeta, micro-etiquetas técnicas (`Geist Mono`), píldoras y barras para magnitudes equivalentes.
     - **Encierro y cierre**: delimitar bloques con bordes finos, radios consistentes y espacio negativo equilibrado que separe secciones sin saturar el lienzo.
  5. **Pilares de Visualización Efectiva en Pantalla**:
     - **Claridad**: lo simple funciona mejor; un golpe de vista debe responder si el sistema está sano, dónde está el cuello de botella y si exige acción.
     - **Legibilidad**: tipografía limpia (`Geist` + `Geist Mono` con `tabular-nums`), jerarquía marcada y cero fondos ruidosos detrás de textos o gráficas.
     - **Equilibrio**: distribución balanceada del espacio sin zonas sobrecargadas junto a áreas vacías ni decoraciones superfluas en ejes o etiquetas.
     - **Simplificación del color**: limitar el número de tonos simultáneos en pantalla para focalizar la atención en lo relevante.
     - **Transmisión del mensaje apropiado**: evitar ambigüedades mediante etiquetas directas en picos, comparativas actual/media y filtros discretos y consistentes.
