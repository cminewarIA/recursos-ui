# Plan de Corrección - v8.3.4: Corrección de Lanzador Único, Icono Oficial y Layout Completo en la App Nativa

## 1. Problemas Reportados por el Usuario
1. *"Al abrir la app no muestra nada"*: La ventana nativa GTK3 se abría en un estado donde la telemetría y los procesos estaban desactivados condicionalmente (`if not is_native_or_mobile`), ocultando el `StackSwitcher` y mostrando únicamente una pantalla vacía a la espera de un cable USB.
2. *"El icono en el box es el de ajustes"*: El archivo `.desktop` tenía `Categories=System;Monitor;Utility;Telephony;` y no se invocaba `GLib.set_prgname("recursos-cockpit")`, provocando que el window manager lo catalogara como `python3` y asignara el icono de fallback de ajustes (`preferences-system`).
3. *"Instala dos lanzadores más en el box de aplicaciones"*:
   - El archivo `.desktop` incluía una `[Desktop Action LaunchDeX]` ("Iniciar Modo DeX Directamente") que se registraba como un segundo lanzador en el menú.
   - Las múltiples categorías (`Utility`, `Telephony`) causaban duplicación de entradas en el menú.
   - Existía un archivo residual antiguo de Chrome PWA (`~/.local/share/applications/cminewar-recursos.desktop`) con acción `UninstallApp`.

---

## 2. Soluciones a Aplicar

### A. Archivo de Escritorio Único y Limpio (`desktop_app/recursos-cockpit.desktop`)
- Unificar categorías a `Categories=System;Monitor;` (estándar FreeDesktop validado sin duplicaciones).
- Retirar `Actions=LaunchDeX;` y la sección secundaria para garantizar un **único lanzador en el box de aplicaciones**.
- Asignar `Exec=/usr/bin/recursos-cockpit` y `Icon=recursos-cockpit`.
- Purgar el lanzador residual `cminewar-recursos.desktop` de `~/.local/share/applications/`.

### B. Restauración de Interfaz Completa en la App Nativa (`desktop_app/recursos_app.py`)
- **Tres Pestañas Nativas**:
  1. `📊 Telemetría`: CPU, Frecuencias, Temperaturas, Memoria RAM/Swap, Discos, Tráfico de Red en tiempo real y gráficas Cairo a 60 FPS.
  2. `⚙️ Procesos`: Monitor interactivo de procesos del kernel con ordenamiento por PID, CPU% y RAM.
  3. `📱 Conexión USB`: Interfaz de espera e interacción con dispositivos móviles (Scrcpy / UHID).
- **Conmutador de Pestañas Siempre Visible**: `Gtk.StackSwitcher` integrado en el `HeaderBar`.
- **Pestaña Inicial Predeterminada**: Abrir por defecto en `📊 Telemetría` (o en `📱 Conexión USB` si se pasa el flag `--dex`).
- **Asociación de Icono y Proceso**:
  - `GLib.set_prgname("recursos-cockpit")` y `GLib.set_application_name("Recursos Cockpit")`.
  - `self.set_wmclass("recursos-cockpit", "recursos-cockpit")`.

### C. Empaquetado y Post-Instalación (`packaging/`)
- Limpieza automática de `cminewar-recursos.desktop` en `postinst`.
- Actualización de bases de datos de escritorio e iconos.

### D. Control de Versiones e Instalación (Reglas 5 y 8)
- Actualizar versión a `8.3.4` en `VERSION`, `package.json`, `packaging/debian/control`, `README.md` y planes.
- Compilar deb e instalar en el servidor físico: `bash packaging/build_deb.sh && sudo apt-get install -y ./dist/recursos-cockpit_8.3.4_amd64.deb`.
- Validar con `--test-mode` y subir a GitHub con tag `v8.3.4`.
