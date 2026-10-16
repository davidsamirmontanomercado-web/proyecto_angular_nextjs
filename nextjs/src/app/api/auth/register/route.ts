import { cors, leerCuerpoJson } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// Registro real contra Supabase Auth (sin service_role). Si Supabase exige
// confirmación de correo, no hay sesión y se informa al cliente para que NO
// se considere autenticado.
const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  const body = await leerCuerpoJson(request);

  const email =
    typeof body?.correo === 'string' ? body.correo.trim().toLowerCase() : '';
  const password = typeof body?.pass === 'string' ? body.pass : '';
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : '';
  const rol = body?.rol === 'comprador' ? 'comprador' : 'empresa';

  if (!email || password.length < 6) {
    return CORS.json(request, { error: 'Datos de registro inválidos.' }, 400);
  }

  try {
    const supabase = await createServerSupabase();

    const angularUrl = process.env.NEXT_PUBLIC_ANGULAR_URL?.replace(/\/+$/, '');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nombre, rol },
        emailRedirectTo: angularUrl ? `${angularUrl}/login` : undefined,
      },
    });

    if (error) {
      return CORS.json(
        request,
        { error: 'No se pudo completar el registro.' },
        400
      );
    }

    const session = data.session;

    if (!session) {
      return CORS.json(request, { data: { confirmationRequired: true } }, 201);
    }

    return CORS.json(
      request,
      {
        data: {
          confirmationRequired: false,
          user: { id: data.user?.id, email: data.user?.email },
          session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
          },
        },
      },
      201
    );
  } catch {
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
