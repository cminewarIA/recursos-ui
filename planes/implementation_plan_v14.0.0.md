# Rediseño Mayor Integral de Interfaz y Arquitectura Modular v14.0.0

Rediseño completo de la interfaz visual de Recursos Cockpit eliminando la barra lateral restrictiva, restaurando el diseño de ancho completo con cabecera editorial despejada y dock flotante elástico, incorporando pestañas modulares independientes con barra de búsqueda rápida transversal (`Ctrl+K`), y resolviendo el arranque del servidor local `python3 server.py` para garantizar visualización inmediata sin pantallas en blanco.

## Decisiones Críticas y Preferencias Confirmadas

> [!IMPORTANT]
> **Decisiones confirmadas por el usuario en Fase 1:**
> 1. **Estructura y Navegación**: Barra superior limpia con dock flotante y ancho completo (se retira la barra lateral fija que restaba espacio y se restaura el lienzo 100% full-width).
> 2. **Organización de Submenús**: Pestañas modulares independientes con buscador rápido por dominio (`Ctrl+K` y caja de filtro reactiva).
> 3. **Entorno Local**: Servidor `python3 server.py` en navegador (se asegura servicio de `/assets/*` y compatibilidad total del bundle `static/index.html` sin pantallas en blanco).

---

## 1. Visión General y Concepto Central

- **Experiencia de Usuario**: Una consola de telemetría de misión crítica de alta fidelidad (*Zeus Vision*), visualmente limpia y ligera, con paleta mineral-obsidiana (`#F5F4F2` / `#0A140B`), tipografía tabular `Geist` + `Geist Mono`, acento verde botánico (`#1E6B38` / `#C6F19D`), animaciones elásticas sin gelatina invasiva en puntero (reservada exclusivamente a topes de scroll).
- **Cero Redundancias**: Cada módulo y subsistema reside estrictamente en su dominio natural:
  - `/inicio`: HUD Ejecutivo (4 medidores angulares en `auto-fit`, curvas HiDPI de 5 min en vivo, avisos prioritarios con solución IA y resumen de cargas).
  - `/equipo`: Silicio físico (`cpu`, `ram`, `gpu`, `storage`).
  - `/programas`: Cargas de software (`processes` con gráfico apilado 24h e inspector PID, `containers` Docker, `services` Systemd con control start/stop, `media` qBittorrent & Emby, `bots` Telegram con test y log vivo).
  - `/red`: Red y ciberseguridad (`live` interfaces y ping, `devices` inventario LAN unificado con WoL/apagado, `map` GeoIP Leaflet, `traffic` telemetría 24h & DNS IA, `speedtest` multi-flujo, `shield` Fail2ban, DuckDNS y Pi-hole).
  - `/mas`: Sistema y nube (`settings` tema y 31 idiomas OTA, `cloud` Firebase con Cloud Auth Bridge, `health` logs journalctl y diagnóstico IA, `updates` .deb y OTA, `security` HMAC y tokens, `dex` USB nativo, `manual` interactivo).

---

## 2. Experiencia de Usuario y Diseño Visual

### A. Anatomía Visual de Ancho Completo
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Emblema] Recursos Cockpit  ·  HOST.LAN  [Buscador Ctrl+K]  [Salud] [Tema] [v14.0.0] │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Pestaña 1]  [Pestaña 2]  [Pestaña 3] ...                   [Filtro rápido]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    REJILLA BENTO FLUIDA 100% VIEWPORT (Tarjetas, Gráficos HiDPI, Tablas)    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
              [ 🏠 Inicio  ·  ⚡ Equipo  ·  📦 Programas  ·  🌐 Red  ·  ⚙️ Más ]
