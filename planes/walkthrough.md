# Walkthrough General: Recursos Dashboard (`v4.12.0`)

## Última Actualización: Traducción de IPs Locales y Externas mediante Pi-hole DNS (`v4.12.0`)

Para detalles completos ver: [2026-10-21_walkthrough_traduccion_ips_locales_y_externas_pihole.md](file:///home/servidor/servicios/dashboard/planes/2026-10-21_walkthrough_traduccion_ips_locales_y_externas_pihole.md)

### Resumen de Cambios
- **Traductor Pi-hole DNS en `server.py` (`PiholeDnsTranslator`)**:
  - Consulta `/etc/pihole/custom.list`, `/etc/pihole/pihole-FTL.db` y `/etc/hosts` para traducir IPs locales a nombres reales de dispositivos del hogar.
  - Consulta `/var/log/pihole/pihole.log` de forma incremental con `seek` y caché rDNS para asociar IPs públicas con sus dominios reales en <0.2 ms.
- **Frontend (`static/index.html` e `index.html`)**:
  - Marcadores de mapa y etiquetas de cluster priorizan el dominio DNS resuelto.
  - Popups individuales y listas de clusters muestran tarjetas de dominio (`🌐 Dominio DNS`) y nombre amigable del dispositivo emisor (`tab-s9-ultra-de-yonah`).
  - Tabla de conexiones de red enriquecida con badges de dominio y nombre de dispositivo.
- **Cumplimiento de Reglas**:
  - Regla 5: Subida de versión a `4.12.0`.
  - Regla 7: Cero hardcoding.
