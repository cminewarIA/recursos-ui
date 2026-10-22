# Reglas y Pautas del Proyecto (Dashboard / Recursos)

## 1. Sincronización Previa Obligatoria (git pull)
- **Regla obligatoria**: Antes de comenzar a modificar cualquier archivo en el proyecto o responder a una solicitud de cambio, siempre se debe ejecutar primero `git pull origin main` en el directorio de trabajo del repositorio (en el servidor local: `/home/servidor/servicios/dashboard`, o en la raíz de trabajo `./` según esté catalogado en GitHub o en el simulador de Google AI Studio).
- **Objetivo**: Asegurar que cualquier cambio, commit o trabajo realizado desde Google AI Studio en el móvil se descargue e integre en el servidor local antes de tocar código, evitando conflictos de versión o sobrescrituras.

## 2. Publicación Automática en GitHub (git push)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación en los archivos de la web o backend del dashboard (`index.html`, `static/index.html`, `server.py`, configuración, etc.), se deben confirmar los cambios con un commit claro y hacer `git push` automáticamente al repositorio de GitHub:
  - Repositorio remoto: `https://github.com/cminewarIA/recursos-ui`
  - Rama: `main`
- **Objetivo**: Mantener permanentemente sincronizado el proyecto para que los cambios se reflejen de inmediato en Google AI Studio y el móvil al pulsar *Pull Changes*.

## 3. Almacenamiento Obligatorio de Planes de Implementación y Walkthroughs (`planes/`)
- **Regla obligatoria**: Todos los planes de implementación (`implementation_plan.md`), archivos de recorrido y verificación (`walkthrough.md`, `walkthrough_*.md`), bitácoras de trabajo, pruebas realizadas y documentación de avance deben guardarse SIEMPRE dentro de la carpeta `planes/` del proyecto (`./planes/` o `/home/servidor/servicios/dashboard/planes/`). Jamás deben quedar limitados únicamente a carpetas internas temporales de las IA (`.gemini/antigravity/brain`).
- **Objetivo**: Asegurar que tanto Google AI Studio en el móvil como Antigravity compartan siempre el contexto exacto de en qué se ha estado trabajando, qué se ha probado y cómo se ha implementado, pudiendo consultarlo tras sincronizar (`git pull`).

## 4. Actualización Obligatoria del README (`README.md`)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación, corrección, nueva funcionalidad, cambio de diseño o ajuste arquitectónico en el proyecto, se debe actualizar inmediatamente el archivo `README.md` (`./README.md`) con la descripción de los cambios y el estado actual del sistema.
- **Objetivo**: Garantizar que la documentación del repositorio refleje fielmente en todo momento las características, estructura de directorios, endpoints y funcionamiento real del proyecto tanto en GitHub como en Google AI Studio.

## 5. Control de Versión Unificado y Criterio Estricto de Incremento (`VERSION`)
- **Regla obligatoria**: 
  1. **Punto Único de Verdad**: La versión de la aplicación se define en un único archivo canónico: `./VERSION` (o `/home/servidor/servicios/dashboard/VERSION` en el servidor local). Queda estrictamente prohibido codificar números de versión estáticos o hardcodeados en HTML, scripts o endpoints.
  2. **Consumo Centralizado**:
     - El backend (`server.py`) lee este archivo a través de la función `get_app_version()` y lo expone a través de `/api/metrics` y `/api/version`.
     - El frontend (`static/index.html` e `index.html`) actualiza de forma reactiva todos los elementos visuales (sidebar, cabecera, tarjeta de vista general y vista `/version`) consumiendo el dato centralizado.
     - El archivo `package.json` (`./package.json`) debe mantenerse permanentemente sincronizado con la misma versión.
  3. **Identificación al Inicio**: Al comenzar cualquier tarea, se debe consultar e identificar la versión activa en `VERSION`.
  4. **Criterio Estricto para Subir Versiones (`MAJOR.MINOR.PATCH`)**:
     Al concluir las modificaciones y antes de confirmar el commit y hacer `git push`, se debe incrementar el número de versión según los siguientes criterios específicos definidos por el usuario:
     - **`X.0.0` (Rediseño Completo de la Aplicación)**: Se incrementa el primer número (`MAJOR`) **únicamente cuando se rediseña la aplicación completamente** (cambio integral de arquitectura visual, nuevo sistema de diseño global de toda la app o rediseño de pies a cabeza). **Los otros dos números se restablecen obligatoriamente a 0** (ejemplo: de `4.9.1` pasa a `5.0.0`).
     - **`0.X.0` (Actualización Intermedia / Añadir, Quitar o Rediseñar una Función o Aspecto Concreto de la Interfaz)**: Se incrementa el segundo número (`MINOR`) **cuando se añade una nueva función, se retira una existente o se rediseña/ajusta un aspecto o función en concreto de la interfaz** (por ejemplo: rediseño de cómo se muestra un componente, paso a formato de cuadrícula/cápsulas, desplegables de grupo o nuevas capacidades modulares). El tercer número se restablece obligatoriamente a 0 (ejemplo: de `8.0.0` pasa a `8.1.0`).
     - **`0.0.X` (Actualización o Ajuste de Pequeños Detalles)**: Se incrementa el tercer número (`PATCH`) **cuando se actualiza algo existente, se corrigen errores (bugfixes) o se ajustan pequeños detalles** (modificación de textos, reglas, ajustes de rendimiento o documentación sin alterar funciones completas ni el diseño general) (ejemplo: de `8.1.0` pasa a `8.1.1`).

