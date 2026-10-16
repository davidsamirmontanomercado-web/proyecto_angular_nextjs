import { cors, mapErrorBD, UUID_RE } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

// GET /api/transmisiones/[id]/anfitrion
// Devuelve la información PÚBLICA mínima del anfitrión (nombre comercial, logo y
// nombre visible). NUNCA expone anfitrion_id, empresa_id, correos ni url_stream.
//
// Se apoya en la vista `public.transmisiones_anfitrion_publico`, que ejecuta con
// privilegios de su propietario y ya filtra `estado = 'en_vivo'` y una lista
// explícita de columnas. Si la vista no existe todavía (migración pendiente),
// se devuelve 503 con un mensaje claro en lugar de un error opaco.
const VISTA_ANFITRION = 'transmisiones_anfitrion_publico';
const ANFITRION_SELECT = ['transmision_id', 'nombre_empresa', 'logo', 'anfitrion_nombre'].join(',');

const CORS = cors('GET, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return CORS.json(request, { error: 'Identificador de transmisión no válido' }, 400);
  }

  try {
    const supabase = await createServerSupabase();

    const { data, error } = await supabase
      .schema('public')
      .from(VISTA_ANFITRION)
      .select(ANFITRION_SELECT)
      .eq('transmision_id', id)
      .maybeSingle();

    if (error) {
      console.error('Error consultando anfitrión público:', error);

      // 42P01 = undefined_table: la vista aún no se ha creado (migración pendiente).
      if (error.code === '42P01') {
        return CORS.json(
          request,
          { error: 'La información pública del anfitrión no está disponible todavía.' },
          503
        );
      }

      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    // Puede no haber fila (transmisión no en vivo o sin perfil de empresa).
    return CORS.json(request, { data: data ?? null }, 200);
  } catch (err) {
    console.error('Error inesperado consultando anfitrión público:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
