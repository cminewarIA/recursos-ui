# 🛡️ Recursos — Consola de Telemetría, Red, Seguridad Zero-Trust y Actualización OTA

![Plataforma](https://img.shields.io/badge/Plataforma-Linux%20Server-0EA5E9?style=for-the-badge&logo=linux&logoColor=white)
![Nextcloud](https://img.shields.io/badge/Nextcloud%20Hub-Integraci%C3%B3n%20Nativa%20UI-0082c9?style=for-the-badge&logo=nextcloud&logoColor=white)
![Seguridad](https://img.shields.io/badge/Seguridad-Zero--Trust%20Dual--Token-10B981?style=for-the-badge&logo=shield&logoColor=white)
![Arquitectura](https://img.shields.io/badge/Navegaci%C3%B3n-Multi--P%C3%A1gina%20History%20API-6366F1?style=for-the-badge)
![Actualización](https://img.shields.io/badge/GitHub%20OTA-1--Clic%20Auto--Sync-F59E0B?style=for-the-badge&logo=github&logoColor=black)

**Recursos** es una consola web de alto rendimiento y cero dependencias externas, diseñada para la monitorización integral de servidores Linux, control de contenedores **Docker** y servicios `systemd`, auditoría de red (Ethernet Gigabit + Repetidor Wi-Fi 6 ASUS RT-AX56U), protección activa DNS/IPS (**Pi-hole** + **Fail2ban**), gestión de descargas (**qBittorrent** + **Emby** SQLite), **Seguridad Zero-Trust con autenticación de doble vía (Dual-Token)** e **integración visual nativa con Nextcloud Hub 9/10**.

---

## ✨ Novedades y Arquitectura Principal

### 1. ☁️ Integración Visual Nativa con Nextcloud Hub 9/10
La interfaz gráfica de **Recursos** ha sido diseñada para mimetizarse fluidamente tanto en modo independiente como incrustada como aplicación web (*External Sites*) dentro de **Nextcloud Hub**:
- **Paleta de Color Oficial Nextcloud**:
  - Fondo primario oscuro: `#181818`.
  - Superficies de paneles y tarjetas Bento: `#222222`.
  - Bordes y líneas divisorias sutiles: `#2d2d2d`.
  - Color de acento e interactividad: Azul Nextcloud (`#0082c9` / `#0091f2`).
  - Tipografía del sistema de Nextcloud: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **Detección Dinámica de Entorno Embebido (`isEmbeddedInNextcloud`)**:
  - El dashboard detecta automáticamente si se está ejecutando dentro de un `<iframe>` de Nextcloud (por ejemplo, en `https://cminewar.duckdns.org/apps/external/3/` o `/apps/external/1/`).
  - Optimiza márgenes, barras de navegación y alturas de scroll para evitar barras de desplazamiento dobles y ofrecer la experiencia de una app integrada oficial de Nextcloud.

---

### 2. 🧭 Navegación Web Multi-Página Real (HTML5 History API)
A diferencia de los paneles monolíticos tradicionales de página única por anclas, **Recursos** separa cada área operativa en rutas web limpias e independientes. Soporta nativamente las flechas **Atrás** y **Adelante** del navegador (en escritorio y mediante gestos de deslizamiento en dispositivos móviles) y apertura en pestañas (`Ctrl+Clic`):

| Ruta Web | Vista / Módulo | Descripción |
| :--- | :--- | :--- |
| `/` | **Vista General** | Bento Grid de telemetría rápida, estado del sistema, dominio público detectado y versión Git. |
| `/procesador` | **Procesador (CPU)** | Uso global, frecuencia en tiempo real, temperatura, *Load Average* y carga por hilo lógico. |
| `/memoria` | **Memoria Física** | Desglose de RAM usada, disponible, caché/búferes y estado de paginación Swap/Zram. |
| `/grafica` | **Tarjeta Gráfica** | Telemetría NVIDIA (`nvidia-smi`), VRAM dedicada, temperatura, ventilador y procesos CUDA. |
| `/almacenamiento` | **Almacenamiento** | Velocidad de lectura/escritura E/S en vivo y ocupación/temperatura por partición NVMe/HDD/NAS. |
| `/red` | **Red & Wi-Fi** | Tráfico Ethernet vs Wi-Fi, clientes del repetidor ASUS RT-AX56U (5 GHz / 2.4 GHz) y Wake-on-LAN. |
| `/seguridad` | **Seguridad & DNS** | Estadísticas de bloqueo **Pi-hole FTL**, jaulas **Fail2ban** activas e historial completo ordenable. |
| `/aplicaciones` | **Aplicaciones** | Control de servicios nativos (`systemd`), contenedores **Docker** en vivo y Control Parental. |
| `/descargas` | **Descargas & Emby** | Torrents activos en **qBittorrent** y últimas películas/series indexadas en **Emby** (`library.db`). |
| `/procesos` | **Procesos** | Monitor de procesos del sistema ordenable por CPU, memoria privada, PID o nombre de binario. |
| `/dispositivos` | **Dispositivos Confiables**| Panel de auditoría Zero-Trust con lista de dispositivos autorizados y revocación en 1 clic. |
| `/version` | **Versión & GitHub** | Comparador en vivo **Local vs GitHub (`cminewarIA/recursos-ui`)**, estado OTA y actualización en 1 clic. |

> **Retrocompatibilidad**: Mantiene compatibilidad automática con enlaces antiguos por hash (`#processor`, `#security`, `#downloads`, etc.).

---

### 3. 🔐 Seguridad Zero-Trust con Autenticación Dual-Token
El sistema implementa una arquitectura de confianza cero que protege el acceso exterior sin requerir credenciales manuales repetitivas en el entorno doméstico:

1. **Emparejamiento Transparente en Red Local (LAN)**:
   - Al acceder desde el Wi-Fi local (`192.168.50.0/24` o cualquier rango privado RFC1918), el servidor autoriza el dispositivo y genera un token criptográfico firmado con **HMAC-SHA256** utilizando una clave secreta de 256 bits (`/etc/system-dashboard/secret.key`).
2. **Arquitectura Dual-Token para Compatibilidad Total con Iframes**:
   - Para resolver el bloqueo de cookies de terceros en iframes (Safari ITP, Google Chrome CHIPS, Firefox ETP) dentro de Nextcloud, el sistema implementa una vía de autenticación dual:
     - **Vía 1: Encabezado HTTP `X-Device-Token` / `Authorization: Bearer`**: Almacenado de forma segura en `localStorage` (`recursos_device_token`) e inyectado automáticamente en cada llamada `fetch()` a la API.
     - **Vía 2: Cookie HttpOnly con atributo Partitioned**: Emitida como `SameSite=None; Partitioned; Secure; HttpOnly; Path=/` para sesiones HTTPS y `SameSite=Lax` para conexiones locales.
   - El backend `server.py` evalúa con prioridad el token en la cabecera HTTP y, en su defecto, la cookie de sesión, permitiendo que Nextcloud cargue los datos sin interrupciones ni pantallas de bloqueo.
3. **Acceso desde Redes Móviles (4G / 5G / WAN)**:
   - Los dispositivos previamente emparejados en LAN navegan de forma transparente desde el exterior.
4. **Pantalla de Bloqueo y Clave Maestra de Rescate**:
   - Dispositivos desconocidos externos reciben una pantalla `403 Forbidden` con opción a introducir la **Clave Maestra de Rescate** (`/etc/system-dashboard/master.pass`).
   - Protección activa contra fuerza bruta: **5 intentos fallidos bloquean la IP durante 15 minutos**.
5. **Revocación Inmediata de Dispositivos**:
   - En `/dispositivos`, los administradores pueden inspeccionar las sesiones activas (nombre del dispositivo, IP LAN original, última IP WAN de conexión y fecha) y revocar el acceso de cualquier terminal con un clic.

---

### 4. 🌐 Autodetección Dinámica de Dominio DNS
El sistema no utiliza dominios fijos en el código. El motor `detect_system_dns_domain` de `server.py` averigua dinámicamente el dominio público siguiendo esta jerarquía:
1. Variable de entorno `PUBLIC_DOMAIN`.
2. Bloques de configuración de servidor en `/etc/caddy/Caddyfile` y `/etc/nginx/sites-enabled/*`.
3. Scripts y tareas programadas de **DuckDNS** (`~/duckdns/duck.sh`, `/etc/cron*`, `/opt/duckdns/*`).
4. Hostname FQDN (`socket.getfqdn()`).
5. Cabecera `X-Forwarded-Host` o `Host` provista por el proxy inverso Caddy.

Al descargar el archivo de escritorio remoto **`/static/visipics_externo.rdp`**, se autoinyecta en tiempo real el dominio público activo (`full address:s:<dominio_detectado>:3389`).

---

### 5. 🔄 Actualización OTA en 1 Clic desde GitHub
Desde la vista **`/version`** o mediante el botón de actualización en la cabecera:
- Inspección del commit SHA local frente al último publicado en la rama `main` del repositorio oficial (`https://github.com/cminewarIA/recursos-ui`).
- Actualización atómica con verificación de permisos Zero-Trust (`POST /api/system/update`), ejecución de `git fetch` y `git pull`, y reinicio automático de `system-dashboard.service`.

---

## 🛠️ Estructura del Proyecto

```text
/home/servidor/servicios/dashboard/
├── server.py                  # Servidor HTTP/API Python 3 (Zero-Trust Dual-Token, Telemetría, OTA)
├── static/
│   ├── index.html             # Interfaz Web Multi-Página (Diseño Nativo Nextcloud Hub 9/10)
│   └── visipics_externo.rdp   # Plantilla RDP externa (inyectada al vuelo con dominio dinámico)
├── index.html                 # Espejo sincronizado para previsualización en Google AI Studio
├── update.sh                  # Script CLI de sincronización rápida con GitHub y reinicio systemd
├── planes/                    # Historial y planes de trabajo sincronizados
│   ├── README.md              # Documentación de la carpeta de planes
│   ├── implementation_plan.md # Plan de implementación activo
│   ├── walkthrough.md         # Registro de cambios y pruebas verificadas
│   └── *.md                   # Bitácoras de versiones y arquitecturas previas
├── GEMINI.md                  # Reglas de desarrollo y sincronización con GitHub y Google AI Studio
└── README.md                  # Documentación técnica completa del sistema
```

---

## 📋 Reglas Operativas de Sincronización y Desarrollo

Para garantizar la coherencia absoluta entre el servidor local, el repositorio de GitHub y el entorno móvil de Google AI Studio, el proyecto sigue cuatro reglas obligatorias estipuladas en `GEMINI.md`:

1. **Sincronización Previa (`git pull`)**: Siempre se ejecuta `git pull origin main` antes de realizar cualquier cambio en el código o responder solicitudes de edición.
2. **Publicación Automática (`git push`)**: Cualquier cambio en el backend, la web o los archivos de configuración se confirma con un commit descriptivo y se envía de inmediato a `origin main`.
3. **Almacenamiento de Planes (`planes/`)**: Todos los planes de implementación, bitácoras y registros de pruebas se almacenan permanentemente en la carpeta `planes/`.
4. **Mantenimiento Continuo del README (`README.md`)**: El archivo `README.md` se actualiza obligatoriamente en cada intervención para reflejar con exactitud las características y cambios implementados.

---

## 🚀 Instalación, Uso y Mantenimiento

### Comprobar estado del servicio
```bash
sudo systemctl status system-dashboard.service
```

### Reiniciar el servicio manualmente
```bash
sudo systemctl restart system-dashboard.service
```

### Actualización manual desde terminal
```bash
cd /home/servidor/servicios/dashboard
./update.sh
```

### Archivos de Configuración y Seguridad Zero-Trust
- `/etc/system-dashboard/secret.key`: Clave HMAC-SHA256 de 256 bits (permisos `0600`).
- `/etc/system-dashboard/master.pass`: Clave maestra de rescate para autorizar nuevos dispositivos remotos.
- `/etc/system-dashboard/trusted_devices.json`: Registro persistente de dispositivos autorizados y metadatos de acceso.
