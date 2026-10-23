# Plan de Implementación v8.4.1: Carpeta de Paquetes de Compilación Offline y Aceleración de CI/CD

El usuario ha solicitado añadir una carpeta al proyecto con todos los paquetes necesarios para compilar, con el objetivo de agilizar tanto la compilación local como la de GitHub Actions.

## Diagnóstico y Objetivos
1. **Compilación Linux (.deb)**: Actualmente en GitHub Actions se ejecuta `sudo apt-get update && sudo apt-get install -y dpkg-dev binutils`, lo que actualiza todos los repositorios remotos y descarga paquetes por red cada vez (~15-20 segundos). Disponer de los paquetes `.deb` predescargados en una carpeta dedicada `packages/debian/` permite una instalación offline inmediata (<1 segundo).
2. **Compilación Android (.apk)**: En GitHub Actions se descargan repetidamente la distribución completa de Gradle 8.5 (~126 MB) y más de 550 dependencias Maven (~345 MB), tomando 3 minutos y 19 segundos por ejecución. Al incorporar `gradle/actions/setup-gradle@v4` y flags de build-cache en `gradle.properties`, las dependencias quedan cacheadas y la compilación se reduce a segundos.
3. **Estructura Portátil y Cero Bloat**: Mantener los archivos binarios por debajo de 100 MB (estricto cumplimiento del límite de GitHub), asegurando que el repositorio sea ligero para clonar en entornos móviles / Google AI Studio.

---

## Cambios Propuestos

### 1. Nueva Carpeta de Paquetes de Compilación (`packages/`)
- **`packages/debian/`**: Archivos `.deb` descargados para la suite de empaquetado y compilación Linux:
  - `dpkg-dev`
  - `binutils`
  - `binutils-common`
  - `binutils-x86-64-linux-gnu`
  - `libbinutils`
  - `libdpkg-perl`
  - `make`
  - `patch`
  - `fakeroot`
- **`packages/scripts/install_packages.sh`**: Script para instalar o verificar los paquetes de compilación de forma instantánea sin requerir descargas de internet.
- **`packages/scripts/verify_packages.sh`**: Script de comprobación de salud de las herramientas de compilación (.deb y .apk).
- **`packages/README.md`**: Guía técnica de la carpeta de paquetes offline y su funcionamiento.

### 2. Aceleración de Compilación Android
- **`android_app/gradle.properties`**:
  - `org.gradle.caching=true` (Build cache activo)
  - `org.gradle.parallel=true` (Compilación paralela de módulos)
  - `org.gradle.vfs.watch=true` (VFS watcher para detección de cambios instantánea)
  - `org.gradle.daemon=true`

### 3. Optimización del Flujo CI/CD (`.github/workflows/build-deb.yml`)
- Sustituir la descarga lenta de paquetes por la instalación offline desde `packages/debian/`.
- Integrar `gradle/actions/setup-gradle@v4` para caché permanente de Gradle, plugins y librerías Maven en GitHub Actions.

### 4. Versionado Canónico v8.4.1 y Documentación
- Actualizar a `8.4.1`:
  - `VERSION`
  - `package.json`
  - `packaging/debian/control`
  - `android_app/app/build.gradle.kts`
  - `README.md`
- Persistir planes en `planes/implementation_plan_v8.4.1.md` y `planes/walkthrough_v8.4.1.md`.

---

## Plan de Verificación

### Compilación y Verificación Local
1. Comprobar que `packages/scripts/install_packages.sh` verifique e instale correctamente.
2. Compilar paquete Debian local: `bash packaging/build_deb.sh`.
3. Instalar paquete Debian: `sudo apt-get install -y ./dist/recursos-cockpit_8.4.1_amd64.deb`.
4. Verificar app nativa: `/usr/bin/recursos-cockpit --test-mode` y `dpkg -l | grep recursos-cockpit`.
5. Compilar APK local: `cd android_app && ./gradlew assembleRelease` y medir reducción de tiempo.

### Publicación y Validación CI/CD
1. Confirmar con commit semántico: `feat(v8.4.1): carpeta packages de compilacion offline y aceleracion ci/cd`.
2. Crear etiqueta `v8.4.1` y ejecutar `git push origin main --tags`.
3. Monitorear el workflow en GitHub Actions para verificar que la compilación es notablemente más rápida y exitosa.
