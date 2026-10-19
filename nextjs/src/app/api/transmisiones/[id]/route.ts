import {
  cors,
  leerCuerpoJson,
  mapErrorBD,
  requireUser,
  UUID_RE
} from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// El DETALLE debe servirle también al ANFITRIÓN antes de iniciar (estado
// 'programada'), para que pueda preparar y arrancar su emisión. El filtro por
// estado lo aplica la RLS: el público sólo ve filas `en_vivo`; el propietario ve
// las suyas en cualquier estado (política `transmisiones_lectura_propietario`).

// Vistas agregadas (security_invoker = false). Ver
// supabase/migrations/20261017130000_reacciones_presencia.sql
const VISTA_CONTEO = 'transmisiones_espectadores_publico';
const VISTA_REACCIONES = 'transmisiones_reacciones_publico';

const MAX = {
  titulo: 200,
  descripcion: 2000,
  subcategoria: 100,
  imagen_portada: 2000,
  ubicacion: 200
} as const;

// Misma proyección pública que el listado (ver ../route.ts).
const TRANSMISION_SELECT = [
  'id',
  'titulo',
  'descripcion',
  'estado',
  'subcategoria',
  'imagen_portada',
  'destacada',
  'espectadores_actuales',
  'espectadores_totales',
  'fecha_inicio',
  'categoria_id',
  'categoria:categorias(id,nombre,slug,icono)'
].join(',');

const CORS = cors('GET, PATCH, OPTIONS');

type FilaTransmision = Record<string, unknown> & {
  espectadores_actuales?: number | null;
  espectadores_totales?: number | null;
};

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// Lee el conteo agregado de espectadores. Si la vista no existe todavía
// (migración pendiente), devuelve null y se conservan los valores de la tabla.
async function leerEspectadores(db: SupabaseClient, id: string) {
  try {
    const { data, error } = await db
      .schema('public')
      .from(VISTA_CONTEO)
      .select('actuales,totales')
      .eq('transmision_id', id)
      .maybeSingle();

    if (error) return null;
    if (!data) return { actuales: 0, totales: 0 };
    return {
      actuales: typeof data.actuales === 'number' ? data.actuales : 0,
      totales: typeof data.totales === 'number' ? data.totales : 0
    };
  } catch {
    return null;
  }
}

// Lee el resumen agregado de reacciones. `autores` sólo está concedido a
// `authenticated`: para una petición sin sesión se pide únicamente `total`
// (si se pidiera `autores`, Postgres devolvería 42501 y se perdería también el
// contador, que sí es público).
async function leerReacciones(db: SupabaseClient, id: string, conAutores: boolean) {
  try {
    const base = db.schema('public').from(VISTA_REACCIONES);

    const { data, error } = conAutores
      ? await base.select('total,autores').eq('transmision_id', id).maybeSingle()
      : await base.select('total').eq('transmision_id', id).maybeSingle();

    if (error) return null;
    if (!data) return { total: 0, autores: [] as string[] };

    const fila = data as unknown as { total?: unknown; autores?: unknown };
    return {
      total: typeof fila.total === 'number' ? fila.total : 0,
      autores:
        conAutores && Array.isArray(fila.autores) ? (fila.autores as string[]) : []
    };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !UUID_RE.test(id)) {
      return CORS.json(request, { error: 'Identificador de transmisión no válido' }, 400);
    }

    // Con Bearer válido se usa el cliente del usuario: así la RLS permite al
    // ANFITRIÓN leer SU transmisión en cualquier estado ('programada' incluida).
    // Sin token (o token inválido) se cae al cliente público, que sólo ve las
    // transmisiones en vivo.
    const auth = await requireUser(request);
    const db: SupabaseClient = auth.ok ? auth.db : await createServerSupabase();

    const { data, error } = await db
      .schema('public')
      .from('transmisiones')
      .select(TRANSMISION_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching transmision:', error);
      return CORS.json(request, { error: 'Error interno del servidor' }, 500);
    }

    const fila = data as unknown as FilaTransmision | null;

    if (!fila) {
      return CORS.json(
        request,
        { error: 'Transmisión no encontrada, no está en vivo o no es tuya' },
        404
      );
    }

    // Contadores reales (vistas agregadas). Si aún no existen, no se rompe.
    // `auth.ok` decide si se piden los nombres de quienes reaccionaron.
    const [espectadores, reacciones] = await Promise.all([
      leerEspectadores(db, id),
      leerReacciones(db, id, auth.ok)
    ]);

    return CORS.json(
      request,
      {
        data: {
          ...fila,
          espectadores_actuales: espectadores
            ? espectadores.actuales
            : fila.espectadores_actuales,
          espectadores_totales: espectadores
            ? espectadores.totales
            : fila.espectadores_totales,
          reacciones_total: reacciones ? reacciones.total : 0,
          reacciones_autores: reacciones ? reacciones.autores : []
        }
      },
      200
    );
  } catch (err) {
    console.error('Unexpected error fetching transmision:', err);
    return CORS.json(request, { error: 'Error interno del servidor' }, 500);
  }
}

