# Walkthrough de Implementación y Verificación — v12.1.0 (`v2B.1.0`)

**Fecha:** 2026-11-14  
**Tipo de cambio:** `MINOR` (`12.0.6` -> `12.1.0`, display `v2B.1.0`) conforme a la Regla 3.4 de `GEMINI.md`  
**Objetivo:** Convertir `README.md` en un Manual Web Interactivo autónomo en HTML5 con gráficos vectoriales, simuladores interactivos y consola REST integrada, enlazado de forma homogénea en el backend, frontend React 19, cliente nativo Ubuntu `.deb` y `docs/index.html`, junto con un `README.md` modernizado.

---

## 1. Resumen de Archivos Modificados y Creados

### Manual Web Interactivo y Documentación Pública (`docs/`)
- [`static/manual.html`](../static/manual.html) y [`docs/index.html`](../docs/index.html) (`84857` bytes, SHA-256 `5ec43b0c8731793a4bac7580b691e5c8c501b8cc3196c4f5ae3150b1eeb6d7f8`):
  - Documento HTML5 autónomo sin dependencias CDN externas, con variables CSS en modos Claro/Oscuro sincronizadas mediante `localStorage` (`recursos_theme`) y mensajería `postMessage` (`RECURSOS_THEME`).
  - Barra superior con barra de progreso de lectura, búsqueda rápida (`Ctrl+K`) y navegación lateral sticky basada en `IntersectionObserver`.
  - Diagrama SVG interactivo de arquitectura de 3 capas (Cliente Nativo/Web ↔ Gateway Zero-Trust + DuckDNS ↔ Kernel/Hardware Linux).
  - Simulador de telemetría en `<canvas>` HiDPI con tooltip interactivo y carga opcional en tiempo real desde `/api/metrics`.
  - Gráfico Donut SVG interactivo con hidratación dinámica de topología/métricas desde `/api/metrics`.
  - Simulador paso a paso de autenticación Zero-Trust HMAC, comparador entre cliente Ubuntu `.deb`, Android `.apk` y Web, consola REST interactiva en vivo (`/api/version`, `/api/metrics`, `/api/system/logs?limit=10`, `/api/auth/devices`, `/api/dns/duckdns`, `/api/telegram_bot`, `/api/dex/status`) y registro de cambios SemVer filtrable.

### Control de Versión (`Regla 3`)
- [`VERSION`](../VERSION): `12.0.6` -> `12.1.0`
- [`package.json`](../package.json): `"version": "12.1.0"`
- [`packaging/debian/control`](../packaging/debian/control): `Version: 12.1.0`, `Replaces: recursos-cockpit (<< 12.1.0)`, `Description: Recursos Cockpit (v2B.1.0) - Panel Unificado y Control DeX`
- [`src/App.tsx`](../src/App.tsx) y [`src/components/MoreView.tsx`](../src/components/MoreView.tsx): versiones de respaldo actualizadas a `'12.1.0'`.

### Rutas HTTP, Vite e Integración Nativa Ubuntu
- [`server.py`](../server.py): refactorización mediante `_serve_html_with_bootstrap(self, auth, html_path, is_dashboard=True)` en `DashboardHTTPHandler` para servir `static/manual.html` (con respaldo `docs/index.html`) en las rutas `/manual`, `/manual.html` y `/readme` con inyección de versión bootstrap (`window.__INITIAL_APP_VERSION__`) y verificación Zero-Trust.
- [`desktop_app/recursos_app.py`](../desktop_app/recursos_app.py): parametrización de `_serve_html(self, target_html_path=None)` en `LocalHtmlBridgeServer` y resolución de `/manual`, `/manual.html` y `/readme` mediante `resolve_static_asset_path("manual.html")` (con respaldo `docs/index.html`) para evitar cargas recursivas de `index.html` dentro del WebView nativo de Ubuntu.
- [`vite.config.ts`](../vite.config.ts): extensión de `realOsTelemetryMiddleware` para servir `/manual`, `/manual.html` y `/readme` en el servidor de desarrollo local.
- [`packaging/build_deb.sh`](../packaging/build_deb.sh): copia explícita de `static/manual.html` (con respaldo `docs/index.html`) hacia `/usr/lib/recursos-cockpit/static/manual.html` dentro del paquete `.deb`.

