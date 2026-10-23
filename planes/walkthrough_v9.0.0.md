# Walkthrough v9.0.0: Rediseño Anti-AI Slop, Firma Criptográfica Permanente (.apk & .deb) y CI/CD Node 24

## Resumen Ejecutivo de la Versión 9.0.0 (MAJOR)
En cumplimiento de la **Regla 3.4** del proyecto (*X.0.0 - Rediseño Completo de la Aplicación*), se ha publicado la versión **`v9.0.0`**, introduciendo una transformación estética y arquitectónica integral orientada a eliminar patrones de diseño genéricos asociados a IA ("Anti-AI Slop"), implementando un sistema de firma criptográfica permanente y determinista para evitar falsas alarmas de seguridad y permitir actualizaciones *in-place* sin desinstalar, resolviendo las advertencias de GitHub Actions en Node 24, e incorporando un centro de descargas directas en la documentación oficial.

---

## 1. Centro de Descargas Directas (`README.md`)
Se incorporó una sección destacada con enlaces canónicos directos a las versiones oficiales (.deb y .apk), con instrucciones de actualización e instalación:
- **Descargas Oficiales v9.0.0**:
  - Linux Debian/Ubuntu (amd64): [`recursos-cockpit_9.0.0_amd64.deb`](https://github.com/cminewarIA/recursos-ui/releases/download/v9.0.0/recursos-cockpit_9.0.0_amd64.deb)
  - Android APK (arm64-v8a / multi-arch): [`recursos-cockpit_9.0.0.apk`](https://github.com/cminewarIA/recursos-ui/releases/download/v9.0.0/recursos-cockpit_9.0.0.apk)
  - Sumas de comprobación: [`SHA256SUMS.txt`](https://github.com/cminewarIA/recursos-ui/releases/download/v9.0.0/SHA256SUMS.txt)
- **Enlace a Última Versión Automática**:
  - [Última Release Oficial (Latest)](https://github.com/cminewarIA/recursos-ui/releases/latest)

---

## 2. Corrección de Advertencias en GitHub Actions CI/CD
- **Problema**: Advertencias de Node 20 deprecated y setup-java v4 deprecated:
  - `Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/setup-java@v4, gradle/actions/setup-gradle@v4`
  - `setup-java v4 is deprecated and will no longer receive updates. Please migrate to actions/setup-java@v5.`
- **Solución en `.github/workflows/build-deb.yml`**:
  - Migración a `actions/setup-java@v5` con directiva `cache: 'gradle'`.
  - Esta acción se ejecuta nativamente sobre Node 24 y gestiona la caché de Gradle de forma integrada sin requerir acciones secundarias obsoletas.

---

## 3. Rediseño Anti-AI Slop (Erradicación de Píldoras y Canvas Obsidiana)
- **Erradicación de Cápsulas/Píldoras Flotantes (`border-radius: 999px`)**:
  - Se eliminó el estilo de cápsula genérico en `.version-tag`, `.route-chip`, `.header-center-telemetry`, `.nav-counter`, `.core-bar-track/fill`, `.legend-bw-alert-badge`, `.gmp-conn-marker`, `.group-count-pill`, `.adw-badge`, `.brand-badge` y `#usbWaitLiveStatusPill`.
  - Se reemplazó por radios técnicos de 4px - 6px (*squircle técnico*), simulando indicadores de instrumentación de silicio.
- **Tipografía y Micro-LEDs**:
  - Tipografía tabular monoespaciada de alta precisión (*JetBrains Mono* + *Outfit*).
  - Micro-indicadores LED con pulsación limpia y bordes micro-especulares.
  - Sincronización idéntica entre `index.html` y `static/index.html`.

---

## 4. Firma Criptográfica Permanente y Actualización In-Place
### Android (.apk)
- **Problema previo**: La compilación generaba APKs con certificados debug volátiles que cambiaban en cada build o máquina. Esto provocaba que Android bloqueara la actualización con `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (obligando a desinstalar la app y perder credenciales y configuraciones de enlace) y activaba alertas en Google Play Protect.
- **Solución**:
  - Generación de almacén criptográfico permanente PKCS12 en `android_app/keystore/recursos-release.jks` con clave RSA 2048-bit y validez de 30 años (hasta el año 2056).
  - Configuración de Gradle con esquemas de firma completos: **APK Signature Scheme v1 (JAR signing), v2 (APK Signature Scheme v2) y v3 (Key Rotation support)**.
  - Al compilar en `release`, Gradle firma el binario con este almacén permanente. Al mantener el mismo certificado de firma, Android permite la instalación directa de nuevas versiones encima de la existente con un simple toque.

### Ubuntu Linux (.deb)
- **Problema previo**: Durante la actualización con `dpkg -i` o `apt install`, si la aplicación o daemon estaba abierto, el sistema arrojaba advertencias de reemplazo o fallo de fichero bloqueado (*"Text file busy"*).
- **Solución**:
  - Adición de `Replaces: recursos-cockpit` y `Provides: recursos-cockpit` en `packaging/debian/control`.
  - Inclusión de `packaging/debian/prerm` (`chmod 755`) que detecta y detiene de forma limpia cualquier instancia previa antes de que `dpkg` extraiga los nuevos binarios.
  - Permite actualizar sin advertencias ni conflictos.

---

## 5. Sincronización Canónica de Versiones
- `VERSION`: `9.0.0`
- `package.json`: `"version": "9.0.0"`
- `packaging/debian/control`: `Version: 9.0.0`
- `android_app/app/build.gradle.kts`: `versionName = "9.0.0"`, `versionCode = 90000`
- `README.md`: Badges, banner ASCII, enlaces de descarga y tabla de versiones actualizada.
