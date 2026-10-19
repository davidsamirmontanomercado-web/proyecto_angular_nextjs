import {
  cors,
  leerCuerpoJson,
  mapErrorBD,
  requireUser,
  UUID_RE
} from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// Regla de negocio confirmada: /envivos sólo muestra transmisiones en vivo.
// Valores reales verificados en public.transmisiones.estado.
const ESTADO_EN_VIVO = 'en_vivo';
const ESTADO_PROGRAMADA = 'programada';

// Valores permitidos de public.transmisiones.linea_negocio (NOT NULL, sin default).
// La base de datos guarda el slug; el formulario muestra la etiqueta legible.
const LINEAS_NEGOCIO = ['ventas_nuevos', 'produccion', 'usados'] as const;
type LineaNegocio = (typeof LINEAS_NEGOCIO)[number];

// Título y longitudes máximas aceptadas al crear/editar.
const MAX = {
  titulo: 200,
  descripcion: 2000,
  subcategoria: 100,
  imagen_portada: 2000,
  ubicacion: 200
} as const;

// Proyección pública mínima para /envivos. Debe coincidir con el GRANT por
// columnas de la migración supabase/migrations/20261015120000_transmisiones_public_read.sql.
// No incluye columnas sensibles (p. ej. url_stream) que no necesita el listado.
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

const CORS = cors('GET, POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// Vista agregada de presencia (security_invoker = false).
const VISTA_CONTEO = 'transmisiones_espectadores_publico';

type FilaTransmision = { id: string; espectadores_actuales?: number | null; espectadores_totales?: number | null };

// Fusiona los contadores reales de espectadores en las filas del listado.
// Si la vista no existe todavía, devuelve las filas sin cambios.
async function conConteoDeEspectadores(
  supabase: SupabaseClient,
  filas: FilaTransmision[]
): Promise<FilaTransmision[]> {
  if (filas.length === 0) return filas;

  try {
    const { data: conteos, error } = await supabase
      .schema('public')
      .from(VISTA_CONTEO)
      .select('transmision_id,actuales,totales')
      .in(
        'transmision_id',
        filas.map((f) => f.id)
      );

    if (error || !conteos) return filas;

    const mapa = new Map<string, { actuales: number; totales: number }>();
    for (const c of conteos as Array<{ transmision_id: string; actuales: number; totales: number }>) {
      mapa.set(c.transmision_id, { actuales: c.actuales ?? 0, totales: c.totales ?? 0 });
    }

    return filas.map((f) => {
      const c = mapa.get(f.id);
      if (!c) return f;
      return { ...f, espectadores_actuales: c.actuales, espectadores_totales: c.totales };
    });
  } catch {
    return filas;
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabase();
    const { searchParams } = new URL(request.url);
    const categoriaId = searchParams.get('categoria_id');
    const subcategoria = searchParams.get('subcategoria');
    const titulo = searchParams.get('titulo');
    const destacada = searchParams.get('destacada');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 100) : null;

    let query = supabase
      .schema('public')
      .from('transmisiones')
      .select(TRANSMISION_SELECT)
      .eq('estado', ESTADO_EN_VIVO)
      .order('destacada', { ascending: false })
      .order('fecha_inicio', { ascending: false, nullsFirst: false });

    if (categoriaId) query = query.eq('categoria_id', categoriaId);
    if (subcategoria) query = query.eq('subcategoria', subcategoria);
    if (titulo) query = query.ilike('titulo', `%${titulo}%`);
    if (destacada === 'true') query = query.eq('destacada', true);
    if (destacada === 'false') query = query.eq('destacada', false);
    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching transmisiones:', error);
      return CORS.json(request, { error: 'Error interno del servidor' }, 500);
    }

    // Contadores reales de espectadores (vista agregada). Si la vista aún no
    // existe (migración pendiente), se devuelven los valores de la tabla sin
    // romper la respuesta.
    const filas = (data ?? []) as unknown as FilaTransmision[];
    const transmisiones = await conConteoDeEspectadores(supabase, filas);

    return CORS.json(
      request,
      { data: transmisiones, meta: { count: transmisiones.length } },
      200
    );
  } catch (err) {
    console.error('Unexpected error fetching transmisiones:', err);
    return CORS.json(request, { error: 'Error interno del servidor' }, 500);
  }
}

