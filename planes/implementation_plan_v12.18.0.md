# Plan de Implementación · Recursos Cockpit v12.18.0

## Objetivos de Arquitectura y UX
1. **31 Idiomas Europeos en `./i18n/dictionary.csv`**:
   - Extensión completa del diccionario maestro CSV a 31 idiomas europeos (`es, en, fr, de, it, pt, nl, pl, ro, el, cs, hu, sv, bg, da, fi, sk, hr, lt, sl, lv, et, ga, mt, no, uk, ru, tr, sr, sq, is`), 907 claves por idioma con paridad de marcadores `{...}` y detección OTA automática.
   - Selector de idioma buscable en `MoreView.tsx` con filtrado insensible a tildes, código ISO, badge activo y actualización OTA.
2. **Telemetría Memoizada y Gráficas Especializadas**:
   - Memoización `useMemo` de buckets de picos/valles, ejes e interpolación + `React.memo` con comparador estricto por variación significativa del sensor en `TelemetryChart.tsx`.
   - Nueva gráfica en tiempo real de **Latencia media (Ping)** hacia la puerta de enlace y los nodos externos más activos en **Red → Aparatos en casa** (`NetworkSecurityView.tsx`, `server.py`, `vite.config.ts`).
   - Nueva sección de **Historial de procesos 24 h** (`ProcessHistoryStackedChart.tsx`, `/api/metrics/process-history`) con áreas apiladas para **Top 6 + Otros** conmutable entre **CPU**, **RAM**, **VRAM** y **E/S**.
3. **Test de Velocidad Oficial (`Speedtest.net`) + Historial Persistente**:
   - Motor de pruebas de velocidad de 3 niveles (`speedtest` Ookla CLI JSONL → `speedtest-cli` → protocolo multi-flujo `speedtest.net`, con respaldo Cloudflare/nodo local si el entorno bloquea WAN) persistido en SQLite (`speedtest_history` dentro de `recursos_history.db`) y en `vite.config.ts` para paridad dev.
4. **Widgets Compactos, Bloqueo de Scroll en Modales y Simetría Total**:
   - Tarjeta de **Tráfico del Router** + consumo WAN/LAN independiente por aparato en casa con ordenación en vivo (`Descarga`, `Subida`, `LAN`, `Nombre`).
   - Densidad compacta y legible en `.cockpit-auto-grid` (`245px` / `265px`) y `OverviewView` (`p-3.5 sm:p-4`, `text-2xl`, gráficas `112px`) manteniendo el detalle completo al pulsar cualquier widget en la **Inspección Táctil**.
   - Transiciones `ViewStage` solapadas (`popLayout` con entrada y salida cruzada suave).
   - Contención de scroll y bloqueo del documento de fondo (`html:has([aria-modal="true"])`, `overscroll-contain`) en todos los modales y desplegables (`ExpandedChartModal`, `NetworkDevicesModal`, `AppsMediaView`, `MoreView`, `App`).
   - Optimización *edge-to-edge* del favicon en `/public/` y `/static/` para máxima visibilidad en la pestaña del navegador y barras móviles.
5. **Sincronización Persistente y en Tiempo Real con Firebase (Cloud Firestore + Google Auth)**:
   - Esquema estructurado en `firebase-blueprint.json`, aislamiento de PII en `/users/{uid}/private/account` y reglas validadas con ESLint en `firestore.rules` desplegadas en `europe-west1`.
   - `FirebaseProvider`, `FirestoreErrorBoundary`, saneamiento estricto en `src/firebase/schemas.ts`, sincronización `onSnapshot` de preferencias (`theme`, `locale`, `autoSync`), instantáneas de nodos (`/users/{uid}/nodes/{nodeId}`), resultados Speedtest (`/users/{uid}/speedtests/{testId}`) y tarjeta de control en `MoreView` (`Más → Actualizaciones`) + claves traducidas a 31 idiomas.
6. **Validación en Ciclos Consecutivos Limpios**:
   - Compilación Python + esquema SQLite + pruebas reales Speedtest/History, TypeScript estricto, ESLint de reglas Firebase (`firestore.rules`), paridad CSV de 31 idiomas, empaquetado `.deb`, auditoría Chromium E2E completa (Desktop + Mobile × 31 idiomas + bloqueo de scroll modal + Escape + tarjeta Firebase) y `compile_applet` + `lint_applet`.
