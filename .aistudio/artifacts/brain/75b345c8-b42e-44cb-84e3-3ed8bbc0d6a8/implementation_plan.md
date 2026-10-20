# Plan de Implementación: Sistema de Bloqueo Criptográfico Zero-Trust (LAN Pairing & Mobile Access)

Sustitución y blindaje del sistema de bloqueo y control de acceso del servidor (`server.py` y `static/index.html`). El nuevo sistema garantiza que cualquier dispositivo conectado en la red local (LAN) reciba automáticamente una credencial criptográfica segura firmada por el servidor, permitiéndole seguir accediendo de forma ininterrumpida desde redes móviles externas (4G/5G/WAN), mientras bloquea terminantemente a cualquier visitante externo no emparejado.

---

## 1. Arquitectura del Sistema de Bloqueo y Flujo de Confianza

```
               [ Dispositivo en Red Local (LAN) ]
                              │
               Petición HTTP a 192.168.50.2:8080
                              │
               Valida IP de origen: 192.168.50.x (LAN)
                              ▼
            ┌───────────────────────────────────────────┐
            │ Emisión Automática de Credencial Segura   │
            │  1. Genera ID único de dispositivo        │
            │  2. Firma HMAC-SHA256 con clave secreta   │
            │  3. Registra en trusted_devices.json      │
            │  4. Inyecta Cookie HttpOnly Segura        │
            └───────────────────────────────────────────┘
                              │
                              ▼
        [ Dispositivo pasa a Datos Móviles / Red Externa (WAN) ]
                              │
             Petición desde IP Pública Externa
                              │
            ┌───────────────────────────────────────────┐
            │ ¿Tiene Cookie con Token HMAC Válido?      │
            └─────────────────────┬─────────────────────┘
                       │                     │
                     [ SÍ ]                [ NO ]
                       ▼                     ▼
          ┌───────────────────────┐ ┌──────────────────────────┐
          │ Acceso Permitido      │ │ Bloqueo Inmediato        │
          │ Dashboard en tiempo   │ │ Muestra Pantalla de      │
          │ real con telemetría   │ │ Bloqueo & Desbloqueo     │
          │                       │ │ con Clave Maestra        │
          └───────────────────────┘ └──────────────────────────┘
```

---

## 2. Componentes Clave & Mejoras de Seguridad

### A. Credenciales con Firma Criptográfica HMAC-SHA256
- **Generación del Secreto de Servidor**: Creación o persistencia de una clave secreta del servidor (`.auth_secret`) de 256 bits (`secrets.token_bytes(32)`).
- **Formato del Token**: `dev_<uuid>.<timestamp>.<hmac_signature>`.
- **Validación en Tiempo Constante**: Uso estricto de `hmac.compare_digest` para evitar ataques de temporización (*timing attacks*).
- **Atributos de Cookie**:
  - `HttpOnly`: Impide acceso y robo desde JavaScript / XSS.
  - `SameSite=Lax` (y compatible con `SameSite=None; Secure; Partitioned` cuando esté integrado en HTTPS/reverse proxy).
  - `Path=/`, `Max-Age=31536000` (1 año de duración renovable).

### B. Detección Rigurosa de Origen de Red (Anti-Spoofing)
- **Subredes de Confianza LAN**: `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`, `100.64.0.0/10` (Tailscale) y loopback (`127.0.0.1`, `::1`).
- **Sanitización de Headers**: Si la petición proviene de Caddy/Nginx local, inspección estricta de `X-Real-IP` o la IP de cliente remota no falsificable.

### C. Escudo Anti-Fuerza Bruta para Desbloqueo de Emergencia
- Límite de 5 intentos fallidos dentro de una ventana de 10 minutos.
- Bloqueo temporal por IP de 15 minutos en caso de exceder los intentos.
- Retardo progresivo (*exponential sleep*) en cada intento erróneo para neutralizar bots automatizados.
- Registro de auditoría de intentos fallidos.

### D. Panel de Gestión y Revocación de Dispositivos (UI)
- Sección accesible desde el botón "Seguridad" en la cabecera del dashboard.
- Lista en vivo de dispositivos vinculados con su tipo (Móvil, Tablet, PC, Consola), primera conexión en LAN, última conexión externa y estado.
- Acción de revocación individual de dispositivos en un clic (`/api/auth/revoke`).
- Acción de revocación global ("Revocar todos los demás dispositivos") para restablecer la seguridad en caso de extravío.

---

## 3. Plan de Verificación & Pruebas

1. **Prueba de Emparejamiento en Red Local**:
   - Conexión simulada desde IP local (`127.0.0.1` o `192.168.50.x`): verificación de emisión de token HMAC, guardado en `trusted_devices.json` y acceso transparente sin bloqueo.
2. **Prueba de Conexión Externa con Token Válido (Datos Móviles)**:
   - Conexión desde IP pública/externa enviando la cookie de confianza: verificación de acceso inmediato al dashboard y actualización de `last_external_ip`.
3. **Prueba de Bloqueo para Dispositivo Externo No Emparejado**:
   - Conexión desde IP externa sin cookie o con cookie manipulada: verificación de código HTTP de bloqueo y renderizado de la pantalla interactiva de clave maestra.
4. **Prueba de Rescate y Desbloqueo con Clave Maestra**:
   - Introducción de clave maestra correcta: emisión inmediata de credencial válida y redirección al panel.
   - Introducción de clave incorrecta: verificación del limitador de intentos y bloqueo temporal tras 5 fallos.
5. **Prueba de Revocación desde el Panel**:
   - Revocar un dispositivo desde la interfaz: verificación de que el token es eliminado de `trusted_devices.json` y que las siguientes peticiones de ese dispositivo quedan bloqueadas.
