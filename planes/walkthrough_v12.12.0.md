# Walkthrough v12.12.0 — Sección de Historial de Tráfico de Red (24 h) en `src/App.tsx`

## 1. Resumen de Implementación

Se ha incorporado en `src/App.tsx` una sección dedicada para visualizar la evolución del consumo de tráfico de red (bajada `net_rx` y subida `net_tx`) en las últimas **24 horas**, reutilizando el componente existente `TelemetryChart` y el modal interactivo `ExpandedChartModal`.

### Archivos modificados
- **`./VERSION`**: Actualizado de `12.11.6` a `12.12.0` (incremento `MINOR` por incorporación de nueva sección de interfaz).
- **`./i18n/dictionary.csv`**: Añadidas 11 claves de internacionalización en columna base `es` con terminación CRLF consistente:
  - `overview.net_history_24h_title`
  - `overview.net_history_24h_sub`
  - `overview.net_history_24h_badge`
  - `overview.net_history_24h_peak_rx`
  - `overview.net_history_24h_peak_tx`
  - `overview.net_history_24h_avg_rx`
  - `overview.net_history_24h_avg_tx`
  - `overview.net_history_24h_samples`
  - `overview.net_history_24h_empty`
  - `overview.net_history_24h_error`
  - `overview.net_history_24h_retry`
- **`./src/App.tsx`**:
  - Consulta asíncrona mediante `apiFetchJson<TelemetryHistoryResponse>('/api/metrics/history?window_sec=86400&limit=288')` con control de secuencia (`netHistorySeqRef`) para evitar condiciones de carrera y refresco automático cada `30s` mientras el documento está activo (`!document.hidden && !__RECURSOS_PAUSED__`).
  - Cálculo memorizado (`network24hView`) con fallback automático a `metrics.history` si la base de datos SQLite aún tiene `< 2` muestras, computando picos y medias de descarga (`net_rx`) y subida (`net_tx`) con unidades dinámicas vía `formatSpeed`.
  - Integración visual con cabecera informativa, leyenda explícita color + texto (`Bajada` `#0284c7`, `Subida` `#10b981`), botones accesibles de recarga manual y expansión a pantalla completa (`openNetwork24hExpanded` → `ExpandedChartModal` con `chartKind: 'net'`), tira de 4 indicadores numéricos tabulares (`tabular-nums`) y renderizado directo con `<TelemetryChart height={220} leftUnit="MB/s" intervalSec={300} />`, contemplando estados de carga, error con reintento y sin muestras.
- **`./planes/implementation_plan_v12.12.0.md`** y **`./planes/walkthrough_v12.12.0.md`**: Documentación de diseño y verificación en `./planes/`.

## 2. Verificación Realizada

1. **Diccionario i18n (`i18n_catalog.load_dictionary()`)**:
   - Verificada la carga correcta en Python de las 11 claves `overview.net_history_24h_*` bajo `flat['es']` con formato CRLF íntegro.
2. **Compilación de Bundle y HTML Estático (`npm run build`)**:
   - `vite build` completado sin errores (`dist/index.html`, `dist/assets/index-*.css`, `dist/assets/index-*.js` y regeneración de `static/index.html`).
3. **Verificación de Tipos y Compilación (`compile_applet` + `lint_applet`)**:
   - `compile_applet`: compilación exitosa.
   - `lint_applet` (`tsc --noEmit`): completado sin errores.
4. **Empaquetado Debian y Prueba en Modo Test (`.deb`)**:
   - `bash packaging/build_deb.sh`: generado y firmado `./dist/recursos-cockpit_12.12.0_amd64.deb` y `SHA256SUMS.txt.asc`.
   - `dpkg --force-depends -i ./dist/recursos-cockpit_12.12.0_amd64.deb`: instalado correctamente (`recursos-cockpit 12.12.0`).
   - `/usr/bin/recursos-cockpit --test-mode`: validado `[OK] Recursos Native Ubuntu HTML5 App v12.12.0 validated successfully` con `static/index.html` actualizado.
