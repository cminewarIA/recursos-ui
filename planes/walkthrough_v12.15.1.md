# Walkthrough v12.15.1 — Verificación de Depuración Integral

## 1. Correcciones Aplicadas y Verificadas
1. **Validación 100 % de Claves y Placeholders en `./i18n/dictionary.csv`**:
   - 805 claves verificadas, 0 filas malformadas, 0 claves huérfanas en `src/` y 0 placeholders `{...}` sin interpolar.
   - Eliminada la duplicación de prefijos (`↓`, `↑`, `∑`) en los filtros del mapa, insignias de dirección y franja de velocidad por conexión.
2. **Captura de Eventos en Popups de Leaflet (`capture: true`)**:
   - Garantizada la respuesta inmediata al pulsar cualquier conexión dentro de un grupo (`Ver detalle`), el botón `◀ Ver todas las conexiones (N)` y los botones `Bloquear` / `Desbloquear` dentro de `.leaflet-popup`.
3. **Zero-Hardcoding en Geolocalización del Nodo Servidor (`server.py` y `vite.config.ts`)**:
   - `SERVER_SELF_GEO` utiliza las coordenadas y ubicación reales devueltas por `ip-api.com/json` sin nombres geográficos fijos.
4. **Paridad de Endpoints REST y 4 Curvas WAN/LAN en Desarrollo y Producción**:
   - `/api/auth/restore-session`, `/api/auth/unlock`, `/api/metrics`, `/api/metrics/history`, `/api/fail2ban/ban`, `/api/fail2ban/unban` y `/api/system/update` responden con JSON estructurado y sincronizan en tiempo real las 4 curvas de red (`WAN/LAN`) y el estado de bloqueo de IPs.

## 2. Compilación y Empaquetado Canónico (`12.15.1`)
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`: **OK**.
- `npm run build` y `npm run lint`: **OK (0 errores)**.
- Paquete Debian `./dist/recursos-cockpit_12.15.1_amd64.deb` compilado, firmado, instalado y validado con `/usr/bin/recursos-cockpit --test-mode` (`v12.15.1`).
