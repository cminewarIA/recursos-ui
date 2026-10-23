# Plan de Implementación v9.3.1 — Corrección de Compilación Kotlin en Android (`CockpitDashboard.kt`) y CI/CD

## 1. Causa Raíz del Fallo en `:app:compileReleaseKotlin`
1. `CockpitDashboard.kt:166` y `181`: Las expresiones `when (connectionMode)` omitían la rama `ConnectionMode.DISCONNECTED` definida en `Models.kt`.
2. `CockpitDashboard.kt:170`: Referencia a `NeonAmber` cuando en `Color.kt` estaba definido únicamente `NeonOrange`.

## 2. Solución Implementada (`v9.3.1`)
1. **`android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt`**:
   - Se añadieron las ramas `ConnectionMode.DISCONNECTED` y `else` en ambas expresiones `when (connectionMode)` y se utilizó `NeonOrange`.
2. **`android_app/app/src/main/java/com/cminewar/recursoscockpit/theme/Color.kt`**:
   - Se añadió la constante `val NeonAmber = Color(0xFFFF9F0A)` junto a `NeonOrange`.
3. **`.github/workflows/build-deb.yml`**:
   - Se añadió `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` en `env` para suprimir la advertencia de Node 20 en `actions/checkout@v4`.
4. **Sincronización Canónica (`v9.3.1`)**:
   - Actualización de `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md` a `9.3.1`.
