import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import { crearTokenSala, leerConfigLiveKit, type RolLiveKit } from '@/lib/livekit/server';
import type { User } from '@supabase/supabase-js';

// POST /api/transmisiones/[id]/token
//
// Emite un token de LiveKit para la sala identificada con el id REAL de la
// transmisión. El rol lo determina el servidor comparando el usuario autenticado
// con `transmisiones.anfitrion_id`; nunca se acepta desde el cliente.
//
// La transmisión se consulta con el cliente Supabase ligado al token del usuario
// (RLS): un espectador sólo ve filas `en_vivo` (404 si ya no lo está) y el
// propietario ve también la suya (409 si no está en vivo). Sin `service_role`.

const CORS = cors('POST, OPTIONS');
const ESTADO_EN_VIVO = 'en_vivo';

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
    // Falta configuración en el servidor: no se inventan credenciales.
    return CORS.json(
      request,
      {
        error:
          'La emisión en tiempo real no está disponible: al servidor le faltan las credenciales de LiveKit.'
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

    if (fila.estado !== ESTADO_EN_VIVO) {
      return CORS.json(
        request,
        { error: 'La transmisión no está en vivo: no se emiten tokens.' },
        409
      );
    }

    const anfitrionId = fila.anfitrion_id as string | null;
    const rol: RolLiveKit = anfitrionId === auth.usuario.id ? 'anfitrion' : 'espectador';

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
