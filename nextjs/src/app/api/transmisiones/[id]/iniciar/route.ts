import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';

// Transición verificada: programada -> en_vivo.
const ESTADO_PROGRAMADA = 'programada';
const ESTADO_EN_VIVO = 'en_vivo';

const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// POST /api/transmisiones/[id]/iniciar
// El cambio es condicional: sólo afecta a la fila si sigue en "programada".
// Fija fecha_inicio = ahora (inicio REAL de la emisión) para que finalizar pueda
// calcular duracion_minutos de forma fiable. La propiedad la garantiza la
// política RLS de UPDATE `transmisiones_editar_propietario`.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return CORS.json(request, { error: 'Identificador de transmisión no válido' }, 400);
  }

  const fechaInicio = new Date().toISOString();

  try {
    const { error, count } = await auth.db
      .schema('public')
      .from('transmisiones')
      .update(
        { estado: ESTADO_EN_VIVO, fecha_inicio: fechaInicio },
        { count: 'exact' }
      )
      .eq('id', id)
      .eq('estado', ESTADO_PROGRAMADA);

    if (error) {
      console.error('Error iniciando transmisión:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if ((count ?? 0) === 0) {
      return CORS.json(
        request,
        { error: 'La transmisión no existe, no es tuya o no está en estado programada.' },
        409
      );
    }

    return CORS.json(request, { data: { id, estado: ESTADO_EN_VIVO } }, 200);
  } catch (err) {
    console.error('Error inesperado iniciando transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
