# Plan de Implementación - v8.3.5 a v8.3.6: Incorporación de la Regla 9 en GEMINI.md (Arquitectura Contractual de Aplicaciones Nativas Linux & Android)

## 📌 Solicitud del Usuario
> *"te cuento exactamente cual es mi idea con la app nativa para ubuntu y tambien te pedire una para android pero te voy a contar para que guardes en las normas como tienen que funcionar las apps nativas. las apps tienen que conectarse a la red wifi buscando el servidor web en red local enlazandoses y con el sistema que tiene la web de certificado tiene que sertificar la app para que una ves certificada pueda acceder desde el exterior directamente al abrir la app se conecta con el nodo enlazado automaticamente y las interfaces en las apps nativas tiene que ser todo nativo solo rellena los datos que pide la app conectandose con la base de datos de manera cifrada y segura no quero que las apps sean webapps ni basadas en el navegador"*

---

## 🏛️ Directrices de la Regla 9 a Formalizar

Se incorporará la **Regla 9** en [`GEMINI.md`](file:///home/servidor/servicios/dashboard/GEMINI.md) estructurada en 5 pilares normativos obligatorios:

1. **Interfaz 100% Nativa Pura (Cero WebApps / Cero Navegadores Embebidos)**:
   - Prohibición absoluta de WebViews (`WebKit`, `Chromium`, `Gecko`), Electron, Cordova o envoltorios web.
   - En Linux: GTK3 / GTK4 puro con widgets nativos y Cairo. En Android: Kotlin / Jetpack Compose o SDK nativo.
   - Las apps renderizan sus propios controles visuales nativos y únicamente consumen datos cifrados (JSON/binario) del backend.

2. **Autodescubrimiento y Emparejamiento en Red Local (Wi-Fi / LAN)**:
   - Protocolo dinámico en LAN/Wi-Fi (mDNS/Zeroconf/SSDP o sondeo local) para localizar automáticamente el servidor `recursos-ui`.
   - Handshake inicial de emparejamiento entre la app y el nodo.

3. **Certificación y Criptografía de Dispositivo**:
   - Integración con el sistema de certificación web del backend para expedir y verificar certificados/tokens de dispositivo seguros.
   - Almacenamiento seguro del certificado en el cliente nativo (Linux Secret Service / Android KeyStore).

4. **Acceso Dual Transparente y Conexión Automática (LAN / WAN Exterior)**:
   - Al abrir la app, conexión instantánea y automática al nodo enlazado.
   - Conmutación inteligente: baja latencia en LAN (IP local) y conexión cifrada desde el exterior (WAN / `cminewar.duckdns.org` con TLS) mediante el certificado expedido.

5. **Comunicación Segura con la Base de Datos y APIs Backend**:
   - Toda interacción con la base de datos y endpoints se realiza a través de canales autenticados y cifrados, garantizando la privacidad de la telemetría y controles.

---

## 🛠️ Tareas a Ejecutar
1. **Actualizar `GEMINI.md`**: Añadir la sección `## 9. Arquitectura Contractual de Aplicaciones Nativas (Linux & Android)`.
2. **Sincronización Canónica de Versión (`8.3.6`)**:
   - `VERSION`: `8.3.6`.
   - `package.json`: `"version": "8.3.6"`.
   - `packaging/debian/control`: `Version: 8.3.6`.
   - `README.md`: Badges, banner y fila `v8.3.6` en la tabla de versiones.
3. **Compilación e Instalación Local (Regla 8)**:
   - `bash packaging/build_deb.sh`.
   - `sudo apt-get install -y ./dist/recursos-cockpit_8.3.6_amd64.deb`.
   - `dpkg -l | grep recursos-cockpit` y `/usr/bin/recursos-cockpit --test-mode`.
4. **Documentación**:
   - Crear `planes/walkthrough_v8.3.6.md` y actualizar `planes/walkthrough.md`.
5. **Git y GitHub (Regla 2)**:
   - `git add`, `git commit`, `git tag v8.3.6`, `git push origin main --tags`.
