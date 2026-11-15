# Plan de Implementación — v12.11.5: Configuración de Persistencia de Tokens en `localStorage` y Cabeceras `X-Device-Token` Universales

## 1. Objetivo
Centralizar una configuración estructurada de persistencia de credenciales en `localStorage` dentro del cliente (`recursos_auth_persistence_config`, sincronizada con `recursos_device_token` y `sysmon_device_token`) y garantizar que todas las peticiones a `/api/*` incluyan `X-Device-Token`, `Authorization: Bearer ...` y `X-Device-Telemetry` de forma consistente tanto en LAN como en WAN.

---

## 2. Alcance
1. **`src/utils/api.ts`**:
   - Añadir `AuthPersistenceConfig` (`token`, `wanDomain`, `lanIp`, `origin`, `mode`, `updatedAt`) bajo `recursos_auth_persistence_config`.
   - Exportar `getAuthPersistenceConfig`, `saveAuthPersistenceConfig`, `clearStoredToken`, `syncAuthPersistenceFromPayload` y `restoreStoredSession`.
   - Garantizar en `buildApiHeaders` la inyección independiente de `X-Device-Token` y `Authorization: Bearer <token>`, además de `X-Device-Telemetry` (Base64 UTF-8 si existe telemetría nativa) y `X-Recursos-Env`.
   - En `apiFetchJson`, sincronizar automáticamente `token` y metadatos `LAN`/`WAN` desde cualquier respuesta `/api/*`, y ejecutar recuperación silenciosa vía `POST /api/auth/restore-session` ante un `403` si existe token guardado en `localStorage`.
2. **`src/i18n/index.tsx`, `static/manual.html`, `docs/index.html` y `server.py`**:
   - Asegurar que `/api/dictionary` envíe `X-Device-Token` + `Authorization` y `credentials: 'same-origin'`.
   - Sincronizar el esquema `recursos_auth_persistence_config` en el manual HTML5 y la página de bloqueo del servidor.
