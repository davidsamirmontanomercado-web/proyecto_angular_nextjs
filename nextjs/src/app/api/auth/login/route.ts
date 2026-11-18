import { cors } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// Reutiliza la misma allowlist que el resto de rutas (sin `*`).
const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  try {
    const { email, password, rememberMe } = await request.json();

    if (!email || !password) {
      return CORS.json(
        request,
        { error: 'El correo y la contraseña son obligatorios' },
        400
      );
    }

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // ... (código de error existente se mantiene igual)
      console.error('Supabase login error:', error.status, error.code, error.message);
      const codigo = (error.code || '').toLowerCase();
      const mensaje = (error.message || '').toLowerCase();

      if (codigo === 'email_not_confirmed' || mensaje.includes('email not confirmed')) {
        return CORS.json(request, { error: 'Debes confirmar tu correo antes de iniciar sesión...' }, 403);
      }

      if (codigo === 'too_many_requests' || error.status === 429) {
        return CORS.json(request, { error: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' }, 429);
      }

      return CORS.json(request, { error: 'Correo o contraseña incorrectos' }, 401);
    }

    const { session, user } = data;
    if (!session || !user) {
      return CORS.json(request, { error: 'No se pudo iniciar sesión' }, 401);
    }

    // Detectar si el usuario tiene MFA (2FA) activo
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    const hasActiveMFA = !factorsError && factors && factors.all.some(f => f.status === 'verified');

    // Configuración profesional de cookies basada en "Recordarme"
    const expiresIn = rememberMe ? 60 * 60 * 24 * 30 : session.expires_in;
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: expiresIn,
      path: '/',
    };

    const response = CORS.json(
      request,
      {
        message: hasActiveMFA ? 'MFA_REQUIRED' : 'Login exitoso',
        user: user,
        session: session,
        mfaRequired: hasActiveMFA,
        factors: hasActiveMFA ? factors.all.filter(f => f.status === 'verified') : []
      },
      200
    );

    // Establecer cookies en la respuesta para persistencia en el backend
    response.cookies.set('sb-access-token', session.access_token, cookieOptions);
    if (session.refresh_token) {
      response.cookies.set('sb-refresh-token', session.refresh_token, cookieOptions);
    }

    return response;
  } catch (error) {
    console.error('Error en login:', error);

    return CORS.json(request, { error: 'Error interno del servidor' }, 500);
  }
}
