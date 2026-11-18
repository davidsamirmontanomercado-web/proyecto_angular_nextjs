import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import { eliminarSala, leerConfigLiveKit } from '@/lib/livekit/server';

// Transición verificada: (programada | en_vivo) -> cancelada.
const ESTADOS_CANCELABLES = ['programada', 'en_vivo'];
const ESTADO_CANCELADA = 'cancelada';

const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

// POST /api/transmisiones/[id]/cancelar
// El ANFITRIÓN cancela su transmisión antes de finalizarla. Si estaba en vivo,
// se cierra también la sala de LiveKit. La propiedad la garantiza la política
// RLS de UPDATE `transmisiones_editar_propietario`.
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
      .select('id, estado')
      .eq('id', id)
      .eq('anfitrion_id', auth.usuario.id)
      .maybeSingle();

    if (errorLectura) {
      console.error('Error leyendo transmisión a cancelar:', errorLectura);
      const mapped = mapErrorBD(errorLectura);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if (!fila) {
      return CORS.json(request, { error: 'La transmisión no existe o no es tuya.' }, 404);
    }

    const estadoActual = String(fila.estado ?? '');
    if (!ESTADOS_CANCELABLES.includes(estadoActual)) {
      return CORS.json(
        request,
        {
          error: `Sólo se puede cancelar una transmisión programada o en vivo (estado actual: ${estadoActual || 'desconocido'}).`
        },
        409
      );
    }

    const estabaEnVivo = estadoActual === 'en_vivo';

    const { error, count } = await auth.db
      .schema('public')
      .from('transmisiones')
      .update(
        { estado: ESTADO_CANCELADA, fecha_fin: new Date().toISOString() },
        { count: 'exact' }
      )
      .eq('id', id)
      .eq('estado', estadoActual);

    if (error) {
      console.error('Error cancelando transmisión:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if ((count ?? 0) === 0) {
      return CORS.json(
        request,
        { error: 'No se pudo cancelar: el estado cambió mientras se procesaba.' },
        409
      );
    }

    // Sólo tras confirmar el estado en la base de datos se cierra la sala.
    // Si LiveKit no está configurado o la sala ya no existe, la cancelación no
    // debe fallar por ello.
    if (estabaEnVivo) {
      const config = leerConfigLiveKit();
      if (config) {
        try {
          await eliminarSala(config, id);
        } catch (err) {
          console.warn('No se pudo eliminar la sala de LiveKit al cancelar:', err);
        }
      }
    }

    return CORS.json(request, { data: { id, estado: ESTADO_CANCELADA } }, 200);
  } catch (err) {
    console.error('Error inesperado cancelando transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
