# 🚀 Walkthrough - v8.3.3: Incorporación de la Regla 8 en GEMINI.md (Instalación Local Obligatoria de la App Nativa)

## 📌 Solicitud del Usuario
> *"cada vez que actualizes la aplicacion debes intalar la app nativa guardalo como norma"*

---

## 📜 1. Nueva Regla 8 Incorporada en GEMINI.md
Se ha añadido formalmente la **Regla 8** al archivo de directrices fundamentales del proyecto ([`GEMINI.md`](file:///home/servidor/servicios/dashboard/GEMINI.md)):

```markdown
## 8. Compilación e Instalación Local Obligatoria de la App Nativa Linux (.deb)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación o actualización en la aplicación (frontend web, backend, configuración, empaquetado o reglas) y se incremente el número de versión canónica en `./VERSION`:
  1. **Compilación Inmediata del Paquete**: Se debe compilar obligatoriamente el paquete Debian canónico ejecutando `bash packaging/build_deb.sh`, generando `dist/recursos-cockpit_${VERSION}_amd64.deb` y el archivo de sumas criptográficas `dist/SHA256SUMS.txt`.
  2. **Instalación Local en el Servidor**: Se debe instalar inmediatamente en el sistema operativo del servidor físico local mediante:
     ```bash
     sudo apt-get install -y ./dist/recursos-cockpit_${VERSION}_amd64.deb
     ```
  3. **Verificación de la Instalación**: Se debe comprobar que `/usr/bin/recursos-cockpit` esté instalado y operativo ejecutando `/usr/bin/recursos-cockpit --test-mode`, asegurando que `dpkg -l | grep recursos-cockpit` refleje exactamente la misma versión canónica activa de `./VERSION`.
- **Objetivo**: Garantizar que el servidor local mantenga instalada y sincronizada de forma permanente la versión más reciente de la aplicación nativa de escritorio GTK3, sin desfases entre la versión web, los endpoints y el ejecutable del sistema.
```

---

## 🛠️ 2. Cumplimiento Inmediato de la Regla en v8.3.3
1. **Compilación**: Ejecución de `bash packaging/build_deb.sh`, generando `dist/recursos-cockpit_8.3.3_amd64.deb`.
2. **Instalación**: Ejecución de `sudo apt-get install -y ./dist/recursos-cockpit_8.3.3_amd64.deb`.
3. **Verificación**:
   - `dpkg -l | grep recursos-cockpit`: `ii recursos-cockpit 8.3.3 amd64`.
   - `recursos-cockpit --test-mode`: `[OK] Recursos Native GTK3 App v8.3.3 validated successfully.`
4. **Sincronización Canónica**:
   - `./VERSION`: `8.3.3`
   - `./package.json`: `8.3.3`
   - `./packaging/debian/control`: `8.3.3`
   - `./README.md`: Badges, banner ASCII y tabla de historial sincronizados con `v8.3.3`.
   - Servicio [`system-dashboard.service`](file:///etc/systemd/system/system-dashboard.service) reiniciado y activo.

---

## 🧪 Pruebas de Verificación Realizadas

| Prueba | Comando / Verificación | Resultado Esperado | Resultado Obtenido | Estado |
| :--- | :--- | :--- | :--- | :---: |
| **Pauta en GEMINI.md** | `grep -n "8. Compilación e Instalación" GEMINI.md` | Sección Regla 8 presente | Encontrada en línea 47 | ✅ Superado |
| **Versión Canónica** | `cat VERSION` | `8.3.3` | `8.3.3` | ✅ Superado |
| **Endpoint /api/version** | `curl -s http://127.0.0.1:8085/api/version` | `8.3.3` | `"version": "8.3.3"` | ✅ Superado |
| **dpkg Paquete Local** | `dpkg -l \| grep recursos-cockpit` | Versión 8.3.3 | `ii recursos-cockpit 8.3.3 amd64` | ✅ Superado |
| **Test-mode App Nativa** | `recursos-cockpit --test-mode` | Validación 8.3.3 exitosa | `[OK] Recursos Native GTK3 App v8.3.3` | ✅ Superado |
