# Walkthrough de Verificación v12.3.0 — Gráficas de 20 Minutos, Escalas Visibles y Autoescala de Pico

> **Versión verificada**: `12.3.0` (`MINOR`)  
> **Fecha**: 2026-11-14  
> **Estado**: ✅ Implementado, compilado (`SPA React 19` + `.deb` firmado GPG), instalado localmente en `/usr/bin/recursos-cockpit` y desplegado en producción (`:8085`).

---

## 1. Resumen de Cambios Aplicados

1. **Ventana móvil unificada de 20 minutos (`1200` s) con preservación de picos**:
   - [`server.py`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/server.py):
     - Sustituida la cola de 60 muestras (`~90s`) por cubetas pico-preservantes de `5` s (`HISTORY_WINDOW_SECONDS = 1200`, `HISTORY_BUCKET_SECONDS = 5`, `MAX_HISTORY = 240`) con nueva clave `HISTORY["epoch_ts"]`, precarga en arranque desde `recursos_history.db WHERE ts >= now - 1200` (`preload_telemetry_history_from_sqlite()`) y actualización en vivo mediante `_push_history_bucket()` en `background_collector()`.
     - Ajustado el historial por interfaz de red (`NIC_BANDWIDTH_HISTORY_2H`) a `MAX_NIC_HISTORY_SECONDS = 1200` (20 minutos) y `NIC_BUCKET_INTERVAL_MS = 5000` (cubetas de `5` s pico-preservantes).
   - [`vite.config.ts`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/vite.config.ts):
     - Replicada la misma lógica de ventana móvil de 20 minutos (`1200` s) en cubetas pico-preservantes de `5` s y `epoch_ts` tanto para `historyBuffer` como para `nicHistory2h`.

2. **Escalas de Tiempo (Eje X) y Magnitud/Velocidad (Eje Y) + Techo Exacto en Picos**:
   - [`src/components/TelemetryChart.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/TelemetryChart.tsx):
     - Añadidas etiquetas tabulares en eje Y izquierdo (`%`, `KB/s`, `MB/s` dinámicos), eje Y derecho opcional (`%` de espacio usado en discos) y marcas de tiempo proporcionales en eje X (`HH:MM`, `HH:MM:SS` o `DD/MM HH:MM`) apoyadas en `epochTs` y `timestamps`.
     - Ajustado `computedMaxLeft` para métricas no porcentuales (`leftUnit !== '%'`): **el techo superior de la escala toma exactamente el valor pico (`peak`) más alto registrado dentro de la ventana de 20 minutos** (`peak > 0.0001 ? peak : 0.1`), refrescándose automáticamente al producirse un pico mayor o cuando el anterior sale de los 20 minutos.
     - Calibrado el tooltip flotante (`validEpochRange`) para reflejar el tiempo transcurrido exacto hasta `20 min` según la marca temporal real de cada muestra.

3. **Integración en Todas las Vistas y Visor Táctil**:
   - [`src/components/OverviewView.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/OverviewView.tsx): eliminado `diskThroughputMax` (piso fijo `5 MB/s` y redondeo `* 1.25`), añadido `epochTs` y `nicName` en `ExpandChartSpec`, y conectado `epochTs` en las 4 gráficas principales.
   - [`src/components/EquipmentView.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/EquipmentView.tsx): conectado `epochTs` y `decimals: 2` en almacenamiento.
   - [`src/components/NetworkSecurityView.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/NetworkSecurityView.tsx): conectados `timestamps`, `epochTs`, `nicName` y actualizado el estado vacío a *"Acumulando historial de últimos 20 minutos..."*.
   - [`src/components/ExpandedChartModal.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/ExpandedChartModal.tsx): preset principal etiquetado como `En vivo · 20 min`, preset `20 min`, refresco en vivo también para gráficas NIC (`spec.nicName`), paso de `epochTs` y delegación del autoajuste exacto de velocidad a `TelemetryChart`.

4. **Sincronización SemVer `12.3.0` y Documentación**:
   - Sincronizados [`VERSION`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/VERSION), [`package.json`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/package.json), [`packaging/debian/control`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/packaging/debian/control), [`src/App.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/App.tsx), [`src/utils/formatters.ts`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/utils/formatters.ts), [`src/components/MoreView.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/MoreView.tsx), [`README.md`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/README.md), [`static/manual.html`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/static/manual.html), [`docs/index.html`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/docs/index.html) y los SVGs en [`docs/assets/`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/docs/assets/hero-banner.svg).

---

## 2. Resultados de Verificación Observados

| Comprobación | Resultado | Evidencia |
| :--- | :--- | :--- |
| Compilación sintáctica Python | ✅ Superada | `python3 -m py_compile server.py` (código de salida `0`) |
| TypeScript & Vite Build React 19 | ✅ Superada | `tsc --noEmit` + `vite build` en `534ms` (`static/index.html` regenerado) |
| Empaquetado Debian `.deb` firmado | ✅ Superada | `dist/recursos-cockpit_12.3.0_amd64.deb` (`OK: sin .db/.json en .deb`) |
| Instalación local y `--test-mode` | ✅ Superada | `dpkg -l`: `recursos-cockpit 12.3.0 amd64` · `[OK] Recursos Native Ubuntu HTML5 App v12.3.0 validated successfully.` |
| Despliegue producción & SQLite | ✅ Superada | `system-dashboard.service`: `active` · `recursos_history.db` intacto en inodo `1049392` (`67.94 MB`) |
| API `/api/version` | ✅ Superada | `current_version: "12.3.0"`, `display_version: "12.3.0"` |
| API `/api/metrics` (ventana 20 min) | ✅ Superada | `HISTORY points=235`, `epoch_ts_len=235`, `span_sec=1167.6` (`20:56:54 → 21:16:22`), `DISK max read/write: 35.1 / 83.05 MB/s`, `NIC enp7s0: pts=81, span_sec=1190.0, max_rx_MBs=28.886` |
| API `/api/metrics/history` y HTML | ✅ Superada | `db_file: "recursos_history.db"`, `total_samples: 721`, `window.__INITIAL_APP_VERSION__ = "12.3.0";` en `/` y `manualVersionBadge">v12.3.0<` en `/manual` |
