# 🚀 Walkthrough - v8.3.7: Formalización Contractual de Paridad Visual y Desbloqueo Exclusivo de DeX en Ubuntu (Regla 9.6 en GEMINI.md)

## 📌 Solicitud del Usuario
> *"y las interfaces se tienen que ver igual la unica diferencia es que desde la app de ubuntu se desbloquea el submeno de dex"*

---

## 📜 1. Principio Contractual Incorporado en GEMINI.md (Regla 9, Punto 6)

Se ha ampliado la **Regla 9** de [`GEMINI.md`](file:///home/servidor/servicios/dashboard/GEMINI.md) incorporando formalmente el principio de paridad visual absoluta y la diferenciación exclusiva de DeX:

```markdown
  6. **Paridad Visual de Interfaz y Desbloqueo Exclusivo del Submenú DeX en la App de Ubuntu**:
     - **Paridad Estética y Estructural Absoluta**: Todas las interfaces (web y aplicaciones nativas) deben compartir la misma identidad visual, filosofía de diseño (Apple Liquid Glass + Tesla Touch Cockpit), paleta de colores, tarjetas, gráficos vectoriales e iconografía. La experiencia de usuario debe sentirse visualmente idéntica en disposición y elegancia.
     - **Diferenciación Funcional Contractual (Desbloqueo de DeX)**: La única diferencia visual y funcional permitida entre la interfaz web y la aplicación nativa de Ubuntu radica en que **desde la app de Ubuntu se desbloquea el submenú de DeX / proyección por hardware**. En la versión web (y clientes que no dispongan de privilegios de hardware/kernel), el submenú de DeX permanece estrictamente bloqueado/oculto, mostrando únicamente el mensaje pasivo *"Esperando dispositivo para conectarse en su versión nativa"*. Desde la app nativa de Ubuntu, al contar con acceso directo a `/dev/uhid`, `scrcpy` y el subsistema USB, el submenú interactivo de DeX se desbloquea con todos sus controles de resolución, tasa de refresco (60 FPS), auto-conexión y modo pantalla completa.
```

---

## 🛠️ 2. Cumplimiento de las Reglas del Proyecto en v8.3.7

1. **Sincronización Canónica**:
   - [`VERSION`](file:///home/servidor/servicios/dashboard/VERSION): `8.3.7`.
   - [`package.json`](file:///home/servidor/servicios/dashboard/package.json): `"version": "8.3.7"`.
   - [`packaging/debian/control`](file:///home/servidor/servicios/dashboard/packaging/debian/control): `Version: 8.3.7`.
   - [`README.md`](file:///home/servidor/servicios/dashboard/README.md): Badges, banner ASCII y tabla de versiones actualizados a `v8.3.7`.
2. **Compilación e Instalación Inmediata (Regla 8)**:
   - Paquete Debian canónico generado: `dist/recursos-cockpit_8.3.7_amd64.deb` con sumas SHA256.
   - Instalación local: `sudo apt-get install -y ./dist/recursos-cockpit_8.3.7_amd64.deb`.
   - Verificado con `dpkg -l | grep recursos-cockpit` (`8.3.7`).
   - Verificado con `/usr/bin/recursos-cockpit --test-mode`.
3. **Servicio Backend**:
   - `system-dashboard.service` reiniciado y respondiendo `"version": "8.3.7"` en `/api/version`.

---

## 🧪 3. Pruebas de Verificación Realizadas

| Componente | Verificación / Comando | Resultado Esperado | Resultado Obtenido | Estado |
| :--- | :--- | :--- | :--- | :---: |
| **Punto 9.6 en GEMINI.md** | `grep -n "6. Paridad Visual de Interfaz" GEMINI.md` | Sección 9.6 presente | Encontrada en línea 78 | ✅ Superado |
| **Versión Canónica** | `cat VERSION` | `8.3.7` | `8.3.7` | ✅ Superado |
| **Compilación .deb** | `bash packaging/build_deb.sh` | Paquete v8.3.7 generado | `dist/recursos-cockpit_8.3.7_amd64.deb` listo | ✅ Superado |
| **Instalación Local** | `sudo apt-get install -y ./dist/recursos-cockpit_8.3.7_amd64.deb` | Instalación limpia | Código 0, paquete instalado | ✅ Superado |
| **dpkg Sistema** | `dpkg -l \| grep recursos-cockpit` | Versión 8.3.7 activa | `ii recursos-cockpit 8.3.7 amd64` | ✅ Superado |
| **Ejecutable del Sistema** | `/usr/bin/recursos-cockpit --test-mode` | Operativo desde `/usr/bin` | `[OK] Recursos Native GTK3 App v8.3.7 validated successfully.` | ✅ Superado |
| **Servicio Backend** | `curl -s http://127.0.0.1:8085/api/version` | Versión canónica 8.3.7 | `"version": "8.3.7"` | ✅ Superado |
