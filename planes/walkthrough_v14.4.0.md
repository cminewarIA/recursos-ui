# Walkthrough y Verificación · v14.4.0 (Servidor/Web) · Clientes Nativos v1.1.1

## Resumen de Cambios Implementados
1. **Desacoplo de versiones y política de temas**:
   - `./VERSION` = `14.4.0` (servidor y web).
   - `./UBUNTU_VERSION` = `1.1.1` y `./ANDROID_VERSION` = `1.1.1` (clientes nativos independientes).
   - Workflow `.github/workflows/build-deb.yml` con detección de cambios por rutas nativas (`detect-native-changes`) para omitir compilación/publicación de `.deb` y `.apk` cuando solo cambian temas o interfaz web remota.
   - Regla explícita en `./GEMINI.md` y `./README.md`: los ajustes de temas (`./themes/*.json`) solo actualizan el campo `version` interno del tema y nunca incrementan `VERSION`, `UBUNTU_VERSION` ni `ANDROID_VERSION`.
2. **Cliente Ubuntu (`.deb` · v1.1.1)**:
   - Consulta dinámica de la última compilación en GitHub (`GET /api/native/github-releases`) mostrada tanto en **Sistema → Actualizaciones** como en el **lanzador nativo GTK** (`desktop_app/recursos_app.py`).
   - Botón **Descargar e instalar .deb** (`POST /api/native/download-deb`) con validación HTTPS GitHub, verificación SHA-256 e instalación segura vía lista de argumentos `dpkg -i`.
   - Botón **Descargar .apk a Descargas** (`POST /api/native/download-apk`) con validación de cabecera ZIP/APK y guardado atómico en `xdg-user-dir DOWNLOAD`.
3. **Cliente Android (`.apk` · v1.1.1)**:
   - Apertura automática del descubridor/buscador local al arrancar sin emparejar o si falla el nodo guardado (`DiscoveryManager.kt`, `MainActivity.kt`, `CockpitDashboard.kt`).
   - Comprobación en segundo plano frente a GitHub Releases con banner discreto y autoinstalación inteligente (`RootManager` silencioso → `FileProvider` si dispone de permiso → apertura del enlace directo en navegador).
4. **Detección silenciosa de root**:
   - Comprobación y activación silenciosa en segundo plano en Android (`RootManager.kt`) y Ubuntu (`detect_ubuntu_root_status()`), sin controles ni interruptores en UI, reflejando el estado únicamente dentro de la credencial del dispositivo en **Sistema → Dispositivos**.
5. **Consola del servicio en tiempo real (Solo lectura · 24 h máx.)**:
   - Nueva subpágina `/sistema/consola` (`ServiceConsoleView.tsx`) sin entrada ni ejecución de comandos, respaldada por `service_console_logs` en `recursos_history.db` con poda automática a `86400 s` y redacción de tokens, contraseñas y cabeceras de autorización.

## Verificaciones Ejecutadas
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: **0 errores**.
- `python3 -m py_compile server.py desktop_app/recursos_app.py themes_catalog.py i18n_catalog.py`: **0 errores**.
- Pruebas unitarias y de seguridad Python:
  - Versiones desacopladas (`14.4.0` vs `1.1.1` en Ubuntu y Android): **OK**.
  - Rutas independientes `/sistema/consola`, `/consola`, `/terminal`: **OK**.
  - Redacción de secretos (`Bearer`, `X-Device-Token`, `password=`, `cookie:`): **OK**.
  - Poda automática `>24h` en `service_console_logs` (SQLite): **OK**.
  - Lista blanca HTTPS estricta de dominios GitHub para descargas `.deb`/`.apk`: **OK**.
  - Integridad de `./i18n/dictionary.csv` (33 columnas / 31 idiomas, 58 claves nuevas, 0 filas malformadas): **OK**.
- `npm run build`: **compilación exitosa** (`2093` módulos).
- `bash packaging/build_deb.sh`: **paquete `dist/recursos-cockpit_1.1.1_amd64.deb` generado y firmado con GPG**, empaquetando `VERSION`, `UBUNTU_VERSION` y `ANDROID_VERSION`.
