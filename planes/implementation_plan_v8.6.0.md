# Plan de Implementación v8.6.0: Paridad Visual Absoluta Web ↔ Android y Corrección de Apertura en Ubuntu

## Descripción del Problema y Objetivos

El usuario ha reportado dos problemas críticos:
1. **La app de Ubuntu no abre**: Se diagnosticó que al iniciar en modo normal (sin `--test-mode`), la aplicación fallaba fatalmente con `AttributeError: 'gi.repository.Pango' object has no attribute 'AttrScale'` en `_build_device_connection_ui()`. Al fallar, dejaba un proceso huérfano en segundo plano en D-Bus, lo que provocaba que cualquier intento posterior de abrir la app terminara inmediatamente con código 0 sin mostrar ninguna ventana.
2. **La app de Android no se parece a la interfaz web**: El diseño anterior de Android utilizaba tarjetas básicas y planas sin la identidad visual auténtica del sistema web (*Apple Liquid Glass + Tesla Touch Cockpit*): carecía del Top HUD con reloj en vivo, el banner de mando con squircle del SO, los 4 pilares con medidores radiales y osciloscopios de silicio en tiempo real con degradados, el **Floating Touch Dock** flotante en la parte inferior, y la disposición panorámica Bento Grid.

En **v8.6.0** resolveremos ambos problemas de raíz, elevando la versión canónica a `v8.6.0` (actualización `MINOR` por rediseño de interfaz de usuario según la Regla 3.4).

---

## Revisión Requerida del Usuario

> [!IMPORTANT]
> **Paridad Visual Completa**: La app Android incorporará en Jetpack Compose puro la arquitectura estética exacta de la web:
> - **Top HUD de 3 zonas**: Breadcrumb `Recursos / Cabina General`, reloj digital en vivo `HH:MM:SS` con punto pulsante esmeralda y lectura `RAF 60fps`, y badge de seguridad Zero-Trust.
> - **Banner de Mando & Silicio**: Squircle con logo del SO, hostname, kernel, IP local, tiempo activo y badges de telemetría activa.
> - **4 Pilares de Hardware**: Procesador (CPU), Memoria (RAM), Aceleradora Gráfica (GPU) y Almacenamiento (Discos), cada uno con su valor destacado, especificaciones, **medidor radial circular SVG** y **osciloscopio canvas en vivo (sparkline con onda suave y relleno degradado translúcido)**.
> - **Módulos Bento Grid Secundarios**: Contenedores Docker con puntos de estado, Ciberdefensa Fail2ban con IPs bloqueadas y tabla de Procesos del Kernel.
> - **Floating Touch Dock Ergonómico**: Dock inferior flotante en cápsula de cristal oscuro con radios suaves, iconos vectoriales y punto indicador de pestaña activa (`Cabina`, `CPU`, `RAM`, `GPU`, `Discos`, `Red`, `Docker`, `Escudo`, `Procesos`).

---

## Cambios Propuestos

### 1. App Nativa de Ubuntu (`desktop_app/recursos_app.py`)
- **Corrección de Error Fatal**: Reemplazo de `Pango.AttrScale.new(2.4)` por `set_markup('<span font="32">...</span>')` totalmente compatible.
- **Ciclo de Vida y D-Bus Resiliente**: Gestión limpia del arranque para purgar o activar adecuadamente instancias existentes sin bloqueos de socket.
- **Blindaje de `--test-mode`**: Actualización de la función de pruebas para instanciar la ventana completa `RecursosNativeWindow(test_app)` durante el test, asegurando que cualquier fallo o atributo faltante sea detectado y bloqueado antes de cualquier release.

### 2. App Nativa Android (`android_app/`)
- **Osciloscopio / Sparkline Nativo en Compose (`SparklineOscilloscope.kt`)**: Componente `Canvas` que dibuja en tiempo real el historial de telemetría (CPU, RAM, GPU, Discos, Red) con curvas cúbicas Bézier suaves, línea luminosa semántica y relleno degradado vertical (`LinearGradient`) idéntico a los `<canvas>` de la web.
- **Medidor Radial Circular (`RadialGauge.kt`)**: Medidor circular con pista de fondo translúcida, trazo de progreso animado y texto porcentual monoespaciado en el centro.
- **Top HUD & Command Banner (`CockpitHeader.kt`)**:
  - Encabezado superior con breadcrumb, reloj mono en tiempo real y badges de enlace Zero-Trust (`🟢 LAN` / `🌐 WAN`).
  - Banner de mando con emblema squircle Linux/Ubuntu con brillo especular, metadatos del nodo y badges de estado.
- **Floating Touch Dock (`FloatingTouchDock.kt`)**: Barra flotante inferior de navegación ergonómica Tesla Touch Dock con óptica de cristal líquido, borde de 1px especular y conmutación fluida entre las 9 vistas.
- **Dashboard Bento Grid Rediseñado (`CockpitDashboard.kt`)**: Reorganización completa de las tarjetas para replicar fielmente el layout web panorámico en tablets (Samsung Galaxy Tab S9 Ultra en 2960×1848) y móviles.

### 3. Sincronización Canónica y Empaquetado
- Incremento a `8.6.0` en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts` y `README.md`.
- Compilación local e instalación del `.deb` con validación `/usr/bin/recursos-cockpit --test-mode`.
- Compilación del APK release, firma SHA256 y despliegue directo en la Samsung Galaxy Tab S9 Ultra (`192.168.50.16:5555`) con captura de pantalla de verificación.
- Confirmación Git, tag `v8.6.0` y `git push origin main --tags`.

---

## Plan de Verificación

### Pruebas de Ubuntu Linux (.deb)
1. Ejecución de `bash packaging/build_deb.sh` e instalación con `sudo apt-get install -y ./dist/recursos-cockpit_8.6.0_amd64.deb`.
2. Ejecución de `/usr/bin/recursos-cockpit --test-mode` para validar la inicialización de widgets y controladores.
3. Comprobación de arranque en entorno gráfico con `timeout 3s /usr/bin/recursos-cockpit` para garantizar que la ventana se crea y se mantiene en ejecución sin excepciones.

### Pruebas de Android (Samsung Galaxy Tab S9 Ultra)
1. Compilación con `./gradlew assembleRelease`.
2. Instalación en la tablet vía ADB: `adb -s 192.168.50.16:5555 install -r dist/recursos-cockpit_8.6.0.apk`.
3. Inicio de la aplicación y captura de pantalla (`screencap`) para comprobar visualmente la paridad estética con la web (reloj, banner con logo, 4 pilares con medidores radiales y sparklines, y floating touch dock).
