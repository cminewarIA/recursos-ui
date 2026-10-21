# Plan de Implementación: Criterio Estricto de Incremento de Versiones

El usuario ha definido la regla formal y estricta para la asignación y subida de versiones en el proyecto:

## Criterios de Versionado Semántico
1. **`X.0.0` (Cambio de diseño)**:
   - Se incrementa el primer número (`MAJOR`) únicamente ante un cambio de diseño (diseño visual, maquetación, temas o interfaz).
   - Los otros dos números se restablecen a 0 (ej. de `4.9.0` a `5.0.0`).
2. **`0.X.0` (Añadir o quitar una función)**:
   - Se incrementa el segundo número (`MINOR`) al añadir una nueva característica o retirar una función existente.
   - El tercer número se restablece a 0 (ej. de `4.9.1` a `4.10.0`).
3. **`0.0.X` (Actualización o ajuste de pequeños detalles)**:
   - Se incrementa el tercer número (`PATCH`) al actualizar algo existente, corregir errores o ajustar pequeños detalles/reglas/documentación (ej. de `4.9.0` a `4.9.1`).

## Tareas a Realizar
1. Actualizar `GEMINI.md` incorporando este criterio detallado en la regla 5.
2. Actualizar `VERSION` de `4.9.0` a `4.9.1` (ajuste de reglas/pequeños detalles).
3. Sincronizar `package.json` con `4.9.1`.
4. Actualizar `README.md` documentando el criterio estricto de versionado y la versión `4.9.1`.
5. Guardar planes y walkthroughs en `planes/`.
6. Confirmar commit y realizar `git push origin main`.
