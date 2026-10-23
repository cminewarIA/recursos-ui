# Recorrido de Verificación y Cierre v8.5.3

## Resumen Ejecutivo

En la versión **v8.5.3** (`PATCH`) se implementó la automatización completa de compilación y publicación de binarios en GitHub Actions y se auditó el cumplimiento de las normas del proyecto en las apps nativas:

1. **Pipeline de GitHub Actions Automatizado (`.github/workflows/build-deb.yml`)**:
   - Acciones migradas a versiones oficiales vigentes (`actions/checkout@v4`, `actions/upload-artifact@v4`, `softprops/action-gh-release@v2`, `actions/setup-java@v4`, `gradle/actions/setup-gradle@v4`).
   - Sincronización automática de etiquetas Git: Creación y push de `v$VERSION` hacia `origin` dentro del runner de GitHub si la etiqueta aún no existe, garantizando que `softprops/action-gh-release` publique la Release sin fallos.
   - Generación y empaquetado dual: Debian `.deb` y Android `.apk` con cálculo unificado de sumas criptográficas `SHA256SUMS.txt`.

2. **Auditoría y Corrección de Normas en Apps Nativas**:
   - **Android (`android_app/`)**:
     - Activación de `buildConfig = true` en `buildFeatures` de `build.gradle.kts`.
     - Inyección dinámica de `BuildConfig.VERSION_NAME` en la cabecera de `CockpitDashboard.kt`, eliminando versiones hardcodeadas (Regla 2 y Regla 3).
     - Validación de diseño Bento Grid simétrico (Regla 8) y ausencia total de controles DeX (Regla 7.5).
   - **Linux Ubuntu (`desktop_app/recursos_app.py`)**:
     - Corrección de shebang bash duplicado.
     - Validación de dibujo de sparklines vectoriales con Cairo a 60 FPS, autodescubrimiento LAN y conmutación a WAN exterior con persistencia criptográfica Zero-Trust.
     - Confirmación de disponibilidad exclusiva del submenú de proyección por hardware DeX / USB (Regla 7.5).

3. **Sincronización Canónica de Versiones**:
   - `./VERSION`: `8.5.3`
   - `package.json`: `8.5.3`
   - `packaging/debian/control`: `8.5.3`
   - `android_app/app/build.gradle.kts`: `versionCode = 80503`, `versionName = "8.5.3"`
   - `README.md`: `v8.5.3`
