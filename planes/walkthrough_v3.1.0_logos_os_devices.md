# Walkthrough & Plan de Implementación — v3.1.0 (Logos Dinámicos de SO, Interfaces y Dispositivos + Subida Local)

## 1. Objetivo
Sustituir el icono genérico a la izquierda de `Nodo: <hostname>` por el logo real del sistema operativo en el que se ejecuta el servicio (detectado dinámicamente desde `/etc/os-release` y resuelto vía Google Favicon S2 / SimpleIcons CDN), hacer lo mismo automáticamente en **Red & Interfaces (`/red`)** tanto para las interfaces de red activas (NICs) como para los dispositivos conectados en la red local, y permitir personalizar cualquier logo buscando en Google/Web o subiendo un archivo de imagen local desde el dispositivo.

## 2. Arquitectura Implementada

### 2.1. Detección Automática del Sistema Operativo (`host_os`)
- `server.py` (`get_system_info()`) y `vite.config.ts` leen `/etc/os-release` (`ID`, `ID_LIKE`, `PRETTY_NAME`) e identifican la distribución exacta (Ubuntu, Debian, Arch Linux, Fedora, Alpine, Kali, Linux Mint, Manjaro, openSUSE, Red Hat, CentOS, Rocky, AlmaLinux, Proxmox VE, Raspberry Pi OS o Linux Kernel).
- El emblema situado a la izquierda de `Nodo: <hostname>` (`#hostOsEmblemBtn`) muestra automáticamente el logo oficial del sistema operativo con fallback automático al servicio de iconos de Google (`https://www.google.com/s2/favicons?sz=128&domain=...`).

### 2.2. Detección Automática de Logos en Red & Interfaces (`/red`)
- **Interfaces de Red Activas (NICs)**: Cada tarjeta de interfaz (`eth0`, `enx...`, `wlan0`, `tailscale0`, `wg0`) resuelve automáticamente el logo de su adaptador/tecnología (Intel, Realtek, ASUS, Tailscale, WireGuard o el SO anfitrión).
- **Dispositivos Conectados en Red (`wifi_clients`)**: `classify_device()` en `server.py` y `resolveNetworkDeviceLogo()` en el frontend identifican automáticamente la marca/fabricante del dispositivo (Nintendo, Xbox, PlayStation, Sony, Samsung, Xiaomi, Google, ASUS, Vodafone, Synology, TP-Link Tapo, Espressif IoT, Tuya, Apple, Acer, Intel, Realtek, HP, Dell, Lenovo, LG, Amazon, Microsoft Windows, etc.) o deducen el dominio para consultar Google Favicon S2 (`https://www.google.com/s2/favicons?sz=128&domain=...`).

### 2.3. Personalización Interactiva: Búsqueda en Google/Web y Subida de Archivo Local (`#logoPickerModal`)
- Al hacer clic sobre el logo del nodo (`Nodo: ...`), sobre cualquier interfaz de red o sobre cualquier dispositivo (o mediante el botón `🖼️ Logo`), se abre el modal **Personalizar Logo del Sistema / Dispositivo**:
  1. **Subir archivo local (`<input type="file">`)**: Permite seleccionar o arrastrar (Drag & Drop) cualquier imagen local (`PNG`, `SVG`, `JPG`, `WEBP`, `ICO`, `GIF`). Las imágenes rasterizadas grandes se optimizan automáticamente en cliente mediante HTML5 Canvas (`160x160` PNG transparente) y se guardan de forma persistente en el servidor (`custom_logos.json` vía `POST /api/custom-logos`) y en `localStorage`.
  2. **Buscador en vivo en Google / Web (`/api/logos/search`)**: Permite escribir cualquier sistema operativo, marca o dominio para buscar logos en vivo combinando Google Favicon S2 (`sz=128`), Clearbit Autocomplete API y SimpleIcons CDN.
  3. **Restaurar autodetección**: Permite eliminar el logo personalizado en 1 clic y volver al logo autodetectado del sistema o dispositivo.

### 2.4. Cabeceras de Seguridad (`Content-Security-Policy`)
- Se actualizó `send_security_headers()` en `server.py` añadiendo `img-src 'self' data: blob: https: http:;` y ampliando `connect-src` para permitir la carga limpia de logos externos y archivos locales `data:image/...`.
