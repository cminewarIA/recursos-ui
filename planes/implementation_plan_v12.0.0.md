# Plan de Implementación Canónico — `v12.0.0` (`v2B.0.0`)

## Resumen de Objetivos
1. **Reescritura Completa del Frontend (`src/`) en React 19 + TypeScript + Tailwind CSS v4**:
   - Estética **Claro Minimalista** (`#F6F7F9` / `#FFFFFF`) por defecto con selector instantáneo a **Modo Oscuro** (`#0B1120` / `#111827`) ubicado dentro del panel **Actualizaciones y aspecto** (actualizador de GitHub).
   - Lenguaje 100% **español de España cotidiano** y cercano, desplazando PIDs, sensores y detalles de hardware a desplegables colapsables (*Ver detalles técnicos*).
   - **Barra de navegación inferior táctil fija** (`Inicio`, `Equipo`, `Red`, `Programas`, `Más`) adaptada a cualquier tamaño de pantalla y redimensionamiento en vivo (`ResizeObserver` + `leaflet.invalidateSize()`).
2. **Gráfica en Tiempo Real para Almacenamiento y Tooltips Interactivos Universales**:
   - Gráfica en vivo en el widget de **Almacenamiento** mostrando velocidad de **lectura y escritura (`MB/s`)** y **porcentaje de espacio ocupado**, respaldada por telemetría real `/proc/diskstats` en `server.py` y `vite.config.ts`.
   - Componente `FloatingTooltip` con posicionamiento inteligente que muestra los valores exactos bajo el cursor o dedo en todas las gráficas (CPU, RAM, GPU, Almacenamiento, gráficas ampliadas, sparklines de 2 horas y anillo GeoIP).
3. **Renovación Visual del Logo CMineWar y Controles de Energía Simétricos**:
   - Sustitución completa de los iconos y favicons anteriores por el logotipo **CMineWar** en Web (`public/` y `static/`), Ubuntu (`desktop_app/assets/`) y Android (`mipmap-*`).
   - Botones paralelos **Encender** (WoL) y **Apagar** (con confirmación modal) en las tarjetas de dispositivos tanto de `Inicio` como de `Red`.
4. **Auditoría del Actualizador de GitHub, Seguridad Zero-Trust y Clientes Nativos**:
   - Corrección en `server.py` y `vite.config.ts` de falsos positivos en `git status`, respaldo automático con `git stash` si hay cambios locales, y enfriamiento (*cooldown*) anti-bucle tras actualizar.
   - Soporte de clave maestra autogenerada (`.admin_master_key`) y clave maestra secundaria verificada únicamente mediante hash salado `PBKDF2-HMAC-SHA256` sin secretos en texto plano.
   - **Ubuntu (`.deb`)**: Lanzador GTK 3 con **3 opciones claras al iniciar**: (1) *Conectar con el nodo* (auto-escaneo LAN + DNS detectado), (2) *Instalar nodo local* (o mostrar IP/puerto exactos de la red local si ya está instalado), y (3) *Configuraciones* (guardando el DNS detectado desde la opción 1).
   - **Android (`.apk`)**: Eliminación completa de `SettingsDialog` y de cualquier selección manual de servidor; conexión automática por LAN y conmutación automática al DNS externo detectado, manteniendo la apariencia unificada.
5. **Sincronización Canónica (`VERSION = 12.0.0`, etiqueta visual `v2B.0.0`)**:
   - Sincronización en `VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `README.md` y compilación e instalación del paquete `.deb`.
