# Plan de Implementación - Versión 8.3.8

## Objetivo
Optimizar, consolidar y limpiar las reglas del proyecto en `GEMINI.md`, eliminando redundancias, duplicaciones verbales y repetición innecesaria de rutas físicas, mientras se preserva al 100% el rigor contractual de todas las normas (sincronización git pull/push, compatibilidad de rutas, zero-hardcoding, versionado semántico MAJOR.MINOR.PATCH, almacenamiento en planes/, README, empaquetado/instalación local del .deb y arquitectura de apps nativas con paridad visual y desbloqueo de DeX en Ubuntu).

## Cambios Propuestos

### Documentación y Reglas
- **[MODIFY] `GEMINI.md`**:
  - Reorganizar en 8 directrices ordenadas según el ciclo de desarrollo.
  - Eliminar menciones redundantes de rutas absolutas locales (`/home/servidor/...`) en las reglas 1, 3 y 5, delegando la política de rutas a la regla universal de rutas relativas y zero-hardcoding.
  - Consolidar los puntos de seguridad criptográfica y consumo de APIs en la arquitectura de apps nativas (anteriormente 9.3 y 9.5).
  - Incluir `packaging/debian/control` explícitamente en la lista de sincronización de versiones.
  - Eliminar párrafos redundantes de "Objetivo" que duplican el texto normativo.
- **[MODIFY] `VERSION`**:
  - Incrementar de `8.3.7` a `8.3.8` (criterio PATCH por ajuste de reglas y documentación).
- **[MODIFY] `package.json`**:
  - Sincronizar `"version": "8.3.8"`.
- **[MODIFY] `packaging/debian/control`**:
  - Sincronizar `Version: 8.3.8`.
- **[MODIFY] `README.md`**:
  - Actualizar badges, banner ASCII y tabla de versiones a `v8.3.8`.
- **[NEW] `planes/implementation_plan_v8.3.8.md`** y **`planes/walkthrough_v8.3.8.md`**:
  - Registro canónico de la tarea.

### Empaquetado y Verificación Local
- Compilar `dist/recursos-cockpit_8.3.8_amd64.deb` con `packaging/build_deb.sh`.
- Instalar localmente con `sudo apt-get install -y ./dist/recursos-cockpit_8.3.8_amd64.deb`.
- Verificar con `/usr/bin/recursos-cockpit --test-mode`.
- Verificar servicio backend en `http://127.0.0.1:8085/api/version`.

### Sincronización Remota
- Commit semántico: `docs(v8.3.8): optimizar y consolidar reglas del proyecto en GEMINI.md eliminando redundancias`
- Tag `v8.3.8` y `git push origin main --tags`.
