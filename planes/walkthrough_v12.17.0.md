# Walkthrough v12.17.0 — Diccionario Multi-Idioma OTA desde GitHub y Reglas de Pre-Sincronización

## 1. Pre-Sincronización Realizada al Inicio
- Antes de comenzar la modificación, se ejecutó `git fetch origin`, se detectaron commits remotos pendientes en `origin/main` (`v12.16.1` / `v12.16.3`), se integró `GEMINI.md` mediante rebase limpio (`febff9f` sobre `d8468ec`) y se publicó `main` en GitHub junto con el fast-forward en `/home/servidor/servicios/dashboard`.

---

## 2. Resumen de Cambios Implementados (`v12.17.0`)

1. **Normas en [GEMINI.md](../GEMINI.md)**:
   - **Regla 2.3 (Pre-Sincronización con GitHub)**: antes de modificar código o subir `./VERSION`, es obligatorio comprobar `git fetch origin`, `git rev-list --left-right --count origin/main...HEAD` y `git status --short` e integrar cualquier cambio pendiente.
   - **Regla 2.4 y Regla 7 (Cero Bump para Traducciones)**: añadir columnas de nuevos idiomas o completar/corregir traducciones en `./i18n/dictionary.csv` no requiere incrementar `./VERSION` ni recompilar `.deb`/`.apk`, ya que todas las capas sincronizan OTA desde GitHub.

2. **Motor Python y Caché OTA ([i18n_catalog.py](../i18n_catalog.py) + [server.py](../server.py))**:
   - `sync_dictionary_from_github()` descarga `https://raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv` con validación condicional `ETag` (`If-None-Match` / `If-Modified-Since`) hacia `~/.cache/recursos-cockpit/dictionary_remote.csv` (con fallback a `/tmp` y sin ensuciar Git).
   - `merge_parsed_dictionaries()` fusiona automáticamente columnas/idiomas nuevos desde GitHub manteniendo cualquier clave local aún no subida.
   - `schedule_background_dictionary_sync()` sincroniza en segundo plano al iniciar `server.py` (y cada 30 min), `GET /api/dictionary?refresh=1` y `GET /i18n/dictionary.csv?refresh=1` fuerzan comprobación inmediata, y la cabecera `Content-Security-Policy` (`connect-src`) habilita `https://raw.githubusercontent.com`.

3. **Frontend Web React ([csvParser.ts](../src/i18n/csvParser.ts), [index.tsx](../src/i18n/index.tsx), [MoreView.tsx](../src/components/MoreView.tsx))**:
   - `mergeCsvDictionaries()` + caché `localStorage` (`recursos_i18n_github_csv`), carga combinada de `/api/dictionary` y respaldo directo a `raw.githubusercontent.com`.
   - En **Más → Aspecto**: indicador `GitHub OTA` / `Caché local` y botón táctil `Actualizar idiomas` (`data-testid="sync-languages-btn"`) que refresca idiomas sin actualizar ni reiniciar la aplicación.

4. **App Nativa Ubuntu ([recursos_app.py](../desktop_app/recursos_app.py))**:
   - Corregido `i18n_t()` para pasar `lang=` y `**params` desempaquetados a `i18n_catalog.t()`, habilitando idiomas dinámicos e interpolación de `{parámetros}`.
   - Añadida sincronización OTA en segundo plano en `ServerConnectionManager` y servicio local/proxy de `/api/dictionary` y `/i18n/dictionary.csv` en el puente HTTP.

5. **App Nativa Android / Android TV ([I18nDictionary.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/i18n/I18nDictionary.kt), [MainActivity.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/MainActivity.kt), [CockpitDashboard.kt](../android_app/app/src/main/java/com/cminewar/recursoscockpit/ui/CockpitDashboard.kt))**:
   - Lectura combinada de `assets/i18n/dictionary.csv` + `filesDir/i18n/dictionary_ota.csv`, descarga OTA condicional (`ETag`) desde GitHub y desde `${serverBaseUrl}/i18n/dictionary.csv`, y recomposición automática de Compose mediante `catalogRevision`.

6. **Diccionario y Documentación ([dictionary.csv](../i18n/dictionary.csv), [README.md](../README.md))**:
   - Añadidas las claves `more.language_sync_btn`, `more.language_syncing`, `more.language_synced`, `more.language_sync_error`, `more.language_ota_github`, `more.language_ota_local` (total `844` claves verificadas, `0` faltantes en `src/`).

---

## 3. Verificaciones Ejecutadas (Resultados Reales Observados)

- **TypeScript / Build / Python / Manual**:
  - `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0`.
  - `npm run build` (`vite v8.3.8`): compilado en `2.00s` (`2080` módulos).
  - `python3 -W error::SyntaxWarning -m py_compile i18n_catalog.py server.py desktop_app/recursos_app.py desktop_app/dex_controller.py`: salida `0`.
  - `cmp -s static/manual.html docs/index.html`: salida `0`.
  - Validador i18n CSV: `i18n keys: 844 | missing in src: 0 []`.
- **Pruebas Funcionales OTA + Fix Ubuntu**:
  - `recursos_app.i18n_t("native_ubuntu.update_all_btn", {"ver": "12.17.0"})` → `'Actualizar app y servidor a v12.17.0'`.
  - Fusión sintética de idioma nuevo (`es` + `en`) con `merge_parsed_dictionaries()` → `['es', 'en']`, `'Dictionary language'`, conservando las claves locales existentes.
  - Descarga OTA real en vivo contra `raw.githubusercontent.com`: `{'ok': True, 'updated': True, 'source': 'github', 'synced_at': '2026-11-16T23:49:26Z', 'supported_locales': ['es']}`.
- **Ubuntu Native y Android Kotlin**:
  - `python3 -B desktop_app/recursos_app.py --test-mode`: `[OK] Recursos Native Ubuntu HTML5 App v12.17.0 validated successfully` (`scrcpy 3.3.4`, `dex_unlocked: True`).
  - Gradle `:app:compileReleaseKotlin`: `BUILD SUCCESSFUL in 18s`.
- **Producción (`http://127.0.0.1:8085`) y Chrome Headless CDP**:
  - `system-dashboard.service`: `active`.
  - `/api/version` → `12.17.0`; cabecera CSP incluye `https://raw.githubusercontent.com`.
  - `/api/dictionary?refresh=1` → `ota_source: "github"`, `ota_synced_at: "2026-11-16T23:49:26Z"`; `/i18n/dictionary.csv?refresh=1` → HTTP `200`.
  - Chrome Headless CDP en pestaña **Más**: verificado botón **`Actualizar idiomas`**, insignia **`GitHub OTA`** y notificación **`Diccionario actualizado (1 idioma(s) disponibles)`**, con `CONSOLE_ERRORS: []` y `EXCEPTIONS: []`.
