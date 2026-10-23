# Walkthrough & Verificación v9.3.0 — Apps Nativas Ubuntu & Android con Motor HTML5 Unificado

## 1. Resumen de Cambios Realizados
1. **Eliminación de la Normativa No-HTML (`GEMINI.md`)**:
   - Se actualizaron las Reglas 7 y 8 de `GEMINI.md` para establecer que las aplicaciones nativas de Linux/Ubuntu y Android utilizan contenedores nativos acelerados por hardware (`WebKit2.WebView` en GTK 3 y `android.webkit.WebView` en Kotlin/Jetpack Compose) que renderizan la interfaz canónica HTML5/CSS3/D3.js v7/Leaflet (`index.html`).
2. **Reescritura de la App Nativa de Ubuntu (`desktop_app/recursos_app.py`)**:
   - Se implementó `LocalHtmlBridgeServer` (servidor loopback en `127.0.0.1`) acoplado con `ServerConnectionManager` (autodescubrimiento LAN `/24` + failover WAN + fallback `psutil` local) y `DexController` (`/dev/uhid` + `scrcpy` + `adb`).
   - Se reescribió la interfaz gráfica con `Gtk.ApplicationWindow` + `WebKit2.WebView` acelerado por GPU y `Gtk.HeaderBar` con controles nativos.
3. **Reescritura de la App Nativa de Android (`android_app/`)**:
   - Se reescribieron `CockpitDashboard.kt` y `MainActivity.kt` empleando `AndroidView(WebView)` acelerado por hardware, `@JavascriptInterface class RecursosAndroidBridge`, persistencia criptográfica en `EncryptedSharedPreferences` y autodescubrimiento LAN/WAN con `DiscoveryManager`.
4. **Desbloqueo Contractual Exclusivo de DeX en Ubuntu (`index.html` y `static/index.html`)**:
   - Se habilitó el desbloqueo dinámico de `#navDexLi`, `#dockDex` y los controles de hardware en `#viewDex` exclusivamente cuando `EnvironmentDetector` detecta la App Nativa de Ubuntu (`ubuntu`), manteniendo en la versión web el estado pasivo *"Esperando dispositivo para conectarse en su versión nativa"*.
5. **Sincronización Canónica a `v9.3.0` y Compilación `.deb`**:
   - Sincronizados `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md` a `9.3.0`.

## 2. Verificación Ejecutada
- **Empaquetado Debian (`bash packaging/build_deb.sh`)**:
  - Generado `dist/recursos-cockpit_9.3.0_amd64.deb` y `dist/SHA256SUMS.txt` incluyendo `/usr/lib/recursos-cockpit/static/index.html`.
- **Autodiagnóstico Nativo (`python3 desktop_app/recursos_app.py --test-mode`)**:
  - `[OK] Recursos Native Ubuntu HTML5 App v9.3.0 validated successfully.`
  - `[OK]Runtime Environment Detection: {'mode': 'native', 'engine': 'html5_webkit2', 'is_native': True, 'dex_unlocked': True}`
- **Compilación y Linting del Applet (`lint_applet` & `compile_applet`)**:
  - Verificación limpia de TypeScript y Vite build sin errores.
