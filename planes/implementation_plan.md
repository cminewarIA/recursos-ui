# Plan de Implementación v8.5.0: Paridad Total de Interfaz, Autodescubrimiento de Red y Persistencia Criptográfica (Android & Ubuntu)

## Objetivo
Cumplir estrictamente con la solicitud del usuario y las directrices maestras de [`GEMINI.md`](file:///home/servidor/servicios/dashboard/GEMINI.md):
1. **App Android (`android_app`)**:
   - **Sincronización Automática con Escaneo de Red**: Escaneo dinámico autónomo de la subred local (Wi-Fi/LAN) al abrir la app para localizar el servidor en el puerto 8085 sin solicitar IPs manuales al usuario.
   - **Paridad Visual y de Características con el Servidor**: Interfaz nativa completa en Jetpack Compose con todas las pestañas y vistas del servidor web (Cockpit Resumen, CPU con desglose de núcleos y GHz, Memoria con ZRAM y buffers, Discos, Red con caudal RX/TX e interfaces, Seguridad/Fail2ban IPS, Contenedores Docker y Tabla de Procesos).
   - **Modo DeX Estrictamente Desactivado**: Ausente de toda la navegación de Android.
   - **Persistencia de Certificado Zero-Trust**: Al conectarse por primera vez en LAN, el servidor expide el token HMAC-SHA256 (`auth_status.token`), el cliente lo almacena en `EncryptedSharedPreferences` y lo mantiene de forma permanente (tanto en LAN como en WAN) hasta que sea revocado por el servidor (HTTP 403 / `locked`).
2. **App de Ubuntu (`desktop_app/recursos_app.py`)**:
   - **Misma Interfaz y Características**: Interfaz nativa completa GTK3 + Cairo con todas las tarjetas de silicio, telemetría del servidor, procesos, Docker, seguridad e interfaces de red.
   - **Primera Autoconexión con Escaneo de Red**: Al arrancar, sondea automáticamente el servidor local en la red (o WAN como respaldo), se enlaza y persiste su certificado en `~/.config/recursos-cockpit/client_config.json`.
   - **Persistencia y Control de Revocación**: Mantiene la conexión automática de forma permanente hasta que el certificado sea revocado en el servidor.
   - **Desbloqueo Exclusivo de DeX**: Mantiene operativo el submenú de proyección por hardware USB (Scrcpy / UHID).

---

## Cambios Propuestos

### Componente 1: App Nativa Android (`android_app/`)

#### [MODIFY] [`DiscoveryManager.kt`](file:///home/servidor/servicios/dashboard/android_app/app/src/main/java/com/cminewar/recursoscockpit/data/DiscoveryManager.kt)
- Implementar escaneo de subred local dinámico en segundo plano (corutinas paralelas con timeout ágil de 250ms).
- Detección dinámica de subred local desde interfaces de red activas (cero IPs hardcodeadas).
- Sonda a `/api/version` y `/api/metrics` con cabeceras `X-Device-Token` y `Authorization: Bearer`.
- Conmutación inteligente a WAN (`recursos.cminewar.duckdns.org`) si la red local no está disponible.
- Detección explícita de revocación de certificado (HTTP 403 ➔ `ConnectionMode.REVOKED`).

#### [MODIFY] [`ApiService.kt`](file:///home/servidor/servicios/dashboard/android_app/app/src/main/java/com/cminewar/recursoscockpit/data/ApiService.kt)
- Captura automática de `auth_status.token` retornado por el servidor y almacenamiento en `SecurePreferences`.
- Gestión de excepciones para certificados revocados.

#### [MODIFY] [`Models.kt`](file:///home/servidor/servicios/dashboard/android_app/app/src/main/java/com/cminewar/recursoscockpit/data/Models.kt)
- Modelar todas las estructuras completas del servidor: `GpuData`, `ProcessItem`, `DockerContainerItem`, `Fail2banData`, `AuthStatusData`.
- Añadir estado `REVOKED` al enum `ConnectionMode`.

#### [MODIFY] [`CockpitDashboard.kt`](file:///home/servidor/servicios/dashboard/android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt)
- Incorporar sistema de navegación de pestañas paritario con el servidor (Material 3 NavigationBar / NavigationRail en tablets):
  - 🏠 **Cockpit** (Resumen general Bento Grid)
  - 🧠 **CPU** (Detalle de núcleos, frecuencias GHz, carga y temperaturas)
  - 💾 **Memoria** (RAM, Swap, ZRAM, buffers y caché)
  - 💿 **Discos** (Particiones del servidor, I/O y espacio libre/usado)
  - 🌐 **Red** (Caudal en vivo RX/TX, interfaces activas)
  - 🛡️ **Seguridad** (Fail2ban, IPs bloqueadas, estado IPS)
  - 🐳 **Docker** (Contenedores en ejecución, consumo de CPU y RAM)
  - ⚙️ **Procesos** (Tabla de procesos del kernel)
- Banner de estado superior con indicación clara: `🟢 LAN (<1ms)`, `🌐 WAN (Cifrado TLS)`, `📡 ESCANEANDO RED...` o `🔒 CERTIFICADO REVOCADO`.
- Modo DeX estrictamente desactivado (cero elementos de proyección USB en Android).

---

### Componente 2: App Nativa Linux / Ubuntu (`desktop_app/`)

#### [MODIFY] [`recursos_app.py`](file:///home/servidor/servicios/dashboard/desktop_app/recursos_app.py)
- Incorporar cliente de red HTTP nativo en segundo plano (`ServerConnectionManager`):
  - Autodescubrimiento en red local escaneando subred y candidatos comunes en puerto 8085.
  - Almacenamiento seguro del certificado/token emitido por el servidor en `~/.config/recursos-cockpit/client_config.json`.
  - Envío automático de cabeceras `Authorization: Bearer <token>` y `X-Device-Token`.
  - Detección de revocación de certificado (HTTP 403) con advertencia visual en el HeaderBar.
  - Sincronización continua de métricas remotas con `/api/metrics` y fallback a `psutil` si no hay conectividad.
- Ampliación de la interfaz GTK3 para paridad completa con el servidor:
  - Pestañas completas en `Gtk.Stack`: Cockpit/Silicio, CPU/Memoria, Red/Seguridad, Docker/Apps, Procesos, y **Conexión USB / Samsung DeX (desbloqueado exclusivamente en Ubuntu)**.
  - Indicador de estado de conexión en tiempo real en el HeaderBar (LAN, WAN, Revocado, Local).

---

### Componente 3: Versionado Canónico v8.5.0, Compilación y Publicación

#### [MODIFY] [`VERSION`](file:///home/servidor/servicios/dashboard/VERSION), [`package.json`](file:///home/servidor/servicios/dashboard/package.json), [`packaging/debian/control`](file:///home/servidor/servicios/dashboard/packaging/debian/control), [`build.gradle.kts`](file:///home/servidor/servicios/dashboard/android_app/app/build.gradle.kts), [`README.md`](file:///home/servidor/servicios/dashboard/README.md)
- Incrementar a versión canónica **`8.5.0`** (`MINOR` por adición de sincronización de red automática, arquitectura de paridad completa y persistencia Zero-Trust).
- Almacenar planes en `planes/implementation_plan_v8.5.0.md` y `planes/walkthrough_v8.5.0.md`.

---

## Plan de Verificación

### 1. Verificación App Nativa Ubuntu (.deb)
- Compilar: `bash packaging/build_deb.sh`.
- Instalar: `sudo apt-get install -y ./dist/recursos-cockpit_8.5.0_amd64.deb`.
- Validar: `/usr/bin/recursos-cockpit --test-mode`.
- Comprobar que autoconecta al servidor local, almacena el token y mantiene la pestaña DeX desbloqueada.

### 2. Verificación App Nativa Android (Tab S9)
- Compilar: `cd android_app && ./gradlew assembleRelease`.
- Instalar vía ADB en Tab S9 (`192.168.50.16:5555`).
- Lanzar y verificar mediante capturas de pantalla:
  - Autodescubrimiento escaneando la red y enlace automático sin diálogos manuales.
  - Almacenamiento seguro del token.
  - Navegación por todas las pestañas paritarias del servidor (Cockpit, CPU, RAM, Discos, Red, Seguridad, Docker, Procesos).
  - Modo DeX desactivado y ausente.

### 3. Publicación y CI/CD en GitHub
- `git commit -m "feat(v8.5.0): paridad total de interfaz, autodescubrimiento lan y persistencia criptografica android y ubuntu"`
- `git tag v8.5.0`
- `git push origin main --tags`
