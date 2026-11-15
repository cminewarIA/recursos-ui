# Walkthrough y Verificación Técnica — Recursos Cockpit `v12.7.2`

## 1. Resumen de Cambios Implementados

1. **Logotipo ampliado y con transparencia RGBA real en la barra superior (`Web`, `Manual` y `Nativa`)**:
   - **`src/App.tsx`**: Se eliminó la cápsula circular opaca (`rounded-full border bg-sky-50/80 p-1`) y se amplió la altura mínima de la barra (`min-h-[68px] sm:min-h-[76px]`), renderizando directamente `/recursos-cockpit.png` en `h-12 w-12 sm:h-[62px] sm:w-[62px]` con transparencia RGBA y sombra sutil.
   - **`static/manual.html` y `docs/index.html`**: Se actualizó `.brand-logo` (`52px`, sin borde ni fondo opaco) apuntando directamente a `/recursos-cockpit.png`.
   - **`server.py`**: Se amplió `.brand-logo` en la tarjeta de autenticación (`78px` -> `96px`) manteniendo el respaldo dinámico de versión `12.7.2`.
   - **`desktop_app/recursos_app.py`**: Se amplió el logotipo principal del lanzador GTK (`.launcher-hero` `88×88` -> `116×116`).

2. **Banner oficial Android TV Leanback (`tv_banner.png`) con logotipo y nombre de aplicación sobre fondo transparente**:
   - **`android_app/app/src/main/res/drawable-xhdpi/tv_banner.png` (`640×360` RGBA, `alpha0=55.1%`)** y **`android_app/app/src/main/res/drawable-xxhdpi/tv_banner.png` (`960×540` RGBA, `alpha0=55.0%`)**: Diseño transparente compuesto por el logotipo oficial CMineWar a la izquierda y el texto `"Recursos / Cockpit / Panel del Servidor"` contorneado para legibilidad sobre cualquier tema del launcher de Android TV.

3. **Transparencia RGBA unificada en Android, Ubuntu y Web**:
   - **Android**: Regenerados `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/{ic_launcher,ic_launcher_round}.png` (`48×48` hasta `192×192`, `RGBA`, `alpha0` entre `31.5%` y `39.0%`) eliminando los fondos blancos opacos, junto con `drawable/app_logo.png` (`512×512` RGBA, `alpha0=42.5%`) consumido en `CockpitDashboard.kt` (`104.dp` sin recorte circular ni caja opaca).
   - **Ubuntu (`desktop_app/assets/`)**: Regenerados `recursos-cockpit-{16,32,48,64,128,256,512,1024}.png`, `recursos-cockpit.png` (`512×512` RGBA, `alpha0=42.5%`), `recursos-cockpit-logo.png` (`1024×1024` RGBA, `alpha0=43.2%`) y `recursos-cockpit.svg`.
   - **Web (`public/` y `static/`)**: Regenerados y sincronizados con paridad SHA-256 exacta `recursos-cockpit.png` (`1024×1024` RGBA, `alpha0=43.2%`), `favicon.png`, `favicon-512x512.png`, `favicon-192x192.png`, `favicon-32x32.png`, `favicon-16x16.png` (RGBA, `alpha0=17.2%`), `apple-touch-icon.png` (`180×180` RGBA, `alpha0=42.9%`) y `favicon.ico`.

4. **Control de versión y documentación (`v12.7.2`)**:
   - Sincronizada la versión `12.7.2` en `VERSION`, `package.json`, `package-lock.json`, `packaging/debian/control`, `server.py`, `src/App.tsx`, `src/utils/formatters.ts`, `src/components/MoreView.tsx`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html` y `README.md`.

---

## 2. Verificación Técnica Ejecutada

| Comprobación | Resultado observado |
| :--- | :--- |
| **Manual y documentación** | `static/manual.html` y `docs/index.html` con SHA-256 idéntico (`2cfacff9c6983ec556db007d234a0a22ef659a4eb229f2ebaeee69a89f7834b5`); `node --check` sobre script inline (`1` script OK); `python3 -m py_compile ./server.py ./desktop_app/recursos_app.py` OK. |
| **Frontend React 19 + TypeScript** | `npx tsc --noEmit` sin errores y `npm run build` (`vite v8.3.8`) completado emitiendo `dist/` y el bundle autocontenido `static/index.html`. |
| **Paridad y canal alfa RGBA** | Paridad SHA-256 exacta `public/` == `static/` en los 8 ficheros de icono/logo; todos los PNG en `public/`, `static/`, `desktop_app/assets/` y `android_app/app/src/main/res/` verificados en modo `RGBA` con transparencia real. |
| **Despliegue `.deb` (Ubuntu)** | `bash packaging/install_all.sh` generó, firmó GPG (`4CFC86D58E9146AE`) e instaló `recursos-cockpit` `12.7.2` (`amd64`). `/usr/bin/recursos-cockpit --test-mode` reportó `v12.7.2` operativo; los iconos en `/usr/share/pixmaps/recursos-cockpit.png`, `/usr/share/icons/hicolor/*/apps/recursos-cockpit.png` y `/usr/lib/recursos-cockpit/` mantuvieron modo `RGBA`. |
| **Despliegue `.apk` (Android TV)** | Gradle compiló `./dist/recursos-cockpit_12.7.2.apk` (`BUILD SUCCESSFUL in 42s`) y `install_tv_apk.sh` instaló vía ADB en `TCL Percee TV (SDK 26 · 192.168.50.187:5555)` con `versionCode=120702` y `versionName=12.7.2`. |
| **Producción y API local** | Despliegue en `/home/servidor/servicios/dashboard/` preservando intacto `recursos_history.db` (inodo `1049392`, `69111808` bytes), reinicio de `system-dashboard.service` (`active`), HTTP `200` en `/`, `/manual`, `/readme`, `/recursos-cockpit.png`, `/favicon-16x16.png` y `/apple-touch-icon.png` (SHA-256 coincidente y modo `RGBA`), más `/api/version?refresh=1` y `/api/metrics` en `12.7.2`. |

---

## 3. Notas de Entrega

- Se conserva el historial completo de `CHANGELOG` en `static/manual.html` y `docs/index.html` con la fila previa `v12.7.1`.
- De acuerdo con la skill `cockpit-release`, el commit en rama `main` y la etiqueta `v12.7.2` permanecen confirmados únicamente en local (sincronizando la referencia Git de `/home/servidor/servicios/dashboard/`) sin ejecutar `git push` automático hacia GitHub hasta que el usuario lo autorice.
