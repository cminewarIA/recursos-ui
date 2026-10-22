# Plan de Implementación v5.0.0 — Rediseño Completo, Motor DeX Exclusivo y App Nativa para Linux (.deb) con GitHub Actions

## 1. Descripción del Problema & Requerimiento
El usuario ha solicitado:
> *"rediseña la aplicacion completamente optimizando el codigo y añadiendo el sofware de dex del proyecto de la pbx de sistema operativo y una app nativa para linux.deb que gitjub sea tambien capaz de compilarla por completo t la app la quiero completamente nativa y con la funcion del dex es solo de la app"*

Este requerimiento abarca cuatro dimensiones estratégicas:
1. **Rediseño Completo & Optimización Integral**: Evolución visual radical de la interfaz a un nuevo estándar gráfico (Apple Liquid Glass 2.0 + Tesla Touch Cockpit) y optimización profunda del código fuente tanto en frontend como en backend para latencia ultrabaja y fluidez a 60 FPS estables.
2. **Adopción del Software DeX (Lapdock OS / Modo DEx)**: Integración de la lógica del proyecto `Lapdock OS / modo DEx` (`cminewarIA/Dex-mode-`) para detección inteligente por USB/Wi-Fi de Samsung DeX, Android Desktop y terminales móviles, con activación de pantallas virtuales y lanzamiento de Scrcpy de baja latencia con UHID.
3. **Exclusividad de DeX en la App Nativa**: Tal como requiere estrictamente el usuario (*"la funcion del dex es solo de la app"*), la proyección interactiva, control por hardware USB y lanzamiento de Scrcpy residirán de forma exclusiva dentro de la aplicación nativa de escritorio para Linux. En la interfaz web del servidor se indicará su estado y se proveerá el acceso/descarga directa de la app nativa.
4. **App Nativa para Linux (`.deb`) y Compilación Automática en GitHub**: Creación de una aplicación de escritorio nativa para Linux (desarrollada con GTK3/WebKit2GTK + Python para máxima integración con GNOME/Debian sin el peso excesivo de Electron), con empaquetado `.deb` reproducible y un flujo de GitHub Actions (`.github/workflows/build-deb.yml`) que compila automáticamente el paquete `.deb` y genera los releases descargables.

---

## 2. Revisión del Usuario Requerida

> [!IMPORTANT]
> - **Incremento Canónico de Versión a `5.0.0`**: De acuerdo con la **Regla 5 de GEMINI.md**, cualquier cambio de diseño estructural y visual exige un incremento `MAJOR`, restableciendo los otros dos números a cero (`4.19.0` -> `5.0.0`).
> - **Tecnología de la App Nativa**: La aplicación nativa se construirá utilizando la pila nativa oficial de Linux/Debian (**Python 3 + GTK 3/4 + WebKit2GTK**). Esto garantiza:
>   - **0 MB de sobrecarga de Electron**: La app pesa menos de 5 MB frente a los 150+ MB de un paquete Electron.
>   - **Integración profunda con el sistema operativo**: Acceso directo a `scrcpy`, `adb`, `udev` y notificaciones nativas de GNOME/KDE.
>   - **Compilación instantánea en GitHub Actions**: Generación del `.deb` en apenas 30 segundos.
> - **Exclusividad de DeX**: El modo interactivo de Samsung DeX se ejecuta localmente en la máquina del cliente donde se conecta el teléfono por USB/Wi-Fi, gestionado a través de la app nativa.

---

## 3. Arquitectura y Componentes Propuestos

