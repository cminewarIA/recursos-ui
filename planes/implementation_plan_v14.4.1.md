# Plan de Implementación v14.4.1 — Reparación del Colector de Métricas (`METRICS_CACHE`) y Recompilación Frontend

## 1. Problema Detectado
- En producción (`v14.4.0`), las gráficas en vivo (`/inicio`, `/equipo`, `/red`) no se mostraban porque `GET /api/metrics` devolvía únicamente 5 claves auxiliares (`version_info`, `maps_engine`, `system_errors_summary`, `custom_logos`, `auth_status`) sin `system`, `cpu`, `gpu`, `ram`, `disks`, `disk_io`, `net` ni `history`.
- La tabla `device_series_history` en `recursos_history.db` permanecía vacía (`0` filas).
- Además, `static/index.html` no se había recompilado tras los cambios recientes en `src/components/TelemetryChart.tsx` y el sistema de temas (`8c908c3`).

## 2. Causa Raíz
1. En `server.py` (línea `15399`, introducida en `1ad0c4c`), el bucle recolector ejecutaba:
   `for nic_item in (net_info.get("interfaces") or []):`
   Pero `net_info["interfaces"]` es un `dict` (`{"enp7s0": {...}}`) y no una lista (`net_info["interfaces_list"]`), por lo que `nic_item` resultaba ser un `str` y `nic_item.get("name")` lanzaba `AttributeError: 'str' object has no attribute 'get'`.
2. Ese `AttributeError` abortaba el ciclo **antes** de grabar `device_series_history` y **antes** de asignar `METRICS_CACHE = payload`, siendo silenciado por `except Exception: pass`.

## 3. Cambios Aplicados
- **`server.py`**:
  - Iteración segura sobre `net_info.get("interfaces_list")` con fallback a `list(interfaces.values())` y validación `isinstance(..., dict)` para sensores CPU, discos e interfaces NIC.
  - Aislamiento `try/except` propio para `device_series_history` y trazado periódico (`cycle_counter % 20 == 1`) en errores del recolector en lugar de `pass` silencioso.
- **`VERSION`**: incremento `PATCH` de `14.4.0` -> `14.4.1` (sin cambios nativos en `UBUNTU_VERSION`/`ANDROID_VERSION`).
- **Frontend (`static/index.html`)**: validación estricta TypeScript y compilación standalone con Vite (`npm run build`).
- **Despliegue y Sincronización**: commit + tag `v14.4.1`, `git push origin main v14.4.1`, alineación de `/home/servidor/servicios/dashboard` sin tocar bases SQLite locales y reinicio de `system-dashboard.service` con comprobación HTTP y de series en vivo.