// POST /api/transmisiones -> crear una transmisión programada del usuario autenticado.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const cuerpo = await leerCuerpoJson(request);
  if (!cuerpo) {
    return CORS.json(request, { error: 'El cuerpo de la petición debe ser un JSON válido.' }, 400);
  }

  const titulo = typeof cuerpo.titulo === 'string' ? cuerpo.titulo.trim() : '';
  if (titulo.length === 0 || titulo.length > MAX.titulo) {
    return CORS.json(
      request,
      { error: `El campo titulo es obligatorio y no puede superar ${MAX.titulo} caracteres.` },
      400
    );
  }

  // linea_negocio es NOT NULL y sin default: se valida contra el conjunto permitido.
  const lineaNegocio =
    typeof cuerpo.linea_negocio === 'string' ? cuerpo.linea_negocio.trim() : '';
  if (!LINEAS_NEGOCIO.includes(lineaNegocio as LineaNegocio)) {
    return CORS.json(
      request,
      { error: `El campo linea_negocio es obligatorio y debe ser uno de: ${LINEAS_NEGOCIO.join(', ')}.` },
      400
    );
  }

  // categoria_id es NOT NULL (FK a categorias.id): también es obligatorio.
  if (typeof cuerpo.categoria_id !== 'string' || !UUID_RE.test(cuerpo.categoria_id)) {
    return CORS.json(
      request,
      { error: 'El campo categoria_id es obligatorio y debe ser un UUID válido.' },
      400
    );
  }

  // id, anfitrion_id y estado los fija el servidor: nunca se aceptan del cliente.
  // `empresa_id` NO se envía: al ser una columna nullable, la base de datos
  // aplica NULL por defecto, de modo que tampoco hace falta privilegio INSERT
  // sobre ella (la asociación usuario -> empresa todavía no está resuelta).
  const valores: Record<string, unknown> = {
    id: crypto.randomUUID(),
    anfitrion_id: auth.usuario.id,
    estado: ESTADO_PROGRAMADA,
    titulo,
    linea_negocio: lineaNegocio,
    categoria_id: cuerpo.categoria_id
  };

  const camposDeTexto: Array<[keyof typeof MAX, number]> = [
    ['descripcion', MAX.descripcion],
    ['subcategoria', MAX.subcategoria],
    ['imagen_portada', MAX.imagen_portada],
    ['ubicacion', MAX.ubicacion]
  ];

  for (const [campo, max] of camposDeTexto) {
    const valor = cuerpo[campo];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'string') {
      return CORS.json(request, { error: `El campo ${campo} debe ser texto.` }, 400);
    }
    const texto = valor.trim();
    if (texto.length === 0) continue;
    if (texto.length > max) {
      return CORS.json(
        request,
        { error: `El campo ${campo} no puede superar ${max} caracteres.` },
        400
      );
    }
    valores[campo] = texto;
  }

  // fecha_inicio NO se acepta al crear: la fija el servidor al iniciar la
  // transmisión, de modo que duracion_minutos se calcula sobre el inicio real.
  if (cuerpo.destacada !== undefined && cuerpo.destacada !== null) {
    if (typeof cuerpo.destacada !== 'boolean') {
      return CORS.json(request, { error: 'El campo destacada debe ser booleano.' }, 400);
    }
    valores.destacada = cuerpo.destacada;
  }

  try {
    const { error } = await auth.db.schema('public').from('transmisiones').insert(valores);

    if (error) {
      console.error('Error creando transmisión:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(
      request,
      { data: { id: valores.id, estado: ESTADO_PROGRAMADA } },
      201
    );
  } catch (err) {
    console.error('Error inesperado creando transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
