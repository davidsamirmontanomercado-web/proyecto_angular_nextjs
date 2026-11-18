import { cors, leerCuerpoJson } from '@/lib/api/http';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';

// Registro contra Supabase Auth usando el cliente Admin para evitar los límites
// de envío de correos del plan gratuito de Supabase (3 correos/hora).
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
  const rol = 'comprador';

  if (!email || password.length < 6) {
    return CORS.json(request, { error: 'Datos de registro inválidos. La contraseña debe tener al menos 6 caracteres.' }, 400);
  }

  if (!nombre) {
    return CORS.json(request, { error: 'El nombre es obligatorio.' }, 400);
  }

  try {
    const supabaseAdmin = await createAdminSupabase();

    // 1. Crear el usuario y confirmarlo automáticamente usando la service_role key.
    // Esto evita el error "Error sending confirmation email" causado por los
    // límites de Supabase.
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, rol }
    });

    if (adminError) {
      console.error('[Register] Admin Create User error:', adminError.status, adminError.code, adminError.message);
      
      const detalle = (adminError.message || '').toLowerCase();
      if (detalle.includes('already registered') || adminError.code === 'user_already_exists') {
        return CORS.json(request, { error: 'Este correo ya está registrado. Intenta iniciar sesión.' }, 409);
      }

      return CORS.json(
        request,
        { error: `No se pudo completar el registro: ${adminError.message}` },
        400
      );
    }

    const user = adminData.user;

    // 2. Sincronizar con la base de datos pública usando el cliente Admin.
    const { error: dbError } = await supabaseAdmin.from('usuarios').upsert({
      id: user.id,
      nombre: nombre,
      correo: email,
      rol,
      tipo_cuenta: rol
    });

    if (dbError) {
      console.warn('[Register] Error sincronizando tabla usuarios:', dbError.message);
    }

    // 3. Obtener una sesión real para el usuario recién creado.
    // Usamos el cliente normal (anon) para hacer login y devolver el token al frontend.
    const supabase = await createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError || !authData.session) {
      // Si el login falla tras crear el usuario, pedimos que inicie sesión manualmente.
      return CORS.json(
        request,
        {
          data: {
            confirmationRequired: false,
            message: 'Cuenta creada y confirmada. Por favor, inicia sesión.'
          }
        },
        201
      );
    }

    const session = authData.session;

    return CORS.json(
      request,
      {
        data: {
          confirmationRequired: false,
          user: { id: user.id, email: user.email, nombre, rol, provider: 'local' },
          session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
          },
        },
      },
      201
    );
  } catch (err) {
    console.error('[Register] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
