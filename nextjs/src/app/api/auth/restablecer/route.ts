import { cors, leerCuerpoJson, requireUser } from '@/lib/api/http';

const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const body = await leerCuerpoJson(request);
  const newPassword = typeof body?.password === 'string' ? body.password : '';

  if (newPassword.length < 6) {
    return CORS.json(request, { error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
  }

  try {
    // Para operaciones de Auth en el servidor con un token Bearer (no cookies),
    // necesitamos asegurar que el cliente tenga la sesión activa.
    await auth.db.auth.setSession({
      access_token: auth.token,
      refresh_token: '' // No lo tenemos, pero no es crítico para updateUser
    });

    const { error } = await auth.db.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error('[Auth Restablecer] Error:', error.message);
      return CORS.json(request, { error: 'No se pudo restablecer la contraseña.' }, 400);
    }

    return CORS.json(request, { message: 'Contraseña restablecida con éxito.' }, 200);
  } catch (err) {
    console.error('[Auth Restablecer] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
