# Plan de Implementación — Recursos Cockpit v14.6.0 · Ubuntu Native v1.3.0

## Objetivo
Rediseñar la aplicación nativa de escritorio de Ubuntu (`desktop_app/recursos_app.py`) para eliminar la barra superior nativa GTK (`HeaderBar`) y el lanzador previo de 3 tarjetas, abriendo directamente la interfaz web canónica del servidor a pantalla completa con autodescubrimiento y conexión LAN automática, e integrando los controles de ventana, conexión, nodo local y *Acerca de* dentro de la propia interfaz del servidor web —desbloqueados **exclusivamente** en el cliente nativo de Ubuntu con el mismo mecanismo que DeX USB (`isUbuntuNative`).

## Análisis y Justificación de Ubicación (Regla 3.1 de `GEMINI.md`)
- **Controles de ventana en cabecera (`src/App.tsx`)**: al suprimir la barra de título nativa del sistema (`set_decorated(False)` + `fullscreen()`), el usuario necesita acceso inmediato desde cualquier vista para minimizar, maximizar/restaurar, alternar pantalla completa (`F11`) o cerrar (`Ctrl+Q`), así como ver el estado de conexión (`LAN`/`WAN`/`LOCAL`). Ubicarlos discretamente en la zona derecha de `.cockpit-topbar` **únicamente cuando `isUbuntuNative` es verdadero** garantiza cero ruido en navegadores web o Android.
- **Panel de control de escritorio en `/sistema/ubuntu` (`src/components/MoreView.tsx`)**: pertenece al dominio `/sistema` junto a `/sistema/dex` (también desbloqueado exclusivamente en Ubuntu nativa), manteniendo coherencia funcional total sin duplicar funciones de actualizaciones (`.deb`/`.apk` en `/sistema/actualizaciones`) ni de DeX (`/sistema/dex`), enlazando a ambas en un clic.

## Cambios Técnicos Implementados
1. **App Nativa Ubuntu (`desktop_app/recursos_app.py`, `UBUNTU_VERSION=1.3.0`)**:
   - Eliminados `_build_headerbar()`, `self.set_titlebar(hb)`, el lanzador GTK de 3 tarjetas, el `AboutDialog` nativo y sus estilos CSS / dependencias GTK muertas (`cairo`, `Pango`, `GdkPixbuf`).
   - Ventana sin decoraciones (`self.set_decorated(False)`), inicio directo a pantalla completa (`self.fullscreen()`) y carga inmediata de `WebKit2` edge-to-edge con sincronización de estado vía `window-state-event` (`recursos-ubuntu-window-state`).
   - Autodescubrimiento LAN automático mejorado en `ServerConnectionManager.discover_server()` con sondeo por `avahi-browse -rpt _recursos._tcp`, loopback, octetos frecuentes y escaneo paralelo de subred `/24` (`ThreadPoolExecutor`) antes del fallback a DDNS WAN.
   - Nuevos endpoints locales de puente loopback en `LocalHtmlBridgeServer`: `GET /api/native/ubuntu-control`, `POST /api/native/window`, `POST /api/native/connection` y `POST /api/native/local-node`, además de `window.webkit.messageHandlers.recursosWindow`.
2. **Interfaz Web y Servidor (`server.py`, `src/`, `i18n/dictionary.csv`, `VERSION=14.6.0`)**:
   - Rutas SPA y backend `/sistema/ubuntu` y `/ubuntu` en `server.py` y `src/utils/formatters.ts`.
   - Tipos `UbuntuNativeControlPayload` y `UbuntuNativeWindowState` en `src/types/telemetry.ts`, helper `sendUbuntuWindowAction` en `src/utils/api.ts`.
   - Controles de ventana exclusivos `isUbuntuNative` en `src/App.tsx` e integración en `GlobalSearchModal.tsx`.
   - Nueva subpestaña `/sistema/ubuntu` en `src/components/MoreView.tsx` con estado pasivo bloqueado cuando `!isUbuntuNative`.
   - Registro completo de 32 claves nuevas en `./i18n/dictionary.csv` con traducciones en las 31 columnas de idioma.
