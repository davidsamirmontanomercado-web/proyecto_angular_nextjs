import { cors, requireUser, requireRole, leerCuerpoJson, UUID_RE } from '@/lib/api/http';
import { createAdminSupabase } from '@/lib/supabase/server';

const CORS = cors('GET, PATCH, OPTIONS');

const ROLES_VALIDOS = ['vendedor', 'comprador', 'administrador'] as const;
type Rol = (typeof ROLES_VALIDOS)[number];

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// Lista todos los usuarios. Sólo un administrador puede hacerlo: la lectura va
// con el token del propio admin para que actúe la política RLS
// "Admins pueden ver todos los usuarios" creada en la base de datos.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const permiso = await requireRole(auth, ['administrador']);
  if (!permiso.ok) return CORS.json(request, { error: permiso.mensaje }, permiso.status);

  try {
    console.log(`[Admin Usuarios GET] Solicitud de lista de usuarios por admin:`, auth.usuario.email);

    const admin = await createAdminSupabase();

    // 1. Obtenemos los usuarios de la tabla pública (para nombre, fecha, etc.)
    const { data: dbUsers, error: dbError } = await admin
      .from('usuarios')
      .select('id, nombre, correo, rol, tipo_cuenta, fecha_registro')
      .order('fecha_registro', { ascending: false });

    if (dbError) {
      console.error('[Admin Usuarios GET] Error DB pública:', dbError);
      return CORS.json(request, { error: `Error DB: ${dbError.message}` }, 500);
    }

    // 2. Obtenemos los usuarios de Auth (fuente de verdad del ROL)
    // Aumentamos el límite para asegurarnos de encontrar a todos los usuarios en la lista
    const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({
      perPage: 1000
    });

    if (authError) {
      console.warn('[Admin Usuarios GET] Error listando Auth Users, se usará solo DB:', authError);
    }

    // 3. Cruzamos los datos: el ROL de Auth (app_metadata) es la fuente de verdad definitiva
    const data = await Promise.all((dbUsers || []).map(async (u) => {
      let aUser = authUsers?.users?.find(au => au.id === u.id);

      // Si no está en la lista, lo buscamos individualmente
      if (!aUser) {
        const { data: specificUser } = await admin.auth.admin.getUserById(u.id);
        if (specificUser?.user) {
          aUser = specificUser.user;
        }
      }

      // IMPORTANTE: Obtenemos el rol de todas las fuentes posibles
      const rolAuthApp = aUser?.app_metadata?.rol;
      const rolAuthUser = aUser?.user_metadata?.rol;
      const rolDB = u.rol;
      const rolTipoCuenta = u.tipo_cuenta;

      // Filtramos solo valores que existan y sean cadenas de texto
      const fuentes = [rolAuthApp, rolAuthUser, rolDB, rolTipoCuenta]
        .filter(f => f !== null && f !== undefined && String(f).length > 0)
        .map(f => String(f).toLowerCase().trim());

      console.log(`[Admin Usuarios GET] Fuentes crudas para ${u.correo}:`, { rolAuthApp, rolAuthUser, rolDB, rolTipoCuenta });

      // Lógica de decisión: si CUALQUIER fuente dice que es vendedor, es vendedor.
      let rolFinal = 'comprador';

      if (fuentes.some(f => f === 'administrador' || f === 'admin')) {
        rolFinal = 'administrador';
      } else if (fuentes.some(f => f === 'vendedor')) {
        rolFinal = 'vendedor';
      }

      // Registro de depuración para ver qué está fallando exactamente
      if (u.correo?.includes('samirmercado') || u.correo?.includes('davidsamirmontano') || fuentes.includes('vendedor')) {
        console.log(`[Admin Usuarios GET] Fuentes para ${u.correo}:`, {
          app: rolAuthApp,
          user: rolAuthUser,
          db: rolDB,
          tipo: rolTipoCuenta,
          lista_procesada: fuentes,
          resultado: rolFinal
        });
      }

      return {
        ...u,
        rol: rolFinal,
        tipo_cuenta: rolFinal,
        _debug: {
          fuentes,
          final: rolFinal
        }
      };
    }));

    console.log(`[Admin Usuarios GET] Total usuarios procesados: ${data.length}`);

    const response = CORS.json(request, { data, auth_users_count: authUsers?.users?.length || 0 }, 200);
    // Forzamos al navegador y a cualquier proxy a NO cachear la lista de usuarios
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');

    return response;
  } catch (err) {
    console.error('[Admin Usuarios GET] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// Cambia el rol de un usuario. Requiere `service_role` porque hay que tocar
// tanto `public.usuarios.rol` como la metadata de `auth.users`, que es la fuente
// del rol para las políticas RLS y para `requireRole`.
export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const permiso = await requireRole(auth, ['administrador']);
  if (!permiso.ok) return CORS.json(request, { error: permiso.mensaje }, permiso.status);

  const body = await leerCuerpoJson(request);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const rol = typeof body?.rol === 'string' ? (body.rol.trim() as Rol) : ('' as Rol);

  if (!UUID_RE.test(id)) {
    return CORS.json(request, { error: 'Identificador de usuario no válido.' }, 400);
  }

  if (!ROLES_VALIDOS.includes(rol)) {
    return CORS.json(request, { error: `Rol no válido. Usa: ${ROLES_VALIDOS.join(', ')}.` }, 400);
  }

  if (id === auth.usuario.id) {
    return CORS.json(request, { error: 'No puedes cambiar tu propio rol.' }, 400);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return CORS.json(
      request,
      { error: 'La actualización de roles requiere SUPABASE_SERVICE_ROLE_KEY en el backend.' },
      503
    );
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log(`[Admin Usuarios PATCH] Verificando Service Role Key: ${serviceKey ? 'Presente (longitud: ' + serviceKey.length + ')' : 'AUSENTE'}`);

    const admin = await createAdminSupabase();

    console.log(`[Admin Usuarios PATCH] Intentando actualizar usuario: ${id} a rol: ${rol}`);

    // 1. Obtener el usuario de Auth para asegurar que existe y obtener su metadata actual
    const { data: userData, error: getError } = await admin.auth.admin.getUserById(id);
    if (getError || !userData.user) {
      console.error('[Admin Usuarios PATCH] Error obteniendo usuario de auth:', getError);
      return CORS.json(request, { error: `No se encontró el usuario en Auth: ${getError?.message || 'Error desconocido'}` }, 404);
    }

    console.log(`[Admin Usuarios PATCH] Usuario encontrado en Auth. Metadata actual:`, userData.user.user_metadata);

    const userMetadata = userData.user.user_metadata ?? {};
    const appMetadata = userData.user.app_metadata ?? {};
    const email = userData.user.email;

    if (!email) {
      console.error('[Admin Usuarios PATCH] El usuario no tiene correo en Auth.');
      return CORS.json(request, { error: 'El usuario no tiene un correo electrónico asociado en el sistema de autenticación.' }, 400);
    }

    // 2. Actualizar metadata en auth.users (fuente de verdad para RLS y JWT)
    console.log(`[Admin Usuarios PATCH] Actualizando metadata en Auth para: ${email}...`);

    // IMPORTANTE: Actualizamos app_metadata y user_metadata por separado si es necesario, 
    // pero aquí lo intentamos en una sola llamada limpia.
    const { data: authUpdateData, error: authError } = await admin.auth.admin.updateUserById(id, {
      user_metadata: { ...userMetadata, rol: rol },
      app_metadata: { ...appMetadata, rol: rol }
    });

    if (authError) {
      console.error('[Admin Usuarios PATCH] Error actualizando metadata en Auth:', authError);
      return CORS.json(request, { error: `Error en Auth: ${authError.message}` }, 500);
    }

    // 3. Actualizar la tabla pública 'usuarios' usando ID (es más seguro que el correo)
    const { data: updatedRows, error: dbError } = await admin
      .from('usuarios')
      .update({
        rol: rol,
        tipo_cuenta: rol
      })
      .eq('id', id)
      .select();

    if (dbError) {
      console.error('[Admin Usuarios PATCH] Error en UPDATE DB:', dbError);
    }

    // Si el UPDATE no encontró al usuario (raro), lo creamos
    if (!updatedRows || updatedRows.length === 0) {
      console.log(`[Admin Usuarios PATCH] Usuario no encontrado en tabla pública, creando registro para: ${email}`);
      await admin.from('usuarios').upsert(
        {
          id,
          correo: email,
          rol,
          tipo_cuenta: rol,
          nombre: userMetadata.nombre || userMetadata.full_name || 'Usuario'
        },
        { onConflict: 'id' }   // 👈 segundo argumento de opciones
      );
    }

    console.log(`[Admin Usuarios PATCH] ¡Sincronización completada para ${email}!`);
    return CORS.json(request, {
      ok: true,
      mensaje: 'Rol actualizado y sincronizado.',
      rol_confirmado: rol
    });
  } catch (err) {
    console.error('[Admin Usuarios PATCH] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
