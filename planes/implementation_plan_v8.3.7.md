# Plan de Implementación - v8.3.6 a v8.3.7: Formalización de Paridad Visual de Interfaces y Desbloqueo Exclusivo del Submenú DeX en la App de Ubuntu

## 📌 Solicitud del Usuario
> *"y las interfaces se tienen que ver igual la unica diferencia es que desde la app de ubuntu se desbloquea el submeno de dex"*

---

## 🏛️ Directrices a Incorporar en GEMINI.md (Regla 9, Punto 6)

Se amplía la **Regla 9** de [`GEMINI.md`](file:///home/servidor/servicios/dashboard/GEMINI.md) con el apartado específico de paridad visual y desbloqueo de DeX:

1. **Paridad Visual y Estructural Idéntica**:
   - Todas las interfaces del ecosistema (interfaz web, app nativa de Linux/Ubuntu y app nativa de Android) deben lucir con la misma identidad estética (Apple Liquid Glass + Tesla Touch Cockpit), colores, disposición bento, gráficas y elegancia visual.
2. **Desbloqueo Exclusivo del Submenú de DeX en Ubuntu**:
   - La única divergencia permitida entre la interfaz web y la app de Ubuntu es que **en la app nativa de Ubuntu se desbloquea el submenú de DeX / Modo Escritorio por hardware USB** (`scrcpy` + UHID + pantalla virtual).
   - En la web y clientes no autorizados, cualquier control o mención de DeX se mantiene estrictamente bloqueado/oculto, mostrando únicamente el estado pasivo *"Esperando dispositivo para conectarse en su versión nativa"*.
   - En la app de Ubuntu, al tener acceso nativo al kernel y `/dev/uhid`, el submenú de DeX se desbloquea dinámicamente con sus opciones de proyección, resolución, FPS y conmutación de pantalla.

---

## 🛠️ Tareas de Implementación y Despliegue

1. **Actualizar `GEMINI.md`**: Añadir el punto 6 a la Regla 9.
2. **Sincronización Canónica de Versión (`8.3.7`)**:
   - `VERSION`: `8.3.7`.
   - `package.json`: `"version": "8.3.7"`.
   - `packaging/debian/control`: `Version: 8.3.7`.
   - `README.md`: Badges, banner y fila `v8.3.7` en la tabla de versiones.
3. **Compilación e Instalación Local (Regla 8)**:
   - `bash packaging/build_deb.sh`.
   - `sudo apt-get install -y ./dist/recursos-cockpit_8.3.7_amd64.deb`.
   - Comprobar con `dpkg -l | grep recursos-cockpit` y `/usr/bin/recursos-cockpit --test-mode`.
4. **Documentación**:
   - Crear `planes/walkthrough_v8.3.7.md` y actualizar `planes/walkthrough.md`.
5. **Git y GitHub (Regla 2)**:
   - `git add`, `git commit`, `git tag v8.3.7`, `git push origin main --tags`.
