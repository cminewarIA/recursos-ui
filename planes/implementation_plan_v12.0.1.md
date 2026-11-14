# Plan de Implementación — `v12.0.1` (`v2B.0.1`)

## Objetivos
1. **Opción de actualización mediante GitHub en la App Nativa de Ubuntu (`desktop_app/recursos_app.py`)**:
   - Detectar automáticamente si `recursos-cockpit` (`.deb`) o el nodo local (`server.py` / `system-dashboard.service`) ya están instalados.
   - Consultar GitHub Releases (`cminewarIA/recursos-ui`) para mostrar si existe una versión más reciente y habilitar el botón **"Actualizar desde GitHub"** directamente en la tarjeta 2, ejecutando actualización en sitio sin desinstalar.
2. **Firma Criptográfica de `.deb` y `.apk` para Actualizaciones In-Place sin Desinstalar (`packaging/`, `android_app/`, `.github/workflows/build-deb.yml`)**:
   - **Debian (`.deb`)**: Firmar el paquete con GPG (`_gpgorigin` incrustado en archivo `ar` + firma separada `.deb.asc` + `SHA256SUMS.txt.asc`), incluir la clave pública en `/usr/share/keyrings/recursos-cockpit-archive-keyring.gpg` y registrarla en `/etc/apt/trusted.gpg.d/` durante `postinst`. Corregir `Maintainer` RFC-2822, `Homepage`, `Installed-Size`, `Replaces: recursos-cockpit (<< VERSION)`, compresión `-Zxz` y `prerm` acotado para asegurar compatibilidad con Snap Store / App Center / PackageKit.
   - **Android (`.apk`)**: Derivar `versionCode` automáticamente desde `VERSION`, exigir la firma oficial v1/v2/v3 con `android_app/keystore/recursos-release.jks` y verificarla con `apksigner verify` en GitHub Actions.
3. **Sincronización Canónica `12.0.1` (`v2B.0.1`)**:
   - Actualizar `VERSION`, `package.json`, `packaging/debian/control`, `README.md`, `./planes/*_v12.0.1.md` y compilar/instalar localmente el `.deb`.
