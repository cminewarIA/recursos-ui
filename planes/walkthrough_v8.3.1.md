# 🚀 Walkthrough - v8.3.1: Instalación Local de la App Nativa y Publicación Pública de Releases en GitHub

Este documento describe la resolución integral de la solicitud del usuario para:
1. **Instalar la aplicación nativa Linux** (`recursos-cockpit`) directamente en el servidor.
2. **Publicar la aplicación de manera pública en GitHub** (`GitHub Releases`), evitando que el instalador `.deb` quede como un artefacto privado/interno o requiera inicio de sesión.

---

## 🛠️ 1. Instalación de la Aplicación Nativa en el Servidor Local

### A. Compilación del Paquete Debian
Se ejecutó el script canónico de empaquetado:
```bash
bash packaging/build_deb.sh
```
El script generó con éxito:
* Binario: `dist/recursos-cockpit_8.3.1_amd64.deb`
* Sumas criptográficas: `dist/SHA256SUMS.txt`
* Enlace simbólico canónico: `dist/recursos-cockpit.deb`

### B. Instalación con APT
Se procedió a la instalación en el sistema:
```bash
sudo apt-get install -y ./dist/recursos-cockpit_8.3.1_amd64.deb
```
Salida de confirmación:
```
recursos-cockpit (8.3.1) configurado.
Procesando disparadores para hicolor-icon-theme...
```

### C. Verificación Funcional Local
* Binario instalado: `/usr/bin/recursos-cockpit`
* Registro en base de datos de paquetes:
  ```bash
  dpkg -l | grep recursos-cockpit
  # ii  recursos-cockpit  8.3.1  amd64  Recursos Cockpit - Monitor de Silicio Nativo GTK3 y Conexion de Dispositivos
  ```
* Prueba de ejecución en modo test (`--test-mode`):
  ```
  [OK] Recursos Native GTK3 App v8.3.1 validated successfully.
  [OK] Runtime Environment Detection: {'mode': 'native', 'is_native': True, 'is_mobile': False, 'is_web': False, 'is_native_or_mobile': True, 'hide_device_tab': True, 'render_usb_projection_wait_screen': True}
  [OK] DeX / Android Desktop USB Controller Ready: {'adb_installed': True, 'scrcpy_installed': True, 'adb_path': '/usr/bin/adb', 'scrcpy_path': '/usr/bin/scrcpy', 'scrcpy_version': 'scrcpy 3.3.4 <https://github.com/Genymobile/scrcpy>', 'supports_new_display': True, 'ready': True}
  ```

---

## 🌐 2. Publicación Pública en GitHub Releases

### Diagnóstico del Problema Previo
En `.github/workflows/build-deb.yml`, el paso de publicación en GitHub Releases tenía la siguiente condición:
```yaml
- name: 🏷️ Publicar en GitHub Releases (Solo en Tags)
  if: startsWith(github.ref, 'refs/tags/v')
```
Al hacer `push` a la rama `main`, ese paso se saltaba (`skipped`), dejando el binario compilado únicamente como un artefacto efímero en GitHub Actions (privado y con expiración de 30 días).

### Solución Implementada
Se actualizó `.github/workflows/build-deb.yml`:
```yaml
      - name: 🏷️ Publicar en GitHub Releases (Público y Descargable)
        uses: softprops/action-gh-release@v3
        with:
          tag_name: v${{ steps.pkg_info.outputs.version }}
          name: Recursos Cockpit v${{ steps.pkg_info.outputs.version }}
          files: |
            dist/*.deb
            dist/SHA256SUMS.txt
          generate_release_notes: true
          draft: false
          prerelease: false
```
* **Acceso Público Universal**: Cada compilación en `main` crea o actualiza la Release pública correspondiente a la versión en `./VERSION` (`v8.3.1`), accesible sin login para cualquier usuario en:
  `https://github.com/cminewarIA/recursos-ui/releases`
* **Archivos Publicados**: Paquete instalable `.deb` y sumas de verificación `SHA256SUMS.txt`.

---

## 📦 3. Sincronización Canónica de Versiones

De acuerdo con la **Regla 5 de GEMINI.md**:
* `./VERSION`: `8.3.1`
* `./package.json`: `8.3.1`
* `./packaging/debian/control`: `8.3.1`
* `./README.md`: Badges y tabla de historial actualizados a `v8.3.1`
* Servicio local `system-dashboard.service`: Reiniciado y validado en ejecución.
