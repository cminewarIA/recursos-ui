# Plan de Implementación v9.0.0: Rediseño Anti-AI Slop, Firma Criptográfica Permanente (.apk & .deb) y CI/CD Node 24

## 1. Contexto y Objetivos
El usuario solicitó cuatro mejoras fundamentales para el proyecto:
1. **Enlaces de descarga directa de paquetes en `README.md`**: Proporcionar enlaces directos a las versiones oficiales (.deb y .apk) y al último release.
2. **Corrección de advertencias de GitHub Actions**:
   - `Node.js 20 is deprecated... forced to run on Node.js 24: actions/setup-java@v4, gradle/actions/setup-gradle@v4`.
   - `setup-java v4 is deprecated and will no longer receive updates. Please migrate to actions/setup-java@v5`.
3. **Rediseño completo de la interfaz para erradicar apariencia de IA (Anti-AI Slop)**:
   - Erradicar las píldoras y cápsulas estáticas (`border-radius: 999px`) en metadatos, tags de versiones, barras y marcadores.
   - Aplicar esquinas técnicas de silicio (`border-radius: 4px - 6px`), micro-LEDs de estado, canvas oscuro mate obsidiana (`#06070a`), contrastes de silicio y tipografía tabular monoespaciada (*JetBrains Mono* + *Outfit*).
   - Según la **Regla 3.4**, un rediseño completo de la interfaz activa estrictamente un incremento de versión **`MAJOR`**: `v9.0.0` (reseteando a `0.0`).
4. **Firma Criptográfica Permanente de Binarios (.apk & .deb)**:
   - **Android (`.apk`)**: Evitar las alarmas de Google Play Protect y permitir actualizar la app directamente sin desinstalar previamente (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Requiere keystore de lanzamiento permanente y determinista (`recursos-release.jks`) configurado en Gradle con firmas V1, V2 y V3.
   - **Ubuntu Linux (`.deb`)**: Permitir actualizaciones limpias con `dpkg` / `apt` sin bloqueos de ficheros en ejecución (*"Text file busy"*) mediante `packaging/debian/prerm` y directivas canónicas `Replaces: recursos-cockpit` y `Provides: recursos-cockpit` en `packaging/debian/control`.

---

## 2. Acciones y Modificaciones

### A. CI/CD en GitHub Actions (`.github/workflows/build-deb.yml`)
- Migrar de `actions/setup-java@v4` y `gradle/actions/setup-gradle@v4` a `actions/setup-java@v5` con `cache: 'gradle'`, ejecutándose de forma nativa en Node 24.
- Resolver completamente las dos advertencias deprecadas de GitHub.

### B. Firma Criptográfica Determinista de Android APK (`android_app/`)
- Generación de Keystore permanente PKCS12 (`android_app/keystore/recursos-release.jks`) válido durante 30 años (hasta 2056), con alias `recursos` y contraseña segura.
- Configuración en `android_app/app/build.gradle.kts`:
  - `signingConfigs { create("release") { ... enableV1Signing = true, enableV2Signing = true, enableV3Signing = true } }`
  - `buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } }`
  - Incremento de versión canónica: `versionCode = 90000`, `versionName = "9.0.0"`.

### C. Actualizaciones Transparentes e In-Place en Ubuntu Linux (`packaging/`)
- Inclusión de `Replaces: recursos-cockpit` y `Provides: recursos-cockpit` en `packaging/debian/control`.
- Creación de `packaging/debian/prerm` con permisos `755` para detener procesos activos antes del desempaquetado de nuevas versiones.
- Actualización de `packaging/build_deb.sh` para incluir el script `prerm` y compilar `dist/recursos-cockpit_9.0.0_amd64.deb`.

### D. Rediseño Anti-AI Slop en la Interfaz Web (`index.html` y `static/index.html`)
- Sustitución de estilos píldora genéricos (`border-radius: 999px`) en `.version-tag`, `.route-chip`, `.header-center-telemetry`, `.nav-counter`, `.core-bar-track/fill`, `.legend-bw-alert-badge`, `.gmp-conn-marker`, `.group-count-pill`, `.adw-badge`, `.brand-badge` y `#usbWaitLiveStatusPill`.
- Adopción de radio de curvatura técnico de 4px - 6px, micro-LEDs de estado y canvas oscuro obsidiana mate.

### E. Centro de Descargas Directas y Documentación (`README.md`)
- Incorporación de la sección `## 📥 Centro de Descargas Directas de Paquetes Oficiales (.deb Linux & .apk Android)`.
- Enlaces directos a versiones fijas (`v9.0.0`), enlace a `latest`, instrucciones paso a paso para Android y Ubuntu, y tabla histórica de descargas.
- Actualización de badges a `v9.0.0` y banner ASCII a `v9.0.0`.
- Registro detallado en el Historial de Versiones (Regla 3.4).

### F. Sincronización Canónica de Versión (`9.0.0`)
- `./VERSION`: `9.0.0`
- `package.json`: `"version": "9.0.0"`
- `packaging/debian/control`: `Version: 9.0.0`
- `android_app/app/build.gradle.kts`: `versionName = "9.0.0"`, `versionCode = 90000`
- `README.md`: `v9.0.0`

---

## 3. Plan de Verificación
1. Compilar paquete Debian local: `bash packaging/build_deb.sh`.
2. Verificar binarios generados en `dist/` y sumas `SHA256SUMS.txt`.
3. Validar cliente nativo de escritorio: `python3 desktop_app/recursos_app.py --test-mode`.
4. Ejecutar validación de TypeScript (`lint_applet`).
5. Ejecutar `compile_applet`.
