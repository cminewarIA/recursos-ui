# Recorrido de Verificación - Versión 8.4.0: Cliente Nativo Android, Pipeline CI/CD de APK y Despliegue en Samsung Galaxy Tab S9

## Resumen de la Tarea
Se ha implementado de forma completa el ecosistema nativo para Android siguiendo con rigor la **Regla 7** de [`GEMINI.md`](../GEMINI.md), se ha configurado el pipeline de integración continua en GitHub Actions para generar y publicar el `.apk` junto al paquete `.deb`, se ha compilado e instalado localmente el ejecutable de Linux y se ha desplegado con éxito en la tablet **Samsung Galaxy Tab S9 Ultra** conectada por ADB.

---

## 1. Aplicación Nativa para Android (`android_app/`)

### Características de Ingeniería:
- **100% Nativo en Kotlin + Jetpack Compose (Material 3)**: Cumplimiento estricto de la Regla 7.1 (**cero WebViews**, cero navegadores embebidos).
- **Diseño Apple Liquid Glass + Tesla Touch Cockpit**:
  - Paleta oscura profunda (`#090D16`), tarjetas bento translúcidas (`#121826`) con bordes sutiles de cristal (`#2A354C`) y acentos de silicio en neón (`#0A84FF`, `#30D158`, `#FF9F0A`, `#FF453A`, `#BF5AF2`, `#64D2FF`).
  - Disposición responsiva con `LazyVerticalGrid(GridCells.Adaptive(minSize = 340.dp))` que en pantallas grandes (como la Samsung Galaxy Tab S9 en 2960×1848) distribuye las tarjetas en una cuadrícula bento multicolumna y en móviles en vista vertical fluida.
- **Tarjetas de Telemetría en Tiempo Real**:
  - `SystemCard`: Estado del nodo, uptime, hostname, kernel y estado de ciberdefensa Fail2ban IPS con badge de modo de conexión.
  - `CpuCard`: Uso %, núcleos lógicos, frecuencia GHz, temperatura térmica NVMe/CPU y barra de progreso animada.
  - `MemoryCard`: Uso de RAM %, GB usados y totales, Swap y badge de ZRAM activa.
  - `StorageCard`: Uso de disco primario NVMe %, punto de montaje, espacio libre/total y temperatura del disco.
  - `NetworkCard`: Tráfico de bajada (RX) y subida (TX) en vivo con formateo automático (`MB/s`, `KB/s`, `B/s`) e IP local.
- **Autodescubrimiento y Enlace LAN ↔ WAN**:
  - Sondeo inicial ultrarrápido en red local (`http://192.168.50.2:8085` a <1ms de latencia) con conmutación automática transparente hacia el nodo público / DDNS (`https://recursos.cminewar.duckdns.org`).
  - Almacenamiento seguro de tokens y credenciales con `EncryptedSharedPreferences` respaldado por Android KeyStore.
- **Iconografía Oficial**:
  - Insignia Squircle del Dragón Rojo generada en todas las densidades mipmap (`mdpi`, `hdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`).

---

## 2. Ajuste en Backend: Acceso Directo LAN (`server.py`)

- **Vincular a `0.0.0.0`**: Se configuró `bind_host = os.environ.get("HOST", "0.0.0.0")` en `run_server()`, permitiendo que dispositivos de la red Wi-Fi local (como la Tab S9) se comuniquen directamente con el puerto `8085` sin latencia, mientras Caddy continúa gestionando el tráfico reverso externo por HTTPS.

---

## 3. Pipeline CI/CD en GitHub Actions (`.github/workflows/build-deb.yml`)

- Se actualizó el workflow para compilar en paralelo:
  1. Paquete Debian Linux: `dist/recursos-cockpit_8.4.0_amd64.deb` mediante `packaging/build_deb.sh`.
  2. APK Nativo Android: `dist/recursos-cockpit_8.4.0.apk` mediante `./gradlew assembleRelease`.
  3. Cálculo de sumas SHA256 unificadas en `dist/SHA256SUMS.txt`.
  4. Publicación automática de todos los artefactos (`.deb`, `.apk`, `SHA256SUMS.txt`) en la Release oficial de GitHub.

---

## 4. Pruebas y Despliegue en Samsung Galaxy Tab S9

| Prueba / Subsistema | Comando Ejecutado | Resultado Obtenido | Estado |
| :--- | :--- | :--- | :---: |
| **Detección ADB** | `adb devices -l` | `192.168.50.16:5555 device model:SM_X916B` | ✅ OK |
| **Compilación Local APK** | `./gradlew assembleRelease` | `BUILD SUCCESSFUL in 9s` | ✅ OK |
| **Instalación en Tab S9** | `adb install -r dist/recursos-cockpit_8.4.0.apk` | `Performing Streamed Install: Success` | ✅ OK |
| **Paquete en Tablet** | `adb shell pm list packages \| grep recursoscockpit` | `package:com.cminewar.recursoscockpit` | ✅ OK |
| **Lanzamiento en Pantalla** | `adb shell am start -n com.cminewar.recursoscockpit/.MainActivity` | Intent iniciado con éxito | ✅ OK |
| **Enlace LAN en Vivo** | Captura de pantalla de la Tab S9 | Badge `🟢 LAN (BAJA LATENCIA)` activo | ✅ OK |
| **Compilación Linux .deb** | `bash packaging/build_deb.sh` | `dist/recursos-cockpit_8.4.0_amd64.deb` generado | ✅ OK |
| **Instalación Local Linux** | `sudo apt-get install -y ./dist/recursos-cockpit_8.4.0_amd64.deb` | Código 0, paquete instalado en el servidor | ✅ OK |
| **Validación Test Mode** | `/usr/bin/recursos-cockpit --test-mode` | `[OK] Recursos Native GTK3 App v8.4.0 validated successfully.` | ✅ OK |
| **Servicio Backend** | `curl -s http://127.0.0.1:8085/api/version` | `"version": "8.4.0"` | ✅ OK |
