# Reglas y Pautas del Proyecto (Dashboard / Recursos)

## 1. Sincronización Previa Obligatoria (`git pull`)
- **Regla obligatoria**: Antes de comenzar a modificar cualquier archivo en el proyecto o responder a una solicitud de cambio, siempre se debe ejecutar primero `git pull origin main` en el directorio de trabajo del repositorio (`./`).
- **Objetivo**: Asegurar que cualquier cambio o commit realizado desde Google AI Studio en el móvil o GitHub se descargue e integre en el entorno local antes de tocar código, evitando conflictos o sobrescrituras.

## 2. Compatibilidad Universal de Rutas y Cero Hardcoding (Zero-Hardcoding)
- **Regla obligatoria**:
  1. **Rutas Relativas al Repositorio**: Todas las referencias a archivos del proyecto (`VERSION`, `planes/`, `static/`, scripts de DuckDNS o Caddy) deben resolverse mediante rutas relativas (`./` y `BASE_DIR`), evitando codificar o asumir rutas fijas del servidor físico (`/home/servidor/...`) que provoquen errores en contenedores de Google AI Studio o entornos cloud. Cuando sea necesario acceder a rutas locales del servidor físico, se debe verificar previamente su existencia con `os.path.exists()`.
  2. **Cero Nombres Fijos (Zero-Hardcoding)**: Queda terminantemente prohibido codificar valores estáticos, marcas, nombres de ciudades, ubicaciones o proveedores ("Mountain View", "Madrid", "Google", "AWS"). Toda etiqueta, ubicación o agrupación se calcula de forma 100% dinámica a partir de la telemetría en tiempo real (`remote_ip`, `city`, `country`, `isp`, `asn`).
  3. **Hardware Dinámico**: Sensores térmicos, núcleos CPU, discos, interfaces de red (NICs), particiones y GPUs deben detectarse e instanciarse dinámicamente mediante las APIs del sistema (`psutil`, `/sys`, `ip-api`), nunca con listas o arrays estáticos.
  4. **Agrupamientos Dinámicos**: Los grupos y clusters del mapa o tablas se computan dinámicamente según coordenadas o distancias en tiempo de ejecución.

## 3. Control de Versión Unificado y Criterio Estricto de Incremento (`VERSION`)
- **Regla obligatoria**:
  1. **Punto Único de Verdad**: La versión canónica de la aplicación reside exclusivamente en `./VERSION`. Queda estrictamente prohibido codificar versiones hardcodeadas en HTML, scripts o endpoints.
  2. **Sincronización Obligatoria de Archivos**: Al modificar `./VERSION`, se deben sincronizar inmediatamente con el mismo número:
     - `package.json` (`"version": "X.Y.Z"`)
     - `packaging/debian/control` (`Version: X.Y.Z`)
     - Backend (`server.py` vía `get_app_version()`, expuesto en `/api/metrics` y `/api/version`)
     - Frontend (`static/index.html` e `index.html`, reactivo a `/api/version`)
  3. **Identificación al Inicio**: Consultar la versión activa en `./VERSION` al iniciar cualquier tarea.
  4. **Criterio Estricto de Incremento (`MAJOR.MINOR.PATCH`)**:
     - **`X.0.0` (Rediseño Completo de la Aplicación)**: Se incrementa `MAJOR` **únicamente cuando se rediseña la aplicación completamente** (cambio integral de arquitectura visual, nuevo sistema de diseño global de toda la app o rediseño de pies a cabeza). Los otros dos números se restablecen obligatoriamente a 0 (ej: `4.9.1` -> `5.0.0`).
     - **`0.X.0` (Actualización Intermedia / Añadir, Quitar o Rediseñar una Función o Aspecto Concreto)**: Se incrementa `MINOR` **cuando se añade una nueva función, se retira una existente o se rediseña/ajusta un aspecto o función concreta de la interfaz** (ej: rediseño de un componente, formato cuadrícula/cápsulas, desplegables modulares). El tercer número se restablece a 0 (ej: `8.0.0` -> `8.1.0`).
     - **`0.0.X` (Actualización o Ajuste de Pequeños Detalles)**: Se incrementa `PATCH` **cuando se actualiza algo existente, se corrigen errores (bugfixes) o se ajustan pequeños detalles** (modificación de textos, reglas, ajustes de rendimiento o documentación sin alterar funciones completas ni el diseño general) (ej: `8.3.7` -> `8.3.8`).

