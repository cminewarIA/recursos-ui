# Walkthrough y Verificación Técnica — Recursos Cockpit `v12.8.0`

## 1. Resumen de Cambios Implementados

1. **Contenedor Fluido de Ancho Completo (`.cockpit-shell`) en `src/index.css` y `src/App.tsx`**:
   - Se sustituyó `mx-auto max-w-6xl px-3 ... sm:px-6` en la barra superior (`<header>`) y en `<main>` por `.cockpit-shell` (`width: 100%`, márgenes laterales proporcionales `padding-left/right: clamp(0.75rem, 1.8vw, 2.25rem)`), eliminando los márgenes laterales vacíos en monitores maximizados mientras mantiene la alineación simétrica entre barra superior y contenido y protege el overscan en Android TV (`[data-tv="true"]`).
   - Se mantuvo la barra flotante inferior (`.cockpit-dock`) centrada para conservar la ergonomía táctil, y en el skeleton inicial de `src/App.tsx` se aplicó `.cockpit-auto-grid`.

2. **Sistema Automático de Rejillas Paralelas (`auto-fit`) en Todas las Vistas**:
   - **`.cockpit-auto-grid` (`src/index.css`)**: `repeat(auto-fit, minmax(min(100%, var(--cockpit-grid-min)), 1fr))` con `--cockpit-grid-min: 315px` en `< 1024px` (1 col móvil, 2 cols tablet/TV) y `360px` desde `1024px` (3 cols portátil, 4 cols en Full HD `1920px` y más en QHD/Ultrawide, ocupando todo el ancho cuando hay menos tarjetas).
     - Aplicado en **Inicio** (`src/components/OverviewView.tsx`: CPU, RAM, GPU, Red e Internet y todos los widgets independientes de almacenamiento local/USB/NAS), **Almacenamiento** (`src/components/EquipmentView.tsx`) e **Interfaces de Red** (`src/components/NetworkSecurityView.tsx`).
   - **`.cockpit-auto-grid-cards` (`src/index.css`)**: `repeat(auto-fit, minmax(min(100%, var(--cockpit-card-min)), 1fr))` (`340px` base, `390px` desde `1280px`) para listas compactas en paralelo:
     - `"Aparatos de tu red doméstica"` en `OverviewView.tsx` (retirando además límites artificiales `max-w-[290px]` y `max-w-[260px]` en textos descriptivos).
     - `"Aparatos detectados en el router"` y `"Conexiones detalladas"` (GeoIP) en `NetworkSecurityView.tsx`.
     - `"Aplicaciones instaladas (Contenedores)"` y `"Servicios de fondo del servidor"` en `AppsMediaView.tsx`.
     - `"Dispositivos con permiso de acceso"` en `MoreView.tsx`.
   - **`.cockpit-cores-grid`**: `repeat(auto-fit, minmax(56px, 1fr))` para la matriz de núcleos de CPU en `EquipmentView.tsx`.
   - **Mapa GeoIP y Modal Ampliado**:
     - En `NetworkSecurityView.tsx`, el mapa mundial pasa a `lg:grid-cols-12` (`lg:col-span-8 xl:col-span-9` con altura `h-[340px] lg:h-[420px] xl:h-[460px]`) y donut en `lg:col-span-4 xl:col-span-3`, respaldado por `ResizeObserver`.
     - En `ExpandedChartModal.tsx`, el modal de inspección táctil se amplió de `max-w-4xl` a `max-w-6xl`.
   - **Manual Interactivo (`static/manual.html` y `docs/index.html`)**: Ampliación de `.topbar-inner` y `.layout` (`max-width: 100%`, padding `clamp(16px, 2vw, 36px)`) y `.grid-3` auto-adaptativo.

3. **Control de Versión y Documentación (`v12.8.0`)**:
   - Actualizado `VERSION` a `12.8.0` (`MINOR`) y sincronizado en `package.json`, `package-lock.json`, `packaging/debian/control`, `server.py`, `src/App.tsx`, `src/utils/formatters.ts`, `src/components/MoreView.tsx`, `docs/assets/hero-banner.svg`, `docs/assets/cockpit-ui-preview.svg`, `static/manual.html`, `docs/index.html` y `README.md`.

---

## 2. Verificación Técnica Ejecutada

| Comprobación | Resultado observado |
| :--- | :--- |
| **Compilación Frontend y Manual** | `npx tsc --noEmit` sin errores; `npm run build` (`vite v8.3.8`) emitió `static/index.html` (`584292` bytes, CSS con `.cockpit-shell`, `.cockpit-auto-grid`, `.cockpit-auto-grid-cards`, `.cockpit-cores-grid` y `0` instancias residuales de `md:grid-cols-2`). Paridad SHA-256 `static/manual.html == docs/index.html` (`73fa56a8...`), `node --check` OK (`1` script) y `py_compile` OK en `server.py` y `desktop_app/recursos_app.py`. |
| **Paquete Ubuntu (`.deb`)** | `bash packaging/install_all.sh` compiló, firmó GPG (`4CFC86D58E9146AE`) e instaló `recursos-cockpit` `12.8.0` (`amd64`). `/usr/bin/recursos-cockpit --test-mode` validó `v12.8.0` y el bundle `/usr/lib/recursos-cockpit/static/index.html` coincidió por SHA-256 (`c0d76007...`) con `./static/index.html`. |
| **App Android TV (`.apk` vía ADB)** | Gradle compiló `./dist/recursos-cockpit_12.8.0.apk` (`BUILD SUCCESSFUL in 45s`) e `install_tv_apk.sh` instaló en `TCL Percee TV (SDK 26 · 192.168.50.187:5555)` confirmado mediante `dumpsys package` (`versionCode=120800`, `versionName=12.8.0`). |
| **Producción y API Local** | Desplegado en `/home/servidor/servicios/dashboard/` manteniendo intacto `recursos_history.db` (inodo `1049392`), `system-dashboard.service` `active`, HTTP `200` en `/`, `/manual`, `/readme` (conteniendo `12.8.0` y `.cockpit-shell`) y `/api/version?refresh=1` reportando `12.8.0`. |
| **Limitación en Chrome DevTools** | La verificación interactiva vía `mcp_chrome_devtools` no pudo ejecutarse porque no existía una instancia activa de Google Chrome con depuración remota (`/home/servidor/.config/google-chrome/DevToolsActivePort` ausente). |

---

## 3. Notas de Entrega

- De acuerdo con la skill `cockpit-release`, los cambios quedan confirmados localmente en `main` con etiqueta `v12.8.0` y sincronizados en `/home/servidor/servicios/dashboard/` sin ejecutar `git push` automático hacia GitHub salvo petición expresa del usuario.
