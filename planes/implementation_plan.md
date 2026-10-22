# Integración de Identidad Visual Oficial (Logo Dragón Rojo): Icono App .deb y Favicon Web

## Análisis de las Imágenes Proporcionadas

El usuario ha facilitado dos versiones del logotipo oficial con temática de Dragón Rojo y Emblema Central:

1. **Versión PNG (`media_1792708422206.png`, 523×500 RGBA)**:
   - Dragón carmesí con textura detallada envuelto sobre un símbolo/emblema central en **color negro**.
   - Fondo con canal alfa transparente y partículas/salpicaduras anaranjadas.
   - *Comportamiento*: Al tener el símbolo central negro, sobre pestañas de navegador en modo oscuro o docks oscuros de Linux (GNOME/Ubuntu) el centro pierde contraste si no tiene marco.

2. **Versión JPG (`media_1792708422246.jpg`, 1024×978 RGB)**:
   - Dragón carmesí de alta definición sobre el símbolo/emblema central en **blanco puro resplandeciente**.
   - Fondo negro espacial profundo con destellos, chispas incandescentes y efecto de fuego ardiente.
   - *Comportamiento*: Máximo contraste y legibilidad en entornos oscuros (coherente con el diseño *Space Black / Apple Liquid Glass / Tesla UI* del sistema).

---

## Opciones de Diseño para el Usuario

### Opción 1: Insignia Squircle GNOME / Apple (Recomendada para la App .deb)
- Se utiliza la versión de alta resolución con fondo negro y símbolo blanco, recortada con una máscara de **superelipse / squircle** (`rx=220` a 1024px) y un delicado bisel perimetral de fuego/titanio.
- **Resultado**: Estilo premium estándar de GNOME/macOS, perfecto para el lanzador de aplicaciones de Linux, menú inicio y dock de Ubuntu.

### Opción 2: Favicon de Alto Contraste para la Pestaña del Navegador
- A escala diminuta (16×16 y 32×32), los detalles sutiles se pierden. Se genera un icono multirresolución (`.ico` y `.png`) enfocado en el núcleo del dragón y el emblema blanco para que sea **100% nítido y reconocible** en la pestaña de cualquier navegador (Chrome, Firefox, Safari, Edge).

---

## Decisiones y Puntos Clave

> [!IMPORTANT]
> **Elección de Estilo para el Icono de la App .deb**:
> - **Variante A (Insignia Squircle con Fondo Negro y Chispas)**: Proporciona la apariencia más pulida e integrada en escritorios Linux modernos (estilo Adwaita/macOS).
> - **Variante B (Silueta Recortada con Fondo Transparente)**: El dragón con su halo transparente sin contenedor squircle.
>
> **Favicon del Navegador**: Se recomienda la versión con el símbolo central blanco y halo oscuro/resplandeciente para garantizar contraste perfecto tanto en pestañas de tema oscuro como claro.

---

## Plan de Cambios Propuestos

### 1. Activos Gráficos del Proyecto (`desktop_app/assets/` y `static/`)
- `desktop_app/assets/recursos-cockpit.png`: Icono en alta resolución (512×512 y 1024×1024) para la app de escritorio Linux.
- `desktop_app/assets/recursos-cockpit-logo.png`: Logotipo oficial en su resolución original para la cabecera y el diálogo "Acerca de".
- `static/favicon.ico`: Archivo ICO estándar con capas multirresolución (16×16, 32×32, 48×48) para compatibilidad total con todos los navegadores web.
- `static/favicon.png`: Favicon moderno PNG de alta resolución (32×32, 192×192) y `apple-touch-icon.png` (180×180).

### 2. Empaquetado Debian (`packaging/build_deb.sh`)
- Instalar los iconos en las rutas del estándar XDG de FreeDesktop:
  - `/usr/share/icons/hicolor/512x512/apps/recursos-cockpit.png`
  - `/usr/share/icons/hicolor/256x256/apps/recursos-cockpit.png`
  - `/usr/share/icons/hicolor/128x128/apps/recursos-cockpit.png`
  - `/usr/share/icons/hicolor/64x64/apps/recursos-cockpit.png`
  - `/usr/share/icons/hicolor/48x48/apps/recursos-cockpit.png`
  - `/usr/share/pixmaps/recursos-cockpit.png`
  - `/usr/lib/recursos-cockpit/assets/`
- Actualizar el lanzador `.desktop` para referenciar el nuevo icono.

### 3. Aplicación Nativa GTK 3 (`desktop_app/recursos_app.py`)
- Asignar el icono a la ventana principal de GTK con `set_icon_from_file(...)`.
- Enriquecer el diálogo nativo `Gtk.AboutDialog` con el logotipo oficial de alta fidelidad.

### 4. Servidor Web Backend (`server.py`)
- Servir de forma explícita `/favicon.ico`, `/favicon.png` y `/apple-touch-icon.png` desde `STATIC_DIR` con tipos MIME exactos (`image/x-icon`, `image/png`), cabeceras de caché eficiente (`Cache-Control: public, max-age=86400`) y cabeceras de seguridad.

### 5. Frontend Web (`static/index.html` e `index.html`)
- Añadir en `<head>`:
  ```html
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  ```
- Replicar cambios de forma idéntica en `index.html`.

### 6. Control de Versión y Documentación
- `VERSION` -> `8.3.0` (adición de identidad visual, nuevo subsistema de favicons e iconografía nativa del sistema).
- `README.md`: Actualizar badges y tabla de versiones con la entrega `v8.3.0`.
