import { cors, leerCuerpoJson, requireUser } from '@/lib/api/http';
import { createAdminSupabase } from '@/lib/supabase/server';

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
    // El access_token (de sesión o de recuperación) ya fue validado contra
    // GoTrue por `requireUser`, así que `auth.usuario.id` es la identidad real.
    //
    // No se usa `auth.db.auth.setSession(...)`: el token de recuperación no
    // trae refresh_token, y auth-js lanza `AuthSessionMissingError` cuando el
    // refresh_token está vacío, dejando el `updateUser` sin sesión. Ésa era la
    // causa del 500 anterior. Se actualiza la contraseña por id con la API de
    // administración, que es el mecanismo soportado en servidor.
    //
    // Importante: el id NUNCA se toma del cuerpo de la petición, siempre del
    // token verificado, por lo que un usuario no puede cambiar la contraseña de
    // otro.
    const admin = await createAdminSupabase();
    const { error } = await admin.auth.admin.updateUserById(auth.usuario.id, {
      password: newPassword,
    });

    if (error) {
      console.error('[Auth Restablecer] Error al actualizar la contraseña:', error.message);
      return CORS.json(
        request,
        { error: 'No se pudo restablecer la contraseña. Solicita un enlace nuevo.' },
        400
      );
    }

    return CORS.json(request, { message: 'Contraseña restablecida con éxito.' }, 200);
  } catch (err) {
    console.error(
      '[Auth Restablecer] Error inesperado:',
      err instanceof Error ? err.message : 'desconocido'
    );
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