```

1. **Cabecera Editorial Despejada**:
   - Logotipo oficial CMineWar de alta resolución con hostname y estado del nodo en un solo renglón tipográfico no invasivo.
   - Buscador rápido global (`Ctrl+K`) para saltar instantáneamente a cualquier subsistema, proceso, IP, disco o ajuste.
   - Indicadores ejecutivos: Punto vivo de latencia/salud, interruptor de tema Claro/Oscuro y píldora de versión canónica `v14.0.0`.
2. **Pestañas Modulares con Buscador Rápido**:
   - Segmented control sutil en la parte superior de cada vista con indicador de transición animado.
   - Input de filtrado instantáneo para acotar procesos, contenedores, dispositivos LAN o dominios sin paginación ni recortes.
3. **Dock Flotante Obsidiana**:
   - Dock ergonómico centrado inferior con física de muelle `MorphPill` (`stiffness: 440, damping: 36`), accesible tanto en móviles como en pantallas ultra-anchas sin comerse los laterales de las gráficas.

---

## 3. Solución al Servidor Local `python3 server.py` (Cero Pantallas en Blanco)

### Diagnóstico de la Pantalla en Blanco
1. **Falta de ruta para `/assets/*` en `server.py`**:
   `server.py` no contaba con un manejador HTTP para servir archivos bajo `/assets/` generados por Vite (`dist/assets/*.js` y `dist/assets/*.css`). Al solicitar el bundle en compilaciones estándar, devolvía `404 Not Found`.
2. **Inyección en `static/index.html`**:
   El plugin `emitStandaloneStaticHtmlPlugin` en `vite.config.ts` debe generar un bundle verdaderamente autocontenido que garantice renderizado inmediato tanto si se sirve desde `static/index.html` inlined como si se resuelven recursos desde `dist/assets/`.
3. **Manejador universal en `server.py`**:
   Añadir en `server.py` soporte nativo para servir cualquier archivo estático desde `dist/assets/`, `static/` y `dist/` con `Content-Type` exacto (`application/javascript`, `text/css`, `image/png`, `font/woff2`) y cabeceras de caché seguras.

---

## 4. Arquitectura Técnica y Mapeo de Componentes

```
┌──────────────────────────────────────────────────────────────┐
│                           App.tsx                            │
│  - Gestor de Ruta activa (MainTabId)                         │
│  - TopBar Editorial + Global Search (Ctrl+K) Modal           │
│  - Dock Flotante (MorphPill)                                 │
└──────────────┬───────────────────────────────────────────────┘
               │
     ┌─────────┴────────┬───────────────────┬──────────────┬─────────────┐
     ▼                  ▼                   ▼              ▼             ▼
OverviewView      EquipmentView       AppsMediaView   NetworkSecurity   MoreView
(HUD Ejecutivo)   (Silicio)           (Workloads)     (Red & Escudo)   (Sistema & Cloud)
 - 4 Medidores    - Subtabs:          - Subtabs:      - Subtabs:       - Subtabs:
   Angulares        cpu, ram,           processes,      live, devices,   settings, cloud,
 - Curvas 5 min     gpu, storage        containers,     map, traffic,    health, updates,
 - Alertas IA     - Filtro silicio      services,       speedtest,       security, dex,
 - Resumen soft     por sensor          media, bots     shield           manual
                                      - Search bar    - Search bar     - Search bar
```

### Plan de Archivos a Modificar
- **`src/components/NavigationSidebar.tsx`**: Retirar su fijación forzada de sidebar lateral en escritorio; adaptar para mantener el dock flotante unificado y accesible con full-width viewport.
- **`src/App.tsx`**: Eliminar el padding restrictivo (`pl-56` / `pl-16`), restaurar el lienzo simétrico `100%` ancho, integrar la cabecera limpia con botón/atajo de búsqueda rápida (`Ctrl+K`) y restaurar el dock flotante con `MorphPill`.
- **`src/components/GlobalSearchModal.tsx`**: Componente de búsqueda transversal (`Ctrl+K`) para saltar directamente a cualquier sección, proceso, contenedor, interfaz o ajuste.
- **`src/components/OverviewView.tsx`**: Pulir el HUD ejecutivo para que ocupe de manera equilibrada el ancho completo con los 4 medidores angulares y curvas fluidas.
- **`src/components/EquipmentView.tsx`**: Pestañas modulares de silicio (`cpu`, `ram`, `gpu`, `storage`) con filtros instantáneos.
- **`src/components/AppsMediaView.tsx`**: Pestañas de cargas de trabajo con buscador rápido integrado (`processes`, `containers`, `services`, `media`, `bots`).
- **`src/components/NetworkSecurityView.tsx`**: Pestañas de red con buscador de IPs y dispositivos (`live`, `devices`, `map`, `traffic`, `speedtest`, `shield`).
- **`src/components/MoreView.tsx`**: 7 pestañas limpias con buscador de ajustes y registros (`settings`, `cloud`, `health`, `updates`, `security`, `dex`, `manual`).
- **`server.py`**: Añadir manejador HTTP completo para `/assets/*` sirviendo tanto `dist/assets` como `static/assets` con `application/javascript` y `text/css`, asegurando que el servidor local nunca devuelva 404 ni pantalla en blanco.
- **`vite.config.ts`**: Fortalecer `emitStandaloneStaticHtmlPlugin` para empaquetar de forma infalible `static/index.html`.

---

## 5. Verificación Estricta y Entregables

1. **Compilación TypeScript**: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` sin advertencias ni tipos huérfanos.
2. **Validación Python**: `python3 -m py_compile server.py i18n_catalog.py desktop_app/recursos_app.py`.
3. **Build Web y Standalone**: `npm run build` generando `dist/` y `static/index.html` verificados sintácticamente.
4. **Prueba HTTP de Servidor Local**: Arrancar `python3 server.py` y comprobar que `curl http://localhost:8085/` y `curl http://localhost:8085/assets/...` devuelven HTTP 200 con contenido válido y sin pantalla en blanco.
5. **Empaquetado Debian Ubuntu**: `bash packaging/build_deb.sh` generando y firmando `recursos-cockpit_14.0.0_amd64.deb`.
6. **Bitácora**: Actualizar `planes/walkthrough_v14.0.0.md` y `README.md`.
