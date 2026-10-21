# Plan y Registro de Cambios: Persistencia Robusta de Popups y Regla Zero-Hardcoding (`v4.11.2`)

## 1. Diagnóstico del Problema de Desaparición de Popups
1. **Causa raíz descubierta**:
   - `conntrack` del kernel renueva constantemente sockets con puertos efímeros de corta duración (`TIME_WAIT`, `CLOSE`).
   - Cada 2 segundos, el número de elementos y las claves de grupo (`groupKey`) cambiaban levemente.
   - La función `popupopen` de Leaflet sobreescribía `_activePopupState` borrando `activeRemoteIp`.
   - Cuando `renderDynamicClusters` intentaba restaurar el popup mediante `_groupsMap.has(groupKey)`, la clave ya no existía y la búsqueda fallaba, provocando que el popup desapareciera misteriosamente ante los ojos del usuario.
   - Adicionalmente, el evento `popupclose` de Leaflet se disparaba al desvincular capas en `clearConnectionOverlays()`, borrando el estado si coincidía con un ciclo sin redibujado activo.

## 2. Solución Implementada
1. **Eliminación del borrado reactivo en `popupclose`**:
   - Los popups solo se marcan como cerrados si el usuario hace clic deliberadamente sobre el botón `[×]` (`.leaflet-popup-close-button`) o presiona la tecla `Escape`.
2. **Algoritmo de Restauración Multicriterio (`Multi-tier Matching`)**:
   - En cada refresco o cambio de zoom, la búsqueda del marcador a reabrir se realiza en 5 niveles de fallback:
     1. Coincidencia por ID de socket si sigue vivo.
     2. Coincidencia por la IP remota seleccionada (`activeRemoteIp`).
     3. Coincidencia por la IP representativa del grupo (`representativeIp`).
     4. Coincidencia por cualquiera de las IPs que componían el cluster (`clusterIps`).
     5. Coincidencia geográfica por proximidad espacial euclídea (`lat, lng` < 5°).
   - El popup se mantiene permanentemente abierto independientemente de que se abran o cierren sockets efímeros en segundo plano.
3. **Incorporación de la Regla 7 en `GEMINI.md`**:
   - Principio formal de Zero-Hardcoding: prohibición de nombres de ciudades o proveedores cableados, interfaces estáticas o listas preasignadas.
