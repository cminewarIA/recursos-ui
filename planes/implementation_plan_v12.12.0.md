# Plan de Implementación — v12.12.0: Sección de Historial de Tráfico de Red (24 h) en `App.tsx`

## 1. Objetivo
Implementar una sección dedicada dentro de `src/App.tsx` que consulte el historial persistente de consumo de red de las últimas 24 horas y lo represente visualmente mediante el componente existente `TelemetryChart`.

---

## 2. Alcance
1. **`src/App.tsx`**:
   - Consultar `GET /api/metrics/history?window_sec=86400&limit=288` al iniciar la aplicación y refrescar cada 30 segundos en primer plano mediante `apiFetchJson`, con botón de actualización manual e inspección ampliada en `ExpandedChartModal`.
   - Renderizar dentro de `<main>` la sección simétrica `cockpit-bento` reutilizando `<TelemetryChart>` con series de bajada (`net_rx`) y subida (`net_tx`) en `MB/s`, resumen tabular (`Pico bajada`, `Media bajada`, `Pico subida`, `Media subida`) y estados de carga, error/reintento y vacío.
2. **`i18n/dictionary.csv`**:
   - Registrar todas las claves `overview.net_history_24h_*` siguiendo la Regla 8 del proyecto.
