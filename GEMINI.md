# Reglas y Pautas del Proyecto (Dashboard / Recursos)

## 1. Portabilidad, Cero Hardcoding y Telemetría Dinámica
1. **Rutas Relativas al Repositorio**: Resolver toda referencia interna (`VERSION`, `planes/`, `static/`, scripts de DuckDNS o Caddy) mediante `./` y `BASE_DIR`, sin codificar rutas fijas del servidor físico (`/home/servidor/...`). Cualquier acceso a rutas locales del host debe comprobar previamente `os.path.exists()`.
2. **Cero Valores Fijos (Zero-Hardcoding)**: Prohibido codificar marcas, nombres de ciudades, ubicaciones, proveedores ("Mountain View", "Madrid", "Google", "AWS"), IPs ni dominios WAN/LAN del autor en código, plantillas o instaladores.
3. **Hardware y Agrupamientos Dinámicos**: Sensores térmicos, núcleos CPU, discos, particiones, NICs, GPUs, ubicaciones GeoIP y clusters de mapas/tablas deben detectarse y calcularse en tiempo de ejecución mediante APIs del sistema (`psutil`, `/sys`, `ip-api`), nunca con listas estáticas.

## 2. Persistencia Local Unificada y Privacidad (`recursos_history.db`)
1. **Historial Universal en Base Única (`SQLite WAL`)**: Todas las series y registros captados —velocidad WAN/LAN, tests `Speedtest.net`, hardware (CPU, GPU, RAM, E/S y procesos), latencia ping, conexiones GeoIP/DNS e identificaciones/diagnósticos IA— se persisten en una única base compartida (`recursos_history.db`) y deben ser consultables desde sus vistas y modales.
2. **Creación Exclusivamente Local y Exclusión de GitHub**: `recursos_history.db` (junto con `-wal`, `-shm`, `*_dev.json`, `.vault` y cualquier `.db` o caché local) se crea únicamente al instalar o arrancar el servidor web; nunca se sube ni descarga desde GitHub ni se empaqueta en `.deb`/`.apk`, y debe permanecer intacta ante actualizaciones OTA o reinstalaciones (`.gitignore`, `packaging/build_deb.sh` y motor OTA de `server.py`).

## 3. Diseño Visual, Coherencia Funcional y Visualización de Datos (*Alethia × Zeus Vision*)
1. **Coherencia por Dominio y Ubicación Lógica**: Cada módulo, gráfica, tabla o control reside únicamente en su apartado natural (`/inicio`, `/equipo`, `/red`, `/programas`, `/mas`) sin redundancias entre vistas. Antes de añadir cualquier función nueva, analizar y justificar su ubicación en `./planes/`.
2. **Escalado Fluido Universal**: Cabeceras, pestañas, rejillas Bento, tarjetas, gráficas, mapas, tablas y modales deben adaptarse al ancho y alto de cualquier viewport (`auto-fit`/`minmax`, `clamp()`, alturas fluidas, `min-width: 0` y `ResizeObserver`), sin tamaños fijos que recorten u oculten contenido.
3. **Identidad Alethia y Paridad Multiplataforma**: Web, Ubuntu (`GTK 3 + WebKit2`), Android/TV (`Jetpack Compose + WebView`) y Manual comparten la misma identidad visual: tipografía `Geist` + `Geist Mono` (`tabular-nums`), neutrales minerales (`#F5F4F2` / `#FFFFFF`) en claro, obsidiana botánica (`#0A140B` / `#0F1F10` / `#122014`) en oscuro, acento lima eléctrico (`#C6F19D` / `#1E6B38`), espaciado simétrico y física elástica uniforme.
4. **Selección del Gráfico Según el Dato (Zeus Vision)**: Elegir cada visualización por la historia del dato, nunca solo por estética:
   - *Anillos/arcos radiales segmentados con cifra central y estado*: porcentajes, saturación o cuotas (CPU, RAM, GPU, ocupación de discos).
   - *Área suavizada con línea discontinua de media/tendencia y píldora directa de pico*: series temporales en vivo e historial (`TelemetryChart`).
   - *Barras horizontales proporcionales con cifra tabular alineada a la derecha*: rankings y comparativas (procesos, dispositivos por caudal, tráfico por interfaz).
   - *Micro-histogramas y barras apiladas con rejilla discreta*: composición y densidad temporal sin saturación de líneas.
   - *Tablas analíticas compactas*: cabeceras sobrias, columnas alineadas y cifras `tabular-nums`.
5. **Narrativa en 3 Capas, Gestalt y Pilares Visuales**:
   - *Despliegue en 3 capas*: (1) Hero ejecutivo oscuro→claro con KPIs comprensibles en 1 s y ruta directa al dato (dispositivos, velocidad global, alertas); (2) contexto temporal con línea de media, pico anotado y resumen `Media · Pico · Actual`; (3) desglose técnico bajo demanda.
   - *Gestalt y pilares*: aplicar **proximidad**, **semejanza** y **encierro limpio** junto con **claridad**, **legibilidad** (cero fondos ruidosos tras datos o gráficas), **equilibrio espacial**, **simplificación cromática con ley del contraste** (verde/botánico óptimo, ámbar alerta/carga elevada, rojo/coral fallo crítico; cero colores chillones sin significado) y **mensaje sin ambigüedad**.

