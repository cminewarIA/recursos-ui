# Walkthrough de Verificación — Rediseño Integral, Submenús Independientes y Blindaje `server.py`

> Versión canónica: consultar [`../VERSION`](../VERSION) (`14.0.0`).

## 1. Resumen Ejecutivo de Cambios

1. **Rediseño Completo de Navegación y Viewport (100 % Ancho Completo)**:
   - Se eliminó la barra lateral fija de escritorio y se consolidó una **barra superior editorial limpia** (nodo + ruta activa, disparador `Ctrl+K` de buscador rápido, estado de salud, selector de tema e indicador de versión) junto a un **dock flotante obsidiana centrado** (`NavigationSidebar`) con animación `MorphPill` en todos los tamaños de pantalla.
   - Se incorporó el **buscador rápido global (`GlobalSearchModal`, `Ctrl+K` / `Cmd+K`)** que indexa las 5 áreas principales, todas las páginas independientes de submenús (mostrando su URL semántica como `/red/testdevelocidad`), procesos en vivo (`metrics.system_processes`), dispositivos LAN (`metrics.wifi_clients`) y contenedores Docker (`metrics.docker_activities`).
   - Se completaron las 7 claves `search.*` en `./i18n/dictionary.csv` a través de los 31 idiomas europeos (33 columnas totales).

2. **Reorganización Modular por Dominio Natural (Cero Duplicidades)**:
   - `/equipo/*` (`EquipmentView`): dedicado exclusivamente a silicio y hardware físico (`cpu`, `ram`, `gpu`, `storage`). Se retiró el submenú duplicado de procesos y sus accesos directos redirigen limpiamente a `/programas/procesos`.
   - `/programas/*` (`AppsMediaView`): centraliza el 100 % de las cargas de trabajo de software en 5 módulos independientes (`procesos` con `ProcessHistoryStackedChart`, `contenedores`, `servicios`, `multimedia`, `bots`).
   - `/red/*` (`NetworkSecurityView`): reorganizado en `resumen`, `trafico`, `mapa`, `testdevelocidad`, `seguridad` y `dns`.
   - `/mas/*` (`MoreView`): consolidado en `actualizaciones`, `dispositivos`, `manual` y `dex` (exclusivo de la app nativa Ubuntu).

3. **Páginas Independientes con URL Propia para Cada Submenú (Norma 3.6 en `GEMINI.md`)**:
   - Se documentó la nueva norma permanente **3.6 (Rutas Independientes y Enlaces Profundos para Submenús)** en `./GEMINI.md`.
   - Se implementó resolución bidireccional (`resolveAppRoute`, `normalizeSubTabForView`, `formatCanonicalRoute`) sincronizada con `window.history.pushState`, `popstate` (Atrás/Adelante del navegador) y `document.title`:

| Dominio | Ruta canónica independiente | Alias aceptados |
| :--- | :--- | :--- |
| Inicio | `/` | `/inicio` |
| Equipo · CPU | `/equipo/cpu` | `/equipo/procesador`, `/cpu` |
| Equipo · RAM | `/equipo/ram` | `/equipo/memoria`, `/ram` |
| Equipo · GPU | `/equipo/gpu` | `/equipo/grafica`, `/gpu` |
| Equipo · Almacenamiento | `/equipo/almacenamiento` | `/equipo/storage`, `/equipo/discos`, `/almacenamiento` |
| Red · Resumen y LAN | `/red/resumen` | `/red/home`, `/red/live`, `/red/devices` |
| Red · Tráfico | `/red/trafico` | `/red/traffic`, `/red/historial` |
| Red · Mapa GeoIP | `/red/mapa` | `/red/map`, `/red/geoip` |
| Red · Test de velocidad | `/red/testdevelocidad` | `/red/speedtest`, `/red/velocidad`, `/testdevelocidad`, `/speedtest` |
| Red · Seguridad IPS | `/red/seguridad` | `/red/security`, `/red/shield`, `/red/escudo` |
| Red · DNS / Pi-hole | `/red/dns` | `/red/duckdns`, `/red/pihole` |
| Programas · Procesos | `/programas/procesos` | `/programas/processes`, `/procesos` |
| Programas · Contenedores | `/programas/contenedores` | `/programas/containers`, `/programas/docker` |
| Programas · Servicios | `/programas/servicios` | `/programas/services`, `/programas/systemd` |
| Programas · Multimedia | `/programas/multimedia` | `/programas/media`, `/programas/descargas` |
| Programas · Bots | `/programas/bots` | `/programas/telegram` |
| Más · Actualizaciones y Sistema | `/mas/actualizaciones` | `/mas/updates`, `/mas/ajustes`, `/mas/health`, `/mas/cloud` |
| Más · Dispositivos y Confianza | `/mas/dispositivos` | `/mas/devices`, `/mas/security` |
| Más · Manual | `/mas/manual` | `/manual` |
| Más · Pantalla USB DeX | `/mas/dex` | `/dex` |