## 6. Compatibilidad de Rutas con Simulador de Google AI Studio y GitHub
- **Regla obligatoria**:
  1. **Evitar Forzar el Montaje de `/home/servidor` en Simuladores**: En Google AI Studio y entornos cloud/móvil, el repositorio se clona directamente en su propio contenedor (habitualmente `./` o `/workspace/recursos-ui`). Queda prohibido asumir como única opción la ruta absoluta del servidor físico (`/home/servidor/...`), ya que esto provoca que el simulador de Google AI Studio intente montar carpetas inexistentes o devuelva errores de archivo no encontrado.
  2. **Rutas Candidatas Relativas**: En el código y scripts, las referencias a archivos del proyecto (`VERSION`, `planes/`, `static/`, scripts de DuckDNS o Caddy) deben contemplar siempre como primera opción las rutas relativas al repositorio (`./` y `BASE_DIR`), y como opción alternativa las rutas locales del servidor físico (`/home/servidor/...`), comprobando siempre su existencia previa con `os.path.exists()` o `os.path.isfile()` antes de abrirlos.

## 7. Principio Estricto de Cero Hardcoding (Zero-Hardcoding)
- **Regla obligatoria**: Queda terminantemente prohibido codificar valores estáticos, textos fijos o suposiciones cableadas en el código fuente (HTML, JavaScript, Python o plantillas).
  1. **Nombres de ubicación, ciudades, marcas o proveedores**: Jamás codificar nombres fijos como "Mountain View", "Madrid", "Google", "AWS", o similares en lógica condicional o agrupamientos. Todos los nombres, etiquetas y resúmenes deben derivarse y calcularse de manera 100% dinámica a partir de la telemetría en tiempo real recibida (`remote_ip`, `city`, `country`, `isp`, `asn`).
  2. **Hardware e interfaces**: El número de núcleos, sensores térmicos, discos, interfaces de red (NICs), particiones y GPUs deben detectarse y renderizarse siempre de forma dinámica mediante las APIs del sistema o backend (`psutil`, `/sys`, `ip-api`), nunca con arrays o listas estáticas precodificadas.
  3. **Identificadores y agrupamientos**: Los grupos y clusters del mapa o tablas deben computarse en tiempo de ejecución en base a coordenadas reales o distancias relativas de pantalla, nunca mediante cadenas fijas preasignadas.
- **Objetivo**: Asegurar que la aplicación sea universal, adaptable a cualquier infraestructura o red sin código muerto ni asunciones artificiales.

## 8. Compilación e Instalación Local Obligatoria de la App Nativa Linux (.deb)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación o actualización en la aplicación (frontend web, backend, configuración, empaquetado o reglas) y se incremente el número de versión canónica en `./VERSION`:
  1. **Compilación Inmediata del Paquete**: Se debe compilar obligatoriamente el paquete Debian canónico ejecutando `bash packaging/build_deb.sh`, generando `dist/recursos-cockpit_${VERSION}_amd64.deb` y el archivo de sumas criptográficas `dist/SHA256SUMS.txt`.
  2. **Instalación Local en el Servidor**: Se debe instalar inmediatamente en el sistema operativo del servidor físico local mediante:
     ```bash
     sudo apt-get install -y ./dist/recursos-cockpit_${VERSION}_amd64.deb
     ```
  3. **Verificación de la Instalación**: Se debe comprobar que `/usr/bin/recursos-cockpit` esté instalado y operativo ejecutando `/usr/bin/recursos-cockpit --test-mode`, asegurando que `dpkg -l | grep recursos-cockpit` refleje exactamente la misma versión canónica activa de `./VERSION`.
- **Objetivo**: Garantizar que el servidor local mantenga instalada y sincronizada de forma permanente la versión más reciente de la aplicación nativa de escritorio GTK3, sin desfases entre la versión web, los endpoints y el ejecutable del sistema.

