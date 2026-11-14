# Plan de Implementación — `v12.0.2` (`v2B.0.2`)

## Objetivo
Mejorar el contraste y la visibilidad de los botones nativos de ventana (**minimizar**, **maximizar** y **cerrar**) en la barra de título GTK 3 de la aplicación de Ubuntu (`desktop_app/recursos_app.py`).

## Cambios
1. En `NATIVE_CSS`, estilizar explícitamente `headerbar button.titlebutton` con fondo claro delimitado (`#f1f5f9`, borde `#cbd5e1`) e icono simbólico oscuro (`#0f172a`), más acento rojo suave (`#fee2e2` / `#b91c1c`) para el botón de cerrar (`.close`), evitando que queden invisibles sobre el fondo blanco cuando Ubuntu usa un tema oscuro (como Yaru Dark).
2. En `_apply_css()`, desactivar `gtk-application-prefer-dark-theme` para alinear los iconos simbólicos con la cabecera clara.
3. En `_build_headerbar()`, fijar `hb.set_decoration_layout(":minimize,maximize,close")` para garantizar que aparezcan siempre los tres controles de ventana, y añadir estilo consistente al botón de información (`btn_about`).
4. Sincronizar versión `12.0.2` (`v2B.0.2`), recompilar `static/index.html`, construir y firmar `dist/recursos-cockpit_12.0.2_amd64.deb` e instalarlo en el sistema.
