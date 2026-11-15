# Plan de Implementación — `v12.9.0` (Fuente Única de Versión + Diccionario Centralizado de Proyecto y Telemetría de Hardware)

## 1. Objetivo y Alcance
Resolver de forma estructural y permanente dos mejoras transversales solicitadas sobre **Recursos Cockpit**:
1. **Llamada Única de Versión (`./VERSION` como Punto Único de Verdad)**: Eliminar la duplicación manual o literal de números de versión repartidos por archivos del backend, frontend, manual interactivo, README, SVG de documentación, scripts/manifests de empaquetado Debian y Gradle de Android. Toda mención o cálculo de versión en tiempo de ejecución o compilación debe consultar una única llamada/extractor que lee `./VERSION`.
2. **Diccionario Centralizado del Proyecto e Internacionalización de Lecturas de Hardware (`./i18n/dictionary.json`)**: Unificar todos los textos mostrados en la interfaz (Web, App Nativa Linux GTK/WebKit2, App Nativa Android/TV y Manual Interactivo) y todas las etiquetas, estados, clasificaciones, transportes, roles de servicios y unidades de lecturas de hardware en un diccionario único multi-idioma (`es` por defecto y `en` completo para verificar traducciones instantáneas).
3. **Codificación como Norma Permanente**: Actualizar [`GEMINI.md`](../GEMINI.md) y el flujo de lanzamiento (`cockpit-release/SKILL.md`) para exigir ambos principios en todo desarrollo futuro.

- **Versión objetivo**: `12.9.0` (`MINOR` conforme a la Regla 2 de `GEMINI.md`: nueva arquitectura de diccionario centralizado y capa unificada de versión única).

---

## 2. Arquitectura de Fuente y Llamada Única de Versión

### 2.1 Origen Canónico Único
- **`./VERSION`**: único archivo editado al incrementar versión SemVer.

### 2.2 Consumidores por Capa (Cero Literales Repetidos)
| Capa | Mecanismo de Llamada Única | Eliminaciones de Hardcoding |
| :--- | :--- | :--- |
| **Core Python (`i18n_catalog.py`)** | `get_canonical_version(base_dir)` busca `VERSION` en `base_dir` / raíz del paquete. | Elimina fallback `'12.8.0'` en `server.py:4032`. |
| **Backend (`server.py`)** | `get_app_version()` delega en `get_canonical_version(BASE_DIR)` y se define antes de su primer uso (`User-Agent`, HTML injection, `/api/version`, `/api/metrics`). | Sin literales SemVer en código Python. |
| **App Nativa Ubuntu (`desktop_app/recursos_app.py`)** | `get_app_version()` usa `get_canonical_version(BASE_DIR)` con fallback seguro de rutas instaladas. | Reemplaza duplicación dispersa. |
| **Build Frontend (`vite.config.ts`)** | `readAppVersion()` ya lee `./VERSION`; se inyecta globalmente en tiempo de compilación vía `define: { __APP_VERSION__: JSON.stringify(readAppVersion()) }`. | Sin fallback literal en JSX/TSX. |
| **Frontend React (`src/utils/version.ts`)** | `getCanonicalVersion(versionInfo?)` resuelve en orden: `versionInfo?.current_version` → `window.__INITIAL_APP_VERSION__` → `window.AndroidBridge?.getAppVersion?.()` → `__APP_VERSION__`. | Elimina `'12.8.0'` de `src/App.tsx`, `src/utils/formatters.ts` y `src/components/MoreView.tsx`. |
| **Manual Interactivo (`static/manual.html` & `docs/index.html`)** | `resolveCanonicalVersion()` consulta `window.__INITIAL_APP_VERSION__`, `/api/version`, `./VERSION` / `../VERSION` o GitHub raw `VERSION`, e hidrata todos los slots (`data-version-slot`, enlaces `.deb`/`.apk`, comandos y ejemplos JSON). | Elimina las 14 ocurrencias de `12.8.0` en HTML y JS. |
| **Empaquetado Debian (`packaging/debian/control` & `build_deb.sh`)** | `packaging/debian/control` mantiene plantilla neutra (`0.0.0`); `packaging/build_deb.sh` inyecta `${VERSION}` en `Version:`, `Replaces:` y `Description:`, además de propagar `${VERSION}` dentro del `package.json` empaquetado. | Evita editar `debian/control` y `package.json` a mano en cada versión. |
| **Empaquetado Android (`android_app/app/build.gradle.kts`)** | Lee `../../VERSION` estrictamente para `versionName` y `versionCode` (con fallback `0.0.0` / lanza error si falta, eliminando `"12.0.1"` / `120001`). | Elimina fallback obsoleto `"12.0.1"`. |
| **Documentación (`README.md` y SVG `docs/assets/`)** | `README.md` enlaza a [`./VERSION`](./VERSION), usa badge dinámico de Shields.io apuntando a `VERSION` en GitHub y enlaces `releases/latest`; los SVG muestran etiqueta neutra `VERSION · ./VERSION`. | Elimina las ~15 menciones fijas en `README.md` y SVG. |

---

## 3. Arquitectura del Diccionario Tabular Tipo Hoja de Cálculo (`./i18n/dictionary.csv`)