// PATCH /api/transmisiones/[id] -> actualizar campos editables.
// La API no filtra por anfitrion_id por privacidad; la propiedad de la fila la
// garantiza la política RLS de UPDATE `transmisiones_editar_propietario`
// (using/with check anfitrion_id = auth.uid()). Por eso `count = 0` significa
// "no existe o no es tuya".
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return CORS.json(request, { error: 'Identificador de transmisión no válido' }, 400);
  }

  const cuerpo = await leerCuerpoJson(request);
  if (!cuerpo) {
    return CORS.json(request, { error: 'El cuerpo de la petición debe ser un JSON válido.' }, 400);
  }

  const cambios: Record<string, unknown> = {};

  if (cuerpo.titulo !== undefined) {
    const titulo = typeof cuerpo.titulo === 'string' ? cuerpo.titulo.trim() : '';
    if (titulo.length === 0 || titulo.length > MAX.titulo) {
      return CORS.json(
        request,
        { error: `El campo titulo no puede estar vacío ni superar ${MAX.titulo} caracteres.` },
        400
      );
    }
    cambios.titulo = titulo;
  }

  const camposDeTexto: Array<[keyof typeof MAX, number]> = [
    ['descripcion', MAX.descripcion],
    ['subcategoria', MAX.subcategoria],
    ['imagen_portada', MAX.imagen_portada],
    ['ubicacion', MAX.ubicacion]
  ];

  for (const [campo, max] of camposDeTexto) {
    const valor = cuerpo[campo];
    if (valor === undefined) continue;
    if (valor === null) {
      cambios[campo] = null;
      continue;
    }
    if (typeof valor !== 'string') {
      return CORS.json(request, { error: `El campo ${campo} debe ser texto.` }, 400);
    }
    const texto = valor.trim();
    if (texto.length > max) {
      return CORS.json(
        request,
        { error: `El campo ${campo} no puede superar ${max} caracteres.` },
        400
      );
    }
    cambios[campo] = texto.length === 0 ? null : texto;
  }

  if (cuerpo.categoria_id !== undefined) {
    // categoria_id es NOT NULL (FK a categorias.id): no se permite ponerlo a null.
    if (typeof cuerpo.categoria_id !== 'string' || !UUID_RE.test(cuerpo.categoria_id)) {
      return CORS.json(request, { error: 'El campo categoria_id debe ser un UUID válido.' }, 400);
    }
    cambios.categoria_id = cuerpo.categoria_id;
  }

  // fecha_inicio NO se edita aquí: la fija el servidor al iniciar la transmisión
  // para que duracion_minutos no pueda manipularse desde el cliente.

  if (cuerpo.destacada !== undefined) {
    if (cuerpo.destacada !== null && typeof cuerpo.destacada !== 'boolean') {
      return CORS.json(request, { error: 'El campo destacada debe ser booleano.' }, 400);
    }
    cambios.destacada = cuerpo.destacada;
  }

  if (Object.keys(cambios).length === 0) {
    return CORS.json(request, { error: 'No se envió ningún campo editable.' }, 400);
  }

  try {
    const { error, count } = await auth.db
      .schema('public')
      .from('transmisiones')
      .update(cambios, { count: 'exact' })
      .eq('id', id);

    if (error) {
      console.error('Error actualizando transmisión:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if ((count ?? 0) === 0) {
      return CORS.json(
        request,
        { error: 'Transmisión no encontrada o sin permisos para editarla.' },
        404
      );
    }

    return CORS.json(request, { data: { id } }, 200);
  } catch (err) {
    console.error('Error inesperado actualizando transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
