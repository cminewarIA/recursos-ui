# 🚀 Walkthrough - v8.3.6: Incorporación de la Regla 9 en GEMINI.md (Arquitectura Contractual de Aplicaciones Nativas Linux & Android)

## 📌 Solicitud del Usuario
> *"te cuento exactamente cual es mi idea con la app nativa para ubuntu y tambien te pedire una para android pero te voy a contar para que guardes en las normas como tienen que funcionar las apps nativas. las apps tienen que conectarse a la red wifi buscando el servidor web en red local enlazandoses y con el sistema que tiene la web de certificado tiene que sertificar la app para que una ves certificada pueda acceder desde el exterior directamente al abrir la app se conecta con el nodo enlazado automaticamente y las interfaces en las apps nativas tiene que ser todo nativo solo rellena los datos que pide la app conectandose con la base de datos de manera cifrada y segura no quero que las apps sean webapps ni basadas en el navegador"*

---

## 📜 1. Nueva Regla 9 Incorporada Formalmente en GEMINI.md

Se ha añadido la **Regla 9** a las directrices fundamentales del proyecto ([`GEMINI.md`](file:///home/servidor/servicios/dashboard/GEMINI.md)):

```markdown
## 9. Arquitectura Contractual de Aplicaciones Nativas (Linux & Android)
- **Regla obligatoria**: El diseño, desarrollo y evolución de cualquier aplicación cliente nativa del ecosistema (tanto para Linux/Ubuntu/Debian como para Android) debe ajustarse de forma estricta y permanente a los siguientes principios fundamentales:
  1. **Interfaces 100% Nativas Puras (Cero WebApps / Cero Navegadores)**:
     - Queda estrictamente prohibido utilizar WebViews embebidas (`WebKit`, `Chromium`, `Gecko`), frameworks híbridos basados en navegadores (`Electron`, `Tauri` web-view, `Cordova`, `Capacitor`) o convertir las aplicaciones nativas en clientes web camuflados.
     - En Linux, la interfaz debe construirse exclusivamente con widgets y componentes nativos de GTK 3 / GTK 4 y renderizado gráfico vectorial por aceleración de hardware con Cairo.
     - En Android, la interfaz debe desarrollarse en arquitectura nativa pura (Kotlin con Jetpack Compose o SDK nativo de Android).
     - Las pantallas, tarjetas, listas, tablas y gráficos son componentes nativos del sistema que únicamente solicitan datos estructurados (JSON/binario) al backend y los presentan en sus propios campos visuales.
  2. **Autodescubrimiento y Enlace en Red Local (Wi-Fi / LAN)**:
     - Al conectarse a la red Wi-Fi o red de área local, las aplicaciones nativas deben implementar autodescubrimiento dinámico (mDNS/Zeroconf `_recursos._tcp`, SSDP o escaneo de subred local) para localizar de manera automática el servidor web del dashboard sin que el usuario tenga que introducir IPs manuales.
     - Una vez descubierto el servidor, la aplicación inicia un protocolo de enlace (pairing handshake) para vincular el dispositivo con el nodo.
  3. **Certificación y Criptografía de Dispositivo**:
     - Las aplicaciones nativas deben certificarse utilizando el sistema de certificados/tokens criptográficos seguros del servidor web.
     - Durante el enlace, el servidor emite una certificación/token criptográfico firmado que la app almacena de forma segura en el gestor de credenciales del sistema (Secret Service / Keyring en Linux, Android KeyStore / EncryptedSharedPreferences en Android).
     - Toda la comunicación con el servidor viaja 100% cifrada bajo TLS/HTTPS con verificación mutua de identidad.
  4. **Acceso Dual Transparente y Conexión Automática (LAN / Exterior WAN)**:
     - **Conexión Inmediata al Abrir**: Al abrir la aplicación nativa, esta debe conectarse de forma automática e instantánea al nodo servidor enlazado, sin solicitar credenciales repetitivas al usuario.
     - **Conmutación Inteligente LAN ↔ WAN**:
       - *En Red Local (Wi-Fi/LAN)*: La app se comunica directamente con la IP y puerto local del nodo a latencia mínima.
       - *Desde el Exterior (Red Móvil / Internet / WAN)*: Al detectar que no se encuentra en la red local, la app conmuta automáticamente su enlace hacia el nodo público / DDNS (`cminewar.duckdns.org` o dominio configurado) empleando la certificación criptográfica otorgada en el emparejamiento.
  5. **Consumo Seguro de la Base de Datos y APIs Backend**:
     - Las apps nativas interactúan con el backend mediante endpoints REST y sockets seguros autenticados, transmitiendo exclusivamente la telemetría, métricas y controles solicitados de manera cifrada, garantizando cero exposición de secretos o credenciales en texto plano.
- **Objetivo**: Asegurar un ecosistema de aplicaciones nativas de máximo rendimiento, ultra fluidas a 60 FPS, con conectividad ubicua y seguridad de nivel empresarial, sin depender de navegadores web embebidos.
```

---

## 🛠️ 2. Cumplimiento de las Reglas del Proyecto en v8.3.6

1. **Sincronización Canónica**:
   - [`VERSION`](file:///home/servidor/servicios/dashboard/VERSION): `8.3.6`.
   - [`package.json`](file:///home/servidor/servicios/dashboard/package.json): `"version": "8.3.6"`.
   - [`packaging/debian/control`](file:///home/servidor/servicios/dashboard/packaging/debian/control): `Version: 8.3.6`.
   - [`README.md`](file:///home/servidor/servicios/dashboard/README.md): Badges, banner ASCII y tabla de versiones actualizados a `v8.3.6`.
2. **Compilación e Instalación Inmediata (Regla 8)**:
   - Paquete compilado: `dist/recursos-cockpit_8.3.6_amd64.deb` con sumas SHA256.
   - Instalación local: `sudo apt-get install -y ./dist/recursos-cockpit_8.3.6_amd64.deb`.
   - Verificado con `dpkg -l | grep recursos-cockpit` (`8.3.6`).
   - Verificado con `/usr/bin/recursos-cockpit --test-mode`.
3. **Servicio Backend**:
   - `system-dashboard.service` reiniciado y respondiendo `"version": "8.3.6"` en `/api/version`.

---

## 🧪 3. Pruebas de Verificación Realizadas

| Componente | Verificación / Comando | Resultado Esperado | Resultado Obtenido | Estado |
| :--- | :--- | :--- | :--- | :---: |
| **Regla 9 en GEMINI.md** | `grep -n "9. Arquitectura Contractual" GEMINI.md` | Sección Regla 9 presente | Línea 57 de `GEMINI.md` | ✅ Superado |
| **Versión Canónica** | `cat VERSION` | `8.3.6` | `8.3.6` | ✅ Superado |
| **Compilación .deb** | `bash packaging/build_deb.sh` | Paquete v8.3.6 generado | `dist/recursos-cockpit_8.3.6_amd64.deb` listo | ✅ Superado |
| **Instalación Local** | `sudo apt-get install -y ./dist/recursos-cockpit_8.3.6_amd64.deb` | Instalación limpia | Código 0, paquete instalado | ✅ Superado |
| **dpkg Sistema** | `dpkg -l \| grep recursos-cockpit` | Versión 8.3.6 activa | `ii recursos-cockpit 8.3.6 amd64` | ✅ Superado |
| **Ejecutable del Sistema** | `/usr/bin/recursos-cockpit --test-mode` | Operativo desde `/usr/bin` | `[OK] Recursos Native GTK3 App v8.3.6 validated successfully.` | ✅ Superado |
| **Servicio Backend** | `curl -s http://127.0.0.1:8085/api/version` | Versión canónica 8.3.6 | `"version": "8.3.6"` | ✅ Superado |
