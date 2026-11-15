# Walkthrough v12.9.0 — Llamada Única a `./VERSION`, Diccionario CSV Extensible por Columnas (`./i18n/dictionary.csv`) y Normalización de Hardware

## 1. Resumen de Implementación

- **Versión canónica única (`./VERSION` -> `12.9.0`)**:
  - Se eliminó la duplicación de números de versión activos en código fuente, plantillas HTML, SVG y documentación, centralizando todas las lecturas en [`./VERSION`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/VERSION):
    - Backend y escritorio Python: `get_canonical_version()` en [`i18n_catalog.py`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/i18n_catalog.py), [`server.py`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/server.py) y [`desktop_app/recursos_app.py`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/desktop_app/recursos_app.py), exponiendo `current_version` en `/api/version` y `version_info.current_version` en `/api/metrics`.
    - Frontend React / Vite: `__APP_VERSION__` inyectado desde `./VERSION` en [`vite.config.ts`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/vite.config.ts) y helpers `getCanonicalVersion()` / `getCanonicalDisplayVersion()` en [`src/utils/version.ts`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/utils/version.ts).
    - Manual interactivo ([`static/manual.html`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/static/manual.html) y [`docs/index.html`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/docs/index.html)): resolución dinámica mediante `resolveFallbackVersionFile()` y `applyCanonicalVersionToManual()` hidratando badges, botones de descarga `.deb`/`.apk`, comandos CLI y cabecera de changelog.
    - Empaquetado y documentación: [`packaging/build_deb.sh`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/packaging/build_deb.sh), [`android_app/app/build.gradle.kts`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/android_app/app/build.gradle.kts), [`README.md`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/README.md) (badges dinámicos y enlaces `releases/latest`), [`docs/assets/cockpit-ui-preview.svg`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/docs/assets/cockpit-ui-preview.svg) y [`docs/assets/hero-banner.svg`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/docs/assets/hero-banner.svg).

- **Diccionario tabular único tipo hoja de cálculo (`./i18n/dictionary.csv`)**:
  - Estructura `key,context,es` con 672 claves de traducción marcando el español como idioma base (`__locale_name__ = Español`, `__default_locale__ = *`).
  - Detección automática de nuevas columnas de idioma sin modificar código en [`i18n_catalog.py`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/i18n_catalog.py) y [`src/i18n/csvParser.ts`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/i18n/csvParser.ts), admitiendo UTF-8 BOM, delimitador `,` o `;`, comillas RFC 4180, coincidencia insensible a mayúsculas (`pt-BR`, `en_US`) y respaldo automático al idioma por defecto cuando una celda queda vacía.
  - Exposición dual del servidor vía `GET /api/dictionary` (JSON estructurado) y `GET /i18n/dictionary.csv` (hoja CSV directa), junto al selector de columna de idioma en [`src/components/MoreView.tsx`](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/MoreView.tsx).
  - Telemetría de hardware normalizada con claves estructurales (`transport_key`, `label_key`, `band_key`, `vendor_key`, `role_key`) en servidor, frontend React (`AppsMediaView.tsx`, `EquipmentView.tsx`, `NetworkSecurityView.tsx`, `OverviewView.tsx`, `MoreView.tsx`, gráficos), app Linux GTK3 y app Android/TV (`I18nDictionary.kt`, `CockpitDashboard.kt` y tarjetas).

## 2. Verificaciones Ejecutadas

1. **Integridad de tipos, compilación Frontend y sintaxis Python**:
   - `npx tsc --noEmit`: finalizado con código 0 (0 errores).
   - `npm run build` (Vite v8.3.8): `2078 modules transformed`, `built in 651ms`, regenerando `static/index.html` y `dist/`.
   - `python3 -m py_compile i18n_catalog.py server.py desktop_app/recursos_app.py`: finalizado con código 0 (`PY_COMPILE_OK`).
2. **Pruebas del analizador CSV multicolumna (Excel / Calc BOM + `;`) y referencias de claves**:
   - Prueba sintética Python y TypeScript sobre CSV con BOM UTF-8, delimitador `;` y columnas `es;en;fr` / `es;en;pt-BR`:
     - Python (`i18n_catalog.py`): `PY_I18N_OK 672`
     - TypeScript (`src/i18n/csvParser.ts`): `TS_I18N_OK 672 { es: 'Español', en: 'English', 'pt-BR': 'Português (Brasil)' }`
   - Validación cruzada de claves `\bt(...)` y `tSys(...)`: `CSV_KEYS=672 REFERENCED=395 MISSING=0`.
   - Búsqueda de versiones activas duplicadas (`rg -n "12\.8\.0|12\.9\.0|12\.0\.1"`): únicamente la entrada histórica `v12.8.0` en línea 1928 del changelog en `static/manual.html` y `docs/index.html`.
3. **Empaquetado e instalación simultánea (`bash packaging/install_all.sh`)**:
   - Paquete Debian generado y firmado con GPG (`4CFC86D58E9146AE`): `dist/recursos-cockpit_12.9.0_amd64.deb`.
   - `dpkg -l | grep recursos-cockpit`: `ii  recursos-cockpit  12.9.0  amd64`.
   - `/usr/bin/recursos-cockpit --test-mode`: `[OK] Recursos Native Ubuntu HTML5 App v12.9.0 validated successfully.` (`dex_unlocked: True`, puente nativo activo).
   - Compilación Android Gradle `:app:assembleRelease` (`BUILD SUCCESSFUL in 1m 1s`) generando `dist/recursos-cockpit_12.9.0.apk`.
   - Despliegue automático vía ADB en televisor LAN `TCL Percee TV (SDK 26 · 192.168.50.187:5555)`: `Success` (`versionCode=120900 minSdk=26 targetSdk=34 versionName=12.9.0`).
4. **Despliegue en servidor de producción (`/home/servidor/servicios/dashboard`)**:
   - Archivos sincronizados preservando `recursos_history.db`, secretos y cachés en ejecución; `system-dashboard.service` reiniciado en estado `active`.
   - Comprobaciones HTTP contra `http://127.0.0.1:8085`:
     - `GET /api/version` -> HTTP 200 (`current_version: "12.9.0"`, `installed_deb_version: "12.9.0"`).
     - `GET /api/dictionary` -> HTTP 200 (`default_locale: "es"`, `supported_locales: ["es"]`, `locale_names: {"es": "Español"}`, `672` claves).
     - `GET /i18n/dictionary.csv` -> HTTP 200 (cabecera `key,context,es`, `53537` bytes).
     - `GET /`, `GET /manual`, `GET /readme`, `GET /api/metrics` -> HTTP 200 (`version_info.current_version: "12.9.0"`, discos emitiendo `transport_key` y `label_key`).