## 9. Arquitectura Contractual de Aplicaciones Nativas (Linux & Android)
- **Regla obligatoria**: El diseño, desarrollo y evolución de cualquier aplicación cliente nativa del ecosistema (tanto para Linux/Ubuntu/Debian como para Android) debe ajustarse de forma estricta y permanente a los siguientes principios fundamentales:
  1. **Interfaces 100% Nativas Puras (Cero WebApps / Cero Navegadores)**:
     - Queda estrictamente prohibido utilizar WebViews embebidas (`WebKit`, `Chromium`, `Gecko`), frameworks híbridos basados en navegadores (`Electron`, `Tauri` web-view, `Cordova`, `Capacitor`) o convertir las aplicaciones nativas en clientes web camuflados.
     - En Linux, la interfaz debe construirse exclusivamente con widgets y componentes nativos de GTK 3 / GTK 4 y renderizado gráfico vectorial por aceleración de hardware con Cairo.
     - En Android, la interfaz debe desarrollarse en arquitectura nativa pura (Kotlin con Jetpack Compose o SDK nativo de Android).
     - Las pantallas, tarjetas, listas, tablas y gráficos son componentes nativos del sistema que únicamente solicitan datos estructurados (JSON/binario) al backend y los presentan en sus propios campos visuales.
  2. **Autodescubrimiento y Enlace en Red Local (Wi-Fi / LAN)**:
     - Al conectarse a la red Wi-Fi o red de área local, las aplicaciones nativas deben implementar autodescubrimiento dinámico (mDNS/Zeroconf `_recursos._tcp`, SSDP o escaneo de subred local) para localizar de manera automática el servidor web del dashboard sin que el usuario tenga que introducir IPs manuales.
     - Una vez descubierto el servidor, la aplicación inicia un protocolo de enlace (pairing handshake) para vincular el dispositivo con el nodo.
  3. **Certificación y Criptografía de Dispositivo**:
     - Las aplicaciones nativas deben certificarse utilizando el sistema de certificados/tokens criptográficos seguros del servidor web.
     - Durante el enlace, el servidor emite una certificación/token criptográfico firmado que la app almacena de forma segura en el gestor de credenciales del sistema (Secret Service / Keyring en Linux, Android KeyStore / EncryptedSharedPreferences en Android).
     - Toda la comunicación con el servidor viaja 100% cifrada bajo TLS/HTTPS con verificación mutua de identidad.
  4. **Acceso Dual Transparente y Conexión Automática (LAN / Exterior WAN)**:
     - **Conexión Inmediata al Abrir**: Al abrir la aplicación nativa, esta debe conectarse de forma automática e instantánea al nodo servidor enlazado, sin solicitar credenciales repetitivas al usuario.
     - **Conmutación Inteligente LAN ↔ WAN**:
       - *En Red Local (Wi-Fi/LAN)*: La app se comunica directamente con la IP y puerto local del nodo a latencia mínima.
       - *Desde el Exterior (Red Móvil / Internet / WAN)*: Al detectar que no se encuentra en la red local, la app conmuta automáticamente su enlace hacia el nodo público / DDNS (`cminewar.duckdns.org` o dominio configurado) empleando la certificación criptográfica otorgada en el emparejamiento.
  5. **Consumo Seguro de la Base de Datos y APIs Backend**:
     - Las apps nativas interactúan con el backend mediante endpoints REST y sockets seguros autenticados, transmitiendo exclusivamente la telemetría, métricas y controles solicitados de manera cifrada, garantizando cero exposición de secretos o credenciales en texto plano.
  6. **Paridad Visual de Interfaz y Desbloqueo Exclusivo del Submenú DeX en la App de Ubuntu**:
     - **Paridad Estética y Estructural Absoluta**: Todas las interfaces (web y aplicaciones nativas) deben compartir la misma identidad visual, filosofía de diseño (Apple Liquid Glass + Tesla Touch Cockpit), paleta de colores, tarjetas, gráficos vectoriales e iconografía. La experiencia de usuario debe sentirse visualmente idéntica en disposición y elegancia.
     - **Diferenciación Funcional Contractual (Desbloqueo de DeX)**: La única diferencia visual y funcional permitida entre la interfaz web y la aplicación nativa de Ubuntu radica en que **desde la app de Ubuntu se desbloquea el submenú de DeX / proyección por hardware**. En la versión web (y clientes que no dispongan de privilegios de hardware/kernel), el submenú de DeX permanece estrictamente bloqueado/oculto, mostrando únicamente el mensaje pasivo *"Esperando dispositivo para conectarse en su versión nativa"*. Desde la app nativa de Ubuntu, al contar con acceso directo a `/dev/uhid`, `scrcpy` y el subsistema USB, el submenú interactivo de DeX se desbloquea con todos sus controles de resolución, tasa de refresco (60 FPS), auto-conexión y modo pantalla completa.
- **Objetivo**: Asegurar un ecosistema de aplicaciones nativas de máximo rendimiento, ultra fluidas a 60 FPS, con conectividad ubicua y seguridad de nivel empresarial, sin depender de navegadores web embebidos.



