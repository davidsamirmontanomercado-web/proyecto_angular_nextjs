import {
  cors,
  leerCuerpoJson,
  mapErrorBD,
  requireUser,
  UUID_RE
} from '@/lib/api/http';

// Columnas reales verificadas en public.seguimientos:
// id, seguidor_id, seguido_id, fecha_seguimiento.
// RLS existente: seguidor_id = auth.uid() para INSERT y DELETE.
// fecha_seguimiento NO se envía: se confía en el valor por defecto de la base de datos.
const TABLA = 'seguimientos';

const CORS = cors('GET, POST, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// GET /api/seguimientos?seguido_id=<uuid> -> ¿el usuario autenticado sigue a ese usuario?
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const seguidoId = new URL(request.url).searchParams.get('seguido_id');
  if (!seguidoId || !UUID_RE.test(seguidoId)) {
    return CORS.json(
      request,
      { error: 'El parámetro seguido_id debe ser un UUID válido.' },
      400
    );
  }

  try {
    const { data, error } = await auth.db
      .schema('public')
      .from(TABLA)
      .select('id')
      .eq('seguidor_id', auth.usuario.id)
      .eq('seguido_id', seguidoId)
      .maybeSingle();

    if (error) {
      console.error('Error consultando seguimiento:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: { siguiendo: Boolean(data) } }, 200);
  } catch (err) {
    console.error('Error inesperado consultando seguimiento:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// POST /api/seguimientos { seguido_id } -> seguir (idempotente).
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const cuerpo = await leerCuerpoJson(request);
  const seguidoId =
    typeof cuerpo?.seguido_id === 'string' ? cuerpo.seguido_id.trim() : '';

  if (!UUID_RE.test(seguidoId)) {
    return CORS.json(
      request,
      { error: 'El campo seguido_id debe ser un UUID válido.' },
      400
    );
  }

  // El seguidor siempre es el usuario autenticado: nunca se acepta del cliente.
  if (seguidoId === auth.usuario.id) {
    return CORS.json(request, { error: 'No puedes seguirte a ti mismo.' }, 400);
  }

  try {
    const { error } = await auth.db
      .schema('public')
      .from(TABLA)
      .insert({ seguidor_id: auth.usuario.id, seguido_id: seguidoId });

    if (error) {
      // 23505 = ya existía: se evita el duplicado y la operación sigue siendo idempotente.
      if (error.code === '23505') {
        return CORS.json(request, { data: { siguiendo: true } }, 200);
      }
      console.error('Error creando seguimiento:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: { siguiendo: true } }, 201);
  } catch (err) {
    console.error('Error inesperado creando seguimiento:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// DELETE /api/seguimientos?seguido_id=<uuid> -> dejar de seguir (idempotente).
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const seguidoId = new URL(request.url).searchParams.get('seguido_id');
  if (!seguidoId || !UUID_RE.test(seguidoId)) {
    return CORS.json(
      request,
      { error: 'El parámetro seguido_id debe ser un UUID válido.' },
      400
    );
  }

  try {
    const { error, count } = await auth.db
      .schema('public')
      .from(TABLA)
      .delete({ count: 'exact' })
      .eq('seguidor_id', auth.usuario.id)
      .eq('seguido_id', seguidoId);

    if (error) {
      console.error('Error eliminando seguimiento:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(
      request,
      { data: { siguiendo: false, eliminado: (count ?? 0) > 0 } },
      200
    );
  } catch (err) {
    console.error('Error inesperado eliminando seguimiento:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
