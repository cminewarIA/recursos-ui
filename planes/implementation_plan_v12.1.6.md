# Plan de Implementación — v12.1.6: Eliminación del Formato de Versión `2B` (`v2B.x.y`)

## 1. Objetivo
Suprimir el alias visual `2B` (`v2B.x.y`) para que todo el ecosistema (API REST, SPA React 19, app nativa Ubuntu GTK3/WebKit2, app Android Kotlin, manual web interactivo, gráficos SVG y `README.md`) muestre la versión semántica unificada `12.1.6` (`v12.1.6`) desde `./VERSION`.

## 2. Cambios Aplicados
1. **Backend y Middleware**:
   - [`server.py`](../server.py): `get_display_version()` devuelve directamente la versión real (`ver`) sin sustituir `"12."` por `"2B."`.
   - [`vite.config.ts`](../vite.config.ts): `getDisplayVersion()` devuelve `(pkgVer || readAppVersion()).trim()`.
2. **Frontend React 19**:
   - [`src/utils/formatters.ts`](../src/utils/formatters.ts): `getDisplayVersionString()` retorna `displayVer` o `rawVersion` directamente sin prefijo `2B.`.
   - [`src/App.tsx`](../src/App.tsx) y [`src/components/MoreView.tsx`](../src/components/MoreView.tsx): respaldos actualizados a `'12.1.6'`.
3. **Clientes Nativos (Ubuntu & Android)**:
   - [`desktop_app/recursos_app.py`](../desktop_app/recursos_app.py): `get_display_version()` retorna la cadena de versión exacta sin transformar `"12."` en `"2B."`.
   - [`android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt`](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt): `formatDisplayVersion()` retorna `"v$raw"`.
4. **Versionado y Documentación**:
   - Actualizados `VERSION`, `package.json`, `packaging/debian/control`, `~/.gemini/config/plugins/recursos-cockpit/plugin.json`, `static/manual.html`, `docs/index.html`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg` y `README.md` a `12.1.6`.
5. **Compilación y Despliegue Local**:
   - Compilación Frontend (`tsc --noEmit && vite build`), empaquetado firmado `recursos-cockpit_12.1.6_amd64.deb`, instalación local, verificación `--test-mode` y reinicio de `system-dashboard.service` en `:8085`.

