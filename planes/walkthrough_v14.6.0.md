# Verificación y Entrega — Recursos Cockpit v14.6.0 · Ubuntu Native v1.3.0

## Resumen del Cambio
- **Servidor y Web UI (`VERSION=14.6.0`)**:
  - Nuevos controles compactos de ventana en la esquina superior derecha (`src/App.tsx`): píldora de estado (`LAN`/`WAN`/`LOCAL`/`REVOKED` enlazada a `/sistema/ubuntu`) y botones `Minimizar`, `Maximizar/Restaurar`, `Pantalla completa` y `Cerrar` **renderizados exclusivamente cuando `detectNativeEnvironment().isUbuntuNative` es verdadero**.
  - Nueva subpestaña `/sistema/ubuntu` (`/ubuntu`) en `src/components/MoreView.tsx` y `src/components/GlobalSearchModal.tsx`, con el **mismo bloqueo exclusivo que `/sistema/dex`** fuera de Ubuntu nativa (`!isUbuntuNative` muestra estado pasivo con candado).
  - Dentro de `/sistema/ubuntu`: tarjeta de conexión LAN/WAN con escaneo/reconexión, conexión local `127.0.0.1`, IP LAN manual y *Olvidar conexión*; tarjeta de nodo local `systemd` + accesos directos a DeX USB y Actualizaciones; y tarjeta de controles de ventana + *Acerca de* (`UBUNTU_VERSION`, MIT, GitHub).
- **App Nativa Ubuntu (`UBUNTU_VERSION=1.3.0`, `desktop_app/recursos_app.py`)**:
  - Eliminados `Gtk.HeaderBar`, el lanzador nativo de 3 opciones, el diálogo `AboutDialog` GTK y estilos/importaciones huérfanos (`cairo`, `GdkPixbuf`, `Pango`).
  - Ventana sin decoraciones (`set_decorated(False)`) iniciada directamente a pantalla completa (`fullscreen()`) renderizando `WebKit2` de borde a borde desde el arranque.
  - Autodescubrimiento LAN automático mejorado en `ServerConnectionManager.discover_server()` con mDNS (`avahi-browse -rpt _recursos._tcp`), octetos frecuentes y escaneo paralelo de subred `/24` (`ThreadPoolExecutor`) antes del fallback a DDNS WAN.
  - Nuevos endpoints locales en `LocalHtmlBridgeServer`: `GET /api/native/ubuntu-control`, `POST /api/native/window`, `POST /api/native/connection` y `POST /api/native/local-node`, además de `window.webkit.messageHandlers.recursosWindow`.
- **Internacionalización y Documentación**:
  - Añadidas 32 claves nuevas (`more.subtabs.ubuntu`, `more.ubuntu_*`) en `i18n/dictionary.csv` con las 31 columnas de idioma completas.
  - Actualizado `README.md` y creado `./planes/implementation_plan_v14.6.0.md`.

## Resultados Observados de Verificación
| Comprobación | Comando | Resultado |
| :--- | :--- | :--- |
| Compilación Python | `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py themes_catalog.py desktop_app/recursos_app.py desktop_app/dex_controller.py` | Exit `0` |
| TypeScript estricto | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | Exit `0` (cero variables/imports sin uso) |
| Compilación Frontend | `npm run build` | Exit `0` (`✓ built in 4.40s`, standalone `static/index.html`) |
| Paquete Debian firmado | `bash packaging/build_deb.sh` | Exit `0` (`dist/recursos-cockpit_1.3.0_amd64.deb` firmado GPG) |
| Instalación `.deb` | `sudo apt-get install --reinstall --allow-downgrades -y ./dist/recursos-cockpit_1.3.0_amd64.deb` | Exit `0` (transición desde `14.3.0` pre-desacoplado a `1.3.0`) |
| Validación CLI Ubuntu | `/usr/bin/recursos-cockpit --test-mode` | Exit `0` (`v1.3.0`, `active='http://127.0.0.1:8085'`, `mode='LAN'`, DeX ready) |
| Integridad CSV i18n | Script Python `csv.reader` sobre `i18n/dictionary.csv` | `[OK] 1226 rows, 33 cols, 0 duplicates` |
| Puente HTTP local | Pruebas HTTP reales contra `LocalHtmlBridgeServer` (`GET /`, `/api/native/ubuntu-control`, `POST /api/native/window`, `POST /api/native/connection`) | Exit `0` (inyecta `__RECURSOS_UBUNTU_NATIVE__`, despacha `minimize` y reconecta LAN) |
| Rutas SPA servidor | `server.is_valid_web_route("/sistema/ubuntu")`, `"/ubuntu"` | Exit `0` (`True`) |