## 4. Almacenamiento Obligatorio de Planes de Implementación y Walkthroughs (`planes/`)
- **Regla obligatoria**: Todos los planes de implementación (`implementation_plan.md`, `implementation_plan_v*.md`), archivos de recorrido y verificación (`walkthrough.md`, `walkthrough_v*.md`), bitácoras de trabajo y pruebas deben guardarse SIEMPRE en la carpeta `./planes/`. Jamás deben limitarse a directorios temporales de las IAs (`.gemini/antigravity/brain`).
- **Objetivo**: Garantizar que Google AI Studio, clientes móviles y Antigravity compartan permanentemente el contexto técnico exacto tras sincronizar con Git.

## 5. Actualización Obligatoria del README (`README.md`)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación, corrección, nueva funcionalidad, cambio de diseño, ajuste de reglas o incremento de versión, se debe actualizar de inmediato `./README.md` (badges de versión, banner y tabla de historial de cambios).

## 6. Compilación e Instalación Local Obligatoria de la App Nativa Linux (.deb)
- **Regla obligatoria**: Tras incrementar el número de versión en `./VERSION` y completar cualquier cambio:
  1. **Compilación Inmediata**: Compilar el paquete Debian canónico ejecutando:
     ```bash
     bash packaging/build_deb.sh
     ```
     Generando `dist/recursos-cockpit_${VERSION}_amd64.deb` y `dist/SHA256SUMS.txt`.
  2. **Instalación Local en el Servidor**: Instalar de inmediato en el sistema operativo local:
     ```bash
     sudo apt-get install -y ./dist/recursos-cockpit_${VERSION}_amd64.deb
     ```
  3. **Verificación de la Instalación**: Comprobar que `/usr/bin/recursos-cockpit` esté instalado y operativo ejecutando:
     ```bash
     /usr/bin/recursos-cockpit --test-mode
     ```
     Verificando con `dpkg -l | grep recursos-cockpit` que la versión instalada coincida exactamente con `./VERSION`.

