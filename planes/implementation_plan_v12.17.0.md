# Plan de Implementación v12.17.0 — Diccionario OTA desde GitHub y Reglas de Pre-Sincronización

## 1. Objetivo
Permitir que **backend Python (`server.py` / `i18n_catalog.py`)**, **interfaz web React (`src/i18n/`)**, **App Nativa Ubuntu (`desktop_app/recursos_app.py`)** y **App Nativa Android / Android TV (`I18nDictionary.kt`)** obtengan y fusionen automáticamente las actualizaciones del diccionario tabular `./i18n/dictionary.csv` directamente desde GitHub (`raw.githubusercontent.com/cminewarIA/recursos-ui/main/i18n/dictionary.csv`), manteniendo siempre el archivo empaquetado como fallback instantáneo offline.

De este modo, añadir nuevas columnas de idioma o mejorar traducciones en GitHub propaga los idiomas sin tener que modificar código, recompilar la app ni incrementar `./VERSION`.

## 2. Alcance de Cambios
1. **Reglas del Proyecto (`GEMINI.md`) y Versión (`VERSION` = `12.17.0`)**:
   - Añadir comprobación previa obligatoria contra GitHub (`git fetch origin`, `git rev-list --left-right --count origin/main...HEAD`, `git status --short`) antes de editar código o subir `./VERSION`.
   - Documentar explícitamente en Regla 2 y Regla 7 que añadir idiomas o traducciones en `./i18n/dictionary.csv` **no** requiere modificar `./VERSION` ni recompilar paquetes nativos.
2. **Motor Python Unificado (`i18n_catalog.py`)**:
   - Añadir descarga condicional OTA desde `GITHUB_DICTIONARY_RAW_URL` con `ETag` (`If-None-Match`) y `Last-Modified`, guardada en caché de usuario (`~/.cache/recursos-cockpit/dictionary_remote.csv`) sin ensuciar el repositorio Git.
   - Implementar `merge_parsed_dictionaries()` para incorporar nuevas columnas/idiomas de GitHub conservando cualquier clave local en desarrollo aún no subida y exponiendo metadatos OTA (`ota_source`, `ota_synced_at`, `github_raw_url`).
   - Añadir `sync_dictionary_from_github()` y refresco periódico no bloqueante (`schedule_background_dictionary_sync()`).
3. **Servidor (`server.py`) y Vite Dev (`vite.config.ts`)**:
   - Permitir `https://raw.githubusercontent.com` en `connect-src` de la cabecera `Content-Security-Policy` en `server.py`.
   - Iniciar sincronización en segundo plano del diccionario al arrancar el servidor y soportar `?refresh=1` en `GET /api/dictionary` y `GET /i18n/dictionary.csv` (tanto en `server.py` como en `vite.config.ts`).
4. **App Nativa Ubuntu (`desktop_app/recursos_app.py`)**:
   - Corregir `i18n_t()` para pasar correctamente `lang=` y `**params` desempaquetados a `i18n_catalog.t()`.
   - Servir localmente `/api/dictionary` y `/i18n/dictionary.csv` en el bridge HTTP cuando no haya servidor remoto (o con `?refresh=1`) y lanzar `schedule_background_dictionary_sync()` al iniciar `ServerConnectionManager`.
5. **Frontend Web (`src/i18n/csvParser.ts`, `src/i18n/index.tsx`, `src/components/MoreView.tsx`)**:
   - Implementar `mergeCsvDictionaries()` y caché en `localStorage` (`recursos_i18n_github_csv`), sincronizando vía `/api/dictionary` y, cuando proceda, directo contra `raw.githubusercontent.com`.
   - Añadir botón simétrico **`Actualizar idiomas`** en `MoreView.tsx` con indicador de fuente/estado OTA.
6. **App Nativa Android / Android TV (`I18nDictionary.kt`, `CockpitDashboard.kt`)**:
   - Fusionar en tiempo de ejecución `filesDir/i18n/dictionary_ota.csv` sobre `assets/i18n/dictionary.csv`.
   - Añadir `syncRemoteDictionary()` en hilo IO con `If-None-Match` (`ETag`) desde el servidor conectado y/o GitHub, incrementando `catalogRevision` (`mutableIntStateOf`) para recomponer la UI de Compose al vuelo sin recompilar la APK.
7. **Internacionalización (`i18n/dictionary.csv`) y Documentación (`README.md`)**:
   - Registrar las claves nuevas del selector/sincronización de idiomas en `./i18n/dictionary.csv` y actualizar `./README.md` y `./planes/walkthrough_v12.17.0.md`.
