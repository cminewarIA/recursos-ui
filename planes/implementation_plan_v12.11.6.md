# Plan de Implementación — v12.11.6: Auditoría y Blindaje Integral de Autologin LAN, Autenticación WAN e Integridad de Credenciales

## 1. Objetivo
Garantizar mediante revisión exhaustiva que el autologin en red local (LAN), la continuidad criptográfica al salir al exterior (WAN) y la integridad de las credenciales HMAC-SHA256 funcionen de forma fiable, segura y coherente entre servidor (`server.py`), cliente web (`src/utils/api.ts`), App Nativa Ubuntu (`desktop_app/recursos_app.py`) y App Nativa Android/TV (`android_app/`).

---

## 2. Alcance de Correcciones
1. **Backend (`server.py`)**:
   - Extraer `_is_trusted_proxy_ip()` y corregir `get_client_ip()` con resolución `rightmost-untrusted` en `X-Forwarded-For` y validación estricta de `X-Real-IP` para impedir spoofing cuando un proxy anexa la IP real a cabeceras falsificadas por el cliente.
   - Cachear `get_auth_secret()` por ruta y metadatos de archivo (`st_mtime_ns`, `st_size`) con escritura atómica (`0o600`), eliminando lecturas repetitivas en disco sin afectar reemplazos ni pruebas.
   - Endurecer `parse_verified_device_token()` / `verify_device_token()` (formato `device_id` `^[a-zA-Z0-9_-]{3,64}$`, timestamp numérico sin deriva futura > 24 h ni expiración > 365 d, nonce hexadecimal, firma hex de 64 caracteres comparada en tiempo constante) y añadir rotación proactiva a los 180 días (`TOKEN_ROTATION_AGE_SEC = 15552000`) en `check_trust_status()` y `POST /api/auth/restore-session`.
   - Añadir `get_clear_cookie_header_value()` y `_has_trust_cookie()` para limpiar explícitamente cookies `_sysmon_trust` revocadas o manipuladas (`Max-Age=0`) tanto en respuestas HTML bloqueadas como en `403` de `/api/auth/restore-session`.
2. **App Nativa Ubuntu (`desktop_app/recursos_app.py`)**:
   - Guardar el estado de revocación (`self._save_config()`) en todas las ramas de `discover_server()` ante respuestas `403`.
   - Inyectar y fusionar `recursos_auth_persistence_config` directamente en `localStorage` desde `LocalHtmlBridgeServer._serve_html` para mantener alineado el esquema de persistencia desde el primer render.
3. **App Nativa Android/TV (`android_app/.../ui/CockpitDashboard.kt`)**:
   - Añadir `reloadWithAuthHeaders()` para que las recargas manuales (botón superior o teclas `MENU`/`PLAY_PAUSE` en Android TV) reinyecten `_sysmon_trust` y recarguen mediante `loadUrl(activeUrl, webViewHeadersProvider())` conservando `X-Device-Token` y `Authorization: Bearer` en WAN.
   - Sincronizar `recursos_auth_persistence_config` dentro de `injectNativeContext()`.
