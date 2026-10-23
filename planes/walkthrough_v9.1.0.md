# Walkthrough v9.1.0: Botones de Descarga Directa (.apk & .deb) Exclusivos para la Versión Web en la Pestaña OTA

## Resumen Ejecutivo de la Versión 9.1.0 (MINOR)
En respuesta a la solicitud del usuario (*"en la pestaña de ota en la web solo en la web pon unos botones de descarga de la apk y del deb"*), y siguiendo la **Regla 3.4** del proyecto (*0.X.0 - Actualización Intermedia / Añadir, Quitar o Rediseñar una Función o Aspecto Concreto*), se ha publicado la versión **`v9.1.0`**.

---

## 1. Botones de Descarga Directa en la Pestaña OTA
En la pestaña de **Gestor de Versiones OTA** (`/version` / `#viewVersion`):
1. **Fila de Acciones en la Cabecera (`#otaWebDownloadButtons`)**:
   - Botón directo **`Descargar .deb (Linux)`**: Enlace directo a `/download/recursos-cockpit_9.1.0_amd64.deb` con icono vectorial y estilo de borde sutil.
   - Botón directo **`Descargar .apk (Android)`**: Enlace directo a `/download/recursos-cockpit_9.1.0.apk` con icono de smartphone Android y estilo de alto contraste.
2. **Panel Bento Exclusivo (`#otaWebDownloadsCard`)**:
   - Tarjeta visual con título *"📦 Paquetes Oficiales Compilados"*, badge de versión activa (`v9.1.0`) y etiqueta *"Solo en la Web"*.
   - Botones primarios destacados de descarga directa para ambos sistemas operativos.
3. **Hidratación Dinámica de Nombres de Archivo**:
   - La función `renderVersionInfoToUI(data)` actualiza al vuelo los atributos `download` y `href` en función de la versión real devuelta por `/api/version`.

---

## 2. Aislamiento Estricto "Solo en la Web"
Para asegurar que los botones y tarjetas de descarga aparezcan **exclusivamente en la plataforma web** y no en clientes nativos:
* **Detección Dinámica (`EnvironmentDetector`)**:
  - En `EnvironmentDetector.applyEnvironmentLayout()`, si `info.isNative` es verdadero (por ejemplo, ejecuciones nativas de GTK3 con PyGObject o contenedores que declaran `data-runtime-env="native"`), los elementos `#otaWebDownloadButtons` y `#otaWebDownloadsCard` se ocultan (`display: none`).
* **Regla CSS de Aislamiento Incondicional**:
  ```css
  [data-runtime-env="native"] #otaWebDownloadButtons,
  [data-runtime-env="native"] #otaWebDownloadsCard,
  .is-native-env #otaWebDownloadButtons,
  .is-native-env #otaWebDownloadsCard {
    display: none !important;
  }
  ```

---

## 3. Endpoints de Descarga en Backend y Servidor de Desarrollo
* **Backend (`server.py`)**:
  - Se añadió la ruta canónica `/download/recursos-cockpit.apk` (así como alias `/download/app.apk` y `/api/download/app_apk`).
  - Si el APK compilado se encuentra localmente en `dist/`, se transmite con la cabecera `Content-Type: application/vnd.android.package-archive`.
  - Si no está presente de forma local, realiza una redirección 302 hacia el release correspondiente en GitHub (`https://github.com/cminewarIA/recursos-ui/releases/download/v9.1.0/recursos-cockpit_9.1.0.apk`).
  - Misma resiliencia aplicada al paquete `.deb`.
* **Servidor Dev (`vite.config.ts`)**:
  - Manejador de previsualización para `/download/recursos-cockpit*.deb` y `/download/recursos-cockpit*.apk` para pruebas en tiempo de desarrollo.

---

## 4. Sincronización Canónica de Versiones
- `VERSION`: `9.1.0`
- `package.json`: `"version": "9.1.0"`
- `packaging/debian/control`: `Version: 9.1.0`
- `android_app/app/build.gradle.kts`: `versionName = "9.1.0"`, `versionCode = 90100`
- `README.md`: Badges, banner ASCII, enlaces de descarga y tabla de versiones actualizada.
- `index.html` y `static/index.html`: Sincronizados al 100%.
