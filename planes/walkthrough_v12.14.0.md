# Walkthrough de Implementación y Verificación — v12.14.0

## 1. Resumen de Cambios (v12.14.0)
- **Eliminación de la Barra de Navegación Superior (`src/App.tsx`)**:
  - Se retiró la barra de navegación superior duplicada (`<LayoutGroup id="desktop-nav"><nav aria-label={t('nav.desktop_aria')} ...>`) y el contenedor enmarcado fijo `.cockpit-topbar` (`md:sticky`), unificando el cambio de pantallas en el dock táctil inferior flotante y liberando el espacio superior de la interfaz.
- **Ampliación del Logotipo Oficial CMineWar (`src/App.tsx`, `static/manual.html`, `docs/index.html`, `server.py`, `desktop_app/recursos_app.py`)**:
  - En la aplicación principal (`src/App.tsx`), el emblema transparente `/recursos-cockpit.png` pasa de `48px / 62px` (`h-12 w-12 sm:h-[62px] sm:w-[62px]`) a **`80px / 112px`** (`h-20 w-20 sm:h-28 sm:w-28`) acompañado de tipografía de marca ampliada (`text-xl sm:text-2xl`).
  - Paridad visual aplicada también en el manual interactivo (`76×76 px`), la tarjeta de autenticación del servidor (`120×120 px`) y el lanzador nativo GTK 3 de Ubuntu (`140×140 px`).

## 2. Verificación Técnica
- Compilación de backend Python (`python3 -m py_compile server.py desktop_app/recursos_app.py`) y frontend (`npm run build`) sin errores.
- Generación, firma e instalación verificada del paquete Debian `./dist/recursos-cockpit_12.14.0_amd64.deb` (`--test-mode` OK).
