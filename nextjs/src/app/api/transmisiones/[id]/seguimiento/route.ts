import { cors, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import type { SupabaseClient } from '@supabase/supabase-js';

// Seguimiento del anfitrión resuelto a partir de la transmisión.
//
// Motivo: `anfitrion_id` es un dato interno que NO se expone al cliente. Por eso
// el seguimiento se opera desde el servidor, que resuelve el anfitrión de la
// transmisión y usa la identidad del usuario autenticado:
//   GET    /api/transmisiones/[id]/seguimiento -> estado actual
//   POST   /api/transmisiones/[id]/seguimiento -> seguir
//   DELETE /api/transmisiones/[id]/seguimiento -> dejar de seguir
//
// La tabla real es `seguimientos` (seguidor_id, seguido_id, fecha_seguimiento).
// No se inventan columnas ni se usa service_role: todas las escrituras van con
// el cliente ligado al token del usuario (RLS).

const TABLA = 'seguimientos';
const CORS = cors('GET, POST, DELETE, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

type Resolucion =
  | { ok: true; anfitrionId: string }
  | { ok: false; status: number; mensaje: string };

// Resuelve el anfitrión de una transmisión en vivo visible para el usuario.
// La RLS pública permite leer filas `en_vivo`; el GRANT por columnas concede
// SELECT de `anfitrion_id` a `authenticated`.
async function resolverAnfitrion(db: SupabaseClient, id: string): Promise<Resolucion> {
  const { data, error } = await db
    .schema('public')
    .from('transmisiones')
    .select('anfitrion_id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    const mapped = mapErrorBD(error);
    return { ok: false, status: mapped!.status, mensaje: mapped!.mensaje };
  }

  if (!data?.anfitrion_id) {
    return { ok: false, status: 404, mensaje: 'La transmisión no existe o no está en vivo.' };
  }

  return { ok: true, anfitrionId: data.anfitrion_id as string };
}

// GET -> ¿el usuario autenticado sigue al anfitrión de esta transmisión?
export async function GET(
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
    const host = await resolverAnfitrion(auth.db, id);
    if (!host.ok) return CORS.json(request, { error: host.mensaje }, host.status);

    // El propietario no puede (ni necesita) seguirse a sí mismo.
    if (host.anfitrionId === auth.usuario.id) {
      return CORS.json(
        request,
        { data: { siguiendo: false, esPropietario: true } },
        200
      );
    }

    const { data, error } = await auth.db
      .schema('public')
      .from(TABLA)
      .select('id')
      .eq('seguidor_id', auth.usuario.id)
      .eq('seguido_id', host.anfitrionId)
      .maybeSingle();

    if (error) {
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(
      request,
      { data: { siguiendo: Boolean(data), esPropietario: false } },
      200
    );
  } catch (err) {
    console.error('Error inesperado consultando seguimiento de transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// POST -> seguir al anfitrión (idempotente).
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
    const host = await resolverAnfitrion(auth.db, id);
    if (!host.ok) return CORS.json(request, { error: host.mensaje }, host.status);

    if (host.anfitrionId === auth.usuario.id) {
      return CORS.json(request, { error: 'No puedes seguirte a ti mismo.' }, 400);
    }

    const { error } = await auth.db
      .schema('public')
      .from(TABLA)
      .insert({ seguidor_id: auth.usuario.id, seguido_id: host.anfitrionId });

    if (error) {
      // 23505 = ya lo seguía: idempotente.
      if (error.code === '23505') {
        return CORS.json(request, { data: { siguiendo: true, esPropietario: false } }, 200);
      }
      console.error('Error creando seguimiento:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: { siguiendo: true, esPropietario: false } }, 201);
  } catch (err) {
    console.error('Error inesperado creando seguimiento:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// DELETE -> dejar de seguir al anfitrión (idempotente).
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
    const host = await resolverAnfitrion(auth.db, id);
    if (!host.ok) return CORS.json(request, { error: host.mensaje }, host.status);

    const { error, count } = await auth.db
      .schema('public')
      .from(TABLA)
      .delete({ count: 'exact' })
      .eq('seguidor_id', auth.usuario.id)
      .eq('seguido_id', host.anfitrionId);

    if (error) {
      console.error('Error eliminando seguimiento:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(
      request,
      { data: { siguiendo: false, esPropietario: false, eliminado: (count ?? 0) > 0 } },
      200
    );
  } catch (err) {
    console.error('Error inesperado eliminando seguimiento:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
