import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/server';
import { contarParticipantes, leerConfigLiveKit } from '@/lib/livekit/server';

// GET /api/cron/cerrar-transmisiones-huerfanas
//
// Cierra transmisiones que quedaron marcadas como `en_vivo` pero cuya sala de
// LiveKit ya no tiene participantes (el anfitrión cerró el navegador, perdió la
// conexión definitivamente o se cayó el cliente sin pulsar "Finalizar").
//
// Reglas ANTES de cerrar (para no cerrar una emisión recién arrancada):
//   1. La transmisión debe llevar al menos GRACIA_MINUTOS en vivo (fecha_inicio).
//   2. La sala de LiveKit debe estar VACÍA (0 participantes) o no existir.
//
// Este endpoint es el ÚNICO sitio donde se usa la clave de servicio
// (SUPABASE_SERVICE_ROLE_KEY): debe operar sobre transmisiones de TODOS los
// usuarios, sin sesión de usuario. Está protegido por CRON_SECRET.
//
// Configuración en Vercel: ver `vercel.json` (cron cada 5 minutos).

const ESTADO_EN_VIVO = 'en_vivo';
const ESTADO_FINALIZADA = 'finalizada';
const GRACIA_MINUTOS = 3;

function autorizado(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  if (header === `Bearer ${secret}`) return true;

  // Permite una ejecución manual (p. ej. `curl "...?secret=..."`) sin exponer
  // el secreto en el cuerpo de la respuesta.
  const url = new URL(request.url);
  return url.searchParams.get('secret') === secret;
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const config = leerConfigLiveKit();
  if (!config) {
    return NextResponse.json(
      { error: 'LiveKit no está configurado: no se puede comprobar el estado de las salas.' },
      { status: 503 }
    );
  }

  try {
    const admin = await createAdminSupabase();

    const { data: transmisiones, error } = await admin
      .schema('public')
      .from('transmisiones')
      .select('id, fecha_inicio')
      .eq('estado', ESTADO_EN_VIVO);

    if (error) {
      console.error('[Cron huérfanas] Error leyendo transmisiones en vivo:', error);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }

    const ahora = Date.now();
    const cerradas: string[] = [];
    const omitidas: string[] = [];

    for (const t of transmisiones ?? []) {
      const id = String(t.id);

      const inicio = t.fecha_inicio ? Date.parse(String(t.fecha_inicio)) : NaN;
      if (Number.isNaN(inicio)) {
        omitidas.push(id);
        continue;
      }

      // 1) Gracia: no cerrar emisiones recién iniciadas.
      const minutosEnVivo = (ahora - inicio) / 60000;
      if (minutosEnVivo < GRACIA_MINUTOS) {
        omitidas.push(id);
        continue;
      }

      // 2) La sala debe estar vacía (0 participantes) o no existir.
      const participantes = await contarParticipantes(config, id);
      if (participantes !== 0 && participantes !== null) {
        omitidas.push(id);
        continue;
      }

      const { error: errorUpdate } = await admin
        .schema('public')
        .from('transmisiones')
        .update(
          {
            estado: ESTADO_FINALIZADA,
            fecha_fin: new Date().toISOString(),
            duracion_minutos: Math.max(0, Math.round(minutosEnVivo))
          }
        )
        .eq('id', id)
        .eq('estado', ESTADO_EN_VIVO);

      if (errorUpdate) {
        console.error(`[Cron huérfanas] No se pudo cerrar la transmisión ${id}:`, errorUpdate);
        continue;
      }

      cerradas.push(id);
    }

    return NextResponse.json(
      {
        data: {
          revisadas: transmisiones?.length ?? 0,
          cerradas,
          omitidas
        }
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[Cron huérfanas] Error inesperado:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
