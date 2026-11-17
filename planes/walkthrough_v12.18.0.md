# Walkthrough · Recursos Cockpit v12.18.0

## Resumen de Cambios Verificados
1. **Conexión Firebase (Cloud Firestore + Google Auth) y Reglas Endurecidas (`europe-west1`)**:
   - Proyecto configurado en `firebase-applet-config.json` (`gen-lang-client-0045258469`, base nombrada `ai-studio-resourcehub-75b345c8-b42e-44cb-84e3-3ed8bbc0d6a8`) y esquema documentado en `firebase-blueprint.json`.
   - `firestore.rules` desplegadas y validadas sin advertencias ni errores con `npx eslint firestore.rules`: denegación por defecto global, aislamiento estricto de PII (`/users/{uid}/private/account`), compuerta maestra `hasParentWorkspace(userId)` (`exists(...)`), verificación de correo e invariantes de creación/actualización en subcolecciones (`preferences`, `nodes`, `speedtests`).
   - Implementación modular en `src/firebase/index.ts`, `src/firebase/schemas.ts`, `src/firebase/FirebaseProvider.tsx` (`onSnapshot`, Google Sign-In con `signInWithPopup`, chequeo `testConnection()` con `getDocFromServer`, saneamiento de payloads y sincronización en vivo de preferencias, instantáneas de nodos cada 20 s si `autoSync` está activo e historial Speedtest) y `src/components/FirestoreErrorBoundary.tsx` integrado en `src/main.tsx`.
   - Controles integrados en `src/components/MoreView.tsx` (`Más → Actualizaciones` con `[data-testid="firebase-sync-card"]` y `[data-testid="firebase-signin-btn"]`), `src/App.tsx` y `src/components/NetworkSecurityView.tsx` (envío automático e insignia en nube al completar `Speedtest.net`).
   - Registro completo de 20 claves `firebase.*` en `./i18n/dictionary.csv` a lo largo de los 31 idiomas europeos.

2. **31 Idiomas Europeos, Telemetría Compacta, Modales con Bloqueo de Scroll y Speedtest.net**:
   - Cobertura total en `./i18n/dictionary.csv` (929 filas × 31 idiomas europeos sin celdas vacías ni desajustes de marcadores `{...}`, 606 claves estáticas verificadas con `0` faltantes).
   - Widgets compactos en `OverviewView.tsx` (`.cockpit-auto-grid`), contención de rueda de ratón y bloqueo de scroll en el documento de fondo (`overscroll-contain`, `data-cockpit-scroll-contain="true"`, `html:has([aria-modal="true"])`) y cierre rápido con `Escape` + `onCloseRef` estable en `ExpandedChartModal.tsx`, `NetworkDevicesModal.tsx`, `NetworkSecurityView.tsx` y `App.tsx`.
   - Favicon maximizado *edge-to-edge*, tarjeta de tráfico del router y consumo independiente WAN/LAN en Aparatos en casa, gráfica en vivo de latencia ping, historial 24 h apilado de procesos y motor `Speedtest.net` con persistencia SQLite (`speedtest_history`).
   - Documentación sincronizada en `./README.md` y `./planes/implementation_plan_v12.18.0.md`.

## Verificaciones Ejecutadas
- `npx eslint firestore.rules`: salida `0` (sin errores ni advertencias).
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0`.
- `npm run build` y `bash packaging/build_deb.sh`: compilación Vite + empaquetado firmado `.deb` (`dist/recursos-cockpit_12.18.0_amd64.deb` + `SHA256SUMS.txt.asc`) correctos.
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`: salida `0`.
- Auditoría E2E en Chromium headless (`1440×900` y `390×844` incluyendo cierre con `Escape` en `ExpandedChartModal` y `NetworkDevicesModal`, bloqueo de scroll trasero, 5 pestañas principales, Speedtest, tarjeta Firebase en `Más → Actualizaciones` y conmutación por los 31 idiomas): **2 ciclos consecutivos limpios** con `runtimeErrorsCount: 0` y `layoutIssuesCount: 0`.