### 3.1 Formato Tabular Extensible por Columnas (`key,context,es,...`)
En lugar de duplicar archivos por idioma o editar código para traducir, todo el texto de UI y lecturas de hardware reside en **una única hoja de cálculo CSV**: `./i18n/dictionary.csv`.
- **Columnas**: `key` | `context` | `es` *(traducción base actual marcada explícitamente como Español)* | *(cualquier columna nueva a futuro: `en`, `fr`, `de`, `pt`, etc.)*.
- **Metadatos integrados**:
  - Fila `__locale_name__`: define el nombre visible de cada columna en el selector de idiomas (`Español`, `English`, `Français`, ...; si se omite en una columna nueva, `Intl.DisplayNames` o el código en mayúsculas lo deduce automáticamente).
  - Fila `__default_locale__`: marca la columna predeterminada al arrancar (`*` en `es`).
- **Compatibilidad universal con herramientas ofimáticas**: todos los parsers (Python `i18n_catalog.py`, Vite/React `csvParser.ts`, Manual HTML e `I18nDictionary.kt`) soportan UTF-8 con/sin BOM y autodetectan coma `,` o punto y coma `;` (Excel en español / LibreOffice Calc / Google Sheets). Al añadir una nueva columna al CSV en servidor sin siquiera recompilar, `/api/dictionary` la expone en vivo automáticamente.

### 3.2 Normalización Estructural de Lecturas de Hardware
Para que las lecturas de hardware respondan dinámicamente a traducciones sin romper compatibilidad con clientes existentes:
- **Backend (`server.py`) y Middleware (`vite.config.ts`)**:
  - Conservan los valores dinámicos reales del sistema (`model`, `hostname`, `mountpoint`, `device`, `name`, `ip`, `pid`) cumpliendo la Regla 1 (Zero-Hardcoding).
  - Emiten claves estructuradas junto al texto por defecto resuelto desde `i18n_catalog.py`:
    - Discos (`disks[]`): `transport_key`, `label_key`, `label_params`, `fstype_key`.
    - GPU procesos (`gpu.processes[]`): `name_key`.
    - Clientes LAN/Wi-Fi (`wifi_clients[]`): `band_key`, `vendor_key`.
    - Servicios systemd (`systemd_services[]`): `role_key`, `state_key`.
    - Conexiones/GeoIP: `city_key` (cuando aplica a gateway interno o resolución pendiente).
- **Frontend (`src/i18n/index.tsx` + `src/utils/formatters.ts`)**:
  - Expone `I18nProvider` y `useI18n()` con `locale`, `setLocale`, `t(key, vars?)` y helpers específicos para lecturas de hardware (`formatDiskTransport`, `formatDiskLabel`, `formatDiskFstype`, `formatBandLabel`, `formatSystemdState`, `formatGpuProcName`, `formatTemp`, `formatRelativeIndexAge`, `getHealthTone`).
  - Todas las vistas React (`App.tsx`, `OverviewView.tsx`, `EquipmentView.tsx`, `NetworkSecurityView.tsx`, `AppsMediaView.tsx`, `MoreView.tsx`, `TelemetryChart.tsx`, `ExpandedChartModal.tsx`) consumen el diccionario y añaden selector simétrico de idioma (`Español` / `English`) en `MoreView.tsx`.
- **Apps Nativas y Manual**:
  - `desktop_app/recursos_app.py` usa `i18n_catalog.py` para mensajes del lanzador GTK, notificaciones y estados de actualización.
  - `server.py` expone `/api/dictionary` y lista `i18n/dictionary.json` y `i18n_catalog.py` en `build_deb.sh` y en `ALLOWED_WEB_SYNC_FILES`.
  - `android_app/app/build.gradle.kts` empaqueta automáticamente `../../i18n/dictionary.json` en `assets/i18n/dictionary.json` y un módulo `I18nDictionary.kt` hidrata las etiquetas de las tarjetas nativas (`CockpitDashboard.kt`, `SystemCard.kt`, `FloatingTouchDock.kt`).
  - `static/manual.html` / `docs/index.html` consumen el diccionario para cabecera, avisos, controles de copia/descarga y cambio de idioma.

---

## 4. Plan de Verificación
1. `npx tsc --noEmit` (cero errores de tipos TypeScript).
2. `npm run build` (compilación Vite de `static/index.html` con versión inyectada desde `./VERSION`).
3. `python3 -m py_compile server.py desktop_app/recursos_app.py i18n_catalog.py` + test unitario rápido de `i18n_catalog.py` (`es` y `en` + resolución de lecturas de hardware y versión única).
4. `rg` global verificando ausencia de literales `12.9.0` / `12.8.0` / `12.0.1` duplicados en código fuente.
5. `bash packaging/install_all.sh` (`.deb` + `/usr/bin/recursos-cockpit --test-mode` + Android TV `.apk`).
6. Sincronización de `/home/servidor/servicios/dashboard/` y comprobación HTTP de `/api/version`, `/api/metrics` y `/api/dictionary`.
7. Commit + tag `v12.9.0` y registro final en `planes/walkthrough_v12.9.0.md`.
