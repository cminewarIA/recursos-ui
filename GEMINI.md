# Reglas y Pautas del Proyecto (Dashboard / Recursos)

## 1. Sincronización Previa Obligatoria (git pull)
- **Regla obligatoria**: Antes de comenzar a modificar cualquier archivo en el proyecto o responder a una solicitud de cambio, siempre se debe ejecutar primero `git pull origin main` en `/home/servidor/servicios/dashboard`.
- **Objetivo**: Asegurar que cualquier cambio, commit o trabajo realizado desde Google AI Studio en el móvil se descargue e integre en el servidor local antes de tocar código, evitando conflictos de versión o sobrescrituras.

## 2. Publicación Automática en GitHub (git push)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación en los archivos de la web o backend del dashboard (`index.html`, `static/index.html`, `server.py`, configuración, etc.), se deben confirmar los cambios con un commit claro y hacer `git push` automáticamente al repositorio de GitHub:
  - Repositorio remoto: `https://github.com/cminewarIA/recursos-ui`
  - Rama: `main`
- **Objetivo**: Mantener permanentemente sincronizado el proyecto para que los cambios se reflejen de inmediato en Google AI Studio y el móvil al pulsar *Pull Changes*.

## 3. Almacenamiento Obligatorio de Planes de Implementación y Walkthroughs (`planes/`)
- **Regla obligatoria**: Todos los planes de implementación (`implementation_plan.md`), archivos de recorrido y verificación (`walkthrough.md`, `walkthrough_*.md`), bitácoras de trabajo, pruebas realizadas y documentación de avance deben guardarse SIEMPRE dentro de la carpeta `planes/` del proyecto (`/home/servidor/servicios/dashboard/planes/`). Jamás deben quedar limitados únicamente a carpetas internas temporales de las IA (`.gemini/antigravity/brain`).
- **Objetivo**: Asegurar que tanto Google AI Studio en el móvil como Antigravity compartan siempre el contexto exacto de en qué se ha estado trabajando, qué se ha probado y cómo se ha implementado, pudiendo consultarlo tras sincronizar (`git pull`).

## 4. Actualización Obligatoria del README (`README.md`)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación, corrección, nueva funcionalidad, cambio de diseño o ajuste arquitectónico en el proyecto, se debe actualizar inmediatamente el archivo `README.md` con la descripción de los cambios y el estado actual del sistema.
- **Objetivo**: Garantizar que la documentación del repositorio refleje fielmente en todo momento las características, estructura de directorios, endpoints y funcionamiento real del proyecto tanto en GitHub como en Google AI Studio.

## 5. Control de Versión Unificado y Actualización Obligatoria (`VERSION`)
- **Regla obligatoria**: 
  1. **Punto Único de Verdad**: La versión de la aplicación se define en un único archivo canónico: `/home/servidor/servicios/dashboard/VERSION`. Queda estrictamente prohibido codificar números de versión estáticos o hardcodeados en HTML, scripts o endpoints.
  2. **Consumo Centralizado**:
     - El backend (`server.py`) lee este archivo a través de la función `get_app_version()` y lo expone a través de `/api/metrics` y `/api/version`.
     - El frontend (`static/index.html` e `index.html`) actualiza de forma reactiva todos los elementos visuales (sidebar, cabecera, tarjeta de vista general y vista `/version`) consumiendo el dato centralizado.
     - El archivo `package.json` debe mantenerse permanentemente sincronizado con la misma versión.
  3. **Identificación al Inicio**: Al comenzar cualquier tarea, se debe consultar e identificar la versión activa en `VERSION`.
  4. **Incremento al Finalizar**: Al concluir las modificaciones y antes de confirmar el commit y hacer `git push`, se debe incrementar el número de versión en `VERSION` (siguiendo versionado semántico: `MAJOR.MINOR.PATCH`, ej. de `2.1.0` a `2.2.0`), registrando el salto de versión en el mensaje del commit y en la documentación.

