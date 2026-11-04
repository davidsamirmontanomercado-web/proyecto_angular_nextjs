import type { SupabaseClient } from '@supabase/supabase-js';
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

// Vista agregada (security_invoker = false) que resume las reacciones de una
// transmisión sin debilitar la RLS de `public.reacciones`. Ver la migración
// 20261017130000_reacciones_presencia.sql.
const VISTA_RESUMEN = 'transmisiones_reacciones_publico';

const CORS = cors('GET, POST, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

type ResumenReacciones = { total: number; autores: string[] };

// Lee el resumen agregado. Si la vista aún no existe (migración pendiente) o
// falla, se degrada a 0/[] en lugar de romper el me gusta, que es lo primario.
async function leerResumen(db: SupabaseClient, transmisionId: string): Promise<ResumenReacciones> {
  try {
    const { data, error } = await db
      .schema('public')
      .from(VISTA_RESUMEN)
      .select('total,autores')
      .eq('transmision_id', transmisionId)
      .maybeSingle();

    if (error) {
      console.warn('Resumen de reacciones no disponible:', error.code ?? error.message);
      return { total: 0, autores: [] };
    }

    const total = typeof data?.total === 'number' ? data.total : 0;
    const autores = Array.isArray(data?.autores) ? (data.autores as string[]) : [];
    return { total, autores };
  } catch (err) {
    console.warn('Error inesperado leyendo el resumen de reacciones:', err);
    return { total: 0, autores: [] };
  }
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

    const resumen = await leerResumen(auth.db, transmisionId);
    return CORS.json(
      request,
      { data: { me_gusta: Boolean(data), total: resumen.total, autores: resumen.autores } },
      200
    );
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
        const resumen = await leerResumen(auth.db, transmisionId);
        return CORS.json(
          request,
          { data: { me_gusta: true, total: resumen.total, autores: resumen.autores } },
          200
        );
      }
      console.error('Error creando reacción:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    const resumen = await leerResumen(auth.db, transmisionId);
    return CORS.json(
      request,
      { data: { me_gusta: true, total: resumen.total, autores: resumen.autores } },
      201
    );
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

    const resumen = await leerResumen(auth.db, transmisionId);
    return CORS.json(
      request,
      {
        data: {
          me_gusta: false,
          eliminado: (count ?? 0) > 0,
          total: resumen.total,
          autores: resumen.autores
        }
      },
      200
    );
  } catch (err) {
    console.error('Error inesperado eliminando reacción:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
