# Corrección Google Auth — Bucle de redirección a Login

## Repository Research

### Flujo actual (con bugs)
1. Usuario entra a **Angular** `/login` y pulsa **Continuar con Google**
2. `startGoogleLogin()` en [login.ts](file:///C:/xampp/htdocs/proyecto_angular_nextjs-jose-vega/Angular/frontend/src/app/pages/login/login.ts#L51-L82) muestra `Redirigiendo…` y redirige a `http://localhost:3000/google-auth/login` (página Next.js)
3. Página Next.js [google-auth/login/page.tsx](file:///C:/xampp/htdocs/proyecto_angular_nextjs-jose-vega/nextjs/src/app/google-auth/login/page.tsx) comprueba `getCurrentUser()`:
   - **Caso A (usuario ya autenticado en Next.js)** → redirige DIRECTAMENTE a `http://localhost:4200/dashboard`. Pero Angular NO tiene sesión en `localStorage`, por lo que `authGuard` devuelve al `/login` → **bucle infinito**.
   - **Caso B (sin sesión)** → muestra un segundo botón "Continuar con Google" (GoogleButton) que hace `GET /api/auth/google`
4. [api/auth/google/route.ts](file:///C:/xampp/htdocs/proyecto_angular_nextjs-jose-vega/nextjs/src/app/api/auth/google/route.ts) genera URL OAuth de Google y redirige
5. Google autoriza → redirige a `/api/auth/callback`
6. [api/auth/callback/route.ts](file:///C:/xampp/htdocs/proyecto_angular_nextjs-jose-vega/nextjs/src/app/api/auth/callback/route.ts#L56-L72) intercambia código por sesión con Supabase, **codifica el usuario en Base64URL** con `Buffer.from(json,'utf-8').toString('base64url')` y redirige a `http://localhost:4200/google-auth?user=...&at=...&rt=...`
7. [google-auth.ts](file:///C:/xampp/htdocs/proyecto_angular_nextjs-jose-vega/Angular/frontend/src/app/pages/google-auth/google-auth.ts#L87-L126) de Angular intenta decodificar con `decodeURIComponent(escape(atob(userB64)))`. **Aquí está el bug principal**: `atob()` espera Base64 ESTÁNDAR (`+`, `/`, `=`), pero el callback envía Base64URL (`-`, `_`, sin `=`). Si los datos contienen `-` o `_` (lo normal con IDs/JSON), `atob()` lanza excepción, salta al `catch`, y `failAndRedirect()` vuelve a `/login`.

### Dos bugs raíz confirmados
1. **Base64URL vs Base64 estándar** en la decodificación de Angular → `atob()` rompe.
2. **Redirect corto en `google-auth/login` de Next.js** cuando ya existe sesión de Supabase → salta el bridge y llega al dashboard sin localStorage de Angular, el guard lo expulsa.

## Files and Modules
- `Angular/frontend/src/app/pages/google-auth/google-auth.ts`: arreglar decodificación Base64URL → Base64 antes de `atob()`.
- `nextjs/src/app/google-auth/login/page.tsx`: cuando `getCurrentUser()` devuelve usuario, redirigir al bridge Angular `/google-auth` con los parámetros correctos (user/at/rt), NO directamente a `/dashboard`.
- `nextjs/src/app/google-auth/success/page.tsx`: arreglar `atob()` para Base64URL (ruta alternativa, por robustez).

## Implementation Steps
1. **Paso 1 — Corregir decodificación en `google-auth.ts` (Angular)**  
   Antes de decodificar, convertir Base64URL → Base64 estándar:
   - reemplazar `-` → `+`, `_` → `/`
   - añadir padding `=` si falta (longitud múltiplo de 4)
   - usar `TextDecoder` para UTF-8 en lugar del hack deprecado `decodeURIComponent(escape(...))`.

2. **Paso 2 — Corregir redirect corto en Next.js `google-auth/login/page.tsx`**  
   Si `getCurrentUser()` detecta un usuario autenticado, NO redirigir a dashboard. En su lugar:
   - construir el mismo objeto `angularUser` que hace el callback
   - codificar en Base64URL
   - leer tokens de las cookies `sb-access-token` / `sb-refresh-token`
   - redirigir a `${angularBase}/google-auth?user=...&at=...&rt=...` para que el componente Angular guarde la sesión en localStorage y luego vaya a dashboard por su cuenta.

3. **Paso 3 — Corregir `success/page.tsx` (Next.js, ruta legacy)**  
   Aplicar la misma conversión Base64URL → Base64 antes de `atob()` y guardar en localStorage.

## Dependencies and Considerations
- Los cambios NO afectan el flujo de login por correo/contraseña (usa `AuthService.login()` directo).
- El formato Base64URL es el correcto para URLs (no tiene `/`, `?`, `#`), por lo que NO cambiaremos la codificación del callback de Next.js (ya es correcta); solo arreglamos la decodificación de los consumidores.
- `TextDecoder` está disponible en todos los navegadores modernos y es el estándar para decodificar bytes UTF-8 desde un Uint8Array.
- Para el Paso 2, necesitamos leer las cookies del servidor en `page.tsx` mediante `cookies()` de next/headers, y acceder a `sb-access-token` y `sb-refresh-token` si existen.

## Validation
- Probar flujo completo: Angular login → clic Google → OAuth → callback → dashboard.
  - Abrir DevTools → Application → Local Storage `http://localhost:4200` → verificar que existen `lm_user`, `lm_token`, `lm_refresh` después del callback.
  - Si no existen, revisar consola del Angular para errores `[GoogleAuthComponent] Error:`.
- Probar caso sesión previa Next.js:
  - autenticar una vez (debe funcionar), luego borrar SOLO el `lm_user` de localStorage de Angular (mantener cookies de Next.js), visitar Angular login, clic Google → debe acabar en dashboard sin bucle.
- Probar cancelación OAuth: denegar permisos en Google → debe volver a Next.js login con error descriptivo, no a bucle.

## Risks
- **Riesgo: Padding incorrecto al convertir Base64URL** → manejar con módulo 4 y añadir `=` necesarios.
- **Riesgo: Cookies sb-access-token no disponibles en Server Component** → usar `cookies()` de `next/headers` (Next 15) y si no existen, hacer redirect normal (el usuario deberá reautenticar con Google sin problema).
- **Riesgo: Cambios en UTF-8 rompen acentos/nombres** → `TextDecoder` está diseñado para eso; probado con nombres con `ñ`, `á`, `¿` es más robusto que `escape/unescape`.
