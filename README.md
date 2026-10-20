# 🛡️ Recursos — Consola de Telemetría, Red, Seguridad Zero-Trust y Actualización OTA

![Plataforma](https://img.shields.io/badge/Plataforma-Linux%20Server-0EA5E9?style=for-the-badge&logo=linux&logoColor=white)
![Seguridad](https://img.shields.io/badge/Seguridad-Zero--Trust%20HMAC%20%2B%20Fail2ban-10B981?style=for-the-badge&logo=shield&logoColor=white)
![Arquitectura](https://img.shields.io/badge/Navegaci%C3%B3n-Multi--P%C3%A1gina%20History%20API-6366F1?style=for-the-badge)
![Actualización](https://img.shields.io/badge/GitHub%20OTA-1--Clic%20Auto--Sync-F59E0B?style=for-the-badge&logo=github&logoColor=black)

**Recursos** es una consola web de alta precisión y cero dependencias externas diseñada para la monitorización integral del servidor Linux, gestión de contenedores Docker y servicios `systemd`, auditoría de red (Ethernet Gigabit + Repetidor Wi-Fi 6 ASUS RT-AX56U), protección activa DNS/IPS (**Pi-hole** + **Fail2ban**), control de descargas (**qBittorrent** + **Emby SQLite**), **Seguridad Zero-Trust por emparejamiento criptográfico de dispositivos** y **Gestor de Versiones con actualización OTA en 1 clic desde GitHub**.

---

## ✨ Novedades y Arquitectura Principal

### 1. 🧭 Navegación Web Multi-Página Real (HTML5 History API)
A diferencia de los paneles monolíticos tradicionales, **Recursos** separa cada área operativa en rutas web limpias e independientes con soporte nativo para las flechas **Atrás** y **Adelante** del navegador (tanto en escritorio como con gestos táctiles en móviles) y apertura en pestañas nuevas (`Ctrl+Clic`):

| Ruta Web | Vista / Módulo | Descripción |
| :--- | :--- | :--- |
| `/` | **Vista General** | Bento Grid de telemetría rápida, estado del sistema, dominio público detectado y versión Git. |
| `/procesador` | **Procesador (CPU)** | Uso global, frecuencia en tiempo real, temperatura, *Load Average* y carga por hilo lógico. |
| `/memoria` | **Memoria Física** | Desglose de RAM usada, disponible, caché/búferes y estado de paginación Swap/Zram. |
| `/grafica` | **Tarjeta Gráfica** | Telemetría NVIDIA (`nvidia-smi`), VRAM dedicada, temperatura, ventilador y procesos CUDA. |
| `/almacenamiento` | **Almacenamiento** | Velocidad de lectura/escritura E/S en vivo y ocupación/temperatura por partición NVMe/HDD/NAS. |
| `/red` | **Red & Dispositivos** | Tráfico Ethernet vs Wi-Fi, clientes del repetidor ASUS RT-AX56U (5 GHz / 2.4 GHz) y Wake-on-LAN. |
| `/seguridad` | **Seguridad & DNS** | Estadísticas de bloqueo **Pi-hole FTL**, jaulas **Fail2ban** activas e historial completo ordenable. |
| `/aplicaciones` | **Aplicaciones** | Control de servicios nativos (`systemd`), contenedores **Docker** en vivo y Control Parental. |
| `/descargas` | **Descargas & Emby** | Torrents activos en **qBittorrent** y últimas películas/series indexadas en **Emby** (`library.db`). |
| `/procesos` | **Procesos** | Monitor de procesos del sistema ordenable por porcentaje de CPU, memoria privada, PID o nombre. |
| `/version` | **Versión & GitHub** | Comparador en vivo **Local vs GitHub (`cminewarIA/recursos-ui`)**, autodetección DNS y actualización en 1 clic. |

> **Compatibilidad con Nextcloud**: El enrutador mantiene retrocompatibilidad automática con enlaces por hash (`#processor`, `#security`, etc.) y detecta si se ejecuta embebido dentro de *Nextcloud External Sites*.

---

### 2. 🔐 Seguridad Zero-Trust con Emparejamiento Local Automático
El servidor implementa una capa de seguridad criptográfica diseñada para proteger el acceso externo sin sacrificar la comodidad dentro de casa:

1. **Emparejamiento Transparente en Red Local (LAN)**:
   - Cuando cualquier dispositivo (móvil, tablet o portátil) accede al dashboard conectado al Wi-Fi local (`192.168.50.0/24` / RFC1918), el servidor lo registra automáticamente en `/etc/system-dashboard/trusted_devices.json`.
   - Se emite una cookie segura `HttpOnly; SameSite=Lax; Path=/` (`recursos_device_trust`) firmada con **HMAC-SHA256** utilizando una clave secreta de 256 bits exclusiva del servidor (`/etc/system-dashboard/secret.key`).
2. **Acceso Transparente desde Datos Móviles (4G / 5G / WAN)**:
   - Al salir de casa y conectarse por datos móviles a través del dominio público, el servidor verifica la firma criptográfica HMAC-SHA256 y comprueba que el identificador del dispositivo no haya sido revocado, permitiendo el paso de forma transparente.
3. **Bloqueo Estricto y Clave Maestra de Rescate**:
   - Cualquier visitante externo sin credencial válida recibe una pantalla de bloqueo `403 Forbidden` y todas las rutas `/api/*` quedan blindadas.
   - Si accedes por primera vez desde fuera de casa con un dispositivo nuevo, puedes autorizarlo introduciendo la **Clave Maestra de Rescate** (`/etc/system-dashboard/master.pass`), protegida con limitación de intentos (**5 intentos fallidos = bloqueo de IP durante 15 minutos**).
4. **Panel de Administración y Revocación de Dispositivos**:
   - Desde el botón de estado de seguridad en la cabecera puedes inspeccionar todos los dispositivos vinculados (nombre del dispositivo, IP LAN, última IP WAN, fecha de última conexión) y **revocar el acceso** individualmente o cerrar todas las demás sesiones con un clic.

---

### 3. 🌐 Autodetección Dinámica de Dominio DNS (Sin Dominios Fijos)
Se han eliminado todas las referencias fijas a dominios estáticos en el código. El backend `server.py` descubre y actualiza dinámicamente el dominio público del servidor (`detect_system_dns_domain`) siguiendo una cadena de prioridad inteligente:

1. Variable de entorno `PUBLIC_DOMAIN` (si se define manualmente).
2. Escaneo automático de bloques de dominio en `/etc/caddy/Caddyfile` y `/etc/nginx/sites-enabled/*`.
3. Escaneo de scripts o crons de actualización **DuckDNS** (`~/duckdns/duck.sh`, `/etc/cron*`, `/opt/duckdns/*`).
4. Hostname FQDN del sistema (`/etc/hostname` / `socket.getfqdn()`).
5. Cabecera HTTP `X-Forwarded-Host` o `Host` recibida desde el proxy inverso.

Además, al descargar el archivo de escritorio remoto **`/static/visipics_externo.rdp`**, el servidor inyecta al vuelo el dominio público autodetectado (`full address:s:<dominio_detectado>:3389`).

---

### 4. 🔄 Gestor de Versiones y Actualización OTA desde GitHub en 1 Clic
En la página **`/version`** (y mediante el indicador en vivo de la barra superior y lateral):

- **Comparación Local vs GitHub en Vivo**: Muestra el commit SHA local (`git rev-parse --short HEAD`), mensaje, fecha y estado del árbol de trabajo frente al último commit publicado en GitHub (`https://github.com/cminewarIA/recursos-ui`, rama `main`).
- **Actualización en 1 Clic (`POST /api/system/update`)**:
  - Verifica que el dispositivo esté autorizado mediante Zero-Trust.
  - Ejecuta `git fetch origin main --prune` y `git pull --ff-only origin main` (con respaldo automático si hubiera cambios locales).
  - Muestra la salida detallada de la terminal en pantalla y reinicia automáticamente el servicio `system-dashboard.service` en segundo plano, reconectando la interfaz tras unos segundos.

---

## 🛠️ Estructura del Proyecto

```text
/home/servidor/servicios/dashboard/
├── server.py                  # Servidor HTTP/API en Python 3 (Zero-Trust, Telemetría, DNS, OTA GitHub)
├── static/
│   ├── index.html             # Aplicación Web Multi-Página (Diseño Obsidian Slate & Telemetría en Vivo)
│   └── visipics_externo.rdp   # Plantilla RDP externa (inyectada dinámicamente con el DNS detectado)
├── index.html                 # Espejo sincronizado para previsualización en Google AI Studio
├── update.sh                  # Script CLI de sincronización rápida con GitHub y reinicio systemd
└── README.md                  # Documentación técnica del sistema
```

---

## 🚀 Instalación, Uso y Mantenimiento

### Consultar estado del servicio
```bash
sudo systemctl status system-dashboard.service
```

### Actualizar desde terminal (o desde el botón en `/version`)
```bash
cd /home/servidor/servicios/dashboard
./update.sh
```

### Archivos de Seguridad Zero-Trust en el Servidor
- `/etc/system-dashboard/secret.key`: Clave criptográfica HMAC-SHA256 de 256 bits (generada automáticamente con permisos `0600`).
- `/etc/system-dashboard/master.pass`: Clave maestra de rescate para autorizar dispositivos nuevos desde fuera de la red LAN.
- `/etc/system-dashboard/trusted_devices.json`: Registro persistente de dispositivos autorizados y sus metadatos de conexión.
