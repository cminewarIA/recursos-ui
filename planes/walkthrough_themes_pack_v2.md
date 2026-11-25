# Walkthrough · Motor de Transformación Espacial de Temas y Paquete Único (`themes-pack.rcpack.gz` v2.0.0)

## 1. Resumen Arquitectónico

Se ha implementado el motor de transformación integral de temas (**Schema v2**) junto al **paquete único desacoplado** `./themes/themes-pack.rcpack.gz` (`pack_version: 2.0.0`, 951 KB comprimido en gzip con las 9 definiciones completas, reglas de disposición espacial de menús, tipografías, paletas de gráficas y 8 fondos WebP optimizados a 1280 px embebidos en Data URI), preservando **intacto el logo original (`/recursos-cockpit.png`)** y respetando estrictamente la norma 6.3 de `./GEMINI.md` (sin incrementar `./VERSION` `14.4.0`, `./UBUNTU_VERSION` `1.1.1` ni `./ANDROID_VERSION` `1.1.1`).

## 2. Catálogo de 9 Temas Empaquetados

| ID | Versión | Atmósfera | Posición de Menús (Desktop) | Acabado de Paneles | Efecto Fondo |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `alethia-matrix` | `1.1.0` | Dual (Claro / Oscuro) | `bottom-dock` | `rounded` (claro más translúcido `0.44–0.58`) | `matrix-telemetry` |
| `navidad-escarcha` | `1.0.0` | Dual (Claro / Oscuro) | `bottom-dock` | `frosted` (escarcha/hielo cristalino) | `snowfall` (3 capas) |
| `cyberpunk-2077` | `1.0.0` | Atmósfera propia (`locked-dark`) | `left-hud` (HUD vertical Netrunner) | `beveled` (`clip-path` biselado) | `cyber-grid` |
| `gta-iii` | `1.0.0` | Atmósfera propia (`locked-dark`) | `top-bar` | `sharp` | `urban-rain` |
| `gta-vice-city` | `1.0.0` | Atmósfera propia (`locked-dark`) | `right-rail` | `rounded` (glow neón) | `none` |
| `gta-san-andreas` | `1.0.0` | Atmósfera propia (`locked-dark`) | `left-sidebar` | `sharp` | `none` |
| `gta-iv` | `1.0.0` | Atmósfera propia (`locked-dark`) | `top-bar` | `sharp` | `urban-rain` |
| `gta-v` | `1.0.0` | Atmósfera propia (`locked-dark`) | `top-tabs` | `sharp` | `none` |
| `gta-vi` | `1.0.0` | Atmósfera propia (`locked-dark`) | `corner-dock` | `rounded` (glow neón) | `none` |

En pantallas estrechas (`< 768px`), todos los esquemas de navegación se adaptan automáticamente a un dock inferior compacto manteniendo tipografía, bordes y paleta de cada tema. Al cambiar desde un tema de atmósfera fija (`locked-dark`) a un tema dual (`alethia-matrix` o `navidad-escarcha`), se restaura automáticamente la preferencia Claro/Oscuro guardada por el usuario.

## 3. Gráficas y Visualización Adaptativa

- **`TelemetryChart.tsx`**: consume `chartPalette` del tema activo (series primarias/secundarias/terciarias/cuaternarias, rejilla, línea media, píldora de pico, crosshair y tooltip), aplicando trazos `crisp` (segmentos tácticos HUD) o `neon` (glow en `<canvas>`) y fuente monoespaciada del tema.
- **`DataVizPrimitives.tsx` & `ProcessCpuSparkline.tsx`**: los anillos radiales (`RadialKpiGauge`), el pie narrativo (`ChartNarrativeFooter`) y los sparklines de procesos heredan los tokens y paletas del tema activo.

## 4. Paquete Único OTA y Blindaje de Seguridad

- **Construcción reproducible**: `scripts/build_theme_pack.py` compila `./themes/themes-pack.rcpack.gz` (gzip determinista) y actualiza `./themes/themes.json` con `pack_version`, `pack_file` y `pack_sha256`.
- **Rutas backend & dev**: `GET /api/themes`, `POST /api/themes/sync`, `GET /api/themes/pack` y `GET /themes/themes-pack.rcpack.gz` (`server.py` + `vite.config.ts`).
- **Controles de seguridad (`themes_catalog.py` + `src/themes/types.ts`)**:
  - Allowlist estricta de host HTTPS (`raw.githubusercontent.com`) para descargas OTA.
  - Protección contra *gzip bombs* mediante lectura en streaming con tope estricto (`<= 8 MB` comprimido, `<= 16 MB` descomprimido).
  - Allowlist estricta de Data URIs únicamente raster (`image/webp`, `image/jpeg`, `image/png`), rechazando `image/svg+xml` o cualquier payload ejecutable.
  - Allowlist de tokens CSS (`ALLOWED_THEME_CSS_TOKENS`), consultas de Google Fonts, disposiciones espaciales y escritura atómica de caché OTA.
  - Empaquetado `.deb` actualizado en `packaging/build_deb.sh` para incluir `*.rcpack.gz`.
