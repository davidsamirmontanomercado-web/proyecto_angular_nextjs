import {
  cors,
  leerCuerpoJson,
  mapErrorBD,
  requireUser,
  UUID_RE
} from '@/lib/api/http';

// Columnas reales de public.mensajes_chat (10):
// id, transmision_id, remitente_id, destinatario_id, contenido,
// tipo, fecha, fijado, oculto, respondido.
// Regla de seguridad: el cliente NUNCA elige `tipo`, por lo que no puede
// enviar mensajes con los tipos restringidos ("privado", "respuesta_vendedor").
const TABLA = 'mensajes_chat';
const MAX_CONTENIDO = 1000;
const MAX_MENSAJES = 200;

const MENSAJE_SELECT = [
  'id',
  'transmision_id',
  'contenido',
  'tipo',
  'respondido',
  'remitente_id',
  'fecha'
].join(',');

const CORS = cors('GET, POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// GET /api/mensajes-chat?transmision_id=<uuid> -> mensajes del chat de una transmisión.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const transmisionId = new URL(request.url).searchParams.get('transmision_id');
  if (!transmisionId || !UUID_RE.test(transmisionId)) {
    return CORS.json(
      request,
      { error: 'El parámetro transmision_id debe ser un UUID válido.' },
      400
    );
  }

  try {
    const { data, error } = await auth.db
      .schema('public')
      .from(TABLA)
      .select(MENSAJE_SELECT)
      .eq('transmision_id', transmisionId)
      .eq('oculto', false) // ninguna política RLS cubre `oculto`
      .in('tipo', ['pregunta', 'comentario']) // excluye 'privado' y 'respuesta_vendedor'
      .order('fecha', { ascending: true })
      .limit(MAX_MENSAJES);

    if (error) {
      console.error('Error consultando mensajes de chat:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    const mensajes = data ?? [];
    return CORS.json(
      request,
      { data: mensajes, meta: { count: mensajes.length } },
      200
    );
  } catch (err) {
    console.error('Error inesperado consultando mensajes de chat:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// POST /api/mensajes-chat { transmision_id, contenido } -> enviar mensaje público.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const cuerpo = await leerCuerpoJson(request);
  const transmisionId =
    typeof cuerpo?.transmision_id === 'string' ? cuerpo.transmision_id.trim() : '';
  const contenido =
    typeof cuerpo?.contenido === 'string' ? cuerpo.contenido.trim() : '';

  if (!UUID_RE.test(transmisionId)) {
    return CORS.json(
      request,
      { error: 'El campo transmision_id debe ser un UUID válido.' },
      400
    );
  }

  if (contenido.length === 0) {
    return CORS.json(request, { error: 'El mensaje no puede estar vacío.' }, 400);
  }

  if (contenido.length > MAX_CONTENIDO) {
    return CORS.json(
      request,
      { error: `El mensaje no puede superar los ${MAX_CONTENIDO} caracteres.` },
      400
    );
  }

  try {
    // remitente_id lo fija el servidor. `tipo`, `respondido` y `fecha` no se envían.
    const { error } = await auth.db
      .schema('public')
      .from(TABLA)
      .insert({
        transmision_id: transmisionId,
        remitente_id: auth.usuario.id,
        contenido
      });

    if (error) {
      console.error('Error creando mensaje de chat:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: { contenido } }, 201);
  } catch (err) {
    console.error('Error inesperado creando mensaje de chat:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
