# Walkthrough — v12.11.6: Auditoría y Blindaje Integral de Autologin LAN, Autenticación WAN e Integridad de Credenciales

## 1. Cambios Aplicados
- **`server.py`**:
  - **`get_client_ip()` y `_is_trusted_proxy_ip()`**: Validación `rightmost-untrusted` sobre `X-Forwarded-For` (y validación estricta de `X-Real-IP`) aceptando cabeceras de proxy inverso únicamente desde `127.0.0.1`, `::1`, `SERVER_LOCAL_IP` o `172.16.0.0/12`, bloqueando prefijos falsificados en proxies que anexan la IP del cliente.
  - **`get_auth_secret()`**: Caché en memoria invalidada automáticamente por ruta, `st_mtime_ns` y tamaño, manteniendo generación atómica con permisos `0o600`.
  - **`parse_verified_device_token()` / `verify_device_token()` y rotación proactiva**: Validación estricta de formato (`device_id` `^[a-zA-Z0-9_-]{3,64}$`, `ts` numérico sin deriva futura > 24 h ni antigüedad > 365 días, `nonce` hex y firma hex de 64 caracteres comparada en tiempo constante) más rotación proactiva a los 180 días (`TOKEN_ROTATION_AGE_SEC`) tanto en `check_trust_status()` como en `POST /api/auth/restore-session`.
  - **`get_clear_cookie_header_value()` y `_has_trust_cookie()`**: Limpieza explícita (`Max-Age=0`) de cookies `_sysmon_trust` revocadas, manipuladas o caducadas en respuestas HTML bloqueadas y en errores `403` de `/api/auth/restore-session`.
- **`desktop_app/recursos_app.py`**:
  - Persistencia inmediata (`_save_config()`) al detectar estado `403`/revocado en todas las ramas de `discover_server()` (incluido `127.0.0.1`/`localhost` y escaneo de subred).
  - Inyección y fusión directa de `recursos_auth_persistence_config` dentro de `LocalHtmlBridgeServer._serve_html` para mantener sincronizados `token`, `wanDomain`, `lanIp`, `origin` y `mode` con `localStorage`.
- **`android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt`**:
  - Nuevo helper `reloadWithAuthHeaders()` usado en la recarga manual y teclas `MENU`/`MEDIA_PLAY_PAUSE` de Android TV para reinyectar la cookie `_sysmon_trust` y recargar mediante `loadUrl(activeUrl, webViewHeadersProvider())` conservando `X-Device-Token` y `Authorization: Bearer`.
  - Sincronización de `recursos_auth_persistence_config` dentro de `injectNativeContext()`.

## 2. Verificación Ejecutada
- **Pruebas Python (`server.py` + `desktop_app/recursos_app.py`)**: Caché e invalidación de `.auth_secret` (`0o600`), rechazo de tokens malformados/caducados/futuros/manipulados, anti-spoofing `rightmost-untrusted` en `X-Forwarded-For`, autologin LAN → acceso WAN con `Bearer` → rotación proactiva >180 días → revocación con `403` y limpieza `Set-Cookie: Max-Age=0`, e integración con `ServerConnectionManager`.
- **Sintaxis Python**: `python3 -W error::SyntaxWarning -m py_compile server.py desktop_app/recursos_app.py i18n_catalog.py` correcto sin advertencias.
- **Pruebas Cliente Web (`src/utils/api.ts`)**: Ejecución vía Vite SSR verificando `recursos_auth_persistence_config`, cabeceras `X-Device-Token` + `Authorization: Bearer` + `X-Device-Telemetry`, sincronización LAN/WAN y recuperación automática `403` → `POST /api/auth/restore-session`.
- **Compilación y Paquete Ubuntu `.deb`**: `npm run build`, `compile_applet`, `lint_applet` (`tsc --noEmit`), `bash packaging/build_deb.sh` (`recursos-cockpit_12.11.6_amd64.deb` firmado), instalación local y `/usr/bin/recursos-cockpit --test-mode` exitosos. *(Nota: el entorno no dispone de Android SDK/Gradle ni ADB para compilar/desplegar el `.apk` localmente).*
