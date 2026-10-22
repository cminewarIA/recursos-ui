# Plan de Corrección - v8.3.2: Corrección del Visor del Centro Unificado de Registro de Fallos

## 1. Causa Raíz Identificada

El backend (`server.py`) recopila y devuelve los errores en `/api/system/logs` bajo la propiedad JSON `"logs"`:
```python
result = {
    "success": True,
    "total_errors": len(logs),
    "failed_units_count": len(failed_units),
    "failed_units": failed_units,
    "counts_by_category": category_counts,
    "logs": logs,
    "fetched_at": datetime.now().strftime("%H:%M:%S")
}
```

Sin embargo, en el frontend (`static/index.html` e `index.html`), el método `fetchLogs()` consumía exclusivamente `data.entries`:
```javascript
const data = await res.json();
this._logs = data.entries || [];
```
Al ser `data.entries` indefinido (`undefined`), `this._logs` se evaluaba como una lista vacía `[]`. Por consiguiente:
1. El indicador en la cabecera leía correctamente `/api/metrics` mostrando **"Fallos: 49 detectados"**.
2. Al abrir la tarjeta de fallos o el modal, `SystemLogsCenter.render()` encontraba 0 elementos y mostraba:
   `✔ [OK] No se encontraron fallos ni errores con los filtros aplicados. 0 eventos`.
3. Los botones de categorías ("Todos", "Apps & Docker", "Servicios", "Kernel") se sobreescribían a 0 porque `counts.total` no existía en `category_counts` y `this._logs.length` era 0.
4. El campo de fecha/hora buscaba `entry.date_str`, pero el backend solo enviaba `time_str` y `time_iso`.

---

## 2. Cambios a Implementar

### A. Backend (`server.py`)
1. **Doble Compatibilidad (`logs` y `entries`)**: Devolver tanto `"logs": logs` como `"entries": logs` en `fetch_system_logs()` y en el endpoint `/api/system/logs`.
2. **Conteo Total**: Incluir `category_counts["total"] = len(logs)` para que el resumen por categorías contenga siempre el total.
3. **Metadatos Enriquecidos por Entrada**:
   - `"date_str": time_str`
   - `"source": unit_name`
   - `"container": unit_name if category == "docker" else ""`
4. **Filtrado por Categoría**: Al filtrar por categoría (`cat != 'all'`), sincronizar tanto `logs` como `entries` y `total_errors = len(filtered_logs)`.

### B. Frontend (`index.html` y `static/index.html`)
1. **Consumo Resiliente**: `this._logs = data.logs || data.entries || [];`.
2. **Contadores de Categoría**:
   - `const totalCount = data.total_errors ?? counts.total ?? this._logs.length;`
   - Actualizar `cntSysErrAll` con `totalCount`.
3. **Formato de Fecha/Hora Robusto**:
   - `const dateStr = entry.time_str || (entry.date_str ? entry.date_str.split(' ')[1] || entry.date_str : entry.time_iso || '');`
4. **Buscador en Modal**: Sincronizar búsqueda e incluir campo de filtro en el diálogo a pantalla completa.

### C. Control de Versión Canónica (`v8.3.2`)
- Actualizar `./VERSION` a `8.3.2`.
- Sincronizar `package.json` y `packaging/debian/control`.
- Actualizar `README.md` con la fila `v8.3.2` en el historial.
- Guardar planes y bitácora en `planes/`.

---

## 3. Plan de Verificación
1. Validar sintaxis con `python3 -m py_compile server.py`.
2. Probar `/api/system/logs` con `curl` verificando presencia de `logs` y `entries`.
3. Comprobar que `diff -q static/index.html index.html` no tiene diferencias.
4. Reiniciar `system-dashboard.service`.
5. Ejecutar script de empaquetado `packaging/build_deb.sh` para `8.3.2`.
6. Confirmar commit y push a GitHub.
