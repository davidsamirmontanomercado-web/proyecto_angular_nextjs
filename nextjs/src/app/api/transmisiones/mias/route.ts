import { cors, mapErrorBD, requireUser } from '@/lib/api/http';
import type { SupabaseClient } from '@supabase/supabase-js';

// GET /api/transmisiones/mias -> lista TODAS las transmisiones del usuario
// autenticado, en cualquier estado (incluidas las 'programada'), para que pueda
// gestionarlas (iniciar / editar / finalizar).
//
// La fila estática `mias` tiene prioridad sobre el segmento dinámico `[id]` en
// el App Router de Next, así que /api/transmisiones/mias no colisiona con
// /api/transmisiones/<uuid>.

// Únicos valores verificados de transmisiones.estado.
const ESTADOS = ['programada', 'en_vivo', 'finalizada'] as const;
type Estado = (typeof ESTADOS)[number];

// Proyección del propietario: añade las columnas de ciclo de vida (que `anon`
// no puede leer) pero NO anfitrion_id, empresa_id ni url_stream.
// Requiere los GRANT por columnas a `authenticated` de la migración
// supabase/migrations/20261015130000_transmisiones_flujo_propietario.sql.
const MIS_TRANSMISIONES_SELECT = [
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
  'fecha_fin',
  'duracion_minutos',
  'ubicacion',
  'fecha_creacion',
  'fecha_actualizacion',
  'categoria_id',
  'categoria:categorias(id,nombre,slug,icono)'
].join(',');

const CORS = cors('GET, OPTIONS');

// Vista agregada de presencia (security_invoker = false) con los contadores
// REALES: las columnas `espectadores_actuales`/`espectadores_totales` de la
// tabla son heredadas y no las actualiza nadie. Ver la migración
// supabase/migrations/20261017130000_reacciones_presencia.sql.
const VISTA_CONTEO = 'transmisiones_espectadores_publico';

type FilaTransmision = { id: string; espectadores_actuales?: number | null; espectadores_totales?: number | null };

// Sustituye los contadores heredados por los de la vista de presencia.
// Si la vista aún no existe (migración pendiente), devuelve las filas intactas.
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
      return c ? { ...f, espectadores_actuales: c.actuales, espectadores_totales: c.totales } : f;
    });
  } catch {
    return filas;
  }
}

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { searchParams } = new URL(request.url);
  const estado = searchParams.get('estado');

  if (estado !== null && !ESTADOS.includes(estado as Estado)) {
    return CORS.json(
      request,
      { error: `El parámetro estado debe ser uno de: ${ESTADOS.join(', ')}.` },
      400
    );
  }

  try {
    let query = auth.db
      .schema('public')
      .from('transmisiones')
      .select(MIS_TRANSMISIONES_SELECT)
      .eq('anfitrion_id', auth.usuario.id)
      .order('fecha_creacion', { ascending: false });

    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;

    if (error) {
      console.error('Error listando mis transmisiones:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    const transmisiones = await conConteoDeEspectadores(
      auth.db,
      (data ?? []) as unknown as FilaTransmision[]
    );
    return CORS.json(
      request,
      { data: transmisiones, meta: { count: transmisiones.length } },
      200
    );
  } catch (err) {
    console.error('Error inesperado listando mis transmisiones:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
