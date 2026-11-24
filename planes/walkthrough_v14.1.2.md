# Walkthrough v14.1.2 — Pre-Sincronización GitHub (`v14.1.1`) y Autodescubrimiento LAN para Android 16/17 (Galaxy S25)

## 1. Pre-Sincronización y Diagnóstico en Dispositivo S25 (`RFCY41634WV` / `192.168.50.145`)
- **Sincronización previa**: descartados los cambios locales de formato sin contenido en 5 archivos y ejecutado `git fetch origin` + `git merge --ff-only origin/main`, dejando el workspace alineado con `origin/main` en **`14.1.1`** (`8ff1a44`, `0 0`).
- **Estado ADB observado**:
  - Por USB (`04e8:6860`, `SAMSUNG_Android`, serial `RFCY41634WV`), el S25 solo expuso interfaces `MTP` (`06/01/01`) y `CDC ACM` (`02/02/01` + `10/00/00`), sin interfaz USB ADB (`ff/42/01`).
  - Por Wi-Fi (`192.168.50.145`), `nmap` detectó puertos inalámbricos abiertos (`35793/tcp`, `32931/tcp`), pero `adb devices -l` los reportó en estado `offline` (pendiente de autorización/re-emparejamiento de depuración inalámbrica en el teléfono).
- **4 causas raíz corregidas en `v14.1.2` (`PATCH`)**:
  1. `DiscoveryManager.getLocalSubnetBase()` y `ApiService.collectDeviceTelemetry()` seleccionaban la primera IPv4 que empezase por `192.168.`, `10.` o `172.`, pudiendo quedar atrapadas en interfaces celulares `rmnet_data*` (5G/VoLTE/IMS), VPN/Tailscale (`tun*`) o rangos `172.x` no privados.
  2. El S25 ejecuta **Android 17 (`SDK 37`)**, donde *Local Network Protection* bloquea silenciosamente los paquetes hacia la LAN si falta el permiso `ACCESS_LOCAL_NETWORK`.
  3. No existía anuncio mDNS `_recursos._tcp` en Avahi ni consulta `NsdManager` + `WifiManager.MulticastLock` en Android.
  4. `ApiService.probeNode()` recalculaba toda la telemetría del dispositivo (`collectDeviceTelemetry()`) en las 254 sondas del rango `/24`, sin enlazar `wifiNetwork.socketFactory`.

---

## 2. Cambios Implementados
- **[AndroidManifest.xml](../android_app/app/src/main/AndroidManifest.xml)** y **[MainActivity.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/MainActivity.kt)**:
  - Declarados `android.permission.ACCESS_LOCAL_NETWORK` y `android.permission.NEARBY_WIFI_DEVICES` (`neverForLocation`).
  - Solicitud dinámica en tiempo de ejecución en Android 16/17 (`Build.VERSION.SDK_INT >= 36` verificando `packageManager.getPermissionInfo`), relanzando automáticamente el autodescubrimiento LAN al conceder el permiso.
- **[DiscoveryManager.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/DiscoveryManager.kt)** y **[ApiService.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/data/ApiService.kt)**:
  - Detección prioritaria de redes LAN reales (`TRANSPORT_WIFI` y `TRANSPORT_ETHERNET` sin `TRANSPORT_VPN` ni `TRANSPORT_CELLULAR`) vía `ConnectivityManager`, filtro estricto RFC1918 (`10/8`, `172.16/12`, `192.168/16`), extracción de IP de gateway y propia, y enlace de clientes `OkHttpClient` cacheados al `SocketFactory` Wi-Fi/Ethernet.
  - Fallback filtrado en `NetworkInterface` descartando `rmnet*`, `ccmni*`, `pdp*`, `tun*`, `tap*`, `docker*`, `br-*`, `tailscale*`, `wg*`, etc.
  - Descubrimiento paralelo **mDNS/NSD (`_recursos._tcp.`)** con `WifiManager.MulticastLock`, compatibilidad `registerServiceInfoCallback` (API 34+) y `resolveService` (API 26–33).
  - Sondas `isQuickScan = true` ligeras sin recalcular telemetría, caché `X-Device-Telemetry` de 30 s, `scanClient` de alta concurrencia (`maxRequests = 128`, timeouts `700/900 ms`) y trazas diagnósticas `RecursosCockpit`.
- **[server.py](../server.py)** y **[postinst](../packaging/debian/postinst)**:
  - Añadida `start_mdns_service_advertiser(port)` en `run_server()` (usando `/etc/avahi/services/recursos-cockpit.service`, `avahi-publish-service` o `python-zeroconf`).
  - Registro automático de `/etc/avahi/services/recursos-cockpit.service` (`%h`, `_recursos._tcp:8085`, `path=/`, `app=recursos-cockpit`) al configurar el paquete `.deb`.
