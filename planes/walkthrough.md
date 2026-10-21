# Walkthrough: Compatibilidad de Rutas con Simulador de Google AI Studio y GitHub (v4.9.3)

Este recorrido detalla la implementación de compatibilidad universal de rutas en el proyecto, permitiendo que Google AI Studio opere sin intentar montar rutas del sistema de archivos local (`/home/servidor/...`), resolviendo los recursos según las rutas relativas del repositorio catalogadas en GitHub.

## 🎯 Cambios Realizados

### 1. Documentación de Directrices y Reglas del Proyecto (`GEMINI.md`)
- Se actualizaron las Reglas 1, 3, 4 y 5 para admitir rutas relativas (`./`, `./planes/`, `./VERSION`, `./README.md`) junto a las rutas locales.
- Se incorporó la **Regla 6: Compatibilidad de Rutas con Simulador de Google AI Studio y GitHub**:
  - Priorizar siempre rutas relativas (`./` o `BASE_DIR`) frente a `/home/servidor/...`.
  - Emplear listas de candidatos y comprobaciones de existencia antes de acceder a archivos.

### 2. Backend Dinámico (`server.py`)
- **Detección de dominio público (`detect_public_domain`)**:
  - Añadidas rutas candidatas relativas: `os.path.join(BASE_DIR, "duckdns", "duckdns.sh")`, `duckdns.log`, `domain.conf`, etc.
- **Resolución de DuckDNS**:
  - Creadas funciones `get_duckdns_script_file()`, `get_duckdns_log_file()`, `get_duckdns_ip_cache_file()` que buscan en el directorio del proyecto y hacen fallback sin romper el flujo.
- **Bases de datos y scripts auxiliares**:
  - `emby_candidates` busca en el directorio local del proyecto antes de `/var/lib/emby` o `/home/servidor/servicios/emby`.
  - `st_candidates` para scripts de sincronización (`sync-to-github.sh`).
  - `access_control_candidates` para archivos de autenticación.

### 3. Versionado y Documentación (`VERSION`, `package.json`, `README.md`)
- Conforme a la regla de versionado semántico (`0.0.X` para ajustes de compatibilidad sin cambio de diseño ni nuevas funciones de cara al usuario), se incrementó a **v4.9.3**.
- Sincronizados `VERSION` y `package.json`.
- Actualizado `README.md` con la sección de novedades de `v4.9.3`.

## 🧪 Verificación y Pruebas

- **Comprobación de Versión**:
  - `/api/version` responde `{"version": "4.9.3"}`.
  - `/api/metrics` expone `version: "4.9.3"`.
- **Comprobación de Rutas en Backend**:
  - Las funciones auxiliares resuelven correctamente tanto en el entorno de desarrollo con estructura del repositorio como en el servidor de producción.
- **Estado de Git**:
  - Preparado para commit y push a `origin/main`.
