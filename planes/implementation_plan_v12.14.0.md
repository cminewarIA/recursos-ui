# Plan de Implementación — v12.14.0

## 1. Objetivo
- Eliminar la barra de navegación superior en la cabecera principal para unificar toda la navegación de vistas en el dock inferior flotante y liberar el espacio superior sin marcos ni barras fijas superpuestas.
- Ampliar significativamente el tamaño del logotipo oficial transparente (`/recursos-cockpit.png`) en la cabecera principal y mantener la paridad visual en el manual interactivo, la pantalla de acceso y la aplicación nativa de Ubuntu.

## 2. Cambios Planificados
1. **`src/App.tsx`**:
   - Eliminar el bloque `<LayoutGroup id="desktop-nav"><nav aria-label={t('nav.desktop_aria')} ...>` de la cabecera superior y retirar la caja envolvente `.cockpit-topbar` (`md:sticky`), dejando una cabecera limpia y despejada directamente sobre el lienzo.
   - Aumentar el tamaño del logotipo principal `/recursos-cockpit.png` de `h-12 w-12 sm:h-[62px] sm:w-[62px]` (`48px`/`62px`) a `h-20 w-20 sm:h-28 sm:w-28` (`80px`/`112px`) con tipografía proporcionada.
2. **Paridad de Ecosistema (`static/manual.html`, `docs/index.html`, `server.py`, `desktop_app/recursos_app.py`)**:
   - Ampliar `.brand-logo` en `static/manual.html` y `docs/index.html` (`52px` → `76px`).
   - Ampliar `.brand-logo` en `server.py` (`96px` → `120px`).
   - Ampliar el emblema del lanzador GTK en `desktop_app/recursos_app.py` (`116×116` → `140×140`).
3. **Documentación y Empaquetado (`README.md`, `./VERSION`, `.deb`)**:
   - Incrementar `./VERSION` a `12.14.0` (`MINOR` según Regla 2.4 de `GEMINI.md`).
   - Sincronizar `README.md`, compilar el bundle frontend (`npm run build`) y generar/verificar el paquete nativo `./dist/recursos-cockpit_12.14.0_amd64.deb`.
