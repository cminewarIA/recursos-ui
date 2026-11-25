# Walkthrough v14.4.1 — Corrección del Colector de Métricas (`METRICS_CACHE`) y Recompilación Frontend

## 1. Diagnóstico en Producción (`v14.4.0` / `8c908c3`)
- `GET /api/metrics` devolvía únicamente 5 claves auxiliares (`version_info`, `maps_engine`, `system_errors_summary`, `custom_logos`, `auth_status`) y carecía de `system`, `cpu`, `gpu`, `ram`, `disks`, `disk_io`, `net` e `history`.
- En `recursos_history.db`, `device_series_history` tenía `0` filas mientras el resto de tablas persistentes conservaban su historial.
- Causa raíz en [server.py](../server.py#L15379-L15464) (introducida en `1ad0c4c`):
  - El bucle recolector iteraba sobre `net_info.get("interfaces") or []` (que es un `dict` indexado por nombre de NIC) en lugar de `net_info.get("interfaces_list")`.
  - Al recibir un `str`, `nic_item.get("name")` lanzaba `AttributeError`, abortando cada ciclo antes de persistir `device_series_history` y antes de actualizar `METRICS_CACHE = payload`, silenciado por `except Exception: pass`.
- Adicionalmente, `static/index.html` no se había recompilado tras `8c908c3` (`TelemetryChart.tsx` y temas desacoplados).

## 2. Correcciones Implementadas
- **[server.py](../server.py#L15379-L15464)**:
  - Iteración segura sobre `net_info.get("interfaces_list")` (con respaldo sobre `list(interfaces.values())` si procede) y comprobación `isinstance(..., dict)` para sensores CPU, discos e interfaces NIC.
  - Aislamiento `try/except` específico para `device_series_history` con registro acotado (`cycle_counter % 20 == 1`) y trazado de error en el bucle principal en lugar de `pass` silencioso.
- **[VERSION](../VERSION)**: incrementado a `14.4.1` (`PATCH`). `UBUNTU_VERSION` y `ANDROID_VERSION` permanecen sin cambios al no haber modificaciones nativas.
- **Frontend**: recompilados [static/index.html](../static/index.html) y los recursos de `static/assets/` (`index-Bf3I-Ktm.js` e `index-Ovo0RwCn.css`).

## 3. Verificación Estática y de Compilación
- `python3 -W error::SyntaxWarning -m py_compile server.py i18n_catalog.py themes_catalog.py`: salida `0`.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: salida `0`.
- `npm run build` (`vite v8.3.8`): `2091 modules transformed`, compilado en `3.88s` (`static/index.html`, `index-Ovo0RwCn.css`, `index-Bf3I-Ktm.js`).
- `i18n/dictionary.csv`: `31` columnas de idioma, `1155` filas válidas.
