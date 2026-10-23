# Recorrido de Verificación y Cierre v8.5.1

## Resumen Ejecutivo

En la versión **v8.5.1** se atendió la solicitud de ajuste visual en la documentación del proyecto:
1. **Supresión del Logotipo de Apple**: Eliminación de los parámetros `&logo=apple&logoColor=white` en el badge de versión canónica de la cabecera de [`README.md`](../README.md).
2. **Sincronización Canónica de Versión (`8.5.1`)**: Actualización de `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts` y [`README.md`](../README.md).
3. **Compilación e Instalación**:
   - Paquete Debian canónico `dist/recursos-cockpit_8.5.1_amd64.deb` compilado e instalado en el servidor físico local, validado con `/usr/bin/recursos-cockpit --test-mode`.
   - Paquete Android APK `dist/recursos-cockpit_8.5.1.apk` compilado e instalado vía ADB en la Samsung Galaxy Tab S9 Ultra (`192.168.50.16:5555`).
   - Sumas SHA256 actualizadas en `dist/SHA256SUMS.txt`.
