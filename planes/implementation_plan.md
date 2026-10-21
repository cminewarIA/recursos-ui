# Plan de Implementación: Flujos de Conexión de Dispositivos del Hogar vía Pi-hole (`v4.13.0`)

Para detalles completos ver: [2026-10-21_flujos_conexiones_dispositivos_hogar_pihole.md](file:///home/servidor/servicios/dashboard/planes/2026-10-21_flujos_conexiones_dispositivos_hogar_pihole.md)

### Resumen
- Ingesta de conexiones activas de dispositivos de la LAN doméstica mediante la base de datos de consultas de Pi-hole (`pihole-FTL.db` `queries`).
- Enriquecimiento con IPs públicas resueltas y geolocalización en el mapa mundial.
- Filtro segmentado `"📱 Dispositivos"` en el mapa y diferenciación clara entre el servidor y los dispositivos domésticos en la tabla y popups.
- Incremento de versión a `4.13.0` según Regla 5.