- **[VERSION](../VERSION)** (`14.1.2`), **[README.md](../README.md)** e **[implementation_plan_v14.1.2.md](./implementation_plan_v14.1.2.md)** actualizados.

---

## 3. Verificación Ejecutada (Resultados Reales Observados)
- `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py desktop_app/dex_controller.py packaging/sign_deb.py`: salida `0`.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` y `npm run build` (`vite v8.3.8`): salida `0` (`2085` módulos en `1.95s`).
- `./i18n/dictionary.csv`: `31` idiomas × `1030` claves no-meta, `missing=0`.
- `bash packaging/build_apk.sh` (`SDK /opt/android-sdk`): `:app:assembleRelease` + `:app:lintVitalRelease` -> `BUILD SUCCESSFUL in 50s`, generada `dist/recursos-cockpit_14.1.2.apk` (`13 MB`) y `SHA256SUMS.txt.asc`.
- `bash packaging/build_deb.sh` + instalación `recursos-cockpit 14.1.2 amd64`: limpio de `.db`/`_dev.json`/`.vault` (`DEB_CLEAN_VERIFIED`), `/usr/bin/recursos-cockpit --test-mode` -> `[OK] Recursos Native Ubuntu HTML5 App v14.1.2 validated successfully`.
- **Producción (`/home/servidor/servicios/dashboard`) y Avahi mDNS**:
  - `system-dashboard.service`: `active`; `avahi-daemon.service`: `active`; `systemctl --failed --no-pager`: `0 loaded units listed`.
  - Consulta mDNS en vivo sobre `enp7s0` (`192.168.50.2`): `ENP7S0_MDNS_FOUND: [('servidor._recursos._tcp.local.', ['192.168.50.2', 'fe80::9f85:e83:5785:30f1'], 8085, {b'path': b'/', b'app': b'recursos-cockpit'})]`.
  - `/api/version?refresh=1`: `VERSION: 14.1.2 DEB: 14.1.2 NEEDS_INSTALL: False`; `HTTP 200` en `/`, `/manual` y `/readme`.
- **Prueba en vivo en Samsung Galaxy S25 físico (`SM-S931B`, `pa1q`, Android 17 / SDK 37, serial `RFCY41634WV`, ADB `192.168.50.145:5555`)**:
  - **Confirmación de causa raíz en `v14.1.1`**:
    - `ip -4 addr show` en el S25 mostró `rmnet_data8` (`10.21.78.149/30`, índice `38`) **antes** que `wlan0` (`192.168.50.145/24`, índice `44`).
    - Al lanzar `v14.1.1`, `logcat` confirmó literalmente: `RecursosCockpit: Subred local detectada para autodescubrimiento: 10.21.78` (escaneando la subred IMS celular en lugar de `192.168.50.x`).
  - **Instalación y comportamiento en Android 17 de `v14.1.2`**:
    - `adb -s 192.168.50.145:5555 install -r dist/recursos-cockpit_14.1.2.apk` -> `Success` (`versionCode=140102`, `versionName=14.1.2`).
    - Al declarar `ACCESS_LOCAL_NETWORK`, Android 17 aplicó `REVOKE_WHEN_REQUESTED` (`granted=false` inicial) y `NsdManager` devolvió `onStartDiscoveryFailed NSD: 7` hasta conceder el permiso.
    - `MainActivity` solicitó `android.permission.ACCESS_LOCAL_NETWORK` en tiempo de ejecución; al concederse (`granted=true`), relanzó el descubrimiento LAN automáticamente:
      - `Autodescubrimiento iniciado: subredes=[192.168.50.0/24(wlan0,gw=192.168.50.1)], vpn=false, port=8085`
      - `mDNS/NSD detectó candidatos _recursos._tcp: [http://192.168.50.2:8085]`
      - `Servidor encontrado vía rápida/NSD en 1881ms -> http://192.168.50.2:8085`
  - **Registro en `/api/auth/devices` y arranque en frío**:
    - Dispositivo registrado como `dev_42333193b56a` (`Samsung SM-S931B (pa1q)`), `connection_mode: "LAN"`, `local_ip: "192.168.50.145"`, `app_version: "14.1.2"`, `access_level: "FULL_NATIVE_ACCESS"`, `verified_in_lan: true`, `trusted: true`.
    - Arranque en frío posterior (con permiso ya concedido y host persistido): reconexión instantánea en `< 500 ms` sin excepciones `AndroidRuntime:E`.
