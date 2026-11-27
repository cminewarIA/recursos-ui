# Plan de Implementación — Configuración Segura LAN-Only del Router (`v14.7.0`)

## Objetivo
Permitir que el usuario configure, pruebe por SSH y guarde cifradas en caliente con `AES-256-GCM` las credenciales del router desde el propio panel de red (`NetworkDevicesModal.tsx`), manteniendo aislamiento estricto de red local (`is_local`) y cero datos hardcodeados.

## Cambios Técnicos
1. **Backend (`server.py`, `VERSION=14.7.0`)**:
   - Añadir `ROUTER_CREDS_LOCK` y soporte de `router_port` en `_load_router_credentials()` y `wifi_collector()`.
   - Añadir validación estricta LAN-only (`_is_lan_ipv4`) + test SSH (`_test_router_ssh_connection`), guardado atómico cifrado (`_save_router_credentials_vault`) y borrado (`_clear_router_credentials_vault`) con invalidación inmediata de caché.
   - Exponer `GET /api/network/router-credentials` (autenticado, nunca devuelve contraseñas) y `POST /api/network/router-credentials` (estrictamente bloqueado a peticiones LAN con HTTP 403 si viene de WAN).
2. **Interfaz Web ([NetworkDevicesModal.tsx](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/components/NetworkDevicesModal.tsx) y [telemetry.ts](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/src/types/telemetry.ts))**:
   - Botón **«Configurar router»** en el aviso ámbar del modal de ancho de banda y en la tarjeta de fuente de tráfico.
   - Formulario seguro inline con pre-relleno dinámico desde router/gateway detectado, botón **Probar SSH**, **Guardar y cifrar (AES-256-GCM)** y **Desvincular**, mostrando bloqueo pasivo cuando se accede fuera de LAN.
3. **Internacionalización y Documentación**:
   - Añadir claves `overview.router_cfg_*` en las 31 columnas de idioma de [dictionary.csv](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/i18n/dictionary.csv).
   - Actualizar [README.md](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/README.md) y registrar resultados en `./planes/walkthrough_v14.7.0.md`.
