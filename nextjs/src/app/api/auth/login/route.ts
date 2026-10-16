import { cors } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// Reutiliza la misma allowlist que el resto de rutas (sin `*`).
const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

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
      console.error('Supabase login error:', error.message);

      return CORS.json(
        request,
        { error: 'Correo o contraseña incorrectos' },
        401
      );
    }

    return CORS.json(
      request,
      {
        message: 'Login exitoso',
        user: data.user,
        session: data.session,
      },
      200
    );
  } catch (error) {
    console.error('Error en login:', error);

    return CORS.json(request, { error: 'Error interno del servidor' }, 500);
  }
}
