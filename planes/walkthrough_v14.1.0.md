# Walkthrough v14.1.0 — Interfaz Única Nativa (Android & Ubuntu) y Retiro Completo de Firebase

## 1. Normativa Actualizada (`./GEMINI.md`)
- **Regla 3.3 (`Identidad Alethia y Paridad Multiplataforma`)**: Establece la interfaz web (*Alethia × Zeus Vision*) como **única fuente de verdad visual** y corrige los tokens oscuros (`#0A140B` / `#111F13` / `#18291A` / `#F5F4F2` / `#C6F19D`) para que coincidan 1:1 con `src/index.css`.
- **Reglas 5.1 y 5.2 (`Una Única Interfaz Unificada` y `Paridad Estética Total`)**:
  - Corrige la descripción del motor canónico (`React + TypeScript + Tailwind CSS` compilada en `static/index.html`).
  - Prohíbe vistas, tarjetas, docks o cabeceras nativas duplicadas que compitan con la interfaz web.
  - Exige sincronización bidireccional en tiempo real del tema Claro ↔ Oscuro entre Web y contenedores nativos (Ubuntu GTK 3 + WebKit2; Android Compose + barras del sistema + `values-night`).
  - Exige revisión y alineación conjunta de `desktop_app/` y `android_app/` ante cualquier cambio visual web.

## 2. Unificación Estética Nativa
- **Android / Android TV (`android_app/`)**:
  - Eliminados 11 componentes Compose obsoletos y sin uso en `ui/components/`.
  - Eliminada la cabecera nativa duplicada en `CockpitDashboard.kt`; el `WebView` ahora ocupa el 100 % de borde a borde (`systemBarsPadding`) mostrando la barra superior y dock flotante web como única interfaz.
  - Sincronización en vivo del tema mediante `RecursosAndroidBridge.onThemeChanged` / `getPreferredTheme` y persistencia en `SecurePreferences.uiTheme`.
  - Tinte dinámico de barra de estado y navegación en `Theme.kt` (`#F5F4F2` claro / `#0A140B` oscuro) y arranque frío consistente en `values/themes.xml` y `values-night/themes.xml`.
  - Overlays auxiliares (búsqueda de nodo, recuperación offline y acceso revocado) alineados 100 % con los tokens Alethia sin tonos azul cielo heredados.
- **Ubuntu Linux (`desktop_app/recursos_app.py`)**:
  - Hojas de estilo duales `NATIVE_CSS_LIGHT` y `NATIVE_CSS_DARK` en paridad 1:1 con `src/index.css`.
  - Corregido el contraste de `.launcher-hero .launcher-title` y `.launcher-hero .launcher-subtitle` (texto claro `#F5F4F2` / `#C8D2C6` sobre obsidiana) y añadido `.launcher-card-title`.
  - Sincronización dinámica WebKit2 ↔ GTK 3 mediante `WebKit2.UserContentManager` (`recursosTheme`) y `POST /api/native/theme`, actualizando CSS, `gtk-application-prefer-dark-theme`, fondo de WebKit2 y `client_config.json`.
  - Apertura directa de la interfaz unificada cuando ya existe un nodo guardado o dominio WAN configurado.

## 3. Retiro Completo de Firebase
- Eliminados los archivos de configuración, reglas, esquema, tests, proveedor y ErrorBoundary de Firebase (`firebase-applet-config.json`, `firebase-blueprint.json`, `firestore.rules`, `firestore.rules.test.ts`, `src/firebase/*`, `src/components/FirestoreErrorBoundary.tsx`).
- Eliminadas las dependencias `firebase` y `@firebase/eslint-plugin-security-rules` de `package.json` y `eslint.config.js`.
- Eliminadas las tarjetas, hooks, insignias y sincronizaciones de Firestore en `src/main.tsx`, `src/App.tsx`, `src/components/MoreView.tsx`, `src/components/NetworkSecurityView.tsx` y `src/components/GlobalSearchModal.tsx`.
- Limpiadas las directivas CSP de Firebase/Google Auth en `server.py`, el manejo de popups OAuth de Firebase en `desktop_app/recursos_app.py` y las 36 claves huérfanas `firebase.*` en `i18n/dictionary.csv`.

## 4. Verificación
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`
- Integridad de `./i18n/dictionary.csv`
- `npm run build` + `bash packaging/build_deb.sh`
- `compile_applet` + `lint_applet` + `restart_dev_server`
