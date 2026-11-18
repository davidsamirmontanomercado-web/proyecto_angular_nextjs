import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import { eliminarSala, leerConfigLiveKit } from '@/lib/livekit/server';

// Transición verificada: en_vivo -> finalizada.
const ESTADO_EN_VIVO = 'en_vivo';
const ESTADO_FINALIZADA = 'finalizada';

const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// Duración en minutos, redondeada al minuto más cercano y nunca negativa.
// Devuelve null si no hay fecha de inicio fiable (p. ej. transmisión antigua
// iniciada antes de que `iniciar` fijase fecha_inicio).
function calcularDuracionMinutos(fechaInicio: string | null, fechaFin: Date): number | null {
  if (!fechaInicio) return null;
  const inicio = Date.parse(fechaInicio);
  if (Number.isNaN(inicio)) return null;
  const minutos = Math.round((fechaFin.getTime() - inicio) / 60000);
  return Math.max(0, minutos);
}

// POST /api/transmisiones/[id]/finalizar
// 1) Lee la fila propia (RLS de SELECT: transmisiones_lectura_propietario) para
//    conocer su estado y su fecha_inicio real.
// 2) Actualiza de forma condicional (RLS de UPDATE) y calcula duracion_minutos
//    sólo si fecha_inicio es fiable; si no, la deja en null.
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

  try {
    const { data: fila, error: errorLectura } = await auth.db
      .schema('public')
      .from('transmisiones')
      .select('id, estado, fecha_inicio')
      .eq('id', id)
      .eq('anfitrion_id', auth.usuario.id)
      .maybeSingle();

    if (errorLectura) {
      console.error('Error leyendo transmisión a finalizar:', errorLectura);
      const mapped = mapErrorBD(errorLectura);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if (!fila) {
      return CORS.json(
        request,
        { error: 'La transmisión no existe o no es tuya.' },
        404
      );
    }

    if (fila.estado !== ESTADO_EN_VIVO) {
      return CORS.json(
        request,
        { error: `Sólo se puede finalizar una transmisión en vivo (estado actual: ${fila.estado ?? 'desconocido'}).` },
        409
      );
    }

    const fechaFin = new Date();
    const duracionMinutos = calcularDuracionMinutos(fila.fecha_inicio, fechaFin);

    const { error, count } = await auth.db
      .schema('public')
      .from('transmisiones')
      .update(
        {
          estado: ESTADO_FINALIZADA,
          fecha_fin: fechaFin.toISOString(),
          duracion_minutos: duracionMinutos
        },
        { count: 'exact' }
      )
      .eq('id', id)
      .eq('estado', ESTADO_EN_VIVO);

    if (error) {
      console.error('Error finalizando transmisión:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if ((count ?? 0) === 0) {
      return CORS.json(
        request,
        { error: 'No se pudo finalizar: el estado cambió o la transmisión ya no está en vivo.' },
        409
      );
    }

    // La transmisión ya quedó confirmada como `finalizada` en la base de datos:
    // sólo ahora es seguro expulsar a los participantes de la sala de LiveKit.
    // Si LiveKit no está configurado o la sala ya no existe, el cierre de la
    // transmisión no debe fallar por ello.
    const config = leerConfigLiveKit();
    if (config) {
      try {
        await eliminarSala(config, id);
      } catch (err) {
        console.warn('No se pudo eliminar la sala de LiveKit al finalizar:', err);
      }
    }

    return CORS.json(
      request,
      { data: { id, estado: ESTADO_FINALIZADA, duracion_minutos: duracionMinutos } },
      200
    );
  } catch (err) {
    console.error('Error inesperado finalizando transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