4. **Corrección Definitiva de Pantalla en Blanco en `python3 server.py`**:
   - Se añadió `is_valid_web_route()` en `server.py` (con límite de 1–2 segmentos y bloqueo de `/api/*`, `/assets/*` y ficheros no HTML) para que cualquier recarga directa en rutas anidadas como `/red/testdevelocidad` devuelva `200 OK` en lugar de `404`.
   - Se añadió soporte nativo `/assets/*` en `server.py` con protección anti path-traversal y cabeceras MIME exactas (`.js`, `.mjs`, `.css`, `.svg`, `.png`, `.woff2`, `.json`), resolviendo contra `dist/assets`, `static/assets`, `static`, `dist` y `desktop_app/assets`.
   - Se endureció `_serve_html_with_bootstrap` usando `rsplit('</head>', 1)` para evitar cualquier sustitución accidental dentro de cadenas JS inlined.
   - Se mejoró `emitStandaloneStaticHtmlPlugin()` en `vite.config.ts` para purgar hashes antiguos de `static/assets/`, espejar limpiamente el build vigente y situar el `<script type="module">` compilado justo antes de `</body>` (garantizando que `<div id="root"></div>` siempre exista antes de ejecutarse en cualquier navegador o WebView).

## 2. Matriz de Verificación Ejecutada

| Comprobación | Resultado | Detalle |
| :--- | :---: | :--- |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | ✅ PASS | 0 errores de tipos ni símbolos sin uso |
| `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py` | ✅ PASS | Sintaxis Python válida en backend y app Ubuntu |
| Integridad `./i18n/dictionary.csv` | ✅ PASS | 1067 filas × 33 columnas, 0 filas malformadas, 0 claves duplicadas |
| `npm run build` + `static/index.html` | ✅ PASS | `dist/` y `static/index.html` (`2.73 MB`) + espejo limpio `static/assets/` |
| `node --check` sobre JS inline en `static/index.html` | ✅ PASS | Código ES module sintácticamente íntegro y montado tras `#root` |
| Pruebas unitarias de `is_valid_web_route()` (`server.py`) | ✅ PASS | 28 rutas válidas aceptadas (incl. `/red/testdevelocidad`), 5 inválidas rechazadas con 404 |
| Pruebas HTTP en vivo (`http://127.0.0.1:3000`) | ✅ PASS | `200 OK` en `/`, `/red/testdevelocidad`, `/equipo/almacenamiento`, `/programas/procesos`, `/mas/actualizaciones`, `/api/version` |
| Empaquetado Debian (`bash packaging/build_deb.sh`) | ✅ PASS | `dist/recursos-cockpit_14.0.0_amd64.deb` generado y firmado con GPG + `SHA256SUMS.txt` |
| `compile_applet` + `lint_applet` | ✅ PASS | Validación final simultánea sin errores |