### Componente 1: Rediseño Visual & Optimización de Código (Web Dashboard)
- **Refactorización Estética (Apple Liquid Glass 2.0 + Tesla Cockpit)**:
  - Nueva barra de cabecera translúcida con acabado en titanio espacial, tipografía del sistema refinada, bordes especulares multicapa (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.12)`) y microdesenfoques progresivos (`backdrop-filter: blur(28px) saturate(180%)`).
  - Optimización del Floating Touch Dock con efecto de elevación magnética, respuesta háptica visual y alineación geométrica fluida.
  - Reorganización ergonómica de Bento grids en la Vista General, Red, Ciberseguridad y Aplicaciones.
- **Optimización de Rendimiento Frontend**:
  - Eliminación de selectores redundantes y consultas repetitivas al DOM mediante almacenamiento en caché de nodos (`DOMNodeCache`).
  - Reducción de repintados (*reflows*) mediante agrupamiento de escrituras en el DOM con `requestAnimationFrame`.
  - Aplicación selectiva de `will-change: transform, opacity` en modales y gráficos D3/Leaflet.
- **Sección DeX Informativa en la Web**:
  - En el panel web, la tarjeta de Modo DeX informará del estado del ecosistema y proporcionará el enlace de descarga directa del paquete `.deb` de la aplicación nativa.

### Componente 2: Motor DeX Integrado (Lapdock OS Engine)
- **Módulo `dex_engine.py`**:
  - Integración de los algoritmos probados en `/mnt/almacenamiento/servicios/proyectos_agy/modo DEx/scripts/kiosk-manager.py`:
    - `detect_device_system(device_id)`: Clasifica el terminal conectado (Samsung DeX, Android Desktop o Ubuntu Touch).
    - `configure_android_desktop_mode(device_id, os_type, screen_w, screen_h)`: Habilita `enable_freeform_support`, `force_desktop_mode_on_external_displays` y genera la pantalla virtual adaptada a la resolución del monitor (`overlay_display_devices`).
    - `enable_wireless_adb()`: Habilita TCP/IP en el puerto 5555 y conecta vía Wi-Fi para trabajar sin cables.
    - `launch_scrcpy_dex(...)`: Lanza `scrcpy` con reenvío de teclado/ratón por hardware UHID, aceleración por GPU, audio y pantalla completa.
    - `cleanup_android_desktop_mode(device_id)`: Restablece las pantallas virtuales al desconectar.
- **Exclusividad en la App Nativa**:
  - Toda la interacción con dispositivos USB locales y ejecución de `scrcpy` se ejecuta localmente en la máquina del usuario desde la App Nativa.

### Componente 3: Aplicación Nativa de Escritorio para Linux (`recursos-cockpit`)
- **Estructura del Proyecto Nativo**:
  - `desktop_app/`:
    - `recursos_app.py`: Ventana principal GTK3/WebKit2GTK con HeaderBar moderna de GNOME, conmutador de vistas (Cockpit Web / Modo DeX Nativo), bandeja del sistema y monitor udev/adb en segundo plano.
    - `dex_controller.py`: Controlador de conexiones de teléfonos Samsung/Android, configuración de pantallas virtuales y lanzador de Scrcpy nativo.
    - `assets/`: Iconos oficiales en formato SVG y PNG (`recursos-cockpit.svg`).
    - `recursos-cockpit.desktop`: Ficha de integración con el menú de aplicaciones de Linux (categorías `System`, `Monitor`, `Utility`).

### Componente 4: Empaquetado `.deb` y Automatización GitHub Actions
- **Estructura Debian**:
  - `packaging/debian/`:
    - `control`: Especificaciones del paquete `recursos-cockpit`, versión `5.0.0`, arquitectura `amd64`, dependencias esenciales (`python3`, `python3-gi`, `gir1.2-gtk-3.0`, `gir1.2-webkit2-4.1`, `scrcpy`, `adb`).
    - `postinst`: Registro de iconos en `/usr/share/icons/hicolor` y actualización de la base de datos de escritorio (`update-desktop-database`).
    - `postrm`: Limpieza de accesos y cachés tras desinstalar.
- **Script Local de Construcción (`scripts/build_deb.sh`)**:
  - Permite compilar y generar `recursos-cockpit_5.0.0_amd64.deb` localmente con un único comando: `bash scripts/build_deb.sh`.
- **Workflow de GitHub Actions (`.github/workflows/build-deb.yml`)**:
  - Disparadores: `push` a la rama `main`, tags `v*` y ejecución manual (`workflow_dispatch`).
  - Tareas del runner `ubuntu-latest`:
    1. Checkout del repositorio.
    2. Instalación de paquetes de desarrollo Debian (`dpkg-dev`, `binutils`).
    3. Empaquetado del archivo `.deb`.
    4. Generación de sumas de verificación `SHA256SUMS.txt`.
    5. Carga del archivo `.deb` a GitHub Artifacts.
    6. Creación automática de Release en GitHub con el archivo `.deb` descargable para los usuarios.

---

## 4. Archivos a Modificar y Crear

```
├── .github/
│   └── workflows/
│       └── build-deb.yml                             [NUEVO] Compilación y Release automático en GitHub Actions
├── desktop_app/
│   ├── recursos_app.py                               [NUEVO] Aplicación nativa Linux GTK3/WebKit2GTK
│   ├── dex_controller.py                             [NUEVO] Motor nativo exclusivo de Samsung DeX y Scrcpy
│   ├── assets/
│   │   ├── recursos-cockpit.svg                      [NUEVO] Icono vectorial de la app
│   │   └── recursos-cockpit.png                      [NUEVO] Icono rasterizado HiDPI
│   └── recursos-cockpit.desktop                      [NUEVO] Lanzador de escritorio para Linux
├── packaging/
│   ├── debian/
│   │   ├── control                                   [NUEVO] Ficha técnica del paquete Debian
│   │   ├── postinst                                  [NUEVO] Script post-instalación (iconos, mime)
│   │   └── postrm                                    [NUEVO] Script post-desinstalación
│   └── build_deb.sh                                  [NUEVO] Script de empaquetado local dpkg-deb
├── static/
│   └── index.html                                    [MODIFICAR] Rediseño visual Apple Liquid Glass 2.0 y panel DeX app nativa
├── index.html                                        [MODIFICAR] Sincronización con static/index.html
├── server.py                                         [MODIFICAR] Optimización de endpoints y telemetría v5.0.0
├── VERSION                                           [MODIFICAR] Actualización canónica a 5.0.0
├── package.json                                      [MODIFICAR] Actualización canónica a 5.0.0
├── README.md                                         [MODIFICAR] Documentación del rediseño v5.0.0, App Nativa y Modo DeX
├── planes/
│   ├── implementation_plan_v5.0.0.md                 [NUEVO] Plan archivado en el proyecto
│   └── walkthrough_v5.0.0.md                         [NUEVO] Bitácora de verificación
```

---

## 5. Plan de Verificación

1. **Verificación de Empaquetado Local `.deb`**:
   - Ejecutar `bash packaging/build_deb.sh`.
   - Comprobar que genera `recursos-cockpit_5.0.0_amd64.deb` sin errores.
   - Inspeccionar el paquete con `dpkg -I recursos-cockpit_5.0.0_amd64.deb` y `dpkg -c recursos-cockpit_5.0.0_amd64.deb`.
2. **Prueba de Ejecución de la App Nativa**:
   - Probar que `python3 desktop_app/recursos_app.py --test-mode` arranca e inicializa GTK3 y WebKit sin excepciones de importación o dependencias.
3. **Verificación del Rediseño Web**:
   - `python3 -m py_compile server.py`.
   - `sudo systemctl restart system-dashboard.service`.
   - Comprobar la respuesta HTTP 200 y renderizado en Chrome headless sin errores de sintaxis JS ni CSS rotos.
4. **Verificación del Workflow de GitHub Actions**:
   - Validar la sintaxis YAML del workflow `.github/workflows/build-deb.yml`.
5. **Publicación y Push a GitHub**:
   - Confirmar commit `feat(v5.0.0): rediseño completo, motor dex exclusivo y app nativa para linux con compilación en github actions`.
   - Ejecutar `git push origin main` para disparar el flujo de GitHub Actions.
