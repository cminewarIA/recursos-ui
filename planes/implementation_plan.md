# Corrección de Carga e Integración Nativa en Nextcloud

Este documento detalla la solución técnica integral para resolver el problema de carga del Dashboard en Nextcloud (`https://cminewar.duckdns.org/apps/external/3/` y `/1/`).

---

## Diagnóstico del Problema

1. **Bloqueo por Content Security Policy (`frame-ancestors`) en `server.py`**:
   - En el commit reciente `5a63fce`, `send_security_headers()` se modificó a:
     `frame-ancestors 'self' https://{dom} https://*.{dom};`
   - Al cargarse desde `https://recursos.cminewar.duckdns.org`, `{dom}` se resolvía a `recursos.cminewar.duckdns.org`.
   - Dado que el marco principal de Nextcloud es `https://cminewar.duckdns.org` (origen padre), los navegadores modernos bloqueaban de raíz la incrustación del iframe por infracción estricta de CSP.

2. **Bloqueo de Cookies de Terceros en el Iframe (Cross-Origin)**:
   - Al estar en dominios distintos (`cminewar.duckdns.org` vs `recursos.cminewar.duckdns.org`), el navegador considera el iframe como contexto de terceros.
   - Si un navegador restringe cookies de terceros (Safari ITP, Firefox ETP, Chrome con partición estricta), la cookie `_sysmon_trust` no se envía al consultar `/api/metrics`, provocando error 403 Forbidden y recargas cíclicas.
   - Solución: Permitir autenticación mediante cabecera `X-Device-Token` / `Authorization: Bearer` con persistencia en `localStorage`.

3. **Rutas Web Faltantes en `VALID_WEB_ROUTES` (`server.py`)**:
   - Las rutas `/descargas` y `/version` faltaban en `VALID_WEB_ROUTES`, provocando errores 404 al recargar o navegar directamente a ellas.

4. **Armonización Visual y Ajuste de Dimensiones en el Iframe**:
   - Ajustar el tema visual a los colores oficiales de Nextcloud Hub (`#181818` fondo, `#222222` tarjetas, `#0082c9` azul de acento).
   - Asegurar que `.app-window` use `height: 100%` en lugar de `100vh` dentro de Nextcloud para eliminar desbordamientos y dobles barras de desplazamiento.

---

## Cambios a Realizar

### [server.py](file:///home/servidor/servicios/dashboard/server.py)
1. **CSP `frame-ancestors`**:
   - Incluir explícitamente `https://cminewar.duckdns.org`, `https://*.cminewar.duckdns.org`, `https://*.duckdns.org`, `https://192.168.50.2`, `http://192.168.50.2`, `https://servidor`, `https://servidor.lan`, y comodines locales.
2. **Autenticación Dual (Header + Cookie)**:
   - Extraer token de credencial desde `X-Device-Token`, `Authorization: Bearer`, o la cookie `_sysmon_trust`.
   - Devolver el token en la respuesta de `/api/metrics` y `/api/auth/unlock` para permitir almacenamiento en cliente.
3. **Completar `VALID_WEB_ROUTES`**:
   - Añadir `/descargas`, `/version`, `/dispositivos`.

### [static/index.html](file:///home/servidor/servicios/dashboard/static/index.html) e [index.html](file:///home/servidor/servicios/dashboard/index.html)
1. **Soporte de Token en Peticiones `fetch`**:
   - Guardar el token en `localStorage` y adjuntar `X-Device-Token` en cada llamada a la API.
2. **Estilos Nativos de Nextcloud**:
   - Paleta de colores oficial: `--color-main-background: #181818;`, `--color-sidebar-bg: #1c1c1c;`, `--color-background-dark: #222222;`, `--color-primary: #0082c9;`, `--color-primary-element: #0091f2;`.
   - Reglas específicas para la clase `.in-nextcloud` para ajuste al 100% de altura sin scrollbars redundantes.

---

## Verificación

1. Comprobar cabecera CSP con `curl` verificando que `frame-ancestors` contiene `https://cminewar.duckdns.org`.
2. Verificar respuesta de `/api/metrics` con y sin cookie/token.
3. Reiniciar el servicio `system-dashboard.service`.
4. Verificar que `https://recursos.cminewar.duckdns.org` y `https://cminewar.duckdns.org/apps/external/3/` cargan correctamente.
5. Ejecutar `git push origin main` al repositorio GitHub `cminewarIA/recursos-ui`.
