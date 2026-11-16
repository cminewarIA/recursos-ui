# Walkthrough v12.16.3 — Unificación Integral del Código Visual en Paneles y Modales

## Objetivo
Asegurar que **todos los paneles, sub-tarjetas, cabeceras, divisores, botones secundarios, insignias, filtros y ventanas modales** de la aplicación web y las vistas compartidas (`src/`) sigan exactamente el mismo sistema visual definido en `src/index.css` y en la Regla 7 de `GEMINI.md` (Simetría Total y Homogeneidad Visual).

---

## Auditoría y Unificaciones Realizadas

1. **Cabeceras de Paneles y Divisores Consistentes (`cockpit-bento` + `border-slate-200/70 dark:border-slate-800`)**:
   - `src/components/AppsMediaView.tsx`: unificadas las cabeceras de **Contenedores Docker**, **Servicios Systemd**, **Emby / Multimedia** y **Descargas / Torrents** con insignia de icono simétrica (`cockpit-pill-cyan` / `cockpit-pill-violet`, `h-8 w-8 rounded-xl`) y separador inferior `pb-4 border-b border-slate-200/70 dark:border-slate-800`.
   - `src/components/NetworkSecurityView.tsx`: añadida simetría entre los paneles paralelos **DuckDNS** (`cockpit-pill-cyan` + `<Globe />`) y **Pi-hole DNS** (`cockpit-pill-emerald` + `<Shield />`) con el mismo separador y tipografía `font-display`.
   - `src/components/MoreView.tsx`: normalizadas las cabeceras con divisor inferior en **Aspecto**, **Apps nativas** y **Manual interactivo**; alineados todos los divisores internos (`border-slate-100` → `border-slate-200/70 dark:border-slate-800`).
   - `src/components/EquipmentView.tsx`, `src/components/ResourceProcessesPanel.tsx`, `src/components/OverviewView.tsx` y `src/App.tsx`: unificados todos los divisores de tablas, acordeones y resúmenes KPI a `border-slate-200/70 dark:border-slate-800` y `divide-slate-200/70 dark:divide-slate-800`.

2. **Eliminación de Controles Ad-Hoc y Bordes Anidados (`cockpit-subtile`)**:
   - `src/components/AppsMediaView.tsx`: botones de reinicio Docker/Systemd normalizados a `cockpit-subtile` (`min-h-[38px]`); etiqueta de tipo en medios recientes unificada a `cockpit-subtile`; detalles técnicos de contenedor convertidos en franja limpia con separador superior `border-t border-slate-200/70 dark:border-slate-800` sin doble caja bordeada.
   - `src/components/ExpandedChartModal.tsx`: botones de navegación temporal (`Más antiguo`, `Retroceder`, `Avanzar`) normalizados a `cockpit-subtile min-h-[44px]`.
   - `src/components/MoreView.tsx`: botón `Renombrar`, visor de salida técnica (`<pre>`), lista de avisos y marco del `<iframe>` del manual normalizados a `cockpit-subtile`; bloque de unidades `systemd` fallidas normalizado a `cockpit-pill-amber`; detalle JSON del dispositivo separado por línea sutil superior sin doble recuadro.
   - `src/components/NetworkSecurityView.tsx`: selector de logo de equipo (`h-10 w-10`) y filtros inactivos del mapa GeoIP normalizados a `cockpit-subtile`; filtros activos e insignias de dirección GeoIP unificados a `cockpit-pill-cyan|amber|emerald|violet|red`; franja en tiempo real `↓ Descarga · ↑ Subida · ∑ Total` integrada sin borde interno duplicado.

3. **Modales, Botones Destructivos y Notificaciones (`cockpit-modal-enter` + `cockpit-btn-off`)**:
   - `src/App.tsx`, `src/components/ExpandedChartModal.tsx`, `src/components/NetworkDevicesModal.tsx` y `src/components/NetworkSecurityView.tsx`: todos los diálogos (`role="dialog" aria-modal="true"`) comparten ahora el mismo contenedor `cockpit-bento cockpit-modal-enter` (sin sobrecargas dispares `shadow-2xl`), cabecera con divisor inferior `border-b border-slate-200/70 dark:border-slate-800`, botones de cierre simétricos `min-h-[40px] min-w-[40px]`, y botones destructivos/de detención unificados a `cockpit-btn-off`.
   - `src/components/NetworkDevicesModal.tsx`: `MorphPill` estandarizado al estilo canónico `cockpit-tab-active` igual que el resto de barras segmentadas de la aplicación.
   - `src/App.tsx`: toast animado unificado con `cockpit-bento cockpit-toast-enter`.

---

## Verificación Ejecutada
- Auditoría automatizada de patrones visuales en `src/**/*.tsx`: **0 desviaciones**.
- Comprobación estricta de tipos TypeScript (`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`): **0 errores**.
- Compilación completa frontend (`npm run build`), empaquetado Debian (`bash packaging/build_deb.sh` → `recursos-cockpit_12.16.3_amd64.deb`) y verificación de arranque nativo (`python3 -B desktop_app/recursos_app.py --test-mode`).
- Verificación final conjunta de compilación y linting (`compile_applet` + `lint_applet`) y reinicio del servidor dev con `v12.16.3`.
