# Plan de Implementación v12.18.1 — Historial de Latencia Ping en Bases de Datos y Contención Total de Scroll

## 1. Persistencia e Historial Consultable de Latencia Ping
- **Backend nativo (`server.py`)**: Retención de 7 días en `ping_history` dentro de `recursos_history.db`, precarga inicial de 20 min al arranque (`preload_ping_history_from_sqlite()`), y endpoint `GET /api/net/ping-history` con preservación de picos.
- **Servidor de desarrollo (`vite.config.ts`)**: Persistencia en `./ping_history_dev.json` (hasta 50.000 puntos con escritura atómica), precarga inicial de 20 min en memoria (`pingHistoryPoints` + `pingLatencyCache`), y ruta `GET /api/net/ping-history` con idéntico contrato JSON.
- **Cloud Firestore (`firebase-blueprint.json`, `firestore.rules`, `src/firebase/schemas.ts`, `src/firebase/FirebaseProvider.tsx`)**: Subcolección `/users/{userId}/pingHistory/{sampleId}` validada en reglas y esquemas, listener en tiempo real `syncedPingHistory`, y sincronización automática cada 60 s (`syncPingSnapshot`) o manual desde Ajustes.
- **Inspección Táctil (`src/components/ExpandedChartModal.tsx`)**: Habilitar ventanas históricas (`20 min`, `1 h`, `6 h`, `24 h`, `Todo`), cursor deslizante, retroceso/avance y modo desplazamiento horizontal para gráficas con `chartKind: 'ping'`.

## 2. Bloqueo Hermético de Scroll Chaining en Ventanas y Desplegables
- **Contención física de rueda del ratón y táctil (`src/App.tsx`, `src/index.css`)**:
  - Listener en fase `capture: true` con cálculo de remanente hasta el límite (`remaining <= Math.abs(dy) + 4`) para absorber y clamping exacto del último impulso sin filtrar `deltaY` al documento principal de fondo.
  - Bloqueo de `touchmove` sobre fondos de diálogo y observador `MutationObserver` sobre `[aria-modal="true"]` para fijar `overflowY = 'hidden'` en el elemento raíz mientras haya un diálogo abierto.
  - Marcado exhaustivo de paneles y cajas con scroll interno (`data-cockpit-scroll-contain="true"`) en `ExpandedChartModal.tsx`, `NetworkDevicesModal.tsx`, `NetworkSecurityView.tsx` y `MoreView.tsx`.
