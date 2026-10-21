# Recorrido y Verificación: Traducción de IPs Locales y Externas mediante Pi-hole DNS (`v4.12.0`)

## Resumen de Cambios Implementados

Se ha dotado al sistema de un motor de resolución y traducción de IPs en tiempo real denominado `PiholeDnsTranslator` en el backend `server.py`, el cual consulta dinámicamente las fuentes de verdad de Pi-hole y DNS para humanizar todas las direcciones IP en el mapa y la tabla de conexiones de red:

1. **Traducción de IPs Locales (LAN)**:
   - Fuentes consultadas:
     - `/etc/pihole/custom.list`: Nombres amigables estáticos y sincronizados por el usuario.
     - `/etc/pihole/pihole-FTL.db` (`network_addresses`): Concesiones dinámicas de DHCP de Pi-hole.
     - `/etc/hosts`: Asignaciones locales del sistema.
   - Resultado: Direcciones privadas como `192.168.50.16` se traducen automáticamente a `tab-s9-ultra-de-yonah`, `192.168.50.187` a `tv-de-la-sala-de-estar`, `192.168.50.252` a `s25-yonah`, `192.168.50.5` a `xbox-one-x`, `192.168.50.6` a `nintendo-switch-oled`, etc.

2. **Traducción de IPs Externas (WAN / Internet)**:
   - Fuente consultada: `/var/log/pihole/pihole.log` de dnsmasq / Pi-hole con lectura incremental mediante puntero de archivo (`seek`), capturando patrones `reply`, `cached` y `cached-stale <dominio> is <ip>`.
   - Fallback secundario: Caché de resolución inversa DNS (`socket.gethostbyaddr`) con TTL de 6 horas.
   - Resultado: Direcciones públicas como `20.250.119.72` se asocian a `api.github.com`, `1.1.1.1` a `one.one.one.one`, `208.95.112.1` a `ip-api.com`, `token-icons.llamao.fi`, etc.

3. **Presentación Reactiva en el Frontend**:
   - **Marcadores del Mapa (`L.marker`)**: La función `getDynamicClusterLabel` y los pines individuales priorizan el nombre de dominio sobre la IP numérica cruda.
   - **Ventanas Emergentes (Popups)**: Se añade una tarjeta visual azul destacada `🌐 Dominio DNS (Pi-hole)` y se desglosa el dispositivo doméstico local emisor (`tab-s9-ultra-de-yonah:54321`).
   - **Lista de Conexiones Agrupadas**: Cada socket muestra claramente el dominio o IP y el equipo emisor (`← s25-yonah`).
   - **Tabla de Conexiones de Red**: Incorpora badges de dominio `🌐 <dominio>` y nombres amigables de dispositivo.

4. **Principio de Cero Hardcoding y Criterio Estricto de Versión**:
   - Totalmente dinámico, cero texto estático cableado.
   - Incremento de versión canónico a `v4.12.0` (`0.X.0` al añadir nueva funcionalidad, restableciendo el parche a 0).

---

## Verificación en el Servidor

### 1. Prueba Unitaria del Motor `PiholeDnsTranslator`
- Nombres locales indexados: 96 dispositivos (`tab-s9-ultra-de-yonah`, `tv-de-la-sala-de-estar`, `s25-yonah`).
- Dominios externos indexados en memoria: >1360 dominios (`api.github.com`, `one.one.one.one`, etc.).
- Tiempo de lectura incremental: < 0.2 milisegundos.

### 2. Reinicio y Salud del Servicio
- Servicio `system-dashboard.service` reiniciado y verificado activo con `systemctl restart`.
- Endpoints `/api/version` y `/api/metrics` respondiendo correctamente con versión `4.12.0` y campos `domain` y `local_hostname` poblados en `connections_geo`.
