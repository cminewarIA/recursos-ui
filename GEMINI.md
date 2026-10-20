# Reglas y Pautas del Proyecto (Dashboard / Recursos)

## 1. Sincronización Previa Obligatoria (git pull)
- **Regla obligatoria**: Antes de comenzar a modificar cualquier archivo en el proyecto o responder a una solicitud de cambio, siempre se debe ejecutar primero `git pull origin main` en `/home/servidor/servicios/dashboard`.
- **Objetivo**: Asegurar que cualquier cambio, commit o trabajo realizado desde Google AI Studio en el móvil se descargue e integre en el servidor local antes de tocar código, evitando conflictos de versión o sobrescrituras.

## 2. Publicación Automática en GitHub (git push)
- **Regla obligatoria**: Cada vez que se realice cualquier modificación en los archivos de la web o backend del dashboard (`index.html`, `static/index.html`, `server.py`, configuración, etc.), se deben confirmar los cambios con un commit claro y hacer `git push` automáticamente al repositorio de GitHub:
  - Repositorio remoto: `https://github.com/cminewarIA/recursos-ui`
  - Rama: `main`
- **Objetivo**: Mantener permanentemente sincronizado el proyecto para que los cambios se reflejen de inmediato en Google AI Studio y el móvil al pulsar *Pull Changes*.
