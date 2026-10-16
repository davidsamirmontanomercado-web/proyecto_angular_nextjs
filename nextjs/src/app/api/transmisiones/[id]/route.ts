import {
  cors,
  leerCuerpoJson,
  mapErrorBD,
  requireUser,
  UUID_RE
} from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// Regla de negocio confirmada: sólo se consulta públicamente en vivo.
const ESTADO_EN_VIVO = 'en_vivo';

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

export function OPTIONS(request: Request) {
  return CORS.empty(request);
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

    const supabase = await createServerSupabase();

    const { data, error } = await supabase
      .schema('public')
      .from('transmisiones')
      .select(TRANSMISION_SELECT)
      .eq('id', id)
      .eq('estado', ESTADO_EN_VIVO)
      .maybeSingle();

    if (error) {
      console.error('Error fetching transmision:', error);
      return CORS.json(request, { error: 'Error interno del servidor' }, 500);
    }

    if (!data) {
      return CORS.json(request, { error: 'Transmisión no encontrada o no está en vivo' }, 404);
    }

    return CORS.json(request, { data }, 200);
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