## 4. Internacionalización Centralizada y OTA (`./i18n/dictionary.csv`)
1. **Diccionario Único Tabular**: Todo texto visible en Web (`src/`), Manual (`static/manual.html` / `docs/index.html`), Backend (`server.py`), Ubuntu (`desktop_app/recursos_app.py`) y Android/TV (`android_app/`) debe resolverse desde `./i18n/dictionary.csv` (`key,context,es,...`, filas `__locale_name__` y `__default_locale__`), sin literales de interfaz dispersos.
2. **Extensibilidad Automática y OTA desde GitHub**: Todos los analizadores (`i18n_catalog.py`, `src/i18n/csvParser.ts`, `vite.config.ts`, `manual.html` y `I18nDictionary.kt`) autodetectan nuevas columnas de idioma (`,` o `;`, UTF-8 con/sin BOM) y sincronizan el CSV vía OTA (`raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv`) con fallback offline, sin tocar código ni incrementar `./VERSION` al añadir o corregir traducciones.
3. **Lecturas de Hardware Traducibles**: Los nombres propios del SO (modelo CPU/GPU, hostname, montaje, NIC, cmdline) permanecen dinámicos, pero toda clasificación, estado térmico/energético/montaje, transporte (`NVMe`, `SATA`, `USB`, `SD/MMC`, `NAS`), banda de red, rol de proceso, estado multimedia/systemd, unidad y formato temporal usa claves `*_key` traducidas mediante el diccionario.
4. **Registro y Empaquetado Obligatorios**: Toda nueva pantalla, métrica, alerta o control registra su `key`, `context` y traducciones en `./i18n/dictionary.csv`, empaquetado automáticamente en web, `.deb` y `.apk`.

## 5. Arquitectura Contractual de Aplicaciones Nativas (Ubuntu y Android/TV)
1. **Motor HTML5 Unificado + Puente Nativo**: Ubuntu (`.deb`, GTK 3 + `WebKit2`) y Android/TV (`.apk`, Kotlin/Jetpack Compose + `WebView`) renderizan directamente la interfaz canónica HTML5/CSS3/D3/Leaflet y delegan al puente nativo autodescubrimiento, credenciales, conmutación LAN↔WAN y periféricos locales.
2. **Autodescubrimiento, Criptografía y Conmutación LAN ↔ WAN**: Detección automática en red local (mDNS/Zeroconf `_recursos._tcp`, SSDP o escaneo de subred), enlace (*pairing handshake*) con credencial firmada almacenada en Keyring (Linux) o Android KeyStore/`EncryptedSharedPreferences` e inyectada como `X-Device-Token`/`Bearer`. Conexión inmediata al abrir con tráfico cifrado TLS/HTTPS en WAN y conmutación automática entre IP LAN y el dominio/DDNS propio del usuario (aprendido en LAN o configurado manualmente).
3. **Desbloqueo Exclusivo de DeX en Ubuntu**: La app nativa de Ubuntu desbloquea `/dex` gracias al acceso directo a `/dev/uhid`, `scrcpy` y USB (resolución, 60 FPS, auto-conexión, pantalla completa). En Web y clientes externos (incluido Android) permanece bloqueado y oculto, mostrando únicamente si se consulta: *"Esperando dispositivo para conectarse en su versión nativa"*.

## 6. Control de Versión Unificado (`./VERSION`) y Pre-Sincronización
1. **Fuente Única y Llamada Única por Capa**: La versión reside exclusivamente en `./VERSION`; prohibido escribir versiones literales en código, HTML, README o SVG (`package.json` y `packaging/debian/control` mantienen `0.0.0`). Cada capa la resuelve dinámicamente: `get_canonical_version()`/`get_app_version()` (Python/Ubuntu), `getCanonicalVersion()`/`__APP_VERSION__` (React/Vite), `resolveCanonicalVersion()` (Manual), `build_deb.sh`/`build_apk.sh`/`build.gradle.kts` (instaladores) y badges dinámicos + `releases/latest` (README).
2. **Pre-Sincronización con GitHub**: Consultar `./VERSION` y comprobar `git fetch origin`, `git rev-list --left-right --count origin/main...HEAD` y `git status --short` antes de modificar código o versionar, integrando pendientes si los hubiera para evitar colisiones.
3. **Criterio Estricto de Incremento (`MAJOR.MINOR.PATCH`)**:
   - **`X.0.0` (`MAJOR`)**: rediseño completo global de toda la aplicación (restablece `MINOR` y `PATCH` a `0`).
   - **`0.X.0` (`MINOR`)**: añadir, retirar o rediseñar una función o aspecto concreto (restablece `PATCH` a `0`).
   - **`0.0.X` (`PATCH`)**: bugfixes, ajustes de detalle, rendimiento, textos, reglas o documentación.
   - *Excepción*: modificar únicamente traducciones en `./i18n/dictionary.csv` no incrementa `./VERSION`.

## 7. Depuración y Verificación Obligatoria (`MINOR` y `MAJOR`)
1. **Saneamiento Completo**: Al añadir funciones (`0.X.0`) o realizar rediseños mayores (`X.0.0`), eliminar código muerto, variables/imports sin uso, ramas redundantes, claves huérfanas y temporales obsoletos antes de cerrar la tarea.
2. **Verificación Estricta**: Comprobar sin errores `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `python3 -m py_compile`, ESLint/reglas, integridad de `./i18n/dictionary.csv`, `npm run build`, empaquetado `.deb` y prueba HTTP en vivo, documentando los resultados en `./planes/walkthrough_v*.md`.

## 8. Trazabilidad en `./planes/` y Sincronización de `./README.md`
1. **Planes y Walkthroughs en `./planes/`**: Guardar siempre todos los planes (`implementation_plan_v*.md`), verificaciones (`walkthrough_v*.md`) y bitácoras en `./planes/` (nunca solo en directorios temporales de IA) para preservar el contexto compartido vía Git.
2. **Sincronización de `./README.md`**: Actualizar `./README.md` ante cualquier cambio funcional, de diseño, de reglas o de versión, evitando listar versiones anteriores salvo para explicar diferencias relevantes de arquitectura.
