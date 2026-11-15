# Walkthrough — v12.11.4: Autologin en LAN y Persistencia Segura de Credenciales WAN

## 1. Cambios Implementados
- **Backend (`server.py`)**:
  - Se añadió `_normalize_ip_str` y se actualizaron `get_client_ip` e `is_local_ip` para desempaquetar direcciones IPv4-mapped IPv6 (`::ffff:x.x.x.x`), eliminar puertos/zonas y confiar únicamente en proxies en loopback, `SERVER_LOCAL_IP` o subred bridge Docker (`172.16.0.0/12`).
  - Se endureció `find_device_by_id_or_physical` (`allow_wan_hw_match=False` por defecto) impidiendo cualquier asociación por cabeceras no autenticadas `X-Device-Telemetry` en WAN, manteniéndola únicamente tras validar la clave maestra en `/api/auth/unlock`.
  - Se actualizó `check_trust_status` con orden de prioridad `Authorization Bearer > X-Device-Token > Cookie _sysmon_trust` y regeneración automática de `Set-Cookie` (`SameSite=Lax` / `SameSite=Lax; Secure`) cuando un cliente autenticado por cabecera perdió su cookie.
  - Se añadió el endpoint `POST /api/auth/restore-session` y se actualizó el JS de `get_locked_page_html` para restaurar sesión automáticamente desde `localStorage` o puente nativo Android al volver en WAN.
- **Cliente Web (`src/types/telemetry.ts`, `src/utils/api.ts`, `src/App.tsx`)**:
  - `getStoredToken()` y `setStoredToken()` sincronizan `recursos_device_token`, `sysmon_device_token`, `window.__RECURSOS_DEVICE_TOKEN__` y `RecursosAndroidBridge`.
  - `App.tsx` persiste automáticamente el token retornado por `/api/auth/register-device`.
- **App Nativa Ubuntu (`desktop_app/recursos_app.py`)**:
  - Escritura atómica con permisos estrictos `0o600` en `client_config.json`.
  - Helper `_is_valid_wan_domain` aplicado en `_probe`, `fetch_metrics`, `discover_server`, `_proxy_to_remote` y `/api/version`.
  - Timeout WAN TLS elevado a `3.5s`, re-descubrimiento automático ante caídas de red en `LocalHtmlBridgeServer` y registro previo a abrir WebKit2.
- **App Nativa Android / Android TV (`android_app/`)**:
  - `ApiService.kt`: aprendizaje inmediato de `public_domain` y guardado de `token` en `/api/auth/register-device`, timeouts `3.5s/4.5s` en clientes estándar y `buildWebViewAuthHeaders()`.
  - `DiscoveryManager.kt`: limpieza de `isCertRevoked` al resolver nodos LAN/WAN válidos y validación estricta del dominio WAN.
  - `MainActivity.kt`: ejecución de `registerDeviceWithServer` + `fetchMetrics` antes de exponer `activeUrl` al WebView.
  - `CockpitDashboard.kt`: sincronización de cookie `_sysmon_trust` en `CookieManager` (`flush()`) y envío de cabeceras `X-Device-Token` / `Authorization` / `X-Recursos-Client` / `X-Device-Telemetry` en `loadUrl(activeUrl, headers)`.

---

## 2. Verificación Ejecutada
- **Sintaxis Python**: `python3 -W error::SyntaxWarning -m py_compile server.py desktop_app/recursos_app.py` sin errores ni advertencias.
- **Suite de Integración Auth LAN/WAN (`server.py` + `desktop_app/recursos_app.py`)**:
  - Normalización IPv4-mapped IPv6, proxies Docker bridge y rechazo de `X-Real-IP` falso desde IPs externas.
  - Emisión de cookies `HttpOnly; SameSite=Lax` (HTTP LAN) y `HttpOnly; SameSite=Lax; Secure` (HTTPS proxy).
  - Autologin HTTP LAN, rechazo `403` estricto ante suplantación `X-Device-Telemetry` en WAN sin HMAC, auto-curación de cookie caducada mediante cabecera `Bearer`, y validación `200`/`403` de `POST /api/auth/restore-session`.
  - Persistencia en `ServerConnectionManager` con modo de archivo `0o600`.
- **Compilación Web & Debian (`.deb`)**: `npm run build`, `bash packaging/build_deb.sh`, instalación local `.deb` v`12.11.4` y prueba `/usr/bin/recursos-cockpit --test-mode`. *(Nota: En este entorno contenedor no está instalado Android SDK/Gradle/ADB para compilar el `.apk` directamente; el build completo `.deb` + `.apk` corre en CI GitHub Actions).*
