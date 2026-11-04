import { cors, leerCuerpoJson } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// Renueva la sesión usando el refresh_token del usuario con el mecanismo
// oficial de Supabase Auth (sin service_role). Nunca se registra el token.
const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  const body = await leerCuerpoJson(request);
  const refreshToken =
    typeof body?.refresh_token === 'string' ? body.refresh_token : '';

  if (!refreshToken) {
    return CORS.json(request, { error: 'refresh_token requerido.' }, 400);
  }

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return CORS.json(
        request,
        { error: 'Sesión expirada o inválida.' },
        401
      );
    }

    return CORS.json(
      request,
      {
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
        },
      },
      200
    );
  } catch {
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
