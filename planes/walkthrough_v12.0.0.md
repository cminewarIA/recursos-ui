# Walkthrough y Verificación — `v12.0.0` (`v2B.0.0`)

## Cambios Implementados

### 1. Reescritura Integral de la Interfaz (`src/`, `index.html`, `vite.config.ts`)
- Reescritura completa del cliente sobre **React 19 + TypeScript + Tailwind CSS v4 + D3 v7 + Leaflet**.
- Tema **Claro Minimalista** predeterminado con cambio instantáneo a **Oscuro** desde **Más → Actualizaciones y aspecto**, persistido en `localStorage` (`recursos_theme`) y compartido con la pantalla de bloqueo externo de `server.py`.
- Navegación táctil inferior de 5 apartados (`Inicio`, `Equipo`, `Red`, `Programas`, `Más`) con botones de área táctil amplia (`>= 44 px`) y adaptación continua al redimensionar la ventana mediante `ResizeObserver`.
- Español de España cotidiano en todas las vistas, manteniendo información avanzada en desplegables *Ver detalles técnicos*.
- Nuevo componente `TelemetryChart` con **gráfica de Almacenamiento en tiempo real** (lectura/escritura en `MB/s` + espacio usado `%`) y **etiquetas flotantes (`FloatingTooltip`)** en todas las gráficas al pasar el cursor o deslizar el dedo.
- Compilación automática en producción hacia un único archivo autónomo `static/index.html` mediante el plugin `emitStandaloneStaticHtmlPlugin()` en `vite.config.ts` para su uso directo desde `server.py` y la aplicación nativa de Ubuntu.

### 2. Renovación de Marca (CMineWar) y Acciones de Energía
- Generación y despliegue de los activos gráficos del nuevo logotipo **CMineWar** en Web (`public/`, `static/`), Ubuntu (`desktop_app/assets/`) y Android (`android_app/app/src/main/res/mipmap-*`).
- Controles simétricos **Encender** y **Apagar** junto a cada dispositivo compatible en `Inicio` y `Red`, con diálogo modal de confirmación previo al apagado.

### 3. Seguridad Zero-Trust, Actualizador de GitHub y Telemetría de Disco
- Endurecimiento de `server.py` y `vite.config.ts`: detección real de E/S en `/proc/diskstats` e historial `historyBuffer.disk_r` / `disk_w` / `disk_pct`.
- Verificación de clave maestra principal y clave maestra secundaria protegida exclusivamente por hash salado `PBKDF2-HMAC-SHA256` (sin texto plano en el código).
- Correcciones del actualizador de GitHub: control de estado limpio, gestión automática de conflictos/cambios locales y *cooldown* anti-bucle en servidor y cliente.

### 4. Aplicaciones Nativas (Ubuntu `.deb` y Android `.apk`)
- **Ubuntu (`desktop_app/recursos_app.py`)**: Interfaz nativa de inicio en 3 opciones (*Conectar con el nodo*, *Instalar nodo local / ver IP y puerto*, *Configuraciones* con DNS detectado automáticamente) junto al estilo Claro Minimalista, servicio puente hacia `static/index.html` e icono CMineWar.
- **Android (`android_app/`)**: Eliminación total de `SettingsDialog.kt` y de cualquier menú de configuración manual; auto-conexión directa LAN ↔ DNS externo detectado, estilo Claro Minimalista, badge `v2B.0.0` y puente actualizado con `window.injectNativeSession`.

## Pruebas Realizadas
- Validación de tipos TypeScript (`npm run lint`) sin errores.
- Compilación completa Vite + generación de `static/index.html` autónomo (`npm run build`).
- Comprobación de sintaxis Python (`python3 -m py_compile`) sobre `server.py`, `desktop_app/recursos_app.py` y `desktop_app/dex_controller.py`.
- Verificación unitaria en `server.py` de versión visible `2B.0.0` y validación criptográfica de claves sin secretos en texto plano.
- Empaquetado Debian (`bash packaging/build_deb.sh`), instalación local de `dist/recursos-cockpit_12.0.0_amd64.deb` y ejecución de `/usr/bin/recursos-cockpit --test-mode`.
- Compilación y validación final de applet (`compile_applet` + `lint_applet`).
