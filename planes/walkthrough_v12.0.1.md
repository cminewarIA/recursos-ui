# Walkthrough y Verificación — `v12.0.1` (`v2B.0.1`)

## Cambios Realizados
1. **Actualización desde GitHub en la App Nativa de Ubuntu (`desktop_app/recursos_app.py`)**:
   - Añadida detección de paquete `.deb` instalado (`dpkg-query`) y repositorio local en `detect_local_node_status()`.
   - Añadido `check_github_app_update()` y `update_installed_app_from_github()` con verificación SHA-256 e instalación en sitio sin desinstalar.
   - Integrado el botón **"Actualizar desde GitHub"** y estado en tiempo real de GitHub dentro de la tarjeta 2 del lanzador GTK 3 cuando la aplicación o el nodo ya están instalados.
2. **Firma Criptográfica de `.deb` y `.apk` para Actualizaciones Sin Desinstalar**:
   - Creado `packaging/sign_deb.py` para firmar paquetes `.deb` con GPG incrustando `_gpgorigin` (estándar Debian `ar`), generando `.deb.asc`, `SHA256SUMS.txt.asc` y exportando el keyring público.
   - Actualizados `packaging/build_deb.sh`, `packaging/debian/control`, `packaging/debian/postinst` y `packaging/debian/prerm` para compresión `-Zxz`, `Installed-Size` exacto, `Maintainer` RFC-2822 válido, `Replaces` versionado y registro de keyring en `/etc/apt/trusted.gpg.d/` para compatibilidad con Ubuntu App Center (`snap-store`) / `PackageKit`.
   - Actualizado `android_app/app/build.gradle.kts` para calcular `versionCode` automáticamente desde `VERSION` y exigir firma release con `recursos-release.jks` (v1/v2/v3), junto con verificación `apksigner verify` en `.github/workflows/build-deb.yml`.

## Pruebas Realizadas
- Comprobación de sintaxis Python (`py_compile`) en `desktop_app/recursos_app.py` y `packaging/sign_deb.py`.
- Compilación del frontend (`npm run build`) y empaquetado + firma GPG de `dist/recursos-cockpit_12.0.1_amd64.deb`.
- Verificación de firma `_gpgorigin` en el archivo `ar` del `.deb`, validación con `dpkg-deb --info`, actualización en sitio sobre la versión `12.0.0` instalada previamente sin desinstalar, y ejecución de `/usr/bin/recursos-cockpit --test-mode`.
- Verificación final con `compile_applet` y `lint_applet`.
