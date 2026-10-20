# Solución al Problema de Carga en Nextcloud

Se ha diagnosticado y resuelto el fallo que impedía que el dashboard cargara correctamente al ser visualizado dentro del iframe de Nextcloud (`https://cminewar.duckdns.org/apps/external/3/` y `/1/`).

---

## Causa Raíz Detectada

1. **Bloqueo por Content Security Policy (`frame-ancestors`)**:
   - En el commit anterior, `server.py` configuraba `frame-ancestors 'self' https://{dom} https://*.{dom};`.
   - Cuando el cliente cargaba `recursos.cminewar.duckdns.org`, `{dom}` era el propio subdominio del monitor.
   - Como el contenedor principal de Nextcloud es `https://cminewar.duckdns.org`, el navegador rechazaba de inmediato la incrustación por violación de directiva CSP.
2. **Restricción de Cookies de Terceros en Iframe (Cross-Site)**:
   - Los navegadores modernos bloquean el envío de cookies (`_sysmon_trust`) dentro de iframes si están en orígenes cruzados.
3. **Rutas Faltantes**:
   - `/descargas` y `/version` no estaban registradas en `VALID_WEB_ROUTES`, devolviendo 404.

---

## Cambios Implementados

### 1. Backend ([server.py](file:///home/servidor/servicios/dashboard/server.py))
- **Content-Security-Policy autorizada**:
  ```python
  csp_ancestors = (
      "'self' "
      "https://cminewar.duckdns.org "
      "https://*.cminewar.duckdns.org "
      "https://*.duckdns.org "
      "https://192.168.50.2 http://192.168.50.2 "
      "https://servidor https://servidor.lan "
      "http://localhost:* http://127.0.0.1:* "
      f"https://{dom} https://*.{dom}"
  )
  ```
- **Autenticación Dual (Cookie + Cabeceras `X-Device-Token` / `Bearer`)**:
  - `check_trust_status()` ahora comprueba la cabecera `X-Device-Token` o `Authorization: Bearer` además de la cookie tradicional.
  - La API `/api/metrics` y `/api/auth/unlock` devuelven el token firmado para permitir la persistencia en `localStorage`.
- **Rutas ampliadas**: Se añadieron `/descargas`, `/version` y `/dispositivos` a `VALID_WEB_ROUTES`.

### 2. Frontend ([static/index.html](file:///home/servidor/servicios/dashboard/static/index.html) e [index.html](file:///home/servidor/servicios/dashboard/index.html))
- **Inyector `authHeaders()`**:
  - Cada petición `fetch()` adjunta automáticamente la credencial `X-Device-Token` desde `localStorage`.
- **Diseño Nativo Nextcloud Hub**:
  - Paleta oficial: Fondo `#181818`, tarjetas `#222222`, acento Nextcloud Blue `#0082c9` y `#0091f2`.
  - Integración de iframe (`.in-nextcloud`): Altura ajustada a `100%` para eliminar barras de desplazamiento duplicadas y márgenes dobles.
  - Soporte de navegación por hash (`#security`, `#overview`) para sincronizar con los enlaces externos de Nextcloud.

---

## Verificación Realizada

1. **Prueba de cabeceras CSP vía HTTPS (Caddy)**:
   - `curl -s -k -I https://recursos.cminewar.duckdns.org/` confirmó que `frame-ancestors` incluye `https://cminewar.duckdns.org` y subdominios.
2. **Prueba de rutas**:
   - `/descargas` y `/seguridad` devuelven `HTTP/2 200 OK`.
3. **Prueba de autenticación**:
   - `/api/metrics` genera y valida tokens vía `X-Device-Token`.
4. **Servicio y Git**:
   - `system-dashboard.service` reiniciado y en ejecución activa.
   - Commit `e165372` subido exitosamente a GitHub (`cminewarIA/recursos-ui` rama `main`).
