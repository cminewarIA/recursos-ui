# Plan de Implementación - Versión 8.4.0: Cliente Nativo Android (Jetpack Compose), CI/CD APK en GitHub y Despliegue en Samsung Galaxy Tab S9

El usuario solicita:
1. Revisar todo el proyecto línea por línea según las normas del proyecto (`GEMINI.md`).
2. Crear la aplicación nativa para Android y configurar GitHub Actions para que compile y publique el APK en las Releases junto al paquete `.deb`.
3. Compilar el APK localmente e instalarlo en la tablet **Samsung Galaxy Tab S9** conectada por ADB (`192.168.50.16:5555`).

## User Review Required

> [!IMPORTANT]
> - **Incremento de Versión Canónica a `8.4.0`**: La creación del cliente nativo de Android y su pipeline de compilación APK constituye una nueva funcionalidad modular del ecosistema (Regla 3.4), por lo que se incrementa `MINOR` de `8.3.8` a `8.4.0`.
> - **Tablet Tab S9 Conectada y Autorizada**: Se ha detectado la tablet `SM-X916B` (Samsung Galaxy Tab S9 Ultra) en `192.168.50.16:5555` con Android 16 (SDK 36) lista para la instalación del APK mediante `adb install -r`.
> - **100% Nativo en Android (Regla 7.1)**: La aplicación se construirá exclusivamente en **Kotlin + Jetpack Compose** con Material 3 y componentes nativos de silicio, con **cero WebViews** ni navegadores embebidos.

---

## 1. Revisión de Conformidad del Proyecto (Línea por Línea)

Se auditarán los componentes existentes del proyecto para certificar el cumplimiento estricto de las reglas:
- **Regla 1 (`git pull`)**: Verificado al inicio de la sesión (`Ya está actualizado`).
- **Regla 2 (Universalidad de Rutas y Zero-Hardcoding)**:
  - Verificar que todas las resoluciones en `server.py` usen `BASE_DIR` y rutas relativas como primera opción.
  - Comprobar que todas las rutas absolutas (`/home/servidor/...`) estén precedidas por comprobación condicional de existencia (`os.path.exists()`, `os.path.isfile()`).
  - Confirmar que no existan etiquetas estáticas hardcodeadas de ciudades, IPs o ISPs.
- **Regla 3 (Control de Versión Unificado)**:
  - Actualizar `VERSION` a `8.4.0`.
  - Sincronizar `package.json` (`"version": "8.4.0"`).
  - Sincronizar `packaging/debian/control` (`Version: 8.4.0`).
  - Sincronizar `android_app/app/build.gradle.kts` (`versionName = "8.4.0"`, `versionCode = 80400`).
- **Regla 6 (Compilación e Instalación Local del .deb)**:
  - Recompilar `dist/recursos-cockpit_8.4.0_amd64.deb` con `packaging/build_deb.sh`.
  - Instalar en el servidor local con `sudo apt-get install -y`.
  - Validar con `/usr/bin/recursos-cockpit --test-mode`.

---

## 2. Arquitectura de la Aplicación Nativa Android (`android_app/`)

Siguiendo de forma rigurosa la **Regla 7** de `GEMINI.md`:

### Estructura del Proyecto Android:
```
android_app/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── gradlew
├── gradlew.bat
├── gradle/wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        ├── res/
        │   ├── drawable/
        │   ├── mipmap-*/ (Icono oficial del Dragón Rojo en todas las densidades)
        │   └── values/ (colors.xml, strings.xml, themes.xml)
        └── java/com/cminewar/recursoscockpit/
            ├── MainActivity.kt
            ├── theme/ (Color.kt, Theme.kt, Type.kt - Apple Liquid Glass & Tesla Cockpit)
            ├── data/
            │   ├── Models.kt (Estructuras de datos para telemetría: CPU, RAM, Storage, Net, Docker, etc.)
            │   ├── ApiService.kt (Cliente HTTP OkHttp/Retrofit con TLS/HTTPS y tokens)
            │   ├── SecurePreferences.kt (Almacenamiento de credenciales con EncryptedSharedPreferences / Android KeyStore)
            │   └── DiscoveryManager.kt (Autodescubrimiento mDNS / LAN y fallback WAN)
            └── ui/
                ├── CockpitDashboard.kt (Bento Grid nativo con diseño adaptativo para tablet)
                ├── components/ (CpuCard.kt, MemoryCard.kt, StorageCard.kt, NetworkCard.kt, StatusBadge.kt)
                └── SettingsDialog.kt (Gestión de endpoints y tokens)
```

