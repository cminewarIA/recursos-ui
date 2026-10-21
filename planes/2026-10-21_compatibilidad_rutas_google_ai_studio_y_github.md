# Plan de Implementación: Compatibilidad de Rutas con Google AI Studio y GitHub

El usuario ha solicitado que las direcciones y rutas del proyecto no fuercen la estructura física local `/home/servidor/...`, de modo que el simulador de Google AI Studio en la nube o en el móvil no intente montar carpetas inexistentes, añadiendo como opciones las rutas tal como están catalogadas en GitHub (`./`, relativas al repositorio).

## 1. Ajustes en Directivas del Proyecto (`GEMINI.md`)
- Actualizar las reglas obligatorias (1, 3, 4 y 5) para admitir tanto la ruta local del servidor (`/home/servidor/servicios/dashboard`) como la ruta de trabajo en la raíz del repositorio (`./` o según esté catalogado en GitHub y Google AI Studio).
- Añadir la **Regla 6: Compatibilidad de Rutas con Simuladores y GitHub**, instruyendo explícitamente a las IA a utilizar rutas relativas o candidatos múltiples protegidos con `os.path.exists()`, evitando asumir la existencia de `/home/servidor/` en simuladores cloud.

## 2. Ajustes en Backend (`server.py`)
- **Detección de Dominio (`detect_public_domain`)**:
  - Incorporar rutas candidatas relativas a `BASE_DIR` (`./Caddyfile`, `./duck.sh`, `./duckdns/duck.sh`, etc.) antes de las rutas absolutas del servidor físico.
- **Gestor DuckDNS (`DUCKDNS_SCRIPT`, `DUCKDNS_LOG_CANDIDATES`, `DUCKDNS_IP_CACHE`)**:
  - Convertir las rutas en listas dinámicas de candidatos que verifiquen rutas relativas al proyecto (`os.path.join(BASE_DIR, ...)` y `./`) y rutas del servidor local (`/home/servidor/...`), resolviendo el primer archivo existente con funciones seguras (`get_duckdns_script_file()`, `get_duckdns_ip_cache_file()`, `get_duckdns_log_file()`).
- **Servicios Opcionales (Emby y Control de Acceso)**:
  - Añadir candidatos relativos y proteger con fallback silencioso para que nunca intenten acceder a rutas fijas inexistentes en entornos simulados.

## 3. Versión y Reglas del Proyecto
- Incrementar versión a **`4.9.3`** en `VERSION` y `package.json` (criterio `0.0.X`: ajustes y compatibilidad de rutas).
- Actualizar `README.md` documentando la compatibilidad universal de rutas.
- Guardar planes y recorridos en `planes/`.
- Confirmar y publicar con `git push origin main`.
