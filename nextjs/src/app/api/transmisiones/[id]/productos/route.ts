import { cors, leerCuerpoJson, mapErrorBD, requireUser, UUID_RE } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// Productos promocionados de una transmisión (Live Commerce).
//
//   GET  /api/transmisiones/[id]/productos  -> lista pública (sólo productos de
//        transmisiones `en_vivo`, o los de la propia transmisión del anfitrión).
//   PUT  /api/transmisiones/[id]/productos  -> el ANFITRIÓN reemplaza la lista.
//
// La lectura usa la vista `public.transmision_productos_publico`
// (security_invoker = false; ver
// supabase/migrations/20261116120000_transmision_productos.sql). La escritura
// pasa por la tabla base y queda protegida por sus políticas RLS: la propiedad
// se comprueba SIEMPRE en el servidor, nunca se confía en el cliente.

const VISTA_PRODUCTOS = 'transmision_productos_publico';
const SELECT_PRODUCTOS = [
  'producto_id',
  'orden',
  'nombre',
  'descripcion',
  'precio',
  'imagen',
  'categoria',
  'tag'
].join(',');

/** Máximo de productos promocionados por transmisión. */
const MAX_PRODUCTOS = 20;

const CORS = cors('GET, PUT, OPTIONS');

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
    // Con Bearer válido se usa el cliente del usuario: así el ANFITRIÓN ve su
    // selección aunque la transmisión aún esté 'programada'. Sin sesión se cae
    // al cliente público, que sólo ve las transmisiones en vivo.
    const auth = await requireUser(request);
    const db: SupabaseClient = auth.ok ? auth.db : await createServerSupabase();

    const { data, error } = await db
      .schema('public')
      .from(VISTA_PRODUCTOS)
      .select(SELECT_PRODUCTOS)
      .eq('transmision_id', id)
      .order('orden', { ascending: true })
      .order('producto_id', { ascending: true });

    if (error) {
      console.error('Error consultando productos de la transmisión:', error);

      // 42P01 = undefined_table: la vista aún no se ha creado (migración pendiente).
      if (error.code === '42P01') {
        return CORS.json(
          request,
          { error: 'Los productos promocionados no están disponibles todavía.' },
          503
        );
      }

      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    return CORS.json(request, { data: data ?? [] }, 200);
  } catch (err) {
    console.error('Error inesperado consultando productos de la transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

// PUT /api/transmisiones/[id]/productos
// Reemplaza por completo la lista de productos promocionados de la transmisión.
// El cuerpo es { productos: number[] } (ids de productos del catálogo propio).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return CORS.json(request, { error: 'Identificador de transmisión no válido' }, 400);
  }

  const cuerpo = await leerCuerpoJson(request);
  if (!cuerpo || !Array.isArray(cuerpo.productos)) {
    return CORS.json(
      request,
      { error: 'El cuerpo debe ser un JSON con el campo "productos" (lista de ids).' },
      400
    );
  }

  const ids: number[] = [];
  for (const valor of cuerpo.productos as unknown[]) {
    const n = typeof valor === 'number' ? valor : Number(valor);
    if (!Number.isInteger(n) || n <= 0) {
      return CORS.json(request, { error: 'Cada producto debe ser un id numérico válido.' }, 400);
    }
    if (!ids.includes(n)) ids.push(n);
  }

  if (ids.length > MAX_PRODUCTOS) {
    return CORS.json(
      request,
      { error: `No se pueden promocionar más de ${MAX_PRODUCTOS} productos por transmisión.` },
      400
    );
  }

  try {
    // 1) Propiedad: la RLS de SELECT de `transmisiones` deja al anfitrión leer
    //    las suyas en cualquier estado. Si no aparece, la transmisión no existe
    //    o no es suya.
    const { data: fila, error: errorLectura } = await auth.db
      .schema('public')
      .from('transmisiones')
      .select('id, anfitrion_id, estado')
      .eq('id', id)
      .eq('anfitrion_id', auth.usuario.id)
      .maybeSingle();

    if (errorLectura) {
      console.error('Error verificando propiedad de la transmisión:', errorLectura);
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

    // 2) Sólo se pueden promocionar productos del PROPIO catálogo del anfitrión.
    if (ids.length > 0) {
      const { data: propios, error: errorProductos } = await auth.db
        .schema('public')
        .from('productos')
        .select('id')
        .eq('vendedor_id', auth.usuario.id)
        .in('id', ids);

      if (errorProductos) {
        console.error('Error verificando productos del anfitrión:', errorProductos);
        const mapped = mapErrorBD(errorProductos);
        return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
      }

      const permitidos = new Set((propios ?? []).map((p) => Number(p.id)));
      const ajenos = ids.filter((n) => !permitidos.has(n));
      if (ajenos.length > 0) {
        return CORS.json(
          request,
          { error: 'Sólo puedes promocionar productos de tu propio catálogo.' },
          403
        );
      }
    }

    // 3) Reemplazo: borrar lo anterior e insertar la nueva selección. Ambas
    //    operaciones están protegidas por RLS (sólo el anfitrión de la fila).
    const { error: errorBorrado } = await auth.db
      .schema('public')
      .from('transmision_productos')
      .delete()
      .eq('transmision_id', id);

    if (errorBorrado) {
      console.error('Error limpiando productos promocionados:', errorBorrado);
      const mapped = mapErrorBD(errorBorrado);
      return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
    }

    if (ids.length > 0) {
      const filas = ids.map((producto_id, orden) => ({
        transmision_id: id,
        producto_id,
        orden
      }));

      const { error: errorInsercion } = await auth.db
        .schema('public')
        .from('transmision_productos')
        .insert(filas);

      if (errorInsercion) {
        console.error('Error guardando productos promocionados:', errorInsercion);
        const mapped = mapErrorBD(errorInsercion);
        return CORS.json(request, { error: mapped!.mensaje }, mapped!.status);
      }
    }

    return CORS.json(request, { data: { id, productos: ids } }, 200);
  } catch (err) {
    console.error('Error inesperado guardando productos de la transmisión:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
