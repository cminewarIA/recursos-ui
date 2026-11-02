# Walkthrough & Verificación — v11.0.0 (Rediseño Integral Orbital Horizon & Liquid Titanium)

## 1. Resumen de Cambios Implementados
- **Arquitectura de Información de 4 Dominios + Lienzo Panorámico 100%**:
  - Se reemplazó el esquema de barra lateral fija de `244px` por un espacio de trabajo panorámico al 100% con el **Puente de Mando Orbital (`.orbital-domain-switcher`)** en el HUD superior (`01 · Misión`, `02 · Silicio`, `03 · Red & Escudo`, `04 · Operaciones`) y la **Cinta Contextual de Sub-Navegación (`.orbital-subnav-bar`)** con contadores en vivo.
  - El cajón lateral `#appSidebar` opera ahora como un *Command Drawer* deslizable bajo demanda en todas las resoluciones.
- **Módulos de Valor Añadido**:
  - **Cinta Global de Signos Vitales (`#ovVitalPulseRibbon`)**: Índice sintético de salud operativa (`0–100%`), barra de progreso reactiva y 4 pods ejecutivos en la parte superior de la Cabina Central.
  - **Paleta de Comandos Spotlight (`⌘K` / `Ctrl+K` · `#commandPaletteDialog`)**: Navegación y ejecución instantánea de acciones con filtrado en tiempo real.
- **Paridad Nativa y Reglas del Proyecto**:
  - Sincronización 100% idéntica entre `index.html` y `static/index.html`.
  - Sincronización de paleta en `android_app/.../Color.kt` y versión `11.0.0` (`versionCode = 110000`) en `build.gradle.kts`.
  - Respeto estricto de la Regla 7.5 (submenú DeX USB exclusivo para la App Nativa de Ubuntu) y Regla 2 (100% Zero-Hardcoding).

## 2. Verificación Técnica
- Sincronización de `./VERSION` (`11.0.0`), `package.json`, `packaging/debian/control` y `README.md`.
- Compilación e instalación del paquete nativo Debian `dist/recursos-cockpit_11.0.0_amd64.deb` y prueba de `/usr/bin/recursos-cockpit --test-mode`.
- Compilación limpia del applet (`compile_applet` y `lint_applet`).
