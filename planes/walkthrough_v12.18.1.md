# Walkthrough y Verificación v12.18.1

## Resumen de cambios implementados

### 1. Historial de latencia Ping en bases de datos (SQLite, Dev JSON y Cloud Firestore)
- **Backend Python (`server.py`)**:
  - Retención de `ping_history` ampliada a 7 días en `recursos_history.db`.
  - Precarga al arranque (`preload_ping_history_from_sqlite()`) de las muestras de los últimos 20 minutos en `_PING_HISTORY_POINTS` y `PING_LATENCY_CACHE`.
  - Endpoint `GET /api/net/ping-history` (`query_ping_history_from_sqlite`) con filtrado temporal (`window_sec`, `before_ts`, `after_ts`, `all`) y submuestreo con preservación de picos.
- **Servidor de desarrollo (`vite.config.ts`)**:
  - Persistencia en `./ping_history_dev.json` (`appendPingSampleDev`), precarga al inicio (`loadPingHistoryDev`), y ruta `GET /api/net/ping-history` (`queryPingHistoryDev`) con idéntica estructura JSON.
- **Cloud Firestore (`firebase-blueprint.json`, `firestore.rules`, `src/firebase/schemas.ts`, `src/firebase/FirebaseProvider.tsx`)**:
  - Subcolección `/users/{userId}/pingHistory/{sampleId}` validada por reglas de seguridad (`firestore.rules`, desplegada con `DeployRules`) y constructor tipado `buildPingSampleMutableFields()`.
  - Suscripción en tiempo real (`syncedPingHistory`), sincronización automática cada 60 s desde `App.tsx`, sincronización manual desde `MoreView.tsx` y contador en vivo en `NetworkSecurityView.tsx` y `MoreView.tsx` mediante la clave `firebase.synced_ping_title` en `./i18n/dictionary.csv` (31 idiomas).
- **Inspección Táctil (`src/components/ExpandedChartModal.tsx`)**:
  - Soporte completo para gráficas `chartKind: 'ping'` con botones temporales (`En vivo`, `20 min`, `1 h`, `6 h`, `24 h`, `Todo`), deslizador cronológico, salto de pasos y desplazamiento horizontal.

### 2. Contención hermética de scroll en ventanas modales y cajas desplazables
- **`src/App.tsx`**: Listener en fase `capture: true` sobre `wheel` y `touchmove`, más `MutationObserver` sobre `[aria-modal="true"]`. Al alcanzar el borde o quedar menos remanente que el impulso de la rueda (`remaining <= |dy| + 4`), sujeta `scrollTop` exactamente al límite y cancela la propagación (`preventDefault()` + `stopPropagation()`), evitando que el scroll continúe sobre la página de fondo.
- **`src/index.css`**: Bloqueo de `overscroll-behavior: none` y `touch-action` sin alterar `window.scrollY` con saltos al inicio de página al abrir diálogos.
- **`src/components/NetworkSecurityView.tsx` & `src/components/MoreView.tsx`**: Atributo `data-cockpit-scroll-contain="true"` y `overscroll-contain` en selectores, registros técnicos, salidas OTA y listas desplegables.

## Comprobaciones ejecutadas y resultados reales
- `npx eslint firestore.rules`: correcto (`exit 0`).
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: correcto (`exit 0`).
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`: correcto (`exit 0`).
- `GET /api/net/ping-history?window_sec=1200`: `200 OK`, `ok: true`, muestras almacenadas en `./ping_history_dev.json`.
- **Auditoría Chromium Headless (2 pasadas consecutivas reales con eventos `page.mouse.wheel`)**:
  - Pasada 1: `consoleErrorsCount: 0`, `pageErrorsCount: 0`, `pingHistoryRequestsCount: 3` (`ok: 3`), `bgModalLock: { before: 407, down: 407, up: 407 }`, `bgListboxLock: { before: 34, down: 34, up: 34 }`, `horizOverflow: 0`.
  - Pasada 2: `consoleErrorsCount: 0`, `pageErrorsCount: 0`, `pingHistoryRequestsCount: 3` (`ok: 3`), `bgModalLock: { before: 253, down: 253, up: 253 }`, `bgListboxLock: { before: 180, down: 180, up: 180 }`, `horizOverflow: 0`.
- `npm run build` + `bash packaging/build_deb.sh`: paquete `.deb` `recursos-cockpit_12.18.1_amd64.deb` compilado y firmado.
