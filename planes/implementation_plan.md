# Plan de Implementación - v8.3.3: Adición de Regla 8 en GEMINI.md (Instalación Local Obligatoria de la App Nativa)

## 1. Solicitud del Usuario
> *"cada vez que actualizes la aplicacion debes intalar la app nativa guardalo como norma"*

---

## 2. Acciones y Normas Implementadas

### A. Adición de la Regla 8 en `GEMINI.md`
Se incorporó la siguiente pauta contractual permanente:
- **Compilación Inmediata**: En cada actualización o commit que incremente `./VERSION`, se debe compilar el paquete deb canónico mediante `bash packaging/build_deb.sh`.
- **Instalación Local en el Servidor**: Se debe ejecutar `sudo apt-get install -y ./dist/recursos-cockpit_${VERSION}_amd64.deb` en el servidor local.
- **Verificación**: Comprobar `/usr/bin/recursos-cockpit --test-mode` y validar `dpkg -l | grep recursos-cockpit` reflejando la misma versión de `./VERSION`.

### B. Incremento Canónico de Versión (Regla 5)
- Versión actualizada a `8.3.3` en:
  - `./VERSION`
  - `./package.json`
  - `./packaging/debian/control`
  - `./README.md`

### C. Cumplimiento Inmediato de la Regla 8
- Compilación de `recursos-cockpit_8.3.3_amd64.deb`.
- Instalación local con `sudo apt-get install -y`.
- Validación con `--test-mode`.
- Confirmación y `git push origin main --tags`.
