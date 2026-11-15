# Walkthrough — v12.11.5: Persistencia en `localStorage` y Cabeceras `X-Device-Token` Universales

## 1. Cambios Aplicados
- **`src/utils/api.ts`**:
  - Configuración persistente `recursos_auth_persistence_config` sincronizada con `recursos_device_token`, `sysmon_device_token`, `window.__RECURSOS_DEVICE_TOKEN__` y `RecursosAndroidBridge`.
  - Inyección independiente garantizada de `X-Device-Token` y `Authorization: Bearer` en `buildApiHeaders()`, junto con `X-Device-Telemetry` codificado en Base64 UTF-8 y `X-Recursos-Env`.
  - Extracción automática de tokens y dominio/IP (`LAN`/`WAN`) desde cualquier respuesta JSON en `apiFetchJson()`, con recuperación automática (`POST /api/auth/restore-session`) y reintento único si una petición recibe `403` teniendo un token válido guardado.
- **`src/i18n/index.tsx`, `static/manual.html`, `docs/index.html` y `server.py`**:
  - Inclusión de `X-Device-Token`, `Authorization: Bearer` y `credentials: 'same-origin'` en `/api/dictionary` y en las herramientas en vivo del manual (`buildAuthHeaders`).
  - Sincronización bidireccional de `recursos_auth_persistence_config` dentro del script de la página de desbloqueo WAN (`server.py`).

## 2. Verificación
- Pruebas funcionales TypeScript (`npx tsx`) verificando persistencia en `localStorage`, cabeceras `X-Device-Token` + `Authorization` + `X-Device-Telemetry`, sincronización de payloads LAN/WAN y reintento automático tras `403` -> `/api/auth/restore-session`.
- Validación sintáctica Python (`py_compile`), `npm run build`, empaquetado/instalación `.deb` (`12.11.5`), `/usr/bin/recursos-cockpit --test-mode`, `compile_applet` y `lint_applet`.
