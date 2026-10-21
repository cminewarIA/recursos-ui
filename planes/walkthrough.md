# Recorrido de Verificación: Persistencia Robusta de Popups y Regla Zero-Hardcoding (`v4.11.2`)

## 1. Resumen de Cambios Realizados
- **Persistencia Robusta de Popups en el Mapa**:
  - Detección explícita de cierre por el usuario (`[×]` o `Escape`), suprimiendo el borrado accidental por eventos automáticos de Leaflet.
  - Búsqueda multicriterio (ID de socket -> IP remota -> IP representativa -> IPs del cluster -> Proximidad geográfica).
  - Cero cierres involuntarios durante los ciclos de refresco de telemetría (cada 2 segundos) ni durante el zoom continuo del mapa.
- **Regla 7 en `GEMINI.md`**:
  - Principio Estricto de Cero Hardcoding (Zero-Hardcoding). Prohibición de nombres fijos de ciudades, ubicaciones o marcas en el código fuente.
- **Sincronización y Despliegue**:
  - `static/index.html` sincronizado con `index.html`.
  - Versión elevada a `4.11.2` (`0.0.X` para corrección de bugs y reglas).
  - Servicio reiniciado y verificado.
