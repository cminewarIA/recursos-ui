# Walkthrough Android v1.1.2 — Autoconexión LAN Automática sin Nodo Previo (TCL Android TV)

## 1. Problema Detectado (`android_app` `v1.1.1`)
- Cuando la app arrancaba sin estar emparejada (`savedHost` o `deviceToken` vacíos) o tras fallar `trySavedNodeOnly()`, [MainActivity.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/MainActivity.kt) llamaba directamente a `startLocalServerDiscoverer()` y esperaba selección manual aunque ya hubiese detectado el servidor en la red local.
- En Android 8.0 (`SDK 26`, TCL Percee TV), `DiscoveryManager.discoverViaNsd()` referenciaba directamente `NsdManager.ServiceInfoCallback` (API 34+) dentro del listener, provocando avisos ART `NoClassDefFoundError` durante la verificación de clase, y no priorizaba explícitamente candidatos por IPv4 privada numérica frente a `.local`.

## 2. Cambios Implementados (`ANDROID_VERSION` -> `1.1.2`)
- **[ANDROID_VERSION](../ANDROID_VERSION)**: incrementado a **`1.1.2`** (`PATCH`, sin modificar `VERSION` ni `UBUNTU_VERSION`).
- **[MainActivity.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/MainActivity.kt)**:
  - Añadida `autoConnectLocalNode()` que ejecuta `discoveryManager.resolveActiveNode()` al iniciar sin nodo previo o al perder conexión y finaliza la sesión automáticamente (`finalizeConnectedEndpoint`) sin exigir selección manual.
  - Ampliada `startLocalServerDiscoverer(..., autoConnectIfDisconnected = true)` para conectar de forma automática con el primer servidor LAN válido descubierto (priorizando IPv4 RFC1918) si no hay ninguno conectado.
- **[DiscoveryManager.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/DiscoveryManager.kt)**:
  - Priorización de IPv4 privada RFC1918 (`isPrivateRfc1918Ipv4`) frente a nombres `.local` en `resolveActiveNode()`.
  - Aislamiento de `NsdManager.ServiceInfoCallback` y `info.hostAddresses` dentro de `@RequiresApi(34) private object NsdApi34Helper`.

## 3. Verificación en Vivo en TCL Percee TV (`192.168.50.187:5555`, Android 8.0.0 / SDK 26)
- **Compilación**: `bash packaging/build_apk.sh` -> `BUILD SUCCESSFUL in 47s` -> `dist/recursos-cockpit_1.1.2.apk` (`13 MB`, `versionCode=10102`).
- **Instalación**: `adb -s 192.168.50.187:5555 install -r dist/recursos-cockpit_1.1.2.apk` -> `Success` (`versionName=1.1.2`).
- **Prueba desde cero (`pm clear com.cminewar.recursoscockpit`)**:
  - `logcat` confirmó detección y enlace automático sin interacción:
    - `Autodescubrimiento iniciado: subredes=[192.168.50.0/24(wlan0,gw=192.168.50.1)], vpn=false, port=8085`
    - `mDNS/NSD detectó candidatos _recursos._tcp: [http://192.168.50.2:8085]`
    - `Servidor encontrado vía rápida/NSD en 2287ms -> http://192.168.50.2:8085`
  - Sin errores `NoClassDefFoundError` de `NsdManager$ServiceInfoCallback` ni crashes `AndroidRuntime:E`.
  - Ventana en foco: `Window{3379a6d u0 com.cminewar.recursoscockpit/com.cminewar.recursoscockpit.MainActivity}`.
  - Registro confirmado en `/api/auth/devices`: `TCL Percee TV (tcl_eu)` conectado en modo `LAN` (`192.168.50.187`), `user_agent` con `RecursosCockpit-Android/1.1.2 (NativeHTML; FullAccess; AndroidTV)`, `trusted: true`, `last_seen: 2026-11-25 23:53:20`.
- **Segundo arranque en frío (con nodo ya persistido)**: reconexión directa en modo `LAN` (`last_seen: 2026-11-25 23:53:36`).
