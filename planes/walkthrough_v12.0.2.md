# Walkthrough y Verificación — `v12.0.2` (`v2B.0.2`)

## Cambios Aplicados (`desktop_app/recursos_app.py`)
- Añadido CSS explícito para `headerbar .title`, `headerbar .subtitle`, `headerbar button.titlebutton` (minimizar, maximizar y cerrar) e iconos simbólicos (`-gtk-icon-style: symbolic; color: inherit;`), evitando iconos blancos invisibles sobre la barra blanca bajo temas oscuros de Ubuntu.
- Establecido `gtk-application-prefer-dark-theme = False` y `hb.set_decoration_layout(":minimize,maximize,close")`.

## Verificación
- Comprobación de sintaxis Python (`python3 -m py_compile desktop_app/recursos_app.py`).
- Compilación del frontend (`npm run build`), empaquetado y firma GPG (`bash packaging/build_deb.sh`), instalación local de `dist/recursos-cockpit_12.0.2_amd64.deb`, prueba `/usr/bin/recursos-cockpit --test-mode` y verificación `compile_applet` + `lint_applet`.
