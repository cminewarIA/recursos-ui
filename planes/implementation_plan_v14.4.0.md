# Plan de Implementación · v14.4.0 (Servidor/Web) · Clientes Nativos v1.1.1

## Objetivos y Justificación de Ubicación (Regla 3.1 y 8.1)
1. **Desacoplo del ciclo de versiones y política estricta de temas**:
   - Servidor/Web en `./VERSION` (`14.4.0`), cliente Ubuntu en `./UBUNTU_VERSION` (`1.1.1`) y cliente Android en `./ANDROID_VERSION` (`1.1.1`).
   - CI/CD (`.github/workflows/build-deb.yml`) con detección de cambios por rutas nativas para no publicar `.deb` ni `.apk` ante cambios exclusivos de web o temas.
   - Los ajustes de temas (`./themes/*.json`) solo incrementan su propio campo `version` dentro del JSON del tema, nunca `./VERSION`, `./UBUNTU_VERSION` ni `./ANDROID_VERSION`.
2. **Cliente Ubuntu (`.deb` · v1.1.1) y Sistema → Actualizaciones**:
   - Consulta dinámica de la última compilación en GitHub (`GET /api/native/github-releases`) tanto en el lanzador GTK (`desktop_app/recursos_app.py`) como en **Sistema → Actualizaciones** (`src/components/MoreView.tsx`).
   - Acciones dedicadas en Ubuntu nativo: descarga e instalación automática de `.deb` (`POST /api/native/download-deb`) y descarga de `.apk` directamente en `Descargas` (`POST /api/native/download-apk`).
3. **Cliente Android (`.apk` · v1.1.1)**:
   - Apertura automática del descubridor/buscador local al iniciar cuando el dispositivo no está emparejado o falla el nodo guardado (`DiscoveryManager.kt`, `MainActivity.kt`, `CockpitDashboard.kt`).
   - Comprobación en segundo plano de la versión local (`1.1.1`) frente a GitHub Releases con banner Alethia discreto y autoinstalación inteligente (`root` → `FileProvider` si `canRequestPackageInstalls()` → navegador externo).
4. **Detección silenciosa de root**:
   - Comprobación y activación silenciosa en segundo plano en Android (`RootManager.kt`) y Ubuntu (`detect_ubuntu_root_status()`), sin controles ni interruptores en la UI, reflejando el estado exclusivamente dentro de la credencial del dispositivo en **Sistema → Dispositivos**.
5. **Consola del servicio en tiempo real (Solo lectura · 24 h máx.) en `/sistema/consola`**:
   - Submenú independiente bajo **Sistema** (`src/components/ServiceConsoleView.tsx`), estrictamente de solo lectura (sin entrada de comandos), respaldado por la tabla `service_console_logs` en `recursos_history.db` con poda automática a `86400 s` y sanitización previa de credenciales/tokens.

## Archivos Afectados
- Versionado, empaquetado y CI: `VERSION`, `UBUNTU_VERSION`, `ANDROID_VERSION`, `packaging/build_deb.sh`, `packaging/build_apk.sh`, `android_app/app/build.gradle.kts`, `.github/workflows/build-deb.yml`, `GEMINI.md`, `README.md`.
- Backend y Dev Proxy: `server.py`, `vite.config.ts`.
- Cliente Ubuntu: `desktop_app/recursos_app.py`.
- Cliente Android: `AndroidManifest.xml`, `res/xml/file_paths.xml`, `data/RootManager.kt`, `data/Models.kt`, `data/ApiService.kt`, `data/DiscoveryManager.kt`, `MainActivity.kt`, `ui/CockpitDashboard.kt`.
- Frontend Web & i18n: `src/utils/formatters.ts`, `src/types/telemetry.ts`, `src/components/ServiceConsoleView.tsx`, `src/components/MoreView.tsx`, `src/components/GlobalSearchModal.tsx`, `i18n/dictionary.csv`.
