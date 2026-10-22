# Plan de Implementación - v8.3.1: Instalación Local de Recursos Cockpit y Publicación Pública de Releases en GitHub

## 1. Contexto y Objetivos

El usuario solicitó:
1. **Instalar la aplicación nativa** en el servidor local.
2. **Asegurar que la aplicación compilada (.deb) se publique de forma pública en GitHub** y no quede retenida de forma privada o como artefacto interno temporal.

---

## 2. Acciones Propuestas e Implementadas

### A. Instalación de la Aplicación en el Servidor
- **Compilación previa**: Ejecución de `packaging/build_deb.sh` generando `dist/recursos-cockpit_8.3.1_amd64.deb`.
- **Instalación con APT**: `sudo apt-get install -y ./dist/recursos-cockpit_8.3.1_amd64.deb`.
- **Validación del binario**: `/usr/bin/recursos-cockpit --test-mode`.

### B. Publicación Pública en GitHub Releases
- **Diagnóstico**: `.github/workflows/build-deb.yml` contenía `if: startsWith(github.ref, 'refs/tags/v')`, omitiendo la creación de releases en commits directos a `main`.
- **Modificación**:
  - Eliminar la restricción condicional en el paso `softprops/action-gh-release@v3`.
  - Configurar `tag_name: v${{ steps.pkg_info.outputs.version }}`.
  - Configurar `name: Recursos Cockpit v${{ steps.pkg_info.outputs.version }}`.
  - Declarar `draft: false` y `prerelease: false`.
  - Adjuntar `dist/*.deb` y `dist/SHA256SUMS.txt`.

### C. Control de Versiones Semánticas (Regla 5)
- Versión incrementada a `8.3.1` (`PATCH`: corrección de automatización de compilación/despliegue e instalación de paquete).
- Sincronización en `VERSION`, `package.json`, `packaging/debian/control`, `README.md` y planes.

---

## 3. Plan de Verificación

- [x] Ejecutar `dpkg -l | grep recursos-cockpit` y comprobar versión 8.3.1 instalada.
- [x] Ejecutar `recursos-cockpit --test-mode` y validar detección de GTK3, Scrcpy, ADB y entorno nativo.
- [x] Ejecutar `git status` y verificar archivos limpios.
- [ ] Hacer `git push origin main` con tag `v8.3.1`.
- [ ] Validar la creación y disponibilidad de la Release pública en `https://github.com/cminewarIA/recursos-ui/releases`.
