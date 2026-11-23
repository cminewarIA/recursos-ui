# Walkthrough · Rediseño Mayor Integral v14.0.0

## 1. Resumen de la Intervención

Se ha completado el rediseño mayor y reorganización arquitectónica del proyecto **Recursos Cockpit** a la versión canónica **`14.0.0`** (MAJOR según `GEMINI.md` regla 6.3), atendiendo la petición:
> *"rediseña completamente la interfaz reorganiza lo que no creas que este bien posisionado basicamente quiero que cojas todo el proyecto y borres la interfaz actual crees una totalmente nueva reorganizando los submenos en los menus correspondientes"*

### Principales Transformaciones de Dominio y Ubicación
1. **Navegación Ergonómica con Barra Lateral Colapsable (`md+`) y Dock Táctil (`< md`)**:
   - En pantallas de escritorio (`md+`), una barra lateral izquierda colapsable (64px contraída / 224px expandida con persistencia y toggle suave) reemplaza la antigua barra inferior que restaba valiosa altura vertical.
   - En pantallas móviles y táctiles (`< md`), se preserva un dock inferior con física `MorphPill` elástica para operación con una sola mano.
   - La cabecera superior se limpia eliminando botones de navegación duplicados y mostrando el contexto del dominio activo con breadcrumb tabular.

2. **`/inicio` — HUD Ejecutivo de Telemetría**:
   - 4 medidores angulares HUD para lectura en 1 segundo: CPU, Memoria RAM + ZRAM, Almacenamiento Consolidado y Caudal WAN/LAN.
   - Curvas HiDPI vivas de 5 minutos ampliables mediante la Pantalla de Inspección Táctil hacia `recursos_history.db`.
   - Banner prioritario de salud y avisos del sistema con clasificación de peligro (`critical`, `high`, `medium`, `low`) y acceso a soluciones asistidas por IA.
   - Resumen consolidado de cargas de trabajo de software (`apps.containers_running`, `apps.services_active`, `apps.active_transfers`), suprimiendo la lista redundante de dispositivos de red.

3. **`/equipo` — Silicio y Hardware Físico**:
   - Subpestañas delimitadas exclusivamente a silicio: `cpu`, `ram`, `gpu`, `storage`.
   - Se reubican los procesos y su gráfica apilada de 24 horas a `/programas/processes`, con atajos directos "Ver procesos" desde la CPU.

4. **`/programas` — Cargas de Trabajo de Software**:
   - **`processes`**: Gráfico apilado de áreas 24 h (`ProcessHistoryStackedChart`) para CPU, RAM, VRAM y E/S + inspector en vivo con búsqueda instantánea y detalle PID.
   - **`containers`**: Contenedores Docker con estados en vivo, consumo numérico y acciones de control.
   - **`services`**: Unidades Systemd esenciales con control seguro de ciclo de vida (`start`, `restart`, `stop`).
   - **`media`**: Telemetría de descargas qBittorrent y streaming Emby.
   - **`bots`**: Bot de alertas de Telegram con test de conectividad en tiempo real y registro de actividad en vivo.

5. **`/red` — Red y Ciberseguridad**:
   - **`live`**: Interfaces de red físicas con tráfico WAN/LAN segmentado y gráfica de latencia ping persistida.
   - **`devices`**: Inventario unificado de red local (LAN) con tipo de enlace físico (`Cable LAN`, `5 GHz`, `2.4 GHz`), consumo en tiempo real, Wake-on-LAN (`WoL`) y apagado remoto seguro.
   - **`map`**: Mapa Leaflet con geolocalización de conexiones externas, clustering interactivo y filtros.
   - **`traffic`**: Historial 24 h de red, dominios DNS más utilizados (Pi-hole) y análisis asistido por IA.
   - **`speedtest`**: Test multi-flujo Speedtest.net contrastado con el kernel `/proc/net/dev` e historial SQLite.
   - **`shield`**: Seguridad consolidada con Fail2ban, sincronización DuckDNS y bloqueos de Pi-hole.

6. **`/mas` — Sistema, Nube y Puente Nativo**:
   - **`settings`**: Preferencias de tema y selector de idioma en 31 lenguas sincronizadas vía OTA.
   - **`cloud`**: Sincronización en la nube con Firebase Firestore y **Cloud Auth Bridge** para autenticación fiable tanto en dominios locales como en previews iframe.
   - **`health`**: Registro del sistema (`journalctl`) y diagnóstico IA de fallos preventivo.
   - **`updates`**: Gestor de actualizaciones para Ubuntu `.deb` y Web OTA.
   - **`security`**: Bóveda de tokens, HMAC-SHA256 y dispositivos de confianza.
   - **`dex`**: Conexión de pantalla móvil USB DeX (60 FPS) exclusiva para Ubuntu nativo.
   - **`manual`**: Manual interactivo completo con simuladores sobre `<canvas>` y explorador REST.

---

## 2. Verificación Estricta y Pruebas Ejecutadas

| Prueba | Comando | Resultado |
|---|---|---|
| **Integridad del Diccionario** | 33 columnas por fila, 0 duplicados | ✅ `1059 filas`, 0 errores de columnas, 0 duplicados |
| **Tipado TypeScript** | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | ✅ Sin errores ni variables sin uso |
| **Compilación Python** | `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py` | ✅ Sintaxis y tipos conformes |
| **Build Web de Producción** | `npm run build` | ✅ `dist/index.html` y bundles generados en 2.35s |
| **Empaquetado Debian Ubuntu** | `bash packaging/build_deb.sh` | ✅ `recursos-cockpit_14.0.0_amd64.deb` generado y firmado con GPG |
| **Sincronización de Versión** | `./VERSION` | ✅ `14.0.0` unificado sin hardcoding |
