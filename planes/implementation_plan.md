# Plan de Implementación - v8.3.5: Corrección Definitiva de Renderizado Nativo (Cairo/PyGObject) y Supresión de Lanzadores Auxiliares en el Box de Aplicaciones

## 📌 Contexto y Problema
El usuario reporta:
> *"la app al abrirse sige sin mostrar nada y sige instalando dos lanzadores mas en el box de aplicaciones"*

### Causas Raíz Confirmadas Técnicamente:
1. **Fallo de Renderizado Cairo en PyGObject (`TypeError: Couldn't find foreign struct converter for 'cairo.Context'`)**:
   - `CairoSparkline.on_draw` utiliza `cr` (`cairo.Context`). En PyGObject, la conversión del tipo extranjero de C a Python requiere obligatoriamente el paquete del sistema `python3-gi-cairo` y la importación de `cairo`.
   - Al faltar `python3-gi-cairo` en las dependencias (`Depends:` de `debian/control`) y no estar `import cairo`, cada ciclo de dibujado de GTK3 generaba excepciones continuas no capturadas de `TypeError` en los DrawingAreas de CPU, RAM y Red, haciendo que la ventana GTK no se dibujase y quedase totalmente vacía/en blanco.
   - Además, faltaba invocar explícitamente `self.show_all()` en `RecursosNativeWindow.__init__()` y en `RecursosNativeApp.do_activate()`, dejando los widgets hijos con `visible=False`.

2. **Aparición de dos lanzadores adicionales (`scrcpy` y `scrcpy-console`)**:
   - Al declarar `scrcpy` como dependencia directa del paquete Debian, el gestor `apt` instala el paquete oficial de Ubuntu `scrcpy`, el cual incluye `/usr/share/applications/scrcpy.desktop` y `/usr/share/applications/scrcpy-console.desktop`.
   - Estos lanzadores secundarios no tenían `NoDisplay=true` en su sección `[Desktop Entry]`, provocando que el Box de Aplicaciones de GNOME muestre dos aplicaciones extra no deseadas ("scrcpy" y "scrcpy (console)").

---

## 🛠️ Modificaciones Propuestas

### 1. `desktop_app/recursos_app.py`
- Añadir `import cairo` e importar soporte seguro de Cairo.
- Envolver `CairoSparkline.on_draw` en un bloque `try ... except Exception: pass` para garantizar tolerancia a fallos en el dibujado.
- Invocar `self.show_all()` en `RecursosNativeWindow.__init__()` y en `RecursosNativeApp.do_activate()`.

### 2. `packaging/debian/control`
- Incrementar versión a `8.3.5`.
- Añadir `python3-gi-cairo` y `python3-cairo` a la directiva `Depends:`.

### 3. `packaging/debian/postinst`
- Añadir lógica en la fase `configure` para inyectar automáticamente `NoDisplay=true` bajo `[Desktop Entry]` en `/usr/share/applications/scrcpy.desktop` y `/usr/share/applications/scrcpy-console.desktop`.
- Ejecutar `update-desktop-database /usr/share/applications`.

### 4. Sincronización Canónica y Documentación
- Actualizar `VERSION` a `8.3.5`.
- Actualizar `package.json` a `8.3.5`.
- Actualizar `README.md` (badges, banner ASCII y tabla de versiones con la fila `v8.3.5`).
- Crear `planes/walkthrough_v8.3.5.md` y actualizar `planes/walkthrough.md`.

### 5. Compilación, Instalación Local y Verificación (Regla 8)
- Ejecutar `bash packaging/build_deb.sh`.
- Instalar con `sudo apt-get install -y ./dist/recursos-cockpit_8.3.5_amd64.deb`.
- Verificar con `dpkg -l | grep recursos-cockpit`.
- Verificar con `/usr/bin/recursos-cockpit --test-mode`.
- Verificar con `Gio.AppInfo.get_all()` que `scrcpy` y `scrcpy-console` tienen `should_show() == False` y solo `recursos-cockpit` tiene `should_show() == True`.
- Verificar ejecución limpia en Wayland/X11 sin `TypeError`.
