# Plan de Implementación — Auditoría Integral de Errores y Robustecimiento (`v10.5.1`)

## 1. Objetivos del Diagnóstico
- Ejecutar un barrido integral de errores en el código fuente de backend, frontend, scripts de empaquetado y entorno de desarrollo.
- Identificar causas raíz de anomalías reportadas en endpoints, construcción de paquetes y gráficos de telemetría.
- Implementar soluciones deterministas y validar la compilación nativa Debian.

## 2. Puntos Clave de Intervención
1. **Servidor de desarrollo (`vite.config.ts`)**:
   - Incorporar interceptores para rutas no gestionadas que caían en el fallback de `index.html`.
   - Prevenir la purga del directorio `dist/` durante el empaquetado de producción de Vite (`emptyOutDir: false`).
   - Sincronizar la estructura de telemetría de sockets con caudales `tx_speed`, `rx_speed` y `bytes_total`.
2. **Control de Versiones Canónico (`v10.5.1`)**:
   - Incrementar número de parche en `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts` y `README.md`.
3. **Compilación y Despliegue Local**:
   - Generar paquete `.deb` e instalarlo en el entorno local verificando su ejecución con `--test-mode`.
