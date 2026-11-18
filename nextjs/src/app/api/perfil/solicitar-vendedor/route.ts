import { cors, requireUser, leerCuerpoJson } from '@/lib/api/http';

const CORS = cors('POST, GET, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// El usuario consulta el estado de su solicitud o crea una nueva
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const { data, error } = await auth.db
      .from('solicitudes_vendedor')
      .select('*')
      .eq('usuario_id', auth.usuario.id)
      .order('fecha_solicitud', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return CORS.json(request, { data }, 200);
  } catch (err) {
    console.error('[Solicitud Vendedor GET] Error:', err);
    return CORS.json(request, { error: 'Error al obtener la solicitud.' }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  if (auth.usuario.user_metadata?.rol === 'vendedor') {
    return CORS.json(request, { error: 'Ya eres vendedor.' }, 400);
  }

  const body = await leerCuerpoJson(request);
  const mensaje = typeof body?.mensaje === 'string' ? body.mensaje.trim() : '';

  try {
    // Verificar si ya tiene una pendiente
    const { data: existente } = await auth.db
      .from('solicitudes_vendedor')
      .select('id')
      .eq('usuario_id', auth.usuario.id)
      .eq('estado', 'pendiente')
      .maybeSingle();

    if (existente) {
      return CORS.json(request, { error: 'Ya tienes una solicitud pendiente de revisión.' }, 400);
    }

    const { error } = await auth.db.from('solicitudes_vendedor').insert({
      usuario_id: auth.usuario.id,
      mensaje: mensaje || 'Solicitud para ser vendedor.'
    });

    if (error) throw error;
    return CORS.json(request, { message: 'Solicitud enviada correctamente.' }, 201);
  } catch (err) {
    console.error('[Solicitud Vendedor POST] Error:', err);
    return CORS.json(request, { error: 'No se pudo enviar la solicitud.' }, 500);
  }
}
