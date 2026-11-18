import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import {
  crearTokenSala,
  leerConfigLiveKit,
  variablesLiveKitFaltantes,
  type RolLiveKit
} from '@/lib/livekit/server';
import type { User } from '@supabase/supabase-js';

// POST /api/transmisiones/[id]/token
//
// Emite un token de LiveKit para la sala identificada con el id REAL de la
// transmisión. El rol lo determina el servidor comparando el usuario autenticado
// con `transmisiones.anfitrion_id`; nunca se acepta desde el cliente.
//
// La transmisión se consulta con el cliente Supabase ligado al token del usuario
// (RLS): un espectador sólo ve filas `en_vivo` (404 si ya no lo está) y el
// propietario ve también la suya. Sin `service_role`.
//
// El propietario recibe token tanto en `programada` como en `en_vivo`: necesita
// entrar a la sala para PUBLICAR su cámara y SÓLO después marcar la transmisión
// como `en_vivo`. Así ninguna emisión aparece "EN VIVO" sin vídeo del anfitrión
// y el comprador nunca se queda esperando una pista que no existe.

const CORS = cors('POST, OPTIONS');
const ESTADO_EN_VIVO = 'en_vivo';
const ESTADO_PROGRAMADA = 'programada';

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

/** Nombre para mostrar en LiveKit (no es un dato de la base de datos). */
function nombreDe(usuario: User): string {
  const meta = usuario.user_metadata as Record<string, unknown> | undefined;
  const candidatos = [meta?.full_name, meta?.nombre, usuario.email];
  for (const valor of candidatos) {
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
  }
  return 'Participante';
}

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

  const config = leerConfigLiveKit();
  if (!config) {
    // Falta configuración en el servidor: no se inventan credenciales. Se
    // informa EXACTAMENTE qué variables faltan (sólo sus nombres, nunca sus
    // valores) para que el despliegue se pueda corregir sin adivinar.
    const faltantes = variablesLiveKitFaltantes();
    console.error(
      `[LiveKit] No se puede emitir el token: faltan variables de entorno en el servidor: ${faltantes.join(', ')}.`
    );
    return CORS.json(
      request,
      {
        error:
          'La emisión en tiempo real no está disponible: al servidor le faltan las credenciales de LiveKit.',
        variablesFaltantes: faltantes
      },
      503
    );
  }

  try {
    const { data: fila, error } = await auth.db
      .schema('public')
      .from('transmisiones')
      .select('id, estado, anfitrion_id')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Error consultando la transmisión para el token:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if (!fila) {
      // No existe o no es visible con las políticas actuales (p. ej. finalizada
      // para un espectador: la RLS pública sólo expone `en_vivo`).
      return CORS.json(
        request,
        { error: 'La transmisión no existe o ya no está disponible.' },
        404
      );
    }

    // El rol se decide SIEMPRE en el servidor a partir de `anfitrion_id`.
    const anfitrionId = fila.anfitrion_id as string | null;
    const esAnfitrion = anfitrionId !== null && anfitrionId === auth.usuario.id;

    // Un espectador sólo entra si la emisión está en vivo. El propietario además
    // puede entrar en `programada` para publicar su cámara ANTES de pasar a
    // `en_vivo` (evita anunciar una emisión sin vídeo). Nunca en estados
    // terminales (`finalizada`/`cancelada`).
    const estado = fila.estado as string | null;
    const permitido =
      estado === ESTADO_EN_VIVO || (esAnfitrion && estado === ESTADO_PROGRAMADA);
    if (!permitido) {
      return CORS.json(
        request,
        { error: 'La transmisión no está en vivo: no se emiten tokens.' },
        409
      );
    }

    const rol: RolLiveKit = esAnfitrion ? 'anfitrion' : 'espectador';

    const token = await crearTokenSala({
      config,
      sala: fila.id as string,
      // Identidad estable y única por usuario dentro de la sala.
      identidad: auth.usuario.id,
      nombre: nombreDe(auth.usuario),
      rol
    });

    return CORS.json(
      request,
      {
        data: {
          url: config.url,
          token,
          rol,
          sala: fila.id
        }
      },
      200
    );
  } catch (err) {
    console.error('Error inesperado emitiendo el token de LiveKit:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
