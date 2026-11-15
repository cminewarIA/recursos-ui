# Plan de Implementación — Recursos Cockpit `v12.7.2`

**Fecha**: 2026-11-15  
**Versión previa**: `12.7.1` (`a4bb957` + tag `v12.7.1`)  
**Versión objetivo**: `12.7.2` (`PATCH` según `GEMINI.md` Regla 2.4: ajuste visual de identidad corporativa, tamaño del logotipo en la barra superior, banner de Android TV con logo y nombre de la app, y preservación completa de transparencias alfa en Android, Android TV, Ubuntu y Web)

---

## 1. Diagnóstico en Activos e Interfaces

1. **Barra superior web y nativa (`src/App.tsx`, `static/manual.html`)**:
   - `src/App.tsx` encapsulaba `/recursos-cockpit.png` en un círculo opaco con borde (`h-9 w-9 rounded-full border bg-sky-50/80 p-1`), reduciendo el emblema efectivo a ~`26 × 26 px` y ocultando sus transparencias sobre la barra Liquid Glass.
   - `static/manual.html` presentaba una caja opaca similar (`36 × 36 px` con relleno y borde) apuntando a `/favicon-192x192.png`.

2. **Android TV Leanback (`android_app/app/src/main/res/drawable-xhdpi/tv_banner.png`)**:
   - El banner actual (`640 × 360`, `RGB` sin canal alfa) mostraba un icono genérico de onda cardíaca sobre fondo opaco `#0F172A`, sin utilizar el logotipo oficial ni mostrar transparencias.

3. **Iconos de Android y Pantalla de Carga (`android_app/app/src/main/res/mipmap-*/`, `CockpitDashboard.kt`)**:
   - Todos los iconos `mipmap-*/ic_launcher.png` tenían un cuadrado blanco sólido (`non_opaque=0.0%`), y `ic_launcher_round.png` un círculo blanco sólido detrás del logotipo.
   - `CockpitDashboard.kt` cargaba `R.mipmap.ic_launcher` a `64.dp` con `.clip(RoundedCornerShape(16.dp))`, recortando las alas y mostrando el fondo blanco en el arranque.

4. **Ubuntu y Favicons (`desktop_app/assets/`, `public/`, `static/`, `desktop_app/recursos_app.py`)**:
   - `desktop_app/assets/recursos-cockpit-16.png` y `public/favicon-16x16.png` estaban en modo indexado (`P`) sin transparencia alfa (`NO_ALPHA`).
   - `desktop_app/assets/recursos-cockpit.png` / `-1024.png` / `.svg` contenían margen extra (~10 %) reduciendo el tamaño percibido en Dock y lanzador de Ubuntu; `desktop_app/recursos_app.py` renderizaba `88 × 88` en la tarjeta inicial.
   - `public/apple-touch-icon.png` conservaba un fondo blanco sólido.

---

## 2. Cambios Planificados

1. **Regeneración Unificada de Activos PNG/ICO/SVG RGBA Transparentes**:
   - Tomar `public/recursos-cockpit.png` (`1024 × 1024` RGBA transparente verificado) recortado al cuadro exacto del emblema (`bbox (0, 61, 1024, 928)`) centrado con margen mínimo (~2 %) y transparencia alfa intacta (`alpha = 0` exterior e interior):
     - **Android**: `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/{ic_launcher,ic_launcher_round}.png` totalmente transparentes (sin fondo blanco cuadrado/circular) + `drawable/app_logo.png` (`512 × 512` RGBA) para la interfaz Compose.
     - **Android TV**: `drawable-xhdpi/tv_banner.png` (`640 × 360` RGBA) y `drawable-xxhdpi/tv_banner.png` (`960 × 540` RGBA) sobre lienzo transparente RGBA con el logotipo CMineWar a la izquierda y el nombre de la aplicación (**`Recursos Cockpit`** + subtítulo **`Panel del Servidor`**) con contorno y sombra oscuros para legibilidad universal manteniendo visibles todas las transparencias del logo.
     - **Ubuntu & Web**: todos los tamaños `desktop_app/assets/recursos-cockpit-{16,32,48,64,128,256,512,1024}.png`, `recursos-cockpit.png`, `recursos-cockpit.svg`, `public/favicon-{16x16,32x32,192x192,512x512}.png`, `favicon.png`, `favicon.ico` (multirresolución RGBA), `apple-touch-icon.png` y réplica en `static/`.

2. **Barra Superior Web/Híbrida y App Nativa Ubuntu/Android**:
   - `src/App.tsx`: ampliar la barra superior (`min-h-[68px] sm:min-h-[76px]`), retirar la cápsula circular opaca alrededor del logo y mostrar `/recursos-cockpit.png` directamente con transparencia sobre la barra a `h-12 w-12 sm:h-[62px] sm:w-[62px]`.
   - `static/manual.html` y `docs/index.html`: ampliar `.brand-logo` a `52 × 52 px` transparente sin borde ni fondo opaco usando `/recursos-cockpit.png`.
   - `server.py`: ampliar `.brand-logo` en pantalla de acceso (`96 × 96 px`).
   - `desktop_app/recursos_app.py`: ampliar logotipo inicial en `.launcher-hero` (`88 × 88` → `116 × 116`).
   - `android_app/.../CockpitDashboard.kt`: usar `R.drawable.app_logo` transparente a `104.dp` sin recorte `.clip(...)`.

3. **Versionado SemVer y Despliegue (`GEMINI.md` Reglas 2, 4 y 5 + `cockpit-release`)**:
   - Actualizar versión a `12.7.2` en `VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `src/App.tsx`, `src/utils/formatters.ts`, `src/components/MoreView.tsx`, `server.py`, `docs/assets/*.svg`, `README.md`, `static/manual.html` y `docs/index.html`.
   - Compilar frontend, validar JS/Python, ejecutar `bash packaging/install_all.sh` (PC `.deb` + Android TV `.apk`), desplegar en `/home/servidor/servicios/dashboard/`, verificar HTTP `200`, comprobar ADB en TCL Percee TV y guardar `planes/walkthrough_v12.7.2.md` confirmando cambios localmente (sin `git push` automático salvo orden explícita).

