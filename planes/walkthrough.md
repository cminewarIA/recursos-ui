# Walkthrough y Verificación — v8.2.0

## Resumen de Cambios Implementados

1. **Sincronización Total de Filtros del Mapa con el Detalle de Flujos y Sockets**:
   - En `NetworkConnectionsMapEngine.renderActiveDataset`, la cuadrícula de conexiones `#networkConnectionsTableList` renderiza exactamente el conjunto de conexiones geolocalizadas activas del mapa (`mapConns`).
   - Todos los filtros del mapa aplican reactivamente a las cápsulas:
     - **Modo**: `🟢 En Vivo` vs `📚 Historial SQLite`.
     - **Dirección / Tipo**: `Todas`, `↓ Entrantes`, `↑ Salientes`, `📱 Equipos LAN`, `🛡️ Bloqueadas`.
     - **Dispositivo LAN Aislado**: Cuando se selecciona un equipo (`connectionsMapDeviceSel`), la cuadrícula muestra únicamente los sockets asociados a dicho dispositivo.
     - **Servicio del Catálogo**: Cuando se selecciona un servicio (`connectionsMapServiceSel`), se filtran únicamente las conexiones de ese servicio.
     - **Búsqueda / Ventana Temporal**: Búsqueda por texto y horas en historial SQLite.
   - En caso de no haber conexiones con los filtros actuales, se muestra un estado amigable con botón de restablecimiento rápido (`resetAllMapFilters()`).

2. **Chips de Filtros Activos en la Cabecera de la Sección (`#connTableFilterChips`)**:
   - Se añadieron chips visuales reactivos en la cabecera de "Detalle de Flujos y Sockets Geolocalizados" que muestran cada filtro activo con botón `✕` para removerlo individualmente o un botón `Restablecer todo`.
   - Se corrigieron los selectores en `syncMapSideDrawerUI` para los chips rápidos de servicio y dispositivo.

3. **Enfoque Bidireccional Interactivo (Mapa ↔ Cápsula)**:
   - Al pulsar una cápsula en la tabla, el mapa vuela a sus coordenadas, abre su popup de información y marca la cápsula con la clase `.is-focused` (borde cian brillante y elevación).
   - Al pulsar un marcador o seleccionar un socket en un popup de clúster en el mapa, `syncFocusedCapsule` ilumina automáticamente la cápsula correspondiente en la cuadrícula y la desplaza a la vista.

4. **Sincronización de Archivos y Compilación**:
   - `/index.html` y `/static/index.html` 100% sincronizados.
   - Versión canónica incrementada a `8.2.0` (`MINOR` - actualización intermedia de funcionalidad de componentes) en `/VERSION`, `/package.json`, `/README.md`.
   - Paquete Debian recompilado en `/dist/recursos-cockpit_8.2.0_amd64.deb`.
