# Informe — Módulo de Transmisiones en Vivo (Live Commerce)

Fecha: 2026-11-16
Ámbito: módulo de transmisiones en vivo (vendedor / comprador / administrador) sobre el proyecto existente (Angular + Next.js + Supabase + LiveKit + Vercel). **No se reconstruyó nada**: se auditó, corrigió e implementó sobre la estructura existente.

---

## 1. Causa exacta del error de LiveKit

Mensaje reproducido por el usuario:

> "La emisión en tiempo real no está disponible: al servidor le faltan las credenciales de LiveKit."

**Causa real y única:** el endpoint `POST /api/transmisiones/[id]/token` llama a `leerConfigLiveKit()` ([server.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/lib/livekit/server.ts#L37-L44)). Esa función devuelve `null` cuando **falta cualquiera** de estas tres variables de entorno **en el servidor**:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Al ser `null`, la ruta responde **HTTP 503** con ese mensaje ([route.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/app/api/transmisiones/%5Bid%5D/token/route.ts#L49-L67)).

**No es un bug de código ni de la integración WebRTC**: la generación de tokens, la creación del cliente de sala y la conexión de `livekit-client` están correctas. El fallo es **de configuración de despliegue**: el entorno (Vercel en producción y/o `.env.local` en local) no tenía definidas esas tres variables.

**Mejora aplicada para que el error sea accionable:** el 503 ahora incluye también `variablesFaltantes` con **los nombres exactos** que faltan (nunca sus valores), y se registra en logs del servidor. Antes el mensaje no indicaba *cuáles* faltaban.

> Seguridad respetada: `LIVEKIT_API_SECRET` y las demás claves privadas se leen sólo en el servidor (`process.env.*`, sin prefijo `NEXT_PUBLIC_`) y nunca se envían al navegador. El error sólo devuelve **nombres de variables**.

---

## 2. Archivos modificados

| Archivo | Cambio |
|---|---|
| [nextjs/src/lib/livekit/server.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/lib/livekit/server.ts) | Añadida `variablesLiveKitFaltantes()` y `contarParticipantes()` (para el cron). |
| [nextjs/src/app/api/transmisiones/[id]/token/route.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/app/api/transmisiones/%5Bid%5D/token/route.ts) | El 503 informa `variablesFaltantes`; rol resuelto en servidor (anfitrión vs espectador). |
| [nextjs/.gitignore](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/.gitignore) | Excepción `!.env.example` para versionar la plantilla (sin secretos). |
| [Angular/.../services/transmisiones.service.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/Angular/frontend/src/app/services/transmisiones.service.ts) | Nuevos `cancelar()`, `getProductosTransmision()`, `guardarProductosTransmision()` + interface `ProductoPromocionado`. |
| [Angular/.../pages/live/live.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/Angular/frontend/src/app/pages/live/live.ts) | Compartir pantalla, selección de dispositivos, productos promocionados, cancelar transmisión. |
| [Angular/.../pages/live/live.html](file:///c:/Users/darli/clone/proyecto_angular_nextjs/Angular/frontend/src/app/pages/live/live.html) | Botón compartir pantalla, selects de dispositivos, selector de productos, tarjeta de producto para el comprador, estado "cancelada". |
| [Angular/.../pages/live/live.css](file:///c:/Users/darli/clone/proyecto_angular_nextjs/Angular/frontend/src/app/pages/live/live.css) | Estilos de pantalla compartida (`object-fit:contain`, z-index), dispositivos, productos y promo-card. |

## 3. Archivos nuevos

| Archivo | Propósito |
|---|---|
| [nextjs/.env.example](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/.env.example) | Plantilla de variables (Supabase, LiveKit, Cron, MailerSend) sin credenciales reales. |
| [nextjs/vercel.json](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/vercel.json) | Cron cada 5 min → `/api/cron/cerrar-transmisiones-huerfanas`. |
| [nextjs/src/app/api/transmisiones/[id]/cancelar/route.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/app/api/transmisiones/%5Bid%5D/cancelar/route.ts) | `(programada | en_vivo) → cancelada`, sólo anfitrión; cierra la sala si estaba en vivo. |
| [nextjs/src/app/api/transmisiones/[id]/productos/route.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/app/api/transmisiones/%5Bid%5D/productos/route.ts) | GET (público en vivo / anfitrión) y PUT (sólo anfitrión) de productos promocionados. |
| [nextjs/src/app/api/cron/cerrar-transmisiones-huerfanas/route.ts](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/src/app/api/cron/cerrar-transmisiones-huerfanas/route.ts) | Cierra transmisiones `en_vivo` sin participantes en la sala LiveKit. |
| [nextjs/supabase/migrations/20261116120000_transmision_productos.sql](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/supabase/migrations/20261116120000_transmision_productos.sql) | Tabla N:N `transmision_productos` + vista pública + RLS. |

## 4. Cambios realizados en Supabase

**Migración:** [`20261116120000_transmision_productos.sql`](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/supabase/migrations/20261116120000_transmision_productos.sql)

- Nueva tabla `public.transmision_productos` (`transmision_id uuid` → `transmisiones.id`, `producto_id bigint` → `productos.id`, `orden`, `created_at`; PK compuesta). **No elimina ni duplica** nada; respeta las relaciones existentes.
- RLS: el propietario (anfitrión) inserta/borra; lectura permitida a la vista pública. Vínculo por `exists (... t.anfitrion_id = auth.uid())` (mismo patrón que el resto del proyecto).
- Vista `public.transmision_productos_publico` (`security_invoker=false`) que expone sólo productos de transmisiones `en_vivo` (o propias del anfitrión).
- **Estado `cancelada`:** no requiere migración. Verificado en [20261015130000_transmisiones_flujo_propietario.sql](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/supabase/migrations/20261015130000_transmisiones_flujo_propietario.sql#L30-L33): `estado = text (acepta valores arbitrarios, no es un enum)`. No hay CHECK constraint que lo impida.

**Acción manual pendiente:** aplicar la migración (SQL Editor de Supabase o `supabase db push`).

## 5. Variables de entorno que debes configurar

Obligatorias para que las transmisiones funcionen:

| Variable | Descripción |
|---|---|
| `LIVEKIT_URL` | Endpoint WebSocket del servidor de medios, formato `wss://...`. |
| `LIVEKIT_API_KEY` | API Key del proyecto LiveKit. |
| `LIVEKIT_API_SECRET` | API Secret (**secreto crítico**, sólo servidor). |
| `SUPABASE_URL` | Project URL de Supabase. |
| `SUPABASE_ANON_KEY` | Clave publicable/anon (o `SUPABASE_PUBLISHABLE_KEY` como alias). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sólo para rutas admin y el cron. |
| `NEXT_PUBLIC_ANGULAR_URL` | Origen del frontend (CORS y retorno de login Google). **Única** variable pública admitida. |
| `CRON_SECRET` | Secreto aleatorio para el cron de mantenimiento. |

Detalle completo, con explicación de cada una y cómo obtener las credenciales, en [.env.example](file:///c:/Users/darli/clone/proyecto_angular_nextjs/nextjs/.env.example).

> Generar `CRON_SECRET`:
> ```
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

## 6. Pasos para configurar LiveKit en Vercel

1. **Obtener credenciales**: LiveKit Cloud (https://cloud.livekit.io) → crear proyecto → *Project Settings → Keys → Add key* → copiar **API Key** y **API Secret**. La URL es `wss://<tu-proyecto>.livekit.cloud`.
   (Alternativa self-hosting: URL de tu servidor `wss://...` y las claves de `livekit.yaml`.)
2. **Vercel** → *Project (backend Next.js)* → **Settings → Environment Variables**. Añadir `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (y `CRON_SECRET`) en **Production** y **Preview**. **No** usar prefijo `NEXT_PUBLIC_`.
3. **Redeploy** (*Deployments → Redeploy*) para que las variables tomen efecto.
4. **Local**: copiar `.env.example` a `.env.local` y rellenar los valores.
5. **Validación**: sin las variables, `POST /api/transmisiones/[id]/token` responde 503 indicando qué falta; con ellas, responde 200 con `{ url, token, rol, sala }`.

## 7. Funcionalidades implementadas

**Vendedor:** iniciar transmisión con título y descripción; seleccionar productos a promocionar (hasta 20, del propio catálogo); encender/apagar cámara y micrófono; **seleccionar dispositivos** de cámara/micrófono disponibles; **compartir pantalla** (botón, publicación de pista LiveKit, detener, recuperar cámara, gestionar parada desde el navegador, evitar pistas duplicadas); **finalizar** y **cancelar** la transmisión.

**Comprador:** listado de transmisiones activas; info del vendedor; título y descripción; **producto promocionado** (tarjeta + franja); **reproducción real** de video/audio de la misma sala LiveKit; visualización de cámara y de **pantalla compartida**; reconexión ante cortes de red; mensaje cuando la transmisión finaliza o se cancela.

**Seguridad / roles:** el rol del token (`anfitrion` = `canPublish:true`; `espectador` = `canPublish:false`) lo decide **el servidor** comparando `auth.usuario.id` con `transmisiones.anfitrion_id`. Un comprador **no puede** obtener permisos de publicación manipulando la petición: el backend nunca acepta el rol desde el cliente. Consultas con RLS ligada al token del usuario (sin `service_role`).

**Estados:** `programada | en_vivo | finalizada | cancelada` (nomenclatura existente del proyecto). Transiciones validadas en backend; al finalizar/cancelar se cierra la sala LiveKit. Cron cada 5 min cierra huérfanas (`en_vivo` sin participantes).

## 8. Pruebas realizadas y sus resultados

**Pruebas automatizadas ejecutadas (resultado real):**

| Prueba | Comando | Resultado |
|---|---|---|
| TypeScript (Angular) | `npx tsc --noEmit -p tsconfig.app.json` | ✅ Exit 0 — sin errores. |
| Compilación AOT + plantillas Angular | `npx ngc -p tsconfig.app.json` | ✅ Exit 0 — `.ts` y `.html` compilan (los `.js` emitidos se limpiaron). |
| Build producción Next.js | `npm run build` (en `nextjs`) | ✅ Exit 0 — compila, incluidas las rutas nuevas `/api/transmisiones/[id]/cancelar`, `/api/transmisiones/[id]/productos` y `/api/cron/cerrar-transmisiones-huerfanas`. |
| Build producción Angular | `npm run build` | ⚠️ **Bloqueado por el entorno**: el CLI exige Node ≥ v22.22.3 (equipo tiene v22.21.0). **No es un fallo de código** (tsc y ngc pasan). Solución: actualizar Node a ≥ 22.22.3 o 24.15.0+. |

**Pruebas funcionales de los 6 escenarios (sección 10 del encargo):** **NO ejecutadas** por mí, porque requieren **credenciales reales de LiveKit** y **dos sesiones de navegador** simultáneas. No las marco como superadas — tal como pediste, no doy por terminado lo que no he podido comprobar. El código y los validadores están listos para ejecutarlas (guía en la sección 10).

## 9. Problemas pendientes

1. **Configurar credenciales LiveKit** (obligatorio) en Vercel y `.env.local` — sin esto persiste el 503.
2. **Aplicar la migración** `20261116120000_transmision_productos.sql` en Supabase.
3. **Definir `CRON_SECRET`** en Vercel para activar el cron de limpieza.
4. **Actualizar Node** del entorno local a ≥ 22.22.3 para poder ejecutar `ng build`.
5. **Ejecutar las 6 pruebas funcionales** con dos usuarios reales (no verificadas aún).
6. Verificar en Supabase la política RLS de `transmisiones` para `cancelada` (la lectura pública sólo expone `en_vivo`; el propietario ve las suyas en cualquier estado — comportamiento ya soportado por las migraciones existentes).

## 10. Instrucciones para probar con dos usuarios

**Preparación:** configura las variables LiveKit (sección 6) + aplica la migración + redeploy. Actualiza Node si usarás la CLI de Angular.

**PRUEBA 1 — Inicio (vendedor):** inicia sesión como **vendedor** → crea un en vivo → en la sala pulsa *Iniciar transmisión*, concede cámara/micrófono → debe conectar a LiveKit (badge *EN VIVO* y vista previa). El estado pasa a `en_vivo`.

**PRUEBA 2 — Acceso (comprador):** abre un **segundo navegador/incógnito** → inicia sesión como **comprador** → lista de en vivos → entra a la transmisión activa → debe **ver y oír** al vendedor.

**PRUEBA 3 — Compartir pantalla:** vendedor pulsa *Compartir pantalla* → el comprador ve la pantalla compartida → *Dejar de compartir* → comprador vuelve a ver la cámara, sin perder la conexión.

**PRUEBA 4 — Permisos:** como comprador, intenta publicar (mic/cámara/pantalla): la UI no lo ofrece y, aunque se manipule la petición al endpoint de token, el backend emite `canPublish:false` (comprobar en consola/red).

**PRUEBA 5 — Finalización:** vendedor pulsa *Finalizar* → el comprador recibe el cierre y el estado pasa a `finalizada`; la sala se destruye.

**PRUEBA 6 — Errores:** quita `LIVEKIT_API_SECRET` → el endpoint responde 503 con `variablesFaltantes:["LIVEKIT_API_SECRET"]`; deniega permiso de cámara/micrófono → mensaje claro; corta la red del comprador → reconexión automática; cierra el navegador del vendedor sin finalizar → el cron (≤ 5 min) marca `finalizada`.

---

### Resumen

- **Error de LiveKit:** causa = faltan `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` en el servidor (no es bug de código). **Solución:** configurarlas + redeploy.
- **Implementado a nivel de código:** compartir pantalla, selección de dispositivos, productos promocionados, estado `cancelada`, cierre de huérfanas por cron, `.env.example`.
- **Validado realmente:** TypeScript, compilación AOT de plantillas Angular y build de producción de Next.js (todos exit 0).
- **Pendiente de tu lado:** credenciales LiveKit, migración en Supabase, `CRON_SECRET`, Node ≥ 22.22.3 y la ejecución de las 6 pruebas funcionales.