### Principios Contractuales Clave en Android:
1. **Interfaz 100% Nativa Pura (Jetpack Compose)**:
   - Tarjetas bento translúcidas con fondos oscuros profundos (`#0A0F1D`, `#131B2E`), bordes sutiles de cristal (`#23334D`) y esquinas redondeadas.
   - Gráficos vectoriales nativos para uso de CPU, barras de memoria y medidores de caudal de red (RX/TX).
   - Optimizado para tablets: En la Samsung Galaxy Tab S9, la interfaz se despliega en cuadrícula bento multicolumna aprovechando la pantalla AMOLED de 14.6".
2. **Autodescubrimiento y Acceso Dual (LAN ↔ WAN)**:
   - Sondeo dinámico en red local (mDNS `_recursos._tcp` o sondeo directo al gateway `192.168.50.2:8085`).
   - Conmutación automática: Si la tablet está en la red Wi-Fi de casa, conecta a `http://192.168.50.2:8085` a latencia mínima (<5ms); si sale de la red, conmuta de forma transparente hacia `https://cminewar.duckdns.org` con el token criptográfico registrado.
3. **Cero WebViews**: Cero uso de componentes de navegador. Consumo exclusivo de `/api/metrics` y `/api/version` en formato JSON estructurado.

---

## 3. Automatización CI/CD en GitHub Actions (`.github/workflows/build-deb.yml`)

Ampliar el workflow para compilar tanto el paquete Debian como el APK de Android:
- **Job de Android**:
  - Configura JDK 17 y Android SDK (`android-34`).
  - Ejecuta `./gradlew assembleRelease` (o `assembleDebug`).
  - Genera `dist/recursos-cockpit_${VERSION}.apk`.
  - Calcula sumas SHA256 para el `.deb` y el `.apk`.
- **Job de Release Pública**:
  - Publica en GitHub Releases:
    - `recursos-cockpit_${VERSION}_amd64.deb`
    - `recursos-cockpit_${VERSION}.apk`
    - `SHA256SUMS.txt`

---

## 4. Compilación Local y Despliegue en Samsung Galaxy Tab S9

1. **Instalación y Configuración del Entorno de Build Android en el Servidor**:
   - Descarga de Gradle 8.5 binario y configuración de Gradle Wrapper en `android_app/`.
   - Vinculación con `/opt/android-sdk` (`ANDROID_HOME=/opt/android-sdk`).
2. **Compilación Local del APK**:
   - Ejecutar la compilación del APK nativo: `./gradlew assembleDebug` o `assembleRelease`.
   - Copiar el binario a `dist/recursos-cockpit_8.4.0.apk`.
3. **Instalación Directa en la Tab S9**:
   - `adb -s 192.168.50.16:5555 install -r dist/recursos-cockpit_8.4.0.apk`.
   - Lanzar la aplicación en la pantalla de la tablet:
     `adb -s 192.168.50.16:5555 shell monkey -p com.cminewar.recursoscockpit -c android.intent.category.LAUNCHER 1`.
   - Verificar logs de arranque mediante `adb logcat`.

---

## 5. Plan de Verificación

### Pruebas Automatizadas y de Sistema:
- **Validación del `.deb` local**: `/usr/bin/recursos-cockpit --test-mode`.
- **Validación del APK**: `adb -s 192.168.50.16:5555 shell pm list packages | grep com.cminewar.recursoscockpit`.
- **Validación del servicio backend**: `curl http://127.0.0.1:8085/api/version` -> `"version": "8.4.0"`.
- **Validación de GitHub Actions**: Simular y verificar la sintaxis del workflow `.github/workflows/build-deb.yml`.
