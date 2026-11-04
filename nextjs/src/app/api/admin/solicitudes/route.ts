import { cors, requireUser, requireRole, leerCuerpoJson, UUID_RE } from '@/lib/api/http';
import { createAdminSupabase } from '@/lib/supabase/server';

const CORS = cors('GET, PATCH, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// Listar solicitudes pendientes para el admin
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const permiso = await requireRole(auth, ['administrador']);
  if (!permiso.ok) return CORS.json(request, { error: permiso.mensaje }, permiso.status);

  try {
    const { data, error } = await auth.db
      .from('solicitudes_vendedor')
      .select('*, usuarios(nombre, correo)')
      .eq('estado', 'pendiente')
      .order('fecha_solicitud', { ascending: true });

    if (error) throw error;
    return CORS.json(request, { data }, 200);
  } catch (err) {
    console.error('[Admin Solicitudes GET] Error:', err);
    return CORS.json(request, { error: 'Error al listar solicitudes.' }, 500);
  }
}

// Aprobar o rechazar solicitud
export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const permiso = await requireRole(auth, ['administrador']);
  if (!permiso.ok) return CORS.json(request, { error: permiso.mensaje }, permiso.status);

  const body = await leerCuerpoJson(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  const accion = body?.accion; // 'aprobar' o 'rechazar'

  if (!UUID_RE.test(id)) {
    return CORS.json(request, { error: 'ID de solicitud inválido.' }, 400);
  }

  try {
    const admin = await createAdminSupabase();

    // 1. Obtener la solicitud para saber el usuario_id
    const { data: solicitud, error: getErr } = await admin
      .from('solicitudes_vendedor')
      .select('usuario_id')
      .eq('id', id)
      .maybeSingle();

    if (getErr || !solicitud) {
      return CORS.json(request, { error: 'Solicitud no encontrada.' }, 404);
    }

    const nuevoEstado = accion === 'aprobar' ? 'aprobada' : 'rechazada';
    
    // 2. Actualizar la solicitud
    const { error: updErr } = await admin
      .from('solicitudes_vendedor')
      .update({ 
        estado: nuevoEstado, 
        fecha_resolucion: new Date().toISOString() 
      })
      .eq('id', id);

    if (updErr) throw updErr;

    // 3. Si se aprueba, cambiar el rol del usuario
    if (accion === 'aprobar') {
      const usuarioId = solicitud.usuario_id;
      
      // Actualizar tabla usuarios
      await admin.from('usuarios').update({ rol: 'vendedor', tipo_cuenta: 'vendedor' }).eq('id', usuarioId);
      
      // Crear perfil empresarial si no existe
      await admin.from('perfiles_empresariales').upsert({ usuario_id: usuarioId });

      // Actualizar metadata de Auth
      const { data: userObj } = await admin.auth.admin.getUserById(usuarioId);
      const metadata = userObj?.user?.user_metadata ?? {};
      await admin.auth.admin.updateUserById(usuarioId, {
        user_metadata: { ...metadata, rol: 'vendedor' }
      });
    }

    return CORS.json(request, { message: `Solicitud ${nuevoEstado} correctamente.` }, 200);
  } catch (err) {
    console.error('[Admin Solicitudes PATCH] Error:', err);
    return CORS.json(request, { error: 'Error al procesar la solicitud.' }, 500);
  }
}
