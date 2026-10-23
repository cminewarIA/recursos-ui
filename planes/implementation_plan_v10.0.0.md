# Plan de Implementación — v10.0.0 (Rediseño Integral y Reestructuración Anti-IA)

## 1. Objetivo
Rediseñar y reestructurar por completo la plataforma **Recursos Cockpit** (`v10.0.0`) para erradicar cualquier apariencia de plantilla generada por IA y dotarla de una arquitectura visual e industrial propia de consolas de ingeniería de sistemas de nivel de producción (inspirada en Linear, Vercel, Grafana y Cloudflare Zero Trust), manteniendo el 100% de compatibilidad con las aplicaciones nativas de Ubuntu Linux (`.deb`) y Android (`.apk`).

## 2. Cambios Arquitectónicos y Visuales (`v10.0.0`)
1. **Sistema de Diseño de Ingeniería de Precisión**:
   - Lienzo oscuro de carbono mate (`#090D16`), paneles de superficie técnica (`#111827`) y bordes *hairline* de `1px solid rgba(255, 255, 255, 0.075)` sin resplandores de neón ni sombras infladas.
   - Modo claro de papel técnico de alto contraste (`#F1F5F9` / `#FFFFFF`) con bordes precisos (`rgba(15, 23, 42, 0.09)`).
   - Geometría estructural refinada (`--radius-xs: 4px`, `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 10px`, `--radius-xl: 12px`) y tipografía `Plus Jakarta Sans` + `JetBrains Mono` con `font-variant-numeric: tabular-nums`.
2. **Reestructuración del Shell de Trabajo**:
   - En pantallas de escritorio (`@media (min-width: 1120px)`), la barra lateral de navegación (`.sidebar`, `244px`) permanece anclada a la izquierda de forma permanente y el dock flotante inferior se centra automáticamente sobre el área principal (`left: calc(50% + 122px)`).
   - En pantallas táctiles y móviles (`< 1120px`), el panel lateral actúa como cajón deslizable con `backdrop-filter`.
3. **Purga Total de Patrones "AI Slop"**:
   - Sustitución de emojis decorativos en botones, cabeceras, selectores segmentados y tarjetas por iconografía vectorial SVG técnica y micro-indicadores LED.
   - Eliminación de semáforos falsos de ventana (`.node-terminal-lights`) en el Centro Unificado de Fallos del Sistema.
   - Eliminación de bordes izquierdos gruesos (`border-left: 3px solid`) en filas de logs, tabla de procesos y tarjetas de identidad Zero-Trust (`#secZeroTrustDevicesSection`), manteniendo los indicadores explícitos de permiso (`PERMISO: FULL ACCESS` vs `PERMISO: SANDBOX`) y la descarga de auditoría JSON.
4. **Sincronización Canónica de Versión (`10.0.0`)**:
   - Actualización sincronizada de `./VERSION`, `package.json`, `packaging/debian/control`, `android_app/app/build.gradle.kts`, `index.html`, `static/index.html` y `README.md`.
