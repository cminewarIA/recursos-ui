# Recorrido de Verificación y Cierre v8.5.0

## Resumen Ejecutivo

En la versión **v8.5.0** se implementó la arquitectura contractual completa de aplicaciones nativas (Android y Ubuntu Linux) según las directrices y normas del proyecto:
1. **Autodescubrimiento LAN Dinámico**: Escaneo concurrente de subred `/24` sin IPs fijas ni hardcodeadas.
2. **Persistencia Criptográfica Zero-Trust**: Almacenamiento seguro del token criptográfico del dispositivo en Android KeyStore (`EncryptedSharedPreferences`) y configuración de escritorio de Ubuntu, manteniendo la sesión hasta la revocación explícita (`HTTP 403 / locked`).
3. **Paridad Total de Interfaz en Android**: Vistas completas de Cockpit Bento Grid, CPU, Memoria, Discos, Red, Seguridad Fail2ban, Docker y Procesos en Jetpack Compose 100% nativo.
4. **Diferenciación Contractual de Modo DeX**: Submenú de proyección por hardware DeX estrictamente desactivado y ausente en Android y web, y desbloqueado exclusivamente en la app nativa de Ubuntu con soporte `/dev/uhid` y `scrcpy`.

---

## Cambios Implementados

### 1. Sincronización Canónica de Versión (`8.5.0`)
- `./VERSION`: Actualizado a `8.5.0`.
- `package.json`: `"version": "8.5.0"`.
- `packaging/debian/control`: `Version: 8.5.0`.
- `android_app/app/build.gradle.kts`: `versionCode = 80500`, `versionName = "8.5.0"`.
- `README.md`: Badges, banner ASCII y tabla de historial de versiones actualizados con el registro completo de `v8.5.0`.

### 2. Cliente Nativo Android (`android_app/`)
- [`Models.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/Models.kt): Modelos de datos para telemetría completa (`GpuData`, `AuthStatusData`, `ConnectionMode.SCANNING_LAN`, `ConnectionMode.REVOKED`).
- [`SecurePreferences.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/SecurePreferences.kt): Persistencia cifrada de `savedHost`, `deviceToken` y `isCertRevoked` en `EncryptedSharedPreferences`.
- [`ApiService.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/ApiService.kt): Inyección de cabeceras `X-Device-Token` y `Authorization: Bearer`, autoguardado del token emitido por el servidor y detección de revocación `HTTP 403`.
- [`DiscoveryManager.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/DiscoveryManager.kt): Detección dinámica de subred local por interfaces de red activas, sondeo concurrente a puertos LAN (`8085`, `8080`, `80`) y conmutación hacia WAN (`recursos.cminewar.duckdns.org`).
- [`CockpitDashboard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt): Navegación nativa por pestañas (Cockpit, CPU, Memoria, Discos, Red, Seguridad, Docker, Procesos), banner de bloqueo de certificado revocado y **modo DeX 100% ausente**.
- Componentes nativos modulares:
  - [`SecurityCard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/components/SecurityCard.kt): Ciberdefensa IPS Fail2ban.
  - [`DockerCard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/components/DockerCard.kt): Contenedores activos y estado UP/DOWN.
  - [`ProcessesCard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/components/ProcessesCard.kt): Procesos del kernel y ordenamiento.
  - [`SystemCard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/components/SystemCard.kt): Identificación del nodo, kernel y uptime.

### 3. Cliente Nativo Ubuntu Linux (`desktop_app/recursos_app.py`)
- `ServerConnectionManager`: Autodescubrimiento en red local, persistencia local de token en `~/.config/recursos-cockpit/client_config.json`, detección de revocación (HTTP 403), y consumo de métricas del servidor con fallback a silicio local `psutil`.
- HeaderBar con indicador dinámico de conexión (`🟢 LAN`, `🌐 WAN`, `🔒 Certificado Revocado`, `💻 Silicio Local`).
- Submenú de proyección por cable USB / Samsung DeX (`📱 Conexión USB (DeX)`) mantenido y desbloqueado exclusivamente en Ubuntu con soporte `/dev/uhid` y `scrcpy`.

---

## Verificación y Pruebas Realizadas

### 1. App Nativa de Ubuntu (.deb)
- **Compilación**: `bash packaging/build_deb.sh` generó `dist/recursos-cockpit_8.5.0_amd64.deb` y `dist/SHA256SUMS.txt`.
- **Instalación Local**: `sudo apt-get install -y ./dist/recursos-cockpit_8.5.0_amd64.deb` completada con éxito.
- **Validación CLI**:
  ```bash
  /usr/bin/recursos-cockpit --test-mode
  ```
  Salida:
  - `[OK] Recursos Native GTK3 App v8.5.0 validated successfully.`
  - `[OK] Runtime Environment Detection: {'mode': 'native', ...}`
  - `[OK] DeX / Android Desktop USB Controller Ready: {'ready': True, ...}`
  - `[OK] Server Auto-Discovery & Zero-Trust Engine Ready: active='http://127.0.0.1:8085', mode='LAN'`
- **Comprobación de Paquetes**: `dpkg -l | grep recursos-cockpit` confirmó la versión `8.5.0`.

### 2. App Nativa de Android (APK) y Samsung Galaxy Tab S9
- **Compilación Release**: `cd android_app && ./gradlew assembleRelease` compiló limpiamente en 12 segundos.
- **Distribución**: Binarios copiados a `dist/recursos-cockpit_8.5.0.apk` y `dist/recursos-cockpit.apk` con cálculo de sumas en `dist/SHA256SUMS.txt`.
- **Instalación en Tablet**:
  ```bash
  adb -s 192.168.50.16:5555 install -r dist/recursos-cockpit_8.5.0.apk
  ```
  Resultado: `Success`.
- **Verificación de Autodescubrimiento y Persistencia Criptográfica**:
  Logcat capturó:
  ```
  I RecursosCockpit: Subred local detectada para autodescubrimiento: 192.168.50
  I RecursosCockpit: Nuevo token certificado recibido y persistido en KeyStore: dev_f8eff166b2d9.1792717109...
  ```
- **Verificación Visual en Pantalla 2960×1848**:
  - Pestañas operativas y Bento Grid con telemetría en tiempo real: CPU, RAM, NVMe, Red, IPS Fail2ban, Docker y Procesos.
  - Modo DeX ausente.
  - Navegación fluida entre pestañas (`Cockpit`, `CPU`, `Docker`) verificada mediante capturas de pantalla.
