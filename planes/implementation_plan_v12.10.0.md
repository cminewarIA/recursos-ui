# Plan de Implementación v12.10.0 — Procesos Consumidores por Recurso, Multi-Gráficas Dinámicas de GPU e Inspección Táctil Completa

## 1. Objetivo y Alcance (`MINOR`: `12.9.0` → `12.10.0`)

1. **Procesos consumidores debajo de cada gráfica en `Equipo` (`CPU`, `Memoria`, `Gráfica`, `Almacenamiento`)**:
   - Mostrar debajo de cada recurso un panel simétrico Apple Liquid Glass con los procesos activos ordenados por consumo de ese recurso concreto, reflejando **tanto el porcentaje (`%`) como la magnitud real consumida**:
     - **Procesador**: `% de CPU normalizado` + núcleos/hilos activos y `% hilo`.
     - **Memoria**: `% de RAM` + memoria privada real (`MB`/`GB`) + memoria compartida si aplica.
     - **Gráfica**: `% GPU (cómputo/render) y % VRAM` + memoria de vídeo dedicada (`MB`/`GB`) + tipo/motor (`Gráfico`, `Cómputo`, `C+G`).
     - **Almacenamiento**: `% de actividad de disco` + velocidad actual de lectura y escritura (`MB/s` o `KB/s`) con apoyo de lectura/escritura acumulada de `/proc/[pid]/io`.
2. **Multi-gráficas dinámicas de GPU activadas/desactivadas según hardware (`EquipmentView` · pestaña `Gráfica`)**:
   - Enriquecer `get_gpu_info()` en `server.py` (NVIDIA `nvidia-smi -q -x` + `pmon`, con respaldo AMD/Intel DRM sysfs y `fdinfo`) para detectar qué sensores/motores reales expone la tarjeta instalada (Zero-Hardcoding):
     - Motor 3D / Cómputo (`compute`)
     - Memoria de Vídeo dedicada (`vram`) y Controlador de Memoria (`mem_ctrl`)
     - Motores de Codificación y Decodificación de Vídeo (`encoder` / `decoder`)
     - Temperatura y Consumo Eléctrico (`temp` / `power`)
     - Relojes de frecuencia Núcleo / Memoria (`clocks`)
     - Enlace PCIe RX/TX (`pcie`)
   - Emitir historial en vivo de 20 minutos en cubetas de 5 segundos (`gpu.history`) y capacidades exactas (`gpu.capabilities`).
   - Mostrar en la vista de **Gráfica** una barra simétrica de sensores con activación/desactivación automática según disponibilidad real del hardware (permitiendo además conmutar las gráficas soportadas y bloqueando/atenuando las no expuestas por la tarjeta).
3. **Procesos activos en las ventanas de inspección táctil (`ExpandedChartModal`)**:
   - Renderizar el mismo componente compartido `ResourceProcessesPanel` debajo del gráfico e indicadores estadísticos en las ventanas de inspección táctil (`cpu`, `ram`, `gpu`, `storage` y `net`), incluyendo también la inspección de sub-gráficas GPU (`20 min`) con sus procesos GPU activos.

## 2. Reglas de Cumplimiento Obligatorio

- **Regla 1 (Zero-Hardcoding)**: Ningún listado estático de capacidades GPU; toda activación/desactivación procede de sensores reales detectados (`N/A`/ausentes → desactivados).
- **Regla 2 (`./VERSION`)**: Única actualización en `./VERSION` (`12.10.0`).
- **Regla 4 y 5**: Sincronizar `README.md`, compilar e instalar simultáneamente `.deb` en Ubuntu y `.apk` en Android TV vía `bash packaging/install_all.sh`, actualizar servicio en producción y guardar walkthrough en `./planes/`.
- **Regla 7 y 8**: Simetría visual estricta y 100 % de los nuevos textos y etiquetas de hardware registrados en `./i18n/dictionary.csv`.

