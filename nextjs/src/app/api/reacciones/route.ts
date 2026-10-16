import {
  cors,
  leerCuerpoJson,
  mapErrorBD,
  requireUser,
  UUID_RE
} from '@/lib/api/http';

// Columnas reales verificadas en public.reacciones: id, usuario_id, transmision_id, tipo, fecha.
// RLS existente: reacciones_insertar_usuario + borrado propio (usuario_id = auth.uid()).
// "(me gusta)" no es una columna: es el valor de `tipo` para un like.
const TABLA = 'reacciones';
const TIPO_ME_GUSTA = 'me_gusta';

const CORS = cors('GET, POST, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// GET /api/reacciones?transmision_id=<uuid> -> ¿el usuario autenticado dio me gusta?
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
      .select('id')
      .eq('usuario_id', auth.usuario.id)
      .eq('transmision_id', transmisionId)
      .eq('tipo', TIPO_ME_GUSTA)
      .maybeSingle();

    if (error) {
      console.error('Error consultando reacción:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: { me_gusta: Boolean(data) } }, 200);
  } catch (err) {
    console.error('Error inesperado consultando reacción:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// POST /api/reacciones { transmision_id } -> dar me gusta (idempotente).
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const cuerpo = await leerCuerpoJson(request);
  const transmisionId =
    typeof cuerpo?.transmision_id === 'string' ? cuerpo.transmision_id.trim() : '';

  if (!UUID_RE.test(transmisionId)) {
    return CORS.json(
      request,
      { error: 'El campo transmision_id debe ser un UUID válido.' },
      400
    );
  }

  try {
    // usuario_id y tipo los fija el servidor: nunca se aceptan del cliente.
    // `fecha` no se envía: se confía en el valor por defecto de la base de datos.
    const { error } = await auth.db
      .schema('public')
      .from(TABLA)
      .insert({
        usuario_id: auth.usuario.id,
        transmision_id: transmisionId,
        tipo: TIPO_ME_GUSTA
      });

    if (error) {
      // 23505 = ya existía: se evita el duplicado.
      if (error.code === '23505') {
        return CORS.json(request, { data: { me_gusta: true } }, 200);
      }
      console.error('Error creando reacción:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: { me_gusta: true } }, 201);
  } catch (err) {
    console.error('Error inesperado creando reacción:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// DELETE /api/reacciones?transmision_id=<uuid> -> retirar me gusta (idempotente).
export async function DELETE(request: Request) {
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
    const { error, count } = await auth.db
      .schema('public')
      .from(TABLA)
      .delete({ count: 'exact' })
      .eq('usuario_id', auth.usuario.id)
      .eq('transmision_id', transmisionId)
      .eq('tipo', TIPO_ME_GUSTA);

    if (error) {
      console.error('Error eliminando reacción:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(
      request,
      { data: { me_gusta: false, eliminado: (count ?? 0) > 0 } },
      200
    );
  } catch (err) {
    console.error('Error inesperado eliminando reacción:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