## 7. Arquitectura Contractual de Aplicaciones Nativas (Linux & Android)
- **Regla obligatoria**: El diseño y desarrollo de cualquier aplicación cliente nativa (Linux/Ubuntu y Android) debe ajustarse de forma estricta y permanente a los siguientes principios:
  1. **Interfaces 100% Nativas Puras (Cero WebApps / Cero Navegadores)**:
     - Queda estrictamente prohibido utilizar WebViews embebidas (`WebKit`, `Chromium`, `Gecko`), frameworks híbridos basados en navegadores (`Electron`, `Tauri` web-view, `Cordova`, `Capacitor`) o convertir las apps nativas en clientes web camuflados.
     - En Linux, la interfaz se construye exclusivamente con widgets nativos GTK 3 / GTK 4 y aceleración gráfica vectorial por hardware con Cairo.
     - En Android, la interfaz se desarrolla en arquitectura nativa pura con Kotlin y Jetpack Compose.
     - Pantallas, tarjetas y gráficos son componentes nativos que consumen datos estructurados (JSON/binario) del backend.
  2. **Autodescubrimiento y Enlace en Red Local (Wi-Fi / LAN)**:
     - Al conectarse a la red Wi-Fi o LAN local, las apps nativas implementan autodescubrimiento dinámico (mDNS/Zeroconf `_recursos._tcp`, SSDP o escaneo de subred) para localizar automáticamente el servidor sin introducir IPs manuales.
     - Descubierto el nodo, se inicia el protocolo de enlace (*pairing handshake*) para vincular el dispositivo.
  3. **Autenticación, Criptografía y Consumo Seguro de APIs**:
     - Las apps nativas se certifican con el sistema de tokens/certificados criptográficos del servidor.
     - Durante el enlace, el servidor emite una credencial/token firmado que la app almacena en el gestor seguro del sistema (Secret Service / Keyring en Linux, Android KeyStore / EncryptedSharedPreferences en Android).
     - Toda comunicación viaja 100% cifrada bajo TLS/HTTPS con verificación mutua de identidad mediante endpoints REST y WebSockets autenticados, con cero exposición de credenciales en texto plano.
  4. **Acceso Dual Transparente y Conexión Automática (LAN / WAN Exterior)**:
     - **Conexión Inmediata al Abrir**: La app nativa se conecta instantánea y automáticamente al nodo enlazado sin solicitar credenciales repetitivas.
     - **Conmutación Inteligente LAN ↔ WAN**:
       - *En Red Local (Wi-Fi/LAN)*: Comunicación directa con la IP/puerto local a latencia mínima.
       - *Desde el Exterior (Red Móvil / Internet / WAN)*: Conmutación automática hacia el nodo público / DDNS (`cminewar.duckdns.org` o dominio configurado) utilizando la credencial criptográfica del emparejamiento.
  5. **Paridad Visual de Interfaz y Desbloqueo Exclusivo de DeX en Ubuntu**:
     - **Paridad Estética y Estructural Absoluta**: Todas las interfaces (web y nativas) comparten la misma identidad visual, filosofía de diseño (*Apple Liquid Glass + Tesla Touch Cockpit*), paleta de colores, tarjetas, gráficos vectoriales a 60 FPS e iconografía.
     - **Diferenciación Funcional Contractual (Desbloqueo de DeX)**:
       - *App Nativa de Ubuntu*: Al disponer de acceso directo a `/dev/uhid`, `scrcpy` y el subsistema USB, desbloquea dinámicamente el submenú de control DeX / Modo Escritorio Android con todos sus controles de resolución, tasa de refresco (60 FPS), auto-conexión y modo pantalla completa.
       - *Versión Web y Clientes Externos*: Todo submenú de DeX permanece estrictamente bloqueado y oculto, mostrando únicamente el mensaje pasivo: *"Esperando dispositivo para conectarse en su versión nativa"*.

## 8. Principio de Simetría Total, Homogeneidad y Cohesión en Interfaces y Submenús (Web, Linux/Ubuntu y Android)
- **Regla obligatoria**:
  1. **Simetría y Homogeneidad Estricta en Todas las Interfaces**: Todos los componentes, vistas, tarjetas Bento, barras de herramientas, HUDs, paneles flotantes, modales y submenús (incluida la interfaz del mapa geoespacial, el catálogo de servicios, los selectores de subredes, gráficos y tablas) deben mantener una simetría visual y estructural rigurosa, limpia y equilibrada en cualquier resolución o factor de forma.
  2. **Ecosistema Homogéneo Universal**: La experiencia visual entre la aplicación web y las aplicaciones nativas de Ubuntu (GTK 3/Cairo) y Android (Jetpack Compose) debe sentirse 100% homogénea y coherente, compartiendo idénticos principios de espaciado simétrico, radios de curvatura, tratamiento de cristal (*Apple Liquid Glass*), contraste, tipografía monoespaciada tabular y ergonomía táctil (*Tesla Touch Cockpit*).
  3. **Simetría Contractual en Nuevas Funcionalidades**: Cualquier elemento, control, submenú o vista que se incorpore a futuro debe ceñirse sin excepción a esta simetría y homogeneidad, evitando componentes desalineados, estilos visuales dispares o menús secundarios asimétricos.

## 9. Publicación Automática en GitHub (`git push`)
- **Regla obligatoria**: Al finalizar cualquier modificación, tras compilar e instalar el paquete local y actualizar `README.md` y `planes/`, se deben confirmar los cambios con un commit semántico claro y ejecutar:
  ```bash
  git push origin main --tags
  ```
  - Repositorio remoto: `https://github.com/cminewarIA/recursos-ui`
  - Rama: `main`
- **Objetivo**: Mantener permanentemente sincronizado el proyecto para que los cambios se reflejen de inmediato en Google AI Studio y el móvil al pulsar *Pull Changes*.
