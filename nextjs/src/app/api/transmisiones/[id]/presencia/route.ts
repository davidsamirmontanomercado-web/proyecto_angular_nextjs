import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import type { SupabaseClient } from '@supabase/supabase-js';

// Presencia de espectadores (conteo real, sin simulación).
//
//   POST   /api/transmisiones/[id]/presencia -> latido de entrada + refresco
//   DELETE /api/transmisiones/[id]/presencia -> salir (deja de contar)
//
// Una fila por (transmision_id, usuario_id): la clave primaria compuesta evita
// el doble conteo de la misma sesión y el latido es idempotente.
// "Actuales" se calcula con un TTL de 45 s (ver migración 20261017130000), de
// modo que una salida abrupta (cerrar la pestaña) deja de contar automáticamente.
//
// El latido NO usa `upsert`: PostgREST lo traduce a
//   INSERT ... ON CONFLICT (...) DO UPDATE SET <todas las columnas del payload>
// y el rol `authenticated` sólo tiene UPDATE sobre (ultima_vez, activo), así que
// intentar escribir transmision_id/usuario_id devuelve 42501 -> HTTP 403.
// En su lugar se hace UPDATE y, sólo si no había fila propia, INSERT: se usan
// exactamente los privilegios ya concedidos (select/insert/update por columna)
// sin tocar GRANT, RLS ni el esquema.
const TABLA = 'presencia_transmision';
const VISTA_CONTEO = 'transmisiones_espectadores_publico';
const ESTADO_EN_VIVO = 'en_vivo';

const CORS = cors('POST, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

type Conteo = { actuales: number; totales: number };
type InfoTransmision = { estado: string | null; anfitrion_id: string | null };
type ErrorBD = { code?: string; message?: string };

// Traduce un error de base de datos SIN ocultarlo: si el código no está mapeado
// se registra y se responde 500 (nunca se devuelve como si hubiese funcionado).
function responderErrorBD(request: Request, error: ErrorBD, contexto: string) {
  console.error(`Error de base de datos (${contexto}):`, error);
  const mapped = mapErrorBD(error);
  return CORS.json(
    request,
    { error: mapped?.mensaje ?? 'Error interno del servidor.' },
    mapped?.status ?? 500
  );
}

// Lee el conteo agregado. Si la vista aún no existe (migración pendiente),
// devuelve null y la respuesta sale sin contadores en vez de fallar.
async function leerConteo(db: SupabaseClient, transmisionId: string): Promise<Conteo | null> {
  try {
    const { data, error } = await db
      .schema('public')
      .from(VISTA_CONTEO)
      .select('actuales,totales')
      .eq('transmision_id', transmisionId)
      .maybeSingle();

    if (error) {
      console.warn('Conteo de espectadores no disponible:', error.code ?? error.message);
      return null;
    }

    if (!data) return { actuales: 0, totales: 0 };
    return {
      actuales: typeof data.actuales === 'number' ? data.actuales : 0,
      totales: typeof data.totales === 'number' ? data.totales : 0
    };
  } catch (err) {
    console.warn('Error inesperado leyendo el conteo de espectadores:', err);
    return null;
  }
}

// Comprueba que la transmisión existe y en qué estado está.
// RLS: el público sólo ve filas `en_vivo`; el propietario ve las suyas en
// cualquier estado. Por eso `fila === null` significa "no existe o ya no está
// en vivo" para quien no es el anfitrión.
async function leerTransmision(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .schema('public')
    .from('transmisiones')
    .select('estado,anfitrion_id')
    .eq('id', id)
    .maybeSingle();

  return {
    fila: (data as unknown as InfoTransmision | null) ?? null,
    error: (error as ErrorBD | null) ?? null
  };
}

// POST -> entrar / latir. Marca la sesión como activa y renueva `ultima_vez`.
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
    const { fila, error } = await leerTransmision(auth.db, id);
    if (error) return responderErrorBD(request, error, 'leyendo la transmisión');

    // Sólo se registra presencia en transmisiones EN VIVO: una transmisión
    // finalizada (o inexistente) no admite nuevos espectadores.
    if (!fila || fila.estado !== ESTADO_EN_VIVO) {
      return CORS.json(
        request,
        { error: 'La transmisión no existe o ya no está en vivo.' },
        409
      );
    }

    // El anfitrión no es espectador de su propia emisión.
    if (fila.anfitrion_id === auth.usuario.id) {
      const conteo = await leerConteo(auth.db, id);
      return CORS.json(request, { data: conteo ?? {} }, 200);
    }

    const ahora = new Date().toISOString();

    // 1) Latido: si ya existe la fila propia, sólo se refresca.
    const { data: actualizadas, error: errorUpdate } = await auth.db
      .schema('public')
      .from(TABLA)
      .update({ activo: true, ultima_vez: ahora })
      .eq('transmision_id', id)
      .eq('usuario_id', auth.usuario.id)
      .select('usuario_id');

    if (errorUpdate) {
      return responderErrorBD(request, errorUpdate, 'refrescando la presencia');
    }

    // 2) Primera entrada de este usuario: se inserta su fila.
    if ((actualizadas?.length ?? 0) === 0) {
      const { error: errorInsert } = await auth.db
        .schema('public')
        .from(TABLA)
        .insert({
          transmision_id: id,
          usuario_id: auth.usuario.id,
          ultima_vez: ahora,
          activo: true
        });

      // 23505 = otra petición concurrente insertó el latido entre el UPDATE y el
      // INSERT. La fila propia ya existe y está activa: el latido queda aplicado.
      // Cualquier otro error sí se propaga (no se convierte en éxito).
      if (errorInsert && errorInsert.code !== '23505') {
        return responderErrorBD(request, errorInsert, 'registrando la presencia');
      }
    }

    const conteo = await leerConteo(auth.db, id);
    return CORS.json(request, { data: conteo ?? {} }, 200);
  } catch (err) {
    console.error('Error inesperado registrando presencia:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// DELETE -> salir. Deja de contar de inmediato sin perder el total histórico.
export async function DELETE(
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
    // No se exige que la transmisión siga `en_vivo`: al finalizarla, el detalle
    // deja de ser visible para el espectador (RLS) y aun así hay que poder
    // liberar su propia presencia. La política `presencia_salida_propia`
    // (using/with check usuario_id = auth.uid()) limita el UPDATE a la fila
    // propia; si no existe fila, la operación es inocua (0 filas, no es error).
    const { error } = await auth.db
      .schema('public')
      .from(TABLA)
      .update({ activo: false, ultima_vez: new Date().toISOString() })
      .eq('transmision_id', id)
      .eq('usuario_id', auth.usuario.id);

    if (error) return responderErrorBD(request, error, 'marcando la salida');

    const conteo = await leerConteo(auth.db, id);
    return CORS.json(request, { data: conteo ?? {} }, 200);
  } catch (err) {
    console.error('Error inesperado marcando salida de presencia:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
