# Verificación y Entrega — Recursos Cockpit v14.7.2

## Resumen del Cambio
- Extraído helper compartido `_build_router_ssh_base_cmd()` en [server.py](file:///home/servidor/almacenamiento/proyectos/panel%20de%20recursos/recursos-ui/server.py#L440-L465) con `PubkeyAuthentication=no`, `PreferredAuthentications=password` y `NumberOfPasswordPrompts=1` para que `sshpass` nunca consuma intentos de autenticación probando claves locales (`id_ed25519`) contra Dropbear del router ASUS ni cierre sesiones por exceso de intentos.
- Actualizada versión en `VERSION` a `14.7.2`, compilado frontend (`static/index.html`) y desplegado en `/home/servidor/servicios/dashboard`.
