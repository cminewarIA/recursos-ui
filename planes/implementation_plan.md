# Plan de Implementación v8.5.2: Formalización Contractual de Simetría Total, Homogeneidad y Cohesión en Interfaces y Submenús (Regla 8 en GEMINI.md)

## Objetivo
Formalizar de manera contractual e irrevocable en las directrices maestras del proyecto ([`GEMINI.md`](../GEMINI.md)) la exigencia de **simetría total, homogeneidad y cohesión visual/estructural** en todas las interfaces y submenús:
1. **Interfaces Web y Submenús**: Todos los componentes, tarjetas Bento, modales, barras flotantes, menús laterales, el mapa geoespacial y subapartados deben proyectar una simetría y coherencia rigurosa y limpia.
2. **Ecosistema Homogéneo Universal**: Paridad estética y dimensional absoluta entre la versión web y las aplicaciones nativas de Ubuntu (GTK 3/Cairo) y Android (Jetpack Compose).
3. **Proyección hacia el Futuro**: Cualquier elemento, control, submenú o vista que se agregue en sucesivas versiones deberá ceñirse sin excepciones a esta directriz.
4. **Criterio de Incremento (`PATCH` ➔ `8.5.2`)**: De acuerdo a la Regla 3.4 de `GEMINI.md`, la actualización de reglas de ingeniería y documentación corresponde a un incremento de tipo `PATCH` (`8.5.1` ➔ `8.5.2`).

---

## Cambios Propuestos

### Componente 1: Reglas Maestras de Ingeniería (`GEMINI.md`)
- Incorporar la **Regla 8**: *"Principio de Simetría Total, Homogeneidad y Cohesión en Interfaces y Submenús (Web, Linux/Ubuntu y Android)"*.
- Renumerar la directiva de publicación remota a **Regla 9**: *"Publicación Automática en GitHub (`git push`)"*.
- Reafirmar la paridad estética en la Regla 7.5 (*Apple Liquid Glass + Tesla Touch Cockpit*).

### Componente 2: Sincronización Canónica de Versiones (`v8.5.2`)
- `./VERSION`: `8.5.2`
- `package.json`: `"version": "8.5.2"`
- `packaging/debian/control`: `Version: 8.5.2`
- `android_app/app/build.gradle.kts`: `versionCode = 80502`, `versionName = "8.5.2"`
- `README.md`: Badges, banner ASCII y tabla de historial de versiones actualizada con `v8.5.2`.

### Componente 3: Compilación y Empaquetado Canónico
- Compilar el paquete Debian canónico mediante `packaging/build_deb.sh`.
- Verificar la instalación local en el sistema mediante `/usr/bin/recursos-cockpit --test-mode`.

---

## Plan de Verificación
1. Validar que la Regla 8 figure íntegra y explícita en `GEMINI.md`.
2. Validar consistencia estricta de la versión `8.5.2` en todos los puntos de verdad.
3. Compilar el paquete Debian canónico `dist/recursos-cockpit_8.5.2_amd64.deb`.
4. Ejecutar `compile_applet` y `lint_applet` para confirmar que el entorno compila limpiamente sin advertencias ni errores.
