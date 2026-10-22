# Plan de Implementación — v8.2.0

## 1. Sincronización Total de Filtros del Mapa con el Detalle de Flujos y Sockets
- **Consistencia Estricta con `mapConns`**: El contenedor de "Detalle de Flujos y Sockets Geolocalizados" (`#networkConnectionsTableList`) renderiza de forma exclusiva las conexiones geolocalizadas activas en el mapa (`mapConns`), garantizando que cualquier filtro activo en el mapa (modo En Vivo vs Historial, dirección `Todas`/`Entrantes`/`Salientes`/`Equipos LAN`/`Bloqueadas`, aislamiento de dispositivo, servicio del catálogo o búsqueda) aplique de inmediato a las cápsulas.
- **Cuadrícula Unificada de Cápsulas Responsivas (`.conn-capsules-grid`)**: Se unifica la presentación para que siempre se rendericen cápsulas compactas sin alternar a estructuras discordantes de acordón cuando se filtra por equipos LAN.
- **Chips de Filtros Activos en Cabecera (`#connTableFilterChips`)**: En la cabecera de la sección se despliegan dinámicamente chips interactivos con botón `✕` para remover cada filtro individualmente o restablecer todos los filtros en un clic (`resetAllMapFilters()`).
- **Enfoque Bidireccional Interactivo Mapa ↔ Cápsula (`.conn-capsule.is-focused`)**:
  - Al pulsar una cápsula en la tabla se vuela al punto en el mapa, se abre su popup y se marca la cápsula como activa.
  - Al pulsar un marcador o clúster en el mapa, se ilumina la cápsula correspondiente en la tabla (`syncFocusedCapsule`) y se hace scroll automático para mantenerla visible.
- **Filtros Combinables No Destructivos**: Se corrigen las funciones `setConnectionsMapFilter` y `setConnectionsMapDevice` para permitir combinaciones (ej. equipo específico + conexiones entrantes) sin que un filtro anule destructivamente al otro.
