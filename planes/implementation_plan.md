# Plan de Implementación v8.5.3: CI/CD Dual Automatizado en GitHub Actions y Auditoría de Normas en Apps Nativas

## Objetivo
1. **Compilación y Publicación Automática de Binarios (.deb y .apk) en GitHub Actions**:
   - Ajustar el workflow `.github/workflows/build-deb.yml` a las versiones oficiales vigentes (`actions/checkout@v4`, `actions/setup-java@v4`, `gradle/actions/setup-gradle@v4`, `actions/upload-artifact@v4`, `softprops/action-gh-release@v2`).
   - Automatizar el etiquetado Git (`git tag v$VERSION` y push a `origin`) en segundo plano para que cualquier push a `main` genere/actualice la Release correspondiente de manera desatendida.
   - Asegurar la copia y vinculación de ambos paquetes: Linux Debian (`recursos-cockpit_${VERSION}_amd64.deb` + symlink `.deb`) y Android APK (`recursos-cockpit_${VERSION}.apk` + symlink `.apk`) junto con `SHA256SUMS.txt`.
2. **Auditoría Integral de Apps Nativas (Linux GTK3 & Android Jetpack Compose)**:
   - **Android (`android_app/`)**: Habilitar `buildConfig = true` e inyectar `BuildConfig.VERSION_NAME` en la cabecera de `CockpitDashboard.kt` eliminando cualquier número estático en código fuente (Regla 2 y Regla 3). Confirmar exclusión estricta de menús DeX (Regla 7.5), navegación paritaria Bento Grid y simetría total (Regla 8).
   - **Linux Ubuntu (`desktop_app/recursos_app.py`)**: Corregir shebang duplicado, verificar inicialización y dibujo de gráficas Cairo a 60 FPS, autodescubrimiento en LAN con persistencia criptográfica Zero-Trust y estación de proyección DeX por hardware desbloqueada.
3. **Sincronización Canónica de Versiones (`8.5.3`)**:
   - `./VERSION`: `8.5.3`
   - `package.json`: `"version": "8.5.3"`
   - `packaging/debian/control`: `Version: 8.5.3`
   - `android_app/app/build.gradle.kts`: `versionCode = 80503`, `versionName = "8.5.3"`
   - `README.md`: Badges, banner y tabla de versiones actualizada.

---

## Plan de Verificación
1. Validar sintaxis y lógica en `.github/workflows/build-deb.yml`.
2. Ejecutar prueba nativa de `recursos_app.py --test-mode`.
3. Compilar el paquete Debian canónico: `bash packaging/build_deb.sh`.
4. Ejecutar `lint_applet` y `compile_applet` para garantizar que la plataforma web y el proyecto compilen sin errores.
