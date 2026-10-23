# Walkthrough & Verificación v9.3.1 — Corrección de Compilación Kotlin en Android (`:app:compileReleaseKotlin`)

## 1. Cambios Aplicados
- **`CockpitDashboard.kt`**: Se completaron las expresiones `when (connectionMode)` añadiendo `ConnectionMode.DISCONNECTED` y `else`, y sustituyendo `NeonAmber` por `NeonOrange`.
- **`Color.kt`**: Se definió `val NeonAmber = Color(0xFFFF9F0A)`.
- **`.github/workflows/build-deb.yml`**: Se configuró `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`.
- **Sincronización `v9.3.1`**: Sincronizados `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.

## 2. Verificación
- Empaquetado Debian `dist/recursos-cockpit_9.3.1_amd64.deb` compilado y verificado con `python3 desktop_app/recursos_app.py --test-mode`.
- `lint_applet` y `compile_applet` ejecutados sin errores.