### Interfaz React 19 y Documentación del Repositorio
- [`src/utils/formatters.ts`](../src/utils/formatters.ts): mapeo de rutas `/manual`, `/manual.html`, `/readme`, `/ayuda` y `/docs` en `normalizeExternalRoute` (`-> 'mas'`) y `extractInitialSubTabFromRoute` (`-> 'manual'`).
- [`src/components/MoreView.tsx`](../src/components/MoreView.tsx): nueva subpestaña `manual` (`"Manual interactivo"`, icono `BookOpen`), referencia `manualIframeRef` con sincronización automática de tema vía `postMessage`, enlace `"Abrir en pantalla completa"` hacia `/manual` y visor embebido `<iframe src="/manual" />`.
- [`README.md`](../README.md): encabezado modernizado con insignia `v2B.1.0 (12.1.0)`, acceso destacado al Manual Web Interactivo, descargas históricas colapsables (`v12.0.6`–`v6.0.2`), 2 diagramas Mermaid (arquitectura de 3 capas y secuencia Zero-Trust), tabla de las 5 vistas principales, tabla REST, guía de despliegue e historial completo preservado con nueva entrada `v12.1.0 (v2B.1.0)`.
- [`planes/implementation_plan_v12.1.0.md`](./implementation_plan_v12.1.0.md) y [`planes/walkthrough_v12.1.0.md`](./walkthrough_v12.1.0.md).

---

## 2. Verificaciones Ejecutadas y Resultados Observados

| Prueba / Comando | Resultado Observado | Estado |
| :--- | :--- | :--- |
| Validación JS embebido (`static/manual.html` -> `node --check -`) | Salida con código `0` sin errores de sintaxis | Superado |
| Integridad idéntica `sha256sum static/manual.html docs/index.html` | Ambos archivos coinciden (`5ec43b0c8731793a4bac7580b691e5c8c501b8cc3196c4f5ae3150b1eeb6d7f8`, `84857` bytes) | Superado |
| Compilación estática Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`) | Código de salida `0` en ambos archivos | Superado |
| Frontend TypeScript + Vite (`tsc --noEmit` + `vite build`) | `tsc --noEmit` sin errores; `vite build` transformó `1669` módulos en `554ms` generando `static/index.html` (`397799` bytes) | Superado |
| Compilación y firma `.deb` (`bash packaging/build_deb.sh`) | Generados `dist/recursos-cockpit_12.1.0_amd64.deb` y `dist/SHA256SUMS.txt` | Superado |
| Contenido del `.deb` (`dpkg -c ./dist/recursos-cockpit_12.1.0_amd64.deb`) | Incluye `./usr/lib/recursos-cockpit/static/manual.html` (`84857` bytes) y `./usr/lib/recursos-cockpit/static/index.html` (`397799` bytes) | Superado |
| Instalación local (`sudo apt-get install --reinstall -y ./dist/recursos-cockpit_12.1.0_amd64.deb`) | Paquete instalado sin errores | Superado |
| Smoke test nativo (`/usr/bin/recursos-cockpit --test-mode`) | `[OK] Recursos Native Ubuntu HTML5 App v12.1.0 validated successfully.` y `[OK] Bundled Canonical HTML5 UI: /usr/lib/recursos-cockpit/static/index.html (Bridge Port Test: 36903)` | Superado |
| Registro APT local (`dpkg -l \| grep recursos-cockpit`) | `ii  recursos-cockpit  12.1.0  amd64  Recursos Cockpit (v2B.1.0) - Panel Unificado y Control DeX` | Superado |
| Servidor HTTP efímero `server.DashboardHTTPHandler` (`127.0.0.1:0`) | `/api/version` -> `200` (`12.1.0` / `2B.1.0`); `/manual`, `/manual.html`, `/readme` -> `200`, `len=84846`, `window.__INITIAL_APP_VERSION__ = "12.1.0"` inyectado | Superado |
| Servidor puente nativo `LocalHtmlBridgeServer.start()` (`127.0.0.1:0`) | `/` -> `200` (`len=398182`, `ubuntu_flag=True`); `/manual`, `/manual.html`, `/readme` -> `200` (`len=85203`, `ubuntu_flag=True`, `<title>Manual Interactivo · Panel de Recursos (Cockpit)</title>`) | Superado |

---

## 3. Pasos Finales de Publicación y Despliegue en Servicio Activo
1. Confirmar los archivos en Git, crear la etiqueta anotada `v12.1.0` y publicar en `origin main --tags` (`Regla 9`).
2. Sincronizar `/home/servidor/servicios/dashboard` con `git pull origin main`, reiniciar `system-dashboard.service` y comprobar respuestas en vivo en `http://127.0.0.1:8085/api/version`, `/manual` y `/readme`.
