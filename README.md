# Recursos - Panel de Control y Métricas del Sistema en Tiempo Real

Servidor de monitoreo en tiempo real y panel de control web para métricas de hardware, contenedores Docker, servicios systemd, descargas activas en qBittorrent, estadísticas de la base de datos de Emby, estado Wi-Fi de router ASUS y controles de seguridad (Pi-hole / Fail2ban).

## Características principales

- **Métricas de Hardware en Vivo**: CPU, memoria RAM, temperaturas de sensores térmicos, discos de almacenamiento (NVMe/SATA) y GPU NVIDIA.
- **Monitoreo de Descargas y Multimedia**:
  - **qBittorrent**: Monitoreo en tiempo real de velocidad de subida/bajada, torrents activos, progreso, tamaño y ratios.
  - **Emby Media Server**: Estadísticas en vivo conectadas a la base de datos SQLite (`library.db` en modo solo lectura) para películas, episodios, series y elementos catalogados.
- **Gestión de Red y Wi-Fi**: Integración con router ASUS RT-AX56U para visualización de clientes 2.4G/5G, tasas de transferencia (Tx/Rx) e intensidades de señal (RSSI).
- **Control de Seguridad**:
  - Estado y métricas de Pi-hole (bloqueos DNS, consultas, dominios en lista negra).
  - Estado de Fail2ban (jails activos, IPs bloqueadas).
  - Autenticación zero-trust con emparejamiento de dispositivos y modo de emergencia con clave maestra.
- **Gestión de Contenedores y Servicios**: Supervisión de contenedores Docker y servicios systemd.
- **Interfaz Moderna**: Panel web interactivo responsive diseñado con soporte para temas claro/oscuro y visualización de widgets adaptable para móviles y escritorios.

## Estructura del Proyecto

```text
recursos/
├── server.py              # Servidor HTTP multihilo en Python con endpoints de telemetría y API
├── static/
│   ├── index.html         # Interfaz web del dashboard (HTML5, CSS y JavaScript)
│   ├── Asus_Router_CA.crt # Certificado raíz CA local para router
│   ├── visipics.rdp       # Perfil RDP local
│   └── visipics_externo.rdp # Perfil RDP remoto
├── update.sh              # Script de despliegue y actualización rápida
├── .gitignore             # Exclusión de archivos sensibles y temporales
└── README.md              # Documentación del proyecto
```

## Ejecución y Servicio

El servicio corre como un daemon de systemd en Linux:

```bash
# Ver estado del servicio
sudo systemctl status system-dashboard.service

# Reiniciar servicio tras cambios
sudo systemctl restart system-dashboard.service

# Ver logs en tiempo real
journalctl -u system-dashboard.service -f
```

## Despliegue y Actualización

Para actualizar el panel a la última versión desde GitHub:

```bash
./update.sh
```

## Sincronización con Google AI Studio

Este repositorio puede vincularse directamente en Google AI Studio:
1. Conectar tu cuenta de GitHub en Google AI Studio.
2. Seleccionar el repositorio `cminewarIA/recursos`.
3. Probar cambios o realizar mejoras con Gemini y aplicar cambios mediante `Push Changes`.
4. En el servidor local, ejecutar `./update.sh` para desplegar las novedades.
