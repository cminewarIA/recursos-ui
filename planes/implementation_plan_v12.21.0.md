# Plan de Implementación v12.21.0 — Simplificación de Conexiones con IA en Servidor + Restauración de Historial y Filtros del Mapa GeoIP

## 1. Objetivos
1. **Identificación y Simplificación Inteligente de Conexiones con IA en el Servidor (`POST /api/net/ai-identify`)**:
   - Ejecutar clasificación dinámica en el servidor (`vite.config.ts` con `@google/genai` y `server.py` con Gemini REST API `gemini-4-hydrogen`), enviando telemetría de cada conexión junto con el contexto real de servicios, procesos en escucha y contenedores Docker detectados dinámicamente en la máquina anfitriona (cero hardcoding de dominios o IPs).
   - Mejorar además la correlación de sockets en `server.py` (`psutil` + `ss` + `docker ps` + `/proc/<pid>/cgroup`) para reducir etiquetas genéricas de `"Kernel Conntrack"` cuando un proceso/servicio local real escucha en ese puerto.
   - Simplificar la lectura en **ambos** apartados (`Mapa de conexiones` popups y `Conexiones detalladas`), mostrando en primer plano el servicio/aplicación identificada y un resumen en lenguaje humano junto con vista técnica colapsable/secundaria.
   - Sin exposición de claves API al navegador y sin respuestas simuladas en caso de fallo o ausencia de `GEMINI_API_KEY`.
2. **Restauración de Historial y Filtros Multicriterio en el Mapa GeoIP (`Red -> Mapa de conexiones`)**:
   - Reintegrar el selector **En vivo / Historial** respaldado por `/api/net/history`, ventana temporal (`1 h`, `6 h`, `24 h`, `7 d`, `Todo`), resumen y limpieza segura del historial (`POST /api/net/history/clear`).
   - Reintegrar los selectores dinámicos de **Dispositivo** y **Servicio** junto a las píldoras de dirección (`Todo`, `Entrantes`, `Salientes`, `Dispositivos`, `Bloqueadas`) y el buscador.
   - Actualizar `vite.config.ts` (`/api/net/history`) para soportar filtrado por `hours`, `service`, `device`, `direction`, `q` y `limit` con total paridad respecto a `server.py`.

## 2. Archivos Impactados
- `./VERSION` (`12.20.0` → `12.21.0`)
- `./planes/implementation_plan_v12.21.0.md` y `./planes/walkthrough_v12.21.0.md`
- `./src/types/telemetry.ts`
- `./vite.config.ts`
- `./server.py`
- `./src/components/NetworkSecurityView.tsx`
- `./i18n/dictionary.csv`
- `./README.md`

## 3. Verificación Planificada
- Validación de integridad CSV de `./i18n/dictionary.csv` (33 columnas uniformes, cero claves duplicadas).
- Comprobación de reglas Firestore (`npx eslint firestore.rules`).
- Compilación TypeScript estricta (`npx tsc --noEmit --noUnusedLocals --noUnusedParameters`) y compilación Python (`python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`).
- Build de producción Vite + empaquetado `.deb` (`npm run build` + `bash packaging/build_deb.sh`).
- Pruebas HTTP reales sobre `:3000` (`/api/version`, `/api/net/history?hours=24`, `POST /api/net/ai-identify`) y verificación final con `compile_applet` + `lint_applet`.
