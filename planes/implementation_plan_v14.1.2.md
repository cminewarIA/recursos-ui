# Plan de Implementación v14.1.2 — Pre-Sincronización GitHub (`v14.1.1`) y Corrección de Autodescubrimiento LAN en Android 16/17 (Galaxy S25)

## 1. Diagnóstico Verificado
Tras sincronizar con `origin/main` (`v14.1.1`, commit `8ff1a44`), el fallo por el que la app nativa Android en Samsung Galaxy S25 (`SM-S931B`, Android 17 / SDK 37) no detecta el servidor local (`192.168.50.2:8085`) responde a cuatro causas combinadas:
1. **`DiscoveryManager.getLocalSubnetBase()` y `ApiService.collectDeviceTelemetry()`**: devolvían la primera interfaz IPv4 activa (`NetworkInterface.getNetworkInterfaces()`) cuyo prefijo empezara por `192.168.`, `10.` o `172.`. En Android 5G con interfaces celulares (`rmnet_data*`), VPN/Tailscale (`tun*`) o rangos `172.x` no privados, el escaneo buscaba en la subred celular/VPN en lugar de hacerlo en la red Wi-Fi/Ethernet real (`wlan0`).
2. **Android 16/17 Local Network Protection (SDK 36/37)**: los dispositivos con Android 17 bloquean silenciosamente las conexiones salientes a IPs LAN y mDNS si la app no declara ni solicita en tiempo de ejecución el permiso `android.permission.ACCESS_LOCAL_NETWORK` (y `NEARBY_WIFI_DEVICES`).
3. **Ausencia de mDNS / NSD (`_recursos._tcp`)**: ni el servidor publicaba el servicio `_recursos._tcp` en Avahi (`/etc/avahi/services/recursos-cockpit.service`) ni `DiscoveryManager.kt` consultaba `NsdManager` con `WifiManager.MulticastLock`, por lo que `http://recursos.local:8085` fallaba y todo dependía del escaneo `/24`.
4. **Sobrecarga en cada sonda de escaneo `/24` y ausencia de enlace a `wifiNetwork.socketFactory`**: `probeNode()` invocaba `collectDeviceTelemetry()` en las 254 sondas (SHA-256 + `/proc/cpuinfo` + `StatFs` + `BatteryManager`), con timeout estricto de `350 ms` y sin ligar los sockets a la red `TRANSPORT_WIFI` frente a VPN/datos móviles activos.

## 2. Ubicación Lógica de los Cambios (Norma 3.1 y Norma 5 de `./GEMINI.md`)
- `android_app/app/src/main/AndroidManifest.xml`, `MainActivity.kt`, `data/ApiService.kt` y `data/DiscoveryManager.kt`: módulo nativo de puente/autodescubrimiento LAN↔WAN (Norma 5).
- `server.py` y `packaging/debian/postinst`: publicación automática mDNS `_recursos._tcp` en la LAN mediante Avahi / `zeroconf`.
- `./README.md`, `./VERSION` (`14.1.2`), `./planes/implementation_plan_v14.1.2.md` y `./planes/walkthrough_v14.1.2.md`: trazabilidad y sincronización documental (Normas 6 y 8).

## 3. Plan de Implementación (`PATCH` 14.1.1 → 14.1.2)
1. **Permisos de Red Local para Android 16/17 (`AndroidManifest.xml` + `MainActivity.kt`)**:
   - Declarar `ACCESS_LOCAL_NETWORK` y `NEARBY_WIFI_DEVICES` (`neverForLocation`).
   - Solicitar dinámicamente `"android.permission.ACCESS_LOCAL_NETWORK"` en `MainActivity` si `Build.VERSION.SDK_INT >= 36` y el SO define el permiso, relanzando el autodescubrimiento al concederlo.
2. **Selección Exclusiva de Red Wi-Fi/Ethernet, `SocketFactory`, NSD mDNS y Caché de Telemetría (`ApiService.kt` + `DiscoveryManager.kt`)**:
   - Detectar contextos LAN reales con `ConnectivityManager.allNetworks` (`TRANSPORT_WIFI` / `TRANSPORT_ETHERNET` sin `TRANSPORT_VPN` ni `TRANSPORT_CELLULAR`), extraer subredes RFC1918 estrictas, IP de gateway, IP propia del dispositivo y `network.socketFactory`, con fallback filtrado sobre `NetworkInterface`.
   - Añadir descubrimiento paralelo `NsdManager` (`_recursos._tcp.`) protegido con `WifiManager.MulticastLock`.
   - En `ApiService.probeNode()`, omitir `collectDeviceTelemetry()` cuando `isQuickScan = true`, cachear la cabecera de telemetría 30 s para las peticiones normales, ampliar `scanClient` (`maxRequests = 128`, timeouts `700/900 ms`) y permitir sondear mediante el `SocketFactory` de la interfaz Wi-Fi.
3. **Anuncio mDNS `_recursos._tcp` en Servidor y Paquete `.deb` (`server.py` + `packaging/debian/postinst`)**:
   - Registrar `/etc/avahi/services/recursos-cockpit.service` (con `%h`, Zero-Hardcoding) en `postinst` y añadir `start_mdns_service_advertiser(port)` en `server.py` (`avahi-publish-service` o `zeroconf` si no hay servicio Avahi estático).
4. **Verificación**:
   - `py_compile`, `tsc --noEmit` + `npm run build`, `bash packaging/build_apk.sh`, `bash packaging/build_deb.sh`, instalación local `.deb`, `--test-mode`, `rsync` productivo y reinicio de `system-dashboard.service`, verificación de Avahi (`_recursos._tcp`) y prueba en S25 por ADB si vuelve a estar online.
