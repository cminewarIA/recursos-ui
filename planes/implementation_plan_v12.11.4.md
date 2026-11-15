# Plan de Implementación — v12.11.4: Blindaje de Autologin en LAN y Persistencia de Credenciales para Acceso Exterior (WAN)

## 1. Objetivo
Garantizar que el emparejamiento automático en la red local (**LAN**) funcione de manera determinista tras proxies inversos y direcciones IPv4-mapped IPv6, y que los tokens HMAC-SHA256 junto con el dominio público (`public_domain`) persistan y se sincronicen de forma fiable entre navegador web, aplicación nativa Ubuntu (`.deb`) y aplicación nativa Android/TV (`.apk`) para conectar automáticamente desde el exterior (**WAN**) sin perder credenciales ni quedar bloqueado en la pantalla de acceso protegido.

---

## 2. Causas Raíz Detectadas
1. **Android (`android_app/`)**:
   - `CockpitDashboard.kt` cargaba `WebView.loadUrl(activeUrl)` sin cabeceras `X-Device-Token` / `Authorization` ni cookie `_sysmon_trust` inyectada en `android.webkit.CookieManager`, causando que al abrir por WAN (`https://<wanDomain>`) el servidor entregase la página de bloqueo antes de que JS pudiera inyectar la sesión.
   - `ApiService.kt` (`registerDeviceWithServer`) ignoraba el `token` devuelto y `probeNode` no aprendía `public_domain`.
   - `MainActivity.kt` fijaba `activeUrl` antes de completar el registro/obtención de token, creando una condición de carrera en la primera conexión.
2. **Backend (`server.py`)**:
   - `get_client_ip` / `is_local_ip` no desempaquetaban direcciones IPv4-mapped IPv6 (`::ffff:x.x.x.x`), zonas (`%eth0`) ni proxies en subred bridge Docker (`172.16.0.0/12`).
   - `get_cookie_header_value` emitía `SameSite=None; Secure; Partitioned` bajo HTTPS, provocando pérdida/particionado de cookies en WebViews y navegadores con protección de rastreo; se cambia a `SameSite=Lax; Secure`.
   - `check_trust_status` no reemitía `Set-Cookie` al autenticar mediante cabeceras sin cookie válida, ni priorizaba cabeceras válidas sobre cookies caducadas.
   - `find_device_by_id_or_physical` permitía emparejamiento sin token en WAN cuando llegaba telemetría `X-Device-Telemetry` (riesgo de suplantación cerrado en WAN salvo desbloqueo explícito con clave maestra).
   - La página de bloqueo (`get_locked_page_html`) solo escribía `sysmon_device_token` y no intentaba restaurar sesión automática desde `localStorage` ni el puente Android (`POST /api/auth/restore-session`).
3. **Web Frontend (`src/`) & Ubuntu Desktop (`desktop_app/recursos_app.py`)**:
   - `src/utils/api.ts` solo leía `recursos_device_token`; ahora sincroniza `recursos_device_token`, `sysmon_device_token`, `window.__RECURSOS_DEVICE_TOKEN__` y `RecursosAndroidBridge`.
   - `src/App.tsx` captura y persiste el token devuelto por `/api/auth/register-device`.
   - `desktop_app/recursos_app.py` guarda `client_config.json` atómicamente con permisos `0o600`, valida estrictamente `wan_domain` mediante `_is_valid_wan_domain` (rechazando IP:puerto y `.local`), eleva el timeout WAN TLS a `3.5s`, captura tokens/dominios en el puente proxy (`_proxy_to_remote` + `/api/version`), registra el dispositivo antes de cargar métricas/WebKit2 y fuerza re-descubrimiento limpio al cambiar de red.

---

## 3. Verificación Planificada
- Pruebas Python unitarias y de integración HTTP en vivo (`DashboardHTTPHandler`, `check_trust_status`, `POST /api/auth/restore-session`, rechazo 403 ante suplantación WAN sin token, auto-curación de cookie, `ServerConnectionManager` con `0o600`).
- Compilación frontend (`npm run build`), empaquetado e instalación Debian (`bash packaging/build_deb.sh` + `/usr/bin/recursos-cockpit --test-mode`) y verificación `compile_applet` + `lint_applet`.
