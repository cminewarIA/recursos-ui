# Plan de Implementación — Manual Web Interactivo y Rediseño Visual de Documentación (`v12.1.0` · `v2B.1.0`)

## 1. Objetivo
Convertir la documentación del proyecto (`README.md`) en un **Manual Web Interactivo** moderno, autocontenido, con gráficos dinámicos HiDPI Canvas y SVG clicables, simuladores de telemetría y Zero-Trust, comparador de plataformas y consola API REST en vivo, accesible tanto de forma autónoma (`/manual`, `/manual.html`, `/readme` y `docs/index.html`) como integrado dentro de la aplicación React 19 (`Más → Manual interactivo`) y de la app nativa Ubuntu (`.deb`).

## 2. Incremento Semántico (`VERSION`)
- **Versión anterior**: `12.0.6` (`v2B.0.6`).
- **Versión nueva**: `12.1.0` (`v2B.1.0`) — Incremento `MINOR` según la Regla 3.4 de `GEMINI.md` por adición de nueva funcionalidad visual e interactiva.
- **Archivos sincronizados**: `./VERSION`, `package.json`, `packaging/debian/control`, `src/App.tsx`, `src/components/MoreView.tsx`, `README.md`, `static/manual.html`, `docs/index.html`.

## 3. Cambios Implementados por Módulos

### 3.1 Manual Web Interactivo (`static/manual.html` y `docs/index.html`)
- Interfaz autocontenida en español (`es-ES`) sin dependencias externas bloqueantes y 100% *Zero-Hardcoding*.
- Soporte de temas **Claro Minimalista** y **Oscuro** sincronizados mediante `localStorage.getItem('recursos_theme')`, eventos `storage` y mensajes `postMessage` (`RECURSOS_THEME`).
- Buscador instantáneo en cabecera (`Ctrl+K`), barra de progreso de lectura e índice lateral sticky con `IntersectionObserver`.
- Módulos interactivos incluidos:
  1. **Explorador SVG de Arquitectura (3 Capas)**: nodos clicables de Kernel/Hardware, Backend Python Async (`8 workers`, byte-splicing, bóveda `AES-256-GCM`) y Ecosistema React 19 / Ubuntu WebKit2 / Android WebView.
  2. **Simulador Gráfico HiDPI Canvas de Telemetría**: controles deslizantes para CPU, RAM+ZRAM, GPU y Disco (`MB/s` + `%` ocupado) con cálculo de umbrales de salud y botón para cargar datos reales del nodo (`/api/metrics`).
  3. **Donut SVG de Topología ASUS AiMesh & Pi-hole**: filtros por banda (`Cable LAN`, `Wi-Fi 5 GHz`, `Wi-Fi 2.4 GHz`) e hidratación dinámica en vivo desde `/api/metrics` (`wifi_summary`).
  4. **Simulador Zero-Trust HMAC-SHA256**: recorrido paso a paso de escenarios LAN, WAN emparejado e Intruso / Fail2ban.
  5. **Comparador de Plataformas y Descargas Directas**: `.deb`, `.apk` y Web SPA con comandos copiables en 1 clic.
  6. **Consola Live API Inspector**: prueba en vivo sobre `/api/version`, `/api/metrics`, `/api/system/logs`, `/api/auth/devices`, `/api/dns/duckdns`, `/api/telegram_bot` y `/api/dex/status`.

### 3.2 Backend, App Nativa Ubuntu, Vite y Frontend React 19
- **`server.py`**: Extracción de `_serve_html_with_bootstrap()` y soporte de `/manual`, `/manual.html` y `/readme` respetando el guardián Zero-Trust (`check_trust_status`).
- **`desktop_app/recursos_app.py`**: Parametrización de `_serve_html(target_html_path=None)` y manejo de `/manual`, `/manual.html` y `/readme` en `LocalHtmlBridgeServer.do_GET` para servir `manual.html` sin recursión en Ubuntu WebKit2.
- **`vite.config.ts`**: Despacho de `static/manual.html` / `docs/index.html` en `/manual`, `/manual.html` y `/readme` durante desarrollo.
- **`src/components/MoreView.tsx` & `src/utils/formatters.ts`**: Nueva subpestaña `'manual'` (`BookOpen` — *Manual interactivo*) con botón a pantalla completa (`/manual`) e `<iframe>` con sincronización de tema por `postMessage`, además de mapeo de rutas `/manual`, `/readme`, `/ayuda`, `/docs`.
- **`packaging/build_deb.sh`**: Inclusión de `static/manual.html` en `/usr/lib/recursos-cockpit/static/manual.html`.

### 3.3 Modernización de `README.md`
- Eliminación del antiguo banner ASCII de `v11` e incorporación de enlaces directos al Manual Interactivo (`/manual` y `docs/index.html`), diagramas Mermaid actualizados a `v12.1.0` (`v2B.1.0`), enlaces de descarga `12.1.0` y registro del cambio `v12.1.0` (`MINOR`) en la tabla histórica.

## 4. Plan de Verificación
1. `npm run lint && npm run build` sin errores de TypeScript o empaquetado.
2. Compilación de `dist/recursos-cockpit_12.1.0_amd64.deb` (`bash packaging/build_deb.sh`) e instalación local (`sudo apt-get install --reinstall -y`).
3. Ejecución de `/usr/bin/recursos-cockpit --test-mode` y comprobación `dpkg -l | grep recursos-cockpit`.
4. Comprobación en producción de `/api/version`, `/manual` y `/readme` tras `git push origin main --tags` y reinicio de `system-dashboard.service`.
