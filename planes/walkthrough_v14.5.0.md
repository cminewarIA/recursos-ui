# Walkthrough de Verificación — v14.5.0 (Servidor/Web) · v1.2.0 (Ubuntu) · v1.2.0 (Android/TV)

## Resumen de Cambios Implementados

1. **Certificado Único por Dispositivo Físico y Bloqueo Estricto Zero-Trust en Red Local (`server.py`, `src/App.tsx`, `src/utils/api.ts`, `src/components/MoreView.tsx`, `src/themes/index.tsx`)**
   - **Bloqueo estricto sin fugas de datos**: Cualquier cliente sin un certificado emitido previamente en la red local (LAN) recibe `403 Forbidden` en todos los endpoints de datos y temas (`/api/metrics`, `/api/themes`, `/api/themes/pack`, `/api/themes/sync`) y visualiza una pantalla de bloqueo Alethia con el logo oficial `/recursos-cockpit.png` sin exponer versión, dominio, hostname ni métricas. Se eliminó el desbloqueo externo por clave maestra en `POST /api/auth/unlock` y se añadió `GET /api/auth/status` con respuesta mínima para clientes no confiables.
   - **Auto-certificación automática en LAN y unificación multi-cliente**: `resolve_arp_mac_for_ip()` consulta `/sys/class/net`, `/proc/net/arp`, `ip neigh` (con caché acotada) y la tabla del router/Pi-hole para resolver la dirección MAC real. `compute_physical_device_key()` y `consolidate_devices_by_hardware()` unifican múltiples navegadores web (Chrome, Firefox, Edge, Safari, etc.) y aplicaciones nativas (Ubuntu / Android) del mismo equipo físico bajo **un único certificado** (`ZT-XXXX-XXXX-XXXX`), eliminando la fragmentación por sistema operativo o modo escritorio.
   - **Consolidación incremental no destructiva (`merge-never-downgrade`)**: `_merge_telemetry_incremental()` y `_merge_observed_ips()` preservan siempre los datos más ricos recopilados (modelo, fabricante, SO, arquitectura, MAC, hostname, CPU/RAM/almacenamiento, `installation_ids`, `observed_ips`, `first_seen`, `last_seen`, `lan_verified_at` y estado de `root`), sin sobrescribirlos con campos vacíos al cambiar entre navegador y app nativa.
   - **Panel unificado en Sistema → Dispositivos**: Cada tarjeta representa un único equipo físico certificado mostrando insignia de verificación LAN, serie del certificado, MAC, IPs observadas, todos los navegadores y apps asociados y desglose técnico estructurado.

2. **IP Real del Cliente + Nombre del Dispositivo en Consola de Logs (`server.py`, `desktop_app/recursos_app.py`)**
   - `get_client_ip()` valida primero si la conexión directa proviene de un proxy local de confianza (`127.0.0.1` / LAN local) antes de leer `CF-Connecting-IP`, `X-Real-IP`, `X-Recursos-Origin-IP` o el último salto no confiable de `X-Forwarded-For`, evitando suplantación desde el exterior.
   - `resolve_log_client_identity()` resuelve el dispositivo certificado en caché (`_DEVICE_IDENTITY_CACHE`) para formatear cada línea HTTP de `recursos-service.log` como `IP (NombreDispositivo)` cuando el equipo está identificado.

3. **Comparación Estricta y Desacoplada de Versiones Nativas (`server.py`, `desktop_app/recursos_app.py`, `android_app/.../ApiService.kt`)**
   - `get_github_native_releases_info()` (backend), `fetch_github_native_releases()` (Ubuntu) y `checkGithubAndroidRelease()` (Android) filtran estrictamente por tags nativos (`android-v*`, `ubuntu-v*`, `native-*`) y rechazan artefactos heredados del ciclo monolítico del servidor (`14.x`), comparando en Android contra el `versionName` instalado realmente mediante `PackageManager.getPackageInfo`.

4. **Sincronización Híbrida OTA de Temas desde GitHub (`themes_catalog.py`, `src/themes/index.tsx`, `i18n/dictionary.csv`)**
   - `sync_themes_pack_from_github()` ejecuta ahora dos fases: (A) descarga y valida el paquete compilado `themes-pack.rcpack.gz` y (B) descarga `themes/themes.json` y cualquier tema JSON suelto nuevo o con versión superior hacia la caché segura `loose/` (con validación estricta de nombre/ruta y saneamiento completo de esquema).
   - Se actualizó `themes.ota_hint` en los 31 idiomas de `i18n/dictionary.csv` para reflejar fielmente este comportamiento híbrido.

5. **Actualización In-App en Android sin Root mediante `PackageInstaller.Session` (`ApkSessionInstaller.kt`, `MainActivity.kt`)**
   - Se añadió `ApkSessionInstaller.kt` con sesiones oficiales `PackageInstaller.Session`, actualización en sitio (`setAppPackageName`), verificación previa de `canRequestPackageInstalls()` con flujo guiado único (`Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES`) y reanudación automática de la descarga/instalación tras conceder el permiso, más `BroadcastReceiver` privado (`RECEIVER_NOT_EXPORTED`) limpiado en `onDestroy()`.

## Verificación Realizada

- Compilación sintáctica Python: `python3 -m py_compile server.py themes_catalog.py desktop_app/recursos_app.py i18n_catalog.py`
- Pruebas automatizadas en Python: resolución de IP real + nombre de dispositivo y protección anti-spoofing, filtrado de releases nativas `1.x` vs `14.x`, unificación de múltiples navegadores y app nativa bajo un único certificado con fusión incremental no destructiva, mezcla híbrida de temas compilados + JSONs sueltos e integridad de `i18n/dictionary.csv` (33 columnas por fila).
- Comprobación estricta TypeScript: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
- Compilación y linter del applet: `compile_applet` + `lint_applet`
